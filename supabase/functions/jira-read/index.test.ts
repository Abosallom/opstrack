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
// has a credential, by design. `jiraCall()` is not exercised at all: no network
// call is made, no page is followed, and the paging loop in `opSearch` is
// therefore UNPROVEN except by reading. The first honest test of that is Aziz
// pressing `ping` against his own site. Said plainly here rather than implied
// by a green suite.

import { describe, expect, it } from 'vitest'

import {
  ENDPOINTS,
  DEFAULT_SEARCH_FIELDS,
  FIELDS_PER_SEARCH,
  JQL_MAX_LENGTH,
  PROJECTS_MAX_RESULTS,
  SEARCH_DEFAULT_RESULTS,
  SEARCH_MAX_RESULTS,
  assertReadOnlyEndpoints,
  basicAuthHeader,
  clampCount,
  clampOffset,
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
  summarizeJiraError,
  validateFields,
  validateJql,
  validatePageToken,
  type JiraEndpoint,
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
  it('calls fetch exactly once, and only through jiraCall', async () => {
    const code = stripComments(await readSource())
    expect(count(code, /\bfetch\s*\(/g)).toBe(1)
    expect(count(code, /\bawait fetch\(/g)).toBe(1)
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
    // secret check placed first answers a stranger with `missing_secret`
    // (which of the three Jira variables are set) and, through `bad_base_url`,
    // with the literal value it rejected. If someone ever pastes the TOKEN into
    // the wrong secret box, "secrets first" echoes it to an unauthenticated
    // caller. Pinned by position because a reorder is exactly the kind of tidy
    // edit that reads like an improvement.
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

  it("accepts Jira's own wildcards", () => {
    const r = validateFields(['*all'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual(['*all'])
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
