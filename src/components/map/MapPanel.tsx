// THE DOCK — the map's working surface, beside the picture and never inside it.
//
// A SIBLING OF THE CANVAS, NEVER A CHILD, and this is load bearing rather than
// tidy: `pages/mindtree.css` sets `.mtree-canvas { overflow: hidden;
// touch-action: none }`, and `touch-action` INTERSECTS down the ancestor chain —
// a descendant cannot re-enable `pan-y`. A scrolling list rendered inside the
// canvas is therefore unscrollable with a finger, silently, on the device this
// whole shell is for. `.mpan-split` is the wrapper that keeps the two apart.
//
// AND IT STAYS A SIBLING NOW THAT THE DESKTOP PRESENTATION FLOATS. The card at
// `min-width: 768px` is `position: absolute` over the stage's inline-end, which
// is a PAINT relationship and not a DOM one: `.mpan-split` is the positioned
// ancestor, the stage and the card are its two children, and the card is never
// moved inside `.mpan-stage`. Doing that would look identical and would take the
// finger-scroll off the list on the one device that needs it most.
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
// Five claims exist on this screen. The order, innermost first:
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
// NEVER THE ONLY PATH: the grabber cycles the height on CLICK and the arrow
// keys STEP it. A sheet whose only resize is a gesture is a sheet a keyboard
// cannot resize, and neither of those two paths is a gesture.
//
// THE THREE LABELLED BUTTONS ARE GONE, and the keyboard path is exactly as
// reachable as it was. They were three of the seven rows of chrome that stood
// between a 375×812 screen and its first row of content — measured in a browser
// at that size, not reasoned about — and they spent a whole row saying what one
// grabber says. `MAP_DETENTS`, `DETENT_KEY` and `phoneDetentFor` are untouched
// in `lib/mindtree/lens.ts` and their locale keys are NOT retired: the heights
// are still three, still named, and still persisted; only the row of buttons is
// gone. `step()` below still walks the same array.
//
// `full` IS NOT FULL SCREEN, and this component is where a reader will look for
// that. The CSS caps every detent at `100dvh` minus the composer AND the pinned
// lens rail at the block end, minus `--map-shell-chrome-block-size` at the block
// start, so the sheet stops below the sticky app header and above the rail that
// changes what you are looking at. `peek` and `half` are far under that cap and
// are untouched by it; only `full` is bound. The panel is NON-MODAL, and a
// non-modal surface that leaves no live pixel is a modal one with extra steps —
// it would take away every way to change what you were looking at.
// map-panel.css's `max-block-size` rule holds the arithmetic and the rejected
// alternatives; nothing in this file needs to know the numbers.
//
// ── WHAT THIS PANEL COVERS, MEASURED ───────────────────────────────────────
//
// `onOcclude` is the one number this component owes the drawing beside it. The
// stage is now the whole shell and the card floats OVER its inline-end, so the
// viewport the fit computes and the viewport the reader can SEE are two
// different rectangles unless somebody subtracts one from the other. Reported
// from a ResizeObserver on this component's own root — never from a hardcoded
// `26rem`, which is wrong at every width the `clamp()` actually resolves to, and
// wrong again the moment a scrollbar appears.
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
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { IconClose } from '../fields/glyphs'
import { t } from '../../lib/i18n'
import { MAP_DETENTS } from '../../lib/mindtree/lens'
import { pushOverlay } from '../../lib/overlayStack'
import type { PanelDetent } from '../../pages/map/useMapLens'
import './map-panel.css'

/**
 * How far a finger must travel before a press on the grabber is a resize rather
 * than a tap. 24px is `lib/dnd.ts`'s reasoning at a larger scale: below it the
 * gesture is indistinguishable from the jitter of a thumb landing.
 */
const DRAG_MIN = 24

/**
 * The card's own inset from the stage's inline-end, in px — `map-panel.css`'s
 * `inset-inline-end: 12px`, restated here because the number this component
 * reports is what the panel COVERS: the card plus the gutter it sits in, which
 * is the band the drawing must stay out of. The two are one edit; the CSS rule
 * names this constant in its comment so the pair cannot drift silently.
 */
const CARD_INSET = 12

/** Nothing covered — the value reported when there is no panel on screen. */
const CLEAR = { inlineEnd: 0, blockEnd: 0 } as const

export interface MapPanelProps {
  open: boolean
  compact: boolean
  detent: PanelDetent
  onDetent: (next: PanelDetent) => void
  onClose: () => void
  title: string
  /**
   * How much of the stage this panel is covering, in CSS px, MEASURED — so the
   * fit can subtract it and the ring centres in the band the reader can
   * actually SEE. Reported from a ResizeObserver on this component's own root,
   * and once with `{0,0}` on unmount.
   *
   * Desktop reports `inlineEnd` (the card's width plus its 12px inset) and
   * `blockEnd` 0; the phone sheet reports `blockEnd` (its height) and
   * `inlineEnd` 0. Without it the card covers the busiest branch on every open
   * on desktop, and on a phone the ring centres in the ELEMENT with half of it
   * behind the sheet — the same class of bug this redesign is fixing, arrived
   * at from the other side.
   */
  onOcclude: (occlusion: { inlineEnd: number; blockEnd: number }) => void
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
  onOcclude,
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

  /**
   * The reporter, held in a ref for `closeRef`'s reason and one more: the shell
   * writes this straight into state, so a fresh arrow per render in the
   * dependency array would re-observe the node on every commit of a screen that
   * commits on every keystroke.
   */
  const occludeRef = useRef(onOcclude)
  occludeRef.current = onOcclude

  /**
   * The root, in STATE rather than a ref, because a closed panel renders no
   * element at all: an effect keyed on a ref would run once against `null` and
   * never learn that the node arrived. A callback ref makes the mount itself the
   * trigger.
   */
  const [root, setRoot] = useState<HTMLElement | null>(null)

  /**
   * WHAT THIS PANEL COVERS, ON EVERY RESIZE AND ONCE ON UNMOUNT.
   *
   * `getBoundingClientRect()` and not the observer's `contentRect`: the card has
   * a 1px border and 12px of padding, and what the drawing has to avoid is the
   * BORDER box plus the gutter, not the content box.
   *
   * The two presentations report on different axes because they cover different
   * things — the card takes a column off the inline-end, the sheet takes a band
   * off the block-end — and `compact` is the shell's one reading of the width,
   * so the branch here can never disagree with the branch in the CSS.
   *
   * NOTHING IS OCCLUDED WHILE THIS ELEMENT IS IN NORMAL FLOW, and that case is
   * real rather than theoretical: below `map-panel.css`'s `(min-height: 480px)`
   * guard — WCAG 1.4.10 reflow, 400% zoom on a 1280×1024 screen — the panel is
   * an ordinary block UNDER the stage, taking its own space and covering
   * nothing. Reporting a width there would hand the geometry a viewport of zero
   * inline size at the one setting where the reader is already struggling. The
   * question is asked of the COMPUTED STYLE rather than answered by repeating
   * the media query in TypeScript, which is `MapCapture`'s idiom (`position ===
   * 'fixed'`) and keeps the CSS the only place the breakpoints live.
   *
   * `ResizeObserver` is guarded for the same reason `charts/geometry.ts` and
   * `MapCapture` guard it: the test environment is `node`, where it does not
   * exist. The effect is inert there rather than throwing.
   */
  useEffect(() => {
    if (root === null) {
      occludeRef.current(CLEAR)
      return
    }
    const report = (): void => {
      const position = window.getComputedStyle(root).position
      if (position !== 'absolute' && position !== 'fixed') {
        occludeRef.current(CLEAR)
        return
      }
      const box = root.getBoundingClientRect()
      occludeRef.current(
        compact
          ? { inlineEnd: 0, blockEnd: Math.round(box.height) }
          : { inlineEnd: Math.round(box.width) + CARD_INSET, blockEnd: 0 },
      )
    }
    report()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report)
    observer?.observe(root)
    return () => {
      observer?.disconnect()
      // The stage is whole again the moment this element leaves the DOM, and
      // nothing else is in a position to say so.
      occludeRef.current(CLEAR)
    }
  }, [root, compact])

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
      ref={setRoot}
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

        {/* THE ONE WAY OUT, and a glyph rather than a sentence: it sits in the
            head row of a 20rem card beside a title that must not be pushed out
            of it, and "Hide the panel" said in words what a ✕ in a head row
            says in every application the reader already uses. The NAME is
            unchanged — `aria-label` carries the same key the button used to
            render as text, so nothing a screen reader hears has changed, and
            `title` puts the same sentence back under a mouse. */}
        <button
          type="button"
          className="mpan-close btn btn-sm btn-ghost tap-44"
          aria-label={t('mindtree.panelClose')}
          title={t('mindtree.panelClose')}
          onClick={onClose}
        >
          <IconClose size={16} />
        </button>
      </div>

      {/* The scroller, and the reason the panel is a sibling of the canvas: this
          element may pan with a finger, which nothing inside `.mtree-canvas`
          can. */}
      <div className="mpan-body">{children}</div>
    </section>
  )
}
