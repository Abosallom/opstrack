// The COC queue — OPERATING-MODEL §11.7, as arithmetic.
//
// PURE, on src/lib/pmo/summary.ts's contract: no store, no clock beyond the
// `today` it is handed, no `t()`, no React.
//
// ── WHY THIS ONE IS DIFFERENT FROM EVERY OTHER PMO SURFACE ────────────────
//
// §11.7's own words: COC "is the one rung this office works, so it is the one
// place the PMO needs to RECORD rather than read." Every other tab in this
// product answers a question. This one is a worklist somebody works through and
// writes back to, and the diagnosis behind the whole exercise was that the
// product has eight ways to look at data and almost no way to change any of it
// — `setNodeUseCase` shipped with zero call sites.
//
// ── AND WHY ITS CLOCK IS HONEST WHEN THE RUNG CLOCK IS NOT ────────────────
//
// ⚠ READ THIS BEFORE "FIXING" THE OB MONITOR TO MATCH. `obMonitor.ts` refuses
//   to print a day count because `status_changed_at` carries one instant for
//   all 1,540 rows — the moment 0032 ran — and a number computed from it would
//   be the age of one SQL Editor session presented as the state of a national
//   programme.
//
//   THE COC CLOCK HAS NO SUCH PROBLEM, and the difference is not a loophole.
//   `coc_submitted_on` is a DATE A PERSON TYPES, meaning "this is the day the
//   evidence went to CHI". No migration wrote it, no importer can, and it is
//   null until somebody says otherwise. A day count from it is the age of a
//   real wait. `portfolio/fields.ts`'s rule is about clocks a SCRIPT stamped;
//   this is a fact a person recorded, which is the exact thing that rule exists
//   to protect.
//
// ── FOUR STATES, AND UNSUBMITTED IS NOT A LONG WAIT ───────────────────────
//
// A pair at COC is in one of four places, and they are different problems:
//
//   waiting    submitted, not signed — the age is the reason to chase
//   signed     CHI signed and the rung has not moved to PROD; the work is
//              finished and the record has not caught up
//   unsubmitted  at COC with no submission date — the chase has not STARTED
//   untraceable  submitted, but with no contact and no reference, so a chase
//              has nothing to quote and nobody to call
//
// ⚠ UNSUBMITTED MUST NOT SORT ABOVE THE OLDEST WAIT, and this is `obMonitor`'s
//   own rule about null `quietDays` restated one file over: an organization
//   nobody has opened is a different problem from one that went quiet, and
//   floating the unlooked-at above the stuck buries the thing a person can act
//   on today. So the queue sorts by age, oldest first, and the pairs with no
//   age sit after them under their own count.
//
// ── `coc_contact` IS A NAME AND NOTHING ELSE ──────────────────────────────
//
// §11.7 is emphatic: no email, no phone. This workspace holds no staff email
// addresses by design, forbids attachments outright, and its privacy page is
// written from what the schema actually contains — so a person OUTSIDE the
// organization is a higher bar, not a lower one. `cocContactProblem()` is that
// rule as a function, and the surface refuses the save rather than explaining
// afterwards. A name is what makes a chase possible; contact details belong in
// whatever system the PMO already keeps them in.

import type { MapNodeUseCase, UseCase } from '../../types'
import type { IsoDate } from '../dates'
import { diffDays } from '../dates'

/** Where a pair at COC actually is. Ordered as the queue reads, worst first. */
export type CocState = 'waiting' | 'unsubmitted' | 'signed'

/** One (hospital × use case) at COC — the unit of work, and the unit of the write. */
export interface CocEntry {
  nodeId: string
  nodeName: string
  useCaseId: string
  managerId: string | null
  state: CocState
  /** The four fields §11.7 names. Null and '' both mean nobody has said. */
  submittedOn: IsoDate | null
  contact: string
  reference: string
  signedOn: IsoDate | null
  /**
   * Days since the evidence went to CHI, or null when it has not.
   *
   * ⚠ NULL IS "NOT SUBMITTED" AND IS NOT ZERO. See the header: it is a
   *   different problem from a wait of no days, and it never sorts above one.
   */
  waitingDays: number | null
  /**
   * Submitted, but a chase would have nothing to quote and nobody to call.
   * Not a state of its own — a pair can be old AND untraceable, and the age is
   * still the thing that decides the order.
   */
  untraceable: boolean
}

export interface CocQueueInput {
  /** Organizations only. The caller filters by kind, as the PMO page already does. */
  nodes: readonly { id: string; name: string; account_manager_id: string | null }[]
  /** The visible catalogue, in display order — a pair's column position comes from it. */
  catalogue: readonly UseCase[]
  links: readonly MapNodeUseCase[]
  today: IsoDate
}

export interface CocQueue {
  /** Every pair at COC: waiting oldest-first, then unsubmitted, then signed. */
  entries: CocEntry[]
  waiting: number
  unsubmitted: number
  signed: number
  untraceable: number
  /**
   * The oldest live wait in days, or null when nothing has been submitted.
   * The one number this office would put in front of CHI.
   */
  oldestWait: number | null
  /** Distinct organizations represented, for the count line. */
  organizations: number
}

/** Why a `coc_contact` cannot be saved, or null when it is fine. */
export type CocContactProblem = 'email' | 'phone'

/**
 * §11.7's name-only rule, as a check the surface runs BEFORE the save.
 *
 * Deliberately narrow. It catches the two things somebody would paste in
 * without thinking — an address and a number — and it does not attempt to
 * validate what a name looks like, because names in this programme are Arabic,
 * English, transliterated, and hyphenated, and a validator confident about that
 * would reject real people.
 */
export function cocContactProblem(value: string): CocContactProblem | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.includes('@')) return 'email'
  // Seven digits is the shortest thing anywhere that is a phone number. Counted
  // across the whole string so that spaces, dashes and a +966 do not hide it.
  const digits = (trimmed.match(/\d/g) ?? []).length
  if (digits >= 7) return 'phone'
  return null
}

const STATE_ORDER: Record<CocState, number> = { waiting: 0, unsubmitted: 1, signed: 2 }

export function buildCocQueue(input: CocQueueInput): CocQueue {
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]))
  const inCatalogue = new Set(input.catalogue.map((u) => u.id))
  const entries: CocEntry[] = []

  for (const link of input.links) {
    if (link.rung !== 'coc') continue
    // A pair somebody ruled out is not work, whatever rung it was left on.
    if (link.scope === 'not_applicable') continue
    const node = nodeById.get(link.node_id)
    // Not an error: the caller passes organizations only, so a link against a
    // department or a hidden capability simply is not this queue's business.
    if (node === undefined) continue
    if (!inCatalogue.has(link.use_case_id)) continue

    const submittedOn = (link.coc_submitted_on ?? null) as IsoDate | null
    const signedOn = (link.coc_signed_on ?? null) as IsoDate | null
    const contact = link.coc_contact ?? ''
    const reference = link.coc_reference ?? ''

    const state: CocState = signedOn !== null ? 'signed' : submittedOn === null ? 'unsubmitted' : 'waiting'

    entries.push({
      nodeId: node.id,
      nodeName: node.name,
      useCaseId: link.use_case_id,
      managerId: node.account_manager_id,
      state,
      submittedOn,
      contact,
      reference,
      signedOn,
      // A future-dated submission clamps at 0 rather than reading -3 days: a
      // typo in the date box is not a reason to print a negative wait.
      waitingDays: submittedOn === null ? null : Math.max(0, diffDays(submittedOn, input.today)),
      untraceable: submittedOn !== null && signedOn === null && contact.trim() === '' && reference.trim() === '',
    })
  }

  const order = new Map(input.catalogue.map((u, i) => [u.id, i]))
  entries.sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state]
    if (byState !== 0) return byState
    // Oldest wait first inside `waiting`; the other two states have no age, so
    // they fall through to a stable, readable order.
    const ageA = a.waitingDays ?? -1
    const ageB = b.waitingDays ?? -1
    if (ageA !== ageB) return ageB - ageA
    const byName = a.nodeName.localeCompare(b.nodeName)
    if (byName !== 0) return byName
    return (order.get(a.useCaseId) ?? 0) - (order.get(b.useCaseId) ?? 0)
  })

  const waits = entries.filter((e) => e.state === 'waiting').map((e) => e.waitingDays ?? 0)

  return {
    entries,
    waiting: entries.filter((e) => e.state === 'waiting').length,
    unsubmitted: entries.filter((e) => e.state === 'unsubmitted').length,
    signed: entries.filter((e) => e.state === 'signed').length,
    untraceable: entries.filter((e) => e.untraceable).length,
    oldestWait: waits.length === 0 ? null : Math.max(...waits),
    organizations: new Set(entries.map((e) => e.nodeId)).size,
  }
}
