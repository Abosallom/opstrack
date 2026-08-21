// Data access for custom roles and the permissions they grant (migration 0025).
//
// WHAT THIS MODULE IS FOR. The workspace stopped being three people and became
// eighteen. Two hardcoded roles — the `admin`/`member` CHECK on `profiles.role`
// — cannot express "may edit the map and the vocabulary but may NOT delete a
// colleague's account", which is exactly the split that turns nine admins into
// two admins and seven directors. 0025 makes roles DATA: `roles`,
// `role_permissions`, `profiles.role_id`, and `is_admin()` redefined as a thin
// alias over `has_perm('workspace.admin')` so all 183 existing policy call sites
// keep working byte for byte.
//
// ⚠ THE PERMISSION CATALOGUE IS CODE-DEFINED, AND THAT IS NOT A LIMITATION TO
//   BE PAPERED OVER — IT IS THE ONE HONEST SENTENCE ABOUT THIS FEATURE. A
//   permission is a promise the code enforces; a key nobody checks grants
//   nothing and would be a switch wired to a bulb that is not there. So
//   `PERMISSIONS` below MIRRORS `role_permissions_key_ck` (0025:256) — it is not
//   the source of truth, the constraint is, and a client that POSTs a key the
//   constraint does not list gets a 23514 rather than a row that looks like a
//   grant and is not one. Adding a permission is a migration plus the code that
//   reads it plus this list, in one commit.
//
// ⚠ AND EACH ENTRY CARRIES HOW MUCH IT IS WORTH TODAY (`reach`). 0025's header
//   measured it, and the amendment moved the count: `workspace.admin` is
//   enforced everywhere, `members.manage` is enforced on this very screen's two
//   tables, and `structure.edit` and `vocab.edit` became the write gate on seven
//   configuration tables and eight admin RPCs. FOUR OF THE FIVE ARE LIVE. Only
//   `capture.write` is still DECLARED — `entries` is gated on is_member(),
//   which is what it should be, because filing work is what membership IS.
//   Rendering five switches as though they were equally live would be the exact
//   lie the migration's header exists to prevent, so the UI shows the difference
//   and this is where it comes from.
//
// ⚠ `reach` IS A STATEMENT ABOUT THE DATABASE, NOT ABOUT THIS APP'S SCREENS.
//   The client half of that gap closes through `myPermissions()` below, which
//   store/auth.ts reads once per sign-in to answer `useHasPerm(key)` — so a
//   Director holding `structure.edit` is offered exactly the screens 0025 lets
//   them write, instead of being redirected off all of them. "In force" is still
//   the answer to "what will the server accept" and nothing here changes that:
//   the hook decides what RENDERS, RLS decides what is WRITTEN, and the point of
//   reading the real grants is that the two now give the same answer.
//
// ERRORS ARE i18n KEYS, NOT SENTENCES — api/tracks.ts's rule. `roleErrorKey()`
// below is a LOCAL mapper rather than an addition to lib/pgError.ts because that
// file belongs to another worker this wave; it matches 0025's raise tokens
// first and falls through to `pgErrorKey()` for everything shared. The order is
// load-bearing: `last_admin` is raised with SQLSTATE 42501, which pgErrorKey
// maps to the generic "an admin only can do that" — a sentence that is both
// wrong and unactionable for a revocation that would empty the workspace.
//
// NOT IN store/config.ts, deliberately. The ROLE LIST is read by exactly one
// screen: caching three rows app-wide would buy nothing and would put a second,
// staler answer to "which roles exist" in the tree. The signed-in member's OWN
// keys are a different question with a different shape — one set, read once at
// sign-in, asked by every gate in the app — and store/auth.ts caches those,
// beside the profile they belong to, through `myPermissions()` below.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { pgErrorKey } from '../lib/pgError'

/* ────────────────────────────── the shapes ─────────────────────────────── */

/** `roles` (0025). `key` is the machine name and is immutable after creation. */
export interface Role {
  id: string
  /** Stable machine name, `^[a-z][a-z0-9_]{1,31}$`. Never edited — see 0025. */
  key: string
  name: string
  /** `not null default ''` — fall back to `name` when EMPTY, not when null. */
  name_ar: string
  sort_order: number
  /** `admin` and `member`: cannot be deleted, and is_system cannot be cleared. */
  is_system: boolean
  created_at: string
  updated_at: string
}

/**
 * One row of `role_permissions`.
 *
 * `permission_key` is typed `string`, NOT the `PermissionKey` union, and that is
 * deliberate: the union is this build's view of a catalogue that lives in the
 * database and grows by migration. A tab left open across a deploy that adds a
 * key would otherwise hold rows whose type is a lie. The screen renders the
 * catalogue it knows and says plainly that it found a grant it does not.
 */
export interface RolePermission {
  role_id: string
  permission_key: string
  granted: boolean
}

/**
 * Just enough of a profile to answer "who holds which role", for the guard.
 *
 * Two columns and no identity beyond the role: this module counts holders, it
 * does not list people. `role` is the LEGACY text column, kept because
 * `has_perm()` falls back to it when `role_id` is null (0025:400) and a client
 * guard that did not would refuse a revocation the database allows, or worse,
 * allow one it refuses.
 */
export interface ProfileRoleRef {
  role: string
  role_id: string | null
}

export type PermissionKey =
  | 'workspace.admin'
  | 'structure.edit'
  | 'vocab.edit'
  | 'members.manage'
  | 'capture.write'

/**
 * How much a key is worth TODAY.
 *
 * `live`     — something in the product reads it right now.
 * `declared` — the key exists, the grant is real and audited, and no policy
 *              reads it yet. Ticking it is safe and changes nothing until the
 *              policies move, which is a one-line change per table.
 */
export type PermissionReach = 'live' | 'declared'

export interface PermissionMeta {
  readonly key: PermissionKey
  /** Short label. */
  readonly labelKey: string
  /**
   * THE HONESTY LINE: what ticking this actually lets a person do, in concrete
   * terms — "create and delete accounts, and change anyone's role", never
   * "manage members". A checkbox whose effect the reader cannot predict is
   * worse than no checkbox.
   */
  readonly effectKey: string
  readonly reach: PermissionReach
}

/**
 * THE CATALOGUE, mirroring `role_permissions_key_ck` (0025:256) exactly.
 *
 * Order is the order the reader meets them: the one that grants everything
 * first, then the one that grants this screen, then the three that are declared
 * and not yet enforced. A reader scanning the list top to bottom meets the
 * consequential switches before the harmless ones.
 */
export const PERMISSIONS: readonly PermissionMeta[] = [
  {
    key: 'workspace.admin',
    labelKey: 'roles.permWorkspaceAdmin',
    effectKey: 'roles.permWorkspaceAdminEffect',
    // is_admin() IS this key, and is_admin() is the write gate on `profiles`,
    // entry deletion, `meetings`, `track_slas`, the config_audit reads, the
    // RPCs whose subject is PEOPLE, and the members edge function. It no longer
    // gates the seven configuration tables or the eight RPCs that write them —
    // Admin reaches those by holding the two keys below, which it does.
    reach: 'live',
  },
  {
    key: 'members.manage',
    labelKey: 'roles.permMembersManage',
    effectKey: 'roles.permMembersManageEffect',
    // Live: it is 0025's own write gate on `roles` and `role_permissions`, and
    // the gate on moving another member between roles.
    reach: 'live',
  },
  {
    key: 'structure.edit',
    labelKey: 'roles.permStructureEdit',
    effectKey: 'roles.permStructureEditEffect',
    // Live since 0025's amendment: the write gate on `tracks`, `track_groups`,
    // `map_nodes` and `map_node_kinds`, and on the five RPCs that reorder,
    // re-parent and delete them. Granting it changes what the SERVER accepts.
    reach: 'live',
  },
  {
    key: 'vocab.edit',
    labelKey: 'roles.permVocabEdit',
    effectKey: 'roles.permVocabEditEffect',
    // Live since 0025's amendment: the write gate on `use_cases`,
    // `vocab_options` and `label_overrides`, and on reorder_vocab(),
    // reset_vocab() and reset_label_overrides().
    reach: 'live',
  },
  {
    key: 'capture.write',
    labelKey: 'roles.permCaptureWrite',
    effectKey: 'roles.permCaptureWriteEffect',
    reach: 'declared',
  },
]

/** The permission whose loss cannot be repaired from inside the app. */
export const ADMIN_PERMISSION: PermissionKey = 'workspace.admin'

/**
 * The catalogue as bare keys, in catalogue order.
 *
 * Derived from PERMISSIONS rather than written out a second time: this list is
 * what "an admin holds everything" MEANS in the pre-0025 fallback
 * (store/auth.legacyPermissionKeys), and a hand-maintained copy would be the one
 * place a newly added key is forgotten — silently demoting every admin on a
 * database where the roles tables do not exist yet.
 */
export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key)

/**
 * What a member is allowed to do when nothing else says otherwise.
 *
 * `capture.write` is the one key that is DECLARED rather than enforced (see
 * PERMISSIONS), and filing work is what membership IS — `entries` is gated on
 * `is_member()`. So this is the honest legacy reading of `role = 'member'`, and
 * it is the floor the fallback lands on.
 */
export const MEMBER_PERMISSION_KEYS: readonly PermissionKey[] = ['capture.write']

/** `roles_name_len_ck` — 1..40 on the trimmed name. Mirrored, not owned. */
export const ROLE_NAME_MAX = 40

/** `roles_key_ck` — lowercase slug, 2..32. Mirrored, not owned. */
export const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/

/* ───────────────────────────── error mapping ───────────────────────────── */

/**
 * 0025's raise tokens → i18n keys, then everything else to `pgErrorKey()`.
 *
 * TOKENS FIRST, CODES SECOND, and that ordering is the whole reason this
 * function exists rather than a call straight through to pgErrorKey: three of
 * the four guards below raise with SQLSTATE 42501, which pgErrorKey maps to
 * `admin.errForbidden` ("an admin only"). For a revocation that would leave the
 * workspace with nobody holding workspace.admin that sentence is wrong twice —
 * the actor IS an admin, and the fix is to grant it elsewhere first, which the
 * generic message cannot say.
 *
 * The tokens are long, underscored and unique to 0025; none is a substring of
 * another, so the order of the tests below carries no meaning.
 */
export function roleErrorKey(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'common.error'
  const e = error as { message?: unknown; details?: unknown; hint?: unknown }
  const text = [e.message, e.details, e.hint]
    .filter((p): p is string => typeof p === 'string')
    .join(' ')
    .toLowerCase()

  // GUARD 1 (0025:676). The database's copy of the rule this screen enforces
  // first — see `revokeWouldOrphanWorkspace()`. Reaching it means another
  // session moved the last admin while this one had the screen open.
  if (text.includes('last_admin')) return 'roles.errLastAdmin'
  // roles_guard_write() — a built-in role, a role somebody holds, a renamed key.
  if (text.includes('role_is_system')) return 'roles.errSystem'
  if (text.includes('role_in_use')) return 'roles.errInUse'
  if (text.includes('role_key_immutable')) return 'roles.errKeyImmutable'
  // The catalogue constraint. Only reachable from a build that is ahead of the
  // database it is talking to, which is a real state during a deploy.
  if (text.includes('role_permissions_key_ck')) return 'roles.errUnknownPerm'
  // Unique indexes and the two shape checks.
  if (text.includes('roles_name_ar_uidx')) return 'roles.errNameArTaken'
  if (text.includes('roles_name_uidx')) return 'roles.errNameTaken'
  if (text.includes('roles_key_uidx')) return 'roles.errKeyTaken'
  if (text.includes('roles_key_ck')) return 'roles.errKeyShape'
  if (text.includes('roles_name_len_ck')) return 'roles.errNameLength'
  return pgErrorKey(error)
}

/* ─────────────────────────────── the reads ─────────────────────────────── */

/**
 * Every role, in display order.
 *
 * The second sort key is `name` for listTracks' reason: `sort_order` defaults to
 * 0, nothing rewrites it in bulk, and without a stable tie break two loads of
 * the same data render in different orders — which reads as data loss rather
 * than as a sort.
 */
export async function listRoles(): Promise<ApiResult<Role[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: (data ?? []) as Role[] }
}

/**
 * Every grant in the workspace, for every role, in one read.
 *
 * ONE READ RATHER THAN ONE PER ROLE: the table is roles × five keys — single
 * figures per role, double figures in total — and the last-admin guard needs to
 * see ALL of them to answer "would this be the last one". A per-role read would
 * make that guard depend on which cards happen to be loaded.
 */
export async function listRolePermissions(): Promise<ApiResult<RolePermission[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('role_permissions')
    .select('role_id, permission_key, granted')
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: (data ?? []) as RolePermission[] }
}

/**
 * Which role each member holds — two columns, no names, no ids.
 *
 * A SELECT ON `profiles` RATHER THAN `member_directory()`: that RPC answers
 * display name, role text and username and knows nothing about `role_id`, which
 * is the column this screen counts. `profiles_select` is gated on is_member()
 * (0009:157), so this read is available to exactly the people who can read the
 * roles themselves.
 *
 * The legacy `role` text comes back with it because `has_perm()` falls back to
 * it when `role_id` is null. 0025's backfill leaves no such row behind, but the
 * fallback is what makes a half-applied migration a degraded state rather than
 * a workspace where nobody is an admin — and a client guard that ignored it
 * would disagree with the database exactly when it matters.
 */
export async function listProfileRoles(): Promise<ApiResult<ProfileRoleRef[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.from('profiles').select('role, role_id')
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: (data ?? []) as ProfileRoleRef[] }
}

/**
 * What ONE person may do: the role they hold and the keys it grants.
 *
 * `roleId: null` is not an error and not "nothing" — it is the answer for a
 * profile whose `role_id` has not been backfilled, and it means exactly what
 * `has_perm()`'s coalesce (0025:400) means: fall back to the legacy
 * `profiles.role` text column. The caller does that, because the caller is the
 * one that holds the profile; this module refuses to guess.
 */
export interface MyPermissions {
  /** The role actually joined against, or null when the legacy column decides. */
  roleId: string | null
  /** Every GRANTED key on that role. An explicit `granted = false` is absent. */
  keys: string[]
}

/**
 * The signed-in member's own permission keys, for the client-side gate.
 *
 * TWO READS, NOT AN EMBED. `profiles → roles → role_permissions` is expressible
 * as one PostgREST embed, but the embed names a foreign key that DOES NOT EXIST
 * on a database where 0025 has not run, and PostgREST answers that with a 400
 * whose message is about a relationship rather than about a missing table — the
 * same failure as a genuinely broken query, and impossible to tell apart. Two
 * plain selects fail in the ordinary way instead, once per sign-in.
 *
 * ⚠ IT MUST BE ABLE TO FAIL, AND THE CALLER MUST BE ABLE TO SURVIVE IT. On the
 *   live project right now `roles`, `role_permissions` and `profiles.role_id`
 *   are all absent: the first select answers 42703 (undefined column) and the
 *   second would answer 404. Both come back here as an ordinary `{ ok: false }`
 *   with an i18n key, never as a throw, so store/auth can fall back to the
 *   legacy text column and the app behaves exactly as it does today.
 *
 * `granted` is filtered HERE rather than in the query, because an explicit deny
 * (`granted = false`, 0025:236) has to be readable as a row somebody turned off
 * — filtering it server-side would make a denied key and an ungranted one the
 * same wire answer, which is the distinction that row exists to keep.
 */
export async function myPermissions(userId: string): Promise<ApiResult<MyPermissions>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('profiles')
    .select('role_id')
    .eq('id', userId)
    .maybeSingle()
  if (error) return fail(roleErrorKey(error))
  const roleId = (data as { role_id?: string | null } | null)?.role_id ?? null
  // No role_id: the database itself would answer from `profiles.role`, so there
  // is nothing to join and a second round trip would return the same empty set.
  if (!roleId) return { ok: true, data: { roleId: null, keys: [] } }

  const { data: rows, error: permError } = await supabase
    .from('role_permissions')
    .select('permission_key, granted')
    .eq('role_id', roleId)
  if (permError) return fail(roleErrorKey(permError))
  const keys = ((rows ?? []) as RolePermission[])
    .filter((row) => row.granted)
    .map((row) => row.permission_key)
  return { ok: true, data: { roleId, keys } }
}

/* ───────────────────────── the guard, client-side ──────────────────────── */
//
// ⚠ THE GUARD MUST BE VISIBLE, NOT MERELY ENFORCED. Unticking the last
//   `workspace.admin` is refused by the database — GUARD 1 in 0025, a statement
//   trigger that raises 42501 — and a 42501 arriving as a red toast AFTER the
//   switch has animated across is a worse experience than a switch that would
//   not move and says why. A workspace with no administrator cannot be repaired
//   from inside the app: no admin remains to restore the grant, and the members
//   edge function refuses everyone because its own gate reads a column that now
//   says 'member'. Recovery is SQL, by somebody with dashboard access.
//
//   So the rule is computed here, from data the screen already has, and the
//   functions below are pure so the test can exercise them without a database.

/**
 * The effective role id for one profile — `role_id`, or the system role its
 * legacy `role` text names.
 *
 * This is `has_perm()`'s `coalesce` (0025:400) in TypeScript, and it has to stay
 * that way: the two answers disagreeing is the whole class of bug this guard
 * exists to prevent.
 */
function effectiveRoleId(ref: ProfileRoleRef, roles: readonly Role[]): string | null {
  if (ref.role_id) return ref.role_id
  const wantKey = ref.role === 'admin' ? 'admin' : 'member'
  return roles.find((r) => r.key === wantKey)?.id ?? null
}

/** role id → how many members hold it. Roles nobody holds are absent. */
export function holderCounts(
  profiles: readonly ProfileRoleRef[],
  roles: readonly Role[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const ref of profiles) {
    const id = effectiveRoleId(ref, roles)
    if (!id) continue
    out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

/** True when this role currently grants the key. An absent row is a no. */
export function grants(
  permissions: readonly RolePermission[],
  roleId: string,
  key: string,
): boolean {
  return permissions.some((p) => p.role_id === roleId && p.permission_key === key && p.granted)
}

/**
 * `admin_holder_count()` (0025:609) in TypeScript: how many members resolve to a
 * role granting `workspace.admin`.
 */
export function adminHolderCount(
  profiles: readonly ProfileRoleRef[],
  roles: readonly Role[],
  permissions: readonly RolePermission[],
): number {
  const counts = holderCounts(profiles, roles)
  let total = 0
  for (const [roleId, n] of counts) {
    if (grants(permissions, roleId, ADMIN_PERMISSION)) total += n
  }
  return total
}

/**
 * Would revoking `workspace.admin` from this role leave the workspace with
 * nobody holding it?
 *
 * The rule is 0025's, and it is "do not reduce it to ZERO", never "it must not
 * BE zero" — a workspace that has none yet (a fresh project, before the first
 * member is provisioned) must still be able to save changes, or the guard is a
 * locked door with the key inside. So: only refuse when there is at least one
 * admin now and none afterwards.
 *
 * Returns false for any key other than `workspace.admin`: nothing else in the
 * catalogue can lock anybody out.
 */
export function revokeWouldOrphanWorkspace(
  roleId: string,
  key: string,
  profiles: readonly ProfileRoleRef[],
  roles: readonly Role[],
  permissions: readonly RolePermission[],
): boolean {
  if (key !== ADMIN_PERMISSION) return false
  const before = adminHolderCount(profiles, roles, permissions)
  if (before === 0) return false
  const after = permissions.filter(
    (p) => !(p.role_id === roleId && p.permission_key === ADMIN_PERMISSION),
  )
  return adminHolderCount(profiles, roles, after) === 0
}

/* ────────────────────────────── the writes ─────────────────────────────── */

/** The signed-in user's id, or null when the session has gone. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Where a new role lands: after every existing one, never on top of them. */
async function nextSortOrder(): Promise<number> {
  if (!supabase) return 0
  const { data } = await supabase
    .from('roles')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as { sort_order: number } | null
  return (row?.sort_order ?? 0) + 1
}

export interface RoleInput {
  key: string
  name: string
  nameAr: string
}

/**
 * Create a role. It grants NOTHING until permissions are ticked on it, which is
 * the safe default and the honest one — a new role that silently inherited the
 * grants of whatever was on screen would be the worst possible surprise on this
 * particular table.
 *
 * `key` is validated here as well as by `roles_key_ck`, for the reason every
 * client-side mirror of a constraint exists on this codebase: a 23514 naming a
 * constraint identifier is not a sentence anybody can act on, and the screen can
 * refuse before the round trip.
 */
export async function createRole(input: RoleInput): Promise<ApiResult<Role>> {
  if (!supabase) return notConfigured()
  const key = input.key.trim().toLowerCase()
  const name = input.name.trim()
  if (!ROLE_KEY_RE.test(key)) return fail('roles.errKeyShape')
  if (name.length < 1 || name.length > ROLE_NAME_MAX) return fail('roles.errNameLength')

  const userId = await currentUserId()
  if (!userId) return fail('common.notSignedIn')

  const { data, error } = await supabase
    .from('roles')
    .insert({
      key,
      name,
      name_ar: input.nameAr.trim(),
      sort_order: await nextSortOrder(),
      // NEVER true from a client. is_system is what makes a role undeletable and
      // what profiles_role_sync() resolves the legacy column against; only a
      // migration may mint one.
      is_system: false,
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: data as Role }
}

/**
 * Rename a role. `key` is deliberately absent from the patch: 0025's
 * `roles_guard_write()` refuses to change it, because migrations and code
 * compare against it, and offering an edit that the database reverts is worse
 * than not offering it.
 */
export async function updateRole(
  id: string,
  input: { name: string; nameAr: string },
): Promise<ApiResult<Role>> {
  if (!supabase) return notConfigured()
  const name = input.name.trim()
  if (name.length < 1 || name.length > ROLE_NAME_MAX) return fail('roles.errNameLength')
  const { data, error } = await supabase
    .from('roles')
    .update({ name, name_ar: input.nameAr.trim() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: data as Role }
}

/**
 * Delete a role.
 *
 * Both refusals are the database's — `is_system`, and "somebody holds it" — and
 * both are ALSO shown on the card before the click, because a guard the reader
 * meets only after acting teaches nothing. This call is the backstop for the
 * delete that raced another session's assignment.
 */
export async function deleteRole(id: string): Promise<ApiResult<null>> {
  if (!supabase) return notConfigured()
  const { error } = await supabase.from('roles').delete().eq('id', id)
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: null }
}

/**
 * Grant or revoke one permission on one role.
 *
 * AN UPSERT, NOT A DELETE. `granted = false` is an EXPLICIT DENY that reads
 * identically to an absent row today (0025:236) — it exists so the switch can go
 * to the off position without the row vanishing, and so `config_audit` records
 * the moment something was turned OFF rather than an insert followed one day by
 * nothing at all. `roles_audit`/`role_permissions_audit` write that trail; this
 * function does not, and must not, because an audit row written by a client is
 * an audit row a client can forge.
 */
export async function setRolePermission(
  roleId: string,
  key: string,
  granted: boolean,
): Promise<ApiResult<RolePermission>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('role_permissions')
    .upsert(
      { role_id: roleId, permission_key: key, granted },
      { onConflict: 'role_id,permission_key' },
    )
    .select('role_id, permission_key, granted')
    .single()
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: data as RolePermission }
}
