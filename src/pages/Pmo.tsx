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
import { Link } from 'react-router-dom'
import { AgingChart, ThroughputChart } from '../components/charts'
import { EmptyState } from '../components/shared'
// THE ONE RESOLVER FOR "who is accountable", imported rather than restated. An
// id the roster does not know is NOT the same fact as no manager — it is a
// person who has left, or a members store that has not landed — and rendering
// an em-dash for it would report an accountable organization as an
// unaccountable one. That distinction is four lines long and already written,
// tested and worded (`mapnode.managerGone`); a second copy here would agree
// until the day one of them was edited. The import costs this route's chunk a
// module it shares with the map, which is the cheap half of the trade.
import { managerLabel } from '../components/map/MapBranchDetail'
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
import { t, useLocale } from '../lib/i18n'
import { useNodeLabel, useStageLabel } from '../lib/labels'
import { stageIndex } from '../lib/mapNodes'
import {
  bucketRisks,
  buildDeliveryRows,
  latenessVerdict,
  stageReadiness,
  RISK_TYPES,
  type DeliveryRow,
  type LatenessVerdict,
  type RiskRow,
  type RiskSeverity,
  type RiskType,
} from '../lib/pmo/summary'
import { isOpen } from '../lib/health'
import { loadConfig, useMapNodes, useNodeProgress, useStageMap } from '../store/config'
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
import type { Entry } from '../types'
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

/** How many organizations the delivery table prints before deferring to the portfolio. */
const DELIVERY_ROWS = 12

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

  const delivery = useMemo(() => {
    // `ctx.today` rather than `Date.now()` in the dependency list, on
    // `useAtRiskCount`'s reasoning: the fold's only use of the clock is whole
    // calendar days, so re-running it per render would recompute every row to
    // produce the same integers.
    const now = new Date()
    const merged = mergeProgress(progress, pending)
    return buildDeliveryRows({
      nodes,
      stages: stageIndex(merged, stageById),
      progressById: merged,
      fallbackStallDays: FALLBACK_STALL_DAYS,
      now,
      labelOf: nodeLabel,
      openByNode,
      managerOfNode: ctx.managerOfNode ?? new Map(),
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, stageById, progress, pending, nodeLabel, openByNode, ctx.managerOfNode, ctx.today])

  const verdict = useMemo(() => latenessVerdict(stageReadiness(delivery)), [delivery])
  const staged = useMemo(() => delivery.filter((r) => r.stageId !== null).length, [delivery])

  const counts = useMemo(
    () => countEntries(entries, health, ctx.today, addDays(ctx.today, 7)),
    [entries, health, ctx.today],
  )

  const sections = useMemo(
    () => bucketFollowUps(entries, health, { meId: ctx.meId, today: ctx.today, staleDays }),
    [entries, health, ctx.meId, ctx.today, staleDays],
  )

  const risks = useMemo(() => bucketRisks(entries, health, ctx.today), [entries, health, ctx.today])

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
  const blank = entries.length === 0 && delivery.length === 0

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
            staged={staged}
            verdict={verdict}
            sla={sla}
            throughput={throughput}
            aging={aging}
            basis={basis}
            onBasis={setBasis}
            hasEntries={entries.length > 0}
          />
          <Delivery
            rows={delivery}
            sections={sections}
            stageNameOf={stageNameOf}
            managerNameOf={managerNameOf}
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
        <LatenessCard verdict={verdict} />
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
function LatenessCard({ verdict }: { verdict: LatenessVerdict }): ReactElement {
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
        />
      )
    case 'late':
      return (
        <div className="card pmo-verdict">
          <p className="pmo-verdict-title">{t('pmo.lateTitle')}</p>
          <p className="pmo-verdict-value tabular">{verdict.atRisk}</p>
          <p className="muted">{t('pmo.lateMeasured', { count: verdict.measurable })}</p>
        </div>
      )
  }
}

function Verdict({
  title,
  body,
  footer,
  action,
}: {
  title: string
  body: string
  footer?: string
  action?: ReactNode
}): ReactElement {
  return (
    <div className="card pmo-verdict">
      <p className="pmo-verdict-title">{title}</p>
      <p className="muted">{body}</p>
      {footer !== undefined && <p className="muted">{footer}</p>}
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

/* ══════════════════ section 2 — projects & follow-ups ══════════════════ */

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

/** The six buckets, in `bucketFollowUps`' own order — which IS the priority order. */
const BUCKETS: readonly { key: keyof FollowUpSections; labelKey: string; hintKey: string }[] = [
  { key: 'overdue', labelKey: 'followups.overdue', hintKey: 'followups.overdueHint' },
  { key: 'slaBreach', labelKey: 'followups.slaBreach', hintKey: 'followups.slaBreachHint' },
  { key: 'dueSoon', labelKey: 'followups.dueSoon', hintKey: 'followups.dueSoonHint' },
  { key: 'stale', labelKey: 'followups.stale', hintKey: 'followups.staleHint' },
  { key: 'blocked', labelKey: 'followups.blocked', hintKey: 'followups.blockedHint' },
  { key: 'unassigned', labelKey: 'followups.unassigned', hintKey: 'followups.unassignedHint' },
]

function Delivery({
  rows,
  sections,
  stageNameOf,
  managerNameOf,
}: {
  rows: readonly DeliveryRow[]
  sections: FollowUpSections
  stageNameOf: (stageId: string | null) => string | null
  managerNameOf: (id: string | null) => string | null
}): ReactElement {
  const shown = rows.slice(0, DELIVERY_ROWS)
  const attention = BUCKETS.reduce((sum, b) => sum + sections[b.key].length, 0)

  return (
    <Section id="pmo-delivery" title={t('pmo.delivery')} desc={t('pmo.deliveryDesc')}>
      {rows.length === 0 ? (
        <EmptyState title={t('pmo.deliveryEmpty')} description={t('pmo.deliveryEmptyHint')} />
      ) : (
        <div className="card pmo-tablewrap">
          <table className="pmo-table">
            <caption className="sr-only">{t('pmo.deliveryLabel')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('mindtree.colOrg')}</th>
                <th scope="col">{t('mindtree.colStage')}</th>
                <th scope="col" className="pmo-num">
                  {t('mindtree.colInStage')}
                </th>
                <th scope="col">{t('mindtree.colManager')}</th>
                <th scope="col" className="pmo-num">
                  {t('mindtree.colOpen')}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const stage = stageNameOf(row.stageId)
                const manager = managerNameOf(row.managerId)
                return (
                  <tr key={row.nodeId} className={row.atRisk ? 'is-late' : undefined}>
                    <th scope="row">
                      <Link to={portfolioHref(row.nodeId)}>{row.name}</Link>
                      {row.atRisk && (
                        <span className="pill danger pmo-flag">{t('mindtree.portfolioAtRisk')}</span>
                      )}
                    </th>
                    {/* EM-DASH, NOT A ZERO OR A BLANK. "Nobody has said where this
                        is" and "it is on the first rung" are different facts, and
                        MindtreeTable's rule is that they never render alike. */}
                    <td>{stage ?? <Dash label={t('pmo.deliveryNotStaged')} />}</td>
                    <td className="pmo-num tabular">
                      {row.daysInStage === null ? (
                        <Dash label={t('pmo.deliveryNotStaged')} />
                      ) : (
                        row.daysInStage
                      )}
                    </td>
                    <td>{manager ?? <Dash label={t('mindtree.portfolioNoManager')} />}</td>
                    <td className="pmo-num tabular">{row.open}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <p className="pmo-more">
              <Link to="/mindtree?lens=portfolio&by=stage&risk=0">{t('pmo.deliveryAll')}</Link>{' '}
              <span className="muted">{t('followups.rowsHidden', { count: rows.length - shown.length })}</span>
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
            <Bucket
              key={key}
              label={t(labelKey)}
              hint={t(hintKey)}
              entries={sections[key]}
            />
          ))}
        </div>
      )}
    </Section>
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
