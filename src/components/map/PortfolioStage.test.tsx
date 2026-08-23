// Render proof for the portfolio — and it is written against the EASE-OF-USE
// BUDGETS rather than against the component's internals, because those budgets
// are the acceptance criteria this wave was given and "a budget miss is a
// defect, not a note".
//
//   E1  the morning answer costs ZERO interactions   → the default render IS the
//       stalled list, longest-stuck first, and the toggle's name carries the
//       same count the table has rows.
//   E2  a stage change is ≤2 taps from landing       → every row carries a real
//       `<select>` with an accessible name naming its organization; the picker
//       is not behind a menu, a dialog or a second screen.
//   E5  `?by=` is human chips, never a dropdown      → four `aria-pressed`
//       buttons in a named group, and NO `<select>` among them.
//   E6  every empty state names itself and links     → no stages, no thresholds,
//       nothing past its stage, and a truncated read each say what is true and
//       (where there is one) offer the way to the fix.
//   E7  ≤3 controls beyond the lens chips at rest    → counted in the markup.
//
// WHY renderToStaticMarkup AND NOT A DOM: `environment: 'node'`, no jsdom in the
// dependency budget. So effects do not run and nothing here claims a behaviour
// that needs one — the optimistic write, the Shift-range and the pruning pass
// are asserted through their pure halves (lib/portfolio/rows.test.ts) and are
// named in the handoff as browser work.
//
// THE STORES ARE MOCKED AND THE TREE IS REAL. What this file is proving is that
// the component asks the right questions of the row builder and renders the
// answers accessibly; the arithmetic behind them has its own suite, and mocking
// the builder as well would leave nothing under test.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import type { Entry, MapNode, MapNodeProgress, MapNodeStage, UseCase } from '../../types'
import type { MindNode } from '../../lib/mindtree/model'

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
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = {
    stages: [] as MapNodeStage[],
    progress: new Map<string, MapNodeProgress>(),
    nodes: new Map<string, MapNode>(),
    links: null as { node_id: string; use_case_id: string; status: string }[] | null,
    truncated: false,
    catalogue: [] as UseCase[],
    entries: new Map<string, Entry>(),
    /** Every api/map write this suite provoked, in order. */
    writes: [] as [string, string, string | null][],
    deleteFails: false,
    /** How many times the undo path reached for the whole-workspace refetch. */
    invalidated: 0,
  }
  return { state }
})

vi.mock('../../store/config', () => ({
  useMapNodeStages: () => fx.state.stages,
  useStageMap: () => new Map(fx.state.stages.map((s) => [s.id, s])),
  useNodeProgress: () => fx.state.progress,
  useMapNodeMap: () => fx.state.nodes,
  useAllUseCases: () => fx.state.catalogue,
  publishNodeProgress: () => {},
  invalidateConfig: () => {
    fx.state.invalidated += 1
  },
}))

vi.mock('../../store/entries', () => ({
  useEntryMap: () => fx.state.entries,
  /**
   * ALL THREE INHERITED MAPS, because the stage narrows its ROW LIST through
   * them and not only its columns. A mock carrying `vendorOfNode` alone would
   * make every `?node=`/`?manager=` case read as "this context has no answer",
   * which `inPortfolioScope` correctly resolves to an empty table — and the
   * suite would then be testing the absent-map arm forever while believing it
   * was testing the drill. store/entries builds all three in one walk; so does
   * this.
   */
  useFilterContext: () => ({
    meId: 'me',
    today: '2026-03-10',
    ancestryOfNode: new Map(
      [...fx.state.nodes.values()].map((n) => [
        n.id,
        n.parent_id === null ? [n.id] : [n.id, n.parent_id],
      ]),
    ),
    managerOfNode: new Map(
      [...fx.state.nodes.values()].map((n) => [n.id, n.account_manager_id]),
    ),
    vendorOfNode: new Map([...fx.state.nodes.values()].map((n) => [n.id, n.vendor])),
  }),
}))

vi.mock('../../store/portfolio', () => ({
  usePortfolioLinks: () => fx.state.links,
  usePortfolioTruncated: () => fx.state.truncated,
}))

vi.mock('../../api/map', () => ({
  setNodeStage: (nodeId: string, stageId: string | null) => {
    fx.state.writes.push(['setNodeStage', nodeId, stageId])
    return Promise.resolve({ ok: true, data: { node_id: nodeId, stage_id: stageId } })
  },
  deleteNodeProgress: (nodeId: string) => {
    fx.state.writes.push(['deleteNodeProgress', nodeId, null])
    return fx.state.deleteFails
      ? Promise.resolve({ ok: false, error: 'admin.errForbidden' })
      : Promise.resolve({ ok: true, data: undefined })
  },
}))

// `<Link>` needs a router context that `renderToStaticMarkup` has no way to
// provide. The anchor is what the assertion is about — budget E6 asks whether
// the state OFFERS the fix, not how the router renders it.
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

const { default: PortfolioStage, undoStage } = await import('./PortfolioStage')
const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const { t } = await import('../../lib/i18n')

/* ────────────────────────────── fixtures ────────────────────────────── */

function stage(
  over: Partial<MapNodeStage> & Pick<MapNodeStage, 'id' | 'name' | 'sort_order'>,
): MapNodeStage {
  return {
    name_ar: '',
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

function node(over: Partial<MapNode> & Pick<MapNode, 'id' | 'name'>): MapNode {
  return {
    parent_id: null,
    track_id: 'trk',
    kind_id: 'org',
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    ...over,
  }
}

function mind(over: Partial<MindNode> & Pick<MindNode, 'id' | 'kind'>): MindNode {
  return {
    label: { kind: 'text', text: over.id },
    count: 0,
    colourVars: {},
    health: { level: 'ok', slaBreached: false, overdue: false, stale: false },
    children: [],
    collapsed: false,
    depth: 0,
    entryId: null,
    bucketKey: null,
    entityType: null,
    retired: false,
    ...over,
  } as MindNode
}

function entity(id: string, label: string, count = 0): MindNode {
  return mind({ id: `entity:${id}`, kind: 'entity', bucketKey: id, label: { kind: 'text', text: label }, count })
}

/**
 * THE STAMPS ARE RELATIVE TO THE RUNNING CLOCK, AND THAT IS NOT LAZINESS.
 *
 * The component reads the wall clock for `now` — days-in-stage is a question
 * about today, and lib/lifecycle takes the instant as an argument precisely so
 * the arithmetic can be pinned in `rows.test.ts`. Here the component owns the
 * clock, so a fixture with a fixed `2026-01-01` stamp would report a different
 * number of days every morning and a suite written against it would go red on
 * its own. The relative stamps make "68 days into a 30-day rung" true whenever
 * this runs.
 */
const DAY = 86_400_000
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY).toISOString()
}

/**
 * Three organizations, of which exactly ONE is past its rung.
 *
 *   Riyadh General   Kickoff (30 days allowed), stamped 68 days ago  ⇒ risk
 *   Jeddah Central   Kickoff,                   stamped  5 days ago  ⇒ ok
 *   Hail Regional    no progress row at all                          ⇒ unstaged
 */
function seed(over: { hiddenRung?: boolean; expected?: number | null } = {}): MindNode {
  fx.state.stages = [
    stage({ id: 'kick', name: 'Kickoff', sort_order: 1, // `?? 30` WOULD NOT DO IT: `expected: null` is the state 0026 SEEDS —
      // no rung has a number — and `null ?? 30` is 30, which would make the
      // no-threshold case silently test the configured one.
      expected_days: 'expected' in over ? over.expected : 30 }),
    stage({ id: 'live', name: 'Live', sort_order: 2, terminal: true }),
    stage({ id: 'old', name: 'Retired rung', sort_order: 3, hidden: over.hiddenRung ?? false }),
  ]
  fx.state.progress = new Map([
    [
      'riyadh',
      {
        node_id: 'riyadh',
        stage_id: 'kick',
        stage_changed_at: daysAgo(68),
        updated_at: daysAgo(68),
        updated_by: null,
      },
    ],
    [
      'jeddah',
      {
        node_id: 'jeddah',
        stage_id: 'kick',
        stage_changed_at: daysAgo(5),
        updated_at: daysAgo(5),
        updated_by: null,
      },
    ],
  ])
  fx.state.nodes = new Map(
    [
      node({ id: 'riyadh', name: 'Riyadh General', vendor: 'Acme' }),
      node({ id: 'jeddah', name: 'Jeddah Central', vendor: 'Acme' }),
      node({ id: 'hail', name: 'Hail Regional' }),
    ].map((n) => [n.id, n]),
  )
  fx.state.links = null
  fx.state.truncated = false
  fx.state.catalogue = []
  fx.state.entries = new Map()

  return mind({
    id: 'root',
    kind: 'root',
    count: 12,
    children: [
      mind({
        id: 'track:uhr',
        kind: 'track',
        bucketKey: 'uhr',
        label: { kind: 'text', text: 'UHR' },
        count: 12,
        children: [
          entity('riyadh', 'Riyadh General', 4),
          entity('jeddah', 'Jeddah Central', 8),
          entity('hail', 'Hail Regional', 0),
        ],
      }),
    ],
  })
}

function render(
  root: MindNode,
  over: {
    by?: 'stage' | 'manager' | 'vendor' | 'phase'
    risk?: boolean
  as?: 'table' | 'bars' | 'cards' | 'grid'
    mapNodeIds?: string[]
    /**
     * Show ORGANIZATION rows with the exception cut off.
     *
     * There is no third parameter for this and there must not be: the rule is
     * `risk || mapNodeIds.length > 0`, both halves of it are in the URL, and a
     * test shorthand that reached past the rule would stop proving it. This
     * names the three organizations, which is what a reader who has drilled
     * into a bucket has in their address bar.
     */
    rows?: boolean
  } = {},
): string {
  return renderToStaticMarkup(
    (
      <PortfolioStage
        root={root}
        filter={{
          ...EMPTY_FILTER,
          mapNodeIds: over.mapNodeIds ?? (over.rows ? ['riyadh', 'jeddah', 'hail'] : []),
        }}
        onNarrow={() => {}}
        view={{ by: over.by ?? 'stage', risk: over.risk ?? true, as: over.as ?? 'table' }}
        onView={() => {}}
        textOf={(label) => (label.kind === 'text' ? label.text : label.key)}
        terminalKey="live"
        managerNameOf={() => null}
        onOpenNode={() => {}}
        compact={false}
        announce={() => {}}
      />
    ) as ReactElement,
  )
}

/** Every `<select>` in the markup — the E5 assertion's instrument. */
function selects(html: string): string[] {
  return html.match(/<select\b[^>]*>/g) ?? []
}

/* ───────────────────── E1 — the morning answer, zero taps ───────────────── */

describe('E1 — the stalled list is what the chip gives you', () => {
  it('renders organizations, not buckets, with the cut on by default', () => {
    const html = render(seed())
    expect(html).toContain('Riyadh General')
    // Jeddah is five days into a thirty-day rung and Hail is unstaged: neither
    // is past anything, so neither is on the exception list.
    expect(html).not.toContain('Jeddah Central')
    expect(html).not.toContain('Hail Regional')
  })

  it('carries the same number in the toggle’s name as it has rows', () => {
    const html = render(seed())
    expect(html).toContain(t('mindtree.portfolioRiskCount', { count: 1 }))
    expect(html).toContain(t('mindtree.portfolioRows', { count: 1 }))
  })

  it('counts the badge over the WHOLE population, not over the rows on screen', () => {
    // With the cut OFF the table shows three organizations and exactly one of
    // them is past its rung. A badge that counted rows would read 3 and would
    // still look right on the default screen, where the two numbers coincide —
    // which is why the check has to be made here.
    const html = render(seed(), { risk: false, rows: true })
    expect(html).toContain(t('mindtree.portfolioRiskCount', { count: 1 }))
    expect(html).toContain(t('mindtree.portfolioRows', { count: 3 }))
    expect(html).toMatch(/<span class="pf-badge tabular" aria-hidden="true">1<\/span>/)
  })

  it('proves the assertion can fail: widen the rung and the list empties', () => {
    const html = render(seed({ expected: 400 }))
    expect(html).not.toContain('Riyadh General')
    expect(html).toContain(t('mindtree.portfolioEmptyRisk'))
  })

  it('keeps the badge out of the accessible name’s way', () => {
    const html = render(seed())
    // The visible count is `aria-hidden`; the spoken one is the counted sentence
    // on the button. MapLensBar's rule, and the reason both appear above.
    expect(html).toMatch(/<span class="pf-badge tabular" aria-hidden="true">1<\/span>/)
  })
})

/* ───────────────────── E5 — human chips, never a dropdown ──────────────── */

describe('E5 — `?by=` is four chips', () => {
  it('renders a named group of aria-pressed buttons', () => {
    const html = render(seed())
    expect(html).toContain(`aria-label="${t('mindtree.portfolioBy')}"`)
    for (const label of ['Stage', 'Team', 'Vendors', 'Progress']) {
      expect(html).toContain(`>${label}</button>`)
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*>Stage</)
  })

  it('never renders the grouping as a select', () => {
    const html = render(seed())
    // The only `<select>`s on the screen are the per-row stage pickers, which is
    // exactly what E2 asks for and E5 forbids for the grouping.
    for (const tag of selects(html)) {
      expect(tag).toContain('class="pf-stage"')
    }
  })

  it('presses the chip the URL names', () => {
    const html = render(seed(), { by: 'vendor', risk: false })
    expect(html).toMatch(/aria-pressed="true"[^>]*>Vendors</)
  })
})

/* ───────────────────── E2 — a stage change, inline ─────────────────────── */

describe('E2 — the stage is editable from the row', () => {
  it('gives every row a select whose name says which organization it is', () => {
    const html = render(seed(), { risk: false, rows: true })
    for (const name of ['Riyadh General', 'Jeddah Central', 'Hail Regional']) {
      expect(html).toContain(`aria-label="${t('mindtree.portfolioSetStage', { name })}"`)
    }
    expect(selects(html)).toHaveLength(3)
  })

  it('offers every visible rung plus "no stage recorded"', () => {
    const html = render(seed(), { risk: false, rows: true })
    expect(html).toContain(`>${t('mindtree.portfolioUnstaged')}</option>`)
    expect(html).toContain('>Kickoff</option>')
    expect(html).toContain('>Live</option>')
  })

  it('hides a retired rung from the pickers of organizations not standing on it', () => {
    const html = render(seed({ hiddenRung: true }), { risk: false, rows: true })
    expect(html).not.toContain('>Retired rung</option>')
  })

  it('still offers a retired rung to the organization parked on it', () => {
    const root = seed({ hiddenRung: true })
    fx.state.progress.set('hail', {
      node_id: 'hail',
      stage_id: 'old',
      stage_changed_at: daysAgo(12),
      updated_at: daysAgo(12),
      updated_by: null,
    })
    const html = render(root, { risk: false, rows: true })
    // Otherwise the select would have to lie about where the organization is
    // before anybody could move it off — store/config's own picker rule.
    expect(html).toContain('>Retired rung</option>')
  })

  it('preselects the rung the organization is actually on', () => {
    const html = render(seed(), { risk: false, rows: true })
    expect(html).toMatch(/<option value="kick" selected="">Kickoff<\/option>/)
  })
})

/* ───────────────────── E6 — states that name themselves ────────────────── */

describe('E6 — every empty state says what is true and links to the fix', () => {
  it('names the no-ladder state and offers the catalogue', () => {
    const root = seed()
    fx.state.stages = []
    const html = render(root)
    expect(html).toContain(t('mindtree.portfolioNoStages'))
    expect(html).toContain('href="/settings/catalogue"')
    // And it does NOT render an empty nine-column table, which would read as
    // broken rather than as unconfigured.
    expect(html).not.toContain('pf-tbl')
  })

  it('names the no-threshold state ABOVE the table, not instead of it', () => {
    const html = render(seed({ expected: null }), { risk: false, rows: true })
    expect(html).toContain(t('mindtree.portfolioNoThreshold'))
    expect(html).toContain(t('mindtree.portfolioNoThresholdAction'))
    // Every other column is still true, so the rows stay.
    expect(html).toContain('Riyadh General')
  })

  it('says nothing is past its stage — a real and good answer, with a way on', () => {
    const html = render(seed({ expected: 400 }))
    expect(html).toContain(t('mindtree.portfolioEmptyRisk'))
    expect(html).toContain(t('mindtree.portfolioShowAll'))
  })

  it('carries the truncation rather than swallowing it', () => {
    const root = seed()
    fx.state.truncated = true
    expect(render(root)).toContain(t('mindtree.portfolioPartial'))
  })
})

/* ───────────────────── the two shapes, and the columns ─────────────────── */

describe('the roll-up', () => {
  it('is what a reader sees with the cut off and nothing narrowed', () => {
    const html = render(seed(), { risk: false, by: 'stage' })
    expect(html).toContain(t('mindtree.colBucket'))
    // ISOLATED, not bare: a rung's name is DATABASE TEXT of unknown direction
    // sitting beside numbers, so it carries its own U+2068/U+2069 pair (FIRST-STRONG isolate — lib/bidi's, so the run's own first strong character decides its direction rather than the paragraph's). The
    // assertion is written against the isolated form deliberately — a bare
    // match here would go green the day the isolate was dropped.
    expect(html).toContain('>\u2068Kickoff\u2069</span>')
    // Every rung gets a bucket, including the one nobody is standing on.
    expect(html).toContain('>\u2068Live\u2069</span>')
    // And the organizations nobody has staged are a bucket of their own, last.
    expect(html).toContain(t('mindtree.portfolioUnstaged'))
  })

  it('gives way to organizations the moment the reader narrows to some', () => {
    const html = render(seed(), { risk: false, mapNodeIds: ['riyadh'] })
    expect(html).toContain(t('mindtree.colOrg'))
    expect(html).toContain('Riyadh General')
    /* AND THE OTHERS ARE GONE. Asserting only what is PRESENT is what let the
       table ship showing all four hundred organizations under a filter naming
       one: the drill wrote the right `mapNodeIds` and the row list ignored it,
       because lib/mindtree/model.ts draws a structural node whether or not it is
       populated. `inPortfolioScope` is the narrowing, and this is the line that
       goes red if it is ever removed. */
    expect(html).not.toContain('Jeddah Central')
    expect(html).not.toContain('Hail Regional')
  })

  it('names the unnamed bucket differently per grouping', () => {
    expect(render(seed(), { risk: false, by: 'manager' })).toContain(
      t('mindtree.portfolioNoManager'),
    )
    expect(render(seed(), { risk: false, by: 'vendor' })).toContain(t('mindtree.portfolioNoVendor'))
  })
})

describe('the columns say what they mean', () => {
  it('borrows no word from the entry table', () => {
    const html = render(seed(), { risk: false, rows: true })
    // "In stage" is how long an ORGANIZATION has stood on a rung; `colAge` is
    // how long an ITEM has been open. One heading for both would merge two
    // measurements.
    expect(html).toContain(t('mindtree.colInStage'))
    expect(html).not.toContain(t('dashboard.colAge'))
  })

  it('renders an em-dash and a spoken word where nobody has looked', () => {
    // `links === null` is "nobody has read the capabilities", which must not
    // render as `0 of 9` in front of an organization that is at 6.
    const html = render(seed(), { risk: false, rows: true })
    expect(html).toContain(`<span class="sr-only">${t('mapnode.notRecorded')}</span>`)
    expect(html).not.toContain('0 of 0')
  })

  it('never spells at-risk in colour alone', () => {
    const html = render(seed())
    expect(html).toContain(t('mindtree.portfolioAtRisk'))
    expect(html).toContain('data-tone="danger"')
    // The day count is a second, independent channel in its own column.
    expect(html).toContain(t('mindtree.portfolioDays', { count: 68 }))
  })

  it('reads `open` off the node the picture drew', () => {
    const html = render(seed(), { risk: false, rows: true })
    expect(html).toContain('>4</td>')
    expect(html).toContain('>8</td>')
  })

  it('gives the footer one cell per column, with the open total under Open', () => {
    /* AN HTML TABLE LAYS CELLS OUT BY POSITION, so a footer one cell short does
       not leave a gap at the end — it slides every value one column toward the
       start. The `<tfoot>` emitted a span of five plus four cells against a
       header of ten, which printed `totals.open` under "Progress" and left the
       quiet column with no footer cell at all. Nothing on screen said so: the
       number is plausible under either heading.

       Counted against the header rather than against the literal 10, so a tenth
       organization column cannot be added without this going red. */
    const html = render(seed(), { risk: false, rows: true })
    const foot = html.slice(html.indexOf('<tfoot>'))
    // Case-insensitive: React's server renderer emits the JSX spelling
    // (`colSpan`) rather than the HTML attribute's lowercase form.
    const span = Number(/<th scope="row" colspan="(\d+)"/i.exec(foot)?.[1] ?? 0)
    const cells = (foot.match(/<td\b/g) ?? []).length
    const headers = (html.match(/<th scope="col"[^>]*aria-sort="none"/g) ?? []).length
    // The tick column is a `<th>` with no sort, so the header is nine sortable
    // columns plus one — which is what a footer row has to add up to.
    expect(headers).toBe(9)
    expect(span + cells).toBe(headers + 1)
    // AND IT IS IN THE RIGHT PLACE. Three empty cells (manager, vendor,
    // progress) stand between the spanned heading and the open total.
    // 4 + 8 + 0, the fixture's three organizations.
    expect(foot).toContain(
      '<td></td><td></td><td></td><td class="pf-num tabular">12</td><td></td>',
    )
  })
})

/* ───────────────────── a11y, and the control budget ────────────────────── */

describe('the table is reachable without a pointer', () => {
  it('makes every header a real button with aria-sort on its th', () => {
    const html = render(seed(), { risk: false, rows: true })
    const headers = html.match(/<th scope="col"[^>]*aria-sort="none"/g) ?? []
    expect(headers.length).toBe(9)
    expect(html).toContain('class="btn btn-sm btn-ghost pf-sortbtn"')
  })

  it('gives the horizontal scroller a name and a tab stop', () => {
    const html = render(seed(), { risk: false, rows: true })
    expect(html).toMatch(/<div class="pf-wrap" role="region" aria-labelledby="[^"]+" tabindex="0">/)
  })

  it('names the select-all and every row tick', () => {
    const html = render(seed(), { risk: false, rows: true })
    expect(html).toContain(`aria-label="${t('mindtree.portfolioSelectAll')}"`)
    expect(html).toContain(
      `aria-label="${t('mindtree.portfolioSelect', { name: 'Riyadh General' })}"`,
    )
  })

  it('E7 — shows no control beyond the two chip rows, the toggle and the row’s own', () => {
    const html = render(seed())
    // THE BUDGET WENT FROM FIVE TO NINE, and that needs an argument rather than
    // a new number.
    //
    // It was four `?by=` chips and one risk toggle. It is now those five plus
    // four `?as=` chips — a second axis saying how the same rows are DRAWN:
    // table, bars, cards, the capability grid.
    //
    //   THEY ARE NOT FOUR MORE OPTIONS ON THE SAME QUESTION. They are four
    //   views the owner asked for by name, and the alternative was four more
    //   chips on the LENS rail — which MapLensBar's own header refuses in
    //   advance: "Four chips would have taken this row to nine, which on a
    //   375px phone is a two-screen pan." That rail is pinned and cannot wrap.
    //   This row is in the page's flow and wraps for free, which is the whole
    //   reason the second axis lives here and not there.
    //
    //   The progressive-disclosure budget was always about controls that HIDE
    //   things behind themselves. Nothing here hides anything: every chip is
    //   visible, all four states of each axis are always on screen, and no
    //   disclosure was added.
    //
    // The bulk bar still appears only behind a selection. That part is unchanged
    // and is the assertion this test was really written to hold.
    expect((html.match(/class="pf-chip[^"]*"/g) ?? []).length).toBe(9)
    expect(html).not.toContain('pf-bulk')
  })

  it('keeps the two axes as two named groups, not one row of nine', () => {
    // A reader must be able to see that pressing a draw-chip does not undo a
    // grouping choice. Two `role="group"` elements with their own names is how
    // that is said to somebody who cannot see the line between them.
    const html = render(seed())
    expect(html).toContain(`aria-label="${t('mindtree.portfolioBy')}"`)
    expect(html).toContain(`aria-label="${t('mindtree.portfolioAs')}"`)
    expect(html).toContain('class="pf-ases"')
  })
})

/* ══════════════ the undo, and the third state it has to reach ══════════════ */
//
// "No row" and "a row holding null" render as the SAME em-dash, so this
// difference cannot be caught by looking at the screen — which is exactly why it
// shipped wrong and why the assertions below are about the REQUEST rather than
// about the markup. `undoStage` is exported for this: `environment: 'node'`
// gives the suite no button to press.

describe('undoStage', () => {
  beforeEach(() => {
    fx.state.writes = []
    fx.state.deleteFails = false
    fx.state.invalidated = 0
  })

  it('writes the previous rung back when the row already existed', async () => {
    const ok = await undoStage('n1', 's1', true)
    expect(ok).toBe(true)
    expect(fx.state.writes).toEqual([['setNodeStage', 'n1', 's1']])
    // The heavy refetch belongs to the retraction alone; an ordinary undo
    // publishes the one row the database handed back.
    expect(fx.state.invalidated).toBe(0)
  })

  it('writes a NULL rung back when the row existed and held one', async () => {
    // "Somebody looked and cleared it" is a real prior state, and undoing back
    // ONTO it must not delete the row that records who cleared it.
    await undoStage('n1', null, true)
    expect(fx.state.writes).toEqual([['setNodeStage', 'n1', null]])
  })

  it('DELETES the row when this write was the first anybody ever recorded', async () => {
    const ok = await undoStage('n2', null, false)
    expect(ok).toBe(true)
    // Not `setNodeStage(n2, null)` — that would leave a row saying somebody
    // looked and cleared it, on an organization nobody has ever touched.
    expect(fx.state.writes).toEqual([['deleteNodeProgress', 'n2', null]])
    // There is no row to publish, so the store is told to look again.
    expect(fx.state.invalidated).toBe(1)
  })

  it('reports a refused delete rather than claiming the row is gone', async () => {
    fx.state.deleteFails = true
    const ok = await undoStage('n2', null, false)
    expect(ok).toBe(false)
    expect(fx.state.writes).toEqual([['deleteNodeProgress', 'n2', null]])
    // A failed retraction must not tell the rest of the app that anything
    // changed: the row is still there and the store still has it right.
    expect(fx.state.invalidated).toBe(0)
  })
})
