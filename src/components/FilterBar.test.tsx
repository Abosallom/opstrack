// The facets no screen test can prove — Group, and now Branch and Vendor.
//
// pages/Mindtree.tsx is the one place this component is rendered, and it mocks
// nothing: every other suite that touches the filter mocks the STORES as empty,
// because its subject is its own surface. That covers exactly one of the two
// branches in each of these facets, and it is the boring one. This file covers
// the other: what they render when the workspace HAS groups, nodes and vendors,
// which is the state every user is in the moment 0018 and 0023 are applied.
//
// renderToStaticMarkup and no DOM, for the reason every sibling page test gives:
// vitest.config.ts is `environment: 'node'`. A static render cannot open the
// disclosure panel — but it does not need to, because `hidden` is an attribute
// and the panel's markup is present either way, which is precisely why the panel
// has to be correct before anyone clicks.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and lib/theme reads matchMedia,
  // both at IMPORT time, so the shims cannot wait for a beforeAll().
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

  const tech = {
    id: 'g-tech',
    name: 'Technical',
    name_ar: 'التقنية',
    color: '#7586d5',
    // The seeded pair from 0018. Kept as a pair here on purpose: the dot is
    // painted from two custom properties and a test that supplied one hex would
    // not notice a reader that had stopped emitting the light one.
    color_light: '#1d2961',
    sort_order: 1,
    created_by: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
  const biz = { ...tech, id: 'g-biz', name: 'Business', name_ar: 'الأعمال', sort_order: 2 }

  // Aziz's own example branch: UHR ─ OB ─ Org1 / Org2, plus a phase with no
  // integrator, because "most of the tree has no vendor" is the case the facet
  // is designed around.
  const node = {
    id: 'ob',
    parent_id: null,
    track_id: 'tr-uhr',
    kind_id: null,
    name: 'Onboarding',
    name_ar: 'التسجيل',
    description: '',
    description_ar: '',
    account_manager_id: null,
    vendor: '',
    sort_order: 1,
    archived: false,
    archived_at: null,
    source: 'local' as const,
    external_ref: null,
    external_url: null,
    synced_at: null,
    overrides: [],
    created_by: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
  const org1 = {
    ...node,
    id: 'org1',
    parent_id: 'ob',
    name: 'King Fahad Hospital',
    name_ar: 'مستشفى الملك فهد',
    vendor: 'Acme',
  }
  // The SAME integrator, typed by a different person on a different day. One
  // chip, not two — the whole reason the option list dedupes on the fold.
  const org2 = { ...org1, id: 'org2', name: 'Riyadh Clinic', name_ar: '', vendor: ' acme ' }
  const org3 = { ...org1, id: 'org3', name: 'Jeddah Centre', vendor: 'Beta Systems' }
  const state = { groups: [tech, biz], nodes: [node, org1, org2, org3] }
  return { state, tech, biz, node, org1, org2, org3 }
})

vi.mock('../store/config', () => ({
  useGroups: () => fx.state.groups,
  useActiveTracks: () => [],
  useTrackMap: () => new Map(),
  useMapNodes: () => fx.state.nodes,
  // Built FROM the same array as the list, so a case that swaps a node's
  // definition changes both — two sources of one node is how a fixture starts
  // lying (MapBranch.test.tsx's rule for its track map).
  useMapNodeMap: () => new Map(fx.state.nodes.map((n) => [n.id, n])),
}))

vi.mock('../store/members', () => ({ useMembers: () => [] }))

vi.mock('../store/vocab', () => ({ useVocab: () => [] }))

const { setLocale, t } = await import('../lib/i18n')
const { EMPTY_FILTER } = await import('../lib/entryFilter')
const FilterBar = (await import('./FilterBar')).default
type FilterState = import('../lib/entryFilter').FilterState

const render = (value: FilterState = { ...EMPTY_FILTER }): string =>
  renderToStaticMarkup(<FilterBar value={value} onChange={() => {}} />)

describe('the Group facet', () => {
  it('renders as its own facet, above Track', () => {
    const html = render()
    expect(html).toContain(t('filter.group'))
    expect(html).toContain('Technical')
    expect(html).toContain('Business')
    // Group is the coarser cut and the one a person reaches for first ("my
    // half"), so the panel must read group → track and not the reverse.
    expect(html.indexOf(t('filter.group'))).toBeLessThan(html.indexOf(t('filter.track')))
  })

  it('offers "any group" rather than making the choice mandatory', () => {
    expect(render()).toContain(t('filter.anyGroup'))
  })

  it('marks the selected group checked, and only that one', () => {
    const html = render({ ...EMPTY_FILTER, groupIds: ['g-biz'] })
    // Sliced to this facet: the panel holds three radiogroups and each reports
    // one checked option, so an unscoped count would pass whatever this one did.
    const facet = html.slice(html.indexOf(t('filter.group')), html.indexOf(t('filter.track')))
    const checked = facet.match(/aria-checked="true"/g) ?? []
    // Two selections inside one single-select facet is the shape a screen reader
    // announces as "2 of 3 selected" over a control that can only hold one.
    expect(checked).toHaveLength(1)
    expect(facet).toContain('>Business<')
    expect(facet.indexOf('aria-checked="true"')).toBeGreaterThan(facet.indexOf(t('filter.anyGroup')))
  })

  it('counts as an active facet in the rail badge', () => {
    // The badge is what tells someone their list is filtered before they open
    // the panel. A group filter that did not light it would be invisible.
    const html = render({ ...EMPTY_FILTER, groupIds: ['g-tech'] })
    expect(html).toContain(t('filter.activeCount', { count: 1 }))
    expect(html).toContain(t('filter.clearAll'))
  })

  it('paints each group from its stored PAIR of hexes, never one picked in JS', () => {
    // lib/trackStyle's contract: both hexes go to CSS as custom properties and
    // CSS chooses. A JS-picked colour is picked once, at render, and keeps
    // yesterday's hex when the `auto` theme flips at sunset under a mounted page.
    const html = render()
    expect(html).toContain('--track-c-dark:#7586d5')
    expect(html).toContain('--track-c-light:#1d2961')
  })

  it('disappears entirely when the workspace has no groups', () => {
    // Before 0018, and in a build with no Supabase project at all. A heading
    // over a lone "Any group" chip is a control that looks broken; nothing at
    // all is the honest rendering of a dimension that does not exist yet.
    fx.state.groups = []
    try {
      const html = render()
      expect(html).not.toContain(t('filter.group'))
      expect(html).not.toContain(t('filter.anyGroup'))
      // …and the rest of the bar is untouched.
      expect(html).toContain(t('filter.track'))
    } finally {
      fx.state.groups = [fx.tech, fx.biz]
    }
  })

  it('labels each group in the reading language, falling back when untranslated', () => {
    setLocale('ar')
    try {
      expect(render()).toContain('التقنية')
      // `name_ar` is `not null default ''`, so the fallback tests for EMPTY and
      // not for null — a group nobody has translated shows its English name
      // rather than a blank chip.
      fx.state.groups = [{ ...fx.tech, name_ar: '   ' }]
      expect(render()).toContain('Technical')
    } finally {
      fx.state.groups = [fx.tech, fx.biz]
      setLocale('en')
    }
  })
})

// The slice between one facet heading and the next. Every facet in this panel is
// a radiogroup or a toggle group reporting its own checked options, so an
// unscoped count would pass whatever any other facet happened to do.
const facet = (html: string, from: string, to: string): string =>
  html.slice(html.indexOf(from), html.indexOf(to))

describe('the Vendor facet — filter the map by the integrator', () => {
  it('renders one option per integrator, between Track and Status', () => {
    const html = render()
    expect(html).toContain(t('filter.vendor'))
    expect(html).toContain('Acme')
    expect(html).toContain('Beta Systems')
    expect(html.indexOf(t('filter.track'))).toBeLessThan(html.indexOf(t('filter.vendor')))
    expect(html.indexOf(t('filter.vendor'))).toBeLessThan(html.indexOf(t('filter.status')))
  })

  it('collapses two spellings of one integrator into one option', () => {
    // org1 carries 'Acme' and org2 carries ' acme ' — the same company typed by
    // two people. Two chips would select identical rows and look like two
    // vendors that each half the work.
    const slice = facet(render(), t('filter.vendor'), t('filter.status'))
    expect(slice.match(/>Acme</g) ?? []).toHaveLength(1)
    expect(slice).not.toContain('>acme<')
    // Any vendor · Acme · Beta Systems, and nothing else.
    expect(slice.match(/role="radio"/g) ?? []).toHaveLength(3)
  })

  it('offers "any vendor" rather than making the choice mandatory', () => {
    expect(render()).toContain(t('filter.anyVendor'))
  })

  it('checks the chosen integrator however the link spelled it', () => {
    // A URL carries a SPELLING, not an id. lib/entryFilter matches folded, so a
    // link reading `vendor=acme` must tick the chip labelled 'Acme' — a control
    // showing nothing selected under an active filter is the "1 filter over a
    // list nobody can explain" failure.
    for (const spelling of ['Acme', 'acme', 'ACME ']) {
      const slice = facet(
        render({ ...EMPTY_FILTER, vendors: [spelling] }),
        t('filter.vendor'),
        t('filter.status'),
      )
      expect(slice.match(/aria-checked="true"/g) ?? [], spelling).toHaveLength(1)
      expect(slice.indexOf('aria-checked="true"'), spelling).toBeGreaterThan(
        slice.indexOf(t('filter.anyVendor')),
      )
      // …and the orphan branch did not fire: still three options.
      expect(slice.match(/role="radio"/g) ?? [], spelling).toHaveLength(3)
    }
  })

  it('keeps an integrator nobody records any more visible, so it can be switched off', () => {
    // The owner facet's orphan-option precedent: a vendor whose last
    // organization was archived still filters the list, and a facet that
    // dropped it would leave an active filter with no control showing it.
    const slice = facet(
      render({ ...EMPTY_FILTER, vendors: ['Gone Integrations'] }),
      t('filter.vendor'),
      t('filter.status'),
    )
    expect(slice).toContain('Gone Integrations')
    expect(slice.match(/role="radio"/g) ?? []).toHaveLength(4)
    expect(slice.match(/aria-checked="true"/g) ?? []).toHaveLength(1)
  })

  it('counts as an active facet in the rail badge', () => {
    const html = render({ ...EMPTY_FILTER, vendors: ['Acme'] })
    expect(html).toContain(t('filter.activeCount', { count: 1 }))
    expect(html).toContain(t('filter.clearAll'))
  })

  it('does not offer a vendor that survives only on an archived organization', () => {
    // Not a choice the workspace still has. The FILTER is unaffected — the
    // context map is built over every node — but a chip that selects nothing
    // anybody can see is a control that looks broken.
    fx.state.nodes = [fx.node, { ...fx.org1, archived: true }]
    try {
      expect(render()).not.toContain(t('filter.vendor'))
    } finally {
      fx.state.nodes = [fx.node, fx.org1, fx.org2, fx.org3]
    }
  })

  it('disappears entirely when no organization records an integrator', () => {
    // Before 0023, and in a workspace whose admin has not filled the column in.
    // A heading over a lone "Any vendor" chip is a control that looks broken;
    // nothing at all is the honest rendering of a dimension with no values.
    fx.state.nodes = [fx.node]
    try {
      const html = render()
      expect(html).not.toContain(t('filter.vendor'))
      expect(html).not.toContain(t('filter.anyVendor'))
      // …and the rest of the bar is untouched.
      expect(html).toContain(t('filter.track'))
      expect(html).toContain(t('filter.group'))
    } finally {
      fx.state.nodes = [fx.node, fx.org1, fx.org2, fx.org3]
    }
  })
})

describe('the Branch readout — what a pasted link brought with it', () => {
  it('is absent until something is selected, because the map is the picker', () => {
    // Forty organizations as a flat chip row inside a disclosure panel would be
    // a worse version of the surface behind it.
    expect(render()).not.toContain(t('filter.branch'))
    expect(render()).not.toContain(t('filter.branchHint'))
  })

  it('names every selected branch, and each one can be pressed off', () => {
    const html = render({ ...EMPTY_FILTER, mapNodeIds: ['ob', 'org1'] })
    const slice = facet(html, t('filter.branch'), t('filter.vendor'))
    expect(slice).toContain('Onboarding')
    expect(slice).toContain('King Fahad Hospital')
    // Toggles, not a radiogroup: a link may carry several branches, and a
    // single-select control would show one of them and keep filtering on the
    // rest invisibly.
    expect(slice.match(/aria-pressed="true"/g) ?? []).toHaveLength(2)
    expect(slice).not.toContain('role="radio"')
  })

  it('says descendants are included, because that is what surprises people', () => {
    expect(render({ ...EMPTY_FILTER, mapNodeIds: ['ob'] })).toContain(t('filter.branchHint'))
  })

  it('reads a branch in the reading language, falling back when untranslated', () => {
    setLocale('ar')
    try {
      const html = render({ ...EMPTY_FILTER, mapNodeIds: ['ob', 'org2'] })
      expect(html).toContain('التسجيل')
      // `name_ar` is `not null default ''`, so the fallback tests for EMPTY and
      // not for null — org2 has no Arabic name and shows its English one rather
      // than an empty chip.
      expect(html).toContain('Riyadh Clinic')
    } finally {
      setLocale('en')
    }
  })

  it('falls back to a sentence for a branch the workspace has never heard of', () => {
    // A link to something somebody deleted. A raw uuid tells the reader nothing
    // and cannot be read aloud; the filter still has to be visible and
    // removable.
    const slice = facet(
      render({ ...EMPTY_FILTER, mapNodeIds: ['ghost'] }),
      t('filter.branch'),
      t('filter.vendor'),
    )
    expect(slice).toContain(t('filter.branchGone'))
    expect(slice).not.toContain('ghost')
    expect(slice.match(/aria-pressed="true"/g) ?? []).toHaveLength(1)
  })

  it('counts as an active facet, separately from vendor', () => {
    // Two decisions, two counters, and Clear all removes both — the group/track
    // pair one level up.
    const html = render({ ...EMPTY_FILTER, mapNodeIds: ['ob'], vendors: ['Acme'] })
    expect(html).toContain(t('filter.activeCount', { count: 2 }))
  })
})
