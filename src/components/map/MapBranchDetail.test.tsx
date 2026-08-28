// Render proof for the detail band — the thing that opens when Aziz clicks an
// organization.
//
// WHY renderToStaticMarkup AND NOT A DOM: `vitest.config.ts` is
// `environment: 'node'` and jsdom is not in the dependency budget.
// MapBranch.test.tsx, Board.test and the entry kit's own test all open with this
// paragraph.
//
// WHAT THAT COSTS HERE, and how the component is shaped to pay it: effects do
// not run on the server, so the connected `MapBranchDetail` can only ever be
// caught mid-fetch. That is why the markup lives in an exported `DetailBand`
// taking plain props — rendered directly, it exercises the real
// `useCaseProgress`, the real bidi isolates and the real `t()` with the real
// bundles, and the connected component is left with exactly two decisions worth
// asserting: whether a band exists at all, and what it shows before the links
// land.
//
// ⚠ TWO CASES BELOW ARE RED UNTIL THE INTEGRATOR WIRES THIS UNIT, AND THAT IS
// WHAT THEY ARE FOR — the locale namespace and the stylesheet. Both are files
// this unit does not own, both are invisible to every standing gate until they
// are wired, and both fail SILENTLY in the browser rather than loudly: an
// unregistered namespace renders `mapnode.detail` at a user in both languages
// with every other test green, and a class with no rule takes the shared kit's
// defaults and reads as styling that was never written. See MapBranch.test.tsx's
// own namespace gate, which is this paragraph one file over.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MapNode, MapNodeUseCase, UseCase, UseCaseRung,
  UseCaseStatus } from '../../types'
import type { MapNodeGoal } from '../../api/goals'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage and store/config adds a window listener, both at
  // IMPORT time, so the shims cannot wait for a beforeAll().
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

  const members = [
    { id: 'u1', displayName: 'Sara Alsaab', role: 'member' as const },
    { id: 'u2', displayName: 'ريما السعيري', role: 'member' as const },
  ]

  const state: {
    nodes: MapNode[]
    /** node id → its progress row, as store/config would publish it. */
    progress: Map<string, { node_id: string; stage_id: string | null; stage_changed_at: string | null; updated_at: string; updated_by: string | null }>
    /** The ladder, by rung id. */
    stages: Map<string, { id: string; expected_days: number | null; terminal: boolean; paused: boolean }>
    vendorOfNode: Map<string, string>
    managerOfNode: Map<string, string | null>
    /**
     * 0036 — which rungs each capability passes through.
     *
     * ⚠ EMPTY IS THE SHIPPING STATE, and `rungsFor()` reads it as all five, so
     *   every test that does not touch it asserts on the picture the panel drew
     *   before 0036 existed.
     */
    ladders: Map<string, Set<UseCaseRung>>
    today: string
  } = {
    nodes: [],
    progress: new Map(),
    stages: new Map(),
    vendorOfNode: new Map(),
    managerOfNode: new Map(),
    ladders: new Map(),
    today: '2026-03-10',
  }
  return { members, state, mem }
})

/**
 * api/map is mocked ONLY to keep api/supabase — and therefore createClient — out
 * of the module graph. Nothing resolves during a static render, so the value it
 * returns is never read.
 */
vi.mock('../../api/map', () => ({
  listNodeUseCases: () => new Promise<never>(() => {}),
}))

vi.mock('../../store/config', () => ({
  // The three `NodeEditor` reads. It renders NOTHING without `structure.edit`,
  // which `useHasPerm` answers false for in this suite, so an empty roster and
  // an empty kind list keep every assertion in this file describing the same
  // markup — the same bargain the stage picker's empty ladder strikes above.
  useMapNodes: () => fx.state.nodes,
  useMapNodeKinds: () => [],
  // 0034's catalogue. Empty is the shipping state: the migration seeded
  // eleven products and filled in nobody.
  useHisProducts: () => [],
  // 0036. EMPTY IS THE SHIPPING STATE — the table does not exist on the live
  // project, `rungsFor()` reads that as all five, and every test that leaves it
  // alone therefore asserts on the picture the panel drew before 0036 existed.
  useUseCaseRungs: () => fx.state.ladders,
  // 0033's readiness. `undefined` is the shipping answer for all 140:
  // nobody has said, which is not the same as "not started".
  useNodeReadiness: () => undefined,
  invalidateConfig: () => {},
  useMapNodeMap: () => new Map(fx.state.nodes.map((n) => [n.id, n])),
  useAllUseCases: () => [],
  // The three the STAGE PICKER reads. The band mounts it now (the read-only-v1
  // decision is reversed for `map_node_progress` — see the component header),
  // and an unmocked selector is a store reaching for Supabase inside a headless
  // render. An EMPTY ladder is the right default here: this suite is about what
  // the band says, and with no rungs configured the picker renders nothing, so
  // every existing assertion in the file keeps describing the same markup.
  useMapNodeStages: () => [],
  useStageMap: () => fx.state.stages,
  useNodeProgress: () => fx.state.progress,
  publishNodeProgress: () => {},
}))

vi.mock('../../store/members', () => ({
  // `NodeEditor`'s manager picker. Empty: it renders nothing without
  // `structure.edit`, which this suite does not hold.
  useMembers: () => [],
  useMemberMap: () => new Map(fx.members.map((m) => [m.id, m])),
}))

/**
 * The band reads the INHERITED vendor and manager now, and inheritance lives in
 * `useFilterContext` — one ancestor walk over the whole node map, published by
 * store/entries. Mocked rather than left real for this suite's standing reason:
 * the real hook reaches into store/config's track map and store/auth, and this
 * file mocks store/config down to the four reads the band makes. The FIELD NAMES
 * are the real context's, so a rename there is a red test here rather than a
 * band that quietly falls back to the raw column forever.
 */
vi.mock('../../store/entries', () => ({
  useFilterContext: () => ({
    meId: null,
    today: fx.state.today,
    groupOfTrack: new Map(),
    ancestryOfNode: new Map(),
    vendorOfNode: fx.state.vendorOfNode,
    managerOfNode: fx.state.managerOfNode,
  }),
}))

// The overlay's two mutators, REAL rather than mocked: the whole point of the
// case below is that a write through the store module reaches this band.
const { dropPending, setPending } = await import('../../store/stageOverlay')
const MapBranchDetail = (await import('./MapBranchDetail')).default
const { DetailBand, GoalBand, goalClock, localName, managerLabel } =
  await import('./MapBranchDetail')
const { useCaseProgress: progressOf } = await import('../../lib/mapNodes')
const { setLocale, t } = await import('../../lib/i18n')
const { phoneDetentFor: phoneDetent } = await import('../../lib/mindtree/lens')

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

function catalogue(): UseCase[] {
  seq = 0
  return [
    capability({ id: 'adt', name: 'ADT', name_ar: 'القبول والخروج' }),
    capability({ id: 'rx1', name: 'Medication Prescribe V1' }),
    capability({ id: 'rad', name: 'Radiology Order' }),
  ]
}

function link(useCaseId: string, status: UseCaseStatus): MapNodeUseCase {
  return { node_id: 'org-1', use_case_id: useCaseId, status }
}

function mapNode(over: Partial<MapNode> & Pick<MapNode, 'id' | 'name'>): MapNode {
  return {
    parent_id: 'phase-1',
    track_id: 't-uhr',
    kind_id: 'k-org',
    name_ar: '',
    description: '',
    description_ar: '',
    account_manager_id: null,
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

interface BandOptions {
  hisName?: string | null
  name?: string
  kindName?: string | null
  manager?: string | null
  vendor?: string
  /** The stage triad's two visible halves. Null is "nobody has said". */
  daysInStage?: number | null
  atRisk?: boolean
  /** Absent by default, exactly as it is until the integrator threads it. */
  rollup?: { open: number; quietDays: number | null } | null
  rows?: UseCase[]
  links?: MapNodeUseCase[]
  terminal?: string
  loading?: boolean
  error?: string | null
}

function band({
  name = 'King Fahad Medical City',
  kindName = 'Organization',
  manager = 'Sara Alsaab',
  vendor = 'Acme Health',
  daysInStage = null,
  atRisk = false,
  hisName = null,
  rollup = null,
  rows = catalogue(),
  links = [link('adt', 'live'), link('rx1', 'testing')],
  terminal = 'live',
  loading = false,
  error = null,
}: BandOptions = {}): string {
  return renderToStaticMarkup(
    <DetailBand
      name={name}
      kindName={kindName}
      manager={manager}
      vendor={vendor}
      hisName={hisName}
      daysInStage={daysInStage}
      atRisk={atRisk}
      rollup={rollup}
      progress={progressOf(rows, links, terminal, [{ id: 'org-1' }])}
      labelOf={(useCase) => localName(useCase, getLocale())}
      loading={loading}
      error={error}
    />,
  )
}

const { getLocale } = await import('../../lib/i18n')

/* ─────────────────────────── the goal band ───────────────────────────── */

/**
 * One commitment, in 0027's commonest count form: "40 of them, by 31 Dec".
 *
 * The row type comes from api/goals.ts rather than being restated here, so a
 * column rename in 0027's client half is a compile error in this fixture rather
 * than a test that keeps passing about a shape the app no longer holds.
 */
function goal(over: Partial<MapNodeGoal> = {}): MapNodeGoal {
  return {
    id: 'g1',
    node_id: 'org-1',
    label: 'Phase 2 go-live',
    label_ar: '',
    stage_id: null,
    target: 40,
    target_date: '2026-12-31',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...over,
  }
}

interface GoalBandOptions {
  goals?: MapNodeGoal[]
  readings?: Map<string, { reached: number; unstaged: number }>
  canEdit?: boolean
  loading?: boolean
  error?: string | null
}

/**
 * `now` IS INJECTED, and that is the whole reason `GoalBand` takes one: every
 * days-left assertion below would otherwise be true for exactly one day and then
 * start failing on a machine nobody changed. 1 Dec 2026 against a 31 Dec date is
 * 30 days, forever.
 */
function goalBand({
  goals = [goal()],
  readings,
  canEdit = true,
  loading = false,
  error = null,
}: GoalBandOptions = {}): string {
  return renderToStaticMarkup(
    <GoalBand
      nodeId="org-1"
      name="King Fahad Medical City"
      goals={goals}
      readings={readings}
      stageNameOf={(stageId) => (stageId === null ? null : 'Go-live ready')}
      pickable={() => []}
      canEdit={canEdit}
      busy={false}
      loading={loading}
      error={error}
      onSave={async () => true}
      onDelete={async () => {}}
      now={new Date('2026-12-01T00:00:00.000Z')}
    />,
  )
}

// The sheet as text. Eager + `?raw`, the mechanism MapCapture.test.tsx and
// localeReach.test.ts both use to read a file in a node test — `node:fs` is not
// an option here, because `tsconfig.app.json` carries no `node` in its `types`
// and importing it reds `tsc -b` for the whole solution.
const SHEET_SRC: Record<string, string> = import.meta.glob('./map-branch.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const SHEET = SHEET_SRC['./map-branch.css'] ?? ''

/** The character the panel pairs with an `.sr-only` word for every absence. */
const EM_DASH_CHAR = '\u2014'

/**
 * Just the field list.
 *
 * The fields and the matrix both render an em-dash for "nothing recorded", so an
 * unqualified count of them is true of the band whatever either half is doing.
 * MapBranch.test.tsx slices the history band off for the same reason.
 *
 * ⚠ BOUNDED BY ITS OWN `</dl>`, NOT BY THE MATRIX THAT USED TO FOLLOW IT. This
 *   sliced from `mbr-fields` to `mbr-uc"` until the matrix moved above the
 *   fields, at which point the two indices crossed and the slice came back
 *   empty — the assertion failed with "Target cannot be null", which is a
 *   helper breaking, not a band. A helper that encodes the order of two
 *   siblings reddens on a reordering that changes nothing it is testing.
 */
const fieldsOf = (html: string): string => {
  const from = html.indexOf('mbr-fields')
  if (from < 0) return ''
  const to = html.indexOf('</dl>', from)
  return html.slice(from, to < 0 ? undefined : to)
}

/**
 * Just the matrix's heading line.
 *
 * Same argument as `fieldsOf`: every row below carries the same "nothing
 * recorded" sentence for its own empty status, so an unqualified `toContain` is
 * true of the band whatever the heading says.
 */
const ucHeadOf = (html: string): string => {
  const from = html.indexOf('mbr-uc-head')
  const to = html.indexOf('mbr-uc-list')
  return html.slice(from, to < 0 ? undefined : to)
}

/** React's own escaping, so an assertion can be written against a real t(). */
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

/* ──────────────────── the gates on files this unit does not own ──────── */

describe('the namespace this band reads', () => {
  it('is registered in src/locales/index.ts', () => {
    // ⚠ RED UNTIL THE INTEGRATOR ADDS `mapnode` TO EN_NAMESPACES/AR_NAMESPACES.
    // An unregistered namespace is invisible to BOTH standing locale gates —
    // localeParity walks EN_NAMESPACES and localeReach skips a key whose root is
    // not already a root — so the band would render `mapnode.accountManager` at
    // a user, in both languages, with everything else green.
    expect(t('mapnode.detail')).not.toBe('mapnode.detail')
    expect(t('mapnode.progress', { done: 6, total: 9, status: 'live' })).not.toBe('mapnode.progress')
  })
})

describe('every class this band renders has a rule in map-branch.css', () => {
  it('names nothing the sheet was not written against', () => {
    // ⚠ RED UNTIL THE INTEGRATOR APPLIES THE `.mbr-detail` BLOCK. This band owns
    // no prefix of its own — MapBranchHistory.tsx's bargain, and the reason the
    // CSS registry needs no new entry — so a name with no rule silently takes
    // the shared kit's defaults and reads as styling that does not exist. Six
    // such names shipped in the history band and had to be found by hand;
    // MapCapture.test.tsx's equivalent gate is what keeps them out of that one.
    // A glob that resolved to nothing would make every name below "unstyled"
    // rather than passing vacuously, which is the failure direction to want.
    expect(SHEET.length).toBeGreaterThan(500)
    const rendered = new Set(band().match(/mbr-[a-z-]+/g) ?? [])
    // `.mbr-detail` is an IDENTITY, not a style — the twin of `.mbr-history`,
    // which is there so a test can slice the panel at this band. An empty rule
    // for it would be a lie about what it does.
    rendered.delete('mbr-detail')
    const unstyled = [...rendered]
      .filter((name) => !new RegExp(`\\.${name}(?![a-z-])`).test(SHEET))
      .sort()
    expect(unstyled).toEqual([])
  })

  it('names nothing the sheet was not written against, in the GOAL band either', () => {
    // The band above and this one share a prefix and a stylesheet but not a
    // render, so the slice above cannot see a single `.mbr-goal*` name. Every
    // state that owns a class of its own is rendered here — the row, the
    // shortfall clause, the unstaged clause, the editor's controls and the empty
    // state — because a name that only appears in a branch nobody renders is a
    // name this gate is blind to.
    const rendered = new Set(
      [
        goalBand({ readings: new Map([['g1', { reached: 6, unstaged: 380 }]]) }),
        goalBand({ goals: [] }),
        goalBand({ loading: true }),
      ]
        .join(' ')
        .match(/mbr-[a-z-]+/g) ?? [],
    )
    // `.mbr-goals` is an IDENTITY, not a style — the twin of `.mbr-detail` one
    // gate up, there so a test can slice the panel at this band.
    rendered.delete('mbr-goals')
    const unstyled = [...rendered]
      .filter((name) => !new RegExp(`\\.${name}(?![a-z-])`).test(SHEET))
      .sort()
    expect(unstyled).toEqual([])
  })
})

/* ──────────────────────────── the fields ─────────────────────────────── */

describe('what the band leads with', () => {
  it('puts the use-case matrix above the fields', () => {
    // The owner's ruling: the panel opens with the eleven use cases, because
    // "how far has each use case got" is what he clicks an organization to find
    // out. The account manager and the vendor are the second question.
    //
    // ⚠ THIS IS THE ONLY THING PINNING THE ORDER. The reorder that put the
    //   matrix first changed no markup, no class and no string — nothing else
    //   in this file would have reddened if it were quietly undone.
    const html = band({ links: [link('adt', 'live')] })
    const matrix = html.indexOf('mbr-uc"')
    const fields = html.indexOf('mbr-fields')
    expect(matrix).toBeGreaterThan(-1)
    expect(fields).toBeGreaterThan(-1)
    expect(matrix).toBeLessThan(fields)
  })

  it('still renders both halves', () => {
    // An order assertion passes trivially if one half stopped rendering.
    const html = band({ links: [link('adt', 'live')] })
    expect(html).toContain('mbr-uc-list')
    expect(html).toContain('mbr-field-k')
  })
})

describe('the fields', () => {
  it('names the account manager through the roster, never as stored text', () => {
    // A REFERENCE, not a name: renaming a person must propagate to every
    // organization they carry rather than leaving forty stale strings.
    const byId = new Map(fx.members.map((m) => [m.id, m]))
    expect(managerLabel(byId, 'u1')).toBe('Sara Alsaab')
    expect(managerLabel(byId, null)).toBeNull()
  })

  it('says a manager who left the workspace is gone, rather than showing a dash', () => {
    // An id the roster does not know is a person who left, not an organization
    // with nobody on it, and only one of those needs a phone call.
    const byId = new Map(fx.members.map((m) => [m.id, m]))
    expect(managerLabel(byId, 'u-gone')).toBe(t('mapnode.managerGone'))
  })

  it('renders the names with an em-dash when the values are empty', () => {
    // "Account manager: —" is a FACT. The band that renders nothing at all is
    // the one whose kind declares no fields; a node with fields and no values
    // says so, because the two are different questions.
    const html = band({ manager: null, vendor: '' })
    expect(html).toContain(esc(t('mapnode.accountManager')))
    expect(html).toContain(esc(t('mapnode.vendor')))
    // Scoped to the field list: the matrix below it renders a dash of its own on
    // every capability with nothing recorded, and an unscoped count would pass
    // whatever the fields did.
    //
    // FOUR, and the two new ones are the stage clock's. `daysInStage` null is
    // "nobody has said where this organization is", and the risk verdict follows
    // it: "Inside its stage time" about an unstaged organization is a
    // reassurance nobody earned, so it reads the dash rather than the word.
    // FIVE, not four: the hospital system (0034) joined the fields and is
    // recorded on none of the 140 organizations, so it is an absence like the
    // rest. The count is asserted rather than "at least one" because the whole
    // point is that every empty field says so — a field that quietly stopped
    // rendering would still pass a loose test.
    expect(fieldsOf(html).match(/—/g)).toHaveLength(5)
    // The dash is for the eye; the word is for a screen reader, because ARIA 1.2
    // prohibits naming a generic <span> and AT is free to drop an aria-label.
    expect(html).toContain(esc(t('mapnode.notRecorded')))
  })

  it('isolates the values, so a Latin vendor beside Arabic keeps its punctuation', () => {
    const html = band({ manager: 'ريما السعيري', vendor: 'Acme Health' })
    expect(html).toContain('⁨Acme Health⁩')
    expect(html).toContain('⁨ريما السعيري⁩')
  })

  it('renders the kind as a caption and never as a condition', () => {
    // Nothing in the component may branch on this: what a Phase shows and what
    // an Organization shows is configuration. Renaming a kind in the admin
    // screen must change a caption and nothing else.
    expect(band({ kindName: 'Organization' })).toContain('⁨Organization⁩')
    const renamed = band({ kindName: 'Hospital' })
    expect(renamed).toContain('⁨Hospital⁩')
    expect(renamed).toContain(esc(t('mapnode.useCases')))
    expect(renamed).toContain('mbr-uc-row')
  })

  it('drops the caption for a node whose kind row was deleted', () => {
    // `map_nodes.kind_id` is `on delete set null` — retiring a kind un-kinds its
    // nodes rather than deleting the organizations filed under them.
    expect(band({ kindName: null })).not.toContain('mbr-band-count')
  })
})

/* ──────────────────────────── the matrix ─────────────────────────────── */

describe('the use-case matrix', () => {
  it('heads itself with the progress, and the progress is not a stat tile', () => {
    const html = band({
      links: [link('adt', 'live'), link('rx1', 'live'), link('rad', 'testing')],
    })
    expect(html).toContain(
      esc(t('mapnode.progress', { done: 2, total: 3, status: t('mapnode.wordLive') })),
    )
    // `6 of 9` beside `12 open` would be two units in one row of numbers. The
    // heading is the only place the unit is written directly above the figure,
    // and the stats band's tile classes must not appear in this band.
    expect(html).not.toContain('mbr-stat')
  })

  it('names its scope and its unit for a reader who cannot see the heading', () => {
    // A live region announces its CONTENT, not its label, so the scope has to be
    // in the text. The visible half is aria-hidden and the announced half is the
    // long form.
    const html = band({ name: 'KFMC' })
    expect(html).toContain('role="status"')
    expect(html).toContain(
      esc(
        t('mapnode.progressLong', {
          done: 1,
          total: 3,
          status: t('mapnode.wordLive'),
          name: 'KFMC',
        }),
      ),
    )
  })

  it('renders a row per capability, including the ones with nothing recorded', () => {
    const html = band({ links: [link('adt', 'live')] })
    expect(html.match(/mbr-uc-row/g)).toHaveLength(3)
    expect(html).toContain('⁨Radiology Order⁩')
    expect(html).toContain(esc(t('mapnode.statusNone')))
  })

  it('marks a retired capability rather than dropping it', () => {
    const rows = catalogue().map((u) => (u.id === 'rx1' ? { ...u, hidden: true } : u))
    const html = band({ rows, links: [link('adt', 'live'), link('rx1', 'live')] })
    expect(html).toContain(esc(t('mapnode.retired')))
    expect(html).toContain('data-retired="true"')
    // And it still counts: 2 of 3, not 2 of 2.
    expect(html).toContain(
      esc(t('mapnode.progress', { done: 2, total: 3, status: t('mapnode.wordLive') })),
    )
  })

  it('says nothing is recorded, in words, instead of 0 of 3 or a bare dash', () => {
    // "This organization is at zero" and "nobody has recorded anything about
    // this organization" are different facts, and the second one is what an
    // empty join says.
    //
    // IN WORDS, because this is the state a brand-new organization is in and the
    // owner is about to create organizations from scratch. The dash is right in
    // a FIELD and in the status column, where a label sits beside it; here it
    // would be standing in for a whole sentence at the head of a band that is
    // otherwise ten rows of dashes, and a failed load would look the same.
    const html = band({ links: [] })
    expect(ucHeadOf(html)).toContain(esc(t('mapnode.statusNone')))
    expect(html).not.toContain(
      esc(t('mapnode.progress', { done: 0, total: 3, status: t('mapnode.wordLive') })),
    )
  })

  it('still lists every capability for an organization with nothing recorded', () => {
    // The rows are the CHECKLIST of what there is to record — the one useful
    // thing this band can say before anybody has said anything — so the empty
    // state loses the number, never the list.
    const html = band({ links: [] })
    expect(html.match(/mbr-uc-row/g)).toHaveLength(3)
    expect(html).toContain('⁨ADT⁩')
  })

  it('shows the loading state before the links land, and no rows', () => {
    const html = band({ loading: true })
    expect(html).toContain(esc(t('common.loading')))
    expect(html).not.toContain('mbr-uc-row')
  })

  it('renders a failed read as a note, not as an empty matrix', () => {
    // The error is an i18n KEY from api/map.ts, rendered through t(), never a
    // Postgres sentence printed left-to-right at an Arabic reader.
    const html = band({ error: 'common.error' })
    expect(html).toContain(esc(t('common.error')))
    expect(html).toContain('mbr-note')
    expect(html).not.toContain('mbr-uc-row')
  })
})

/* ─────────────────────── the band that is not drawn ──────────────────── */

describe('a node whose kind declares no fields', () => {
  it('renders no band at all for a branch that is not an entity', () => {
    // A fourth empty section above the stats teaches nothing and costs a
    // screenful on a phone. `entityIdOf` answers null for a track, a status
    // bucket and the root, and null is what this asserts against.
    expect(renderToStaticMarkup(<MapBranchDetail nodeId={null} kindName={null} />)).toBe('')
  })

  it('renders no band for an entity whose row has not arrived yet', () => {
    fx.state.nodes = []
    expect(renderToStaticMarkup(<MapBranchDetail nodeId="org-1" kindName="Organization" />)).toBe('')
  })

  it('renders the band once the row is in the store', () => {
    fx.state.nodes = [mapNode({ id: 'org-1', name: 'KFMC', vendor: 'Acme Health' })]
    const html = renderToStaticMarkup(<MapBranchDetail nodeId="org-1" kindName="Organization" />)
    expect(html).toContain('mbr-detail')
    expect(html).toContain(esc(t('mapnode.accountManager')))
    // Mid-fetch, which is all a static render can ever catch: no effects run.
    expect(html).toContain(esc(t('common.loading')))
  })
})

/* ────────────── one field set, the same one the table shows ────────────── */
//
// THE THREE SURFACES THIS SUITE CAN SEE THE SEAM OF. The map card, the portfolio
// table and this band show ONE set of facts about one organization, and each of
// them writes it in its own vocabulary — so what is shared is the arithmetic and
// never the words. These cases pin the band's half of that: the values it reads
// are the inherited ones the filter admits by, the day count comes off the same
// `stageReading` the table's column does, and the roll-up rows are threaded from
// the walk that drew the picture rather than recomputed here.

describe('the shared field set, as the panel says it', () => {
  /** The band, connected, over a fixture that has a rung and a stamp. */
  function connected(over: {
    stampedDaysAgo?: number
    expectedDays?: number | null
    vendor?: string
    manager?: string | null
  } = {}): string {
    const { stampedDaysAgo = 68, expectedDays = 30, vendor = '', manager = null } = over
    // ANCHORED ON THE WALL CLOCK, at local noon, because the CONNECTED band
    // holds no injectable instant: `stageReading` is called with `new Date()`
    // inside the component, exactly as it is in the app. Noon rather than
    // midnight so a stamp cannot fall on the wrong side of a local day boundary
    // and turn "68 days" into 67 on the machine that runs this at 00:30.
    const at = new Date()
    at.setHours(12, 0, 0, 0)
    at.setDate(at.getDate() - stampedDaysAgo)
    const stamp = at.toISOString()
    fx.state.nodes = [mapNode({ id: 'org-1', name: 'KFMC', vendor, account_manager_id: manager })]
    fx.state.stages = new Map([
      ['kick', { id: 'kick', expected_days: expectedDays, terminal: false, paused: false }],
    ])
    fx.state.progress = new Map([
      [
        'org-1',
        {
          node_id: 'org-1',
          stage_id: 'kick',
          stage_changed_at: stamp,
          updated_at: stamp,
          // A PERSON put it there. `fields.ts` treats a null here as a script's
          // clock and reports no days at all, which is a different test.
          updated_by: 'person-1',
        },
      ],
    ])
    return renderToStaticMarkup(<MapBranchDetail nodeId="org-1" kindName="Organization" />)
  }

  beforeEach(() => {
    fx.state.vendorOfNode = new Map()
    fx.state.managerOfNode = new Map()
    fx.state.stages = new Map()
    fx.state.progress = new Map()
  })

  it('prints the portfolio’s own day count and verdict beside the rung', () => {
    // The SAME two keys the table's `In stage` and `At risk` cells use. A reader
    // who renames "Past its stage" in Settings renames it on both surfaces,
    // which is the whole promise a shared key makes.
    const html = connected({ stampedDaysAgo: 68, expectedDays: 30 })
    expect(html).toContain(esc(t('mindtree.colInStage')))
    expect(html).toContain(esc(t('mindtree.portfolioDays', { count: 68 })))
    expect(html).toContain(esc(t('mindtree.portfolioAtRisk')))
    expect(html).not.toContain(esc(t('mindtree.portfolioOnTrack')))
  })

  it('says inside its stage time when the rung’s expectation has not been passed', () => {
    const html = connected({ stampedDaysAgo: 9, expectedDays: 30 })
    expect(html).toContain(esc(t('mindtree.portfolioDays', { count: 9 })))
    expect(html).toContain(esc(t('mindtree.portfolioOnTrack')))
  })

  it('resets the stage clock the instant this tab writes a rung', () => {
    /* THE REGRESSION THE OVERLAY'S MOVE MADE TESTABLE. The rung CONTROL is three
       rows above the day count on this band, so a panel reading the store's
       stamp alone would answer "68 days" beside a rung the reader chose a second
       ago — which reads as the write having failed, on the one screen where the
       cause and the consequence are two centimetres apart. It could not be
       caught while the overlay lived inside PortfolioStage.tsx's module scope. */
    expect(connected({ stampedDaysAgo: 68 })).toContain(
      esc(t('mindtree.portfolioDays', { count: 68 })),
    )
    setPending('org-1', 'kick')
    try {
      const html = connected({ stampedDaysAgo: 68 })
      expect(html).toContain(esc(t('mindtree.portfolioDays', { count: 0 })))
      expect(html).not.toContain(esc(t('mindtree.portfolioDays', { count: 68 })))
      // And the verdict follows the clock rather than the stamp: nought days is
      // not past a thirty-day expectation.
      expect(html).toContain(esc(t('mindtree.portfolioOnTrack')))
    } finally {
      // Module state outlives one case, so it is put back or the next case
      // inherits a rung nobody in it wrote.
      dropPending('org-1')
    }
  })

  it('shows the INHERITED vendor and manager, and falls back to the row when the chain is silent', () => {
    /* ONE SCREEN, ONE DEFINITION. `?vendor=Acme` admits an organization by the
       nearest self-or-ancestor value and the `?by=vendor` ring draws it in
       Acme's cohort; a panel reading the raw column showed a blank second field
       on exactly those organizations, which reads as a bug in the ring. */
    fx.state.vendorOfNode = new Map([['org-1', 'Acme Health']])
    fx.state.managerOfNode = new Map([['org-1', 'u1']])
    const inherited = connected({ vendor: '', manager: null })
    expect(inherited).toContain('⁨Acme Health⁩')
    expect(inherited).toContain('⁨Sara Alsaab⁩')

    // ABSENT FROM THE MAP IS A COLD START, NOT AN EMPTY CHAIN: the row's own
    // columns stand in rather than the panel blanking every field for a frame.
    fx.state.vendorOfNode = new Map()
    fx.state.managerOfNode = new Map()
    const raw = connected({ vendor: 'Northwind', manager: 'u2' })
    expect(raw).toContain('⁨Northwind⁩')
    expect(raw).toContain('⁨ريما السعيري⁩')
  })

  it('renders the walk’s open and quiet rows only once the roll-up is threaded', () => {
    // Absent is "nobody has counted", which is a different fact from a zero and
    // must not print as one — so the two rows are gone rather than zeroed.
    const without = band()
    expect(without).not.toContain(esc(t('mindtree.colOpen')))
    expect(without).not.toContain(esc(t('mindtree.colQuiet')))

    const withRollup = band({ rollup: { open: 12, quietDays: 2 } })
    expect(withRollup).toContain(esc(t('mindtree.colOpen')))
    expect(withRollup).toContain('>12</dd>')
    expect(withRollup).toContain(esc(t('mindtree.portfolioDays', { count: 2 })))

    // `OrgRow`'s renderer exactly: null quiet is the dash, never a nought.
    const silent = band({ rollup: { open: 0, quietDays: null } })
    expect(silent).toContain(esc(t('mindtree.colQuiet')))
    expect(silent).toContain(esc(t('mapnode.notRecorded')))
  })
})

/* ─────────────────── which node this band opens ON ───────────────────── */

/**
 * THE BAND WAS RIGHT AND THE SUBJECT WAS WRONG, which is the whole of what this
 * unit had left to do: `MapBranch` mounts this component on the panel's subject
 * node, and the panel's subject was resolved from the DRILL-IN alone. Tapping an
 * Organization deliberately does not re-root the map, so the drill-in still
 * named the department above it — and on the workspace as it stands today, with
 * nothing drilled into at all, it named nothing and the sidebar rendered empty.
 *
 * ASSERTED HERE, IN THE BAND'S OWN SUITE, and the reason is worth stating: this
 * unit owns `useMapLens.ts` and this file, and no third. `panelSubjectFor` is
 * exported precisely so the precedence can be read with plain values — the hook
 * around it cannot be observed under `renderToStaticMarkup`, whose single pass
 * never sees a setter's effect. If the integrator gives `useMapLens` a suite of
 * its own, this block moves there whole.
 */
const { panelSubjectFor } = await import('../../pages/map/useMapLens')

describe('the node the sidebar opens on', () => {
  it('prefers the SELECTED organization over the world the reader is inside', () => {
    // The tap that opens this band moves nothing on the canvas, so the drill-in
    // is still the department. Reading it would show the department's account
    // manager under the organization's name.
    expect(panelSubjectFor('shape', 'org-1', 'dept-1')).toEqual({
      kind: 'branch',
      nodeId: 'org-1',
    })
  })

  it('opens on an organization even when nothing is drilled into at all', () => {
    // TODAY'S WORKSPACE. The map draws UHR alone with no drill-in, so
    // `focusNodeId` is null — and `shape` with null is `{kind:'none'}`, which
    // renders NO PANEL. Before this precedence existed the sidebar could not
    // open on the only workspace there is.
    expect(panelSubjectFor('shape', 'org-1', null)).toEqual({ kind: 'branch', nodeId: 'org-1' })
    expect(panelSubjectFor('shape', null, null)).toEqual({ kind: 'none' })
  })

  it('falls back to the drill-in with nothing selected, exactly as before', () => {
    expect(panelSubjectFor('shape', null, 'dept-1')).toEqual({
      kind: 'branch',
      nodeId: 'dept-1',
    })
  })

  it('changes no other lens, because a selection is only a `shape` question', () => {
    // No new PanelSubject and no new MapLens: the four other lenses answer
    // questions about the workspace, not about one node, and a pick must not
    // leak into them.
    expect(panelSubjectFor('needs-me', 'org-1', null)).toEqual({ kind: 'needsMe' })
    expect(panelSubjectFor('what-changed', 'org-1', 'dept-1')).toEqual({ kind: 'changes' })
    expect(panelSubjectFor('numbers', 'org-1', null)).toEqual({ kind: 'numbers' })
    expect(panelSubjectFor('by-status', 'org-1', null)).toEqual({ kind: 'none' })
  })

  it('opens a phone at the branch height, not at the sliver', () => {
    // The detent follows the RESOLVED subject. Computed from the drill-in
    // instead, an organization tapped on a map with no drill-in resolves `none`
    // → `peek`, and the sheet opens as a sliver over the node the reader just
    // asked about.
    expect(phoneDetent(panelSubjectFor('shape', 'org-1', null))).toBe('half')
    expect(phoneDetent(panelSubjectFor('shape', null, null))).toBe('peek')
  })
})

/* ──────────────────────────── Arabic ─────────────────────────────────── */

describe('Arabic', () => {
  it('renders the same structure, not a reduced one', () => {
    setLocale('ar')
    try {
      const html = band()
      expect(html).toContain(esc(t('mapnode.accountManager')))
      expect(html).toContain(esc(t('mapnode.useCases')))
      expect(html.match(/mbr-uc-row/g)).toHaveLength(3)
      expect(html).toContain(
        esc(t('mapnode.progress', { done: 1, total: 3, status: t('mapnode.wordLive') })),
      )
    } finally {
      setLocale('en')
    }
  })

  it('falls back to the English name when the Arabic one is EMPTY, not null', () => {
    // Both columns are `not null default ''`, and the ten seeded capabilities
    // ship with the Arabic name blank on purpose — everybody in the room says
    // "ADT".
    setLocale('ar')
    try {
      const rows = catalogue()
      expect(localName(rows[0], 'ar')).toBe('القبول والخروج')
      expect(localName(rows[1], 'ar')).toBe('Medication Prescribe V1')
      const html = band()
      expect(html).toContain('⁨Medication Prescribe V1⁩')
    } finally {
      setLocale('en')
    }
  })
})

/* ────────────────────────────── a11y ─────────────────────────────────── */

describe('a11y', () => {
  it('labels the band and the matrix, and puts the async result in one live region', () => {
    const html = band({ name: 'KFMC' })
    expect(html).toContain(`aria-label="${esc(t('mapnode.detail'))}"`)
    expect(html).toContain(`aria-label="${esc(t('mapnode.useCasesFor', { name: 'KFMC' }))}"`)
    // ONE region, so a reader hears one sentence per load rather than three.
    expect(html.match(/role="status"/g)).toHaveLength(1)
  })

  it('renders no interactive control, so there is no 44px target to miss', () => {
    // v1 is read-only by design: `map_node_use_cases` is member-writable and the
    // catalogue screen owns the writing. A second place to tick the same cell is
    // a second place for the two to disagree about what was saved.
    const html = band()
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('<a ')
  })
})

/* ────────────────────────── the goal band ─────────────────────────────── */

describe('the goal band', () => {
  it('renders the promise with an em-dash where no fold has run, never a zero', () => {
    // NOTHING PASSES `readings` TODAY (MapBranch.tsx says why), so this is the
    // state every reader is actually in. "0 of 40" would report forty
    // organizations as having got nowhere on the strength of an arithmetic that
    // has not run — the one number this band must never print.
    const html = goalBand()
    expect(html).toContain('40')
    expect(html).not.toContain('0 of 40')
    expect(html).toContain('—')
    // The dash is for the eye; the ear gets the word, because a dash inside an
    // interpolation is announced as nothing and would leave "of 40 arrived by…".
    expect(html).toContain(esc(t('mapnode.notRecorded')))
    expect(html).toContain(esc(t('mapnode.goalLeft', { count: 30 })))
  })

  it('turns a reading into the number, the shortfall and the unstaged clause', () => {
    const html = goalBand({ readings: new Map([['g1', { reached: 6, unstaged: 380 }]]) })
    expect(html).toContain(
      esc(t('mapnode.goalCount', { reached: '6', target: 40, date: '31/12/2026' })),
    )
    expect(html).toContain(esc(t('mapnode.goalBehind', { count: 34 })))
    expect(html).toContain(esc(t('mapnode.goalUnstaged', { count: 380 })))
    // Once the fold has spoken there is nothing left unknown to stand in for.
    expect(html).not.toContain(esc(t('mapnode.notRecorded')))
  })

  it('reads an overdue goal as a positive number of days, never a minus sign', () => {
    const html = goalBand({ goals: [goal({ target_date: '2026-11-01' })] })
    expect(html).toContain(esc(t('mapnode.goalOverdue', { count: 30 })))
    expect(html).not.toContain('-30')
    expect(html).toContain('data-tone="over"')
  })

  it('gives a member no editing affordance at all — absent, not disabled', () => {
    // `structure.edit` is the ADs'; the three account managers read this band.
    // A DISABLED control would be a promise the database refuses to keep, and
    // `disabled` is one attribute away from being edited back in.
    const html = goalBand({ canEdit: false })
    expect(html).not.toContain('<button')
    expect(html).not.toContain(esc(t('mapnode.goalAdd')))
    // The AD sees both, which is what makes the assertion above about
    // permission rather than about a band that renders no controls at all.
    const ad = goalBand()
    expect(ad).toContain(esc(t('mapnode.goalAdd')))
    expect(ad).toContain(esc(t('mapnode.goalEditOne', { goal: 'Phase 2 go-live' })))
  })

  it('renders a missing table as the empty state, and every other failure as a note', () => {
    // ⚠ THE PRE-MIGRATION STATE, WHICH IS EVERY READER UNTIL AZIZ RUNS 0027.
    // `map_node_goals` does not exist, so `listGoals` answers PGRST205 on every
    // open — and a table that does not exist holds no goals, which is
    // indistinguishable from a branch nobody has promised anything about.
    const missing = goalBand({ goals: [], error: 'common.errMissingTable' })
    expect(missing).toContain(esc(t('mapnode.goalsNone')))
    expect(missing).not.toContain(esc(t('common.errMissingTable')))
    // Any OTHER failure is a fact the reader needs, so it is not swallowed —
    // without this half the assertion above would pass on a band that hid
    // everything.
    const refused = goalBand({ goals: [], error: 'common.error' })
    expect(refused).toContain(esc(t('common.error')))
    expect(refused).not.toContain(esc(t('mapnode.goalsNone')))
  })

  it('says all four of 0027s sentences, in Arabic, with no raw key left on screen', () => {
    setLocale('ar')
    try {
      const html = goalBand({
        goals: [
          goal({ id: 'g1', label_ar: 'التشغيل الثاني' }),
          goal({ id: 'g2', stage_id: 's1' }),
          goal({ id: 'g3', target: null }),
          goal({ id: 'g4', target: null, stage_id: 's1' }),
        ],
        readings: new Map([['g1', { reached: 6, unstaged: 0 }]]),
      })
      expect(html.match(/mbr-goal"/g)).toHaveLength(4)
      expect(html).not.toContain('mapnode.')
      expect(html).toContain('⁨التشغيل الثاني⁩')
    } finally {
      setLocale('en')
    }
  })

  it('goalClock has three arms, and the middle one is a day nobody can round away', () => {
    // Zero is neither "0 days left" nor "0 days overdue" — both read as "nothing
    // is happening" on the single day when the opposite is true.
    expect(goalClock(30)).toEqual({ key: 'mapnode.goalLeft', count: 30, tone: 'ahead' })
    expect(goalClock(0)).toEqual({ key: 'mapnode.goalDue', count: 0, tone: 'due' })
    expect(goalClock(-3)).toEqual({ key: 'mapnode.goalOverdue', count: 3, tone: 'over' })
  })
})

describe('the rung, drawn as position', () => {
  /** A link on the ladder. `rung` is the truth; `status` is its shadow. */
  const at = (useCaseId: string, rung: UseCaseRung): MapNodeUseCase => ({
    node_id: 'org-1',
    use_case_id: useCaseId,
    status: rung === 'prod' ? 'live' : rung === 'intake' ? 'planned' : 'testing',
    rung,
  })

  /** The five markers' states, in order, off the rendered track. */
  const states = (html: string): string[] => {
    const track = /<ol class="mbr-rung"[\s\S]*?<\/ol>/.exec(html)?.[0] ?? ''
    return [...track.matchAll(/data-state="(\w+)"/g)].map((m) => m[1])
  }

  it('puts the marker at the rung, with the passed rungs behind it', () => {
    const html = band({ links: [at('adt', 'stg')] })
    expect(states(html)).toEqual(['passed', 'passed', 'at', 'ahead', 'ahead'])
  })

  it('draws the first and last rungs at the ends of the track', () => {
    expect(states(band({ links: [at('adt', 'intake')] })))
      .toEqual(['at', 'ahead', 'ahead', 'ahead', 'ahead'])
    expect(states(band({ links: [at('adt', 'prod')] })))
      .toEqual(['passed', 'passed', 'passed', 'passed', 'at'])
  })

  it('states the position as a count for a screen reader, never as a percentage', () => {
    // "step 3 of 5" is a fact a reader can check against the picture. "60%" is a
    // number nobody measured — house law, and the reason the ladder is drawn at
    // all rather than summarised.
    const html = band({ links: [at('adt', 'stg')] })
    expect(html).toContain(esc(t('mapnode.rungStg')))
    expect(html).toMatch(/step 3 of 5/)
    expect(html).not.toMatch(/\d+%/)
  })

  /**
   * 0036 — "each use case has its own phases", which the owner clarified as: the
   * same five, but some do not apply to some capabilities.
   *
   * ⚠ §11.5 SAYS DISTANCE ALONG THE TRACK IS THE PROGRESS, and that is only
   *   true if the track is the one this capability actually walks. Drawing a
   *   three-stop capability's PROD marker at position 5 of 5 would report
   *   FINISHED work as two-fifths short, on the one screen whose whole job is
   *   to be readable from across a room.
   */
  describe('when a capability skips rungs', () => {
    afterEach(() => {
      fx.state.ladders = new Map()
    })

    it('draws only the stops that capability makes', () => {
      fx.state.ladders = new Map([['adt', new Set<UseCaseRung>(['intake', 'dev', 'prod'])]])
      expect(states(band({ links: [at('adt', 'dev')] }))).toEqual(['passed', 'at', 'ahead'])
    })

    it('puts a finished short ladder at the END of its own track, not four-fifths along', () => {
      fx.state.ladders = new Map([['adt', new Set<UseCaseRung>(['intake', 'dev', 'prod'])]])
      const html = band({ links: [at('adt', 'prod')] })
      expect(states(html)).toEqual(['passed', 'passed', 'at'])
      expect(html).toMatch(/step 3 of 3/)
    })

    it('still draws all five for a capability nobody has narrowed', () => {
      // The other capability in a configured workspace, and every capability
      // before 0036 is applied. `rungsFor()` makes both the same case.
      fx.state.ladders = new Map([['lab', new Set<UseCaseRung>(['intake', 'prod'])]])
      expect(states(band({ links: [at('adt', 'stg')] }))).toEqual([
        'passed',
        'passed',
        'at',
        'ahead',
        'ahead',
      ])
    })

    it('draws nothing for a pair standing on a rung its capability does not have', () => {
      // Reachable only by a direct SQL write with 0036's guard disabled. A
      // marker at position zero would say "not started" about a pair at
      // STG/TEST, which is worse than untouched paper.
      fx.state.ladders = new Map([['adt', new Set<UseCaseRung>(['intake', 'prod'])]])
      expect(band({ links: [at('adt', 'stg')] })).not.toContain('class="mbr-rung"')
    })
  })

  it('leaves the paper alone when nobody has placed the pair', () => {
    // ⚠ UNTOUCHED PAPER, NEVER A MARKER AT POSITION ZERO. An unrecorded pair and
    //   a pair sitting at Intake must not be two arrangements of one picture, so
    //   no track is rendered at all — docs/OPERATING-MODEL.md §11.5.
    const html = band({ links: [] })
    expect(html).not.toContain('class="mbr-rung"')
    expect(html).toContain(EM_DASH_CHAR)
  })

  it('says a ruled-out pair does not apply, rather than drawing it at zero', () => {
    const html = band({
      links: [{ node_id: 'org-1', use_case_id: 'adt', status: 'planned', rung: 'intake', scope: 'not_applicable' }],
    })
    expect(html).toContain(esc(t('mapnode.scopeNa')))
  })
})

describe('the ladder is position and not colour, and the stylesheet proves it', () => {
  /** The rung block, sliced off the sheet by its own heading. */
  const block = (): string =>
    /═ THE RUNG, DRAWN AS POSITION[\s\S]*?(?=\n\.mbr-uc-name)/.exec(SHEET)?.[0] ?? ''

  it('is findable at all, so nothing below passes vacuously', () => {
    expect(block().length).toBeGreaterThan(400)
  })

  it('never selects on the rung, because five hues for five rungs is the forbidden drawing', () => {
    // `data-rung` is on the markup so the tests above can assert a position
    // without measuring a pixel. It is for the test, NOT for the paint: the
    // moment a rule keys off it, the ladder has become a palette and a reader in
    // greyscale, or one who was never told what the colours mean, is left with
    // nothing.
    expect(block()).not.toMatch(/\[data-rung=/)
  })

  it('spends two inks and no more', () => {
    // `--text` for what has happened, `--border` for what has not, `--bg-elev`
    // only as the ring that lifts the marker off the rail. The states differ by
    // SIZE and FILL, which are channels that survive a greyscale print.
    const inks = [...new Set(block().match(/var\(--[a-z-]+\)/g) ?? [])].sort()
    expect(inks).toEqual(['var(--bg-elev)', 'var(--border)', 'var(--text)'])
  })

  it('uses logical properties only, so the ladder runs in the reading direction', () => {
    // ⚠ A PHYSICAL OFFSET HERE IS A LIE TOLD FLUENTLY: every Arabic reader would
    //   see the estate's progress running backwards, and nothing on the screen
    //   would look broken. localeParity covers the strings; nothing but this
    //   covers the geometry.
    expect(block()).not.toMatch(/[^-](left|right)\s*:/)
    expect(block()).not.toMatch(/margin-left|margin-right|padding-left|padding-right/)
    expect(block()).not.toMatch(/translateX\(/)
  })
})

describe('the hospital system', () => {
  it('names the system when one is recorded', () => {
    expect(band({ hisName: 'Careware' })).toContain('Careware')
  })

  it('reads not-recorded as an absence, not as a system called nothing', () => {
    // All 140 organizations are in this state today — 0034 seeded the catalogue
    // and deliberately filled in nobody. The em-dash carries its `.sr-only` word
    // like every other absence on this band.
    const html = band({ hisName: null })
    const fields = fieldsOf(html)
    expect(fields).toContain(esc(t('mapnode.his')))
    expect(fields).toContain(EM_DASH_CHAR)
  })
})
