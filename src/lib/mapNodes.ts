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
// THE LIMIT THAT PARAGRAPH USED TO NAME IS CLOSED, AND THE FOURTH ARGUMENT IS
// HOW. Until wave 3 the denominator's `nodes` was counted off the LINKS, so an
// organization that had recorded nothing was invisible to it: forty
// organizations, three of which have a row, read `18 of 27` — a number that
// LOOKS like progress and silently drops the thirty-seven the reader is
// employed to notice. At 400 organizations on a freshly imported workspace that
// is not an edge case, it is the ordinary state. So `nodes` is now an ARGUMENT,
// REQUIRED, and the same forty read `18 of 400`.
//
// Required rather than optional for `MindtreeInput.entities`' reason: an
// optional would let the one production call site forget it and ship a map that
// quietly kept the old arithmetic — the failure mode of "nothing appeared and
// nothing complained". A wrong denominator has no symptom on screen.
//
// The caller ASSERTS the population, so a link belonging to a node outside it is
// ignored rather than widening it — otherwise a narrow node list with a wide
// link list yields `done > total`, and the number would disagree with the list
// the caller drew beside it.
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

import type {
  MapNode,
  MapNodeProgress,
  MapNodeStage,
  MapNodeUseCase,
  UseCase,
  UseCaseRung,
  UseCaseStatus,
} from '../types'
import type { IsoDate } from './dates'
import { diffDays } from './dates'
import { normalizeSearch } from './text'
import type { MindNode } from './mindtree/model'

/**
 * The three-word `status` that goes with a rung — THE ONLY PLACE THE TWO
 * COLUMNS ARE RECONCILED.
 *
 * 0032 added `rung` and backfilled it from `status`, keeps both, and says a
 * later migration drops `status` once every reader has moved. Until that day
 * every write must set both, because two columns describing the same cell and
 * disagreeing is worse than either one alone — a reader would have no way to
 * tell which was stale.
 *
 * This is the migration's own backfill run backwards:
 *
 *     planned → intake        intake        → planned
 *     testing → stg           dev, stg, coc → testing
 *     live    → prod          prod          → live
 *
 * ⚠ IT IS LOSSY IN THIS DIRECTION AND THAT IS CORRECT, NOT A DEFECT. Three
 *   rungs collapse to `testing`, so a round trip through `status` would lose
 *   whether a pair is at DEV or waiting on a signed COC. That is exactly why
 *   `rung` was added: `status` cannot hold the answer. `rung` is the truth and
 *   `status` is the shadow it casts for readers that have not moved yet — never
 *   the other way round, and nothing may derive a rung FROM a status outside
 *   0032's one-time backfill.
 *
 * scripts/report/grid.mjs carries the same table (`RUNG_OF`). One of the two is
 * going to be edited one day; this comment is how the other gets found.
 */
export function statusForRung(rung: UseCaseRung): UseCaseStatus {
  if (rung === 'prod') return 'live'
  if (rung === 'intake') return 'planned'
  return 'testing'
}

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
  /**
   * The RUNG, on the same rule as `status` right above: the value when exactly
   * one link speaks for this capability, and null both when nothing is recorded
   * and when a roll-up's organizations disagree.
   *
   * ⚠ NULL IS THREE FACTS AND THE PANEL MUST TELL THEM APART, which it does
   *   through `linked`: 0 is "no row at all", 1 is "a row nobody has placed on
   *   the ladder", and more than 1 is "they disagree". Drawing all three as a
   *   marker at intake would invent a position for two of them.
   */
  rung: UseCaseRung | null
  /** Links naming this capability. 0 or 1 for one organization. */
  linked: number
  /** Links naming this capability AT the terminal status. */
  done: number
  /**
   * Links that say this capability DOES NOT APPLY here (0032's `scope`).
   *
   * ⚠ A SEPARATE COUNT, NOT A ZERO IN `linked`, because "nobody has said" and
   *   "somebody said it does not apply" are different facts and the panel draws
   *   them differently — an em-dash for the first, a word for the second.
   *   Folding them together would put the row this office deliberately ruled out
   *   in the same state as the rows nobody has looked at.
   *
   * These pairs are also subtracted from `total`, which is the whole reason
   * `scope` exists: a hospital with no radiology department reads "6 of 10".
   */
  notApplicable: number
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
 *
 * ── AND IT IS THE GATE A COHORT'S KEY MUST NEVER PASS ──────────────────────
 *
 * `'entity'` BY NAME, not `KIND_ROLE[kind] === 'place'`, and the difference is
 * the whole of the design's §1.6 argument written as one comparison. A cohort
 * carries a SYNTHETIC key — `manager:<uuid>`, `stage:<uuid>`, `vendor:acme` —
 * minted by `groupEntities` from columns the organizations already hold. It is
 * not a row in `map_nodes`, and this function is the ONLY door between a
 * `MindNode` and the `node_id` that goes to `api/map.ts`: `MapBranch` mounts the
 * org sidebar on it, `useMapModel` counts capabilities by it, `portfolio/rows`
 * builds a row per it. A cohort's key reaching any of them is `22P02 invalid
 * input syntax for type uuid` at best and a read scoped to a node that does not
 * exist at worst.
 *
 * A `'place'` is a track OR an Organization, and a TRACK's key is a `tracks` id
 * — already the wrong uuid for this column, which is why the role table is not
 * the test here and why model.ts's `'entity'` note says the same thing from the
 * other side. Every kind that is not `'entity'` answers null, including every
 * kind added after this line was written; `mapNodes.test.ts` proves it over the
 * whole union rather than over the two kinds anybody thought of.
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
 *
 * `nodes` is THE POPULATION THE NUMBER IS ABOUT — one organization for a panel,
 * every organization beneath a branch for a roll-up. It is deduped by id (a
 * caller that concatenated two subtrees) and it is the whole of the denominator:
 * an organization in it that has recorded nothing contributes a column of
 * zeroes, and a link from an organization NOT in it is dropped. See the header.
 */
export function useCaseProgress(
  catalogue: readonly UseCase[],
  links: readonly MapNodeUseCase[],
  terminalKey: string,
  nodes: readonly Pick<MapNode, 'id'>[],
): UseCaseProgress {
  const nodeIds = new Set<string>()
  for (const node of nodes) nodeIds.add(node.id)

  // ONE PASS, and the foreign-link test is inside it rather than a `filter()`
  // above it: at 4,000 links a copy of the array per call is the allocation this
  // module is asked for once per node in a roll-up.
  // ⚠ `not_applicable` IS SKIPPED HERE TOO, so a RETIRED capability that some
  //   organization has ruled out does not climb back onto the table to be
  //   counted. It is on the table only if somebody is actually doing it.
  const linkedIds = new Set<string>()
  for (const link of links) {
    if (!nodeIds.has(link.node_id)) continue
    if (link.scope === 'not_applicable') continue
    linkedIds.add(link.use_case_id)
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

  interface Tally {
    linked: number
    done: number
    notApplicable: number
    status: UseCaseStatus | null
    rung: UseCaseRung | null
  }
  const blank = (): Tally => ({
    linked: 0, done: 0, notApplicable: 0, status: null, rung: null,
  })
  const tally = new Map<string, Tally>()
  // Every pair somebody has ruled out, so it can leave the denominator below.
  let ruledOut = 0
  for (const link of links) {
    if (!nodeIds.has(link.node_id)) continue
    if (!onTable.has(link.use_case_id)) continue
    let seen = tally.get(link.use_case_id)
    if (seen === undefined) {
      seen = blank()
      tally.set(link.use_case_id, seen)
    }
    // ⚠ A RULED-OUT PAIR IS NOT A LINK AND NOT A ZERO. It counts itself, leaves
    //   `linked`, `done` and `status` untouched, and comes off the total. Adding
    //   it to `linked` would say somebody is working on it; adding it to neither
    //   would say nobody has looked.
    if (link.scope === 'not_applicable') {
      seen.notApplicable += 1
      ruledOut += 1
      continue
    }
    if (seen.linked === 0) {
      seen.linked = 1
      seen.done = link.status === terminalKey ? 1 : 0
      seen.status = link.status
      seen.rung = link.rung ?? null
      continue
    }
    seen.linked += 1
    if (link.status === terminalKey) seen.done += 1
    // A second voice on the same capability. No single word is true of both, so
    // the row falls back to its counts — and the same is true of the rung, which
    // is also how "one organization placed it and one did not" resolves.
    if (seen.status !== link.status) seen.status = null
    if (seen.rung !== (link.rung ?? null)) seen.rung = null
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
        rung: seen?.rung ?? null,
        linked: seen?.linked ?? 0,
        done: seen?.done ?? 0,
        notApplicable: seen?.notApplicable ?? 0,
        retired: useCase.hidden && (seen?.linked ?? 0) > 0,
      }
    })

  // Never 0: one panel is one organization even before its row has arrived, and
  // a total of 0 would render "0 of 0" where "0 of 9" is the fact. The floor is
  // right for a panel and wrong for a branch with no organization beneath it at
  // all — which is why useMapModel's walk skips those rather than asking.
  const population = Math.max(1, nodeIds.size)
  let done = 0
  let linked = 0
  for (const row of rows) {
    done += row.done
    linked += row.linked
  }

  // ⚠ RULED-OUT PAIRS COME OFF THE TOTAL, which is the entire reason 0032 added
  //   `scope`. A hospital with no radiology department is not failing to deliver
  //   Rad Order — it reads "6 of 10", not "6 of 11". Floored at the population
  //   for the reason above: an organization that ruled out everything is still
  //   one organization, and "0 of 0" is not a sentence.
  const total = Math.max(population, rows.length * population - ruledOut)

  return { rows, done, total, linked, nodes: population }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PORTFOLIO FOLDS (0026/0027)
//
// Everything below answers a question about MANY organizations at once, and all
// of it is pure for this file's stated reason: the numbers a director reads have
// to be testable at a fixed instant, in a test runner, without a browser.
//
// WHY HERE AND NOT IN `store/config.deriveAll`. That function runs on every one
// of its eight reads landing INCLUDING the 30-second focus refetch, and it feeds
// `useSyncExternalStore` selectors that must return stored references. These are
// view questions for one screen at a time — orgs-per-manager is not something
// the board, the digest and the tracks index all want — and `progressByNode`
// needs the capability links, which are deliberately not in that store at all
// (api/map.ts's "NOT ON BOOT", store/portfolio.ts's whole reason to exist).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The two lookups every fold below needs, joined once.
 *
 * `map_node_progress` says which RUNG a node stands on and `map_node_stages`
 * says what that rung MEANS — 0026 splits them because one is fieldwork the
 * account managers own and the other is a ladder the owner owns. Every reader
 * therefore does the same two-step (lib/lifecycle.ts's header names the chain:
 * `progressByNodeId` → `stageById`), and doing it inline in four places is four
 * chances for one of them to treat a retired rung differently from the rest.
 *
 * `byId` is kept beside `ofNode` because a GOAL names a stage that no node may
 * be standing on yet, and "or beyond" cannot be answered without that row's
 * `sort_order`.
 */
export interface StageIndex {
  /** The ladder itself, by stage id — store/config's `useStageMap()`. */
  byId: ReadonlyMap<string, MapNodeStage>
  /**
   * The rung a node stands on, or null.
   *
   * ⚠ NULL COLLAPSES THREE DIFFERENT FACTS AND THAT IS DELIBERATE HERE: no
   *   progress row ("nobody has said"), a row whose `stage_id` was cleared
   *   ("somebody looked and cleared it"), and a row naming a rung that is no
   *   longer in the ladder. All three mean the same thing to a fold that is
   *   counting who has got where: this node is not standing anywhere. The first
   *   two are told apart by the presence of the progress row itself, which the
   *   panel reads directly — this index is for counting.
   */
  ofNode: (nodeId: string) => MapNodeStage | null
}

/** Build a {@link StageIndex} from the two maps store/config publishes. */
export function stageIndex(
  progress: ReadonlyMap<string, Pick<MapNodeProgress, 'stage_id'>>,
  stages: ReadonlyMap<string, MapNodeStage>,
): StageIndex {
  return {
    byId: stages,
    ofNode: (nodeId) => {
      const stageId = progress.get(nodeId)?.stage_id
      if (stageId === undefined || stageId === null) return null
      return stages.get(stageId) ?? null
    },
  }
}

/**
 * One integrator, and every organization on it.
 *
 * `fold` is the matched form and `label` is the FIRST SPELLING SEEN — what
 * somebody actually typed, which is what a chip and a shared URL should read.
 */
export interface VendorCohort {
  fold: string
  label: string
  nodes: MapNode[]
}

/**
 * Accumulate one node into a vendor map. THE RULE, in one place.
 *
 * Module-private and called from both `foldVendors` and `foldPortfolio`, because
 * the entire point of extracting this was that the picker and the count can
 * never disagree: FilterBar offered "Acme" from one copy of these four lines
 * while a cohort count would have been computed from another.
 *
 * ARCHIVED NODES ARE SKIPPED. A vendor that survives only on organizations
 * somebody put away is not a cohort the workspace still has, and offering it
 * would put a chip in front of every reader that selects nothing they can see.
 * A vendor that folds to nothing — punctuation alone — is skipped for the
 * neighbouring reason: it would be a chip with no label matching every other
 * such row.
 */
function foldVendorInto(into: Map<string, VendorCohort>, node: MapNode): void {
  if (node.archived) return
  const vendor = node.vendor.trim()
  if (vendor === '') return
  const fold = normalizeSearch(vendor)
  if (fold === '') return
  const held = into.get(fold)
  if (held === undefined) into.set(fold, { fold, label: vendor, nodes: [node] })
  else held.nodes.push(node)
}

/**
 * Sorted on the FOLDED key and compared by code point, never through
 * localeCompare: lib/entryFilter's `title` sort gives the reason — the order has
 * to be identical in the test runner and in the browser, and folding is what
 * makes code-point order sane in both languages.
 */
function sortCohorts(byFold: Map<string, VendorCohort>): VendorCohort[] {
  return [...byFold.values()].sort((a, b) => (a.fold < b.fold ? -1 : a.fold > b.fold ? 1 : 0))
}

/**
 * The integrators the workspace actually has, one cohort each, in a stable
 * order.
 *
 * TWO CONSUMERS, ONE FOLD: the vendor picker in FilterBar renders `label` and
 * the cohort ring counts `nodes.length`. Before this they were two copies of the
 * same four lines in two files, which is exactly the "two arithmetics for one
 * question that disagree under conditions nobody tests" this wave exists to
 * close — and vendors are FREE TEXT (0023:359), so the folding is not a detail
 * that could be skipped: 'Acme', 'acme ' and 'ACME' are one integrator.
 */
export function foldVendors(nodes: readonly MapNode[]): VendorCohort[] {
  const byFold = new Map<string, VendorCohort>()
  for (const node of nodes) foldVendorInto(byFold, node)
  return sortCohorts(byFold)
}

/** What one walk over the portfolio answers. See {@link foldPortfolio}. */
export interface PortfolioFold {
  /**
   * Stage id → the nodes standing on that rung.
   *
   * EVERY RUNG IN THE LADDER GETS A BUCKET, EMPTY ONES INCLUDED, and in the
   * ladder's own order — store/config's `mapChildren` makes the same promise for
   * the same reason. "Nobody is at Testing/UAT" is a fact the ladder has to be
   * able to show, and a missing key would make it indistinguishable from a rung
   * that does not exist.
   */
  byStage: Map<string, MapNode[]>
  /**
   * `account_manager_id` → their book, with `null` for the organizations nobody
   * is named on. The null bucket is the point of the workload question, not an
   * error case: "who owns these eleven" is the answer the AD needs first.
   */
  byManager: Map<string | null, MapNode[]>
  /** Folded vendor → the cohort. Same fold as the picker; see {@link foldVendors}. */
  byVendor: Map<string, VendorCohort>
  /**
   * The organizations no rung claims. Carried SEPARATELY rather than folded into
   * a "Not started" bucket, because 0026 ships no backfill on purpose: "Not
   * started" is a rung an account manager PICKED and "no row" is nobody having
   * said anything, and collapsing them asserts facts nobody stated.
   */
  unstaged: MapNode[]
}

/**
 * The three groupings the portfolio asks for, plus the exception list, in ONE
 * walk.
 *
 * `store/entries.ts:907`'s "ONE WALK, TWO ANSWERS" idiom at three answers. The
 * alternative is three passes plus a fourth for `unstaged`, each re-deciding
 * what "archived" and "unstaged" mean — and the O(n) property is not the reason
 * it matters at 400 rows. The reason is that four passes are four places for the
 * rules to drift apart, and the day they do the workload tab and the stage tab
 * describe two different workspaces.
 *
 * ARCHIVED NODES ARE SKIPPED, once, here — the same rule the vendor fold has
 * always had, now true of the stage and manager answers as well.
 *
 * THE CALLER CHOOSES THE POPULATION and this function does not guess: the
 * portfolio passes organizations, a cohort ring passes what is beneath it. There
 * is no branch on `kind_id` anywhere below, because a stage applies to every
 * kind of node (0026 puts no constraint on it) and a fold that quietly dropped
 * Phases would answer a different question from the one the caller asked.
 */
export function foldPortfolio(nodes: readonly MapNode[], stages: StageIndex): PortfolioFold {
  const byStage = new Map<string, MapNode[]>()
  // Seeded from the ladder, in the ladder's order, BEFORE the walk — see the
  // field's note. A Map preserves insertion order, so the caller's stage order
  // (store/config keeps `sort_order`) is the order these buckets read in.
  for (const stageId of stages.byId.keys()) byStage.set(stageId, [])

  const byManager = new Map<string | null, MapNode[]>()
  const byVendor = new Map<string, VendorCohort>()
  const unstaged: MapNode[] = []

  for (const node of nodes) {
    if (node.archived) continue

    const stage = stages.ofNode(node.id)
    if (stage === null) unstaged.push(node)
    else {
      const held = byStage.get(stage.id)
      // A rung the ladder does not carry cannot happen through `stages.ofNode`
      // (it resolves through the same map), but the bucket is created rather
      // than the node dropped: losing a node from a count is the one failure
      // this file must never produce silently.
      if (held === undefined) byStage.set(stage.id, [node])
      else held.push(node)
    }

    const book = byManager.get(node.account_manager_id)
    if (book === undefined) byManager.set(node.account_manager_id, [node])
    else book.push(node)

    foldVendorInto(byVendor, node)
  }

  // Rebuilt in sorted order so two loads render the cohorts alike — a Map keeps
  // insertion order, and the walk's order is the node list's.
  const sorted = new Map(sortCohorts(byVendor).map((c) => [c.fold, c]))
  return { byStage, byManager, byVendor: sorted, unstaged }
}

/**
 * `useCaseProgress` for every organization in a list, in one pass over the
 * links.
 *
 * EVERY NODE GETS AN ENTRY, INCLUDING ONE WITH NO LINKS AT ALL, and that is the
 * whole point of the portfolio: "which organizations have recorded nothing" is
 * the question the exception list exists to answer, so a node missing from this
 * map would be a row missing from that list.
 *
 * The links are bucketed ONCE and `useCaseProgress` is then reused per node
 * rather than reimplemented — a per-node `filter()` over 4,000 links is the O(n²)
 * that makes a 400-organization workspace feel broken, and a second copy of the
 * tally would be a second answer to "how far has this organization got".
 */
export function progressByNode(
  links: readonly MapNodeUseCase[],
  nodes: readonly MapNode[],
  catalogue: readonly UseCase[],
  terminalKey: string,
): Map<string, UseCaseProgress> {
  const linksByNode = new Map<string, MapNodeUseCase[]>()
  for (const link of links) {
    const held = linksByNode.get(link.node_id)
    if (held === undefined) linksByNode.set(link.node_id, [link])
    else held.push(link)
  }

  const out = new Map<string, UseCaseProgress>()
  for (const node of nodes) {
    if (out.has(node.id)) continue
    // `useCaseProgress` is a PURE FUNCTION whose name matches oxlint's Hook
    // heuristic (`use` + a capital), so calling it outside a component is a
    // rules-of-hooks error under its own name. Every other caller aliases it at
    // the import (MapBranchDetail.tsx, useMapModel.ts, this module's own test);
    // inside the module that defines it there is nothing to alias, so the fence
    // is the suppression. Renaming the function is the alternative and it is
    // worse: the name is the domain's word for the number.
    const own = linksByNode.get(node.id) ?? []
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    out.set(node.id, useCaseProgress(catalogue, own, terminalKey, [node]))
  }
  return out
}

/**
 * The three columns of a goal row this module reads, and NOT the row type.
 *
 * STRUCTURAL RATHER THAN NOMINAL, deliberately: `src/lib/**` may not import a
 * store or an api module, and naming `MapNodeGoal` here would couple the
 * arithmetic to a types file that 0027's client half is still landing. Every
 * column below is 0027's, spelled the way it spells them, so the real row
 * satisfies this by construction and a column rename is a compile error at every
 * call site rather than a silent `undefined` in a number.
 */
export interface GoalTerms {
  /**
   * NULL = "a terminal stage" — the default reading and the commonest goal at
   * 400 organizations. A value = "this stage OR BEYOND", where beyond is
   * `sort_order >=` this stage's.
   *
   * ⚠ THAT COUPLES THE MEANING OF EVERY COUNT GOAL TO THE LADDER'S ORDER, so
   *   reordering the stage list RESTATES them. 0027's own comment says so and
   *   `reorder_map_node_stages` says so; this is the code that makes it true.
   */
  stage_id: string | null
  /** NULL = a date goal about this node itself. A positive integer = a count of descendants. */
  target: number | null
  /** The calendar day the commitment names. A `date`, never a timestamp. */
  target_date: IsoDate
}

/** How a goal is doing. Every field is a number a sentence can be built from. */
export interface GoalProgress {
  /** The count the goal asks for, or null for a date goal about the node itself. */
  target: number | null
  /** How many of the population are at the goal's stage or beyond. */
  reached: number
  /** How many of the population stand on any rung at all. */
  eligible: number
  /**
   * How many stand on none — carried separately for `UseCaseProgress.linked`'s
   * exact reason. "0 of 40 — 380 organizations have no stage recorded" is a true
   * and actionable sentence; "0 of 40" alone sends an AD chasing the wrong thing.
   */
  unstaged: number
  /** Whole days until `target_date`. NEGATIVE MEANS OVERDUE. */
  daysLeft: number
  /** `reached` has arrived at the count the goal asks for. */
  met: boolean
}

/**
 * How far a commitment has got.
 *
 * WHICH ORGANIZATIONS THE NUMBER IS ABOUT — the one rule with any subtlety in
 * it, and it branches on the GOAL'S SHAPE, never on the node's kind (0026 puts a
 * stage on every kind; a fold that special-cased Phases would answer a different
 * question about the same tree). 0027's own table is the specification:
 *
 *   stage null, target null → "THIS NODE reaches a terminal stage by D"
 *   stage null, target 40   → "40 organizations BENEATH this node are terminal"
 *   stage set,  target 40   → "40 BENEATH are at that stage or beyond"
 *   stage set,  target null → "THIS NODE reaches that stage or beyond"
 *
 * So a goal with no `target` is measured against the node itself, and a goal
 * with one is measured against its descendants. And when a count goal has NO
 * STAGED DESCENDANTS — the leaf Organization somebody put a target on, and the
 * Phase whose children nobody has staged yet — it falls back to the node itself
 * rather than reporting a permanent zero against an empty population.
 *
 * `descendants` is EVERY descendant at any depth, archived ones excluded, and it
 * is the caller's walk rather than this function's: the tree lives in
 * store/config's `mapChildren` and this module may not reach for it.
 *
 * `today` arrives as an argument, exactly as `countEntries` takes one, and it is
 * an ISO CALENDAR DAY rather than a Date because `target_date` is a `date`:
 * 0027 chose that type so "31 Dec" could not render as 30 Dec for a reader in
 * the wrong offset, and comparing it against an instant here would put the time
 * zone back.
 */
export function goalProgress(
  goal: GoalTerms,
  node: Pick<MapNode, 'id'>,
  descendants: readonly MapNode[],
  stages: StageIndex,
  today: IsoDate,
): GoalProgress {
  const goalStage = goal.stage_id === null ? null : (stages.byId.get(goal.stage_id) ?? null)
  // A goal whose stage was RETIRED falls back to the terminal reading — which is
  // the reading it would have had if nobody had narrowed it. 0027's
  // `on delete set null` makes that the database's answer too, so the two agree
  // in the window where a goal still names a stage this client no longer holds.
  const floor = goalStage?.sort_order ?? null

  const reaches = (stage: MapNodeStage | null): boolean => {
    if (stage === null) return false
    return floor === null ? stage.terminal : stage.sort_order >= floor
  }

  let population: readonly Pick<MapNode, 'id'>[] = [node]
  if (goal.target !== null) {
    const alive = descendants.filter((d) => !d.archived)
    // "No staged descendants" and not "no descendants": a Phase with 40
    // organizations under it that nobody has staged yet reads against itself,
    // and lights up the moment the first one is staged.
    if (alive.some((d) => stages.ofNode(d.id) !== null)) population = alive
  }

  let reached = 0
  let eligible = 0
  for (const member of population) {
    const stage = stages.ofNode(member.id)
    if (stage === null) continue
    eligible += 1
    if (reaches(stage)) reached += 1
  }

  return {
    target: goal.target,
    reached,
    eligible,
    unstaged: population.length - eligible,
    daysLeft: diffDays(today, goal.target_date),
    // A date goal asks for ONE arrival — this node's. `target ?? 1` is that
    // sentence and not a defensive default: 0027 refuses a target of 0 with its
    // own token precisely because "0 organizations live" reads as permanently
    // met, so there is no zero for this to collapse.
    met: reached >= (goal.target ?? 1),
  }
}
