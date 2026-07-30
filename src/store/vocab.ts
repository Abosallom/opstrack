// Sitting 2's payoff: an admin can rename and recolour every status, priority
// and type, in both languages, and it costs ZERO WRITES to historical data —
// entries and entry_updates.status_from/status_to store the KEY, and every
// screen resolves the label at render through the hooks below. Wave 2 gate (g)
// proves it: rename a label, watch the whole thread re-label, check the write
// count is zero.
//
// LABEL RESOLUTION ORDER, FROZEN:
//   1. ar && label_ar.trim()  → label_ar
//   2. en && label.trim()     → label
//   3. ar && blank label_ar   → FALL THROUGH TO 4, never to the English override
//   4. t(`${kind}.${key}`)
//   5. the raw key
// Rule 3 is the one that bites. An admin who renames only the English label
// must not blank the Arabic UI — and "fall back to English" is exactly the
// wrong repair, because it silently switches half a screen's language. This
// mirrors trackLabel()'s empty-not-null test in lib/labels.ts.
//
// MISSING TABLE IS FINE: if 0003 has not run, listVocab() fails, the row set
// stays empty, every resolver lands on step 4, and the app renders exactly as
// it does today. No DEFAULT_VOCAB shim exists, deliberately — FROZEN_KEYS plus
// the i18n bundles ALREADY are the default, and a second copy of the labels
// would be a second thing to keep in step. Every list below is therefore built
// by walking FROZEN_KEYS and enriching from whatever rows exist, not by mapping
// the rows: a table that is missing, empty or partial then degrades to the
// frozen order with frozen labels instead of emptying the pickers.
//
// HIDDEN SEMANTICS: hidden options leave pickers and board columns UNLESS
// entries currently hold that value — the board computes
// `visible ∪ statusesPresentInData`. Hiding an option must never hide data.
//
// `health` is deliberately NOT a vocab kind. Its four levels are computed by
// v_entry_health; making them configurable is one step from configuring the
// algorithm. Health colours stay global.css tokens.

import { useCallback, useMemo } from 'react'
import { create } from 'zustand'
import { listVocab } from '../api/config'
import { useLocale, type Locale } from '../lib/i18n'
import { hasSession } from './auth'
import { ar as arBundle, en as enBundle, type LocaleTree } from '../locales'
import type { EntryPriority, VocabKind, VocabRow } from '../types'

/** The view-model of one option: camelCase, label already resolved for a locale. */
export interface VocabItem {
  kind: VocabKind
  key: string
  label: string
  color: string | null
  hidden: boolean
  sortOrder: number
  staleAfterDays: number | null
  /** null = this priority has no SLA. Not zero, not a default — off. */
  slaDays: number | null
}

/** What the non-React resolvers read. `loadedAt: null` means never loaded. */
export interface VocabSnapshot {
  rows: readonly VocabRow[]
  loadedAt: number | null
}

const CACHE_KEY = 'opstrack_vocab_v1'

/** Same window store/config.ts uses; vocabulary changes about as often as tracks. */
const STALE_AFTER_MS = 30_000

/**
 * `kind:key` — the composite primary key of vocab_options, flattened. A nested
 * Map would need two lookups and a null check at every one of the ~20 call
 * sites that resolve a single label.
 */
type RowIndex = ReadonlyMap<string, VocabRow>

interface VocabState {
  rows: VocabRow[]
  index: RowIndex
  /** Stable object handed to the non-React resolvers; rebuilt only when rows change. */
  snapshot: VocabSnapshot
  loading: boolean
  loadedAt: number | null
}

function indexKey(kind: VocabKind, key: string): string {
  return `${kind}:${key}`
}

/**
 * Build the whole state slice from a row list, exactly as store/config.ts does,
 * so the derived views cannot drift from `rows`. NEVER build one of these inside
 * a selector — a selector returning a fresh Map returns a new reference every
 * render, which under useSyncExternalStore means "the snapshot changed" forever.
 */
function derive(rows: VocabRow[], loadedAt: number | null): Omit<VocabState, 'loading'> {
  return {
    rows,
    index: new Map(rows.map((row) => [indexKey(row.kind, row.key), row])),
    snapshot: { rows, loadedAt },
    loadedAt,
  }
}

/**
 * Last known vocabulary, for first paint. Without it every cold load renders
 * frozen English labels for a beat and then re-labels, which looks like a bug on
 * a workspace that renamed everything into Arabic.
 *
 * The try/catch also covers `localStorage` being undefined outright — this
 * module is imported by vocab.test.ts under vitest's node environment, where
 * there is no web storage at all.
 */
function readCache(): VocabRow[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Shape-check the composite key only: the realistic corruption is a cache
    // written by an older column set, and every consumer keys off (kind, key).
    return parsed.filter(
      (row): row is VocabRow =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as VocabRow).kind === 'string' &&
        typeof (row as VocabRow).key === 'string',
    )
  } catch {
    return []
  }
}

function writeCache(rows: VocabRow[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch {
    // Best effort: a full quota must not break a successful fetch.
  }
}

const useVocabStore = create<VocabState>(() => ({
  ...derive(readCache(), null),
  loading: false,
}))

// ── resolution ─────────────────────────────────────────────────────────────

/**
 * Step 4 of the resolution order, in an EXPLICIT locale.
 *
 * It reads the bundles rather than calling `t()` because `t()` resolves in the
 * CURRENT locale, and the digest renders in a locale it is handed while the UI
 * sits in the other one — a Wave-3 gate. The lookup is two levels deep and
 * nothing more, so this is not a second copy of i18n's dotted-path walker.
 *
 * Arabic falls back to the English string before falling back to the key,
 * mirroring what t() does, because a readable sentence in the wrong language
 * beats a bare `waiting_on` in a status pill.
 */
function i18nLabel(kind: VocabKind, key: string, locale: Locale): string {
  const primary = leaf(locale === 'ar' ? arBundle : enBundle, kind, key)
  if (primary !== undefined) return primary
  return leaf(enBundle, kind, key) ?? key
}

function leaf(tree: LocaleTree, ns: string, key: string): string | undefined {
  const branch = tree[ns]
  if (typeof branch !== 'object') return undefined
  const value = branch[key]
  return typeof value === 'string' ? value : undefined
}

/** The frozen resolution order, applied to one row (or to no row at all). */
function labelFrom(
  row: VocabRow | undefined,
  kind: VocabKind,
  key: string,
  locale: Locale,
): string {
  if (locale === 'ar') {
    const override = row?.label_ar.trim() ?? ''
    // Rule 3: a blank Arabic label falls THROUGH to the i18n default. It must
    // never reach for `row.label` — that is the English override, and using it
    // here is how half a screen ends up in the wrong language.
    return override !== '' ? override : i18nLabel(kind, key, locale)
  }
  const override = row?.label.trim() ?? ''
  return override !== '' ? override : i18nLabel(kind, key, locale)
}

/**
 * Every option of a kind, in display order.
 *
 * Driven by FROZEN_KEYS, not by the rows: a missing, empty or partially-seeded
 * vocab_options table must still produce a complete picker. A row, when there is
 * one, supplies the label override, the colour, the visibility and the two
 * thresholds; its sort_order supplies the position, falling back to the frozen
 * declaration order.
 */
function buildItems(
  index: RowIndex,
  kind: VocabKind,
  locale: Locale,
  includeHidden: boolean,
): VocabItem[] {
  const frozen = FROZEN_KEYS[kind]
  const items: VocabItem[] = []
  for (const [position, key] of frozen.entries()) {
    const row = index.get(indexKey(kind, key))
    const hidden = row?.hidden ?? false
    if (hidden && !includeHidden) continue
    items.push({
      kind,
      key,
      label: labelFrom(row, kind, key, locale),
      color: row?.color ?? null,
      hidden,
      sortOrder: row?.sort_order ?? position,
      staleAfterDays: row?.stale_after_days ?? null,
      slaDays: row?.sla_days ?? null,
    })
  }
  // Ties are possible — sort_order defaults to 0 and reorder_vocab only rewrites
  // the keys it was handed — so the frozen declaration order is the second key.
  // Without it the picker silently reshuffles between loads, which reads as data
  // moving on its own.
  items.sort(
    (a, b) => a.sortOrder - b.sortOrder || frozen.indexOf(a.key) - frozen.indexOf(b.key),
  )
  return items
}

function rowFrom(snapshot: VocabSnapshot, kind: VocabKind, key: string): VocabRow | undefined {
  return snapshot.rows.find((row) => row.kind === kind && row.key === key)
}

// ── hooks (visible-only unless the name says otherwise) ────────────────────
//
// Each subscribes to the stable `index` and resolves inside a useMemo/useCallback
// keyed on [index, locale]. The array-building must NOT move into the selector:
// that is the `getSnapshot should be cached` infinite loop store/config.ts's
// header documents.

export function useVocab(kind: VocabKind): VocabItem[] {
  const index = useVocabStore((s) => s.index)
  const locale = useLocale()
  return useMemo(() => buildItems(index, kind, locale, false), [index, kind, locale])
}

/** Includes hidden — the admin editor, and rendering a historic value. */
export function useVocabAll(kind: VocabKind): VocabItem[] {
  const index = useVocabStore((s) => s.index)
  const locale = useLocale()
  return useMemo(() => buildItems(index, kind, locale, true), [index, kind, locale])
}

export function useVocabLabel(): (kind: VocabKind, key: string) => string {
  const index = useVocabStore((s) => s.index)
  const locale = useLocale()
  // Memoised on [index, locale] so passing this into a memo'd list row does not
  // invalidate every row on every parent render.
  return useCallback(
    (kind: VocabKind, key: string) => labelFrom(index.get(indexKey(kind, key)), kind, key, locale),
    [index, locale],
  )
}

export function useVocabColor(): (kind: VocabKind, key: string) => string | null {
  const index = useVocabStore((s) => s.index)
  return useCallback(
    (kind: VocabKind, key: string) => index.get(indexKey(kind, key))?.color ?? null,
    [index],
  )
}

export function useStaleDays(): (p: EntryPriority) => number {
  const index = useVocabStore((s) => s.index)
  return useCallback(
    (p: EntryPriority) =>
      index.get(indexKey('priority', p))?.stale_after_days ?? DEFAULT_STALE_DAYS[p],
    [index],
  )
}

/** null when this priority has no SLA — every caller must handle it. */
export function useSlaDays(): (p: EntryPriority) => number | null {
  const index = useVocabStore((s) => s.index)
  return useCallback(
    (p: EntryPriority) => index.get(indexKey('priority', p))?.sla_days ?? null,
    [index],
  )
}

export function useVocabLoading(): boolean {
  return useVocabStore((s) => s.loading)
}

// ── non-React (digest, parser aliases, tests) ──────────────────────────────
//
// These exist because the digest renders in a locale it is HANDED, outside
// React entirely — an Arabic digest generated while the UI is English is a
// Wave-3 gate. A hook cannot serve that; a snapshot + explicit locale can.

export function getVocabSnapshot(): VocabSnapshot {
  return useVocabStore.getState().snapshot
}

export function vocabLabel(
  s: VocabSnapshot,
  kind: VocabKind,
  key: string,
  locale: Locale,
): string {
  return labelFrom(rowFrom(s, kind, key), kind, key, locale)
}

export function vocabItems(
  s: VocabSnapshot,
  kind: VocabKind,
  locale: Locale,
  o?: { includeHidden?: boolean },
): VocabItem[] {
  const index = new Map(s.rows.map((row) => [indexKey(row.kind, row.key), row]))
  return buildItems(index, kind, locale, o?.includeHidden ?? false)
}

export function staleDays(s: VocabSnapshot, p: EntryPriority): number {
  return rowFrom(s, 'priority', p)?.stale_after_days ?? DEFAULT_STALE_DAYS[p]
}

/**
 * null means this priority has no SLA, and that is a VALUE, not a missing
 * answer. Callers must not `?? someDefault` it — see DEFAULT_SLA_DAYS' absence
 * below.
 */
export function slaDays(s: VocabSnapshot, p: EntryPriority): number | null {
  return rowFrom(s, 'priority', p)?.sla_days ?? null
}

// ── loading ────────────────────────────────────────────────────────────────

/**
 * The load in progress. Concurrent callers (three pickers mounting at once, a
 * route change racing the focus listener) await this one promise instead of each
 * firing a request and writing the answer three times.
 */
let inFlight: Promise<void> | null = null

/**
 * Fetch the vocabulary unless a good copy is already in hand.
 *
 * Never rejects. A failure — including 0003 not being applied — leaves the row
 * set exactly as it was and logs; every resolver then lands on the frozen
 * defaults and the app renders as it did before sitting 2. Blowing up a route's
 * render because a label override could not be fetched would be a far worse
 * outcome than an un-renamed status pill.
 */
export function loadVocab(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useVocabStore.getState().loadedAt !== null) return Promise.resolve()

  // Only show the spinner when there is genuinely nothing to show; a focus
  // refetch with a warm cache must not blank the picker the user has open.
  if (useVocabStore.getState().rows.length === 0) {
    useVocabStore.setState({ loading: true })
  }

  inFlight = listVocab()
    .then((result) => {
      if (!result.ok) {
        console.warn('[vocab] load failed:', result.error)
        return
      }
      // An empty list from an UNAUTHENTICATED read is not an answer — see
      // hasSession(). Believing it stamps `loadedAt` and short-circuits every
      // load for the rest of the session.
      if (result.data.length === 0 && !hasSession()) {
        console.warn('[vocab] ignoring an empty read made without a session')
        return
      }
      useVocabStore.setState(derive(result.data, Date.now()))
      writeCache(result.data)
    })
    .finally(() => {
      inFlight = null
      useVocabStore.setState({ loading: false })
    })

  return inFlight
}

/**
 * Call after ANY vocab mutation — labels are read on every list row, and the
 * admin screens write through api/config.ts rather than through this store, so
 * nothing else would tell the rest of the app that a status was renamed.
 */
export function invalidateVocab(): void {
  useVocabStore.setState({ loadedAt: null })
  void loadVocab(true)
}

// A second admin (or the SQL editor) can change the vocabulary while this tab
// sits in the background, so returning to the tab is the natural moment to
// re-check. Gated on STALE_AFTER_MS: alt-tabbing fires focus constantly.
//
// Guarded on `window` because this is the one store with a vitest suite — the
// pure resolvers above are contract-tested, and vitest's node environment has no
// window to listen on.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    // Signed out, the read can only come back empty (RLS), and believing that
    // empty answer is exactly the bug hasSession() documents. Alt-tabbing on
    // the sign-in screen must not poison the cache.
    if (!hasSession()) return
    const { loadedAt } = useVocabStore.getState()
    if (loadedAt === null || Date.now() - loadedAt > STALE_AFTER_MS) void loadVocab(true)
  })
}

// ── frozen data ────────────────────────────────────────────────────────────

/**
 * The fallback v_entry_health coalesces over. Clearing an admin's
 * stale_after_days restores these rather than disabling staleness, so there is
 * no state in which an entry can never go stale.
 */
export const DEFAULT_STALE_DAYS: Readonly<Record<EntryPriority, number>> = Object.freeze({
  critical: 2,
  high: 4,
  medium: 8,
  low: 15,
})

/**
 * There is deliberately NO DEFAULT_SLA_DAYS, and that is not an oversight to be
 * repaired later. `sla_days` is the workspace's own commitment, edited in
 * /settings/vocabulary and seeded by migration 0003; a constant here would be a
 * SECOND answer to the same question, and the day the two disagreed every badge,
 * section and compliance percentage in the app would quietly follow the wrong
 * one. `slaDays()` returning null means "this priority has no SLA" — a value,
 * not a gap for a caller to fill in.
 */

/**
 * The keys, per kind. THE UI HAS NO ADD OR REMOVE CONTROL and this constant is
 * what an audit checks that against: fully-editable statuses admit a two-click
 * merge that silently rewrites every completed entry, non-undoably.
 *
 * It is also the SPINE of every list this module returns — see buildItems().
 * That is what makes an unapplied 0003 a non-event rather than an empty app.
 */
export const FROZEN_KEYS: Readonly<Record<VocabKind, readonly string[]>> = Object.freeze({
  status: Object.freeze(['new', 'in_progress', 'blocked', 'waiting_on', 'done', 'cancelled']),
  priority: Object.freeze(['low', 'medium', 'high', 'critical']),
  type: Object.freeze([
    'action',
    'decision',
    'issue',
    'request',
    'change',
    'escalation',
    'note',
  ]),
})
