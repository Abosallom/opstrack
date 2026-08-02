// The map's interaction store — the persistence and the pruning.
//
// WHY A STORE TEST AT ALL, when the selectors are hooks vitest cannot observe.
// Because the two things most likely to reach a user badly are not hooks. One is
// `readMindtreePrefs`, which runs synchronously on this module's FIRST IMPORT,
// before a frame is painted, against user-writable storage that outlives a
// schema change — a value it mishandles is a blank screen on load, and the
// browser is the only place it would ever be noticed. The other is
// `pruneMindSelection`, which is what stops a bulk bar counting rows nobody can
// see. Both are plain functions over plain values, which is exactly the shape
// `store/nudges.test.ts` and `store/entrySheet.test.ts` are written against.
//
// LOCALSTORAGE IS FAKED, NOT MOCKED. vitest runs `environment: 'node'`, so the
// global simply does not exist and the module's `typeof` guard takes the null
// branch — which would make every persistence assertion below vacuously pass.
// So a minimal in-memory Storage is installed BEFORE the module is imported, and
// the import is dynamic for that reason alone: a static import is hoisted above
// every statement in the file and would read the real (absent) storage.

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The four methods this module actually calls, over a plain Map. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

const KEY = 'opstrack_mindtree_v1'

function install(seed: Record<string, string> = {}): Storage {
  const store = fakeStorage(seed)
  vi.stubGlobal('localStorage', store)
  return store
}

/**
 * A fresh module instance, reading whatever storage is installed right now.
 *
 * `resetModules` is the point: the prefs are read at module scope, so two cases
 * with different persisted values need two module instances. Without it the
 * second case would assert against the first case's initial state.
 */
async function load(): Promise<typeof import('./mindtree')> {
  vi.resetModules()
  return import('./mindtree')
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

/* ───────────────────────────── reading the prefs ─────────────────────────── */

describe('readMindtreePrefs — every field validated', () => {
  it('takes the defaults when nothing is stored', async () => {
    install()
    const m = await load()
    expect(m.readMindtreePrefs()).toEqual({
      dimension: 'status',
      view: 'map',
      density: 'comfortable',
      focus: null,
      collapsed: {},
      opened: {},
    })
  })

  it('degrades a dimension a future build wrote, rather than rendering an empty ring', async () => {
    install({ [KEY]: JSON.stringify({ dimension: 'assignee', view: 'table' }) })
    const m = await load()
    const prefs = m.readMindtreePrefs()
    expect(prefs.dimension).toBe('status')
    // The rest of the record survives. A malformed value must cost the reader
    // ONE preference, never all of them.
    expect(prefs.view).toBe('table')
  })

  it('degrades a density that is not one of the two', async () => {
    install({ [KEY]: JSON.stringify({ density: 'cosy' }) })
    expect((await load()).readMindtreePrefs().density).toBe('comfortable')
  })

  it('treats a missing density as a default, exactly as a malformed one', async () => {
    // The ordinary case: every device that persisted before density shipped.
    install({ [KEY]: JSON.stringify({ dimension: 'owner', view: 'map' }) })
    const prefs = (await load()).readMindtreePrefs()
    expect(prefs.density).toBe('comfortable')
    expect(prefs.dimension).toBe('owner')
  })

  it('reads the shape pages/Mindtree.tsx already persisted', async () => {
    // THE MIGRATION, and there is no migration code: this module absorbed that
    // key rather than adding a second, so a reader who collapsed nine branches
    // yesterday finds them collapsed today.
    install({
      [KEY]: JSON.stringify({
        dimension: 'priority',
        view: 'table',
        collapsed: { priority: ['root/track:t-1'] },
        opened: { priority: ['root/track:t-2'] },
      }),
    })
    const prefs = (await load()).readMindtreePrefs()
    expect(prefs.dimension).toBe('priority')
    expect(prefs.collapsed).toEqual({ priority: ['root/track:t-1'] })
    expect(prefs.opened).toEqual({ priority: ['root/track:t-2'] })
  })

  it('drops a focus that is not anchored at the root', async () => {
    // The only structural claim a node id makes that this module can check
    // without a tree. It rejects the corrupted and the hostile; a merely STALE
    // focus is `ensureMindFocus`'s job, because only the tree knows.
    install({ [KEY]: JSON.stringify({ focus: 'track:t-1' }) })
    expect((await load()).readMindtreePrefs().focus).toBeNull()
  })

  it('keeps a focus that is anchored at the root', async () => {
    install({ [KEY]: JSON.stringify({ focus: 'root/track:t-1' }) })
    expect((await load()).readMindtreePrefs().focus).toBe('root/track:t-1')
  })

  it('survives a value that is not JSON at all', async () => {
    install({ [KEY]: '{"dimension":' })
    // A map that throws on mount because a preference is half-written is worse
    // than a default map.
    expect((await load()).readMindtreePrefs().dimension).toBe('status')
  })

  it('survives a value that is JSON but not an object', async () => {
    install({ [KEY]: '"status"' })
    expect((await load()).readMindtreePrefs().dimension).toBe('status')
  })

  it('ignores non-string members inside a collapsed list', async () => {
    install({ [KEY]: JSON.stringify({ collapsed: { status: ['root/track:a', 7, null, 'root/track:b'] } }) })
    expect((await load()).readMindtreePrefs().collapsed).toEqual({
      status: ['root/track:a', 'root/track:b'],
    })
  })

  it('ignores a collapsed record that is an array rather than an object', async () => {
    install({ [KEY]: JSON.stringify({ collapsed: ['root/track:a'] }) })
    expect((await load()).readMindtreePrefs().collapsed).toEqual({})
  })

  it('caps a list nobody could have produced by hand', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => `root/track:${i}`)
    install({ [KEY]: JSON.stringify({ collapsed: { status: many } }) })
    // Read synchronously on first import, before a frame is painted. Unbounded
    // is a first-paint the reader watches.
    expect((await load()).readMindtreePrefs().collapsed.status).toHaveLength(2000)
  })

  it('drops a node id long enough to be a payload rather than a path', async () => {
    install({ [KEY]: JSON.stringify({ collapsed: { status: ['x'.repeat(9000), 'root/track:a'] } }) })
    expect((await load()).readMindtreePrefs().collapsed.status).toEqual(['root/track:a'])
  })

  it('keeps a dimension key it does not recognise', async () => {
    // ASYMMETRIC WITH `dimension` ITSELF, on purpose. A stale axis NAME decides
    // what is drawn right now and must degrade; a stale axis's collapse RECORD
    // decides nothing until that axis exists, and deleting it would mean an
    // older build destroys a newer build's state every time the two share a
    // browser.
    install({ [KEY]: JSON.stringify({ collapsed: { assignee: ['root/track:a'] } }) })
    expect((await load()).readMindtreePrefs().collapsed).toEqual({ assignee: ['root/track:a'] })
  })

  it('returns the defaults when storage itself throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
    })
    expect((await load()).readMindtreePrefs().dimension).toBe('status')
  })
})

/* ──────────────────────────── writing the prefs ──────────────────────────── */

describe('the persisted half', () => {
  it('writes on a change and derives the two sets for the active axis', async () => {
    const store = install()
    const m = await load()

    m.setMindDimension('owner')
    m.setMindCollapsed('root/track:t-1', true)

    const raw = store.getItem(KEY)
    expect(raw).not.toBeNull()
    const saved: unknown = JSON.parse(raw as string)
    expect(saved).toMatchObject({ dimension: 'owner', collapsed: { owner: ['root/track:t-1'] } })
    // The derived set is STATE, not a selector — building it in a selector would
    // return a new Set on every render, which under useSyncExternalStore reads
    // as "the snapshot changed", forever.
    expect(m.getMindtreeState().collapsedIds.has('root/track:t-1')).toBe(true)
  })

  it('keeps each axis its own rings', async () => {
    install()
    const m = await load()
    m.setMindCollapsed('root/track:t-1', true)
    expect(m.getMindtreeState().collapsedIds.size).toBe(1)

    m.setMindDimension('priority')
    // A branch closed on the status axis says nothing about the priority axis:
    // the group ids are different nodes entirely.
    expect(m.getMindtreeState().collapsedIds.size).toBe(0)

    m.setMindDimension('status')
    expect(m.getMindtreeState().collapsedIds.has('root/track:t-1')).toBe(true)
  })

  it('does not write when the value did not move', async () => {
    const store = install()
    const m = await load()
    m.setMindDimension('owner')
    const first = store.getItem(KEY)
    m.setMindDimension('owner')
    // Same reference back from the setter, so no localStorage write on a
    // synchronous path for a no-op.
    expect(store.getItem(KEY)).toBe(first)
  })

  it('moves a node between the two records rather than leaving it in both', async () => {
    install()
    const m = await load()

    m.setMindCollapsed('root/track:t-1', false)
    expect(m.getMindtreeState().expandedIds.has('root/track:t-1')).toBe(true)

    m.setMindCollapsed('root/track:t-1', true)
    const s = m.getMindtreeState()
    // model.startsCollapsed reads an explicit close as beating an explicit open.
    // Leaving the stale open behind would mean a reader who opened a branch that
    // openDepth would have closed could never close it again.
    expect(s.collapsedIds.has('root/track:t-1')).toBe(true)
    expect(s.expandedIds.has('root/track:t-1')).toBe(false)
  })

  it('toggles against the derived set', async () => {
    install()
    const m = await load()
    m.toggleMindCollapsed('root/track:t-1')
    expect(m.getMindtreeState().collapsedIds.has('root/track:t-1')).toBe(true)
    m.toggleMindCollapsed('root/track:t-1')
    expect(m.getMindtreeState().collapsedIds.has('root/track:t-1')).toBe(false)
  })

  it('records only the open for a "+N more" fold', async () => {
    install()
    const m = await load()
    m.expandMindNode('root/track:t-1/group:new/more')
    const s = m.getMindtreeState()
    expect(s.expandedIds.has('root/track:t-1/group:new/more')).toBe(true)
    // A fold is closed BY DEFAULT, always, so there is no closed record to clear.
    expect(s.collapsedIds.size).toBe(0)
  })

  it('clears the stale opens when everything is collapsed at once', async () => {
    install()
    const m = await load()
    m.setMindCollapsed('root/track:t-1', false)
    m.collapseMindAll(['root/track:t-1', 'root/track:t-2'])
    const s = m.getMindtreeState()
    expect([...s.collapsedIds].sort()).toEqual(['root/track:t-1', 'root/track:t-2'])
    expect(s.expandedIds.size).toBe(0)
  })

  it('clears both records when everything is expanded at once', async () => {
    install()
    const m = await load()
    m.collapseMindAll(['root/track:t-1'])
    m.expandMindAll([])
    const s = m.getMindtreeState()
    expect(s.collapsedIds.size).toBe(0)
    expect(s.expandedIds.size).toBe(0)
  })
})

/* ──────────────────────────────── the focus ──────────────────────────────── */

describe('focus', () => {
  it('persists a drill-in and refuses a malformed one', async () => {
    install()
    const m = await load()
    m.setMindFocus('root/track:t-1')
    expect(m.getMindtreeState().focus).toBe('root/track:t-1')
    m.setMindFocus('nonsense')
    expect(m.getMindtreeState().focus).toBeNull()
  })

  it('drops a focus the tree no longer contains', async () => {
    install({ [KEY]: JSON.stringify({ focus: 'root/track:gone' }) })
    const m = await load()
    expect(m.getMindtreeState().focus).toBe('root/track:gone')

    // The track was archived, or the filter narrowed past it. Without this
    // handshake the canvas renders nothing at all, with a breadcrumb pointing at
    // a node that is not there — the one failure a persisted preference must
    // never be able to cause.
    m.ensureMindFocus((id) => id === 'root/track:t-1')
    expect(m.getMindtreeState().focus).toBeNull()
  })

  it('leaves a focus the tree still contains', async () => {
    install({ [KEY]: JSON.stringify({ focus: 'root/track:t-1' }) })
    const m = await load()
    m.ensureMindFocus((id) => id === 'root/track:t-1')
    expect(m.getMindtreeState().focus).toBe('root/track:t-1')
  })

  it('keeps the selection across a drill-in', async () => {
    install()
    const m = await load()
    m.setMindSelection(['e-1', 'e-2'])
    m.setMindFocus('root/track:t-1')
    // Tick six, drill into the person who should take them, apply — that is the
    // redistribution gesture this screen exists for, and clearing on focus would
    // break it in the middle.
    expect(m.getMindtreeState().selection.size).toBe(2)
  })
})

/* ────────────────────────────── the selection ────────────────────────────── */

describe('selection', () => {
  it('toggles one id at a time, in tick order', async () => {
    install()
    const m = await load()
    m.toggleMindSelected('e-2')
    m.toggleMindSelected('e-1')
    expect([...m.getMindtreeState().selection]).toEqual(['e-2', 'e-1'])
    m.toggleMindSelected('e-2')
    expect([...m.getMindtreeState().selection]).toEqual(['e-1'])
  })

  it('prunes to what is on screen', async () => {
    install()
    const m = await load()
    m.setMindSelection(['e-1', 'e-2', 'e-3'])
    // A bulk bar reading "3 selected" while two of them are behind a collapsed
    // branch is a lie — and a map has three ways to hide a row that a list does
    // not: collapsing, drilling in, and tightening a filter.
    m.pruneMindSelection(new Set(['e-2']))
    expect([...m.getMindtreeState().selection]).toEqual(['e-2'])
  })

  it('hands back the same set when nothing was pruned', async () => {
    install()
    const m = await load()
    m.setMindSelection(['e-1'])
    const before = m.getMindtreeState().selection
    m.pruneMindSelection(new Set(['e-1', 'e-9']))
    // The ordinary rebuild, where everything ticked is still on screen, must
    // cost no render anywhere.
    expect(m.getMindtreeState().selection).toBe(before)
  })

  it('is a no-op on an empty selection', async () => {
    install()
    const m = await load()
    const before = m.getMindtreeState().selection
    m.pruneMindSelection(new Set(['e-1']))
    expect(m.getMindtreeState().selection).toBe(before)
  })

  it('returns to the shared empty set when the last id goes', async () => {
    install()
    const m = await load()
    const empty = m.getMindtreeState().selection
    m.setMindSelection(['e-1'])
    m.clearMindSelection()
    expect(m.getMindtreeState().selection).toBe(empty)
  })

  it('is not persisted', async () => {
    const store = install()
    const m = await load()
    m.setMindSelection(['e-1'])
    // A tick is this session's business. Restoring it on the next load would
    // arm a bulk bar over rows the reader has forgotten choosing.
    expect(store.getItem(KEY)).toBeNull()
  })
})

/* ──────────────────────────────── the drag ───────────────────────────────── */

describe('drag', () => {
  const drag = { entryIds: ['e-1'], fromNodeId: 'root/track:t-1', overNodeId: null, refusalKey: null }

  it('publishes the descriptor and clears it', async () => {
    install()
    const m = await load()
    m.beginMindDrag(drag)
    expect(m.getMindtreeState().drag?.entryIds).toEqual(['e-1'])
    m.endMindDrag()
    expect(m.getMindtreeState().drag).toBeNull()
  })

  it('hands back identical state when the pointer has not changed node', async () => {
    install()
    const m = await load()
    m.beginMindDrag(drag)
    m.setMindDragOver('root/track:t-2', null)
    const held = m.getMindtreeState().drag
    m.setMindDragOver('root/track:t-2', null)
    // dnd.moveDrag answers on every pointermove, and a map has hundreds of them
    // between two nodes. Same reference is what makes the drag cost 2 renders
    // rather than 400.
    expect(m.getMindtreeState().drag).toBe(held)
  })

  it('re-renders when the refusal changes under a stationary pointer', async () => {
    install()
    const m = await load()
    m.beginMindDrag(drag)
    m.setMindDragOver('root/track:t-2', null)
    const held = m.getMindtreeState().drag
    m.setMindDragOver('root/track:t-2', 'mindtree.whyRetired')
    expect(m.getMindtreeState().drag).not.toBe(held)
    expect(m.getMindtreeState().drag?.refusalKey).toBe('mindtree.whyRetired')
  })

  it('ignores a hover with no drag in flight', async () => {
    install()
    const m = await load()
    m.setMindDragOver('root/track:t-2', null)
    expect(m.getMindtreeState().drag).toBeNull()
  })

  it('is not persisted', async () => {
    const store = install()
    const m = await load()
    m.beginMindDrag(drag)
    expect(store.getItem(KEY)).toBeNull()
  })
})

/* ──────────────────────────────── sign-out ───────────────────────────────── */

describe('resetMindtree', () => {
  it('clears the session state AND the persisted preferences', async () => {
    const store = install()
    const m = await load()
    m.setMindDimension('owner')
    m.setMindFocus('root/track:t-1')
    m.setMindSelection(['e-1'])
    m.setMindHovered('root/track:t-1')
    m.beginMindDrag({ entryIds: ['e-1'], fromNodeId: 'root', overNodeId: null, refusalKey: null })

    m.resetMindtree()

    const s = m.getMindtreeState()
    expect(s.dimension).toBe('status')
    expect(s.focus).toBeNull()
    expect(s.selection.size).toBe(0)
    expect(s.hoveredNodeId).toBeNull()
    expect(s.drag).toBeNull()

    // THE DEFAULTS ARE WRITTEN, not merely held. Re-reading the key would
    // otherwise restore the same values on the next load — which is the version
    // of "cleared" that does not survive a reload.
    const saved: unknown = JSON.parse(store.getItem(KEY) as string)
    expect(saved).toMatchObject({ dimension: 'status', focus: null, collapsed: {}, opened: {} })
  })
})
