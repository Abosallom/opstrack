// Who owns this — a provisioned teammate, someone outside the workspace, or
// nobody yet.
//
// `owner_id` and `owner_name` are MUTUALLY EXCLUSIVE columns (types.ts), so
// this control reports both halves at once and always clears the one it is not
// setting. Reporting only the half that changed is how an entry ends up
// displaying two owners after being reassigned from a vendor to a teammate —
// the api layer clears the other side too, but the optimistic local row is what
// the user is looking at for the second before the server answers.
//
// The free-text option is not a lesser path. Half the work in an ops log is
// waiting on a vendor, a contractor or another department, and spec §3 requires
// that a free-text owner display and filter identically to a registered one.
// What it is NOT is a second way to name a teammate: the member list comes
// first, and the text field is one deliberate step further.

import { useEffect, useState, type ReactElement } from 'react'
import { OptionGroup, type PickerOption } from './OptionGroup'
import { initials } from '../../lib/text'
import { useMembers } from '../../store/members'
import './pickers.css'

/** The synthetic key for "someone outside the workspace". Never stored. */
const OTHER = ' other'

export interface OwnerValue {
  ownerId: string | null
  ownerName: string | null
}

export interface OwnerPickerProps {
  label: string
  value: OwnerValue
  onChange: (next: OwnerValue) => void
  /** "Nobody" — t('entry.unassigned'). */
  unassignedLabel: string
  /**
   * The free-text option — t('entry.ownerExternal').
   *
   * A prop, not a t() call: this control serves the entry sheet, capture and
   * meeting triage, and §4.3 forbids one key doing duty across namespaces.
   */
  otherLabel: string
  /** Placeholder for the name field; defaults to `otherLabel`. */
  namePlaceholder?: string
  /** Drops the free-text option — the filter bar has its own owner facets. */
  allowFreeText?: boolean
  disabled?: boolean
  className?: string
}

export function OwnerPicker({
  label,
  value,
  onChange,
  unassignedLabel,
  otherLabel,
  namePlaceholder,
  allowFreeText = true,
  disabled,
  className,
}: OwnerPickerProps): ReactElement {
  const members = useMembers()
  const [draft, setDraft] = useState(value.ownerName ?? '')
  // True once the user has asked for the text field, so it stays open while
  // they are typing a name that is not committed yet.
  const [freeText, setFreeText] = useState(value.ownerName !== null)

  // A realtime patch (or stepping to the next entry, which reuses this
  // component) replaces the value under the control. The draft follows it —
  // this is not a text editor with an unsaved state, it is a picker whose last
  // option happens to be typed.
  useEffect(() => {
    setDraft(value.ownerName ?? '')
    setFreeText(value.ownerName !== null)
  }, [value.ownerName, value.ownerId])

  const options: PickerOption[] = members.map((m) => ({
    key: m.id,
    label: m.displayName,
    mark: (
      <span className="pick-avatar" aria-hidden="true">
        {initials(m.displayName)}
      </span>
    ),
  }))

  if (allowFreeText) {
    options.push({ key: OTHER, label: otherLabel })
  }

  const selected = value.ownerId ?? (value.ownerName !== null || freeText ? OTHER : null)

  const commitName = (): void => {
    const name = draft.trim()
    // An emptied text field means "nobody", not "a person called nothing".
    if (name === '') {
      if (value.ownerName !== null) onChange({ ownerId: null, ownerName: null })
      return
    }
    if (name === value.ownerName) return
    onChange({ ownerId: null, ownerName: name })
  }

  return (
    <div className={`pick-owner${className ? ` ${className}` : ''}`}>
      <OptionGroup
        label={label}
        options={options}
        value={selected}
        clearLabel={unassignedLabel}
        disabled={disabled}
        onChange={(key) => {
          if (key === OTHER) {
            setFreeText(true)
            // Nothing is committed yet: the owner only changes when a name is
            // typed. Committing an empty name here would clear a real owner the
            // moment someone tapped the option to see what it did.
            return
          }
          setFreeText(false)
          setDraft('')
          onChange({ ownerId: key, ownerName: null })
        }}
      />
      {allowFreeText && selected === OTHER && !disabled && (
        <input
          className="input pick-owner-name"
          type="text"
          value={draft}
          placeholder={namePlaceholder ?? otherLabel}
          aria-label={otherLabel}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            commitName()
          }}
        />
      )}
    </div>
  )
}
