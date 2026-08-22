// The map's WIRING — the four decisions that live in the map's composition
// itself and cannot be executed here.
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
// What is left is the CALL SITE — that the map actually reaches for those
// answers, and reaches for them on the paths that matter. `components/toast`'s
// own suite does exactly this for main.tsx's update prompt, and states the same
// bargain: a grep is a weak assertion, and it is stronger than the nothing that
// was there when the wiring was wrong.
//
// ── WHY THE GLOB IS A LIST AND NOT A DIRECTORY ─────────────────────────────
//
// pages/Mindtree.tsx was 2,946 lines and was split into a composition root, ten
// hooks under pages/map/ and three components under components/map/. That
// relocated every call site asserted below, which is precisely the operation
// most likely to silently re-open the four regressions this file exists to
// prevent. So each assertion was re-aimed at the ONE file the call site moved
// to, deliberately, rather than the glob being widened to `pages/map/*` and the
// question of where a line lives being given up on. A directory glob would pass
// on the day somebody moves `requestRefocus` into the render path.
//
// TWO ASSERTIONS ARE NEW, and both guard something the split itself created:
//   · the cold-load gate is now a value passed BETWEEN two files, so the
//     composition that connects them is asserted as well (see below);
//   · the three hooks either side of the drag controller have a required ORDER,
//     which nothing but this file can state.
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
  [
    './Mindtree.tsx',
    './map/useMapCursor.ts',
    './map/useMapDrag.ts',
    './map/useMapFocus.ts',
    './map/useMapKeyboard.ts',
    './map/useMapModel.ts',
    './map/useMapToolbar.ts',
    './map/useMapWrites.ts',
    '../components/map/MapAnnouncer.tsx',
    '../components/map/MapSummary.tsx',
    '../components/mindtree/DragLayer.tsx',
    '../components/mindtree/MindNode.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
)

function source(suffix: string): string {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(suffix))?.[1]
  if (hit === undefined) throw new Error(`${suffix} not found by import.meta.glob`)
  return hit
}

/** The composition root — the order the hooks are called in, and nothing else. */
const page = (): string => source('/Mindtree.tsx')
const cursor = (): string => source('map/useMapCursor.ts')
const drag = (): string => source('map/useMapDrag.ts')
const mapFocus = (): string => source('map/useMapFocus.ts')
const keyboard = (): string => source('map/useMapKeyboard.ts')
const mapModel = (): string => source('map/useMapModel.ts')
const mapToolbar = (): string => source('map/useMapToolbar.ts')
const writes = (): string => source('map/useMapWrites.ts')
const summary = (): string => source('map/MapSummary.tsx')
const announcer = (): string => source('map/MapAnnouncer.tsx')
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

    // The drag's half of the wiring moved to pages/map/useMapDrag.ts with the
    // `useMindDragLayer` call it is an option of.
    expect(drag()).toContain('onWrote: requestRefocus')

    // The menu is the second write path, and NodeMenu.dismiss() has just put
    // focus onto the node that is about to unmount. It moved to
    // pages/map/useMapWrites.ts with `runMenu`.
    expect(writes()).toMatch(/if \(moved !== undefined\) requestRefocus\(moved\)/)
  })

  it('performs it in a layout effect, through the extracted rule', () => {
    // The four pieces — the render-phase layoutRef write, the pre-write request,
    // the layout effect and refocusTarget's ordering rule — are now one file, so
    // that they cannot be separated by accident.
    const src = cursor()
    expect(src).toContain('useLayoutEffect')
    expect(src).toContain('refocusTarget(')
    expect(src).toContain('layoutRef.current = layout')
  })

  it('never steals focus for a rebuild the reader did not cause', () => {
    // A realtime batch rebuilds this tree several times a second. Repairing
    // focus unconditionally would pull the keyboard out of the filter box, or
    // off another screen entirely.
    const src = cursor()
    expect(src).toContain('if (!gestureHasFocus()) return')
    expect(src).toContain('svg.contains(active)')
    // …and the widening is bounded to the overlays this page raises itself,
    // because Confirm resolves its promise before it restores focus.
    expect(src).toContain('[role="dialog"], [role="menu"]')
  })

  it('repairs DOM focus as well as the tab stop when a node vanishes', () => {
    // The old effect reset `cursorId` and stopped there: the roving tabindex was
    // correct and the reader was on <body>.
    const src = cursor()
    expect(src).toMatch(/if \(next === null \|\| !treeFocused \|\| treeHasFocus\(\)\) return/)
  })
})

describe('the pointer can tick an item', () => {
  it('reads the modifier off the click and toggles the selection', () => {
    // `toggleMindSelected` had exactly ONE call site in the whole app and it was
    // behind Ctrl+Space, so the bulk bar, the drag-many and every "…the selected
    // items here" verb were unreachable with a mouse. `activate` moved to
    // pages/map/useMapKeyboard.ts, which is where it has to be: onKeyDown calls
    // it for Enter and for Space-on-a-branch.
    const src = keyboard()
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
    const src = keyboard()
    expect(src).toContain('if (dragController.isLifted()) return')
    // Ordering: the layer's own grammar is consulted first, and this guard sits
    // between it and the map's.
    expect(src.indexOf('dragController.handleKeyDown(event)')).toBeLessThan(
      src.indexOf('dragController.isLifted()'),
    )
  })

  it('answers from refs, so the Tab that ends a lift still leaves', () => {
    const layer = dragLayer()
    expect(layer).toContain('keyRef.current !== null || isMindDragging(sessionRef.current)')
  })
})

describe('the drill-in survives both the regroup and the cold load', () => {
  it('trims the focus to its track rather than clearing it', () => {
    // `chooseDimension` moved to pages/map/useMapToolbar.ts with the other four
    // things the toolbar's buttons do.
    const src = mapToolbar()
    expect(src).toContain('setMindFocus(dimensionStableId(focusPref))')
    // The old line, which threw a reader two rings deep back across every track.
    expect(src).not.toMatch(/chooseDimension[\s\S]{0,600}setMindFocus\(null\)/)
  })

  it('does not "repair" a focus before there is anything to repair it against', () => {
    // A cold load holds nothing for a frame or two, so every focus id resolved
    // to nothing and the reconciler cleared it — which the URL effect then wrote
    // back, stripping `?focus=` out of the link that had just been opened.
    //
    // THIS DEFECT NOW SPANS THREE FILES, so it takes three assertions. The gate
    // is in the reconciler; the question it asks is the store's `loaded once`
    // and not `!loading`; and the composition root is what connects them, which
    // is the join a split can break without either half changing.
    expect(mapFocus()).toContain('if (!entriesLoaded) return')
    expect(mapModel()).toContain('useEntriesLoadedOnce()')
    expect(page()).toContain('entriesLoaded: model.entriesLoaded')
  })
})

describe('the page live region re-announces a repeated sentence', () => {
  it('keys the rendered child on a counter', () => {
    // A plain string is a React bail-out when the value has not changed, so
    // "you cannot move this one" said twice was said once — and this region says
    // the same words all the time (Space on a second non-owned leaf, "Collapse
    // all" twice, "Fit to view" already fitted).
    //
    // The counter is written by the composition root, because every hook on the
    // screen is handed `setLive`; the element that consumes it is MapAnnouncer.
    expect(page()).toContain('setLiveState((prev) => ({ text, seq: prev.seq + 1 }))')
    expect(announcer()).toContain('<span key={live.seq}>{live.text}</span>')
  })

  it('mounts the region OUTSIDE the chrome gate, which is how it was lost', () => {
    // THE REGRESSION THIS EXISTS FOR. Both of MapAnnouncer's nodes used to live
    // in MapSummary, and MapSummary is rendered `{false && summaryIsle}` — so
    // quieting the VISIBLE caption strip silently unmounted the page's only
    // live region and left the <svg>'s `aria-describedby` pointing at nothing.
    // Neither failure has a visible symptom, which is why it shipped.
    //
    // Read as source rather than by rendering because the gate is the fact under
    // test: an element can be present in a render tree for the wrong reason.
    const src = page()
    const mount = src.indexOf('<MapAnnouncer')
    expect(mount, 'Mindtree.tsx must mount <MapAnnouncer>').toBeGreaterThan(-1)

    // No `{false &&` and no `Isle` between the start of its JSX line and the tag.
    const lineStart = src.lastIndexOf('\n', mount)
    expect(src.slice(lineStart, mount)).not.toContain('&&')

    // And it is handed BOTH things that were lost: the live counter and the id.
    expect(src).toMatch(/<MapAnnouncer[^>]*hintId=\{hintId\}/)
    expect(src).toMatch(/<MapAnnouncer[^>]*live=\{live\}/)

    // The id the canvas points at is carried by the element this file mounts,
    // not by the one behind the gate.
    expect(announcer()).toContain('id={hintId}')
    expect(summary()).not.toContain('id={hintId}')
  })
})

describe('the phone gets the verbs the drag cannot offer it', () => {
  it('spends the hold on the node menu for a BRANCH, which cannot be lifted', () => {
    // ⚠ THE DEAD END THIS EXISTS FOR. `v1: leaves move, branches do not`, so
    // `onNodePointerDown` returned on `kind !== 'entry'` — before any of the
    // hold machinery. A finger has no right-click and no Shift+F10, so on a
    // touch screen the node menu was unreachable on every directorate, book and
    // type, and with it add an item, add a branch, archive and focus.
    //
    // The `menuOnly` path below cannot serve this: it runs through the drag
    // session, which is built around an `entryId` a branch does not have, and it
    // only arms when `zones` is empty — which on a tree of branches is never.
    const layer = dragLayer()
    const gate = layer.indexOf("if (pos.node.kind !== 'entry' || entryId === null)")
    expect(gate, 'the non-draggable gate has moved or gone').toBeGreaterThan(-1)
    // It is no longer a bare `return`.
    expect(layer.slice(gate, gate + 120)).not.toMatch(/entryId === null\) return/)

    // A MOUSE IS TURNED AWAY HERE, deliberately: it already opens the menu
    // instantly with a right-click, and a 420 ms delay is not an improvement.
    expect(layer).toContain(
      "if (ev.pointerType === 'mouse' || ctxRef.current.onNodeMenu === undefined) return",
    )
    // And the press claims the finger only once it lands.
    expect(layer).toContain('menuHoldRef.current = { pointerId: ev.pointerId, client }')
  })

  it('cancels that hold when the finger turns out to be panning', () => {
    // The hold has NO drag session, and `onWindowMove` returns on exactly that —
    // so without its own check a finger that panned away would still be handed a
    // menu 420 ms later, at a point it had already left. The check has to come
    // FIRST in that handler for the same reason.
    const layer = dragLayer()
    const move = layer.indexOf('const onWindowMove = useCallback(')
    const menuCheck = layer.indexOf('const menuHold = menuHoldRef.current', move)
    const sessionBail = layer.indexOf('const session = sessionRef.current', move)
    expect(menuCheck, 'onWindowMove does not check the menu hold').toBeGreaterThan(-1)
    expect(menuCheck, 'the menu-hold check must precede the session bail').toBeLessThan(sessionBail)
    expect(layer).toContain('if (drifted) endRef.current(false)')

    // Torn down by the SAME teardown as a real drag, so a press that ended any
    // way at all cannot open a menu afterwards.
    const teardown = layer.indexOf('const endGesture = useCallback(')
    expect(layer.indexOf('menuHoldRef.current = null', teardown)).toBeGreaterThan(-1)
  })

  it('stamps the click the hold is about to synthesise, so the branch does not fold', () => {
    // `foldOnActivate` makes a tap on a branch FOLD it, and the pointerup that
    // ends this hold synthesises exactly that tap. Without the stamp the menu
    // opens and the branch collapses underneath it one frame later.
    const layer = dragLayer()
    const timer = layer.indexOf('const held = menuHoldRef.current')
    expect(timer).toBeGreaterThan(-1)
    const body = layer.slice(timer, timer + 900)
    expect(body.indexOf('draggedAtRef.current = Date.now()')).toBeGreaterThan(-1)
    expect(body.indexOf('draggedAtRef.current = Date.now()')).toBeLessThan(
      body.indexOf('onNodeMenu?.('),
    )
  })

  it('spends the hold on the node menu when there is nowhere to drop', () => {
    const layer = dragLayer()
    expect(layer).toContain('const menuOnly = zonesRef.current.length === 0')
    expect(layer).toContain('ctxRef.current.onNodeMenu?.(pos, { x: at.x, y: at.y })')
    // A mouse already has right-click and no hold, so it gets nothing here.
    expect(layer).toContain(
      'if (menuOnly && (!held || ctxRef.current.onNodeMenu === undefined)) return',
    )
    // The synthesised click must not open the entry behind the menu.
    expect(layer).toMatch(/draggedAtRef\.current = Date\.now\(\)[\s\S]{0,400}onNodeMenu/)
  })

  it('is wired to the page menu the keyboard and right-click already open', () => {
    expect(drag()).toContain('onNodeMenu: openMenuFor')
  })
})

describe('the composition calls its hooks in the order the drag layer forces', () => {
  it('builds the cursor, then the controller, then the keyboard', () => {
    // NEW, and it guards the decomposition rather than a shipped defect —
    // because the decomposition is what made it possible to get wrong.
    //
    // `useMapDrag` takes `requestRefocus` as `onWrote`, so useMapCursor must be
    // built first; `useMapKeyboard`'s onKeyDown asks `dragController` first, so
    // it must be built after. Swap either and TypeScript is perfectly happy —
    // the value is simply `undefined` at the moment it is read, or the hook is
    // handed a stale controller — and the failure is a lost focus repair or two
    // live keyboard grammars, both of which this file's other describes exist to
    // prevent.
    const src = page()
    const at = (needle: string): number => {
      const i = src.indexOf(needle)
      expect(i, `${needle} not found in Mindtree.tsx`).toBeGreaterThan(-1)
      return i
    }
    expect(at('useMapCursor(')).toBeLessThan(at('useMapDrag('))
    expect(at('useMapDrag(')).toBeLessThan(at('useMapKeyboard('))
  })

  it('hands the drag layer the WHOLE tree, never the drawn root', () => {
    // A drop folds the ROOT-to-target path. On a phone, or two rings into a
    // drill-in, the drawn root is a track — so folding the DRAWN path writes a
    // status and silently leaves the row on its old track. The easiest mistake
    // to make while moving this call into a file of its own is to pass the
    // variable that is already in scope.
    expect(drag()).toContain('root: tree,')
    expect(page()).toContain('tree: model.tree,')
    expect(drag()).not.toContain('root: drawnRoot')
  })
})

describe('every memo that renders chrome lists the lens members it reads', () => {
  // ⚠ THE BUG THIS EXISTS TO STOP, caught in a browser and not by any test.
  //
  //   `shellIsle` is a `useMemo` holding the lens bar and the mode bar. Its
  //   dependency list named `lens.lens` and `lens.setLens` but not `lens.stage`,
  //   which the map⇄ledger toggle's label is computed from. So pressing the
  //   toggle swapped the canvas — that reads the store directly — while the
  //   button kept the label it was built with: press "Map", get the map, and the
  //   button still says "Table". A control naming where the reader is standing
  //   instead of where the press goes is the exact ambiguity the label was
  //   written to avoid, reintroduced by a stale render.
  //
  //   It survived one browser pass by ACCIDENT. A count in the same dep list
  //   changed in the tick after the first press and dragged a fresh render in
  //   with it, so the first toggle looked right and the second froze.
  //
  //   React's `exhaustive-deps` rule would catch this; it is not among the rules
  //   this repo runs. So the check is here, in the terms of this file: whatever
  //   a chrome memo READS off `lens`, it must also DEPEND on.
  const isle = (name: string): { body: string; deps: string } => {
    const src = page()
    const at = src.indexOf(`const ${name} = useMemo(`)
    expect(at, `${name} not found — has it been renamed?`).toBeGreaterThan(-1)
    // The memo ends at the dep array, which is the last `[` ... `],\n  )` before
    // the next top-level `const`. Cheap and exact enough: the deps of a useMemo
    // are its final argument.
    const end = src.indexOf('\n  )', at)
    const chunk = src.slice(at, end)
    const depAt = chunk.lastIndexOf('\n    [')
    return { body: chunk.slice(0, depAt), deps: chunk.slice(depAt) }
  }

  for (const name of ['shellIsle', 'lensIsle', 'canvasIsle']) {
    const src = page()
    if (!src.includes(`const ${name} = useMemo(`)) continue
    it(`${name} depends on every lens member its body reads`, () => {
      const { body, deps } = isle(name)
      // ⚠ BOTH HALVES ARE STRIPPED OF COMMENTS, and the dependency half is the
      //   one that matters. The prose explaining WHY `lens.stage` belongs in
      //   this list sits inside the list, so a check that read the deps raw
      //   passed on its own explanation — it went green against a file with the
      //   two dependencies deleted. A guard that cannot fail is worse than none,
      //   because it is counted.
      const strip = (text: string): string =>
        text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      const code = strip(body)
      const listed = strip(deps)
      const read = [...new Set(code.match(/\blens\.[A-Za-z]+/g) ?? [])].sort()
      expect(read.length, `${name} reads nothing off lens`).toBeGreaterThan(0)
      for (const member of read) {
        expect(listed, `${name} reads ${member} but does not depend on it`).toContain(member)
      }
    })
  }
})
