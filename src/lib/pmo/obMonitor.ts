// What is stuck right now — OPERATING-MODEL §11, as arithmetic.
//
// PURE, on src/lib/pmo/summary.ts's contract: no store, no clock beyond the
// `today` it is handed, no `t()`, no React.
//
// ── WHAT IT ANSWERS FIRST ──────────────────────────────────────────────────
//
// §11.1: **what is stuck right now**. Not coverage, not the weekly delta, not
// load — those are all on the page, below. A dashboard whose first screen is a
// progress bar is a dashboard people stop opening.
//
// ── THE ATOM IS (HOSPITAL × USE CASE); THE ROW IS A HOSPITAL ───────────────
//
// §11.2. There are 1,540 pairs, which is more than anyone reads. One row per
// use case would answer "how is Lab Order going" and lose the hospital; the full
// grid answers neither, it only shows patterns. A hospital row carrying its
// eleven markers is a whole picture on one line.
//
// ── FIVE CHANNELS, AND THE FIFTH IS NOT LIKE THE OTHERS ───────────────────
//
// §11.3. Blocked · past its rung budget · no owner · gone quiet — and then COC,
// **separately and not as a fault**. The reasons are the owner's:
//
//   · the waiting party is outside the programme. Nobody on the roster can move
//     a COC by working harder, and painting it the same as "your engineer has
//     not touched this in 40 days" tells the reader to chase the wrong person.
//   · it is the rung the PMO itself works. Every other rung is delivery; COC is
//     a counter-signature, so the count is this office's own queue.
//   · ten days on STG/TEST is a delivery question. Ten days at COC is a question
//     for CHI, and the honest sentence names them.
//
// ── AND TWO OF THE FIVE CANNOT SPEAK YET ──────────────────────────────────
//
// ⚠ THIS IS THE PART A LATER READER WILL WANT TO "FIX", SO THE MEASUREMENT IS
//   WRITTEN DOWN. Every one of the 1,540 links carries `updated_by = null` and
//   there is exactly ONE distinct `status_changed_at` across all of them — the
//   instant 0032 was applied. Computing days-on-rung from that would give all
//   1,540 the identical number, and that number would be the age of one SQL
//   Editor session presented as the state of a national programme.
//
//   `src/lib/portfolio/fields.ts` already refuses exactly this one table over,
//   and §11.3.2 says the budget "cannot fire on imported data" in as many words.
//   So `budgetMeasurable` is false until a PERSON moves a rung, and the surface
//   renders a sentence rather than `0 over budget` — a proud zero meaning "we
//   checked and found none" when it actually means "we cannot yet look".

import type { MapNodeUseCase, UseCaseRung, UseCase } from '../../types'
import type { IsoDate } from '../dates'
import { diffDays } from '../dates'

/** The rungs in order. Index is position — the order IS the data. */
export const OB_RUNGS: readonly UseCaseRung[] = ['intake', 'dev', 'stg', 'coc', 'prod']

/** One (hospital × use case) pair, as the strip draws it. */
export interface ObCell {
  useCaseId: string
  /** Null when nobody has placed this pair on the ladder. Drawn as untouched paper. */
  rung: UseCaseRung | null
  /** 0-based position, or null for an unplaced or ruled-out pair. */
  rank: number | null
  /** Somebody ruled this pair out. It leaves the denominator and draws no marker. */
  notApplicable: boolean
  /** The flag, and who the wait is on. Empty string is "nobody has said". */
  blockedSince: IsoDate | null
  pendingWith: string
  atCoc: boolean
}

export interface ObRow {
  nodeId: string
  name: string
  managerId: string | null
  /** Eleven cells, in catalogue order, so every row's strip lines up with every other. */
  cells: ObCell[]
  /** Cells carrying a raised blocked flag. */
  blocked: number
  /** Cells sitting at COC — this office's own queue, never a fault. */
  atCoc: number
  /**
   * Days since anything was filed against this hospital, or null when nothing
   * ever has been.
   *
   * ⚠ NULL IS "NOTHING HAS EVER BEEN FILED" AND IT IS NOT ZERO, and it must not
   *   sort to the top of a quietest-first list: an organization nobody has
   *   opened is a different problem from one that went quiet, and floating the
   *   unlooked-at above the stuck is the failure `summary.ts` names by hand.
   */
  quietDays: number | null
}

export interface ObMonitorInput {
  /** Organizations only. The caller filters by kind, as the PMO page already does. */
  nodes: readonly { id: string; name: string; account_manager_id: string | null }[]
  /** The visible catalogue, in display order. Its length is every strip's length. */
  catalogue: readonly UseCase[]
  links: readonly MapNodeUseCase[]
  /** Last activity per node, as an ISO instant. Absent means nothing was ever filed. */
  lastActivityByNode: ReadonlyMap<string, string>
  today: IsoDate
  /** §11.6. Configurable, and the owner set it at fourteen. */
  quietAfterDays: number
}

export interface ObMonitor {
  rows: ObRow[]
  organizations: number
  /* ── the four exception channels ──────────────────────────────────────── */
  blocked: ObRow[]
  noOwner: ObRow[]
  quiet: ObRow[]
  /**
   * ⚠ ALWAYS EMPTY WHILE `budgetMeasurable` IS FALSE, which is today. Kept as a
   *   list rather than omitted so the surface has one shape to render either
   *   way, and so the day it fills nothing needs rewriting.
   */
  overBudget: ObRow[]
  /**
   * Whether a rung clock can be read at all — true once ANY link records a
   * person as its last author. See the header: until then every clock is one
   * migration instant and the honest answer is a sentence, not a zero.
   */
  budgetMeasurable: boolean
  /* ── and the fifth, which is not an exception ─────────────────────────── */
  /** Records at COC. Its own count, its own list, its own words — §11.3.5. */
  atCoc: ObRow[]
  cocPairs: number
}

export function buildObMonitor(input: ObMonitorInput): ObMonitor {
  const byNode = new Map<string, MapNodeUseCase[]>()
  for (const link of input.links) {
    const held = byNode.get(link.node_id)
    if (held === undefined) byNode.set(link.node_id, [link])
    else held.push(link)
  }

  // A person's edit anywhere in the estate is what starts the rung clock. One is
  // enough: the question is whether the column means anything yet, not how much.
  const budgetMeasurable = input.links.some((link) => link.updated_by != null)

  const rows: ObRow[] = []
  let cocPairs = 0

  for (const node of input.nodes) {
    const mine = new Map((byNode.get(node.id) ?? []).map((l) => [l.use_case_id, l]))
    const cells: ObCell[] = []
    let blocked = 0
    let atCoc = 0

    for (const useCase of input.catalogue) {
      const link = mine.get(useCase.id)
      const notApplicable = link?.scope === 'not_applicable'
      const rung = notApplicable ? null : (link?.rung ?? null)
      const rank = rung === null ? null : OB_RUNGS.indexOf(rung)
      const blockedSince = (link?.blocked_since ?? null) as IsoDate | null
      const isCoc = rung === 'coc'
      if (blockedSince !== null) blocked += 1
      if (isCoc) {
        atCoc += 1
        cocPairs += 1
      }
      cells.push({
        useCaseId: useCase.id,
        rung,
        // -1 cannot happen for a value from the union, but a row written by a
        // future migration with a sixth rung would land here; null draws no
        // marker rather than one at the start.
        rank: rank === null || rank < 0 ? null : rank,
        notApplicable,
        blockedSince,
        pendingWith: link?.pending_with ?? '',
        atCoc: isCoc,
      })
    }

    const last = input.lastActivityByNode.get(node.id)
    rows.push({
      nodeId: node.id,
      name: node.name,
      managerId: node.account_manager_id,
      cells,
      blocked,
      atCoc,
      quietDays: last === undefined ? null : Math.max(0, diffDays(last.slice(0, 10) as IsoDate, input.today)),
    })
  }

  // Heaviest first inside every channel, so the worst row is the one a reader's
  // eye lands on and a truncated list drops the least interesting rows.
  const byBlocked = [...rows].filter((r) => r.blocked > 0).sort((a, b) => b.blocked - a.blocked)
  const noOwner = rows.filter((r) => r.managerId === null)
  const quiet = rows
    .filter((r) => r.quietDays !== null && r.quietDays >= input.quietAfterDays)
    .sort((a, b) => (b.quietDays ?? 0) - (a.quietDays ?? 0))
  const atCoc = [...rows].filter((r) => r.atCoc > 0).sort((a, b) => b.atCoc - a.atCoc)

  return {
    rows,
    organizations: rows.length,
    blocked: byBlocked,
    noOwner,
    quiet,
    // See the field's own note: empty by construction until a person moves a rung.
    overBudget: [],
    budgetMeasurable,
    atCoc,
    cocPairs,
  }
}
