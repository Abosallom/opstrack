// Controlled text and multi-line inputs, wrapped in `Field`.
//
// Thin on purpose: the styling is global.css's `.input`, the layout is
// `Field`, and what these add is the id/label wiring and the aria-invalid /
// aria-describedby pair that a hand-rolled <input> in a page keeps forgetting.
// A field whose error is only visible is not an error for anyone using a screen
// reader.
//
// `value` is always a string, never `string | null`. A null threaded into a
// React input silently switches it to uncontrolled, and the symptom — typing
// works until the first re-render, then the field reverts — surfaces two
// screens away from the null. Callers coalesce at the boundary.

import { useId, type KeyboardEvent, type ReactElement } from 'react'
import { Field } from './Field'
import './fields.css'

export interface TextFieldProps {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  hint?: string
  /** An already-translated sentence, not a key. */
  error?: string
  optionalLabel?: string
  disabled?: boolean
  maxLength?: number
  /** `type` is limited to the text-ish set; dates go through DateField. */
  type?: 'text' | 'url' | 'search'
  inputMode?: 'text' | 'url' | 'search'
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  className?: string
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  optionalLabel,
  disabled,
  maxLength,
  type = 'text',
  inputMode,
  onKeyDown,
  className,
}: TextFieldProps): ReactElement {
  const id = useId()
  const messageId = `${id}-msg`
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint}
      error={error}
      optionalLabel={optionalLabel}
      className={className}
    >
      <input
        id={id}
        className="input"
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </Field>
  )
}

export interface TextAreaFieldProps {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  hint?: string
  error?: string
  optionalLabel?: string
  disabled?: boolean
  maxLength?: number
  rows?: number
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  className?: string
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  optionalLabel,
  disabled,
  maxLength,
  rows = 3,
  onKeyDown,
  className,
}: TextAreaFieldProps): ReactElement {
  const id = useId()
  const messageId = `${id}-msg`
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint}
      error={error}
      optionalLabel={optionalLabel}
      className={className}
    >
      <textarea
        id={id}
        className="input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </Field>
  )
}
