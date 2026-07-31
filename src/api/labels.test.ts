import { beforeEach, describe, expect, it, vi } from 'vitest'

// WHAT THIS FILE PINS. Five things about api/labels.ts are decisions rather than
// mechanics, and none of them is visible to the type checker:
//
//   · the nullable-client guard is the FIRST statement of every function, so a
//     build without credentials degrades into a readable message;
//   · blank is sent as NULL, never as an empty string (spec §5);
//   · blanking BOTH languages is sent as a DELETE, not as an upsert whose
//     response describes a row 0016's prune trigger has already removed;
//   · both resets go through `reset_label_overrides()`, the function 0016 built
//     and probed as the escape hatch, rather than through an ad-hoc DELETE;
//   · an import writes every key in one statement, not one request per key.
//
// The store's own suite fakes this module wholesale; this is the only place the
// request shapes are looked at.

/** One `.from()` chain or `.rpc()` call, as the fake client saw it. */
interface Call {
  table: string
  ops: [string, unknown[]][]
}

interface FakeBuilder {
  select: (...args: unknown[]) => FakeBuilder
  order: (...args: unknown[]) => FakeBuilder
  range: (...args: unknown[]) => FakeBuilder
  upsert: (...args: unknown[]) => FakeBuilder
  delete: (...args: unknown[]) => FakeBuilder
  eq: (...args: unknown[]) => FakeBuilder
  in: (...args: unknown[]) => FakeBuilder
  single: (...args: unknown[]) => FakeBuilder
  then: (onfulfilled?: (v: unknown) => unknown) => Promise<unknown>
}

let calls: Call[] = []
let answer: { data: unknown; error: unknown } = { data: [], error: null }

/**
 * Answers for a PAGED read, taken one per subscription.
 *
 * listOverrides() walks `.range()` pages until a short one arrives, so a test
 * that wants to see the second page has to be able to answer differently the
 * second time. Empty means "use `answer` for everything", which is what every
 * single-request case wants.
 */
let pages: { data: unknown; error: unknown }[] = []

/**
 * A recording stand-in for the PostgREST query builder.
 *
 * Thenable rather than a resolved promise, mirroring postgrest-js: nothing
 * reaches the network until something subscribes, and store/settings.test.ts
 * documents at length the bug that distinction hid for two waves. Here it also
 * means a chain that is built and dropped records no `then` and is visibly
 * incomplete.
 */
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
    upsert: record('upsert'),
    delete: record('delete'),
    eq: record('eq'),
    in: record('in'),
    single: record('single'),
    then: (onfulfilled) => {
      call.ops.push(['then', []])
      return Promise.resolve(pages.shift() ?? answer).then(onfulfilled)
    },
  }
  return builder
}

const fakeClient = {
  from: (table: string) => makeBuilder(table),
  rpc: (name: string, args: unknown) => {
    calls.push({ table: `rpc:${name}`, ops: [['args', [args]]] })
    return Promise.resolve(answer)
  },
}

/**
 * A fresh copy of the module bound to a client that either exists or does not.
 * `supabase` is a const binding captured at import, so switching it means
 * re-importing — hence doMock (not hoisted) plus resetModules.
 */
async function loadApi(configured = true): Promise<typeof import('./labels')> {
  vi.resetModules()
  vi.doMock('./supabase', () => ({
    supabase: configured ? fakeClient : null,
    isConfigured: () => configured,
  }))
  return await import('./labels')
}

/** The args a chain passed to one builder method, or undefined if never called. */
function argsOf(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([op]) => op === name)?.[1]
}

function names(call: Call): string[] {
  return call.ops.map(([op]) => op)
}

beforeEach(() => {
  calls = []
  answer = { data: [], error: null }
  pages = []
})

describe('the nullable-client guard is the first statement of every function', () => {
  it('returns common.notConfigured and touches nothing', async () => {
    const api = await loadApi(false)

    // A build without VITE_SUPABASE_* — a fresh clone, a preview deploy, CI —
    // has to render the shell and say so, not throw. `common.notConfigured` is
    // an i18n KEY, resolved when it is rendered rather than when the call
    // failed, so it is in the right language after a locale switch.
    const results = [
      await api.listOverrides(),
      await api.upsertOverride('nav.board', 'Pipeline', null),
      await api.upsertOverrides([{ key: 'nav.board', en: 'Pipeline', ar: null }]),
      await api.deleteOverride('nav.board'),
      await api.deleteAllOverrides(),
    ]

    for (const result of results) {
      expect(result).toEqual({ ok: false, error: 'common.notConfigured' })
    }
    expect(calls).toHaveLength(0)
  })
})

describe('listOverrides', () => {
  it('asks for the named columns, ordered by key, and never `*`', async () => {
    const api = await loadApi()
    answer = { data: [{ key: 'nav.board', en: 'Pipeline', ar: null }], error: null }

    const result = await api.listOverrides()

    expect(result.ok && result.data.rows).toHaveLength(1)
    expect(result.ok && result.data.truncated).toBe(false)
    expect(calls[0].table).toBe('label_overrides')
    // `select('*')` would ship any column a later migration adds down to every
    // client and into localStorage.
    expect(argsOf(calls[0], 'select')?.[0]).toBe('key, en, ar, updated_by, updated_at')
    // The key IS the primary key, so this ordering is total: two loads of the
    // same data cannot come back in different orders.
    expect(argsOf(calls[0], 'order')).toEqual(['key', { ascending: true }])
    // The first window of the paged walk. A read with no `.range()` is the bug
    // this pins: PostgREST applies its own 1000-row ceiling AFTER any limit and
    // answers 200 with the rest missing.
    expect(argsOf(calls[0], 'range')).toEqual([0, 999])
    // One short page is the whole table — no second round trip.
    expect(calls).toHaveLength(1)
  })

  // THE READ THIS TABLE CAN OUTGROW. ~1,670 keys, 91 of them plural nodes with
  // up to six Arabic forms each, is ~2,100 override rows for a complete wording
  // pass — and the import path can write them all at once, because the ceiling
  // caps a response body and never a write. Unpaged, the read would come back
  // with the first 1,000 and a 200, and every key after it would silently
  // revert to its shipped wording in the live layer, the cache, the header
  // count and the export.
  it('walks `.range()` pages until a short one arrives, and concatenates them', async () => {
    const api = await loadApi()
    const page = (from: number, n: number): { key: string; en: string; ar: null }[] =>
      Array.from({ length: n }, (_, i) => ({ key: `k.${from + i}`, en: 'x', ar: null }))
    pages = [
      { data: page(0, 1000), error: null },
      { data: page(1000, 124), error: null },
    ]

    const result = await api.listOverrides()

    expect(result.ok && result.data.rows).toHaveLength(1124)
    expect(result.ok && result.data.truncated).toBe(false)
    expect(calls).toHaveLength(2)
    expect(argsOf(calls[1], 'range')).toEqual([1000, 1999])
    // Concatenated in the query's own order, so the array stays globally sorted
    // by key with no re-sort.
    expect(result.ok && result.data.rows[1000].key).toBe('k.1000')
  })

  it('stops at the page cap and SAYS the answer is clipped', async () => {
    const api = await loadApi()
    answer = {
      data: Array.from({ length: 1000 }, (_, i) => ({ key: `k.${i}`, en: 'x', ar: null })),
      error: null,
    }

    const result = await api.listOverrides()

    // Four full pages is 4,000 rows against a hard bound of ~2,100, so this is
    // unreachable by wording and reachable only by a bug. The flag is what stops
    // the store caching a partial layer as if it were the whole one.
    expect(calls).toHaveLength(4)
    expect(result.ok && result.data.truncated).toBe(true)
    expect(result.ok && result.data.rows).toHaveLength(4000)
  })

  it('reports an unapplied 0016 as a failure the store can absorb', async () => {
    const api = await loadApi()
    // PostgREST's answer when label_overrides does not exist yet — verified
    // against the live project on 2026-07-31, before the migration was applied.
    // The store logs it and keeps an empty layer, and every t() renders its
    // shipped string; nothing degrades further than "not reworded".
    //
    // NAMED rather than generic, and the difference is the terminology screen's
    // "the table is not installed" note: hanging that off the catch-all told
    // the owner his project had no label_overrides table whenever ANY save
    // failed, which after 0016 is applied is simply false.
    answer = { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }

    const result = await api.listOverrides()
    expect(result).toEqual({ ok: false, error: 'common.errMissingTable' })
  })

  it('maps an RLS refusal to admin.errForbidden', async () => {
    const api = await loadApi()
    answer = { data: null, error: { code: '42501', message: 'permission denied' } }
    expect(await api.listOverrides()).toEqual({ ok: false, error: 'admin.errForbidden' })
  })
})

describe('upsertOverride', () => {
  it('trims, and sends a blank language as NULL rather than an empty string', async () => {
    const api = await loadApi()
    answer = { data: { key: 'nav.board', en: 'Pipeline', ar: null }, error: null }

    await api.upsertOverride('  nav.board  ', '  Pipeline  ', '   ')

    const row = argsOf(calls[0], 'upsert')?.[0] as Record<string, unknown>
    expect(row).toEqual({ key: 'nav.board', en: 'Pipeline', ar: null })
    expect(argsOf(calls[0], 'upsert')?.[1]).toEqual({ onConflict: 'key' })
    // Audit columns belong to 0016's trigger: a client that stamps its own can
    // lie about them, and the row exists to say who changed the wording.
    expect(Object.keys(row)).toEqual(['key', 'en', 'ar'])
  })

  it('sends a DELETE when both languages are blank, and reports the row as gone', async () => {
    const api = await loadApi()
    answer = { data: 1, error: null }

    const result = await api.upsertOverride('nav.board', '', '   ')

    expect(result).toEqual({ ok: true, data: null })
    // No upsert at all. 0016's prune trigger would remove the row anyway, but
    // the response to that upsert describes a row that no longer exists by the
    // time it is written — the migration flags exactly this for whoever writes
    // the client. Asking for the deletion that is meant avoids the phantom.
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('rpc:reset_label_overrides')
    expect(calls[0].ops[0][1][0]).toEqual({ p_key: 'nav.board' })
  })

  it('refuses a blank key rather than occupying the primary key with nothing', async () => {
    const api = await loadApi()
    expect(await api.upsertOverride('   ', 'Pipeline', null)).toEqual({
      ok: false,
      error: 'common.error',
    })
    expect(calls).toHaveLength(0)
  })
})

describe('upsertOverrides — the import path', () => {
  it('writes every key in ONE upsert and clears the blank ones in one delete', async () => {
    const api = await loadApi()
    answer = { data: [{ key: 'nav.board', en: 'Pipeline', ar: null }], error: null }

    await api.upsertOverrides([
      { key: 'nav.board', en: 'Pipeline', ar: null },
      { key: 'nav.tracks', en: '', ar: '  ' },
      { key: '   ', en: 'x', ar: null },
    ])

    // Two statements, not one per key: a wording pass is hundreds of keys, and
    // hundreds of sequential round trips over a phone connection is a different
    // product. The blank-keyed entry is dropped rather than sent.
    expect(calls).toHaveLength(2)
    expect(argsOf(calls[0], 'in')).toEqual(['key', ['nav.tracks']])
    expect(argsOf(calls[1], 'upsert')?.[0]).toEqual([
      { key: 'nav.board', en: 'Pipeline', ar: null },
    ])
    // A bulk write reads nothing back per row, so no `.single()` anywhere.
    expect(names(calls[1])).not.toContain('single')
  })

  it('sends nothing when the file has nothing to write', async () => {
    const api = await loadApi()
    expect(await api.upsertOverrides([])).toEqual({ ok: true, data: [] })
    expect(calls).toHaveLength(0)
  })
})

describe('the escape hatch goes through the reset function 0016 built', () => {
  it('resets one key by name and reports the row count', async () => {
    const api = await loadApi()
    answer = { data: 1, error: null }

    expect(await api.deleteOverride('  nav.board  ')).toEqual({ ok: true, data: 1 })
    expect(calls[0].table).toBe('rpc:reset_label_overrides')
    expect(calls[0].ops[0][1][0]).toEqual({ p_key: 'nav.board' })
  })

  it('treats "nothing to reset" as a success, not a failure', async () => {
    const api = await loadApi()
    // Another admin got there first. The same call answers "reset this row" and
    // "reset a row already reset"; a red banner on the second is a lie.
    answer = { data: 0, error: null }
    expect(await api.deleteOverride('nav.board')).toEqual({ ok: true, data: 0 })
  })

  it('clears everything with p_key null — one statement, no half-applied reset', async () => {
    const api = await loadApi()
    answer = { data: 7, error: null }

    // Spec §4: it must be impossible to reword the app into an unusable state
    // and be unable to get back. A per-key loop could leave the owner staring at
    // the subset of his own renames that happened to survive.
    expect(await api.deleteAllOverrides()).toEqual({ ok: true, data: 7 })
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('rpc:reset_label_overrides')
    expect(calls[0].ops[0][1][0]).toEqual({ p_key: null })
  })

  it('surfaces a member calling it as admin.errForbidden', async () => {
    const api = await loadApi()
    // reset_label_overrides() raises 42501 itself so a member gets a clean,
    // translatable refusal instead of a silent zero-row delete reported as
    // success.
    answer = { data: null, error: { code: '42501', message: 'only an admin may reset' } }
    expect(await api.deleteAllOverrides()).toEqual({ ok: false, error: 'admin.errForbidden' })
  })
})
