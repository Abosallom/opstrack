// Data access for entries and the update thread — the NARROWED loader surface.
//
// WHY THE SURFACE IS THIS SMALL. The old listEntries() took a filter and built a
// query. It doesn't any more, and neither does anything else here: the dataset
// is a small trusted team's ops log (low thousands of rows, full read visibility
// under RLS), so the app does ONE working-set fetch and filters on the client
// through lib/entryFilter.ts. That decision is what stops five screens growing
// five query builders that disagree about what "mine" means.
//
// THE THREE CORRECTIONS OF EXECUTION-PLAN §2.4, APPLIED:
//
//  1. `description: input.description ?? ''`, NOT `?? null`. The column is
//     `not null default ''` (0001:304), so the old coalesce was a guaranteed
//     23502 on every create. It never fired only because nothing called
//     createEntry() yet. toEntryRow() below is the single place that decides
//     this, and entries.test.ts asserts it — the bug is cheap to reintroduce by
//     hand and free to catch by test.
//  2. Every failure returns `pgErrorKey(error)`, never `error.message`. Raw
//     Postgres English lands an untranslated sentence in an RTL layout, and the
//     useful half of it is a constraint identifier the user has never heard of.
//  3. An RLS-blocked UPDATE returns ZERO ROWS, which `.select().single()` turns
//     into PGRST116 — pgErrorKey() maps that to `entry.errNotYours`, so the
//     member who dragged someone else's card is told why instead of being shown
//     a generic failure after it snapped back.
//
// WRITES ARE CALLED ONLY BY THE WRITE SEAM (store/entries.ts's transport, and
// store/outbox.ts once it is live). No screen calls them directly; that is what
// makes the Wave-4 offline retrofit one file instead of a dozen.
//
// ROW MAPPING LIVES IN toEntryRow()/toEntryPatchRow(), exported for tests. They
// are the boundary this file's header promises: camelCase view-models in,
// snake_case columns out, with every not-null column coalesced and the owner
// XOR the DB enforces resolved once rather than at each of the call sites.

import { supabase } from './supabase'
import { fail, notConfigured } from './result'
import { pgErrorKey } from '../lib/pgError'
import { CLOSED_STATUSES } from '../lib/health'
import { addDays } from '../lib/dates'
import type { ApiResult } from './result'
import type { IsoDate } from '../lib/dates'
import type {
  Entry,
  EntryHealth,
  EntryPatch,
  EntryStatus,
  EntryUpdate,
  NewEntry,
  NewEntryUpdate,
} from '../types'

// Re-exported so `import type { ApiResult } from '../api/entries'` keeps
// resolving. Forwarding one type is cheaper than a find-and-replace.
export type { ApiResult }

// The three write view-models moved to src/types.ts during the Wave-1
// integration: `lib/capture/parse.ts` returns a NewEntry, and contracts rule 2
// forbids `src/lib/**` importing from `src/api/**`, so a type living here made
// the parser reach across a layer the standing grep exists to police. They are
// re-exported because every other call site already imports them from this
// module and moving a type should not move a hundred import lines.
export type { EntryPatch, NewEntry, NewEntryUpdate }

/**
 * The ceiling on any single unbounded read.
 *
 * The working-set decision assumes low thousands of rows; this is the guard
 * against the day that assumption stops holding, so a runaway table degrades
 * into "the newest 1000 items" instead of a multi-megabyte response on a phone.
 * If a screen ever legitimately needs more, it needs a windowed loader, not a
 * bigger number here.
 *
 * 1000 IS NOT A PREFERENCE — IT IS POSTGREST'S. The live project reports
 * `max_rows: 1000`, and PostgREST applies it AFTER any `.limit()`, silently:
 * the response is a 200 with fewer rows and a `Content-Range` nobody was
 * reading. The old 2000 was therefore unreachable, and worse than unreachable —
 * it made every consumer believe a full read had happened. Raising this number
 * changes nothing until the server's `db-max-rows` is raised too.
 */
const MAX_ROWS = 1000

/**
 * A read that could have been clipped, and whether it was.
 *
 * WHY THE LOADERS DO NOT JUST RETURN ARRAYS ANY MORE. Truncation here is not an
 * error and not an empty result — it is a correct-looking answer that is
 * missing rows, which is the only failure mode in this file that can corrupt
 * the app's behaviour rather than interrupt it. Past the ceiling, entries and
 * health stop describing the same set of rows, every uncovered row counts as
 * stale, and the store falls back to the client health mirror on every commit,
 * permanently and with no symptom. Making the flag part of the return type is
 * what stops the next loader from forgetting to ask.
 */
export interface Loaded<T> {
  rows: T[]
  /** The response came back at the ceiling, so there are probably more. */
  truncated: boolean
}

/**
 * Wrap rows with the truncation verdict.
 *
 * `length >= limit` rather than a `count: 'exact'` round trip: the count would
 * add a full scan to the app's hottest read to answer a question that only
 * matters at the boundary, and at the boundary this is exactly right. A table
 * holding precisely `limit` rows reports truncated — a false positive that
 * costs one banner and resolves itself on the next write.
 */
function loaded<T>(rows: T[], limit: number = MAX_ROWS): Loaded<T> {
  return { rows, truncated: rows.length >= limit }
}

/**
 * How many entry ids fit in one `.in()` filter.
 *
 * PostgREST takes filters in the query string, and a uuid costs ~37 bytes there.
 * A digest window of 400 entries would build an 15 KB URL and be rejected by a
 * proxy long before Postgres saw it, so listUpdatesFor() chunks instead.
 */
const ID_CHUNK = 150

/** The `status not in (...)` list, as PostgREST wants it. */
const CLOSED_LIST = `(${CLOSED_STATUSES.join(',')})`

/** The id of the signed-in user, or null when the session has gone. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  // getSession() reads the persisted session; getUser() round-trips to
  // /auth/v1/user on every call. Capture has to be able to insert without
  // paying a network hop first, and the id is the same either way.
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

// ── health & recurrence ────────────────────────────────────────────────────

/**
 * Cheapest possible round-trip that proves credentials, network, RLS and the
 * schema all line up. `head: true` asks PostgREST for the count only, so this
 * stays a few hundred bytes even once tracks has rows.
 */
export async function healthCheck(): Promise<ApiResult<true>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('tracks').select('id', { head: true, count: 'exact' })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: true }
}

/**
 * Create any recurring entries that have come due, returning how many were
 * inserted. pg_cron runs the same function nightly, but it is unavailable on
 * some Supabase tiers, so the app calls it on load as the actual safety net.
 * Running both is a no-op — the (template_id, due_date) unique index absorbs
 * the second pass.
 */
export async function materializeRecurring(): Promise<ApiResult<number>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('materialize_due_recurring')
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: typeof data === 'number' ? data : 0 }
}

// ── loaders ────────────────────────────────────────────────────────────────

/**
 * Retained ONLY as the shape `filterToParams()` round-trips through. It is no
 * longer a query-builder input and no loader accepts it; see the header.
 */
export interface EntryFilter {
  trackId?: string
  status?: EntryStatus[]
  ownerId?: string
  ownerName?: string
  openOnly?: boolean
  limit?: number
}

/**
 * The working set: open entries by default, `last_activity_at` desc.
 *
 * The second sort key is not decoration. `last_activity_at` ties on every row a
 * bulk commit or a seed script wrote in the same statement, and without a stable
 * tiebreak those rows reshuffle between loads — which reads as data moving on
 * its own.
 */
export async function listEntries(opts?: {
  openOnly?: boolean
  limit?: number
}): Promise<ApiResult<Loaded<Entry>>> {
  if (!supabase) return notConfigured()
  const limit = Math.min(opts?.limit ?? MAX_ROWS, MAX_ROWS)
  let query = supabase
    .from('entries')
    .select('*')
    // THIS ORDER IS PART OF THE CONTRACT WITH listHealth(). Both reads are
    // clipped at the same ceiling, so they only describe the same rows if they
    // agree on which rows come first — see that function.
    .order('last_activity_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (opts?.openOnly !== false) query = query.not('status', 'in', CLOSED_LIST)
  const { data, error } = await query
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: loaded((data ?? []) as Entry[], limit) }
}

/**
 * Closed entries load on demand — the dashboard and the digest ask; lists do not.
 *
 * Filtered on `closed_at`, which the entries_set_closed_at() trigger maintains
 * in both directions (0001), rather than on `updated_at`: a tag cleanup on a
 * six-month-old done item is not that item becoming recently closed.
 */
export async function listClosedSince(since: IsoDate): Promise<ApiResult<Entry[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .in('status', [...CLOSED_STATUSES])
    .gte('closed_at', since)
    .order('closed_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(MAX_ROWS)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as Entry[] }
}

/**
 * `v_entry_health`, one row per OPEN entry. Fetched alongside listEntries().
 *
 * The two SLA columns are coalesced here rather than trusted: 0003 adds them to
 * the view, and a client deployed against a project that has not run 0003 yet
 * would otherwise hand every consumer `undefined` where EntryHealth promises
 * `null | boolean`. `sla_breached === true` rather than truthiness, so a missing
 * column reads as "no SLA", never as a breach nobody agreed to.
 *
 * THE LIMIT AND THE ORDER ARE BOTH LOAD-BEARING, and this function had neither.
 * PostgREST clips at 1000 whether or not you ask, so an unordered read returned
 * an ARBITRARY thousand of the open rows — a different thousand from the one
 * listEntries() fetched. Every entry whose health row fell outside that
 * intersection looked uncovered, landed in derive()'s stale set, and drove the
 * client-side computeHealth mirror on every single commit for the rest of the
 * session, with no error and no way to notice. Ordering identically to
 * listEntries() makes the two windows the SAME window, so past the ceiling the
 * app is missing the same tail from both instead of disagreeing about the middle.
 */
export async function listHealth(): Promise<ApiResult<Loaded<EntryHealth>>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('v_entry_health')
    .select('*')
    .order('last_activity_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(MAX_ROWS)
  if (error) return fail(pgErrorKey(error))
  const rows = (data ?? []) as Partial<EntryHealth>[]
  return {
    ok: true,
    data: loaded(
      rows.map((row) => ({
        ...(row as EntryHealth),
        sla_due_at: row.sla_due_at ?? null,
        sla_breached: row.sla_breached === true,
      })),
    ),
  }
}

/**
 * One track's window, for the timeline: the entries that were alive in it and
 * the thread rows written inside it.
 *
 * The entry bound is `created_at <= to AND last_activity_at >= from`, not
 * "created in the window". An update appended on the 20th to an entry raised in
 * January belongs on the January entry's row, and a timeline that cannot name
 * the parent of an update is a list of orphan sentences. Since appending to the
 * thread bumps last_activity_at (0001's entry_updates_touch_trg), that bound is
 * exactly "had any activity in the window", and it guarantees every update
 * returned below has its parent in `entries`.
 */
export async function listTrackHistory(
  trackId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<ApiResult<{ entries: Entry[]; updates: EntryUpdate[] }>> {
  if (!supabase) return notConfigured()
  // `to` is an inclusive CALENDAR day and the columns are timestamptz, so the
  // bound is the exclusive start of the next day. Day boundaries land on the
  // server's UTC midnight, the same ±1 day drift lib/dates.ts documents and
  // accepts for every other age question in the app.
  const toExclusive = addDays(to, 1)
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('track_id', trackId)
    .lt('created_at', toExclusive)
    .gte('last_activity_at', from)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS)
  if (error) return fail(pgErrorKey(error))

  const entries = (data ?? []) as Entry[]
  if (entries.length === 0) return { ok: true, data: { entries, updates: [] } }

  const updates = await listUpdatesFor(
    entries.map((e) => e.id),
    from,
  )
  if (!updates.ok) return updates
  return {
    ok: true,
    data: { entries, updates: updates.data.filter((u) => u.created_at < toExclusive) },
  }
}

/** One entry's thread, OLDEST FIRST — it renders as a conversation, not a feed. */
export async function listUpdates(entryId: string): Promise<ApiResult<EntryUpdate[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('entry_updates')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAX_ROWS)
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data ?? []) as EntryUpdate[] }
}

/**
 * Batched — THE digest's N+1 avoidance. One `.in('entry_id', ids)` per chunk,
 * newest first, not one query per entry across a hundred-entry window.
 *
 * An empty id list short-circuits: `.in('entry_id', [])` is a malformed filter,
 * not an empty result, and the digest legitimately reaches this with nothing to
 * ask about on a quiet week.
 */
export async function listUpdatesFor(
  entryIds: string[],
  since?: IsoDate,
): Promise<ApiResult<EntryUpdate[]>> {
  if (!supabase) return notConfigured()
  if (entryIds.length === 0) return { ok: true, data: [] }

  const out: EntryUpdate[] = []
  for (let i = 0; i < entryIds.length; i += ID_CHUNK) {
    const chunk = entryIds.slice(i, i + ID_CHUNK)
    let query = supabase
      .from('entry_updates')
      .select('*')
      .in('entry_id', chunk)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)
    if (since) query = query.gte('created_at', since)
    const { data, error } = await query
    if (error) return fail(pgErrorKey(error))
    out.push(...((data ?? []) as EntryUpdate[]))
  }
  // Chunking splits one ordered read into several, so the concatenation is
  // ordered only within a chunk. Re-sort rather than leave the caller to
  // discover that the "ordered desc" in this function's name got qualified.
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  return { ok: true, data: out }
}

/** Resolves to `null` data when no such entry is visible to this user. */
export async function getEntry(id: string): Promise<ApiResult<Entry | null>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.from('entries').select('*').eq('id', id).maybeSingle()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: (data as Entry | null) ?? null }
}

// ── writes (called only by the write seam) ─────────────────────────────────

/**
 * NewEntry → the `entries` row. Pure; exported for tests.
 *
 * Three decisions live here and nowhere else:
 *
 *  - `description` coalesces to '' because the column is `not null default ''`.
 *    This is correction 1 of §2.4, and the reason it is a named function with a
 *    test rather than a line inside createEntry().
 *  - The owner XOR (`entries_single_owner`, 0001:327) is resolved rather than
 *    passed through: an owner_id wins and blanks owner_name, so a caller that
 *    supplies both — the parser can, when a free-text name later resolves to a
 *    teammate — gets a legal row instead of a 23514.
 *  - `created_by` is written explicitly because `entries_insert` checks
 *    `created_by = auth.uid()`; there is no column default doing it for us, so
 *    an anonymous insert is a 42501, not a row with a null author.
 */
export function toEntryRow(input: NewEntry, createdBy: string | null): Record<string, unknown> {
  const ownerId = input.ownerId ?? null
  return {
    title: input.title.trim(),
    track_id: input.trackId ?? null,
    description: input.description ?? '',
    type: input.type ?? 'action',
    status: input.status ?? 'new',
    priority: input.priority ?? 'medium',
    owner_id: ownerId,
    owner_name: ownerId ? null : (input.ownerName ?? null),
    requester: input.requester ?? null,
    due_date: input.dueDate ?? null,
    follow_up_date: input.followUpDate ?? null,
    tags: input.tags ?? [],
    links: input.links ?? [],
    meeting_id: input.meetingId ?? null,
    template_id: input.templateId ?? null,
    created_by: createdBy,
  }
}

/**
 * EntryPatch → the columns to write. Pure; exported for tests.
 *
 * Absent keys stay absent — a patch of `{ status }` must not blank the
 * description by sending a default for it. Present keys are normalised the same
 * way toEntryRow() normalises them, including the null→'' coalesce for the
 * moment the sheet clears the description field, and the owner XOR in BOTH
 * directions: assigning a teammate clears the vendor name, and typing a vendor
 * name clears the teammate, so reassignment never leaves two owners on a row.
 */
export function toEntryPatchRow(patch: EntryPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title.trim()
  if (patch.description !== undefined) row.description = patch.description ?? ''
  if (patch.type !== undefined) row.type = patch.type
  if (patch.status !== undefined) row.status = patch.status
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.requester !== undefined) row.requester = patch.requester
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate
  if (patch.followUpDate !== undefined) row.follow_up_date = patch.followUpDate
  if (patch.tags !== undefined) row.tags = patch.tags
  if (patch.links !== undefined) row.links = patch.links
  if (patch.trackId !== undefined) row.track_id = patch.trackId

  if (patch.ownerId !== undefined) {
    row.owner_id = patch.ownerId
    if (patch.ownerId) row.owner_name = null
  }
  if (patch.ownerName !== undefined) {
    row.owner_name = patch.ownerName
    if (patch.ownerName) row.owner_id = null
  }
  return row
}

export async function createEntry(input: NewEntry): Promise<ApiResult<Entry>> {
  if (!supabase) return notConfigured()
  if (!input.title.trim()) return fail('common.error')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const { data, error } = await supabase
    .from('entries')
    .insert(toEntryRow(input, userId))
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as Entry }
}

/**
 * Patch an entry. When the status actually changes, an entry_updates row
 * recording the transition is appended — the audit thread is the only place
 * status history exists, and a silent status flip is exactly what this app is
 * meant to make impossible.
 *
 * The transition row is written HERE rather than by a database trigger so it
 * carries the acting user as author_id under the same RLS as a hand-typed
 * update; 0001:476 says the same thing from the other side. If a trigger is ever
 * added for this, delete that branch — you would otherwise get two rows per
 * transition.
 *
 * The pre-read is what makes "actually changes" true rather than assumed: a
 * board drop onto the column an item is already in must not write a
 * blocked → blocked row into an append-only thread nobody can clean up.
 */
export async function updateEntry(id: string, patch: EntryPatch): Promise<ApiResult<Entry>> {
  if (!supabase) return notConfigured()
  const row = toEntryPatchRow(patch)

  // A no-op PATCH comes back with zero rows and .single() then errors on a
  // request that did nothing wrong. Read the row back instead.
  if (Object.keys(row).length === 0) return getRequired(id)

  let statusFrom: EntryStatus | null = null
  if (patch.status !== undefined) {
    const before = await supabase.from('entries').select('status').eq('id', id).maybeSingle()
    if (before.error) return fail(pgErrorKey(before.error))
    const prev = (before.data as { status: EntryStatus } | null)?.status ?? null
    if (prev && prev !== patch.status) statusFrom = prev
  }

  const { data, error } = await supabase
    .from('entries')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  const entry = data as Entry

  if (statusFrom) {
    const appended = await addUpdate({
      entryId: id,
      body: '',
      statusFrom,
      statusTo: entry.status,
    })
    // Deliberately NOT fatal. The status change is already durable; returning a
    // failure here would make the caller roll back a change the server
    // accepted, and the visible result of that is a card that moves, snaps back,
    // and is nonetheless moved after a refresh. Losing the thread row is the
    // smaller wrong, and it is loud in the console.
    if (!appended.ok) {
      console.warn('[entries] status transition row not written for', id, appended.error)
    }
  }

  return { ok: true, data: entry }
}

/** The read-back path for an empty patch: the row must exist, so null is a failure. */
async function getRequired(id: string): Promise<ApiResult<Entry>> {
  const result = await getEntry(id)
  if (!result.ok) return result
  if (!result.data) return fail('entry.errNotFound')
  return { ok: true, data: result.data }
}

/**
 * Append to an entry's thread. entry_updates has no UPDATE or DELETE policy —
 * immutability is enforced by RLS, so there is deliberately no editUpdate() or
 * deleteUpdate() counterpart here. Corrections are appended, never applied.
 *
 * `author_id` is explicit for the same reason `created_by` is on entries:
 * `entry_updates_insert` checks `author_id = auth.uid()`.
 */
export async function addUpdate(input: NewEntryUpdate): Promise<ApiResult<EntryUpdate>> {
  if (!supabase) return notConfigured()
  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const { data, error } = await supabase
    .from('entry_updates')
    .insert({
      entry_id: input.entryId,
      // `not null default ''`, and a transition row is legitimately bodiless.
      body: input.body ?? '',
      status_from: input.statusFrom ?? null,
      status_to: input.statusTo ?? null,
      author_id: userId,
    })
    .select('*')
    .single()
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: data as EntryUpdate }
}
