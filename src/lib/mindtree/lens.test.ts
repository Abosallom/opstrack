// Proof that the lens module is TOTAL — every function answers for every member
// of every union, and the answers are the ones the contract's killer test needs.
//
// WHY EXHAUSTIVENESS IS TESTED AT RUNTIME WHEN TYPESCRIPT ALREADY CHECKS IT.
// tsc proves a `switch` with no `default:` returns on every path; it does not
// prove the union was ENUMERATED. `MAP_LENSES` is a hand-written array beside a
// hand-written union, and the failure that matters is a NEXT lens added to the
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
  DEFAULT_PORTFOLIO_BY,
  DEFAULT_PORTFOLIO_RISK,
  DETENT_KEY,
  LENS_KEY,
  MAP_DETENTS,
  MAP_LENSES,
  MAP_STAGES,
  PORTFOLIO_BYS,
  PORTFOLIO_BY_KEY,
  STAGE_KEY,
  allowedStages,
  isMapLens,
  isMapStage,
  isPanelDetent,
  isPortfolioBy,
  lensNeedsClosedWork,
  phoneDetentFor,
  stageForLens,
  stageWithTable,
  subjectForLens,
  type MapLens,
  type MapStage,
  type PanelDetent,
  type PanelSubject,
  type PortfolioBy,
} from './lens'

const NODE = 'root/track:11111111-2222-3333-4444-555555555555'

/* ───────────────────────────── the three unions ──────────────────────────── */

describe('the closed unions', () => {
  it('enumerates every lens, stage and detent exactly once', () => {
    expect([...MAP_LENSES].sort()).toEqual(
      ['by-status', 'needs-me', 'numbers', 'portfolio', 'shape', 'what-changed'].sort(),
    )
    expect([...MAP_STAGES].sort()).toEqual(
      ['board', 'map', 'numbers', 'portfolio', 'table'].sort(),
    )
    // Ordered smallest first — a detent control steps through the array.
    expect(MAP_DETENTS).toEqual(['peek', 'half', 'full'])
    expect(new Set(MAP_LENSES).size).toBe(MAP_LENSES.length)
  })

  it('fixes the chip row in READING order, not in arrival order', () => {
    // MAP_LENSES is what MapLensBar maps over, so this array IS the left-to-right
    // order of the chips — and the sorted assertion above cannot see it. The
    // portfolio sits beside `shape` because both ask about the hierarchy; it
    // must not land at the end merely because it arrived last, which is what
    // `push` does to a table nobody pins.
    expect(MAP_LENSES).toEqual([
      'needs-me',
      'shape',
      'portfolio',
      'by-status',
      'what-changed',
      'numbers',
    ])
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
  it('answers for all six, and every answer is a real stage', () => {
    const table: Record<MapLens, MapStage> = {
      'needs-me': 'map',
      shape: 'map',
      portfolio: 'portfolio',
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
    // Neither is the portfolio, which ALREADY is a table: a reader who left the
    // ledger switch on must not have their organization list swapped for the
    // tracks ledger the moment they tap the sixth chip.
    expect(stageWithTable('portfolio', true)).toBe('portfolio')
    for (const lens of MAP_LENSES) expect(stageWithTable(lens, false)).toBe(stageForLens(lens))
  })
})

describe('allowedStages', () => {
  it('offers the switch only where there is something to switch', () => {
    expect(allowedStages('shape')).toEqual(['map', 'table'])
    expect(allowedStages('needs-me')).toEqual(['map', 'table'])
    expect(allowedStages('by-status')).toEqual(['board'])
    expect(allowedStages('numbers')).toEqual(['numbers'])
    // No Map|Table pair over a surface that has no canvas to offer.
    expect(allowedStages('portfolio')).toEqual(['portfolio'])
    for (const lens of MAP_LENSES) {
      expect(allowedStages(lens).length).toBeGreaterThan(0)
      expect(allowedStages(lens)).toContain(stageForLens(lens))
      // Every member is a real stage — the normaliser leans on this.
      for (const stage of allowedStages(lens)) expect(MAP_STAGES).toContain(stage)
    }
  })
})

describe('subjectForLens', () => {
  it('answers for all six, with and without a focused node', () => {
    const withNode: Record<MapLens, PanelSubject> = {
      'needs-me': { kind: 'needsMe' },
      shape: { kind: 'branch', nodeId: NODE },
      portfolio: { kind: 'branch', nodeId: NODE },
      'by-status': { kind: 'none' },
      'what-changed': { kind: 'changes' },
      numbers: { kind: 'numbers' },
    }
    for (const lens of MAP_LENSES) expect(subjectForLens(lens, NODE), lens).toEqual(withNode[lens])

    // THE HONEST COST, stated in the contract rather than hidden: `shape` with
    // nothing focused is `none`, the panel does not render, and the map is the
    // whole width — which is today's screen exactly.
    expect(subjectForLens('shape', null)).toEqual({ kind: 'none' })
    expect(subjectForLens('portfolio', null)).toEqual({ kind: 'none' })
    // The other four do not depend on the drill-in at all.
    for (const lens of MAP_LENSES) {
      if (lens === 'shape' || lens === 'portfolio') continue
      expect(subjectForLens(lens, null), lens).toEqual(withNode[lens])
    }
  })

  it('gives the portfolio the SAME subject as the shape, for every input', () => {
    // THE PROPERTY THE SIXTH LENS IS BOUGHT WITH. A portfolio row tap opens the
    // org panel that already exists — no new PanelSubject, so no edit to
    // phoneDetentFor and no edit to the shell's one exhaustive panel switch. The
    // two arms share a fall-through in lens.ts; this is what says they must, so
    // that separating them later is a deliberate act with a red test rather than
    // a copy that quietly stopped matching.
    for (const focus of [null, NODE, `${NODE}/group:blocked`]) {
      expect(subjectForLens('portfolio', focus), String(focus)).toEqual(
        subjectForLens('shape', focus),
      )
    }
    // …and therefore the phone opens it at the branch's own height, with
    // phoneDetentFor untouched.
    expect(phoneDetentFor(subjectForLens('portfolio', NODE))).toBe('half')
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
    // ⚠ THE INVARIANT USED TO READ `stageForLens(lens) !== 'map'`, AND THE SIXTH
    // LENS IS WHY IT NO LONGER CAN. That shorthand was only ever true by
    // coincidence: the question is whether the lens ASKS ABOUT CLOSED ROWS, not
    // whether it draws the canvas. The portfolio replaces the canvas and still
    // asks only about open work — where each organization has got to, and how
    // much is open under it — so a rule written as "not the map" would have made
    // the morning's first chip pay for `loadClosedSince` on every open.
    const REPLACES_THE_CANVAS: Record<MapLens, boolean> = {
      'needs-me': false,
      shape: false,
      portfolio: true,
      'by-status': true,
      'what-changed': false,
      numbers: true,
    }
    for (const lens of MAP_LENSES) {
      expect(REPLACES_THE_CANVAS[lens], lens).toBe(stageForLens(lens) !== 'map')
      expect(lensNeedsClosedWork(lens), lens).toBe(lens === 'by-status' || lens === 'numbers')
    }
    // Said once more in the form the reader of this file cares about: the sixth
    // chip is a NEW STAGE that costs NO extra read.
    expect(stageForLens('portfolio')).not.toBe('map')
    expect(lensNeedsClosedWork('portfolio')).toBe(false)
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
    expect(Object.keys(PORTFOLIO_BY_KEY).sort()).toEqual([...PORTFOLIO_BYS].sort())
    const all = [
      ...Object.values(LENS_KEY),
      ...Object.values(STAGE_KEY),
      ...Object.values(DETENT_KEY),
      ...Object.values(PORTFOLIO_BY_KEY),
    ]
    expect(new Set(all).size).toBe(all.length)
    // In the map's own namespace, so localeReach resolves them against
    // locales/{en,ar}/mindtree.json rather than a namespace nobody registered.
    for (const key of all) expect(key.startsWith('mindtree.')).toBe(true)
  })
})

/* ─────────────────────── the portfolio's two controls ────────────────────── */

describe('the ?by= union', () => {
  it('enumerates the four groupings exactly once, in reading order', () => {
    // Coarse to fine, and the order IS the chip order: where each organization
    // is → whose book it is → who is integrating it → how far the programme has
    // got. `MAP_LENSES` has the same property one level up.
    expect(PORTFOLIO_BYS).toEqual(['stage', 'manager', 'vendor', 'phase'])
    expect(new Set(PORTFOLIO_BYS).size).toBe(PORTFOLIO_BYS.length)
  })

  it('defaults to the stalled list — budget E1, as two constants', () => {
    // THE MORNING ANSWER COSTS ZERO INTERACTIONS AFTER OPEN. If either of these
    // moves, the chip stops answering the question it exists for and the reader
    // is back to two taps before they can see what is stuck.
    expect(DEFAULT_PORTFOLIO_BY).toBe('stage')
    expect(DEFAULT_PORTFOLIO_RISK).toBe(true)
    expect(PORTFOLIO_BYS).toContain(DEFAULT_PORTFOLIO_BY)
  })

  it('is total over hostile input', () => {
    // `?by=` is hand-editable, inheritable from a link written under an older
    // build, and pasted by people. Everything it is not must be false, not
    // undefined.
    for (const bad of [null, undefined, 0, '', 'Stage', 'stages', 'owner', {}, [], 'toString']) {
      expect(isPortfolioBy(bad), String(bad)).toBe(false)
    }
    for (const by of PORTFOLIO_BYS) expect(isPortfolioBy(by)).toBe(true)
  })

  it('gives every grouping a human word that is not its own spelling', () => {
    // Budget E5: `?by=` renders as chips a person reads. A table that echoed the
    // param values would put `manager` and `phase` on screen, which is the
    // machine's spelling of two questions ("whose book", "how far along").
    // JOINED RATHER THAN WRITTEN, and the workaround is worth a sentence:
    // localeReach.test.ts scans SOURCE — comments included — for quoted dotted
    // strings and requires each one to resolve in both bundles. The prefix these
    // four keys share is not itself a key, so spelling it as one quoted string
    // anywhere in this file (even in a comment) fails that gate with a missing
    // string nobody ever asked for.
    const prefix = ['mindtree', 'portfolioBy'].join('.')
    for (const by of PORTFOLIO_BYS) {
      const key: string = PORTFOLIO_BY_KEY[by as PortfolioBy]
      expect(key, by).not.toBe(by)
      expect(key.startsWith(prefix), by).toBe(true)
    }
  })
})
