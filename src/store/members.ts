// Members store: who can own work, cached and shared.
//
// Mirrors store/config.ts line for line, and that is deliberate — the two
// answer the same shape of question (a small list that changes about monthly
// and is read on every screen), so they should not have two different lifecycles
// for someone to learn twice. Same narrow selectors, same derived-once views,
// same cache-then-network first paint, same focus refetch gate.
//
// THE DERIVED VIEWS ARE COMPUTED WHEN DATA LANDS, NOT INSIDE THE SELECTORS. A
// selector that builds a Map on each call returns a new reference every render,
// which under useSyncExternalStore means "the snapshot changed" forever — an
// infinite re-render loop and, in dev, a `getSnapshot should be cached` warning.
// config.ts's header documents the same hazard; it is the single most expensive
// mistake available in this file.
//
// Needed in WAVE 1 because OwnerBadge, the owner picker and the filter bar all
// exist in Wave 1. Wave 4 adds the admin PAGE, not this store.

import { create } from 'zustand'
import { listMembers, type Member } from '../api/members'
import { t } from '../lib/i18n'

const CACHE_KEY = 'opstrack_members_v1'

/** How long a load stays fresh enough to skip the focus refetch. */
const STALE_AFTER_MS = 60_000

interface MembersState {
  members: Member[]
  /** Precomputed id → member lookup, stable by reference. */
  byId: Map<string, Member>
  loading: boolean
  /** Epoch ms of the last successful load; null means never loaded. */
  loadedAt: number | null
}

function derive(members: Member[]): Omit<MembersState, 'loading' | 'loadedAt'> {
  return { members, byId: new Map(members.map((m) => [m.id, m])) }
}

/**
 * Last known members, for first paint. Without it every entry row renders an
 * initial-less owner disc on cold load and then pops into a name — on a list of
 * sixty rows that reads as the page breaking and repairing itself.
 */
function readCache(): Member[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Shape-check one field rather than validating fully: the only realistic
    // corruption is a cache written by an older column set, and every consumer
    // keys off id.
    return parsed.filter(
      (row): row is Member =>
        typeof row === 'object' && row !== null && typeof (row as Member).id === 'string',
    )
  } catch {
    // Quota errors, private-mode restrictions, a hand-edited value — none of
    // them are worth failing a page load over.
    return []
  }
}

function writeCache(members: Member[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(members))
  } catch {
    // Best effort: a full quota must not break a successful fetch.
  }
}

const useMembersStore = create<MembersState>(() => ({
  ...derive(readCache()),
  loading: false,
  loadedAt: null,
}))

// ── selectors ──────────────────────────────────────────────────────────────

export function useMembers(): Member[] {
  return useMembersStore((s) => s.members)
}

export function useMemberMap(): ReadonlyMap<string, Member> {
  return useMembersStore((s) => s.byId)
}

export function useMembersLoading(): boolean {
  return useMembersStore((s) => s.loading)
}

/**
 * `ownerId → member.displayName` → `ownerName` → `t('entry.unassigned')`.
 *
 * A registered teammate and a free-text vendor DISPLAY AND FILTER IDENTICALLY
 * (spec §3) — that is the whole reason this is a resolver rather than a branch
 * at each of the fifteen call sites. An owner_id pointing at a deleted profile
 * falls through to ownerName and then to unassigned; it never renders a raw
 * uuid.
 *
 * A member row with a blank display name falls through too, for the same
 * reason: a name-shaped hole is worse than the honest "Unassigned", and blank
 * is what `profiles.display_name` holds when provisioning went half-done.
 */
export function useMemberLabel(): (ownerId?: string | null, ownerName?: string | null) => string {
  const byId = useMemberMap()
  // Returns a fresh closure whenever `byId` changes, which is exactly when the
  // answer changes. Consumers use it during render, not as an effect dep.
  return (ownerId, ownerName) => memberLabel(byId, ownerId, ownerName)
}

/** The resolver as a pure function, so the digest and tests can call it too. */
export function memberLabel(
  byId: ReadonlyMap<string, Member>,
  ownerId?: string | null,
  ownerName?: string | null,
): string {
  const named = ownerId ? byId.get(ownerId)?.displayName.trim() : ''
  if (named) return named
  const free = ownerName?.trim()
  if (free) return free
  return t('entry.unassigned')
}

// ── non-React reads ────────────────────────────────────────────────────────

/** For the digest builder and the parser's member list. */
export function getMembersSnapshot(): readonly Member[] {
  return useMembersStore.getState().members
}

/** id → member, without a subscription. Same Map the hook hands out. */
export function getMemberMap(): ReadonlyMap<string, Member> {
  return useMembersStore.getState().byId
}

// ── loading ────────────────────────────────────────────────────────────────

/**
 * The load in progress. Concurrent callers (the sheet, the picker and the
 * filter bar mounting together) await this one promise instead of each firing
 * their own request and writing the answer three times.
 */
let inFlight: Promise<void> | null = null

/**
 * Fetch members unless a good copy is already in hand.
 *
 * Safe to call unawaited (`void loadMembers()`) and safe to call twice
 * concurrently. It never rejects: a failure leaves whatever was cached in place
 * and logs, because an owner name is chrome on most screens and blowing up a
 * route's render for it would be a worse outcome than a stale name.
 */
export function loadMembers(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!force && useMembersStore.getState().loadedAt !== null) return Promise.resolve()

  // Only show the spinner when there is genuinely nothing to show. A focus
  // refetch with a warm cache must not blank the list the user is looking at.
  if (useMembersStore.getState().members.length === 0) {
    useMembersStore.setState({ loading: true })
  }

  inFlight = listMembers()
    .then((result) => {
      if (result.ok) {
        useMembersStore.setState({ ...derive(result.data), loadedAt: Date.now() })
        writeCache(result.data)
      } else {
        console.warn('[members] load failed:', result.error)
      }
    })
    .finally(() => {
      inFlight = null
      useMembersStore.setState({ loading: false })
    })

  return inFlight
}

/** Mark the cache stale and refetch. Call after any member mutation. */
export function invalidateMembers(): void {
  useMembersStore.setState({ loadedAt: null })
  void loadMembers(true)
}

/**
 * Drop everything on sign-out.
 *
 * The cache goes too: the next person to sign in on this device must not see
 * the previous workspace's roster in an owner picker for the one frame before
 * their own load lands.
 */
export function resetMembers(): void {
  useMembersStore.setState({ ...derive([]), loading: false, loadedAt: null })
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // Same best-effort reasoning as writeCache.
  }
}

// A second device (or the admin page) can add a member while this tab sits in
// the background, so returning to the tab is the natural moment to re-check.
// Gated on STALE_AFTER_MS: alt-tabbing between two windows fires focus
// constantly, and a request per switch is not worth a list that changes monthly.
window.addEventListener('focus', () => {
  const { loadedAt } = useMembersStore.getState()
  if (loadedAt === null || Date.now() - loadedAt > STALE_AFTER_MS) void loadMembers(true)
})
