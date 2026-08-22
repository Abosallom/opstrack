// The PMO portfolio's reads and writes — 0031's eight tables and one view.
//
// ── ONE FACTORY, NOT EIGHT COPIES ─────────────────────────────────────────
//
// Every table in this family has the identical shape: a uuid key, `source` +
// `external_ref`, the four provenance columns, and rows a screen lists, creates,
// patches and deletes. Written out longhand that is thirty-two near-identical
// functions, which is exactly where one wrong table name or one missing
// `pgErrorKey` hides — 0031's own policy block makes this argument in SQL and
// this file makes it in TypeScript.
//
// So there is one `table<T>()` and eight calls to it. What each table does
// DIFFERENTLY — the ordering a screen wants, the filter it applies — is stated
// per table below and nowhere else.
//
// ── ERRORS ARE i18n KEYS, NEVER SENTENCES ─────────────────────────────────
//
// `pgErrorKey()` maps a Postgres error to a key the UI translates. A caller
// does `toast(t(result.error))` and gets a sentence in the reader's language;
// a raw `error.message` would put "duplicate key value violates unique
// constraint pmo_revenue_project_id_year_quarter_key" on a director's screen.
//
// ── WHAT THIS FILE DOES NOT DO ────────────────────────────────────────────
//
// It computes nothing. No variance, no roll-up, no days-remaining. Those live
// in `lib/pmo/summary.ts`, which is pure and takes its clock as an argument —
// the rule this codebase holds so that every number on the screen can be pinned
// by a test.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
import type {
  PmoAction,
  PmoInitiative,
  PmoKeyResult,
  PmoMilestone,
  PmoObjective,
  PmoObjectiveProgress,
  PmoProject,
  PmoRevenueLine,
  PmoRisk,
} from '../types'

/**
 * The columns every read asks for.
 *
 * `*` RATHER THAN A LIST, and it is a deliberate exception to this codebase's
 * usual habit. These tables are narrow, every column is rendered somewhere, and
 * a hand-kept list is a second definition of the row that drifts the first time
 * 0032 adds a field — the failure being a column that silently arrives as
 * `undefined` in a component that types it as present.
 */
const ALL = '*'

interface TableApi<Row, Input> {
  list: () => Promise<ApiResult<Row[]>>
  create: (input: Input) => Promise<ApiResult<Row>>
  update: (id: string, input: Partial<Input>) => Promise<ApiResult<Row>>
  remove: (id: string) => Promise<ApiResult<void>>
}

/**
 * The four verbs, for one table.
 *
 * `order` is the shape the SCREEN wants rather than the database's insertion
 * order: a list that reorders itself between visits is a list nobody builds
 * muscle memory on.
 */
function table<Row, Input extends Record<string, unknown>>(
  name: string,
  order: { column: string; ascending?: boolean },
): TableApi<Row, Input> {
  return {
    async list(): Promise<ApiResult<Row[]>> {
      if (!supabase) return notConfigured()
      const { data, error } = await supabase
        .from(name)
        .select(ALL)
        .order(order.column, { ascending: order.ascending ?? true })
      if (error) return fail(pgErrorKey(error))
      return { ok: true, data: (data ?? []) as Row[] }
    },

    async create(input): Promise<ApiResult<Row>> {
      if (!supabase) return notConfigured()
      // `created_by` is NOT sent: 0031's `pmo_stamp()` trigger writes it from
      // `auth.uid()`. A client-supplied value would be overruled, and sending
      // one reads as working while proving nothing.
      const { data, error } = await supabase.from(name).insert(input).select(ALL).single()
      if (error) return fail(pgErrorKey(error))
      return { ok: true, data: data as Row }
    },

    async update(id, input): Promise<ApiResult<Row>> {
      if (!supabase) return notConfigured()
      // A no-op PATCH comes back with zero rows and `.single()` then errors on a
      // request that did nothing wrong — api/map.ts's `updateMapNode` states the
      // same hazard. Refusing an empty patch here is cheaper than reading back.
      if (Object.keys(input).length === 0) {
        const { data, error } = await supabase.from(name).select(ALL).eq('id', id).single()
        if (error) return fail(pgErrorKey(error))
        return { ok: true, data: data as Row }
      }
      const { data, error } = await supabase
        .from(name)
        // The cast is the one supabase-js's generated types cannot express for a
        // generic table name: `Partial<Input>` is exactly what a PATCH takes, and
        // the client's `RejectExcessProperties` guard is written against a
        // concrete row type this factory deliberately does not have.
        .update(input as Record<string, unknown>)
        .eq('id', id)
        .select(ALL)
        .single()
      if (error) return fail(pgErrorKey(error))
      return { ok: true, data: data as Row }
    },

    async remove(id): Promise<ApiResult<void>> {
      if (!supabase) return notConfigured()
      const { error } = await supabase.from(name).delete().eq('id', id)
      if (error) return fail(pgErrorKey(error))
      return { ok: true, data: undefined }
    },
  }
}

/* ─────────────────────────── the eight tables ──────────────────────────── */

/** Projects, newest commitment first — `start_date` is what a reader scans. */
export const projects = table<PmoProject, Record<string, unknown>>('pmo_projects', {
  column: 'start_date',
  ascending: true,
})

export const initiatives = table<PmoInitiative, Record<string, unknown>>('pmo_initiatives', {
  column: 'start_date',
  ascending: true,
})

/**
 * Actions by DUE DATE. The huddle reads this list top-down asking "what is late"
 * and the answer has to be at the top; `created_at` would put the oldest
 * unfinished thought there instead.
 */
export const actions = table<PmoAction, Record<string, unknown>>('pmo_actions', {
  column: 'due_date',
  ascending: true,
})

export const risks = table<PmoRisk, Record<string, unknown>>('pmo_risks', {
  column: 'created_at',
  ascending: false,
})

/** Revenue in quarter order, so the Q1..Q4 columns read left to right. */
export const revenue = table<PmoRevenueLine, Record<string, unknown>>('pmo_revenue', {
  column: 'quarter',
  ascending: true,
})

export const objectives = table<PmoObjective, Record<string, unknown>>('pmo_objectives', {
  column: 'created_at',
  ascending: true,
})

export const keyResults = table<PmoKeyResult, Record<string, unknown>>('pmo_key_results', {
  column: 'created_at',
  ascending: true,
})

/** Milestones by date — this list IS the runway. */
export const milestones = table<PmoMilestone, Record<string, unknown>>('pmo_milestones', {
  column: 'due_date',
  ascending: true,
})

/* ─────────────────────────────── the view ──────────────────────────────── */

/**
 * Objective progress, rolled up in the database.
 *
 * A VIEW rather than an arithmetic pass in `lib/`, and the two are not
 * interchangeable: the clamp and the mean have to agree with what the database
 * would say, because a key result can be edited from another tab. Computing it
 * client-side would make two readers of the same objective disagree until one of
 * them reloaded.
 */
export async function objectiveProgress(): Promise<ApiResult<PmoObjectiveProgress[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.from('v_pmo_objective_progress').select(ALL)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as PmoObjectiveProgress[] }
}

/**
 * Everything the PMO page needs, in one round of parallel reads.
 *
 * ⚠ `Promise.all` RATHER THAN `allSettled`, and the difference is the honesty
 *   rule again. If the revenue read fails and the rest succeed, a page built
 *   from the partial set renders a portfolio with no money in it and NOTHING
 *   says so — a director reads "0 of 109.7M" as a fact about the programme
 *   rather than about the network. One rejection fails the load, the page says
 *   it could not read, and nobody is misled.
 *
 * ⚠ AND A MISSING TABLE IS NOT SWALLOWED. Until 0031 is applied every one of
 *   these answers `PGRST205` — "table not found" — which `pgErrorKey` turns into
 *   a key the page renders as "this needs migration 0031". That is the state
 *   this workspace is in the day this ships, and it has to read as a setup step
 *   rather than as an empty portfolio.
 */
export interface PmoPortfolio {
  projects: PmoProject[]
  initiatives: PmoInitiative[]
  actions: PmoAction[]
  risks: PmoRisk[]
  revenue: PmoRevenueLine[]
  objectives: PmoObjective[]
  keyResults: PmoKeyResult[]
  progress: PmoObjectiveProgress[]
  milestones: PmoMilestone[]
}

export async function listPortfolio(): Promise<ApiResult<PmoPortfolio>> {
  if (!supabase) return notConfigured()
  const [p, i, a, r, rev, o, kr, prog, m] = await Promise.all([
    projects.list(),
    initiatives.list(),
    actions.list(),
    risks.list(),
    revenue.list(),
    objectives.list(),
    keyResults.list(),
    objectiveProgress(),
    milestones.list(),
  ])
  for (const result of [p, i, a, r, rev, o, kr, prog, m]) {
    if (!result.ok) return fail(result.error)
  }
  // Every branch above returned, so each of these is the ok arm. The casts are
  // the narrowing TypeScript cannot do across an array of mixed generics.
  return {
    ok: true,
    data: {
      projects: (p as { data: PmoProject[] }).data,
      initiatives: (i as { data: PmoInitiative[] }).data,
      actions: (a as { data: PmoAction[] }).data,
      risks: (r as { data: PmoRisk[] }).data,
      revenue: (rev as { data: PmoRevenueLine[] }).data,
      objectives: (o as { data: PmoObjective[] }).data,
      keyResults: (kr as { data: PmoKeyResult[] }).data,
      progress: (prog as { data: PmoObjectiveProgress[] }).data,
      milestones: (m as { data: PmoMilestone[] }).data,
    },
  }
}
