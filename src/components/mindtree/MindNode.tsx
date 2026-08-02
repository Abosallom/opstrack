// One node of the map — a track, a group, an entry, or a "+N more" fold.
//
// IT DECIDES NOTHING. Every string it draws arrives resolved (`view`), every
// number it draws arrives positioned (`pos`), and every colour it paints comes
// from the `--track-c-*` pair the model stapled on. That is not fastidiousness:
// this component renders once per node and there can be four hundred of them on
// a filtered-to-everything workspace, so anything it computed would be computed
// four hundred times per pan. The page builds the view models in one memo.
//
// THE ACCESSIBILITY CONTRACT IT IMPLEMENTS, from the locale worker's handoff:
//
//  · A branch's accessible name is `mindtree.nodeName` — "Network, 12 open,
//    2 past deadline" — and NOTHING about expansion is appended to it, because
//    `aria-expanded` already announces that and a name that repeats it makes
//    every branch announce its state twice.
//  · `aria-expanded` is present only on a node that HAS children, and its value
//    is whether children are actually drawn — not `node.collapsed`. Those two
//    differ in the one case that matters: a node sitting on the mobile depth
//    limit is not "collapsed" in the model and has nothing under it on screen,
//    and claiming `aria-expanded="true"` there promises a subtree the reader
//    will never reach with an arrow key.
//  · `aria-level` is 1-based from the DRAWN root. On a mobile drill-in the
//    drawn root is a track, so the track is level 1 — which is correct: level
//    describes the tree the reader is in, not the one the model holds.
//
// ROLE PLACEMENT. `role="treeitem"` sits on a `<g>` inside an `<svg>`, not on
// an HTML overlay. ARIA roles on SVG elements are honoured by every engine this
// app supports, and the alternative — a parallel div tree positioned over the
// drawing — is two DOM trees that have to agree about geometry, which they stop
// doing the moment the viewBox scales. The <g> is the mark AND the control.
//
// WHY THE WHOLE NODE IS THE HIT TARGET rather than a small chevron: a mind map
// is nothing but touch targets, and a 20px chevron inside a card is a target
// that fails the audit while sitting inside one that passes. The chevron is
// drawn as an AFFORDANCE — it says the branch opens — and it carries the
// `expandNode`/`collapseNode` sentence as a native tooltip for pointer users,
// but it is `aria-hidden` and it is not separately clickable.
//
// WHAT THE INTERACTIVE BUILD ADDED, and what it deliberately did not. This
// component now FORWARDS three more gestures — the press that may become a drag,
// the pointer crossing in and out (which raises the hover card), and the
// right-click that opens the node menu — and it still decides nothing about any
// of them. `onPointerDown` is `MindDragController.onNodePointerDown` handed down
// unchanged; whether that press becomes a lift is DragLayer.tsx's judgement, made
// against the drop rules, not a `draggable` attribute here.
//
// The ONE piece of state it reads for itself is whether its entry is ticked, and
// store/mindtree.ts's `useMindIsSelected` says why: a narrow per-node selector
// makes ticking one row re-render one row. That is the opposite of the rule in
// the paragraph above — and it is the same rule underneath. Nothing is COMPUTED
// here; one boolean is SUBSCRIBED here, because subscribing per node is what
// keeps four hundred of them off the page's render path.
//
// WHAT THE 44 ACTUALLY GUARANTEES, stated exactly, because the first cut of
// this header stated it wrongly and the wrong version was load-bearing. It said
// "`sizeForCount` floors every node at the 44px the rest of the app is held
// to". That is true in DRAWING UNITS and false in CSS pixels: the whole map
// lives inside a fitted viewBox, and `fitToViewBox` exists to shrink it — at
// the fit this screen used to open at, a 44-unit node measured 10 px. The floor
// only reaches the screen if the FIT has a floor too, which is why
// pages/Mindtree.tsx now refuses to fit below `MIN_TARGET_PX / nodeSize.height`
// and lets a big map overflow into the pan instead. This component's guarantee
// is therefore: every node is at least `nodeSize.height` units tall and the
// card is the only target; the page owns the units-to-pixels half.

import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { isolate, stripIsolates } from '../../lib/bidi'
import type { PositionedNode } from '../../lib/mindtree/layout'
import type { MindNode as MindNodeModel } from '../../lib/mindtree/model'
import { useMindIsSelected } from '../../store/mindtree'

/** Everything this component would otherwise have had to resolve itself. */
export interface MindNodeView {
  /**
   * The visible label, isolated by the page (`isolate(raw)`). Clipped to the
   * node's inline budget HERE — see `truncate` — because the budget is a
   * function of the width the layout chose, which the page does not know when it
   * builds the view models.
   */
  label: string
  /** The full accessible name (`mindtree.nodeName` / `mindtree.leafName`). */
  name: string
  /** The count chip's text, or null on a leaf (where the count is always 1). */
  count: string | null
  /** `mindtree.expandNode` / `mindtree.collapseNode` — the chevron's tooltip. */
  toggleHint: string | null
  /** `mindtree.breachHint`, or null when nothing under this node is breached. */
  breachHint: string | null
}

export interface MindNodeProps {
  pos: PositionedNode<MindNodeModel>
  view: MindNodeView
  /** Arabic. SVG has no logical properties, so anchoring is arithmetic. */
  rtl: boolean
  /** Owns the tree's single tab stop (roving tabindex). */
  focused: boolean
  /** The node the reader most recently acted on — a quiet persistent marker. */
  current: boolean
  /**
   * A tap, a click, or Enter on this node.
   *
   * TAKES THE EVENT, because a MODIFIER-CLICK is a different act: Ctrl/Cmd+click
   * ticks a leaf so several travel together, which is the pointer half of the
   * Ctrl+Space binding the tree already had. Without the event that gesture is
   * not even representable, and the whole bulk story — the selection bar, the
   * drag-many, the branch verbs — is keyboard-only. The page decides what the
   * modifier means; this only passes it on.
   */
  onActivate: (node: MindNodeModel, event: ReactMouseEvent<SVGGElement>) => void
  /** Called on real DOM focus, so a click and an arrow key agree on the cursor. */
  onFocus: (id: string) => void
  /** Lets the page call `.focus()` without a `getElementById` round trip. */
  registerRef: (id: string, el: SVGGElement | null) => void
  /**
   * The press that may become a drag — `MindDragController.onNodePointerDown`,
   * handed down unchanged.
   *
   * The whole gesture lives in components/mindtree/DragLayer.tsx; this component
   * only says where it started. It is NOT an `onDragStart`: the map uses pointer
   * events throughout (lib/dnd.ts's argument), so a finger can still pan from a
   * node until the hold lands.
   */
  onPointerDown: (pos: PositionedNode<MindNodeModel>, event: ReactPointerEvent<Element>) => void
  /** Pointer in, pointer out — what raises the hover card. Null clears it. */
  onHover: (id: string | null) => void
  /** Right-click, or the ContextMenu key routed through the page's keydown. */
  onMenu: (pos: PositionedNode<MindNodeModel>, at: { x: number; y: number }) => void
  /**
   * The hover card's element id (`NODE_CARD_ID`), on the ONE node the card is
   * describing, or undefined on every other.
   *
   * A description rather than a label: the card carries the detail the drawing
   * cannot hold — the oldest item, who is carrying it, the last update — and the
   * node's own `aria-label` already says what it is and how much is under it.
   * NodeCard.tsx's header explains why the id is a constant: there is exactly one
   * card on screen by construction, and a dangling idref (the card is not shown)
   * is ignored by every engine, which is the behaviour wanted here.
   */
  describedBy?: string
}

/** Inline breathing room inside a node box, and the space kept for the count. */
const PAD = 12
const COUNT_SLOT = 34

/**
 * Worst-case advance width of the label face at 12.5px/600, in px.
 *
 * TRUNCATION IS BY CHARACTER COUNT, NOT BY MEASUREMENT, for the reason
 * components/charts/Chart.tsx states about its category labels: measuring text
 * inside an SVG costs a second layout pass per node per render, and the full
 * text is one keystroke away in the table view.
 *
 * MEASURED IN THE FACE THIS APP ACTUALLY SHIPS. The constant arrived as "6.4,
 * Inter at 12.5px", with a note that "Arabic runs narrower and simply truncates
 * later" — and `Inter` appears nowhere in this repo: global.css sets
 * `--font: 'Cairo', system-ui, …` and mindtree.css binds the label to it, so
 * BOTH scripts render in Cairo and the Arabic claim was backwards as well as
 * moot. Canvas `measureText` at `600 12.5px Cairo` over the workspace's own
 * labels gives 4.93–6.18 px/glyph for Arabic ("قيد التنفيذ" 5.02, "مكتب
 * المشاريع" 6.18) and 5.31–6.05 for Latin ("Rack elevation sign-off" 5.31).
 *
 * 6.2 is the top of that range, rounded up: a budget has to be an UPPER bound
 * or the label overflows its card, and the cost of the last 0.2 is that a
 * label occasionally elides one glyph it would have fitted. The old 6.4 cost
 * roughly one glyph in eight on an average Arabic label.
 */
const CHAR_PX = 6.2

/**
 * Clip the label to `budget` GLYPHS.
 *
 * IT MEASURES AND CUTS THE BARE STRING, THEN RE-ISOLATES, and both halves of
 * that are bug fixes rather than tidiness. `view.label` arrives from the page as
 * `isolate(raw)` — FSI + text + PDI — so:
 *
 *  · `label.length` counts two zero-width controls as visible characters, and
 *    every label in the map truncated two glyphs earlier than its box allowed.
 *  · slicing the string can cut the closing PDI off, which leaves an isolate the
 *    string never closes. Inside a lone <text> the engine auto-terminates it at
 *    the end of the element so nothing visibly breaks — but it is exactly the
 *    unbalanced run `lib/bidi.isolatesBalanced` exists to forbid, and this
 *    string is also what `lib/mindtree/export.ts` writes into a standalone SVG
 *    file, where the surrounding paragraph is somebody else's software.
 *
 * `isolate()` balances as it wraps, so the ellipsis goes INSIDE the run: it is a
 * neutral, and an Arabic label truncated in an English UI must put its ellipsis
 * at the run's own end, not at the sentence's.
 */
function truncate(label: string, budget: number): string {
  if (budget <= 0) return ''
  const bare = stripIsolates(label)
  // Untouched when it fits — the common case allocates nothing and keeps the
  // page's own isolation byte for byte.
  if (bare.length <= budget) return label
  // The ellipsis replaces a character rather than being appended, so the result
  // never exceeds the budget the box was measured for.
  return isolate(`${bare.slice(0, Math.max(1, budget - 1))}…`)
}

/**
 * Memoised, and the comparison that matters is the default one: `pos` and
 * `view` are both built in the page's memos and are reference-stable across a
 * pan or a zoom, so a viewBox change re-renders zero nodes. Without this, every
 * frame of a drag re-renders the whole map.
 */
export const MindNode = memo(function MindNode({
  pos,
  view,
  rtl,
  focused,
  current,
  onActivate,
  onFocus,
  registerRef,
  onPointerDown,
  onHover,
  onMenu,
  describedBy,
}: MindNodeProps): ReactElement {
  const node = pos.node
  const isLeaf = node.kind === 'entry'
  /**
   * SUBSCRIBED HERE RATHER THAN PASSED IN, and store/mindtree.ts's
   * `useMindIsSelected` header is the reason: it is one Set lookup per node, so
   * ticking one entry re-renders that entry's mark and nothing else. A page
   * holding the whole selection and passing a boolean down would re-render four
   * hundred nodes on every tick — which is the one thing this memo() exists to
   * prevent.
   *
   * The empty string for a branch is safe by construction: `selection` only ever
   * holds `entries.id` values, so a branch's lookup is a miss on every render and
   * costs the same as the `entryId === null` guard it replaces.
   */
  const selected = useMindIsSelected(node.entryId ?? '')
  // Whether children are DRAWN — not whether the model calls this collapsed.
  // See the third bullet in the header.
  const expanded = pos.childIds.length > 0
  const hasCount = view.count !== null

  const budget = Math.max(
    3,
    Math.floor((pos.width - PAD * 2 - (hasCount ? COUNT_SLOT : 0)) / CHAR_PX),
  )

  // Inline-start and inline-end resolved into x, once. Nothing below multiplies
  // anything by a direction again — the same discipline charts/geometry.ts
  // enforces for the dashboard.
  //
  // ONLY THE COORDINATES FLIP. `text-anchor` does NOT, and the first cut of this
  // file got that exactly backwards: under `direction: rtl` the anchor keywords
  // are already logical, so `start` is the run's RIGHT extremity and `end` is
  // its left. Flipping them here as well mirrored twice and hung every label
  // off the OUTSIDE of its own box — visible immediately in an Arabic render,
  // and invisible in every English one. So the anchors below are constant and
  // `direction` is stated on the group explicitly rather than inherited from
  // <html>, which is what makes the behaviour a property of this component
  // (and of the exported file, where `svgDocument()` writes the same attribute)
  // instead of a property of wherever the markup happens to be mounted.
  const startX = rtl ? pos.width - PAD : PAD
  const endX = rtl ? PAD : pos.width - PAD
  const chevronX = rtl ? -9 : pos.width + 9
  const markX = rtl ? PAD : pos.width - PAD
  /** The selection tick's corner — the mirror of the breach mark's. */
  const tickX = rtl ? pos.width - PAD : PAD

  return (
    <g
      // A BLOCK BODY, deliberately: React 19 treats a ref callback's return
      // value as a cleanup function, so the concise form `(el) => register(...)`
      // silently forwards whatever the page's registerRef happens to return —
      // and the natural implementation, `map.set(id, el)`, returns the Map.
      // React would then call it on unmount and throw. The braces make the
      // contract independent of the page's implementation.
      ref={(el) => {
        registerRef(pos.id, el)
      }}
      className="mtree-node"
      transform={`translate(${pos.x} ${pos.y})`}
      style={node.colourVars}
      direction={rtl ? 'rtl' : 'ltr'}
      data-kind={node.kind}
      data-depth={pos.depth}
      data-retired={node.retired ? '' : undefined}
      data-breach={node.health.slaBreached ? '' : undefined}
      data-current={current ? '' : undefined}
      data-empty={node.count === 0 ? '' : undefined}
      data-selected={selected ? '' : undefined}
      role="treeitem"
      tabIndex={focused ? 0 : -1}
      aria-level={pos.depth + 1}
      aria-posinset={pos.index + 1}
      aria-setsize={pos.siblingCount}
      aria-expanded={pos.hasChildren ? expanded : undefined}
      // ONLY ON A LEAF. `aria-selected` on a treeitem means "this item is part
      // of the current selection", and the tree is `aria-multiselectable` for
      // that reason — but only entry leaves can be ticked (a branch is a bucket,
      // not a row), and putting the attribute on a branch would make every track
      // and every group announce "not selected" for a state it can never enter.
      aria-selected={isLeaf ? selected : undefined}
      aria-label={view.name}
      aria-describedby={describedBy}
      onClick={(event: ReactMouseEvent<SVGGElement>) => onActivate(node, event)}
      onFocus={() => onFocus(pos.id)}
      onPointerDown={(event) => onPointerDown(pos, event)}
      // pointerenter/leave, not over/out: they do not bubble, so a pointer
      // travelling across the map raises exactly one enter per node instead of
      // one per child element of every node it crosses.
      onPointerEnter={() => onHover(pos.id)}
      onPointerLeave={() => onHover(null)}
      onContextMenu={(event: ReactMouseEvent<SVGGElement>) => {
        // The platform menu is suppressed because this node HAS a menu — the one
        // the page opens with the same verbs the keyboard reaches through
        // Shift+F10. Suppressing it without offering a replacement would be
        // taking a control away.
        event.preventDefault()
        onMenu(pos, { x: event.clientX, y: event.clientY })
      }}
    >
      <rect
        className="mtree-node-box"
        width={pos.width}
        height={pos.height}
        rx={10}
        ry={10}
      />

      <text
        className="mtree-node-label"
        x={startX}
        y={pos.height / 2}
        textAnchor="start"
        dominantBaseline="central"
      >
        {truncate(view.label, budget)}
      </text>

      {hasCount && (
        <text
          className="mtree-node-count tabular"
          x={endX}
          y={pos.height / 2}
          textAnchor="end"
          dominantBaseline="central"
          aria-hidden="true"
        >
          {view.count}
        </text>
      )}

      {/* The breach mark — the map's second and last visual variable. It sits
          on the block-start edge rather than beside the count so it survives
          the smallest node size, and it is aria-hidden because the sentence it
          stands for is already inside `view.name`. The <title> is the native
          hover tooltip and is shown regardless of aria-hidden. */}
      {view.breachHint !== null && (
        <g className="mtree-breach" aria-hidden="true">
          <title>{view.breachHint}</title>
          <circle cx={markX} cy={9} r={4} />
        </g>
      )}

      {/* The disclosure affordance. Drawn in the gap toward the next ring, so
          it reads as "the branch continues this way" rather than as a second
          control competing with the card. Not clickable on its own: the card is
          the target, and see the header for why. */}
      {pos.hasChildren && (
        <g className="mtree-chevron" aria-hidden="true" data-open={expanded ? '' : undefined}>
          {view.toggleHint !== null && <title>{view.toggleHint}</title>}
          <circle cx={chevronX} cy={pos.height / 2} r={7} />
          {!expanded && pos.hiddenChildCount > 0 && (
            <text
              className="mtree-chevron-count tabular"
              x={chevronX}
              y={pos.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {pos.hiddenChildCount > 9 ? '+' : pos.hiddenChildCount}
            </text>
          )}
          {expanded && (
            <path
              className="mtree-chevron-glyph"
              d={`M ${chevronX - 3} ${pos.height / 2} h 6`}
            />
          )}
        </g>
      )}

      {/* A leaf gets a quiet dot at the reading start so a row of entries reads
          as a list rather than as four unrelated cards. Purely decorative. */}
      {isLeaf && <circle className="mtree-leaf-dot" cx={rtl ? pos.width - 4 : 4} cy={pos.height / 2} r={2} aria-hidden="true" />}

      {/* The selection tick, at the block-start reading-START corner — the one
          corner nothing else uses (the breach mark owns the reading END, and the
          label and count own the middle band), so a ticked, breached item shows
          both marks rather than one covering the other.

          aria-hidden because `aria-selected` on the group above already carries
          it: a screen reader announcing "selected" and then a tick glyph would
          say the same fact twice. It is drawn at all because a SIGHTED reader
          ticking six items across three branches has no other way to see which
          six are travelling when the drag starts. */}
      {isLeaf && selected && (
        <g className="mtree-node-tick" aria-hidden="true">
          <circle cx={tickX} cy={11} r={7} />
          <path className="mtree-node-tick-glyph" d={`M ${tickX - 3} ${11} l 2 2.4 l 4 -4.8`} />
        </g>
      )}
    </g>
  )
})

export default MindNode
