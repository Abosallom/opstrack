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

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconKey, IconShieldCheck, IconUser, IconUsers } from '../../components/icons'
import { confirm } from '../../components/Confirm'
import { EmptyState, Skeleton } from '../../components/shared'
import { toast } from '../../components/toast'
import {
  createUsernameMember,
  deleteMember,
  listMemberAccounts,
  reissueInvite,
  setMemberRole,
  type Invite,
  type MemberAccount,
} from '../../api/members'
import { formatRelativeTime, formatTimestamp } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { useAuth } from '../../store/auth'
import { invalidateMembers } from '../../store/members'
import type { UserRole } from '../../types'
import './members.css'

/**
 * Cosmetic admin gate. The real authority is the `admin-members` function's own
 * JWT check — every write on this screen answers 403 for a member whatever this
 * returns, and gate (e) of the Wave-4 plan proves it with curl. Hiding the
 * screen only avoids offering an action that cannot succeed.
 *
 * `?shell` mirrors App.tsx's dev-only preview flag. Without it these screens are
 * unreachable in a build with no Supabase project, which is exactly where the
 * layout and the RTL mirror get reviewed. `import.meta.env.DEV` is the literal
 * `false` in a production build, so Vite tree-shakes the whole expression out
 * and this cannot become a way in.
 *
 * The fourth copy of this hook (TracksAdmin, TrackEditor, VocabularyAdmin). It
 * stays a copy because §1.0.4 forbids reaching into another worker's file to
 * extract one; lifting all four into `lib/adminGate.ts` is in the handoff note.
 */
function useIsAdmin(): boolean {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return true
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

/** Mirrors USERNAME_RE in supabase/functions/admin-members/index.ts. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/

const DISPLAY_NAME_MAX = 80
const USERNAME_MAX = 32

interface FormState {
  username: string
  displayName: string
  role: UserRole
}

const EMPTY_FORM: FormState = { username: '', displayName: '', role: 'member' }

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
    const result = await listMemberAccounts()
    if (!alive.current) return
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
    setForm(EMPTY_FORM)
    setSubmitted(false)
    setFormOpen(false)
    invalidateMembers()
    void load()
  }

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
        </div>
      )}

      {!loading && !errorKey && rows.length > 0 && (
        <ul className="mem-list" aria-label={t('route.members')}>
          {rows.map((row) => {
            const busy = busyId === row.id
            const isAdminRow = row.role === 'admin'
            const RoleIcon = isAdminRow ? IconShieldCheck : IconUser
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
            // Order matters and it is the reading order of the buttons: the
            // role control sits before Delete, so its reason does too.
            const blockReasons = [...new Set([demoteBlock, deleteBlock])].filter(
              (key): key is string => key !== null,
            )

            return (
              <li key={row.id} className="card card-tight mem-row">
                <div className="mem-main">
                  <span className={`mem-icon${isAdminRow ? ' is-admin' : ''}`} aria-hidden="true">
                    <RoleIcon size={18} />
                  </span>
                  <div className="mem-text">
                    <p className="mem-name">
                      {row.displayName}
                      {row.isSelf && <span className="pill mem-you">{t('members.you')}</span>}
                    </p>
                    {/* The handle is DATA — a username or an address — so no
                        t(). bdi keeps its Latin run intact inside an Arabic
                        column without re-aligning the line. */}
                    <p className="mem-handle">
                      <bdi>{row.username ? `@${row.username}` : row.email}</bdi>
                    </p>
                    <p className="mem-tags">
                      <span className={`pill${isAdminRow ? ' info' : ''}`}>
                        {t(isAdminRow ? 'settings.roleAdmin' : 'settings.roleMember')}
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

                  {isAdminRow ? (
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
    </div>
  )
}
