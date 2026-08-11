// Proof for the watch layer.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — MindtreeTable.test.tsx,
// pages/Board.test.tsx and pages/Dashboard.test.tsx all open with that
// paragraph. react-dom/server exercises the real component against the real
// layout module and hands back markup to assert on.
//
// WHAT THAT LEAVES OUT, STATED PLAINLY. Effects do not run in a server render,
// so `useMindPulses` and the exit-ghost timer are NOT exercised here; nor is the
// reduced-motion SUBSCRIPTION, because useSyncExternalStore takes its server
// snapshot on this path. That is why the three decisions those hooks make are
// each extracted into a pure exported function — `prefersReducedMotion`,
// `isViewChange`, `ghostsFor` — and asserted directly below. The remaining seam
// (does the browser's own media feature actually reach `prefersReducedMotion`,
// and does the CSS honour it) cannot be proven in node at all and was proven in
// a real browser under `--force-prefers-reduced-motion`; the handoff records
// what was run and what it printed.
//
// THE ASSERTIONS ARE ABOUT THE TWO WAYS THIS FEATURE FAILS BADLY:
//  · it announces things that did not happen (a regroup read as forty breaches),
//    which `isViewChange` and `ghostsFor` exist to prevent; and
//  · it will not shut up, which the caps enforce.
// Neither is visible by looking at a screen and hoping an event arrives while
// you are watching.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MindNode } from '../../lib/mindtree/model'
import type { MindtreeLayout } from '../../lib/mindtree/layout'
import type { Pulse, PulseMap } from '../../lib/mindtree/pulse'

vi.hoisted(() => {
  // lib/i18n and store/entries both read localStorage at module scope, and
  // store/config registers a `focus` listener there too, so `window` has to
  // exist before the dynamic imports below run — a beforeAll() would be too
  // late. Deliberately the SMALLEST surface that lets the real modules load: no
  // matchMedia, so `prefersReducedMotion()` starts from "cannot be asked", which
  // is the state its own tests then vary.
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const mem = new Map<string, string>()
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
})

const { layoutMindtree } = await import('../../lib/mindtree/layout')
const PulseLayerModule = await import('./PulseLayer')
const {
  PulseLayer,
  MIND_EXIT_MAX,
  MIND_EXIT_MS,
  ghostsFor,
  isViewChange,
  leftTheMap,
  prefersReducedMotion,
} = PulseLayerModule

/* ─────────────────────────────── fixtures ────────────────────────────────── */

const VARS = { '--track-c-dark': '#22d3ee', '--track-c-light': '#0e7490' } as MindNode['colourVars']

function node(id: string, over: Partial<MindNode> = {}): MindNode {
  return {
    id,
    kind: 'group',
    label: { kind: 'text', text: id },
    count: 1,
    colourVars: VARS,
    health: { slaBreached: false, levels: { ok: 1, stale: 0, overdue: 0, critical: 0 } },
    children: [],
    collapsed: false,
    depth: 1,
    entryId: null,
    bucketKey: null,
    entityType: null,
    retired: false,
    ...over,
  }
}

/** `root/track:t/group:g` holding the named entries, laid out for real. */
function treeOf(entryIds: readonly string[], groupKey = 'g'): MindNode {
  const entries = entryIds.map((id) =>
    node(`root/track:t/group:${groupKey}/entry:${id}`, {
      kind: 'entry',
      entryId: id,
      depth: 3,
    }),
  )
  const group = node(`root/track:t/group:${groupKey}`, { children: entries, depth: 2 })
  const track = node('root/track:t', { kind: 'track', children: [group], depth: 1 })
  return node('root', { kind: 'root', children: [track], depth: 0, colourVars: {} })
}

function layoutOf(root: MindNode): MindtreeLayout<MindNode> {
  return layoutMindtree(root)
}

function pulseMap(entries: readonly [string, Pulse][]): PulseMap {
  return new Map<string, Pulse>(entries)
}

/* ──────────────────────────── reduced motion ─────────────────────────────── */

describe('prefersReducedMotion', () => {
  const g = globalThis as unknown as Record<string, unknown>

  function withMedia(matches: boolean | null, run: () => void): void {
    const held = g.window
    g.window =
      matches === null
        ? {}
        : {
            matchMedia: (query: string) => ({
              matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
              addEventListener: () => {},
              removeEventListener: () => {},
            }),
          }
    try {
      run()
    } finally {
      if (held === undefined) delete g.window
      else g.window = held
    }
  }

  it('reports the media feature when the browser has one', () => {
    withMedia(true, () => {
      expect(prefersReducedMotion()).toBe(true)
    })
    withMedia(false, () => {
      expect(prefersReducedMotion()).toBe(false)
    })
  })

  it('answers false where the question cannot be asked', () => {
    // No window at all (this test run), and a window with no matchMedia (an
    // ancient webview). Neither may throw: the map has to draw.
    expect(prefersReducedMotion()).toBe(false)
    withMedia(null, () => {
      expect(prefersReducedMotion()).toBe(false)
    })
  })

  it('asks for the exact query the stylesheet uses', () => {
    // A typo here is a layer that animates for a reader who asked it not to,
    // and it is invisible in every other assertion in this file.
    let asked: string | null = null
    const held = g.window
    g.window = {
      matchMedia: (query: string) => {
        asked = query
        return { matches: false, addEventListener: () => {}, removeEventListener: () => {} }
      },
    }
    try {
      prefersReducedMotion()
    } finally {
      if (held === undefined) delete g.window
      else g.window = held
    }
    expect(asked).toBe('(prefers-reduced-motion: reduce)')
  })
})

/* ───────────────────────────── the view guard ────────────────────────────── */

describe('isViewChange', () => {
  const set = (...ids: string[]): ReadonlySet<string> => new Set(ids)

  it('an unchanged drawing is not a view change', () => {
    expect(isViewChange(set('a', 'b', 'c'), set('a', 'b', 'c'))).toBe(false)
    expect(isViewChange(set(), set())).toBe(false)
  })

  it('one card arriving or leaving is an EVENT, not a redraw', () => {
    expect(isViewChange(set('a', 'b'), set('a', 'b', 'c'))).toBe(false)
    expect(isViewChange(set('a', 'b', 'c'), set('a', 'b'))).toBe(false)
  })

  it('holds at the boundary and trips one past it', () => {
    const before = set('a')
    // Six new nodes is the most that can plausibly be one event — six items
    // committed at the end of a meeting, say. Seven is a redraw.
    expect(isViewChange(before, set('a', '1', '2', '3', '4', '5', '6'))).toBe(false)
    expect(isViewChange(before, set('a', '1', '2', '3', '4', '5', '6', '7'))).toBe(true)
  })

  it('counts arrivals and departures TOGETHER', () => {
    // The case that matters: switching dimension replaces every `group:` id, so
    // the same rebuild both removes and adds. Counting either half alone would
    // let a regroup through at half the size — and a regroup is precisely what
    // would otherwise light up every breached branch at once.
    const before = set('root/track:t/group:blocked', 'root/track:t/group:new', 'x', 'y')
    const after = set('root/track:t/group:owner-a', 'root/track:t/group:owner-b', 'x', 'y')
    expect(isViewChange(before, after)).toBe(false) // 2 gone + 2 new = 4
    const wider = set('g1', 'g2', 'g3', 'g4', 'g5', 'x', 'y')
    expect(isViewChange(before, wider)).toBe(true) // 2 gone + 5 new = 7
  })

  it('a first drawing over an empty one is a view change, not six hundred events', () => {
    const many = new Set(Array.from({ length: 40 }, (_, i) => `n${i}`))
    expect(isViewChange(new Set<string>(), many)).toBe(true)
  })
})

/* ──────────────────────────── the close guard ────────────────────────────── */

describe('leftTheMap', () => {
  const set = (...ids: string[]): ReadonlySet<string> => new Set(ids)

  it('a re-bucketed item did NOT leave — the map must not narrate my own drop', () => {
    // The drag this whole screen exists for: one item moves from one branch to
    // another. Its NODE id changes (the bucket is in the path) and the tree diff
    // cannot tell that from a close; its ENTRY id does not.
    expect(leftTheMap(set('e1', 'e2', 'e3'), set('e1', 'e2', 'e3'))).toBe(false)
  })

  it('an item that closed did leave', () => {
    expect(leftTheMap(set('e1', 'e2'), set('e1'))).toBe(true)
  })

  it('arrivals alone are not departures', () => {
    expect(leftTheMap(set('e1'), set('e1', 'e2', 'e3'))).toBe(false)
  })

  it('is total over the empty cases', () => {
    expect(leftTheMap(new Set<string>(), set('e1'))).toBe(false)
    expect(leftTheMap(set('e1'), new Set<string>())).toBe(true)
    expect(leftTheMap(new Set<string>(), new Set<string>())).toBe(false)
  })
})

/* ─────────────────────────────── the ghosts ──────────────────────────────── */

describe('ghostsFor', () => {
  it('draws the card that left, where it was', () => {
    const before = layoutOf(treeOf(['e1', 'e2']))
    const after = layoutOf(treeOf(['e1']))
    const ghosts = ghostsFor(before, after)

    expect(ghosts.map((g) => g.id)).toEqual(['root/track:t/group:g/entry:e2'])
    const was = before.byId.get('root/track:t/group:g/entry:e2')
    expect(was).toBeDefined()
    // The geometry is the layout's own — a ghost that recomputed a position
    // would draw the card somewhere it never was.
    expect(ghosts[0]).toMatchObject({
      x: was?.x,
      y: was?.y,
      width: was?.width,
      height: was?.height,
      vars: VARS,
    })
  })

  it('says nothing when nothing left', () => {
    const before = layoutOf(treeOf(['e1', 'e2']))
    const after = layoutOf(treeOf(['e1', 'e2']))
    expect(ghostsFor(before, after)).toEqual([])
    // And when the tree GREW: an arrival is the pulse layer's business.
    expect(ghostsFor(before, layoutOf(treeOf(['e1', 'e2', 'e3'])))).toEqual([])
  })

  it('refuses a bulk exodus — that is a filter, not forty closes', () => {
    const ids = Array.from({ length: MIND_EXIT_MAX + 2 }, (_, i) => `e${i}`)
    const before = layoutOf(treeOf(ids))
    const after = layoutOf(treeOf(ids.slice(0, 1)))
    expect(ghostsFor(before, after)).toEqual([])
  })

  it('draws exactly the cap, and not one more', () => {
    const ids = Array.from({ length: MIND_EXIT_MAX + 1 }, (_, i) => `e${i}`)
    const kept = ids.slice(0, 1)
    // Exactly MIND_EXIT_MAX leave.
    expect(ghostsFor(layoutOf(treeOf(ids)), layoutOf(treeOf(kept)))).toHaveLength(MIND_EXIT_MAX)
  })

  it('refuses when the drawn root changed — that is a drill-in', () => {
    const before = layoutOf(treeOf(['e1', 'e2']))
    // Focusing draws the TRACK as the root; every entry under the old root that
    // is not in this subtree "vanished", and none of them closed.
    const focused = treeOf(['e1']).children[0]
    expect(focused).toBeDefined()
    expect(ghostsFor(before, layoutOf(focused as MindNode))).toEqual([])
  })

  it('refuses when the branch went with the card', () => {
    // The whole group is gone — a regroup, or a filter that took the bucket.
    // The card did not leave its branch; the branch left.
    const before = layoutOf(treeOf(['e1']))
    const after = layoutOf(treeOf(['e1'], 'other'))
    expect(ghostsFor(before, after)).toEqual([])
  })

  it('never ghosts a branch, only a card', () => {
    // A group emptying is a structural change; dissolving it would imply the
    // work under it dissolved too.
    const before = layoutOf(treeOf(['e1']))
    const bare = node('root', {
      kind: 'root',
      children: [node('root/track:t', { kind: 'track', children: [], depth: 1 })],
      depth: 0,
      colourVars: {},
    })
    const ghosts = ghostsFor(before, layoutOf(bare))
    // `root/track:t/group:g` vanished too, so the entry's parent is gone and the
    // gate above already refuses — but assert the shape of the answer, not the
    // reason: no ghost may ever be a non-entry node.
    expect(ghosts.every((g) => g.id.includes('/entry:'))).toBe(true)
  })
})

/* ───────────────────────────── the rendering ─────────────────────────────── */

describe('PulseLayer', () => {
  const at = Date.now() + 1000
  const layout = layoutOf(treeOf(['e1', 'e2']))
  const GROUP = 'root/track:t/group:g'
  const TRACK = 'root/track:t'

  it('draws one ring per pulse, named by kind', () => {
    const html = renderToStaticMarkup(
      <PulseLayer
        layout={layout}
        pulses={pulseMap([
          [GROUP, { kind: 'updated', until: at }],
          [TRACK, { kind: 'breached', until: at }],
        ])}
      />,
    )
    expect(html).toContain('class="mtree-pulses"')
    expect(html).toContain('aria-hidden="true"')
    expect((html.match(/class="mtree-pulse"/g) ?? []).length).toBe(2)
    expect(html).toContain('data-kind="updated"')
    expect(html).toContain('data-kind="breached"')
  })

  it('carries the kind\'s own duration, so the CSS holds no magic numbers', () => {
    const html = renderToStaticMarkup(
      <PulseLayer layout={layout} pulses={pulseMap([[GROUP, { kind: 'breached', until: at }]])} />,
    )
    // pulse.ts's PULSE_MS.breached — the long one, because a breach is the kind
    // nobody was expecting and the only one that needs acting on.
    expect(html).toContain('--mtree-pulse-ms:2400ms')
  })

  it('inherits the branch colour and never picks one', () => {
    const html = renderToStaticMarkup(
      <PulseLayer layout={layout} pulses={pulseMap([[GROUP, { kind: 'updated', until: at }]])} />,
    )
    expect(html).toContain('--track-c-dark:#22d3ee')
    expect(html).toContain('--track-c-light:#0e7490')
    // No literal colour reaches the markup: the ring's stroke is a token this
    // component never names.
    expect(html).not.toMatch(/stroke="/)
  })

  it('rings the node, not the node’s box — the outline is already taken', () => {
    const pos = layout.byId.get(GROUP)
    expect(pos).toBeDefined()
    const html = renderToStaticMarkup(
      <PulseLayer layout={layout} pulses={pulseMap([[GROUP, { kind: 'updated', until: at }]])} />,
    )
    // Inset by 5 on every side: 10 wider and 10 taller than the card.
    expect(html).toContain(`width="${(pos?.width ?? 0) + 10}"`)
    expect(html).toContain(`height="${(pos?.height ?? 0) + 10}"`)
    expect(html).toContain(`x="${(pos?.x ?? 0) - 5}"`)
  })

  it('skips a pulse whose node is no longer drawn', () => {
    // The tree rebuilt between the plan and the paint. One frame later the next
    // plan resolves the change onto whatever is on screen now; drawing a ring at
    // a stale position in the meantime would be worse than drawing none.
    const html = renderToStaticMarkup(
      <PulseLayer
        layout={layout}
        pulses={pulseMap([
          [GROUP, { kind: 'updated', until: at }],
          ['root/track:gone/group:x', { kind: 'added', until: at }],
        ])}
      />,
    )
    expect((html.match(/class="mtree-pulse"/g) ?? []).length).toBe(1)
    expect(html).not.toContain('data-kind="added"')
  })

  it('draws nothing at all when nothing is pulsing', () => {
    const html = renderToStaticMarkup(<PulseLayer layout={layout} pulses={pulseMap([])} />)
    expect(html).toBe('<g class="mtree-pulses" aria-hidden="true"></g>')
  })

  it('orders the marks by node id, not by arrival', () => {
    // Two renders of the same batch must produce the same DOM. Map iteration is
    // insertion order, and insertion order here is the order a socket happened
    // to deliver events in.
    const forward = renderToStaticMarkup(
      <PulseLayer
        layout={layout}
        pulses={pulseMap([
          [GROUP, { kind: 'updated', until: at }],
          [TRACK, { kind: 'added', until: at }],
        ])}
      />,
    )
    const backward = renderToStaticMarkup(
      <PulseLayer
        layout={layout}
        pulses={pulseMap([
          [TRACK, { kind: 'added', until: at }],
          [GROUP, { kind: 'updated', until: at }],
        ])}
      />,
    )
    expect(forward).toBe(backward)
    expect(forward.indexOf('data-kind="added"')).toBeLessThan(forward.indexOf('data-kind="updated"'))
  })

  it('holds the exit shorter than the shortest pulse', () => {
    // Otherwise a departing card is still on screen when the layout has settled
    // around the gap it left, which reads as a duplicate rather than a leaving.
    expect(MIND_EXIT_MS).toBeLessThan(900)
  })
})
