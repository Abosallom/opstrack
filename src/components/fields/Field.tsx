// The two shapes a labelled control takes in this app.
//
// `Field` is the stacked form field — label above, control, then a hint or an
// error. It is what a full-page form (capture, the vocabulary editor) uses.
//
// `FieldRow` is the same information turned on its side: a quiet label at the
// reading start and the value/control at the reading end. That is the entry
// sheet's shape, because a detail panel is read as a table of facts far more
// often than it is edited, and eleven stacked labels turn a 460px panel into a
// scroll.
//
// ERRORS ARRIVE TRANSLATED. Every api/ module returns an i18n KEY and every
// caller in this repo renders it through t() at the point of use (see
// TrackEditor.tsx). Resolving the key inside the field would translate it a
// second time and would freeze the sentence's language at the moment the call
// failed rather than the moment it is read.

import { useId, type ReactElement, type ReactNode } from 'react'
import './fields.css'

export interface FieldProps {
  label: string
  /**
   * The control's id, when the caller renders its own <input>. Omit for a
   * control that carries its own accessible name (a radiogroup, a chip list) —
   * the label then renders as plain text and does not lie about what it labels.
   */
  htmlFor?: string
  /**
   * The id to stamp on the hint/error paragraph, when the caller has already
   * minted one to put in its control's `aria-describedby`.
   *
   * It is a PROP rather than a second useId() here because two useId() calls
   * never collide: TextField, TextAreaField and DateField each minted
   * `${id}-msg`, this component minted its own, and the reference dangled on
   * every field in the app. The consequence was worst on error — aria-invalid
   * announced with no reason attached, which is precisely the failure the
   * wrapper exists to prevent. Optional, because a caller that renders no
   * control of its own has nothing to point at the message.
   */
  messageId?: string
  /** Helper text under the control. Suppressed while `error` is showing. */
  hint?: string
  /** An already-translated sentence, not a key. */
  error?: string
  optionalLabel?: string
  children: ReactNode
  className?: string
}

export function Field({
  label,
  htmlFor,
  messageId,
  hint,
  error,
  optionalLabel,
  children,
  className,
}: FieldProps): ReactElement {
  // The fallback keeps the paragraph identified even when nobody is pointing at
  // it — a caller may add an aria-describedby later, and an element with no id
  // is one more thing to remember.
  const ownId = useId()
  const msgId = messageId ?? ownId
  return (
    <div className={`field fld${className ? ` ${className}` : ''}`}>
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {optionalLabel && <span className="fld-optional"> {optionalLabel}</span>}
        </label>
      ) : (
        <span className="field-label">
          {label}
          {optionalLabel && <span className="fld-optional"> {optionalLabel}</span>}
        </span>
      )}
      {children}
      {/* role="alert" so a validation failure is announced when it appears
          rather than only when the user happens to Tab back to the field. */}
      {error ? (
        <p className="field-error" id={msgId} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p className="fld-hint" id={msgId}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export interface FieldRowProps {
  label: string
  /** Set when the value is a single control the label can point at. */
  htmlFor?: string
  children: ReactNode
  /** Stacks label above value — for a value that needs the full width (tags, links). */
  stacked?: boolean
  className?: string
}

/**
 * One label/value line of the entry sheet.
 *
 * The label column is fixed in the inline axis so eleven rows line up, and it
 * collapses to a stacked layout under 380px where a two-column split leaves the
 * value four characters wide.
 */
export function FieldRow({
  label,
  htmlFor,
  children,
  stacked,
  className,
}: FieldRowProps): ReactElement {
  return (
    <div className={`fld-row${stacked ? ' fld-row-stacked' : ''}${className ? ` ${className}` : ''}`}>
      {htmlFor ? (
        <label className="fld-row-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="fld-row-label">{label}</span>
      )}
      <div className="fld-row-value">{children}</div>
    </div>
  )
}
