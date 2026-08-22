// The six portfolio sections, ASSEMBLED — and mostly the empty case.
//
// The state this file cares about is the one a workspace is in on the day 0031
// is applied: eight tables that exist and hold nothing. Before the forms landed
// every section answered that state with an empty state and no way out of it,
// which is a screen you cannot start from. So the assertion that matters here
// is that the ADD control renders BESIDE the empty state rather than instead of
// it — a regression nothing else in the suite would notice, because the empty
// state itself would still be perfectly correct.
//
// It also covers the two sections 0031's fieldwork tables gained, which nothing
// else renders: `pmo_actions` and `pmo_risks` had no read surface at all until
// the forms needed one, and a form for rows nobody can see is a write-only
// screen.
//
// WHY renderToStaticMarkup: `vitest.config.ts` is `environment: 'node'` — the
// reason every sibling page test gives. Effects do not run, so `loadPmo` is
// never called and the store mock below IS the loaded state.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  PmoAction,
  PmoInitiative,
  PmoKeyResult,
  PmoObjective,
  PmoProject,
  PmoRevenueLine,
  PmoRisk,
} from '../../types'

const fx = vi.hoisted(() => {
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

  const empty = {
    projects: [] as PmoProject[],
    initiatives: [] as PmoInitiative[],
    actions: [] as PmoAction[],
    risks: [] as PmoRisk[],
    revenue: [] as PmoRevenueLine[],
    objectives: [] as PmoObjective[],
    keyResults: [] as PmoKeyResult[],
    progress: [],
    milestones: [],
  }
  const state = { canEdit: true, data: empty as typeof empty }
  return { state, empty }
})

vi.mock('../../store/auth', () => ({ useHasPerm: () => fx.state.canEdit }))
vi.mock('../../store/members', () => ({
  useMemberMap: () => new Map([['m1', { id: 'm1', displayName: 'Dema Alkassim' }]]),
  useMembers: () => [{ id: 'm1', displayName: 'Dema Alkassim' }],
}))
vi.mock('../../store/config', () => ({ useJiraSettings: () => null }))
vi.mock('../../store/pmo', () => ({
  loadPmo: () => Promise.resolve(),
  invalidatePmo: () => Promise.resolve(),
  usePmo: () => fx.state.data,
  usePmoLoading: () => false,
  usePmoError: () => null,
  usePmoNeedsMigration: () => false,
}))
vi.mock('../../api/pmo', () => {
  const table = {
    create: async () => ({ ok: true, data: {} }),
    update: async () => ({ ok: true, data: {} }),
    remove: async () => ({ ok: true, data: undefined }),
  }
  return {
    projects: table,
    initiatives: table,
    actions: table,
    risks: table,
    revenue: table,
    objectives: table,
    keyResults: table,
  }
})
vi.mock('../Confirm', () => ({ confirm: async () => true }))
vi.mock('../toast', () => ({ toast: () => {} }))

const locales = await import('../../locales')
Object.assign(locales.en, (await import('../../locales/en/pmo.json')).default)
Object.assign(locales.en, (await import('../../locales/en/common.json')).default)

const {
  PortfolioActions,
  PortfolioInitiatives,
  PortfolioOkrs,
  PortfolioProjects,
  PortfolioRevenue,
  PortfolioRisks,
} = await import('./Portfolio')

describe('an empty portfolio still offers a way in', () => {
  it('shows the add control BESIDE the empty state, not instead of it', () => {
    // The regression this test exists for: an "add" button that only appears
    // once there is something to add.
    const out = renderToStaticMarkup(<PortfolioProjects />)
    expect(out).toContain('No projects yet')
    expect(out).toContain('Add a project')
  })

  it('does the same for initiatives and objectives', () => {
    expect(renderToStaticMarkup(<PortfolioInitiatives />)).toContain('Add an initiative')
    expect(renderToStaticMarkup(<PortfolioOkrs />)).toContain('Add an objective')
  })

  it('refuses to offer a revenue form before there is a project to attach it to', () => {
    // `pmo_revenue.project_id` is NOT NULL. A select with no options is a form
    // that cannot be completed, so the reason is said out loud instead.
    const out = renderToStaticMarkup(<PortfolioRevenue />)
    expect(out).toContain('add a project before a quarter')
    expect(out).not.toContain('Add a quarter')
  })
})

describe('the two sections 0031’s fieldwork tables gained', () => {
  it('renders the PMO’s own action list, separately titled from the captured one', () => {
    const out = renderToStaticMarkup(<PortfolioActions />)
    expect(out).toContain('PMO follow-up actions')
    expect(out).toContain('No follow-up actions yet')
    expect(out).toContain('Add a follow-up action')
  })

  it('renders the PMO’s own register', () => {
    const out = renderToStaticMarkup(<PortfolioRisks />)
    expect(out).toContain('PMO register')
    expect(out).toContain('Nothing on the register yet')
    expect(out).toContain('Add to the register')
  })
})

describe('a reader with no write permission', () => {
  it('sees the sections exactly as they were — facts, and no controls', () => {
    fx.state.canEdit = false
    const projects = renderToStaticMarkup(<PortfolioProjects />)
    expect(projects).toContain('No projects yet')
    expect(projects).not.toContain('Add a project')
    expect(renderToStaticMarkup(<PortfolioActions />)).not.toContain('Add a follow-up action')
    fx.state.canEdit = true
  })
})

describe('a portfolio with rows in it', () => {
  it('offers an edit control on each row, and says nothing it has not been told', () => {
    fx.state.data = {
      ...fx.empty,
      projects: [
        {
          id: 'p1',
          name: 'Approvals Management System',
          name_ar: '',
          manager_id: null,
          budget: null,
          currency: 'SAR',
          start_date: null,
          end_date: null,
          phase: 'execution',
          // NOBODY HAS SAID — the card must print the sentence, and the form
          // that opens over it must not turn the sentence into a zero.
          actual_pct: null,
          planned_pct: null,
          note: '',
          note_ar: '',
          source: 'local',
          external_ref: null,
          created_at: '',
          updated_at: '',
          created_by: null,
          updated_by: null,
        } as PmoProject,
      ],
      risks: [
        {
          id: 'r1',
          register: 'challenge',
          project_id: null,
          initiative_id: null,
          summary: 'The vendor has not signed',
          level: null,
          impact: null,
          mitigation: '',
          status: 'open',
          source: 'local',
          external_ref: null,
          created_at: '',
          updated_at: '',
          created_by: null,
          updated_by: null,
        } as PmoRisk,
      ],
    }

    const projects = renderToStaticMarkup(<PortfolioProjects />)
    expect(projects).toContain('Approvals Management System')
    expect(projects).toContain('Nobody has said')
    // Both controls: one to add another, one to edit this one.
    expect(projects).toContain('Add a project')
    expect(projects).toContain('>Edit<')

    const risks = renderToStaticMarkup(<PortfolioRisks />)
    expect(risks).toContain('The vendor has not signed')
    expect(risks).toContain('Challenge')
    // An ungraded row prints the same refusal rather than "Low".
    expect(risks).toContain('Nobody has said')
    expect(risks).not.toContain('>Low<')

    fx.state.data = fx.empty
  })
})
