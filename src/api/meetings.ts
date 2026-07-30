// Meeting mode's I/O — the meeting header, its lines, and the bulk commit.
//
// ERRORS ARE i18n KEYS, per the tracks.ts pattern: every failure path returns
// `pgErrorKey(error)` (or a meeting-specific key) and every caller renders it
// through `t(result.error)`. Nothing here returns a Postgres sentence.
//
// ── THE ONE DESIGN DECISION THAT SHAPES THIS WHOLE FILE ────────────────────
//
// EVERY ID IS MINTED ON THE CLIENT. `meetings.id` and `meeting_lines.id` are
// both `uuid primary key default gen_random_uuid()`, and this module supplies
// the value instead of letting the default fire. That is not a preference:
//
//  · A live meeting is the one screen in the app where the user CANNOT simply
//    do it again. Plan §2.15 persists every line as typed for that reason. A
//    line whose identity only exists after the server replies cannot be edited,
//    re-stated or discarded during the second the reply takes, and cannot be
//    written at all while the room's wifi is down.
//  · With a real uuid from the first keystroke there is no temp-id dance in
//    meetings anywhere — no `TEMP_PREFIX`, no `dependsOn`, no id swap on
//    settle, and no "don't navigate to /meetings/temp_…" guard. A meeting
//    started offline gets a URL that stays valid, and the lines typed into it
//    carry a foreign key to a row that will exist by the time they drain,
//    because the outbox drains in insertion order and the meeting insert was
//    queued first.
//  · The alternative — the entries store's optimistic temp row — is right for
//    entries, where the row is one of hundreds in a list and its id is never in
//    a URL. It is the wrong trade here, and mixing both would be worse than
//    either.
//
// The same trick is used for the entries a bulk commit creates, for a different
// reason: it makes the line → entry mapping explicit instead of depending on a
// multi-row INSERT … RETURNING coming back in insertion order.
//
// ── WHAT `parsed` HOLDS ────────────────────────────────────────────────────
//
// `meeting_lines.parsed` is jsonb, and this file stores a LinePlan in it — not
// a whole ParsedEntry. The parser's output carries tokens with byte offsets and
// a problem list, all of which describe the moment of typing and none of which
// survive usefully into triage. A LinePlan is the small thing triage actually
// edits and commit actually reads, so the column doubles as the triage draft:
// close the tab mid-triage and the dropdowns come back where you left them.

import { supabase } from './supabase'
import { toEntryRow } from './entries'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'
import type { ParsedEntry } from '../lib/capture/parse'
import type {
  Entry,
  EntryPriority,
  EntryType,
  Meeting,
  MeetingLine,
  MeetingLineState,
  NewEntry,
} from '../types'

/**
 * The ceiling on any single read here, matching api/entries.ts.
 *
 * PostgREST clamps at 1000 whether or not you ask, and a truncated read arrives
 * as a 200 with fewer rows. Neither read below can realistically reach it — a
 * meeting with a thousand lines is not a meeting — so the ceiling is a guard
 * rather than a pager, and hitting it warns rather than silently lying.
 */
const MAX_ROWS = 1000

/** How many ids fit in one `.in()` filter before the URL gets refused. */
const ID_CHUNK = 150

/** How many row-at-a-time writes run concurrently in the commit fallback. */
const WRITE_CONCURRENCY = 6

/** The id of the signed-in user, or null when the session has gone. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  // getSession() reads the persisted session; getUser() round-trips. Appending
  // a line must not pay a network hop before the one it is actually making.
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/**
 * pgErrorKey, with the two codes that mean something different here.
 *
 * `meetings_update` is `created_by = auth.uid() or is_admin()`, so an RLS-blocked
 * PATCH comes back as zero rows → PGRST116, which pgErrorKey maps to
 * `entry.errNotYours` — the right shape of message, the wrong noun. 23505 on a
 * line is always the `(meeting_id, seq)` unique index and is retried, not shown.
 */
function meetingErrorKey(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'PGRST116') return 'meeting.errNotYours'
  return pgErrorKey(error)
}

/** Chunk an array so a long `.in()` filter cannot build an over-length URL. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Run `fn` over every item, `WRITE_CONCURRENCY` at a time, in order. */
async function pooled<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (const group of chunk(items, WRITE_CONCURRENCY)) {
    out.push(...(await Promise.all(group.map(fn))))
  }
  return out
}

// ── the line plan ──────────────────────────────────────────────────────────

/**
 * What a line will become — seeded by the parser at capture, edited in the
 * triage table, and stored in `meeting_lines.parsed`.
 *
 * `type` and `priority` are CONCRETE rather than nullable, unlike ParsedEntry's.
 * Triage is the moment a line stops being a guess: every row shows a real value
 * in its dropdown, "same as above" copies real values, and commit needs no
 * second layer of defaults. `trackId`, the owner pair and the two dates stay
 * nullable because "no track" and "nobody yet" are answers, not gaps.
 */
export interface LinePlan {
  title: string
  trackId: string | null
  type: EntryType
  priority: EntryPriority
  ownerId: string | null
  ownerName: string | null
  dueDate: string | null
  followUpDate: string | null
  tags: string[]
}

/** The defaults a line falls back to — the same ones capture applies. */
export const PLAN_DEFAULTS: Readonly<Pick<LinePlan, 'type' | 'priority'>> = Object.freeze({
  type: 'action',
  priority: 'medium',
})

/**
 * ParsedEntry → LinePlan.
 *
 * A recurrence is DROPPED rather than honoured: `every:weekly` in a meeting
 * describes a template, `toNewEntry()` refuses to turn one into an entry, and a
 * triage table that silently created a one-off from it would file the wrong row
 * in the wrong table. The words stay in the title, so nothing is lost and the
 * person triaging can see what was meant.
 */
export function planFromParsed(p: ParsedEntry): LinePlan {
  return {
    title: p.title.trim(),
    trackId: p.trackId,
    type: p.type ?? PLAN_DEFAULTS.type,
    priority: p.priority ?? PLAN_DEFAULTS.priority,
    ownerId: p.ownerId,
    // The XOR the DB enforces, resolved here so no later step has to.
    ownerName: p.ownerId ? null : p.ownerName,
    dueDate: p.dueDate,
    followUpDate: p.followUpDate,
    tags: p.tags,
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * jsonb → LinePlan, defensively.
 *
 * The column is `jsonb` with no shape constraint and rows written months ago by
 * an older build are legal contents, so every field is checked rather than cast.
 * A plan that decodes to an empty title falls back to the line's raw text, which
 * is the honest answer for a line captured before triage existed.
 */
export function decodePlan(parsed: unknown, rawFallback: string): LinePlan {
  const src = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >
  const ownerId = str(src.ownerId)
  const tags = Array.isArray(src.tags)
    ? src.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
  return {
    title: (str(src.title) ?? rawFallback).trim(),
    trackId: str(src.trackId),
    type: (str(src.type) as EntryType | null) ?? PLAN_DEFAULTS.type,
    priority: (str(src.priority) as EntryPriority | null) ?? PLAN_DEFAULTS.priority,
    ownerId,
    ownerName: ownerId ? null : str(src.ownerName),
    dueDate: str(src.dueDate),
    followUpDate: str(src.followUpDate),
    tags,
  }
}

/**
 * LinePlan → the jsonb payload.
 *
 * Spelled out as a literal rather than spread, because `Record<string, unknown>`
 * is what the column type wants and an interface is not assignable to it — and
 * because writing the field list here is the one place a future field addition
 * has to be noticed on both the encode and the decode side.
 */
export function planToJson(plan: LinePlan): Record<string, unknown> {
  return {
    title: plan.title,
    trackId: plan.trackId,
    type: plan.type,
    priority: plan.priority,
    ownerId: plan.ownerId,
    ownerName: plan.ownerName,
    dueDate: plan.dueDate,
    followUpDate: plan.followUpDate,
    tags: plan.tags,
  }
}

/** LinePlan → the create payload, linked to the meeting it came out of. */
export function planToNewEntry(plan: LinePlan, meetingId: string): NewEntry {
  return {
    title: plan.title,
    trackId: plan.trackId,
    description: '',
    type: plan.type,
    priority: plan.priority,
    ownerId: plan.ownerId,
    ownerName: plan.ownerId ? null : plan.ownerName,
    dueDate: plan.dueDate,
    followUpDate: plan.followUpDate,
    tags: plan.tags,
    meetingId,
    // status is deliberately unset: a line captured in a meeting starts at
    // `new`, exactly as a captured line does. Deciding something is already in
    // progress is a second thought.
  }
}

// ── meetings ───────────────────────────────────────────────────────────────

export interface NewMeeting {
  /** Client-minted uuid. Supply it; see this file's header. */
  id?: string
  title: string
  trackId: string | null
  /** Display names, not ids — the column is `text[]` so a vendor can attend. */
  attendees: string[]
}

/** What `patchMeeting` may change. Absent keys are left alone. */
export interface MeetingPatch {
  title?: string
  trackId?: string | null
  attendees?: string[]
  notes?: string
  /** ISO instant to end the meeting, or null to reopen it. */
  endedAt?: string | null
}

export async function createMeeting(input: NewMeeting): Promise<ApiResult<Meeting>> {
  if (!supabase) return notConfigured()
  const title = input.title.trim()
  if (!title) return fail('meeting.errTitleRequired')

  const userId = await currentUserId()
  // `meetings_insert` is `is_member() and created_by = auth.uid()`; there is no
  // column default doing this for us, so a null author is a 42501, not a row.
  if (!userId) return fail('common.notSignedIn')

  const row = {
    id: input.id ?? crypto.randomUUID(),
    title,
    track_id: input.trackId,
    attendees: input.attendees.map((a) => a.trim()).filter((a) => a !== ''),
    created_by: userId,
  }

  const { data, error } = await supabase.from('meetings').insert(row).select('*').single()
  if (error) return fail(meetingErrorKey(error))
  return { ok: true, data: data as Meeting }
}

/**
 * Patch a meeting. The outbox transport for `meetings:update`.
 *
 * RLS narrows this to the creator or an admin, so a second attendee ending
 * somebody else's meeting gets `meeting.errNotYours` rather than a silent no-op
 * — see meetingErrorKey.
 */
export async function patchMeeting(id: string, patch: MeetingPatch): Promise<ApiResult<Meeting>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title.trim()
  if (patch.trackId !== undefined) row.track_id = patch.trackId
  if (patch.attendees !== undefined) {
    row.attendees = patch.attendees.map((a) => a.trim()).filter((a) => a !== '')
  }
  // `notes` is `not null default ''`, so an emptied field is '' and never null.
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.endedAt !== undefined) row.ended_at = patch.endedAt

  if (Object.keys(row).length === 0) return getMeeting(id) as Promise<ApiResult<Meeting>>

  const { data, error } = await supabase
    .from('meetings')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(meetingErrorKey(error))
  return { ok: true, data: data as Meeting }
}

/** Close the meeting and store its notes. Plan §2.15's `endMeeting`. */
export function endMeeting(id: string, notes: string): Promise<ApiResult<Meeting>> {
  return patchMeeting(id, { notes, endedAt: new Date().toISOString() })
}

/**
 * Reopen a meeting that was ended too early.
 *
 * Additive to §2.15, and it earns its place: ending a meeting is one tap away
 * from the capture input, the room keeps talking after somebody presses it, and
 * the alternative is a second meeting row that splits one conversation's record
 * in two. Notes are left alone.
 */
export function resumeMeeting(id: string): Promise<ApiResult<Meeting>> {
  return patchMeeting(id, { endedAt: null })
}

export async function getMeeting(id: string): Promise<ApiResult<Meeting | null>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.from('meetings').select('*').eq('id', id).maybeSingle()
  if (error) return fail(meetingErrorKey(error))
  return { ok: true, data: (data as Meeting | null) ?? null }
}

/** Newest first. `started_at` has a matching index (0001). */
export async function listMeetings(limit = 50): Promise<ApiResult<Meeting[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .order('started_at', { ascending: false })
    // Ties are possible — two meetings started in the same millisecond by a
    // seed or an import — and without a second key the list reshuffles between
    // loads, which reads as data loss.
    .order('id', { ascending: true })
    .limit(Math.min(limit, MAX_ROWS))
  if (error) return fail(meetingErrorKey(error))
  return { ok: true, data: (data ?? []) as Meeting[] }
}

// ── lines ──────────────────────────────────────────────────────────────────

export interface NewMeetingLine {
  /** Client-minted uuid. Supply it; see this file's header. */
  id?: string
  meetingId: string
  /** Position within the meeting. The caller mints it from the last line it
   *  holds; a lost race is retried below rather than reported. */
  seq: number
  raw: string
  parsed: LinePlan | null
  state?: MeetingLineState
}

export type MeetingLinePatch = Partial<Pick<MeetingLine, 'raw' | 'state'>> & {
  /** Replace the stored plan, or clear it. Absent leaves it untouched. */
  parsed?: LinePlan | null
  /** Set by the commit path only. */
  entryId?: string | null
}

function lineRow(input: NewMeetingLine, userId: string): Record<string, unknown> {
  return {
    id: input.id ?? crypto.randomUUID(),
    meeting_id: input.meetingId,
    seq: input.seq,
    // `raw` is `not null default ''`; a whitespace-only line is still a line
    // somebody typed, so it is trimmed but not rejected here.
    raw: input.raw,
    parsed: input.parsed ? planToJson(input.parsed) : null,
    state: input.state ?? 'pending',
    created_by: userId,
  }
}

/**
 * Append one line. Plan §2.15's `appendLine`, widened to carry `seq` and the
 * client-minted id — neither of which the signature in the plan could express,
 * and `seq` is `not null` with a unique index so it was never optional.
 *
 * SEQ CONTENTION IS HANDLED HERE, NOT REPORTED. Two attendees typing at once
 * mint the same next seq from their own copies of the list; the loser gets
 * 23505 on `meeting_lines_seq_uidx`. That is a race the user has no part in and
 * cannot act on, so it is retried against the server's real maximum rather than
 * shown. Only a second failure surfaces.
 */
export async function appendLine(input: NewMeetingLine): Promise<ApiResult<MeetingLine>> {
  if (!supabase) return notConfigured()
  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const row = lineRow(input, userId)
  const first = await supabase.from('meeting_lines').insert(row).select('*').single()
  if (!first.error) return { ok: true, data: first.data as MeetingLine }

  if ((first.error as { code?: unknown }).code !== '23505') {
    return fail(meetingErrorKey(first.error))
  }

  const next = await nextSeq(input.meetingId)
  const retry = await supabase
    .from('meeting_lines')
    .insert({ ...row, seq: next })
    .select('*')
    .single()
  if (retry.error) return fail(meetingErrorKey(retry.error))
  return { ok: true, data: retry.data as MeetingLine }
}

/** The seq a new line should take. One row, index-only. */
export async function nextSeq(meetingId: string): Promise<number> {
  if (!supabase) return 1
  const { data } = await supabase
    .from('meeting_lines')
    .select('seq')
    .eq('meeting_id', meetingId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as { seq: number } | null
  return (row?.seq ?? 0) + 1
}

/**
 * Patch one line. `meeting_lines_update` is plain `is_member()` on purpose
 * (0004): triage is collaborative, so the person running the meeting fixes the
 * owner on a line somebody else typed while they type the next one.
 */
export async function patchLine(
  id: string,
  patch: MeetingLinePatch,
): Promise<ApiResult<MeetingLine>> {
  if (!supabase) return notConfigured()

  const row: Record<string, unknown> = {}
  if (patch.raw !== undefined) row.raw = patch.raw
  if (patch.state !== undefined) row.state = patch.state
  if (patch.parsed !== undefined) row.parsed = patch.parsed ? planToJson(patch.parsed) : null
  if (patch.entryId !== undefined) row.entry_id = patch.entryId

  if (Object.keys(row).length === 0) {
    const { data, error } = await supabase
      .from('meeting_lines')
      .select('*')
      .eq('id', id)
      .single()
    if (error) return fail(meetingErrorKey(error))
    return { ok: true, data: data as MeetingLine }
  }

  const { data, error } = await supabase
    .from('meeting_lines')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(meetingErrorKey(error))
  return { ok: true, data: data as MeetingLine }
}

/**
 * Every line of one meeting, in `seq` order.
 *
 * ORDERED BY SEQ, NEVER BY created_at. Two attendees typing at once produce
 * timestamps a millisecond apart, and a minutes document whose lines interleave
 * differently on every render is unusable as a record. 0004 says the same thing
 * from the other side, which is why the unique index is on `(meeting_id, seq)`.
 */
export async function listLines(meetingId: string): Promise<ApiResult<MeetingLine[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('meeting_lines')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('seq', { ascending: true })
    .limit(MAX_ROWS)
  if (error) return fail(meetingErrorKey(error))
  const rows = (data ?? []) as MeetingLine[]
  if (rows.length >= MAX_ROWS) {
    // Not an error and not renderable — a meeting cannot realistically reach a
    // thousand lines, so this is the tripwire for the day something else wrote
    // them, not a state the UI has a design for.
    console.warn('[meetings] listLines hit the row ceiling for', meetingId)
  }
  return { ok: true, data: rows }
}

/** How the lines of one meeting are split across the four states. */
export interface LineCounts {
  total: number
  pending: number
  note: number
  discarded: number
  committed: number
}

export function emptyLineCounts(): LineCounts {
  return { total: 0, pending: 0, note: 0, discarded: 0, committed: 0 }
}

/**
 * State tallies for a set of meetings, for the index list.
 *
 * ONE READ OF THREE NARROW COLUMNS, counted on the client, rather than a
 * per-meeting `count: 'exact'` head request — fifty meetings would otherwise be
 * fifty round trips to render one list. `id` rides along only so the row shape
 * stays debuggable in the network tab; nothing reads it.
 *
 * PostgREST's 1000-row ceiling applies and is the real limit here: past it the
 * oldest meetings in the window lose their badges, which is a missing badge and
 * not a wrong one, because a partial row set can only undercount a meeting the
 * clip cut through. The index caps its meeting list well below that.
 */
export async function listLineCounts(
  meetingIds: string[],
): Promise<ApiResult<Map<string, LineCounts>>> {
  if (!supabase) return notConfigured()
  const out = new Map<string, LineCounts>()
  if (meetingIds.length === 0) return { ok: true, data: out }

  for (const ids of chunk(meetingIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('meeting_lines')
      .select('id, meeting_id, state')
      .in('meeting_id', ids)
      .limit(MAX_ROWS)
    if (error) return fail(meetingErrorKey(error))
    for (const row of (data ?? []) as { meeting_id: string; state: MeetingLineState }[]) {
      const counts = out.get(row.meeting_id) ?? emptyLineCounts()
      counts.total += 1
      counts[row.state] += 1
      out.set(row.meeting_id, counts)
    }
  }
  return { ok: true, data: out }
}

// ── the bulk commit ────────────────────────────────────────────────────────

export interface CommitFailure {
  lineId: string
  /** i18n key. */
  error: string
}

export interface CommitReport {
  created: Entry[]
  failed: CommitFailure[]
}

/**
 * Turn triaged lines into entries linked to the meeting.
 *
 * PARTIAL SUCCESS IS REPORTED, NOT ROLLED BACK (plan §2.15). Twenty lines were
 * typed by a room full of people; discarding nineteen good ones because the
 * twentieth had no title would be the worst possible answer, and there is no
 * transaction available from PostgREST that would make "all or nothing" true
 * anyway.
 *
 * BATCH FIRST, THEN ROW BY ROW. The happy path is one INSERT for the whole
 * meeting — twenty rows, one round trip, one realtime batch. A batch is
 * all-or-nothing though, so a single bad row would report all twenty as failed,
 * which is exactly the outcome the paragraph above rejects. So a failed batch
 * falls back to per-line inserts, which cost N round trips and buy a truthful
 * per-line verdict. The fallback is the rare path by construction: triage
 * validates titles before it gets here.
 *
 * ENTRY IDS ARE MINTED HERE so the line → entry mapping is explicit. Relying on
 * a multi-row `INSERT … RETURNING` to come back in insertion order works today
 * and is not a promise PostgREST makes.
 *
 * @param plans the triage decisions, keyed by line id. A line with no entry
 *   here falls back to the plan stored in its own `parsed` column, which is
 *   what makes committing from a freshly reloaded tab work.
 */
export async function commitMeetingLines(
  meetingId: string,
  lineIds: string[],
  plans?: ReadonlyMap<string, LinePlan>,
): Promise<ApiResult<CommitReport>> {
  if (!supabase) return notConfigured()
  if (lineIds.length === 0) return { ok: true, data: { created: [], failed: [] } }

  // Bound once. TypeScript's narrowing of the module-level `supabase` does not
  // survive into the async closures `pooled()` runs, and re-guarding inside each
  // of them would be four copies of a check that is already true.
  const db = supabase

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  // Read the lines back rather than trusting the caller's list: it supplies the
  // raw text a plan-less line falls back to, and the `meeting_id` filter is what
  // stops a stale tab committing a line into the wrong meeting.
  const lines: MeetingLine[] = []
  for (const ids of chunk(lineIds, ID_CHUNK)) {
    const { data, error } = await db
      .from('meeting_lines')
      .select('*')
      .eq('meeting_id', meetingId)
      .in('id', ids)
      .order('seq', { ascending: true })
    if (error) return fail(meetingErrorKey(error))
    lines.push(...((data ?? []) as MeetingLine[]))
  }

  const failed: CommitFailure[] = []
  const targets: { lineId: string; entryId: string; row: Record<string, unknown> }[] = []

  for (const line of lines) {
    // Already committed by a second attendee while this tab was deciding. Not a
    // failure and not a second entry — the line is done.
    if (line.state === 'committed' && line.entry_id) continue

    const plan = plans?.get(line.id) ?? decodePlan(line.parsed, line.raw)
    if (plan.title.trim() === '') {
      failed.push({ lineId: line.id, error: 'meeting.errNoTitle' })
      continue
    }
    const entryId = crypto.randomUUID()
    targets.push({
      lineId: line.id,
      entryId,
      row: { ...toEntryRow(planToNewEntry(plan, meetingId), userId), id: entryId },
    })
  }

  // A line the caller named that came back from neither query is gone or belongs
  // to another meeting. Say so rather than silently dropping it.
  const seen = new Set(lines.map((l) => l.id))
  for (const id of lineIds) {
    if (!seen.has(id)) failed.push({ lineId: id, error: 'meeting.errLineGone' })
  }

  if (targets.length === 0) return { ok: true, data: { created: [], failed } }

  const created: Entry[] = []
  const linked: { lineId: string; entryId: string }[] = []

  const batch = await db
    .from('entries')
    .insert(targets.map((t) => t.row))
    .select('*')
  if (!batch.error) {
    created.push(...((batch.data ?? []) as Entry[]))
    linked.push(...targets.map((t) => ({ lineId: t.lineId, entryId: t.entryId })))
  } else {
    console.warn('[meetings] batch commit failed, falling back per line:', batch.error.message)
    const results = await pooled(targets, async (target) => {
      const one = await db.from('entries').insert(target.row).select('*').single()
      return { target, one }
    })
    for (const { target, one } of results) {
      if (one.error) {
        failed.push({ lineId: target.lineId, error: meetingErrorKey(one.error) })
        continue
      }
      created.push(one.data as Entry)
      linked.push({ lineId: target.lineId, entryId: target.entryId })
    }
  }

  // Mark the lines. `meeting_lines_update` is `is_member()`, so this is the
  // permissive half of the pair and failing here is genuinely unexpected — one
  // retry, then reported. A reported link failure means the entry EXISTS and the
  // line still reads as pending, so re-running the commit would duplicate it;
  // the caller's toast says which lines to check, which is the honest answer
  // available without a transaction.
  const linkFailures = await pooled(linked, async ({ lineId, entryId }) => {
    const patch = { state: 'committed' as const, entry_id: entryId }
    const first = await db.from('meeting_lines').update(patch).eq('id', lineId)
    if (!first.error) return null
    const retry = await db.from('meeting_lines').update(patch).eq('id', lineId)
    return retry.error ? { lineId, error: 'meeting.errLink' } : null
  })
  for (const f of linkFailures) if (f) failed.push(f)

  return { ok: true, data: { created, failed } }
}
