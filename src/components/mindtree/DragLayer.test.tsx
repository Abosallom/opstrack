// What can be proved about a drag without a pointer.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — pages/Board.test.tsx,
// pages/Dashboard.test.tsx and MindtreeTable.test.tsx all open with that
// paragraph. So the gesture itself (the hold, the threshold, the hit test, the
// auto-pan) is NOT asserted here, and it does not need to be: every one of those
// is a pure function in `lib/dnd.ts` and `lib/mindtree/drag.ts` with its own
// suite, and what a drop MEANS is `lib/mindtree/dropRules.ts` with 65 more. This
// file covers the three things that are genuinely this component's and would
// otherwise be proved by a human moving a mouse:
//
//  1. THE ZONES. Which nodes a drag may aim at is derived here from the drawn
//     layout, and getting it wrong in either direction is invisible until
//     somebody drags: too many and a leaf becomes a target that refuses on
//     release, too few and a branch is silently undroppable.
//  2. THE MOUNT. Both halves render without a lift in flight — the state the
//     screen is in 99% of the time — and neither leaves a stray box in the
//     drawing or an announcement in the live region.
//  3. THE SENTENCES, through the REAL t() and the REAL bundles, in both
//     languages. Every counted announcement this layer makes goes through a
//     plural node, and `lib/localeCounted.test.ts`'s header records what that
//     class of bug looks like when nobody renders it: a structural gate cannot
//     see a call site that passes `{ n: 3 }` where the bundle reads `{count}`,
//     so "3 items moved" has to be asserted as a STRING.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry, EntryHealth } from '../../types'
// TYPE-only, so it is erased before it can run above the localStorage shim —
// MindtreeTable.test.tsx explains the ordering problem this avoids.
import type { MindNode } from '../../lib/mindtree/model'
import type { MindDragController } from './DragLayer'

vi.hoisted(() => {
  // lib/i18n and store/mindtree read localStorage at module scope, store/config
  // adds a window focus listener at module scope, and lib/theme reads
  // matchMedia — all of them at IMPORT time, so the shims cannot wait for a
  // beforeAll(). pages/Board.test.tsx opens with the same block, for the same
  // three reasons, and this component reaches the same stores.
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

const { buildMindtree } = await import('../../lib/mindtree/model')
const { layoutMindtree } = await import('../../lib/mindtree/layout')
const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const i18n = await import('../../lib/i18n')
const DragLayerModule = await import('./DragLayer')
const { MindDragLayer, MindDropTargets, armedIndexIn, useMindDragLayer } = DragLayerModule

// PIN THE NAMESPACE ONTO THE BUNDLES. `src/locales/index.ts` now spreads
// `mindtree` into both, so this is a no-op in the ordinary case — kept because
// it is what makes the file independent of that registration surviving, and
// because it is not a mock: `t()` resolves against the bundle OBJECTS at call
// time, so assigning the namespace onto them is exactly what index.ts's spread
// does. Without a registration of some kind, `t()` echoes every unknown key and
// every assertion below would be comparing one echo against another.
const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/mindtree.json')).default)
Object.assign(locales.ar, (await import('../../locales/ar/mindtree.json')).default)

const TODAY = '2026-07-31'

function entry(over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry {
  return {
    track_id: 't-net',
    description: '',
    type: 'action',
    status: 'new',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: null,
    created_at: '2026-07-24T09:00:00.000Z',
    updated_at: '2026-07-24T09:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-24T09:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

const HEALTH = new Map<string, EntryHealth>()

const TRACKS = [
  { id: 't-net', label: 'Network', color: '#22b8d6', colorLight: null, sortOrder: 1, archived: false },
  { id: 't-pmo', label: 'PMO', color: '#f0a020', colorLight: null, sortOrder: 2, archived: false },
]

const STATUS_VOCAB = [
  { key: 'new', label: 'New', hidden: false },
  { key: 'blocked', label: 'Blocked', hidden: false },
]

// Three on Network's "New" branch, so a leaf threshold of 1 actually FOLDS the
// tail behind a "+N more" — model.ts only folds when the overflow is more than
// one, and that third kind must never be a target.
const ENTRIES = [
  entry({ id: 'e1', title: 'Firewall rule DC2' }),
  entry({ id: 'e2', title: 'MPLS circuit order', status: 'blocked' }),
  entry({ id: 'e3', title: 'Charter sign-off', track_id: 't-pmo' }),
  entry({ id: 'e4', title: 'Core switch RMA' }),
  entry({ id: 'e5', title: 'Patch window sign-off' }),
]

/** A leaf threshold of 1, so a "+N more" fold exists to be excluded. */
function tree(): MindNode {
  return buildMindtree({
    entries: ENTRIES,
    health: HEALTH,
    tracks: TRACKS,
    vocab: STATUS_VOCAB,
    members: [],
    dimension: 'status',
    filter: EMPTY_FILTER,
    ctx: { meId: null, today: TODAY },
    collapsedIds: new Set<string>(),
    leafThreshold: 1,
  })
}

const ROOT = tree()
const LAYOUT = layoutMindtree(ROOT)

function label(node: MindNode): string {
  return node.label.kind === 'key' ? node.label.key : node.label.text
}

/** Run the hook inside a render and hand the controller back. */
function controllerOf(layout = LAYOUT): MindDragController {
  let held: MindDragController | null = null
  function Probe(): null {
    held = useMindDragLayer({
      root: ROOT,
      layout,
      dimension: 'status',
      entryById: new Map(ENTRIES.map((e) => [e.id, e])),
      meId: null,
      role: 'member',
      rtl: false,
      focusedId: null,
      svgRef: { current: null },
      labelOf: label,
      onPanBy: () => {},
      onPanCancel: () => {},
    })
    return null
  }
  renderToStaticMarkup(<Probe />)
  if (held === null) throw new Error('the hook did not run')
  return held
}

/* ─────────────────────────────── the zones ───────────────────────────────── */

describe('the drop zones', () => {
  it('is every track and every group, and nothing else', () => {
    const zones = controllerOf().zones
    const kinds = new Set(
      zones.map((z) => LAYOUT.byId.get(z.nodeId)?.node.kind ?? 'missing'),
    )
    expect([...kinds].sort()).toEqual(['group', 'track'])
  })

  it('never offers the root, a leaf or a "+N more" fold as a target', () => {
    const zones = new Set(controllerOf().zones.map((z) => z.nodeId))
    const offered = LAYOUT.nodes
      .filter((pos) => zones.has(pos.id))
      .map((pos) => pos.node.kind)
    expect(offered).not.toContain('root')
    expect(offered).not.toContain('entry')
    expect(offered).not.toContain('more')
    // …and the fixture really does contain all three, so the assertion above is
    // about the filter rather than about an empty tree.
    const drawn = LAYOUT.nodes.map((pos) => pos.node.kind)
    expect(drawn).toContain('root')
    expect(drawn).toContain('entry')
    expect(drawn).toContain('more')
  })

  it('carries each zone at the position the layout gave it', () => {
    for (const zone of controllerOf().zones) {
      const pos = LAYOUT.byId.get(zone.nodeId)
      expect(pos).toBeDefined()
      expect([zone.x, zone.y, zone.width, zone.height]).toEqual([
        pos?.x,
        pos?.y,
        pos?.width,
        pos?.height,
      ])
    }
  })

  // REGRESSION — and the one that made the phone read-only. Everything DRAWN is
  // inside the drawn root by construction, so a drop onto it folds to a patch
  // every drawn row already satisfies: `evaluateDrop` answers `noop`, every
  // time. On a desktop that was one keyboard candidate that could only ever say
  // "it is already there". On a phone it was fatal — the compact map draws ONE
  // ring, so the root was the ONLY zone, `zones.length` was 1 rather than 0, and
  // `onNodePointerDown`'s "nowhere to drop" guard never fired. Every 420 ms hold
  // lifted a ghost, stole the pan that IS how that screen is read, and announced
  // a no-op.
  it('never offers the DRAWN root, however deep the drill-in', () => {
    const track = ROOT.children[0]
    expect(track?.kind).toBe('track')
    const drilled = layoutMindtree(track as MindNode)
    const zones = controllerOf(drilled).zones
    expect(zones.map((z) => z.nodeId)).not.toContain(track?.id)
    // The track IS drawn — it is the root of this layout — so the assertion is
    // about the exclusion and not about an absent node.
    expect(drilled.byId.has(track?.id ?? '')).toBe(true)
    // And its groups are still targets, so the drill-in is not simply inert.
    expect(zones.length).toBeGreaterThan(0)
  })

  it("gives the phone's one-ring entry ring NO targets at all, honestly", () => {
    // `pages/Mindtree` draws `depthLimit: 1` on a compact viewport. Drilled onto
    // a GROUP that is exactly: the group, and its entries. There is no branch
    // beside a leaf, so there is nothing to drop onto — and the layer must say
    // so with an empty set rather than offer the one node it is already inside.
    const group = ROOT.children[0]?.children[0]
    expect(group?.kind).toBe('group')
    const compact = layoutMindtree(group as MindNode, { depthLimit: 1 })
    expect(compact.nodes.map((p) => p.node.kind)).toContain('entry')
    expect(controllerOf(compact).zones).toEqual([])
  })

  it('starts idle: nothing lifted, no click to swallow', () => {
    const controller = controllerOf()
    expect(controller.active).toBe(false)
    expect(controller.lift).toBeNull()
    expect(controller.isPressing()).toBe(false)
    // The one click a finished drag suppresses. Nothing has been dragged, so a
    // tap on a node must reach the node.
    expect(controller.justDragged()).toBe(false)
    expect(controller.announcement.text).toBe('')
  })
})

/* ─────────────────────────────── the mount ───────────────────────────────── */

describe('the layer at rest', () => {
  const idle = controllerOf()

  it('draws nothing inside the map when nothing is lifted', () => {
    expect(renderToStaticMarkup(<MindDropTargets controller={idle} />)).toBe('')
  })

  it('renders the keyboard instructions, and no ghost', () => {
    const html = renderToStaticMarkup(<MindDragLayer controller={idle} />)
    expect(html).not.toContain('mtree-drag-ghost')
    expect(html).not.toContain('mtree-drag-bar')
    // The hint is present whether or not the page points `aria-describedby` at
    // it, so the sentence is reachable even if that wiring is missed.
    expect(html).toContain(`id="${idle.hintId}"`)
    expect(html).toContain('press Space on it')
    // An empty live region: a screen must not announce anything on arrival.
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('mindtree.')
  })
})

/* ───────────────────────────── the sentences ─────────────────────────────── */

describe('what a drag says out loud', () => {
  /** Every announcement this layer makes, rendered through the real bundles. */
  function said(locale: 'en' | 'ar'): Record<string, string> {
    const g = globalThis as unknown as Record<string, unknown>
    // setLocale() pushes dir/lang onto <html>; there is no document here, so
    // give it the one property applyLocale() touches.
    g.document = { documentElement: {} }
    i18n.setLocale(locale)
    try {
      return {
        grabbed: i18n.t('mindtree.dragGrabbed', { title: 'Firewall rule DC2' }),
        grabbedOne: i18n.t('mindtree.dragGrabbedMany', { count: 1 }),
        grabbedMany: i18n.t('mindtree.dragGrabbedMany', { count: 3 }),
        // The map's own node sentence, reused rather than duplicated — see
        // DragLayer.tsx's note at the announcement, and the collision gate in
        // lib/labelSections.test.ts that made it a rule.
        target: i18n.t('mindtree.nodeName', {
          label: 'Blocked',
          detail: i18n.t('mindtree.dragTargetOne'),
        }),
        targetMany: i18n.t('mindtree.dragTargetMany', { count: 3 }),
        moved: i18n.t('mindtree.dragMoved', { title: 'Firewall rule DC2', label: 'Blocked' }),
        movedMany: i18n.t('mindtree.dragMovedMany', { count: 3, label: 'Blocked' }),
        cancelled: i18n.t('mindtree.dragCancelled'),
        failed: i18n.t('mindtree.dragFailed'),
        hint: i18n.t('mindtree.dragKeyboardHint'),
        confirmBulk: i18n.t('mindtree.confirmBulkTitle', { count: 12 }),
        confirmBulkBody: i18n.t('mindtree.confirmBulkBody', { label: 'Done' }),
        confirmClose: i18n.t('mindtree.confirmCloseTitle', {
          title: 'Firewall rule DC2',
          label: 'Done',
        }),
        confirmCloseBody: i18n.t('mindtree.confirmCloseBody'),
        move: i18n.t('mindtree.confirmMove'),
      }
    } finally {
      i18n.setLocale('en')
    }
  }

  it.each(['en', 'ar'] as const)('%s: resolves every one of them', (locale) => {
    for (const [name, text] of Object.entries(said(locale))) {
      expect(text, name).not.toContain('mindtree.')
      expect(text.trim(), name).not.toBe('')
    }
  })

  it('inflects the counted ones rather than gluing an "s" on', () => {
    const en = said('en')
    // The bug lib/localeCounted.test.ts exists for: a call site that hands the
    // plural node a number under any name but `count` renders `other` for 1.
    expect(en.grabbedOne).toContain('1 item.')
    expect(en.grabbedMany).toContain('3 items.')
    expect(en.movedMany).toContain('3 items')
    expect(en.targetMany).toContain('3 items')
    expect(en.confirmBulk).toBe('Move 12 items?')
  })

  it('inflects them in Arabic too, where the categories are five', () => {
    const g = globalThis as unknown as Record<string, unknown>
    g.document = { documentElement: {} }
    i18n.setLocale('ar')
    try {
      // 2 is `two`, 3 is `few`, 12 is `many` — three different forms of one
      // sentence, which is the whole reason these are plural nodes.
      const two = i18n.t('mindtree.dragMovedMany', { count: 2, label: 'Blocked' })
      const few = i18n.t('mindtree.dragMovedMany', { count: 3, label: 'Blocked' })
      const many = i18n.t('mindtree.dragMovedMany', { count: 12, label: 'Blocked' })
      expect(new Set([two, few, many]).size).toBe(3)
      // The exact form spells the number out and drops the token; the range
      // forms must carry it, or the reader is told "some items moved".
      expect(two).not.toContain('{count}')
      expect(few).toContain('3')
      expect(many).toContain('12')
    } finally {
      i18n.setLocale('en')
    }
  })

  it('fences the values that can run the other way', () => {
    // A title or a branch label is user text and may be Arabic inside an English
    // sentence or the reverse. Unfenced, the bidi algorithm reorders it against
    // the words around it — the failure lib/bidi.ts exists for.
    const en = said('en')
    expect(en.moved).toContain('⁨Firewall rule DC2⁩')
    expect(en.moved).toContain('⁨Blocked⁩')
    expect(en.target).toContain('⁨Blocked⁩')
    expect(en.confirmClose).toContain('⁨Done⁩')
    const ar = said('ar')
    expect(ar.moved).toContain('⁨Firewall rule DC2⁩')
    expect(ar.confirmBulkBody).toContain('⁨Done⁩')
  })

  it('never says the same thing two ways', () => {
    // "It could not be moved", "nothing moved" and "it is already there" are
    // three different facts, and a reader who hears one when another is true
    // will go looking for work that did not move.
    const en = said('en')
    expect(new Set([en.cancelled, en.failed, i18n.t('mindtree.dropUnchanged')]).size).toBe(3)
  })
})

/* ───────────────── the keyboard's armed target, across a rebuild ─────────── */

// REGRESSION. The keyboard drag used to arm its target by ARRAY INDEX into a
// list rebuilt from the layout on every tree rebuild — and the tree is rebuilt
// on every realtime batch. A colleague filing one unrelated item into a
// previously-empty bucket INSERTS a candidate (`model.vocabGroups` emits
// POPULATED groups only) and shifts everything after it by one, so Enter wrote
// to a different branch than the one the highlight framed and the announcement
// named: aim at Network › Blocked, write "move to Network", status silently
// dropped. A removal shifts the other way and can land on a different track AND
// a different status. The pointer path was never exposed, because
// `MindDragSession.overNodeId` is an id re-resolved on every move.
describe('an armed keyboard target survives a rebuild by ID, not by slot', () => {
  const t1 = { id: 't1', label: 'One', color: '#111', colorLight: null, sortOrder: 1, archived: false }
  const t2 = { id: 't2', label: 'Two', color: '#222', colorLight: null, sortOrder: 2, archived: false }

  function candidates(entries: readonly Entry[]): string[] {
    const root = buildMindtree({
      entries: [...entries],
      health: HEALTH,
      tracks: [t1, t2],
      vocab: STATUS_VOCAB,
      members: [],
      dimension: 'status',
      filter: EMPTY_FILTER,
      ctx: { meId: null, today: TODAY },
      collapsedIds: new Set<string>(),
      leafThreshold: 50,
    })
    return layoutMindtree(root)
      .nodes.filter((pos) => (pos.node.kind === 'track' || pos.node.kind === 'group') && pos.depth > 0)
      .map((pos) => pos.id)
  }

  const before = candidates([
    entry({ id: 'a', title: 'A', track_id: 't1', status: 'new' }),
    entry({ id: 'b', title: 'B', track_id: 't2', status: 'blocked' }),
  ])
  // One realtime patch: somebody moves an unrelated item into t1's Blocked
  // bucket, which did not exist a moment ago.
  const after = candidates([
    entry({ id: 'a', title: 'A', track_id: 't1', status: 'new' }),
    entry({ id: 'b', title: 'B', track_id: 't2', status: 'blocked' }),
    entry({ id: 'c', title: 'C', track_id: 't1', status: 'blocked' }),
  ])

  it('reproduces the shift the defect rode on', () => {
    expect(before).toEqual([
      'root/track:t1',
      'root/track:t1/group:new',
      'root/track:t2',
      'root/track:t2/group:blocked',
    ])
    expect(after).toEqual([
      'root/track:t1',
      'root/track:t1/group:new',
      'root/track:t1/group:blocked',
      'root/track:t2',
      'root/track:t2/group:blocked',
    ])
    // The remembered slot now holds a DIFFERENT branch — a track rather than a
    // status bucket, which is what made the write drop the status.
    expect(after[3]).not.toBe(before[3])
  })

  it('still names the branch the reader armed', () => {
    const armed = before[3] as string
    expect(armedIndexIn(before.map((id) => ({ id })), armed)).toBe(3)
    expect(armedIndexIn(after.map((id) => ({ id })), armed)).toBe(4)
    expect(after[armedIndexIn(after.map((id) => ({ id })), armed)]).toBe(armed)
  })

  it('answers -1 when the armed branch has left the tree, so the drop refuses', () => {
    // t1's Blocked bucket empties again. The Enter arm treats -1 as "refuse with
    // mindtree.dropRefusedTarget" rather than as an offset into the new list.
    expect(armedIndexIn(before.map((id) => ({ id })), 'root/track:t1/group:blocked')).toBe(-1)
    expect(armedIndexIn(before.map((id) => ({ id })), null)).toBe(-1)
  })
})
