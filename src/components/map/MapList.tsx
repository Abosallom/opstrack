// THE ATTENTION LIST — "what needs me today", docked beside the map, and the
// screen `/followups` used to be.
//
// FLAT AND GLOBAL BY DEFAULT, and that is the whole design. The map draws the
// open workload partitioned by TRACK; the question its owner asks every morning
// crosses every track and sorts by date, which on a track-partitioned canvas is
// six drill-ins with six independent sorts. So this list buckets across every
// track at once, exactly as `/followups` did, and narrowing to one branch is
// something the reader CHOOSES by drilling into the map — never where they land.
//
// A SIBLING OF THE CANVAS, NEVER A CHILD: `.mtree-canvas` is `touch-action:
// none` and that intersects DOWN the ancestor chain, so a scrolling list inside
// the drawing could not be panned with a finger at all. `MapPanel`
// (`.mpan-split`) keeps the two apart, superseding `.mtree-list-split`, and it
// OWNS THE CHROME — the heading, the close button, the phone sheet's detents and
// the persisted open state. This file renders the panel's BODY and nothing else.
//
// AND THE BODY IS NOW TWO ROWS OF CHROME FEWER. Opened on a phone at 375×812
// this panel put SEVEN rows above its first line of content: the title, three
// detent buttons, "Hide the panel", an Everyone/Mine pair, "0 items need
// attention", "Refresh" and "Every track". Three of those were this file's.
//   · THE COUNT FOLDED INTO THE TITLE. "What needs you" over "0 items need
//     attention" is one sentence said twice; the shell now titles the panel with
//     the count in it and this file draws no count line at all.
//   · REFRESH RENDERS ONLY IN THE ERROR STATE, which is the only state where it
//     means anything. Everywhere else it invited a tap to re-fetch a list that
//     is already realtime, optimistic and outbox-backed — a control offering to
//     fix a problem the reader does not have.
//   · THE Everyone/Mine PAIR WENT TO THE SHELL. See `onFilter`.
// "Every track" stays: it is the panel's SCOPE, a sentence rather than a
// control, and it is replaced by the branch name the moment the map is drilled
// into. Every remaining row aligns to one inline-start edge.
//
// IT OWNS NO DEFINITION OF "NEEDS ATTENTION". Every bucket comes out of
// `lib/entrySections.bucketFollowUps`, which the board, the dashboard and the
// digest also call, so this list and the digest can never disagree about what is
// late. The ORDER, the two date sorts and the nudgeable set are DISPLAY
// decisions, restated below because this is a second display. Headings and verbs
// come from `followups.*` for the same reason: a `map.overdue` key would be a
// second English sentence free to drift from the first.
//
// ── THE KILLER TEST ────────────────────────────────────────────────────────
//
// A list that shows FEWER rows, or costs MORE taps, than yesterday's follow-ups
// screen is a regression, not a feature:
//   · Everyone ⇄ Mine — one tap, and NOT IN THIS COMPONENT any more: it is the
//     `Mine` toggle in the shell's top-start rail, which is one tap at every
//     lens including `shape`, where this panel does not exist at all. That is
//     strictly more reach than the pair this file used to draw, which was only
//     ever available while the panel was open. See `onFilter`.
//   · Mark done — one tap, no confirm, undo in the toast, and the PREVIOUS
//     status read before the write so undo cannot restore `new` on a blocked one.
//   · Snooze +3d — one tap; `snoozeFollowUp` measures from TODAY.
//   · Quick update — one tap, autofocus, Cmd/Ctrl+Enter, no navigation.
//   · Take it — one tap, unassigned only. Hand it to a teammate — a <select>,
//     unassigned only, a SEPARATE control: different verbs, not one verb twice.
//   · Ask for an update — only in the four buckets where something has already
//     gone wrong (NUDGEABLE); otherwise the slot renders the RECORD of an ask.
//   · Open + prev/next — `openEntry(id, { list })` over every row of every
//     section in display order, INCLUDING rows behind a fold.
//   · The fold budget is `MAX_ROWS = 25`, FollowUps' landing-screen value, and
//     the heading count is the bucket's TRUE total.
// The one thing not reproduced is the SWIPE: it was an accelerator on a screen
// with no other way to be quick, every action here is an always-visible button,
// and a second copy of its click-suppression would be a second place to be wrong.
//
// DRIVEN BY THE MAP: `scope` is `focus.drawnRoot`, taken as ENTRY IDS WALKED OFF
// THE DRAWN TREE rather than as a re-derived filter — the ids come from the
// object `buildMindtree` already counted, so a heading here and a chip on the
// node are two readings of one number. Folds are walked THROUGH (a `more` node
// keeps its children). ROW ORDER IS THE STORE'S: `useFilteredEntries` sorts, the
// intersection and `bucketFollowUps` preserve it, only the date buckets re-sort.

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { EntryRow, EntrySection, type EntryRowShow } from '../entry'
// Imported from the file rather than through the barrel for pages/FollowUps.tsx's
// reason, restated in its header: that barrel is another worker's module and
// this control arrived after it was written.
import NudgeButton from '../entry/NudgeButton'
import { IconCheck, IconPlus } from '../fields/glyphs'
import { IconChecklist, IconClock, IconUser } from '../icons'
import { EmptyState, Skeleton } from '../shared'
import { toast } from '../toast'
import { formatDate } from '../../lib/dates'
import {
  isFilterEmpty,
  sortEntries,
  type EntrySort,
  type FilterState,
} from '../../lib/entryFilter'
import { bucketFollowUps, type FollowUpSections } from '../../lib/entrySections'
import { t, useLocale } from '../../lib/i18n'
import type { MindLabel, MindNode } from '../../lib/mindtree/model'
import { canEditEntry } from '../../lib/permissions'
import { useAuth } from '../../store/auth'
import { openEntry } from '../../store/entrySheet'
import {
  loadEntries,
  patchEntry,
  postUpdate,
  refreshEntries,
  setStatus,
  snoozeFollowUp,
  useEntriesError,
  useEntriesLoading,
  useFilterContext,
  useFilteredEntries,
  useHealthMap,
} from '../../store/entries'
import { useMembers } from '../../store/members'
import { useSlaDays, useStaleDays } from '../../store/vocab'
import type { Member } from '../../api/members'
import type { ApiResult } from '../../api/result'
import type { Entry, EntryHealth, EntryUpdate, NewEntryUpdate } from '../../types'
import './map-list.css'

/** How far a snooze pushes the follow-up date. Measured from TODAY by the store. */
const SNOOZE_DAYS = 3

/** store/entries.ts's private QUEUED_KEY, duplicated as a literal for the reason
 *  Board.tsx and Capture.tsx duplicate it — the store does not export it. It is
 *  a NOTICE, not a failure: the write is in the outbox and its optimistic row is
 *  already on screen. */
const QUEUED_KEY = 'offline.queued'

/**
 * Rows mounted per section before the fold — FollowUps' `MAX_ROWS.comfortable`,
 * to the row, and a FLOOR rather than a copied number: a panel that showed less
 * of a bucket than the screen it replaces is the regression this whole unit is
 * measured against. (A row is ~56 DOM elements, so 500 of them is ~28 000 on a
 * phone; the board folds at 25/40 per column for the same reason.) There is no
 * density SWITCH — inside a panel the density is a property of WHERE it is
 * drawn, so it is derived from `compact` rather than being a second control.
 */
const MAX_ROWS = 25

/** The select value meaning "nobody yet" — FollowUps' and TracksIndex's OWNER_NONE. */
const OWNER_NONE = ''

/** The owner mark, off — a module constant, because a fresh `{ owner: false }`
 *  per render defeats memo()'s compare for every row that receives it. */
const SHOW_NO_OWNER: EntryRowShow = { owner: false }

const DAY_MS = 86_400_000

/**
 * How far apart two SLA deadlines have to be before they are different answers.
 * Postgres and `lib/health.ts` compute the same instant two ways and differ by
 * an hour across a DST boundary; overrides are whole days apart, so half a day
 * absorbs every representation difference and swallows no real override.
 */
const SLA_TOLERANCE_MS = 12 * 3_600_000

type SectionKey = keyof FollowUpSections

interface SectionSpec {
  key: SectionKey
  tone: 'danger' | 'warn' | 'default'
  /** Re-sort this bucket for display. Absent ⇒ keep the store's own order. */
  sort?: EntrySort
}

/**
 * FollowUps' order and its two date sorts, restated rather than re-invented:
 * "overdue" and "due soon" are questions about DATES (the item that slipped
 * three weeks ago belongs above the one that slipped yesterday) and the other
 * four keep the store's activity order. The SLA bucket is second because it is
 * the same kind of fact as overdue — a commitment already missed.
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
 * The section headings and their hints, as LITERALS. `t(\`followups.${key}\`)`
 * is invisible to lib/localeReach.test.ts — a template literal has no key until
 * it runs — so a heading built that way can ship resolving in neither language.
 * Digest.tsx and Notifications.tsx use the same idiom.
 */
const SECTION_KEY: Readonly<Record<SectionKey, string>> = {
  overdue: 'followups.overdue',
  slaBreach: 'followups.slaBreach',
  dueSoon: 'followups.dueSoon',
  stale: 'followups.stale',
  blocked: 'followups.blocked',
  unassigned: 'followups.unassigned',
}

const SECTION_HINT_KEY: Readonly<Record<SectionKey, string>> = {
  overdue: 'followups.overdueHint',
  slaBreach: 'followups.slaBreachHint',
  dueSoon: 'followups.dueSoonHint',
  stale: 'followups.staleHint',
  blocked: 'followups.blockedHint',
  unassigned: 'followups.unassignedHint',
}

/**
 * The buckets where chasing a colleague is fair — FollowUps' NUDGEABLE, whose
 * argument holds unchanged: `dueSoon` is out because NOTHING HAS GONE WRONG YET,
 * and a request sent for no reason is how this button becomes the thing
 * colleagues learn to ignore; `unassigned` is out because there is nobody to ask
 * by construction, and it already carries the two controls that FIX it.
 * `NudgeButton.canNudge` owns the other half — WHO may be asked.
 */
const NUDGEABLE: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'overdue',
  'slaBreach',
  'stale',
  'blocked',
])

/**
 * Every entry id under a drawn node, `collapsed` IGNORED — the walk
 * `MindtreeTable` makes, for its reason: a list that held only what the picture
 * happened to be drawing would report a different total every time somebody
 * clicked a node.
 */
function entryIdsUnder(node: MindNode): ReadonlySet<string> {
  const out = new Set<string>()
  const stack: MindNode[] = [node]
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (current.entryId !== null) out.add(current.entryId)
    for (const child of current.children) stack.push(child)
  }
  return out
}

/* ═══════════════════════════ the SLA source ═══════════════════════════ */

interface SlaFacts {
  /** The RESOLVED window in days, whichever level supplied it. */
  days: number
  source: 'track' | 'priority'
}

/**
 * Where this entry's service deadline came from, INFERRED FROM THE VIEW'S OWN
 * ANSWER rather than looked up: `sla_due_at - created_at` IS the effective
 * window, so comparing it against what the priority default alone would produce
 * says which level answered. The day count is then always exactly the window the
 * server used and cannot drift from the view, because it is derived from it. The
 * one imprecision is a track override set to the SAME number as the default,
 * where it reads "default" — the commitment is identical either way.
 *
 * Null when there is no deadline at all, which is the seeded state: 0005 ships
 * every priority's `sla_days` NULL so nothing is retroactively in breach.
 */
function resolveSla(
  entry: Entry,
  health: EntryHealth | undefined,
  priorityDays: number | null,
): SlaFacts | null {
  if (!health || health.sla_due_at === null) return null
  const due = Date.parse(health.sla_due_at)
  const created = Date.parse(entry.created_at)
  // A row whose timestamps will not parse loses its marker, not the panel.
  if (Number.isNaN(due) || Number.isNaN(created)) return null

  const days = Math.max(1, Math.round((due - created) / DAY_MS))
  // No priority default and yet a deadline exists ⇒ only a track override can
  // have produced it.
  if (priorityDays === null) return { days, source: 'track' }
  const asDefault = created + priorityDays * DAY_MS
  return { days, source: Math.abs(due - asDefault) <= SLA_TOLERANCE_MS ? 'priority' : 'track' }
}

/**
 * The breached rows' SLA facts, REUSING the previous object wherever the answer
 * has not changed.
 *
 * `resolveSla` mints a fresh `{days, source}` per call, so rebuilding this map
 * on every commit hands every breached row a new `sla` prop and defeats `memo()`
 * on it — the same defect as an unstable `onOpen`, one prop over, and it would
 * survive that fix. Comparing the two fields is cheaper than the render it
 * saves, and they are the whole of the value.
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

/* ═════════════════════════ the one bucketing ═════════════════════════ */

interface AttentionSection extends SectionSpec {
  rows: Entry[]
}

interface Attention {
  /** Filtered, open, and inside the scope. */
  rows: Entry[]
  health: ReadonlyMap<string, EntryHealth>
  sections: AttentionSection[]
  total: number
}

/**
 * The reading both the list and the CHIP BADGE are built from — one function, so
 * the number on the chip and the rows behind it can never be two answers.
 *
 * `scope: 'open'` is pinned HERE and OUTSIDE filter state (contract risk 9), so
 * Clear-all cannot change what the surface is about and the filter bar can never
 * claim a facet nobody chose. `bucketFollowUps` buckets no closed entry anyway.
 */
function useAttention(filter: FilterState, scopeIds: ReadonlySet<string> | null): Attention {
  const applied = useMemo<FilterState>(() => ({ ...filter, scope: 'open' }), [filter])
  const entries = useFilteredEntries(applied)
  const health = useHealthMap()
  const ctx = useFilterContext()
  const staleDaysFor = useStaleDays()

  // Null rather than "every id": the unfocused case is the common one and skips
  // the filter entirely, so the landing screen costs one walk of nothing rather
  // than a Set membership test per entry.
  const rows = useMemo(
    () => (scopeIds === null ? entries : entries.filter((e) => scopeIds.has(e.id))),
    [entries, scopeIds],
  )

  const sections = useMemo(() => {
    const buckets = bucketFollowUps(rows, health, {
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
  }, [rows, health, ctx, staleDaysFor])

  const total = useMemo(() => sections.reduce((n, s) => n + s.rows.length, 0), [sections])

  return { rows, health, sections, total }
}

/**
 * The badge on the `needs-me` chip: the total across every bucket, GLOBAL and
 * never scoped to the drill-in. The chip is what tells a reader whether the list
 * is worth opening at all, and a number that shrank because they had drilled
 * into one track would say the day is clear when it is not.
 */
export function useAttentionCount(filter: FilterState): number {
  return useAttention(filter, null).total
}

/* ══════════════════════════════ the row ══════════════════════════════ */

interface MapListRowProps {
  entry: Entry
  health: EntryHealth | undefined
  sla: SlaFacts | null
  canEdit: boolean
  density: 'comfortable' | 'compact'
  /** Only the unassigned bucket offers the two OWNER controls — elsewhere they
   *  would be a way to reroute somebody's work from a list being scanned. */
  offerOwner: boolean
  members: readonly Member[]
  nudgeable: boolean
  /** Passed in rather than read from `useAuth()`: this row is memo()'d and
   *  mounted up to 150 times, and a store subscription per row is the hazard
   *  EntryRow's header describes. */
  meId: string | null
  quickOpen: boolean
  onOpen: (id: string) => void
  onQuick: (id: string) => void
  onCloseQuick: () => void
  onSnooze: (entry: Entry) => void
  onTake: (entry: Entry) => void
  /** The MEMBER, not their id: the row picked them out of the list it rendered
   *  the options from, so the toast can never fail to name them. */
  onAssign: (entry: Entry, member: Member) => void
  onDone: (entry: Entry) => void
  onPost: (entry: Entry, body: string) => Promise<boolean>
}

/**
 * One row, with every action as a real button and NO HOVER IN THE REACH OF ONE.
 * FollowUps inked its actions `--text-faint` until the row was hovered, which is
 * right on a screen a mouse sweeps; this panel is also the phone surface, so
 * they stay at `.btn-ghost`'s own measured ink and are simply always there. The
 * labels are drawn as glyphs and MOVED into the accessible name (the panel is
 * 26rem at its widest and four text buttons push the title out of the row) — the
 * swap `followups.css` made below 640px, done on a class rather than by reading
 * a viewport width at render time.
 */
const MapListRow = memo(function MapListRow({
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
}: MapListRowProps): ReactElement {
  useLocale()
  // The composer is a sibling of the button that opens it, not a child, so
  // aria-expanded needs an aria-controls to point at.
  const quickId = useId()

  const slaLabel =
    sla === null
      ? null
      : t(sla.source === 'track' ? 'followups.slaFromTrack' : 'followups.slaFromPriority', {
          count: sla.days,
        })

  return (
    <div className="mtree-list-row">
      <EntryRow
        entry={entry}
        health={health}
        density={density}
        // On an unassigned row the owner badge says "Unassigned" under a heading
        // that already says Unassigned, so the select below REPLACES it.
        show={offerOwner ? SHOW_NO_OWNER : undefined}
        canEdit={canEdit}
        onOpen={onOpen}
        actions={
          <>
            {slaLabel !== null && sla !== null ? (
              // The resolved SOURCE, not the fact of a breach: the HealthPill
              // already says "past its service deadline", and the question that
              // follows is always "whose deadline?".
              <span
                className="pill mtree-list-sla tabular"
                role="img"
                aria-label={slaLabel}
                title={slaLabel}
              >
                {t('followups.slaDays', { count: sla.days })}
              </span>
            ) : null}
            {/* THE CHASE, and the record of one — before the verbs because it
                renders a PILL as well as a button, and "asked 2 days ago, no
                reply" is a fact that belongs beside the SLA fact. */}
            {nudgeable ? (
              <NudgeButton entry={entry} meId={meId} className="mtree-list-act" />
            ) : null}
            {offerOwner ? (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost mtree-list-act"
                  onClick={() => onTake(entry)}
                  disabled={!canEdit}
                  title={canEdit ? t('followups.takeIt') : t('followups.snoozeDisabled')}
                >
                  <IconUser size={15} className="mtree-list-act-icon" />
                  <span className="mtree-list-act-label">{t('followups.takeIt')}</span>
                </button>
                <select
                  className="select mtree-list-owner"
                  // Always OWNER_NONE: this bucket holds only unowned rows and a
                  // row that gains an owner leaves it — a one-way hand-off.
                  value={OWNER_NONE}
                  disabled={!canEdit || members.length === 0}
                  aria-label={t('followups.assignFor', { title: entry.title })}
                  title={canEdit ? t('followups.assign') : t('entry.cannotEdit')}
                  onChange={(ev) => {
                    // Resolved out of the very list these options were built
                    // from, so the toast can never be handed an id it cannot name.
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
            {/* The outcome the pass is aiming at, so it leads the three and is
                the only one in the success colour. No confirm in front of it —
                the toast's undo charges the mistake, not every correct tap. */}
            <button
              type="button"
              className="btn btn-sm btn-ghost mtree-list-act mtree-list-act-done"
              onClick={() => onDone(entry)}
              disabled={!canEdit}
              title={canEdit ? t('followups.markDone') : t('entry.cannotEdit')}
            >
              <IconCheck size={15} className="mtree-list-act-icon" />
              <span className="mtree-list-act-label">{t('followups.markDone')}</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost mtree-list-act"
              aria-expanded={quickOpen}
              aria-controls={quickOpen ? quickId : undefined}
              title={t('followups.addUpdate')}
              onClick={() => onQuick(entry.id)}
            >
              <IconPlus size={15} className="mtree-list-act-icon" />
              <span className="mtree-list-act-label">{t('followups.addUpdate')}</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost mtree-list-act"
              onClick={() => onSnooze(entry)}
              disabled={!canEdit}
              title={canEdit ? t('followups.snoozeThreeDays') : t('followups.snoozeDisabled')}
            >
              <IconClock size={15} className="mtree-list-act-icon" />
              <span className="mtree-list-act-label">{t('followups.snoozeThreeDays')}</span>
            </button>
          </>
        }
      />

      {quickOpen ? (
        <QuickUpdate id={quickId} entry={entry} onCancel={onCloseQuick} onPost={onPost} />
      ) : null}
    </div>
  )
})

/* ═════════════════════════ the quick update ═════════════════════════ */

/**
 * Post one quick update and answer whether the COMPOSER MAY CLOSE. Exported and
 * lifted out of the handler because vitest runs `environment: 'node'`: a
 * decision inside an event handler is a decision no test here can reach.
 *
 * A QUEUED write closes the composer and clears the text exactly as a landed one
 * does. Treating it as a failure leaves the sentence in the box with no toast
 * WHILE the update is already in the entry's thread, and the second Post that
 * invites is not a retry but a second ROW: `postUpdate()` mints a fresh tempId
 * per call so the two never collapse in the outbox, and `entry_updates` has no
 * UPDATE and no DELETE policy — the audit trail then says it twice forever.
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
  // Not "Update added": the row is on this device and nowhere else yet, and this
  // panel is used on a phone in corridors where that is the difference that
  // matters.
  notify(t(QUEUED_KEY))
  return true
}

/**
 * Appending to the thread WITHOUT leaving the map. The most common answer to
 * "what needs me today" is a sentence, and opening a detail panel over the
 * canvas to type it turns a ten-second pass into a three-minute one. It posts
 * through `store/entries.postUpdate`: optimistic and outbox-routed like every
 * other write in the app.
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
      className="mtree-list-quick"
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
        className="input mtree-list-quick-input"
        rows={2}
        autoFocus
        value={body}
        placeholder={t('followups.quickPlaceholder')}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Stopped here so the map's own Escape — which leaves the drill-in,
            // and on a phone closes this panel — does not fire behind a composer
            // the reader was only closing. MapPanel's header states the order.
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
      <div className="mtree-list-quick-row">
        <button
          type="submit"
          className="btn btn-sm btn-primary"
          disabled={busy || body.trim() === ''}
        >
          {busy ? t('entry.saving') : t('followups.quickPost')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

/* ══════════════════════════════ the panel ══════════════════════════════ */

export interface MapListProps {
  /** The map's filter, as the reader set it. Scope is pinned in `useAttention`. */
  filter: FilterState
  /** The subtree the map is ABOUT — `useMapFocus`'s `drawnRoot`. `kind ===
   *  'root'` means nothing is focused and the list is the whole workspace, which
   *  is where every session starts; anything else scopes it, and the panel
   *  offers the way back out. */
  scope: MindNode
  /** `useMapModel`'s `textOf`: a node's own text, translated or verbatim. */
  textOf: (label: MindLabel) => string
  /** `useMapFocus`'s `focusBranch`. Called with null to leave the drill-in. */
  onFocus: (nodeId: string | null) => void
  /** The shell's one reading of `(max-width: 767px)`. */
  compact: boolean
  /** The shell's polite live region. */
  announce: (text: string) => void
  /**
   * Write the map's filter — `useMapModel`'s `setFilter`.
   *
   * ACCEPTED AND NOT RENDERED, which is the whole point of it still being here.
   * This panel used to draw an Everyone ⇄ Mine pair whenever it was given a
   * writer; `Mine` now lives in the shell's top-start rail as the SINGLE owner
   * of that fact, visible at every lens including `shape`, where this panel does
   * not exist. THERE MUST BE EXACTLY ONE CONTROL FOR ONE FACT: two `role="group"`s
   * carrying one accessible name and two pressed states is a defect for a screen
   * reader even when it looks right on the page, and it is a defect that only
   * shows up once — the first time somebody touches one of the two alone.
   *
   * The prop stays in the type, optional, so the shell's call site keeps
   * compiling either way and a later surface that genuinely owns a filter of its
   * own has somewhere to write. Passing it changes nothing a reader can see.
   */
  onFilter?: (next: FilterState) => void
}

// `onFilter` is deliberately NOT destructured: it is part of the type and it is
// not read, and taking it here would be an unused binding the linter is right
// about. See MapListProps.
export default function MapList({
  filter,
  scope,
  textOf,
  onFocus,
  compact,
  announce,
}: MapListProps): ReactElement {
  const locale = useLocale()
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const role = profile?.role ?? 'member'

  const [quickId, setQuickId] = useState<string | null>(null)
  // Sections showing every row rather than the first MAX_ROWS. Session state and
  // not a preference, for FollowUps' reason: the fold answers "let me see the
  // rest of this bucket", and restoring it on the next cold open would put back
  // the very mount it exists to avoid.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)

  const scoped = scope.kind !== 'root'
  const scopeIds = useMemo(() => (scope.kind === 'root' ? null : entryIdsUnder(scope)), [scope])

  const { rows: entries, health, sections, total } = useAttention(filter, scopeIds)
  const loading = useEntriesLoading()
  const error = useEntriesError()
  const slaDaysFor = useSlaDays()
  // Who work can be handed to. Warmed by Shell, so this is a read of a store
  // somebody else already filled; only the unassigned bucket consumes it.
  const members = useMembers()

  useEffect(() => {
    alive.current = true
    // Self-loading and deduped in the store: two surfaces mounting at once make
    // one request. Unawaited because the cached rows paint first.
    void loadEntries()
    return () => {
      alive.current = false
    }
  }, [])

  // The sibling list for the detail sheet's prev/next, IN THE ORDER SHOWN and
  // including the rows behind a fold: the fold is a MOUNT bound, not a scope,
  // and stopping dead at row 25 with no explanation is the worse surprise.
  // FollowUps' sibling policy, carried across.
  const orderedIds = useMemo(() => sections.flatMap((s) => s.rows.map((e) => e.id)), [sections])

  /**
   * Mirrored into a ref so `handleOpen` can be built ONCE. `orderedIds` is a new
   * array on every commit, so `useCallback(…, [orderedIds])` would be a new
   * function on every optimistic write, settle and realtime echo — and that
   * function is the `onOpen` prop of every mounted row, so one changed prop
   * defeats memo()'s compare for ALL of them. Assigning during render is safe:
   * `openEntry` reads the list at CALL time, which is a tap.
   */
  const orderedRef = useRef(orderedIds)
  orderedRef.current = orderedIds

  /**
   * The SLA facts for every BREACHED row, resolved once per data change and
   * carrying the previous answer in so an unchanged row keeps the object it
   * already had. See buildSlaFacts.
   */
  const prevSla = useRef<ReadonlyMap<string, SlaFacts>>(new Map())
  const slaFacts = useMemo(() => {
    const map = buildSlaFacts(entries, health, slaDaysFor, prevSla.current)
    prevSla.current = map
    return map
  }, [entries, health, slaDaysFor])

  const handleOpen = useCallback((id: string) => {
    openEntry(id, { list: orderedRef.current })
  }, [])

  const handleQuick = useCallback((id: string) => {
    // One composer at a time: two open textareas is two places to lose a
    // half-typed sentence.
    setQuickId((c) => (c === id ? null : id))
  }, [])

  const handleCloseQuick = useCallback(() => {
    setQuickId(null)
  }, [])

  const handleSnooze = useCallback(
    (entry: Entry) => {
      void snoozeFollowUp(entry.id, SNOOZE_DAYS).then((result) => {
        // A failure is already toasted by the store, and a QUEUED write is
        // neither — its optimistic row already shows the new date.
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
   * Hand one unowned item to someone else. Built ONCE — it is a prop of every
   * mounted row — and it takes the MEMBER rather than an id precisely so it
   * needs no list to close over. `ownerName: null` is not defensive: types.ts
   * declares the two columns MUTUALLY EXCLUSIVE, and a stale free-text name on a
   * row now owned by a teammate makes the digest and the export disagree.
   */
  const handleAssign = useCallback((entry: Entry, member: Member) => {
    void patchEntry(entry.id, { ownerId: member.id, ownerName: null }).then((result) => {
      if (!result.ok) return
      toast(t('followups.assigned', { title: entry.title, name: member.displayName }), {
        tone: 'success',
      })
    })
  }, [])

  /**
   * Finish an item. `was` is read BEFORE the call because setStatus applies
   * optimistically, so afterwards `entry.status` is already 'done' — and
   * restoring the ACTUAL previous status matters: an item that was blocked must
   * not come back as new.
   */
  const handleDone = useCallback((entry: Entry) => {
    const was = entry.status
    void setStatus(entry.id, 'done').then((result) => {
      if (!result.ok) return
      toast(t('followups.doneToast', { title: entry.title }), {
        tone: 'success',
        action: { label: t('common.undo'), onClick: () => void setStatus(entry.id, was) },
      })
    })
  }, [])

  const handlePost = useCallback(async (entry: Entry, body: string): Promise<boolean> => {
    // The decision — including the one a queued write forces — is in
    // postQuickUpdate() above, where a test can reach it. What is left here is
    // the piece that belongs to this panel: closing the composer.
    const close = await postQuickUpdate(entry, body)
    if (close) setQuickId(null)
    return close
  }, [])

  /**
   * THE ONLY PLACE THIS IS REACHABLE IS THE ERROR STATE, and that is the only
   * state where it means anything: the store is realtime, optimistic and
   * outbox-backed, so on any successful load a Refresh button offers to solve a
   * problem the reader does not have — and it cost a whole row of a 375px
   * screen to make the offer. A failed load is the one case where the rows on
   * screen genuinely are not the rows on the server, and the retry inside that
   * empty state is this function.
   */
  const handleRefresh = (): void => {
    setRefreshing(true)
    // The nudge marks need nothing extra: `nudged_at`/`nudged_by` are columns on
    // the entry, so this one read refreshes "asked 2 days ago" along with the row.
    void refreshEntries().then(() => {
      // The panel can be closed mid-fetch; refreshEntries never rejects, so this
      // is the only guard the promise needs.
      if (!alive.current) return
      setRefreshing(false)
      toast(t('followups.refreshed'))
    })
  }

  const toggleFold = (key: SectionKey): void => {
    const opening = !unfolded.has(key)
    setUnfolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
    // The fold changes how many rows are mounted and nothing else moves, so a
    // reader who cannot see the list has no other way to be told.
    announce(
      t(opening ? 'followups.showAllIn' : 'followups.showLessIn', {
        section: t(SECTION_KEY[key]),
      }),
    )
  }

  const filtered = !isFilterEmpty(filter)
  const showSkeleton = loading && entries.length === 0
  const showError = error !== null && entries.length === 0
  // Comfortable on a phone, compact on the rail — a property of WHERE the panel
  // is drawn, not a preference to manage. At detent `full` the sheet is the
  // whole viewport, the width the follow-ups screen had; on a 20rem rail a
  // description paragraph per row is what turns a scan into a scroll.
  const density = compact ? 'comfortable' : 'compact'

  return (
    <div className="mtree-list" data-compact={compact ? '' : undefined}>
      {/* NO TOOL ROW. It held an Everyone/Mine pair (now the shell's, and the
          single owner of that fact), the total (now folded into the panel's own
          title — "Nothing needs you" is one sentence, not a heading over a
          count) and an unconditional Refresh (now only in the error state).
          The first row of this panel is what the panel is ABOUT. */}

      {/* What the list is about, and the way out. `role="status"` because this
          sentence is the ANSWER to a gesture made on the CANVAS: tapping a track
          changes what the list holds, and a reader not looking at the panel has
          no other way to be told. */}
      <div className="mtree-list-scope">
        <p className="mtree-list-scope-text" role="status">
          {scoped ? t('map.scopeBranch', { label: textOf(scope.label) }) : t('map.scopeWhole')}
        </p>
        {scoped ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost mtree-list-clear"
            onClick={() => onFocus(null)}
          >
            {t('mindtree.clearFocus')}
          </button>
        ) : null}
      </div>

      {/* A failed refresh with rows already on screen is a note, never a wipe —
          slightly stale follow-ups beat an empty list. */}
      {error !== null && entries.length > 0 ? (
        <p className="mtree-list-note" role="status">
          {t(error)}
        </p>
      ) : null}

      {showError ? (
        <EmptyState
          icon={<IconChecklist size={26} />}
          title={t('followups.errLoad')}
          description={t('common.errorHint')}
          action={
            // The one Refresh this panel still draws, and it is a RETRY: the
            // rows on screen are genuinely not the rows on the server here, and
            // nothing else on this surface can say so.
            <button type="button" className="btn" onClick={handleRefresh} disabled={refreshing}>
              {t('common.retry')}
            </button>
          }
        />
      ) : showSkeleton ? (
        <div className="mtree-list-skel" role="status" aria-label={t('common.loading')}>
          <Skeleton count={4} height={58} />
        </div>
      ) : total === 0 ? (
        filtered ? (
          <EmptyState
            icon={<IconChecklist size={26} />}
            title={t('followups.empty')}
            description={t('followups.emptyHint')}
          />
        ) : (
          <EmptyState
            icon={<IconChecklist size={26} />}
            title={t('followups.allClear')}
            description={t('followups.allClearHint')}
          />
        )
      ) : (
        <div className="mtree-list-sections">
          {sections
            .filter((s) => s.rows.length > 0)
            .map((s) => {
              const openHere = unfolded.has(s.key)
              const shown = openHere ? s.rows : s.rows.slice(0, MAX_ROWS)
              const hidden = s.rows.length - shown.length
              return (
                <EntrySection
                  key={s.key}
                  id={s.key}
                  title={t(SECTION_KEY[s.key])}
                  // The bucket's TRUE total, never `shown.length` — EntrySection
                  // takes it as a prop precisely so a sliced body cannot make the
                  // heading lie.
                  count={s.rows.length}
                  tone={s.tone}
                  collapsible
                >
                  <p className="mtree-list-hint">{t(SECTION_HINT_KEY[s.key])}</p>
                  <div className="mtree-list-rows">
                    {shown.map((entry) => (
                      <MapListRow
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
                  {s.rows.length > MAX_ROWS ? (
                    // Named after its section: six of these can be on screen at
                    // once, and "Show all" says nothing about which list grows.
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost mtree-list-fold"
                      onClick={() => toggleFold(s.key)}
                      aria-label={
                        hidden > 0
                          ? t('followups.showAllIn', { section: t(SECTION_KEY[s.key]) })
                          : t('followups.showLessIn', { section: t(SECTION_KEY[s.key]) })
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
              bucket, and the first thing anyone does with six numbers is add
              them. */}
          <p className="mtree-list-foot">{t('followups.onceOnly')}</p>
        </div>
      )}
    </div>
  )
}
