// The entry's `links` jsonb array: a label and a URL, editable as a short list.
//
// The URL is normalised, not validated to death. A ticket reference pasted out
// of a browser bar arrives as `portal.example.com/T-4821` about as often as it
// arrives with a scheme, and rejecting it teaches people to give up on the
// field rather than to type `https://`. So a bare host gets `https://`
// prepended and anything that still will not parse is refused with one
// sentence.
//
// `javascript:` and `data:` URLs are refused outright. These render as real
// anchors that a teammate clicks from a shared entry, which is the definition
// of a stored-XSS delivery path — and `rel="noreferrer noopener"` on the anchor
// does nothing about a scheme the browser executes in the current document.

import { useState, type ReactElement } from 'react'
import { Field } from './Field'
import { IconClose, IconPlus } from './glyphs'
import type { EntryLink } from '../../types'
import './fields.css'

export interface LinksFieldProps {
  label: string
  value: EntryLink[]
  onChange: (next: EntryLink[]) => void
  /**
   * Every user-visible string is a prop, for the reason TagsField's header
   * gives: these primitives serve three features and §4.3 forbids one key
   * doing duty in more than one namespace.
   */
  addLabel: string
  labelPlaceholder: string
  urlPlaceholder: string
  removeLabel: (label: string) => string
  /** Shown when the address cannot be made into one — t('entry.errLinkUrl'). */
  errorLabel: string
  hint?: string
  disabled?: boolean
  maxLinks?: number
  className?: string
}

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:']

/**
 * @returns the normalised absolute URL, or null when it cannot be one safely.
 */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // A scheme-less host is the common paste; try it as https before giving up.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    if (!SAFE_SCHEMES.includes(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function LinksField({
  label,
  value,
  onChange,
  addLabel,
  labelPlaceholder,
  urlPlaceholder,
  removeLabel,
  errorLabel,
  hint,
  disabled,
  maxLinks = 8,
  className,
}: LinksFieldProps): ReactElement {
  const [draftLabel, setDraftLabel] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [invalid, setInvalid] = useState(false)
  const full = value.length >= maxLinks

  const add = (): void => {
    const url = normalizeUrl(draftUrl)
    if (url === null) {
      setInvalid(true)
      return
    }
    // An unlabelled link shows its host, which is more useful in a list than
    // the full URL and more honest than inventing a title.
    const fallback = ((): string => {
      try {
        return new URL(url).hostname
      } catch {
        return url
      }
    })()
    onChange([...value, { label: draftLabel.trim() || fallback, url }])
    setDraftLabel('')
    setDraftUrl('')
    setInvalid(false)
  }

  return (
    <Field label={label} hint={hint} error={invalid ? errorLabel : undefined} className={className}>
      {value.length > 0 && (
        <ul className="fld-links">
          {value.map((link, index) => (
            <li key={`${link.url}-${index}`} className="fld-link">
              <a
                className="fld-link-a"
                href={link.url}
                target="_blank"
                // noreferrer implies noopener, but both are named: an audit
                // grep for one of them has to find this line.
                rel="noreferrer noopener"
              >
                {link.label}
              </a>
              {!disabled && (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={removeLabel(link.label)}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  <IconClose size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && !full && (
        <div className="fld-link-add">
          <input
            className="input fld-link-label"
            type="text"
            value={draftLabel}
            placeholder={labelPlaceholder}
            aria-label={labelPlaceholder}
            onChange={(e) => setDraftLabel(e.target.value)}
          />
          <input
            className="input fld-link-url"
            type="url"
            inputMode="url"
            value={draftUrl}
            placeholder={urlPlaceholder}
            aria-label={urlPlaceholder}
            aria-invalid={invalid ? true : undefined}
            onChange={(e) => {
              setDraftUrl(e.target.value)
              if (invalid) setInvalid(false)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              add()
            }}
          />
          <button
            type="button"
            className="btn btn-sm fld-link-btn"
            // aria-disabled rather than disabled so the control stays focusable
            // and its name is still announced; global.css dims both.
            aria-disabled={draftUrl.trim() === '' || undefined}
            onClick={() => {
              if (draftUrl.trim() !== '') add()
            }}
          >
            <IconPlus size={16} />
            {addLabel}
          </button>
        </div>
      )}
    </Field>
  )
}
