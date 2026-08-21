// Commitments about a node — "40 organizations beneath this Phase are Live by
// 31 December" (0027).
//
// ITS OWN MODULE, WHERE THE STAGE LADDER IS A SECTION OF api/map.ts, and the
// split is the permission sentence rather than a filing preference:
//
//   Shape and commitments are the owner's; where-we-got-to is the team's.
//
// `map_node_stages` and `map_node_progress` are two halves of ONE question (what
// the rungs are, and which rung a node stands on), so they share a file. A GOAL
// is the other half of a different sentence — where a department is SUPPOSED to
// have got to — written by the two Associate Directors, gated on
// `has_perm('structure.edit')`, and AUDITED, which nothing in the progress half
// is. A reader who opens this file is asking about promises, not about progress.
//
// ── EVERY READ HERE FAILS CLOSED AND QUIET UNTIL 0027 IS APPLIED ───────────
//
// `map_node_goals` is absent from the live database as this ships, so `listGoals`
// answers 42P01 (PostgREST: `PGRST205`) on every call until the owner runs the
// migration. `pgErrorKey` maps that to `common.errMissingTable`, and the caller's
// contract is to render it as the EMPTY state rather than as an error — a panel
// that shouts "could not load goals" at an AD who has never created one is
// reporting the absence of a feature as a fault. `MapBranchGoals` in
// MapBranchDetail.tsx is that caller, and the rule is written down at its
// `MISSING_TABLE` constant. Nothing in this file throws, toasts or latches.
//
// ── SERVER-OWNED COLUMNS ARE NEVER SENT ────────────────────────────────────
//
// `created_at`, `updated_at`, `created_by` and `updated_by` belong to 0027's
// stamp and touch triggers. `map_node_goals_stamp()` OVERRULES a client value
// rather than rejecting it, so a write that carries one reads as working and is
// not — the same failure mode api/map.ts's stage section names, and the reason
// neither the insert nor the patch below builds a row from a whole record.
//
// ── THE TOKEN CONTRACT ─────────────────────────────────────────────────────
//
// Errors leave as i18n keys, never as sentences (api/map.ts's rule verbatim):
// `mapadmin.errGoalTarget`, `mapadmin.errGoalLabelLength`,
// `mapadmin.errGoalLabelArLength`, `mapadmin.errNotFound`. Those arms are already
// in lib/pgError.ts and they match 0027's `raise` tokens and constraint names —
// renaming one on either side silently demotes a precise sentence to
// `common.error`, which is why the migration's header lists them and this
// paragraph points at it rather than restating the list.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { chunkIds, fetchAllPages } from './paging'
import { pgErrorKey } from '../lib/pgError'
// The two row/input shapes live in src/types.ts beside `MapNodeStageInput` and
// `MapNodeOpenCounts` — 0027's other half — so every shape this schema answers
// with is found in one file. Re-exported because this module is where a screen
// looks for them.
import type { MapNodeGoal, MapNodeGoalInput } from '../types'
// TYPE-ONLY, so api/entries.ts's doctrine comment stays the one place `Loaded<T>`
// is explained and this module gains no runtime coupling to the entries loader.
// api/map.ts imports it the same way and for the same reason.
import type { Loaded } from './entries'

export type { MapNodeGoal, MapNodeGoalInput }

/**
 * How many `.range()` pages one read may walk.
 *
 * A SECOND COPY of api/map.ts's constant rather than an import, on the same
 * judgement that file makes about `PAGE_SIZE`: five pages is 5,000 goals, which
 * is three orders of magnitude past a workspace that will hold tens of them, and
 * the cap exists to stop a runaway loop rather than to bound a real answer. A
 * shared constant would couple two modules for one integer whose right value is
 * a property of each read.
 */
const MAX_PAGES = 5

/**
 * The maximum length of either label, enforced HERE FIRST.
 *
 * 60, and it must agree with `map_node_goals_label_len_chk` /
 * `map_node_goals_label_ar_len_chk` in 0027 — 0026's `STAGE_NAME_MAX = 40` has
 * the same contract with the stages screen. The database is the guarantee; this
 * is the sentence, because what the CHECK produces is a bare
 * `23514 … violates check constraint "map_node_goals_label_ar_len_chk"` in front
 * of an Arabic-only reader on a form with TWO label fields.
 *
 * A goal label goes over 60 when somebody PASTES a phrase out of a planning
 * deck, which is a thing ADs do — so the editor carries it as a `maxLength` and
 * the writes below refuse it before a round trip.
 */
export const GOAL_LABEL_MAX = 60

/**
 * The columns every goal read asks for, by name.
 *
 * NAMED RATHER THAN `*`, api/map.ts's `LINK_COLUMNS` / `PROGRESS_COLUMNS`
 * precedent: `MapNodeGoal` cannot drift from the query when the table gains a
 * column, and a rename on the SQL side surfaces as a failed read rather than as a
 * field that is silently `undefined` inside a sentence an AD is reading.
 */
const GOAL_COLUMNS =
  'id, node_id, label, label_ar, stage_id, target, target_date, created_at, updated_at, created_by, updated_by'

/**
 * Every label the client refuses before the round trip.
 *
 * Returns the error key, or null when the labels are fine. Length only: `''` is
 * legal on both sides (an unnamed goal is a goal) and the database does not
 * btrim before measuring, so neither does this — `'   '` is a label the AD can
 * see and fix, and silently rewriting what somebody typed is worse than showing
 * it back to them.
 */
function labelProblem(label: string, labelAr: string): string | null {
  if (label.length > GOAL_LABEL_MAX) return 'mapadmin.errGoalLabelLength'
  if (labelAr.length > GOAL_LABEL_MAX) return 'mapadmin.errGoalLabelArLength'
  return null
}

/**
 * The goals on a set of nodes, or every goal in the workspace.
 *
 * ⚠ `undefined` AND `[]` ARE DIFFERENT QUESTIONS AND THE DIFFERENCE IS THE POINT.
 *   `listGoals()` asks for the whole table — the portfolio's "what is due this
 *   quarter", which is the read `map_node_goals_date_idx` exists for.
 *   `listGoals([])` asks for the goals of no nodes, which is answered with an
 *   empty, untruncated result and NO REQUEST: `.in('node_id', [])` is a round
 *   trip spent proving what the caller already knew. `listNodeUseCasesFor`'s rule
 *   one table over, and a filter that matched nothing must not read as "every
 *   goal in the workspace" — that is the one way this signature can produce a
 *   wrong screen rather than an empty one.
 *
 * CHUNKED FOR THE SAME REASON THE LINKS ARE: the filter travels in the query
 * string, and 400 uuids in one `.in()` is a ~15KB URL a proxy rejects before
 * Postgres ever sees it. `ID_CHUNK` and its arithmetic live in api/paging.ts.
 *
 * PAGED ON A TABLE THAT WILL HOLD TENS OF ROWS, `listMapNodeStages`' judgement:
 * "small enough that there is no paging question" is a claim about today's data
 * written into a function that outlives it. `target_date` then `id` because
 * `.range()` needs a TOTAL order — several goals share one date by design, so
 * the date alone would let a page boundary drop or repeat a row.
 *
 * A FAILED CHUNK FAILS THE WHOLE READ. The caller asked one question — "the goals
 * on these nodes" — and a partial answer to it is partial however few of its
 * pieces were clipped; `truncated` is reserved for the one thing it means, which
 * is that the cap stopped the walk with rows still on the server.
 */
export async function listGoals(
  nodeIds?: readonly string[],
): Promise<ApiResult<Loaded<MapNodeGoal>>> {
  if (!supabase) return notConfigured()
  const client = supabase

  // THE FILTER GOES ON BEFORE THE ORDER AND THE RANGE, and not as a style
  // choice: postgrest-js's `.order()`/`.range()` answer a TransformBuilder,
  // which no longer carries `.in()`. Written the other way round this is a type
  // error at best and, in a JS call site, a filter silently dropped from a read
  // that then returns every goal in the workspace.
  const page = (chunk: string[] | null) =>
    fetchAllPages<MapNodeGoal>((from, to) => {
      const base = client.from('map_node_goals').select(GOAL_COLUMNS)
      const filtered = chunk === null ? base : base.in('node_id', chunk)
      return filtered
        .order('target_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    }, MAX_PAGES)

  if (nodeIds === undefined) return await page(null)

  const rows: MapNodeGoal[] = []
  let truncated = false
  for (const chunk of chunkIds(nodeIds)) {
    const result = await page(chunk)
    if (!result.ok) return result
    rows.push(...result.data.rows)
    truncated = truncated || result.data.truncated
  }
  return { ok: true, data: { rows, truncated } }
}

/**
 * Make a commitment.
 *
 * THE WHOLE ROW IS SENT, `createMapNodeStage`'s rule: `stage_id` and `target` go
 * out explicitly even when null, because a column default is the same answer only
 * for as long as the default stays put, and here the two nulls are the goal's
 * MEANING rather than an absence of one.
 *
 * `created_by` IS NOT SENT. 0026's stage insert sends it and 0027's does not, and
 * the difference is 0027's own: `map_node_goals_stamp()` resolves the author
 * through `profiles` on the server, so a client value would be overwritten in the
 * same statement. Sending it would be a write nobody made appearing in the audit
 * row that answers "who moved the date".
 *
 * The target is refused HERE as well as by the trigger and the CHECK, and all
 * three are wanted: 0 and -3 are typos rather than goals, a goal of 0 reads as
 * permanently met, and the client that refuses it first is the one that can say
 * so in the reader's language without a round trip.
 */
export async function createGoal(input: MapNodeGoalInput): Promise<ApiResult<MapNodeGoal>> {
  if (!supabase) return notConfigured()

  const problem = labelProblem(input.label, input.labelAr)
  if (problem !== null) return fail(problem)
  if (input.target !== null && input.target <= 0) return fail('mapadmin.errGoalTarget')

  const { data, error } = await supabase
    .from('map_node_goals')
    .insert({
      node_id: input.nodeId,
      label: input.label,
      label_ar: input.labelAr,
      stage_id: input.stageId,
      target: input.target,
      target_date: input.targetDate,
    })
    .select(GOAL_COLUMNS)
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as unknown as MapNodeGoal }
}

/**
 * Move the date, rename the promise, or change what it counts.
 *
 * UNDEFINED KEYS ARE LEFT UNTOUCHED AND EXPLICIT NULLS ARE INSTRUCTIONS —
 * `updateMapNodeStage`'s `expectedDays` lesson, with two fields that can carry it
 * instead of one: `{ stageId: null }` says "this goal is about a terminal stage",
 * `{ target: null }` says "this is a date goal about the node itself", and
 * leaving either key off says "do not touch it". A truthiness test would collapse
 * all three into a silent no-op.
 *
 * `nodeId` IS PATCHABLE IN THE TYPE AND IS NEVER SENT. Moving a goal to another
 * node is not an edit, it is a different commitment about a different department,
 * and the audit row would read as a rename. `Partial<MapNodeGoalInput>` is the
 * honest shape for the other five fields; this line is what makes the sixth
 * inert, and it is a line rather than a narrowed type so the input type stays one.
 *
 * A NO-OP PATCH RE-READS RATHER THAN WRITING. `.update({})` returns zero rows and
 * `.single()` then errors on a request that did nothing wrong — updateTrack's
 * reasoning, verbatim.
 */
export async function updateGoal(
  id: string,
  input: Partial<MapNodeGoalInput>,
): Promise<ApiResult<MapNodeGoal>> {
  if (!supabase) return notConfigured()

  const problem = labelProblem(input.label ?? '', input.labelAr ?? '')
  if (problem !== null) return fail(problem)
  if (input.target !== undefined && input.target !== null && input.target <= 0) {
    return fail('mapadmin.errGoalTarget')
  }

  const row: Record<string, unknown> = {}
  if (input.label !== undefined) row.label = input.label
  if (input.labelAr !== undefined) row.label_ar = input.labelAr
  if (input.stageId !== undefined) row.stage_id = input.stageId
  if (input.target !== undefined) row.target = input.target
  if (input.targetDate !== undefined) row.target_date = input.targetDate

  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase
      .from('map_node_goals')
      .select(GOAL_COLUMNS)
      .eq('id', id)
      .single()
    if (error) return fail(pgErrorKey(error))
    return { ok: true, data: data as unknown as MapNodeGoal }
  }

  const { data, error } = await supabase
    .from('map_node_goals')
    .update(row)
    .eq('id', id)
    .select(GOAL_COLUMNS)
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as unknown as MapNodeGoal }
}

/**
 * Withdraw a commitment.
 *
 * NO USAGE COUNT BEFORE IT, unlike `deleteMapNode` and `deleteMapNodeStage`.
 * Those two are asked "what would this cost" because rows elsewhere point AT
 * them; nothing anywhere references a goal, so the only thing a delete destroys
 * is the goal itself — which the confirmation names, in the reader's language,
 * from the row already on screen. A head-count round trip could only ever
 * answer 0.
 *
 * The row it removes is not lost to the record: 0027's audit trigger writes the
 * whole `old` into `config_audit` on the way out, which is the difference between
 * this table and `map_node_progress` and the reason "who withdrew the promise" is
 * answerable at all.
 */
export async function deleteGoal(id: string): Promise<ApiResult<void>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('map_node_goals').delete().eq('id', id)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: undefined }
}
