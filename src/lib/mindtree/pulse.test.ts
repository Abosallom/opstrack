// Contract tests for the Mindtree's watch layer.
//
// No DOM, no timers, no `matchMedia`, no realtime: pulse.ts takes changes, a
// tree and a number called `now`, and returns a map. Every case below is an
// assertion about that map — which is the entire reason the module refuses to
// own a clock. The alternative is a feature you can only test by opening the app
// and hoping a teammate edits something while you are looking at it.
//
// THE FOUR PROPERTIES, and the screen each one protects:
//
//   · RESOLVED — a change under a collapsed branch pulses THE BRANCH. The map
//     opens at the track ring, so the node that changed usually has no pixels;
//     lighting it would be lighting nothing.
//   · COALESCED — twenty changes in one second is one calm redraw. A tree gets
//     most of this for free (twenty entries under one track are one node) and
//     the rest by climbing.
//   · CAPPED — never more than PULSE_MAX at once, and a bulk event animates
//     nothing at all, exactly as Board.tsx decides it.
//   · QUIET UNDER REDUCED MOTION — the flag arrives as an argument, so this is
//     one assertion rather than a browser preference nobody re-checks.
//
// `T` is an arbitrary fixed instant. Nothing here reads Date.now(), so its value
// is irrelevant beyond being the same in every case.

import { describe, expect, it } from 'vitest'
import {
  EMPTY_PULSES,
  PULSE_CEILING_MS,
  PULSE_MAX,
  PULSE_MS,
  PULSE_STALE_MS,
  breachChanges,
  closedChanges,
  entryChange,
  expirePulses,
  nodeChange,
  planPulses,
  pulseKindFromFlash,
  type PulseChange,
  type PulseMap,
} from './pulse'
import { ROOT_ID, type MindNode } from './model'

const T = 1_800_000_000_000

/* ── fixtures ───────────────────────────────────────────────────────────── */

function node(
  parent: string | null,
  kind: MindNode['kind'],
  key: string,
  children: MindNode[] = [],
  over: Partial<MindNode> = {},
): MindNode {
  const id =
    parent === null
      ? ROOT_ID
      : kind === 'more'
        ? `${parent}/more`
        : `${parent}/${kind}:${encodeURIComponent(key)}`
  const breached = over.health?.slaBreached ?? false
  return {
    id,
    kind,
    label: { kind: 'text', text: key },
    count: children.length,
    colourVars: {},
    health: { levels: { ok: 0, stale: 0, overdue: 0, critical: 0 }, slaBreached: breached },
    children,
    collapsed: false,
    depth: 0,
    entryId: kind === 'entry' ? key : null,
    bucketKey: kind === 'track' || kind === 'group' ? key : null,
    entityType: null,
    retired: false,
    ...over,
  }
}

/** root ─ track:t1 ─ group:open ─ [entry:e1, entry:e2]. */
function tree(over: { collapsedTrack?: boolean; breached?: readonly string[] } = {}): MindNode {
  const breached = new Set(over.breached ?? [])
  const mark = (id: string): Partial<MindNode> =>
    breached.has(id)
      ? { health: { levels: { ok: 0, stale: 0, overdue: 0, critical: 0 }, slaBreached: true } }
      : {}

  const g = 'root/track:t1/group:open'
  const leaves = [
    node(g, 'entry', 'e1', [], mark('e1')),
    node(g, 'entry', 'e2', [], mark('e2')),
  ]
  const group = node('root/track:t1', 'group', 'open', leaves, mark('open'))
  const track = node(ROOT_ID, 'track', 't1', [group], {
    collapsed: over.collapsedTrack ?? false,
    ...mark('t1'),
  })
  return node(null, 'root', 'root', [track], mark('root'))
}

const T1 = 'root/track:t1'
const G = 'root/track:t1/group:open'
const E1 = 'root/track:t1/group:open/entry:e1'
const E2 = 'root/track:t1/group:open/entry:e2'

/** A wide tree: `tracks` tracks, each with `groups` groups holding one entry. */
function wide(tracks: number, groups: number): MindNode {
  const trackNodes: MindNode[] = []
  for (let i = 0; i < tracks; i++) {
    const tid = `${ROOT_ID}/track:t${i}`
    const groupNodes: MindNode[] = []
    for (let g = 0; g < groups; g++) {
      const gid = `${tid}/group:g${g}`
      groupNodes.push(node(tid, 'group', `g${g}`, [node(gid, 'entry', `e${i}-${g}`)]))
    }
    trackNodes.push(node(ROOT_ID, 'track', `t${i}`, groupNodes))
  }
  return node(null, 'root', 'root', trackNodes)
}

function plan(over: Partial<Parameters<typeof planPulses>[0]> = {}): PulseMap {
  return planPulses({ changes: [], tree: tree(), now: T, ...over })
}

function ids(map: PulseMap): string[] {
  return [...map.keys()].sort()
}

/* ── resolution ─────────────────────────────────────────────────────────── */

describe('resolving a change to a node that is actually drawn', () => {
  it('pulses the entry when the entry is on screen', () => {
    const map = plan({ changes: [entryChange('e1', 'updated', T)] })
    expect(ids(map)).toEqual([E1])
    expect(map.get(E1)?.kind).toBe('updated')
  })

  it('pulses the COLLAPSED BRANCH when the entry is not on screen', () => {
    // The default map opens at the track ring, so this is the common case, not
    // the edge case.
    const map = plan({ tree: tree({ collapsedTrack: true }), changes: [entryChange('e1', 'updated', T)] })
    expect(ids(map)).toEqual([T1])
  })

  it('drops a change about an entry the tree does not hold', () => {
    // Filtered out, or closed and gone. Nothing on screen represents it.
    expect(plan({ changes: [entryChange('ghost', 'updated', T)] }).size).toBe(0)
  })

  it('carries a node-targeted change out to the nearest drawn ancestor', () => {
    const map = plan({
      tree: tree({ collapsedTrack: true }),
      changes: [nodeChange(G, 'breached', T)],
    })
    expect(ids(map)).toEqual([T1])
  })

  it('NEVER pulses the root — that is the whole map convulsing', () => {
    const map = plan({ changes: [nodeChange(ROOT_ID, 'breached', T)] })
    expect(map.size).toBe(0)
  })

  it('never pulses the drawn root of a focused subtree either', () => {
    // After a drill-in the drawn root is a track, and it is just as wrong to
    // flash the entire canvas.
    const drawn = tree().children[0]
    expect(drawn).toBeDefined()
    const map = planPulses({ changes: [nodeChange(T1, 'breached', T)], tree: drawn!, now: T })
    expect(map.size).toBe(0)
  })
})

/* ── coalescing ─────────────────────────────────────────────────────────── */

describe('coalescing', () => {
  it('folds twenty changes under one collapsed track into ONE pulse', () => {
    const changes: PulseChange[] = []
    for (let i = 0; i < 20; i++) changes.push(entryChange(i % 2 === 0 ? 'e1' : 'e2', 'updated', T))
    const map = plan({ tree: tree({ collapsedTrack: true }), changes })
    expect(ids(map)).toEqual([T1])
  })

  it('keeps the higher-precedence kind when several land on one node', () => {
    const map = plan({
      tree: tree({ collapsedTrack: true }),
      changes: [
        entryChange('e1', 'updated', T),
        entryChange('e2', 'breached', T),
        entryChange('e1', 'added', T),
      ],
    })
    expect(map.get(T1)?.kind).toBe('breached')
  })

  it('ranks escalation over load over progress over chatter', () => {
    const pairs: readonly [PulseChange['kind'], PulseChange['kind'], PulseChange['kind']][] = [
      ['breached', 'added', 'breached'],
      ['added', 'closed', 'added'],
      ['closed', 'updated', 'closed'],
    ]
    for (const [a, b, winner] of pairs) {
      const map = plan({
        tree: tree({ collapsedTrack: true }),
        changes: [entryChange('e1', a, T), entryChange('e2', b, T)],
      })
      expect(map.get(T1)?.kind).toBe(winner)
      // Order of arrival must not matter.
      const flipped = plan({
        tree: tree({ collapsedTrack: true }),
        changes: [entryChange('e2', b, T), entryChange('e1', a, T)],
      })
      expect(flipped.get(T1)?.kind).toBe(winner)
    }
  })
})

/* ── the cap ────────────────────────────────────────────────────────────── */

describe('the cap', () => {
  it('climbs PAST a ring that did not reduce the count', () => {
    // Two tracks × four groups, one entry each: eight changed entries, over the
    // cap of six. The first climb lands on eight GROUPS — no reduction at all,
    // because each group holds exactly one entry — and the second lands on two
    // tracks, which fits.
    //
    // THE REGRESSION THIS LOCKS: bailing out when a pass fails to reduce the
    // count. It reads like a sensible termination guard and it is wrong — a 1:1
    // ring is the common shape on a quiet week, and giving up there shows the
    // reader nothing when two calm pulses were available one ring further up.
    // Termination comes from ids getting strictly shorter, not from the count.
    const t = wide(2, 4)
    const changes: PulseChange[] = []
    for (let i = 0; i < 2; i++) {
      for (let g = 0; g < 4; g++) changes.push(entryChange(`e${i}-${g}`, 'updated', T))
    }
    const map = plan({ tree: t, changes })
    expect(ids(map)).toEqual(['root/track:t0', 'root/track:t1'])
  })

  it('animates NOTHING when even the top ring does not fit', () => {
    // Eight tracks changing at once is a filter change, a first load or a bulk
    // commit — Board.tsx's judgement, inherited: not an event.
    const t = wide(8, 1)
    const changes: PulseChange[] = []
    for (let i = 0; i < 8; i++) changes.push(entryChange(`e${i}-0`, 'updated', T))
    expect(plan({ tree: t, changes }).size).toBe(0)
  })

  it('holds the merged map to the cap however many batches arrive', () => {
    const t = wide(8, 1)
    let map: PulseMap = EMPTY_PULSES
    for (let i = 0; i < 8; i++) {
      map = plan({ tree: t, changes: [entryChange(`e${i}-0`, 'updated', T + i)], active: map, now: T + i })
      expect(map.size).toBeLessThanOrEqual(PULSE_MAX)
    }
    expect(map.size).toBe(PULSE_MAX)
  })

  it('keeps the freshest pulses when it has to trim', () => {
    const t = wide(8, 1)
    let map: PulseMap = EMPTY_PULSES
    for (let i = 0; i < 8; i++) {
      map = plan({ tree: t, changes: [entryChange(`e${i}-0`, 'updated', T + i)], active: map, now: T + i })
    }
    // One change per batch, so each fits on its own and lands on the entry
    // itself. The two that pulsed longest ago are the ones trimmed.
    const leaf = (i: number): string => `root/track:t${i}/group:g0/entry:e${i}-0`
    expect(map.has(leaf(0))).toBe(false)
    expect(map.has(leaf(1))).toBe(false)
    expect(map.has(leaf(7))).toBe(true)
  })

  it('honours an explicit max, including zero', () => {
    const changes = [entryChange('e1', 'updated', T)]
    expect(plan({ changes, max: 0 }).size).toBe(0)
    expect(plan({ changes, max: 1 }).size).toBe(1)
  })
})

/* ── time ───────────────────────────────────────────────────────────────── */

describe('time', () => {
  it('sets a deadline per kind', () => {
    for (const kind of ['breached', 'added', 'closed', 'updated'] as const) {
      const map = plan({ changes: [entryChange('e1', kind, T)] })
      expect(map.get(E1)?.until).toBe(T + PULSE_MS[kind])
    }
  })

  it('gives a breach the longest look — it is the one nobody did anything to cause', () => {
    expect(PULSE_MS.breached).toBeGreaterThan(PULSE_MS.added)
    expect(PULSE_MS.breached).toBeGreaterThan(PULSE_MS.updated)
  })

  it('IGNORES stale changes, so a resync does not light the whole workspace', () => {
    // api/realtime.ts emits a resync after a reconnect; store/entries.ts answers
    // with a full refetch and every row lands at once carrying its real time.
    const map = plan({ changes: [entryChange('e1', 'updated', T - PULSE_STALE_MS - 1)] })
    expect(map.size).toBe(0)
  })

  it('accepts a change from within the staleness window', () => {
    expect(plan({ changes: [entryChange('e1', 'updated', T - PULSE_STALE_MS + 1)] }).size).toBe(1)
  })

  it('ignores a change dated far in the future by a disagreeing clock', () => {
    expect(plan({ changes: [entryChange('e1', 'updated', T + PULSE_STALE_MS + 1)] }).size).toBe(0)
  })

  it('ignores a change with a non-finite timestamp', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(plan({ changes: [entryChange('e1', 'updated', bad)] }).size).toBe(0)
    }
  })

  it('extends a node under sustained traffic rather than re-triggering it', () => {
    const first = plan({ changes: [entryChange('e1', 'updated', T)] })
    const second = plan({ changes: [entryChange('e1', 'updated', T + 200)], active: first, now: T + 200 })
    expect(second.get(E1)?.until).toBeGreaterThan(first.get(E1)?.until ?? 0)
  })

  it('never lets a busy branch glow past the ceiling', () => {
    let map: PulseMap = EMPTY_PULSES
    for (let i = 0; i < 40; i++) {
      const now = T + i * 50
      map = plan({ changes: [entryChange('e1', 'breached', now)], active: map, now })
      expect((map.get(E1)?.until ?? 0) - now).toBeLessThanOrEqual(PULSE_CEILING_MS)
    }
  })

  it('does not downgrade a running pulse to a lower-precedence kind', () => {
    const first = plan({ changes: [entryChange('e1', 'breached', T)] })
    const second = plan({ changes: [entryChange('e1', 'updated', T + 100)], active: first, now: T + 100 })
    expect(second.get(E1)?.kind).toBe('breached')
  })
})

describe('expirePulses', () => {
  it('returns the SAME map when nothing has expired', () => {
    const map = plan({ changes: [entryChange('e1', 'updated', T)] })
    expect(expirePulses(map, T + 1)).toBe(map)
  })

  it('drops pulses at or past their deadline', () => {
    const map = plan({ changes: [entryChange('e1', 'updated', T)] })
    const until = map.get(E1)?.until ?? 0
    expect(expirePulses(map, until).size).toBe(0)
    expect(expirePulses(map, until - 1).size).toBe(1)
  })

  it('collapses to the shared empty map when the last one goes', () => {
    const map = plan({ changes: [entryChange('e1', 'updated', T)] })
    expect(expirePulses(map, T + 999_999)).toBe(EMPTY_PULSES)
  })

  it('is a no-op on an already empty map', () => {
    expect(expirePulses(EMPTY_PULSES, T)).toBe(EMPTY_PULSES)
  })
})

/* ── identity, so the map does not re-render itself ─────────────────────── */

describe('reference stability', () => {
  it('returns the active map unchanged when nothing happened', () => {
    const active = plan({ changes: [entryChange('e1', 'updated', T)] })
    expect(plan({ changes: [], active, now: T + 1 })).toBe(active)
  })

  it('returns the active map unchanged when every change was dropped', () => {
    const active = plan({ changes: [entryChange('e1', 'updated', T)] })
    const next = plan({ changes: [entryChange('ghost', 'updated', T + 1)], active, now: T + 1 })
    expect(next).toBe(active)
  })

  it('is deterministic — same inputs, same output', () => {
    const changes = [entryChange('e1', 'updated', T), entryChange('e2', 'breached', T)]
    const a = plan({ changes })
    const b = plan({ changes })
    expect([...a].sort()).toEqual([...b].sort())
  })
})

/* ── reduced motion ─────────────────────────────────────────────────────── */

describe('reduced motion', () => {
  it('decides nothing pulses', () => {
    const map = plan({ changes: [entryChange('e1', 'breached', T)], reducedMotion: true })
    expect(map).toBe(EMPTY_PULSES)
  })

  it('clears pulses already running when the preference turns on mid-session', () => {
    const active = plan({ changes: [entryChange('e1', 'updated', T)] })
    expect(plan({ changes: [], active, reducedMotion: true })).toBe(EMPTY_PULSES)
  })
})

/* ── deriving changes from the picture ──────────────────────────────────── */

describe('breachChanges', () => {
  it('says nothing on first paint', () => {
    expect(breachChanges(null, tree({ breached: ['e1', 'open', 't1', 'root'] }), T)).toEqual([])
  })

  it('reports the DEEPEST node that flipped, not the whole chain', () => {
    // A leaf going red flips its group, its track and the root by roll-up.
    // Four pulses for one fact would be four times the interruption.
    const before = tree()
    const after = tree({ breached: ['e1', 'open', 't1', 'root'] })
    const out = breachChanges(before, after, T)
    expect(out).toHaveLength(1)
    expect(out[0]?.target).toEqual({ kind: 'node', id: E1 })
    expect(out[0]?.kind).toBe('breached')
  })

  it('stays quiet when a branch was already breached', () => {
    const same = ['e1', 'open', 't1', 'root']
    expect(breachChanges(tree({ breached: same }), tree({ breached: same }), T)).toEqual([])
  })

  it('reports a second leaf going red under an already-red branch', () => {
    const before = tree({ breached: ['e1', 'open', 't1', 'root'] })
    const after = tree({ breached: ['e1', 'e2', 'open', 't1', 'root'] })
    const out = breachChanges(before, after, T)
    expect(out.map((c) => c.target.id)).toEqual([E2])
  })

  it('counts a breached item that ARRIVED — the branch went red either way', () => {
    const before = node(null, 'root', 'root', [node(ROOT_ID, 'track', 't1', [])])
    const after = tree({ breached: ['e1', 'open', 't1', 'root'] })
    expect(breachChanges(before, after, T).map((c) => c.target.id)).toEqual([E1])
  })

  it('says nothing when a breach CLEARS — recovery is not an interruption', () => {
    const before = tree({ breached: ['e1', 'open', 't1', 'root'] })
    expect(breachChanges(before, tree(), T)).toEqual([])
  })

  it('feeds planPulses a pulse on the branch when the leaf is hidden', () => {
    const before = tree({ collapsedTrack: true })
    const after = tree({ collapsedTrack: true, breached: ['e1', 'open', 't1', 'root'] })
    const map = plan({ tree: after, changes: breachChanges(before, after, T) })
    expect(ids(map)).toEqual([T1])
    expect(map.get(T1)?.kind).toBe('breached')
  })
})

describe('closedChanges', () => {
  it('says nothing on first paint', () => {
    expect(closedChanges(null, tree(), T)).toEqual([])
  })

  it('aims at the branch the entry LEFT, because the entry has no node any more', () => {
    const before = tree()
    const g = 'root/track:t1/group:open'
    const after = node(null, 'root', 'root', [
      node(ROOT_ID, 'track', 't1', [node(T1, 'group', 'open', [node(g, 'entry', 'e1')])]),
    ])
    const out = closedChanges(before, after, T)
    expect(out).toHaveLength(1)
    expect(out[0]?.target).toEqual({ kind: 'node', id: G })
    expect(out[0]?.kind).toBe('closed')
  })

  it('walks out to the track when the emptied group vanished with its last item', () => {
    const before = tree()
    const after = node(null, 'root', 'root', [node(ROOT_ID, 'track', 't1', [])])
    const map = plan({ tree: after, changes: closedChanges(before, after, T) })
    expect(ids(map)).toEqual([T1])
  })

  it('is dropped by the cap when a filter empties the map, not animated as a close', () => {
    // The honest limit of "an entry left the tree": a filter keystroke removes
    // rows in bulk, and a bulk exodus cannot fit under the cap. The tracks
    // SURVIVE here (they are ring 1, drawn whether or not they hold work), so
    // the eight changes really do resolve onto eight drawn nodes — the cap is
    // what drops them, not a failure to resolve.
    const before = wide(8, 1)
    const after = node(
      null,
      'root',
      'root',
      Array.from({ length: 8 }, (_, i) => node(ROOT_ID, 'track', `t${i}`, [])),
    )
    const changes = closedChanges(before, after, T)
    expect(changes.length).toBeGreaterThan(PULSE_MAX)
    expect(plan({ tree: after, changes }).size).toBe(0)
  })

  it('animates a close when only a few land at once', () => {
    // The other side of the same coin: three items closing is an event, and it
    // reads on the three branches that lost them.
    const before = wide(3, 1)
    const after = node(
      null,
      'root',
      'root',
      Array.from({ length: 3 }, (_, i) => node(ROOT_ID, 'track', `t${i}`, [])),
    )
    const map = plan({ tree: after, changes: closedChanges(before, after, T) })
    expect(ids(map)).toEqual(['root/track:t0', 'root/track:t1', 'root/track:t2'])
    expect(map.get('root/track:t0')?.kind).toBe('closed')
  })

  it('is deterministic in its ordering', () => {
    const before = wide(3, 1)
    const after = node(null, 'root', 'root', [])
    // The parent of each departed entry is its GROUP — the branch it left.
    expect(closedChanges(before, after, T).map((c) => c.target.id)).toEqual([
      'root/track:t0/group:g0',
      'root/track:t1/group:g0',
      'root/track:t2/group:g0',
    ])
  })
})

/* ── the store's shape ──────────────────────────────────────────────────── */

describe('pulseKindFromFlash', () => {
  it('maps the store FlashMark kinds onto this module s vocabulary', () => {
    expect(pulseKindFromFlash('new')).toBe('added')
    // An entry edit and a posted follow-up are the same event at track-ring
    // zoom: somebody touched work under this branch.
    expect(pulseKindFromFlash('edit')).toBe('updated')
    expect(pulseKindFromFlash('update')).toBe('updated')
  })
})
