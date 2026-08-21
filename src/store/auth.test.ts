// Session restore on a cold start, and the one case it used to get wrong.
//
// THE FAILURE. `initAuth()` restores with `supabase.auth.getSession()`. auth-js
// treats a session inside EXPIRY_MARGIN_MS of expiry as expired and refreshes
// it; offline that refresh fails, and once the access token has ACTUALLY passed
// its expiry — at Supabase's default 3600 s TTL, any cold start more than an
// hour after last use — `getSession()` answers `{ session: null, error }`. That
// null flowed into `adopt(null)`, which put App.tsx on the signed-out branch: a
// sign-in form the user cannot submit, with the entry cache and every unsent
// offline capture sitting behind it. On a plane, in a basement DC, or the
// morning after — which is exactly when the offline story is supposed to pay
// off.
//
// THE FIX IS NOT A FABRICATED SESSION, and that is what these tests pin. auth-js
// removes the stored session when a refresh fails non-retryably against an
// expired token, and deliberately KEEPS it when the failure was the network. So
// "null with an error, and the credential is still on disk" means the credential
// is alive and unreachable — and the real stored object is what gets adopted.
// Every other shape (nothing stored, no error at all, a corrupt entry) must
// still land on the sign-in screen.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from './auth'

const STORAGE_KEY = 'sb-lrysgpbkmuqgzsjesfkr-auth-token'

const client = vi.hoisted(() => ({
  /** What getSession() will answer. */
  session: null as unknown,
  error: null as unknown,
  /** Registered by initAuth(); unused here but the client must offer it. */
  onChange: null as ((event: string, session: unknown) => void) | null,
  /**
   * Every id `loadProfile()` looked up. The store exposes no non-reactive read
   * of `session.user.id`, and this is the honest proxy for it: it is the id the
   * app will actually attribute work to.
   *
   * The two PERMISSION reads deliberately do not land here — see the mock below.
   * They ask about the same id, and counting them would make this assert "how
   * many queries fired" instead of "who the app thinks it is".
   */
  profileLookups: [] as string[],
  /** The `profiles` row itself. Offline by default, as every case above wants. */
  profileRow: null as unknown,
  profileError: { message: 'offline' } as unknown,
  /** `select('role_id')`. An ERROR here is what a pre-0025 database answers. */
  roleIdRow: null as unknown,
  roleIdError: null as unknown,
  /** `role_permissions` rows for that role_id. */
  permRows: [] as unknown[],
  permError: null as unknown,
  /** Every `table:columns` the store asked for, in order. */
  reads: [] as string[],
}))

vi.mock('../api/supabase', () => ({
  supabase: {
    // `protected` in the typings, a plain property at runtime. store/auth.ts
    // reads it rather than rebuilding `sb-<ref>-auth-token` from the URL,
    // because the client is what owns the name.
    storageKey: STORAGE_KEY,
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: client.session }, error: client.error }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        client.onChange = cb
        return { data: { subscription: { unsubscribe: (): void => {} } } }
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    /**
     * THREE READS, NOT ONE, so the mock has to know which is being made:
     * `loadProfile()`'s row, the profile's `role_id`, and the `role_permissions`
     * rows behind it. Offline the first answers an error, which the store reads
     * as "keep whatever profile there is" — null on a first adopt.
     *
     * `role_permissions` is read with no row terminator, because PostgREST's
     * builder is itself a thenable, so `.eq()` has to be awaitable as well as
     * chainable. That is not mock convenience: it is the shape of the real call.
     */
    from: (table: string) => ({
      select: (columns: string) => {
        client.reads.push(`${table}:${columns}`)
        const answer = (): { data: unknown; error: unknown } => {
          if (table === 'role_permissions') {
            return { data: client.permRows, error: client.permError }
          }
          if (columns === 'role_id') return { data: client.roleIdRow, error: client.roleIdError }
          return { data: client.profileRow, error: client.profileError }
        }
        return {
          eq: (_column: string, id: string) => {
            // Only the PROFILE row counts as an identity lookup — the two
            // permission reads ask about the same person and would turn the
            // assertion below into a query counter.
            if (table === 'profiles' && columns.includes('display_name')) {
              client.profileLookups.push(id)
            }
            return {
              maybeSingle: () => Promise.resolve(answer()),
              then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve(answer()).then(resolve),
            }
          },
        }
      },
    }),
  },
  isConfigured: () => true,
}))

vi.mock('../api/entries', () => ({
  materializeRecurring: () => Promise.resolve({ ok: true, data: null }),
}))

vi.mock('./push', () => ({
  releasePushForSignOut: () => Promise.resolve(),
}))

const cells = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string): string | null => cells.get(k) ?? null,
    setItem: (k: string, v: string): void => void cells.set(k, v),
    removeItem: (k: string): void => void cells.delete(k),
  },
})

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    setTimeout: (fn: () => void, ms?: number): number => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number): void => clearTimeout(id),
  },
})

/** A session as auth-js writes it: plain JSON under the client's storage key. */
function persisted(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'jwt.header.payload',
    refresh_token: 'refresh-abc',
    expires_at: Math.floor(Date.now() / 1000) - 60,
    token_type: 'bearer',
    user: { id: 'u-aziz', email: 'aziz@example.com' },
    ...over,
  }
}

/**
 * A fresh module registry per case: `initAuth()` latches on a module-scope
 * `wired` flag, so the restore path runs exactly once per import.
 */
async function boot(): Promise<typeof import('./auth')> {
  vi.resetModules()
  const mod = await import('./auth')
  mod.initAuth()
  // Two ticks: getSession().then → adopt() → loadProfile().then.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  return mod
}

/** The AuthRetryableFetchError auth-js raises when the link is down. */
const networkError = { name: 'AuthRetryableFetchError', message: 'Failed to fetch' }

beforeEach(() => {
  cells.clear()
  client.session = null
  client.error = null
  client.onChange = null
  client.profileLookups = []
  client.profileRow = null
  client.profileError = { message: 'offline' }
  client.roleIdRow = null
  client.roleIdError = null
  client.permRows = []
  client.permError = null
  client.reads = []
})

describe('initAuth — restoring a session', () => {
  it('adopts the live session on the ordinary path', async () => {
    client.session = { user: { id: 'u-aziz' } } as unknown as Session

    const mod = await boot()

    expect(mod.hasSession()).toBe(true)
  })

  it('keeps the shell up when the refresh could not reach the network', async () => {
    // getSession() answered null because the token expired and the refresh
    // failed — but auth-js left the credential in storage precisely because the
    // failure was retryable. THE ASSERTION THE BUG FAILED.
    cells.set(STORAGE_KEY, JSON.stringify(persisted()))
    client.session = null
    client.error = networkError

    const mod = await boot()

    expect(mod.hasSession()).toBe(true)
    // The REAL stored identity, not one this code invented.
    expect(client.profileLookups).toEqual(['u-aziz'])
  })

  it('signs out when the credential is genuinely gone', async () => {
    // A revoked or reused refresh token fails NON-retryably against an expired
    // access token, and auth-js removes the session itself. Nothing on disk,
    // nothing to restore — the sign-in screen is the right answer.
    client.session = null
    client.error = networkError

    const mod = await boot()

    expect(mod.hasSession()).toBe(false)
  })

  it('does not resurrect anything when getSession simply found nothing', async () => {
    // An empty or invalid store answers `{ session: null, error: null }`. A
    // leftover key with no refresh attempt behind it must not become a session.
    cells.set(STORAGE_KEY, JSON.stringify(persisted()))
    client.session = null
    client.error = null

    const mod = await boot()

    expect(mod.hasSession()).toBe(false)
  })

  it('refuses a stored entry that is not a usable session', async () => {
    // Half of `_isValidSession`'s check plus a user id, because the entries
    // store and the outbox's owner check both read it. A session without one
    // would be worse than none.
    cells.set(STORAGE_KEY, JSON.stringify({ access_token: 'a', refresh_token: 'b' }))
    client.session = null
    client.error = networkError

    const mod = await boot()

    expect(mod.hasSession()).toBe(false)
  })

  it('survives a corrupt stored value rather than failing the boot', async () => {
    cells.set(STORAGE_KEY, 'not json at all')
    client.session = null
    client.error = networkError

    const mod = await boot()

    expect(mod.hasSession()).toBe(false)
  })
})

// ── permissions ────────────────────────────────────────────────────────────
//
// THE ONE PLACE THAT ANSWERS "may this person do X", and the case that decides
// whether it can be deployed AT ALL: migration 0025 is unapplied on the live
// project, so `roles`, `role_permissions` and `profiles.role_id` do not exist
// and the read these hooks are built on CANNOT SUCCEED. Every test below is
// about one of the two halves of that:
//
//   * with the tables missing the store must reproduce today's behaviour
//     exactly, from the legacy `profiles.role` text column — an admin sees the
//     admin screens, a member does not;
//   * with the tables present it must find the Director, whom that same legacy
//     column reports as a plain 'member' because 0025 keeps it derived from the
//     two SYSTEM roles only.
//
// WHY THERE IS NO RENDER TEST OF `useHasPerm` HERE. zustand v5 answers a static
// server render from `getInitialState()`, not from the live store, so a
// renderToStaticMarkup probe would assert the EMPTY set no matter what had been
// loaded — a test that passes for the wrong reason. The hooks and `hasPerm()`
// share one `decide()` in the store, and it is `decide()` that these exercise.

/** A profile as adopt() would have published it. */
function person(role: 'admin' | 'member', id = 'u-aziz'): Profile {
  return { id, displayName: 'Aziz', role, locale: 'en' }
}

/** The module, with no session restore — these cases drive the store directly. */
async function fresh(): Promise<typeof import('./auth')> {
  vi.resetModules()
  return import('./auth')
}

/** What a pre-0025 database answers a `select('role_id')`: no such column. */
const noSuchColumn = { code: '42703', message: 'column profiles.role_id does not exist' }

describe('permissions — before migration 0025 has been applied', () => {
  it('gives an admin every key in the catalogue, from the legacy column alone', async () => {
    client.roleIdError = noSuchColumn
    const mod = await fresh()
    // Imported HERE, not at the top of the file: a module-scope import of
    // anything that pulls in api/supabase evaluates the vi.mock factory before
    // STORAGE_KEY is initialized, and the whole suite fails to load.
    const { ALL_PERMISSION_KEYS } = await import('../api/roles')

    await mod.loadPermissions(person('admin'))

    // Every key, by construction rather than by list: the fallback is derived
    // from PERMISSIONS, so a key added by a later migration cannot silently
    // start reading as "an admin may not".
    for (const key of ALL_PERMISSION_KEYS) expect(mod.hasPerm(key)).toBe(true)
    expect(mod.hasPerm('workspace.admin')).toBe(true)
  })

  it('gives a member capture.write and nothing else', async () => {
    client.roleIdError = noSuchColumn
    const mod = await fresh()

    await mod.loadPermissions(person('member'))

    expect(mod.hasPerm('capture.write')).toBe(true)
    expect(mod.hasPerm('workspace.admin')).toBe(false)
    expect(mod.hasPerm('structure.edit')).toBe(false)
    expect(mod.hasPerm('members.manage')).toBe(false)
  })

  it('does not latch the fallback — the next attempt still reads', async () => {
    // FIX-APP-6's lesson, and the reason `loadedAt` is stamped by the real read
    // only. The migration lands WHILE tabs are open; a fallback that cached
    // itself would leave every one of them on the legacy answer until sign-out.
    client.roleIdError = noSuchColumn
    const mod = await fresh()
    await mod.loadPermissions(person('member'))
    expect(mod.hasPerm('structure.edit')).toBe(false)

    // 0025 is applied in the SQL editor. Nothing signs out, nothing forces.
    client.roleIdError = null
    client.roleIdRow = { role_id: 'r-director' }
    client.permRows = [
      { role_id: 'r-director', permission_key: 'structure.edit', granted: true },
      { role_id: 'r-director', permission_key: 'vocab.edit', granted: true },
    ]
    await mod.loadPermissions(person('member'))

    expect(mod.hasPerm('structure.edit')).toBe(true)
  })
})

describe('permissions — with the roles tables in place', () => {
  it('finds the Director the legacy column reports as a plain member', async () => {
    // THE WHOLE FEATURE, in one case. 0025 keeps `profiles.role` derived from
    // the two system roles, so a Director reads 'member' there — and is offered
    // every screen the database has just opened to them anyway.
    client.roleIdRow = { role_id: 'r-director' }
    client.permRows = [
      { role_id: 'r-director', permission_key: 'structure.edit', granted: true },
      { role_id: 'r-director', permission_key: 'vocab.edit', granted: true },
    ]
    const mod = await fresh()

    await mod.loadPermissions(person('member'))

    expect(mod.hasPerm('structure.edit')).toBe(true)
    expect(mod.hasPerm('vocab.edit')).toBe(true)
    // And NOT the one that would let them delete a colleague — which is the
    // entire reason the role exists.
    expect(mod.hasPerm('workspace.admin')).toBe(false)
    // The real answer REPLACES the legacy one rather than joining it: a member's
    // fallback includes capture.write, and this role does not grant it.
    expect(mod.hasPerm('capture.write')).toBe(false)
  })

  it('reads an explicit deny as a deny, not as a grant', async () => {
    // `granted = false` is a row that exists on purpose (0025:236) — the switch
    // in the off position, and the audit trail of the moment it was turned off.
    client.roleIdRow = { role_id: 'r-director' }
    client.permRows = [
      { role_id: 'r-director', permission_key: 'structure.edit', granted: false },
    ]
    const mod = await fresh()

    await mod.loadPermissions(person('admin'))

    expect(mod.hasPerm('structure.edit')).toBe(false)
  })

  it('falls back on a null role_id, the way has_perm() does, and re-checks', async () => {
    // The half-applied state: the tables exist, the backfill has not run. The
    // database would answer this profile from `profiles.role`, so the client
    // does too — and leaves it unstamped, so the backfill is picked up on the
    // next auth event instead of being cached over.
    client.roleIdRow = { role_id: null }
    const mod = await fresh()

    await mod.loadPermissions(person('admin'))
    expect(mod.hasPerm('workspace.admin')).toBe(true)
    const readsAfterFirst = client.reads.length

    await mod.loadPermissions(person('admin'))
    expect(client.reads.length).toBeGreaterThan(readsAfterFirst)
  })

  it('costs one round trip per session, not one per caller', async () => {
    client.roleIdRow = { role_id: 'r-admin' }
    client.permRows = [
      { role_id: 'r-admin', permission_key: 'workspace.admin', granted: true },
    ]
    const mod = await fresh()

    await mod.loadPermissions(person('admin'))
    const readsAfterFirst = client.reads.length
    await mod.loadPermissions(person('admin'))

    expect(client.reads.length).toBe(readsAfterFirst)
  })
})

describe('permissions — the keys belong to the session, and end with it', () => {
  it('clears on sign-out', async () => {
    client.roleIdError = noSuchColumn
    const mod = await fresh()
    await mod.loadPermissions(person('admin'))
    expect(mod.hasPerm('workspace.admin')).toBe(true)

    await mod.signOut()

    expect(mod.hasPerm('workspace.admin')).toBe(false)
  })

  it('clears on resetPermissions, which Shell calls on teardown', async () => {
    client.roleIdError = noSuchColumn
    const mod = await fresh()
    await mod.loadPermissions(person('admin'))

    mod.resetPermissions()

    expect(mod.hasPerm('workspace.admin')).toBe(false)
    expect(mod.hasPerm('capture.write')).toBe(false)
  })

  it('never publishes a read that landed after the session it belonged to', async () => {
    // A shared device: sign-out (or another account) beats the in-flight read
    // home. Publishing then would hand the next person the previous member's
    // screens for the length of a profile round trip.
    client.roleIdRow = { role_id: 'r-admin' }
    client.permRows = [
      { role_id: 'r-admin', permission_key: 'workspace.admin', granted: true },
    ]
    const mod = await fresh()

    const inFlight = mod.loadPermissions(person('admin', 'u-first'))
    mod.resetPermissions()
    await inFlight

    expect(mod.hasPerm('workspace.admin')).toBe(false)
  })
})

describe('permissions — the two gates that are not the database', () => {
  it('makes useIsAdmin exactly the workspace.admin question', async () => {
    // `is_admin()` IS `has_perm('workspace.admin')` since 0025, so the client's
    // admin gate has to be the same question and not a wider one. The hook is a
    // one-line wrapper over the function asserted here — see the note above on
    // why a static render cannot see the store.
    client.roleIdRow = { role_id: 'r-admin' }
    client.permRows = [
      { role_id: 'r-admin', permission_key: 'workspace.admin', granted: true },
    ]
    const mod = await fresh()

    await mod.loadPermissions(person('member', 'u-promoted'))

    expect(mod.hasPerm('workspace.admin')).toBe(true)
    expect(typeof mod.useIsAdmin).toBe('function')
    expect(typeof mod.useHasPerm).toBe('function')
    expect(typeof mod.usePermissions).toBe('function')
  })

  it('opens every gate behind the dev-only ?shell preview flag', async () => {
    // The escape hatch carried over from the nine copies of useIsAdmin: without
    // it the settings screens are unreachable in a build with no Supabase
    // project, which is exactly where the layout and the RTL mirror get
    // reviewed. In a production build `import.meta.env.DEV` is the literal
    // false and Vite drops the branch, so the expectation is written against
    // DEV rather than against the test runner's mode.
    const win = (globalThis as unknown as { window: { location?: unknown } }).window
    win.location = { search: '?shell' }
    try {
      const mod = await fresh()
      expect(mod.hasPerm('vocab.edit')).toBe(import.meta.env.DEV)
    } finally {
      delete win.location
    }
  })

  it('does not throw where there is no window.location at all', async () => {
    // Every other case in this file runs against a `window` stubbed with four
    // functions and no location — currentHref()'s reason, and the reason the
    // flag is read through a widened shape rather than off the DOM typings.
    const mod = await fresh()
    expect(mod.hasPerm('workspace.admin')).toBe(false)
  })
})
