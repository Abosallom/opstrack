// Render proof for the capability cards.
//
// THE ONE ASSERTION THIS FILE EXISTS FOR is `the fourth state`, below: an
// unrecorded capability must not be drawn as `planned`. 1,700 of the 2,415 cells
// in this workspace are unrecorded and 311 are planned, so a renderer that
// conflated them would be wrong about the majority of its own marks while
// looking entirely plausible — every card would show a full strip and a reader
// would conclude that somebody had been asked about everything. The proof is in
// two halves and needs both: the MARKUP has to distinguish them (a different
// `data-state`) and the SHEET has to draw the distinction (different rules for
// the two states), because a `data-state` nothing styles is a difference the
// reader cannot see.
//
// ⚠ SLICERS, NEVER A BARE `toContain`. Every card carries the same labels —
// "Account manager", "Current stage", "In stage", "At risk" — so an unqualified
// match is true of the page whatever any single card says. Everything below
// slices to the card it means first, through `cardFor`.
//
// WHY renderToStaticMarkup AND NOT A DOM: `vitest.config.ts` is
// `environment: 'node'` and there is no jsdom in the dependency budget —
// PortfolioStage.test.tsx's paragraph, and this component needs no effect to
// render its answer. It reads no store at all: every fact it draws arrives as a
// prop, which is what makes the four states provable at a fixed instant.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UseCase, UseCaseStatus } from '../../types'
import type { UseCaseProgress } from '../../lib/mapNodes'
import type { PortfolioGroupRow, PortfolioRow } from '../../lib/portfolio/rows'

// lib/i18n reads localStorage at module scope and lib/theme reads matchMedia,
// both at IMPORT time — so the shims cannot wait for a beforeAll().
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

const { PortfolioCards } = await import('./PortfolioCards')
const { t } = await import('../../lib/i18n')

/* ─────────────────────────── the sheet ─────────────────────────── */

// `import.meta.glob` with `?raw`, which is what MapBranchDetail.test.tsx and
// localeReach.test.ts use to read a file in a node test: `node:fs` is not an
// option, because `tsconfig.app.json` carries no `node` in its `types` and
// importing it reds `tsc -b` for the whole solution.
const SHEET_SRC: Record<string, string> = import.meta.glob('./portfolio-cards.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SHEET = SHEET_SRC['./portfolio-cards.css'] ?? ''

/* ─────────────────────────── fixtures ─────────────────────────── */

/** The catalogue, at the size the live workspace actually has it. */
const CATALOGUE: UseCase[] = Array.from({ length: 15 }, (_, i) => ({
  id: `uc-${i}`,
  name: `Capability ${i}`,
  name_ar: '',
  sort_order: i,
  hidden: false,
  created_by: null,
  updated_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}))

/**
 * A progress reading, given the statuses of the first N capabilities.
 *
 * `null` in the array is the FOURTH STATE — nobody has said — and it produces a
 * row with `linked: 0`, which is what `useCaseProgress` produces for a
 * capability with no link row. That distinction is the whole subject of this
 * suite, so the fixture has to be able to express it.
 */
function progressOf(statuses: readonly (UseCaseStatus | null)[]): UseCaseProgress {
  const rows = CATALOGUE.map((useCase, i) => {
    const status = statuses[i] ?? null
    return {
      useCase,
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
    done: rows.reduce((n, r) => n + r.done, 0),
    total: rows.length,
    linked: rows.reduce((n, r) => n + r.linked, 0),
    nodes: 1,
  }
}

function orgRow(over: Partial<PortfolioRow> & { name: string; nodeId: string }): PortfolioRow {
  return {
    key: over.nodeId,
    order: 0,
    trailParts: ['Riyadh Cluster'],
    trailLabel: 'Riyadh Cluster',
    retired: false,
    parentId: null,
    parentName: '',
    stageId: 'stage-1',
    stageOrder: 1,
    stageName: 'Integrating',
    daysInStage: 41,
    atRisk: false,
    stallDays: 60,
    managerId: 'mgr-1',
    managerName: 'Nawaf Alharbi',
    vendor: 'Acme',
    vendorFold: 'acme',
    open: 3,
    quietDays: 9,
    progress: progressOf(['live', 'live', 'planned', 'testing']),
    ...over,
  }
}

function bucketRow(over: Partial<PortfolioGroupRow> & { key: string }): PortfolioGroupRow {
  return {
    order: 0,
    label: 'Integrating',
    unnamed: false,
    nodeIds: ['n1', 'n2'],
    orgs: 2,
    medianDays: 33,
    atRisk: 1,
    open: 7,
    done: 82,
    total: 406,
    largestBlock: 11,
    largestBlockLabel: 'Testing',
    ...over,
  }
}

const MANAGERS: Record<string, string> = { 'mgr-1': 'Nawaf Alharbi' }

function render(over: {
  rows?: readonly PortfolioRow[]
  groups?: readonly PortfolioGroupRow[]
  showsRows?: boolean
  catalogue?: readonly UseCase[]
  compact?: boolean
} = {}): string {
  return renderToStaticMarkup(
    <PortfolioCards
      rows={over.rows ?? []}
      groups={over.groups ?? []}
      showsRows={over.showsRows ?? true}
      catalogue={over.catalogue ?? CATALOGUE}
      compact={over.compact ?? false}
      managerNameOf={(id) => (id === null ? null : (MANAGERS[id] ?? null))}
      onOpenNode={() => {}}
      captionId="cap-1"
    />,
  )
}

/**
 * THE SLICER. One card's markup, found by the organization (or bucket) name it
 * carries, so no assertion below can be satisfied by a different card.
 *
 * It throws rather than returning `''` when the name is not there: an empty
 * slice would make every `not.toContain` in this file pass vacuously, which is
 * the failure direction that hides a bug.
 */
function cardFor(html: string, name: string): string {
  // `slice(1)` drops everything BEFORE the first card — the region's own key
  // list, which carries the words "Live", "Testing" and "Planned" and would
  // otherwise answer to a bucket named after a rung.
  const parts = html.split('<li class="pfc-card"').slice(1)
  const hit = parts.filter((p) => p.includes(name))
  if (hit.length !== 1) throw new Error(`${hit.length} cards match ${name}`)
  return hit[0]
}

/** The `data-state` of the mark at position `i` in a card's strip. */
function marks(card: string): string[] {
  return [...card.matchAll(/<li class="pfc-mark" data-state="([a-z]+)"/g)].map((m) => m[1])
}

/* ═══════════════════════════ the four states ═══════════════════════════ */

describe('the fourth state', () => {
  it('draws "nobody has said" differently from "planned" IN THE MARKUP', () => {
    // The assertion this whole component turns on. Capability 2 is `planned` —
    // somebody looked and said "we intend to". Capabilities 4..14 have no link
    // row at all — the question has never been put. Those are as far apart as
    // any two facts on this screen, and 1,700 of the workspace's 2,415 cells are
    // the second one.
    const html = render({
      rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })],
    })
    const strip = marks(cardFor(html, 'Riyadh General'))
    expect(strip).toHaveLength(15)
    expect(strip[2]).toBe('planned')
    expect(strip[4]).toBe('none')
    expect(strip[2]).not.toBe(strip[4])
    // And the fourth state is the DEFAULT: eleven of the fifteen, on a card whose
    // organization recorded four. That is the shape of this workspace.
    expect(strip.filter((s) => s === 'none')).toHaveLength(11)
  })

  it('draws it differently IN THE SHEET — a socket, never a grey fill', () => {
    // A `data-state` nothing styles is a difference the reader cannot see, so
    // the markup half above is only half the proof.
    const rule = (state: string): string => {
      const at = SHEET.indexOf(`.pfc-mark[data-state='${state}']`)
      expect(at, `no rule for ${state}`).toBeGreaterThan(-1)
      return SHEET.slice(at, SHEET.indexOf('}', at))
    }
    // `planned` is a SOLID square in the quietest token of the three.
    expect(rule('planned')).toContain('background: var(--border)')
    expect(rule('planned')).not.toContain('box-shadow: inset')
    // Unrecorded is the card's OWN GROUND inside a hairline ring — an empty
    // socket — and round where the recorded three are square, so the difference
    // is carried by form and by shape rather than by hue (WCAG 1.4.1).
    expect(rule('none')).toContain('background: var(--bg-elev)')
    expect(rule('none')).toContain('box-shadow: inset 0 0 0 1px var(--border)')
    expect(rule('none')).toContain('border-radius: 50%')
    expect(rule('none')).not.toContain('background: var(--border)')
  })

  it('says the state in words on every mark, so colour is never the only channel', () => {
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] }),
      'Riyadh General',
    )
    // The mark's accessible name is its capability AND its state. `Capability 2`
    // is the planned one; `Capability 4` is the one nobody has been asked about.
    expect(card).toContain(
      t('mindtree.portfolioCardsMark', { name: 'Capability 2', status: t('mapnode.statusPlanned') }),
    )
    expect(card).toContain(
      t('mindtree.portfolioCardsMark', { name: 'Capability 4', status: t('mapnode.statusNone') }),
    )
  })

  it('uses the app’s three colours and invents none of its own', () => {
    // house law 9: live `--green`, testing `--accent`, planned `--border` — the
    // triple in home.css. A fourth hue here would be a fourth state drawn as a
    // colour, which is exactly what this component refuses to do.
    expect(SHEET).toContain('background: var(--green)')
    expect(SHEET).toContain('background: var(--accent)')
    expect(SHEET).toContain('background: var(--border)')
    expect(SHEET.match(/background:\s*#[0-9a-f]{3,8}/gi)).toBeNull()
  })
})

/* ═══════════════════════════ nobody LOOKED ═══════════════════════════ */

describe('the fifth thing, which is not one of the four', () => {
  it('draws a quiet wait where the strip goes when the links have not landed', () => {
    // `progress === null` is the links store not having arrived. Fifteen sockets
    // would report fifteen unasked questions per card on every mount — a
    // measurement nobody took.
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n1', name: 'Jeddah Central', progress: null })] }),
      'Jeddah Central',
    )
    expect(card).toContain('pfc-wait')
    expect(card).toContain(t('common.loading'))
    expect(marks(card)).toEqual([])
    expect(card).not.toContain(t('mindtree.portfolioCardsEmpty'))
  })
})

/* ═══════════════════════════ the counts ═══════════════════════════ */

describe('the sentence under the strip', () => {
  it('counts what it drew, in words', () => {
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] }),
      'Riyadh General',
    )
    // Four recorded, two of them live — and the caption agrees with the strip
    // above it because both are counted off the same array.
    expect(card).toContain(t('mindtree.portfolioCardsCounts', { recorded: 4, live: 2 }))
    const strip = marks(card)
    expect(strip.filter((s) => s !== 'none')).toHaveLength(4)
    expect(strip.filter((s) => s === 'live')).toHaveLength(2)
  })

  it('never prints a bare percentage', () => {
    const html = render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] })
    expect(html).not.toMatch(/\d+\s*%/)
  })

  it('says nothing-recorded in a sentence rather than printing "0 of 15"', () => {
    // house law 3: `linked === 0` is nobody having said anything, and a renderer
    // that prints a zero for it is printing a measurement nobody took.
    const card = cardFor(
      render({
        rows: [orgRow({ nodeId: 'n2', name: 'Dammam Clinic', progress: progressOf([]) })],
      }),
      'Dammam Clinic',
    )
    expect(card).toContain(t('mindtree.portfolioCardsEmpty'))
    expect(card).not.toContain(t('mindtree.portfolioCardsCounts', { recorded: 0, live: 0 }))
    expect(card).not.toContain('0 of 15')
    // The strip still draws: fifteen sockets ARE the checklist of what there is
    // to record, which is the one useful thing a brand-new card can say.
    expect(marks(card).filter((s) => s === 'none')).toHaveLength(15)
  })

  it('separates the two zeroes — recorded four, none of them live', () => {
    const card = cardFor(
      render({
        rows: [
          orgRow({
            nodeId: 'n3',
            name: 'Abha Hospital',
            progress: progressOf(['planned', 'planned', 'testing', 'planned']),
          }),
        ],
      }),
      'Abha Hospital',
    )
    expect(card).toContain(t('mindtree.portfolioCardsCounts', { recorded: 4, live: 0 }))
    expect(card).not.toContain(t('mindtree.portfolioCardsEmpty'))
  })
})

/* ═══════════════════════════ the card itself ═══════════════════════════ */

describe('a card, read on its own', () => {
  it('carries its name, its owner, its rung and how long it has stood there', () => {
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] }),
      'Riyadh General',
    )
    // Every value beside its OWN label — that is the difference between a card
    // and a table row, and the reason somebody can crop one and send it on.
    expect(card).toContain(t('mindtree.colManager'))
    expect(card).toContain('Nawaf Alharbi')
    expect(card).toContain(t('mindtree.colStage'))
    expect(card).toContain('Integrating')
    expect(card).toContain(t('mindtree.colInStage'))
    expect(card).toContain(t('mindtree.portfolioDays', { count: 41 }))
    expect(card).toContain(t('mindtree.portfolioOnTrack'))
  })

  it('says "nobody named" for an unassigned organization, and never a zero', () => {
    // 42 of the 161 organizations have no account manager. That is a finding,
    // not a blank.
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n4', name: 'Tabuk Clinic', managerId: null })] }),
      'Tabuk Clinic',
    )
    expect(card).toContain(t('mindtree.portfolioNoManager'))
  })

  it('withholds the verdict on an organization nobody has staged', () => {
    // "Inside its stage time" about an unstaged organization is a reassurance
    // nobody earned — MapBranchDetail's rule, and the em-dash-plus-word idiom is
    // the app's one way of saying so.
    const card = cardFor(
      render({
        rows: [
          orgRow({
            nodeId: 'n5',
            name: 'Hail Centre',
            stageId: null,
            stageName: null,
            stageOrder: null,
            daysInStage: null,
            atRisk: false,
          }),
        ],
      }),
      'Hail Centre',
    )
    expect(card).toContain(t('mindtree.portfolioUnstaged'))
    expect(card).toContain('—')
    expect(card).toContain(`<span class="sr-only">${t('mapnode.notRecorded')}</span>`)
    expect(card).not.toContain(t('mindtree.portfolioOnTrack'))
    expect(card).not.toContain(t('mindtree.portfolioAtRisk'))
  })

  it('marks a past-its-stage organization in words as well as in ink', () => {
    const html = render({
      rows: [
        orgRow({ nodeId: 'n1', name: 'Riyadh General' }),
        orgRow({ nodeId: 'n6', name: 'Najran Hospital', atRisk: true, daysInStage: 210 }),
      ],
    })
    // Sliced, because both cards carry the words "At risk" as a LABEL and only
    // one of them is past its stage.
    expect(cardFor(html, 'Najran Hospital')).toContain(t('mindtree.portfolioAtRisk'))
    expect(cardFor(html, 'Riyadh General')).not.toContain(t('mindtree.portfolioAtRisk'))
    expect(cardFor(html, 'Najran Hospital')).toContain('data-risk="true"')
    expect(cardFor(html, 'Riyadh General')).not.toContain('data-risk="true"')
  })

  it('opens the organization by node id, with a name that says so', () => {
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] }),
      'Riyadh General',
    )
    expect(card).toContain('class="pfc-open tap-44"')
    expect(card).toContain(t('mindtree.portfolioOpenOrg', { name: 'Riyadh General' }))
  })

  it('marks an archived organization rather than dropping it', () => {
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n7', name: 'Old Depot', retired: true })] }),
      'Old Depot',
    )
    expect(card).toContain(t('mapnode.retired'))
  })

  it('isolates every database string it prints', () => {
    // house law 7. An unisolated Latin name inside an Arabic trail drags the
    // line's punctuation across; FSI…PDI is what stops it.
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] }),
      'Riyadh General',
    )
    expect(card).toContain('⁨Riyadh General⁩')
    expect(card).toContain('⁨Nawaf Alharbi⁩')
    expect(card).toContain('⁨Integrating⁩')
    expect(card).toContain('⁨Riyadh Cluster⁩')
  })
})

/* ═══════════════════════════ the strip's order ═══════════════════════════ */

describe('the strip', () => {
  it('is CATALOGUE ORDER on every card, so position 7 is one capability', () => {
    // The comparison the whole view is for. The second organization's progress
    // is missing a row for a capability the first one has — which is what
    // `useCaseProgress` does with a hidden capability nobody linked — and the
    // strip must STILL put every catalogue entry at its own index.
    const short = progressOf(['live'])
    const thin: UseCaseProgress = { ...short, rows: short.rows.slice(0, 3), total: 3 }
    const html = render({
      rows: [
        orgRow({ nodeId: 'n1', name: 'Riyadh General' }),
        orgRow({ nodeId: 'n8', name: 'Yanbu Clinic', progress: thin }),
      ],
    })
    expect(marks(cardFor(html, 'Riyadh General'))).toHaveLength(15)
    expect(marks(cardFor(html, 'Yanbu Clinic'))).toHaveLength(15)
    expect(marks(cardFor(html, 'Yanbu Clinic'))[0]).toBe('live')
    expect(marks(cardFor(html, 'Yanbu Clinic'))[14]).toBe('none')
  })

  it('names itself for its own organization', () => {
    const card = cardFor(
      render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] }),
      'Riyadh General',
    )
    expect(card).toContain(t('mapnode.useCasesFor', { name: 'Riyadh General' }))
  })
})

/* ═══════════════════════════ buckets ═══════════════════════════ */

describe('the roll-up', () => {
  it('draws a card per bucket, same shape, coarser subject', () => {
    const html = render({
      showsRows: false,
      rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })],
      groups: [
        bucketRow({ key: 'stage-1', label: 'Integrating' }),
        bucketRow({ key: 'stage-2', label: 'Live', orgs: 40, atRisk: 0, largestBlock: 0 }),
      ],
    })
    // The organizations are NOT drawn — `showsRows` is the single rule.
    expect(html).not.toContain('Riyadh General')
    const card = cardFor(html, 'Integrating')
    expect(card).toContain(t('mindtree.portfolioTotal', { count: 2 }))
    expect(card).toContain(t('mindtree.portfolioProgress', { done: 82, total: 406 }))
    // "One fix unblocks eleven" — the bucket's own instruction, sliced so the
    // sibling card's zero cannot satisfy it.
    expect(card).toContain(t('mindtree.portfolioBlock', { count: 11, stage: 'Testing' }))
    expect(cardFor(html, 'Live')).not.toContain('pfc-block')
  })

  it('never hands a bucket key to onOpenNode', () => {
    // A bucket key is a stage id, a manager id or a folded vendor string, and
    // `entityIdOf` exists because none of those is a map-node id. So a bucket
    // card carries no open control at all.
    const html = render({
      showsRows: false,
      groups: [bucketRow({ key: 'vendor:acme', label: 'Acme' })],
    })
    expect(html).not.toContain('pfc-open')
    expect(html).not.toContain('<button')
  })

  it('tells the unnamed bucket from a named one', () => {
    const html = render({
      showsRows: false,
      groups: [bucketRow({ key: '', label: '', unnamed: true, largestBlock: 0 })],
    })
    expect(html).toContain(t('mapnode.notRecorded'))
  })

  it('keeps a bucket’s three absences apart', () => {
    // `done === null` is the links store not having landed; `total === 0` is a
    // catalogue with nothing on it; a real pair is "82 of 406". Three facts.
    const unread = render({
      showsRows: false,
      groups: [bucketRow({ key: 'a', label: 'Unread', done: null, total: null })],
    })
    expect(cardFor(unread, 'Unread')).toContain(t('common.loading'))

    const bare = render({
      showsRows: false,
      groups: [bucketRow({ key: 'b', label: 'Bare', done: 0, total: 0 })],
    })
    expect(cardFor(bare, 'Bare')).toContain(t('mindtree.portfolioCardsEmpty'))

    const measured = render({
      showsRows: false,
      groups: [bucketRow({ key: 'c', label: 'Measured' })],
    })
    expect(cardFor(measured, 'Measured')).toContain(
      t('mindtree.portfolioProgress', { done: 82, total: 406 }),
    )
  })

  it('shows a median of nothing as a dash, never a zero', () => {
    const card = cardFor(
      render({
        showsRows: false,
        groups: [bucketRow({ key: 'd', label: 'Unstaged', medianDays: null })],
      }),
      'Unstaged',
    )
    expect(card).toContain(`<span class="sr-only">${t('mapnode.notRecorded')}</span>`)
  })
})

/* ═══════════════════════════ the frame ═══════════════════════════ */

describe('the region', () => {
  it('is a named, focusable scroller — the wrapper pans, the page never does', () => {
    const html = render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] })
    expect(html).toMatch(
      /^<div class="pfc" role="region" aria-labelledby="cap-1" tabindex="0"/,
    )
    expect(SHEET).toContain('overflow: auto')
    expect(SHEET).toContain('min-inline-size: 0')
  })

  it('lays out on auto-fit at 280px — one column at 375px', () => {
    // pmo.css's precedent, and its stated reason: auto-fit picks the moment
    // rather than a breakpoint that has to be kept in step.
    expect(SHEET).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr))')
  })

  it('carries the key to the four marks', () => {
    const html = render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] })
    expect(html).toContain(t('mindtree.portfolioCardsKey'))
    // Four items, one per state, above the grid.
    const key = html.slice(html.indexOf('pfc-key'), html.indexOf('pfc-grid'))
    expect([...key.matchAll(/data-state="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      'live',
      'testing',
      'planned',
      'none',
    ])
  })

  it('drops no fact on a phone — compact buys back padding and nothing else', () => {
    const wide = render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] })
    const narrow = render({
      rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })],
      compact: true,
    })
    expect(narrow).toContain('data-compact="true"')
    expect(marks(cardFor(narrow, 'Riyadh General'))).toEqual(
      marks(cardFor(wide, 'Riyadh General')),
    )
    // Same labels, same values, same strip: only the wrapper's attribute moved.
    expect(narrow.replace(' data-compact="true"', '')).toBe(wide)
  })

  it('names its own empty state and does not draw a key over nothing', () => {
    const html = render({ rows: [] })
    expect(html).toContain(t('mindtree.portfolioEmpty'))
    expect(html).toContain(t('mindtree.portfolioEmptyHint'))
    expect(html).not.toContain('pfc-key')
    expect(html).not.toContain('pfc-grid')
  })

  it('is empty for an empty roll-up too, not only for empty rows', () => {
    const html = render({ showsRows: false, groups: [] })
    expect(html).toContain(t('mindtree.portfolioEmpty'))
  })
})

/* ═══════════════ the gate on the sheet this view owns ═══════════════ */

describe('every class this view renders has a rule in portfolio-cards.css', () => {
  it('names nothing the sheet was not written against', () => {
    // MapBranchDetail.test.tsx's gate, for its reason: a name with no rule
    // silently takes the shared kit's defaults and reads as styling that does
    // not exist. A glob that resolved to nothing would make every name below
    // "unstyled" rather than passing vacuously, which is the failure direction
    // to want.
    expect(SHEET.length).toBeGreaterThan(500)
    const html =
      render({
        rows: [
          orgRow({ nodeId: 'n1', name: 'Riyadh General' }),
          orgRow({ nodeId: 'n2', name: 'Quiet Clinic', progress: null, retired: true }),
        ],
      }) +
      render({
        showsRows: false,
        groups: [bucketRow({ key: 'stage-1', label: 'Integrating' })],
      }) +
      render({ rows: [] })
    const rendered = new Set(html.match(/pfc-[a-z-]+/g) ?? [])
    // Every one of them, including the blank state and the bucket card, or the
    // slice would prove nothing about the half it did not render.
    expect(rendered.size).toBeGreaterThan(12)
    const unstyled = [...rendered]
      .filter((name) => !new RegExp(`\\.${name}(?![a-z-])`).test(SHEET))
      .sort()
    expect(unstyled).toEqual([])
  })

  it('uses logical properties only, so the Arabic build needs no mirror sheet', () => {
    // house law 6. `left`/`right`/`width` are what a mirror stylesheet is FOR,
    // and this sheet does not have one.
    expect(SHEET).not.toMatch(/[^-]\b(?:width|left|right|margin-left|padding-right)\s*:/)
  })

  it('draws every mark as a box and never as an SVG', () => {
    // house law 4: an SVG mark needs its size in user units before it can draw,
    // and a size that must be measured is what breaks between a 375px phone and
    // a rotated one.
    const html = render({ rows: [orgRow({ nodeId: 'n1', name: 'Riyadh General' })] })
    expect(html).not.toContain('<svg')
  })
})
