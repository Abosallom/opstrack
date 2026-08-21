// Proof for the map's OPENING focus — the precedence, and the way back out.
//
// WHY THERE IS NO RENDER HERE. `vitest.config.ts` is `environment: 'node'`,
// jsdom is not in the dependency budget, and effects do not run in a server
// render — `useMapUrl.test.ts`'s header argues the whole of it and answers it
// the same way this file does: the decision a hook takes is EXPORTED as a pure
// function and asserted directly. `requestedFocusId` is the only line of
// `useMapFocus` that chooses a place; everything else in that hook is a store
// read, a memo over it, or the reconciler `useMapUrl.test.ts` already models.
//
// ── WHAT THIS FILE EXISTS FOR ──────────────────────────────────────────────
//
// Wave 5 gave `focusPref === null` a resolver (`defaultFocusFor`), and
// `focusPref === null` was already the value the app's one "show me the whole
// workspace" gesture writes. Two meanings, one value. The consequences are not
// theoretical and are measured in the second describe below: `defaultFocusFor`
// answers a DRILL-IN, `Mindtree.tsx` lays out THAT node, and every ring above it
// leaves the drawing — so with the two meanings conflated, `mindtree.clearFocus`
// is a button that redraws exactly what was on screen and the workspace is
// unreachable from inside the app.

import { describe, expect, it, vi } from 'vitest'

// `useMapFocus` imports `store/config`, which adds a window listener at IMPORT
// time, and `lib/i18n` reads localStorage the same way — so the shims cannot
// wait for a beforeAll(). Lifted from mapRender.test.tsx unchanged, and for the
// reason stated there: two copies of one shim beat a shared helper that makes
// import ORDER load-bearing across files.
vi.hoisted(() => {
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

// Types are erased, so they come through static `import type` while the VALUES
// come through the dynamic imports that run after the shims above.
import type { MindNode } from '../../lib/mindtree/model'

const { defaultFocusFor, resolveFocus } = await import('../../lib/mindtree/focus')
const { layoutWorlds } = await import('../../lib/mindtree/worlds')
const { fixtures, MAP_READER } = await import('./mapRenderFixtures')
const { requestedFocusId } = await import('./useMapFocus')

/** The 400-organization fixture — the one with account managers in it. */
function large(): MindNode {
  const found = fixtures().find((f) => f.id === 'large')
  if (found === undefined) throw new Error('fixture `large` is gone')
  return found.tree
}

describe('the opening focus, in precedence order', () => {
  it('lets a persisted focus beat the reader’s own world', () => {
    // "I was here yesterday" outranks "you belong here", and it outranks it even
    // when the reader HAS a book — which is the case that matters, because the
    // one without a book has nothing to be beaten by.
    const tree = large()
    const mine = defaultFocusFor(MAP_READER.meId, MAP_READER.role, tree)
    expect(mine).toBe('am:1')
    expect(requestedFocusId('ad:0', false, mine)).toBe('ad:0')
    // …and `?focus=` arrives through this same rung: `useMapUrl.ts:582` writes a
    // pasted id through `focusBranch`, so by the time this function sees it, it
    // IS the persisted focus.
  })

  it('lets the reader’s own world beat the drawn root', () => {
    expect(requestedFocusId(null, false, 'am:1')).toBe('am:1')
  })

  it('treats an empty persisted string as no focus, never as a focus', () => {
    // An empty string is "no focus" to `resolveFocus`; if it were allowed to
    // out-rank the default here the two would disagree about what is drawn.
    expect(requestedFocusId('', false, 'am:1')).toBe('am:1')
  })

  it('lets an explicit “show me the whole workspace” beat the default', () => {
    // THE RUNG WAVE 5's INTEGRATION ADDED. Without it this returns 'am:1' and
    // `MapList.tsx:952`'s Clear-focus button is a control that changes nothing.
    expect(requestedFocusId(null, true, 'am:1')).toBeNull()
    expect(requestedFocusId('', true, 'am:1')).toBeNull()
  })

  it('does not let it outlive a deliberate drill-in', () => {
    // Asking for the workspace and then diving into a branch is not a
    // contradiction, and the dive wins: `wantsWorkspace` only ever decides what
    // `focusPref === null` MEANS.
    expect(requestedFocusId('ad:0', true, null)).toBe('ad:0')
  })
})

describe('why that rung is not cosmetic', () => {
  /**
   * THE MEASUREMENT THAT FORCED IT, run against the real modules rather than
   * described. `defaultFocusFor` is a drill-in and not a camera aim, so the
   * workspace is not merely off-screen — it is not in the drawing at all.
   */
  it('draws none of the workspace above the reader’s own world', () => {
    const tree = large()
    const mine = defaultFocusFor(MAP_READER.meId, MAP_READER.role, tree)
    const view = resolveFocus(tree, mine)
    const layout = layoutWorlds<MindNode>(view.node, { direction: 'ltr' })

    expect(view.node.id).toBe('am:1')
    // The four rings the reader's own trail names…
    expect(view.trail.map((n) => n.id)).toEqual(['root', 'track:ob', 'ad:0', 'am:1'])
    // …and only the last of them is drawable. `Mindtree.tsx`'s breadcrumb walks
    // `ancestorWorlds(layout, framedId)`, its rail's Home is `flyToId(null)` and
    // its zoom-out is clamped by `layout.rootD` — all three live inside this
    // layout, so none of them can reach `root`, `track:ob` or `ad:0`.
    expect(layout.byId.has('root')).toBe(false)
    expect(layout.byId.has('track:ob')).toBe(false)
    expect(layout.byId.has('ad:0')).toBe(false)
    expect(layout.byId.has('am:1')).toBe(true)
  })

  it('draws the whole workspace once the reader asks for it', () => {
    // The same tree, the same default, one gesture later. This is the assertion
    // that goes RED if `wantsWorkspace` stops out-ranking `defaultFocusFor`:
    // `requested` becomes 'am:1' again and `root` is absent from the layout.
    const tree = large()
    const mine = defaultFocusFor(MAP_READER.meId, MAP_READER.role, tree)
    const requested = requestedFocusId(null, true, mine)
    const view = resolveFocus(tree, requested)
    const layout = layoutWorlds<MindNode>(view.node, { direction: 'ltr' })

    expect(view.node.id).toBe(tree.id)
    expect(layout.byId.has('root')).toBe(true)
    expect(layout.byId.has('am:1')).toBe(true)
  })
})
