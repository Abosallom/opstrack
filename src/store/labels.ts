// The owner's own wording, layered over the shipped locale bundles.
//
// This store is the ONE place `label_overrides` rows become the live override
// layer. It loads them at sign-in, pushes them into lib/i18n through
// setOverrides(), and re-pushes after every mutation — so a rename is visible
// everywhere the instant it is saved, for everyone, with no deploy. That
// sentence is the whole feature; everything below is in service of it.
//
// PUSH, NEVER PULL. `src/lib/**` may not import from `src/store/**`, so i18n
// cannot fetch its own overrides — this store hands them over. The map's shape
// is `LabelOverrideMap` in src/types.ts, which is the only file below the api,
// store and lib layers that all three of them touch.
//
// ONE WRITER. Every path that changes the layer goes through applyRows() below,
// so the rows this store holds and the map i18n is resolving against cannot
// drift. THE ONE WAY TO BREAK THAT is a second caller of lib/i18n's
// setOverrides() — it would install a layer this store did not build, and the
// next optimistic save would push its own rows back over the top. lib/i18n.ts
// used to export a `clearOverrides()` that was exactly that second door; it had
// no caller and has been removed, and the note there says why a sign-out clear
// would be wrong as well as unnecessary.
//
// NARROW SELECTOR HOOKS, and here the reason is sharper than in store/config.ts:
// the terminology screen renders a row per key over a ~1,600-key surface, so a
// component that merely wanted `useLabelsLoading()` must not re-render because
// one row's Arabic changed.
//
// THE DERIVED VIEWS (`byKey`, `count`) ARE COMPUTED ONCE when rows land and
// stored, never inside a selector. A selector that builds a Map returns a new
// reference every call, which under useSyncExternalStore means "the snapshot
// changed" forever — an infinite re-render loop, and in dev a "getSnapshot
// should be cached" warning. store/config.ts's header documents the same trap.
//
// BLANK MEANS DEFAULT (spec §5) IS THIS MODULE'S JOB AT THIS BOUNDARY. Null and
// blank both mean "no override for this language", and buildMap() below is where
// they are collapsed: a blank never enters the map, so lib/i18n's lookup can
// return a hit as-is and no override can render a label as empty space. It is
// one rule with four keepers, each covering what the others cannot reach —
// lib/labelOverrides.ts refuses to PRODUCE a blank override, api/labels.ts
// refuses to SEND one, 0017's `label_overrides_touch()` collapses blank to null
// so `''` cannot be STORED, and lib/i18n's `overrideFor()` is the last backstop
// for a row hand-edited past all three. This one covers the localStorage cache,
// which no trigger and no validator ever sees. All four now ask the SAME
// question — `isBlankLabel()` in lib/labelOverrides.ts — because four private
// `trim() === ''` tests were four chances to disagree, and they did: an
// invisible format character is empty to a reader and non-empty to trim().
//
// MISSING TABLE IS A SUPPORTED STATE. Until 0017 is applied, listOverrides()
// fails, the layer stays empty, every t() lands on its shipped string and the
// app renders exactly as it does today. See api/labels.ts's header — that
// degradation is the feature's safety net, not a gap.

import { create } from 'zustand'
import {
  deleteAllOverrides,
  deleteOverride,
  listOverrides,
  upsertOverride,
  upsertOverrides,
  type LabelOverrideInput,
} from '../api/labels'
import type { ApiResult } from '../api/result'
import { setOverrides } from '../lib/i18n'
import { isBlankLabel } from '../lib/labelOverrides'
import { hasSession } from './auth'
import type { LabelOverrideMap, LabelOverrideRow } from '../types'

const CACHE_KEY = 'nphiescore_label_overrides_v1'

/** Same window store/config.ts and store/vocab.ts use. Wording changes rarely. */
const STALE_AFTER_MS = 30_000

interface LabelsState {
  /** Every override row, ordered by key. */
  rows: LabelOverrideRow[]
  /** key → row, so a screen of 1,600 rows does not scan the list 1,600 times. */
  byKey: ReadonlyMap<string, LabelOverrideRow>
  /** Keys overridden in at least one language — the header's tally. */
  count: number
  loading: boolean
  /** Epoch ms of the last successful load; null means never loaded. */
  loadedAt: number | null
}

/**
 * A value that actually overrides something, or null.
 *
 * NULL AND BLANK ARE THE SAME ANSWER, and this is the one place in the store
 * that says so — buildMap() and the tally both go through it, so the map i18n
 * resolves against and the number in the screen's header can never disagree
 * about what counts as a change.
 *
 * WHAT COUNTS AS BLANK IS isBlankLabel()'s ANSWER, not `trim()`'s, and this is
 * the layer where the difference bites hardest: the localStorage cache is the
 * one thing no trigger and no validator ever sees. An Arabic override whose
 * placeholders the validator fenced survives it intact — the isolates are only
 * stripped for the TEST, never from the stored value.
 */
function text(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return isBlankLabel(trimmed) ? null : trimmed
}

/**
 * Does this row change what anyone reads?
 *
 * A row of nulls is not an error — it is what an upsert leaves behind for the
 * instant before 0017's prune trigger deletes it, and what a cached response of
 * that upsert holds — but counting it would tell the owner he has an override he
 * cannot find.
 */
function overridesSomething(row: LabelOverrideRow): boolean {
  return text(row.en) !== null || text(row.ar) !== null
}

/**
 * Build the whole state slice from a row list, exactly as store/config.ts does,
 * so the derived views cannot drift from `rows`.
 */
function derive(rows: LabelOverrideRow[]): Omit<LabelsState, 'loading' | 'loadedAt'> {
  return {
    rows,
    byKey: new Map(rows.map((row) => [row.key, row])),
    count: rows.filter(overridesSomething).length,
  }
}

/**
 * The rows as lib/i18n resolves against them: one flat `key → string` record per
 * language, blanks dropped, audit columns gone.
 *
 * A row is a pair because that is what one editor row saves; the map is split by
 * language because a lookup happens in one locale, on the path t() takes for
 * every string on every screen.
 *
 * THE ONLY PLACE THIS MODULE KNOWS THE MAP'S SHAPE — everything else moves rows
 * around. If lib/i18n's resolution ever changes shape, this function is the
 * single edit and tsc says so.
 *
 * Built fresh on every apply rather than patched incrementally. The map is a few
 * dozen entries in practice and bounded by the bundle; an incremental update
 * would have to know how to REMOVE a key when an override is cleared, which is
 * exactly the path a "reset did not reset" bug hides in.
 */
function buildMap(rows: readonly LabelOverrideRow[]): LabelOverrideMap {
  const en: Record<string, string> = {}
  const ar: Record<string, string> = {}
  for (const row of rows) {
    // A blank key names nothing and cannot be looked up. 0017's
    // `label_overrides_key_shape` refuses one, so this only ever fires on a
    // cache written before that constraint existed.
    const key = row.key.trim()
    if (key === '') continue
    const enValue = text(row.en)
    if (enValue !== null) en[key] = enValue
    const arValue = text(row.ar)
    if (arValue !== null) ar[key] = arValue
  }
  return { en, ar }
}

/**
 * Last known overrides, for first paint.
 *
 * Without this every cold load renders the SHIPPED wording for a beat and then
 * re-labels — which on a workspace that renamed "Entries" to "Actions" looks
 * like the app forgetting its own configuration, on every launch.
 *
 * The try/catch also covers `localStorage` being undefined outright: this module
 * has a vitest suite and vitest runs in the node environment.
 */
function readCache(): LabelOverrideRow[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Shape-check the primary key only: the realistic corruption is a cache
    // written by an older column set, and every consumer keys off `key`.
    return parsed.filter(
      (row): row is LabelOverrideRow =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as LabelOverrideRow).key === 'string',
    )
  } catch {
    return []
  }
}

function writeCache(rows: LabelOverrideRow[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch {
    // Best effort: a full quota must not break a successful fetch.
  }
}

const useLabelsStore = create<LabelsState>(() => ({
  ...derive(readCache()),
  loading: false,
  loadedAt: null,
}))

/**
 * THE ONLY WRITER. Rows become state and become the live override layer in one
 * call, so the two can never disagree — a setState that forgot the push would
 * leave this screen showing a change the rest of the app has not made.
 *
 * `loadedAt` is deliberately not touched: a rollback restores rows without
 * claiming a fresh read, and only loadLabels() gets to say when the data was
 * last known good.
 */
function applyRows(rows: LabelOverrideRow[]): void {
  useLabelsStore.setState(derive(rows))
  setOverrides(buildMap(rows))
}

// FIRST PAINT. The cached overrides go into i18n at module load — before the
// shell mounts, before the network replies — so the very first render is already
// in the owner's wording. loadLabels() corrects it a fetch later.
setOverrides(buildMap(useLabelsStore.getState().rows))

// ── selectors ──────────────────────────────────────────────────────────────

/** Every override row, ordered by key. The terminology screen's list. */
export function useLabelOverrides(): LabelOverrideRow[] {
  return useLabelsStore((s) => s.rows)
}

/** key → row, for a per-row lookup that must not scan the list once per row. */
export function useLabelOverrideMap(): ReadonlyMap<string, LabelOverrideRow> {
  return useLabelsStore((s) => s.byKey)
}

/** How many keys are overridden — the count in the screen's header. */
export function useLabelOverrideCount(): number {
  return useLabelsStore((s) => s.count)
}

export function useLabelsLoading(): boolean {
  return useLabelsStore((s) => s.loading)
}

/**
 * The rows outside React.
 *
 * Mirrors getVocabSnapshot(): a hook cannot serve a caller with no component to
 * hang a subscription off. Today that caller is this module's own suite — vitest
 * runs in the `node` environment with no renderer, so this is the ONLY way to
 * observe what the store holds, and every rollback and cache assertion in
 * store/labels.test.ts reads through it. (The JSON export does NOT: LabelIO.tsx
 * is a component and takes useLabelOverrides(), so that it re-renders when the
 * set changes.) Read-only by type, because handing out the array the store is
 * holding and letting a caller sort it in place would silently reorder the
 * screen.
 */
export function getLabelOverrides(): readonly LabelOverrideRow[] {
  return useLabelsStore.getState().rows
}

// ── loading ────────────────────────────────────────────────────────────────

/**
 * The load in progress. Concurrent callers (the shell mounting while the focus
 * listener fires) await this one promise instead of each firing a request and
 * writing the answer twice.
 */
let inFlight: Promise<void> | null = null

/**
 * The one fresh read queued behind a load that was already running when a
 * mutation invalidated it. Null while nothing is waiting.
 */
let queuedForce: Promise<void> | null = null

/**
 * Bumped by every mutation, so a read that STARTED before it can be recognised
 * when it lands afterwards.
 *
 * The chained force below guarantees the final state is right; this is what
 * stops the wrong one being shown on the way there. Without it, "Reset every
 * change" with a read already in flight puts every override back on screen for
 * one round trip — the escape hatch visibly undoing itself in front of somebody
 * who is already having a bad time with this screen.
 */
let epoch = 0

/** Take the rollback snapshot and open a new epoch. Every mutation starts here. */
function snapshot(): LabelOverrideRow[] {
  epoch += 1
  return useLabelsStore.getState().rows
}

/**
 * Fetch the overrides unless a good copy is already in hand.
 *
 * NEVER REJECTS, and a failure NEVER LATCHES. `loadedAt` is stamped only on an
 * answer this module believes, so a failed read leaves it null and the next call
 * — the next screen, the next focus, the next sign-in — tries again. Stamping it
 * in the `finally` would turn one dropped request into an app that renders the
 * shipped wording for the rest of the session with nothing to say the owner's
 * configuration was ever missed.
 */
export function loadLabels(force = false): Promise<void> {
  const running = inFlight
  if (running !== null) {
    if (!force) return running
    // FORCE OUTRANKS THE DEDUPE, and this is not a nicety. `force` is what
    // invalidateLabels() passes after every mutation, and returning the request
    // already in flight would hand the caller an answer that PREDATES the write:
    // after "Reset every change", a read issued a moment earlier lands, puts
    // every override back through applyRows(), stamps loadedAt and re-caches
    // them — the escape hatch undoing itself under a toast that says it worked.
    // So a forced call chains a genuinely fresh read behind the stale one.
    // ONE chain is enough for any number of forced callers: it starts after they
    // all asked, so its answer is fresh for all of them.
    queuedForce ??= running.then(() => {
      queuedForce = null
      return begin()
    })
    inFlight = queuedForce
    return queuedForce
  }
  if (!force && useLabelsStore.getState().loadedAt !== null) return Promise.resolve()
  return begin()
}

/** The load itself, once it has been decided that one should happen. */
function begin(): Promise<void> {
  // Only show the spinner when there is genuinely nothing to show. A focus
  // refetch with a warm cache must not blank the list the admin is editing.
  if (useLabelsStore.getState().rows.length === 0) {
    useLabelsStore.setState({ loading: true })
  }

  const startedAt = epoch
  const mine: Promise<void> = listOverrides()
    .then((result) => {
      // A mutation happened while this read was out, so it describes the world
      // before it. The forced load that mutation queued is already on its way.
      if (startedAt !== epoch) {
        console.warn('[labels] dropping a read that predates a change')
        return
      }
      if (!result.ok) {
        // No stamp, no cache write, no clear: whatever was cached stays, which
        // for an unapplied 0017 is an empty layer and the shipped wording.
        console.warn('[labels] load failed:', result.error)
        return
      }
      const { rows, truncated } = result.data
      // An empty list from an UNAUTHENTICATED read is not an answer — see
      // hasSession(). RLS answers a signed-out reader with 200 and `[]`, and
      // believing it stamps `loadedAt`, overwrites the cache with nothing and
      // strips the workspace's wording off the sign-in screen for good. This
      // exact bug has shipped twice; store/config.ts and store/vocab.ts carry
      // the same guard for the same reason, and it is why it stopped.
      if (rows.length === 0 && !hasSession()) {
        console.warn('[labels] ignoring an empty read made without a session')
        return
      }
      // An empty list WITH a session IS an answer, and a consequential one: it
      // is what "reset all overrides" on another device looks like from here.
      // applyRows([]) clears the live layer and writeCache([]) stops the next
      // cold start resurrecting the wording that was just thrown away.
      applyRows(rows)
      if (truncated) {
        // A CLIPPED READ IS NOT A GOOD COPY. The rows that did arrive are still
        // applied — most of the owner's wording is better than none of it — but
        // `loadedAt` stays null so every focus retries, and the cache is left
        // alone so a partial set never becomes the thing a cold start believes.
        // api/labels.ts pages to 4,000 rows against a hard bound of ~2,100, so
        // reaching this means something is wrong rather than merely large.
        console.warn('[labels] a clipped read was applied but not cached')
        return
      }
      useLabelsStore.setState({ loadedAt: Date.now() })
      writeCache(rows)
    })
    .finally(() => {
      // Only if nothing newer has claimed the slot: a forced call may have
      // chained itself on while this one was running, and clearing that would
      // let a third caller start a parallel read.
      if (inFlight === mine) inFlight = null
      useLabelsStore.setState({ loading: false })
    })

  inFlight = mine
  return mine
}

/**
 * Mark the cache stale and refetch. Called after every mutation below, so the
 * screen ends up showing what the database holds — including the `updated_at`
 * and `updated_by` that 0017's trigger stamped, which an optimistic row can only
 * guess at, and any row the prune trigger removed on its own.
 */
export function invalidateLabels(): void {
  useLabelsStore.setState({ loadedAt: null })
  void loadLabels(true)
}

// ── mutations ──────────────────────────────────────────────────────────────
//
// Every one is OPTIMISTIC WITH ROLLBACK, and for this feature that is not a
// nicety. The thing being edited is the words on the screen the editor is
// standing on: a save that waits for a round trip before anything changes reads
// as a control that did not work, and the owner clicks it again. So the wording
// changes at the moment of the click, and if the write is refused every string
// goes back — not just the row's own inputs, because one override can be showing
// in the nav, a column heading and a toast at once.
//
// The captured `previous` is the WHOLE row array rather than the one row: the
// map handed to i18n is rebuilt from all of them, so restoring a single row
// would still hand i18n a map built from the optimistic list.
//
// THE READ-LANDS-AFTER-THE-WRITE RACE. A load already in flight when a mutation
// starts can land after it and overwrite the optimistic rows with a read that
// predates the write. That is survivable BECAUSE the invalidate every path below
// ends with now issues a genuinely fresh read rather than joining the stale one
// — see loadLabels(), where `force` outranks the in-flight dedupe. It did not
// used to, and the consequence was specific: "Reset every change" could put
// every override back and re-cache it, under a toast saying it had worked.

/**
 * Save one key's wording. Blank in a language clears that language; blank in
 * both removes the override entirely, matching what api/labels.ts sends and what
 * 0017's prune trigger would do anyway, so the optimistic view and the stored
 * state never disagree.
 *
 * `en` and `ar` are what lib/labelOverrides.validateOverride() returned — its
 * `value` is exactly this `string | null`. Nothing here re-validates.
 *
 * Resolves with an i18n error key on failure, for the caller to render through
 * `t()`. 42501 — an admin demoted between load and save — arrives as
 * admin.errForbidden.
 */
export async function saveOverride(
  key: string,
  en: string | null,
  ar: string | null,
): Promise<ApiResult<null>> {
  const previous = snapshot()
  applyRows(nextRows(previous, key, en, ar))

  const result = await upsertOverride(key, en, ar)
  if (!result.ok) {
    applyRows(previous)
    return result
  }
  invalidateLabels()
  return { ok: true, data: null }
}

/** Hand one key back to its shipped string. Optimistic, with the same rollback. */
export async function resetOverride(key: string): Promise<ApiResult<null>> {
  const previous = snapshot()
  applyRows(previous.filter((row) => row.key !== key))

  const result = await deleteOverride(key)
  if (!result.ok) {
    applyRows(previous)
    return result
  }
  // The row count reset_label_overrides() reports is deliberately dropped: 0 is
  // a success here (another admin got there first) and the caller has nothing
  // useful to say about the difference.
  invalidateLabels()
  return { ok: true, data: null }
}

/**
 * THE GLOBAL ESCAPE HATCH. Clear every override, in the table and in the live
 * layer, resolving with how many rows went.
 *
 * Optimistic like the rest, and it matters most here: someone reaching for this
 * has already made the app hard to read and possibly hard to navigate, and the
 * whole point is that the shipped wording comes back the moment they confirm.
 * The `confirm()` guard is the screen's — a modal inside a store action cannot
 * be tested and cannot be reused by the import path.
 */
export async function resetAllOverrides(): Promise<ApiResult<number>> {
  const previous = snapshot()
  applyRows([])

  const result = await deleteAllOverrides()
  if (!result.ok) {
    applyRows(previous)
    return result
  }
  invalidateLabels()
  return { ok: true, data: result.data }
}

/**
 * Apply a whole imported wording pass, resolving with how many keys were written.
 *
 * NOT optimistic, and that is the one deliberate departure. An import replaces
 * an unbounded set of keys the owner has not read one by one; showing it before
 * it lands would mean rolling back a screenful of changes he never saw
 * individually, and unlike a single-row save there is no "the control did not
 * work" impression to avoid — picking a file has already made this a deliberate,
 * awaited act. So it writes, then refetches, and the caller reports a number
 * that is true.
 *
 * It goes through the store rather than letting the importer call api/labels.ts
 * directly so this module stays the only thing that mutates the layer. An
 * importer that called the api itself would change the database and leave the
 * running app showing the old wording.
 */
export async function importOverrides(
  inputs: readonly LabelOverrideInput[],
): Promise<ApiResult<number>> {
  // Not optimistic — see above — but still a mutation, so a read already in
  // flight describes the world before it and must not be believed.
  epoch += 1
  const result = await upsertOverrides(inputs)
  if (!result.ok) return result

  // Awaited rather than fire-and-forget: the caller's "applied N" toast must not
  // beat the words it is talking about onto the screen.
  useLabelsStore.setState({ loadedAt: null })
  await loadLabels(true)
  return { ok: true, data: result.data.length }
}

/**
 * The row list as it will look once this save lands: replaced, inserted in key
 * order, or removed when both languages are blank.
 *
 * Ordered because listOverrides() is, and an optimistic row appended to the end
 * would jump position on the next refetch — on the one screen whose entire job
 * is a long list somebody is scanning.
 *
 * The audit fields of a new or edited row are a GUESS: `updated_at` is this
 * client's clock, and `updated_by` is carried over from the row being replaced
 * rather than resolved, because this store has no business reading the session
 * for a value 0017's trigger is about to overwrite. invalidateLabels() replaces
 * both a fetch later, and nothing renders them in between except a "last edited"
 * column that corrects itself.
 */
function nextRows(
  rows: readonly LabelOverrideRow[],
  key: string,
  en: string | null,
  ar: string | null,
): LabelOverrideRow[] {
  const trimmedKey = key.trim()
  const kept = rows.filter((row) => row.key !== trimmedKey)
  // text(), not a fresh emptiness test: this row has to be the one the refetch
  // will find, and api/labels.ts trims before sending for the same reason.
  const enValue = text(en)
  const arValue = text(ar)
  if (enValue === null && arValue === null) return kept

  const existing = rows.find((row) => row.key === trimmedKey)
  const row: LabelOverrideRow = {
    key: trimmedKey,
    en: enValue,
    ar: arValue,
    updated_by: existing?.updated_by ?? null,
    updated_at: new Date().toISOString(),
  }
  const next = [...kept, row]
  next.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return next
}

// A second admin — or the owner on his phone — can reword something while this
// tab sits in the background, and the whole promise of the feature is that a
// change lands "for everyone". Returning to the tab is the natural moment to
// re-check. Gated on STALE_AFTER_MS: alt-tabbing between two windows fires focus
// constantly, and a request per switch is not worth a table that changes weekly.
//
// Guarded on `window` because this module has a vitest suite and vitest's node
// environment has no window to listen on.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    // Signed out, the read can only come back empty (RLS), and believing that
    // empty answer is exactly the bug hasSession() documents. Alt-tabbing on the
    // sign-in screen must not poison the cache.
    if (!hasSession()) return
    const { loadedAt } = useLabelsStore.getState()
    if (loadedAt === null || Date.now() - loadedAt > STALE_AFTER_MS) void loadLabels(true)
  })
}
