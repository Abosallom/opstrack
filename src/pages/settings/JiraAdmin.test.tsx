// Proof for /settings/jira — the promise, the seam between the transport and
// the mapper, the shell the screen first paints, and the two locale files it is
// made of.
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
// SECOND, THE SEAM — WHICH IS WHERE THE BUG WAS. There were two mappers in this
// repo: `reconcile()` here in api/jira.ts, and `src/lib/jira/map.ts`, which was
// better, pure, carried 800 lines of tests and WAS WIRED TO NOTHING. §C of the
// plan deleted the parallel one. So the arithmetic itself is proven next door in
// `map.test.ts`, against fixtures, and what is proven HERE is everything that
// lives BETWEEN the two files and could therefore be proven in neither:
//
//   · the transport hands the mapper what the mapper's contract expects —
//     `fields: null` when the payload carried none, and a keyless issue kept
//     rather than dropped, because "one reading per issue" is the property the
//     whole harness rests on;
//   · every `code` the mapper can emit has a sentence on this screen, in both
//     languages — derived from map.ts's own source, so a fifteenth reason
//     cannot ship rendering its own code at a reader;
//   · the cursor the endpoint returns is sent back, against the query that
//     produced it and not against whatever is in the textarea now.
//
// THIRD, THE LOCALE PAIR, READ AS JSON RATHER THAN THROUGH t(). The `jira`
// namespace reaches a reader only once `src/locales/index.ts` imports it and
// `lib/labelSections.ts` places it — two files this worker does not own.
// Asserting through t() here would fail for a reason that has nothing to do with
// the strings being right. Reading the two JSON files directly asserts
// everything that IS this worker's: parity, tokens, plural categories, bidi
// isolates, and that every key the screen asks for exists in both languages.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { MapNode, UseCase } from '../../types'
import { mapJiraIssues, type JiraMapContext } from '../../lib/jira/map'
import type { JiraFieldMapping } from '../../lib/jira/types'
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
  listNodeUseCasesFor: record('listNodeUseCasesFor'),
}))

const { setLocale } = await import('../../lib/i18n')
const JiraAdmin = (await import('./JiraAdmin')).default
const API = await import('../../api/jira')
const {
  MAX_PAGE_SIZE,
  JIRA_ERROR_KEYS,
  JIRA_FUNCTION,
  issueHref,
  safeHttpUrl,
  secretKey,
  toIssue,
  toSearchPage,
} = API

/**
 * The screen's source, the client module's source, the mapper's source, and the
 * sheet, as text.
 *
 * `?raw` for the .tsx/.ts files: the properties worth pinning here are
 * properties of the FILES — "no write verb appears", "every code the mapper can
 * emit has a sentence" — and none of them is reachable through an export.
 */
const SOURCE: string = (await import('./JiraAdmin.tsx?raw')).default

/**
 * The same file with its prose removed.
 *
 * Needed for exactly one question — "does this file still CALL the deleted
 * resolver" — because the answer is no and the file says so at length. Both
 * headers name `reconcile` deliberately: a reader arriving to look for it
 * deserves to be told where it went and why, and a grep over the prose would
 * forbid the paragraph that explains the deletion. Every other assertion here
 * reads the whole file, comments included, because a locale key mentioned only
 * in a comment is still a key somebody will reach for.
 */
const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const API_SOURCE: string = (await import('../../api/jira.ts?raw')).default
const MAP_SOURCE: string = (await import('../../lib/jira/map.ts?raw')).default

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
    his_id: null,
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

/** The mapping this screen builds, with the field ids its selects would hold. */
const MAPPING: JiraFieldMapping = {
  organizationField: 'customfield_10050',
  useCaseField: 'customfield_10051',
  statusField: 'status',
  statusMap: { Live: 'live', 'In Testing': 'testing', 'To Do': 'planned' },
  siteBaseUrl: 'https://acme.atlassian.net',
}

const CATALOGUE: Omit<JiraMapContext, 'mapping'> = {
  // Bilingual, because the case worth proving end to end is the Arabic one:
  // `name_ar` carries the hospital's real name and a Jira field pasted in
  // Arabic arrives wrapped in invisible bidi marks.
  organizations: [
    node('King Faisal Specialist Hospital', 'مستشفى الملك فيصل'),
    node('Jeddah Medical City'),
  ],
  useCases: [capability('ADT'), capability('Medication Prescribe V1')],
}

/* ═══════════════════ 1. THE PROMISE: nothing is written ═══════════════════ */

describe('the read-only promise is a property of the source, not a claim', () => {
  it('contains no write path in either file this unit owns', () => {
    // THE POINT OF THE WHOLE UNIT. Aziz asked to read from Jira "without
    // changing anything", and both halves of that hold: nothing is written to
    // Jira, and nothing is written HERE. A screen with an Apply button that is
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
      expect(MAP_SOURCE, `${verb} in lib/jira/map.ts`).not.toContain(verb)
    }
  })

  it('asks the database for reads only, and only for the three catalogues', () => {
    // What this screen reads from Postgres is what it matches AGAINST — the
    // organizations and the capabilities — plus the links it already records,
    // which is what turns `effect` from a decoration into a fact. All three are
    // selects. A fourth import from api/map is worth a second look, which is
    // what this line is.
    expect(SOURCE).toContain(
      "import { listMapNodes, listNodeUseCasesFor, listUseCases } from '../../api/map'",
    )
    expect(SOURCE.match(/from '\.\.\/\.\.\/api\/map'/g)?.length).toBe(1)
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

  it('says where the mapping goes, now that somewhere holds it', () => {
    // AMENDED DELIBERATELY AT THE WAVE-7 GATE, not left to pass by luck. This
    // asserted `t('jira.notSaved')` — "none of this is saved anywhere" — which
    // was true until 0028's `jira_settings` row and the Save button landed in
    // this same commit. A test that keeps passing while the sentence it pins
    // has become a lie is worse than no test, so the key was retired from both
    // bundles and this line follows it. The screen still has to answer the
    // question ("where did my twenty minutes of picking go?"); it now answers
    // it from the other side, and repeats that saving is not connecting.
    //
    // The literal is asserted in its CALL form, because the header still names
    // the retired key in prose — a reader arriving at this file looking for the
    // sentence that used to be here deserves to be told where it went and why,
    // and a bare substring test would forbid the paragraph that explains it.
    expect(SOURCE).not.toContain("t('jira.notSaved')")
    expect(SOURCE).toContain("t('jiraconfig.savedHere')")
  })

  it('saves the CONFIGURATION and still writes no workspace data', () => {
    // The one write this screen makes, and the reason it does not contradict
    // the card above it: `jira_settings` is this screen's own settings — the
    // field mapping, the query, the off-switch — and not an organization, a
    // capability or an item. `jira.readOnlyApp` ("no organizations, no
    // capabilities, no items") stays true word for word, which is why the
    // WRITES grep above still passes unchanged over this file.
    //
    // It goes through the STORE, never `api/jiraSettings` directly, so the
    // off-switch has exactly one place that changes it.
    expect(SOURCE).toContain("import { saveJiraConfig, useJiraSettings } from '../../store/config'")
    expect(SOURCE).not.toContain("from '../../api/jiraSettings'")
    expect(SOURCE).toContain("t('jiraconfig.save')")
    expect(SOURCE).toContain("t('jiraconfig.enableLabel')")
    // The dropped-status count is its own sentence, never folded into the
    // confirmation: "saved" over four silently discarded status words is the
    // shape of lie this screen exists not to tell.
    expect(SOURCE).toContain("t('jiraconfig.saved')")
    expect(SOURCE).toContain("t('jiraconfig.droppedStatuses'")
  })

  it('reconciles the site address with the connection test in ONE order', () => {
    // The live cross-unit seam of this wave. What is RENDERED as a link and
    // what is STORED must come from the same expression, or a save can change
    // where the links point. A fresh ping outranks the saved row (if the site
    // moved, the test knows and the row does not); the saved row is what keeps
    // links alive on a cold load before anybody presses Test.
    const expr = 'ping?.site.baseUrl ?? saved?.siteBaseUrl ?? null'
    expect(SOURCE.match(new RegExp(expr.replace(/[.?]/g, '\\$&'), 'g'))?.length).toBe(2)
    // Never `?? ''`: a blank address must go in as NULL so the Settings card
    // can say "on, but no site address" instead of showing it as connected.
    expect(SOURCE).not.toContain("siteBaseUrl: ping?.site.baseUrl ?? ''")
  })

  it('states each of the four refusals where a person would look for it', () => {
    // The owner's scope for this wave is READ-ONLY: no apply, no schedule, no
    // entry sync, no organization creation. A capability that is deliberately
    // absent and unmentioned reads as one nobody thought of — so each refusal is
    // written beside the thing it refuses rather than in a release note.
    for (const key of ['jira.noApply', 'jira.noSchedule', 'jira.noEntries', 'jira.noNodes']) {
      expect(SOURCE, key).toContain(`t('${key}')`)
    }
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
    // navigation. Every Jira call sits behind a button. There are exactly THREE
    // effects and none of them touches Jira: hydrating the form from the saved
    // row (a store read, no network at all), the catalogues on mount, and the
    // existing links for the organizations the readings landed on (without
    // which `effect` says `create` about everything, forever).
    //
    // WAS TWO UNTIL THE SAVED CONFIGURATION LANDED. The count is asserted, not
    // bounded, precisely so that a fourth effect has to come through this line
    // and state what it reads.
    render('admin')
    expect(SOURCE.match(/useEffect\(/g)?.length).toBe(3)
    // Each body only, up to its dependency array — the rest of the file is where
    // the Jira calls legitimately live, inside the button handlers.
    for (const index of [1, 2, 3]) {
      const effect = SOURCE.split('useEffect(')[index].split('}, [')[0]
      for (const call of ['jiraPing', 'jiraSearch', 'jiraFields', 'jiraProjects']) {
        expect(effect, `${call} in effect ${String(index)}`).not.toContain(call)
      }
    }
    // The hydration effect latches: re-running it on every store publish would
    // throw away half-typed JQL each time the tab regains focus.
    expect(SOURCE.split('useEffect(')[1]).toContain('if (hydrated || saved === null) return')
    expect(SOURCE.split('useEffect(')[2]).toContain('listMapNodes')
    expect(SOURCE.split('useEffect(')[3]).toContain('listNodeUseCasesFor')
  })
})

/* ═════════════ 3. THE SEAM: WHAT THE TRANSPORT HANDS THE MAPPER ═══════════ */

describe('the transport hands the mapper what its contract expects', () => {
  it('renders the ONE mapper, and no trace of the deleted one', () => {
    // The finding this whole unit exists to close: two mappers, one wired.
    // Checked against the module's EXPORTS rather than its text, because the
    // header names the deleted functions on purpose — a reader arriving at
    // api/jira.ts looking for `reconcile` deserves to be told where it went and
    // why, and a grep over the prose would forbid the paragraph that explains
    // the deletion.
    expect(SOURCE).toContain('mapJiraIssues')
    for (const dead of [
      'reconcile',
      'resolveIssue',
      'RESOLVE_REASONS',
      'fieldText',
      'normalizeName',
      'distinctStatuses',
      'indexByName',
    ]) {
      expect(Object.keys(API), `${dead} still exported`).not.toContain(dead)
      // Word-bounded: `readFieldText(` is the reader that REPLACED `fieldText(`,
      // and a substring test would forbid the replacement along with the
      // original.
      expect(codeOf(SOURCE), `${dead} on the screen`).not.toMatch(new RegExp(`\\b${dead}\\(`))
    }
  })

  it('keeps a keyless issue instead of dropping it', () => {
    // This file used to hold the opposite: a keyless issue was filtered out to
    // keep a blank row off the table. That trades the one property the harness
    // is built on — one reading per issue, nothing vanishing between the payload
    // and the summary — for a cosmetic. The mapper names it `issue-malformed`
    // instead, which is a thing a reader can act on.
    const page = toSearchPage({ issues: [{ key: 'NPH-1', fields: {} }, { fields: {} }, 7] })
    expect(page.issues).toHaveLength(2)
    const preview = mapJiraIssues(page.issues, { ...CATALOGUE, mapping: MAPPING })
    expect(preview.readings).toHaveLength(page.issues.length)
    expect(preview.readings[1]).toEqual({
      outcome: 'unresolved',
      issueKey: null,
      reasons: [{ code: 'issue-malformed', detail: 'no-key' }],
    })
  })

  it('reports "no fields" as itself rather than as three absent fields', () => {
    // `fields: {}` and `fields: null` are different sentences: the first says
    // the three mapped fields are not on this issue, the second says the search
    // asked for no fields at all — one configuration mistake instead of three
    // data problems per issue. Substituting `{}` here would erase that split
    // before the mapper ever saw it.
    expect(toIssue({ key: 'NPH-1' }).fields).toBeNull()
    expect(toIssue({ key: 'NPH-1', fields: {} }).fields).toEqual({})
    const preview = mapJiraIssues([toIssue({ key: 'NPH-1' })], { ...CATALOGUE, mapping: MAPPING })
    expect(preview.readings[0]).toEqual({
      outcome: 'unresolved',
      issueKey: 'NPH-1',
      reasons: [{ code: 'issue-malformed', detail: 'no-fields' }],
    })
  })

  it('sees through an RLM pasted into an Arabic field, on the path the screen runs', () => {
    // `map.test.ts` proves the stripping against the mapper directly. THIS is
    // the same case entering through the reply the edge function actually sends
    // — because for a year the module that could do this was not the module the
    // screen called, and "the two strings are the same but the import says
    // unknown organization" is the least debuggable failure this feature could
    // ship.
    const page = toSearchPage({
      issues: [
        {
          key: 'NPH-7',
          url: 'https://acme.atlassian.net/browse/NPH-7',
          fields: {
            customfield_10050: '‏مستشفى الملك فيصل‏',
            customfield_10051: { value: 'ADT' },
            status: { name: 'Live' },
          },
        },
      ],
    })
    const preview = mapJiraIssues(page.issues, { ...CATALOGUE, mapping: MAPPING })
    expect(preview.readings[0]).toMatchObject({
      outcome: 'resolved',
      organizationMatchedOn: 'name_ar',
      status: 'live',
      externalRef: 'NPH-7',
      externalUrl: 'https://acme.atlassian.net/browse/NPH-7',
    })
  })

  it('reports two issues claiming one cell, rather than letting the last win', () => {
    // The reason a preview is safe to reason about at all: an apply path built
    // on a resolver without this concept upserts both and files one hospital's
    // integration state on top of another's, silently.
    const page = toSearchPage({
      issues: [
        {
          key: 'NPH-1',
          fields: {
            customfield_10050: 'King Faisal Specialist Hospital',
            customfield_10051: 'ADT',
            status: { name: 'To Do' },
          },
        },
        {
          key: 'NPH-2',
          fields: {
            customfield_10050: 'King Faisal Specialist Hospital',
            customfield_10051: 'ADT',
            status: { name: 'Live' },
          },
        },
      ],
    })
    const preview = mapJiraIssues(page.issues, { ...CATALOGUE, mapping: MAPPING })
    expect(preview.resolved).toBe(1)
    expect(preview.readings[1]).toMatchObject({
      outcome: 'unresolved',
      reasons: [{ code: 'duplicate-pair', claimedBy: 'NPH-1' }],
    })
    // …and the screen draws it as the warning it is rather than as one more
    // grey line among fourteen.
    expect(SOURCE).toContain("'jir-verdict-no field-error'")
  })
})

/* ════════ 4. EVERY REASON THE MAPPER CAN EMIT HAS A SENTENCE HERE ═════════ */

/** kebab code → the camel name this screen keys its sentences by. */
const camel = (code: string): string =>
  code
    .split('-')
    .map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join('')

/**
 * The codes, read off the UNION ARMS of `JiraUnresolvedReason` and not off every
 * `code:` in the file — map.ts's own header argues for the discriminated union
 * by quoting the alternative (`code: 'error'` with a prose message), and a
 * looser pattern would count the thing the comment is arguing against.
 */
const CODES = [
  ...new Set([...MAP_SOURCE.matchAll(/\|\s*\{\s*code: '([a-z-]+)'/g)].map((m) => m[1])),
].sort()

describe('the fourteen sentences', () => {
  it('covers every code map.ts can emit, derived from map.ts itself', () => {
    // NOT a hand-copied list. A fifteenth reason added next door fails HERE,
    // rather than rendering its own code at a reader in production — which is
    // the failure mode of every screen that maps an enum by hand.
    expect(CODES.length).toBe(13)
    const expected = CODES.flatMap((code) =>
      // `issue-malformed` is the one code whose sentence depends on its payload:
      // "no key" and "no fields" have different causes and different fixes, so
      // thirteen codes are fourteen sentences.
      code === 'issue-malformed' ? ['issueNoKey', 'issueNoFields'] : [camel(code)],
    )
    expect(expected).toHaveLength(14)
    for (const name of expected) {
      const key = `jira.reason${name[0].toUpperCase()}${name.slice(1)}`
      expect(SOURCE, key).toContain(`'${key}'`)
      const local = key.slice('jira.'.length)
      expect(local in EN_NS, `en ${key}`).toBe(true)
      expect(local in AR_NS, `ar ${key}`).toBe(true)
    }
  })

  it('has exactly those fourteen plus the one for the issues that landed', () => {
    const used = [...new Set([...SOURCE.matchAll(/'(jira\.reason[A-Z]\w*)'/g)].map((m) => m[1]))]
    expect(used).toHaveLength(15)
    expect(used).toContain('jira.reasonMatched')
  })

  it('says WHICH kind of empty, because that decides who has to fix it', () => {
    // `absent` on every issue = the field id is wrong or the token cannot see
    // it, which is configuration. `blank` on some issues = nobody filled it in,
    // which is fieldwork. Same-looking empty cell, two different people. The old
    // resolver had one word for both.
    expect(SOURCE).toContain("t('jira.presenceAbsent'")
    expect(SOURCE).toContain("t('jira.presenceBlank'")
  })

  it('marks an archived organization and a retired capability rather than hiding them', () => {
    expect(SOURCE).toContain("t('jira.orgArchived')")
    expect(SOURCE).toContain("t('jira.useCaseRetired')")
    const closed = node('Old Clinic')
    closed.archived = true
    const retired = capability('Clinical Notes')
    retired.hidden = true
    const preview = mapJiraIssues(
      [
        toIssue({
          key: 'NPH-3',
          fields: {
            customfield_10050: 'Old Clinic',
            customfield_10051: 'Clinical Notes',
            status: { name: 'Live' },
          },
        }),
      ],
      { organizations: [closed], useCases: [retired], mapping: MAPPING },
    )
    expect(preview.readings[0]).toMatchObject({
      outcome: 'resolved',
      organizationArchived: true,
      useCaseHidden: true,
    })
  })

  it('names all four things a sync would do, and that nothing does them', () => {
    for (const key of [
      'jira.effectCreate',
      'jira.effectUpdate',
      'jira.effectUnchanged',
      'jira.effectHeld',
      'jira.effectsCreate',
      'jira.effectsUpdate',
      'jira.effectsUnchanged',
      'jira.effectsHeld',
    ]) {
      expect(SOURCE, key).toContain(`'${key}'`)
    }
    // `held` is the `overrides` contract from 0023/0024 and the reason this
    // mapper was the one worth keeping: a status edited HERE is one a sync must
    // not overwrite, and nothing else in this app can say so.
    const preview = mapJiraIssues(
      [
        toIssue({
          key: 'NPH-4',
          fields: {
            customfield_10050: 'King Faisal Specialist Hospital',
            customfield_10051: 'ADT',
            status: { name: 'Live' },
          },
        }),
      ],
      {
        ...CATALOGUE,
        mapping: MAPPING,
        existing: [
          {
            node_id: CATALOGUE.organizations[0].id,
            use_case_id: CATALOGUE.useCases[0].id,
            status: 'planned',
            overrides: ['status'],
          },
        ],
      },
    )
    expect(preview.effects).toEqual({ create: 0, update: 0, unchanged: 0, held: 1 })
  })
})

/* ═══════════════════ 5. THE LINK, AND THE CURSOR THAT MOVES ══════════════ */

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
    expect(toIssue({ key: 'X', url: 'javascript:alert(1)' }).url).toBeNull()
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

  it('survives a reply of the wrong shape entirely', () => {
    expect(toSearchPage(null).issues).toEqual([])
    expect(toSearchPage({ issues: 'nope' }).issues).toEqual([])
  })

  it('SENDS THE CURSOR BACK, against the query that produced it', () => {
    // The cursor was the one thing this screen never did anything with: it
    // reported "there is more" and offered no way to read it. The token belongs
    // to the query and the field list that produced it, so continuation reads
    // `ran` — what was actually run — rather than the textarea, which the owner
    // may have edited since.
    expect(SOURCE).toContain('nextPageToken,')
    expect(SOURCE).toContain('jql: ran.jql')
    expect(SOURCE).toContain('fields: ran.fields')
    expect(SOURCE).toContain("t('jira.loadMore')")
    // Appended, never replaced: "the first issue in the input keeps the pair" is
    // the duplicate rule, and a page that replaced its predecessors would move
    // that verdict between two clicks.
    expect(SOURCE).toContain('...(prev ?? []), ...result.data.issues')
    // And the OTHER "there is more" — the function spending its own per-call
    // budget with no cursor to hand back — is kept, so "everything was read"
    // cannot be printed over a page that was cut short.
    expect(SOURCE).toContain('setTruncated(result.data.truncated)')
    expect(SOURCE).toContain("t('jira.allRead')")
  })

  it('never quotes a site total, because the endpoint no longer returns one', () => {
    // The number on the screen is the number of issues examined. A fraction of
    // a total nobody counted would be the one figure on a reconciliation screen
    // that is not evidence.
    expect(API_SOURCE).not.toMatch(/\br\.total\b/)
    expect(SOURCE).toContain('jira.morePages')
  })

  it('asks for the fields the mapper will read, and no others by accident', () => {
    // The new endpoint returns IDS ONLY when `fields` is omitted — a silent
    // default that renders a perfect table with every value blank. The list is
    // DERIVED from the mapping (`jiraSearchFields`) rather than typed out, so
    // the field the mapper reads is the field the search asked for.
    expect(SOURCE).toContain("const ALWAYS_FIELDS = ['summary']")
    expect(SOURCE).toContain('jiraSearchFields(mapping)')
    expect(API_SOURCE).toContain('input.fields.length === 0')
    expect(MAX_PAGE_SIZE).toBe(100)
  })

  it('reads the statuses to map out of the result, through the mapped field', () => {
    // There is no `statuses` operation on the function, and the screen is
    // better for it: a site's whole workflow list is dozens of statuses across
    // every project, and mapping ones no issue in the query carries answers
    // nothing. `distinctStatusValues` reads them through `mapping.statusField`,
    // so the picker cannot offer words the mapper will never look up.
    expect(SOURCE).toContain('distinctStatusValues')
    expect(API_SOURCE).not.toContain("op: 'statuses'")
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
    // The two halves of one wire contract — and NOT a hand-copied list, for the
    // same reason the mapper's codes above are read off map.ts itself: a
    // twenty-fourth code added to the function's union must fail HERE, rather
    // than render as a generic sentence at a reader in production. The old
    // hand-typed list had already fallen silently two behind the union, which
    // is the exact failure a subset check over a stale list cannot see.
    const FN_SOURCE = readFileSync(
      new URL('../../../supabase/functions/jira-read/index.ts', import.meta.url),
      'utf8',
    )
    const unionBlock =
      /export type JiraCode =([\s\S]*?)\n\nexport interface JiraFailure/.exec(FN_SOURCE)?.[1] ?? ''
    const FUNCTION_CODES = [...unionBlock.matchAll(/\|\s*'([a-z_]+)'/g)].map((m) => m[1])
    // Both directions. A server code with no client sentence renders generic;
    // a client key with no server code is a stale entry nobody can ever hit.
    // An empty FUNCTION_CODES (the extraction regex gone stale) fails the
    // second assertion with every key orphaned, so the derivation guards itself.
    expect(FUNCTION_CODES.filter((c) => !(c in JIRA_ERROR_KEYS))).toEqual([])
    expect(Object.keys(JIRA_ERROR_KEYS).filter((c) => !FUNCTION_CODES.includes(c))).toEqual([])
  })

  it('has a key in both bundles for every code it can map', () => {
    const missing = Object.values(JIRA_ERROR_KEYS)
      .filter((key) => key.startsWith('jira.'))
      .map((key) => key.slice('jira.'.length))
      .filter((local) => !(local in EN_NS) || !(local in AR_NS))
    expect(missing.sort()).toEqual([])
  })

  it('says so when the two sides it compares were themselves clipped', () => {
    // A catalogue read that hit PostgREST's row cap would report an
    // organization that IS here as unknown, and a clipped link read would report
    // an existing cell as new. Both are named on the glass rather than left to
    // be discovered.
    expect(SOURCE).toContain("t('jira.catalogueTruncated')")
    expect(SOURCE).toContain("t('jira.linksTruncated')")
    expect(SOURCE).toContain("t('jira.linksFailed')")
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

  it('adds no class of its own to a sheet it does not own this wave', () => {
    // jira.css is not this unit's file. Every class the rewritten screen uses is
    // either one the sheet already had or a global primitive (`.switch`, `.btn`,
    // `.field-error`), so the readings table cannot ship unstyled.
    const jir = [...SOURCE.matchAll(/'(jir-[\w-]+)'/g)].map((m) => m[1])
    for (const cls of jir) expect(SHEET, cls).toContain(`.${cls}`)
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

  it('carries no key the screen stopped asking for', () => {
    // The four reasons the old resolver had — `noMapping`, `orgBlank`,
    // `useCaseBlank`, and the two half-names `reasonOrgUnknown` /
    // `reasonUseCaseUnknown` in their old spelling — went with it. A locale file
    // that keeps the strings of a deleted feature is how a translator ends up
    // proofreading sentences nobody will ever read.
    for (const gone of ['reasonNoMapping', 'reasonOrgBlank', 'reasonUseCaseBlank']) {
      expect(gone in EN_NS, `en ${gone}`).toBe(false)
      expect(gone in AR_NS, `ar ${gone}`).toBe(false)
    }
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
   * a site title, an organization's name, a capability's name, a Jira status, a
   * Jira field id, an issue key, an email address, a reason sentence, a status
   * this app records. Latin as often as Arabic, in a paragraph that may be
   * either — which is exactly the case FSI exists for. The counted tokens are
   * deliberately absent: a number needs no fence.
   */
  const USER_VALUES = new Set([
    'account',
    'email',
    'from',
    'key',
    'names',
    'node',
    'reason',
    'site',
    'status',
    'useCase',
    'value',
    'values',
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
    // useless on the one sentence whose whole job is to name it exactly. The two
    // route sentences carry `JIRA_EMAIL` and `JIRA_BASE_URL` inside the same RTL
    // prose, so they are held to the same fence.
    for (const key of [
      'errNoBaseUrl', 'errNoEmail', 'errNoToken', 'connSecrets',
      'errGatewayUnauthorized', 'errCloudIdUnresolved',
    ]) {
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
      // The new sentences take a value the reader has to be able to act on: the
      // field id that was not in the payload, and the issue that won the pair.
      expect(local('presenceAbsent', { value: 'customfield_10050' })).toContain('customfield_10050')
      expect(local('duplicateClaimedBy', { key: 'NPH-1' })).toContain('NPH-1')
      expect(local('effectHeld', { from: 'Planned' })).toContain('Planned')
    }
    setLocale('en')
  })
})
