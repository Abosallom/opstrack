// The entry kit's atoms — the small marks every list, board, sheet and digest
// preview paints an entry with.
//
// CONNECTEDNESS (plan §2.5, frozen). Atoms MAY subscribe to `vocab`, `config`
// (tracks), `members` and `useLocale`; they may NOT read `store/entries`,
// mutate, or fetch. That split is not stylistic. A board renders 60–200 of
// these at once, so a single realtime patch landing in `store/entries` must not
// re-render the whole screen — the list owner subscribes once and passes
// `entry` down. Vocabulary, tracks and members change roughly monthly, and the
// alternative to subscribing here is prop-drilling a track object and a member
// map through every row in the product.
//
// COLOUR IS NEVER PICKED IN JAVASCRIPT. Every atom hands its hex to CSS as a
// custom property via `trackVars()` / `vocabVars()` and lets the cascade choose.
// A hex resolved in JS is resolved once, at render; when the `auto` theme flips
// at sunset, `lib/theme.ts` rewrites data-theme on <html> from a matchMedia
// listener and nothing re-renders, so every mark in the app would keep
// yesterday's colour until the user navigated. See lib/trackStyle.ts's header.
//
// NULL-SAFETY IS A CONTRACT, not a nicety. `trackId: null`, a track archived out
// of the map, an owner_id pointing at a deleted profile, a status key whose
// vocab row has not loaded — each renders a neutral, labelled mark. None of
// them may throw: these atoms are on the first-paint path of a cached, offline,
// possibly stale entry list.
//
// VARIANTS RIDE ON data-* ATTRIBUTES, not modifier classes. §1.0.7 grants this
// sheet exactly `.status-pill .prio-dot .health-pill .age-pill .owner-badge
// .tag-chip .due-label .track-ref` as bare names — no `-modifier` suffixes — so
// `data-size` / `data-health` / `data-variant` is what keeps the registry
// honest instead of quietly growing a dozen unregistered class names.

import type { CSSProperties, ReactElement } from 'react'
import { IconClock } from '../icons'
import { diffDays, formatAge, formatDue, todayIso, type IsoDate } from '../../lib/dates'
import { t, useLocale } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { initials } from '../../lib/text'
import { trackIcon } from '../../lib/trackIcons'
import { trackVars } from '../../lib/trackStyle'
import { vocabVars } from '../../lib/vocabStyle'
import { useTrackMap } from '../../store/config'
import { useMemberLabel } from '../../store/members'
import { useVocabAll, useVocabColor, useVocabLabel } from '../../store/vocab'
import type { EntryPriority, EntryStatus, HealthLevel } from '../../types'
import './entry.css'

/** Join class names, dropping the absent ones. Local on purpose — one line does
 *  not justify a shared module, and every atom takes an optional `className`. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Health level → the `.pill` tone modifier global.css already ships.
 *
 * `critical` gets `.filled` (solid --red, --bg ink) rather than a fifth tone:
 * global.css reserves the filled variant for "the one badge that must win
 * attention", and an entry the view has escalated to critical is exactly that.
 * Note the ink is --bg and not white — on the dark theme --red is a light
 * coral, where white text measures 2.52:1.
 */
const HEALTH_TONE: Readonly<Record<HealthLevel, string>> = {
  ok: 'ok',
  stale: 'warn',
  overdue: 'danger',
  critical: 'filled',
}

/* ══════════════════════════ StatusPill ══════════════════════════ */

export interface StatusPillProps {
  status: EntryStatus
  size?: 'sm' | 'md'
  /** Present ⇒ the pill becomes an editable control. Absent ⇒ a static badge. */
  onChange?: (next: EntryStatus) => void
  disabled?: boolean
  className?: string
}

/**
 * The editable half, split into its own component so the read-only pill never
 * pays for `useVocabAll()`. Rows render this atom 200 at a time; subscribing
 * every one of them to the full option list to render six characters of text is
 * the kind of cost that only shows up on the board.
 */
function StatusSelect({
  status,
  size,
  onChange,
  disabled,
  className,
  style,
}: {
  status: EntryStatus
  size: 'sm' | 'md'
  onChange: (next: EntryStatus) => void
  disabled: boolean
  className: string
  style: CSSProperties
}): ReactElement {
  // includeHidden, then filter — a hidden option must leave the PICKER but must
  // never hide DATA that already holds it (store/vocab.ts's stated semantic).
  // An entry parked in a status the admin has since hidden still has to be able
  // to show, and keep, its own value.
  const options = useVocabAll('status').filter((o) => !o.hidden || o.key === status)

  return (
    <select
      className={className}
      data-size={size}
      data-editable="true"
      style={style}
      value={status}
      disabled={disabled}
      aria-label={t('entry.changeStatus')}
      onChange={(e) => onChange(e.target.value as EntryStatus)}
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/**
 * An entry's status, in the admin's own words.
 *
 * The LABEL is resolved at render through `useVocabLabel()` and the entry row
 * stores only the frozen key — which is the whole reason renaming a status
 * costs zero writes to historical data (Wave 2 gate (g) proves it).
 *
 * Editable mode is a native `<select>` rather than a popover menu, and
 * deliberately so: it is keyboard-operable, announced as a list, mirrors
 * correctly in RTL because the UA draws its own affordance from `dir`, and it
 * needs no picker component — this atom ships a wave before the pickers do.
 * W2 may swap it for `components/pickers/*` behind this exact prop signature.
 */
export function StatusPill({
  status,
  size = 'sm',
  onChange,
  disabled = false,
  className,
}: StatusPillProps): ReactElement {
  const vocabLabel = useVocabLabel()
  const vocabColor = useVocabColor()
  useLocale()

  const style = vocabVars(vocabColor('status', status))
  const cls = cx('pill', 'status-pill', className)

  if (onChange) {
    return (
      <StatusSelect
        status={status}
        size={size}
        onChange={onChange}
        disabled={disabled}
        className={cls}
        style={style}
      />
    )
  }

  return (
    <span className={cls} data-size={size} style={style}>
      {vocabLabel('status', status)}
    </span>
  )
}

/* ══════════════════════════ PriorityDot ══════════════════════════ */

export interface PriorityDotProps {
  priority: EntryPriority
  withLabel?: boolean
  className?: string
}

/**
 * Priority as a coloured disc, optionally with its label.
 *
 * Unlabelled it carries `role="img"` + `aria-label`: the disc IS the whole
 * message, and a bare <span> with an aria-label is not reliably announced
 * without a role to hang it on. Labelled, the text is the accessible name and
 * the disc is decoration — so no aria at all, or the name is read twice.
 */
export function PriorityDot({
  priority,
  withLabel = false,
  className,
}: PriorityDotProps): ReactElement {
  const vocabLabel = useVocabLabel()
  const vocabColor = useVocabColor()
  useLocale()

  const label = vocabLabel('priority', priority)

  return (
    <span
      className={cx('prio-dot', className)}
      data-priority={priority}
      data-labelled={withLabel ? 'true' : undefined}
      style={vocabVars(vocabColor('priority', priority))}
      role={withLabel ? undefined : 'img'}
      aria-label={withLabel ? undefined : label}
      title={withLabel ? undefined : label}
    >
      {withLabel ? label : null}
    </span>
  )
}

/* ══════════════════════════ HealthPill ══════════════════════════ */

export interface HealthPillProps {
  health: HealthLevel
  daysOverdue?: number
  /**
   * `v_entry_health.sla_breached`. FALSE whenever the admin has left this
   * priority's `sla_days` unset, which is the seeded state — SLA is off until
   * someone turns it on, so this prop is a genuine breach and never a default.
   */
  slaBreached?: boolean
  className?: string
}

/**
 * The ageing verdict, straight from `v_entry_health`.
 *
 * SLA OUTRANKS HEALTH. Staleness measures SILENCE (`last_activity_at`); the SLA
 * measures ELAPSED TIME (`created_at`). An item updated hourly for a month is
 * never stale and can still have blown its SLA, so a breach forces the danger
 * tone over everything except `critical` — otherwise the one pill on the row
 * would be green, or (for a stale breach) YELLOW, while the workspace's own
 * commitment was missed. `critical` is the one level a breach must not touch:
 * it renders `.filled`, which global.css reserves for the badge that has to win
 * attention, and downgrading it to the outlined danger tone would be a demotion.
 *
 * Three cues, never colour alone, and each one has to carry on its own:
 *   TONE — the same red as plain overdue, so it cannot be the distinguishing
 *     cue between the two states. It is the alarm, not the label.
 *   BORDER — dashed AND at full currentColor rather than .pill's 35% mix. The
 *     mix measured 1.90:1 (dark) / 1.79:1 (light) against the elevated surface,
 *     under WCAG 1.4.11's 3:1 for a meaningful graphic; at full strength it is
 *     6.73:1 / 5.80:1. A dash pattern on a line nobody can see is not a cue.
 *   MARKER — t('entry.slaMark'), a WORD. It used to be the whole sentence
 *     ("Past its service deadline"), ~160px of `white-space: nowrap` inside a
 *     278px board card, which overflowed the row on a phone. The sentence still
 *     reaches a screen reader through the .sr-only span, and the explanation
 *     still reaches a mouse through `title`.
 */
export function HealthPill({
  health,
  daysOverdue = 0,
  slaBreached = false,
  className,
}: HealthPillProps): ReactElement {
  useLocale()

  const tone = slaBreached && health !== 'critical' ? 'danger' : HEALTH_TONE[health]
  // The day count is the more useful sentence when there is one: "3 d overdue"
  // beats "Overdue" on a row someone is triaging.
  const text = daysOverdue > 0 ? t('date.overdueByDays', { count: daysOverdue }) : t(`health.${health}`)

  return (
    <span
      className={cx('pill', tone, 'health-pill', className)}
      data-health={health}
      data-sla={slaBreached ? 'breached' : undefined}
      title={slaBreached ? t('entry.slaBreachedHint') : undefined}
    >
      {text}
      {slaBreached ? (
        <>
          <span aria-hidden="true">{t('entry.slaMark')}</span>
          {/* The abbreviation on screen is not a sentence anyone can act on, so
              the full one is announced instead — the pill's visible text plus
              this, in that order, is what a screen reader reads out. */}
          <span className="sr-only">{t('entry.slaBreached')}</span>
        </>
      ) : null}
    </span>
  )
}

/* ══════════════════════════ AgePill ══════════════════════════ */

export interface AgePillProps {
  days: number
  health?: HealthLevel
  reason?: 'activity' | 'blocked' | 'status'
  className?: string
}

/** Why this row is old — each phrasing is a different question about the same number. */
const AGE_REASON_KEY: Readonly<Record<NonNullable<AgePillProps['reason']>, string>> = {
  activity: 'entry.ageActivity',
  blocked: 'entry.ageBlocked',
  status: 'entry.ageStatus',
}

/**
 * "14d" — how long this entry has been quiet.
 *
 * `formatAge()` is the only thing allowed to render that string: it emits LATIN
 * numerals in both languages, because this is a work tool and the spec forbids
 * Arabic-Indic digits (`Intl` with 'ar' would hand back ١٤ and an Islamic
 * calendar besides). `.tabular` keeps the column from jittering between 9d and
 * 14d down a list of sixty rows.
 *
 * `role="img"` because "14d" is an abbreviation: the accessible name is the
 * full sentence, not the two characters on screen.
 */
export function AgePill({ days, health, reason = 'activity', className }: AgePillProps): ReactElement {
  const locale = useLocale()

  const label = t(AGE_REASON_KEY[reason], { count: days })

  return (
    <span
      className={cx('pill', health ? HEALTH_TONE[health] : undefined, 'age-pill', 'tabular', className)}
      data-reason={reason}
      role="img"
      aria-label={label}
      title={label}
    >
      {formatAge(days, locale)}
    </span>
  )
}

/* ══════════════════════════ OwnerBadge ══════════════════════════ */

export interface OwnerBadgeProps {
  ownerId?: string | null
  ownerName?: string | null
  size?: 'sm' | 'md'
  showName?: boolean
  className?: string
}

/**
 * Who owns this — a provisioned teammate or a free-text vendor, rendered
 * IDENTICALLY (spec §3). `useMemberLabel()` is the one resolver:
 * `ownerId → displayName` → `ownerName` → `t('entry.unassigned')`, so an
 * owner_id pointing at a deleted profile falls through to the free-text name
 * and then to "Unassigned" — it never renders a raw uuid at anybody.
 *
 * The initials disc is drawn by `::before` from `data-initials` rather than a
 * child element: the disc is decoration in both modes (the name is either
 * beside it or on the element's aria-label), and generated content keeps this
 * atom to the single registered class name §1.0.7 grants it.
 */
export function OwnerBadge({
  ownerId,
  ownerName,
  size = 'sm',
  showName = true,
  className,
}: OwnerBadgeProps): ReactElement {
  const memberLabel = useMemberLabel()
  useLocale()

  const name = memberLabel(ownerId, ownerName)
  // Trimmed, because owner_name is free text and " " is a real value people
  // produce; an all-space owner is unassigned, not a person with a blank name.
  const assigned = Boolean(ownerId) || Boolean(ownerName?.trim())

  return (
    <span
      className={cx('owner-badge', className)}
      data-size={size}
      data-assigned={assigned ? 'true' : 'false'}
      data-initials={assigned ? initials(name) : ''}
      role={showName ? undefined : 'img'}
      aria-label={showName ? undefined : name}
      title={showName ? undefined : name}
    >
      {showName ? name : null}
    </span>
  )
}

/* ══════════════════════════ TagChip ══════════════════════════ */

export interface TagChipProps {
  tag: string
  active?: boolean
  onToggle?: (tag: string) => void
  onRemove?: (tag: string) => void
  className?: string
}

/**
 * One tag. Three shapes, one component:
 *
 *  · `onToggle`  → a filter chip (`aria-pressed`), which is how filter bars use it
 *  · `onRemove`  → an editable chip with a dismiss control, which is how forms use it
 *  · neither     → a static label, which is how rows and the digest use it
 *
 * The two handlers are never passed together, and that is enforced by shape
 * rather than asserted: a chip that both toggles and removes would have to nest
 * a <button> inside a <button>, which is invalid HTML and unpredictable to
 * every assistive technology that has to guess what the click meant.
 *
 * The dismiss glyph is drawn in CSS from two pseudo-elements, so the button has
 * NO text content and its aria-label is the whole accessible name — no stray
 * "×" for a screen reader to read out as "multiplication sign".
 */
export function TagChip({ tag, active, onToggle, onRemove, className }: TagChipProps): ReactElement {
  useLocale()

  if (onRemove) {
    return (
      <span className={cx('chip', 'tag-chip', className)} data-removable="true">
        {tag}
        <button
          type="button"
          aria-label={t('entry.removeTag', { name: tag })}
          onClick={() => onRemove(tag)}
        />
      </span>
    )
  }

  if (onToggle) {
    return (
      <button
        type="button"
        className={cx('chip', 'tag-chip', className)}
        aria-pressed={active ?? false}
        onClick={() => onToggle(tag)}
      >
        {tag}
      </button>
    )
  }

  return <span className={cx('chip', 'tag-chip', className)}>{tag}</span>
}

/* ══════════════════════════ TrackDot ══════════════════════════ */

export interface TrackDotProps {
  trackId?: string | null
  variant?: 'dot' | 'bar' | 'glyph' | 'chip'
  showLabel?: boolean
  className?: string
}

/**
 * A track's identity mark, in the four shapes the product needs: a disc in a
 * meta line, a 3px bar down the reading edge of a row, the track's own glyph,
 * or a labelled chip.
 *
 * The two stored hexes go out as `--track-c-dark` / `--track-c-light` on the
 * WRAPPER and inherit down to the `.track-dot` / `.track-glyph` / `.track-bar`
 * primitive, which is where global.css resolves them to `--track-color`. That
 * indirection is the whole point — see this file's header.
 *
 * MISSING TRACK IS A NORMAL STATE, not an error: null `track_id`, a track
 * archived out of the map, a row painted from cache before the track list has
 * loaded. All three land on a neutral --field-border mark labelled
 * `entry.noTrack`, and none of them throws.
 */
export function TrackDot({
  trackId,
  variant = 'dot',
  showLabel = false,
  className,
}: TrackDotProps): ReactElement {
  const tracks = useTrackMap()
  const trackLabel = useTrackLabel()
  useLocale()

  const track = trackId ? tracks.get(trackId) : undefined
  const label = track ? trackLabel(track) : t('entry.noTrack')
  const style = track ? trackVars(track.color, track.color_light) : undefined
  const Glyph = trackIcon(track?.icon ?? '')
  // A chip is a label by definition — an unlabelled one is just a worse dot.
  const labelled = showLabel || variant === 'chip'

  return (
    <span
      className={cx(
        variant === 'chip' && 'chip',
        'track-ref',
        variant === 'bar' && 'track-bar',
        className,
      )}
      data-variant={variant}
      style={style}
      role={labelled ? undefined : 'img'}
      aria-label={labelled ? undefined : label}
      title={labelled ? undefined : label}
    >
      {variant === 'glyph' ? (
        <span className="track-glyph">
          <Glyph size={16} />
        </span>
      ) : null}
      {variant === 'dot' || variant === 'chip' ? <span className="track-dot" /> : null}
      {labelled ? label : null}
    </span>
  )
}

/* ══════════════════════════ DueLabel ══════════════════════════ */

export interface DueLabelProps {
  date: IsoDate | null
  kind?: 'due' | 'followUp'
  /** Injectable "today" so a list renders one consistent day and tests are fixed. */
  today?: IsoDate
  showIcon?: boolean
  className?: string
}

/**
 * A due date or a follow-up date, coloured by how close it is.
 *
 * Returns NULL when there is no date. A row with no due date should show
 * nothing there, not an em dash — the meta line is already dense, and an empty
 * slot per row is four wasted characters times sixty rows.
 *
 * The tone is computed from `diffDays(today, date)` rather than from
 * `v_entry_health`, because this atom also renders FOLLOW-UP dates, which the
 * view does not model, and optimistic rows, which the view has never seen.
 * `lib/dates` works in LOCAL calendar days on purpose: "due today" has to mean
 * the user's today, even though the view counts against UTC and the two
 * disagree by a day near midnight. That drift is accepted and documented in
 * lib/dates.ts's header; do not "fix" it here.
 */
export function DueLabel({
  date,
  kind = 'due',
  today,
  showIcon = true,
  className,
}: DueLabelProps): ReactElement | null {
  const locale = useLocale()

  if (!date) return null

  const delta = diffDays(today ?? todayIso(), date)
  const tone = delta < 0 ? 'overdue' : delta === 0 ? 'today' : delta <= 7 ? 'soon' : 'later'
  // The kind is not inferable from the date, and "12 Aug" alone does not say
  // whether it is a promise to someone else or a reminder to yourself.
  const label = `${t(kind === 'due' ? 'entry.due' : 'entry.followUp')}: ${formatDue(date, locale)}`

  return (
    <span
      className={cx('due-label', 'tabular', className)}
      data-kind={kind}
      data-tone={tone}
      role="img"
      aria-label={label}
      title={label}
    >
      {showIcon ? <IconClock size={13} /> : null}
      {formatDue(date, locale)}
    </span>
  )
}
