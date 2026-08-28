// Render proof for the COC queue — and the case that matters most is the EMPTY
// one, because empty is what it ships as.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling test gives.
// vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library in the dependency budget, so react-dom/server runs the real
// component, the real hooks and the real translator. Effects do not run, and
// nothing below claims a behaviour that needs one — the save path's decisions
// are asserted through `cocContactProblem` and `buildCocQueue`, which are pure.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { buildCocQueue } from '../../lib/pmo/cocQueue'
import type { MapNodeUseCase, UseCase } from '../../types'
import type { IsoDate } from '../../lib/dates'

vi.hoisted(() => {
  // lib/i18n reads localStorage at MODULE scope, so the shim cannot wait for a
  // beforeAll() — Pmo.test.tsx's note, and the same three lines.
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
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

// The two modules the save path reaches. Neither runs in a static render; they
// are replaced so the test does not need a Supabase client to draw a list.
vi.mock('../../api/map', () => ({ setUseCaseCoc: () => Promise.resolve({ ok: true, data: null }) }))
vi.mock('../../store/portfolio', () => ({ applyPortfolioLink: () => {} }))
vi.mock('../toast', () => ({ toast: () => {} }))

const { CocQueueSection } = await import('./CocQueue')

const TODAY = '2026-08-28' as IsoDate

function capability(id: string, order: number): UseCase {
  return {
    id,
    name: id.toUpperCase(),
    name_ar: '',
    sort_order: order,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const CATALOGUE = [capability('adt', 1), capability('lab', 2)]

function link(nodeId: string, useCaseId: string, over: Partial<MapNodeUseCase> = {}): MapNodeUseCase {
  return { node_id: nodeId, use_case_id: useCaseId, status: 'planned', rung: 'coc', ...over }
}

function draw(links: MapNodeUseCase[], nodes = [{ id: 'a', name: 'Al-Zobaidi', account_manager_id: 'm1' }]): string {
  const queue = buildCocQueue({ nodes, catalogue: CATALOGUE, links, today: TODAY })
  return renderToStaticMarkup(
    <CocQueueSection
      queue={queue}
      labelOf={(id) => id.toUpperCase()}
      managerNameOf={(id) => (id === null ? null : 'Nawaf')}
    />,
  )
}

describe('the empty queue, which is what ships', () => {
  /**
   * ⚠ TRUE ON THE DAY THIS SHIPS. All 1,540 pairs sit at intake, so the first
   * person to open this tab sees an empty worklist — and an empty panel with no
   * words in it reads as a bug and gets reported as one.
   */
  it('explains itself rather than drawing a blank panel', () => {
    const html = draw([])
    expect(html).toContain('Nothing is at COC yet')
    expect(html).toContain('intake')
  })

  it('prints no count line and no oldest wait when there is nothing to count', () => {
    const html = draw([])
    expect(html).not.toContain('waiting on CHI')
    expect(html).not.toContain('oldest wait')
  })
})

describe('the honesty of the age', () => {
  /**
   * ⚠ THE SAME REFUSAL `obMonitor` MAKES ABOUT THE RUNG CLOCK, one screen over:
   * "0 days" on an unsubmitted pair would read as "submitted this morning" when
   * it means "nobody has started".
   */
  it('prints a sentence and NO number for a pair nobody has submitted', () => {
    const html = draw([link('a', 'adt')])
    expect(html).toContain('Not submitted')
    expect(html).not.toContain('0 days')
  })

  it('prints the age for a pair that is genuinely waiting', () => {
    const html = draw([link('a', 'adt', { coc_submitted_on: '2026-08-18' })])
    expect(html).toContain('10 days')
    expect(html).toContain('The oldest wait is 10 days')
  })

  it('says signed rather than ageing a wait nobody is waiting on', () => {
    const html = draw([link('a', 'adt', { coc_submitted_on: '2026-01-01', coc_signed_on: '2026-08-20' })])
    expect(html).toContain('Signed')
    expect(html).not.toContain('The oldest wait')
  })
})

describe('the named person, which is the point of the field', () => {
  it('says who holds it at CHI when somebody has been named', () => {
    const html = draw([link('a', 'adt', { coc_submitted_on: '2026-08-20', coc_contact: 'Sara' })])
    expect(html).toContain('Sara')
    expect(html).not.toContain('Nobody named at CHI')
  })

  it('says plainly that nobody has been named, rather than leaving a gap', () => {
    const html = draw([link('a', 'adt', { coc_submitted_on: '2026-08-20' })])
    expect(html).toContain('Nobody named at CHI')
  })

  it('warns when a submission can be neither called nor quoted', () => {
    const html = draw([link('a', 'adt', { coc_submitted_on: '2026-08-20' })])
    expect(html).toContain('nobody to call and nothing to quote')
  })

  it('does not warn once there is a reference to quote', () => {
    const html = draw([link('a', 'adt', { coc_submitted_on: '2026-08-20', coc_reference: 'CHI-9' })])
    expect(html).toContain('CHI-9')
    expect(html).not.toContain('nobody to call and nothing to quote')
  })
})

describe('the write path is offered to everyone who can carry it out', () => {
  /**
   * `map_node_use_cases` is MEMBER-WRITE by design — 0024 asserts it positively
   * in probe 3. A client-side gate stricter than RLS would be a lie the client
   * tells first, so the control is present with no permission hook consulted.
   */
  it('offers the record control on every row', () => {
    const html = draw([link('a', 'adt'), link('a', 'lab')])
    expect(html.match(/Record the chase/g) ?? []).toHaveLength(2)
  })
})

describe('the order on the glass matches the order in the arithmetic', () => {
  it('draws the oldest wait first and the unsubmitted after it', () => {
    const html = draw(
      [link('a', 'adt', { coc_submitted_on: '2026-08-01' }), link('a', 'lab')],
      [{ id: 'a', name: 'Al-Zobaidi', account_manager_id: 'm1' }],
    )
    expect(html.indexOf('27 days')).toBeLessThan(html.indexOf('Not submitted'))
  })
})
