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
   */
  profileLookups: [] as string[],
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
    },
    // loadProfile()'s chain. Offline it answers an error, which the store reads
    // as "keep whatever profile there is" — null on a first adopt.
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => {
          client.profileLookups.push(id)
          return {
            maybeSingle: () => Promise.resolve({ data: null, error: { message: 'offline' } }),
          }
        },
      }),
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
