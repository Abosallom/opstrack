// A calendar date — a Postgres `date`, never an instant.
//
// It is a native `<input type="date">` and that is a decision, not laziness.
// The native control's VALUE is always `YYYY-MM-DD` regardless of locale, which
// is exactly the IsoDate the column stores, while its DISPLAY and its picker
// come from the platform in the user's own language and calendar preferences —
// including the one on the phone this app is mainly used on. A hand-rolled
// calendar grid would have to re-derive month lengths, week starts and Arabic
// month names, and every one of those is a place to disagree with lib/dates.ts.
//
// The quick-set chips exist because the two dates people actually pick are
// today and tomorrow, and on a phone the native picker is three taps away from
// either. They go through lib/dates so "today" is the user's LOCAL today —
// `new Date().toISOString().slice(0,10)` is UTC and is yesterday for anyone
// west of Greenwich after 3pm, which is the bug this whole module exists to
// avoid.

import { useId, type ReactElement } from 'react'
import { Field } from './Field'
import { IconClose } from './glyphs'
import { addDays, todayIso, type IsoDate } from '../../lib/dates'
import { t } from '../../lib/i18n'
import './fields.css'

export interface DateFieldProps {
  label: string
  value: IsoDate | null
  onChange: (next: IsoDate | null) => void
  hint?: string
  error?: string
  optionalLabel?: string
  disabled?: boolean
  /**
   * The clear button's accessible name — t('entry.clearDue'). Defaults to
   * t('common.clear'), which is genuinely cross-cutting and already exists;
   * a caller with a more specific word in its own namespace passes it.
   */
  clearLabel?: string
  /** Renders Today / Tomorrow / Next week chips under the input. */
  quickSet?: boolean
  className?: string
}

export function DateField({
  label,
  value,
  onChange,
  hint,
  error,
  optionalLabel,
  disabled,
  clearLabel,
  quickSet,
  className,
}: DateFieldProps): ReactElement {
  const id = useId()
  const messageId = `${id}-msg`

  // Computed per render rather than memoised: it is three string operations,
  // and a memo keyed on nothing would hand back yesterday's "today" to a tab
  // left open overnight — which is the exact class of bug this field is careful
  // about everywhere else.
  const quick = quickSet
    ? [
        { key: 'date.today', iso: todayIso() },
        { key: 'date.tomorrow', iso: addDays(todayIso(), 1) },
        { key: 'date.nextWeek', iso: addDays(todayIso(), 7) },
      ]
    : []

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint}
      error={error}
      optionalLabel={optionalLabel}
      className={className}
    >
      <div className="fld-date">
        <input
          id={id}
          className="input fld-date-input"
          type="date"
          // The empty string is the native control's "no value". Passing null
          // would flip it to uncontrolled and it would stop clearing.
          value={value ?? ''}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
        {value !== null && !disabled && (
          <button
            type="button"
            className="btn btn-ghost btn-icon fld-date-clear"
            aria-label={clearLabel ?? t('common.clear')}
            onClick={() => onChange(null)}
          >
            <IconClose size={18} />
          </button>
        )}
      </div>
      {quick.length > 0 && !disabled && (
        <div className="fld-quick">
          {quick.map((q) => (
            <button
              key={q.key}
              type="button"
              className="chip"
              aria-pressed={value === q.iso}
              onClick={() => onChange(value === q.iso ? null : q.iso)}
            >
              {t(q.key)}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}
