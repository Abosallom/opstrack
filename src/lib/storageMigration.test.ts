// The prefix rename, which gets exactly one chance to be right.
//
// WHAT IS ACTUALLY AT RISK. Two people have this app installed with live state,
// and one key under the old prefix — `opstrack_outbox_v1` — holds writes the
// user made that the server has never seen. Everything else here is a cache the
// network refills within a second; the queue is not, so it is asserted hardest:
// byte-identical, and copied FIRST, so that a store which refuses a write
// halfway has already saved the only thing that cannot be re-fetched.
//
// The shims below are the point of most of these tests. A real `localStorage`
// implements six members and always works; the ones this code meets in the
// field do not — Safari's private mode refuses `setItem`, a full quota starts
// refusing mid-session, a hardened browser makes `localStorage` a getter that
// raises, and vitest's `node` environment has no such global at all. Each has a
// shim here, because "the migration threw during module evaluation" is a white
// screen on boot, and it is the one outcome worse than not migrating.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_PREFIX, readRawCache, removeCache } from './cache'
import {
  LEGACY_PREFIX,
  MIGRATION_DONE_KEY,
  migrateLegacyStorage,
  readWithLegacyFallback,
} from './storageMigration'

/**
 * A realistic persisted outbox: the exact envelope store/outbox.ts writes, with
 * an op in it that the user typed and the server has not seen.
 *
 * Written out rather than imported so this test cannot start passing because
 * the outbox's own shape changed — the migration is supposed to be indifferent
 * to it, and this file is where that indifference is proven.
 */
const OUTBOX_JSON = JSON.stringify({
  owner: '9f2a9b0e-0000-4000-8000-000000000001',
  items: [
    {
      id: 'op_1',
      op: {
        table: 'entries',
        op: 'insert',
        id: null,
        tempId: 'temp_64f22421-3f2b-4d2c-9c4a-0f5f2f7d1a11',
        payload: {
          title: 'فحص وصلة الشبكة في الطابق الثالث',
          type: 'issue',
          priority: 'critical',
          dueDate: '2026-08-04',
        },
        dedupeKey: 'entries:insert:temp_64f22421:title,type,priority,dueDate',
        dependsOn: [],
      },
      attempts: 0,
      queuedAt: 1_754_300_000_000,
    },
  ],
})

/** Every legacy key this suite seeds, with a value that is not a placeholder. */
const SEED: Record<string, string> = {
  [`${LEGACY_PREFIX}outbox_v1`]: OUTBOX_JSON,
  // NOT JSON, and that is the case a JSON-aware migration would have destroyed.
  [`${LEGACY_PREFIX}theme`]: 'light',
  [`${LEGACY_PREFIX}locale`]: 'ar',
  [`${LEGACY_PREFIX}entries_v1`]: JSON.stringify([{ id: 'e1', title: 'Renew the SSL cert' }]),
  [`${LEGACY_PREFIX}tracks_v1`]: JSON.stringify([{ id: 't1', name: 'Network' }]),
  [`${LEGACY_PREFIX}track_groups_v1`]: JSON.stringify([{ id: 'g1', name: 'Infrastructure' }]),
  [`${LEGACY_PREFIX}members_v1`]: JSON.stringify([{ id: 'm1', display_name: 'Aziz' }]),
  [`${LEGACY_PREFIX}vocab_v1`]: JSON.stringify([{ id: 'v1', value: 'incident' }]),
  [`${LEGACY_PREFIX}label_overrides_v1`]: JSON.stringify({ en: { 'nav.board': 'Wall' }, ar: {} }),
  [`${LEGACY_PREFIX}mindtree_v1`]: JSON.stringify({ dimension: 'owner' }),
  [`${LEGACY_PREFIX}board_v1`]: JSON.stringify({ group: 'status' }),
  [`${LEGACY_PREFIX}tree_v1`]: JSON.stringify({ expanded: ['t1'] }),
  [`${LEGACY_PREFIX}digest_v1`]: JSON.stringify({ format: 'html' }),
}

/** A key no version of this app has ever written. The sweep must still move it. */
const UNKNOWN_KEY = `${LEGACY_PREFIX}some_future_screen_v3`

/** Keys belonging to other software on the same origin. Must not be touched. */
const FOREIGN: Record<string, string> = {
  'sb-abcdefgh-auth-token': '{"access_token":"eyJ..."}',
  'some-other-app:setting': 'x',
}

interface Shim {
  cells: Map<string, string>
  /** Every key handed to `setItem`, in order — the copy order, observably. */
  writes: string[]
}

/**
 * Install a store that behaves like a real `Storage`: three methods plus the
 * enumeration pair, which is what the sweep for unknown keys needs.
 *
 * `refuse` is the quota: a set of keys whose `setItem` throws, exactly as a full
 * store does, leaving every other key writable.
 */
function install(seed: Record<string, string>, refuse: ReadonlySet<string> = new Set()): Shim {
  const cells = new Map(Object.entries(seed))
  const writes: string[] = []
  const value = {
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k)
      if (refuse.has(k)) throw new DOMException('quota', 'QuotaExceededError')
      cells.set(k, v)
    },
    removeItem: (k: string) => {
      cells.delete(k)
    },
    get length() {
      return cells.size
    },
    key: (i: number) => [...cells.keys()][i] ?? null,
  }
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true })
  return { cells, writes }
}

/** The same store minus enumeration — the shape cache.test.ts installs. */
function installWithoutEnumeration(seed: Record<string, string>): Map<string, string> {
  const cells = new Map(Object.entries(seed))
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => cells.set(k, v),
      removeItem: (k: string) => cells.delete(k),
    },
    configurable: true,
    writable: true,
  })
  return cells
}

function newNameOf(legacyKey: string): string {
  return `${CACHE_PREFIX}${legacyKey.slice(LEGACY_PREFIX.length)}`
}

beforeEach(() => {
  // Every test installs its own store; this only guarantees no leftovers.
  Reflect.deleteProperty(globalThis, 'localStorage')
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
  // lib/cache.ts holds its in-memory fallback at MODULE scope, so a value
  // written while no localStorage existed would outlive the test that wrote it
  // — and the done-marker in particular would make the next test a no-op that
  // still passed. removeCache sweeps that map as well as the store.
  for (const key of [...Object.keys(SEED), UNKNOWN_KEY]) {
    removeCache(key)
    removeCache(newNameOf(key))
  }
  removeCache(MIGRATION_DONE_KEY)
  vi.restoreAllMocks()
})

describe('the forward copy', () => {
  it('moves every key this app has ever written, byte for byte', () => {
    const { cells } = install({ ...SEED, ...FOREIGN })

    migrateLegacyStorage()

    for (const [legacyKey, value] of Object.entries(SEED)) {
      expect(cells.get(newNameOf(legacyKey))).toBe(value)
    }
  })

  it('carries a populated outbox across intact, and copies it first', () => {
    // THE ONE THAT MATTERS. Everything else in this store can be fetched again;
    // these are writes the user already made offline and nobody else has a copy
    // of. Asserted as the exact string, because the queue is replayed by
    // JSON.parse and one changed byte is the whole queue dropped by acceptOp.
    const { cells, writes } = install(SEED)

    migrateLegacyStorage()

    expect(cells.get(`${CACHE_PREFIX}outbox_v1`)).toBe(OUTBOX_JSON)
    // Still parseable, still holding the user's Arabic title and their op.
    const restored: unknown = JSON.parse(cells.get(`${CACHE_PREFIX}outbox_v1`) ?? 'null')
    expect(restored).toEqual(JSON.parse(OUTBOX_JSON))
    // Order is a guarantee, not an accident: if the store refuses a write part
    // way through, what has already been copied is what survives.
    expect(writes[0]).toBe(`${CACHE_PREFIX}outbox_v1`)
  })

  it('preserves values that are not JSON', () => {
    // `theme` and `locale` hold bare words. A migration that round-tripped its
    // payload through JSON.parse would have thrown on both and lost them.
    const { cells } = install(SEED)

    migrateLegacyStorage()

    expect(cells.get(`${CACHE_PREFIX}theme`)).toBe('light')
    expect(cells.get(`${CACHE_PREFIX}locale`)).toBe('ar')
  })

  it('sweeps up a legacy key this file has never heard of', () => {
    // The hardcoded list is a floor and an order, not the truth. A screen that
    // added a key after this was written must still be migrated.
    const { cells } = install({ ...SEED, [UNKNOWN_KEY]: '{"kept":true}' })

    migrateLegacyStorage()

    expect(cells.get(newNameOf(UNKNOWN_KEY))).toBe('{"kept":true}')
  })

  it('leaves other software on the origin alone', () => {
    // localStorage is scoped to the ORIGIN, and api/supabase.ts's header says
    // this app shares one with whatever else is published under it. Supabase's
    // own session key is in that set: renaming it signs everybody out.
    const { cells } = install({ ...SEED, ...FOREIGN })

    migrateLegacyStorage()

    for (const [key, value] of Object.entries(FOREIGN)) expect(cells.get(key)).toBe(value)
    expect(cells.has(`${CACHE_PREFIX}abcdefgh-auth-token`)).toBe(false)
  })

  it('removes the old key once the copy is verified', () => {
    // The deliberate half of the design (storageMigration.ts, decision 3): a
    // legacy COPY of the entry cache or the outbox would not be in sign-out's
    // removal list, so it would outlive the account that produced it. Pinned so
    // that a later "be safe, keep both" cannot quietly reintroduce the leak.
    const { cells } = install(SEED)

    migrateLegacyStorage()

    for (const legacyKey of Object.keys(SEED)) expect(cells.has(legacyKey)).toBe(false)
  })

  it('migrates a store with no enumeration at all', () => {
    // Every key in the list still moves; only the sweep for unknown keys is
    // lost, which is why the list exists.
    const cells = installWithoutEnumeration({ ...SEED, [UNKNOWN_KEY]: 'x' })

    migrateLegacyStorage()

    expect(cells.get(`${CACHE_PREFIX}outbox_v1`)).toBe(OUTBOX_JSON)
    expect(cells.get(`${CACHE_PREFIX}theme`)).toBe('light')
    expect(cells.get(newNameOf(UNKNOWN_KEY))).toBeUndefined()
  })
})

describe('running it more than once', () => {
  it('is idempotent — a second pass copies nothing', () => {
    const { cells } = install(SEED)
    migrateLegacyStorage()
    const after = new Map(cells)

    migrateLegacyStorage()

    expect([...cells.entries()].sort()).toEqual([...after.entries()].sort())
  })

  it('does not clobber a value the new build has written since', () => {
    // The marker makes this unreachable in practice; it is asserted anyway
    // because "newer wins" has to hold on the one boot where the migration and
    // a write race, and because a marker that got cleared must not be able to
    // roll the user's state back.
    const { cells } = install(SEED)
    cells.set(`${CACHE_PREFIX}theme`, 'dark')

    migrateLegacyStorage()

    expect(cells.get(`${CACHE_PREFIX}theme`)).toBe('dark')
    expect(cells.has(`${LEGACY_PREFIX}theme`)).toBe(false)
  })

  it('never re-copies after the marker, even if a legacy key comes back', () => {
    // THIS IS WHY THE MARKER EXISTS, and it is a data-safety rule rather than a
    // performance one. Sign-out REMOVES the outbox key; a migration that re-ran
    // whenever the destination was absent would copy a stale queue back in and
    // replay ops that were sent weeks ago.
    const { cells } = install(SEED)
    migrateLegacyStorage()
    cells.delete(`${CACHE_PREFIX}outbox_v1`) // as sign-out does
    cells.set(`${LEGACY_PREFIX}outbox_v1`, OUTBOX_JSON) // a stale copy reappears

    migrateLegacyStorage()

    expect(cells.has(`${CACHE_PREFIX}outbox_v1`)).toBe(false)
  })

  it('costs one read once it is done', () => {
    const { cells } = install(SEED)
    migrateLegacyStorage()
    expect(cells.get(MIGRATION_DONE_KEY)).toBeDefined()

    const reads: string[] = []
    const store = globalThis.localStorage as unknown as { getItem: (k: string) => string | null }
    const real = store.getItem.bind(store)
    store.getItem = (k: string) => {
      reads.push(k)
      return real(k)
    }

    migrateLegacyStorage()

    expect(reads).toEqual([MIGRATION_DONE_KEY])
  })
})

describe('a store that fights back', () => {
  it('does not throw when there is no localStorage at all', () => {
    // vitest's `node` environment, and a WKWebView with storage disabled. This
    // runs during module evaluation, so a throw here is a blank app.
    expect(() => {
      migrateLegacyStorage()
    }).not.toThrow()
  })

  it('does not throw when reading localStorage raises', () => {
    // Some hardened browser configurations implement the property as a getter
    // that throws a SecurityError rather than returning undefined.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })

    expect(() => {
      migrateLegacyStorage()
    }).not.toThrow()
  })

  it('keeps everything already copied when the quota runs out mid-migration', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The entry cache is the big one and the realistic place to run out. It is
    // deliberately NOT first in the copy order, so this is also the assertion
    // that the order buys what it is supposed to buy.
    const { cells } = install(SEED, new Set([`${CACHE_PREFIX}entries_v1`]))

    migrateLegacyStorage()

    // The queue went first and is safe.
    expect(cells.get(`${CACHE_PREFIX}outbox_v1`)).toBe(OUTBOX_JSON)
    expect(cells.get(`${CACHE_PREFIX}theme`)).toBe('light')
    // The refused key was NOT deleted from its old home: a source is dropped
    // only once its copy has been read back.
    expect(cells.get(`${LEGACY_PREFIX}entries_v1`)).toBe(SEED[`${LEGACY_PREFIX}entries_v1`])
    // And the run does not stop at the failure — the keys after it still moved.
    expect(cells.get(`${CACHE_PREFIX}board_v1`)).toBe(SEED[`${LEGACY_PREFIX}board_v1`])
    // Unfinished, so it is not marked done.
    expect(cells.has(MIGRATION_DONE_KEY)).toBe(false)
  })

  it('finishes the job on the next load once there is room again', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refuse = new Set([`${CACHE_PREFIX}entries_v1`])
    const { cells } = install(SEED, refuse)
    migrateLegacyStorage()
    refuse.clear() // the user deleted something; the store accepts writes again

    migrateLegacyStorage()

    expect(cells.get(`${CACHE_PREFIX}entries_v1`)).toBe(SEED[`${LEGACY_PREFIX}entries_v1`])
    expect(cells.has(`${LEGACY_PREFIX}entries_v1`)).toBe(false)
    expect(cells.has(MIGRATION_DONE_KEY)).toBe(true)
  })

  it('keeps the value when a write is accepted and silently dropped', () => {
    // A store that answers `setItem` without storing anything is not
    // hypothetical — it is what some private-mode implementations did before
    // they started throwing. The read-back is what turns that into "copy
    // failed" instead of "deleted the original".
    const cells = new Map(Object.entries(SEED))
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => cells.get(k) ?? null,
        setItem: () => {},
        removeItem: (k: string) => cells.delete(k),
        get length() {
          return cells.size
        },
        key: (i: number) => [...cells.keys()][i] ?? null,
      },
    })

    migrateLegacyStorage()

    expect(cells.get(`${LEGACY_PREFIX}outbox_v1`)).toBe(OUTBOX_JSON)
    expect(cells.has(MIGRATION_DONE_KEY)).toBe(false)
  })
})

describe('the first-paint fallback', () => {
  it('reads the pre-rename key when the new one is absent', () => {
    // The belt-and-braces half: lib/theme.ts and lib/i18n.ts resolve their key
    // during module evaluation, and neither may depend on the migration having
    // succeeded to open the app in the right language.
    install({ [`${LEGACY_PREFIX}locale`]: 'ar' })

    expect(readWithLegacyFallback(`${CACHE_PREFIX}locale`)).toBe('ar')
  })

  it('prefers the new key when both exist', () => {
    install({ [`${LEGACY_PREFIX}locale`]: 'ar', [`${CACHE_PREFIX}locale`]: 'en' })

    expect(readWithLegacyFallback(`${CACHE_PREFIX}locale`)).toBe('en')
  })

  it('answers null for a key outside this app, rather than inventing one', () => {
    install({ 'sb-abcdefgh-auth-token': 'x' })

    expect(readWithLegacyFallback('sb-abcdefgh-auth-token')).toBe('x')
    expect(readWithLegacyFallback(`${CACHE_PREFIX}nothing_here`)).toBeNull()
  })

  it('does not throw with no storage at all', () => {
    expect(readWithLegacyFallback(`${CACHE_PREFIX}locale`)).toBeNull()
  })
})

/* ───────────────────── the half that is not in this module ────────────────── */

// Source is read through import.meta.glob('?raw'), not node:fs, for the reason
// lib/localeReach.test.ts spells out: tsconfig.app.json pins
// `types: ["vite/client"]`, and widening it would leak node globals into the
// type space of every app file.
const SOURCES: Record<string, string> = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** This module owns the old prefix as data; nothing else may still define one. */
const OWNS_THE_OLD_PREFIX = ['storageMigration.ts', 'storageMigration.test.ts']

function mainSource(): string {
  const text = SOURCES['../main.tsx']
  if (text === undefined) throw new Error('src/main.tsx not found by import.meta.glob')
  return text
}

/** Every module specifier `src/main.tsx` imports, in evaluation order. */
function mainImports(): string[] {
  const out: string[] = []
  const RE = /^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null = RE.exec(mainSource())
  while (m !== null) {
    out.push(m[1] ?? '')
    m = RE.exec(mainSource())
  }
  return out
}

describe('the order it runs in', () => {
  it('is the first thing src/main.tsx imports', () => {
    // NOT A STYLE RULE. ES imports are evaluated before the importing module's
    // first statement, and `./App` drags in six stores that each rehydrate
    // their cache during evaluation. If this import moves below any of them,
    // they read the new prefix before anything has written it: the app opens
    // once with an empty list, in English, with no queued writes visible. A
    // `migrateLegacyStorage()` CALL anywhere in that file would be too late for
    // the same reason, which is why the import is bare.
    expect(mainImports()[0]).toBe('./lib/storageMigration')
  })

  it('has already run by the time lib/i18n resolves the locale', async () => {
    // The mechanism, demonstrated end to end on the reader that is hardest to
    // order: i18n.ts resolves its key AT MODULE SCOPE, so nothing but an import
    // can get in front of it — and it imports this module for exactly that.
    //
    // The two assertions about the store are things ONLY the migration could
    // have done: the legacy fallback would answer `ar` either way, but it does
    // not move the value or drop the old key. `resetModules` is what makes the
    // module-scope run happen again in a suite that has already imported it
    // once, since a module body runs on first evaluation and never after.
    const { cells } = install({ [`${LEGACY_PREFIX}locale`]: 'ar' })
    // The run is guarded on `window`, which vitest's node environment does not
    // have. This is the browser.
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
    vi.resetModules()
    try {
      const i18n = await import('./i18n')
      expect(cells.has(`${LEGACY_PREFIX}locale`)).toBe(false)
      expect(cells.get(`${CACHE_PREFIX}locale`)).toBe('ar')
      expect(i18n.getLocale()).toBe('ar')
    } finally {
      Reflect.deleteProperty(globalThis, 'window')
      vi.resetModules()
    }
  })
})

describe('the rest of the app agrees about the prefix', () => {
  it('has no storage key left under the old namespace', () => {
    // THE TRIPWIRE, and the most important assertion in this file.
    //
    // The copy above DELETES each legacy key once its replacement is verified.
    // That is safe exactly as long as every reader has moved to the new name in
    // the same build — and those readers live in files this module does not
    // own (store/entries.ts, store/outbox.ts, store/config.ts, store/vocab.ts,
    // store/members.ts, store/labels.ts, store/mindtree.ts, pages/Board.tsx,
    // pages/Digest.tsx, pages/tracks/TracksIndex.tsx). If one of them is left
    // behind, its data is moved to a key nobody reads and the old key is gone,
    // and for `outbox_v1` that is the user's unsent work.
    //
    // So the two halves are pinned together here rather than trusted to land
    // together. The pattern is a QUOTED key — `'opstrack_board_v1'`, wherever it
    // is written, since the test files seed one by hand as often as the source
    // defines one. Backticks are deliberately not matched: this codebase names
    // old keys in prose inside backticks, and those notes are history worth
    // keeping rather than defects.
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !OWNS_THE_OLD_PREFIX.some((own) => path.endsWith(own)))
      .filter(([, text]) => /['"]opstrack_/.test(text))
      .map(([path]) => path)

    expect(
      offenders,
      'these files still define a storage key under the retired prefix; ' +
        `rename the literal to '${CACHE_PREFIX}…' so the forward copy in ` +
        'lib/storageMigration.ts hands it to a reader that is looking for it',
    ).toEqual([])
  })

  it('reads a plausible number of files, so the check above is not vacuous', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
  })
})

describe('the marker', () => {
  it('lives under the new prefix, so it is not something to migrate', () => {
    expect(MIGRATION_DONE_KEY.startsWith(CACHE_PREFIX)).toBe(true)
    expect(MIGRATION_DONE_KEY.startsWith(LEGACY_PREFIX)).toBe(false)
  })

  it('records when the copy ran', () => {
    install(SEED)

    migrateLegacyStorage()

    const raw = readRawCache(MIGRATION_DONE_KEY)
    expect(raw).not.toBeNull()
    expect(typeof (JSON.parse(raw ?? 'null') as unknown)).toBe('string')
  })

  it('is written on a fresh install with nothing to copy', () => {
    const { cells } = install({})

    migrateLegacyStorage()

    expect(cells.has(MIGRATION_DONE_KEY)).toBe(true)
  })
})
