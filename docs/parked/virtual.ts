// Windowing — render the rows a reader can see, reserve the space for the rest.
//
// NO DEPENDENCY, AND NOT A VIRTUALISER. There is no measurement cache, no
// absolute positioning, no scroll hijacking and no horizontal axis. What this
// module does is answer ONE question — "given where the list sits relative to
// the viewport, which index range is worth mounting?" — and return the two
// spacer heights that make the answer invisible. Everything a full virtualiser
// buys beyond that (variable measured heights, sticky items, reverse lists)
// costs a cache that has to be invalidated correctly, and the two screens that
// need this ship uniform rows.
//
// THE SPACERS ARE THE WHOLE CORRECTNESS ARGUMENT. A windowed list that shrinks
// its own scroll height breaks the scrollbar, breaks the browser's scroll
// restoration on Back, breaks `scrollIntoView` on anything below it and makes
// every scroll gesture a fight. So the plan always reproduces the FULL block
// size of the list: what is not mounted is present as a blank box of exactly the
// height the missing rows would have occupied, and the container's total height
// never moves as the window slides. That is also why the flex `gap` is an input
// rather than an afterthought — see padFor() for the arithmetic.
//
// SEGMENTS, NOT A RANGE, AND THAT IS ABOUT FOCUS. Unmounting the element that
// holds DOM focus drops focus to <body>, and the next Tab restarts at the top of
// the document (WCAG 2.4.3) — on the distribution tree that means a reader who
// tabs to a checkbox, scrolls, and tabs again is thrown back to the site header.
// The naive fixes are both bad: pinning the focused row by STRETCHING the range
// down to it mounts every row in between (tick a row at the top of a thousand,
// scroll to the bottom, render the lot), and moving focus somewhere else is a
// behaviour change nobody asked for. So the plan is a LIST of contiguous
// segments in ascending order: the focused row keeps its own one-row segment
// where it belongs in the DOM, the space between it and the viewport window
// collapses to a spacer, and tab order, reading order and the accessibility tree
// stay in document order. Two extra elements, no extra rows.
//
// EVERY LENGTH IS A BLOCK-SIZE, never a height: the caller writes these numbers
// into `style={{ blockSize }}`, so a vertical-writing-mode list would keep
// working. Nothing here reads the DOM — the hook below does that, and hands the
// numbers to a pure function so the arithmetic is testable without a browser.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Below this many rows a list renders whole.
 *
 * Windowing is not free: it costs a scroll listener, a measure pass and two
 * spacers, and it makes Cmd-F miss rows that are not mounted. Under ~40 rows the
 * render it saves is smaller than the machinery, so the honest default is to do
 * nothing. Both callers pass this; it lives here so the number is written once.
 */
export const VIRTUAL_MIN_ROWS = 40

/**
 * Rows mounted beyond each edge of the viewport.
 *
 * Six is a compromise measured in scroll physics rather than pixels: a fling on
 * a phone crosses more than six rows before the next frame, so overscan cannot
 * prevent a blank flash on its own — what it does is absorb the ERROR in the
 * pitch estimate (a wrapped two-line title, the 4px content inset the plan
 * deliberately ignores) so a correctly-scrolled list never shows a gap at rest.
 */
const DEFAULT_OVERSCAN = 6

/**
 * The viewport assumed before anything has been measured — a first paint, or a
 * render with no DOM at all (the test suite is `environment: 'node'`).
 *
 * Deliberately generous. Guessing SMALL means the first paint is short and the
 * effect immediately grows it, which is a visible jump on the screen someone is
 * already looking at; guessing large costs a handful of rows that are thrown
 * away one frame later.
 */
const DEFAULT_VIEWPORT = 800

/** One contiguous run of rows to mount, `[start, end)`. */
export interface VirtualSegment {
  readonly start: number
  /** Exclusive. */
  readonly end: number
  /**
   * Block size of the spacer that must be rendered IMMEDIATELY BEFORE this
   * segment, in px. Zero ⇒ no spacer (the segment starts where the previous one
   * ended, or at the top of the list).
   */
  readonly padBefore: number
}

export interface VirtualPlan {
  /** Ascending, non-overlapping, non-adjacent. Never empty while `count > 0`. */
  readonly segments: readonly VirtualSegment[]
  /** Block size of the trailing spacer, in px. Zero ⇒ the last row is the last row. */
  readonly padAfter: number
  /** How many rows the plan mounts. `count` ⇒ the window is the whole list. */
  readonly rendered: number
}

export interface VirtualInput {
  /** Rows in the list. */
  count: number
  /**
   * Row PITCH: the distance from one row's top edge to the next one's, so it
   * already includes the container's gap. Measured, not configured — see
   * pitchOf(). A non-positive pitch means "not measurable", and the plan falls
   * back to mounting everything rather than inventing a layout.
   */
  stride: number
  /** The container's row gap in px. See padFor() for why it cannot be folded into `stride`. */
  gap: number
  /**
   * How far the top of the list sits ABOVE the top of the viewport, in px.
   * Negative while the list starts below the fold.
   */
  scrolled: number
  /** Visible block size, in px. */
  viewport: number
  /** Rows to mount beyond each edge. */
  overscan?: number
  /**
   * Indices that must stay mounted wherever the window happens to be — the row
   * holding focus, the row with an open composer, the selection anchor. Each one
   * that falls outside the window becomes its own one-row segment. Out-of-range
   * and duplicate entries are ignored, so a caller can pass `[focus, anchor]`
   * with either half null-ish without filtering first.
   */
  pinned?: readonly number[]
}

const EMPTY_PLAN: VirtualPlan = { segments: [], padAfter: 0, rendered: 0 }

/** Mount everything: the honest answer whenever the geometry is unusable. */
function wholeList(count: number): VirtualPlan {
  return { segments: [{ start: 0, end: count, padBefore: 0 }], padAfter: 0, rendered: count }
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/**
 * The block size of a spacer standing in for `rows` consecutive rows.
 *
 * THE GAP IS WHY THIS IS NOT `rows * stride`. Both callers lay their rows out in
 * a `flex-direction: column` with a `gap`, and a spacer is a flex item like any
 * other — so inserting one ADDS a gap that the rows it replaces did not have.
 * A run of `k` rows occupies `k * stride - gap` (k tops one stride apart, minus
 * the trailing gap that belongs to the row after it), and the spacer standing in
 * for them must occupy exactly that, with the container's own gap supplying the
 * separation on either side. Get this wrong by one gap per spacer and a
 * thousand-row list is off by the height of a row and a half.
 */
function padFor(rows: number, stride: number, gap: number): number {
  if (rows <= 0) return 0
  return Math.max(0, rows * stride - gap)
}

/**
 * Which rows to mount, and how much blank space to reserve around them.
 *
 * Pure, and every input is a number: this is the part that has to be right, and
 * it is tested against fixed geometry rather than against a browser.
 */
export function planWindow(input: VirtualInput): VirtualPlan {
  const { count, stride, gap, scrolled, viewport } = input
  if (!Number.isFinite(count) || count <= 0) return EMPTY_PLAN
  // No measurable pitch (nothing painted yet, a display:none ancestor, a node
  // test) or a nonsense viewport: mount the list. Rendering everything is slow;
  // rendering the WRONG window is a blank screen, and only one of those is a bug.
  if (!(stride > 0) || !Number.isFinite(scrolled) || !(viewport > 0)) return wholeList(count)

  const overscan = Math.max(0, Math.trunc(input.overscan ?? DEFAULT_OVERSCAN))

  // At least one row is always mounted, even for a list that is entirely off
  // screen: it costs one row and it is what keeps the measure pass alive, so a
  // list scrolled past can still correct its own pitch when the font loads.
  const first = clamp(Math.floor(scrolled / stride) - overscan, 0, count - 1)
  const last = clamp(Math.ceil((scrolled + viewport) / stride) + overscan, first + 1, count)

  // The window, plus one single-row range per pinned index outside it. Sorted
  // and merged so the result is always ascending and never adjacent — two
  // touching segments would put a zero-height spacer between two rows and cost
  // the list one flex gap.
  const ranges: Array<{ start: number; end: number }> = [{ start: first, end: last }]
  for (const raw of input.pinned ?? []) {
    if (!Number.isInteger(raw) || raw < 0 || raw >= count) continue
    if (raw >= first && raw < last) continue
    ranges.push({ start: raw, end: raw + 1 })
  }
  ranges.sort((a, b) => a.start - b.start)

  const segments: VirtualSegment[] = []
  let prevEnd = 0
  let rendered = 0
  for (const range of ranges) {
    const open = segments[segments.length - 1]
    if (open !== undefined && range.start <= open.end) {
      // Overlapping or touching: extend rather than emit. `end` is the only
      // field that can grow, so the segment is rewritten in place.
      if (range.end > open.end) {
        rendered += range.end - open.end
        segments[segments.length - 1] = { ...open, end: range.end }
        prevEnd = range.end
      }
      continue
    }
    segments.push({ start: range.start, end: range.end, padBefore: padFor(range.start - prevEnd, stride, gap) })
    rendered += range.end - range.start
    prevEnd = range.end
  }

  return { segments, padAfter: padFor(count - prevEnd, stride, gap), rendered }
}

/** One mounted row, with the spacer (if any) that precedes it. */
export interface VirtualItem<T> {
  index: number
  item: T
  /** Block size in px of the spacer to render before this row. 0 ⇒ none. */
  padBefore: number
}

/**
 * The plan applied to real data, flattened to the list a caller can `.map()`.
 *
 * A null plan means "not windowed" and yields every item with no spacers, so a
 * call site has ONE rendering path for both cases — the alternative is a
 * conditional around the row JSX, which is exactly the kind of duplication that
 * lets a windowed list quietly drift from an unwindowed one.
 */
export function virtualItems<T>(items: readonly T[], plan: VirtualPlan | null): Array<VirtualItem<T>> {
  if (plan === null) return items.map((item, index) => ({ index, item, padBefore: 0 }))
  const out: Array<VirtualItem<T>> = []
  for (const seg of plan.segments) {
    for (let i = seg.start; i < seg.end && i < items.length; i += 1) {
      out.push({ index: i, item: items[i], padBefore: i === seg.start ? seg.padBefore : 0 })
    }
  }
  return out
}

/**
 * The row pitch, as the MEDIAN of the gaps between consecutive row tops.
 *
 * Median rather than mean, and that is the difference between a list that sits
 * still and one that lurches. A follow-ups row with an open quick-update
 * composer is three times the height of its neighbours, and a title that wraps
 * to two lines is half again — a mean folds those outliers into the pitch, the
 * spacers grow, and the whole list below jumps under the reader's finger while
 * they are typing. The median ignores any minority of odd rows entirely.
 *
 * @param tops   offsetTop of each mounted row in ONE contiguous run, ascending.
 * @param fallback returned when there are fewer than two rows to measure from.
 */
export function pitchOf(tops: readonly number[], fallback: number): number {
  if (tops.length < 2) return fallback
  const gaps: number[] = []
  for (let i = 1; i < tops.length; i += 1) {
    const d = tops[i] - tops[i - 1]
    if (d > 0) gaps.push(d)
  }
  if (gaps.length === 0) return fallback
  gaps.sort((a, b) => a - b)
  const mid = gaps.length >> 1
  // Even count: the lower of the two middles rather than their average. A pitch
  // is a real row's height, and averaging two different real heights invents a
  // third that no row has.
  return gaps[gaps.length % 2 === 1 ? mid : mid - 1]
}

/* ══════════════════════════ the hook ══════════════════════════ */

/**
 * Whether there is a DOM worth touching.
 *
 * `typeof window` alone is NOT enough here: the render tests run in node with a
 * hand-rolled `globalThis.window` and a two-property `document`, so the usual
 * check passes and a layout read then throws inside a server render. Probing for
 * a method that only a real implementation has is the cheap, honest test.
 */
const CAN_MEASURE =
  typeof window !== 'undefined' &&
  typeof window.document !== 'undefined' &&
  typeof window.document.createElement === 'function'

interface Metrics {
  stride: number
  gap: number
}

interface Viewport {
  scrolled: number
  viewport: number
}

export interface VirtualOptions {
  /** Rows in the list. */
  count: number
  /**
   * First-paint row pitch in px, INCLUDING the container's gap. Replaced by a
   * measurement on the first effect; only wrong for one frame.
   */
  estimate: number
  /** Lists at or below this many rows are never windowed. */
  minimum?: number
  overscan?: number
  /** Indices that must stay mounted. See VirtualInput.pinned. */
  pinned?: readonly number[]
}

export interface Virtualizer {
  /** Attach to the element that directly contains the row elements. */
  ref: (el: HTMLElement | null) => void
  /** Null ⇒ this list is short enough to render whole. */
  plan: VirtualPlan | null
  /** True while `plan` is windowing. Callers use it to decide on `aria-setsize`. */
  active: boolean
}

/** Marks a spacer so the measure pass can tell it from a row. */
export const VIRTUAL_PAD_ATTR = 'data-virtual-pad'

/**
 * Measure the container: the row pitch, the container's gap, and where the list
 * currently sits relative to the viewport.
 *
 * THE CONTENT INSET IS DELIBERATELY IGNORED. `scrolled` is taken from the
 * container's own top edge, not from the first row's, so a container with
 * `padding-block-start` maps scroll to rows a few pixels early. Overscan is
 * three hundred pixels wide and the inset is four; measuring it would mean a
 * second `getComputedStyle` on every scroll frame to fix an error two orders of
 * magnitude smaller than the margin already carried.
 */
function readGeometry(el: HTMLElement, previous: Metrics): { metrics: Metrics; view: Viewport } {
  const rect = el.getBoundingClientRect()
  const view: Viewport = {
    scrolled: -rect.top,
    viewport: window.innerHeight > 0 ? window.innerHeight : DEFAULT_VIEWPORT,
  }

  // The gap is a CSS fact, not an estimate, so it is read rather than derived —
  // deriving it from row heights would fold every wrapped title into it.
  const parsed = Number.parseFloat(window.getComputedStyle(el).rowGap)
  const gap = Number.isFinite(parsed) ? parsed : 0

  // The LONGEST contiguous run of real rows. Segments are separated by spacers,
  // and measuring across one would read the collapsed region as a row.
  let best: number[] = []
  let run: number[] = []
  for (const child of el.children) {
    if (child.hasAttribute(VIRTUAL_PAD_ATTR)) {
      if (run.length > best.length) best = run
      run = []
      continue
    }
    run.push((child as HTMLElement).offsetTop)
  }
  if (run.length > best.length) best = run

  let stride = pitchOf(best, 0)
  if (stride <= 0 && best.length === 1) {
    // A single mounted row still yields a usable pitch: its own block size plus
    // the gap that would follow it.
    const only = el.querySelector<HTMLElement>(`:scope > *:not([${VIRTUAL_PAD_ATTR}])`)
    const h = only?.offsetHeight ?? 0
    if (h > 0) stride = h + gap
  }
  return { metrics: { stride: stride > 0 ? stride : previous.stride, gap }, view }
}

/**
 * Window a list against the page's scroll position.
 *
 * WHY IT LISTENS ON `window` IN THE CAPTURE PHASE. A `scroll` event does not
 * bubble, so a listener on window misses a list inside an overflow container —
 * but scroll DOES capture, and window sees the capture phase of every scroll in
 * the document. One listener per list, correct whether the shell scrolls the
 * document (it does today) or grows an inner scroller tomorrow.
 *
 * WHY THE SCROLL HANDLER USUALLY SETS NO STATE. Re-rendering a list on every
 * scroll frame would replace the cost this module exists to remove. The handler
 * computes the row range the new offset implies and returns without touching
 * state unless that range actually changed — so a list re-renders once per row
 * crossed, not once per pixel.
 */
export function useVirtualRows(options: VirtualOptions): Virtualizer {
  const { count, estimate, minimum = VIRTUAL_MIN_ROWS, overscan = DEFAULT_OVERSCAN } = options
  const pinned = options.pinned
  const enabled = CAN_MEASURE && count > minimum

  const [metrics, setMetrics] = useState<Metrics>(() => ({ stride: estimate, gap: 0 }))
  const [view, setView] = useState<Viewport>(() => ({ scrolled: 0, viewport: DEFAULT_VIEWPORT }))

  const elRef = useRef<HTMLElement | null>(null)
  // Everything the scroll handler needs, kept in a ref so the listener is
  // attached once and never re-attached as the list grows or the pitch settles.
  const live = useRef({ metrics, count, overscan, enabled })
  live.current = { metrics, count, overscan, enabled }
  const range = useRef({ first: -1, last: -1 })

  const sync = useCallback((): void => {
    const el = elRef.current
    if (el === null || !live.current.enabled) return
    const { metrics: next, view: nextView } = readGeometry(el, live.current.metrics)

    const m = live.current.metrics
    // 0.5px: sub-pixel drift is a rounding artefact of the browser's own layout,
    // and reacting to it would re-render the list forever.
    if (Math.abs(next.stride - m.stride) > 0.5 || Math.abs(next.gap - m.gap) > 0.5) {
      setMetrics(next)
      range.current = { first: -1, last: -1 }
    }

    const stride = next.stride > 0 ? next.stride : m.stride
    const first = Math.floor(nextView.scrolled / stride) - live.current.overscan
    const last = Math.ceil((nextView.scrolled + nextView.viewport) / stride) + live.current.overscan
    if (first === range.current.first && last === range.current.last) return
    range.current = { first, last }
    setView(nextView)
  }, [])

  const ref = useCallback(
    (el: HTMLElement | null): void => {
      elRef.current = el
      if (el !== null) sync()
    },
    [sync],
  )

  useEffect(() => {
    if (!enabled) return
    // A first pass after paint: the ref callback fires before layout has
    // settled, so the pitch it read may be the estimate.
    sync()

    let frame = 0
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        sync()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', onScroll, { passive: true })

    // The container's own size changes when a row wraps, when the density
    // toggle fires, when a composer opens, and when this hook rewrites its own
    // spacers. The last one cannot loop: sync() only sets state when a value
    // genuinely moved, so the second pass is a no-op.
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && elRef.current !== null) {
      observer = new ResizeObserver(onScroll)
      observer.observe(elRef.current)
    }

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      observer?.disconnect()
    }
    // `count` re-runs the effect so a list that grows past the threshold starts
    // measuring, and one that shrinks below it stops.
  }, [enabled, count, sync])

  const plan = useMemo(
    () =>
      enabled
        ? planWindow({
            count,
            stride: metrics.stride,
            gap: metrics.gap,
            scrolled: view.scrolled,
            viewport: view.viewport,
            overscan,
            pinned,
          })
        : null,
    [enabled, count, metrics, view, overscan, pinned],
  )

  return { ref, plan, active: plan !== null && plan.rendered < count }
}
