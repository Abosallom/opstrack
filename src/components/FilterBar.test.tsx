// The Group facet — the one part of FilterBar that no screen test can prove.
//
// Board, FollowUps, TracksIndex and Dashboard all render this component, and all
// four mock `useGroups()` as empty because their subject is their own surface.
// That covers exactly one of the two branches here, and it is the boring one.
// This file covers the other: what the facet renders when the workspace HAS
// groups, which is the state every user is in the moment 0018 is applied.
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
  const state = { groups: [tech, biz] }
  return { state, tech, biz }
})

vi.mock('../store/config', () => ({
  useGroups: () => fx.state.groups,
  useActiveTracks: () => [],
  useTrackMap: () => new Map(),
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
