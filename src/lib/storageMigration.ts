// The one-time rename of this app's storage namespace: `opstrack_` →
// `nphiescore_`.
//
// WHY THIS FILE EXISTS. Two people have this app INSTALLED, with live state in
// it, and one of the keys under the old prefix is not a cache at all: the
// offline outbox holds writes the user already made and the server has not seen
// yet. Renaming a constant would have left every one of those keys orphaned —
// the app would have opened in the wrong theme, in the wrong language, with an
// empty list and, once, with a queue of unsent work silently abandoned on disk.
// So the prefix moves by COPYING FORWARD, once, before anything reads.
//
// ── the four decisions in here ──────────────────────────────────────────────
//
// 1. IT RUNS AT MODULE SCOPE, and it is imported first by src/main.tsx. That is
//    the only place it can run. ES module imports are evaluated before the
//    importing module's first statement, and half this app reads storage during
//    that evaluation: lib/i18n.ts resolves the locale at module scope, and
//    store/entries, store/outbox, store/config, store/vocab, store/members and
//    store/labels each rehydrate their cache for first paint the same way. A
//    `migrate()` call in main.tsx's body would run after all of them. Anything
//    later than "first import of the entry module" is a build that opens once in
//    the wrong language with an empty list — nothing lost, but indistinguishable
//    from a bug by the person looking at it. lib/theme.ts and lib/i18n.ts import
//    this module directly as well, so the ordering holds through any future
//    entry point rather than resting on the import order of one file.
//
// 2. IT COPIES BYTES. `readRawCache`/`writeRawCache`, never JSON — `theme` and
//    `locale` hold the bare words `dark` and `ar`, not `"dark"` and `"ar"`. A
//    migration that parsed its payload could corrupt it; one that moves strings
//    cannot, and it needs no knowledge of any key's shape, which is what lets
//    the sweep below pick up keys this file has never heard of.
//
// 3. IT DELETES THE OLD KEY — after reading the new one back and finding it
//    identical, never before. This is the decision with a real argument on both
//    sides, so both are written down:
//
//      · FOR KEEPING: a reverted deploy (GitHub Pages, one click) puts the old
//        build back in front of a user whose keys have moved.
//      · FOR DELETING, and why it wins: sign-out removes the caches that hold
//        rows — `entries_v1`, `members_v1`, the outbox (store/auth.ts, and
//        store/signOutReset.test.ts holds it there). A legacy COPY of those
//        would not be in that list, so it would outlive the account that
//        produced it on a shared device. Keeping the old keys would introduce a
//        leak this app does not have today, which is not a trade a rename gets
//        to make. Second, the copy doubles this app's footprint at exactly the
//        moment it is least affordable; removing each source as it lands keeps
//        the peak at one copy, so a nearly-full store can still complete.
//        Third, the rollback case loses nothing anyway: every cache is refilled
//        from the server on the next load, and the one thing that cannot be
//        refetched — the queue — is not destroyed, it is sitting under the new
//        key waiting for the roll-forward.
//
//    The delete is conditional on a verified read-back for the obvious reason:
//    a source is removed only once its replacement has been proven to exist.
//
// 4. THE MARKER IS AUTHORITATIVE, and it is not just an optimisation. Re-running
//    the copy whenever a destination happens to be absent would look more
//    self-healing and would be a data hazard: sign-out REMOVES the outbox key,
//    so a stale legacy queue would be copied back in and its already-sent ops
//    replayed against the server. One copy, once, then never again.
//
// WHAT IS DELIBERATELY NOT MIGRATED. Supabase's own `sb-<ref>-auth-token` — it
// never carried this prefix, auth-js owns the name, and touching it signs
// everybody out. `format: 'opstrack-export'` and `LABEL_FILE_FORMAT` are magic
// values inside FILES, not storage keys, and are pinned as the old spelling on
// purpose (see lib/brand.test.ts). `@opstrack.internal` is a real email domain
// in auth.users. None of the three is a prefix.

import {
  CACHE_PREFIX,
  cacheKeysWithPrefix,
  readRawCache,
  removeCache,
  writeRawCache,
} from './cache'

/** The namespace every key in the field was written under before this build. */
export const LEGACY_PREFIX = 'opstrack_'

/**
 * Set once the copy has completed, so every later load costs one `getItem`.
 *
 * Under the NEW prefix, deliberately: it describes the state of this app's
 * storage, so it belongs in this app's namespace, and putting it under the old
 * one would leave a key behind that the sweep below would then try to migrate
 * into itself. Its value is a timestamp rather than `1` because the only person
 * who will ever read it is whoever has devtools open asking whether the
 * migration ran and when.
 */
export const MIGRATION_DONE_KEY = `${CACHE_PREFIX}storage_migrated_v1`

/**
 * The legacy keys this build knows about, IN THE ORDER THEY ARE COPIED.
 *
 * ORDER IS THE POINT. If storage refuses a write halfway — a full quota, a
 * private-mode refusal — whatever is already copied is what survives, so the
 * queue of unsent writes goes first because it is the only thing here that
 * cannot be fetched again. Theme and locale come next because they are what
 * makes the first paint correct; everything after them is a cache that the
 * network refills within a second of the app opening.
 *
 * THE LIST IS A FLOOR, NOT THE TRUTH. `cacheKeysWithPrefix` sweeps the store
 * for anything else under the old prefix, so a key added by another screen
 * after this was written still moves. The list exists because enumeration is
 * the one part of the Storage interface a shim may not implement, and because
 * it is the only way to state an order.
 */
const ORDERED_LEGACY_KEYS: readonly string[] = [
  'outbox_v1', // store/outbox.ts — UNSENT WRITES. Copied first, always.
  'theme', // lib/theme.ts, read before the first paint
  'locale', // lib/i18n.ts, read at module scope
  'entries_v1', // store/entries.ts
  'tracks_v1', // store/config.ts
  'track_groups_v1', // store/config.ts
  'members_v1', // store/members.ts
  'vocab_v1', // store/vocab.ts
  'label_overrides_v1', // store/labels.ts
  'mindtree_v1', // store/mindtree.ts
  'board_v1', // pages/Board.tsx
  'tree_v1', // pages/tracks/TracksIndex.tsx
  'digest_v1', // pages/Digest.tsx
].map((suffix) => `${LEGACY_PREFIX}${suffix}`)

/** The new-prefix name for a legacy key. Only the namespace changes. */
function renamed(legacyKey: string): string {
  return `${CACHE_PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`
}

/** The known keys first, then anything else the store happens to be holding. */
function legacyKeysInOrder(): string[] {
  const ordered = [...ORDERED_LEGACY_KEYS]
  const known = new Set(ordered)
  for (const key of cacheKeysWithPrefix(LEGACY_PREFIX)) {
    if (!known.has(key)) ordered.push(key)
  }
  return ordered
}

/**
 * Move one key. Returns false only when its value is still ONLY at the old name.
 *
 * A destination that already holds something is left exactly as it is and the
 * source is dropped: the new build has written it since, and the newer value is
 * the true one. Absent source, nothing to do.
 */
function moveOne(legacyKey: string): boolean {
  const raw = readRawCache(legacyKey)
  if (raw === null) return true
  const key = renamed(legacyKey)
  if (readRawCache(key) === null) {
    if (!writeRawCache(key, raw)) return false
    // Read back rather than trust the write. `setItem` is specified to throw on
    // quota, but this is the step that authorises a DELETE, and the cost of
    // being wrong is the user's unsent work. A store that silently dropped the
    // value keeps its original here instead.
    if (readRawCache(key) !== raw) return false
  }
  removeCache(legacyKey)
  return true
}

/**
 * Copy every `opstrack_*` key forward to `nphiescore_*`. Idempotent, and cheap
 * after the first run. NEVER THROWS.
 *
 * Exported for the tests and for anything that wants to be explicit; the app
 * gets it from the module-scope call at the bottom of this file.
 */
export function migrateLegacyStorage(): void {
  try {
    if (readRawCache(MIGRATION_DONE_KEY) !== null) return
    let complete = true
    for (const legacyKey of legacyKeysInOrder()) {
      // Deliberately not a `break`. A refused write on the 500-row entry cache
      // must not strand the 40 bytes of board preferences behind it — and since
      // each success frees the space its source occupied, carrying on is also
      // how a nearly-full store finishes.
      if (!moveOne(legacyKey)) complete = false
    }
    // Only a clean pass marks the job done, so a store that was full at boot
    // retries on the next load instead of stranding whatever it refused. The
    // retry is nearly free: every key that already moved is gone from the old
    // namespace and skipped in one `getItem`.
    if (complete) writeRawCache(MIGRATION_DONE_KEY, JSON.stringify(new Date().toISOString()))
  } catch (e) {
    // Unreachable through the calls above — every one of them is total. Kept
    // because of WHEN this runs: before React mounts, on the entry module's
    // first import, where a throw is a white screen rather than a stale value.
    // Not migrating is survivable; not booting is not.
    console.warn('[storage] migration failed', e)
  }
}

/**
 * A preference under the new prefix, falling back to its pre-rename name.
 *
 * WHY THE TWO PREFERENCES GET A SECOND DOOR AND THE CACHES DO NOT. `theme` and
 * `locale` are read during module evaluation and decide what the FIRST PAINT
 * looks like. If the migration above were ever to run late, or to be refused by
 * a full store, the visible result would be an app that opens in English on a
 * light background for someone who set neither — which reads as data loss even
 * though nothing was lost. One extra `getItem`, on a miss only, removes that
 * failure mode without depending on import order at all. A cache that misses
 * costs a slower first paint and is refilled from the network, so it is not
 * worth the same insurance.
 *
 * Returns the raw string, because these two values are not JSON. See
 * lib/cache.ts's `readRawCache`.
 */
export function readWithLegacyFallback(key: string): string | null {
  const value = readRawCache(key)
  if (value !== null) return value
  if (!key.startsWith(CACHE_PREFIX)) return null
  return readRawCache(`${LEGACY_PREFIX}${key.slice(CACHE_PREFIX.length)}`)
}

// THE SIDE EFFECT IS THE FEATURE — see decision 1 in the header. It is guarded
// the way lib/theme.ts guards its media-query listener: `window` exists in a
// browser and in the WKWebView, and does not exist in vitest's `node`
// environment, where a module-scope run would mutate storage that a test file
// has not installed yet. Every test in this module's suite calls
// `migrateLegacyStorage()` itself, which is also how they stay readable.
if (typeof window !== 'undefined') migrateLegacyStorage()
