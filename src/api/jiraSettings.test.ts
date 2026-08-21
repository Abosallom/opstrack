import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readStatusMap } from './jiraSettings'

// WHAT THIS FILE PINS. Six things about api/jiraSettings.ts are decisions rather
// than mechanics, and not one of them is visible to the type checker:
//
//   · the nullable-client guard is the FIRST statement of both functions, so a
//     build without credentials degrades into a readable message;
//   · `status_map` is validated ON READ — unknown values are DROPPED and
//     COUNTED, never coerced into the nearest of our three;
//   · "nobody has saved a configuration" is `settings: null` and NOT an error,
//     which is why the read is `.maybeSingle()`;
//   · `enabled` is strict-equality true, so anything else reads as OFF — the
//     off-switch fails closed on every path, including a row shaped by an older
//     column set;
//   · the write is an UPSERT on the singleton id, sends that id explicitly, and
//     sends neither `updated_at` nor `updated_by` (0028's trigger owns them);
//   · a refusal NEVER carries the value it refused — the error is an i18n key,
//     and the site address a person typed does not appear in it.
//
// The store's own consumers fake this module wholesale; this is the only place
// the request shapes are looked at.

/** One `.from()` chain, as the fake client saw it. */
interface Call {
  table: string
  ops: [string, unknown[]][]
}

interface FakeBuilder {
  select: (...args: unknown[]) => FakeBuilder
  upsert: (...args: unknown[]) => FakeBuilder
  eq: (...args: unknown[]) => FakeBuilder
  single: (...args: unknown[]) => FakeBuilder
  maybeSingle: (...args: unknown[]) => FakeBuilder
  then: (onfulfilled?: (v: unknown) => unknown) => Promise<unknown>
}

let calls: Call[] = []
let answer: { data: unknown; error: unknown } = { data: null, error: null }

/**
 * A recording stand-in for the PostgREST query builder.
 *
 * Thenable rather than a resolved promise, mirroring postgrest-js: nothing
 * reaches the network until something subscribes, so a chain that is built and
 * dropped records no `then` and is visibly incomplete. api/labels.test.ts's
 * fake, with `maybeSingle` added — which is itself one of the things under test.
 */
function makeBuilder(table: string): FakeBuilder {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const record =
    (name: string) =>
    (...args: unknown[]): FakeBuilder => {
      call.ops.push([name, args])
      return builder
    }
  const builder: FakeBuilder = {
    select: record('select'),
    upsert: record('upsert'),
    eq: record('eq'),
    single: record('single'),
    maybeSingle: record('maybeSingle'),
    then: (onfulfilled) => {
      call.ops.push(['then', []])
      return Promise.resolve(answer).then(onfulfilled)
    },
  }
  return builder
}

const fakeClient = { from: (table: string) => makeBuilder(table) }

/**
 * A fresh copy of the module bound to a client that either exists or does not.
 * `supabase` is a const binding captured at import, so switching it means
 * re-importing — hence doMock (not hoisted) plus resetModules.
 */
async function loadApi(configured = true): Promise<typeof import('./jiraSettings')> {
  vi.resetModules()
  vi.doMock('./supabase', () => ({
    supabase: configured ? fakeClient : null,
    isConfigured: () => configured,
  }))
  return await import('./jiraSettings')
}

/** The args a chain passed to one builder method, or undefined if never called. */
function argsOf(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([op]) => op === name)?.[1]
}

function names(call: Call): string[] {
  return call.ops.map(([op]) => op)
}

/** A stored row as PostgREST would hand it back. */
const ROW = {
  id: '00000000-0000-0000-0000-000000000028',
  site_base_url: 'https://example.atlassian.net',
  organization_field: 'customfield_10050',
  use_case_field: 'customfield_10051',
  status_field: 'status',
  status_map: { Done: 'live', 'In Progress': 'testing' },
  fold_arabic: true,
  jql: 'project = NPH ORDER BY updated DESC',
  enabled: true,
  updated_at: '2026-08-13T10:00:00Z',
  updated_by: 'e3b0c442-0000-4000-8000-000000000001',
}

const INPUT = {
  siteBaseUrl: 'https://example.atlassian.net',
  organizationField: 'customfield_10050',
  useCaseField: 'customfield_10051',
  statusField: 'status',
  statusMap: { Done: 'live' as const },
  foldArabic: false,
  jql: 'project = NPH',
  enabled: false,
}

beforeEach(() => {
  calls = []
  answer = { data: null, error: null }
})

/* ══════════════════ 1. the guard every api module opens with ══════════════ */

describe('the nullable-client guard is the first statement of both functions', () => {
  it('returns common.notConfigured and touches nothing', async () => {
    const api = await loadApi(false)

    const results = [await api.loadJiraSettings(), await api.saveJiraSettings(INPUT)]
    for (const result of results) {
      expect(result).toEqual({ ok: false, error: 'common.notConfigured' })
    }
    expect(calls).toHaveLength(0)
  })
})

/* ═══════════ 2. status_map: dropped and counted, never coerced ════════════ */

describe('readStatusMap', () => {
  it('keeps the three values this app records', () => {
    expect(readStatusMap({ a: 'planned', b: 'testing', c: 'live' })).toEqual({
      statusMap: { a: 'planned', b: 'testing', c: 'live' },
      dropped: 0,
    })
  })

  it('DROPS an unknown value and COUNTS it, rather than coercing it', () => {
    // The coded-values trap, in one assertion. The day `UseCaseStatus` is
    // replaced by the stage ladder, every saved value becomes unreadable while
    // the KEYS still normalise perfectly — so nothing else in the app notices.
    // 'in-review' must not become 'testing': the nearest of our three is a
    // status on a hospital's integration record that nobody chose, and it would
    // look exactly like a mapping the owner made.
    const { statusMap, dropped } = readStatusMap({
      Done: 'live',
      Reviewing: 'in-review',
      Blocked: 'stalled',
    })
    expect(statusMap).toEqual({ Done: 'live' })
    expect(dropped).toBe(2)
  })

  it('drops a value that is not a string at all', () => {
    // A hand-edited row, or a shape from some later schema: null, a number and a
    // nested object are all "not one of ours" and all counted.
    expect(readStatusMap({ a: null, b: 7, c: { nested: 'live' }, d: 'planned' })).toEqual({
      statusMap: { d: 'planned' },
      dropped: 3,
    })
  })

  it('leaves the keys exactly as saved, spacing and case included', () => {
    // The keys are HIS words. Matching them against a Jira status is
    // normalizeName's job in src/lib/jira/map.ts, where two keys that normalise
    // alike are REPORTED as a conflict rather than silently resolved by
    // whichever happened to be last. Normalising here would resolve that
    // conflict by accident and hide it forever.
    const { statusMap } = readStatusMap({ 'In  Progress': 'testing', 'in progress': 'planned' })
    expect(Object.keys(statusMap).sort()).toEqual(['In  Progress', 'in progress'])
  })

  it('reads a non-object as an empty mapping with nothing dropped', () => {
    // There are no PAIRS to count, so 0 is the honest answer rather than a
    // shrug — and 0028's jira_settings_status_map_chk makes the state
    // unreachable through the database anyway.
    for (const raw of [null, undefined, 'live', 42, ['live']]) {
      expect(readStatusMap(raw)).toEqual({ statusMap: {}, dropped: 0 })
    }
  })
})

/* ═════════════════════════ 3. loading the one row ════════════════════════ */

describe('loadJiraSettings', () => {
  it('asks for the named columns of the one row, and tolerates its absence', async () => {
    const api = await loadApi()
    const result = await api.loadJiraSettings()

    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('jira_settings')
    // `.maybeSingle()`, never `.single()`: "nobody has configured Jira" is this
    // table's SHIPPING state, and `.single()` calls zero rows the error
    // PGRST116 — a red banner on the Settings page of every workspace that has
    // never used Jira.
    expect(names(calls[0])).toContain('maybeSingle')
    expect(names(calls[0])).not.toContain('single')
    expect(argsOf(calls[0], 'eq')).toEqual(['id', '00000000-0000-0000-0000-000000000028'])
    // Named columns rather than '*', so the row type cannot drift from the query.
    expect(String(argsOf(calls[0], 'select')?.[0])).toContain('status_map')

    // The absence is an ANSWER, not a failure — and the screens name it.
    expect(result).toEqual({ ok: true, data: { settings: null, droppedStatuses: 0 } })
  })

  it('reads a stored row into what the screens hold', async () => {
    answer = { data: ROW, error: null }
    const api = await loadApi()
    const result = await api.loadJiraSettings()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings).toEqual({
      siteBaseUrl: 'https://example.atlassian.net',
      organizationField: 'customfield_10050',
      useCaseField: 'customfield_10051',
      statusField: 'status',
      statusMap: { Done: 'live', 'In Progress': 'testing' },
      foldArabic: true,
      jql: 'project = NPH ORDER BY updated DESC',
      enabled: true,
      updatedAt: '2026-08-13T10:00:00Z',
      updatedBy: 'e3b0c442-0000-4000-8000-000000000001',
    })
    expect(result.data.droppedStatuses).toBe(0)
  })

  it('reads anything that is not literally true as OFF', async () => {
    // THE OFF-SWITCH FAILS CLOSED, on every path. A row written by an older
    // column set has no `enabled` at all; a hand-edited one might carry the
    // STRING 'false', which is truthy in JavaScript and would turn every Jira
    // surface in the app on.
    for (const enabled of [undefined, null, 'false', 'true', 0, 1]) {
      answer = { data: { ...ROW, enabled }, error: null }
      const api = await loadApi()
      const result = await api.loadJiraSettings()
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.settings?.enabled, String(enabled)).toBe(false)
    }
  })

  it('reads a blank site address as null, so "no link" has one spelling', async () => {
    answer = { data: { ...ROW, site_base_url: '' }, error: null }
    const api = await loadApi()
    const result = await api.loadJiraSettings()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings?.siteBaseUrl).toBeNull()
  })

  it('counts the dropped statuses of a stored row', async () => {
    answer = { data: { ...ROW, status_map: { Done: 'live', Reviewing: 'in-review' } }, error: null }
    const api = await loadApi()
    const result = await api.loadJiraSettings()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings?.statusMap).toEqual({ Done: 'live' })
    expect(result.data.droppedStatuses).toBe(1)
  })
})

/* ═══════════════════════ 4. saving the one row ═══════════════════════════ */

describe('saveJiraSettings', () => {
  it('upserts the singleton by id and lets the database own the timestamps', async () => {
    answer = { data: ROW, error: null }
    const api = await loadApi()
    await api.saveJiraSettings(INPUT)

    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('jira_settings')
    const [row, options] = argsOf(calls[0], 'upsert') as [Record<string, unknown>, unknown]

    // The id is SENT rather than left to the column default, so this file and
    // 0028's jira_settings_singleton_chk name the same row in the same words.
    expect(row.id).toBe('00000000-0000-0000-0000-000000000028')
    expect(options).toEqual({ onConflict: 'id' })

    // Server-owned: 0028's touch trigger overrules a client value on insert and
    // pins it back on a save that changed nothing, so sending either is
    // ceremony the database undoes.
    expect(row).not.toHaveProperty('updated_at')
    expect(row).not.toHaveProperty('updated_by')
  })

  it('sends a blank site address as NULL and leaves the JQL byte for byte', async () => {
    answer = { data: ROW, error: null }
    const api = await loadApi()
    await api.saveJiraSettings({
      ...INPUT,
      siteBaseUrl: '   ',
      // Trailing content in a query language is not whitespace nobody wanted; a
      // screen that rewrites what somebody typed into a query box stops being
      // trustworthy, and 0028 bounds the length rather than editing the text.
      jql: '  project = NPH  ',
    })

    const [row] = argsOf(calls[0], 'upsert') as [Record<string, unknown>]
    expect(row.site_base_url).toBeNull()
    expect(row.jql).toBe('  project = NPH  ')
  })

  it('answers with the row as STORED, dropping and counting there too', async () => {
    // The difference between a screen that shows what it saved and one that
    // shows what it sent. The drop is reported at the moment of saving, where
    // the person can still go and re-pick the word.
    answer = {
      data: { ...ROW, status_map: { Done: 'live', Reviewing: 'in-review' }, enabled: false },
      error: null,
    }
    const api = await loadApi()
    const result = await api.saveJiraSettings({ ...INPUT, enabled: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings?.enabled).toBe(false)
    expect(result.data.droppedStatuses).toBe(1)
  })
})

/* ═════════════ 5. failures are keys, and never echo the value ═════════════ */

describe('failures', () => {
  it('map 0028 constraints to their own sentences', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        { code: '23514', message: 'violates check constraint "jira_settings_site_base_url_chk"' },
        'jiraconfig.errBadSiteUrl',
      ],
      [
        { code: '23514', message: 'violates check constraint "jira_settings_singleton_chk"' },
        'jiraconfig.errSingleton',
      ],
      [
        { code: '23505', details: 'Key (id) already exists in "jira_settings_pkey"' },
        'jiraconfig.errSingleton',
      ],
      [
        { code: '23514', message: 'violates check constraint "jira_settings_jql_len_chk"' },
        'jiraconfig.errJqlTooLong',
      ],
      [
        { code: '23514', message: 'violates check constraint "jira_settings_field_len_chk"' },
        'jiraconfig.errFieldTooLong',
      ],
      [
        { code: '23514', message: 'violates check constraint "jira_settings_status_map_chk"' },
        'jiraconfig.errStatusMapShape',
      ],
      // 0028 not applied. The store keeps `jiraSettings` null on this, so the
      // off-switch stays off — which is what makes shipping this client half
      // before the migration is applied safe.
      [{ code: 'PGRST205', message: 'Could not find the table' }, 'common.errMissingTable'],
      // A member who reached this write anyway: RLS refuses, and the sentence
      // is about permission rather than about Jira.
      [{ code: '42501', message: 'new row violates row-level security policy' }, 'admin.errForbidden'],
    ]

    for (const [error, key] of cases) {
      answer = { data: null, error }
      const api = await loadApi()
      const result = await api.saveJiraSettings(INPUT)
      expect(result, key).toEqual({ ok: false, error: key })
    }
  })

  it('never carry the value that was refused', async () => {
    // Fable #2's lesson, applied here rather than only at the edge function: a
    // screen that helpfully prints back what it just refused prints it into a
    // shared browser, a screenshot and a support ticket. The error is a KEY,
    // interpolating nothing, so the address a person typed cannot ride out on
    // it — and this asserts the property rather than trusting the shape.
    const secretish = 'https://acme-internal.atlassian.net/?token=zzzz'
    answer = {
      data: null,
      error: {
        code: '23514',
        message: `new row for relation "jira_settings" violates check constraint "jira_settings_site_base_url_chk"`,
        details: `Failing row contains (${secretish})`,
      },
    }
    const api = await loadApi()
    const result = await api.saveJiraSettings({ ...INPUT, siteBaseUrl: secretish })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('jiraconfig.errBadSiteUrl')
    expect(result.error).not.toContain('acme-internal')
    expect(result.error).not.toContain('token')
  })
})
