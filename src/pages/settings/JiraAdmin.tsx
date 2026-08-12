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
//      carries the capability, which carries the status, and whether Arabic
//      orthography is folded when names are compared. This is the part nobody
//      can guess for him, which is exactly why the screen exists.
//      THE STATUS HALF FILLS IN AFTER THE FIRST QUERY, and the card says so:
//      there is no `statuses` operation on the function, and the statuses worth
//      mapping are the handful HIS results carry rather than the dozens
//      configured across the site. Mapping one afterwards re-judges the issues
//      already in hand — the preview recomputes, Jira is not read again — which
//      is the loop this screen is for: map, look, map again.
//   4. THE JQL AND THE READINGS. A query box, and a table of what came back: the
//      issue key linking out to Jira, the raw values, and — per issue — either
//      where it lands or EVERY reason it does not.
//   5. A STANDING STATEMENT THAT NOTHING HAS BEEN WRITTEN. At rest, at the top,
//      every time — not a toast that fades. He is going to run this against live
//      data and needs to know that at a glance.
//
// ── ONE MAPPER, AND IT IS THE TESTED ONE ───────────────────────────────────
//
// This screen used to call `reconcile()` in api/jira.ts. There were two mappers
// in this repo — that one, and `src/lib/jira/map.ts`, which was richer, pure,
// carried 800 lines of tests and was wired to NOTHING. §C of the map-revamp plan
// deleted the parallel one, and this screen now renders `mapJiraIssues`. What
// changed on the glass, all of it visible to Aziz:
//
//   · ALL THE REASONS PER ISSUE, not the first blocking one. An issue with no
//     Organization value AND an unmapped status states both, because reporting
//     one, waiting for a fix and then reporting the other is two round trips for
//     one issue.
//   · "NOT IN THE PAYLOAD" IS NOT "EMPTY". `absent` on every issue means the
//     field id is wrong or the API token cannot see it (configuration); `blank`
//     on some issues means people have not filled it in (fieldwork). Same-looking
//     empty cell, two completely different people to go and talk to.
//   · AN ARCHIVED ORGANIZATION AND A RETIRED CAPABILITY RESOLVE, AND ARE MARKED.
//     Dropping them would report a name that is visibly in the workspace as
//     unknown and send him hunting for a typo that does not exist.
//   · TWO ISSUES CLAIMING ONE ORGANIZATION × CAPABILITY CELL is drawn as the
//     warning it is, naming the issue that claimed it first. A resolver without
//     that concept lets the last write win, silently, inside a hospital's record.
//   · WHAT A SYNC WOULD DO — create / update / unchanged / held — counted from
//     the rows this workspace already has. `held` is the `overrides` contract
//     from 0023/0024: a status edited HERE that a sync must not overwrite.
//
// ── NOT A SINGLE WRITE PATH EXISTS HERE ────────────────────────────────────
//
// No Import, no Apply, no Sync now, no upsert, and nothing disabled-for-now.
// api/jira.ts has no write function to call, this file imports no mutating
// function from anywhere, and `JiraAdmin.test.tsx` greps both files for the
// write verbs. If it is not built it cannot fire by accident against live data,
// and "without changing anything" is then provable by grep rather than by
// reading every branch. THE READS FROM THIS APP'S OWN TABLES — `listMapNodes`,
// `listUseCases`, `listNodeUseCasesFor` — are what the readings are computed
// against; all three are selects, and they are the only thing this screen asks
// the database for.
//
// THE FOUR REFUSALS ARE ON THE GLASS, each where a person would look for the
// thing it refuses: no apply button beside what a sync would do, no schedule
// beside the Run button, no entry sync and no organization creation beside the
// readings. A capability that is deliberately absent and unmentioned reads as a
// capability nobody thought of.
//
// ⚠ THE COUNT IS OF WHAT CAME BACK, NEVER A SITE TOTAL. Atlassian's current
//   search endpoint returns no `total` at all — paging is a `nextPageToken`
//   cursor — so "there is more" is a cursor still in hand, and the answer to it
//   is the Read-the-next-page button below the table rather than a shrug.
//
// ── WHAT SURVIVES THIS SCREEN, AND WHAT STILL DOES NOT ─────────────────────
//
// The mapping, the JQL and the off-switch are saved — one row, `jira_settings`
// (0028), written by the Save button at the foot of the mapping card and read
// back through `store/config`. This paragraph used to say the opposite, and
// `jira.notSaved` used to say it on the glass; both were retired in the commit
// that landed persistence, because a screen that says "none of this is saved"
// while saving it is worse than one that says nothing.
//
// WHAT IS STILL NOT WRITTEN, and is stated on the glass beside each thing it
// refuses: nothing goes to Jira; no organization, capability or item is created
// here; there is no apply path and no scheduled sync. `jira.readOnlyApp` stays
// true word for word — the configuration is this screen's own settings, not
// this workspace's data.
//
// The results themselves do NOT survive: the issues in hand are React state,
// and reopening the screen reads nothing until the Run button is pressed. That
// is deliberate — this screen never touches a live third party on mount.
//
// ── SHAPE ──────────────────────────────────────────────────────────────────
//
// Routed and gated exactly like StructureAdmin: `structure.edit`, one Settings
// card, no nav entry. The permission is cosmetic by construction — the function
// re-verifies its caller, as `admin-members` documents — and it is here so that
// somebody who could never read the answer is not offered the screen.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IconArrowStart, IconPlug, IconShieldCheck } from '../../components/icons'
import { Skeleton } from '../../components/shared'
import {
  MAX_PAGE_SIZE,
  issueHref,
  jiraFields,
  jiraPing,
  jiraProjects,
  jiraSearch,
  type JiraField,
  type JiraPing,
  type JiraProject,
} from '../../api/jira'
import { listMapNodes, listNodeUseCasesFor, listUseCases } from '../../api/map'
import {
  distinctStatusValues,
  mapJiraIssues,
  statusMapConflicts,
  type JiraExistingLink,
  type JiraPreview,
  type JiraReading,
  type JiraUnresolvedReason,
} from '../../lib/jira/map'
import {
  jiraSearchFields,
  readFieldText,
  type JiraFieldMapping,
  type JiraIssue,
} from '../../lib/jira/types'
import { t, useLocale } from '../../lib/i18n'
import { useNodeLabel } from '../../lib/labels'
import { useHasPerm } from '../../store/auth'
// The STORE owns the write, never `api/jiraSettings` directly: the off-switch
// has one answer (`useJiraEnabled()`), so it has exactly one place that changes
// it, and a save from this screen has to land in the same cell every other
// surface reads.
import { saveJiraConfig, useJiraSettings } from '../../store/config'
import type { MapNode, UseCase, UseCaseStatus } from '../../types'
import './jira.css'

/**
 * The fourteen ways an issue can fail to land, as this screen names them.
 *
 * THIRTEEN CODES, FOURTEEN SENTENCES: `issue-malformed` splits by its `detail`,
 * because "the payload carried no key" and "the payload carried no fields
 * object" have different causes and different fixes — the second is what a
 * search that forgot its `fields` list returns, and telling him so by name is
 * the difference between one look and an afternoon.
 *
 * A LITERAL RECORD RATHER THAN `t(\`jira.reason${code}\`)`, and that is not
 * style. `localeReach.test.ts` finds keys by scanning the source for quoted
 * dotted strings; a template literal has no key until it runs, so a family built
 * that way is invisible to the gate and a missing translation ships. Written
 * out, all fourteen are checked in both languages by that test and by this
 * screen's own — which also derives this list from `map.ts`'s own `code:`
 * literals, so a fifteenth reason cannot ship unnamed.
 *
 * Declaration order is display order in the breakdown: the malformed payload
 * first (nothing else can be said about that issue), then the three fields in
 * the order the mapping asks for them, then the collision between two issues.
 */
const REASON_KEY = {
  issueNoKey: 'jira.reasonIssueNoKey',
  issueNoFields: 'jira.reasonIssueNoFields',
  organizationMissing: 'jira.reasonOrganizationMissing',
  organizationMultivalued: 'jira.reasonOrganizationMultivalued',
  organizationUnknown: 'jira.reasonOrganizationUnknown',
  organizationAmbiguous: 'jira.reasonOrganizationAmbiguous',
  useCaseMissing: 'jira.reasonUseCaseMissing',
  useCaseMultivalued: 'jira.reasonUseCaseMultivalued',
  useCaseUnknown: 'jira.reasonUseCaseUnknown',
  useCaseAmbiguous: 'jira.reasonUseCaseAmbiguous',
  statusMissing: 'jira.reasonStatusMissing',
  statusMultivalued: 'jira.reasonStatusMultivalued',
  statusUnmapped: 'jira.reasonStatusUnmapped',
  duplicatePair: 'jira.reasonDuplicatePair',
} as const

type ReasonName = keyof typeof REASON_KEY

const REASON_NAMES = Object.keys(REASON_KEY) as ReasonName[]

/**
 * The mapper's code → the name above.
 *
 * `issue-malformed` is absent on purpose: it is the one code whose sentence
 * depends on its payload, and `reasonNameOf` resolves it from `detail`. A
 * `Record` over the other twelve makes a new code a compile error here rather
 * than a row that renders its own code at a reader.
 */
const CODE_NAME: Readonly<
  Record<Exclude<JiraUnresolvedReason['code'], 'issue-malformed'>, ReasonName>
> = {
  'organization-missing': 'organizationMissing',
  'organization-multivalued': 'organizationMultivalued',
  'organization-unknown': 'organizationUnknown',
  'organization-ambiguous': 'organizationAmbiguous',
  'use-case-missing': 'useCaseMissing',
  'use-case-multivalued': 'useCaseMultivalued',
  'use-case-unknown': 'useCaseUnknown',
  'use-case-ambiguous': 'useCaseAmbiguous',
  'status-missing': 'statusMissing',
  'status-multivalued': 'statusMultivalued',
  'status-unmapped': 'statusUnmapped',
  'duplicate-pair': 'duplicatePair',
}

function reasonNameOf(reason: JiraUnresolvedReason): ReasonName {
  if (reason.code === 'issue-malformed') {
    return reason.detail === 'no-key' ? 'issueNoKey' : 'issueNoFields'
  }
  return CODE_NAME[reason.code]
}

/**
 * What the breakdown can be narrowed to: the issues that landed, or one reason.
 *
 * `'matched'` and not `'resolved'` because that is the value the sheet's one
 * colour rule keys off (`.jir-reason[data-reason='matched']`) — the single green
 * count on a screen whose other rows must stay neutral, or a normal result looks
 * like fourteen problems.
 */
type ReadingFilter = 'matched' | ReasonName

/** The three states a use case can be in here, and what to call each. */
const STATUS_KEY: Readonly<Record<UseCaseStatus, string>> = {
  planned: 'jira.statusPlanned',
  testing: 'jira.statusTesting',
  live: 'jira.statusLive',
}

const STATUS_VALUES: readonly UseCaseStatus[] = ['planned', 'testing', 'live']

/**
 * What a sync WOULD do with a resolved reading, in words. NOTHING DOES IT.
 *
 * `held` is the `overrides` contract rendered as a sentence: this cell was
 * edited in this app, so a sync would leave it alone even though Jira now
 * disagrees. It is deliberately not folded into `unchanged` — "nothing differs"
 * and "you already own this field" are different reasons for the same absence of
 * a write, and the second is the one that explains a number that will not move.
 */
const EFFECT_KEY = {
  create: 'jira.effectCreate',
  update: 'jira.effectUpdate',
  unchanged: 'jira.effectUnchanged',
  held: 'jira.effectHeld',
} as const

type EffectKind = keyof typeof EFFECT_KEY

/**
 * The same four, as a LABEL for the counted list rather than a sentence about
 * one row.
 *
 * Two records and not one with an empty `{from}`: "would change from ⁨⁩" is what
 * that shortcut renders, and a sentence with a hole in it on a screen whose
 * whole job is to be believed is worse than the extra four keys.
 */
const EFFECT_LABEL: Readonly<Record<EffectKind, string>> = {
  create: 'jira.effectsCreate',
  update: 'jira.effectsUpdate',
  unchanged: 'jira.effectsUnchanged',
  held: 'jira.effectsHeld',
}

const EFFECT_KINDS = Object.keys(EFFECT_KEY) as EffectKind[]

/**
 * The fields every search asks for on top of the mapped three.
 *
 * `summary` only: an issue key alone is not enough for a person to recognise the
 * row they are looking at. The other three come from `jiraSearchFields(mapping)`
 * so that the field the mapper READS is the field the search ASKED for — the
 * new endpoint returns ids and nothing else when `fields` is omitted, and a
 * mapping naming a custom field that the request forgot renders a perfect table
 * of "absent" that reads exactly like a Jira with no data in it.
 */
const ALWAYS_FIELDS = ['summary']

/** The status field a fresh screen assumes, and the only field id it guesses. */
const DEFAULT_STATUS_FIELD = 'status'

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

  /* ---- the mapping itself — edited here, saved to 0028's row -------------- */
  const [orgFieldId, setOrgFieldId] = useState('')
  const [useCaseFieldId, setUseCaseFieldId] = useState('')
  const [statusFieldId, setStatusFieldId] = useState(DEFAULT_STATUS_FIELD)
  const [statusMap, setStatusMap] = useState<Record<string, UseCaseStatus>>({})
  const [foldArabic, setFoldArabic] = useState(false)

  /* ---- the saved configuration (0028) ------------------------------------ */
  /**
   * THE OFF-SWITCH, edited here and nowhere else.
   *
   * This screen keeps rendering with `enabled === false` — it is the way in to
   * turning it on. Every OTHER Jira surface in the app asks `useJiraEnabled()`
   * and is absent while this is off.
   */
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /**
   * Saved, and what the save had to leave out.
   *
   * Rendered beside the button at rest rather than as a toast, for the same
   * reason the read-only card is markup: `droppedStatuses` is a sentence he has
   * to act on ("open the reader and pick them again"), and a message that fades
   * is a message he has to remember.
   */
  const [savedCount, setSavedCount] = useState<number | null>(null)
  const saved = useJiraSettings()
  const [hydrated, setHydrated] = useState(false)

  /* ---- this workspace's own side of the comparison ------------------------ */
  const [nodes, setNodes] = useState<MapNode[]>([])
  const [useCases, setUseCases] = useState<UseCase[]>([])
  const [catalogueError, setCatalogueError] = useState<string | null>(null)
  const [catalogueReady, setCatalogueReady] = useState(false)
  const [catalogueTruncated, setCatalogueTruncated] = useState(false)

  /* ---- what this app already records, so `effect` can be true ------------- */
  const [links, setLinks] = useState<JiraExistingLink[]>([])
  const [linksBusy, setLinksBusy] = useState(false)
  const [linksError, setLinksError] = useState<string | null>(null)
  const [linksTruncated, setLinksTruncated] = useState(false)
  /**
   * The organizations whose links have already been read.
   *
   * A REF AND NOT STATE: it is the effect's own bookkeeping, nothing renders it,
   * and putting it in state would re-run the render that re-runs the effect that
   * writes it. Kept across queries deliberately — a node read once does not need
   * reading again just because a second JQL also mentioned it.
   */
  const loadedNodes = useRef(new Set<string>())

  /* ---- the query and its result ------------------------------------------ */
  const [jql, setJql] = useState('')
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  /**
   * The issues themselves, in the order Jira sent them, ACCUMULATED ACROSS PAGES.
   *
   * The raw payload and not the verdicts: every reading on the screen is
   * recomputed from these by `preview` below whenever the mapping moves, which
   * is the whole loop this screen exists for (map, look, map again) and costs no
   * round trip. Input order is load-bearing — the FIRST issue to claim an
   * organization × capability pair keeps it and later claimants are told which
   * key beat them — so pages append and nothing here sorts.
   */
  const [issues, setIssues] = useState<JiraIssue[] | null>(null)
  /** The cursor. Non-null means Jira has more of this query; see `onMore`. */
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  /**
   * The function said it stopped early.
   *
   * KEPT SEPARATE FROM THE CURSOR because they are not the same claim and the
   * screen says different things about them. A cursor in hand means "there is
   * more AND here is how to read it" — a button. `truncated` with no cursor
   * means the function spent its own per-call budget and handed nothing back to
   * continue with: there is more, and the only remedy is a narrower query. The
   * one thing that must never be printed is "everything was read" over either.
   */
  const [truncated, setTruncated] = useState(false)
  /**
   * The query the issues in hand came from.
   *
   * CONTINUATION USES THIS, NEVER THE TEXTAREA. A `nextPageToken` is opaque and
   * belongs to the query and field list that produced it; sending it back beside
   * an edited JQL asks Jira to continue a search nobody ran. Editing the box
   * therefore changes what the Run button will do and nothing about the page
   * already on screen.
   */
  const [ran, setRan] = useState<{ jql: string; fields: string[] } | null>(null)
  const [only, setOnly] = useState<ReadingFilter | null>(null)

  /**
   * Hydrate the form from the saved row — ONCE, and from the store, so this
   * effect touches no network at all.
   *
   * ⚠ ONCE IS THE WHOLE POINT. `store/config` refetches on window focus, so
   *   re-hydrating on every publish would throw away half-typed JQL each time
   *   the tab regains focus — the user alt-tabs to Jira to copy a field name,
   *   comes back, and his box has reverted. `hydrated` latches on the first
   *   non-null read; a workspace that has never saved (null forever) simply
   *   keeps the empty form, which is the same thing it showed before 0028.
   *
   * `statusField` falls back to `DEFAULT_STATUS_FIELD` because a row saved with
   * an empty status field would otherwise turn the third select to "Not chosen"
   * and report `status-missing` on every issue.
   */
  useEffect(() => {
    if (hydrated || saved === null) return
    setOrgFieldId(saved.organizationField)
    setUseCaseFieldId(saved.useCaseField)
    setStatusFieldId(saved.statusField || DEFAULT_STATUS_FIELD)
    setStatusMap(saved.statusMap)
    setFoldArabic(saved.foldArabic)
    setJql(saved.jql)
    setEnabled(saved.enabled)
    setHydrated(true)
  }, [saved, hydrated])

  /**
   * The organizations and capabilities this app already has.
   *
   * Read through api/map.ts rather than store/config, for the reason
   * StructureAdmin gives about the same two tables: the store drops archived
   * nodes and the children of archived parents, and an issue about an archived
   * organization must be reported as landing on it — marked — rather than as
   * naming something this workspace has never heard of. Both calls are selects.
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
        // A clipped catalogue would report organizations it simply did not read
        // as unknown, which is the one wrong answer this screen must not give
        // quietly. Said out loud instead.
        setCatalogueTruncated(n.data.truncated || u.data.truncated)
        setCatalogueError(null)
      }
      setCatalogueReady(true)
    })()
    return () => {
      live = false
    }
  }, [])

  /**
   * The mapping, as `lib/jira/map.ts` wants it.
   *
   * `siteBaseUrl` comes from the CONNECTION TEST rather than from a text field:
   * the base URL is the function's secret, this page never holds it, and the one
   * place it legitimately appears in the browser is the reply to `ping`.
   *
   * THE SAVED ROW IS THE FALLBACK, IN THAT ORDER. A fresh ping is newer
   * information than a stored address — if the site moved, the test knows and
   * the row does not — so `ping` wins, and 0028's `site_base_url` is what keeps
   * the issue links alive on a cold load before anybody presses Test. Neither
   * ⇒ null ⇒ `externalUrl` is null on every reading, which is a legal answer
   * and not a broken link. `onSave` stamps the address in the same order, so
   * what is rendered and what is stored cannot disagree.
   */
  const mapping: JiraFieldMapping = useMemo(
    () => ({
      organizationField: orgFieldId,
      useCaseField: useCaseFieldId,
      statusField: statusFieldId,
      statusMap,
      siteBaseUrl: ping?.site.baseUrl ?? saved?.siteBaseUrl ?? null,
      foldArabic,
    }),
    [orgFieldId, useCaseFieldId, statusFieldId, statusMap, ping, saved, foldArabic],
  )

  /**
   * The readings, recomputed whenever the mapping moves.
   *
   * NOT RECOMPUTED BY RE-QUERYING JIRA. Changing which field carries the
   * organization is a question about the issues already in hand, and asking Jira
   * again would spend a round trip to learn nothing — except when the new field
   * was never fetched, which is why the Run button is the only thing that decides
   * which fields are on the wire. A field picked after a run reads `absent` until
   * the query is run again; that is honest, and the alternative is a screen that
   * silently re-queries live data every time a select changes.
   *
   * `organizations` is EVERY node, not the organization-kind ones. Kinds are
   * per-workspace rows an admin can rename or retire, so narrowing here would
   * mean a uuid literal in a screen; the cost is that a phase and an organization
   * sharing one name resolve as `organization-ambiguous`, which is stated rather
   * than guessed.
   */
  const preview: JiraPreview = useMemo(
    () =>
      mapJiraIssues(issues ?? [], {
        organizations: nodes,
        useCases,
        mapping,
        existing: links,
      }),
    [issues, nodes, useCases, mapping, links],
  )

  /**
   * The organizations the readings actually landed on, sorted for a stable key.
   *
   * This is the input to the one read that makes `effect` true rather than
   * decorative: without the rows this workspace already has, every resolved
   * reading says `create`, and `held` — the whole reason this mapper survived —
   * is zero forever.
   */
  const resolvedNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const reading of preview.readings) {
      if (reading.outcome === 'resolved') ids.add(reading.organization.id)
    }
    return [...ids].sort()
  }, [preview])

  /**
   * Read the existing links for exactly those organizations.
   *
   * TERMINATES, and the argument is worth writing down because the shape looks
   * circular: this effect writes `links`, `links` feeds `preview`, `preview`
   * feeds `resolvedNodeIds`, and `resolvedNodeIds` is this effect's dependency.
   * The loop closes because the second pass asks for the ids it has not already
   * read — an empty list — and returns before touching state. A newly-resolved
   * organization (he maps another status, three more issues resolve) is a new id
   * and is read once, which is the behaviour that would otherwise need a second
   * button.
   *
   * `listNodeUseCasesFor` is a select, chunked and paged by api/map.ts.
   */
  useEffect(() => {
    const wanted = resolvedNodeIds.filter((id) => !loadedNodes.current.has(id))
    if (wanted.length === 0) return
    let live = true
    setLinksBusy(true)
    void (async () => {
      const result = await listNodeUseCasesFor(wanted)
      if (!live) return
      if (result.ok) {
        for (const id of wanted) loadedNodes.current.add(id)
        setLinks((prev) => [...prev, ...result.data.rows])
        setLinksTruncated((prev) => prev || result.data.truncated)
        setLinksError(null)
      } else {
        setLinksError(result.error)
      }
      setLinksBusy(false)
    })()
    return () => {
      live = false
    }
  }, [resolvedNodeIds])

  /**
   * The statuses to map, taken from the ISSUES rather than from the site.
   *
   * There is no `statuses` operation on the function, and the screen is better
   * for it: a site's full workflow list is dozens of statuses across every
   * project on it, and mapping statuses no issue in the query carries is work
   * that answers nothing. These are the handful his own results stand in, read
   * through the SAME field id and the SAME normaliser the mapper judges by.
   */
  const seenStatuses = useMemo(
    () => distinctStatusValues(issues ?? [], mapping),
    [issues, mapping],
  )

  /**
   * Two of his status words that mean the same thing to us and disagree about
   * what it is. Empty for every well-formed mapping, so this says nothing in the
   * ordinary case — and says it loudly in the case where a coin toss would
   * otherwise decide whether a hospital reads `testing` or `live`.
   */
  const conflicts = useMemo(() => statusMapConflicts(mapping), [mapping])

  /** How many readings each row of the breakdown stands for. */
  const counts = useMemo(() => {
    const out = new Map<ReadingFilter, number>()
    out.set('matched', preview.resolved)
    for (const reading of preview.readings) {
      if (reading.outcome !== 'unresolved') continue
      // Every reason on the issue, not the first: an issue with three problems
      // is counted in three rows on purpose, and the breakdown therefore does
      // not sum to the number of issues. `summaryUnmatched` is the count that
      // does, and it is the one in the sentence above it.
      for (const reason of reading.reasons) {
        const name = reasonNameOf(reason)
        out.set(name, (out.get(name) ?? 0) + 1)
      }
    }
    return out
  }, [preview])

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

  /**
   * Save the configuration — the ONE write this screen makes, and it writes the
   * configuration and nothing else.
   *
   * Not a Jira write and not a map write: 0028's `jira_settings` is a single
   * row of THIS SCREEN'S OWN SETTINGS. Every promise on the read-only card
   * stays true — nothing goes to Jira, and no organization, capability or item
   * is created here.
   *
   * ⚠ `siteBaseUrl` IS THE ONE RECONCILIATION BETWEEN THE TWO HALVES OF THIS
   *   WAVE. `mapping.siteBaseUrl` comes from the CONNECTION TEST, because this
   *   page never holds the secret and `ping` is the one place the address
   *   legitimately reaches the browser. The column has to persist it, or "view
   *   in Jira" is dead on every load until somebody presses Test again. So a
   *   tested connection stamps the address and otherwise the saved one is kept.
   *   Never `?? ''`: a blank goes in as NULL, and `useJiraEnabled()` reads a
   *   missing address as "on, but no site address" — which the Settings card
   *   names rather than showing as connected.
   */
  const onSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    setSavedCount(null)
    const result = await saveJiraConfig({
      organizationField: orgFieldId,
      useCaseField: useCaseFieldId,
      statusField: statusFieldId,
      statusMap,
      foldArabic,
      jql,
      enabled,
      siteBaseUrl: ping?.site.baseUrl ?? saved?.siteBaseUrl ?? null,
    })
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    setSavedCount(result.data.droppedStatuses)
  }, [
    orgFieldId,
    useCaseFieldId,
    statusFieldId,
    statusMap,
    foldArabic,
    jql,
    enabled,
    ping,
    saved,
  ])

  const onRun = useCallback(async () => {
    setSearching(true)
    setSearchError(null)
    setOnly(null)
    const wanted = [...ALWAYS_FIELDS, ...jiraSearchFields(mapping)]
    const trimmed = jql.trim()
    const result = await jiraSearch({ jql: trimmed, fields: wanted, maxResults: MAX_PAGE_SIZE })
    if (result.ok) {
      setIssues(result.data.issues)
      setNextPageToken(result.data.nextPageToken)
      setTruncated(result.data.truncated)
      setRan({ jql: trimmed, fields: wanted })
    } else {
      setIssues(null)
      setNextPageToken(null)
      setTruncated(false)
      setRan(null)
      setSearchError(result.error)
    }
    setSearching(false)
  }, [jql, mapping])

  /**
   * The next page of the SAME query, appended.
   *
   * The cursor the endpoint hands back was the one thing this screen never sent
   * anywhere: it reported "there is more" and offered nothing to do about it.
   * The query and the field list come from `ran` rather than from the current
   * state, so a token is only ever continued against the search that produced it.
   */
  const onMore = useCallback(async () => {
    if (ran === null || nextPageToken === null) return
    setLoadingMore(true)
    setSearchError(null)
    const result = await jiraSearch({
      jql: ran.jql,
      fields: ran.fields,
      maxResults: MAX_PAGE_SIZE,
      nextPageToken,
    })
    if (result.ok) {
      // APPENDED, never replaced: the duplicate-pair rule is "the first issue in
      // the input keeps the pair", and a page that overwrote its predecessors
      // would move that verdict from one issue to another between two clicks.
      setIssues((prev) => [...(prev ?? []), ...result.data.issues])
      setNextPageToken(result.data.nextPageToken)
      setTruncated(result.data.truncated)
    } else {
      setSearchError(result.error)
    }
    setLoadingMore(false)
  }, [ran, nextPageToken])

  if (!canEdit) return <Navigate to="/settings" replace />

  const mappingIncomplete = orgFieldId === '' || useCaseFieldId === ''

  /**
   * The rows, paired with the issue they were read from.
   *
   * BY INDEX, and that is a documented property rather than a hope:
   * `mapJiraIssues` returns exactly one reading per issue, in input order, and
   * `map.test.ts` pins `readings.length === issues.length` over a payload where
   * almost everything is wrong. The issue is still needed because the link back
   * to Jira is the function's own `url`, which is not part of a reading.
   */
  const rows = preview.readings
    .map((reading, index) => ({ reading, index, issue: (issues ?? [])[index] }))
    .filter(({ reading }) => {
      if (only === null) return true
      if (reading.outcome === 'resolved') return only === 'matched'
      return reading.reasons.some((reason) => reasonNameOf(reason) === only)
    })

  /* ---- one reason, with the detail that makes it actionable --------------- */

  const renderReason = (reason: JiraUnresolvedReason, index: number): ReactElement => {
    const name = reasonNameOf(reason)
    // The duplicate is the one reason that is about a CONFLICT rather than about
    // a value, and the only one where two records in Jira disagree about which
    // one owns a cell in this app. Drawn as the warning it is.
    const className = name === 'duplicatePair' ? 'jir-verdict-no field-error' : 'jir-verdict-no'
    return (
      <span key={`${name}-${index}`} className={className}>
        {t(REASON_KEY[name])}
        {reason.code !== 'issue-malformed' && reason.code !== 'duplicate-pair' ? (
          <span className="jir-muted">{detailOf(reason)}</span>
        ) : null}
        {reason.code === 'duplicate-pair' ? (
          <span className="jir-muted">{t('jira.duplicateClaimedBy', { key: reason.claimedBy })}</span>
        ) : null}
      </span>
    )
  }

  /**
   * The clause under a reason: WHICH value, or which flavour of empty.
   *
   * The `absent` / `blank` split is the product. A field that is not in the
   * payload at all means the field id is wrong or the API token cannot see it —
   * one person fixes that, in Jira's own configuration. A field that is there and
   * empty means nobody has filled it in — a different person, doing fieldwork.
   * The two look identical in a table of blanks and are named apart here.
   */
  function detailOf(reason: JiraUnresolvedReason): string {
    switch (reason.code) {
      case 'organization-missing':
      case 'use-case-missing':
      case 'status-missing':
        return reason.presence === 'absent'
          ? t('jira.presenceAbsent', { value: reason.field })
          : t('jira.presenceBlank', { value: reason.field })
      case 'organization-multivalued':
      case 'use-case-multivalued':
      case 'status-multivalued':
        return t('jira.valuesWere', { values: reason.values.join(' · ') })
      case 'organization-unknown':
      case 'use-case-unknown':
      case 'status-unmapped':
        return t('jira.valueWas', { value: reason.value })
      case 'organization-ambiguous':
      case 'use-case-ambiguous':
        return t('jira.candidates', {
          value: reason.value,
          names: reason.matches.map((match) => match.name).join(' · '),
        })
      default:
        return ''
    }
  }

  /* ---- one issue row ------------------------------------------------------ */

  const renderRow = ({
    reading,
    index,
    issue,
  }: {
    reading: JiraReading
    index: number
    issue: JiraIssue | undefined
  }): ReactElement => {
    const key = reading.issueKey ?? ''
    const first = reading.outcome === 'unresolved' ? reading.reasons[0] : undefined
    // Three sources, most authoritative first: the link the function built from
    // the base URL it authenticated against; the link the mapper would store in
    // `external_url`; and, failing both, one rebuilt from the connection test.
    // All three are http(s)-validated — the same rule 0023 puts on the column
    // this value would eventually live in.
    const href =
      issue?.url ??
      (reading.outcome === 'resolved' ? reading.externalUrl : null) ??
      (ping ? issueHref(ping.site.baseUrl, key) : null)
    const summary = textOf(issue, 'summary')
    // Keyed by POSITION and not by the issue key: a keyless payload has no key
    // to be identified by, and two of them in one page would collide.
    return (
      <tr
        key={`r${String(index)}`}
        className="jir-row"
        data-reason={first === undefined ? 'matched' : reasonNameOf(first)}
      >
        <td className="jir-cell jir-cell-issue">
          {key === '' ? (
            <span className="jir-issue-key">
              <em className="jir-muted">{t('jira.noKey')}</em>
            </span>
          ) : href ? (
            <a
              className="jir-issue-link"
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t('jira.openIssue', { key })}
            >
              {key}
            </a>
          ) : (
            <span className="jir-issue-key">
              {key}
              <span className="jir-muted"> {t('jira.noLink')}</span>
            </span>
          )}
          {summary ? <span className="jir-issue-summary">{summary}</span> : null}
        </td>
        <td className="jir-cell">
          {textOf(issue, orgFieldId) || <em className="jir-muted">{t('jira.blank')}</em>}
        </td>
        <td className="jir-cell">
          {textOf(issue, useCaseFieldId) || <em className="jir-muted">{t('jira.blank')}</em>}
        </td>
        <td className="jir-cell">
          {textOf(issue, statusFieldId) || <em className="jir-muted">{t('jira.blank')}</em>}
        </td>
        <td className="jir-cell jir-cell-verdict">
          {reading.outcome === 'resolved' ? (
            <>
              <span className="jir-verdict-pair">
                {t('jira.verdictPair', {
                  node: label(reading.organization),
                  useCase: label(reading.useCase),
                })}
              </span>
              <span className="jir-muted">
                {t('jira.verdictStatus', { status: t(STATUS_KEY[reading.status]) })}
              </span>
              {/* MARKED, NEVER DROPPED. An archived organization is still the
                  organization the issue is about, and a retired capability is
                  still recorded against; reporting either as unknown would send
                  a reader hunting for a typo that does not exist. */}
              {reading.organizationArchived ? (
                <span className="jir-muted">{t('jira.orgArchived')}</span>
              ) : null}
              {reading.useCaseHidden ? (
                <span className="jir-muted">{t('jira.useCaseRetired')}</span>
              ) : null}
              {reading.organizationMatchedOn === 'name_ar' ||
              reading.useCaseMatchedOn === 'name_ar' ? (
                <span className="jir-muted">{t('jira.matchedOnArabic')}</span>
              ) : null}
              <span className="jir-muted">
                {t(EFFECT_KEY[reading.effect.kind], {
                  from:
                    reading.effect.kind === 'update' || reading.effect.kind === 'held'
                      ? t(STATUS_KEY[reading.effect.from])
                      : '',
                })}
              </span>
            </>
          ) : (
            reading.reasons.map(renderReason)
          )}
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
        {/* Was `jira.notSaved` ("none of this is saved anywhere"), which stopped
            being true the moment 0028's row landed. The replacement says the
            same useful thing — where his twenty minutes of picking goes — from
            the other side, and repeats that saving is not connecting. */}
        <p className="jir-note">{t('jiraconfig.savedHere')}</p>
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
          {/* A switch over global.css's `.switch` primitive: jira.css owns the
              `.jir-` prefix and may not restyle another sheet's control, and the
              button itself is the announced element — the span is a styling hook
              and is hidden from the accessibility tree. */}
          <button
            type="button"
            className="btn btn-ghost"
            role="switch"
            aria-checked={foldArabic}
            onClick={() => setFoldArabic((prev) => !prev)}
          >
            {t('jira.foldArabic')}
            <span className="switch" aria-hidden="true" aria-checked={foldArabic} />
          </button>
        </div>
        <p className="jir-note">{t('jira.foldArabicBody')}</p>
        {configError ? (
          <p className="field-error" role="alert">
            {t(configError)}
          </p>
        ) : null}
        {fields === null || fields.length === 0 ? (
          <p className="jir-muted">{t('jira.fieldsEmpty')}</p>
        ) : (
          <div className="jir-fields">
            {/* Three selects over the SAME list: a site where one field carries
                two axes is a site this screen has to be able to describe, so no
                select excludes another's choice. */}
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
            <label className="field">
              <span className="field-label">{t('jira.statusField')}</span>
              <select
                className="select"
                value={statusFieldId}
                onChange={(e) => setStatusFieldId(e.target.value)}
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
        {mappingIncomplete ? <p className="jir-note">{t('jira.mapIncomplete')}</p> : null}

        {/* THE OFF-SWITCH AND THE SAVE, at the foot of the card that holds
            everything they save. Both reuse controls this card already paints —
            global.css's `.switch` behind a `role="switch"` button, and `.btn` —
            so nothing new is asked of jira.css, which is another unit's file.

            The switch's own sentence sits under it rather than in a tooltip:
            "turning it on makes the links appear; it starts nothing and writes
            nothing" is the thing a person hesitating over this control wants,
            and it is the answer to the only question the control raises. */}
        <div className="jir-actions">
          <button
            type="button"
            className="btn btn-ghost"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((prev) => !prev)}
          >
            {t('jiraconfig.enableLabel')}
            <span className="switch" aria-hidden="true" aria-checked={enabled} />
          </button>
          <button type="button" className="btn" disabled={saving} onClick={() => void onSave()}>
            {saving ? t('jiraconfig.saving') : t('jiraconfig.save')}
          </button>
        </div>
        <p className="jir-note">{t('jiraconfig.enableHint')}</p>
        {saveError ? (
          <p className="field-error" role="alert">
            {t(saveError)}
          </p>
        ) : null}
        {savedCount === null ? null : (
          <>
            <p className="jir-ok" role="status">
              {t('jiraconfig.saved')}
            </p>
            {/* Never folded into the confirmation: a save that quietly dropped
                four of his status words while saying "saved" is the shape of
                lie this screen exists to not tell. */}
            {savedCount > 0 ? (
              <p className="jir-note" role="status">
                {t('jiraconfig.droppedStatuses', { count: savedCount })}
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card title={t('jira.statusTitle')}>
        <p className="jir-note">{t('jira.statusBody')}</p>
        <>
          {conflicts.map((conflict) => (
            <p key={conflict.key} className="field-error" role="alert">
              {t('jira.statusConflict', { value: conflict.key })}
            </p>
          ))}
        </>
        {seenStatuses.length === 0 ? (
          <p className="jir-muted">{t('jira.statusesEmpty')}</p>
        ) : (
          <ul className="jir-statuses">
            {seenStatuses.map((name) => (
              <li key={name} className="jir-status">
                <span className="jir-status-name">{name}</span>
                <label className="field jir-status-pick">
                  <span className="sr-only">{t('jira.statusFor', { status: name })}</span>
                  <select
                    className="select"
                    // KEYED BY HIS OWN SPELLING, not by a normalised form: the
                    // mapper normalises both sides of every comparison itself,
                    // so what this map has to carry is the word as he will read
                    // it back — and `statusMapConflicts` is what reports two
                    // spellings that fold together and disagree.
                    value={statusMap[name] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setStatusMap((prev) => {
                        const next = { ...prev }
                        if (value === '') delete next[name]
                        else next[name] = value as UseCaseStatus
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
            ))}
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
            disabled={searching || loadingMore || jql.trim() === ''}
            onClick={() => void onRun()}
          >
            {searching ? t('jira.jqlRunning') : t('jira.jqlRun')}
          </button>
        </div>
        {/* The refusal where a person would look for the thing refused. */}
        <p className="jir-note">{t('jira.noSchedule')}</p>
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
        {catalogueTruncated ? <p className="jir-note">{t('jira.catalogueTruncated')}</p> : null}
        {!catalogueReady ? <Skeleton height={44} /> : null}
        {searching ? <Skeleton height={120} /> : null}
        {!searching && issues === null ? (
          <p className="jir-muted">{t('jira.resultsUntried')}</p>
        ) : null}
        {!searching && issues !== null && issues.length === 0 ? (
          <p className="jir-muted">{t('jira.resultsEmpty')}</p>
        ) : null}

        {!searching && issues !== null && issues.length > 0 && (
          <>
            {/* THE ANSWER. One paragraph, three counted clauses, each its own
                plural node so the noun agrees with the number in both languages
                — a single string with three {tokens} could only inflect for one
                of them. */}
            <p className="jir-summary" role="status">
              <span className="tabular">
                {t('jira.summaryFetched', { count: preview.readings.length })}
              </span>{' '}
              <span className="tabular">
                {t('jira.summaryMatched', { count: preview.resolved })}
              </span>{' '}
              <span className="tabular">
                {t('jira.summaryUnmatched', { count: preview.unresolved })}
              </span>
            </p>

            {/* THE CURSOR, FINALLY SENT BACK. The endpoint reports no total, so
                the honest statement about size is "there is more of this query
                than has been read" — and the honest control beside it is one
                that reads the next page and re-judges everything in hand. */}
            {nextPageToken !== null ? (
              <>
                <p className="jir-note">{t('jira.morePages')}</p>
                <div className="jir-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={loadingMore || searching}
                    onClick={() => void onMore()}
                  >
                    {loadingMore ? t('jira.loadingMore') : t('jira.loadMore')}
                  </button>
                </div>
              </>
            ) : truncated ? (
              // No cursor and yet more to come: the function stopped on its own
              // budget. There is nothing to continue with, so the sentence
              // stands alone and the remedy is a narrower query.
              <p className="jir-note">{t('jira.morePages')}</p>
            ) : (
              <p className="jir-note">{t('jira.allRead')}</p>
            )}

            <h3 className="jir-sub">{t('jira.breakdownTitle')}</h3>
            <ul className="jir-breakdown">
              {(['matched', ...REASON_NAMES] as ReadingFilter[])
                .filter((name) => (counts.get(name) ?? 0) > 0)
                .map((name) => (
                  <li key={name} className="jir-reason" data-reason={name}>
                    <span className="jir-reason-label">
                      {name === 'matched' ? t('jira.reasonMatched') : t(REASON_KEY[name])}
                    </span>
                    <span className="jir-reason-count tabular">
                      {t('jira.issueCount', { count: counts.get(name) ?? 0 })}
                    </span>
                    {/* REACHABLE, not just counted: the ones that did not resolve
                        are the reason he ran this, and a number he cannot open is
                        a number he has to take on trust. */}
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      aria-pressed={only === name}
                      onClick={() => setOnly(only === name ? null : name)}
                    >
                      {only === name ? t('jira.showAll') : t('jira.showOnly')}
                    </button>
                  </li>
                ))}
            </ul>
            {only !== null ? (
              <p className="jir-note" role="status">
                {t('jira.filtered', {
                  reason: only === 'matched' ? t('jira.reasonMatched') : t(REASON_KEY[only]),
                })}
              </p>
            ) : null}

            {/* WHAT A SYNC WOULD DO, AND THE FACT THAT NOTHING DOES IT. */}
            <h3 className="jir-sub">{t('jira.effectsTitle')}</h3>
            {linksError ? (
              <p className="field-error" role="alert">
                {t('jira.linksFailed')}
              </p>
            ) : linksBusy ? (
              <p className="jir-muted">{t('jira.linksLoading')}</p>
            ) : preview.resolved === 0 ? (
              // Nothing resolved, so a sync would do nothing — said in words
              // rather than as an empty list, which reads as a component that
              // failed to render.
              <p className="jir-muted">{t('jira.effectsNone')}</p>
            ) : (
              <ul className="jir-breakdown">
                {EFFECT_KINDS.filter((kind) => preview.effects[kind] > 0).map((kind) => (
                  <li key={kind} className="jir-reason">
                    <span className="jir-reason-label">{t(EFFECT_LABEL[kind])}</span>
                    <span className="jir-reason-count tabular">
                      {t('jira.issueCount', { count: preview.effects[kind] })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {linksTruncated ? <p className="jir-note">{t('jira.linksTruncated')}</p> : null}
            <p className="jir-note">{t('jira.noApply')}</p>
            <p className="jir-note">{t('jira.noEntries')}</p>
            <p className="jir-note">{t('jira.noNodes')}</p>

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

/**
 * What one field said on one issue, as one string for the table.
 *
 * `textValuesOf`'s list joined for display ONLY. The mapper reads the same field
 * through `readFieldText` and treats two values as a refusal rather than as a
 * name — this is the cell that lets a reader see WHY, so it shows both values
 * rather than the first.
 */
function textOf(issue: JiraIssue | undefined, field: string): string {
  if (issue === undefined || field === '') return ''
  return readFieldText(issue, field).values.join(' · ')
}
