// The REQUEST SHAPES of api/goals.ts (0027), pinned against a recording fake of
// the PostgREST builder.
//
// WHAT THIS FILE IS FOR, and it is api/map.test.ts's paragraph one table over:
// every assertion here is about something the type checker cannot see and the
// migration cannot check from its side — a table name, the exact set of keys in a
// written row, whether a filter was applied at all, and the difference between
// "no nodes" and "every node". All of them fail SILENTLY in production. The worst
// of them is the last: `listGoals([])` that forgot its filter answers with every
// goal in the workspace, which renders as a plausible panel full of other
// departments' commitments and nothing on screen says so.
//
// The fake is api/map.test.ts's, widened with `.in()` — the one operation this
// module uses that the stage half does not.

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** One `.from()` chain, as the fake client saw it. */
interface Call {
  table: string
  ops: [string, unknown[]][]
}

/** What the next awaited chain resolves with. PostgREST's own envelope. */
interface Answer {
  data?: unknown
  error?: unknown
}

let calls: Call[] = []
let answers: Answer[] = []

/** The answer for the next awaited chain; the last one repeats once the queue empties. */
let fallback: Answer = { data: [], error: null }

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
    delete: record('delete'),
    eq: record('eq'),
    in: record('in'),
    order: record('order'),
    range: record('range'),
    single: record('single'),
    then: (onfulfilled?: (v: unknown) => unknown) => {
      call.ops.push(['then', []])
      const answer = nextAnswer()
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(
        onfulfilled,
      )
    },
  }
  return builder
}

const fakeClient = {
  from: (table: string) => makeBuilder(table),
  auth: {
    getUser: () =>
      Promise.resolve({ data: { user: { id: 'e3b0c442-0000-4000-8000-000000000001' } } }),
  },
}

/**
 * A fresh copy of the module bound to the fake client. `supabase` is a const
 * binding captured at import, so switching it means re-importing — hence doMock
 * (not hoisted) plus resetModules.
 */
async function loadApi(): Promise<typeof import('./goals')> {
  vi.resetModules()
  vi.doMock('./supabase', () => ({ supabase: fakeClient, isConfigured: () => true }))
  return await import('./goals')
}

/** The args a chain passed to one builder method, or undefined if never called. */
function argsOf(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([op]) => op === name)?.[1]
}

function names(call: Call): string[] {
  return call.ops.map(([op]) => op)
}

/** Every chain against the goals table, in order. */
function goalCalls(): Call[] {
  return calls.filter((c) => c.table === 'map_node_goals')
}

/** The id list one chain's `.in('node_id', …)` carried, or none. */
function inChunk(call: Call): string[] {
  const args = argsOf(call, 'in')
  return args === undefined ? [] : (args[1] as string[])
}

/** A page of rows the walker will read as FULL, so the next page is asked for. */
function fullPage(): { data: unknown[]; error: null } {
  return { data: Array.from({ length: 1000 }, (_, i) => ({ id: `g${i}` })), error: null }
}

const NODE = 'e3b0c442-0000-4000-8000-0000000000aa'

beforeEach(() => {
  calls = []
  answers = []
  fallback = { data: [], error: null }
})

describe('listGoals', () => {
  it('asks for the whole table when it is handed no nodes at all', async () => {
    const api = await loadApi()
    const result = await api.listGoals()

    expect(result.ok).toBe(true)
    const call = goalCalls()[0]
    expect(call).toBeDefined()
    // NO FILTER. `listGoals()` is the portfolio's "what is due this quarter",
    // which is the read map_node_goals_date_idx exists for.
    expect(names(call)).not.toContain('in')
    // Named columns, never `*`: a rename on the SQL side has to surface as a
    // failed read rather than as a field that is silently undefined inside a
    // sentence an AD is reading.
    expect(String(argsOf(call, 'select')?.[0])).toContain('target_date')
    expect(String(argsOf(call, 'select')?.[0])).not.toBe('*')
  })

  it('orders on a TOTAL key, because several goals share one date by design', async () => {
    const api = await loadApi()
    await api.listGoals()

    const ordered = goalCalls()[0]
    const keys = ordered.ops.filter(([op]) => op === 'order').map(([, args]) => args[0])
    // `target_date` alone is not a total order — two goals with one date and two
    // rungs describe one ramp at two altitudes (0027 ships no unique index on
    // purpose) — so a page boundary landing inside a tie would drop a row from
    // one page and repeat it on the other. `id` is the tiebreak.
    expect(keys).toEqual(['target_date', 'id'])
    expect(argsOf(ordered, 'range')).toEqual([0, 999])
  })

  it('filters to the nodes it was given', async () => {
    const api = await loadApi()
    await api.listGoals([NODE])

    const call = goalCalls()[0]
    expect(argsOf(call, 'in')).toEqual(['node_id', [NODE]])
    // The filter has to be applied BEFORE the transforms: postgrest-js's
    // `.order()`/`.range()` answer a TransformBuilder that no longer carries
    // `.in()`, so the other order is a filter that never reaches the server.
    expect(names(call).indexOf('in')).toBeLessThan(names(call).indexOf('range'))
  })

  it('cuts a big filter into chunks rather than posting a 15KB query string', async () => {
    const api = await loadApi()
    // 200 ids is past ID_CHUNK (150), so it must arrive as two requests.
    const ids = Array.from({ length: 200 }, (_, i) => `node-${i}`)
    const result = await api.listGoals(ids)

    expect(result.ok).toBe(true)
    expect(goalCalls()).toHaveLength(2)
    expect(inChunk(goalCalls()[0])).toHaveLength(150)
    expect(inChunk(goalCalls()[1])).toHaveLength(50)
  })

  it('answers an empty node list with nothing, and makes NO request', async () => {
    const api = await loadApi()
    const result = await api.listGoals([])

    // THE ASSERTION THIS FILE EXISTS FOR. `[]` and `undefined` are different
    // questions: a filter that matched no organizations must not read as "every
    // goal in the workspace", which is the one way this signature can produce a
    // wrong screen rather than an empty one.
    expect(result).toEqual({ ok: true, data: { rows: [], truncated: false } })
    expect(calls).toHaveLength(0)
  })

  it('reports truncation rather than reporting success on a clipped read', async () => {
    const api = await loadApi()
    fallback = fullPage()
    const result = await api.listGoals()

    // Five full pages: the cap stopped the walk with a full page in hand, which
    // is exactly what `truncated` means. A workspace cannot really hold 5,000
    // goals; the paging is here so that the day one does, the screen says so.
    expect(result.ok && result.data.truncated).toBe(true)
    expect(goalCalls()).toHaveLength(5)
  })

  it('or-s the verdict across chunks, so one clipped chunk clips the answer', async () => {
    const api = await loadApi()
    const ids = Array.from({ length: 200 }, (_, i) => `node-${i}`)
    // The first chunk fills five pages; the second answers short. The caller
    // asked ONE question and a partial answer to it is partial however few of
    // its pieces were clipped.
    answers = [fullPage(), fullPage(), fullPage(), fullPage(), fullPage(), { data: [] }]
    const result = await api.listGoals(ids)

    expect(result.ok && result.data.truncated).toBe(true)
  })

  it('fails the whole read when a chunk fails, rather than reporting truncation', async () => {
    const api = await loadApi()
    const ids = Array.from({ length: 200 }, (_, i) => `node-${i}`)
    answers = [{ data: [] }, { error: { code: '42501', message: 'permission denied' } }]
    const result = await api.listGoals(ids)

    // "Some rows are missing because the workspace is big" and "the read failed"
    // are two different sentences on screen, and they must not be told apart by
    // whether the caller happened to look at a flag.
    expect(result.ok).toBe(false)
  })

  it('maps the pre-migration state to a key the panel can render as empty', async () => {
    const api = await loadApi()
    // 0027 has not been applied, so the table is not in PostgREST's schema
    // cache. The caller must get a KEY it can recognise — `common.errMissingTable`
    // is what MapBranchGoals renders as "no goals yet", never as a red banner.
    answers = [{ error: { code: 'PGRST205', message: 'Could not find the table' } }]
    const result = await api.listGoals([NODE])

    expect(result).toEqual({ ok: false, error: 'common.errMissingTable' })
  })
})

describe('createGoal', () => {
  const input = {
    nodeId: NODE,
    label: 'Phase 2 go-live',
    labelAr: '',
    stageId: null,
    target: 40,
    targetDate: '2026-12-31',
  }

  it('sends the whole row it means, including the nulls that ARE the meaning', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    await api.createGoal({ ...input, stageId: null })

    const row = argsOf(goalCalls()[0], 'insert')?.[0] as Record<string, unknown>
    expect(row.node_id).toBe(NODE)
    expect(row.label).toBe('Phase 2 go-live')
    expect(row.label_ar).toBe('')
    // `stage_id: null` is not an absence: it says "a terminal stage", which is
    // the commonest goal there is. Left off the row it would be the column
    // default saying the same thing only for as long as the default stays put.
    expect('stage_id' in row).toBe(true)
    expect(row.stage_id).toBeNull()
    expect(row.target).toBe(40)
    expect(row.target_date).toBe('2026-12-31')
  })

  it('never sends the columns 0027 stamps', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    await api.createGoal(input)

    const row = argsOf(goalCalls()[0], 'insert')?.[0] as Record<string, unknown>
    // `map_node_goals_stamp()` resolves the author through `profiles` and
    // OVERRULES a client value rather than rejecting it — so a sent `created_by`
    // reads as working and is not, and the audit row that answers "who moved the
    // date" is the thing it would corrupt.
    expect(Object.keys(row).sort()).toEqual([
      'label',
      'label_ar',
      'node_id',
      'stage_id',
      'target',
      'target_date',
    ])
  })

  it('refuses a target of zero without touching the network', async () => {
    const api = await loadApi()
    const result = await api.createGoal({ ...input, target: 0 })

    // A goal of 0 reads as permanently met. The CHECK and the trigger both
    // refuse it too; this is the one that can say so in the reader's own
    // language without a round trip.
    expect(result).toEqual({ ok: false, error: 'mapadmin.errGoalTarget' })
    expect(calls).toHaveLength(0)
  })

  it('lets a null target through, because a date goal is not a zero', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    const result = await api.createGoal({ ...input, target: null })

    expect(result.ok).toBe(true)
    const row = argsOf(goalCalls()[0], 'insert')?.[0] as Record<string, unknown>
    expect(row.target).toBeNull()
  })

  it('refuses each over-long label under its OWN key', async () => {
    const api = await loadApi()
    const long = 'x'.repeat(api.GOAL_LABEL_MAX + 1)

    // TWO KEYS, NOT ONE, and the form has two label fields: told only that "a
    // label is too long", an Arabic-only reader cannot see which of the two to
    // fix. 0027's header requires the arms to be two for exactly this reason.
    expect(await api.createGoal({ ...input, label: long })).toEqual({
      ok: false,
      error: 'mapadmin.errGoalLabelLength',
    })
    expect(await api.createGoal({ ...input, labelAr: long })).toEqual({
      ok: false,
      error: 'mapadmin.errGoalLabelArLength',
    })
    expect(calls).toHaveLength(0)
  })

  it('accepts a label of exactly the maximum, so the boundary is not off by one', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    const result = await api.createGoal({ ...input, label: 'x'.repeat(api.GOAL_LABEL_MAX) })

    // `char_length(label) <= 60` is the CHECK. A client that refused 60 would
    // disagree with the database about a value the database accepts, which is
    // the direction that produces "it saved yesterday" bug reports.
    expect(result.ok).toBe(true)
  })
})

describe('updateGoal', () => {
  it('keeps `undefined` and `null` apart on both nullable columns', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    // `stageId: null` says "this goal is about a terminal stage" and
    // `target: null` says "this is a date goal about the node itself". Both are
    // instructions. `label` is untouched and must not appear.
    await api.updateGoal('goal-1', { stageId: null, target: null })

    const row = argsOf(goalCalls()[0], 'update')?.[0] as Record<string, unknown>
    expect(row).toEqual({ stage_id: null, target: null })
    expect('label' in row).toBe(false)
  })

  it('never moves a goal to another node, whatever it is handed', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    await api.updateGoal('goal-1', { nodeId: 'some-other-node', label: 'Renamed' })

    const row = argsOf(goalCalls()[0], 'update')?.[0] as Record<string, unknown>
    // Moving a goal is not an edit — it is a different commitment about a
    // different department — and the audit row would read as a rename.
    expect(row).toEqual({ label: 'Renamed' })
  })

  it('never sends the columns the server owns', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    await api.updateGoal('goal-1', { targetDate: '2027-03-31' })

    const row = argsOf(goalCalls()[0], 'update')?.[0] as Record<string, unknown>
    expect(Object.keys(row)).toEqual(['target_date'])
  })

  it('reads the row back rather than PATCHing nothing', async () => {
    const api = await loadApi()
    answers = [{ data: { id: 'goal-1' }, error: null }]
    const result = await api.updateGoal('goal-1', {})

    // `.update({})` returns zero rows and `.single()` then errors on a request
    // that did nothing wrong — updateTrack's reasoning, verbatim.
    expect(result.ok).toBe(true)
    expect(names(goalCalls()[0])).not.toContain('update')
    expect(names(goalCalls()[0])).toContain('select')
  })

  it('refuses an over-long label before the round trip, exactly as create does', async () => {
    const api = await loadApi()
    const result = await api.updateGoal('goal-1', { labelAr: 'ء'.repeat(api.GOAL_LABEL_MAX + 1) })

    expect(result).toEqual({ ok: false, error: 'mapadmin.errGoalLabelArLength' })
    expect(calls).toHaveLength(0)
  })
})

describe('deleteGoal', () => {
  it('deletes by id and asks for no usage count first', async () => {
    const api = await loadApi()
    const result = await api.deleteGoal('goal-1')

    expect(result.ok).toBe(true)
    // Nothing anywhere references a goal, so the only thing this destroys is the
    // goal itself — which the confirmation names from the row already on screen.
    // deleteMapNode's and deleteMapNodeStage's head-count probes could only ever
    // answer 0 here, and one round trip is what they would cost.
    expect(calls).toHaveLength(1)
    expect(names(goalCalls()[0])).toContain('delete')
    expect(argsOf(goalCalls()[0], 'eq')).toEqual(['id', 'goal-1'])
  })

  it('maps a refusal to an i18n key instead of Postgres English', async () => {
    const api = await loadApi()
    // A member — an account manager — is not a Director: writes are gated on
    // has_perm('structure.edit'), so RLS refuses this one. The UI hides the
    // control, and this is what happens when a stale tab still shows it.
    answers = [{ error: { code: '42501', message: 'permission denied for table' } }]
    const result = await api.deleteGoal('goal-1')

    expect(result).toEqual({ ok: false, error: 'admin.errForbidden' })
  })
})
