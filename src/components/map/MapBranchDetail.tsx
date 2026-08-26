// THE DETAIL BAND — what an organization IS, above what is open on it.
//
// Aziz's sentence for this feature: *"When click on any Org, a sidebar page
// within the map to see the details like: Account Manager, Use cases integrated,
// outstanding issue."* Two of those three are here. The third is not, and that
// is the most important decision in this file — see THREE NUMBERS below.
//
// IT RIDES THE `branch` SUBJECT AT ZERO WIRING COST. `subjectForLens('shape',
// focusNodeId)` already yields `{kind:'branch', nodeId}`, so focusing an
// organization opens the branch panel on it and this band is one more section
// inside it. A sixth `PanelSubject` and a sixth `MapLens` would both cascade
// through closed unions, the exhaustive switch in Mindtree.tsx and lens.test.ts,
// and buy nothing the band order does not already give: Breadcrumb → DETAIL →
// stats → work → history, which is what a reader asks in that order.
//
// A SEPARATE FILE FROM MapBranch.tsx FOR SIZE ALONE, on MapBranchHistory.tsx's
// precedent and with its bargain: it owns NO CSS prefix of its own, every class
// here is `.mbr-*` from `map-branch.css`, and the registry needs no new entry.
// `.mbr-detail` is the one name here that carries no rule and is not meant to —
// it is an IDENTITY, the twin of `.mbr-history`, so a test can slice the
// rendered panel at this band. Every other `.mbr-*` name below has a rule.
//
// ── TWO PROPS, AND THE SECOND ONE IS NOT LAZINESS ──────────────────────────
//
// `nodeId` is the map-node id (`entityIdOf(node)`, so the mount and the stats
// band cannot disagree about which node is focused). `kindName` is
// `MindNode.entityType` handed straight through — model.ts's comment says why
// it is carried on the node at all: a second lookup keyed on `bucketKey` in this
// component is a second chance to disagree with the tree about what a node is.
//
// NOTHING HERE BRANCHES ON THE KIND, and nothing ever should. What a Phase shows
// and what an Organization shows is CONFIGURATION — the kind is rendered as a
// caption and is never read as a condition. The moment this file says
// `kindName === 'Organization'`, renaming a kind in the admin screen silently
// empties a band.
//
// ── HOW IT DEGRADES, IN TWO DIFFERENT DIRECTIONS ───────────────────────────
//
// A node whose kind declares no fields renders NO BAND AT ALL — a fourth empty
// section above the stats teaches nothing and costs a screenful on a phone. In
// v1 that is every node that is not an entity (a track, a status bucket, the
// root), which is what `nodeId === null` means here, plus an entity whose row
// has not landed in `store/config` yet.
//
// A node WITH fields and no values renders the names against an em-dash.
// "Account manager: —" is a fact Aziz wants to see: it is the difference between
// "nobody is accountable for this organization" and "this panel does not do
// account managers", and only one of those is worth a phone call.
//
// ── THREE NUMBERS, THREE UNITS, AND THIS BAND OWNS EXACTLY ONE ─────────────
//
// MapBranch.tsx:22-37 already requires every number on this panel to name its
// scope. With progress there are three and they are in three different units:
//
//   `6 of 9 live`      CAPABILITIES, scoped to this organization — this band.
//   `12 open`          ITEMS, scoped to the branch — the stats band's tiles.
//   the history band   EVENTS, scoped to a date window the reader chose.
//
// So "outstanding issues" is NOT a field on this band. It is the stats band's
// `open` tile, and rendering `6 of 9` as a tile beside `12 open` would put two
// units in one row of numbers with nothing to tell them apart. The heading of
// the matrix is where progress belongs, because that is the one place where the
// unit is written directly above it.
//
// ── THE COUNTS ARE CLIENT-SIDE, AND THE CLAMP IS SOMEBODY'S TO SURFACE ─────
//
// Every number on this band is computed here from rows already in hand, never
// from a server rollup: a rollup cannot know the reader's `FilterState`, and
// model.ts's rule is that a branch labelled 12 showing 3 is the worst thing this
// map can do. The capability numbers are immune to PostgREST's 1000-row clamp
// by construction — `listNodeUseCases(nodeId)` returns at most one row per
// capability for one node. The ITEM count is not immune, which is exactly why it
// stays on the stats band, whose `track.statsPartial` note already says so when
// `useEntriesTruncated()` is true.
//
// READ-ONLY IN v1, deliberately — AND THAT DECISION IS NOW REVERSED FOR THE
// STAGE, AND FOR THE STAGE ALONE. `map_node_use_cases` is member-writable and
// `setNodeUseCase` exists, but the plan puts per-use-case editing in the admin
// catalogue screen; a second place to write the same cell is a second place for
// the two to disagree about what was saved. That argument still holds for the
// capability matrix below and it does NOT hold for `map_node_progress`:
//
//   · 0026 split the stage into a side table PRECISELY so the three account
//     managers could write it without `structure.edit`. A field made
//     member-writable on purpose and then editable nowhere is a migration that
//     shipped a column nobody can fill in.
//   · It is the action they take most (budget E2: two taps from landing, three
//     on a phone), and the panel is where a reader already is when they have
//     just read what an organization IS.
//   · There is no second writer to disagree with. The portfolio row and this
//     field are ONE control mounted twice — `StagePicker`, exported from
//     PortfolioStage.tsx, which also owns the optimistic overlay both surfaces
//     read. That is the opposite of the duplication the v1 rule was about.
//
// THE IMPORT DIRECTION IS PortfolioStage → nothing here, and this band → it.
// The stage takes `terminalKey` and `managerNameOf` as PROPS from the shell
// rather than importing `TERMINAL_STATUS` and `managerLabel` from this file,
// which is what keeps the two modules acyclic.
//
// ══════════════════════════════════════════════════════════════════════════
//
// ── THE SECOND BAND: WHAT THIS BRANCH PROMISED (0027) ──────────────────────
//
// `MapBranchGoals` is the other half of the same sentence and the reason this
// file now holds two bands rather than one. The detail band says what a node IS
// and how far it has got; the goal band says where it was SUPPOSED to have got
// to, and by when. They hang off the same gate — a map node — they are read in
// that order, and splitting them across two files would put one paragraph's
// worth of shared reasoning in two places.
//
// STILL ZERO NEW `PanelSubject` AND ZERO NEW `MapLens`. Both bands ride the
// `branch` subject exactly as the header above describes: MapBranch.tsx mounts
// them one after the other and the panel's band order becomes Breadcrumb →
// DETAIL → GOALS → stats → work → history.
//
// THE TWO PERMISSIONS ARE OPPOSITE AND THE BAND IS SHAPED BY IT. A goal is a
// commitment about a department, so 0027 gates every write on
// `has_perm('structure.edit')` — the two Associate Directors. The three account
// managers are members: they READ the promise their organizations are measured
// against and they cannot edit it. So the add/edit/delete controls are ABSENT
// for them rather than disabled — a disabled control is a promise the app has to
// keep, and "you may not do this" is not a thing an AM needs told on every open.
//
// ⚠ MOUNTED ONLY FOR A NODE, BY THE CALLER. Unlike `MapBranchDetail`, which
//   decides internally and returns null, MapBranch.tsx renders this band only
//   when `entityIdOf(node)` is non-null. That is not a style difference: the
//   band FETCHES on mount, and a component that opens a request for every track
//   and every status bucket the reader focuses is a request per focus change
//   that can never return a row, since goals hang off map nodes and nothing
//   else has one.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  createGoal,
  deleteGoal,
  listGoals,
  updateGoal,
  GOAL_LABEL_MAX,
  type MapNodeGoal,
  type MapNodeGoalInput,
} from '../../api/goals'
import { listNodeUseCases } from '../../api/map'
import NodeEditor from './NodeEditor'
import { useHisProducts } from '../../store/config'
import { confirm } from '../Confirm'
// The stage control and the optimistic write behind it. ONE control mounted
// twice — see the header's note on the reversed read-only decision.
import { StagePicker } from './PortfolioStage'
import { EmptyState } from '../shared'
import { toast } from '../toast'
import { isolate } from '../../lib/bidi'
import { diffDays, formatDate, parseIsoDate, todayIso, type IsoDate } from '../../lib/dates'
import { t, useLocale, type Locale } from '../../lib/i18n'
import { useStageLabel } from '../../lib/labels'
// ALIASED, AND NOT AS A STYLE CHOICE. `useCaseProgress` is a pure function whose
// name begins with `use` + a capital, which is exactly the shape oxlint's
// `react/rules-of-hooks` uses to recognise a Hook — calling it inside a
// `useMemo` callback is an ERROR under that rule, and calling it from a test's
// `it()` body is another. The name is lib/mapNodes.ts's published contract and
// stays; the alias is the one-line fence at every call site that is not a hook
// position. Renaming the import does not rename the export.
import {
  stageIndex,
  useCaseProgress as computeUseCaseProgress,
  type UseCaseProgress,
} from '../../lib/mapNodes'
// THE SHARED ARITHMETIC — the same `stageReading` the portfolio's table, its chip
// badge and the map's stats walk read, so the panel's "68 days" is the table's
// "68 days" by construction rather than by coincidence.
import { stageReading } from '../../lib/portfolio/fields'
import { useHasPerm } from '../../store/auth'
import {
  useAllUseCases,
  useMapNodeMap,
  useMapNodeStages,
  useNodeProgress,
  useStageMap,
} from '../../store/config'
import { useFilterContext } from '../../store/entries'
import { mergeProgress, usePendingStages } from '../../store/stageOverlay'
import { useMemberMap } from '../../store/members'
import type { Member } from '../../api/members'
import type {
  MapNode,
  MapNodeStage,
  MapNodeUseCase,
  UseCase,
  UseCaseRung,
  UseCaseStatus,
} from '../../types'

/* ══════════════════════════ constants ══════════════════════════ */

/**
 * The status that counts as finished — the ONE literal, handed to
 * `useCaseProgress` as its `terminalKey`. lib/mapNodes.ts never compares against
 * a status word of its own, so moving this line moves the arithmetic with it.
 *
 * EXPORTED because the canvas needs the same word: `useMapModel` folds
 * `view.progress` over the whole tree and would otherwise carry a second copy of
 * `'live'`, which is the exact duplication lib/mapNodes.ts's header refuses. One
 * literal, one home, and the home is the band that renders the sentence it
 * belongs to.
 */
export const TERMINAL_STATUS: UseCaseStatus = 'live'

/** A value that is not recorded. Paired with an `.sr-only` word every time. */
const EM_DASH = '—'

// EXPORTED beside `TERMINAL_STATUS`, and for the identical argument: the PMO
// page prints the same "⁨6⁩ of 9 ⁨live⁩" sentence off the same `useCaseProgress`
// pair, and a second literal there would be the exact duplication this file's
// header refuses. One literal, one home, and the home is the band that renders
// the sentence it belongs to.
export const STATUS_WORD: Readonly<Record<UseCaseStatus, string>> = {
  planned: 'mapnode.wordPlanned',
  testing: 'mapnode.wordTesting',
  live: 'mapnode.wordLive',
}

/**
 * The five rungs, in order — 0032's ladder.
 *
 * ⚠ THE ORDER OF THIS ARRAY IS THE ONLY THING THAT SAYS WHICH WAY THE LADDER
 *   RUNS. The strings are opaque and `'coc'` sorts before `'dev'` alphabetically,
 *   so nothing else in the app could recover the sequence. The panel draws slot
 *   `i` from this array; reversing it silently reverses every hospital's
 *   progress, which is why a test pins the rendered marker states against it.
 */
const RUNGS: readonly UseCaseRung[] = ['intake', 'dev', 'stg', 'coc', 'prod']

/**
 * The rung as a word.
 *
 * Written as literals rather than built from a template, because
 * `localeReach.test.ts` scans the source for key-shaped strings and cannot see a
 * key it has to assemble — a template here would take five keys out of the gate
 * that proves they exist in both bundles.
 */
const RUNG_WORD: Readonly<Record<UseCaseRung, string>> = {
  intake: 'mapnode.rungIntake',
  dev: 'mapnode.rungDev',
  stg: 'mapnode.rungStg',
  coc: 'mapnode.rungCoc',
  prod: 'mapnode.rungProd',
}

/* ══════════════════════════ pure helpers ══════════════════════════ */

/**
 * A row's name in this locale — `name_ar` when it is not EMPTY, never when it is
 * not null. Both columns are `not null default ''` (0023/0024), and the Arabic
 * names of the capabilities are seeded blank on purpose: everybody in the room
 * says "ADT".
 *
 * Not in lib/labels.ts because this component does not own that file; not in
 * lib/mapNodes.ts because that module is pure of the locale by contract.
 */
export function localName(row: { name: string; name_ar: string }, locale: Locale): string {
  if (locale === 'ar') return row.name_ar.trim() || row.name
  return row.name
}

/**
 * The teammate accountable for this node, as a string, or null for the em-dash.
 *
 * THROUGH THE ROSTER, NEVER AS STORED TEXT: `account_manager_id` is a reference
 * precisely so that renaming a person propagates to every organization they
 * carry instead of leaving forty stale strings behind. An id the roster does not
 * know is NOT the same as no manager — it is a person who has left, or a members
 * store that has not landed yet — and saying "—" for it would report an
 * accountable organization as an unaccountable one.
 */
export function managerLabel(byId: ReadonlyMap<string, Member>, id: string | null): string | null {
  if (id === null) return null
  const named = byId.get(id)?.displayName?.trim()
  return named ? named : t('mapnode.managerGone')
}

/* ══════════════════════════ the connected band ══════════════════════════ */

export interface MapBranchDetailProps {
  /** The map-node id behind the focused branch — `entityIdOf(node)`. */
  nodeId: string | null
  /** `MindNode.entityType`: Programme, Phase, Organization. A caption, never a condition. */
  kindName: string | null
  /**
   * What sits AT OR UNDER this node — the open work and the silence — off the
   * SAME two sources the canvas beside it was drawn from.
   *
   * TWO SOURCES FOR TWO FACTS, and the split is the tree's rather than a
   * convenience. `open` is `MindNode.count`, which is what the picture actually
   * drew after the reader's filter; `quietDays` is `NodeStats.quietDays`, the
   * post-order minimum `collectStats` folds over every entry leaf, folds and
   * collapsed branches included. Re-deriving either one here would be a second
   * answer under exactly the filters nobody tests — MindtreeTable's rule, at the
   * seam where the panel meets the canvas.
   *
   * OPTIONAL, and the absence is a real state: until the integrator threads
   * `model.stats` through `MapBranch`, the two rows do not render at all, which
   * is the honest reading of "nobody has counted this" and never a zero.
   */
  rollup?: { open: number; quietDays: number | null } | null
}

export default function MapBranchDetail({
  nodeId,
  kindName,
  rollup,
}: MapBranchDetailProps): ReactElement | null {
  const locale = useLocale()
  const nodeById = useMapNodeMap()
  const memberById = useMemberMap()
  /**
   * THE TWO INHERITED FACETS, off `FilterContext`'s one ancestor walk. The panel
   * used to read the raw `map_nodes` columns while the filter, the portfolio's
   * rows and the map's cohort rings all read the inherited ones — one screen,
   * two definitions of "vendor" — and this is the read that ends that.
   */
  const ctx = useFilterContext()
  const storedProgress = useNodeProgress()
  const pending = usePendingStages()
  const stageById = useStageMap()
  // The FULL catalogue, hidden rows included: a capability retired this morning
  // is still one this organization integrated, and the denominator must not
  // shrink underneath yesterday's number. lib/mapNodes.ts drops the hidden rows
  // nobody is recorded against.
  const catalogue = useAllUseCases()

  /* ── the links, fetched on open ───────────────────────────────────── */

  const [links, setLinks] = useState<readonly MapNodeUseCase[]>([])
  // Starts true whenever there is something to fetch: starting false paints
  // "nothing recorded" for one frame on an organization that has ten links.
  const [loading, setLoading] = useState(nodeId !== null)
  const [error, setError] = useState<string | null>(null)
  /** Only the newest request may write state — focus moves faster than a fetch. */
  const request = useRef(0)

  useEffect(() => {
    const token = request.current + 1
    request.current = token
    // CLEARED, not kept. MapBranchHistory holds its rows through a reload
    // because they describe the same track; these describe a DIFFERENT
    // organization the moment the id changes, and one frame of the previous
    // one's capabilities under this one's name is a lie nobody would suspect.
    setLinks([])
    setError(null)
    if (nodeId === null) {
      setLoading(false)
      return
    }
    setLoading(true)
    void listNodeUseCases(nodeId).then((result) => {
      if (token !== request.current) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLinks(result.data)
    })
  }, [nodeId])

  /**
   * THE POPULATION IS THIS ONE ORGANIZATION, and saying so is what the fourth
   * argument is for. `useCaseProgress` counts the nodes it is HANDED rather than
   * the nodes its links happen to mention, so an organization with no links at
   * all is a column of zeroes here instead of being invisible to the
   * denominator — which is the roll-up's bug, seen at n = 1.
   *
   * Built inside the memo rather than beside it: a fresh `[{ id }]` on every
   * render would defeat the memo it is a dependency of, and `nodeId` is the fact
   * that actually changes.
   */
  const progress = useMemo(
    () =>
      computeUseCaseProgress(
        catalogue,
        links,
        TERMINAL_STATUS,
        nodeId === null ? [] : [{ id: nodeId }],
      ),
    [catalogue, links, nodeId],
  )

  /**
   * The store's progress rows with this tab's unconfirmed rung on top.
   *
   * WITHOUT THE MERGE THE CLOCK LIES IN THE MOST VISIBLE WAY THERE IS: the rung
   * control sits three rows above the day count, so choosing a new rung would
   * leave "68 days" beside it until a round trip landed — which reads as the
   * write having failed on the one screen where the write and its consequence
   * are two centimetres apart.
   */
  const merged = useMemo(() => mergeProgress(storedProgress, pending), [storedProgress, pending])

  /**
   * The stage triad — the SAME `stageReading` the portfolio's rows are built
   * from, the same one the map's stats walk clocks the card with.
   */
  const reading = useMemo(() => {
    if (nodeId === null) return null
    // `ctx.today` rather than `Date.now()` in the dependency list, and `now`
    // read inside the body: the reading's only use of the clock is whole
    // calendar days, so re-running per render would recompute the same integer.
    // PortfolioStage.tsx and useMapModel.ts carry the same suppression.
    const now = new Date()
    return stageReading(nodeId, {
      stages: stageIndex(merged, stageById),
      progressById: merged,
      // NO WORKSPACE FLOOR IN v1 — PortfolioStage's decision, kept as one.
      fallbackStallDays: null,
      now,
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, merged, stageById, ctx.today])

  /**
   * Whether the field form is open, lifted out of `NodeEditor` so the band can
   * hide the read-only pairs the form replaces — see `DetailBandProps.editing`.
   */
  const [editing, setEditing] = useState(false)

  // Hidden rows included: a panel READING a system already recorded must be able
  // to name a retired one. `useAllUseCases`' contract, one catalogue over.
  const hisProducts = useHisProducts()

  const node: MapNode | undefined = nodeId === null ? undefined : nodeById.get(nodeId)

  // NO BAND, rather than an empty one. Not an entity (a track, a bucket, the
  // root), or an entity whose row has not arrived — the map draws from the same
  // store, so the second case is a cold start, not a missing organization.
  // `nodeId === null` is already implied by `node === undefined` — the lookup
  // above short-circuits on it — but it is spelled out so the compiler narrows
  // the id for the stage control below, which needs the string rather than the
  // row. The two conditions are one fact and must not drift apart.
  if (nodeId === null || node === undefined) return null

  return (
    <DetailBand
      name={localName(node, locale)}
      kindName={kindName}
      // INHERITED, WITH THE ROW AS THE FALLBACK — the `inherited ?? raw`
      // coalesce lib/portfolio/rows.ts and useMapModel.ts both spell out, so
      // one organization has one manager and one integrator on every surface.
      manager={managerLabel(memberById, ctx.managerOfNode?.get(nodeId) ?? node.account_manager_id)}
      vendor={ctx.vendorOfNode?.get(nodeId) ?? node.vendor}
      // Resolved here rather than in the band — see `hisName`. Null both for a
      // node with no system recorded and for one naming a product the catalogue
      // no longer has, which read the same way to a person: nothing to show.
      hisName={hisProducts.find((product) => product.id === node.his_id)?.name ?? null}
      daysInStage={reading?.days ?? null}
      atRisk={reading?.atRisk ?? false}
      rollup={rollup ?? null}
      progress={progress}
      labelOf={(useCase) => localName(useCase, locale)}
      loading={loading}
      error={error}
      // THE ONE WRITABLE FIELD ON THIS BAND — see the header. Passed as a NODE
      // rather than as an `onStage` callback, so `DetailBand` stays renderable
      // without a store: `vitest.config.ts` is `environment: 'node'` and effects
      // do not run under `renderToStaticMarkup`, so a band that mounted the
      // connected picker itself could only ever be tested in its loading state.
      stage={<StagePicker nodeId={nodeId} name={localName(node, locale)} />}
      // THE REST OF THE FIELDS, WRITABLE. Same shape as `stage` above and for
      // the same reason. `NodeEditor` renders nothing at all without
      // `structure.edit`, so a reader who cannot write sees the band exactly as
      // it was rather than a disabled control explaining a screen they will
      // never use.
      editor={<NodeEditor nodeId={nodeId} onEditingChange={setEditing} />}
      editing={editing}
    />
  )
}

/* ══════════════════════════ the render ══════════════════════════ */

export interface DetailBandProps {
  /** The node's own name, already resolved for the locale. */
  name: string
  kindName: string | null
  /**
   * The INHERITED account manager, resolved. Null renders the em-dash; see
   * managerLabel() for why "gone" is not null.
   *
   * ⚠ THE EM-DASH MEANS SOMETHING NARROWER THAN IT USED TO. It was "this row's
   *   `account_manager_id` column is null"; it is now "nobody is accountable for
   *   this organization ANYWHERE UP THE CHAIN". An organization with a blank
   *   column under a Phase that has a manager reads the Phase's person, which is
   *   what the filter has always meant by `?manager=` and what the portfolio's
   *   table has always shown — the panel was the surface disagreeing.
   */
  manager: string | null
  /** The INHERITED vendor, same rule and same rewritten dash. `''` is "not
   *  recorded anywhere up the chain" — the column is `not null default ''`. */
  vendor: string
  /**
   * The hospital information system's NAME, already resolved from the catalogue,
   * or null when nothing is recorded.
   *
   * A NAME AND NOT AN ID, on `manager`'s precedent directly above: this band
   * stays renderable without a store, so the caller does the lookup. Passing the
   * id would make the band read the catalogue itself and give it a second
   * reason to need one.
   *
   * ⚠ NOT INHERITED, unlike `manager` and `vendor`. Those two cascade because an
   *   organization inside a programme is delivered by that programme's vendor
   *   until somebody says otherwise. A hospital information system is a fact
   *   about the building, and a phase does not run one — inheriting it would put
   *   a system on every organization under the first one anybody recorded.
   */
  hisName: string | null
  /**
   * Whole calendar days on the current rung, or null when nothing is recorded —
   * `stageReading`, the one arithmetic three surfaces share.
   */
  daysInStage: number | null
  /** `daysInStage > expected_days`, terminal and paused stopping the clock. */
  atRisk: boolean
  /**
   * Open work and quiet under this node, off the SAME walk the canvas reads.
   *
   * Absent until the integrator threads `model.stats` through `MapBranch`, and
   * the rows do not render while it is — an absent roll-up is "nobody has
   * counted", which is a different fact from a zero and must not print as one.
   */
  rollup?: { open: number; quietDays: number | null } | null
  progress: UseCaseProgress
  labelOf: (useCase: UseCase) => string
  loading: boolean
  /** An i18n key from api/map.ts, never a sentence. */
  error: string | null
  /**
   * The stage control, or absent.
   *
   * OPTIONAL, and the absence is a real state rather than a default: with no
   * ladder configured `StagePicker` renders null and this row does not appear at
   * all. A picker whose only option is "nothing" is a control promising a verb
   * the workspace does not have yet, and the portfolio stage already names that
   * state and links to the screen that fixes it.
   */
  stage?: ReactNode
  /**
   * The organization's own fields, as a form — `NodeEditor`, passed as a NODE
   * for the reason `stage` is: this band must stay renderable without a store.
   */
  editor?: ReactNode
  /**
   * True while that form is open, so the read-only pairs it replaces stand
   * down. The flag is LIFTED rather than decided here because the band is
   * presentational and the editor owns the state; showing both at once would
   * put each field on the screen twice, once stale.
   */
  editing?: boolean
}

/**
 * The band as markup, split out so it can be rendered without a store or a
 * fetch — `vitest.config.ts` is `environment: 'node'` and effects do not run
 * under `renderToStaticMarkup`, so a test of the connected component alone could
 * only ever prove the loading state.
 */
export function DetailBand({
  name,
  kindName,
  manager,
  vendor,
  hisName,
  daysInStage,
  atRisk,
  rollup,
  progress,
  labelOf,
  loading,
  error,
  stage,
  editor,
  editing = false,
}: DetailBandProps): ReactElement {
  useLocale()
  const { rows, done, total, linked } = progress
  const settled = !loading && error === null

  return (
    <section className="mbr-band mbr-detail" aria-label={t('mapnode.detail')}>
      <div className="mbr-band-head">
        <h3 className="section-title">{t('mapnode.detail')}</h3>
        {/* The kind, as a caption. Database text: isolated, never translated. */}
        {kindName !== null && kindName !== '' && (
          <span className="pill mbr-band-count">{isolate(kindName)}</span>
        )}
      </div>

      {editor}

      {/* THE ELEVEN FIRST, AND THAT IS A RULING RATHER THAN A LAYOUT TASTE.
          The owner's words when he was asked what the panel should open with:
          "all ob progress per org, once i reach this level, i click the org and
          i should see a bar with details poping up" — and then, of what the bar
          leads with, the eleven use cases. He is the reader this panel exists
          for, and what he opens it to find out is how far each use case has
          got, not who the account manager is.

          It also only became worth leading with once the grid was filled. Until
          then most organizations had a handful of recorded cells and the list
          was mostly dashes; every organization now carries all eleven rows, so
          this is a complete picture rather than a sample of one. The fields
          below did not become unimportant — they became the second question. */}
      {/* The matrix: the answer to "how far has this organization actually
          got", which is the question the panel was asked. */}
      <div className="mbr-uc">
        <h4 className="mbr-sub">{t('mapnode.useCases')}</h4>

        {/* ONE LIVE REGION FOR THE WHOLE ASYNC RESULT, so a reader hears exactly
            one sentence per load rather than a skeleton, a count and a heading
            in three announcements. The visible text is the short form the
            heading gives context to; the announced text names its scope and its
            unit, because a screen reader has no heading four pixels above it. */}
        <p className="mbr-uc-head" role="status">
          {loading ? (
            <span>{t('common.loading')}</span>
          ) : error !== null ? (
            <span className="mbr-note">{t(error)}</span>
          ) : linked === 0 ? (
            /* THE STATE THE OWNER WILL SEE MOST IN THE FIRST WEEK, written as a
               sentence rather than as a dash. Every other em-dash on this panel
               sits in a FIELD or in the status column, where a reader's eye
               already has a label beside it and a dash reads as "this one is
               blank". Here the dash would be standing in for `6 of 9 live` — a
               whole sentence — at the top of a band that is otherwise ten rows
               of dashes, and "the band failed to load" and "nobody has recorded
               anything yet" would look identical. The rows below still render:
               on a brand-new organization they are the CHECKLIST of what there
               is to record, which is the one useful thing this band can say
               before anybody has said anything. */
            <span>{t('mapnode.statusNone')}</span>
          ) : (
            <>
              <span className="tabular" aria-hidden="true">
                {t('mapnode.progress', { done, total, status: t(STATUS_WORD[TERMINAL_STATUS]) })}
              </span>
              <span className="sr-only">
                {t('mapnode.progressLong', {
                  done,
                  total,
                  status: t(STATUS_WORD[TERMINAL_STATUS]),
                  name,
                })}
              </span>
            </>
          )}
        </p>

        {/* The rows render whenever the catalogue has anything on the table,
            settled or not — a capability nobody has recorded is a zero, and the
            zeroes are half of what the reader came to see. */}
        {settled && rows.length > 0 && (
          <ul className="mbr-uc-list" aria-label={t('mapnode.useCasesFor', { name })}>
            {rows.map((row) => (
              <li
                key={row.useCase.id}
                className="mbr-uc-row"
                data-status={row.status ?? undefined}
                data-retired={row.retired ? 'true' : undefined}
              >
                {/* Database text: isolated so a Latin capability name beside an
                    Arabic status does not drag the row's punctuation across. */}
                <span className="mbr-uc-name">{isolate(labelOf(row.useCase))}</span>
                {/* Retired from the catalogue, still recorded here. Marked
                    rather than hidden: hiding it would shrink the denominator
                    and rewrite yesterday's number. */}
                {row.retired && (
                  <span className="pill mbr-retired" title={t('mapnode.retiredHint')}>
                    {t('mapnode.retired')}
                  </span>
                )}
                {/* ⚠ RULED OUT IS NOT A POSITION ON THE LADDER, so it does not
                    get one. Drawing an empty track here would say "nobody has
                    said anything", which is the opposite of what somebody
                    actually said — and this row has left the denominator, which
                    a reader can only check if the row says so. */}
                {row.notApplicable > 0 && row.linked === 0 ? (
                  <span className="pill mbr-uc-na">{t('mapnode.scopeNa')}</span>
                ) : row.rung === null ? (
                  /* UNTOUCHED PAPER, NEVER A MARKER AT POSITION ZERO — the rule
                     docs/OPERATING-MODEL.md §11.5 states and that
                     `INK.unrecorded = 'none'` states again in the printed
                     report: the honest way to draw a measurement nobody took is
                     to leave the paper alone. No track is rendered AT ALL, so an
                     unrecorded pair and a pair sitting at Intake can never be
                     confused — they are not two arrangements of one picture. */
                  <span className="mbr-uc-status">
                    <span aria-hidden="true">{EM_DASH}</span>
                    <span className="sr-only">
                      {t(row.linked === 0 ? 'mapnode.statusNone' : 'mapnode.rungUnplaced')}
                    </span>
                  </span>
                ) : (
                  <RungTrack rung={row.rung} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <dl className="mbr-fields" hidden={editing}>
        {/* THE STAGE FIRST AMONG THE FIELDS — the use-case matrix above now
            answers "where has this got to" use case by use case, and this is
            the whole-organization summary of the same question. It leads the
            fields because it is the one among them that is also a CONTROL.
            The `<dd>` holds the picker
            directly — no label element of its own: the `<dt>` names the pair for
            sighted readers and the select carries its own `aria-label` naming
            the organization, so a screen-reader user hears "Stage for Riyadh
            General" rather than a bare "Stage" repeated on every panel. */}
        {stage !== undefined && stage !== null && (
          <div className="mbr-field">
            <dt className="mbr-field-k">{t('mindtree.colStage')}</dt>
            <dd className="mbr-field-v">{stage}</dd>
          </div>
        )}
        <div className="mbr-field">
          <dt className="mbr-field-k">{t('mapnode.accountManager')}</dt>
          <dd className="mbr-field-v">{manager === null ? <NotRecorded /> : isolate(manager)}</dd>
        </div>
        <div className="mbr-field">
          <dt className="mbr-field-k">{t('mapnode.vendor')}</dt>
          <dd className="mbr-field-v">
            {vendor.trim() === '' ? <NotRecorded /> : isolate(vendor)}
          </dd>
        </div>
        {/* THE HOSPITAL'S OWN SYSTEM (0034). Not recorded on any of the 140
            today, which is the honest starting point rather than a fault: the
            migration seeded the catalogue and deliberately filled in nobody.
            `scripts/report/his.mjs` can propose one for sixteen of them off
            their own ticket text, and names two candidates for three of those —
            a list for a person, not an answer to write in automatically. */}
        <div className="mbr-field">
          <dt className="mbr-field-k">{t('mapnode.his')}</dt>
          <dd className="mbr-field-v">
            {hisName === null || hisName === '' ? <NotRecorded /> : isolate(hisName)}
          </dd>
        </div>
        {/* THE PORTFOLIO'S OWN FOUR NUMBERS, IN THE PANEL'S OWN WORDS.
            `mindtree.colInStage`, `colRisk`, `colOpen` and `colQuiet` are the
            table's column headings reused as field labels rather than restated
            — the reader who renames "In stage" in Settings renames it on both
            surfaces, which is the whole promise a shared key makes. The VALUES
            come off `stageReading` and the canvas's walk; only the wrapping is
            this band's. */}
        <div className="mbr-field">
          <dt className="mbr-field-k">{t('mindtree.colInStage')}</dt>
          <dd className="mbr-field-v">
            {daysInStage === null ? (
              <NotRecorded />
            ) : (
              t('mindtree.portfolioDays', { count: daysInStage })
            )}
          </dd>
        </div>
        {/* NO VERDICT WITHOUT A CLOCK. "Inside its stage time" about an
            organization nobody has staged is a reassurance nobody earned, so
            the row reads the dash until there is a day count to judge. */}
        <div className="mbr-field">
          <dt className="mbr-field-k">{t('mindtree.colRisk')}</dt>
          <dd className="mbr-field-v">
            {daysInStage === null ? (
              <NotRecorded />
            ) : (
              t(atRisk ? 'mindtree.portfolioAtRisk' : 'mindtree.portfolioOnTrack')
            )}
          </dd>
        </div>
        {rollup != null && (
          <>
            <div className="mbr-field">
              <dt className="mbr-field-k">{t('mindtree.colOpen')}</dt>
              <dd className="mbr-field-v">{rollup.open}</dd>
            </div>
            <div className="mbr-field">
              <dt className="mbr-field-k">{t('mindtree.colQuiet')}</dt>
              {/* `OrgRow`'s renderer exactly: null is "nothing has ever been
                  filed here", which is not a zero and must not print as one. */}
              <dd className="mbr-field-v">
                {rollup.quietDays === null ? (
                  <NotRecorded />
                ) : (
                  t('mindtree.portfolioDays', { count: rollup.quietDays })
                )}
              </dd>
            </div>
          </>
        )}
      </dl>

    </section>
  )
}

/**
 * Where one use case stands, drawn as POSITION along a five-stop track.
 *
 * ⚠ NOT FIVE COLOURS, AND THAT IS A RULE RATHER THAN A PREFERENCE. It is the
 *   same decision `0026_map_node_stages.sql` already enforces on the
 *   organization ladder and `scripts/report/views/cover.mjs` on the printed
 *   report, stated once more in docs/OPERATING-MODEL.md §11.5: *an ordered
 *   ladder is drawn as position, never as hues*. Distance along the track is
 *   the progress, so a hospital that is nearly done looks nearly done from
 *   across a room. It satisfies WCAG 1.4.1 for free — colour is never the only
 *   channel because colour is not a channel at all here — and it survives being
 *   screenshotted into a message, printed in grey, and read by somebody who has
 *   never been told what the palette means.
 *
 * FIVE REAL ELEMENTS, NOT ONE OFFSET BAR, and the reason is testability rather
 * than taste: five `<li>`s each carrying `data-state` make "the marker is at
 * slot three" something `renderToStaticMarkup` can assert, where
 * `inset-inline-start: 50%` could only ever be proved in a browser this repo
 * deliberately does not have in its test environment.
 *
 * `aria-hidden`, because it is a picture of a fact the sentence beside it
 * already states in words — announcing five list items would be five noises
 * for one reading.
 */
function RungTrack({ rung }: { rung: UseCaseRung }): ReactElement {
  const at = RUNGS.indexOf(rung)
  return (
    <>
      <ol className="mbr-rung" data-rung={rung} aria-hidden="true">
        {RUNGS.map((step, i) => (
          <li
            key={step}
            className="mbr-rung-step"
            data-state={i < at ? 'passed' : i === at ? 'at' : 'ahead'}
          />
        ))}
      </ol>
      {/* POSITION AS A COUNT, never as a percentage — "step 3 of 5" is a fact a
          reader can check against the picture; "60%" is a number nobody
          measured. */}
      <span className="sr-only">
        {t('mapnode.rungAt', { rung: t(RUNG_WORD[rung]), n: at + 1, total: RUNGS.length })}
      </span>
    </>
  )
}

/**
 * A field with nothing in it.
 *
 * The dash is what Aziz reads and the word is what a screen reader says; an
 * `aria-label` on a plain <span> would be neither, because ARIA 1.2 prohibits
 * naming a generic element and assistive technology is free to drop it.
 */
function NotRecorded(): ReactElement {
  return (
    <>
      <span aria-hidden="true">{EM_DASH}</span>
      <span className="sr-only">{t('mapnode.notRecorded')}</span>
    </>
  )
}

/* ══════════════════ the goal band — what was promised (0027) ══════════════ */

/**
 * The one error key this band swallows on purpose.
 *
 * `map_node_goals` does not exist in the live database until the owner runs
 * 0027, so every read answers PostgREST's `PGRST205` until he does, on every
 * open, for every node. api/goals.ts's header states the contract and this is
 * the line that keeps it: a table that does not exist holds no goals, which is
 * indistinguishable from a node nobody has made a promise about, and the empty
 * state already says the right thing for both. Every OTHER error is shown — a
 * read refused by RLS or dropped by the network is a fact the reader needs.
 */
const MISSING_TABLE = 'common.errMissingTable'

/**
 * How far a goal has actually got — the sibling unit's fold, when it lands.
 *
 * ⚠ THIS IS A SEAM AND IT IS DELIBERATELY THE NARROW HALF OF ONE.
 *   `goalProgress(goal, node, descendants, stages, today)` in lib/mapNodes.ts is
 *   the pure fold that computes this; it answers six fields and this band reads
 *   two, so the fold's own `GoalProgress` satisfies this interface structurally
 *   and the integrator passes it through `readings` with no adapter. Declaring
 *   the two fields here rather than importing the type is what lets this band
 *   ship and render BEFORE that fold exists — and lib/** may not import api/**,
 *   so the type could not have travelled the other way in any case.
 *
 * NO READING IS NOT ZERO. A goal with no entry in `readings` renders its
 * `reached` as an em-dash: nothing has been folded, which is a different fact
 * from "none of them have arrived" and the one that must not be printed as a
 * number in front of an AD.
 *
 * `daysLeft` is NOT read from here even though the fold computes one. The band
 * owns the clock — see `goalClock` — because "how many days" is a question about
 * TODAY rather than about the ladder, and two subtractions of the same two dates
 * cannot disagree only if exactly one of them is on screen.
 */
export interface GoalReading {
  /** Descendants at or beyond the goal's rung (a terminal rung when it names none). */
  reached: number
  /** Descendants nobody has staged. The clause that stops "0 of 40" being a lie. */
  unstaged: number
}

/** Past its date · due today · still ahead. Drives the row's tone, nothing else. */
export type GoalTone = 'over' | 'due' | 'ahead'

/** The clock sentence for one goal: which key, with which number, in which tone. */
export interface GoalClock {
  key: string
  count: number
  tone: GoalTone
}

/**
 * How the days-left chip reads, from a signed day count.
 *
 * THREE ARMS, NOT TWO, AND THE MIDDLE ONE IS THE POINT. Zero is neither "0 days
 * left" nor "0 days overdue" — both of those are sentences a person reads as
 * "nothing is happening" on the single day when the opposite is true. It is
 * "Due today", which is the only day of the goal's life anybody can still act on
 * it and hit the date.
 *
 * The sign is the whole state: negative is overdue and the count is flipped, so
 * no caller ever renders a minus sign at a reader. Pure and exported so the
 * arithmetic can be pinned at a fixed instant rather than on a machine whose
 * wall clock happens to be in the right week — lib/lifecycle.ts's contract, one
 * level up from the same question.
 */
export function goalClock(daysLeft: number): GoalClock {
  if (daysLeft < 0) return { key: 'mapnode.goalOverdue', count: -daysLeft, tone: 'over' }
  if (daysLeft === 0) return { key: 'mapnode.goalDue', count: 0, tone: 'due' }
  return { key: 'mapnode.goalLeft', count: daysLeft, tone: 'ahead' }
}

/**
 * Which of the four sentences a goal is, as LITERAL keys.
 *
 * Written out rather than assembled, `RUNG_WORD`'s reason above:
 * `localeReach.test.ts` scans the source for key-shaped strings and cannot see a
 * key it has to build, so a template literal here would take four keys out of the
 * gate that proves they exist in both bundles.
 *
 * The four ARE 0027's four rows — the table in `MapNodeGoal`'s comment — and
 * there is deliberately no fifth: a goal has a stage or it does not, and a count
 * or it does not, and nothing in the schema can say anything else.
 */
const GOAL_SENTENCE = {
  countStage: 'mapnode.goalCountStage',
  count: 'mapnode.goalCount',
  stage: 'mapnode.goalStage',
  date: 'mapnode.goalDate',
} as const

/**
 * A goal's name in this locale, or the sentence that stands in for an unnamed one.
 *
 * `''` IS A LEGAL LABEL AND A GOOD GOAL — 0027 says so, because the date and the
 * target already say what it is. But a confirmation reading "Delete  ?" and an
 * aria-label reading "Edit" are not options, so the fallback names the goal the
 * way a person would: "the goal due 31/12/2026".
 */
export function goalName(goal: MapNodeGoal, locale: Locale): string {
  const label = locale === 'ar' ? goal.label_ar.trim() || goal.label : goal.label
  if (label.trim() !== '') return label
  return t('mapnode.goalUnnamed', { date: formatDate(goal.target_date, locale) })
}

/**
 * The read's own order, kept after every optimistic write.
 *
 * `target_date` then `id`, which is exactly what `listGoals` asks the server for
 * — so an edited goal lands where a reload would put it rather than where it
 * happened to be, and the next read cannot reshuffle a list the reader is
 * looking at.
 */
function sortGoals(rows: readonly MapNodeGoal[]): MapNodeGoal[] {
  return [...rows].sort((a, b) =>
    a.target_date === b.target_date
      ? a.id.localeCompare(b.id)
      : a.target_date.localeCompare(b.target_date),
  )
}

/* ── the connected band ────────────────────────────────────────────────── */

export interface MapBranchGoalsProps {
  /** The map-node id behind the focused branch — `entityIdOf(node)`, never null. */
  nodeId: string
  /**
   * goal id → how far it has got. Absent today, and NOT for want of a read:
   * `goalProgress` runs off the stage ladder and the descendant walk, both of
   * which store/config holds at boot. What is missing is a caller that holds the
   * GOALS — this band fetches its own, and `readings` is keyed by goal id — so
   * the fold lands with the portfolio's whole-table goal read (wave 4). Until
   * then every goal renders its promise with an em-dash where the number goes.
   * See `GoalReading`.
   */
  readings?: ReadonlyMap<string, GoalReading>
}

export function MapBranchGoals({ nodeId, readings }: MapBranchGoalsProps): ReactElement {
  const locale = useLocale()
  const nodeById = useMapNodeMap()
  const stageById = useStageMap()
  const stages = useMapNodeStages()
  const stageLabelOf = useStageLabel()
  // THE PERMISSION, NOT THE ROLE. `structure.edit` is the key 0027's policies
  // name; a test against `profile.role === 'admin'` would disagree with the
  // database the moment Aziz gives a custom role that key (0025).
  const canEdit = useHasPerm('structure.edit')

  const [rows, setRows] = useState<readonly MapNodeGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Only the newest request may write state — focus moves faster than a fetch. */
  const request = useRef(0)
  /** False after unmount, so a resolved write cannot set state on a dead band. */
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const token = request.current + 1
    request.current = token
    // CLEARED, not kept: these are a DIFFERENT branch's commitments the moment
    // the id changes, and one frame of the previous department's promises under
    // this one's name is a lie nobody would suspect.
    setRows([])
    setError(null)
    setLoading(true)
    // ONE NODE'S GOALS, through the chunked list rather than a second query:
    // `listGoals([nodeId])` makes exactly one request for one id, and having a
    // single read path means the panel and the portfolio cannot drift about what
    // a goal row contains.
    //
    // `truncated` is not rendered and that is a judgement rather than an
    // oversight: this read is capped at 5,000 rows for ONE node, and a node with
    // 5,000 commitments on it is not a workspace this sentence could help. The
    // read where truncation is a real question is the portfolio's `listGoals()`
    // over every node, and that caller owes the banner.
    void listGoals([nodeId]).then((result) => {
      if (token !== request.current || !alive.current) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRows(sortGoals(result.data.rows))
    })
  }, [nodeId])

  const node: MapNode | undefined = nodeById.get(nodeId)
  const name = node === undefined ? '' : localName(node, locale)

  /**
   * The rung a goal names, resolved for the reader — or null for the terminal
   * reading, which is what a NULL `stage_id` means and the commonest goal there
   * is.
   *
   * AN UNRESOLVED ID IS NOT THE TERMINAL READING. A goal whose rung the store
   * cannot resolve (0026 unapplied, or a ladder that has not loaded) still says
   * "at some rung or beyond", and falling back to "arrived by" would silently
   * show a DIFFERENT promise than the one that was made. `managerLabel`'s rule,
   * one field over: an id the roster does not know is a person who left, not
   * nobody.
   */
  const stageNameOf = useCallback(
    (stageId: string | null): string | null => {
      if (stageId === null) return null
      const stage: MapNodeStage | undefined = stageById.get(stageId)
      return stage === undefined ? t('mapnode.goalStageGone') : stageLabelOf(stage)
    },
    [stageById, stageLabelOf],
  )

  /**
   * The rungs the editor offers.
   *
   * HIDDEN RUNGS ARE OUT OF THE PICKER — `use_cases.hidden`'s contract — EXCEPT
   * the one this goal already names, which has to stay on the list or opening
   * the editor would silently rewrite the promise as soon as anything else is
   * saved.
   */
  const pickable = useCallback(
    (current: string | null): MapNodeStage[] =>
      stages.filter((stage) => !stage.hidden || stage.id === current),
    [stages],
  )

  const save = useCallback(
    async (id: string | null, input: MapNodeGoalInput): Promise<boolean> => {
      if (busy) return false
      setBusy(true)

      // CREATE IS NOT OPTIMISTIC, and the reason is that there is nothing honest
      // to be optimistic WITH: a new goal has no id until the server gives it
      // one, and a fabricated key is a row the next reconciliation cannot match.
      // The edit and delete paths below ARE optimistic, because both act on a row
      // that already exists and can be put back exactly as it was.
      if (id === null) {
        const result = await createGoal(input)
        if (!alive.current) return false
        setBusy(false)
        if (!result.ok) {
          toast(t(result.error), { tone: 'error' })
          return false
        }
        setRows((current) => sortGoals([...current, result.data]))
        toast(t('mapnode.goalAdded', { goal: goalName(result.data, locale) }), { tone: 'success' })
        return true
      }

      const before = rows
      const previous = before.find((row) => row.id === id)
      if (previous === undefined) {
        setBusy(false)
        return false
      }
      // The row as the server will hold it, applied before the round trip.
      const optimistic: MapNodeGoal = {
        ...previous,
        label: input.label,
        label_ar: input.labelAr,
        stage_id: input.stageId,
        target: input.target,
        target_date: input.targetDate,
      }
      setRows(sortGoals(before.map((row) => (row.id === id ? optimistic : row))))

      const result = await updateGoal(id, input)
      if (!alive.current) return true
      setBusy(false)
      if (!result.ok) {
        // ROLLED BACK TO THE EXACT LIST, not to a re-fetch: the reader is looking
        // at the row, and a refusal that left the new date on screen would be the
        // app agreeing to a promise the database refused.
        setRows(before)
        toast(t(result.error), { tone: 'error' })
        return false
      }
      setRows((current) => sortGoals(current.map((row) => (row.id === id ? result.data : row))))
      toast(t('mapnode.goalSaved', { goal: goalName(result.data, locale) }), { tone: 'success' })
      return true
    },
    [busy, locale, rows],
  )

  const remove = useCallback(
    async (goal: MapNodeGoal): Promise<void> => {
      if (busy) return
      const label = goalName(goal, locale)
      // THE CONFIRMATION NAMES THE GOAL. Several goals sit on one node by design
      // — one ramp at two altitudes — so "Delete this goal?" alone is a dialog
      // the reader cannot answer without counting rows.
      const ok = await confirm({
        title: t('mapnode.goalDeleteTitle'),
        body: t('mapnode.goalDeleteBody', { goal: label }),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      })
      if (!ok || !alive.current) return

      setBusy(true)
      const before = rows
      setRows(before.filter((row) => row.id !== goal.id))
      const result = await deleteGoal(goal.id)
      if (!alive.current) return
      setBusy(false)
      if (!result.ok) {
        setRows(before)
        toast(t(result.error), { tone: 'error' })
        return
      }
      toast(t('mapnode.goalDeleted', { goal: label }), { tone: 'success' })
    },
    [busy, locale, rows],
  )

  return (
    <GoalBand
      nodeId={nodeId}
      name={name}
      goals={rows}
      readings={readings}
      stageNameOf={stageNameOf}
      pickable={pickable}
      canEdit={canEdit}
      busy={busy}
      loading={loading}
      error={error}
      onSave={save}
      onDelete={remove}
    />
  )
}

/* ── the render ────────────────────────────────────────────────────────── */

export interface GoalBandProps {
  nodeId: string
  /** The branch's own name, already resolved for the locale. */
  name: string
  goals: readonly MapNodeGoal[]
  readings?: ReadonlyMap<string, GoalReading>
  /** Null is the terminal reading; see `stageNameOf` for why it is not a miss. */
  stageNameOf: (stageId: string | null) => string | null
  pickable: (current: string | null) => MapNodeStage[]
  canEdit: boolean
  busy: boolean
  loading: boolean
  /** An i18n key from api/goals.ts, never a sentence. */
  error: string | null
  onSave: (id: string | null, input: MapNodeGoalInput) => Promise<boolean>
  onDelete: (goal: MapNodeGoal) => Promise<void>
  /** Today, injectable so the days-left arithmetic can be pinned in a test. */
  now?: Date
}

/**
 * The band as markup, split out on `DetailBand`'s precedent and for its reason:
 * `vitest.config.ts` is `environment: 'node'`, effects do not run under
 * `renderToStaticMarkup`, and a test of the connected component alone could only
 * ever prove the loading state.
 *
 * IT HOLDS THE EDITOR'S OPEN/CLOSED STATE AND NOTHING ELSE. Which goal is being
 * edited is a fact about this piece of glass; the rows, the permission and the
 * writes all arrive as props, so nothing here can disagree with the store about
 * what was saved.
 */
export function GoalBand({
  nodeId,
  name,
  goals,
  readings,
  stageNameOf,
  pickable,
  canEdit,
  busy,
  loading,
  error,
  onSave,
  onDelete,
  now,
}: GoalBandProps): ReactElement {
  const locale = useLocale()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // THE CLOCK IS READ ONCE PER RENDER, at the top, and handed down. A row that
  // asked for `todayIso()` itself would let a list rendered across midnight
  // count two different days, which is the one way "3 days left" and "2 days
  // left" can appear in one band about one date.
  const today = todayIso(now ?? new Date())

  // A missing table is the pre-migration state, not a fault: it renders as the
  // empty band. Every other error is shown. See MISSING_TABLE.
  const shown = error === MISSING_TABLE ? null : error
  const settled = !loading && shown === null

  return (
    <section className="mbr-band mbr-goals" aria-label={t('mapnode.goals')}>
      <div className="mbr-band-head">
        <h3 className="section-title">{t('mapnode.goals')}</h3>
        {/* ABSENT FOR A MEMBER, never disabled. The three account managers read
            this band; the two Associate Directors write it. */}
        {canEdit && !adding && (
          <button
            type="button"
            className="btn btn-sm btn-ghost mbr-goal-add tap-44"
            disabled={busy}
            onClick={() => {
              setAdding(true)
              setEditing(null)
            }}
          >
            {t('mapnode.goalAdd')}
          </button>
        )}
      </div>

      {/* ONE LIVE REGION FOR THE WHOLE ASYNC RESULT, `.mbr-uc-head`'s rule one
          band up: a reader hears one sentence per load rather than a skeleton and
          a heading in two announcements. */}
      {!settled && (
        <p className="mbr-goal-head" role="status">
          {loading ? (
            <span>{t('common.loading')}</span>
          ) : (
            <span className="mbr-note">{t(shown as string)}</span>
          )}
        </p>
      )}

      {adding && (
        <GoalEditor
          nodeId={nodeId}
          goal={null}
          pickable={pickable}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={async (id, input) => {
            const ok = await onSave(id, input)
            if (ok) setAdding(false)
            return ok
          }}
        />
      )}

      {goals.length > 0 && (
        <ul className="mbr-goal-list" aria-label={t('mapnode.goalsFor', { name })}>
          {goals.map((goal) =>
            editing === goal.id ? (
              <li key={goal.id} className="mbr-goal mbr-goal-editing">
                <GoalEditor
                  nodeId={nodeId}
                  goal={goal}
                  pickable={pickable}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={async (id, input) => {
                    const ok = await onSave(id, input)
                    if (ok) setEditing(null)
                    return ok
                  }}
                />
              </li>
            ) : (
              <GoalRow
                key={goal.id}
                goal={goal}
                reading={readings?.get(goal.id)}
                stageName={stageNameOf(goal.stage_id)}
                today={today}
                locale={locale}
                canEdit={canEdit}
                busy={busy}
                onEdit={() => {
                  setEditing(goal.id)
                  setAdding(false)
                }}
                onDelete={() => void onDelete(goal)}
              />
            ),
          )}
        </ul>
      )}

      {/* THE STATE EVERY NODE IS IN ON THE DAY 0027 APPLIES, and it names itself
          rather than showing a dash: a band that is empty because nobody has
          promised anything and a band that is empty because the read failed must
          not look alike. */}
      {settled && goals.length === 0 && !adding && (
        <EmptyState title={t('mapnode.goalsNone')} description={t('mapnode.goalsNoneHint')} />
      )}
    </section>
  )
}

/* ── one goal ──────────────────────────────────────────────────────────── */

interface GoalRowProps {
  goal: MapNodeGoal
  reading: GoalReading | undefined
  stageName: string | null
  today: IsoDate
  locale: Locale
  canEdit: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}

function GoalRow({
  goal,
  reading,
  stageName,
  today,
  locale,
  canEdit,
  busy,
  onEdit,
  onDelete,
}: GoalRowProps): ReactElement {
  const date = formatDate(goal.target_date, locale)
  const label = goalName(goal, locale)
  // `diffDays(a, b)` is `b - a`, so this is "the date minus today" — positive
  // ahead, negative past. The clamp and the wording are goalClock's.
  const clock = goalClock(diffDays(today, goal.target_date))

  const behind =
    reading !== undefined && goal.target !== null ? Math.max(0, goal.target - reading.reached) : 0

  /**
   * The promise, with whatever stands in for the number that has been reached.
   *
   * ONE FUNCTION AND FOUR KEYS, because the sentence is rendered TWICE when the
   * number is not known — once for the eye and once for the ear — and two copies
   * of a four-way branch is where the two sentences start disagreeing.
   */
  const sentenceWith = (reached: string): string =>
    goal.target !== null
      ? stageName !== null
        ? t(GOAL_SENTENCE.countStage, { reached, target: goal.target, stage: stageName, date })
        : t(GOAL_SENTENCE.count, { reached, target: goal.target, date })
      : stageName !== null
        ? t(GOAL_SENTENCE.stage, { stage: stageName, date })
        : t(GOAL_SENTENCE.date, { date })

  // THE EM-DASH IS FOR NO-DATA AND NEVER FOR ZERO. Nothing has folded the
  // descendants yet, and "0 of 40" would report forty organizations as having
  // got nowhere on the strength of an arithmetic that has not run.
  //
  // The dash is what Aziz reads and the WORD is what a screen reader says —
  // `NotRecorded`'s rule, applied to a dash that sits inside an interpolation
  // and so cannot carry an `.sr-only` sibling of its own. A dash is announced as
  // nothing by most screen readers, which would turn this into "of 40 arrived
  // by 31 December": a sentence with a hole where its subject was.
  const sentence = reading === undefined ? sentenceWith(EM_DASH) : sentenceWith(String(reading.reached))
  const spoken = reading === undefined ? sentenceWith(t('mapnode.notRecorded')) : null

  return (
    <li className="mbr-goal" data-tone={clock.tone}>
      <div className="mbr-goal-main">
        {/* Database text, isolated: an Arabic goal name beside a Latin rung name
            must not drag the row's punctuation across. An unnamed goal renders no
            heading at all — the sentence below already says what it is. */}
        {goal.label.trim() !== '' || goal.label_ar.trim() !== '' ? (
          <p className="mbr-goal-name">{isolate(label)}</p>
        ) : null}
        <p className="mbr-goal-say">
          {spoken === null ? (
            <span>{sentence}</span>
          ) : (
            <>
              <span aria-hidden="true">{sentence}</span>
              <span className="sr-only">{spoken}</span>
            </>
          )}
          {behind > 0 && (
            <>
              {/* A SEPARATOR, hidden from the reader who is being read to: the
                  two clauses are announced as two, which is what they are. */}
              <span aria-hidden="true"> {EM_DASH} </span>
              <span className="mbr-goal-behind">{t('mapnode.goalBehind', { count: behind })}</span>
            </>
          )}
        </p>
        {/* "0 of 40" alone is a number the AD would chase the wrong thing about;
            "380 with no stage recorded" is the actionable half of the same fact. */}
        {reading !== undefined && reading.unstaged > 0 && (
          <p className="mbr-goal-unstaged">
            {t('mapnode.goalUnstaged', { count: reading.unstaged })}
          </p>
        )}
      </div>

      <span className="pill mbr-goal-clock tabular" data-tone={clock.tone}>
        {t(clock.key, { count: clock.count })}
      </span>

      {canEdit && (
        <div className="mbr-goal-acts">
          {/* NAMED, both of them: several goals sit on one node, so "Edit" alone
              is a control a screen-reader user cannot tell from the next one. */}
          <button
            type="button"
            className="btn btn-sm btn-ghost tap-44"
            disabled={busy}
            aria-label={t('mapnode.goalEditOne', { goal: label })}
            onClick={onEdit}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost tap-44"
            disabled={busy}
            aria-label={t('mapnode.goalDeleteOne', { goal: label })}
            onClick={onDelete}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </li>
  )
}

/* ── the editor ────────────────────────────────────────────────────────── */

/** The form's own state: every field a string, because that is what an input holds. */
interface GoalDraft {
  label: string
  labelAr: string
  /** `''` is the terminal reading — the goal names no rung. */
  stageId: string
  /** `''` is a date goal about the branch itself, NOT a target of zero. */
  target: string
  targetDate: string
}

function draftOf(goal: MapNodeGoal | null): GoalDraft {
  if (goal === null) return { label: '', labelAr: '', stageId: '', target: '', targetDate: '' }
  return {
    label: goal.label,
    labelAr: goal.label_ar,
    stageId: goal.stage_id ?? '',
    target: goal.target === null ? '' : String(goal.target),
    targetDate: goal.target_date,
  }
}

/**
 * What the form refuses before the round trip — field → error key.
 *
 * THE KEYS ARE api/goals.ts's AND lib/pgError.ts's, not new ones, so the sentence
 * an AD reads is the same whether the client caught it or the database did. That
 * is the whole reason `GOAL_LABEL_MAX` is exported from the api module: two
 * numbers that must agree, in one place, with the CHECK constraint's own value
 * written beside it there.
 */
function validate(draft: GoalDraft): Partial<Record<keyof GoalDraft, string>> {
  const problems: Partial<Record<keyof GoalDraft, string>> = {}
  if (draft.label.length > GOAL_LABEL_MAX) problems.label = 'mapadmin.errGoalLabelLength'
  if (draft.labelAr.length > GOAL_LABEL_MAX) problems.labelAr = 'mapadmin.errGoalLabelArLength'
  // THROUGH lib/dates, never `new Date(value)`: an `<input type="date">` hands
  // back `''` when it is empty and an out-of-range year when somebody types one,
  // and `parseIsoDate` is the repo's one answer to both.
  if (parseIsoDate(draft.targetDate) === null) problems.targetDate = 'mapnode.goalErrDate'
  const target = draft.target.trim()
  if (target !== '') {
    const n = Number(target)
    // A goal of 0 reads as permanently met and a fraction is not a count of
    // organizations. 0027 refuses both; this says so without a round trip.
    if (!Number.isInteger(n) || n <= 0) problems.target = 'mapadmin.errGoalTarget'
  }
  return problems
}

interface GoalEditorProps {
  nodeId: string
  /** Null adds; a row edits it. */
  goal: MapNodeGoal | null
  pickable: (current: string | null) => MapNodeStage[]
  busy: boolean
  onCancel: () => void
  onSave: (id: string | null, input: MapNodeGoalInput) => Promise<boolean>
}

function GoalEditor({
  nodeId,
  goal,
  pickable,
  busy,
  onCancel,
  onSave,
}: GoalEditorProps): ReactElement {
  // Subscribed, not read: the rung names in the select and every label around
  // them are `t()`'d at render, so this form has to re-render when the language
  // changes. `DetailBand` opens with the same line for the same reason.
  useLocale()
  const stageLabelOf = useStageLabel()
  const [draft, setDraft] = useState<GoalDraft>(() => draftOf(goal))
  // Errors appear on submit rather than on the first keystroke: a form that turns
  // red while somebody is still typing the first character of a date is a form
  // that reads as broken.
  const [submitted, setSubmitted] = useState(false)
  const problems = useMemo(() => validate(draft), [draft])
  const id = `mbr-goal-${goal?.id ?? 'new'}`
  const options = pickable(goal?.stage_id ?? null)

  function submit(): void {
    setSubmitted(true)
    if (Object.keys(problems).length > 0) return
    void onSave(goal?.id ?? null, {
      nodeId,
      label: draft.label,
      labelAr: draft.labelAr,
      // `''` OUT, null IN. The select's empty option is the terminal reading and
      // the number field's empty string is a date goal — both are meanings, and
      // both would arrive at PostgREST as the literal empty string if this line
      // were not here.
      stageId: draft.stageId === '' ? null : draft.stageId,
      target: draft.target.trim() === '' ? null : Number(draft.target),
      targetDate: draft.targetDate,
    })
  }

  return (
    <form
      className="mbr-goal-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor={`${id}-label`}>
          {t('mapnode.goalLabelField')}
        </label>
        <input
          id={`${id}-label`}
          className="input"
          type="text"
          value={draft.label}
          maxLength={GOAL_LABEL_MAX}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        />
        {submitted && problems.label !== undefined && (
          <p className="field-error">{t(problems.label)}</p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-label-ar`}>
          {t('mapnode.goalLabelArField')}
        </label>
        <input
          id={`${id}-label-ar`}
          className="input"
          type="text"
          dir="rtl"
          value={draft.labelAr}
          maxLength={GOAL_LABEL_MAX}
          onChange={(e) => setDraft((d) => ({ ...d, labelAr: e.target.value }))}
        />
        {submitted && problems.labelAr !== undefined && (
          <p className="field-error">{t(problems.labelAr)}</p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-stage`}>
          {t('mapnode.goalStageField')}
        </label>
        <select
          id={`${id}-stage`}
          className="select"
          value={draft.stageId}
          onChange={(e) => setDraft((d) => ({ ...d, stageId: e.target.value }))}
        >
          {/* THE EMPTY OPTION IS A MEANING, not a placeholder: "any rung that
              counts as arrived" is the commonest goal there is, and 0027 stores
              it as a NULL `stage_id`. */}
          <option value="">{t('mapnode.goalStageAny')}</option>
          {options.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stageLabelOf(stage)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-target`}>
          {t('mapnode.goalTargetField')}
        </label>
        <input
          id={`${id}-target`}
          className="input tabular"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={draft.target}
          onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))}
        />
        {submitted && problems.target !== undefined ? (
          <p className="field-error">{t(problems.target)}</p>
        ) : (
          <p className="mbr-hint">{t('mapnode.goalTargetHint')}</p>
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-date`}>
          {t('mapnode.goalDateField')}
        </label>
        <input
          id={`${id}-date`}
          className="input"
          type="date"
          value={draft.targetDate}
          onChange={(e) => setDraft((d) => ({ ...d, targetDate: e.target.value }))}
        />
        {submitted && problems.targetDate !== undefined && (
          <p className="field-error">{t(problems.targetDate)}</p>
        )}
      </div>

      <div className="mbr-goal-form-acts">
        <button type="submit" className="btn btn-sm btn-primary tap-44" disabled={busy}>
          {t('common.save')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost tap-44"
          disabled={busy}
          onClick={onCancel}
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
