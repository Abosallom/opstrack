// The arithmetic of the import: a page of Jira issues becomes a list of
// readings, where a reading is EITHER a resolved `{ organization, useCase,
// status }` or a stated reason it could not be resolved.
//
// PURE, the same contract as `lib/mapNodes.ts` and `lib/mindtree/model.ts`: no
// network, no store, no clock, no `t()`, no React, no randomness. Everything
// arrives as an argument. That is what lets Aziz read the preview and believe it
// without a browser, and it is the only reason this unit has real test coverage
// at all — nobody on this fleet can reach a live Jira site, so a mapper that
// needed one would ship unproven.
//
// NOTHING HERE WRITES. Not to Jira — no POST, no PUT, no transition, no comment
// — and not to us: no `map_nodes`, no `map_node_use_cases`, no `entries`. The
// `effect` on a resolved reading is a SENTENCE ABOUT A WRITE THAT DOES NOT
// HAPPEN. Aziz: "make just read from JIRA without changing anything… to test the
// inputs from JIRA", and: "i can not connect the app to jira until we verify the
// tracker very well." The eventual design is a two-way sync; this is the half he
// gated the other half on.
//
//
// ═══ THE UNRESOLVED CASES ARE THE PRODUCT. THE RESOLVED ONES ARE THE EASY PART ═══
//
// "To test the inputs from JIRA" does not mean "show me 40 issues". The answer
// he needs is "31 matched, 9 did not, and here is precisely why each one did
// not" — because every one of those 9 is a piece of configuration, a typo, or a
// missing organization that he can go and fix, and a harness that hides them
// tells him the integration is ready when it is not.
//
// So a failure is a FIRST-CLASS VALUE with a discriminated `code`, never a
// filtered-out row and never a `null` that a `.filter(Boolean)` swallows two
// call sites later. There is no code path in this file that drops an issue.
// `mapJiraIssues` returns exactly one reading per issue handed to it, and
// `readings.length === issues.length` is asserted in the tests for that reason.
//
// AND ALL THE REASONS, NOT THE FIRST ONE. An issue with no Organization value
// AND an unmapped status has two problems; reporting one, waiting for a fix and
// then reporting the other is two round trips to Aziz for one issue. The three
// fields are read independently and every complaint goes in `reasons`.
//
//
// ═══ MATCHING IS BY NAME, WHICH MEANS IT IS FUZZY, WHICH MEANS IT SAYS SO ═══
//
// Nothing in Jira holds our uuids. `external_ref` is what will hold the issue
// key once a sync exists (0023/0024 provisioned the column for it) and it is
// empty on every row today, so there is no identity to join on and v1 matches on
// the NAME. Four consequences, each of which is a decision below rather than an
// accident:
//
//   · Comparison is through `normalizeName` on BOTH sides — trim, collapse
//     whitespace, strip invisible bidi marks, NFKC, lowercase. See its comment
//     for what it deliberately does NOT fold.
//   · ARABIC IS EXPLICIT. `map_nodes.name_ar` and `use_cases.name_ar` are
//     `not null default ''`, and all ten seeded capabilities carry `''`. An
//     empty Arabic name means "no translation yet", NOT "matches the empty
//     string" — so a blank `name_ar` is never entered in the index, and a Jira
//     field that is empty is a `missing` reason rather than a match against ten
//     untranslated rows at once.
//   · A node reachable under both its English and its Arabic name is ONE
//     candidate, not two. Deduped by id, or a node whose `name` and `name_ar`
//     are the same string would report itself as ambiguous with itself.
//   · TWO NODES ON ONE STRING IS `ambiguous`, NEVER FIRST-WINS. Two
//     organizations called "Riyadh" is not a hypothetical in a workspace that
//     will hold dozens, and quietly picking the one that sorted first would file
//     a hospital's integration status against a different hospital — the exact
//     failure nobody would catch by looking at the screen, because the screen
//     would look fine.
//
//
// ═══ WHAT THE CALLER MUST FILTER, BECAUSE THIS FILE CANNOT ═══
//
// `organizations` is the CANDIDATE SET, and the caller narrows it — normally to
// the nodes whose `kind_id` is the Organization kind. This module does not know
// kinds and must not learn them: kind ids are per-workspace rows an admin can
// rename or retire (`map_node_kinds`, `on delete set null`), so a purity-breaking
// lookup here would be a literal with a uuid in it.
//
// Archived nodes and hidden capabilities are matched and MARKED, not excluded.
// Excluding them would report a name that is visibly in the workspace as
// `unknown`, which sends the reader looking for a typo that does not exist;
// `organizationArchived` / `useCaseHidden` let the screen draw the row struck
// through and say the true thing.

import type { MapNode, UseCase, UseCaseStatus } from '../../types'
import type { JiraFieldMapping, JiraIssue, NameFolding } from './types'
import { browseUrlFor, issueKeyOf, normalizeName, readFieldText } from './types'

/* ──────────────────────────── inputs ──────────────────────────── */

/**
 * A `map_node_use_cases` row as this module needs to see it.
 *
 * Declared structurally rather than imported so that `MapNodeUseCase` (which
 * carries only the three columns `api/map.ts` selects) is assignable to it while
 * a caller that also read `overrides` can pass that too. `lib/mindtree/model.ts`
 * declares its three input shapes the same way and for the same reason.
 */
export interface JiraExistingLink {
  node_id: string
  use_case_id: string
  status: UseCaseStatus
  /**
   * `map_node_use_cases.overrides` — `text[] not null default '{}'`, so `[]`
   * and never null on a row that was actually read. Optional HERE only because a
   * caller holding a plain `MapNodeUseCase` does not have the column.
   *
   * THE PER-FIELD EDITING CONTRACT, decided up front by 0023/0024: a column
   * named in this list was edited in this app and a sync must not overwrite it.
   * Honoured by `effect` below — this is the one place in the whole harness
   * where that contract is visible before the sync that will enforce it exists.
   */
  overrides?: readonly string[]
}

/** Everything the mapper needs that is not the issues themselves. */
export interface JiraMapContext {
  /**
   * The nodes an issue's Organization value may match. Narrowed by the caller;
   * see the header. Order is preserved into `matches` on an ambiguity, so the
   * screen lists candidates in workspace order.
   */
  organizations: readonly MapNode[]
  /**
   * The capability catalogue, INCLUDING hidden rows — `useAllUseCases()`, not
   * the visible list. A hidden capability an issue names still resolves, marked;
   * passing only the visible list turns those into `use-case-unknown`, which is
   * a different and untrue sentence.
   */
  useCases: readonly UseCase[]
  mapping: JiraFieldMapping
  /**
   * What this app already records, so the preview can say `create` / `update` /
   * `unchanged` / `held` instead of just `31 matched`. Omit it and every
   * resolved reading reads `create`, which is exactly true of a workspace with
   * nothing recorded and is not a guess.
   */
  existing?: readonly JiraExistingLink[]
}

/* ─────────────────────────── outputs ─────────────────────────── */

/** One candidate in an ambiguity, identified and named for the screen to render. */
export interface JiraNameMatch {
  id: string
  /** The English name. The reader resolves the locale; this module has no `t()`. */
  name: string
}

/**
 * Why an issue produced no reading.
 *
 * THIRTEEN CODES IN THREE FAMILIES PLUS TWO. The three fields fail the same four
 * ways, and spelling that out beats one `code: 'error'` with a prose `message`:
 * a screen can group by code, a test can assert on it, and a translator can
 * write thirteen sentences once instead of interpolating English from a server.
 *
 * `missing` splits `absent` from `blank`, and the split is the useful part —
 * `absent` on EVERY issue means the field id is wrong or invisible to the API
 * token (configuration), `blank` on SOME issues means people have not filled it
 * in (fieldwork). Same-looking empty panel, two completely different people to
 * go and talk to.
 */
export type JiraUnresolvedReason =
  /** The payload was not an issue: no key to name it by, or no `fields` object. */
  | { code: 'issue-malformed'; detail: 'no-key' | 'no-fields' }
  | { code: 'organization-missing'; field: string; presence: 'absent' | 'blank' }
  | { code: 'organization-multivalued'; field: string; values: string[] }
  | { code: 'organization-unknown'; field: string; value: string }
  | { code: 'organization-ambiguous'; field: string; value: string; matches: JiraNameMatch[] }
  | { code: 'use-case-missing'; field: string; presence: 'absent' | 'blank' }
  | { code: 'use-case-multivalued'; field: string; values: string[] }
  | { code: 'use-case-unknown'; field: string; value: string }
  | { code: 'use-case-ambiguous'; field: string; value: string; matches: JiraNameMatch[] }
  | { code: 'status-missing'; field: string; presence: 'absent' | 'blank' }
  | { code: 'status-multivalued'; field: string; values: string[] }
  | { code: 'status-unmapped'; field: string; value: string }
  /**
   * Two issues resolved to the SAME Organization × capability pair — the shape
   * 0024 says is "exactly this row", so a second claim on it is a fact about his
   * Jira project that the harness exists to surface. The FIRST issue in the
   * input keeps the pair and the later one carries this; `claimedBy` names the
   * winner so the reader can open both and decide, rather than seeing an
   * arbitrary-looking rejection.
   */
  | { code: 'duplicate-pair'; organizationId: string; useCaseId: string; claimedBy: string }

/**
 * What a sync WOULD do with a resolved reading. Nothing does it.
 *
 * `held` is the `overrides` contract from 0023/0024 rendered as a value: the
 * status of this row was edited in this app, so a sync must leave it alone even
 * though Jira now disagrees. It is deliberately not folded into `unchanged` —
 * "we would change nothing because nothing differs" and "we would change nothing
 * because you already own this field" are different sentences, and the second is
 * the one that explains why the number on the screen does not move.
 */
export type JiraEffect =
  | { kind: 'create' }
  | { kind: 'update'; from: UseCaseStatus }
  | { kind: 'unchanged' }
  | { kind: 'held'; field: 'status'; from: UseCaseStatus }

/** An issue this app could place: one Organization × capability reading. */
export interface JiraResolvedReading {
  outcome: 'resolved'
  issueKey: string
  organization: MapNode
  /** Which column the name matched on, so the screen can show the fuzziness. */
  organizationMatchedOn: 'name' | 'name_ar'
  /** The node is archived. Drawn marked, never dropped; see the header. */
  organizationArchived: boolean
  useCase: UseCase
  useCaseMatchedOn: 'name' | 'name_ar'
  /** The capability is retired from the pickers but still recorded against. */
  useCaseHidden: boolean
  status: UseCaseStatus
  /** What `external_ref` would hold: the issue key. */
  externalRef: string
  /**
   * What `external_url` would hold, or null when no valid site base was
   * configured. NEVER a non-http(s) string — both tables carry a CHECK against
   * that and it is rendered as an href.
   */
  externalUrl: string | null
  effect: JiraEffect
}

/** An issue this app could not place, and every reason why. */
export interface JiraUnresolvedReading {
  outcome: 'unresolved'
  /** Null only for `issue-malformed` / `no-key`. */
  issueKey: string | null
  /** Never empty. */
  reasons: JiraUnresolvedReason[]
}

export type JiraReading = JiraResolvedReading | JiraUnresolvedReading

/**
 * The whole preview: one reading per issue, plus the counts the screen leads
 * with.
 *
 * The counts are computed here rather than by the screen so that the headline
 * and the list can never disagree — the failure `buildMindtree` calls "labelled
 * 12 while showing 3", which is the single worst thing a summary can do.
 */
export interface JiraPreview {
  readings: JiraReading[]
  resolved: number
  unresolved: number
  /** Resolved readings by what a sync would do. Sums to `resolved`. */
  effects: { create: number; update: number; unchanged: number; held: number }
}

/* ─────────────────────────── the mapper ─────────────────────────── */

/**
 * One reading per issue, in input order.
 *
 * Total: it throws for no input and drops nothing. An empty `issues` yields an
 * empty preview with zero counts, an empty `organizations` yields
 * `organization-unknown` on every issue that named one, and a payload that is
 * not an issue at all yields `issue-malformed`.
 */
export function mapJiraIssues(
  issues: readonly JiraIssue[],
  context: JiraMapContext,
): JiraPreview {
  const { mapping } = context
  // ONE folding, used to build the index AND to look names up in it. Two
  // different normalisations either side of a Map lookup is a matcher that
  // silently matches nothing, and it is the kind of bug that survives review
  // because both halves read correctly on their own.
  const folding: NameFolding = { arabic: mapping.foldArabic === true }
  const orgIndex = buildNameIndex(
    context.organizations,
    (node) => node.id,
    (node) => node.name,
    (node) => node.name_ar,
    folding,
  )
  const useCaseIndex = buildNameIndex(
    context.useCases,
    (row) => row.id,
    (row) => row.name,
    (row) => row.name_ar,
    folding,
  )
  const statuses = buildStatusIndex(mapping.statusMap, folding).index

  const existing = new Map<string, JiraExistingLink>()
  for (const link of context.existing ?? []) {
    const key = pairKey(link.node_id, link.use_case_id)
    if (!existing.has(key)) existing.set(key, link)
  }

  // `claimed` is what makes the collision between two issues decidable at all:
  // each resolved pair is claimed as it is read, so the FIRST issue in the input
  // keeps it and every later claimant is told which key beat it. Input order is
  // therefore load-bearing and stated in the reason, rather than being an
  // accident of a Map iteration nobody can see.
  const claimed = new Map<string, string>()
  const readings: JiraReading[] = []

  for (const issue of issues) {
    const issueKey = issueKeyOf(issue)
    if (issueKey === null) {
      readings.push({
        outcome: 'unresolved',
        issueKey: null,
        reasons: [{ code: 'issue-malformed', detail: 'no-key' }],
      })
      continue
    }
    if (issue.fields === null || issue.fields === undefined) {
      readings.push({
        outcome: 'unresolved',
        issueKey,
        reasons: [{ code: 'issue-malformed', detail: 'no-fields' }],
      })
      continue
    }

    const reasons: JiraUnresolvedReason[] = []

    const org = resolveByName(issue, mapping.organizationField, orgIndex, folding)
    if (org.state !== 'ok') reasons.push(organizationReason(mapping.organizationField, org))

    const useCase = resolveByName(issue, mapping.useCaseField, useCaseIndex, folding)
    if (useCase.state !== 'ok') reasons.push(capabilityReason(mapping.useCaseField, useCase))

    const status = resolveStatus(issue, mapping.statusField, statuses, folding)
    if (status.state !== 'ok') reasons.push(statusReason(mapping.statusField, status))

    if (org.state !== 'ok' || useCase.state !== 'ok' || status.state !== 'ok') {
      readings.push({ outcome: 'unresolved', issueKey, reasons })
      continue
    }

    const pair = pairKey(org.item.id, useCase.item.id)
    const winner = claimed.get(pair)
    if (winner !== undefined) {
      readings.push({
        outcome: 'unresolved',
        issueKey,
        reasons: [
          {
            code: 'duplicate-pair',
            organizationId: org.item.id,
            useCaseId: useCase.item.id,
            claimedBy: winner,
          },
        ],
      })
      continue
    }
    claimed.set(pair, issueKey)

    readings.push({
      outcome: 'resolved',
      issueKey,
      organization: org.item,
      organizationMatchedOn: org.via,
      organizationArchived: org.item.archived,
      useCase: useCase.item,
      useCaseMatchedOn: useCase.via,
      useCaseHidden: useCase.item.hidden,
      status: status.status,
      externalRef: issueKey,
      externalUrl: browseUrlFor(mapping.siteBaseUrl, issueKey),
      effect: effectFor(existing.get(pair), status.status),
    })
  }

  const effects = { create: 0, update: 0, unchanged: 0, held: 0 }
  let resolved = 0
  for (const reading of readings) {
    if (reading.outcome !== 'resolved') continue
    resolved += 1
    effects[reading.effect.kind] += 1
  }

  return { readings, resolved, unresolved: readings.length - resolved, effects }
}

/**
 * Status-map keys that normalise to the same word but disagree about what it
 * means — `{ 'In Progress': 'testing', 'in  progress': 'live' }`.
 *
 * Reported rather than silently resolved. The index keeps the FIRST key, which
 * is a coin toss dressed as a rule, and a coin toss deciding whether a hospital
 * reads `testing` or `live` on a steering deck is not something to leave
 * unsaid. Empty for a well-formed mapping, so the screen shows nothing in the
 * ordinary case.
 */
export function statusMapConflicts(
  mapping: JiraFieldMapping,
): { key: string; statuses: UseCaseStatus[] }[] {
  return buildStatusIndex(mapping.statusMap, { arabic: mapping.foldArabic === true }).conflicts
}

/* ───────────────────────────── internals ───────────────────────────── */

// ` ` cannot occur in a uuid, so the join is unambiguous without escaping.
function pairKey(nodeId: string, useCaseId: string): string {
  return `${nodeId} ${useCaseId}`
}

interface NameCandidate<T> {
  item: T
  via: 'name' | 'name_ar'
}

/**
 * Normalised name → the rows that answer to it.
 *
 * English name first so that a row whose `name` and `name_ar` are identical
 * reports `matchedOn: 'name'` rather than depending on insertion order, and an
 * EMPTY normalised name is never indexed — that is the `name_ar = ''` rule from
 * the header, and it is also what stops a whitespace-only Jira value from
 * matching anything.
 */
function buildNameIndex<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  nameOf: (item: T) => string,
  nameArOf: (item: T) => string,
  folding: NameFolding,
): Map<string, NameCandidate<T>[]> {
  const index = new Map<string, NameCandidate<T>[]>()
  const add = (raw: string, item: T, via: 'name' | 'name_ar'): void => {
    const key = normalizeName(raw, folding)
    if (key.length === 0) return
    const bucket = index.get(key)
    if (bucket === undefined) {
      index.set(key, [{ item, via }])
      return
    }
    // Deduped by id: one row is one candidate however many of its columns spell
    // the same string, or a bilingual row with one name would be ambiguous with
    // itself and never resolve.
    if (bucket.some((entry) => idOf(entry.item) === idOf(item))) return
    bucket.push({ item, via })
  }
  for (const item of items) add(nameOf(item), item, 'name')
  for (const item of items) add(nameArOf(item), item, 'name_ar')
  return index
}

type NameResolution<T> =
  | { state: 'ok'; item: T; via: 'name' | 'name_ar'; value: string }
  | { state: 'missing'; presence: 'absent' | 'blank' }
  | { state: 'multivalued'; values: string[] }
  | { state: 'unknown'; value: string }
  | { state: 'ambiguous'; value: string; matches: NameCandidate<T>[] }

function resolveByName<T>(
  issue: JiraIssue,
  field: string,
  index: Map<string, NameCandidate<T>[]>,
  folding: NameFolding,
): NameResolution<T> {
  const read = readFieldText(issue, field)
  if (read.presence !== 'present') return { state: 'missing', presence: read.presence }
  // A multi-select naming two organizations is not a match this module may pick
  // between: "one issue per Organization × use case" is the recorded shape, and
  // an issue that names two of either is a fact about his project to report.
  if (read.values.length > 1) return { state: 'multivalued', values: read.values }

  const value = read.values[0] ?? ''
  const key = normalizeName(value, folding)
  // A value that is only invisible marks — an RLM pasted alone into a field —
  // is BLANK, not an unknown name. Reporting it as unknown would print a reason
  // whose `value` renders as nothing at all, and send the reader hunting for a
  // typo in a string with no visible characters in it.
  if (key.length === 0) return { state: 'missing', presence: 'blank' }
  const matches = index.get(key)
  if (matches === undefined || matches.length === 0) return { state: 'unknown', value }
  if (matches.length > 1) return { state: 'ambiguous', value, matches }
  const only = matches[0]
  if (only === undefined) return { state: 'unknown', value }
  return { state: 'ok', item: only.item, via: only.via, value }
}

type StatusResolution =
  | { state: 'ok'; status: UseCaseStatus }
  | { state: 'missing'; presence: 'absent' | 'blank' }
  | { state: 'multivalued'; values: string[] }
  | { state: 'unmapped'; value: string }

function resolveStatus(
  issue: JiraIssue,
  field: string,
  statuses: Map<string, UseCaseStatus>,
  folding: NameFolding,
): StatusResolution {
  const read = readFieldText(issue, field)
  if (read.presence !== 'present') return { state: 'missing', presence: read.presence }
  if (read.values.length > 1) return { state: 'multivalued', values: read.values }
  const value = read.values[0] ?? ''
  const key = normalizeName(value, folding)
  if (key.length === 0) return { state: 'missing', presence: 'blank' }
  const mapped = statuses.get(key)
  if (mapped === undefined) return { state: 'unmapped', value }
  return { state: 'ok', status: mapped }
}

function buildStatusIndex(
  raw: Readonly<Record<string, UseCaseStatus>>,
  folding: NameFolding = {},
): {
  index: Map<string, UseCaseStatus>
  conflicts: { key: string; statuses: UseCaseStatus[] }[]
} {
  const index = new Map<string, UseCaseStatus>()
  const seen = new Map<string, UseCaseStatus[]>()
  for (const [word, status] of Object.entries(raw)) {
    const key = normalizeName(word, folding)
    // A blank Jira status word maps nothing: `readFieldText` reports an empty
    // value as `blank` and never looks it up, so an entry keyed on '' could only
    // ever be dead configuration that looks live.
    if (key.length === 0) continue
    const bucket = seen.get(key)
    if (bucket === undefined) {
      seen.set(key, [status])
      index.set(key, status)
      continue
    }
    if (!bucket.includes(status)) bucket.push(status)
  }
  const conflicts: { key: string; statuses: UseCaseStatus[] }[] = []
  for (const [key, values] of seen) {
    if (values.length > 1) conflicts.push({ key, statuses: values })
  }
  return { index, conflicts }
}

function effectFor(link: JiraExistingLink | undefined, incoming: UseCaseStatus): JiraEffect {
  if (link === undefined) return { kind: 'create' }
  if (link.status === incoming) return { kind: 'unchanged' }
  // Compared normalised: `overrides` is written by whoever ships the sync, and a
  // contract that turns on the exact casing of a column name is a contract that
  // fails silently the first time somebody writes 'Status'.
  const held = (link.overrides ?? []).some((column) => column.trim().toLowerCase() === 'status')
  if (held) return { kind: 'held', field: 'status', from: link.status }
  return { kind: 'update', from: link.status }
}

function toMatches<T>(candidates: NameCandidate<T>[], name: (item: T) => JiraNameMatch): JiraNameMatch[] {
  return candidates.map((candidate) => name(candidate.item))
}

function organizationReason(
  field: string,
  resolution: Exclude<NameResolution<MapNode>, { state: 'ok' }>,
): JiraUnresolvedReason {
  switch (resolution.state) {
    case 'missing':
      return { code: 'organization-missing', field, presence: resolution.presence }
    case 'multivalued':
      return { code: 'organization-multivalued', field, values: resolution.values }
    case 'unknown':
      return { code: 'organization-unknown', field, value: resolution.value }
    case 'ambiguous':
      return {
        code: 'organization-ambiguous',
        field,
        value: resolution.value,
        matches: toMatches(resolution.matches, (node) => ({ id: node.id, name: node.name })),
      }
  }
}

// NAMED `capabilityReason` AND NOT `useCaseReason`, which is the name the rest
// of this file's vocabulary wants. `useCase…` + a capital matches oxlint's Hook
// heuristic, so calling it inside `mapJiraIssues` is a `react/rules-of-hooks`
// ERROR — the same fence `mapNodes.test.ts` puts at its own import, solved here
// by a rename rather than a suppression.
function capabilityReason(
  field: string,
  resolution: Exclude<NameResolution<UseCase>, { state: 'ok' }>,
): JiraUnresolvedReason {
  switch (resolution.state) {
    case 'missing':
      return { code: 'use-case-missing', field, presence: resolution.presence }
    case 'multivalued':
      return { code: 'use-case-multivalued', field, values: resolution.values }
    case 'unknown':
      return { code: 'use-case-unknown', field, value: resolution.value }
    case 'ambiguous':
      return {
        code: 'use-case-ambiguous',
        field,
        value: resolution.value,
        matches: toMatches(resolution.matches, (row) => ({ id: row.id, name: row.name })),
      }
  }
}

function statusReason(
  field: string,
  resolution: Exclude<StatusResolution, { state: 'ok' }>,
): JiraUnresolvedReason {
  switch (resolution.state) {
    case 'missing':
      return { code: 'status-missing', field, presence: resolution.presence }
    case 'multivalued':
      return { code: 'status-multivalued', field, values: resolution.values }
    case 'unmapped':
      return { code: 'status-unmapped', field, value: resolution.value }
  }
}
