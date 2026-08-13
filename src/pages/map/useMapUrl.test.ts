// Proof for the map's URL round-trip.
//
// WHY THERE IS NO RENDER HERE. vitest.config.ts is `environment: 'node'` and
// jsdom is not in the dependency budget; the screen tests that do render use
// `renderToStaticMarkup`, and EFFECTS DO NOT RUN IN A SERVER RENDER —
// PulseLayer.test.tsx states it in its own header and answers it the same way
// this file does: the decisions the effects make are exported as pure functions
// and asserted directly. `useMapUrl` is nothing BUT two effects, so a render
// test of it would assert that the file parses.
//
// WHAT IS ACTUALLY PROVEN, AND WHAT IS NOT.
//
//   PROVEN  the two codecs compose into one params object and neither loses the
//           other's fields; a hostile or inherited param is dropped; and — the
//           reason this unit exists — a pasted deep link SURVIVES A COLD LOAD
//           against an empty store, which `drive()` below establishes by
//           replaying the hook's two effects in the order and with the STALENESS
//           React gives them.
//           Since the filter was wired to the address bar it also proves the
//           three things that came with it: one write carries every param, a
//           link that spells out no stage does not take the reader's ledger
//           away, and an ARRIVING lens opens its panel exactly once — `drive()`
//           models the `arrived` ref and lets a reader act mid-run, which is the
//           only way to tell an inbound link from this session's own mirror.
//   NOT     that React schedules those effects the way `drive()` models. That is
//           React's contract, not this repo's: effects of one component run in
//           declaration order after commit, and each closes over the values of
//           the render that scheduled it. `drive()` encodes exactly that and
//           nothing else, and it calls the SAME exported functions the hook
//           calls, so it cannot silently drift from the decisions under test —
//           only from the schedule, which is stated here rather than hidden.
//
// The store is modelled as two locals inside `drive()` for the same reason:
// zustand v5 cannot be seeded through a server render (FollowUps.test.tsx says
// why), and the one property of the real store that `absorbed()` depends on —
// that a `root/…` focus id and a dimension are stored VERBATIM — is asserted
// against the real module in its own test at the bottom.

import { describe, expect, it, vi } from 'vitest'
import type { FilterState } from '../../lib/entryFilter'
import type { MindtreeUrlView } from '../../lib/mindtree/focus'
import { stageWithTable, type MapLens, type MapStage } from '../../lib/mindtree/lens'
import type { MindDimension } from '../../lib/mindtree/model'
import type { MapLensClaim } from './useMapUrl'

vi.hoisted(() => {
  // store/mindtree reads localStorage at module scope (its store is created
  // from `initialState()`, which reads the persisted prefs) and lib/i18n does
  // the same. Both are import-time, so the shims go in vi.hoisted — a
  // beforeAll() would be far too late.
  const g = globalThis as unknown as Record<string, unknown>
  const mem = new Map<string, string>()
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
})

const { EMPTY_FILTER } = await import('../../lib/entryFilter')
const {
  mapFilterFromParams,
  mapFilterKey,
  mapLensFromParams,
  mapLensMirror,
  mapLensOpensPanel,
  mapMirrorParams,
  mapParamsFor,
  mapParamsForAll,
  mapParamsForFilterWrite,
  mapParamsForLens,
  mapParamsForPortfolio,
  mapPortfolioFromParams,
  mapPortfolioKey,
  mapUrlInbound,
  mapUrlStage,
} = await import('./useMapUrl')

/* ─────────────────────────────── fixtures ────────────────────────────────── */

const TRACK = 'root/track:11111111-2222-3333-4444-555555555555'
const BRANCH = `${TRACK}/group:blocked`

function params(search: string): URLSearchParams {
  return new URLSearchParams(search)
}

function filter(over: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTER, ...over }
}

const NO_VIEW: MindtreeUrlView = { focusId: null, dimension: null }

/* ───────────────────────── the filter, in the URL ────────────────────────── */

describe('mapFilterFromParams', () => {
  it('reads every facet the shared codec writes', () => {
    const read = mapFilterFromParams(
      params('track=t1,t2&status=blocked&priority=critical&tag=vpn&tag=q3&owner=me&mine=1&q=firewall'),
    )
    expect(read.trackIds).toEqual(['t1', 't2'])
    expect(read.statuses).toEqual(['blocked'])
    expect(read.priorities).toEqual(['critical'])
    expect(read.tags).toEqual(['vpn', 'q3'])
    expect(read.owner).toEqual({ kind: 'me' })
    expect(read.mine).toBe(true)
    expect(read.search).toBe('firewall')
  })

  it('drops a value that is not in the closed vocabulary', () => {
    // Hand-edited, or inherited from a screen with a wider vocabulary. Total by
    // construction in filterFromParams; asserted here because the map is now a
    // paste target.
    const read = mapFilterFromParams(params('status=toString&priority=urgent&health=amber'))
    expect(read.statuses).toEqual([])
    expect(read.priorities).toEqual([])
    expect(read.health).toEqual([])
  })

  it('NORMALISES AN INHERITED scope AWAY', () => {
    // useMapModel pins `scope: 'open'` in `applied`, so `?scope=closed` changes
    // nothing about the drawing — but left in `filter` it makes
    // countActiveFacets() report a facet nobody chose, which lights the filter
    // pill and swaps the empty state for "clear the filter" on a map with no
    // control able to clear it.
    expect(mapFilterFromParams(params('scope=closed')).scope).toBe('open')
    expect(mapFilterFromParams(params('scope=all&track=t1')).scope).toBe('open')
  })

  it('KEEPS sort, which the map really does use', () => {
    // model.ts filters through selectEntries first, so ring 3 reads in the sort
    // order and the tail that folds behind "+N more" follows from it.
    expect(mapFilterFromParams(params('sort=due')).sort).toBe('due')
    expect(mapFilterFromParams(params('sort=nonsense')).sort).toBe('activity')
  })
})

describe('mapParamsFor', () => {
  it('writes the facets and the drill-in into ONE params object', () => {
    const out = mapParamsFor(filter({ search: 'vpn', trackIds: ['t1'] }), {
      focusId: BRANCH,
      dimension: 'owner',
    })
    expect(out.get('q')).toBe('vpn')
    expect(out.get('track')).toBe('t1')
    expect(out.get('focus')).toBe(BRANCH)
    expect(out.get('dim')).toBe('owner')
  })

  it('KEEPS THE DRILL-IN WHEN THE FILTER CHANGES', () => {
    // The defect this composition exists to prevent: a filter keystroke that
    // wrote `filterToParams(next)` alone would strip `?focus=` from the link the
    // reader is looking at, and only the mirror effect would put it back — a
    // window in which copying the address bar yields the wrong picture.
    const before = mapParamsFor(filter({ search: 'a' }), { focusId: BRANCH, dimension: 'status' })
    const after = mapParamsFor(filter({ search: 'ab' }), { focusId: BRANCH, dimension: 'status' })
    expect(after.get('focus')).toBe(BRANCH)
    expect(after.get('dim')).toBe('status')
    expect(before.get('q')).toBe('a')
    expect(after.get('q')).toBe('ab')
  })

  it('leaves a neutral filter on an unfocused map with a clean URL', () => {
    expect(mapParamsFor(filter(), NO_VIEW).toString()).toBe('')
  })

  it('round-trips a filter it wrote', () => {
    const rich = filter({
      trackIds: ['t1', 't2'],
      groupIds: ['g1'],
      statuses: ['blocked', 'waiting_on'],
      priorities: ['critical'],
      types: ['issue'],
      owner: { kind: 'name', name: 'Ali Hassan' },
      tags: ['vpn', 'q3'],
      health: ['overdue'],
      search: 'firewall',
      mine: true,
      from: '2026-07-01',
      to: '2026-07-31',
      sort: 'due',
    })
    expect(mapFilterFromParams(mapParamsFor(rich, { focusId: BRANCH, dimension: 'owner' }))).toEqual(
      rich,
    )
  })

  it('clears a stale scope out of the URL the first time a facet is touched', () => {
    const read = mapFilterFromParams(params('scope=closed&q=vpn'))
    expect(mapParamsFor(read, NO_VIEW).has('scope')).toBe(false)
  })
})

describe('mapFilterKey', () => {
  // The key is what `useMapUrlFilter` memoises the FilterState on, and the memo
  // is what stops `buildMindtree` — the most expensive thing on this screen —
  // re-running on a write that touched no facet. Every param the two effects
  // write is such a write, and they write on every drill-in and every chip.
  it('IGNORES EVERY PARAM THAT IS NOT A FACET', () => {
    const a = mapFilterKey(params(`q=vpn&focus=${BRANCH}&dim=owner&lens=needs-me`))
    const b = mapFilterKey(params(`q=vpn&focus=${TRACK}&dim=status&lens=numbers&stage=numbers`))
    expect(a).toBe(b)
  })

  it('is the same for two URLs that mean the same filter', () => {
    // A hostile or inherited param means nothing, and `?scope=` is normalised
    // away — so neither may mint a second FilterState object.
    expect(mapFilterKey(params('q=vpn&scope=closed'))).toBe(mapFilterKey(params('q=vpn')))
    expect(mapFilterKey(params('status=toString'))).toBe(mapFilterKey(params('')))
  })

  it('changes the moment a facet does', () => {
    expect(mapFilterKey(params('q=vpn'))).not.toBe(mapFilterKey(params('q=vp')))
    expect(mapFilterKey(params(''))).not.toBe(mapFilterKey(params('mine=1')))
  })

  it('is a lossless round trip, which is what the second parse rests on', () => {
    // useMapUrlFilter parses the params, encodes the key, and parses THAT. The
    // filter a reader sees is therefore the key's reading, and it has to be the
    // same reading.
    const rich = params('track=t1,t2&status=blocked&tag=vpn&tag=q3&owner=me&mine=1&q=firewall&sort=due')
    expect(mapFilterFromParams(new URLSearchParams(mapFilterKey(rich)))).toEqual(
      mapFilterFromParams(rich),
    )
  })
})

describe('mapParamsForAll', () => {
  it('KEEPS THE LENS WHEN THE FILTER CHANGES', () => {
    // The regression the composition exists to prevent, and it is worse than a
    // wrong link: `filterToParams` builds a FRESH params object, so a keystroke
    // that wrote the facets alone would strip `?lens=` — and the inbound effect
    // would then read the lens-less URL it had just written.
    const out = mapParamsForAll(
      filter({ search: 'vpn' }),
      { focusId: BRANCH, dimension: 'owner' },
      { lens: 'numbers', stage: 'numbers' },
    )
    expect(out.get('q')).toBe('vpn')
    expect(out.get('focus')).toBe(BRANCH)
    expect(out.get('dim')).toBe('owner')
    expect(out.get('lens')).toBe('numbers')
  })

  it('spells out the ledger, and drops a stage the lens implies', () => {
    expect(
      mapParamsForAll(filter(), NO_VIEW, { lens: 'shape', stage: 'table' }).get('stage'),
    ).toBe('table')
    expect(
      mapParamsForAll(filter(), NO_VIEW, { lens: 'shape', stage: 'map' }).has('stage'),
    ).toBe(false)
  })

  it('still drops an inherited scope', () => {
    const read = mapFilterFromParams(params('scope=closed&q=vpn'))
    const out = mapParamsForAll(read, NO_VIEW, { lens: 'needs-me', stage: 'map' })
    expect(out.has('scope')).toBe(false)
    expect(out.get('lens')).toBe('needs-me')
  })
})

/* ──────────────────────────── the two decisions ──────────────────────────── */

describe('mapUrlInbound', () => {
  it('is null when the URL has no opinion about the view', () => {
    // Not the same answer as "show the whole map": a reader arriving from the
    // nav bar keeps the drill-in they left yesterday.
    expect(mapUrlInbound(params(''))).toBeNull()
    expect(mapUrlInbound(params('q=vpn&track=t1'))).toBeNull()
  })

  it('is null for a focus id that is not shaped like a node id', () => {
    expect(mapUrlInbound(params('focus=' + encodeURIComponent('../../etc')))).toBeNull()
    expect(mapUrlInbound(params('dim=sideways'))).toBeNull()
  })

  it('carries whichever half the link actually holds', () => {
    expect(mapUrlInbound(params(`focus=${BRANCH}`))).toEqual({ focusId: BRANCH, dimension: null })
    expect(mapUrlInbound(params('dim=owner'))).toEqual({ focusId: null, dimension: 'owner' })
  })
})

describe('mapMirrorParams', () => {
  const view = (focusId: string | null, dimension: MindDimension): MindtreeUrlView => ({
    focusId,
    dimension,
  })

  it('does nothing when the URL already says what the store says', () => {
    expect(mapMirrorParams(params(`focus=${BRANCH}&dim=status`), view(BRANCH, 'status'), null)).toBeNull()
  })

  it('writes the store back when the URL is silent', () => {
    const next = mapMirrorParams(params('q=vpn'), view(TRACK, 'owner'), null)
    expect(next?.get('focus')).toBe(TRACK)
    expect(next?.get('dim')).toBe('owner')
    expect(next?.get('q')).toBe('vpn')
  })

  it('STRIPS ?focus= WHEN THE READER LEAVES THE BRANCH', () => {
    // Escape, or the trail back to the root. The claim must not wedge this
    // shut, or a link copied afterwards would still point at a branch the
    // sender is no longer looking at.
    const next = mapMirrorParams(params(`focus=${BRANCH}&dim=status&q=vpn`), view(null, 'status'), null)
    expect(next?.has('focus')).toBe(false)
    expect(next?.get('q')).toBe('vpn')
  })

  it('refuses to write over a claim the store has not absorbed', () => {
    // The stale-closure pass: the inbound effect has just handed the store
    // BRANCH, and `view` is the reading of the store from the render BEFORE
    // that write. Writing it would delete the pasted link.
    const claim = view(BRANCH, 'owner')
    expect(mapMirrorParams(params(`focus=${BRANCH}&dim=owner`), view(null, 'status'), claim)).toBeNull()
  })

  it('lets the write through once the store has caught up', () => {
    const claim = view(BRANCH, 'owner')
    expect(mapMirrorParams(params('q=vpn'), view(BRANCH, 'owner'), claim)?.get('focus')).toBe(BRANCH)
  })

  it('does not let a claim block a field it never claimed', () => {
    // `?dim=owner` with no `?focus=` says nothing about the drill-in, so the
    // reader's own focus must still reach the URL in the same pass.
    const claim: MindtreeUrlView = { focusId: null, dimension: 'owner' }
    const next = mapMirrorParams(params('dim=owner'), view(TRACK, 'owner'), claim)
    expect(next?.get('focus')).toBe(TRACK)
  })
})

/* ─────────────────────────── the lens, in the URL ─────────────────────────── */

describe('mapLensFromParams', () => {
  it('is null when the URL has no opinion about the lens', () => {
    // Not the same answer as "take the default": a reader who prefers `shape`
    // keeps it when they open the app from the nav bar. DEFAULT_LENS applies
    // only when nothing is persisted either.
    expect(mapLensFromParams(params(''))).toBeNull()
    expect(mapLensFromParams(params('q=vpn&focus=' + TRACK))).toBeNull()
  })

  it('is null for a lens that is not one of the five', () => {
    expect(mapLensFromParams(params('lens=needsme'))).toBeNull()
    expect(mapLensFromParams(params('lens=toString'))).toBeNull()
    // A stage with no lens beside it names no chip, so there is nothing honest
    // to show — the mirror never writes one without the other.
    expect(mapLensFromParams(params('stage=board'))).toBeNull()
  })

  it('resolves the stage the lens implies when the URL is silent about it', () => {
    expect(mapLensFromParams(params('lens=needs-me'))).toEqual({ lens: 'needs-me', stage: 'map' })
    expect(mapLensFromParams(params('lens=by-status'))).toEqual({
      lens: 'by-status',
      stage: 'board',
    })
    expect(mapLensFromParams(params('lens=numbers'))).toEqual({ lens: 'numbers', stage: 'numbers' })
  })

  it('carries the ledger, which is the one stage a lens does not imply', () => {
    expect(mapLensFromParams(params('lens=shape&stage=table'))).toEqual({
      lens: 'shape',
      stage: 'table',
    })
  })

  it('NORMALISES A STAGE THIS LENS CANNOT SHOW', () => {
    // Hand-edited, or inherited from a link written under another lens. Obeying
    // it would draw a board with no chip lit and no control able to explain it.
    expect(mapLensFromParams(params('lens=shape&stage=numbers'))?.stage).toBe('map')
    expect(mapLensFromParams(params('lens=by-status&stage=table'))?.stage).toBe('board')
    expect(mapLensFromParams(params('lens=numbers&stage=sideways'))?.stage).toBe('numbers')
  })
})

describe('mapUrlStage', () => {
  // The narrower question, and the only one `setMindView` may be asked. A stage
  // RESOLVED from a lens is an inference; obeying it turned the ledger back into
  // the map for every reader who followed a bare `?lens=` link.
  it('IS NULL WHEN THE LINK SPELLED OUT NO STAGE', () => {
    expect(mapUrlStage(params('lens=needs-me'))).toBeNull()
    expect(mapUrlStage(params('lens=shape'))).toBeNull()
    expect(mapUrlStage(params('lens=by-status'))).toBeNull()
    // …even though `mapLensFromParams` resolves one for each of them, because
    // the pair is written as a pair and a chip has to light.
    expect(mapLensFromParams(params('lens=needs-me'))?.stage).toBe('map')
  })

  it('is null when there is no lens to normalise the stage against', () => {
    expect(mapUrlStage(params('stage=table'))).toBeNull()
    expect(mapUrlStage(params('lens=nonsense&stage=table'))).toBeNull()
  })

  it('is null for a stage this lens cannot show', () => {
    // Hand-edited, or inherited from a link written under another lens.
    expect(mapUrlStage(params('lens=shape&stage=numbers'))).toBeNull()
    expect(mapUrlStage(params('lens=by-status&stage=table'))).toBeNull()
  })

  it('carries a stage the link really did spell out', () => {
    expect(mapUrlStage(params('lens=shape&stage=table'))).toBe('table')
    expect(mapUrlStage(params('lens=needs-me&stage=map'))).toBe('map')
    expect(mapUrlStage(params('lens=by-status&stage=board'))).toBe('board')
  })
})

describe('mapLensOpensPanel', () => {
  it('is true for the three lenses whose panel is the point of them', () => {
    expect(mapLensOpensPanel('needs-me', null)).toBe(true)
    expect(mapLensOpensPanel('what-changed', null)).toBe(true)
    expect(mapLensOpensPanel('numbers', null)).toBe(true)
  })

  it('is false where there would be no panel to show', () => {
    // The board has no panel at all, and `shape` has one only once something is
    // focused — forcing `panelOpen` for either would flip a persisted preference
    // to describe a dock the shell does not render.
    expect(mapLensOpensPanel('by-status', null)).toBe(false)
    expect(mapLensOpensPanel('by-status', BRANCH)).toBe(false)
    expect(mapLensOpensPanel('shape', null)).toBe(false)
    expect(mapLensOpensPanel('shape', BRANCH)).toBe(true)
  })
})

describe('mapParamsForLens', () => {
  it('writes the lens beside whatever else the link carries', () => {
    const out = mapParamsForLens(params(`q=vpn&focus=${BRANCH}`), {
      lens: 'what-changed',
      stage: 'map',
    })
    expect(out.get('lens')).toBe('what-changed')
    expect(out.get('q')).toBe('vpn')
    expect(out.get('focus')).toBe(BRANCH)
  })

  it('spells out the stage only when it disagrees with the lens', () => {
    expect(mapParamsForLens(params(''), { lens: 'shape', stage: 'map' }).has('stage')).toBe(false)
    expect(mapParamsForLens(params(''), { lens: 'numbers', stage: 'numbers' }).has('stage')).toBe(
      false,
    )
    expect(mapParamsForLens(params(''), { lens: 'shape', stage: 'table' }).get('stage')).toBe(
      'table',
    )
  })

  it('clears a stage that the new lens implies anyway', () => {
    // Leaving `stage=table` behind after a switch to the board would make the
    // next reader of the link land somewhere the sender never was.
    const stale = params('lens=shape&stage=table')
    expect(mapParamsForLens(stale, { lens: 'by-status', stage: 'board' }).has('stage')).toBe(false)
  })

  it('round-trips every pair it writes', () => {
    for (const v of [
      { lens: 'needs-me', stage: 'map' },
      { lens: 'shape', stage: 'table' },
      { lens: 'by-status', stage: 'board' },
      { lens: 'what-changed', stage: 'map' },
      { lens: 'numbers', stage: 'numbers' },
    ] as const) {
      expect(mapLensFromParams(mapParamsForLens(params('q=vpn'), v)), v.lens).toEqual(v)
    }
  })
})

describe('mapLensMirror', () => {
  it('does nothing when the URL already says what the store says', () => {
    expect(mapLensMirror(params('lens=shape'), { lens: 'shape', stage: 'map' }, null)).toBeNull()
    expect(
      mapLensMirror(params('lens=shape&stage=table'), { lens: 'shape', stage: 'table' }, null),
    ).toBeNull()
  })

  it('writes the store back when the URL is silent', () => {
    const next = mapLensMirror(params('q=vpn'), { lens: 'numbers', stage: 'numbers' }, null)
    expect(next?.get('lens')).toBe('numbers')
    expect(next?.get('q')).toBe('vpn')
  })

  it('refuses to write over a claim the store has not absorbed', () => {
    // The stale-closure pass: the inbound effect has just handed the store the
    // pasted lens, and `live` is the reading from the render BEFORE that write.
    const claim = { lens: 'what-changed', stage: 'map' } as const
    expect(
      mapLensMirror(params('lens=what-changed'), { lens: 'needs-me', stage: 'map' }, claim),
    ).toBeNull()
  })

  it('lets the write through once the store has caught up', () => {
    const claim = { lens: 'what-changed', stage: 'map' } as const
    expect(
      mapLensMirror(params('q=vpn'), { lens: 'what-changed', stage: 'map' }, claim)?.get('lens'),
    ).toBe('what-changed')
  })

  it('DOES NOT HOLD THE MIRROR SHUT OVER A STAGE THE LINK NEVER CLAIMED', () => {
    // `?lens=needs-me` says nothing about the stage, so the reader keeps the
    // ledger they were on — and the URL has to say so in the SAME pass, or the
    // address bar describes a map while a table is on the screen. `absorbed()`'s
    // rule (compare only what was claimed), for the other pair.
    const claim = { lens: 'needs-me', stage: null } as const
    const next = mapLensMirror(params('lens=needs-me'), { lens: 'needs-me', stage: 'table' }, claim)
    expect(next?.get('stage')).toBe('table')
  })

  it('still holds it shut over a lens the store has not absorbed', () => {
    const claim = { lens: 'needs-me', stage: null } as const
    expect(mapLensMirror(params('lens=needs-me'), { lens: 'shape', stage: 'map' }, claim)).toBeNull()
  })
})

/* ─────────────────── the portfolio's two controls, in the URL ────────────── */
//
// URL-ONLY STATE, so there is no store to claim against and no third effect —
// which is precisely why these have to be proven as PURE FUNCTIONS here. The
// property that matters is not "the value round-trips" but "no other writer on
// this screen can drop them", and the last two cases are that property.

describe('mapPortfolioFromParams', () => {
  it('lands on the stalled list when the URL says nothing — budget E1', () => {
    // ZERO INTERACTIONS AFTER OPEN. If this ever answers anything else, the
    // morning question costs a tap and the chip stops being the answer.
    expect(mapPortfolioFromParams(params(''))).toEqual({ by: 'stage', risk: true })
    expect(mapPortfolioFromParams(params('lens=portfolio'))).toEqual({ by: 'stage', risk: true })
  })

  it('reads each grouping the palette can link to', () => {
    expect(mapPortfolioFromParams(params('by=manager&risk=0')).by).toBe('manager')
    expect(mapPortfolioFromParams(params('by=vendor')).by).toBe('vendor')
    expect(mapPortfolioFromParams(params('by=phase')).by).toBe('phase')
  })

  it('is total over hostile input, and falls to the DEFAULT rather than to off', () => {
    // `Boolean('0')` is true and `'false'` is an ordinary string: a loose read
    // turns a hand-edited param into the opposite of what it says. And a mangled
    // link must land the reader on the morning answer, not on 400 unfiltered
    // rows.
    for (const bad of ['', 'Stage', 'stages', 'owner', 'toString', '__proto__']) {
      expect(mapPortfolioFromParams(params(`by=${bad}`)).by, bad).toBe('stage')
    }
    for (const bad of ['', 'true', 'false', 'yes', '2', '-1', 'toString']) {
      expect(mapPortfolioFromParams(params(`risk=${bad}`)).risk, bad).toBe(true)
    }
    expect(mapPortfolioFromParams(params('risk=0')).risk).toBe(false)
    expect(mapPortfolioFromParams(params('risk=1')).risk).toBe(true)
  })
})

describe('mapParamsForPortfolio', () => {
  it('never spells out a default, and always spells out an opinion', () => {
    // `mapParamsForLens`'s rule for `?stage=`, applied to both controls: the
    // default state IS the chip's own state, so writing it would put two
    // redundant params in front of every reader.
    expect(mapParamsForPortfolio(params(''), { by: 'stage', risk: true }).toString()).toBe('')
    expect(mapParamsForPortfolio(params(''), { by: 'manager', risk: true }).toString()).toBe(
      'by=manager',
    )
    expect(mapParamsForPortfolio(params(''), { by: 'stage', risk: false }).toString()).toBe('risk=0')
    const both = mapParamsForPortfolio(params(''), { by: 'vendor', risk: false })
    expect(both.get('by')).toBe('vendor')
    expect(both.get('risk')).toBe('0')
  })

  it('clears a param that has gone back to its default', () => {
    // The reader taps Vendors, then taps Stage again. Leaving `by=vendor` on the
    // URL would hand the next person to open the link a view the sender is not
    // looking at.
    const back = mapParamsForPortfolio(params('by=vendor&risk=0'), { by: 'stage', risk: true })
    expect(back.has('by')).toBe(false)
    expect(back.has('risk')).toBe(false)
  })

  it('carries every other param through — one write, the whole address bar', () => {
    // The setter starts from `prev`, so a chip tap must not cost the reader
    // their filter, their drill-in or their lens (budget E9).
    const next = mapParamsForPortfolio(
      params('lens=portfolio&focus=root%2Ftrack%3Ax&dim=owner&q=vpn'),
      { by: 'manager', risk: false },
    )
    expect(next.get('lens')).toBe('portfolio')
    expect(next.get('focus')).toBe('root/track:x')
    expect(next.get('dim')).toBe('owner')
    expect(next.get('q')).toBe('vpn')
  })

  it('round-trips every combination through the reader', () => {
    for (const by of ['stage', 'manager', 'vendor', 'phase'] as const) {
      for (const risk of [true, false]) {
        const v = { by, risk }
        expect(mapPortfolioFromParams(mapParamsForPortfolio(params('q=a'), v)), `${by}/${risk}`)
          .toEqual(v)
      }
    }
  })
})

describe('mapPortfolioKey', () => {
  it('gives two URLs that mean the same view the same key', () => {
    // The memo key downstream of this is a fold over ~400 organizations. Keyed
    // on `params` it would re-run on every keystroke and every drill-in; keyed
    // on this it survives every write that touched neither control.
    expect(mapPortfolioKey(params('by=stage&risk=1&q=vpn'))).toBe(mapPortfolioKey(params('q=other')))
    expect(mapPortfolioKey(params('by=manager&q=a'))).toBe(mapPortfolioKey(params('by=manager')))
    expect(mapPortfolioKey(params('by=manager'))).not.toBe(mapPortfolioKey(params('by=vendor')))
    expect(mapPortfolioKey(params('risk=0'))).not.toBe(mapPortfolioKey(params('')))
  })
})

describe('the writers that could drop the portfolio, and do not', () => {
  it('the drill-in mirror carries ?by= and ?risk= through untouched', () => {
    // `viewToParams` copies the params it is handed. If that ever changes, a
    // reader who drills into a branch loses the grouping they were reading — and
    // this is the only place that would say so.
    const next = mapMirrorParams(params('by=vendor&risk=0'), { focusId: BRANCH, dimension: null }, null)
    expect(next?.get('by')).toBe('vendor')
    expect(next?.get('risk')).toBe('0')
    expect(next?.get('focus')).toBe(BRANCH)
  })

  it('the lens mirror carries them too', () => {
    const next = mapLensMirror(params('by=phase&risk=0'), { lens: 'portfolio', stage: 'portfolio' }, null)
    expect(next?.get('by')).toBe('phase')
    expect(next?.get('risk')).toBe('0')
    expect(next?.get('lens')).toBe('portfolio')
  })

  it('⚠ mapParamsForAll DOES drop them — which is why the filter writer is its own function', () => {
    // THE NEGATIVE CONTROL, AND IT IS THE POINT OF THE WHOLE SECTION.
    // `filterToParams` builds a FRESH object (that is what clears an inherited
    // `?scope=`), so the composed writer cannot preserve anything it was not
    // given. Asserted so that the fix below cannot be "tidied" into a call to
    // this function on the grounds that it looks like the same thing.
    const dropped = mapParamsForAll(filter({ search: 'vpn' }), NO_VIEW, {
      lens: 'portfolio',
      stage: 'portfolio',
    })
    expect(dropped.has('by')).toBe(false)
    expect(dropped.has('risk')).toBe(false)
  })

  it('the filter writer carries the portfolio through a keystroke', () => {
    // THE ONE THAT WOULD ACTUALLY BE SEEN: a reader is on the vendor cohorts,
    // types one character into the search box, and the row set changes under
    // them. `useMapUrlFilter` calls exactly this, with `setParams`'s `prev`.
    const out = mapParamsForFilterWrite(
      params('lens=portfolio&by=vendor&risk=0&q=v'),
      filter({ search: 'vpn' }),
      { focusId: BRANCH, dimension: 'owner' },
      { lens: 'portfolio', stage: 'portfolio' },
    )
    expect(out.get('by')).toBe('vendor')
    expect(out.get('risk')).toBe('0')
    // …and everything the three store-backed codecs own is still written.
    expect(out.get('q')).toBe('vpn')
    expect(out.get('lens')).toBe('portfolio')
    expect(out.get('focus')).toBe(BRANCH)
    expect(out.get('dim')).toBe('owner')
    // A reader on the DEFAULT view keeps writing the default view: no params
    // appear that the reader did not ask for.
    const plain = mapParamsForFilterWrite(params('lens=portfolio'), filter({ search: 'a' }), NO_VIEW, {
      lens: 'portfolio',
      stage: 'portfolio',
    })
    expect(plain.has('by')).toBe(false)
    expect(plain.has('risk')).toBe(false)
  })
})

/* ────────────────────── the cold load, which is the point ─────────────────── */

interface Store {
  focusId: string | null
  dimension: MindDimension
  /**
   * ABSENT IN EVERY CASE THAT PREDATES THE LENS, and `drive()` then leaves the
   * two lens params alone entirely. Those cases assert the drill-in half of the
   * mirror, which is a separate concern with its own claim; making them carry a
   * lens would have them assert a `?lens=` write they were never about.
   */
  lens?: MapLens
  /** The reader's map⇄table preference — the other half of the derived stage. */
  table?: boolean
  /**
   * The dock. ABSENT means "this case predates the panel rule and does not
   * assert it"; `drive()` still records what the rule WOULD have done, so a case
   * that opts in reads the same field.
   */
  panelOpen?: boolean
}

interface Run {
  /** Every distinct URL the pair produced, first entry = what was pasted. */
  urls: string[]
  store: Store
  params: URLSearchParams
  /** False when the two effects were still writing after `limit` passes. */
  settled: boolean
}

/**
 * Replay `useMapUrl`'s two effects the way React runs them.
 *
 * THE ONE THING IT MODELS THAT A NAIVE LOOP WOULD NOT: `rendered` is snapshotted
 * BEFORE the inbound effect runs, because an effect closes over the values of
 * the render that scheduled it and a store write from the effect above lands in
 * the NEXT render. That single line of staleness is the entire defect this unit
 * fixes.
 *
 * Dependency arrays are honoured too — the inbound effect re-runs on `params`
 * alone, the outbound on params + the two store values — because "which effect
 * is even due this pass" is half of whether the pair converges.
 *
 * `claims: false` disables the claim, which is how the tests below show the
 * guard is load bearing rather than decorative.
 *
 * `settle` models useMapFocus's RECONCILER: the store does not have to keep the
 * id the URL asked for. A link to a branch that no longer exists is repaired to
 * its surviving ancestor, so what the store ends up holding is a function of the
 * claim rather than the claim itself. Without this the harness wrote the URL's
 * id straight into the store, which quietly made the settles-differently case
 * untestable — the store always agreed, so the one scenario the claim exists to
 * survive never actually occurred.
 *
 * `acts` models THE READER, once the screen is quiet: each one is applied when
 * the pair has settled, may edit the store (closing the dock) and may put new
 * params in the address bar (a keystroke in the search box, which now writes the
 * URL). It exists because a second `drive()` cannot express this — a second
 * drive re-arms the inbound effect, and that is a REMOUNT rather than a reader
 * doing something on a screen that is already up. Half of the panel rule is
 * about exactly that difference.
 */
function drive(
  start: URLSearchParams,
  store: Store,
  opts: {
    claims?: boolean
    limit?: number
    settle?: (id: string) => string
    acts?: readonly ((store: Store) => URLSearchParams | null)[]
  } = {},
): Run {
  const claims = opts.claims ?? true
  const limit = opts.limit ?? 24
  const settle = opts.settle ?? ((id: string): string => id)
  const acts = [...(opts.acts ?? [])]
  let current = start
  let claim: MindtreeUrlView | null = null
  let lensClaim: MapLensClaim | null = null
  /** The hook's `arrived` ref: has the inbound effect run at all yet? */
  let arrived = false
  let ranInboundOn: URLSearchParams | null = null
  let ranOutboundOn: { params: URLSearchParams; store: Store } | null = null
  const urls = [current.toString()]

  /** The store's derived stage, exactly as the hook derives it. */
  const stageOf = (s: Store): MapStage | null =>
    s.lens === undefined ? null : stageWithTable(s.lens, s.table === true)

  for (let pass = 0; pass < limit; pass++) {
    const rendered: Store = {
      focusId: store.focusId,
      dimension: store.dimension,
      lens: store.lens,
      table: store.table,
      panelOpen: store.panelOpen,
    }

    const inboundDue = ranInboundOn !== current
    const outboundDue =
      ranOutboundOn === null ||
      ranOutboundOn.params !== current ||
      ranOutboundOn.store.focusId !== rendered.focusId ||
      ranOutboundOn.store.dimension !== rendered.dimension ||
      ranOutboundOn.store.lens !== rendered.lens ||
      ranOutboundOn.store.table !== rendered.table

    if (!inboundDue && !outboundDue) {
      // Quiet. If the reader has something left to do, they do it here — and
      // the loop carries on with whatever they left behind.
      const act = acts.shift()
      if (act === undefined) return { urls, store, params: current, settled: true }
      const next = act(store)
      if (next !== null && next.toString() !== current.toString()) {
        current = next
        urls.push(current.toString())
      }
      continue
    }

    if (inboundDue) {
      ranInboundOn = current
      const url = mapUrlInbound(current)
      // The lens half runs FIRST in the hook, and it runs even when the view
      // half has nothing to say — the two are independent opinions.
      const wanted = store.lens === undefined ? null : mapLensFromParams(current)
      if (wanted !== null) {
        store.lens = wanted.lens
        // THE STAGE ONLY MOVES WHEN THE LINK SPELLED ONE OUT — `mapUrlStage`,
        // not `wanted.stage`, which is an inference.
        const spelled = mapUrlStage(current)
        if (spelled === 'table' || spelled === 'map') store.table = spelled === 'table'
        // THE PANEL OPENS FOR AN ARRIVING LENS, and `rendered.lens` is the
        // staleness that makes "arriving" mean anything: it is the lens as of
        // the render that scheduled this pass, so the session's own mirror
        // coming back around is not an arrival.
        if (
          (!arrived || wanted.lens !== rendered.lens) &&
          mapLensOpensPanel(wanted.lens, url?.focusId ?? rendered.focusId)
        ) {
          store.panelOpen = true
        }
        lensClaim = { lens: wanted.lens, stage: spelled }
      }
      arrived = true
      if (url !== null) {
        if (url.dimension !== null) store.dimension = url.dimension
        if (url.focusId !== null) store.focusId = settle(url.focusId)
        claim = url
      }
    }

    if (outboundDue) {
      ranOutboundOn = { params: current, store: rendered }
      const outstanding = claim
      claim = null
      const lensOutstanding = lensClaim
      lensClaim = null
      const view = mapMirrorParams(current, rendered, claims ? outstanding : null)
      const base = view ?? current
      const stage = stageOf(rendered)
      const next =
        rendered.lens === undefined || stage === null
          ? base
          : (mapLensMirror(
              base,
              { lens: rendered.lens, stage },
              claims ? lensOutstanding : null,
            ) ?? base)
      if (next.toString() !== current.toString()) {
        current = next
        urls.push(current.toString())
      }
    }
  }
  return { urls, store, params: current, settled: false }
}

describe('a pasted deep link, on a cold load', () => {
  it('SURVIVES AN EMPTY STORE AND IS NEVER REWRITTEN', () => {
    // The whole unit, in one assertion. Nothing is persisted (`focusId: null`)
    // and the persisted dimension disagrees with the link's, which is the
    // ordinary case when a link is shared: the recipient has their own habits.
    const pasted = params(`focus=${BRANCH}&dim=owner&q=vpn&health=overdue`)
    const run = drive(pasted, { focusId: null, dimension: 'status' })

    expect(run.settled).toBe(true)
    // Not merely "focus is still there at the end" — the URL was NEVER written,
    // so there is no frame in which a reload or a copy would lose the link.
    expect(run.urls).toEqual([pasted.toString()])
    expect(run.store.focusId).toBe(BRANCH)
    expect(run.store.dimension).toBe('owner')
    // …and the filter half of the same link arrives with it.
    const landed = mapFilterFromParams(run.params)
    expect(landed.search).toBe('vpn')
    expect(landed.health).toEqual(['overdue'])
  })

  it('WITHOUT THE CLAIM the same link is stripped and the pair never settles', () => {
    // This is what the extracted pair did, and it is why the claim exists. The
    // first mirror runs on a render that predates the inbound write, so it
    // deletes `?focus=` and writes the reader's own dimension back — after
    // which the two writers are permanently one render out of phase and
    // alternate forever. A live infinite render loop, on the one case the
    // feature was built for.
    const pasted = params(`focus=${BRANCH}&dim=owner&q=vpn`)
    const run = drive(pasted, { focusId: null, dimension: 'status' }, { claims: false })

    expect(run.settled).toBe(false)
    expect(run.urls.length).toBeGreaterThan(1)
    expect(new URLSearchParams(run.urls[1]).has('focus')).toBe(false)
    expect(new URLSearchParams(run.urls[1]).get('dim')).toBe('status')
  })

  it('a link that only carries a dimension still settles, and keeps the filter', () => {
    const pasted = params('dim=health&q=vpn')
    const run = drive(pasted, { focusId: null, dimension: 'status' })
    expect(run.settled).toBe(true)
    expect(run.urls).toEqual([pasted.toString()])
    expect(run.store.dimension).toBe('health')
    expect(mapFilterFromParams(run.params).search).toBe('vpn')
  })

  it('a link with no opinion seeds the URL from the store instead', () => {
    // Arriving from the nav bar with yesterday's drill-in persisted. The mirror
    // writes once, and then stops.
    const run = drive(params('q=vpn'), { focusId: TRACK, dimension: 'owner' })
    expect(run.settled).toBe(true)
    expect(run.urls.length).toBe(2)
    expect(run.params.get('focus')).toBe(TRACK)
    expect(run.params.get('dim')).toBe('owner')
    expect(run.params.get('q')).toBe('vpn')
  })

  it('a link the store already agrees with is not written at all', () => {
    const pasted = params(`focus=${TRACK}&dim=owner`)
    const run = drive(pasted, { focusId: TRACK, dimension: 'owner' })
    expect(run.settled).toBe(true)
    expect(run.urls).toEqual([pasted.toString()])
  })

  it('A PASTED LENS SURVIVES A STORE THAT PREFERS ANOTHER ONE', () => {
    // The ordinary shared-link case: the sender was reading the activity record,
    // the recipient's persisted lens is the map's shape. Nothing may be written,
    // because a write in the first frame is a reload or a copy that loses it.
    const pasted = params(`lens=what-changed&focus=${TRACK}&dim=owner`)
    const run = drive(pasted, { focusId: null, dimension: 'status', lens: 'shape' })

    expect(run.settled).toBe(true)
    expect(run.urls).toEqual([pasted.toString()])
    expect(run.store.lens).toBe('what-changed')
    expect(run.store.focusId).toBe(TRACK)
    expect(run.store.dimension).toBe('owner')
  })

  it('a link carrying only a lens still settles, and keeps the drill-in half', () => {
    // The two claims are independent: the lens claim must not hold the
    // drill-in's mirror shut for a pass, or every chip costs a wasted replace.
    const run = drive(params('lens=numbers'), {
      focusId: TRACK,
      dimension: 'owner',
      lens: 'shape',
    })
    expect(run.settled).toBe(true)
    expect(run.store.lens).toBe('numbers')
    expect(run.params.get('lens')).toBe('numbers')
    // …and the reader's own drill-in reached the URL in the same pass.
    expect(run.params.get('focus')).toBe(TRACK)
    expect(run.params.get('dim')).toBe('owner')
  })

  it('seeds the lens from the store when the link says nothing', () => {
    const run = drive(params('q=vpn'), { focusId: null, dimension: 'status', lens: 'by-status' })
    expect(run.settled).toBe(true)
    expect(run.params.get('lens')).toBe('by-status')
    expect(run.params.has('stage')).toBe(false)
    expect(run.params.get('q')).toBe('vpn')
  })

  it('carries the ledger through the round trip and settles', () => {
    const pasted = params('lens=shape&stage=table')
    const run = drive(pasted, { focusId: null, dimension: 'status', lens: 'needs-me', table: false })
    expect(run.settled).toBe(true)
    expect(run.store.lens).toBe('shape')
    expect(run.store.table).toBe(true)
    // The link said nothing about the dimension, so the mirror seeds that one
    // from the store — the pre-existing rule. What matters here is that the two
    // lens params it DID carry come out the other side untouched.
    expect(run.params.get('lens')).toBe('shape')
    expect(run.params.get('stage')).toBe('table')
  })

  it('A NORMALISED STAGE IS CORRECTED IN THE URL, IN ONE PASS', () => {
    // `?stage=numbers` under `?lens=shape` is the settles-differently case for
    // the lens pair: the store cannot hold what the link asked for, so the claim
    // must not wedge the mirror shut — the URL has to end up describing what is
    // actually drawn.
    const run = drive(params('lens=shape&stage=numbers'), {
      focusId: null,
      dimension: 'status',
      lens: 'needs-me',
    })
    expect(run.settled).toBe(true)
    expect(run.store.lens).toBe('shape')
    expect(run.params.get('lens')).toBe('shape')
    expect(run.params.has('stage')).toBe(false)
  })

  it('A BARE ?lens= DOES NOT TAKE THE LEDGER AWAY', () => {
    // The reader is on the table — the accessible, drag-free, low-motion reading
    // of the same tree — and follows an attention link. The link says nothing
    // about how the tree is drawn, so it does not get to decide: `?lens=` sets
    // the lens and the ledger survives. It used to be silently overwritten,
    // because `mapLensFromParams` RESOLVES `stage: 'map'` for a lens that
    // spelled out nothing.
    const run = drive(params('lens=needs-me'), {
      focusId: null,
      dimension: 'status',
      lens: 'shape',
      table: true,
    })
    expect(run.settled).toBe(true)
    expect(run.store.lens).toBe('needs-me')
    expect(run.store.table).toBe(true)
    // …and the URL then SAYS the stage it did not arrive with, because the
    // address bar has to describe what is on the screen.
    expect(run.params.get('lens')).toBe('needs-me')
    expect(run.params.get('stage')).toBe('table')
  })

  it('a link that DOES spell out a stage still moves the reader to it', () => {
    // The other half of the same rule: an inference is refused, an instruction
    // is obeyed.
    const run = drive(params('lens=needs-me&stage=map'), {
      focusId: null,
      dimension: 'status',
      lens: 'shape',
      table: true,
    })
    expect(run.settled).toBe(true)
    expect(run.store.table).toBe(false)
    expect(run.params.has('stage')).toBe(false)
  })

  it('AN ARRIVING LENS OPENS ITS PANEL', () => {
    // "See all" on the bell, the Settings › Notifications row, and all five
    // palette rows are this URL. They used to set the lens and leave the dock
    // shut, so the link named a destination that never appeared.
    const run = drive(params('lens=what-changed'), {
      focusId: null,
      dimension: 'status',
      lens: 'shape',
      panelOpen: false,
    })
    expect(run.settled).toBe(true)
    expect(run.store.lens).toBe('what-changed')
    expect(run.store.panelOpen).toBe(true)
  })

  it('opens it even when the recipient was already on that lens', () => {
    // The commonest case of all — the reader lives on `needs-me`, closed the
    // dock to look at the picture, and now follows a link to the list. A rule
    // that only opened on a CHANGE of lens would do nothing here.
    const run = drive(params('lens=needs-me'), {
      focusId: null,
      dimension: 'status',
      lens: 'needs-me',
      panelOpen: false,
    })
    expect(run.store.panelOpen).toBe(true)
  })

  it('DOES NOT OPEN A DOCK THE READER CLOSED, ON A LATER RENDER', () => {
    // The hazard the whole `arrived` ref exists for, and it is not theoretical:
    // the filter is in the URL now, so EVERY KEYSTROKE rewrites the params with
    // the same `?lens=` still on them. Re-reading that as an arrival would
    // re-open the dock on every letter typed.
    const run = drive(
      params('lens=needs-me'),
      { focusId: null, dimension: 'status', lens: 'needs-me', panelOpen: false },
      {
        acts: [
          (s) => {
            // The reader closes the dock, then types into the search box —
            // which is a URL write now.
            s.panelOpen = false
            return params('lens=needs-me&q=vpn')
          },
        ],
      },
    )
    expect(run.settled).toBe(true)
    expect(run.store.panelOpen).toBe(false)
    expect(mapFilterFromParams(run.params).search).toBe('vpn')
  })

  it('does not open a dock for a URL THIS SESSION seeded', () => {
    // Arriving from the nav bar with no `?lens=` at all: the mirror writes the
    // persisted lens into the address bar on the first paint, and that write
    // must not read back as somebody asking for the list.
    const run = drive(params(''), {
      focusId: null,
      dimension: 'status',
      lens: 'needs-me',
      panelOpen: false,
    })
    expect(run.settled).toBe(true)
    expect(run.params.get('lens')).toBe('needs-me')
    expect(run.store.panelOpen).toBe(false)
  })

  it('does not open a dock for a lens that has no panel', () => {
    // The board has none, and `shape` has none until something is focused.
    expect(
      drive(params('lens=by-status'), {
        focusId: null,
        dimension: 'status',
        lens: 'needs-me',
        panelOpen: false,
      }).store.panelOpen,
    ).toBe(false)
    expect(
      drive(params('lens=shape'), {
        focusId: null,
        dimension: 'status',
        lens: 'needs-me',
        panelOpen: false,
      }).store.panelOpen,
    ).toBe(false)
    // …but `?lens=shape&focus=` arrives with a branch to show.
    expect(
      drive(params(`lens=shape&focus=${BRANCH}`), {
        focusId: null,
        dimension: 'status',
        lens: 'needs-me',
        panelOpen: false,
      }).store.panelOpen,
    ).toBe(true)
  })

  /** `useMapUrlFilter`'s writer, as a reader action: the whole view, one write. */
  const types = (search: string) => (s: Store): URLSearchParams =>
    mapParamsForAll(
      filter({ search }),
      { focusId: s.focusId, dimension: s.dimension },
      {
        lens: s.lens ?? 'shape',
        stage: stageWithTable(s.lens ?? 'shape', s.table === true),
      },
    )

  it('A FILTER KEYSTROKE LEAVES THE WHOLE VIEW ON THE LINK, IN THE SAME WRITE', () => {
    // Not "the mirror puts it back a pass later" — `run.urls[1]` is the address
    // bar the instant the reader stops typing, and a copy taken then has to be
    // the view they are looking at. `filterToParams` builds a FRESH params
    // object, so the composition is the only thing standing between this and a
    // link with the facets and nothing else.
    const run = drive(
      params(`lens=shape&stage=table&focus=${TRACK}&dim=owner`),
      { focusId: null, dimension: 'status', lens: 'needs-me', table: false, panelOpen: false },
      { acts: [types('vpn')] },
    )
    expect(run.settled).toBe(true)
    const typed = new URLSearchParams(run.urls[1])
    expect(typed.get('q')).toBe('vpn')
    expect(typed.get('lens')).toBe('shape')
    expect(typed.get('stage')).toBe('table')
    expect(typed.get('focus')).toBe(TRACK)
    expect(typed.get('dim')).toBe('owner')
    // …and nothing the pair does afterwards changes any of it.
    expect(run.params.toString()).toBe(typed.toString())
    expect(run.store.lens).toBe('shape')
    expect(run.store.table).toBe(true)
    expect(run.store.focusId).toBe(TRACK)
  })

  it('A JUMP FROM A NUMBER TO THE LIST SURVIVES ITS OWN URL WRITE', () => {
    // `onJump` is two writes in one event — `setLens` into the store, then
    // `setFilter` into the URL — and it is the reason the filter writer reads
    // the store through `getMindtreeState()` instead of off the render. Read off
    // the render, the URL would carry the lens the reader JUST LEFT, and the
    // inbound effect would read it back and undo the jump: the "1 interaction"
    // the contract prices this at would land where it started.
    const run = drive(
      params('lens=numbers'),
      { focusId: null, dimension: 'status', lens: 'numbers', panelOpen: false },
      {
        acts: [
          (s) => {
            s.lens = 'needs-me'
            return types('')(s)
          },
        ],
      },
    )
    expect(run.settled).toBe(true)
    expect(run.store.lens).toBe('needs-me')
    expect(run.params.get('lens')).toBe('needs-me')
  })

  it('a claim the store settles differently costs one pass and no more', () => {
    // useMapFocus's reconciler repairs a dead branch to its surviving ancestor,
    // so the store can end up holding something the link did not ask for. The
    // claim must not wedge the mirror shut when that happens: the URL has to
    // end up describing what is actually drawn.
    const pasted = params(`focus=${BRANCH}&dim=status`)
    const store: Store = { focusId: null, dimension: 'status' }
    // The reconciler trims the dead branch to the track, as resolveFocus's
    // fallback does — so the store never holds what the link claimed. Modelled
    // INSIDE the run rather than by re-driving afterwards, because a second
    // drive re-arms the inbound effect and that is a REMOUNT, not a store
    // settling: in the hook the inbound effect is keyed on `[params]` alone and
    // does not re-fire when only the store moves.
    const run = drive(pasted, store, { settle: (id) => (id === BRANCH ? TRACK : id) })
    expect(run.settled).toBe(true)
    expect(run.store.focusId).toBe(TRACK)
    // The mirror was not wedged shut by a claim it could never satisfy: the URL
    // ends up describing what is actually drawn.
    expect(run.params.get('focus')).toBe(TRACK)
    expect(run.params.get('dim')).toBe('status')
  })
})

/* ───────────── the one store property `absorbed()` leans on ──────────────── */

describe('store/mindtree', () => {
  it('stores a claimed focus id and dimension VERBATIM', async () => {
    // `absorbed()` compares the claim with the store by identity of value, so a
    // store that normalised what it was handed would make every claim look
    // unabsorbed and cost a wasted pass on every navigation. Asserted through
    // the real module and its real persisted form rather than a hook, because
    // zustand v5 cannot be read back through a server render.
    const { readMindtreePrefs, setMindDimension, setMindFocus } = await import(
      '../../store/mindtree'
    )
    setMindFocus(BRANCH)
    setMindDimension('owner')
    expect(readMindtreePrefs().focus).toBe(BRANCH)
    expect(readMindtreePrefs().dimension).toBe('owner')
  })
})
