// THE CAMERA, HANDED TO THE ONE COMPONENT THAT DRAWS THROUGH IT.
//
// `MapCanvas.tsx`'s header has carried this sentence since the render cut:
// "Moving `pan` and `zoom` down here — so that a pointermove stops re-rendering
// the filter bar, the toolbar and the summary — is the change this boundary
// EXISTS to make possible, and it is a behavioural change, so it is not made
// here." This file is that change, and it is worth being precise about what it
// does and does not buy, because the naive reading of "put the camera in a
// context" buys nothing at all.
//
// ── WHAT ACTUALLY RE-RENDERS, AND WHY ──────────────────────────────────────
//
// `useMapGeometry` calls `setState` once per wheel notch, per pan frame and per
// tween end (`useMapGeometry.ts`'s `writeCamera`). That state lives in the page,
// so the PAGE FUNCTION re-runs on every notch — and nothing in this file changes
// that, because the crumb bar and the dive rail are honest camera readers (they
// answer "where am I", which IS the camera) and they live in the page.
//
// What re-runs the page function is cheap. What was expensive is that every
// child element was re-created by that run, so `FilterBar`, `MapToolbar` and
// `MapSummary` re-rendered on every notch even though not one of them can see
// the camera. React skips a subtree whose element is REFERENTIALLY IDENTICAL to
// the last render's, so the fix is two halves and this file is the first:
//
//   1. the camera stops being a PROP, so a subtree that does not read it can be
//      held in a `useMemo` whose dependency list provably excludes it — and
//      `react-hooks/exhaustive-deps` is what makes "provably" a machine check
//      rather than a promise;
//   2. `pages/Mindtree.tsx` holds those three subtrees in exactly such memos.
//
// The consumer set is then the whole claim: `MapCanvas` reads this context, the
// crumb and the rail read the page's own `camera`, and nothing else may. A
// component that starts reading it starts re-rendering on every frame of every
// pan, which is the cost this boundary exists to price.
//
// ── WHY A CONTEXT AND NOT FOUR MORE PROPS ──────────────────────────────────
//
// Because props are what the memo above has to list. `<MapCanvas scale={…}
// viewBox={…}>` inside a `useMemo` needs `scale` and `viewBox` in its dependency
// array, which is the same as not memoising it — and a reviewer cannot tell the
// difference by looking. Through the context the dependency list is empty of
// camera values and the lint rule agrees, so the diff itself is the evidence.
//
// ── WHY IT THROWS RATHER THAN DEFAULTING ───────────────────────────────────
//
// A default camera would render the map at a viewBox nobody chose — the exact
// silent-wrong-picture failure `mapRender.test.tsx` exists to prevent. There is
// no sensible camera for a canvas nobody framed, so `useMapCamera` refuses to
// invent one.

import { createContext, useContext } from 'react'
import type { MindNodePos } from '../../components/mindtree/MindNode'
import type { Camera } from './mapMotion'

/**
 * THE CAMERA AND THE STAGE IT IS AIMED AT — the four numbers every mark on the
 * canvas is resolved against, and nothing else.
 *
 * `viewportMinPx` is in here with the camera rather than beside it because the
 * two are one question: `apparent = worldD × scale` says how big a world is, and
 * `viewportMinPx` says how big the window is, and the level-of-detail band is
 * cut on both. A caller that had one without the other could not read a band.
 */
export interface MapCameraValue {
  /**
   * THE FRUSTUM, in drawing units — `{cx, cy, width, height}`. The rectangle a
   * world's disc has to reach to be worth an SVG element at all.
   */
  readonly camera: Camera
  /**
   * CAMERA SCALE — `stageWidthPx / camera.width`, CSS px per drawing unit. The
   * ONLY thing that turns a world's authored diameter into an apparent size, and
   * therefore the only input to which of the five drawings each node renders.
   */
  readonly scale: number
  /** V — the smaller side of the UNOCCLUDED stage, CSS px. `frame`'s only input. */
  readonly viewportMinPx: number
  /**
   * The `viewBox` attribute, already formatted.
   *
   * FORMATTED BY THE CALLER AND NOT HERE, and it is the frame loop that forces
   * it: `useMapGeometry`'s tween writes `viewBox` straight onto the element
   * through `viewBoxOf`, so the string React renders has to come from the same
   * formatter or the map sticks where the loop left it (React only writes an
   * attribute whose prop CHANGED). One formatter, two writers.
   */
  readonly viewBox: string
}

/**
 * PUBLISH THE CAMERA. One provider, wrapped around the drawing surface.
 *
 * EXPORTED AS THE CONTEXT AND NOT AS A `<MapCameraProvider>` WRAPPER, so that
 * this module exports no component at all and stays a plain `.ts` file. The
 * wrapper would be four lines of indirection whose only effect is to make the
 * module ineligible for fast refresh (`react/only-export-components`), and the
 * one thing a caller must get right is not hidden by it either: the `value` has
 * to be a memo, because the provider hands it to consumers BY IDENTITY and an
 * object literal built inline would re-render the canvas on every render of the
 * page — a keystroke in the filter box being the standing case.
 */
export const MapCameraContext = createContext<MapCameraValue | null>(null)

/**
 * DOES THIS WORLD REACH THE CAMERA — the frustum test, wave 9's 5a, and the
 * predicate `MapCanvas` culls on.
 *
 * True when the world's disc reaches the camera rectangle: the centre lies
 * inside the rect inflated by one world radius, which is the disc's bounding box
 * against the rect and is therefore conservative in the only direction that is
 * safe — it keeps a world whose corner-most sliver might be on screen.
 *
 * ── WHY THIS ALSO KEEPS EVERY ANCESTOR OF THE FRAMED WORLD ─────────────────
 *
 * Worlds NEST: a parent's disc contains its children's ring. So a world that is
 * an ancestor of whatever the camera is looking at contains the camera outright,
 * its centre is within its own radius of the camera rect by definition, and this
 * test keeps it without a second clause and without knowing what "framed" means.
 * The crumb's spine is safe by geometry rather than by special case — which
 * matters, because a special case is a thing a later edit can drop.
 *
 * A NODE WITH NO WORLD IS ALWAYS KEPT. The tidy tree and the linear ring emit
 * `PositionedNode`s with no `worldD`; there is no disc to test, and culling them
 * to nothing on a missing field is how a layout nobody was thinking about goes
 * blank.
 *
 * IT LIVES HERE, BESIDE THE FRUSTUM IT TESTS, rather than in the component that
 * calls it: the render gate imports it to assert the cull is exact, and a test
 * that had to import the canvas component to reach a pure predicate would be
 * importing React to do arithmetic.
 */
export function reachesCamera(pos: MindNodePos, camera: Camera): boolean {
  if (pos.worldX === undefined || pos.worldY === undefined || pos.worldD === undefined) return true
  const r = pos.worldD / 2
  return (
    Math.abs(pos.worldX - camera.cx) <= camera.width / 2 + r &&
    Math.abs(pos.worldY - camera.cy) <= camera.height / 2 + r
  )
}

/**
 * READ THE CAMERA. Throws outside a provider, on purpose — see the header.
 *
 * Every caller of this is a component that re-renders on every frame of every
 * pan. There is exactly one today (`MapCanvas`), and adding a second is a
 * performance decision, not a plumbing one.
 */
export function useMapCamera(): MapCameraValue {
  const value = useContext(MapCameraContext)
  if (value === null) {
    throw new Error('useMapCamera: no MapCameraProvider above this component')
  }
  return value
}
