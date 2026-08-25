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
// ── WHAT THE REBUILD MOVED, AND THE TAP COUNTS THAT SURVIVED ───────────────
//
// MEETINGS IS UNCHANGED AT ONE TAP, AT EVERY WIDTH. Its link, its icon and its
// live pill are all still here, because MAP-CONTRACT §2 prices it that way: "a
// meeting starts while people are walking into a room". On a phone the LABEL
// becomes `.sr-only` rather than `display: none` — the words leave the 375px
// rail but stay in the accessible name, so the link is still announced
// "Meetings Live" and nothing about the target changes.
//
// THE EXPORT DISCLOSURE MOVED HERE from MapToolbar, markup intact, and DIGEST
// MOVED INSIDE IT. Both were already two-tap surfaces or better and both still
// are: the digest is summary + row = 2, exactly what it cost when it was a row
// in a "More" menu's ancestor. It belongs beside the export because they are one
// question — "get this out of the app and into something I can send" — and
// because the map's chrome had to lose a control, not gain one.
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

import { useEffect, useRef, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { IconColumns, IconFile, IconLayers, IconMic } from '../icons'
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
  exporting: boolean
  onExport: (kind: 'svg' | 'png' | 'copy') => void
  /** True when the ledger is drawn rather than the picture. */
  table: boolean
  /** Swap between them. Pins the reader's choice — see store/mindtree. */
  onToggleView: (next: 'map' | 'table') => void
}

export default function MapModeBar({
  compact,
  exporting,
  onExport,
  table,
  onToggleView,
}: MapModeBarProps): ReactElement {
  const meetings = useMeetings()
  const exportRef = useRef<HTMLDetailsElement | null>(null)

  useEffect(() => {
    // Unawaited on purpose: the header must paint now. `loadMeetings` is safe to
    // call from three mounted components at once and resolves to `void`.
    void loadMeetings()
  }, [])

  /**
   * ESCAPE AND LIGHT-DISMISS FOR THE EXPORT PANEL, because `<details>` provides
   * NEITHER. Carried over from MapToolbar with the element it belongs to — the
   * `<details>` and the two document listeners that make it dismissible are one
   * thing and were never separable.
   *
   * The first cut chose a `<details>` on the stated grounds that it "gets the
   * disclosure semantics, Escape-to-close and the button role from the
   * platform". Two of those three are true. Only `<dialog>` and the `popover`
   * attribute get Escape and outside-click from the platform; a `<details>` that
   * has been opened stays open forever, and this one is an absolutely positioned
   * panel sitting over the row it was opened from.
   *
   * `<details>` is still the right element — it is a disclosure, not a dialog,
   * and it must not trap focus or make the map inert. So the two behaviours are
   * added rather than the element being swapped, and focus is returned to the
   * summary on Escape, which is the half a naive `el.open = false` gets wrong.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const el = exportRef.current
      if (el === null || !el.open) return
      el.open = false
      el.querySelector<HTMLElement>('summary')?.focus()
    }
    // pointerdown, not click: a pointer that goes down outside the panel is
    // already a dismissal, and waiting for the click lets a drag that started
    // on the canvas pan the map underneath an open menu.
    const onDown = (event: PointerEvent): void => {
      const el = exportRef.current
      if (el === null || !el.open) return
      if (event.target instanceof Node && el.contains(event.target)) return
      el.open = false
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  /* THE LABELS LEAVE THE PHONE RAIL BUT NOT THE ACCESSIBLE TREE.
     `.sr-only` rather than a `display: none` in the sheet: a hidden label is
     removed from the accessibility tree, and the live pill sits INSIDE the link
     precisely so the link's name reads "Meetings Live" for free. Clipping the
     text keeps that name whole at 375px, where the rail has room for a 44px icon
     target and not for the word beside it. */
  const textClass = compact ? 'mmode-text sr-only' : 'mmode-text'

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
      {/* ── PICTURE OR LEDGER ────────────────────────────────────────────
          ⚠ THIS CONTROL DID NOT EXIST. It rode at the foot of `MapDiveRail`,
            which was unmounted when the chrome around the canvas was quieted —
            and the rail's own comment admitted the consequence: "the accessible
            table is reachable only by `?stage=table` while this is off". A
            drag-free, low-motion reading of the whole tree was left behind a
            hand-typed URL.

            It matters more now than it did then, and more again since: the
            ledger is the DEFAULT AT EVERY WIDTH (useMapLens.stageForReader —
            it was phones only until the owner said a second time that the
            picture is in the way). This button is now the ONLY way to the
            picture for any reader on any device, and pressing it pins the
            choice for good. Without it the tidy tree would be unreachable
            except by a hand-typed `?stage=map`. */}
      <button
        type="button"
        className="mmode-item btn btn-sm btn-ghost tap-44"
        onClick={() => onToggleView(table ? 'map' : 'table')}
        // The label names WHERE THE PRESS GOES, not where the reader is. A
        // toggle labelled with its current state is the oldest ambiguity in
        // interface design and it is one word either way.
        aria-label={table ? t('mindtree.stageMap') : t('mindtree.stageTable')}
        title={table ? t('mindtree.stageMap') : t('mindtree.stageTable')}
      >
        {table ? <IconLayers size={16} /> : <IconColumns size={16} />}
        <span className={textClass}>
          {table ? t('mindtree.stageMap') : t('mindtree.stageTable')}
        </span>
      </button>
      <Link className="mmode-item btn btn-sm btn-ghost tap-44" to={MEETINGS_ROUTE}>
        <IconMic size={16} />
        <span className={textClass}>{t('meeting.title')}</span>
        {live && <span className="pill ok mmode-live">{t('meeting.badgeLive')}</span>}
      </Link>

      {/* A <details> rather than a hand-rolled popover: it is a disclosure, not
          a dialog — it must not trap focus or make the map inert — and it gets
          the open/closed semantics and the button role from the platform.
          Escape and light-dismiss are NOT among them and are added in the effect
          above. `aria-label` on the summary rather than only the text inside it,
          because that text is clipped on a phone rail. */}
      <details className="mmode-export" ref={exportRef}>
        <summary
          className="mmode-item btn btn-sm btn-ghost tap-44"
          aria-label={t('mindtree.export')}
        >
          <IconFile size={16} />
          <span className={textClass}>{t('mindtree.export')}</span>
        </summary>
        <div className="mmode-export-menu">
          {/* THE DIGEST, AT TWO TAPS. First in the menu because it is the one
              row here that is a DESTINATION rather than an action on the
              picture, and a hairline below it says so. */}
          <Link className="mmode-export-link btn btn-sm btn-ghost tap-44" to={DIGEST_ROUTE}>
            <IconFile size={16} />
            <span>{t('digest.title')}</span>
          </Link>

          <p className="mmode-export-hint">{t('mindtree.exportHint')}</p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={exporting}
            onClick={() => onExport('svg')}
          >
            {t('mindtree.exportSvg')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={exporting}
            onClick={() => onExport('png')}
          >
            {t('mindtree.exportPng')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={exporting}
            onClick={() => onExport('copy')}
          >
            {t('mindtree.copyImage')}
          </button>
          {exporting && <p className="mmode-export-hint">{t('mindtree.exporting')}</p>}
        </div>
      </details>
    </div>
  )
}
