// THE LIST THE MAP NEVER HAD — a real-DOM work list docked beside the canvas.
//
// WHY IT EXISTS. At first paint the map's entire accessibility tree is a root
// plus N track nodes and ZERO items of work: `useMapModel`'s `OPEN_DEPTH = 1`
// draws ring 1, and `layout.ts` recurses only into uncollapsed branches. The
// picture answers *where is the mass* better than any list can, and has never
// been able to NAME or ACT ON a single item. This is that half, and it is
// purely additive — nothing is deleted, `/followups` is untouched, and this
// component holds no definition of its own.
//
// IT IS A SIBLING OF THE CANVAS, NEVER A CHILD, and that is a hard structural
// fact rather than a layout preference. `pages/mindtree.css` sets
// `.mtree-canvas { overflow: hidden; touch-action: none }` and
// `styles/global.css` records that `touch-action` intersects DOWN the ancestor
// chain: a descendant cannot re-enable `pan-y`. A vertically scrolling list
// inside the canvas would be unscrollable on the one device it matters most on.
// So `map-list.css` owns a `.mtree-list-split` wrapper and the page puts the
// canvas and this panel inside it, side by side on a wide screen and stacked on
// a phone.
//
// IT OWNS NO DEFINITION OF "NEEDS ATTENTION". Every bucket comes out of
// `lib/entrySections.bucketFollowUps` — the same function pages/FollowUps.tsx,
// the board's section counts, the dashboard and the digest all call. The section
// ORDER, the two date-sorted buckets and the nudgeable set are FollowUps'
// decisions, restated here because they are display decisions and this is a
// second display; the bucketing itself is imported, so the map's list and the
// morning triage screen can never disagree about what is late.
//
// THE HEADINGS AND THE VERBS COME FROM `followups.*` ON PURPOSE. "Overdue" and
// "Mark done" are the same words on both screens because they are the same
// facts and the same actions; a `map.overdue` key would be a second English
// sentence free to drift from the first, which is exactly the bug this codebase
// spends `entrySections.ts`'s header warning about. The `map.*` namespace holds
// only what is genuinely new here: the dock's own chrome.
//
// ── THE KILLER TEST ────────────────────────────────────────────────────────
//
// A list that shows FEWER rows than today's follow-ups screen is a regression,
// not a feature. So:
//   · the fold budget is `MAX_ROWS = 25`, which is FollowUps' `MAX_ROWS
//     .comfortable` — its landing-screen value — with the same per-section
//     "Show all (+N)" behind it;
//   · the heading count is the bucket's TRUE total, because `EntrySection`
//     takes `count` as a prop precisely so a sliced body cannot make the number
//     lie;
//   · every action FollowUps offers is here: done, quick update, snooze, ask
//     for an update, take it, and hand it to someone.
// The one thing deliberately not reproduced is the SWIPE. It is an accelerator
// on a screen that has no other way to be quick; here every action is a button
// that is always visible, which is what the phone brief actually asked for, and
// a second copy of the gesture's click-suppression subtlety would be a second
// place for it to be wrong.
//
// ── DRIVEN BY THE MAP ──────────────────────────────────────────────────────
//
// `scope` is `focus.drawnRoot` — the subtree the map is currently ABOUT. Drill
// into Network and the list becomes Network's; leave, and it is the workspace's
// again. The scope is taken as ENTRY IDS WALKED OFF THE DRAWN TREE rather than
// as a re-derived filter, and that is the whole reason the two can never
// disagree: the ids come from the object `buildMindtree` already counted, so a
// heading here and a node's chip over there are two readings of one number.
// Folds are walked THROUGH — a `more` node keeps its children (model.ts says
// so), so "the rows behind the fold" are in the list exactly as they are in the
// accessible table.
//
// ROW ORDER IS THE STORE'S, NOT THE TREE'S. `useFilteredEntries` sorts, the
// intersection preserves that order, and `bucketFollowUps` preserves it again —
// so Stale/Blocked/Unassigned read newest-first as everywhere else and the two
// date buckets are re-sorted by due date, which is FollowUps' rule and is
// restated in SECTIONS below.

import {
  memo,
  useCallback,
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
import { IconCheck, IconChevronDown, IconPlus } from '../fields/glyphs'
import { IconChecklist, IconClock, IconUser } from '../icons'
import { EmptyState } from '../shared'
import { toast } from '../toast'
import { CACHE_PREFIX, readCache, writeCache } from '../../lib/cache'
import { formatDate } from '../../lib/dates'
import { sortEntries, type EntrySort, type FilterState } from '../../lib/entryFilter'
import { bucketFollowUps, type FollowUpSections } from '../../lib/entrySections'
import { t, useLocale } from '../../lib/i18n'
import type { MindLabel, MindNode } from '../../lib/mindtree/model'
import { canEditEntry } from '../../lib/permissions'
import { useAuth } from '../../store/auth'
import { openEntry } from '../../store/entrySheet'
import {
  patchEntry,
  postUpdate,
  setStatus,
  snoozeFollowUp,
  useFilterContext,
  useFilteredEntries,
  useHealthMap,
} from '../../store/entries'
import { useMembers } from '../../store/members'
import { useStaleDays } from '../../store/vocab'
import type { Member } from '../../api/members'
import type { Entry, EntryHealth } from '../../types'
import './map-list.css'

/** How far a snooze pushes the follow-up date. Measured from TODAY by the store. */
const SNOOZE_DAYS = 3

/**
 * store/entries.ts's private QUEUED_KEY, duplicated as a literal for the reason
 * FollowUps.tsx:155, Board.tsx:193 and Capture.tsx:92 duplicate it: the store
 * does not export it. It is a NOTICE, not a failure — the write is in the outbox
 * and its optimistic row is already on screen.
 */
const QUEUED_KEY = 'offline.queued'

/**
 * Rows mounted per section before the fold — FollowUps' `MAX_ROWS.comfortable`,
 * to the row.
 *
 * That number is not copied for symmetry; it is the floor this component is
 * measured against. FollowUps' own note prices a row at 56 DOM elements and 500
 * of them at 28 000, and the board folds at 25/40 per column for the same
 * reason. Matching the comfortable figure means the docked list never shows less
 * of a bucket than the screen it sits beside, and the "Show all" below the rows
 * reaches the rest in one tap.
 *
 * There is deliberately no density switch here. FollowUps' is a module-level
 * session preference on a full-width screen; a second, differently-scoped copy
 * of it inside a 24rem panel would be a control whose state the reader cannot
 * predict from the one they last touched.
 */
const MAX_ROWS = 25

/** The select value meaning "nobody yet" — FollowUps' and TracksIndex's OWNER_NONE. */
const OWNER_NONE = ''

/**
 * The owner mark, off — a module constant rather than an inline object literal,
 * because a fresh `{ owner: false }` per render defeats memo()'s shallow compare
 * for every row that receives it. R2-PERF-1, one prop over.
 */
const SHOW_NO_OWNER: EntryRowShow = { owner: false }

/** Whether the dock is open. A preference, so it outlives the tab. */
const OPEN_KEY = `${CACHE_PREFIX}map_list_open_v1`

function readOpenPref(): boolean {
  // Open by default: the list is the thing this composition exists to add, and
  // a first run that hides it is a feature nobody discovers.
  return readCache(OPEN_KEY, (v) => (typeof v === 'boolean' ? v : null)) ?? true
}

type SectionKey = keyof FollowUpSections

interface SectionSpec {
  key: SectionKey
  tone: 'danger' | 'warn' | 'default'
  /** Re-sort this bucket for display. Absent ⇒ keep the store's own order. */
  sort?: EntrySort
}

/**
 * FollowUps' order and FollowUps' two date sorts, restated.
 *
 * Not imported, because FollowUps does not export it and this component may not
 * edit that file. Restated rather than re-invented: "overdue" and "due soon" are
 * questions about DATES — the item that slipped three weeks ago belongs above
 * the one that slipped yesterday — and the other four keep the store's activity
 * order like every other list in the app.
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
 * The buckets where chasing a colleague is fair — FollowUps' NUDGEABLE, and its
 * argument holds unchanged: `dueSoon` is out because nothing has gone wrong yet,
 * and `unassigned` is out because there is nobody to ask by construction.
 * `NudgeButton.canNudge` owns the other half of the rule and returns null when
 * this particular row has no one to ask.
 */
const NUDGEABLE: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'overdue',
  'slaBreach',
  'stale',
  'blocked',
])

/**
 * Every entry id under a drawn node, `collapsed` IGNORED.
 *
 * The same walk `MindtreeTable` makes, for the same reason it gives: a "+5 more"
 * keeps its children, so the rows behind a fold are part of the branch whether
 * or not the picture is currently drawing them. A list that only held what
 * happened to be visible would report a different total every time somebody
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

/* ══════════════════════════════ the row ══════════════════════════════ */

interface MapListRowProps {
  entry: Entry
  health: EntryHealth | undefined
  canEdit: boolean
  /** Only the unassigned bucket offers the two OWNER controls. */
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
 * One row, with every action as a real button.
 *
 * NO HOVER ANYWHERE IN THE REACH OF AN ACTION, and no keyboard either. FollowUps
 * inks its buttons `--text-faint` until the row is hovered or focused, which is
 * right on a full-width screen the mouse sweeps; a docked panel on a phone has
 * neither, so these stay at `.btn-ghost`'s own measured ink and are simply
 * always there. The labels are drawn as glyphs and carried in the accessible
 * name — the panel is 24rem at its widest and four text buttons would push the
 * title out of the row — which is exactly the swap `followups.css` makes below
 * 640px, done with `.sr-only`'s technique on a class rather than by reading a
 * viewport width at render time.
 */
const MapListRow = memo(function MapListRow({
  entry,
  health,
  canEdit,
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

  return (
    <div className="mtree-list-row">
      <EntryRow
        entry={entry}
        health={health}
        // Compact everywhere: the panel is a companion to a picture, not the
        // morning triage screen, and a description paragraph per row inside
        // 24rem is what turns a scan into a scroll.
        density="compact"
        // On an unassigned row the owner badge says "Unassigned" under a heading
        // that already says Unassigned, so the select below REPLACES it.
        show={offerOwner ? SHOW_NO_OWNER : undefined}
        canEdit={canEdit}
        onOpen={onOpen}
        actions={
          <>
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
                  // Always OWNER_NONE: this bucket holds only unowned rows, and a
                  // row that gains an owner leaves it. A one-way hand-off rather
                  // than an editor.
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
            {/* The outcome the whole pass is aiming at, so it leads the three and
                is the only one drawn in the success colour. No confirm in front
                of it — the toast carries an undo, which charges the mistake
                instead of every correct tap. */}
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
 * Appending to the thread WITHOUT leaving the map.
 *
 * The most common answer to "what needs me today" is a sentence, and making
 * someone open a detail panel over the canvas, find the composer, type, post and
 * dismiss it turns a ten-second pass into a three-minute one. It posts through
 * `store/entries.postUpdate`, which is optimistic and outbox-routed like every
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
            // Stopped here so the map's own Escape — which leaves the drill-in —
            // does not fire behind a composer the reader was only closing.
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
  /**
   * The map's filter, exactly as the reader set it. Scope is pinned OPEN below
   * rather than expected from the caller — `useMapModel` keeps its own pin in a
   * derived `applied` and does not hand it out, and `bucketFollowUps` never
   * buckets a closed entry anyway, so the pin here is belt and braces that
   * cannot make the filter bar claim a facet nobody chose.
   */
  filter: FilterState
  /**
   * The subtree the map is currently ABOUT — `useMapFocus`'s `drawnRoot`.
   *
   * `kind === 'root'` means nothing is focused and the list is the whole
   * workspace. Anything else scopes it, and the panel offers the way back out.
   */
  scope: MindNode
  /** `useMapModel`'s `textOf`: a node's own text, translated or verbatim. */
  textOf: (label: MindLabel) => string
  /** `useMapFocus`'s `focusBranch`. Called with null to leave the drill-in. */
  onFocus: (nodeId: string | null) => void
}

export default function MapList({ filter, scope, textOf, onFocus }: MapListProps): ReactElement {
  const locale = useLocale()
  const { profile } = useAuth()
  const meId = profile?.id ?? null
  const role = profile?.role ?? 'member'

  const panelId = useId()
  const titleId = useId()

  const [open, setOpenState] = useState(readOpenPref)
  const [quickId, setQuickId] = useState<string | null>(null)
  /**
   * Sections showing every row rather than the first MAX_ROWS.
   *
   * Session state and not a preference, for FollowUps' reason: the fold answers
   * "let me see the rest of this bucket", and restoring it on the next cold open
   * would put back the very mount it exists to avoid.
   */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())

  const applied = useMemo<FilterState>(() => ({ ...filter, scope: 'open' }), [filter])
  const entries = useFilteredEntries(applied)
  const health = useHealthMap()
  const ctx = useFilterContext()
  const staleDaysFor = useStaleDays()
  // Who work can be handed to. Warmed by Shell, so this is a read of a store
  // somebody else already filled; only the unassigned bucket consumes it.
  const members = useMembers()

  const scoped = scope.kind !== 'root'
  const scopeLabel = scoped ? textOf(scope.label) : null

  /**
   * The ids the map is drawing, or null for the whole workspace.
   *
   * Null rather than "every id" is not a micro-optimisation: the unfocused case
   * is the common one and the filter below is skipped entirely for it, so the
   * landing screen costs one walk of nothing instead of one walk of the tree
   * plus a Set membership test per entry.
   */
  const scopeIds = useMemo(() => (scope.kind === 'root' ? null : entryIdsUnder(scope)), [scope])

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

  /**
   * The sibling list for the detail sheet's prev/next, IN THE ORDER SHOWN —
   * including the rows behind a fold, because the fold is a MOUNT bound rather
   * than a scope and stopping dead at row 25 with no explanation would be the
   * worse surprise.
   */
  const orderedIds = useMemo(() => sections.flatMap((s) => s.rows.map((e) => e.id)), [sections])

  /**
   * Mirrored into a ref so `handleOpen` can be built ONCE.
   *
   * `orderedIds` is a new array on every commit, so a `useCallback(…,
   * [orderedIds])` would be a new function on every optimistic write, settle and
   * realtime echo — and that function is the `onOpen` prop of every mounted row,
   * so one changed prop defeats memo()'s shallow compare for ALL of them.
   * Assigning during render is safe because `openEntry` reads the list at CALL
   * time, which is a tap, long after render has committed.
   */
  const orderedRef = useRef(orderedIds)
  orderedRef.current = orderedIds

  const handleOpen = useCallback((id: string) => {
    openEntry(id, { list: orderedRef.current })
  }, [])

  const handleQuick = useCallback((id: string) => {
    // One composer at a time: two open textareas is two places to lose a
    // half-typed sentence.
    setQuickId((current) => (current === id ? null : id))
  }, [])

  const handleCloseQuick = useCallback(() => {
    setQuickId(null)
  }, [])

  const handleSnooze = useCallback(
    (entry: Entry) => {
      void snoozeFollowUp(entry.id, SNOOZE_DAYS).then((result) => {
        // A failure has already been toasted by the store, and a QUEUED write is
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
   * Hand one unowned item to someone else. Built ONCE — an empty dependency
   * array — because it is a prop of every mounted row; it takes the MEMBER
   * rather than an id precisely so it needs no list to close over.
   *
   * `ownerName: null` alongside `ownerId` is not defensive: types.ts declares the
   * two columns MUTUALLY EXCLUSIVE, and a stale free-text name on a row now owned
   * by a teammate makes the digest and the CSV export disagree with this panel.
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
   * Finish an item from the list. `was` is read BEFORE the call because
   * setStatus applies optimistically, so afterwards `entry.status` is already
   * 'done' and restoring the ACTUAL previous status matters — an item that was
   * blocked must not come back as new.
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

  /**
   * Post one quick update and answer whether the COMPOSER MAY CLOSE.
   *
   * A QUEUED write closes it and clears the text exactly as a landed one does.
   * Treating it as a failure leaves the sentence in the box with no toast WHILE
   * the update is already visible in the entry's thread, and the second Post
   * that invites is not a retry but a second ROW — `postUpdate()` mints a fresh
   * tempId per call, so the two never collapse in the outbox and
   * `entry_updates` has no UPDATE and no DELETE policy. FollowUps.tsx:175,
   * Board.tsx:761 and Capture.tsx:504 all take this branch.
   */
  const handlePost = useCallback(async (entry: Entry, body: string): Promise<boolean> => {
    const result = await postUpdate({ entryId: entry.id, body })
    if (result.ok) {
      toast(t('followups.posted', { title: entry.title }), { tone: 'success' })
      setQuickId(null)
      return true
    }
    if (result.error !== QUEUED_KEY) return false
    // Not "Update added": the row is on this device and nowhere else yet, and
    // this panel is used on a phone in corridors where that is the difference
    // that matters.
    toast(t(QUEUED_KEY))
    setQuickId(null)
    return true
  }, [])

  const toggleOpen = (): void => {
    setOpenState((prev) => {
      const next = !prev
      writeCache(OPEN_KEY, next)
      return next
    })
  }

  const summary = scopeLabel === null
    ? t('map.scopeWhole')
    : t('map.scopeBranch', { label: scopeLabel })

  return (
    <aside className="mtree-list" data-open={open ? 'true' : 'false'} aria-labelledby={titleId}>
      <div className="mtree-list-head">
        <h2 className="mtree-list-title" id={titleId}>
          <button
            type="button"
            className="mtree-list-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            // The count rides in the accessible name so the control says what is
            // behind it while it is closed, which is the one moment the reader
            // cannot see the list to count it.
            aria-label={
              open
                ? t('map.collapse', { count: total })
                : t('map.expand', { count: total })
            }
            onClick={toggleOpen}
          >
            <span className="mtree-list-caret" aria-hidden="true" data-open={open}>
              <IconChevronDown />
            </span>
            <span className="mtree-list-name">{t('map.title')}</span>
            <span className="mtree-list-count tabular">{t('map.total', { count: total })}</span>
          </button>
        </h2>

        {/* The scope, and the way out of it. `role="status"` rather than a plain
            paragraph because this sentence is the ANSWER to a gesture made on
            the canvas — tapping a track changes what the list is about, and a
            reader who is not looking at the panel has no other way to be told. */}
        <p className="mtree-list-scope" role="status">
          {summary}
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

      {open ? (
        <div className="mtree-list-body" id={panelId}>
          {total === 0 ? (
            <EmptyState
              icon={<IconChecklist size={26} />}
              title={t('map.empty')}
              description={t('map.emptyHint')}
            />
          ) : (
            <div className="mtree-list-sections">
              {sections
                .filter((s) => s.rows.length > 0)
                .map((s) => {
                  const unfoldedHere = unfolded.has(s.key)
                  const shown = unfoldedHere ? s.rows : s.rows.slice(0, MAX_ROWS)
                  const hidden = s.rows.length - shown.length
                  return (
                    <EntrySection
                      key={s.key}
                      id={s.key}
                      title={t(`followups.${s.key}`)}
                      // The bucket's TRUE total, never `shown.length` —
                      // EntrySection takes it as a prop precisely so a sliced
                      // body cannot make the heading lie.
                      count={s.rows.length}
                      tone={s.tone}
                      collapsible
                    >
                      <div className="mtree-list-rows">
                        {shown.map((entry) => (
                          <MapListRow
                            key={entry.id}
                            entry={entry}
                            health={health.get(entry.id)}
                            canEdit={canEditEntry(entry, meId, role)}
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
                        // Named after its section: six of these can be on screen
                        // at once, and "Show all" alone says nothing about which
                        // list is about to grow.
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost mtree-list-fold"
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
                  bucket, and the first thing anyone does with a list of six
                  numbers is add them. */}
              <p className="mtree-list-foot">{t('followups.onceOnly')}</p>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  )
}
