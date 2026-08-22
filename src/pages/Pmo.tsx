// THE PMO DASHBOARD (/pmo) — delivery, follow-ups and risk, for a director.
//
// ── IT IS OUTSIDE THE LENS SYSTEM, AND THAT IS THE WHOLE DESIGN ────────────
//
// No new `MapLens`, no new `MapStage`, no new `PanelSubject`, and not one line
// of lib/mindtree/lens.ts. That union is closed with no `default:` anywhere by
// written policy, so a seventh lens costs six sites in lens.ts, nine
// exhaustiveness assertions in lens.test.ts and both locale bundles — and the
// Portfolio lens itself shipped with ZERO new `PanelSubject` by falling through
// onto `shape`'s arm. This page takes that precedent one step further and does
// not touch the union at all: it is a ROUTE, with its own row in `NAV`, and the
// map does not know it exists.
//
// `PortfolioStage` IS NOT REMOUNTED HERE, deliberately. Its props are the whole
// Mindtree shell — `root: MindNode`, `FilterState`, `onNarrow`, the URL-mirrored
// `view`, `terminalKey`, `managerNameOf`, `onOpenNode`. `onNarrow` is the
// filter WRITER, and PortfolioStage's own note says the spelling is load
// bearing: there is exactly one call site for it in the app
// (`pages/Mindtree.tsx`, `onNarrow={setFilter}`) because there is exactly one
// piece of filter state, mirrored into the address bar by useMapUrl. Mounting
// that component from a second route would mint a second writer over state this
// page does not own and cannot mirror. So this page composes thin sections over
// the same AGGREGATES instead: `lib/portfolio/fields`'s
// `stageReading` for the stage clock (the identical function the map card, the
// portfolio table, the chip badge and the org panel read), `lib/aggregate` for
// throughput and compliance, `lib/entrySections.bucketFollowUps` for the
// buckets, and `lib/pmo/summary` for the fold over them.
//
// ── DRILL-DOWN IS LINKS, NOT PANELS ────────────────────────────────────────
//
// A row goes to `/entry/:id` or to the portfolio table narrowed to one
// organization. THE ORGANIZATION LINK CARRIES `?node=<uuid>`, NOT `?focus=`,
// and that is a correction to the brief rather than a shortcut. A `?focus=` id
// is a PATH — `root/track:<id>/entity:<id>/…`, percent-encoded, assembled by
// model.ts's private `nodeId()` from the tree this page deliberately does not
// build. Re-implementing that encoder here would be a second arithmetic for one
// answer, and it would fail SILENTLY: `resolveFocus` is total and falls back to
// the longest prefix that still exists, so a wrong path lands the reader on the
// root of the map looking like it worked. `?node=` is the codec-validated facet
// `filterForOrgRow` itself writes, `portfolioShowsRows` reads it explicitly to
// switch the table to organization rows, and lib/entryFilter's param table is
// the one place its spelling lives.
//
// NO PERMISSION KEY, on pages/settings/Export.tsx's argument in its own words:
// the thing being protected is already protected. RLS decides what SELECT
// returns, and every row on this page is a row the reader can already reach from
// the map. Gating it would withhold a COPY of data they can read, which is
// theatre rather than a control.
//
// ── THE RULE THAT DECIDES WHAT MAY APPEAR ──────────────────────────────────
//
// ⚠ NO KPI RENDERS FROM A METRIC WHOSE INPUTS ARE UNCONFIGURED. lib/pmo/summary
//   carries the argument at length; the consequence here is that the lateness
//   card is a five-armed switch over `LatenessVerdict` and not a number with a
//   caption, and that the compliance card reads `SlaCompliance.rate === null`
//   as a sentence rather than as 0%. The live workspace is exactly the state
//   that makes this matter: eighty-five organizations, fifty staged, every
//   `stage_changed_at` written by the import that created it, so "0 at risk" is
//   true arithmetic and a false sentence.
//
// ── THE THREE THINGS THIS PAGE IS ABOUT, AND WHAT EACH ONE *IS* ───────────
//
// A PROJECT IS AN ORGANIZATION NODE. There is no `projects` table and there must
// not be one: `map_nodes` already carries the name, the parent, the account
// manager, the vendor and — through `map_node_progress` — where it has got to.
// A second table would be a second answer to "which organizations are we
// delivering to". The card grid is `buildDeliveryRows`, the fold the deleted
// five-column table used, drawn as cards because a director reads an
// organization as a THING and not as a row of cells.
//
// AN INITIATIVE IS A `map_node_goals` ROW (0027). This is the only date-bounded,
// scoped, measurable commitment the schema holds, and measurable is the load
// bearing word: `goalProgress` reads it against the same stage records the map
// shows, so this page and the org panel cannot disagree about how far a promise
// has got. Nothing else could fill the source document's Initiatives tab without
// inventing a denominator.
//
// AN ACTION IS AN `entries` ROW OF TYPE `action`. The register beneath the cards
// lists every OPEN one, and the six follow-up buckets stay underneath it as
// TRIAGE. Before the register existed, an action that was on track, assigned and
// not due soon appeared NOWHERE on this page — the buckets take only what needs
// chasing and the two risk tables read `issue` and `escalation` alone.
//
// ── THE ONE PERCENTAGE THIS SCHEMA CAN EARN, AND HOW IT IS WORDED ──────────
//
// Capability coverage: `progressByNode` over the links `store/portfolio` reads,
// against the whole catalogue, counted at `TERMINAL_STATUS`. It is drawn as a
// bar and SPOKEN as `mapnode.progress` — "⁨6⁩ of 9 ⁨live⁩", the identical sentence
// the org panel prints, unit word included.
//
// ⚠ THERE IS NO BARE `%` ON A CARD, and that is not a style preference.
//   `UseCaseProgress.total` is the whole visible CATALOGUE, not the scope
//   anybody recorded for this organization — which is exactly why the shape
//   carries `linked` as a third number. An organization that linked three
//   capabilities and has all three live is FINISHED, and "33%" would tell a
//   director it is a third of the way there. So: `linked === 0` renders a dash
//   and a sentence and never "0 of 9"; `linked < total` renders the ratio with
//   `pmo.projRecorded` beside it, naming how many were ever recorded; and the
//   naked percentage is never printed at all.
//
// The source document's per-task percentage has no home here for the same
// reason: `entries` has no such column and no subtask table stands behind one,
// so "in progress = 50%" would be a number nobody typed.
//
// EMPTY IS THE DAY-ONE STATE AND IS DESIGNED FIRST. The workspace holds nine
// entries; a page that only reads well at volume would be wrong for its whole
// first month. Every section below has an empty arm, and the page as a whole has
// one for a workspace with nothing captured at all.
//
// NOT IN THIS BUILD, and each for a reason rather than an omission: revenue
// (there is no money anywhere in the schema), the document store (there is no
// file storage anywhere, and the privacy policy forbids attachments), PDF/PPT
// export (new runtime dependencies), and Jira (`jira_settings.enabled` is false
// and the integration has never connected — a panel that renders DISABLED would
// advertise a feature nobody can turn on, and 0028's contract is that it renders
// ABSENT until `useJiraEnabled()` is true).

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AgingChart, ThroughputChart } from '../components/charts'
import { EmptyState } from '../components/shared'
import { toast } from '../components/toast'
// THE ONE RESOLVER FOR "who is accountable", imported rather than restated. An
// id the roster does not know is NOT the same fact as no manager — it is a
// person who has left, or a members store that has not landed — and rendering
// an em-dash for it would report an accountable organization as an
// unaccountable one. That distinction is four lines long and already written,
// tested and worded (`mapnode.managerGone`); a second copy here would agree
// until the day one of them was edited. The import costs this route's chunk a
// module it shares with the map, which is the cheap half of the trade.
// …and for the same reason, three more from the same band: the terminal status
// literal, the WORD it wears inside the "⁨6⁩ of 9 ⁨live⁩" sentence, and a goal's
// name in this locale with the unnamed fallback already worded. lib/mapNodes.ts's
// header asks for `TERMINAL_STATUS` to live at exactly one call site; the other
// two would each be a second copy of a decision somebody already made.
import {
  goalName,
  managerLabel,
  STATUS_WORD,
  TERMINAL_STATUS,
} from '../components/map/MapBranchDetail'
import { IconClipboardList } from '../components/icons'
import {
  agingHistogram,
  slaCompliance,
  throughputByWeek,
  type AgeBasis,
  type SlaCompliance,
} from '../lib/aggregate'
import { addDays, formatDate, weekBounds } from '../lib/dates'
import { bucketFollowUps, type FollowUpSections } from '../lib/entrySections'
import { t, useLocale, type Locale } from '../lib/i18n'
import { useNodeLabel, useStageLabel } from '../lib/labels'
import { progressByNode, stageIndex, type UseCaseProgress } from '../lib/mapNodes'
import {
  bucketRisks,
  buildActionRows,
  buildDeliveryRows,
  buildInitiativeRows,
  latenessVerdict,
  projectStatus,
  stageReadiness,
  RISK_TYPES,
  type ActionRow,
  type DeliveryRow,
  type InitiativeRow,
  type LatenessVerdict,
  type ProjectStatus,
  type RiskRow,
  type RiskSeverity,
  type RiskType,
} from '../lib/pmo/summary'
import { isOpen } from '../lib/health'
import {
  loadConfig,
  useAllUseCases,
  useMapNodes,
  useNodeProgress,
  useStageMap,
} from '../store/config'
import { loadGoals, useGoals, useGoalsError } from '../store/goals'
import { loadPortfolio, usePortfolioLinks } from '../store/portfolio'
import {
  countEntries,
  loadClosedSince,
  loadEntries,
  useEntryList,
  useFilterContext,
  useHealthMap,
  useTrackSlaMatrix,
} from '../store/entries'
import { loadMembers, useMemberMap } from '../store/members'
import { mergeProgress, usePendingStages } from '../store/stageOverlay'
import { useSlaDays, useStaleDays } from '../store/vocab'
import type { Entry, MapNodeGoal } from '../types'
import './pmo.css'

/**
 * How many weeks the two windowed panels cover.
 *
 * A CONSTANT, not a control, and that is the difference between this page and
 * the Numbers lens. That surface exists to be tuned — it carries a week picker
 * and a module-level store so the tile and the chart under it can never
 * disagree. This one is a standing morning read: a director opens it, looks, and
 * leaves. Eight weeks is `NumbersStage`'s own default and the range every chart
 * here names out loud in its own description.
 */
const WINDOW_WEEKS = 8

/** How many organizations the card grid draws before deferring to the portfolio. */
const PROJECT_CARDS = 12

/** How many commitments the initiative table lists. */
const INITIATIVE_ROWS = 12

/** How many actions the register lists before deferring to the attention screen. */
const ACTION_ROWS = 12

/** How many rows each risk table prints. */
const RISK_ROWS = 8

/** How many items each follow-up bucket names. */
const BUCKET_ROWS = 4

/**
 * The workspace-wide floor under a rung's own expectation.
 *
 * NULL, matching every other caller in the app (`useMapModel`,
 * `MapBranchDetail`, `PortfolioStage`). `resolveStallDays` takes it as an
 * ARGUMENT rather than a constant precisely so that a policy number lives at the
 * call site that owns the policy — and nobody has stated one. Inventing
 * "anything over 90 days" here would be this page asserting a threshold the
 * workspace never agreed to, and every organization would go red on a number a
 * reader could not find anywhere in Settings.
 */
const FALLBACK_STALL_DAYS: number | null = null

/** Frozen empty, so an absent context map is one stable identity per render. */
const EMPTY_ANCESTRY: ReadonlyMap<string, readonly string[]> = new Map()

/* ══════════════════════════ the page ══════════════════════════ */

export default function Pmo(): ReactElement {
  const locale = useLocale()
  const nodeLabel = useNodeLabel()
  const stageLabel = useStageLabel()
  const memberMap = useMemberMap()

  const entries = useEntryList()
  const health = useHealthMap()
  const ctx = useFilterContext()
  const staleDays = useStaleDays()
  const slaDefault = useSlaDays()
  const slaMatrix = useTrackSlaMatrix()

  const nodes = useMapNodes()
  const stageById = useStageMap()
  const progress = useNodeProgress()
  const pending = usePendingStages()

  // HIDDEN ROWS INCLUDED, because this is a DENOMINATOR. `useUseCases()` is the
  // visible slice an editor picks from; a coverage ratio that dropped a retired
  // capability an organization is still recorded against would count its numerator
  // and not its denominator. `useCaseProgress` already puts a hidden-but-linked
  // row back on the table and marks it retired.
  const catalogue = useAllUseCases()
  const links = usePortfolioLinks()
  const goals = useGoals()
  const goalsError = useGoalsError()

  const [params] = useSearchParams()
  /** `/pmo?entry=<id>` — one URL, one behaviour: that row is ringed. */
  const focusEntry = params.get('entry')

  const [basis, setBasis] = useState<AgeBasis>('created')

  const { from, to } = useMemo(() => {
    const current = weekBounds(new Date(), 0)
    return { from: addDays(current.from, -7 * (WINDOW_WEEKS - 1)), to: current.to }
  }, [])

  // Every one of these dedupes in its own store and none of them throws, so they
  // are safe to fire unawaited from an effect. Config and members are warmed by
  // Shell already; they are repeated here for the reason NumbersPanel repeats
  // them — this page must be right on arrival, and a reader can land on it
  // through a pasted link before the shell's warm has settled.
  useEffect(() => {
    void loadConfig()
    void loadMembers()
    void loadEntries()
  }, [])

  useEffect(() => {
    void loadClosedSince(from)
  }, [from])

  /**
   * The two reads this page adds, and the two stores that refuse to make anyone
   * else pay for them.
   *
   * NEITHER RUNS ON BOOT. `loadPortfolio` is ~4,000 capability links and
   * `loadGoals` is the whole commitments table; both dedupe, neither throws, and
   * both are called from an effect on the one surface that wants them —
   * store/portfolio.ts's contract, which store/goals.ts copies verbatim.
   *
   * The empty `nodeIds` of the first cold tick is not a load: `loadPortfolio`
   * refuses it rather than stamping its clock on nothing.
   */
  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes])
  useEffect(() => {
    void loadPortfolio(nodeIds)
  }, [nodeIds])

  useEffect(() => {
    void loadGoals()
  }, [])

  /**
   * Open work at or under every node, folded off `FilterContext.ancestryOfNode`.
   *
   * THE SAME WALK THE FILTER USES, which is what makes the number in the table
   * and the number a reader lands on after tapping the row the same number. A
   * private parent walk here would be a second answer to one question.
   */
  const openByNode = useMemo(() => {
    const ancestry = ctx.ancestryOfNode ?? EMPTY_ANCESTRY
    const out = new Map<string, number>()
    for (const entry of entries) {
      if (!isOpen(entry.status)) continue
      if (entry.node_id === null) continue
      for (const id of ancestry.get(entry.node_id) ?? []) {
        out.set(id, (out.get(id) ?? 0) + 1)
      }
    }
    return out
  }, [entries, ctx.ancestryOfNode])

  // HOISTED OUT OF `delivery`, because two sections read them now. The stage
  // index answers "which rung is this node on, and what does that rung mean",
  // and the cards and the initiatives must ask it once: two calls would be two
  // answers to one question the moment an optimistic rung is in flight.
  const merged = useMemo(() => mergeProgress(progress, pending), [progress, pending])
  const stages = useMemo(() => stageIndex(merged, stageById), [merged, stageById])

  const delivery = useMemo(() => {
    // `ctx.today` rather than `Date.now()` in the dependency list, on
    // `useAtRiskCount`'s reasoning: the fold's only use of the clock is whole
    // calendar days, so re-running it per render would recompute every row to
    // produce the same integers.
    const now = new Date()
    return buildDeliveryRows({
      nodes,
      stages,
      progressById: merged,
      fallbackStallDays: FALLBACK_STALL_DAYS,
      now,
      labelOf: nodeLabel,
      openByNode,
      managerOfNode: ctx.managerOfNode ?? new Map(),
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, stages, merged, nodeLabel, openByNode, ctx.managerOfNode, ctx.today])

  const readiness = useMemo(() => stageReadiness(delivery), [delivery])
  const verdict = useMemo(() => latenessVerdict(readiness), [readiness])

  /**
   * Capability coverage per organization — the page's one earned percentage.
   *
   * NULL WHILE NOBODY HAS LOOKED, and it stays null on a failed read: a card
   * that drew an empty bar for an organization whose links had not landed would
   * report "nothing integrated" about a workspace that is simply still reading.
   *
   * `progressByNode` buckets the links ONCE and reuses `useCaseProgress` per
   * node. A per-node `filter()` over four thousand links is the O(n²) that makes
   * an eighty-five-organization workspace feel broken.
   */
  const coverage = useMemo<ReadonlyMap<string, UseCaseProgress> | null>(
    () => (links === null ? null : progressByNode(links, nodes, catalogue, TERMINAL_STATUS)),
    [links, nodes, catalogue],
  )

  const counts = useMemo(
    () => countEntries(entries, health, ctx.today, addDays(ctx.today, 7)),
    [entries, health, ctx.today],
  )

  const sections = useMemo(
    () => bucketFollowUps(entries, health, { meId: ctx.meId, today: ctx.today, staleDays }),
    [entries, health, ctx.meId, ctx.today, staleDays],
  )

  const risks = useMemo(() => bucketRisks(entries, health, ctx.today), [entries, health, ctx.today])

  const register = useMemo(
    () => buildActionRows(entries, health, ctx.today),
    [entries, health, ctx.today],
  )

  /**
   * A goal's name in this locale, with 0027's unnamed fallback already worded.
   *
   * `''` IS A LEGAL GOAL LABEL — the date and the target already say what the
   * commitment is — so a row that showed nothing would be a row a reader cannot
   * refer to. `goalName` is the org panel's own resolver, imported for the
   * reason `managerLabel` is.
   */
  const goalLabelOf = useMemo(() => {
    return (goal: MapNodeGoal): string => goalName(goal, locale)
  }, [locale])

  /** NULL IS "NOBODY HAS LOOKED" ALL THE WAY THROUGH — never coerced to `[]`. */
  const initiatives = useMemo<InitiativeRow[] | null>(() => {
    if (goals === null) return null
    return buildInitiativeRows({
      goals,
      nodes,
      stages,
      today: ctx.today,
      labelOf: nodeLabel,
      goalLabelOf,
    })
  }, [goals, nodes, stages, ctx.today, nodeLabel, goalLabelOf])

  const throughput = useMemo(() => throughputByWeek(entries, from, to), [entries, from, to])

  const aging = useMemo(
    () => agingHistogram(entries, health, ctx.today, basis),
    [entries, health, ctx.today, basis],
  )

  const sla = useMemo(
    () =>
      slaCompliance(entries, {
        overrides: slaMatrix,
        priorityDefault: slaDefault,
        from,
        to,
      }),
    [entries, slaMatrix, slaDefault, from, to],
  )

  const stageNameOf = useMemo(() => {
    return (stageId: string | null): string | null => {
      if (stageId === null) return null
      const stage = stageById.get(stageId)
      return stage === undefined ? null : stageLabel(stage)
    }
  }, [stageById, stageLabel])

  const managerNameOf = useMemo(() => {
    return (id: string | null): string | null => managerLabel(memberMap, id)
  }, [memberMap])

  // THE WHOLE-PAGE EMPTY ARM, and it is first because it is the day-one state.
  // Nine entries is a small workspace; zero is a new one, and a screen of tiles
  // all reading 0 with two flat charts under them says nothing true that this
  // sentence does not say better.
  //
  // The commitments join the test with `?? 0` rather than `?.length === 0`: a
  // workspace whose goals have not landed yet is not a workspace with none, but
  // it is also not a reason to draw five sections of nothing.
  const blank = entries.length === 0 && delivery.length === 0 && (initiatives?.length ?? 0) === 0

  /**
   * THE SECOND HALF OF THE HONESTY GATE, resolved once for the two surfaces that
   * carry it.
   *
   * Non-null means every organization the lateness question can be asked of had
   * its stage clock started on ONE day — the fingerprint of a bulk import, since
   * fieldwork does not move fifty organizations onto seven rungs at one instant.
   * `stage_changed_at` is written only by `map_node_progress_stage_stamp()`, so
   * an import stamps every row with a single `now()`, and every day counter on
   * this page then measures TIME SINCE THE IMPORT rather than time on a rung.
   *
   * The counts stay — they are true of what is recorded — and this sentence goes
   * beside them, so a director reading "3 past their stage" knows what the clock
   * was started by. See `StageReadiness.clockStartedTogether`.
   */
  const sharedClock =
    readiness.clockStartedTogether === null
      ? null
      : t('pmo.lateOneClock', { date: formatDate(readiness.clockStartedTogether, locale) })

  return (
    <div className="pmo">
      <header className="pmo-head">
        <h1 className="page-title">{t('pmo.title')}</h1>
        <p className="page-subtitle">{t('pmo.subtitle')}</p>
        <p className="muted pmo-asof">
          {t('pmo.asOf', { time: formatDate(ctx.today, locale) })}
        </p>
      </header>

      {blank ? (
        <EmptyState
          icon={<IconClipboardList size={28} />}
          title={t('pmo.empty')}
          description={t('pmo.emptyHint')}
          action={
            <Link className="btn btn-primary" to="/mindtree">
              {t('mindtree.title')}
            </Link>
          }
        />
      ) : (
        <>
          <Overview
            counts={counts}
            organizations={delivery.length}
            staged={readiness.staged}
            verdict={verdict}
            sharedClock={sharedClock}
            sla={sla}
            throughput={throughput}
            aging={aging}
            basis={basis}
            onBasis={setBasis}
            hasEntries={entries.length > 0}
          />
          <Initiatives rows={initiatives} failed={goalsError !== null} locale={locale} />
          <Projects
            rows={delivery}
            coverage={coverage}
            sharedClock={sharedClock}
            stageNameOf={stageNameOf}
            managerNameOf={managerNameOf}
          />
          <Actions
            rows={register}
            sections={sections}
            managerNameOf={managerNameOf}
            focusEntry={focusEntry}
            locale={locale}
          />
          <Risks risks={risks} />
        </>
      )}
    </div>
  )
}

/* ══════════════════════════ section 1 — overview ══════════════════════════ */

/** A titled block. One shape for all three sections, so they read as one page. */
function Section({
  id,
  title,
  desc,
  children,
}: {
  id: string
  title: string
  desc: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="pmo-section" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      <p className="muted pmo-desc">{desc}</p>
      {children}
    </section>
  )
}

/**
 * One headline number.
 *
 * NOT A LINK, unlike the Numbers lens's tiles, and the difference is honest
 * rather than lazy: those tiles jump by writing a lens AND a filter patch on the
 * surface they are already on, which this page is not on and must not reach
 * into. The drill from here is the section under it, which is a real list of
 * real rows with real links.
 */
function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: number
  note?: string
}): ReactElement {
  return (
    <div className="pmo-stat">
      <span className="pmo-stat-value tabular">{value}</span>
      <span className="pmo-stat-label">{label}</span>
      {note !== undefined && <span className="pmo-stat-note muted">{note}</span>}
    </div>
  )
}

function Overview({
  counts,
  organizations,
  staged,
  verdict,
  sharedClock,
  sla,
  throughput,
  aging,
  basis,
  onBasis,
  hasEntries,
}: {
  counts: ReturnType<typeof countEntries>
  organizations: number
  staged: number
  verdict: LatenessVerdict
  sharedClock: string | null
  sla: SlaCompliance
  throughput: ReturnType<typeof throughputByWeek>
  aging: ReturnType<typeof agingHistogram>
  basis: AgeBasis
  onBasis: (next: AgeBasis) => void
  hasEntries: boolean
}): ReactElement {
  return (
    <Section id="pmo-overview" title={t('pmo.overview')} desc={t('pmo.overviewDesc')}>
      <div className="pmo-stats card">
        <Stat label={t('dashboard.statOpen')} value={counts.open} />
        <Stat label={t('dashboard.statOverdue')} value={counts.overdue} />
        <Stat label={t('dashboard.statQuiet')} value={counts.stale} />
        <Stat label={t('dashboard.statBlocked')} value={counts.blocked} />
        <Stat label={t('dashboard.statUnassigned')} value={counts.unassigned} />
        <Stat
          label={t('pmo.organizations')}
          value={organizations}
          note={t('pmo.organizationsNote', { staged })}
        />
      </div>

      <div className="pmo-cards">
        <LatenessCard verdict={verdict} sharedClock={sharedClock} />
        <ComplianceCard sla={sla} />
      </div>

      {hasEntries && (
        <div className="pmo-charts">
          <ThroughputChart points={throughput} />
          <AgingChart histogram={aging} basis={basis} onBasis={onBasis} />
        </div>
      )}
    </Section>
  )
}

/**
 * THE HONESTY GATE, ON THE GLASS.
 *
 * A switch over the closed `LatenessVerdict` union with NO `default:` — the
 * rule lib/mindtree/lens.ts states and `jumpFor` follows: a sixth arm breaks
 * this at compile time rather than silently rendering nothing. Four of the five
 * arms print a SENTENCE and no number, because in four of the five states the
 * number would be a zero that claims we looked.
 */
function LatenessCard({
  verdict,
  sharedClock,
}: {
  verdict: LatenessVerdict
  /**
   * ⚠ MANDATORY WHEREVER IT IS NON-NULL. Every stage clock in this workspace was
   *   started on one day, so the two arms that print a day count are counting
   *   from that day and not from anything a person did. It qualifies the number;
   *   it does not replace it. See `sharedClock` in the page above.
   */
  sharedClock: string | null
}): ReactElement {
  switch (verdict.kind) {
    case 'no-organizations':
      return (
        <Verdict title={t('pmo.lateNoOrganizations')} body={t('pmo.lateNoOrganizationsHint')} />
      )
    case 'no-stage':
      return (
        <Verdict
          title={t('pmo.lateNoStage', { count: verdict.organizations })}
          body={t('pmo.lateNoStageHint')}
        />
      )
    case 'no-expectation':
      // `mindtree.portfolioNoThreshold` already says "No stage has been given a
      // time yet, so nothing can be past it" in both languages, and it is the
      // sentence the portfolio table prints for the identical state. Two strings
      // for one fact is how two screens come to describe the workspace
      // differently.
      return (
        <Verdict
          title={t('mindtree.portfolioNoThreshold')}
          body={t('pmo.lateNoExpectationHint')}
          action={
            <Link className="btn btn-sm" to="/settings/structure">
              {t('mindtree.portfolioNoThresholdAction')}
            </Link>
          }
        />
      )
    case 'too-early':
      return (
        <Verdict
          title={t('pmo.lateTooEarly')}
          // The key fences `{days}` itself (`⁨{days}⁩`), so the value goes in
          // raw — a second isolate here would nest a pair that buys nothing and
          // shows up in every string assertion downstream.
          body={t('pmo.lateTooEarlyHint', {
            days: t('mindtree.portfolioDays', { count: verdict.longestDays }),
          })}
          footer={t('pmo.lateMeasured', { count: verdict.measurable })}
          caveat={sharedClock}
        />
      )
    case 'late':
      return (
        <div className="card pmo-verdict">
          <p className="pmo-verdict-title">{t('pmo.lateTitle')}</p>
          <p className="pmo-verdict-value tabular">{verdict.atRisk}</p>
          <p className="muted">{t('pmo.lateMeasured', { count: verdict.measurable })}</p>
          {/* THE CAVEAT SITS UNDER THE NUMBER, not beside the section title, and
              it is the only place on this page a count is qualified rather than
              refused. The count is true of what is recorded; the sentence says
              what started the clock it counts. */}
          {sharedClock !== null && <p className="muted pmo-caveat">{sharedClock}</p>}
        </div>
      )
  }
}

function Verdict({
  title,
  body,
  footer,
  caveat,
  action,
}: {
  title: string
  body: string
  footer?: string
  caveat?: string | null
  action?: ReactNode
}): ReactElement {
  return (
    <div className="card pmo-verdict">
      <p className="pmo-verdict-title">{title}</p>
      <p className="muted">{body}</p>
      {footer !== undefined && <p className="muted">{footer}</p>}
      {caveat !== undefined && caveat !== null && <p className="muted pmo-caveat">{caveat}</p>}
      {action}
    </div>
  )
}

/**
 * Compliance, with the SAME refusal.
 *
 * `slaCompliance` already returns `rate: null` — never 0 — when nothing that
 * finished in the window carried a deadline, which is the seeded state (0005
 * ships every priority's `sla_days` NULL). Printing that as 0% would report a
 * workspace that promised nothing as a workspace that missed everything.
 */
function ComplianceCard({ sla }: { sla: SlaCompliance }): ReactElement {
  if (sla.rate === null) {
    return <Verdict title={t('pmo.slaTitle')} body={t('pmo.slaNone')} />
  }
  return (
    <div className="card pmo-verdict">
      <p className="pmo-verdict-title">{t('pmo.slaTitle')}</p>
      <p className="pmo-verdict-value tabular">{Math.round(sla.rate * 100)}%</p>
      <p className="muted">
        {t('pmo.slaRate', { met: String(sla.met), measured: String(sla.measured) })}
      </p>
      {sla.unmeasured > 0 && (
        <p className="muted">{t('pmo.slaUnmeasured', { count: sla.unmeasured })}</p>
      )}
    </div>
  )
}

/* ══════════════════ section 2 — initiatives ══════════════════ */

/** Where a row goes. See this file's header for why it is `?node=` and not `?focus=`. */
function portfolioHref(nodeId: string): string {
  const params = new URLSearchParams({
    lens: 'portfolio',
    by: 'stage',
    // EXPLICITLY OFF. The portfolio's default is the exception cut, and a drill
    // into one organization that landed on "…and it is not late, so here is
    // nothing" would be a link that appears broken.
    risk: '0',
    node: nodeId,
  })
  return `/mindtree?${params.toString()}`
}

/**
 * WHAT THIS WORKSPACE HAS PROMISED — 0027's goals, read as initiatives.
 *
 * DELIBERATELY THINNER THAN THE CARDS, and that matches the source document's
 * own weighting: an initiative there is a name, a state and a date, a peer of
 * the projects with no detail view of its own. A commitment is made and edited
 * on the organization's panel in the map, so the row LINKS there rather than
 * growing an editor here.
 *
 * ── THREE ABSENCES, AND THEY ARE NOT THE SAME ABSENCE ──────────────────────
 *
 * `rows === null` + `failed` → the read did not answer. 0027 is applied by hand
 *   and `map_node_goals` does not exist in the live database yet, so this is the
 *   ordinary state today. Worded calmly — a missing migration is not the
 *   reader's fault, and api/goals.ts asks for exactly that — but NOT as "there
 *   are none", because we do not know that.
 * `rows === null`, no failure → the read is still on the wire. The section shell
 *   renders and nothing else. LOADING IS NOT EMPTINESS: an empty state here
 *   would tell a director nobody has promised anything, with a spinner's timing.
 * `[]` → genuinely nothing promised, and a way to start.
 */
function Initiatives({
  rows,
  failed,
  locale,
}: {
  rows: readonly InitiativeRow[] | null
  failed: boolean
  locale: Locale
}): ReactElement {
  const shown = rows === null ? [] : rows.slice(0, INITIATIVE_ROWS)
  return (
    <Section id="pmo-commitments" title={t('pmo.commitments')} desc={t('pmo.commitmentsDesc')}>
      {rows === null ? (
        failed ? (
          <EmptyState title={t('pmo.initError')} description={t('pmo.initErrorHint')} />
        ) : null
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('pmo.initEmpty')}
          description={t('pmo.initEmptyHint')}
          action={
            <Link className="btn btn-primary" to="/mindtree">
              {t('mindtree.title')}
            </Link>
          }
        />
      ) : (
        <div className="card pmo-tablewrap">
          <table className="pmo-table">
            {/* The section's own heading IS the caption — RiskTable's pattern,
                and it costs no second string that could be edited out of step. */}
            <caption className="sr-only">{t('pmo.commitments')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('pmo.colCommitment')}</th>
                <th scope="col">{t('pmo.colScope')}</th>
                <th scope="col">{t('pmo.colProgress')}</th>
                <th scope="col">{t('pmo.colDue')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.goalId} className={overdueGoal(row) ? 'is-late' : undefined}>
                  <th scope="row">
                    <Link to={portfolioHref(row.nodeId)}>{row.label}</Link>
                  </th>
                  <td>{row.nodeName}</td>
                  <td>
                    <GoalReading row={row} />
                  </td>
                  <td>
                    {formatDate(row.targetDate, locale)}{' '}
                    {overdueGoal(row) && (
                      <span className="pill danger pmo-flag">
                        {t('mapnode.goalOverdue', { count: -row.progress.daysLeft })}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <p className="pmo-more muted">
              {t('followups.rowsHidden', { count: rows.length - shown.length })}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

/** Past its date and not met. A met commitment is not late; it is done. */
function overdueGoal(row: InitiativeRow): boolean {
  return row.progress.daysLeft < 0 && !row.progress.met
}

/**
 * HOW FAR A COMMITMENT HAS GOT — 0027's four goal readings, as a vocabulary of
 * refusals.
 *
 * ⚠ A COUNT GOAL MAY SHOW A RATIO AND A DATE GOAL MAY NOT, and the difference is
 *   not presentational. `reached` and `target` are both COUNTED FACTS — so many
 *   organizations beneath this node stand at that rung or beyond, out of so many
 *   the promise names — and a ratio of two counted facts is a fact. A date goal
 *   asks for ONE arrival: this node either reaches the rung or it does not.
 *   There is no fraction of an arrival, and the two candidates for inventing one
 *   are both wrong. `stageOrder / rungs` is a POSITION dressed as a proportion
 *   and it restates itself the moment an admin drags the ladder — 0027 says
 *   reordering the stages restates every count goal, and this would silently
 *   restate every date goal too. Days elapsed over days promised measures the
 *   CALENDAR, not the work.
 *
 * The unstaged caveat is MANDATORY when it applies: "0 of 40" alone sends an
 * Associate Director chasing forty organizations when thirty-eight of them have
 * simply never had a rung recorded. `GoalProgress` carries `unstaged` as a
 * separate number for exactly that sentence.
 */
function GoalReading({ row }: { row: InitiativeRow }): ReactElement {
  const { met, reached, target, unstaged } = row.progress
  if (met) return <span className="pill filled">{t('pmo.initMet')}</span>
  if (target !== null) {
    return (
      <>
        <span className="tabular">{t('pmo.initReached', { reached, target })}</span>
        {unstaged > 0 && (
          <span className="muted pmo-caveat">
            {' '}
            {t('mapnode.goalUnstaged', { count: unstaged })}
          </span>
        )}
      </>
    )
  }
  return <span className="muted">{t('pmo.initPending')}</span>
}

/* ══════════════════ section 3 — project cards ══════════════════ */

/**
 * The pill each reading wears, as literal constant maps so `localeReach` can see
 * the keys. `not-staged` is absent on purpose and the switch below is total over
 * the union without it — the card's stage line already carries
 * `Dash + pmo.deliveryNotStaged`, and a second pill saying the same words in the
 * same section is the collision `labelSections` fails on.
 *
 * `late` REUSES `mindtree.portfolioAtRisk`, which already reads "Past its stage"
 * in both languages and is the word the portfolio table prints for the identical
 * state. Two strings for one fact is how two screens come to describe the
 * workspace differently.
 */
const STATUS_PILL_KEY: Readonly<Record<Exclude<ProjectStatus, 'not-staged'>, string>> = {
  done: 'pmo.projDone',
  paused: 'pmo.projPaused',
  late: 'mindtree.portfolioAtRisk',
  'in-progress': 'pmo.projActive',
}

const STATUS_PILL_TONE: Readonly<Record<Exclude<ProjectStatus, 'not-staged'>, string>> = {
  done: ' filled',
  paused: ' info',
  late: ' danger',
  'in-progress': '',
}

function Projects({
  rows,
  coverage,
  sharedClock,
  stageNameOf,
  managerNameOf,
}: {
  rows: readonly DeliveryRow[]
  /** Null while nobody has looked — NOT an empty map, which would mean "nothing recorded". */
  coverage: ReadonlyMap<string, UseCaseProgress> | null
  sharedClock: string | null
  stageNameOf: (stageId: string | null) => string | null
  managerNameOf: (id: string | null) => string | null
}): ReactElement {
  const shown = rows.slice(0, PROJECT_CARDS)
  return (
    <Section id="pmo-delivery" title={t('pmo.delivery')} desc={t('pmo.deliveryDesc')}>
      {/* ⚠ MANDATORY WHEN SET. Every "Past its stage" pill below counts from the
          day named here, and a grid of red pills with nothing saying what
          started their clocks is the failure this sentence exists to stop. */}
      {sharedClock !== null && <p className="muted pmo-caveat">{sharedClock}</p>}
      {rows.length === 0 ? (
        <EmptyState title={t('pmo.deliveryEmpty')} description={t('pmo.deliveryEmptyHint')} />
      ) : (
        <>
          <div className="pmo-projgrid">
            {shown.map((row) => (
              <ProjectCard
                key={row.nodeId}
                row={row}
                stageName={stageNameOf(row.stageId)}
                managerName={managerNameOf(row.managerId)}
                progress={coverage === null ? null : (coverage.get(row.nodeId) ?? null)}
              />
            ))}
          </div>
          {rows.length > shown.length && (
            <p className="pmo-more">
              <Link to="/mindtree?lens=portfolio&by=stage&risk=0">{t('pmo.deliveryAll')}</Link>{' '}
              <span className="muted">
                {t('followups.rowsHidden', { count: rows.length - shown.length })}
              </span>
            </p>
          )}
        </>
      )}
    </Section>
  )
}

function ProjectCard({
  row,
  stageName,
  managerName,
  progress,
}: {
  row: DeliveryRow
  stageName: string | null
  managerName: string | null
  progress: UseCaseProgress | null
}): ReactElement {
  const status = projectStatus(row)
  return (
    <article className={`card pmo-proj${row.atRisk ? ' is-late' : ''}`}>
      <p className="pmo-proj-head">
        <Link className="pmo-proj-name" to={portfolioHref(row.nodeId)}>
          {row.name}
        </Link>
        {status !== 'not-staged' && (
          <span className={`pill${STATUS_PILL_TONE[status]}`}>{t(STATUS_PILL_KEY[status])}</span>
        )}
      </p>

      {/* EM-DASH, NOT A ZERO OR A BLANK. "Nobody has said where this is" and "it
          is on the first rung" are different facts, and MindtreeTable's rule is
          that they never render alike. The day count is APPENDED only when there
          is one — a card that printed "0 days" by default would claim a clock
          nobody started. */}
      <p className="pmo-proj-line">
        {stageName ?? <Dash label={t('pmo.deliveryNotStaged')} />}
        {row.daysInStage !== null && (
          <span className="muted tabular">
            {' · '}
            {t('mindtree.portfolioDays', { count: row.daysInStage })}
          </span>
        )}
      </p>

      <Coverage progress={progress} />

      <p className="pmo-proj-foot">
        <span className="muted">
          {managerName ?? <Dash label={t('mindtree.portfolioNoManager')} />}
        </span>
        {/* A REAL ZERO PRINTS HERE, and it is the one number on this card that
            may. Open work is a COUNTED fact off the same ancestry walk the
            filter uses: "nothing is open under this organization" is an answer,
            not an absence. */}
        <span className="muted tabular">{t('pmo.projOpen', { count: row.open })}</span>
      </p>
    </article>
  )
}

/**
 * CAPABILITY COVERAGE — the one percentage this schema can earn, and the three
 * arms that keep it earned.
 *
 *  1. `progress === null` — nobody has looked, or the read failed. NO ROW AT
 *     ALL. An empty bar would report "nothing integrated" about a workspace that
 *     is still reading.
 *  2. `linked === 0` — this organization has nothing recorded. A DASH AND A
 *     SENTENCE, never "0 of 9" and never "0%". `UseCaseProgress` carries
 *     `linked` as a third number precisely because "has recorded nothing" and
 *     "is at zero" are different facts, and the org panel draws the same
 *     distinction the same way.
 *  3. `linked > 0` — the ratio, SPOKEN with its unit ("⁨6⁩ of 9 ⁨live⁩", the org
 *     panel's own sentence), and when fewer capabilities are recorded than the
 *     catalogue holds, the caveat naming how many. The bar is `aria-hidden`: it
 *     is a picture of the sentence beside it, not a second claim.
 *
 * ⚠ NO BARE `%`, EVER. `total` is the whole catalogue, not this organization's
 *   recorded scope, so an organization with three capabilities all live is
 *   FINISHED and "33%" would say it is a third done. The unit word and the
 *   caveat are what stop the ratio being read as a completion figure.
 */
function Coverage({ progress }: { progress: UseCaseProgress | null }): ReactElement | null {
  if (progress === null) return null
  const { done, total, linked } = progress
  if (linked === 0) {
    // THE DASH IS DECORATION HERE, not an absence needing a word of its own —
    // the sentence beside it IS the word, and `Dash`'s `.sr-only` twin would
    // read it out twice. Everywhere else on this page the dash stands alone in
    // a cell and carries its label; this is the one place it does not.
    return (
      <p className="pmo-proj-line muted">
        <span aria-hidden="true">— </span>
        {t('pmo.projNoCoverage')}
      </p>
    )
  }
  return (
    <div className="pmo-proj-cov">
      <div className="pmo-proj-bar" aria-hidden="true">
        <div
          className="pmo-proj-bar-fill"
          style={{ inlineSize: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }}
        />
      </div>
      <p className="pmo-proj-line">
        <span className="tabular">
          {t('mapnode.progress', { done, total, status: t(STATUS_WORD[TERMINAL_STATUS]) })}
        </span>
        {linked < total && (
          <span className="muted pmo-caveat">
            {' '}
            {t('pmo.projRecorded', { count: linked })}
          </span>
        )}
      </p>
    </div>
  )
}

/* ══════════════════ section 4 — actions ══════════════════ */

/** The six buckets, in `bucketFollowUps`' own order — which IS the priority order. */
const BUCKETS: readonly { key: keyof FollowUpSections; labelKey: string; hintKey: string }[] = [
  { key: 'overdue', labelKey: 'followups.overdue', hintKey: 'followups.overdueHint' },
  { key: 'slaBreach', labelKey: 'followups.slaBreach', hintKey: 'followups.slaBreachHint' },
  { key: 'dueSoon', labelKey: 'followups.dueSoon', hintKey: 'followups.dueSoonHint' },
  { key: 'stale', labelKey: 'followups.stale', hintKey: 'followups.staleHint' },
  { key: 'blocked', labelKey: 'followups.blocked', hintKey: 'followups.blockedHint' },
  { key: 'unassigned', labelKey: 'followups.unassigned', hintKey: 'followups.unassignedHint' },
]

/**
 * Copy a link to one action, with an HONEST FAILURE.
 *
 * `navigator.clipboard` is undefined on an insecure origin and rejects when the
 * gesture is not trusted, and both are silent — the reader taps, nothing appears
 * to happen, and what they paste is whatever was in the clipboard before. Hence
 * the explicit error toast; pages/Entry.tsx makes the same call in the same
 * words, and this reuses its two strings rather than minting a third and fourth.
 *
 * THIS IS THE SOURCE DOCUMENT'S "notify the owner" WITH THE `mailto:` AND THE
 * STORED ADDRESSES TAKEN OUT. This workspace does not store staff email
 * addresses and must not start; a link a person pastes into whatever they
 * already use is the same errand with nothing to leak.
 */
async function copyActionLink(entry: Entry): Promise<void> {
  try {
    // The bare URL on its own line so it auto-linkifies wherever it is pasted.
    await navigator.clipboard.writeText(`${entry.title}\n${window.location.origin}/entry/${entry.id}`)
    toast(t('entry.linkCopied'))
  } catch {
    toast(t('entry.errCopyLink'), { tone: 'error' })
  }
}

function Actions({
  rows,
  sections,
  managerNameOf,
  focusEntry,
  locale,
}: {
  rows: readonly ActionRow[]
  sections: FollowUpSections
  managerNameOf: (id: string | null) => string | null
  focusEntry: string | null
  locale: Locale
}): ReactElement {
  const shown = rows.slice(0, ACTION_ROWS)
  const attention = BUCKETS.reduce((sum, b) => sum + sections[b.key].length, 0)

  return (
    <Section id="pmo-actions" title={t('pmo.actions')} desc={t('pmo.actionsDesc')}>
      {rows.length === 0 ? (
        <EmptyState title={t('pmo.actionsEmpty')} description={t('pmo.actionsEmptyHint')} />
      ) : (
        <div className="card pmo-tablewrap">
          <table className="pmo-table">
            <caption className="sr-only">{t('pmo.actions')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('pmo.colAction')}</th>
                <th scope="col">{t('pmo.colOwner')}</th>
                <th scope="col">{t('pmo.colDue')}</th>
                <th scope="col">{t('pmo.colStatus')}</th>
                <th scope="col" className="pmo-num">
                  {t('pmo.colRaised')}
                </th>
                <th scope="col">
                  <span className="sr-only">{t('pmo.actionCopy')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <ActionRowView
                  key={row.entry.id}
                  row={row}
                  owner={ownerOf(row.entry, managerNameOf)}
                  highlight={row.entry.id === focusEntry}
                  locale={locale}
                />
              ))}
            </tbody>
          </table>
          {/* THE COUNT ALONE, with no "see all" link, and that is deliberate:
              `/followups` is one of the seven routes App.tsx collapsed into the
              map, so a link wearing that word would land the reader on the
              canvas looking like it had misfired. The overflow is a fact about
              this table, and RiskTable states its overflow the same way. */}
          {rows.length > shown.length && (
            <p className="pmo-more muted">
              {t('followups.rowsHidden', { count: rows.length - shown.length })}
            </p>
          )}
        </div>
      )}

      <h3 className="pmo-subtitle">{t('pmo.followTitle')}</h3>
      <p className="muted pmo-desc">{t('pmo.followDesc')}</p>
      {attention === 0 ? (
        <EmptyState title={t('followups.allClear')} description={t('followups.allClearHint')} />
      ) : (
        <div className="pmo-buckets">
          {BUCKETS.map(({ key, labelKey, hintKey }) => (
            <Bucket key={key} label={t(labelKey)} hint={t(hintKey)} entries={sections[key]} />
          ))}
        </div>
      )}
    </Section>
  )
}

/**
 * Who is on it.
 *
 * THROUGH THE ROSTER FIRST, so an id nobody in the workspace answers to reads
 * `mapnode.managerGone` rather than an em-dash: a person who has left is not the
 * same fact as nobody assigned. `owner_name` is the free-text half — somebody
 * typed a name for a person with no account — and only when BOTH are empty is
 * the row genuinely unassigned.
 */
function ownerOf(entry: Entry, managerNameOf: (id: string | null) => string | null): string | null {
  const named = managerNameOf(entry.owner_id)
  if (named !== null) return named
  const typed = (entry.owner_name ?? '').trim()
  return typed === '' ? null : typed
}

function ActionRowView({
  row,
  owner,
  highlight,
  locale,
}: {
  row: ActionRow
  owner: string | null
  highlight: boolean
  locale: Locale
}): ReactElement {
  const { entry } = row
  const className = [row.overdue ? 'is-late' : '', highlight ? 'is-highlight' : '']
    .filter((c) => c !== '')
    .join(' ')
  return (
    <tr className={className === '' ? undefined : className}>
      <th scope="row">
        {/* THE FULL SHEET, not a panel here. `UpdateThread`, the nudge button and
            its answered-semantics all live on that route, so this page never
            re-reads a raw `nudged_at` and never grows a second way to act. */}
        <Link to={`/entry/${entry.id}`}>{entry.title}</Link>
      </th>
      <td>{owner ?? <Dash label={t('followups.unassigned')} />}</td>
      <td>
        {entry.due_date === null ? (
          <Dash label={t('pmo.actionNoDue')} />
        ) : (
          formatDate(entry.due_date, locale)
        )}
        {/* TINT PLUS WORD, never colour alone: `tr.is-late` is a background and a
            background is not a status. */}
        {row.overdue && <span className="pill danger pmo-flag">{t('pmo.actionOverdue')}</span>}
      </td>
      <td>
        {/* NOT the `StatusPill` atom: it reads `useVocabLabel`/`useVocabColor`
            from store/vocab, which this page's test replaces with two hooks, and
            RiskTable sets the literal-template precedent one section down with
            `priority.*`. localeReach's FAMILIES allowlist covers `status.*`
            exactly. */}
        <span className="pill">{t(`status.${entry.status}`)}</span>
      </td>
      <td className="pmo-num tabular">{row.daysOpen}</td>
      <td>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            void copyActionLink(entry)
          }}
        >
          {t('pmo.actionCopy')}
        </button>
      </td>
    </tr>
  )
}

/**
 * One follow-up bucket.
 *
 * IT IS RENDERED EVEN WHEN EMPTY, and `followups.sectionEmpty` ("Nothing here —
 * good.") is why that is not clutter: the six buckets are a CHECKLIST, and a
 * bucket that vanished when it emptied would make the reader work out which of
 * the six they are not looking at. The follow-ups screen makes the same call.
 */
function Bucket({
  label,
  hint,
  entries,
}: {
  label: string
  hint: string
  entries: readonly Entry[]
}): ReactElement {
  const shown = entries.slice(0, BUCKET_ROWS)
  return (
    <div className="card card-tight pmo-bucket">
      <p className="pmo-bucket-head">
        <span className="pmo-bucket-label">{label}</span>
        <span className="pill tabular">{entries.length}</span>
      </p>
      <p className="muted pmo-bucket-hint">{hint}</p>
      {entries.length === 0 ? (
        <p className="muted">{t('followups.sectionEmpty')}</p>
      ) : (
        <ul className="pmo-list">
          {shown.map((entry) => (
            <li key={entry.id}>
              <Link to={`/entry/${entry.id}`}>{entry.title}</Link>
            </li>
          ))}
          {entries.length > shown.length && (
            <li className="muted">{t('followups.rowsHidden', { count: entries.length - shown.length })}</li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * An absence, with a word behind it.
 *
 * The character alone is announced as "em dash" or as nothing at all depending
 * on the screen reader, and the whole point of the null/zero distinction is lost
 * on a reader who cannot hear it. MapBranchDetail pairs its dash with an
 * `.sr-only` word for the same reason.
 */
function Dash({ label }: { label: string }): ReactElement {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </>
  )
}

/* ══════════════════ section 3 — risks & challenges ══════════════════ */

/** `pmo.readingSevere` … — the dot path is spelled out so localeReach can see it. */
const READING_KEY: Readonly<Record<RiskSeverity, string>> = {
  severe: 'pmo.readingSevere',
  elevated: 'pmo.readingElevated',
  watch: 'pmo.readingWatch',
}

const READING_TONE: Readonly<Record<RiskSeverity, string>> = {
  severe: 'danger',
  elevated: 'warn',
  watch: 'info',
}

/** The two tables' headings and empty lines. `type.*` names the type itself. */
const RISK_TITLE: Readonly<Record<RiskType, string>> = {
  issue: 'pmo.riskIssues',
  escalation: 'pmo.riskEscalations',
}

const RISK_EMPTY: Readonly<Record<RiskType, string>> = {
  issue: 'pmo.riskEmptyIssues',
  escalation: 'pmo.riskEmptyEscalations',
}

function Risks({ risks }: { risks: Record<RiskType, RiskRow[]> }): ReactElement {
  return (
    <Section id="pmo-risks" title={t('pmo.risks')} desc={t('pmo.risksDesc')}>
      <p className="muted pmo-desc">{t('pmo.readingHint')}</p>
      <div className="pmo-risks">
        {RISK_TYPES.map((type) => (
          <RiskTable key={type} type={type} rows={risks[type]} />
        ))}
      </div>
    </Section>
  )
}

function RiskTable({ type, rows }: { type: RiskType; rows: readonly RiskRow[] }): ReactElement {
  const shown = rows.slice(0, RISK_ROWS)
  return (
    <div className="card pmo-tablewrap">
      <h3 className="pmo-subtitle">
        {t(RISK_TITLE[type])} <span className="pill tabular">{rows.length}</span>
      </h3>
      {rows.length === 0 ? (
        <EmptyState title={t(RISK_EMPTY[type])} description={t('pmo.riskEmptyHint')} />
      ) : (
        <>
          <table className="pmo-table">
            <caption className="sr-only">{t(RISK_TITLE[type])}</caption>
            <thead>
              <tr>
                <th scope="col">{t('entry.title')}</th>
                <th scope="col">{t('pmo.colReading')}</th>
                <th scope="col">{t('entry.priority')}</th>
                <th scope="col" className="pmo-num">
                  {t('pmo.colRaised')}
                </th>
                <th scope="col">{t('pmo.colWaiting')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.entry.id}>
                  <th scope="row">
                    <Link to={`/entry/${row.entry.id}`}>{row.entry.title}</Link>
                  </th>
                  <td>
                    <span className={`pill ${READING_TONE[row.severity]}`}>
                      {t(READING_KEY[row.severity])}
                    </span>
                  </td>
                  <td>{t(`priority.${row.entry.priority}`)}</td>
                  <td className="pmo-num tabular">{row.daysOpen}</td>
                  <td>
                    {/* BOTH ANSWERS ARE WORDS, and the negative one is not a
                        blank cell: "nobody else is holding this up" is a fact
                        about who has to act, and an empty cell reads as missing
                        data. The dash carries `pmo.waitingNo` for the reader
                        who hears the column rather than seeing it. */}
                    {row.waiting ? (
                      t('pmo.waitingYes')
                    ) : (
                      <Dash label={t('pmo.waitingNo')} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <p className="pmo-more muted">
              {t('followups.rowsHidden', { count: rows.length - shown.length })}
            </p>
          )}
        </>
      )}
    </div>
  )
}
