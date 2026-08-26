// Render proof for the heat grid, and the assertion the whole view turns on is
// the FOURTH STATE: `status === null` must be drawn differently from `planned`,
// in the markup and in the sheet, or 1,700 unasked questions are silently
// reported as 1,700 decisions somebody made.
//
// `environment: 'node'`, `renderToStaticMarkup`, no jsdom — PortfolioStage
// .test.tsx's idiom, and its stated reason: nothing here claims a behaviour that
// needs an effect. The `vi.hoisted()` shim is not optional even though this unit
// mocks no store: lib/i18n reads `localStorage` at MODULE scope and lib/theme
// reads `matchMedia`, both at import time, so the shims cannot wait for a
// beforeAll().
//
// ⚠ SLICERS, NOT BARE `toContain`. Every row on this grid carries the same four
//   words and the same fifteen squares, so an unqualified match is true of the
//   page whatever any individual cell says — `rowOf()` cuts to the organization
//   under discussion first, and `cellsOf()` cuts that to its squares in order.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PortfolioGroupRow, PortfolioRow } from '../../lib/portfolio/rows'
import type { UseCase, UseCaseStatus } from '../../types'
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
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }
})

const { PortfolioGrid } = await import('./PortfolioGrid')
const { t } = await import('../../lib/i18n')

// The sheet as text. Eager + `?raw`, the mechanism MapBranchDetail.test.tsx uses
// to read a file in a node test — `node:fs` is not an option, because
// tsconfig.app.json carries no `node` in its `types` and importing it reds
// `tsc -b` for the whole solution.
const SHEET_SRC: Record<string, string> = import.meta.glob('./portfolio-grid.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SHEET = SHEET_SRC['./portfolio-grid.css'] ?? ''

/* ────────────────────────────── fixtures ────────────────────────────── */

/**
 * ⚠ NOT `capability()`. `react-hooks/rules-of-hooks` reads a `use`-prefixed
 * identifier as a hook and reds every call at module scope — lib/labels.ts hit
 * the same wall naming `capabilityLabel` and wrote down why. The UI calls these
 * capabilities everywhere a reader can see, so the name that avoids the
 * collision is also the truer one.
 */
function capability(id: string, name: string): UseCase {
  return {
    id,
    name,
    name_ar: '',
    sort_order: 0,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

/** Five capabilities is the shape of 2,415 cells; only the arithmetic differs. */
const CATALOGUE: UseCase[] = [
  capability('c1', 'Eligibility'),
  capability('c2', 'Preauthorization'),
  capability('c3', 'Claims'),
  capability('c4', 'Payment'),
  capability('c5', 'Communication'),
]

/**
 * A progress block from a list of statuses, ONE PER CAPABILITY IN ORDER.
 *
 * `null` in the list is the fourth state and is written as `null` here on
 * purpose: a fixture that spelled it `'planned'` and a component that drew it as
 * `planned` would agree with each other forever.
 */
function progress(statuses: readonly (UseCaseStatus | null)[]): UseCaseProgress {
  const rows = CATALOGUE.map((cap, i) => {
    const status = statuses[i] ?? null
    return {
      useCase: cap,
      status,
      linked: status === null ? 0 : 1,
      done: status === 'live' ? 1 : 0,
      notApplicable: 0,
      rung: null,
      retired: false,
    }
  })
  return {
    rows,
    done: rows.filter((r) => r.status === 'live').length,
    total: CATALOGUE.length,
    linked: rows.filter((r) => r.linked > 0).length,
    nodes: 1,
  }
}

function row(
  id: string,
  name: string,
  over: Partial<PortfolioRow> = {},
): PortfolioRow {
  return {
    key: id,
    order: 0,
    nodeId: id,
    name,
    trailParts: ['UHR'],
    trailLabel: 'UHR',
    retired: false,
    parentId: null,
    parentName: '',
    stageId: null,
    stageOrder: null,
    stageName: null,
    daysInStage: null,
    atRisk: false,
    stallDays: null,
    managerId: null,
    managerName: null,
    vendor: '',
    vendorFold: '',
    progress: progress([]),
    open: 0,
    quietDays: null,
    ...over,
  }
}

function group(
  key: string,
  label: string,
  nodeIds: string[],
  over: Partial<PortfolioGroupRow> = {},
): PortfolioGroupRow {
  return {
    key,
    order: 0,
    label,
    unnamed: false,
    nodeIds,
    orgs: nodeIds.length,
    medianDays: null,
    atRisk: 0,
    open: 0,
    done: null,
    total: null,
    largestBlock: 0,
    largestBlockLabel: '',
    ...over,
  }
}

/**
 * Three organizations whose squares are deliberately different facts.
 *
 *   Riyadh General  live live testing planned —        two live, one testing
 *   Jeddah Central  planned planned — — —              nothing live, three said
 *   Hail Regional   — — — — —                          nobody has said anything
 */
function seed(): PortfolioRow[] {
  return [
    row('jeddah', 'Jeddah Central', {
      order: 1,
      progress: progress(['planned', 'planned', null, null, null]),
    }),
    row('hail', 'Hail Regional', { order: 2, progress: progress([]) }),
    row('riyadh', 'Riyadh General', {
      order: 3,
      managerId: 'm1',
      progress: progress(['live', 'live', 'testing', 'planned', null]),
    }),
  ]
}

function render(
  over: {
    rows?: readonly PortfolioRow[]
    groups?: readonly PortfolioGroupRow[]
    showsRows?: boolean
    catalogue?: readonly UseCase[]
    compact?: boolean
    managerNameOf?: (id: string | null) => string | null
  } = {},
): string {
  return renderToStaticMarkup(
    <PortfolioGrid
      rows={over.rows ?? seed()}
      groups={over.groups ?? []}
      showsRows={over.showsRows ?? true}
      catalogue={over.catalogue ?? CATALOGUE}
      compact={over.compact ?? false}
      managerNameOf={over.managerNameOf ?? ((id) => (id === null ? null : 'Nawaf Alharbi'))}
      onOpenNode={() => {}}
      captionId="grid-cap"
    />,
  )
}

/* ────────────────────────────── slicers ────────────────────────────── */

/** Just the `<tr>` for one organization. Every row carries the same words. */
function rowOf(html: string, name: string): string {
  const rows = html.split('<tr class="pfg-row">').slice(1)
  const hit = rows.find((r) => r.includes(name))
  expect(hit, `no row for ${name}`).toBeDefined()
  return (hit as string).split('</tr>')[0]
}

/** That row's squares, in catalogue order — `data-k` per column. */
function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td class="pfg-cell" data-k="([a-z]+)"/g)].map((m) => m[1])
}

/** The organization names, top to bottom, as the grid ranked them. */
function orderOf(html: string): string[] {
  return [...html.matchAll(/class="pfg-org-btn tap-44"[^>]*>([^<]+)</g)].map((m) =>
    m[1].replace(/[⁦-⁩]/g, ''),
  )
}

/* ══════════════════════ THE ASSERTION THIS TURNS ON ══════════════════════ */

describe('the fourth state', () => {
  it('draws "nobody has said" differently from "planned", in the same row', () => {
    // ONE ROW, so the comparison cannot be satisfied by two different
    // organizations happening to differ. Riyadh's fourth capability is
    // `planned` and its fifth is `null`, and they must not be the same square.
    const cells = cellsOf(rowOf(render(), 'Riyadh General'))
    expect(cells).toEqual(['live', 'live', 'testing', 'planned', 'none'])
    expect(cells[3]).not.toBe(cells[4])
  })

  it('carries a DIFFERENT WORD for it, so the difference survives without colour', () => {
    // WCAG 1.4.1. The square is decoration over a fact already written: a
    // screen reader hears "Planned" on the fourth column and "Nobody has
    // recorded this" on the fifth, and neither depends on seeing the fill.
    const riyadh = rowOf(render(), 'Riyadh General')
    const words = [...riyadh.matchAll(/<span class="sr-only">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(words[3]).toBe(t('mindtree.portfolioGridPlanned'))
    expect(words[4]).toBe(t('mindtree.portfolioGridNone'))
    expect(t('mindtree.portfolioGridNone')).not.toBe(t('mindtree.portfolioGridPlanned'))
  })

  it('is the SURFACE with a hairline in the sheet, and planned is a fill', () => {
    // The markup distinguishing them is only half of it — two `data-k` values
    // with the same declarations would be indistinguishable on screen. Planned
    // is a background; the fourth state is the container's own ground inside an
    // inset ring, which is a difference in FORM and not in hue.
    const planned = SHEET.match(/\.pfg-cell\[data-k='planned'\]::before \{[^}]*\}/)?.[0] ?? ''
    const none = SHEET.match(/\.pfg-cell\[data-k='none'\]::before \{[^}]*\}/)?.[0] ?? ''
    expect(planned).toContain('background: var(--border)')
    expect(none).not.toContain('background: var(--border)')
    expect(none).toContain('box-shadow: inset')
    expect(none).toContain('var(--bg-elev)')
  })

  it('separates it from "nobody has LOOKED", which is a fifth thing again', () => {
    // `progress === null` is the links store not having landed. Drawing it as
    // the fourth state would report five unasked questions from the absence of
    // a fetch — a measurement nobody took.
    const rows = [...seed(), row('tabuk', 'Tabuk Health', { order: 4, progress: null })]
    const html = render({ rows })
    expect(cellsOf(rowOf(html, 'Tabuk Health'))).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    expect(cellsOf(rowOf(html, 'Hail Regional'))).toEqual([
      'none',
      'none',
      'none',
      'none',
      'none',
    ])
  })

  it('says so in words above the grid, because the field of absence is the point', () => {
    const html = render()
    // 3 organizations × 5 capabilities = 15 squares. Riyadh recorded 4 and
    // Jeddah 2; Hail recorded nothing at all. So 9 squares are the fourth state,
    // which is the majority of the grid — the shape this view exists to show.
    expect(html).toContain(t('mindtree.portfolioGridUnrecorded', { count: 9 }))
  })
})

/* ══════════════════════ the totals, in words ══════════════════════ */

describe('the sentence above the picture', () => {
  it('counts the recorded squares out of their denominator', () => {
    // house law 2. "6 of 15 recorded · 2 live" — never a share.
    expect(render()).toContain(
      t('mindtree.portfolioGridTotals', { recorded: 6, total: 15, live: 2 }),
    )
  })

  it('prints no bare percentage anywhere on the page', () => {
    expect(render()).not.toMatch(/\d+\s*[%٪]/)
  })

  it('renders an absence, not a zero, for an organization that recorded nothing', () => {
    // house law 3: `linked === 0` is nobody having said anything, and "0 live of
    // 0 recorded" would be printing a measurement nobody took.
    const hail = rowOf(render(), 'Hail Regional')
    expect(hail).toContain(t('mindtree.portfolioGridNothingRecorded'))
    expect(hail).toContain('—')
    expect(hail).not.toContain(t('mindtree.portfolioGridRowCount', { live: 0, recorded: 0 }))
  })

  it('counts live out of recorded on a row that has both', () => {
    expect(rowOf(render(), 'Riyadh General')).toContain(
      t('mindtree.portfolioGridRowCount', { live: 2, recorded: 4 }),
    )
  })
})

/* ══════════════════════ the ranking ══════════════════════ */

describe('the rows are ranked, not alphabetised', () => {
  it('puts live first, then testing, so the colour pools at the top', () => {
    // Alphabetically this is Hail, Jeddah, Riyadh. By live-then-testing it is
    // Riyadh (2 live), Jeddah (0 live, 0 testing, 2 planned), Hail (nothing) —
    // and Jeddah beats Hail on the tree's own order, the total tiebreak.
    expect(orderOf(render())).toEqual(['Riyadh General', 'Jeddah Central', 'Hail Regional'])
  })

  it('breaks a tie on testing before falling back to the walk order', () => {
    const rows = [
      row('a', 'Alpha Clinic', { order: 1, progress: progress(['live', null, null, null, null]) }),
      row('b', 'Bravo Clinic', {
        order: 2,
        progress: progress(['live', 'testing', null, null, null]),
      }),
    ]
    expect(orderOf(render({ rows }))).toEqual(['Bravo Clinic', 'Alpha Clinic'])
  })
})

/* ══════════════════════ the phone ══════════════════════ */

describe('fifteen columns do not fit 375px and are not made to', () => {
  it('puts the grid in a named, focusable, scrolling region', () => {
    // house law 5, and `.pf-wrap`'s pattern exactly: a reader who cannot use a
    // pointer still reaches the last column.
    const html = render()
    expect(html).toContain('class="pfg-wrap" role="region" aria-labelledby="grid-cap" tabindex="0"')
    // The label it points at has to exist, or the region is named after nothing.
    expect(html).toContain('id="grid-cap"')
    expect(SHEET).toContain('overflow-x: auto')
  })

  it('drops no column on a phone', () => {
    const compact = render({ compact: true })
    expect(cellsOf(rowOf(compact, 'Riyadh General'))).toHaveLength(CATALOGUE.length)
    expect(compact).toContain('data-compact="1"')
  })

  it('pays the padding that stops overflow clipping the 44px target', () => {
    // ⚠ `overflow-x: auto` computes `overflow-y` to `auto` as well and CLIPS a
    // `.tap-44` ::after at the padding edge. `.chip-row` pays 7px for this.
    expect(SHEET).toMatch(/\.pfg-wrap \{[^}]*padding-block: 7px/)
    expect(render()).toContain('pfg-org-btn tap-44')
  })

  it('sticks the organization column to the inline start, in logical properties', () => {
    expect(SHEET).toMatch(/\.pfg-org \{[^}]*inset-inline-start: 0/)
    // house law 6 — no physical box properties anywhere, which is why the
    // Arabic build needs no mirror stylesheet.
    expect(SHEET).not.toMatch(/(^|[\s;{])(left|right|width|height):/m)
  })
})

/* ══════════════════════ the headings and their key ══════════════════════ */

describe('the columns are readable', () => {
  it('numbers the headings and decodes them in a key on the page', () => {
    const html = render()
    const head = html.split('<thead>')[1].split('</thead>')[0]
    // The number for the eye, the capability name for a screen reader.
    expect(head).toContain('<span aria-hidden="true">3</span>')
    expect(head).toContain('Claims')
    // …and the same number is spelled out above the grid, so a sighted reader
    // can decode column 3 without a tooltip.
    const key = html.split('<ol class="pfg-cols">')[1].split('</ol>')[0]
    expect(key).toContain('Claims')
    expect(key).toContain('>3</span>')
  })

  it('lists all four states in the colour key, the fourth included', () => {
    const key = render().split('<ul class="pfg-key">')[1].split('</ul>')[0]
    for (const word of ['Live', 'Testing', 'Planned', 'None'] as const) {
      expect(key).toContain(t(`mindtree.portfolioGrid${word}`))
    }
    expect(key).toContain(`data-k="none"`)
  })
})

/* ══════════════════════ the buckets ══════════════════════ */

describe('when the reader asked for buckets', () => {
  it('sections the same squares under group headings rather than averaging them', () => {
    // A bucket has no per-capability status of its own, so every one of the
    // squares is still on the page — under a heading naming the bucket.
    const html = render({
      showsRows: false,
      groups: [
        group('g1', 'Acme', ['riyadh', 'hail']),
        group('g2', '', ['jeddah'], { unnamed: true }),
      ],
    })
    expect(html).toContain('Acme')
    expect(html).toContain(t('mindtree.portfolioGridUnnamed'))
    expect(orderOf(html)).toEqual(['Riyadh General', 'Hail Regional', 'Jeddah Central'])
    expect(cellsOf(rowOf(html, 'Riyadh General'))).toEqual([
      'live',
      'live',
      'testing',
      'planned',
      'none',
    ])
  })
})

/* ══════════════════════ the states that are not the grid ══════════════════════ */

describe('the empty, the waiting and the catalogue-less', () => {
  it('names itself when the filter left no organizations', () => {
    const html = render({ rows: [] })
    expect(html).toContain(t('mindtree.portfolioGridEmpty'))
    expect(html).toContain('id="grid-cap"')
    expect(html).not.toContain('pfg-cell')
  })

  it('says nobody has LOOKED, quietly, rather than drawing an empty grid', () => {
    const rows = [
      row('a', 'Alpha Clinic', { progress: null }),
      row('b', 'Bravo Clinic', { progress: null }),
    ]
    const html = render({ rows })
    expect(html).toContain(t('mindtree.portfolioGridLoading'))
    // ⚠ THE FAILURE THIS GUARDS: a grid of hollow squares here would claim the
    // workspace has recorded nothing, on the strength of a fetch not having
    // returned.
    expect(html).not.toContain('data-k="none"')
    expect(html).not.toContain(t('mindtree.portfolioGridUnrecorded', { count: 10 }))
  })

  it('offers the fix when the catalogue is empty', () => {
    const html = render({ catalogue: [] })
    expect(html).toContain(t('mindtree.portfolioGridNoCatalogue'))
    expect(html).toContain(t('mindtree.portfolioGridNoCatalogueHint'))
  })
})

/* ══════════════════════ the database strings ══════════════════════ */

describe('every database string is isolated', () => {
  it('fences the organization name, the manager and the capability', () => {
    // house law 7. FSI…PDI around each, so a Latin name in an Arabic row and an
    // Arabic name in a Latin one both keep the punctuation around them.
    const html = render()
    expect(html).toContain('⁨Riyadh General⁩')
    expect(html).toContain('⁨Nawaf Alharbi⁩')
    expect(html).toContain('⁨Eligibility⁩')
  })

  it('renders an absence, not a blank, where nobody owns the organization', () => {
    const hail = rowOf(render(), 'Hail Regional')
    expect(hail).toContain(t('mindtree.portfolioGridNoOwner'))
  })

  it('marks an archived organization rather than dropping it', () => {
    const rows = [row('r', 'Retired Clinic', { retired: true })]
    expect(rowOf(render({ rows }), 'Retired Clinic')).toContain(
      t('mindtree.portfolioGridRetired'),
    )
  })
})

/* ──────────────────── the gate on this unit's own sheet ──────────────── */

describe('every class this view renders has a rule in portfolio-grid.css', () => {
  it('names nothing the sheet was not written against', () => {
    // A glob that resolved to nothing would make every name below "unstyled"
    // rather than passing vacuously, which is the failure direction to want.
    expect(SHEET.length).toBeGreaterThan(500)
    const rendered = new Set(
      [
        render(),
        render({ rows: [] }),
        render({ catalogue: [] }),
        render({ rows: [row('a', 'Alpha Clinic', { progress: null })] }),
        render({
          showsRows: false,
          groups: [group('g1', 'Acme', ['riyadh']), group('g2', '', ['hail'], { unnamed: true })],
        }),
        render({ rows: [row('r', 'Retired Clinic', { retired: true })] }),
      ]
        .join('')
        .match(/pfg-[a-z-]+/g) ?? [],
    )
    // Every state that owns a class of its own is rendered above — a name that
    // only appears in a branch nobody renders is a name this gate is blind to.
    expect(rendered.size).toBeGreaterThan(15)
    const unstyled = [...rendered]
      .filter((name) => !new RegExp(`\\.${name}(?![a-z-])`).test(SHEET))
      .sort()
    expect(unstyled).toEqual([])
  })

  it('styles nothing outside its own prefix', () => {
    // The CSS prefix registry gives each sheet one prefix and forbids styling
    // another's. `.tap-44` and `.sr-only` are global kit the view USES and does
    // not redefine, so the check is on selectors this file writes.
    const selectors = SHEET.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.[a-z][a-z0-9-]*/g) ?? []
    expect([...new Set(selectors)].filter((s) => !s.startsWith('.pfg')).sort()).toEqual([])
  })
})
