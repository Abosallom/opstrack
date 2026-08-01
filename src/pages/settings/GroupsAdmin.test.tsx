// Render proof for /settings/groups — the admin gate, the shell the screen
// first paints, and the strings its interactive surfaces are made of.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real hooks,
// the real class names and the real translator.
//
// ── WHAT THAT REACHES, AND WHAT IT DOES NOT ────────────────────────────────
//
// A server render runs no effects and dispatches no events, so this file sees
// the screen EXACTLY as it first appears: the gate, the standfirst, the live
// region and the loading skeleton that stands in for a list the effect has not
// fetched yet. The group cards, the rename panel and the per-track <select> are
// all behind state that only a fetch or a click produces, and they are therefore
// OUT OF REACH here and claimed about nowhere below. Their interactive proof is
// a browser pass — that is what a browser pass is for, and this file says so
// rather than pretending otherwise.
//
// What IS reachable, and is where the value of this file sits:
//
//  1. THE GATE, both ways. A member must not render an editable group list, and
//     this screen's `useIsAdmin` is the SIXTH copy of a hook five other admin
//     screens carry — a copy is exactly the thing that drifts.
//  2. NO READ DURING RENDER. The api is mocked with recording stubs and the
//     assertion is that a render calls none of them.
//  3. THE STRINGS THE UNREACHABLE SURFACES WILL RENDER, in both languages, with
//     their interpolation tokens checked. This is the failure localeParity
//     cannot see, because it compares en against ar rather than either against
//     its caller: a screen and a locale file disagreeing about a placeholder
//     renders the brace text at the user. Here that would be a screen reader
//     announcing a group picker as "Group for {name}".
//  4. THE COLOUR PALETTE IS PAIRS. Every swatch the screen offers must carry a
//     light-theme hex as well as a dark one — a single hex on #e9edf1 is the
//     defect 0002's seed repair had to go back and fix on five track rows, and
//     the palette is the one place a new one could be introduced.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, store/config adds a window
  // focus listener at module scope, and `useIsAdmin` reads
  // window.location.search at RENDER time for the `?shell` preview flag — all
  // at import or render time, so the shims cannot wait for a beforeAll().
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

  const state = { role: 'admin' as 'admin' | 'member', calls: [] as string[] }
  return { state }
})

vi.mock('../../api/supabase', () => ({ isConfigured: () => true, supabase: null }))

vi.mock('../../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
}))

vi.mock('../../store/config', () => ({ invalidateConfig: () => {} }))

// Recording stubs, so a render that reached the network would be visible as a
// call rather than as a silent request in a test run.
vi.mock('../../api/tracks', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      fx.state.calls.push(`${name}(${args.join(',')})`)
      return Promise.resolve({ ok: false as const, error: 'common.error' })
    }
  return {
    listGroups: record('listGroups'),
    listTracks: record('listTracks'),
    updateGroup: record('updateGroup'),
    reorderGroups: record('reorderGroups'),
    setTrackGroup: record('setTrackGroup'),
  }
})

const { setLocale, t } = await import('../../lib/i18n')
const GroupsAdmin = (await import('./GroupsAdmin')).default

/**
 * The screen's own source, as text.
 *
 * `?raw` rather than exporting SWATCHES: nothing outside this file picks a group
 * colour, so the constant stays private, and the property worth pinning is a
 * property of the LIST — "every entry is a pair" — which an exported array would
 * let a reader satisfy one entry at a time. localeReach.test.ts reads source the
 * same way and for the same reason.
 */
const SOURCE: string = (await import('./GroupsAdmin.tsx?raw')).default

/** A locale string as it appears in the MARKUP — react-dom escapes five chars. */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const render = (role: 'admin' | 'member' = 'admin'): string => {
  fx.state.role = role
  fx.state.calls = []
  return renderToStaticMarkup(
    <MemoryRouter>
      <GroupsAdmin />
    </MemoryRouter>,
  )
}

/* ─────────────────────────────── the gate ──────────────────────────────── */

describe('the admin gate', () => {
  it('renders nothing editable for a member', () => {
    const html = render('member')
    // The route is gated too (App.tsx bounces a member back to /settings); this
    // is the screen's own second copy, and the one that survives a deep link
    // arriving before the profile has loaded.
    expect(html).not.toContain('class="grp"')
    expect(html).not.toContain('grp-list')
    expect(html).not.toContain(asHtml(t('groups.subtitle')))
  })

  it('renders the screen for an admin', () => {
    const html = render('admin')
    expect(html).toContain('class="grp"')
    expect(html).toContain(asHtml(t('groups.subtitle')))
  })
})

/* ───────────────────────── the shell it first paints ───────────────────── */

describe('the first paint', () => {
  it('offers a way back, which is the only chrome linking these screens', () => {
    // /settings/groups is in neither nav — App.tsx's header names it and this
    // link is how a thumb gets out.
    const html = render()
    expect(html).toContain('href="/settings"')
    expect(html).toContain(asHtml(t('common.back')))
  })

  it('carries no heading of its own', () => {
    // App.tsx's header already renders groups.title as the document h1 for this
    // route; a second copy is noise in the heading outline.
    expect(render()).not.toContain('<h1')
  })

  it('shows a skeleton, not an empty state, before the read has answered', () => {
    // The difference matters: "no groups yet" is a claim about the workspace,
    // and making it while the request is still in flight tells an admin their
    // migration did not run.
    const html = render()
    expect(html).toContain('skeleton')
    expect(html).not.toContain(asHtml(t('groups.empty')))
    expect(html).not.toContain(asHtml(t('groups.ungrouped')))
  })

  it('ships the live region before there is anything to announce', () => {
    // An aria-live region has to be in the accessibility tree BEFORE its content
    // changes; one that appears together with its first message is not announced
    // at all. Polite, because every message here follows a deliberate action.
    const html = render()
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="status"')
  })

  it('reads nothing during render — the fetch belongs to an effect', () => {
    render()
    expect(fx.state.calls).toEqual([])
  })
})

/* ───────────────── strings the unreachable surfaces will use ────────────── */

describe('every string this screen renders resolves in both languages', () => {
  // Grouped by the surface each one belongs to, so a failure names the control
  // that would have rendered a dot path.
  const KEYS = [
    // page
    'groups.title',
    'groups.subtitle',
    'groups.loadFailed',
    'groups.empty',
    'groups.emptyHint',
    // reorder
    'groups.moveUp',
    'groups.moveDown',
    'groups.movedTo',
    'groups.reordered',
    // rename / recolour
    'groups.rename',
    'groups.renameDone',
    'groups.nameEn',
    'groups.nameAr',
    'groups.nameArHint',
    'groups.color',
    'groups.nameRequired',
    'groups.save',
    'groups.discard',
    'groups.saved',
    'groups.unsaved',
    // the track list
    'groups.trackCount',
    'groups.tracksIn',
    'groups.trackGroupLabel',
    'groups.none',
    'groups.moved',
    'groups.archived',
    'groups.emptyGroup',
    'groups.ungrouped',
    'groups.ungroupedHint',
    // the six swatches
    'groups.colorIndigo',
    'groups.colorSlate',
    'groups.colorViolet',
    'groups.colorBlue',
    'groups.colorTeal',
    'groups.colorRose',
  ]

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: no key falls through to its own dot path`, () => {
      setLocale(locale)
      const unresolved = KEYS.filter((k) => t(k, { count: 2, name: 'x', target: 'y' }) === k)
      expect(unresolved).toEqual([])
      setLocale('en')
    })
  }

  it('the interpolating sentences carry exactly the tokens the screen passes', () => {
    // The failure localeParity cannot see: it compares en to ar, never either to
    // its caller. A `{name}` renamed in the locale file renders as literal
    // braces in an aria-label nobody proofreads.
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      expect(t('groups.moveUp', { name: 'Technical' })).toContain('Technical')
      expect(t('groups.trackGroupLabel', { name: 'Infrastructure' })).toContain('Infrastructure')
      expect(t('groups.saved', { name: 'Business' })).toContain('Business')
      const moved = t('groups.moved', { name: 'Roadmap', target: 'Business' })
      expect(moved).toContain('Roadmap')
      expect(moved).toContain('Business')
      const at = t('groups.movedTo', { name: 'Technical', position: 1, total: 2 })
      expect(at).toContain('1')
      expect(at).toContain('2')
      expect(at).not.toContain('{')
    }
    setLocale('en')
  })

  it('counts a group’s tracks through a plural node, not a bare number', () => {
    setLocale('en')
    expect(t('groups.trackCount', { count: 1 })).toBe('1 track')
    expect(t('groups.trackCount', { count: 6 })).toBe('6 tracks')
    setLocale('ar')
    // Arabic selects `zero` for 0 and `two` for 2 — a node missing either falls
    // back to the 11–99 form, which is grammatically wrong and silently so.
    expect(t('groups.trackCount', { count: 0 })).not.toContain('0')
    expect(t('groups.trackCount', { count: 2 })).not.toContain('2')
    expect(t('groups.trackCount', { count: 6 })).toContain('6')
    setLocale('en')
  })
})

/* ───────────────────────────── the palette ─────────────────────────────── */

describe('the group colour palette', () => {
  it('offers every swatch as a PAIR of hexes, never a single one', () => {
    const swatches = SOURCE.slice(
      SOURCE.indexOf('const SWATCHES'),
      SOURCE.indexOf('const NAME_MAX'),
    ).match(/\{ dark: '#[0-9a-f]{6}', light: '#[0-9a-f]{6}', labelKey: '[^']+' \}/g)
    // Six quiet pairs — a group is a container drawn AROUND tracks, so a
    // saturated group colour competes with the track colours inside it.
    expect(swatches).toHaveLength(6)
  })

  it('names every swatch from a key, never from its hex', () => {
    // A hex is the control's only accessible name if the label is missing, and
    // "#7586d5" is read out one character at a time.
    const labels = SOURCE.match(/labelKey: 'groups\.color[A-Z][a-z]+'/g)
    expect(labels).toHaveLength(6)
  })
})
