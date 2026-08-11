// The Org panel's arithmetic, which is the only thing on that panel a reader
// cannot check by counting the rows themselves.
//
// WHAT IS ACTUALLY AT RISK HERE, and it is not "does 6 + 3 equal 9". It is the
// DENOMINATOR: three separate, plausible, and wrong ways to compute it each
// produce a number that looks right on the day it ships and describes a
// different reality a fortnight later.
//
//   · Count only the links → an organization that integrated ADT and nothing
//     else reads `1 of 1 live`, which is "finished" in front of the person whose
//     job is to notice it is not.
//   · Count only the VISIBLE catalogue → the afternoon an admin hides a retired
//     capability, `6 of 9` becomes `6 of 8` with nothing about the organization
//     having changed, and yesterday's steering deck disagrees with today's.
//   · Compare against a hardcoded 'live' → renaming the terminal status leaves
//     the arithmetic counting a word nothing writes any more, and the panel
//     reads `0 of 9` for every organization in the workspace.
//
// Each of those has a case below, named after the failure rather than after the
// function.
//
// PURE MODULE, PLAIN TEST: no globals shim, no store, no clock. That is the
// contract lib/mindtree/model.ts set and the reason this file needs none of the
// `vi.hoisted` scaffolding every component test in this repo opens with.

import { describe, expect, it } from 'vitest'
// ALIASED: `useCaseProgress` is a pure function whose name matches oxlint's
// Hook heuristic (`use` + a capital), so calling it inside an `it()` body is a
// `react/rules-of-hooks` ERROR under the unaliased name. Same fence
// MapBranchDetail.tsx puts at its own import; see the comment there.
import { entityIdOf, useCaseProgress as progressOf } from './mapNodes'
import type { MapNodeUseCase, UseCase, UseCaseStatus } from '../types'

/* ────────────────────────────── fixtures ────────────────────────────── */

let seq = 0

function capability(over: Partial<UseCase> & Pick<UseCase, 'id' | 'name'>): UseCase {
  seq += 1
  return {
    name_ar: '',
    sort_order: seq,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** The ten seeded capabilities, cut to the six the cases need. */
function catalogue(): UseCase[] {
  seq = 0
  return [
    capability({ id: 'adt', name: 'ADT' }),
    capability({ id: 'rx1', name: 'Medication Prescribe V1' }),
    capability({ id: 'rx2', name: 'Medication Prescribe V2' }),
    capability({ id: 'rad', name: 'Radiology Order' }),
    capability({ id: 'lab', name: 'Lab Order' }),
    capability({ id: 'note', name: 'Clinical Notes' }),
  ]
}

function link(useCaseId: string, status: UseCaseStatus, nodeId = 'org-1'): MapNodeUseCase {
  return { node_id: nodeId, use_case_id: useCaseId, status }
}

const LIVE: UseCaseStatus = 'live'

/* ──────────────────────── the number on the heading ──────────────────── */

describe('useCaseProgress — the heading number', () => {
  it('counts the terminal status against every capability on the table', () => {
    const result = progressOf(
      catalogue(),
      [link('adt', 'live'), link('rx1', 'live'), link('rad', 'testing'), link('lab', 'planned')],
      LIVE,
    )
    expect(result.done).toBe(2)
    expect(result.total).toBe(6)
    expect(result.linked).toBe(4)
    expect(result.nodes).toBe(1)
  })

  it('reads 0 of 6 for an organization nobody has recorded anything about', () => {
    // NOT `0 of 0`. The panel distinguishes the two — nothing recorded renders
    // an em-dash rather than a number — but the arithmetic must still know the
    // size of the table, or the em-dash case and the "at zero" case become the
    // same value and the distinction is unrenderable.
    const result = progressOf(catalogue(), [], LIVE)
    expect(result.total).toBe(6)
    expect(result.done).toBe(0)
    expect(result.linked).toBe(0)
    expect(result.nodes).toBe(1)
  })

  it('does not read 1 of 1 for an organization that has integrated one thing', () => {
    // The failure this module exists to prevent, stated as its own case: a
    // denominator counted off the LINKS reports the emptiest organization in
    // the workspace as the only finished one.
    const result = progressOf(catalogue(), [link('adt', 'live')], LIVE)
    expect(result.done).toBe(1)
    expect(result.total).toBe(6)
    expect(`${result.done} of ${result.total}`).not.toBe('1 of 1')
  })
})

/* ─────────────────── the denominator that must not move ──────────────── */

describe('useCaseProgress — hiding a capability', () => {
  it('keeps a hidden capability the organization is recorded against', () => {
    // `6 of 9` yesterday and `6 of 8` today, with nothing about the
    // organization having changed, is the report that makes a steering deck
    // unciteable. `use_cases.hidden` retires a row from the pickers; it does
    // not retire the fact that this organization integrated it.
    const rows = catalogue().map((u) => (u.id === 'rad' ? { ...u, hidden: true } : u))
    const links = [link('adt', 'live'), link('rad', 'live')]
    const result = progressOf(rows, links, LIVE)

    expect(result.total).toBe(6)
    expect(result.done).toBe(2)
    const rad = result.rows.find((r) => r.useCase.id === 'rad')
    expect(rad?.retired).toBe(true)
    expect(rad?.status).toBe('live')
  })

  it('drops a hidden capability nobody is recorded against', () => {
    // The other half of the same rule: retiring an unused row IS meant to make
    // it go away, and a matrix that kept every capability ever typed would grow
    // forever and never shrink.
    const rows = catalogue().map((u) => (u.id === 'rad' ? { ...u, hidden: true } : u))
    const result = progressOf(rows, [link('adt', 'live')], LIVE)

    expect(result.total).toBe(5)
    expect(result.rows.map((r) => r.useCase.id)).not.toContain('rad')
  })

  it('marks retired only what is BOTH hidden and recorded', () => {
    const rows = catalogue().map((u) => (u.id === 'lab' ? { ...u, hidden: true } : u))
    const result = progressOf(rows, [link('lab', 'planned'), link('adt', 'live')], LIVE)
    expect(result.rows.filter((r) => r.retired).map((r) => r.useCase.id)).toEqual(['lab'])
  })
})

/* ──────────────────── the terminal status is an argument ─────────────── */

describe('useCaseProgress — terminalKey', () => {
  it('counts whatever status it is handed, not the word "live"', () => {
    const links = [link('adt', 'live'), link('rx1', 'testing'), link('rx2', 'testing')]
    expect(progressOf(catalogue(), links, 'testing').done).toBe(2)
    expect(progressOf(catalogue(), links, 'live').done).toBe(1)
    expect(progressOf(catalogue(), links, 'planned').done).toBe(0)
  })

  it('answers 0 for a status nothing carries, rather than throwing', () => {
    // A renamed status must produce a visibly wrong number on the first paint,
    // not an exception that takes the panel down and not a silently plausible
    // one. `0 of 6` on every organization is the loudest quiet failure
    // available.
    const result = progressOf(catalogue(), [link('adt', 'live')], 'shipped')
    expect(result.done).toBe(0)
    expect(result.total).toBe(6)
  })
})

/* ────────────────────────── the rows themselves ──────────────────────── */

describe('useCaseProgress — the rows', () => {
  it('renders every capability, including the ones with nothing recorded', () => {
    const result = progressOf(catalogue(), [link('adt', 'live')], LIVE)
    expect(result.rows).toHaveLength(6)
    const blank = result.rows.find((r) => r.useCase.id === 'lab')
    expect(blank?.status).toBeNull()
    expect(blank?.linked).toBe(0)
    expect(blank?.done).toBe(0)
  })

  it('orders by sort_order and breaks a tie by id, so two loads look alike', () => {
    const rows = [
      capability({ id: 'b', name: 'B', sort_order: 5 }),
      capability({ id: 'a', name: 'A', sort_order: 5 }),
      capability({ id: 'first', name: 'First', sort_order: 1 }),
    ]
    expect(progressOf(rows, [], LIVE).rows.map((r) => r.useCase.id)).toEqual(['first', 'a', 'b'])
  })

  it('de-duplicates a catalogue handed to it twice', () => {
    // A caller that concatenated `useUseCases()` and `useAllUseCases()` would
    // otherwise double the denominator and render every row twice — and `6 of
    // 12` is exactly the kind of wrong that reads as a real number.
    const rows = catalogue()
    const result = progressOf([...rows, ...rows], [link('adt', 'live')], LIVE)
    expect(result.total).toBe(6)
    expect(result.rows).toHaveLength(6)
  })

  it('ignores a link to a capability the catalogue does not carry', () => {
    // It has no name, so a row for it would be a blank line with a status pill
    // beside it. Counted in neither half — never in `done`, which would put the
    // numerator above a denominator that cannot hold it.
    const result = progressOf(catalogue(), [link('ghost', 'live'), link('adt', 'live')], LIVE)
    expect(result.done).toBe(1)
    expect(result.total).toBe(6)
    expect(result.linked).toBe(1)
  })
})

/* ───────────────────────── the roll-up seam ──────────────────────────── */

describe('useCaseProgress — a list of links is a roll-up', () => {
  it('counts capability × organization pairs when several organizations are in', () => {
    // The Phase-level number, from the same code with a different argument: two
    // organizations against a six-capability catalogue is 12 pairs, and three
    // of them are live.
    const links = [
      link('adt', 'live', 'org-1'),
      link('rx1', 'live', 'org-1'),
      link('adt', 'live', 'org-2'),
      link('rx1', 'testing', 'org-2'),
    ]
    const result = progressOf(catalogue(), links, LIVE)
    expect(result.nodes).toBe(2)
    expect(result.total).toBe(12)
    expect(result.done).toBe(3)
  })

  it('keeps a row’s status when the organizations agree and drops it when they do not', () => {
    const links = [
      link('adt', 'live', 'org-1'),
      link('adt', 'live', 'org-2'),
      link('rx1', 'live', 'org-1'),
      link('rx1', 'planned', 'org-2'),
    ]
    const rows = progressOf(catalogue(), links, LIVE).rows
    expect(rows.find((r) => r.useCase.id === 'adt')?.status).toBe('live')
    // No single word is true of both, so the row falls back to its counts.
    const rx1 = rows.find((r) => r.useCase.id === 'rx1')
    expect(rx1?.status).toBeNull()
    expect(rx1?.linked).toBe(2)
    expect(rx1?.done).toBe(1)
  })
})

/* ─────────────────────────── entityIdOf ──────────────────────────────── */

describe('entityIdOf', () => {
  it('answers the node id for an entity and null for everything else', () => {
    // `bucketKey` is a TRACK id on a track node and a status key on a group
    // node, and none of the three is distinguishable from the others by shape.
    // This is the one place that reads it with its `kind`, so the panel mount
    // and the stats band cannot come to different answers.
    expect(entityIdOf({ kind: 'entity', bucketKey: 'org-1' })).toBe('org-1')
    expect(entityIdOf({ kind: 'track', bucketKey: 't-uhr' })).toBeNull()
    expect(entityIdOf({ kind: 'group', bucketKey: 'in_progress' })).toBeNull()
    expect(entityIdOf({ kind: 'root', bucketKey: null })).toBeNull()
    expect(entityIdOf({ kind: 'entry', bucketKey: null })).toBeNull()
  })

  it('answers null for an entity with no key rather than inventing one', () => {
    expect(entityIdOf({ kind: 'entity', bucketKey: null })).toBeNull()
  })
})
