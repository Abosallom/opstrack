// Data access for members — the read surface every owner control needs, plus
// the four admin writes that can only happen behind the service role.
//
// Members land in WAVE 1, not Wave 4. Wave 4 adds the admin PAGE; the read is
// needed the moment OwnerBadge and the owner picker exist, and
// `profiles_select = is_member()` means it already works against the live
// project today.
//
// THE READ AND THE WRITES GO TO DIFFERENT PLACES, on purpose. `listMembers()`
// is one PostgREST call to `member_directory()`, a SECURITY DEFINER read gated
// on the same `is_member()` predicate as `profiles_select` (migration 0013 — it
// exists because a username lives in `auth.users`, which PostgREST cannot reach
// with a select). Everything else goes through the `admin-members` EDGE
// FUNCTION, because creating a member means creating an auth user, which needs
// the service role, which must never reach the browser. A member calling any of
// the writes gets a 403 from the function's own gate — hiding the buttons is
// tidiness, never the security boundary.
//
// WHAT v1.0.1 ADDED. `listMembers()` answered three columns, so the client had
// no idea what anyone's username was, and quick capture's `@handle` could only
// match display names — typing the identifier the Members screen prints filed a
// free-text owner and assigned nobody (release smoke R4). The read now carries
// `username`, and lib/capture/parse.ts matches it above every fuzzy tier.
//
// ERRORS ARE i18n KEYS, the api/tracks.ts convention. The edge function answers
// in English sentences (it has no locale), so nothing maps its prose through —
// an untranslated sentence in an RTL layout is the exact failure the key
// convention exists to prevent. The English text is logged, not shown.
//
// WHAT WAVE 4 ADDED. v2 of the function answered with prose and a status and
// nothing else, so `edgeErrorKey()` could only distinguish 401 from 403 and
// every real failure — a username already taken, the last admin, a self-demote
// — collapsed into "Something went wrong". v3 emits a machine `code` beside the
// sentence and ADMIN_ERROR_KEYS below turns it into a `members.err*` key, which
// is what lets the Members page say the one thing the admin needs to hear. The
// status mapping stays underneath it: a gateway error page, or a token this
// build has never heard of, still resolves to something readable.
//
// ── WHAT WAVE B ADDED, AND WHY IT DOES NOT GO THROUGH THE FUNCTION ─────────
//
// A ROLE ASSIGNMENT WRITES `profiles.role_id` AND NOTHING ELSE. Not the legacy
// `profiles.role` text beside it, and not the two together — writing both would
// be the bug rather than the fix.
//
// 0025 keeps the text column and keeps it DERIVED. `profiles_role_sync()` is a
// BEFORE INSERT OR UPDATE trigger whose last act is
// `new.role := case when new.role_id = <the system admin role> then 'admin'
// else 'member' end` (0025:548), so role_id is the source of truth and the text
// is a mirror the database maintains inside the same statement. A client that
// wrote both would be racing the trigger for a column the trigger is about to
// overwrite — and on the one path where the two could disagree (a custom role
// such as Director, which is neither system role) the client's guess would be
// the wrong one. Writing role_id alone is exactly what keeps `is_admin()` in the
// database and `useIsAdmin()` over the cached profile answering the same
// question.
//
// THAT IS ALSO WHY `setMemberRole()` BELOW IS NOT THE CALL FOR THIS. It posts to
// the edge function's `set-role`, whose body IS the legacy text and whose
// vocabulary is therefore exactly two words: it can say Admin and Member and
// cannot say Director, which is the whole reason 0025 exists. It stays, because
// the Members screen falls back to it on a project where 0025 has not been
// applied yet and no `roles` table exists to pick from.
//
// AND THE WRITE READS BACK WHAT PERSISTED. 0025's GUARD 2 REVERTS rather than
// raising — `new.role_id := old.role_id` (0025:855) — so a refused self-move
// comes back as a 200 with the row unmoved, deliberately, because RLS is
// row-level and a raise would turn a member's legitimate `locale` save into a
// hard error. A caller that trusted its own request would render a role the
// database does not hold. `setMemberRoleId()` therefore returns the PERSISTED
// row and the caller settles on that, never on what it asked for.
//
// ── AND `position`, WHICH IS DISPLAY ONLY AND GATES NOTHING ────────────────
//
// `profiles.position` IS A JOB TITLE SOMEBODY TYPED AND NOTHING ELSE. 0025's own
// column comment says it (0025:483) and this module repeats it because the
// temptation is real: with eighteen people and seven Associate Directors, a
// string that says "Executive Director, UHR" looks exactly like something a
// screen could branch on. It must never be. Seniority is a ROLE — a row in
// `roles` with permission keys attached — and "Business Operations & Product
// Director (Delegation)" is precisely the string a title parser would read as
// two ranks, or as none. Nothing in this file, and nothing downstream of it,
// may derive a capability from this value.
//
// THE WRITE IS A PLAIN `profiles` UPDATE, NOT A FIFTH EDGE ACTION, for the same
// reason `setMemberRoleId()` is: the column is an ordinary `profiles` column and
// nothing about it lives in `auth.users`.
//
// IT REVERTS RATHER THAN RAISING, exactly like role_id, and the caller has to
// know that. Two gates stand between this UPDATE and the stored value, and they
// are not the same gate:
//
//   RLS — `profiles_update` is `id = auth.uid() or is_admin()` (0009:165) and
//   0025 deliberately LEAVES IT THERE (0025:855). So somebody else's row needs
//   `is_admin()`, and a refusal there is a zero-row update, which surfaces below
//   as `errNotFound`.
//
//   THE TRIGGER — `guard_profile_role()` reverts the column outright unless the
//   writer holds `members.manage` (0025:1800): `new.position := old.position`.
//   Not an exception, not a 42501: a 200 whose row did not move, because
//   `profiles_update` also lets an ordinary member write their own row for
//   `locale` and a raise would turn that save into a hard error.
//
// The refusal the trigger performs is therefore INVISIBLE to any caller that
// trusts its own request. `setMemberPosition()` answers with the PERSISTED row
// and the caller compares — the same contract, and for the same reason, as
// `setMemberRoleId()` above.
//
// AND THE VALUE IS SCRUBBED BEFORE IT GOES. `stripInvisible()` rather than
// `stripIsolates()`, which is the wider of the two on purpose: this string is
// rendered after a separator ("Nawaf Alharbi · …"), so a paste out of Outlook
// carrying one U+200E is a value that is non-empty to every `=== ''` test and
// empty to every human, and the roster prints a name, a dot, and nothing.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { roleErrorKey } from './roles'
import { stripInvisible } from '../lib/bidi'
import { pgErrorKey } from '../lib/pgError'
import type { ClaimInput, UserRole } from '../types'

/**
 * A member as the UI consumes it. camelCase view-model over the snake_case
 * `profiles` row; `email` is optional because a plain member's read of
 * `profiles` does not include it and the admin page's does.
 *
 * `username` is null for accounts that sign in with a real email (the owner's
 * own), and set for accounts an admin predefined — those authenticate against a
 * synthetic `<username>@opstrack.internal` address that can receive no mail.
 *
 * `username` and `claimed` are OPTIONAL rather than nullable because a `Member`
 * can be assembled by a caller that did not ask. Absent means "not asked", null
 * means "asked, and this is an email account" — a distinction `| null` alone
 * would lose. `listMembers()` ALWAYS ANSWERS `username` (migration 0013), which
 * is what makes `@handle` capture resolve to the identifier people are actually
 * given; `claimed` stays admin-only, because it lives in `auth.users`' metadata
 * and only the service role can read it.
 */
export interface Member {
  id: string
  displayName: string
  role: UserRole
  email?: string | null
  username?: string | null
  /** False until the member has run the claim flow and set their own password. */
  claimed?: boolean
}

/**
 * One account as the MEMBERS ADMIN PAGE needs it, which is strictly more than
 * `Member`.
 *
 * A second interface rather than widening `Member` with eight optional fields:
 * `Member` is what fifteen call sites across the app consume to render an owner,
 * and every one of them would have had to start reasoning about whether
 * `lastSignInAt` happened to be loaded. This shape comes from exactly one
 * caller — `listMemberAccounts()` — and is complete by construction.
 *
 * The two flags at the bottom are HINTS FOR THE UI, never the boundary. The
 * function re-derives both server-side before it refuses anything; they exist so
 * a control that is going to be refused can be disabled with an explanation
 * instead of offered and then rejected.
 */
export interface MemberAccount {
  id: string
  displayName: string
  role: UserRole
  /** The real address, or the synthetic `<username>@opstrack.internal`. */
  email: string
  /** null for an account that signs in with a real address (the owner's). */
  username: string | null
  /** An email account is claimed by definition — it has no invite to redeem. */
  claimed: boolean
  createdAt: string
  lastSignInAt: string | null
  /** False when the profiles row is missing — a provisioning half-failure. */
  hasProfile: boolean
  /** When the outstanding invite dies. null once claimed, or if none is out. */
  inviteExpiresAt: string | null
  /** On the function's bootstrap allow-list: always an admin, never removable. */
  isBootstrapAdmin: boolean
  /** The signed-in admin's own row. */
  isSelf: boolean
}

/**
 * One roster row as `member_directory()` returns it. Narrow on purpose: four
 * columns, snake_case, exactly what the function declares.
 */
interface DirectoryRow {
  id: string
  display_name: string | null
  role: string
  /** Derived from the sign-in address; null for a real-email account. */
  username: string | null
}

/**
 * A minted invite, as it comes back from `create` or `reissue-code`.
 *
 * `code` IS A CREDENTIAL WITH A FOURTEEN-DAY LIFE. It is readable exactly once,
 * on the response that mints it, because the server keeps only an HMAC — there is
 * no "show it again" path anywhere, by design. Do not log it, do not persist it,
 * do not put it in a URL. The whole scheme rests on it existing in two places:
 * the admin's screen and the member's hand.
 *
 * `username` comes back from the server rather than being echoed from the
 * request so a reissue triggered by id (which is how the Members page does it)
 * still knows which username the code belongs to — the admin has to read both
 * halves aloud and the pair is useless split up.
 */
export interface Invite {
  username: string
  code: string
  /** ISO instant. The admin needs to say "use it before…" out loud. */
  expiresAt: string
}

/** The `list` action's row, snake_case as the function emits it. */
export interface AdminMemberRow {
  id: string
  email: string
  display_name: string | null
  role: string
  created_at: string
  last_sign_in_at: string | null
  has_profile: boolean
  username: string | null
  claimed: boolean
  invite_expires_at: string | null
  is_bootstrap_admin: boolean
  is_self: boolean
}

/**
 * The roster row → view-model boundary. Exported for its test, the
 * `toMemberAccount` convention: this is the only place the line gets drawn for
 * this shape.
 */
export function toMember(row: DirectoryRow): Member {
  return {
    id: row.id,
    // Never render a raw uuid at a user: an account whose profile row was
    // written before the display name was known still has to appear in the
    // owner picker as *something* selectable.
    displayName: row.display_name?.trim() || '',
    role: row.role === 'admin' ? 'admin' : 'member',
    // Kept even when blank-ish: '' would match nothing anyway, and null is what
    // every consumer already reads as "this account has no handle".
    username: row.username?.trim() || null,
  }
}

/**
 * Every provisioned member, ordered by display name, WITH their username.
 *
 * AN RPC RATHER THAN A SELECT ON `profiles`, and that is the whole point of
 * migration 0013. A username lives in `auth.users` — the account signs in as
 * `<username>@opstrack.internal` — and PostgREST cannot reach that schema at
 * all, so this read used to answer three columns and quick capture had no way
 * to resolve the `@handle` the Members screen prints (release smoke R4).
 * `member_directory()` is SECURITY DEFINER over that join, gated on the same
 * `is_member()` predicate as `profiles_select`, with execute revoked from anon.
 *
 * Ordered in SQL rather than in the store so the owner picker, the filter bar
 * and the digest all see the same order without three sorts. Empty names sort
 * first under Postgres' default collation, which is the honest place for them —
 * an unnamed account is a provisioning bug and should be visible.
 */
export async function listMembers(): Promise<ApiResult<Member[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.rpc('member_directory')
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: ((data ?? []) as DirectoryRow[]).map(toMember) }
}

/**
 * `admin-members`' machine codes, mapped to keys.
 *
 * Every token the function's `AdminCode` union can emit has an entry, and the
 * lookup falls back to `common.error` for one it does not — a client that has
 * been open in a tab since before a function deploy degrades to a generic
 * sentence rather than rendering a raw dot path.
 *
 * `forbidden` deliberately reuses `admin.errForbidden` rather than minting a
 * `members.*` twin: it is the same sentence the track and vocabulary admin
 * screens already show for the same reason.
 */
export const ADMIN_ERROR_KEYS: Record<string, string> = {
  not_signed_in: 'common.notSignedIn',
  forbidden: 'admin.errForbidden',
  invalid_body: 'common.error',
  invalid_username: 'members.errUsernameInvalid',
  username_taken: 'members.errUsernameTaken',
  invalid_email: 'members.errEmailInvalid',
  email_taken: 'members.errEmailTaken',
  display_name_required: 'members.errNameRequired',
  not_found: 'members.errNotFound',
  email_account: 'members.errEmailAccount',
  self_delete: 'members.errSelfDelete',
  self_demote: 'members.errSelfDemote',
  last_admin: 'members.errLastAdmin',
  bootstrap_admin: 'members.errBootstrapAdmin',
  no_pepper: 'members.errNoPepper',
  server_error: 'common.error',
  unknown_action: 'common.error',
}

/**
 * The edge function's failure, mapped to a key.
 *
 * supabase-js collapses every non-2xx into a FunctionsHttpError whose message is
 * the constant "Edge Function returned a non-2xx status code"; the status and
 * the JSON body are reachable only through `.context`, the raw Response. THE
 * `.clone()` IS LOAD-BEARING and is the showtrackr unwrap: a Response body is a
 * one-shot stream, so reading `ctx.json()` directly would consume the body that
 * supabase-js may still hold a reference to, and a second reader — here, or in a
 * caller that wants to log the raw text — gets a TypeError instead of the
 * payload. Cloning first costs one buffer and makes the read repeatable.
 *
 * Kept separate from store/auth.ts's version of the same dig, which serves the
 * claim flow and returns a translated sentence rather than a key; a shared
 * helper would have to serve both shapes badly.
 */
async function edgeErrorKey(error: unknown): Promise<string> {
  const err = error as { name?: string; context?: unknown }
  // No response at all: DNS, TLS, an offline device. Nothing was refused, so
  // saying "forbidden" would send an admin looking for a permission problem.
  if (err.name === 'FunctionsFetchError') return 'members.errNetwork'
  const ctx = err.context
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown; code?: unknown }
      // Logged, never rendered: the function answers in English and this app has
      // an Arabic half. A bug report needs the sentence; the user does not.
      if (typeof body.error === 'string') console.warn('[members] edge function:', body.error)
      if (typeof body.code === 'string' && body.code in ADMIN_ERROR_KEYS) {
        return ADMIN_ERROR_KEYS[body.code]
      }
    } catch {
      // A gateway HTML error page tells us nothing worth logging.
    }
    if (ctx.status === 401) return 'common.notSignedIn'
    if (ctx.status === 403) return 'admin.errForbidden'
  }
  return 'common.error'
}

/** One `admin-members` call, guarded and error-mapped. */
async function invokeAdmin<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.functions.invoke('admin-members', { body })
  if (error) return fail(await edgeErrorKey(error))
  return { ok: true, data: data as T }
}

/**
 * Every ACCOUNT, with the admin-only facts `profiles` cannot answer.
 *
 * A different endpoint from `listMembers()` and deliberately so. `username`,
 * `claimed` and `last_sign_in_at` live in `auth.users`, which PostgREST cannot
 * reach at all — no view, no policy, no join. The service role is the only
 * principal that can read them, so the only way to a Members page is through
 * the function. `listMembers()` stays the app-wide read: every owner picker in
 * the app wants a name and a role, not a sign-in history.
 *
 * Sorted here rather than in the function because the order is a UI decision.
 * PENDING INVITES FIRST: they are the only rows on this screen that are waiting
 * on the admin, and burying one alphabetically between two claimed accounts is
 * how a member ends up unable to sign in for a week. Everything else is by
 * display name, with `localeCompare` so Arabic names sort as Arabic rather than
 * by code point.
 */
export async function listMemberAccounts(): Promise<ApiResult<MemberAccount[]>> {
  const result = await invokeAdmin<{ members: AdminMemberRow[] }>({ action: 'list' })
  if (!result.ok) return result
  return { ok: true, data: sortMemberAccounts((result.data.members ?? []).map(toMemberAccount)) }
}

/**
 * The snake_case → camelCase boundary for one account row.
 *
 * Exported for its test, the api/notifications.ts convention: this is the only
 * place the line gets drawn for this shape, and `displayName`'s fallback chain
 * is the part worth pinning — an account whose profiles row is missing has a
 * null display name, and rendering an empty string in a roster is how a member
 * becomes invisible to the admin who has to fix them.
 */
export function toMemberAccount(row: AdminMemberRow): MemberAccount {
  return {
    id: row.id,
    // Name, then handle, then address. Never a raw uuid and never blank: the
    // one row that most needs to be clickable is the half-provisioned one.
    displayName: row.display_name?.trim() || row.username || row.email,
    role: row.role === 'admin' ? 'admin' : 'member',
    email: row.email,
    username: row.username,
    claimed: row.claimed,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    hasProfile: row.has_profile,
    inviteExpiresAt: row.invite_expires_at,
    isBootstrapAdmin: row.is_bootstrap_admin,
    isSelf: row.is_self,
  }
}

/**
 * Pending invites first, then by display name. Sorts IN PLACE and returns the
 * same array — the caller always owns a freshly mapped one.
 */
export function sortMemberAccounts(rows: MemberAccount[]): MemberAccount[] {
  const pending = (row: MemberAccount): number => (row.username && !row.claimed ? 0 : 1)
  return rows.sort(
    (a, b) =>
      pending(a) - pending(b) ||
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  )
}

/* ───────────────── roles as data: role_id and position (0025) ──────────── */

/**
 * What `profiles` knows about one account that `auth.users` cannot: which ROLE
 * it holds, and the job title printed beside its name.
 *
 * A THIRD SHAPE RATHER THAN FIELDS ON `MemberAccount`, because the two come from
 * different principals and can arrive apart. `MemberAccount` is the edge
 * function's answer over `auth.users`; this is a PostgREST select on `profiles`,
 * and on a project where 0025 has not been applied the second read fails with a
 * 42703 while the first is perfectly fine. Merged into one interface, that
 * partial failure would take the whole roster down with it.
 *
 * `role` is the LEGACY text column and is carried on purpose, for the reason
 * api/roles.ts's `ProfileRoleRef` carries it: `has_perm()` falls back to it when
 * `role_id` is null (0025:400), so a holder count that ignored it would disagree
 * with the database exactly on the half-provisioned rows where it matters.
 */
export interface MemberRoleRef {
  id: string
  /** Legacy text, derived by `profiles_role_sync()`. Never written from here. */
  role: string
  /** null only on a row that predates the backfill. See `has_perm()`'s fallback. */
  roleId: string | null
  /** Job title. FREE TEXT, DISPLAY ONLY (0025:301) — it gates nothing, ever. */
  position: string
}

/** The `profiles` row as PostgREST emits it for the two columns 0025 added. */
interface ProfileRoleRow {
  id: string
  role: string | null
  role_id: string | null
  position: string | null
}

/**
 * The `profiles` row → view-model boundary, exported for its test on the
 * `toMemberAccount` convention.
 *
 * `position` is `not null default ''` in the schema, so the `?? ''` is not
 * defensiveness about the column — it is about the ROW being absent from an
 * older cached response shape, and about a value of whitespace, which renders as
 * a name followed by a separator and nothing after it.
 */
export function toMemberRoleRef(row: ProfileRoleRow): MemberRoleRef {
  return {
    id: row.id,
    role: row.role === 'admin' ? 'admin' : 'member',
    roleId: row.role_id,
    position: row.position?.trim() ?? '',
  }
}

/**
 * Which role each account holds, and what it says under their name.
 *
 * A SELECT ON `profiles`, not a fifth action on the edge function. Both columns
 * are ordinary `profiles` columns behind `profiles_select = is_member()`
 * (0009:157) — nothing here lives in `auth.users`, so the function's monopoly
 * does not apply and a round trip through the service role would buy nothing.
 *
 * ORDERLESS on purpose. The caller already has the roster in the order it wants
 * (`sortMemberAccounts`) and joins this in by id; sorting the same eighteen rows
 * a second time would only invite the two orders to drift.
 */
export async function listMemberRoleRefs(): Promise<ApiResult<MemberRoleRef[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.from('profiles').select('id, role, role_id, position')
  if (error) return fail(roleErrorKey(error))
  return { ok: true, data: ((data ?? []) as ProfileRoleRow[]).map(toMemberRoleRef) }
}

/**
 * Move one account into one role — the write the Director role was missing.
 *
 * WRITES `role_id` AND NOTHING ELSE, and answers with the row the database kept.
 * Both halves are argued in this file's header; the short version is that
 * `profiles.role` is a mirror the trigger maintains, and that 0025's GUARD 2
 * refuses a self-escalation by REVERTING rather than raising, so the only honest
 * report of what happened is the row that came back.
 *
 * `maybeSingle()`, never `single()`. Zero rows is a REACHABLE state here and not
 * an error worth its own vocabulary: an account whose `profiles` row never got
 * written (the roster's "No profile row" pill) matches nothing, and `single()`
 * would answer PGRST116 — "JSON object requested, multiple (or no) rows
 * returned" — which is not a sentence any admin can act on. `errNotFound` is,
 * and it is the same key the edge function's own `not_found` resolves to.
 */
export async function setMemberRoleId(
  id: string,
  roleId: string,
): Promise<ApiResult<MemberRoleRef>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('profiles')
    .update({ role_id: roleId })
    .eq('id', id)
    .select('id, role, role_id, position')
    .maybeSingle()
  if (error) return fail(roleErrorKey(error))
  if (!data) return fail('members.errNotFound')
  return { ok: true, data: toMemberRoleRef(data as ProfileRoleRow) }
}

/**
 * What a typed position becomes on its way to the column — the ONE definition,
 * shared by the writer and by every caller that has to ask "did it move?".
 *
 * Exported and used on both sides deliberately. The revert this write can suffer
 * is detected by comparing what came back against what was asked for, and if the
 * caller compared the RAW input it would report a refusal every time somebody
 * typed a trailing space. Two normalisations would be two answers.
 *
 * `stripInvisible`, not `stripIsolates`: the header argues it. A value made
 * entirely of invisible format characters must come out as the empty string,
 * because the roster prints this after a `·` and "a name, a dot, and nothing" is
 * the failure the trim on the read side (`toMemberRoleRef`) already guards.
 */
export function normalizePosition(value: string): string {
  return stripInvisible(value).trim()
}

/**
 * Set the job title printed beside one person's name.
 *
 * DISPLAY ONLY. It gates nothing here and must gate nothing anywhere — see the
 * header, and 0025's own comment on the column.
 *
 * ANSWERS WITH THE PERSISTED ROW, never with the requested value, because
 * `guard_profile_role()` reverts rather than raising for a writer without
 * `members.manage` (0025:1800). A caller must compare `data.position` against
 * the `normalizePosition()` of what it sent and treat inequality as the refusal
 * it is; success here means "the statement ran", not "the title changed".
 *
 * `maybeSingle()` and `errNotFound` for `setMemberRoleId()`'s reason exactly: an
 * account whose `profiles` row was never written matches nothing, and PGRST116
 * is not a sentence any admin can act on. It is also what an RLS refusal on
 * somebody else's row looks like from here — zero rows, no error — and
 * "reload the list" is the right advice for both.
 */
export async function setMemberPosition(
  id: string,
  position: string,
): Promise<ApiResult<MemberRoleRef>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('profiles')
    .update({ position: normalizePosition(position) })
    .eq('id', id)
    .select('id, role, role_id, position')
    .maybeSingle()
  if (error) return fail(roleErrorKey(error))
  if (!data) return fail('members.errNotFound')
  return { ok: true, data: toMemberRoleRef(data as ProfileRoleRow) }
}

/**
 * Promote or demote, in the legacy two-word vocabulary.
 *
 * SUPERSEDED BY `setMemberRoleId()` WHEREVER `roles` CAN BE READ, and kept for
 * the case where it cannot: a project with 0025 unapplied has no roles to pick
 * from, and this is then the only way to make somebody an admin. See the header.
 *
 * Both refusals the caller has to expect — no self-demotion, no removing the
 * last admin — are the FUNCTION's, re-derived there from the live profiles
 * table. The Members page disables the same two controls so nobody clicks into a
 * dead end, and this call is what makes that decoration rather than security.
 */
export async function setMemberRole(id: string, role: UserRole): Promise<ApiResult<null>> {
  const result = await invokeAdmin<{ ok: boolean }>({ action: 'set-role', userId: id, role })
  if (!result.ok) return result
  return { ok: true, data: null }
}

/**
 * Create an email/OTP member. Retained for real-email accounts (the owner's);
 * username accounts go through createUsernameMember instead.
 *
 * The function answers `{ok, id}` and nothing else on this path, so the Member
 * is assembled from what was sent — there is no second round trip to read back
 * a row this caller already knows every field of.
 */
export async function createMember(
  email: string,
  displayName: string,
  role: UserRole,
): Promise<ApiResult<Member>> {
  const result = await invokeAdmin<{ id: string }>({
    action: 'create',
    email: email.trim().toLowerCase(),
    displayName: displayName.trim(),
    role,
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: {
      id: result.data.id,
      displayName: displayName.trim(),
      role,
      email: email.trim().toLowerCase(),
      username: null,
      // An email account is claimed BY DEFINITION — it has no invite to redeem.
      claimed: true,
    },
  }
}

/**
 * Create a predefined username account and mint its ONE-TIME invite code.
 *
 * The code is returned exactly once, here, for the admin to hand over in
 * person — it is stored hashed, so there is no "show it again" path. Usernames
 * are guessable by construction; the code, not the username, is what stops
 * someone else claiming an account first.
 *
 * The caller must not log or persist `inviteCode`. It is a credential with a
 * 14-day life, and the whole design rests on it existing in exactly two places:
 * the admin's screen and the member's hand.
 */
export async function createUsernameMember(
  username: string,
  displayName: string,
  role: UserRole,
): Promise<ApiResult<{ member: Member; invite: Invite }>> {
  const name = username.trim().toLowerCase()
  const result = await invokeAdmin<{
    id: string
    username: string
    inviteCode: string
    expiresAt: string
  }>({
    action: 'create',
    username: name,
    displayName: displayName.trim(),
    role,
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: {
      member: {
        id: result.data.id,
        // The function defaults a blank display name to the username rather
        // than rejecting; mirror that here so the two never disagree.
        displayName: displayName.trim() || result.data.username,
        role,
        email: null,
        username: result.data.username,
        claimed: false,
      },
      invite: {
        username: result.data.username,
        code: result.data.inviteCode,
        expiresAt: result.data.expiresAt,
      },
    },
  }
}

/**
 * Reissue an invite code — THE password-reset path for username accounts.
 *
 * A synthetic @opstrack.internal address cannot receive a reset mail, so there
 * is no self-service reset and pretending otherwise would strand a member. The
 * admin reissues, hands over the new code, and the member re-runs the claim
 * flow with a new password. Reissuing also clears the account's failure
 * counter, so a member locked out by someone else's guessing is not stuck.
 */
export async function reissueInvite(id: string): Promise<ApiResult<Invite>> {
  const result = await invokeAdmin<{ username: string; inviteCode: string; expiresAt: string }>({
    action: 'reissue-code',
    userId: id,
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: {
      username: result.data.username,
      code: result.data.inviteCode,
      expiresAt: result.data.expiresAt,
    },
  }
}

export async function deleteMember(id: string): Promise<ApiResult<null>> {
  const result = await invokeAdmin<{ ok: boolean }>({ action: 'delete', userId: id })
  if (!result.ok) return result
  return { ok: true, data: null }
}

/**
 * `claim-account`'s machine-readable failure codes, mapped to keys.
 *
 * `claim.errPasswordShort` is the one value here that carries an interpolation
 * token (`{min}`), so a caller rendering it must pass one:
 * `t(result.error, { min: MIN_PASSWORD_LENGTH })`. `t()` ignores vars a key does
 * not use, so passing it unconditionally is safe for every other branch.
 */
const CLAIM_ERROR_KEYS: Record<string, string> = {
  already_claimed: 'claim.errAlreadyClaimed',
  invalid_invite: 'claim.errInviteInvalid',
  invalid_request: 'claim.errInviteInvalid',
  weak_password: 'claim.errPasswordShort',
  rate_limited: 'claim.errRateLimited',
}

/**
 * The claim-account edge function. Verifies username + one-time code with the
 * service role, sets the member's chosen password, marks the account claimed.
 *
 * UNAUTHENTICATED by necessity — the caller has no session yet, which is the
 * entire point of claiming. The invite code is the only credential.
 *
 * This is the ApiResult-shaped sibling of `store/auth.claimAccount()`, which
 * returns a translated sentence and then signs the member in. Both exist by
 * contract (WAVE1-ADDENDUM §2.4): the sign-in form has no key resolver, and a
 * screen that only provisions — Wave 4's Members page verifying a code on a
 * member's behalf — wants the key. Neither wraps the other, because the auth
 * one's job includes the sign-in that follows and this one's ends at the claim.
 */
export async function claimAccountRequest(input: ClaimInput): Promise<ApiResult<null>> {
  if (!supabase) return notConfigured()
  const username = input.username.trim().toLowerCase()
  const inviteCode = input.inviteCode.trim()
  if (!username || !inviteCode) return fail('claim.errInviteInvalid')

  const { error } = await supabase.functions.invoke('claim-account', {
    body: { username, inviteCode, password: input.password },
  })
  if (!error) return { ok: true, data: null }

  const err = error as { name?: string; context?: unknown }
  if (err.name === 'FunctionsFetchError') return fail('claim.errNetwork')
  let code = ''
  if (err.context instanceof Response) {
    try {
      const body = (await err.context.clone().json()) as { code?: unknown }
      if (typeof body.code === 'string') code = body.code
    } catch {
      // Non-JSON body: nothing to learn, fall through to the generic key.
    }
  }
  // The CODE, never the code: which failure happened is useful in a bug report;
  // the invite string and the password never touch a log line.
  console.warn('[members] claim failed:', code || 'unknown')
  return fail(CLAIM_ERROR_KEYS[code] ?? 'claim.errGeneric')
}
