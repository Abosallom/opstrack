// The editable tag list: chips with a remove control, a text input that commits
// on Enter or comma, and the track's suggested tags one tap away.
//
// DEDUPED THROUGH foldKey(), NOT by string equality. `#it-ops`, `#IT_Ops` and
// `#itops` are one intent typed three ways, and a tag vocabulary that lets all
// three exist stops being a filter — the follow-ups screen then shows three
// chips that each hold a third of the work. The FIRST spelling wins, so the
// team's own convention survives the first person who typed it rather than
// being flattened to lowercase by the component.
//
// Comma is a separator because pasting `portal, direct-integration` is how a
// list arrives from a chat message, and because a comma inside a tag would
// break every CSV export in the app anyway.
//
// This is NOT the entry kit's TagChip. That atom renders 200 times on a board
// and is a display mark with an optional filter toggle; this is a control with
// a remove button, a focus ring and a hit target. Sharing one component would
// put an editor's affordances into a list row.

import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { Field } from './Field'
import { IconClose, IconPlus } from './glyphs'
import { foldKey } from '../../lib/text'
import './fields.css'

export interface TagsFieldProps {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  /**
   * The input's accessible name — the entry sheet passes t('entry.addTag');
   * meeting triage will pass its own namespace's word for the same control.
   *
   * EVERY USER-VISIBLE STRING IS A PROP HERE, not a t() call inside the
   * component. These primitives are consumed by the entry sheet, quick capture
   * and meeting triage, and §4.3 is explicit that keys are namespaced by
   * FEATURE and never reused across namespaces — so a `common.addTag` invented
   * for this file would be the fourteenth status string all over again. The
   * caller owns its own words.
   */
  addLabel: string
  /** The remove button's accessible name, e.g. t('entry.removeTag', { name }). */
  removeLabel: (tag: string) => string
  /** Heading for the suggestion row — t('entry.suggestedTags'). */
  suggestionsLabel?: string
  /** Offered as one-tap chips; anything already applied is filtered out. */
  suggestions?: readonly string[]
  placeholder?: string
  hint?: string
  disabled?: boolean
  maxTags?: number
  className?: string
}

/** Trim, collapse internal whitespace, drop a leading `#` the user typed. */
function cleanTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim()
}

export function TagsField({
  label,
  value,
  onChange,
  addLabel,
  removeLabel,
  suggestionsLabel,
  suggestions,
  placeholder,
  hint,
  disabled,
  maxTags,
  className,
}: TagsFieldProps): ReactElement {
  const [draft, setDraft] = useState('')
  const full = maxTags !== undefined && value.length >= maxTags

  const add = (raw: string): void => {
    const tag = cleanTag(raw)
    if (tag === '' || full) return
    const key = foldKey(tag)
    if (key === '' || value.some((existing) => foldKey(existing) === key)) {
      // Already present in some spelling. Clearing the draft anyway is the
      // right feedback: the tag IS on the entry, which is what the user wanted.
      setDraft('')
      return
    }
    onChange([...value, tag])
    setDraft('')
  }

  const removeAt = (index: number): void => {
    onChange(value.filter((_, i) => i !== index))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter inside a sheet would otherwise submit or bubble to a parent
      // handler; comma would land a separator inside the tag it just committed.
      event.preventDefault()
      add(draft)
      return
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      // The standard chip-input gesture. Only on an EMPTY draft, so backspacing
      // a typo never eats the previous tag.
      removeAt(value.length - 1)
    }
  }

  const open = suggestions?.filter((s) => !value.some((v) => foldKey(v) === foldKey(s))) ?? []

  return (
    <Field label={label} hint={hint} className={className}>
      {/* Not a <ul>: the chips are controls in a row, and a list role makes a
          screen reader announce "list, 3 items" before every single edit. */}
      <div className="fld-tags">
        {value.map((tag, index) => (
          <span key={`${tag}-${index}`} className="chip fld-tag">
            {tag}
            {!disabled && (
              <button
                type="button"
                className="fld-tag-x"
                aria-label={removeLabel(tag)}
                onClick={() => removeAt(index)}
              >
                <IconClose size={14} />
              </button>
            )}
          </span>
        ))}
        {!disabled && !full && (
          <input
            className="fld-tag-input"
            type="text"
            value={draft}
            placeholder={placeholder ?? addLabel}
            aria-label={addLabel}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            // Committing on blur as well as on Enter: a half-typed tag left
            // behind when the user taps Save is nearly always meant to be kept,
            // and the alternative — silently discarding it — is invisible.
            onBlur={() => add(draft)}
          />
        )}
      </div>
      {open.length > 0 && !disabled && !full && (
        <div className="fld-quick">
          {suggestionsLabel && <span className="fld-quick-label">{suggestionsLabel}</span>}
          {open.map((s) => (
            <button key={s} type="button" className="chip fld-suggest" onClick={() => add(s)}>
              <IconPlus size={13} />
              {s}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}
