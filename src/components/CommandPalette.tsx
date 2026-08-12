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
import { viewToParams } from '../lib/mindtree/focus'
import { LENS_KEY, MAP_LENSES, type MapLens } from '../lib/mindtree/lens'
import { ROOT_ID } from '../lib/mindtree/model'
// The composer is mounted on the map, so `c` is a focus() when the reader is
// already there and a navigation when they are not — see the `capture` case in
// run().
import { focusMapCapture } from './map/MapCapture'
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
// Type-only: the palette needs the KEY UNION to type its per-row gate, and
// nothing else from api/roles. A value import would pull the whole permission
// catalogue into this chunk to spell five string literals.
import type { PermissionKey } from '../api/roles'
import { useAuth, useHasPerm, useIsAdmin } from '../store/auth'
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
 * A destination App.tsx withholds, and THE KEY IT WITHHOLDS IT ON.
 *
 * The key is per ROW rather than per table because 0025 stopped the admin block
 * being one thing: `structure.edit` opens Groups, Structure and Tracks to the
 * Director, `vocab.edit` opens Catalogue, Vocabulary and Terminology, and Roles
 * and Members stay on `workspace.admin`. A table that was still all-or-nothing
 * would offer a Director either five rows they cannot open or none of the six
 * they can.
 *
 * `PermissionKey` rather than `string`: api/roles owns that union, so a key
 * renamed there is a compile error here rather than a row nobody is ever
 * offered. CommandPalette.test.tsx asserts each row's key equals the one App.tsx
 * guards the same path with.
 */
export interface AdminPaletteScreen extends PaletteScreen {
  permKey: PermissionKey
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
  // THE APP. Capture, follow-ups, the board, the tracks index, the dashboard and
  // the notification history were six rows here and are now five LENSES on this
  // one — see LENSES below, and docs/MAP-CONTRACT.md §1. It keeps naming itself
  // out of its own namespace for the reason the two Wave-4b rows below give.
  { to: '/mindtree', labelKey: 'mindtree.title' },
  { to: '/meetings', labelKey: 'route.meetings' },
  { to: '/digest', labelKey: 'digest.title' },
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

/* ─────────────────────────── the map's own links ───────────────────────── */

/** The one route the whole application is built around. */
const MAP_PATH = '/mindtree'

/**
 * The lens param, spelled the way pages/map/useMapUrl.ts reads it.
 *
 * A COPY OF ITS `P_LENS`, and the copy is a decision rather than laziness: that
 * constant is module-private, and importing from useMapUrl would drag
 * store/mindtree and two react-router hooks into a component whose entire test
 * suite runs under `environment: 'node'` with no DOM. So the copy is PINNED
 * instead — CommandPalette.test.tsx reads `P_LENS` out of that file's source and
 * fails if the two ever spell it differently. That is the same "derive the
 * expectation from the thing that is actually true" move the App.tsx route parse
 * in the same test makes, and for the same reason: a copy nobody checks is how a
 * link stops working in silence.
 *
 * `?stage=` IS DELIBERATELY NEVER WRITTEN HERE. Every lens implies its stage and
 * `mapParamsForLens` omits the param whenever the two agree; the only lens these
 * links use beyond the five chips is `shape`, whose stage is `map`. Writing it
 * would put a redundant param in front of every reader for a case that
 * round-trips without it.
 */
const LENS_PARAM = 'lens'

/**
 * A link to the map: a lens, and optionally the node it opens focused.
 *
 * ONE FUNCTION FOR EVERY MAP DESTINATION THE PALETTE HAS, so the five lens rows
 * and the track rows cannot drift apart on the query shape. The focus half is
 * written by `viewToParams` rather than concatenated: lib/mindtree/focus.ts owns
 * the `?focus=` name and the "root is not a focus" rule, and a second opinion
 * about either is exactly how a shared link stops round-tripping.
 */
export function mapHref(lens: MapLens, focusId: string | null = null): string {
  const params = viewToParams(new URLSearchParams([[LENS_PARAM, lens]]), {
    focusId,
    dimension: null,
  })
  return `${MAP_PATH}?${params.toString()}`
}

/**
 * The id of the map node a track's branch is drawn as.
 *
 * `nodeId()` in lib/mindtree/model.ts is private, so this restates its one rule
 * — `root/track:<percent-encoded id>` — and CommandPalette.test.tsx pins the
 * restatement against a tree `buildMindtree()` actually builds rather than
 * against this sentence. `encodeURIComponent` is a no-op on the uuids that reach
 * it today and is still what model.ts does, so the two keep agreeing on the day
 * a track key is not a uuid.
 */
export function trackFocusId(trackId: string): string {
  return `${ROOT_ID}/track:${encodeURIComponent(trackId)}`
}

/**
 * The five lenses, as palette rows.
 *
 * NOT in SCREENS, and the difference is exactly the guarantee
 * CommandPalette.test.tsx enforces: every entry in SCREENS must be a path
 * App.tsx routes, and none of these is one. A lens is a QUERY on the single map
 * route — `/mindtree?lens=numbers` — so a row here dead-ends only if `/mindtree`
 * itself stops being routed, which the SCREENS row above already asserts.
 *
 * WHY THEY ARE ROWS AT ALL. Typing "board" or "dashboard" into the palette was
 * how five of these surfaces were reached before the collapse, and the muscle
 * memory does not go away because the architecture did. Without these rows the
 * only way to a lens is a chip on a screen you first have to be looking at.
 *
 * `LENS_KEY` rather than five literals: lib/mindtree/lens.ts owns the lens↔label
 * mapping and MapLensBar renders from the same table, so the palette row and the
 * chip it lands on can never read differently. MAP_LENSES fixes the order.
 */
export const LENSES: readonly PaletteScreen[] = MAP_LENSES.map((lens) => ({
  to: mapHref(lens),
  labelKey: LENS_KEY[lens],
}))

/**
 * The screens App.tsx withholds, each with the key it is withheld on.
 *
 * Kept out of SCREENS rather than filtered from it at render time so the
 * distinction is visible in the source: App.tsx route-gates every row, and
 * offering someone a row that bounces them back to /settings is worse than not
 * offering it. /settings/recurring is NOT here — that screen is deliberately
 * readable by everyone and withholds its own editing.
 *
 * ONE KEY PER ROW, NOT ONE PER TABLE, since 0025. The eight rows are three
 * groups: structure, words, people. A Director holds the first two keys and not
 * the third, so this table has to be able to offer six rows and withhold two —
 * an all-or-nothing table would make Cmd-K the last place the Director role is
 * still invisible.
 *
 * The split is asserted against App.tsx twice over: the test reads which routes
 * carry a permission ternary (so a row in the wrong table is a failure rather
 * than someone bouncing off a screen the palette just promised them) and which
 * NAME each one carries (so a row's key here and the route's key there cannot
 * drift apart).
 */
export const ADMIN_SCREENS: readonly AdminPaletteScreen[] = [
  // Above tracks, the level it sits above — the same coarse-to-fine reading
  // order the filter bar's facets and the Settings page's two cards use.
  { to: '/settings/groups', labelKey: 'groups.title', permKey: 'structure.edit' },
  { to: '/settings/tracks', labelKey: 'admin.tracks.title', permKey: 'structure.edit' },
  // Below tracks: the tree (0023), then the catalogue that tree is measured
  // against (0024). Same coarse-to-fine order, continued one level down.
  { to: '/settings/structure', labelKey: 'structure.title', permKey: 'structure.edit' },
  // The read-only Jira reader, on the same key App.tsx gates its route with.
  { to: '/settings/jira', labelKey: 'jira.title', permKey: 'structure.edit' },
  // ⚠ The catalogue writes `use_cases` (vocab.edit) in one half and
  //   `map_node_kinds` (structure.edit) in the other. `vocab.edit` is the key
  //   App.tsx gates the route on, so it is the key this row must carry — a row
  //   offered on a key the route refuses is exactly the drift the test forbids.
  //   CatalogueAdmin.tsx's header owns the note.
  { to: '/settings/catalogue', labelKey: 'catalogue.title', permKey: 'vocab.edit' },
  { to: '/settings/vocabulary', labelKey: 'vocabadmin.title', permKey: 'vocab.edit' },
  { to: '/settings/terminology', labelKey: 'terminology.title', permKey: 'vocab.edit' },
  // A role is what a member holds, so it sits directly above them (0025) — and
  // both stay on `workspace.admin`, the power withheld from Director.
  { to: '/settings/roles', labelKey: 'roles.title', permKey: 'workspace.admin' },
  { to: '/settings/members', labelKey: 'route.members', permKey: 'workspace.admin' },
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
 *
 * AND IT HAPPENED AGAIN, TO THE SAME ARITHMETIC, WHEN THE LENSES ARRIVED. The
 * `screens` group is three tables now — SCREENS, then LENSES, then ADMIN_SCREENS
 * — and this sum was left counting two of them. `rankQuery` takes `slice(0,
 * limit)` on a blank query, so an admin's nineteen candidates were cut to
 * fourteen and the five that fell off the end were the whole admin block:
 * Groups, Tracks, Vocabulary, Terminology and Members were offered to nobody
 * until they typed something. LENSES is not optional in this sum — anything the
 * builder can return has to be counted here, or the tail of the list is a set of
 * screens the palette silently withholds.
 */
const GROUP_CAP: Readonly<Record<GroupId, number>> = {
  entries: 8,
  tracks: 6,
  screens: SCREENS.length + LENSES.length + ADMIN_SCREENS.length,
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

/**
 * The active tracks, each row opening that track's BRANCH ON THE MAP.
 *
 * ── THE DEAD LINK THIS REPLACES, AND WHY NOTHING SAW IT ────────────────────
 *
 * This navigated to `/tracks/<id>` until the collapse deleted that route, and it
 * kept navigating there afterwards. The failure is worse than a 404 precisely
 * because App.tsx has no 404: the catch-all redirects anything it does not
 * recognise to `/mindtree`, so a reader typed a track name, pressed Enter, and
 * landed on the map at whatever they were already looking at — no error, no
 * focus, no sign the palette had not understood them.
 *
 * It shipped because this destination is BUILT rather than LISTED. The registry
 * case in the test walks the SCREENS table, which is the only place a path was
 * ever written down; a path assembled from a uuid at call time was invisible to
 * it in both directions. The test now runs EVERY builder that takes a `navigate`
 * and checks where it actually sends the reader, against App.tsx's route table
 * with the catch-all excluded — which is the only shape of check that could have
 * caught this one.
 *
 * ── WHY `shape`, FOCUSED, AND NOT ONE OF THE OTHER FOUR ────────────────────
 *
 * The deleted screen answered "what is in this track and how is it doing".
 * `shape` focused on the track's node draws exactly that — the branch, its ring-2
 * groups and their counts — and `subjectForLens` opens the branch panel beside
 * the canvas, which is the list half of what the timeline was. The other four
 * lenses are questions about the whole workspace (what needs me, what changed,
 * the board, the numbers), so a track focus under them would answer a question
 * nobody asked and would silently override a lens the reader chose for a
 * different reason.
 */
export function trackCandidates(
  tracks: readonly Track[],
  trackLabel: TrackLabelFn,
  navigate: NavigateFn,
): RankRow<Row>[] {
  return tracks.map((track) => ({
    item: {
      id: `track:${track.id}`,
      label: trackLabel(track),
      run: () => navigate(mapHref('shape', trackFocusId(track.id))),
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
 * The admin table is APPENDED rather than merged and re-sorted, so everyone sees
 * the same twelve rows in the same order and whichever of the eight extra ones
 * they hold the key for after them — a list that reorders itself by role is a
 * list nobody builds muscle memory on. A Director's list is therefore the
 * member's twelve, then six; an admin's is the member's twelve, then eight.
 *
 * `holds` RATHER THAN A ROLE, and that is the whole change 0025 asks for here.
 * The caller owns the question — the component passes store/auth's hooks, the
 * tests pass a predicate — and this function only decides which rows the answers
 * admit and in what order. Passing a role would have put a fourth copy of "who
 * is an admin" in a file that renders a list.
 */
export function screenCandidates(
  holds: (key: PermissionKey) => boolean,
  navigate: NavigateFn,
): RankRow<Row>[] {
  // The lenses sit after the plain routes and before the admin block, so the
  // shared prefix of every viewer's list is unchanged — the property the
  // "leaving the shared order alone" case pins.
  const screens = [...SCREENS, ...LENSES, ...ADMIN_SCREENS.filter((s) => holds(s.permKey))]
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
  // STILL THE LEGACY COLUMN, and correctly: `role` below feeds canEditEntry(),
  // whose rule is `created_by === meId || owner_id === meId || role === 'admin'`
  // — an ENTRY-level question 0025 did not touch. Only the SCREEN list moved to
  // permission keys.
  const role: UserRole = profile?.role ?? 'member'
  // EVERY KEY, AS A TOTAL RECORD, so the compiler is the thing that notices when
  // api/roles adds one: a new member of `PermissionKey` fails this literal, and
  // the alternative — a predicate with a `default:` arm — would silently answer
  // for a key nobody wired up. Five unconditional hook calls; store/auth reads
  // one Set, so each is a `has()`.
  const held: Readonly<Record<PermissionKey, boolean>> = {
    'workspace.admin': useIsAdmin(),
    'structure.edit': useHasPerm('structure.edit'),
    'vocab.edit': useHasPerm('vocab.edit'),
    'members.manage': useHasPerm('members.manage'),
    'capture.write': useHasPerm('capture.write'),
  }

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
  const screenRows = screenCandidates((key) => held[key], navigate)
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
          // THE COMPOSER FIRST, THEN THE SCREEN IT LIVES ON.
          //
          // On the map the bar is already mounted at the block end, so `c` puts
          // the caret in it with NO navigation at all — and because this call is
          // inside the keydown, it is inside the user-activation stack, which is
          // what raises a software keyboard.
          //
          // OFF THE MAP IT IS A NAVIGATION, and dropping that fallback is what
          // made this a silent no-op on roughly half the application.
          // focusMapCapture() answers false whenever the bar is not mounted —
          // every mode route (/meetings*, /digest) and everything under
          // /settings — and this case discarded the answer. lib/hotkeys' own
          // `allowedAtDepth` still says "`c` navigates", the cheatsheet still
          // lists it under "Anywhere", and MAP-CONTRACT §5 asks for
          // focusMapCapture() "with the old navigate as the fallback". The old
          // navigate went to /capture, which the collapse deleted; the map is
          // where that screen went, so that is where this goes. "This screen has
          // no composer" may be a defensible policy, but it has to be SAID, and
          // changing the screen to the one place capture lives says it louder
          // than any toast — with no string to translate and no other file to
          // touch.
          //
          // `/mindtree` BARE, with no `?lens=`, which is the reader's own choice
          // being kept rather than a param forgotten: a URL carrying no lens
          // means "keep the persisted one" (mapLensFromParams returns null for
          // it), and somebody who pressed `c` asked for the box, not for a
          // different view of their workspace. pages/Mindtree mounts the
          // composer at every lens and every stage, so the box is there whatever
          // they get back.
          //
          // THE CARET DOES NOT FOLLOW ACROSS THE NAVIGATION, and that is the
          // honest cost. pages/Mindtree is lazy, so the bar mounts some frames
          // after this call; a focus() taken then is outside the user-activation
          // stack that raises a phone keyboard, and a timer that reached in after
          // the route settled would steal the caret from a reader who had already
          // started doing something else. One more `c` on arrival takes it, and
          // that press is the cheap one — the reader is now on the map.
          if (!focusMapCapture()) navigate(MAP_PATH)
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
