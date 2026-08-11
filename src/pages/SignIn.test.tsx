// Render proof for the product's front door.
//
// WHY renderToStaticMarkup AND NOT A DOM — the reason the sibling page tests
// give: vitest.config.ts is `environment: 'node'` on purpose and the repo's
// one-new-devDependency budget went to vitest itself, so there is no jsdom and
// no testing-library. react-dom/server runs the real component, the real hooks,
// the real class names, the real ARIA and the real translator.
//
// WHAT IT CANNOT SEE, stated plainly because it is a large slice of this
// screen: server rendering runs no effects and dispatches no events, so the
// identifier field is always empty on the rendered markup. `isEmail` is
// therefore always false here, and the EMAIL BRANCH — "email me a sign-in
// link", the linkSent panel, the resend cooldown and the code disclosure — is
// unreachable from this file. Those are covered by Wave 2 gate (b)/(c) against
// the live project. What IS reachable is every state the screen can be in
// before anyone types: the credentials form, the unconfigured notice, and both
// languages of each.
//
// WHAT THIS FILE IS ACTUALLY FOR — three failure classes nothing else catches:
//
//  1. The front door crashing on mount. Every other screen in the app is behind
//     this one; if it throws, the product is not merely degraded, it is shut.
//  2. A locale key that does not resolve. `t()` falls back to the key itself, so
//     a typo ships a tab reading "signin.heading" rather than failing anything.
//     Both languages are checked for stray dot-paths on every assertion below.
//  3. WAVE2-NOTES §1 regressing. The screen this one replaced promised "a
//     6-digit code" that Supabase's free tier can never send. The guard is in
//     "keeps the free-tier promise" below, and it is the reason this file
//     exists at all rather than the general wish for coverage.
//
// The four modules mocked are exactly the ones that reach for the network,
// `window` or `localStorage` at module init. `store/auth` in particular is
// mocked to keep this a test of the SCREEN: the store is complete, owns its own
// error wording, and is not this file's subject. Everything else stays real —
// the real `t()`, the real icons, the real react-router `Link`.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope. Installed in vi.hoisted
  // because that runs before the import graph is evaluated; a beforeAll() is
  // far too late. Shimming it keeps the REAL translator, which is the whole
  // point of failure class 2.
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

  // setLocale() writes `lang`/`dir` onto <html> before notifying listeners —
  // that is what drives every logical property on this screen, so it is not
  // worth stubbing out of i18n. react-dom/server never reads `document` itself.
  ;(globalThis as { document?: Document }).document = {
    documentElement: { lang: '', dir: '' },
  } as Document

  // Flipped per test rather than re-mocked: the unconfigured notice is a state
  // of this screen, not a different screen.
  return { configured: true }
})

vi.mock('../api/supabase', () => ({
  isConfigured: () => fx.configured,
  supabase: null,
}))

// The store is complete and owns its own sentences (WAVE1-ADDENDUM §2.4). None
// of these can fire without events, which server rendering does not dispatch;
// they exist so the import resolves without pulling the real auth graph.
vi.mock('../store/auth', () => ({
  sendOtp: () => Promise.resolve(null),
  signInPassword: () => Promise.resolve(null),
  verifyOtp: () => Promise.resolve(null),
}))

vi.mock('../store/settings', () => ({
  setLocaleSetting: () => undefined,
}))

vi.mock('../components/toast', () => ({
  toast: () => undefined,
}))

const { setLocale } = await import('../lib/i18n')
const { default: SignIn } = await import('./SignIn')

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/signin']}>
      <SignIn />
    </MemoryRouter>,
  )
}

/** The same markup in both languages — every assertion here is bilingual. */
function bilingual(): { en: string; ar: string } {
  setLocale('en')
  const en = render()
  setLocale('ar')
  const ar = render()
  setLocale('en')
  return { en, ar }
}

/**
 * Every key this screen can render, as it would appear if `t()` fell through to
 * the key itself. Scoped to the five namespace roots SignIn actually reaches
 * so an unrelated string containing a dot cannot register as a miss — and
 * anchored on a literal dot, so the `signin-*` CLASS names never match.
 */
function untranslated(html: string): string[] {
  return [...new Set(html.match(/\b(?:signin|claim|common|app|route|settings)\.[a-zA-Z]+/g) ?? [])]
}

describe('SignIn — the credentials form', () => {
  it('mounts in both languages with every string resolved', () => {
    const { en, ar } = bilingual()
    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      expect(html).toContain('signin-form')
      expect(html).toContain('id="signin-identifier"')
      expect(html).toContain('id="signin-password"')
    }
    expect(en).toContain('Sign in to NphiesCore')
    // The Arabic heading fences the Latin name in an isolate pair (U+2066 LRI …
    // U+2069 PDI), written as escapes because the characters are invisible and a
    // reader of this file would otherwise have no way to see that the assertion
    // depends on them. Without the fence the bidi algorithm resolves the name
    // against the neighbouring Arabic and the sentence's punctuation moves.
    expect(ar).toContain('تسجيل الدخول إلى ⁦NphiesCore⁩')
  })

  it('keeps the free-tier promise — the front door never offers a code (WAVE2-NOTES §1)', () => {
    // The screen this one replaced said "Email me a code" and then showed a
    // six-digit field for a mail that, on the free tier, only ever contains a
    // link. `signin.sendCode` and `signin.codeLabel` are kept at parity for the
    // day custom SMTP lands, and this asserts they stay off the front door
    // until then. The code path is not deleted — it is one disclosure deep,
    // inside the linkSent panel, which no one has reached at this point.
    const { en, ar } = bilingual()
    expect(en).not.toContain('Email me a code')
    expect(en).not.toContain('6-digit code')
    expect(ar).not.toContain('أرسل لي الرمز')
    for (const html of [en, ar]) {
      expect(html).not.toContain('signin-code-input')
      expect(html).not.toContain('signin-disclosure')
    }
  })

  it('offers the claim link, not the email alternative, for a username', () => {
    // Nothing has been typed, so `isEmail` is false and the branch under the
    // separator is the username one. This pins the branch's DEFAULT: a member
    // who has never signed in sees the way to claim an account, not a mail
    // button that would reject the username they were handed.
    const { en, ar } = bilingual()
    for (const html of [en, ar]) {
      expect(html).toContain('href="/claim"')
      expect(html).toContain('signin-link')
      expect(html).not.toContain('signin-alt')
    }
    expect(en).toContain('First time here? Claim your account')
    expect(ar).toContain('أول مرة هنا؟ فعّل حسابك')
  })

  it('takes a username as readily as an email', () => {
    // type="email" would make the browser reject the bare username this field
    // is required to accept — the single most load-bearing attribute on the
    // screen, and invisible in a screenshot.
    const html = render()
    expect(html).toMatch(/id="signin-identifier"[^>]*type="text"/)
    expect(html).not.toMatch(/id="signin-identifier"[^>]*type="email"/)
  })

  it('wires the labels, the autofill hints and the described-by hint', () => {
    const html = render()
    // Case-insensitive throughout: react-dom/server emits React's camelCase
    // prop name (`autoComplete`) verbatim. HTML attribute names are
    // case-insensitive so the browser and every password manager read it the
    // same, but a case-sensitive assertion here would fail on shipping markup.
    //
    // A password manager fills this screen only if both halves are named.
    expect(html).toMatch(/id="signin-identifier"[^>]*autocomplete="username"/i)
    expect(html).toMatch(/id="signin-password"[^>]*autocomplete="current-password"/i)
    expect(html).toContain('for="signin-identifier"')
    expect(html).toContain('for="signin-password"')
    // The hint is the description while nothing is wrong; the error node takes
    // over the association when the store points at this field.
    expect(html).toMatch(/id="signin-identifier"[^>]*aria-describedby="signin-identifier-hint"/i)
    expect(html).toContain('id="signin-identifier-hint"')
  })

  it('starts clean — no error, no caps warning, nothing busy', () => {
    // The polish mandate's inverse: a form that shouts before it has been used.
    const html = render()
    expect(html).not.toContain('signin-error')
    expect(html).not.toContain('signin-caps')
    expect(html).not.toMatch(/signin-submit"[^>]*disabled/)
  })
})

describe('SignIn — the pre-auth language toggle', () => {
  it('names the other language, in that language', () => {
    // The ONLY language control that exists before sign-in: the header's lives
    // inside the shell, which a signed-out member never reaches. An Arabic-first
    // member handed an English build has no other way out of it.
    setLocale('en')
    const en = render()
    expect(en).toMatch(/signin-lang"[^>]*lang="ar"/)
    expect(en).toContain('العربية')

    setLocale('ar')
    const ar = render()
    expect(ar).toMatch(/signin-lang"[^>]*lang="en"/)
    expect(ar).toContain('English')
    setLocale('en')
  })

  it('flips the document direction, which is what mirrors the screen', () => {
    setLocale('ar')
    render()
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    setLocale('en')
    render()
    expect(document.documentElement.dir).toBe('ltr')
  })
})

describe('SignIn — a build with no backend', () => {
  it('says so instead of rendering a form that cannot work', () => {
    fx.configured = false
    try {
      const { en, ar } = bilingual()
      for (const html of [en, ar]) {
        expect(untranslated(html)).toEqual([])
        expect(html).toContain('signin-notice')
        // The form is gone, not merely disabled: there is nothing to submit to.
        expect(html).not.toContain('signin-form')
        expect(html).not.toContain('id="signin-password"')
      }
      expect(en).toContain('This build has no backend configured')
      expect(ar).toContain('لم يُضبط الخادم في هذه النسخة')
    } finally {
      // Restored in a finally so one failing expectation cannot leak the flag
      // into every test that runs after it.
      fx.configured = true
    }
  })

  it('still offers the language toggle, so the notice can be read', () => {
    fx.configured = false
    try {
      expect(render()).toContain('signin-lang')
    } finally {
      fx.configured = true
    }
  })
})

/* ════════ R2-MOBILE-6 · the code field is focused inside the tap ════════ */
//
// WHAT BROKE. The "enter the code instead" disclosure focused its field from
// `useEffect(() => { if (codeOpen) codeRef.current?.focus() }, [codeOpen])`,
// annotated "otherwise the OS one-time-code suggestion never appears". The
// effect is why it never appeared: the panel is opened by a TAP, WebKit raises
// the software keyboard only for a focus() taken inside the user activation
// call stack (Chromium gates it the same way), and a passive effect is
// scheduled after paint, in a later task than the pointer event. So the caret
// landed in the field, the keypad stayed down, and `autoComplete="one-time-code"`
// — the entire reason the disclosure exists — had no raised keyboard to offer
// the emailed digits above.
//
// WHY THIS IS A SOURCE ASSERTION and not a behavioural one. The claim is about
// ORDER inside an event handler, and this file's own header says server
// rendering "runs no effects and dispatches no events"; there is no jsdom in
// the dependency budget. So the guard is the same instrument
// components/CommandPalette.test.tsx uses on App.tsx's route table: read the
// source and pin the shape. It can prove the focus is taken synchronously in
// the handler after a flushSync; it cannot prove WebKit then raised the
// keyboard. Named as a weaker instrument rather than dressed up as a strong
// one — but the failure it guards is a silent reversion to an effect, which is
// exactly what source can see.

const SIGNIN_SOURCES: Record<string, string> = import.meta.glob('./SignIn.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SIGNIN_SOURCE = SIGNIN_SOURCES['./SignIn.tsx'] ?? ''

/**
 * The source with comment-only lines removed.
 *
 * Necessary, not fastidious: the fix's own comment QUOTES the effect it
 * replaced, verbatim, so that the next reader knows what not to put back. A
 * negative assertion against the raw text would match that quotation and fail
 * on the very code that fixes the bug.
 */
const SIGNIN_CODE = SIGNIN_SOURCE.split('\n')
  .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
  .join('\n')

describe('SignIn — the one-time-code field is focused inside the gesture', () => {
  it('read its own source', () => {
    // Guards every assertion below from passing vacuously.
    expect(SIGNIN_CODE).toContain('export default function SignIn')
  })

  it('has no effect that focuses on codeOpen', () => {
    // The exact regression: any effect whose dependency array is [codeOpen].
    expect(SIGNIN_CODE).not.toMatch(/useEffect\([\s\S]*?\}, \[codeOpen\]\)/)
  })

  it('takes the focus in the toggle handler, after a synchronous state flush', () => {
    const at = SIGNIN_CODE.indexOf('function toggleCodePanel()')
    expect(at).toBeGreaterThan(-1)
    const body = SIGNIN_CODE.slice(at, SIGNIN_CODE.indexOf('\n  }', at))
    // The field does not exist until `codeOpen` is true — the panel is mounted
    // conditionally — so the state change has to be applied before there is
    // anything to focus, and applied WITHOUT yielding the activation.
    expect(body).toContain('flushSync(')
    expect(body.indexOf('flushSync(')).toBeLessThan(body.indexOf('codeRef.current?.focus()'))
  })

  it('wires that handler to the disclosure button, not an inline setState', () => {
    expect(SIGNIN_CODE).toContain('onClick={toggleCodePanel}')
    expect(SIGNIN_CODE).not.toContain('setCodeOpen((open) => !open)')
  })

  it('keeps the panel conditional, which is what makes the flush necessary', () => {
    // If this ever becomes a CSS-hidden panel, the flushSync can go — but a
    // hidden input is unfocusable, so the focus move would have to change too.
    expect(SIGNIN_CODE).toContain('{codeOpen ? (')
  })
})
