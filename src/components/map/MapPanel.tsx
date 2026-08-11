// THE DOCK — the map's working surface, beside the picture and never inside it.
//
// A SIBLING OF THE CANVAS, NEVER A CHILD, and this is load bearing rather than
// tidy: `pages/mindtree.css` sets `.mtree-canvas { overflow: hidden;
// touch-action: none }`, and `touch-action` INTERSECTS down the ancestor chain —
// a descendant cannot re-enable `pan-y`. A scrolling list rendered inside the
// canvas is therefore unscrollable with a finger, silently, on the device this
// whole shell is for. `.mpan-split` is the wrapper that keeps the two apart.
//
// NON-MODAL IN BOTH PRESENTATIONS, which is what makes it different from
// components/sheet/Sheet.tsx and why that component could not be reused here.
// Sheet is modal by design — it traps focus, sets `aria-modal`, and darkens a
// scrim — because it is an editor opened OVER a list. This is the other thing:
// the map behind it stays readable, the composer stays reachable, and the reader
// moves between the two without dismissing anything. A focus trap here would
// make the picture unreachable from the list that describes it.
//
// ── ESCAPE, AND WHO OWNS IT ────────────────────────────────────────────────
//
// Four claims exist on this screen. The order, innermost first:
//
//   1. a lifted drag aborts            useMapKeyboard → dragController, a React
//                                      handler on the <svg>, calls
//                                      preventDefault
//   2. an open overlay closes          NodeMenu / QuickAdd / the entry sheet,
//                                      each pushed onto lib/overlayStack, LIFO
//   3. the composer clears its text    MapCapture's own onKeyDown (U2), which
//                                      must preventDefault or this panel
//                                      closes underneath it
//   4. THIS PANEL closes, on a phone   pushOverlay below, registered only while
//                                      it is a sheet
//   5. the drill-in clears             useMapKeyboard's Escape branch
//
// The mechanism is lib/overlayStack's two rules: its listener is on the BUBBLE
// phase of `document`, so any React handler that consumed the key has already
// set `defaultPrevented` and it bails; and it is a LIFO stack, so the most
// recently opened overlay — always deeper than this panel, which is opened with
// the screen — acts first. This component therefore binds NOTHING itself.
//
// ONE HONEST EXCEPTION, recorded rather than hidden: when focus is inside the
// map's `<svg>` AND a drill-in is active, useMapKeyboard's React handler runs
// before the document listener and clears the drill-in — level 5 acting before
// level 4. Correcting it would mean editing pages/map/useMapKeyboard.ts, which
// U1 does not own. The exposure is nil in practice: the sheet exists only below
// 768px, and a treeitem only holds focus there via a hardware keyboard.
//
// ── THE DETENTS ────────────────────────────────────────────────────────────
//
// Three heights on a phone — peek, half, full — and DRAG IS AN ACCELERATOR,
// NEVER THE ONLY PATH: three labelled buttons set any height directly, the
// grabber cycles on click, and the arrow keys step it. A sheet whose only
// resize is a gesture is a sheet a keyboard cannot resize.
//
// `full` IS NOT FULL SCREEN, and this component is where a reader will look for
// that. The CSS caps every detent at `100dvh` minus the composer at the block
// end and minus `--map-shell-chrome-block-size` at the block start, so the sheet
// stops below the sticky app header with one lens row of live page showing.
// `peek` and `half` are far under that cap and are untouched by it; only `full`
// is bound. The panel is NON-MODAL, and a non-modal surface that leaves no live
// pixel is a modal one with extra steps — it took away every way to change what
// you were looking at except this component's own three detent buttons.
// map-panel.css's `max-block-size` rule holds the arithmetic and the rejected
// alternatives; nothing in this file needs to know the numbers.
//
// The drag reads `clientY` and that is not a physical-direction bug: the block
// axis is vertical under every writing mode this app ships (`horizontal-tb` in
// both `en` and `ar`), so there is no `clientBlock` to want. RTL never mirrors a
// bottom sheet's growth direction.
//
// Motion is on `block-size` for 180ms and global.css's prefers-reduced-motion
// block flattens it to 0.01ms, so no rule here repeats that.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { t } from '../../lib/i18n'
import { MAP_DETENTS, DETENT_KEY } from '../../lib/mindtree/lens'
import { pushOverlay } from '../../lib/overlayStack'
import type { PanelDetent } from '../../pages/map/useMapLens'
import './map-panel.css'

/**
 * How far a finger must travel before a press on the grabber is a resize rather
 * than a tap. 24px is `lib/dnd.ts`'s reasoning at a larger scale: below it the
 * gesture is indistinguishable from the jitter of a thumb landing.
 */
const DRAG_MIN = 24

export interface MapPanelProps {
  open: boolean
  compact: boolean
  detent: PanelDetent
  onDetent: (next: PanelDetent) => void
  onClose: () => void
  title: string
  children: ReactNode
}

/** One step along `MAP_DETENTS`, clamped — never wrapping. Wrapping would make
 *  one more press on "taller" collapse the sheet to a strip. */
function step(from: PanelDetent, by: 1 | -1): PanelDetent {
  const at = MAP_DETENTS.indexOf(from)
  const to = Math.min(MAP_DETENTS.length - 1, Math.max(0, at + by))
  return MAP_DETENTS[to] as PanelDetent
}

export default function MapPanel({
  open,
  compact,
  detent,
  onDetent,
  onClose,
  title,
  children,
}: MapPanelProps): ReactElement {
  /**
   * The dismissal, held in a ref so the registration effect depends on `open`
   * and `compact` alone. A fresh `onClose` on every render of the shell would
   * otherwise re-push the panel onto the stack on every keystroke in the filter
   * box — which is not merely wasteful: it would put the panel ABOVE an entry
   * sheet the reader opened from it, and Escape would then close the wrong one.
   */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  /** The region's name is the heading it already shows — `aria-labelledby`
   *  rather than `aria-label` so the two can never drift apart. */
  const titleId = useId()

  useEffect(() => {
    // ONLY AS A SHEET. At rail widths the panel takes no space from anything and
    // has nothing to dismiss, so claiming Escape there would take the key away
    // from the drill-in for no gain.
    if (!open || !compact) return
    return pushOverlay(() => closeRef.current())
  }, [open, compact])

  const drag = useRef<{ id: number; y: number; from: PanelDetent } | null>(null)
  /** Set when a press turned into a resize, so the click it also fires does not
   *  then cycle the height a second time. */
  const resized = useRef(false)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!compact) return
      drag.current = { id: event.pointerId, y: event.clientY, from: detent }
      resized.current = false
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [compact, detent],
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const held = drag.current
      if (held === null || held.id !== event.pointerId) return
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      const dy = event.clientY - held.y
      if (Math.abs(dy) < DRAG_MIN) return
      resized.current = true
      // Up the screen is a smaller clientY and a TALLER sheet, which is the
      // direction the sheet actually moves under the finger.
      const next = step(held.from, dy < 0 ? 1 : -1)
      if (next !== held.from) onDetent(next)
    },
    [onDetent],
  )

  const onGrabClick = useCallback(() => {
    if (resized.current) {
      resized.current = false
      return
    }
    // A tap on the grabber grows the sheet, and collapses it once it is full —
    // the one-thumb path that needs no aim at a specific button.
    onDetent(detent === 'full' ? 'peek' : step(detent, 1))
  }, [detent, onDetent])

  const onGrabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const next = step(detent, event.key === 'ArrowUp' ? 1 : -1)
      if (next !== detent) onDetent(next)
    },
    [detent, onDetent],
  )

  // A closed panel renders NOTHING — not a hidden element. Its children are the
  // attention list and the branch panel, each of which subscribes to the entries
  // store and does real work per render; keeping them mounted behind
  // `display: none` would pay for a surface nobody can see.
  if (!open) return <></>

  return (
    <section
      className="mpan"
      // The presentation, not the width: `compact` is the shell's one reading of
      // `(max-width: 767px)` and nine other decisions branch on the same value.
      data-sheet={compact ? '' : undefined}
      data-detent={compact ? detent : undefined}
      aria-labelledby={titleId}
    >
      <div className="mpan-head">
        {compact && (
          <button
            type="button"
            className="mpan-grab tap-44"
            aria-label={t('mindtree.panelResize')}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onGrabClick}
            onKeyDown={onGrabKeyDown}
          >
            <span className="mpan-grab-bar" aria-hidden="true" />
          </button>
        )}

        <h2 className="mpan-title" id={titleId}>
          {title}
        </h2>

        {compact && (
          <div className="mpan-detents" role="group" aria-label={t('mindtree.detentLabel')}>
            {MAP_DETENTS.map((value) => (
              <button
                key={value}
                type="button"
                className="mpan-detent tap-44"
                aria-pressed={value === detent}
                onClick={() => onDetent(value)}
              >
                {t(DETENT_KEY[value])}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className="mpan-close btn btn-sm btn-ghost tap-44"
          onClick={onClose}
        >
          {t('mindtree.panelClose')}
        </button>
      </div>

      {/* The scroller, and the reason the panel is a sibling of the canvas: this
          element may pan with a finger, which nothing inside `.mtree-canvas`
          can. */}
      <div className="mpan-body">{children}</div>
    </section>
  )
}
