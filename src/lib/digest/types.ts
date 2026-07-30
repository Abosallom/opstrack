// The digest's data shapes — and the seam that makes "one model, three
// renderers" hold.
//
// THE FROZEN RULE THIS FILE EXISTS TO ENFORCE (plan §2.16): no renderer calls
// t(), Intl, or any store. Every user-visible string in a rendered digest —
// headings, owner labels, status words, date labels, the fixed words in
// DigestStrings — is already resolved by the time a renderer sees the model.
// That is what makes an ARABIC digest generated from an ENGLISH UI work (Wave-3
// gate d), what makes all three renderers testable against a hand-written model
// literal with zero mocking, and what makes it impossible for markdown and HTML
// to drift apart on wording.
//
// So: a DigestModel carries no ids that need looking up, no keys that need
// translating, and no dates that need formatting. If a renderer would have to
// ASK something to produce a character, that character belongs here instead.
//
// WHY DigestMember IS DECLARED HERE AND Member IS NOT IMPORTED. `Member` lives
// in src/api/members.ts, and contracts rule 2 forbids `src/lib/**` importing
// from `src/api/**` — the standing grep polices exactly that. The digest needs
// two fields of it, so it states them structurally: a real `Member[]` satisfies
// `readonly DigestMember[]` with no cast and no adapter, and the layering stays
// mechanically checkable. Entry/EntryHealth/EntryUpdate/Track come from
// src/types.ts, which lib/ may read.

import type { Entry, EntryHealth, EntryUpdate, Track, VocabKind } from '../../types'
import type { IsoDate } from '../dates'
import type { Locale } from '../i18n'

/* ───────────────────────────── sections ───────────────────────────── */

/**
 * The five buckets a digest reports, as the owner named them: Closed / In
 * progress / Blocked / Overdue / SLA breached.
 *
 * These are DIGEST buckets, deliberately not `FollowUpSections`' six. Follow-ups
 * answers "what needs me today" and therefore has `dueSoon`, `stale` and
 * `unassigned`; a status report answers "what happened and what is stuck" and
 * therefore has `closed`, which follow-ups can never have. The two agree on the
 * only definition they share — `isOpen()` and the health row — and diverge on
 * the question, which is the honest way round.
 */
export type DigestSectionKind = 'closed' | 'inProgress' | 'blocked' | 'overdue' | 'slaBreached'

/**
 * CLASSIFICATION order — which bucket wins when an entry qualifies for several.
 *
 * An entry appears in AT MOST ONE section, exactly as `bucketFollowUps` does it
 * and for the same reason: a row counted twice makes the section counts stop
 * adding up to the track total, and adding the numbers is the first thing anyone
 * does with a status report. A blocked item that is also overdue is reported as
 * overdue, because "late" is the fact the reader has to act on.
 *
 * This order is FIXED and is not the display order — see `SECTION_ORDER`.
 */
export const CLASSIFY_ORDER: readonly DigestSectionKind[] = [
  'closed',
  'overdue',
  'slaBreached',
  'blocked',
  'inProgress',
]

/**
 * DEFAULT DISPLAY order, which `DigestOptions.sections` overrides verbatim.
 *
 * Closed first is deliberate: a weekly status report opens with what got
 * finished, then descends into what did not.
 */
export const SECTION_ORDER: readonly DigestSectionKind[] = [
  'closed',
  'inProgress',
  'blocked',
  'overdue',
  'slaBreached',
]

export type DigestFormat = 'markdown' | 'plain' | 'html'

export const DIGEST_FORMATS: readonly DigestFormat[] = ['markdown', 'plain', 'html']

/* ─────────────────────────── collection I/O ───────────────────────── */

/** What `collectDigest()` is asked for. `sections` rides along so a future */
/*  server-side collector can narrow the read; today it is advisory. */
export interface DigestQuery {
  from: IsoDate
  to: IsoDate
  /** `[]` = every track. Ids, never names. */
  trackIds: string[]
  sections: DigestSectionKind[]
  /** Fetch the last thread post per entry, for the optional note line. */
  includeUpdates: boolean
  /**
   * Re-read even when the stores are warm — the screen's "Refresh data" button.
   *
   * ADDED to §2.16's shape. Without it a refresh is a no-op the moment the
   * working set is inside its staleness window, which is a button that appears
   * to work and does nothing — the failure mode this codebase files as a defect
   * rather than a nuance.
   */
  force?: boolean
}

/** The two fields the digest needs from a member. A `Member` satisfies it. */
export interface DigestMember {
  id: string
  displayName: string
}

/**
 * Everything `buildDigestModel()` needs, and nothing that needs fetching.
 *
 * `lastUpdate` is ONE update per entry — the newest inside the window — not the
 * whole thread. The digest quotes at most one line per row, so carrying the rest
 * would be a hundred kilobytes of JSON to render a hundred sentences.
 */
export interface DigestRows {
  entries: Entry[]
  health: EntryHealth[]
  lastUpdate: Map<string, EntryUpdate>
  tracks: Track[]
  members: readonly DigestMember[]
  /**
   * At least one of the underlying reads came back at PostgREST's 1000-row
   * ceiling, so this digest reports on a WINDOW rather than on everything.
   *
   * Added to the §2.16 shape (adding to a contract is allowed; renaming is not)
   * because truncation arrives as a 200 with fewer rows — no error, no signal —
   * and a status report that silently omits rows is worse than one that fails.
   * The screen turns this into a visible warning; the model turns it into a line
   * in the document itself, so a digest pasted into WhatsApp carries its own
   * caveat.
   */
  truncated: boolean
}

/* ──────────────────────────── build options ───────────────────────── */

export interface DigestOptions {
  /** EXPLICIT. Never `getLocale()` — that is the whole point of the module. */
  locale: Locale
  /**
   * The reported window, inclusive at both ends.
   *
   * ADDED to §2.16's shape (adding to a contract is allowed; renaming is not).
   * The plan puts `from`/`to` on `DigestQuery` and gives `buildDigestModel`
   * only rows and options — but the builder RE-APPLIES the frozen membership
   * rule on the client, both because the collector fetches a superset and
   * because the screen re-renders a different range from the same rows without
   * a round trip. It cannot do that without knowing the window.
   */
  from: IsoDate
  to: IsoDate
  /** Which sections to EMIT, in this order, verbatim. */
  sections: DigestSectionKind[]
  /** `[]` = every track that has rows. */
  trackIds: string[]
  /**
   * Tags to break out per track.
   *
   * UNDEFINED means "use each track's own `suggested_tags`" — the Onboarding
   * track ships `{direct-integration,portal}` (0004) and any track an admin
   * gives suggested tags gets the same treatment with no code change. An
   * explicit array OVERRIDES that for every track, and an explicit EMPTY array
   * is how the screen switches the breakdown off. One mechanism, not two.
   */
  tagBreakdown?: string[]
  /** Quote the newest update under each row. */
  includeNotes: boolean
  /** Emit a heading for a track with no rows in the window. */
  includeEmptyTracks: boolean
  /** Injected, never `new Date()` inside the builder — every test pins it. */
  now: Date
  /**
   * A vocabulary key → its label IN `locale`.
   *
   * INJECTED, NOT IMPORTED, and this is the same move `SectionContext.staleDays`
   * makes for the same reason. The frozen five-step resolution order lives in
   * `store/vocab.ts` (`vocabLabel(snapshot, kind, key, locale)`), `src/lib/**`
   * may not import `src/store/**`, and a second copy of a rule the codebase
   * labels FROZEN — the one whose subtle step is "a blank Arabic label falls
   * through to the i18n default, never to the English override" — is exactly how
   * the two drift. `api/digestCollect.digestVocabLabel()` builds the closure;
   * tests pass a two-line stub.
   */
  vocabLabel: (kind: VocabKind, key: string) => string
}

/* ──────────────────────────── the model ───────────────────────────── */

/** One reported entry, fully resolved. No ids, no keys, no dates left to format. */
export interface DigestItem {
  /** Kept so a UI preview can link back; renderers must not print it. */
  id: string
  title: string
  /** Already falls back through owner_id → owner_name → "Unassigned". */
  owner: string
  /** The trailing clause: "closed Tue", "due 14/08/2026", "12 days overdue". */
  detail: string
  /** The newest update's body, truncated. Null unless `includeNotes`. */
  note: string | null
  /** Print the ⚠ marker: this row is late, stuck, or past its service window. */
  flag: boolean
}

export interface DigestSection {
  kind: DigestSectionKind
  /** Localised heading — "Closed", "أُغلقت". */
  heading: string
  count: number
  items: DigestItem[]
}

/**
 * One row of a track's tag breakdown.
 *
 * `kind: 'other'` is the synthetic catch-all for in-window rows carrying none of
 * the listed tags. It exists so the breakdown's numbers add up to the track's
 * total, which is the only reason anyone reads a breakdown twice.
 */
export interface DigestTagRow {
  kind: 'tag' | 'other'
  /** The raw tag, or '' on the `other` row. */
  tag: string
  /** What to print — the tag itself, or the localised "Other". */
  label: string
  open: number
  closed: number
  total: number
}

export interface DigestTrack {
  /** Null on the synthetic "No track" group. */
  id: string | null
  name: string
  /** Only the sections that were selected AND have rows. */
  sections: DigestSection[]
  /** Empty when this track proposes no tags and none were forced. */
  tagBreakdown: DigestTagRow[]
  /** Rows across the SELECTED sections — what this track contributes. */
  count: number
}

export interface DigestTotals {
  /** Every kind, counted over the included tracks, whether emitted or not. */
  bySection: Record<DigestSectionKind, number>
  /** Rows across the SELECTED sections only. */
  entries: number
  /** Tracks with at least one selected row. */
  tracks: number
}

/**
 * The fixed words a renderer needs for STRUCTURE it invents itself — a table
 * header, a footer, an "all clear" line. Everything about the DATA is already a
 * finished sentence on the model above.
 */
export interface DigestStrings {
  tagHeading: string
  tagColumn: string
  openColumn: string
  closedColumn: string
  totalColumn: string
  /** Printed instead of sections when an included track has no rows. */
  trackAllClear: string
  /** Printed instead of tracks when the whole window is empty. */
  empty: string
  /** Leader on a quoted update line. */
  notePrefix: string
  /** The truncation caveat; empty string when nothing was truncated. */
  truncatedNote: string
  /** Document footer — the tool's name, so a pasted digest says where it is from. */
  footer: string
}

export interface DigestModel {
  locale: Locale
  dir: 'ltr' | 'rtl'
  from: IsoDate
  to: IsoDate
  /** "Status digest" / "ملخّص الحالة". */
  title: string
  /** "Covering 22/07/2026 – 29/07/2026". */
  rangeLabel: string
  /** "Generated 29/07/2026, 14:05". */
  generatedLabel: string
  /** "3 closed · 5 in progress · 1 blocked", or the empty-window sentence. */
  summaryLine: string
  /** The sections that were emitted, in the order they were emitted. */
  sections: DigestSectionKind[]
  tracks: DigestTrack[]
  totals: DigestTotals
  strings: DigestStrings
  /** No track produced a single row under the current selection. */
  empty: boolean
}
