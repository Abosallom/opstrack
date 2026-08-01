// Settings › Groups (/settings/groups) — the level above tracks.
//
// WHAT THIS SCREEN IS FOR, in one sentence: two people now share one workspace
// and need to stop reading each other's work. Migration 0018 gives every track a
// group — Technical or Business — and this is the only place that decides which
// track sits where. Everything else in the app READS that decision (the filter
// bar's Group facet, the board's group axis, the Mindtree's ring, the digest's
// sections); nothing else writes it.
//
// THE FREQUENT ACTION IS "MOVE A TRACK", NOT "RENAME A GROUP", and the layout
// says so. Every track is on screen with its own <select> — one tap, no
// navigation, no form. Renaming and recolouring a group is a once-a-year job, so
// it sits behind a per-group disclosure rather than occupying the card. An
// intern on day three opens this page and can see, without being told, which
// half of the org each track belongs to and how to change it.
//
// NO CREATE AND NO DELETE, deliberately. 0018 seeds exactly two groups and the
// product is two halves of one org; a third group is a decision with
// consequences for the digest, the board axis and the Mindtree, not a button.
// The table's RLS allows both from the SQL editor if that day ever comes.
//
// NO "UNGROUP" CONTROL EITHER, and that is 0018's rule rather than this file's
// taste: the migration's guarded seed can only ever FILL a null group_id, so a
// deliberate un-grouping would be silently undone by the next re-run. The select
// therefore offers real groups only. The `Not in a group` section still exists,
// because a track CREATED in Settings › Tracks starts with no group and has to
// be findable — see below.
//
// READS THROUGH api/ DIRECTLY, not through store/config, for the reason
// TracksAdmin.tsx gives: this screen must list ARCHIVED tracks and must show its
// own writes on the next paint. Every mutation still calls invalidateConfig() so
// the rest of the app re-reads.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconChevronEnd, IconLayers } from '../../components/icons'
import { EmptyState, Skeleton } from '../../components/shared'
import { toast } from '../../components/toast'
import {
  listGroups,
  listTracks,
  reorderGroups,
  setTrackGroup,
  updateGroup,
} from '../../api/tracks'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { rovingTabIndex, useRadioGroupKeys } from '../../lib/radioGroup'
import { trackIcon } from '../../lib/trackIcons'
import { trackVars } from '../../lib/trackStyle'
import { invalidateConfig } from '../../store/config'
import { useAuth } from '../../store/auth'
import type { Track, TrackGroup } from '../../types'
import './groups.css'

/**
 * Cosmetic admin gate. The real authority is `is_admin()` in the track_groups
 * RLS policies (0018) — every write on this screen fails with 42501 for a member
 * whatever this returns; hiding the screen only avoids offering an action that
 * cannot succeed.
 *
 * THE SIXTH COPY OF THIS HOOK (TracksAdmin, TrackEditor, VocabularyAdmin,
 * Members, Terminology). It is copied rather than shared because the one place
 * it could live is `store/auth.ts` — `src/lib/**` may not import a store, so
 * lib/permissions.ts cannot host it — and that file is not this worker's to
 * edit. Flagged in the handoff; the six are byte-identical today and a copy is
 * exactly the thing that drifts.
 *
 * `?shell` mirrors App.tsx's dev-only preview flag, so these screens stay
 * reachable in a build with no Supabase project — which is where the layout and
 * the RTL mirror get reviewed. `import.meta.env.DEV` is the literal `false` in a
 * production build, so Vite tree-shakes the whole expression out and this cannot
 * become a way in.
 */
function useIsAdmin(): boolean {
  const { profile } = useAuth()
  if (profile?.role === 'admin') return true
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('shell')
}

/**
 * The group colour palette — PAIRS from the `--swatch-*` block in
 * src/styles/global.css, so a colour chosen here is one an admin can reproduce
 * and one whose light-theme twin has already been measured. Never a single hex:
 * a dark-theme hue on the light theme's #e9edf1 lands near 2.5:1, which is the
 * exact defect 0002's seed repair had to go back and fix on five track rows.
 *
 * SIX QUIET PAIRS, NOT THE WHOLE TWELVE. 0018's header states the rule and this
 * is the UI half of it: a group is a container drawn AROUND tracks — a Mindtree
 * ring, a digest heading, a board axis — so a saturated group colour competes
 * with the track colours inside it. Amber, lime, green and orange are left to
 * the tracks. The first two are the seeded Technical/Business pairs, so the
 * defaults are always visible as chosen rather than as a hex nobody can find.
 */
const SWATCHES: readonly { dark: string; light: string; labelKey: string }[] = [
  { dark: '#7586d5', light: '#1d2961', labelKey: 'groups.colorIndigo' },
  { dark: '#93a3b5', light: '#56646f', labelKey: 'groups.colorSlate' },
  { dark: '#8a82cb', light: '#675cbb', labelKey: 'groups.colorViolet' },
  { dark: '#698acf', light: '#3c66be', labelKey: 'groups.colorBlue' },
  { dark: '#2fc5ac', light: '#0d7a6b', labelKey: 'groups.colorTeal' },
  { dark: '#cd6c96', light: '#b43d71', labelKey: 'groups.colorRose' },
]

/** `track_groups_name_len_chk` — 1..40 on the trimmed name. Mirrored, not owned. */
const NAME_MAX = 40

/**
 * A group's name in the given locale — `lib/labels.trackLabel` for the level
 * above tracks, including its fallback rule: `name_ar` is `not null default ''`,
 * so the test is for EMPTY, not null, and a group nobody has translated shows
 * its English name rather than a blank chip.
 *
 * LOCAL, AND IT SHOULD NOT STAY THAT WAY. This belongs beside `trackLabel` in
 * src/lib/labels.ts, which is that file's whole subject ("localised display
 * names for database rows"). It is duplicated here and in components/FilterBar
 * because labels.ts is not this worker's file and the group data layer landed
 * without it; the two copies are byte-identical and the fallback rule is exactly
 * the kind of subtlety that drifts. The handoff carries the twelve-line diff
 * that consolidates them.
 */
function groupLabelIn(group: TrackGroup, locale: Locale): string {
  if (locale === 'ar') return group.name_ar.trim() || group.name
  return group.name
}

/** The rename panel's draft. Never written until Save. */
interface Form {
  name: string
  nameAr: string
  color: string
  colorLight: string
}

/**
 * The draft a group opens with. `color_light` is nullable in the database and
 * the draft always carries a concrete hex, so opening and saving a group that
 * had no override writes the colour it was already being drawn in rather than
 * clearing it — the same fallback every reader applies.
 */
function formOf(group: TrackGroup): Form {
  return {
    name: group.name,
    nameAr: group.name_ar,
    color: group.color,
    // '' round-trips as NULL through api/tracks.toColorLight(), so a group that
    // has no light-theme override keeps not having one when the admin renames
    // it. Seeding this with `color` instead would silently turn "no override"
    // into "an override that happens to match", on a save the admin made for a
    // different reason.
    colorLight: group.color_light ?? '',
  }
}

/** True when the draft says something the stored group does not. */
function dirty(a: Form, b: Form): boolean {
  return (
    a.name !== b.name ||
    a.nameAr !== b.nameAr ||
    a.color !== b.color ||
    a.colorLight !== b.colorLight
  )
}

/** Move `index` by `delta`, returning a new array. Out-of-range is a no-op. */
function moved(rows: TrackGroup[], index: number, delta: number): TrackGroup[] {
  const target = index + delta
  if (target < 0 || target >= rows.length) return rows
  const next = rows.slice()
  const [row] = next.splice(index, 1)
  next.splice(target, 0, row)
  return next
}

export default function GroupsAdmin(): ReactElement {
  const locale = useLocale()
  const isAdmin = useIsAdmin()
  const trackLabel = useTrackLabel()
  // Memoised on locale so passing it into a callback does not invalidate one
  // on every render — useTrackLabel's own reasoning.
  const groupLabel = useCallback(
    (group: TrackGroup) => groupLabelIn(group, locale),
    [locale],
  )

  const [groups, setGroups] = useState<TrackGroup[] | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [errorKey, setErrorKey] = useState<string | null>(null)
  /** The group whose rename panel is open, and the draft it is editing. */
  const [editing, setEditing] = useState<{ id: string; form: Form } | null>(null)
  const [savedForm, setSavedForm] = useState<Form | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** The track whose group is being written, so its select can go disabled. */
  const [movingId, setMovingId] = useState<string | null>(null)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setErrorKey(null)
    // Both reads in parallel: neither answer depends on the other, and this
    // screen is unusable without both.
    const [groupResult, trackResult] = await Promise.all([listGroups(), listTracks(true)])
    if (!alive.current) return
    if (!groupResult.ok) {
      setErrorKey(groupResult.error)
      setGroups([])
      return
    }
    if (!trackResult.ok) {
      setErrorKey(trackResult.error)
      setGroups(groupResult.data)
      return
    }
    setGroups(groupResult.data)
    setTracks(trackResult.data)
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  // ---- reorder ------------------------------------------------------------

  /** Announced in the live region after a reorder or a track move. */
  const [liveMessage, setLiveMessage] = useState('')
  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  /** Which move button to focus after the next paint, as `${id}:up|down`. */
  const focusAfterMove = useRef<string | null>(null)
  /**
   * Reorder writes are fire-and-forget and a person moving a row twice clicks
   * twice in under a second, so a stale reply must not report a failure the
   * newer write already fixed. Same guard as TracksAdmin.
   */
  const orderSeq = useRef(0)

  useEffect(() => {
    const key = focusAfterMove.current
    if (!key) return
    focusAfterMove.current = null
    moveButtons.current.get(key)?.focus()
  })

  const persistOrder = useCallback(
    async (next: TrackGroup[]) => {
      const seq = ++orderSeq.current
      const result = await reorderGroups(next.map((row) => row.id))
      if (!alive.current || seq !== orderSeq.current) return
      if (!result.ok) {
        toast(t(result.error), { tone: 'error' })
        // Re-read rather than restore a captured snapshot: after two rapid moves
        // the snapshot is itself stale, and the server order is the only
        // description of the list that is certainly true.
        void load()
        return
      }
      invalidateConfig()
      // The move itself is visible; what the toast adds is that it PERSISTED.
      // Without it a rejected write and an accepted one look identical.
      toast(t('groups.reordered'))
    },
    [load],
  )

  function move(index: number, delta: number): void {
    if (!groups) return
    const next = moved(groups, index, delta)
    if (next === groups) return
    const row = groups[index]
    const landed = index + delta
    // Focus moving with the row says WHICH row is still selected but not where
    // it landed — order is the one thing this control edits and the one thing
    // focus cannot convey. The live region announces the position.
    setLiveMessage(
      t('groups.movedTo', {
        name: groupLabel(row),
        position: landed + 1,
        total: next.length,
      }),
    )
    const pressed = delta < 0 ? 'up' : 'down'
    // Focus follows the row, not the position. The pressed button goes disabled
    // once the row reaches the end of the list, so in that case focus lands on
    // its twin rather than being dropped back onto the document.
    const stillEnabled = delta < 0 ? landed > 0 : landed < next.length - 1
    const twin = pressed === 'up' ? 'down' : 'up'
    focusAfterMove.current = `${row.id}:${stillEnabled ? pressed : twin}`
    setGroups(next)
    void persistOrder(next)
  }

  // ---- rename / recolour --------------------------------------------------

  const setField = useCallback((key: keyof Form, value: string): void => {
    setEditing((current) =>
      current ? { ...current, form: { ...current.form, [key]: value } } : current,
    )
  }, [])

  const selectSwatch = useCallback((index: number): void => {
    const pair = SWATCHES[index]
    setEditing((current) =>
      current
        ? { ...current, form: { ...current.form, color: pair.dark, colorLight: pair.light } }
        : current,
    )
  }, [])

  // Selection FOLLOWS focus here, unlike components/pickers/OptionGroup — and
  // that difference is safe for exactly one reason: this is a local draft that
  // writes nothing until Save. OptionGroup's five instances are wired straight
  // to patchEntry, which is why arrows there move focus only.
  const onSwatchKeyDown = useRadioGroupKeys<HTMLDivElement>(selectSwatch)

  async function saveGroup(group: TrackGroup): Promise<void> {
    if (!editing || editing.id !== group.id) return
    const name = editing.form.name.trim()
    if (name === '' || name.length > NAME_MAX) {
      toast(t('groups.nameRequired'), { tone: 'error' })
      return
    }
    setBusyId(group.id)
    const result = await updateGroup(group.id, {
      name,
      nameAr: editing.form.nameAr.trim(),
      color: editing.form.color,
      colorLight: editing.form.colorLight,
    })
    if (!alive.current) return
    setBusyId(null)
    if (!result.ok) {
      // result.error is an i18n KEY from pgErrorKey. t() returns an unknown key
      // verbatim, so even the one path that still yields a sentence renders.
      toast(t(result.error), { tone: 'error' })
      return
    }
    setGroups((current) =>
      current ? current.map((row) => (row.id === group.id ? result.data : row)) : current,
    )
    setEditing(null)
    setSavedForm(null)
    invalidateConfig()
    toast(t('groups.saved', { name: groupLabel(result.data) }))
  }

  // ---- move a track between groups ---------------------------------------

  async function moveTrack(track: Track, groupId: string): Promise<void> {
    // `?? null`, never `=== null`: `Track.group_id` is OPTIONAL for the length
    // of this wave (types.ts explains why), so absent and null both mean
    // ungrouped and a strict test would file an absent value as a group id.
    const from = track.group_id ?? null
    if (groupId === '' || groupId === from) return
    // Optimistic: the select is the whole interaction, and a control that waits
    // for a round trip before showing the value the user picked reads as broken.
    setTracks((current) =>
      current.map((row) => (row.id === track.id ? { ...row, group_id: groupId } : row)),
    )
    setMovingId(track.id)
    const result = await setTrackGroup(track.id, groupId)
    if (!alive.current) return
    setMovingId(null)
    if (!result.ok) {
      // Put the row back where it was rather than re-reading: the previous value
      // is known exactly, and a re-read would also discard any OTHER row the
      // admin moved while this request was in flight.
      setTracks((current) =>
        current.map((row) => (row.id === track.id ? { ...row, group_id: from } : row)),
      )
      toast(t(result.error), { tone: 'error' })
      return
    }
    setTracks((current) => current.map((row) => (row.id === track.id ? result.data : row)))
    invalidateConfig()
    const target = groups?.find((g) => g.id === groupId)
    const message = t('groups.moved', {
      name: trackLabel(track),
      target: target ? groupLabel(target) : t('groups.none'),
    })
    // Announced AND toasted: the row physically moves to another card, which is
    // invisible to a screen reader and easy to miss on a phone where the
    // destination card is off screen.
    setLiveMessage(message)
    toast(message)
  }

  // ---- derived ------------------------------------------------------------

  /**
   * group id → its tracks, in the tracks list's own order, plus everything that
   * fell out of every group.
   *
   * THE THIRD CASE IS THE ONE WORTH WRITING DOWN. A track's `group_id` can be
   * absent, null, OR a group id that is not in the list this screen loaded — the
   * two reads are separate requests, and a group deleted between them leaves
   * rows pointing at it until the FK's `on delete set null` is observed. Bucketed
   * naively, such a track appears in no card and in no "not in a group" section:
   * it disappears from the only screen that can fix it. Anything that does not
   * land in a known group lands in `loose`, which is the same rule
   * store/config.ts's deriveTracksByGroup applies.
   */
  const { byGroup, loose } = useMemo(() => {
    const known = new Set((groups ?? []).map((group) => group.id))
    const map = new Map<string, Track[]>()
    const rest: Track[] = []
    for (const track of tracks) {
      // `?? null`, never `=== null` — see moveTrack.
      const id = track.group_id ?? null
      if (id === null || !known.has(id)) {
        rest.push(track)
        continue
      }
      const list = map.get(id)
      if (list) list.push(track)
      else map.set(id, [track])
    }
    return { byGroup: map, loose: rest }
  }, [tracks, groups])

  if (!isAdmin) return <Navigate to="/settings" replace />

  const loading = groups === null

  const renderTrackRow = (track: Track): ReactElement => {
    const Icon = trackIcon(track.icon)
    // The value the <select> can actually show. A group id this screen did not
    // load is not a legal option, so it resolves to the placeholder rather than
    // making the browser fall back to displaying the FIRST group as if it were
    // the answer — see the bucketing note above.
    const current = (groups ?? []).some((group) => group.id === track.group_id)
      ? (track.group_id ?? '')
      : ''
    return (
      <li key={track.id} className="grp-track">
        <span
          className="track-glyph grp-track-mark"
          style={trackVars(track.color, track.color_light)}
          aria-hidden="true"
        >
          <Icon size={16} />
        </span>
        <span className="grp-track-name">{trackLabel(track)}</span>
        {/* An archived track keeps its group: it is hidden from every picker but
            its entries are still filed under it, so a group total that silently
            dropped it would disagree with the digest. */}
        {track.archived && <span className="pill warn">{t('groups.archived')}</span>}
        {/* The select carries its own accessible name rather than a visible
            label: one label per row, repeated nine times, is nine copies of the
            word "Group" down the page — and the row already says which track
            this is. The name interpolates the track so a screen reader hears
            "Group for Infrastructure", not the ninth unlabelled combobox. */}
        <select
          className="select grp-track-select"
          aria-label={t('groups.trackGroupLabel', { name: trackLabel(track) })}
          value={current}
          disabled={movingId === track.id}
          onChange={(e) => void moveTrack(track, e.target.value)}
        >
          {/* Only rendered while the track has no group THIS SCREEN KNOWS, and
              disabled: there is no "remove from group" action here (see the file
              header), so the option exists purely to give the control a legal
              current value. Without it the browser shows the first group as the
              selection, which is a confident answer to a question nobody has
              answered yet. */}
          {current === '' && (
            <option value="" disabled>
              {t('groups.none')}
            </option>
          )}
          {(groups ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {groupLabel(group)}
            </option>
          ))}
        </select>
      </li>
    )
  }

  return (
    <div className="grp">
      <div className="grp-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header already renders this route's title as
          the document h1, and a second copy is noise in the heading outline. */}
      <p className="grp-intro">{t('groups.subtitle')}</p>

      {/* Polite, not assertive: every message here follows an action the user
          just took deliberately, so it should queue behind whatever is being
          read rather than interrupt it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {loading && <Skeleton height={140} count={2} />}

      {!loading && errorKey && (
        <div className="card grp-error" role="alert">
          {/* pgErrorKey's catch-all says less than this screen's own headline
              does; anything more specific — a 42501, or the PGRST205 that means
              0018 has not been applied to this project — is worth showing. */}
          <p>{t(errorKey === 'common.error' ? 'groups.loadFailed' : errorKey)}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !errorKey && groups.length === 0 && (
        <EmptyState
          icon={<IconLayers size={30} />}
          title={t('groups.empty')}
          description={t('groups.emptyHint')}
        />
      )}

      {!loading && !errorKey && groups.length > 0 && (
        <ul className="grp-list" aria-label={t('groups.title')}>
          {groups.map((group, index) => {
            const open = editing?.id === group.id
            const busy = busyId === group.id
            const rows = byGroup.get(group.id) ?? []
            // Always the OTHER language, never a repeat of the primary line: in
            // Arabic, groupLabel() already returns name_ar, so keying this to
            // name_ar unconditionally would print the same name twice.
            const altLang = locale === 'ar' ? 'en' : 'ar'
            const alt = (locale === 'ar' ? group.name : group.name_ar).trim()
            const secondary = alt && alt !== groupLabel(group) ? alt : ''
            const swatchIndex = open
              ? SWATCHES.findIndex(
                  (pair) =>
                    editing.form.color === pair.dark && editing.form.colorLight === pair.light,
                )
              : -1

            return (
              <li key={group.id} className="card grp-group">
                <div className="grp-head">
                  <div
                    className="track-bar grp-head-text"
                    style={trackVars(group.color, group.color_light)}
                  >
                    <p className="grp-name">{groupLabel(group)}</p>
                    {/* The other language always shows beneath the current one:
                        an admin renaming a group needs both halves of the pair at
                        once, and `lang` gives the Arabic line an Arabic face
                        while the UI is English. */}
                    {secondary && (
                      <p
                        className="grp-alt"
                        lang={altLang}
                        dir={altLang === 'ar' ? 'rtl' : 'ltr'}
                      >
                        {secondary}
                      </p>
                    )}
                    <p className="grp-meta">
                      <span className="pill tabular">
                        {t('groups.trackCount', { count: rows.length })}
                      </span>
                    </p>
                  </div>

                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-icon grp-move"
                      aria-label={t('groups.moveUp', { name: groupLabel(group) })}
                      disabled={index === 0}
                      ref={(el) => {
                        if (el) moveButtons.current.set(`${group.id}:up`, el)
                        else moveButtons.current.delete(`${group.id}:up`)
                      }}
                      onClick={() => move(index, -1)}
                    >
                      {/* A chevron rotated in CSS rather than a new glyph. Up and
                          down are axis-neutral, so this deliberately does NOT get
                          icon-directional — mirroring it would point it sideways
                          in Arabic. */}
                      <IconChevronEnd className="grp-move-icon grp-move-up" size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-icon grp-move"
                      aria-label={t('groups.moveDown', { name: groupLabel(group) })}
                      disabled={index === groups.length - 1}
                      ref={(el) => {
                        if (el) moveButtons.current.set(`${group.id}:down`, el)
                        else moveButtons.current.delete(`${group.id}:down`)
                      }}
                      onClick={() => move(index, 1)}
                    >
                      <IconChevronEnd className="grp-move-icon grp-move-down" size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-expanded={open}
                      onClick={() => {
                        if (open) {
                          setEditing(null)
                          setSavedForm(null)
                          return
                        }
                        const form = formOf(group)
                        setEditing({ id: group.id, form })
                        setSavedForm(form)
                      }}
                    >
                      {t(open ? 'groups.renameDone' : 'groups.rename')}
                    </button>
                  </div>
                </div>

                {open && editing && (
                  <div className="grp-edit">
                    <div className="grp-fields">
                      <div className="field">
                        <label className="field-label" htmlFor={`grp-name-${group.id}`}>
                          {t('groups.nameEn')}
                        </label>
                        <input
                          id={`grp-name-${group.id}`}
                          className="input"
                          lang="en"
                          dir="ltr"
                          maxLength={NAME_MAX}
                          value={editing.form.name}
                          onChange={(e) => setField('name', e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor={`grp-name-ar-${group.id}`}>
                          {t('groups.nameAr')}
                        </label>
                        {/* lang + dir on the field itself: an Arabic name typed
                            into an LTR box has its punctuation resolved against
                            the wrong paragraph direction while it is being
                            typed, which is the one place the user can see the
                            bug and not the cause. */}
                        <input
                          id={`grp-name-ar-${group.id}`}
                          className="input"
                          lang="ar"
                          dir="rtl"
                          maxLength={NAME_MAX}
                          value={editing.form.nameAr}
                          onChange={(e) => setField('nameAr', e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="grp-hint">{t('groups.nameArHint')}</p>

                    <fieldset className="field grp-fieldset">
                      <legend className="field-label">{t('groups.color')}</legend>
                      {/* role="radiogroup" is a contract about the keyboard, not
                          a label: without it these six swatches are six tab
                          stops inside a form, and the arrow keys a screen reader
                          tells the user to press do nothing. See
                          lib/radioGroup.ts. */}
                      <div
                        className="swatch-grid grp-swatches"
                        role="radiogroup"
                        aria-label={t('groups.color')}
                        onKeyDown={onSwatchKeyDown}
                      >
                        {SWATCHES.map((pair, swatch) => {
                          const active = swatch === swatchIndex
                          return (
                            <button
                              key={pair.dark}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              // A colour NAME, never the hex: this is the
                              // control's only accessible name and "#7586d5" is
                              // read out one character at a time.
                              aria-label={t(pair.labelKey)}
                              tabIndex={rovingTabIndex(swatch, swatchIndex)}
                              className="swatch grp-swatch"
                              style={trackVars(pair.dark, pair.light)}
                              onClick={() => selectSwatch(swatch)}
                            />
                          )
                        })}
                      </div>
                    </fieldset>

                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busy || editing.form.name.trim() === ''}
                        onClick={() => void saveGroup(group)}
                      >
                        {t('groups.save')}
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
                        {t('groups.discard')}
                      </button>
                      {/* The badge is what makes Discard legible: "Discard" with
                          nothing changed is a control with no referent. */}
                      {savedForm !== null && dirty(editing.form, savedForm) && (
                        <span className="pill warn">{t('groups.unsaved')}</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="grp-tracks">
                  <p className="grp-tracks-title">{t('groups.tracksIn')}</p>
                  {rows.length === 0 ? (
                    <p className="grp-empty">{t('groups.emptyGroup')}</p>
                  ) : (
                    <ul className="grp-track-list">{rows.map(renderTrackRow)}</ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && !errorKey && loose.length > 0 && (
        <section className="card grp-loose" aria-labelledby="grp-loose-h">
          <h2 className="grp-loose-title" id="grp-loose-h">
            {t('groups.ungrouped')}
          </h2>
          <p className="grp-hint">{t('groups.ungroupedHint')}</p>
          <ul className="grp-track-list">{loose.map(renderTrackRow)}</ul>
        </section>
      )}
    </div>
  )
}
