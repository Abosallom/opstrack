// Multi-select over a known tag set — the filter bar's tag facet.
//
// AND SEMANTICS, and the caller says so in its hint: `lib/entryFilter.ts`
// requires a row to carry EVERY listed tag, not any of them. That is the right
// default for a filter people use to narrow ("portal AND escalation"), and it
// is also the one that surprises, so the difference belongs in a visible
// sentence rather than in a comment.
//
// The editable counterpart is `fields/TagsField.tsx`. This one never invents a
// tag: it toggles values that already exist in the data or on the track, which
// is what stops a filter offering a typo as a category.

import { type ReactElement } from 'react'
import { ChipToggles, type PickerOption } from './OptionGroup'
import './pickers.css'

export interface TagPickerProps {
  label: string
  /** The vocabulary to offer — tags present in the data, plus a track's suggestions. */
  available: readonly string[]
  value: readonly string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
}

export function TagPicker({
  label,
  available,
  value,
  onChange,
  disabled,
  className,
}: TagPickerProps): ReactElement {
  // A selected tag that is no longer in the data still has to render, or a
  // filter restored from a URL silently loses a facet it is still applying and
  // the result set looks broken.
  const orphans = value.filter((v) => !available.includes(v))
  const options: PickerOption[] = [...available, ...orphans].map((tag) => ({
    key: tag,
    label: tag,
    retired: orphans.includes(tag),
  }))

  return (
    <ChipToggles
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={className}
    />
  )
}
