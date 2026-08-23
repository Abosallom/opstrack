// Render proof for the ranked bars.
//
// WHY renderToStaticMarkup AND NOT A DOM: vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — PortfolioStage.test.tsx's
// opening paragraph, and the same trade. So the `vi.hoisted()` block below shims
// the three globals `lib/i18n` and `lib/theme` read AT IMPORT TIME, and nothing
// in this file claims a behaviour that needs an effect or a click. What is
// asserted about the tap is what a static render can honestly see: the row is a
// real `<button>` carrying the organization's own accessible name. The handler
// it fires is one line and is named in the handoff as browser work.
//
// NOTHING IS MOCKED, because there is nothing to mock. The component takes rows,
// groups and a catalogue as props and asks no store a question — which is what
// makes every number below reproducible at a fixed instant.
//
// ⚠ SLICERS, NOT BARE `toContain`. Every row on this screen carries the same
//   words — "live", "not recorded", the em-dash — so an unqualified match is
//   true of the page whatever the row it means actually says. `rowOf()` cuts the
//   markup down to one `<li>` before anything is asserted about it.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { UseCase, UseCaseStatus } from '../../types'
import type { PortfolioGroupRow, PortfolioRow } from '../../lib/portfolio/rows'
import type { UseCaseProgress } from '../../lib/mapNodes'

vi.hoisted(() => {
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
})

const { PortfolioBars } = await import('./PortfolioBars')
const { t } = await import('../../lib/i18n')

// THE SHEET, READ THROUGH THE BUNDLER. `node:fs` is not an option —
// tsconfig.app.json carries no `node` in its `types` and importing it reds
// `tsc -b` for the whole solution. MapBranchDetail.test.tsx's recipe, and
// vitest.config.ts's `css: true` is what stops this resolving to `''` and
// making every assertion below vacuously green.
const SHEET_SRC: Record<string, string> = import.meta.glob('./portfolio-bars.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SHEET = SHEET_SRC['./portfolio-bars.css'] ?? ''

/* ────────────────────────────── fixtures ────────────────────────────── */

function useCase(i: number): UseCase {
  return {
    id: `uc${i}`,
    name: `Capability ${i}`,
    name_ar: '',
    sort_order: i,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

/** Five capabilities, which is the scale every organization bar is drawn on. */
const CATALOGUE: readonly UseCase[] = [1, 2, 3, 4, 5].map(useCase)

/**
 * A progress block from a list of statuses, ONE PER CATALOGUE ROW.
 *
 * `null` is written out as `null` at the call site rather than left off the end,
 * because "nobody recorded this" is the state this whole suite turns on and a
 * short array would express it by accident.
 */
function progress(statuses: readonly (UseCaseStatus | null)[]): UseCaseProgress {
  const rows = statuses.map((status, i) => ({
    useCase: useCase(i + 1),
    status,
    linked: status === null ? 0 : 1,
    done: status === 'live' ? 1 : 0,
    retired: false,
  }))
  return {
    rows,
    done: rows.filter((r) => r.done === 1).length,
    total: rows.length,
    linked: rows.filter((r) => r.linked === 1).length,
    nodes: 1,
  }
}

function row(
  over: Partial<PortfolioRow> & Pick<PortfolioRow, 'nodeId' | 'name' | 'order'>,
): PortfolioRow {
  return {
    key: over.nodeId,
    trailParts: ['UHR'],
    trailLabel: 'UHR',
    retired: false,
    parentId: null,
    parentName: '',
    stageId: 'kick',
    stageOrder: 1,
    stageName: 'Kickoff',
    daysInStage: 12,
    atRisk: false,
    stallDays: 30,
    managerId: null,
    managerName: null,
    vendor: 'Acme',
    vendorFold: 'acme',
    progress: null,
    open: 0,
    quietDays: null,
    ...over,
  }
}

function group(
  over: Partial<PortfolioGroupRow> & Pick<PortfolioGroupRow, 'key' | 'label' | 'order'>,
): PortfolioGroupRow {
  return {
    unnamed: false,
    nodeIds: ['a', 'b'],
    orgs: 2,
    medianDays: 10,
    atRisk: 0,
    open: 0,
    done: 0,
    total: 10,
    largestBlock: 0,
    largestBlockLabel: '',
    ...over,
  }
}

/**
 * Four organizations whose SPLITS ARE ALL DIFFERENT, and deliberately handed to
 * the component in the WRONG order — the ranking is the thing under test, so a
 * fixture already in rank order would prove nothing.
 *
 *   Hail      2 live, 0 testing, 1 planned, 2 not recorded
 *   Riyadh    3 live, 1 testing, 1 planned, 0 not recorded
 *   Jeddah    2 live, 2 testing, 0 planned, 1 not recorded
 *   Dammam    nobody has recorded anything: five nulls
 *   Abha      nobody has LOOKED: `progress === null`
 */
const ORGS: readonly PortfolioRow[] = [
  row({
    nodeId: 'hail',
    name: 'Hail Regional',
    order: 1,
    progress: progress(['live', 'live', 'planned', null, null]),
  }),
  row({
    nodeId: 'riyadh',
    name: 'Riyadh General',
    order: 2,
    managerId: 'm1',
    retired: true,
    progress: progress(['live', 'live', 'live', 'testing', 'planned']),
  }),
  row({
    nodeId: 'jeddah',
    name: 'Jeddah Central',
    order: 3,
    progress: progress(['live', 'live', 'testing', 'testing', null]),
  }),
  row({
    nodeId: 'dammam',
    name: 'Dammam North',
    order: 4,
    progress: progress([null, null, null, null, null]),
  }),
  row({ nodeId: 'abha', name: 'Abha Central', order: 5, progress: null }),
]

const BUCKETS: readonly PortfolioGroupRow[] = [
  group({ key: 'kick', label: 'Kickoff', order: 1, done: 4, total: 20, orgs: 4, atRisk: 1 }),
  group({ key: 'live', label: 'Live', order: 2, done: 17, total: 20, orgs: 4, atRisk: 0 }),
  group({ key: '', label: '', order: 3, unnamed: true, done: null, total: null, orgs: 2 }),
]

function render(
  over: {
    rows?: readonly PortfolioRow[]
    groups?: readonly PortfolioGroupRow[]
    showsRows?: boolean
    compact?: boolean
    catalogue?: readonly UseCase[]
  } = {},
): string {
  return renderToStaticMarkup(
    (
      <PortfolioBars
        rows={over.rows ?? ORGS}
        groups={over.groups ?? BUCKETS}
        showsRows={over.showsRows ?? true}
        catalogue={over.catalogue ?? CATALOGUE}
        compact={over.compact ?? false}
        managerNameOf={(id) => (id === 'm1' ? 'Sara Alharbi' : null)}
        onOpenNode={() => {}}
        captionId="cap-1"
      />
    ) as ReactElement,
  )
}

/* ────────────────────────────── slicers ────────────────────────────── */

/** Every `<li class="pfb-item">` block, in the order they were drawn. */
function items(html: string): string[] {
  return html.split('<li class="pfb-item">').slice(1)
}

/**
 * The one row whose name is `name`.
 *
 * THE WHOLE SUITE'S INSTRUMENT: every row carries the words "live", "planned"
 * and "not recorded", so nothing may be asserted against the page as a whole.
 */
function rowOf(html: string, name: string): string {
  const found = items(html).filter((chunk) => chunk.includes(name))
  expect(found).toHaveLength(1)
  return found[0]
}

/** The bar of one row — the segments only, with the reading below cut off. */
function barOf(chunk: string): string {
  const from = chunk.indexOf('<span class="pfb-bar"')
  expect(from).toBeGreaterThan(-1)
  return chunk.slice(from, chunk.indexOf('</span>', chunk.indexOf('<span class="pfb-read"')))
}

/** Row names in the order they were drawn. */
function order(html: string): string[] {
  return items(html).map((chunk) => /<\/span>([^<]*)/.exec(chunk.slice(chunk.indexOf('pfb-rank')))?.[1] ?? '')
}

/* ══════════════════════ THE FOURTH STATE ══════════════════════ */
//
// The one assertion this whole exercise turns on. `status === null` is NOT
// "planned": planned is a claim somebody made, and 1,700 of this workspace's
// 2,415 cells are cells nobody has recorded at all.

describe('the fourth state is not the third one in another colour', () => {
  it('draws unrecorded as a DIFFERENT ELEMENT from planned, inside one row', () => {
    // Hail is the row with both: one planned and two unrecorded. Sliced first,
    // because every other row on the page also says "planned".
    const bar = barOf(rowOf(render(), 'Hail Regional'))
    expect(bar).toContain('class="pfb-seg" data-k="planned"')
    expect(bar).toContain('class="pfb-gap" data-k="unrecorded"')
    // And the fourth run is NOT a segment — a `pfb-seg` with a fourth `data-k`
    // would take a fill from the sheet and lose the whole distinction.
    expect(bar).not.toContain('data-k="unrecorded"><span')
    expect(/class="pfb-seg" data-k="unrecorded"/.test(bar)).toBe(false)
  })

  it('gives the groove no fill and a hairline, where planned has a fill', () => {
    // THE RULES, not the rendering: the difference is drawn in CSS, so CSS is
    // where it has to be proved. A glob that resolved to nothing would make this
    // pass against an empty string, which is why the length is checked first.
    expect(SHEET.length).toBeGreaterThan(500)
    const planned = /\.pfb-seg\[data-k='planned'\]\s*\{[^}]*\}/.exec(SHEET)?.[0] ?? ''
    const gap = /\.pfb-gap\s*\{[^}]*\}/.exec(SHEET)?.[0] ?? ''
    expect(planned).toContain('background: var(--border)')
    // Not a colour. The bar's own ground shows through.
    expect(gap).toContain('background: transparent')
    expect(gap).not.toContain('var(--border)')
    // …and a hairline, so it reads as a segment rather than as the bar ending.
    expect(gap).toContain('border-inline-start: 1px solid var(--text-faint)')
  })

  it('states both counts in words, so the difference is never colour alone', () => {
    const chunk = rowOf(render(), 'Hail Regional')
    expect(chunk).toContain(
      t('mindtree.portfolioBarsRow', { live: 2, testing: 0, planned: 1, unrecorded: 2 }),
    )
  })

  it('proves the assertion can fail: a row with no unrecorded cell draws no groove', () => {
    // Riyadh has all five capabilities recorded, so there is nothing for the
    // groove to be — and if `pfb-gap` were rendered unconditionally the test
    // above would be green against a component that could not tell the states
    // apart at all.
    const bar = barOf(rowOf(render(), 'Riyadh General'))
    expect(bar).toContain('data-k="planned"')
    expect(bar).not.toContain('pfb-gap')
  })
})

/* ══════════════════════ THREE ZEROES, THREE FACTS ══════════════════════ */

describe('the three absences are three different renderings', () => {
  it('draws NO BAR where nobody has looked', () => {
    // `progress === null` is "the links store has not landed". An empty groove
    // here would claim a measurement of zero that nobody took.
    const chunk = rowOf(render(), 'Abha Central')
    expect(chunk).not.toContain('pfb-bar')
    expect(chunk).toContain(t('mindtree.portfolioBarsUnread'))
    expect(chunk).toContain('pfb-quiet')
  })

  it('draws an ALL-GROOVE bar where somebody looked and found nothing', () => {
    // Dammam has five nulls: somebody read the links and this organization has
    // no claim against any capability. That is a fact, it is drawable, and it
    // must not read as `0 of 5 live`.
    const chunk = rowOf(render(), 'Dammam North')
    const bar = barOf(chunk)
    expect(bar).toContain('pfb-gap')
    expect(bar).not.toContain('pfb-seg')
    expect(chunk).toContain(t('mindtree.portfolioBarsNone', { total: 5 }))
    expect(chunk).not.toContain(
      t('mapnode.progress', { done: 0, total: 5, status: t('mapnode.wordLive') }),
    )
  })

  it('prints a real zero where people recorded things and none is live', () => {
    const only = [
      row({
        nodeId: 'taif',
        name: 'Taif Hospital',
        order: 1,
        progress: progress(['planned', 'planned', null, null, null]),
      }),
    ]
    const chunk = rowOf(render({ rows: only }), 'Taif Hospital')
    expect(chunk).toContain(
      t('mindtree.portfolioBarsRow', { live: 0, testing: 0, planned: 2, unrecorded: 3 }),
    )
  })
})

/* ══════════════════════ THE RANKING ══════════════════════ */

describe('the bars are in rank order, which is the reason they are bars', () => {
  it('ranks organizations by live, then by testing', () => {
    // Handed in as Hail · Riyadh · Jeddah · Dammam · Abha.
    // Riyadh 3 live; Jeddah 2 live 2 testing; Hail 2 live 0 testing; Dammam 0;
    // Abha unread and therefore last, because it cannot be ranked at all.
    // Isolated, because that is what the row actually prints — see the bidi
    // assertion below; a bare expectation here would go green the day the
    // isolate was dropped.
    expect(order(render())).toEqual([
      '\u2068Riyadh General\u2069',
      '\u2068Jeddah Central\u2069',
      '\u2068Hail Regional\u2069',
      '\u2068Dammam North\u2069',
      '\u2068Abha Central\u2069',
    ])
  })

  it('ranks buckets by how much is done, with the unread one last', () => {
    const html = render({ showsRows: false })
    expect(order(html)).toEqual([
      '\u2068Live\u2069',
      '\u2068Kickoff\u2069',
      `\u2068${t('mapnode.notRecorded')}\u2069`,
    ])
  })
})

/* ══════════════════════ THE BUCKETS ══════════════════════ */

describe('a bucket bar is the bucket’s own progress', () => {
  it('draws one segment and states the two numbers, never a percentage', () => {
    const chunk = rowOf(render({ showsRows: false }), 'Kickoff')
    expect(chunk).toContain('class="pfb-seg" data-k="live"')
    expect(chunk).toContain(
      t('mapnode.progress', { done: 4, total: 20, status: t('mapnode.wordLive') }),
    )
    expect(chunk).toContain(t('mindtree.portfolioBarsRisk', { count: 1, orgs: 4 }))
    expect(chunk).toContain(t('mindtree.portfolioTotal', { count: 4 }))
  })

  it('leaves the remainder as bare ground, with no fourth-state hairline', () => {
    // What is not live in a bucket is testing plus planned plus never-recorded
    // together. A hairline across the three would name a state this shape does
    // not have.
    expect(barOf(rowOf(render({ showsRows: false }), 'Kickoff'))).not.toContain('pfb-gap')
  })

  it('says nobody has read a bucket whose totals are null, and draws nothing', () => {
    const chunk = rowOf(render({ showsRows: false }), t('mapnode.notRecorded'))
    expect(chunk).not.toContain('pfb-bar')
    expect(chunk).toContain(t('mindtree.portfolioBarsUnread'))
  })

  it('is not a control: a bucket has no button to press', () => {
    const chunk = rowOf(render({ showsRows: false }), 'Kickoff')
    expect(chunk).toContain('class="pfb-row pfb-static"')
    expect(chunk).not.toContain('<button')
  })
})

/* ══════════════════════ HOUSE LAW ══════════════════════ */

describe('the house rules the bars are drawn under', () => {
  it('hides every bar from the accessible tree', () => {
    const html = render()
    const bars = html.match(/<span class="pfb-bar"[^>]*>/g) ?? []
    expect(bars.length).toBe(4) // four of the five rows have a bar
    for (const bar of bars) expect(bar).toContain('aria-hidden="true"')
  })

  it('prints no bare percentage anywhere a reader can see one', () => {
    // `--w` is a CSS length and lives in a style attribute; a `%` outside one
    // would be a figure, and "20%" hides its denominator — Pmo.tsx's rule.
    const visible = render().replace(/style="[^"]*"/g, '')
    expect(visible).not.toContain('%')
    expect(visible).not.toContain('٪')
  })

  it('isolates every database string it prints', () => {
    // The organization name is text of unknown direction sitting beside numbers.
    // Asserted against the ISOLATED form deliberately: a bare match would go
    // green the day the isolate was dropped.
    expect(render()).toContain('⁨Riyadh General⁩')
    expect(rowOf(render(), 'Riyadh General')).toContain('⁨Sara Alharbi⁩')
    expect(render({ showsRows: false })).toContain('⁨Kickoff⁩')
  })

  it('renders the em-dash AND the spoken word where there is no manager', () => {
    const chunk = rowOf(render(), 'Hail Regional')
    expect(chunk).toContain(`<span class="sr-only">${t('mapnode.notRecorded')}</span>`)
  })

  it('names its region with the caption it was given', () => {
    expect(render()).toContain('<section class="pfb" role="region" aria-labelledby="cap-1">')
  })

  it('gives every organization row a button whose NAME carries the numbers', () => {
    // What a static render can honestly see of the tap: the row IS a button.
    // The click itself is browser work — there is no DOM here to dispatch into.
    const chunk = rowOf(render(), 'Jeddah Central')
    expect(chunk).toContain('<button type="button" class="pfb-row"')
    // ⚠ AND IT CARRIES NO `aria-label`, which is the assertion that matters.
    // A label would REPLACE the button's content in the accessible name and
    // hide the four numbers from exactly the readers who cannot see the bar.
    expect(chunk).not.toContain('aria-label')
    const button = chunk.slice(chunk.indexOf('<button'), chunk.indexOf('</button>'))
    expect(button).toContain('⁨Jeddah Central⁩')
    expect(button).toContain(
      t('mindtree.portfolioBarsRow', { live: 2, testing: 2, planned: 0, unrecorded: 1 }),
    )
    // The verb the label used to carry, as a phrase inside the name instead.
    expect(button).toContain(`<span class="sr-only">${t('mindtree.portfolioBarsOpen')}</span>`)
  })

  it('says what the full width of a bar means, in capabilities', () => {
    expect(render()).toContain(t('mindtree.portfolioBarsScale', { count: 5 }))
  })

  it('uses no physical property in its sheet', () => {
    // `left`/`right`/`width` are what make an Arabic build need a mirror sheet.
    expect(SHEET).not.toMatch(/[^-]\b(width|left|right)\s*:/)
    expect(SHEET).toContain('border-inline-start')
  })
})

/* ══════════════════════ 161 ORGANIZATIONS ══════════════════════ */

describe('a long list is capped and SAYS SO, and is never windowed', () => {
  const many: readonly PortfolioRow[] = Array.from({ length: 50 }, (_, i) =>
    row({
      nodeId: `n${i}`,
      name: `Organization ${i}`,
      order: i,
      progress: progress(['live', null, null, null, null]),
    }),
  )

  it('draws forty on a wide screen and names the rest in words', () => {
    const html = render({ rows: many })
    expect(items(html)).toHaveLength(40)
    expect(html).toContain(t('mindtree.portfolioBarsHidden', { count: 10 }))
    expect(html).toContain(t('mindtree.portfolioBarsShowAll'))
  })

  it('draws twenty on a phone, and names thirty', () => {
    const html = render({ rows: many, compact: true })
    expect(items(html)).toHaveLength(20)
    expect(html).toContain(t('mindtree.portfolioBarsHidden', { count: 30 }))
  })

  it('says nothing about a hidden remainder when there is none', () => {
    const html = render()
    expect(html).not.toContain('pfb-more')
  })
})

/* ══════════════════════ NOTHING TO RANK ══════════════════════ */

describe('the empty state names itself', () => {
  it('says what is true rather than drawing an empty list', () => {
    const html = render({ rows: [], groups: [] })
    expect(html).toContain(t('mindtree.portfolioBarsEmpty'))
    expect(html).toContain(t('mindtree.portfolioBarsEmptyHint'))
    expect(html).not.toContain('pfb-list')
  })
})

/* ══════════════════════ THE CLASS-DRIFT GATE ══════════════════════ */

describe('every class this view renders has a rule in portfolio-bars.css', () => {
  it('names nothing the sheet was not written against', () => {
    // A name with no rule silently takes the shared kit's defaults and reads as
    // styling that does not exist. Six such names shipped in the history band
    // and had to be found by hand.
    expect(SHEET.length).toBeGreaterThan(500)
    const everything = [
      render(),
      render({ showsRows: false }),
      render({ rows: [], groups: [] }),
      render({
        rows: Array.from({ length: 50 }, (_, i) =>
          row({ nodeId: `n${i}`, name: `Organization ${i}`, order: i }),
        ),
      }),
    ].join('')
    const rendered = new Set(everything.match(/pfb-[a-z-]+/g) ?? [])
    // The sheet is worth reading only if the render actually reached the
    // interesting names.
    expect(rendered.has('pfb-gap')).toBe(true)
    expect(rendered.has('pfb-flag')).toBe(true)
    const unstyled = [...rendered]
      .filter((name) => !new RegExp(`\\.${name}(?![a-z-])`).test(SHEET))
      .sort()
    expect(unstyled).toEqual([])
  })

  it('claims no prefix but its own', () => {
    // The CSS registry gives each sheet one prefix and forbids styling another's.
    const selectors = SHEET.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.[a-z][a-z0-9-]*/g) ?? []
    expect(selectors.filter((s) => !s.startsWith('.pfb'))).toEqual([])
  })
})
