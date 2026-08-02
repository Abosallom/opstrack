// Proof for the node card: the arithmetic, and the geometry that keeps it off
// its own node.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — MindtreeTable.test.tsx,
// pages/Board.test.tsx and the entry kit's own test all open with that
// paragraph. That constraint shapes what is asserted here, honestly:
//
//   · `buildNodeCard` is the feature and it is a pure function, so every fact
//     the card can get WRONG — a miscounted breach, the wrong "oldest", an owner
//     ranked by a host-dependent collation — is checked directly, with no render
//     at all. That is why it is exported rather than inlined into the JSX.
//   · `placeNodeCard` is the rule that a card never covers the node it
//     describes. It is arithmetic by construction (see its header: the
//     block-size is capped rather than the box being measured), so the rule is
//     provable rather than eyeballed, and it is proved here for every side.
//   · The DELAY and the ESCAPE latch live in effects, which react-dom/server
//     does not run. What IS checkable server-side is the half that matters most:
//     the card is NOT in the first render's output. A card that appeared
//     instantly would strobe across a pan, and this is the assertion that would
//     catch a refactor initialising `shown` to true.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Entry, EntryHealth, HealthLevel } from '../../types'
// TYPE-only, so it is erased before it can run — which is what lets it sit above
// the localStorage shim without tripping the ordering problem that forces every
// VALUE import in this file to be dynamic.
import type { MindNode } from '../../lib/mindtree/model'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, and store/members registers a
  // `window` focus listener at module scope (the card reaches it for
  // `memberLabel`, which is the one place a person's display name may be
  // resolved). Neither can wait for a beforeAll(): the imports below run first.
  // The same three-line shim NotificationBell.test.tsx and FilterBar.test.tsx
  // open with, for the same reason.
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
})

const { buildMindtree } = await import('../../lib/mindtree/model')
const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const NodeCardModule = await import('./NodeCard')
const NodeCard = NodeCardModule.default
const { NODE_CARD_ID, NodeCardBody, buildNodeCard, dismissMindNodeCard, placeNodeCard } =
  NodeCardModule

// Register the namespace, exactly as MindtreeTable.test.tsx does and for the
// same reason: `t()` resolves against the bundle OBJECTS at call time, so
// assigning them here is precisely what locales/index.ts's spread will do. Skip
// it and t() echoes every key, and an assertion comparing one echoed key to
// another passes no matter what the component did.
const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/mindtree.json')).default)
Object.assign(locales.ar, (await import('../../locales/ar/mindtree.json')).default)

/** A fixed workspace day, so every age below is an arithmetic assertion. */
const TODAY = '2026-07-31'
const NOW = new Date('2026-07-31T09:00:00.000Z')

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

function health(id: string, over: Partial<EntryHealth> = {}): EntryHealth {
  return {
    id,
    entry_id: id,
    track_id: null,
    status: 'new',
    priority: 'medium',
    due_date: null,
    last_activity_at: '2026-07-24T09:00:00.000Z',
    days_since_activity: 7,
    days_overdue: 0,
    health: 'ok' as HealthLevel,
    sla_due_at: null,
    sla_breached: false,
    ...over,
  }
}

const TRACKS = [
  { id: 't-net', label: 'Network', color: '#47b1d8', colorLight: null, sortOrder: 1, archived: false },
]

const MEMBERS = [
  { id: 'm-1', displayName: 'Reem' },
  { id: 'm-2', displayName: 'Aziz' },
  { id: 'm-3', displayName: 'Bilal' },
  { id: 'm-4', displayName: 'Dana' },
]

const MEMBER_MAP = new Map(
  MEMBERS.map((m) => [m.id, { id: m.id, displayName: m.displayName, role: 'member' as const }]),
)

const VOCAB = [
  { key: 'new', label: 'New', hidden: false },
  { key: 'in_progress', label: 'In progress', hidden: false },
  { key: 'blocked', label: 'Blocked', hidden: false },
]

/** The label a real `useVocabLabel()` would give — enough for these assertions. */
const vocabLabel = (_kind: string, key: string): string =>
  VOCAB.find((v) => v.key === key)?.label ?? key

function tree(entries: Entry[], healthRows: EntryHealth[] = []) {
  return buildMindtree({
    entries,
    health: new Map(healthRows.map((h) => [h.entry_id, h])),
    tracks: TRACKS,
    vocab: VOCAB,
    members: MEMBERS,
    dimension: 'status',
    filter: EMPTY_FILTER,
    ctx: { meId: 'm-1', today: TODAY },
    collapsedIds: new Set<string>(),
    leafThreshold: 6,
  })
}

function ctxFor(entries: Entry[], dimension: 'status' | 'owner' = 'status') {
  return {
    entryById: new Map(entries.map((e) => [e.id, e])),
    memberById: MEMBER_MAP,
    vocabLabel,
    dimension,
    today: TODAY,
    locale: 'en' as const,
    now: NOW,
  }
}

function trackNode(root: MindNode): MindNode {
  const found = root.children.find((c) => c.bucketKey === 't-net')
  if (found === undefined) throw new Error('fixture has no Network track')
  return found
}

function leafOf(root: MindNode, entryId: string): MindNode {
  const walk = (node: MindNode): MindNode | null => {
    if (node.entryId === entryId) return node
    for (const child of node.children) {
      const hit = walk(child)
      if (hit !== null) return hit
    }
    return null
  }
  const found = walk(root)
  if (found === null) throw new Error(`fixture has no leaf for ${entryId}`)
  return found
}

/* ─────────────────────────── the branch card ──────────────────────────── */

describe('buildNodeCard — a branch', () => {
  const rows = [
    entry({ id: 'e-1', title: 'Rack elevation', owner_id: 'm-1', created_at: '2026-07-01T09:00:00.000Z' }),
    entry({ id: 'e-2', title: 'Switch firmware', owner_id: 'm-1' }),
    entry({ id: 'e-3', title: 'Cable audit', owner_id: 'm-2' }),
    entry({ id: 'e-4', title: 'Nobody owns me' }),
  ]
  const root = tree(rows, [health('e-2', { sla_breached: true })])

  it('totals open, unassigned and breached over the WHOLE subtree', () => {
    const card = buildNodeCard(trackNode(root), ctxFor(rows))
    expect(card.kind).toBe('branch')
    expect(card.stats.map((s) => [s.labelKey, s.value])).toEqual([
      ['mindtree.colOpen', 4],
      ['mindtree.colUnassigned', 1],
      ['mindtree.colBreached', 1],
    ])
  })

  it('tones the two numbers that are a problem, and only when they are', () => {
    const card = buildNodeCard(trackNode(root), ctxFor(rows))
    expect(card.stats.map((s) => s.tone)).toEqual(['plain', 'warn', 'bad'])

    const clean = [entry({ id: 'e-9', title: 'All good', owner_id: 'm-1' })]
    const quiet = buildNodeCard(trackNode(tree(clean)), ctxFor(clean))
    expect(quiet.stats.map((s) => s.tone)).toEqual(['plain', 'plain', 'plain'])
  })

  it('names the entry that has been open longest, with its age', () => {
    const card = buildNodeCard(trackNode(root), ctxFor(rows))
    const oldest = card.rows.find((r) => r.key === 'oldest')
    expect(oldest?.value).toBe('Rack elevation')
    // 2026-07-01 → 2026-07-31 is 30 days, measured from created_at.
    expect(oldest?.suffix).toContain('30')
  })

  it('ranks owners by load and leaves the unassigned pile to the stat above', () => {
    const card = buildNodeCard(trackNode(root), ctxFor(rows))
    expect(card.owners.map((o) => [o.name, o.count])).toEqual([
      ['Reem', 2],
      ['Aziz', 1],
    ])
    expect(card.owners.some((o) => o.key === '')).toBe(false)
  })

  it('breaks a tie on the folded name, never on the host collation', () => {
    // Four people holding one item each. A sort with no tiebreak leaves them in
    // Map insertion order, which is the tree's order — and the tree's order is
    // the roster's, so the bug hides until a roster is re-ordered. The names are
    // inserted in reverse so insertion order cannot pass this by accident.
    const many = [
      entry({ id: 'a-1', title: 'One', owner_id: 'm-4' }),
      entry({ id: 'a-2', title: 'Two', owner_id: 'm-3' }),
      entry({ id: 'a-3', title: 'Three', owner_id: 'm-2' }),
      entry({ id: 'a-4', title: 'Four', owner_id: 'm-1' }),
    ]
    const card = buildNodeCard(trackNode(tree(many)), ctxFor(many))
    expect(card.owners.map((o) => o.name)).toEqual(['Aziz', 'Bilal', 'Dana'])
    expect(card.moreOwners).toBe(1)
  })

  it('keeps a free-text owner as its own person, spelled as it was typed', () => {
    const vendor = [entry({ id: 'v-1', title: 'Vendor job', owner_name: 'Acme Ltd' })]
    const card = buildNodeCard(trackNode(tree(vendor)), ctxFor(vendor))
    expect(card.owners.map((o) => o.name)).toEqual(['Acme Ltd'])
    expect(card.stats[1]?.value).toBe(0)
  })

  it('counts what is behind a collapsed branch and a "+N more" fold', () => {
    // Eight rows against a threshold of six: the tail folds, and the fold is
    // closed. The card must still say eight — a number that changed when the
    // reader clicked a chevron would be describing the picture, not the work.
    const many = Array.from({ length: 8 }, (_, i) =>
      entry({ id: `m-${i}`, title: `Item ${i}`, owner_id: 'm-1' }),
    )
    const root8 = tree(many)
    const group = trackNode(root8).children[0]
    expect(group?.children.some((c) => c.kind === 'more' && c.collapsed)).toBe(true)
    expect(buildNodeCard(trackNode(root8), ctxFor(many)).stats[0]?.value).toBe(8)
    expect(buildNodeCard(trackNode(root8), ctxFor(many)).owners[0]?.count).toBe(8)
  })

  it('drops the owner list under the owner axis, where it would be one name', () => {
    const owned = [entry({ id: 'o-1', title: 'Mine', owner_id: 'm-1' })]
    const byOwner = buildMindtree({
      entries: owned,
      health: new Map(),
      tracks: TRACKS,
      vocab: [],
      members: MEMBERS,
      dimension: 'owner',
      filter: EMPTY_FILTER,
      ctx: { meId: 'm-1', today: TODAY },
      collapsedIds: new Set<string>(),
      leafThreshold: 6,
    })
    const group = trackNode(byOwner).children[0]
    expect(group).toBeDefined()
    if (group === undefined) return
    expect(buildNodeCard(group, ctxFor(owned, 'owner')).owners).toEqual([])
    // The TRACK above it still lists them: a track holds many owners on every axis.
    expect(buildNodeCard(trackNode(byOwner), ctxFor(owned, 'owner')).owners).toHaveLength(1)
  })

  it('says so when an active track is holding nothing at all', () => {
    const empty = buildNodeCard(trackNode(tree([])), ctxFor([]))
    expect(empty.empty).toBe(true)
    expect(empty.stats[0]?.value).toBe(0)
    expect(empty.rows).toEqual([])
  })

  it('survives an entry the working set no longer explains', () => {
    // A tree built from rows that have since been pruned. The row loses its
    // facts; the card does not lose the screen.
    const rowsGone = [entry({ id: 'g-1', title: 'Ghost', owner_id: 'm-1' })]
    const card = buildNodeCard(trackNode(tree(rowsGone)), {
      ...ctxFor(rowsGone),
      entryById: new Map(),
    })
    expect(card.stats[0]?.value).toBe(1)
    expect(card.owners).toEqual([])
    expect(card.rows).toEqual([])
  })
})

/* ──────────────────────────── the leaf card ───────────────────────────── */

describe('buildNodeCard — a leaf', () => {
  it('reads status, owner, due, age and the last update, in that order', () => {
    const rows = [
      entry({
        id: 'l-1',
        title: 'Switch firmware',
        status: 'blocked',
        owner_id: 'm-2',
        due_date: '2026-08-04',
        created_at: '2026-07-21T09:00:00.000Z',
        last_activity_at: '2026-07-31T06:00:00.000Z',
      }),
    ]
    const card = buildNodeCard(leafOf(tree(rows), 'l-1'), ctxFor(rows))
    expect(card.kind).toBe('leaf')
    expect(card.title).toBe('Switch firmware')
    expect(card.rows.map((r) => r.key)).toEqual(['status', 'owner', 'due', 'age', 'activity'])
    // Off the LIVE vocabulary, so an admin's rename reaches this row with no
    // write in this file — the frozen-key payoff store/vocab.ts was built for.
    expect(card.rows[0]?.value).toBe('Blocked')
    expect(card.rows[1]?.value).toBe('Aziz')
    expect(card.rows[3]?.value).toContain('10')
    // 09:00 minus 06:00 on the same day — hours, not a date.
    expect(card.rows[4]?.value).toContain('3')
  })

  it('marks an unowned item and an overdue one, and nothing else', () => {
    const rows = [entry({ id: 'l-2', title: 'Nobody', due_date: '2026-07-25' })]
    const card = buildNodeCard(leafOf(tree(rows), 'l-2'), ctxFor(rows))
    expect(card.rows.find((r) => r.key === 'owner')?.tone).toBe('warn')
    expect(card.rows.find((r) => r.key === 'due')?.tone).toBe('bad')
    expect(card.rows.find((r) => r.key === 'age')?.tone).toBe('plain')
  })

  it('does not call a due date in the future overdue', () => {
    const rows = [entry({ id: 'l-3', title: 'Later', due_date: '2026-08-20', owner_id: 'm-1' })]
    const card = buildNodeCard(leafOf(tree(rows), 'l-3'), ctxFor(rows))
    expect(card.rows.find((r) => r.key === 'due')?.tone).toBe('plain')
  })

  it('carries the breach through from the node, not from a second lookup', () => {
    const rows = [entry({ id: 'l-4', title: 'Late', owner_id: 'm-1' })]
    const root = tree(rows, [health('l-4', { sla_breached: true })])
    expect(buildNodeCard(leafOf(root, 'l-4'), ctxFor(rows)).breached).toBe(true)
  })

  it('falls back to a readable title rather than an empty heading', () => {
    const rows = [entry({ id: 'l-5', title: '   ' })]
    const card = buildNodeCard(leafOf(tree(rows), 'l-5'), ctxFor(rows))
    expect(card.title.trim()).not.toBe('')
  })
})

/* ───────────────────────────── the placement ──────────────────────────── */

const CANVAS = { width: 900, height: 520 }

describe('placeNodeCard', () => {
  it('hangs below a node in the top half, flush against its edge', () => {
    const placed = placeNodeCard({ x: 400, y: 40, width: 160, height: 44 }, CANVAS)
    expect(placed?.side).toBe('below')
    expect(placed?.flip).toBe('0%')
    expect(placed?.y).toBe(40 + 44 + 8)
  })

  it('hangs above a node in the bottom half, flush against its edge', () => {
    const placed = placeNodeCard({ x: 400, y: 430, width: 160, height: 44 }, CANVAS)
    expect(placed?.side).toBe('above')
    expect(placed?.flip).toBe('-100%')
    expect(placed?.y).toBe(430 - 8)
  })

  it('NEVER overlaps the node it describes, at any block position', () => {
    // The rule the whole component exists to keep. Swept rather than sampled:
    // a card that covers its own subject fires pointerleave on the node beneath
    // it, which unmounts the card, which un-covers the node — a flicker loop at
    // frame rate.
    for (let y = 0; y <= CANVAS.height - 44; y += 4) {
      const anchor = { x: 400, y, width: 160, height: 44 }
      const placed = placeNodeCard(anchor, CANVAS)
      if (placed === null) continue
      const top = placed.side === 'below' ? placed.y : placed.y - placed.room
      const bottom = placed.side === 'below' ? placed.y + placed.room : placed.y
      expect(bottom, `y=${y}`).toBeLessThanOrEqual(
        placed.side === 'above' ? anchor.y : CANVAS.height,
      )
      expect(top, `y=${y}`).toBeGreaterThanOrEqual(
        placed.side === 'below' ? anchor.y + anchor.height : 0,
      )
    }
  })

  it('never lets the card leave the canvas, on either axis', () => {
    for (let y = 0; y <= CANVAS.height - 44; y += 8) {
      for (const x of [0, 12, 380, 740, CANVAS.width - 160]) {
        const placed = placeNodeCard({ x, y, width: 160, height: 44 }, CANVAS)
        if (placed === null) continue
        expect(placed.x, `x=${x}`).toBeGreaterThanOrEqual(8)
        expect(placed.x, `x=${x}`).toBeLessThanOrEqual(CANVAS.width - 8)
        const top = placed.side === 'below' ? placed.y : placed.y - placed.room
        const bottom = placed.side === 'below' ? placed.y + placed.room : placed.y
        expect(top, `y=${y}`).toBeGreaterThanOrEqual(0)
        expect(bottom, `y=${y}`).toBeLessThanOrEqual(CANVAS.height)
      }
    }
  })

  it('centres on the node when there is room, and clamps when there is not', () => {
    expect(placeNodeCard({ x: 400, y: 40, width: 160, height: 44 }, CANVAS)?.x).toBe(
      400 + 80 - 138,
    )
    expect(placeNodeCard({ x: 0, y: 40, width: 60, height: 44 }, CANVAS)?.x).toBe(8)
    expect(placeNodeCard({ x: 860, y: 40, width: 40, height: 44 }, CANVAS)?.x).toBe(
      CANVAS.width - 276 - 8,
    )
  })

  it('degrades to the start edge on a canvas narrower than the card', () => {
    // The sheet caps the card at `100% - 16px`, so it still fits; what must not
    // happen is a negative offset putting it off screen entirely.
    const placed = placeNodeCard({ x: 10, y: 20, width: 100, height: 44 }, { width: 200, height: 400 })
    expect(placed?.x).toBe(8)
  })

  it('draws nothing when there is nowhere to put it', () => {
    // A node very nearly filling the canvas. A 40px sliver of a card is worse
    // than its absence.
    expect(placeNodeCard({ x: 10, y: 30, width: 200, height: 200 }, { width: 300, height: 280 })).toBeNull()
  })

  it('prefers below on a tie, which is reading order', () => {
    // Equal room either side: 520 tall, a 44 node centred.
    const placed = placeNodeCard({ x: 400, y: 238, width: 160, height: 44 }, CANVAS)
    expect(placed?.side).toBe('below')
  })
})

/* ───────────────────────────── the component ──────────────────────────── */

describe('NodeCard', () => {
  const rows = [entry({ id: 'c-1', title: 'Rack elevation', owner_id: 'm-1' })]
  const root = tree(rows)

  const props = {
    node: trackNode(root),
    anchor: { x: 400, y: 40, width: 160, height: 44 },
    canvas: CANVAS,
    dragging: false,
    entryById: new Map(rows.map((e) => [e.id, e])),
    memberById: MEMBER_MAP,
    vocabLabel,
    dimension: 'status' as const,
    today: TODAY,
  }

  it('is absent from the first render — the delay is real', () => {
    // The one half of the timing contract react-dom/server can see, and the
    // assertion that would catch `useState(true)`. A card that appeared
    // instantly would strobe across every pan, because the pointer crosses nodes
    // in transit constantly on a pan surface.
    expect(renderToStaticMarkup(<NodeCard {...props} />)).toBe('')
  })

  it('stays absent while a drag is in flight', () => {
    expect(renderToStaticMarkup(<NodeCard {...props} dragging />)).toBe('')
  })

  it('reports no open card to a keydown handler when none is mounted', () => {
    // pages/Mindtree.tsx's Escape branch calls this FIRST and yields if it is
    // true. If it lied, Escape would stop stepping out of a drill-in.
    expect(dismissMindNodeCard()).toBe(false)
  })

  it('publishes one stable id for aria-describedby', () => {
    expect(NODE_CARD_ID).toBe('mtree-node-card')
  })
})

/* ─────────────────────────────── the markup ───────────────────────────── */
//
// `NodeCardBody` is exported precisely so this block can exist: the timing and
// the placement are invisible to react-dom/server, but the words are not.

describe('NodeCardBody', () => {
  it('isolates every database string it prints', () => {
    // A track name, a person's name and an entry title are free text in any
    // script. Beside a number or a comma, an un-isolated Arabic run reorders the
    // sentence around it — the failure lib/bidi exists for, and the one that is
    // invisible in an English render.
    const rows = [
      entry({ id: 'b-1', title: 'تركيب المفاتيح', owner_id: 'm-1', created_at: '2026-07-01T09:00:00.000Z' }),
    ]
    const html = renderToStaticMarkup(
      <NodeCardBody model={buildNodeCard(trackNode(tree(rows)), ctxFor(rows))} />,
    )
    expect(html).toContain('⁨تركيب المفاتيح⁩')
    expect(html).toContain('⁨Reem⁩')
  })

  it('prints the three numbers with their tones', () => {
    const rows = [
      entry({ id: 'b-2', title: 'One', owner_id: 'm-1' }),
      entry({ id: 'b-3', title: 'Two' }),
    ]
    const html = renderToStaticMarkup(
      <NodeCardBody
        model={buildNodeCard(trackNode(tree(rows, [health('b-2', { sla_breached: true })])), ctxFor(rows))}
      />,
    )
    expect(html).toContain('data-tone="warn"')
    expect(html).toContain('data-tone="bad"')
    expect(html).toContain('Unassigned')
    expect(html).toContain('Past deadline')
  })

  it('says an archived branch is archived and a breached one is breached', () => {
    const rows = [entry({ id: 'b-4', title: 'Late', owner_id: 'm-1' })]
    const root = tree(rows, [health('b-4', { sla_breached: true })])
    const node = trackNode(root)
    const html = renderToStaticMarkup(
      <NodeCardBody model={{ ...buildNodeCard(node, ctxFor(rows)), retired: true }} />,
    )
    expect(html).toContain('Archived')
    expect(html).toContain('Past its service deadline')
  })

  it('says "All clear" for a track holding nothing, and prints no empty lists', () => {
    const html = renderToStaticMarkup(
      <NodeCardBody model={buildNodeCard(trackNode(tree([])), ctxFor([]))} />,
    )
    expect(html).toContain('All clear')
    expect(html).not.toContain('mtree-card-rows')
    expect(html).not.toContain('mtree-card-owners')
  })

  it('names the owner tail as a count rather than dropping it silently', () => {
    const many = [
      entry({ id: 'z-1', title: 'One', owner_id: 'm-1' }),
      entry({ id: 'z-2', title: 'Two', owner_id: 'm-2' }),
      entry({ id: 'z-3', title: 'Three', owner_id: 'm-3' }),
      entry({ id: 'z-4', title: 'Four', owner_id: 'm-4' }),
    ]
    const html = renderToStaticMarkup(
      <NodeCardBody model={buildNodeCard(trackNode(tree(many)), ctxFor(many))} />,
    )
    expect(html).toContain('Who is carrying it')
    expect(html).toContain('+1 other')
  })

  it('lays a leaf out as five term/value pairs', () => {
    const rows = [
      entry({ id: 'z-5', title: 'Switch firmware', status: 'blocked', owner_id: 'm-2', due_date: '2026-08-04' }),
    ]
    const html = renderToStaticMarkup(
      <NodeCardBody model={buildNodeCard(leafOf(tree(rows), 'z-5'), ctxFor(rows))} />,
    )
    expect(html.match(/<dt/g)).toHaveLength(5)
    expect(html.match(/<dd/g)).toHaveLength(5)
    expect(html).toContain('Last update')
    // A leaf carries no stat row: its count is 1 by definition, and three
    // numbers that are always 1/0/0 would be noise on every item.
    expect(html).not.toContain('mtree-card-stats')
  })
})
