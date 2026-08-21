// What this file pins, and why it is one file rather than three.
//
// The unit is a SEAM, not a function: `fetchAllPages` decides when a read has
// finished, `api/map.ts` decides what to ask for, and `store/config.ts` decides
// what the app does with the verdict. Every bug this wave exists to prevent
// lives BETWEEN two of those three — a driver that stops early is invisible
// until a loader trusts it, and a loader that reports truncation is pointless
// until a store carries it. So the three are tested together, in the order the
// data flows, and the assertions name the neighbour they protect.
//
// THE FAILURES BEING PINNED ARE ALL "SUCCESS WITH MISSING ROWS":
//
//   · a short page stops the walk and a full one does not — the difference
//     between reading 1,024 organizations and reading 1,000 of them and saying
//     nothing;
//   · a page LONGER than asked for counts as FULL (lib/export.ts:284's
//     refinement, absent from the other two copies) — a server ignoring
//     `.range()` must not look like a complete short read;
//   · the cap reports `truncated`, and nothing else does;
//   · `.in()` is chunked, so a 400-uuid filter never becomes a ~15KB URL a
//     proxy rejects before Postgres sees it;
//   · `settle()` takes both the old array shape and the new `Loaded<T>` one,
//     and the flag survives all the way to the selector the map reads.
//
// THE STORE HALF SUBSTITUTES `zustand`, AND THE FIRST ATTEMPT IS WORTH RECORDING
// because it was green-looking and wrong. store/config.ts exports only hooks —
// the store object itself is deliberately private — so the obvious way to read
// `useMapNodesTruncated()` is to render a probe component through
// `renderToStaticMarkup`, MapBranchDetail.test.tsx's precedent. It returns FALSE
// no matter what the store holds: zustand passes `getInitialState` as
// `useSyncExternalStore`'s server snapshot, and every server render therefore
// reports the state as it was at module init. A test written that way would have
// asserted `false` against `false` forever.
//
// So the fake `create` below stands in for the reactive wrapper and nothing
// else: it keeps the same state object, the same `setState` merge and the same
// "a selector is a function of state" contract, which is all store/config.ts
// uses. What is being tested is this repo's decisions — settle's guard, the
// verdict reaching the field, the cache cap — not zustand's subscription
// machinery, which has its own tests upstream.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chunkIds, fetchAllPages, ID_CHUNK, PAGE_SIZE } from './paging'

// ── the driver ─────────────────────────────────────────────────────────────

/** A row shape with nothing in it but an identity, so the arithmetic is visible. */
interface Row {
  id: string
}

/** `n` rows starting at `from`, so a concatenation can be checked for order. */
function rows(from: number, n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }))
}

/**
 * A query that answers from a script, recording the `.range()` bounds it was
 * asked for. Undefined past the end of the script means the driver asked for a
 * page the test did not expect, which shows up as an obvious `undefined` rather
 * than as a silent empty page that would look like a legitimate stop.
 */
function scripted(script: { data: Row[] | null; error: unknown }[]): {
  query: (from: number, to: number) => Promise<{ data: Row[] | null; error: unknown }>
  asked: [number, number][]
} {
  const asked: [number, number][] = []
  return {
    asked,
    query: (from, to) => {
      asked.push([from, to])
      return Promise.resolve(script[asked.length - 1])
    },
  }
}

describe('fetchAllPages', () => {
  it('asks for inclusive `.range()` windows starting at 0', async () => {
    const { query, asked } = scripted([{ data: rows(0, 3), error: null }])

    const result = await fetchAllPages(query, 5)

    expect(result.ok && result.data.rows).toHaveLength(3)
    // 0..999, not 0..1000: `.range()` is inclusive at both ends, and the
    // off-by-one costs one duplicated row per page boundary — which arrives as
    // a second copy of one organization, not as an error.
    expect(asked).toEqual([[0, PAGE_SIZE - 1]])
  })

  it('stops on a SHORT page and reports a complete read', async () => {
    const { query, asked } = scripted([{ data: rows(0, 7), error: null }])

    const result = await fetchAllPages(query, 5)

    expect(result.ok && result.data.truncated).toBe(false)
    // No second request. Waiting for an EMPTY page would cost a round trip on
    // every read, to learn something the short page already said.
    expect(asked).toHaveLength(1)
  })

  it('keeps walking after a FULL page and concatenates in query order', async () => {
    const { query, asked } = scripted([
      { data: rows(0, PAGE_SIZE), error: null },
      { data: rows(PAGE_SIZE, 24), error: null },
    ])

    const result = await fetchAllPages(query, 5)

    expect(result.ok && result.data.rows).toHaveLength(PAGE_SIZE + 24)
    expect(result.ok && result.data.truncated).toBe(false)
    expect(asked[1]).toEqual([PAGE_SIZE, 2 * PAGE_SIZE - 1])
    // Concatenated in the query's own order, so the array stays globally sorted
    // and no consumer has to re-sort a paged read.
    expect(result.ok && result.data.rows[PAGE_SIZE].id).toBe(`r${PAGE_SIZE}`)
  })

  it('asks one extra time when the total is an exact multiple, and that page is empty', async () => {
    const { query, asked } = scripted([
      { data: rows(0, PAGE_SIZE), error: null },
      { data: [], error: null },
    ])

    const result = await fetchAllPages(query, 5)

    expect(result.ok && result.data.rows).toHaveLength(PAGE_SIZE)
    expect(result.ok && result.data.truncated).toBe(false)
    expect(asked).toHaveLength(2)
  })

  it('treats a page LONGER than asked for as FULL, never as the end', async () => {
    // A server that ignores `.range()` — a misconfigured proxy, an older
    // PostgREST, a stub — answers with everything it has. `length < PAGE_SIZE`
    // is then false, and a driver that tested `!== PAGE_SIZE` would call this a
    // complete read of a table it never finished asking about. The verdict has
    // to be wrong in the safe direction: claim truncation, not completeness.
    const { query, asked } = scripted([
      { data: rows(0, PAGE_SIZE + 500), error: null },
      { data: rows(0, PAGE_SIZE + 500), error: null },
    ])

    const result = await fetchAllPages(query, 2)

    expect(result.ok && result.data.truncated).toBe(true)
    expect(asked).toHaveLength(2)
  })

  it('stops at the cap and SAYS the answer is clipped', async () => {
    const script = Array.from({ length: 9 }, () => ({ data: rows(0, PAGE_SIZE), error: null }))
    const { query, asked } = scripted(script)

    const result = await fetchAllPages(query, 3)

    expect(result.ok && result.data.truncated).toBe(true)
    expect(result.ok && result.data.rows).toHaveLength(3 * PAGE_SIZE)
    expect(asked).toHaveLength(3)
  })

  it('never claims completeness it has not proved, even at maxPages 0', async () => {
    const { query, asked } = scripted([])

    const result = await fetchAllPages(query, 0)

    expect(asked).toHaveLength(0)
    expect(result.ok && result.data.truncated).toBe(true)
  })

  it('fails on an error mid-walk rather than returning the pages it had', async () => {
    const { query, asked } = scripted([
      { data: rows(0, PAGE_SIZE), error: null },
      { data: null, error: { code: '42501', message: 'permission denied' } },
    ])

    const result = await fetchAllPages(query, 5)

    // An i18n KEY, through pgErrorKey, because every caller renders
    // `t(result.error)` — and a partial answer must not be dressed as a
    // truncated one: "the workspace is big" and "the read failed" are two
    // different sentences on screen.
    expect(result).toEqual({ ok: false, error: 'admin.errForbidden' })
    expect(asked).toHaveLength(2)
  })

  it('treats a null payload as an empty page', async () => {
    const { query } = scripted([{ data: null, error: null }])

    const result = await fetchAllPages(query, 5)

    expect(result.ok && result.data.rows).toEqual([])
    expect(result.ok && result.data.truncated).toBe(false)
  })
})

// ── the chunker ────────────────────────────────────────────────────────────

describe('chunkIds', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `id-${i}`)

  it('makes NO chunk for no ids', () => {
    // `.in('node_id', [])` is a request that asks for nothing and is answered
    // with nothing. One empty chunk would be a round trip spent proving what the
    // caller already knew — and the portfolio issues this call on every render
    // where the filter matched no organizations.
    expect(chunkIds([])).toEqual([])
  })

  it('cuts the real portfolio into three pieces', () => {
    // 400 organizations at ID_CHUNK = 150: the numbers this feature was sized
    // for, and the last chunk is short rather than padded.
    expect(chunkIds(ids(400)).map((c) => c.length)).toEqual([150, 150, 100])
  })

  it('makes exactly one chunk at the boundary and two just past it', () => {
    expect(chunkIds(ids(ID_CHUNK))).toHaveLength(1)
    expect(chunkIds(ids(ID_CHUNK + 1)).map((c) => c.length)).toEqual([ID_CHUNK, 1])
  })

  it('keeps every id, once, in order', () => {
    const source = ids(320)
    expect(chunkIds(source).flat()).toEqual(source)
  })
})

// ── the map's readers ──────────────────────────────────────────────────────
//
// A recording stand-in for the PostgREST builder, thenable rather than a
// resolved promise exactly as api/labels.test.ts's is: nothing reaches the
// network until something subscribes, so a chain that is built and dropped
// records no `then` and is visibly incomplete.

interface Call {
  table: string
  ops: [string, unknown[]][]
}

let calls: Call[] = []
let answer: { data: unknown; error: unknown } = { data: [], error: null }
let pages: { data: unknown; error: unknown }[] = []

interface FakeBuilder {
  select: (...args: unknown[]) => FakeBuilder
  order: (...args: unknown[]) => FakeBuilder
  range: (...args: unknown[]) => FakeBuilder
  eq: (...args: unknown[]) => FakeBuilder
  in: (...args: unknown[]) => FakeBuilder
  then: (onfulfilled?: (v: unknown) => unknown) => Promise<unknown>
}

function makeBuilder(table: string): FakeBuilder {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const record =
    (name: string) =>
    (...args: unknown[]): FakeBuilder => {
      call.ops.push([name, args])
      return builder
    }
  const builder: FakeBuilder = {
    select: record('select'),
    order: record('order'),
    range: record('range'),
    eq: record('eq'),
    in: record('in'),
    then: (onfulfilled) => {
      call.ops.push(['then', []])
      return Promise.resolve(pages.shift() ?? answer).then(onfulfilled)
    },
  }
  return builder
}

const fakeClient = { from: (table: string) => makeBuilder(table) }

async function loadMapApi(configured = true): Promise<typeof import('./map')> {
  vi.resetModules()
  vi.doMock('./supabase', () => ({
    supabase: configured ? fakeClient : null,
    isConfigured: () => configured,
  }))
  return await import('./map')
}

function argsOf(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([op]) => op === name)?.[1]
}

function allArgs(call: Call, name: string): unknown[][] {
  return call.ops.filter(([op]) => op === name).map(([, args]) => args)
}

beforeEach(() => {
  calls = []
  answer = { data: [], error: null }
  pages = []
})

afterEach(() => {
  vi.doUnmock('./supabase')
})

describe('listMapNodes', () => {
  it('pages, and orders by a TOTAL key so `.range()` cannot drop or duplicate a row', async () => {
    const api = await loadMapApi()
    answer = { data: [{ id: 'n1' }], error: null }

    const result = await api.listMapNodes(true)

    expect(result.ok && result.data.rows).toHaveLength(1)
    expect(result.ok && result.data.truncated).toBe(false)
    expect(calls[0].table).toBe('map_nodes')
    expect(argsOf(calls[0], 'range')).toEqual([0, 999])
    // sort_order, then name, then id. The third key is what paging added: the
    // first two tie, and a non-total order under `.range()` lets the server
    // return a tied row on two pages or on neither.
    expect(allArgs(calls[0], 'order').map((a) => a[0])).toEqual(['sort_order', 'name', 'id'])
  })

  it('filters archived rows out at the server, on every page', async () => {
    const api = await loadMapApi()
    pages = [
      { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `n${i}` })), error: null },
      { data: [{ id: 'last' }], error: null },
    ]

    const result = await api.listMapNodes()

    expect(result.ok && result.data.rows).toHaveLength(PAGE_SIZE + 1)
    expect(calls).toHaveLength(2)
    // The predicate has to be rebuilt for page 2 — a query built once outside
    // the page callback would carry page 1's `.range()` forever.
    expect(argsOf(calls[1], 'eq')).toEqual(['archived', false])
    expect(argsOf(calls[1], 'range')).toEqual([1000, 1999])
  })

  it('reports truncation rather than a short map when the cap is reached', async () => {
    const api = await loadMapApi()
    answer = { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `n${i}` })), error: null }

    const result = await api.listMapNodes(true)

    // Five pages is api/map.ts's MAX_PAGES. The number matters less than the
    // pair: the walk stops, and it says so.
    expect(calls).toHaveLength(5)
    expect(result.ok && result.data.truncated).toBe(true)
    expect(result.ok && result.data.rows).toHaveLength(5 * PAGE_SIZE)
  })
})

describe('listNodeUseCases', () => {
  it('is ONE request for ONE node, unpaged — the clamp-immunity argument', async () => {
    const api = await loadMapApi()
    answer = { data: [{ node_id: 'org-1', use_case_id: 'uc-1', status: 'live' }], error: null }

    const result = await api.listNodeUseCases('org-1')

    // MapBranchDetail.tsx:65-74 says this read is immune to PostgREST's ceiling
    // BY CONSTRUCTION — one row per capability for one node. That sentence has
    // to stay true, so the request is filtered by node and carries no `.range()`
    // at all. A paged read here would suggest a doubt this one does not have.
    expect(calls).toHaveLength(1)
    expect(argsOf(calls[0], 'eq')).toEqual(['node_id', 'org-1'])
    expect(argsOf(calls[0], 'range')).toBeUndefined()
    expect(result.ok && result.data).toHaveLength(1)
  })

  it('asks for the five Jira columns by name, so a row can say where it came from', async () => {
    const api = await loadMapApi()

    await api.listNodeUseCases('org-1')

    const columns = String(argsOf(calls[0], 'select')?.[0])
    expect(columns).toBe(
      'node_id, use_case_id, status, source, external_ref, external_url, synced_at, overrides',
    )
    // Never `*`: a later migration's column would otherwise ship to every
    // client and into whatever the caller caches.
    expect(columns).not.toContain('*')
  })
})

describe('listNodeUseCasesFor', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `org-${i}`)

  it('makes no request at all for no nodes', async () => {
    const api = await loadMapApi()

    const result = await api.listNodeUseCasesFor([])

    expect(calls).toHaveLength(0)
    expect(result.ok && result.data).toEqual({ rows: [], truncated: false })
  })

  it('chunks 400 organizations into three `.in()` filters', async () => {
    const api = await loadMapApi()
    answer = { data: [{ node_id: 'org-0', use_case_id: 'uc-1', status: 'live' }], error: null }

    const result = await api.listNodeUseCasesFor(ids(400))

    expect(calls).toHaveLength(3)
    expect(calls.map((c) => ((argsOf(c, 'in') ?? [])[1] as string[]).length)).toEqual([
      150, 150, 100,
    ])
    // Every chunk is a page-0 read of its own — the walk restarts per chunk,
    // because the ceiling applies to a response, not to a question.
    expect(calls.every((c) => JSON.stringify(argsOf(c, 'range')) === '[0,999]')).toBe(true)
    expect(result.ok && result.data.rows).toHaveLength(3)
  })

  it('ORs the verdicts: one clipped chunk clips the whole answer', async () => {
    const api = await loadMapApi()
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      node_id: `org-${i}`,
      use_case_id: 'uc-1',
      status: 'live',
    }))
    // Chunk 1 walks its full five pages and gives up; chunk 2 is short.
    pages = [
      ...Array.from({ length: 5 }, () => ({ data: full, error: null })),
      { data: [{ node_id: 'org-200', use_case_id: 'uc-1', status: 'live' }], error: null },
    ]

    const result = await api.listNodeUseCasesFor(ids(300))

    expect(result.ok && result.data.truncated).toBe(true)
    expect(result.ok && result.data.rows).toHaveLength(5 * PAGE_SIZE + 1)
  })

  it('fails the whole read when a chunk fails', async () => {
    const api = await loadMapApi()
    pages = [
      { data: [{ node_id: 'org-0', use_case_id: 'uc-1', status: 'live' }], error: null },
      { data: null, error: { code: '42501', message: 'permission denied' } },
    ]

    const result = await api.listNodeUseCasesFor(ids(200))

    // Not `{ rows: <chunk 1>, truncated: true }`. "Some rows are missing because
    // the workspace is big" and "the read was refused" must not be told apart by
    // whether the caller happened to look at a flag.
    expect(result).toEqual({ ok: false, error: 'admin.errForbidden' })
  })

  it('guards the nullable client before it counts anything', async () => {
    const api = await loadMapApi(false)

    const result = await api.listNodeUseCasesFor(ids(400))

    expect(result).toEqual({ ok: false, error: 'common.notConfigured' })
    expect(calls).toHaveLength(0)
  })
})

// ── the store, where the verdict has to survive ────────────────────────────

interface StoreEnv {
  store: Map<string, string>
  removed: string[]
}

/**
 * A fresh store/config bound to fake loaders and a fake localStorage.
 *
 * `doMock` + `resetModules` for api/labels.test.ts's reason: store/config reads
 * its caches at MODULE scope, so the globals have to exist before the import and
 * a static one would evaluate the module first.
 */
async function loadConfigStore(opts: {
  nodes: { rows: { id: string }[]; truncated: boolean }
  tracks?: { id: string }[]
  seeded?: Record<string, string>
}): Promise<{ mod: typeof import('../store/config'); env: StoreEnv }> {
  const env: StoreEnv = { store: new Map(Object.entries(opts.seeded ?? {})), removed: [] }
  vi.resetModules()
  vi.doMock('zustand', () => ({
    create: <T,>(initializer: () => T) => {
      let state = initializer()
      const hook = (selector: (s: T) => unknown): unknown => selector(state)
      hook.getState = (): T => state
      hook.setState = (partial: Partial<T>): void => {
        state = { ...state, ...partial }
      }
      return hook
    },
  }))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => env.store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      env.store.set(k, v)
    },
    removeItem: (k: string) => {
      env.removed.push(k)
      env.store.delete(k)
    },
  })
  // store/config registers a focus listener at module scope; in `node` there is
  // no window to register it on.
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.doMock('../store/auth', () => ({ hasSession: () => true }))
  vi.doMock('../api/tracks', () => ({
    listTracks: () => Promise.resolve({ ok: true, data: opts.tracks ?? [{ id: 't1' }] }),
    listGroups: () => Promise.resolve({ ok: true, data: [{ id: 'g1' }] }),
  }))
  vi.doMock('../api/map', () => ({
    listMapNodes: () => Promise.resolve({ ok: true, data: opts.nodes }),
    listMapNodeKinds: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
    listUseCases: () =>
      Promise.resolve({ ok: true, data: { rows: [{ id: 'uc1' }], truncated: false } }),
    // 0026's two reads. Present in the mock even though nothing here asserts on
    // them: `loadConfig` awaits all eight in one `Promise.all`, so a missing
    // member is a TypeError that rejects the whole load and empties the store —
    // which would fail these tests for a reason that has nothing to do with
    // paging. They answer the shipping state: both tables exist and are empty.
    listMapNodeStages: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
    listMapNodeProgress: () => Promise.resolve({ ok: true, data: { rows: [], truncated: false } }),
  }))
  const mod = await import('../store/config')
  return { mod, env }
}

/**
 * What `useMapNodesTruncated()` says.
 *
 * Called as a plain function, which is legal ONLY under the fake `create` above
 * — the real selector is a hook and would throw outside a render. That is the
 * substitution earning its place: the sentence on the map depends on this
 * selector returning the field loadConfig wrote, and nothing else in the test
 * environment can observe it.
 */
function truncatedOnScreen(mod: typeof import('../store/config')): boolean {
  return mod.useMapNodesTruncated()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('zustand')
  vi.doUnmock('../store/auth')
  vi.doUnmock('../api/tracks')
  vi.doUnmock('../api/map')
})

describe('settle', () => {
  it('takes BOTH shapes — arrays from tracks, Loaded<T> from the map reads', async () => {
    const { mod, env } = await loadConfigStore({
      nodes: { rows: [{ id: 'n1' }, { id: 'n2' }], truncated: false },
    })

    await mod.loadConfig()

    // One function, one three-branch decision, two payload shapes. If the guard
    // were wrong in either direction one of these caches would hold `undefined`
    // or a `{rows: …}` object instead of an array of rows.
    expect(JSON.parse(env.store.get('nphiescore_tracks_v1') ?? 'null')).toEqual([{ id: 't1' }])
    expect(JSON.parse(env.store.get('nphiescore_map_nodes_v1') ?? 'null')).toEqual([
      { id: 'n1' },
      { id: 'n2' },
    ])
    expect(JSON.parse(env.store.get('nphiescore_use_cases_v1') ?? 'null')).toEqual([{ id: 'uc1' }])
  })

  it('carries a truncated map read all the way to the selector the shell reads', async () => {
    const { mod } = await loadConfigStore({
      nodes: { rows: [{ id: 'n1' }], truncated: true },
    })

    await mod.loadConfig()

    // THE SEAM THIS WHOLE UNIT EXISTS FOR. api/map.ts noticed the clipped read;
    // this proves the notice survives settle(), deriveAll's Omit, the setState
    // and the selector — which is where Mindtree.tsx picks it up.
    expect(truncatedOnScreen(mod)).toBe(true)
  })

  it('says nothing about truncation before anything has loaded', async () => {
    const { mod } = await loadConfigStore({ nodes: { rows: [], truncated: false } })

    expect(truncatedOnScreen(mod)).toBe(false)
  })
})

describe('writeRowCache', () => {
  it('refuses to store more rows than a first paint should trust, and REMOVES the key', async () => {
    const { mod, env } = await loadConfigStore({
      nodes: { rows: Array.from({ length: 1001 }, (_, i) => ({ id: `n${i}` })), truncated: false },
      // Yesterday's smaller workspace, already in the cache. Leaving it would
      // keep serving a first paint that is missing 1,000 organizations forever.
      seeded: { nphiescore_map_nodes_v1: JSON.stringify([{ id: 'stale' }]) },
    })

    await mod.loadConfig()

    expect(env.removed).toContain('nphiescore_map_nodes_v1')
    expect(env.store.has('nphiescore_map_nodes_v1')).toBe(false)
  })

  it('still writes a workspace that fits', async () => {
    const { mod, env } = await loadConfigStore({
      nodes: { rows: Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}` })), truncated: false },
    })

    await mod.loadConfig()

    // 1000 is the cap, not the first value above it — an off-by-one here would
    // silently disable the cache for exactly the workspace size this app has.
    expect(env.removed).not.toContain('nphiescore_map_nodes_v1')
    expect(JSON.parse(env.store.get('nphiescore_map_nodes_v1') ?? 'null')).toHaveLength(1000)
  })
})
