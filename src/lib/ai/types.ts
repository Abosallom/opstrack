// The AI capture assistant's shared vocabulary: what a model may propose, what
// survives, and the RUNTIME MIRROR of the frozen unions it is checked against.
//
// PURE. This file imports two type-only modules and nothing else — no network,
// no React, no store, no i18n. That is the whole point of the src/lib/ai/*
// triplet: the module that decides whether an AI suggestion is safe must be
// provable with zero network, so the safety of the feature is a `vitest` run
// and not a hope about an API being up.
//
// THE RULE THE WHOLE FEATURE HANGS ON (src/pages/Capture.tsx:158-163 and
// src/lib/capture/parse.ts:950). Every chip control edits the INPUT STRING,
// never a parallel model, and parse() is pure, total and never throws. So the
// AI NEVER WRITES AN ENTRY. It proposes; validate() drops everything that does
// not survive contact with the real workspace; toLine() turns what is left into
// a canonical capture token line; and parse() re-reads that line and owns every
// field downstream, exactly as it does for a line typed by hand. If the model is
// slow, down, or wrong, capture behaves precisely as it does today.

import type { EntryPriority, EntryType } from '../../types'
import type { ParseMember, ParseTrack } from '../capture/parse'
import type { IsoDate } from '../dates'
import type { Locale } from '../i18n'

// ── context ────────────────────────────────────────────────────────────────

/**
 * The REAL workspace lists a suggestion is checked against.
 *
 * DELIBERATELY A SUBSET OF `ParseContext` (parse.ts:85), reusing its element
 * types rather than declaring lookalikes, so the capture screen can pass the
 * very object it already builds for parse(). That is not a convenience: the
 * validator's guarantee is "the parser will read this line back as the fields I
 * approved", and it is only true if the validator and the parser are looking at
 * the SAME tracks and the SAME members. Two structurally-identical arrays built
 * from two different store reads is precisely how that guarantee rots.
 *
 * `now` is injected for the same reason parse.ts injects it — "not in the past"
 * has to be testable without waiting a day.
 */
export interface AiContext {
  tracks: readonly ParseTrack[]
  members: readonly ParseMember[]
  /** Injected, never `new Date()`. `today` for the past-date rule is `toIsoDate(now)`. */
  now: Date
  /**
   * Which name a `#track` token is written with — OPTIONAL, defaulting to 'en',
   * so a `ParseContext` (where it is required) is assignable here unchanged.
   *
   * Not a matching concern: the parser folds both names and resolves either way.
   * It is a POLISH concern, and the app already made this decision — the track
   * chip writes `trackLabel(track, locale)` back into the line
   * (Capture.tsx:715, labels.ts:28), so an Arabic capture box that suddenly grew
   * `#Network` because a suggestion was accepted would be the assistant writing
   * in a language the user is not typing in.
   */
  locale?: Locale
  /**
   * Admin-renamed vocabulary labels — the same snapshot Capture.tsx hands
   * parse() as `ParseContext.vocabAliases`. Needed here because an override can
   * make a frozen key resolve to a DIFFERENT key: see vocabToken() in toLine.ts.
   */
  vocabAliases?: Partial<Record<'status' | 'priority' | 'type', Record<string, string[]>>>
}

// ── what the model is asked for ────────────────────────────────────────────

/**
 * The wire shape the edge function asks the model to emit — DOCUMENTATION, not
 * a contract. validate() takes `unknown` and never this type, because a shape
 * the compiler believes is exactly the assumption a hallucinated payload
 * violates. Anything absent from this list is dropped without being read; see
 * REFUSED_FIELDS for the three that are refused loudly instead of silently.
 */
export interface AiProposal {
  title?: string
  trackId?: string | null
  ownerId?: string | null
  priority?: EntryPriority | null
  type?: EntryType | null
  /** `YYYY-MM-DD`. Anything else is dropped. */
  dueDate?: string | null
  followUpDate?: string | null
  tags?: string[]
}

// ── what survives ──────────────────────────────────────────────────────────

/** Every field validate() can report on, including the payload as a whole. */
export type SuggestionField =
  | 'payload'
  | 'title'
  | 'trackId'
  | 'ownerId'
  | 'priority'
  | 'type'
  | 'dueDate'
  | 'followUpDate'
  | 'tags'
  // The three below are only ever REFUSED — see REFUSED_FIELDS.
  | 'ownerName'
  | 'status'
  | 'cadence'

/**
 * Why a field did not survive.
 *
 * `ambiguous` is the subtle one: the id IS in the workspace, but no token spells
 * it in a way parse() reads back as that id — two tracks folding to the same
 * name, a display name containing a quote character. A field the line cannot
 * express is a field this module did not approve.
 */
export type DropReason =
  | 'malformed'
  | 'unknown'
  | 'past'
  | 'ambiguous'
  | 'tooLong'
  | 'unsupported'

/**
 * One dropped field, carrying NO VALUE — only which field and why.
 *
 * The omission is the security property. A drop record is the one part of a
 * model response that flows onward into logs, the Preview "this was wrong"
 * report and possibly a UI counter, and echoing the offending value there would
 * reopen on the reporting path exactly the injection hole validate() closes on
 * the capture path. `field` and `reason` are closed unions; neither can carry a
 * sentence the model wrote.
 */
export interface DroppedField {
  field: SuggestionField
  reason: DropReason
}

/**
 * What survived. FIELD NAMES MIRROR `ParsedEntry` (parse.ts:136) on purpose, so
 * the suggestion row can diff a suggestion against what the line already parses
 * to, field by field, with no mapping table in between.
 *
 * Every field is `null` when nothing survived rather than absent, because
 * "absent" and "the model said null" are the same fact here and two spellings of
 * one fact is how a caller ends up handling only one of them.
 */
export interface ValidatedSuggestion {
  title: string | null
  trackId: string | null
  ownerId: string | null
  priority: EntryPriority | null
  type: EntryType | null
  dueDate: IsoDate | null
  followUpDate: IsoDate | null
  tags: readonly string[]
  /** In payload order. Empty when everything the model sent survived. */
  dropped: readonly DroppedField[]
}

/** Nothing survived — there is no suggestion to show. */
export function isEmptySuggestion(v: ValidatedSuggestion): boolean {
  return (
    v.title === null &&
    v.trackId === null &&
    v.ownerId === null &&
    v.priority === null &&
    v.type === null &&
    v.dueDate === null &&
    v.followUpDate === null &&
    v.tags.length === 0
  )
}

// ── the frozen unions, as runtime lists ────────────────────────────────────
//
// src/types.ts:22-39 states it: these unions are FROZEN, and a value added or
// removed is a schema change, a migration and a locale change at once. A model
// that returns `"urgent"` is not proposing a fifth priority, it is hallucinating
// one, and the entries table's CHECK constraint would reject the insert far too
// late — after the user pressed Enter and was told it worked.
//
// THE RECORD ANNOTATION IS THE PROOF. TypeScript rejects the literal if a key of
// the union is missing AND if a key outside it is invented, so this list cannot
// fall behind src/types.ts in either direction. A hand-written string array
// could, silently, and would then admit a value the database refuses.

const PRIORITY_KEY_SET: Readonly<Record<EntryPriority, true>> = {
  low: true,
  medium: true,
  high: true,
  critical: true,
}

const TYPE_KEY_SET: Readonly<Record<EntryType, true>> = {
  action: true,
  decision: true,
  issue: true,
  request: true,
  change: true,
  escalation: true,
  note: true,
}

/**
 * The allowed values, for the prompt to enumerate.
 *
 * EXPORTED SO src/lib/ai/prompt.ts DOES NOT RETYPE THEM. A prompt listing a
 * value the validator drops burns tokens producing suggestions that can only be
 * thrown away; a prompt missing one the validator allows makes a working feature
 * look broken. The cast is the single thing the compiler cannot see for itself —
 * `Object.keys` is typed as `string[]` regardless of the Record's key type.
 */
export const PRIORITY_KEYS = Object.keys(PRIORITY_KEY_SET) as readonly EntryPriority[]
export const TYPE_KEYS = Object.keys(TYPE_KEY_SET) as readonly EntryType[]

/**
 * `Object.hasOwn`, NOT the `in` operator.
 *
 * `'constructor' in PRIORITY_KEY_SET` is `true` — every object inherits it — so
 * a payload of `{"priority": "constructor"}` would pass an `in` check and be
 * written into the line as `!constructor`. That is not a hypothetical shape for
 * a validator standing between a language model and a database.
 */
export function isPriorityKey(value: unknown): value is EntryPriority {
  return typeof value === 'string' && Object.hasOwn(PRIORITY_KEY_SET, value)
}

export function isTypeKey(value: unknown): value is EntryType {
  return typeof value === 'string' && Object.hasOwn(TYPE_KEY_SET, value)
}

// ── limits ─────────────────────────────────────────────────────────────────

/**
 * Matches the `maxLength={200}` every hand-typed title field in the app already
 * carries (EntrySheet.tsx:462, Board.tsx:1504, RecurringAdmin.tsx:406). A
 * machine-authored title has no claim to more room than a human-typed one, and
 * an unbounded title is a way to push a whole document through a capture box.
 */
export const AI_TITLE_MAX = 200

/** Mirrors `NAME_MAX` in TrackEditor.tsx:41 — a tag and a track name are the
 *  same kind of label, and `tracks.suggested_tags` is where tags come from. */
export const AI_TAG_MAX = 40

/** Enough for every track's `suggested_tags` and then some. A model that
 *  returns forty tags is not labelling an item, it is listing its vocabulary. */
export const AI_TAGS_MAX = 8

/**
 * Fields the model is REFUSED rather than ignored, because each one would move
 * the capture somewhere the user cannot see.
 *
 * `cadence` is the sharpest: a line carrying `every:` makes parse() return a
 * `recurrence`, and `toNewEntry()` (parse.ts:1250) then returns NULL — the
 * capture writes a recurring TEMPLATE into a different table instead of the
 * entry the user thought they were filing. `status` is a second thought, not a
 * first one, and capture always creates at `new` by design (parse.ts:98).
 * `ownerName` would let the model invent a person: an owner is either a
 * provisioned teammate or free text a HUMAN typed, and a model that cannot find
 * `ownerId` in the member list must propose nothing at all.
 *
 * Refused loudly — they land in `dropped` — because a model that keeps reaching
 * for these is a prompt to fix, and silence is how that never gets noticed.
 */
export const REFUSED_FIELDS: readonly SuggestionField[] = ['ownerName', 'status', 'cadence']
