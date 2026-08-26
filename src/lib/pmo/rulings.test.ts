// The rulings fold — what the PMO's new tab lists, and what it refuses to guess.
//
// Every fixture name below is a real one from the live workspace, because the
// rule this file defends was written from measuring that workspace and would
// have looked fine against invented data.

import { describe, expect, it } from 'vitest'

import { buildRulings, type RulingKind } from './rulings'
import type { MapNode } from '../../types'

function node(id: string, name: string, over: Partial<MapNode> = {}): MapNode {
  return {
    id,
    parent_id: 'phase-1',
    track_id: 't-uhr',
    kind_id: 'k-org',
    name,
    name_ar: '',
    description: '',
    description_ar: '',
    account_manager_id: 'member-1',
    vendor: '',
    his_id: null,
    sort_order: 0,
    archived: false,
    archived_at: null,
    source: 'local',
    external_ref: null,
    external_url: null,
    synced_at: null,
    overrides: [],
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const build = (nodes: MapNode[], counts: Record<string, number> = {}) =>
  buildRulings({ nodes, openByNode: new Map(Object.entries(counts)) })

const kindsOf = (nodes: MapNode[], counts: Record<string, number> = {}): RulingKind[] =>
  build(nodes, counts).rows.map((r) => r.kind)

describe('the pairs it reports', () => {
  it('catches two rows that are one hospital once punctuation is dropped', () => {
    // The live pair, and the one that started this: 7 activities on one, 2 on
    // the other, splitting one hospital's work between two rows.
    const rows = build(
      [node('a', 'Aseer (Care Ware)'), node('b', 'Aseer Care ware')],
      { a: 7, b: 2 },
    ).rows.filter((r) => r.kind === 'duplicate')
    expect(rows).toHaveLength(1)
    // Heaviest first — the row carrying the work is almost always the keeper,
    // and saying so is not the same as deciding it.
    expect(rows[0].parties.map((p) => p.name)).toEqual(['Aseer (Care Ware)', 'Aseer Care ware'])
    expect(rows[0].parties[0].activities).toBe(7)
  })

  it('catches an acronym sitting inside its own long form', () => {
    const kinds = kindsOf([
      node('a', 'King Faisal Specialist Hospital and Research Centre (KFSHRC)'),
      node('b', 'KFSHRC'),
    ])
    expect(kinds).toContain('contained')
  })

  it('catches a one-character misspelling of a real name', () => {
    const kinds = kindsOf([node('a', 'AlYousif Hospital'), node('b', 'Aloysif Hospital')])
    expect(kinds).toContain('near')
  })

  it('reports a pair once, under its strongest reading only', () => {
    // An identical pair is not ALSO "near". Listing it twice would double the
    // work the tab exists to bound.
    const rows = build([node('a', 'Aseer (Care Ware)'), node('b', 'Aseer Care ware')]).rows
    const pairRows = rows.filter((r) => r.kind !== 'silent' && r.kind !== 'unowned')
    expect(pairRows.filter((r) => r.kind === 'duplicate')).toHaveLength(1)
    expect(pairRows.filter((r) => r.kind === 'near')).toHaveLength(0)
  })
})

describe('the pairs it refuses to report', () => {
  // ⚠ THE FIVE FALSE POSITIVES THAT WROTE THE SIX-CHARACTER FLOOR. Every
  //   three-letter code is within two edits of every other, and a PMO who works
  //   through a list like this once does not open the tab again. These are all
  //   real, and all different hospitals.
  it.each([
    ['NMC', 'SMC'],
    ['KFMC', 'NMC'],
    ['MMS', 'NMC'],
    ['RCH', 'SGH'],
    ['CMRC', 'SMC'],
  ])('does not call %s and %s the same hospital', (a, b) => {
    expect(kindsOf([node('a', a), node('b', b)])).not.toContain('near')
  })

  it('does not pair two hospitals that merely share a suffix', () => {
    // `Aya Hospital` and `GAMA Hospital` are two edits apart AS WRITTEN. Their
    // stems are `aya` and `gama`, which is why the comparison uses the stem.
    expect(kindsOf([node('a', 'Aya Hospital'), node('b', 'GAMA Hospital')])).not.toContain('near')
    expect(kindsOf([node('a', 'Hail Cluster'), node('b', 'Taif Cluster')])).not.toContain('near')
  })

  it('leaves an archived organization out entirely', () => {
    const rows = build([
      node('a', 'Aseer (Care Ware)'),
      node('b', 'Aseer Care ware', { archived: true }),
    ]).rows
    expect(rows.filter((r) => r.kind === 'duplicate')).toHaveLength(0)
  })
})

describe('the stems that cannot be filed against', () => {
  it('names both rows a bare "Aseer" ticket could mean, and does not choose', () => {
    // The owner's ruling: the two Aseers are different systems and stay apart.
    // So a ticket naming only "Aseer" has no honest home, and this row is the
    // whole of what the app may say about it.
    const rows = build(
      [node('a', 'Aseer (Care Ware)'), node('b', 'Aseer (Vida Plus)')],
      { a: 7, b: 2 },
    ).rows.filter((r) => r.kind === 'ambiguous')
    expect(rows).toHaveLength(1)
    expect(rows[0].parties.map((p) => p.name)).toEqual(['Aseer (Care Ware)', 'Aseer (Vida Plus)'])
  })

  it('reports a shared stem once, however many rows share it', () => {
    // Three rows sharing a stem is ONE question — "what do we do with a ticket
    // that says only this?" — not three.
    const rows = build([
      node('a', 'Jazan Cluster (MCC)'),
      node('b', 'Jazan cluster (MedicaCloud)'),
      node('c', 'Jazan (Other)'),
    ]).rows.filter((r) => r.kind === 'ambiguous')
    expect(rows).toHaveLength(1)
    expect(rows[0].parties).toHaveLength(3)
  })
})

describe('the two single-organization readings', () => {
  it('names an organization nothing has ever been filed against', () => {
    const rows = build([node('a', 'Madina cluster')], {}).rows
    expect(rows.filter((r) => r.kind === 'silent')).toHaveLength(1)
  })

  it('does not call an organization silent when something is filed against it', () => {
    const rows = build([node('a', 'Madina cluster')], { a: 3 }).rows
    expect(rows.filter((r) => r.kind === 'silent')).toHaveLength(0)
  })

  it('names an organization nobody is accountable for', () => {
    const rows = build([node('a', 'RCH', { account_manager_id: null })], { a: 1 }).rows
    expect(rows.filter((r) => r.kind === 'unowned')).toHaveLength(1)
  })
})

describe('the shape of the answer', () => {
  it('counts the organizations it considered, so every number has its denominator', () => {
    const out = build([node('a', 'One'), node('b', 'Two'), node('c', 'Three', { archived: true })])
    expect(out.organizations).toBe(2)
  })

  it('orders decisions before assignments, and heavier before lighter', () => {
    const kinds = kindsOf(
      [
        node('a', 'Aseer (Care Ware)'),
        node('b', 'Aseer Care ware'),
        node('c', 'Lonely', { account_manager_id: null }),
      ],
      { a: 7, b: 2, c: 1 },
    )
    // A duplicate is a decision; an unowned row is an assignment.
    expect(kinds.indexOf('duplicate')).toBeLessThan(kinds.indexOf('unowned'))
  })

  it('gives every row a key that is stable across two identical builds', () => {
    // React keys and test assertions both depend on it, and two loads that
    // render the same data in two orders are two different-looking tabs.
    const nodes = [node('a', 'Aseer (Care Ware)'), node('b', 'Aseer Care ware')]
    expect(build(nodes).rows.map((r) => r.key)).toEqual(build(nodes).rows.map((r) => r.key))
  })

  it('says nothing at all about a workspace with no problems', () => {
    const clean = [node('a', 'Alpha Hospital'), node('b', 'Beta Medical City')]
    expect(build(clean, { a: 1, b: 1 }).rows).toEqual([])
  })
})
