// Status, priority and type — the three pickers backed by `vocab_options`.
//
// One implementation, three typed wrappers. The wrappers exist because the
// stored value is a member of a FROZEN union (types.ts) while the store speaks
// in strings, and pushing that cast out to fifteen call sites is how a `'done '`
// with a trailing space eventually reaches the database.
//
// HIDDEN OPTIONS LEAVE THE PICKER BUT NEVER HIDE DATA. An admin who hides
// `waiting_on` stops anyone choosing it tomorrow; the forty entries that hold it
// today still have to render, and still have to be changeable to something
// else. So the current value is re-inserted when it has been hidden, marked
// `retired` — visibly quieter, still selectable, and it disappears from the
// group the moment the user picks anything else. store/vocab.ts's header calls
// this out as frozen behaviour; the board applies the same rule to its columns.
//
// Labels and colours are NOT resolved here. `useVocab()` already returns the
// label for the active locale through the frozen five-step fallback, and the
// colour as the admin's raw hex for vocabVars() to hand to CSS.

import { useMemo, type ReactElement } from 'react'
import { OptionGroup, type PickerOption } from './OptionGroup'
import { useVocab, useVocabAll } from '../../store/vocab'
import type { EntryPriority, EntryStatus, EntryType, VocabKind } from '../../types'
import './pickers.css'

export interface VocabPickerProps {
  kind: VocabKind
  /** The group's accessible name — t('filter.status') and friends. */
  label: string
  value: string | null
  onChange: (key: string) => void
  disabled?: boolean
  layout?: 'chips' | 'list'
  className?: string
}

export function VocabPicker({
  kind,
  label,
  value,
  onChange,
  disabled,
  layout,
  className,
}: VocabPickerProps): ReactElement {
  const visible = useVocab(kind)
  const all = useVocabAll(kind)

  const options = useMemo<PickerOption[]>(() => {
    const items: PickerOption[] = visible.map((v) => ({
      key: v.key,
      label: v.label,
      color: v.color,
    }))
    if (value !== null && !visible.some((v) => v.key === value)) {
      const held = all.find((v) => v.key === value)
      if (held) items.push({ key: held.key, label: held.label, color: held.color, retired: true })
    }
    return items
  }, [visible, all, value])

  return (
    <OptionGroup
      label={label}
      options={options}
      value={value}
      // A radiogroup cannot be un-picked: every entry has a status, a priority
      // and a type, so there is no clear option and null never comes back.
      onChange={(key) => {
        if (key !== null) onChange(key)
      }}
      disabled={disabled}
      layout={layout}
      className={className}
    />
  )
}

/**
 * The cast at the boundary, in ONE place per union.
 *
 * `useVocab('status')` walks FROZEN_KEYS.status, which is the same list
 * EntryStatus is declared from — the two cannot drift without a types.ts edit
 * and a store edit landing together, and store/vocab.ts's header states that
 * the keys are frozen precisely so this holds. A runtime re-validation here
 * would re-check a constant against itself on every click.
 */
export interface StatusPickerProps {
  label: string
  value: EntryStatus
  onChange: (next: EntryStatus) => void
  disabled?: boolean
  layout?: 'chips' | 'list'
  className?: string
}

export function StatusPicker({
  label,
  value,
  onChange,
  disabled,
  layout,
  className,
}: StatusPickerProps): ReactElement {
  return (
    <VocabPicker
      kind="status"
      label={label}
      value={value}
      onChange={(key) => onChange(key as EntryStatus)}
      disabled={disabled}
      layout={layout}
      className={className}
    />
  )
}

export interface PriorityPickerProps {
  label: string
  value: EntryPriority
  onChange: (next: EntryPriority) => void
  disabled?: boolean
  layout?: 'chips' | 'list'
  className?: string
}

export function PriorityPicker({
  label,
  value,
  onChange,
  disabled,
  layout,
  className,
}: PriorityPickerProps): ReactElement {
  return (
    <VocabPicker
      kind="priority"
      label={label}
      value={value}
      onChange={(key) => onChange(key as EntryPriority)}
      disabled={disabled}
      layout={layout}
      className={className}
    />
  )
}

export interface TypePickerProps {
  label: string
  value: EntryType
  onChange: (next: EntryType) => void
  disabled?: boolean
  layout?: 'chips' | 'list'
  className?: string
}

export function TypePicker({
  label,
  value,
  onChange,
  disabled,
  layout,
  className,
}: TypePickerProps): ReactElement {
  return (
    <VocabPicker
      kind="type"
      label={label}
      value={value}
      onChange={(key) => onChange(key as EntryType)}
      disabled={disabled}
      layout={layout}
      className={className}
    />
  )
}
