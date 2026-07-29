// LinkList — the READ side of `entries.links`, the jsonb array of {label, url}.
//
// LinksField (components/fields) is the editor; this is what the sheet, the
// digest preview and a read-only meeting note render. They are two components
// rather than one with a `readOnly` flag because the editor carries three input
// controls, a URL normaliser and an error line, and none of that should be in
// the bundle of a screen that only displays.
//
// SCHEME SAFETY IS RE-CHECKED HERE, not trusted from the editor. `links` is a
// jsonb column with no CHECK: a row can arrive from the SQL editor, from a
// bulk commit, from an older build, or from a teammate running a different
// version — and a `javascript:` URL rendered as a real anchor that a colleague
// clicks from a shared entry is stored XSS. `rel="noreferrer noopener"` does
// nothing about a scheme the browser executes in the current document, so the
// scheme is the gate and an unsafe one renders as plain text.
//
// The label falls back to the host, then to the raw URL: a link whose label was
// lost still has to be clickable, and an empty anchor is a keyboard trap with no
// accessible name.

import type { ReactElement } from 'react'
import { t, useLocale } from '../../lib/i18n'
import type { EntryLink } from '../../types'
import { IconClose } from '../fields/glyphs'
import './entry.css'

export interface LinkListProps {
  links: EntryLink[]
  /** Absent ⇒ no remove affordance, whatever `readOnly` says. */
  onRemove?: (i: number) => void
  readOnly?: boolean
  className?: string
}

/** Schemes that may be rendered as a live anchor. Everything else is text. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:']

/** @returns the href to render, or null when the URL is not safe to link. */
function safeHref(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed === '') return null
  try {
    const parsed = new URL(trimmed)
    return SAFE_SCHEMES.includes(parsed.protocol) ? parsed.href : null
  } catch {
    // Not an absolute URL. It is NOT re-parsed against a base here: guessing
    // `https://` for stored data would turn a malformed row into a live link to
    // somewhere nobody chose. The editor guesses; the reader does not.
    return null
  }
}

/** What the anchor says when the stored label is blank. */
function displayLabel(link: EntryLink): string {
  const label = link.label.trim()
  if (label) return label
  try {
    return new URL(link.url).host || link.url
  } catch {
    return link.url
  }
}

export default function LinkList({
  links,
  onRemove,
  readOnly,
  className,
}: LinkListProps): ReactElement {
  // Subscribed so the empty sentence and the remove label re-render on a
  // language switch — t() is a plain function and cannot know its output went
  // stale.
  useLocale()

  if (links.length === 0) {
    return (
      <p className={`link-list link-list-empty${className ? ` ${className}` : ''}`}>
        {t('entry.noLinks')}
      </p>
    )
  }

  return (
    <ul className={`link-list${className ? ` ${className}` : ''}`}>
      {links.map((link, i) => {
        const href = safeHref(link.url)
        const label = displayLabel(link)
        return (
          // Index keys are correct here and only here: `links` is an ordered
          // array with no stable id, and the list is re-rendered wholesale from
          // the row every time it changes.
          <li className="link-list-item" key={`${link.url}:${i}`}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                title={link.url}
                aria-label={t('entry.openLink', { label })}
              >
                {label}
              </a>
            ) : (
              // Shown, not hidden: a row whose address cannot be linked is
              // still information the user stored, and silently dropping it
              // would read as data loss.
              <span className="link-list-unsafe" title={link.url}>
                {label}
              </span>
            )}
            {!readOnly && onRemove && (
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label={t('entry.removeLink')}
                onClick={() => onRemove(i)}
              >
                <IconClose />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
