// The map's WIRING — the four decisions that live in pages/Mindtree.tsx itself
// and cannot be executed here.
//
// WHY THIS FILE READS SOURCE INSTEAD OF RENDERING. vitest.config.ts is
// `environment: 'node'` and jsdom is not in the dependency budget, which every
// other page test in this repo opens by saying. A server render can prove what
// the screen DRAWS; it cannot press Ctrl and click, cannot unmount a focused
// `<g>` and see where focus lands, and cannot run a layout effect. Each of the
// four behaviours below is a defect that shipped, and each one's real rule has
// already been extracted into a pure module and asserted there against real
// trees:
//
//   · where focus goes after a write  → lib/mindtree/focus.refocusTarget
//   · what a regroup does to a focus  → lib/mindtree/focus.dimensionStableId
//   · which branches a drag may aim at → components/mindtree/DragLayer zones
//   · what a bulk apply must ask first → lib/mindtree/actions.closes
//
// What is left is the CALL SITE — that the page actually reaches for those
// answers, and reaches for them on the paths that matter. `components/toast`'s
// own suite does exactly this for main.tsx's update prompt, and states the same
// bargain: a grep is a weak assertion, and it is stronger than the nothing that
// was there when the wiring was wrong.
//
// Every assertion below names the defect it is standing guard over, so that a
// future reader deleting a line knows what it costs.

import { describe, expect, it } from 'vitest'

/**
 * Source through `import.meta.glob('?raw')` rather than `node:fs`, for the
 * reason lib/localeReach.test.ts spells out: tsconfig.app.json pins
 * `types: ["vite/client"]`, and adding "node" would leak node globals into the
 * type space of every app file.
 */
const SOURCES: Record<string, string> = import.meta.glob(
  ['./Mindtree.tsx', '../components/mindtree/DragLayer.tsx', '../components/mindtree/MindNode.tsx'],
  { query: '?raw', import: 'default', eager: true },
)

function source(suffix: string): string {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(suffix))?.[1]
  if (hit === undefined) throw new Error(`${suffix} not found by import.meta.glob`)
  return hit
}

const page = (): string => source('/Mindtree.tsx')
const dragLayer = (): string => source('mindtree/DragLayer.tsx')
const mindNode = (): string => source('mindtree/MindNode.tsx')

describe('focus survives the write that moves a row', () => {
  it('asks for the repair BEFORE the patch, from both write paths', () => {
    // The store commits the optimistic row before it awaits, so the tree — and
    // the element holding DOM focus — is already gone by the first `await`.
    const layer = dragLayer()
    const before = layer.indexOf('onWrote?.(')
    const patch = layer.indexOf('pooled(plan.ids')
    expect(before).toBeGreaterThan(-1)
    expect(patch).toBeGreaterThan(-1)
    expect(before).toBeLessThan(patch)

    // The menu is the second write path, and NodeMenu.dismiss() has just put
    // focus onto the node that is about to unmount.
    const src = page()
    expect(src).toContain('onWrote: requestRefocus')
    expect(src).toMatch(/if \(moved !== undefined\) requestRefocus\(moved\)/)
  })

  it('performs it in a layout effect, through the extracted rule', () => {
    const src = page()
    expect(src).toContain('useLayoutEffect')
    expect(src).toContain('refocusTarget(')
  })

  it('never steals focus for a rebuild the reader did not cause', () => {
    // A realtime batch rebuilds this tree several times a second. Repairing
    // focus unconditionally would pull the keyboard out of the filter box, or
    // off another screen entirely.
    const src = page()
    expect(src).toContain('if (!gestureHasFocus()) return')
    expect(src).toContain('svg.contains(active)')
    // …and the widening is bounded to the overlays this page raises itself,
    // because Confirm resolves its promise before it restores focus.
    expect(src).toContain('[role="dialog"], [role="menu"]')
  })

  it('repairs DOM focus as well as the tab stop when a node vanishes', () => {
    // The old effect reset `cursorId` and stopped there: the roving tabindex was
    // correct and the reader was on <body>.
    const src = page()
    expect(src).toMatch(/if \(next === null \|\| !treeFocused \|\| treeHasFocus\(\)\) return/)
  })
})

describe('the pointer can tick an item', () => {
  it('reads the modifier off the click and toggles the selection', () => {
    // `toggleMindSelected` had exactly ONE call site in the whole app and it was
    // behind Ctrl+Space, so the bulk bar, the drag-many and every "…the selected
    // items here" verb were unreachable with a mouse.
    const src = page()
    expect(src).toMatch(/const ticking = event !== undefined && \(event\.ctrlKey \|\| event\.metaKey\)/)
    expect(src).toContain('toggleSelect(node.entryId, textOf(node.label))')
  })

  it('hands the event down from the node that receives it', () => {
    const node = mindNode()
    // Without the event the gesture is not representable at all — this is the
    // half tsc cannot check, because a handler is free to ignore an argument.
    expect(node).toContain('onActivate(node, event)')
  })

  it('says so in the instructions, in both languages', async () => {
    // A gesture nobody is told about is a gesture nobody uses. `selectHint` is
    // rendered into the tree's `aria-describedby`.
    for (const locale of ['en', 'ar'] as const) {
      const bundle = (await import(`../locales/${locale}/mindtree.json`)) as {
        default: { mindtree: Record<string, unknown> }
      }
      const hint = bundle.default.mindtree.selectHint
      expect(typeof hint).toBe('string')
      expect(hint as string).toContain('Ctrl')
      // The pointer half, named — "click" in English, "نقرة" in Arabic.
      expect((hint as string).length).toBeGreaterThan(40)
    }
  })
})

describe('the two grammars are never live at once', () => {
  it('lets a lift own the keyboard until it ends', () => {
    // Shift+F10 used to open the node menu and move focus into it with a live,
    // now-unreachable drag still on screen; Ctrl+Space used to tick a row the
    // frozen carry was never going to carry.
    const src = page()
    expect(src).toContain('if (dragController.isLifted()) return')
    // Ordering: the layer's own grammar is consulted first, and this guard sits
    // between it and the map's.
    expect(src.indexOf('dragController.handleKeyDown(event)')).toBeLessThan(
      src.indexOf('dragController.isLifted()'),
    )
  })

  it('answers from refs, so the Tab that ends a lift still leaves', () => {
    const layer = dragLayer()
    expect(layer).toContain(
      'keyRef.current !== null || isMindDragging(sessionRef.current)',
    )
  })
})

describe('the drill-in survives both the regroup and the cold load', () => {
  it('trims the focus to its track rather than clearing it', () => {
    const src = page()
    expect(src).toContain('setMindFocus(dimensionStableId(focusPref))')
    // The old line, which threw a reader two rings deep back across every track.
    expect(src).not.toMatch(/chooseDimension[\s\S]{0,600}setMindFocus\(null\)/)
  })

  it('does not "repair" a focus before there is anything to repair it against', () => {
    // A cold load holds nothing for a frame or two, so every focus id resolved
    // to nothing and the reconciler cleared it — which the URL effect then wrote
    // back, stripping `?focus=` out of the link that had just been opened.
    const src = page()
    expect(src).toContain('if (!entriesLoaded) return')
    expect(src).toContain('useEntriesLoadedOnce()')
  })
})

describe('the page live region re-announces a repeated sentence', () => {
  it('keys the rendered child on a counter', () => {
    // A plain string is a React bail-out when the value has not changed, so
    // "you cannot move this one" said twice was said once — and this region says
    // the same words all the time (Space on a second non-owned leaf, "Collapse
    // all" twice, "Fit to view" already fitted).
    const src = page()
    expect(src).toContain('<span key={live.seq}>{live.text}</span>')
    expect(src).toContain('setLiveState((prev) => ({ text, seq: prev.seq + 1 }))')
  })
})

describe('the phone gets the verbs the drag cannot offer it', () => {
  it('spends the hold on the node menu when there is nowhere to drop', () => {
    const layer = dragLayer()
    expect(layer).toContain('const menuOnly = zonesRef.current.length === 0')
    expect(layer).toContain('ctxRef.current.onNodeMenu?.(pos, { x: at.x, y: at.y })')
    // A mouse already has right-click and no hold, so it gets nothing here.
    expect(layer).toContain('if (menuOnly && (!held || ctxRef.current.onNodeMenu === undefined)) return')
    // The synthesised click must not open the entry behind the menu.
    expect(layer).toMatch(/draggedAtRef\.current = Date\.now\(\)[\s\S]{0,400}onNodeMenu/)
  })

  it('is wired to the page menu the keyboard and right-click already open', () => {
    const src = page()
    expect(src).toContain('onNodeMenu: openMenuFor')
  })
})
