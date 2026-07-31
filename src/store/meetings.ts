// Meeting mode's state: the meeting list, one meeting's lines, and the triage
// drafts that sit on top of them.
//
// Shaped like store/config.ts — narrow selector hooks, derived views computed
// ONCE when data lands rather than inside a selector, a single in-flight promise
// per loader. The derived-in-selector hazard is the expensive one: a selector
// that builds an array or a Map on each call returns a new reference every
// render, which under useSyncExternalStore means "the snapshot changed" forever.
// config.ts's header documents it; every read below returns something already
// stored.
//
// WRITES GO THROUGH A SWAPPABLE SEAM, exactly like store/entries.ts. The default
// transport sends straight to api/meetings; main.tsx points it at
// store/outbox.submit() so a line typed with the wifi down QUEUES instead of
// failing. The seam exists rather than a direct import because store/outbox.ts
// belongs to another worker this wave (§1.0.4) and because the composition root
// is where a swappable transport belongs.
//
// THE ONE WRITE THAT DOES NOT GO THROUGH IT is the bulk commit. Plan §2.3 says
// so — "meeting triage commits server-side; see api/meetings.commitMeetingLines"
// — and the reason is that a twenty-row insert with per-row partial success is
// not a replayable envelope: `MutOp` carries one target and one payload, and an
// op that half-succeeded has no honest state to be re-queued in. Committing
// while offline is refused with a message instead of being silently deferred
// into something that would duplicate entries on drain.
//
// NO TEMP IDS ANYWHERE. api/meetings.ts mints every uuid on the client (see its
// header), so an optimistic meeting and an optimistic line already carry the id
// the server will store. Nothing swaps ids on settle, `/meetings/<id>` is a
// valid URL from the first frame, and a line can be edited or discarded in the
// second before its insert lands.

import { create } from 'zustand'
import {
  appendLine as apiAppendLine,
  commitMeetingLines as apiCommitLines,
  createMeeting as apiCreateMeeting,
  decodePlan,
  emptyLineCounts,
  getMeeting as apiGetMeeting,
  listLineCounts as apiListLineCounts,
  listLines as apiListLines,
  listMeetings as apiListMeetings,
  patchLine as apiPatchLine,
  patchMeeting as apiPatchMeeting,
  planFromParsed,
  planToJson,
  type CommitReport,
  type LineCounts,
  type LinePlan,
  type MeetingLinePatch,
  type MeetingPatch,
  type NewMeeting,
  type NewMeetingLine,
} from '../api/meetings'
import { onRealtime, onRealtimeResync } from '../api/realtime'
import { fail, type ApiResult } from '../api/result'
import { toast } from '../components/toast'
import { t } from '../lib/i18n'
import { parse, type ParseContext } from '../lib/capture/parse'
import { applyServerRow } from './entries'
import { hasSession } from './auth'
import type { MutOp } from './outbox'
import type { Meeting, MeetingLine, MeetingLineState } from '../types'

/** What the outbox answers with when it queued a write instead of sending it. */
const QUEUED_KEY = 'offline.queued'

/** How long a meeting-list load stays fresh enough to skip a refetch. */
const STALE_AFTER_MS = 30_000

/**
 * How long a triage edit rests before it is written to `meeting_lines.parsed`.
 *
 * Long enough that dragging through a select or typing a date is one write, not
 * eight; short enough that "close the tab and come back" loses nothing a person
 * would notice. Every commit flushes these first, so the debounce can never
 * race the thing it exists to make cheap.
 */
const PLAN_SAVE_MS = 600

function nowIso(): string {
  return new Date().toISOString()
}

// ── state ──────────────────────────────────────────────────────────────────

interface MeetingsState {
  /** Newest first. */
  meetings: Meeting[]
  /** Precomputed id → meeting, stable by reference. */
  byId: Map<string, Meeting>
  loading: boolean
  loadedAt: number | null
  /** i18n KEY, never a sentence. */
  error: string | null

  /** meetingId → its lines, `seq` ascending. */
  lines: Map<string, MeetingLine[]>
  linesLoading: Set<string>
  linesLoadedAt: Map<string, number>
  /** meetingId → i18n key. */
  linesError: Map<string, string>
  /** meetingId → its state tally, for the index badges. */
  counts: Map<string, LineCounts>

  /** lineId → the triage draft, seeded from the row's stored plan. */
  plans: Map<string, LinePlan>
  /** Line ids with a write in flight — the row shows a quiet busy state. */
  saving: Set<string>
  /** Meeting ids whose bulk commit is running. */
  committing: Set<string>
}

/** Shared empties, so an unloaded meeting's reads are reference-stable. */
const EMPTY_LINES: MeetingLine[] = []
const EMPTY_COUNTS: LineCounts = Object.freeze(emptyLineCounts())

/**
 * Recount one meeting from the lines this tab holds.
 *
 * The index's badges come from `listLineCounts` — one narrow read for the whole
 * list — but the moment a meeting's lines are actually loaded, THOSE are the
 * truth, and a badge that still says "3 to triage" after you triaged all three
 * is the kind of wrong that makes a user distrust every other number on the
 * screen. Recomputed on write rather than in the selector, because a selector
 * that builds an object returns a new reference every render.
 */
function tally(lines: readonly MeetingLine[]): LineCounts {
  const counts = emptyLineCounts()
  for (const line of lines) {
    counts.total += 1
    counts[line.state] += 1
  }
  return counts
}

/**
 * The triage debounce's two module-level registers, declared up here because
 * both the local mutation helpers and the loaders read `unsaved` to decide
 * whether a server row may overwrite a draft.
 *
 * `planTimers`: lineId → the pending write's timer handle.
 * `unsaved`: line ids whose draft has been edited and not yet written.
 */
const planTimers = new Map<string, number>()
const unsaved = new Set<string>()

function deriveMeetings(meetings: Meeting[]): Pick<MeetingsState, 'meetings' | 'byId'> {
  return { meetings, byId: new Map(meetings.map((m) => [m.id, m])) }
}

const useMeetingsStore = create<MeetingsState>(() => ({
  ...deriveMeetings([]),
  loading: false,
  loadedAt: null,
  error: null,
  lines: new Map(),
  linesLoading: new Set(),
  linesLoadedAt: new Map(),
  linesError: new Map(),
  counts: new Map(),
  plans: new Map(),
  saving: new Set(),
  committing: new Set(),
}))

// ── selectors ──────────────────────────────────────────────────────────────

export function useMeetings(): Meeting[] {
  return useMeetingsStore((s) => s.meetings)
}

export function useMeeting(id: string | null | undefined): Meeting | undefined {
  return useMeetingsStore((s) => (id ? s.byId.get(id) : undefined))
}

export function useMeetingsLoading(): boolean {
  return useMeetingsStore((s) => s.loading)
}

/** i18n key, or null. */
export function useMeetingsError(): string | null {
  return useMeetingsStore((s) => s.error)
}

export function useMeetingLines(meetingId: string | null | undefined): MeetingLine[] {
  return useMeetingsStore((s) => (meetingId ? (s.lines.get(meetingId) ?? EMPTY_LINES) : EMPTY_LINES))
}

export function useLinesLoading(meetingId: string | null | undefined): boolean {
  return useMeetingsStore((s) => (meetingId ? s.linesLoading.has(meetingId) : false))
}

/** i18n key, or null. */
export function useLinesError(meetingId: string | null | undefined): string | null {
  return useMeetingsStore((s) => (meetingId ? (s.linesError.get(meetingId) ?? null) : null))
}

/** The state tally for one meeting. Zeroes until something has counted it. */
export function useLineCounts(meetingId: string): LineCounts {
  return useMeetingsStore((s) => s.counts.get(meetingId) ?? EMPTY_COUNTS)
}

export function useLinePlan(lineId: string): LinePlan | undefined {
  return useMeetingsStore((s) => s.plans.get(lineId))
}

export function useLineSaving(lineId: string): boolean {
  return useMeetingsStore((s) => s.saving.has(lineId))
}

export function useCommitting(meetingId: string | null | undefined): boolean {
  return useMeetingsStore((s) => (meetingId ? s.committing.has(meetingId) : false))
}

/** Non-React read, for the write paths below and for tests. */
export function getMeetingsSnapshot(): {
  meetings: readonly Meeting[]
  lines: ReadonlyMap<string, MeetingLine[]>
  plans: ReadonlyMap<string, LinePlan>
} {
  const s = useMeetingsStore.getState()
  return { meetings: s.meetings, lines: s.lines, plans: s.plans }
}

// ── the write seam ─────────────────────────────────────────────────────────

export type SubmitFn = <T>(op: MutOp) => Promise<ApiResult<T>>

/**
 * The default transport: send now, straight to api/meetings.
 *
 * Shaped as a `table:op` registry rather than four direct calls so that swapping
 * it for store/outbox.ts's registry is a substitution, not a translation — the
 * two tables have to stay recognisably the same table.
 */
async function directSubmit<T>(op: MutOp): Promise<ApiResult<T>> {
  const route = `${op.table}:${op.op}`
  switch (route) {
    case 'meetings:insert':
      return (await apiCreateMeeting(op.payload as NewMeeting)) as ApiResult<T>
    case 'meetings:update':
      // An update with no target is a caller bug, and sending '' would reach
      // Postgres as a malformed uuid (22P02) — a confusing way to learn it.
      if (!op.id) return fail('common.error')
      return (await apiPatchMeeting(op.id, op.payload as MeetingPatch)) as ApiResult<T>
    case 'meeting_lines:insert':
      return (await apiAppendLine(op.payload as NewMeetingLine)) as ApiResult<T>
    case 'meeting_lines:update':
      if (!op.id) return fail('common.error')
      return (await apiPatchLine(op.id, op.payload as MeetingLinePatch)) as ApiResult<T>
    default:
      console.warn('[meetings] no transport for', route)
      return fail('common.error')
  }
}

let submitFn: SubmitFn = directSubmit

/**
 * Swap the transport. main.tsx calls `setMeetingsSubmit(submit)`; passing null
 * restores direct send, which is what a test and a credential-less dev harness
 * want.
 */
export function setMeetingsSubmit(fn: SubmitFn | null): void {
  submitFn = fn ?? directSubmit
}

/**
 * The collapse key convention from §2.2: `table:op:id:sortedPayloadKeys`.
 *
 * Two edits of the same line's state collapse; a state change and a text edit do
 * not, because the payload key sets differ.
 */
function dedupeKeyFor(table: MutOp['table'], op: MutOp['op'], id: string, payload: unknown): string {
  const keys =
    typeof payload === 'object' && payload !== null
      ? Object.keys(payload as Record<string, unknown>)
          .sort()
          .join(',')
      : ''
  return `${table}:${op}:${id}:${keys}`
}

// ── local mutation helpers ─────────────────────────────────────────────────

function putMeeting(row: Meeting): void {
  const s = useMeetingsStore.getState()
  const without = s.meetings.filter((m) => m.id !== row.id)
  const next = [...without, row].sort((a, b) =>
    a.started_at === b.started_at
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.started_at < b.started_at
        ? 1
        : -1,
  )
  useMeetingsStore.setState(deriveMeetings(next))
}

function dropMeeting(id: string): void {
  const s = useMeetingsStore.getState()
  useMeetingsStore.setState(deriveMeetings(s.meetings.filter((m) => m.id !== id)))
}

/** Replace or insert one line, keeping the meeting's list in `seq` order. */
function putLine(row: MeetingLine, seedPlan: boolean): void {
  const s = useMeetingsStore.getState()
  const current = s.lines.get(row.meeting_id) ?? EMPTY_LINES
  const without = current.filter((l) => l.id !== row.id)
  const next = [...without, row].sort((a, b) => (a.seq === b.seq ? (a.id < b.id ? -1 : 1) : a.seq - b.seq))
  const lines = new Map(s.lines).set(row.meeting_id, next)

  // Seed or refresh the triage draft, but never over an edit that has not been
  // written yet — the debounce below owns those until it flushes.
  const plans =
    seedPlan && !unsaved.has(row.id)
      ? new Map(s.plans).set(row.id, decodePlan(row.parsed, row.raw))
      : s.plans
  useMeetingsStore.setState({
    lines,
    plans,
    counts: new Map(s.counts).set(row.meeting_id, tally(next)),
  })
}

function dropLine(meetingId: string, lineId: string): void {
  const s = useMeetingsStore.getState()
  const current = s.lines.get(meetingId)
  if (!current) return
  const next = current.filter((l) => l.id !== lineId)
  const lines = new Map(s.lines).set(meetingId, next)
  const plans = new Map(s.plans)
  plans.delete(lineId)
  useMeetingsStore.setState({
    lines,
    plans,
    counts: new Map(s.counts).set(meetingId, tally(next)),
  })
}

function markSaving(lineId: string, busy: boolean): void {
  const s = useMeetingsStore.getState()
  if (s.saving.has(lineId) === busy) return
  const saving = new Set(s.saving)
  if (busy) saving.add(lineId)
  else saving.delete(lineId)
  useMeetingsStore.setState({ saving })
}

function markCommitting(meetingId: string, busy: boolean): void {
  const s = useMeetingsStore.getState()
  const committing = new Set(s.committing)
  if (busy) committing.add(meetingId)
  else committing.delete(meetingId)
  useMeetingsStore.setState({ committing })
}

// ── loading ────────────────────────────────────────────────────────────────

let meetingsInFlight: Promise<void> | null = null

/**
 * Which session's reads are still allowed to write into this store.
 *
 * Bumped by resetMeetings(). Every loader captures `const mine = epoch` BEFORE
 * it awaits and writes nothing when `mine !== epoch` on the way back, exactly as
 * store/entries.ts does — clearing the state without it is a race the store
 * loses whenever someone signs out with a list or a line read on the wire: the
 * answer lands a moment later, re-fills `meetings` with the account that has
 * LEFT, and re-stamps `loadedAt`, which then short-circuits every load the next
 * account makes in this tab.
 *
 * The `.finally` blocks are gated for the same reason and it is not belt and
 * braces: `meetingsInFlight` and `linesInFlight` are re-populated by the next
 * account's loads, and a stale finally that cleared them would retire a live
 * request's dedupe entry.
 */
let epoch = 0

/**
 * Fetch the meeting list unless a good copy is already in hand.
 *
 * Never rejects and never throws: safe to call unawaited, safe to call from
 * three components mounting at once. Failures land in `error` as an i18n key.
 */
export function loadMeetings(force = false): Promise<void> {
  if (meetingsInFlight) return meetingsInFlight
  if (!force && useMeetingsStore.getState().loadedAt !== null) return Promise.resolve()

  // Only show the spinner when there is genuinely nothing to show; a refetch
  // must not blank the list the user is looking at.
  if (useMeetingsStore.getState().meetings.length === 0) {
    useMeetingsStore.setState({ loading: true })
  }

  const mine = epoch
  meetingsInFlight = apiListMeetings()
    .then((result) => {
      // Signed out while this was in flight — see `epoch`. The meetings in hand
      // belong to the account that has left.
      if (mine !== epoch) return
      if (!result.ok) {
        useMeetingsStore.setState({ error: result.error })
        return
      }
      // An empty list from an UNAUTHENTICATED read is not an answer — believing
      // it stamps `loadedAt` and short-circuits every load for the session.
      if (result.data.length === 0 && !hasSession()) return
      useMeetingsStore.setState({
        ...deriveMeetings(result.data),
        loadedAt: Date.now(),
        error: null,
      })
      // Badges follow the list, unawaited: the list is the screen and must not
      // wait on a decoration. A failed count leaves the badges blank rather
      // than the list empty, which is the right way round.
      void loadLineCounts(result.data.map((m) => m.id))
    })
    .finally(() => {
      // Not ours any more: `meetingsInFlight` now holds the NEXT account's read
      // and clearing it here would un-dedupe a live request.
      if (mine !== epoch) return
      meetingsInFlight = null
      useMeetingsStore.setState({ loading: false })
    })

  return meetingsInFlight
}

/**
 * Fill the index badges.
 *
 * A meeting whose lines this tab already holds keeps ITS OWN tally: those lines
 * are newer than any count query, and overwriting a live meeting's badge with a
 * number fetched a second ago would make it flicker backwards while somebody is
 * typing into it.
 */
export async function loadLineCounts(meetingIds: string[]): Promise<void> {
  if (meetingIds.length === 0) return
  const mine = epoch
  const result = await apiListLineCounts(meetingIds)
  // Signed out while this was in flight — see `epoch`. Badges for meetings the
  // next account may not even be able to read.
  if (mine !== epoch) return
  if (!result.ok) {
    console.warn('[meetings] line counts failed:', result.error)
    return
  }
  const s = useMeetingsStore.getState()
  const counts = new Map(s.counts)
  for (const [meetingId, value] of result.data) {
    if (s.lines.has(meetingId)) continue
    counts.set(meetingId, value)
  }
  // A meeting with no lines at all is absent from the response, so it needs an
  // explicit zero — otherwise its badge would keep whatever a previous list had.
  for (const id of meetingIds) {
    if (!result.data.has(id) && !s.lines.has(id)) counts.set(id, emptyLineCounts())
  }
  useMeetingsStore.setState({ counts })
}

const linesInFlight = new Map<string, Promise<void>>()

/**
 * Meetings with one forced re-read already chained behind the in-flight fetch.
 *
 * Caps the chain at one. Without it, a flapping socket firing several resyncs
 * during one load would queue a reload per resync and each of those would queue
 * another behind itself — a refetch loop driven by the very condition that makes
 * refetching expensive.
 */
const linesForceQueued = new Set<string>()

/**
 * Fetch one meeting's lines, and the meeting header if the list has not landed.
 *
 * Deduped per meeting id: MeetingLive and MeetingTriage both ask on mount, and a
 * realtime resync asks again while they are open.
 *
 * A FORCED CALL IS NEVER ANSWERED BY THE FETCH ALREADY RUNNING. Returning it
 * looks like deduplication and is not: that request may have been issued BEFORE
 * the rows the caller is asking us to go and find, so a resync arriving during a
 * load would be silently swallowed and the missed lines would stay missed for
 * the session. Chained instead — the caller still awaits one promise, and the
 * re-read starts after the in-flight one has cleared itself out of the map.
 */
export function loadLines(meetingId: string, force = false): Promise<void> {
  const mine = epoch
  const existing = linesInFlight.get(meetingId)
  if (existing) {
    if (!force || linesForceQueued.has(meetingId)) return existing
    linesForceQueued.add(meetingId)
    return existing.then(() => {
      // A queued re-read belongs to the session that queued it. After a sign-out
      // the chain would otherwise fire a fresh read for a meeting the next
      // account never asked to open.
      if (mine !== epoch) return
      linesForceQueued.delete(meetingId)
      return loadLines(meetingId, true)
    })
  }

  const st = useMeetingsStore.getState()
  if (!force && st.linesLoadedAt.has(meetingId)) return Promise.resolve()

  if ((st.lines.get(meetingId) ?? EMPTY_LINES).length === 0) {
    useMeetingsStore.setState({ linesLoading: new Set(st.linesLoading).add(meetingId) })
  }

  const run = Promise.all([
    st.byId.has(meetingId) ? Promise.resolve(null) : apiGetMeeting(meetingId),
    apiListLines(meetingId),
  ])
    .then(([header, result]) => {
      // Signed out while this was in flight — see `epoch`. These lines are the
      // previous account's, and `plans` below is its unsaved triage drafts.
      if (mine !== epoch) return
      if (header && header.ok && header.data) putMeeting(header.data)

      const s = useMeetingsStore.getState()
      if (!result.ok) {
        useMeetingsStore.setState({
          linesError: new Map(s.linesError).set(meetingId, result.error),
        })
        return
      }

      // Seed a triage draft for every line, skipping any the user has edited
      // since — see putLine's note. Done in one pass rather than per row so the
      // whole load is a single setState.
      const plans = new Map(s.plans)
      for (const line of result.data) {
        if (!unsaved.has(line.id)) plans.set(line.id, decodePlan(line.parsed, line.raw))
      }
      const linesError = new Map(s.linesError)
      linesError.delete(meetingId)
      useMeetingsStore.setState({
        lines: new Map(s.lines).set(meetingId, result.data),
        linesLoadedAt: new Map(s.linesLoadedAt).set(meetingId, Date.now()),
        linesError,
        plans,
        counts: new Map(s.counts).set(meetingId, tally(result.data)),
      })
    })
    .finally(() => {
      // Not ours any more — see loadMeetings' finally. `linesInFlight` may
      // already hold the NEXT account's read for this same meeting id.
      if (mine !== epoch) return
      linesInFlight.delete(meetingId)
      const s = useMeetingsStore.getState()
      const linesLoading = new Set(s.linesLoading)
      linesLoading.delete(meetingId)
      useMeetingsStore.setState({ linesLoading })
    })

  linesInFlight.set(meetingId, run)
  return run
}

export function invalidateMeetings(): void {
  useMeetingsStore.setState({ loadedAt: null })
  void loadMeetings(true)
}

/**
 * Sign-out. Another account's meetings and, worse, another account's unsaved
 * triage drafts must not survive into the next session in this tab.
 *
 * CALLED FROM Shell's cleanup in src/App.tsx, beside resetEntries() and the
 * other four. It shipped with no caller at all for two rounds, and the two
 * things that made that expensive are both latches: `loadedAt` and
 * `linesLoadedAt` are consulted WITHOUT a clock and WITHOUT a session check, so
 * the next account's first loadMeetings()/loadLines() returned early and painted
 * the previous account's list, lines and half-made triage decisions with no
 * spinner and no network call. src/store/signOutReset.test.ts now asserts that
 * every reset* in this directory is wired, so the omission cannot recur.
 */
export function resetMeetings(): void {
  // FIRST, before anything else is cleared: every read already on the wire is
  // now the previous account's, and this is what stops its answer from being
  // written back into the store this function is about to empty. See `epoch`.
  epoch += 1
  for (const timer of planTimers.values()) window.clearTimeout(timer)
  planTimers.clear()
  unsaved.clear()
  meetingsInFlight = null
  linesInFlight.clear()
  linesForceQueued.clear()
  useMeetingsStore.setState({
    ...deriveMeetings([]),
    loading: false,
    loadedAt: null,
    error: null,
    lines: new Map(),
    linesLoading: new Set(),
    linesLoadedAt: new Map(),
    linesError: new Map(),
    counts: new Map(),
    plans: new Map(),
    saving: new Set(),
    committing: new Set(),
  })
}

// A second device (or another attendee) can add a meeting while this tab sits in
// the background, so returning to it is the natural moment to re-check. Gated on
// STALE_AFTER_MS for the same reason store/config.ts gates its own.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (!hasSession()) return
    const { loadedAt } = useMeetingsStore.getState()
    if (loadedAt !== null && Date.now() - loadedAt > STALE_AFTER_MS) void loadMeetings(true)
  })
}

// ── writes: the meeting ────────────────────────────────────────────────────

export interface StartMeetingInput {
  title: string
  trackId: string | null
  attendees: string[]
}

/**
 * Start a meeting, optimistically.
 *
 * The id is minted here so the caller can navigate to `/meetings/<id>` in the
 * same tick — the live screen's whole promise is that it is ready before the
 * first thing anybody says, and waiting on a round trip to learn the URL breaks
 * that on a hotel wifi. A queued create keeps the row: the meeting is real to
 * this tab and its lines will drain behind it, in order.
 */
export async function startMeeting(input: StartMeetingInput): Promise<ApiResult<Meeting>> {
  const id = crypto.randomUUID()
  const title = input.title.trim()
  if (title === '') return fail('meeting.errTitleRequired')

  const optimistic: Meeting = {
    id,
    title,
    track_id: input.trackId,
    attendees: input.attendees.map((a) => a.trim()).filter((a) => a !== ''),
    started_at: nowIso(),
    ended_at: null,
    notes: '',
    created_by: null,
  }
  putMeeting(optimistic)

  const payload: NewMeeting = {
    id,
    title,
    trackId: input.trackId,
    attendees: optimistic.attendees,
  }
  const result = await submitFn<Meeting>({
    table: 'meetings',
    op: 'insert',
    id: null,
    // Null, not a temp id: the row already carries the id the server will store,
    // so there is nothing for the outbox to rewrite.
    tempId: null,
    payload,
    dedupeKey: dedupeKeyFor('meetings', 'insert', id, payload),
    dependsOn: [],
  })

  if (result.ok) {
    putMeeting(result.data)
    return result
  }
  if (result.error === QUEUED_KEY) {
    // Queued, not failed — reported as SUCCESS on purpose. The row already
    // carries the id the server will store, so `/meetings/<id>` is a real URL
    // and the meeting is fully usable offline; handing the caller a failure
    // would strand it on the index with a meeting it cannot open.
    //
    // Said once, here, rather than per line: an offline meeting queues one row
    // for the header and one for every sentence, and forty toasts is not a
    // notice, it is an obstruction. The queued lines surface in the shell's
    // pending count, which is what `.offline-banner-count` is for.
    toast(t('meeting.lineQueued'))
    return { ok: true, data: optimistic }
  }
  dropMeeting(id)
  return result
}

/** Patch the meeting header, optimistically, with rollback on a real failure. */
async function patchMeetingLocal(id: string, patch: MeetingPatch): Promise<ApiResult<Meeting>> {
  const before = useMeetingsStore.getState().byId.get(id)
  if (!before) return fail('meeting.errNotFound')

  const optimistic: Meeting = {
    ...before,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.trackId !== undefined ? { track_id: patch.trackId } : {}),
    ...(patch.attendees !== undefined ? { attendees: patch.attendees } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.endedAt !== undefined ? { ended_at: patch.endedAt } : {}),
  }
  putMeeting(optimistic)

  const result = await submitFn<Meeting>({
    table: 'meetings',
    op: 'update',
    id,
    tempId: null,
    payload: patch,
    dedupeKey: dedupeKeyFor('meetings', 'update', id, patch),
    dependsOn: [],
  })

  if (result.ok) {
    putMeeting(result.data)
    return result
  }
  if (result.error === QUEUED_KEY) return { ok: true, data: optimistic }
  putMeeting(before)
  return result
}

/** Close the meeting. `notes` is the free-text record; '' is a legal value. */
export function endMeetingNow(id: string, notes: string): Promise<ApiResult<Meeting>> {
  return patchMeetingLocal(id, { notes, endedAt: nowIso() })
}

/** Reopen a meeting ended one tap too early. */
export function resumeMeetingNow(id: string): Promise<ApiResult<Meeting>> {
  return patchMeetingLocal(id, { endedAt: null })
}

export function saveMeetingNotes(id: string, notes: string): Promise<ApiResult<Meeting>> {
  return patchMeetingLocal(id, { notes })
}

// ── writes: the lines ──────────────────────────────────────────────────────

/** The seq a new line takes, from what this tab holds. Races are retried in api/. */
function nextLocalSeq(meetingId: string): number {
  const lines = useMeetingsStore.getState().lines.get(meetingId) ?? EMPTY_LINES
  return lines.reduce((max, l) => (l.seq > max ? l.seq : max), 0) + 1
}

/**
 * Append one line, optimistically, and parse it on the way through.
 *
 * The optimistic row is applied SYNCHRONOUSLY, before the await, because the
 * live screen clears its input on Enter and the next sentence is already being
 * typed by the time this resolves. A queued append keeps the row for the same
 * reason capture's does: the queue owns it, and rolling it back would eat a
 * sentence.
 */
export async function appendMeetingLine(
  meetingId: string,
  raw: string,
  ctx: ParseContext,
  state: MeetingLineState = 'pending',
): Promise<ApiResult<MeetingLine>> {
  const text = raw.trim()
  if (text === '') return fail('meeting.errEmptyLine')

  const id = crypto.randomUUID()
  const seq = nextLocalSeq(meetingId)
  // A note is context, not work, so it is not planned — nothing will be created
  // from it and a triage row for it would be noise.
  const plan = state === 'note' ? null : planFromParsed(parse(text, ctx))
  const ts = nowIso()

  const optimistic: MeetingLine = {
    id,
    meeting_id: meetingId,
    seq,
    raw: text,
    // The COLUMN shape, not the plan object: `parsed` is jsonb everywhere else
    // in the app and an optimistic row that held a different shape would decode
    // differently from the server row that replaces it.
    parsed: plan ? planToJson(plan) : null,
    state,
    entry_id: null,
    created_by: null,
    created_at: ts,
    updated_at: ts,
  }
  putLine(optimistic, true)

  const payload: NewMeetingLine = { id, meetingId, seq, raw: text, parsed: plan, state }
  const result = await submitFn<MeetingLine>({
    table: 'meeting_lines',
    op: 'insert',
    id: null,
    tempId: null,
    payload,
    dedupeKey: dedupeKeyFor('meeting_lines', 'insert', id, payload),
    dependsOn: [],
  })

  if (result.ok) {
    // Same id, so this is a refresh rather than a swap — no flicker, no reorder
    // unless the server had to move the seq to settle a race.
    putLine(result.data, true)
    return result
  }
  if (result.error === QUEUED_KEY) return { ok: true, data: optimistic }
  dropLine(meetingId, id)
  return result
}

/** Patch one line, optimistically, with rollback on a real failure. */
async function patchLineLocal(lineId: string, patch: MeetingLinePatch): Promise<ApiResult<MeetingLine>> {
  const s = useMeetingsStore.getState()
  let before: MeetingLine | undefined
  for (const list of s.lines.values()) {
    const hit = list.find((l) => l.id === lineId)
    if (hit) {
      before = hit
      break
    }
  }
  if (!before) return fail('meeting.errLineGone')

  const optimistic: MeetingLine = {
    ...before,
    ...(patch.raw !== undefined ? { raw: patch.raw } : {}),
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.parsed !== undefined
      ? { parsed: patch.parsed ? planToJson(patch.parsed) : null }
      : {}),
    ...(patch.entryId !== undefined ? { entry_id: patch.entryId } : {}),
    updated_at: nowIso(),
  }
  putLine(optimistic, false)
  markSaving(lineId, true)

  const result = await submitFn<MeetingLine>({
    table: 'meeting_lines',
    op: 'update',
    id: lineId,
    tempId: null,
    payload: patch,
    dedupeKey: dedupeKeyFor('meeting_lines', 'update', lineId, patch),
    dependsOn: [],
  })
  markSaving(lineId, false)

  if (result.ok) {
    putLine(result.data, false)
    return result
  }
  if (result.error === QUEUED_KEY) return { ok: true, data: optimistic }
  putLine(before, false)
  return result
}

/**
 * Fix a line's text — a typo caught mid-meeting, or a sentence finished after
 * the room moved on. Re-parsed, because the words are what the plan came from.
 *
 * A NOTE IS NOT RE-PLANNED. Re-parsing one would silently give it a track and an
 * owner and put it back in the triage table, undoing a decision the user already
 * made about what the line is for.
 */
export function editLine(
  lineId: string,
  raw: string,
  ctx: ParseContext,
): Promise<ApiResult<MeetingLine>> {
  const text = raw.trim()
  if (text === '') return Promise.resolve(fail('meeting.errEmptyLine'))

  const line = findLine(lineId)
  if (!line) return Promise.resolve(fail('meeting.errLineGone'))

  if (line.state === 'note') return patchLineLocal(lineId, { raw: text })

  const plan = planFromParsed(parse(text, ctx))
  // The draft follows the text, since the text is where it came from.
  const s = useMeetingsStore.getState()
  useMeetingsStore.setState({ plans: new Map(s.plans).set(lineId, plan) })
  unsaved.delete(lineId)
  return patchLineLocal(lineId, { raw: text, parsed: plan })
}

/**
 * Move a line between pending / note / discarded.
 *
 * THERE IS NO DELETE, and that is the spec, not an omission: a discarded line
 * stays in the record so the minutes can show what was raised and dropped. 0004
 * scopes DELETE to the author for the cases this app does not use.
 */
export function setLineState(lineId: string, state: MeetingLineState): Promise<ApiResult<MeetingLine>> {
  return patchLineLocal(lineId, { state })
}

function findLine(lineId: string): MeetingLine | undefined {
  for (const list of useMeetingsStore.getState().lines.values()) {
    const hit = list.find((l) => l.id === lineId)
    if (hit) return hit
  }
  return undefined
}

// ── triage drafts ──────────────────────────────────────────────────────────

/**
 * Edit one field of a line's plan.
 *
 * The draft is applied to the store immediately — the dropdown must not lag a
 * network round trip — and written to `meeting_lines.parsed` on a debounce, so
 * a reload mid-triage comes back where it left off. That column doubles as the
 * draft store precisely so there is no second place for triage state to live.
 */
export function setLinePlan(lineId: string, patch: Partial<LinePlan>): void {
  const s = useMeetingsStore.getState()
  const current = s.plans.get(lineId) ?? decodePlan(findLine(lineId)?.parsed ?? null, findLine(lineId)?.raw ?? '')
  const next: LinePlan = { ...current, ...patch }
  // The owner XOR, resolved at the edge so nothing downstream has to: setting a
  // teammate clears a vendor name and vice versa.
  if (patch.ownerId !== undefined && patch.ownerId) next.ownerName = null
  if (patch.ownerName !== undefined && patch.ownerName) next.ownerId = null

  useMeetingsStore.setState({ plans: new Map(s.plans).set(lineId, next) })
  unsaved.add(lineId)

  const pending = planTimers.get(lineId)
  if (pending !== undefined) window.clearTimeout(pending)
  planTimers.set(
    lineId,
    window.setTimeout(() => {
      planTimers.delete(lineId)
      void savePlan(lineId)
    }, PLAN_SAVE_MS),
  )
}

/** Write one line's draft now. Resolves whether or not there was anything to do. */
async function savePlan(lineId: string): Promise<void> {
  if (!unsaved.has(lineId)) return
  const plan = useMeetingsStore.getState().plans.get(lineId)
  if (!plan) {
    unsaved.delete(lineId)
    return
  }
  // Cleared BEFORE the await: an edit made while this write is in flight must
  // re-mark the line dirty rather than be swallowed by the completion.
  unsaved.delete(lineId)
  const result = await patchLineLocal(lineId, { parsed: plan })
  // A failed draft write is not worth a toast — the draft is still on screen and
  // the commit path flushes again — but it must stay dirty so it is retried.
  if (!result.ok) unsaved.add(lineId)
}

/**
 * Write every outstanding draft. Called before a commit so the debounce can
 * never race it, and worth calling on unmount of the triage screen.
 */
export async function flushLinePlans(): Promise<void> {
  const ids = [...unsaved]
  for (const id of ids) {
    const timer = planTimers.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      planTimers.delete(id)
    }
  }
  await Promise.all(ids.map((id) => savePlan(id)))
}

// ── the bulk commit ────────────────────────────────────────────────────────

/**
 * Turn the chosen lines into entries linked to this meeting.
 *
 * NOT ROUTED THROUGH THE OUTBOX — see this file's header. Offline is refused
 * with a message rather than queued, because a half-applied twenty-row commit
 * has no honest envelope and a replay would duplicate entries.
 *
 * On success the created entries are pushed straight into store/entries, so the
 * board and follow-ups have them before realtime gets round to it (and whether
 * or not this tab is subscribed). `applyServerRow` is the shared entry point
 * realtime and the outbox use for exactly this.
 */
export async function commitTriage(
  meetingId: string,
  lineIds: string[],
): Promise<ApiResult<CommitReport>> {
  if (lineIds.length === 0) return { ok: true, data: { created: [], failed: [] } }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return fail('meeting.errCommitOffline')
  }
  if (useMeetingsStore.getState().committing.has(meetingId)) return fail('meeting.errCommitBusy')

  markCommitting(meetingId, true)
  try {
    // Any draft still sitting on the debounce is written first, so the server
    // sees the same decisions the table is showing.
    await flushLinePlans()

    const plans = useMeetingsStore.getState().plans
    const result = await apiCommitLines(meetingId, lineIds, plans)
    if (!result.ok) return result

    for (const entry of result.data.created) {
      applyServerRow(entry, 'fetch')
    }

    // Re-read the lines rather than patching them locally: the commit set the
    // state and the entry_id server-side, and a hand-built local copy of that is
    // one more thing that can disagree with the row.
    await loadLines(meetingId, true)
    return result
  } finally {
    markCommitting(meetingId, false)
  }
}

// ── realtime ───────────────────────────────────────────────────────────────

/**
 * Subscribe this store to `meeting_lines` on the app's single shared channel.
 *
 * Registered by the screens that need it rather than by the Shell: a handler is
 * not a socket (api/realtime.ts owns the one connection and fans batches out),
 * so scoping the registration to the two screens that render lines costs nothing
 * and keeps the rest of the app from paying attention to a table it never shows.
 *
 * Ref-counted, because MeetingLive and MeetingTriage can both be mounted across
 * a route transition and two registrations would apply every row twice.
 *
 * TWO REGISTRATIONS, NOT ONE, and the second is the one that was missing. A
 * batch handler only ever hears what the socket delivered; postgres_changes has
 * NO REPLAY, so everything written while the connection was down is simply gone
 * (api/realtime.ts says so at the top). api/realtime.ts emits a resync on any
 * SUBSCRIBED that follows a CHANNEL_ERROR or CLOSED, and after a tab has been
 * hidden for a minute — which during a meeting is a phone screen locking — and
 * for a whole wave store/entries.ts was its only subscriber. Meetings heard
 * nothing, loadLines() short-circuits permanently on `linesLoadedAt`, and the
 * lines a colleague typed in that minute never arrived: the live screen, the
 * triage table and the minutes all rendered an incomplete meeting, with no
 * error anywhere to suggest it.
 */
let realtimeStop: (() => void) | null = null
let realtimeUsers = 0

export function startMeetingsRealtime(): () => void {
  realtimeUsers += 1
  if (realtimeUsers === 1) {
    const offBatch = onRealtime<MeetingLine>('meeting_lines', (batch) => {
      for (const event of batch) {
        if (event.eventType === 'DELETE') {
          if (!event.oldId) continue
          for (const [meetingId, list] of useMeetingsStore.getState().lines) {
            if (list.some((l) => l.id === event.oldId)) dropLine(meetingId, event.oldId)
          }
          continue
        }
        if (!event.row) continue
        // Only for meetings this tab is actually holding: a line from somebody
        // else's meeting is not ours to cache, and inventing a list for it would
        // make loadLines() believe the meeting was already loaded.
        if (!useMeetingsStore.getState().lines.has(event.row.meeting_id)) continue
        putLine(event.row, true)
      }
    })

    // Re-read every meeting whose lines this tab holds — which is one, or two
    // across a live→triage transition, not the whole index. Forced, because
    // `linesLoadedAt` is exactly what has to be overridden here; putLine's
    // `unsaved` check is what stops the re-read stamping over a triage draft
    // the user is part-way through.
    const offResync = onRealtimeResync(() => {
      for (const meetingId of useMeetingsStore.getState().lines.keys()) {
        void loadLines(meetingId, true)
      }
    })

    realtimeStop = () => {
      offBatch()
      offResync()
    }
  }
  return () => {
    realtimeUsers -= 1
    if (realtimeUsers > 0) return
    realtimeStop?.()
    realtimeStop = null
  }
}
