// One track's window: the entries alive in it and the thread rows written
// inside it. The only I/O the timeline screen performs.
//
// WHY THIS IS NOT api/entries.listTrackHistory(). That loader fetches the
// track's entries, then asks for the thread rows of those specific ids in
// chunks of 150 — correct, and two-to-N round trips whose second half depends
// on the first. This one asks PostgREST to do the join:
//
//     entry_updates?select=*,entries!inner(track_id)&entries.track_id=eq.<id>
//
// `!inner` turns the embed into an INNER JOIN and makes the embedded table's
// columns filterable, so "every update on this track" is one request that does
// not care how many entries the track has. EXECUTION-PLAN §3 is explicit that
// this is why W3-TIMELINE needs no migration and no view: the join already
// exists as a foreign key (`entry_updates_entry_id_fkey`), and PostgREST will
// resolve it. Verified against the live project, not assumed — the response
// carries the embed as an object (`"entries": { "track_id": … }`), which
// toEntryUpdate() below drops so callers get a clean EntryUpdate row.
//
// BOTH READS ARE PAGED, and that is a correctness requirement rather than
// future-proofing. PostgREST clamps every response at `max_rows` — live-verified
// at 1000 — and it does so AFTER any `.limit()`, silently: the answer is a 200
// with fewer rows than exist. A timeline that quietly lost the older half of a
// busy quarter would look exactly like a quiet quarter. So each side walks
// `.range()` pages until a short page arrives, and stops at MAX_PAGES with
// `truncated: true` rather than paging a runaway table forever. The screen
// renders that flag as a "narrow the dates" notice; it is never silent.
//
// BOTH READS ORDER NEWEST FIRST, which is the other half of the paging story. A
// window that hits the cap loses its OLDEST events, not an arbitrary slice from
// the middle — so the screen is missing the tail it can see it is missing,
// instead of holes it cannot.
//
// DAY BOUNDS ARE THE SERVER'S UTC MIDNIGHT. `from` and `to` are inclusive
// calendar days and the columns are timestamptz, so the upper bound is the
// exclusive start of the next day. That is the same ±1 day drift lib/dates.ts
// documents and accepts everywhere else, and lib/timeline.ts narrows again on
// the LOCAL calendar for exactly the rows this edge can misplace.

import { supabase } from './supabase'
import { fail, notConfigured } from './result'
import { pgErrorKey } from '../lib/pgError'
import { addDays } from '../lib/dates'
import type { ApiResult } from './result'
import type { IsoDate } from '../lib/dates'
import type { Entry, EntryStatus, EntryUpdate } from '../types'

/**
 * How many rows one request may return.
 *
 * THIS NUMBER IS THE SERVER'S, NOT A PREFERENCE. The live project reports
 * `db-max-rows: 1000`; raising it here changes nothing until that is raised
 * too, and lowering it just makes the loop chattier. It matches
 * `api/entries.ts`'s MAX_ROWS for the same reason and must move with it.
 */
const PAGE_SIZE = 1000

/**
 * The page ceiling — five pages, so 5000 entries or 5000 updates per window.
 *
 * A cap exists because `from`/`to` come from two date inputs and nothing stops
 * someone asking for five years on a phone. Past it the loader stops and says
 * so; the range control is the fix, and the notice names it.
 */
const MAX_PAGES = 5

/**
 * A track window.
 *
 * `truncated` is an ADDITION to the §2.16 shape rather than a change to it —
 * every declared consumer of `{ entries, updates }` still type-checks — and it
 * exists because the post-Wave-2 audit made it a standing requirement: every
 * new Wave-3 loader must page or check Content-Range, because truncation
 * arrives as a success with missing rows and is otherwise invisible.
 */
export interface TrackTimelineRows {
  entries: Entry[]
  updates: EntryUpdate[]
  /** Either read stopped at MAX_PAGES, so the oldest events are missing. */
  truncated: boolean
}

/**
 * The `entry_updates` row as the joined select returns it: every real column,
 * plus the embed PostgREST adds to prove the join matched.
 *
 * Declared rather than inferred so `toEntryUpdate` is a total mapping over
 * named fields instead of a rest-spread that silently forwards whatever else
 * the server decides to send.
 */
interface JoinedUpdateRow {
  id: string
  entry_id: string
  author_id: string | null
  body: string
  status_from: EntryStatus | null
  status_to: EntryStatus | null
  created_at: string
  /** The `entries!inner(track_id)` embed. Present, and deliberately unused. */
  entries?: unknown
}

/**
 * One page of a paged read, in the shape supabase-js resolves to.
 *
 * Structural rather than imported from @supabase/postgrest-js: the builder
 * resolves to a superset of this, so a query expression assigns straight to it
 * with no cast, and this file does not take a type dependency on a transitive
 * package's internal path.
 */
interface PageResult {
  data: unknown[] | null
  error: unknown
}

type PageQuery = (offset: number, size: number) => PromiseLike<PageResult>

/**
 * Walk `.range()` pages until the server runs out or the cap stops us.
 *
 * The stop condition is a SHORT page, not an empty one: a full page means there
 * may be more, a short page means there is not, and asking for the empty page
 * after an exact multiple costs one extra round trip that only happens when the
 * total is a multiple of 1000. Rows accumulate in the query's own order, so the
 * concatenation stays globally ordered and no re-sort is needed.
 */
async function fetchAllPages(
  query: PageQuery,
): Promise<ApiResult<{ rows: unknown[]; truncated: boolean }>> {
  const rows: unknown[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    const { data, error } = await query(offset, PAGE_SIZE)
    if (error) return fail(pgErrorKey(error))
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return { ok: true, data: { rows, truncated: false } }
  }
  return { ok: true, data: { rows, truncated: true } }
}

/** Drop the join witness. Field-by-field, so an added column cannot ride along. */
function toEntryUpdate(row: JoinedUpdateRow): EntryUpdate {
  return {
    id: row.id,
    entry_id: row.entry_id,
    author_id: row.author_id,
    body: row.body,
    status_from: row.status_from,
    status_to: row.status_to,
    created_at: row.created_at,
  }
}

/**
 * Everything that happened in one track between two calendar days, inclusive.
 *
 * THE ENTRY BOUND IS `created_at <= to AND last_activity_at >= from`, not
 * "created in the window", and the two halves do different jobs. The upper
 * bound excludes items raised after the window. The lower bound is exactly "had
 * some activity in the window", because appending to the thread bumps
 * `last_activity_at` (0001's entry_updates_touch_trg) — which is what
 * GUARANTEES every update returned below has its parent in `entries`, so the
 * timeline can always name the item an update is about. A "created in the
 * window" bound would return orphan sentences.
 *
 * Both queries filter on the track's CURRENT `track_id`, so they describe the
 * same set of items: an entry moved to another track yesterday drops out of
 * both halves together rather than leaving its updates behind.
 *
 * Closed entries are included on purpose. "What happened here last month" has
 * to include the things that got finished; excluding them would make a
 * productive month look empty.
 */
export async function loadTrackTimeline(
  trackId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<ApiResult<TrackTimelineRows>> {
  if (!supabase) return notConfigured()
  // Captured after the guard so the closures below need no re-check: `supabase`
  // is a module-level const, but a local makes the narrowing unambiguous to
  // every reader as well as to the compiler.
  const db = supabase

  const toExclusive = addDays(to, 1)

  const entriesPage = await fetchAllPages((offset, size) =>
    db
      .from('entries')
      .select('*')
      .eq('track_id', trackId)
      .lt('created_at', toExclusive)
      .gte('last_activity_at', from)
      // Newest first, with id as the total tiebreak: rows written by one
      // statement share a created_at to the microsecond, and without it the
      // page boundary would land in a different place on every request and drop
      // or duplicate rows across pages.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + size - 1),
  )
  if (!entriesPage.ok) return entriesPage

  const updatesPage = await fetchAllPages((offset, size) =>
    db
      .from('entry_updates')
      // The inner join, and the reason this module needs no view.
      .select('*, entries!inner(track_id)')
      .eq('entries.track_id', trackId)
      .gte('created_at', from)
      .lt('created_at', toExclusive)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + size - 1),
  )
  if (!updatesPage.ok) return updatesPage

  return {
    ok: true,
    data: {
      entries: entriesPage.data.rows as Entry[],
      updates: (updatesPage.data.rows as JoinedUpdateRow[]).map(toEntryUpdate),
      truncated: entriesPage.data.truncated || updatesPage.data.truncated,
    },
  }
}
