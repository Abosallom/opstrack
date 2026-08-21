// The Jira READER — the client half of Settings › Jira, and the whole of what
// this app knows how to do with Jira today.
//
// ═══ WHAT THIS MODULE IS, AND WHAT IT REFUSES TO BE ═══
//
// Aziz asked for this in one sentence: "make just read from JIRA without
// changing anything. to test the inputs from JIRA" — and, earlier, about who
// owns the data: "both updating each other (both live). i can not connect the
// app to jira until we verify the tracker very well."
//
// The eventual design is a TWO-WAY sync. This is the first half of it, and
// "without changing anything" is read here as BOTH of its meanings, because
// both of them hold:
//
//   (a) NOTHING IS WRITTEN TO JIRA. There is no POST, no PUT, no transition and
//       no comment anywhere behind this module. The endpoint it calls is named
//       `jira-read` for that reason.
//   (b) NOTHING IS WRITTEN TO THIS APP EITHER. No `map_nodes`, no
//       `map_node_use_cases`, no `entries`. Not even the field mapping the
//       screen collects — see THE MAPPING DOES NOT PERSIST below.
//
// So there is no `importIssues`, no `applyMapping`, no upsert, and nothing
// disabled-for-now that a later edit could quietly enable. A function that does
// not exist cannot fire by accident against live data, and "it changes nothing"
// is then provable by grep rather than by reading every branch of every screen.
// `JiraAdmin.test.tsx` runs exactly that grep over this file and over the
// screen, so the property is a gate rather than a promise.
//
// ═══ WHY A CREDENTIAL NEVER TOUCHES THIS FILE ═══
//
// A BROWSER CANNOT CALL JIRA CLOUD, AND MUST NOT HOLD THE TOKEN. Two
// independent reasons, either one of which would be enough:
//
//   1. Atlassian does not send CORS headers that let a third-party SPA origin
//      call `/rest/api/3/*` with credentials. The request fails in the browser
//      and succeeds in curl, which is the most misleading failure mode
//      available — it reads as "our code is wrong" for as long as anybody is
//      willing to look at the code.
//   2. A Jira API token in a Vite bundle is a Jira API token published to
//      everyone who loads the page, and to anyone who fetches the JS off GitHub
//      Pages signed in or not. A Jira token is not scoped to a project; it is
//      the whole account.
//
// So the credential lives in a Supabase Edge Function, which is where this repo
// already puts server-side work (`admin-members`, `capture-assist`,
// `claim-account`, `send-push`). This module holds the SHAPE of that
// conversation and nothing else: it invokes the function through the supabase
// client, exactly as api/members.ts and api/ai.ts do, and returns `ApiResult<T>`
// like every other module in this directory.
//
// THE OWNER SUPPLIES THE SECRETS HIMSELF, in the Supabase dashboard, and never
// in chat. Nobody who built this has them. That is why a missing secret is a
// first-class answer here rather than a 500 the screen has to guess at: the
// single most likely state this feature is ever in is "not configured yet". The
// function answers `missing_secret` with a `missing` ARRAY naming the variables
// that are unset, and `secretKey()` below turns that array into the one sentence
// that names the one the owner has to go and set.
//
// ═══ THE FUNCTION CONTRACT (the sibling unit owns the server side) ═══
//
// One endpoint, FOUR operations, POST with a JSON body whose operation key is
// `op`. This module was written against `supabase/functions/jira-read/index.ts`
// as it stands, not against an assumed shape — the two halves of one wire
// contract are worth reading together and the reply keys below are that file's.
//
//   { op: 'ping' }
//     → { ok, op, site: { baseUrl, hostname, atlassianCloud },
//         account: { accountId, displayName, emailAddress, active, … } }
//     GET /rest/api/3/myself. NOTE there is no site TITLE on the wire: the
//     hostname is what the function can prove, and inventing a friendly name
//     for it would be inventing the one fact this button exists to establish.
//
//   { op: 'projects' }
//     → { ok, op, projects: [{ id, key, name, projectTypeKey, simplified, url }],
//         startAt, maxResults, total, isLast }
//     GET /rest/api/3/project/search — still offset-paged, and still the one
//     endpoint here that can honestly report a total.
//
//   { op: 'fields', customOnly? }
//     → { ok, op, fields: [{ id, key, name, custom, schemaType, customType,
//         clauseNames }], returned, totalOnSite, customCount, truncated }
//     GET /rest/api/3/field — the id is what a search asks for and what the
//     mapping stores (`customfield_10050`).
//
//   { op: 'search', jql, fields, maxResults?, nextPageToken? }
//     → { ok, op, jql, fields, issues: [{ id, key, url, fields }], count, pages,
//         maxResults, nextPageToken, truncated, limits, wrote: false }
//     POST /rest/api/3/search/jql.
//
// ⚠ THERE IS NO `statuses` OPERATION, AND THE SCREEN DOES NOT NEED ONE. The
//   statuses worth mapping are not every status configured on the site — they
//   are the ones HIS issues actually carry, which the search reply already
//   contains. `distinctStatuses()` below reads them out of the result, so the
//   third axis of the mapping costs no extra call, cannot drift from the data
//   it is describing, and never offers a status no issue in the query has.
//
// ⚠ THE SEARCH ENDPOINT AND ITS PAGING CHANGED, AND THE OLD ONE IS GONE. This
//   was checked against Atlassian's current documentation rather than written
//   from memory, because a plausible wrong call here fails only against a real
//   site, which is the most expensive place to find out. Three facts that decide
//   the shape of this file and of the screen above it:
//
//     · `GET|POST /rest/api/3/search` is REMOVED, not merely deprecated —
//       shutdown ran from 1 August to 31 October 2025. The replacement is
//       `POST /rest/api/3/search/jql`.
//     · THE REPLY CARRIES NO `total`. Paging is a cursor: `nextPageToken` in,
//       `nextPageToken` out, and its ABSENCE means "that was the last page"
//       (`isLast` appears only sometimes and is a bonus, never the signal). A
//       count needs a second, separate call — `POST
//       /rest/api/3/search/approximate-count` — and it is approximate. This is
//       why neither the wire envelope nor `JiraSearchResult` below carries a
//       `total` field to be tempted by, and why the
//       screen's summary counts THE ISSUES IT ACTUALLY RECEIVED and says so. A
//       reconciliation that quoted a number it had not examined would be the one
//       number on the screen that is not evidence.
//     · IF `fields` IS OMITTED, THE NEW ENDPOINT RETURNS IDS AND NOTHING ELSE.
//       That is a performance default, and it is a silent one: the request
//       succeeds, the table renders, and every value is blank. The function
//       defends against this with a default list of its own; this module sends
//       an explicit list anyway, because the two fields the mapping names are
//       custom ones no default could know about.
//
// ═══ THE MAPPING DOES NOT PERSIST ═══
//
// Which Jira field carries the organization, which carries the use case, and
// which Jira status means planned/testing/live — none of it is stored. There is
// no table for it and this wave writes none (the harness needs none: the JQL is
// typed into the screen and is not persisted either). It lives in React state
// for as long as the screen is open. The screen says so in one sentence, which
// is cheaper than letting the owner lose twenty minutes of picking and wonder
// whether the app is broken.
//
// ═══ THIS FILE IS TRANSPORT. THE RESOLVER IS `src/lib/jira/map.ts` ═══
//
// It used to be both, and that was the bug. Two mappers existed: this file's
// `resolveIssue`/`reconcile`, and `src/lib/jira/map.ts` — richer, purer, with
// 800 lines of tests, and WIRED TO NOTHING. Whichever one a reader found, they
// found the wrong one half the time. §C of the map-revamp plan picked the tested
// one, and this file's ~200-line parallel resolver (`JiraMapping`,
// `JiraCatalogue`, `ResolveReason`, `RESOLVE_REASONS`, `ResolvedIssue`,
// `Reconciliation`, `indexByName`, `resolveIssue`, `reconcile`) is gone. What it
// judged, `mapJiraIssues` judges better:
//
//   · ALL the reasons an issue did not resolve, not the first blocking one.
//   · `absent` (the field is not in the payload — a configuration bug) told
//     apart from `blank` (nobody filled it in — fieldwork).
//   · `duplicate-pair`: two issues claiming one organization × capability cell,
//     which a first-wins resolver files against a hospital silently.
//   · `externalRef` / `externalUrl` — the two columns a write path must stamp.
//   · `effect: create | update | unchanged | held`, where `held` is the
//     `overrides` contract from 0023/0024. Nothing else in this app expresses it.
//
// `fieldText` and `normalizeName` went with it — `lib/jira/types.ts`'s
// `textValuesOf` is the reader that keeps "absent" and "blank" apart, and
// `normalizeName` there takes the Arabic-folding flag this one could not. The
// status picker's `distinctStatuses` moved to `lib/jira/map.ts` as
// `distinctStatusValues`, where it reads the CONFIGURED status field instead of
// a literal `'status'`.
//
// What remains here is the conversation with the edge function and nothing else:
// invoke it, map its failures to i18n keys, and read its replies totally.

import { supabase } from './supabase'
import { fail, notConfigured, type ApiResult } from './result'
import { isRecord, readSearchPage, type JiraIssue } from '../lib/jira/types'

/** The edge function this module talks to. Read-only by name and by contract. */
export const JIRA_FUNCTION = 'jira-read'

/**
 * How long the client waits before giving up on the function.
 *
 * `functions.invoke` takes a `timeout` and aborts the request itself, so a hung
 * upstream costs one aborted fetch rather than a promise that never settles —
 * api/ai.ts's reasoning. A JQL search across a large site is the slowest thing
 * here by an order of magnitude, so it gets its own budget rather than making
 * every ping wait as long as the worst search might.
 */
const CALL_TIMEOUT_MS = 15_000
const SEARCH_TIMEOUT_MS = 30_000

/**
 * The largest page this screen will ask for.
 *
 * A harness, not an importer: the question is "do my issues resolve", and that
 * is answered by a representative page, not by every issue on the site. Capped
 * here as well as in the function because the cheapest request is the one that
 * was never made too large.
 */
export const MAX_PAGE_SIZE = 100

/* ────────────────────────────── what comes back ───────────────────────────── */

/** Who the token authenticated as. `emailAddress` is null when Jira hides it. */
export interface JiraIdentity {
  accountId: string
  displayName: string
  emailAddress: string | null
}

/**
 * Which site it authenticated against — the half a wrong base URL gets wrong.
 *
 * NO `title`. The function reports the origin and the hostname, both of which it
 * can prove from the URL it actually called; a friendly site name would have to
 * come from somewhere else, and a name this screen made up is the opposite of
 * what a connection test is for.
 */
export interface JiraSite {
  baseUrl: string
  hostname: string
  /** True for `*.atlassian.net` — a Cloud site, which is the only shape supported. */
  atlassianCloud: boolean
}

export interface JiraPing {
  account: JiraIdentity
  site: JiraSite
}

export interface JiraProject {
  id: string
  key: string
  name: string
  /** `…/browse/KEY`, validated http(s), or null. Built by the function. */
  url: string | null
}

/**
 * One field definition. `id` is what a search asks for and what the mapping
 * stores — `summary`, `labels`, `customfield_10050`. `name` is what the person
 * picking it recognises, and two different fields may share one name, which is
 * exactly why the id is the value and the name is only the label.
 */
export interface JiraField {
  id: string
  name: string
  custom: boolean
  /** `schema.type` — 'string', 'option', 'array', 'user'. '' when Jira omits it. */
  type: string
}

/**
 * One page of search results, as this app holds it.
 *
 * NOT a second declaration of `lib/jira/types.ts`'s `JiraSearchPage`, which is
 * the WIRE envelope — `issues?`, `nextPageToken?`, `isLast?`, every one of them
 * optional because that is what a third party may or may not send. This is what
 * the reader made of it: always an array, a cursor that is null or a real token,
 * plus one fact only `jira-read` knows.
 *
 * NO `total`, BY CONSTRUCTION — see the header. `nextPageToken` is null when
 * this was the last page, which is the only end-of-results signal the endpoint
 * gives.
 */
export interface JiraSearchResult {
  issues: JiraIssue[]
  nextPageToken: string | null
  /**
   * The function stopped early — its own per-call budget, or a cursor still in
   * hand. TRUE MEANS "there is more of your backlog than this", which is a
   * different claim from "the page was full", and it is the only honest thing
   * the screen can say about size now that the endpoint reports no total.
   */
  truncated: boolean
}

export interface JiraSearchInput {
  jql: string
  /** Field ids to fetch. Never empty: an empty list means "ids only". */
  fields: string[]
  maxResults?: number
  nextPageToken?: string | null
}

/* ─────────────────────────────── the failures ─────────────────────────────── */

/**
 * Every failure the function can name, mapped to an i18n key.
 *
 * ERRORS ARE KEYS, NOT SENTENCES, exactly as api/tracks.ts and api/map.ts have
 * it: the function answers in English (which is what a curl probe and a server
 * log want) and this app has an Arabic half. The caller renders `t(result.error)`.
 *
 * THE THREE MISSING-SECRET CODES EARN THEIR OWN KEYS and must never be folded
 * into one. The owner sets these himself in the Supabase dashboard, nobody on
 * this side has them, and "something is misconfigured" sends him to read three
 * settings when the function already knows which one is blank.
 *
 * A code this table does not carry falls back to `common.error`, so a client
 * left open across a function deploy degrades to a generic sentence rather than
 * rendering a raw dot path — api/members.ts's rule.
 */
export const JIRA_ERROR_KEYS: Readonly<Record<string, string>> = {
  // ours
  not_signed_in: 'common.notSignedIn',
  forbidden: 'admin.errForbidden',
  invalid_body: 'common.error',
  unknown_operation: 'common.error',
  invalid_fields: 'common.error',
  invalid_page_token: 'common.error',
  // A JQL the function itself refused — empty, too long, or carrying control
  // characters out of a pasted spreadsheet cell. Same sentence as Jira's own
  // refusal, because to the person typing it is the same problem.
  invalid_jql: 'jira.errBadJql',
  // the configuration — the owner's to fix. `missing_secret` is resolved
  // per-variable by secretKey() below rather than through this table.
  missing_secret: 'jira.errMissingSecret',
  bad_base_url: 'jira.errBadBaseUrl',
  bad_email: 'jira.errBadEmail',
  // Jira answered, and said no.
  jira_unauthorized: 'jira.errBadCredentials',
  jira_forbidden: 'jira.errJiraForbidden',
  jira_not_found: 'jira.errNoSuchSite',
  jira_gone: 'jira.errGone',
  jira_bad_request: 'jira.errBadJql',
  jira_rate_limited: 'jira.errRateLimited',
  jira_unavailable: 'jira.errUpstream',
  jira_bad_response: 'jira.errUpstream',
  // Jira did not answer.
  jira_timeout: 'jira.errTimeout',
  jira_unreachable: 'jira.errUnreachable',
  // us
  server_error: 'common.error',
}

/**
 * The code list, for the server side to mirror and for the test to pin.
 *
 * Exported as an array rather than derived at the call site so that the unit
 * building `jira-read` has one importable list to check its own `JiraCode`
 * union against, and so a code deleted here fails a test rather than quietly
 * becoming `common.error` for every user.
 */
export const JIRA_ERROR_CODES: readonly string[] = Object.keys(JIRA_ERROR_KEYS)

/**
 * Which secret is missing, as the key that says so.
 *
 * THE FUNCTION ANSWERS WITH AN ARRAY (`missing: ['JIRA_API_TOKEN']`) because
 * more than one can be unset at once, and this picks the FIRST one in
 * configuration order — base URL, then email, then token. That order is not
 * arbitrary: it is the order they have to be set in for the next attempt to get
 * any further, so naming the first one is naming the next thing to do. Telling
 * him about all three at once is a list; telling him about one is an
 * instruction.
 *
 * Exported for its test — this is the sentence the whole "never a bare failure"
 * requirement rests on.
 */
export function secretKey(missing: unknown): string {
  const names = Array.isArray(missing) ? missing.filter((m): m is string => typeof m === 'string') : []
  if (names.includes('JIRA_BASE_URL')) return 'jira.errNoBaseUrl'
  if (names.includes('JIRA_EMAIL')) return 'jira.errNoEmail'
  if (names.includes('JIRA_API_TOKEN')) return 'jira.errNoToken'
  return 'jira.errMissingSecret'
}

/**
 * The edge function's failure, mapped to a key.
 *
 * THE `.clone()` IS LOAD-BEARING, and this is the unwrap api/members.ts and
 * api/ai.ts both document. supabase-js collapses every non-2xx into a
 * FunctionsHttpError whose message is a constant; the status and the JSON body
 * are reachable only through `.context`, the raw Response. A Response body is a
 * one-shot stream, so reading `ctx.json()` directly consumes the body that
 * supabase-js may still hold a reference to and the second reader gets a
 * TypeError instead of the payload.
 *
 * Kept local rather than shared with those two, exactly as they keep their
 * copies separate from each other: they differ in the code table they consult
 * and one helper serving all three would serve each of them badly.
 *
 * ⚠ `detail` IS LOGGED, NOT RENDERED, AND THAT IS A KNOWN LOSS. The function
 *   relays Jira's own message there, and for a JQL syntax error it is the most
 *   useful sentence on the screen — but `ApiResult` carries an i18n KEY and no
 *   payload, and `src/api/result.ts` is shared and not this unit's to widen. The
 *   console line is the stopgap; the handoff names the extension.
 */
async function edgeErrorKey(error: unknown): Promise<string> {
  const err = error as { name?: string; context?: unknown }
  // No response at all: DNS, TLS, an offline device, or the abort the timeout
  // raised. Nothing was refused, so it must not read as a refusal — an owner
  // told "forbidden" goes looking at Jira permissions for a problem that is his
  // hotel wifi.
  if (err.name === 'FunctionsFetchError') return 'jira.errNetwork'
  const ctx = err.context
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.clone().json()) as {
        error?: unknown
        code?: unknown
        missing?: unknown
        detail?: unknown
      }
      // Logged, never rendered: the function answers in English.
      if (typeof body.error === 'string') console.warn('[jira] jira-read:', body.error)
      if (typeof body.detail === 'string') console.warn('[jira] jira said:', body.detail)
      if (body.code === 'missing_secret') return secretKey(body.missing)
      if (typeof body.code === 'string' && body.code in JIRA_ERROR_KEYS) {
        return JIRA_ERROR_KEYS[body.code]
      }
    } catch {
      // A gateway HTML error page tells us nothing worth logging.
    }
    // OUR status, not Jira's: the function deliberately answers 502 for an
    // upstream failure so that a bad Jira token cannot bounce the USER to the
    // sign-in screen. So a 401 here really is our own session.
    if (ctx.status === 401) return 'common.notSignedIn'
    if (ctx.status === 403) return 'admin.errForbidden'
    if (ctx.status === 429) return 'jira.errRateLimited'
  }
  return 'common.error'
}

/** One `jira-read` call, guarded and error-mapped. */
async function invokeJira<T>(
  body: Record<string, unknown>,
  timeout = CALL_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  if (!supabase) return notConfigured()
  const { data, error } = await supabase.functions.invoke(JIRA_FUNCTION, { body, timeout })
  if (error) return fail(await edgeErrorKey(error))
  return { ok: true, data: data as T }
}

/* ───────────────────────── total readers of the reply ─────────────────────── */
//
// EVERYTHING BELOW ASSUMES THE BODY IS GARBAGE UNTIL PROVEN OTHERWISE —
// api/ai.ts's rule, for a stronger reason: this payload originates at a third
// party whose field shapes this app does not control, and the whole point of
// the screen is to be pointed at a site nobody here has ever seen. A reader that
// threw on an unexpected value would turn "your custom field is an odd shape"
// into a blank screen, which is the one answer a diagnostic screen may not give.

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One project row, normalised. Anything unreadable becomes an empty string. */
function toProject(raw: unknown): JiraProject {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return { id: str(r.id), key: str(r.key), name: str(r.name), url: safeHttpUrl(r.url) }
}

/** One field definition, normalised. `custom` defaults to false, not to true. */
function toField(raw: unknown): JiraField {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    id: str(r.id),
    // A field with no name is shown by its id rather than as a blank row in a
    // picker — the id is what the mapping stores, so it is never useless.
    name: str(r.name) || str(r.id),
    custom: r.custom === true,
    // `schemaType`, already flattened out of Jira's `schema.type` by the
    // function. Reading `schema.type` here would silently produce '' for every
    // field, which renders as a picker with no type hints and no error.
    type: str(r.schemaType),
  }
}

/**
 * One issue, normalised — and the URL is VALIDATED, not trusted.
 *
 * `safeHttpUrl` is applied because this value is rendered as an `href`. That is
 * the same rule migration 0023 puts on the column it would eventually be stored
 * in (`map_nodes_external_url_chk`: `external_url is null or external_url ~*
 * '^https?://'`), and for the same stated reason: anything that is not http(s)
 * is either a dead link or, with `javascript:…`, a script injection in an
 * admin's browser. The database refuses it at rest; this refuses it in flight,
 * which is where it would actually be clicked.
 */
export function toIssue(raw: unknown): JiraIssue {
  const r = isRecord(raw) ? raw : {}
  return {
    key: str(r.key),
    url: safeHttpUrl(r.url),
    // NULL, NOT `{}`, WHEN THE PAYLOAD CARRIED NO FIELDS OBJECT, and the
    // difference is a whole sentence on the screen. `mapJiraIssues` reads `{}`
    // as "every mapped field is absent from this issue" and `null` as
    // `issue-malformed / no-fields` — which is what a search that forgot its
    // `fields` list actually produces. Substituting an empty object here would
    // report one configuration mistake as three data problems per issue.
    fields: isRecord(r.fields) ? r.fields : null,
  }
}

/**
 * The whole search reply, normalised. A missing token means "last page".
 *
 * KEYLESS ISSUES SURVIVE, and that is a change of mind this file used to hold
 * the other way. Dropping them kept a blank row off the table at the cost of the
 * one property the harness is built on — `readings.length === issues.length`, no
 * issue silently disappearing between the payload and the summary. A keyless
 * issue is now reported by name (`issue-malformed / no-key`) rather than by
 * absence, which is the only form of "something is wrong with your payload" a
 * reader can act on.
 *
 * The envelope itself is read by `lib/jira/types.ts`'s `readSearchPage`, so the
 * cursor rules (absent token = last page; `isLast` may stop early and never keep
 * going) are stated once, next to the endpoint contract they come from.
 */
export function toSearchPage(raw: unknown): JiraSearchResult {
  const page = readSearchPage(raw)
  const r = isRecord(raw) ? raw : {}
  return {
    issues: page.issues.map(toIssue),
    nextPageToken: page.nextPageToken,
    // A cursor left over is more, whether or not the function also said so.
    truncated: r.truncated === true || page.nextPageToken !== null,
  }
}

/**
 * An absolute http(s) URL, or null.
 *
 * Exported for its test. `new URL()` rather than a regex on the raw string: a
 * regex anchored at `^https?://` passes `https://evil.example` and also passes
 * a string with a newline and a second scheme after it, and the parse is the
 * thing the browser will actually do with the value.
 */
export function safeHttpUrl(raw: unknown): string | null {
  const value = str(raw).trim()
  if (value === '') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * `…/browse/KEY` for a site, or null when the base URL is not http(s).
 *
 * The fallback for an issue whose `url` the function did not supply. Building
 * the link here is safe — the key and the base both came back from the same
 * authenticated call — and it is the difference between a table of clickable
 * evidence and a table of strings the owner has to paste somewhere.
 */
export function issueHref(baseUrl: string, key: string): string | null {
  const base = safeHttpUrl(baseUrl)
  const trimmed = key.trim()
  if (base === null || trimmed === '') return null
  return `${base.replace(/\/+$/, '')}/browse/${encodeURIComponent(trimmed)}`
}

/* ──────────────────────────────── the calls ───────────────────────────────── */

/**
 * Who are we, and against which site? The Test button.
 *
 * THE ONE CALL THAT MUST ALWAYS BE MAKEABLE. Every other action on the screen
 * is only interesting once this one has answered, and its failure is the answer
 * the owner actually needs on day one: which secret is missing, or whether the
 * token is wrong / the site does not exist / the account is rate-limited. That
 * is why the error table above is as long as it is.
 */
export async function jiraPing(): Promise<ApiResult<JiraPing>> {
  const result = await invokeJira<Record<string, unknown>>({ op: 'ping' })
  if (!result.ok) return result
  const raw = result.data
  const account = (typeof raw.account === 'object' && raw.account !== null
    ? raw.account
    : {}) as Record<string, unknown>
  const site = (typeof raw.site === 'object' && raw.site !== null ? raw.site : {}) as Record<
    string,
    unknown
  >
  return {
    ok: true,
    data: {
      account: {
        accountId: str(account.accountId),
        displayName: str(account.displayName),
        // Jira hides the address unless the token's own profile permits it, so
        // null is a normal answer here and not a degraded one.
        emailAddress: str(account.emailAddress) || null,
      },
      site: {
        baseUrl: str(site.baseUrl),
        hostname: str(site.hostname),
        atlassianCloud: site.atlassianCloud === true,
      },
    },
  }
}

/** The projects the token can see, so the owner can read his keys without leaving. */
export async function jiraProjects(): Promise<ApiResult<JiraProject[]>> {
  const result = await invokeJira<Record<string, unknown>>({ op: 'projects' })
  if (!result.ok) return result
  const list = Array.isArray(result.data.projects) ? result.data.projects : []
  return { ok: true, data: list.map(toProject).filter((p) => p.key !== '') }
}

/**
 * Every field on the site, custom ones included. The mapping's raw material.
 *
 * Not filtered to custom fields: an organization may well be carried by
 * `components`, `labels` or even `summary` on a site that was set up before
 * anybody thought about this app, and a picker that hid those would be a picker
 * that cannot describe the site it is pointed at.
 */
export async function jiraFields(): Promise<ApiResult<JiraField[]>> {
  const result = await invokeJira<Record<string, unknown>>({ op: 'fields' })
  if (!result.ok) return result
  const list = Array.isArray(result.data.fields) ? result.data.fields : []
  return { ok: true, data: list.map(toField).filter((f) => f.id !== '') }
}

/**
 * Run a JQL query and return one page.
 *
 * `fields` IS REQUIRED AND IS REFUSED WHEN EMPTY. The new endpoint's default is
 * ids-only (header), and the failure that produces is a table that renders
 * perfectly with every value blank — indistinguishable, to the person reading
 * it, from "my Jira has no data in these fields". Refusing here turns a silent
 * wrong answer into a caller bug that cannot ship.
 *
 * The JQL is sent as typed, whitespace-trimmed and nothing else. It is not
 * parsed, not rewritten and not "helpfully" wrapped in an ORDER BY: the owner is
 * testing what HIS query returns, and a query the app edited on the way out is
 * not that.
 */
export async function jiraSearch(input: JiraSearchInput): Promise<ApiResult<JiraSearchResult>> {
  const jql = input.jql.trim()
  if (jql === '') return fail('jira.errJqlRequired')
  if (input.fields.length === 0) return fail('common.error')

  const result = await invokeJira<Record<string, unknown>>(
    {
      op: 'search',
      jql,
      // De-duplicated here rather than at the call site: the mapping may name
      // one field for both axes (a site where the summary carries both), and
      // Jira answers a repeated field name with a 400.
      fields: [...new Set(input.fields.filter((f) => f.trim() !== ''))],
      maxResults: Math.min(Math.max(input.maxResults ?? MAX_PAGE_SIZE, 1), MAX_PAGE_SIZE),
      nextPageToken: input.nextPageToken ?? null,
    },
    SEARCH_TIMEOUT_MS,
  )
  if (!result.ok) return result
  return { ok: true, data: toSearchPage(result.data) }
}
