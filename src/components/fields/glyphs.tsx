// Four line glyphs the composite layer needs and `components/icons.tsx` does
// not yet publish.
//
// TEMPORARY BY DESIGN, and the handoff note says so. icons.tsx is a single-owner
// file for exactly the reason the plan gives — one worker enumerates every glyph
// up front so no later wave reopens it — and it is being written in this same
// wave by another agent. Importing a name from it that may or may not exist by
// integration time would red the `tsc -b` handshake the whole wave is gated on,
// and editing it here would break the one-owner-per-file rule outright. So these
// four live in the file set this worker owns, drawn to the same recipe (24 grid,
// currentColor stroke, 1.8 weight, round joins, aria-hidden), and the integrator
// swaps the imports for the icons.tsx exports at the wave close. They are the
// smallest set that could not be avoided: a dialog needs a close control, an
// editable list needs add and remove, and a disclosure needs a chevron.
//
// The chevron is NOT directional and deliberately carries no `icon-directional`
// class: it points DOWN (open) or up (closed), and the vertical axis reads the
// same in both writing directions. The global mirror rule is for chevrons that
// point along the inline axis.

import type { ReactElement, ReactNode } from 'react'

export interface GlyphProps {
  className?: string
  /** Square edge length in px. 24 is the design grid; 44px targets come from padding. */
  size?: number
}

function glyph(children: ReactNode): (props: GlyphProps) => ReactElement {
  return function Glyph({ className, size = 24 }: GlyphProps): ReactElement {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {children}
      </svg>
    )
  }
}

/** Dismiss — a sheet's close button, a chip's remove control. */
export const IconClose = glyph(<path d="M6 6l12 12M18 6 6 18" />)

/** Add — a tag, a link row. */
export const IconPlus = glyph(<path d="M12 5v14M5 12h14" />)

/** Disclosure. Rotated by CSS when its section is open; never mirrored in RTL. */
export const IconChevronDown = glyph(<path d="m6 9.5 6 6 6-6" />)

/** Selected — a multi-select chip, a committed field. */
export const IconCheck = glyph(<path d="m5 12.5 4.5 4.5L19 7.5" />)
