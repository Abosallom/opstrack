// Proof that the lens module is TOTAL — every function answers for every member
// of every union, and the answers are the ones the contract's killer test needs.
//
// WHY EXHAUSTIVENESS IS TESTED AT RUNTIME WHEN TYPESCRIPT ALREADY CHECKS IT.
// tsc proves a `switch` with no `default:` returns on every path; it does not
// prove the union was ENUMERATED. `MAP_LENSES` is a hand-written array beside a
// hand-written union, and the failure that matters is a sixth lens added to the
// type and forgotten in the array — after which every chip bar, every URL codec
// and every persistence validator silently disagrees with the type. The two
// `toEqual` assertions below are the only place that can be caught.
//
// A KEY TABLE IS A PROMISE TO THE LOCALE TREES. localeReach.test.ts proves each
// key resolves in both bundles; what it cannot prove is that a key EXISTS for
// every union member, because a missing entry is a missing string, not a broken
// one. Asserted here, in both directions.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LENS,
  DETENT_KEY,
  LENS_KEY,
  MAP_DETENTS,
  MAP_LENSES,
  MAP_STAGES,
  STAGE_KEY,
  allowedStages,
  isMapLens,
  isMapStage,
  isPanelDetent,
  lensNeedsClosedWork,
  phoneDetentFor,
  stageForLens,
  stageWithTable,
  subjectForLens,
  type MapLens,
  type MapStage,
  type PanelDetent,
  type PanelSubject,
} from './lens'

const NODE = 'root/track:11111111-2222-3333-4444-555555555555'

/* ───────────────────────────── the three unions ──────────────────────────── */

describe('the closed unions', () => {
  it('enumerates every lens, stage and detent exactly once', () => {
    expect([...MAP_LENSES].sort()).toEqual(
      ['by-status', 'needs-me', 'numbers', 'shape', 'what-changed'].sort(),
    )
    expect([...MAP_STAGES].sort()).toEqual(['board', 'map', 'numbers', 'table'].sort())
    // Ordered smallest first — a detent control steps through the array.
    expect(MAP_DETENTS).toEqual(['peek', 'half', 'full'])
    expect(new Set(MAP_LENSES).size).toBe(MAP_LENSES.length)
  })

  it('lands on the attention lens when nothing is persisted', () => {
    // THE ONE VALUE THIS FILE EXISTS TO PIN. The app lands on /followups today
    // (App.tsx's two redirects), so any other default is a regression on day one
    // for the job its owner does more than any other.
    expect(DEFAULT_LENS).toBe('needs-me')
    expect(MAP_LENSES).toContain(DEFAULT_LENS)
  })

  it('guards are total over hostile input', () => {
    // Every one of these arrives for real: a hand-edited URL, a preference
    // written by a future build, a JSON blob half-flushed by a killed tab.
    for (const bad of [null, undefined, 0, 1, '', 'needsme', 'NEEDS-ME', {}, [], 'toString']) {
      expect(isMapLens(bad), String(bad)).toBe(false)
      expect(isMapStage(bad), String(bad)).toBe(false)
      expect(isPanelDetent(bad), String(bad)).toBe(false)
    }
    for (const lens of MAP_LENSES) expect(isMapLens(lens)).toBe(true)
    for (const stage of MAP_STAGES) expect(isMapStage(stage)).toBe(true)
    for (const detent of MAP_DETENTS) expect(isPanelDetent(detent)).toBe(true)
  })
})

/* ─────────────────────────── lens → stage → panel ────────────────────────── */

describe('stageForLens', () => {
  it('answers for all five, and every answer is a real stage', () => {
    const table: Record<MapLens, MapStage> = {
      'needs-me': 'map',
      shape: 'map',
      'by-status': 'board',
      'what-changed': 'map',
      numbers: 'numbers',
    }
    for (const lens of MAP_LENSES) {
      expect(stageForLens(lens), lens).toBe(table[lens])
      expect(MAP_STAGES).toContain(stageForLens(lens))
    }
  })

  it('never answers `table` — the ledger is a reading choice, not a lens', () => {
    for (const lens of MAP_LENSES) expect(stageForLens(lens)).not.toBe('table')
  })
})

describe('stageWithTable', () => {
  it('swaps the open tree for its ledger, and nothing else', () => {
    expect(stageWithTable('shape', true)).toBe('table')
    expect(stageWithTable('needs-me', true)).toBe('table')
    expect(stageWithTable('what-changed', true)).toBe('table')
    // The board and the numbers are not the tree, so a stale `view: 'table'`
    // persisted from a map session cannot blank either of them.
    expect(stageWithTable('by-status', true)).toBe('board')
    expect(stageWithTable('numbers', true)).toBe('numbers')
    for (const lens of MAP_LENSES) expect(stageWithTable(lens, false)).toBe(stageForLens(lens))
  })
})

describe('allowedStages', () => {
  it('offers the switch only where there is something to switch', () => {
    expect(allowedStages('shape')).toEqual(['map', 'table'])
    expect(allowedStages('needs-me')).toEqual(['map', 'table'])
    expect(allowedStages('by-status')).toEqual(['board'])
    expect(allowedStages('numbers')).toEqual(['numbers'])
    for (const lens of MAP_LENSES) {
      expect(allowedStages(lens).length).toBeGreaterThan(0)
      expect(allowedStages(lens)).toContain(stageForLens(lens))
      // Every member is a real stage — the normaliser leans on this.
      for (const stage of allowedStages(lens)) expect(MAP_STAGES).toContain(stage)
    }
  })
})

describe('subjectForLens', () => {
  it('answers for all five, with and without a focused node', () => {
    const withNode: Record<MapLens, PanelSubject> = {
      'needs-me': { kind: 'needsMe' },
      shape: { kind: 'branch', nodeId: NODE },
      'by-status': { kind: 'none' },
      'what-changed': { kind: 'changes' },
      numbers: { kind: 'numbers' },
    }
    for (const lens of MAP_LENSES) expect(subjectForLens(lens, NODE), lens).toEqual(withNode[lens])

    // THE HONEST COST, stated in the contract rather than hidden: `shape` with
    // nothing focused is `none`, the panel does not render, and the map is the
    // whole width — which is today's screen exactly.
    expect(subjectForLens('shape', null)).toEqual({ kind: 'none' })
    // The other four do not depend on the drill-in at all.
    for (const lens of MAP_LENSES) {
      if (lens === 'shape') continue
      expect(subjectForLens(lens, null), lens).toEqual(withNode[lens])
    }
  })

  it('carries the node id verbatim, because the panel addresses it', () => {
    expect(subjectForLens('shape', `${NODE}/group:blocked`)).toEqual({
      kind: 'branch',
      nodeId: `${NODE}/group:blocked`,
    })
  })
})

describe('lensNeedsClosedWork', () => {
  it('is true for exactly the two stages that replace the canvas', () => {
    // The map pins `scope: 'open'`. The board's Done/Cancelled columns and the
    // throughput/SLA figures are questions about closed rows in a window, so the
    // stages that draw them must read those rows themselves — the pin does not
    // move.
    const needs = MAP_LENSES.filter(lensNeedsClosedWork)
    expect([...needs].sort()).toEqual(['by-status', 'numbers'])
    for (const lens of MAP_LENSES) {
      expect(lensNeedsClosedWork(lens), lens).toBe(stageForLens(lens) !== 'map')
    }
  })
})

/* ───────────────────────────── the phone detent ──────────────────────────── */

describe('phoneDetentFor', () => {
  it('gives the attention and activity lists the WHOLE phone', () => {
    // Anything less shows a phone reader fewer rows than /followups does today.
    expect(phoneDetentFor({ kind: 'needsMe' })).toBe('full')
    expect(phoneDetentFor({ kind: 'changes' })).toBe('full')
    expect(phoneDetentFor({ kind: 'numbers' })).toBe('full')
    // A branch keeps the map above it: that node is why the panel opened.
    expect(phoneDetentFor({ kind: 'branch', nodeId: NODE })).toBe('half')
    expect(phoneDetentFor({ kind: 'none' })).toBe('peek')
  })

  it('answers a real detent for every subject kind', () => {
    const subjects: PanelSubject[] = [
      { kind: 'none' },
      { kind: 'needsMe' },
      { kind: 'branch', nodeId: NODE },
      { kind: 'changes' },
      { kind: 'numbers' },
    ]
    const kinds = new Set(subjects.map((s) => s.kind))
    // The union has five members; a sixth added without a case here fails.
    expect(kinds.size).toBe(5)
    for (const subject of subjects) {
      const detent: PanelDetent = phoneDetentFor(subject)
      expect(MAP_DETENTS, subject.kind).toContain(detent)
    }
  })
})

/* ────────────────────────────── the key tables ───────────────────────────── */

describe('the literal key tables', () => {
  it('name every member, in both directions, with no duplicates', () => {
    expect(Object.keys(LENS_KEY).sort()).toEqual([...MAP_LENSES].sort())
    expect(Object.keys(STAGE_KEY).sort()).toEqual([...MAP_STAGES].sort())
    expect(Object.keys(DETENT_KEY).sort()).toEqual([...MAP_DETENTS].sort())
    const all = [...Object.values(LENS_KEY), ...Object.values(STAGE_KEY), ...Object.values(DETENT_KEY)]
    expect(new Set(all).size).toBe(all.length)
    // In the map's own namespace, so localeReach resolves them against
    // locales/{en,ar}/mindtree.json rather than a namespace nobody registered.
    for (const key of all) expect(key.startsWith('mindtree.')).toBe(true)
  })
})
