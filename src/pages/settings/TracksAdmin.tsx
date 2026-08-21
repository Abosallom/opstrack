// Track manager (/settings/tracks) — the workspace's list of operational domains:
// reorder, archive/restore, and delete-with-reassign. Creating and editing live
// on the /settings/tracks/new and /settings/tracks/:id sub-routes rather than in
// a modal, so a half-written track survives a mis-tap and has its own URL.
//
// This screen reads through api/tracks directly instead of store/config: it is
// the only place that must list ARCHIVED tracks and must show its own writes on
// the next paint. Every mutation still calls invalidateConfig() so the rest of
// the app re-reads on its next render.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconChevronEnd, IconLayers } from '../../components/icons'
import { EmptyState, Skeleton } from '../../components/shared'
import { confirm } from '../../components/Confirm'
import { toast } from '../../components/toast'
import {
  deleteTrack,
  getTrackUsage,
  listTracks,
  reorderTracks,
  setTrackArchived,
} from '../../api/tracks'
import { useTrackLabel } from '../../lib/labels'
import { trackIcon } from '../../lib/trackIcons'
import { trackVars } from '../../lib/trackStyle'
import { t, useLocale } from '../../lib/i18n'
import { invalidateConfig } from '../../store/config'
import { useHasPerm } from '../../store/auth'
import type { Track, TrackUsage } from '../../types'
import './admin.css'

/** Move `index` by `delta`, returning a new array. Out-of-range is a no-op. */
function moved(rows: Track[], index: number, delta: number): Track[] {
  const target = index + delta
  if (target < 0 || target >= rows.length) return rows
  const next = rows.slice()
  const [row] = next.splice(index, 1)
  next.splice(target, 0, row)
  return next
}

export default function TracksAdmin(): ReactElement {
  const locale = useLocale()
  // COSMETIC GATE, ASKING THE QUESTION THE DATABASE ASKS. The real authority is
  // the `tracks` RLS policies, which 0025 re-points from `is_admin()` at
  // `has_perm('structure.edit')` — the key the Director role holds — along with
  // `reorder_tracks()` and `delete_track_reassign()`, the two RPCs this screen
  // calls. Every write here fails with 42501 for anyone without that key
  // whatever this returns; hiding the screen only avoids offering an action that
  // cannot succeed.
  //
  // THIS FILE HELD ONE OF SEVEN BYTE-IDENTICAL `useIsAdmin` COPIES, and the
  // duplication was the smaller of its two problems: they read `profiles.role`,
  // which 0025 keeps derived from the SYSTEM roles only, so no custom role was
  // visible to any of them and a Director read as 'member'. store/auth's
  // `useHasPerm` reads `role_permissions`, falls back to the legacy column when
  // 0025 has not been applied — so a workspace without the roles tables behaves
  // exactly as it did before — and carries the dev-only `?shell` preview flag
  // that used to be repeated here, which is what keeps this screen reviewable in
  // a build with no Supabase project.
  const canEdit = useHasPerm('structure.edit')
  const label = useTrackLabel()

  const [rows, setRows] = useState<Track[] | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [usage, setUsage] = useState<Map<string, TrackUsage>>(() => new Map())
  const [busyId, setBusyId] = useState<string | null>(null)
  /** The row whose delete flow is open, with the counts it must not orphan. */
  const [pendingDelete, setPendingDelete] = useState<{
    track: Track
    usage: TrackUsage
    /** '' until the admin has actually chosen — see the disabled confirm below. */
    reassignTo: string
  } | null>(null)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setErrorKey(null)
    const result = await listTracks(true)
    if (!alive.current) return
    if (!result.ok) {
      setErrorKey(result.error)
      setRows([])
      return
    }
    setRows(result.data)
    // One usage probe per track. There is no batched count endpoint and this
    // workspace holds a handful of tracks, so N small head-requests in parallel
    // beat inventing a view for a number that is only read on this screen.
    const counts = await Promise.all(result.data.map((row) => getTrackUsage(row.id)))
    if (!alive.current) return
    const map = new Map<string, TrackUsage>()
    result.data.forEach((row, i) => {
      const entry = counts[i]
      if (entry.ok) map.set(row.id, entry.data)
    })
    setUsage(map)
  }, [])

  useEffect(() => {
    if (canEdit) void load()
  }, [canEdit, load])

  // ---- reorder ------------------------------------------------------------

  /** Announced in the live region after a reorder — see move(). */
  const [moveMessage, setMoveMessage] = useState('')
  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  /** Which move button to focus after the next paint, as `${id}:up|down`. */
  const focusAfterMove = useRef<string | null>(null)
  /**
   * Reorder writes are fire-and-forget and a person moving a row three places
   * clicks three times in under a second, so a stale reply must not be allowed
   * to report a failure the newer write already fixed.
   */
  const orderSeq = useRef(0)

  useEffect(() => {
    const key = focusAfterMove.current
    if (!key) return
    focusAfterMove.current = null
    moveButtons.current.get(key)?.focus()
  })

  const persistOrder = useCallback(async (next: Track[]) => {
    const seq = ++orderSeq.current
    const result = await reorderTracks(next.map((row) => row.id))
    if (!alive.current || seq !== orderSeq.current) return
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      // Re-read rather than restore a captured snapshot: after several rapid
      // moves the snapshot is itself stale, and the server order is the only
      // description of the list that is certainly true.
      void load()
      return
    }
    invalidateConfig()
    // The move itself is visible; what the toast adds is that it PERSISTED.
    // Without it a rejected write and an accepted one look identical.
    toast(t('admin.tracks.reordered'))
  }, [load])

  function move(index: number, delta: number): void {
    if (!rows) return
    const next = moved(rows, index, delta)
    if (next === rows) return
    const row = rows[index]
    const landed = index + delta
    // Focus moving with the row says WHICH row is still selected but not where
    // it landed — the list order is the one thing this screen edits and the one
    // thing focus cannot convey. The live region below announces the position.
    setMoveMessage(
      t('admin.tracks.movedTo', {
        name: label(row),
        position: landed + 1,
        total: next.length,
      }),
    )
    const pressed = delta < 0 ? 'up' : 'down'
    // Focus follows the row, not the position. The pressed button goes disabled
    // once the row reaches the end of the list, so in that case focus lands on
    // its twin instead of being dropped back onto the document.
    const stillEnabled = delta < 0 ? landed > 0 : landed < next.length - 1
    const twin = pressed === 'up' ? 'down' : 'up'
    focusAfterMove.current = `${row.id}:${stillEnabled ? pressed : twin}`
    setRows(next)
    void persistOrder(next)
  }

  // ---- archive / restore --------------------------------------------------

  async function toggleArchived(track: Track): Promise<void> {
    // Confirm on the way out only. Archiving pulls a whole domain out of every
    // picker in the app, which is worth one sentence explaining that nothing is
    // deleted; restoring is the undo and needs no ceremony of its own.
    if (!track.archived) {
      const ok = await confirm({
        title: t('admin.tracks.archiveTitle'),
        body: t('admin.tracks.archiveBody', { name: label(track) }),
        confirmLabel: t('admin.tracks.archive'),
        cancelLabel: t('common.cancel'),
      })
      if (!ok || !alive.current) return
    }
    setBusyId(track.id)
    const result = await setTrackArchived(track.id, !track.archived)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      // result.error is an i18n KEY from pgErrorKey. t() returns an unknown key
      // verbatim, so the one path that still yields a sentence — the
      // "backend not configured" build — also renders correctly here.
      toast(t(result.error), { tone: 'error' })
      return
    }
    setRows((current) =>
      current ? current.map((row) => (row.id === track.id ? result.data : row)) : current,
    )
    invalidateConfig()
    toast(t(track.archived ? 'admin.tracks.restoredToast' : 'admin.tracks.archivedToast'))
  }

  // ---- delete -------------------------------------------------------------

  async function beginDelete(track: Track): Promise<void> {
    setBusyId(track.id)
    // Counts are re-read here rather than taken from the list: the delete
    // decision is the one place where a number that went stale while the page
    // sat open would silently detach somebody's entries.
    const result = await getTrackUsage(track.id)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    const counts = result.data
    setUsage((current) => new Map(current).set(track.id, counts))
    if (counts.entries + counts.meetings + counts.templates === 0) {
      await runDelete(track, null)
      return
    }
    setPendingDelete({ track, usage: counts, reassignTo: '' })
  }

  async function runDelete(track: Track, reassignTo: string | null): Promise<void> {
    const ok = await confirm({
      title: t('admin.tracks.deleteTitle'),
      body: t('admin.tracks.deleteBody', { name: label(track) }),
      confirmLabel: t('admin.tracks.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    setBusyId(track.id)
    const result = await deleteTrack(track.id, reassignTo)
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    setPendingDelete(null)
    setRows((current) => (current ? current.filter((row) => row.id !== track.id) : current))
    invalidateConfig()
    toast(t('admin.tracks.deleted'))
  }

  if (!canEdit) return <Navigate to="/settings" replace />

  const loading = rows === null

  return (
    <div className="admin">
      <div className="admin-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading here: App.tsx's header already renders
          admin.tracks.title as the document's h1 for this route, and a second
          copy of the same words is noise in the heading outline. */}
      <p className="admin-intro-desc">{t('admin.tracks.subtitle')}</p>

      <div className="admin-toolbar">
        <Link to="/settings/tracks/new" className="btn btn-primary">
          {t('admin.tracks.add')}
        </Link>
      </div>

      {/* Polite, not assertive: a reorder is the user's own deliberate action,
          so it should follow whatever is being read rather than interrupt it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {moveMessage}
      </p>

      {loading && <Skeleton height={72} count={4} />}

      {!loading && errorKey && (
        <div className="card admin-error" role="alert">
          {/* pgErrorKey's catch-all says less than the headline for this screen
              does; anything more specific (a 42501, say) is worth showing. */}
          <p>{t(errorKey === 'common.error' ? 'admin.tracks.loadFailed' : errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !errorKey && rows.length === 0 && (
        <EmptyState
          icon={<IconLayers size={30} />}
          title={t('admin.tracks.empty')}
          description={t('admin.tracks.emptyHint')}
          action={
            <Link to="/settings/tracks/new" className="btn btn-primary">
              {t('admin.tracks.add')}
            </Link>
          }
        />
      )}

      {!loading && !errorKey && rows.length > 0 && (
        <ul className="admin-list" aria-label={t('admin.tracks.title')}>
          {rows.map((track, index) => {
            const Icon = trackIcon(track.icon)
            const counts = usage.get(track.id)
            const busy = busyId === track.id
            const open = pendingDelete?.track.id === track.id
            // Always the OTHER language, never a repeat of the primary line:
            // in Arabic, label() already returns name_ar, so keying this to
            // name_ar unconditionally printed the same name twice.
            const altLang = locale === 'ar' ? 'en' : 'ar'
            const alt = (locale === 'ar' ? track.name : track.name_ar).trim()
            const secondary = alt && alt !== label(track) ? alt : ''
            // Where this track's items may be moved: another track, still
            // active. An archived destination hides them from the whole app, so
            // it is not a destination — see the panel below.
            const reassignTargets = open
              ? rows.filter((other) => other.id !== track.id && !other.archived)
              : []

            return (
              <li key={track.id} className="card card-tight admin-row">
                <div
                  className="admin-row-head track-bar admin-track-bar"
                  style={trackVars(track.color, track.color_light)}
                >
                  <span className="admin-row-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <div className="admin-row-text">
                    <p className="admin-row-name">{label(track)}</p>
                    {/* The other language always shows beneath the current one:
                        an admin renaming a track needs to see both halves of the
                        pair at once, and `lang` gives the Arabic line an Arabic
                        face while the UI is English. */}
                    {secondary && (
                      <p
                        className="admin-row-alt"
                        lang={altLang}
                        dir={altLang === 'ar' ? 'rtl' : 'ltr'}
                      >
                        {secondary}
                      </p>
                    )}
                    <p className="admin-row-tags">
                      {counts && (
                        <span className="pill tabular">
                          {t('admin.tracks.usageEntries', { count: counts.entries })}
                        </span>
                      )}
                      {track.archived && (
                        <span className="pill warn">{t('admin.tracks.archived')}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="admin-row-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-icon admin-move"
                    aria-label={t('admin.tracks.moveUp', { name: label(track) })}
                    disabled={index === 0}
                    ref={(el) => {
                      if (el) moveButtons.current.set(`${track.id}:up`, el)
                      else moveButtons.current.delete(`${track.id}:up`)
                    }}
                    onClick={() => move(index, -1)}
                  >
                    {/* A chevron rotated in CSS rather than a new glyph. Up and
                        down are axis-neutral, so this deliberately does NOT get
                        icon-directional — mirroring it would point it sideways
                        in Arabic. */}
                    <IconChevronEnd className="admin-move-icon admin-move-up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-icon admin-move"
                    aria-label={t('admin.tracks.moveDown', { name: label(track) })}
                    disabled={index === rows.length - 1}
                    ref={(el) => {
                      if (el) moveButtons.current.set(`${track.id}:down`, el)
                      else moveButtons.current.delete(`${track.id}:down`)
                    }}
                    onClick={() => move(index, 1)}
                  >
                    <IconChevronEnd className="admin-move-icon admin-move-down" size={16} />
                  </button>

                  <Link to={`/settings/tracks/${track.id}`} className="btn btn-sm">
                    {t('admin.tracks.edit')}
                  </Link>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void toggleArchived(track)}
                  >
                    {t(track.archived ? 'admin.tracks.restore' : 'admin.tracks.archive')}
                  </button>
                  {/* Delete is last and red: archiving is the retire action this
                      screen wants people to reach for first. */}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    aria-expanded={open}
                    onClick={() => {
                      if (open) setPendingDelete(null)
                      else void beginDelete(track)
                    }}
                  >
                    {t('admin.tracks.delete')}
                  </button>
                </div>

                {open && pendingDelete && (
                  // Inline rather than a dialog: the reassign step needs a real
                  // form control, and Confirm.tsx owns the only focus trap in
                  // the app. A second modal with its own trap and Esc handling
                  // is a lot of machinery for one <select>.
                  <div className="admin-reassign">
                    <p className="field-label">{t('admin.tracks.usage')}</p>
                    <p className="admin-reassign-usage">
                      {/* The three counts arrive as already-translated phrases
                          from the same plural nodes the usage line above uses,
                          not as bare numbers. A sentence carrying three
                          different counts cannot inflect from one `{count}` —
                          selectPlural reads exactly one — so hardcoding the
                          nouns here is what produced "still holds 1 entries"
                          while the row two lines up said "1 entry". */}
                      {t('admin.tracks.deleteBodyInUse', {
                        name: label(track),
                        entries: t('admin.tracks.usageEntries', {
                          count: pendingDelete.usage.entries,
                        }),
                        meetings: t('admin.tracks.usageMeetings', {
                          count: pendingDelete.usage.meetings,
                        }),
                        templates: t('admin.tracks.usageTemplates', {
                          count: pendingDelete.usage.templates,
                        }),
                        // 0023's fourth dependant. Omitting it would tell an
                        // admin the track holds three kinds of thing while the
                        // RPC refuses over a fourth they were never shown.
                        nodes: t('admin.tracks.usageNodes', {
                          count: pendingDelete.usage.nodes,
                        }),
                      })}
                    </p>
                    {/* Only ACTIVE tracks are offered, and there is deliberately
                        no "leave them unassigned" choice. This panel opens only
                        when the track still holds items, which is exactly the
                        case delete_track() refuses without a destination — the
                        option existed but could never succeed, and answered a
                        request to move the items with "move the items first".
                        Archived destinations are excluded for a quieter reason:
                        they are hidden from every picker and stop their
                        recurring templates, so rows moved there vanish while the
                        toast reports success. The RPC now refuses both. */}
                    {reassignTargets.length === 0 ? (
                      <p className="field-error">{t('admin.tracks.reassignNoTargets')}</p>
                    ) : (
                      <div className="field">
                        <label className="field-label" htmlFor={`reassign-${track.id}`}>
                          {t('admin.tracks.reassignTo')}
                        </label>
                        <select
                          id={`reassign-${track.id}`}
                          className="select"
                          value={pendingDelete.reassignTo}
                          onChange={(e) =>
                            setPendingDelete((current) =>
                              current ? { ...current, reassignTo: e.target.value } : current,
                            )
                          }
                        >
                          {/* Empty and disabled: there is no default
                              destination. Confirm stays disabled until the admin
                              has chosen one explicitly, which is the whole point
                              of this step. */}
                          <option value="" disabled>
                            {t('admin.tracks.reassignTo')}
                          </option>
                          {reassignTargets.map((other) => (
                            <option key={other.id} value={other.id}>
                              {label(other)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="admin-reassign-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setPendingDelete(null)}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busy || pendingDelete.reassignTo === ''}
                        onClick={() => void runDelete(track, pendingDelete.reassignTo)}
                      >
                        {t('admin.tracks.delete')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
