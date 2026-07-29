// Data access for members — the read surface every owner control needs, plus
// the four admin writes that can only happen behind the service role.
//
// Members land in WAVE 1, not Wave 4. Wave 4 adds the admin PAGE; the read is
// needed the moment OwnerBadge and the owner picker exist, and
// `profiles_select = is_member()` means it already works against the live
// project today.
//
// THE READ AND THE WRITES GO TO DIFFERENT PLACES, on purpose. `listMembers()`
// is a plain PostgREST select on `profiles`. Everything else goes through the
// `admin-members` EDGE FUNCTION, because creating a member means creating an
// auth user, which needs the service role, which must never reach the browser.
// A member calling any of the writes gets a 403 from the function's own gate —
// hiding the buttons is tidiness, never the security boundary.
//
// ERRORS ARE i18n KEYS, the api/tracks.ts convention. The edge function answers
// in English sentences (it has no locale), so `edgeErrorKey()` maps its STATUS
// to a key rather than passing its prose through — an untranslated sentence in
// an RTL layout is the exact failure the key convention exists to prevent. The
// English text is logged, not shown; Wave 4's Members page adds the specific
// `members.*` keys once it has screens to hang them on.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
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
 * `username` and `claimed` are OPTIONAL rather than nullable because
 * `listMembers()` genuinely cannot know them: they live in `auth.users`'
 * metadata, which PostgREST cannot reach. Absent means "not asked", null means
 * "asked, and this is an email account" — a distinction the Members page needs
 * and a distinction `undefined` would lose if these were declared `| null`.
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

/** The `profiles` columns this module reads. Narrow on purpose. */
interface ProfileRow {
  id: string
  display_name: string | null
  role: string
}

function toMember(row: ProfileRow): Member {
  return {
    id: row.id,
    // Never render a raw uuid at a user: an account whose profile row was
    // written before the display name was known still has to appear in the
    // owner picker as *something* selectable.
    displayName: row.display_name?.trim() || '',
    role: row.role === 'admin' ? 'admin' : 'member',
  }
}

/**
 * Every provisioned member, ordered by display name.
 *
 * Ordered in SQL rather than in the store so the owner picker, the filter bar
 * and the digest all see the same order without three sorts. Empty names sort
 * first under Postgres' default collation, which is the honest place for them —
 * an unnamed account is a provisioning bug and should be visible.
 */
export async function listMembers(): Promise<ApiResult<Member[]>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .order('display_name', { ascending: true })
  if (error) return fail(pgErrorKey(error))
  return { ok: true, data: ((data ?? []) as ProfileRow[]).map(toMember) }
}

/**
 * The edge function's HTTP status, mapped to a key.
 *
 * supabase-js collapses every non-2xx into a FunctionsHttpError whose message is
 * the constant "Edge Function returned a non-2xx status code"; the status and
 * the JSON body are reachable only through `.context`, the raw Response. This is
 * the same dig store/auth.ts does for the claim flow — kept separate rather than
 * shared because that one reads a machine `code` field this endpoint does not
 * emit, and a shared helper would have to serve both shapes badly.
 */
async function edgeErrorKey(error: unknown): Promise<string> {
  const err = error as { name?: string; context?: unknown }
  if (err.name === 'FunctionsFetchError') return 'common.error'
  const ctx = err.context
  if (ctx instanceof Response) {
    // Logged, never rendered: the function answers in English and this app has
    // an Arabic half. A bug report needs the sentence; the user does not.
    try {
      const body = (await ctx.clone().json()) as { error?: unknown }
      if (typeof body.error === 'string') console.warn('[members] edge function:', body.error)
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
): Promise<ApiResult<{ member: Member; inviteCode: string }>> {
  const name = username.trim().toLowerCase()
  const result = await invokeAdmin<{ id: string; username: string; inviteCode: string }>({
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
      inviteCode: result.data.inviteCode,
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
export async function reissueInvite(id: string): Promise<ApiResult<{ inviteCode: string }>> {
  const result = await invokeAdmin<{ inviteCode: string }>({
    action: 'reissue-code',
    userId: id,
  })
  if (!result.ok) return result
  return { ok: true, data: { inviteCode: result.data.inviteCode } }
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
