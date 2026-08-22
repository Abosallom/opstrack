// A BRIDGE, AND DELIBERATELY A TEMPORARY ONE.
//
// The vertical wrapped tidy tree (`layoutMindtree` with `orientation: 'vertical'`
// and `wrap: true`) is finished and tested, but the app's camera is not: it was
// built for the containment drawing and reads `worldX`/`worldY`/`worldD` off
// every node — a node's own disc — to frame, to cull and to pick a level of
// detail. A tidy tree emits rectangles and no discs at all, so handing one
// straight to `useMapGeometry` produces a NaN viewBox and a blank screen.
//
// Rewriting the camera onto rectangles is the real work and it is its own unit.
// This file exists so the drawing can be LOOKED AT before that lands, because a
// layout nobody has seen in a browser is a layout nobody has checked.
//
// WHAT IT DOES. Wraps each rectangle in the smallest disc that could stand in
// for it, and reports the tree's own extent as the root's diameter. That is
// enough for `frameCamera`, `reachesCamera` and the band ladder to behave, and
// it is honest about being an approximation: the discs it invents overlap, which
// a containment layout would never do, so the dive will feel wrong at the edges.
// It is a preview, not a shim to build on.
//
// DELETE THIS FILE when the camera takes rectangles. Nothing should grow to
// depend on it, and nothing outside the preview flag may import it.

import type { DrawnLayout, LayoutInputNode } from '../../lib/mindtree/layout'
import type { WorldLayout, WorldNode } from '../../lib/mindtree/worlds'

/**
 * Why 1.6 and not 1. The band ladder picks a rendering from a node's apparent
 * DIAMETER, and the edge above which a node draws its name inside itself sits at
 * 140 css px. A 132-unit-wide card viewed at 1:1 measures 132, which lands one
 * band low — so the preview would draw every organization as a chip with its
 * name outside, and the first thing anyone said about it would be a fact about
 * this constant rather than about the layout.
 *
 * 1.6 puts a card at 1:1 comfortably inside the card band while keeping the
 * ordering between depths intact.
 */
const DISC_FACTOR = 1.6

/*
 * The bridge returns the camera's OWN type rather than a parallel one. Declaring
 * a `PreviewLayout` that merely resembled `WorldLayout` meant every call site
 * that already takes a world — `worldAt`, `ancestorWorlds`, the dive — had to be
 * widened to accept both, which is a lot of blast radius for a preview and would
 * leave the union behind after the preview is deleted. Satisfying the existing
 * type means the conditional at the call site is the ONLY trace of this file.
 *
 * The three polar fields are zero. They drive the match rim's wedge arcs, which
 * a tidy tree has no equivalent of; the rim simply draws nothing.
 */

/**
 * Bolt disc geometry onto a rectangle layout so the containment camera can drive
 * it. Pure, and it copies rather than mutates — the layout is a value that tests
 * deep-compare, and a preview must not be able to change what the real drawing
 * would have been.
 */
export function asPreviewLayout<N extends LayoutInputNode>(
  layout: DrawnLayout<N>,
): WorldLayout<N> {
  const nodes: WorldNode<N>[] = layout.nodes.map((pos) => ({
    ...pos,
    worldX: pos.x + pos.width / 2,
    worldY: pos.y + pos.height / 2,
    worldD: Math.max(pos.width, pos.height) * DISC_FACTOR,
    // Every node is framable in the preview. The containment drawing reserved
    // this for the four kinds that owned a world; a tidy tree has no such
    // distinction, and refusing to frame a leaf would make half the tree
    // unreachable by keyboard for no reason a reader could see.
    structural: true,
    // The card draws at its authored size. There is no world to scale it into.
    cardScale: 1,
    bearing: 0,
    wedgeStart: 0,
    wedgeEnd: 0,
  }))
  const { width, height } = layout.bounds
  return {
    ...layout,
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    rootD: Math.max(width, height),
    maxDepth: layout.nodes.reduce((d, n) => Math.max(d, n.depth), 0),
    revision: `tree:${nodes.length}:${Math.round(width)}x${Math.round(height)}`,
  }
}

/**
 * Is the preview asked for? `?tree=1` on the map.
 *
 * A URL flag rather than a setting, because it is temporary and because a link
 * is the whole point: the owner is being asked to look at something and say
 * whether it is better, and a link is what you send someone for that.
 */
export function wantsTreePreview(search: string, hash = ''): boolean {
  if (new URLSearchParams(search).get('tree') === '1') return true
  // The app is on a HashRouter, so `/#/mindtree?tree=1` puts the parameter in
  // the HASH and leaves `location.search` empty. Both spellings are things a
  // person will reasonably type, and a preview nobody can open is not a preview.
  const q = hash.indexOf('?')
  return q === -1 ? false : new URLSearchParams(hash.slice(q + 1)).get('tree') === '1'
}
