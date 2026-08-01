// The model's JSON in, only what survives out.
//
// THE POSTURE, STATED ONCE. Everything reaching this function is UNTRUSTED
// TEXT — a language model's output, shaped by whatever was in the capture line,
// which may itself be a meeting note someone else wrote. So there is no shape
// assumed, no field echoed, and no benefit of the doubt: a value is either
// checked against something REAL — a track in this workspace, a member in this
// member list, a key of a frozen union, a calendar date that has not already
// passed — or it is dropped. Dropped, never corrected: a validator that repairs
// a hallucination has invented a suggestion of its own, and the user reviewing
// it would be reviewing this file's guess rather than the model's.
//
// PURE and total. No network, no React, no store, no throw. That is what makes
// the safety of the AI feature a `vitest` run rather than a hope about an API.
//
// WHAT IS DELIBERATELY NOT HERE: any notion of "confidence", any repair, any
// free-text owner, any status, any cadence. See REFUSED_FIELDS.

import { parseIsoDate, toIsoDate, todayIso } from '../dates'
import { flattenText, ownerToken, quoteValue, trackToken, vocabToken } from './toLine'
import {
  AI_TAGS_MAX,
  AI_TAG_MAX,
  AI_TITLE_MAX,
  REFUSED_FIELDS,
  isPriorityKey,
  isTypeKey,
} from './types'
import type { EntryPriority, EntryType } from '../../types'
import type { IsoDate } from '../dates'
import type { AiContext, DropReason, DroppedField, SuggestionField, ValidatedSuggestion } from './types'

/** An object, and not an array — `[]` is an object and is not a payload. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `Object.hasOwn`, for the reason isPriorityKey() gives: a plain property read
 * walks the prototype chain, and a validator standing between a language model
 * and a database should not be reading `Object.prototype` by accident.
 */
function pick(payload: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(payload, key) ? payload[key] : undefined
}

/** Absent and explicitly null are the same fact: the model proposed nothing
 *  here. Neither is a failure, so neither is reported as a drop. */
function absent(value: unknown): boolean {
  return value === undefined || value === null
}

const NO_TAGS: readonly string[] = Object.freeze([])

/**
 * Validate a model proposal against the REAL workspace.
 *
 * Returns a suggestion in which every non-null field is one this line can carry
 * and this parser will read back — `toLine(validate(x), ctx)` parsed by parse()
 * yields exactly the fields approved here. Fields the model did not send, sent
 * malformed, hallucinated, or spelled in a way no token can express come back
 * null, with a valueless record in `dropped`.
 */
export function validate(raw: unknown, ctx: AiContext): ValidatedSuggestion {
  const dropped: DroppedField[] = []
  const drop = (field: SuggestionField, reason: DropReason): void => {
    dropped.push({ field, reason })
  }

  // A NON-OBJECT IS THE COMMON FAILURE, not an exotic one: a model that hits its
  // token ceiling returns truncated JSON, a model that refuses returns a
  // sentence, and an edge function that 500s may return an error envelope. All
  // three arrive here and all three must degrade to "no suggestion" rather than
  // to a stack trace inside a keystroke handler.
  if (!isRecord(raw)) {
    drop('payload', 'malformed')
    return {
      title: null,
      trackId: null,
      ownerId: null,
      priority: null,
      type: null,
      dueDate: null,
      followUpDate: null,
      tags: NO_TAGS,
      dropped,
    }
  }

  const title = validateTitle(pick(raw, 'title'), drop)
  const trackId = validateTrack(pick(raw, 'trackId'), ctx, drop)
  const ownerId = validateOwner(pick(raw, 'ownerId'), ctx, drop)
  const priority = validatePriority(pick(raw, 'priority'), ctx, drop)
  const type = validateType(pick(raw, 'type'), ctx, drop)
  const dueDate = validateDate(pick(raw, 'dueDate'), 'dueDate', ctx, drop)
  const followUpDate = validateDate(pick(raw, 'followUpDate'), 'followUpDate', ctx, drop)
  const tags = validateTags(pick(raw, 'tags'), drop)

  // Refusals last, so `dropped` reads field-by-field and ends with the three
  // fields this module will not accept at any value. UNKNOWN keys are not
  // reported at all — reporting one would mean naming it, and a key name is text
  // the model wrote. They are simply never read.
  for (const field of REFUSED_FIELDS) {
    if (!absent(pick(raw, field))) drop(field, 'unsupported')
  }

  return { title, trackId, ownerId, priority, type, dueDate, followUpDate, tags, dropped }
}

type Drop = (field: SuggestionField, reason: DropReason) => void

/**
 * A title is free text, and free text is the field an injection arrives in.
 *
 * NOTHING is stripped from it beyond invisibles and control characters — the
 * words stay exactly as the model wrote them, because a validator that redacted
 * "ignore previous instructions" would be teaching the next attempt to spell it
 * differently, and the words are harmless the moment they are DATA. What makes
 * them data is escapeTitle() in toLine.ts, not a filter here.
 *
 * Flattened, because parse()'s buildTitle collapses whitespace and trims: a
 * title validated in a form the parser will not return is a round trip that is
 * an approximation. Over the limit it is dropped rather than truncated — a
 * truncated title cuts mid-word and reads as the model's, which it no longer is.
 */
function validateTitle(value: unknown, drop: Drop): string | null {
  if (absent(value)) return null
  if (typeof value !== 'string') {
    drop('title', 'malformed')
    return null
  }
  const flat = flattenText(value)
  if (flat === '') {
    drop('title', 'malformed')
    return null
  }
  if (flat.length > AI_TITLE_MAX) {
    drop('title', 'tooLong')
    return null
  }
  return flat
}

/**
 * A track id the workspace does not have is DROPPED, NOT ECHOED — the plan's
 * words, and the first thing a hallucinating model reaches for, because an id is
 * the field it has least grounding for.
 *
 * The second check is the one nobody expects: an id can be real and still have
 * no `#` token that selects it. See trackToken().
 */
function validateTrack(value: unknown, ctx: AiContext, drop: Drop): string | null {
  if (absent(value)) return null
  if (typeof value !== 'string') {
    drop('trackId', 'malformed')
    return null
  }
  if (!ctx.tracks.some((t) => t.id === value)) {
    drop('trackId', 'unknown')
    return null
  }
  if (trackToken(value, ctx) === null) {
    drop('trackId', 'ambiguous')
    return null
  }
  return value
}

/** Same three steps for a member, and the same reason for the third: a real
 *  teammate whose handle and display name both fail to resolve uniquely cannot
 *  be assigned from a line, so they are not proposed from one. */
function validateOwner(value: unknown, ctx: AiContext, drop: Drop): string | null {
  if (absent(value)) return null
  if (typeof value !== 'string') {
    drop('ownerId', 'malformed')
    return null
  }
  if (!ctx.members.some((m) => m.id === value)) {
    drop('ownerId', 'unknown')
    return null
  }
  if (ownerToken(value, ctx) === null) {
    drop('ownerId', 'ambiguous')
    return null
  }
  return value
}

/** `"urgent"` is not a fifth priority, it is a hallucinated one — the union is
 *  frozen (src/types.ts:22-39) and the column's CHECK would refuse the insert
 *  long after the user was told it worked. */
function validatePriority(value: unknown, ctx: AiContext, drop: Drop): EntryPriority | null {
  if (absent(value)) return null
  if (!isPriorityKey(value)) {
    drop('priority', typeof value === 'string' ? 'unknown' : 'malformed')
    return null
  }
  if (vocabToken('!', value, ctx) === null) {
    drop('priority', 'ambiguous')
    return null
  }
  return value
}

function validateType(value: unknown, ctx: AiContext, drop: Drop): EntryType | null {
  if (absent(value)) return null
  if (!isTypeKey(value)) {
    drop('type', typeof value === 'string' ? 'unknown' : 'malformed')
    return null
  }
  if (vocabToken('/', value, ctx) === null) {
    drop('type', 'ambiguous')
    return null
  }
  return value
}

/**
 * A real calendar date, in the future or today, canonically spelled.
 *
 * `parseIsoDate` is the ONE door (lib/dates.ts:250): it refuses `2026-02-30`,
 * refuses a year outside 1900-2999, and refuses anything that is not exactly
 * `YYYY-MM-DD`. Re-emitting `toIsoDate` of what it returned is what guarantees
 * the approved value is the same string the token will carry, whitespace and
 * all.
 *
 * NOT IN THE PAST, because a model asked "when is this due" and given no date
 * will happily anchor on a year it half-remembers, and a due date already
 * overdue on the day it is created is a row that arrives red — the app's own
 * `v_entry_health` marks it `overdue` before the user has read it. Today is
 * allowed: "by end of day" is an ordinary thing to capture. The comparison is
 * lexicographic, which IS chronological for two canonical four-digit-year ISO
 * dates and is why both sides are canonicalised first.
 */
function validateDate(
  value: unknown,
  field: SuggestionField,
  ctx: AiContext,
  drop: Drop,
): IsoDate | null {
  if (absent(value)) return null
  if (typeof value !== 'string') {
    drop(field, 'malformed')
    return null
  }
  const parsed = parseIsoDate(value)
  if (parsed === null) {
    drop(field, 'malformed')
    return null
  }
  const iso = toIsoDate(parsed)
  if (iso < todayIso(ctx.now)) {
    drop(field, 'past')
    return null
  }
  return iso
}

/**
 * Plain strings, lowercased and deduped exactly as parse() does
 * (`normalizeTag`, parse.ts:924), within a length limit and a count limit.
 *
 * Lowercased HERE as well as there so the approved value and the parsed value
 * are the same string — tags are stored verbatim and matched with `=`, so a
 * suggestion approved as `Portal` and stored as `portal` is a round trip that
 * quietly is not one.
 *
 * A tag carrying a quote character is dropped rather than repaired, for the
 * reason quoteValue() gives. One drop record per REASON, not per element: the
 * record exists to tell a human which prompt to fix, and eight identical entries
 * say nothing the first one did not.
 */
function validateTags(value: unknown, drop: Drop): readonly string[] {
  if (absent(value)) return NO_TAGS
  if (!Array.isArray(value)) {
    drop('tags', 'malformed')
    return NO_TAGS
  }

  const tags: string[] = []
  let malformed = 0
  let tooLong = 0

  for (const item of value) {
    if (tags.length >= AI_TAGS_MAX) {
      tooLong += 1
      continue
    }
    if (typeof item !== 'string') {
      malformed += 1
      continue
    }
    const tag = flattenText(item).toLowerCase()
    if (tag === '' || quoteValue(tag) === null) {
      malformed += 1
      continue
    }
    if (tag.length > AI_TAG_MAX) {
      tooLong += 1
      continue
    }
    if (!tags.includes(tag)) tags.push(tag)
  }

  if (malformed > 0) drop('tags', 'malformed')
  if (tooLong > 0) drop('tags', 'tooLong')
  return tags.length === 0 ? NO_TAGS : tags
}
