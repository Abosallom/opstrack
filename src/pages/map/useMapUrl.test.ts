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
import type { MindDimension } from '../../lib/mindtree/model'

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
const { mapFilterFromParams, mapMirrorParams, mapParamsFor, mapUrlInbound } = await import(
  './useMapUrl'
)

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

/* ────────────────────── the cold load, which is the point ─────────────────── */

interface Store {
  focusId: string | null
  dimension: MindDimension
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
 */
function drive(
  start: URLSearchParams,
  store: Store,
  opts: { claims?: boolean; limit?: number; settle?: (id: string) => string } = {},
): Run {
  const claims = opts.claims ?? true
  const limit = opts.limit ?? 24
  const settle = opts.settle ?? ((id: string): string => id)
  let current = start
  let claim: MindtreeUrlView | null = null
  let ranInboundOn: URLSearchParams | null = null
  let ranOutboundOn: { params: URLSearchParams; store: Store } | null = null
  const urls = [current.toString()]

  for (let pass = 0; pass < limit; pass++) {
    const rendered: Store = { focusId: store.focusId, dimension: store.dimension }

    const inboundDue = ranInboundOn !== current
    const outboundDue =
      ranOutboundOn === null ||
      ranOutboundOn.params !== current ||
      ranOutboundOn.store.focusId !== rendered.focusId ||
      ranOutboundOn.store.dimension !== rendered.dimension

    if (!inboundDue && !outboundDue) return { urls, store, params: current, settled: true }

    if (inboundDue) {
      ranInboundOn = current
      const url = mapUrlInbound(current)
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
      const next = mapMirrorParams(current, rendered, claims ? outstanding : null)
      if (next !== null) {
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
