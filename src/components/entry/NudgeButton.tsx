// "Ask for an update" — the chase, as one tap and one permanent record.
//
// THE PROBLEM IT SOLVES. Three people carry five technical domains here, and the
// third of the four named pains is chasing colleagues for updates. Before this
// button that chase happened in WhatsApp, at a desk, or in a corridor, which
// means it left no trace: nobody could tell whether an item had gone quiet
// because it was forgotten or because someone had already asked twice and been
// ignored. Those are different situations with different next moves, and the app
// could not distinguish them. Now it can, and that — not the notification — is
// the point.
//
// IT IS A REQUEST, NOT A PROD, AND THE COPY IS THE FEATURE. This is a button
// whose whole purpose is to interrupt a colleague, so every string it renders
// was written to read as somebody asking a favour rather than a system issuing a
// reminder: "Ask for an update", not "Send reminder"; «اطلب تحديثًا», not
// «تذكير». The Arabic is workplace register — the voice a person uses to a peer,
// not the officialese of a ticketing system. A feature that reads as nagging
// gets muted in week one, and a muted nudge is worse than none, because the
// asker still believes it landed.
//
// FOUR GUARD RAILS, THREE OF THEM IN THE DATABASE:
//   1. Never yourself. `canNudge()` refuses to render on a row you own and
//      `nudge_entry()` raises `nudge_self` — the affordance and the policy agree,
//      which is lib/permissions.ts's rule applied to a second write path.
//   2. Never an owner-less row. `owner_name` is free text for a vendor, with no
//      profile and no inbox behind it; 0019 raises `nudge_no_owner` for both.
//   3. One ask per ENTRY per 24 hours, from ANYBODY — not per asker. The owner
//      is the person being interrupted, and two colleagues chasing the same item
//      in one afternoon is still two interruptions about one thing.
//   4. AFTER AN ASK, THE ROW STOPS OFFERING TO ASK — for as long as rail 3 says,
//      and on THAT clock alone. It states the record instead — "Asked 2 hours
//      ago" — which answers the question the second tap was going to ask.
//      `askOffer()` is the whole rule and it reads `mayAskAgain` and nothing
//      else: whether the item has MOVED since is a fact about the sentence the
//      row shows, never about whether the button exists. Deciding the offer
//      from `answered` put a first-ask button on a row the database was still
//      refusing, and every tap on it produced PT429.
//
// AND ONE THING IT DELIBERATELY DOES NOT DO: confirm(). The hard rule is a
// confirm in front of DESTRUCTIVE acts, and this is not one — nothing is lost, a
// colleague is asked. A dialog would tax all ninety-nine deliberate taps to
// protect a hundredth that costs one apologetic message, and would turn the "one
// tap" this feature is specified as into three. What it does instead is NAME THE
// PERSON in the success toast, so a mis-tap is visible the moment it happens
// rather than discovered in a puzzled reply. There is no undo, for the reason a
// sent email has none.
//
// ── WHERE THE STATE COMES FROM, AND WHY THERE IS NO FETCH ──────────────────
//
// `entries.nudged_at` / `nudged_by` are COLUMNS ON THE ENTRY (0019 PART 1), so
// this component reads the row it was handed. No loader, no store to warm, no
// second source that can disagree — and it works offline from the entries cache,
// because the ask is part of the entry now.
//
// `store/nudges` is an overlay for one thing only: the gap between the tap and
// the server's row arriving through realtime. Whichever stamp is LATER wins, so
// the overlay stops mattering by itself.
//
// ── "NO REPLY YET" IS COMPUTED, NOT STORED, AND 0019 IS WHY ────────────────
//
// The migration's single most important line is that a nudge must NOT move
// `last_activity_at` — PART 4 subtracts the nudge columns from the activity diff
// and PART 5 hands the pre-nudge value back by hand, so that chasing a neglected
// item cannot make it look attended to. That decision leaves the answer sitting
// in plain sight: `last_activity_at > nudged_at` means SOMETHING happened on the
// item after the ask, and anything else means nothing has. One comparison, no
// column, no join, and it cannot drift from the thing it describes.
//
// It says "since you asked" rather than strictly "the owner replied" — a status
// change or a colleague's comment also moves that clock. That is the honest
// reading for the question a person is holding at this row, which is "am I still
// waiting?", and the answer to that is no the moment the item moves at all.

import { useState, type ReactElement } from 'react'
import { NUDGE_WINDOW_MS } from '../../api/nudge'
import { formatRelativeTime } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { useMemberLabel, useMemberMap } from '../../store/members'
import { sendNudge, useLocalAsk } from '../../store/nudges'
import { toast } from '../toast'
import type { Entry } from '../../types'
import './nudge.css'

/**
 * Migration 0019's two columns, which `src/types.ts` does not declare yet.
 *
 * A SHIM WITH AN EXPIRY DATE, and the handoff carries the two-line diff that
 * removes it: types.ts is frozen after Wave 1 and append-only by the wave
 * integrator (§1.0.3), so a worker adding fields to `Entry` would be editing the
 * one file the rule exists to protect. `api/entries.ts` selects `*`, so the
 * columns are already on every row at runtime; this reads them without asserting
 * a shape TypeScript has not been told about.
 *
 * IT ALSO MAKES THE FEATURE SAFE ON A PROJECT WITHOUT 0019. Absent columns read
 * as undefined and are treated as "nobody has asked", so the row offers the
 * button, the RPC answers PGRST202, and `nudgeErrorKey()` turns that into "this
 * part of the app has not been set up yet" instead of a generic failure.
 */
function askedOnRow(entry: Entry): { at: string | null; by: string | null } {
  const row = entry as unknown as Record<string, unknown>
  return {
    at: typeof row.nudged_at === 'string' ? row.nudged_at : null,
    by: typeof row.nudged_by === 'string' ? row.nudged_by : null,
  }
}

/**
 * May this person be asked about this item?
 *
 * PURE, EXPORTED, AND THE ONLY DEFINITION. vitest runs `environment: 'node'`, so
 * a rule left inside a component is a rule no test here can reach — and this one
 * decides whether a colleague gets a notification. It mirrors two of the
 * refusals `nudge_entry()` raises, which is lib/permissions.ts's principle
 * applied to a second write path: resolve the answer BEFORE the affordance
 * renders, never after the request fails.
 *
 *   · `meId === null`     — signed out; there is no asker.
 *   · `owner_id === null` — nobody in the workspace owns it. The follow-ups
 *     screen has a whole bucket for that, with two controls for FIXING it;
 *     asking the void is not one of them.
 *   · `owner_id === meId` — you own it. Chasing yourself is a joke the second
 *     time and noise the third.
 *
 * `owner_name` is deliberately NOT a fallback: types.ts declares the two owner
 * columns mutually exclusive, and a free-text owner is somebody outside the
 * workspace with no profile to notify. The row simply shows no button, which is
 * honest — an affordance whose only possible outcome is a refusal is worse than
 * none.
 */
export function canNudge(entry: Entry, meId: string | null): boolean {
  return meId !== null && entry.owner_id !== null && entry.owner_id !== meId
}

/**
 * The ask that is still outstanding on this row, or null.
 *
 * PURE AND EXPORTED for the same reason `canNudge` is: this is the sentence the
 * row shows, and getting it wrong means either double-chasing a colleague or
 * hiding a chase that was never answered.
 *
 * Takes the LATER of the row's stamp and this session's overlay, so a tap shows
 * immediately and stops mattering the moment realtime catches up — and so a
 * colleague's ask, which only ever arrives on the row, is never masked by a
 * stale local one.
 *
 * `now` is a parameter with a default rather than a `Date.now()` read inside, so
 * the window arithmetic is testable without faking a clock.
 */
export function outstandingAsk(
  entry: Entry,
  local: { askedAt: string; askedBy: string } | undefined,
  now: number = Date.now(),
): { askedAt: string; askedBy: string | null; answered: boolean; mayAskAgain: boolean } | null {
  const row = askedOnRow(entry)
  // Both candidates, each with its parsed instant. Either may be absent, and
  // either may be unparseable — a hand-edited column, a build where 0019 has not
  // been applied and the columns are simply missing. NaN loses every comparison
  // below, so a bad value degrades into "nobody asked": the row offers the
  // button rather than rendering "Asked Invalid Date", and the server refuses a
  // duplicate with a sentence of its own if it really was asked.
  const candidates = [
    row.at === null ? null : { askedAt: row.at, askedBy: row.by, at: Date.parse(row.at) },
    local === undefined
      ? null
      : { askedAt: local.askedAt, askedBy: local.askedBy, at: Date.parse(local.askedAt) },
  ].filter((c): c is { askedAt: string; askedBy: string | null; at: number } => c !== null)

  // The LATEST readable one. A colleague's ask lives only on the row, so a stale
  // local overlay must never mask it; and this session's ask is newer than a row
  // realtime has not delivered yet, so it must not be masked either.
  let best: { askedAt: string; askedBy: string | null; at: number } | null = null
  for (const c of candidates) {
    if (Number.isNaN(c.at)) continue
    if (best === null || c.at > best.at) best = c
  }
  if (best === null) return null

  const activity = Date.parse(entry.last_activity_at)
  return {
    askedAt: best.askedAt,
    askedBy: best.askedBy,
    // See this file's header: 0019 keeps the activity clock still through a
    // nudge precisely so this comparison means what it reads as. An unparseable
    // activity clock answers "not answered", which keeps the ask visible — the
    // safe direction, because hiding it is what causes a double-chase.
    answered: !Number.isNaN(activity) && activity > best.at,
    mayAskAgain: now - best.at >= NUDGE_WINDOW_MS,
  }
}

/**
 * May the ask be OFFERED, and how must it be labelled? `null` means no button.
 *
 * PURE AND EXPORTED, like the two rules above it, and for a sharper reason:
 * this is the one rule that has to agree with 0019 line for line. The server's
 * gate is `v_nudged > v_now - interval '24 hours'` and NOTHING ELSE —
 * it does not care whether the item moved since. So neither may this.
 *
 * THE BUG IT REPLACES. The row used to fall back to a plain "Ask for an update"
 * the moment `answered` went true, which happens the instant anything at all
 * touches the item — the owner posting the very update that was asked for. An
 * item that is still overdue stays on Follow-ups, so the row then offered a
 * FIRST ask, inside a window the database was still refusing: tap → PT429 →
 * "Someone already asked about this one today" → refresh → the same dead button
 * back, every tap until the window expired. This file's own header calls an
 * affordance whose only possible outcome is a refusal worse than none.
 *
 *   · `null` ask   → 'first'. Nobody has asked; the plain offer.
 *   · `mayAskAgain` → 'again'. The window has reopened, so the server will
 *     accept it — and it is a repeat, which is what the label must say so
 *     nobody sends a second one believing it is the first.
 *   · otherwise    → `null`. Inside the window. The row states the ask instead.
 */
export function askOffer(ask: { mayAskAgain: boolean } | null): 'first' | 'again' | null {
  if (ask === null) return 'first'
  return ask.mayAskAgain ? 'again' : null
}

export interface NudgeButtonProps {
  entry: Entry
  /** The signed-in profile's id, or null. */
  meId: string | null
  /**
   * Extra classes for the BUTTON only — the screen's own action styling.
   *
   * Follow-ups passes `fu-act` so this button inks and reveals exactly like the
   * three beside it. The registry rule (§1.0.7) is that a screen's difference
   * rides on a class it passes IN, never on a selector reaching into another
   * sheet's tree, and this is that seam.
   */
  className?: string
}

/**
 * The ask, or the record of one.
 *
 * Returns null on a row nobody can be asked about, so a caller may render it
 * unconditionally inside a row's action slot and let this file own the rule.
 */
export default function NudgeButton({
  entry,
  meId,
  className,
}: NudgeButtonProps): ReactElement | null {
  const locale = useLocale()
  const memberMap = useMemberMap()
  const labelFor = useMemberLabel()
  const local = useLocalAsk(entry.id)
  /**
   * Only guards the frame between the tap and the optimistic overlay landing.
   *
   * `sendNudge()` writes the overlay before it awaits, so the button is normally
   * gone by the time a second tap could arrive — this closes the gap on a phone,
   * where a double-tap is one gesture and the second tap would be a second
   * notification for a colleague.
   */
  const [sending, setSending] = useState(false)

  if (!canNudge(entry, meId) || meId === null) return null

  const ownerLabel = labelFor(entry.owner_id, entry.owner_name)
  const ask = outstandingAsk(entry, local)
  const offer = askOffer(ask)

  const send = (): void => {
    if (sending) return
    setSending(true)
    void sendNudge(entry.id, meId).then((result) => {
      setSending(false)
      if (result.ok) {
        // Names the PERSON and the ITEM, because that is what makes a mis-tap
        // visible now instead of tomorrow. No undo: the notification has been
        // delivered and no button can recall it.
        toast(t('nudge.sent', { name: ownerLabel, title: entry.title }), { tone: 'success' })
        return
      }
      // Every refusal 0019 raises has its own sentence (api/nudge.ts
      // NUDGE_ERRORS). Rendered through t() from a KEY, never as a literal:
      // an English sentence written here would land untranslated in an RTL
      // layout, which is the defect lib/pgError.ts exists to prevent.
      toast(t(result.error), { tone: 'error' })
    })
  }

  const askButton = (kind: 'first' | 'again'): ReactElement => (
    <button
      type="button"
      className={`btn btn-sm btn-ghost ndg-act${className ? ` ${className}` : ''}`}
      onClick={send}
      disabled={sending}
      // The tooltip carries the WHO and the WHAT the label cannot: three rows on
      // a screen all say "Ask for an update" and they are three different
      // people. Same shape as this row's other action titles.
      title={t(kind === 'first' ? 'nudge.askOf' : 'nudge.askAgainOf', {
        name: ownerLabel,
        title: entry.title,
      })}
    >
      {/* TWO SPANS, ONE VISIBLE PER WIDTH, ONE ACCESSIBLE NAME.
          `.ndg-short` is the phone's word and `aria-hidden`; `.ndg-label` is the
          full sentence and is the accessible name at EVERY viewport, visually
          hidden below 640px where it does not fit. Both are whole strings from
          the locale tree — never a sentence assembled from two fragments, which
          is a translation nobody can write correctly.

          This control has no glyph form. nudge.css carries the 375px
          measurements: the full sentence leaves the row's title 31px wide, and
          the one verb costs exactly nothing — it measures the same 44px the
          speech bubble did. A tap that notifies a colleague, cannot be undone
          and has no confirm may not be a picture. */}
      <span className="ndg-short" aria-hidden="true">
        {t('nudge.askShort')}
      </span>
      <span className="ndg-label">{t(kind === 'first' ? 'nudge.ask' : 'nudge.askAgain')}</span>
    </button>
  )

  // Nobody has asked: the plain first offer, and nothing to report.
  if (ask === null) return askButton('first')

  // THE WINDOW DECIDES, NOT THE MOVEMENT — see askOffer(). `null` here means
  // the database would refuse, so no button is drawn at all.
  const button = offer === null ? null : askButton(offer)

  // ANSWERED, AND THE WINDOW HAS REOPENED. The record is spent — something
  // happened on the item after the ask — so there is nothing outstanding to
  // report and a row carrying a spent record has stopped being scannable. The
  // offer comes back alone, labelled "Ask again", because it IS a repeat.
  if (ask.answered && button !== null) return button

  const when = formatRelativeTime(ask.askedAt, locale)
  const mine = ask.askedBy !== null && ask.askedBy === meId
  /**
   * The live profile first, the snapshot never — 0019 stores only `nudged_by`,
   * so there is no denormalised name to fall back to and the members store is
   * the single resolver. api/notifications.ts states the same order for the same
   * reason: `on delete set null` means an asker whose profile is gone is a real
   * state, and it is the one `nudge.someone` covers.
   */
  const askerName =
    (ask.askedBy !== null ? memberMap.get(ask.askedBy)?.displayName?.trim() : '') ||
    t('nudge.someone')

  /**
   * "Nothing since" IS A CLAIM, so it is only made when it is true.
   *
   * The only answered ask that reaches this point is one still inside the
   * window — the state that used to render a dead button. What it renders now is
   * the record ALONE, with a sentence that says what actually happened: somebody
   * asked, and the item has moved since. Saying "nothing since" there would be a
   * lie the reader could disprove by scrolling to the update thread, and
   * rendering nothing at all would leave the missing button unexplained.
   */
  const sentence = ask.answered
    ? mine
      ? t('nudge.answeredByYou', { time: when })
      : t('nudge.answeredByOther', { name: askerName, time: when })
    : mine
      ? t('nudge.askedByYou', { time: when })
      : t('nudge.askedByOther', { name: askerName, time: when })

  return (
    <>
      {/* Terse text, full sentence as the accessible name — the same treatment
          `.fu-sla` gives the resolved service window two buttons over, and for
          the same reason: a row is SCANNED, so "Asked 2 days ago" is what the
          eye needs, while "Sara asked for an update 2 days ago — no reply yet"
          is what an answer needs. The `warn` tint appears only once the window
          has reopened, which is the moment the record stops being reassurance
          ("it has been asked") and starts being a prompt ("and nothing came
          back") — and never on an answered ask, because the early return above
          means `mayAskAgain` here always carries `answered === false`. */}
      <span
        className={`pill tabular ndg-pill${ask.mayAskAgain ? ' warn' : ''}`}
        role="img"
        aria-label={sentence}
        title={sentence}
      >
        {t('nudge.pill', { time: when })}
      </span>
      {/* THE CHASE HAS TO BE REPEATABLE OR IT IS NOT A CHASE. Hiding the button
          forever after one unanswered ask would leave the app's answer to "they
          still have not replied" being "then use WhatsApp" — which is the
          workflow this feature exists to replace. It comes back after 0019's
          window, labelled as a repeat so nobody sends a second one believing it
          is the first, and the pill beside it says how long the silence has
          been. `button` is null for exactly as long as 0019 would refuse it. */}
      {button}
    </>
  )
}
