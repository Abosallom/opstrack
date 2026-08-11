// THE MODE ENTRANCES — two fixed targets in the shell header, at every width,
// never behind a disclosure.
//
// THIS ROW IS THE TAB-BAR SLOT MEETINGS IS LOSING. `/meetings` is one thumb tap
// today, and the job it serves is "a meeting starts while people are walking
// into a room". If reaching it became "find the node on the map", it would go
// from 1 tap to pan, zoom, hunt, tap — which is the exact failure mode the whole
// contract exists to avoid. So the entrance is not a node, not a menu item and
// not a command-palette row: it is a link that is already on the screen.
//
// TWO ITEMS, AND ONLY TWO. Meetings and the digest are the two surfaces that
// cannot live on a canvas — one is fast typing, the other is a printed document.
// Everything else that used to be a tab is a lens chip in MapLensBar beside this
// row. A third item here would be a "More" menu in waiting.
//
// ── THE LIVE BADGE ─────────────────────────────────────────────────────────
//
// A meeting with no `ended_at` is still running, and the person who left it
// running is usually the person looking at this header. The badge is TEXT in a
// `.pill ok`, not a coloured dot: a dot is meaning carried by colour alone, and
// it would also be invisible to the accessible name. Because the pill sits
// INSIDE the link, the link's name becomes "Meetings Live" for free — no
// composed `aria-label` that could drift from what is drawn.
//
// IT COSTS ONE READ, ONCE. `loadMeetings()` short-circuits on `loadedAt` and
// de-dupes an in-flight request, so mounting this in the shell warms the meeting
// list once per session and never again; without it the badge could only ever
// appear after the reader had already visited `/meetings`, which is the one case
// where they do not need telling. It never rejects and never throws — see its
// header — so there is nothing to catch and nothing to show if it fails: a
// missing badge is the honest degradation, an error toast in the app's header
// is not.
//
// ── WHAT THIS ROW MAY NOT DO ───────────────────────────────────────────────
//
// No `aria-live`. The badge appearing is not the result of anything the reader
// just did, and a header that speaks while they are typing into the filter box
// is worse than a badge they find when they look.

import { useEffect, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { IconFile, IconMic } from '../icons'
import { t } from '../../lib/i18n'
import { loadMeetings, useMeetings } from '../../store/meetings'
import './map-mode.css'

/**
 * The two destinations, as literals.
 *
 * The Pages base path is the router's `basename` and must not be spelled here.
 */
const MEETINGS_ROUTE = '/meetings'
const DIGEST_ROUTE = '/digest'

export interface MapModeBarProps {
  compact: boolean
}

export default function MapModeBar({ compact }: MapModeBarProps): ReactElement {
  const meetings = useMeetings()

  useEffect(() => {
    // Unawaited on purpose: the header must paint now. `loadMeetings` is safe to
    // call from three mounted components at once and resolves to `void`.
    void loadMeetings()
  }, [])

  // `ended_at === null` is the same live test MeetingsIndex applies to each row,
  // kept as one expression here rather than imported so the two screens cannot
  // disagree about it through a shared helper that only one of them updates.
  const live = meetings.some((m) => m.ended_at === null)

  return (
    <div
      className="mmode"
      // The presentation, from the shell's ONE reading of `(max-width: 767px)`
      // rather than a second breakpoint in CSS that could disagree with it —
      // MapLensBar and MapPanel take the same value from the same place.
      data-compact={compact ? '' : undefined}
    >
      <Link className="mmode-item btn btn-sm btn-ghost tap-44" to={MEETINGS_ROUTE}>
        <IconMic size={16} />
        <span className="mmode-text">{t('meeting.title')}</span>
        {live && <span className="pill ok mmode-live">{t('meeting.badgeLive')}</span>}
      </Link>

      <Link className="mmode-item btn btn-sm btn-ghost tap-44" to={DIGEST_ROUTE}>
        <IconFile size={16} />
        <span className="mmode-text">{t('digest.title')}</span>
      </Link>
    </div>
  )
}
