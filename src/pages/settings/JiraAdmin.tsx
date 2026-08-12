// Settings › Jira (/settings/jira) — the harness that proves what Jira returns,
// and writes nothing.
//
// WHAT THIS SCREEN IS FOR, in the owner's own words: "make just read from JIRA
// without changing anything. to test the inputs from JIRA". This is where he
// points the app at his real Jira and finds out whether the tracker and Jira
// agree — before they are ever connected, because "i can not connect the app to
// jira until we verify the tracker very well".
//
// ── THE ORDER OF THE SCREEN IS THE ORDER HE WILL USE IT ────────────────────
//
//   1. CONNECTION. A Test button. Green names the account and the site it
//      authenticated as; red names WHICH secret is missing, or which of
//      wrong-token / no-such-site / rate-limited it was. Never a bare "failed" —
//      the single most likely state this feature is ever in is "not configured
//      yet", and a screen that cannot say so sends him to read three settings
//      when the server already knows which one is blank.
//   2. PROJECTS. So he can see his keys without leaving.
//   3. THE FIELD MAPPING. Which of HIS fields carries the organization, which
//      carries the capability, and what his statuses mean here. This is the part
//      nobody can guess for him, which is exactly why the screen exists.
//      THE STATUS HALF FILLS IN AFTER THE FIRST QUERY, and the card says so:
//      there is no `statuses` operation on the function, and the statuses worth
//      mapping are the handful HIS results carry rather than the dozens
//      configured across the site. Mapping one afterwards re-judges the issues
//      already in hand — `report` recomputes, Jira is not read again — which is
//      the loop this screen is for: map, look, map again.
//   4. THE JQL AND THE RESULT. A query box, and a table of what came back: the
//      issue key linking out to Jira, the raw values, and the mapping's verdict.
//   5. A STANDING STATEMENT THAT NOTHING HAS BEEN WRITTEN. At rest, at the top,
//      every time — not a toast that fades. He is going to run this against live
//      data and needs to know that at a glance.
//
// ── NOT A SINGLE WRITE PATH EXISTS HERE ────────────────────────────────────
//
// No Import, no Apply, no upsert, and nothing disabled-for-now. api/jira.ts has
// no write function to call, this file imports no mutating function from
// anywhere, and `JiraAdmin.test.tsx` greps both files for the write verbs. If it
// is not built it cannot fire by accident against live data, and "without
// changing anything" is then provable by grep rather than by reading every
// branch. THE READS FROM THIS APP'S OWN TABLES — `listMapNodes`,
// `listUseCases` — are what the verdict column is computed against; they are
// selects, and they are the only thing this screen asks the database for.
//
// ── THE SUMMARY LINE IS THE ANSWER TO HIS QUESTION ─────────────────────────
//
// "31 of 40 issues resolve to an organization and a capability; 9 do not", with
// the nine broken down by reason and each reason clickable down to its rows. A
// wall of JSON is not a test of the inputs; a reconciliation is. The arithmetic
// lives in `reconcile()` (api/jira.ts) because a pure function is testable under
// `environment: 'node'` and a rendered table is not.
//
// ⚠ THE COUNT IS OF WHAT CAME BACK, NEVER A SITE TOTAL. Atlassian's current
//   search endpoint returns no `total` at all — paging is a `nextPageToken`
//   cursor — so "there is more" is the function's own `truncated` (a cursor
//   still in hand, or its per-call budget spent) and never a fraction of a
//   number nobody counted. api/jira.ts's header has the detail.
//
// ── WHAT DOES NOT SURVIVE THIS SCREEN ──────────────────────────────────────
//
// The mapping and the JQL are React state and nothing else. No table holds
// them, none is being written this wave, and `jira.notSaved` says so in one
// sentence rather than letting him lose twenty minutes of picking and wonder
// whether the app is broken.
//
// ── SHAPE ──────────────────────────────────────────────────────────────────
//
// Routed and gated exactly like StructureAdmin: `structure.edit`, one Settings
// card, no nav entry. The permission is cosmetic by construction — the function
// re-verifies its caller, as `admin-members` documents — and it is here so that
// somebody who could never read the answer is not offered the screen.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconPlug, IconShieldCheck } from '../../components/icons'
import { Skeleton } from '../../components/shared'
import {
  MAX_PAGE_SIZE,
  distinctStatuses,
  fieldText,
  issueHref,
  jiraFields,
  jiraPing,
  jiraProjects,
  jiraSearch,
  normalizeName,
  reconcile,
  RESOLVE_REASONS,
  type JiraField,
  type JiraMapping,
  type JiraPing,
  type JiraProject,
  type Reconciliation,
  type ResolveReason,
  type ResolvedIssue,
} from '../../api/jira'
import { listMapNodes, listUseCases } from '../../api/map'
import { t, useLocale } from '../../lib/i18n'
import { useNodeLabel } from '../../lib/labels'
import { useHasPerm } from '../../store/auth'
import type { MapNode, UseCase, UseCaseStatus } from '../../types'
import './jira.css'

/**
 * reason → the key that names it.
 *
 * A LITERAL RECORD RATHER THAN `t(\`jira.reason${r}\`)`, and that is not style.
 * `localeReach.test.ts` finds keys by scanning the source for quoted dotted
 * strings; a template literal has no key until it runs, so a family built that
 * way is invisible to the gate and a missing translation ships. Written out, all
 * nine are checked in both languages by that test and by this screen's own.
 */
const REASON_KEY: Readonly<Record<ResolveReason, string>> = {
  matched: 'jira.reasonMatched',
  statusUnmapped: 'jira.reasonStatusUnmapped',
  noMapping: 'jira.reasonNoMapping',
  orgBlank: 'jira.reasonOrgBlank',
  orgUnknown: 'jira.reasonOrgUnknown',
  orgAmbiguous: 'jira.reasonOrgAmbiguous',
  useCaseBlank: 'jira.reasonUseCaseBlank',
  useCaseUnknown: 'jira.reasonUseCaseUnknown',
  useCaseAmbiguous: 'jira.reasonUseCaseAmbiguous',
}

/** The three states a use case can be in here, and what to call each. */
const STATUS_KEY: Readonly<Record<UseCaseStatus, string>> = {
  planned: 'jira.statusPlanned',
  testing: 'jira.statusTesting',
  live: 'jira.statusLive',
}

const STATUS_VALUES: readonly UseCaseStatus[] = ['planned', 'testing', 'live']

/**
 * The fields every search asks for, whatever the mapping says.
 *
 * `status` because the third axis of the mapping is read off it, and `summary`
 * because an issue key alone is not enough for a person to recognise the row
 * they are looking at. Both are sent even when the mapping is empty — an
 * unconfigured screen still has to show that the connection works and that
 * issues come back, which is the first thing to establish and the last thing to
 * make conditional on configuration.
 */
const ALWAYS_FIELDS = ['summary', 'status']

/** One titled card. Local, so this screen owns its own spacing. */
function Card({
  title,
  children,
}: {
  title: string
  children: (ReactElement | null | false)[] | ReactElement
}): ReactElement {
  return (
    <section className="card jir-card">
      <h2 className="jir-card-title">{title}</h2>
      {children}
    </section>
  )
}

export default function JiraAdmin(): ReactElement {
  // Same gate as Settings › Structure. The server re-verifies; this only avoids
  // offering a screen to somebody every call would refuse.
  const canEdit = useHasPerm('structure.edit')
  // Subscribes to the language and to a label override being installed, so every
  // t() below re-renders when Terminology is saved.
  useLocale()
  /**
   * The bilingual fallback, used for BOTH a map node and a use case.
   *
   * One function for two tables because it is one rule about one pair of
   * columns: `name` plus `name_ar not null default ''`, where EMPTY — never
   * null — means "not translated yet" and the reader falls back to `name`.
   * `UseCase` satisfies the same `{ name, name_ar }` shape for exactly that
   * reason. lib/labels.ts is shared and not this unit's to extend, and adding a
   * second identical function here would be the drift that file exists to
   * prevent.
   */
  const label = useNodeLabel()

  /* ---- connection ------------------------------------------------------- */
  const [pinging, setPinging] = useState(false)
  const [ping, setPing] = useState<JiraPing | null>(null)
  const [pingError, setPingError] = useState<string | null>(null)

  /* ---- projects --------------------------------------------------------- */
  const [projectsBusy, setProjectsBusy] = useState(false)
  const [projects, setProjects] = useState<JiraProject[] | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)

  /* ---- the mapping's raw material ---------------------------------------- */
  //
  // Only the FIELD list is fetched. The statuses are read out of the search
  // result instead — see `seenStatuses` below and api/jira.ts's contract note.
  const [configBusy, setConfigBusy] = useState(false)
  const [fields, setFields] = useState<JiraField[] | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  /* ---- the mapping itself — STATE ONLY, PERSISTED NOWHERE ---------------- */
  const [orgFieldId, setOrgFieldId] = useState('')
  const [useCaseFieldId, setUseCaseFieldId] = useState('')
  const [statusMap, setStatusMap] = useState<Record<string, UseCaseStatus>>({})

  /* ---- this workspace's own side of the comparison ------------------------ */
  const [nodes, setNodes] = useState<MapNode[]>([])
  const [useCases, setUseCases] = useState<UseCase[]>([])
  const [catalogueError, setCatalogueError] = useState<string | null>(null)
  const [catalogueReady, setCatalogueReady] = useState(false)

  /* ---- the query and its result ------------------------------------------ */
  const [jql, setJql] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [issues, setIssues] = useState<ResolvedIssue[] | null>(null)
  const [morePages, setMorePages] = useState(false)
  const [only, setOnly] = useState<ResolveReason | null>(null)

  /**
   * The organizations and capabilities this app already has.
   *
   * Read through api/map.ts rather than store/config, for the reason
   * StructureAdmin gives about the same two tables: the store drops archived
   * nodes and the children of archived parents, and an issue about an archived
   * organization must be reported as landing on it rather than as naming
   * something this workspace has never heard of. Both calls are selects.
   */
  useEffect(() => {
    let live = true
    void (async () => {
      const [n, u] = await Promise.all([listMapNodes(true), listUseCases(true)])
      if (!live) return
      if (!n.ok || !u.ok) {
        setCatalogueError(n.ok ? (u.ok ? null : u.error) : n.error)
      } else {
        setNodes(n.data.rows)
        setUseCases(u.data.rows)
        setCatalogueError(null)
      }
      setCatalogueReady(true)
    })()
    return () => {
      live = false
    }
  }, [])

  const mapping: JiraMapping = useMemo(
    () => ({ orgFieldId, useCaseFieldId, statuses: statusMap }),
    [orgFieldId, useCaseFieldId, statusMap],
  )

  /**
   * The verdicts, recomputed whenever the mapping moves.
   *
   * NOT RECOMPUTED BY RE-QUERYING JIRA. Changing which field carries the
   * organization is a question about the issues already in hand, and asking
   * Jira again would spend a round trip to learn nothing — except when the new
   * field was never fetched, which is why the Run button is the only thing that
   * decides which fields are on the wire. A field picked after a run shows blank
   * until the query is run again; that is honest, and the alternative is a
   * screen that silently re-queries live data every time a select changes.
   */
  const report: Reconciliation | null = useMemo(() => {
    if (issues === null) return null
    return reconcile(
      issues.map((row) => row.issue),
      mapping,
      { nodes, useCases },
    )
  }, [issues, mapping, nodes, useCases])

  /**
   * The statuses to map, taken from the ISSUES rather than from the site.
   *
   * There is no `statuses` operation on the function, and the screen is better
   * for it: a site's full workflow list is dozens of statuses across every
   * project on it, and mapping statuses no issue in the query carries is work
   * that answers nothing. These are the handful his own results stand in.
   *
   * It follows that the query is run BEFORE this list exists, and that changing
   * a status mapping afterwards re-judges the issues already in hand without
   * touching Jira again — `report` recomputes, `onRun` is not called. That is
   * the loop this screen is for: map, look, map again.
   */
  const seenStatuses = useMemo(
    () => (issues === null ? [] : distinctStatuses(issues.map((row) => row.issue))),
    [issues],
  )

  const onTest = useCallback(async () => {
    setPinging(true)
    setPingError(null)
    const result = await jiraPing()
    if (result.ok) setPing(result.data)
    else {
      setPing(null)
      setPingError(result.error)
    }
    setPinging(false)
  }, [])

  const onProjects = useCallback(async () => {
    setProjectsBusy(true)
    setProjectsError(null)
    const result = await jiraProjects()
    if (result.ok) setProjects(result.data)
    else {
      setProjects(null)
      setProjectsError(result.error)
    }
    setProjectsBusy(false)
  }, [])

  /** The site's field list — the only half of the mapping that needs a call. */
  const onLoadConfig = useCallback(async () => {
    setConfigBusy(true)
    setConfigError(null)
    const result = await jiraFields()
    if (result.ok) setFields(result.data)
    else setConfigError(result.error)
    setConfigBusy(false)
  }, [])

  const onRun = useCallback(async () => {
    setSearching(true)
    setSearchError(null)
    setOnly(null)
    const wanted = [...ALWAYS_FIELDS, orgFieldId, useCaseFieldId].filter((f) => f !== '')
    const result = await jiraSearch({ jql, fields: wanted, maxResults: MAX_PAGE_SIZE })
    if (result.ok) {
      // Stored as rows so the table has something stable to key off; the
      // verdicts themselves are recomputed by `report` above whenever the
      // mapping changes, which is why this list is deliberately not the
      // rendered one.
      setIssues(
        reconcile(result.data.issues, mapping, { nodes, useCases }).rows,
      )
      // No `total` exists to compare against, so "there is more" is the
      // function's own `truncated` (a leftover cursor, or its per-call budget
      // spent) and never a fraction of a number nobody counted. api/jira.ts's
      // header has the endpoint detail.
      setMorePages(result.data.truncated)
    } else {
      setIssues(null)
      setMorePages(false)
      setSearchError(result.error)
    }
    setSearching(false)
  }, [jql, orgFieldId, useCaseFieldId, mapping, nodes, useCases])

  if (!canEdit) return <Navigate to="/settings" replace />

  const rows = report === null ? [] : only === null
    ? report.rows
    : report.rows.filter((row) => row.reason === only)

  /* ---- one issue row ------------------------------------------------------ */

  const renderRow = (row: ResolvedIssue): ReactElement => {
    // The function supplies the link; this rebuilds it from the ping only when
    // it did not. Both go through the http(s) guard in api/jira.ts, which is
    // the same rule 0023 puts on `external_url` for the same reason.
    const href = row.issue.url ?? (ping ? issueHref(ping.site.baseUrl, row.issue.key) : null)
    const summary = fieldText(row.issue.fields.summary)
    return (
      <tr key={row.issue.key} className="jir-row" data-reason={row.reason}>
        <td className="jir-cell jir-cell-issue">
          {href ? (
            <a
              className="jir-issue-link"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t('jira.openIssue', { key: row.issue.key })}
            >
              {row.issue.key}
            </a>
          ) : (
            <span className="jir-issue-key">
              {row.issue.key}
              <span className="jir-muted"> {t('jira.noLink')}</span>
            </span>
          )}
          {summary ? <span className="jir-issue-summary">{summary}</span> : null}
        </td>
        <td className="jir-cell">{row.orgValue || <em className="jir-muted">{t('jira.blank')}</em>}</td>
        <td className="jir-cell">
          {row.useCaseValue || <em className="jir-muted">{t('jira.blank')}</em>}
        </td>
        <td className="jir-cell">
          {row.statusValue || <em className="jir-muted">{t('jira.blank')}</em>}
        </td>
        <td className="jir-cell jir-cell-verdict">
          {row.node && row.useCase ? (
            <>
              <span className="jir-verdict-pair">
                {t('jira.verdictPair', {
                  node: label(row.node),
                  useCase: label(row.useCase),
                })}
              </span>
              <span className="jir-muted">
                {row.status
                  ? t('jira.verdictStatus', { status: t(STATUS_KEY[row.status]) })
                  : t(REASON_KEY.statusUnmapped)}
              </span>
            </>
          ) : (
            <span className="jir-verdict-no">{t(REASON_KEY[row.reason])}</span>
          )}
          {/* The ambiguity is the one refusal a reader will not believe without
              the number: 0023's sibling-name uniqueness is scoped to the PARENT,
              so two organizations of the same name under two phases is a legal
              state of this database and not a mistake to go hunting for. */}
          {row.nodeMatches > 1 || row.useCaseMatches > 1 ? (
            <span className="jir-muted">
              {t('jira.ambiguousMatches', {
                count: Math.max(row.nodeMatches, row.useCaseMatches),
              })}
            </span>
          ) : null}
        </td>
      </tr>
    )
  }

  return (
    <div className="jir">
      <div className="jir-bar">
        <Link to="/settings" className="btn btn-ghost btn-sm">
          {/* icon-directional: a back arrow points at the reading start, so it
              mirrors in Arabic. */}
          <IconArrowStart className="icon-directional" size={16} />
          {t('common.back')}
        </Link>
      </div>

      {/* No page heading: App.tsx's header renders this route's title as the
          document h1, and a second copy is noise in the outline. */}
      <p className="jir-intro">{t('jira.subtitle')}</p>

      {/* THE STANDING STATEMENT. First thing on the screen, present at rest,
          never a toast: he is running this against live data and has to be able
          to see at a glance, every single time, that nothing is being written on
          either side. A message that fades is a message he has to remember. */}
      <section className="card jir-readonly" aria-labelledby="jir-ro-title">
        <h2 className="jir-card-title" id="jir-ro-title">
          <IconShieldCheck size={16} />
          {t('jira.readOnlyTitle')}
        </h2>
        <ul className="jir-ro-list">
          <li>{t('jira.readOnlyJira')}</li>
          <li>{t('jira.readOnlyApp')}</li>
        </ul>
        <p className="jir-note">{t('jira.readOnlyBody')}</p>
        <p className="jir-note">{t('jira.notSaved')}</p>
      </section>

      <Card title={t('jira.connTitle')}>
        <p className="jir-note">{t('jira.connBody')}</p>
        <div className="jir-actions">
          <button type="button" className="btn" disabled={pinging} onClick={() => void onTest()}>
            {pinging ? t('jira.connTesting') : t('jira.connTest')}
          </button>
        </div>
        {/* Three states, three different sentences, and never a bare failure. */}
        {ping ? (
          <p className="jir-ok" role="status">
            {t('jira.connOk', {
              account: ping.account.displayName || ping.account.accountId,
              site: ping.site.hostname || ping.site.baseUrl,
            })}
            {ping.account.emailAddress ? (
              <span className="jir-muted">
                {t('jira.connEmail', { email: ping.account.emailAddress })}
              </span>
            ) : null}
          </p>
        ) : pingError ? (
          <p className="field-error" role="alert">
            {t(pingError)}
          </p>
        ) : (
          <p className="jir-muted">{t('jira.connUntested')}</p>
        )}
        <p className="jir-note">{t('jira.connSecrets')}</p>
      </Card>

      <Card title={t('jira.projectsTitle')}>
        <p className="jir-note">{t('jira.projectsBody')}</p>
        <div className="jir-actions">
          <button
            type="button"
            className="btn"
            disabled={projectsBusy}
            onClick={() => void onProjects()}
          >
            {projectsBusy ? t('jira.projectsLoading') : t('jira.projectsLoad')}
          </button>
        </div>
        {projectsError ? (
          <p className="field-error" role="alert">
            {t(projectsError)}
          </p>
        ) : projects === null ? (
          <p className="jir-muted">{t('jira.projectsUntried')}</p>
        ) : projects.length === 0 ? (
          <p className="jir-muted">{t('jira.projectsEmpty')}</p>
        ) : (
          <>
            <p className="jir-muted">{t('jira.projectsCount', { count: projects.length })}</p>
            <ul className="jir-projects">
              {projects.map((project) => (
                <li key={project.id || project.key} className="jir-project">
                  <span className="jir-project-key tabular">{project.key}</span>
                  <span className="jir-project-name">{project.name}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title={t('jira.mapTitle')}>
        <p className="jir-note">{t('jira.mapBody')}</p>
        <p className="jir-note">{t('jira.mapShape')}</p>
        <div className="jir-actions">
          <button
            type="button"
            className="btn"
            disabled={configBusy}
            onClick={() => void onLoadConfig()}
          >
            {configBusy ? t('jira.mapLoading') : t('jira.mapLoad')}
          </button>
        </div>
        {configError ? (
          <p className="field-error" role="alert">
            {t(configError)}
          </p>
        ) : null}
        {fields === null || fields.length === 0 ? (
          <p className="jir-muted">{t('jira.fieldsEmpty')}</p>
        ) : (
          <div className="jir-fields">
            {/* Two selects over the SAME list: a site where one field carries
                both axes is a site this screen has to be able to describe, so
                neither select excludes the other's choice. */}
            <label className="field">
              <span className="field-label">{t('jira.orgField')}</span>
              <select
                className="select"
                value={orgFieldId}
                onChange={(e) => setOrgFieldId(e.target.value)}
              >
                <option value="">{t('jira.fieldNone')}</option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.custom ? `${field.name} (${t('jira.fieldCustom')})` : field.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('jira.useCaseField')}</span>
              <select
                className="select"
                value={useCaseFieldId}
                onChange={(e) => setUseCaseFieldId(e.target.value)}
              >
                <option value="">{t('jira.fieldNone')}</option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.custom ? `${field.name} (${t('jira.fieldCustom')})` : field.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </Card>

      <Card title={t('jira.statusTitle')}>
        <p className="jir-note">{t('jira.statusBody')}</p>
        {seenStatuses.length === 0 ? (
          <p className="jir-muted">{t('jira.statusesEmpty')}</p>
        ) : (
          <ul className="jir-statuses">
            {seenStatuses.map((name) => {
              // Keyed by the NORMALISED name, because that is what the resolver
              // looks the issue's own status up by — the same string through the
              // same function, so two spellings of one status share one row and
              // one answer.
              const key = normalizeName(name)
              return (
                <li key={key} className="jir-status">
                  <span className="jir-status-name">{name}</span>
                  <label className="field jir-status-pick">
                    <span className="sr-only">{t('jira.statusFor', { status: name })}</span>
                    <select
                      className="select"
                      value={statusMap[key] ?? ''}
                      onChange={(e) => {
                        const value = e.target.value
                        setStatusMap((prev) => {
                          const next = { ...prev }
                          if (value === '') delete next[key]
                          else next[key] = value as UseCaseStatus
                          return next
                        })
                      }}
                    >
                      <option value="">{t('jira.statusIgnore')}</option>
                      {STATUS_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {t(STATUS_KEY[value])}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card title={t('jira.jqlTitle')}>
        <p className="jir-note">{t('jira.jqlBody')}</p>
        <label className="field">
          <span className="field-label">{t('jira.jqlLabel')}</span>
          {/* dir="ltr" unconditionally: JQL is a Latin-only formal language, and
              in an Arabic UI an unmarked field would put the caret at the right
              and reorder the operators around every Arabic literal inside it. */}
          <textarea
            className="input jir-jql"
            dir="ltr"
            rows={3}
            value={jql}
            placeholder={t('jira.jqlExample')}
            onChange={(e) => setJql(e.target.value)}
          />
        </label>
        <p className="jir-note">{t('jira.jqlHint')}</p>
        <div className="jir-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={searching || jql.trim() === ''}
            onClick={() => void onRun()}
          >
            {searching ? t('jira.jqlRunning') : t('jira.jqlRun')}
          </button>
        </div>
        {searchError ? (
          <p className="field-error" role="alert">
            {t(searchError)}
          </p>
        ) : null}
      </Card>

      <Card title={t('jira.resultsTitle')}>
        {catalogueError ? (
          <p className="field-error" role="alert">
            {t('jira.catalogueFailed')}
          </p>
        ) : null}
        {!catalogueReady ? <Skeleton height={44} /> : null}
        {searching ? <Skeleton height={120} /> : null}
        {!searching && report === null ? <p className="jir-muted">{t('jira.resultsUntried')}</p> : null}
        {!searching && report !== null && report.total === 0 ? (
          <p className="jir-muted">{t('jira.resultsEmpty')}</p>
        ) : null}

        {!searching && report !== null && report.total > 0 && (
          <>
            {/* THE ANSWER. One paragraph, three counted clauses, each its own
                plural node so the noun agrees with the number in both languages
                — a single string with three {tokens} could only inflect for one
                of them. */}
            <p className="jir-summary" role="status">
              <span className="tabular">{t('jira.summaryFetched', { count: report.total })}</span>{' '}
              <span className="tabular">{t('jira.summaryMatched', { count: report.matched })}</span>{' '}
              <span className="tabular">
                {t('jira.summaryUnmatched', { count: report.unmatched })}
              </span>
            </p>
            {morePages ? <p className="jir-note">{t('jira.morePages')}</p> : null}

            <h3 className="jir-sub">{t('jira.breakdownTitle')}</h3>
            <ul className="jir-breakdown">
              {RESOLVE_REASONS.filter((reason) => report.byReason[reason] > 0).map((reason) => (
                <li key={reason} className="jir-reason" data-reason={reason}>
                  <span className="jir-reason-label">{t(REASON_KEY[reason])}</span>
                  <span className="jir-reason-count tabular">
                    {t('jira.issueCount', { count: report.byReason[reason] })}
                  </span>
                  {/* REACHABLE, not just counted: the nine that did not resolve
                      are the reason he ran this, and a number he cannot open is
                      a number he has to take on trust. */}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-pressed={only === reason}
                    onClick={() => setOnly(only === reason ? null : reason)}
                  >
                    {only === reason ? t('jira.showAll') : t('jira.showOnly')}
                  </button>
                </li>
              ))}
            </ul>
            {only !== null ? (
              <p className="jir-note" role="status">
                {t('jira.filtered', { reason: t(REASON_KEY[only]) })}
              </p>
            ) : null}

            <div className="jir-table-wrap">
              <table className="jir-table" aria-label={t('jira.tableLabel')}>
                <thead>
                  <tr>
                    <th scope="col">{t('jira.colIssue')}</th>
                    <th scope="col">{t('jira.colOrgValue')}</th>
                    <th scope="col">{t('jira.colUseCaseValue')}</th>
                    <th scope="col">{t('jira.colStatus')}</th>
                    <th scope="col">{t('jira.colVerdict')}</th>
                  </tr>
                </thead>
                <tbody>{rows.map(renderRow)}</tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* The mark this screen ends on is the one it opened with: a plug, and a
          sentence saying nothing moved through it. */}
      <p className="jir-foot">
        <IconPlug size={16} />
        {t('jira.readOnlyTitle')}
      </p>
    </div>
  )
}
