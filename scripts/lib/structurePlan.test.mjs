// structurePlan — the tests that stand in for the things nobody on this fleet
// can check: a copy of Excel, and Aziz's live project.
//
// Every trap in the brief has the same symptom — "it looked fine and the import
// was wrong" — and every one of them is invisible to a test written against a
// file the author also wrote by hand in a text editor. So the fixtures here are
// deliberately hostile: CRLF endings, a byte-order mark, commas and newlines and
// doubled quotes inside quoted fields, a non-breaking space where a plain space
// belongs, a path seven deep, a use-case cell with a status nobody defined.
//
// The single most important test in this file is the last one. Plan → apply →
// re-plan → ASSERT EMPTY is the property that makes the spreadsheet an editable
// record rather than a one-shot loader, and it is the one that would rot first
// if the matching key drifted away from `map_nodes_sibling_name_uidx`.

import { readFileSync } from 'node:fs'

import { describe, it, expect } from 'vitest'

import {
  parseCsv,
  parseStructureCsv,
  planStructure,
  renderPlan,
  mergeRefusals,
  nearestName,
  resolveMember,
  clean,
  looksDateShaped,
  describeOddCharacters,
  comparePaths,
  keyOf,
  FIXED_COLUMNS,
  MAX_NODE_DEPTH,
  FSI,
  PDI,
  LRI,
} from './structurePlan.mjs'

// ── fixtures ────────────────────────────────────────────────────────────────

const TRACKS = [
  { id: 't-uhr', name: 'UHR', name_ar: 'السجل الصحي الموحد', archived: false },
  { id: 't-net', name: 'Network', name_ar: '', archived: false },
  { id: 't-old', name: 'Clarification', name_ar: '', archived: true },
]

const KINDS = [
  { id: 'k-prog', name: 'Programme' },
  { id: 'k-phase', name: 'Phase' },
  { id: 'k-org', name: 'Organization' },
]

const MEMBERS = [
  { id: 'p-sara', display_name: 'Sara Alsaab', username: 'sara.alsaab', email: 'sara.alsaab@opstrack.internal' },
  { id: 'p-nada', display_name: 'Nada Alsuwaida', username: 'nada.alsuwaida', email: 'nada.alsuwaida@opstrack.internal' },
  { id: 'p-a1', display_name: 'Ahmed Alnaji', username: 'ahmed.alnaji', email: 'ahmed.alnaji@opstrack.internal' },
  { id: 'p-a2', display_name: 'Ahmed Alnaji', username: 'ahmed.alkanhal', email: 'ahmed.alkanhal@opstrack.internal' },
  { id: 'p-aziz', display_name: 'Abdulaziz Alsaloom', username: null, email: 'az.alsaloom@gmail.com' },
]

const USE_CASES = [
  { id: 'u-adt', name: 'ADT', sort_order: 1 },
  { id: 'u-lab-order', name: 'Lab Order', sort_order: 8 },
  { id: 'u-lab-results', name: 'Lab Results', sort_order: 9 },
]

const HEADER = `${FIXED_COLUMNS.join(',')},ADT,Lab Order,Lab Results`

/** A workspace with nothing under any track — Aziz's, today. */
const emptyWorkspace = () => ({
  tracks: TRACKS,
  nodes: [],
  kinds: KINDS,
  members: MEMBERS,
  useCases: USE_CASES,
})

// THROUGH `mergeRefusals`, exactly as `import-structure.mjs` does. A helper that
// concatenated the two lists by hand would test a pipeline the CLI does not run,
// and the suppression of consequence-refusals is precisely the behaviour that
// would rot unnoticed.
function planCsv(csv, workspace = emptyWorkspace(), options = {}) {
  const parsed = parseStructureCsv(csv)
  const plan = planStructure({ ...workspace, rows: parsed.rows, ...options })
  return {
    ...plan,
    refusals: mergeRefusals(parsed.refusals, plan),
    parsed,
  }
}

const codes = (result) => result.refusals.map((r) => r.code)
const kinds = (result) => result.actions.map((a) => a.kind)
const pathsOf = (result, kind) =>
  result.actions.filter((a) => a.kind === kind).map((a) => a.path.join(' > '))

// ── the parser ──────────────────────────────────────────────────────────────

describe('parseCsv — RFC 4180 and the shapes Excel actually writes', () => {
  it('keeps a quoted comma as ONE field', () => {
    // The `split(',')` failure this parser exists for. Under split, this row
    // gains a field, every column right of the comma shifts left, and the row
    // still imports — into the wrong fields, with no error anywhere.
    const [row] = parseCsv('"Ministry of Health, Riyadh",Organization,Acme')
    expect(row.cells).toEqual(['Ministry of Health, Riyadh', 'Organization', 'Acme'])
  })

  it('reads a doubled quote inside a quoted field as one literal quote', () => {
    const [row] = parseCsv('"He said ""yes""",b')
    expect(row.cells).toEqual(['He said "yes"', 'b'])
  })

  it('keeps a newline inside a quoted field, and counts the line it started on', () => {
    const rows = parseCsv('a,b\n"one\ntwo",c\nlast,x')
    expect(rows).toHaveLength(3)
    expect(rows[1].cells).toEqual(['one\ntwo', 'c'])
    // The third RECORD starts on the fourth LINE, and a person greps for lines.
    expect(rows[2].line).toBe(4)
  })

  it('handles CRLF, LF, and a final line with no terminator', () => {
    expect(parseCsv('a,b\r\nc,d\r\n').map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseCsv('a,b\nc,d').map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseCsv('a,b').map((r) => r.cells)).toEqual([['a', 'b']])
  })

  it('strips a leading BOM so the first header is `path` and not `\\uFEFFpath`', () => {
    // Trap 1's second half. The templates are WRITTEN with a BOM, because
    // without one Excel guesses the local ANSI codepage and every Arabic name
    // opens as mojibake — which is then what a save writes back to disk.
    const [row] = parseCsv('﻿path,name_ar')
    expect(row.cells[0]).toBe('path')
  })

  it('refuses an unterminated quote instead of swallowing the rest of the file', () => {
    expect(() => parseCsv('a,"unterminated\nb,c\n')).toThrow(/unterminated quoted field/u)
  })

  it('preserves an empty trailing field', () => {
    expect(parseCsv('a,b,').map((r) => r.cells)).toEqual([['a', 'b', '']])
  })
})

describe('parseStructureCsv — the header contract', () => {
  it('accepts the shipped header and reads the use-case columns', () => {
    const { rows, useCaseColumns, refusals } = parseStructureCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,live,,`,
    )
    expect(refusals).toEqual([])
    expect(useCaseColumns).toEqual(['ADT', 'Lab Order', 'Lab Results'])
    expect(rows).toHaveLength(1)
    expect(rows[0].segments).toEqual(['UHR', 'Onboarding', 'Riyadh Care'])
    expect(rows[0].cells.find((c) => c.column === 'ADT').status).toBe('live')
    expect(rows[0].cells.find((c) => c.column === 'Lab Order').status).toBeNull()
  })

  it('refuses a reordered fixed column rather than remapping it', () => {
    const bad = ['path', 'kind', 'name_ar', 'account_manager', 'vendor', 'description', 'description_ar']
    const { refusals } = parseStructureCsv(`${bad.join(',')}\n`)
    expect(refusals.map((r) => r.code)).toEqual(['header_columns'])
    expect(refusals[0].message).toContain('name_ar')
  })

  it('refuses one capability named by two columns', () => {
    const { refusals } = parseStructureCsv(`${FIXED_COLUMNS.join(',')},ADT,ADT\n`)
    expect(refusals.map((r) => r.code)).toContain('header_duplicate')
  })

  it('refuses a row with more fields than the header — the unquoted-comma symptom', () => {
    const { refusals } = parseStructureCsv(
      `${HEADER}\nUHR > OB > Ministry of Health, Riyadh,,Organization,,,,,live,,`,
    )
    expect(refusals.map((r) => r.code)).toEqual(['row_too_wide'])
  })

  it('refuses a row with FEWER fields than the header, rather than inventing blanks', () => {
    // THIS USED TO BE TOLERATED as "Excel omits trailing empties", and the
    // tolerance was two silent-corruption holes wearing one coat. A missing cell
    // and an empty cell are not the same statement: an empty cell on an explicit
    // row CLEARS the field, so a one-cell row wiped name_ar, both descriptions,
    // the vendor, the kind and the account manager off a fully-populated node —
    // and deleted every use-case link on it — with zero refusals.
    const { rows, refusals } = parseStructureCsv(`${HEADER}\nUHR > Onboarding > Riyadh Care`)
    expect(refusals.map((r) => r.code)).toEqual(['row_too_narrow'])
    expect(rows).toHaveLength(0)
  })

  it('refuses the SPARSE shift — an unquoted comma on a mostly-blank row', () => {
    // The one `row_too_wide` could never catch, and the one that actually
    // happens: a real use-case matrix is mostly blank, so an unquoted comma in
    // `vendor` still leaves the row SHORTER than the header. Under the old rule
    // this parsed clean, with `Riyadh` filed as the description and `live`
    // relocated one capability to the right. There was no error to see.
    const { refusals } = parseStructureCsv(
      `${HEADER}\nUHR > Onboarding > Org A,,Organization,,Mirqab Integration Co., Riyadh,,live`,
    )
    expect(refusals.map((r) => r.code)).toEqual(['row_too_narrow'])
  })

  it('says "stray trailing comma" when the extra field is empty, and not otherwise', () => {
    const trailing = parseStructureCsv(`${HEADER}\nUHR > A,,,,,,,,,,`)
    expect(trailing.refusals.map((r) => r.code)).toEqual(['row_too_wide'])
    expect(trailing.refusals[0].message).toContain('stray extra comma')

    const shifted = parseStructureCsv(`${HEADER}\nUHR > A,,,,Acme, Riyadh,,,,,live`)
    expect(shifted.refusals.map((r) => r.code)).toEqual(['row_too_wide'])
    expect(shifted.refusals[0].message).toContain('has to be quoted')
  })

  it('ignores blank lines, which Excel leaves at the end of a file', () => {
    const { rows, refusals } = parseStructureCsv(`${HEADER}\r\nUHR > A,,,,,,,,,\r\n\r\n,,,,,,,,,\r\n`)
    expect(refusals).toEqual([])
    expect(rows).toHaveLength(1)
  })
})

describe('parseStructureCsv — the cell rules', () => {
  it('refuses a status that is not one of the three, and says blank is not a fourth', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR > A,,,,,,,done,,`)
    expect(refusals.map((r) => r.code)).toEqual(['status_unknown'])
    expect(refusals[0].message).toMatch(/planned, testing, live/u)
    expect(refusals[0].message).toMatch(/not a fourth status/u)
  })

  it('accepts the three statuses in any case, and treats blank as null', () => {
    const { rows, refusals } = parseStructureCsv(`${HEADER}\nUHR > A,,,,,,,LIVE, Testing ,`)
    expect(refusals).toEqual([])
    const byColumn = Object.fromEntries(rows[0].cells.map((c) => [c.column, c.status]))
    expect(byColumn).toEqual({ ADT: 'live', 'Lab Order': 'testing', 'Lab Results': null })
  })

  it('refuses a path deeper than the database will accept, naming the path', () => {
    const deep = ['UHR', ...Array.from({ length: MAX_NODE_DEPTH + 1 }, (_, i) => `L${i}`)].join(' > ')
    const { refusals } = parseStructureCsv(`${HEADER}\n${deep},,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['path_too_deep'])
    expect(refusals[0].message).toContain(String(MAX_NODE_DEPTH))
  })

  it('accepts a path exactly at the cap', () => {
    const atCap = ['UHR', ...Array.from({ length: MAX_NODE_DEPTH }, (_, i) => `L${i}`)].join(' > ')
    const { refusals, rows } = parseStructureCsv(`${HEADER}\n${atCap},,,,,,,,,`)
    expect(refusals).toEqual([])
    expect(rows).toHaveLength(1)
  })

  it('refuses a name past 60 characters — map_nodes_name_len_chk', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR > ${'x'.repeat(61)},,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['name_too_long'])
  })

  it('refuses a track-only path', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR,,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['path_track_only'])
  })

  it('refuses an empty segment in the middle of a path', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR >  > Riyadh Care,,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['path_segment_empty'])
  })

  it('drops a trailing separator rather than refusing it', () => {
    const { rows, refusals } = parseStructureCsv(`${HEADER}\nUHR > Onboarding > ,,,,,,,,,`)
    expect(refusals).toEqual([])
    expect(rows[0].segments).toEqual(['UHR', 'Onboarding'])
  })
})

// ── invisible characters ────────────────────────────────────────────────────

describe('invisible characters — trap 5', () => {
  it('clean() removes the characters a paste carries and folds the whitespace', () => {
    expect(clean('UHR ')).toBe('UHR')
    expect(clean('Riyadh​ Care')).toBe('Riyadh Care')
    expect(clean('  Onboarding  ')).toBe('Onboarding')
    expect(clean('‏UHR‎')).toBe('UHR')
  })

  it('a path pasted with a no-break space still finds its track', () => {
    // The whole point: ` ` is not ` `, so a naive matcher tells him there
    // is no track called UHR while UHR is sitting on his screen.
    const result = planCsv(`${HEADER}\nUHR > Onboarding,,Phase,,,,,,,`)
    expect(codes(result)).toEqual([])
    expect(pathsOf(result, 'create-node')).toEqual(['UHR > Onboarding'])
  })

  it('describeOddCharacters names the INVISIBLE characters, so the refusal is fixable', () => {
    expect(describeOddCharacters('UHR\u00a0X')).toContain('non-breaking space')
    expect(describeOddCharacters('UHR\u200b')).toContain('zero-width space')
    expect(describeOddCharacters('UHR')).toBe('')
  })

  it('NEVER flags a plain space — the separator itself puts one on every segment', () => {
    // The naive version of this function fires on every path segment of every
    // row, because splitting `UHR > Onboarding` on `>` yields 'UHR '. A note
    // that is always printed is a note nobody reads, and it would sit directly
    // beside the one that matters. clean() normalises both sides of every
    // comparison, so a plain space can never be the CAUSE of a mismatch.
    expect(describeOddCharacters('UHR ')).toBe('')
    expect(describeOddCharacters(' UHR')).toBe('')
    expect(describeOddCharacters('King  Faisal')).toBe('')
    const result = planCsv(`${HEADER}\nNope > A,,,,,,,,,`)
    expect(result.refusals[0].code).toBe('track_missing')
    expect(result.refusals[0].message).not.toContain('space')
  })

  it('a track that genuinely does not exist is refused with the note attached', () => {
    // The refusal has to distinguish "you typed a track that does not exist"
    // from "you typed a track that exists and has a stray character in it".
    const result = planCsv(`${HEADER}\nUH​Z > Onboarding,,,,,,,,,`)
    expect(codes(result)).toEqual(['track_missing'])
    expect(result.refusals[0].message).toContain('zero-width space')
    expect(result.refusals[0].message).toContain('stripped before this lookup')
    expect(result.refusals[0].message).toContain('Settings › Tracks')
  })
})

// ── date-shaped values ──────────────────────────────────────────────────────

describe('date-shaped values — trap 4', () => {
  it('recognises the shapes Excel turns a name into', () => {
    expect(looksDateShaped('1-2-3')).toBe(true)
    expect(looksDateShaped('2024-01-02')).toBe(true)
    expect(looksDateShaped('3-Jan')).toBe(true)
    expect(looksDateShaped('Feb-24')).toBe(true)
    expect(looksDateShaped('45000')).toBe(true)
  })

  it('leaves a real name alone', () => {
    expect(looksDateShaped('Acme Health Systems')).toBe(false)
    expect(looksDateShaped('1-2-3 Systems')).toBe(false)
    expect(looksDateShaped('')).toBe(false)
  })

  it('WARNS about a date-shaped vendor without refusing it', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,,2024-01-02,,,,,`)
    expect(codes(result)).toEqual([])
    expect(result.notes.some((n) => n.kind === 'date_shaped')).toBe(true)
    expect(pathsOf(result, 'create-node')).toEqual(['UHR > A'])
  })
})

// ── resolution ──────────────────────────────────────────────────────────────

describe('the account manager is never guessed', () => {
  it('matches a username first and says so', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,sara.alsaab,,,,,,`)
    const create = result.actions.find((a) => a.kind === 'create-node')
    expect(create.values.account_manager_id).toBe('p-sara')
    expect(create.values.amMatchedBy).toBe('username')
  })

  it('matches an email, and tolerates a leading @ on a handle', () => {
    expect(resolveMember('az.alsaloom@gmail.com', MEMBERS).member.id).toBe('p-aziz')
    expect(resolveMember('@nada.alsuwaida', MEMBERS).matchedBy).toBe('username')
  })

  it('matches an exact display name only when nothing above it did', () => {
    expect(resolveMember('Sara Alsaab', MEMBERS).matchedBy).toBe('display name')
  })

  it('REFUSES two people sharing a display name, naming both', () => {
    // provision-people.mjs's roster has three Ahmeds. Silently preferring one
    // is how the wrong person ends up accountable for an organization.
    const result = planCsv(`${HEADER}\nUHR > A,,,Ahmed Alnaji,,,,,,`)
    expect(codes(result)).toEqual(['member_ambiguous'])
    expect(result.refusals[0].message).toContain('ahmed.alnaji')
    expect(result.refusals[0].message).toContain('ahmed.alkanhal')
    expect(result.actions).toEqual([])
  })

  it('refuses a name that matches nobody', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,someone.else,,,,,,`)
    expect(codes(result)).toEqual(['member_unknown'])
  })

  it('leaves a blank account manager unassigned rather than refusing', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,,,,,,,`)
    expect(codes(result)).toEqual([])
    expect(result.actions[0].values.account_manager_id).toBeNull()
  })
})

describe('tracks, kinds and capabilities', () => {
  it('refuses a missing track and says this script does not create one', () => {
    const result = planCsv(`${HEADER}\nAyenati > A,,,,,,,,,`)
    expect(codes(result)).toEqual(['track_missing'])
    expect(result.refusals[0].message).toMatch(/does NOT create tracks/u)
    expect(result.refusals[0].message).toContain('UHR')
  })

  it('refuses an archived track', () => {
    const result = planCsv(`${HEADER}\nClarification > A,,,,,,,,,`)
    expect(codes(result)).toEqual(['track_archived'])
  })

  it('matches a track by its Arabic name and says which name matched', () => {
    const result = planCsv(`${HEADER}\nالسجل الصحي الموحد > A,,,,,,,,,`)
    expect(codes(result)).toEqual([])
    expect(result.notes.some((n) => n.kind === 'track_matched_ar')).toBe(true)
  })

  it('refuses an unknown kind and lists the ones that exist', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,Hospital,,,,,,,`)
    expect(codes(result)).toEqual(['kind_unknown'])
    expect(result.refusals[0].message).toContain('Programme, Phase, Organization')
  })

  it('refuses an unknown use-case column and lists the catalogue', () => {
    const result = planCsv(
      `${FIXED_COLUMNS.join(',')},ADT,Radiolegy Report\nUHR > A,,,,,,,live,live`,
    )
    expect(codes(result)).toContain('use_case_unknown')
    expect(result.refusals[0].message).toContain('Lab Results')
    expect(result.refusals[0].message).toContain('--add-use-cases')
  })

  it('--add-use-cases turns that refusal into a create, and prints what it would add', () => {
    const result = planCsv(
      `${FIXED_COLUMNS.join(',')},ADT,Prior Authorisation\nUHR > A,,,,,,,live,planned`,
      emptyWorkspace(),
      { addUseCases: true },
    )
    expect(codes(result)).toEqual([])
    const created = result.actions.filter((a) => a.kind === 'create-use-case')
    expect(created).toHaveLength(1)
    expect(created[0].name).toBe('Prior Authorisation')
    // After the seeded nine, not on top of one of them.
    expect(created[0].sortOrder).toBe(10)
    expect(renderPlan(result, {})).toContain('Prior Authorisation')
  })
})

// ── the tree ────────────────────────────────────────────────────────────────

describe('implied intermediate nodes', () => {
  it('creates the ancestors a leaf implies', () => {
    const result = planCsv(`${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,live,,`)
    expect(codes(result)).toEqual([])
    expect(pathsOf(result, 'create-node')).toEqual(['UHR > Onboarding', 'UHR > Onboarding > Riyadh Care'])
    const implied = result.actions.find((a) => a.path.join(' > ') === 'UHR > Onboarding')
    expect(implied.implied).toBe(true)
    expect(implied.values.kind_id).toBeNull()
  })

  it('LISTING EVERY LEVEL AND LISTING ONLY LEAVES PRODUCE THE SAME TREE', () => {
    // The contract's promise. Both files have to build the same shape, or a
    // colleague's half-filled sheet quietly means something else.
    const leavesOnly = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,live,,\nUHR > Onboarding > Jeddah Clinic,,Organization,,,,,,planned,`,
    )
    const everyLevel = planCsv(
      `${HEADER}\nUHR > Onboarding,,Phase,,,,,,,\nUHR > Onboarding > Riyadh Care,,Organization,,,,,live,,\nUHR > Onboarding > Jeddah Clinic,,Organization,,,,,,planned,`,
    )
    expect(pathsOf(leavesOnly, 'create-node')).toEqual(pathsOf(everyLevel, 'create-node'))
    // The one difference is the one the contract promises: an explicit row is
    // how you give an intermediate node a kind.
    const impliedPhase = leavesOnly.actions.find((a) => a.path.join(' > ') === 'UHR > Onboarding')
    const explicitPhase = everyLevel.actions.find((a) => a.path.join(' > ') === 'UHR > Onboarding')
    expect(impliedPhase.values.kind_id).toBeNull()
    expect(explicitPhase.values.kind_id).toBe('k-phase')
  })

  it('an explicit row wins wherever it appears in the file', () => {
    const after = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,,,\nUHR > Onboarding,مرحلة,Phase,,,,,,,`,
    )
    const phase = after.actions.find((a) => a.path.join(' > ') === 'UHR > Onboarding')
    expect(phase.implied).toBe(false)
    expect(phase.values.kind_id).toBe('k-phase')
    expect(phase.values.name_ar).toBe('مرحلة')
  })

  it('PARENTS ARE ALWAYS CREATED BEFORE CHILDREN', () => {
    // A child written first has no parent to point at, and 0023's derive
    // trigger raises rather than guessing.
    const result = planCsv(
      `${HEADER}\nUHR > A > B > C,,,,,,,,,\nUHR > A,,Programme,,,,,,,\nUHR > A > B,,Phase,,,,,,,`,
    )
    const depths = result.actions.filter((a) => a.kind === 'create-node').map((a) => a.depth)
    expect(depths).toEqual([...depths].sort((x, y) => x - y))
    expect(pathsOf(result, 'create-node')).toEqual(['UHR > A', 'UHR > A > B', 'UHR > A > B > C'])
  })

  it('refuses two rows for one node rather than letting file order decide', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,Phase,,,,,,,\nuhr > a,,Programme,,,,,,,`)
    expect(codes(result)).toEqual(['duplicate_path'])
  })

  it('gives siblings sort orders in FILE order, so the map reads as he typed it', () => {
    // Not alphabetical: he typed Zulfi first because Zulfi came first, and a
    // map that silently re-alphabetises his list is a map he has to re-read.
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Zulfi,,,,,,,,,\nUHR > Onboarding > Abha,,,,,,,,,`,
    )
    const orders = Object.fromEntries(
      result.actions
        .filter((a) => a.kind === 'create-node' && a.depth === 2)
        .map((a) => [a.name, a.sortOrder]),
    )
    expect(orders).toEqual({ Zulfi: 1, Abha: 2 })
  })
})

// ── updates ─────────────────────────────────────────────────────────────────

/** A workspace that already holds `UHR > Onboarding > Riyadh Care`. */
function populated() {
  return {
    ...emptyWorkspace(),
    nodes: [
      {
        id: 'n-ob',
        parent_id: null,
        track_id: 't-uhr',
        kind_id: 'k-phase',
        name: 'Onboarding',
        name_ar: '',
        description: '',
        description_ar: '',
        account_manager_id: null,
        vendor: '',
        sort_order: 1,
        archived: false,
        map_node_use_cases: [],
      },
      {
        id: 'n-rc',
        parent_id: 'n-ob',
        track_id: 't-uhr',
        kind_id: 'k-org',
        name: 'Riyadh Care',
        name_ar: '',
        description: '',
        description_ar: '',
        account_manager_id: 'p-sara',
        vendor: 'Acme',
        sort_order: 1,
        archived: false,
        map_node_use_cases: [{ use_case_id: 'u-adt', status: 'testing' }],
      },
    ],
  }
}

describe('updates carry only the fields that actually differ', () => {
  it('says nothing when the file says what the workspace already says', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,testing,,`,
      populated(),
    )
    expect(codes(result)).toEqual([])
    expect(result.actions).toEqual([])
    expect(renderPlan(result, {})).toContain('NOTHING TO DO')
  })

  it('emits one change per differing field, with old -> new', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,مركز الرياض,Organization,nada.alsuwaida,Beta,,,testing,,`,
      populated(),
    )
    const update = result.actions.find((a) => a.kind === 'update-node')
    const byField = Object.fromEntries(update.changes.map((c) => [c.field, [c.from, c.to]]))
    expect(Object.keys(byField).sort()).toEqual(['account_manager', 'name_ar', 'vendor'])
    expect(byField.vendor).toEqual(['Acme', 'Beta'])
    expect(byField.account_manager).toEqual(['p-sara', 'p-nada'])
    const printed = renderPlan(result, {})
    expect(printed).toContain('Acme')
    expect(printed).toContain('Beta')
  })

  it('a blank cell on an EXPLICIT row clears the field, and the plan shows it', () => {
    // The one surprise in the contract, so it is printed rather than buried:
    // blank means "not recorded", which is a value.
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,,,,testing,,`,
      populated(),
    )
    const update = result.actions.find((a) => a.kind === 'update-node')
    expect(update.changes).toEqual([
      expect.objectContaining({ field: 'vendor', from: 'Acme', to: '' }),
    ])
    expect(renderPlan(result, {})).toContain('(blank)')
  })

  it('an IMPLIED node is never updated — it speaks about nothing', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,testing,,`,
      populated(),
    )
    expect(result.actions.filter((a) => a.path.join(' > ') === 'UHR > Onboarding')).toEqual([])
  })

  it('matches an existing node case-insensitively, the way the index does', () => {
    // map_nodes_sibling_name_uidx is lower(btrim(name)). Matching any other way
    // would emit a create the database then refuses as a duplicate.
    const result = planCsv(
      `${HEADER}\n uhr  >  ONBOARDING  >  riyadh care ,,Organization,sara.alsaab,Acme,,,testing,,`,
      populated(),
    )
    expect(kinds(result)).toEqual([])
  })
})

// ── the use-case matrix ─────────────────────────────────────────────────────

describe('the use-case matrix', () => {
  it('sets a link that is not there, and changes one that says something else', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,live,planned,`,
      populated(),
    )
    const sets = result.actions.filter((a) => a.kind === 'set-use-case')
    expect(sets.map((a) => [a.useCase, a.from, a.status])).toEqual([
      ['ADT', 'testing', 'live'],
      ['Lab Order', null, 'planned'],
    ])
  })

  it('A BLANK CELL CLEARS AN EXISTING LINK — absence is not a fourth status', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,`,
      populated(),
    )
    const clears = result.actions.filter((a) => a.kind === 'clear-use-case')
    expect(clears).toHaveLength(1)
    expect(clears[0]).toMatchObject({ useCase: 'ADT', useCaseId: 'u-adt', from: 'testing' })
    expect(renderPlan(result, {})).toContain('the link is deleted')
  })

  it('a blank cell where there is no link is a no-op, not a delete', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,testing,,`,
      populated(),
    )
    expect(result.actions.filter((a) => a.kind === 'clear-use-case')).toEqual([])
  })

  it('never emits a status that is not one of the three', () => {
    const result = planCsv(
      `${HEADER}\nUHR > A,,,,,,,live,testing,planned`,
    )
    const statuses = result.actions.filter((a) => a.kind === 'set-use-case').map((a) => a.status)
    expect(statuses.sort()).toEqual(['live', 'planned', 'testing'])
  })

  it('links are ordered after every node create', () => {
    const result = planCsv(`${HEADER}\nUHR > A > B,,,,,,,live,,`)
    const order = kinds(result)
    expect(order.lastIndexOf('create-node')).toBeLessThan(order.indexOf('set-use-case'))
  })
})

// ── deletion by omission ────────────────────────────────────────────────────

describe('the file is not authoritative for deletion', () => {
  it('reports a node that is in the app and not in the file, and plans nothing for it', () => {
    const result = planCsv(`${HEADER}\nUHR > Onboarding,,Phase,,,,,,,`, populated())
    const missing = result.notes.filter((n) => n.kind === 'not_in_file')
    expect(missing).toHaveLength(1)
    expect(missing[0].path).toEqual(['UHR', 'Onboarding', 'Riyadh Care'])
    expect(result.actions.some((a) => a.path.includes('Riyadh Care'))).toBe(false)
  })

  it('says so in the PRINTOUT, not only in a comment', () => {
    const printed = renderPlan(planCsv(`${HEADER}\nUHR > Onboarding,,Phase,,,,,,,`, populated()), {})
    expect(printed).toContain('IN THE APP BUT NOT IN THIS FILE')
    expect(printed).toMatch(/NOT archived/u)
  })

  it('does not report nodes under a track the file never mentions', () => {
    const workspace = populated()
    workspace.nodes.push({
      id: 'n-net',
      parent_id: null,
      track_id: 't-net',
      kind_id: null,
      name: 'Core Switches',
      name_ar: '',
      description: '',
      description_ar: '',
      account_manager_id: null,
      vendor: '',
      sort_order: 1,
      archived: false,
      map_node_use_cases: [],
    })
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,testing,,`,
      workspace,
    )
    expect(result.notes.filter((n) => n.kind === 'not_in_file')).toEqual([])
  })
})

// ── the printout ────────────────────────────────────────────────────────────

describe('the printout is the product', () => {
  it('isolates a mixed Arabic/Latin path so a terminal cannot reorder it', () => {
    const result = planCsv(`${HEADER}\nUHR > مستشفى الملك > Clinic,,,,,,,,,`)
    const printed = renderPlan(result, { file: 'docs/templates/structure.csv' })
    expect(printed).toContain(`${FSI}مستشفى الملك${PDI}`)
    // The whole-path form used in refusals and notes wraps in LRI…PDI, because
    // `A > B > C` is left-to-right whatever the names are.
    const refused = planCsv(
      `${HEADER}\nUHR > مستشفى > A > B > C > D > E > F,,,,,,,,,`,
    )
    expect(refused.refusals[0].code).toBe('path_too_deep')
    expect(refused.refusals[0].message).toContain(LRI)
    expect(refused.refusals[0].message).toContain(`${FSI}مستشفى${PDI}`)
  })

  it('says all-or-nothing whenever there is a refusal', () => {
    const printed = renderPlan(planCsv(`${HEADER}\nNope > A,,,,,,,,,`), {})
    expect(printed).toContain('REFUSALS')
    expect(printed).toMatch(/--apply DOES NOTHING AT ALL/u)
  })

  it('ends with the one-line reconciliation', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,nada.alsuwaida,Acme,,,live,,`,
      populated(),
    )
    expect(renderPlan(result, {})).toMatch(
      /Summary: \d+ node\(s\) to create \(\d+ implied\) · \d+ to update · \d+ use-case link\(s\) to set · \d+ to clear/u,
    )
  })

  it('marks a dry run and an apply run differently, in the first three lines', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,,,,,,,`)
    expect(renderPlan(result, { apply: false })).toContain('dry run — nothing will be written')
    expect(renderPlan(result, { apply: true })).toContain('*** --apply: THIS RUN WRITES ***')
  })

  it('shows an implied node as implied, so nobody wonders where it came from', () => {
    const printed = renderPlan(planCsv(`${HEADER}\nUHR > Onboarding > Riyadh Care,,,,,,,,,`), {})
    expect(printed).toContain('(implied — no row of its own)')
  })
})

// ── re-runnability ──────────────────────────────────────────────────────────

/**
 * Apply a plan to a snapshot, the way `import-structure.mjs` applies it to the
 * database. DELIBERATELY A SECOND IMPLEMENTATION: if this reused the planner's
 * own bookkeeping it would prove only that the planner agrees with itself.
 */
function applyToSnapshot(workspace, actions) {
  const next = {
    ...workspace,
    nodes: workspace.nodes.map((n) => ({ ...n, map_node_use_cases: [...(n.map_node_use_cases ?? [])] })),
    useCases: [...workspace.useCases],
  }
  // Keyed through the module's own `keyOf`, exactly as `import-structure.mjs`
  // does. That function is the ONE place the key format lives — the first draft
  // of the importer reimplemented it with a different separator and resolved
  // every parent to undefined at apply time, which is the bug this whole block
  // exists to make impossible to have twice.
  const idByKey = new Map()
  for (const node of next.nodes) {
    const names = []
    let cursor = node
    const byId = new Map(next.nodes.map((n) => [n.id, n]))
    while (cursor) {
      names.unshift(cursor.name)
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null
    }
    idByKey.set(keyOf(node.track_id, names), node.id)
  }

  let seq = 0
  for (const action of actions) {
    if (action.kind === 'create-use-case') {
      next.useCases.push({ id: `new-uc-${(seq += 1)}`, name: action.name, sort_order: action.sortOrder })
      continue
    }
    if (action.kind === 'create-node') {
      const id = `new-${(seq += 1)}`
      next.nodes.push({
        id,
        parent_id: action.parentKey ? idByKey.get(action.parentKey) : null,
        track_id: action.trackId,
        kind_id: action.values.kind_id,
        name: action.name,
        name_ar: action.values.name_ar,
        description: action.values.description,
        description_ar: action.values.description_ar,
        account_manager_id: action.values.account_manager_id,
        vendor: action.values.vendor,
        sort_order: action.sortOrder,
        archived: false,
        map_node_use_cases: [],
      })
      idByKey.set(keyOf(action.trackId, action.path.slice(1)), id)
      continue
    }
    const node = next.nodes.find((n) => n.id === (action.nodeId ?? idByKey.get(action.key)))
    if (!node) throw new Error(`applyToSnapshot: no node for ${action.path.join(' > ')}`)
    if (action.kind === 'update-node') {
      for (const change of action.changes) {
        if (change.field === 'kind') node.kind_id = change.to
        else if (change.field === 'account_manager') node.account_manager_id = change.to
        else node[change.field] = change.to
      }
    } else if (action.kind === 'set-use-case') {
      const id =
        action.useCaseId ?? next.useCases.find((u) => clean(u.name) === clean(action.useCase)).id
      const link = node.map_node_use_cases.find((l) => l.use_case_id === id)
      if (link) link.status = action.status
      else node.map_node_use_cases.push({ use_case_id: id, status: action.status })
    } else if (action.kind === 'clear-use-case') {
      node.map_node_use_cases = node.map_node_use_cases.filter(
        (l) => l.use_case_id !== action.useCaseId,
      )
    }
  }
  return next
}

describe('RE-RUNNABLE — plan, apply, re-plan, and the second plan is empty', () => {
  const FILE = [
    HEADER,
    'UHR > Onboarding,التسجيل,Phase,,,The onboarding programme,,,,',
    'UHR > Onboarding > Riyadh Care,مركز الرياض,Organization,sara.alsaab,Acme Integrations,,,live,planned,',
    // The WHOLE cell is quoted, which is what Excel writes for a value with a
    // comma in it — not a quoted fragment in the middle of an unquoted field.
    '"UHR > Onboarding > Ministry of Health, Riyadh",,Organization,@nada.alsuwaida,,,,testing,,live',
    'UHR > Onboarding > Jeddah Clinic > North Wing,,Organization,,Beta Systems,,,,,',
    'Network > Core,,Programme,,,,,,,',
  ].join('\r\n')

  it('lands the whole file on an empty workspace and then has nothing left to do', () => {
    const first = planCsv(FILE)
    expect(codes(first)).toEqual([])
    // Onboarding, Riyadh Care, Ministry of Health, Jeddah Clinic (IMPLIED —
    // only its North Wing has a row), North Wing, and Network > Core.
    expect(first.summary.create).toBe(6)
    expect(first.summary.createImplied).toBe(1)
    const after = applyToSnapshot(emptyWorkspace(), first.actions)

    const second = planCsv(FILE, after)
    expect(codes(second)).toEqual([])
    expect(second.actions).toEqual([])
    expect(renderPlan(second, {})).toContain('NOTHING TO DO')

    // …and a third run of the same file is still empty, which is what makes the
    // spreadsheet a record rather than a one-shot loader.
    const third = planCsv(FILE, applyToSnapshot(after, second.actions))
    expect(third.actions).toEqual([])
  })

  it('re-runs cleanly after an edit, planning only the edit', () => {
    const after = applyToSnapshot(emptyWorkspace(), planCsv(FILE).actions)
    const edited = FILE.replace('Acme Integrations', 'Gamma Health').replace(',live,planned,', ',live,live,')
    const plan = planCsv(edited, after)
    expect(codes(plan)).toEqual([])
    expect(plan.actions.map((a) => a.kind)).toEqual(['update-node', 'set-use-case'])
    expect(plan.actions[0].changes).toEqual([
      expect.objectContaining({ field: 'vendor', from: 'Acme Integrations', to: 'Gamma Health' }),
    ])
  })

  it('the quoted comma survives the whole round trip as one node name', () => {
    const after = applyToSnapshot(emptyWorkspace(), planCsv(FILE).actions)
    expect(after.nodes.some((n) => n.name === 'Ministry of Health, Riyadh')).toBe(true)
    expect(after.nodes.some((n) => n.name === 'Ministry of Health')).toBe(false)
  })

  it('the Arabic name survives the round trip intact', () => {
    const after = applyToSnapshot(emptyWorkspace(), planCsv(FILE).actions)
    expect(after.nodes.find((n) => n.name === 'Riyadh Care').name_ar).toBe('مركز الرياض')
  })
})

// ── the file that actually ships ────────────────────────────────────────────
//
// EVERY TEST ABOVE READS A FIXTURE THIS FILE WROTE, which is exactly the blind
// spot the brief names: a test written by someone who never opened the file in
// Excel. These read the two CSVs that are handed to Aziz, off disk, bytes and
// all — the BOM, the CRLF, the quoted comma, the Arabic, the ten header names
// that have to match 0024's seed or every column is an unknown-capability
// refusal.

const TEMPLATE_DIR = new URL('../../docs/templates/', import.meta.url)
const readTemplate = (name) => readFileSync(new URL(name, TEMPLATE_DIR), 'utf8')

/** 0024's seed, verbatim and in its sort order. The header must be exactly this. */
const SEEDED_USE_CASES = [
  'ADT',
  'Medication Prescribe V1',
  'Medication Prescribe V2',
  'Medication Dispense V1',
  'Medication Dispense V2',
  'Radiology Order',
  'Radiology Report',
  'Lab Order',
  'Lab Results',
  'Clinical Notes',
]

describe('the shipped templates', () => {
  it('all three files begin with a UTF-8 BOM — without it Excel destroys the Arabic', () => {
    for (const name of ['structure.csv', 'structure.example.csv', 'structure.demo.csv']) {
      const bytes = readFileSync(new URL(name, TEMPLATE_DIR))
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    }
  })

  it('all three files carry the SAME header, and it matches 0024 exactly and in order', () => {
    const headerOf = (name) => parseCsv(readTemplate(name))[0].cells
    expect(headerOf('structure.example.csv')).toEqual(headerOf('structure.csv'))
    expect(headerOf('structure.demo.csv')).toEqual(headerOf('structure.csv'))
    expect(headerOf('structure.csv')).toEqual([...FIXED_COLUMNS, ...SEEDED_USE_CASES])
  })

  it('the empty template parses to zero rows and zero problems', () => {
    const parsed = parseStructureCsv(readTemplate('structure.csv'))
    expect(parsed.refusals).toEqual([])
    expect(parsed.rows).toEqual([])
    expect(parsed.useCaseColumns).toEqual(SEEDED_USE_CASES)
  })

  it('a header with no rows says so, instead of "the workspace already agrees"', () => {
    const plan = planCsv(readTemplate('structure.csv'), exampleWorkspace())
    const printed = renderPlan(plan, {})
    expect(printed).toContain('THE FILE HAS NO ROWS')
    expect(printed).not.toContain('NOTHING TO DO')
  })
})

/** A workspace shaped for the example file: one track, the kinds, 0024's ten. */
const exampleWorkspace = () => ({
  tracks: [{ id: 't-uhr', name: 'UHR', name_ar: 'السجل الصحي الموحد', archived: false }],
  nodes: [],
  kinds: KINDS,
  // The example names three placeholder people on purpose — inventing plausible
  // Saudi names risked landing on a real colleague. They are given accounts here
  // so the planner can be exercised end to end; nothing about that is live.
  members: [
    { id: 'p-s1', display_name: 'Sample Member', username: 'sample.username', email: 'sample.username@opstrack.internal' },
    { id: 'p-s2', display_name: 'Another Sample', username: 'another.sample', email: 'sample.member@example.com' },
  ],
  useCases: SEEDED_USE_CASES.map((name, i) => ({ id: `u-${i}`, name, sort_order: i + 1 })),
})

describe('THE ROUND TRIP, on the file that ships — plan, apply, re-plan, empty', () => {
  const EXAMPLE = readTemplate('structure.example.csv')

  it('plans the example onto an empty workspace with no refusals', () => {
    const first = planCsv(EXAMPLE, exampleWorkspace())
    expect(codes(first)).toEqual([])
    expect(pathsOf(first, 'create-node')).toEqual([
      'UHR > Onboarding',
      'UHR > Onboarding > Wave 1 Hospitals',
      'UHR > Onboarding > Wave 2 Clinics',
      'UHR > Onboarding > Wave 1 Hospitals > Al Faridah General Hospital',
      'UHR > Onboarding > Wave 1 Hospitals > Nakhil Specialist Hospital',
      'UHR > Onboarding > Wave 2 Clinics > Rawdah Family Clinic',
      'UHR > Onboarding > Wave 2 Clinics > Sadeem Medical Centre',
    ])
    // `Wave 2 Clinics` has no row of its own — the example says so in one of its
    // own description cells, and this is the assertion behind that sentence.
    expect(first.actions.filter((a) => a.kind === 'create-node' && a.implied).map((a) => a.name)).toEqual([
      'Wave 2 Clinics',
    ])
    // Parents strictly before children.
    const depths = first.actions.filter((a) => a.kind === 'create-node').map((a) => a.depth)
    expect(depths).toEqual([...depths].sort((a, b) => a - b))
  })

  it('THE SECOND PLAN IS EMPTY — the property that makes the file editable', () => {
    const before = exampleWorkspace()
    const first = planCsv(EXAMPLE, before)
    const after = applyToSnapshot(before, first.actions)

    const second = planCsv(EXAMPLE, after)
    expect(codes(second)).toEqual([])
    expect(second.actions).toEqual([])
    expect(renderPlan(second, {})).toContain('NOTHING TO DO')
  })

  it('carries the quoted comma, the doubled quote and the Arabic through intact', () => {
    const after = applyToSnapshot(exampleWorkspace(), planCsv(EXAMPLE, exampleWorkspace()).actions)
    const byName = (n) => after.nodes.find((x) => x.name === n)
    expect(byName('Al Faridah General Hospital').name_ar).toBe('مستشفى الفريدة العام')
    expect(byName('Nakhil Specialist Hospital').vendor).toBe('Mirqab Integration Co., Riyadh')
    expect(byName('Rawdah Family Clinic').description).toContain('"Wave 2 Clinics"')
  })

  it('sets exactly the use-case links the example spells out, and no blanks', () => {
    const first = planCsv(EXAMPLE, exampleWorkspace())
    const sets = first.actions.filter((a) => a.kind === 'set-use-case')
    expect(sets.every((a) => ['planned', 'testing', 'live'].includes(a.status))).toBe(true)
    expect(first.actions.some((a) => a.kind === 'clear-use-case')).toBe(false)
    expect(
      sets.filter((a) => a.path[a.path.length - 1] === 'Al Faridah General Hospital').length,
    ).toBe(9)
  })
})

// ── the demo file ───────────────────────────────────────────────────────────
//
// `structure.demo.csv` exists because the workspace holds ONE node, and every
// judgement asked of Aziz so far — the dive through the tiers, the vendor
// grouping, the use-case panel, whether the purple reads as the logo — was
// made against a nearly empty canvas. It is invented data that gets imported
// into the LIVE project, which is why the two properties that make it
// reversible are asserted here instead of assumed:
//
//   1. EVERY node it creates hangs under `UHR > Demo Portfolio`. That single
//      root is the entire reset story. 0023 constrains `map_nodes.source` to
//      ('local','jira') and there is no third value to mark a row as
//      demo-created, so the marker has to live in the SHAPE of the data — one
//      subtree, deleted whole, with nothing to unpick from `UHR > OB`.
//   2. The second plan is empty, so an interrupted apply is recovered by
//      re-running rather than by hand.
//
// The counts are the ones the live dry run printed on 2026-08-12: 22 nodes,
// 1 implied, 67 use-case links, 0 refusals. If a later edit to the file moves
// them, move them here — a demo file nobody re-measured is a demo file that
// quietly stopped covering a state.
//
// ⚠ AND THE REST OF THIS BLOCK IS NOT DECORATION EITHER. Half of what follows
// asserts things that are not about the planner at all: that no invented vendor
// can be read as a real Saudi company, that no tier mirrors the MOH cluster
// structure, that the row advertising the empty state IS empty, that the
// descriptions read as a PMO's copy rather than as notes to a reviewer. Those
// are the properties a code review caught and a passing planner never would —
// this file gets imported into the LIVE project and screenshotted inside a
// Nphies PMO, so "the plan is correct" was never the whole bar.

/** The live workspace as measured: UHR active, `UHR > OB` under it, two members. */
const demoWorkspace = () => ({
  tracks: [{ id: 't-uhr', name: 'UHR', name_ar: 'السجل الصحي الموحد', archived: false }],
  nodes: [
    {
      id: 'n-ob',
      parent_id: null,
      track_id: 't-uhr',
      kind_id: null,
      name: 'OB',
      name_ar: '',
      description: '',
      description_ar: '',
      account_manager_id: null,
      vendor: '',
      sort_order: 1,
      archived: false,
      map_node_use_cases: [],
    },
  ],
  kinds: KINDS,
  // The only two provisioned accounts. `Aziz` has no username and signs in by
  // email; the demo names these two and leaves most rows BLANK on purpose,
  // because unassigned is what the map looks like in week one.
  members: [
    { id: 'p-aziz', display_name: 'Aziz', username: null, email: 'az.alsaloom@gmail.com' },
    { id: 'p-nasser', display_name: 'Nasser Alabri', username: 'nasser', email: 'nasser@opstrack.internal' },
  ],
  useCases: SEEDED_USE_CASES.map((name, i) => ({ id: `u-${i}`, name, sort_order: i + 1 })),
})

describe('THE DEMO FILE, against the live workspace it is meant for', () => {
  const DEMO = readTemplate('structure.demo.csv')

  it('refuses nothing, and plans the counts the live dry run printed', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    expect(codes(plan)).toEqual([])
    expect(plan.summary.create).toBe(22)
    expect(plan.summary.createImplied).toBe(1)
    expect(plan.summary.setLinks).toBe(67)
    expect(plan.summary.clearLinks).toBe(0)
    expect(plan.summary.update).toBe(0)
    expect(plan.summary.newUseCases).toBe(0)
  })

  it('hangs every node under one deletable root — this IS the reset', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    const created = pathsOf(plan, 'create-node')
    expect(created[0]).toBe('UHR > Demo Portfolio')
    expect(
      created.every((p) => p === 'UHR > Demo Portfolio' || p.startsWith('UHR > Demo Portfolio > ')),
    ).toBe(true)
    // `UHR > OB` is the one real node. The demo sits BESIDE it, not under it,
    // and does not update it.
    expect(created.some((p) => p.startsWith('UHR > OB'))).toBe(false)
    expect(plan.actions.some((a) => a.kind === 'update-node')).toBe(false)
  })

  it('leaves exactly one intermediate implied, because nobody had seen that work', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    expect(
      plan.actions.filter((a) => a.kind === 'create-node' && a.implied).map((a) => a.name),
    ).toEqual(['Sarab Group'])
  })

  it('spreads four vendors unevenly, so the vendor filter has something to say', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    expect(plan.summary.vendors).toEqual([
      { name: 'Demo Vendor Alpha', count: 7 },
      { name: 'Demo Vendor Beta', count: 4 },
      { name: 'Demo Vendor Delta', count: 1 },
      { name: 'Demo Vendor Gamma', count: 2 },
    ])
  })

  // ⚠ EVERY INVENTED NAME MUST BE UNMISTAKABLY INVENTED. The first draft of this
  // file named its four vendors `Sahab Health Systems` and `Wathiq Integration`
  // — near-misses on stc's real SAHABA cloud and on Wathq, the Ministry of
  // Commerce's real company-verification platform — and they carried 11 of the
  // 14 vendor-bearing organizations, which is exactly what a vendor-grouped
  // screenshot is made of. A screenshot taken inside a Riyadh PMO reading
  // "Wathiq Integration — 7 organizations" is a real integrator with an
  // invented book of business. `Demo Vendor …` cannot be read as a company.
  it('names no vendor that could be mistaken for a real integrator', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    expect(plan.summary.vendors.every((v) => v.name.startsWith('Demo Vendor '))).toBe(true)
    // Two organizations with NO vendor: *not recorded* is a state the filter has
    // to draw, and it is the state most real rows will be in on day one.
    const orgs = plan.actions.filter((a) => a.kind === 'create-node' && a.values.kindName === 'Organization')
    expect(orgs.filter((a) => a.values.vendor === '').length).toBe(2)
  })

  // The same rule for the tree itself. The first draft named its four tier-2
  // nodes `Central/Western/Eastern/Northern Cluster` — the MOH health-cluster
  // structure — and filed a near-miss on a real Qatif hospital under the wrong
  // one, so the branch read as the real national programme AND read as wrong.
  // These are `Wave N`, which also matches the `Phase` kind they carry: the only
  // middle kind 0023 seeds is Programme/Phase/Organization, and a node labelled
  // "Cluster · Phase" invites a bug report about the kind vocabulary instead of
  // the decision (add a `Cluster` kind in Settings › Catalogue, or do not).
  it('names no tier that mirrors a real national programme, and matches its own kind', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    const phases = plan.actions.filter((a) => a.kind === 'create-node' && a.values.kindName === 'Phase')
    expect(phases.map((a) => a.name)).toEqual(['Wave 1', 'Wave 2', 'Wave 3', 'Wave 4'])
  })

  // ⚠ THE ROW THAT DEMONSTRATES EMPTY MUST BE EMPTY. The first draft put the
  // sentence "Nothing recorded at all: no vendor, no account manager, no
  // capability. This is the empty state" into the description of the row that
  // was supposed to BE the empty state — the longest organization-level
  // description in the file. So the one state 16 of 18 real organizations will
  // be in on day one was the one state the dataset never rendered. The
  // explanation lives in the README; this row carries nothing.
  it('ships one genuinely bare organization, so the empty panel can be judged', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    const bare = plan.actions.find((a) => a.kind === 'create-node' && a.name === 'Areej Day Surgery Unit')
    expect(bare.values.name_ar).toBe('')
    expect(bare.values.vendor).toBe('')
    expect(bare.values.description).toBe('')
    expect(bare.values.description_ar).toBe('')
    expect(bare.values.account_manager_id).toBe(null)
    expect(plan.actions.some((a) => a.kind === 'set-use-case' && a.path.includes('Areej Day Surgery Unit'))).toBe(false)
  })

  // Descriptions render in the Organization panel, so they have to be the kind
  // of copy a PMO writes — otherwise he cannot judge length, wrapping or the
  // Arabic/English pairing, and any screenshot that leaves the room shows the
  // build's own reasoning back at itself. The earlier file failed this on seven
  // rows ("The largest branch on purpose: the map encodes descendant count as
  // size…"). One long and one short survive, so wrapping is still exercised.
  it('describes organizations, not the dataset', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    const orgs = plan.actions.filter((a) => a.kind === 'create-node' && a.values.kindName === 'Organization')
    const meta = /\bon purpose\b|\bthe map\b|\bthis row\b|\bthe importer\b|\bempty state\b|\bfalls back\b/iu
    expect(orgs.filter((a) => meta.test(a.values.description)).map((a) => a.name)).toEqual([])
    const lengths = orgs.map((a) => a.values.description.length)
    expect(Math.max(...lengths)).toBeGreaterThan(200)
    expect(Math.min(...lengths)).toBe(0)
  })

  // A branch that reads EARLY, next to two that read DONE. Two thirds `live`
  // everywhere put every progress affordance — the "6 of 9 live" matrix, any
  // roll-up, any colour ramp — at the top of its range, so the interesting end
  // of the scale was never drawn.
  it('puts one whole branch at the early end of the scale', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    const sets = plan.actions.filter((a) => a.kind === 'set-use-case')
    const tally = (rows) => rows.reduce((m, a) => ({ ...m, [a.status]: (m[a.status] ?? 0) + 1 }), {})
    expect(tally(sets)).toEqual({ live: 33, testing: 16, planned: 18 })
    expect(tally(sets.filter((a) => a.path.includes('Wave 4')))).toEqual({ live: 1, testing: 3, planned: 9 })
  })

  it('puts BOTH ends of the use-case panel on screen: all ten live, and nothing at all', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    const byOrg = new Map()
    for (const a of plan.actions.filter((x) => x.kind === 'set-use-case')) {
      const org = a.path[a.path.length - 1]
      byOrg.set(org, [...(byOrg.get(org) ?? []), a.status])
    }
    const orgs = plan.actions
      .filter((a) => a.kind === 'create-node' && a.values.kindName === 'Organization')
      .map((a) => a.name)
    expect(orgs.length).toBe(16)
    expect(byOrg.get('Nawras General Hospital')).toEqual(Array(10).fill('live'))
    expect(byOrg.get('Marjan Coastal Hospital')).toEqual(Array(10).fill('live'))
    // Nothing recorded at all — the state the panel renders as an em-dash.
    expect(orgs.filter((o) => !byOrg.has(o)).length).toBe(3)
    // A single capability, which is the other end of the same axis.
    expect(orgs.filter((o) => (byOrg.get(o) ?? []).length === 1).length).toBe(2)
    expect(new Set([...byOrg.values()].flat())).toEqual(new Set(['planned', 'testing', 'live']))
  })

  it('names an Arabic name on most rows, and deliberately not on all of them', () => {
    const plan = planCsv(DEMO, demoWorkspace())
    const created = plan.actions.filter((a) => a.kind === 'create-node' && !a.implied)
    const withArabic = created.filter((a) => a.values.name_ar !== '')
    expect(withArabic.length).toBeGreaterThanOrEqual(created.length - 5)
    expect(withArabic.length).toBeLessThan(created.length)
  })

  it('THE SECOND PLAN IS EMPTY — an interrupted apply is fixed by re-running', () => {
    const before = demoWorkspace()
    const after = applyToSnapshot(before, planCsv(DEMO, before).actions)
    const second = planCsv(DEMO, after)
    expect(codes(second)).toEqual([])
    expect(second.actions).toEqual([])
  })
})

// ── the fixes this wave landed ──────────────────────────────────────────────

describe('a column of your own is named as such, not as nine bad statuses', () => {
  const CSV = [
    `${FIXED_COLUMNS.join(',')},ADT,Outstanding issue`,
    'UHR > A,,,,,,,live,Waiting on vendor',
    'UHR > B,,,,,,,live,Waiting on vendor',
  ].join('\n')

  it('refuses the COLUMN once and suppresses the per-row status noise', () => {
    const plan = planCsv(CSV)
    expect(codes(plan)).toEqual(['use_case_unknown'])
    expect(plan.refusals[0].message).toContain('no use case named `Outstanding issue`')
  })

  it('still refuses a genuinely mistyped status under a REAL capability', () => {
    const plan = planCsv(`${HEADER}\nUHR > A,,,,,,,in progress,,`)
    expect(codes(plan)).toEqual(['status_unknown'])
  })

  it('offers the nearest catalogue name before it offers --add-use-cases', () => {
    const plan = planCsv(
      [`${FIXED_COLUMNS.join(',')},Radiolegy Report`, 'UHR > A,,,,,,,live'].join('\n'),
      { ...emptyWorkspace(), useCases: [...USE_CASES, { id: 'u-rr', name: 'Radiology Report', sort_order: 7 }] },
    )
    const message = plan.refusals[0].message
    expect(message).toContain('Did you mean `Radiology Report`?')
    expect(message.indexOf('Did you mean')).toBeLessThan(message.indexOf('--add-use-cases'))
    expect(message).toContain('on delete restrict')
  })

  it('does not invent a suggestion for a column that is nothing like a capability', () => {
    expect(nearestName('Outstanding issue', SEEDED_USE_CASES)).toBe('')
    expect(nearestName('Radiolegy Report', SEEDED_USE_CASES)).toBe('Radiology Report')
  })
})

describe('two siblings cannot share an Arabic name — 0023 would raise mid-apply', () => {
  it('refuses two rows under one parent with the same name_ar', () => {
    const plan = planCsv(
      [
        HEADER,
        'UHR > OB > One,عيادة الروضة,Organization,,,,,,,',
        'UHR > OB > Two,عيادة الروضة,Organization,,,,,,,',
      ].join('\n'),
    )
    expect(codes(plan)).toEqual(['duplicate_sibling_name_ar'])
    expect(plan.refusals[0].message).toContain('map_nodes_sibling_name_ar_uidx')
  })

  it('refuses a row colliding with an Arabic name already in the app', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      { id: 'n-1', parent_id: null, track_id: 't-uhr', name: 'Existing', name_ar: 'مركز', map_node_use_cases: [] },
    ]
    const plan = planCsv(`${HEADER}\nUHR > Other,مركز,Organization,,,,,,,`, workspace)
    expect(codes(plan)).toEqual(['duplicate_sibling_name_ar'])
  })

  it('lets a node keep its OWN Arabic name on a re-run', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      { id: 'n-1', parent_id: null, track_id: 't-uhr', name: 'Existing', name_ar: 'مركز', map_node_use_cases: [] },
    ]
    expect(codes(planCsv(`${HEADER}\nUHR > Existing,مركز,,,,,,,,`, workspace))).toEqual([])
  })

  it('ignores blanks — the index is PARTIAL on btrim(name_ar) <> \'\'', () => {
    const plan = planCsv(
      [HEADER, 'UHR > OB > One,,Organization,,,,,,,', 'UHR > OB > Two,,Organization,,,,,,,'].join('\n'),
    )
    expect(codes(plan)).toEqual([])
  })
})

describe('NFC — a decomposed paste must not become a second organization', () => {
  it('matches an existing NFC name written in the file as NFD', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      {
        id: 'n-1',
        parent_id: null,
        track_id: 't-uhr',
        name: 'أحد'.normalize('NFC'),
        name_ar: '',
        map_node_use_cases: [],
      },
    ]
    const nfd = 'أحد'.normalize('NFD')
    expect(nfd).not.toBe('أحد'.normalize('NFC')) // the fixture is only useful if these differ
    const plan = planCsv(`${HEADER}\nUHR > ${nfd},,,,,,,,,`, workspace)
    expect(plan.actions).toEqual([])
    expect(plan.notes.filter((n) => n.kind === 'not_in_file')).toEqual([])
  })
})

describe('a repaired path says so, even when nothing is refused', () => {
  it('notes a zero-width space that joined two words', () => {
    const plan = planCsv(`${HEADER}\nUHR > Riyadh​Care,,,,,,,,,`)
    const repaired = plan.notes.filter((n) => n.kind === 'repaired_path')
    expect(repaired).toHaveLength(1)
    expect(repaired[0].message).toContain('zero-width space')
    expect(plan.actions[0].name).toBe('RiyadhCare')
  })

  it('says NOTHING on an ordinary path — a note on every row is a note nobody reads', () => {
    const plan = planCsv(`${HEADER}\nUHR > Onboarding > Riyadh Care,,,,,,,,,`)
    expect(plan.notes.filter((n) => n.kind === 'repaired_path')).toEqual([])
  })
})

describe('a move is a duplicate, and the plan says so before it happens', () => {
  it('names both paths when a node with that name exists under another parent', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      { id: 'n-ob', parent_id: null, track_id: 't-uhr', name: 'Onboarding', name_ar: '', map_node_use_cases: [] },
      { id: 'n-rc', parent_id: 'n-ob', track_id: 't-uhr', name: 'Riyadh Care', name_ar: '', map_node_use_cases: [] },
    ]
    const plan = planCsv(`${HEADER}\nUHR > Ops > Riyadh Care,,,,,,,live,,`, workspace)
    const move = plan.notes.find((n) => n.kind === 'looks_like_a_move')
    expect(move).toBeTruthy()
    expect(move.message).toContain('Onboarding')
    expect(move.message).toContain('TWO of them')
  })
})

describe('the vendors are rolled up, because the filter groups on the exact string', () => {
  const CSV = [
    HEADER,
    'UHR > A,,,,Mirqab Integration Co.,,,,,',
    'UHR > B,,,,"Mirqab Integration Co., Riyadh",,,,,',
    'UHR > C,,,,Mirqab Integration Co.,,,,,',
  ].join('\n')

  it('counts each distinct spelling and prints them together', () => {
    const plan = planCsv(CSV)
    expect(plan.summary.vendors).toEqual([
      { name: 'Mirqab Integration Co.', count: 2 },
      { name: 'Mirqab Integration Co., Riyadh', count: 1 },
    ])
    expect(renderPlan(plan, {})).toContain('VENDORS IN THIS FILE (2)')
  })

  it('warns when two spellings differ only by a trailing qualifier', () => {
    const plan = planCsv(CSV)
    expect(plan.notes.some((n) => n.kind === 'vendor_near_duplicate')).toBe(true)
  })
})

describe('the printout cannot be moved by a value inside it', () => {
  it('folds Excel CRLF inside a quoted description, so the update is not invisible', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      {
        id: 'n-1',
        parent_id: null,
        track_id: 't-uhr',
        name: 'A',
        name_ar: '',
        description: 'line one\nline two',
        map_node_use_cases: [],
      },
    ]
    const plan = planCsv(`${HEADER}\nUHR > A,,,,,"line one\r\nline two",,,,`, workspace)
    // Identical after folding, so there is NO update at all — the old behaviour
    // emitted one whose two sides printed the same and PATCHed a \r into the row.
    expect(plan.actions).toEqual([])
  })

  it('never emits a carriage return into the plan', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      { id: 'n-1', parent_id: null, track_id: 't-uhr', name: 'A', name_ar: '', description: 'old', map_node_use_cases: [] },
    ]
    const plan = planCsv(`${HEADER}\nUHR > A,,,,,"new\r\nsecond line",,,,`, workspace)
    expect(renderPlan(plan, {}).includes('\r')).toBe(false)
  })
})

describe('the plan shows the position the map will draw in', () => {
  it('prints [position N] beside each new node, taken from FILE order', () => {
    const printed = renderPlan(
      planCsv([HEADER, 'UHR > Zulu,,,,,,,,,', 'UHR > Alpha,,,,,,,,,'].join('\n')),
      {},
    )
    // Alphabetical in the printout, file order in the position — which is the
    // whole reason the number has to be there.
    expect(printed.indexOf('Alpha')).toBeLessThan(printed.indexOf('Zulu'))
    expect(printed).toMatch(/Alpha.*\[position 2\]/u)
    expect(printed).toMatch(/Zulu.*\[position 1\]/u)
  })
})

describe('the kind refusal points at the screen that can fix it', () => {
  it('says Settings › Catalogue, which is where kinds live', () => {
    const plan = planCsv(`${HEADER}\nUHR > A,,Organisation,,,,,,,`)
    expect(codes(plan)).toEqual(['kind_unknown'])
    expect(plan.refusals[0].message).toContain('Settings › Catalogue')
    expect(plan.refusals[0].message).not.toContain('Settings › Structure')
    expect(plan.refusals[0].message).toContain('Did you mean `Organization`?')
  })
})

// ── ordering helper ─────────────────────────────────────────────────────────

describe('comparePaths sorts segment by segment', () => {
  it('keeps a subtree together rather than sorting on the joined string', () => {
    const paths = [['UHR', 'AB'], ['UHR', 'A'], ['UHR', 'A', 'B']]
    expect(paths.sort(comparePaths)).toEqual([['UHR', 'A'], ['UHR', 'A', 'B'], ['UHR', 'AB']])
  })
})
