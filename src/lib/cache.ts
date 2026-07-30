// Durable key-value storage, in one place.
//
// WHY THIS FILE EXISTS. Four stores (config, vocab, members, entries) each grew
// the same twenty lines: a `try { JSON.parse(localStorage.getItem(k)) } catch
// { return [] }` for first paint, and a `try { setItem } catch {}` for the
// write. The try/catch is not defensive noise — every one of those calls has
// three real failure modes (Safari's private mode throws on `setItem`, a full
// quota throws mid-session, and vitest's `node` environment has no
// `localStorage` at all) and forgetting one of them is a blank app rather than
// a stale one. Wave 4 adds a fifth caller whose data is not a cache but the
// user's unsent WRITES, so the handling stops being copy-paste and becomes a
// module.
//
// WHAT IT DELIBERATELY IS NOT. Not an eviction policy, not a TTL, not a
// namespace registry, and not an IndexedDB wrapper. The offline outbox holds
// tens of small ops, the entry cache holds 500 rows, and `localStorage`'s 5 MB
// synchronous store fits both with room to spare — while IDB would make every
// read `await`, which is precisely what a first-paint cache cannot be. The one
// thing a caller gets beyond `localStorage` is that NOTHING HERE THROWS and
// nothing here returns a half-parsed value.
//
// VERSIONING IS IN THE KEY, by the convention every existing caller already
// follows: `opstrack_entries_v1`. A shape change bumps the suffix, the old key
// is simply never read again, and there is no migration code to get wrong. That
// is why this module stores the caller's JSON verbatim rather than wrapping it
// in an envelope — an envelope would break the four keys already in the field.
//
// LAYERING: `src/lib/**` may not import from `src/store/**` or `src/api/**`.
// This module imports nothing at all, which is what lets store/outbox.ts use it.

/** Every key this app writes starts with it. Enforced in dev, see writeCache. */
export const CACHE_PREFIX = 'opstrack_'

/** The slice of the Storage interface this module uses. */
interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * The fallback store: a plain Map, used when there is no usable localStorage.
 *
 * It is NOT a silent downgrade to "no persistence" — it keeps read-after-write
 * working for the length of the tab, which is what stops a caller from having
 * to branch on availability. A queue that survives a route change but not a
 * reload is still worth far more than one that loses a write the moment
 * Safari's private mode refuses the first `setItem`.
 */
const memory = new Map<string, string>()

const memoryStore: KeyValueStore = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value)
  },
  removeItem: (key) => {
    memory.delete(key)
  },
}

/**
 * Resolve the backing store, on EVERY call rather than once at module load.
 *
 * Memoising it would be a micro-optimisation with a real cost: a test that
 * installs a `localStorage` shim after this module is imported (which is the
 * normal order — the shim goes in `vi.hoisted`, the module is imported by the
 * file under test) would be stuck with whatever was resolved first. The lookup
 * is a property read behind a try/catch; it does not show up in a profile.
 */
function backing(): KeyValueStore {
  try {
    // Reading the property can itself throw — some hardened browser configs
    // implement `localStorage` as a getter that raises a SecurityError rather
    // than returning undefined.
    const store = (globalThis as { localStorage?: KeyValueStore }).localStorage
    return store ?? memoryStore
  } catch {
    return memoryStore
  }
}

/**
 * Whether writes actually survive a reload.
 *
 * For callers that need to TELL the user — the outbox warns in the console when
 * queued writes are memory-only, because "your changes are saved on this
 * device" stops being true.
 */
export function isDurable(): boolean {
  return backing() !== memoryStore
}

/**
 * Read and validate one key. Returns null for absent, corrupt, or rejected.
 *
 * The `accept` callback is mandatory, and that is the point of the signature: a
 * cache is the one input to this app that is BOTH untrusted and shaped like
 * trusted data. It was written by an older version of this code, or by a user
 * with devtools open, and the realistic corruption — a row array from a
 * previous column set — parses perfectly as JSON. `accept` is where the caller
 * says what it will tolerate; returning null there is a normal answer, not an
 * error.
 */
export function readCache<T>(key: string, accept: (value: unknown) => T | null): T | null {
  let parsed: unknown
  try {
    const raw = backing().getItem(key)
    if (raw === null) return null
    parsed = JSON.parse(raw)
  } catch {
    // Absent storage, a SecurityError, or a hand-edited value. None of them is
    // worth failing a page load over — the caller renders its empty state and
    // the network fills it in.
    return null
  }
  try {
    return accept(parsed)
  } catch (e) {
    // A validator that throws is a caller bug, but it must not become a white
    // screen on boot, which is exactly when this runs.
    console.warn('[cache] validator threw for', key, e)
    return null
  }
}

/**
 * Write one key. Returns false if the value did not reach durable storage.
 *
 * The boolean is not decoration. A cache ignores it — a dropped cache write
 * costs a slower first paint next time. The outbox does NOT ignore it: false
 * there means the user's unsent writes are memory-only, which changes what the
 * app is allowed to promise them.
 *
 * A failed write LEAVES THE PREVIOUS VALUE IN PLACE. Clearing it on quota would
 * turn "the newest state did not persist" into "everything persisted so far is
 * gone", and for the outbox that is the difference between a stale queue and a
 * lost one.
 */
export function writeCache(key: string, value: unknown): boolean {
  if (import.meta.env.DEV && !key.startsWith(CACHE_PREFIX)) {
    // Not thrown: a mis-prefixed key still works. It just makes this app's
    // storage indistinguishable from another app's on the same origin, and
    // sign-out sweeps by prefix.
    console.warn(`[cache] key '${key}' is missing the '${CACHE_PREFIX}' prefix`)
  }
  let json: string
  try {
    json = JSON.stringify(value)
  } catch (e) {
    // A cycle, or a BigInt. Always a caller bug, never a storage problem.
    console.warn('[cache] value is not serialisable for', key, e)
    return false
  }
  try {
    backing().setItem(key, json)
    return true
  } catch (e) {
    // QuotaExceededError, or private-mode refusal.
    console.warn('[cache] write failed for', key, e)
    return false
  }
}

/** Drop one key. Sign-out calls this for every cache holding user rows. */
export function removeCache(key: string): void {
  try {
    backing().removeItem(key)
  } catch {
    // Nothing here is worth failing a sign-out over.
  }
  // The fallback store is swept too: a key written to memory while storage was
  // refusing writes must not outlive the account that produced it.
  memory.delete(key)
}
