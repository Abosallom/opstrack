// The palette: what it can reach, what it shows, and what pressing a row does.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget; Board.test.tsx,
// NotificationBell.test.tsx and OutboxSheet.test.tsx all open with the same
// paragraph. That constraint is exactly why CommandPalette.tsx exports its four
// candidate builders, its ranker, its focus-restore predicate and a props-only
// `PaletteDialog` — every one of those is reachable from here, and the stateful
// shell around them is a thin thing that wires stores to arguments.
//
// ── THE ASSERTION THAT EARNS THIS FILE IS THE FIRST BLOCK ──────────────────
//
// `SCREENS` is the palette's own route table, written by hand because App.tsx's
// NAV is integrator-owned and capped at five tab-bar slots. That independence is
// the feature AND the failure mode: a wave that adds a route and forgets this
// table ships a screen the headline navigation feature cannot reach, and nothing
// anywhere goes red. Wave 4b did it — `/settings/export` and
// `/settings/notifications` were in neither table, so two of the three screens
// that wave shipped were unreachable from the palette that wave also shipped.
//
// So the first block does not assert a list of paths somebody typed twice. It
// PARSES App.tsx's route table and derives the expectation from it, in both
// directions and including the admin split. Adding a route now fails this test
// until the registry catches up, which is the only mechanism that could have
// caught the original gap on the worker's own machine.
//
// App.tsx is read through import.meta.glob('?raw') rather than node:fs, for
// lib/localeReach.test.ts's reason: tsconfig.app.json pins `types:
// ["vite/client"]`, and widening it to include "node" would leak node globals
// into the type space of every app file.
//
// ── WHAT THIS FILE CANNOT SEE, and therefore claims nothing about ──────────
//
//   · The OPEN palette as the component drives it. `open` starts false and only
//     a keystroke flips it, so react-dom/server renders the closed shell — which
//     is asserted, because "renders null until something opens it" is a claim
//     the component's header makes. The open dialog is asserted one level down,
//     through PaletteDialog with a model built here.
//   · Anything behind an effect: installHotkeys(), the loadEntries() warm-up,
//     the scrollIntoView on the highlight, and the focus moves. The DECISION
//     inside the trickiest of those is shouldRestoreFocus(), which is pure and
//     is asserted below; the focus() call it guards is not.
//   · The Tab trap, which reads querySelectorAll on a live dialog.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { Entry, Track } from '../types'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and Sheet reads matchMedia
  // through useSyncExternalStore's server snapshot — so the shims cannot wait
  // for a beforeAll().
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

  /** What the mocked stores answer with, and what the mocked doers recorded. */
  const state = {
    entries: [] as Entry[],
    tracks: [] as Track[],
    role: 'member' as 'admin' | 'member',
    opened: [] as { id: string; list: string[] | undefined }[],
  }
  return { state }
})

// The stores are mocked for Capture.test.tsx's reason: they touch localStorage,
// `window` and the Supabase client at module init. store/entrySheet is mocked
// for a second reason — openEntry() is the one doer CommandPalette.tsx imports
// rather than takes as an argument, so this is the seam that proves an entry row
// hands over the palette's OWN sibling list.
vi.mock('../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
}))
vi.mock('../store/config', () => ({
  useActiveTracks: () => fx.state.tracks,
  useTrackMap: () => new Map(fx.state.tracks.map((tr) => [tr.id, tr])),
}))
vi.mock('../store/entries', () => ({
  useEntryList: () => fx.state.entries,
  loadEntries: () => Promise.resolve(),
  refreshEntries: () => Promise.resolve(),
  setStatus: () => Promise.resolve(),
}))
vi.mock('../store/entrySheet', () => ({
  getOpenEntryId: () => null,
  openEntry: (id: string, opts?: { list?: string[] }) => {
    fx.state.opened.push({ id, list: opts?.list })
  },
  stepEntry: () => {},
}))
vi.mock('../store/settings', () => ({
  useSettings: () => ({ theme: 'auto', locale: 'en' }),
  setTheme: () => {},
  setLocaleSetting: () => {},
}))
vi.mock('../store/vocab', () => ({
  useVocabLabel: () => (_kind: string, key: string) => key,
}))

const { getLocale, setLocale, t } = await import('../lib/i18n')
const { trackLabel } = await import('../lib/labels')
const {
  ADMIN_SCREENS,
  LENSES,
  PaletteDialog,
  SCREENS,
  actionCandidates,
  default: CommandPalette,
  entryCandidates,
  nextThemeAfter,
  rankPalette,
  screenCandidates,
  shouldRestoreFocus,
  trackCandidates,
} = await import('./CommandPalette')

/* ─────────────────────────────── fixtures ──────────────────────────────── */

const track = (over: Partial<Track> & Pick<Track, 'id' | 'name' | 'name_ar'>): Track => ({
  description: '',
  description_ar: '',
  color: '#000000',
  color_light: null,
  icon: 'network',
  suggested_tags: [],
  sort_order: 0,
  archived: false,
  archived_at: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

const entry = (over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry => ({
  track_id: null,
  description: '',
  type: 'action',
  status: 'new',
  priority: 'medium',
  owner_id: null,
  owner_name: null,
  requester: null,
  due_date: null,
  follow_up_date: null,
  tags: [],
  links: [],
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  closed_at: null,
  last_activity_at: '2026-01-01T00:00:00Z',
  meeting_id: null,
  template_id: null,
  ...over,
})

const NETWORK = track({ id: 't-net', name: 'Network ops', name_ar: 'الشبكات' })

/** The label function the component builds from lib/labels — the real one. */
const label = (tr: Track): string => trackLabel(tr, getLocale())
/** The palette only ever asks for a status label; echo the key. */
const vocab = (_kind: 'status', key: string): string => key

const noRefs = {
  dialogRef: { current: null },
  inputRef: { current: null },
  optionRef: () => {},
}

/** A locale string as it appears in the MARKUP — react-dom escapes five chars. */
const asHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

/* ══════════════════════ 1. the registry reaches every screen ═════════════ */

// Eager + ?raw: App.tsx as text. It is the integrator's file and exports no
// route table, so parsing the source is the only way to derive the expectation
// from the thing that is actually true at runtime.
const SOURCES: Record<string, string> = import.meta.glob('../App.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const APP_SOURCE = SOURCES['../App.tsx'] ?? ''

interface ParsedRoute {
  path: string
  /** The components its `element` renders, `Navigate` excluded. */
  components: string[]
  /** Does the element sit behind App.tsx's `isAdmin` ternary? */
  adminGated: boolean
}

/**
 * App.tsx's SIGNED-IN route table.
 *
 * There are two `<Routes>` blocks — signed-out (sign-in, claim) and signed-in —
 * and only the second is the palette's business: CommandPalette is mounted
 * inside the signed-in branch and every one of its shortcuts is meaningless on
 * the sign-in screen. The block is picked by a route only it contains rather
 * than by position, so reordering the file does not silently select the wrong
 * one.
 *
 * JSX comments are stripped BEFORE the split. The route table is heavily
 * commented, a comment sits between two `<Route`s, and a sentence containing the
 * word `isAdmin` would otherwise attach itself to the preceding route and mark a
 * screen admin-gated that is not.
 */
function parseSignedInRoutes(source: string): ParsedRoute[] {
  const blocks = source.split('<Routes>').slice(1)
  // Picked by a route only the signed-in block contains. It was '"/capture"'
  // until the collapse deleted that route; '"/mindtree"' is the same kind of
  // marker and is now the one route the whole application is built around.
  const block = blocks
    .map((b) => b.split('</Routes>')[0] ?? '')
    .find((b) => b.includes('"/mindtree"'))
  if (block === undefined) return []
  const clean = block.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const out: ParsedRoute[] = []
  for (const segment of clean.split('<Route').slice(1)) {
    const path = /path="([^"]+)"/.exec(segment)?.[1]
    if (path === undefined) continue
    const components = [...segment.matchAll(/<([A-Z][A-Za-z0-9]*)/g)]
      .map((m) => m[1] ?? '')
      // `ModeFrame` joins `Navigate` on the exclusion list, and for the same
      // reason: it is CHROME the route wraps a page in — the trail back to the
      // map — not a screen of its own. Left in, it would be seen on
      // '/meetings/:id' too and would therefore mark '/meetings' and '/digest'
      // as detail surfaces, quietly excusing both from every assertion below.
      .filter((name) => name !== 'Navigate' && name !== 'ModeFrame')
    out.push({ path, components, adminGated: segment.includes('isAdmin') })
  }
  return out
}

const ROUTES = parseSignedInRoutes(APP_SOURCE)

/**
 * The routes that render a screen, as opposed to a redirect or a detail surface.
 *
 * A DETAIL SURFACE IS RECOGNISED BY ITS COMPONENT, not by a colon in its own
 * path. `/settings/tracks/new` carries no route parameter, and it is still the
 * track EDITOR — the same component `/settings/tracks/:id` renders — so a rule
 * that only dropped `:id` paths would demand a palette row for "create a track",
 * which is a form reached from the list rather than a place. Grouping by
 * component gets both cases from one fact.
 */
function screenRoutes(routes: readonly ParsedRoute[]): ParsedRoute[] {
  const rendering = routes.filter((r) => r.components.length > 0)
  const detail = new Set(
    rendering.filter((r) => r.path.includes(':')).flatMap((r) => r.components),
  )
  return rendering.filter((r) => !r.components.some((c) => detail.has(c)))
}

describe('the palette registry against App.tsx', () => {
  it('parsed a route table worth asserting against', () => {
    // Guards every assertion below from going vacuous if the parse breaks or
    // App.tsx is restructured: a regex that suddenly matches nothing would make
    // "every route is reachable" trivially true.
    expect(APP_SOURCE).toContain('<Routes>')
    expect(ROUTES.length).toBeGreaterThan(15)
    expect(ROUTES.map((r) => r.path)).toContain('/settings/export')
    expect(ROUTES.some((r) => r.components.includes('Navigate'))).toBe(false)
  })

  it('offers every screen-rendering route, which is the bug that shipped', () => {
    const registry = new Set([...SCREENS, ...ADMIN_SCREENS].map((s) => s.to))
    const unreachable = screenRoutes(ROUTES)
      .map((r) => r.path)
      .filter((path) => !registry.has(path))
    // The exact failure Wave 4b shipped: this list held /settings/export and
    // /settings/notifications, and nothing in the repo said so.
    expect(unreachable).toEqual([])
  })

  it('offers nothing App.tsx does not route, so no row can dead-end', () => {
    const routed = new Set(ROUTES.map((r) => r.path))
    const dangling = [...SCREENS, ...ADMIN_SCREENS].map((s) => s.to).filter((to) => !routed.has(to))
    expect(dangling).toEqual([])
  })

  it('puts a screen in the admin table if and only if App.tsx gates it', () => {
    const adminRegistry = new Set(ADMIN_SCREENS.map((s) => s.to))
    const wrong = screenRoutes(ROUTES).filter((r) => r.adminGated !== adminRegistry.has(r.path))
    // Both directions matter. A gated screen in SCREENS offers a member a row
    // that bounces them back to /settings; an ungated screen in ADMIN_SCREENS
    // withholds their own screen from them — which is what would have happened
    // had export and push preferences been "fixed" into the admin table.
    expect(wrong.map((r) => r.path)).toEqual([])
    expect(adminRegistry.size).toBeGreaterThan(0)
  })

  it('names every screen with a key that resolves in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const screen of [...SCREENS, ...LENSES, ...ADMIN_SCREENS]) {
        // t() echoes an unknown key, so a label equal to its own key is a
        // missing string rendering a dot path at the user.
        expect(t(screen.labelKey)).not.toBe(screen.labelKey)
        expect(t(screen.labelKey).trim()).not.toBe('')
      }
    }
    setLocale('en')
  })

  it('gives the inbox lens and push preferences distinct labels', () => {
    // `/notifications` was the inbox history and `/settings/notifications` is
    // per-device push preferences; the two rows read one word apart. The inbox
    // is a LENS now (`/mindtree?lens=what-changed`), which does not make the
    // ambiguity go away — both rows are still in one list — so the check moves
    // with it rather than being deleted. lib/routeTitle.ts carries the same
    // warning.
    const inbox = LENSES.find((s) => s.to === '/mindtree?lens=what-changed')
    const push = SCREENS.find((s) => s.to === '/settings/notifications')
    expect(inbox).toBeDefined()
    expect(push).toBeDefined()
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      expect(t(inbox?.labelKey ?? '')).not.toBe(t(push?.labelKey ?? ''))
    }
    setLocale('en')
  })

  it('offers a row for every lens, each landing on the one routed map path', () => {
    // The five lenses replaced six palette rows (capture, follow-ups, board,
    // tracks, dashboard, notifications). They are QUERIES on `/mindtree`, so the
    // "nothing App.tsx does not route" case above cannot see them — this is the
    // half that keeps them honest.
    expect(LENSES).toHaveLength(5)
    const routed = new Set(ROUTES.map((r) => r.path))
    for (const lens of LENSES) {
      expect(lens.to.startsWith('/mindtree?lens=')).toBe(true)
      expect(routed.has(lens.to.split('?')[0] ?? '')).toBe(true)
    }
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const lens of LENSES) expect(t(lens.labelKey)).not.toBe(lens.labelKey)
    }
    setLocale('en')
  })
})

/* ══════════════════════════ 2. the candidate rows ════════════════════════ */

describe('screenCandidates', () => {
  it('withholds the admin screens from a member', () => {
    const rows = screenCandidates('member', () => {})
    expect(rows).toHaveLength(SCREENS.length + LENSES.length)
    expect(rows.map((r) => r.item.id)).not.toContain('screen:/settings/members')
  })

  it('appends them for an admin, leaving the shared order alone', () => {
    const member = screenCandidates('member', () => {}).map((r) => r.item.id)
    const admin = screenCandidates('admin', () => {}).map((r) => r.item.id)
    expect(admin).toHaveLength(SCREENS.length + LENSES.length + ADMIN_SCREENS.length)
    // Same rows in the same places: a list that reorders itself by role is a
    // list nobody builds muscle memory on.
    expect(admin.slice(0, member.length)).toEqual(member)
    expect(admin).toContain('screen:/settings/members')
  })

  it('navigates to the route the row names — including the two that were missing', () => {
    const seen: string[] = []
    const rows = screenCandidates('admin', (to) => seen.push(to))
    for (const to of ['/settings/export', '/settings/notifications', '/settings/members']) {
      const row = rows.find((r) => r.item.id === `screen:${to}`)
      expect(row).toBeDefined()
      row?.item.run([])
    }
    expect(seen).toEqual(['/settings/export', '/settings/notifications', '/settings/members'])
  })
})

describe('trackCandidates', () => {
  it('opens the track timeline, not a filtered list', () => {
    const seen: string[] = []
    const rows = trackCandidates([NETWORK], label, (to) => seen.push(to))
    rows[0]?.item.run([])
    expect(seen).toEqual(['/tracks/t-net'])
  })

  it('indexes both names whichever language the UI is in', () => {
    setLocale('en')
    const fields = trackCandidates([NETWORK], label, () => {})[0]?.fields.join(' ') ?? ''
    // The English UI still has to find a track whose only memorable name is
    // Arabic — lib/text.ts's reason for not locale-switching its folds.
    expect(fields).toContain('network ops')
    expect(fields).toContain('الشبكات')
  })
})

describe('entryCandidates', () => {
  it('shows the track and the status as the second line', () => {
    const rows = entryCandidates(
      [entry({ id: 'e1', title: 'Firewall rule DC2', track_id: 't-net', status: 'blocked' })],
      new Map([[NETWORK.id, NETWORK]]),
      label,
      vocab,
    )
    expect(rows[0]?.item.label).toBe('Firewall rule DC2')
    expect(rows[0]?.item.hint).toBe('Network ops · blocked')
  })

  it('leaves the hint clean when an entry is filed against no track', () => {
    const rows = entryCandidates([entry({ id: 'e1', title: 'Untracked' })], new Map(), label, vocab)
    // No leading separator: the join filters the empty half rather than printing
    // " · new".
    expect(rows[0]?.item.hint).toBe('new')
  })

  it('ranks a title match above a tag match, by field order', () => {
    const rows = entryCandidates(
      [entry({ id: 'e1', title: 'Renew TLS cert', tags: ['firewall'] })],
      new Map(),
      label,
      vocab,
    )
    // fields[0] is the title and fields[1] the tags — the index IS the weight in
    // lib/hotkeys' matchScore().
    expect(rows[0]?.fields[0]).toContain('renew tls cert')
    expect(rows[0]?.fields[1]).toContain('firewall')
  })

  it("hands openEntry the palette's own list, so J/K afterwards walks it", () => {
    fx.state.opened = []
    const rows = entryCandidates([entry({ id: 'e1', title: 'One' })], new Map(), label, vocab)
    rows[0]?.item.run(['e1', 'e2', 'e3'])
    // The sibling walk store/entrySheet.ts takes from its caller precisely so
    // each surface can pass its own order. A row that passed nothing would leave
    // J and K dead on the sheet it just opened.
    expect(fx.state.opened).toEqual([{ id: 'e1', list: ['e1', 'e2', 'e3'] }])
  })
})

describe('actionCandidates', () => {
  it('runs each of the four, and only the one that was activated', () => {
    const seen: string[] = []
    const rows = actionCandidates({
      cycleTheme: () => seen.push('theme'),
      switchLanguage: () => seen.push('language'),
      showKeys: () => seen.push('keys'),
      refresh: () => seen.push('refresh'),
    })
    expect(rows.map((r) => r.item.id)).toEqual([
      'action:theme',
      'action:language',
      'action:keys',
      'action:refresh',
    ])
    for (const row of rows) row.item.run([])
    expect(seen).toEqual(['theme', 'language', 'keys', 'refresh'])
  })

  it('labels all four in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const row of actionCandidates({
        cycleTheme: () => {},
        switchLanguage: () => {},
        showKeys: () => {},
        refresh: () => {},
      })) {
        expect(row.item.label).not.toContain('cmd.')
      }
    }
    setLocale('en')
  })
})

describe('nextThemeAfter', () => {
  it('cycles the way App.tsx header button does, and wraps', () => {
    expect(nextThemeAfter('auto')).toBe('dark')
    expect(nextThemeAfter('dark')).toBe('light')
    expect(nextThemeAfter('light')).toBe('auto')
  })
})

/* ═════════════════════════════ 3. the ranking ════════════════════════════ */

const sources = (over: Partial<Parameters<typeof rankPalette>[1]> = {}) => ({
  entries: [],
  tracks: [],
  screens: [],
  actions: [],
  ...over,
})

describe('rankPalette', () => {
  it('keeps the four groups in their fixed order, entries first', () => {
    const model = rankPalette(
      '',
      sources({
        entries: entryCandidates([entry({ id: 'e1', title: 'One' })], new Map(), label, vocab),
        tracks: trackCandidates([NETWORK], label, () => {}),
        screens: screenCandidates('member', () => {}),
        actions: actionCandidates({
          cycleTheme: () => {},
          switchLanguage: () => {},
          showKeys: () => {},
          refresh: () => {},
        }),
      }),
      0,
    )
    expect(model.groups.map((g) => g.id)).toEqual(['entries', 'tracks', 'screens', 'actions'])
  })

  it('drops a group that matched nothing rather than showing an empty heading', () => {
    // 'privacy' matches exactly one row and nothing else in any group. It was
    // 'capture' until that screen became the composer mounted on the map.
    const model = rankPalette('privacy', sources({ screens: screenCandidates('member', () => {}) }), 0)
    expect(model.groups.map((g) => g.id)).toEqual(['screens'])
    expect(model.count).toBe(1)
  })

  it('numbers the flat index across group boundaries, which is what the arrows walk', () => {
    const model = rankPalette(
      '',
      sources({
        tracks: trackCandidates([NETWORK], label, () => {}),
        screens: screenCandidates('member', () => {}),
      }),
      0,
    )
    const indices = model.groups.flatMap((g) => g.rows.map((r) => r.index))
    expect(indices).toEqual([...Array(model.count).keys()])
    expect(model.flat).toHaveLength(model.count)
  })

  it('offers every screen on a blank query — the cap must not bite a fixed set', () => {
    // The browser-pass finding recorded on GROUP_CAP: at 8 the blank-query list
    // stopped at Notifications and neither Settings nor Recurring was ever
    // offered. With two more screens added this wave, a re-introduced cap would
    // silently hide the ones at the end again.
    const model = rankPalette('', sources({ screens: screenCandidates('admin', () => {}) }), 0)
    expect(model.count).toBe(SCREENS.length + ADMIN_SCREENS.length)
  })

  it('collects the entry ids in display order and nothing else', () => {
    const model = rankPalette(
      '',
      sources({
        entries: entryCandidates(
          [entry({ id: 'e1', title: 'One' }), entry({ id: 'e2', title: 'Two' })],
          new Map(),
          label,
          vocab,
        ),
        screens: screenCandidates('member', () => {}),
      }),
      0,
    )
    // Screens and actions have no entryId, so they must not appear in the walk.
    expect(model.entryIds).toEqual(['e1', 'e2'])
  })

  it('clamps a highlight that a shrinking list left past the end', () => {
    const screens = screenCandidates('member', () => {})
    expect(rankPalette('', sources({ screens }), 99).at).toBe(SCREENS.length + LENSES.length - 1)
    expect(rankPalette('zzzzz', sources({ screens }), 99).at).toBe(-1)
    expect(rankPalette('zzzzz', sources({ screens }), 99).count).toBe(0)
  })

  it('finds a screen by a word inside its name, not only by its first letters', () => {
    const screens = screenCandidates('admin', () => {})
    const ids = rankPalette('export', sources({ screens }), 0).flat.map((r) => r.id)
    expect(ids).toContain('screen:/settings/export')
  })
})

/* ═══════════════════════════ 4. the dialog markup ════════════════════════ */

const dialog = (query: string, model: ReturnType<typeof rankPalette>): string =>
  renderToStaticMarkup(
    <PaletteDialog
      listId="cmd"
      query={query}
      model={model}
      onQuery={() => {}}
      onClose={() => {}}
      onActivate={() => {}}
      onHover={() => {}}
      onKeyDown={() => {}}
      {...noRefs}
    />,
  )

describe('PaletteDialog', () => {
  const model = (query = '', active = 0) =>
    rankPalette(query, sources({ screens: screenCandidates('member', () => {}) }), active)

  it('is a modal dialog with a name of its own', () => {
    const html = dialog('', model())
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain(`aria-label="${asHtml(t('cmd.title'))}"`)
    // The scrim is a pointer affordance; Escape is the keyboard equivalent and
    // lib/overlayStack owns it.
    expect(html).toContain('class="cmd-scrim"')
  })

  it('wires the combobox to the listbox and to the highlighted option', () => {
    const html = dialog('', model('', 0))
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-controls="cmd"')
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).toContain('aria-activedescendant="cmd-opt-0"')
    expect(html).toContain('id="cmd"')
    expect(html).toContain('role="listbox"')
    // The id aria-activedescendant names must EXIST on an option — four ids
    // agreeing is the whole accessible experience and none of it is on screen.
    expect(html).toContain('id="cmd-opt-0"')
    expect(html).toContain('aria-selected="true"')
  })

  it('moves aria-activedescendant with the highlight', () => {
    const html = dialog('', model('', 2))
    expect(html).toContain('aria-activedescendant="cmd-opt-2"')
    expect(html).not.toContain('aria-activedescendant="cmd-opt-0"')
  })

  it('is a search field only in behaviour — never type="search"', () => {
    // lib/hotkeys' focusSearchField() finds a screen's filter box by that exact
    // type, and a palette input wearing it would let "/" focus a field inside a
    // dialog that is not open.
    expect(dialog('', model())).toContain('type="text"')
    expect(dialog('', model())).not.toContain('type="search"')
  })

  it('heads each group and points the group at its own heading', () => {
    const html = dialog('', model())
    expect(html).toContain('id="cmd-screens"')
    expect(html).toContain('aria-labelledby="cmd-screens"')
    expect(html).toContain(asHtml(t('cmd.groupScreens')))
  })

  it('says what matched nothing, and keeps the count off the plural node', () => {
    const empty = rankPalette('zzzzz', sources(), 0)
    const html = dialog('zzzzz', empty)
    expect(html).toContain(asHtml(t('cmd.empty', { value: 'zzzzz' })))
    expect(html).toContain(asHtml(t('cmd.emptyHint')))
    expect(html).toContain('aria-expanded="false"')
    // count=0 must not reach cmd.results — the Arabic `zero` form would be
    // announced as a sentence the empty state has already said better.
    expect(html).not.toContain(asHtml(t('cmd.results', { count: 0 })))
  })

  it('announces the result count without printing it', () => {
    const html = dialog('privacy', model('privacy'))
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain(`class="sr-only" role="status">${asHtml(t('cmd.results', { count: 1 }))}`)
    expect(html).not.toContain('{count}')
  })

  it('renders an entry row with both its lines', () => {
    const rows = entryCandidates(
      [entry({ id: 'e1', title: 'Firewall rule DC2', track_id: 't-net', status: 'blocked' })],
      new Map([[NETWORK.id, NETWORK]]),
      label,
      vocab,
    )
    const html = dialog('', rankPalette('', sources({ entries: rows }), 0))
    expect(html).toContain('Firewall rule DC2')
    expect(html).toContain('Network ops · blocked')
    expect(html).toContain('class="cmd-option-hint"')
  })

  it('leaves the hint element off a row that has no second line', () => {
    const rows = screenCandidates('member', () => {})
    expect(dialog('', rankPalette('', sources({ screens: rows }), 0))).not.toContain(
      'cmd-option-hint',
    )
  })

  it('never renders an unresolved dot path, in either language', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const html = dialog('', model())
      expect(html).not.toMatch(/>cmd\.[a-zA-Z]/)
      expect(html).not.toMatch(/>route\.[a-zA-Z]/)
      expect(html).not.toContain('{value}')
      expect(html).not.toContain('{count}')
    }
    setLocale('en')
  })
})

/* ══════════════════════════ 5. the Arabic query ══════════════════════════ */

describe('an Arabic query, through the whole palette', () => {
  it('finds the seeded track by the SINGULAR a person actually types', () => {
    setLocale('ar')
    // Migration 0001 seeds Network under its Arabic PLURAL and people type the
    // singular. lib/hotkeys' searchNeedles carries the stem on the QUERY side
    // only — the bug Wave 4b fixed was the fold being applied to the haystack
    // too, which dropped this row on the second-to-last keystroke of the track's
    // own name. The lib has that regression; this is the same claim made where a
    // user makes it, with the real label function and the real render.
    const model = rankPalette(
      'الشبكة',
      sources({ tracks: trackCandidates([NETWORK], label, () => {}) }),
      0,
    )
    expect(model.count).toBe(1)
    const html = dialog('الشبكة', model)
    expect(html).toContain('الشبكات')
    expect(html).toContain(asHtml(t('cmd.groupTracks')))
    expect(html).toContain('aria-activedescendant="cmd-opt-0"')
    setLocale('en')
  })

  it('finds an Arabic-titled entry the same way', () => {
    setLocale('ar')
    const rows = entryCandidates(
      [entry({ id: 'e1', title: 'ترقية المحوّل الأساسي' })],
      new Map(),
      label,
      vocab,
    )
    const model = rankPalette('المحول', sources({ entries: rows }), 0)
    // `المحوّل` carries a shadda the query does not; normalizeSearch strips the
    // diacritic on both sides, which is why this matches at all.
    expect(model.count).toBe(1)
    expect(dialog('المحول', model)).toContain('ترقية المحوّل الأساسي')
    setLocale('en')
  })
})

/* ═════════════════════════ 6. the focus restore ══════════════════════════ */

describe('shouldRestoreFocus', () => {
  const BODY = { tag: 'body' }
  const ROOT = { tag: 'html' }

  it('restores when the palette orphaned focus on <body>', () => {
    expect(
      shouldRestoreFocus({ active: BODY, body: BODY, root: ROOT, triggerConnected: true }),
    ).toBe(true)
    expect(
      shouldRestoreFocus({ active: null, body: BODY, root: ROOT, triggerConnected: true }),
    ).toBe(true)
    expect(
      shouldRestoreFocus({ active: ROOT, body: BODY, root: ROOT, triggerConnected: true }),
    ).toBe(true)
  })

  it('stands down when the entry sheet claimed the keyboard first', () => {
    // The browser-pass bug: an entry row's Enter closes the palette AND opens
    // the sheet in the same commit, the sheet focuses its own surface, and an
    // unconditional restore then dragged focus back to `#main`.
    const sheet = { tag: 'div' }
    expect(
      shouldRestoreFocus({ active: sheet, body: BODY, root: ROOT, triggerConnected: true }),
    ).toBe(false)
  })

  it('does not focus a trigger that navigation has already unmounted', () => {
    expect(
      shouldRestoreFocus({ active: BODY, body: BODY, root: ROOT, triggerConnected: false }),
    ).toBe(false)
  })
})

/* ═══════════════════════ 7. the mounted component ════════════════════════ */

describe('<CommandPalette />', () => {
  const render = (): string =>
    renderToStaticMarkup(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    )

  it('mounts without a screen, and costs one listener', () => {
    fx.state.entries = [entry({ id: 'e1', title: 'Firewall rule DC2' })]
    fx.state.tracks = [NETWORK]
    const html = render()
    // "It renders null until something opens it" — the component's own header.
    // If this ever renders the dialog, react-dom/server throws on the portal and
    // this test is how we find out.
    expect(html).toBe('')
  })

  it('renders nothing for an admin either — the role only widens the row list', () => {
    fx.state.role = 'admin'
    expect(render()).toBe('')
    fx.state.role = 'member'
  })
})
