// What Jira Cloud ACTUALLY sends, and the four small readers that turn it into
// something the rest of the app can hold without a `?.` in every expression.
//
// THE SINGLE DECLARATION OF THESE SHAPES. `JiraIssue`, `JiraSearchPage` and
// `normalizeName` were declared here AND in `src/api/jira.ts` — two spellings of
// one wire contract, drifting apart in the dark. `api/jira.ts` now imports from
// this file (api → lib is the legal direction; lib → api is not), and the one
// field on `JiraIssue` that Jira does not send is documented as such where it is
// declared rather than justifying a second interface.
//
// READ-ONLY BY CONSTRUCTION. Nothing in this directory writes anything, to Jira
// or to us. Aziz: "make just read from JIRA without changing anything… to test
// the inputs from JIRA." Both halves of "without changing anything" hold — no
// POST/PUT/transition/comment to Jira, and no insert/update to `map_nodes`,
// `map_node_use_cases` or `entries` here either. This is a HARNESS: it shows
// what came back and what would be done with it, and stops there.
//
// PURE, on lib/mapNodes.ts' contract: no network, no store, no clock, no `t()`,
// no React. Every input arrives as an argument and the same arguments always
// produce the same answer. That is what lets Aziz trust the preview without a
// browser — and it is the only reason any of this is testable at all, because
// nobody on this fleet can reach a live Jira site.
//
// This file has no npm imports and its one `import type` is erased under
// `verbatimModuleSyntax`, so the Edge Function (Deno) can import it directly
// rather than keeping a hand-drifted copy of the wire shape.
//
//
// ═══ WHY EVERY FIELD BELOW IS OPTIONAL, AND WHY THAT IS NOT LAZINESS ═══
//
// Three independent things make a Jira field simply not be there, and none of
// them is an error the caller can prevent:
//
//   1. An UNSET custom field comes back `null`.
//   2. A field the API token's account cannot SEE is not in the payload at all —
//      no key, no null, nothing. A field-level security scheme or a screen
//      configuration produces this, and it looks identical to a typo in the
//      field id.
//   3. `/rest/api/3/search/jql` returns ONLY the fields you asked for. Its
//      `fields` default is the issue id — not `*navigable`, which is what the
//      removed `/search` endpoint defaulted to. Forget to ask and every issue
//      comes back with an empty `fields` object and the harness reports forty
//      absent fields. `jiraSearchFields()` below exists so that cannot happen.
//
// So the type says `fields?: Record<string, unknown> | null` and the READER —
// `readFieldText` — reports WHICH of "not in the payload" and "in the payload,
// empty" it found. That distinction is worth carrying: `absent` on every issue
// means the field id is wrong or invisible to the token, `blank` on some issues
// means people have not filled it in. One is a configuration bug, the other is
// fieldwork, and a screen that cannot tell them apart sends Aziz to the wrong
// person.
//
//
// ═══ THE ENDPOINT CONTRACT, CHECKED RATHER THAN REMEMBERED ═══
//
// Verified against Atlassian's developer docs and the deprecation notices in
// August 2026, because a plausible-but-stale call here fails only against a real
// site, which is the most expensive place to find it:
//
//   · `GET|POST /rest/api/3/search` is REMOVED. Deprecated 1 May 2025, shut down
//     progressively from 1 Aug 2025, all traffic blocked by end of Oct 2025.
//     `POST /rest/api/{2|3}/search/id` went with it.
//   · The replacement is `GET|POST /rest/api/3/search/jql` — `JIRA_SEARCH_PATH`.
//   · PAGING IS TOKEN-BASED. `startAt` is gone, and so is `total`: there is no
//     count of matching issues in the response any more. You send
//     `nextPageToken` back to get the next page, and you stop when the response
//     does not carry one. `isLast` exists but has a well-documented history of
//     never turning true, so it may be used to stop EARLY and never to keep
//     going — `readSearchPage` reports both and says so again below.
//   · `fields` defaults to the issue id, so it must be sent explicitly.
//
// One thing this fleet could NOT verify without a live site: whether each issue
// in that envelope still carries `key` at the top level when `fields` is
// narrowed. `key` is not something `fields` can request, so if it ever comes
// back absent the answer is not a code change here — `issueKeyOf` returns null,
// the mapper raises `issue-malformed` with `detail: 'no-key'`, and the screen
// says so in a sentence instead of drawing forty blank rows.

import type { UseCaseStatus } from '../../types'

/* ─────────────────────────── the wire shape ─────────────────────────── */

/**
 * A Jira field id: `'summary'`, `'status'`, or `'customfield_10050'`.
 *
 * A bare alias rather than a union, deliberately. Custom field ids are minted
 * per SITE — Aziz's "Organization" field is a number nobody on this fleet has
 * seen and it will differ between his sandbox and his production site. A union
 * here would be a literal that has to be edited to onboard a second site, which
 * is the mistake the status map below is also written to avoid.
 */
export type JiraFieldId = string

/**
 * One issue as `/rest/api/3/search/jql` returns it.
 *
 * `id` and `key` sit OUTSIDE `fields` — `fields.status.name` is nested three
 * deep, `key` is not nested at all — which is why nothing here tries to read
 * everything through one accessor.
 */
export interface JiraIssue {
  id?: string | null
  /** The human key, `NPH-142`. This is what `external_ref` will hold. */
  key?: string | null
  /** The REST self-link. Not the browse URL a person clicks; see `browseUrlFor`. */
  self?: string | null
  /**
   * The browse URL, WHICH JIRA DOES NOT SEND — `jira-read` builds it from the
   * base URL it authenticated against and `src/api/jira.ts`'s `toIssue` puts it
   * through `safeHttpUrl` before it ever reaches here.
   *
   * It is on this interface, rather than on a second one in `api/`, because
   * this file is the SINGLE declaration of the issue shape (a parallel
   * declaration is what §C of the plan deleted) and because a reader must be
   * able to tell "the function gave me no link" from "the function gave me one".
   * Absent on a payload read straight off the wire, which is the honest answer
   * for one: `browseUrlFor(mapping.siteBaseUrl, key)` is how this module builds
   * a link of its own, and it never reads this field.
   */
  url?: string | null
  /**
   * The requested fields, keyed by field id. `unknown` and not a mapped type:
   * a custom field's value shape is decided by its TYPE (text, select,
   * multi-select, user, rich text), which this app does not know and must not
   * assume. `readFieldText` is the one place that inspects it.
   */
  fields?: Record<string, unknown> | null
}

/**
 * The search envelope. NO `total` AND NO `startAt` — see the header; both left
 * with the old endpoint, and code that waits for `startAt + maxResults >= total`
 * against this one never terminates.
 */
export interface JiraSearchPage {
  issues?: JiraIssue[] | null
  /** Absent or null on the last page. Its ABSENCE is the stop condition. */
  nextPageToken?: string | null
  /** Advisory only. May be used to stop early, never to keep going. */
  isLast?: boolean | null
}

/** `/rest/api/3/search/jql` — the only search path that still answers. */
export const JIRA_SEARCH_PATH = '/rest/api/3/search/jql'

/* ──────────────────────── the reading configuration ──────────────────── */

/**
 * Which Jira field means what, and which Jira status word means which of our
 * three.
 *
 * ALL FOUR PARTS ARE CONFIGURATION AND NONE MAY BECOME A LITERAL. Our side is
 * fixed — 0024's `UseCaseStatus` is `planned | testing | live`, where "not
 * integrated" is the ABSENCE of the row and not a fourth value. HIS side is his
 * own words on his own board, which this fleet has never seen. A literal here
 * would keep matching right up until somebody renames a column in Jira, and then
 * stop — silently, reporting every issue as unmapped, on the morning of a
 * steering meeting. `useCaseProgress`'s `terminalKey` is a parameter for exactly
 * this reason and this is the same decision.
 */
export interface JiraFieldMapping {
  /** The field naming the Organization. Matched against `map_nodes.name`/`name_ar`. */
  organizationField: JiraFieldId
  /** The field naming the capability. Matched against `use_cases.name`/`name_ar`. */
  useCaseField: JiraFieldId
  /** Usually `'status'`, but a site may track this in a select field instead. */
  statusField: JiraFieldId
  /**
   * Jira's status word → ours. Keys are compared after `normalizeName`, so
   * `'In Progress'` and `'in progress'` are the same key; two keys that normalize
   * alike but disagree are a configuration conflict `statusMapConflicts()`
   * reports rather than a coin toss.
   */
  statusMap: Readonly<Record<string, UseCaseStatus>>
  /**
   * `https://yoursite.atlassian.net`, used to build the "view in Jira" href.
   *
   * OPTIONAL AND VALIDATED, because `map_nodes.external_url` and
   * `map_node_use_cases.external_url` both carry
   * `check (external_url is null or external_url ~* '^https?://')`. Anything
   * that is not http(s) yields a null href rather than a link the database would
   * refuse and a browser would treat as relative. Null is a legal answer; a bad
   * URL is not.
   */
  siteBaseUrl?: string | null
  /**
   * Fold Arabic orthography when matching names — see `normalizeName`. Off by
   * default; both settings are defensible and this one is Aziz's call against
   * his own data, not a decision to bury in a matcher.
   */
  foldArabic?: boolean
}

/**
 * The `fields` list to send with the search, derived from the mapping.
 *
 * CALL THIS RATHER THAN HAND-WRITING THE ARRAY. `/search/jql` returns only what
 * is asked for, so a mapping that names `customfield_10050` and a request that
 * forgets it produce a page of issues with nothing in them — which this module
 * would faithfully and uselessly report as forty absent fields. Deduped and
 * blank-filtered so a half-filled mapping cannot send `['']`.
 */
export function jiraSearchFields(mapping: JiraFieldMapping): string[] {
  const wanted = [mapping.organizationField, mapping.useCaseField, mapping.statusField]
  const out: string[] = []
  for (const field of wanted) {
    const trimmed = field.trim()
    if (trimmed.length === 0) continue
    if (out.includes(trimmed)) continue
    out.push(trimmed)
  }
  return out
}

/* ───────────────────────────── the readers ───────────────────────────── */

/** Narrows a JSON value to a plain object. Arrays and null are NOT objects here. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The search envelope, made total.
 *
 * Everything the caller needs to page is reported, and the two stop signals are
 * kept separate rather than reconciled here — the paging loop belongs to the
 * Edge Function and this module has no opinion about how many pages it should
 * fetch. `issues` is always an array, and entries that are not objects are
 * dropped (a JSON body that is not a search page at all yields an empty page,
 * never a throw).
 */
export function readSearchPage(body: unknown): {
  issues: JiraIssue[]
  nextPageToken: string | null
  isLast: boolean
} {
  // `isLast: false` and not `true`: this field reports what the PAYLOAD claimed,
  // and a body that is not a search page claimed nothing. The stop signal is the
  // absent `nextPageToken` — which is null here, so a correct paging loop halts
  // either way, and one that trusted `isLast` alone would have halted on a lie.
  if (!isRecord(body)) return { issues: [], nextPageToken: null, isLast: false }
  const rawIssues = body['issues']
  const issues: JiraIssue[] = []
  if (Array.isArray(rawIssues)) {
    for (const candidate of rawIssues) {
      if (isRecord(candidate)) issues.push(candidate as JiraIssue)
    }
  }
  const token = body['nextPageToken']
  const isLast = body['isLast']
  return {
    issues,
    nextPageToken: typeof token === 'string' && token.length > 0 ? token : null,
    isLast: isLast === true,
  }
}

/** The issue key, or null when the payload did not carry one. See the header. */
export function issueKeyOf(issue: JiraIssue): string | null {
  const key = issue.key
  if (typeof key !== 'string') return null
  const trimmed = key.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Whether the field was in the payload, and whether it had anything in it. */
export type JiraFieldPresence = 'absent' | 'blank' | 'present'

/** What one field on one issue says, flattened to text. */
export interface JiraFieldRead {
  presence: JiraFieldPresence
  /**
   * Every textual value the field carried, in payload order. One entry for a
   * single-select, several for a multi-select or a labels array, zero when the
   * field is unset — which is what makes "two organizations named on one issue"
   * a reportable input problem rather than a silent first-wins.
   */
  values: string[]
}

/**
 * Read one field off one issue and flatten it to text.
 *
 * THE FLATTENING IS THE WHOLE JOB, because a Jira field id tells you nothing
 * about the shape of its value:
 *
 *   `'ADT'`                                   a text field
 *   `{ value: 'ADT', id: '10001' }`           a select option
 *   `{ name: 'In Progress', statusCategory: … }`  a status
 *   `{ displayName: 'Sara Ali' }`             a user
 *   `[{ value: 'ADT' }, { value: 'Lab Order' }]`  a multi-select
 *   `['ops', 'uhr']`                          labels
 *   `{ type: 'doc', content: [ … ] }`         ATLASSIAN DOCUMENT FORMAT
 *
 * The last one is the trap specific to API v3: a rich-text field that returned a
 * plain string on v2 returns an ADF document tree on v3, and a reader that only
 * handles strings reports it as blank forever. The walk below collects `text`
 * nodes out of it.
 *
 * A cascading select yields its PARENT value (`{ value, child: { value } }` →
 * the parent), because that is the level an Organization would be chosen at and
 * concatenating the two would match nothing.
 */
export function readFieldText(issue: JiraIssue, fieldId: JiraFieldId): JiraFieldRead {
  const fields = issue.fields
  const id = fieldId.trim()
  if (!isRecord(fields) || id.length === 0 || !Object.hasOwn(fields, id)) {
    return { presence: 'absent', values: [] }
  }
  const values = textValuesOf(fields[id])
  return { presence: values.length > 0 ? 'present' : 'blank', values }
}

/** The flattening from `readFieldText`, exposed for tests and for reuse. */
export function textValuesOf(raw: unknown): string[] {
  const out: string[] = []
  collectText(raw, out, 0)
  return out
}

// Depth-capped: a self-referential JSON body cannot exist, but a deeply nested
// ADF document can, and an unbounded walk over an attacker-shaped payload in an
// Edge Function is a way to spend a request budget on nothing.
const MAX_DEPTH = 8

function collectText(raw: unknown, out: string[], depth: number): void {
  if (depth > MAX_DEPTH) return
  if (raw === null || raw === undefined) return

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length > 0) out.push(trimmed)
    return
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    out.push(String(raw))
    return
  }
  if (typeof raw === 'boolean') {
    out.push(String(raw))
    return
  }
  if (Array.isArray(raw)) {
    for (const item of raw) collectText(item, out, depth + 1)
    return
  }
  if (!isRecord(raw)) return

  // ADF: a node tree, identified by a string `type` plus a `content` array.
  // Collected as ONE value — a two-paragraph rich text field is one name with a
  // space in it, not two candidate names.
  if (typeof raw['type'] === 'string' && Array.isArray(raw['content'])) {
    const parts: string[] = []
    collectAdfText(raw, parts, 0)
    const joined = parts.join(' ').replace(/\s+/gu, ' ').trim()
    if (joined.length > 0) out.push(joined)
    return
  }

  // The three shapes every Jira object value uses, in the order Jira uses them.
  for (const key of ['value', 'name', 'displayName']) {
    const candidate = raw[key]
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim()
      if (trimmed.length > 0) out.push(trimmed)
      return
    }
  }
}

function collectAdfText(node: unknown, parts: string[], depth: number): void {
  if (depth > MAX_DEPTH || !isRecord(node)) return
  const text = node['text']
  if (typeof text === 'string' && text.length > 0) parts.push(text)
  const content = node['content']
  if (Array.isArray(content)) {
    for (const child of content) collectAdfText(child, parts, depth + 1)
  }
}

/* ──────────────────────────── name matching ──────────────────────────── */

// Invisible characters that make a name that LOOKS identical fail to match:
// zero-width space/joiner/non-joiner, the four bidi marks and embedding
// controls, and a stray BOM. Arabic text pasted out of a Jira field carries RLM
// and ALM routinely, and "the two strings are the same but the import says
// unknown organization" is the least debuggable failure this module could ship.
// Written as escapes on purpose: the characters themselves are invisible in an
// editor, so a literal class here would be a rule nobody could review or grep.
const INVISIBLE = /[\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/gu

/**
 * The one normalisation both sides of every name comparison go through.
 *
 * NFKC (so a compatibility-composed form matches its canonical twin) → invisible
 * marks removed → whitespace runs collapsed → trimmed → lowercased with
 * `toLowerCase`, which is locale-independent (`toLocaleLowerCase` under a
 * Turkish locale maps `I` to `ı` and would make a workspace's matches depend on
 * where the browser thinks it is).
 *
 * ARABIC ORTHOGRAPHIC FOLDING IS A PARAMETER, DEFAULTED OFF, AND THE ARGUMENT
 * FOR EACH SETTING IS REAL. Half these organizations are recorded in Arabic;
 * tashkeel is optional in writing and present in one system and absent in the
 * other, أ/إ/آ are typed as ا by anyone in a hurry, and ة/ه and ى/ي are
 * interchanged constantly — so OFF means the harness reports a keyboard
 * difference as a data problem. But folding also collapses two genuinely
 * different organizations onto one string, and in the one case where only ONE
 * of them exists in this workspace that produces a CONFIDENT WRONG MATCH, which
 * is the outcome this whole module is shaped to avoid. (Where both exist,
 * folding is safe: it yields `ambiguous`, which is reported and not guessed.)
 *
 * It is a flag rather than a decision because it is Aziz's call against his own
 * data, and the harness exists to give him the evidence to make it: run once
 * folded, once not, and compare the unmatched lists. Off by default so the
 * first run is the precise one.
 */
export function normalizeName(raw: string, folding?: NameFolding): string {
  const base = raw.normalize('NFKC').replace(INVISIBLE, '')
  const folded = folding?.arabic === true ? foldArabicOrthography(base) : base
  return folded.replace(/\s+/gu, ' ').trim().toLowerCase()
}

/** Which optional foldings `normalizeName` applies. */
export interface NameFolding {
  /**
   * Strip tashkeel and tatweel, and fold أ إ آ ٱ → ا, ى → ي, ة → ه.
   *
   * A keyboard-variance fold, NOT fuzzy matching: no edit distance and no
   * substring containment, because a harness whose verdict is "probably this
   * one" is not evidence for a sync that will later write rows on it.
   */
  arabic?: boolean
}

const TASHKEEL = /[\u064B-\u0652\u0670\u0640]/gu
const ALEF_FORMS = /[\u0622\u0623\u0625\u0671]/gu
const ALEF_MAKSURA = /\u0649/gu
const TEH_MARBUTA = /\u0629/gu

function foldArabicOrthography(value: string): string {
  return value
    .replace(TASHKEEL, '')
    .replace(ALEF_FORMS, '\u0627')
    .replace(ALEF_MAKSURA, '\u064A')
    .replace(TEH_MARBUTA, '\u0647')
}

/**
 * The href for an issue, or null when no valid base was configured.
 *
 * `/browse/KEY` and not `self`: `self` is the REST resource
 * (`…/rest/api/3/issue/10042`), which renders JSON at a person who clicked a
 * link expecting an issue.
 *
 * NULL RATHER THAN A BEST EFFORT when the base is not http(s). Both Jira columns
 * carry `check (external_url is null or external_url ~* '^https?://')`, so a
 * `javascript:` or bare-hostname value is a row the database refuses on the day
 * the sync ships — and, before that, an href a browser resolves against our own
 * origin.
 */
export function browseUrlFor(siteBaseUrl: string | null | undefined, issueKey: string): string | null {
  if (typeof siteBaseUrl !== 'string') return null
  const base = siteBaseUrl.trim().replace(/\/+$/u, '')
  if (!/^https?:\/\/[^/\s]+/iu.test(base)) return null
  const key = issueKey.trim()
  if (key.length === 0) return null
  return `${base}/browse/${encodeURIComponent(key)}`
}
