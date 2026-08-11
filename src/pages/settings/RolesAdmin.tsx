// Settings › Roles & permissions (/settings/roles) — where Aziz invents a role
// and decides what it can do.
//
// WHAT THIS SCREEN IS FOR, in one sentence: the workspace became eighteen people
// and nine of them were named for elevated access, which the two hardcoded roles
// — `admin` and `member` — cannot express. Migration 0025 makes roles data; this
// is the only place that writes them. `is_admin()` is now a thin alias over
// `has_perm('workspace.admin')`, so what is ticked here is what 183 policy call
// sites answer.
//
// ═══ THE HONESTY REQUIREMENT, AND IT IS THE MOST IMPORTANT THING HERE ═══
//
// Every switch carries a line saying what it ACTUALLY lets somebody do, in
// concrete terms — "create and delete accounts and change anyone's role", never
// "manage members". Those lines live beside their keys in api/roles.ts, so the
// catalogue and its explanations cannot drift apart, and each key also carries
// its REACH: `workspace.admin` and `members.manage` are enforced today,
// `structure.edit`, `vocab.edit` and `capture.write` are declared and not yet
// read by any policy. Rendering five switches as though they were equally live
// would be a lie, so the screen prints the difference on the switch itself.
//
// And the screen says, in its own words, that the LIST is fixed by what the app
// enforces (`roles.fixedTitle` / `roles.fixedBody`). Aziz asked for custom
// permissions; the true half of that promise is custom ROLES. A permission is a
// promise the code keeps, and a switch nobody reads would grant nothing while
// telling him it had — which is the one outcome worse than not offering it.
//
// ═══ THE LAST-ADMIN GUARD IS VISIBLE, NOT MERELY ENFORCED ═══
//
// 0025's GUARD 1 refuses, at the database, any write that takes the workspace
// from "somebody holds workspace.admin" to "nobody does". A 42501 surfacing as a
// red toast AFTER the switch has animated across is a worse experience than a
// switch that will not move and says why — and the state it prevents is
// unrecoverable from inside the app: no admin remains to restore the grant, and
// the members edge function refuses everyone because its own gate reads a column
// that now says 'member'. So the rule is computed client-side first
// (`revokeWouldOrphanWorkspace`, api/roles.ts, pure and unit-tested), the switch
// is marked aria-disabled, and the reason is printed under it — not on hover,
// not in a title attribute, in the flow of the page.
//
// ARIA-DISABLED RATHER THAN `disabled`, for that one switch. A `disabled`
// button leaves the tab order, so a keyboard reader would meet a control they
// cannot reach and an explanation they may never land on. aria-disabled keeps it
// focusable; activating it refuses and announces the reason in the live region.
// The busy state — a write in flight — uses real `disabled`, because there is
// nothing to explain and the control comes back in a moment.
//
// READS THROUGH api/ DIRECTLY, not through store/config, for TracksAdmin's and
// GroupsAdmin's reason: this screen must see its own writes on the next paint,
// and roles are read by exactly one screen so caching them app-wide would only
// put a second, staler answer to "what am I allowed to do" into the tree.
//
// NO REORDER CONTROLS, unlike GroupsAdmin. `roles.sort_order` exists and new
// roles land at the end of it, but 0025 ships no `reorder_roles` RPC — group
// order is written by one, and rewriting a column row by row from a client would
// emit one audit row per role per drag on the most consequential table in the
// product. Recorded in the handoff; it is a migration, not a screen change.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconShieldCheck } from '../../components/icons'
import { EmptyState, Skeleton } from '../../components/shared'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import {
  PERMISSIONS,
  ROLE_KEY_RE,
  ROLE_NAME_MAX,
  adminHolderCount,
  createRole,
  deleteRole,
  grants,
  holderCounts,
  listProfileRoles,
  listRolePermissions,
  listRoles,
  revokeWouldOrphanWorkspace,
  setRolePermission,
  updateRole,
  type ProfileRoleRef,
  type Role,
  type RolePermission,
} from '../../api/roles'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { useAuth } from '../../store/auth'
import './roles.css'

/**
 * Cosmetic admin gate. The real authority is `has_perm('members.manage')` in the
 * `roles` / `role_permissions` policies (0025) — every write on this screen
 * fails with 42501 for anybody else, whatever this returns; hiding the screen
 * only avoids offering an action that cannot succeed.
 *
 * THE SEVENTH COPY OF THIS HOOK (TracksAdmin, TrackEditor, VocabularyAdmin,
 * Members, Terminology, GroupsAdmin). Copied rather than shared for the reason
 * GroupsAdmin states: the one place it could live is `store/auth.ts`, and
 * `src/lib/**` may not import a store. Flagged in the handoff.
 *
 * ⚠ IT ASKS THE WRONG QUESTION BY EXACTLY ONE ROLE, and that is worth writing
 *   down rather than discovering later. The write gate on these two tables is
 *   `members.manage`; this hook reads `profiles.role`, which 0025 keeps derived
 *   from the SYSTEM role only. A custom role carrying members.manage WITHOUT
 *   workspace.admin would therefore be sent back to /settings by a screen its
 *   holder is allowed to use. Today that role does not exist — the seeded
 *   Director deliberately lacks members.manage, and only Admin carries it — so
 *   the gate is exactly right for the workspace as decided. Making it truthful
 *   means an async `has_perm` probe in store/auth, which is that file's change.
 *
 * `?shell` mirrors App.tsx's dev-only preview flag. `import.meta.env.DEV` is the
 * literal `false` in a production build, so Vite tree-shakes the whole
 * expression out and this cannot become a way in.
 */
function useIsAdmin(): boolean {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return true
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

/**
 * A role's name in the given locale, with `groups.groupLabelIn`'s fallback rule:
 * `name_ar` is `not null default ''`, so the test is for EMPTY, not null, and a
 * role nobody has translated shows its English name rather than a blank card.
 */
function roleLabelIn(role: Role, locale: Locale): string {
  if (locale === 'ar') return role.name_ar.trim() || role.name
  return role.name
}

/** The rename panel's draft. Never written until Save. */
interface Form {
  name: string
  nameAr: string
}

function formOf(role: Role): Form {
  return { name: role.name, nameAr: role.name_ar }
}

function dirty(a: Form, b: Form): boolean {
  return a.name !== b.name || a.nameAr !== b.nameAr
}

/** The create form's draft, including the one field that can never be edited. */
interface NewRole {
  key: string
  name: string
  nameAr: string
}

const EMPTY_NEW: NewRole = { key: '', name: '', nameAr: '' }

export default function RolesAdmin(): ReactElement {
  const locale = useLocale()
  const isAdmin = useIsAdmin()
  const roleLabel = useCallback((role: Role) => roleLabelIn(role, locale), [locale])

  const [roles, setRoles] = useState<Role[] | null>(null)
  const [perms, setPerms] = useState<RolePermission[]>([])
  const [profiles, setProfiles] = useState<ProfileRoleRef[]>([])
  const [errorKey, setErrorKey] = useState<string | null>(null)
  /** The role whose rename panel is open, and the draft it is editing. */
  const [editing, setEditing] = useState<{ id: string; form: Form } | null>(null)
  const [savedForm, setSavedForm] = useState<Form | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** `${roleId}:${permissionKey}` while its write is in flight. */
  const [toggling, setToggling] = useState<string | null>(null)
  const [creating, setCreating] = useState<NewRole | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [liveMessage, setLiveMessage] = useState('')

  const createId = useId()

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setErrorKey(null)
    // Three reads in parallel: none depends on another, and the last-admin guard
    // is unanswerable without all three — a screen that rendered the switches
    // before the holder counts landed would offer a revocation it cannot judge.
    const [roleResult, permResult, profileResult] = await Promise.all([
      listRoles(),
      listRolePermissions(),
      listProfileRoles(),
    ])
    if (!alive.current) return
    if (!roleResult.ok) {
      setErrorKey(roleResult.error)
      setRoles([])
      return
    }
    setRoles(roleResult.data)
    // A failure on either of the other two is NOT survivable in the way a
    // missing track list is: without the grants the switches would all read off,
    // and without the profiles the guard would compute "no admins" and refuse
    // nothing. Both cases surface as the page-level error rather than as a
    // half-rendered screen that looks authoritative.
    if (!permResult.ok) {
      setErrorKey(permResult.error)
      return
    }
    if (!profileResult.ok) {
      setErrorKey(profileResult.error)
      return
    }
    setPerms(permResult.data)
    setProfiles(profileResult.data)
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  // ---- derived -------------------------------------------------------------

  const counts = useMemo(() => holderCounts(profiles, roles ?? []), [profiles, roles])
  const admins = useMemo(
    () => adminHolderCount(profiles, roles ?? [], perms),
    [profiles, roles, perms],
  )

  // ---- permissions ---------------------------------------------------------

  async function togglePermission(role: Role, key: string, next: boolean): Promise<void> {
    const id = `${role.id}:${key}`
    if (toggling) return
    // Snapshot for the rollback. The exact previous rows, not a re-read: after a
    // failure the previous state is known precisely, and a re-read would also
    // discard any other switch the admin flipped while this one was in flight.
    const before = perms
    const after: RolePermission[] = perms.some(
      (p) => p.role_id === role.id && p.permission_key === key,
    )
      ? perms.map((p) =>
          p.role_id === role.id && p.permission_key === key ? { ...p, granted: next } : p,
        )
      : [...perms, { role_id: role.id, permission_key: key, granted: next }]

    // Optimistic: the switch is the whole interaction, and a control that waits
    // for a round trip before showing the value the reader chose reads as broken.
    setPerms(after)
    setToggling(id)
    const result = await setRolePermission(role.id, key, next)
    if (!alive.current) return
    setToggling(null)
    if (!result.ok) {
      setPerms(before)
      toast(t(result.error), { tone: 'error' })
      return
    }
    setPerms((current) =>
      current.map((p) =>
        p.role_id === role.id && p.permission_key === key ? result.data : p,
      ),
    )
    const meta = PERMISSIONS.find((p) => p.key === key)
    const message = t(next ? 'roles.granted' : 'roles.revoked', {
      permission: meta ? t(meta.labelKey) : key,
      name: roleLabel(role),
    })
    // Announced, not toasted: the reader is looking at the control that changed,
    // and a toast would cover the row beneath it. A screen reader hears which
    // permission moved on which role, which the switch's own state change does
    // not say.
    setLiveMessage(message)
  }

  /** The refusal, spoken rather than swallowed. */
  function refuseToggle(): void {
    setLiveMessage(t('roles.lastAdminReason'))
  }

  // ---- rename --------------------------------------------------------------

  const setField = useCallback((key: keyof Form, value: string): void => {
    setEditing((current) =>
      current ? { ...current, form: { ...current.form, [key]: value } } : current,
    )
  }, [])

  async function saveRole(role: Role): Promise<void> {
    if (!editing || editing.id !== role.id) return
    const name = editing.form.name.trim()
    if (name === '' || name.length > ROLE_NAME_MAX) {
      toast(t('roles.nameRequired'), { tone: 'error' })
      return
    }
    setBusyId(role.id)
    const result = await updateRole(role.id, { name, nameAr: editing.form.nameAr.trim() })
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      // result.error is an i18n KEY from roleErrorKey. t() returns an unknown
      // key verbatim, so even a path that still yields a sentence renders.
      toast(t(result.error), { tone: 'error' })
      return
    }
    setRoles((current) =>
      current ? current.map((row) => (row.id === role.id ? result.data : row)) : current,
    )
    setEditing(null)
    setSavedForm(null)
    toast(t('roles.saved', { name: roleLabel(result.data) }))
  }

  // ---- create --------------------------------------------------------------

  async function submitCreate(): Promise<void> {
    if (!creating) return
    const key = creating.key.trim().toLowerCase()
    const name = creating.name.trim()
    if (!ROLE_KEY_RE.test(key)) {
      toast(t('roles.errKeyShape'), { tone: 'error' })
      return
    }
    if (name === '' || name.length > ROLE_NAME_MAX) {
      toast(t('roles.nameRequired'), { tone: 'error' })
      return
    }
    setCreateBusy(true)
    const result = await createRole({ key, name, nameAr: creating.nameAr.trim() })
    if (!alive.current) return
    setCreateBusy(false)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setRoles((current) => (current ? [...current, result.data] : [result.data]))
    setCreating(null)
    const message = t('roles.created', { name: roleLabel(result.data) })
    setLiveMessage(message)
    toast(message)
  }

  // ---- delete --------------------------------------------------------------

  async function removeRole(role: Role): Promise<void> {
    const ok = await confirm({
      title: t('roles.deleteTitle', { name: roleLabel(role) }),
      body: t('roles.deleteBody'),
      confirmLabel: t('roles.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    setBusyId(role.id)
    const result = await deleteRole(role.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setRoles((current) => (current ? current.filter((row) => row.id !== role.id) : current))
    setPerms((current) => current.filter((p) => p.role_id !== role.id))
    const message = t('roles.deleted', { name: roleLabel(role) })
    setLiveMessage(message)
    toast(message)
  }

  if (!isAdmin) return <Navigate to="/settings" replace />

  const loading = roles === null

  return (
    <div className="rol">
      <div className="rol-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header already renders this route's title as
          the document h1, and a second copy is noise in the heading outline. */}
      <p className="rol-intro">{t('roles.subtitle')}</p>

      {/* THE STANDING NOTE. Above the list, before anything can be clicked. */}
      <div className="rol-fixed">
        <p className="rol-fixed-title">{t('roles.fixedTitle')}</p>
        <p className="rol-fixed-body">{t('roles.fixedBody')}</p>
      </div>

      {/* Polite, not assertive: every message here follows an action the reader
          just took deliberately, so it should queue behind whatever is being
          read rather than interrupt it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {loading && <Skeleton height={160} count={2} />}

      {!loading && errorKey && (
        <div className="card rol-error" role="alert">
          <p>{t(errorKey === 'common.error' ? 'roles.loadFailed' : errorKey)}</p>
          {/* The one failure this screen can diagnose precisely: PGRST205 means
              0025 has not been applied to this project, which is a runbook line
              rather than a fault. */}
          {errorKey === 'common.errMissingTable' && (
            <p className="rol-hint">{t('roles.missingTableHint')}</p>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !errorKey && roles.length === 0 && (
        <EmptyState
          icon={<IconShieldCheck size={30} />}
          title={t('roles.empty')}
          description={t('roles.emptyHint')}
        />
      )}

      {!loading && !errorKey && roles.length > 0 && (
        <>
          <p className="rol-summary">{t('roles.adminSummary', { count: admins })}</p>

          <ul className="rol-list" aria-label={t('roles.title')}>
            {roles.map((role) => {
              const open = editing?.id === role.id
              const busy = busyId === role.id
              const holders = counts.get(role.id) ?? 0
              // Always the OTHER language, never a repeat of the primary line.
              const altLang = locale === 'ar' ? 'en' : 'ar'
              const alt = (locale === 'ar' ? role.name : role.name_ar).trim()
              const secondary = alt && alt !== roleLabel(role) ? alt : ''
              // BOTH refusals are shown BEFORE the click, which is the whole
              // point: 0025 raises for each of them, and a guard the reader
              // meets only after acting teaches nothing.
              const deleteReason = role.is_system
                ? t('roles.deleteSystemReason')
                : holders > 0
                  ? t('roles.deleteInUseReason', { count: holders })
                  : ''
              const reasonId = `${createId}-why-${role.id}`
              // Grants this build does not know about — only reachable when the
              // database is ahead of the client, which is a real state for a tab
              // left open across a deploy.
              const unknown = perms.filter(
                (p) =>
                  p.role_id === role.id &&
                  p.granted &&
                  !PERMISSIONS.some((meta) => meta.key === p.permission_key),
              )

              return (
                <li key={role.id} className="card rol-role">
                  <div className="rol-head">
                    <div className="rol-head-text">
                      <p className="rol-name">{roleLabel(role)}</p>
                      {secondary && (
                        <p
                          className="rol-alt"
                          lang={altLang}
                          dir={altLang === 'ar' ? 'rtl' : 'ltr'}
                        >
                          {secondary}
                        </p>
                      )}
                      <p className="rol-meta">
                        <span className="pill tabular">
                          {t('roles.memberCount', { count: holders })}
                        </span>
                        {role.is_system && <span className="pill info">{t('roles.system')}</span>}
                        <span className="muted">{t('roles.keyLabel')}</span>
                        {/* The machine name, LTR and monospace in every locale:
                            it is an identifier, not a word. */}
                        <span className="rol-key">{role.key}</span>
                      </p>
                    </div>

                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-expanded={open}
                        disabled={busy}
                        onClick={() => {
                          if (open) {
                            setEditing(null)
                            setSavedForm(null)
                            return
                          }
                          const form = formOf(role)
                          setEditing({ id: role.id, form })
                          setSavedForm(form)
                        }}
                      >
                        {t(open ? 'roles.renameDone' : 'roles.rename')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busy || deleteReason !== ''}
                        aria-describedby={deleteReason ? reasonId : undefined}
                        onClick={() => void removeRole(role)}
                      >
                        {t('roles.delete')}
                      </button>
                    </div>
                  </div>

                  {/* The reason a disabled Delete is disabled, in the flow of
                      the page rather than in a tooltip. */}
                  {deleteReason && (
                    <p className="rol-hint" id={reasonId}>
                      {deleteReason}
                    </p>
                  )}

                  {open && editing && (
                    <div className="rol-edit">
                      <div className="rol-fields">
                        <div className="field">
                          <label className="field-label" htmlFor={`rol-name-${role.id}`}>
                            {t('roles.nameEn')}
                          </label>
                          <input
                            id={`rol-name-${role.id}`}
                            className="input"
                            lang="en"
                            dir="ltr"
                            maxLength={ROLE_NAME_MAX}
                            value={editing.form.name}
                            onChange={(e) => setField('name', e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label className="field-label" htmlFor={`rol-name-ar-${role.id}`}>
                            {t('roles.nameAr')}
                          </label>
                          {/* lang + dir on the field itself: an Arabic name
                              typed into an LTR box has its punctuation resolved
                              against the wrong paragraph direction WHILE it is
                              being typed. */}
                          <input
                            id={`rol-name-ar-${role.id}`}
                            className="input"
                            lang="ar"
                            dir="rtl"
                            maxLength={ROLE_NAME_MAX}
                            value={editing.form.nameAr}
                            onChange={(e) => setField('nameAr', e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="rol-hint">{t('roles.nameArHint')}</p>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={busy || editing.form.name.trim() === ''}
                          onClick={() => void saveRole(role)}
                        >
                          {t('roles.save')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setEditing(null)
                            setSavedForm(null)
                          }}
                        >
                          {t('roles.discard')}
                        </button>
                        {/* The badge is what makes Discard legible: "Discard"
                            with nothing changed is a control with no referent. */}
                        {savedForm !== null && dirty(editing.form, savedForm) && (
                          <span className="pill warn">{t('roles.unsaved')}</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="rol-perms">
                    <p className="rol-perms-title">{t('roles.permissions')}</p>
                    <p className="rol-perms-hint">{t('roles.permHint')}</p>
                    <div className="rol-perm-list">
                      {PERMISSIONS.map((meta) => {
                        const on = grants(perms, role.id, meta.key)
                        const blocked =
                          on &&
                          revokeWouldOrphanWorkspace(
                            role.id,
                            meta.key,
                            profiles,
                            roles,
                            perms,
                          )
                        const rowBusy = toggling === `${role.id}:${meta.key}`
                        const base = `${createId}-${role.id}-${meta.key}`
                        // Every line under the label DESCRIBES the switch: the
                        // effect, the "nothing reads this yet" note, and the
                        // refusal. Named individually and joined, so a screen
                        // reader hears them in the order they are printed and
                        // the button's own NAME stays "<permission> for <role>"
                        // rather than four sentences.
                        const described = [
                          `${base}-e`,
                          meta.reach === 'declared' ? `${base}-n` : '',
                          blocked ? `${base}-r` : '',
                        ]
                          .filter(Boolean)
                          .join(' ')
                        return (
                          <button
                            key={meta.key}
                            type="button"
                            role="switch"
                            aria-checked={on}
                            // aria-disabled, not `disabled`: a refused control
                            // has something to say, and a disabled button
                            // leaves the tab order with its explanation behind
                            // it. Activating it announces the reason.
                            aria-disabled={blocked || undefined}
                            disabled={rowBusy}
                            aria-label={t('roles.permissionLabel', {
                              permission: t(meta.labelKey),
                              name: roleLabel(role),
                            })}
                            aria-describedby={described}
                            className={`rol-perm${blocked ? ' rol-perm-blocked' : ''}`}
                            onClick={() => {
                              if (blocked) {
                                refuseToggle()
                                return
                              }
                              void togglePermission(role, meta.key, !on)
                            }}
                          >
                            <span className="rol-perm-text">
                              <span className="rol-perm-head">
                                <span className="rol-perm-label">{t(meta.labelKey)}</span>
                                {/* HOW MUCH THIS SWITCH IS WORTH TODAY. Four of
                                    the five keys are enforced somewhere and
                                    three are not enforced anywhere yet; a row
                                    of five identical switches would say they
                                    were the same thing. */}
                                <span className={`pill ${meta.reach === 'live' ? 'ok' : 'warn'}`}>
                                  {t(meta.reach === 'live' ? 'roles.reachLive' : 'roles.reachDeclared')}
                                </span>
                              </span>
                              {/* THE HONESTY LINE — what this actually does. */}
                              <span className="rol-perm-effect" id={`${base}-e`}>
                                {t(meta.effectKey)}
                              </span>
                              {meta.reach === 'declared' && (
                                <span className="rol-perm-note" id={`${base}-n`}>
                                  {t('roles.reachDeclaredNote')}
                                </span>
                              )}
                              {blocked && (
                                <span className="rol-perm-reason" id={`${base}-r`}>
                                  {t('roles.lastAdminReason')}
                                </span>
                              )}
                            </span>
                            <span className="rol-perm-switch">
                              {/* aria-checked repeated on the visual span
                                  because that attribute IS the `.switch`
                                  primitive's styling contract; roles.css owns
                                  `.rol-*` and may not restyle another sheet's
                                  class. aria-hidden, so only the button is
                                  announced. */}
                              <span className="switch" aria-hidden="true" aria-checked={on} />
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {unknown.map((p) => (
                      <p className="rol-unknown" key={p.permission_key}>
                        {t('roles.unknownPerm', { name: p.permission_key })}
                      </p>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {!loading && !errorKey && (
        <section className="card rol-create" aria-labelledby={`${createId}-h`}>
          <h2 className="rol-perms-title" id={`${createId}-h`}>
            {t('roles.createTitle')}
          </h2>
          <p className="rol-hint">{t('roles.createHint')}</p>
          {creating === null ? (
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setCreating({ ...EMPTY_NEW })}
              >
                {t('roles.create')}
              </button>
            </div>
          ) : (
            <>
              <div className="rol-fields">
                <div className="field">
                  <label className="field-label" htmlFor={`${createId}-key`}>
                    {t('roles.createKey')}
                  </label>
                  {/* ALWAYS LTR: the key is ASCII, typed as ASCII and compared
                      as ASCII, in every locale. */}
                  <input
                    id={`${createId}-key`}
                    className="input rol-key-input"
                    lang="en"
                    dir="ltr"
                    maxLength={32}
                    value={creating.key}
                    onChange={(e) => setCreating({ ...creating, key: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${createId}-name`}>
                    {t('roles.nameEn')}
                  </label>
                  <input
                    id={`${createId}-name`}
                    className="input"
                    lang="en"
                    dir="ltr"
                    maxLength={ROLE_NAME_MAX}
                    value={creating.name}
                    onChange={(e) => setCreating({ ...creating, name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${createId}-name-ar`}>
                    {t('roles.nameAr')}
                  </label>
                  <input
                    id={`${createId}-name-ar`}
                    className="input"
                    lang="ar"
                    dir="rtl"
                    maxLength={ROLE_NAME_MAX}
                    value={creating.nameAr}
                    onChange={(e) => setCreating({ ...creating, nameAr: e.target.value })}
                  />
                </div>
              </div>
              <p className="rol-hint">{t('roles.createKeyHint')}</p>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={createBusy || creating.name.trim() === '' || creating.key.trim() === ''}
                  onClick={() => void submitCreate()}
                >
                  {t('roles.createSubmit')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={createBusy}
                  onClick={() => setCreating(null)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
