// The whole desktop keyboard layer: the palette, the cheatsheet, and the one
// document listener that feeds both.
//
// MOUNT IT ONCE, INSIDE THE ROUTER AND INSIDE THE SIGNED-IN BRANCH — beside
// <ConfirmHost /> at the bottom of App.tsx. It needs useNavigate(), it reads
// entries and tracks that RLS only hands a signed-in session, and every one of
// its shortcuts is meaningless on the sign-in screen. It renders null until
// something opens it, so mounting it costs one listener.
//
// WHY THE LISTENER LIVES IN A COMPONENT AT ALL. lib/hotkeys.ts may not import
// from store/ or api/ (the §1.0 lib rule), and a global keyboard layer is by
// definition the thing that calls stores. So the split is: that module decides
// what a key MEANS, this one decides what to DO about it. run() below is the
// entire seam, and it is the only place in the layer that knows a store exists.
//
// WHAT THE PALETTE SEARCHES, and why all four at once. Entries, tracks, screens
// and actions are ranked against each other by lib/hotkeys' matcher, which folds
// every candidate through lib/text — so `الشبكات` finds a track seeded under its
// Arabic plural, and `itops` finds "IT Operations", for the same reason and by
// the same code path as the capture parser. Four separate search boxes would
// have been four rankings nobody could compare.
//
// ENTRY ROWS ACTIVATE openEntry() WITH THE PALETTE'S OWN LIST, so J/K afterwards
// walk the search result rather than nothing — store/entrySheet.ts takes the
// sibling list from the caller precisely so each surface can pass its own order.
//
// WHAT IS EXPORTED BESIDE THE COMPONENT, AND WHY. Everything below the render
// boundary is a plain function or a props-only component: the four candidate
// builders, the ranker, the focus-restore predicate and `PaletteDialog`. That
// is not decoration — vitest.config.ts is `environment: 'node'` and there is no
// jsdom in the dependency budget, so the ONLY thing a test can do with this file
// is call a function or hand a tree to react-dom/server. A palette whose entire
// behaviour lived inside one stateful component would therefore have shipped
// with zero assertions on the thing the wave's headline feature is: which rows
// exist, in which order, and what pressing one does. components/OutboxSheet.tsx
// took the same shape for the same reason.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import Cheatsheet from './Cheatsheet'
import { toast } from './toast'
import { t } from '../lib/i18n'
import { useTrackLabel } from '../lib/labels'
import { canEditEntry } from '../lib/permissions'
import { pushOverlay } from '../lib/overlayStack'
import {
  focusSearchField,
  focusSurfaceStart,
  focusUpdateComposer,
  foldField,
  installHotkeys,
  openFocusedEntry,
  rankQuery,
  searchNeedles,
  stepFocusedEntry,
  type HotkeyHit,
  type RankRow,
} from '../lib/hotkeys'
import { useAuth } from '../store/auth'
import { useActiveTracks, useTrackMap } from '../store/config'
import { loadEntries, refreshEntries, setStatus, useEntryList } from '../store/entries'
import { getOpenEntryId, openEntry, stepEntry } from '../store/entrySheet'
import { setLocaleSetting, setTheme, useSettings } from '../store/settings'
import { useVocabLabel } from '../store/vocab'
import type { Entry, EntryStatus, Track, UserRole } from '../types'
import type { ThemePref } from '../lib/theme'
import './cmd.css'

/* ──────────────────────────────── the rows ─────────────────────────────── */

type GroupId = 'entries' | 'tracks' | 'screens' | 'actions'

/**
 * Fixed order, entries first.
 *
 * Not ranked against each other across groups: a group heading is what makes a
 * mixed result list legible, and interleaving an action between two entries by
 * score produces a list nobody can scan. Ranking happens WITHIN a group.
 */
const GROUP_ORDER: readonly GroupId[] = ['entries', 'tracks', 'screens', 'actions']

const GROUP_LABEL: Readonly<Record<GroupId, string>> = {
  entries: 'cmd.groupEntries',
  tracks: 'cmd.groupTracks',
  screens: 'cmd.groupScreens',
  actions: 'cmd.groupActions',
}

export interface Row {
  /** Stable across renders — React's key and the option's id both hang off it. */
  id: string
  label: string
  /** Second line: a track name, a status. Never the only information. */
  hint?: string
  /** Set on entry rows only, so `entryIds` below can be assembled from them. */
  entryId?: string
  /**
   * @param entryIds every entry the palette is currently showing, in display
   *        order. Only the entry rows use it — it is openEntry()'s sibling walk,
   *        and store/entrySheet.ts takes that list from the caller precisely so
   *        each surface can pass its own order. Passed in rather than closed
   *        over because a row is built before the ranking that decides which
   *        rows there are.
   */
  run: (entryIds: readonly string[]) => void
}

/** One palette destination. `labelKey` is always a key that already ships. */
export interface PaletteScreen {
  to: string
  labelKey: string
}

/**
 * Every screen the palette can reach without being an admin.
 *
 * Its own table rather than App.tsx's NAV, which is not exported and belongs to
 * the integrator: NAV is capped at the five tab-bar slots and deliberately
 * omits the routes that are only reachable from Settings, which are exactly the
 * ones a palette earns its keep on. Every label is an EXISTING key from the
 * shared namespaces (§1.0.2 — a feature worker never adds to `route`/`nav`), so
 * this table introduces no strings of its own.
 *
 * ── THE HAZARD THIS TABLE CARRIES, AND THE TEST THAT NOW WATCHES IT ────────
 *
 * "Its own table" is what makes the palette independent of the integrator's
 * NAV, and it is also the entire failure mode: a wave that adds a route to
 * App.tsx and forgets this file ships a screen the headline navigation feature
 * cannot reach, and NOTHING fails. Wave 4b did exactly that. It shipped three
 * screens under /settings — members, export and per-device push preferences —
 * and wired only the first into the palette. The other two were in neither
 * table, so /settings/export and /settings/notifications were reachable only by
 * scrolling the Settings list, on a release whose banner feature is "type the
 * name of any screen". A typecheck cannot see it, a build cannot see it, and in
 * a screenshot it looks like a decision.
 *
 * CommandPalette.test.tsx now parses App.tsx's route table and asserts that
 * every screen-rendering route appears here or in ADMIN_SCREENS. Add a route,
 * add a row — or the test says which one you owe.
 *
 * BOTH NEW ROWS BELONG HERE RATHER THAN IN ADMIN_SCREENS, and that follows the
 * routes rather than a preference: App.tsx gates neither. Export hands over
 * exactly what RLS already lets the caller SELECT, and push preferences are
 * per-device and everybody's own. Putting either behind the admin branch would
 * withhold a member's own screen from a member.
 */
export const SCREENS: readonly PaletteScreen[] = [
  { to: '/capture', labelKey: 'route.capture' },
  { to: '/followups', labelKey: 'route.followups' },
  { to: '/board', labelKey: 'route.board' },
  { to: '/tracks', labelKey: 'route.tracks' },
  // The map half of the tracks job. It is in no nav — its designed entry is the
  // List | Map switcher on /tracks — which makes it exactly the kind of screen
  // this table earns its keep on, and it named itself out of its own namespace
  // for the reason the two Wave-4b rows below give.
  { to: '/mindtree', labelKey: 'mindtree.title' },
  { to: '/meetings', labelKey: 'route.meetings' },
  { to: '/dashboard', labelKey: 'route.dashboard' },
  { to: '/digest', labelKey: 'digest.title' },
  { to: '/notifications', labelKey: 'notif.title' },
  { to: '/settings', labelKey: 'route.settings' },
  { to: '/settings/recurring', labelKey: 'route.recurring' },
  // The two Wave-4b screens that were missing. Named out of their OWN
  // namespaces, which is the same call lib/routeTitle.ts makes for the header
  // of these exact routes — `export.title` and `push.title` already ship in
  // both languages, and a `route.*` twin would only ever restate them. Keeping
  // the two files on the same key also means the palette row and the header a
  // tap on it produces read identically, which is what makes the navigation
  // feel like one thing.
  { to: '/settings/export', labelKey: 'export.title' },
  // `/settings/notifications` is push preferences; the top-level
  // `/notifications` above is the inbox history. Two screens, two rows, and two
  // distinct labels — see the same warning in lib/routeTitle.ts.
  { to: '/settings/notifications', labelKey: 'push.title' },
  // AI assist, on the same rule: named out of its own namespace, ungated in
  // App.tsx because the switch is per-person, and here because a screen that
  // states what leaves the browser is exactly the screen someone goes looking
  // for by typing its name rather than by scrolling a settings list.
  { to: '/settings/ai', labelKey: 'ai.title' },
  // The privacy policy. Named out of its own namespace on the same rule as
  // digest/notif/mindtree above — `privacy.title` already ships in both
  // languages. It is in no nav (its designed entries are Settings › About and
  // the App Store listing), which is exactly the kind of screen this table
  // exists for.
  { to: '/privacy', labelKey: 'privacy.title' },
]

/**
 * Admin-only screens.
 *
 * Kept out of SCREENS rather than filtered from it at render time so the
 * distinction is visible in the source: App.tsx route-gates all three, and
 * offering a member a row that bounces them back to /settings is worse than not
 * offering it. /settings/recurring is NOT here — that screen is deliberately
 * readable by everyone and withholds its own editing.
 *
 * The split is asserted against App.tsx too: the test reads which routes carry
 * the `isAdmin` ternary, so a row in the wrong table is a failure rather than a
 * member bouncing off a screen the palette just promised them.
 */
export const ADMIN_SCREENS: readonly PaletteScreen[] = [
  // Above tracks, the level it sits above — the same coarse-to-fine reading
  // order the filter bar's facets and the Settings page's two cards use.
  { to: '/settings/groups', labelKey: 'groups.title' },
  { to: '/settings/tracks', labelKey: 'admin.tracks.title' },
  { to: '/settings/vocabulary', labelKey: 'vocabadmin.title' },
  { to: '/settings/terminology', labelKey: 'terminology.title' },
  { to: '/settings/members', labelKey: 'route.members' },
]

/**
 * How many rows a group may contribute.
 *
 * Entries get the most because they are the only UNBOUNDED set — a workspace has
 * five tracks and fifteen screens forever, and several hundred entries by month
 * three. The cap is what keeps the list one screen tall and the keystroke cost
 * flat.
 *
 * Screens are capped at exactly how many there are, which is to say not capped:
 * a limit that bites on a FIXED set is not a cap, it is a screen nobody can
 * reach from the palette. At 8 the blank-query list stopped at Notifications and
 * neither Settings nor Recurring was ever offered — found in the browser pass
 * rather than in a test, which is what a browser pass is for.
 */
const GROUP_CAP: Readonly<Record<GroupId, number>> = {
  entries: 8,
  tracks: 6,
  screens: SCREENS.length + ADMIN_SCREENS.length,
  actions: 6,
}

/** Matches App.tsx's header button, so the two agree on what "next" means. */
const THEME_CYCLE: readonly ThemePref[] = ['auto', 'dark', 'light']

/** The theme the "Switch theme" row sets. Wraps; anything unknown lands on auto. */
export function nextThemeAfter(theme: ThemePref): ThemePref {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length] ?? 'auto'
}

/* ──────────────────────────── the candidate rows ───────────────────────── */
//
// Four builders, one per group, all pure and all exported. Each takes exactly
// what its rows are made of and, where the row has to DO something the palette
// cannot do by itself, the doer as an argument — `navigate` comes from a hook
// and the four action handlers close over stores, so injecting them is what
// keeps these functions callable from a test with no DOM and no router.
//
// openEntry() is the one exception and it is deliberately imported rather than
// injected: it is a module function on a zustand store, already the non-React
// read store/entrySheet.ts documents for this caller, and threading it through a
// parameter would buy a test seam that vi.mock already provides.

/** The label a track shows, in the locale the UI is in. */
type TrackLabelFn = (track: Track) => string
/** Narrowed to the one kind the palette asks for. */
type VocabLabelFn = (kind: 'status', key: string) => string
/** react-router's navigate, minus the options nothing here passes. */
type NavigateFn = (to: string) => void

/**
 * The entries the palette can open.
 *
 * @param trackMap every track by id, INCLUDING archived ones — an entry filed
 *        against a track that was later archived still has to say which.
 */
export function entryCandidates(
  entries: readonly Entry[],
  trackMap: ReadonlyMap<string, Track>,
  trackLabel: TrackLabelFn,
  vocabLabel: VocabLabelFn,
): RankRow<Row>[] {
  return entries.map((entry: Entry) => {
    const track = entry.track_id === null ? undefined : trackMap.get(entry.track_id)
    const trackName = track ? trackLabel(track) : ''
    const status = vocabLabel('status', entry.status)
    return {
      item: {
        id: `entry:${entry.id}`,
        label: entry.title,
        // Two facts, both of which a person scanning a result list uses to
        // tell two similarly-titled items apart. Joined with a middle dot
        // rather than built from a locale template: no sentence, no
        // interpolation, nothing to translate.
        hint: [trackName, status].filter((s) => s !== '').join(' · '),
        entryId: entry.id,
        run: (entryIds) => openEntry(entry.id, { list: [...entryIds] }),
      },
      // Title first — a title match must always out-rank a tag match, and the
      // field's index IS its weight in matchScore().
      fields: [foldField(entry.title), foldField([...entry.tags, trackName].join(' '))],
    }
  })
}

/** The active tracks, each row opening that track's timeline. */
export function trackCandidates(
  tracks: readonly Track[],
  trackLabel: TrackLabelFn,
  navigate: NavigateFn,
): RankRow<Row>[] {
  return tracks.map((track) => ({
    item: {
      id: `track:${track.id}`,
      label: trackLabel(track),
      run: () => navigate(`/tracks/${track.id}`),
    },
    // BOTH names, in both languages, whichever the UI is showing: an English
    // UI still has to find a track whose only memorable name is Arabic. This
    // is lib/text.ts's own reason for not locale-switching its folds.
    fields: [foldField(trackLabel(track)), foldField(`${track.name} ${track.name_ar}`)],
  }))
}

/**
 * The screens this viewer may go to.
 *
 * The admin table is APPENDED rather than merged and re-sorted, so an admin sees
 * the same twelve rows in the same order a member does and the three extra ones
 * after them — a list that reorders itself by role is a list nobody builds
 * muscle memory on.
 */
export function screenCandidates(role: UserRole, navigate: NavigateFn): RankRow<Row>[] {
  const screens = role === 'admin' ? [...SCREENS, ...ADMIN_SCREENS] : SCREENS
  return screens.map((screen) => ({
    item: {
      id: `screen:${screen.to}`,
      label: t(screen.labelKey),
      run: () => navigate(screen.to),
    },
    fields: [foldField(t(screen.labelKey))],
  }))
}

/**
 * The four things the palette does rather than goes to.
 *
 * Handlers, not state: what "switch theme" means is a store's business and the
 * component computes it (see nextThemeAfter). This builder only decides that
 * there are four rows, what they are called, and in which order.
 */
export interface PaletteActions {
  cycleTheme: () => void
  switchLanguage: () => void
  showKeys: () => void
  refresh: () => void
}

export function actionCandidates(actions: PaletteActions): RankRow<Row>[] {
  return [
    { id: 'action:theme', label: t('cmd.actionTheme'), run: actions.cycleTheme },
    { id: 'action:language', label: t('cmd.actionLanguage'), run: actions.switchLanguage },
    { id: 'action:keys', label: t('cmd.actionKeys'), run: actions.showKeys },
    { id: 'action:refresh', label: t('cmd.actionRefresh'), run: actions.refresh },
  ].map((item) => ({ item, fields: [foldField(item.label)] }))
}

/* ──────────────────────────────── the ranking ──────────────────────────── */

/** One rendered group: its heading, and its rows with their FLAT indices. */
export interface PaletteGroup {
  id: GroupId
  rows: readonly { row: Row; index: number }[]
}

/** Everything the dialog renders, and everything Enter needs to act. */
export interface PaletteModel {
  groups: readonly PaletteGroup[]
  /** Every row on screen, in display order — what `at` indexes into. */
  flat: readonly Row[]
  /** The entry ids on screen, in display order — every entry row's `run` arg. */
  entryIds: readonly string[]
  count: number
  /** The highlight, clamped into range. -1 when there is nothing to highlight. */
  at: number
}

export type PaletteSources = Readonly<Record<GroupId, readonly RankRow<Row>[]>>

/**
 * Query + candidates → the list, capped, grouped and flat-indexed.
 *
 * The highlight is CLAMPED HERE rather than corrected in an effect: a shrinking
 * result list would otherwise paint one frame with the highlight past its end.
 */
export function rankPalette(query: string, source: PaletteSources, active: number): PaletteModel {
  const needles = searchNeedles(query)
  const groups: PaletteGroup[] = []
  // One running index across every group: aria-activedescendant addresses a
  // FLAT list, and the arrow keys have to cross a group boundary without the
  // user noticing there was one.
  let n = 0
  for (const id of GROUP_ORDER) {
    const rows = rankQuery(needles, source[id], GROUP_CAP[id])
    if (rows.length === 0) continue
    groups.push({ id, rows: rows.map((row) => ({ row, index: n++ })) })
  }
  const flat = groups.flatMap((g) => g.rows.map((r) => r.row))
  const count = flat.length
  return {
    groups,
    flat,
    count,
    entryIds: flat.flatMap((row) => (row.entryId === undefined ? [] : [row.entryId])),
    at: count === 0 ? -1 : Math.min(active, count - 1),
  }
}

/* ───────────────────────────── the focus restore ───────────────────────── */

/**
 * What the close effect needs to know. Structural rather than `Element`, for
 * lib/hotkeys' TypingTargetLike reason: the test hands it plain objects.
 */
export interface FocusRestoreProbe {
  /** `document.activeElement` at the moment the palette went away. */
  active: unknown
  /** `document.body`. */
  body: unknown
  /** `document.documentElement`. */
  root: unknown
  /** Is the element that opened the palette still in the document? */
  triggerConnected: boolean
}

/**
 * Should the palette pull focus back to whatever opened it?
 *
 * ONLY WHEN NOBODY ELSE CLAIMED THE KEYBOARD, and this cost a browser pass to
 * find. An entry row's Enter closes the palette AND calls openEntry(), both in
 * one commit, so the entry sheet mounts in the same flush and focuses its own
 * surface (Sheet.tsx does that deliberately, to announce the entry). Whether
 * that happens before or after the close effect is decided by where the
 * integrator mounts this component relative to the overlay host — and in
 * App.tsx's actual order it happens FIRST, so an unconditional restore reached
 * in and dragged focus back to `#main`. A keyboard user opened an entry and then
 * had to Tab in from the top of the page.
 *
 * `activeElement` is the answer to exactly the right question, which is the same
 * trick App.tsx's route-change focus move uses: a real element means somebody
 * claimed focus and this must not fight them; <body> means the palette's unmount
 * orphaned it and restoring is the whole point.
 */
export function shouldRestoreFocus(probe: FocusRestoreProbe): boolean {
  const orphaned =
    probe.active === null || probe.active === probe.body || probe.active === probe.root
  return orphaned && probe.triggerConnected
}

/* ─────────────────────────────── the palette ───────────────────────────── */

export default function CommandPalette(): ReactElement {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const optionEls = useRef(new Map<number, HTMLElement>())

  const entries = useEntryList()
  const tracks = useActiveTracks()
  const trackMap = useTrackMap()
  const trackLabel = useTrackLabel()
  const vocabLabel = useVocabLabel()
  const { theme, locale } = useSettings()
  const { profile } = useAuth()
  // `null`, never a stand-in: canEditEntry() tests the signed-out case first, so
  // a placeholder id would satisfy the open policy for a session that has none.
  const meId = profile?.id ?? null
  const role: UserRole = profile?.role ?? 'member'

  /* ---------- the candidate lists ---------- */

  // MEMOISED, and the two below are not — the split is the point. Folding every
  // entry title is the expensive half of a keystroke, and it changes only when
  // the working set does.
  const entryRows = useMemo<RankRow<Row>[]>(
    () => entryCandidates(entries, trackMap, trackLabel, vocabLabel),
    [entries, trackMap, trackLabel, vocabLabel],
  )

  const trackRows = useMemo<RankRow<Row>[]>(
    () => trackCandidates(tracks, trackLabel, navigate),
    [tracks, trackLabel, navigate],
  )

  // NOT MEMOISED, and both for the same reason. There are fifteen screens and
  // four actions, so rebuilding them costs nothing — and the dependency that
  // would make a memo CORRECT is one React cannot express: t() answers for
  // lib/i18n's module-level current locale and takes no argument, so `[locale]`
  // is a dependency the value does not read and a linter is right to reject it.
  // The labels have to be recomputed on a language switch, and the cheapest
  // honest way to guarantee that is to recompute them always.
  const screenRows = screenCandidates(role, navigate)
  const actionRows = actionCandidates({
    cycleTheme: () => setTheme(nextThemeAfter(theme)),
    switchLanguage: () => setLocaleSetting(locale === 'en' ? 'ar' : 'en'),
    showKeys: () => setHelp(true),
    refresh: () => {
      void refreshEntries()
      toast(t('cmd.refreshed'))
    },
  })

  /* ---------- ranking ---------- */

  // Also unmemoised: two of its four inputs are rebuilt on every render above,
  // so a memo over them would be a lie that reads as an optimisation. The work is
  // `GROUP_CAP` integer comparisons per candidate — the expensive half, folding
  // every entry title, is what the memo above is for.
  const model = rankPalette(
    query,
    { entries: entryRows, tracks: trackRows, screens: screenRows, actions: actionRows },
    active,
  )
  const { count, flat, at } = model

  /* ---------- open / close ---------- */

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }, [])

  useEffect(() => {
    if (!open) {
      const el = restoreFocus.current
      restoreFocus.current = null
      // The predicate is shouldRestoreFocus() above, where it can be tested —
      // its header is the browser pass that found this rule.
      const restore = shouldRestoreFocus({
        active: document.activeElement,
        body: document.body,
        root: document.documentElement,
        triggerConnected: el?.isConnected === true,
      })
      if (restore) el?.focus()
      return
    }
    // Capture the trigger only if focus is not ALREADY inside the palette. In
    // StrictMode this effect runs, tears down and runs again, and on the second
    // pass `activeElement` is the input the first pass just focused — storing
    // that would make the restore above a no-op on a detached node and drop
    // focus on <body>. Confirm.tsx guards the same hazard for a re-opened
    // dialog.
    const active = document.activeElement as HTMLElement | null
    if (active === null || dialogRef.current?.contains(active) !== true) {
      restoreFocus.current = active
    }
    inputRef.current?.focus()
    // The working set is a screen's concern, not the shell's — App.tsx warms
    // config, vocab and members but deliberately not entries. The palette is the
    // one surface that can be reached before any list screen has loaded them, so
    // it asks; loadEntries() de-duplicates and never throws.
    void loadEntries()
    // Escape through lib/overlayStack rather than a listener here: the palette is
    // routinely opened OVER the entry sheet, and the stack is what makes one
    // press dismiss one layer. See that module's header.
    return pushOverlay(close)
  }, [open, close])

  // Keep the highlighted row on screen. `nearest` so a one-row step scrolls by
  // one row instead of centring the list on every keypress.
  useEffect(() => {
    if (at < 0) return
    optionEls.current.get(at)?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const activate = (row: Row | undefined): void => {
    if (row === undefined) return
    // Close FIRST: run() often navigates, and restoring focus into a route that
    // has already unmounted is the bug the isConnected check above exists for.
    // Closing first means restoreFocus points at something that was still alive
    // when it was captured.
    close()
    row.run(model.entryIds)
  }

  /* ---------- the global layer ---------- */

  const applyStatus = useCallback(
    (status: EntryStatus) => {
      const id = getOpenEntryId()
      if (id === null) return
      const entry = entries.find((e) => e.id === id)
      if (entry === undefined) return
      // The same gate the board's drag reads. A hotkey that skipped it would
      // fire a write RLS refuses and surface a raw error for a control the rest
      // of the UI renders as disabled.
      if (!canEditEntry(entry, meId, role)) {
        toast(t('entry.errNotYours'), { tone: 'error' })
        return
      }
      if (entry.status === status) return
      // patchEntry() is optimistic, queues offline and toasts its own failures.
      void setStatus(id, status)
    },
    [entries, meId, role],
  )

  const run = useCallback(
    (hit: HotkeyHit) => {
      switch (hit.id) {
        case 'capture':
          navigate('/capture')
          return
        case 'palette':
          // A toggle, so the chord that opened it also closes it — which is what
          // every palette has trained people on, and the reason `palette` is
          // allowed to fire from inside a text field.
          setOpen((v) => !v)
          return
        case 'help':
          setHelp((v) => !v)
          return
        case 'search':
          // "/" must never be a key that does nothing. A screen with no filter
          // bar gets the palette, which is the same question asked wider.
          if (!focusSearchField()) setOpen(true)
          return
        case 'next':
        case 'prev': {
          const dir = hit.id === 'next' ? 1 : -1
          // With the detail surface open, "next" means the next SIBLING in the
          // list the surface was opened from — store/entrySheet owns that walk.
          // With nothing open it means the next row on screen.
          if (getOpenEntryId() !== null) stepEntry(dir)
          else stepFocusedEntry(dir)
          return
        }
        case 'edit':
          // Open it, or — if it is already open — put the keyboard on the first
          // control, which is the title's inline-edit trigger.
          if (getOpenEntryId() !== null) focusSurfaceStart()
          else openFocusedEntry()
          return
        case 'addUpdate':
          if (getOpenEntryId() !== null) focusUpdateComposer()
          else openFocusedEntry()
          return
        case 'status':
          if (hit.status !== undefined) applyStatus(hit.status)
          return
      }
    },
    [navigate, applyStatus],
  )

  // run() is rebuilt whenever the working set or the viewer's role changes, so
  // the listener reads it through a ref rather than being re-bound: add/remove
  // on a document listener per keystroke is the churn lib/overlayStack's header
  // rejects for its own. Written in an effect, never in the render body.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  useEffect(() => {
    return installHotkeys({
      // A module function on a zustand store — stable, and already the
      // non-React read store/entrySheet.ts documents for exactly this caller.
      openEntryId: getOpenEntryId,
      run: (hit) => runRef.current(hit),
    })
  }, [])

  /* ---------- the palette's own keys ---------- */

  // A plain function, like activate() above: it closes over the ranked list,
  // which is rebuilt on every render, so a useCallback would hold a stale one or
  // be re-created anyway. The dialog it is attached to only exists while the
  // palette is open.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Escape is NOT handled here, and must not be: it is arbitrated on the
    // document by lib/overlayStack, which bails on defaultPrevented. Calling
    // preventDefault() for it here would make the palette undismissable when it
    // is the top of a stack.
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((i) => (count === 0 ? 0 : Math.min(i + 1, count - 1)))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
        return
      case 'Home':
        event.preventDefault()
        setActive(0)
        return
      case 'End':
        event.preventDefault()
        setActive(Math.max(count - 1, 0))
        return
      case 'Enter':
        event.preventDefault()
        activate(flat[at])
        return
      case 'Tab': {
        // Only two tab stops exist — the input and the close button — so the
        // trap is the pair rather than a computed focus list. Without it, Tab
        // walks out of an aria-modal dialog into the page behind it, exactly as
        // Confirm.tsx documents.
        const stops = dialogRef.current?.querySelectorAll<HTMLElement>(
          'input, button:not(:disabled)',
        )
        if (!stops || stops.length === 0) return
        const first = stops[0]
        const last = stops[stops.length - 1]
        if (first === undefined || last === undefined) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      default:
        return
    }
  }

  /* ---------- render ---------- */

  return (
    <>
      <Cheatsheet open={help} onClose={() => setHelp(false)} />
      {open &&
        // Portalled for the reason Sheet.tsx spells out: `.cmd-dialog` is
        // position: fixed, and a fixed element is positioned against the nearest
        // ancestor with a transform — global.css's `.fade-in` leaves one behind
        // permanently, so any screen that wraps its content in it would trap
        // this dialog inside a scrolling column.
        //
        // The portal is also the reason PaletteDialog is a separate component
        // rather than this JSX inline: react-dom/server throws on a portal, so
        // the markup below would be unassertable from a node test if the only
        // way to reach it were through this call.
        createPortal(
          <PaletteDialog
            listId={listId}
            query={query}
            model={model}
            dialogRef={dialogRef}
            inputRef={inputRef}
            optionRef={(index, el) => {
              if (el) optionEls.current.set(index, el)
              else optionEls.current.delete(index)
            }}
            onQuery={(value) => {
              setQuery(value)
              setActive(0)
            }}
            onClose={close}
            onActivate={activate}
            onHover={setActive}
            onKeyDown={onKeyDown}
          />,
          document.body,
        )}
    </>
  )
}

/* ─────────────────────────────── the dialog ────────────────────────────── */

export interface PaletteDialogProps {
  /** Owns the id space for the listbox and every option in it. */
  listId: string
  query: string
  model: PaletteModel
  onQuery: (value: string) => void
  onClose: () => void
  onActivate: (row: Row) => void
  /** The pointer moved onto a row — it becomes the highlight. */
  onHover: (index: number) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  /** The Tab trap reads it; the scroll-into-view map is written through optionRef. */
  dialogRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | null>
  optionRef: (index: number, el: HTMLElement | null) => void
}

/**
 * The combobox, the listbox, and nothing else.
 *
 * PROPS ONLY — no state, no effects, no stores, no portal. Everything it needs
 * arrives as an argument, which is what lets a node test render it through
 * react-dom/server and assert the ARIA wiring that a palette lives or dies by:
 * the input carries `role="combobox"`, `aria-controls` names the listbox,
 * `aria-activedescendant` names the highlighted option, and each option's id is
 * the one the input just claimed. Those four ids agreeing is the whole
 * accessible experience of the feature and none of it is visible on screen.
 */
export function PaletteDialog({
  listId,
  query,
  model,
  onQuery,
  onClose,
  onActivate,
  onHover,
  onKeyDown,
  dialogRef,
  inputRef,
  optionRef,
}: PaletteDialogProps): ReactElement {
  const { groups, count, at } = model
  const optionId = (index: number): string => `${listId}-opt-${index}`

  return (
    <>
      <div className="cmd-scrim" role="presentation" onClick={onClose} />
      <div
        ref={dialogRef}
        className="cmd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('cmd.title')}
        // Keeps focus INSIDE the dialog when a click lands on inert content: the
        // browser's focus fixup walks to the nearest focusable ancestor, and
        // without this that ancestor is <body> — outside the Tab trap in
        // onKeyDown. Confirm.tsx documents the same.
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="cmd-field">
          {/* type="text", NOT type="search". lib/hotkeys' focusSearchField()
              finds a screen's filter box by that exact type, and a palette
              input wearing it would let "/" focus the palette's own field
              while the palette was closed... by opening nothing at all. */}
          <input
            ref={inputRef}
            className="input cmd-input"
            type="text"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={at >= 0 ? optionId(at) : undefined}
            aria-label={t('cmd.inputLabel')}
            placeholder={t('cmd.placeholder')}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        {/* No aria-label: the listbox is named by the combobox that controls it,
            and a second copy of the dialog's name here is read out on every
            arrow press. */}
        <div className="cmd-list" id={listId} role="listbox">
          {groups.map((group) => (
            <div
              className="cmd-section"
              role="group"
              aria-labelledby={`${listId}-${group.id}`}
              key={group.id}
            >
              <div className="cmd-section-label" id={`${listId}-${group.id}`}>
                {t(GROUP_LABEL[group.id])}
              </div>
              {group.rows.map(({ row, index }) => (
                <div
                  key={row.id}
                  id={optionId(index)}
                  className="cmd-option"
                  role="option"
                  aria-selected={index === at}
                  ref={(el) => optionRef(index, el)}
                  // The options are NOT focusable: this is a combobox, so focus
                  // stays in the input and aria-activedescendant carries the
                  // selection. preventDefault on mousedown is what stops a click
                  // from pulling focus out of the input and closing the dialog
                  // before onClick can run.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onActivate(row)}
                  onMouseMove={() => onHover(index)}
                >
                  <span className="cmd-option-label">{row.label}</span>
                  {row.hint !== undefined && row.hint !== '' && (
                    <span className="cmd-option-hint">{row.hint}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {count === 0 && (
          <div className="cmd-empty">
            <p className="cmd-empty-title">{t('cmd.empty', { value: query })}</p>
            <p className="cmd-empty-hint">{t('cmd.emptyHint')}</p>
          </div>
        )}

        <div className="cmd-foot">
          <span className="cmd-foot-hint">{t('cmd.hint')}</span>
          {/* Announced, not shown: a sighted user can see the list shrink.
              Rendered only when there ARE results — the empty state above is its
              own message, and it keeps count=0 off a plural node whose Arabic
              `zero` form would otherwise be reachable. */}
          <span className="sr-only" role="status">
            {count > 0 ? t('cmd.results', { count }) : ''}
          </span>
        </div>
      </div>
    </>
  )
}
