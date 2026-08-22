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
  PmoAction,
  PmoInitiative,
  PmoKeyResult,
  PmoObjective,
  PmoObjectiveProgress,
  PmoProject,
  PmoRevenueLine,
  PmoRisk,
} from '../../types'
// THE FORMS THAT FILL THESE TABLES IN. Each one renders NOTHING without the
// permission 0031 gates its table on, so this file needs no branch of its own —
// see `PortfolioEditor.tsx`'s header on why absence rather than a disabled
// control.
import {
  ActionEditor,
  InitiativeEditor,
  KeyResultEditor,
  ObjectiveEditor,
  ProjectEditor,
  RevenueEditor,
  RiskEditor,
} from './PortfolioEditor'
import {
  GRADE_LABEL,
  INITIATIVE_STEPS,
  PHASE_LABEL,
  PROJECT_STEPS,
  REGISTER_LABEL,
  STATUS_LABEL,
} from './vocab'

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
 * A titled block for the two sections this file grew when the forms landed.
 *
 * `pages/Pmo.tsx` has its own `Section` and this is deliberately not it: that
 * one is a page-level component the page composes, and importing it here would
 * make the page and its own section list circular. Same markup, so the two read
 * as one page.
 */
function OwnSection({
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

/* ───────────────────────────── 1. projects ─────────────────────────────── */

export function PortfolioProjects(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  const members = useMemberMap()
  const locale = useLocale()
  if (!ready || data === null) return <>{frame}</>

  return (
    <>
      {/* ⚠ THE ADD CONTROL SITS OUTSIDE THE EMPTY BRANCH, not inside the list.
          An empty portfolio is precisely the state in which somebody needs to
          add the first project, and an "add" button that only appears once
          there is something to add is a screen you cannot start from. */}
      <ProjectEditor />
      {data.projects.length === 0 ? (
        <EmptyState title={t('pmo.projectsEmpty')} description={t('pmo.projectsEmptyHint')} />
      ) : (
        <ul className="pmo-cards">
          {data.projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              managerName={nameOf(members, p.manager_id)}
              locale={locale}
            />
          ))}
        </ul>
      )}
    </>
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

      <ProjectEditor project={project} />
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

  return (
    <>
      <InitiativeEditor />
      {data.initiatives.length === 0 ? (
        <EmptyState title={t('pmo.initEmpty2')} description={t('pmo.initEmptyHint2')} />
      ) : (
        <ul className="pmo-cards">
          {data.initiatives.map((i) => (
            <InitiativeCard
              key={i.id}
              initiative={i}
              managerName={nameOf(members, i.manager_id)}
              locale={locale}
            />
          ))}
        </ul>
      )}
    </>
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

      <InitiativeEditor initiative={initiative} />
    </li>
  )
}

/* ───────────────────────────── 3. revenue ──────────────────────────────── */

export function PortfolioRevenue(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  const locale = useLocale()
  if (!ready || data === null) return <>{frame}</>

  // One row per project, four quarter columns — the source dashboard's shape.
  const byProject = new Map<string, PmoRevenueLine[]>()
  for (const line of data.revenue) {
    const held = byProject.get(line.project_id)
    if (held === undefined) byProject.set(line.project_id, [line])
    else held.push(line)
  }
  const nameById = new Map(data.projects.map((p) => [p.id, p.name]))
  const projectOptions = data.projects.map((p) => ({ value: p.id, label: p.name }))

  return (
    <>
      {/* ⚠ REVENUE CANNOT EXIST WITHOUT A PROJECT — `project_id` is NOT NULL in
          0031, because a quarter's money that belongs to nothing sums into no
          column on this table. So the form is not offered until there is
          something to attach it to, and the reason is said out loud rather than
          left as a select with no options in it. */}
      {data.projects.length === 0 ? (
        <p className="muted pmo-desc">{t('pmo.revenueNeedsProject')}</p>
      ) : (
        <RevenueEditor projects={projectOptions} defaultYear={new Date().getFullYear()} />
      )}

      {data.revenue.length === 0 ? (
        <EmptyState title={t('pmo.revenueEmpty')} description={t('pmo.revenueEmptyHint')} />
      ) : (
        <>
          <RevenueTable byProject={byProject} nameById={nameById} locale={locale} />
          {/* THE TABLE IS THE READING; THIS IS THE REGISTER. A quarter cell is
              one of twenty-four numbers in a grid and has nowhere to hang an
              edit control that a thumb could hit at 375px, so the rows are
              listed once more underneath, each with its own. */}
          <ul className="pmo-lines">
            {data.revenue.map((line) => (
              <li className="pmo-line" key={line.id}>
                <span className="pmo-line-k">{nameById.get(line.project_id) ?? line.project_id}</span>
                <span className="pmo-line-v tabular">
                  {line.year} {t('pmo.quarter', { n: line.quarter })}
                </span>
                <RevenueEditor
                  line={line}
                  projects={projectOptions}
                  defaultYear={line.year}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function RevenueTable({
  byProject,
  nameById,
  locale,
}: {
  byProject: ReadonlyMap<string, PmoRevenueLine[]>
  nameById: ReadonlyMap<string, string>
  locale: string
}): ReactElement {
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

  const progressById = new Map(data.progress.map((p) => [p.objective_id, p]))
  const krsByObjective = new Map<string, PmoKeyResult[]>()
  for (const kr of data.keyResults) {
    const held = krsByObjective.get(kr.objective_id)
    if (held === undefined) krsByObjective.set(kr.objective_id, [kr])
    else held.push(kr)
  }

  return (
    <>
      <ObjectiveEditor />
      {data.objectives.length === 0 ? (
        <EmptyState title={t('pmo.okrsEmpty')} description={t('pmo.okrsEmptyHint')} />
      ) : (
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
      )}
    </>
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
              <KeyResultEditor objectiveId={objective.id} keyResult={kr} />
            </li>
          ))}
        </ul>
      )}

      <div className="pmo-card-edit">
        <ObjectiveEditor objective={objective} />
        {/* THE KEY RESULT'S ADD CONTROL LIVES ON ITS OBJECTIVE, because
            `objective_id` is NOT NULL and there is no other place a reader
            could say which objective they meant. */}
        <KeyResultEditor objectiveId={objective.id} />
      </div>
    </li>
  )
}

/* ══════════════════ 5. the PMO's own actions and register ═══════════════ */
//
// ⚠ THESE ARE NOT THE `entries` REGISTERS THE ACTIONS AND RISKS TABS ALREADY
//   SHOW. Those are captured work items with health, SLA and follow-up buckets,
//   read through `lib/entrySections`. `pmo_actions` and `pmo_risks` are 0031's
//   own tables: a huddle's follow-up list with up to two owners, and the source
//   dashboard's Challenges/Risks grid. They sit UNDER the existing registers in
//   the same two tabs rather than in tabs of their own, because a director
//   asking "what is outstanding" should not have to know which of two systems a
//   line was written in — but they are separately titled, because merging them
//   into one list would silently claim they are the same object.
//
// They are also the only two sections here a member can write to without
// `structure.edit`; see 0031's permission sentence.

/** Project and initiative names in one lookup — an action may name either. */
function scopeNames(data: {
  projects: readonly PmoProject[]
  initiatives: readonly PmoInitiative[]
}): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const p of data.projects) out.set(p.id, p.name)
  for (const i of data.initiatives) out.set(i.id, i.name)
  return out
}

function scopeLabel(
  scope: ReadonlyMap<string, string>,
  projectId: string | null,
  initiativeId: string | null,
): string | null {
  const id = projectId ?? initiativeId
  if (id === null) return null
  return scope.get(id) ?? null
}

export function PortfolioActions(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  const members = useMemberMap()
  if (!ready || data === null) return <>{frame}</>

  const scope = scopeNames(data)

  return (
    <OwnSection id="pmo-own-actions" title={t('pmo.actionsOwn')} desc={t('pmo.actionsOwnDesc')}>
      <ActionEditor />
      {data.actions.length === 0 ? (
        <EmptyState title={t('pmo.actionsOwnEmpty')} description={t('pmo.actionsOwnEmptyHint')} />
      ) : (
        <ul className="pmo-cards">
          {data.actions.map((a) => (
            <ActionRow key={a.id} action={a} members={members} scope={scope} />
          ))}
        </ul>
      )}
    </OwnSection>
  )
}

function ActionRow({
  action,
  members,
  scope,
}: {
  action: PmoAction
  members: ReadonlyMap<string, { displayName: string }>
  scope: ReadonlyMap<string, string>
}): ReactElement {
  return (
    <li className="card pmo-card">
      <div className="pmo-card-head">
        <h3 className="pmo-card-name">{action.title}</h3>
        <JiraRef ref={action.external_ref} />
      </div>

      <dl className="pmo-card-facts">
        <Fact k={t('pmo.colOwner')} v={nameOf(members, action.owner_id)} />
        <Fact k={t('pmo.owner2')} v={nameOf(members, action.owner2_id)} />
        <Fact k={t('pmo.colScope')} v={scopeLabel(scope, action.project_id, action.initiative_id)} />
        <Fact k={t('pmo.colDue')} v={action.due_date} />
        {/* `done_at` NULL IS OPEN — 0031 keeps the timestamp rather than a
            boolean so "5 complete" can become "closed this week" later. */}
        <Fact
          k={t('pmo.colStatus')}
          v={action.done_at === null ? t('pmo.status.open') : t('pmo.projDone')}
        />
      </dl>

      {action.detail.trim() !== '' && <p className="pmo-card-note">{action.detail}</p>}

      <ActionEditor action={action} />
    </li>
  )
}

export function PortfolioRisks(): ReactElement {
  const { ready, frame } = usePortfolio()
  const data = usePmo()
  if (!ready || data === null) return <>{frame}</>

  const scope = scopeNames(data)

  return (
    <OwnSection id="pmo-own-risks" title={t('pmo.risksOwn')} desc={t('pmo.risksOwnDesc')}>
      <RiskEditor />
      {data.risks.length === 0 ? (
        <EmptyState title={t('pmo.risksOwnEmpty')} description={t('pmo.risksOwnEmptyHint')} />
      ) : (
        <ul className="pmo-cards">
          {data.risks.map((r) => (
            <RiskRow key={r.id} risk={r} scope={scope} />
          ))}
        </ul>
      )}
    </OwnSection>
  )
}

function RiskRow({
  risk,
  scope,
}: {
  risk: PmoRisk
  scope: ReadonlyMap<string, string>
}): ReactElement {
  return (
    <li className="card pmo-card">
      <div className="pmo-card-head">
        <h3 className="pmo-card-name">{risk.summary}</h3>
        <JiraRef ref={risk.external_ref} />
      </div>

      <dl className="pmo-card-facts">
        <Fact k={t('pmo.registerLabel')} v={REGISTER_LABEL[risk.register]()} />
        <Fact k={t('pmo.colScope')} v={scopeLabel(scope, risk.project_id, risk.initiative_id)} />
        {/* UNGRADED PRINTS "Nobody has said", never "Low". 0031 makes both
            columns nullable precisely because a fresh register has neither. */}
        <Fact k={t('pmo.level')} v={risk.level === null ? null : GRADE_LABEL[risk.level]()} />
        <Fact k={t('pmo.impact')} v={risk.impact === null ? null : GRADE_LABEL[risk.impact]()} />
        <Fact k={t('pmo.colStatus')} v={STATUS_LABEL[risk.status]()} />
      </dl>

      {risk.mitigation.trim() !== '' && <p className="pmo-card-note">{risk.mitigation}</p>}

      <RiskEditor risk={risk} />
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
