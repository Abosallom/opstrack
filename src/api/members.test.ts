// The three things in api/members.ts that can be wrong without anything else
// noticing: the row→view-model boundary, the roster order, and the error-code
// map that decides which sentence an admin reads. Plus the locale wiring gate at
// the bottom, which is the only thing standing between the Members screen and a
// list of dot paths.
//
// Vitest imports are explicit on purpose: no globals config, and nothing is
// added to tsconfig.app.json's `types` array.

import { describe, expect, it } from 'vitest'
import {
  ADMIN_ERROR_KEYS,
  sortMemberAccounts,
  toMember,
  toMemberAccount,
  type AdminMemberRow,
  type Member,
  type MemberAccount,
} from './members'
import { AR_NAMESPACES, EN_NAMESPACES, ar, en, type LocaleTree } from '../locales'

function row(overrides: Partial<AdminMemberRow> = {}): AdminMemberRow {
  return {
    id: 'u1',
    email: 'ahmed.otaibi@opstrack.internal',
    display_name: 'Ahmed Al-Otaibi',
    role: 'member',
    created_at: '2026-07-01T09:00:00.000Z',
    last_sign_in_at: '2026-07-29T06:30:00.000Z',
    has_profile: true,
    username: 'ahmed.otaibi',
    claimed: true,
    invite_expires_at: null,
    is_bootstrap_admin: false,
    is_self: false,
    ...overrides,
  }
}

describe('toMember', () => {
  // The roster boundary. It carries ONE field the pre-1.0.1 read did not have,
  // and that field is what makes `@zz.smoke.v100` in quick capture resolve to a
  // person instead of filing a free-text owner (release smoke R4). A refactor
  // that quietly drops it puts the bug straight back, invisibly.
  it('carries the username through to the view model', () => {
    expect(
      toMember({
        id: 'u1',
        display_name: 'Ahmed Al-Otaibi',
        role: 'member',
        username: 'ahmed.otaibi',
      }),
    ).toEqual({
      id: 'u1',
      displayName: 'Ahmed Al-Otaibi',
      role: 'member',
      username: 'ahmed.otaibi',
    } satisfies Member)
  })

  it('normalises a handle-less or blank-handle account to null', () => {
    // `member_directory()` returns NULL for an account that signs in with a real
    // address. Null is what every consumer already reads as "no handle"; '' is a
    // value the matcher would have to special-case.
    const owner = { id: 'u2', display_name: 'Aziz', role: 'admin' }
    expect(toMember({ ...owner, username: null }).username).toBe(null)
    expect(toMember({ ...owner, username: '  ' }).username).toBe(null)
  })

  it('keeps a blank display name blank, and narrows an unknown role', () => {
    // Both are the pre-existing contract, pinned here because this function is
    // new to the test file and the behaviour must not drift with it: an unnamed
    // account is a provisioning bug the owner picker should show, and widening
    // an unrecognised role to admin is the one failure direction that matters.
    expect(toMember({ id: 'u4', display_name: null, role: 'member', username: 'zz.new' })).toEqual({
      id: 'u4',
      displayName: '',
      role: 'member',
      username: 'zz.new',
    } satisfies Member)
    const odd = { id: 'u5', display_name: 'X', role: 'superuser', username: null }
    expect(toMember(odd).role).toBe('member')
  })
})

describe('toMemberAccount', () => {
  it('maps every column to its view-model name', () => {
    expect(toMemberAccount(row())).toEqual({
      id: 'u1',
      displayName: 'Ahmed Al-Otaibi',
      role: 'member',
      email: 'ahmed.otaibi@opstrack.internal',
      username: 'ahmed.otaibi',
      claimed: true,
      createdAt: '2026-07-01T09:00:00.000Z',
      lastSignInAt: '2026-07-29T06:30:00.000Z',
      hasProfile: true,
      inviteExpiresAt: null,
      isBootstrapAdmin: false,
      isSelf: false,
    } satisfies MemberAccount)
  })

  it('falls back name → username → address, never to blank', () => {
    // The half-provisioned account — auth user present, profiles row absent — is
    // the one row on this screen that MUST be identifiable, because it is the
    // only one the admin has to act on. A blank name there is a member who
    // cannot sign in and an admin who cannot see them.
    expect(toMemberAccount(row({ display_name: null })).displayName).toBe('ahmed.otaibi')
    expect(toMemberAccount(row({ display_name: '   ' })).displayName).toBe('ahmed.otaibi')
    expect(toMemberAccount(row({ display_name: null, username: null })).displayName).toBe(
      'ahmed.otaibi@opstrack.internal',
    )
  })

  it('narrows an unknown role to member rather than trusting the wire', () => {
    // The function computes this field, so a surprise means the function
    // changed. Widening to admin on anything unrecognised would be the one
    // failure direction that matters.
    expect(toMemberAccount(row({ role: 'superuser' })).role).toBe('member')
    expect(toMemberAccount(row({ role: 'admin' })).role).toBe('admin')
  })
})

describe('sortMemberAccounts', () => {
  const account = (name: string, opts: Partial<MemberAccount> = {}): MemberAccount =>
    toMemberAccount(row({ display_name: name, username: name.toLowerCase(), ...toRow(opts) }))

  /** Only the two fields the sort actually reads. */
  function toRow(opts: Partial<MemberAccount>): Partial<AdminMemberRow> {
    return {
      ...(opts.claimed === undefined ? {} : { claimed: opts.claimed }),
      ...(opts.username === undefined ? {} : { username: opts.username }),
    }
  }

  it('hoists pending invites above everything else', () => {
    // Not cosmetic. A pending row is the only row waiting on the admin, and
    // burying one alphabetically between two claimed accounts is how somebody
    // sits unable to sign in for a week.
    const rows = [
      account('Aaron', { claimed: true }),
      account('Zainab', { claimed: false }),
      account('Basim', { claimed: true }),
    ]
    expect(sortMemberAccounts(rows).map((r) => r.displayName)).toEqual([
      'Zainab',
      'Aaron',
      'Basim',
    ])
  })

  it('never treats an email account as pending', () => {
    // `claimed` is true by definition for a real address, but guard the other
    // half too: a row with no username can never be pending whatever the flag
    // says, or the owner's own account would sort to the top forever.
    const rows = [
      account('Aaron', { claimed: true }),
      account('Owner', { claimed: false, username: null }),
    ]
    expect(sortMemberAccounts(rows).map((r) => r.displayName)).toEqual(['Aaron', 'Owner'])
  })

  it('compares names by collation, not by code point', () => {
    // `localeCompare` with sensitivity 'base' is what puts 'ahmed' next to
    // 'Ahmed' and sorts Arabic as Arabic. A raw `<` on strings puts every
    // capital letter before every lowercase one and every Arabic name after
    // both, which reads as an unsorted list.
    const rows = [account('bushra'), account('Basim'), account('أحمد')]
    expect(sortMemberAccounts(rows).map((r) => r.displayName)).toEqual([
      'Basim',
      'bushra',
      'أحمد',
    ])
  })
})

describe('ADMIN_ERROR_KEYS', () => {
  /**
   * Every token `admin-members`' AdminCode union can emit, transcribed.
   *
   * The edge function is the one file no `tsc` or lint covers (`.oxlintrc.json`
   * ignores supabase/functions; tsconfig.app.json is src-only), so nothing but
   * this list connects its error vocabulary to the browser's. A token the
   * function adds and this map does not know degrades to `common.error` —
   * survivable, and silent, which is why the list is checked rather than
   * trusted.
   */
  const EMITTED = [
    'not_signed_in',
    'forbidden',
    'invalid_body',
    'invalid_username',
    'username_taken',
    'invalid_email',
    'email_taken',
    'display_name_required',
    'not_found',
    'email_account',
    'self_delete',
    'self_demote',
    'last_admin',
    'bootstrap_admin',
    'no_pepper',
    'server_error',
    'unknown_action',
  ]

  it('covers every code the function can emit, and nothing it cannot', () => {
    expect(Object.keys(ADMIN_ERROR_KEYS).sort()).toEqual([...EMITTED].sort())
  })

  it('maps every code to a key that resolves in BOTH bundles', () => {
    // The map is the whole reason the screen can say "that username is taken"
    // instead of "something went wrong"; a key that resolves in en and not ar
    // would put an English sentence in an RTL layout, which is the exact failure
    // the key convention exists to prevent.
    const missing: string[] = []
    for (const key of Object.values(ADMIN_ERROR_KEYS)) {
      if (typeof leaf(en, key) !== 'string') missing.push(`en:${key}`)
      if (typeof leaf(ar, key) !== 'string') missing.push(`ar:${key}`)
    }
    expect(missing).toEqual([])
  })
})

/* ─────────────────── the locale wiring gate ─────────────────── */

function leaf(tree: LocaleTree, key: string): string | LocaleTree | undefined {
  let node: string | LocaleTree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === undefined) return undefined
    node = node[part]
  }
  return node
}

/**
 * `src/locales/index.ts` IS INTEGRATOR-ONLY (EXECUTION-PLAN §1.0.2), so W4-ADMIN
 * wrote `src/locales/{en,ar}/members.json` and could not wire them in. Until the
 * integrator adds the two imports, the two namespace entries and the two spread
 * entries, every string on the Members screen renders as its own dot path — and
 * NOTHING else in the repo reports it: localeParity compares the namespaces
 * index.ts knows about, and localeReach skips a key whose root is not a known
 * namespace. That is the exact failure localeReach.test.ts's header describes
 * shipping once already, on a truncated handoff note.
 *
 * The diff, verbatim (alphabetically after `meeting` in all three places):
 *
 *   import enMembers from './en/members.json'
 *   import arMembers from './ar/members.json'
 *   EN_NAMESPACES: { …, members: enMembers, … }
 *   AR_NAMESPACES: { …, members: arMembers, … }
 *   en: { …, ...enMembers, … }      ar: { …, ...arMembers, … }
 *
 * MAKE IT GREEN BY WIRING THE NAMESPACE, NEVER BY DELETING THE ASSERTION.
 */
describe('members namespace is wired into src/locales/index.ts', () => {
  it('appears in both namespace maps and both merged bundles', () => {
    expect(Object.keys(EN_NAMESPACES), 'en/members.json not wired').toContain('members')
    expect(Object.keys(AR_NAMESPACES), 'ar/members.json not wired').toContain('members')
    // The maps and the merged bundles are separate spreads in that file, and a
    // half-applied diff (maps only) leaves t() unable to resolve anything.
    expect(typeof leaf(en, 'members.subtitle')).toBe('string')
    expect(typeof leaf(ar, 'members.subtitle')).toBe('string')
  })

  it('resolves every key the Members screen asks for outside its own namespace', () => {
    // The screen deliberately borrows from four integrator-owned namespaces
    // rather than minting twins — `settings.role*` is the same word the account
    // card uses, and `date.never` is the same "Never" every timestamp falls back
    // to. Borrowing means depending, so the dependency is asserted.
    const borrowed = [
      'route.members',
      'settings.role',
      'settings.roleAdmin',
      'settings.roleMember',
      'settings.membersEmpty',
      'common.back',
      'common.cancel',
      'common.copy',
      'common.copied',
      'common.delete',
      'common.retry',
      'admin.errForbidden',
    ]
    const missing: string[] = []
    for (const key of borrowed) {
      if (typeof leaf(en, key) !== 'string') missing.push(`en:${key}`)
      if (typeof leaf(ar, key) !== 'string') missing.push(`ar:${key}`)
    }
    expect(missing).toEqual([])
  })
})
