// The arithmetic behind the Org panel — how far one organization has got with
// the capabilities it is being onboarded onto.
//
// PURE, ON THE SAME CONTRACT AS lib/mindtree/model.ts: no store, no clock, no
// `t()`, no React. Everything it needs arrives as an argument and the same
// arguments always produce the same answer. That is what makes the numbers on
// the panel testable without a browser, and it is why the locale never reaches
// this file — a capability's displayed name is the component's job, and a module
// that resolved `name_ar` here would need `getLocale()` and stop being pure.
//
// ── THE TERMINAL STATUS IS A PARAMETER, NEVER THE LITERAL 'live' ───────────
//
// `useCaseProgress(catalogue, links, terminalKey)` is handed the status that
// counts as done. The literal lives at ONE call site (MapBranchDetail.tsx's
// `TERMINAL_STATUS`), so renaming what "finished" means is one edit that the
// type system checks, rather than a string this module compares against and
// silently stops matching. A `terminalKey` no row carries yields `0 of 9`, which
// is visibly wrong on the first paint — the failure this shape is chosen for is
// the OTHER one, where the arithmetic quietly keeps counting the old word.
//
// ── IT TAKES A LIST OF LINKS, AND THAT IS THE ROLL-UP SEAM ─────────────────
//
// v1 passes one organization's links, so `nodes` is 1 and the unit is "one
// capability at this organization". A Phase-level roll-up passes the links of
// every organization beneath it, and the unit becomes "one capability at one
// organization" — 18 of 27 rather than 6 of 9. Different argument, same code.
//
// The multi-node case is honest about one limit: `nodes` is counted off the
// LINKS, so an organization with no links at all is invisible to it and the
// denominator is that much smaller. v1 never hits it (one node, whose id the
// caller already knows), and the roll-up that will must pass a node list, at
// which point this signature gains a fourth argument rather than guessing.
//
// ── WHY THE DENOMINATOR IS THE CATALOGUE AND NOT THE LINK COUNT ────────────
//
// Absence is a value: 0024 has no 'none' status, so "not integrated" is a
// missing row (types.ts says so, and api/map.ts DELETEs to express it). If the
// denominator counted only the rows that exist, an organization that has done
// ADT and nothing else would read `1 of 1 live` — complete, at the top of the
// panel, in front of the person whose job is to notice it is not. So every
// capability on the table counts, and the ones with no row are the zeroes.
//
// AND HIDING A CAPABILITY MUST NOT SHRINK IT. `use_cases.hidden` retires a row
// from the pickers without erasing which organizations integrated it
// (vocab_options' exact contract). A denominator computed from the VISIBLE
// catalogue alone would drop from 9 to 8 the afternoon an admin tidies up, and
// yesterday's "6 of 9" and today's "6 of 8" would describe the same unchanged
// reality. So the table is the visible catalogue PLUS every hidden capability
// this set of links still names, and those rows render marked rather than gone.

import type { MapNodeUseCase, UseCase, UseCaseStatus } from '../types'
import type { MindNode } from './mindtree/model'

/**
 * One capability on the table, with what the links say about it.
 *
 * It carries the whole `UseCase` row rather than a name, because the name a
 * reader sees depends on the locale and this module has no opinion about that.
 */
export interface UseCaseProgressRow {
  useCase: UseCase
  /**
   * The status, when exactly ONE link speaks for this capability — the whole of
   * the single-organization case. Null when nothing is recorded, and also null
   * in a roll-up where several organizations disagree: a single word cannot
   * summarise three of them, and `linked`/`done` are the numbers that can.
   */
  status: UseCaseStatus | null
  /** Links naming this capability. 0 or 1 for one organization. */
  linked: number
  /** Links naming this capability AT the terminal status. */
  done: number
  /**
   * Retired from the catalogue but still recorded here — `use_cases.hidden`
   * with at least one link. Rendered marked, never dropped; see the header.
   */
  retired: boolean
}

/**
 * THREE NUMBERS, AND EACH ONE NAMES ITS UNIT.
 *
 * `done` and `total` are CAPABILITIES (at one organization, or capability ×
 * organization pairs in a roll-up) and are the two halves of "6 of 9 live".
 * `linked` is how many of them anybody has recorded anything about at all,
 * which is a different question — it is what separates "this organization has
 * nothing recorded" from "this organization is at zero", and the panel renders
 * the first as an em-dash rather than as `0 of 9`.
 *
 * None of them is an item count. Outstanding issues are entries, they live on
 * the stats band, and putting `6 of 9` in a tile beside `12 open` would be two
 * different units in one row of numbers.
 */
export interface UseCaseProgress {
  /** One row per capability on the table, in catalogue order. */
  rows: UseCaseProgressRow[]
  done: number
  total: number
  linked: number
  /** Organizations the links covered — 1 for one panel. Never 0; see the header. */
  nodes: number
}

/**
 * The map-node id behind a focused branch, or null when the branch is not one.
 *
 * ONE PLACE, because two callers need the same answer and a disagreement
 * between them is invisible: the panel mounts the detail band on it, and the
 * stats band scopes "outstanding issues" to it. `bucketKey` is a track id on a
 * `track` node and a status key on a `group` node — indistinguishable from a
 * node id by shape, which is exactly why model.ts publishes `kind` alongside it
 * and why nothing may read one without the other.
 */
export function entityIdOf(node: Pick<MindNode, 'kind' | 'bucketKey'>): string | null {
  return node.kind === 'entity' ? node.bucketKey : null
}

/**
 * How far a set of links has got, against the catalogue they were drawn from.
 *
 * `catalogue` should be the FULL list including hidden rows (store/config's
 * `useAllUseCases()`), because the table needs the hidden ones the links name.
 * Passing only the visible list is not an error and not a crash — it simply
 * cannot show a retired capability an organization is still recorded against.
 *
 * A link naming a capability that is not in `catalogue` at all is counted in
 * NEITHER numerator nor denominator. It has no name to render, so a row for it
 * would be a blank line; `use_cases` is `on delete restrict` from this join, so
 * the only way to produce one is to hand this function a partial catalogue.
 */
export function useCaseProgress(
  catalogue: readonly UseCase[],
  links: readonly MapNodeUseCase[],
  terminalKey: string,
): UseCaseProgress {
  const linkedIds = new Set<string>()
  const nodeIds = new Set<string>()
  for (const link of links) {
    linkedIds.add(link.use_case_id)
    nodeIds.add(link.node_id)
  }

  // By id, first occurrence wins: a caller that concatenated the visible list
  // and the full one would otherwise render every capability twice and double
  // the denominator.
  const onTable = new Map<string, UseCase>()
  for (const useCase of catalogue) {
    if (onTable.has(useCase.id)) continue
    if (useCase.hidden && !linkedIds.has(useCase.id)) continue
    onTable.set(useCase.id, useCase)
  }

  const tally = new Map<string, { linked: number; done: number; status: UseCaseStatus | null }>()
  for (const link of links) {
    if (!onTable.has(link.use_case_id)) continue
    const seen = tally.get(link.use_case_id)
    if (seen === undefined) {
      tally.set(link.use_case_id, {
        linked: 1,
        done: link.status === terminalKey ? 1 : 0,
        status: link.status,
      })
      continue
    }
    seen.linked += 1
    if (link.status === terminalKey) seen.done += 1
    // A second voice on the same capability. No single word is true of both, so
    // the row falls back to its counts.
    if (seen.status !== link.status) seen.status = null
  }

  // Sorted here rather than trusted from the caller: `sort_order` is the order
  // the admin arranged the catalogue in, and two loads that render the rows in
  // different orders are two different-looking matrices of identical data. `id`
  // breaks a tie so the order is total.
  const rows = [...onTable.values()]
    .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map<UseCaseProgressRow>((useCase) => {
      const seen = tally.get(useCase.id)
      return {
        useCase,
        status: seen?.status ?? null,
        linked: seen?.linked ?? 0,
        done: seen?.done ?? 0,
        retired: useCase.hidden && (seen?.linked ?? 0) > 0,
      }
    })

  // Never 0: one panel is one organization even before it has recorded
  // anything, and a total of 0 would render "0 of 0" where "0 of 9" is the
  // fact. See the header on the roll-up's version of this limit.
  const nodes = Math.max(1, nodeIds.size)
  let done = 0
  let linked = 0
  for (const row of rows) {
    done += row.done
    linked += row.linked
  }

  return { rows, done, total: rows.length * nodes, linked, nodes }
}
