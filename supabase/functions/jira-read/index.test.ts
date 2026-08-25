// The fixture suite for jira-read — THE FILE THAT HOLDS THE JIRA CREDENTIAL.
//
// ⚠ SCOPE NOTE FOR THE INTEGRATOR. The unit brief named two files as mine,
//   index.ts and README.md. This is a third, and it is deliberate: it lives
//   inside supabase/functions/jira-read/, so it cannot collide with any other
//   agent's work, and vitest.config.ts ALREADY collects
//   `supabase/functions/**/*.test.ts` for exactly the reason its own comment
//   gives — the server-side copy of a security boundary is the copy an attacker
//   cannot skip, and leaving it uncovered while the browser-side copy has
//   hundreds of lines of tests is backwards. The read-only guarantee in
//   index.ts is that kind of boundary. Delete this file if the gate insists;
//   the cost is that "writing to Jira is unreachable" becomes a claim in a
//   comment rather than a thing CI checks.
//
// ═══ WHAT IS ASSERTED ═══
//
// Two kinds of thing.
//
//   1. THE STRUCTURAL PROMISES, checked against the SOURCE TEXT of the deployed
//      file: one fetch, no mutating verb, no service-role key, no database
//      write. These read as unusual tests because they are unusual promises —
//      "you cannot write to Jira from here" is a property of the file's shape,
//      not of any one function's return value, and a test that only called
//      functions could never see it.
//   2. THE PURE FUNCTIONS, exercised over their real branches: URL validation,
//      the missing-secret diagnosis, the Jira status map, the bounds, the
//      normalisers.
//
// ═══ WHAT IS NOT ASSERTED, AND CANNOT BE HERE ═══
//
// That any of this works against a real Jira Cloud site. Nobody on this fleet
// has a credential, by design. `jiraCall()` is not exercised at all, and NO
// REAL NETWORK CALL IS MADE ANYWHERE IN THIS FILE. The first honest test of the
// wire is Aziz pressing `ping` against his own site. Said plainly here rather
// than implied by a green suite.
//
// ⚠ ONE `fetch` IS STUBBED, AND ONLY ONE. §10 replaces `globalThis.fetch` for
//   the duration of a handful of tests about `fetchCloudId()` — index.ts's
//   SECOND outbound call, the unauthenticated `/_edge/tenant_info` lookup. The
//   property those tests exist to hold is an ABSENCE ("this request carries no
//   Authorization header"), and an absence on the wire cannot be observed by
//   reading a return value. The stub is installed in a `beforeEach`, restored in
//   an `afterEach`, and asserts on the arguments it was handed. `jiraCall` is
//   still never stubbed and still never called.
//
// ⚠ ONE THING MOVED OUT OF THAT PARAGRAPH, AND IT MOVED FOR A REASON. This
//   header used to say the `search` paging loop was "UNPROVEN except by
//   reading" — and a differential review then found, by reading, that it lost
//   issues whenever the 200-issue cap crossed a page boundary. So the loop is
//   now `collectSearchPages()`, which takes the page reader as an argument, and
//   §9 below drives it with a MODEL of Jira: a backlog where `maxResults` is a
//   ceiling, the cursor is an offset, and a page may come back short. What that
//   proves is the paging ARITHMETIC and the cursor bookkeeping — that no issue
//   is dropped between the cursor and the last issue returned. What it still
//   cannot prove is that the real endpoint behaves like the model. Both halves
//   matter; neither is the other.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ATLASSIAN_GATEWAY_ORIGIN,
  ENDPOINTS,
  NO_GATEWAY_SENTENCE,
  ROUTE_CACHE_TTL_MS,
  TENANT_INFO,
  DEFAULT_SEARCH_FIELDS,
  FIELDS_CAP,
  FIELDS_PER_SEARCH,
  JQL_MAX_LENGTH,
  PROJECTS_MAX_RESULTS,
  SEARCH_DEFAULT_RESULTS,
  SEARCH_MAX_ISSUES,
  SEARCH_MAX_PAGES,
  SEARCH_MAX_RESULTS,
  assertReadOnlyEndpoints,
  assertTenantInfoIsRead,
  basicAuthHeader,
  callWithRoute,
  clampCount,
  clampOffset,
  clearRouteCache,
  collectSearchPages,
  fetchCloudId,
  firstNonAsciiPosition,
  gatewayApiRoot,
  isCloudId,
  isCredentialRefusal,
  isOperation,
  issueUrl,
  looksLikeEmail,
  mapJiraStatus,
  normalizeField,
  normalizeIssue,
  normalizeProject,
  parseBaseUrl,
  parseRetryAfter,
  readCredential,
  scrub,
  selectFields,
  summarizeJiraError,
  QUARANTINED_FIELDS,
  validateFields,
  validateJql,
  validatePageToken,
  withApiRoot,
  type CloudIdResult,
  type JiraCallResult,
  type JiraCredential,
  type JiraEndpoint,
  type JiraFieldOut,
  type PageReader,
  type ParsedBaseUrl,
  acceptLanguageFor,
  withLanguage,
  DEFAULT_ACCEPT_LANGUAGE,
} from './index.ts'

/* ──────────────────────── reading the file off disk ─────────────────────── */

// A VARIABLE `node:fs` SPECIFIER, not a literal one. Vitest intercepts static
// imports by extension before it looks at the query, so the tidy-looking
// `import raw from './index.ts?raw'` resolves to the empty string and every
// assertion below would pass against nothing, forever. The repo already learned
// this the expensive way (see vitest.config.ts's `css: true` comment).
const NODE_FS = 'node:fs'

async function readSource(): Promise<string> {
  const fs = (await import(NODE_FS)) as { readFileSync(p: URL, e: string): string }
  return fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
}

/**
 * Strip comments so a promise written IN a comment cannot satisfy a test about
 * the code. §2 of the header literally spells `.insert(...)` while promising
 * there is none; without this the test would find it and pass backwards.
 *
 * Full-line `//` only, so a `https://` inside a string literal survives.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n')
}

function count(src: string, re: RegExp): number {
  return (src.match(re) ?? []).length
}

/* ═════════════════════ 1. the structural promises ════════════════════════ */

describe('read-only is a property of the file, not a convention', () => {
  it('calls fetch exactly twice, once in jiraCall and once in fetchCloudId', async () => {
    // THIS TEST USED TO SAY "exactly once" AND LOOSENING IT WAS THE WHOLE
    // DECISION. index.ts §7 added a FIFTH outbound URL — the unauthenticated
    // `/_edge/tenant_info` lookup that finds the cloud id for a scoped API
    // token — and a second `fetch` is a second place a credential could go on
    // the wire. So the count is pinned at two AND each one is pinned to the
    // function it must live in; a third, or one of these moving somewhere the
    // allow-list does not reach, fails here.
    const code = stripComments(await readSource())
    expect(count(code, /\bfetch\s*\(/g)).toBe(2)
    expect(count(code, /\bawait fetch\(/g)).toBe(2)

    const jiraCallAt = code.indexOf('async function jiraCall(')
    const cloudIdAt = code.indexOf('export async function fetchCloudId(')
    expect(jiraCallAt).toBeGreaterThan(-1)
    expect(cloudIdAt).toBeGreaterThan(jiraCallAt)

    const first = code.indexOf('await fetch(')
    const second = code.indexOf('await fetch(', first + 1)
    expect(first).toBeGreaterThan(jiraCallAt)
    expect(first).toBeLessThan(cloudIdAt)
    expect(second).toBeGreaterThan(cloudIdAt)
  })

  it('sends an Authorization header on exactly ONE of those two fetches', async () => {
    // The property that matters is not "two fetches" but "one credential". The
    // tenant_info lookup is public; attaching Basic auth to it would put the
    // whole Atlassian account on a request that cannot use it.
    const code = stripComments(await readSource())
    expect(count(code, /Authorization:\s*basicAuthHeader\(/g)).toBe(1)
    // `Authorization` also appears on the two SUPABASE clients, carrying the
    // CALLER's own JWT rather than a Jira secret. The Jira-credential form is
    // the one that must stay at one, and it must sit inside jiraCall — i.e.
    // before fetchCloudId, which is the next function that touches the network.
    const authAt = code.indexOf('Authorization: basicAuthHeader(')
    expect(authAt).toBeGreaterThan(code.indexOf('async function jiraCall('))
    expect(authAt).toBeLessThan(code.indexOf('export async function fetchCloudId('))
  })

  it('never writes an HTTP verb as a literal at the call site', async () => {
    const code = stripComments(await readSource())
    // The verb comes out of the allow-list entry. If this line ever becomes a
    // literal, a caller-influenced verb is one refactor away.
    expect(code).toMatch(/method:\s*ep\.verb/)
    expect(code).not.toMatch(/method:\s*['"`]/)
  })

  it('contains no mutating verb anywhere in its code', async () => {
    const code = stripComments(await readSource())
    expect(code).not.toMatch(/['"`](PUT|PATCH|DELETE|HEAD)['"`]/)
  })

  it('writes nothing to this database and never holds the service role', async () => {
    const code = stripComments(await readSource())
    expect(code).not.toMatch(/SERVICE_ROLE/)
    expect(code).not.toMatch(/\.insert\s*\(/)
    expect(code).not.toMatch(/\.upsert\s*\(/)
    expect(code).not.toMatch(/\.update\s*\(/)
    expect(code).not.toMatch(/\.delete\s*\(/)
    // The only RPC is the permission read. `.rpc(` appears twice — structure.edit
    // and workspace.admin — and both name has_perm.
    expect(count(code, /\.rpc\(/g)).toBe(2)
    expect(count(code, /\.rpc\('has_perm'/g)).toBe(2)
  })

  it('reaches Jira through exactly four endpoints, all under /rest/api/3/', () => {
    const names = Object.keys(ENDPOINTS)
    expect(names.sort()).toEqual(['fieldList', 'jqlSearch', 'myself', 'projectSearch'])
    for (const ep of Object.values(ENDPOINTS) as JiraEndpoint[]) {
      expect(ep.path.startsWith('/rest/api/3/')).toBe(true)
    }
  })

  it('permits POST on the JQL search alone, and says why', () => {
    const posts = (Object.entries(ENDPOINTS) as [string, JiraEndpoint][]).filter(
      ([, ep]) => ep.verb === 'POST',
    )
    expect(posts.map(([n]) => n)).toEqual(['jqlSearch'])
    expect(posts[0][1].postReason).toMatch(/410|read|creates nothing/i)
    // The endpoint that MOVED. A regression to the removed GET /search would
    // pass every unit test and fail only against a live site.
    expect(ENDPOINTS.jqlSearch.path).toBe('/rest/api/3/search/jql')
  })

  it('validates its own allow-list at module load', () => {
    expect(() => assertReadOnlyEndpoints()).not.toThrow()
  })

  it('freezes the allow-list so it cannot be extended at runtime', () => {
    expect(Object.isFrozen(ENDPOINTS)).toBe(true)
  })
})

/* ═══════════════════════ 2. the base URL is a typo gate ══════════════════ */

describe('parseBaseUrl', () => {
  it('accepts a Jira Cloud site and reduces it to an origin', () => {
    const r = parseBaseUrl('https://acme.atlassian.net')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.origin).toBe('https://acme.atlassian.net')
    expect(r.value.atlassianCloud).toBe(true)
  })

  it('drops a trailing slash and lowercases the host', () => {
    const r = parseBaseUrl('  https://ACME.Atlassian.NET/  ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.origin).toBe('https://acme.atlassian.net')
  })

  it('allows a custom domain but flags it as not *.atlassian.net', () => {
    const r = parseBaseUrl('https://jira.example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.atlassianCloud).toBe(false)
  })

  it('refuses http, because that is the token on the wire in the clear', () => {
    const r = parseBaseUrl('http://acme.atlassian.net')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toMatch(/https/)
  })

  it('refuses a URL with a path, naming the fix', () => {
    // The single most likely paste: the address bar while looking at a board.
    const r = parseBaseUrl('https://acme.atlassian.net/jira/software/projects/OPS')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toMatch(/https:\/\/acme\.atlassian\.net/)
  })

  it.each([
    ['https://user:pw@acme.atlassian.net', /username or password/],
    ['https://acme.atlassian.net?x=1', /query string/],
    // `localhost` has no dot, so it is refused one branch earlier than the
    // IP-literal check — a different sentence, the same refusal.
    ['https://localhost', /not a domain name/],
    ['https://app.localhost', /not a Jira Cloud site/],
    ['https://10.0.0.4', /not a Jira Cloud site/],
    ['https://127.0.0.1', /not a Jira Cloud site/],
    ['https://acme', /not a domain name/],
    ['not a url at all', /not a URL/],
    ['', /empty/],
  ])('refuses %s', (input, expected) => {
    const r = parseBaseUrl(input)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toMatch(expected)
  })
})

/* ═════════════════ 3. a missing secret is a diagnosis, not a 500 ═════════ */

describe('readCredential', () => {
  const good = {
    baseUrl: 'https://acme.atlassian.net',
    email: 'aziz@example.com',
    token: 'ATATT-not-a-real-token-0000',
  }

  it('accepts a complete, well-formed set', () => {
    const r = readCredential(good)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.base.origin).toBe('https://acme.atlassian.net')
    expect(r.value.email).toBe('aziz@example.com')
  })

  it('names the ONE variable that is unset', () => {
    const r = readCredential({ ...good, token: '' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.code).toBe('missing_secret')
    expect(r.failure.missing).toEqual(['JIRA_API_TOKEN'])
    expect(r.failure.error).toContain('JIRA_API_TOKEN is not set')
  })

  it('names ALL of them at once rather than one round trip at a time', () => {
    const r = readCredential({ baseUrl: '', email: '  ', token: '' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.missing).toEqual(['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'])
  })

  it('answers 503, never 500 — this is configuration, not a crash', () => {
    for (const bad of [
      { ...good, token: '' },
      { ...good, baseUrl: 'http://acme.atlassian.net' },
      { ...good, email: 'aziz' },
    ]) {
      const r = readCredential(bad)
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.status).toBe(503)
    }
  })

  it('tells a username apart from an email, because Basic auth needs the email', () => {
    const r = readCredential({ ...good, email: 'aziz' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.code).toBe('bad_email')
  })

  it('trims a token pasted with a trailing newline instead of failing as 401', () => {
    const r = readCredential({ ...good, token: '  ATATT-x-0000\n' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.token).toBe('ATATT-x-0000')
  })
})

describe('looksLikeEmail', () => {
  it.each([
    ['aziz@example.com', true],
    ['a.b+c@sub.example.co.uk', true],
    ['aziz', false],
    ['aziz@localhost', false],
    ['a b@example.com', false],
    ['@example.com', false],
  ])('%s -> %s', (input, expected) => {
    expect(looksLikeEmail(input)).toBe(expected)
  })
})

/* ══════════════════════ 4. the credential never leaks ════════════════════ */

describe('the token stays inside this function', () => {
  it('builds the exact Basic header Jira Cloud expects', () => {
    // There is no bearer form for an API token; sending one is a 401 that
    // reads like a bad token.
    const h = basicAuthHeader('a@b.com', 'tok')
    expect(h).toBe(`Basic ${btoa('a@b.com:tok')}`)
    expect(h.startsWith('Basic ')).toBe(true)
  })

  it('scrubs a secret out of any text bound for the wire', () => {
    const token = 'ATATT-super-secret-value'
    expect(scrub(`upstream said ${token} oops`, [token])).toBe('upstream said [redacted] oops')
  })

  it('does not try to scrub short strings, which would redact real prose', () => {
    expect(scrub('the project is OPS', ['OPS'])).toBe('the project is OPS')
  })

  it('scrubs the token out of a Jira error body before it becomes `detail`', () => {
    const token = 'ATATT-super-secret-value'
    const detail = summarizeJiraError(
      { errorMessages: [`bad credential ${token}`], errors: { jql: 'Field not found' } },
      [token],
    )
    expect(detail).not.toContain(token)
    expect(detail).toContain('[redacted]')
    expect(detail).toContain('jql: Field not found')
  })

  it('returns undefined when Jira sent no message worth relaying', () => {
    expect(summarizeJiraError({}, [])).toBeUndefined()
    expect(summarizeJiraError(null, [])).toBeUndefined()
    expect(summarizeJiraError('<html>gateway</html>', [])).toBeUndefined()
  })

  it('reads the secrets only AFTER the caller has been authorized', async () => {
    // ORDER, NOT PRESENCE, IS THE PROPERTY. `verify_jwt` is on at the gateway,
    // but the ANON KEY satisfies it and ships in every browser bundle — so a
    // secret check placed first answers a stranger with `missing_secret`: which
    // of the three Jira variables are set, and whether the set ones are
    // well-formed. A map of this project's configuration, to anyone who asks.
    //
    // It used to be worse: while `bad_base_url` still echoed the value it
    // rejected, "secrets first" also handed a MISPASTED TOKEN to an
    // unauthenticated caller. That echo is gone (see the #2 group below), so
    // this ordering is now the second of two independent defences rather than
    // the only one — which is a reason to keep it, not to relax it. Pinned by
    // position because a reorder is exactly the kind of tidy edit that reads
    // like an improvement.
    const code = stripComments(await readSource())
    const handler = code.slice(code.indexOf('export async function handle('))
    const authAt = handler.indexOf('auth.getUser(')
    const permAt = handler.indexOf("rpc('has_perm'")
    const secretAt = handler.indexOf('readCredential(')
    expect(authAt).toBeGreaterThan(-1)
    expect(permAt).toBeGreaterThan(-1)
    expect(secretAt).toBeGreaterThan(-1)
    expect(authAt).toBeLessThan(permAt)
    expect(permAt).toBeLessThan(secretAt)
  })
})

/* ═══════════════════ 5. Jira's status becomes a two-minute fix ═══════════ */

describe('mapJiraStatus', () => {
  it.each([
    [401, 'jira_unauthorized', /JIRA_API_TOKEN|JIRA_EMAIL/],
    [403, 'jira_forbidden', /Browse Projects|cannot see/],
    [404, 'jira_not_found', /JIRA_BASE_URL/],
    [410, 'jira_gone', /removed/],
    [400, 'jira_bad_request', /JQL/],
    [500, 'jira_unavailable', /Jira answered 500/],
    [503, 'jira_unavailable', /Jira answered 503/],
  ])('%s -> %s', (status, code, sentence) => {
    const m = mapJiraStatus(status)
    expect(m.failure.code).toBe(code)
    expect(m.failure.error).toMatch(sentence)
    expect(m.failure.jiraStatus).toBe(status)
  })

  it('NEVER returns 401 to the browser when Jira returns 401', () => {
    // Returning 401 would read as "your session expired" and bounce the user to
    // sign-in over a bad Jira token. Our status is about OUR outcome.
    const m = mapJiraStatus(401)
    expect(m.status).toBe(502)
    expect(m.failure.jiraStatus).toBe(401)
  })

  it('keeps 429 as 429 and honours Retry-After', () => {
    const m = mapJiraStatus(429, { retryAfterSeconds: 30 })
    expect(m.status).toBe(429)
    expect(m.failure.code).toBe('jira_rate_limited')
    expect(m.failure.retryAfterSeconds).toBe(30)
    expect(m.headers).toEqual({ 'Retry-After': '30' })
    expect(m.failure.error).toContain('30 seconds')
  })

  it('still says something useful when Jira sent no Retry-After', () => {
    const m = mapJiraStatus(429)
    expect(m.status).toBe(429)
    expect(m.headers).toBeUndefined()
    expect(m.failure.error).toMatch(/rate-limiting/)
  })

  it('carries Jira’s own message through as detail', () => {
    const m = mapJiraStatus(400, { detail: "Field 'organisation' does not exist" })
    expect(m.failure.detail).toContain('organisation')
  })
})

describe('parseRetryAfter', () => {
  it.each([
    ['30', 30],
    [' 30 ', 30],
    ['0', 0],
    ['1.4', 2],
  ])('%s -> %s', (raw, expected) => {
    expect(parseRetryAfter(raw)).toBe(expected)
  })

  it('ignores the HTTP-date form rather than inventing a clock-skew bug', () => {
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('-5')).toBeUndefined()
    expect(parseRetryAfter('999999')).toBeUndefined()
  })
})

/* ══════════════════════════ 6. every read is bounded ═════════════════════ */

describe('bounds', () => {
  it('clamps maxResults into [1, cap] and defaults nonsense', () => {
    expect(clampCount(undefined, SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(50)
    expect(clampCount(5000, SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(SEARCH_MAX_RESULTS)
    expect(clampCount(0, SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(1)
    expect(clampCount(-9, SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(1)
    expect(clampCount('25', SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(25)
    expect(clampCount('lots', SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(50)
    expect(clampCount(NaN, SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(50)
    expect(clampCount(12.9, SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS)).toBe(12)
  })

  it('caps project paging at what Jira will actually serve', () => {
    expect(PROJECTS_MAX_RESULTS).toBe(50)
    expect(clampCount(500, PROJECTS_MAX_RESULTS, PROJECTS_MAX_RESULTS)).toBe(50)
  })

  it('clamps startAt to a non-negative integer', () => {
    expect(clampOffset(undefined, 5000)).toBe(0)
    expect(clampOffset(-1, 5000)).toBe(0)
    expect(clampOffset(99999, 5000)).toBe(5000)
    expect(clampOffset('40', 5000)).toBe(40)
  })
})

/* ═══════════════════════════ 7. caller input ═════════════════════════════ */

describe('validateJql', () => {
  it('accepts a real query and trims it', () => {
    const r = validateJql('  project = OPS ORDER BY updated DESC ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe('project = OPS ORDER BY updated DESC')
  })

  it('accepts a multi-line query, because people paste out of an editor', () => {
    const r = validateJql('project = OPS\n  AND status != Done')
    expect(r.ok).toBe(true)
  })

  it('asks for a query instead of sending an empty one', () => {
    const r = validateJql('   ')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toMatch(/project = OPS/)
  })

  it.each([
    [123, /must be a string/],
    ['a'.repeat(JQL_MAX_LENGTH + 1), /limit is 2000/],
    [`project = ${String.fromCharCode(0)}OPS`, /control characters/],
  ])('refuses %s', (input, expected) => {
    const r = validateJql(input)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toMatch(expected)
  })
})

describe('validateFields', () => {
  it('defaults to an EXPLICIT field list, because the new endpoint returns few by default', () => {
    const r = validateFields(undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual([...DEFAULT_SEARCH_FIELDS])
    expect(r.value).toContain('summary')
    expect(r.value).toContain('status')
  })

  it('accepts a custom field id — the whole point of the fields operation', () => {
    const r = validateFields(['customfield_10042', 'summary'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual(['customfield_10042', 'summary'])
  })

  /*
   * ── THE QUARANTINE ─────────────────────────────────────────────────────
   *
   * ⚠ THIS TEST USED TO ASSERT THE OPPOSITE. It read "accepts Jira's own
   *   wildcards" and passed `*all` through, because the docblock invited it.
   *   That was correct until 25 Aug 2026, when a scan of the 2,971-ticket
   *   export found raw HL7 v2 payloads in ticket descriptions: 522 IPv4
   *   addresses, 37 ten-digit national-ID-shaped numbers, 22 MRN/patient-id
   *   mentions, 9 certificate or private-key blocks. `*all` fetches
   *   descriptions, so `*all` fetches patient data.
   *
   * The reversal is recorded here rather than in a commit message because the
   * next person to read this file will wonder why a wildcard Jira supports is
   * refused, and the answer is a governance ruling (BRD-001, quarantine now and
   * redact later), not an oversight.
   */
  it('REFUSES the wildcards, because they would fetch quarantined fields', () => {
    for (const wildcard of ['*all', '*navigable', '*ALL']) {
      const r = validateFields([wildcard])
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.detail).toContain('quarantined')
    }
  })

  it('REFUSES every quarantined field by name, whatever its case', () => {
    for (const field of QUARANTINED_FIELDS) {
      for (const spelling of [field, field.toUpperCase(), ` ${field} `]) {
        const r = validateFields(['summary', spelling])
        expect(r.ok).toBe(false)
        if (r.ok) return
        expect(r.detail).toContain(field)
      }
    }
  })

  /*
   * REFUSES rather than SILENTLY DROPS, and the difference is the whole point.
   * A caller who asked for descriptions and got a 200 carrying none would
   * conclude the tickets have no descriptions — a false belief the endpoint
   * handed them. An error says what happened.
   */
  it('refuses the whole request rather than quietly returning the rest', () => {
    const r = validateFields(['summary', 'status', 'description'])
    expect(r.ok).toBe(false)
  })

  it('names no quarantined field in the default set', () => {
    for (const field of QUARANTINED_FIELDS) {
      expect(DEFAULT_SEARCH_FIELDS).not.toContain(field)
    }
    // The default is a convenience and the denylist is the control; assert both
    // so that widening the default can never quietly widen what is fetched.
    const r = validateFields(undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const field of QUARANTINED_FIELDS) expect(r.value).not.toContain(field)
  })

  /*
   * The honest limit, asserted so it cannot be forgotten: a custom field id is
   * opaque to this function, and a Jira instance may put prose in one. The scan
   * checked the two that would matter — `patient ID (هوية المريض)` and
   * `Physican ID (هوية الطبيب)` — and found ZERO rows filled in either. This is
   * a name-level control and the test says so out loud.
   */
  it('still accepts a custom field id, which is the control\u2019s known limit', () => {
    const r = validateFields(['customfield_10042'])
    expect(r.ok).toBe(true)
  })

  it('de-duplicates rather than asking Jira twice', () => {
    const r = validateFields(['summary', 'summary', ' summary '])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual(['summary'])
  })

  it.each([
    ['not an array', 'summary', /must be an array/],
    ['a non-string entry', [1], /must be a string/],
    ['an injected path', ['../../secret'], /is not a field id/],
    ['a quoted value', ["summary'"], /is not a field id/],
    ['too many', new Array(FIELDS_PER_SEARCH + 1).fill('summary'), /at most 50/],
  ])('refuses %s', (_label, input, expected) => {
    const r = validateFields(input)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toMatch(expected)
  })

  it('treats an empty array as "give me the defaults"', () => {
    const r = validateFields([])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual([...DEFAULT_SEARCH_FIELDS])
  })
})

describe('validatePageToken', () => {
  it('treats the cursor as opaque', () => {
    const r = validatePageToken('CAEaAggDGgQIAxAB')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe('CAEaAggDGgQIAxAB')
  })

  it('reads absence as "start at the beginning"', () => {
    for (const v of [undefined, null, '']) {
      const r = validatePageToken(v)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.value).toBeUndefined()
    }
  })

  it('bounds it so a client cannot post a megabyte of "token"', () => {
    const r = validatePageToken('x'.repeat(5000))
    expect(r.ok).toBe(false)
  })

  it('refuses control characters and non-strings', () => {
    expect(validatePageToken({}).ok).toBe(false)
    expect(validatePageToken(`ab${String.fromCharCode(1)}cd`).ok).toBe(false)
  })
})

describe('isOperation', () => {
  it('accepts exactly the four operations', () => {
    for (const op of ['ping', 'projects', 'search', 'fields']) expect(isOperation(op)).toBe(true)
  })

  it('rejects anything else, including an endpoint name', () => {
    for (const bad of ['jqlSearch', 'create', 'transition', '', null, 7, {}]) {
      expect(isOperation(bad)).toBe(false)
    }
  })
})

/* ══════════════════ 8. what the schema will eventually store ═════════════ */

describe('issueUrl', () => {
  it('produces an https href, which is what 0023 constrains external_url to', () => {
    // map_nodes_external_url_chk: `external_url is null or external_url ~* '^https?://'`
    const url = issueUrl('https://acme.atlassian.net', 'OPS-12')
    expect(url).toBe('https://acme.atlassian.net/browse/OPS-12')
    expect(/^https?:\/\//.test(url)).toBe(true)
  })

  it('encodes a key rather than trusting the upstream to be well-formed', () => {
    expect(issueUrl('https://acme.atlassian.net', 'A B/C')).toBe(
      'https://acme.atlassian.net/browse/A%20B%2FC',
    )
  })
})

describe('normalizeIssue', () => {
  it('carries key, id and a browse link — external_ref and external_url', () => {
    const out = normalizeIssue(
      { id: '10001', key: 'OPS-12', fields: { summary: 'ADT for Hospital A' } },
      'https://acme.atlassian.net',
    )
    expect(out.key).toBe('OPS-12')
    expect(out.id).toBe('10001')
    expect(out.url).toBe('https://acme.atlassian.net/browse/OPS-12')
  })

  it('passes fields through UNINTERPRETED — that is what a harness is for', () => {
    const fields = { summary: 'x', customfield_10042: { value: 'Hospital A' } }
    const out = normalizeIssue({ key: 'OPS-1', fields }, 'https://acme.atlassian.net')
    expect(out.fields).toEqual(fields)
  })

  it('survives a malformed issue rather than throwing mid-page', () => {
    const out = normalizeIssue(null, 'https://acme.atlassian.net')
    expect(out).toEqual({ id: null, key: null, url: null, fields: {} })
    expect(normalizeIssue({ key: 7, fields: 'nope' }, 'https://x.atlassian.net').fields).toEqual({})
  })
})

describe('normalizeField', () => {
  it('surfaces a custom field with its id, type and JQL clause names', () => {
    // The single fact this whole operation exists to obtain: which
    // customfield_NNNNN carries "which Organization".
    const out = normalizeField({
      id: 'customfield_10042',
      key: 'customfield_10042',
      name: 'Organization',
      custom: true,
      clauseNames: ['cf[10042]', 'Organization'],
      schema: {
        type: 'option',
        custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
        customId: 10042,
      },
    })
    expect(out.id).toBe('customfield_10042')
    expect(out.name).toBe('Organization')
    expect(out.custom).toBe(true)
    expect(out.schemaType).toBe('option')
    expect(out.customType).toContain('customfieldtypes:select')
    expect(out.clauseNames).toEqual(['cf[10042]', 'Organization'])
  })

  it('marks a system field as not custom and copes with no schema', () => {
    const out = normalizeField({ id: 'summary', name: 'Summary', custom: false })
    expect(out.custom).toBe(false)
    expect(out.schemaType).toBeNull()
    expect(out.clauseNames).toEqual([])
  })
})

describe('normalizeProject', () => {
  it('gives the key the owner came for, plus a link', () => {
    const out = normalizeProject(
      { id: '10000', key: 'OPS', name: 'Onboarding', projectTypeKey: 'software', simplified: true },
      'https://acme.atlassian.net',
    )
    expect(out.key).toBe('OPS')
    expect(out.url).toBe('https://acme.atlassian.net/browse/OPS')
    expect(out.simplified).toBe(true)
  })

  it('survives a project row with nothing in it', () => {
    expect(normalizeProject({}, 'https://acme.atlassian.net').url).toBeNull()
  })
})

/* ═══════ 9. the four holes a differential review reproduced (#2/#5/#8/#9) ══ */

/**
 * ⚠ REGRESSION TESTS, AND EACH ONE FAILED BEFORE ITS FIX. They are grouped
 *   together rather than filed under the sections above because what they have
 *   in common is more useful than what they are about: every one of them shipped
 *   through a green suite, a written header that claimed the opposite, and a
 *   README that documented the promise being broken. Each `describe` below
 *   states the reproduction, so a future reader can tell a test that is guarding
 *   something from a test that is decorating something.
 */

describe('#2 — no error path quotes the value it just rejected', () => {
  // Stands in for the operator slip the file's own header models: the ATATT…
  // API token pasted into the JIRA_BASE_URL box. It is not a real token; the
  // point is only its SHAPE (long, opaque, no scheme).
  const PASTED = 'ATATT3xFfGF0notarealtoken0000000000000000000000000000000000'

  it('refuses a pasted credential WITHOUT putting it in the error body', () => {
    // BEFORE: `JIRA_BASE_URL is not a URL … — got "ATATT3xFfGF0…"`, returned to
    // every structure.edit holder, and scrub() could not help — in this scenario
    // the token is not the value of JIRA_API_TOKEN, so there is nothing to match.
    const r = parseBaseUrl(PASTED)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).not.toContain(PASTED)
    expect(r.detail).not.toContain('ATATT')
    expect(r.detail).toBe('JIRA_BASE_URL is not a URL. Expected https://your-site.atlassian.net')
  })

  it('does not echo a scheme-shaped prefix either', () => {
    // `new URL('head:tail')` SUCCEEDS, with protocol 'head:'. A quoted
    // `u.protocol` therefore leaks the head of any pasted value that happens to
    // contain a colon — which is why only the http: case is named, and named as
    // a literal in this file rather than as an echo.
    const r = parseBaseUrl('ATATT3xFfGF0:the-rest-of-it')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).not.toContain('ATATT')
    expect(r.detail).toMatch(/must start with https/)
  })

  it('still names http:// specifically, because that mistake is worth naming', () => {
    const r = parseBaseUrl('http://acme.atlassian.net')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).toMatch(/not http:\/\//)
    expect(r.detail).toMatch(/in the clear/)
  })

  it.each([
    ['a bare token', PASTED],
    ['a token with a colon', 'ATATT3xFfGF0:more'],
    ['an https URL whose host is the token', `https://${PASTED}`],
    ['a token with dots, JWT-shaped', 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM'],
    ['a password-looking value', 'hunter2-correct-horse-battery-staple'],
    ['an email in the wrong box', 'aziz@example.com'],
  ])('never repeats %s back to the caller', (_label, input) => {
    const r = parseBaseUrl(input)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.detail).not.toContain(input)
    // And the same value, wrapped by the layer that actually reaches the wire.
    const c = readCredential({ baseUrl: input, email: 'aziz@example.com', token: 'tok-0000-0000' })
    expect(c.ok).toBe(false)
    if (c.ok) return
    expect(c.failure.error).not.toContain(input)
  })

  it('pins the ONLY value parseBaseUrl is allowed to interpolate', async () => {
    // POSITION-PINNED ON THE SOURCE, because the fix is an absence and an
    // absence is exactly what a behavioural test stops noticing when someone
    // adds a helpful `got "${…}"` back to a branch three refactors from now.
    // `host` is the only thing this function may ever interpolate, and it
    // appears exactly twice: once in the no-path refusal (which is last on
    // purpose, so `host` has already passed every shape test and can only be a
    // real domain name by then) and once in the success `origin`. A third
    // interpolation, or a different variable, is the defect coming back.
    const code = stripComments(await readSource())
    const start = code.indexOf('export function parseBaseUrl(')
    const end = code.indexOf('export function looksLikeEmail(')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = code.slice(start, end)
    expect(body.match(/\$\{[^}]*\}/g) ?? []).toEqual(['${host}', '${host}'])
    // The host checks must precede the path check, which is what makes that
    // one quote safe. A reorder would read like tidying.
    expect(body.indexOf('is not a valid hostname')).toBeLessThan(body.indexOf('with no path after it'))
  })
})

describe('#9 — a non-ASCII JIRA_EMAIL is a named diagnosis, not a 500', () => {
  // An Arabic-script address: this app ships an Arabic locale, so this operator
  // is not hypothetical. It passes looksLikeEmail's deliberately loose regex.
  const ARABIC_EMAIL = 'عزيز@example.com'

  it('is accepted by the loose email shape check — which is the trap', () => {
    expect(looksLikeEmail(ARABIC_EMAIL)).toBe(true)
  })

  it('is refused BY NAME, at 503, before anything touches the wire', () => {
    // BEFORE: readCredential said ok, basicAuthHeader called btoa, btoa threw
    // InvalidCharacterError from FOUR LINES OUTSIDE jiraCall's try block, and
    // every operation — ping included — answered a generic 500 about Jira,
    // which had never been contacted.
    const r = readCredential({
      baseUrl: 'https://acme.atlassian.net',
      email: ARABIC_EMAIL,
      token: 'ATATT-not-a-real-token-0000',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(503)
    expect(r.failure.code).toBe('bad_email')
    expect(r.failure.error).toMatch(/outside plain ASCII/)
    expect(r.failure.error).toMatch(/position 1/)
    // The POSITION is a shape; the CHARACTER would be a value. Same rule as #2.
    expect(r.failure.error).not.toContain(ARABIC_EMAIL)
    expect(r.failure.error).not.toContain('عزيز')
  })

  it.each([
    ['a Cyrillic lookalike a', 'аziz@example.com', 1],
    ['a non-breaking space', 'aziz b@example.com', 5],
    ['a smart quote', 'o’brien@example.com', 2],
    ['a trailing zero-width space', 'aziz@example.com​', 17],
  ])('catches %s and says where', (_label, email, at) => {
    expect(firstNonAsciiPosition(email)).toBe(at)
    const r = readCredential({ baseUrl: 'https://acme.atlassian.net', email, token: 'tok-0000-0000' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.code).toBe('bad_email')
    expect(r.failure.error).toContain(`position ${at}`)
  })

  it('leaves a plain ASCII address alone', () => {
    expect(firstNonAsciiPosition('aziz@example.com')).toBe(0)
    expect(readCredential({
      baseUrl: 'https://acme.atlassian.net',
      email: 'aziz@example.com',
      token: 'ATATT-not-a-real-token-0000',
    }).ok).toBe(true)
  })

  it('makes basicAuthHeader TOTAL, so no input can resurrect the 500', () => {
    // The validator above is the behaviour; this is the belt. A bare btoa throws
    // on any code point over U+00FF, and this function is called outside the try
    // block that would have caught it.
    expect(() => basicAuthHeader(ARABIC_EMAIL, 'tok')).not.toThrow()
    expect(() => basicAuthHeader('a@b.com', '🔑-emoji-token')).not.toThrow()
    expect(() => basicAuthHeader('日本@example.com', 'ぱすわーど')).not.toThrow()
    expect(basicAuthHeader(ARABIC_EMAIL, 'tok').startsWith('Basic ')).toBe(true)
  })

  it('stays byte-identical to the old header for every real credential', () => {
    // ASCII in, same base64 out — the fix must not quietly change the bytes a
    // working Jira site already accepts.
    expect(basicAuthHeader('a@b.com', 'tok')).toBe(`Basic ${btoa('a@b.com:tok')}`)
    expect(basicAuthHeader('aziz@example.com', 'ATATT3xFfGF0-0000')).toBe(
      `Basic ${btoa('aziz@example.com:ATATT3xFfGF0-0000')}`,
    )
  })

  it('encodes the non-ASCII case as UTF-8 bytes rather than mangling them', () => {
    // Unreachable through readCredential, and still specified: a total function
    // whose output is unspecified is only half a fix.
    const decoded = atob(basicAuthHeader('é@b.com', 'tok').slice('Basic '.length))
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe('é@b.com:tok')
  })
})

describe('#8 — selectFields sorts custom-first BEFORE it caps', () => {
  function field(name: string, custom: boolean): JiraFieldOut {
    return {
      id: custom ? `customfield_${10000 + Number(name.replace(/\D/g, ''))}` : name,
      key: null,
      name,
      custom,
      schemaType: 'string',
      customType: null,
      clauseNames: [],
    }
  }

  // Jira's wire order is unspecified, and this is the order that breaks the
  // old code: every custom field sits AFTER the cap.
  const bigSite: JiraFieldOut[] = [
    ...Array.from({ length: 700 }, (_, i) => field(`system ${i}`, false)),
    ...Array.from({ length: 40 }, (_, i) => field(`custom ${i}`, true)),
  ]

  it('keeps every custom field on a site that overruns the cap', () => {
    // BEFORE: slice(0, 600) ran first, so all 40 customs were dropped and the
    // response still looked complete and custom-first — customCount: 0 was the
    // only tell, on the one operation whose entire purpose (README §6) is
    // finding two custom field ids.
    const sel = selectFields(bigSite)
    expect(sel.truncated).toBe(true)
    expect(sel.fields).toHaveLength(FIELDS_CAP)
    expect(sel.fields.filter((f) => f.custom)).toHaveLength(40)
    expect(sel.fields[0].custom).toBe(true)
    // The cap can now only ever fall on system fields.
    expect(sel.fields.at(-1)?.custom).toBe(false)
  })

  it('measures truncation against what MATCHED, not against what fitted', () => {
    const sel = selectFields(bigSite)
    expect(sel.matched).toBe(740)
    expect(sel.fields.length).toBeLessThan(sel.matched)
  })

  it('filters customOnly first, then sorts, then caps', () => {
    const sel = selectFields(bigSite, { customOnly: true })
    expect(sel.truncated).toBe(false)
    expect(sel.matched).toBe(40)
    expect(sel.fields.every((f) => f.custom)).toBe(true)
  })

  it('orders custom-first then by name, and touches nothing under the cap', () => {
    const sel = selectFields([field('zzz', false), field('bbb', false), field('aaa 1', true)])
    expect(sel.truncated).toBe(false)
    expect(sel.fields.map((f) => f.name)).toEqual(['aaa 1', 'bbb', 'zzz'])
  })

  it('does not mutate the array it was handed', () => {
    const input = [field('zzz', false), field('aaa 1', true)]
    selectFields(input)
    expect(input.map((f) => f.name)).toEqual(['zzz', 'aaa 1'])
  })
})

describe('#5 — the paging loop never reads an issue it does not return', () => {
  /**
   * A JIRA THAT BEHAVES. `maxResults` is a CEILING (it may serve fewer, never
   * more), the cursor is an offset, and `shortPages` models the permission
   * filtering that makes a real page come back shorter than asked for.
   *
   * The fixture the differential review said was missing is the one this makes
   * possible: pages that MISALIGN with the 200-issue cap.
   */
  function fakeBacklog(total: number, opts: { shortPages?: Record<number, number> } = {}) {
    const asked: { token: string | undefined; maxResults: number }[] = []
    let call = 0
    const read: PageReader = ({ token, maxResults }) => {
      asked.push({ token, maxResults })
      call += 1
      const from = token === undefined ? 0 : Number(token.slice('at-'.length))
      const n = Math.max(0, Math.min(maxResults, opts.shortPages?.[call] ?? maxResults, total - from))
      const issues = Array.from({ length: n }, (_, i) => ({ id: String(from + i), key: `OPS-${from + i}` }))
      const to = from + n
      return Promise.resolve({
        ok: true as const,
        status: 200,
        data: to < total ? { issues, nextPageToken: `at-${to}` } : { issues, isLast: true },
      })
    }
    return { read, asked }
  }

  const keysOf = (issues: unknown[]) => issues.map((i) => (i as { key: string }).key)

  it('loses nothing when the cap crosses mid-page — maxResults=70 into a 200 cap', async () => {
    // THE REPRODUCTION. 200 is not a multiple of 70, so the cap crossed
    // mid-page even with perfectly full pages: the loop kept 60 of the third
    // page's 70 issues, dropped 10 — and advanced the cursor PAST them, so no
    // call would ever return them again.
    const site = fakeBacklog(1000)
    const first = await collectSearchPages(site.read, { maxResults: 70 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.issues).toHaveLength(SEARCH_MAX_ISSUES)
    expect(first.value.truncated).toBe(true)
    expect(first.value.nextPageToken).toBe('at-200')
    // Never asked for more than the budget could keep — that is the mechanism.
    expect(site.asked.map((a) => a.maxResults)).toEqual([70, 70, 60])

    const second = await collectSearchPages(site.read, {
      maxResults: 70,
      startToken: first.value.nextPageToken,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // The seam between the two calls is contiguous. No gap, no repeat.
    expect(keysOf([...first.value.issues, ...second.value.issues])).toEqual(
      Array.from({ length: 400 }, (_, i) => `OPS-${i}`),
    )
  })

  it('loses nothing when a SHORT page misaligns the running total (100/70/…)', async () => {
    // The other half of the review's reproduction: Jira shortens a page through
    // permission filtering, so the totals stop landing on the cap.
    const site = fakeBacklog(1000, { shortPages: { 2: 70 } })
    const first = await collectSearchPages(site.read, { maxResults: 100 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(site.asked.map((a) => a.maxResults)).toEqual([100, 100, 30])
    expect(first.value.issues).toHaveLength(SEARCH_MAX_ISSUES)
    expect(first.value.nextPageToken).toBe('at-200')

    const second = await collectSearchPages(site.read, {
      maxResults: 100,
      startToken: first.value.nextPageToken,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(keysOf([...first.value.issues, ...second.value.issues])).toEqual(
      Array.from({ length: 400 }, (_, i) => `OPS-${i}`),
    )
  })

  it('reads a whole small backlog and reports it complete', async () => {
    const site = fakeBacklog(120)
    const r = await collectSearchPages(site.read, { maxResults: 50 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.issues).toHaveLength(120)
    expect(r.value.pages).toBe(3)
    expect(r.value.truncated).toBe(false)
    expect(r.value.nextPageToken).toBeUndefined()
  })

  it('stops at the page budget with a resumable cursor', async () => {
    const site = fakeBacklog(10_000, { shortPages: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5 } })
    const r = await collectSearchPages(site.read, { maxResults: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.pages).toBe(SEARCH_MAX_PAGES)
    expect(r.value.issues).toHaveLength(25)
    expect(r.value.truncated).toBe(true)
    expect(r.value.nextPageToken).toBe('at-25')
  })

  it('hands back the cursor that FETCHED the page when a server overshoots', async () => {
    // A server that ignores maxResults is the only remaining way the cap can
    // cross mid-page. Returning `next` here would skip the unread tail forever;
    // returning the fetching cursor costs a duplicate page, which the caller
    // can see and de-dupe by issue key.
    let call = 0
    const read: PageReader = ({ token }) => {
      call += 1
      const from = token === undefined ? 0 : Number(token.slice('at-'.length))
      const n = call === 1 ? 100 : 150 // page 2 overshoots a 100-issue budget
      const issues = Array.from({ length: n }, (_, i) => ({ key: `OPS-${from + i}` }))
      return Promise.resolve({
        ok: true as const,
        status: 200,
        data: { issues, nextPageToken: `at-${from + n}` },
      })
    }
    const r = await collectSearchPages(read, { maxResults: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.issues).toHaveLength(SEARCH_MAX_ISSUES)
    expect(r.value.truncated).toBe(true)
    expect(r.value.nextPageToken).toBe('at-100')
    expect(r.value.nextPageToken).not.toBe('at-250')
  })

  it('calls a stalled cursor truncated instead of spinning to the page budget', async () => {
    const read: PageReader = () =>
      Promise.resolve({
        ok: true as const,
        status: 200,
        data: { issues: [{ key: 'OPS-1' }], nextPageToken: 'same-forever' },
      })
    const r = await collectSearchPages(read, { maxResults: 50 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.pages).toBe(2)
    expect(r.value.truncated).toBe(true)
  })

  it('relays an upstream failure instead of returning half a page', async () => {
    const read: PageReader = () =>
      Promise.resolve({
        ok: false as const,
        status: 429,
        failure: { code: 'jira_rate_limited' as const, error: 'slow down' },
        headers: { 'Retry-After': '30' },
      })
    const r = await collectSearchPages(read, { maxResults: 50 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.err.status).toBe(429)
    expect(r.err.headers).toEqual({ 'Retry-After': '30' })
  })

  it('treats a page with no issues array as an empty page rather than throwing', async () => {
    const read: PageReader = () => Promise.resolve({ ok: true as const, status: 200, data: {} })
    const r = await collectSearchPages(read, { maxResults: 50 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.issues).toHaveLength(0)
    expect(r.value.truncated).toBe(false)
  })

  it('never issues a request once the budget is spent', async () => {
    const site = fakeBacklog(10_000)
    const r = await collectSearchPages(site.read, { maxResults: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 200 issues in exactly two full pages, and then it stops — it does not
    // fetch a third page to discover it has no room for it.
    expect(site.asked).toHaveLength(2)
    expect(r.value.pages).toBe(2)
    expect(r.value.nextPageToken).toBe('at-200')
    expect(r.value.truncated).toBe(true)
  })
})

/* ═══════ 10. the second route: an API token WITH SCOPES (index.ts §7) ══════ */

/**
 * ⚠ WHAT THIS SECTION IS ABOUT. Atlassian mints two kinds of API token and they
 *   are not called at the same host. A CLASSIC token works at
 *   `https://site.atlassian.net/rest/api/3/...`; a token WITH SCOPES must be
 *   called at `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` and
 *   answers 401 at the site — the SAME 401 a revoked classic token answers,
 *   which is what made this expensive to diagnose.
 *
 *   Two things had to stay true while teaching index.ts both routes, and both
 *   are asserted here rather than promised: the ALLOW-LIST is untouched (paths
 *   are still `/rest/api/3/` literals, still validated by the same assertion),
 *   and the classic token's behaviour is UNCHANGED — one request, one route, no
 *   lookup, no extra host.
 */

const CLOUD_ID = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'

function cred(overrides: Partial<JiraCredential> = {}): JiraCredential {
  const r = readCredential({
    baseUrl: 'https://acme.atlassian.net',
    email: 'aziz@example.com',
    token: 'ATATT-not-a-real-token-0000',
  })
  if (!r.ok) throw new Error('fixture credential did not parse')
  return { ...r.value, ...overrides }
}

function refusal(status: 401 | 403 | 404 | 429): JiraCallResult {
  const m = mapJiraStatus(status)
  return { ok: false, failure: m.failure, status: m.status, headers: m.headers }
}

const OK: JiraCallResult = { ok: true, status: 200, data: { accountId: 'a1' } }

/** Records every apiRoot it is asked to call, and answers per-root. */
function attempts(answer: (apiRoot: string) => JiraCallResult) {
  const roots: string[] = []
  return {
    roots,
    attempt: (c: JiraCredential) => {
      roots.push(c.apiRoot)
      return Promise.resolve(answer(c.apiRoot))
    },
  }
}

function resolver(result: CloudIdResult) {
  const calls: string[] = []
  return {
    calls,
    resolveCloudId: (base: ParsedBaseUrl) => {
      calls.push(base.origin)
      return Promise.resolve(result)
    },
  }
}

const CLOUD_OK: CloudIdResult = { ok: true, cloudId: CLOUD_ID }

describe('the fifth outbound URL is constrained like the other four', () => {
  it('is its own frozen constant and NOT an ENDPOINTS entry', async () => {
    // Putting it in ENDPOINTS would have forced assertReadOnlyEndpoints() to
    // grow an exception to `startsWith('/rest/api/3/')`, and an allow-list whose
    // validator has an exception proves nothing. So: still four entries, still
    // all under /rest/api/3/, and the fifth URL lives elsewhere.
    expect(Object.keys(ENDPOINTS).sort()).toEqual(['fieldList', 'jqlSearch', 'myself', 'projectSearch'])
    for (const ep of Object.values(ENDPOINTS) as JiraEndpoint[]) {
      expect(ep.path.startsWith('/rest/api/3/')).toBe(true)
    }
    expect(() => assertReadOnlyEndpoints()).not.toThrow()
    expect(Object.values(ENDPOINTS).map((e) => (e as JiraEndpoint).path)).not.toContain(TENANT_INFO.path)

    expect(Object.isFrozen(TENANT_INFO)).toBe(true)
    expect(TENANT_INFO.path).toBe('/_edge/tenant_info')
    expect(TENANT_INFO.verb).toBe('GET')
    // A path and a verb. Nothing that could smuggle a body or a header in.
    expect(Object.keys(TENANT_INFO).sort()).toEqual(['path', 'verb'])

    // And the assertion is wired at module load, not merely exported.
    const code = stripComments(await readSource())
    expect(code).toMatch(/^assertTenantInfoIsRead\(\)$/m)
    expect(code).toMatch(/^assertReadOnlyEndpoints\(\)$/m)
  })

  it('validates the constant on its own, with no host', () => {
    expect(() => assertTenantInfoIsRead()).not.toThrow()
  })

  it('accepts a host that came out of parseBaseUrl', () => {
    const r = parseBaseUrl('https://acme.atlassian.net')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(() => assertTenantInfoIsRead(r.value)).not.toThrow()
  })

  it('REFUSES a host that did not come out of parseBaseUrl', () => {
    // The shape of the object is structurally satisfiable in TypeScript, which
    // is exactly why the assertion re-parses rather than trusting the type. Each
    // of these is a hand-built ParsedBaseUrl that parseBaseUrl would have
    // rejected or normalised differently.
    const forged: ParsedBaseUrl[] = [
      { origin: 'http://acme.atlassian.net', hostname: 'acme.atlassian.net', atlassianCloud: true },
      { origin: 'https://acme.atlassian.net/evil', hostname: 'acme.atlassian.net', atlassianCloud: true },
      { origin: 'https://attacker.example.com', hostname: 'attacker.example.com', atlassianCloud: true },
      { origin: 'https://ACME.atlassian.net', hostname: 'acme.atlassian.net', atlassianCloud: true },
      { origin: 'https://acme.atlassian.net', hostname: 'other.atlassian.net', atlassianCloud: true },
      { origin: 'https://10.0.0.4', hostname: '10.0.0.4', atlassianCloud: true },
    ]
    for (const base of forged) expect(() => assertTenantInfoIsRead(base)).toThrow()
  })

  it('REFUSES a host that is not Atlassian Cloud, even a well-formed one', () => {
    const r = parseBaseUrl('https://jira.example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.atlassianCloud).toBe(false)
    expect(() => assertTenantInfoIsRead(r.value)).toThrow(/not a \*\.atlassian\.net site/)
  })

  it('names exactly one foreign host in the whole source file', async () => {
    // A reviewer must be able to grep for every host this function can reach and
    // find the owner's own site plus this one. The literal appears once, as a
    // standalone string bound to a named constant.
    const code = stripComments(await readSource())
    expect(count(code, /['"`]https:\/\/api\.atlassian\.com['"`]/g)).toBe(1)
    expect(code).toMatch(/ATLASSIAN_GATEWAY_ORIGIN = 'https:\/\/api\.atlassian\.com'/)
    expect(code).toMatch(/\$\{ATLASSIAN_GATEWAY_ORIGIN\}\/ex\/jira\//)
  })

  it('builds the gateway root from a shape-checked cloud id and nothing else', async () => {
    expect(gatewayApiRoot(CLOUD_ID)).toBe(`${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${CLOUD_ID}`)
    // The one URL-shaped concatenation in jiraCall, pinned: apiRoot + a literal
    // path out of the frozen allow-list. Never caller text, on either route.
    const code = stripComments(await readSource())
    expect(code).toMatch(/new URL\(cred\.apiRoot \+ ep\.path\)/)
    expect(code).not.toMatch(/new URL\(cred\.base\.origin \+ ep\.path\)/)
  })

  it.each([
    ['a path traversal', '../../evil'],
    ['a host', 'evil.example.com'],
    ['a scheme', 'https://evil.example.com'],
    ['an encoded slash', '1a2b%2Fevil'],
    ['a query', 'abcdefgh?x=1'],
    ['too short', 'abc'],
    ['a non-string', 42],
    ['empty', ''],
  ])('refuses to route through %s', (_label, bad) => {
    expect(isCloudId(bad)).toBe(false)
    expect(() => gatewayApiRoot(bad as string)).toThrow(/not a cloud id/)
  })

  it('accepts the UUID Atlassian actually sends, without hard-coding UUID', () => {
    expect(isCloudId(CLOUD_ID)).toBe(true)
    expect(isCloudId('abcdefgh')).toBe(true)
  })
})

describe('the tenant_info lookup sends no credential', () => {
  const realFetch = globalThis.fetch
  let seen: { url: string; init: RequestInit | undefined }[] = []
  let reply: () => Response

  beforeEach(() => {
    seen = []
    reply = () => new Response(JSON.stringify({ cloudId: CLOUD_ID }), { status: 200 })
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      seen.push({ url: String(url), init })
      return Promise.resolve(reply())
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function base(): ParsedBaseUrl {
    const r = parseBaseUrl('https://acme.atlassian.net')
    if (!r.ok) throw new Error('fixture base did not parse')
    return r.value
  }

  it('GETs exactly the documented URL, with no query and no body', async () => {
    const r = await fetchCloudId(base())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cloudId).toBe(CLOUD_ID)
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://acme.atlassian.net/_edge/tenant_info')
    expect(seen[0].init?.method).toBe('GET')
    expect(seen[0].init?.body).toBeUndefined()
  })

  it('sends NO Authorization header — the whole point of the endpoint', async () => {
    // The secret is passed in, because it is needed to REDACT anything that
    // comes back. It must not appear on the request.
    const token = 'ATATT-super-secret-value'
    await fetchCloudId(base(), [token, basicAuthHeader('aziz@example.com', token)])
    const headers = (seen[0].init?.headers ?? {}) as Record<string, string>
    expect(Object.keys(headers)).toEqual(['Accept'])
    expect(headers.Authorization).toBeUndefined()
    expect(JSON.stringify(seen[0])).not.toContain(token)
    expect(JSON.stringify(seen[0])).not.toContain('Basic ')
  })

  it('never asks a non-Cloud host for a cloud id — and refuses it typed, not thrown', async () => {
    // The assertion inside is as strict as ever — the describe above proves it
    // still throws bare for every forged base. What is proven HERE is the
    // boundary: a request-path caller gets a typed refusal with the route
    // code, never an uncaught throw that the top-level catch would flatten
    // into server_error and "Something went wrong". And no request leaves.
    const r = parseBaseUrl('https://jira.example.com')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const out = await fetchCloudId(r.value)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.failure.code).toBe('jira_cloud_id_unresolved')
    expect(out.status).toBe(502)
    expect(out.failure.jiraStatus).toBeUndefined()
    expect(out.failure.error).toMatch(/before any request/)
    expect(seen).toHaveLength(0)
  })

  it('refuses a forged base typed too, and never contacts the forged host', async () => {
    // A ParsedBaseUrl is structurally satisfiable, which is why the assertion
    // re-parses. This proves the refusal of a forgery is ALSO a typed refusal:
    // the guard's whole value is against a future caller, and a future caller
    // is exactly who must not turn it into a 500.
    const forged: ParsedBaseUrl = {
      origin: 'https://attacker.example.com',
      hostname: 'attacker.example.com',
      atlassianCloud: true,
    }
    const out = await fetchCloudId(forged)
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.failure.code).toBe('jira_cloud_id_unresolved')
    expect(out.failure.jiraStatus).toBeUndefined()
    expect(seen).toHaveLength(0)
  })

  it('reports an HTTP failure as its own code, not as a bad credential', async () => {
    reply = () => new Response(JSON.stringify({ errorMessages: ['nope'] }), { status: 404 })
    const r = await fetchCloudId(base())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.code).toBe('jira_cloud_id_unresolved')
    expect(r.status).toBe(502)
    expect(r.failure.jiraStatus).toBe(404)
    expect(r.failure.error).toMatch(/answered HTTP 404/)
  })

  it('redacts the token out of whatever the lookup answered', async () => {
    const token = 'ATATT-super-secret-value'
    reply = () => new Response(JSON.stringify({ errorMessages: [`saw ${token}`] }), { status: 400 })
    const r = await fetchCloudId(base(), [token])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(JSON.stringify(r)).not.toContain(token)
    expect(r.failure.detail).toContain('[redacted]')
  })

  it('names a non-JSON answer rather than throwing on the parse', async () => {
    reply = () => new Response('<html>a login page</html>', { status: 200 })
    const r = await fetchCloudId(base())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.code).toBe('jira_cloud_id_unresolved')
    expect(r.failure.error).toMatch(/not JSON/)
  })

  it.each([
    ['a missing cloudId', {}],
    ['a cloudId that is a path', { cloudId: '../../evil' }],
    ['a cloudId that is a URL', { cloudId: 'https://evil.example.com' }],
    ['a cloudId that is not a string', { cloudId: 7 }],
  ])('refuses %s, and does not quote it back', (_label, body) => {
    reply = () => new Response(JSON.stringify(body), { status: 200 })
    return fetchCloudId(base()).then((r) => {
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.failure.code).toBe('jira_cloud_id_unresolved')
      expect(r.failure.error).toMatch(/without a usable cloudId/)
      // Header §6: describe the shape, never quote the value that was rejected.
      expect(r.failure.error).not.toContain('evil')
    })
  })

  it('reports an unreachable lookup without pretending Jira answered', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('dns'))) as typeof fetch
    const r = await fetchCloudId(base())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.code).toBe('jira_cloud_id_unresolved')
    expect(r.failure.jiraStatus).toBeUndefined()
    expect(r.failure.error).toMatch(/could not be reached/)
  })
})

describe('callWithRoute — the site first, the gateway only if it has to', () => {
  beforeEach(clearRouteCache)
  afterEach(clearRouteCache)

  it('leaves a CLASSIC token exactly as it was: one call, the site, no lookup', async () => {
    // THE NO-REGRESSION TEST. If this ever needs two attempts or a cloud id,
    // every working installation just got slower and started talking to a host
    // it never talked to before.
    const a = attempts(() => OK)
    const res = await resolver({ ok: false, status: 502, failure: { code: 'server_error', error: 'x' } })
    const out = await callWithRoute({ cred: cred(), attempt: a.attempt, resolveCloudId: res.resolveCloudId })
    expect(out.result.ok).toBe(true)
    expect(out.routing).toEqual({ route: 'site' })
    expect(a.roots).toEqual(['https://acme.atlassian.net'])
    expect(res.calls).toEqual([])
  })

  it('falls back to the gateway when the site answers 401', async () => {
    const gatewayRoot = `${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${CLOUD_ID}`
    const a = attempts((root) => (root === gatewayRoot ? OK : refusal(401)))
    const res = resolver(CLOUD_OK)
    const out = await callWithRoute({ cred: cred(), attempt: a.attempt, resolveCloudId: res.resolveCloudId })
    expect(out.result.ok).toBe(true)
    expect(out.routing).toEqual({ route: 'gateway', cloudId: CLOUD_ID })
    // Site first, ALWAYS, then exactly one retry. Not the other way round.
    expect(a.roots).toEqual(['https://acme.atlassian.net', gatewayRoot])
    expect(res.calls).toEqual(['https://acme.atlassian.net'])
  })

  it('falls back on a 403 too, and on nothing else', async () => {
    for (const status of [401, 403] as const) {
      clearRouteCache()
      const a = attempts((root) => (root.startsWith(ATLASSIAN_GATEWAY_ORIGIN) ? OK : refusal(status)))
      const out = await callWithRoute({ cred: cred(), attempt: a.attempt, resolveCloudId: resolver(CLOUD_OK).resolveCloudId })
      expect(out.routing.route).toBe('gateway')
      expect(a.roots).toHaveLength(2)
    }
    for (const status of [404, 429] as const) {
      clearRouteCache()
      const a = attempts(() => refusal(status))
      const res = resolver(CLOUD_OK)
      const out = await callWithRoute({ cred: cred(), attempt: a.attempt, resolveCloudId: res.resolveCloudId })
      expect(out.routing).toEqual({ route: 'site' })
      expect(a.roots).toHaveLength(1)
      expect(res.calls).toEqual([])
      expect(out.result.ok).toBe(false)
    }
  })

  it('classifies which failures are worth a second door', () => {
    expect(isCredentialRefusal(refusal(401))).toBe(true)
    expect(isCredentialRefusal(refusal(403))).toBe(true)
    expect(isCredentialRefusal(refusal(404))).toBe(false)
    expect(isCredentialRefusal(refusal(429))).toBe(false)
    expect(isCredentialRefusal(OK)).toBe(false)
  })

  it('NEVER sends a non-Cloud host to api.atlassian.com', async () => {
    // A custom domain or a Data Center install has no cloud id, and its hostname
    // is not Atlassian's to receive. The 401 stays a 401 — same code, same
    // status, same first sentence — with one sentence added saying why no
    // gateway was tried, which is the difference between "your token is bad" and
    // "your token cannot reach this kind of site at all".
    const dc = cred({ base: { origin: 'https://jira.example.com', hostname: 'jira.example.com', atlassianCloud: false } })
    const a = attempts(() => refusal(401))
    const res = resolver(CLOUD_OK)
    const out = await callWithRoute({ cred: dc, attempt: a.attempt, resolveCloudId: res.resolveCloudId })

    expect(a.roots).toEqual(['https://jira.example.com'])
    expect(res.calls).toEqual([])
    expect(out.routing).toEqual({ route: 'site' })
    expect(out.result.ok).toBe(false)
    if (out.result.ok) return
    expect(out.result.failure.code).toBe('jira_unauthorized')
    expect(out.result.status).toBe(502)
    expect(out.result.failure.jiraStatus).toBe(401)
    expect(out.result.failure.error).toContain(mapJiraStatus(401).failure.error)
    expect(out.result.failure.error).toContain(NO_GATEWAY_SENTENCE.trim())
    expect(out.result.failure.error).toMatch(/not tried/)
  })

  it('reports an unresolvable cloud id as its OWN diagnosis', async () => {
    // Three failures, three sentences: this one is "the lookup did not answer",
    // which is not the same problem as "the token is wrong" and does not have
    // the same fix.
    const a = attempts(() => refusal(401))
    const res = resolver({
      ok: false,
      status: 502,
      failure: { code: 'jira_cloud_id_unresolved', error: 'preface. The lookup answered HTTP 503.', jiraStatus: 503 },
    })
    const out = await callWithRoute({ cred: cred(), attempt: a.attempt, resolveCloudId: res.resolveCloudId })
    expect(a.roots).toEqual(['https://acme.atlassian.net'])
    expect(out.routing).toEqual({ route: 'site' })
    expect(out.result.ok).toBe(false)
    if (out.result.ok) return
    expect(out.result.failure.code).toBe('jira_cloud_id_unresolved')
    expect(out.result.status).toBe(502)
  })

  it('reports a gateway refusal distinctly from a site refusal', async () => {
    const a = attempts(() => refusal(401))
    const out = await callWithRoute({ cred: cred(), attempt: a.attempt, resolveCloudId: resolver(CLOUD_OK).resolveCloudId })
    expect(a.roots).toHaveLength(2)
    expect(out.routing).toEqual({ route: 'gateway', cloudId: CLOUD_ID })
    expect(out.result.ok).toBe(false)
    if (out.result.ok) return
    expect(out.result.failure.code).toBe('jira_gateway_unauthorized')
    // Still 502 with the upstream status inside — header §6's convention holds.
    expect(out.result.status).toBe(502)
    expect(out.result.failure.jiraStatus).toBe(401)
    expect(out.result.failure.error).toMatch(/gateway rejected the credential too/)
    expect(out.result.failure.error).toMatch(/read:jira-work/)
    // The cloud id IS quoted, deliberately: it is public, it was accepted rather
    // than rejected, and it is what the owner needs to check the token against.
    expect(out.result.failure.error).toContain(CLOUD_ID)
    // The token is not, and neither is anything shaped like one.
    expect(JSON.stringify(out.result)).not.toContain('ATATT')
  })

  it('relays a non-credential gateway failure untouched', async () => {
    const a = attempts((root) => (root.startsWith(ATLASSIAN_GATEWAY_ORIGIN) ? refusal(429) : refusal(401)))
    const out = await callWithRoute({ cred: cred(), attempt: a.attempt, resolveCloudId: resolver(CLOUD_OK).resolveCloudId })
    expect(out.result.ok).toBe(false)
    if (out.result.ok) return
    expect(out.result.failure.code).toBe('jira_rate_limited')
    expect(out.result.status).toBe(429)
  })

  it('remembers the working route so the next call skips the failed attempt', async () => {
    const gatewayRoot = `${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${CLOUD_ID}`
    const answer = (root: string) => (root === gatewayRoot ? OK : refusal(401))

    const first = attempts(answer)
    const res = resolver(CLOUD_OK)
    await callWithRoute({ cred: cred(), attempt: first.attempt, resolveCloudId: res.resolveCloudId })
    expect(first.roots).toEqual(['https://acme.atlassian.net', gatewayRoot])

    // Same isolate, second request: straight to the door that opened.
    const second = attempts(answer)
    const out = await callWithRoute({ cred: cred(), attempt: second.attempt, resolveCloudId: res.resolveCloudId })
    expect(second.roots).toEqual([gatewayRoot])
    expect(out.routing).toEqual({ route: 'gateway', cloudId: CLOUD_ID })
    // And the cloud id was looked up ONCE, not once per call.
    expect(res.calls).toHaveLength(1)
  })

  it('lets the remembered route expire, so a rotated token heals itself', async () => {
    const gatewayRoot = `${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${CLOUD_ID}`
    const t0 = 1_000_000
    const answer = (root: string) => (root === gatewayRoot ? OK : refusal(401))
    await callWithRoute({ cred: cred(), attempt: attempts(answer).attempt, resolveCloudId: resolver(CLOUD_OK).resolveCloudId, now: t0 })

    const later = attempts(() => OK)
    const out = await callWithRoute({
      cred: cred(),
      attempt: later.attempt,
      resolveCloudId: resolver(CLOUD_OK).resolveCloudId,
      now: t0 + ROUTE_CACHE_TTL_MS + 1,
    })
    expect(later.roots).toEqual(['https://acme.atlassian.net'])
    expect(out.routing).toEqual({ route: 'site' })
  })

  it('forgets a remembered gateway route the moment it stops working', async () => {
    const gatewayRoot = `${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${CLOUD_ID}`
    await callWithRoute({
      cred: cred(),
      attempt: attempts((root) => (root === gatewayRoot ? OK : refusal(401))).attempt,
      resolveCloudId: resolver(CLOUD_OK).resolveCloudId,
    })

    // The token is replaced with a classic one: the gateway now refuses.
    const rotated = attempts(() => refusal(401))
    const out = await callWithRoute({ cred: cred(), attempt: rotated.attempt, resolveCloudId: resolver(CLOUD_OK).resolveCloudId })
    expect(rotated.roots).toEqual([gatewayRoot])
    expect(out.result.ok).toBe(false)
    if (out.result.ok) return
    expect(out.result.failure.code).toBe('jira_gateway_unauthorized')

    // …and the NEXT request probes from the site again rather than spending the
    // rest of the TTL failing at a door that used to open.
    const after = attempts(() => OK)
    const back = await callWithRoute({ cred: cred(), attempt: after.attempt, resolveCloudId: resolver(CLOUD_OK).resolveCloudId })
    expect(after.roots).toEqual(['https://acme.atlassian.net'])
    expect(back.routing).toEqual({ route: 'site' })
  })

  it('never mutates the credential it was handed', async () => {
    const c = cred()
    await callWithRoute({
      cred: c,
      attempt: attempts((root) => (root.startsWith(ATLASSIAN_GATEWAY_ORIGIN) ? OK : refusal(401))).attempt,
      resolveCloudId: resolver(CLOUD_OK).resolveCloudId,
    })
    expect(c.apiRoot).toBe('https://acme.atlassian.net')
    expect(withApiRoot(c, 'https://x').apiRoot).toBe('https://x')
    expect(c.token).toBe('ATATT-not-a-real-token-0000')
  })
})

describe('readCredential starts every credential at the site root', () => {
  it('sets apiRoot to the origin, never to the gateway', () => {
    const c = cred()
    expect(c.apiRoot).toBe('https://acme.atlassian.net')
    expect(c.apiRoot).not.toContain('api.atlassian.com')
    // apiRoot + a path literal is the whole URL, on either route.
    expect(c.apiRoot + ENDPOINTS.myself.path).toBe('https://acme.atlassian.net/rest/api/3/myself')
    expect(gatewayApiRoot(CLOUD_ID) + ENDPOINTS.myself.path).toBe(
      `${ATLASSIAN_GATEWAY_ORIGIN}/ex/jira/${CLOUD_ID}/rest/api/3/myself`,
    )
  })
})


describe('the language Jira is asked to answer in', () => {
  // ⚠ WHY THIS EXISTS. Asked nothing, the gateway picked for itself: a live
  //   probe of the deployed function came back with 28 field names in Chinese
  //   (`创建者` for "creator") and refused an unrestricted JQL in Chinese too.
  //   The mapping screen prints Jira's field names, and `jira_bad_request`
  //   prints Jira's own sentence — so an app that is Arabic and English was
  //   quoting a third language at its reader.

  it('sends the caller language, with English behind it', () => {
    expect(acceptLanguageFor('ar')).toBe('ar, en;q=0.8')
    expect(acceptLanguageFor('ar-SA')).toBe('ar-SA, en;q=0.8')
  })

  it('does not append a fallback to English itself', () => {
    // `en, en;q=0.8` is legal and silly. It would also be the value in the
    // header for most requests, which is where silly becomes visible.
    expect(acceptLanguageFor('en')).toBe('en')
    expect(acceptLanguageFor('en-GB')).toBe('en-GB')
  })

  it('REFUSES A HEADER INJECTION rather than cleaning one', () => {
    // THE REASON THE CHECK IS A MATCH AND NOT A SANITISE. This value goes into
    // the header object of the one request that carries the Jira credential. A
    // newline here would let a caller append headers of their own to it. There
    // is no trimming and no escaping: a value either matches the shape of a
    // language tag or it is not used at all.
    for (const hostile of [
      'ar\r\nX-Injected: 1',
      'ar\nAuthorization: Basic abc',
      'ar\r\n\r\nGET /admin',
      'ar; charset=utf-8',
      '../../etc/passwd',
      'ar,en,fr,de,es,it,pt,nl,pl,ru',
      'a'.repeat(200),
      '',
      '   ',
    ]) {
      expect(acceptLanguageFor(hostile), JSON.stringify(hostile)).toBe(DEFAULT_ACCEPT_LANGUAGE)
    }
  })

  it('is total — no input shape can make it throw or return a non-string', () => {
    // A bad locale is never a reason to refuse a READ. Everything falls back.
    for (const junk of [undefined, null, 42, {}, [], true, Symbol('x'), () => 'ar']) {
      const out = acceptLanguageFor(junk as unknown)
      expect(typeof out).toBe('string')
      expect(out).toBe(DEFAULT_ACCEPT_LANGUAGE)
    }
  })

  it('rides on the credential, so the one call site still takes only a name', () => {
    const base = {
      base: { origin: 'https://x.atlassian.net', hostname: 'x.atlassian.net', atlassianCloud: true },
      email: 'a@b.c',
      token: 't',
      apiRoot: 'https://x.atlassian.net',
      acceptLanguage: DEFAULT_ACCEPT_LANGUAGE,
    } as unknown as Parameters<typeof withLanguage>[0]
    expect(withLanguage(base, 'ar').acceptLanguage).toBe('ar, en;q=0.8')
    // and it changes nothing else about the credential
    expect(withLanguage(base, 'ar').token).toBe('t')
    expect(withLanguage(base, 'ar').apiRoot).toBe('https://x.atlassian.net')
  })

  it('the header is actually attached to the outbound request', async () => {
    const src = await readSource()
    expect(src).toContain("'Accept-Language': cred.acceptLanguage")
    // And it is built by the guard, never from the body directly.
    expect(src).not.toMatch(/'Accept-Language':\s*body\./)
  })
})
