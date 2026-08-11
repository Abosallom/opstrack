// Proof for /settings/roles — the last-admin guard as arithmetic, the admin
// gate, the shell the screen first paints, and the strings its interactive
// surfaces are made of.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real hooks,
// the real class names and the real translator. A server render runs no effects
// and dispatches no events, so this file sees the screen EXACTLY as it first
// appears — the gate, the standing note, the live region and the skeleton. The
// role cards are behind a fetch and are claimed about nowhere below.
//
// ── WHERE THE VALUE OF THIS FILE ACTUALLY SITS ─────────────────────────────
//
// THE GUARD. `revokeWouldOrphanWorkspace` is the one piece of logic on this
// screen whose failure is unrecoverable: get it wrong in the permissive
// direction and a workspace can be revoked into having no administrator, which
// no one can repair from inside the app. It is pure, it lives in api/roles.ts,
// and it is exercised here against the shapes it will really meet — including
// the three that the obvious implementation gets wrong:
//
//   1. a SECOND role also granting workspace.admin, held by nobody. Revoking
//      from the role people actually hold still empties the workspace, so
//      "another role grants it" is not the question.
//   2. a role granting workspace.admin that nobody holds. Revoking is harmless
//      and must be ALLOWED, or a tidy-up is refused for no reason.
//   3. a workspace with no admins at all. 0025 refuses the TRANSITION to zero,
//      never the STATE of zero — the absolute reading refuses the first member
//      anybody provisions on a fresh project, which is a locked door with the
//      key inside. PROBE 3 in the migration refuted it before this screen
//      existed, and this test pins the client's copy of the same rule.
//
// THE LEGACY FALLBACK. `has_perm()` resolves a profile with a null `role_id`
// through the old `profiles.role` text column, so the client's count has to as
// well. A guard that disagreed with the database would refuse a write the
// database allows, or — the expensive direction — allow one it refuses, after
// the switch has already animated.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import enRoles from '../../locales/en/roles.json'
import arRoles from '../../locales/ar/roles.json'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, store/config adds a window
  // focus listener at module scope, and `useIsAdmin` reads
  // window.location.search at RENDER time for the `?shell` preview flag — all
  // at import or render time, so the shims cannot wait for a beforeAll().
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
  return { state }
})

vi.mock('../../api/supabase', () => ({ isConfigured: () => true, supabase: null }))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
}))

const { setLocale, t } = await import('../../lib/i18n')

// THE PURE HALF OF api/roles.ts IS THE REAL ONE. vi.mock hoists above this
// import, so what lands in `realRoles` is the mocked module — which SPREADS the
// actual module and replaces only the seven functions that touch the network.
// Wrapping rather than replacing is deliberate: a renamed export fails loudly
// here instead of silently becoming undefined, and the guard under test is the
// code that will actually run.
const realRoles = await import('../../api/roles')

vi.mock('../../api/roles', async () => {
  const actual = await vi.importActual<typeof import('../../api/roles')>('../../api/roles')
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      fx.state.calls.push(`${name}(${args.join(',')})`)
      return Promise.resolve({ ok: false as const, error: 'common.error' })
    }
  return {
    ...actual,
    listRoles: record('listRoles'),
    listRolePermissions: record('listRolePermissions'),
    listProfileRoles: record('listProfileRoles'),
    createRole: record('createRole'),
    updateRole: record('updateRole'),
    deleteRole: record('deleteRole'),
    setRolePermission: record('setRolePermission'),
  }
})

const RolesAdmin = (await import('./RolesAdmin')).default

/**
 * The screen's own source, as text. `?raw` rather than exporting internals: the
 * properties worth pinning here are properties of the FILE — that it uses
 * logical properties only, and that it computes the guard rather than waiting
 * for the database to raise. localeReach.test.ts reads source the same way.
 */
const SOURCE: string = (await import('./RolesAdmin.tsx?raw')).default
/** The api module's source, for the key scan below. */
const API_SOURCE: string = (await import('../../api/roles.ts?raw')).default

// ⚠ THE STYLESHEET READS AS THE EMPTY STRING UNDER THE CURRENT vitest CONFIG,
//   measured rather than assumed: `vitest.config.ts` sets no `css` option, so it
//   defaults to `css: false` and every .css module — `?raw` query included —
//   becomes an empty stub. A sheet assertion written in ignorance of that would
//   pass against nothing at all, forever, which is the exact way a static gate
//   rots into a no-op. Adding `css: true` to that file makes `?raw` return the
//   real 8.7 kB (verified against a scratch config), and the block at the bottom
//   of this file turns itself on the moment it does.
const SHEET: string = (await import('./roles.css?raw')).default

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
      <RolesAdmin />
    </MemoryRouter>,
  )
}

/* ─────────────── the guard: a workspace cannot be orphaned ─────────────── */

const {
  ADMIN_PERMISSION,
  PERMISSIONS,
  ROLE_KEY_RE,
  adminHolderCount,
  grants,
  holderCounts,
  revokeWouldOrphanWorkspace,
  roleErrorKey,
} = realRoles

type Role = import('../../api/roles').Role
type RolePermission = import('../../api/roles').RolePermission
type ProfileRoleRef = import('../../api/roles').ProfileRoleRef

const role = (id: string, key: string, system = false): Role => ({
  id,
  key,
  name: key,
  name_ar: '',
  sort_order: 0,
  is_system: system,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const grant = (roleId: string, key: string, granted = true): RolePermission => ({
  role_id: roleId,
  permission_key: key,
  granted,
})

const ADMIN = role('r-admin', 'admin', true)
const MEMBER = role('r-member', 'member', true)
const DIRECTOR = role('r-dir', 'director')
const ROLES = [ADMIN, DIRECTOR, MEMBER]

/** Aziz and Nasser on Admin, seven Directors, the rest ordinary members. */
const WORKSPACE: ProfileRoleRef[] = [
  { role: 'admin', role_id: ADMIN.id },
  { role: 'admin', role_id: ADMIN.id },
  ...Array.from({ length: 7 }, () => ({ role: 'member', role_id: DIRECTOR.id })),
  ...Array.from({ length: 9 }, () => ({ role: 'member', role_id: MEMBER.id })),
]

const SEEDED: RolePermission[] = [
  grant(ADMIN.id, 'workspace.admin'),
  grant(ADMIN.id, 'members.manage'),
  grant(ADMIN.id, 'structure.edit'),
  grant(ADMIN.id, 'vocab.edit'),
  grant(ADMIN.id, 'capture.write'),
  grant(DIRECTOR.id, 'structure.edit'),
  grant(DIRECTOR.id, 'vocab.edit'),
  grant(DIRECTOR.id, 'capture.write'),
  grant(MEMBER.id, 'capture.write'),
]

describe('the last-admin guard, computed before the database has to refuse', () => {
  it('counts the eighteen-person workspace the way admin_holder_count() does', () => {
    expect(WORKSPACE).toHaveLength(18)
    expect(holderCounts(WORKSPACE, ROLES).get(DIRECTOR.id)).toBe(7)
    expect(adminHolderCount(WORKSPACE, ROLES, SEEDED)).toBe(2)
  })

  it('refuses the revocation that would leave nobody able to administer', () => {
    expect(revokeWouldOrphanWorkspace(ADMIN.id, ADMIN_PERMISSION, WORKSPACE, ROLES, SEEDED)).toBe(
      true,
    )
  })

  it('allows revoking any OTHER permission from that same role', () => {
    // Nothing else in the catalogue can lock anybody out — and a guard that
    // refused all five would make the Admin role uneditable, which is not what
    // 0025 says and not what Aziz asked for.
    for (const meta of PERMISSIONS) {
      if (meta.key === ADMIN_PERMISSION) continue
      expect(revokeWouldOrphanWorkspace(ADMIN.id, meta.key, WORKSPACE, ROLES, SEEDED)).toBe(false)
    }
  })

  it('still refuses when a SECOND role grants it that nobody holds', () => {
    // The trap in the obvious implementation: "another role grants it" is not
    // the question. The question is whether anybody would still HOLD one.
    const perms = [...SEEDED, grant(DIRECTOR.id, ADMIN_PERMISSION)]
    const nobodyOnDirector = WORKSPACE.filter((p) => p.role_id !== DIRECTOR.id)
    expect(
      revokeWouldOrphanWorkspace(ADMIN.id, ADMIN_PERMISSION, nobodyOnDirector, ROLES, perms),
    ).toBe(true)
  })

  it('allows it once somebody actually holds that second role', () => {
    const perms = [...SEEDED, grant(DIRECTOR.id, ADMIN_PERMISSION)]
    expect(revokeWouldOrphanWorkspace(ADMIN.id, ADMIN_PERMISSION, WORKSPACE, ROLES, perms)).toBe(
      false,
    )
  })

  it('allows revoking from a role nobody holds', () => {
    const orphanRole = role('r-ghost', 'ghost')
    const perms = [...SEEDED, grant(orphanRole.id, ADMIN_PERMISSION)]
    expect(
      revokeWouldOrphanWorkspace(orphanRole.id, ADMIN_PERMISSION, WORKSPACE, [...ROLES, orphanRole], perms),
    ).toBe(false)
  })

  it('refuses NOTHING on a workspace that has no admins yet', () => {
    // 0025 refuses the TRANSITION to zero, never the STATE of zero. The absolute
    // reading refuses the first member provisioned on a fresh project — a guard
    // that blocks the bootstrap is a locked door with the key inside.
    const noAdmins = SEEDED.filter((p) => p.permission_key !== ADMIN_PERMISSION)
    expect(revokeWouldOrphanWorkspace(ADMIN.id, ADMIN_PERMISSION, WORKSPACE, ROLES, noAdmins)).toBe(
      false,
    )
    expect(revokeWouldOrphanWorkspace(ADMIN.id, ADMIN_PERMISSION, [], ROLES, SEEDED)).toBe(false)
  })

  it('resolves a null role_id through the legacy column, exactly as has_perm() does', () => {
    // A profile written by handle_new_user() before profiles_role_sync() ran.
    // Counting it as "no role" would under-count the admins and let the last
    // grant be revoked from a client that thinks the workspace is already empty.
    const legacy: ProfileRoleRef[] = [{ role: 'admin', role_id: null }]
    expect(adminHolderCount(legacy, ROLES, SEEDED)).toBe(1)
    expect(revokeWouldOrphanWorkspace(ADMIN.id, ADMIN_PERMISSION, legacy, ROLES, SEEDED)).toBe(true)
  })

  it('reads an explicit deny as a no, the same as an absent row', () => {
    // `granted = false` exists so a switch can go off without the row vanishing
    // (0025:236). A guard that only looked for the row's PRESENCE would count a
    // denied role as an admin role and refuse a revocation that changes nothing.
    const denied = SEEDED.map((p) =>
      p.role_id === ADMIN.id && p.permission_key === ADMIN_PERMISSION
        ? { ...p, granted: false }
        : p,
    )
    expect(grants(denied, ADMIN.id, ADMIN_PERMISSION)).toBe(false)
    expect(adminHolderCount(WORKSPACE, ROLES, denied)).toBe(0)
  })
})

/* ─────────────────────── the catalogue is the schema's ─────────────────── */

describe('the permission catalogue', () => {
  it('lists exactly the keys role_permissions_key_ck allows', () => {
    // The constraint is the source of truth (0025:256). A key here that the
    // database rejects would render a switch that fails with a 23514; a key
    // there that is missing here is a grant no screen can revoke.
    expect(PERMISSIONS.map((p) => p.key).sort()).toEqual([
      'capture.write',
      'members.manage',
      'structure.edit',
      'vocab.edit',
      'workspace.admin',
    ])
  })

  it('says which keys are in force today and which are only declared', () => {
    // 0025's header measured it, and its amendment moved the count: is_admin()
    // IS workspace.admin; members.manage is this screen's own write gate; and
    // structure.edit / vocab.edit became the write gate on seven configuration
    // tables and eight admin RPCs. Only capture.write is still declared —
    // `entries` is is_member(), because filing work is what membership IS.
    //
    // ⚠ THIS ASSERTS THE DATABASE, NOT THE SCREENS. A Director holding both live
    //   keys is still redirected away from every configuration screen, because
    //   they all guard on `useIsAdmin()`. See api/roles.ts's header. If that is
    //   ever fixed, this test does not change — it was never about the client.
    const live = PERMISSIONS.filter((p) => p.reach === 'live').map((p) => p.key)
    expect(live.sort()).toEqual([
      'members.manage',
      'structure.edit',
      'vocab.edit',
      'workspace.admin',
    ])
    expect(PERMISSIONS.filter((p) => p.reach === 'declared').map((p) => p.key)).toEqual([
      'capture.write',
    ])
  })

  it('mirrors roles_key_ck, so a bad key is refused before the round trip', () => {
    expect(ROLE_KEY_RE.test('director')).toBe(true)
    expect(ROLE_KEY_RE.test('ops_lead2')).toBe(true)
    expect(ROLE_KEY_RE.test('Director')).toBe(false)
    expect(ROLE_KEY_RE.test('d')).toBe(false)
    expect(ROLE_KEY_RE.test('2fast')).toBe(false)
    expect(ROLE_KEY_RE.test('has-dash')).toBe(false)
  })
})

/* ───────────────────────────── error mapping ───────────────────────────── */

describe('0025’s refusals become sentences', () => {
  it('maps last_admin to its own key, NOT to the generic forbidden one', () => {
    // The reason roleErrorKey exists. The guard raises with SQLSTATE 42501,
    // which pgErrorKey maps to "an admin only can do that" — wrong twice over
    // for a revocation made BY an admin, and silent about the fix.
    expect(
      roleErrorKey({
        code: '42501',
        message:
          'last_admin: this would leave the workspace with nobody holding workspace.admin.',
      }),
    ).toBe('roles.errLastAdmin')
  })

  it('names the built-in role and the in-use role separately', () => {
    expect(roleErrorKey({ code: '42501', message: 'role_is_system: the admin role is built in' })).toBe(
      'roles.errSystem',
    )
    expect(roleErrorKey({ code: '23503', message: 'role_in_use: 7 member(s) hold the director role' })).toBe(
      'roles.errInUse',
    )
    expect(
      roleErrorKey({ code: '42501', message: 'role_key_immutable: a role’s key is its machine name' }),
    ).toBe('roles.errKeyImmutable')
  })

  it('tells a duplicate English name from a duplicate Arabic one', () => {
    expect(
      roleErrorKey({
        code: '23505',
        details: 'Key (lower(name))=(director) already exists.',
        message: 'duplicate key value violates unique constraint "roles_name_uidx"',
      }),
    ).toBe('roles.errNameTaken')
    expect(
      roleErrorKey({
        code: '23505',
        message: 'duplicate key value violates unique constraint "roles_name_ar_uidx"',
      }),
    ).toBe('roles.errNameArTaken')
  })

  it('falls through to the shared mapper for everything it does not own', () => {
    // PGRST205 is "0025 has not been applied to this project", which the screen
    // answers with a runbook line rather than a shrug.
    expect(roleErrorKey({ code: 'PGRST205', message: 'could not find the table' })).toBe(
      'common.errMissingTable',
    )
    expect(roleErrorKey(null)).toBe('common.error')
  })
})

/* ─────────────────────────────── the gate ──────────────────────────────── */

describe('the admin gate', () => {
  it('renders nothing editable for a member', () => {
    const html = render('member')
    expect(html).not.toContain('class="rol"')
    expect(html).not.toContain('rol-list')
    expect(html).not.toContain(asHtml(t('roles.subtitle')))
  })

  it('renders the screen for an admin', () => {
    const html = render('admin')
    expect(html).toContain('class="rol"')
    expect(html).toContain(asHtml(t('roles.subtitle')))
  })
})

/* ───────────────────────── the shell it first paints ───────────────────── */

describe('the first paint', () => {
  it('says the permission LIST is fixed, before anything can be clicked', () => {
    // The screen's own words, not a comment in a migration. Aziz asked for
    // custom permissions; what he gets is custom ROLES, and the difference has
    // to be on the screen rather than in a handoff note.
    const html = render()
    expect(html).toContain(asHtml(t('roles.fixedTitle')))
    expect(html).toContain(asHtml(t('roles.fixedBody')))
    // Above the list: it is rendered before the skeleton in the markup.
    expect(html.indexOf(asHtml(t('roles.fixedTitle')))).toBeLessThan(html.indexOf('skeleton'))
  })

  it('offers a way back, which is the only chrome linking these screens', () => {
    const html = render()
    expect(html).toContain('href="/settings"')
    expect(html).toContain(asHtml(t('common.back')))
  })

  it('carries no heading of its own', () => {
    // App.tsx's header already renders roles.title as the document h1 for this
    // route; a second copy is noise in the heading outline.
    expect(render()).not.toContain('<h1')
  })

  it('shows a skeleton, not an empty state, before the read has answered', () => {
    // "No roles yet" is a claim about the workspace, and making it while the
    // request is in flight tells an admin their migration did not run.
    const html = render()
    expect(html).toContain('skeleton')
    expect(html).not.toContain(asHtml(t('roles.empty')))
  })

  it('ships the live region before there is anything to announce', () => {
    // An aria-live region has to be in the accessibility tree BEFORE its content
    // changes; one that appears with its first message is not announced at all.
    const html = render()
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="status"')
  })

  it('reads nothing during render — the fetch belongs to an effect', () => {
    render()
    expect(fx.state.calls).toEqual([])
  })
})

/* ─────────── the screen's construction, as properties of the file ──────── */

describe('the screen is built the way the house rules require', () => {
  it('computes the guard itself rather than waiting for a 42501', () => {
    // A red toast after the switch has animated across is a worse experience
    // than a switch that will not move and says why — and the state it prevents
    // cannot be repaired from inside the app.
    expect(SOURCE).toContain('revokeWouldOrphanWorkspace')
    expect(SOURCE).toContain('roles.lastAdminReason')
  })

  it('keeps a refused switch in the tab order, with its reason', () => {
    // aria-disabled, not `disabled`: a disabled button leaves the tab order and
    // takes its explanation with it.
    expect(SOURCE).toContain('aria-disabled={blocked || undefined}')
    expect(SOURCE).toContain('aria-describedby={described}')
  })

})

/* ─────────────────────────── the two locale files ──────────────────────── */
//
// ⚠ READ FROM DISK, NOT THROUGH t(), AND THAT IS THE POINT OF THIS BLOCK.
//   `src/locales/index.ts` is the INTEGRATOR's file: a namespace is not in the
//   merged bundle until two imports and two spread entries are added there. So
//   until this wave is integrated, every `roles.*` key resolves through t() to
//   its own dot path — and a test written only against t() would either fail
//   for a reason that is nobody's defect, or (worse) be softened until it
//   asserted nothing. The properties below are properties of the FILES, hold
//   today, and keep holding after the wiring lands. The t() block underneath is
//   gated on the wiring and turns itself on the moment it arrives.

type Node = string | Record<string, string>

const EN = (enRoles as { roles: Record<string, Node> }).roles
const AR = (arRoles as { roles: Record<string, Node> }).roles

const isPlural = (v: Node): v is Record<string, string> => typeof v !== 'string'

/** `key` → its forms. A plain string is one form called `other`. */
function forms(tree: Record<string, Node>): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  for (const [k, v] of Object.entries(tree)) out.set(k, isPlural(v) ? v : { other: v })
  return out
}

const EN_FORMS = forms(EN)
const AR_FORMS = forms(AR)
const tokensOf = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('the roles namespace, as two files on disk', () => {
  it('ships the same keys in both languages', () => {
    expect([...EN_FORMS.keys()].sort()).toEqual([...AR_FORMS.keys()].sort())
    // A flattener that returned nothing would make every assertion below
    // vacuously true.
    expect(EN_FORMS.size).toBeGreaterThan(40)
  })

  it('has a string for every key this screen and its api ask for', () => {
    // localeReach.test.ts's property, applied locally so it can fail on this
    // worker's machine rather than at the integration. Both sources are scanned,
    // because half the keys on this screen — the ten catalogue strings — are
    // named in api/roles.ts and never appear in the .tsx at all.
    const asked = new Set<string>()
    for (const src of [SOURCE, API_SOURCE]) {
      for (const m of src.matchAll(/'roles\.([A-Za-z][A-Za-z0-9]*)'/g)) asked.add(m[1])
    }
    // The scan has to FIND something, or it proves nothing.
    expect(asked.size).toBeGreaterThan(30)
    expect([...asked].filter((k) => !EN_FORMS.has(k)).sort()).toEqual([])
    expect([...asked].filter((k) => !AR_FORMS.has(k)).sort()).toEqual([])
  })

  it('leaves no value empty in either language', () => {
    const empty: string[] = []
    for (const [lang, map] of [
      ['en', EN_FORMS],
      ['ar', AR_FORMS],
    ] as const) {
      for (const [key, node] of map) {
        for (const [cat, value] of Object.entries(node)) {
          if (value.trim() === '') empty.push(`${lang}:${key}.${cat}`)
        }
      }
    }
    expect(empty).toEqual([])
  })

  it('gives each plural node the categories its language can actually select', () => {
    // English selects one/other and nothing else; a `few` there is a form the
    // renderer can never reach. Arabic selects all six, and a node missing
    // `zero` or `two` falls back to the 11–99 form — grammatically wrong, and
    // silently so.
    for (const [key, node] of EN_FORMS) {
      if (!isPlural(EN[key])) continue
      expect(Object.keys(node).sort(), `en ${key}`).toEqual(['one', 'other'])
    }
    for (const [key, node] of AR_FORMS) {
      if (!isPlural(AR[key])) continue
      expect(Object.keys(node).sort(), `ar ${key}`).toEqual([
        'few',
        'many',
        'one',
        'other',
        'two',
        'zero',
      ])
    }
    // The two the screen actually counts with.
    expect(isPlural(EN.memberCount)).toBe(true)
    expect(isPlural(EN.deleteInUseReason)).toBe(true)
  })

  it('uses the same interpolation tokens in both languages', () => {
    // A `{name}` renamed in one file renders as literal braces at the reader.
    const mismatched: string[] = []
    for (const [key, en] of EN_FORMS) {
      const ar = AR_FORMS.get(key)
      if (!ar) continue
      const enTokens = tokensOf(en.other)
      const arTokens = tokensOf(ar.other)
      if (enTokens.join(',') !== arTokens.join(',')) mismatched.push(key)
    }
    expect(mismatched).toEqual([])
  })

  it('fences every role name it interpolates, in BOTH trees', () => {
    // An Arabic role name in an English sentence reorders the punctuation around
    // it, and a Latin one in an Arabic sentence does the same in reverse. FSI
    // takes the direction of the value's own first strong character, so the
    // English-of-English case is untouched. bidi.test.ts gates the whole tree
    // once the namespace is merged; this is the same rule, one wave early.
    const bare: string[] = []
    for (const [lang, map] of [
      ['en', EN_FORMS],
      ['ar', AR_FORMS],
    ] as const) {
      for (const [key, node] of map) {
        for (const [cat, value] of Object.entries(node)) {
          for (const m of value.matchAll(/\{(name|permission)\}/g)) {
            const openedBefore = /[⁦-⁨]$/.test(value.slice(0, m.index))
            const closedAfter = value.startsWith('⁩', m.index + m[0].length)
            if (!openedBefore || !closedAfter) bare.push(`${lang}:${key}.${cat}`)
          }
        }
      }
    }
    expect(bare).toEqual([])
  })

  it('never leaves an isolate open', () => {
    // An unclosed FSI reorders every character after it, to the end of the
    // paragraph — the one direction failure that escapes the string it is in.
    const broken: string[] = []
    for (const [lang, map] of [
      ['en', EN_FORMS],
      ['ar', AR_FORMS],
    ] as const) {
      for (const [key, node] of map) {
        for (const value of Object.values(node)) {
          let depth = 0
          for (const ch of value) {
            if (ch >= '⁦' && ch <= '⁨') depth += 1
            else if (ch === '⁩') depth = Math.max(0, depth - 1)
          }
          if (depth !== 0) broken.push(`${lang}:${key}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('calls an administrator مشرف, never مسؤول', () => {
    // localeParity's standing rule: مسؤول is the item OWNER in fourteen
    // namespaces, and one string that borrowed it for the admin role had readers
    // assembling "ask the assignee" from a sentence about permissions.
    const owners = [...AR_FORMS].filter(([, node]) =>
      Object.values(node).some((v) => v.includes('مسؤول')),
    )
    expect(owners.map(([k]) => k)).toEqual([])
  })

  it('gives every permission a CONCRETE effect line, not a category', () => {
    // The honesty requirement as a property of the data rather than of one
    // screenshot: every key carries its own effect string, no two share one, and
    // none of them is short enough to be a category. "Manage members" is 15
    // characters and is exactly what this exists to forbid.
    const effects = PERMISSIONS.map((p) => p.effectKey)
    expect(new Set(effects).size).toBe(PERMISSIONS.length)
    for (const meta of PERMISSIONS) {
      const local = meta.effectKey.slice('roles.'.length)
      for (const [lang, map] of [
        ['en', EN_FORMS],
        ['ar', AR_FORMS],
      ] as const) {
        const node = map.get(local)
        expect(node, `${lang} ${meta.effectKey}`).toBeDefined()
        expect(node?.other.length ?? 0, `${lang} ${meta.effectKey}`).toBeGreaterThan(40)
      }
    }
  })

  it('counts holders with a plural node whose singular is really singular', () => {
    expect(EN_FORMS.get('memberCount')?.one).toBe('{count} member')
    expect(EN_FORMS.get('memberCount')?.other).toBe('{count} members')
    // Arabic pins 0, 1 and 2 rather than interpolating them: «0 أعضاء» is not a
    // sentence anybody writes.
    expect(AR_FORMS.get('memberCount')?.zero).not.toContain('{count}')
    expect(AR_FORMS.get('memberCount')?.two).not.toContain('{count}')
    expect(AR_FORMS.get('memberCount')?.many).toContain('{count}')
  })
})

/* ─────────── the same strings, once the integrator wires them up ────────── */
//
// ACTIVATES ITSELF. `src/locales/index.ts` is not this worker's file, so until
// the two imports and two spread entries land, t('roles.title') returns
// 'roles.title' and every assertion below would fail for a reason that is not a
// defect in anything this unit owns. The moment the namespace is merged, this
// block runs — and it is the block that proves the keys are reachable through
// the translator the screen actually calls, which no amount of reading the JSON
// can show.

const WIRED = t('roles.title') !== 'roles.title'

describe.skipIf(!WIRED)('every string this screen renders resolves through t()', () => {
  const KEYS = [
    ...[...EN_FORMS.keys()].map((k) => `roles.${k}`),
    ...PERMISSIONS.flatMap((p) => [p.labelKey, p.effectKey]),
  ]

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: no key falls through to its own dot path`, () => {
      setLocale(locale)
      const unresolved = KEYS.filter((k) => t(k, { count: 2, name: 'x', permission: 'y' }) === k)
      expect(unresolved).toEqual([])
      setLocale('en')
    })
  }

  it('the interpolating sentences carry exactly the tokens the screen passes', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      expect(t('roles.deleteTitle', { name: 'Director' })).toContain('Director')
      expect(t('roles.unknownPerm', { name: 'billing.manage' })).toContain('billing.manage')
      const label = t('roles.permissionLabel', { permission: 'Manage roles', name: 'Director' })
      expect(label).toContain('Manage roles')
      expect(label).toContain('Director')
      expect(label).not.toContain('{')
      const on = t('roles.granted', { permission: 'Manage roles', name: 'Director' })
      expect(on).toContain('Manage roles')
      expect(on).not.toContain('{')
    }
    setLocale('en')
  })

  it('inflects the holder count', () => {
    setLocale('en')
    expect(t('roles.memberCount', { count: 1 })).toBe('1 member')
    expect(t('roles.memberCount', { count: 7 })).toBe('7 members')
    setLocale('ar')
    expect(t('roles.memberCount', { count: 0 })).not.toContain('0')
    expect(t('roles.memberCount', { count: 2 })).not.toContain('2')
    expect(t('roles.memberCount', { count: 7 })).toContain('7')
    setLocale('en')
  })
})

/* ─────────── the stylesheet, once vitest is allowed to read one ─────────── */

// The title is NOT the bare sheet filename: `roles` is a locale root now, so
// the quoted filename is key-shaped and localeReach.test.ts would ask both
// bundles for it.
describe.skipIf(SHEET.length === 0)('the stylesheet (roles css)', () => {
  it('names no physical direction', () => {
    // The standing repo grep, pinned where it can fail on this worker's machine.
    // The permission notes are indented under their switch with an inline inset;
    // one `padding-left` and they indent off the wrong edge in Arabic.
    const physical = SHEET.match(
      /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right|float)\s*:|text-align:\s*(?:left|right)/gm,
    )
    expect(physical).toBeNull()
  })

  it('gives the permission rows a 44px target', () => {
    expect(SHEET).toContain('min-block-size: 44px')
  })
})
