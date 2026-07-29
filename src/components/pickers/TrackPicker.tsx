// Which track an entry belongs to.
//
// Archived tracks behave exactly as hidden vocabulary options do: they leave
// the picker, but an entry that already points at one still renders it and can
// still be moved off it. A picker that silently dropped the current value would
// show "no track" for an entry that has one, and the first save would make that
// lie true.
//
// The colour mark is `.track-dot` with trackVars() — the two-hex pair handed to
// CSS, never a hex chosen in JavaScript. lib/trackStyle.ts's header has the
// reason: a JS-picked colour is picked once, at render, and keeps yesterday's
// value when the `auto` theme flips at sunset.
//
// It does NOT use the entry kit's TrackDot atom, and that is a layering call
// rather than an oversight: the pickers are the generic control layer the entry
// kit is built ON TOP of, and a picker importing from components/entry would
// make the two folders mutually dependent — capture, the filter bar and the
// meeting triage screen would then drag the whole entry kit in to render a
// dropdown.

import { useMemo, type ReactElement } from 'react'
import { OptionGroup, type PickerOption } from './OptionGroup'
import { t } from '../../lib/i18n'
import { useTrackLabel } from '../../lib/labels'
import { trackVars } from '../../lib/trackStyle'
import { useActiveTracks, useTrackMap } from '../../store/config'
import './pickers.css'

export interface TrackPickerProps {
  /** The group's accessible name — usually t('filter.track'). */
  label: string
  value: string | null
  onChange: (trackId: string | null) => void
  /** Label for the "no track" option. Omit to make the choice mandatory. */
  clearLabel?: string
  disabled?: boolean
  layout?: 'chips' | 'list'
  className?: string
}

export function TrackPicker({
  label,
  value,
  onChange,
  clearLabel,
  disabled,
  layout,
  className,
}: TrackPickerProps): ReactElement {
  const active = useActiveTracks()
  const byId = useTrackMap()
  const trackLabel = useTrackLabel()

  const options = useMemo<PickerOption[]>(() => {
    const build = (id: string, retired?: boolean): PickerOption | null => {
      const track = byId.get(id)
      if (!track) return null
      return {
        key: id,
        label: trackLabel(track),
        retired,
        mark: (
          <span className="track-dot" style={trackVars(track.color, track.color_light)} aria-hidden="true" />
        ),
      }
    }
    const items = active.map((tr) => build(tr.id)).filter((o): o is PickerOption => o !== null)
    if (value !== null && !active.some((tr) => tr.id === value)) {
      const held = build(value, true)
      if (held) items.push(held)
    }
    return items
  }, [active, byId, trackLabel, value])

  return (
    <OptionGroup
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      clearLabel={clearLabel ?? t('common.none')}
      disabled={disabled}
      layout={layout}
      className={className}
    />
  )
}
