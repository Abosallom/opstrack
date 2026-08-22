// TURNING WHAT SOMEBODY TYPED INTO WHAT 0031 WILL STORE.
//
// PURE, on `lib/pmo/summary.ts`'s contract: no store, no api, no React, no
// `t()`. Every function here takes a string an `<input>` produced and answers
// with the value a PostgREST patch should carry. That is what makes the one
// rule below testable at all — the components that call these are rendered
// through `renderToStaticMarkup` in a node environment where no keystroke can
// be simulated, so if this arithmetic lived inside them nothing could pin it.
//
// ── ⚠ AN EMPTY BOX IS `null`, AND IT IS NEVER ZERO ────────────────────────
//
// This is the single rule the whole PMO schema is built around, stated at
// length in 0031's comments on `actual_pct`:
//
//   "A project at 0% because nothing has happened and one at 0% because nobody
//    has updated it are different sentences."
//
// The source dashboard shows ten initiatives all reading 0% precisely because
// it cannot tell those apart, and `Portfolio.tsx` prints "Nobody has said"
// rather than a bar at zero for exactly this reason. A form is where that
// distinction is most easily destroyed: `Number('')` is `0`, `parseInt('')` is
// `NaN`, and `+form.actual || 0` — the shape a hurried edit reaches for — turns
// every cleared field into a claim the workspace never made.
//
// So `parseNumber('')` answers `{ ok: true, value: null }`. Not zero, not
// `undefined` (which a PATCH would drop, meaning "do not touch" — the opposite
// of "clear this"), and not a refusal, because clearing a field is a legitimate
// thing to do. `'0'` answers zero, because somebody typed a zero and meant it.
//
// ── AND A REFUSAL IS NOT A NULL ───────────────────────────────────────────
//
// `parseNumber('abc')` and `parseNumber('')` must not answer the same thing.
// The first is a mistake the form has to report; the second is a fact. Hence
// the tagged result rather than `number | null`, which has no room left to say
// "that is not a number".

import type { PmoSource } from '../../types'

/** What a numeric box said. `value: null` is "nobody has said" — never zero. */
export type NumberResult = { ok: true; value: number | null } | { ok: false }

export interface NumberRules {
  /** Inclusive. Rejected rather than clamped: a silent clamp is a typo stored. */
  min?: number
  max?: number
  /** Percentages and years are whole. Money is not. */
  integer?: boolean
}

/**
 * `''` → null. A number → the number. Anything else → a refusal.
 *
 * ⚠ `Number('')` IS `0` AND `Number(' ')` IS `0`. Both are trimmed to empty
 *   first, so neither can arrive at the database as a measurement.
 */
export function parseNumber(raw: string, rules: NumberRules = {}): NumberResult {
  const text = raw.trim()
  if (text === '') return { ok: true, value: null }
  const n = Number(text)
  if (!Number.isFinite(n)) return { ok: false }
  if (rules.integer === true && !Number.isInteger(n)) return { ok: false }
  if (rules.min !== undefined && n < rules.min) return { ok: false }
  if (rules.max !== undefined && n > rules.max) return { ok: false }
  return { ok: true, value: n }
}

/**
 * The same, for a column 0031 declares NOT NULL — `pmo_key_results.target_value`
 * and `pmo_revenue.year`. Blank is a refusal here rather than a null, because
 * there is no "nobody has said" state for a measure a key result exists to
 * reach: 0031 calls a key result without one "an objective wearing the wrong
 * hat".
 */
export function parseRequiredNumber(raw: string, rules: NumberRules = {}): NumberResult {
  const parsed = parseNumber(raw, rules)
  if (!parsed.ok || parsed.value === null) return { ok: false }
  return parsed
}

/**
 * A nullable text column — a manager id from a `<select>`, a date from a date
 * input, a free-text period.
 *
 * `''` is what an unselected `<option value="">` and a cleared date input both
 * produce, and both mean "nobody named" rather than "the empty string". 0031
 * uses NULL for that on every column where it is a fact and `''` only where a
 * three-state string/null/'' would be "a bug waiting for the first filter" —
 * `note`, `mitigation`, `period`. Those go through `trimmed()` instead.
 */
export function blankToNull(raw: string): string | null {
  const text = raw.trim()
  return text === '' ? null : text
}

/** For the NOT NULL DEFAULT '' columns, where '' is the honest empty. */
export function trimmed(raw: string): string {
  return raw.trim()
}

/**
 * THE JIRA HALF OF EVERY FORM IN THIS FAMILY, and the reason it is one
 * function: `source` and `external_ref` are two columns that must never
 * disagree.
 *
 * 0031 puts `source in ('local','jira')` beside a nullable key on all eight
 * tables so that any row can name the issue it mirrors. Setting the key without
 * moving `source` leaves a row that says it is local while pointing at Jira;
 * clearing the key without moving `source` back leaves a row that claims to
 * mirror an issue it can no longer name, and `browseUrlFor()` has nothing to
 * build a link from. Neither state is reachable if the pair is only ever
 * written together, which is what this returns.
 *
 * THE URL IS NOT HERE, and 0031 is emphatic about why: a browse URL is
 * `<site>/browse/<KEY>`, `lib/jira/types.ts` already computes it, and storing
 * it would put the site address in eight more tables for the day it changes.
 */
export interface JiraPatch {
  source: PmoSource
  external_ref: string | null
}

export function jiraPatch(raw: string): JiraPatch {
  const key = raw.trim()
  // Cleared means local again — both halves, in one move.
  if (key === '') return { source: 'local', external_ref: null }
  return { source: 'jira', external_ref: key }
}

/** What the Jira box shows for a row: its key, or nothing. */
export function jiraValue(externalRef: string | null): string {
  return externalRef ?? ''
}

/**
 * A `date` column for an `<input type="date">`, and back.
 *
 * PostgREST hands a `date` back as `YYYY-MM-DD`, which is exactly the value
 * format the input wants, so this is identity plus the null. It exists as a
 * named function anyway because `done_at` is a `timestamptz` and does NOT share
 * it — see `doneStamp` — and a reader who assumes every date round-trips the
 * same way would write the wrong thing there.
 */
export function dateValue(iso: string | null): string {
  return iso ?? ''
}

/**
 * A done checkbox, against what the row already carried.
 *
 * ⚠ AN ALREADY-CLOSED ROW KEEPS ITS ORIGINAL STAMP. 0031 stores a timestamp
 *   rather than a boolean so that "7 open, 5 complete" can become "closed this
 *   week" without a schema change — and re-stamping `now()` every time somebody
 *   edits an unrelated field on a closed action would quietly move it into this
 *   week for ever. `now` is an argument for this module's usual reason.
 */
export function doneStamp(checked: boolean, existing: string | null, now: string): string | null {
  if (!checked) return null
  return existing ?? now
}
