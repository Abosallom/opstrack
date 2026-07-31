import { beforeEach, describe, expect, it, vi } from 'vitest'

// WHAT THIS FILE EXISTS FOR: sign-out has to hand the push registration back,
// and for one release it only handed back HALF of it.
//
// THE BUG. `resetPush()` cleared the store and called `unsubscribeThisDevice()`,
// which is browser-side only. Nothing deleted the matching
// `public.push_subscriptions` row, so a signed-out user's endpoint and both
// subscription keys stayed in the table. Measured live on 2026-07-30 during the
// Wave-5 push proof: subscribe through the UI, sign out through Settings, and
// `select count(*) from public.push_subscriptions` still answered 1.
//
// WHY IT MATTERED MORE THAN "STALE ROW". In the ordinary path the browser
// unsubscribe lands first, so the endpoint is dead at the push service and the
// next drain prunes the row on a 410. The sharp case is a sign-out with no
// network: `unsubscribeThisDevice()` swallows its own failure, so the row
// survives AND the registration is still live, and the next person to use that
// machine receives the previous user's notifications. RUNBOOK §9.4 step 9 calls
// that a blocker.
//
// WHY THE ORDERING TEST IS THE IMPORTANT ONE. `push_subscriptions` is owner-only
// RLS (migration 0011), so a delete issued after `supabase.auth.signOut()`
// matches no rows and returns **no error** — success and total failure are the
// same response. A test that only asserted "a delete was issued" would pass
// against a fix that deletes nothing, forever. So this file asserts the ORDER:
// the delete reaches the client before the sign-out does.

// Two browser globals lib/i18n reads at module scope, shimmed rather than
// mocked — same reasoning as store/settings.test.ts. Needed because the
// ordering test imports store/auth, which imports lib/i18n. Must run before the
// dynamic imports at the bottom; a static import would hoist above this.
const g = globalThis as { localStorage?: Storage; document?: Document }
if (!g.document) {
  g.document = { documentElement: { lang: '', dir: '' } } as unknown as Document
}
if (!g.localStorage) {
  const mem = new Map<string, string>()
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  } as unknown as Storage
}

/* ── the fake client ─────────────────────────────────────────────────────── */

interface DeleteCall {
  table: string
  filters: [string, unknown][]
}

const calls = {
  /** Every delete that was actually SUBSCRIBED to, with its filters. */
  deletes: [] as DeleteCall[],
  /** The one thing an RLS-shaped defect can be caught by: what happened first. */
  sequence: [] as string[],
}

/** Rows `push_subscriptions` selects answer with. */
let rows: unknown[] = []
/** What the delete comes back with, so the failure path can be exercised. */
let deleteError: { message: string; code?: string } | null = null

/**
 * A PostgREST-shaped builder: lazy like the real one, so a caller that only
 * CONSTRUCTS a delete records nothing — the distinction store/settings.test.ts
 * exists for.
 */
function builder(table: string) {
  const filters: [string, unknown][] = []
  let mode = ''
  const b = {
    select(_columns: string) {
      mode = 'select'
      return b
    },
    order() {
      return b
    },
    maybeSingle() {
      return b
    },
    upsert(_payload: unknown, _opts?: unknown) {
      mode = 'upsert'
      return b
    },
    delete() {
      mode = 'delete'
      return b
    },
    eq(column: string, value: unknown) {
      filters.push([column, value])
      return b
    },
    then(onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) {
      if (mode === 'delete') {
        calls.deletes.push({ table, filters })
        calls.sequence.push(`delete:${table}`)
        return Promise.resolve({ data: null, error: deleteError }).then(onfulfilled, onrejected)
      }
      if (mode === 'select') {
        return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected)
      }
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected)
    },
  }
  return b
}

const fakeClient = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-1' } } } }),
    signOut: () => {
      calls.sequence.push('auth.signOut')
      return Promise.resolve({ error: null })
    },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  },
  from: (table: string) => builder(table),
  rpc: () => Promise.resolve({ data: null, error: null }),
}

vi.mock('../api/supabase', () => ({
  supabase: fakeClient,
  isConfigured: () => true,
}))

/* ── the fake browser half ───────────────────────────────────────────────── */

/**
 * lib/push is mocked whole rather than shimmed: every function in it is a
 * ServiceWorkerRegistration away from the network, and what this file tests is
 * the store's SEQUENCING around them, not their behaviour. lib/push.test.ts
 * covers the pure half.
 */
const browser = {
  unsubscribe: (): Promise<string | null> => Promise.resolve(null),
  current: (): Promise<{ endpoint: string } | null> => Promise.resolve(null),
}

vi.mock('../lib/push', () => ({
  currentDeviceSubscription: () => browser.current(),
  unsubscribeThisDevice: () => browser.unsubscribe(),
  describeDevice: (ua: string) => ua,
  readEnvironment: () => ({
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: 'granted' as NotificationPermission,
    isIos: false,
    isStandalone: false,
    isNative: false,
  }),
  requestPermission: () => Promise.resolve('granted' as NotificationPermission),
  subscribeThisDevice: () => Promise.resolve(null),
  verdictFor: () => 'ready',
}))

// store/auth pulls this in for its once-per-sign-in recurrence catch-up, which
// has nothing to do with sign-out and would otherwise drag api/entries in.
vi.mock('../api/entries', () => ({
  materializeRecurring: () => Promise.resolve({ ok: true }),
}))

const { loadPushState, releasePushForSignOut, resetPush } = await import('./push')
const { signOut } = await import('./auth')

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-device'

beforeEach(async () => {
  browser.unsubscribe = () => Promise.resolve(null)
  browser.current = () => Promise.resolve(null)
  // The store is module state and survives between tests, so clear it with its
  // own teardown — with the browser mocks already blanked above, that teardown
  // finds no endpoint and issues nothing. Without this, a test that seeds an
  // endpoint would decide the next test's outcome.
  resetPush()
  await new Promise((r) => setTimeout(r, 0))
  calls.deletes = []
  calls.sequence = []
  rows = []
  deleteError = null
})

/** Endpoints handed to a `push_subscriptions` delete, in order. */
function deletedEndpoints(): unknown[] {
  return calls.deletes
    .filter((d) => d.table === 'push_subscriptions')
    .flatMap((d) => d.filters.filter(([col]) => col === 'endpoint').map(([, value]) => value))
}

/** Put the store in the state a signed-in, subscribed device is really in. */
async function seedSubscribedDevice(): Promise<void> {
  browser.current = () => Promise.resolve({ endpoint: ENDPOINT })
  rows = [
    {
      id: 'row-1',
      endpoint: ENDPOINT,
      user_agent: 'Mac · Chrome',
      created_at: '2026-07-30T09:00:00Z',
      last_seen_at: '2026-07-30T09:00:00Z',
    },
  ]
  await loadPushState()
  calls.deletes = []
  calls.sequence = []
}

describe('releasePushForSignOut', () => {
  it('deletes the row for the endpoint the unsubscribe handed back', async () => {
    browser.unsubscribe = () => Promise.resolve(ENDPOINT)

    await releasePushForSignOut()

    // THE REGRESSION ASSERTION. Before the fix this list was empty: the browser
    // subscription went and the row stayed.
    expect(deletedEndpoints()).toEqual([ENDPOINT])
  })

  it('still deletes the row when the unsubscribe THROWS', async () => {
    // The offline sign-out, which is the case that turns a stale row into a
    // live channel for somebody else's notifications. The endpoint is read
    // before the unsubscribe precisely so this path still has one.
    browser.current = () => Promise.resolve({ endpoint: ENDPOINT })
    browser.unsubscribe = () => Promise.reject(new Error('no service worker'))

    await releasePushForSignOut()

    expect(deletedEndpoints()).toEqual([ENDPOINT])
  })

  it('finds the endpoint at the browser when the store was never loaded', async () => {
    // Nothing calls loadPushState() unless the user opens Settings, so this is
    // the ordinary sign-out rather than an edge case.
    browser.current = () => Promise.resolve({ endpoint: ENDPOINT })
    browser.unsubscribe = () => Promise.resolve(null)

    await releasePushForSignOut()

    expect(deletedEndpoints()).toEqual([ENDPOINT])
  })

  it('prefers the unsubscribed endpoint over a stale one in the store', async () => {
    await seedSubscribedDevice()
    const rotated = `${ENDPOINT}-rotated`
    browser.unsubscribe = () => Promise.resolve(rotated)

    await releasePushForSignOut()

    expect(deletedEndpoints()).toEqual([rotated])
  })

  it('issues no delete at all when this browser has no subscription', async () => {
    await releasePushForSignOut()
    expect(calls.deletes).toEqual([])
  })

  it('does not reject when the delete fails', async () => {
    browser.unsubscribe = () => Promise.resolve(ENDPOINT)
    deleteError = { message: 'network', code: 'PGRST000' }

    await expect(releasePushForSignOut()).resolves.toBeUndefined()
  })

  it('does not reject when the browser has no endpoint AND throws looking', async () => {
    browser.current = () => Promise.reject(new Error('registrations unavailable'))
    browser.unsubscribe = () => Promise.reject(new Error('no service worker'))

    await expect(releasePushForSignOut()).resolves.toBeUndefined()
    expect(calls.deletes).toEqual([])
  })
})

describe('resetPush', () => {
  it('deletes the row for the endpoint it is about to clear from the store', async () => {
    await seedSubscribedDevice()
    // The browser has already forgotten it — the ONLY copy of the endpoint left
    // is the one in the store, and resetPush() is about to wipe it. Reading it
    // after the clear would delete nothing.
    browser.current = () => Promise.resolve(null)
    browser.unsubscribe = () => Promise.resolve(null)

    resetPush()
    await new Promise((r) => setTimeout(r, 0))

    expect(deletedEndpoints()).toEqual([ENDPOINT])
  })

  it('leaves nothing behind for a second pass to delete', async () => {
    await seedSubscribedDevice()
    browser.current = () => Promise.resolve(null)
    browser.unsubscribe = () => Promise.resolve(null)

    resetPush()
    await new Promise((r) => setTimeout(r, 0))
    calls.deletes = []

    // App.tsx's teardown fires resetPush() after store/auth.signOut() has
    // already released. The second pass must be a no-op rather than a second
    // round trip — which is only true if the first one cleared the endpoint.
    await releasePushForSignOut()

    expect(calls.deletes).toEqual([])
  })
})

describe('signOut sequencing', () => {
  it('issues the row delete BEFORE supabase.auth.signOut()', async () => {
    // The assertion the whole fix rests on. `push_subscriptions` is owner-only
    // RLS: a delete issued after the session is gone matches nothing and
    // returns no error, so ordering is the only observable that separates a
    // working cleanup from one that silently deletes nobody's row.
    browser.unsubscribe = () => Promise.resolve(ENDPOINT)

    await signOut()

    expect(calls.sequence).toEqual(['delete:push_subscriptions', 'auth.signOut'])
  })

  it('still signs out when the push cleanup finds nothing to release', async () => {
    await signOut()
    expect(calls.sequence).toEqual(['auth.signOut'])
  })

  it('still signs out when the push cleanup fails outright', async () => {
    browser.current = () => Promise.reject(new Error('registrations unavailable'))
    browser.unsubscribe = () => Promise.reject(new Error('no service worker'))

    await signOut()

    // Sign-out is not negotiable: a browser that cannot give its registration
    // back must still be able to end the session.
    expect(calls.sequence).toEqual(['auth.signOut'])
  })
})
