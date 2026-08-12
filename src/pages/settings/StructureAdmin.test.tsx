// Proof for /settings/structure — the tree rules, the shell the screen first
// paints, and the two locale files it is made of.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real hooks,
// the real class names and the real translator.
//
// ── WHERE THE VALUE OF THIS FILE ACTUALLY SITS ─────────────────────────────
//
// A server render runs no effects and dispatches no events, so the tree itself
// — the cards, the indented rows, the three disclosures — is behind a fetch and
// is OUT OF REACH here. It is claimed about nowhere below; its interactive proof
// is a browser pass, and that is what a browser pass is for.
//
// So the weight of this file is on the part that is NOT behind a fetch: the pure
// functions that decide what the tree may do. Those are the interesting ones,
// because each of them mirrors a refusal the DATABASE makes:
//
//   descendantIds / legalParents  ↔  0023 `map_node_cycle`
//   subtreeHeight / legalParents  ↔  0023 `map_node_depth` (the cap of 6)
//   flattenTrack                  ↔  the display order the reorder RPC writes
//
// A screen that offers an illegal destination does not merely fail; it turns a
// considered, translated refusal into a raw Postgres sentence in an RTL layout.
// That is the failure these tests exist to prevent, and none of them needs a
// render to see it.
//
// THE THIRD BLOCK IS THE LOCALE PAIR, READ AS JSON RATHER THAN THROUGH t(). The
// `structure` namespace is NEW, and a new namespace does not reach a reader
// until `src/locales/index.ts` imports it and `lib/labelSections.ts` places it —
// two files this worker does not own, applied by the integrator. Asserting
// through `t()` here would therefore fail for a reason that has nothing to do
// with the strings being right or wrong, and would go on failing every time
// somebody ran the suite before integration. Reading the two JSON files directly
// asserts everything that IS this worker's: parity, tokens, plural categories,
// bidi isolates, and that every key the screen asks for exists in both
// languages. The registration itself is checked, repo-wide and for every
// namespace at once, by localeParity/localeReach/labelSections — which is where
// that check belongs.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { MapNode, Track } from '../../types'
import EN from '../../locales/en/structure.json'
import AR from '../../locales/ar/structure.json'

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

// The screen asks store/auth's `useHasPerm(key)` now, not "is this profile an
// admin" — 0025 re-points its RLS policies at a permission key and the client
// mirrors that. The fixture still describes a person by their LEGACY role, so
// the mock resolves the key exactly the way store/auth's own legacy fallback
// does: an admin holds every key, a member holds none of these. Every case
// below therefore keeps meaning what it meant.
vi.mock('../../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
  useHasPerm: () => fx.state.role === 'admin',
}))

vi.mock('../../store/config', () => ({ invalidateConfig: () => {} }))

// The roster the account-manager select is fed from. Empty at first paint is
// the honest shape: App.tsx warms the members store in the shell, and this
// screen renders before that lands.
vi.mock('../../store/members', () => ({ useMembers: () => [] }))

// Recording stubs, so a render that reached the network would be visible as a
// call rather than as a silent request in a test run.
const record =
  (name: string) =>
  (...args: unknown[]) => {
    fx.state.calls.push(`${name}(${args.join(',')})`)
    return Promise.resolve({ ok: false as const, error: 'common.error' })
  }

vi.mock('../../api/map', () => ({
  listMapNodes: record('listMapNodes'),
  listMapNodeKinds: record('listMapNodeKinds'),
  createMapNode: record('createMapNode'),
  updateMapNode: record('updateMapNode'),
  setMapNodeArchived: record('setMapNodeArchived'),
  reorderMapNodes: record('reorderMapNodes'),
  moveMapNode: record('moveMapNode'),
  getMapNodeUsage: record('getMapNodeUsage'),
}))

vi.mock('../../api/tracks', () => ({ listTracks: record('listTracks') }))

const { setLocale, t } = await import('../../lib/i18n')
const mod = await import('./StructureAdmin')
// The bilingual fallback moved to lib/labels — one rule, two screens, since the
// map now builds its view model from the same function. Imported here rather
// than re-tested there because this suite is where the reasoning behind it (the
// column is `not null default ''`, so the test is for EMPTY) is written down.
const { nodeLabel: nodeLabelIn } = await import('../../lib/labels')
const StructureAdmin = mod.default
const {
  MAX_LEVEL,
  buildIndex,
  descendantIds,
  flattenTrack,
  hasArchivedAncestor,
  legalParents,
  parentChoiceValue,
  parseParentChoice,
  subtreeHeight,
} = mod

/**
 * The screen's own source and its sheet, as text.
 *
 * `?raw` rather than exporting anything further: the two properties worth
 * pinning here are properties of the FILES — "every key the screen asks for
 * exists in both languages" and "the indent is a logical property" — and
 * neither can be reached through the module's exports. localeReach.test.ts and
 * GroupsAdmin.test.tsx both read source this way and for the same reason.
 */
const SOURCE: string = (await import('./StructureAdmin.tsx?raw')).default

/**
 * The sheet as text — and it CANNOT come through `?raw`.
 *
 * vitest.config.ts leaves `test.css` at its default of false, which replaces
 * every `.css` import with an empty module, and the interception matches on the
 * EXTENSION before the query is looked at. Both `import('./structure.css?raw')`
 * and `import.meta.glob('./structure.css', { query: '?raw' })` therefore hand
 * back the empty string here — measured, not assumed: this file was written
 * with the glob first and its three assertions passed against `''`, which is
 * strictly worse than no test at all, because it is a gate reporting green on a
 * deleted rule. `styles/contrast.test.ts` and `ModeFrame.test.tsx` both record
 * the same finding.
 *
 * So: `node:fs`, with the specifier held in a VARIABLE rather than written as a
 * literal. tsconfig.app.json pins `types: ["vite/client"]`, and a literal
 * `'node:fs'` reds `tsc -b` for the whole solution with TS2591; a computed
 * specifier is resolved at run time, where this file genuinely does run on node
 * (`environment: 'node'`), and is invisible to the app's types. contrast.test.ts
 * is the precedent, verbatim.
 */
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const SHEET: string = readFileSync(new URL('./structure.css', import.meta.url), 'utf8')

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
      <StructureAdmin />
    </MemoryRouter>,
  )
}

/* ─────────────────────────────── fixtures ──────────────────────────────── */

let seq = 0
function node(over: Partial<MapNode> & Pick<MapNode, 'id' | 'track_id'>): MapNode {
  seq += 1
  return {
    parent_id: null,
    kind_id: null,
    name: over.id,
    name_ar: '',
    description: '',
    description_ar: '',
    account_manager_id: null,
    vendor: '',
    sort_order: seq,
    archived: false,
    archived_at: null,
    source: 'local',
    external_ref: null,
    external_url: null,
    synced_at: null,
    overrides: [],
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function track(id: string, archived = false): Track {
  return {
    id,
    name: id,
    name_ar: '',
    color: '#46c26a',
    color_light: null,
    icon: 'server',
    sort_order: 1,
    archived,
    created_at: '2026-01-01T00:00:00Z',
  } as Track
}

/**
 * `UHR > OB > Org1, Org2` — Aziz's own example, plus a second track to move
 * things onto. Written once and reused, because every rule below is about the
 * relationship between two rows rather than about one.
 */
function workspace(): { nodes: MapNode[]; tracks: Track[] } {
  seq = 0
  const uhr = 'uhr'
  const ayn = 'ayn'
  return {
    tracks: [track(uhr), track(ayn)],
    nodes: [
      node({ id: 'ob', track_id: uhr }),
      node({ id: 'org1', track_id: uhr, parent_id: 'ob' }),
      node({ id: 'org2', track_id: uhr, parent_id: 'ob' }),
      node({ id: 'wave', track_id: uhr, parent_id: 'org1' }),
      node({ id: 'ayn-phase', track_id: ayn }),
    ],
  }
}

/** A chain `c1 > c2 > … > cN`, for the depth cap. */
function chain(depth: number, trackId = 'uhr'): MapNode[] {
  seq = 0
  const out: MapNode[] = []
  for (let i = 1; i <= depth; i += 1) {
    out.push(node({ id: `c${i}`, track_id: trackId, parent_id: i === 1 ? null : `c${i - 1}` }))
  }
  return out
}

/* ─────────────────────────────── the gate ──────────────────────────────── */

describe('the admin gate', () => {
  it('renders nothing editable for a member', () => {
    const html = render('member')
    // The route is gated too (App.tsx bounces a member back to /settings); this
    // is the screen's own second copy, and the one that survives a deep link
    // arriving before the profile has loaded.
    expect(html).not.toContain('class="str"')
    expect(html).not.toContain('str-tracks')
    expect(html).not.toContain(asHtml(t('structure.subtitle')))
  })

  it('renders the screen for an admin', () => {
    const html = render('admin')
    expect(html).toContain('class="str"')
    expect(html).toContain(asHtml(t('structure.subtitle')))
  })
})

/* ───────────────────────── the shell it first paints ───────────────────── */

describe('the first paint', () => {
  it('offers a way back, which is the only chrome linking these screens', () => {
    // /settings/structure is in neither nav — App.tsx's header names it and this
    // link is how a thumb gets out.
    const html = render()
    expect(html).toContain('href="/settings"')
    expect(html).toContain(asHtml(t('common.back')))
  })

  it('carries no heading of its own', () => {
    // App.tsx's header already renders structure.title as the document h1 for
    // this route; a second copy is noise in the heading outline.
    expect(render()).not.toContain('<h1')
  })

  it('shows a skeleton, not an empty state, before the read has answered', () => {
    // The difference matters: "no tracks yet" is a claim about the workspace,
    // and making it while the request is still in flight tells an admin their
    // migration did not run.
    const html = render()
    expect(html).toContain('skeleton')
    expect(html).not.toContain(asHtml(t('structure.empty')))
    expect(html).not.toContain(asHtml(t('structure.emptyTrack')))
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

/* ──────────────────── the tree: order, depth, ancestry ─────────────────── */

describe('flattening a track', () => {
  it('walks depth-first and numbers levels from 1, like 0023 does', () => {
    const { nodes } = workspace()
    const rows = flattenTrack(buildIndex(nodes), 'uhr')
    expect(rows.map((r) => `${r.node.id}@${r.level}`)).toEqual([
      'ob@1',
      'org1@2',
      'wave@3',
      'org2@2',
    ])
  })

  it('gives every row its position among its OWN siblings, not among all rows', () => {
    // What up/down move. `org2` is the second child of `ob`, not the fourth row
    // of the tree — a flat index here would send a reorder RPC a list from
    // another branch, which 0023's `reorder_map_nodes` proves and refuses.
    const { nodes } = workspace()
    const rows = flattenTrack(buildIndex(nodes), 'uhr')
    const org2 = rows.find((r) => r.node.id === 'org2')
    expect(org2?.index).toBe(1)
    expect(org2?.siblingCount).toBe(2)
    expect(rows.find((r) => r.node.id === 'ob')?.siblingCount).toBe(1)
  })

  it('orders siblings by sort_order, and breaks a tie by name', () => {
    seq = 0
    const nodes = [
      node({ id: 'b', track_id: 'uhr', name: 'Beta', sort_order: 2 }),
      node({ id: 'a', track_id: 'uhr', name: 'Alpha', sort_order: 2 }),
      node({ id: 'z', track_id: 'uhr', name: 'Zed', sort_order: 1 }),
    ]
    const rows = flattenTrack(buildIndex(nodes), 'uhr')
    expect(rows.map((r) => r.node.id)).toEqual(['z', 'a', 'b'])
  })

  it('keeps archived nodes AND the children of archived parents', () => {
    // The one place this differs from store/config.ts's deriveMap, which drops
    // both — correctly, for the map. Here the opposite is true: a subtree that
    // vanished from the only screen that can restore it is unreachable.
    seq = 0
    const nodes = [
      node({ id: 'ob', track_id: 'uhr', archived: true }),
      node({ id: 'org1', track_id: 'uhr', parent_id: 'ob' }),
    ]
    expect(flattenTrack(buildIndex(nodes), 'uhr').map((r) => r.node.id)).toEqual(['ob', 'org1'])
  })

  it('rescues a node whose parent this screen did not load', () => {
    // A parent_id naming a row that is not in the list would otherwise put the
    // node in no bucket at all — invisible in every list at once, on the one
    // screen that could re-file it.
    seq = 0
    const nodes = [node({ id: 'orphan', track_id: 'uhr', parent_id: 'gone' })]
    expect(flattenTrack(buildIndex(nodes), 'uhr').map((r) => r.node.id)).toEqual(['orphan'])
  })

  it('terminates on a cycle instead of hanging the tab', () => {
    // 0023 forbids cycles with a deferred constraint trigger, so this cannot be
    // committed — but this function also runs over rows held optimistically
    // between a write and its reply. A bounded walk that renders a slightly
    // wrong tree is recoverable; a frozen renderer is not.
    seq = 0
    const nodes = [
      node({ id: 'a', track_id: 'uhr', parent_id: 'b' }),
      node({ id: 'b', track_id: 'uhr', parent_id: 'a' }),
    ]
    const rows = flattenTrack(buildIndex(nodes), 'uhr')
    expect(rows.length).toBeLessThan(20)
  })
})

describe('descendants and subtree height', () => {
  it('names every node beneath one, and never the node itself', () => {
    const { nodes } = workspace()
    const index = buildIndex(nodes)
    expect([...descendantIds(index, 'ob')].sort()).toEqual(['org1', 'org2', 'wave'])
    expect(descendantIds(index, 'ob').has('ob')).toBe(false)
    expect([...descendantIds(index, 'wave')]).toEqual([])
  })

  it('measures a branch by its DEEPEST row, which is what the cap applies to', () => {
    const { nodes } = workspace()
    const index = buildIndex(nodes)
    expect(subtreeHeight(index, 'wave')).toBe(1)
    expect(subtreeHeight(index, 'org1')).toBe(2)
    expect(subtreeHeight(index, 'ob')).toBe(3)
  })
})

describe('legal parents — the two refusals, made client-side', () => {
  it('never offers a node itself or anything beneath it', () => {
    // 0023 raises `map_node_cycle` for both. Offering either would turn a
    // translated refusal into a raw Postgres sentence.
    const { nodes, tracks } = workspace()
    const choices = legalParents(buildIndex(nodes), tracks, 'ob')
    const ids = choices.map((c) => c.parentId)
    expect(ids).not.toContain('ob')
    expect(ids).not.toContain('org1')
    expect(ids).not.toContain('org2')
    expect(ids).not.toContain('wave')
  })

  it('offers both tracks as a level-1 destination, which is the cross-track move', () => {
    const { nodes, tracks } = workspace()
    const roots = legalParents(buildIndex(nodes), tracks, 'org1').filter((c) => c.parentId === null)
    expect(roots.map((c) => c.trackId).sort()).toEqual(['ayn', 'uhr'])
  })

  it('offers a node on ANOTHER track as a parent — that move is legal', () => {
    // Nothing here mirrors `map_node_cross_track`: a cross-track destination is
    // legal, and `move_map_node` rewrites the whole subtree's track_id in one
    // statement. It is the move that needs DESCRIBING beforehand, which is the
    // counts panel's job rather than this function's.
    const { nodes, tracks } = workspace()
    const choices = legalParents(buildIndex(nodes), tracks, 'org1')
    expect(choices.map((c) => c.parentId)).toContain('ayn-phase')
  })

  it('refuses a parent that would push the branch past level 6', () => {
    // The cap is on the branch's DEEPEST row, not on the node being moved. A
    // 3-level branch may sit under a level-3 parent (3 + 3 = 6) and not under a
    // level-4 one.
    const nodes = [...chain(4), ...workspace().nodes.filter((n) => n.track_id === 'uhr')]
    const index = buildIndex(nodes)
    const choices = legalParents(index, [track('uhr')], 'ob')
    expect(subtreeHeight(index, 'ob')).toBe(3)
    expect(choices.map((c) => c.parentId)).toContain('c3')
    expect(choices.map((c) => c.parentId)).not.toContain('c4')
  })

  it('agrees with the cap 0023 enforces, rather than with a number of its own', () => {
    // A leaf may go anywhere down to level 6 and no further, which is the
    // trigger's `v_max_depth` exactly.
    const nodes = chain(MAX_LEVEL)
    const choices = legalParents(buildIndex(nodes), [track('uhr')], 'c1')
    // c1's subtree IS the whole chain, so nothing but level 1 can hold it.
    expect(choices.every((c) => c.parentId === null)).toBe(true)

    seq = 100
    const withLeaf = [...chain(MAX_LEVEL), node({ id: 'leaf', track_id: 'uhr' })]
    const leafChoices = legalParents(buildIndex(withLeaf), [track('uhr')], 'leaf')
    const deepest = leafChoices.map((c) => c.level).reduce((a, b) => Math.max(a, b), 0)
    expect(deepest).toBe(MAX_LEVEL)
    expect(leafChoices.map((c) => c.parentId)).toContain(`c${MAX_LEVEL - 1}`)
    expect(leafChoices.map((c) => c.parentId)).not.toContain(`c${MAX_LEVEL}`)
  })

  it('still offers an archived node as a parent, and says so on the row', () => {
    // Filing a branch under a put-away phase is how a whole programme is
    // mothballed. The row carries the Archived pill, so the choice is informed
    // rather than hidden.
    seq = 0
    const nodes = [
      node({ id: 'old', track_id: 'uhr', archived: true }),
      node({ id: 'org', track_id: 'uhr' }),
    ]
    const choices = legalParents(buildIndex(nodes), [track('uhr')], 'org')
    expect(choices.map((c) => c.parentId)).toContain('old')
  })
})

describe('the destination value round-trips', () => {
  it('survives a uuid on both sides of the separator', () => {
    const trackId = '6f2b1c3d-0000-4000-8000-000000000001'
    const parentId = '6f2b1c3d-0000-4000-8000-000000000002'
    expect(parseParentChoice(parentChoiceValue(trackId, parentId))).toEqual({ trackId, parentId })
    expect(parseParentChoice(parentChoiceValue(trackId, null))).toEqual({ trackId, parentId: null })
  })

  it('reads a value it did not write as no answer at all', () => {
    // The `<select>` is the only writer, but a value with no separator would
    // otherwise resolve to a move to a track called ''.
    expect(parseParentChoice('')).toBeNull()
    expect(parseParentChoice(':abc')).toBeNull()
  })
})

describe('the archived-ancestor note', () => {
  it('is true when anything above the node is archived', () => {
    seq = 0
    const nodes = [
      node({ id: 'ob', track_id: 'uhr', archived: true }),
      node({ id: 'org1', track_id: 'uhr', parent_id: 'ob' }),
      node({ id: 'wave', track_id: 'uhr', parent_id: 'org1' }),
    ]
    const index = buildIndex(nodes)
    const wave = nodes[2]
    // Restoring `wave` puts it back in this list and nowhere else: store/config
    // drops the children of an archived parent, so the map still will not draw
    // it. Saying so is the difference between a restore that looks broken and
    // one that is half-finished.
    expect(hasArchivedAncestor(index, wave)).toBe(true)
    expect(hasArchivedAncestor(index, nodes[0])).toBe(false)
  })
})

describe('the bilingual name falls back on EMPTY, not on null', () => {
  it('shows the English name when nobody has translated the node', () => {
    // `name_ar` is `not null default ''` (0023), so a null test would never fire
    // and an untranslated node would render as a blank row in Arabic.
    const row = { name: 'Onboarding', name_ar: '' }
    expect(nodeLabelIn(row, 'ar')).toBe('Onboarding')
    expect(nodeLabelIn({ name: 'Onboarding', name_ar: '  ' }, 'ar')).toBe('Onboarding')
    expect(nodeLabelIn({ name: 'Onboarding', name_ar: 'التهيئة' }, 'ar')).toBe('التهيئة')
    expect(nodeLabelIn({ name: 'Onboarding', name_ar: 'التهيئة' }, 'en')).toBe('Onboarding')
  })
})

/* ──────────────────── the indent, which is the whole screen ─────────────── */

describe('the indent is a LOGICAL property', () => {
  it('is padding-inline-start bound to --depth, never padding-left', () => {
    // The one rule in this feature that cannot be relaxed. A physical
    // padding-left pushes every row away from the LEFT edge, and Arabic reads
    // from the right — so a six-level tree would render with every level flush
    // against the same edge and no hierarchy visible at all.
    expect(SHEET).toContain('padding-inline-start: calc(var(--depth, 0) * 1.25rem)')
    expect(SOURCE).toContain("'--depth': level - 1")
  })

  it('uses no physical layout property anywhere in the sheet', () => {
    // The standing grep, scoped to this file so the failure names it. `width`
    // and `height` are included because the registry's grep is written that
    // way; `line-height` and the media query's `max-width` are the two
    // established exceptions and are excluded by the same convention every
    // other sheet in the repo follows.
    const hits = SHEET.split('\n').filter((line) =>
      /(^|[^-\w])(width|height|left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/.test(
        line.replace(/line-height|max-width|min-width|max-height|min-height/g, ''),
      ),
    )
    expect(hits).toEqual([])
  })

  it('mirrors the guide rule and the counts block too', () => {
    // An indent that mirrors and a rule that does not would put the rule on the
    // far side of the text it is indenting.
    expect(SHEET).toContain('border-inline-start')
    expect(SHEET).not.toContain('border-left')
  })
})

/* ─────────────────────── the two locale files ──────────────────────────── */

type Leaf = string | Record<string, string>
type Tree = Record<string, Leaf>

const EN_NS = (EN as Record<string, Tree>).structure
const AR_NS = (AR as Record<string, Tree>).structure

/** Every leaf, flattened — plural forms become `key.category`. */
function flat(tree: Tree): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, leaf] of Object.entries(tree)) {
    if (typeof leaf === 'string') out.set(key, leaf)
    else for (const [category, form] of Object.entries(leaf)) out.set(`${key}.${category}`, form)
  }
  return out
}

const EN_FLAT = flat(EN_NS)
const AR_FLAT = flat(AR_NS)
const PLURAL_KEYS = Object.entries(EN_NS)
  .filter(([, leaf]) => typeof leaf !== 'string')
  .map(([key]) => key)

describe('the structure namespace', () => {
  it('has exactly one root, named after its file', () => {
    // src/locales/index.ts merges with a flat spread, so a second root in one
    // file would silently win or lose by import order.
    expect(Object.keys(EN as Record<string, unknown>)).toEqual(['structure'])
    expect(Object.keys(AR as Record<string, unknown>)).toEqual(['structure'])
  })

  it('holds the same key set in both languages', () => {
    const en = Object.keys(EN_NS).sort()
    const ar = Object.keys(AR_NS).sort()
    expect(ar.filter((k) => !en.includes(k))).toEqual([])
    expect(en.filter((k) => !ar.includes(k))).toEqual([])
  })

  it('has no empty value in either language', () => {
    const blank = [...EN_FLAT, ...AR_FLAT].filter(([, v]) => v.trim() === '').map(([k]) => k)
    expect(blank).toEqual([])
  })

  it('uses the same interpolation tokens for the same key', () => {
    // The failure a parity-by-key check cannot see: a `{name}` renamed in one
    // language renders as literal braces in an aria-label nobody proofreads.
    const tokens = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const mismatched: string[] = []
    for (const [key, value] of EN_FLAT) {
      const twin = AR_FLAT.get(key)
      if (twin === undefined) continue
      // `{count}` is legitimately absent from an Arabic `zero`/`one`/`two` form,
      // which covers exactly one number and spells it out in words.
      const only = tokens(value).filter((tok) => tok !== 'count')
      const twinOnly = tokens(twin).filter((tok) => tok !== 'count')
      if (only.join() !== twinOnly.join()) mismatched.push(`${key}: ${only} vs ${twinOnly}`)
    }
    expect(mismatched).toEqual([])
  })
})

describe('the counted strings', () => {
  it('are plural NODES, so the noun can agree with the number', () => {
    // Every number this screen shows counts something: items on the map, items
    // of work. A plain string with a `{count}` in it freezes one grammatical
    // form for every value — which is wrong in English for exactly one value
    // and wrong in Arabic for most of them.
    expect(PLURAL_KEYS.sort()).toEqual([
      'moveCountEntries',
      'moveCountNodes',
      'movedWork',
      'nodeCount',
    ])
  })

  it('ship only the categories each language can select', () => {
    for (const key of PLURAL_KEYS) {
      expect(Object.keys(EN_NS[key]).sort()).toEqual(['one', 'other'])
      expect(Object.keys(AR_NS[key]).sort()).toEqual(
        ['few', 'many', 'one', 'other', 'two', 'zero'].sort(),
      )
    }
  })

  it('carry {count} in every form that covers more than one number', () => {
    // `one` in English and `zero`/`one`/`two` in Arabic each cover exactly one
    // number and may spell it out in words. Every other category covers a range,
    // and a range with no number in it is a sentence that lies for all but one
    // of its values.
    const forms = (tree: Tree, key: string): Record<string, string> => {
      const leaf = tree[key]
      if (typeof leaf === 'string') throw new Error(`${key} is not a plural node`)
      return leaf
    }
    const missing: string[] = []
    for (const key of PLURAL_KEYS) {
      if (!forms(EN_NS, key).other.includes('{count}')) missing.push(`en ${key}.other`)
      for (const category of ['few', 'many', 'other'] as const) {
        if (!forms(AR_NS, key)[category].includes('{count}')) missing.push(`ar ${key}.${category}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('bidi', () => {
  const FSI = '⁨'
  const PDI = '⁩'
  /** Tokens whose value is user data and can therefore run the other way. */
  const USER_VALUES = new Set(['name', 'owner', 'target', 'track', 'from', 'to'])

  it('fences every interpolation whose value can run the other way', () => {
    // `{name}` is an organization name, `{track}` a track name, `{owner}` a
    // member's — all single free-text columns that are Arabic as often as they
    // are Latin. Without an isolate the neutral punctuation beside them
    // resolves to the paragraph and the sentence reads back to front.
    const bare: string[] = []
    for (const [locale, table] of [
      ['en', EN_FLAT],
      ['ar', AR_FLAT],
    ] as const) {
      for (const [key, value] of table) {
        for (const m of value.matchAll(/\{(\w+)\}/g)) {
          if (!USER_VALUES.has(m[1])) continue
          const before = value.slice(0, m.index)
          const after = value.slice((m.index ?? 0) + m[0].length)
          if (!before.endsWith(FSI) || !after.startsWith(PDI)) {
            bare.push(`${locale} ${key} {${m[1]}}`)
          }
        }
      }
    }
    expect(bare.sort()).toEqual([])
  })

  it('never leaves an isolate open', () => {
    const broken: string[] = []
    for (const [key, value] of [...EN_FLAT, ...AR_FLAT]) {
      let depth = 0
      for (const ch of value) {
        if (ch === '⁦' || ch === '⁧' || ch === FSI) depth += 1
        else if (ch === PDI) depth = Math.max(0, depth - 1)
      }
      if (depth !== 0) broken.push(key)
    }
    expect(broken).toEqual([])
  })
})

describe('every key the screen asks for exists in both languages', () => {
  it('resolves each one against the two JSON files', () => {
    // localeReach.test.ts does this repo-wide THROUGH t(), which cannot answer
    // until src/locales/index.ts imports this namespace — a file this worker
    // does not own. Scoped here to the two files that are this worker's, so a
    // key typed into the screen and never written into the pair fails now
    // rather than at integration.
    const asked = [...SOURCE.matchAll(/'(structure\.[A-Za-z][\w]*)'/g)].map((m) => m[1])
    // A screen with no keys would make this vacuous.
    expect(asked.length).toBeGreaterThan(30)
    const missing = [...new Set(asked)].filter((key) => {
      const local = key.slice('structure.'.length)
      return !(local in EN_NS) || !(local in AR_NS)
    })
    expect(missing.sort()).toEqual([])
  })

  it('says nothing in JSX that is not a locale key', () => {
    // The standing grep for hardcoded user-facing strings, scoped so the
    // failure names this screen. Every visible string here goes through t();
    // what is left in the markup is class names, ids and the `''`/`'ltr'`/
    // `'rtl'` literals the bilingual fields need.
    const jsxText = [...SOURCE.matchAll(/>\s*([A-Za-z][A-Za-z ]{3,})\s*</g)].map((m) => m[1].trim())
    expect(jsxText).toEqual([])
  })
})

/* ─────────────────── the sentences, rendered in both ───────────────────── */

describe('the interpolating sentences carry the tokens the screen passes', () => {
  it('names the node, the tracks and the destination in both languages', () => {
    // The failure key-set parity cannot see: it compares en to ar, never either
    // to its caller.
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const local = (key: string, vars: Record<string, string | number>): string => {
        const table = locale === 'en' ? EN_NS : AR_NS
        const raw = table[key]
        const template = typeof raw === 'string' ? raw : raw.other
        return template.replace(/\{(\w+)\}/g, (m, tok: string) =>
          tok in vars ? String(vars[tok]) : m,
        )
      }
      expect(local('moveUp', { name: 'Org1' })).toContain('Org1')
      expect(local('managerLabel', { name: 'Org1' })).toContain('Org1')
      expect(local('managerSet', { owner: 'Sara Alsaab', name: 'Org1' })).toContain('Sara Alsaab')
      const cross = local('moveCrossTrack', { from: 'UHR', to: 'Ayenati' })
      expect(cross).toContain('UHR')
      expect(cross).toContain('Ayenati')
      expect(cross).not.toContain('{')
      const at = local('movedTo', { name: 'Org1', position: 1, total: 2 })
      expect(at).toContain('1')
      expect(at).toContain('2')
      expect(at).not.toContain('{')
    }
    setLocale('en')
  })
})
