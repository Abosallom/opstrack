// Supabase Edge Function: jira-read
//
// THE ONLY THING IN THIS SYSTEM THAT EVER HOLDS A JIRA CREDENTIAL, AND IT CAN
// ONLY READ.
//
// Deploy:
//   npx supabase@latest functions deploy jira-read --project-ref <ref> --use-api
//
// REQUIRES three function secrets — JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN —
// set by the owner in the Supabase dashboard and never defaulted in code. See
// ./README.md for how to mint and revoke an Atlassian API token.
// SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.
// SUPABASE_SERVICE_ROLE_KEY IS DELIBERATELY NOT READ HERE — see §4.
//
//
// ═══ 1. WHY THIS IS A SERVER AND NOT A fetch() IN THE BROWSER ═══
//
// Two independent reasons, either one sufficient on its own.
//
//   (a) Atlassian does not send CORS headers that let a third-party SPA origin
//       call /rest/api/3/* with credentials. The request fails in the browser
//       and succeeds in curl — the most misleading failure mode available, and
//       one an afternoon gets lost to.
//   (b) A Jira API token in a Vite bundle is a Jira API token published to
//       everyone who loads the page, and to anyone who fetches the JS off
//       GitHub Pages without signing in at all. An Atlassian API token is not
//       scoped to a project or to a permission: it is the whole account.
//
// So the credential lives here, in a function secret, and the browser names an
// OPERATION over an authenticated Supabase call. The browser never sees a URL,
// never sees the token, and cannot choose an endpoint.
//
//
// ═══ 2. WHAT "WITHOUT CHANGING ANYTHING" MEANS, IN CODE ═══
//
// Aziz: "make just read from JIRA without changing anything. to test the
// inputs from JIRA". That sentence carries two promises and this file keeps
// both structurally, not by convention:
//
//   NOTHING IS WRITTEN TO JIRA. No POST that creates, no PUT, no transition,
//   no comment, no worklog. See §3 — writing is UNREACHABLE, not merely
//   not-currently-done.
//
//   NOTHING IS WRITTEN TO THIS DATABASE EITHER. This file contains no
//   `.from(...).insert(...)`, no `.update(...)`, no `.upsert(...)`, no
//   `.delete(...)`, and no `.rpc()` other than `has_perm`, which is `stable`
//   and reads. It never constructs a service-role client, so even a future
//   mistake here would meet RLS as the caller rather than bypass it. The only
//   database traffic in this file is: verify the JWT, ask `has_perm`. That is
//   the whole surface.
//
// This endpoint is a HARNESS. It shows what comes back. Deciding what to do
// with it — and, later, committing it — is a different unit, gated on Aziz's
// own condition: "i can not connect the app to jira until we verify the
// tracker very well".
//
//
// ═══ 3. HOW READ-ONLY IS ENFORCED ═══
//
// This is the security property the whole feature rests on, so it is worth
// stating the mechanism precisely rather than promising good behaviour.
//
//   (i)   `jiraCall()` is the ONLY place in this file where `fetch` is called
//         against Jira. There is no second one. A reviewer checks this with
//         one grep, and `index.test.ts` asserts the source contains exactly one
//         `fetch(` against the Jira origin.
//   (ii)  `jiraCall()` does not take a URL. It takes a KEY from `ENDPOINTS`, a
//         closed, frozen, four-entry allow-list, and reads the verb OUT of that
//         entry. A caller cannot supply a path, cannot supply a verb, and
//         cannot supply a host.
//   (iii) `ENDPOINTS` is validated at module load by `assertReadOnlyEndpoints()`
//         — every path must live under /rest/api/3/, every verb must be GET
//         except the one documented exception, and that exception must be the
//         JQL search. A bad edit therefore kills the isolate on the first
//         request rather than shipping quietly.
//   (iv)  The browser names an OPERATION (`ping` | `projects` | `search` |
//         `fields`). Operations map to endpoints through an explicit `switch`,
//         so no caller-supplied string is ever used to index `ENDPOINTS`. If it
//         were, the allow-list would be decoration.
//
// ⚠ THE ONE POST, AND WHY IT IS STILL A READ. `POST /rest/api/3/search/jql`
//   takes a JSON body and returns issues. It creates nothing. Atlassian made it
//   a POST because a JQL string does not fit comfortably in a query string, not
//   because it mutates. The old `GET /rest/api/3/search` it replaced is
//   DEPRECATED AND REMOVED on Jira Cloud and now answers 410 Gone. Do not
//   "fix" this entry back to a GET: that is a dead endpoint, and the failure
//   only shows up against a real site.
//
//
// ═══ 4. WHO MAY CALL IT ═══
//
// admin-members' pattern, for admin-members' reason (its header, note on the
// admin gate): the browser's permission check decides what RENDERS and nothing
// else — anyone holding any valid session can call this endpoint directly with
// curl. So the JWT is verified here with the anon client, and authority is
// re-checked here by asking the database, as the caller, whether they hold
// `structure.edit` or `workspace.admin` (0025's `has_perm`). Those are the two
// keys that already gate `map_nodes` writes, which is exactly the population
// that will eventually own the Jira mapping.
//
// THIS FUNCTION IS NEVER GIVEN THE SERVICE ROLE. It reads Jira. It has no
// business writing this database, and the cheapest way to guarantee that
// forever is to never hold the key that would let it.
//
//
// ═══ 5. THE SHAPE THE SCHEMA ALREADY DECIDED ═══
//
// Migrations 0023 and 0024 are applied live and provisioned the sync columns up
// front, unused: on BOTH `map_nodes` and `map_node_use_cases` there is
// `source ('local'|'jira')`, `external_ref`, `external_url`, `synced_at`, and
// `overrides text[]`. 0024 says it in as many words: one Jira issue per
// Organization × use case, "which is exactly this row".
//
// So the eventual mapping is already chosen and this harness is built to feed
// it, not to redesign it:
//
//   issue.key                 -> external_ref
//   `${baseUrl}/browse/${key}` -> external_url   (0023 constrains this column to
//                                 ^~~~~~~~~~~~~~  `~* '^https?://'` because the
//     frontend renders it as an href. `parseBaseUrl()` below REFUSES a base URL
//     that is not https, so every link this file emits satisfies that check by
//     construction rather than by hope.)
//   'jira'                    -> source
//   now()                     -> synced_at       (subtracted from 0023's touch
//                                 and audit diffs, so a nightly run that changes
//                                 nothing writes no audit rows)
//   fields edited in this app -> overrides       (a field named there must not
//                                 be overwritten by a sync)
//
// WHICH JIRA FIELD CARRIES "WHICH ORGANIZATION" AND WHICH CARRIES "WHICH USE
// CASE" IS A FACT ABOUT AZIZ'S JIRA INSTANCE THAT NOBODY HERE CAN KNOW. That is
// the entire reason the `fields` operation exists: it lists every field with its
// id (`customfield_10042`) beside its human name ("Organization"), so he can
// tell us, once, and the mapping stops being guesswork.
//
//
// ═══ 6. ERRORS ═══
//
// Same convention as admin-members and capture-assist: an English sentence for
// a curl probe and the server log, plus a stable machine `code` the browser
// maps to a `jira.err*` locale key. An old client meeting a new code falls back
// to a generic message rather than rendering the raw token.
//
// ⚠ OUR HTTP STATUS DESCRIBES *OUR* OUTCOME, NOT JIRA'S. Returning 401 because
//   Jira said 401 would tell the browser the *user* is signed out and bounce
//   them to the sign-in screen over a bad Jira token — a genuinely confusing
//   half-hour. Upstream failures therefore come back as 502 with the real
//   upstream status in `jiraStatus`, and only rate-limiting keeps its 429
//   (with `Retry-After`), because that one is actionable and unambiguous.
//
// A MISSING SECRET IS A DIAGNOSIS, NOT A 500: `missing_secret` names exactly
// which variable is unset, in `missing`, with 503. Aziz is going to set these
// himself, alone, against a live site, and the difference between "JIRA_API_TOKEN
// is not set" and "500" is the difference between two minutes and an evening.
//
// NEVER LOG OR RETURN THE TOKEN. No log line in this file interpolates a
// secret, no error body carries a request header, and `scrub()` is a second
// belt over anything that came back from Jira before it is put on the wire.
//
// AND THE RULE THAT MAKES THAT ONE HOLD: NO ERROR PATH EVER QUOTES A VALUE IT
// JUST REJECTED — it names the SHAPE the value should have had instead. This is
// not tidiness. §1 models the operator slip precisely (the `ATATT…` token pasted
// into the JIRA_BASE_URL box); an echo on that branch put the whole Atlassian
// account into a response body readable by every `structure.edit` holder, and
// `scrub()` was powerless because in that scenario the token is not the value of
// JIRA_API_TOKEN. `parseBaseUrl` and the JIRA_EMAIL checks therefore describe
// (`is not a URL. Expected https://your-site.atlassian.net`, `a character
// outside plain ASCII, at position 7`) and never quote. The single exception is
// ordered for and documented at `parseBaseUrl`: a hostname that has already
// passed every shape test may be quoted back, because that quote IS the fix.
//
// Two values a caller supplies about himself are still echoed on purpose —
// `validateFields` quotes the 40 leading characters of a bad field id, and
// `validateJql` reports a length — because those came from the person reading
// the message, in the same request, and are not read from a secret.

import { createClient } from 'npm:@supabase/supabase-js@2'

/* ────────────────────────────── environment ────────────────────────────── */

/**
 * Deno's globals through `globalThis`, the capture-assist idiom
 * (capture-assist/index.ts:88-106).
 *
 * A bare top-level `Deno.env.get(...)` would throw the moment vitest imported
 * this module to run fixtures, before a single test ran. Everything above
 * `handle()` is pure and total, so importing this file outside Deno costs
 * nothing and starts nothing — which is what lets `index.test.ts` test THE
 * DEPLOYED FILE rather than a copy of it.
 */
interface DenoLike {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Promise<Response>): void
}

const DENO: DenoLike | undefined = (globalThis as { Deno?: DenoLike }).Deno

function env(key: string): string {
  return DENO?.env.get(key) ?? ''
}

/* ──────────────────────────── the allow-list ───────────────────────────── */

/**
 * The only two verbs this file can express. There is no 'PUT', no 'DELETE' and
 * no 'PATCH' in this union, so a mutating call is not a thing that can be
 * written here without editing this line — which is a line review will stop at.
 */
export type ReadVerb = 'GET' | 'POST'

export interface JiraEndpoint {
  readonly path: string
  readonly verb: ReadVerb
  /** Set ONLY on the POST entry: why a POST is still a read. */
  readonly postReason?: string
}

/**
 * EVERY JIRA URL THIS FUNCTION CAN EVER REACH. Four entries, frozen, checked at
 * module load. Paths are literals; nothing is concatenated from caller input.
 *
 * Query strings are appended by `jiraCall()` from typed, clamped NUMBERS and
 * from `URLSearchParams`, never from raw caller text.
 */
export const ENDPOINTS = Object.freeze({
  /** Who am I, and does this credential work at all. */
  myself: { path: '/rest/api/3/myself', verb: 'GET' },

  /** Paged project list — still the classic startAt/total/isLast paging. */
  projectSearch: { path: '/rest/api/3/project/search', verb: 'GET' },

  /** Every system and custom field, with ids. Not paged; one flat array. */
  fieldList: { path: '/rest/api/3/field', verb: 'GET' },

  /**
   * ⚠ THE ONE POST, AND IT IS A READ. See header §3. `GET /rest/api/3/search`
   * is deprecated and REMOVED on Jira Cloud (410 Gone); the current endpoint is
   * this one, with the JQL in a JSON body. It creates nothing.
   */
  jqlSearch: {
    path: '/rest/api/3/search/jql',
    verb: 'POST',
    postReason:
      'Jira Cloud replaced GET /rest/api/3/search (now 410 Gone) with a POST that ' +
      'carries the JQL in a JSON body. It reads; it creates nothing.',
  },
} as const satisfies Record<string, JiraEndpoint>)

export type EndpointName = keyof typeof ENDPOINTS

/**
 * Runs at module load AND in the test suite. A bad edit to `ENDPOINTS` kills
 * the isolate on the first request instead of shipping quietly.
 */
export function assertReadOnlyEndpoints(): void {
  for (const [name, ep] of Object.entries(ENDPOINTS) as [EndpointName, JiraEndpoint][]) {
    if (!ep.path.startsWith('/rest/api/3/')) {
      throw new Error(`[jira-read] endpoint ${name} escapes /rest/api/3/: ${ep.path}`)
    }
    if (ep.path.includes('?') || ep.path.includes('..') || ep.path.includes('//')) {
      throw new Error(`[jira-read] endpoint ${name} has a malformed path: ${ep.path}`)
    }
    if (ep.verb !== 'GET' && ep.verb !== 'POST') {
      throw new Error(`[jira-read] endpoint ${name} uses a non-read verb: ${String(ep.verb)}`)
    }
    if (ep.verb === 'POST' && name !== 'jqlSearch') {
      throw new Error(
        `[jira-read] ${name} is a POST but is not the JQL search. The ONLY POST this ` +
          'function may make is /rest/api/3/search/jql — see the header, §3.',
      )
    }
    if (ep.verb === 'POST' && !ep.postReason) {
      throw new Error(`[jira-read] endpoint ${name} is a POST with no stated reason`)
    }
  }
}

assertReadOnlyEndpoints()

/* ──────────────────────────────── bounds ───────────────────────────────── */

/**
 * EVERY READ IS BOUNDED. An unbounded JQL against a real backlog is a
 * multi-megabyte response into a function with a memory limit — and the caller
 * who writes that JQL is not being malicious, he is exploring.
 *
 * SEARCH_MAX_RESULTS is 100 because Jira silently clamps `/search/jql` to about
 * that regardless of what you ask for. Asking for 5000 and receiving 100 while
 * believing you received 5000 is how a harness lies; asking for what you can
 * actually get and reporting `truncated` is how it does not.
 */
export const SEARCH_MAX_RESULTS = 100
export const SEARCH_DEFAULT_RESULTS = 50
/** How many pages ONE call will follow. Total issues <= this * SEARCH_MAX_RESULTS. */
export const SEARCH_MAX_PAGES = 5
/** Hard ceiling on issues returned by one call, whatever the paging says. */
export const SEARCH_MAX_ISSUES = 200
/** Jira's own cap for project/search is 50; asking for more is silently clamped. */
export const PROJECTS_MAX_RESULTS = 50
/** A large instance has a few hundred fields. This is a roof, not a target. */
export const FIELDS_CAP = 600
/** Long enough for a real query, short enough that nobody pastes a file in. */
export const JQL_MAX_LENGTH = 2000
/** Field ids/names asked for per search. */
export const FIELDS_PER_SEARCH = 50
/** An opaque cursor. Bounded so a client cannot post a megabyte of "token". */
export const PAGE_TOKEN_MAX_LENGTH = 4096

/**
 * One request's whole budget against Jira. A hung upstream holding a worker is
 * the failure mode this endpoint is most likely to meet; capture-assist owns an
 * AbortController for the same reason (its header, "WHY RAW fetch").
 */
export const JIRA_TIMEOUT_MS = 20_000

/**
 * What `search` asks for when the caller names no fields.
 *
 * ⚠ THE NEW ENDPOINT DOES NOT RETURN EVERY FIELD BY DEFAULT — this is the
 *   single most common way a migration from the old /search "works" and comes
 *   back empty-looking. Being explicit is not tidiness, it is the contract.
 *   A caller who wants the custom fields names them (that is what the `fields`
 *   operation is FOR), or passes `*all`.
 */
export const DEFAULT_SEARCH_FIELDS: readonly string[] = Object.freeze([
  'summary',
  'status',
  'issuetype',
  'project',
  'priority',
  'resolution',
  'assignee',
  'reporter',
  'labels',
  'parent',
  'created',
  'updated',
])

/* ─────────────────────────────── the wire ──────────────────────────────── */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

/**
 * Every failure this endpoint can return, as a stable machine token.
 *
 * The sibling that owns the screen maps these to `jira.err*` keys in BOTH
 * locale bundles (and to `NAMESPACE_PLACEMENT` in src/lib/labelSections.ts —
 * a locale change is a three-file change). An unknown token must fall back to
 * `common.error`, never render bare.
 */
export type JiraCode =
  // the caller
  | 'not_signed_in'
  | 'forbidden'
  | 'invalid_body'
  | 'unknown_operation'
  | 'invalid_jql'
  | 'invalid_fields'
  | 'invalid_page_token'
  // the configuration — the owner's to fix, and named precisely enough to fix
  | 'missing_secret'
  | 'bad_base_url'
  | 'bad_email'
  // Jira answered, and said no
  | 'jira_unauthorized'
  | 'jira_forbidden'
  | 'jira_not_found'
  | 'jira_gone'
  | 'jira_bad_request'
  | 'jira_rate_limited'
  | 'jira_unavailable'
  | 'jira_bad_response'
  // Jira did not answer
  | 'jira_timeout'
  | 'jira_unreachable'
  // us
  | 'server_error'

export interface JiraFailure {
  error: string
  code: JiraCode
  /** `missing_secret` only: exactly which variables are unset. */
  missing?: string[]
  /** Upstream HTTP status, when Jira answered. Never our own status. */
  jiraStatus?: number
  /** `jira_rate_limited` only, when Jira sent a Retry-After we could read. */
  retryAfterSeconds?: number
  /** Jira's own message, scrubbed and capped. Useful for a JQL syntax error. */
  detail?: string
}

function failure(f: JiraFailure, status: number, extra: Record<string, string> = {}): Response {
  return json(f, status, extra)
}

/* ─────────────────────────────── secrets ───────────────────────────────── */

export const SECRET_NAMES = Object.freeze(['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'])

export interface ParsedBaseUrl {
  /** `https://acme.atlassian.net`, no trailing slash, no path. */
  origin: string
  hostname: string
  /** True for `*.atlassian.net`. A custom domain is allowed but worth showing. */
  atlassianCloud: boolean
}

/**
 * Validate JIRA_BASE_URL's SCHEME AND HOST SHAPE and reduce it to an origin.
 *
 * The value comes from the owner in the dashboard, not from a caller, so this
 * is not an SSRF gate — it is a typo gate, and typos here are expensive: a
 * `http://` base means the token crosses the wire in the clear, and a base with
 * a path on it produces 404s that read like "wrong site".
 *
 * Returning the origin ALSO makes the `external_url` promise in header §5 true
 * by construction: every browse link this file emits starts `https://`, which
 * is what 0023's `map_nodes_external_url_chk` requires.
 *
 * ⚠ NOTHING THAT FAILED VALIDATION IS EVER QUOTED BACK. This function describes
 *   the SHAPE the value should have and never the shape it had. The reason is
 *   the exact operator slip header §1 already models — the `ATATT…` token pasted
 *   into the JIRA_BASE_URL box — which lands in the not-a-URL branch below: an
 *   echo there put the whole Atlassian account into an error body readable by
 *   every `structure.edit` holder, which is a population, not one person, and
 *   `scrub()` cannot help because in that scenario the token is not the value of
 *   JIRA_API_TOKEN. The username/password and `bad_email` branches already made
 *   the no-echo choice; this is the rest of the function catching up.
 *
 *   THE ONE EXCEPTION IS DELIBERATE AND ORDERED FOR: the no-path branch quotes
 *   `https://${host}` — the fix, spelled out — and it runs LAST, after the host
 *   has passed every shape test below, so the only text that can appear there is
 *   a real domain name. That is why the host checks now precede the path check
 *   rather than following it; do not "tidy" them back.
 */
export function parseBaseUrl(raw: string): { ok: true; value: ParsedBaseUrl } | { ok: false; detail: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, detail: 'JIRA_BASE_URL is empty.' }

  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    // ⚠ THE BRANCH A PASTED TOKEN LANDS IN. No `got "…"`, ever.
    return {
      ok: false,
      detail: 'JIRA_BASE_URL is not a URL. Expected https://your-site.atlassian.net',
    }
  }

  if (u.protocol !== 'https:') {
    // `http:` is named because that sentence is a literal in this file and the
    // mistake is worth naming precisely. Any OTHER scheme is described, not
    // quoted: `new URL()` accepts `<anything-without-a-slash>:rest`, so a pasted
    // secret containing a colon would arrive here with its head in `u.protocol`.
    return {
      ok: false,
      detail:
        u.protocol === 'http:'
          ? 'JIRA_BASE_URL must start with https://, not http://. An API token over plain http is a token on the wire in the clear.'
          : 'JIRA_BASE_URL must start with https://. Expected https://your-site.atlassian.net',
    }
  }
  if (u.username || u.password) {
    return {
      ok: false,
      detail: 'JIRA_BASE_URL must not contain a username or password. The credential goes in JIRA_EMAIL and JIRA_API_TOKEN.',
    }
  }
  if (u.search || u.hash) {
    return { ok: false, detail: 'JIRA_BASE_URL must be just the site address — no query string, no #fragment.' }
  }

  const host = u.hostname.toLowerCase()
  if (!host.includes('.') || host.endsWith('.')) {
    return { ok: false, detail: 'JIRA_BASE_URL host is not a domain name. Expected e.g. your-site.atlassian.net.' }
  }
  // An IP literal is never a Jira Cloud site, and is the shape a copy-paste
  // accident takes when someone points this at an internal host.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, detail: 'JIRA_BASE_URL host is not a Jira Cloud site — a bare IP address or localhost never is.' }
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return { ok: false, detail: 'JIRA_BASE_URL host is not a valid hostname. Expected e.g. your-site.atlassian.net.' }
  }

  // LAST, so `host` has already proven itself a domain name (see the ⚠ above).
  if (u.pathname !== '' && u.pathname !== '/') {
    return {
      ok: false,
      detail: `JIRA_BASE_URL must be just the site address, with no path after it. Use https://${host} — this function appends /rest/api/3/... itself.`,
    }
  }

  return {
    ok: true,
    value: { origin: `https://${host}`, hostname: host, atlassianCloud: host.endsWith('.atlassian.net') },
  }
}

/** Loose on purpose: this is a typo check, not an RFC 5322 implementation. */
export function looksLikeEmail(raw: string): boolean {
  const s = raw.trim()
  return s.length >= 3 && s.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(s)
}

/**
 * 1-based position of the first character outside printable ASCII, or 0 for a
 * clean string.
 *
 * ⚠ WHY THIS EXISTS, AND WHY IT REFUSES RATHER THAN COPES. `looksLikeEmail` is
 *   deliberately loose (`[^\s@]+`), which accepts a Unicode local part — an
 *   Arabic-script address passes it, and this app ships an Arabic locale, so
 *   that operator exists. The value then goes into `basicAuthHeader`, and the
 *   pair after it goes on the wire as HTTP Basic.
 *
 *   Two ways to fix that, and the choice matters:
 *
 *     (a) ENCODE IT — base64 the UTF-8 bytes and send them. Legal per RFC 7617
 *         only if the server reads the credential as UTF-8; Atlassian documents
 *         no charset for Basic, so this is a guess that comes back as a 401
 *         reading "Jira rejected the credential" — pointing the owner at his
 *         token, which is fine, over an email he cannot see is wrong.
 *     (b) REFUSE IT BY NAME. An Atlassian account email is plain ASCII; a
 *         character above U+007E in that box is a paste that brought a lookalike
 *         with it (a Cyrillic а, a smart quote, an NBSP). Naming that is a
 *         two-minute fix. Naming the token instead is an evening.
 *
 *   We refuse — (b) — and `basicAuthHeader` is ALSO made total, so the refusal
 *   is the behaviour and the encoder can never be the thing that decides.
 *
 *   THE POSITION, NOT THE CHARACTER. Same rule as `parseBaseUrl`: an index is a
 *   shape, a character is a value.
 */
export function firstNonAsciiPosition(s: string): number {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) return i + 1
  }
  return 0
}

export interface JiraCredential {
  base: ParsedBaseUrl
  email: string
  token: string
}

export type SecretResult =
  | { ok: true; value: JiraCredential }
  | { ok: false; failure: JiraFailure; status: number }

/**
 * The three secrets, or the precise reason there are not three secrets.
 *
 * Pure — it takes the raw strings rather than reading the environment — so the
 * test suite can drive every branch without a Deno global.
 *
 * ALL THREE ARE CHECKED BEFORE ANY IS REPORTED. Naming one missing variable,
 * watching the owner set it, and then naming the next is three round trips to
 * the dashboard for a problem that could have been one.
 */
export function readCredential(raw: {
  baseUrl: string
  email: string
  token: string
}): SecretResult {
  const missing: string[] = []
  if (!raw.baseUrl.trim()) missing.push('JIRA_BASE_URL')
  if (!raw.email.trim()) missing.push('JIRA_EMAIL')
  if (!raw.token.trim()) missing.push('JIRA_API_TOKEN')
  if (missing.length > 0) {
    return {
      ok: false,
      status: 503,
      failure: {
        code: 'missing_secret',
        missing,
        error:
          missing.length === 1
            ? `${missing[0]} is not set on this project. Set it in Supabase → Edge Functions → jira-read → Secrets, then try again.`
            : `${missing.join(', ')} are not set on this project. Set them in Supabase → Edge Functions → jira-read → Secrets, then try again.`,
      },
    }
  }

  const base = parseBaseUrl(raw.baseUrl)
  if (!base.ok) {
    return { ok: false, status: 503, failure: { code: 'bad_base_url', error: base.detail } }
  }

  const email = raw.email.trim()
  // BEFORE the shape check, because it is the more specific diagnosis: a value
  // that is both non-ASCII and not-an-email is a paste slip first and a typo
  // second, and "there is an invisible character at position 7" is the sentence
  // that ends the search. Same `bad_email` code — the browser's `jira.err*` map
  // is a sibling's file and this is not a new failure mode, only a named one.
  const nonAscii = firstNonAsciiPosition(email)
  if (nonAscii > 0) {
    return {
      ok: false,
      status: 503,
      failure: {
        code: 'bad_email',
        error: `JIRA_EMAIL contains a character outside plain ASCII, at position ${nonAscii}. An Atlassian account email has none — this is usually a paste that carried a lookalike letter, a smart quote or a non-breaking space with it. Retype the address by hand.`,
      },
    }
  }
  if (!looksLikeEmail(email)) {
    return {
      ok: false,
      status: 503,
      failure: {
        code: 'bad_email',
        error: 'JIRA_EMAIL does not look like an email address. Jira Cloud Basic auth is your Atlassian account email plus an API token — not a username.',
      },
    }
  }

  // NOT trimmed blindly: an Atlassian token has no leading or trailing space,
  // but a paste out of the dashboard often does, and a token with a stray
  // newline fails as 401 "the credential was rejected" — which sends the owner
  // off to mint a second token that will fail the same way.
  return { ok: true, value: { base: base.value, email, token: raw.token.trim() } }
}

/**
 * HTTP Basic, which is the whole Jira Cloud API-token contract — there is no
 * bearer form for an API token, and sending one produces a 401 that reads like
 * a bad token.
 *
 * The return value is a secret. It is passed straight into `jiraCall`'s header
 * object and is never logged, never returned, and never stored.
 *
 * ⚠ TOTAL BY CONSTRUCTION. A bare `btoa(...)` throws `InvalidCharacterError` on
 *   any code point above U+00FF, and this function is called from `jiraCall`
 *   FOUR LINES ABOVE ITS try BLOCK — so that throw escaped to `handle()`'s
 *   catch-all and every operation, `ping` included, answered a generic 500
 *   "Something went wrong reading from Jira" for a credential Jira was never
 *   asked about. That is precisely the misdiagnosis header §6 promises never to
 *   give ("A MISSING SECRET IS A DIAGNOSIS, NOT A 500").
 *
 *   `readCredential` now refuses a non-ASCII JIRA_EMAIL by name, so this branch
 *   should be unreachable — which is exactly why it is written to be total
 *   anyway: encoding UTF-8 bytes first means every char handed to `btoa` is a
 *   BYTE (<= 0xFF), so there is no input to this function that can throw, and no
 *   future caller can reintroduce the 500 by skipping the validator. For ASCII
 *   input — every real credential — the output is byte-identical to before.
 */
export function basicAuthHeader(email: string, token: string): string {
  const bytes = new TextEncoder().encode(`${email}:${token}`)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return `Basic ${btoa(binary)}`
}

/**
 * Second belt: remove any secret that somehow reached a string bound for the
 * wire or the log. Nothing in this file deliberately puts one there, which is
 * exactly why this exists — the failure this guards against is the one nobody
 * meant to write.
 */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join('[redacted]')
  }
  return out
}

/* ───────────────────────────── caller input ────────────────────────────── */

export type Operation = 'ping' | 'projects' | 'search' | 'fields'

export interface RequestBody {
  op?: string
  jql?: unknown
  maxResults?: unknown
  fields?: unknown
  nextPageToken?: unknown
  /** `projects` only: the classic offset paging Jira still uses there. */
  startAt?: unknown
  /** `fields` only: return just the custom fields. */
  customOnly?: unknown
}

export function isOperation(v: unknown): v is Operation {
  return v === 'ping' || v === 'projects' || v === 'search' || v === 'fields'
}

/** Clamp to [1, cap], defaulting a missing or nonsense value rather than failing. */
export function clampCount(v: unknown, fallback: number, cap: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(cap, Math.max(1, Math.floor(n)))
}

export function clampOffset(v: unknown, cap: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return 0
  return Math.min(cap, Math.max(0, Math.floor(n)))
}

/**
 * The JQL is the one place a caller's text reaches Jira, and it reaches it as a
 * VALUE in a JSON body — not spliced into a URL, not into a shell, not into
 * SQL. So this is a size-and-sanity check, not an escaping problem: Jira parses
 * its own query language and answers 400 for a bad one, which `search` relays
 * verbatim in `detail` because a JQL syntax error is exactly what the person
 * typing needs to read.
 */
export function validateJql(v: unknown): { ok: true; value: string } | { ok: false; detail: string } {
  if (typeof v !== 'string') return { ok: false, detail: 'jql must be a string.' }
  const s = v.trim()
  if (!s) return { ok: false, detail: 'Type a JQL query first — for example: project = OPS ORDER BY updated DESC' }
  if (s.length > JQL_MAX_LENGTH) {
    return { ok: false, detail: `That JQL is ${s.length} characters; the limit is ${JQL_MAX_LENGTH}.` }
  }
  // Control characters cannot appear in a JQL anyone meant to write, and are
  // how a pasted spreadsheet cell arrives. Tab, LF and CR are deliberately NOT
  // in this class — a JQL pasted out of an editor is often several lines. The
  // range is spelled with \u escapes rather than literal bytes so this source
  // file stays plain text instead of something grep reports as binary.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s)) {
    return { ok: false, detail: 'That JQL contains control characters. Paste it as plain text.' }
  }
  return { ok: true, value: s }
}

/**
 * Field ids and names for `search`. `customfield_10042`, `summary`, and Jira's
 * own wildcards `*all` / `*navigable` are all legal here; a URL, a quote or a
 * brace is not.
 */
export function validateFields(
  v: unknown,
): { ok: true; value: string[] } | { ok: false; detail: string } {
  if (v === undefined || v === null) return { ok: true, value: [...DEFAULT_SEARCH_FIELDS] }
  if (!Array.isArray(v)) return { ok: false, detail: 'fields must be an array of field ids.' }
  if (v.length === 0) return { ok: true, value: [...DEFAULT_SEARCH_FIELDS] }
  if (v.length > FIELDS_PER_SEARCH) {
    return { ok: false, detail: `Ask for at most ${FIELDS_PER_SEARCH} fields at a time (asked for ${v.length}).` }
  }
  const out: string[] = []
  for (const raw of v) {
    if (typeof raw !== 'string') return { ok: false, detail: 'Every entry in fields must be a string.' }
    const s = raw.trim()
    if (!/^\*?[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/.test(s)) {
      return { ok: false, detail: `"${s.slice(0, 40)}" is not a field id. Use an id like customfield_10042, a name like summary, or *all.` }
    }
    if (!out.includes(s)) out.push(s)
  }
  return { ok: true, value: out }
}

/** The cursor is OPAQUE — bound its size and reject control characters, nothing more. */
export function validatePageToken(
  v: unknown,
): { ok: true; value: string | undefined } | { ok: false; detail: string } {
  if (v === undefined || v === null || v === '') return { ok: true, value: undefined }
  if (typeof v !== 'string') return { ok: false, detail: 'nextPageToken must be a string.' }
  if (v.length > PAGE_TOKEN_MAX_LENGTH) return { ok: false, detail: 'nextPageToken is too long.' }
  // Nothing else is asserted about the shape: the cursor is Atlassian's to
  // define and it has already changed once.
  if (/[\u0000-\u001F\u007F]/.test(v)) return { ok: false, detail: 'nextPageToken is malformed.' }
  return { ok: true, value: v }
}

/* ──────────────────────── the one call to Jira ─────────────────────────── */

export interface JiraCallOk {
  ok: true
  status: number
  data: unknown
}
export interface JiraCallErr {
  ok: false
  failure: JiraFailure
  status: number
  headers?: Record<string, string>
}
export type JiraCallResult = JiraCallOk | JiraCallErr

/**
 * Read `Retry-After`, which is either a count of seconds or an HTTP-date. Only
 * the integer form is honoured; a date is left to the caller's own backoff
 * rather than turned into a clock-skew bug.
 */
export function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw) return undefined
  const n = Number(raw.trim())
  if (Number.isFinite(n) && n >= 0 && n <= 86_400) return Math.ceil(n)
  return undefined
}

/**
 * Turn Jira's status into something a person can act on.
 *
 * These four sentences are the whole reason the `ping` button exists: they are
 * what distinguishes "wrong token" from "wrong URL" from "the account cannot
 * see that project", and each of those has a different two-minute fix.
 */
export function mapJiraStatus(
  status: number,
  opts: { retryAfterSeconds?: number; detail?: string } = {},
): { failure: JiraFailure; status: number; headers?: Record<string, string> } {
  const base = { jiraStatus: status, detail: opts.detail }
  switch (status) {
    case 401:
      return {
        status: 502,
        failure: {
          ...base,
          code: 'jira_unauthorized',
          error:
            'Jira rejected the credential. Check JIRA_EMAIL is the Atlassian account email and that JIRA_API_TOKEN is a current, unrevoked API token (not a password, and not an OAuth token).',
        },
      }
    case 403:
      return {
        status: 502,
        failure: {
          ...base,
          code: 'jira_forbidden',
          error:
            'The credential is valid but that account cannot see this. Give the Atlassian account Browse Projects permission on the project you are querying.',
        },
      }
    case 404:
      return {
        status: 502,
        failure: {
          ...base,
          code: 'jira_not_found',
          error:
            'Jira has no such site or endpoint. Check JIRA_BASE_URL is exactly your site address, e.g. https://your-site.atlassian.net with nothing after it.',
        },
      }
    case 410:
      return {
        status: 502,
        failure: {
          ...base,
          code: 'jira_gone',
          error:
            'Jira says that endpoint has been removed. This build calls POST /rest/api/3/search/jql, the current search endpoint; if this appears, the API moved again and jira-read needs updating.',
        },
      }
    case 400:
      return {
        status: 502,
        failure: {
          ...base,
          code: 'jira_bad_request',
          error: 'Jira rejected the request — usually the JQL. Its own message is below.',
        },
      }
    case 429:
      return {
        status: 429,
        headers: opts.retryAfterSeconds ? { 'Retry-After': String(opts.retryAfterSeconds) } : undefined,
        failure: {
          ...base,
          code: 'jira_rate_limited',
          retryAfterSeconds: opts.retryAfterSeconds,
          error: opts.retryAfterSeconds
            ? `Jira is rate-limiting this account. Retry in ${opts.retryAfterSeconds} seconds.`
            : 'Jira is rate-limiting this account. Wait a minute and retry.',
        },
      }
    default:
      return {
        status: 502,
        failure: {
          ...base,
          code: 'jira_unavailable',
          error: `Jira answered ${status}. That is Jira's side, not this project's — retry shortly, and check status.atlassian.com if it persists.`,
        },
      }
  }
}

/** Jira's error bodies carry `errorMessages: string[]` and/or `errors: {}`. Cap and scrub. */
export function summarizeJiraError(body: unknown, secrets: readonly string[]): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as { errorMessages?: unknown; errors?: unknown; message?: unknown }
  const parts: string[] = []
  if (Array.isArray(b.errorMessages)) {
    for (const m of b.errorMessages.slice(0, 3)) if (typeof m === 'string') parts.push(m)
  }
  if (b.errors && typeof b.errors === 'object') {
    for (const [k, v] of Object.entries(b.errors as Record<string, unknown>).slice(0, 3)) {
      if (typeof v === 'string') parts.push(`${k}: ${v}`)
    }
  }
  if (parts.length === 0 && typeof b.message === 'string') parts.push(b.message)
  if (parts.length === 0) return undefined
  return scrub(parts.join(' · '), secrets).slice(0, 500)
}

/**
 * ══ THE ONLY PLACE THIS FILE CALLS fetch() AGAINST JIRA. ══
 *
 * It takes an endpoint NAME, not a URL. The verb comes out of the frozen
 * allow-list, not from an argument, so there is no expression a caller — or a
 * future careless edit inside this file — can write that reaches Jira with
 * PUT, PATCH or DELETE. `body` is accepted only for the entry whose verb is
 * POST, and passing one for a GET entry is a programmer error that throws.
 *
 * A `Response` body is read exactly once, as text, then parsed — so a Jira
 * error page (HTML, at the wrong URL) becomes a legible failure rather than an
 * unhandled JSON parse.
 */
async function jiraCall(
  cred: JiraCredential,
  name: EndpointName,
  opts: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<JiraCallResult> {
  const ep: JiraEndpoint = ENDPOINTS[name]
  if (opts.body && ep.verb !== 'POST') {
    throw new Error(`[jira-read] refusing to send a body to the GET endpoint ${name}`)
  }

  const url = new URL(cred.base.origin + ep.path)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)

  const secrets = [cred.token, basicAuthHeader(cred.email, cred.token)]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JIRA_TIMEOUT_MS)

  try {
    const res = await fetch(url.toString(), {
      // ⚠ FROM THE ALLOW-LIST, NEVER FROM AN ARGUMENT. See header §3.
      method: ep.verb,
      headers: {
        Authorization: basicAuthHeader(cred.email, cred.token),
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })

    const text = await res.text()
    let parsed: unknown = undefined
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      parsed = undefined
    }

    if (!res.ok) {
      // The log line carries the operation and the status. Never the header,
      // never the token, never the response body — a Jira error body can echo
      // request context back.
      console.error(`[jira-read] ${name} -> HTTP ${res.status}`)
      const mapped = mapJiraStatus(res.status, {
        retryAfterSeconds: parseRetryAfter(res.headers.get('Retry-After')),
        detail: summarizeJiraError(parsed, secrets),
      })
      return { ok: false, failure: mapped.failure, status: mapped.status, headers: mapped.headers }
    }

    if (parsed === undefined) {
      console.error(`[jira-read] ${name} -> 200 with a non-JSON body`)
      return {
        ok: false,
        status: 502,
        failure: {
          code: 'jira_bad_response',
          jiraStatus: res.status,
          error:
            'Jira answered with something that is not JSON. That usually means JIRA_BASE_URL points at a web page rather than at a Jira Cloud site.',
        },
      }
    }

    return { ok: true, status: res.status, data: parsed }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    console.error(`[jira-read] ${name} -> ${aborted ? 'timeout' : 'network failure'}`)
    return aborted
      ? {
          ok: false,
          status: 504,
          failure: {
            code: 'jira_timeout',
            error: `Jira did not answer within ${Math.round(JIRA_TIMEOUT_MS / 1000)} seconds. Narrow the JQL, or retry.`,
          },
        }
      : {
          ok: false,
          status: 502,
          failure: {
            code: 'jira_unreachable',
            error:
              'Could not reach Jira at all. Check JIRA_BASE_URL resolves, and that the site is not behind an IP allow-list that excludes Supabase.',
          },
        }
  } finally {
    clearTimeout(timer)
  }
}

/* ───────────────────────────── normalisers ─────────────────────────────── */

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/**
 * `https://site.atlassian.net/browse/OPS-12`.
 *
 * https by construction — `parseBaseUrl` refuses anything else — which is what
 * makes this value legal for `external_url` under 0023's
 * `check (external_url is null or external_url ~* '^https?://')`. The key is
 * percent-encoded even though a Jira key is `[A-Z][A-Z0-9]*-\d+`, because "the
 * upstream will only ever send well-formed values" is not a property this file
 * can hold still.
 */
export function issueUrl(origin: string, key: string): string {
  return `${origin}/browse/${encodeURIComponent(key)}`
}

export interface JiraIssueOut {
  id: string | null
  key: string | null
  url: string | null
  fields: Record<string, unknown>
}

export function normalizeIssue(raw: unknown, origin: string): JiraIssueOut {
  const r = obj(raw)
  const key = str(r.key)
  return {
    id: str(r.id),
    key,
    url: key ? issueUrl(origin, key) : null,
    // Passed through UNINTERPRETED, and that is the point: this is a harness
    // for seeing what Jira actually sends, and a normaliser that decided which
    // fields matter would hide exactly the custom field we are hunting for.
    fields: obj(r.fields),
  }
}

export interface JiraProjectOut {
  id: string | null
  key: string | null
  name: string | null
  projectTypeKey: string | null
  simplified: boolean | null
  url: string | null
}

export function normalizeProject(raw: unknown, origin: string): JiraProjectOut {
  const r = obj(raw)
  const key = str(r.key)
  return {
    id: str(r.id),
    key,
    name: str(r.name),
    projectTypeKey: str(r.projectTypeKey),
    simplified: typeof r.simplified === 'boolean' ? r.simplified : null,
    url: key ? `${origin}/browse/${encodeURIComponent(key)}` : null,
  }
}

export interface JiraFieldOut {
  id: string | null
  key: string | null
  name: string | null
  custom: boolean
  /** `string` | `option` | `array` | `user` … — what a mapping has to cope with. */
  schemaType: string | null
  /** e.g. `com.atlassian.jira.plugin.system.customfieldtypes:select`. */
  customType: string | null
  /** What this field is called INSIDE a JQL, which is not always its name. */
  clauseNames: string[]
}

export function normalizeField(raw: unknown): JiraFieldOut {
  const r = obj(raw)
  const schema = obj(r.schema)
  return {
    id: str(r.id),
    key: str(r.key),
    name: str(r.name),
    custom: r.custom === true,
    schemaType: str(schema.type),
    customType: str(schema.custom),
    clauseNames: Array.isArray(r.clauseNames)
      ? r.clauseNames.filter((c): c is string => typeof c === 'string').slice(0, 8)
      : [],
  }
}

/* ─────────────────────────── the four operations ───────────────────────── */

async function opPing(cred: JiraCredential): Promise<Response> {
  const res = await jiraCall(cred, 'myself')
  if (!res.ok) return failure(res.failure, res.status, res.headers)
  const me = obj(res.data)
  return json({
    ok: true,
    op: 'ping',
    site: {
      baseUrl: cred.base.origin,
      hostname: cred.base.hostname,
      atlassianCloud: cred.base.atlassianCloud,
    },
    // The email here is JIRA's copy of the account's address, which is a fact
    // the owner needs to confirm he pointed this at the right account. It is
    // not a secret and it is not the token; Jira omits it entirely when the
    // account's profile visibility hides it, hence the null.
    account: {
      accountId: str(me.accountId),
      displayName: str(me.displayName),
      emailAddress: str(me.emailAddress),
      accountType: str(me.accountType),
      active: me.active === true,
      timeZone: str(me.timeZone),
      locale: str(me.locale),
    },
  })
}

async function opProjects(cred: JiraCredential, body: RequestBody): Promise<Response> {
  const startAt = clampOffset(body.startAt, 5000)
  const maxResults = clampCount(body.maxResults, PROJECTS_MAX_RESULTS, PROJECTS_MAX_RESULTS)
  // project/search kept the CLASSIC paging — startAt / total / isLast. Only the
  // JQL search moved to token paging. Do not "make these consistent".
  const res = await jiraCall(cred, 'projectSearch', {
    query: { startAt: String(startAt), maxResults: String(maxResults), orderBy: 'key' },
  })
  if (!res.ok) return failure(res.failure, res.status, res.headers)

  const page = obj(res.data)
  const values = Array.isArray(page.values) ? page.values : []
  return json({
    ok: true,
    op: 'projects',
    projects: values.map((v) => normalizeProject(v, cred.base.origin)),
    startAt,
    maxResults,
    total: typeof page.total === 'number' ? page.total : null,
    isLast: page.isLast === true || values.length < maxResults,
  })
}

export interface FieldSelection {
  fields: JiraFieldOut[]
  /** Fields that matched BEFORE the cap — what `truncated` is measured against. */
  matched: number
  truncated: boolean
}

/**
 * Filter, ORDER, then cap. Pure, and exported so the order is a thing CI checks
 * rather than a thing a reader has to notice.
 *
 * Custom-first then by name: the custom fields are what this operation exists to
 * surface (header §5), so they must not be buried under sixty system fields the
 * owner already knows.
 *
 * ⚠ THE SORT COMES BEFORE THE CAP, AND THAT ORDER IS THE WHOLE POINT. Capping
 *   first caps along JIRA'S OWN WIRE ORDER, which is unspecified — on a site
 *   with more than `cap` fields whose customs happen to sit late in that array,
 *   EVERY custom field is dropped while the response still looks complete and
 *   custom-first. The only tell was `customCount: 0`, on the one operation whose
 *   entire reason to exist (README §6) is finding two custom field ids. Sorting
 *   first means the cap can only ever fall on system fields.
 */
export function selectFields(
  all: readonly JiraFieldOut[],
  opts: { customOnly?: boolean; cap?: number } = {},
): FieldSelection {
  const cap = opts.cap ?? FIELDS_CAP
  const matching = opts.customOnly === true ? all.filter((f) => f.custom) : [...all]

  matching.sort((a, b) => {
    if (a.custom !== b.custom) return a.custom ? -1 : 1
    return (a.name ?? '').localeCompare(b.name ?? '')
  })

  const truncated = matching.length > cap
  return { fields: truncated ? matching.slice(0, cap) : matching, matched: matching.length, truncated }
}

async function opFields(cred: JiraCredential, body: RequestBody): Promise<Response> {
  const res = await jiraCall(cred, 'fieldList')
  if (!res.ok) return failure(res.failure, res.status, res.headers)

  const all = Array.isArray(res.data) ? res.data : []
  const { fields, truncated } = selectFields(all.map(normalizeField), {
    customOnly: body.customOnly === true,
  })

  return json({
    ok: true,
    op: 'fields',
    fields,
    returned: fields.length,
    totalOnSite: all.length,
    customCount: fields.filter((f) => f.custom).length,
    truncated,
  })
}

/**
 * Reads ONE page of the JQL search. Injected into `collectSearchPages` so the
 * paging rules below can be driven by fixtures instead of by a live Jira — the
 * test suite's own header used to say this loop was "UNPROVEN except by
 * reading", and a differential review then found an issue-losing boundary in it
 * that no test could have seen. It is a callback, not a fetch: the one `fetch`
 * in this file stays inside `jiraCall`, where the allow-list is.
 */
export type PageReader = (args: {
  token: string | undefined
  maxResults: number
}) => Promise<JiraCallResult>

export interface SearchCollection {
  /** RAW issue objects, in page order. Normalising is the caller's job. */
  issues: unknown[]
  pages: number
  /** Where a resume must start. `undefined` means "there is nothing after this". */
  nextPageToken: string | undefined
  truncated: boolean
}

/**
 * Follow the cursor until the budget runs out, WITHOUT EVER READING AN ISSUE IT
 * DOES NOT RETURN.
 *
 * ⚠ THAT INVARIANT IS THE FIX, AND IT IS WHY THE ASK IS CLAMPED. The loop used
 *   to request a full page, keep what fitted under SEARCH_MAX_ISSUES, drop the
 *   rest — and then hand back the cursor pointing PAST the page it had only
 *   half-read. Those dropped issues were returned by no call, ever: `truncated:
 *   true` said "there is more" while the cursor said "resume after the part you
 *   skipped". It did not even need a short page — maxResults=70 against a 200
 *   cap crosses mid-page with perfectly full ones (200 is not a multiple of 70).
 *
 *   So the remaining budget is computed BEFORE the request and the ask is
 *   clamped to it. Jira treats `maxResults` as a CEILING — permission filtering
 *   shortens pages, nothing lengthens them — so a clamped ask means the cursor
 *   that comes back always points exactly one issue past the last one kept.
 *   Every exit from this loop therefore satisfies: everything before
 *   `nextPageToken` is either in `issues` or was never fetched.
 */
export async function collectSearchPages(
  readPage: PageReader,
  opts: { startToken?: string; maxResults: number; maxIssues?: number; maxPages?: number },
): Promise<{ ok: true; value: SearchCollection } | { ok: false; err: JiraCallErr }> {
  const maxIssues = opts.maxIssues ?? SEARCH_MAX_ISSUES
  const maxPages = opts.maxPages ?? SEARCH_MAX_PAGES

  const issues: unknown[] = []
  let token: string | undefined = opts.startToken
  let pages = 0
  let truncated = false

  while (pages < maxPages) {
    // THE BUDGET IS SPENT BEFORE THE PAGE IS ASKED FOR, NOT AFTER IT ARRIVES.
    const remaining = maxIssues - issues.length
    if (remaining <= 0) {
      // Budget spent with a cursor still in hand. `token` is the honest resume
      // point and the final `truncated` assignment below catches it.
      break
    }
    const want = Math.min(opts.maxResults, remaining)

    // The cursor that FETCHED this page, kept for the overshoot branch below.
    const pageToken: string | undefined = token

    // ⚠ THE CURRENT CONTRACT: POST, JSON body, cursor paging by an OPAQUE
    //   `nextPageToken`. There is no `startAt` and no `total` on this endpoint
    //   any more — code written from memory of the v2 API sends `startAt`,
    //   receives page one forever, and looks like it works. The response is
    //   `{ issues, nextPageToken?, isLast? }`, and BOTH pagination keys are
    //   optional in practice: the absence of `nextPageToken` is the reliable
    //   end-of-results signal, `isLast` is a bonus when present.
    const res = await readPage({ token: pageToken, maxResults: want })
    if (!res.ok) return { ok: false, err: res }
    pages += 1

    const page = obj(res.data)
    const got = Array.isArray(page.issues) ? page.issues : []
    const kept = got.slice(0, remaining)
    for (const raw of kept) issues.push(raw)

    const next = typeof page.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined
    // A server that returns the SAME cursor twice would otherwise spin until
    // the page budget runs out. Cheap to check, and it turns a mystery into a
    // clean `truncated: true`.
    const stalled = next !== undefined && next === pageToken

    if (got.length > kept.length) {
      // Jira sent MORE than it was asked for — a contract violation, and the
      // only remaining way the cap can cross mid-page. The tail of THIS page is
      // unread, so the cursor that must go back to the caller is the one that
      // FETCHED it, never `next`: resuming from `next` is exactly the silent
      // loss this branch exists to make impossible. Re-reading a page the
      // caller already holds is a duplicate, which is visible and de-dupable by
      // issue key; a skipped issue is neither.
      truncated = true
      token = pageToken
      break
    }

    token = next
    if (page.isLast === true || next === undefined || stalled) {
      if (stalled) truncated = true
      if (page.isLast === true || next === undefined) token = undefined
      break
    }
  }

  // Budget spent with a cursor still in hand: there IS more, and saying so is
  // the difference between a bounded read and a lie about the backlog size.
  if (token !== undefined) truncated = true

  return { ok: true, value: { issues, pages, nextPageToken: token, truncated } }
}

async function opSearch(cred: JiraCredential, body: RequestBody): Promise<Response> {
  const jql = validateJql(body.jql)
  if (!jql.ok) return failure({ code: 'invalid_jql', error: jql.detail }, 400)

  const fields = validateFields(body.fields)
  if (!fields.ok) return failure({ code: 'invalid_fields', error: fields.detail }, 400)

  const startToken = validatePageToken(body.nextPageToken)
  if (!startToken.ok) return failure({ code: 'invalid_page_token', error: startToken.detail }, 400)

  const maxResults = clampCount(body.maxResults, SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)

  const collected = await collectSearchPages(
    ({ token, maxResults: want }) =>
      jiraCall(cred, 'jqlSearch', {
        body: {
          jql: jql.value,
          maxResults: want,
          fields: fields.value,
          ...(token ? { nextPageToken: token } : {}),
        },
      }),
    { startToken: startToken.value, maxResults },
  )
  if (!collected.ok) {
    return failure(collected.err.failure, collected.err.status, collected.err.headers)
  }
  const { issues: raw, pages, nextPageToken, truncated } = collected.value
  const issues = raw.map((r) => normalizeIssue(r, cred.base.origin))

  return json({
    ok: true,
    op: 'search',
    jql: jql.value,
    fields: fields.value,
    issues,
    count: issues.length,
    pages,
    maxResults,
    // Hand the cursor back so the screen can offer "load more" WITHOUT this
    // function ever following an unbounded number of pages in one request.
    //
    // ⚠ THE CURSOR IS A RESUME POINT AND NOTHING BETWEEN IT AND THE LAST ISSUE
    //   IN `issues` HAS BEEN READ. That is now true on every exit from the loop
    //   above, which is what makes "load more" honest rather than a way to skip
    //   a page. `truncated: true` with a null cursor is the one degenerate case
    //   (an overshooting first page): it means "there is more and I cannot tell
    //   you where to resume" — re-run the query rather than assume completeness.
    nextPageToken: nextPageToken ?? null,
    truncated,
    limits: {
      maxIssuesPerCall: SEARCH_MAX_ISSUES,
      maxPagesPerCall: SEARCH_MAX_PAGES,
      maxResultsPerPage: SEARCH_MAX_RESULTS,
    },
    // Said out loud in every successful response, because this is the promise
    // the whole unit exists to keep and it should be visible in a curl probe.
    wrote: false,
  })
}

/* ─────────────────────────────── the handler ───────────────────────────── */

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return failure({ code: 'invalid_body', error: 'Method not allowed' }, 405)
  }

  // 1. Identify the caller from their JWT, through the anon client.
  //
  // ⚠ AUTHENTICATION COMES BEFORE THE SECRET CHECK, AND THE ORDER IS THE POINT.
  //   The obvious arrangement — read the secrets first, so a never-configured
  //   project answers instantly — leaks configuration to anyone who can reach
  //   this function at all. `verify_jwt` is ON at the gateway, but the ANON KEY
  //   satisfies that gate and the anon key ships in every browser bundle
  //   (send-push's header says so in as many words). So "secrets first" means
  //   any stranger holding the public key learns which of the three Jira
  //   variables are set and whether the configured ones are well-formed — a map
  //   of this project's configuration, handed to anyone who asks.
  //
  //   ⚠ THIS USED TO BE WORSE, AND THE REPAIR BELONGS IN THE OTHER FILE. When
  //     `bad_base_url` still echoed the value it rejected, "secrets first" also
  //     meant a pasted TOKEN came back to an UNAUTHENTICATED caller. That echo
  //     is gone (see `parseBaseUrl`), and this ordering is what remains: two
  //     independent defences for one slip, and neither is now load-bearing
  //     alone. Do not relax either on the strength of the other.
  //
  //   The cost of this order is one extra round trip before a `missing_secret`
  //   answer, paid only by a caller who is signed in and authorized — which is
  //   Aziz at the dashboard, who sees the same named sentence either way.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return failure({ code: 'not_signed_in', error: 'Not signed in' }, 401)
  const anonClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
  })
  const { data: caller, error: callerErr } = await anonClient.auth.getUser(token)
  if (callerErr || !caller?.user?.id) {
    return failure({ code: 'not_signed_in', error: 'Not signed in' }, 401)
  }

  // 2. THE REAL AUTHORITY CHECK, re-done here because the client's is cosmetic.
  //
  //    Asked AS THE CALLER: `has_perm` (0025) is SECURITY DEFINER and reads
  //    `auth.uid()`, so a client carrying the caller's JWT is exactly the right
  //    way to ask it — and it means this function needs no elevated key to
  //    answer an authorization question. `structure.edit` is the key that
  //    already gates `map_nodes` writes; `workspace.admin` is the floor.
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const [structure, admin] = await Promise.all([
    userClient.rpc('has_perm', { p_key: 'structure.edit' }),
    userClient.rpc('has_perm', { p_key: 'workspace.admin' }),
  ])
  if (structure.error || admin.error) {
    console.error('[jira-read] has_perm failed:', (structure.error ?? admin.error)?.message)
    return failure(
      { code: 'server_error', error: 'Could not verify your permissions. Try again in a moment.' },
      500,
    )
  }
  if (structure.data !== true && admin.data !== true) {
    return failure(
      {
        code: 'forbidden',
        error: 'You need the structure.edit permission to read from Jira.',
      },
      403,
    )
  }

  // 3. THE SECRETS, FAIL-CLOSED — capture-assist's idiom, moved behind the gate
  //    above for the reason stated at §1. A project whose secrets were never set
  //    still answers by NAME rather than with a 500, which is the state this
  //    feature is most likely to be in on its first run; it just answers that
  //    way only to someone entitled to the answer.
  const cred = readCredential({
    baseUrl: env('JIRA_BASE_URL'),
    email: env('JIRA_EMAIL'),
    token: env('JIRA_API_TOKEN'),
  })
  if (!cred.ok) {
    // The NAME of the unset variable is safe to log; there is no value to leak.
    console.error(`[jira-read] not configured: ${cred.failure.code}`)
    return failure(cred.failure, cred.status)
  }

  // 4. The caller's own input.
  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return failure({ code: 'invalid_body', error: 'Invalid request body' }, 400)
  }
  if (!isOperation(body.op)) {
    return failure(
      {
        code: 'unknown_operation',
        error: `Unknown operation. This function supports: ping, projects, search, fields.`,
      },
      400,
    )
  }

  // 5. Operation -> endpoint, through an explicit switch. THIS is what keeps
  //    the allow-list from being decoration: no caller string is ever used to
  //    index ENDPOINTS, so the set of URLs reachable from outside is exactly
  //    the four written above.
  try {
    switch (body.op) {
      case 'ping':
        return await opPing(cred.value)
      case 'projects':
        return await opProjects(cred.value, body)
      case 'fields':
        return await opFields(cred.value, body)
      case 'search':
        return await opSearch(cred.value, body)
    }
  } catch (e) {
    // Scrubbed even though nothing here interpolates a secret into a thrown
    // error. The message that leaks is the one nobody meant to write.
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[jira-read] unhandled:', scrub(msg, [cred.value.token]))
    return failure({ code: 'server_error', error: 'Something went wrong reading from Jira.' }, 500)
  }
}

DENO?.serve(handle)
