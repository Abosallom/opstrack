// Web Push, app side: this device's subscription, the user's other devices, and
// the three per-kind preferences.
//
// SHAPE. Narrow selectors, one store, derived values computed when data lands —
// the same lifecycle as store/config.ts and store/members.ts. It is small enough
// that it holds its own reads rather than going through an `api/` module, exactly
// as store/settings.ts does for the profile locale mirror: two selects, one RPC
// and two writes, all against tables this store is the only consumer of.
//
// NOT THROUGH THE OUTBOX SEAM, and this is the one deliberate exception to
// contracts rule 3. Every other write in the app queues while offline because the
// user's INTENT survives a bad connection. A push subscription does not: the
// three strings are minted by the browser's push service in a live round trip,
// they expire, and a browser is free to rotate them the moment it reconnects. A
// queued subscribe would drain later and store keys that may already be dead —
// producing a device that looks registered and receives nothing, which is worse
// than an honest "you are offline, try again". `enablePushOnThisDevice()`
// therefore reports failure instead of queueing.
//
// NOTHING HERE PROMPTS ON LOAD. `loadPushState()` reads, repairs and reports; the
// OS permission dialog is only ever reached from `enablePushOnThisDevice()`,
// which is only ever called from a button. lib/push.ts's header says why.

import { create } from 'zustand'
import { supabase } from '../api/supabase'
import { pgErrorKey } from '../lib/pgError'
import {
  currentDeviceSubscription,
  describeDevice,
  readEnvironment,
  requestPermission,
  subscribeThisDevice,
  unsubscribeThisDevice,
  verdictFor,
  type DeviceSubscription,
  type PushEnvironment,
  type PushVerdict,
} from '../lib/push'

/** One registered browser, as the settings screen lists it. */
export interface PushDevice {
  id: string
  endpoint: string
  /** Already humanised by lib/push.describeDevice(); may be ''. */
  label: string
  createdAt: string
  lastSeenAt: string
  /** True for the browser the user is reading this on. */
  isThisDevice: boolean
}

/**
 * The three switches, and the three columns of `notification_prefs`.
 *
 * `enabled` is the master mute and is deliberately NOT the same thing as "this
 * device is subscribed": muting keeps the subscription, so coming back is a tap
 * rather than another permission dance. 0011's header explains why these govern
 * push only and not the in-app inbox.
 */
export interface PushPrefs {
  enabled: boolean
  assigned: boolean
  completed: boolean
}

/** A missing prefs row means all on — see 0011 PART 2. */
const DEFAULT_PREFS: PushPrefs = { enabled: true, assigned: true, completed: true }

interface PushState {
  verdict: PushVerdict
  permission: NotificationPermission
  /** This device's endpoint when it is both subscribed AND stored; else null. */
  endpoint: string | null
  devices: PushDevice[]
  prefs: PushPrefs
  loading: boolean
  /** A write is in flight. One flag: the whole card disables together. */
  busy: boolean
  /** An i18n KEY, never a sentence. Render as t(err). */
  error: string | null
}

const usePushStore = create<PushState>(() => ({
  // 'unsupported' until proven otherwise: the store is imported by a node test
  // and by the settings route, and neither may assume a window exists.
  verdict: 'unsupported',
  permission: 'default',
  endpoint: null,
  devices: [],
  prefs: DEFAULT_PREFS,
  loading: false,
  busy: false,
  error: null,
}))

// ── selectors ──────────────────────────────────────────────────────────────

export function usePushVerdict(): PushVerdict {
  return usePushStore((s) => s.verdict)
}

export function usePushPermission(): NotificationPermission {
  return usePushStore((s) => s.permission)
}

/** Is THIS browser registered? The master switch's state. */
export function useThisDeviceSubscribed(): boolean {
  return usePushStore((s) => s.endpoint !== null)
}

export function usePushDevices(): PushDevice[] {
  return usePushStore((s) => s.devices)
}

export function usePushPrefs(): PushPrefs {
  return usePushStore((s) => s.prefs)
}

export function usePushLoading(): boolean {
  return usePushStore((s) => s.loading)
}

export function usePushBusy(): boolean {
  return usePushStore((s) => s.busy)
}

/** An i18n KEY. */
export function usePushError(): string | null {
  return usePushStore((s) => s.error)
}

// ── plumbing ───────────────────────────────────────────────────────────────

interface SubscriptionRow {
  id: string
  endpoint: string
  user_agent: string
  created_at: string
  last_seen_at: string
}

/**
 * The signed-in user's id, read from Supabase rather than from store/auth.
 *
 * Same reasoning as store/settings.ts: this store would otherwise depend on the
 * auth store's load order for a value the client already holds authoritatively.
 */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

function toDevice(row: SubscriptionRow, thisEndpoint: string | null): PushDevice {
  return {
    id: row.id,
    endpoint: row.endpoint,
    label: describeDevice(row.user_agent),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    isThisDevice: thisEndpoint !== null && row.endpoint === thisEndpoint,
  }
}

/** Persist a browser subscription. Returns an i18n key on failure, else null. */
async function storeSubscription(sub: DeviceSubscription): Promise<string | null> {
  if (!supabase) return 'common.notConfigured'
  const { error } = await supabase.rpc('upsert_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
    p_user_agent: sub.userAgent,
  })
  if (error) {
    console.warn('[push] storing the subscription failed:', error.message)
    return pgErrorKey(error)
  }
  return null
}

// ── loading ────────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null

/**
 * Read the whole picture: what the browser can do, what it is subscribed to,
 * what this account has registered, and the preferences.
 *
 * IT ALSO REPAIRS. A browser may rotate a subscription on its own — after a long
 * offline spell, a storage eviction, or a `pushsubscriptionchange` this app was
 * not running to hear. The endpoint then in `push_subscriptions` is dead, every
 * send 410s, and push silently stops working forever with the UI still showing
 * "on". So when the browser holds a subscription that this account has not
 * stored, it is stored here — no prompt is involved, because permission was
 * already granted; that is what made the browser hand it over.
 *
 * Never rejects. A failure leaves the last known state and logs.
 */
export function loadPushState(): Promise<void> {
  if (inFlight) return inFlight

  const env = readEnvironment()
  usePushStore.setState({
    verdict: verdictOf(env),
    permission: env.permission,
    loading: true,
    error: null,
  })

  inFlight = (async () => {
    try {
      const browserSub = env.permission === 'granted' ? await currentDeviceSubscription() : null
      const rows = await fetchRows()

      if (browserSub && rows !== null && !rows.some((r) => r.endpoint === browserSub.endpoint)) {
        // The repair. Fire it, then re-read, so the list the user sees includes
        // the device they are holding.
        const failure = await storeSubscription(browserSub)
        if (!failure) {
          const repaired = await fetchRows()
          if (repaired !== null) {
            applyRows(repaired, browserSub.endpoint)
            return
          }
        }
      }

      if (rows !== null) applyRows(rows, browserSub?.endpoint ?? null)
      await loadPrefs()
    } finally {
      inFlight = null
      usePushStore.setState({ loading: false })
    }
  })()

  return inFlight
}

/** lib/push's verdict, plus the one case only this store can see. */
function verdictOf(env: PushEnvironment): PushVerdict {
  // A build with no Supabase credentials cannot STORE a subscription, so the
  // browser being capable is beside the point — offering the switch would be
  // offering a button that can only fail. Same 'not configured' degradation
  // every api/ function performs.
  if (!supabase) return 'unsupported'
  return verdictFor(env)
}

async function fetchRows(): Promise<SubscriptionRow[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('push_subscriptions')
    // Narrow, per the hard rules — and `p256dh`/`auth` are deliberately absent:
    // the UI never needs the device keys, so they never leave the database.
    .select('id, endpoint, user_agent, created_at, last_seen_at')
    .order('last_seen_at', { ascending: false })
  if (error) {
    console.warn('[push] device list failed:', error.message)
    usePushStore.setState({ error: pgErrorKey(error) })
    return null
  }
  return (data ?? []) as SubscriptionRow[]
}

function applyRows(rows: SubscriptionRow[], thisEndpoint: string | null): void {
  const mine = thisEndpoint !== null && rows.some((r) => r.endpoint === thisEndpoint)
  usePushStore.setState({
    devices: rows.map((row) => toDevice(row, thisEndpoint)),
    // Subscribed means BOTH halves agree: the browser has a subscription and this
    // account has stored it. Either alone is a broken state, and showing "on" for
    // it is how a user ends up waiting for notifications that cannot arrive.
    endpoint: mine ? thisEndpoint : null,
  })
}

async function loadPrefs(): Promise<void> {
  if (!supabase) return
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('push_enabled, push_assigned, push_completed')
    .maybeSingle()
  if (error) {
    console.warn('[push] prefs failed:', error.message)
    return
  }
  const row = data as {
    push_enabled: boolean
    push_assigned: boolean
    push_completed: boolean
  } | null
  usePushStore.setState({
    prefs: row
      ? { enabled: row.push_enabled, assigned: row.push_assigned, completed: row.push_completed }
      : DEFAULT_PREFS,
  })
}

// ── writes ─────────────────────────────────────────────────────────────────

/**
 * Turn push on for this browser. MUST be called from a user gesture.
 *
 * Returns an i18n key on failure and null on success, matching the convention
 * store/auth.ts uses for its form-facing calls — the caller shows it inline next
 * to the switch that failed rather than as a toast, because the switch is what
 * did not move.
 *
 * The order matters: permission first (the expensive, irreversible step), then
 * subscribe, then store. Storing before subscribing would leave a row for a
 * device that then refused, and every send to it would 410.
 */
export async function enablePushOnThisDevice(): Promise<string | null> {
  if (usePushStore.getState().busy) return null
  usePushStore.setState({ busy: true, error: null })
  try {
    const permission = await requestPermission()
    usePushStore.setState({ permission })
    if (permission !== 'granted') {
      // 'default' means the user dismissed the dialog without choosing, which is
      // not the same as saying no — the wording distinguishes them.
      const key = permission === 'denied' ? 'push.errDenied' : 'push.errDismissed'
      usePushStore.setState({ verdict: permission === 'denied' ? 'blocked' : 'ready', error: key })
      return key
    }

    const sub = await subscribeThisDevice()
    if (!sub) {
      usePushStore.setState({ error: 'push.errSubscribe' })
      return 'push.errSubscribe'
    }

    const failure = await storeSubscription(sub)
    if (failure) {
      // The browser now holds a subscription this account did not store. Undo it
      // rather than leaving the device in the half-registered state that
      // loadPushState() would then have to guess about.
      await unsubscribeThisDevice()
      usePushStore.setState({ error: failure })
      return failure
    }

    // Enabling on a device is an unambiguous "yes, push me", so it lifts the
    // master mute — otherwise the user grants permission, sees the switch move,
    // and still receives nothing because they muted it last month.
    if (!usePushStore.getState().prefs.enabled) await setPushPref('enabled', true)

    const rows = await fetchRows()
    if (rows !== null) applyRows(rows, sub.endpoint)
    return null
  } finally {
    usePushStore.setState({ busy: false })
  }
}

/**
 * Turn push off for this browser: unsubscribe AND delete the row.
 *
 * Both halves run even if the first fails. A row whose browser has forgotten the
 * subscription produces a 410 on every send; a browser subscription with no row
 * is simply never used. Neither is worth leaving behind because the other one
 * errored.
 */
export async function disablePushOnThisDevice(): Promise<string | null> {
  if (usePushStore.getState().busy) return null
  usePushStore.setState({ busy: true, error: null })
  try {
    const known = usePushStore.getState().endpoint
    const removed = await unsubscribeThisDevice()
    const endpoint = removed ?? known
    if (endpoint && supabase) {
      const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
      if (error) {
        console.warn('[push] removing the subscription row failed:', error.message)
        const key = pgErrorKey(error)
        usePushStore.setState({ error: key })
        return key
      }
    }
    usePushStore.setState({ endpoint: null })
    const rows = await fetchRows()
    if (rows !== null) applyRows(rows, null)
    return null
  } finally {
    usePushStore.setState({ busy: false })
  }
}

/**
 * Remove ANOTHER device by row id — the "I lost that phone" path.
 *
 * Only the row goes; that browser keeps a subscription it will never be pushed
 * to again, which is the best this app can do from here. If the row being removed
 * happens to be this device, the browser subscription is dropped too, so the two
 * do not disagree afterwards.
 */
export async function removePushDevice(id: string): Promise<string | null> {
  if (!supabase) return 'common.notConfigured'
  if (usePushStore.getState().busy) return null
  usePushStore.setState({ busy: true, error: null })
  try {
    const target = usePushStore.getState().devices.find((d) => d.id === id)
    const { error } = await supabase.from('push_subscriptions').delete().eq('id', id)
    if (error) {
      console.warn('[push] device removal failed:', error.message)
      const key = pgErrorKey(error)
      usePushStore.setState({ error: key })
      return key
    }
    if (target?.isThisDevice) await unsubscribeThisDevice()
    const rows = await fetchRows()
    if (rows !== null) applyRows(rows, target?.isThisDevice ? null : usePushStore.getState().endpoint)
    return null
  } finally {
    usePushStore.setState({ busy: false })
  }
}

const PREF_COLUMN: Record<keyof PushPrefs, string> = {
  enabled: 'push_enabled',
  assigned: 'push_assigned',
  completed: 'push_completed',
}

/**
 * Set one preference, optimistically.
 *
 * Optimistic because a switch that waits for a round trip before moving reads as
 * broken, and the stake is one boolean. On failure the SNAPSHOT is restored
 * rather than the inverse applied — the same rule store/entries.ts and
 * store/notifications.ts follow, for the same reason: a second toggle landing in
 * between would otherwise be undone by the first one's rollback.
 */
export async function setPushPref(key: keyof PushPrefs, value: boolean): Promise<string | null> {
  const snapshot = usePushStore.getState().prefs
  if (snapshot[key] === value) return null
  usePushStore.setState({ prefs: { ...snapshot, [key]: value }, error: null })

  if (!supabase) {
    usePushStore.setState({ prefs: snapshot, error: 'common.notConfigured' })
    return 'common.notConfigured'
  }
  const userId = await currentUserId()
  if (!userId) {
    usePushStore.setState({ prefs: snapshot, error: 'common.notSignedIn' })
    return 'common.notSignedIn'
  }

  // Upsert on the primary key, so the first change a user ever makes creates
  // their row and every later one updates it. `user_id` is theirs by RLS on both
  // the insert check and the update predicate.
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, [PREF_COLUMN[key]]: value }, { onConflict: 'user_id' })
  if (error) {
    console.warn('[push] pref write failed:', error.message)
    const errorKey = pgErrorKey(error)
    usePushStore.setState({ prefs: snapshot, error: errorKey })
    return errorKey
  }
  return null
}

/**
 * Sign-out. The device list and the preferences belong to the account that just
 * left, and the next person to sign in on this browser must not see either.
 *
 * THE BROWSER SUBSCRIPTION GOES TOO, and that is the important half. A push
 * endpoint belongs to the browser, not to the account: leaving it subscribed
 * would keep delivering the previous user's notifications to a device somebody
 * else is now holding. 0011's `upsert_push_subscription()` can move an endpoint
 * between accounts precisely because this cleanup is best-effort — but the
 * cleanup is what makes the takeover rare rather than routine.
 */
export function resetPush(): void {
  inFlight = null
  usePushStore.setState({
    verdict: 'unsupported',
    permission: 'default',
    endpoint: null,
    devices: [],
    prefs: DEFAULT_PREFS,
    loading: false,
    busy: false,
    error: null,
  })
  void unsubscribeThisDevice().catch(() => undefined)
}
