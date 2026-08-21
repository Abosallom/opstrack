// Members admin (/settings/members) — the workspace roster, and the only place
// an account comes into existence or stops existing.
//
// THE SHAPE OF THE FLOW IS UNUSUAL AND IT IS THE POINT. Creating a member does
// not email anybody: it mints a ONE-TIME INVITE CODE that this screen shows
// exactly once, for the admin to hand over in person. The server keeps only an
// HMAC of it (see supabase/functions/admin-members), so there is deliberately no
// "show it again" — losing it means issuing a new one, and issuing a new one is
// also the password reset, because a `@opstrack.internal` address is RFC 6761
// reserved and can never receive mail. Every affordance below is arranged around
// that: the code panel is loud, it warns before it disappears, and "New code"
// sits beside every pending member rather than being buried.
//
// IT READS THROUGH THE EDGE FUNCTION, NOT THROUGH `profiles`. `username`,
// `claimed` and `last_sign_in_at` live in `auth.users`, which PostgREST cannot
// reach at all — no view, no policy, no join — so `api/members.listMembers()`
// (the app-wide read every owner picker uses) genuinely cannot answer this
// screen's questions. `listMemberAccounts()` goes to the function, which is also
// the only principal that can write. See that module's header.
//
// EVERY GUARD ON THIS PAGE EXISTS TWICE, AND THE SERVER'S COPY IS THE REAL ONE.
// No self-demotion, no self-deletion, no removing the last admin, no touching
// the bootstrap owner: `admin-members` re-derives all four from the live tables
// and answers 403 with a machine code whatever this file renders. The copies
// here are so that a control which is going to be refused arrives already
// disabled, with the reason attached — and they share the *same locale keys* as
// the server's refusals (`members.errSelfDemote` and friends), so the sentence
// on the disabled button and the sentence in the toast can never drift apart.
//
// ── WAVE B: THE ROLE IS ASSIGNED HERE, OR IT IS ASSIGNED NOWHERE ───────────
//
// Settings › Roles can invent a Director. Until this screen grew a per-row
// picker there was no way to put a person in it, so the roles screen was a
// workshop with no door: every switch on it described a role nobody could hold.
//
// THE PICKER WRITES `role_id` AND ONLY `role_id`. The legacy `profiles.role`
// text is DERIVED by 0025's `profiles_role_sync()` trigger inside the same
// statement, so the database keeps the two together and a client that wrote both
// would be guessing at a column it does not own — wrongly, for any custom role,
// since the derivation only knows the two system roles. api/members.ts's header
// argues this at length. What this file owes the invariant is the OTHER half:
// `rows[].role` here is a stale copy the edge function handed over, and after a
// successful move it is re-derived locally by the same rule the trigger uses, so
// the pill, the admin count and the delete guard on this screen cannot disagree
// with the row the database now holds.
//
// TWO ADMIN COUNTS, AND THEY ARE NOT REDUNDANT. `adminCount` counts
// `role === 'admin'`, because it guards Delete and Demote, which go to the edge
// function, which re-derives from that same legacy column. `adminHolders` counts
// people whose role GRANTS `workspace.admin`, because it guards the role picker,
// which goes to Postgres, where `assert_admin_survives()` counts exactly that.
// The day Aziz ticks workspace.admin onto Director the two answers separate, and
// each guard must keep mirroring its own server rather than the other's.
//
// ── THE POSITION: DISPLAY ONLY, AND WRITTEN HERE OR NOWHERE ────────────────
//
// `profiles.position` was read by this screen from the day the column existed
// and written by NOTHING, so all eighteen rows printed an empty string and the
// separator never appeared — a roster of eighteen usernames with no way to tell
// an Executive Director from a Developer. It is now typed in the create form and
// edited inline on the row.
//
// ⚠ IT GATES NOTHING. Not here, not anywhere, ever. It is free text a person
//   typed into a box, and the app must never infer seniority by parsing it —
//   that is what ROLES are for, and "Business Operations & Product Director
//   (Delegation)" is exactly the string a title parser would read as two ranks
//   or as none. 0025's own column comment says the same thing (0025:483). The
//   only decision this value participates in is which characters get painted
//   beside a name.
//
// AND BECAUSE IT IS FREE TEXT IT IS `bdi`-ISOLATED WHEREVER IT IS RENDERED.
// "PMO (OB related)" beside an Arabic display name drags its parentheses to the
// wrong side of the line otherwise, and the `·` before it lands after it.
//
// WHO MAY WRITE IT IS `members.manage`, WHICH IS NOT `useIsAdmin()`, and the
// difference is the whole reason the check below is computed rather than
// assumed. `guard_profile_role()` reverts the column — silently, with a 200 —
// for any writer without that key (0025:1800), so the control is offered only to
// somebody the loaded permission rows say holds it, and the write reads back
// what persisted rather than trusting its own request. Same shape as the role
// picker, same reason.
//
// THE POSITION UI IS ABSENT ENTIRELY WHEN THE `profiles` READ FAILED. On a
// project with 0025 unapplied the column does not exist, the read that would
// carry it answers 42703, and a field that wrote into a 42703 would be a form
// control that silently does nothing. `refsReady` is that read's own flag, kept
// separate from `rolesReady` because they answer different questions.
//
// THE PICKER DEGRADES TO THE OLD PAIR OF BUTTONS. Migrations 0023–0025 are
// unapplied as this ships: there is no `roles` table on the live project yet, so
// the reads that feed the picker fail, and a screen that answered that with an
// empty dropdown would have taken away the only working way to make an admin.
// When the roles read fails the row renders Make admin / Make member exactly as
// it did before, and one line says why the picker is missing.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconKey, IconShieldCheck, IconUser, IconUsers } from '../../components/icons'
import { confirm } from '../../components/Confirm'
import { EmptyState, Skeleton } from '../../components/shared'
import { toast } from '../../components/toast'
import {
  createUsernameMember,
  deleteMember,
  listMemberAccounts,
  listMemberRoleRefs,
  normalizePosition,
  reissueInvite,
  setMemberPosition,
  setMemberRole,
  setMemberRoleId,
  type Invite,
  type MemberAccount,
  type MemberRoleRef,
} from '../../api/members'
import {
  ADMIN_PERMISSION,
  adminHolderCount,
  grants,
  listRolePermissions,
  listRoles,
  type PermissionKey,
  type Role,
  type RolePermission,
} from '../../api/roles'
import { formatRelativeTime, formatTimestamp } from '../../lib/dates'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { useIsAdmin } from '../../store/auth'
import { invalidateMembers } from '../../store/members'
import type { UserRole } from '../../types'
import './members.css'

/**
 * THE ADMIN GATE ON THIS SCREEN IS `store/auth.useIsAdmin()`, which is
 * `useHasPerm('workspace.admin')` — the same question `is_admin()` asks in the
 * database since 0025. This file used to define its own four-line copy over the
 * legacy `profiles.role` column; the `?shell` preview flag it carried now lives
 * once, in `decide()` in store/auth.ts, and behaves identically.
 *
 * Cosmetic, like every gate in this app. The real authority is the
 * `admin-members` function's own JWT check — every write on this screen answers
 * 403 for a member whatever this returns, and gate (e) of the Wave-4 plan proves
 * it with curl. Hiding the screen only avoids offering an action that cannot
 * succeed.
 */

/** Mirrors USERNAME_RE in supabase/functions/admin-members/index.ts. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/

const DISPLAY_NAME_MAX = 80
const USERNAME_MAX = 32
/**
 * `profiles.position` is unbounded `text`, so this is a UI limit and not a
 * schema one. 80 is `DISPLAY_NAME_MAX`, chosen for the same reason: the longest
 * title on the real roster is "Business Operations & Product Director
 * (Delegation)" at 50 characters, and the value is printed on ONE line beside a
 * name — past this it stops being a subtitle and starts being a paragraph.
 */
const POSITION_MAX = 80

/**
 * The key that decides who may write a position — and, in the database, who may
 * move anybody else between roles.
 *
 * A local constant rather than an import because api/roles.ts exports
 * `ADMIN_PERMISSION` and no twin for this one, and that file belongs to another
 * unit this wave (§1.0.4). It is typed `PermissionKey`, so the day the union
 * loses this member the build says so here rather than silently comparing
 * against a string nothing grants.
 */
const MANAGE_PERMISSION: PermissionKey = 'members.manage'

interface FormState {
  username: string
  displayName: string
  /** Free text, DISPLAY ONLY. See the file header — it gates nothing. */
  position: string
  role: UserRole
}

const EMPTY_FORM: FormState = { username: '', displayName: '', position: '', role: 'member' }

/**
 * Copy, with an honest failure.
 *
 * `navigator.clipboard` is undefined on an insecure origin and rejects when the
 * gesture is not trusted, and both cases are silent — the admin taps, nothing
 * appears to happen, and what they hand over is whatever was in the clipboard
 * before. For a single-use credential that is worse than usual: the code is on
 * screen and about to be dismissed, so the failure has to be said out loud.
 */
async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    toast(t('common.copied'))
  } catch {
    toast(t('members.errCopy'), { tone: 'error' })
  }
}

/**
 * Is there an admin on this roster who can get back in WITHOUT another admin?
 *
 * `username === null` is exactly "signs in with a real address": the function
 * derives `username` from the sign-in address and answers null when it is not on
 * the synthetic `@opstrack.internal` domain (api/members.ts), so this is the same
 * distinction the "Signs in by email code" pill draws rather than a second guess
 * at it. Such an account can always have a sign-in code mailed to it; a username
 * account provably cannot, because the domain is RFC 6761 reserved.
 *
 * `role === 'admin'` ALREADY CARRIES THE BOOTSTRAP FLOOR. The list endpoint
 * writes 'admin' for a bootstrap address whatever its `profiles` row says, for
 * the same reason the function's own gate trusts the allow-list — so an owner
 * whose profile row is missing or wrong still counts here, and the warning
 * cannot fire on a workspace that is in fact fine. Re-deriving the floor in this
 * file would be a fourth copy of a list only the server holds.
 *
 * Exported for its test, the `toMemberAccount` convention: the claim it encodes
 * is a security property of the workspace, and it is one `&&` away from being
 * silently inverted.
 */
export function hasEmailRecoverableAdmin(rows: readonly MemberAccount[]): boolean {
  return rows.some((row) => row.role === 'admin' && row.username === null)
}

/**
 * A role's name in the given locale, with `roleLabelIn`'s rule from RolesAdmin:
 * `name_ar` is `not null default ''`, so the test is for EMPTY and never for
 * null, and a role nobody has translated shows its English name rather than a
 * blank option in a dropdown — which is the one place a blank label is
 * indistinguishable from a bug.
 *
 * The second copy of a three-line function, and deliberately so: §1.0.4 forbids
 * reaching into RolesAdmin.tsx to export it, and the shared home would be
 * `src/lib/`, which may not import `api/`. Flagged in the handoff with the
 * `useIsAdmin` family.
 */
function roleLabelIn(role: Role, locale: Locale): string {
  if (locale === 'ar') return role.name_ar.trim() || role.name
  return role.name
}

/**
 * Everything the role picker's guards need about ONE possible move, and nothing
 * about how it is rendered.
 *
 * Pure, exported, and tested: this is the client's copy of two server rules that
 * live in different places (the edge function's `bootstrap_admin` floor, and
 * 0025's `assert_admin_survives()` statement trigger), and a copy is exactly the
 * thing that drifts.
 */
export interface RoleMoveGuardInput {
  /** The signed-in admin's own row. */
  readonly isSelf: boolean
  /** On the function's allow-list: always an admin, whatever `profiles` says. */
  readonly isBootstrapAdmin: boolean
  /** False when the `profiles` row is missing — there is nothing to update. */
  readonly hasProfile: boolean
  /** Does the role they hold NOW grant `workspace.admin`? */
  readonly fromGrantsAdmin: boolean
  /** Would the role they are being moved INTO grant it? */
  readonly toGrantsAdmin: boolean
  /** How many people currently resolve to a role granting it. */
  readonly adminHolders: number
}

/**
 * Why this move is refused, as the locale key of the sentence to print — or null
 * when it is allowed.
 *
 * THE ORDER IS THE ORDER OF BLAME, most specific first, because only one
 * sentence gets printed. Your own row and the workspace owner's are refused for
 * reasons that stay true no matter how many other admins exist, so they are
 * decided before the count is consulted.
 *
 * Every branch turns on LOSING `workspace.admin`, never on the identity of the
 * role: moving the owner from Admin to Director is refused, and moving them from
 * Director to an equally-admin Executive role is not. That is the same shape
 * `revokeWouldOrphanWorkspace()` has in api/roles.ts, and it is what lets a
 * workspace reorganise its roles without a screen inventing a rule the database
 * does not have.
 */
export function roleMoveBlockKey(input: RoleMoveGuardInput): string | null {
  // There is no row to write. The update would match zero rows and answer
  // `errNotFound`, which reads as "this account is gone" — it is not; it is
  // half-provisioned, and the pill beside the name already says which.
  if (!input.hasProfile) return 'members.errNoProfileRow'
  if (!input.fromGrantsAdmin || input.toGrantsAdmin) return null
  // 0025 GUARD 2 (a) reverts a self-escalation silently; a self-DEMOTION it
  // allows outright. The refusal here is this screen's, and it is the same one
  // the demote button has always carried: an admin who removes their own last
  // admin screen cannot put it back.
  if (input.isSelf) return 'members.errSelfDemote'
  // The edge function pins the bootstrap address as an admin whatever `profiles`
  // holds, so a role_id that said otherwise would put the two answers in
  // permanent disagreement — the roster would show Admin and `is_admin()` would
  // say no.
  if (input.isBootstrapAdmin) return 'members.errBootstrapAdmin'
  // 0025 GUARD 1, mirrored: `assert_admin_survives()` refuses the TRANSITION to
  // zero. `<= 1` and not `=== 1` so a count that is somehow already zero cannot
  // wrap around into permission.
  if (input.adminHolders <= 1) return 'members.errLastAdminMove'
  return null
}

export default function Members(): ReactElement {
  const locale = useLocale()
  const isAdmin = useIsAdmin()

  const [rows, setRows] = useState<MemberAccount[] | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitted, setSubmitted] = useState(false)
  const [creating, setCreating] = useState(false)
  /**
   * The code being shown. Held in state and nowhere else — never written to
   * localStorage, never put in the URL, never logged. It leaves this component
   * when the admin dismisses the panel and cannot be recovered after that, which
   * is the same guarantee the server makes.
   */
  const [invite, setInvite] = useState<Invite | null>(null)

  /**
   * The roles half of the screen. THREE PIECES THAT ARE ONLY MEANINGFUL
   * TOGETHER, so they land together or not at all: the roles are the options,
   * the grants say which of them carry `workspace.admin`, and the refs say who
   * holds what. With any one missing the picker would either render no options
   * or compute an admin count of zero and refuse every move — a guard that
   * cannot be satisfied is worse than a control that is not there.
   */
  const [roles, setRoles] = useState<Role[]>([])
  const [perms, setPerms] = useState<RolePermission[]>([])
  const [refs, setRefs] = useState<ReadonlyMap<string, MemberRoleRef>>(new Map())
  /** True once all three landed. False on a project with 0025 unapplied. */
  const [rolesReady, setRolesReady] = useState(false)
  /**
   * Did the `profiles` read — the one carrying `position` — come back at all?
   *
   * SEPARATE FROM `rolesReady`, which requires this AND two more reads AND a
   * non-empty roles table. The questions are different: `rolesReady` asks "is
   * there a list of roles to pick from", and this asks "does the `position`
   * column exist on this database". On a project with 0025 unapplied both are
   * false; they are not the same false, and a position field gated on the wrong
   * one would be a control whose absence nobody could explain.
   */
  const [refsReady, setRefsReady] = useState(false)
  /** The account whose role_id is in flight, so its picker can go disabled. */
  const [movingId, setMovingId] = useState<string | null>(null)
  /**
   * The ONE row whose position is being edited, and the draft in its box.
   *
   * One at a time, deliberately. Eighteen simultaneous drafts is eighteen ways
   * to lose an unsaved edit to a background refresh, and the roster is read far
   * more often than it is retitled — the row that is being edited is an
   * exception on this screen, not the normal state of a row.
   */
  const [editingPosition, setEditingPosition] = useState<{ id: string; value: string } | null>(null)
  /** The account whose position is in flight, so its box can go disabled. */
  const [savingPositionId, setSavingPositionId] = useState<string | null>(null)
  /** Announced after a role move — see the live region at the foot of the page. */
  const [liveMessage, setLiveMessage] = useState('')

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The code panel takes focus when it appears. Without this a screen-reader
  // user is told nothing about the one string on the page that cannot be
  // recovered — and a sighted admin can miss it too, because it renders above
  // the button they just pressed.
  const invitePanel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (invite) invitePanel.current?.focus()
  }, [invite])

  const load = useCallback(async () => {
    setErrorKey(null)
    // Four reads in parallel, none depending on another. The roster is the one
    // that can fail the screen; the three role reads fail SOFT, because they are
    // the only ones that need a migration this project has not applied yet.
    const [result, roleResult, permResult, refResult] = await Promise.all([
      listMemberAccounts(),
      listRoles(),
      listRolePermissions(),
      listMemberRoleRefs(),
    ])
    if (!alive.current) return

    // All three or none: see the state declaration. A partial answer would put
    // a picker on screen whose last-admin guard was computed from half the data,
    // which is the one failure mode worse than no picker.
    const ready = roleResult.ok && permResult.ok && refResult.ok
    setRolesReady(ready && roleResult.data.length > 0)
    // Narrower, and on purpose: this is the one read that names `position`, so
    // it alone answers whether the column is there to be written.
    setRefsReady(refResult.ok)
    setRoles(roleResult.ok ? roleResult.data : [])
    setPerms(permResult.ok ? permResult.data : [])
    setRefs(refResult.ok ? new Map(refResult.data.map((ref) => [ref.id, ref])) : new Map())

    if (!result.ok) {
      setErrorKey(result.error)
      setRows([])
      return
    }
    setRows(result.data)
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  // ---- create -------------------------------------------------------------

  const username = form.username.trim().toLowerCase()
  const usernameErr = !username
    ? 'members.errUsernameRequired'
    : !USERNAME_RE.test(username)
      ? 'members.errUsernameInvalid'
      : null

  async function create(): Promise<void> {
    setSubmitted(true)
    if (usernameErr) return
    setCreating(true)
    const result = await createUsernameMember(username, form.displayName, form.role)
    if (!alive.current) return
    setCreating(false)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    // Panel first, list second. The code is the only irrecoverable thing on the
    // screen, so it goes up before anything else can push it around, and the
    // form closes so a double-tap cannot mint a second account.
    setInvite(result.data.invite)
    const position = normalizePosition(form.position)
    setForm(EMPTY_FORM)
    setSubmitted(false)
    setFormOpen(false)

    // ── the position, as a SECOND write, and it has to be ──────────────────
    //
    // `admin-members` mints the auth user and the `profiles` row with the
    // service role, and its `create` action's body has three fields — username,
    // displayName, role. It does not carry a position and cannot be taught one
    // from here (supabase/functions/ is outside this unit). So the title lands
    // as an ordinary `profiles` UPDATE the moment the row exists, which it does:
    // the function inserts the profiles row inside the same request that answers
    // with this id.
    //
    // NON-FATAL BY CONSTRUCTION. The account is already created and the code is
    // already on screen; a failure here means one empty column on a row that is
    // otherwise fine, and the fix is the inline edit on that row. Saying that in
    // words beats a red toast that reads as "the member was not created".
    if (position) {
      const posResult = await setMemberPosition(result.data.member.id, position)
      if (!alive.current) return
      if (!posResult.ok || posResult.data.position !== position) {
        toast(t('members.errPositionNotSaved'), { tone: 'error' })
      }
    }

    invalidateMembers()
    void load()
  }

  // ---- roles: who holds what, and who can administer ----------------------

  const roleLabel = useCallback((role: Role) => roleLabelIn(role, locale), [locale])

  /**
   * Focus the position box the moment it mounts — which is inside the tap that
   * opened it, so iOS raises the keyboard (R2-MOBILE-6's rule: a focus deferred
   * to an effect on that platform gets a caret and no keyboard).
   *
   * A `useCallback` ref rather than `autoFocus` or an inline arrow. An inline
   * callback ref is a new function every render, so React detaches and
   * reattaches it — and calls `.focus()` again — on every keystroke. Stable
   * identity means mount only, which is the whole intent.
   */
  const focusOnMount = useCallback((el: HTMLInputElement | null) => {
    el?.focus()
  }, [])

  /**
   * The system `admin` role's id — the ONE id `profiles_role_sync()` derives the
   * legacy text against (`role = 'admin' ⟺ role_id = the system admin role`,
   * 0025:90). Not "a role granting workspace.admin": the migration chose the
   * narrower reading deliberately, and mirroring the wider one here would make
   * this screen's pill disagree with the column it is mirroring.
   */
  const systemAdminRoleId = useMemo(
    () => roles.find((role) => role.key === 'admin')?.id ?? null,
    [roles],
  )
  const systemMemberRoleId = useMemo(
    () => roles.find((role) => role.key === 'member')?.id ?? null,
    [roles],
  )

  /** The roles that grant `workspace.admin`. Usually one; never assumed to be. */
  const adminRoleIds = useMemo(
    () =>
      new Set(
        roles.filter((role) => grants(perms, role.id, ADMIN_PERMISSION)).map((role) => role.id),
      ),
    [roles, perms],
  )

  /**
   * `has_perm()`'s `coalesce` (0025:400) in TypeScript: the role_id on the row,
   * or the system role the legacy text names. The two answers disagreeing is the
   * whole class of bug the guards below exist to prevent.
   */
  const effectiveRoleId = useCallback(
    (row: MemberAccount): string | null => {
      const ref = refs.get(row.id)
      if (ref?.roleId) return ref.roleId
      // The `profiles` copy first, the edge function's second: the edge copy
      // carries the bootstrap floor and is therefore 'admin' for the owner even
      // when the profiles row says otherwise, which is right for the DELETE
      // guard and wrong for a question about role_id.
      return (ref?.role ?? row.role) === 'admin' ? systemAdminRoleId : systemMemberRoleId
    },
    [refs, systemAdminRoleId, systemMemberRoleId],
  )

  /**
   * `admin_holder_count()` (0025:609), computed from the `profiles` read rather
   * than from the roster — because that function counts `profiles` rows, and the
   * roster is `auth.users` with a bootstrap floor painted on. Counting the
   * roster would answer 1 for a workspace whose owner has no profiles row, which
   * is exactly the workspace where the guard has to say no.
   */
  const adminHolders = useMemo(
    () =>
      adminHolderCount(
        [...refs.values()].map((ref) => ({ role: ref.role, role_id: ref.roleId })),
        roles,
        perms,
      ),
    [refs, roles, perms],
  )

  /**
   * Does the signed-in admin hold `members.manage` — the key the position write
   * actually answers to?
   *
   * NOT `useIsAdmin()`, and that gap is the point. The hook reads
   * `profile.role`, the legacy text column, which 0025 keeps derived from the
   * two SYSTEM roles only; a custom role carrying `members.manage` without
   * `workspace.admin` is invisible to it. `guard_profile_role()` asks the other
   * question (0025:1800), so this asks the other question too.
   *
   * DERIVED FROM THE THREE READS THIS SCREEN ALREADY HAS rather than from a
   * fourth one: `rows` says which row is mine (`isSelf`, the server's own
   * answer), `effectiveRoleId` resolves it through the same `coalesce` as
   * `has_perm()`, and `perms` says what that role grants. A separate probe would
   * be a second answer to a question this screen has already asked, free to
   * disagree with the guards computed beside it.
   *
   * COSMETIC, like everything else on this screen. False here hides a control;
   * it does not protect the column. The trigger does, by reverting.
   */
  const canWritePosition = useMemo(() => {
    if (!refsReady) return false
    const me = (rows ?? []).find((row) => row.isSelf)
    if (!me) return false
    const roleId = effectiveRoleId(me)
    return roleId !== null && grants(perms, roleId, MANAGE_PERMISSION)
  }, [refsReady, rows, effectiveRoleId, perms])

  /**
   * `profiles_role_sync()`'s derivation, applied locally so the pill, the admin
   * count and the Delete guard settle on the same answer the trigger just wrote
   * — without a second round trip to read back a column whose rule is four
   * words long.
   *
   * The bootstrap owner is EXEMPT because the edge function overrides this
   * column for them on every read: deriving 'member' for the owner would make
   * the roster contradict its own next refresh.
   */
  const derivedLegacyRole = useCallback(
    (row: MemberAccount, roleId: string | null): UserRole => {
      if (row.isBootstrapAdmin) return row.role
      return roleId !== null && roleId === systemAdminRoleId ? 'admin' : 'member'
    },
    [systemAdminRoleId],
  )

  // ---- reissue / delete / role -------------------------------------------

  async function reissue(row: MemberAccount): Promise<void> {
    const ok = await confirm({
      title: t('members.reissueTitle'),
      body: t('members.reissueBody', { name: row.displayName }),
      confirmLabel: t('members.reissue'),
      cancelLabel: t('common.cancel'),
    })
    if (!ok || !alive.current) return
    setBusyId(row.id)
    const result = await reissueInvite(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setInvite(result.data)
    toast(t('members.reissued'))
    void load()
  }

  async function remove(row: MemberAccount): Promise<void> {
    const ok = await confirm({
      title: t('members.deleteTitle'),
      body: t('members.deleteBody', { name: row.displayName }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    setBusyId(row.id)
    const result = await deleteMember(row.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setRows((current) => (current ? current.filter((r) => r.id !== row.id) : current))
    invalidateMembers()
    toast(t('members.deleted'))
  }

  async function changeRole(row: MemberAccount, role: UserRole): Promise<void> {
    const promoting = role === 'admin'
    const ok = await confirm({
      title: t(promoting ? 'members.promoteTitle' : 'members.demoteTitle'),
      body: t(promoting ? 'members.promoteBody' : 'members.demoteBody', { name: row.displayName }),
      confirmLabel: t(promoting ? 'members.promote' : 'members.demote'),
      cancelLabel: t('common.cancel'),
      // Demotion is not destructive — the account and its work survive — but it
      // is the one action on this screen that can strip somebody's access while
      // they are using it, so it gets the red confirm.
      danger: !promoting,
    })
    if (!ok || !alive.current) return
    setBusyId(row.id)
    const result = await setMemberRole(row.id, role)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setRows((current) => (current ? current.map((r) => (r.id === row.id ? { ...r, role } : r)) : current))
    invalidateMembers()
    toast(t('members.roleChanged'))
  }

  /**
   * Put one person in one role — GroupsAdmin's OPTIMISTIC-SELECT-WITH-EXPLICIT-
   * ROLLBACK idiom, with one addition that idiom did not need.
   *
   * THE ADDITION IS THAT SUCCESS IS NOT THE SAME AS "IT MOVED". `setTrackGroup`
   * either writes or errors; `role_id` has a third outcome, because 0025's GUARD
   * 2 refuses a self-escalation by REVERTING the value rather than raising
   * (0025:855, and it reverts by design — RLS is row-level, so a raise would
   * turn a member's ordinary `locale` save into a hard error). The answer is a
   * 200 whose row did not move. So the settle below takes the PERSISTED row, and
   * a persisted role that is not the requested one is reported as the refusal it
   * is instead of being painted over the picker as a success.
   *
   * TWO PIECES OF STATE MOVE TOGETHER, and that is this screen's half of the
   * "both must move together" rule: `refs` holds role_id, `rows[].role` holds
   * the legacy text the rest of the screen reads. The database keeps them in
   * step with a trigger; here they are kept in step by hand, in every one of the
   * three exits — optimistic, rollback, settle.
   */
  async function moveRole(row: MemberAccount, roleId: string): Promise<void> {
    const previousRef = refs.get(row.id) ?? null
    const previousLegacy = row.role
    const from = effectiveRoleId(row)
    // '' is the placeholder option for a role this screen did not load; picking
    // the role somebody already holds is not a change.
    if (roleId === '' || roleId === from) return
    const target = roles.find((role) => role.id === roleId)
    if (!target) return

    // The option that would do this is already rendered disabled. This is the
    // second copy, not the first: `disabled` on an <option> is honoured by every
    // browser but not by every assistive or automation path, and the counts it
    // was computed from can go stale between the paint and the tap.
    const block = roleMoveBlockKey({
      isSelf: row.isSelf,
      isBootstrapAdmin: row.isBootstrapAdmin,
      hasProfile: row.hasProfile,
      fromGrantsAdmin: from !== null && adminRoleIds.has(from),
      toGrantsAdmin: adminRoleIds.has(roleId),
      adminHolders,
    })
    if (block) {
      toast(t(block), { tone: 'error' })
      setLiveMessage(t(block))
      return
    }

    /** Both halves, in one call, so no exit can move one and forget the other. */
    const apply = (ref: MemberRoleRef | null, legacy: UserRole): void => {
      setRefs((current) => {
        const next = new Map(current)
        if (ref) next.set(row.id, ref)
        else next.delete(row.id)
        return next
      })
      setRows((current) =>
        current ? current.map((r) => (r.id === row.id ? { ...r, role: legacy } : r)) : current,
      )
    }

    // Optimistic: the select IS the interaction, and a control that waits for a
    // round trip before showing the value the admin picked reads as broken.
    apply(
      previousRef
        ? { ...previousRef, roleId }
        : { id: row.id, role: previousLegacy, roleId, position: '' },
      derivedLegacyRole(row, roleId),
    )
    setMovingId(row.id)
    const result = await setMemberRoleId(row.id, roleId)
    if (!alive.current) return
    setMovingId(null)

    if (!result.ok) {
      // Put this row back rather than re-reading: the previous value is known
      // exactly, and a re-read would also discard any OTHER row moved while this
      // request was in flight.
      apply(previousRef, previousLegacy)
      toast(t(result.error), { tone: 'error' })
      return
    }

    apply(result.data, derivedLegacyRole(row, result.data.roleId))
    if (result.data.roleId !== roleId) {
      // The 200 that did nothing. Said out loud, because the picker has already
      // animated back to where it started and silence would read as a bug.
      const refused = t('members.errRoleReverted')
      setLiveMessage(refused)
      toast(refused, { tone: 'error' })
      return
    }

    invalidateMembers()
    // Announced AND toasted, for GroupsAdmin's reason: the change is one word
    // inside a dropdown that has already closed, which is invisible to a screen
    // reader and easy to miss on a phone.
    const message = t('members.roleMoved', {
      name: row.displayName,
      role: roleLabel(target),
    })
    setLiveMessage(message)
    toast(message)
  }

  /**
   * Save one person's job title — `moveRole`'s idiom above, minus one half.
   *
   * OPTIMISTIC, THEN ROLLBACK, THEN SETTLE ON WHAT PERSISTED, for the three
   * reasons that function gives. The difference is that only ONE piece of state
   * moves here: `position` lives in `refs` and nowhere else, while `role_id` had
   * a legacy text twin in `rows[]` that had to move with it. So there is no
   * paired `apply()` — there is nothing to pair it with.
   *
   * THE SETTLE IS NOT OPTIONAL, and it is the same trap. `guard_profile_role()`
   * refuses a writer without `members.manage` by REVERTING the column rather
   * than raising (0025:1800) — a 200 whose row did not move — so `ok: true` here
   * means the statement ran, not that the title changed. `canWritePosition`
   * above is a mirror of that rule and mirrors go stale: the role behind it can
   * be edited on another screen while this one is open.
   */
  async function savePosition(row: MemberAccount, draft: string): Promise<void> {
    const previousRef = refs.get(row.id) ?? null
    // The api's own normalisation, so "did it move?" and "what was sent?" are
    // asked of the same string. Comparing the raw draft would report a refusal
    // for a trailing space.
    const next = normalizePosition(draft)
    if (next === (previousRef?.position ?? '')) {
      // Not a write, and not an error either — the admin opened the box and
      // changed nothing, or trimmed a space back out of it.
      setEditingPosition(null)
      return
    }

    /** One piece of state, one place. Kept a named function anyway so the three
     *  exits below read as the same operation rather than three map splices. */
    const apply = (ref: MemberRoleRef | null): void => {
      setRefs((current) => {
        const nextRefs = new Map(current)
        if (ref) nextRefs.set(row.id, ref)
        else nextRefs.delete(row.id)
        return nextRefs
      })
    }

    apply(
      previousRef
        ? { ...previousRef, position: next }
        : // Unreachable while the button is gated on `hasProfile` and `refsReady`
          // — and written anyway, because a synthetic ref is one object and a
          // crash on a stale roster is a screen.
          { id: row.id, role: row.role, roleId: null, position: next },
    )
    setSavingPositionId(row.id)
    const result = await setMemberPosition(row.id, next)
    if (!alive.current) return
    setSavingPositionId(null)

    if (!result.ok) {
      // The previous value is known exactly, so put THIS row back rather than
      // re-reading — a refresh would also discard any other row edited while
      // this request was in flight.
      apply(previousRef)
      toast(t(result.error), { tone: 'error' })
      return
    }

    apply(result.data)
    if (result.data.position !== next) {
      // The 200 that did nothing. The box stays open holding what the admin
      // typed, so the sentence has something to be about.
      const refused = t('members.errPositionReverted')
      setLiveMessage(refused)
      toast(refused, { tone: 'error' })
      return
    }

    setEditingPosition(null)
    // NO `invalidateMembers()`, deliberately. That store is fed by
    // `listMembers()` → `member_directory()`, which answers four columns and
    // none of them is `position` — every owner picker in the app would refetch
    // an identical answer. The role picker invalidates because it moves `role`,
    // which that read does carry.
    const message = t('members.positionSaved', { name: row.displayName })
    setLiveMessage(message)
    toast(message)
  }

  if (!isAdmin) return <Navigate to="/settings" replace />

  const loading = rows === null
  // The floor the last-admin guards read. Counted from the rendered list rather
  // than assumed, so a screen left open while a second admin was demoted in
  // another tab re-locks its own controls on the next load instead of offering
  // an action the server will refuse.
  const adminCount = (rows ?? []).filter((row) => row.role === 'admin').length
  // Computed from the RENDERED list rather than from a separate probe, exactly
  // like adminCount above: one read, one truth, and a screen left open while the
  // last email-recoverable admin was removed elsewhere re-answers on its next
  // load. Guarded on a loaded, non-empty, non-failed list so that "we have not
  // looked yet" and "the look failed" never render as "you are locked out".
  const noEmailRecoverableAdmin =
    rows !== null && errorKey === null && rows.length > 0 && !hasEmailRecoverableAdmin(rows)
  const now = new Date()

  return (
    <div className="mem-page">
      <div className="mem-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header already renders route.members as the
          document's h1 for this route, and a second copy of the same word is
          noise in the heading outline. */}
      <p className="mem-intro">{t('members.subtitle')}</p>

      {invite && (
        // ── the one-time code ────────────────────────────────────────────────
        //
        // A region rather than a dialog, deliberately. A modal would trap focus
        // and invite an Esc keypress, and Esc on the one string that cannot be
        // recovered is the wrong default: dismissing has to be a decision, which
        // is what the button below says in words.
        <div
          className="card mem-invite"
          ref={invitePanel}
          tabIndex={-1}
          role="group"
          aria-labelledby="mem-invite-title"
        >
          <div className="mem-invite-head">
            <span className="mem-invite-icon" aria-hidden="true">
              <IconKey size={18} />
            </span>
            <div>
              <h2 className="mem-invite-title" id="mem-invite-title">
                {t('members.inviteTitle')}
              </h2>
              {/* bdi, not dir="ltr": the username is Latin inside a sentence
                  whose direction belongs to the paragraph. `dir` on the element
                  would re-align the whole line in Arabic. */}
              <p className="mem-invite-for">
                {t('members.inviteFor', { username: invite.username })}
              </p>
            </div>
          </div>

          <p className="mem-code">
            {/* The code is DATA, so it never goes through t(). bdi isolates it
                so the hyphen between its two Latin halves cannot be reordered
                by an Arabic paragraph. */}
            <bdi>{invite.code}</bdi>
          </p>

          <p className="mem-invite-expiry">
            {t('members.inviteExpires', { date: formatTimestamp(invite.expiresAt, locale) })}
          </p>

          {/* role="alert" so it is announced the moment the panel mounts: this
              sentence is the reason the panel is loud, and a member who never
              hears it loses the code. */}
          <p className="mem-invite-warn" role="alert">
            {t('members.inviteWarning')}
          </p>

          <div className="mem-invite-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void copyCode(invite.code)}
            >
              {t('common.copy')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setInvite(null)}>
              {t('members.inviteDone')}
            </button>
          </div>
        </div>
      )}

      {noEmailRecoverableAdmin && (
        // ── the lockout with no route out ───────────────────────────────────
        //
        // Every guard on this screen protects the ADMIN SET from shrinking to
        // zero: no self-demote, no demoting or deleting the last admin, no
        // touching the bootstrap owner. None of them protects against
        // FORGETTING, and that is a different failure with a different shape.
        //
        // An admin who signs in with a real address always has a way back
        // without anyone's help — a sign-in code goes to a mailbox that exists.
        // An admin who signs in with a USERNAME does not: the account's address
        // is `@opstrack.internal`, RFC 6761 reserved and unable to receive mail
        // by construction, so the only reset is another admin pressing "New
        // code" on their row. When every admin in the workspace is a username
        // account, that "another admin" is the person who is locked out, and
        // there is no move left inside the app.
        //
        // This does NOT fire today on the live project: the function's
        // bootstrap floor pins az.alsaloom@gmail.com as an admin whatever the
        // profiles row says, and that is a real address, so the row is here and
        // the count is 1. It fires on a workspace where that account was
        // removed from outside the app, or on any deployment whose bootstrap
        // address was never created. Both are reachable; neither is reversible
        // from this screen. RUNBOOK §3.1 is the break-glass.
        //
        // role="status", not "alert": the condition is a standing property of
        // the workspace that arrives with an async read, not something that
        // just went wrong in response to a press.
        <div className="card mem-error" role="status">
          <p>{t('admin.recovery.noEmailAdmin')}</p>
        </div>
      )}

      <div className="mem-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          aria-expanded={formOpen}
          onClick={() => {
            setFormOpen((open) => !open)
            setSubmitted(false)
          }}
        >
          {t('members.add')}
        </button>
      </div>

      {formOpen && (
        <form
          className="card mem-form"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <h2 className="mem-form-title">{t('members.addTitle')}</h2>
          <p className="mem-form-hint">{t('members.addHint')}</p>

          <div className="field">
            <label className="field-label" htmlFor="mem-username">
              {t('members.username')}
            </label>
            <input
              id="mem-username"
              className="input"
              value={form.username}
              placeholder={t('members.usernamePlaceholder')}
              maxLength={USERNAME_MAX}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              // A username is always Latin lowercase, so the field is pinned LTR
              // even in Arabic — otherwise the caret starts on the wrong side of
              // an input that can only ever hold `ahmed.otaibi`.
              dir="ltr"
              aria-invalid={submitted && usernameErr ? true : undefined}
              aria-describedby={
                submitted && usernameErr ? 'mem-username-err' : 'mem-username-hint'
              }
              onChange={(e) => setForm((c) => ({ ...c, username: e.target.value }))}
            />
            {submitted && usernameErr ? (
              <p className="field-error" id="mem-username-err">
                {t(usernameErr)}
              </p>
            ) : (
              <p className="mem-field-hint" id="mem-username-hint">
                {t('members.usernameHint')}
              </p>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="mem-display">
              {t('members.displayName')}
            </label>
            <input
              id="mem-display"
              className="input"
              value={form.displayName}
              placeholder={t('members.displayNamePlaceholder')}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="off"
              aria-describedby="mem-display-hint"
              onChange={(e) => setForm((c) => ({ ...c, displayName: e.target.value }))}
            />
            <p className="mem-field-hint" id="mem-display-hint">
              {t('members.displayNameHint')}
            </p>
          </div>

          {/* THE POSITION, AT THE MOMENT THE PERSON IS ADDED. Eighteen people
              arrive in one sitting and going back over eighteen rows afterwards
              to say which of them is a director is the reason the column sat
              empty in the first place.

              ONLY WHEN IT CAN ACTUALLY BE WRITTEN. `canWritePosition` is false
              on a database without the column (0025 unapplied) and false for an
              admin whose role does not grant `members.manage` — in both cases
              the write would be accepted and discarded, and a form field that
              silently does nothing is worse than a field that is not there.

              NO `dir` OF ITS OWN, unlike the username above. A title is prose in
              whichever language the workspace speaks — "Raqeeb Clinical Expert"
              or "مدير تنفيذي" — so it takes the page's direction, and the `bdi`
              on the roster is what keeps the two from fighting when they meet. */}
          {canWritePosition && (
            <div className="field">
              <label className="field-label" htmlFor="mem-position">
                {t('members.position')}
              </label>
              <input
                id="mem-position"
                className="input"
                value={form.position}
                placeholder={t('members.positionPlaceholder')}
                maxLength={POSITION_MAX}
                autoComplete="off"
                aria-describedby="mem-position-hint"
                onChange={(e) => setForm((c) => ({ ...c, position: e.target.value }))}
              />
              <p className="mem-field-hint" id="mem-position-hint">
                {t('members.positionHint')}
              </p>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="mem-role">
              {t('settings.role')}
            </label>
            <select
              id="mem-role"
              className="select"
              value={form.role}
              onChange={(e) =>
                setForm((c) => ({ ...c, role: e.target.value === 'admin' ? 'admin' : 'member' }))
              }
            >
              <option value="member">{t('settings.roleMember')}</option>
              <option value="admin">{t('settings.roleAdmin')}</option>
            </select>
          </div>

          <div className="mem-form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setFormOpen(false)
                setForm(EMPTY_FORM)
                setSubmitted(false)
              }}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? t('members.creating') : t('members.create')}
            </button>
          </div>
        </form>
      )}

      {loading && <Skeleton height={84} count={3} />}

      {!loading && errorKey && (
        <div className="card mem-error" role="alert">
          {/* pgErrorKey's catch-all says less than the headline for this screen
              does; anything more specific (a 403, say) is worth showing. */}
          <p>{t(errorKey === 'common.error' ? 'members.loadFailed' : errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !errorKey && rows.length === 0 && (
        <EmptyState icon={<IconUsers size={30} />} title={t('settings.membersEmpty')} />
      )}

      {!loading && !errorKey && rows.length > 0 && (
        // ── where the reset lives ───────────────────────────────────────────
        //
        // The reissue path has existed since Wave 4 and was findable only by
        // pressing a button labelled "New code" and reading the confirm dialog
        // that came back. Nobody helping a colleague who has forgotten a
        // password scans a roster for "New code" — so the one recovery route
        // three of this workspace's four accounts have was, in practice,
        // invisible. This says it at rest, directly above the rows it is about,
        // rather than after a press.
        //
        // ABOVE THE LIST, NOT ABOVE "Add member": the sentence is about a row,
        // so it sits with the rows, and the screen's primary action keeps the
        // top of the page.
        //
        // The button's label is INTERPOLATED, never quoted. Settings ›
        // Terminology can rename any label at runtime (lib/i18n's override
        // layer), so a copy of the word here would be wrong for exactly the
        // workspace that had renamed it — and the override is free text, which
        // is why the token is fenced in both trees.
        //
        // THE CLASSES ARE BORROWED FROM THIS SHEET'S OWN VOCABULARY, not minted:
        // `.mem-form` is a plain 12px column stack and `.mem-invite-warn` is
        // 13px body text at full contrast, and neither carries anything specific
        // to the form or the code panel. members.css sits outside this unit's
        // file ownership, so a `.mem-note*` of its own is a follow-up rather
        // than a thing to reach across for — see the handoff note.
        <div className="card card-tight mem-form">
          <h2 className="mem-form-title">{t('admin.recovery.title')}</h2>
          <p className="mem-invite-warn">
            {t('admin.recovery.username', { action: t('members.reissue') })}
          </p>
          <p className="mem-invite-warn">{t('admin.recovery.usernameKeepsWorking')}</p>
          <p className="mem-invite-warn">{t('admin.recovery.email')}</p>
          {/* The one thing on this screen that is about the reader rather than
              about a row, and it is here because there is nowhere else: there is
              no change-password screen in this app, and `reissue-code` is the
              only endpoint with no self-check (only set-role and delete refuse
              to act on the caller). So an admin CAN reset themselves from their
              own row — while they are still signed in, which is the whole
              qualifier and why it is said in the same breath. */}
          <p className="mem-invite-warn">
            {t('admin.recovery.self', { action: t('members.reissue') })}
          </p>
          {/* Said where the roster is, not as a toast, because it is a standing
              property of the project rather than a thing that just failed: the
              roles tables arrive with migration 0025, and until it is applied
              every row here offers the two words the legacy column knows. An
              admin who has read the roles screen and comes here looking for
              Director needs to be told which of the two screens is waiting. */}
          {!rolesReady && <p className="mem-invite-warn">{t('members.rolesUnavailable')}</p>}
        </div>
      )}

      {!loading && !errorKey && rows.length > 0 && (
        <ul className="mem-list" aria-label={t('route.members')}>
          {rows.map((row) => {
            const busy = busyId === row.id
            // The LEGACY flag, and it stays legacy on purpose: it is the input
            // to Demote and Delete, which go to the edge function, which reads
            // that same text column. `grantsAdmin` below is the other question.
            const isAdminRow = row.role === 'admin'
            // A username account that has never run the claim flow. An email
            // account is claimed by definition, so this never lights for the
            // owner's own row.
            const pending = Boolean(row.username) && !row.claimed
            const expired =
              pending &&
              row.inviteExpiresAt !== null &&
              new Date(row.inviteExpiresAt).getTime() < now.getTime()
            // Also true when no invite is outstanding at all: a pending account
            // whose code was never issued needs the same nudge as one whose code
            // has died.
            const needsCode = pending && (expired || row.inviteExpiresAt === null)

            // ── the role, as data ────────────────────────────────────────
            const heldId = effectiveRoleId(row)
            const held = roles.find((role) => role.id === heldId) ?? null
            // Permission-derived, unlike `isAdminRow` above it. A Director is
            // `role === 'member'` in the legacy column by construction, so the
            // legacy flag is the wrong input for a shield icon that means
            // "administers this workspace" — and the right input for the two
            // buttons that go to the edge function. Both are on the row on
            // purpose; the file header says which is which.
            const grantsAdmin = heldId !== null && adminRoleIds.has(heldId)
            // What the row LOOKS like: the shield and the blue pill mean
            // "administers this workspace", so they follow the permission and
            // not the text column. On a project with 0025 unapplied
            // `adminRoleIds` is empty, and the legacy answer is then the only
            // one there is.
            const showsAsAdmin = rolesReady ? grantsAdmin : isAdminRow
            const RoleIcon = showsAsAdmin ? IconShieldCheck : IconUser
            const position = refs.get(row.id)?.position ?? ''
            // ── the position, as an edit ─────────────────────────────────
            // The draft, or null when this is not the row being edited. A
            // NARROWED value rather than a boolean, so the box below can read
            // `.value` without TypeScript having to be told twice that the
            // state it just tested is not null.
            const positionDraft =
              editingPosition !== null && editingPosition.id === row.id ? editingPosition : null
            const savingPosition = savingPositionId === row.id
            // The same reason the role picker refuses a row with no `profiles`
            // row: the UPDATE would match nothing and answer `errNotFound`,
            // which reads as "this account is gone" when it is half-provisioned.
            const positionBlock =
              canWritePosition && !row.hasProfile ? 'members.errNoProfileRow' : null
            // Every option's refusal, computed once per row rather than twice
            // per option: the reason list under the row needs them all, and the
            // <option>s need them one at a time.
            const roleBlocks = new Map<string, string | null>(
              roles.map((role) => [
                role.id,
                roleMoveBlockKey({
                  isSelf: row.isSelf,
                  isBootstrapAdmin: row.isBootstrapAdmin,
                  hasProfile: row.hasProfile,
                  fromGrantsAdmin: grantsAdmin,
                  toGrantsAdmin: adminRoleIds.has(role.id),
                  adminHolders,
                }),
              ]),
            )

            // The three server guards, mirrored. Each holds the KEY of the
            // sentence the server would have answered with, so the disabled
            // button's explanation and the 403's toast are the same string.
            const lastAdmin = isAdminRow && adminCount <= 1
            // Gated on isAdminRow because the demote button only exists for an
            // admin. Without the gate a member row would carry a reason for a
            // control it does not render — and PROMOTION is never blocked, so
            // the row would print a sentence contradicting its own live button.
            const demoteBlock = !isAdminRow
              ? null
              : row.isSelf
                ? 'members.errSelfDemote'
                : row.isBootstrapAdmin
                  ? 'members.errBootstrapAdmin'
                  : lastAdmin
                    ? 'members.errLastAdmin'
                    : null
            const deleteBlock = row.isSelf
              ? 'members.errSelfDelete'
              : row.isBootstrapAdmin
                ? 'members.errBootstrapAdmin'
                : lastAdmin
                  ? 'members.errLastAdmin'
                  : null
            // Order matters and it is the reading order of the controls: the
            // role control sits before Delete, so its reason does too. When the
            // picker is on screen its reasons stand in for the demote button's,
            // because that button is not rendered — a row must never print a
            // sentence about a control it does not have. "Edit position" sits
            // between the role control and Delete, and its reason sits there
            // too; it dedupes away entirely when the picker has already said
            // the same sentence about the same missing row.
            const blockReasons = [
              ...new Set(
                rolesReady
                  ? [...roleBlocks.values(), positionBlock, deleteBlock]
                  : [demoteBlock, positionBlock, deleteBlock],
              ),
            ].filter((key): key is string => key !== null)

            return (
              <li key={row.id} className="card card-tight mem-row">
                <div className="mem-main">
                  <span className={`mem-icon${showsAsAdmin ? ' is-admin' : ''}`} aria-hidden="true">
                    <RoleIcon size={18} />
                  </span>
                  <div className="mem-text">
                    <p className="mem-name">
                      {row.displayName}
                      {/* THE POSITION, BESIDE THE NAME. Eighteen people with
                          seven Associate Directors is not a roster anybody reads
                          by username, and "Nawaf Alharbi · PMO Director" is how
                          the person is introduced in the room.

                          DISPLAY ONLY, and 0025:483 is emphatic about it: it
                          gates nothing, here or anywhere.

                          IT IS ALSO FREE TEXT SOMEBODY TYPED, so it is isolated
                          exactly like the handle below. `<bdi>` and not
                          `lib/bidi.isolate()` because there is a DOM node here
                          rather than an assembled string — the element carries
                          `unicode-bidi: isolate`, which is the FSI…PDI pair
                          that module wraps, and lib/bidi.ts's header draws the
                          line in those words. Without it "PMO (OB related)"
                          beside an Arabic display name hands its parentheses
                          and the `·` in front of it to the paragraph
                          direction, and both land on the wrong side.

                          `.mem-position` is 13px dim like `.mem-handle` and
                          drops the 600 weight `.mem-name` would otherwise pass
                          down — without it "Nawaf Alharbi · PMO Director" prints
                          as two names rather than a name and a description. */}
                      {position && (
                        <span className="mem-position">
                          · <bdi>{position}</bdi>
                        </span>
                      )}
                      {row.isSelf && <span className="pill mem-you">{t('members.you')}</span>}
                    </p>
                    {/* The handle is DATA — a username or an address — so no
                        t(). bdi keeps its Latin run intact inside an Arabic
                        column without re-aligning the line. */}
                    <p className="mem-handle">
                      <bdi>{row.username ? `@${row.username}` : row.email}</bdi>
                    </p>
                    <p className="mem-tags">
                      {/* THE ROLE'S OWN NAME once there are roles to name.
                          `settings.roleAdmin` / `roleMember` are the two words
                          the legacy column knows, and a Director printed as
                          "Member" would be the same lie the roles screen was
                          built to stop telling. The name is DATA — Aziz can
                          rename it on the roles screen and translate it — so it
                          does not go through t(), and it falls back to the two
                          fixed words on a project with no roles table. */}
                      <span className={`pill${showsAsAdmin ? ' info' : ''}`}>
                        {held ? (
                          <bdi>{roleLabel(held)}</bdi>
                        ) : (
                          t(isAdminRow ? 'settings.roleAdmin' : 'settings.roleMember')
                        )}
                      </span>
                      {row.isBootstrapAdmin && (
                        <span className="pill">{t('members.owner')}</span>
                      )}
                      {pending && !expired && (
                        <span className="pill warn">{t('members.pending')}</span>
                      )}
                      {expired && <span className="pill danger">{t('members.inviteExpired')}</span>}
                      {!row.username && (
                        <span className="pill">{t('members.emailAccount')}</span>
                      )}
                      {/* A provisioning half-failure: the auth user exists and
                          the profiles row does not, so RLS will show them an
                          empty app. Surfaced rather than hidden — it is the one
                          state on this screen that needs an admin to act. */}
                      {!row.hasProfile && (
                        <span className="pill danger">{t('members.noProfile')}</span>
                      )}
                    </p>
                    <p className="mem-meta">
                      {/* Two keys rather than one with `date.never` poured into
                          it. "Last signed in Never" is not a sentence in either
                          language, and the Arabic — "آخر دخول أبدًا" — is worse
                          than the English; a provisioned account that nobody has
                          used yet is the most common state on this screen, so it
                          gets its own words. */}
                      <span>
                        {row.lastSignInAt
                          ? t('members.lastSignIn', {
                              date: formatRelativeTime(row.lastSignInAt, locale, now),
                            })
                          : t('members.neverSignedIn')}
                      </span>
                      {pending && !expired && row.inviteExpiresAt && (
                        <span>
                          {t('members.inviteExpires', {
                            date: formatTimestamp(row.inviteExpiresAt, locale),
                          })}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {rolesReady && (
                  // ── the role picker ────────────────────────────────────
                  //
                  // ITS OWN FULL-WIDTH LINE, before the buttons. `.mem-row` is a
                  // wrapping flex row and `.mem-role` is its `flex: 1 1 100%`
                  // slot, so this takes a line of its own on a phone and on a
                  // desk without a media query — and a <select> is
                  // `inline-size: 100%` in global.css, which inside the
                  // content-sized `.mem-actions` would have resolved against a
                  // width that depends on it. `.mem-role` rather than
                  // `.mem-block`: the geometry is the same, but `.mem-block`
                  // MEANS "the reason a control is disabled" and prints 12px
                  // faint, which a control must not be.
                  <div className="mem-role">
                    <select
                      className="select"
                      // Its own accessible name rather than a visible label:
                      // eighteen rows of the word "Role" down the page is
                      // eighteen copies of something the row already says, and
                      // the name interpolates the person so a screen reader
                      // hears "Role for Nawaf Alharbi", not the ninth
                      // unlabelled combobox. GroupsAdmin's rule.
                      aria-label={t('members.roleFor', { name: row.displayName })}
                      // A whole row that cannot be written: no `profiles` row
                      // means the UPDATE matches nothing. The reason prints
                      // below, beside the pill that says the same thing.
                      disabled={!row.hasProfile || movingId === row.id || busy}
                      aria-describedby={
                        blockReasons.length > 0 ? `mem-block-${row.id}` : undefined
                      }
                      value={heldId ?? ''}
                      onChange={(e) => void moveRole(row, e.target.value)}
                    >
                      {/* Only when the held role is not one this screen loaded
                          — a role deleted between the two reads, or a null
                          role_id with no system role to fall back on. Disabled,
                          because it is not a destination. Without it the
                          browser shows the FIRST role as the selection, which
                          is a confident answer to a question nobody answered. */}
                      {heldId === null && (
                        <option value="" disabled>
                          {t('members.roleUnknown')}
                        </option>
                      )}
                      {roles.map((role) => (
                        <option
                          key={role.id}
                          value={role.id}
                          // THE GUARD, VISIBLE BEFORE IT IS ENFORCED. 0025's
                          // GUARD 1 refuses this in the database with a 42501,
                          // and a red toast arriving after the dropdown has
                          // closed teaches nothing. The option will not take,
                          // and the sentence saying why is under the row.
                          disabled={roleBlocks.get(role.id) !== null}
                        >
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div
                  className="mem-actions"
                  role="group"
                  aria-label={t('members.actionsFor', { name: row.displayName })}
                >
                  {/* Reissue only exists for a username account. On an email
                      account the server refuses it (`email_account`), and the
                      pill above already says why, so there is no button to
                      explain away. */}
                  {row.username && (
                    <button
                      type="button"
                      className={`btn btn-sm${needsCode ? ' btn-primary' : ''}`}
                      disabled={busy}
                      onClick={() => void reissue(row)}
                    >
                      {t('members.reissue')}
                    </button>
                  )}

                  {/* THE FALLBACK PAIR, and only when the picker is absent. Two
                      controls writing the same fact by two different paths —
                      one the legacy text through the edge function, one role_id
                      through Postgres — is precisely the disagreement 0025's
                      derived column exists to prevent, so exactly one of them is
                      ever on screen. These are what a project with 0025
                      unapplied still has, and they are unchanged. */}
                  {!rolesReady &&
                    (isAdminRow ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={demoteBlock !== null || busy}
                        // aria-describedby onto the VISIBLE reason below, and
                        // deliberately no `title`. A `title` on a button whose
                        // contents already name it is announced by some screen
                        // readers INSTEAD of the contents — verified in the
                        // accessibility tree, where the buttons read "You can't
                        // delete your own account, button" and the word "Delete"
                        // had vanished. The sentence is on screen either way, so
                        // the tooltip bought nothing and cost the label.
                        aria-describedby={demoteBlock ? `mem-block-${row.id}` : undefined}
                        onClick={() => void changeRole(row, 'member')}
                      >
                        {t('members.demote')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => void changeRole(row, 'admin')}
                      >
                        {t('members.promote')}
                      </button>
                    ))}

                  {/* THE POSITION EDIT, and only for somebody the loaded
                      permission rows say can actually write it. It is a
                      TOGGLE, not a link: the box opens on the row's own line
                      below, so `aria-expanded` is what says what the press
                      did, and `aria-controls` names the thing it opened. */}
                  {canWritePosition && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!row.hasProfile || busy || savingPosition}
                      aria-expanded={positionDraft !== null}
                      aria-controls={positionDraft ? `mem-position-${row.id}` : undefined}
                      aria-describedby={positionBlock ? `mem-block-${row.id}` : undefined}
                      onClick={() =>
                        setEditingPosition(
                          positionDraft ? null : { id: row.id, value: position },
                        )
                      }
                    >
                      {t('members.editPosition')}
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={deleteBlock !== null || busy}
                    aria-describedby={deleteBlock ? `mem-block-${row.id}` : undefined}
                    onClick={() => void remove(row)}
                  >
                    {t('common.delete')}
                  </button>
                </div>

                {positionDraft && (
                  // ── the position box ───────────────────────────────────
                  //
                  // `.mem-role` again, and borrowed rather than minted for the
                  // reason that class was split out of `.mem-block` in the
                  // first place: it means "a CONTROL on a line of its own",
                  // which is exactly what this is, and `.mem-block`'s 12px
                  // faint type is what a control must not have. members.css is
                  // outside this unit's file ownership, so a `.mem-position-
                  // edit` of its own is a follow-up rather than a thing to
                  // reach across for — the handoff note carries it.
                  //
                  // `.field` and `.mem-form-actions` inside it are the create
                  // form's own two classes: a 6px column stack, and a wrapping
                  // end-aligned button row. Nothing here is new geometry.
                  <div className="mem-role">
                    <div className="field">
                      <input
                        id={`mem-position-${row.id}`}
                        ref={focusOnMount}
                        className="input"
                        value={positionDraft.value}
                        placeholder={t('members.positionPlaceholder')}
                        maxLength={POSITION_MAX}
                        autoComplete="off"
                        // Its own accessible name, interpolating the person, for
                        // the role picker's reason: a visible "Position" label
                        // on each of eighteen rows repeats what the row already
                        // says, and an unlabelled box in a list of eighteen is
                        // unnavigable. No `dir` — a title is prose in whichever
                        // language the workspace speaks.
                        aria-label={t('members.positionFor', { name: row.displayName })}
                        disabled={savingPosition}
                        aria-describedby={
                          blockReasons.length > 0 ? `mem-block-${row.id}` : undefined
                        }
                        onChange={(e) => setEditingPosition({ id: row.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          // Enter saves and Escape abandons, because this box is
                          // NOT inside a <form> — the roster is a <ul> — so
                          // neither key does anything on its own here, and a
                          // text field that swallows Enter reads as broken.
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void savePosition(row, positionDraft.value)
                          } else if (e.key === 'Escape') {
                            setEditingPosition(null)
                          }
                        }}
                      />
                      <div className="mem-form-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={savingPosition}
                          onClick={() => setEditingPosition(null)}
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={savingPosition}
                          onClick={() => void savePosition(row, positionDraft.value)}
                        >
                          {t('common.save')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Visible, not a tooltip: when a control is blocked the admin
                    should be able to READ why, and a `title` is unreachable on
                    a touch device. DEDUPED, not concatenated — the owner and
                    last-admin cases give both buttons the same sentence and
                    printing it twice reads like a stutter, while your own row
                    gives two genuinely different ones ("your own account" vs
                    "your own admin role") and dropping either would leave a
                    greyed-out button with no explanation. */}
                {blockReasons.length > 0 && (
                  <p className="mem-block" id={`mem-block-${row.id}`}>
                    {blockReasons.map((key) => t(key)).join(' ')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* The live region, GroupsAdmin's and RolesAdmin's. A role move changes
          one word inside a dropdown that has already closed — nothing gains
          focus, nothing appears, and the toast is not in the accessibility
          tree's reading order. `polite`, because the admin is the one who just
          acted and has nothing to interrupt. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>
    </div>
  )
}
