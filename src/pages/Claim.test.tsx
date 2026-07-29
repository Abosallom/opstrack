// Render proof for /claim — first registration for a predefined username.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real
// hooks, the real class names and the real translator.
//
// WHAT IT CANNOT SEE: effects and events. The strength meter, the live
// password-match line and the four validation failures are all keyed off state
// that only typing produces, so the RENDERED assertions below cover the screen
// as it first appears. The logic behind two of those — the meter's thresholds
// and the invite formatter — is reachable directly, because Claim.tsx exports
// both, and that is where the interesting cases are pinned.
//
// WHY THE FORMATTER TEST MATTERS MORE THAN IT LOOKS. `formatInvite` inserts a
// hyphen that is then POSTED to the edge function, which hashes
// `${username}:${normalizeCode(code)}`. That claim only works because
// supabase/functions/claim-account/index.ts strips non-alphanumerics with the
// same rule before hashing. Two files, one invariant, no type connecting them —
// so the invariant is asserted here in the shape the server will see.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope; vi.hoisted runs before the
  // import graph is evaluated, which a beforeAll() would not.
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

  ;(globalThis as { document?: Document }).document = {
    documentElement: { lang: '', dir: '' },
  } as Document

  return { configured: true }
})

vi.mock('../api/supabase', () => ({
  isConfigured: () => fx.configured,
  supabase: null,
}))

// MIN_PASSWORD_LENGTH is re-declared rather than imported through the mock
// because the real module reaches the Supabase client at init. 8 is the value
// the store exports AND the floor the edge function enforces; if it ever moves,
// the length assertions below move with it deliberately.
vi.mock('../store/auth', () => ({
  MIN_PASSWORD_LENGTH: 8,
  claimAccount: () => Promise.resolve(null),
}))

vi.mock('../store/settings', () => ({
  setLocaleSetting: () => undefined,
}))

const { setLocale } = await import('../lib/i18n')
const { default: Claim, formatInvite, strengthOf } = await import('./Claim')

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/claim']}>
      <Claim />
    </MemoryRouter>,
  )
}

function bilingual(): { en: string; ar: string } {
  setLocale('en')
  const en = render()
  setLocale('ar')
  const ar = render()
  setLocale('en')
  return { en, ar }
}

/** Anchored on a literal dot, so the `claim-*` CLASS names never match. */
function untranslated(html: string): string[] {
  return [...new Set(html.match(/\b(?:claim|signin|common|app|route|settings)\.[a-zA-Z]+/g) ?? [])]
}

describe('Claim — the form', () => {
  it('mounts in both languages with every string resolved', () => {
    const { en, ar } = bilingual()
    for (const html of [en, ar]) {
      expect(untranslated(html)).toEqual([])
      expect(html).toContain('claim-form')
    }
    expect(en).toContain('Claim your account')
    expect(ar).toContain('تفعيل حسابك')
  })

  it('asks for all four things, and only those four', () => {
    const html = render()
    for (const id of ['claim-username', 'claim-invite', 'claim-password', 'claim-confirm']) {
      expect(html).toContain(`id="${id}"`)
      expect(html).toContain(`for="${id}"`)
    }
  })

  it('tells the password manager this is a NEW password, not a login', () => {
    // `new-password` on both secret fields is what makes a manager offer to
    // generate and store one instead of trying to fill an existing credential.
    // Case-insensitive: react-dom/server emits React's camelCase prop verbatim
    // and HTML attribute names are case-insensitive.
    const html = render()
    expect(html).toMatch(/id="claim-username"[^>]*autocomplete="username"/i)
    expect(html).toMatch(/id="claim-password"[^>]*autocomplete="new-password"/i)
    expect(html).toMatch(/id="claim-confirm"[^>]*autocomplete="new-password"/i)
    // The invite code is a one-time secret; storing it would be worse than
    // useless, since it stops working the moment this form succeeds.
    expect(html).toMatch(/id="claim-invite"[^>]*autocomplete="off"/i)
  })

  it('states the length floor in the language being read', () => {
    // The {min} token interpolated, not rendered literally — the failure the
    // locale parity test is blind to when both trees agree.
    const { en, ar } = bilingual()
    expect(en).toContain('At least 8 characters')
    expect(ar).toContain('8 أحرف على الأقل')
    for (const html of [en, ar]) expect(html).not.toContain('{min}')
  })

  it('starts quiet — meter empty, no match verdict, no error', () => {
    const html = render()
    // Three bars, none of them filled: strengthOf('') is 0, so no `s1/s2/s3`
    // tone class is applied to any of them.
    expect(html.match(/claim-meter-bar/g)).toHaveLength(3)
    expect(html).not.toMatch(/claim-meter-bar s[123]/)
    expect(html).not.toContain('claim-error')
    expect(html).not.toContain('claim-caps')
    // The match line EXISTS but is empty. That is deliberate and worth pinning:
    // an aria-live region has to be in the DOM before its content changes, or
    // the first verdict is never announced.
    expect(html).toContain('id="claim-confirm-status"')
    expect(html).toMatch(/class="claim-match"[^>]*role="status"[^>]*><\/p>/)
  })

  it('offers the way back to sign-in', () => {
    const { en, ar } = bilingual()
    for (const html of [en, ar]) expect(html).toContain('href="/signin"')
    expect(en).toContain('Already claimed it? Sign in')
    expect(ar).toContain('سبق أن فعّلته؟ سجّل الدخول')
  })

  it('mirrors the back arrow but not the +/- free glyphs', () => {
    // icon-directional is the class app-shell CSS mirrors in RTL. The arrow
    // points at the inline start, so it has to flip; nothing else here does.
    expect(render()).toContain('icon-directional')
  })
})

describe('Claim — a build with no backend', () => {
  it('says so instead of rendering a form that cannot work', () => {
    fx.configured = false
    try {
      const { en, ar } = bilingual()
      for (const html of [en, ar]) {
        expect(untranslated(html)).toEqual([])
        expect(html).toContain('claim-notice')
        expect(html).not.toContain('claim-form')
        expect(html).not.toContain('id="claim-password"')
      }
      // Stops short of the apostrophe on purpose — react-dom/server escapes it
      // to &#x27;, so asserting the full sentence would be asserting the
      // escaping rather than the copy.
      expect(en).toContain('This build has no backend configured')
      expect(ar).toContain('لا يمكن تفعيل الحسابات')
    } finally {
      fx.configured = true
    }
  })
})

describe('formatInvite — type it the way it was written down', () => {
  it('upper-cases, groups in fours and drops the noise', () => {
    expect(formatInvite('abcd2345')).toBe('ABCD-2345')
    expect(formatInvite('ABCD2345')).toBe('ABCD-2345')
    // A member reading a code aloud off a slip of paper types the spaces and
    // the hyphen they can see; none of it survives to the request.
    expect(formatInvite('abcd 2345')).toBe('ABCD-2345')
    expect(formatInvite('ABCD-2345')).toBe('ABCD-2345')
    expect(formatInvite('a-b c-d 2 3 4 5')).toBe('ABCD-2345')
  })

  it('does not insert the hyphen until there is a second group', () => {
    // Otherwise the caret jumps over a separator the member has not reached.
    expect(formatInvite('')).toBe('')
    expect(formatInvite('ab')).toBe('AB')
    expect(formatInvite('abcd')).toBe('ABCD')
    expect(formatInvite('abcde')).toBe('ABCD-E')
  })

  it('stops at eight characters however much is pasted', () => {
    expect(formatInvite('abcd2345extra')).toBe('ABCD-2345')
    expect(formatInvite('!!!!!!!!!!!!')).toBe('')
  })

  it('survives the round trip the edge function will perform on it', () => {
    // supabase/functions/claim-account/index.ts::normalizeCode, verbatim. The
    // hyphen this formatter adds MUST vanish here, or every claim fails the
    // hash comparison — two files, one invariant, nothing else asserting it.
    const normalizeCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    for (const typed of ['abcd2345', 'ABCD-2345', 'abcd 2345', 'a-bcd2345']) {
      expect(normalizeCode(formatInvite(typed))).toBe('ABCD2345')
    }
  })
})

describe('strengthOf — long beats clever', () => {
  it('scores nothing below the enforced floor', () => {
    // Under MIN_PASSWORD_LENGTH the meter stays blank rather than saying
    // "weak": the password is not weak, it is not yet a password.
    expect(strengthOf('')).toBe(0)
    expect(strengthOf('short')).toBe(0)
    expect(strengthOf('Aa1!Aa1')).toBe(0)
  })

  it('rates a bare eight characters weak', () => {
    expect(strengthOf('password')).toBe(1)
    expect(strengthOf('12345678')).toBe(1)
  })

  it('lets length alone earn the middle band', () => {
    expect(strengthOf('passwordpass')).toBe(2)
    // …and lets composition earn it at the floor, as the tie-breaker it is.
    expect(strengthOf('Passw0rd')).toBe(2)
  })

  it('rates a long passphrase strongest, beating a short cryptic one', () => {
    // The policy the meter exists to teach: "P@ssw0rd" must not outscore a
    // sixteen-character phrase, or the meter trains the wrong habit.
    expect(strengthOf('correcthorsebatterystaple')).toBe(3)
    expect(strengthOf('Passw0rd!2026')).toBe(3)
    expect(strengthOf('P@ssw0rd')).toBeLessThan(strengthOf('correcthorsebattery'))
  })

  it('scores an Arabic passphrase on length, since the classes are Latin', () => {
    // Documented as correct rather than tolerated: the meter is advisory and
    // nothing is ever rejected for scoring low, so a Latin-centric class count
    // must not become a hidden barrier for an Arabic-typing member.
    expect(strengthOf('كلمةسرطويلةجدا')).toBe(2)
    expect(strengthOf('كلمةسرطويلةجدااااااا')).toBe(3)
  })
})
