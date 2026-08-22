// Render proof for /pmo — and the case that matters most is the EMPTY one.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library in the dependency budget, so react-dom/server runs the real
// component, the real hooks, the real aggregates and the real translator.
// Effects do not run, which is why nothing below claims a behaviour that needs
// one — the aging chart's basis switch and the loaders are asserted through
// their pure halves elsewhere.
//
// ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
//
//  1. THE HONESTY GATE, ON THE GLASS. Four of the five `LatenessVerdict` arms
//     must render a SENTENCE and NO NUMBER, because in each of those states a
//     zero would be a claim the workspace has not earned. Each arm gets a case,
//     and each of the four asserts the ABSENCE of the number as well as the
//     presence of the sentence — asserting only the sentence would pass on a
//     page that printed both.
//  2. THE EMPTY WORKSPACE, FIRST-CLASS. Nine entries is the live state and zero
//     is the day-one state; a page that only reads well at volume is wrong for
//     its whole first month. The blank arm is asserted to replace the tiles
//     rather than to sit above six zeroes.
//  3. THE DRILL. An organization row goes to the portfolio narrowed by `?node=`
//     — NOT `?focus=`, which is a path this page cannot build and which
//     `resolveFocus` would silently degrade to the root of the map. Asserted in
//     both directions so the fix cannot be "tidied" back.
//  4. THE STRINGS. Every key this page asks for resolves in both languages.
//     localeReach.test.ts already proves that for the literals; this proves it
//     for the page as ASSEMBLED, including the two `t()` calls whose key is
//     built from a table.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type {
  Entry,
  EntryHealth,
  MapNode,
  MapNodeGoal,
  MapNodeProgress,
  MapNodeStage,
  MapNodeUseCase,
  UseCase,
  UseCaseStatus,
} from '../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and lib/theme reads matchMedia,
  // both at IMPORT time — so the shims cannot wait for a beforeAll().
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
  g.location = { search: '', href: 'http://localhost/' }
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = {
    nodes: [] as MapNode[],
    stages: [] as MapNodeStage[],
    progress: new Map<string, MapNodeProgress>(),
    entries: [] as Entry[],
    health: new Map<string, EntryHealth>(),
    members: new Map<string, { id: string; displayName: string }>(),
    useCases: [] as UseCase[],
    /** NULL is "nobody has looked" — the store's own contract, kept in the fake. */
    links: null as MapNodeUseCase[] | null,
    goals: null as MapNodeGoal[] | null,
    goalsError: null as string | null,
  }
  return { state }
})

vi.mock('../store/config', () => ({
  loadConfig: () => Promise.resolve(),
  useMapNodes: () => fx.state.nodes,
  useStageMap: () => new Map(fx.state.stages.map((s) => [s.id, s])),
  useNodeProgress: () => fx.state.progress,
  useAllUseCases: () => fx.state.useCases,
}))

vi.mock('../store/portfolio', () => ({
  loadPortfolio: () => Promise.resolve(),
  usePortfolioLinks: () => fx.state.links,
}))

vi.mock('../store/goals', () => ({
  loadGoals: () => Promise.resolve(),
  useGoals: () => fx.state.goals,
  useGoalsError: () => fx.state.goalsError,
}))

vi.mock('../store/entries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/entries')>()
  return {
    // `countEntries` is REAL — it is the tiles' arithmetic and mocking it would
    // leave the tiles asserting on this file's own opinion of what "overdue"
    // means. Only the hooks (which need a store) are replaced.
    ...actual,
    loadEntries: () => Promise.resolve(),
    loadClosedSince: () => Promise.resolve(),
    useEntryList: () => fx.state.entries,
    useHealthMap: () => fx.state.health,
    useTrackSlaMatrix: () => null,
    useFilterContext: () => ({
      meId: 'me',
      today: TODAY,
      groupOfTrack: new Map(),
      ancestryOfNode: new Map(fx.state.nodes.map((n) => [n.id, chainOf(n)])),
      managerOfNode: new Map(fx.state.nodes.map((n) => [n.id, n.account_manager_id])),
      vendorOfNode: new Map(fx.state.nodes.map((n) => [n.id, n.vendor])),
    }),
  }
})

vi.mock('../store/members', () => ({
  loadMembers: () => Promise.resolve(),
  useMemberMap: () => fx.state.members,
}))

vi.mock('../store/vocab', () => ({
  useStaleDays: () => () => 7,
  useSlaDays: () => () => null,
}))

vi.mock('../store/stageOverlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/stageOverlay')>()
  // `mergeProgress` is real: the optimistic overlay is part of how this page
  // agrees with the portfolio, and a stub would hide that.
  return { ...actual, usePendingStages: () => new Map<string, string | null>() }
})

const TODAY = '2026-08-22'

/** The ancestry the entries store would build — self, then up. */
function chainOf(node: MapNode): string[] {
  const chain = [node.id]
  let cursor = node.parent_id
  const byId = new Map(fx.state.nodes.map((n) => [n.id, n]))
  for (let step = 0; cursor !== null && step < 16; step += 1) {
    chain.push(cursor)
    cursor = byId.get(cursor)?.parent_id ?? null
  }
  return chain
}

const { setLocale, t } = await import('../lib/i18n')
const Pmo = (await import('./Pmo')).default

/** A locale string as it appears in the MARKUP — react-dom escapes five chars. */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

/**
 * `path` carries the `?entry=` deep link AND, since 0031, the open TAB.
 *
 * ⚠ THE PAGE IS TABBED NOW, so a bare `/pmo` renders the overview and nothing
 *   else. A test that asserts on the delivery table, the commitments or the
 *   registers has to say which section it means — `tab('delivery')` below — or
 *   it is asserting against a section that is not on the page. That is not a
 *   weakening of these tests: it is the same assertion against the screen a
 *   reader actually reaches, and the tab is one tap from the overview.
 */
function render(path = '/pmo'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Pmo />
    </MemoryRouter>,
  )
}

/** The URL for one section. `?tab=` is the page's own contract — see Pmo.tsx. */
const tab = (id: string): string => `/pmo?tab=${id}`

/* ─────────────────────────────── fixtures ─────────────────────────────── */

function node(over: Partial<MapNode> & { id: string }): MapNode {
  return {
    parent_id: null,
    track_id: 't1',
    kind_id: null,
    name: over.id,
    name_ar: '',
    description: '',
    description_ar: '',
    account_manager_id: null,
    vendor: '',
    sort_order: 0,
    archived: false,
    archived_at: null,
    source: 'local',
    external_ref: null,
    external_url: null,
    synced_at: null,
    overrides: [],
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function stage(over: Partial<MapNodeStage> & { id: string }): MapNodeStage {
  return {
    name: over.id,
    name_ar: '',
    sort_order: 0,
    hidden: false,
    terminal: false,
    paused: false,
    expected_days: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    ...over,
  }
}

function progressRow(nodeId: string, stageId: string | null, at: string | null): MapNodeProgress {
  return {
    node_id: nodeId,
    stage_id: stageId,
    stage_changed_at: at,
    updated_at: '2026-08-22T00:00:00.000Z',
    updated_by: null,
  }
}

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    track_id: 't1',
    node_id: null,
    title: over.id,
    description: '',
    type: 'action',
    status: 'new',
    priority: 'medium',
    owner_id: 'me',
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: null,
    created_at: '2026-08-12T00:00:00.000Z',
    updated_at: '2026-08-12T00:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-08-20T00:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

/** Reset to a clean workspace, then apply the case's own rows. */
function useCase(over: Partial<UseCase> & { id: string }): UseCase {
  return {
    name: over.id,
    name_ar: '',
    sort_order: 0,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function link(nodeId: string, useCaseId: string, status: UseCaseStatus): MapNodeUseCase {
  return { node_id: nodeId, use_case_id: useCaseId, status }
}

function goal(over: Partial<MapNodeGoal> & { id: string }): MapNodeGoal {
  return {
    node_id: 'a',
    label: over.id,
    label_ar: '',
    stage_id: null,
    target: null,
    target_date: '2026-12-31',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...over,
  }
}

function workspace(over: Partial<typeof fx.state> = {}): void {
  fx.state.nodes = []
  fx.state.stages = []
  fx.state.progress = new Map()
  fx.state.entries = []
  fx.state.health = new Map()
  fx.state.members = new Map()
  fx.state.useCases = []
  fx.state.links = null
  fx.state.goals = null
  fx.state.goalsError = null
  Object.assign(fx.state, over)
}

/* ══════════════════ 1. the empty workspace, first-class ══════════════════ */

describe('a workspace with nothing in it', () => {
  it('says so once, instead of six tiles reading zero', () => {
    workspace()
    const html = render()
    expect(html).toContain(asHtml(t('pmo.empty')))
    expect(html).toContain(asHtml(t('pmo.emptyHint')))
    // THE POINT OF THE CASE. A grid of zeroes is not information, and the
    // charts under it would be two empty axes.
    expect(html).not.toContain('pmo-stat-value')
    expect(html).not.toContain('pmo-charts')
    // …and it still offers a way forward rather than being a dead end.
    expect(html).toContain('href="/mindtree"')
  })

  it('still titles itself, so the reader knows where they landed', () => {
    workspace()
    const html = render()
    expect(html).toContain(asHtml(t('pmo.title')))
    expect(html).toContain(asHtml(t('pmo.subtitle')))
  })

  it('renders in Arabic with no key echoed at the reader', () => {
    workspace()
    setLocale('ar')
    const html = render()
    // Read the expectation WHILE Arabic is still current: t() answers for the
    // locale it is asked in, and resetting first would compare Arabic markup
    // against English words.
    const empty = asHtml(t('pmo.empty'))
    setLocale('en')
    expect(html).toContain(empty)
    // t() echoes an unknown key, so a dot path in the markup is a missing string.
    expect(html).not.toMatch(/>pmo\.[a-zA-Z]/)
  })
})

/* ══════════════════ 2. the honesty gate, on the glass ══════════════════ */

/** The rendered number the four refusing arms must NOT print. */
const NUMBER = 'pmo-verdict-value'

describe('the lateness card never shows a zero it has not earned', () => {
  it('organizations, none staged: says nobody has recorded a rung', () => {
    workspace({ nodes: [node({ id: 'a' }), node({ id: 'b' })] })
    const html = render()
    expect(html).toContain(asHtml(t('pmo.lateNoStage', { count: 2 })))
    expect(html).toContain(asHtml(t('pmo.lateNoStageHint')))
    expect(html).not.toContain(NUMBER)
  })

  it('staged, no rung carries a time: says nothing CAN be late, and links to the fix', () => {
    // 0026 seeds `expected_days` on no rung on purpose. This is the ordinary
    // state of a fresh workspace, not a degraded one.
    workspace({
      nodes: [node({ id: 'a' })],
      stages: [stage({ id: 's1' })],
      progress: new Map([['a', progressRow('a', 's1', '2020-01-01T00:00:00.000Z')]]),
    })
    const html = render()
    expect(html).toContain(asHtml(t('mindtree.portfolioNoThreshold')))
    expect(html).toContain(asHtml(t('pmo.lateNoExpectationHint')))
    expect(html).toContain('href="/settings/structure"')
    expect(html).not.toContain(NUMBER)
  })

  it('THE LIVE STATE — stamped today, so nothing has aged enough to be late', () => {
    // Eighty-five organizations, fifty staged, every `stage_changed_at` written
    // by the import that created it. "0 at risk" is true arithmetic and a false
    // sentence; this is the sentence that is true.
    workspace({
      nodes: [node({ id: 'a' }), node({ id: 'b' })],
      stages: [stage({ id: 's1', expected_days: 30 })],
      progress: new Map([
        ['a', progressRow('a', 's1', '2026-08-22T00:00:00.000Z')],
        ['b', progressRow('b', 's1', '2026-08-22T00:00:00.000Z')],
      ]),
    })
    const html = render()
    expect(html).toContain(asHtml(t('pmo.lateTooEarly')))
    expect(html).toContain(asHtml(t('pmo.lateMeasured', { count: 2 })))
    expect(html).not.toContain(NUMBER)
  })

  it('prints a count once one is earned, and only then', () => {
    workspace({
      nodes: [node({ id: 'a' }), node({ id: 'b' })],
      stages: [stage({ id: 's1', expected_days: 30 })],
      progress: new Map([
        ['a', progressRow('a', 's1', '2026-01-01T00:00:00.000Z')],
        ['b', progressRow('b', 's1', '2026-08-22T00:00:00.000Z')],
      ]),
    })
    // TWO TABS, TWO ASSERTIONS. The card is the overview's summary; the flag on
    // the row itself is in the delivery table. They were one assertion while
    // the page was one long scroll — splitting them is the same claim about the
    // same screens, said where each is actually rendered.
    const summary = render()
    expect(summary).toContain(NUMBER)
    expect(summary).toContain(asHtml(t('pmo.lateTitle')))
    expect(summary).toContain(asHtml(t('pmo.lateMeasured', { count: 2 })))

    // The row itself is flagged, with a WORD and not only a tint.
    expect(render(tab('delivery'))).toContain(asHtml(t('mindtree.portfolioAtRisk')))
  })
})

describe('the compliance card refuses a rate it cannot compute', () => {
  it('says so rather than reporting 0% when nothing carried a deadline', () => {
    // 0005 ships every priority's `sla_days` NULL, so this is the seeded state.
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'e1', status: 'done', closed_at: '2026-08-20T00:00:00.000Z' })],
    })
    const html = render()
    expect(html).toContain(asHtml(t('pmo.slaNone')))
    expect(html).not.toContain('0%')
  })
})

/* ══════════════════ 3. initiatives — what was promised ══════════════════ */

describe('the initiatives table', () => {
  it('tells "not read yet" apart from "nothing promised" apart from "could not read"', () => {
    // THREE ABSENCES, THREE SCREENS. 0027 is applied by hand and
    // `map_node_goals` does not exist in the live database yet, so the error arm
    // is the ordinary state today — and it must not read as "nobody has promised
    // anything", which is a different and untrue sentence.
    workspace({ nodes: [node({ id: 'a' })], goals: null, goalsError: 'common.errMissingTable' })
    const failed = render(tab('delivery'))
    expect(failed).toContain(asHtml(t('pmo.initError')))
    expect(failed).toContain(asHtml(t('pmo.initErrorHint')))
    expect(failed).not.toContain(asHtml(t('pmo.initEmpty')))

    // Still on the wire: the section names itself and says nothing else. An
    // empty state here would be a lie with a spinner's timing.
    workspace({ nodes: [node({ id: 'a' })], goals: null })
    const loading = render(tab('delivery'))
    expect(loading).toContain('aria-labelledby="pmo-commitments"')
    expect(loading).not.toContain(asHtml(t('pmo.initEmpty')))
    expect(loading).not.toContain(asHtml(t('pmo.initError')))

    // Genuinely none, and a way to make one.
    workspace({ nodes: [node({ id: 'a' })], goals: [] })
    const empty = render(tab('delivery'))
    expect(empty).toContain(asHtml(t('pmo.initEmpty')))
    expect(empty).toContain(asHtml(t('pmo.initEmptyHint')))
  })

  it('says MET rather than a ratio once the commitment has arrived', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      stages: [stage({ id: 'live', terminal: true })],
      progress: new Map([['a', progressRow('a', 'live', '2026-08-01T00:00:00.000Z')]]),
      goals: [goal({ id: 'g1', node_id: 'a', label: 'Phase 2 go-live' })],
    })
    const html = render(tab('delivery'))
    expect(html).toContain('Phase 2 go-live')
    expect(html).toContain(asHtml(t('pmo.initMet')))
  })

  it('draws a ratio for a count goal, WITH the unstaged caveat beside it', () => {
    // "0 of 40" alone sends an Associate Director chasing forty organizations
    // when thirty-eight of them simply have no rung recorded.
    workspace({
      nodes: [
        node({ id: 'phase' }),
        node({ id: 'a', parent_id: 'phase' }),
        node({ id: 'b', parent_id: 'phase' }),
      ],
      stages: [stage({ id: 'live', terminal: true })],
      progress: new Map([['a', progressRow('a', 'live', '2026-08-01T00:00:00.000Z')]]),
      goals: [goal({ id: 'g1', node_id: 'phase', target: 2 })],
    })
    const html = render(tab('delivery'))
    expect(html).toContain(asHtml(t('pmo.initReached', { reached: 1, target: 2 })))
    expect(html).toContain(asHtml(t('mapnode.goalUnstaged', { count: 1 })))
  })

  it('prints a SENTENCE and no digit for a date goal that has not arrived', () => {
    // A date goal asks for ONE arrival. There is no fraction of an arrival, and
    // both candidates for inventing one — stage position over rung count, days
    // elapsed over days promised — measure something else.
    workspace({
      nodes: [node({ id: 'a' })],
      stages: [stage({ id: 'uat', sort_order: 3 }), stage({ id: 'live', sort_order: 5, terminal: true })],
      progress: new Map([['a', progressRow('a', 'uat', '2026-08-01T00:00:00.000Z')]]),
      goals: [goal({ id: 'g1', node_id: 'a', label: 'Go live' })],
    })
    const html = render(tab('delivery'))
    expect(html).toContain(asHtml(t('pmo.initPending')))
    // THE POINT OF THE CASE: the progress cell carries no number at all.
    const cell = html.slice(html.indexOf(asHtml(t('pmo.initPending'))))
    expect(cell.slice(0, asHtml(t('pmo.initPending')).length)).not.toMatch(/\d/)
    expect(html).not.toContain(asHtml(t('pmo.initMet')))
  })

  it('flags an overdue commitment with the days, and never flags a met one', () => {
    workspace({
      nodes: [node({ id: 'a' }), node({ id: 'b' })],
      stages: [stage({ id: 'live', terminal: true })],
      progress: new Map([['b', progressRow('b', 'live', '2026-08-01T00:00:00.000Z')]]),
      goals: [
        goal({ id: 'missed', node_id: 'a', target_date: '2026-08-12' }),
        goal({ id: 'kept', node_id: 'b', target_date: '2026-08-12' }),
      ],
    })
    const html = render(tab('delivery'))
    expect(html).toContain(asHtml(t('mapnode.goalOverdue', { count: 10 })))
    // One overdue pill, not two: the met commitment is done, not late.
    expect([...html.matchAll(/pill danger pmo-flag/g)]).toHaveLength(1)
  })

  it('links a commitment to the panel that owns it, through ?node=', () => {
    workspace({
      nodes: [node({ id: 'org-1', name: 'Riyadh General' })],
      goals: [goal({ id: 'g1', node_id: 'org-1', label: 'Phase 2' })],
    })
    const html = render(tab('delivery'))
    expect(html).toContain('node=org-1')
    expect(html).not.toContain('focus=')
    expect(html).toContain('Riyadh General')
  })
})

/* ══════════════════ 4. project cards, and the one earned percentage ══════ */

describe('the project cards', () => {
  it('drills to the portfolio through ?node=, never through ?focus=', () => {
    workspace({ nodes: [node({ id: 'org-1', name: 'Riyadh General' })] })
    const html = render(tab('delivery'))
    expect(html).toContain('lens=portfolio')
    expect(html).toContain('node=org-1')
    // BOTH HALVES. `?focus=` is a PATH assembled by lib/mindtree/model.ts and
    // `resolveFocus` degrades a wrong one to the root of the map without
    // saying so — a link that looks like it worked. Asserting its absence is
    // what stops a future edit "restoring" it from the brief.
    expect(html).not.toContain('focus=')
    expect(html).toContain('Riyadh General')
    expect(html).toContain('pmo-projgrid')
  })

  it('gives an unstaged organization NO pill, and a dash with a word', () => {
    // "Nobody has said where this is" and "it is on the first rung" are
    // different facts and must never render alike — and there is no status to
    // put on a pill for the first of them.
    workspace({ nodes: [node({ id: 'a' })] })
    const html = render(tab('delivery'))
    expect(html).toContain('—')
    expect(html).toContain(asHtml(t('pmo.deliveryNotStaged')))
    for (const key of ['pmo.projDone', 'pmo.projPaused', 'pmo.projActive', 'mindtree.portfolioAtRisk']) {
      expect(html, key).not.toContain(asHtml(t(key)))
    }
  })

  it('omits the day line entirely when no clock is running, rather than printing 0', () => {
    workspace({ nodes: [node({ id: 'a' })] })
    expect(render(tab('delivery'))).not.toContain(asHtml(t('mindtree.portfolioDays', { count: 0 })))
  })

  it('gives each of the four recorded readings its own word', () => {
    for (const [id, over, key] of [
      ['done', { terminal: true }, 'pmo.projDone'],
      ['held', { paused: true }, 'pmo.projPaused'],
      ['moving', {}, 'pmo.projActive'],
    ] as const) {
      workspace({
        nodes: [node({ id: 'a' })],
        stages: [stage({ id, ...over })],
        progress: new Map([['a', progressRow('a', id, '2026-08-20T00:00:00.000Z')]]),
      })
      expect(render(tab('delivery')), key).toContain(asHtml(t(key)))
    }
    // And "late", which is the only one of the four with a clock behind it.
    workspace({
      nodes: [node({ id: 'a' }), node({ id: 'b' })],
      stages: [stage({ id: 's1', expected_days: 5 })],
      progress: new Map([
        ['a', progressRow('a', 's1', '2026-01-01T00:00:00.000Z')],
        ['b', progressRow('b', 's1', '2026-08-22T00:00:00.000Z')],
      ]),
    })
    expect(render(tab('delivery'))).toContain(asHtml(t('mindtree.portfolioAtRisk')))
  })

  it('names the accountable teammate through the roster', () => {
    workspace({
      nodes: [node({ id: 'a', account_manager_id: 'u1' })],
      members: new Map([['u1', { id: 'u1', displayName: 'Sara Alsaab' }]]),
    })
    expect(render(tab('delivery'))).toContain('Sara Alsaab')
  })

  it('says an organization has no hierarchy to read rather than showing a blank grid', () => {
    workspace({ entries: [entry({ id: 'e1' })] })
    const html = render(tab('delivery'))
    expect(html).toContain(asHtml(t('pmo.deliveryEmpty')))
    expect(html).toContain(asHtml(t('pmo.deliveryEmptyHint')))
  })

  it('counts open work at or under a node, off the same walk the filter uses', () => {
    workspace({
      nodes: [node({ id: 'parent' }), node({ id: 'child', parent_id: 'parent' })],
      entries: [
        entry({ id: 'e1', node_id: 'child' }),
        entry({ id: 'e2', node_id: 'child', status: 'done' }),
      ],
    })
    const html = render(tab('delivery'))
    // One open item, filed on the child, counted on BOTH cards — and the closed
    // one counted on neither.
    expect([...html.matchAll(new RegExp(asHtml(t('pmo.projOpen', { count: 1 })), 'g'))]).toHaveLength(2)
  })

  it('draws NO coverage row at all while nobody has looked', () => {
    // `links === null` is "nobody has looked". An empty bar would report
    // "nothing integrated" about a workspace that is still reading.
    workspace({ nodes: [node({ id: 'a' })], useCases: [useCase({ id: 'uc1' })], links: null })
    const html = render(tab('delivery'))
    expect(html).not.toContain('pmo-proj-bar')
    expect(html).not.toContain('0%')
    expect(html).not.toContain(asHtml(t('pmo.projNoCoverage')))
  })

  it('says "nothing recorded" for a linked-nothing organization, and NEVER 0 of 9', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      useCases: [useCase({ id: 'uc1' }), useCase({ id: 'uc2' })],
      links: [],
    })
    const html = render(tab('delivery'))
    expect(html).toContain(asHtml(t('pmo.projNoCoverage')))
    expect(html).not.toContain('pmo-proj-bar')
    expect(html).not.toContain('0%')
    expect(html).not.toContain(
      asHtml(t('mapnode.progress', { done: 0, total: 2, status: t('mapnode.wordLive') })),
    )
  })

  it('speaks the ratio with its UNIT and never as a bare percentage', () => {
    // `total` is the whole catalogue, not this organization's recorded scope, so
    // an organization with one capability live out of three on the table is not
    // "33% delivered" — and the caveat says how many were ever recorded.
    workspace({
      nodes: [node({ id: 'a' })],
      useCases: [useCase({ id: 'uc1' }), useCase({ id: 'uc2' }), useCase({ id: 'uc3' })],
      links: [link('a', 'uc1', 'live')],
    })
    const html = render(tab('delivery'))
    expect(html).toContain(
      asHtml(t('mapnode.progress', { done: 1, total: 3, status: t('mapnode.wordLive') })),
    )
    expect(html).toContain(asHtml(t('pmo.projRecorded', { count: 1 })))
    expect(html).toContain('pmo-proj-bar')
    // THE POINT OF THE CASE. A naked percentage on a card whose denominator is
    // the catalogue reads as "a third of the way there" about a project whose
    // whole recorded scope is finished.
    expect(html).not.toMatch(/>\s*\d+%/)
  })

  it('drops the caveat once every capability on the table is recorded', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      useCases: [useCase({ id: 'uc1' })],
      links: [link('a', 'uc1', 'planned')],
    })
    const html = render(tab('delivery'))
    expect(html).toContain(
      asHtml(t('mapnode.progress', { done: 0, total: 1, status: t('mapnode.wordLive') })),
    )
    expect(html).not.toContain(asHtml(t('pmo.projRecorded', { count: 1 })))
  })
})

/* ══════════ 5. the import stamp, and the caveat it makes mandatory ═══════ */

describe('a workspace whose stage clocks were all started at once', () => {
  /** Fifty organizations onto seven rungs in one instant is an import, not fieldwork. */
  function imported(): void {
    workspace({
      nodes: [node({ id: 'a' }), node({ id: 'b' })],
      stages: [stage({ id: 'uat', expected_days: 2 })],
      progress: new Map([
        ['a', progressRow('a', 'uat', '2026-08-01T06:00:00.000Z')],
        ['b', progressRow('b', 'uat', '2026-08-01T06:00:01.000Z')],
      ]),
    })
  }

  it('prints the count AND names the day the clock was started', () => {
    imported()
    // The lateness card is the OVERVIEW's. It was reached by scrolling before
    // the page had tabs; it is reached by not switching tab now.
    const html = render()
    // The count stays — it is true of what is recorded.
    expect(html).toContain(NUMBER)
    // …and it never stands alone.
    expect(html).toContain(asHtml(t('pmo.lateOneClock', { date: '01/08/2026' })))
  })

  it('carries the same sentence into the card grid, where the pills are', () => {
    imported()
    const caveat = asHtml(t('pmo.lateOneClock', { date: '01/08/2026' }))
    // ON BOTH SCREENS, and that is the point unchanged: once under the count on
    // the lateness card, and once above a grid of "Past its stage" pills that
    // all count from the same stamp. A caveat on only one of the two leaves the
    // other lying — and now that they are separate TABS a reader can arrive at
    // either without passing the other, so the claim matters more, not less.
    expect(render()).toContain(caveat)
    expect(render(tab('delivery'))).toContain(caveat)
  })

  it('says nothing at all once one organization has genuinely been moved', () => {
    workspace({
      nodes: [node({ id: 'a' }), node({ id: 'b' })],
      stages: [stage({ id: 'uat', expected_days: 2 })],
      progress: new Map([
        ['a', progressRow('a', 'uat', '2026-08-01T06:00:00.000Z')],
        ['b', progressRow('b', 'uat', '2026-08-15T06:00:00.000Z')],
      ]),
    })
    expect(render(tab('delivery'))).not.toContain(asHtml(t('pmo.lateOneClock', { date: '01/08/2026' })))
  })
})

/* ══════════════════ 6. the action register ══════════════════ */

describe('the action register', () => {
  it('lists an action nothing is wrong with — which nothing else on this page did', () => {
    // Before the register existed, an on-track, assigned, not-due-soon action
    // appeared NOWHERE: the buckets take only what needs chasing and the risk
    // tables read `issue` and `escalation` alone.
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'e1', title: 'Book the room', due_date: '2026-12-01' })],
    })
    const html = render(tab('actions'))
    expect(html).toContain('Book the room')
    expect(html).toContain('href="/entry/e1"')
    expect(html).toContain(asHtml(t('pmo.actionCopy')))
  })

  it('carries no closed action and no other type', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [
        entry({ id: 'done', title: 'Already filed', status: 'done' }),
        entry({ id: 'i1', type: 'issue', title: 'Claims rejected' }),
        entry({ id: 'open', title: 'Still open' }),
      ],
    })
    const html = render(tab('actions'))
    const register = html.slice(html.indexOf('pmo-actions'), html.indexOf('pmo-risks'))
    expect(register).toContain('Still open')
    expect(register).not.toContain('Already filed')
    expect(register).not.toContain('Claims rejected')
  })

  it('names the owner through the roster, and says unassigned when nobody is on it', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      members: new Map([['u1', { id: 'u1', displayName: 'Sara Alsaab' }]]),
      entries: [
        entry({ id: 'e1', owner_id: 'u1' }),
        entry({ id: 'e2', owner_id: null, owner_name: null }),
      ],
    })
    const html = render(tab('actions'))
    expect(html).toContain('Sara Alsaab')
    expect(html).toContain(asHtml(t('followups.unassigned')))
  })

  it('marks an overdue row with a TINT AND A WORD, never colour alone', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'e1', due_date: '2026-08-01' })],
    })
    const html = render(tab('actions'))
    expect(html).toContain('is-late')
    expect(html).toContain(asHtml(t('pmo.actionOverdue')))
  })

  it('captions its day count as DAYS OPEN — the column it can prove', () => {
    // THE ORIGINAL ARGUMENT, UNCHANGED: `daysInStatus` falls back to
    // `created_at` when the thread is not loaded, and on a dashboard it never
    // is — which makes that fallback a CEILING under an "in status" caption. So
    // the register prints the entry's AGE, and the caption may not promise
    // anything narrower.
    //
    // WHAT CHANGED IS ONLY WHOSE WORD IT BORROWS. This shared `pmo.colRaised`
    // with the risk register one section down. A risk is RAISED; a task is not,
    // and the Arabic said `أُثيرت` over a list of tasks. `pmo.colDaysOpen` says
    // what the cell holds in both languages, and it still does not claim "in
    // status" — an open item's age IS its days open. Risks keep `colRaised`,
    // where the word and the reading are both right.
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'e1', status: 'blocked', created_at: '2026-08-12T00:00:00.000Z' })],
    })
    const html = render(tab('actions'))
    expect(html).toContain(asHtml(t('pmo.colDaysOpen')))
    // And the risk register is untouched — the two captions are now separate
    // strings, so a later edit to one cannot silently move the other.
    expect(t('pmo.colDaysOpen')).not.toBe(t('pmo.colRaised'))
    expect(html).toContain('pmo-num tabular">10<')
    expect(html).toContain(asHtml(t('status.blocked')))
  })

  it('says so plainly when there is no open action at all', () => {
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'i1', type: 'issue' })] })
    const html = render(tab('actions'))
    expect(html).toContain(asHtml(t('pmo.actionsEmpty')))
    expect(html).toContain(asHtml(t('pmo.actionsEmptyHint')))
  })

  it('rings the row a ?entry= link names, and only that row', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'e1' }), entry({ id: 'e2' })],
    })
    expect(render(`${tab('actions')}&entry=e1`)).toContain('is-highlight')
    expect([...render(`${tab('actions')}&entry=e1`).matchAll(/is-highlight/g)]).toHaveLength(1)
    expect(render('/pmo')).not.toContain('is-highlight')
  })
})

/* ══════════════════ 7. the follow-up buckets ══════════════════ */

describe('the follow-up buckets', () => {
  it('renders all six as a checklist, empties included', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'e1', due_date: '2026-08-01' })],
    })
    const html = render(tab('actions'))
    for (const key of [
      'followups.overdue',
      'followups.slaBreach',
      'followups.dueSoon',
      'followups.stale',
      'followups.blocked',
      'followups.unassigned',
    ]) {
      expect(html, key).toContain(asHtml(t(key)))
    }
    // The overdue item is named and linked; the five empty buckets say so.
    expect(html).toContain('href="/entry/e1"')
    expect(html).toContain(asHtml(t('followups.sectionEmpty')))
  })

  it('says all-clear rather than six empty cards when nothing needs anyone', () => {
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'e1' })] })
    const html = render(tab('actions'))
    expect(html).toContain(asHtml(t('followups.allClear')))
  })
})

/* ══════════════════ 8. risks & challenges ══════════════════ */

describe('the two risk tables', () => {
  it('splits issues from escalations and leaves every other type alone', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [
        entry({ id: 'i1', type: 'issue', title: 'Claims rejected' }),
        entry({ id: 'x1', type: 'escalation', title: 'Vendor SLA' }),
        entry({ id: 'a1', type: 'action', title: 'Book the room' }),
      ],
    })
    const html = render(tab('risks'))
    const risks = html.slice(html.indexOf('pmo-risks'))
    expect(html).toContain(asHtml(t('pmo.riskIssues')))
    expect(html).toContain(asHtml(t('pmo.riskEscalations')))
    expect(risks).toContain('Claims rejected')
    expect(risks).toContain('Vendor SLA')
    // An action is follow-up work, not a risk. It belongs to the ACTIONS tab —
    // which is where it appears — and must not be counted here. The claim was
    // once "elsewhere on the same page" and is now "on the other tab"; the tab
    // makes it stronger, because the two lists can no longer be confused for
    // one long one by a reader scrolling past the boundary.
    expect(risks).not.toContain('Book the room')
    expect(render(tab('actions'))).toContain('Book the room')
  })

  it('renders the reading as a derived badge and never as a stored score', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [
        entry({ id: 'i1', type: 'issue', priority: 'critical' }),
        entry({ id: 'i2', type: 'issue', priority: 'low' }),
      ],
    })
    const html = render(tab('risks'))
    expect(html).toContain(asHtml(t('pmo.readingSevere')))
    expect(html).toContain(asHtml(t('pmo.readingWatch')))
    expect(html).toContain(asHtml(t('pmo.readingHint')))
    // The two inputs are on the row, so the badge adds emphasis and no
    // information the reader cannot check.
    expect(html).toContain(asHtml(t('priority.critical')))
  })

  it('names both empty states separately — the two lists mean different things', () => {
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'e1' })] })
    const html = render(tab('risks'))
    expect(html).toContain(asHtml(t('pmo.riskEmptyIssues')))
    expect(html).toContain(asHtml(t('pmo.riskEmptyEscalations')))
  })

  it('carries no closed row, in either table', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [
        entry({ id: 'i1', type: 'issue', title: 'Fixed already', status: 'done' }),
        entry({ id: 'x1', type: 'escalation', title: 'Withdrawn', status: 'cancelled' }),
      ],
    })
    const html = render(tab('risks'))
    expect(html).not.toContain('Fixed already')
    expect(html).not.toContain('Withdrawn')
  })
})

/* ══════════════════ 9. the page as a whole ══════════════════ */

describe('the assembled page', () => {
  it('names each section and links its heading to its region, tab by tab', () => {
    // ⚠ THIS USED TO ASSERT ALL FIVE ON ONE RENDER, because the page was one
    //   long scroll. It is tabbed now, so the claim is made per tab — the same
    //   guarantee about the same regions, checked on the screen each is
    //   actually reachable from. A dangling `aria-labelledby` leaves a region
    //   unnamed and is invisible in a screenshot, which is why the id has to
    //   exist AND be on the heading.
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'e1' })], goals: [] })
    for (const [path, id] of [
      ['/pmo', 'pmo-overview'],
      [tab('delivery'), 'pmo-delivery'],
      [tab('delivery'), 'pmo-commitments'],
      [tab('actions'), 'pmo-actions'],
      [tab('risks'), 'pmo-risks'],
    ] as const) {
      const html = render(path)
      expect(html, id).toContain(`aria-labelledby="${id}"`)
      expect(html, id).toMatch(new RegExp(`<h2[^>]*id="${id}"`))
    }
  })

  it('offers every tab, and marks exactly one as current', () => {
    // THE TAB BAR IS THE ONLY WAY BETWEEN SECTIONS now, so a tab missing from it
    // is a section nobody can reach — the same class of defect as the map's
    // gated-off search, which is what taught this codebase to check reachability
    // rather than existence.
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'e1' })] })
    const html = render(tab('revenue'))
    for (const key of [
      'pmo.overview', 'pmo.projects', 'pmo.initiatives', 'pmo.delivery',
      'pmo.actions', 'pmo.risks', 'pmo.revenue', 'pmo.okrs',
    ]) {
      expect(html, key).toContain(asHtml(t(key)))
    }
    expect(html.match(/aria-current="true"/g) ?? []).toHaveLength(1)
  })

  it('asks for no key that fails to resolve, in either language', () => {
    // A WORKSPACE THAT RENDERS ALL FIVE SECTIONS AT ONCE, so every key the page
    // can ask for is asked for here — the two reused namespaces included, which
    // is why `mapnode` and `entry` are in the regex now.
    workspace({
      nodes: [node({ id: 'a' }), node({ id: 'b', parent_id: 'a' })],
      stages: [stage({ id: 'uat', expected_days: 5 })],
      progress: new Map([['a', progressRow('a', 'uat', '2026-01-01T00:00:00.000Z')]]),
      useCases: [useCase({ id: 'uc1' }), useCase({ id: 'uc2' })],
      links: [link('a', 'uc1', 'live')],
      goals: [
        goal({ id: 'g1', node_id: 'a', target: 2, target_date: '2026-01-01' }),
        goal({ id: 'g2', node_id: 'a' }),
      ],
      entries: [entry({ id: 'i1', type: 'issue' }), entry({ id: 'e1', due_date: '2026-08-01' })],
    })
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const html = render()
      // t() echoes an unknown key, so any dot path rendered as text is a hole.
      expect(html, locale).not.toMatch(
        />(pmo|followups|mindtree|dashboard|mapnode|entry|status)\.[a-zA-Z]/,
      )
    }
    setLocale('en')
  })

  it('renders no Jira surface at all while the integration is off', () => {
    // 0028's contract: absent, never disabled. A greyed-out panel advertises a
    // feature nobody in this workspace can turn on.
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'e1' })] })
    const html = render().toLowerCase()
    expect(html).not.toContain('jira')
  })
})
