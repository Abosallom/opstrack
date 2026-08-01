// Inline monochrome line-icon set.
//
// Every icon is stroke=currentColor with no fill, so an active nav item or a
// tone-coloured button tints its icon just by setting `color` on the parent —
// no per-icon variants, no icon font, no sprite request. strokeWidth 1.8 with
// round joins matches the rest of the family's visual weight.
//
// All icons are aria-hidden: they always sit next to a text label or inside a
// button that carries an aria-label, so exposing them would double-announce.
//
// Icons whose meaning depends on reading direction (chevrons, back arrows)
// must be rendered with className="icon-directional" at the CALL SITE — the
// global rule `[dir='rtl'] .icon-directional { transform: scaleX(-1) }` mirrors
// them. Putting the class inside the icon would mirror it even when it is used
// decoratively (e.g. a chevron pointing down).

import type { ReactElement, ReactNode } from 'react'

export interface IconProps {
  className?: string
  /** Square edge length in px. 24 is the design grid; 44px targets come from padding. */
  size?: number
}

export type IconComponent = (props: IconProps) => ReactElement

/** Wraps a set of <path>/<circle>/… children into a consistent 24-grid icon. */
function icon(children: ReactNode): IconComponent {
  return function Icon({ className, size = 24 }: IconProps): ReactElement {
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

/* ---------- navigation ---------- */

/** Quick capture — a bolt, for "this takes under five seconds". */
export const IconBolt = icon(<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />)

/** Follow-ups — a checklist. */
export const IconChecklist = icon(
  <>
    <path d="m3 6 2 2 3-3M3 13l2 2 3-3M3 20l2 2 3-3" />
    <path d="M12 7h9M12 14h9M12 21h9" />
  </>,
)

/** Board — kanban columns. */
export const IconColumns = icon(
  <>
    <rect x="3" y="4" width="5.5" height="16" rx="1.5" />
    <rect x="9.25" y="4" width="5.5" height="11" rx="1.5" />
    <rect x="15.5" y="4" width="5.5" height="14" rx="1.5" />
  </>,
)

/** Tracks — stacked layers, one per domain. */
export const IconLayers = icon(
  <>
    <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
  </>,
)

/** Meetings — a microphone, for meeting mode's live capture. */
export const IconMic = icon(
  <>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" />
  </>,
)

/** Dashboard — a bar chart. */
export const IconChart = icon(
  <>
    <path d="M4 20V4M4 20h16" />
    <path d="M8.5 20v-5M13 20v-9M17.5 20v-6" />
  </>,
)

/** Settings — a cog.
    Drawn as a toothed silhouette rather than the cheaper circle-plus-six-spokes:
    at the 20px the header renders it, the spoke version reads as a sun and sat
    right next to the actual sun used for the light theme. */
export const IconGear = icon(
  <>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.3 13.1a7.5 7.5 0 0 0 0-2.2l1.9-1.5-1.9-3.3-2.3.9a7.5 7.5 0 0 0-1.9-1.1L14.7 3.5h-3.8l-.4 2.4c-.7.3-1.3.6-1.9 1.1l-2.3-.9-1.9 3.3 1.9 1.5a7.5 7.5 0 0 0 0 2.2l-1.9 1.5 1.9 3.3 2.3-.9c.6.5 1.2.8 1.9 1.1l.4 2.4h3.8l.4-2.4c.7-.3 1.3-.6 1.9-1.1l2.3.9 1.9-3.3-1.9-1.5z" />
  </>,
)

/* ---------- theme & language ---------- */

export const IconSun = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
  </>,
)

export const IconMoon = icon(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />)

/** "Auto" theme — follows the OS, so: a display. */
export const IconMonitor = icon(
  <>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8.5 21h7M12 17v4" />
  </>,
)

export const IconGlobe = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.2 9.5h17.6M3.2 14.5h17.6" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
  </>,
)

/* ---------- account & status ---------- */

export const IconMail = icon(
  <>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </>,
)

/** One-time passcode — a key. */
export const IconKey = icon(
  <>
    <circle cx="8" cy="14" r="4.2" />
    <path d="m11.2 11.2 8-8M17 5.5l2.2 2.2M14.8 7.7 17 9.9" />
  </>,
)

export const IconUser = icon(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </>,
)

export const IconUsers = icon(
  <>
    <circle cx="9.5" cy="8.5" r="3.5" />
    <path d="M3 20.5a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.4a3.5 3.5 0 0 1 0 6.2M17.5 15.2a6.5 6.5 0 0 1 3.5 5.3" />
  </>,
)

/** Admin — a shield with a tick. */
export const IconShieldCheck = icon(
  <>
    <path d="M12 3 5 6v5.2c0 4.4 2.9 7.9 7 9.8 4.1-1.9 7-5.4 7-9.8V6l-7-3z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </>,
)

export const IconLogOut = icon(
  <>
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M10 8 6 12l4 4M6 12h9" />
  </>,
)

export const IconWifiOff = icon(
  <>
    <path d="M3 3.5 21 21" />
    <path d="M2.5 8.7a16 16 0 0 1 5-3.1M12 4.5a16 16 0 0 1 9.5 4.2" />
    <path d="M6 12.4a11 11 0 0 1 3-1.9M15.4 11.2a11 11 0 0 1 2.6 1.7" />
    <path d="M9.3 16a6 6 0 0 1 5.5.4" />
    <circle cx="12" cy="19.5" r="0.9" fill="currentColor" stroke="none" />
  </>,
)

/** A single entry / record. */
export const IconFile = icon(
  <>
    <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3z" />
    <path d="M13.5 3v5.5H19M8.5 13h7M8.5 17h5" />
  </>,
)

export const IconClock = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6.8V12l3.4 2" />
  </>,
)

/** Generic "not built yet" marker for placeholder pages. */
export const IconCompass = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2z" />
  </>,
)

/* ---------- track identity ----------
   Glyphs an admin can assign to a track in the picker (see lib/trackIcons.ts,
   which owns the name -> component mapping the database column stores).
   Drawn to survive 18–20px, which is the size a track row actually renders at:
   no detail finer than ~1px of the 24 grid, and nothing that collapses into a
   grey smudge when the stroke is 1.8 wide. */

/** Fallback for an unrecognised icon name — deliberately the plainest mark. */
export const IconCircle = icon(<circle cx="12" cy="12" r="8" />)

export const IconClipboardList = icon(
  <>
    <rect x="4" y="4" width="16" height="17" rx="2.5" />
    <rect x="8.5" y="2" width="7" height="4" rx="1.5" />
    <circle cx="8.7" cy="10.8" r="0.65" fill="currentColor" stroke="none" />
    <circle cx="8.7" cy="14.4" r="0.65" fill="currentColor" stroke="none" />
    <circle cx="8.7" cy="18" r="0.65" fill="currentColor" stroke="none" />
    <path d="M11.4 10.8h4.8M11.4 14.4h4.8M11.4 18h4.8" />
  </>,
)

export const IconServer = icon(
  <>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <circle cx="6.5" cy="7.5" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="16.5" r="0.7" fill="currentColor" stroke="none" />
    <path d="M14 7.5h4M14 16.5h4" />
  </>,
)

/** Managed infrastructure — a rack plus a cog. The lower unit is shortened
    rather than left open-ended, which read as a stray bracket next to the cog.

    Two details keep the cog from turning into the sun that IconGear above
    already refused to draw, and which would otherwise sit a few rows away in
    the same picker: the teeth START at the rim instead of floating outside it
    (a gap turns teeth into rays), and the hub is a filled hole. */
export const IconServerCog = icon(
  <>
    <rect x="2.5" y="3.5" width="19" height="7" rx="2" />
    <circle cx="6.2" cy="7" r="0.7" fill="currentColor" stroke="none" />
    <path d="M14 7h4" />
    <rect x="2.5" y="13.5" width="10.5" height="7" rx="2" />
    <circle cx="6.2" cy="17" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="18" cy="17" r="2.15" />
    <circle cx="18" cy="17" r="0.7" fill="currentColor" stroke="none" />
    <path d="M18 13.6v1.25M18 19.15v1.25M13.6 17h1.25M19.15 17h1.25M15.6 14.6l.88.88M19.52 18.52l.88.88M20.4 14.6l-.88.88M15.6 19.4l.88-.88" />
  </>,
)

/** Network — one node fanning out to two, the shape of a topology diagram. */
export const IconNetwork = icon(
  <>
    <rect x="9" y="2.5" width="6" height="5" rx="1.5" />
    <rect x="2.5" y="16.5" width="6" height="5" rx="1.5" />
    <rect x="15.5" y="16.5" width="6" height="5" rx="1.5" />
    <path d="M12 7.5v5.5M5.5 16.5V13h13v3.5" />
  </>,
)

/** Activity / uptime — an ECG trace. */
export const IconActivity = icon(<path d="M2.5 12h4.2l2.4-6.6 4.6 13.2 2.3-6.6h5.5" />)

export const IconDatabase = icon(
  <>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13" />
    <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
  </>,
)

export const IconCloud = icon(
  <path d="M17.2 19.5H7a4.5 4.5 0 0 1-.4-8.98 5.5 5.5 0 0 1 10.44 1.5 3.75 3.75 0 0 1 .16 7.48z" />,
)

/**
 * Onboarding — a plug, for "connecting somebody else's system to ours".
 *
 * This one is not decoration: `tracks.icon = 'plug'` has been in the seed since
 * the Onboarding track was created, and until this icon existed `trackIcon()`
 * fell through to its circle, so the track rendered as a blank dot on the
 * board, the rail, the timeline, the Mindtree and the Settings chip row. The
 * registry's forgiving contract hid a missing glyph instead of a crash — which
 * is the right trade, and is also why nobody noticed for two waves.
 */
export const IconPlug = icon(
  <>
    <path d="M9 8V2.5M15 8V2.5" />
    <path d="M6 8h12v5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 6 13z" />
    <path d="M12 17.5v4" />
  </>,
)

export const IconTerminal = icon(
  <>
    <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
    <path d="m7 9.5 3 2.5-3 2.5M12.8 15.5h4.7" />
  </>,
)

/* ---------- directional (always pair with className="icon-directional") ---------- */

/** Chevron pointing toward the inline end. */
export const IconChevronEnd = icon(<path d="m9.5 5 7 7-7 7" />)

/** Arrow pointing back toward the inline start. */
export const IconArrowStart = icon(<path d="M19 12H5.5M11 5.5 4.5 12l6.5 6.5" />)
