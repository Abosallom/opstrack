// THE MODE FRAME — the one guaranteed way back to the map, and the ONLY chrome
// a mode is allowed to grow.
//
// A MODE IS A SURFACE THE MAP ENTERS AND LEAVES, and a route is exactly how you
// do that with Back, print, paste and deep links intact. `/meetings`,
// `/meetings/:id`, `/meetings/:id/triage`, `/meetings/:id/minutes` and `/digest`
// are not moving onto a canvas: fast typing and a printed document both fight a
// canvas, and a meeting starting while people walk into a room cannot afford a
// pan/zoom/hunt. What they lose in the collapse is their tab-bar slot, and what
// this frame gives back is a fixed, always-present target to the one destination
// the app now has.
//
// ── WHAT THIS COMPONENT DELIBERATELY DOES NOT DO ───────────────────────────
//
// 1. IT BINDS NO KEYS. Not Escape, not Enter, not Shift+Enter. Meeting live
//    capture is ZERO pointer interactions — type, Enter, the box clears
//    synchronously, the line appears above, focus never leaves — and Shift+Enter
//    files a line as a note. A frame-level `onKeyDown` sitting above that input
//    would see every one of those keystrokes on the way up. Escape already has
//    four claimants and a decided order (MapPanel.tsx's header): a lifted drag,
//    then lib/overlayStack's LIFO top, then the composer, then the phone sheet,
//    then the drill-in. A fifth claim here would be the one that breaks it.
//    ModeFrame.test.tsx asserts the absence rather than trusting this comment.
//
// 2. IT RENDERS NO HEADING. Every screen it wraps already owns an `<h1>`, and
//    two of them are the thing the reader actually needs: MeetingLive's is the
//    MEETING'S NAME and MeetingMinutes' is the document's. `titleKey` is a
//    literal i18n key by contract, so a frame-level `<h1>` could only ever say
//    "Meeting" where the screen says "Weekly network sync". The key names the
//    frame's region and renders as the trail's current step instead — which is
//    orientation, not a second title. See `discoveries` in this unit's report.
//
// 3. IT WRAPS NOTHING IN A NEW SCROLLER, remounts nothing, and adds no
//    transition. `startMeetingsRealtime()` is ref-counted by the two screens
//    that render lines and `flushLinePlans()` runs in the triage screen's
//    unmount cleanup; a frame that changed where those screens mount, or that
//    keyed them on anything, would silently lose a second attendee's lines or
//    the last triage decision. `children` is rendered straight through, once.
//
// ── THE WAY BACK IS A LINK TO A ROUTE, NEVER `history.back()` ───────────────
//
// `/entry/:id`, `/meetings/:id` and `/digest` are the targets of push
// notifications (`sw.js`'s `opstrack:navigate`), chat links and the share sheet,
// so a mode is very often the FIRST entry in the history stack. `navigate(-1)`
// there goes nowhere, or worse, back out of the app. A `<Link>` to the map is
// the same one tap from every arrival path, and it is a real anchor, so
// middle-click and long-press-open-in-new-tab keep working.
//
// ── PRINT ──────────────────────────────────────────────────────────────────
//
// The digest and the minutes are printed, PDF'd and pasted, and `digest.css` /
// `minutes.css` / `global.css` already hide the page chrome under
// `@media print`. This frame ADDS chrome, so `map-mode.css` hides its own trail
// and the mode bar in the same at-rule. Chrome introduced by a frame that the
// frame does not also un-introduce is a wasted first page.

import { type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowStart, IconChevronEnd } from '../icons'
import { t } from '../../lib/i18n'
import './map-mode.css'

/**
 * The one destination. A module constant rather than an export: this file's only
 * public value is the component (oxlint's `only-export-components`), and
 * MapModeBar keeps its own copy for the same reason.
 *
 * NOT `/opstrack/mindtree` — the Pages base path is the router's `basename`, and
 * spelling it here would double it.
 */
const MAP_ROUTE = '/mindtree'

export interface ModeFrameProps {
  /** Literal i18n key for the mode's own title. */
  titleKey: string
  /** true = the mode wants the full shell width (live capture, triage, minutes). */
  wide?: boolean
  children: ReactNode
}

export default function ModeFrame({ titleKey, wide, children }: ModeFrameProps): ReactElement {
  return (
    <div className="mmode-frame" data-wide={wide === true ? '' : undefined}>
      {/* The trail, not a landmark. A second `<nav>` on the page would need a
          name of its own to be distinguishable from the app's primary
          navigation, and two links do not earn a landmark — they earn being
          easy to hit, which is what `.tap-44` is for. */}
      <div className="mmode-trail">
        <Link className="mmode-back btn btn-sm btn-ghost tap-44" to={MAP_ROUTE}>
          {/* `icon-directional` at the CALL SITE, per icons.tsx's contract: the
              arrow means "the way I came from", which is the inline-start edge
              in English and the inline-end edge in Arabic. */}
          <IconArrowStart size={16} className="icon-directional" />
          <span>{t('nav.map')}</span>
        </Link>

        <IconChevronEnd size={13} className="mmode-sep icon-directional" />

        {/* The current step. A plain span: the screen below owns the heading, and
            an `<h2>` here would insert a level above the `<h1>` it precedes. */}
        <span className="mmode-where">{t(titleKey)}</span>
      </div>

      {children}
    </div>
  )
}
