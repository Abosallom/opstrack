// Follow-ups — the home screen, and the one question this product exists to
// answer: what needs me today?
//
// IT OWNS NO DEFINITION OF "NEEDS ATTENTION". Every bucket on this screen comes
// out of `lib/entrySections.bucketFollowUps`, which the board's section counts,
// the dashboard and the digest also call. If this file computed its own
// "overdue", the list a person triages in the morning and the digest they send
// at noon would disagree about what is late — the single most corrosive bug this
// app can ship. Same rule for the health map (`useHealthMap`, server view first,
// client mirror only for rows the view has not seen), for filtering
// (`lib/entryFilter` through `useFilteredEntries`) and for the rows themselves
// (`components/entry`). Nothing here is re-implemented; everything is imported.
//
// SECTIONS WITH NO ROWS ARE NOT RENDERED. Six headings reading "(0)" is a screen
// that looks busy while saying nothing, and the empty state below carries the
// "all clear" message far better than six empty boxes do. The count in each
// heading is therefore always ≥ 1, and the six counts always add up to the
// number the filter bar announces — bucketFollowUps puts an entry in AT MOST ONE
// section, and the footnote says so.
//
// ORDERING IS PER SECTION, on purpose. `selectEntries` sorts by the filter's
// sort (activity, newest first) and `bucketFollowUps` preserves that order, so
// Stale/Blocked/Unassigned read newest-first as everywhere else in the app. But
// "overdue" and "due soon" are questions about DATES: the item that slipped
// three weeks ago has to be above the one that slipped yesterday, so those two
// buckets are re-sorted by due date ascending. That is a display decision and it
// lives here, which is exactly why bucketFollowUps refuses to bake in a sort.
//
// TWO SWIPE ACTIONS, AND A BUTTON FOR EACH. Swipe toward the inline END opens a
// quick update; swipe toward the inline START snoozes the follow-up date by
// three days. `useSwipeActions` resolves the direction logically at gesture
// start, so the Arabic user's thumb does the same thing the English user's does
// with no mirror rules here. A gesture is never the ONLY path to an action: both
// live as real <button>s in the row's action slot, inked --text-faint until the
// row is hovered or holds focus, and --text-dim on a touch device where there is
// no hover to reveal them. That quiet state was an `opacity: 0.62` for three
// waves and it was a WCAG 1.4.3 failure at 2.89:1 — see followups.css and the
// gate in src/styles/contrast.test.ts.
//
// TRIAGE CAN FINISH AN ITEM, NOT ONLY DEFER ONE. For a long time this row could
// take, comment on and snooze an item but not complete it: the only route to
// Done was tap the row, wait for the sheet, scroll past the title and the whole
// Description block, tap the status chip, dismiss the sheet — and there was no
// keyboard route at all, because the 1-4 status hotkeys act on whatever the
// DETAIL surface is showing (lib/hotkeys.ts) and answer nothing on a focused
// list row. So the most common and most satisfying outcome of a morning pass was
// the slowest thing on the screen, while pushing an item three days out was one
// tap. "Mark done" is now a button in the row's action slot beside the other
// two, and it carries an UNDO in its toast rather than a confirm dialog in front
// of it — a confirm taxes the ninety-nine correct taps to protect the hundredth,
// and undo taxes only the mistake. It writes through `store/entries.setStatus`,
// so optimism, rollback and the outbox are the store's exactly as before.
//
// THE SECTIONS FOLD PAST MAX_ROWS. See that constant.
//
// THE SLA SOURCE IS INFERRED FROM THE VIEW'S OWN ANSWER, and that is a
// considered choice rather than a missing dependency.
//
// WAVE2-NOTES makes the SLA a track × priority matrix (migration 0006
// `track_slas`), resolved `track_slas → vocab_options.sla_days → null`, and
// `lib/health.resolveSlaDays()` is that rule in TypeScript. Calling it here
// would mean holding the whole matrix on this screen — `api/tracks.listTrackSlas()`
// exists, but nothing puts its answer in a store, so every list screen would
// fetch and cache it for itself.
//
// The alternative used here needs no matrix at all: `sla_due_at` on the row was
// ALREADY resolved by the view, so `sla_due_at - created_at` IS the effective
// window, and comparing it against what the priority default alone would have
// produced says which level answered. Two properties follow, and they are the
// reason this is not merely the cheaper option:
//   · the DAY COUNT is always exactly the window the server used, with no
//     window between mount and a fetch landing in which the screen states a
//     number that contradicts the pill beside it;
//   · it cannot drift from the view, because it is derived from the view.
// The one case it reads imprecisely is a track override set to the SAME number
// as the priority default, where it says "default" — the effective window is
// identical either way, so the sentence is imprecise about provenance and
// correct about the commitment.
//
// THE UPGRADE, when a store holds the matrix (see the handoff): delete
// resolveSla() and read `resolveSlaDays()` plus a map lookup for the source.

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import FilterBar, { type FilterFacet } from '../components/FilterBar'
import { EntryRow, EntrySection, useSwipeActions, type EntryRowShow } from '../components/entry'
// Imported from the file rather than through `components/entry`'s barrel: that
// barrel is another worker's module (§1.0.4) and this control arrived after it
// was written. The handoff files the two-line re-export so the one-import-path
// rule holds again at the wave close.
import NudgeButton from '../components/entry/NudgeButton'
import { IconChecklist, IconClock, IconUser } from '../components/icons'
import { IconCheck, IconPlus } from '../components/fields/glyphs'
import { EmptyState, Skeleton } from '../components/shared'
import { toast } from '../components/toast'
import { formatDate, formatRelativeTime } from '../lib/dates'
import {
  EMPTY_FILTER,
  filterFromParams,
  filterToParams,
  isFilterEmpty,
  sortEntries,
  type EntrySort,
  type FilterState,
} from '../lib/entryFilter'
import { bucketFollowUps, type FollowUpSections } from '../lib/entrySections'
import { t, useLocale } from '../lib/i18n'
import { canEditEntry } from '../lib/permissions'
import { useAuth } from '../store/auth'
import { openEntry } from '../store/entrySheet'
import {
  loadEntries,
  patchEntry,
  postUpdate,
  refreshEntries,
  setStatus,
  snoozeFollowUp,
  useEntriesCoverage,
  useEntriesError,
  useEntriesLoading,
  useFilterContext,
  useFilteredEntries,
  useHealthMap,
} from '../store/entries'
import { useMembers } from '../store/members'
import { useSlaDays, useStaleDays } from '../store/vocab'
import type { Member } from '../api/members'
import type { ApiResult } from '../api/result'
import type { Entry, EntryHealth, EntryUpdate, NewEntryUpdate } from '../types'
import './followups.css'

/** How far a snooze pushes the follow-up date. Measured from TODAY by the store. */
const SNOOZE_DAYS = 3

/**
 * store/entries.ts's private QUEUED_KEY, duplicated as a literal here for the
 * reason Board.tsx:193 and Capture.tsx:92 duplicate it: the store does not
 * export it. It is a NOTICE, not a failure (store/outbox.ts:488) — the write is
 * in the outbox and its optimistic row is already on screen.
 *
 * The three handlers below that only skip a success TOAST on it can treat it as
 * a failure without harm; `handlePost` cannot, because it also owns the
 * composer. See the comment there.
 */
const QUEUED_KEY = 'offline.queued'

/**
 * Post one quick update and answer whether the COMPOSER MAY CLOSE.
 *
 * Exported, and lifted out of `handlePost`, for CommandPalette.tsx's reason:
 * vitest runs `environment: 'node'`, so a decision inside an event handler is a
 * decision no test here can reach. `post` and `notify` default to the real
 * implementations, so the screen reads as it did.
 *
 * A QUEUED write closes the composer and clears the text, exactly as a landed
 * one does. Treating it as a failure — which is what `if (!result.ok) return
 * false` did — leaves the box open with the sentence still in it and no toast,
 * WHILE the update is already visible in the entry's thread. The second Post
 * that invites is not a retry but a second ROW: `postUpdate()` mints a fresh
 * tempId per call (entries.ts:1576) and `dedupeKeyFor()` keys off it, so the
 * two never collapse in the outbox, and `entry_updates` has no UPDATE and no
 * DELETE policy (0001:408-416) — once they flush, the audit trail says it twice
 * forever. Board.tsx:761 and Capture.tsx:504 take the same branch.
 */
export async function postQuickUpdate(
  entry: Entry,
  body: string,
  post: (i: NewEntryUpdate) => Promise<ApiResult<EntryUpdate>> = postUpdate,
  notify: (message: string, opts?: { tone?: 'success' }) => void = toast,
): Promise<boolean> {
  const result = await post({ entryId: entry.id, body })
  if (result.ok) {
    notify(t('followups.posted', { title: entry.title }), { tone: 'success' })
    return true
  }
  if (result.error !== QUEUED_KEY) return false
  // Not "Update added": the row is on this device and nowhere else yet, and
  // this screen is used on a phone in corridors where that is the difference
  // that matters. The offline banner carries the count; this carries the fact.
  notify(t(QUEUED_KEY))
  return true
}

/**
 * How far the row travels under the finger, and how far it must travel to arm.
 *
 * The cap is the exact inline size of the revealed hint strip — wide enough for
 * a glyph over a two-word label at 11px — and followups.css contains the row's
 * travel with `overflow-x: clip` so it can never reach the page's own edge. See
 * that file's note for why `clip` and not `hidden`.
 */
const SWIPE_CAP_PX = 88
const SWIPE_ARM_PX = 64

const DAY_MS = 86_400_000

/**
 * How far apart two SLA deadlines have to be before they are different answers.
 *
 * `v_entry_health` computes `created_at + sla_days * interval '1 day'` in
 * Postgres and `lib/health.ts` computes `created_at + sla_days * 86400000` in
 * JavaScript; across a DST boundary those differ by an hour, and PostgREST's
 * rendering of the offset adds no error but no guarantee either. Overrides are
 * whole days apart — a track override differs from the default by 24 hours at
 * the very least — so half a day is wide enough to absorb every representation
 * difference and nowhere near wide enough to swallow a real override.
 */
const SLA_TOLERANCE_MS = 12 * 3_600_000

/** The facets this screen offers. `mine` and `scope` are deliberately absent:
 *  `mine` has its own segmented control in the header (it is the screen's
 *  primary axis, not a detail behind a disclosure) and follow-ups is a question
 *  about OPEN work by construction — bucketFollowUps never buckets a closed
 *  entry, so a scope switch here would be a control that does nothing. */
/*  `group` leads the narrowing facets, above `track`, per FilterBar's
 *  DEFAULT_FACETS. This is the screen where it earns the most: "what is slipping
 *  on my half" is the question three people carrying five domains ask every
 *  morning, and before 0018 the only way to ask it was to tick six tracks. */
const FACETS: readonly FilterFacet[] = [
  'search',
  'group',
  'track',
  'status',
  'priority',
  'type',
  'owner',
  'tag',
  'health',
]

type SectionKey = keyof FollowUpSections
type Density = 'comfortable' | 'compact'

interface SectionSpec {
  key: SectionKey
  tone: 'danger' | 'warn' | 'default'
  /** Re-sort this bucket for display. Absent ⇒ keep the filter's own order. */
  sort?: EntrySort
}

/**
 * The spec's order, with the SLA bucket second — it is the same kind of fact as
 * overdue (a commitment already missed) and ranks above anything that can still
 * be kept. This array is the ONLY place the order is written down; the headings,
 * the counts and the sibling list for the detail sheet's prev/next all walk it.
 */
const SECTIONS: readonly SectionSpec[] = [
  { key: 'overdue', tone: 'danger', sort: 'due' },
  { key: 'slaBreach', tone: 'danger' },
  { key: 'dueSoon', tone: 'warn', sort: 'due' },
  { key: 'stale', tone: 'warn' },
  { key: 'blocked', tone: 'default' },
  { key: 'unassigned', tone: 'default' },
]

/**
 * The buckets where asking a colleague for an update is a REASONABLE thing to
 * do — the screen's half of the nudge rule. (`NudgeButton.canNudge` owns the
 * other half: who may be asked. Two questions, two owners.)
 *
 * FOUR OF THE SIX, and the two omissions are the argument:
 *
 *   · `dueSoon` is out because NOTHING HAS GONE WRONG YET. An item due on
 *     Thursday, on Tuesday, with its owner working on it, is the single easiest
 *     way to turn this button into the thing colleagues learn to ignore — and
 *     the copy can only carry so much; a request sent for no reason still reads
 *     as a prod. The four that remain each name a fact the owner would want to
 *     know about: a promise already missed, a service window already blown, an
 *     item that has gone silent, or one that is blocked and may be waiting on
 *     something the asker can unblock.
 *   · `unassigned` is out because there is nobody to ask, by construction —
 *     `bucketFollowUps` puts a row there only when both owner columns are empty.
 *     That bucket already carries the two controls that FIX it (take it, assign
 *     it), which is the correct answer to an unowned item and is not "chase".
 *
 * `slaBreach` is IN, and that is a deliberate reading of "overdue": the
 * follow-ups spec names stale, blocked and overdue, and an SLA breach is the
 * same kind of fact as an overdue date — a commitment already missed on an open
 * item somebody else owns. The difference is only whose promise it was (one
 * person's date vs the workspace's service window), and that difference does not
 * change whether asking is fair.
 */
const NUDGEABLE: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'overdue',
  'slaBreach',
  'stale',
  'blocked',
])

/**
 * Density survives navigation without touching storage.
 *
 * A module-level value, not localStorage: the preference is worth keeping while
 * someone bounces between the board and this screen, and not worth a persisted
 * key, a migration and a quota failure mode. It resets on reload, which is the
 * honest lifetime of an in-session display toggle.
 */
let densityPref: Density = 'comfortable'

/**
 * Rows mounted per section before the fold.
 *
 * Measured, not guessed: one comfortable EntryRow is 34 DOM elements, and a
 * FollowUpRow wraps it in a swipe container, two hint strips, an SLA pill and up
 * to four action buttons that each carry a glyph AND a label — 56 elements a
 * row. Five hundred rows is 28 000 elements on the screen this product exists to
 * open first thing in the morning, on a phone. The board already folds at 25/40
 * per column for exactly this reason and says so in `MAX_CARDS`.
 *
 * The heading count stays the bucket's TRUE total — EntrySection takes it as a
 * prop precisely so a sliced body cannot make the number lie — and the fold
 * button says how many are behind it.
 */
const MAX_ROWS: Readonly<Record<Density, number>> = { comfortable: 25, compact: 40 }

/**
 * The select value meaning "nobody yet" — TracksIndex.tsx's `OWNER_NONE`, the
 * same empty string for the same reason: it is the one value a <select> can
 * carry that is never a member id.
 *
 * The tree's control also needs an `OWNER_NAME` sentinel for a free-text vendor
 * and an orphan branch for an owner_id whose profile is gone. This one needs
 * neither, and that is a property of WHERE it renders rather than a shortcut:
 * `bucketFollowUps` puts an entry in this bucket only when
 * `owner_id === null && (owner_name ?? '').trim() === ''`, so every row carrying
 * this control is unowned by both measures.
 */
const OWNER_NONE = ''

/**
 * The owner mark, off — hoisted to module scope rather than written inline.
 *
 * `show={{ owner: false }}` at a call site is a fresh object per render, which
 * is the exact prop hazard R2-PERF-1 fixed one prop over: it defeats memo()'s
 * shallow compare for every row that receives it. A module constant is the same
 * object forever.
 */
const SHOW_NO_OWNER: EntryRowShow = { owner: false }

interface SlaFacts {
  /** The RESOLVED window in days, whichever level supplied it. */
  days: number
  source: 'track' | 'priority'
}

/**
 * Where this entry's service deadline came from — see this file's header for why
 * it is inferred from the view's own answer rather than looked up.
 *
 * Returns null when there is no deadline at all, which is the seeded state:
 * migration 0005 ships every priority's `sla_days` NULL so nothing is
 * retroactively in breach, and this screen must render exactly nothing extra
 * until an admin arms an SLA deliberately.
 */
function resolveSla(
  entry: Entry,
  health: EntryHealth | undefined,
  priorityDays: number | null,
): SlaFacts | null {
  if (!health || health.sla_due_at === null) return null
  const due = Date.parse(health.sla_due_at)
  const created = Date.parse(entry.created_at)
  // A row whose timestamps will not parse loses its marker, not the screen —
  // this runs on the render path of every breached row.
  if (Number.isNaN(due) || Number.isNaN(created)) return null

  const days = Math.max(1, Math.round((due - created) / DAY_MS))
  // No priority default and yet a deadline exists ⇒ only a track override can
  // have produced it. This is the case that appears the day 0006 lands.
  if (priorityDays === null) return { days, source: 'track' }
  const asDefault = created + priorityDays * DAY_MS
  return { days, source: Math.abs(due - asDefault) <= SLA_TOLERANCE_MS ? 'priority' : 'track' }
}

/**
 * The breached rows' SLA facts, REUSING the previous object wherever the answer
 * has not changed.
 *
 * `resolveSla` mints a fresh `{days, source}` per call, so rebuilding this map
 * on every commit handed every breached row a new `sla` prop and defeated
 * `memo()` on it — the same defect as an unstable `onOpen`, one prop over, and
 * it would have survived that fix. Comparing the two fields is cheaper than the
 * render it saves, and `days`/`source` are the whole of the value: two facts
 * that compare equal are interchangeable, so handing back the older object
 * changes nothing a reader can see except how often React redraws the row.
 *
 * Pure, and exported for the test: `prev` is passed in rather than read from a
 * closure precisely so the reuse can be asserted without a DOM.
 */
export function buildSlaFacts(
  entries: readonly Entry[],
  health: ReadonlyMap<string, EntryHealth>,
  slaDaysFor: (priority: Entry['priority']) => number | null,
  prev: ReadonlyMap<string, SlaFacts>,
): Map<string, SlaFacts> {
  const map = new Map<string, SlaFacts>()
  for (const entry of entries) {
    const row = health.get(entry.id)
    if (row?.sla_breached !== true) continue
    const facts = resolveSla(entry, row, slaDaysFor(entry.priority))
    if (!facts) continue
    const before = prev.get(entry.id)
    map.set(
      entry.id,
      before !== undefined && before.days === facts.days && before.source === facts.source
        ? before
        : facts,
    )
  }
  return map
}

/* ══════════════════════════════ the row ══════════════════════════════ */

interface FollowUpRowProps {
  entry: Entry
  health: EntryHealth | undefined
  sla: SlaFacts | null
  canEdit: boolean
  density: Density
  /** Only the unassigned bucket offers the two OWNER controls — everywhere else
   *  the owner question is already answered and they would be a way to steal or
   *  reroute someone's work from a list they were only scanning. */
  offerOwner: boolean
  /** The people work can be handed to. Only read when `offerOwner`. */
  members: readonly Member[]
  /**
   * Is this bucket one where chasing is fair? See NUDGEABLE.
   *
   * The SECOND half of the rule — whether this particular row has somebody who
   * can be asked — is `NudgeButton.canNudge`, inside the component, which
   * returns null when the answer is no. So this flag is about the SECTION and
   * never about the entry, and the two conditions are never written down in the
   * same place.
   */
  nudgeable: boolean
  /**
   * The signed-in profile's id. Needed for the nudge rule (you cannot ask
   * yourself) and for telling "you asked" from "Sara asked" on the record.
   *
   * Passed in rather than read from `useAuth()` inside the row: this component
   * is memo()'d and mounted up to 150 times, and a store subscription per row is
   * the hazard EntryRow's header describes one file over.
   */
  meId: string | null
  quickOpen: boolean
  onOpen: (id: string) => void
  onQuick: (id: string) => void
  onCloseQuick: () => void
  onSnooze: (entry: Entry) => void
  onTake: (entry: Entry) => void
  /** The MEMBER, not their id: the row picked them out of the list it rendered
   *  the options from, so the name can never fail to resolve at the screen. */
  onAssign: (entry: Entry, member: Member) => void
  onDone: (entry: Entry) => void
  onPost: (entry: Entry, body: string) => Promise<boolean>
}

const FollowUpRow = memo(function FollowUpRow({
  entry,
  health,
  sla,
  canEdit,
  density,
  offerOwner,
  members,
  nudgeable,
  meId,
  quickOpen,
  onOpen,
  onQuick,
  onCloseQuick,
  onSnooze,
  onTake,
  onAssign,
  onDone,
  onPost,
}: FollowUpRowProps): ReactElement {
  useLocale()

  // The armed direction, mirrored into a ref because `onEnd` fires during
  // pointerup and has to read the value the last pointermove settled on.
  // useSwipeActions keeps the latest callback in a ref of its own, so the
  // closure it calls is this render's — but reading state through a ref is one
  // less thing to reason about at the moment a gesture commits.
  const armed = useRef<'start' | 'end' | null>(null)
  // The composer is a sibling of the button that opens it, not a child, so
  // aria-expanded needs an aria-controls to point at or it announces a state
  // with no object.
  const quickId = useId()

  /**
   * A gesture just finished, so the click it is about to produce is not a tap.
   *
   * EntryRow's title button stretches an ::after over the entire row — that is
   * how the row gets one large hit target without a fake button in the
   * accessibility tree — which means pointerdown and pointerup during a swipe
   * both land on it and the browser fires a click at the end of every single
   * swipe. Without this guard, snoozing an item also opened it.
   *
   * Cleared on a macrotask so a swipe that somehow produces NO click cannot
   * leave the flag set and swallow the next real tap: the click event is
   * dispatched immediately after pointerup, well before a timeout of 0 runs.
   */
  const swiped = useRef(false)

  const swipe = useSwipeActions({
    threshold: SWIPE_ARM_PX,
    onStart: () => {
      swiped.current = false
    },
    onEnd: () => {
      // Any horizontal gesture suppresses the click, not just one past the
      // threshold — a 20px drag is still not a tap.
      swiped.current = true
      setTimeout(() => {
        swiped.current = false
      }, 0)
      const dir = armed.current
      if (dir === 'end') onQuick(entry.id)
      // The permission answer is resolved BEFORE the affordance, never after
      // the request fails — the same rule the disabled button beside it obeys.
      // A gesture has no disabled state to show, so it says why instead.
      else if (dir === 'start') {
        if (canEdit) onSnooze(entry)
        else toast(t('followups.snoozeDisabled'), { tone: 'error' })
      }
    },
  })
  armed.current = swipe.active

  const travel = Math.max(-SWIPE_CAP_PX, Math.min(SWIPE_CAP_PX, swipe.offset))
  const dragging = travel !== 0
  const drag = dragging ? (travel > 0 ? 'end' : 'start') : undefined

  const slaLabel =
    sla === null
      ? null
      : t(sla.source === 'track' ? 'followups.slaFromTrack' : 'followups.slaFromPriority', {
          count: sla.days,
        })

  return (
    <div className="fu-swipe" data-drag={drag} data-armed={swipe.active ?? undefined}>
      {/* Decorative: each strip repeats what the button beside it already says,
          and a screen reader that announced both would announce every action
          twice per row. */}
      <span className="fu-swipe-hint" data-act="update" aria-hidden="true">
        <IconPlus size={14} />
        {t('followups.addUpdate')}
      </span>
      <span className="fu-swipe-hint" data-act="snooze" aria-hidden="true">
        <IconClock size={14} />
        {t('followups.snoozeThreeDays')}
      </span>

      <div
        className="fu-swipe-row"
        data-dragging={dragging ? 'true' : undefined}
        style={{ '--fu-x': `${travel}px` } as CSSProperties}
        onClickCapture={(e) => {
          if (!swiped.current) return
          swiped.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        {...swipe.handlers}
      >
        <EntryRow
          entry={entry}
          health={health}
          density={density}
          // On an unassigned row the owner badge says "Unassigned" under a
          // heading that already says Unassigned, so the select below REPLACES
          // it rather than joining it: the row gains a control and loses a
          // repetition instead of gaining a fifth thing to read. TracksIndex
          // makes the same swap for the same reason.
          show={offerOwner ? SHOW_NO_OWNER : undefined}
          canEdit={canEdit}
          onOpen={onOpen}
          actions={
            <>
              {slaLabel !== null && sla !== null ? (
                // The resolved SOURCE, not just the fact of a breach — the
                // HealthPill already says "past its service deadline", and the
                // question that follows it is always "whose deadline?".
                <span
                  className="pill fu-sla tabular"
                  role="img"
                  aria-label={slaLabel}
                  title={slaLabel}
                >
                  {t('followups.slaDays', { count: sla.days })}
                </span>
              ) : null}
              {/* THE CHASE, and the record of one — the third of the four pains
                  this product exists for, and the only one the app had no
                  feature for at all.

                  IT SITS HERE, before the three action buttons, because it
                  renders a PILL as well as a button: "asked 2 days ago, no
                  reply" is a fact about the row and belongs beside the SLA fact,
                  not after three verbs. The consequence is that on a row someone
                  ELSE owns, "Ask for an update" is the first control — which is
                  the right order for exactly those rows, since marking someone
                  else's work done is the rarer intent. On a row you own the
                  component renders nothing, so "Mark done" is still first there.

                  `fu-act` is passed IN rather than reached for from nudge.css:
                  the registry rule (§1.0.7) is that a screen's difference rides
                  on a class it hands over, so the button inks and reveals with
                  its three neighbours and nudge.css never learns this screen
                  exists. */}
              {nudgeable ? <NudgeButton entry={entry} meId={meId} className="fu-act" /> : null}
              {/* Each action carries BOTH a glyph and its words, and the
                  stylesheet decides which one is drawn: full text where there is
                  room, glyph-only below 640px with the words moved into the
                  accessible name. Three text buttons plus a pill measured wider
                  than the title on a 375px row, which pushed the meta line into
                  a five-line stack and overlapped the health pill. */}
              {/* THE UNASSIGNED BUCKET GETS TWO OWNER CONTROLS, NOT ONE, and
                  the second is the point of the section.

                  For three waves this row offered "Take it" and nothing else —
                  so the one bucket that exists BECAUSE nobody owns the work
                  could only ever be resolved by the reader owning it
                  themselves. For a department head with six tracks that is the
                  wrong verb: the morning question at this heading is "who is
                  picking this up", and the only answer the screen accepted was
                  "me". The owner badge was inert (atoms.tsx renders a plain
                  <span>), and nothing on the screen linked anywhere that could
                  assign, so distributing work meant opening each item and
                  scrolling to its owner picker.

                  Both stay, because they are different actions rather than one
                  action twice. "Take it" is the single commonest triage outcome
                  and has to remain ONE tap; a select would make it three. The
                  select is the delegation path, and it is deliberately the same
                  control TracksIndex already ships — same shape, same
                  `{ ownerId, ownerName: null }` patch, same store — so nothing
                  new was invented for it. */}
              {offerOwner ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost fu-act"
                    onClick={() => onTake(entry)}
                    disabled={!canEdit}
                    title={canEdit ? t('followups.takeIt') : t('followups.snoozeDisabled')}
                  >
                    <IconUser size={15} className="fu-act-icon" />
                    <span className="fu-act-label">{t('followups.takeIt')}</span>
                  </button>
                  <select
                    className="select fu-owner"
                    // The value is ALWAYS OWNER_NONE: this bucket holds only
                    // unowned rows, and a row that gains an owner leaves it. So
                    // the control is a one-way hand-off rather than an editor,
                    // and it needs neither the tree's free-text sentinel nor its
                    // orphan branch.
                    value={OWNER_NONE}
                    disabled={!canEdit || members.length === 0}
                    aria-label={t('followups.assignFor', { title: entry.title })}
                    title={canEdit ? t('followups.assign') : t('entry.cannotEdit')}
                    onChange={(ev) => {
                      // Resolved HERE, out of the very list these options were
                      // built from, so the screen's toast can never be handed an
                      // id it cannot name.
                      const picked = members.find((m) => m.id === ev.target.value)
                      if (picked !== undefined) onAssign(entry, picked)
                    }}
                  >
                    <option value={OWNER_NONE}>{t('followups.assign')}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              {/* The outcome the whole pass is aiming at, so it sits first
                  among the three and is the only one drawn in the success
                  colour. No confirm in front of it — the toast carries an
                  undo, which charges the mistake instead of every correct
                  tap. */}
              <button
                type="button"
                className="btn btn-sm btn-ghost fu-act fu-act-done"
                onClick={() => onDone(entry)}
                disabled={!canEdit}
                // `entry.cannotEdit`, not `followups.snoozeDisabled`: the two
                // buttons beside this one explain a refusal with the wrong verb
                // because they predate any other action on the row, and
                // inheriting that is how a wart becomes a convention.
                title={canEdit ? t('followups.markDone') : t('entry.cannotEdit')}
              >
                <IconCheck size={15} className="fu-act-icon" />
                <span className="fu-act-label">{t('followups.markDone')}</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost fu-act"
                aria-expanded={quickOpen}
                aria-controls={quickOpen ? quickId : undefined}
                title={t('followups.addUpdate')}
                onClick={() => onQuick(entry.id)}
              >
                <IconPlus size={15} className="fu-act-icon" />
                <span className="fu-act-label">{t('followups.addUpdate')}</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost fu-act"
                onClick={() => onSnooze(entry)}
                disabled={!canEdit}
                title={canEdit ? t('followups.snoozeThreeDays') : t('followups.snoozeDisabled')}
              >
                <IconClock size={15} className="fu-act-icon" />
                <span className="fu-act-label">{t('followups.snoozeThreeDays')}</span>
              </button>
            </>
          }
        />
      </div>

      {quickOpen ? (
        <QuickUpdate id={quickId} entry={entry} onCancel={onCloseQuick} onPost={onPost} />
      ) : null}
    </div>
  )
})

/* ═════════════════════════ the quick update ═════════════════════════ */

/**
 * Appending to the thread WITHOUT leaving the list.
 *
 * This is the whole point of the inline-end swipe: the most common answer to
 * "what needs me today" is a sentence, and making someone open a detail panel,
 * find the composer, type, post and navigate back turns a ten-second triage pass
 * into a three-minute one. It posts through `store/entries.postUpdate`, which is
 * optimistic and outbox-routed like every other write in the app — the row's
 * activity timestamp moves, the entry leaves the Stale bucket, and none of that
 * is re-implemented here.
 */
function QuickUpdate({
  id,
  entry,
  onCancel,
  onPost,
}: {
  id: string
  entry: Entry
  onCancel: () => void
  onPost: (entry: Entry, body: string) => Promise<boolean>
}): ReactElement {
  useLocale()
  const fieldId = `${id}-field`
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const text = body.trim()
    if (text === '' || busy) return
    setBusy(true)
    const ok = await onPost(entry, text)
    // Only clear on success. A failed post that blanks the textarea has thrown
    // away the one copy of what the user wrote.
    if (ok) setBody('')
    setBusy(false)
  }

  return (
    <form
      id={id}
      className="fu-quick"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="sr-only" htmlFor={fieldId}>
        {t('followups.quickLabel', { title: entry.title })}
      </label>
      <textarea
        id={fieldId}
        className="input fu-quick-input"
        rows={2}
        // The composer is opened by an explicit gesture on a specific row, so
        // focus belongs in it — the alternative is a box that appears under the
        // user's thumb and still needs a tap to type into.
        autoFocus
        value={body}
        placeholder={t('followups.quickPlaceholder')}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
          // The same shortcut the detail thread and every chat client use. Plain
          // Enter stays a newline: an update is often two sentences.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="fu-quick-row">
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || body.trim() === ''}>
          {busy ? t('entry.saving') : t('followups.quickPost')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

/* ══════════════════════════ the screen ══════════════════════════ */

export default function FollowUps(): ReactElement {
  const locale = useLocale()
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const role = profile?.role ?? 'member'

  /* ── the filter, in the URL ───────────────────────────────────────────────
   *
   * It was `useState({ ...EMPTY_FILTER })` for three waves, and Follow-ups is a
   * LAZY ROUTE (App.tsx) — so every trip to the board and back unmounted this
   * screen and reset search, track, tag, health and the Mine/Everyone segment,
   * while `densityPref`, the purely cosmetic module-level preference above, was
   * deliberately built to survive exactly that trip and did. The two controls
   * are adjacent chip-pairs in the same `.fu-tools` row, so the user watched one
   * persist and its neighbour forget, all day, on a phone where the tab bar
   * makes the round trip one thumb-tap.
   *
   * Board.tsx and TracksIndex.tsx already round-trip through `useSearchParams`
   * with these same two shared serialisers, and the reason they give is the
   * second half of the win: a triage view becomes a link somebody can paste into
   * a chat. `replace` rather than push, for their reason too — search is not
   * debounced (FilterBar's header says why) and a history entry per keystroke
   * makes Back unusable.
   *
   * SCOPE IS NORMALISED HERE, not only where it is used. This screen offers no
   * scope control and cannot: `bucketFollowUps` never buckets a closed entry, so
   * `?scope=closed` from a hand-edited or inherited URL would be a filter the
   * user can neither see nor switch off — and, left in `filter`, one the facet
   * pill would count. Board.tsx drops an inherited `status` the same way, for
   * the same reason, and says so where it does it.
   *
   * `filterFromParams` constructs freshly rather than spreading EMPTY_FILTER, so
   * the old comment's hazard — Object.freeze is shallow, and a push() into a
   * spread array would corrupt the shared default for every screen — is handled
   * inside it now, and its header says so.
   */
  const [params, setParams] = useSearchParams()
  const filter = useMemo<FilterState>(() => {
    const parsed = filterFromParams(params)
    if (parsed.scope === EMPTY_FILTER.scope) return parsed
    return { ...parsed, scope: EMPTY_FILTER.scope }
  }, [params])

  const setFilter = useCallback(
    (next: FilterState) => {
      setParams(filterToParams(next), { replace: true })
    },
    [setParams],
  )

  const [density, setDensityState] = useState<Density>(densityPref)
  const [quickId, setQuickId] = useState<string | null>(null)
  /**
   * Sections showing every row rather than the first MAX_ROWS.
   *
   * Session state and not a preference: the fold answers "let me see the rest of
   * this bucket", and restoring it on the next cold open would put back the very
   * mount it exists to avoid.
   */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)

  const entries = useFilteredEntries(filter)
  const health = useHealthMap()
  const loading = useEntriesLoading()
  const error = useEntriesError()
  const coverage = useEntriesCoverage()
  const ctx = useFilterContext()
  const staleDaysFor = useStaleDays()
  const slaDaysFor = useSlaDays()
  // Who work can be handed to. Warmed by Shell (backlog M2), so this is a read
  // of a store somebody else already filled — the rows below are the only
  // consumer on this screen and only in the unassigned bucket.
  const members = useMembers()

  useEffect(() => {
    alive.current = true
    // Self-loading and deduped in the store: three screens mounting at once make
    // one request. Unawaited because the cached rows paint first.
    void loadEntries()
    return () => {
      alive.current = false
    }
  }, [])

  const sections = useMemo(() => {
    const buckets = bucketFollowUps(entries, health, {
      meId: ctx.meId,
      today: ctx.today,
      // Injected rather than imported: lib/** may not read store/**, and this is
      // the seam that lets an admin's edited threshold reach the bucketing.
      staleDays: staleDaysFor,
    })
    return SECTIONS.map((spec) => ({
      ...spec,
      rows: spec.sort ? sortEntries(buckets[spec.key], spec.sort) : buckets[spec.key],
    }))
  }, [entries, health, ctx, staleDaysFor])

  const total = useMemo(() => sections.reduce((n, s) => n + s.rows.length, 0), [sections])

  /**
   * The sibling list for the detail sheet's prev/next, IN THE ORDER SHOWN.
   *
   * Every row of every section, including the ones behind a fold. The fold is a
   * MOUNT bound, not a scope: someone stepping through a bucket with the sheet's
   * next button wants the next item in it, and stopping dead at row 25 with no
   * explanation would be a worse surprise than walking past the fold. The tree's
   * `flatIds` slices for the opposite reason — it drives a bulk selection, and
   * acting on rows you cannot see is exactly what that screen refuses.
   */
  const orderedIds = useMemo(() => sections.flatMap((s) => s.rows.map((e) => e.id)), [sections])

  /**
   * The sibling list, mirrored into a ref so `handleOpen` below can be built
   * ONCE.
   *
   * `orderedIds` is a new array on every commit — `derive()` rebuilds `list`
   * unconditionally, which re-runs `useFilteredEntries`, `sections` and this
   * flatMap in turn — so a `useCallback(…, [orderedIds])` would be a new
   * function on every optimistic write, settle and realtime echo. That
   * function is the `onOpen` prop of every mounted row, and one changed prop
   * defeats `memo()`'s shallow compare for ALL of them: a single Snooze re-ran
   * ~150 rows instead of the one that changed. Board.tsx:1216 and
   * TracksIndex.tsx:754 already open this way for the same reason.
   *
   * Assigning during render rather than in an effect is deliberate and safe:
   * `openEntry` reads the list at CALL time (store/entrySheet), which is a tap,
   * long after render has committed — so the ref can never hand out a list from
   * a render that was thrown away.
   */
  const orderedRef = useRef(orderedIds)
  orderedRef.current = orderedIds

  /** The tag vocabulary the filter offers: what the working set actually holds. */
  const tags = useMemo(() => {
    const seen = new Set<string>()
    for (const e of entries) for (const tag of e.tags) seen.add(tag)
    return [...seen].sort()
  }, [entries])

  const handleOpen = useCallback((id: string) => {
    openEntry(id, { list: orderedRef.current })
  }, [])

  const handleQuick = useCallback((id: string) => {
    // One composer at a time: two open textareas on a triage list is two places
    // to lose a half-typed sentence.
    setQuickId((current) => (current === id ? null : id))
  }, [])

  const handleCloseQuick = useCallback(() => {
    setQuickId(null)
  }, [])

  const handleSnooze = useCallback(
    (entry: Entry) => {
      void snoozeFollowUp(entry.id, SNOOZE_DAYS).then((result) => {
        // A failure has already been toasted by the store, and a QUEUED write is
        // neither — its optimistic row already shows the new date and the
        // offline banner explains the rest.
        if (!result.ok) return
        toast(
          t('followups.snoozed', {
            title: entry.title,
            date: formatDate(result.data.follow_up_date, locale),
          }),
          { tone: 'success' },
        )
      })
    },
    [locale],
  )

  const handleTake = useCallback(
    (entry: Entry) => {
      if (meId === null) return
      void patchEntry(entry.id, { ownerId: meId }).then((result) => {
        if (!result.ok) return
        toast(t('followups.taken', { title: entry.title }), { tone: 'success' })
      })
    },
    [meId],
  )

  /**
   * Hand one unowned item to someone else.
   *
   * Built ONCE — an empty dependency array — because this is a prop of every
   * mounted row and `useCallback(…, [members])` would hand all of them a new
   * function the first time the members store settles, defeating `memo()`'s
   * shallow compare for the whole list. It takes the MEMBER rather than an id
   * precisely so it needs no list to close over: the row resolved them out of
   * the options it had just drawn.
   *
   * `ownerName: null` alongside `ownerId` is not defensive: types.ts declares
   * the two columns MUTUALLY EXCLUSIVE, and leaving a stale free-text name on a
   * row now owned by a teammate makes every reader that falls back to it — the
   * digest, the CSV export — disagree with this screen. TracksIndex's
   * `bulkPatch('owner', …)` clears it for the same reason.
   */
  const handleAssign = useCallback((entry: Entry, member: Member) => {
    void patchEntry(entry.id, { ownerId: member.id, ownerName: null }).then((result) => {
      // A failure has already been toasted by the store, and a QUEUED write is
      // neither — its optimistic row already shows the new owner.
      if (!result.ok) return
      toast(t('followups.assigned', { title: entry.title, name: member.displayName }), {
        tone: 'success',
      })
    })
  }, [])

  /**
   * Finish an item from the list.
   *
   * The row leaves the screen on success — bucketFollowUps never buckets a
   * closed entry — which is the feedback, and which is also why the toast
   * carries the undo: once the row is gone there is nothing left to tap, and
   * "open the item, find the status, put it back" is the same four-step trip
   * this button exists to remove. `was` is read before the call because
   * setStatus applies optimistically, so afterwards `entry.status` is already
   * 'done'; restoring the ACTUAL previous status matters — an item that was
   * blocked must not come back as new.
   */
  const handleDone = useCallback((entry: Entry) => {
    const was = entry.status
    void setStatus(entry.id, 'done').then((result) => {
      // A failure has already been toasted by the store, and a QUEUED write is
      // neither — its optimistic row has already gone and the outbox will send.
      if (!result.ok) return
      toast(t('followups.doneToast', { title: entry.title }), {
        tone: 'success',
        action: { label: t('common.undo'), onClick: () => void setStatus(entry.id, was) },
      })
    })
  }, [])

  const handlePost = useCallback(async (entry: Entry, body: string): Promise<boolean> => {
    // The decision — including the one a queued write forces — is in
    // postQuickUpdate() above, where a test can reach it. All that is left here
    // is the piece of it that belongs to this screen: closing the composer.
    const close = await postQuickUpdate(entry, body)
    if (close) setQuickId(null)
    return close
  }, [])

  const setDensity = (next: Density): void => {
    densityPref = next
    setDensityState(next)
  }

  const handleRefresh = (): void => {
    setRefreshing(true)
    // Nothing extra is needed for the nudge marks: `entries.nudged_at` and
    // `nudged_by` are columns on the entry (0019), so this one read refreshes
    // "asked 2 days ago, no reply" along with everything else on the row.
    void refreshEntries().then(() => {
      // The screen can be navigated away from mid-fetch; refreshEntries never
      // rejects, so this is the only guard the promise needs.
      if (!alive.current) return
      setRefreshing(false)
      toast(t('followups.refreshed'))
    })
  }

  /**
   * The SLA facts for every BREACHED row, resolved once per data change.
   *
   * Only a genuine breach earns a marker — an entry inside its window has an SLA
   * too, and repeating that on every row turns a real alarm into wallpaper. Held
   * in a Map rather than computed per render so the object identity is stable
   * and the memoised rows below do not all re-render when one of them changes.
   *
   * The MAP being stable was never enough: the objects inside it have to be too.
   * `entries` gets a new identity on every commit, so this memo re-runs on every
   * commit, and it used to hand each breached row a brand-new `{days, source}` —
   * a changed prop, and one changed prop re-renders the row. `prevSla` carries
   * the last answer in so an unchanged row keeps the object it already had.
   */
  const prevSla = useRef<ReadonlyMap<string, SlaFacts>>(new Map())
  const slaFacts = useMemo(() => {
    const map = buildSlaFacts(entries, health, slaDaysFor, prevSla.current)
    prevSla.current = map
    return map
  }, [entries, health, slaDaysFor])

  const filtered = !isFilterEmpty(filter)
  const showSkeleton = loading && entries.length === 0
  const showError = error !== null && entries.length === 0

  return (
    <div className="fu">
      <div className="fu-head">
        <p className="fu-sub">{t('followups.subtitle')}</p>

        <div className="fu-tools">
          <div className="chip-row fu-seg" role="group" aria-label={t('followups.whose')}>
            <button
              type="button"
              className="chip"
              aria-pressed={!filter.mine}
              onClick={() => setFilter({ ...filter, mine: false })}
            >
              {t('followups.whoseAll')}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={filter.mine}
              onClick={() => setFilter({ ...filter, mine: true })}
            >
              {t('followups.whoseMine')}
            </button>
          </div>

          <div className="chip-row fu-seg" role="group" aria-label={t('followups.density')}>
            <button
              type="button"
              className="chip"
              aria-pressed={density === 'comfortable'}
              onClick={() => setDensity('comfortable')}
            >
              {t('followups.densityComfortable')}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={density === 'compact'}
              onClick={() => setDensity('compact')}
            >
              {t('followups.densityCompact')}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-sm fu-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            // The freshness of the list is a tooltip rather than a line of text:
            // it is a reassurance someone reaches for, not a fact they scan.
            title={
              coverage.loadedAt === null
                ? undefined
                : t('followups.updatedAgo', {
                    time: formatRelativeTime(new Date(coverage.loadedAt).toISOString(), locale),
                  })
            }
          >
            {t('followups.refresh')}
          </button>
        </div>
      </div>

      <FilterBar
        className="fu-filters"
        value={filter}
        onChange={setFilter}
        facets={FACETS}
        tags={tags}
        tagHint={t('followups.tagHint')}
        count={total}
        resultLabel={(n) => t('followups.total', { count: n })}
      />

      {/* A failed refresh with rows already on screen is a note, never a wipe —
          slightly stale follow-ups beat an empty list. */}
      {error !== null && entries.length > 0 ? (
        <p className="fu-note" role="status">
          {t(error)}
        </p>
      ) : null}

      {showError ? (
        <EmptyState
          icon={<IconChecklist size={30} />}
          title={t('followups.errLoad')}
          description={t('common.errorHint')}
          action={
            <button type="button" className="btn btn-primary" onClick={handleRefresh}>
              {t('common.retry')}
            </button>
          }
        />
      ) : showSkeleton ? (
        <div className="fu-skel" role="status" aria-label={t('common.loading')}>
          <Skeleton count={5} height={62} />
        </div>
      ) : total === 0 ? (
        filtered ? (
          <EmptyState
            icon={<IconChecklist size={30} />}
            title={t('followups.empty')}
            description={t('followups.emptyHint')}
            action={
              <button
                type="button"
                className="btn"
                onClick={() => setFilter({ ...EMPTY_FILTER })}
              >
                {t('followups.clearFilters')}
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<IconChecklist size={30} />}
            title={t('followups.allClear')}
            description={t('followups.allClearHint')}
            action={
              <Link className="btn btn-primary" to="/capture">
                {t('followups.captureCta')}
              </Link>
            }
          />
        )
      ) : (
        <div className="fu-sections">
          {sections
            .filter((s) => s.rows.length > 0)
            .map((s) => {
              const open = unfolded.has(s.key)
              const shown = open ? s.rows : s.rows.slice(0, MAX_ROWS[density])
              const hidden = s.rows.length - shown.length
              return (
                <EntrySection
                  key={s.key}
                  id={s.key}
                  title={t(`followups.${s.key}`)}
                  count={s.rows.length}
                  tone={s.tone}
                  collapsible
                >
                  <p className="fu-hint">{t(`followups.${s.key}Hint`)}</p>
                  <div className="fu-list">
                    {shown.map((entry) => (
                      <FollowUpRow
                        key={entry.id}
                        entry={entry}
                        health={health.get(entry.id)}
                        sla={slaFacts.get(entry.id) ?? null}
                        canEdit={canEditEntry(entry, meId, role)}
                        density={density}
                        offerOwner={s.key === 'unassigned'}
                        members={members}
                        nudgeable={NUDGEABLE.has(s.key)}
                        meId={meId}
                        quickOpen={quickId === entry.id}
                        onOpen={handleOpen}
                        onQuick={handleQuick}
                        onCloseQuick={handleCloseQuick}
                        onSnooze={handleSnooze}
                        onTake={handleTake}
                        onAssign={handleAssign}
                        onDone={handleDone}
                        onPost={handlePost}
                      />
                    ))}
                  </div>
                  {s.rows.length > MAX_ROWS[density] ? (
                    // Named after its section: six of these can be on screen at
                    // once, and "Show all" alone says nothing about which list
                    // is about to grow.
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost fu-fold"
                      onClick={() =>
                        setUnfolded((prev) => {
                          const next = new Set(prev)
                          if (!next.delete(s.key)) next.add(s.key)
                          return next
                        })
                      }
                      aria-label={
                        hidden > 0
                          ? t('followups.showAllIn', { section: t(`followups.${s.key}`) })
                          : t('followups.showLessIn', { section: t(`followups.${s.key}`) })
                      }
                    >
                      {hidden > 0 ? t('followups.showAll') : t('followups.showLess')}
                      {hidden > 0 ? (
                        <span className="pill tabular">
                          {t('followups.rowsHidden', { count: hidden })}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                </EntrySection>
              )
            })}

          {/* The counts add up only because an entry lands in exactly one
              bucket, and the first thing anyone does with this screen is add
              them. Saying so once costs a line and prevents a bug report. */}
          <p className="fu-foot">{t('followups.onceOnly')}</p>
        </div>
      )}
    </div>
  )
}
