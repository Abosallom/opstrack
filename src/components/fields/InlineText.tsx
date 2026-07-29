// Click-to-edit text: the entry sheet's title, description and requester.
//
// WHY A DRAFT AND AN EXPLICIT SAVE, when every other field in the sheet commits
// on change. A picker has four options and no wrong intermediate state, so
// committing on select is honest. A text field passes through every prefix of
// what the user is typing, and committing those would append a row to the
// audit thread per keystroke, race the realtime echo, and — on the title —
// reorder the list under the cursor. So the text fields hold a draft, and Save
// is a deliberate act.
//
// It is still ONE control, not a form: Escape cancels, Enter commits a
// single-line field, Cmd/Ctrl+Enter commits a multi-line one. Blur does NOT
// commit. Auto-saving on blur means tapping "close" saves an edit the user was
// abandoning, and there is no undo on a title.
//
// The read view is a BUTTON, not a div with an onClick. A div is not reachable
// by Tab, is not announced as actionable, and does not respond to Enter — three
// separate ways for a keyboard user to find the entry sheet read-only.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { t } from '../../lib/i18n'
import './fields.css'

export interface InlineTextProps {
  /** The field's name, e.g. t('entry.title'). Announced before the value. */
  label: string
  value: string
  /** Called with the TRIMMED draft, only when it differs from `value`. */
  onCommit: (next: string) => void
  multiline?: boolean
  /** Shown in place of an empty value — already translated. */
  emptyLabel: string
  placeholder?: string
  canEdit?: boolean
  maxLength?: number
  /** Typography class for the read view, e.g. `entry-title`. */
  readClassName?: string
  className?: string
}

export function InlineText({
  label,
  value,
  onCommit,
  multiline,
  emptyLabel,
  placeholder,
  canEdit = true,
  maxLength,
  readClassName,
  className,
}: InlineTextProps): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const readRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Caret at the end rather than selecting everything: the common edit is
    // appending to a title, and a select-all means the first keystroke silently
    // destroys the whole line.
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [editing])

  // A realtime patch from another device changes `value` under an open editor.
  // The draft wins — it is what this user is typing — but a CLOSED read view
  // must show the new server value, which it does because it renders `value`
  // directly. This effect only resyncs the draft while not editing.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  function open(): void {
    setDraft(value)
    setEditing(true)
  }

  function cancel(): void {
    setEditing(false)
    setDraft(value)
    // Focus returns to the control the user was on, not to the top of the
    // sheet. Without this, Escape drops focus on <body> and the next Tab starts
    // over from the close button.
    readRef.current?.focus()
  }

  function commit(): void {
    const next = draft.trim()
    setEditing(false)
    readRef.current?.focus()
    if (next === value) return
    onCommit(next)
  }

  if (!editing) {
    const empty = value.trim().length === 0
    return (
      <button
        ref={readRef}
        type="button"
        className={`fld-inline-read${empty ? ' is-empty' : ''}${
          readClassName ? ` ${readClassName}` : ''
        }${className ? ` ${className}` : ''}`}
        // aria-disabled rather than `disabled`: a read-only field still has to
        // be reachable so its VALUE can be read out. A disabled button is
        // skipped by Tab, which hides the entry's title from a keyboard user
        // whenever they lack edit rights.
        aria-disabled={!canEdit || undefined}
        onClick={() => {
          if (canEdit) open()
        }}
      >
        {/* The field's name, announced before the value, without repeating it
            on screen where the row label is already visible. */}
        <span className="sr-only">{label}</span>
        <span className="fld-inline-text">{empty ? emptyLabel : value}</span>
      </button>
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key !== 'Enter') return
    // A textarea's Enter is a newline; only the modified chord commits it.
    if (multiline && !(event.metaKey || event.ctrlKey)) return
    if (!multiline && event.shiftKey) return
    event.preventDefault()
    commit()
  }

  return (
    <div className={`fld-inline-edit${className ? ` ${className}` : ''}`}>
      {multiline ? (
        <textarea
          ref={(el) => {
            inputRef.current = el
          }}
          className="input"
          rows={4}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          ref={(el) => {
            inputRef.current = el
          }}
          className="input"
          type="text"
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      <div className="fld-inline-actions">
        <button type="button" className="btn btn-sm" onClick={cancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={commit}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
