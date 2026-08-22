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
import type { PermissionKey } from '../api/roles'
import type { Entry, MapNode, Track } from '../types'

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
    nodes: [] as MapNode[],
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
// `useHasPerm` / `useIsAdmin` are what the palette asks for its screen list now,
// keyed off the same fixture role: an admin holds every key and a member holds
// none, which is store/auth's own legacy fallback. The per-row key table is
// asserted against App.tsx directly rather than through this stub.
vi.mock('../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
  useHasPerm: () => fx.state.role === 'admin',
  useIsAdmin: () => fx.state.role === 'admin',
}))
vi.mock('../store/config', () => ({
  useActiveTracks: () => fx.state.tracks,
  useTrackMap: () => new Map(fx.state.tracks.map((tr) => [tr.id, tr])),
  // The organizations group. Empty here on purpose: the mount tests below assert
  // the palette renders NOTHING until it is opened, and what it would have
  // listed is `organizationCandidates`' own business, proved as a pure function.
  useMapNodes: () => fx.state.nodes,
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
// The two pure modules the palette now builds a map link out of. `viewFromParams`
// is the function that will actually read that link back off the address bar and
// `buildMindtree` is the thing that decides what a track's node is called, so
// both are asserted against rather than described.
const { EMPTY_FILTER } = await import('../lib/entryFilter')
const { viewFromParams } = await import('../lib/mindtree/focus')
const { buildMindtree } = await import('../lib/mindtree/model')
const {
  ADMIN_SCREENS,
  LENSES,
  PORTFOLIO_VIEWS,
  PaletteDialog,
  SCREENS,
  actionCandidates,
  default: CommandPalette,
  entryCandidates,
  organizationCandidates,
  mapHref,
  myOrgsHref,
  nextThemeAfter,
  rankPalette,
  screenCandidates,
  shouldRestoreFocus,
  trackCandidates,
  trackFocusId,
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
  node_id: null,
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
//
// useMapUrl.ts is read the same way and for a narrower reason: its `P_LENS` is
// module-private, and importing that file would pull store/mindtree and two
// react-router hooks into a suite with no DOM. CommandPalette's `LENS_PARAM` is
// therefore a copy, and this is where the copy is checked against the original.
//
// lib/entryFilter.ts is read for the third copy: `manager=` is the facet "My
// organizations" narrows on, and its name lives in that file's private `P`
// table. Same reasoning, and the same failure if it drifts — a `?manager=` the
// filter codec does not recognise is simply dropped, so the row would open the
// whole workspace and look like it worked.
const SOURCES: Record<string, string> = import.meta.glob(
  ['../App.tsx', '../pages/map/useMapUrl.ts', '../lib/entryFilter.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)
const APP_SOURCE = SOURCES['../App.tsx'] ?? ''
const MAP_URL_SOURCE = SOURCES['../pages/map/useMapUrl.ts'] ?? ''
const FILTER_SOURCE = SOURCES['../lib/entryFilter.ts'] ?? ''

interface ParsedRoute {
  path: string
  /** The components its `element` renders, `Navigate` excluded. */
  components: string[]
  /** Does the element sit behind one of App.tsx's permission ternaries? */
  adminGated: boolean
  /**
   * WHICH of them, so the palette's per-row key can be checked against the
   * route's and not merely against "is it gated at all". Null when ungated.
   */
  gate: GateName | null
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
 * commented, a comment sits between two `<Route`s, and a sentence containing one
 * of the gate names would otherwise attach itself to the preceding route and
 * mark a screen gated that is not.
 */
const GATE_NAMES = ['isAdmin', 'canEditStructure', 'canEditVocab'] as const
type GateName = (typeof GATE_NAMES)[number]

/**
 * App.tsx's local name for a gate → the permission key it is asking for.
 *
 * The one place the two vocabularies meet. App.tsx spells the question as a
 * variable (`canEditStructure`) and CommandPalette spells it as the key itself
 * (`structure.edit`); this table lets the suite assert they mean the same thing
 * per PATH, which is the assertion that stops a row being offered on a key its
 * route refuses. Adding a gate to GATE_NAMES without a key here is a type error.
 */
const GATE_KEY: Readonly<Record<GateName, PermissionKey>> = {
  isAdmin: 'workspace.admin',
  canEditStructure: 'structure.edit',
  canEditVocab: 'vocab.edit',
}

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
    // THREE GATE NAMES, NOT ONE, since 0025 split the client gate the way it
    // split the policies: `canEditStructure` (tracks, groups, structure),
    // `canEditVocab` (catalogue, vocabulary, terminology) and `isAdmin` (roles,
    // members). What this parse asks is unchanged — "is this route withheld from
    // an ordinary member" — because no member holds any of the three. A route
    // guarded by a FOURTH name nobody added here would read as ungated and this
    // suite would say so on the next run, which is the point of scraping the
    // source rather than restating the table.
    const gate = GATE_NAMES.find((name) => new RegExp(`\\b${name}\\b`).test(segment)) ?? null
    out.push({ path, components, adminGated: gate !== null, gate })
  }
  return out
}

const ROUTES = parseSignedInRoutes(APP_SOURCE)

/**
 * The two viewers `screenCandidates` is exercised as, spelled as PREDICATES
 * because that is what the builder takes now — one key per admin row since 0025,
 * so a role could no longer answer for it.
 *
 * "Every key" and "no key" are not arbitrary stand-ins: they are exactly what
 * store/auth's `legacyPermissionKeys()` derives from the legacy `profiles.role`
 * column, which is the answer the whole app runs on until 0025 is applied. The
 * cases below therefore keep meaning what they meant. A Director — two keys of
 * three — is pinned separately, in the per-row case further down.
 */
const asAdmin = (): boolean => true
const asMember = (): boolean => false

/**
 * The signed-in reader, for the one row that names a person.
 *
 * A uuid rather than `'me'`, because the row percent-encodes what it is handed
 * and a value with nothing to encode would prove nothing about that.
 */
const ME = '9f2b1c34-5678-4abc-9def-000000000001'

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

/**
 * Does App.tsx route this destination?
 *
 * PATTERN-AWARE rather than set membership, because a row is allowed to point at
 * a parameterised route: `/entry/:id` routes `/entry/abc`, and a `Set.has()`
 * would call a working link dangling. The query string is dropped first — a lens
 * row is `/mindtree?lens=numbers`, and what has to be routed is the path.
 *
 * THE CATCH-ALL IS EXCLUDED, and that exclusion is the entire point of the case
 * below. `path="*"` matches everything, so a check that honoured it would agree
 * that every possible destination is fine — which is precisely the swallow that
 * hid a palette row pointing at a deleted route for a whole release.
 */
function routedBy(routes: readonly ParsedRoute[], target: string): boolean {
  const want = (target.split('?')[0] ?? '').split('/')
  return routes.some((route) => {
    if (route.path === '*') return false
    const pattern = route.path.split('/')
    if (pattern.length !== want.length) return false
    return pattern.every((seg, i) => seg.startsWith(':') || seg === want[i])
  })
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

  it('never NAVIGATES anywhere App.tsx does not route, whatever built the row', () => {
    // THE DIRECTION THAT WAS MISSING, AND THE BUG IT LET SHIP.
    //
    // The case above walks a TABLE. The track rows never appear in one: their
    // destination is assembled from a uuid at call time, so `/tracks/<id>`
    // survived the collapse deleting `/tracks/:id` with nothing anywhere going
    // red. And it did not even look broken — App.tsx has no 404, so the
    // catch-all redirected the reader to `/mindtree` and a track name typed into
    // the palette landed on the map they were already looking at.
    //
    // So this case does not read a table. It RUNS every builder that takes a
    // `navigate` and checks where the reader is actually sent, with `path="*"`
    // excluded from the routes — see `routedBy`. Any future row that points at a
    // route nobody defined fails here, whether it was written down or built.
    expect(ROUTES.some((r) => r.path === '*')).toBe(true)
    const seen: string[] = []
    const record = (to: string): void => {
      seen.push(to)
    }
    // SIGNED IN, so the "My organizations" row is in the list. That row is the
    // second destination in this file that is BUILT rather than listed — its
    // path carries the reader's own id — and the track rows are the standing
    // proof that a built destination is invisible to a table walk.
    for (const row of screenCandidates(asAdmin, record, ME)) row.item.run([])
    for (const row of trackCandidates([NETWORK], label, record)) row.item.run([])
    // Guards the filter below from passing because nothing navigated at all.
    expect(seen).toHaveLength(
      SCREENS.length + LENSES.length + PORTFOLIO_VIEWS.length + 1 + ADMIN_SCREENS.length + 1,
    )
    expect(seen.filter((to) => !routedBy(ROUTES, to))).toEqual([])
  })

  it('would catch the dead row: the catch-all is not allowed to answer', () => {
    // The negative control for the case above. `/tracks/t-net` is the exact
    // destination that shipped; App.tsx routes it only through `path="*"`, so a
    // `routedBy` that honoured the catch-all would return true here and the
    // guarantee above would be worth nothing. Both halves are asserted so the
    // exclusion cannot be "tidied" away.
    expect(routedBy(ROUTES, '/tracks/t-net')).toBe(false)
    expect(routedBy(ROUTES, '/mindtree?lens=shape&focus=root%2Ftrack%3At-net')).toBe(true)
    // Parameterised routes must still count — a row pointing at `/entry/<id>`
    // is reaching a route that exists, and a set-membership check would call it
    // dangling.
    expect(routedBy(ROUTES, '/entry/abc')).toBe(true)
  })

  it('spells the lens param the way pages/map/useMapUrl.ts reads it', () => {
    // CommandPalette's `LENS_PARAM` is a COPY of that file's private `P_LENS`.
    // The copy is deliberate (importing useMapUrl would drag store/mindtree and
    // two router hooks into a suite with no DOM), so it is derived from the
    // original here rather than typed twice and hoped about: rename the param on
    // one side and every lens row and every track row becomes a link the map
    // reads as "no opinion".
    const param = /const P_LENS = '([^']+)'/.exec(MAP_URL_SOURCE)?.[1]
    expect(param).toBe('lens')
    for (const lens of LENSES) expect(lens.to).toContain(`?${param ?? ''}=`)
    expect(mapHref('shape', 'root/track:x')).toContain(`?${param ?? ''}=shape`)
    // `?stage=` is never written: every lens implies its stage and
    // `mapParamsForLens` omits the param whenever the two agree.
    for (const lens of LENSES) expect(lens.to).not.toContain('stage=')
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

  it('offers each admin row on the SAME key App.tsx guards that path with', () => {
    // THE ASSERTION THE ALL-OR-NOTHING TABLE COULD NOT MAKE. Since 0025 the
    // eight rows are not one gate but three, and the two failure modes are
    // opposite and both silent: a row keyed WIDER than its route offers a
    // Director a screen that redirects the moment they pick it, and a row keyed
    // NARROWER hides a screen they can open. Neither shows up in a typecheck,
    // and both read as a bug in the palette rather than in a table.
    const byPath = new Map(ROUTES.map((r) => [r.path, r]))
    const mismatched = ADMIN_SCREENS.filter((s) => {
      const gate = byPath.get(s.to)?.gate
      return gate === undefined || gate === null || GATE_KEY[gate] !== s.permKey
    })
    expect(mismatched.map((s) => `${s.to} wants ${s.permKey}`)).toEqual([])
    // The mapping is only worth asserting if it is actually a mapping: all three
    // keys have to be in play, or this passes on a table that quietly collapsed
    // back to one gate.
    expect(new Set(ADMIN_SCREENS.map((s) => s.permKey)).size).toBe(3)
  })

  it('gives a Director the six configuration screens and neither of the two people ones', () => {
    // The role 0025 exists for, and the case that says the client finally
    // mirrors it: `structure.edit` + `vocab.edit`, no `workspace.admin`. Before
    // the split this viewer was offered nothing at all — `role === 'admin'` was
    // false — which is the "correct and invisible" state the wave set out to
    // end.
    const director = (key: PermissionKey): boolean =>
      key === 'structure.edit' || key === 'vocab.edit'
    const ids = screenCandidates(director, () => {}).map((r) => r.item.id)
    expect(ids).toContain('screen:/settings/structure')
    expect(ids).toContain('screen:/settings/terminology')
    expect(ids).not.toContain('screen:/settings/roles')
    expect(ids).not.toContain('screen:/settings/members')
    expect(ids).toHaveLength(SCREENS.length + LENSES.length + PORTFOLIO_VIEWS.length + 7)
    // The shared prefix is still the member's list, in the member's order.
    const member = screenCandidates(asMember, () => {}).map((r) => r.item.id)
    expect(ids.slice(0, member.length)).toEqual(member)
  })

  it('names every screen with a key that resolves in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      for (const screen of [...SCREENS, ...LENSES, ...PORTFOLIO_VIEWS, ...ADMIN_SCREENS]) {
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
    // tracks, dashboard, notifications), and the portfolio is the sixth. They
    // are QUERIES on `/mindtree`, so the "nothing App.tsx does not route" case
    // above cannot see them — this is the half that keeps them honest.
    expect(LENSES).toHaveLength(6)
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

  it('keeps all four portfolio questions ONE tap from anywhere', () => {
    // THE COMPENSATION FOR THE COLLAPSE, ASSERTED. Stalled, workload, vendor
    // cohorts and progress are one chip on the lens bar because nine chips do
    // not fit a phone — so three of the four would have cost a second tap if
    // these rows did not exist. Delete a row here and a question quietly becomes
    // two interactions; nothing else in the repo would say so.
    expect(PORTFOLIO_VIEWS).toHaveLength(4)
    const routed = new Set(ROUTES.map((r) => r.path))
    const bys = PORTFOLIO_VIEWS.map((v) => new URLSearchParams(v.to.split('?')[1] ?? '').get('by'))
    expect(bys).toEqual(['stage', 'manager', 'vendor', 'phase'])
    for (const view of PORTFOLIO_VIEWS) {
      expect(routed.has(view.to.split('?')[0] ?? '')).toBe(true)
      const q = new URLSearchParams(view.to.split('?')[1] ?? '')
      expect(q.get('lens')).toBe('portfolio')
      // Spelled out in full, unlike `?stage=`: a palette row is a link a person
      // copies out of the address bar, and it should say what it will show.
      expect(q.get('risk')).not.toBeNull()
    }
    // ⚠ THE EXCEPTION CUT IS ON FOR EXACTLY ONE ROW. Workload has to sum to
    // every organization, a vendor cohort has to be whole for "one fix unblocks
    // N" to be true, and progress has to carry the organizations with nothing
    // open or the denominator flatters itself. Turning `risk` on for any of the
    // three answers a different question with the same-looking table.
    const risky = PORTFOLIO_VIEWS.filter(
      (v) => new URLSearchParams(v.to.split('?')[1] ?? '').get('risk') === '1',
    )
    expect(risky.map((v) => v.labelKey)).toEqual(['mindtree.portfolioViewStalled'])
  })

  it('spells ?by= and ?risk= the way pages/map/useMapUrl.ts reads them', () => {
    // The same derived pin `LENS_PARAM` gets, for the two params that carry the
    // whole of the sixth lens's interface. A row whose `?by=` the map does not
    // recognise does not fail: `mapPortfolioFromParams` is total and answers
    // with the DEFAULT, so a respelt param silently lands every row on the
    // stalled list and three of the four palette rows stop working in silence.
    const by = /const P_BY = '([^']+)'/.exec(MAP_URL_SOURCE)?.[1]
    const risk = /const P_RISK = '([^']+)'/.exec(MAP_URL_SOURCE)?.[1]
    expect(by).toBe('by')
    expect(risk).toBe('risk')
    for (const view of PORTFOLIO_VIEWS) {
      const q = new URLSearchParams(view.to.split('?')[1] ?? '')
      expect(q.get(by ?? ''), view.labelKey).not.toBeNull()
      expect(q.get(risk ?? ''), view.labelKey).not.toBeNull()
    }
  })

  it('names the reader own book with their id, and offers it to nobody else', () => {
    // "My organizations" is BUILT, so it has no row in any table to walk. The
    // whole book, not the late part of it (`risk=0`), grouped the way the chip
    // groups (`by=stage`), narrowed to one person.
    // The facet name is DERIVED from lib/entryFilter.ts's own param table, not
    // typed twice and hoped about: that codec DROPS a param it does not
    // recognise, so a respelling here would open the whole workspace and look
    // exactly like a working row.
    const manager = /^\s+manager: '([^']+)',$/m.exec(FILTER_SOURCE)?.[1]
    expect(manager).toBe('manager')
    const href = myOrgsHref(ME)
    const q = new URLSearchParams(href.split('?')[1] ?? '')
    expect(href.startsWith('/mindtree?')).toBe(true)
    expect(q.get('lens')).toBe('portfolio')
    expect(q.get(manager ?? '')).toBe(ME)
    expect(q.get('risk')).toBe('0')
    expect(q.get('by')).toBe('stage')
    // A SESSION WITH NO PROFILE GETS NO ROW. `?manager=` with nothing after it
    // matches nothing, so the row would be a promise of an empty table.
    const out = screenCandidates(asMember, () => {}).map((r) => r.item.id)
    expect(out.some((id) => id.includes('manager='))).toBe(false)
    const inn = screenCandidates(asMember, () => {}, ME).map((r) => r.item.id)
    expect(inn).toContain(`screen:${href}`)
    expect(inn).toHaveLength(out.length + 1)
  })
})

/* ══════════════════════════ 2. the candidate rows ════════════════════════ */

describe('screenCandidates', () => {
  it('withholds the admin screens from a member', () => {
    const rows = screenCandidates(asMember, () => {})
    expect(rows).toHaveLength(SCREENS.length + LENSES.length + PORTFOLIO_VIEWS.length)
    expect(rows.map((r) => r.item.id)).not.toContain('screen:/settings/members')
  })

  it('appends them for an admin, leaving the shared order alone', () => {
    const member = screenCandidates(asMember, () => {}).map((r) => r.item.id)
    const admin = screenCandidates(asAdmin, () => {}).map((r) => r.item.id)
    expect(admin).toHaveLength(
      SCREENS.length + LENSES.length + PORTFOLIO_VIEWS.length + ADMIN_SCREENS.length,
    )
    // Same rows in the same places: a list that reorders itself by role is a
    // list nobody builds muscle memory on.
    expect(admin.slice(0, member.length)).toEqual(member)
    expect(admin).toContain('screen:/settings/members')
  })

  it('navigates to the route the row names — including the two that were missing', () => {
    const seen: string[] = []
    const rows = screenCandidates(asAdmin, (to) => seen.push(to))
    for (const to of ['/settings/export', '/settings/notifications', '/settings/members']) {
      const row = rows.find((r) => r.item.id === `screen:${to}`)
      expect(row).toBeDefined()
      row?.item.run([])
    }
    expect(seen).toEqual(['/settings/export', '/settings/notifications', '/settings/members'])
  })
})

describe('trackCandidates', () => {
  it("opens that track's branch on the map, under the shape lens", () => {
    const seen: string[] = []
    const rows = trackCandidates([NETWORK], label, (to) => seen.push(to))
    rows[0]?.item.run([])
    expect(seen).toHaveLength(1)
    const to = seen[0] ?? ''
    expect(to.startsWith('/mindtree?')).toBe(true)
    // READ BACK THROUGH THE CODEC THAT WILL ACTUALLY READ IT, not compared to a
    // string typed twice. `viewFromParams` is what the map calls on whatever is
    // in the address bar and it DROPS a focus id whose grammar it does not
    // recognise, so a row that built a plausible-looking id the parser rejects
    // would sail past a string compare and land the reader on an unfocused map.
    const params = new URLSearchParams(to.split('?')[1] ?? '')
    expect(params.get('lens')).toBe('shape')
    expect(viewFromParams(params).focusId).toBe('root/track:t-net')
  })

  it('focuses the node lib/mindtree/model.ts actually builds for that track', () => {
    // THE PIN UNDER `trackFocusId`. model.ts's `nodeId()` is private, so the
    // palette restates its rule; this builds a real tree and asserts the two
    // agree. If they ever stop agreeing, `resolveFocus` matches nothing and
    // falls back to the whole map — a dead link that looks exactly like a
    // working one, which is the failure mode this whole unit is about.
    const root = buildMindtree({
      entries: [],
      health: new Map(),
      // An ACTIVE track with no work is still ring 1, which is what lets this
      // fixture stay this small.
      tracks: [
        {
          id: NETWORK.id,
          label: 'Network ops',
          color: '#000000',
          colorLight: null,
          sortOrder: 0,
          archived: false,
        },
      ],
      entities: [],
      vocab: [],
      members: [],
      dimension: 'status',
      filter: EMPTY_FILTER,
      ctx: { meId: null, today: '2026-01-01' },
      collapsedIds: new Set(),
      leafThreshold: 5,
    })
    const node = root.children.find((child) => child.bucketKey === NETWORK.id)
    expect(node).toBeDefined()
    expect(node?.id).toBe(trackFocusId(NETWORK.id))
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

describe('organizationCandidates', () => {
  const nodes = [
    { id: 'n1', name: 'Al Hamra Hospital', name_ar: 'مستشفى الحمراء' },
    { id: 'n2', name: 'Yanbu National Hospital', name_ar: '' },
  ] as MapNode[]
  const label = (n: Pick<MapNode, 'name' | 'name_ar'>) => n.name

  it('offers every organization, which is the search the map lost', () => {
    // ⚠ `filterIsle` is gated off in Mindtree.tsx, and it held the only mounted
    // type-ahead over these names. With a hundred and four of them, what was
    // left on the canvas was pinching until the labels resolve. The palette had
    // the right shape and simply did not index the rows.
    const rows = organizationCandidates(nodes, label, () => {})
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.item.label)).toEqual(['Al Hamra Hospital', 'Yanbu National Hospital'])
  })

  it('is findable by its ARABIC name from an English UI, and the reverse', () => {
    // trackCandidates' stated reason, and it matters more here: an organization
    // whose only memorable name is Arabic is unfindable if the fold follows the
    // interface language.
    const rows = organizationCandidates(nodes, label, () => {})
    const fields = rows[0]?.fields.join(' ') ?? ''
    expect(fields).toContain('hamra')
    expect(fields).toContain('الحمراء')
  })

  it('opens the panel rather than flying the camera', () => {
    // The same destination the dead type-ahead used and the same one the
    // portfolio table's rows use — arriving from two places lands you in one.
    const seen: string[] = []
    organizationCandidates(nodes, label, (to: string) => void seen.push(to))[0]?.item.run([])
    expect(seen[0]).toBe(mapHref('shape', 'n1'))
  })

  it('carries a stable id that cannot collide with a track or an entry', () => {
    expect(organizationCandidates(nodes, label, () => {})[0]?.item.id).toBe('node:n1')
  })
})

/* ═════════════════════════════ 3. the ranking ════════════════════════════ */

const sources = (over: Partial<Parameters<typeof rankPalette>[1]> = {}) => ({
  entries: [],
  organizations: [],
  tracks: [],
  screens: [],
  actions: [],
  ...over,
})

describe('rankPalette', () => {
  it('keeps the five groups in their fixed order, entries first', () => {
    const model = rankPalette(
      '',
      sources({
        entries: entryCandidates([entry({ id: 'e1', title: 'One' })], new Map(), label, vocab),
        tracks: trackCandidates([NETWORK], label, () => {}),
        screens: screenCandidates(asMember, () => {}),
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
    const model = rankPalette('privacy', sources({ screens: screenCandidates(asMember, () => {}) }), 0)
    expect(model.groups.map((g) => g.id)).toEqual(['screens'])
    expect(model.count).toBe(1)
  })

  it('numbers the flat index across group boundaries, which is what the arrows walk', () => {
    const model = rankPalette(
      '',
      sources({
        tracks: trackCandidates([NETWORK], label, () => {}),
        screens: screenCandidates(asMember, () => {}),
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
    // offered. It then happened a second time, to the same arithmetic: the sum
    // counted SCREENS and ADMIN_SCREENS but not the five LENSES that were
    // inserted between them, so an admin's nineteen rows were cut to fourteen
    // and the five that fell off the end were the entire admin block.
    //
    // DRIVEN AT THE LARGEST LIST THE BUILDER CAN RETURN — a signed-in admin, so
    // the four portfolio readings AND the "My organizations" row are both in it.
    // The cap's `+ 1` for that conditional row is only exercised here; counted
    // against a signed-out reader this case would pass on a cap one short, and
    // the row it ate would be Members again.
    const rows = screenCandidates(asAdmin, () => {}, ME)
    const model = rankPalette('', sources({ screens: rows }), 0)
    // Counted off the BUILDER rather than off the tables, so a fourth table
    // added to `screenCandidates` is covered by this case the day it lands.
    expect(model.count).toBe(rows.length)
    // The claim behind the number: the rows at the END of the list are the ones
    // a cap eats, and they are exactly the ones only an admin can see.
    const ids = model.flat.map((r) => r.id)
    for (const screen of ADMIN_SCREENS) expect(ids).toContain(`screen:${screen.to}`)
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
        screens: screenCandidates(asMember, () => {}),
      }),
      0,
    )
    // Screens and actions have no entryId, so they must not appear in the walk.
    expect(model.entryIds).toEqual(['e1', 'e2'])
  })

  it('clamps a highlight that a shrinking list left past the end', () => {
    const screens = screenCandidates(asMember, () => {})
    expect(rankPalette('', sources({ screens }), 99).at).toBe(
      SCREENS.length + LENSES.length + PORTFOLIO_VIEWS.length - 1,
    )
    expect(rankPalette('zzzzz', sources({ screens }), 99).at).toBe(-1)
    expect(rankPalette('zzzzz', sources({ screens }), 99).count).toBe(0)
  })

  it('finds a screen by a word inside its name, not only by its first letters', () => {
    const screens = screenCandidates(asAdmin, () => {})
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
    rankPalette(query, sources({ screens: screenCandidates(asMember, () => {}) }), active)

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
    const rows = screenCandidates(asMember, () => {})
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
