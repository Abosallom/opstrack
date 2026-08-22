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
import type { Entry, EntryHealth, MapNode, MapNodeProgress, MapNodeStage } from '../types'

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
  }
  return { state }
})

vi.mock('../store/config', () => ({
  loadConfig: () => Promise.resolve(),
  useMapNodes: () => fx.state.nodes,
  useStageMap: () => new Map(fx.state.stages.map((s) => [s.id, s])),
  useNodeProgress: () => fx.state.progress,
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

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Pmo />
    </MemoryRouter>,
  )
}

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
function workspace(over: Partial<typeof fx.state> = {}): void {
  fx.state.nodes = []
  fx.state.stages = []
  fx.state.progress = new Map()
  fx.state.entries = []
  fx.state.health = new Map()
  fx.state.members = new Map()
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
    const html = render()
    expect(html).toContain(NUMBER)
    expect(html).toContain(asHtml(t('pmo.lateTitle')))
    expect(html).toContain(asHtml(t('pmo.lateMeasured', { count: 2 })))
    // The row itself is flagged, with a WORD and not only a tint.
    expect(html).toContain(asHtml(t('mindtree.portfolioAtRisk')))
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

/* ══════════════════ 3. delivery, and where a row goes ══════════════════ */

describe('the delivery table', () => {
  it('drills to the portfolio through ?node=, never through ?focus=', () => {
    workspace({ nodes: [node({ id: 'org-1', name: 'Riyadh General' })] })
    const html = render()
    expect(html).toContain('lens=portfolio')
    expect(html).toContain('node=org-1')
    // BOTH HALVES. `?focus=` is a PATH assembled by lib/mindtree/model.ts and
    // `resolveFocus` degrades a wrong one to the root of the map without
    // saying so — a link that looks like it worked. Asserting its absence is
    // what stops a future edit "restoring" it from the brief.
    expect(html).not.toContain('focus=')
    expect(html).toContain('Riyadh General')
  })

  it('renders an em-dash WITH A WORD for each of the three absences', () => {
    workspace({ nodes: [node({ id: 'a' })] })
    const html = render()
    // "Nobody has said where this is" and "it is on the first rung" are
    // different facts and must never render alike.
    expect(html).toContain('—')
    expect(html).toContain(asHtml(t('pmo.deliveryNotStaged')))
    expect(html).toContain(asHtml(t('mindtree.portfolioNoManager')))
  })

  it('names the accountable teammate through the roster', () => {
    workspace({
      nodes: [node({ id: 'a', account_manager_id: 'u1' })],
      members: new Map([['u1', { id: 'u1', displayName: 'Sara Alsaab' }]]),
    })
    expect(render()).toContain('Sara Alsaab')
  })

  it('says an organization has no hierarchy to read rather than showing a blank table', () => {
    workspace({ entries: [entry({ id: 'e1' })] })
    const html = render()
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
    const html = render()
    // One open item, filed on the child, counted on BOTH rows — and the closed
    // one counted on neither.
    expect([...html.matchAll(/pmo-num tabular">1</g)]).toHaveLength(2)
  })
})

/* ══════════════════ 4. the follow-up buckets ══════════════════ */

describe('the follow-up buckets', () => {
  it('renders all six as a checklist, empties included', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'e1', due_date: '2026-08-01' })],
    })
    const html = render()
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
    const html = render()
    expect(html).toContain(asHtml(t('followups.allClear')))
  })
})

/* ══════════════════ 5. risks & challenges ══════════════════ */

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
    const html = render()
    expect(html).toContain(asHtml(t('pmo.riskIssues')))
    expect(html).toContain(asHtml(t('pmo.riskEscalations')))
    expect(html).toContain('Claims rejected')
    expect(html).toContain('Vendor SLA')
    // An action is follow-up work, not a risk. It appears in the buckets above
    // and must not be counted here.
    expect(html).not.toContain('Book the room')
  })

  it('renders the reading as a derived badge and never as a stored score', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [
        entry({ id: 'i1', type: 'issue', priority: 'critical' }),
        entry({ id: 'i2', type: 'issue', priority: 'low' }),
      ],
    })
    const html = render()
    expect(html).toContain(asHtml(t('pmo.readingSevere')))
    expect(html).toContain(asHtml(t('pmo.readingWatch')))
    expect(html).toContain(asHtml(t('pmo.readingHint')))
    // The two inputs are on the row, so the badge adds emphasis and no
    // information the reader cannot check.
    expect(html).toContain(asHtml(t('priority.critical')))
  })

  it('names both empty states separately — the two lists mean different things', () => {
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'e1' })] })
    const html = render()
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
    const html = render()
    expect(html).not.toContain('Fixed already')
    expect(html).not.toContain('Withdrawn')
  })
})

/* ══════════════════ 6. the page as a whole ══════════════════ */

describe('the assembled page', () => {
  it('names its three sections and links each heading to its region', () => {
    workspace({ nodes: [node({ id: 'a' })], entries: [entry({ id: 'e1' })] })
    const html = render()
    for (const id of ['pmo-overview', 'pmo-delivery', 'pmo-risks']) {
      expect(html).toContain(`aria-labelledby="${id}"`)
      // A dangling labelledby leaves the region unnamed and is invisible in a
      // screenshot — so the id has to exist, and on the heading.
      expect(html).toMatch(new RegExp(`<h2[^>]*id="${id}"`))
    }
  })

  it('asks for no key that fails to resolve, in either language', () => {
    workspace({
      nodes: [node({ id: 'a' })],
      entries: [entry({ id: 'i1', type: 'issue' }), entry({ id: 'e1', due_date: '2026-08-01' })],
    })
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const html = render()
      // t() echoes an unknown key, so any dot path rendered as text is a hole.
      expect(html, locale).not.toMatch(/>(pmo|followups|mindtree|dashboard)\.[a-zA-Z]/)
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
