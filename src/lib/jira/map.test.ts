// The Jira read harness, tested completely — which is possible here and nowhere
// else in this integration, because `map.ts` and `types.ts` touch no network, no
// store and no clock. Nobody on this fleet can reach a live Jira site, so every
// claim this unit makes has to be provable from fixtures or it is not made.
//
// WHAT IS ACTUALLY AT RISK, and it is not "does a matching name match":
//
//   · A SILENT DROP. The whole ask is "to test the inputs from JIRA" — the
//     answer is "31 matched, 9 did not, and here is why each one did not". An
//     issue that vanishes between the payload and the screen makes the harness
//     worse than useless, because it reports a clean run over a broken import.
//     Every reason below therefore has its own case, and one case pins
//     `readings.length === issues.length` over a payload where almost everything
//     is wrong.
//   · A WRONG MATCH, which is worse than no match. Two organizations called
//     "Riyadh" resolving first-wins files one hospital's integration status
//     against another hospital, and the screen looks perfect.
//   · AN EMPTY ARABIC NAME MATCHING AN EMPTY JIRA VALUE. `name_ar` is
//     `not null default ''` and all ten seeded capabilities carry `''`, so the
//     naive index would make one blank field match ten rows at once.
//   · A LITERAL 'live'. His Jira statuses are his own words; a hardcoded map
//     stops matching the day somebody renames a column and reports every issue
//     as unmapped.
//   · A WRITE. There is none, and the test that proves it is the one asserting
//     the inputs come back unmutated — a mapper that wrote would have to write
//     somewhere, and the only things it holds are its arguments.
//
// PURE MODULE, PLAIN TEST: no `vi.hoisted`, no globals shim, no environment.
// Same contract as `lib/mapNodes.test.ts`.

import { describe, expect, it } from 'vitest'
import {
  distinctStatusValues,
  mapJiraIssues,
  statusMapConflicts,
  type JiraExistingLink,
  type JiraMapContext,
  type JiraReading,
  type JiraUnresolvedReason,
} from './map'
import {
  JIRA_SEARCH_PATH,
  browseUrlFor,
  jiraSearchFields,
  normalizeName,
  readFieldText,
  readSearchPage,
  textValuesOf,
  type JiraFieldMapping,
  type JiraIssue,
} from './types'
import type { MapNode, UseCase } from '../../types'

/**
 * The module's own text.
 *
 * One property below is about the FILE rather than about the function — see the
 * NUL case in "the harness itself" — and `?raw` is the only way to ask it.
 */
const MAP_SOURCE: string = (await import('./map.ts?raw')).default

/**
 * THIS FILE's own text, for the same property applied to the guard itself.
 *
 * The NUL case below asserts that `map.ts` contains no raw U+0000 — and the
 * first version of that assertion wrote its expected value as a raw U+0000,
 * which made THIS file the binary one and left every grep over it silent while
 * the assertion happily passed. Both sides are checked now.
 */
const SELF_SOURCE: string = (await import('./map.test.ts?raw')).default

/* ────────────────────────────── fixtures ────────────────────────────── */

const ORG_FIELD = 'customfield_10050'
const USE_CASE_FIELD = 'customfield_10051'

function node(over: Partial<MapNode> & Pick<MapNode, 'id' | 'name'>): MapNode {
  return {
    parent_id: null,
    track_id: 'track-uhr',
    kind_id: 'kind-org',
    name_ar: '',
    description: '',
    description_ar: '',
    account_manager_id: null,
    vendor: '',
    sort_order: 0,
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
    ...over,
  }
}

function capability(over: Partial<UseCase> & Pick<UseCase, 'id' | 'name'>): UseCase {
  return {
    name_ar: '',
    sort_order: 0,
    hidden: false,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

/** An issue with the three mapped fields filled in unless overridden. */
function issue(
  key: string,
  fields: Record<string, unknown> | null | undefined,
): JiraIssue {
  return { id: `10${key.length}`, key, self: `https://x.atlassian.net/rest/api/3/issue/${key}`, fields }
}

function jiraFields(org: unknown, useCase: unknown, status: unknown): Record<string, unknown> {
  return {
    [ORG_FIELD]: org,
    [USE_CASE_FIELD]: useCase,
    status,
  }
}

/** Jira's status object shape: the name is nested, and there is more beside it. */
function jiraStatus(name: string): Record<string, unknown> {
  return { name, id: '3', statusCategory: { key: 'indeterminate', name: 'In Progress' } }
}

const RIYADH = node({ id: 'n-riyadh', name: 'Riyadh General Hospital', name_ar: 'مستشفى الرياض العام' })
const JEDDAH = node({ id: 'n-jeddah', name: 'Jeddah Medical City' })
const ADT = capability({ id: 'u-adt', name: 'ADT', sort_order: 1 })
const LAB = capability({ id: 'u-lab', name: 'Lab Order', sort_order: 8 })

const MAPPING: JiraFieldMapping = {
  organizationField: ORG_FIELD,
  useCaseField: USE_CASE_FIELD,
  statusField: 'status',
  statusMap: {
    'Backlog': 'planned',
    'In Progress': 'testing',
    'Done': 'live',
  },
  siteBaseUrl: 'https://nphies.atlassian.net',
}

function context(over: Partial<JiraMapContext> = {}): JiraMapContext {
  return {
    organizations: [RIYADH, JEDDAH],
    useCases: [ADT, LAB],
    mapping: MAPPING,
    ...over,
  }
}

/** The reasons on the one unresolved reading, for a one-issue payload. */
function reasonsOf(readings: readonly JiraReading[]): JiraUnresolvedReason[] {
  const first = readings[0]
  expect(first?.outcome).toBe('unresolved')
  return first !== undefined && first.outcome === 'unresolved' ? first.reasons : []
}

function codesOf(readings: readonly JiraReading[]): string[] {
  return reasonsOf(readings).map((reason) => reason.code)
}

/* ──────────────────────── the resolved reading ──────────────────────── */

describe('a resolvable issue', () => {
  it('reads organization, capability and status off three differently-shaped fields', () => {
    const preview = mapJiraIssues(
      [
        issue(
          'NPH-1',
          jiraFields('Riyadh General Hospital', { value: 'ADT', id: '10001' }, jiraStatus('In Progress')),
        ),
      ],
      context(),
    )

    expect(preview.resolved).toBe(1)
    expect(preview.unresolved).toBe(0)
    const [reading] = preview.readings
    expect(reading).toMatchObject({
      outcome: 'resolved',
      issueKey: 'NPH-1',
      organizationMatchedOn: 'name',
      organizationArchived: false,
      useCaseMatchedOn: 'name',
      useCaseHidden: false,
      status: 'testing',
      externalRef: 'NPH-1',
      externalUrl: 'https://nphies.atlassian.net/browse/NPH-1',
      effect: { kind: 'create' },
    })
    expect(reading?.outcome === 'resolved' && reading.organization.id).toBe('n-riyadh')
    expect(reading?.outcome === 'resolved' && reading.useCase.id).toBe('u-adt')
  })

  it('counts what a sync would do, and the effects sum to the resolved count', () => {
    const existing: JiraExistingLink[] = [
      { node_id: 'n-riyadh', use_case_id: 'u-adt', status: 'testing' },
      { node_id: 'n-riyadh', use_case_id: 'u-lab', status: 'planned' },
      { node_id: 'n-jeddah', use_case_id: 'u-adt', status: 'planned', overrides: ['status'] },
    ]
    const preview = mapJiraIssues(
      [
        // unchanged: we already say testing
        issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('In Progress'))),
        // update: we say planned, Jira says live
        issue('NPH-2', jiraFields('Riyadh General Hospital', 'Lab Order', jiraStatus('Done'))),
        // held: we say planned and somebody edited that field HERE
        issue('NPH-3', jiraFields('Jeddah Medical City', 'ADT', jiraStatus('Done'))),
        // create: nothing recorded
        issue('NPH-4', jiraFields('Jeddah Medical City', 'Lab Order', jiraStatus('Backlog'))),
      ],
      context({ existing }),
    )

    expect(preview.effects).toEqual({ create: 1, update: 1, unchanged: 1, held: 1 })
    expect(preview.effects.create + preview.effects.update + preview.effects.unchanged + preview.effects.held)
      .toBe(preview.resolved)
    expect(preview.readings[1]).toMatchObject({ effect: { kind: 'update', from: 'planned' } })
    expect(preview.readings[2]).toMatchObject({ effect: { kind: 'held', field: 'status', from: 'planned' } })
  })

  it('holds a field whatever case `overrides` spelled the column in', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done')))],
      context({
        existing: [{ node_id: 'n-riyadh', use_case_id: 'u-adt', status: 'planned', overrides: [' Status '] }],
      }),
    )
    expect(preview.effects.held).toBe(1)
  })

  it('does not call an override "held" when nothing differs — that is `unchanged`', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Backlog')))],
      context({
        existing: [{ node_id: 'n-riyadh', use_case_id: 'u-adt', status: 'planned', overrides: ['status'] }],
      }),
    )
    expect(preview.effects).toEqual({ create: 0, update: 0, unchanged: 1, held: 0 })
  })

  it('marks an archived organization and a hidden capability rather than dropping them', () => {
    const retired = capability({ id: 'u-old', name: 'Clinical Notes', hidden: true })
    const closed = node({ id: 'n-old', name: 'Old Clinic', archived: true, archived_at: '2026-02-01T00:00:00Z' })
    const preview = mapJiraIssues(
      [issue('NPH-9', jiraFields('Old Clinic', 'Clinical Notes', jiraStatus('Done')))],
      context({ organizations: [RIYADH, closed], useCases: [ADT, retired] }),
    )
    expect(preview.resolved).toBe(1)
    expect(preview.readings[0]).toMatchObject({
      organizationArchived: true,
      useCaseHidden: true,
      status: 'live',
    })
  })
})

/* ───────────────────── every unresolved reason ───────────────────── */

describe('the issue itself is not readable', () => {
  it('reports no-key rather than inventing one — the key is what external_ref holds', () => {
    const preview = mapJiraIssues([{ id: '10001', fields: jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done')) }], context())
    expect(preview.readings[0]).toEqual({
      outcome: 'unresolved',
      issueKey: null,
      reasons: [{ code: 'issue-malformed', detail: 'no-key' }],
    })
  })

  it('reports a blank key the same way', () => {
    const preview = mapJiraIssues([issue('   ', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done')))], context())
    expect(codesOf(preview.readings)).toEqual(['issue-malformed'])
  })

  it('reports no-fields, which is what a search that forgot `fields` returns', () => {
    const preview = mapJiraIssues([issue('NPH-7', null)], context())
    expect(preview.readings[0]).toEqual({
      outcome: 'unresolved',
      issueKey: 'NPH-7',
      reasons: [{ code: 'issue-malformed', detail: 'no-fields' }],
    })
  })
})

describe('the organization cannot be placed', () => {
  it('separates a field that is NOT IN THE PAYLOAD from one that is merely empty', () => {
    const absent = mapJiraIssues(
      [issue('NPH-1', { [USE_CASE_FIELD]: 'ADT', status: jiraStatus('Done') })],
      context(),
    )
    expect(reasonsOf(absent.readings)).toEqual([
      { code: 'organization-missing', field: ORG_FIELD, presence: 'absent' },
    ])

    const blank = mapJiraIssues([issue('NPH-2', jiraFields(null, 'ADT', jiraStatus('Done')))], context())
    expect(reasonsOf(blank.readings)).toEqual([
      { code: 'organization-missing', field: ORG_FIELD, presence: 'blank' },
    ])
  })

  it('treats an empty multi-select and a whitespace-only string as blank, not as a name', () => {
    for (const empty of [[], '   ', ['']]) {
      const preview = mapJiraIssues([issue('NPH-1', jiraFields(empty, 'ADT', jiraStatus('Done')))], context())
      expect(reasonsOf(preview.readings)).toEqual([
        { code: 'organization-missing', field: ORG_FIELD, presence: 'blank' },
      ])
    }
  })

  it('refuses to choose when one issue names two organizations', () => {
    const preview = mapJiraIssues(
      [
        issue(
          'NPH-1',
          jiraFields([{ value: 'Riyadh General Hospital' }, { value: 'Jeddah Medical City' }], 'ADT', jiraStatus('Done')),
        ),
      ],
      context(),
    )
    expect(reasonsOf(preview.readings)).toEqual([
      {
        code: 'organization-multivalued',
        field: ORG_FIELD,
        values: ['Riyadh General Hospital', 'Jeddah Medical City'],
      },
    ])
  })

  it('names the value it could not find, so the fix is one look at the screen', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('Dammam Central', 'ADT', jiraStatus('Done')))],
      context(),
    )
    expect(reasonsOf(preview.readings)).toEqual([
      { code: 'organization-unknown', field: ORG_FIELD, value: 'Dammam Central' },
    ])
  })

  it('AMBIGUOUS, NOT FIRST-WINS, when two nodes answer to one name', () => {
    const a = node({ id: 'n-a', name: 'Riyadh' })
    const b = node({ id: 'n-b', name: 'riyadh  ' })
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh', 'ADT', jiraStatus('Done')))],
      context({ organizations: [a, b] }),
    )
    expect(preview.resolved).toBe(0)
    expect(reasonsOf(preview.readings)).toEqual([
      {
        code: 'organization-ambiguous',
        field: ORG_FIELD,
        value: 'Riyadh',
        matches: [
          { id: 'n-a', name: 'Riyadh' },
          { id: 'n-b', name: 'riyadh  ' },
        ],
      },
    ])
  })
})

describe('the capability cannot be placed', () => {
  it('reports missing, multivalued, unknown and ambiguous with the same shape', () => {
    const absent = mapJiraIssues(
      [issue('NPH-1', { [ORG_FIELD]: 'Riyadh General Hospital', status: jiraStatus('Done') })],
      context(),
    )
    expect(reasonsOf(absent.readings)).toEqual([
      { code: 'use-case-missing', field: USE_CASE_FIELD, presence: 'absent' },
    ])

    const many = mapJiraIssues(
      [issue('NPH-2', jiraFields('Riyadh General Hospital', ['ADT', 'Lab Order'], jiraStatus('Done')))],
      context(),
    )
    expect(reasonsOf(many.readings)).toEqual([
      { code: 'use-case-multivalued', field: USE_CASE_FIELD, values: ['ADT', 'Lab Order'] },
    ])

    const unknown = mapJiraIssues(
      [issue('NPH-3', jiraFields('Riyadh General Hospital', 'Medication Prescribe V3', jiraStatus('Done')))],
      context(),
    )
    expect(reasonsOf(unknown.readings)).toEqual([
      { code: 'use-case-unknown', field: USE_CASE_FIELD, value: 'Medication Prescribe V3' },
    ])

    // Two catalogue rows can share an ARABIC name even though `use_cases` has a
    // unique index on lower(name) — which is exactly the case that would slip
    // past a test written only against English.
    const one = capability({ id: 'u-1', name: 'Lab Order', name_ar: 'المختبر' })
    const two = capability({ id: 'u-2', name: 'Lab Results', name_ar: 'المختبر' })
    const ambiguous = mapJiraIssues(
      [issue('NPH-4', jiraFields('Riyadh General Hospital', 'المختبر', jiraStatus('Done')))],
      context({ useCases: [one, two] }),
    )
    expect(reasonsOf(ambiguous.readings)).toEqual([
      {
        code: 'use-case-ambiguous',
        field: USE_CASE_FIELD,
        value: 'المختبر',
        matches: [
          { id: 'u-1', name: 'Lab Order' },
          { id: 'u-2', name: 'Lab Results' },
        ],
      },
    ])
  })
})

describe('the status cannot be placed', () => {
  it('reports an absent status field, an empty one, and two at once', () => {
    const absent = mapJiraIssues(
      [issue('NPH-1', { [ORG_FIELD]: 'Riyadh General Hospital', [USE_CASE_FIELD]: 'ADT' })],
      context(),
    )
    expect(reasonsOf(absent.readings)).toEqual([
      { code: 'status-missing', field: 'status', presence: 'absent' },
    ])

    const blank = mapJiraIssues(
      [issue('NPH-2', jiraFields('Riyadh General Hospital', 'ADT', { name: '' }))],
      context(),
    )
    expect(reasonsOf(blank.readings)).toEqual([
      { code: 'status-missing', field: 'status', presence: 'blank' },
    ])

    const many = mapJiraIssues(
      [issue('NPH-3', jiraFields('Riyadh General Hospital', 'ADT', [{ value: 'Done' }, { value: 'Backlog' }]))],
      context(),
    )
    expect(reasonsOf(many.readings)).toEqual([
      { code: 'status-multivalued', field: 'status', values: ['Done', 'Backlog'] },
    ])
  })

  it('reports a status nobody mapped, quoting his word rather than ours', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Awaiting Vendor')))],
      context(),
    )
    expect(reasonsOf(preview.readings)).toEqual([
      { code: 'status-unmapped', field: 'status', value: 'Awaiting Vendor' },
    ])
  })

  it('THE MAP IS CONFIGURATION: our own three words are not privileged', () => {
    // A Jira column literally called "live" resolves ONLY because the mapping
    // says so. Delete the entry and it stops resolving — which is the proof
    // there is no hardcoded 'live' anywhere in the module.
    const withEntry = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('live')))],
      context({ mapping: { ...MAPPING, statusMap: { live: 'planned' } } }),
    )
    expect(withEntry.readings[0]).toMatchObject({ outcome: 'resolved', status: 'planned' })

    const without = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('live')))],
      context({ mapping: { ...MAPPING, statusMap: {} } }),
    )
    expect(codesOf(without.readings)).toEqual(['status-unmapped'])
  })

  it('matches his status words case- and whitespace-insensitively', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('  in   PROGRESS ')))],
      context(),
    )
    expect(preview.readings[0]).toMatchObject({ status: 'testing' })
  })

  it('reports two status-map keys that normalise alike but disagree', () => {
    expect(statusMapConflicts(MAPPING)).toEqual([])
    expect(
      statusMapConflicts({
        ...MAPPING,
        statusMap: { 'In Progress': 'testing', 'in  progress': 'live', Done: 'live' },
      }),
    ).toEqual([{ key: 'in progress', statuses: ['testing', 'live'] }])
  })
})

describe('two issues claiming one Organization × capability', () => {
  it('keeps the first and names it on the second, rather than overwriting', () => {
    const preview = mapJiraIssues(
      [
        issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Backlog'))),
        issue('NPH-2', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done'))),
      ],
      context(),
    )
    expect(preview.resolved).toBe(1)
    expect(preview.readings[0]).toMatchObject({ outcome: 'resolved', issueKey: 'NPH-1', status: 'planned' })
    expect(preview.readings[1]).toEqual({
      outcome: 'unresolved',
      issueKey: 'NPH-2',
      reasons: [
        { code: 'duplicate-pair', organizationId: 'n-riyadh', useCaseId: 'u-adt', claimedBy: 'NPH-1' },
      ],
    })
  })

  it('does not treat a different capability at the same organization as a duplicate', () => {
    const preview = mapJiraIssues(
      [
        issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done'))),
        issue('NPH-2', jiraFields('Riyadh General Hospital', 'Lab Order', jiraStatus('Done'))),
      ],
      context(),
    )
    expect(preview.resolved).toBe(2)
  })
})

/* ────────────────────────── the Arabic rules ────────────────────────── */

describe('Arabic names', () => {
  it('matches on name_ar and says so', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('مستشفى الرياض العام', 'ADT', jiraStatus('Done')))],
      context(),
    )
    expect(preview.readings[0]).toMatchObject({
      outcome: 'resolved',
      organizationMatchedOn: 'name_ar',
    })
  })

  it('NEVER matches an empty name_ar — `not null default \'\'` means "no translation"', () => {
    // Every seeded capability carries name_ar = ''. A blank Jira value must be
    // `missing`, not a ten-way ambiguity against the whole catalogue.
    const blank = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', '', jiraStatus('Done')))],
      context(),
    )
    expect(reasonsOf(blank.readings)).toEqual([
      { code: 'use-case-missing', field: USE_CASE_FIELD, presence: 'blank' },
    ])

    // And a value that normalises to empty is `unknown`/`missing`, never a hit.
    const spaces = mapJiraIssues(
      [issue('NPH-2', jiraFields('Riyadh General Hospital', '\u200F  \u200F', jiraStatus('Done')))],
      context(),
    )
    expect(codesOf(spaces.readings)).toEqual(['use-case-missing'])
  })

  it('does not report a bilingual row as ambiguous with itself', () => {
    const same = node({ id: 'n-same', name: 'NPHIES', name_ar: 'NPHIES' })
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('NPHIES', 'ADT', jiraStatus('Done')))],
      context({ organizations: [same] }),
    )
    expect(preview.readings[0]).toMatchObject({
      outcome: 'resolved',
      organizationMatchedOn: 'name',
    })
  })

  it('folds orthography ONLY when the mapping asks — the flag is the decision', () => {
    // The same hospital, typed with ya for alef maqsura and a plain alef, which
    // is what a hurried keyboard produces. `\u0645\u0633\u062A\u0634\u0641\u064A` vs `\u0645\u0633\u062A\u0634\u0641\u0649`.
    const typed = '\u0645\u0633\u062A\u0634\u0641\u064A \u0627\u0644\u0631\u064A\u0627\u0636 \u0627\u0644\u0639\u0627\u0645'
    const strict = mapJiraIssues([issue('NPH-1', jiraFields(typed, 'ADT', jiraStatus('Done')))], context())
    expect(codesOf(strict.readings)).toEqual(['organization-unknown'])

    const folded = mapJiraIssues(
      [issue('NPH-1', jiraFields(typed, 'ADT', jiraStatus('Done')))],
      context({ mapping: { ...MAPPING, foldArabic: true } }),
    )
    expect(folded.readings[0]).toMatchObject({ outcome: 'resolved', organizationMatchedOn: 'name_ar' })
  })

  it('folds tashkeel and tatweel too, and only under the flag', () => {
    // A fatha and a tatweel on an otherwise identical name.
    const decorated = '\u0645\u064E\u0633\u062A\u0640\u0634\u0641\u0649 \u0627\u0644\u0631\u064A\u0627\u0636 \u0627\u0644\u0639\u0627\u0645'
    expect(
      codesOf(mapJiraIssues([issue('NPH-1', jiraFields(decorated, 'ADT', jiraStatus('Done')))], context()).readings),
    ).toEqual(['organization-unknown'])
    expect(
      mapJiraIssues(
        [issue('NPH-1', jiraFields(decorated, 'ADT', jiraStatus('Done')))],
        context({ mapping: { ...MAPPING, foldArabic: true } }),
      ).readings[0],
    ).toMatchObject({ outcome: 'resolved' })
  })

  it('folding that collapses two real organizations REPORTS the ambiguity', () => {
    // The safety property that makes the flag survivable: folding can turn an
    // unknown into a match or into an ambiguity, and an ambiguity is stated.
    const a = node({ id: 'n-a', name: 'A', name_ar: '\u0645\u0633\u062A\u0634\u0641\u0649 \u0627\u0644\u0623\u0645\u0644' })
    const b = node({ id: 'n-b', name: 'B', name_ar: '\u0645\u0633\u062A\u0634\u0641\u064A \u0627\u0644\u0627\u0645\u0644' })
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('\u0645\u0633\u062A\u0634\u0641\u0649 \u0627\u0644\u0623\u0645\u0644', 'ADT', jiraStatus('Done')))],
      context({ organizations: [a, b], mapping: { ...MAPPING, foldArabic: true } }),
    )
    expect(preview.resolved).toBe(0)
    expect(codesOf(preview.readings)).toEqual(['organization-ambiguous'])
    // …and stays two distinct organizations with the flag off.
    const strict = mapJiraIssues(
      [issue('NPH-1', jiraFields('\u0645\u0633\u062A\u0634\u0641\u0649 \u0627\u0644\u0623\u0645\u0644', 'ADT', jiraStatus('Done')))],
      context({ organizations: [a, b] }),
    )
    expect(strict.readings[0]).toMatchObject({ outcome: 'resolved', organization: { id: 'n-a' } })
  })

  it('sees through an invisible RLM pasted into a Jira field', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields(`\u200F${'مستشفى الرياض العام'}\u200F`, 'ADT', jiraStatus('Done')))],
      context(),
    )
    expect(preview.readings[0]).toMatchObject({ outcome: 'resolved', organizationMatchedOn: 'name_ar' })
  })
})

/* ─────────────────── the properties that must always hold ────────────── */

describe('the harness itself', () => {
  it('NEVER DROPS AN ISSUE: one reading per issue, whatever came back', () => {
    const issues: JiraIssue[] = [
      issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done'))),
      issue('NPH-2', jiraFields(null, null, null)),
      issue('NPH-3', null),
      { id: '9', fields: {} },
      issue('NPH-5', jiraFields('Nowhere', 'Nothing', jiraStatus('Nope'))),
      issue('NPH-6', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done'))),
    ]
    const preview = mapJiraIssues(issues, context())
    expect(preview.readings).toHaveLength(issues.length)
    expect(preview.resolved + preview.unresolved).toBe(issues.length)
    for (const reading of preview.readings) {
      if (reading.outcome === 'unresolved') expect(reading.reasons.length).toBeGreaterThan(0)
    }
  })

  it('reports ALL THREE complaints on one issue, not just the first', () => {
    const preview = mapJiraIssues([issue('NPH-1', jiraFields(null, 'Nothing', jiraStatus('Nope')))], context())
    expect(codesOf(preview.readings)).toEqual([
      'organization-missing',
      'use-case-unknown',
      'status-unmapped',
    ])
  })

  it('is pure: same inputs, same answer, and nothing handed in is mutated', () => {
    const issues = [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done')))]
    const organizations = [RIYADH, JEDDAH]
    const useCases = [ADT, LAB]
    const existing: JiraExistingLink[] = [{ node_id: 'n-riyadh', use_case_id: 'u-adt', status: 'planned' }]
    const before = JSON.stringify({ issues, organizations, useCases, existing, mapping: MAPPING })

    const first = mapJiraIssues(issues, { organizations, useCases, mapping: MAPPING, existing })
    const second = mapJiraIssues(issues, { organizations, useCases, mapping: MAPPING, existing })

    expect(first).toEqual(second)
    expect(JSON.stringify({ issues, organizations, useCases, existing, mapping: MAPPING })).toBe(before)
  })

  it('joins the pair unambiguously without putting a NUL in the source', () => {
    // THE DEFECT THIS PINS, which was not a behaviour bug at all: `pairKey` used
    // a literal U+0000 as its separator, and BSD grep therefore called this file
    // BINARY. Every standing grep in the repo answered `Binary file matches`
    // instead of the line, which is how a whole module sat unwired through
    // several reviews without anybody reading it. The separator still cannot
    // occur in a uuid; it is now spelled `\u0000`.
    expect(MAP_SOURCE).not.toContain('\u0000')
    expect(MAP_SOURCE).toContain('\\u0000')
    // ⚠ AND THIS FILE TOO, WHICH IS WHERE THE DEFECT WENT NEXT. The first
    //   version of this very test wrote its expected value as a RAW U+0000
    //   byte, so `map.test.ts` became the binary file `map.ts` had stopped
    //   being — `grep -n MAP_SOURCE src/lib/jira/map.test.ts` printed nothing
    //   at all, and the assertion above went on passing regardless. A guard
    //   that makes itself ungreppable has moved the problem, not fixed it.
    //   Both sides are spelled with the escape; both sides are checked.
    expect(SELF_SOURCE).not.toContain('\u0000')
    // And it still separates: two different pairs whose concatenations would
    // collide under a naive join stay two different cells.
    const a = node({ id: 'ab', name: 'A' })
    const b = node({ id: 'a', name: 'B' })
    const one = capability({ id: 'c', name: 'One' })
    const two = capability({ id: 'bc', name: 'Two' })
    const preview = mapJiraIssues(
      [
        issue('NPH-1', jiraFields('A', 'One', jiraStatus('Done'))),
        issue('NPH-2', jiraFields('B', 'Two', jiraStatus('Done'))),
      ],
      context({ organizations: [a, b], useCases: [one, two] }),
    )
    expect(preview.resolved).toBe(2)
  })

  it('handles an empty payload and an empty workspace without special-casing either', () => {
    expect(mapJiraIssues([], context())).toEqual({
      readings: [],
      resolved: 0,
      unresolved: 0,
      effects: { create: 0, update: 0, unchanged: 0, held: 0 },
    })
    const empty = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done')))],
      context({ organizations: [], useCases: [] }),
    )
    expect(codesOf(empty.readings)).toEqual(['organization-unknown', 'use-case-unknown'])
  })
})

/* ─────────────────── the statuses the screen offers to map ───────────── */

describe('distinctStatusValues', () => {
  it('reads the CONFIGURED status field, not a literal `status`', () => {
    // A site may track this in a select field. The picker offering words from
    // `status` while the mapper judged `customfield_10099` would offer a list
    // that can never match — two readers of one axis, which is the shape of bug
    // this whole unit exists to remove.
    const issues = [
      issue('NPH-1', { [ORG_FIELD]: 'x', status: jiraStatus('Done'), cf: { value: 'Shipped' } }),
    ]
    expect(distinctStatusValues(issues, MAPPING)).toEqual(['Done'])
    expect(distinctStatusValues(issues, { ...MAPPING, statusField: 'cf' })).toEqual(['Shipped'])
  })

  it('dedupes by the normalised word and keeps the FIRST spelling seen', () => {
    // The first spelling is the one he has to recognise in the list; the
    // normalised form is what the mapper looks the mapping up by. Two spellings
    // of one status therefore share one row and one answer.
    const seen = distinctStatusValues(
      [
        issue('A', jiraFields('x', 'y', jiraStatus('In Progress'))),
        issue('B', jiraFields('x', 'y', jiraStatus('  in   progress '))),
        issue('C', jiraFields('x', 'y', jiraStatus('Done'))),
        issue('D', jiraFields('x', 'y', null)),
        issue('E', null),
      ],
      MAPPING,
    )
    expect(seen).toEqual(['In Progress', 'Done'])
  })

  it('offers every word a multi-valued field carried', () => {
    // The mapper refuses such an issue as `status-multivalued`, but a word seen
    // only on a refused issue is still a word he may want mapped — and hiding it
    // would make the refusal unfixable from this screen.
    expect(
      distinctStatusValues(
        [issue('A', jiraFields('x', 'y', [{ value: 'Done' }, { value: 'Backlog' }]))],
        MAPPING,
      ),
    ).toEqual(['Done', 'Backlog'])
  })

  it('folds the two spellings together only when the mapping asks', () => {
    const issues = [
      issue('A', jiraFields('x', 'y', jiraStatus('مكتملة'))),
      issue('B', jiraFields('x', 'y', jiraStatus('مكتمله'))),
    ]
    expect(distinctStatusValues(issues, MAPPING)).toHaveLength(2)
    expect(distinctStatusValues(issues, { ...MAPPING, foldArabic: true })).toEqual([
      'مكتملة',
    ])
  })
})

/* ──────────────────────── the wire-shape readers ─────────────────────── */

describe('normalizeName', () => {
  it('trims, collapses, lowercases and strips invisible marks', () => {
    expect(normalizeName('  Riyadh   General  Hospital ')).toBe('riyadh general hospital')
    expect(normalizeName('ADT')).toBe(normalizeName('adt'))
    expect(normalizeName('A B')).toBe('a b')
    expect(normalizeName('\uFEFFADT\u200B')).toBe('adt')
  })

  it('does NOT fold Arabic orthography by default, and DOES on request', () => {
    // \u0623 vs \u0627: a search box folds these unconditionally. Off by default here, because
    // folding can produce a confident wrong match where only one of two real
    // organizations is in the workspace; on when the mapping asks for it.
    expect(normalizeName('\u0623\u062D\u062F')).not.toBe(normalizeName('\u0627\u062D\u062F'))
    expect(normalizeName('\u0623\u062D\u062F', { arabic: true })).toBe(normalizeName('\u0627\u062D\u062F', { arabic: true }))
    // Latin is untouched either way.
    expect(normalizeName('ADT', { arabic: true })).toBe('adt')
  })
})

describe('textValuesOf', () => {
  it('reads every shape a Jira field value takes', () => {
    expect(textValuesOf('ADT')).toEqual(['ADT'])
    expect(textValuesOf({ value: 'ADT', id: '1' })).toEqual(['ADT'])
    expect(textValuesOf(jiraStatus('Done'))).toEqual(['Done'])
    expect(textValuesOf({ displayName: 'Sara Ali', accountId: 'x' })).toEqual(['Sara Ali'])
    expect(textValuesOf(['ops', 'uhr'])).toEqual(['ops', 'uhr'])
    expect(textValuesOf([{ value: 'ADT' }, { value: 'Lab Order' }])).toEqual(['ADT', 'Lab Order'])
    expect(textValuesOf(42)).toEqual(['42'])
    expect(textValuesOf(null)).toEqual([])
    expect(textValuesOf(undefined)).toEqual([])
    expect(textValuesOf({ id: '10001' })).toEqual([])
  })

  it('takes the PARENT of a cascading select', () => {
    expect(textValuesOf({ value: 'Riyadh', child: { value: 'North Wing' } })).toEqual(['Riyadh'])
  })

  it('reads ADF, which is what API v3 returns where v2 returned a string', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Riyadh General' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hospital' }] },
      ],
    }
    // ONE value, not two: a two-paragraph field is one name with a space in it.
    expect(textValuesOf(adf)).toEqual(['Riyadh General Hospital'])
  })

  it('resolves an ADF organization field end to end', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Jeddah Medical City' }] }],
    }
    const preview = mapJiraIssues([issue('NPH-1', jiraFields(adf, 'ADT', jiraStatus('Done')))], context())
    expect(preview.readings[0]).toMatchObject({ outcome: 'resolved' })
  })
})

describe('readFieldText', () => {
  it('tells "not in the payload" apart from "in the payload, empty"', () => {
    expect(readFieldText({ key: 'X', fields: {} }, 'customfield_1')).toEqual({ presence: 'absent', values: [] })
    expect(readFieldText({ key: 'X', fields: { customfield_1: null } }, 'customfield_1')).toEqual({
      presence: 'blank',
      values: [],
    })
    expect(readFieldText({ key: 'X', fields: { customfield_1: 'ADT' } }, 'customfield_1')).toEqual({
      presence: 'present',
      values: ['ADT'],
    })
    expect(readFieldText({ key: 'X' }, 'customfield_1')).toEqual({ presence: 'absent', values: [] })
    expect(readFieldText({ key: 'X', fields: { customfield_1: 'ADT' } }, '  ')).toEqual({
      presence: 'absent',
      values: [],
    })
  })
})

describe('readSearchPage', () => {
  it('is total: a body that is not a search page yields an empty page with no token', () => {
    // `isLast` reports what the payload SAID and nothing else — an error body
    // said nothing, so it is false. The stop signal is the absent token, which
    // is why a caller must never loop on `isLast` alone.
    for (const body of [null, undefined, 'nope', 42, [], { errorMessages: ['bad JQL'] }]) {
      expect(readSearchPage(body)).toEqual({ issues: [], nextPageToken: null, isLast: false })
    }
    expect(readSearchPage({ issues: [], isLast: true }).isLast).toBe(true)
  })

  it('keeps the token as the stop signal and drops non-object issues', () => {
    expect(
      readSearchPage({ issues: [{ key: 'NPH-1' }, 'junk', null], nextPageToken: 'abc', isLast: false }),
    ).toEqual({ issues: [{ key: 'NPH-1' }], nextPageToken: 'abc', isLast: false })

    // No token = last page, whatever `isLast` claims. `total` and `startAt` are
    // gone from this endpoint and nothing here invents them.
    const last = readSearchPage({ issues: [], nextPageToken: '', isLast: false })
    expect(last.nextPageToken).toBeNull()
    expect(Object.keys(last).sort()).toEqual(['isLast', 'issues', 'nextPageToken'])
  })
})

describe('the request side', () => {
  it('points at the endpoint that still answers', () => {
    expect(JIRA_SEARCH_PATH).toBe('/rest/api/3/search/jql')
  })

  it('asks for exactly the mapped fields, deduped — the default is id only', () => {
    expect(jiraSearchFields(MAPPING)).toEqual([ORG_FIELD, USE_CASE_FIELD, 'status'])
    expect(
      jiraSearchFields({ ...MAPPING, useCaseField: ORG_FIELD, statusField: '  ' }),
    ).toEqual([ORG_FIELD])
  })
})

describe('browseUrlFor', () => {
  it('builds a browse link and tolerates a trailing slash', () => {
    expect(browseUrlFor('https://x.atlassian.net', 'NPH-1')).toBe('https://x.atlassian.net/browse/NPH-1')
    expect(browseUrlFor('https://x.atlassian.net/', 'NPH-1')).toBe('https://x.atlassian.net/browse/NPH-1')
    expect(browseUrlFor('http://jira.local', 'NPH-1')).toBe('http://jira.local/browse/NPH-1')
  })

  it('returns null rather than a URL the external_url CHECK would refuse', () => {
    for (const base of [null, undefined, '', 'x.atlassian.net', 'javascript:alert(1)', 'ftp://x']) {
      expect(browseUrlFor(base, 'NPH-1')).toBeNull()
    }
  })

  it('escapes the key rather than pasting it into a path', () => {
    expect(browseUrlFor('https://x.atlassian.net', 'NPH 1/../admin')).toBe(
      'https://x.atlassian.net/browse/NPH%201%2F..%2Fadmin',
    )
  })

  it('is what the resolved reading carries, and null is a legal answer', () => {
    const preview = mapJiraIssues(
      [issue('NPH-1', jiraFields('Riyadh General Hospital', 'ADT', jiraStatus('Done')))],
      context({ mapping: { ...MAPPING, siteBaseUrl: 'nphies.atlassian.net' } }),
    )
    expect(preview.readings[0]).toMatchObject({ externalUrl: null, externalRef: 'NPH-1' })
  })
})
