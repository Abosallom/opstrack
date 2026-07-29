// Auth store: the Supabase session plus the signed-in user's profiles row.
//
// Membership model: project signups are DISABLED in Supabase. Members are
// provisioned by an admin through the `admin-members` edge function, which
// creates the auth user and its profiles row together. Sign-in is therefore a
// 6-digit email OTP against an account that must already exist.
//
// Every exported function returns an error STRING or null instead of throwing.
// Sign-in errors are shown inline on the form; a thrown promise there just
// produces an unhandled rejection and a form that silently does nothing.

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { materializeRecurring } from '../api/entries'
import { supabase } from '../api/supabase'
import { setLocale, t } from '../lib/i18n'
import type { UserRole } from '../types'

/** View-model of the profiles row — camelCase, unlike the DB row in types.ts. */
export interface Profile {
  id: string
  displayName: string
  role: UserRole
  locale: string
}

export interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
}

/** Shape of the columns we select from `profiles`. */
interface ProfileRow {
  id: string
  display_name: string | null
  role: string | null
  locale: string | null
}

// loading starts true so the shell renders a spinner rather than bouncing the
// user to /signin during the moment before the stored session is restored.
const useAuthStore = create<AuthState>(() => ({
  loading: true,
  session: null,
  profile: null,
}))

export function useAuth(): AuthState {
  return useAuthStore()
}

function notConfigured(): string {
  return t('common.notConfigured')
}

/**
 * Turn a Supabase auth error into a TRANSLATED sentence.
 *
 * Supabase's own messages are English-only. Sign-in is the app's entry screen
 * and its error is announced through role="alert", so returning error.message
 * verbatim drops an English sentence into an otherwise fully-Arabic RTL form —
 * most visibly on the resend path, where the answer is "For security purposes,
 * you can only request this after N seconds". Every branch below therefore
 * ends in a t() key, and the raw text goes to the console so a failure that
 * matches nothing specific is still debuggable.
 *
 * `step` disambiguates the two shapes that only make sense in one place: the
 * "signups not allowed" reply means "no such account" only when requesting a
 * code, and the token/expired family only ever comes back from verification.
 */
function authErrorMessage(message: string, step: 'request' | 'verify'): string {
  const m = message.toLowerCase()
  // With shouldCreateUser:false this is also what an UNKNOWN address produces,
  // so it is the real "no such account" message for this project.
  if (/signups? not allowed|user not found|does not exist/.test(m)) {
    return t('signin.errNoAccount')
  }
  if (/rate limit|after \d+ seconds|too many requests|429/.test(m)) {
    return t('signin.errRateLimited')
  }
  if (/failed to fetch|network|load failed|timed? ?out|offline/.test(m)) {
    return t('signin.errNetwork')
  }
  if (step === 'verify' && /token|otp|expired|invalid|incorrect/.test(m)) {
    return t('signin.errCodeInvalid')
  }
  return t('signin.errGeneric')
}

function toFormError(error: { message: string } | null, step: 'request' | 'verify'): string | null {
  if (!error) return null
  console.warn(`[auth] ${step} failed:`, error.message)
  return authErrorMessage(error.message, step)
}

/** Email a 6-digit one-time code to an EXISTING account. */
export async function sendOtp(email: string): Promise<string | null> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    // MUST be false: project signups are disabled (members are provisioned by
    // the admin), and Supabase rejects shouldCreateUser:true requests outright
    // when signups are off — even for EXISTING accounts. Leaving it at the
    // default broke every OTP sign-in with "Signups not allowed for this
    // instance", which reads like an account problem but is a flag problem.
    options: { shouldCreateUser: false },
  })
  return toFormError(error, 'request')
}

/** Verify the emailed code; on success Supabase creates and persists the session. */
export async function verifyOtp(email: string, code: string): Promise<string | null> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email',
  })
  return toFormError(error, 'verify')
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
  // onAuthStateChange also clears this, but doing it here means the UI flips
  // to signed-out immediately instead of waiting on the network round-trip.
  useAuthStore.setState({ session: null, profile: null, loading: false })
}

async function loadProfile(session: Session): Promise<Profile | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role, locale')
    .eq('id', session.user.id)
    .maybeSingle()
  if (error) return null
  const row = data as ProfileRow | null
  if (!row) return null

  const email = session.user.email ?? ''
  return {
    id: row.id,
    // Falling back to the local part of the email keeps avatars and "assigned
    // to" labels readable for accounts provisioned without a display name.
    displayName: row.display_name?.trim() || email.split('@')[0] || email,
    // profiles.role is the ONLY admin signal, deliberately. Every RLS policy
    // gates on is_admin(), which reads this same column — so any second source
    // here (this used to OR in a hardcoded email list) can only ever disagree
    // with the server, and the failure mode is the bad direction: the admin
    // screens render, then every write comes back 42501. One source means the
    // UI can promise exactly what the database will allow. The first admin is
    // promoted by migration 0002's bootstrap update, not by the client.
    role: row.role === 'admin' ? 'admin' : 'member',
    locale: row.locale ?? 'en',
  }
}

/**
 * Re-read the signed-in user's profiles row into the store.
 *
 * `role` is otherwise fetched once per sign-in, and it is the single gate on
 * the admin screens (see loadProfile). Since guard_profile_role() blocks
 * changing a role from the browser, a promotion always happens out-of-band in
 * the SQL editor — without this the freshly-promoted admin has to sign out and
 * back in before Settings admits it happened.
 *
 * A failed fetch leaves the existing profile in place rather than writing null:
 * blanking it would silently demote the user to member on one flaky request,
 * hiding admin sections mid-session for no visible reason.
 */
export async function refreshProfile(): Promise<void> {
  const { session } = useAuthStore.getState()
  if (!session) return
  const profile = await loadProfile(session)
  if (profile) useAuthStore.setState({ profile })
}

/** The user whose saved locale has already been applied this session. */
let localeAppliedFor: string | null = null

function applyProfileLocale(profile: Profile) {
  // Apply the profile's saved language ONCE per sign-in. Re-applying on every
  // auth event (token refresh fires one every hour) would yank the UI back to
  // the stored language seconds after the user toggled it in the header.
  if (localeAppliedFor === profile.id) return
  localeAppliedFor = profile.id
  const saved = profile.locale
  if (saved === 'ar' || saved === 'en') setLocale(saved)
}

/** The user whose due recurring entries have already been materialized. */
let recurrenceRunFor: string | null = null

/**
 * The spec's "RPC on load" safety net for recurrence. pg_cron runs the same
 * function nightly, but it is unavailable on some Supabase tiers, so the app
 * has to be able to catch up on its own. Once per sign-in, not per auth event:
 * an hourly token refresh must not re-issue it.
 *
 * Fire-and-forget on purpose — a double run is a no-op (the
 * (template_id, due_date) unique index absorbs it) and a failure here must
 * never delay or block the shell.
 */
function materializeOnce(session: Session): void {
  if (recurrenceRunFor === session.user.id) return
  recurrenceRunFor = session.user.id
  void materializeRecurring().then((result) => {
    if (!result.ok) console.warn('[recurrence] materialize failed:', result.error)
  })
}

async function adopt(session: Session | null) {
  if (!session) {
    localeAppliedFor = null
    recurrenceRunFor = null
    useAuthStore.setState({ session: null, profile: null, loading: false })
    return
  }
  // Gate the shell ONLY while there is nothing to show. supabase-js re-fires
  // this handler for TOKEN_REFRESHED (roughly hourly) and for SIGNED_IN when a
  // backgrounded tab regains visibility; flipping `loading` on those swaps the
  // entire route tree for <BootSplash /> for the length of a profiles
  // round-trip, which resets scroll, throws focus back to the document start
  // with no announcement, and discards whatever was being typed on the capture
  // screen. A refetch for an established session updates in place instead.
  const booted = useAuthStore.getState().session !== null
  useAuthStore.setState(booted ? { session } : { session, loading: true })
  const profile = await loadProfile(session)
  if (profile) applyProfileLocale(profile)
  // Same policy refreshProfile() documents, and for a sharper reason: this is
  // the path that actually runs. loadProfile() returns null for a missing row
  // AND for a failed query, and supabase-js re-fires adopt() on every hourly
  // TOKEN_REFRESHED and on SIGNED_IN when a backgrounded tab regains
  // visibility. Writing null on one flaky request would demote a mid-session
  // admin to member: profiles.role is the sole admin gate, so Settings flips
  // the role pill and App.tsx redirects /settings/tracks/:id away, discarding a
  // half-typed track — and nothing restores it until the next auth event.
  //
  // On the FIRST adopt for a session there is nothing to protect and a null is
  // the true answer (a signed-in user with no profiles row), so it is written.
  useAuthStore.setState(profile || !booted ? { profile, loading: false } : { loading: false })
  if (profile) materializeOnce(session)
}

let wired = false

/** Called once from main.tsx. Restores the stored session and tracks changes. */
export function initAuth(): void {
  if (wired) return
  wired = true

  if (!supabase) {
    // No credentials in this build: settle immediately so the shell renders
    // the signed-out state instead of spinning forever.
    useAuthStore.setState({ loading: false })
    return
  }

  void supabase.auth.getSession().then(({ data }) => {
    void adopt(data.session)
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    // Do NOT await Supabase calls inside this callback. supabase-js serializes
    // auth work behind a lock, and calling back into the client from the
    // handler deadlocks it — the profile query never resolves and the app
    // hangs on the loading screen. Defer to a microtask to escape the lock.
    queueMicrotask(() => {
      void adopt(session)
    })
  })
}
