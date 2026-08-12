// Proof for /settings/jira — the promise, the resolver, the shell the screen
// first paints, and the two locale files it is made of.
//
// WHY renderToStaticMarkup AND NOT A DOM: the reason every sibling page test
// gives. vitest.config.ts is `environment: 'node'`, there is no jsdom and no
// testing-library, and react-dom/server runs the real component, the real hooks,
// the real class names and the real translator.
//
// ── WHERE THE WEIGHT OF THIS FILE SITS ─────────────────────────────────────
//
// FIRST, THE PROMISE. The owner asked to read from Jira "without changing
// anything", and this file is where that stops being a claim about intentions
// and becomes a property of the source: no write verb appears in either of the
// two files this unit owns, and no import that could reach one. A server render
// runs no effects, so no test here could prove "the button does not write" by
// pressing it — but a button that does not exist cannot be pressed, and THAT is
// checkable, exhaustively, in the text of the files.
//
// SECOND, THE RESOLVER. `reconcile()` is the answer to the owner's actual
// question ("31 of 40 resolve; 9 do not"), and every one of its reasons mirrors
// something real: an empty field, a name this workspace has never heard of, a
// name TWO organizations answer to — which is a legal state of the database,
// because 0023's sibling-name uniqueness is scoped to the parent. Those are the
// cases worth pinning, and none of them needs a render to see.
//
// THIRD, THE LOCALE PAIR, READ AS JSON RATHER THAN THROUGH t(). The `jira`
// namespace is NEW, and a new namespace does not reach a reader until
// `src/locales/index.ts` imports it and `lib/labelSections.ts` places it — two
// files this worker does not own, applied by the integrator. Asserting through
// t() here would fail for a reason that has nothing to do with the strings being
// right, and would go on failing every time somebody ran the suite before
// integration. Reading the two JSON files directly asserts everything that IS
// this worker's: parity, tokens, plural categories, bidi isolates, and that
// every key the screen asks for exists in both languages.
// StructureAdmin.test.tsx wrote that reasoning down first; this is the same
// situation one namespace later.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { MapNode, UseCase } from '../../types'
import type { JiraIssue, JiraMapping } from '../../api/jira'
import EN from '../../locales/en/jira.json'
import AR from '../../locales/ar/jira.json'

const fx = vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope and store/config adds a window
  // focus listener at module scope — at import time, so the shims cannot wait
  // for a beforeAll(). StructureAdmin.test.tsx's block, verbatim.
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.window = globalThis
  g.location = { search: '', href: 'http://localhost/' }
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  g.document = { documentElement: { dir: 'ltr', lang: 'en' } }

  const state = { role: 'admin' as 'admin' | 'member', calls: [] as string[] }
  return { state }
})

vi.mock('../../api/supabase', () => ({ isConfigured: () => true, supabase: null }))

// The screen asks `useHasPerm('structure.edit')`, exactly as Settings ›
// Structure does. The fixture describes a person by their LEGACY role and the
// mock resolves the key the way store/auth's own legacy fallback does: an admin
// holds every key, a member holds none of these.
vi.mock('../../store/auth', () => ({
  useAuth: () => ({ profile: { id: 'me', role: fx.state.role } }),
  useHasPerm: () => fx.state.role === 'admin',
}))

// Recording stubs, so a render that reached the network would be visible as a
// call rather than as a silent request in a test run. Every one of them is a
// READ; there is deliberately no write to stub.
const record =
  (name: string) =>
  (...args: unknown[]) => {
    fx.state.calls.push(`${name}(${args.join(',')})`)
    return Promise.resolve({ ok: false as const, error: 'common.error' })
  }

vi.mock('../../api/map', () => ({
  listMapNodes: record('listMapNodes'),
  listUseCases: record('listUseCases'),
}))

const { setLocale } = await import('../../lib/i18n')
const JiraAdmin = (await import('./JiraAdmin')).default
const {
  MAX_PAGE_SIZE,
  JIRA_ERROR_KEYS,
  JIRA_FUNCTION,
  RESOLVE_REASONS,
  distinctStatuses,
  fieldText,
  issueHref,
  normalizeName,
  reconcile,
  safeHttpUrl,
  secretKey,
  toSearchPage,
} = await import('../../api/jira')

/**
 * The screen's source, the client module's source, and the sheet, as text.
 *
 * `?raw` for the two .tsx/.ts files: the properties worth pinning here are
 * properties of the FILES — "no write verb appears" and "every key the screen
 * asks for exists in both languages" — and neither is reachable through an
 * export.
 */
const SOURCE: string = (await import('./JiraAdmin.tsx?raw')).default
const API_SOURCE: string = (await import('../../api/jira.ts?raw')).default

/**
 * The sheet as text — and it CANNOT come through `?raw`.
 *
 * vitest.config.ts leaves `test.css` at its default of false, which replaces
 * every `.css` import with an empty module, and the interception matches on the
 * EXTENSION before the query is looked at. Both `import('./jira.css?raw')` and
 * `import.meta.glob('./jira.css', { query: '?raw' })` therefore hand back the
 * empty string, which is strictly worse than no test at all — a gate reporting
 * green on a deleted rule. `styles/contrast.test.ts` and
 * `StructureAdmin.test.tsx` both record the same finding.
 *
 * So: `node:fs`, with the specifier held in a VARIABLE rather than written as a
 * literal. tsconfig.app.json pins `types: ["vite/client"]`, and a literal
 * `'node:fs'` reds `tsc -b` for the whole solution with TS2591; a computed
 * specifier is resolved at run time, where this file genuinely does run on node.
 */
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const SHEET: string = readFileSync(new URL('./jira.css', import.meta.url), 'utf8')

const render = (role: 'admin' | 'member' = 'admin'): string => {
  fx.state.role = role
  fx.state.calls = []
  return renderToStaticMarkup(
    <MemoryRouter>
      <JiraAdmin />
    </MemoryRouter>,
  )
}

/* ──────────────────────────────── fixtures ─────────────────────────────── */

let seq = 0
function node(name: string, nameAr = ''): MapNode {
  seq += 1
  return {
    id: `n${seq}`,
    parent_id: null,
    track_id: 't1',
    kind_id: null,
    name,
    name_ar: nameAr,
    description: '',
    description_ar: '',
    account_manager_id: null,
    vendor: '',
    sort_order: seq,
    archived: false,
    archived_at: null,
    source: 'local',
    external_ref: null,
    external_url: null,
    synced_at: null,
    overrides: [],
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function capability(name: string, nameAr = ''): UseCase {
  seq += 1
  return {
    id: `u${seq}`,
    name,
    name_ar: nameAr,
    sort_order: seq,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function issue(key: string, fields: Record<string, unknown>): JiraIssue {
  return { key, url: `https://acme.atlassian.net/browse/${key}`, fields }
}

const MAPPING: JiraMapping = {
  orgFieldId: 'customfield_10050',
  useCaseFieldId: 'customfield_10051',
  statuses: { live: 'live', 'in testing': 'testing', 'to do': 'planned' },
}

const CATALOGUE = {
  nodes: [node('King Faisal Specialist Hospital'), node('مستشفى الملك فيصل')],
  useCases: [capability('ADT'), capability('Medication Prescribe V1')],
}

/* ═══════════════════ 1. THE PROMISE: nothing is written ═══════════════════ */

describe('the read-only promise is a property of the source, not a claim', () => {
  it('contains no write path in either file this unit owns', () => {
    // THE POINT OF THE WHOLE UNIT. Aziz asked to read from Jira "without
    // changing anything", and both halves of that hold: nothing is written to
    // Jira, and nothing is written HERE. A screen with an Import button that is
    // merely disabled would fail this test, which is exactly the intent — a
    // control that does not exist cannot fire against live data, whatever a
    // future edit does to a boolean.
    const WRITES = [
      '.insert(',
      '.upsert(',
      '.update(',
      '.delete(',
      '.rpc(',
      'setNodeUseCase',
      'createMapNode',
      'updateMapNode',
      'deleteMapNode',
      'setMapNodeArchived',
      'createUseCase',
      'updateUseCase',
      'deleteUseCase',
      'invalidateConfig',
    ]
    for (const verb of WRITES) {
      expect(SOURCE, `${verb} in JiraAdmin.tsx`).not.toContain(verb)
      expect(API_SOURCE, `${verb} in api/jira.ts`).not.toContain(verb)
    }
  })

  it('asks the database for reads only, and only for the two catalogues', () => {
    // The one thing this screen reads from Postgres is what it matches AGAINST:
    // the organizations and the capabilities this workspace already has. Both
    // are selects. If a third import from api/map ever appears here it is worth
    // a second look, which is what this line is.
    expect(SOURCE).toContain("import { listMapNodes, listUseCases } from '../../api/map'")
  })

  it('names an endpoint that is read-only by name as well as by contract', () => {
    // The operation key is `op`, and the four names are the function's own —
    // this module was written against supabase/functions/jira-read/index.ts
    // rather than against an assumed shape, and these four lines are what says
    // so out loud.
    expect(JIRA_FUNCTION).toBe('jira-read')
    for (const op of ["op: 'ping'", "op: 'projects'", "op: 'fields'", "op: 'search'"]) {
      expect(API_SOURCE, op).toContain(op)
    }
    // No mutating operation exists in the contract, so a server that grew one
    // would have no caller here.
    for (const op of ["op: 'create'", "op: 'update'", "op: 'transition'", "op: 'import'"]) {
      expect(API_SOURCE, op).not.toContain(op)
    }
  })

  it('states it on the screen at rest, not in a toast', () => {
    // A toast fades, and he is going to run this repeatedly against live data.
    // The declaration is markup that is always there.
    const html = render()
    expect(html).toContain('jir-readonly')
    expect(SOURCE).toContain("t('jira.readOnlyJira')")
    expect(SOURCE).toContain("t('jira.readOnlyApp')")
    expect(SOURCE).not.toContain('toast(')
  })

  it('says the mapping does not survive the screen', () => {
    // No table holds it and none is being written this wave, so the screen has
    // to say so rather than let him lose the picking and wonder.
    expect(SOURCE).toContain("t('jira.notSaved')")
  })
})

/* ═══════════════════════ 2. THE SHELL THE SCREEN PAINTS ═══════════════════ */

describe('the first paint', () => {
  it('sends a member back to Settings rather than showing them the screen', () => {
    // Cosmetic gating, and deliberately so: the function re-verifies its caller
    // the way admin-members documents. This only avoids offering a screen whose
    // every call would be refused.
    const html = render('member')
    expect(html).not.toContain('jir-readonly')
  })

  it('renders the five sections an admin came for', () => {
    const html = render('admin')
    for (const key of ['connTitle', 'projectsTitle', 'mapTitle', 'statusTitle', 'jqlTitle']) {
      expect(SOURCE, key).toContain(`t('jira.${key}')`)
    }
    expect(html).toContain('jir-card')
  })

  it('reads nothing from Jira until it is asked to', () => {
    // A screen that pinged on mount would authenticate against a live third
    // party because somebody opened Settings — and would do it again on every
    // navigation. Every Jira call sits behind a button; the ONE effect in the
    // file reads this workspace's own two catalogues, which is what the verdict
    // column is computed against.
    render('admin')
    expect(SOURCE.match(/useEffect\(/g)?.length).toBe(1)
    // The body only, up to its dependency array — the rest of the file is where
    // the Jira calls legitimately live, inside the button handlers.
    const effect = SOURCE.split('useEffect(')[1].split('}, [')[0]
    expect(effect).toContain('listMapNodes')
    for (const call of ['jiraPing', 'jiraSearch', 'jiraFields', 'jiraProjects', 'jiraStatuses']) {
      expect(effect, call).not.toContain(call)
    }
  })
})

/* ═════════════════════════ 3. THE FIELD VALUE READER ═════════════════════ */

describe('fieldText reads whatever shape the value arrived in', () => {
  it('handles the shapes a real Jira actually returns', () => {
    expect(fieldText('  Acme Hospital  ')).toBe('Acme Hospital')
    expect(fieldText(42)).toBe('42')
    // single-select
    expect(fieldText({ value: 'ADT', id: '1' })).toBe('ADT')
    // status / priority / component
    expect(fieldText({ name: 'In Testing' })).toBe('In Testing')
    // user
    expect(fieldText({ displayName: 'Sara Alsaab' })).toBe('Sara Alsaab')
    // labels and multi-selects
    expect(fieldText(['ADT', { value: 'Lab Order' }])).toBe('ADT, Lab Order')
    // rich text (ADF)
    expect(
      fieldText({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'King Faisal' }] }],
      }),
    ).toBe('King Faisal')
  })

  it('answers an empty string for anything it cannot read, rather than throwing', () => {
    // The screen is pointed at a site nobody here has ever seen. A reader that
    // threw on an unexpected shape would turn "your custom field is odd" into a
    // blank screen, which is the one answer a diagnostic may not give.
    expect(fieldText(null)).toBe('')
    expect(fieldText(undefined)).toBe('')
    expect(fieldText({})).toBe('')
    expect(fieldText({ nested: { deep: 'x' } })).toBe('')
  })

  it('terminates on a cyclic value', () => {
    const loop: Record<string, unknown> = {}
    loop.content = [loop]
    expect(fieldText(loop)).toBe('')
  })
})

describe('normalizeName decides what "the same organization" means', () => {
  it('folds case and collapses whitespace', () => {
    expect(normalizeName('  ADT  ')).toBe(normalizeName('adt'))
    expect(normalizeName('King  Faisal')).toBe(normalizeName('King Faisal'))
  })

  it('normalises the Arabic differences nobody can see', () => {
    // Half these organizations are recorded in Arabic. Tashkeel is optional,
    // أ/إ/آ are typed as ا by anyone in a hurry, and ة/ه and ى/ي are
    // interchanged constantly. Without this the owner would be told his data is
    // wrong when it is his keyboard that differs.
    expect(normalizeName('مستشفى الملك فيصل')).toBe(normalizeName('مستشفي الملك فيصل'))
    expect(normalizeName('الأمانة')).toBe(normalizeName('الامانة'))
    expect(normalizeName('مكّة')).toBe(normalizeName('مكه'))
  })

  it('does NOT fuzzy match', () => {
    // A verdict of "probably this one" is not evidence, and the sync this
    // rehearses would be writing rows on the strength of it.
    expect(normalizeName('King Faisal')).not.toBe(normalizeName('King Faisal Hospital'))
  })
})

/* ═════════════════════ 4. THE VERDICT AND THE SUMMARY ════════════════════ */

describe('reconcile answers the question he actually asked', () => {
  it('counts the matched, the unmatched, and every reason', () => {
    const rows = [
      issue('NPH-1', {
        customfield_10050: 'King Faisal Specialist Hospital',
        customfield_10051: 'ADT',
        status: { name: 'Live' },
      }),
      issue('NPH-2', {
        customfield_10050: 'مستشفى الملك فيصل',
        customfield_10051: { value: 'Medication Prescribe V1' },
        status: { name: 'In Testing' },
      }),
      issue('NPH-3', { customfield_10051: 'ADT', status: { name: 'Live' } }),
      issue('NPH-4', {
        customfield_10050: 'Some Other Hospital',
        customfield_10051: 'ADT',
        status: { name: 'Live' },
      }),
      issue('NPH-5', {
        customfield_10050: 'King Faisal Specialist Hospital',
        customfield_10051: 'Radiology Order',
        status: { name: 'Live' },
      }),
      issue('NPH-6', {
        customfield_10050: 'King Faisal Specialist Hospital',
        customfield_10051: 'ADT',
        status: { name: 'Ready for release' },
      }),
    ]
    const report = reconcile(rows, MAPPING, CATALOGUE)

    expect(report.total).toBe(6)
    // THE SENTENCE: matched counts the pair being found, so the issue whose
    // Jira status is unmapped counts as matched — the organization and the
    // capability were both located, which is what the sentence claims.
    expect(report.matched).toBe(3)
    expect(report.unmatched).toBe(3)
    expect(report.byReason.matched).toBe(2)
    expect(report.byReason.statusUnmapped).toBe(1)
    expect(report.byReason.orgBlank).toBe(1)
    expect(report.byReason.orgUnknown).toBe(1)
    expect(report.byReason.useCaseUnknown).toBe(1)
  })

  it('names WHICH organization and WHICH capability, not just "yes"', () => {
    const report = reconcile(
      [
        issue('NPH-1', {
          customfield_10050: 'ADT',
          customfield_10051: 'ADT',
          status: { name: 'Live' },
        }),
      ],
      { ...MAPPING, orgFieldId: 'customfield_10051' },
      CATALOGUE,
    )
    // Both axes read the same field here — a legal configuration on a site
    // where one field carries both — so the org lookup misses and says so.
    expect(report.rows[0].reason).toBe('orgUnknown')
    expect(report.rows[0].useCase?.name).toBe('ADT')
  })

  it('reports ambiguity rather than picking one', () => {
    // 0023's sibling-name uniqueness is scoped to the PARENT, so two
    // organizations of the same name under two phases is a legal state of this
    // database. Collapsing them would report a confident match to the wrong
    // hospital.
    const twins = {
      nodes: [node('Riyadh Hospital'), node('Riyadh Hospital')],
      useCases: [capability('ADT')],
    }
    const report = reconcile(
      [
        issue('NPH-9', {
          customfield_10050: 'Riyadh Hospital',
          customfield_10051: 'ADT',
          status: { name: 'Live' },
        }),
      ],
      MAPPING,
      twins,
    )
    expect(report.rows[0].reason).toBe('orgAmbiguous')
    expect(report.rows[0].nodeMatches).toBe(2)
    expect(report.rows[0].node).toBeNull()
  })

  it('counts a row reached by both its own names ONCE', () => {
    // An organization whose Arabic and English names are the same string is one
    // candidate, not an ambiguity.
    const same = { nodes: [node('ADT Clinic', 'ADT Clinic')], useCases: [capability('ADT')] }
    const report = reconcile(
      [
        issue('NPH-10', {
          customfield_10050: 'ADT Clinic',
          customfield_10051: 'ADT',
          status: { name: 'Live' },
        }),
      ],
      MAPPING,
      same,
    )
    expect(report.rows[0].reason).toBe('matched')
    expect(report.rows[0].nodeMatches).toBe(1)
  })

  it('says "no mapping" before it says anything about the values', () => {
    // An unconfigured screen must not report forty blank fields as forty data
    // problems.
    const report = reconcile(
      [issue('NPH-11', { status: { name: 'Live' } })],
      { orgFieldId: '', useCaseFieldId: '', statuses: {} },
      CATALOGUE,
    )
    expect(report.rows[0].reason).toBe('noMapping')
    expect(report.byReason.noMapping).toBe(1)
  })

  it('carries every reason in the breakdown, including the zeroes', () => {
    const report = reconcile([], MAPPING, CATALOGUE)
    expect(Object.keys(report.byReason).sort()).toEqual([...RESOLVE_REASONS].sort())
    expect(report.total).toBe(0)
  })
})

/* ═══════════════════ 5. THE LINK, AND THE PAGING THAT CHANGED ════════════ */

describe('an issue link is validated the way the column would validate it', () => {
  it('accepts http(s) and refuses everything else', () => {
    // Rendered as an href, so this is 0023's `map_nodes_external_url_chk` in
    // flight: anything that is not http(s) is a dead link or, with
    // `javascript:…`, a script injection in an admin's browser.
    expect(safeHttpUrl('https://acme.atlassian.net/browse/NPH-1')).toContain('NPH-1')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('/browse/NPH-1')).toBeNull()
    expect(safeHttpUrl('')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
  })

  it('builds one from the site when the function did not supply it', () => {
    expect(issueHref('https://acme.atlassian.net/', 'NPH-1')).toBe(
      'https://acme.atlassian.net/browse/NPH-1',
    )
    expect(issueHref('ftp://acme', 'NPH-1')).toBeNull()
    expect(issueHref('https://acme.atlassian.net', '')).toBeNull()
  })
})

describe('the search reply is read the way the CURRENT endpoint answers', () => {
  it('treats a missing nextPageToken as the last page', () => {
    // `POST /rest/api/3/search/jql` returns no `total`, and `isLast` only
    // sometimes. The ABSENCE of the cursor is the reliable end-of-results
    // signal, and a cursor left in hand is "there is more of your backlog than
    // this" — which is the only honest thing the screen can say about size.
    const last = toSearchPage({ issues: [] })
    expect(last.nextPageToken).toBeNull()
    expect(last.truncated).toBe(false)
    const more = toSearchPage({ issues: [], nextPageToken: 'abc' })
    expect(more.nextPageToken).toBe('abc')
    expect(more.truncated).toBe(true)
    // The function says so itself when it spends its own per-call budget.
    expect(toSearchPage({ issues: [], truncated: true }).truncated).toBe(true)
  })

  it('drops a keyless issue rather than rendering a blank row', () => {
    const page = toSearchPage({ issues: [{ key: 'NPH-1', fields: {} }, { fields: {} }, 7] })
    expect(page.issues.map((i) => i.key)).toEqual(['NPH-1'])
  })

  it('survives a reply of the wrong shape entirely', () => {
    expect(toSearchPage(null).issues).toEqual([])
    expect(toSearchPage({ issues: 'nope' }).issues).toEqual([])
  })

  it('never quotes a site total, because the endpoint no longer returns one', () => {
    // The number on the screen is the number of issues examined. A fraction of
    // a total nobody counted would be the one figure on a reconciliation screen
    // that is not evidence.
    expect(API_SOURCE).not.toMatch(/\br\.total\b/)
    expect(SOURCE).toContain('jira.morePages')
  })

  it('reads the statuses to map out of the result, not out of a second call', () => {
    // There is no `statuses` operation on the function, and the screen is
    // better for it: a site's whole workflow list is dozens of statuses across
    // every project, and mapping ones no issue in the query carries answers
    // nothing. Deduplicated by the normalised name, reported in the first
    // spelling seen — which is what he has to recognise in the list.
    const seen = distinctStatuses([
      issue('A', { status: { name: 'In Testing' } }),
      issue('B', { status: { name: 'in  testing' } }),
      issue('C', { status: { name: 'Live' } }),
      issue('D', { status: null }),
    ])
    expect(seen).toEqual(['In Testing', 'Live'])
    expect(API_SOURCE).not.toContain("op: 'statuses'")
  })

  it('always names the fields it wants', () => {
    // The new endpoint returns IDS ONLY when `fields` is omitted — a silent
    // default that renders a perfect table with every value blank.
    expect(SOURCE).toContain("const ALWAYS_FIELDS = ['summary', 'status']")
    expect(API_SOURCE).toContain('input.fields.length === 0')
    expect(MAX_PAGE_SIZE).toBe(100)
  })
})

/* ═════════════════════════════ 6. THE FAILURES ═══════════════════════════ */

describe('a missing secret is a sentence, not a 500', () => {
  it('names the one secret to go and set, in configuration order', () => {
    // The owner sets these himself in the Supabase dashboard and nobody here
    // has them, so "not configured yet" is the most likely state this feature
    // is ever in — and "something is misconfigured" would send him to read
    // three settings when the server already knows which one is blank.
    //
    // The function answers with an ARRAY, because more than one can be unset.
    // First in configuration order wins: naming the base URL while the token is
    // also missing is naming the next thing that has to be true.
    expect(secretKey(['JIRA_BASE_URL', 'JIRA_API_TOKEN'])).toBe('jira.errNoBaseUrl')
    expect(secretKey(['JIRA_EMAIL', 'JIRA_API_TOKEN'])).toBe('jira.errNoEmail')
    expect(secretKey(['JIRA_API_TOKEN'])).toBe('jira.errNoToken')
    // A shape nobody anticipated still says something true.
    expect(secretKey(undefined)).toBe('jira.errMissingSecret')
    expect(secretKey(['SOMETHING_ELSE'])).toBe('jira.errMissingSecret')
  })

  it('tells wrong-token, no-such-site and rate-limited apart', () => {
    expect(JIRA_ERROR_KEYS.jira_unauthorized).toBe('jira.errBadCredentials')
    expect(JIRA_ERROR_KEYS.jira_not_found).toBe('jira.errNoSuchSite')
    expect(JIRA_ERROR_KEYS.jira_rate_limited).toBe('jira.errRateLimited')
    expect(JIRA_ERROR_KEYS.jira_bad_request).toBe('jira.errBadJql')
    expect(JIRA_ERROR_KEYS.invalid_jql).toBe('jira.errBadJql')
    // Reaching Jira at all and Jira answering slowly are different problems
    // with different remedies, and the owner is the one who has to tell them
    // apart at 11pm against a live site.
    expect(JIRA_ERROR_KEYS.jira_unreachable).toBe('jira.errUnreachable')
    expect(JIRA_ERROR_KEYS.jira_timeout).toBe('jira.errTimeout')
  })

  it('carries a key for every code the deployed function can return', () => {
    // The two halves of one wire contract. `JiraCode` is the union in
    // supabase/functions/jira-read/index.ts; a code with no entry here renders
    // as a generic sentence, which is the failure this unit exists to avoid.
    const FUNCTION_CODES = [
      'not_signed_in', 'forbidden', 'invalid_body', 'unknown_operation',
      'invalid_jql', 'invalid_fields', 'invalid_page_token',
      'missing_secret', 'bad_base_url', 'bad_email',
      'jira_unauthorized', 'jira_forbidden', 'jira_not_found', 'jira_gone',
      'jira_bad_request', 'jira_rate_limited', 'jira_unavailable',
      'jira_bad_response', 'jira_timeout', 'jira_unreachable', 'server_error',
    ]
    expect(FUNCTION_CODES.filter((c) => !(c in JIRA_ERROR_KEYS))).toEqual([])
  })

  it('has a key in both bundles for every code it can map', () => {
    const missing = Object.values(JIRA_ERROR_KEYS)
      .filter((key) => key.startsWith('jira.'))
      .map((key) => key.slice('jira.'.length))
      .filter((local) => !(local in EN_NS) || !(local in AR_NS))
    expect(missing.sort()).toEqual([])
  })
})

/* ═══════════════════════ 7. THE SHEET, WHICH MUST MIRROR ═════════════════ */

describe('the sheet', () => {
  it('uses no physical layout property anywhere', () => {
    // The standing grep, scoped to this file so the failure names it. `width`
    // and `height` are included because the registry's grep is written that
    // way; `line-height` and the media query's `min-width` are the established
    // exceptions every other sheet in the repo excludes the same way.
    const hits = SHEET.split('\n').filter((line) =>
      /(^|[^-\w])(width|height|left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/.test(
        line.replace(/line-height|max-width|min-width|max-height|min-height/g, ''),
      ),
    )
    expect(hits).toEqual([])
  })

  it('keeps the wide table inside its own scroller', () => {
    // Five columns of third-party text do not fit a 375px phone. The TABLE
    // scrolls; the page must not.
    expect(SHEET).toContain('overflow-x: auto')
    expect(SHEET).toContain('min-inline-size: 44rem')
    expect(SOURCE).toContain('jir-table-wrap')
  })

  it('accents the read-only card on the inline axis', () => {
    expect(SHEET).toContain('border-inline-start: 3px solid var(--green)')
    // The DECLARATION, not the word: the sheet's own header names `border-left`
    // in prose to say why it is not used, and a bare substring test would fail
    // on the comment that documents the rule it is enforcing.
    expect(SHEET).not.toMatch(/border-left\s*:/)
  })

  it('has a rule for every class the screen renders', () => {
    // A class with no rule is invisible styling debt; a rule with no class is
    // dead weight. Checked in the direction that shows on screen.
    const used = new Set([...SOURCE.matchAll(/className="([^"{}]+)"/g)].flatMap((m) => m[1].split(/\s+/)))
    const missing = [...used]
      .filter((c) => c.startsWith('jir-'))
      .filter((c) => c !== 'jir' && !SHEET.includes(`.${c}`))
    expect(missing.sort()).toEqual([])
  })
})

/* ═════════════════════════ 8. THE TWO LOCALE FILES ═══════════════════════ */

type Leaf = string | Record<string, string>
type Tree = Record<string, Leaf>

const EN_NS = (EN as Record<string, Tree>).jira
const AR_NS = (AR as Record<string, Tree>).jira

/** Every leaf, flattened — plural forms become `key.category`. */
function flat(tree: Tree): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, leaf] of Object.entries(tree)) {
    if (typeof leaf === 'string') out.set(key, leaf)
    else for (const [category, form] of Object.entries(leaf)) out.set(`${key}.${category}`, form)
  }
  return out
}

const EN_FLAT = flat(EN_NS)
const AR_FLAT = flat(AR_NS)
const PLURAL_KEYS = Object.entries(EN_NS)
  .filter(([, leaf]) => typeof leaf !== 'string')
  .map(([key]) => key)

describe('the jira namespace', () => {
  it('has exactly one root, named after its file', () => {
    // src/locales/index.ts merges with a flat spread, so a second root in one
    // file would silently win or lose by import order.
    expect(Object.keys(EN as Record<string, unknown>)).toEqual(['jira'])
    expect(Object.keys(AR as Record<string, unknown>)).toEqual(['jira'])
  })

  it('holds the same key set in both languages', () => {
    const en = Object.keys(EN_NS).sort()
    const ar = Object.keys(AR_NS).sort()
    expect(ar.filter((k) => !en.includes(k))).toEqual([])
    expect(en.filter((k) => !ar.includes(k))).toEqual([])
  })

  it('has no empty value in either language', () => {
    const blank = [...EN_FLAT, ...AR_FLAT].filter(([, v]) => v.trim() === '').map(([k]) => k)
    expect(blank).toEqual([])
  })

  it('uses the same interpolation tokens for the same key', () => {
    // The failure a parity-by-key check cannot see: a `{site}` renamed in one
    // language renders as literal braces in a sentence nobody proofreads.
    const tokens = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const mismatched: string[] = []
    for (const [key, value] of EN_FLAT) {
      const twin = AR_FLAT.get(key)
      if (twin === undefined) continue
      // `{count}` is legitimately absent from an Arabic zero/one/two form,
      // which covers exactly one number and spells it out in words.
      const only = tokens(value).filter((tok) => tok !== 'count')
      const twinOnly = tokens(twin).filter((tok) => tok !== 'count')
      if (only.join() !== twinOnly.join()) mismatched.push(`${key}: ${only} vs ${twinOnly}`)
    }
    expect(mismatched).toEqual([])
  })
})

describe('the counted strings', () => {
  it('are plural NODES, so the noun can agree with the number', () => {
    // Every number this screen shows counts something: issues that came back,
    // issues that resolved, issues that did not, projects, matches. A plain
    // string with a `{count}` in it freezes one grammatical form for every
    // value — wrong in English for exactly one value, and wrong in Arabic for
    // most of them.
    expect(PLURAL_KEYS.sort()).toEqual([
      'ambiguousMatches',
      'issueCount',
      'projectsCount',
      'summaryFetched',
      'summaryMatched',
      'summaryUnmatched',
    ])
  })

  it('ship only the categories each language can select', () => {
    for (const key of PLURAL_KEYS) {
      expect(Object.keys(EN_NS[key]).sort()).toEqual(['one', 'other'])
      expect(Object.keys(AR_NS[key]).sort()).toEqual(
        ['few', 'many', 'one', 'other', 'two', 'zero'].sort(),
      )
    }
  })

  it('carry {count} in every form that covers more than one number', () => {
    const forms = (tree: Tree, key: string): Record<string, string> => {
      const leaf = tree[key]
      if (typeof leaf === 'string') throw new Error(`${key} is not a plural node`)
      return leaf
    }
    const missing: string[] = []
    for (const key of PLURAL_KEYS) {
      if (!forms(EN_NS, key).other.includes('{count}')) missing.push(`en ${key}.other`)
      for (const category of ['few', 'many', 'other'] as const) {
        if (!forms(AR_NS, key)[category].includes('{count}')) missing.push(`ar ${key}.${category}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('bidi', () => {
  const FSI = '⁨'
  const PDI = '⁩'
  /**
   * Tokens whose value can run the other way.
   *
   * Every one of these is third-party or user text: an account's display name,
   * a site title, an organization's name, a capability's name, a Jira status,
   * an issue key, an email address, a reason sentence. Latin as often as
   * Arabic, in a paragraph that may be either — which is exactly the case FSI
   * exists for. The counted tokens are deliberately absent: a number needs no
   * fence.
   */
  const USER_VALUES = new Set([
    'account',
    'email',
    'key',
    'node',
    'reason',
    'site',
    'status',
    'useCase',
  ])

  it('fences every interpolation whose value can run the other way', () => {
    const bare: string[] = []
    for (const [locale, table] of [
      ['en', EN_FLAT],
      ['ar', AR_FLAT],
    ] as const) {
      for (const [key, value] of table) {
        for (const m of value.matchAll(/\{(\w+)\}/g)) {
          if (!USER_VALUES.has(m[1])) continue
          const before = value.slice(0, m.index)
          const after = value.slice((m.index ?? 0) + m[0].length)
          if (!before.endsWith(FSI) || !after.startsWith(PDI)) {
            bare.push(`${locale} ${key} {${m[1]}}`)
          }
        }
      }
    }
    expect(bare.sort()).toEqual([])
  })

  it('never leaves an isolate open', () => {
    // An unclosed FSI reorders every character after it, to the end of the
    // paragraph — the one direction failure that escapes the string it is in.
    const broken: string[] = []
    for (const [key, value] of [...EN_FLAT, ...AR_FLAT]) {
      let depth = 0
      for (const ch of value) {
        if (ch === '⁦' || ch === '⁧' || ch === FSI) depth += 1
        else if (ch === PDI) depth = Math.max(0, depth - 1)
      }
      if (depth !== 0) broken.push(key)
    }
    expect(broken).toEqual([])
  })

  it('fences the Latin identifiers inside the Arabic sentences', () => {
    // `JIRA_BASE_URL` and `jira-read` are Latin runs inside RTL prose. Without
    // an isolate the underscores and hyphens beside them resolve to the
    // paragraph and the secret's name reads back to front — which is worse than
    // useless on the one sentence whose whole job is to name it exactly.
    for (const key of ['errNoBaseUrl', 'errNoEmail', 'errNoToken', 'connSecrets']) {
      const value = AR_FLAT.get(key) ?? ''
      expect(value, key).toContain(FSI)
      expect(value, key).toContain(PDI)
    }
  })
})

describe('every key the screen asks for exists in both languages', () => {
  it('resolves each one against the two JSON files', () => {
    // localeReach.test.ts does this repo-wide THROUGH t(), which cannot answer
    // until src/locales/index.ts imports this namespace — a file this worker
    // does not own. Scoped here to the two files that ARE this worker's, so a
    // key typed into the screen and never written into the pair fails now
    // rather than at integration.
    const asked = [...`${SOURCE}${API_SOURCE}`.matchAll(/'(jira\.[A-Za-z][\w]*)'/g)].map(
      (m) => m[1],
    )
    // A screen with no keys would make this vacuous.
    expect(asked.length).toBeGreaterThan(40)
    const missing = [...new Set(asked)].filter((key) => {
      const local = key.slice('jira.'.length)
      return !(local in EN_NS) || !(local in AR_NS)
    })
    expect(missing.sort()).toEqual([])
  })

  it('says nothing in JSX that is not a locale key', () => {
    // The standing grep for hardcoded user-facing strings, scoped so the
    // failure names this screen.
    const jsxText = [...SOURCE.matchAll(/>\s*([A-Za-z][A-Za-z ]{3,})\s*</g)].map((m) => m[1].trim())
    expect(jsxText).toEqual([])
  })
})

describe('the sentences carry the tokens the screen passes', () => {
  it('names the account, the site and the pair in both languages', () => {
    // The failure key-set parity cannot see: it compares en to ar, never either
    // to its caller.
    for (const locale of ['en', 'ar'] as const) {
      setLocale(locale)
      const local = (key: string, vars: Record<string, string | number>): string => {
        const table = locale === 'en' ? EN_NS : AR_NS
        const raw = table[key]
        const template = typeof raw === 'string' ? raw : raw.other
        return template.replace(/\{(\w+)\}/g, (m, tok: string) =>
          tok in vars ? String(vars[tok]) : m,
        )
      }
      const conn = local('connOk', { account: 'Aziz Alsaloom', site: 'nphies' })
      expect(conn).toContain('Aziz Alsaloom')
      expect(conn).toContain('nphies')
      expect(conn).not.toContain('{')
      const pair = local('verdictPair', { node: 'King Faisal', useCase: 'ADT' })
      expect(pair).toContain('King Faisal')
      expect(pair).toContain('ADT')
      expect(local('openIssue', { key: 'NPH-1' })).toContain('NPH-1')
      expect(local('summaryMatched', { count: 31 })).toContain('31')
    }
    setLocale('en')
  })
})
