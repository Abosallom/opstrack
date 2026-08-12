// The curated map that turns the whole locale tree into a screen a department
// head can use.
//
// WHY THIS FILE EXISTS. Settings › Terminology lets the owner rename anything a
// person reads, in both languages, without a deploy. The key space it edits is
// every key the app ships — `entry.title`, `board.columnEmptyHint`,
// `recurring.dayOfMonthClamp`, 1,660 of them at the time of writing — and a flat
// list of that many dot paths is not a user interface, it is a database dump
// with a search box. This module is the editorial layer between the two: every
// key lands in one of seven sections a person recognises, and carries a one-line
// note saying where in the app it is read.
//
// THE TWO QUESTIONS, AND WHICH ONE EACH ANSWERS.
//
//   SECTION — *what kind of string is this?* A field label, a screen title, a
//   state word, a button, an empty state, a message. This is what the owner
//   scans by: "I want to rename the field, not the toast that mentions it."
//
//   WHERE   — *which screen is it read on?* `terminology.where.*`, rendered
//   under the row. `admin.tracks.name` and `entry.title` are both field labels
//   and belong in the same section; only the where-note distinguishes the track
//   editor from an item.
//
// Splitting them this way is what keeps seven sections honest across
// thirty-four namespaces. The alternative — a section per screen — reproduces
// the navigation the owner already has and answers the wrong question.
//
// PURE, AND DELIBERATELY NOT IMPORTING `./i18n`. Two reasons, both the ones
// lib/plural.ts's header gives: i18n.ts reads `localStorage` at module scope, so
// a value import would put a DOM dependency in the import graph of a test that
// runs under `environment: 'node'`; and this module answers with i18n KEYS
// (`terminology.section.actions`, `terminology.where.entryThread`) rather than
// translated text, so the caller translates at render time and the notes flip
// language with everything else. It reads the bundles — the same JSON i18n.ts
// reads — and nothing else.
//
// THE ORPHAN RULE. `NAMESPACE_PLACEMENT` must name EVERY top-level namespace.
// A namespace with no entry resolves to `undefined`, which
// labelSections.test.ts fails on by name. That is the whole safety property:
// the next wave that adds `src/locales/{en,ar}/onboarding.json` cannot ship a
// screen whose strings are invisible to the one place they can be renamed. A
// blanket "everything else falls into Messages" default would make the test
// vacuous and let exactly that happen, which is why there isn't one.
//
// HOW A KEY IS PLACED. `entry.errTitleLong` splits into the namespace `entry`
// and the local path `errTitleLong`; the LONGEST `prefixes` entry that the
// local path starts with wins, and the namespace's own `section`/`where` apply
// when none does. Longest-prefix rather than first-match so a rule can be
// refined without being moved: `tracks.archive` sends the button to Buttons,
// and adding `tracks.archivedToast` later sends the toast to Messages without
// touching the first rule.
//
// PREFIXES ARE LOCAL — `'errTitleLong'`, never the full dot path — and that is
// load-bearing beyond readability. `src/lib/localeReach.test.ts` scans every .ts
// file for quoted strings shaped like a dotted key and asserts each one resolves
// in BOTH bundles, comments included; a quoted namespace-qualified PREFIX is
// key-shaped, resolves to nothing, and fails that gate — as the first draft of
// this very paragraph did. Local prefixes are not key-shaped, so they are
// invisible to it, while the two kinds of string in here that ARE full keys —
// the section keys and the where keys — are deliberately caught by it and
// proven to exist in English and in Arabic.

import { ar, en, type LocaleTree } from '../locales'
import { stripInvisible } from './bidi'
import { isPluralNode, type PluralNode } from './plural'

/* ────────────────────────────── the sections ────────────────────────────── */

/**
 * The seven groups, in the order the owner meets them.
 *
 * Ordered by what a department head reaches for first, which is not the order
 * of the key space: field labels and navigation are renamed on day one, an
 * error string is renamed the day it confuses somebody. The long tail is
 * `messages` by design — the spec asks for it there rather than for twenty
 * thin sections nobody can hold in their head.
 */
export type LabelSectionId =
  | 'entryFields'
  | 'navigation'
  | 'screenTitles'
  | 'healthStates'
  | 'actions'
  | 'emptyStates'
  | 'messages'

export interface LabelSectionMeta {
  readonly id: LabelSectionId
  /** `t()` key for the section's name. */
  readonly labelKey: string
  /** `t()` key for the line under the name. */
  readonly hintKey: string
}

/** The section list, in display order. Index in this array IS the sort order. */
export const LABEL_SECTIONS: readonly LabelSectionMeta[] = [
  {
    id: 'entryFields',
    labelKey: 'terminology.section.entryFields',
    hintKey: 'terminology.sectionHint.entryFields',
  },
  {
    id: 'navigation',
    labelKey: 'terminology.section.navigation',
    hintKey: 'terminology.sectionHint.navigation',
  },
  {
    id: 'screenTitles',
    labelKey: 'terminology.section.screenTitles',
    hintKey: 'terminology.sectionHint.screenTitles',
  },
  {
    id: 'healthStates',
    labelKey: 'terminology.section.healthStates',
    hintKey: 'terminology.sectionHint.healthStates',
  },
  {
    id: 'actions',
    labelKey: 'terminology.section.actions',
    hintKey: 'terminology.sectionHint.actions',
  },
  {
    id: 'emptyStates',
    labelKey: 'terminology.section.emptyStates',
    hintKey: 'terminology.sectionHint.emptyStates',
  },
  {
    id: 'messages',
    labelKey: 'terminology.section.messages',
    hintKey: 'terminology.sectionHint.messages',
  },
]

/* ─────────────────────────────── the rules ──────────────────────────────── */

/** A refinement inside one namespace: these local paths go somewhere else. */
export interface LabelRule {
  /** Local paths — the part after `namespace.` — matched with `startsWith`. */
  readonly prefixes: readonly string[]
  readonly section: LabelSectionId
  /** Overrides the namespace's where-note. Omitted means "same screen". */
  readonly where?: string
}

/** Where a namespace's keys land when no rule below claims them. */
export interface NamespacePlacement {
  readonly section: LabelSectionId
  /** `t()` key for the "where you see it" note. */
  readonly where: string
  readonly rules?: readonly LabelRule[]
}

/**
 * Namespace → its home, and the refinements inside it. THE curated map.
 *
 * Exported because the spec asks for the grouping to live in one reviewable
 * constant, and because labelSections.test.ts checks it from the outside: every
 * namespace covered, every section id real, and every prefix still matching a
 * shipped key — a rule left behind by a rename is dead weight that will quietly
 * claim the next key to take that name.
 *
 * ORDER IS MEANINGFUL: a namespace's position here is its sort rank inside a
 * section, so the item fields come before the board's, and the sign-in screen's
 * come last. Reordering this object reorders the screen.
 *
 * EVERY NAMESPACE IN `src/locales/` MUST APPEAR. See the orphan rule in the
 * header — the test fails by name, not silently.
 */
export const NAMESPACE_PLACEMENT: Readonly<Record<string, NamespacePlacement>> = {
  // ── what the owner renames first: the words on an item ──────────────────
  entry: {
    section: 'entryFields',
    where: 'terminology.where.entry',
    rules: [
      {
        prefixes: [
          'actions',
          'addLink',
          'addTag',
          'assignToMe',
          'cancelEntry',
          'changePriority',
          'changeStatus',
          'changeType',
          'clearDue',
          'clearFollowUp',
          'close',
          'collapseSection',
          'copyLink',
          'delete',
          'edit',
          'expandSection',
          'markDone',
          'next',
          'open',
          'pickOwner',
          'pickTrack',
          'prev',
          'removeLink',
          'removeTag',
          'reopen',
          'setDue',
          'setFollowUp',
          'snooze',
        ],
        section: 'actions',
      },
      {
        prefixes: ['descriptionEmpty', 'no', 'sectionEmpty'],
        section: 'emptyStates',
      },
      // `closedOn` and `notFound` sit under longer prefixes than the `close`
      // button and the `no…` empty labels above, which is how longest-prefix
      // matching lets one rule refine another without either moving.
      { prefixes: ['closedOn'], section: 'entryFields' },
      // TWO HEADINGS IN THE SAME SHEET BOTH SAY "Details". `entry.description`
      // titles the free-text block (EntrySheet.tsx:438) and `entry.details`
      // titles the status/priority/owner block below it (:451). Same word, same
      // section, same screen — so the where-note is the only thing that can tell
      // the owner which one he is renaming, which is the job this file exists to
      // do. (`descriptionEmpty` keeps its own longer prefix above.)
      {
        prefixes: ['description'],
        section: 'entryFields',
        where: 'terminology.where.entryNotes',
      },
      // The thread is a screen of its own inside the sheet, so it takes its own
      // where-note even where the section is unchanged.
      {
        prefixes: ['activity', 'author', 'update'],
        section: 'entryFields',
        where: 'terminology.where.entryThread',
      },
      {
        prefixes: ['post', 'showEarlier', 'showFewer'],
        section: 'actions',
        where: 'terminology.where.entryThread',
      },
      {
        prefixes: [
          'arrow',
          'flash',
          'immutableHint',
          'posted',
          'statusChanged',
          'updatedBy',
          'updatedGeneric',
        ],
        section: 'messages',
        where: 'terminology.where.entryThread',
      },
      { prefixes: ['health', 'sla'], section: 'healthStates' },
      {
        prefixes: [
          'cannotEdit',
          'cancelled',
          'deleteBody',
          'deleteTitle',
          'deleted',
          'err',
          'linkCopied',
          'markedDone',
          'notFound',
          'queued',
          'readOnly',
          'reopened',
          'savedToast',
          'saving',
          'sectionCount',
          'snoozed',
        ],
        section: 'messages',
      },
    ],
  },

  // ── the chrome that names the app ───────────────────────────────────────
  nav: { section: 'navigation', where: 'terminology.where.nav' },
  route: { section: 'screenTitles', where: 'terminology.where.header' },
  app: { section: 'screenTitles', where: 'terminology.where.product' },

  // ── the state words ─────────────────────────────────────────────────────
  //
  // status/priority/type are the BUILT-IN wording behind Settings › Vocabulary.
  // An option renamed there wins over anything typed here, which is what the
  // where-note says — otherwise this screen looks broken to whoever renamed
  // "Blocked" in the other one.
  health: { section: 'healthStates', where: 'terminology.where.health' },
  status: { section: 'healthStates', where: 'terminology.where.vocabWords' },
  priority: { section: 'healthStates', where: 'terminology.where.vocabWords' },
  type: { section: 'healthStates', where: 'terminology.where.vocabWords' },
  date: {
    section: 'healthStates',
    where: 'terminology.where.dates',
    // A bare separator is not a state word. It is punctuation the app joins two
    // dates with, and the long tail is where punctuation belongs.
    rules: [{ prefixes: ['rangeSep'], section: 'messages' }],
  },

  // ── the daily screens ───────────────────────────────────────────────────
  followups: {
    section: 'entryFields',
    where: 'terminology.where.followups',
    rules: [
      { prefixes: ['title'], section: 'screenTitles' },
      {
        // The six section headings and their hints ARE the health vocabulary of
        // this screen — lib/entrySections.ts buckets by exactly these names.
        prefixes: ['blocked', 'dueSoon', 'overdue', 'sla', 'stale', 'unassigned'],
        section: 'healthStates',
      },
      {
        prefixes: [
          'addUpdate',
          'collapseSection',
          'expandSection',
          'markDone',
          'open',
          'quickPost',
          'refresh',
          'showAll',
          'showLess',
          'snooze',
          'takeIt',
        ],
        section: 'actions',
      },
      {
        prefixes: ['allClear', 'empty', 'sectionEmpty'],
        section: 'emptyStates',
      },
      {
        prefixes: [
          'doneToast',
          'err',
          'onceOnly',
          'posted',
          'refreshed',
          'sectionCount',
          'slaFrom',
          'snoozed',
          'taken',
          'updatedAgo',
        ],
        section: 'messages',
      },
    ],
  },
  // The Mindtree map. It arrived on main while the Terminology screen was being
  // built in an isolated branch, so the merge is the first time this map has
  // seen it — which is exactly the orphan case the "no orphans" test exists to
  // catch, and it did.
  mindtree: {
    section: 'entryFields',
    where: 'terminology.where.mindtree',
    rules: [
      // `subtitle` is gone with the drawn <h1> the app header already said in
      // the same words one row above; `title` is still the route's own name.
      { prefixes: ['title'], section: 'screenTitles' },
      // The four grouping axes and the state words the nodes carry. These are
      // the same vocabulary the board and follow-ups use, read off a picture.
      //
      // `countLive` — "6 of 9 live", the progress underscore said out loud in
      // every branch's accessible name — rides the `count` prefix WITHOUT a rule
      // of its own, and that is the answer rather than an oversight: it sits
      // beside countOpen/countBreached/countUnassigned in one comma-joined
      // sentence, so an owner retitling one of them will want the other three in
      // the same list. The word "live" inside it is NOT renamed here — it is
      // interpolated from `mapnode.wordLive`, which already has its own row and
      // its own `terminology.where.mindtreeProgress` note, and a second editable
      // copy of one word is exactly the drift the where-notes exist to prevent.
      {
        prefixes: ['archived', 'breach', 'count', 'dim'],
        section: 'healthStates',
      },
      // Everything a person presses: the group-by menu, the DIVE RAIL, the
      // breadcrumb and its elision, the export menu, and the node menu's own
      // expand/collapse pair.
      //
      // `fit` and `zoom` are NOT here any more, and their absence is the shape
      // of the redesign: "Fit to view", "Zoom in", "Zoom out" and "Zoom 100%"
      // were four buttons answering one question — how much of the organisation
      // am I looking at — and the wheel, the pinch and one continuous rail
      // answer it now. `dive` is that rail; `crumb` is the truncation mark on
      // the trail it shares the answer with.
      {
        prefixes: [
          'back',
          'breadcrumb',
          'cellFilter',
          'clear',
          'collapse',
          'copy',
          'crumb',
          'dive',
          'download',
          'expand',
          'export',
          'focus',
          'table',
        ],
        section: 'actions',
      },
      { prefixes: ['empty', 'branchEmpty'], section: 'emptyStates' },
      // `nodesPartial` joins the errors rather than the states it sits beside on
      // screen: it is a sentence about the READ, like every other message here,
      // and the reader who retitles it is retitling a warning.
      { prefixes: ['err', 'nodesPartial'], section: 'messages' },
    ],
  },

  // The map's own panel strings (U3's `map` namespace), placed beside mindtree
  // because they are the same screen: the four keys name the panel's
  // Everyone/Mine scope pair, its filter announcement and the changes-filter
  // group. `changes*` goes to Actions because it labels a control.
  map: {
    section: 'messages',
    where: 'terminology.where.mindtree',
    rules: [{ prefixes: ['changes'], section: 'actions' }],
  },

  board: {
    section: 'entryFields',
    where: 'terminology.where.board',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      {
        prefixes: [
          'collapseColumn',
          'expandColumn',
          'quickAdd',
          'refresh',
          'showAll',
          'showLess',
        ],
        section: 'actions',
      },
      { prefixes: ['columnEmpty', 'empty'], section: 'emptyStates' },
      {
        prefixes: [
          'columnCount',
          'dragCancelled',
          'dragHint',
          'dropTop',
          'dropped',
          'err',
          'grabbed',
          'holdHint',
          'keyboardHint',
          'moveAnnounce',
          'moveDisabled',
          'moved',
          'overflowHint',
          'quickAddDone',
          'quickAddHint',
        ],
        section: 'messages',
      },
    ],
  },
  capture: {
    section: 'entryFields',
    where: 'terminology.where.capture',
    rules: [
      { prefixes: ['title'], section: 'screenTitles' },
      {
        prefixes: [
          'addTag',
          'another',
          'chipFix',
          'chipRemove',
          'clear',
          'hideHints',
          'openCaptured',
          'openTemplates',
          'showHints',
          'submit',
          'undo',
        ],
        section: 'actions',
      },
      { prefixes: ['chipNone', 'previewEmpty', 'recentEmpty'], section: 'emptyStates' },
      {
        prefixes: [
          'captured',
          'err',
          'newOwner',
          'parsedAnnounce',
          'problem',
          'submitting',
          'undone',
          'warn',
          'willCreate',
          'templateWhere',
        ],
        section: 'messages',
      },
    ],
  },
  tree: {
    section: 'entryFields',
    where: 'terminology.where.tree',
    rules: [
      {
        prefixes: [
          'bulkAssign',
          'bulkClear',
          'bulkPriority',
          'bulkTrack',
          'refresh',
          'showAll',
          'showLess',
        ],
        section: 'actions',
      },
      { prefixes: ['allClear', 'empty'], section: 'emptyStates' },
      { prefixes: ['archived'], section: 'healthStates' },
      { prefixes: ['archivedHint'], section: 'messages' },
      {
        prefixes: [
          'assigned',
          'bulkBusy',
          'bulkDone',
          'bulkFailed',
          'bulkPartial',
          'bulkQueued',
          'cleared',
          'confirm',
          'hint',
          'selectionCleared',
        ],
        section: 'messages',
      },
    ],
  },
  track: {
    section: 'entryFields',
    where: 'terminology.where.trackLog',
    rules: [
      { prefixes: ['refresh'], section: 'actions' },
      { prefixes: ['empty', 'tagsEmpty'], section: 'emptyStates' },
      { prefixes: ['statOverdue', 'statStale', 'statBlocked', 'statSla'], section: 'healthStates' },
      {
        prefixes: [
          'err',
          'orphan',
          'refreshed',
          'statsHint',
          'statsPartial',
          'tagsHint',
          'truncated',
        ],
        section: 'messages',
      },
    ],
  },
  filter: {
    section: 'entryFields',
    where: 'terminology.where.filters',
    rules: [
      { prefixes: ['title'], section: 'screenTitles' },
      { prefixes: ['apply', 'clear', 'open'], section: 'actions' },
      { prefixes: ['noResults'], section: 'emptyStates' },
      // The branch facet's two SENTENCES, refined out of the field labels the
      // rest of this namespace is: `branch` is the heading on the control,
      // `branchHint` explains that everything filed underneath is included, and
      // `branchGone` is what a stale link resolves to.
      { prefixes: ['branchHint', 'branchGone'], section: 'messages' },
    ],
  },
  dashboard: {
    section: 'entryFields',
    where: 'terminology.where.dashboard',
    rules: [
      { prefixes: ['subtitle'], section: 'screenTitles' },
      { prefixes: ['goDigest', 'refresh', 'showData'], section: 'actions' },
      {
        prefixes: [
          'ageEmpty',
          'blank',
          'blockedNone',
          'chartEmpty',
          'flowEmpty',
          'ownerEmpty',
          'slaEmpty',
          'trackEmpty',
        ],
        section: 'emptyStates',
      },
      {
        prefixes: ['statBlocked', 'statOverdue', 'statQuiet'],
        section: 'healthStates',
        where: 'terminology.where.dashboardTiles',
      },
      // `statOpen`/`statClosed` are the counters at the top; `colOpen`/`closed`
      // are a column heading and a chart legend saying the identical word
      // further down the same screen. Splitting the where-note is what makes
      // "Open" and "Open" two different rows a person can choose between.
      { prefixes: ['stat'], section: 'entryFields', where: 'terminology.where.dashboardTiles' },
      {
        prefixes: ['col', 'closed'],
        section: 'entryFields',
        where: 'terminology.where.dashboardCharts',
      },
      {
        prefixes: [
          'closedFailed',
          'footnote',
          'healthPart',
          'listSep',
          'noValue',
          'ownerNote',
          'pct',
          'slaMatrixFailed',
          'slaNone',
          'slaUnmeasured',
          'truncated',
        ],
        section: 'messages',
      },
    ],
  },

  // ── the aggregate screens ───────────────────────────────────────────────
  meeting: {
    section: 'entryFields',
    where: 'terminology.where.meetings',
    rules: [
      {
        prefixes: ['formTitle', 'subtitle', 'title', 'triage'],
        section: 'screenTitles',
      },
      // The meeting's own title field, not the screen's heading.
      { prefixes: ['titleLabel', 'titlePlaceholder'], section: 'entryFields' },
      { prefixes: ['backToMeetings', 'goTriage'], section: 'navigation' },
      { prefixes: ['badge', 'state'], section: 'healthStates' },
      // THE THREE SCREENS OF THIS NAMESPACE, and the reason they need naming:
      // `colTrack` (triage) and `trackLabel` (the list) are both "Track",
      // `ownerExternal` (triage) and `attendeePlaceholder` (the list) are both
      // "Someone else", and `decisionDiscard` (triage) and `discard` (the live
      // meeting) are both "Discard". The section cannot separate them and the
      // words are identical, so the where-note has to.
      {
        prefixes: ['attendeePlaceholder', 'lineCount', 'trackLabel'],
        section: 'entryFields',
        where: 'terminology.where.meetingsList',
      },
      // `captured` counts what the meeting has taken down SO FAR, on the live
      // meeting; `lineCount` counts a finished meeting's lines in the list. Same
      // "{count} lines" in both languages, same section — the note is the only
      // difference an owner can see.
      { prefixes: ['captured'], section: 'entryFields', where: 'terminology.where.meetingLive' },
      {
        prefixes: ['col', 'ownerExternal'],
        section: 'entryFields',
        where: 'terminology.where.meetingTriage',
      },
      { prefixes: ['decision'], section: 'actions', where: 'terminology.where.meetingTriage' },
      {
        prefixes: [
          'attendeeAdd',
          'attendeeRemove',
          'commit',
          'discard',
          'editLine',
          'end',
          'fillDown',
          'makeAction',
          'makeNote',
          'newMeeting',
          'openEntry',
          'openLabel',
          'restore',
          'resume',
          'sameAsAbove',
          'startNow',
        ],
        section: 'actions',
      },
      {
        prefixes: ['capturedNone', 'empty', 'nothingToTriage'],
        section: 'emptyStates',
      },
      {
        prefixes: [
          'announceLine',
          'commitDone',
          'commitEmpty',
          'commitPartial',
          'committing',
          'discardedKept',
          'endConfirmBody',
          'endConfirmTitle',
          'ended',
          'ending',
          'err',
          'fillDownDone',
          'hintEnter',
          'lineQueued',
          'lineSaving',
          'loadFailed',
          'loadLinesFailed',
          'notFound',
          'notesSaved',
          'resumed',
          'starting',
        ],
        section: 'messages',
      },
    ],
  },
  minutes: {
    section: 'entryFields',
    where: 'terminology.where.minutes',
    rules: [
      { prefixes: ['copy', 'openEntry', 'print'], section: 'actions' },
      // `metaTrack` labels the heading block at the top of the minutes and
      // `fieldTrack` labels a column in the body; both are "Track".
      // (`metaSep` keeps its own longer prefix in the messages rule below.)
      { prefixes: ['meta'], section: 'entryFields', where: 'terminology.where.minutesMeta' },
      { prefixes: ['emptyBody'], section: 'emptyStates' },
      {
        prefixes: ['copied', 'err', 'inProgress', 'listSep', 'metaSep', 'notFound', 'timeSep'],
        section: 'messages',
      },
    ],
  },
  recurring: {
    section: 'entryFields',
    where: 'terminology.where.recurring',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['behind', 'paused', 'trackArchived'], section: 'healthStates' },
      // `cadenceDaily` is the option in the picker and `summaryDaily` is the
      // sentence the saved schedule shows; both are "Every day".
      { prefixes: ['summary'], section: 'entryFields', where: 'terminology.where.recurringSummary' },
      {
        prefixes: [
          'add',
          'alignApply',
          'create',
          'discard',
          'editRow',
          'closeRow',
          'openItem',
          'pause',
          'resume',
          'runNow',
          'runRow',
          'pauseRow',
          'resumeRow',
          'deleteRow',
          'save',
          'skipAhead',
        ],
        section: 'actions',
      },
      { prefixes: ['empty'], section: 'emptyStates' },
      // Two DIFFERENT boxes whose refusals are word-for-word identical —
      // "Between {min} and {max} days." Nothing but the where-note can say
      // which is which, and both prefixes are longer than the `err` rule below.
      {
        prefixes: ['errInterval'],
        section: 'messages',
        where: 'terminology.where.recurringInterval',
      },
      { prefixes: ['errLead'], section: 'messages', where: 'terminology.where.recurringLead' },
      {
        prefixes: [
          'alignPrompt',
          'behindBody',
          'behindCapped',
          'clamped',
          'createdToast',
          'creating',
          'dayOfMonthClamp',
          'deleteAdminOnly',
          'deleteBody',
          'deleteTitle',
          'deletedToast',
          'discardBody',
          'discardTitle',
          'err',
          'leadExplainer',
          'pausedToast',
          'ranToast',
          'resumedToast',
          'running',
          'savedToast',
          'saving',
          'scheduleHint',
          'skipNothingToast',
          'skippedToast',
          'unsaved',
        ],
        section: 'messages',
      },
    ],
  },
  digest: {
    section: 'entryFields',
    where: 'terminology.where.digest',
    rules: [
      { prefixes: ['docTitle', 'subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['section', 'sum', 'detail'], section: 'healthStates' },
      // `sectionsLegend`/`sectionsHint` are the picker, not a bucket name; they
      // sit under longer prefixes than `section` on purpose.
      { prefixes: ['sectionsLegend'], section: 'entryFields' },
      { prefixes: ['sectionsHint', 'summaryEmpty', 'sep'], section: 'messages' },
      { prefixes: ['copy', 'download', 'print', 'refresh'], section: 'actions' },
      { prefixes: ['empty', 'trackAllClear'], section: 'emptyStates' },
      {
        prefixes: [
          'copied',
          'err',
          'generatedLabel',
          'loadingData',
          'notePrefix',
          'rangeLabel',
          'tracksHint',
          'truncatedNote',
          'includeTagsHint',
          'langHint',
          'formatHtmlHint',
          'formatMarkdownHint',
          'formatPlainHint',
        ],
        section: 'messages',
      },
    ],
  },
  // The chase (0019). Filed under Follow-ups because that is the only screen it
  // renders on today, and because an owner rewording "Ask for an update" is
  // rewording the follow-ups pass — they will want both in one sitting. It gets
  // its own namespace rather than a corner of `followups` for the reason the
  // registry exists: the control is a component, not a screen, and it moves to
  // the board and the entry sheet next.
  //
  // EVERY STRING HERE IS RENAMEABLE ON PURPOSE. This is the most tone-sensitive
  // copy in the app — a button whose whole job is interrupting a colleague — and
  // "Ask for an update" is a guess about how this particular team talks to each
  // other. Being able to change it to their words, in both languages, without a
  // deploy, is worth more here than almost anywhere else in the tree.
  nudge: {
    section: 'messages',
    where: 'terminology.where.followups',
    rules: [
      // `ask` claims askAgain/askOf/askAgainOf too — one prefix, four controls
      // and their tooltips, which are the same act said at four lengths.
      { prefixes: ['ask'], section: 'actions' },
      // …and `askedBy` takes them back, because longest prefix wins: those two
      // are the accessible sentence on the record, not a control.
      { prefixes: ['askedBy'], section: 'messages' },
      // What the ROW says about itself once somebody has asked — the same
      // reading `followups.sla*` gets, and it sits beside that pill on the row.
      { prefixes: ['pill'], section: 'healthStates' },
    ],
  },

  notif: {
    section: 'entryFields',
    where: 'terminology.where.notifications',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['openInbox', 'seeAll'], section: 'navigation' },
      { prefixes: ['markAllRead', 'markRead', 'refresh', 'show'], section: 'actions' },
      { prefixes: ['empty', 'noUnread'], section: 'emptyStates' },
      {
        prefixes: ['allRead', 'assigned', 'completed', 'err'],
        section: 'messages',
      },
    ],
  },

  // ── settings and the admin screens ──────────────────────────────────────
  settings: {
    section: 'entryFields',
    where: 'terminology.where.settings',
    rules: [
      { prefixes: ['title'], section: 'screenTitles' },
      { prefixes: ['signOut'], section: 'actions' },
      {
        prefixes: ['exportManage', 'membersManage', 'recurringManage', 'vocabularyManage'],
        section: 'navigation',
      },
      { prefixes: ['membersEmpty'], section: 'emptyStates' },
      {
        prefixes: [
          'languageHint',
          'membersAdminOnly',
          'membersHint',
          'membersSoon',
          'recurringHint',
          'signingOut',
          'themeHint',
          'vocabularyHint',
        ],
        section: 'messages',
      },
    ],
  },
  admin: {
    section: 'entryFields',
    where: 'terminology.where.settingsTracks',
    rules: [
      { prefixes: ['title', 'tracks.subtitle', 'tracks.title'], section: 'screenTitles' },
      { prefixes: ['tracks.active', 'tracks.archived'], section: 'healthStates' },
      {
        prefixes: [
          'tracks.add',
          'tracks.archive',
          'tracks.delete',
          'tracks.discard',
          'tracks.edit',
          'tracks.manage',
          'tracks.moveDown',
          'tracks.moveUp',
          'tracks.removeTag',
          'tracks.restore',
          'tracks.showArchived',
        ],
        section: 'actions',
      },
      { prefixes: ['tracks.empty', 'tracks.usageNone'], section: 'emptyStates' },
      {
        prefixes: [
          'errForbidden',
          'tracks.archiveBody',
          'tracks.archiveTitle',
          'tracks.archivedToast',
          'tracks.colorHint',
          'tracks.created',
          'tracks.deleteBody',
          'tracks.deleteTitle',
          'tracks.deleted',
          'tracks.discardBody',
          'tracks.discardTitle',
          'tracks.err',
          'tracks.loadFailed',
          'tracks.movedTo',
          'tracks.reassignNoTargets',
          'tracks.reordered',
          'tracks.restoredToast',
          'tracks.saved',
          'tracks.saving',
          'tracks.slaAfterSave',
          'tracks.slaRule',
          'tracks.suggestedTagsHint',
        ],
        section: 'messages',
      },
    ],
  },
  // Settings › Structure and Settings › Catalogue (0023/0024) — the hierarchy
  // BELOW a track (programme ▸ phase ▸ organization) and the HL7/FHIR capability
  // list those organizations are onboarded onto. Placed beside `groups` because
  // the three screens are one family: `groups` sits above tracks, `mapadmin`
  // sits below them.
  //
  // EVERY KEY HERE IS AN ERROR, and every one of them comes from Postgres by way
  // of `src/lib/pgError.ts` rather than from a form validator — a duplicate name,
  // a cycle, a depth cap, a delete the database refused. So there is one rule and
  // it covers the whole namespace; a future title or button needs its own.
  mapadmin: {
    section: 'messages',
    where: 'terminology.where.settingsStructure',
    rules: [{ prefixes: ['err'], section: 'messages' }],
  },
  // Settings › Structure (0023) — the tree beneath each track. Placed beside
  // `mapadmin`, which holds the Postgres refusals this screen renders: the two
  // are one screen's vocabulary split across an error path and a UI path.
  structure: {
    section: 'entryFields',
    where: 'terminology.where.settingsStructureTree',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['settingsHint'], section: 'messages' },
      // What a row IS, not what a control says — `admin.tracks.archived`'s reading.
      {
        prefixes: ['archived', 'kindNone', 'managerNone', 'trackArchived', 'unsaved'],
        section: 'healthStates',
      },
      {
        prefixes: [
          'add',
          'addChild',
          'addClose',
          'addRoot',
          'archive',
          'discard',
          'edit',
          'editDone',
          'manage',
          'restore',
          'save',
        ],
        section: 'actions',
      },
      // The two panels this screen opens over itself. Their buttons say
      // "Close", "Cancel" and one verb each — words the row actions above
      // already spend — so only the where-note can tell an owner which
      // "Close" he is renaming. That is this file's stated job.
      {
        prefixes: ['moveClose', 'moveConfirm', 'moveUnder'],
        section: 'actions',
        where: 'terminology.where.settingsStructureMove',
      },
      {
        prefixes: ['archiveConfirm', 'cancel'],
        section: 'actions',
        where: 'terminology.where.settingsStructureArchive',
      },
      {
        prefixes: ['archiveBody', 'archiveTitle'],
        section: 'messages',
        where: 'terminology.where.settingsStructureArchive',
      },
      { prefixes: ['empty', 'emptyHint', 'emptyTrack', 'moveNowhere'], section: 'emptyStates' },
      // Longest-prefix refinements of the buttons above: the sentences that
      // FOLLOW an action are messages, not the action itself. `archived` is a
      // state and stays a state; `archivedToast` is what we said afterwards.
      {
        prefixes: [
          'archivedHint',
          'archivedToast',
          'created',
          'depthCap',
          'loadFailed',
          'managerCleared',
          'managerSet',
          'moveCount',
          'moveCounting',
          'moveCrossTrack',
          'moveNoEntries',
          'moveSameTrack',
          'moved',
          'nameArHint',
          'nameRequired',
          'reordered',
          'restoredHidden',
          'restoredToast',
          'saved',
          'trackArchivedHint',
          'vendorHint',
        ],
        section: 'messages',
      },
    ],
  },
  // Settings › Jira — the read-only Jira harness. Beside `structure` and
  // `catalogue` because it is the same screen family: it matches Jira's values
  // against the tree those two screens build.
  jira: {
    section: 'entryFields',
    where: 'terminology.where.settingsJira',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['settingsHint'], section: 'messages' },
      { prefixes: ['fieldCustom', 'statusIgnore', 'statusLive', 'statusPlanned', 'statusTesting'], section: 'healthStates' },
      { prefixes: ['connTest', 'connTesting', 'jqlRun', 'jqlRunning', 'manage', 'mapLoad', 'mapLoading', 'projectsLoad', 'projectsLoading', 'showAll', 'showOnly'], section: 'actions' },
      { prefixes: ['fieldsEmpty', 'projectsEmpty', 'projectsUntried', 'resultsEmpty', 'resultsUntried', 'statusesEmpty'], section: 'emptyStates' },
      { prefixes: ['ambiguousMatches', 'blank', 'catalogueFailed', 'connOk', 'connSecrets', 'connUntested', 'err', 'filtered', 'issueCount', 'loadFailed', 'morePages', 'projectsCount', 'readOnly', 'summary', 'verdict'], section: 'messages' },
      { prefixes: ['reason'], section: 'messages' },
      // W7's ~30 new keys. Without these they fall to the namespace default
      // (`entryFields`) and Terminology files thirty sentences under "entry
      // fields", which is where nobody would look for them. Longest-prefix-wins
      // makes this a pure addition: `foldArabicBody` is listed beside
      // `foldArabic` so the longer prefix takes it to `messages`, and
      // `statusField` is deliberately absent so it keeps the `entryFields`
      // default beside `orgField` and `useCaseField` — it names a field.
      { prefixes: ['foldArabic', 'loadMore', 'loadingMore'], section: 'actions' },
      { prefixes: ['noKey', 'noLink'], section: 'healthStates' },
      {
        prefixes: ['allRead', 'candidates', 'catalogueTruncated', 'duplicateClaimedBy',
          'effect', 'foldArabicBody', 'links', 'mapIncomplete', 'matchedOnArabic',
          'noApply', 'noEntries', 'noNodes', 'noSchedule', 'orgArchived', 'presence',
          'statusConflict', 'useCaseRetired', 'valueWas', 'valuesWere'],
        section: 'messages',
      },
    ],
  },
  // The SAVED Jira configuration (0028) — the state pill on the Settings card,
  // the off-switch's own words, and the five sentences 0028's constraints map
  // to. A SEPARATE NAMESPACE FROM `jira`, and the split is ownership rather
  // than taxonomy: `jira` is the reader screen's vocabulary and this is the
  // configuration's, and one file per namespace is exactly how this repo keeps
  // two workers off one another's strings (src/locales/index.ts's header).
  //
  // `where` reuses the Jira note: both namespaces are renamed from the same
  // screen family, and a second note would say the same sentence twice.
  jiraconfig: {
    section: 'entryFields',
    where: 'terminology.where.settingsJira',
    rules: [
      // What the integration IS right now — the four states of the card's pill,
      // read the way `admin.tracks.archived` is read: a condition, not a label.
      { prefixes: ['state'], section: 'healthStates' },
      { prefixes: ['enableLabel', 'save', 'saving'], section: 'actions' },
      {
        prefixes: ['droppedStatuses', 'enableHint', 'err', 'offEverywhere', 'refusals', 'saved'],
        section: 'messages',
      },
    ],
  },
  // Settings › Catalogue (0023/0024) — the HL7/FHIR capability list and the
  // kinds a map node can be. Beside `mapadmin` because Structure and Catalogue
  // are one screen family; `where` reuses the note that already names both.
  catalogue: {
    section: 'entryFields',
    where: 'terminology.where.settingsCatalogue',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['settingsHint'], section: 'messages' },
      // What a row IS, not what it says — `admin.tracks.archived`'s reading.
      // The three stage badges join it for the same reason: "Counts as arrived"
      // is a condition of the rung, and the owner renaming it is renaming a
      // state. Their EDITOR twins (`terminalLabel`, `pausedLabel`,
      // `expectedDaysLabel`) deliberately stay on the namespace default,
      // `entryFields` — those name fields on a form, which is the other
      // question this file asks.
      {
        prefixes: ['hidden', 'needsArabic', 'stageExpected', 'stagePaused', 'stageTerminal', 'unsaved'],
        section: 'healthStates',
      },
      {
        // `moveUp`/`moveDown` and not `move`: the `moved*` family below is a
        // sentence, and one four-letter prefix would file them together.
        //
        // `reorderStagesConfirm` is listed while `reorderStages*` sits in
        // Messages below: longest prefix wins, so the button's word comes here
        // and the two sentences that explain it stay there.
        prefixes: [
          'addKind',
          'addStage',
          'addSubmit',
          'addUseCase',
          'cancelAdd',
          'closeRow',
          'delete',
          'discard',
          'editRow',
          'hide',
          'manage',
          'moveDown',
          'moveUp',
          'reorderStagesConfirm',
          'save',
          'show',
        ],
        section: 'actions',
      },
      { prefixes: ['useCasesEmpty', 'kindsEmpty', 'stagesEmpty'], section: 'emptyStates' },
      // TWO LISTS ON ONE SCREEN, and their two delete dialogs are word for word
      // identical — "Delete {name}?" in both languages. The where-note is the
      // only thing that can say which list an owner is renaming.
      {
        prefixes: ['deleteUseCase'],
        section: 'messages',
        where: 'terminology.where.settingsCatalogueUseCases',
      },
      {
        prefixes: ['deleteKind'],
        section: 'messages',
        where: 'terminology.where.settingsCatalogueKinds',
      },
      // The third list's dialog. It reuses the SCREEN-WIDE note rather than a
      // list-specific one, unlike its two neighbours above: there is no
      // `settingsCatalogueStages` where-note in `terminology.json`, which this
      // file may not add, and naming a key that does not exist would fail
      // localeReach rather than mislabel a row. The handoff asks for that note
      // (and for `settingsCatalogueKinds`, whose text says "at the bottom of
      // the screen" and stopped being true when this list landed under it).
      {
        prefixes: ['deleteStage'],
        section: 'messages',
        where: 'terminology.where.settingsCatalogue',
      },
      {
        prefixes: ['deleteConfirm'],
        section: 'actions',
        where: 'terminology.where.settingsCatalogueDelete',
      },
      {
        // Longest prefix wins, which is how `saved`/`added`/`deleted` sit in
        // Messages while `save`/`delete` stay in Actions.
        prefixes: [
          'adding',
          'added',
          'arabicPending',
          'deleted',
          'errExpectedDays',
          'errNameLong',
          'errNameRequired',
          'errSave',
          'expectedDaysHint',
          'hideVsDelete',
          'inUse',
          'kindUsage',
          'kindsHint',
          'kindsNoHide',
          'loadFailed',
          'moved',
          'nameArHint',
          'needsArabicHint',
          'notInstalled',
          'pausedHint',
          'reordered',
          'reorderStages',
          'saved',
          'saving',
          'stageUsage',
          'stagesArabicPending',
          'stagesHint',
          'stagesLoadFailed',
          'stagesNoThresholds',
          'stagesOrderNote',
          'terminalHint',
          'usageUnknown',
          'useCasesHint',
          'useCasesOrderNote',
          'whyEditable',
        ],
        section: 'messages',
      },
    ],
  },
  // The Org panel's detail band (components/map/MapBranchDetail.tsx) — the
  // fields a node carries and the capability matrix under them. `entryFields`
  // because these ARE field names on the thing a reader clicked, and the
  // account-manager label is the one an owner renames first.
  mapnode: {
    section: 'entryFields',
    where: 'terminology.where.mindtree',
    rules: [
      { prefixes: ['status', 'retired'], section: 'healthStates' },
      // `wordLive` is "live" inside the "6 of 9 live" heading; `statusLive` is
      // the pill on a capability row. Same word, two places, and only the
      // where-note distinguishes them on the Terminology screen.
      {
        prefixes: ['word'],
        section: 'healthStates',
        where: 'terminology.where.mindtreeProgress',
      },
      { prefixes: ['managerGone', 'notRecorded', 'progress', 'retiredHint'], section: 'messages' },
    ],
  },
  // Settings › Groups (0018) — the level above tracks, and the screen that says
  // which half of the org a track belongs to. Placed beside `admin` because the
  // two are one family: an owner renaming "Track" here will want to rename
  // "Group" in the same sitting.
  groups: {
    section: 'entryFields',
    where: 'terminology.where.settingsGroups',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      // `settingsHint` is the line under the Settings card, not a title —
      // there IS no groups.settingsTitle, because the card and the header are
      // the same word and two keys holding "Groups" would be two rows an
      // admin cannot tell apart on the Terminology screen.
      { prefixes: ['settingsHint'], section: 'messages' },
      // `unsaved` and `archived` are what a row IS, not what it says — the same
      // reading `admin.tracks.archived` gets four blocks up.
      { prefixes: ['archived', 'ungrouped', 'unsaved'], section: 'healthStates' },
      {
        // `moveUp`/`moveDown` and not `move`: the `moved*` family below is three
        // sentences, and one four-letter prefix would file all five together.
        prefixes: ['discard', 'manage', 'moveDown', 'moveUp', 'rename', 'save'],
        section: 'actions',
      },
      // `empty` covers emptyHint and emptyGroup too, which is the point of the
      // longest-prefix rule: one entry, and a later `emptyXyz` needs no edit.
      { prefixes: ['empty'], section: 'emptyStates' },
      {
        // Every one of these is a sentence rather than a label. `saved` and
        // `moved` are listed even though `save` and `moveUp` sit in Actions —
        // longest prefix wins, which is exactly how a rule gets refined without
        // being moved.
        prefixes: [
          'err',
          'loadFailed',
          'moved',
          'nameArHint',
          'nameRequired',
          'reordered',
          'saved',
          'ungroupedHint',
        ],
        section: 'messages',
      },
    ],
  },
  vocabadmin: {
    section: 'entryFields',
    where: 'terminology.where.settingsVocab',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['edited', 'hidden', 'slaOff', 'usingDefault'], section: 'healthStates' },
      {
        prefixes: [
          'armConfirm',
          'closeRow',
          'discard',
          'editRow',
          'hide',
          'reset',
          'save',
          'show',
          'trackOverrides',
        ],
        section: 'actions',
      },
      {
        prefixes: [
          'armBody',
          'armInline',
          'armTitle',
          'discardBody',
          'discardTitle',
          'effect',
          'err',
          'frozenHint',
          'hiddenHint',
          'kindPriorityHint',
          'kindStatusHint',
          'kindTypeHint',
          'labelArHint',
          'labelHint',
          'measuredFrom',
          'movedTo',
          'notInstalled',
          'reordered',
          'resetAllBody',
          'resetAllTitle',
          'resetBody',
          'resetTitle',
          'resetToast',
          'savedToast',
          'saving',
          'slaHint',
          'slaOffAll',
          'slaResolution',
          'slaTrackHint',
          'staleHint',
          'unsaved',
          'colorHint',
        ],
        section: 'messages',
      },
    ],
  },
  // Settings › Roles and permissions (0025) — placed directly above `members`
  // because a role is what a member HOLDS, and the two screens are read in that
  // order. Its own where-note rather than `settingsMembers`: an owner looking
  // for "Director" must not be sent to the wrong screen.
  roles: {
    section: 'messages',
    where: 'terminology.where.settingsRoles',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['settingsHint'], section: 'messages' },
      // What a role IS, not what a control says.
      { prefixes: ['system', 'unsaved'], section: 'healthStates' },
      {
        prefixes: ['delete', 'discard', 'manage', 'rename', 'save'],
        section: 'actions',
      },
      // The create form is its own surface, and it spends the word "Key" that
      // the role card above already spends. Only the where-note separates them.
      {
        prefixes: ['create'],
        section: 'actions',
        where: 'terminology.where.settingsRolesCreate',
      },
      // Longest-prefix refinements of the two buttons above: the sentences that
      // FOLLOW the action belong with the other messages.
      {
        prefixes: ['deleteBody', 'deleteInUseReason', 'deleteSystemReason', 'deleteTitle', 'deleted'],
        section: 'messages',
      },
      {
        prefixes: ['createHint', 'created'],
        section: 'messages',
        where: 'terminology.where.settingsRolesCreate',
      },
      { prefixes: ['saved'], section: 'messages' },
      // `empty` covers emptyHint too — one entry, and a later emptyXyz needs no edit.
      { prefixes: ['empty'], section: 'emptyStates' },
      // The words ON the switches and the fields beside them.
      {
        prefixes: ['adminSummary', 'keyLabel', 'memberCount', 'nameAr', 'nameEn', 'perm', 'reach'],
        section: 'entryFields',
      },
      {
        prefixes: ['createKey', 'createTitle'],
        section: 'entryFields',
        where: 'terminology.where.settingsRolesCreate',
      },
      // …and the prose among them, refined back out by a longer prefix.
      {
        prefixes: ['nameArHint', 'permHint', 'reachDeclaredNote'],
        section: 'messages',
      },
      {
        prefixes: ['createKeyHint'],
        section: 'messages',
        where: 'terminology.where.settingsRolesCreate',
      },
    ],
  },
  members: {
    section: 'entryFields',
    where: 'terminology.where.settingsMembers',
    rules: [
      { prefixes: ['subtitle'], section: 'screenTitles' },
      { prefixes: ['inviteExpired', 'pending', 'neverSignedIn', 'owner', 'roleUnknown', 'you'], section: 'healthStates' },
      {
        prefixes: [
          'actionsFor',
          'add',
          'create',
          'demote',
          // A button label and a control's accessible name, which is exactly
          // what `roleFor` and `actionsFor` beside them already are.
          'editPosition',
          'inviteDone',
          'positionFor',
          'promote',
          'reissue',
          'roleFor',
        ],
        section: 'actions',
      },
      {
        prefixes: [
          'addHint',
          'creating',
          'deleteBody',
          'deleteTitle',
          'deleted',
          'demoteBody',
          'demoteTitle',
          'displayNameHint',
          'err',
          'inviteWarning',
          'loadFailed',
          'noProfile',
          // The sentence under the field, which is where `usernameHint` and
          // `displayNameHint` above already live, and a toast, like
          // `roleChanged` and `reissued`. `position` and `positionPlaceholder`
          // are deliberately NOT here: they fall to the namespace default
          // (`entryFields`) exactly as `username` and `displayName` do, and
          // `errPosition*` is already caught by the `'err'` prefix.
          'positionHint',
          'positionSaved',
          'promoteBody',
          'promoteTitle',
          'reissueBody',
          'reissueTitle',
          'reissued',
          'roleChanged',
          'roleMoved',
          'rolesUnavailable',
          'usernameHint',
        ],
        section: 'messages',
      },
    ],
  },
  // The privacy policy. Almost all of it is BODY PROSE, which is why the home
  // section is `messages` rather than a screen section: an admin renaming
  // "Blocked" is not looking for a paragraph about data retention, and these 68
  // keys would bury the words they came for. The handful that ARE chrome — the
  // headings, the way back, the stamp — are lifted out by the rules below.
  //
  // WORTH KNOWING BEFORE EDITING ANY OF IT: this is the one screen whose words
  // Apple reads. An override that makes the policy inaccurate is not a wording
  // preference, it is a false statement in a document a reviewer was given.
  privacy: {
    section: 'messages',
    where: 'terminology.where.privacy',
    rules: [
      { prefixes: ['title', 'standfirst', 'updated'], section: 'screenTitles' },
      { prefixes: ['backToSignIn'], section: 'navigation' },
      // The section headings, as distinct from the paragraphs beneath them.
      {
        prefixes: [
          'aiTitle',
          'askTitle',
          'changesTitle',
          'deleteTitle',
          'keepTitle',
          'notTitle',
          'pushTitle',
          'scopeTitle',
          'storedTitle',
          'whereTitle',
          'whoPrivateTitle',
          'whoTitle',
        ],
        section: 'screenTitles',
      },
    ],
  },
  push: {
    section: 'entryFields',
    where: 'terminology.where.settingsPush',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['manage'], section: 'navigation' },
      { prefixes: ['status'], section: 'healthStates' },
      {
        prefixes: ['disable', 'enable', 'remove'],
        section: 'actions',
      },
      { prefixes: ['devicesEmpty'], section: 'emptyStates' },
      {
        prefixes: [
          'blocked',
          'devicesHint',
          'disabled',
          'disabling',
          'enabled',
          'enabling',
          'err',
          'explain',
          'inboxNote',
          'ios',
          'kindAssignedHint',
          'kindCompletedHint',
          'kindsHint',
          'masterHint',
          'removeBody',
          'removeTitle',
          'removed',
          'unsupported',
        ],
        section: 'messages',
      },
    ],
  },
  // TWO SCREENS, ONE NAMESPACE, and the `where` rules are what keep that
  // honest: the switch and the privacy statement live in Settings, while the
  // chips, the badge and the keyboard hint are read under the capture box. An
  // admin renaming "Not right" needs to be told where that word appears, and
  // "Settings, then AI assist" would send them to the wrong screen.
  ai: {
    // Messages by default: most of this namespace is a sentence explaining what
    // leaves the browser, which is the long tail the section list was designed
    // for.
    section: 'messages',
    where: 'terminology.where.settingsAi',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      // The three card headings. Named individually rather than by a `Title`
      // suffix rule, because prefixes match the START of a local path.
      { prefixes: ['sentTitle', 'switchTitle', 'usageTitle'], section: 'screenTitles' },
      { prefixes: ['manage'], section: 'navigation' },
      // What the switch IS, in a word — the same reading `push.status*` gets.
      { prefixes: ['status'], section: 'healthStates' },
      // The Preview badge is a status ON THE FEATURE, and it is read on the
      // capture screen…
      { prefixes: ['preview'], section: 'healthStates', where: 'terminology.where.capture' },
      // …while `previewNote` is the sentence under the settings heading. Longest
      // prefix wins, so this takes it back without disturbing the rule above.
      { prefixes: ['previewNote'], section: 'messages' },
      {
        prefixes: ['accept', 'dismiss', 'wrong'],
        section: 'actions',
        where: 'terminology.where.capture',
      },
      // The chips name FIELDS — a due date, an owner, a tag — so they belong
      // beside the other field words rather than in the message tail.
      { prefixes: ['chip'], section: 'entryFields', where: 'terminology.where.capture' },
      { prefixes: ['toggleLabel'], section: 'entryFields' },
      {
        prefixes: ['announce', 'keysHint', 'reportedToast', 'rowLabel', 'thinking', 'understood'],
        section: 'messages',
        where: 'terminology.where.capture',
      },
    ],
  },
  export: {
    section: 'entryFields',
    where: 'terminology.where.settingsExport',
    rules: [
      { prefixes: ['subtitle', 'title'], section: 'screenTitles' },
      { prefixes: ['csvAction', 'jsonAction'], section: 'actions' },
      { prefixes: ['noEntries'], section: 'emptyStates' },
      {
        prefixes: [
          'csvCaveats',
          'csvHint',
          'done',
          'downloaded',
          'failed',
          'fresh',
          'jsonHint',
          'preparing',
          'reading',
          'rowsSoFar',
          'scope',
          'truncated',
        ],
        section: 'messages',
      },
    ],
  },

  // ── this screen ─────────────────────────────────────────────────────────
  //
  // Its own strings are overridable like every other, and are NOT special-cased
  // anywhere. Renaming "Reset to default" here renames the button that resets
  // it — which is exactly why the global escape hatch exists.
  terminology: {
    section: 'entryFields',
    where: 'terminology.where.terminology',
    rules: [
      { prefixes: ['ioTitle', 'subtitle', 'title'], section: 'screenTitles' },
      // The card on the Settings page, not the heading of this screen — both
      // say "Terminology", and one of them is two clicks away from the other.
      { prefixes: ['settingsTitle'], section: 'screenTitles', where: 'terminology.where.settings' },
      {
        prefixes: ['settingsManage'],
        section: 'navigation',
        where: 'terminology.where.settings',
      },
      { prefixes: ['changed', 'unsaved', 'usingDefault'], section: 'healthStates' },
      {
        prefixes: [
          'collapseSection',
          'expandSection',
          'exportAction',
          'importAction',
          'importApply',
          'reset',
          'save',
          'showAll',
          'showChanged',
        ],
        section: 'actions',
      },
      { prefixes: ['exportEmpty', 'noChanges', 'noResults'], section: 'emptyStates' },
      {
        prefixes: [
          'a11y',
          'adminOnly',
          'bidiNote',
          'blankMeansDefault',
          'changedCount',
          'err',
          'exportDone',
          'importApplying',
          'importConfirm',
          'importDone',
          'importNoChange',
          'importPreview',
          'importRejected',
          'importSkipped',
          'ioHint',
          'loading',
          'notInstalled',
          'pluralExactHint',
          'pluralHint',
          'pluralRangeHint',
          'resetAllConfirm',
          'resetAllDone',
          'resetDone',
          'resetting',
          'savedToast',
          'saving',
          'searchHint',
          'sectionHint',
          'settingsHint',
        ],
        section: 'messages',
      },
    ],
  },

  // ── sign-in, and the rest of the surface ────────────────────────────────
  signin: {
    section: 'entryFields',
    where: 'terminology.where.signin',
    rules: [
      { prefixes: ['claimHeading', 'claimSubtitle', 'codeHeading', 'heading', 'linkHeading', 'subtitle'], section: 'screenTitles' },
      { prefixes: ['backToSignIn', 'enterCodeInstead', 'firstTime', 'useEmail', 'useUsername'], section: 'navigation' },
      // `usernamePlaceholder` and `identifierPlaceholder` are both the example
      // `ahmed.otaibi`, and only one of them is rendered: sign-in asks for a
      // username OR an email in a single box now. The pair is kept because
      // localeParity.test.ts pins all 213 pre-split signin keys (SignIn.tsx's
      // DORMANT KEYS note), so the where-note is where the truth goes — an owner
      // who renames a string nothing renders must be told so here rather than
      // discover it by saving and seeing no change.
      { prefixes: ['username'], section: 'entryFields', where: 'terminology.where.signinDormant' },
      {
        prefixes: [
          'changeEmail',
          'claim',
          'hidePassword',
          'resend',
          'send',
          'showPassword',
          'verify',
        ],
        section: 'actions',
      },
      {
        prefixes: [
          'capsLock',
          'claimed',
          'claiming',
          'codeDisclosureHint',
          'codeResent',
          'codeSent',
          'err',
          'identifierHint',
          'linkHint',
          'linkResent',
          'linkSent',
          'notConfigured',
          'resendIn',
          'sending',
          'signedOut',
          'signingIn',
          'verifying',
        ],
        section: 'messages',
      },
    ],
  },
  claim: {
    section: 'entryFields',
    where: 'terminology.where.claim',
    rules: [
      { prefixes: ['subtitle', 'success', 'title'], section: 'screenTitles' },
      { prefixes: ['goToSignIn', 'haveAccount'], section: 'navigation' },
      { prefixes: ['hidePassword', 'showPassword', 'submit'], section: 'actions' },
      { prefixes: ['strength'], section: 'healthStates' },
      { prefixes: ['strengthLabel'], section: 'entryFields' },
      {
        prefixes: [
          'capsLock',
          'err',
          'inviteHint',
          'matchOk',
          'noCode',
          'notConfigured',
          'passwordHint',
          'submitting',
          'successHint',
          'usernameHint',
        ],
        section: 'messages',
      },
    ],
  },
  cmd: {
    section: 'entryFields',
    where: 'terminology.where.palette',
    rules: [
      { prefixes: ['keysTitle', 'title'], section: 'screenTitles' },
      { prefixes: ['group'], section: 'navigation' },
      { prefixes: ['action', 'key'], section: 'actions' },
      { prefixes: ['keysEntry', 'keysGlobal', 'keysHint'], section: 'messages' },
      { prefixes: ['empty'], section: 'emptyStates' },
      { prefixes: ['hint', 'refreshed', 'results'], section: 'messages' },
    ],
  },
  offline: {
    section: 'entryFields',
    where: 'terminology.where.offline',
    rules: [
      { prefixes: ['discard', 'openOutbox', 'retry'], section: 'actions' },
      { prefixes: ['discardBody', 'discardDependents', 'discardTitle', 'discarded'], section: 'messages' },
      { prefixes: ['emptyHint'], section: 'emptyStates' },
      { prefixes: ['item'], section: 'healthStates' },
      {
        prefixes: [
          'attempts',
          'backOnline',
          'banner',
          'outboxHint',
          'pending',
          'queued',
          'syncFailed',
          'synced',
          'syncing',
        ],
        section: 'messages',
      },
    ],
  },
  common: {
    section: 'actions',
    where: 'terminology.where.common',
    rules: [
      { prefixes: ['all', 'mine', 'none', 'of', 'optional', 'required', 'today'], section: 'entryFields' },
      { prefixes: ['offline'], section: 'healthStates' },
      { prefixes: ['empty'], section: 'emptyStates' },
      {
        prefixes: ['copied', 'error', 'loading', 'notConfigured', 'notSignedIn', 'saved'],
        section: 'messages',
      },
    ],
  },
  pwa: { section: 'messages', where: 'terminology.where.update' },
}

/* ──────────────────────────── the resolution ────────────────────────────── */

/** Namespace → its declaration order, for sorting inside a section. */
const NAMESPACE_RANK: ReadonlyMap<string, number> = new Map(
  Object.keys(NAMESPACE_PLACEMENT).map((ns, i) => [ns, i]),
)

const SECTION_RANK: ReadonlyMap<LabelSectionId, number> = new Map(
  LABEL_SECTIONS.map((s, i) => [s.id, i]),
)

export interface LabelPlacement {
  readonly section: LabelSectionId
  /** `t()` key for the "where you see it" note. */
  readonly whereKey: string
  /**
   * Sort position inside the section. Namespace order first, then the rule that
   * claimed the key — so a screen's fields stay together and in the order the
   * map declares them, rather than alphabetically by dot path.
   */
  readonly rank: number
}

/**
 * Where does this key belong on the Terminology screen?
 *
 * `undefined` means the key's namespace is not in the curated map — an orphan,
 * which labelSections.test.ts fails on. Callers should treat it as a bug rather
 * than hiding the key: a string nobody can find is a string nobody can fix.
 */
export function placementFor(key: string): LabelPlacement | undefined {
  const cut = key.indexOf('.')
  if (cut < 1) return undefined
  const ns = key.slice(0, cut)
  const local = key.slice(cut + 1)
  const home = NAMESPACE_PLACEMENT[ns]
  if (home === undefined) return undefined

  const nsRank = (NAMESPACE_RANK.get(ns) ?? 0) * 1000
  let best: { rule: LabelRule; length: number; index: number } | undefined
  home.rules?.forEach((rule, index) => {
    for (const prefix of rule.prefixes) {
      // Longest prefix wins, so `tracks.archivedToast` can refine
      // `tracks.archive` without either rule having to move.
      if (local.startsWith(prefix) && (best === undefined || prefix.length > best.length)) {
        best = { rule, length: prefix.length, index }
      }
    }
  })

  if (best === undefined) {
    // The namespace default sorts AFTER every rule in it: the curated groups
    // are the ones the owner is looking for, and the leftovers follow.
    return { section: home.section, whereKey: home.where, rank: nsRank + 999 }
  }
  return {
    section: best.rule.section,
    whereKey: best.rule.where ?? home.where,
    rank: nsRank + best.index,
  }
}

/* ────────────────────────────── the catalogue ───────────────────────────── */

export interface LabelDescriptor {
  readonly key: string
  readonly section: LabelSectionId
  readonly whereKey: string
  /**
   * The SHIPPED English, exactly as the bundle holds it — a string, or a plural
   * node whose forms are edited one at a time. This is what "Reset to default"
   * puts back, and what an override is validated against.
   */
  readonly en: string | PluralNode
  /** The shipped Arabic. Its plural node may hold up to six forms; English two. */
  readonly ar: string | PluralNode
}

/** dot path → leaf, where a plural node is a LEAF and not a namespace. */
function walk(tree: LocaleTree, prefix: string, out: Map<string, string | PluralNode>): void {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else if (isPluralNode(v)) out.set(key, v)
    else walk(v, key, out)
  }
}

let catalogue: readonly LabelDescriptor[] | undefined

/**
 * Every renameable key in the app, in the order the screen renders them.
 *
 * Walked from the SHIPPED bundles, not from a hand-kept list: a key added by a
 * feature appears here the moment its locale file does, which is the only way a
 * self-service rename screen stays true as the app grows.
 *
 * Sorted by section, then by the curated rank, then by key — a total order, so
 * the list does not reshuffle between renders or between the two languages.
 * Computed once: 1,500 keys walked on every keystroke of a search box would be
 * the one performance mistake this screen can make.
 *
 * Keys whose namespace is uncurated are LEFT OUT rather than dumped at the
 * bottom, because a section-less row has nowhere to render; the test is what
 * makes sure there are none.
 */
export function listLabels(): readonly LabelDescriptor[] {
  if (catalogue !== undefined) return catalogue
  const enLeaves = new Map<string, string | PluralNode>()
  const arLeaves = new Map<string, string | PluralNode>()
  walk(en, '', enLeaves)
  walk(ar, '', arLeaves)

  // Placement is resolved ONCE per key and carried into the sort. Resolving
  // inside the comparator instead would run the prefix scan ~35,000 times for
  // 1,600 keys, which is the kind of quadratic-ish cost that only shows up on
  // the device the owner actually uses.
  const ranked: { row: LabelDescriptor; rank: number }[] = []
  for (const [key, enValue] of enLeaves) {
    const placement = placementFor(key)
    if (placement === undefined) continue
    ranked.push({
      rank: placement.rank,
      row: {
        key,
        section: placement.section,
        whereKey: placement.whereKey,
        en: enValue,
        // Arabic can legitimately be a plain string where English is a plural
        // node and the reverse — lib/plural.ts's header explains why the two
        // bundles are allowed to disagree about a key's SHAPE. Falling back to
        // the English is what t() itself does when a key is missing from `ar`.
        ar: arLeaves.get(key) ?? enValue,
      },
    })
  }

  ranked.sort((a, b) => {
    const bySection =
      (SECTION_RANK.get(a.row.section) ?? 0) - (SECTION_RANK.get(b.row.section) ?? 0)
    if (bySection !== 0) return bySection
    if (a.rank !== b.rank) return a.rank - b.rank
    // The tiebreak makes the order TOTAL: two keys in the same section under the
    // same rule must not swap places between renders, or the row the owner was
    // typing into moves.
    return a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0
  })
  catalogue = ranked.map((r) => r.row)
  return catalogue
}

/* ─────────────────────────────── the search ─────────────────────────────── */

/**
 * Both sides of a search comparison go through this, and nothing else.
 *
 * Lowercased, and stripped of every invisible format character rather than of
 * the four isolates alone: the owner is typing WHAT HE CAN SEE, and the shipped
 * `Created by ⁨{name}⁩` carries two controls that would otherwise make the phrase
 * unmatchable. The same is true of a value pasted in from Word, which arrives
 * carrying a right-to-left mark nobody knows is there.
 */
export function searchable(value: string): string {
  return stripInvisible(value).toLowerCase()
}

/**
 * Does one catalogue row match what is in the search box?
 *
 * @param needle  the query, through searchable(), already trimmed. Empty matches
 *                everything — "no filter" is not "no results".
 * @param shipped the row's key and both BUILT-IN languages, through searchable().
 * @param section the row's section name as it is displayed, through searchable().
 * @param owner   the wording the OWNER has stored for this row, one entry per
 *                language per slot, through searchable().
 *
 * `owner` IS THE WHOLE REASON THIS FUNCTION EXISTS, and its absence was the
 * screen's worst bug. Search is the primary way in — 1,670 keys is not a list
 * anybody scrolls — and it used to match the shipped wording only. So the screen
 * worked perfectly the first time and stopped finding things the second time:
 * rename "Follow-ups" to "My Desk", come back next week, type "My Desk", and the
 * answer was "Nothing matches My Desk". The owner had to remember what the app
 * used to be called in order to find what he had renamed — on the one screen
 * whose entire purpose is that he no longer has to ask anybody anything.
 */
export function labelMatches(
  needle: string,
  shipped: string,
  section: string,
  owner: readonly string[],
): boolean {
  if (needle === '') return true
  if (section.includes(needle) || shipped.includes(needle)) return true
  return owner.some((value) => value.includes(needle))
}
