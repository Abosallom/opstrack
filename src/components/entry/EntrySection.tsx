// EntrySection — a titled, counted group of rows. Follow-ups' five buckets, the
// board's column headers and the track timeline all render this, so the
// "Overdue (4)" heading looks and behaves the same in every one of them.
//
// THE COUNT IS A PROP, NOT `children.length`. A section may render a virtualised
// slice, a "+12 more" tail, or nothing at all while its data loads, and in every
// one of those cases the number in the heading has to be the number of items the
// bucket HOLDS. Counting what happens to be mounted would make the heading lie
// on exactly the screens where the number matters most.
//
// COLLAPSIBLE USES A REAL <button> WITH aria-expanded, not a <details>. The
// board needs the same header without a disclosure, follow-ups animates its
// body, and `<details>` gives neither — while a div with an onClick gives no
// keyboard, no role and no announced state. The body is unmounted when
// collapsed rather than hidden with CSS: a collapsed section of sixty rows
// still costs sixty renders on every realtime patch if it stays mounted.
//
// The heading level is `h2` and fixed on purpose: every screen that uses this
// puts it directly under the shell's single `h1`. A `level` prop would let one
// screen skip from h1 to h3 and no test would ever catch it.

import { useId, useState, type ReactElement, type ReactNode } from 'react'
import { t, useLocale } from '../../lib/i18n'
import { IconChevronDown } from '../fields/glyphs'
import './entry.css'

export interface EntrySectionProps {
  id: string
  title: string
  count: number
  tone?: 'danger' | 'warn' | 'default'
  collapsible?: boolean
  /** Rendered instead of `children` at count 0. Absent ⇒ t('entry.sectionEmpty'). */
  emptyLabel?: string
  /** Start collapsed. Only meaningful with `collapsible`. */
  defaultCollapsed?: boolean
  children: ReactNode
}

export default function EntrySection({
  id,
  title,
  count,
  tone = 'default',
  collapsible,
  emptyLabel,
  defaultCollapsed,
  children,
}: EntrySectionProps): ReactElement {
  useLocale()
  const [collapsed, setCollapsed] = useState(defaultCollapsed === true)
  // Not derived from `id`: two screens can legitimately render a section with
  // the same semantic id (follow-ups' "overdue" and a track page's), and a
  // duplicate DOM id breaks aria-controls for both.
  const bodyId = useId()

  const empty = count === 0
  const open = !collapsible || !collapsed

  const heading = (
    <>
      <span className="entry-section-name">{title}</span>
      {/* The count is its own element so a screen reader announces "Overdue,
          4" rather than running the two together, and so the pill can be
          styled without a wrapper span at every call site. */}
      <span className="entry-section-count">{t('entry.sectionCount', { count })}</span>
    </>
  )

  return (
    <section className={`entry-section tone-${tone}`} data-section={id}>
      <div className="entry-section-head">
        {collapsible ? (
          <h2 className="entry-section-title">
            <button
              type="button"
              className="entry-section-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={
                open
                  ? t('entry.collapseSection', { section: title })
                  : t('entry.expandSection', { section: title })
              }
              onClick={() => setCollapsed((c) => !c)}
            >
              <span className="entry-section-caret" aria-hidden="true" data-open={open}>
                <IconChevronDown />
              </span>
              {heading}
            </button>
          </h2>
        ) : (
          <h2 className="entry-section-title">{heading}</h2>
        )}
      </div>
      {open && (
        <div className="entry-section-body" id={bodyId}>
          {empty ? (
            <p className="entry-section-empty">{emptyLabel ?? t('entry.sectionEmpty')}</p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  )
}
