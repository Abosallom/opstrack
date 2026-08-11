// Auth store: the Supabase session plus the signed-in user's profiles row.
//
// Membership model: project signups are DISABLED in Supabase. Members are
// provisioned by an admin through the `admin-members` edge function, which
// creates the auth user and its profiles row together. Sign-in is therefore
// always against an account that must already exist, by one of two paths:
// a 6-digit email OTP (real addresses — the owner's), or a username and the
// password the member chose when they claimed it.
//
// Every exported function returns an error STRING or null instead of throwing.
// Sign-in errors are shown inline on the form; a thrown promise there just
// produces an unhandled rejection and a form that silently does nothing.

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { materializeRecurring } from '../api/entries'
import { supabase } from '../api/supabase'
import { baseUrlFrom } from '../lib/appBase'
import { setLocale, t } from '../lib/i18n'
import type { ClaimInput, UserRole } from '../types'
// The one store-to-store import in this app, and it earns the exception: giving
// the push registration back is the last thing that needs a live session, so it
// has to happen inside signOut() rather than beside it. store/push.ts imports
// nothing from here, so there is no cycle.
import { releasePushForSignOut } from './push'

/** View-model of the profiles row — camelCase, unlike the DB row in types.ts. */
export interface Profile {
  id: string
  displayName: string
  role: UserRole
  locale: string
}

/**
 * What an emailed recovery link left this tab in.
 *
 * `'active'` — the link was opened, supabase-js adopted the session it carried
 * and reported `PASSWORD_RECOVERY`. The session is deliberately NOT published to
 * `session` while this is set: see adopt().
 * `'expired'` — the link landed with `error_code` in the URL instead of tokens,
 * which is what a reused or timed-out link looks like. Nothing is signed in;
 * the sentence the reader needs is the only thing left of the attempt.
 */
export type Recovery = 'active' | 'expired' | null

export interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  recovery: Recovery
}

/** Shape of the columns we select from `profiles`. */
interface ProfileRow {
  id: string
  display_name: string | null
  role: string | null
  locale: string | null
}

/**
 * The document URL, or '' where there is not one.
 *
 * `window.location` is non-optional in the DOM typings, but the node tests that
 * exercise this store stub `window` with only the members they need (see
 * store/auth.test.ts, which gives it four functions and no location). Reading it
 * through a widened shape keeps a module-scope read from throwing there, and the
 * empty string is exactly what recoveryFromUrl() already treats as "no link".
 */
function currentHref(): string {
  const loc = (globalThis as { window?: { location?: { href?: unknown } } }).window?.location
  return typeof loc?.href === 'string' ? loc.href : ''
}

/**
 * What the URL a recovery link opened says happened — read from the FRAGMENT.
 *
 * WHY THIS IS READ AT MODULE SCOPE AND NOT FROM AN EVENT. Both answers are
 * erased within a tick of the page loading, by two different mechanisms:
 *
 *  - On success supabase-js parses the fragment, saves the session, and sets
 *    `window.location.hash = ''` before it notifies anyone. Its
 *    `PASSWORD_RECOVERY` notification then arrives on a `setTimeout(0)` — a
 *    MACROTASK — while `getSession()` resolves on a microtask, so the store
 *    would publish a live session and App would paint the whole signed-in shell
 *    for a frame before the recovery state arrived to take it back.
 *  - On failure supabase-js throws before it clears anything, so the fragment
 *    survives — straight into HashRouter, which reads `#error=access_denied&…`
 *    as a route, matches nothing, and replaces it with a redirect to /signin.
 *    The only record that a link was even opened is gone before React commits.
 *
 * Module evaluation happens before both: it is synchronous, so it precedes
 * every microtask, every timer and the first render. This function is pure and
 * takes the href so the reasoning above can be tested rather than described.
 *
 * The error branch requires `error_code` AND `error_description` — the pair
 * GoTrue always sends — rather than a bare `error`, so an ordinary in-app hash
 * route that happens to carry `?error=…` cannot be mistaken for a dead link.
 * Nothing here reads a token, and nothing here logs the URL.
 */
export function recoveryFromUrl(href: string): Recovery {
  let hash: string
  try {
    hash = new URL(href).hash
  } catch {
    return null
  }
  if (!hash.startsWith('#')) return null
  const params = new URLSearchParams(hash.slice(1))
  if (params.get('type') === 'recovery' && params.get('access_token')) return 'active'
  if (params.get('error_code') && params.get('error_description')) return 'expired'
  return null
}

// loading starts true so the shell renders a spinner rather than bouncing the
// user to /signin during the moment before the stored session is restored.
const useAuthStore = create<AuthState>(() => ({
  loading: true,
  session: null,
  profile: null,
  recovery: recoveryFromUrl(currentHref()),
}))

export function useAuth(): AuthState {
  return useAuthStore()
}

/**
 * Is there a session RIGHT NOW? Non-reactive, for load guards.
 *
 * WHAT IT IS FOR, AND WHY EVERY CACHED STORE NEEDS IT. Under RLS, a read made
 * with only the anon key is not an error — `is_member()` is false, every row is
 * filtered out, and PostgREST returns **200 with `[]`**. A loader cannot tell
 * that apart from "this workspace has no tracks", so it caches the empty answer,
 * stamps `loadedAt`, and every later load short-circuits on the stamp. The whole
 * session then renders "No track", "Unassigned" and unlabelled status pills,
 * with nothing logged and nothing to retry.
 *
 * It is not a narrow race either: config, vocab and members each register a
 * `focus` listener at module scope, so alt-tabbing while the SIGN-IN screen is
 * open is enough to poison all three before the user has typed a password.
 *
 * So: an empty list is only believed when this returns true. Non-reactive on
 * purpose — a guard that re-rendered its caller would be a subscription, and
 * these are called from inside promise callbacks.
 */
export function hasSession(): boolean {
  return useAuthStore.getState().session !== null
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
 * `step` disambiguates the shapes that only make sense in one place: the
 * "signups not allowed" reply means "no such account" only when requesting a
 * code, the token/expired family only ever comes back from verification, and
 * "invalid login credentials" only from a password grant.
 */
type AuthStep = 'request' | 'verify' | 'password' | 'update'

function authErrorMessage(message: string, step: AuthStep): string {
  const m = message.toLowerCase()
  // Setting a new password is the one step whose credential is a LINK, so every
  // shape that means "no usable session" has to read as "that link is dead"
  // rather than as anything about the password just typed. It comes first
  // because auth-js words the missing-session case "Auth session missing!",
  // which the password branch below would otherwise have to guess at.
  if (step === 'update' && /session|jwt|token|expired|not authenticated/.test(m)) {
    return t('signin.errResetLinkDead')
  }
  // With shouldCreateUser:false this is also what an UNKNOWN address produces,
  // so it is the real "no such account" message for this project.
  if (step !== 'password' && /signups? not allowed|user not found|does not exist/.test(m)) {
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
  // ONE message for every credential failure, on purpose. Supabase already
  // answers "Invalid login credentials" for both a wrong password and an
  // address that does not exist; keeping that conflation here is what stops the
  // form becoming a username oracle, and usernames are handed out in person
  // precisely so they are not public. It also absorbs "email not confirmed",
  // which for a provisioned account means the claim never finished — telling a
  // member to check an inbox that cannot receive mail (@opstrack.internal is
  // RFC 6761 reserved) would be worse than telling them the password is wrong.
  if (step === 'password' && /credentials|password|not confirmed|grant/.test(m)) {
    return t('signin.errCredentials')
  }
  return t('signin.errGeneric')
}

function toFormError(error: { message: string } | null, step: AuthStep): string | null {
  if (!error) return null
  console.warn(`[auth] ${step} failed:`, error.message)
  return authErrorMessage(error.message, step)
}

/**
 * Where an emailed sign-in link must land: this deployment's own base URL.
 *
 * The app is served from a SUBPATH (`/opstrack/` on GitHub Pages) and the
 * account's Pages ROOT is a 404. Omitting `emailRedirectTo` makes Supabase fall
 * back to the project's dashboard Site URL, and that fallback dropped the
 * subpath and dumped the user on that 404 with their tokens in the hash.
 * Passing it explicitly makes the redirect a property of THIS BUILD rather than
 * of a dashboard field nobody can see — see lib/appBase.ts for why the obvious
 * way to compute it (BASE_URL against the origin) reproduces the same bug.
 */
function appBaseUrl(): string {
  // The reasoning — and the trap that BASE_URL is — lives in lib/appBase.ts.
  return baseUrlFrom(window.location.href)
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
    options: { shouldCreateUser: false, emailRedirectTo: appBaseUrl() },
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

// ── username accounts ──────────────────────────────────────────────────────
//
// Implemented by W1-AUTH alongside the `admin-members` v2 and `claim-account`
// edge functions, against the contracts the Wave-1 keystone published here.
//
// WHY USERNAMES AT ALL. Email OTP costs a round trip to an inbox the member may
// not have on their phone, and Supabase's built-in SMTP is capped at a handful
// of mails an hour project-wide — fine for one owner, not for a team signing in
// on a Sunday morning. So an admin predefines a USERNAME, the member claims it
// once with a one-time invite code and a password they choose, and every
// sign-in after that is local.
//
// OTP IS NOT REMOVED. Accounts with a real email address — the owner's — keep
// it, and both paths stay valid for them. That is the migration guarantee: the
// existing admin cannot be locked out by this change.

/**
 * The synthetic address a predefined username authenticates against.
 *
 * `.internal` is reserved by RFC 6761 and can never resolve, which is the
 * point: these addresses must be unable to receive mail, so that nothing in the
 * product ever quietly depends on emailing them. Password reset for a username
 * account is an admin reissuing an invite code — an honest path, rather than a
 * "check your inbox" screen for an inbox that does not exist.
 */
export const USERNAME_EMAIL_DOMAIN = '@opstrack.internal'

/**
 * username → the synthetic email, deterministically.
 *
 * Pure and total; it validates nothing, because the authority on what a legal
 * username is lives in the edge function that mints the account, and a second
 * opinion here could only ever disagree with it. Lowercased and trimmed so
 * `Ahmed`, `ahmed ` and `ahmed` are one account rather than three.
 */
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${USERNAME_EMAIL_DOMAIN}`
}

/**
 * Sign in with a password.
 *
 * `identifier` is a username OR a real email — branch on whether it contains
 * '@', and map a bare username through usernameToEmail(). One field, because
 * asking a user to first classify their own credential is a worse form than
 * guessing correctly from the one character that distinguishes them.
 *
 * Returns a TRANSLATED sentence or null, matching this file's convention (see
 * the header) rather than api/'s i18n-key convention: sign-in errors render
 * inline on the form through role="alert", and the form has no key resolver.
 *
 * The generic-credentials branch must NOT distinguish "no such username" from
 * "wrong password" — that difference is a username oracle, and usernames here
 * are handed out in person specifically so they are not public.
 */
export async function signInPassword(
  identifier: string,
  password: string,
): Promise<string | null> {
  if (!supabase) return notConfigured()
  const id = identifier.trim()
  if (!id) return t('signin.errUsernameRequired')
  if (!password) return t('signin.errPasswordRequired')
  // One character decides it: an '@' means the user typed a real address, and
  // anything else is a predefined username that maps onto its synthetic one.
  const email = id.includes('@') ? id.toLowerCase() : usernameToEmail(id)
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  // No session handling here: onAuthStateChange fires SIGNED_IN and adopt()
  // loads the profile, exactly as it does after an OTP verify.
  return toFormError(error, 'password')
}

/** The floor this app enforces before the request leaves the browser. */
export const MIN_PASSWORD_LENGTH = 8

/** The failure codes `claim-account` returns, mapped to what the member reads. */
const CLAIM_ERROR_KEYS: Record<string, string> = {
  already_claimed: 'signin.errAlreadyClaimed',
  invalid_invite: 'signin.errInviteInvalid',
  rate_limited: 'signin.errRateLimited',
  network: 'signin.errNetwork',
}

/**
 * Dig the machine-readable failure code out of a functions.invoke() error.
 *
 * supabase-js collapses every non-2xx into a FunctionsHttpError whose message is
 * the constant "Edge Function returned a non-2xx status code" — the JSON body,
 * where our `code` lives, is reachable only through `.context`, the raw
 * Response. Without this the claim screen could say nothing more specific than
 * "something went wrong" for a wrong code, an expired one, and an account that
 * was already claimed alike.
 */
async function edgeErrorCode(error: unknown): Promise<string> {
  const err = error as { name?: string; context?: unknown }
  // The one case with no response at all: the request never reached the edge.
  if (err.name === 'FunctionsFetchError') return 'network'
  const ctx = err.context
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { code?: unknown }
      if (typeof body.code === 'string') return body.code
    } catch {
      // A non-JSON body (a gateway HTML error page) tells us nothing; fall
      // through to the generic message rather than surfacing markup.
      return ''
    }
  }
  return ''
}

/**
 * First registration: exchange a username + one-time invite code for a password
 * the member chooses, then sign them in.
 *
 * Runs UNAUTHENTICATED — the caller has no session yet, which is the whole
 * point of claiming — so the invite code is the only credential and the
 * service-role work happens inside the `claim-account` edge function. The code
 * is single-use; a second attempt with the same code must fail even if the
 * first one crashed after setting the password, because a reusable invite is a
 * standing key to someone else's account.
 */
export async function claimAccount(input: ClaimInput): Promise<string | null> {
  if (!supabase) return notConfigured()
  const username = input.username.trim().toLowerCase()
  const inviteCode = input.inviteCode.trim()
  const { password } = input
  if (!username) return t('signin.errUsernameRequired')
  if (!inviteCode) return t('signin.errInviteRequired')
  // Checked here as well as in the function so a too-short password costs a
  // keystroke rather than a round trip — and so it costs no rate-limit budget.
  if (password.length < MIN_PASSWORD_LENGTH) {
    return t('signin.errPasswordShort', { min: MIN_PASSWORD_LENGTH })
  }

  const { error } = await supabase.functions.invoke('claim-account', {
    body: { username, inviteCode, password },
  })
  if (error) {
    const code = await edgeErrorCode(error)
    // The CODE, never the code: log which failure happened, never the invite
    // itself and never the password. A console line survives in a bug report.
    console.warn('[auth] claim failed:', code || 'unknown')
    if (code === 'weak_password') return t('signin.errPasswordShort', { min: MIN_PASSWORD_LENGTH })
    return t(CLAIM_ERROR_KEYS[code] ?? 'signin.errGeneric')
  }

  // Claiming does not hand back a session — it runs with the service role and
  // has no browser to issue tokens to — so sign in with the password the member
  // just chose. Landing them on the sign-in form to type it again immediately
  // after proving they know it would be a gratuitous second chance to fail.
  return signInPassword(username, password)
}

// ── password recovery ──────────────────────────────────────────────────────
//
// THE CONSTRAINT THAT SHAPES ALL OF IT: half the accounts in this workspace have
// no mailbox. A predefined username authenticates against
// `<name>@opstrack.internal`, which RFC 6761 guarantees can never resolve —
// USERNAME_EMAIL_DOMAIN's comment above says so, and says it is deliberate. So
// there are two recoveries here, not one implementation with two error paths:
//
//   identifier contains '@' → resetPasswordForEmail(). A real inbox, a real
//     link, self-serve.
//   identifier has no '@'   → NOTHING IS SENT. requestPasswordReset() answers
//     `noMailbox` before it touches the network, and the screen says who to ask
//     and what happens next. Calling resetPasswordForEmail() for one of these
//     would return `{ error: null }`, show a "check your email" panel, and
//     strand the member on an inbox that cannot exist — a lie the client has
//     every fact it needs to avoid telling.
//
// The username half of the recovery already exists and needs nothing built:
// `admin-members`' reissue-code action (api/members.reissueInvite) mints a fresh
// invite, and the member re-claims at /claim with a password they choose.

/** The three answers a reset request can have. There is no fourth. */
export type ResetRequest =
  | { kind: 'sent'; email: string }
  /** A username account: no mail was sent, and none could be. */
  | { kind: 'noMailbox'; username: string }
  | { kind: 'error'; message: string }

/**
 * Ask Supabase to email a password-recovery link — or refuse, honestly.
 *
 * `redirectTo` goes through appBaseUrl(), the same helper `emailRedirectTo`
 * uses, and that is not tidiness: a hand-built URL here is exactly how the
 * emailed sign-in link twice ended up on the account's Pages ROOT with the
 * user's tokens in the hash (see appBaseUrl and lib/appBase.ts). It carries NO
 * fragment of its own, deliberately — GoTrue appends `#access_token=…` to
 * whatever it is given, so a `…/#/reset` redirect would arrive as
 * `…/#/reset#access_token=…`, and supabase-js parses the fragment with
 * `URLSearchParams`, which reads that as one key named `/reset#access_token`.
 * The session would never be detected. The landing is routed to /reset by the
 * sign-in screen instead, off the `recovery` state below.
 *
 * Nothing here reveals whether an address has an account: Supabase answers
 * success either way, and this returns `sent` either way.
 */
export async function requestPasswordReset(identifier: string): Promise<ResetRequest> {
  if (!supabase) return { kind: 'error', message: notConfigured() }
  const id = identifier.trim()
  if (!id) return { kind: 'error', message: t('signin.errIdentifierRequired') }
  // A new request supersedes whatever the last link did, including the notice
  // that it had expired.
  if (useAuthStore.getState().recovery === 'expired') useAuthStore.setState({ recovery: null })

  // The one character the whole feature turns on, read the same way
  // signInPassword() reads it.
  if (!id.includes('@')) return { kind: 'noMailbox', username: id.toLowerCase() }

  const email = id.toLowerCase()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: appBaseUrl(),
  })
  if (!error) return { kind: 'sent', email }

  // BY NAME WHERE THERE IS A NAME. Supabase's built-in SMTP allows a handful of
  // mails an hour PROJECT-WIDE, so a second tap is the ordinary case rather than
  // the exotic one, and "something went wrong" would send the reader looking for
  // a fault that is not there. auth-js gives these two machine-readable codes;
  // the 429 is the belt-and-braces for a gateway that returns the status without
  // one. The message still goes through authErrorMessage() below, so an unknown
  // failure is still a translated sentence rather than English from Supabase.
  const code = (error as { code?: string }).code ?? ''
  const status = (error as { status?: number }).status
  console.warn('[auth] reset request failed:', code || error.message)
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return { kind: 'error', message: t('signin.errResetSentAlready') }
  }
  return { kind: 'error', message: authErrorMessage(error.message, 'request') }
}

/**
 * Set a new password on the session a recovery link created, then hand the tab
 * over to the app as a normal signed-in session.
 *
 * The length floor is MIN_PASSWORD_LENGTH — imported by the screen, restated
 * nowhere — and it is checked here as well as in the form so that the rule has
 * one owner even if a second caller ever appears.
 *
 * Nothing about the password is logged, toasted or rendered; the console line
 * carries the failure CODE only, exactly as the claim path does with its invite.
 */
export async function updatePassword(password: string): Promise<string | null> {
  if (!supabase) return notConfigured()
  if (password.length < MIN_PASSWORD_LENGTH) {
    return t('signin.errPasswordShort', { min: MIN_PASSWORD_LENGTH })
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    const code = (error as { code?: string }).code ?? ''
    console.warn('[auth] password update failed:', code || 'unknown')
    if (code === 'same_password') return t('signin.errSamePassword')
    if (code === 'weak_password') return t('signin.errPasswordShort', { min: MIN_PASSWORD_LENGTH })
    if (code === 'session_not_found' || code === 'session_expired') {
      return t('signin.errResetLinkDead')
    }
    return toFormError(error, 'update')
  }

  // The recovery is over, so the session stops being withheld: clear the flag
  // FIRST, then adopt the session auth-js has been holding all along. The user
  // lands inside the app, signed in, rather than on a sign-in form asking for
  // the password they typed a second ago.
  useAuthStore.setState({ recovery: null })
  const { data } = await supabase.auth.getSession()
  await adopt(data.session)
  return null
}

/**
 * Abandon a recovery in progress.
 *
 * Without this the tab is stuck: /signin redirects to /reset for as long as
 * `recovery` is 'active', so a reader who opened the link by accident, or who
 * remembered their password on the way to the form, would have no way back to
 * it. Signing out is the right half of "never mind" — the link's session is a
 * standing key to this account and there is no reason to leave it lying in
 * localStorage once its one job has been declined.
 */
export async function cancelRecovery(): Promise<void> {
  useAuthStore.setState({ recovery: null })
  await signOut()
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  // FIRST, AND THAT IS THE POINT. Handing the push registration back is an
  // authenticated delete under 0011's owner-only RLS, so it has to be issued
  // while this session's token is still the one on the request — after the
  // sign-out below it matches no rows and reports no error, which is
  // indistinguishable from having worked. App.tsx's teardown is later still:
  // the shell only unmounts once `session` has already gone null.
  //
  // Bounded inside store/push.ts, so a dead network delays sign-out by seconds
  // rather than by the socket timeout. See releasePushForSignOut()'s comment
  // for what is given up when the budget runs out.
  await releasePushForSignOut()
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
  // A RECOVERY SESSION IS WITHHELD FROM THE UI, and this is the line that does
  // it. The link Supabase mails carries a full session — publishing it would
  // render the whole signed-in shell for someone who has just proved they do not
  // know their password, and would swap the reset screen out from under them
  // mid-type, because App.tsx gates the two route trees on `session`. So the
  // credential stays where auth-js keeps it (updateUser() below still uses it)
  // and the store keeps answering "signed out" until the new password lands.
  // `loading` is settled either way: something has to be rendered.
  if (session && useAuthStore.getState().recovery === 'active') {
    useAuthStore.setState({ session: null, profile: null, loading: false })
    return
  }
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

/**
 * The session supabase-js still has on disk after it failed to refresh it.
 *
 * WHY THIS EXISTS. `getSession()` treats a session inside EXPIRY_MARGIN_MS of
 * expiry as expired and refreshes it; offline, that refresh fails and — once the
 * access token has actually passed its expiry, which at Supabase's default 3600s
 * TTL means any cold start more than an hour after last use — it answers
 * `{ session: null, error }`. That null used to flow straight into `adopt(null)`
 * and put App.tsx on the signed-out branch, so opening the installed app on a
 * plane showed a sign-in form the user could not submit, with the entry cache
 * (`opstrack_entries_v1`) and every unsent offline capture (`opstrack_outbox_v1`)
 * sitting behind it. That is precisely the moment the offline story is supposed
 * to pay off.
 *
 * THE CREDENTIAL IS STILL THERE, and that is what makes this safe rather than a
 * fabrication. auth-js only removes the stored session when the refresh fails
 * NON-retryably with an already-expired access token (`_callRefreshToken`); a
 * network failure is retryable and it deliberately leaves the session in
 * storage for the auto-refresh ticker to retry. So "supabase-js reported null
 * with an error AND the credential is still on disk" means exactly one thing:
 * the credential is alive and unreachable. We hand back the REAL session object
 * — real user id, real tokens — never one we invented. A genuine sign-out, a
 * revoked refresh token or a corrupt entry all clear storage, and this returns
 * null for every one of them, so no properly-ended session can be resurrected.
 *
 * It grants nothing: `session` in this store is a UI gate, and every server call
 * carries auth-js's own token under RLS. An expired token still 401s; the
 * difference is that the user can read their cached list and queue captures
 * while it does, and the auto-refresh ticker promotes the session for real
 * through onAuthStateChange the moment the network returns.
 *
 * `storageKey` is read off the client rather than rebuilt from the URL, because
 * the client is the thing that owns the name (`sb-<ref>-auth-token` by default,
 * overridable). It is `protected` in the typings and a plain property at
 * runtime, hence the cast — and every step below is guarded, so a future
 * version that stores something else simply falls through to the sign-in
 * screen, which is today's behaviour.
 */
function storedSessionAfterFailedRefresh(): Session | null {
  if (!supabase) return null
  try {
    const key = (supabase as unknown as { storageKey?: unknown }).storageKey
    if (typeof key !== 'string' || key === '') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Partial<Session>
    // The same three fields auth-js's own _isValidSession() checks, plus a user
    // id, because meIdCache and the outbox's owner check both read it and a
    // session without one would be worse than none.
    if (
      typeof candidate.access_token !== 'string' ||
      typeof candidate.refresh_token !== 'string' ||
      typeof candidate.user !== 'object' ||
      candidate.user === null ||
      typeof candidate.user.id !== 'string'
    ) {
      return null
    }
    return candidate as Session
  } catch {
    // Private mode, a disabled store, a hand-edited value. Nothing here is worth
    // failing a boot over; falling through means the sign-in screen, as before.
    return null
  }
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

  void supabase.auth.getSession().then(({ data, error }) => {
    // `error` is non-null only when a stored session was found and its refresh
    // failed — an empty or invalid store answers `{ session: null, error: null }`
    // and must still land on the sign-in screen. See
    // storedSessionAfterFailedRefresh() for why the disk read is the safe test.
    const restored = data.session ?? (error ? storedSessionAfterFailedRefresh() : null)
    if (restored !== null && data.session === null) {
      console.warn('[auth] could not reach the auth server; running on the stored session:', error)
    }
    void adopt(restored)
  })

  supabase.auth.onAuthStateChange((event, session) => {
    // The recovery landing, as an EVENT rather than as a URL. The module-scope
    // read above has almost always already set this — it runs before every timer
    // and before the first render, and this notification arrives on a
    // setTimeout(0) — but the two disagree in one real case: a link opened in a
    // tab that already had the app loaded, where nothing re-evaluates a module.
    // Both paths set the same flag, and setting it twice costs nothing.
    if (event === 'PASSWORD_RECOVERY') {
      useAuthStore.setState({ recovery: 'active', session: null, profile: null, loading: false })
      return
    }
    // Do NOT await Supabase calls inside this callback. supabase-js serializes
    // auth work behind a lock, and calling back into the client from the
    // handler deadlocks it — the profile query never resolves and the app
    // hangs on the loading screen. Defer to a microtask to escape the lock.
    queueMicrotask(() => {
      void adopt(session)
    })
  })
}
