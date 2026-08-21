// The REQUEST SHAPES of the stage half of api/map.ts (0026), pinned against a
// recording fake of the PostgREST builder.
//
// WHAT THIS FILE IS FOR. Every assertion below is about something the type
// checker cannot see and the migration cannot check from its side: a table name,
// an RPC argument name, the exact set of keys in a written row, and the
// difference between an upsert and an insert. All four fail SILENTLY in
// production — a drifted RPC argument is a 404 the first time somebody drags a
// rung, and a server-owned column sent by mistake is OVERRULED rather than
// rejected, which reads as working. 0026's probes assert the SQL side of the same
// handshake; this is the client side, and neither half can see the other.
//
// api/jiraSettings.test.ts's fake, widened with the operations this half uses:
// `.insert`, `.update`, `.delete`, `.upsert`, `.order`, `.range` and the
// head-only `count` reads that feed the delete confirmation.

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** One `.from()` chain, as the fake client saw it. */
interface Call {
  table: string
  ops: [string, unknown[]][]
}

/** One `.rpc()` call. */
interface RpcCall {
  fn: string
  args: unknown
}

/** What the next awaited chain resolves with. PostgREST's own envelope. */
interface Answer {
  data?: unknown
  error?: unknown
  count?: number
}

let calls: Call[] = []
let rpcCalls: RpcCall[] = []
let answers: Answer[] = []

/** The answer for the next awaited chain; the last one repeats once the queue empties. */
let fallback: Answer = { data: [], error: null, count: 0 }

function nextAnswer(): Answer {
  return answers.length > 0 ? (answers.shift() as Answer) : fallback
}

/**
 * A recording stand-in for the query builder.
 *
 * Thenable rather than a resolved promise, mirroring postgrest-js: nothing
 * reaches the network until something subscribes, so a chain that is built and
 * dropped records no `then` and is visibly incomplete.
 */
function makeBuilder(table: string): Record<string, unknown> {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const record =
    (name: string) =>
    (...args: unknown[]): Record<string, unknown> => {
      call.ops.push([name, args])
      return builder
    }
  const builder: Record<string, unknown> = {
    select: record('select'),
    insert: record('insert'),
    update: record('update'),
    upsert: record('upsert'),
    delete: record('delete'),
    eq: record('eq'),
    is: record('is'),
    order: record('order'),
    range: record('range'),
    limit: record('limit'),
    single: record('single'),
    maybeSingle: record('maybeSingle'),
    then: (onfulfilled?: (v: unknown) => unknown) => {
      call.ops.push(['then', []])
      const answer = nextAnswer()
      return Promise.resolve({
        data: answer.data ?? null,
        error: answer.error ?? null,
        count: answer.count ?? 0,
      }).then(onfulfilled)
    },
  }
  return builder
}

const USER_ID = 'e3b0c442-0000-4000-8000-000000000001'

const fakeClient = {
  from: (table: string) => makeBuilder(table),
  rpc: (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args })
    const answer = nextAnswer()
    return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null })
  },
  auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
}

/**
 * A fresh copy of the module bound to the fake client. `supabase` is a const
 * binding captured at import, so switching it means re-importing — hence doMock
 * (not hoisted) plus resetModules.
 */
async function loadApi(): Promise<typeof import('./map')> {
  vi.resetModules()
  vi.doMock('./supabase', () => ({ supabase: fakeClient, isConfigured: () => true }))
  return await import('./map')
}

/** The args a chain passed to one builder method, or undefined if never called. */
function argsOf(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([op]) => op === name)?.[1]
}

function names(call: Call): string[] {
  return call.ops.map(([op]) => op)
}

/** Every chain against one table, in order. */
function callsTo(table: string): Call[] {
  return calls.filter((c) => c.table === table)
}

beforeEach(() => {
  calls = []
  rpcCalls = []
  answers = []
  fallback = { data: [], error: null, count: 0 }
})

describe('listMapNodeStages', () => {
  it('reads the ladder with a total sort order and no hidden filter', async () => {
    const api = await loadApi()
    const result = await api.listMapNodeStages()

    expect(result.ok).toBe(true)
    const call = callsTo('map_node_stages')[0]
    expect(call).toBeDefined()
    expect(argsOf(call, 'select')).toEqual(['*'])
    // THE HIDDEN RUNGS COME BACK, always. The admin restores a rung from this
    // list, so a `.eq('hidden', false)` here would make hiding a one-way door.
    expect(names(call)).not.toContain('eq')
    // `.range()` needs a TOTAL order or a tied row can be returned on two pages
    // or on neither. `sort_order` alone is not one — it defaults to 0 and the
    // reorder RPC only rewrites the ids it was handed — so `id` is the tiebreak.
    const ordered = call.ops.filter(([op]) => op === 'order').map(([, args]) => args[0])
    expect(ordered).toEqual(['sort_order', 'name', 'id'])
    expect(argsOf(call, 'range')).toEqual([0, 999])
  })

  it('reports truncation rather than reporting success on a clipped read', async () => {
    const api = await loadApi()
    // Five full pages: the cap stops the walk with a full page in hand, which is
    // exactly what `truncated` means. A ladder cannot really be 5,000 rows long;
    // the paging is here so that the day something is, the screen says so.
    fallback = { data: Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}` })), error: null }
    const result = await api.listMapNodeStages()

    expect(result.ok && result.data.truncated).toBe(true)
    expect(callsTo('map_node_stages')).toHaveLength(5)
  })

  it('maps a failure to an i18n key instead of Postgres English', async () => {
    const api = await loadApi()
    // The pre-migration state: 0026 has not been applied, so the table is not in
    // PostgREST's schema cache. The caller must get a KEY — store/config.ts logs
    // it and keeps its empty list, and nothing red reaches the screen.
    answers = [{ error: { code: 'PGRST205', message: 'Could not find the table' } }]
    const result = await api.listMapNodeStages()

    expect(result).toEqual({ ok: false, error: 'common.errMissingTable' })
  })
})

describe('createMapNodeStage', () => {
  it('sends the whole row it means, threshold included', async () => {
    const api = await loadApi()
    answers = [
      // nextSortOrder's probe.
      { data: { sort_order: 6 }, error: null },
      { data: { id: 'stage-1' }, error: null },
    ]
    await api.createMapNodeStage({
      name: '  Integrating  ',
      nameAr: ' التكامل ',
      terminal: false,
      paused: false,
      expectedDays: 30,
    })

    const insert = callsTo('map_node_stages').find((c) => argsOf(c, 'insert') !== undefined)
    expect(insert).toBeDefined()
    const row = argsOf(insert as Call, 'insert')?.[0] as Record<string, unknown>
    expect(row.name).toBe('Integrating')
    expect(row.name_ar).toBe('التكامل')
    // The three flags are written explicitly rather than left to the column
    // defaults — createTrack's rule: this row is the whole row it means.
    expect(row.hidden).toBe(false)
    expect(row.terminal).toBe(false)
    expect(row.paused).toBe(false)
    expect(row.expected_days).toBe(30)
    expect(row.sort_order).toBe(7)
    expect(row.created_by).toBe(USER_ID)
  })

  it('defaults the threshold to null rather than inventing one', async () => {
    const api = await loadApi()
    answers = [{ data: null, error: null }, { data: { id: 'stage-2' }, error: null }]
    await api.createMapNodeStage({ name: 'Kickoff', nameAr: '' })

    const insert = callsTo('map_node_stages').find((c) => argsOf(c, 'insert') !== undefined)
    const row = argsOf(insert as Call, 'insert')?.[0] as Record<string, unknown>
    // 0003's SLA-off reasoning, and 0026's seed: a threshold nobody chose is a
    // number the app would then chase people with. Not 0, not 30 — null.
    expect(row.expected_days).toBeNull()
  })

  it('refuses an empty name without touching the network', async () => {
    const api = await loadApi()
    const result = await api.createMapNodeStage({ name: '   ', nameAr: '' })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('updateMapNodeStage', () => {
  it('keeps `undefined` and `null`/`false` apart', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'stage-1' }, error: null }]
    // `expectedDays: null` means "this rung has no expectation" and MUST reach
    // the row; `terminal: false` is a real value, not an absence; `name` is
    // untouched. A truthiness test would drop all three.
    await api.updateMapNodeStage('stage-1', { expectedDays: null, terminal: false, paused: false })

    const call = callsTo('map_node_stages')[0]
    const row = argsOf(call, 'update')?.[0] as Record<string, unknown>
    expect(row).toEqual({ expected_days: null, terminal: false, paused: false })
    expect('name' in row).toBe(false)
  })

  it('never sends the columns the server owns', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'stage-1' }, error: null }]
    await api.updateMapNodeStage('stage-1', { name: 'In build', nameAr: '' })

    const row = argsOf(callsTo('map_node_stages')[0], 'update')?.[0] as Record<string, unknown>
    // 0026's touch trigger pins `updated_at` back on a no-op, so a sent value
    // cannot corrupt the row — but a store that PATCHes the whole row it read
    // would be sending three columns the server owns, and the audit trail is
    // what fills up with rows recording that nothing happened.
    expect(Object.keys(row).sort()).toEqual(['name', 'name_ar'])
  })

  it('reads the row back rather than PATCHing nothing', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'stage-1' }, error: null }]
    await api.updateMapNodeStage('stage-1', {})

    const call = callsTo('map_node_stages')[0]
    // A no-op PATCH returns zero rows and `.single()` then errors on a request
    // that did nothing wrong — updateTrack's reasoning, verbatim.
    expect(names(call)).toContain('select')
    expect(names(call)).not.toContain('update')
  })
})

describe('setMapNodeStageHidden', () => {
  it('writes only `hidden`, in both directions', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'stage-1' }, error: null }]
    await api.setMapNodeStageHidden('stage-1', true)
    expect(argsOf(callsTo('map_node_stages')[0], 'update')?.[0]).toEqual({ hidden: true })

    calls = []
    answers = [{ data: { id: 'stage-1' }, error: null }]
    await api.setMapNodeStageHidden('stage-1', false)
    expect(argsOf(callsTo('map_node_stages')[0], 'update')?.[0]).toEqual({ hidden: false })
  })
})

describe('reorderMapNodeStages', () => {
  it('calls the RPC BY ARGUMENT NAME', async () => {
    const api = await loadApi()
    answers = [{ data: 3, error: null }]
    const result = await api.reorderMapNodeStages(['a', 'b', 'c'])

    // PostgREST resolves a function from the JSON body's KEYS. A drifted name is
    // a 404 the first time somebody drags a rung, months after both halves were
    // reviewed and found correct on their own — which is why 0026's probe 1 reads
    // `proargnames` and this test reads the key.
    expect(rpcCalls).toEqual([{ fn: 'reorder_map_node_stages', args: { p_ids: ['a', 'b', 'c'] } }])
    expect(result).toEqual({ ok: true, data: 3 })
  })

  it('makes no request for an empty drag', async () => {
    const api = await loadApi()
    const result = await api.reorderMapNodeStages([])
    expect(rpcCalls).toHaveLength(0)
    expect(result).toEqual({ ok: true, data: 0 })
  })

  it('turns the denial token into its own sentence', async () => {
    const api = await loadApi()
    answers = [
      {
        error: {
          code: '42501',
          message: 'map_node_stage_reorder_denied: structure.edit is required',
        },
      },
    ]
    const result = await api.reorderMapNodeStages(['a'])
    // Not the generic forbidden key: the ladder visibly did not move, and the
    // alternative to this sentence is a zero-row UPDATE reported as a successful
    // drag.
    expect(result).toEqual({ ok: false, error: 'mapadmin.errStageReorderDenied' })
  })
})

describe('getMapNodeStageUsage', () => {
  it('counts BOTH referencing tables before the click', async () => {
    const api = await loadApi()
    answers = [
      { count: 12, error: null },
      { count: 2, error: null },
    ]
    const result = await api.getMapNodeStageUsage('stage-1')

    expect(result).toEqual({ ok: true, data: { progress: 12, goals: 2 } })
    const [progress, goals] = calls
    expect(progress.table).toBe('map_node_progress')
    expect(argsOf(progress, 'select')?.[1]).toEqual({ head: true, count: 'exact' })
    expect(argsOf(progress, 'eq')).toEqual(['stage_id', 'stage-1'])
    expect(goals.table).toBe('map_node_goals')
    expect(argsOf(goals, 'eq')).toEqual(['stage_id', 'stage-1'])
  })

  it('answers 0 goals on a database without 0027 instead of failing the confirmation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const api = await loadApi()
    answers = [
      { count: 4, error: null },
      { error: { code: 'PGRST205', message: 'Could not find the table' } },
    ]
    const result = await api.getMapNodeStageUsage('stage-1')

    // A table that does not exist holds no goals, so 0 is the true answer — and
    // the confirmation still gets to say the number that matters.
    expect(result).toEqual({ ok: true, data: { progress: 4, goals: 0 } })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('deleteMapNodeStage', () => {
  it('reports what was pointing at the rung a moment before it went', async () => {
    const api = await loadApi()
    answers = [
      { count: 12, error: null },
      { count: 1, error: null },
      { data: null, error: null },
    ]
    const result = await api.deleteMapNodeStage('stage-1')

    // The counts do not exist afterwards, so they are read first — deleteMapNode's
    // contract. Neither of them blocks the delete: both FKs are `on delete set
    // null`, which is exactly why the numbers have to be said in advance.
    expect(result).toEqual({ ok: true, data: { progress: 12, goals: 1 } })
    const del = calls.find((c) => names(c).includes('delete'))
    expect(del?.table).toBe('map_node_stages')
    expect(argsOf(del as Call, 'eq')).toEqual(['id', 'stage-1'])
  })
})

describe('listMapNodeProgress', () => {
  it('asks for its columns by name and orders on the primary key', async () => {
    const api = await loadApi()
    await api.listMapNodeProgress()

    const call = callsTo('map_node_progress')[0]
    expect(argsOf(call, 'select')).toEqual([
      'node_id, stage_id, stage_changed_at, updated_at, updated_by',
    ])
    // `node_id` IS the primary key, so ordering on it alone is already total and
    // `.range()` cannot drop or duplicate a row.
    const ordered = call.ops.filter(([op]) => op === 'order').map(([, args]) => args[0])
    expect(ordered).toEqual(['node_id'])
  })

  it('reads zero rows as an answer, not as a failure', async () => {
    const api = await loadApi()
    const result = await api.listMapNodeProgress()
    // The day 0026 applies, this is what 400 organizations look like: nobody has
    // said anything yet. It is the first number the directors ask for.
    expect(result).toEqual({ ok: true, data: { rows: [], truncated: false } })
  })
})

describe('setNodeStage', () => {
  it('UPSERTS on node_id and sends nothing the server owns', async () => {
    const api = await loadApi()
    answers = [{ data: { node_id: 'n1', stage_id: 's1' }, error: null }]
    await api.setNodeStage('n1', 's1')

    const call = callsTo('map_node_progress')[0]
    const [row, options] = argsOf(call, 'upsert') as [Record<string, unknown>, unknown]
    // ⚠ THE ONE ASSERTION THIS FILE EXISTS FOR. `node_id` is the primary key, so
    //   a plain `.insert()` against an organization that already has a progress
    //   row raises 23505 — two account managers on the portfolio at once, the
    //   second one's 30-second refetch not yet landed.
    expect(names(call)).toContain('upsert')
    expect(names(call)).not.toContain('insert')
    expect(options).toEqual({ onConflict: 'node_id' })
    // Exactly two keys. `stage_changed_at`, `updated_at` and `updated_by` are
    // server-written and a client value is OVERRULED rather than rejected — the
    // failure that reads as working, which is why this is an equality and not a
    // "contains".
    expect(Object.keys(row).sort()).toEqual(['node_id', 'stage_id'])
    expect(row).toEqual({ node_id: 'n1', stage_id: 's1' })
  })

  it('upserts a NULL stage rather than deleting the row', async () => {
    const api = await loadApi()
    answers = [{ data: { node_id: 'n1', stage_id: null }, error: null }]
    await api.setNodeStage('n1', null)

    const call = callsTo('map_node_progress')[0]
    // "Somebody looked and cleared it" is a DIFFERENT fact from "nobody has said
    // anything yet", and only a row can carry the first. Deleting here would
    // destroy the distinction the whole no-backfill decision rests on.
    expect(argsOf(call, 'upsert')?.[0]).toEqual({ node_id: 'n1', stage_id: null })
    expect(names(call)).not.toContain('delete')
  })

  it('names the pkey collision precisely if it ever arrives anyway', async () => {
    const api = await loadApi()
    answers = [
      {
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "map_node_progress_pkey"',
        },
      },
    ]
    const result = await api.setNodeStage('n1', 's1')
    expect(result).toEqual({ ok: false, error: 'mapadmin.errStageAlreadyRecorded' })
  })
})

describe('deleteNodeProgress', () => {
  it('DELETES the row rather than upserting a null, and matches on the key alone', async () => {
    const api = await loadApi()
    answers = [{ data: null, error: null }]
    const result = await api.deleteNodeProgress('n1')

    const call = callsTo('map_node_progress')[0]
    // The whole reason this verb exists beside `setNodeStage`: an upsert of
    // `stage_id: null` writes "somebody looked and cleared it", which is a fact
    // nobody stated. Only a delete returns the node to "nobody has said".
    expect(names(call)).toContain('delete')
    expect(names(call)).not.toContain('upsert')
    expect(names(call)).not.toContain('insert')
    expect(argsOf(call, 'eq')).toEqual(['node_id', 'n1'])
    // No `select()`: there is no row to hand back, so the caller retracts rather
    // than publishes.
    expect(names(call)).not.toContain('select')
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('reads a delete that matched nothing as success, not as a failure', async () => {
    const api = await loadApi()
    // PostgREST's answer to a `delete` matching zero rows: 204, no error. Two
    // tabs undoing the same first-ever stage must both end at "nobody has said".
    answers = [{ data: [], error: null }]
    expect(await api.deleteNodeProgress('n1')).toEqual({ ok: true, data: undefined })
  })

  it('maps a refusal to an i18n key instead of Postgres English', async () => {
    const api = await loadApi()
    answers = [{ error: { code: '42501', message: 'permission denied for table' } }]
    expect(await api.deleteNodeProgress('n1')).toEqual({
      ok: false,
      error: 'admin.errForbidden',
    })
  })
})
