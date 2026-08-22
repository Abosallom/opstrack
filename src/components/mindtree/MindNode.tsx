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
//
// WHAT THE RADIAL LAYOUT COST THIS FILE, and what it deliberately did not. The
// map now places nodes on rings around a hub instead of in left-to-right rows,
// and THE BOXES STILL DO NOT ROTATE — that is the entire payoff of positioning
// polar rather than drawing sunburst arcs. Everything below that resolves a
// direction into an x (`startX`, `endX`, `markX`, `tickX`), the <rect> that
// takes every pointer, the `CHAR_PX` glyph budget and the CSS translate tween
// are unchanged and unchangeable by the flip: a rectangle at 9 o'clock is the
// same rectangle, moved.
//
// Three things do change, and all three read their answer OFF THE GEOMETRY
// rather than off a new prop, so no plumbing crosses a unit boundary:
//
//  · `pos.outward` (lib/mindtree/radial.ts) is a point on the ray from the hub,
//    9 units past this node's own edge, relative to this node's corner and in
//    the SAME already-mirrored space as x/y. The chevron is drawn there instead
//    of at the inline-end edge, because a node at 9 o'clock has its children to
//    its LEFT and an inline-end chevron would point back into the ring. The
//    linear layout emits `undefined`, and the fallback below is that layout's
//    old expression byte for byte.
//  · The root is drawn as a PILL (`rx = height / 2`). It is the origin the rings
//    are struck from, not the first of a list.
//  · A node too narrow to hold a word puts its label OUTSIDE, along the ray. On
//    a 375px phone the outer ring is 44x44 chips; a ring of numbered dots with
//    no names is not a mind map, and the label placement is the only thing
//    standing between this drawing and that one.
//
// ── WHAT THE CAMERA COST THIS FILE: FIVE DRAWINGS, NOT ONE THAT SCALES ─────
//
// This component now renders one of five AUTHORED drawings, selected by
// `band` — `lib/mindtree/lod.ts`'s answer to "how big is this node's world on
// screen, in CSS pixels". It is the whole of the zoom brief in one sentence: a
// node is not one component that scales, it is a component that renders
// DIFFERENTLY at each distance, showing what is legible and useful there and
// nothing else. Scale the reference video's first frame 20x and you get a blurry
// blue blob; every level of that film was authored at its own scale instead.
//
//   ABSENT  a rect nobody can see (`visibility: hidden`), kept in the DOM so the
//           `role="tree"` walk is complete and the set is never renumbered.
//   GRAIN   ONE filled disc. No text of any kind. The video's blue smudge on the
//           tongue: "there is something here and it is that programme's colour".
//           Forty grains read as a dense arc and six as a constellation — that
//           density difference IS the information at this distance, and it is
//           free, because it is the fan-out the geometry already encoded. ONE
//           MARK PER NODE, NEVER A SAMPLE: model.ts's standing rule is that a
//           branch labelled 12 showing 3 is the worst thing this map can do.
//   STATE   disc + its own rim + the breach dot. STILL NO TEXT — a numeral
//           inside a 30px disc renders at 3px and is a lie about legibility.
//   CHIP    the 44x44 box, count centred inside, NAME OUTSIDE along the ray.
//   CARD    the full box: name inside, count at the reading end, chevron,
//           breach, and the progress underscore.
//   OPENING the card dissolves; the name has already migrated to the rim label
//           (MindWorldRim). An ORGANIZATION LEAF does not dissolve — it holds
//           and gains a second line, because it is the only thing on the canvas
//           with nothing beneath it competing for the room.
//   FRAME   nothing at all. The world is the stage now; its border is an HTML
//           border on the canvas element and its name is in the breadcrumb.
//
// TWO INVARIANTS, and they are what make this the reference rather than a
// magnifier:
//
//  1. NO BAND RENDERS A NODE AT A SIZE THE BAND BELOW RENDERED IT. A card is not
//     a scaled chip; it is a different set of marks. `lod.test.ts` asserts it by
//     rendering every band of one fixture node and comparing the mark sets.
//  2. TOTAL INK PER UNIT AREA IS ROUGHLY CONSTANT. As a world opens and loses
//     its card, its children arrive with theirs. The picture never empties and
//     never floods.
//
// TEXT NEVER TWEENS ITS OPACITY, and this is the rendering invariant that makes
// the cross-fades legal. mindtree.css measured what a faded mark costs — edge ink
// at `opacity: .55` falls 6.06/5.53 to 3.76/3.20 — so ONLY NON-TEXT INK
// DISSOLVES here. A name hands off at a band edge, instantly, from card to rim
// label (and later from rim label to breadcrumb): it is never absent, never
// drawn twice, and never on screen at a ratio it was not measured at.
//
// ── EVERY MARK IN THIS FILE IS AUTHORED IN LEAF UNITS ──────────────────────
//
// The node's <g> is drawn inside `scale(pos.cardScale)`, and that one attribute
// is the whole of the fix for eight of the fifteen defects the render harness
// measured. Before it, this file authored its marks in LEAF units while the
// layout placed them in WORLD units: `worlds.ts` scales a card by
// `cardScale = worldD / D_LEAF`, so a depth-4 card is 73,284 units wide, while
// `PAD = 12`, `COUNT_SLOT = 34`, `CHAR_PX = 6.2`, the breach `r={4}`, the
// chevron `r={7}`, `PROGRESS_H = 3`, `rx={10}` and every CSS length
// (`font-size: 12.5px`, `stroke-width: 1`, `[data-empty]`'s `stroke-dasharray:
// 2 4`) stayed at 1x. `public/__lookat/desktop-full.svg` is the proof: a
// 73,284-unit card carrying 12.5-unit text and a 1-unit outline, which at
// `scale 3.98e-3` is a 292 px card with a 0.05 px label and a 0.004 px outline.
//
// SVG TRANSFORMS SCALE STROKE WIDTHS AND DASH ARRAYS as well as coordinates,
// which is why this is ONE change and not fourteen: the font size, the glyph
// budget, the corner radius, both dash arrays, the breach dot, the chevron and
// the underscore all come right together, and every constant below stays byte
// for byte what it was.
//
// So `pos.width`, `pos.height`, `pos.outward` and the world triple arrive in
// WORLD units and are divided by `cardScale` ONCE, at the top of the component.
// Nothing below reads `pos.width` again.
//
// WHAT IT DELIVERS, in numbers, so the next reader can check it rather than
// believe it. An authored length of `u` renders at `u × cardScale × scale` CSS
// px, and `worlds.ts` sets `cardScale` by TWO rules, not one:
//
//   a LEAF fills its world     cardScale = worldD / 200          → u × D/200
//   a PARENT yields to its ring
//                              cardScale = 0.34·worldD / 173.66  → u × D/510.8
//
// (173.66 is hypot(168, 44), the leaf card's diagonal; 0.34 is HOLE_FRACTION,
// which inscribes a parent's card in the hole its children's ring leaves.) So
// across the CARD band (worldD 140–380 px) the 12.5px label is 8.75–23.75 px on
// a LEAF and 3.43–9.30 px on a PARENT, and the 1-unit outline is 0.70–1.90 px
// and 0.27–0.74 px. Across CHIP (52–140 px) the leaf's label is 3.25–8.75 px.
//
// ── WHAT WAVE 5 CHANGED: A STROKE HAS A FLOOR, A GLYPH HAS A GATE ──────────
//
// The figures in the paragraph above were reported and not patched, because the
// three constants that produce them are owned by three different places. Wave 5
// takes the decision in ONE place — `lod.ts`'s header carries the whole table
// and `FLOOR` carries the two numbers — and this file implements the half of it
// that is a drawing decision. Two rules, and they are different on purpose:
//
//   A STROKE HAS A FLOOR. A boundary is not something you read, so it can be
//   widened without lying about anything. Every stroke and every dash below is
//   multiplied by `--mtree-hair`, which is the width that puts `FLOOR.STROKE_PX`
//   on the glass at the WORST camera this node's band allows.
//
//   A GLYPH HAS A GATE. A glyph cannot be enlarged without breaking the
//   `CHAR_PX` budget its card was measured against — the card would overflow —
//   so a glyph whose card cannot pay `FLOOR.TEXT_PX` for it IS NOT DRAWN. Not
//   shrunk, not faded: absent, with the name arriving at the band that can
//   afford it and, for a world with children, on its camera-pinned rim.
//
// ── AND THE UNIT THE TYPE IS AUTHORED IN IS THE WORLD, NOT THE CARD ────────
//
// `--mtree-world` is `worldD / (D_LEAF x cardScale)`, floored at 1. It is
// EXACTLY 1 for a card that fills its own world — so a leaf's drawing is byte
// for byte what wave 1 shipped — and `leafDiag / (HOLE_FRACTION x D_LEAF) =
// 173.666 / 68 = 2.5539` for a card inscribed in its children's ring. Multiply
// it into an authored `u` and the ink on the glass collapses to ONE identity,
// the same for every node at every depth in every role:
//
//     css px = u x --mtree-world x cardScale x scale  =  u x apparent / D_LEAF
//
// which is the line `lod.ts` derives `BAND_EDGES.card = 157` from. Without it a
// parent's 12.5 lands at `12.5 x apparent / 510.8` — 3.84 px at that same edge —
// and no band edge below the opening picture's 185.8 px ceiling could ever have
// lifted it. WITH it, the parent's card becomes what it geometrically is: a
// 65.8 x 17.2 WORLD-unit box, which is narrower than `LABEL_INSIDE_MIN` and so
// takes the drawing this file already had for a box too narrow to hold a word —
// name outside on the ray, count alone in the middle. No new predicate, no
// second layout: `room = width / --mtree-world` is the one line that routes it.
//
// WHAT A YIELDING CARD GIVES UP, stated rather than discovered: its chevron
// (the ray is spent on the word — the argument this file already made about the
// chip) and, below 157 px, its words entirely. What it does not give up is its
// box, its outline, its count, its breach dot and its progress underscore.
//
// THE ALTERNATIVE — counter-scaling by the camera, `font-size: 13/scale` — was
// rejected for three reasons, and the third decides it: (1) it makes every
// node's props camera-dependent, so `memo()` stops paying and a wheel notch
// re-renders every node, the exact thing MapCanvas's band memo exists to
// prevent; (2) it breaks LOD invariant 1 — a card at 200 px and a card at
// 350 px would carry differently proportioned text; (3) `worlds.ts` already
// states the contract this restores, verbatim: "A card occupies the same share
// of its world at every depth, so the LOD bands are one table that applies to
// the root and to a leaf identically." Today that sentence is false. The scale
// transform makes it true. It is a bug fix against a written contract.
//
// AND THE OTHER RULE, which lives in MindWorldRim.tsx: a rim is CHROME and is
// pinned to the CAMERA (`--mring-px`), not to its world. A card is a drawing at
// its own level; a rim is the stage's own furniture on its way to becoming the
// breadcrumb. Two rules, each with its own stated reason.
//
// GRAIN AND STATE ARE NOT CONTROLS. They carry no `role`, no `tabIndex` and no
// handlers, they are `aria-hidden`, and they are NOT emitted into the
// `role="tree"` DOM at all — so the roving tabindex can never land on an
// aria-hidden mark, and WCAG 2.5.8's target size does not apply because they are
// not targets. They are reachable three other ways: zoom to them, the accessible
// table, or search.
//
// ── AND THE SIXTH DRAWING, WHICH IS THE FIRST ONE AGAIN: `flat` ────────────
//
// Everything above describes the CONTAINMENT drawing, where a node is a world
// and the camera dives into it. The map's other drawing — the vertical wrapped
// tidy tree, `layoutMindtree({ orientation: 'vertical', wrap: true })` — is
// governed by a rule that contradicts the whole of the paragraph above, and the
// owner stated it in one line: EVERY DETAIL IS VISIBLE AT EVERY ZOOM. A card
// never becomes a dot, a chip, a disc or a blur; if it is drawn at all it is
// drawn in full; nothing is ever collapsed. There is no level of detail there,
// because uniform cards in a regular grid are the point, and a card that
// dissolves into a grain when the reader pulls back is the exact opposite of it.
//
// `flat` is that rule, as one prop. It coerces the band to `card`, treats the
// node's world as absent, opens every `pays()` gate, keeps the name inside the
// box and drops the chevron disc. See the prop's own documentation for what each
// of those does and — more importantly — for why the five drawings are switched
// OFF rather than deleted: `pages/Mindtree.tsx` still calls `layoutWorlds` by
// default, and `mapRender.test.tsx` still measures fifteen renders of it.
//
// The two drawings differ in one more place, and it is not in this file: on the
// flat tree the per-child connectors are replaced by BLOCK CONTAINERS
// (`lib/mindtree/blocks.ts`, `components/mindtree/MindBlock.tsx`), which is what
// makes the chevron redundant rather than merely unwanted.

import {
  memo,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { isolate, stripIsolates } from '../../lib/bidi'
import type { Point, PositionedNode } from '../../lib/mindtree/layout'
import { FLOOR, bandFloorPx } from '../../lib/mindtree/lod'
import type { Band } from '../../lib/mindtree/lod'
import type { MindNode as MindNodeModel } from '../../lib/mindtree/model'
import { D_LEAF } from '../../lib/mindtree/radial'
import { useMindIsSelected } from '../../store/mindtree'

/**
 * A positioned node, plus the four numbers the containment layout adds.
 *
 * ALL FOUR ARE OPTIONAL AND THAT IS DELIBERATE, not a hedge: `layout.ts`'s
 * linear tidy tree and `radial.ts`'s rings emit `PositionedNode` and know
 * nothing about worlds, and this component still draws both. When the world
 * fields are absent every band falls back to the node's own box, which is the
 * best available answer and is exactly what the drawing did before the camera.
 *
 * It is a WIDENING of the `pos` prop's type rather than a new prop, so nothing
 * that already passes a `PositionedNode` has to change, and `MindNodeProps`
 * gains exactly the two props the contract names.
 */
export type MindNodePos = PositionedNode<MindNodeModel> & {
  /** Centre of this node's world, absolute drawing units. */
  readonly worldX?: number
  readonly worldY?: number
  /** Diameter of this node's world, drawing units. The band's input. */
  readonly worldD?: number
  /**
   * How much bigger than a leaf's this world's authored drawing is
   * (`WorldNode.cardScale`, worlds.ts:241, already exported and already on
   * every node `MapCanvas` is handed). `worldD / D_LEAF` for a LEAF; a node
   * with children instead yields to its ring at `HOLE_FRACTION·worldD /
   * leafDiag` — worlds.ts:83-85 states both rules and this file's header
   * carries the two number ranges they produce.
   *
   * IT IS THE ONLY NEW NUMBER THIS COMPONENT NEEDED, and it needs it because
   * `width`/`height` already carry it: the card is authored at 168x44 and
   * arrives multiplied. Dividing it back out is what lets every constant in
   * this file stay at 1x inside a `scale()` — see the header. Absent (the tidy
   * tree, the ring, the export path) it is 1 and the drawing is byte for byte
   * what it was.
   */
  readonly cardScale?: number
}

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
  /**
   * The progress underscore's two numbers — Organizations beneath that are live,
   * out of all of them. `lib/mapNodes.ts`'s `useCaseProgress()` already returns
   * this shape and already refuses to summarise disagreeing organizations with
   * one word. Absent or null on a node the roll-up does not cover.
   *
   * IT IS NUMBERS, NOT A FRACTION, because the accessible name has to state the
   * same fact in words (`mindtree.nodeName` carries a `{done} of {total} live`
   * clause) and one source for both is the only way the picture and the sentence
   * cannot drift. The mark encodes LENGTH AND COLOUR ALONE, so WCAG 1.4.1 is
   * kept honest by that clause and by nothing else.
   */
  progress?: { readonly done: number; readonly total: number } | null
  /**
   * The Organization leaf's second line — account manager and vendor, already
   * joined and isolated by the page.
   *
   * THE ONLY THIRD TEXT ROW ON THE CANVAS, and it is drawn in exactly one place:
   * a terminal node past 380px, which is the only node with nothing beneath it
   * competing for the room. Everything else about an Organization — the use
   * cases integrated, the outstanding issues, the matrix — belongs to the info
   * sidebar and is one tap away.
   */
  secondary?: string | null
}

export interface MindNodeProps {
  pos: MindNodePos
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
  /**
   * WHICH OF THE FIVE DRAWINGS TO RENDER — `lod.bandBlend(...).band`, computed
   * once in the page's memo from this node's world diameter and the camera's
   * scale. Never computed here: this component renders once per node and there
   * can be hundreds, and the band is the same arithmetic for all of them.
   *
   * OPTIONAL, DEFAULTING TO `card`, and the default is what makes this file
   * shippable on its own. `card` is byte-for-byte the drawing this component has
   * always produced, so every caller that has not been taught about the camera
   * yet — the linear tidy tree, the export path, today's `MapCanvas` — renders
   * exactly what it rendered before. The camera's page passes the real band.
   */
  band?: Band
  /**
   * 0..1 cross-fade progress within `band`, from `lod.bandBlend`. Only `opening`
   * and `frame` read it; every other band ignores it, because every other band
   * is a resting picture and OPACITY IS NEVER A RESTING STATE.
   */
  bandOut?: number
  /**
   * THERE IS NO LEVEL OF DETAIL IN THIS DRAWING. Draw the full card, at every
   * distance, always.
   *
   * ── WHAT IT SWITCHES OFF, EXACTLY ─────────────────────────────────────────
   *
   * `band` is coerced to `card`, so the GRAIN disc, the STATE disc-and-rim, the
   * `frame` disappearance and the `opening` dissolve are all unreachable; the
   * node's `worldD` is treated as absent, so `--mtree-world` and `--mtree-hair`
   * are 1 and every constant in this file lands at the size it was authored at;
   * every `pays()` gate opens, so no glyph is ever dropped for being small; the
   * label is never flung outside its box; and the chevron — a filled disc hung
   * off the card's inline-end edge, touching nothing — is not drawn at all.
   *
   * ── WHY IT IS A PROP AND NOT A DELETION ───────────────────────────────────
   *
   * Because the five drawings are not dead code. `pages/Mindtree.tsx` still
   * calls `layoutWorlds` by default and still dives through it, and that drawing
   * is the one the whole of `lod.ts`, `mind-ring.css` and the fifteen-render
   * gate in `mapRender.test.tsx` exist for. What the owner asked to be rid of is
   * the level of detail IN THE TREE — a card that becomes a dot when the camera
   * pulls back, in a drawing whose stated first rule is that every detail is
   * visible at every zoom. So the machinery stays, whole and tested, behind a
   * flag the tree turns off rather than being cut out from under a drawing that
   * still ships.
   *
   * ── WHY THE FLAG IS "NO WORLD" AND NOT "BAND = CARD" ──────────────────────
   *
   * A band of `card` alone would not have been enough, and this is the subtle
   * half. `pages/map/treePreview.ts` bolts INVENTED disc geometry onto the tidy
   * tree so the containment camera can drive it — `worldD = 1.6 x max(w, h)` —
   * and this component divides the type and the strokes by exactly that number:
   * `worldFactor = worldD / (D_LEAF x cardScale)` comes out at 1.344 for a
   * 168-unit card, which would draw a 12.5px label at 16.8px and a 1-unit
   * outline at 1.34. The card would be the right size with the wrong ink in it.
   * Treating the world as ABSENT is what returns this file to the drawing it
   * ships for a layout that genuinely has no worlds — the tidy tree, the phone's
   * ring, `export.ts`'s serialiser — which is byte for byte the drawing wave 1
   * shipped.
   *
   * Defaults to false, so every existing caller is untouched.
   */
  flat?: boolean
}

/** Inline breathing room inside a node box, and the space kept for the count. */
const PAD = 12
const COUNT_SLOT = 34

/**
 * THE TYPE SIZES `mindtree.css` AUTHORS, restated here because this file is
 * where the decision to DRAW a glyph is taken and that decision is arithmetic on
 * exactly these numbers.
 *
 * TWO COPIES OF FOUR NUMBERS, PINNED EQUAL BY THE RENDER GATE — which reads the
 * sheet off disk and asserts each of these against the declaration it belongs
 * to (`mapRender.test.tsx`'s "the gate itself"). The alternative is a component
 * that measures text, which `truncate`'s own header already refuses for the
 * reason charts/Chart.tsx states: a second layout pass per node per render.
 */
const LABEL_PX = 12.5
const COUNT_PX = 11.5
const CHEVRON_COUNT_PX = 9.5
const SECONDARY_PX = 11

/**
 * GRAIN's disc, as a fraction of the world's DIAMETER — so the mark is
 * `0.42 x apparent` at every distance without this component knowing the scale.
 * The whole band is 7-26px, so the disc runs 2.9-10.9px: a texture, not a shape.
 */
const GRAIN_DISC = 0.42

/**
 * STATE is a disc AND a rim, and the disc is SMALLER than GRAIN's rather than
 * bigger — which is the first invariant made concrete. A grain that simply grew
 * would be the same drawing at another size; a smudge that resolves into a
 * ringed dot is a different mark, and it is the first moment the drawing says
 * "this is a place with an edge" rather than "there is something here".
 */
const STATE_DISC = 0.3
const STATE_RIM = 0.52
/** The breach dot at STATE: 0.2 x apparent, so 5-10px across the band. */
const STATE_BREACH = 0.1

/**
 * The progress underscore: 3 units tall, sitting 5 units inside the block end.
 *
 * FIVE AND NOT THREE FOR THE INSET, and the two units are the difference
 * between a data mark and a second bottom edge. At three, the bar's own outer
 * edge stands 3 units off the card's border and the border is a 1-unit stroke
 * centred on it — 2.5 units of clear fill, which at 1:1 is 2px. Two marks 2px
 * apart, both drawn in the branch ink at full strength, one of them running
 * most of the card's width, read as a DOUBLE RULE along the bottom of the card
 * rather than as a length somebody is meant to compare against its neighbour's.
 * It is worst exactly where it matters most: the block container's stub leaves
 * from the same edge, so on a parent card there were three horizontal marks
 * stacked inside five pixels.
 *
 * THREE AND NOT TWO FOR THE HEIGHT, and that number is not a taste — it is the
 * size of the only discriminator between two readings that mean opposite
 * things. Once `PROGRESS_RAIL_H` put a full-budget rail under every card that
 * holds a total, LENGTH stopped separating the two ends of the scale: a card
 * that is 0-of-N draws a 144-unit rail and no bar, and a card that is 142.9-of-
 * 144 draws a 144-unit rail with a bar over 99% of it. Both are a uniform line
 * running the whole budget. Eleven of the 153 cards in the shoot are past 92%
 * and one is at 99.2%, so this is not a corner the fixture had to be bent to
 * reach — it is a row of ordinary healthy accounts. At `PROGRESS_H = 2` the
 * entire difference between "none of this is live" and "all of it is" was ONE
 * PIXEL of height at 1:1, and the count cannot break the tie because the count
 * is the total, not the live figure. Hunting dead accounts down a column of
 * near-full siblings is the exact job the rail was added for, and it was the
 * job the rail had quietly made harder at the top of the range while fixing it
 * at the bottom.
 *
 * The repair is bought where the rail was bought — in FORM, at full ink, with
 * no new colour and no new row in `mindtree.css`'s contrast matrix. A 3-unit
 * bar on a 1-unit rail is a 3:1 step where 2:1 was, so the mark a reader has to
 * tell apart from a hairline is three times its thickness instead of twice, and
 * the "plinth standing on a baseline" reading the pair was designed around gets
 * louder rather than different. Nothing else about the pair moves: same ink,
 * same bottom edge, same budget, same divide.
 *
 * The card has the room and nothing else wants it: the label is centred on
 * `height / 2` and a 12.5px face reaches ~26 of a 44-unit card's units, so the
 * bar's top at 36 is ten units clear below it — one unit less than the two-unit
 * bar left, and nine more than the descender needs. The second line is not a
 * constraint either — it is drawn only on a terminal card past 380px, where
 * `TWO_LINE_BOTTOM` is nine units under a centre that is far above this bar.
 */
const PROGRESS_H = 3
const PROGRESS_INSET = 5

/**
 * THE RAIL THE BAR IS READ AGAINST: the same underscore, a third as tall, drawn
 * across the WHOLE budget whenever there is a total to divide.
 *
 * THIS REVERSES "THERE IS NO TRACK BEHIND THE REMAINDER", which this file and
 * `mind-ring.css` both argued at length, so the reversal is argued rather than
 * quietly performed. The old rule was right about ITS reason and wrong about
 * the conclusion. Its reason: a track drawn in the card's outline ink at 20%
 * is a DILUTED mark, dilution composites toward the surface underneath and
 * hands the measured ratio back, and that recipe is in no matrix this repo
 * keeps. All of that still holds and nothing below spends a drop of it.
 *
 * What the old rule got wrong is that the bar without a rail is not a
 * measurement. Three readings the pictures actually produce:
 *
 *   · "0 of 4 live" and "no progress data" are THE SAME CARD. 22 of the 153
 *     cards in the current shot are in that state, and every one of them is a
 *     card an account manager most needs to see. (An earlier draft of this
 *     paragraph said 42, which was `153 − 111`: it folded in the 20 EMPTY
 *     organizations, cards that correctly hold no figure at all. The census
 *     is 133 cards with a total, 111 with a bar, 22 with a bare rail.) A
 *     drawing that cannot distinguish "nothing is live here" from "we do not
 *     know" is not quiet, it is silent about the thing it was drawn to say.
 *   · A bar two-thirds across is two-thirds of WHAT. Without the far end
 *     drawn, 4-of-6 and 4-of-4 are the same mark at different lengths on
 *     cards of the same size, and the reader has no way to tell which of the
 *     two they are looking at. Length can only encode a share if the whole is
 *     on the page.
 *   · Bars of arbitrary reach across 153 uniform cards read as decoration —
 *     an underline somebody chose the width of — rather than as an instrument.
 *
 * AND THE RAIL IS BOUGHT IN FORM, NOT IN CONTRAST, which is this sheet's own
 * standing move: `mindtree.css` cues container depth with STROKE WIDTH for
 * exactly this reason ("which costs no contrast at all") after measuring what
 * fading costs. The rail is `--mtree-ink` AT FULL STRENGTH, the same ink and
 * the same 6.35 / 5.53 on a node fill that the bar already carries — no new
 * colour, no new recipe, no row to add to the matrix. It is told apart from the
 * bar by being A THIRD OF ITS HEIGHT, and the bar is drawn on top of it, so the
 * mark reads as a plinth standing on a baseline.
 *
 * A THIRD, WHERE THIS STARTED AT A HALF, AND THE UNIT WENT ON THE BAR rather
 * than coming off the rail. `PROGRESS_H` carries the argument for why the step
 * had to widen at all; the part that belongs here is why the rail did not
 * shrink to buy it. The rail is the one mark on this card already drawn at its
 * floor: at 1 unit it is a single device pixel at 1:1 and a coverage tone at
 * every camera below, and there is no half-unit rail to be had — the paragraph
 * below refuses one, and for a reason that has not changed. A step can only be
 * bought on the side of the pair that has room to spend it.
 *
 * ONE AND NOT 0.5, AND BOTTOM-ALIGNED RATHER THAN CENTRED, and both are about
 * the raster and not about taste. A rail centred on the bar's band would start
 * at a half unit — at 1:1 a 1px line laid across two pixel rows at half alpha
 * each, which is a DILUTED line arrived at through antialiasing instead of
 * through a colour, i.e. precisely the thing the paragraph above refuses.
 * Bottom-aligned, rail and bar share their lower edge and land on the same
 * fraction of the grid, whatever fraction that is.
 *
 * WHAT HAPPENS WHEN THE PICTURE SHRINKS is the reason a form step is safe here
 * at all. At the overview camera's 0.343 the bar is 1.03px and the rail 0.34px,
 * and a sub-pixel line is painted by coverage: the rail arrives as the lighter
 * of two tones of one ink, and the widened step buys the far camera something
 * the 2:1 pair could not — the bar now clears one whole device pixel there, so
 * it is a solid line against a partial one rather than two partial ones whose
 * separation depends on where each lands on the grid. The step survives the
 * whole zoom range by changing
 * WHICH property carries it — thickness up close, tone far away — which is the
 * same thing the container border ramp does and is not a level of detail: every
 * card draws every mark at every scale, and only the raster is talking.
 */
const PROGRESS_RAIL_H = 1

/** The two baselines a terminal card uses once it has a second line. */
const TWO_LINE_TOP = -8
const TWO_LINE_BOTTOM = 9

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
/**
 * Below this inline size a node cannot hold a word, so its label goes OUTSIDE.
 *
 * DERIVED FROM THE BUDGET ABOVE, not chosen: the inside label gets
 * `width - PAD*2 - COUNT_SLOT` px of room, so at 96 units a branch carrying a
 * count has `96 - 24 - 34 = 38`px — six glyphs at `CHAR_PX`, which is "Netwo…".
 * Anything narrower is a chip with an elision in it rather than a label.
 */
const LABEL_INSIDE_MIN = 96

/** How far past `outward` the outside label sits, along the same ray. */
const OUTSIDE_LABEL_GAP = 8

/**
 * The outside label's glyph budget.
 *
 * A FIXED NUMBER RATHER THAN A MEASUREMENT, because the constraint on an
 * outside label is not the box — there is no box — it is the ANGLE to the next
 * node on the same ring, which this component cannot see and must not be told
 * (it would be a second source of truth for something radial.ts already owns).
 * 14 glyphs is ~87px at `CHAR_PX`, which is the widest label that still leaves
 * daylight between two neighbours on the tightest ring the phone lays out.
 */
const OUTSIDE_LABEL_BUDGET = 14

/** Where an outside label is drawn, and which end of it is pinned there. */
interface OutsideLabel {
  readonly x: number
  readonly y: number
  readonly anchor: 'start' | 'end'
}

/**
 * The outside label's placement: `outward`, pushed `OUTSIDE_LABEL_GAP` further
 * along the ray it already lies on, anchored so the words run AWAY from the hub.
 *
 * THE ANCHOR IS THE ONE PLACE THE RADIAL FLIP NEEDS `rtl` AT ALL, and the file
 * header's text-anchor paragraph is exactly why. Every coordinate here arrives
 * pre-mirrored from radial.ts, so no coordinate is multiplied by a direction.
 * But `text-anchor: start|end` are LOGICAL keywords resolved against the
 * group's `direction`, so under `rtl` `start` is the run's RIGHT extremity —
 * and this placement's requirement is PHYSICAL ("the words must run away from
 * the centre of the drawing"), not logical ("the words must start at the
 * reading edge of a box"). A purely geometric `outward.x > cx ? 'start' : 'end'`
 * therefore comes out inverted in Arabic and hangs every outside label back
 * across its own ring — the same double-mirror the header records, arriving
 * from the other side. `!== rtl` is that inversion, stated once:
 *
 *     ltr, right of hub  → run grows +x → 'start'
 *     ltr, left of hub   → run grows -x → 'end'
 *     rtl, right of hub  → run grows +x → 'end'    (rtl 'end' pins the left)
 *     rtl, left of hub   → run grows -x → 'start'  (rtl 'start' pins the right)
 *
 * A DEPARTURE from MAP-REDESIGN §U3, which specifies the bare geometric test;
 * see the run notes. The bare test is right in English and mirrored in Arabic,
 * and "RTL equal to LTR" is not a rule with an exception in it.
 */
function outsideLabelAt(
  width: number,
  height: number,
  outward: Point,
  rtl: boolean,
  /** `OUTSIDE_LABEL_GAP` in the units this node's type is authored in. */
  gap: number,
): OutsideLabel {
  const cx = width / 2
  const cy = height / 2
  const dx = outward.x - cx
  const dy = outward.y - cy
  // A hub-centred node has no ray. It cannot reach here (the hub is never
  // narrow enough) but the division must still be total.
  const len = Math.hypot(dx, dy) || 1
  return {
    x: outward.x + (dx / len) * gap,
    y: outward.y + (dy / len) * gap,
    anchor: (outward.x > cx) !== rtl ? 'start' : 'end',
  }
}

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
  band: bandRead = 'card',
  bandOut = 0,
  flat = false,
}: MindNodeProps): ReactElement | null {
  /**
   * THE BAND, AFTER THE FLAT TREE HAS HAD ITS SAY. One expression, at the top,
   * so that every one of the eleven tests below reads the same answer and no
   * branch can be reached by asking the raw prop instead — which is the failure
   * mode a second `if (flat)` scattered through the body would have.
   */
  const band: Band = flat ? 'card' : bandRead
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

  /**
   * THE ONE DIVISION, and everything below is in leaf units because of it.
   *
   * TOTAL RATHER THAN TRUSTING: a zero, a negative or a NaN `cardScale` would
   * turn every coordinate in this component into a NaN or an Infinity and the
   * node would vanish from a drawing that still claims it in the `role="tree"`
   * walk. 1 is the layouts that have no worlds at all, so the fallback is not a
   * guess — it is the other drawing this component ships.
   */
  const cardScale =
    pos.cardScale !== undefined && Number.isFinite(pos.cardScale) && pos.cardScale > 0
      ? pos.cardScale
      : 1
  /** The card's box in LEAF units — 168x44 at every depth. */
  const width = pos.width / cardScale
  const height = pos.height / cardScale

  /**
   * This node's world, in DRAWING units, and the smallest apparent size its
   * band allows. Everything below is derived from these two and from
   * `cardScale`; no camera number reaches this component, which is what keeps
   * `memo()` paying across a zoom (see the header's rejected alternative).
   */
  const hasWorld =
    !flat && pos.worldD !== undefined && Number.isFinite(pos.worldD) && pos.worldD > 0
  const worldDrawn = hasWorld ? (pos.worldD as number) : Math.max(pos.width, pos.height, 1e-6)
  const bandFloor = bandFloorPx(band)

  /**
   * THE UNIT THE TYPE AND THE STROKES ARE AUTHORED IN — see the header.
   *
   * FLOORED AT 1, and the floor is what keeps the two layouts that have no
   * worlds byte for byte what they were: the tidy tree and the phone's ring
   * hand this component a 168x44 or a 44x44 box with no `worldD` at all, and
   * `max(pos.width, pos.height) / D_LEAF` would otherwise SHRINK their type.
   * A card can only ever be told to draw at its world's scale or at its own,
   * never smaller than its own.
   */
  const worldFactor = Math.max(1, worldDrawn / (D_LEAF * cardScale))

  /**
   * CSS px this node is GUARANTEED for a mark authored at `units`, at the worst
   * camera its band allows — `units x --mtree-world x cardScale x scale` with
   * `scale >= bandFloor / worldD` substituted. On a world layout it collapses to
   * `units x bandFloor / D_LEAF`, which is the identity `lod.ts` cuts the band
   * edges on.
   */
  const inkPx = (units: number): number => (units * worldFactor * cardScale * bandFloor) / worldDrawn
  /**
   * A glyph this card cannot pay `FLOOR.TEXT_PX` for is not drawn.
   *
   * TRUE OUTRIGHT WHERE THERE IS NO WORLD, and that is not a loophole — it is
   * the only sound answer. The tidy tree and the phone's ring are fitted to a
   * viewBox by their page, so `band` is this component's `card` default rather
   * than a camera's reading and the apparent-size relationship the whole of this
   * arithmetic rests on does not exist. Those two drawings are unchanged by this
   * wave, which is the property they are held to.
   */
  const pays = (units: number): boolean => !hasWorld || inkPx(units) >= FLOOR.TEXT_PX
  /**
   * The same question for the ONE glyph on this card whose sheet is not
   * `mindtree.css`: the Organization's second line is `.mring-secondary`, which
   * `mind-ring.css` authors and which this wave does not own, so it carries no
   * `--mtree-world` and is measured in the CARD's units rather than the world's.
   * Asking `pays()` about it would overstate its ink by the world factor.
   */
  const paysUnscaled = (units: number): boolean =>
    !hasWorld || (units * cardScale * bandFloor) / worldDrawn >= FLOOR.TEXT_PX

  /**
   * A STROKE HAS A FLOOR. `--mtree-hair` multiplies every stroke width and every
   * dash in the sheet, and it is the world factor RAISED until a 1-unit outline
   * clears `FLOOR.STROKE_PX` at the band's own bottom edge. It is exactly the
   * world factor at `card` and above (`0.75 x 200 / 157 = 0.955`, so the floor
   * is already met); at `chip` it is `0.75 x 200 / 52 = 2.885` times it, which
   * is right — there the outline is the whole mark, the words having gone.
   *
   * `absent` is exempt because it is `visibility: hidden`: flooring a stroke
   * nobody can see against a 4px DOM horizon would compute a 37-unit hairline
   * for no reader.
   */
  const hair =
    band === 'absent' || !hasWorld
      ? worldFactor
      : Math.max(worldFactor, (FLOOR.STROKE_PX * worldDrawn) / (cardScale * bandFloor))

  /**
   * The card's inline room IN THE UNITS ITS TYPE IS AUTHORED IN — 168 for a card
   * that fills its world, 65.8 for one inscribed in its children's ring. THE ONE
   * LINE THAT ROUTES A YIELDING CARD to the drawing this file already had for a
   * box too narrow to hold a word.
   */
  const room = width / worldFactor
  const pad = PAD * worldFactor

  const budget = Math.max(
    3,
    Math.floor((room - PAD * 2 - (hasCount ? COUNT_SLOT : 0)) / CHAR_PX),
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
  const startX = rtl ? width - pad : pad
  const endX = rtl ? pad : width - pad
  const markX = rtl ? PAD : width - PAD
  /** The selection tick's corner — the mirror of the breach mark's. */
  const tickX = rtl ? width - PAD : PAD

  /**
   * WHERE "AWAY FROM THE HUB" IS, or undefined on the linear layout.
   *
   * Read once into a local so the two consumers below narrow off the same
   * `const` — a property access would have to be re-narrowed at each use.
   *
   * IN LEAF UNITS LIKE EVERYTHING ELSE. `radial.ts` computes it from the card's
   * own half-width plus a gap, both already multiplied by `cardScale`, so it
   * lives in the same world-scaled space `width`/`height` arrived in and takes
   * the same one division. The identity `cardScale === 1` short-circuit keeps
   * the two layouts that have no worlds allocating nothing.
   */
  const outward =
    pos.outward === undefined || cardScale === 1
      ? pos.outward
      : { x: pos.outward.x / cardScale, y: pos.outward.y / cardScale }
  /**
   * The chevron's centre. On a ring it is `outward` — already mirrored, already
   * relative to this node's corner, so NOTHING is multiplied by a direction
   * here. On the linear layout `outward` is undefined and this is the
   * inline-end expression this line has always held.
   */
  const chevron = outward ?? { x: rtl ? -9 : width + 9, y: height / 2 }
  /**
   * Non-null when the label is drawn outside the box.
   *
   * GATED ON `outward` AND NOT ON WIDTH ALONE. "Outside" means "out along the
   * ray", and the linear layout has no ray — a linear node narrower than
   * `LABEL_INSIDE_MIN` (a phone's tightest `nodeSize`) would otherwise start
   * flinging its label at a point that does not exist. The linear drawing is
   * unchanged by this file's radial work, which is the property the flip is
   * being tested against.
   */
  /**
   * THE GATE IS THE ROOM, AND IT IS NOW THE ONLY GATE.
   *
   * `band === 'chip'` used to be an arm of this test, and wave 5 removed it
   * rather than kept it: the chip band draws no words at all now (`lod.ts`'s
   * header carries the 3.25 px that forced that), so an outside label there
   * would be a name at a size this file refuses to draw.
   *
   * What remains covers strictly more than the arm it replaced, because `room`
   * is measured in the units the type is authored in: 168 for a card that fills
   * its world, 44 for the phone drill-in's outermost ring (`ringNodeSize`, no
   * camera and therefore no band — the case this clause has always carried), and
   * 65.8 for a card inscribed in its children's ring, which is the new one.
   *
   * AND THE FLAT TREE NEVER TAKES IT, whatever the room comes to. "The name is
   * outside the box" is a level-of-detail drawing — it is what a node does when
   * it has become too small to hold its own word — and a drawing whose first
   * rule is that every card is drawn in full at every zoom has no such state.
   * The card either holds its name or truncates it; it never hangs it in the
   * gutter. Written as a gate here rather than left to `room >=
   * LABEL_INSIDE_MIN` happening to be true at 168 units, because that is an
   * accident of the default node size and this is a guarantee.
   */
  const outsideLabel =
    !flat && outward !== undefined && room < LABEL_INSIDE_MIN
      ? outsideLabelAt(width, height, outward, rtl, OUTSIDE_LABEL_GAP * worldFactor)
      : null

  /**
   * The centre and the diameter of this node's WORLD, in this group's own
   * coordinates (the <g> is translated to the node's corner).
   *
   * The fallback is the node's own box, which is what the linear and ring
   * layouts have. It is only ever consulted by GRAIN and STATE, which those
   * layouts never reach, so it costs them nothing and keeps the arithmetic
   * total.
   *
   * IN LEAF UNITS, because the grain/state <g> carries the same `scale()` the
   * card's does. Those two marks are authored as FRACTIONS of `worldD`, so the
   * scale changes none of their geometry — it changes their CSS lengths, which
   * are the same 1x-inside-a-world bug the header describes, arriving from the
   * other side: `.mring-state-rim`'s `stroke-width: 1` was one WORLD unit, and
   * at the state band (worldD 26–140 px, worldD ≈ 3,900 units at depth 3) that
   * is 0.005 px of ink. In leaf units it is `worldD_px / D_LEAF` = 0.13–0.70 px
   * — a hairline instead of nothing, which is why the FILL SHARE (mind-ring.css,
   * 44% at grain/state) is what actually carries these two distances.
   */
  const worldD = (pos.worldD ?? Math.max(pos.width, pos.height)) / cardScale
  const worldCX = pos.worldX !== undefined ? (pos.worldX - pos.x) / cardScale : width / 2
  const worldCY = pos.worldY !== undefined ? (pos.worldY - pos.y) / cardScale : height / 2

  /**
   * A node with nothing beneath it — an ORGANIZATION, the leaf of the department
   * hierarchy the dive walks.
   *
   * IT IS READ OFF THE MODEL, NOT OFF A NEW PROP, and `hasChildren` is the right
   * question rather than `kind`: `map_nodes` gives departments and organizations
   * the same `entity` kind (see `mapNodes.entityIdOf`), so the thing that makes
   * an Organization the end of the dive is not what it is called — it is that
   * there is nothing under it to dive INTO. A department the admin has not put
   * anything under yet behaves the same way, correctly: there is no world in
   * there to enter.
   */
  const terminal = !pos.hasChildren
  /** A terminal card holds past 380px and gains its second line. */
  const holding = band === 'opening' && terminal
  /** A world dissolving into its children. Non-text ink only; see the header. */
  const dissolving = band === 'opening' && !terminal
  /**
   * THE TWO BANDS THAT DRAW A BOX WITH WORDS IN IT, and `chip` is no longer one
   * of them — `lod.ts`'s header carries the arithmetic (a name there is
   * 3.25-9.8 px and a count 3.0-9.0 px, which is the same lie about legibility
   * the `state` band already refuses to tell about a numeral in a 30 px disc).
   * ABSENT draws a box with nothing in it, and a dissolving world draws a box
   * that is leaving.
   *
   * THE BAND SAYS WHERE, AND `pays()` SAYS WHETHER — one gate per glyph, because
   * the four type sizes on this card are four different numbers and the smallest
   * of them is what `BAND_EDGES.card` was cut on. Every one of these is asserted
   * against `FLOOR.TEXT_PX` on the glass, at five cameras, by the render gate.
   */
  const showText = band === 'card' || holding
  const showName = showText && pays(LABEL_PX)
  const showCount = hasCount && showText && pays(COUNT_PX)
  const secondLine =
    holding && paysUnscaled(SECONDARY_PX) && view.secondary != null && view.secondary !== ''
      ? // Truncated against the FULL inline room, not the label's: the second
        // line carries no count, so the `COUNT_SLOT` reservation is not its to
        // pay. By glyph count, never by measurement — see `truncate`. In CARD
        // units, because that is the unit `.mring-secondary` is authored in —
        // see `paysUnscaled`.
        truncate(view.secondary, Math.max(3, Math.floor((width - PAD * 2) / CHAR_PX)))
      : null
  /**
   * The progress underscore's WHOLE — the rail's length, and the length the
   * bar's share is taken of. Zero is the one value that means "this card has
   * no progress to draw at all", and it is now the ONLY way to say that: a
   * `done` of 0 is a real reading and gets a bare rail, where before it got
   * the same nothing an absent pair got.
   */
  const railW =
    (band === 'card' || holding || dissolving) && view.progress != null && view.progress.total > 0
      ? width - pad * 2
      : 0
  /**
   * The filled part, in drawing units. ONE DIVIDE — the only arithmetic in this
   * file that touches data rather than geometry, and it is here rather than in
   * the page's memo because the number it produces is a LENGTH, which is a fact
   * about this node's box and nothing the page can know.
   *
   * It divides by the RAIL rather than re-deriving the budget, which is what
   * keeps "full" meaning "reaches the end of the rail" by construction instead
   * of by two expressions agreeing about `pad`.
   */
  const fillW =
    railW > 0 && view.progress != null
      ? Math.max(0, Math.min(1, view.progress.done / view.progress.total) * railW)
      : 0

  // FRAME: nothing of this node is drawn in SVG. Its boundary is an HTML border
  // on the stage element — where the mirror is free and there is no x arithmetic
  // to get wrong — and its name is in the breadcrumb. The handoff happens at the
  // 0.85V crossing and at no other instant, so the name is never absent and
  // never drawn twice. This is the reference's "+1.8s: the mouth is gone
  // entirely".
  if (band === 'frame') return null

  // The dissolve is over. The world is a place now, drawn by MindWorldRim, and
  // leaving a fully transparent card in the DOM would be a mark at an opacity
  // nobody measured sitting on top of its own children's targets.
  if (dissolving && bandOut >= 1) return null

  // GRAIN and STATE. Not controls, not in the tree, no text — see the header.
  // The <g> still carries `node.colourVars`, because the ONE thing these marks
  // say is which programme this is, and `--track-c-dark`/`--track-c-light` is
  // the only way a hue is allowed to enter the drawing.
  if (band === 'grain' || band === 'state') {
    return (
      <g
        className="mring-mark"
        transform={`translate(${pos.x} ${pos.y}) scale(${cardScale})`}
        style={node.colourVars}
        data-band={band}
        aria-hidden="true"
      >
        {band === 'grain' ? (
          <circle className="mring-grain" cx={worldCX} cy={worldCY} r={(worldD * GRAIN_DISC) / 2} />
        ) : (
          <>
            <circle
              className="mring-state-rim"
              cx={worldCX}
              cy={worldCY}
              r={(worldD * STATE_RIM) / 2}
            />
            <circle
              className="mring-state-disc"
              cx={worldCX}
              cy={worldCY}
              r={(worldD * STATE_DISC) / 2}
            />
            {view.breachHint !== null && (
              // At the block start of the disc, where nothing else is drawn.
              // `cy` needs no mirror: the block axis is the one axis SVG and the
              // reader agree about in both scripts.
              <circle
                className="mring-state-breach"
                cx={worldCX}
                cy={worldCY - (worldD * STATE_RIM) / 2}
                r={(worldD * STATE_BREACH) / 2}
              />
            )}
          </>
        )}
      </g>
    )
  }

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
      // `mring-absent` is `visibility: hidden` and nothing else. The node stays
      // in the `role="tree"` DOM one band deeper than the eye can see it, so the
      // walk is complete and `aria-posinset`/`aria-setsize` — which come from
      // the MODEL — are never renumbered by a cull. (A `visibility: hidden`
      // element cannot take DOM focus, so a keyboard walk that reaches one still
      // needs the page to fly the camera; what this buys is that the element,
      // its name and its place in the set exist before the repaint, rather than
      // the reader arriving at a set that just changed size underneath them.)
      className={band === 'absent' ? 'mtree-node mring-absent' : 'mtree-node'}
      // THE ONE ATTRIBUTE THAT FIXES EIGHT DEFECTS. See the header: every mark
      // below is authored in LEAF units, and this is what puts them at their
      // own world's scale — coordinates, stroke widths and dash arrays alike,
      // which is why it is one change and not fourteen. `scale(1)` on the
      // layouts that have no worlds is the identity, so the tidy tree, the ring
      // and export.ts's serialiser draw exactly what they drew before.
      transform={`translate(${pos.x} ${pos.y}) scale(${cardScale})`}
      // ONE DISSOLVE, NOT TWO FADES. While a world opens, its card crosses out
      // over the identical band its children's grain crosses in — and it is the
      // only opacity this component ever writes, because opacity is never a
      // resting state (see the header). It resolves to 0 within 0.3 octaves and
      // the node then leaves the DOM entirely.
      // THE TWO NUMBERS THE SHEET NEEDS AND CANNOT DERIVE. `--mtree-world`
      // multiplies every font size and letter-spacing in `mindtree.css`;
      // `--mtree-hair` multiplies every stroke width and every dash. Both are
      // functions of this node's own geometry and its band and of NOTHING the
      // camera knows, so they are memo-stable across a zoom — which is the
      // difference between this and the counter-scaling the header rejects.
      // Both default to 1 in the sheet, so a caller that never sets them (the
      // tidy tree, `export.ts`'s serialiser) draws exactly what it drew before.
      style={
        {
          ...node.colourVars,
          '--mtree-world': worldFactor,
          '--mtree-hair': hair,
          ...(dissolving ? { opacity: 1 - bandOut } : null),
        } as CSSProperties
      }
      direction={rtl ? 'rtl' : 'ltr'}
      data-band={band}
      data-kind={node.kind}
      data-depth={pos.depth}
      // DOES THIS CARD HOLD ANYTHING — the axis `mindtree.css` sets the label's
      // weight on, and it is emitted as its own attribute rather than read off
      // one of the four already here because none of them answers the question.
      // `data-kind` answers "what sort of thing is this", and on the vertical
      // tidy tree that is `entity` for an Organization AND for the type block,
      // the book and the directorate above it — so a sheet keying leaf type off
      // the kind set all 120 leaves at a branch's weight. `data-depth` answers
      // "how far down", which is a different fact: the tree is ragged, and a
      // book with no types is a leaf at depth 2.
      //
      // NOT `aria-expanded`, which is present on exactly the same nodes and
      // would have saved an attribute. Styling off an ARIA hook makes the
      // drawing's typography a hostage to the accessibility contract: the day
      // somebody decides a never-collapsing tree should not claim expandability,
      // they would silently reweight every branch card in the picture, and
      // nothing in either file would connect the two.
      data-branch={pos.hasChildren ? '' : undefined}
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
      {/* THE HUB IS A PILL. `depth === 0` is the drawn root — the point the
          rings are struck from — and a fully rounded end reads as the origin
          rather than as the first of a list. It is a corner radius and nothing
          else: the box is the same box, so the hit test, the size encoding
          (useMapGeometry excludes depth 0 from `sizeForCount`) and export.ts's
          serialiser are all untouched.

          BOTH `rx` AND `ry`, which is one attribute more than MAP-REDESIGN
          §U3 asks for — see the run notes. `ry` is stated explicitly on this
          element, so it does NOT default to `rx`, and `rx = h/2` alone would
          draw 22x10 elliptical corners: a lozenge, not a pill. */}
      <rect
        className="mtree-node-box"
        width={width}
        height={height}
        rx={pos.depth === 0 ? height / 2 : 10}
        ry={pos.depth === 0 ? height / 2 : 10}
      />

      {/* THE LABEL, INSIDE OR OUT — never both, and the two are one <text>
          worth of ink either way. See `outsideLabelAt` for the anchor.

          NOT DRAWN AT ALL while the card is dissolving, and that is the
          rendering invariant rather than an optimisation: text never tweens its
          opacity, because a half-faded label is a resting mark at a ratio
          nobody measured. The name hands off INSTANTLY at the band edge — it
          leaves this card at exactly the instant MindWorldRim draws it on the
          world's rim, so it is never absent and never drawn twice. */}
      {!showName ? null : outsideLabel === null ? (
        <text
          className="mtree-node-label"
          x={startX}
          // A terminal card past 380px carries a second line, so its own
          // baseline lifts to make room. It is the only place on the canvas
          // with a third text row, because it is the only place with nothing
          // beneath it competing for the space.
          y={height / 2 + (secondLine === null ? 0 : TWO_LINE_TOP)}
          textAnchor="start"
          dominantBaseline="central"
        >
          {truncate(view.label, budget)}
        </text>
      ) : (
        <text
          className="mtree-node-label"
          x={outsideLabel.x}
          y={outsideLabel.y}
          textAnchor={outsideLabel.anchor}
          dominantBaseline="central"
          // THE ONE THING THAT WOULD OTHERWISE CHANGE HIT-TESTING. This <text>
          // is the only mark this component draws outside its own <rect>, and
          // it sits inside the `role="treeitem"` <g> that takes the click — so
          // without this, a label reaching across a ring would put an
          // invisible piece of ITS node's target on top of a NEIGHBOUR's box,
          // and which one won a tap would be decided by document order. The
          // rect stays the whole target, exactly as it was.
          pointerEvents="none"
        >
          {truncate(view.label, OUTSIDE_LABEL_BUDGET)}
        </text>
      )}

      {/* THE SECOND LINE — an Organization's account manager and its vendor,
          joined and isolated by the page. Drawn only on a terminal card past
          380px; everything else about that Organization is one tap away in the
          info sidebar, which is the gesture that answers "what is the state of
          this one thing". --text-dim on a node fill measures 4.88 / 4.85, the
          text floor mindtree.css already records. */}
      {secondLine !== null && (
        <text
          className="mring-secondary"
          x={startX}
          y={height / 2 + TWO_LINE_BOTTOM}
          textAnchor="start"
          dominantBaseline="central"
          aria-hidden="true"
        >
          {secondLine}
        </text>
      )}

      {showCount && (
        <text
          className="mtree-node-count tabular"
          // With the label outside, the box holds the count ALONE, so it takes
          // the middle rather than sitting against the reading end of an empty
          // chip. `middle` needs no mirror: it is the geometric centre in both
          // scripts.
          x={outsideLabel === null ? endX : width / 2}
          y={height / 2}
          textAnchor={outsideLabel === null ? 'end' : 'middle'}
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
      {view.breachHint !== null && showText && (
        <g className="mtree-breach" aria-hidden="true">
          <title>{view.breachHint}</title>
          {/* AUTHORED IN THE CARD'S OWN UNITS, not the world's, and it is the
              same exemption `lod.ts`'s FLOOR states for grain and state: a
              FILLED disc's size is a fraction of the drawing it sits in, so
              scaling it up on a card inscribed in its children's ring would put
              a 10-unit dot in a 44-unit box — a mark that had eaten its own
              card. It stays the corner mark it is.

              CY 7 AND NOT 9, WHICH IS THE DIFFERENCE BETWEEN CLEAR BY MEASURE
              AND CLEAR BY READING. The dot and the count share the reading-end
              column — `endX`, block-centred — so on a breached card they stack:
              dot, then a numeral directly beneath it. At `cy={9}` the dot's
              lower edge sat at 13 and an 11.5px numeral centred on 22 puts its
              ascender at roughly 18, a joint of about five units. That clears
              on paper and does not read: at 1:1 the pair reads as ONE mark, and
              the reading it invites is "a flagged number" — as if the breach
              qualified the count — rather than "this card has a breach". The
              root card's 260 does it worst because a three-digit numeral is the
              widest thing under the dot. Two units up buys a joint of seven and
              the pair separates, at no cost anywhere: the dot's top edge lands
              at 3 (2.25 with its keyline), the card's corner arc is centred on
              (width−10, 10) with r 10 and the dot's far point is 7.6 from that
              centre, so it stays inside the rounded box, and nothing else is
              authored in the block-start band.

              THE ROOT IS THE ONE CARD WHERE IT TOUCHES THE RIM, and that is
              recorded rather than discovered later. `depth === 0` is a PILL —
              `rx = height / 2` — so its block-start corner is not a corner but
              a shoulder, and its arc is centred on (width−22, 22): the dot's
              far point lands 22.8 from that centre against an outline whose own
              stroke spans 21.5–22.5. The dot's `--bg-elev` keyline crosses the
              rim by about a unit. It is left, for three reasons that are worth
              more than the unit. The keyline exists FOR overlapping ink — the
              same recipe and the same sentence as `.mring-state-breach`, which
              overlaps its own rim by design. The mark reads correctly: a badge
              in front of the rim, with a dark halo that makes the overlap look
              chosen. And the alternative is worse in every direction — `cy = 9`
              had 0.56 units of margin on this same pill, which at 1:1 is half a
              pixel and was already tangent, and pulling the dot inline-inward
              to clear the shoulder would break the one alignment every card is
              built on, `PAD` at the reading end shared with the count.

              THE OPPOSITE CORNER IS NOT AVAILABLE, which is worth writing down
              so the next reader does not re-propose it: `tickX` — the reading
              START of this same band — is the selection tick's, deliberately,
              so that a ticked AND breached item shows both. Moving the breach
              there would trade a soft ambiguity for a hard collision.

              The dot stays clear of the count in the other layout for free: an
              outside-label card's count sits in the middle, not this column. */}
          <circle cx={markX} cy={7} r={4} />
        </g>
      )}

      {/* THE RAIL — the whole the bar is a share of. Drawn first so the bar
          paints over it: they are the same ink, so the overlap is invisible and
          the only thing the reader sees past the bar's end is the rail's
          thinner continuation to the far inset. See `PROGRESS_RAIL_H` for why
          this exists at all, why it is bought in height rather than in colour,
          and why it is bottom-aligned.

          IT HAS NO MIRROR. The rail spans the full budget, so its start in a
          right-to-left drawing is the same `pad` it is in a left-to-right one —
          `width - pad - railW` IS `pad`. Writing the mirror anyway would be an
          expression that computes a constant and invites a reader to look for
          the asymmetry it implies. The BAR below is the mark with a reading
          direction, and it keeps the mirror. */}
      {railW > 0 && (
        <rect
          className="mring-rail"
          x={pad}
          y={height - (PROGRESS_INSET + PROGRESS_RAIL_H) * worldFactor}
          width={railW}
          height={PROGRESS_RAIL_H * worldFactor}
          aria-hidden="true"
        />
      )}

      {/* THE PROGRESS UNDERSCORE — the share of Organizations beneath this node
          that are live.

          LENGTH IS THE ENCODING AND IT IS NOW READ AGAINST A DRAWN WHOLE. What
          the old rule here refused was a track in "the card's own outline ink at
          20%" — a DILUTED mark, in no matrix this repo keeps, composited toward
          the surface underneath and handing its measured ratio back (edge ink at
          opacity .55 falls 6.06/5.53 to 3.76/3.20, the whole light-theme
          headroom). That refusal stands and the rail above spends none of it:
          both marks are the branch ink AT FULL STRENGTH — 6.35 / 5.53 against a
          node fill, already measured, no new recipe — and they are told apart by
          height, three units against one. The reasoning that changed is written
          out at `PROGRESS_RAIL_H`, and why the step is 3:1 rather than the 2:1
          it shipped as — a 99%-full bar and a bare rail are both a line across
          the whole budget, so height is the ONLY thing separating "all live"
          from "none live" — is written out at `PROGRESS_H`.

          BECAUSE THE ENCODING IS LENGTH AND COLOUR ALONE, the same fact is
          stated in the node's accessible name (`mindtree.nodeName`'s
          `{done} of {total} live` clause), which is what keeps WCAG 1.4.1
          honest. Nothing here announces anything: the <g> above already carries
          the sentence, and the rail is `aria-hidden` for the same reason the bar
          is — a second mark saying the same thing twice to a screen reader.

          RTL is the one mirror: the fill grows from the READING start. */}
      {fillW > 0 && (
        <rect
          className="mring-progress"
          x={rtl ? width - pad - fillW : pad}
          // IN THE TYPE'S UNITS, like the inset it sits in. A 3-unit bar on a
          // card inscribed in its children's ring is 0.92 px at that band's own
          // floor — a sliver nobody sees — and 2.36 px in world units, which is
          // the same share of the drawing the leaf's bar is of its own.
          y={height - (PROGRESS_INSET + PROGRESS_H) * worldFactor}
          width={fillW}
          height={PROGRESS_H * worldFactor}
          aria-hidden="true"
        />
      )}

      {/* The disclosure affordance. Drawn in the gap toward the next ring, so
          it reads as "the branch continues this way" rather than as a second
          control competing with the card. Not clickable on its own: the card is
          the target, and see the header for why.

          NOT WHERE THE NAME IS. The chevron is drawn at `pos.outward` — a point
          on the ray — and that is exactly where an OUTSIDE label sits,
          `OUTSIDE_LABEL_GAP` further along the same ray. Two marks in one place
          is not a band, so a node that spends its ray on its word says "there is
          more this way" with the ring of children the reader can already see out
          there. The test was `band !== 'chip'` while the chip was the only
          drawing that put its name outside; it is now the outside label itself,
          which is the same rule stated about the mark it is actually about, and
          which also covers a card inscribed in its children's ring.

          AND IT IS THE CIRCLE THE OWNER ASKED TO BE RID OF. On the vertical
          tidy tree this is a filled disc at `{ x: width + 9, y: height / 2 }` —
          the linear fallback, because that layout emits no `outward` — so it
          hangs off the inline-end edge of every parent card, OUTSIDE the box,
          touching nothing and pointing at nothing: the children are BELOW, not
          beside. The picture harness found one on the root, on both
          directorates, on all six books and on all twenty-four types, and they
          are exactly what "remove the circles when i zoom in" is about.

          Nothing is lost by dropping it there, which is why this is a gate and
          not a relocation. The chevron's whole sentence is "the branch continues
          this way", and on the flat tree the branch's continuation is drawn as a
          CONTAINER — a rounded rectangle enclosing the entire subtree, joined to
          this card by its own stub (components/mindtree/MindBlock.tsx). A disc
          that says "there is more" beside a boundary that shows exactly how much
          more is the second mark in one place this comment already refuses. The
          `hiddenChildCount` badge goes with it: the flat tree never collapses
          anything, so there is no hidden count to badge. */}
      {!flat && pos.hasChildren && outsideLabel === null && showText && (
        <g className="mtree-chevron" aria-hidden="true" data-open={expanded ? '' : undefined}>
          {view.toggleHint !== null && <title>{view.toggleHint}</title>}
          <circle cx={chevron.x} cy={chevron.y} r={7} />
          {!expanded && pos.hiddenChildCount > 0 && pays(CHEVRON_COUNT_PX) && (
            <text
              className="mtree-chevron-count tabular"
              x={chevron.x}
              y={chevron.y}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {pos.hiddenChildCount > 9 ? '+' : pos.hiddenChildCount}
            </text>
          )}
          {expanded && (
            <path
              className="mtree-chevron-glyph"
              d={`M ${chevron.x - 3} ${chevron.y} h 6`}
            />
          )}
        </g>
      )}

      {/* A leaf gets a quiet dot at the reading start so a row of entries reads
          as a list rather than as four unrelated cards. Purely decorative. */}
      {isLeaf && showText && <circle className="mtree-leaf-dot" cx={rtl ? width - 4 : 4} cy={height / 2} r={2} aria-hidden="true" />}

      {/* The selection tick, at the block-start reading-START corner — the one
          corner nothing else uses (the breach mark owns the reading END, and the
          label and count own the middle band), so a ticked, breached item shows
          both marks rather than one covering the other.

          aria-hidden because `aria-selected` on the group above already carries
          it: a screen reader announcing "selected" and then a tick glyph would
          say the same fact twice. It is drawn at all because a SIGHTED reader
          ticking six items across three branches has no other way to see which
          six are travelling when the drag starts. */}
      {isLeaf && selected && showText && (
        <g className="mtree-node-tick" aria-hidden="true">
          <circle cx={tickX} cy={11} r={7} />
          <path className="mtree-node-tick-glyph" d={`M ${tickX - 3} ${11} l 2 2.4 l 4 -4.8`} />
        </g>
      )}
    </g>
  )
})

export default MindNode
