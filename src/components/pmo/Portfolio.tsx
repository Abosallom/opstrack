// The four sections 0031 made possible: projects, initiatives, revenue, OKRs.
//
// ── THESE ARE THE PMO'S OWN OBJECTS ───────────────────────────────────────
//
// Not organizations. The PMO section used to read `map_nodes` and call each of
// the hundred and four organizations a "project"; the owner's live dashboard
// tracks thirteen projects with managers, budgets in SAR, dates and a four-step
// lifecycle. The onboarding view keeps its own tab, called Delivery.
//
// ── EVERY NUMBER HERE IS EARNED OR ABSENT ─────────────────────────────────
//
// `actual_pct` and `planned_pct` are nullable in 0031 on purpose, and this file
// is where that pays: a project nobody has updated prints a sentence, not a 0%
// bar. The source dashboard shows ten initiatives all reading 0% because it
// cannot tell "nothing has happened" from "nobody has said", and inheriting
// that would make the first screen a director sees quietly false.
//
// VARIANCE IS COMPUTED HERE AND IS NEVER STORED — 0031's probe 2 enforces the
// other half. It is `actual − planned`, it is shown as a signed number of
// points, and it is only shown when BOTH exist: a variance against a plan
// nobody set is not a measurement.
//
// ── AND EVERYTHING CAN CARRY ITS JIRA ISSUE ───────────────────────────────
//
// Every row in this family has `external_ref`. Where one is set, the card shows
// the key as a link, built by `browseUrlFor()` from the configured site address
// rather than from a stored URL — so the link is right after an Atlassian move
// and there is no second copy of the address to migrate.

import { useEffect, type ReactElement, type ReactNode } from 'react'
import { EmptyState } from '../shared'
import { t } from '../../lib/i18n'
import { useLocale } from '../../lib/i18n'
import { browseUrlFor } from '../../lib/jira/types'
import { useJiraSettings } from '../../store/config'
import { useMemberMap } from '../../store/members'
import { loadPmo, usePmo, usePmoError, usePmoLoading, usePmoNeedsMigration } from '../../store/pmo'
import type {
  PmoInitiative,
  PmoKeyResult,
  PmoObjective,
  PmoObjectiveProgress,
  PmoProject,
  PmoRevenueLine,
} from '../../types'

/* ─────────────────────────── shared furniture ─────────────────────────── */

/**
 * Every section opens the same way: load once, then answer for the four states
 * this store can be in. They are four and not two, which is the whole point —
 * "nobody has looked", "the tables do not exist", "the read failed" and "there
 * is genuinely nothing" all render as an empty page if you let them.
 */
function usePortfolio(): {
  ready: boolean
  frame: ReactNode | null
} {
  const data = usePmo()
  const loading = usePmoLoading()
  const error = usePmoError()
  const needsMigration = usePmoNeedsMigration()

  useEffect(() => {
    void loadPmo()
  }, [])

  if (needsMigration) {
    // ⚠ NOT "you have no projects". The tables are absent, which is a setup
    //   step somebody has to take — and on a screen the two look identical.
    return {
      ready: false,
      frame: (
        <EmptyState
          title={t('pmo.needsMigration')}
          description={t('pmo.needsMigrationHint')}
        />
      ),
    }
  }
  if (error !== null) {
    return { ready: false, frame: <EmptyState title={t(error)} /> }
  }
  if (data === null) {
    // Loading. Deliberately NOT an empty state: telling a director his
    // portfolio is empty for as long as the network takes is the failure this
    // store's `null` exists to prevent.
    return { ready: false, frame: <p className="muted">{loading ? t('common.loading') : ''}</p> }
  }
  return { ready: true, frame: null }
}

/** The Jira key as a link, or nothing. Never a bare key with no way to open it. */
function JiraRef({ ref: issueKey }: { ref: string | null }): ReactElement | null {
  const settings = useJiraSettings()
  if (issueKey === null || issueKey.trim() === '') return null
  const href = browseUrlFor(settings?.siteBaseUrl ?? null, issueKey)
  if (href === null) {
    // The key is known but the site address is not configured, so there is
    // nowhere to send the reader. Show the key as text rather than a dead link.
    return <span className="pmo-jira">{issueKey}</span>
  }
  return (
    <a className="pmo-jira" href={href} target="_blank" rel="noreferrer noopener">
      {issueKey}
    </a>
  )
}

/**
 * The two progress bars every project and initiative card carries: what has
 * actually happened over what was planned.
 *
 * NULL TAKES THE SENTENCE BRANCH. See this file's header — a bar at zero for a
 * project nobody has updated is a measurement nobody took.
 */
function Progress({
  actual,
  planned,
}: {
  actual: number | null
  planned: number | null
}): ReactElement {
  if (actual === null && planned === null) {
    return <p className="pmo-quiet">{t('pmo.noProgress')}</p>
  }
  const variance = actual !== null && planned !== null ? actual - planned : null
  return (
    <div className="pmo-prog">
      <Bar label={t('pmo.actual')} value={actual} kind="actual" />
      <Bar label={t('pmo.planned')} value={planned} kind="planned" />
      {variance !== null && (
        <span
          className="pmo-var"
          // On plan, ahead, or behind — three states rather than a colour ramp,
          // because the only question a director asks of this number is which
          // of the three it is.
          data-tone={variance === 0 ? 'level' : variance > 0 ? 'ahead' : 'behind'}
        >
          {t('pmo.variance', { points: variance > 0 ? `+${variance}` : String(variance) })}
        </span>
      )}
    </div>
  )
}

function Bar({
  label,
  value,
  kind,
}: {
  label: string
  value: number | null
  kind: 'actual' | 'planned'
}): ReactElement {
  return (
    <div className="pmo-bar-row">
      <span className="pmo-bar-k">{label}</span>
      <span className="pmo-bar" aria-hidden="true">
        <span
          className="pmo-bar-fill"
          data-k={kind}
          style={{ inlineSize: `${value ?? 0}%` }}
        />
      </span>
      <span className="pmo-bar-v tabular">
        {value === null ? <span className="pmo-quiet">{t('pmo.notSaid')}</span> : `${value}%`}
      </span>
    </div>
  )
}

/** The four-step stepper. Past steps done, this one current, the rest to come. */
function Steps({ steps, at }: { steps: readonly string[]; at: string }): ReactElement {
  const index = steps.indexOf(at)
  return (
    <ol className="pmo-steps">
      {steps.map((step, i) => (
        <li
          key={step}
          className="pmo-step"
          data-state={i < index ? 'done' : i === index ? 'now' : 'todo'}
        >
          {PHASE_LABEL[step]()}
        </li>
      ))}
    </ol>
  )
}

/** SAR, grouped, with the unit said once. Null prints nothing at all. */
function Money({ amount, currency }: { amount: string | null; currency: string }): ReactElement | null {
  const locale = useLocale()
  if (amount === null) return null
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  return (
    <span className="tabular">
      {new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
        maximumFractionDigits: 0,
      }).format(n)}{' '}
      {currency}
    </span>
  )
}

/**
 * ⚠ THE KEYS ARE LITERALS, NOT A TEMPLATE. `lib/localeReach.test.ts` scans
 *   source for quoted dotted strings and asserts each resolves in BOTH bundles;
 *   a `t(\`pmo.phase.${step}\`)` is invisible to it and ships missing in one
 *   language. `lens.ts` states the same rule about its own key tables.
 */
const PHASE_LABEL: Readonly<Record<string, () => string>> = {
  start: () => t('pmo.phase.start'),
  planning: () => t('pmo.phase.planning'),
  execution: () => t('pmo.phase.execution'),
  closure: () => t('pmo.phase.closure'),
  evaluation: () => t('pmo.phase.evaluation'),
  dissemination: () => t('pmo.phase.dissemination'),
}

const PROJECT_STEPS = ['start', 'planning', 'execution', 'closure'] as const
const INITIATIVE_STEPS = ['planning', 'execution', 'evaluation', 'dissemination'] as const

/* ───────────────────────────── 1. projects ─────────────────────────────── */

export function PortfolioProjects(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  const members = useMemberMap()
  const locale = useLocale()
  if (!ready || data === null) return <>{frame}</>

  if (data.projects.length === 0) {
    return <EmptyState title={t('pmo.projectsEmpty')} description={t('pmo.projectsEmptyHint')} />
  }

  return (
    <ul className="pmo-cards">
      {data.projects.map((p) => (
        <ProjectCard key={p.id} project={p} managerName={nameOf(members, p.manager_id)} locale={locale} />
      ))}
    </ul>
  )
}

function ProjectCard({
  project,
  managerName,
  locale,
}: {
  project: PmoProject
  managerName: string | null
  locale: string
}): ReactElement {
  const name = locale === 'ar' && project.name_ar.trim() !== '' ? project.name_ar : project.name
  return (
    <li className="card pmo-card">
      <div className="pmo-card-head">
        <h3 className="pmo-card-name">{name}</h3>
        <JiraRef ref={project.external_ref} />
      </div>

      <dl className="pmo-card-facts">
        <Fact k={t('pmo.manager')} v={managerName} />
        <Fact k={t('pmo.budget')} v={<Money amount={project.budget} currency={project.currency} />} />
        <Fact k={t('pmo.dates')} v={dateRange(project.start_date, project.end_date)} />
      </dl>

      <Steps steps={PROJECT_STEPS} at={project.phase} />
      <Progress actual={project.actual_pct} planned={project.planned_pct} />

      {project.note.trim() !== '' && <p className="pmo-card-note">{project.note}</p>}
    </li>
  )
}

/* ──────────────────────────── 2. initiatives ───────────────────────────── */

export function PortfolioInitiatives(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  const members = useMemberMap()
  const locale = useLocale()
  if (!ready || data === null) return <>{frame}</>

  if (data.initiatives.length === 0) {
    return <EmptyState title={t('pmo.initEmpty2')} description={t('pmo.initEmptyHint2')} />
  }

  return (
    <ul className="pmo-cards">
      {data.initiatives.map((i) => (
        <InitiativeCard key={i.id} initiative={i} managerName={nameOf(members, i.manager_id)} locale={locale} />
      ))}
    </ul>
  )
}

function InitiativeCard({
  initiative,
  managerName,
  locale,
}: {
  initiative: PmoInitiative
  managerName: string | null
  locale: string
}): ReactElement {
  const name =
    locale === 'ar' && initiative.name_ar.trim() !== '' ? initiative.name_ar : initiative.name
  return (
    <li className="card pmo-card">
      <div className="pmo-card-head">
        <h3 className="pmo-card-name">{name}</h3>
        <JiraRef ref={initiative.external_ref} />
      </div>

      <dl className="pmo-card-facts">
        <Fact k={t('pmo.manager')} v={managerName} />
        {/* WHERE A PROJECT SHOWS A BUDGET, an initiative shows its kind. That
            is the source dashboard's own choice and it is the honest one: an
            initiative has no money attached. */}
        <Fact k={t('pmo.kindLabel')} v={initiative.kind === 'internal' ? t('pmo.kind.internal') : t('pmo.kind.external')} />
        <Fact k={t('pmo.dates')} v={dateRange(initiative.start_date, initiative.end_date)} />
      </dl>

      <Steps steps={INITIATIVE_STEPS} at={initiative.phase} />
      <Progress actual={initiative.actual_pct} planned={initiative.planned_pct} />

      {initiative.note.trim() !== '' && <p className="pmo-card-note">{initiative.note}</p>}
    </li>
  )
}

/* ───────────────────────────── 3. revenue ──────────────────────────────── */

export function PortfolioRevenue(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  const locale = useLocale()
  if (!ready || data === null) return <>{frame}</>

  if (data.revenue.length === 0) {
    return <EmptyState title={t('pmo.revenueEmpty')} description={t('pmo.revenueEmptyHint')} />
  }

  // One row per project, four quarter columns — the source dashboard's shape.
  const byProject = new Map<string, PmoRevenueLine[]>()
  for (const line of data.revenue) {
    const held = byProject.get(line.project_id)
    if (held === undefined) byProject.set(line.project_id, [line])
    else held.push(line)
  }
  const nameById = new Map(data.projects.map((p) => [p.id, p.name]))

  return (
    <div className="pmo-tablewrap" role="region" aria-label={t('pmo.revenue')} tabIndex={0}>
      <table className="table pmo-rev">
        <caption className="sr-only">{t('pmo.revenue')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('pmo.colProject')}</th>
            {[1, 2, 3, 4].map((q) => (
              <th scope="col" key={q} className="tabular">
                {t('pmo.quarter', { n: q })}
              </th>
            ))}
            <th scope="col" className="tabular">{t('pmo.total')}</th>
            <th scope="col" className="tabular">{t('pmo.achieved')}</th>
          </tr>
        </thead>
        <tbody>
          {[...byProject.entries()].map(([projectId, lines]) => {
            const q = (n: number): PmoRevenueLine | undefined => lines.find((l) => l.quarter === n)
            const sum = (pick: (l: PmoRevenueLine) => string | null): number | null => {
              const vals = lines.map(pick).filter((v): v is string => v !== null).map(Number)
              return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0)
            }
            const planned = sum((l) => l.planned)
            const achieved = sum((l) => l.achieved)
            return (
              <tr key={projectId}>
                <td>{nameById.get(projectId) ?? projectId}</td>
                {[1, 2, 3, 4].map((n) => (
                  <td key={n} className="tabular">
                    <Money amount={q(n)?.planned ?? null} currency="" />
                  </td>
                ))}
                <td className="tabular">{fmt(planned, locale)}</td>
                {/* ACHIEVED IS BLANK WHEN NOBODY HAS REPORTED, never zero — the
                    source dashboard footnotes one of its own figures as covering
                    only the first half of the year for exactly this reason. */}
                <td className="tabular">
                  {achieved === null ? <span className="pmo-quiet">{t('pmo.notSaid')}</span> : fmt(achieved, locale)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ─────────────────────────────── 4. OKRs ───────────────────────────────── */

export function PortfolioOkrs(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  const members = useMemberMap()
  if (!ready || data === null) return <>{frame}</>

  if (data.objectives.length === 0) {
    return <EmptyState title={t('pmo.okrsEmpty')} description={t('pmo.okrsEmptyHint')} />
  }

  const progressById = new Map(data.progress.map((p) => [p.objective_id, p]))
  const krsByObjective = new Map<string, PmoKeyResult[]>()
  for (const kr of data.keyResults) {
    const held = krsByObjective.get(kr.objective_id)
    if (held === undefined) krsByObjective.set(kr.objective_id, [kr])
    else held.push(kr)
  }

  return (
    <ul className="pmo-cards">
      {data.objectives.map((o) => (
        <ObjectiveCard
          key={o.id}
          objective={o}
          progress={progressById.get(o.id) ?? null}
          keyResults={krsByObjective.get(o.id) ?? []}
          ownerName={nameOf(members, o.owner_id)}
        />
      ))}
    </ul>
  )
}

function ObjectiveCard({
  objective,
  progress,
  keyResults,
  ownerName,
}: {
  objective: PmoObjective
  progress: PmoObjectiveProgress | null
  keyResults: readonly PmoKeyResult[]
  ownerName: string | null
}): ReactElement {
  return (
    <li className="card pmo-card">
      <div className="pmo-card-head">
        <h3 className="pmo-card-name">{objective.name}</h3>
        <JiraRef ref={objective.external_ref} />
      </div>

      <dl className="pmo-card-facts">
        <Fact k={t('pmo.colOwner')} v={ownerName} />
        <Fact k={t('pmo.period')} v={objective.period.trim() === '' ? null : objective.period} />
      </dl>

      {/* ⚠ READ OFF THE VIEW, NEVER TYPED. `pmo_objectives` has no progress
          column and 0031's probe 2 refuses one: a typed number and a computed
          one disagree the first time somebody edits a key result and forgets
          the parent. */}
      {progress === null || progress.progress_pct === null ? (
        <p className="pmo-quiet">{t('pmo.okrNoKeyResults')}</p>
      ) : (
        <Bar label={t('pmo.colProgress')} value={progress.progress_pct} kind="actual" />
      )}

      {keyResults.length > 0 && (
        <ul className="pmo-krs">
          {keyResults.map((kr) => (
            <li className="pmo-kr" key={kr.id}>
              <span className="pmo-kr-name">{kr.name}</span>
              <span className="pmo-kr-v tabular">
                {kr.current_value === null ? (
                  <span className="pmo-quiet">{t('pmo.notSaid')}</span>
                ) : (
                  t('pmo.krReading', {
                    current: kr.current_value,
                    target: kr.target_value,
                    unit: kr.unit,
                  })
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/* ───────────────────────────────── bits ────────────────────────────────── */

function Fact({ k, v }: { k: string; v: ReactNode }): ReactElement {
  return (
    <div className="pmo-fact">
      <dt className="pmo-fact-k">{k}</dt>
      <dd className="pmo-fact-v">
        {v === null || v === undefined || v === '' ? (
          <span className="pmo-quiet">{t('pmo.notSaid')}</span>
        ) : (
          v
        )}
      </dd>
    </div>
  )
}

function nameOf(members: ReadonlyMap<string, { displayName: string }>, id: string | null): string | null {
  if (id === null) return null
  return members.get(id)?.displayName ?? null
}

function dateRange(from: string | null, to: string | null): string | null {
  if (from === null && to === null) return null
  return `${from ?? '—'} → ${to ?? '—'}`
}

function fmt(n: number | null, locale: string): ReactNode {
  if (n === null) return <span className="pmo-quiet">{t('pmo.notSaid')}</span>
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(n)
}
