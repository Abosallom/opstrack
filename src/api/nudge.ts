// Nudge — asking a colleague for an update, and the record that you asked.
//
// ONE CALL, AND THAT IS THE WHOLE MODULE. `nudge_entry()` (migration 0019) does
// three writes in one transaction — the owner's notification, the immutable
// `entry_updates` row that puts the ask in the audit thread, and the
// `entries.nudged_at` / `nudged_by` stamp — or none of them. There is no read
// here to match it, and that is not an omission: the stamp is a COLUMN ON THE
// ENTRY, so every screen that already holds the entries store already holds the
// answer, cached and realtime-patched, with no second fetch and no second thing
// to keep in step.
//
// ERRORS ARE THE FEATURE, NOT THE EDGE CASE. "Something went wrong" after you
// tap a button that messages a colleague is the worst possible answer: it leaves
// you unable to tell "somebody already asked" from "the request never left".
// 0019 raises a DISTINCT SQLSTATE + marker token for each of its five refusals —
// its own header calls the rate limit's code "a code of its own so the client
// can say 'already asked N hours ago' rather than 'something went wrong'" — and
// NUDGE_ERRORS below is the other half of that handshake. No path in this module
// renders a nudge refusal as a generic failure.
//
// WHY THE MAPPING IS HERE AND NOT IN lib/pgError.ts. Same reason api/templates.ts
// keeps `templateErrorKey()`: pgError.ts is another worker's module and §1.0.4
// forbids editing it, so the tokens this feature's function raises are mapped
// beside the call that raises them and `pgErrorKey()` is DELEGATED to for
// everything else — 23514, PGRST116 and PGRST205 keep their existing, better
// sentences. The handoff files it as an extension-slot addition; folding
// NUDGE_ERRORS into pgError.ts later is a copy of one table and one import.
//
// TWO OF THE FIVE MAPPINGS OVERRIDE A DELEGATED ANSWER, and they are the reason
// this cannot simply call pgErrorKey():
//   · 42501 — pgErrorKey reads every RLS refusal as "only an admin can do that",
//     which is exactly wrong here. 0019 raises it for a JWT with no profile row:
//     a deleted member's live session, or a token minted for somebody never
//     provisioned. Telling them to ask an admin sends them to the wrong place.
//   · PT429 — PostgREST's own convention (a `PTxxx` SQLSTATE sets the HTTP
//     status), so this arrives as a real 429. pgErrorKey has never seen it and
//     would `console.warn` it into 'common.error'.

import { supabase } from './supabase'
import { fail, notConfigured } from './result'
import { pgErrorKey } from '../lib/pgError'
import type { ApiResult } from './result'

/**
 * The per-entry window, in milliseconds — 0019 PART 5's `interval '24 hours'`.
 *
 * MIRRORED, NOT INVENTED, and mirrored deliberately rather than fetched: the
 * migration hardcodes it and says why ("a configurable annoyance budget is a
 * setting nobody would ever open"), so there is no source to read it from and
 * the alternative is a screen that cannot say whether asking again would be
 * accepted. The SERVER REMAINS THE AUTHORITY — this only decides whether the UI
 * OFFERS the button; a client that drifts early meets `nudge.errTooSoon`, which
 * is a precise sentence rather than a broken promise.
 *
 * If 0019's interval ever changes, this constant changes with it. That is a
 * handshake, and it is written down in both files.
 */
export const NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The body 0019 writes into `entry_updates` for a nudge.
 *
 * A TOKEN, NOT A SENTENCE, and the migration says why at PART 5 step 6: the
 * thread renders `update.body` verbatim, so an English sentence written by the
 * database would appear untranslated in a fully-Arabic thread — in an app whose
 * primary user reads Arabic and whose every other string goes through t().
 */
export const NUDGE_BODY_TOKEN = '[nudge]'

/**
 * The i18n key for a thread row the database wrote, or null for a human's.
 *
 * THE SEAM, and it lives here rather than in the thread because the token is
 * NUDGE knowledge: `components/entry/UpdateThread.tsx` and
 * `pages/tracks/TrackTimeline.tsx` are other workers' modules (§1.0.4), and the
 * handoff carries the one-import diff that has each of them render
 * `t(threadBodyKey(u.body) ?? u.body)`. Until that lands the thread shows the
 * literal `[nudge]`, which is ugly for one deploy and never wrong and never in
 * the wrong language — the property the token was chosen for.
 *
 * Compared on the TRIMMED body so a future writer that pads the token still
 * resolves, and returning null rather than the body itself so a caller cannot
 * accidentally push arbitrary user text through t().
 */
export function threadBodyKey(body: string): string | null {
  return body.trim() === NUDGE_BODY_TOKEN ? 'nudge.threadLine' : null
}

/**
 * Postgres refusal → the sentence that names it.
 *
 * ONE TABLE, KEYED BY MARKER TOKEN, with the SQLSTATE checked alongside so that
 * an entry TITLE containing the words "nudge self" — titles reach error text,
 * because a unique-violation detail quotes the value — cannot route an unrelated
 * failure to a confidently wrong message.
 *
 * Every token here is raised by `nudge_entry()` and by nothing else. The
 * migration's own comment on the function lists the same five; renaming one
 * there without renaming it here silently demotes a precise sentence to
 * pgErrorKey's fallback, which is why both files carry the table.
 */
export const NUDGE_ERRORS: ReadonlyArray<{ code: string; token: string; key: string }> = [
  // A JWT with no profile row. NOT "ask an admin" — see this file's header.
  { code: '42501', token: 'nudge_not_a_member', key: 'nudge.errNotMember' },
  // The entry was deleted by someone else while this screen sat open.
  { code: 'P0002', token: 'nudge_entry_missing', key: 'nudge.errGone' },
  // `owner_id is null` — unowned, or owned by a free-text name (a vendor,
  // another department). Either way there is no inbox to write to.
  { code: '22023', token: 'nudge_no_owner', key: 'nudge.errNoOwner' },
  // You own it. The UI does not offer the button here, so reaching this means a
  // second device changed the owner — the sentence has to say WHICH fact
  // changed, because "couldn't ask" would read as a fault.
  { code: '22023', token: 'nudge_self', key: 'nudge.errYours' },
  // Somebody asked within 24 hours. Not a fault, and not a failure of the app.
  { code: 'PT429', token: 'nudge_rate_limited', key: 'nudge.errTooSoon' },
]

/** The subset of a PostgrestError this module reads. Mirrors lib/pgError.ts. */
interface PgLike {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

/**
 * `pgErrorKey()`, plus the five refusals this feature's function raises and the
 * one that means the migration has not been applied here.
 *
 * Delegation is the LAST step, never the first — see the header for the two
 * mappings that would otherwise be answered wrongly rather than not at all.
 */
export function nudgeErrorKey(error: unknown): string {
  if (typeof error !== 'object' || error === null) return pgErrorKey(error)
  const e = error as PgLike
  const code = typeof e.code === 'string' ? e.code : ''
  // Every textual field, lowercased — PostgREST puts a `raise … using` marker in
  // `message` and its DETAIL in `details`, and searching the blob avoids caring
  // which. Same reasoning as lib/pgError.ts's haystack().
  const text = [e.message, e.details, e.hint]
    .filter((p): p is string => typeof p === 'string')
    .join(' ')
    .toLowerCase()

  for (const row of NUDGE_ERRORS) {
    if (row.code === code && text.includes(row.token)) return row.key
  }

  // PostgREST's "could not find the function in the schema cache" — 0019 has not
  // been applied to this project. pgErrorKey names PGRST205 (the table case) for
  // exactly this reason and this is its function-shaped twin: it is a SUPPORTED
  // state for a feature whose migration is new, and the one failure a screen can
  // explain precisely instead of guessing.
  if (code === 'PGRST202') return 'common.errMissingTable'

  return pgErrorKey(error)
}

/**
 * Ask this entry's owner for an update. Resolves with the server's stamp.
 *
 * `p_entry` — the migration's parameter name, not `p_entry_id`. PostgREST
 * resolves an RPC by its named arguments, so a mismatch here is not a type error
 * anywhere; it is a PGRST202 at runtime that reads exactly like a missing
 * migration.
 *
 * A NON-STRING ANSWER means the function on this project is not the one this
 * build was written against — 0019 declares `returns timestamptz` and PostgREST
 * serialises that as a JSON string. `nudge.errFailed` says the request did not
 * go out, which is the only thing a caller needs to be sure of; 'common.error'
 * would leave them unable to tell it from "already asked".
 */
export async function nudgeEntry(entryId: string): Promise<ApiResult<string>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('nudge_entry', { p_entry: entryId })
  if (error) return fail(nudgeErrorKey(error))
  if (typeof data !== 'string' || data === '') return fail('nudge.errFailed')
  return { ok: true, data }
}
