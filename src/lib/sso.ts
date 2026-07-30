// Microsoft Entra ID (Azure AD) sign-in: the redirect URL, the provider probe,
// and the post-sign-in membership guard.
//
// WHAT "ACTIVE DIRECTORY" MEANS HERE, restated because it is the most commonly
// misunderstood item in the plan (WAVE1-ADDENDUM §1, addition 4). On-prem LDAP is
// unreachable from a static PWA — there is no server to hold a bind credential and
// no route to a domain controller from GitHub Pages. What is reachable is the
// tenant's cloud directory, Entra ID, through Supabase's `azure` OIDC provider.
// So this is Entra SSO, and the on-prem case is documented as impossible rather
// than half-built. docs/AZURE-AD-SETUP.md is what the IT team fills in.
//
// LAYERING. `src/lib/` may not import `src/api/` or `src/store/` (plan §1.0), so
// the Supabase client is a PARAMETER of every function here that needs one. The
// only globals this module reads are `import.meta.env` and `window`. Passing the
// client in also means the guard can be installed from the composition root
// (main.tsx), which is where a session-wide listener belongs.
//
// THE PROVIDER IS OFF UNTIL THE TENANT EXISTS. Measured against the live project
// while this was written: `/auth/v1/settings` reports `external.azure: false`. The
// button therefore does not render at all — see components/SsoButtons.tsx — which
// is the difference between "not configured yet" and "a button that fails".

import type { SupabaseClient } from '@supabase/supabase-js'

/** Supabase's provider id for Entra ID. Still spelled `azure` in the API. */
export const AZURE_PROVIDER = 'azure'

/**
 * The scopes to ask Entra for.
 *
 * `email` is the one that matters: without it the token carries no address, the
 * `profiles` lookup in the guard below has nothing to name in its message, and
 * Supabase stores a user with an empty email. `offline_access` is what makes the
 * session refreshable rather than expiring in an hour.
 */
export const AZURE_SCOPES = 'openid profile email offline_access'

/* ─────────────────────────────── the redirect ───────────────────────────── */

/**
 * Where Entra sends the browser back to.
 *
 * THIS IS THE ONE VALUE THAT IS EASY TO GET WRONG AND HARD TO DEBUG, and it has
 * two independent constraints:
 *
 * 1. IT MUST CARRY NO FRAGMENT. GoTrue appends the tokens as
 *    `<redirectTo>#access_token=…&refresh_token=…`. This app is a HashRouter app,
 *    so the obvious `…/opstrack/#/signin` produces
 *    `…/opstrack/#/signin#access_token=…` — and because a URL has exactly one
 *    fragment, everything after the FIRST `#` is one string. supabase-js parses
 *    `window.location.hash` with URLSearchParams and reads the first key as
 *    `/signin#access_token`, so it finds no session at all: the user is bounced
 *    back to the sign-in screen having successfully signed in, with nothing in
 *    the console. The app root, with no hash, is the only shape that works —
 *    supabase-js strips the tokens at module init and React Router then sees an
 *    empty hash and routes to the default screen.
 *
 * 2. IT MUST INCLUDE THE SUBPATH. GitHub Pages serves this project at
 *    `/opstrack/`; a bare origin would land on the user's Pages root, which is a
 *    different app.
 *
 * Resolved from `document.baseURI` rather than assembled from `location.origin`
 * plus a constant, so dev (`http://localhost:5173/`), the Pages deploy and the
 * Capacitor bundle all produce their own correct answer with no build-time
 * branch. `new URL('.', …)` drops both the fragment and any filename, which is
 * exactly the normalisation needed.
 *
 * WHATEVER THIS RETURNS MUST BE IN SUPABASE'S REDIRECT ALLOW-LIST, or GoTrue
 * silently substitutes the project's Site URL. AZURE-AD-SETUP.md §3 lists both
 * URLs to add.
 */
export function ssoRedirectTo(): string {
  if (typeof document === 'undefined') return ''
  return redirectFromBase(document.baseURI)
}

/**
 * The normalisation itself, split out so the three cases that matter can be
 * asserted without a document: a hash is dropped, a subpath is kept, and a
 * filename is dropped. Getting any of the three wrong is a sign-in that appears
 * to work and silently produces no session.
 */
export function redirectFromBase(baseUri: string): string {
  try {
    return new URL('.', baseUri).href
  } catch {
    // An unparseable base cannot be repaired here. An empty redirectTo makes
    // Supabase fall back to the project's Site URL, which is the right answer
    // for this app (it IS the site) and is better than sending a broken one.
    return ''
  }
}

/* ─────────────────────────── is the provider on? ────────────────────────── */

/** The subset of `/auth/v1/settings` this module reads. */
export interface AuthSettings {
  external: Record<string, boolean>
}

/**
 * Parse the settings document defensively. Pure, so it can be tested without a
 * network: an unexpected shape must answer "no providers", never throw — this
 * runs on the sign-in screen, and a parse error there would replace the form
 * with an error boundary.
 */
export function parseAuthSettings(body: unknown): AuthSettings {
  const external: Record<string, boolean> = {}
  if (typeof body === 'object' && body !== null) {
    const raw = (body as { external?: unknown }).external
    if (typeof raw === 'object' && raw !== null) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'boolean') external[key] = value
      }
    }
  }
  return { external }
}

/** Is a given provider enabled on this project? */
export function providerEnabled(settings: AuthSettings, provider: string): boolean {
  return settings.external[provider] === true
}

/**
 * Ask the project which providers are enabled.
 *
 * A plain fetch rather than a supabase-js call because supabase-js has no method
 * for it. `apikey` is required; the anon key is public by design.
 *
 * Never throws and never retries: on any failure it reports "nothing enabled",
 * which hides the SSO button. A missing button is a smaller failure than a
 * button that cannot work, and the username/password form is right above it.
 *
 * NOT CACHED ACROSS RELOADS on purpose. Enabling the provider is a dashboard
 * action with no client-visible event, and a cached `false` in localStorage would
 * outlive it — the owner would enable Azure, see no button, and have no way to
 * know why. One request per sign-in screen mount is cheap.
 */
export async function fetchAuthSettings(signal?: AbortSignal): Promise<AuthSettings> {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
  if (!url || !anonKey) return { external: {} }
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      signal,
    })
    if (!response.ok) return { external: {} }
    return parseAuthSettings(await response.json())
  } catch {
    // Offline, aborted by an unmount, or a CORS surprise. Same answer.
    return { external: {} }
  }
}

/* ──────────────────────────── starting the flow ─────────────────────────── */

/**
 * Hand off to Microsoft. Resolves to an i18n key on failure, null on success —
 * though on success the browser is already navigating away.
 *
 * `prompt=select_account` because these are work machines: without it Entra
 * silently reuses whichever account the browser last used, which on a shared
 * laptop signs the user in as their colleague.
 */
export async function startAzureSignIn(
  client: SupabaseClient,
  redirectTo: string = ssoRedirectTo(),
): Promise<string | null> {
  const { error } = await client.auth.signInWithOAuth({
    provider: AZURE_PROVIDER,
    options: {
      redirectTo,
      scopes: AZURE_SCOPES,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) {
    console.warn('[sso] azure sign-in failed:', error.message)
    return 'sso.errFailed'
  }
  return null
}

/* ─────────────────────── the post-sign-in membership guard ──────────────── */

const REJECTED_KEY = 'opstrack_sso_rejected'

/**
 * Remember, for the length of this tab's session, that an SSO sign-in was
 * refused — and who it was refused for.
 *
 * sessionStorage rather than a store: the message has to survive the sign-out
 * that immediately follows and the re-render that unmounts everything, and it
 * must NOT survive the tab. A localStorage flag would greet the next person on a
 * shared machine with somebody else's rejected address.
 */
function rememberRejection(email: string): void {
  try {
    sessionStorage.setItem(REJECTED_KEY, email)
  } catch {
    // Private mode, quota, a locked-down browser. The sign-out still happens;
    // only the explanation is lost, and that is the lesser half.
  }
}

/** Read and clear the rejection, if there is one. Called by SsoButtons. */
export function takeSsoRejection(): string | null {
  try {
    const value = sessionStorage.getItem(REJECTED_KEY)
    if (value !== null) sessionStorage.removeItem(REJECTED_KEY)
    return value
  } catch {
    return null
  }
}

/** Which identity provider minted this session, as Supabase records it. */
function providerOf(user: { app_metadata?: Record<string, unknown> } | undefined): string {
  const meta = user?.app_metadata ?? {}
  const single = meta.provider
  if (typeof single === 'string') return single
  const list = meta.providers
  if (Array.isArray(list) && typeof list[0] === 'string') return list[0]
  return ''
}

let installed = false

/**
 * ENFORCEMENT: a tenant account that is not a member of this workspace gets
 * signed straight back out.
 *
 * WHY THIS IS NECESSARY. Entra authenticates the whole tenant. The moment Azure
 * is enabled, every employee can complete a sign-in — and App.tsx renders the
 * full shell for any session, whether or not a `profiles` row exists. Without
 * this guard a stranger from Finance would land inside OpsTrack, see empty lists
 * (RLS gives them nothing), and reasonably conclude the tool is broken. The
 * honest answer is "you are not set up here; ask your admin", and the only way to
 * say it is to end the session.
 *
 * WHY IT ONLY APPLIES TO `azure`. An email or username session with no profiles
 * row is a half-finished PROVISIONING, not a stranger — `admin-members` creates
 * the auth user and the profiles row together, so the gap is a bug in the middle
 * of setup, and signing that person out would lock the admin out of the very
 * screen they need. Membership for those paths is enforced where it always has
 * been: by RLS.
 *
 * WHY IT FAILS OPEN. A profiles read can fail for reasons that have nothing to do
 * with membership — a network blip, a 500, a token still settling. Signing a
 * legitimate member out over one flaky request would be a self-inflicted lockout
 * with no recovery path, so ONLY a definitive "no row, no error" ends the
 * session. This mirrors the policy store/auth.ts states for `profile: null`.
 *
 * IDEMPOTENT, and returns its own teardown. Safe to call from main.tsx and again
 * from SsoButtons' mount — the second call is a no-op.
 */
export function installSsoGuard(client: SupabaseClient | null): () => void {
  if (!client || installed) return () => undefined
  installed = true

  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return
    if (!session) return
    if (providerOf(session.user) !== AZURE_PROVIDER) return

    // NEVER await a supabase call inside this callback — supabase-js serializes
    // auth work behind a lock and calling back into the client from the handler
    // deadlocks it, which hangs the whole app on the loading screen.
    // store/auth.ts's adopt() documents the same trap and escapes it the same way.
    queueMicrotask(() => {
      void (async () => {
        const { data: row, error } = await client
          .from('profiles')
          .select('id')
          .eq('id', session.user.id)
          .maybeSingle()
        // Fail open. See the doc comment.
        if (error) {
          console.warn('[sso] membership check failed, allowing the session:', error.message)
          return
        }
        if (row) return
        console.warn('[sso] no profiles row for an azure session — signing out')
        rememberRejection(session.user.email ?? '')
        await client.auth.signOut()
      })()
    })
  })

  return () => {
    data.subscription.unsubscribe()
    installed = false
  }
}
