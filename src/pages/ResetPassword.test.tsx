// Proof for the recovery path — the screen AND the store branch behind it.
//
// WHY THE STORE IS REAL HERE, unlike in SignIn.test.tsx. The defect this unit
// exists to prevent is not a rendering defect: it is offering a
// "check your email" screen to an account whose address is
// `<name>@opstrack.internal`, which RFC 6761 guarantees can never receive mail.
// That decision lives in `store/auth.requestPasswordReset()`, one line above the
// network call, and a mocked store would assert only that this file believes its
// own mock. So the store is imported for real and only `../api/supabase` is
// faked — which also lets the fake client RECORD what it was asked to do, and
// the strongest assertion in this file is a negative one: for a username, that
// client is never called at all.
//
// WHY THE SCREEN IS BOOTED THREE TIMES, AT THREE URLS. The state this screen
// renders is decided by the URL the recovery link opened, and store/auth.ts
// reads that URL at MODULE SCOPE — because both possible answers are erased
// within a tick (supabase-js clears the fragment on success; HashRouter
// overwrites it on failure). Under `renderToStaticMarkup` a zustand hook is
// served by `getInitialState()`, so the module-scope read is not merely the
// realistic way to drive this screen, it is the only one — and that is a
// faithful instrument rather than a workaround: what each block below renders is
// what a browser opening THAT URL would render.
//
// WHY renderToStaticMarkup AND NOT A DOM — the reason every sibling page test
// gives: vitest.config.ts is `environment: 'node'` on purpose and the repo's
// one-new-devDependency budget went to vitest itself, so there is no jsdom and
// no testing-library. react-dom/server runs the real component, the real hooks,
// the real class names, the real ARIA and the real translator.
//
// WHAT THAT CANNOT SEE, stated plainly: server rendering runs no effects and
// dispatches no events, so the two ANSWER PANELS ('sent' and 'noMailbox') are
// unreachable from a render here — they are states this screen only enters after
// a submit. Which branch is taken, what is sent and what is not, and the
// sentence each produces are all proved at the store boundary below; the panels'
// markup is covered by the live gate.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/** Where this deployment lives, as the emailed link would land on it. */
const APP_URL = 'https://abosallom.github.io/nphiescore/'

/** The fragment Supabase puts on a working recovery link (implicit flow). */
const RECOVERY_HASH =
  '#access_token=ey.J.wt&expires_in=3600&refresh_token=r-abc&token_type=bearer&type=recovery'

/** The fragment it puts on a reused or timed-out one. No token, no session. */
const DEAD_HASH =
  '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope; installed in vi.hoisted because
  // that runs before the import graph is evaluated, and a beforeAll() is far too
  // late. Shimming it keeps the REAL translator, which is what makes the
  // untranslated() sweep below mean anything.
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  } as Storage

  // setLocale() writes `lang`/`dir` onto <html> before notifying listeners.
  // react-dom/server never reads `document` itself.
  ;(globalThis as { document?: Document }).document = {
    documentElement: { lang: '', dir: '' },
  } as Document

  return {
    configured: true,
    /** Every resetPasswordForEmail call the store made. */
    resetCalls: [] as { email: string; redirectTo: unknown }[],
    /** What resetPasswordForEmail will answer. */
    resetError: null as unknown,
    /** How many times updateUser was called. The PASSWORD IS NEVER RECORDED. */
    updateCalls: 0,
    updateError: null as unknown,
    /** What getSession() hands back to initAuth(). */
    session: null as unknown,
    /** The handler initAuth() registers, so a test can fire an auth event. */
    onChange: null as ((event: string, session: unknown) => void) | null,
  }
})

vi.mock('../api/supabase', () => ({
  isConfigured: () => fx.configured,
  supabase: {
    auth: {
      resetPasswordForEmail: (email: string, options: { redirectTo?: unknown }) => {
        fx.resetCalls.push({ email, redirectTo: options.redirectTo })
        return Promise.resolve({ data: null, error: fx.resetError })
      },
      updateUser: () => {
        // The password itself is deliberately NOT recorded. This file is the last
        // place it would be reasonable to keep one, so it does not.
        fx.updateCalls += 1
        return Promise.resolve({ data: { user: null }, error: fx.updateError })
      },
      getSession: () => Promise.resolve({ data: { session: fx.session }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        fx.onChange = cb
        return { data: { subscription: { unsubscribe: (): void => {} } } }
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  },
}))

// The two modules store/auth pulls in that reach for the network or the push
// subscription. Neither is this file's subject.
vi.mock('../api/entries', () => ({
  materializeRecurring: () => Promise.resolve({ ok: true, data: null }),
}))
vi.mock('../store/push', () => ({
  releasePushForSignOut: () => Promise.resolve(),
}))

vi.mock('../store/settings', () => ({
  setLocaleSetting: () => undefined,
}))

vi.mock('../components/toast', () => ({
  toast: () => undefined,
}))

/** One app, booted at one URL: the store, the screen and the translator it uses. */
interface Booted {
  store: typeof import('../store/auth')
  Page: () => ReactElement
  setLocale: (l: 'en' | 'ar') => void
}

/**
 * Load a fresh module graph as though the browser had just opened `href`.
 *
 * `window` is stubbed with a location and nothing else — the only DOM member
 * store/auth.ts reads, and the reason it reads it through a widened shape.
 */
async function bootAt(href: string): Promise<Booted> {
  ;(globalThis as { window?: { location: { href: string } } }).window = { location: { href } }
  vi.resetModules()
  const i18n = await import('../lib/i18n')
  const store = await import('../store/auth')
  const page = await import('./ResetPassword')
  return { store, Page: page.default, setLocale: i18n.setLocale }
}

const plain = await bootAt(`${APP_URL}#/reset`)
const opened = await bootAt(`${APP_URL}${RECOVERY_HASH}`)
const dead = await bootAt(`${APP_URL}${DEAD_HASH}`)
// Leave the tab where an ordinary reader is, so the store calls below compute
// their redirect from a normal in-app URL rather than from a landing.
;(globalThis as { window?: { location: { href: string } } }).window = {
  location: { href: `${APP_URL}#/reset` },
}

function render(app: Booted): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/reset']}>
      <app.Page />
    </MemoryRouter>,
  )
}

/** The same markup in both languages — every screen assertion here is bilingual. */
function bilingual(app: Booted): { en: string; ar: string } {
  app.setLocale('en')
  const en = render(app)
  app.setLocale('ar')
  const ar = render(app)
  app.setLocale('en')
  return { en, ar }
}

/**
 * Every key this screen can render, as it would appear if `t()` had fallen
 * through to the key itself. Scoped to the namespace roots this screen reaches,
 * and anchored on a literal dot so the `rst-*` CLASS names never match.
 */
function untranslated(html: string): string[] {
  return [...new Set(html.match(/\b(?:signin|claim|common|app|route|settings)\.[a-zA-Z]+/g) ?? [])]
}

/** Four microtasks: getSession().then → adopt() → loadProfile().then. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve()
}

/* ───────────────────────── the branch, at the store ───────────────────────── */

describe('requestPasswordReset — the branch this whole unit turns on', () => {
  it('emails a real address, and lands the link on THIS deployment', async () => {
    fx.resetCalls = []
    fx.resetError = null

    const result = await plain.store.requestPasswordReset('  AZ.Alsaloom@Gmail.com ')

    expect(result).toEqual({ kind: 'sent', email: 'az.alsaloom@gmail.com' })
    expect(fx.resetCalls.length).toBe(1)
    // THE SUBPATH SURVIVES. This is appBaseUrl() — the same helper
    // `emailRedirectTo` uses — and the reason it is not hand-built here is that
    // a hand-built one twice sent people to the account's Pages ROOT, a 404,
    // with their tokens in the hash.
    expect(fx.resetCalls[0].redirectTo).toBe(APP_URL)
    // And it carries no fragment: GoTrue appends `#access_token=…` to whatever
    // it is given, and supabase-js parses that fragment with URLSearchParams —
    // so a `…/#/reset` redirect would arrive as one key named
    // `/reset#access_token` and the session would never be detected at all.
    expect(fx.resetCalls[0].redirectTo).not.toContain('#')
  })

  it('sends NOTHING for a username, because that address cannot receive mail', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `nasser@opstrack.internal` is RFC 6761
    // reserved; resetPasswordForEmail() against it answers `{ error: null }` and
    // delivers nothing, so a "check your email" panel would be a lie the client
    // had every fact it needed to avoid telling.
    fx.resetCalls = []
    fx.resetError = null

    const result = await plain.store.requestPasswordReset('  Nasser ')

    expect(result).toEqual({ kind: 'noMailbox', username: 'nasser' })
    expect(fx.resetCalls).toEqual([])
  })

  it('refuses an empty identifier without spending a request', async () => {
    fx.resetCalls = []
    const result = await plain.store.requestPasswordReset('   ')
    expect(result.kind).toBe('error')
    expect(fx.resetCalls).toEqual([])
  })

  it('names the rate limit rather than reporting a generic failure', async () => {
    // Built-in SMTP allows a handful of mails an hour PROJECT-WIDE, so a second
    // tap is the ordinary case rather than the exotic one. auth-js gives it a
    // machine-readable code, and the reader is told the mail is already sent —
    // not that something went wrong.
    fx.resetCalls = []
    fx.resetError = {
      message: 'For security purposes, you can only request this after 51 seconds',
      code: 'over_email_send_rate_limit',
      status: 429,
    }
    plain.setLocale('en')

    const result = await plain.store.requestPasswordReset('az.alsaloom@gmail.com')

    expect(result).toEqual({
      kind: 'error',
      message:
        'A reset link has already been sent. Only a few emails can go out each hour, so check your inbox and your spam folder before asking for another.',
    })
    fx.resetError = null
  })
})

describe('updatePassword', () => {
  it('enforces the claim flow’s floor before it spends a round trip', async () => {
    fx.updateCalls = 0
    plain.setLocale('en')

    const message = await plain.store.updatePassword('short')

    expect(message).toBe('Use at least 8 characters.')
    // Imported, never restated: the same 8 the claim screen and the edge
    // function enforce.
    expect(plain.store.MIN_PASSWORD_LENGTH).toBe(8)
    expect(fx.updateCalls).toBe(0)
  })

  it('reads a missing session as a dead link, not as a bad password', async () => {
    // The expired/used case AFTER the form has been filled in: auth-js answers
    // `session_not_found`, and the reader needs "ask for a new link" rather than
    // anything about what they just typed.
    fx.updateCalls = 0
    fx.updateError = { message: 'Auth session missing!', code: 'session_not_found', status: 400 }
    plain.setLocale('en')

    const message = await plain.store.updatePassword('a-long-enough-password')

    expect(message).toBe('That reset link has expired or has already been used. Ask for a new one.')
    expect(fx.updateCalls).toBe(1)
    fx.updateError = null
  })
})

describe('recoveryFromUrl — what the landing URL says, before anything erases it', () => {
  it('recognises the link Supabase actually sends', () => {
    expect(plain.store.recoveryFromUrl(`${APP_URL}${RECOVERY_HASH}`)).toBe('active')
  })

  it('recognises a link that arrived dead', () => {
    expect(plain.store.recoveryFromUrl(`${APP_URL}${DEAD_HASH}`)).toBe('expired')
  })

  it('reads an ordinary in-app hash route as what it is', () => {
    // The false positive that matters: HashRouter puts the whole route in the
    // fragment, filters and all, and a screen announcing "your link expired" on
    // an ordinary navigation would be worse than one that said nothing.
    const r = plain.store.recoveryFromUrl
    expect(r(`${APP_URL}#/mindtree`)).toBe(null)
    expect(r(`${APP_URL}#/mindtree?error=1`)).toBe(null)
    expect(r(APP_URL)).toBe(null)
    expect(r('')).toBe(null)
  })

  it('will not take a type=recovery with no token as a live session', () => {
    expect(plain.store.recoveryFromUrl('https://example.test/#type=recovery')).toBe(null)
  })
})

describe('the recovery session is withheld from the UI', () => {
  it('keeps the app signed OUT while the password is being reset', async () => {
    // App.tsx gates its two route trees on `session`. Publishing the link's
    // session would render the whole signed-in shell for someone who has just
    // proved they do not know their password, and would swap this screen out
    // from under them mid-type. hasSession() staying false is also what stops
    // the cached stores believing an empty RLS answer (see its own header).
    fx.session = { user: { id: 'u-aziz' } }

    opened.store.initAuth()
    await settle()

    expect(opened.store.hasSession()).toBe(false)
  })

  it('publishes the very same session when no link was opened', async () => {
    // The control. Without it the assertion above would pass just as well
    // against a store that never signs anybody in.
    fx.session = { user: { id: 'u-aziz' } }

    plain.store.initAuth()
    await settle()

    expect(plain.store.hasSession()).toBe(true)
  })

  it('takes the session back when PASSWORD_RECOVERY arrives late', async () => {
    // The second path into the same state: a link opened in a tab that already
    // had the app loaded, where no module is re-evaluated and the URL read at
    // module scope never happens. The event is the only notice.
    expect(plain.store.hasSession()).toBe(true)
    if (!fx.onChange) throw new Error('initAuth() registered no auth-state handler')

    fx.onChange('PASSWORD_RECOVERY', { user: { id: 'u-aziz' } })

    expect(plain.store.hasSession()).toBe(false)
    fx.session = null
  })
})

/* ───────────────────────────── the screen itself ──────────────────────────── */

describe('ResetPassword — asking for a link', () => {
  it('mounts in both languages with every string resolved', () => {
    const { en, ar } = bilingual(plain)
    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      expect(html).toContain('rst-form')
      expect(html).toContain('id="rst-identifier"')
    }
    expect(en).toContain('Reset your password')
    expect(ar).toContain('إعادة تعيين كلمة المرور')
  })

  it('takes a username as readily as an email', () => {
    // The field has to accept both, because the two kinds of account recover in
    // two different ways and the reader is not asked to classify their own
    // credential. type="email" would have the browser reject a username.
    const html = render(plain)
    expect(html).toMatch(/id="rst-identifier"[^>]*type="text"/)
    expect(html).not.toMatch(/id="rst-identifier"[^>]*type="email"/)
    expect(html).toMatch(/id="rst-identifier"[^>]*autocomplete="username"/i)
    expect(html).toContain('for="rst-identifier"')
    expect(html).toMatch(/id="rst-identifier"[^>]*aria-describedby="rst-identifier-hint"/i)
  })

  it('starts clean and offers the way back', () => {
    const html = render(plain)
    expect(html).not.toContain('rst-error')
    expect(html).not.toContain('rst-caps')
    expect(html).toContain('href="/signin"')
  })

  it('never shows a password field to someone with no live link', () => {
    // Half two is gated on the recovery state, not on the route: a bookmarked
    // /reset must ask, not offer to set a password on nothing.
    expect(render(plain)).not.toContain('id="rst-password"')
  })
})

describe('ResetPassword — a link that arrived dead', () => {
  it('says what happened, and keeps the form that fixes it', () => {
    const { en, ar } = bilingual(dead)
    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      // The notice is a live region, not an error: nothing the reader did was
      // wrong, and the next thing they do is ask again — right here.
      expect(html).toContain('rst-note')
      expect(html).toContain('id="rst-identifier"')
    }
    expect(en).toContain('That emailed link no longer works')
    expect(ar).toContain('لم يعد الرابط المُرسل إلى بريدك صالحًا')
  })

  it('is silent when nobody arrived from a link', () => {
    expect(render(plain)).not.toContain('That emailed link no longer works')
  })
})

describe('ResetPassword — a build with no backend', () => {
  it('says so instead of rendering a form that cannot work', () => {
    fx.configured = false
    try {
      const { en, ar } = bilingual(plain)
      for (const html of [en, ar]) {
        expect(untranslated(html)).toEqual([])
        expect(html).toContain('rst-notice')
        expect(html).not.toContain('rst-form')
      }
      expect(en).toContain('This build has no backend configured')
    } finally {
      // Restored in a finally so one failing expectation cannot leak the flag
      // into every test that runs after it.
      fx.configured = true
    }
  })
})

describe('ResetPassword — setting the new password', () => {
  it('offers one field with a reveal, and the floor stated once', () => {
    // ONE field, not two. /claim asks twice because its second copy — a one-time
    // invite code — is expensive to replace; here the second copy is an EMAIL,
    // and this project's built-in SMTP allows a handful an hour workspace-wide.
    // So the screen buys certainty with a control that shows the exact string
    // (NIST 800-63B §5.1.1.2 allows exactly this in place of a confirm field)
    // rather than by asking for a long password twice on a phone keyboard and
    // hoping the two typos differ.
    const { en, ar } = bilingual(opened)

    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      expect(html).toContain('id="rst-password"')
      // No second field, and no room for one to creep back in unnoticed.
      expect(html).not.toContain('id="rst-confirm"')
      expect(html).toMatch(/id="rst-password"[^>]*type="password"/)
      expect(html).toMatch(/id="rst-password"[^>]*autocomplete="new-password"/i)
      // The reveal IS the confirm field's replacement, so it is not optional.
      expect(html).toContain('rst-reveal')
      expect(html).toContain('aria-pressed="false"')
      // The identifier form is gone: this reader was identified by the link.
      expect(html).not.toContain('id="rst-identifier"')
    }
    // The floor comes from MIN_PASSWORD_LENGTH through claim.passwordHint — the
    // number is written in exactly one place in the whole app.
    expect(en).toContain('At least 8 characters')
    expect(ar).toContain('8 أحرف على الأقل')
  })

  it('leaves a way out of a recovery nobody wanted', () => {
    // /signin forwards back here for as long as the recovery session is live, so
    // without this control the tab would be stuck on this screen.
    const html = render(opened)
    expect(html).toContain('rst-link')
    expect(html).toContain('Back to sign in')
  })

  it('renders no password, ever', () => {
    // The value is state, not markup: react-dom/server writes `value=""` for an
    // untouched controlled input, and nothing on this screen echoes a password,
    // a token or a link back to the reader.
    expect(render(opened)).toContain('id="rst-password"')
    expect(render(opened)).not.toContain('access_token')
  })
})
