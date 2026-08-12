// The paging driver: one `.range()` walk, one page size, one chunker.
//
// WHY A MODULE AND NOT A SIXTH HAND-ROLLED LOOP. api/timeline.ts, api/labels.ts
// and lib/export.ts each carry their own copy of the same eight lines, and the
// three copies do not agree: only export.ts treats a page LONGER than asked for
// as a full page. That refinement is the one that matters when it is missing —
// a server ignoring `.range()` answers with everything, the loop reads a page
// bigger than PAGE_SIZE, calls it short, and reports a complete read. Two of
// the three copies would call that success. This file is the version with every
// refinement in it, so the map's reads inherit the corrections rather than the
// average.
//
// IT IS DELIBERATELY NOT A REWRITE OF THE OTHER THREE. Collapsing timeline,
// labels and export onto this driver is the right follow-up and belongs in its
// own pass with every test green; doing it here would touch the app's hottest
// reads for no user-visible gain, on the wave whose job is to stop the map
// lying about how many organizations exist.
//
// NOTHING HERE KNOWS A TABLE NAME. The caller builds its own query and hands
// back whatever PostgREST answered; this file decides only when to stop asking.

import { fail, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
// TYPE-ONLY, so the doctrine comment at entries.ts:82-98 stays where it is and
// this module takes on no runtime dependency on the entries loader.
import type { Loaded } from './entries'

/**
 * Rows per request.
 *
 * THIS IS THE SIXTH COPY OF 1000 IN THE CODEBASE, and it is written down as
 * such rather than imported so the count stays honest: `entries.ts:80`
 * (MAX_ROWS), `meetings.ts:66` (MAX_ROWS), `labels.ts:68` (PAGE_SIZE),
 * `timeline.ts:56` (PAGE_SIZE), `export.ts:220` (EXPORT_PAGE_SIZE), and this
 * one. `api/entries.ts:64-79` is the authority on WHY the number is not ours:
 * the live project reports `db-max-rows: 1000` and PostgREST applies it AFTER
 * any `.limit()`, silently, so a bigger number here buys nothing until the
 * server's is raised and a smaller one only makes the loop chattier.
 *
 * The alternative — importing MAX_ROWS from api/entries.ts — would couple the
 * map's reads to the entries module's lifecycle for one integer, which is the
 * trade this file's header declines twice.
 */
export const PAGE_SIZE = 1000

/**
 * How many ids fit in one `.in()` filter.
 *
 * A SECOND COPY of `entries.ts:113-120`'s constant, carrying its reasoning
 * because the reasoning is what makes the number defensible: PostgREST takes
 * filters in the query string and a uuid costs ~37 bytes there, so 400 ids is a
 * ~15KB URL that a proxy rejects before Postgres ever sees it. 150 keeps one
 * chunk under ~6KB.
 */
export const ID_CHUNK = 150

/** What one page of a read came back as — PostgREST's own `{ data, error }`. */
export interface Page<T> {
  data: T[] | null
  error: unknown
}

/**
 * One page, as the caller's query builds it.
 *
 * `from` and `to` are INCLUSIVE and go straight into `.range(from, to)` — the
 * shape PostgREST wants, rather than timeline.ts's `(offset, size)`, so no call
 * site has to do the `- 1` that is wrong exactly once.
 */
export type PageQuery<T> = (from: number, to: number) => PromiseLike<Page<T>>

/**
 * Walk `.range()` pages until the server runs out or the cap stops us.
 *
 * THE STOP CONDITION IS A SHORT PAGE, NOT AN EMPTY ONE. A full page means there
 * may be more; a short page means there is not. Waiting for an empty page would
 * cost one extra round trip on every read whose total happens to be an exact
 * multiple of 1000 — api/timeline.ts:127's reasoning, verbatim.
 *
 * A PAGE LONGER THAN ASKED FOR COUNTS AS FULL. lib/export.ts:284's refinement,
 * and the only one of the three existing copies to have it: a server that
 * ignores `.range()` answers with the whole table, and `length < PAGE_SIZE`
 * would then be false only by accident. Treating "more than I asked for" as
 * "there may be more" keeps the loop's verdict wrong in the safe direction — it
 * reports truncation that is not there rather than completeness that is not
 * there, and the truncation banner is a sentence, while a silently short map is
 * a number an executive reads as fact.
 *
 * `truncated` therefore means exactly one thing: the cap stopped the walk with
 * a full page in hand, so rows are missing. It is not an error, which is the
 * whole point — a caller that forgets to look at it renders a plausible screen,
 * and that is why the flag is part of the return type (`Loaded<T>`).
 */
export async function fetchAllPages<T>(
  query: PageQuery<T>,
  maxPages: number,
): Promise<ApiResult<Loaded<T>>> {
  const rows: T[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * PAGE_SIZE
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) return fail(pgErrorKey(error))
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return { ok: true, data: { rows, truncated: false } }
  }
  return { ok: true, data: { rows, truncated: true } }
}

/**
 * Cut a list of ids into `.in()`-sized pieces, in order.
 *
 * A separate exported function rather than a loop inside the one caller,
 * because the arithmetic — inclusive slices, the last one short, an empty input
 * producing NO chunks rather than one empty one — is the part a reader has to
 * take on trust otherwise. An empty input must produce zero chunks: `.in('id',
 * [])` is a request that asks for nothing and is answered with nothing, so
 * issuing it is a round trip spent proving what the caller already knew.
 */
export function chunkIds(ids: readonly string[], size: number = ID_CHUNK): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  return chunks
}
