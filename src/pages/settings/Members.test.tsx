// Render proof for /settings/members — the admin gate, the shell the screen
// first paints, and the strings the create flow is made of.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real hooks,
// the real class names and the real translator.
//
// ── WHAT THAT REACHES, AND WHAT IT DOES NOT ────────────────────────────────
//
// A server render runs no effects and dispatches no events, so this file sees
// the screen EXACTLY as it first appears: the gate, the toolbar, and the loading
// skeleton that stands in for a roster the effect has not fetched yet. The
// roster rows, the open create form and the one-time invite panel are all behind
// state that only a click produces, and they are therefore OUT OF REACH here and
// claimed about nowhere below. Their interactive proof is a browser pass under
// docs/EVIDENCE — that is what a browser pass is for, and this file says so
// rather than pretending otherwise.
//
// What IS reachable, and is where the value of this file sits:
//
//  1. THE GATE, both ways. A member must not render an editable roster, and the
//     screen's own `useIsAdmin` is a fourth copy of a hook three other admin
//     screens carry — a copy is exactly the thing that drifts.
//  2. NO READ DURING RENDER. The api is mocked with recording stubs and the
//     assertion is that a render calls NONE of them. `listMemberAccounts()` goes
//     to an edge function; a read that crept into the render body would fire on
//     every keystroke of the create form.
//  3. THE STRINGS THE CREATE FLOW WILL RENDER. Every sentence on the unreachable
//     surfaces is checked for resolution AND for its interpolation tokens, in
//     both languages. This is the failure class Capture.test.tsx names third: a
//     caller and a locale file disagreeing about a placeholder renders the brace
//     text at the user, and localeParity.test.ts cannot see it because it
//     compares en against ar rather than either against its caller. On this
//     screen that would mean an admin reading a member their invite code out of
//     a sentence that says `{username}`.
//  4. THE GUARDS SHARE THE SERVER'S KEYS. Members.tsx's header claims that the
//     sentence on a disabled button and the sentence in a 403 toast can never
//     drift apart, because both are the same locale key. That claim spans two
//     modules with no type connecting them, so it is asserted here against the
//     real ADMIN_ERROR_KEYS.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope; `useIsAdmin` reads
  // window.location.search at RENDER time for the `?shell` preview flag, so a
  // location shim is not optional here.
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.location = { search: '', href: 'http://localhost/' }
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = { role: 'admin' as 'admin' | 'member', calls: [] as string[] }
  /**
   * A recording stub that can never reach the network. Hoisted out of the two
   * module factories below because BOTH of them need it now: the roles reads the
   * picker is fed from live in api/roles.ts, and a read that crept into the
   * render body there would be just as wrong as one in api/members.ts.
   */
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      state.calls.push(`${name}(${args.join(',')})`)
      return Promise.resolve({ ok: false as const, error: 'common.error' })
    }
  return { record, state }
})

vi.mock('../../api/supabase', () => ({ isConfigured: () => true, supabase: null }))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
}))

vi.mock('../../store/members', () => ({ invalidateMembers: () => {} }))

vi.mock('../../components/Confirm', () => ({ confirm: () => Promise.resolve(true) }))

// PARTIAL: the seven calls are recording stubs so nothing can reach the network,
// while ADMIN_ERROR_KEYS and the types stay the genuine article — a mocked key
// table would make the drift assertion below assert nothing.
vi.mock('../../api/members', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/members')>()
  return {
    ...actual,
    listMemberAccounts: fx.record('list'),
    listMemberRoleRefs: fx.record('listRefs'),
    createUsernameMember: fx.record('create'),
    reissueInvite: fx.record('reissue'),
    deleteMember: fx.record('delete'),
    setMemberRole: fx.record('setRole'),
    setMemberRoleId: fx.record('setRoleId'),
  }
})

// PARTIAL for the same reason and with the same shape. The two READS are stubs;
// `grants`, `adminHolderCount` and `ADMIN_PERMISSION` stay real, because the
// screen computes its last-admin guard with them and a mocked one would prove
// only that the mock agrees with itself.
vi.mock('../../api/roles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/roles')>()
  return {
    ...actual,
    listRoles: fx.record('listRoles'),
    listRolePermissions: fx.record('listRolePerms'),
  }
})

const { ADMIN_ERROR_KEYS, toMemberRoleRef } = await import('../../api/members')
const { setLocale, t } = await import('../../lib/i18n')
const { default: Members, hasEmailRecoverableAdmin, roleMoveBlockKey } = await import('./Members')
type MemberAccount = import('../../api/members').MemberAccount

/** A locale string as it appears in the MARKUP — react-dom escapes five chars. */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const render = (role: 'admin' | 'member' = 'admin'): string => {
  fx.state.role = role
  fx.state.calls = []
  return renderToStaticMarkup(
    <MemoryRouter>
      <Members />
    </MemoryRouter>,
  )
}

/* ─────────────────────────────── the gate ──────────────────────────────── */

describe('the admin gate', () => {
  it('renders no roster, no toolbar and no form for a member', () => {
    const html = render('member')
    // The route is gated too (App.tsx bounces a member back to /settings); this
    // is the screen's own second copy, and the one that survives a deep link
    // arriving before the profile has loaded.
    expect(html).not.toContain('mem-page')
    expect(html).not.toContain('mem-toolbar')
    expect(html).not.toContain(asHtml(t('members.add')))
  })

  it('renders the screen for an admin', () => {
    const html = render('admin')
    expect(html).toContain('mem-page')
    expect(html).toContain(asHtml(t('members.subtitle')))
  })
})

/* ───────────────────────── the shell it first paints ───────────────────── */

describe('the first paint', () => {
  it('offers a way back, which is the only chrome linking these screens', () => {
    // /settings/members is in neither nav — App.tsx's header names it and this
    // link is how a thumb gets out.
    const html = render()
    expect(html).toContain('href="/settings"')
    expect(html).toContain(asHtml(t('common.back')))
  })

  it('carries no heading of its own', () => {
    // App.tsx's header already renders route.members as the document's h1 for
    // this route; a second copy is noise in the heading outline.
    expect(render()).not.toContain(`<h1`)
  })

  it('shows the create form as closed, and says so to a screen reader', () => {
    const html = render()
    expect(html).toContain('aria-expanded="false"')
    // The form itself must NOT be in the markup — a static render cannot mint
    // an account, and the fields below are behind the toggle.
    expect(html).not.toContain('mem-form')
    expect(html).not.toContain('id="mem-username"')
  })

  it('stands in for the roster with a skeleton the screen reader ignores', () => {
    const html = render()
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('mem-list')
    expect(html).not.toContain('mem-row')
  })

  it('never shows an invite code it was not given', () => {
    // The panel holds a one-time credential. It exists only after a create or a
    // reissue answers, and there is no path that renders it on load.
    expect(render()).not.toContain('mem-invite')
  })

  it('reads nothing during render — the read belongs to an effect', () => {
    render()
    // listMemberAccounts() invokes an edge function. A read in the render body
    // would fire again on every keystroke of the create form.
    expect(fx.state.calls).toEqual([])
  })
})

/* ─────────────── the create flow's strings, in both languages ──────────── */

/**
 * Every sentence the create flow renders, with the tokens its caller passes.
 *
 * The surfaces are out of reach of a server render; the strings are not, and a
 * missing key or a mismatched placeholder is the failure that actually reaches a
 * user. Each entry is `[key, tokens the CALLER supplies]` read off Members.tsx.
 */
const CREATE_FLOW: readonly [string, readonly string[]][] = [
  ['members.add', []],
  ['members.addTitle', []],
  ['members.addHint', []],
  ['members.username', []],
  ['members.usernameHint', []],
  ['members.usernamePlaceholder', []],
  ['members.displayName', []],
  ['members.displayNameHint', []],
  ['members.displayNamePlaceholder', []],
  ['members.create', []],
  ['members.creating', []],
  ['members.errUsernameRequired', []],
  ['members.errUsernameInvalid', []],
  ['members.inviteTitle', []],
  ['members.inviteFor', ['username']],
  ['members.inviteExpires', ['date']],
  ['members.inviteWarning', []],
  ['members.inviteDone', []],
  ['members.errCopy', []],
  ['members.reissue', []],
  ['members.reissueTitle', []],
  ['members.reissueBody', ['name']],
  ['members.reissued', []],
  ['members.actionsFor', ['name']],
  ['members.lastSignIn', ['date']],
  ['members.neverSignedIn', []],
  ['settings.role', []],
  ['settings.roleMember', []],
  ['settings.roleAdmin', []],
]

describe('the strings the create flow is made of', () => {
  it('resolves every one of them in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const [key] of CREATE_FLOW) {
        // t() echoes an unknown key, so a value equal to its own key is a
        // missing string that would render a dot path at the user.
        expect(t(key)).not.toBe(key)
        expect(t(key).trim()).not.toBe('')
      }
    }
    setLocale('en')
  })

  it('fills every placeholder its caller actually passes', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const [key, tokens] of CREATE_FLOW) {
        const vars = Object.fromEntries(tokens.map((token) => [token, 'X']))
        const out = t(key, vars)
        // The bug class: `t('members.inviteFor', { username })` against a string
        // shipped with `{value}` renders the braces to an admin who is reading a
        // credential aloud.
        expect(out).not.toMatch(/\{[a-zA-Z]+\}/)
        if (tokens.length > 0) expect(out).toContain('X')
      }
    }
    setLocale('en')
  })
})

/* ──────────────────── recovery: the lockout with no route out ──────────── */

/**
 * A roster row, with only the fields the predicate reads made interesting.
 *
 * `role` and `username` ARE the predicate's whole input; everything else is
 * filler so the shape type-checks. Written as a factory rather than a fixture
 * array so each case below states the one thing it is about.
 */
function row(part: Partial<MemberAccount>): MemberAccount {
  return {
    id: 'x',
    displayName: 'X',
    role: 'member',
    email: 'x@opstrack.internal',
    username: 'x',
    claimed: true,
    createdAt: '2026-01-01T00:00:00Z',
    lastSignInAt: null,
    hasProfile: true,
    inviteExpiresAt: null,
    isBootstrapAdmin: false,
    isSelf: false,
    ...part,
  }
}

const OWNER = row({ role: 'admin', username: null, email: 'aziz@example.com', isBootstrapAdmin: true })
const USERNAME_ADMIN = row({ role: 'admin', username: 'nasser', displayName: 'Nasser' })
const INTERN = row({ username: 'intern.one', displayName: 'Intern' })

describe('hasEmailRecoverableAdmin', () => {
  it('is true when an admin signs in with a real address', () => {
    // The live workspace: the bootstrap owner plus username accounts. He can
    // always have a sign-in code mailed to him, so nobody is stranded.
    expect(hasEmailRecoverableAdmin([OWNER, USERNAME_ADMIN, INTERN])).toBe(true)
  })

  it('is FALSE when every admin signs in with a username', () => {
    // The state the warning exists for. `last_admin` and `bootstrap_admin` do
    // not prevent it: they guard demotion and deletion, and this workspace is
    // one forgotten password — not one deletion — from having no administrator
    // who can get back in.
    expect(hasEmailRecoverableAdmin([USERNAME_ADMIN, INTERN])).toBe(false)
  })

  it('does not count an email account that is only a member', () => {
    // A real address is necessary and not sufficient: a member holding one
    // cannot reissue anybody a code, so it rescues nothing.
    expect(hasEmailRecoverableAdmin([USERNAME_ADMIN, row({ username: null, email: 'm@x.io' })])).toBe(
      false,
    )
  })

  it('trusts the role the server sent, which already carries the bootstrap floor', () => {
    // The list endpoint writes role 'admin' for a bootstrap address whatever
    // the profiles row says. A `hasProfile: false` owner is therefore still an
    // admin here, and the warning must not fire at a workspace that is fine.
    expect(hasEmailRecoverableAdmin([row({ ...OWNER, hasProfile: false })])).toBe(true)
  })

  it('is false for an empty roster rather than throwing', () => {
    // Not a state the screen renders the warning in — it guards on length — but
    // the predicate is total either way.
    expect(hasEmailRecoverableAdmin([])).toBe(false)
  })
})

/* ─────────── the role picker: the guard, before it is enforced ─────────── */

/**
 * The guard matrix, stated once.
 *
 * `roleMoveBlockKey` is this screen's copy of rules that live in two different
 * servers — the edge function's bootstrap floor, and 0025's
 * `assert_admin_survives()` statement trigger — and the whole reason it exists
 * is so a refusal arrives as a disabled option with a sentence rather than as a
 * 42501 painted over a control that has already moved. A copy of a server rule
 * is exactly the thing that drifts, so every branch is pinned here.
 *
 * The picker itself is out of reach of a server render (it is behind the roles
 * read, which is an effect), which is precisely why the decision was factored
 * out of the JSX into a pure function in the first place.
 */
const MOVE = {
  isSelf: false,
  isBootstrapAdmin: false,
  hasProfile: true,
  fromGrantsAdmin: false,
  toGrantsAdmin: false,
  adminHolders: 3,
} as const

describe('roleMoveBlockKey', () => {
  it('allows an ordinary move between two roles that grant no admin', () => {
    expect(roleMoveBlockKey(MOVE)).toBe(null)
  })

  it('allows a promotion into an administering role, always', () => {
    // Nothing on this screen blocks a PROMOTION: it cannot shrink the admin set,
    // and a workspace with too many admins is a decision, not a lockout.
    expect(roleMoveBlockKey({ ...MOVE, toGrantsAdmin: true, adminHolders: 0 })).toBe(null)
  })

  it('allows a move BETWEEN two administering roles even at a count of one', () => {
    // The rule is about losing the permission, never about the identity of the
    // role — which is what lets a workspace reorganise Admin into Executive
    // without the last holder being pinned in place forever.
    expect(
      roleMoveBlockKey({
        ...MOVE,
        fromGrantsAdmin: true,
        toGrantsAdmin: true,
        adminHolders: 1,
      }),
    ).toBe(null)
  })

  it('refuses to move the last administrator out, with the unrepairable sentence', () => {
    expect(roleMoveBlockKey({ ...MOVE, fromGrantsAdmin: true, adminHolders: 1 })).toBe(
      'members.errLastAdminMove',
    )
  })

  it('does not wrap around at a count of zero', () => {
    // `<= 1`, not `=== 1`. A count of zero means the screen's picture of the
    // workspace is already wrong; the answer to that is not permission.
    expect(roleMoveBlockKey({ ...MOVE, fromGrantsAdmin: true, adminHolders: 0 })).toBe(
      'members.errLastAdminMove',
    )
  })

  it('refuses a self-demotion however many other admins there are', () => {
    expect(
      roleMoveBlockKey({ ...MOVE, isSelf: true, fromGrantsAdmin: true, adminHolders: 9 }),
    ).toBe('members.errSelfDemote')
  })

  it('lets you move YOURSELF between two administering roles', () => {
    // A sideways move loses nothing, and 0025's GUARD 2 only reverts a GAIN.
    expect(
      roleMoveBlockKey({ ...MOVE, isSelf: true, fromGrantsAdmin: true, toGrantsAdmin: true }),
    ).toBe(null)
  })

  it('refuses to move the bootstrap owner out of administering', () => {
    // The edge function pins that address as an admin on every read, so a
    // role_id saying otherwise would leave the roster and `is_admin()` in
    // permanent disagreement rather than merely being unusual.
    expect(
      roleMoveBlockKey({ ...MOVE, isBootstrapAdmin: true, fromGrantsAdmin: true }),
    ).toBe('members.errBootstrapAdmin')
  })

  it('blames the missing profile row before anything else', () => {
    // First, because it is the only branch about whether the UPDATE can match a
    // row at all — every other reason presumes there is something to write.
    expect(
      roleMoveBlockKey({
        ...MOVE,
        hasProfile: false,
        isSelf: true,
        isBootstrapAdmin: true,
        fromGrantsAdmin: true,
        adminHolders: 1,
      }),
    ).toBe('members.errNoProfileRow')
  })

  it('refuses nothing on a row that simply has no profile to move', () => {
    // Only the one reason, and it applies to every destination — which is why
    // the screen disables the whole control rather than each option.
    expect(roleMoveBlockKey({ ...MOVE, hasProfile: false })).toBe('members.errNoProfileRow')
  })
})

/**
 * The `profiles` row → `MemberRoleRef` boundary.
 *
 * Tested HERE rather than in api/members.test.ts because that file belongs to
 * another unit this wave (§1.0.4), and the trim is not cosmetic: `position` is
 * printed beside the name with a separator in front of it, so a value of one
 * space renders "Nawaf Alharbi ·" and nothing after the dot.
 */
describe('toMemberRoleRef', () => {
  it('trims the position, so a blank one prints no dangling separator', () => {
    expect(
      toMemberRoleRef({ id: 'a', role: 'member', role_id: 'r1', position: '   ' }).position,
    ).toBe('')
  })

  it('keeps a null position as the empty string the column defaults to', () => {
    expect(toMemberRoleRef({ id: 'a', role: 'member', role_id: null, position: null })).toEqual({
      id: 'a',
      role: 'member',
      roleId: null,
      position: '',
    })
  })

  it('narrows anything that is not exactly admin to member', () => {
    // The same narrowing `toMemberAccount` does, and for the same reason: the
    // legacy column is text, and a value nobody expected must not read as admin.
    expect(toMemberRoleRef({ id: 'a', role: 'ADMIN', role_id: null, position: '' }).role).toBe(
      'member',
    )
    expect(toMemberRoleRef({ id: 'a', role: 'admin', role_id: null, position: '' }).role).toBe(
      'admin',
    )
  })
})

/** Every sentence the role picker is made of, with the tokens its caller passes. */
const ROLE_ASSIGN: readonly [string, readonly string[]][] = [
  ['members.roleFor', ['name']],
  ['members.roleMoved', ['name', 'role']],
  ['members.roleUnknown', []],
  ['members.rolesUnavailable', []],
  ['members.errLastAdminMove', []],
  ['members.errRoleReverted', []],
  ['members.errNoProfileRow', []],
  ['members.errSelfDemote', []],
  ['members.errBootstrapAdmin', []],
  ['members.errNotFound', []],
]

describe('the strings the role picker is made of', () => {
  it('resolves and fills every one of them in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const [key, tokens] of ROLE_ASSIGN) {
        expect(t(key)).not.toBe(key)
        expect(t(key).trim()).not.toBe('')
        const out = t(key, Object.fromEntries(tokens.map((token) => [token, 'X'])))
        expect(out).not.toMatch(/\{[a-zA-Z]+\}/)
        if (tokens.length > 0) expect(out).toContain('X')
      }
    }
    setLocale('en')
  })

  it('fences the role name as well as the person, in both trees', () => {
    // `{role}` is a role LABEL Aziz can rename to anything on the roles screen,
    // so it can begin with a strong character of either direction — and it is
    // not on bidi.test.ts's USER_VALUE_TOKENS list, so this is where it gets
    // pinned. FSI…PDI immediately around the token is the shape that gate looks
    // for on the tokens it does know.
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const out = t('members.roleMoved', { name: 'NN', role: 'RR' })
      expect(out).toContain('⁨NN⁩')
      expect(out).toContain('⁨RR⁩')
    }
    setLocale('en')
  })

  it('says the refusal is unrepairable from inside the app, not just that it failed', () => {
    // The sentence is the whole point of showing the guard before enforcing it:
    // "that didn't work" sends an admin to try again, and there is no again.
    setLocale('en')
    const en = t('members.errLastAdminMove')
    expect(en).toMatch(/database/i)
    expect(en.length).toBeGreaterThan(80)
  })
})

/**
 * Every sentence the recovery copy is made of, with the tokens its caller passes.
 *
 * Same reachability story as CREATE_FLOW above: these render behind a loaded
 * roster, which a server render never produces, so the STRINGS are what is
 * assertable here and a browser pass owns the pixels.
 */
const RECOVERY: readonly [string, readonly string[]][] = [
  ['admin.recovery.title', []],
  ['admin.recovery.username', ['action']],
  ['admin.recovery.usernameKeepsWorking', []],
  ['admin.recovery.email', []],
  ['admin.recovery.self', ['action']],
  ['admin.recovery.noEmailAdmin', []],
]

describe('the recovery copy', () => {
  it('resolves and fills in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const [key, tokens] of RECOVERY) {
        expect(t(key)).not.toBe(key)
        expect(t(key).trim()).not.toBe('')
        const out = t(key, Object.fromEntries(tokens.map((token) => [token, 'X'])))
        expect(out).not.toMatch(/\{[a-zA-Z]+\}/)
        if (tokens.length > 0) expect(out).toContain('X')
      }
    }
    setLocale('en')
  })

  it('names the button by asking for its label, so the two cannot drift', () => {
    // Members.tsx interpolates t('members.reissue') rather than quoting the
    // word. Settings › Terminology can rename any label at runtime, and a copy
    // of it here would be wrong for exactly the workspace that had renamed it.
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const label = t('members.reissue')
      expect(t('admin.recovery.username', { action: label })).toContain(label)
    }
    setLocale('en')
  })

  it('fences the interpolated label in both trees', () => {
    // The value is free text once an admin has overridden it, so it can begin
    // with a strong character of either direction. FSI…PDI immediately around
    // the token is the shape bidi.test.ts's gate checks for the tokens it
    // knows; `action` is not on that list, so this is where it gets pinned.
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      expect(t('admin.recovery.username', { action: 'ZZ' })).toContain('⁨ZZ⁩')
    }
    setLocale('en')
  })
})

/* ─────────────── the disabled reasons are the server's own ─────────────── */

describe('the mirrored guards', () => {
  /** The four keys Members.tsx hardcodes onto its disabled controls. */
  const BLOCK_KEYS = [
    'members.errSelfDemote',
    'members.errSelfDelete',
    'members.errLastAdmin',
    'members.errBootstrapAdmin',
  ]

  it('uses the same key the 403 would have resolved to', () => {
    // Members.tsx: "they share the *same locale keys* as the server's refusals,
    // so the sentence on the disabled button and the sentence in the toast can
    // never drift apart." Two modules, one invariant, no type connecting them.
    const served = new Set(Object.values(ADMIN_ERROR_KEYS))
    for (const key of BLOCK_KEYS) expect(served.has(key)).toBe(true)
  })

  it('maps each of the four server codes the guards mirror', () => {
    for (const code of ['self_demote', 'self_delete', 'last_admin', 'bootstrap_admin']) {
      expect(ADMIN_ERROR_KEYS[code]).toBeDefined()
      expect(BLOCK_KEYS).toContain(ADMIN_ERROR_KEYS[code])
    }
  })

  it('lets the picker reuse a server key wherever the server holds the same rule', () => {
    // Two of the picker's three refusals are the edge function's rules seen from
    // another angle, so they say the function's own sentence.
    const served = new Set(Object.values(ADMIN_ERROR_KEYS))
    expect(served.has('members.errSelfDemote')).toBe(true)
    expect(served.has('members.errBootstrapAdmin')).toBe(true)
    // The third is NOT the function's and must not pretend to be: the rule it
    // mirrors is 0025's `assert_admin_survives()`, a statement trigger in
    // Postgres that the function cannot see and has no code for. A key shared
    // with `last_admin` would promise a drift-proofing that does not exist.
    expect(served.has('members.errLastAdminMove')).toBe(false)
    expect(ADMIN_ERROR_KEYS['last_admin']).toBe('members.errLastAdmin')
  })

  it('says something in both languages for every code the function can answer', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const key of Object.values(ADMIN_ERROR_KEYS)) {
        expect(t(key)).not.toBe(key)
      }
    }
    setLocale('en')
  })
})

/* ────────────────────────── nothing unresolved ─────────────────────────── */

describe('in both languages', () => {
  it('renders no dot path on the surface a member or an admin first sees', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const html = render()
      expect(html).not.toMatch(/>members\.[a-zA-Z]/)
      expect(html).not.toMatch(/>settings\.[a-zA-Z]/)
      expect(html).not.toMatch(/>common\.[a-zA-Z]/)
      expect(html).not.toMatch(/\{[a-zA-Z]+\}/)
    }
    setLocale('en')
  })
})

// NO ROSTER FIXTURES BELOW, deliberately. A `MemberAccount[]` built here would
// be read by nothing — the effect that would render it does not run under
// react-dom/server — and a fixture no assertion touches is the kind of dead
// weight that reads as coverage. The roster rows are the browser pass's.
