// The board's column model, asserted without a render.
//
// This is the half of `pages/Board.tsx` that could only be reached before by
// seeding localStorage and reading server-rendered markup back — the axis, the
// residual pass, the per-dimension collapse keying and the arrival diff. None
// of it needs React, so none of it is tested through React any more.
//
// Pure module, pure test: no mocks, no DOM, no store. Vitest imports are
// explicit — the repo runs with `globals` off.

import { describe, expect, it } from 'vitest'
import type { Entry } from '../../types'
import {
  BOARD_PREFS_KEY,
  CLOSED_WINDOW_DAYS,
  DEFAULT_BOARD_PREFS,
  ENTER_BURST_MAX,
  ENTER_SLIDE_PX,
  MAX_CARDS,
  NAME_PREFIX,
  NO_VALUE,
  bucketOf,
  collapsedFor,
  enterDiff,
  isBoardDim,
  parseBoardPrefs,
  patchFor,
  seedFor,
  splitColumns,
  toggleCollapsed,
  type BoardColumnDef,
} from './columns'

const entry = (over: Partial<Entry> & Pick<Entry, 'id'>): Entry => ({
  title: over.id,
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
  created_by: 'u1',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-20T00:00:00.000Z',
  closed_at: null,
  last_activity_at: '2026-07-20T00:00:00.000Z',
  meeting_id: null,
  template_id: null,
  ...over,
})

const def = (key: string, over: Partial<BoardColumnDef> = {}): BoardColumnDef => ({
  key,
  label: key === NO_VALUE ? 'None' : key,
  vars: {},
  retired: false,
  ...over,
})

describe('bucketOf — which column an entry is in, per axis', () => {
  it('reads the value the axis names', () => {
    const e = entry({ id: 'a', status: 'blocked', priority: 'high', track_id: 't-sre' })
    expect(bucketOf(e, 'status')).toBe('blocked')
    expect(bucketOf(e, 'priority')).toBe('high')
    expect(bucketOf(e, 'track')).toBe('t-sre')
  })

  it('sends a missing value to the residual bucket, never to a made-up key', () => {
    const e = entry({ id: 'a', track_id: null })
    expect(bucketOf(e, 'track')).toBe(NO_VALUE)
    expect(bucketOf(e, 'owner')).toBe(NO_VALUE)
    // Whitespace is not an owner. Without the trim, "  " would open a column.
    expect(bucketOf(entry({ id: 'b', owner_name: '   ' }), 'owner')).toBe(NO_VALUE)
  })

  it('prefers the member over the free-text name, and prefixes the name when there is no member', () => {
    expect(bucketOf(entry({ id: 'a', owner_id: 'u2', owner_name: 'Acme' }), 'owner')).toBe('u2')
    expect(bucketOf(entry({ id: 'b', owner_name: 'Acme Ltd' }), 'owner')).toBe(`${NAME_PREFIX}Acme Ltd`)
  })
})

describe('patchFor — the one place the axis becomes a mutation', () => {
  it('writes the field the axis names', () => {
    expect(patchFor('status', 'done')).toEqual({ status: 'done' })
    expect(patchFor('priority', 'high')).toEqual({ priority: 'high' })
    expect(patchFor('track', 't-net')).toEqual({ trackId: 't-net' })
  })

  it('clears the free-text owner when it sets one, because the two are exclusive', () => {
    // Leaving a vendor's name behind on a row now owned by a teammate makes
    // every reader that falls back to owner_name — the digest, the CSV export —
    // disagree with the board.
    expect(patchFor('owner', 'u2')).toEqual({ ownerId: 'u2', ownerName: null })
    expect(patchFor('owner', NO_VALUE)).toEqual({ ownerId: null, ownerName: null })
    expect(patchFor('track', NO_VALUE)).toEqual({ trackId: null })
  })

  it('refuses a free-text owner bucket outright — a source, never a target', () => {
    // The hit test already refuses it (`accepts: false`) and no keyboard path
    // indexes it. This is the third guard on the same rule, and it is the one
    // that holds if the other two are ever bypassed.
    expect(patchFor('owner', `${NAME_PREFIX}Acme Ltd`)).toBeNull()
    expect(patchFor('status', `${NAME_PREFIX}whatever`)).toBeNull()
  })
})

describe('seedFor — what a quick-add in a column pre-fills', () => {
  it('mirrors patchFor for every axis', () => {
    expect(seedFor('status', 'blocked')).toEqual({ status: 'blocked' })
    expect(seedFor('priority', 'critical')).toEqual({ priority: 'critical' })
    expect(seedFor('track', 't-net')).toEqual({ trackId: 't-net' })
    expect(seedFor('owner', 'u2')).toEqual({ ownerId: 'u2' })
    expect(seedFor('owner', NO_VALUE)).toEqual({ ownerId: null })
  })
})

describe('splitColumns', () => {
  const entries = [
    entry({ id: 'a', status: 'new' }),
    entry({ id: 'b', status: 'new' }),
    entry({ id: 'c', status: 'in_progress' }),
    entry({ id: 'd', status: 'done' }),
    entry({ id: 'e', status: 'waiting_on' }),
  ]
  const split = (over: Partial<Parameters<typeof splitColumns>[0]> = {}) =>
    splitColumns({
      entries,
      dim: 'status',
      defs: [def('new'), def('in_progress'), def('done'), def('cancelled')],
      isBreached: () => false,
      residual: (key) => ({ label: `?${key}`, vars: {} }),
      ...over,
    })

  it('keeps the declared order and hangs the entries on it', () => {
    const { live } = split()
    expect(live.map((c) => c.key)).toEqual(['new', 'in_progress', 'done', 'cancelled'])
    expect(live[0]?.entries.map((e) => e.id)).toEqual(['a', 'b'])
    // A declared column with nothing in it is still a column: it is a drop
    // target, and it is where the quick-add composer lives.
    expect(live[3]?.entries).toEqual([])
  })

  it('populates the CLOSED columns from the same pass — they are not special', () => {
    // The rows arrive from loadClosedSince(); as far as the model is concerned
    // `done` is a bucket like any other, which is what makes "what did the team
    // finish this fortnight" answerable under every axis.
    expect(split().live.find((c) => c.key === 'done')?.entries.map((e) => e.id)).toEqual(['d'])
  })

  it('rescues a bucket the axis never declared, as a SOURCE-ONLY strip', () => {
    const { live, overflow } = split()
    expect(live.some((c) => c.key === 'waiting_on')).toBe(false)
    expect(overflow.map((c) => c.key)).toEqual(['waiting_on'])
    expect(overflow[0]?.retired).toBe(true)
    expect(overflow[0]?.label).toBe('?waiting_on')
  })

  it('drops a retired bucket that holds nothing — that one is genuinely gone', () => {
    const { live, overflow } = split({
      defs: [def('new'), def('in_progress'), def('done'), def('cancelled', { retired: true })],
      entries: entries.filter((e) => e.status !== 'waiting_on'),
    })
    expect(overflow).toEqual([])
    expect(live.map((c) => c.key)).toEqual(['new', 'in_progress', 'done'])
  })

  it('counts the SLA breaches per column, and only in the column they are in', () => {
    const { live } = split({ isBreached: (id) => id === 'a' })
    expect(live.find((c) => c.key === 'new')?.breached).toBe(1)
    expect(live.find((c) => c.key === 'in_progress')?.breached).toBe(0)
  })

  it('reports the membership of EVERY entry, including the rescued ones', () => {
    const { membership } = split()
    expect(membership.size).toBe(entries.length)
    expect(membership.get('e')).toBe('waiting_on')
  })

  it('cuts by owner with the residual bucket wherever the caller declared it', () => {
    const owned = [
      entry({ id: 'a' }),
      entry({ id: 'b', owner_id: 'u2' }),
      entry({ id: 'c', owner_name: 'Acme Ltd' }),
    ]
    const { live, overflow } = splitColumns({
      entries: owned,
      dim: 'owner',
      defs: [def(NO_VALUE), def('u2')],
      isBreached: () => false,
      residual: (key) => ({ label: key.slice(NAME_PREFIX.length), vars: {} }),
    })
    expect(live.map((c) => c.key)).toEqual([NO_VALUE, 'u2'])
    expect(live[0]?.entries.map((e) => e.id)).toEqual(['a'])
    // A vendor owns real work and no board control can assign TO one.
    expect(overflow.map((c) => c.label)).toEqual(['Acme Ltd'])
  })
})

describe('parseBoardPrefs — user-writable storage outlives a schema', () => {
  it('answers the default for nothing at all', () => {
    expect(parseBoardPrefs(null)).toEqual(DEFAULT_BOARD_PREFS)
  })

  it('answers the default for a half-written or hostile value', () => {
    for (const raw of ['', '{', 'null', '"a string"', '42', '[]']) {
      expect(parseBoardPrefs(raw).dimension).toBe('status')
      expect(parseBoardPrefs(raw).density).toBe('comfortable')
    }
  })

  it('degrades a dimension a future build knew, rather than rendering zero columns', () => {
    const prefs = parseBoardPrefs(JSON.stringify({ dimension: 'assignee', density: 'roomy' }))
    expect(prefs.dimension).toBe('status')
    expect(prefs.density).toBe('comfortable')
  })

  it('keeps a valid choice, and filters junk out of the collapsed lists', () => {
    const prefs = parseBoardPrefs(
      JSON.stringify({
        dimension: 'owner',
        density: 'compact',
        collapsed: { owner: ['u2', 7, null, 'u3'], status: 'not-an-array' },
      }),
    )
    expect(prefs.dimension).toBe('owner')
    expect(prefs.density).toBe('compact')
    expect(prefs.collapsed.owner).toEqual(['u2', 'u3'])
    expect(prefs.collapsed.status).toBeUndefined()
  })

  it('keeps the storage key stable — a rename silently resets every reader', () => {
    expect(BOARD_PREFS_KEY).toBe('nphiescore_board_v1')
  })
})

describe('toggleCollapsed — collapse is keyed PER DIMENSION', () => {
  it('survives an axis switch and back, with each axis keeping its own list', () => {
    // A track id means nothing to the status axis. One flat list would produce
    // phantom collapsed columns the first time the reader switched and back —
    // and, worse, a column that cannot be found to expand.
    let prefs = toggleCollapsed(DEFAULT_BOARD_PREFS, 'status', 'new')
    prefs = toggleCollapsed(prefs, 'track', 't-net')
    expect([...collapsedFor(prefs, 'status')]).toEqual(['new'])
    expect([...collapsedFor(prefs, 'track')]).toEqual(['t-net'])
    expect([...collapsedFor(prefs, 'owner')]).toEqual([])
  })

  it('is its own inverse', () => {
    const once = toggleCollapsed(DEFAULT_BOARD_PREFS, 'status', 'new')
    const twice = toggleCollapsed(once, 'status', 'new')
    expect([...collapsedFor(twice, 'status')]).toEqual([])
  })

  it('does not mutate the prefs it was handed', () => {
    const before = toggleCollapsed(DEFAULT_BOARD_PREFS, 'status', 'new')
    toggleCollapsed(before, 'status', 'done')
    expect([...collapsedFor(before, 'status')]).toEqual(['new'])
  })
})

describe('enterDiff — which cards arrived, and how each reads', () => {
  const order = new Map([
    ['new', 0],
    ['in_progress', 1],
    ['done', 2],
  ])

  it('says nothing about cards that did not move', () => {
    const same = new Map([['a', 'new']])
    expect(enterDiff({ prev: same, next: same, order, sign: 1, mine: new Set() }).enter.size).toBe(0)
  })

  it('reads this reader’s own move as a landing and somebody else’s as a slide', () => {
    const diff = enterDiff({
      prev: new Map([
        ['a', 'new'],
        ['b', 'new'],
      ]),
      next: new Map([
        ['a', 'done'],
        ['b', 'done'],
      ]),
      order,
      sign: 1,
      mine: new Set(['a']),
    })
    expect(diff.enter.get('a')?.kind).toBe('landed')
    expect(diff.enter.get('b')?.kind).toBe('moved')
  })

  it('slides a card in from the side it travelled FROM, and flips that in RTL', () => {
    const prev = new Map([['a', 'new']])
    const next = new Map([['a', 'done']])
    const ltr = enterDiff({ prev, next, order, sign: 1, mine: new Set() })
    const rtl = enterDiff({ prev, next, order, sign: -1, mine: new Set() })
    expect(ltr.enter.get('a')?.slide).toBe(-ENTER_SLIDE_PX)
    expect(rtl.enter.get('a')?.slide).toBe(ENTER_SLIDE_PX)
  })

  it('calls a card that did not exist a moment ago NEW, with no travel', () => {
    const diff = enterDiff({
      prev: new Map(),
      next: new Map([['a', 'new']]),
      order,
      sign: 1,
      mine: new Set(),
    })
    expect(diff.enter.get('a')).toEqual({ kind: 'new', slide: 0 })
  })

  it('gives a card arriving from an unplaced column no travel rather than a guess', () => {
    const diff = enterDiff({
      prev: new Map([['a', 'waiting_on']]),
      next: new Map([['a', 'new']]),
      order,
      sign: 1,
      mine: new Set(),
    })
    expect(diff.enter.get('a')).toEqual({ kind: 'moved', slide: 0 })
  })

  it('calls a re-bucketing of everything a BURST, which is not an event', () => {
    // A filter change, an axis switch or a first load. Animating forty cards is
    // not livelier, it is a screen that convulses on every keystroke.
    const prev = new Map<string, string>()
    const next = new Map<string, string>()
    for (let i = 0; i <= ENTER_BURST_MAX; i += 1) {
      prev.set(`e${i}`, 'new')
      next.set(`e${i}`, 'done')
    }
    expect(enterDiff({ prev, next, order, sign: 1, mine: new Set() }).burst).toBe(true)
    prev.delete('e0')
    next.delete('e0')
    expect(enterDiff({ prev, next, order, sign: 1, mine: new Set() }).burst).toBe(false)
  })
})

describe('the constants the board is measured by', () => {
  it('reaches back a fortnight for the closed columns', () => {
    // Everything ever closed grows without bound on a log nothing deletes; two
    // weeks is "what this team finished recently", which is what a board is for.
    expect(CLOSED_WINDOW_DAYS).toBe(14)
  })

  it('folds a long column, and the fold is the only thing density changes here', () => {
    expect(MAX_CARDS.comfortable).toBe(25)
    expect(MAX_CARDS.compact).toBe(40)
  })

  it('is total over hostile input', () => {
    for (const v of [null, undefined, 0, '', 'assignee', {}, ['status']]) {
      expect(isBoardDim(v)).toBe(false)
    }
    for (const v of ['status', 'track', 'owner', 'priority']) expect(isBoardDim(v)).toBe(true)
  })
})
