// Validated fields → a canonical capture token line that parse() reads back
// IDENTICALLY.
//
// This module is the other half of the keystone rule. validate.ts decides what
// is true; this file decides what can be WRITTEN, and the two questions are not
// the same one. A track can exist in the workspace and still have no token that
// names it unambiguously; a display name can be real and contain a quote
// character that ends the token early. So the expressibility helpers below have
// TWO CALLERS — validate() asks them "could this be written?" and drops the
// field when the answer is no, toLine() asks them "write it" — for exactly the
// reason parse.ts:696 gives for keyedValueResolves() having three: two functions
// answering the same question separately is two functions that will eventually
// disagree, and here the disagreement would be a field the user accepted and the
// parser then silently refused.
//
// PURE, and importing parse.ts READ-ONLY. `matchTrack` and `matchMember` are the
// parser's own resolvers; asking them whether a token resolves back to the id we
// meant is the strongest available proof, and it is strictly better than a
// second copy of the matching rules that would drift the day tier 2 changes.
// parse.ts is not modified by this wave and must not be.

import { matchMember, matchTrack } from '../capture/parse'
import { stripInvisible } from '../bidi'
import { foldKey } from '../text'
import type { AiContext, ValidatedSuggestion } from './types'

// ── the grammar, mirrored ──────────────────────────────────────────────────
//
// Mirrors of `SIGIL_KIND` (parse.ts:322), `KEYED_PREFIXES` (parse.ts:283) and
// `HAS_WORD_CHAR` (parse.ts:390). They are duplicated rather than imported
// because parse.ts exports none of them and this wave may not touch that file —
// the same situation parse.ts itself documents for BIDI_MARKS, which it
// duplicates from lib/dates.ts for the same reason.
//
// THE DRIFT GUARD IS NOT A COMMENT, IT IS THE ROUND-TRIP SUITE. Every test in
// toLine.test.ts feeds this module's output to the REAL parse(), so a sigil or a
// keyed prefix added to the grammar without being added here turns the suite red
// rather than turning a title into a token in production.

const SIGILS = '#@!+/'

/** Longest alternative first, exactly as KEYED_RE requires: `due` must win over
 *  `d`, or `due:thu` matches as `d` with the value `ue:thu`. */
const KEYED_PREFIXES = ['due', 'd', 'fu', 'f', 'every', 'ev'] as const

const KEYED_ALTERNATION = KEYED_PREFIXES.join('|')

/** Would this word START a token? A token begins only at a word boundary — that
 *  single rule (parse.ts:430) is why `https://x#INC-42` survives untouched. */
const TOKEN_START_RE = new RegExp(`^(?:[${SIGILS}]|(?:${KEYED_ALTERNATION}):)`, 'i')

/**
 * A backslash that parse()'s buildTitle would EAT.
 *
 * `ESCAPED_SIGIL_RE` (parse.ts:351) is applied to the whole surviving title, not
 * just to word starts, so a title legitimately containing `C:\#tags` loses its
 * backslash on the way to the database. Doubling it first is what makes the
 * round trip lossless: `\\#` unescapes to `\#`, because the regex scans left to
 * right and the first backslash is not followed by a sigil.
 */
const ORPHAN_ESCAPE_RE = new RegExp(`\\\\(?=(?:[${SIGILS}]|(?:${KEYED_ALTERNATION}):))`, 'gi')

/** At least one letter or digit, in any script — parse.ts:390. A value without
 *  one is not a token unless it is quoted; see quoteValue(). */
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u

// ── text that can live on one line ─────────────────────────────────────────

/**
 * One line, no invisibles, no control characters, no doubled spaces.
 *
 * THE ISOLATE CLAUSE IS MANDATORY, not tidiness. lib/bidi.ts:134 states it: the
 * capture examples are stored isolate-free because U+2066–U+2069 fed to the
 * parser are carried into the token as LITERAL CHARACTERS — BIDI_MARKS covers
 * U+200B–U+200F and U+061C and stops short of the isolates. An isolate in a
 * model-authored title would be invisible in the box, invisible in the list, and
 * permanent in the column. `stripInvisible()` removes the whole `Cf` category,
 * so this is closed by construction rather than by remembering.
 *
 * The whitespace collapse is what makes the round trip an equality rather than
 * an approximation: buildTitle() collapses `\s+` to one space and trims the
 * edges (parse.ts:1198), so a value that is not already flat comes back
 * different from what was approved. Control characters join the same collapse —
 * a NUL is not whitespace, `trim()` will not remove it, and Postgres rejects it
 * outright at insert time.
 */
export function flattenText(value: string): string {
  return stripInvisible(value)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
}

/**
 * The value as it must appear after a sigil, or NULL when it cannot be written
 * at all.
 *
 * Three cases, all of them real:
 *   - whitespace       → quote it, or `#IT Operations` files the track and
 *                        strands `Operations` in the title.
 *   - no word char     → quote it, or tokenAt() refuses to make a token at all
 *                        (parse.ts:548, the bare-sigil rule) and the value lands
 *                        in the title as literal text.
 *   - contains a `"`   → NULL. readValue() ends a quoted value at the first
 *                        closing quote, so `@"Ann "The Fixer""` is the owner
 *                        `Ann` plus two orphan words. Capture.tsx:191 strips the
 *                        inner quotes instead; that is right for a chip the user
 *                        is watching and wrong here, because a silently altered
 *                        name is a silently different match.
 */
export function quoteValue(value: string): string | null {
  if (value === '') return null
  if (value.includes('"')) return null
  return /\s/.test(value) || !HAS_WORD_CHAR.test(value) ? `"${value}"` : value
}

/**
 * A title, escaped so that NOTHING in it becomes a token and it comes back out
 * of parse() byte for byte.
 *
 * THIS IS THE INJECTION BOUNDARY. A model that has read a hostile meeting note
 * will cheerfully return `title: "review the SLA @ahmed !critical #network"`,
 * and every one of those three tokens would file real data the user never asked
 * for — an assignment, a priority and a track — while the visible title looked
 * like a sentence. Escaping is what makes a title DATA. The rule is one line: a
 * word that would start a token gets a backslash, which parse() takes back out
 * (parse.ts:351) and which stops tokenAt() dead, because neither SIGIL_KIND nor
 * KEYED_RE can begin on a backslash.
 *
 * DELIBERATELY OVER-INCLUSIVE. `####` and `+++` are not tokens — the bare-sigil
 * rule refuses them — and they are escaped anyway, because the alternative is
 * this function carrying a second copy of tokenAt()'s acceptance test and being
 * wrong about it one grammar change later. The cost is a visible backslash in a
 * rare title; the cost of the other mistake is a red chip on a suggestion the
 * user just accepted.
 *
 * Flattens first, so the no-isolate rule holds for ANY string handed to this
 * function and not only for one validate() has already cleaned. Total over any
 * input. Deliberately NOT idempotent: run twice, it escapes its own backslashes,
 * which is the correct reading of "this escaped text is now a literal title".
 */
export function escapeTitle(title: string): string {
  return flattenText(title)
    .replace(ORPHAN_ESCAPE_RE, '\\\\')
    .replace(/\S+/g, (word) => (TOKEN_START_RE.test(word) ? `\\${word}` : word))
}

// ── expressibility: the questions validate() and toLine() both ask ─────────

/**
 * `#token` for this track id, or NULL when no token names it unambiguously.
 *
 * Tries the track's own forms — the CURRENT LOCALE's name first, then the other,
 * then any aliases — and accepts the first that `matchTrack` resolves BACK to
 * this exact id. That check is not ceremony: `matchTrackTiers` (parse.ts:792)
 * resolves only when a tier holds exactly one hit, so a workspace holding two
 * tracks whose names fold together (`IT-Ops` and `IT Ops` both fold to `itops`)
 * has a real track that no `#` token can select. Proposing it anyway would hand
 * the user a suggestion that turns into an ambiguity chip the moment they accept
 * it.
 *
 * The Arabic name is skipped when empty rather than tried and rejected:
 * `tracks.name_ar` is `not null default ''`, so "" is the ordinary state of a
 * track nobody has translated, and quoteValue() already refuses it.
 */
export function trackToken(trackId: string, ctx: AiContext): string | null {
  const track = ctx.tracks.find((t) => t.id === trackId)
  if (!track) return null
  const localised =
    ctx.locale === 'ar' ? [track.nameAr, track.name] : [track.name, track.nameAr]
  for (const form of [...localised, ...(track.aliases ?? [])]) {
    const value = flattenText(form ?? '')
    const written = quoteValue(value)
    if (written === null) continue
    // matchTrack sees what readValue() extracts — the UNQUOTED value.
    if (matchTrack(value, ctx.tracks).id === trackId) return `#${written}`
  }
  return null
}

/**
 * `@token` for this member id, or NULL when no token names them.
 *
 * USERNAME FIRST, because it is tier 0 in matchMemberTiers (parse.ts:848) and
 * tier 0 exists precisely so a handle cannot be outvoted by a display name that
 * merely starts with the same letters. A member with no handle falls back to the
 * display name, which resolves at tier 1 — unless two teammates share it, which
 * is the case this function returns null for rather than assigning work to a
 * coin flip.
 */
export function ownerToken(ownerId: string, ctx: AiContext): string | null {
  const member = ctx.members.find((m) => m.id === ownerId)
  if (!member) return null
  for (const form of [member.username ?? '', member.displayName, ...(member.aliases ?? [])]) {
    const value = flattenText(form)
    const written = quoteValue(value)
    if (written === null) continue
    if (matchMember(value, ctx.members) === ownerId) return `@${written}`
  }
  return null
}

/**
 * `!priority` / `/type`, or NULL when an admin's renamed label has taken the
 * word this key is spelled with.
 *
 * THE CASE THIS EXISTS FOR. resolveVocab (parse.ts:888) consults the admin's
 * OVERRIDES BEFORE its own alias table, so a workspace where `critical` has been
 * relabelled "High" reads `!high` as `critical`. The model proposed high, the
 * user accepted high, and the entry is critical — wrong data, filed silently, by
 * a feature whose whole premise is that it cannot file anything. Refusing to
 * write the token is the only honest answer; the suggestion simply omits the
 * priority.
 *
 * The precedence mirrored here is resolveVocab's, first-match-wins over
 * `Object.entries`. The mirror is held in place by a test that drives the REAL
 * parse() with a colliding alias, so the two cannot drift in silence.
 */
export function vocabToken(sigil: '!' | '/', key: string, ctx: AiContext): string | null {
  const written = quoteValue(key)
  if (written === null) return null
  const overrides = ctx.vocabAliases?.[sigil === '!' ? 'priority' : 'type']
  if (overrides) {
    const needle = foldKey(key)
    for (const [overrideKey, aliases] of Object.entries(overrides)) {
      if (aliases.some((alias) => foldKey(alias) === needle)) {
        return overrideKey === key ? `${sigil}${written}` : null
      }
    }
  }
  return `${sigil}${written}`
}

// ── rendering ──────────────────────────────────────────────────────────────

/**
 * The tokens alone, in canonical order, WITHOUT the title.
 *
 * Exported for the capture screen's accept path: the user's own prose is
 * already in the box, and appending tokens through `appendToken`
 * (Capture.tsx:196) leaves what they typed untouched. Replacing the whole line
 * with toLine() is the other legitimate shape; both end at parse().
 *
 * The order mirrors `capture.exampleFull` — "Renew SSL cert #infra @sara !high
 * due:+7d +portal" — so the line the assistant produces reads like the line the
 * hint teaches. It is also fixed rather than incidental, because the edge
 * function caches identical lines and an order that varied would cache twice.
 *
 * `every:` IS NEVER EMITTED. See REFUSED_FIELDS: a cadence turns the capture
 * into a recurring template in a different table.
 */
export function toTokens(v: ValidatedSuggestion, ctx: AiContext): string[] {
  const out: string[] = []

  if (v.trackId !== null) {
    const token = trackToken(v.trackId, ctx)
    if (token !== null) out.push(token)
  }
  if (v.ownerId !== null) {
    const token = ownerToken(v.ownerId, ctx)
    if (token !== null) out.push(token)
  }
  if (v.priority !== null) {
    const token = vocabToken('!', v.priority, ctx)
    if (token !== null) out.push(token)
  }
  if (v.type !== null) {
    const token = vocabToken('/', v.type, ctx)
    if (token !== null) out.push(token)
  }
  // No quoting and no escaping: the value came out of `toIsoDate`, so it is
  // `YYYY-MM-DD` and cannot contain whitespace, a quote or a sigil. `fu:` is a
  // SHORT_KEY (parse.ts:320) and is a token only when its value resolves — an
  // ISO date always does, which is exactly why the abbreviation is safe here.
  if (v.dueDate !== null) out.push(`due:${v.dueDate}`)
  if (v.followUpDate !== null) out.push(`fu:${v.followUpDate}`)
  // Flattened here as well as in validate(), for the reason escapeTitle()
  // flattens: the no-isolate rule must hold for any ValidatedSuggestion this
  // function is handed, including one a caller assembled by hand. Case is NOT
  // touched — `normalizeTag` lowercases (parse.ts:924) and validate() matches it,
  // and a second owner for that rule is a second place for it to change.
  for (const tag of v.tags) {
    const written = quoteValue(flattenText(tag))
    if (written !== null) out.push(`+${written}`)
  }

  return out
}

/**
 * The whole line: escaped title first, then the tokens.
 *
 * What parse() gives back is what validate() approved — that is the property the
 * round-trip suite asserts field by field, against the real parser, for a
 * hallucinated track, an invented owner, a past date, an Arabic title, a title
 * made of sigils and a title carrying an injection attempt.
 *
 * A suggestion with no title renders as tokens alone, which is the normal case
 * when the assistant is enriching a line the user is still typing.
 */
export function toLine(v: ValidatedSuggestion, ctx: AiContext): string {
  const parts = toTokens(v, ctx)
  const title = v.title === null ? '' : escapeTitle(v.title)
  return title === '' ? parts.join(' ') : [title, ...parts].join(' ')
}
