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

// The slice generator, IMPORTED RATHER THAN SHELLED OUT TO, so the bytes it
// would write can be compared against the bytes it wrote. Importing it runs
// nothing: `main()` is guarded behind an `import.meta.url` check there.
import { build as buildSlice, verify as verifySlice, render as renderSlice } from '../make-demo-slice.mjs'

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
  USE_CASE_STATUSES,
  MAX_NODE_DEPTH,
  MAX_NAME_LENGTH,
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

/**
 * 0026's seven seeded rungs, verbatim and in its order.
 *
 * ⚠ A FIXTURE, NEVER A CONSTANT THE PLANNER READS. The whole point of the stage
 * column is that the ladder comes out of the DATABASE — every one of these is
 * renameable in Settings › Catalogue, and a `STAGE_NAMES` list inside
 * structurePlan.mjs would refuse `Integration` as unknown the day Aziz renamed
 * `Integrating`. So this list lives here, in the test, standing in for what a
 * live read returns, and `structurePlan.mjs` contains no stage name at all.
 * (That absence is asserted below — see "no stage name is written down".)
 */
const STAGES = [
  { id: 's-not-started', name: 'Not started', name_ar: '', sort_order: 1, hidden: false },
  { id: 's-kickoff', name: 'Kickoff', name_ar: '', sort_order: 2, hidden: false },
  { id: 's-integrating', name: 'Integrating', name_ar: 'قيد التكامل', sort_order: 3, hidden: false },
  { id: 's-testing', name: 'Testing/UAT', name_ar: '', sort_order: 4, hidden: false },
  { id: 's-ready', name: 'Go-live ready', name_ar: '', sort_order: 5, hidden: false },
  { id: 's-live', name: 'Live', name_ar: '', sort_order: 6, hidden: false },
  { id: 's-paused', name: 'Paused', name_ar: '', sort_order: 7, hidden: false },
]

/**
 * THE LADDER AS THE OWNER RENAMED IT, 22 August 2026. `STAGES` above is the
 * shipped vocabulary and stays that way because most of this file writes those
 * words into CSV literals of its own. This one exists for the two blocks that
 * plan a COMMITTED TEMPLATE against the workspace it is actually meant for —
 * and the day those two drifted apart, every row of the slice was refused by
 * name (`stage_unknown`) on a real import. That is the failure this pins.
 */
const LIVE_STAGES = STAGES.map((s) =>
  s.id === 's-integrating' ? { ...s, name: 'Integrating & Testing' }
  : s.id === 's-testing' ? { ...s, name: 'UAT' }
  : s.id === 's-ready' ? { ...s, name: 'Go-live readiness' }
  : s,
)

const HEADER = `${FIXED_COLUMNS.join(',')},ADT,Lab Order,Lab Results`

/** A workspace with nothing under any track — Aziz's, today. */
const emptyWorkspace = () => ({
  tracks: TRACKS,
  nodes: [],
  kinds: KINDS,
  members: MEMBERS,
  useCases: USE_CASES,
  // 0026 and 0027 applied, the ladder seeded, nobody placed on it yet and
  // nothing promised. `schema` is left at its default — both true — because
  // that is the state of the live project once he has run the two migrations.
  stages: STAGES,
  progress: [],
  goals: [],
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,,,,live,,`,
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
      `${HEADER}\nUHR > OB > Ministry of Health, Riyadh,,Organization,,,,,,,,live,,`,
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
      `${HEADER}\nUHR > Onboarding > Org A,,Organization,,Mirqab Integration Co., Riyadh,,,,,live`,
    )
    expect(refusals.map((r) => r.code)).toEqual(['row_too_narrow'])
  })

  it('says "stray trailing comma" when the extra field is empty, and not otherwise', () => {
    const trailing = parseStructureCsv(`${HEADER}\nUHR > A,,,,,,,,,,,,,`)
    expect(trailing.refusals.map((r) => r.code)).toEqual(['row_too_wide'])
    expect(trailing.refusals[0].message).toContain('stray extra comma')

    const shifted = parseStructureCsv(`${HEADER}\nUHR > A,,,,Acme, Riyadh,,,,,,,,live`)
    expect(shifted.refusals.map((r) => r.code)).toEqual(['row_too_wide'])
    expect(shifted.refusals[0].message).toContain('has to be quoted')
  })

  it('ignores blank lines, which Excel leaves at the end of a file', () => {
    const { rows, refusals } = parseStructureCsv(`${HEADER}\r\nUHR > A,,,,,,,,,,,,\r\n\r\n,,,,,,,,,,,,\r\n`)
    expect(refusals).toEqual([])
    expect(rows).toHaveLength(1)
  })
})

describe('parseStructureCsv — the cell rules', () => {
  it('refuses a status that is not one of the three, and says blank is not a fourth', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR > A,,,,,,,,,,done,,`)
    expect(refusals.map((r) => r.code)).toEqual(['status_unknown'])
    expect(refusals[0].message).toMatch(/planned, testing, live/u)
    expect(refusals[0].message).toMatch(/not a fourth status/u)
  })

  it('accepts the three statuses in any case, and treats blank as null', () => {
    const { rows, refusals } = parseStructureCsv(`${HEADER}\nUHR > A,,,,,,,,,,LIVE, Testing ,`)
    expect(refusals).toEqual([])
    const byColumn = Object.fromEntries(rows[0].cells.map((c) => [c.column, c.status]))
    expect(byColumn).toEqual({ ADT: 'live', 'Lab Order': 'testing', 'Lab Results': null })
  })

  it('refuses a path deeper than the database will accept, naming the path', () => {
    const deep = ['UHR', ...Array.from({ length: MAX_NODE_DEPTH + 1 }, (_, i) => `L${i}`)].join(' > ')
    const { refusals } = parseStructureCsv(`${HEADER}\n${deep},,,,,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['path_too_deep'])
    expect(refusals[0].message).toContain(String(MAX_NODE_DEPTH))
  })

  it('accepts a path exactly at the cap', () => {
    const atCap = ['UHR', ...Array.from({ length: MAX_NODE_DEPTH }, (_, i) => `L${i}`)].join(' > ')
    const { refusals, rows } = parseStructureCsv(`${HEADER}\n${atCap},,,,,,,,,,,,`)
    expect(refusals).toEqual([])
    expect(rows).toHaveLength(1)
  })

  it('refuses a name past 60 characters — map_nodes_name_len_chk', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR > ${'x'.repeat(61)},,,,,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['name_too_long'])
  })

  it('refuses a track-only path', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR,,,,,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['path_track_only'])
  })

  it('refuses an empty segment in the middle of a path', () => {
    const { refusals } = parseStructureCsv(`${HEADER}\nUHR >  > Riyadh Care,,,,,,,,,,,,`)
    expect(refusals.map((r) => r.code)).toEqual(['path_segment_empty'])
  })

  it('drops a trailing separator rather than refusing it', () => {
    const { rows, refusals } = parseStructureCsv(`${HEADER}\nUHR > Onboarding > ,,,,,,,,,,,,`)
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
    const result = planCsv(`${HEADER}\nUHR > Onboarding,,Phase,,,,,,,,,,`)
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
    const result = planCsv(`${HEADER}\nNope > A,,,,,,,,,,,,`)
    expect(result.refusals[0].code).toBe('track_missing')
    expect(result.refusals[0].message).not.toContain('space')
  })

  it('a track that genuinely does not exist is refused with the note attached', () => {
    // The refusal has to distinguish "you typed a track that does not exist"
    // from "you typed a track that exists and has a stray character in it".
    const result = planCsv(`${HEADER}\nUH​Z > Onboarding,,,,,,,,,,,,`)
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
    const result = planCsv(`${HEADER}\nUHR > A,,,,2024-01-02,,,,,,,,`)
    expect(codes(result)).toEqual([])
    expect(result.notes.some((n) => n.kind === 'date_shaped')).toBe(true)
    expect(pathsOf(result, 'create-node')).toEqual(['UHR > A'])
  })
})

// ── resolution ──────────────────────────────────────────────────────────────

describe('the account manager is never guessed', () => {
  it('matches a username first and says so', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,sara.alsaab,,,,,,,,,`)
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
    const result = planCsv(`${HEADER}\nUHR > A,,,Ahmed Alnaji,,,,,,,,,`)
    expect(codes(result)).toEqual(['member_ambiguous'])
    expect(result.refusals[0].message).toContain('ahmed.alnaji')
    expect(result.refusals[0].message).toContain('ahmed.alkanhal')
    expect(result.actions).toEqual([])
  })

  it('refuses a name that matches nobody', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,someone.else,,,,,,,,,`)
    expect(codes(result)).toEqual(['member_unknown'])
  })

  it('leaves a blank account manager unassigned rather than refusing', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,,,,,,,,,,`)
    expect(codes(result)).toEqual([])
    expect(result.actions[0].values.account_manager_id).toBeNull()
  })
})

describe('tracks, kinds and capabilities', () => {
  it('refuses a missing track and says this script does not create one', () => {
    const result = planCsv(`${HEADER}\nAyenati > A,,,,,,,,,,,,`)
    expect(codes(result)).toEqual(['track_missing'])
    expect(result.refusals[0].message).toMatch(/does NOT create tracks/u)
    expect(result.refusals[0].message).toContain('UHR')
  })

  it('refuses an archived track', () => {
    const result = planCsv(`${HEADER}\nClarification > A,,,,,,,,,,,,`)
    expect(codes(result)).toEqual(['track_archived'])
  })

  it('matches a track by its Arabic name and says which name matched', () => {
    const result = planCsv(`${HEADER}\nالسجل الصحي الموحد > A,,,,,,,,,,,,`)
    expect(codes(result)).toEqual([])
    expect(result.notes.some((n) => n.kind === 'track_matched_ar')).toBe(true)
  })

  it('refuses an unknown kind and lists the ones that exist', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,Hospital,,,,,,,,,,`)
    expect(codes(result)).toEqual(['kind_unknown'])
    expect(result.refusals[0].message).toContain('Programme, Phase, Organization')
  })

  it('refuses an unknown use-case column and lists the catalogue', () => {
    const result = planCsv(
      `${FIXED_COLUMNS.join(',')},ADT,Radiolegy Report\nUHR > A,,,,,,,,,,live,live`,
    )
    expect(codes(result)).toContain('use_case_unknown')
    expect(result.refusals[0].message).toContain('Lab Results')
    expect(result.refusals[0].message).toContain('--add-use-cases')
  })

  it('--add-use-cases turns that refusal into a create, and prints what it would add', () => {
    const result = planCsv(
      `${FIXED_COLUMNS.join(',')},ADT,Prior Authorisation\nUHR > A,,,,,,,,,,live,planned`,
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
    const result = planCsv(`${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,,,,live,,`)
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,,,,live,,\nUHR > Onboarding > Jeddah Clinic,,Organization,,,,,,,,,planned,`,
    )
    const everyLevel = planCsv(
      `${HEADER}\nUHR > Onboarding,,Phase,,,,,,,,,,\nUHR > Onboarding > Riyadh Care,,Organization,,,,,,,,live,,\nUHR > Onboarding > Jeddah Clinic,,Organization,,,,,,,,,planned,`,
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,,,,,,,,,,\nUHR > Onboarding,مرحلة,Phase,,,,,,,,,,`,
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
      `${HEADER}\nUHR > A > B > C,,,,,,,,,,,,\nUHR > A,,Programme,,,,,,,,,,\nUHR > A > B,,Phase,,,,,,,,,,`,
    )
    const depths = result.actions.filter((a) => a.kind === 'create-node').map((a) => a.depth)
    expect(depths).toEqual([...depths].sort((x, y) => x - y))
    expect(pathsOf(result, 'create-node')).toEqual(['UHR > A', 'UHR > A > B', 'UHR > A > B > C'])
  })

  it('refuses two rows for one node rather than letting file order decide', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,Phase,,,,,,,,,,\nuhr > a,,Programme,,,,,,,,,,`)
    expect(codes(result)).toEqual(['duplicate_path'])
  })

  it('gives siblings sort orders in FILE order, so the map reads as he typed it', () => {
    // Not alphabetical: he typed Zulfi first because Zulfi came first, and a
    // map that silently re-alphabetises his list is a map he has to re-read.
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Zulfi,,,,,,,,,,,,\nUHR > Onboarding > Abha,,,,,,,,,,,,`,
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,,testing,,`,
      populated(),
    )
    expect(codes(result)).toEqual([])
    expect(result.actions).toEqual([])
    expect(renderPlan(result, {})).toContain('NOTHING TO DO')
  })

  it('emits one change per differing field, with old -> new', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,مركز الرياض,Organization,nada.alsuwaida,Beta,,,,,,testing,,`,
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,,,,,,,testing,,`,
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,,testing,,`,
      populated(),
    )
    expect(result.actions.filter((a) => a.path.join(' > ') === 'UHR > Onboarding')).toEqual([])
  })

  it('matches an existing node case-insensitively, the way the index does', () => {
    // map_nodes_sibling_name_uidx is lower(btrim(name)). Matching any other way
    // would emit a create the database then refuses as a duplicate.
    const result = planCsv(
      `${HEADER}\n uhr  >  ONBOARDING  >  riyadh care ,,Organization,sara.alsaab,Acme,,,,,,testing,,`,
      populated(),
    )
    expect(kinds(result)).toEqual([])
  })
})

// ── the use-case matrix ─────────────────────────────────────────────────────

describe('the use-case matrix', () => {
  it('sets a link that is not there, and changes one that says something else', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,,live,planned,`,
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,,,,`,
      populated(),
    )
    const clears = result.actions.filter((a) => a.kind === 'clear-use-case')
    expect(clears).toHaveLength(1)
    expect(clears[0]).toMatchObject({ useCase: 'ADT', useCaseId: 'u-adt', from: 'testing' })
    expect(renderPlan(result, {})).toContain('the link is deleted')
  })

  it('a blank cell where there is no link is a no-op, not a delete', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,,testing,,`,
      populated(),
    )
    expect(result.actions.filter((a) => a.kind === 'clear-use-case')).toEqual([])
  })

  it('never emits a status that is not one of the three', () => {
    const result = planCsv(
      `${HEADER}\nUHR > A,,,,,,,,,,live,testing,planned`,
    )
    const statuses = result.actions.filter((a) => a.kind === 'set-use-case').map((a) => a.status)
    expect(statuses.sort()).toEqual(['live', 'planned', 'testing'])
  })

  it('links are ordered after every node create', () => {
    const result = planCsv(`${HEADER}\nUHR > A > B,,,,,,,,,,live,,`)
    const order = kinds(result)
    expect(order.lastIndexOf('create-node')).toBeLessThan(order.indexOf('set-use-case'))
  })
})

// ── deletion by omission ────────────────────────────────────────────────────

describe('the file is not authoritative for deletion', () => {
  it('reports a node that is in the app and not in the file, and plans nothing for it', () => {
    const result = planCsv(`${HEADER}\nUHR > Onboarding,,Phase,,,,,,,,,,`, populated())
    const missing = result.notes.filter((n) => n.kind === 'not_in_file')
    expect(missing).toHaveLength(1)
    expect(missing[0].path).toEqual(['UHR', 'Onboarding', 'Riyadh Care'])
    expect(result.actions.some((a) => a.path.includes('Riyadh Care'))).toBe(false)
  })

  it('says so in the PRINTOUT, not only in a comment', () => {
    const printed = renderPlan(planCsv(`${HEADER}\nUHR > Onboarding,,Phase,,,,,,,,,,`, populated()), {})
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
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,,testing,,`,
      workspace,
    )
    expect(result.notes.filter((n) => n.kind === 'not_in_file')).toEqual([])
  })
})

// ── the printout ────────────────────────────────────────────────────────────

describe('the printout is the product', () => {
  it('isolates a mixed Arabic/Latin path so a terminal cannot reorder it', () => {
    const result = planCsv(`${HEADER}\nUHR > مستشفى الملك > Clinic,,,,,,,,,,,,`)
    const printed = renderPlan(result, { file: 'docs/templates/structure.csv' })
    expect(printed).toContain(`${FSI}مستشفى الملك${PDI}`)
    // The whole-path form used in refusals and notes wraps in LRI…PDI, because
    // `A > B > C` is left-to-right whatever the names are.
    const refused = planCsv(
      `${HEADER}\nUHR > مستشفى > A > B > C > D > E > F,,,,,,,,,,,,`,
    )
    expect(refused.refusals[0].code).toBe('path_too_deep')
    expect(refused.refusals[0].message).toContain(LRI)
    expect(refused.refusals[0].message).toContain(`${FSI}مستشفى${PDI}`)
  })

  it('says all-or-nothing whenever there is a refusal', () => {
    const printed = renderPlan(planCsv(`${HEADER}\nNope > A,,,,,,,,,,,,`), {})
    expect(printed).toContain('REFUSALS')
    expect(printed).toMatch(/--apply DOES NOTHING AT ALL/u)
  })

  it('ends with the one-line reconciliation', () => {
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,nada.alsuwaida,Acme,,,,,,live,,`,
      populated(),
    )
    expect(renderPlan(result, {})).toMatch(
      /Summary: \d+ node\(s\) to create \(\d+ implied\) · \d+ to update · \d+ use-case link\(s\) to set · \d+ to clear/u,
    )
  })

  it('marks a dry run and an apply run differently, in the first three lines', () => {
    const result = planCsv(`${HEADER}\nUHR > A,,,,,,,,,,,,`)
    expect(renderPlan(result, { apply: false })).toContain('dry run — nothing will be written')
    expect(renderPlan(result, { apply: true })).toContain('*** --apply: THIS RUN WRITES ***')
  })

  it('shows an implied node as implied, so nobody wonders where it came from', () => {
    const printed = renderPlan(planCsv(`${HEADER}\nUHR > Onboarding > Riyadh Care,,,,,,,,,,,,`), {})
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
    // The two side tables 0026 and 0027 add. Kept as their own arrays here for
    // the same reason they are their own tables there: a stage is not a column
    // of `map_nodes`, and a round trip that folded it into one would prove the
    // planner agrees with a shape the database does not have.
    progress: (workspace.progress ?? []).map((p) => ({ ...p })),
    goals: (workspace.goals ?? []).map((g) => ({ ...g })),
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
    if (action.kind === 'set-stage') {
      // UPSERT ON node_id — `map_node_progress`'s primary key. `stage_changed_at`
      // is not modelled here at all, because the client never writes it: 0026's
      // stamp trigger is its only writer.
      const row = next.progress.find((p) => p.node_id === node.id)
      if (row) row.stage_id = action.stageId
      else next.progress.push({ node_id: node.id, stage_id: action.stageId })
      continue
    }
    if (action.kind === 'create-goal') {
      next.goals.push({
        id: `new-goal-${(seq += 1)}`,
        node_id: node.id,
        // The importer's own shape, and the reason a second run finds this row
        // instead of writing another beside it.
        label: '',
        stage_id: null,
        target: action.target,
        target_date: action.targetDate,
      })
      continue
    }
    if (action.kind === 'update-goal') {
      const goal = next.goals.find((g) => g.id === action.goalId)
      if (!goal) throw new Error(`applyToSnapshot: no goal ${action.goalId}`)
      goal.target = action.target
      goal.target_date = action.targetDate
      continue
    }
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
    'UHR > Onboarding,التسجيل,Phase,,,The onboarding programme,,,,,,,',
    'UHR > Onboarding > Riyadh Care,مركز الرياض,Organization,sara.alsaab,Acme Integrations,,,,,,live,planned,',
    // The WHOLE cell is quoted, which is what Excel writes for a value with a
    // comma in it — not a quoted fragment in the middle of an unquoted field.
    '"UHR > Onboarding > Ministry of Health, Riyadh",,Organization,@nada.alsuwaida,,,,,,,testing,,live',
    'UHR > Onboarding > Jeddah Clinic > North Wing,,Organization,,Beta Systems,,,,,,,,',
    'Network > Core,,Programme,,,,,,,,,,',
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

/**
 * Every template on disk, BY NAME.
 *
 * ⚠ A NEW TEMPLATE THAT IS NOT ON THIS LIST SHIPS UNCHECKED. The two tests below
 * iterate it rather than a directory listing — a listing would quietly start
 * asserting things about a file somebody dropped in the folder — so adding a
 * generator (`make-demo-slice.mjs` was the fourth) means adding its output here
 * in the same commit. The header identity is the property that matters: all four
 * are written against ONE header read out of `structure.csv`, and a template
 * that drifted from it would import every use-case status into the wrong column.
 */
const TEMPLATE_FILES = [
  'structure.csv',
  'structure.example.csv',
  'structure.demo.csv',
  'structure.slice.csv',
]

describe('the shipped templates', () => {
  it('every file begins with a UTF-8 BOM — without it Excel destroys the Arabic', () => {
    for (const name of TEMPLATE_FILES) {
      const bytes = readFileSync(new URL(name, TEMPLATE_DIR))
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    }
  })

  it('every file carries the SAME header, and it matches 0024 exactly and in order', () => {
    const headerOf = (name) => parseCsv(readTemplate(name))[0].cells
    for (const name of TEMPLATE_FILES.slice(1)) {
      expect(headerOf(name)).toEqual(headerOf('structure.csv'))
    }
    expect(headerOf('structure.csv')).toEqual([...FIXED_COLUMNS, ...SEEDED_USE_CASES])
  })

  // ⚠ A TEMPLATE NOBODY DOCUMENTED IS A TEMPLATE NOBODY CAN RUN. The slice
  // shipped in `docs/templates/` referenced by nothing an owner reads — not the
  // file table, not the playbook — while carrying a precondition (0026 + 0027
  // applied, or the import is refused by name) that no other template has. The
  // failure that produces is concrete: run it against today's live project, get
  // `stage_tables_missing`, and have no page saying the sitting comes first. So
  // the table on the page beside the files has to name every one of them.
  it('the README names every template that ships beside it', () => {
    const readme = readFileSync(new URL('README.md', TEMPLATE_DIR), 'utf8')
    for (const name of TEMPLATE_FILES) expect(readme).toContain(`](${name})`)
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

  // ⚠ THE PROSE IS PINNED TO THE CONSTANT, because this is the drift that
  // already happened once: `FIXED_COLUMNS` grew from seven to ten and the
  // README went on telling him "the first seven columns are fixed" — the same
  // failure mode as a hand-typed depth cap. A count typed into a sentence is a
  // second source of truth, and the file a Director reads is the one that has
  // to be right. Appending an eleventh fixed column fails HERE, next to the
  // constant, rather than in a PMO's inbox.
  it('the README documents every fixed column, in the order the parser wants them', () => {
    const readme = readFileSync(new URL('README.md', TEMPLATE_DIR), 'utf8')
    // Prose wraps and the constant does not, so the comparison is made on
    // whitespace-normalised text rather than forcing a 100-character line.
    const flowed = readme.replace(/\s+/gu, ' ')
    // The ordered list, exactly as the header refusal prints it.
    expect(flowed).toContain(FIXED_COLUMNS.join(', '))
    // And each one has a row of its own in THE COLUMN TABLE — scoped to that
    // section, because `| \`target\` |` also occurs in the goal-shape table
    // further down, and an unscoped search let a deleted row pass.
    const columnSection = readme.slice(readme.indexOf('\n## The columns'))
    const table = columnSection.slice(0, columnSection.indexOf('\n## ', 1))
    expect(table).not.toBe('')
    for (const column of FIXED_COLUMNS) {
      expect(table).toContain(`| \`${column}\` |`)
    }
    // No stale count. "the first seven columns" was true for two waves and is
    // now a lie about the file that ships beside it.
    expect(readme).not.toMatch(/first seven columns/iu)
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
  stages: STAGES,
  progress: [],
  goals: [],
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
// ⚠ THE FILE IS GENERATED NOW, AND THAT CHANGES WHAT THIS BLOCK MAY ASSERT.
// It is four hundred organizations written by `scripts/make-demo-400.mjs` from
// one seed, and it is regenerated whenever its shape is retuned. The old block
// pinned the sixteen-row file's exact counts — 22 nodes, 67 links — and a
// pinned count in a generated file is a test that fails on every retune while
// proving nothing about the retuned file. So the counts here are DERIVED FROM
// THE FILE ITSELF and compared against the plan: the file says 812 use-case
// cells, the plan must contain 812 `set-use-case` actions. That catches the
// failure that matters (the planner and the file disagreeing) and survives the
// next regeneration, which a hardcoded 67 does not.
//
// WHAT IS STILL PINNED, because it is a decision rather than a measurement:
// zero refusals, exactly one implied node, one deletable root, every status
// legal, six vendors all named `Demo Vendor …`, a ladder that reaches all seven
// rungs with a visible pile-up and a large blank bucket, both ends of the
// use-case panel on screen, and an empty second plan.
//
// ⚠ AND THE REST OF THIS BLOCK IS NOT DECORATION EITHER. Half of what follows
// asserts things that are not about the planner at all: that no invented vendor
// can be read as a real Saudi company, that no tier mirrors the MOH cluster
// structure, that some organizations are entirely empty, that the descriptions
// read as a PMO's copy rather than as notes to a reviewer. Those are the
// properties a code review caught and a passing planner never would — this file
// gets imported into the LIVE project and screenshotted inside a Nphies PMO, so
// "the plan is correct" was never the whole bar.

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
  // The eighteen provisioned accounts, as of the roster going live. The owner
  // signs in by email and has no username; everyone else was minted with one.
  // The demo names exactly TWO of them and leaves three of its five account
  // books BLANK on purpose, because unassigned is what the map looks like in
  // week one — and because naming a third would refuse every row carrying it
  // until that person existed. When the roster was provisioned the two names
  // the file used stopped resolving, and every row was refused by name; that is
  // the failure this fixture now pins, from the other side.
  members: [
    { id: 'p-aziz', display_name: 'Abdulaziz Alsaloom', username: null, email: 'az.alsaloom@gmail.com' },
    { id: 'p-nasser', display_name: 'Nasser Alabri', username: 'nasser', email: 'nasser@opstrack.internal' },
  ],
  useCases: SEEDED_USE_CASES.map((name, i) => ({ id: `u-${i}`, name, sort_order: i + 1 })),
  stages: LIVE_STAGES,
  progress: [],
  goals: [],
})

describe('THE DEMO FILE, against the live workspace it is meant for', () => {
  const DEMO = readTemplate('structure.demo.csv')

  // The file, read as a table, so every expectation below is stated against
  // what is actually on disk rather than against a number somebody remembered.
  const RECORDS = parseCsv(DEMO)
  const HEAD = RECORDS[0].cells
  const FILE_ROWS = RECORDS.slice(1).map((r) => {
    const cell = (name) => r.cells[HEAD.indexOf(name)] ?? ''
    return {
      path: cell('path').split('>').map((s) => s.trim()),
      kind: cell('kind'),
      vendor: cell('vendor'),
      accountManager: cell('account_manager'),
      nameAr: cell('name_ar'),
      stage: cell('stage'),
      targetDate: cell('target_date'),
      target: cell('target'),
      statuses: SEEDED_USE_CASES.map((name) => cell(name)).filter((v) => v !== ''),
    }
  })
  const FILE_ORGS = FILE_ROWS.filter((r) => r.kind === 'Organization')

  const plan = planCsv(DEMO, demoWorkspace())
  const count = (kind) => plan.actions.filter((a) => a.kind === kind).length

  it('refuses nothing, and plans exactly what the file holds', () => {
    expect(codes(plan)).toEqual([])
    expect(plan.summary.rows).toBe(FILE_ROWS.length)
    // One create per row, plus the implied tiers the file does not spell out.
    expect(plan.summary.create).toBe(FILE_ROWS.length + plan.summary.createImplied)
    expect(count('set-use-case')).toBe(FILE_ROWS.reduce((n, r) => n + r.statuses.length, 0))
    expect(count('set-stage')).toBe(FILE_ROWS.filter((r) => r.stage !== '').length)
    expect(count('create-goal')).toBe(FILE_ROWS.filter((r) => r.targetDate !== '').length)
    // Nothing in the live workspace is touched, and no capability is invented.
    expect(plan.summary.update).toBe(0)
    expect(plan.summary.clearLinks).toBe(0)
    expect(plan.summary.newUseCases).toBe(0)
    expect(plan.summary.movedGoals).toBe(0)
  })

  it('is big enough to be the thing it is for — four hundred organizations', () => {
    expect(FILE_ORGS.length).toBeGreaterThanOrEqual(380)
    expect(FILE_ORGS.length).toBeLessThanOrEqual(430)
  })

  it('writes no use-case cell that is not one of the three legal statuses', () => {
    const seen = new Set(FILE_ROWS.flatMap((r) => r.statuses))
    expect([...seen].sort()).toEqual([...USE_CASE_STATUSES].sort())
  })

  it('stays inside 0023 — the depth cap and both name-length checks', () => {
    for (const row of FILE_ROWS) {
      expect(row.path.length - 1).toBeLessThanOrEqual(MAX_NODE_DEPTH)
      for (const segment of row.path) expect(segment.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
      expect(row.nameAr.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
    }
  })

  it('hangs every node under one deletable root — this IS the reset', () => {
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

  it('leaves exactly one intermediate implied, so that half of the planner is exercised', () => {
    // Listing every level and listing only the leaves must produce the same
    // tree. A file that spells out all 438 ancestors never proves it.
    const implied = plan.actions.filter((a) => a.kind === 'create-node' && a.implied)
    expect(implied.length).toBe(1)
    expect(FILE_ROWS.some((r) => r.path.join(' > ') === implied[0].path.join(' > '))).toBe(false)
  })

  it('spreads six vendors unevenly, with a cohort big enough to be worth filtering to', () => {
    const vendors = plan.summary.vendors
    expect(vendors.length).toBe(6)
    // Counted off the file, not off a constant: the plan must agree with it.
    for (const { name, count: n } of vendors) {
      expect(n).toBe(FILE_ORGS.filter((o) => o.vendor === name).length)
    }
    const sizes = vendors.map((v) => v.count).sort((a, b) => b - a)
    // ONE cohort carrying a quarter of the portfolio, and a long tail under it.
    // Six vendors of sixty each is a legend, not a story.
    expect(sizes[0]).toBeGreaterThanOrEqual(100)
    expect(sizes[0]).toBeGreaterThan(sizes[1] * 1.3)
    expect(sizes[sizes.length - 1]).toBeLessThan(40)
  })

  // ⚠ EVERY INVENTED NAME MUST BE UNMISTAKABLY INVENTED. The first draft of this
  // file named its four vendors `Sahab Health Systems` and `Wathiq Integration`
  // — near-misses on stc's real SAHABA cloud and on Wathq, the Ministry of
  // Commerce's real company-verification platform — and they carried 11 of the
  // 14 vendor-bearing organizations, which is exactly what a vendor-grouped
  // screenshot is made of. A screenshot taken inside a Riyadh PMO reading
  // "Wathiq Integration — 120 organizations" is a real integrator with an
  // invented book of business. `Demo Vendor …` cannot be read as a company.
  it('names no vendor that could be mistaken for a real integrator', () => {
    expect(plan.summary.vendors.every((v) => v.name.startsWith('Demo Vendor '))).toBe(true)
    // *Not recorded* is a state the filter has to draw, and it is the state most
    // real rows will be in on day one. Around a tenth of the file is in it.
    const none = FILE_ORGS.filter((o) => o.vendor === '').length
    expect(none / FILE_ORGS.length).toBeGreaterThan(0.05)
    expect(none / FILE_ORGS.length).toBeLessThan(0.2)
  })

  // The same rule for the tree itself. An earlier draft named its tier-2 nodes
  // `Central/Western/Eastern/Northern Cluster` — the MOH health-cluster
  // structure — and filed a near-miss on a real Qatif hospital under the wrong
  // one, so the branch read as the real national programme AND read as wrong.
  // Nothing above an organization now names a place at all: two lettered
  // directorates, five numbered account books, six plain facility types.
  it('names no tier that mirrors a real national programme', () => {
    const tiers = [...new Set(FILE_ROWS.filter((r) => r.kind !== 'Organization').map((r) => r.path[r.path.length - 1]))]
    expect(tiers).toEqual([
      'Demo Portfolio',
      'Associate Directorate Alpha',
      'Account Book One',
      'Hospitals',
      'Clinics',
      'Laboratories',
      'Polyclinics',
      'Imaging Centres',
      'Pharmacies',
      'Account Book Two',
      'Account Book Three',
      'Associate Directorate Beta',
      'Account Book Four',
      'Account Book Five',
    ])
  })

  it('names only the two members who actually resolve, and leaves the rest unassigned', () => {
    const named = [...new Set(FILE_ROWS.map((r) => r.accountManager).filter(Boolean))].sort()
    expect(named).toEqual(['Abdulaziz Alsaloom', 'nasser'])
    // THE UNASSIGNED PILE IS THE FEATURE. Three of the five account books carry
    // no account manager at all, because there are no other provisioned
    // accounts — inventing a third name would refuse every row that held it.
    const unassigned = FILE_ORGS.filter((o) => o.accountManager === '').length
    expect(unassigned / FILE_ORGS.length).toBeGreaterThan(0.4)
    const books = FILE_ROWS.filter((r) => r.path[r.path.length - 1].startsWith('Account Book '))
    expect(books.filter((b) => b.accountManager === '').length).toBe(3)
  })

  // ⚠ THE ROWS THAT DEMONSTRATE EMPTY MUST BE EMPTY. An earlier draft put the
  // sentence "Nothing recorded at all: no vendor, no account manager, no
  // capability. This is the empty state" into the description of the row that
  // was supposed to BE the empty state — the longest organization-level
  // description in the file. So the one state most real organizations will be
  // in on day one was the one state the dataset never rendered. The explanation
  // lives in the README; these rows carry nothing.
  it('ships genuinely bare organizations, so the empty panel can be judged', () => {
    const created = plan.actions.filter((a) => a.kind === 'create-node' && a.values.kindName === 'Organization')
    const linked = new Set(plan.actions.filter((a) => a.kind === 'set-use-case').map((a) => a.key))
    const staged = new Set(plan.actions.filter((a) => a.kind === 'set-stage').map((a) => a.key))
    const bare = created.filter(
      (a) =>
        a.values.name_ar === '' &&
        a.values.vendor === '' &&
        a.values.description === '' &&
        a.values.description_ar === '' &&
        a.values.account_manager_id === null &&
        !linked.has(a.key) &&
        !staged.has(a.key),
    )
    expect(bare.length).toBeGreaterThan(0)
  })

  // Descriptions render in the Organization panel, so they have to be the kind
  // of copy a PMO writes — otherwise he cannot judge length, wrapping or the
  // Arabic/English pairing, and any screenshot that leaves the room shows the
  // build's own reasoning back at itself. An earlier file failed this on seven
  // rows ("The largest branch on purpose: the map encodes descendant count as
  // size…"). Long and short both survive, so wrapping is still exercised.
  it('describes organizations, not the dataset', () => {
    const orgs = plan.actions.filter((a) => a.kind === 'create-node' && a.values.kindName === 'Organization')
    const meta = /\bon purpose\b|\bthe map\b|\bthis row\b|\bthe importer\b|\bempty state\b|\bfalls back\b/iu
    expect(orgs.filter((a) => meta.test(a.values.description)).map((a) => a.name)).toEqual([])
    const lengths = orgs.map((a) => a.values.description.length)
    expect(Math.max(...lengths)).toBeGreaterThan(200)
    expect(Math.min(...lengths)).toBe(0)
  })

  // A ladder whose rows are all near the top never draws its interesting end,
  // and one with no blanks hides the difference between "Not started" (somebody
  // decided) and nothing at all (nobody has looked) — which is the whole reason
  // `map_node_progress` has three states rather than two.
  it('reaches every rung of the ladder, piles up on one, and leaves a third blank', () => {
    const tally = new Map()
    for (const a of plan.actions.filter((x) => x.kind === 'set-stage')) {
      tally.set(a.stageName, (tally.get(a.stageName) ?? 0) + 1)
    }
    // All seven, including Paused — the Stalled lens has nothing to draw without it.
    expect([...tally.keys()].sort()).toEqual(LIVE_STAGES.map((s) => s.name).sort())
    const blank = FILE_ORGS.filter((o) => o.stage === '').length
    expect(blank / FILE_ORGS.length).toBeGreaterThan(0.2)
    expect(blank / FILE_ORGS.length).toBeLessThan(0.4)
    // The bottleneck: one middle rung holding more than any other, by a margin
    // wide enough to read off the canvas rather than off a tooltip.
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])
    expect(sorted[0][1]).toBeGreaterThan(sorted[1][1] * 1.5)
    expect(['Kickoff', 'Integrating & Testing', 'UAT']).toContain(sorted[0][0])
  })

  it('puts BOTH ends of the use-case panel on screen: all ten live, and nothing at all', () => {
    const byOrg = new Map()
    for (const a of plan.actions.filter((x) => x.kind === 'set-use-case')) {
      const org = a.path[a.path.length - 1]
      byOrg.set(org, [...(byOrg.get(org) ?? []), a.status])
    }
    const orgs = plan.actions
      .filter((a) => a.kind === 'create-node' && a.values.kindName === 'Organization')
      .map((a) => a.name)
    // Nothing recorded at all — the state the panel renders as an em-dash, and
    // the state nearly half the file is in.
    const empty = orgs.filter((o) => !byOrg.has(o)).length
    expect(empty / orgs.length).toBeGreaterThan(0.35)
    expect(empty / orgs.length).toBeLessThan(0.55)
    // A handful with the whole catalogue in production — the other end.
    const complete = [...byOrg.values()].filter(
      (statuses) => statuses.length === SEEDED_USE_CASES.length && statuses.every((s) => s === 'live'),
    )
    expect(complete.length).toBeGreaterThanOrEqual(3)
    expect(complete.length).toBeLessThanOrEqual(12)
    // A single capability, which is the other end of the same axis.
    expect([...byOrg.values()].filter((v) => v.length === 1).length).toBeGreaterThan(10)
    expect(new Set([...byOrg.values()].flat())).toEqual(new Set(USE_CASE_STATUSES))
  })

  it('commits to dates on organizations and counts on the tiers above them', () => {
    const goals = plan.actions.filter((a) => a.kind === 'create-goal')
    expect(goals.length).toBeGreaterThanOrEqual(20)
    const counts = goals.filter((g) => g.target !== null)
    const dates = goals.filter((g) => g.target === null)
    // A count is "N of the ones beneath me", so it only means anything above an
    // organization; a date on an organization is "this one, by then".
    expect(counts.length).toBeGreaterThan(0)
    expect(counts.length).toBeLessThan(dates.length)
    for (const g of counts) {
      expect(FILE_ORGS.some((o) => o.path[o.path.length - 1] === g.path[g.path.length - 1])).toBe(false)
      expect(g.target).toBeGreaterThan(0)
    }
    // ⚠ FIXED DATES, NOT CLOCK-RELATIVE ONES. `make-demo-400.mjs` offsets every
    // one of these from a base date constant so the committed file does not
    // change on a day nobody edited it. All of them sit inside one twelve-month
    // window, which is what the Portfolio lens draws.
    const days = goals.map((g) => Date.parse(`${g.targetDate}T00:00:00Z`))
    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(370 * 86400000)
  })

  it('names an Arabic name on most rows, and deliberately not on all of them', () => {
    const created = plan.actions.filter((a) => a.kind === 'create-node' && !a.implied)
    const withArabic = created.filter((a) => a.values.name_ar !== '')
    expect(withArabic.length / created.length).toBeGreaterThan(0.5)
    expect(withArabic.length / created.length).toBeLessThan(0.8)
  })

  it('THE SECOND PLAN IS EMPTY — an interrupted apply is fixed by re-running', () => {
    const before = demoWorkspace()
    const after = applyToSnapshot(before, planCsv(DEMO, before).actions)
    const second = planCsv(DEMO, after)
    expect(codes(second)).toEqual([])
    expect(second.actions).toEqual([])
  })
})

// ── the slice file ──────────────────────────────────────────────────────────
//
// `structure.slice.csv` is the OTHER file destined for the live project, and it
// shipped with two assertions to its name: a BOM and a header. Everything that
// makes it importable — zero refusals, one implied node, one deletable root, no
// two siblings colliding in English or Arabic, no path reaching a seventh level,
// an empty second plan — was stated in a comment inside a generator nobody opens
// before importing. Those are the same properties the demo block above pins, on
// a file with a HARDER precondition than the demo file has (0026 and 0027 both
// applied, or the whole import is refused by name), so they are pinned here in
// the same shape.
//
// ⚠ AND ONE MORE, WHICH THE DEMO BLOCK DOES NOT NEED: THE BYTES.
// `make-demo-slice.mjs` promises at its line 3 that re-running writes the same
// file, and that promise is what makes the committed CSV reviewable as a diff.
// Nothing enforced it. Its own `verify()` measures COUNTS, and every count in
// that file stays inside its band under a reshuffle — so a `Math.random()`, a
// `new Date()`, or a `pick()` inserted before the stem draw would churn all 83
// rows, pass every gate, and arrive as a diff a reviewer reads as noise. The
// first test below re-runs the generator in memory and compares the bytes,
// which is the only assertion that notices.
//
// That byte pin is also what makes the exact counts below safe to state. The
// demo block argues — correctly, for a file regenerated whenever its shape is
// retuned — that a pinned count is a test that fails on every retune and proves
// nothing. Here a retune fails the byte comparison FIRST, in the same run, so
// stating 72 and 83 costs nothing extra and buys something: they are the numbers
// `docs/templates/README.md` and `docs/OWNER-PLAYBOOK.md` quote at the owner, and
// a retune that moves them fails beside the prose that would otherwise go stale.

describe('THE SLICE FILE, against the live workspace it is meant for', () => {
  const SLICE = readTemplate('structure.slice.csv')

  const RECORDS = parseCsv(SLICE)
  const HEAD = RECORDS[0].cells
  const FILE_ROWS = RECORDS.slice(1).map((r) => {
    const cell = (name) => r.cells[HEAD.indexOf(name)] ?? ''
    return {
      path: cell('path').split('>').map((s) => s.trim()),
      kind: cell('kind'),
      vendor: cell('vendor'),
      accountManager: cell('account_manager'),
      nameAr: cell('name_ar'),
      descriptionAr: cell('description_ar'),
      stage: cell('stage'),
      targetDate: cell('target_date'),
      target: cell('target'),
      statuses: SEEDED_USE_CASES.map((name) => cell(name)).filter((v) => v !== ''),
    }
  })
  const FILE_ORGS = FILE_ROWS.filter((r) => r.kind === 'Organization')

  const plan = planCsv(SLICE, demoWorkspace())
  const count = (kind) => plan.actions.filter((a) => a.kind === kind).length

  // ⚠ THE ONE TEST THAT MAKES THE HEADER'S FIRST PROMISE TRUE. `build()` is
  // imported rather than shelled out to, so this costs milliseconds; `main()`
  // is guarded behind an `import.meta.url` check in the generator precisely so
  // that importing it here writes nothing into `docs/templates/`.
  it('REGENERATES BYTE FOR BYTE — the determinism the file is committed on', () => {
    const built = buildSlice()
    // The generator's own gates, run against the rows this test just built:
    // a green byte comparison against a file that failed `verify()` would be
    // two wrongs agreeing.
    expect(() => verifySlice(built)).not.toThrow()
    expect(renderSlice(built)).toBe(SLICE)
  })

  it('refuses nothing, and plans exactly what the file holds', () => {
    expect(codes(plan)).toEqual([])
    expect(plan.summary.rows).toBe(FILE_ROWS.length)
    expect(plan.summary.create).toBe(FILE_ROWS.length + plan.summary.createImplied)
    expect(count('set-use-case')).toBe(FILE_ROWS.reduce((n, r) => n + r.statuses.length, 0))
    expect(count('set-stage')).toBe(FILE_ROWS.filter((r) => r.stage !== '').length)
    expect(count('create-goal')).toBe(FILE_ROWS.filter((r) => r.targetDate !== '').length)
    expect(plan.summary.update).toBe(0)
    expect(plan.summary.clearLinks).toBe(0)
    expect(plan.summary.newUseCases).toBe(0)
    expect(plan.summary.movedGoals).toBe(0)
  })

  // The size IS the argument for this file's existence: four hundred rows do
  // not come back out in a few seconds and seventy-two do.
  it('is the small one — 83 rows, 72 organizations, five levels below the track', () => {
    expect(FILE_ROWS.length).toBe(83)
    expect(FILE_ORGS.length).toBe(72)
    expect(Math.max(...FILE_ROWS.map((r) => r.path.length - 1))).toBe(5)
  })

  it('hangs every node under one deletable root — this IS the reset', () => {
    const created = pathsOf(plan, 'create-node')
    expect(created[0]).toBe('UHR > Demo Slice')
    expect(created.every((p) => p === 'UHR > Demo Slice' || p.startsWith('UHR > Demo Slice > '))).toBe(true)
    // Every ROW too, not only every create — the prose in the generator's
    // summary says "every row hangs under UHR > Demo Slice" and this is it.
    expect(FILE_ROWS.every((r) => r.path[0] === 'UHR' && r.path[1] === 'Demo Slice')).toBe(true)
    // `UHR > OB` is the one real node, and `Demo Portfolio` is the OTHER demo
    // root: a workspace may hold both, and undoing either leaves the other.
    expect(created.some((p) => p.startsWith('UHR > OB'))).toBe(false)
    expect(created.some((p) => p.startsWith('UHR > Demo Portfolio'))).toBe(false)
    expect(plan.actions.some((a) => a.kind === 'update-node')).toBe(false)
  })

  it('leaves exactly one intermediate implied, and names which one', () => {
    const implied = plan.actions.filter((a) => a.kind === 'create-node' && a.implied)
    expect(implied.map((a) => a.path.join(' > '))).toEqual([
      'UHR > Demo Slice > Associate Directorate Beta > Account Book Three > Pharmacies',
    ])
    expect(FILE_ROWS.some((r) => r.path.join(' > ') === implied[0].path.join(' > '))).toBe(false)
  })

  it('writes no use-case cell that is not one of the three legal statuses', () => {
    const seen = new Set(FILE_ROWS.flatMap((r) => r.statuses))
    expect([...seen].sort()).toEqual([...USE_CASE_STATUSES].sort())
  })

  it('stays inside 0023 — the depth cap and both name-length checks', () => {
    for (const row of FILE_ROWS) {
      expect(row.path.length - 1).toBeLessThanOrEqual(MAX_NODE_DEPTH)
      for (const segment of row.path) expect(segment.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
      expect(row.nameAr.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
    }
  })

  // ⚠ TWO OF THE FOUR ACCOUNT BOOKS ARE FLAT, so organizations of different
  // types are SIBLINGS there — a hospital and a laboratory drawn from the same
  // stem queue would collide under one parent. `map_nodes_sibling_name_uidx`
  // and its Arabic twin would kill the apply MID-DEPTH, with part of the tree
  // already written. The planner refuses that before it starts, so the zero
  // above already covers it; this states the property the generator's
  // draw-without-replacement exists to guarantee, so a retune that switched to
  // a per-type queue fails here by name rather than as an anonymous refusal.
  it('has no two siblings sharing a name, in either language', () => {
    const byParent = new Map()
    for (const row of FILE_ROWS) {
      const parent = row.path.slice(0, -1).join(' > ')
      byParent.set(parent, [...(byParent.get(parent) ?? []), row])
    }
    for (const [parent, kids] of byParent) {
      const names = kids.map((k) => k.path[k.path.length - 1])
      expect([parent, new Set(names).size]).toEqual([parent, names.length])
      const arabic = kids.map((k) => k.nameAr).filter((n) => n !== '')
      expect([parent, new Set(arabic).size]).toEqual([parent, arabic.length])
    }
  })

  it('reaches every rung of the ladder, piles up on Integrating, and leaves 22 blank', () => {
    const tally = new Map()
    for (const a of plan.actions.filter((x) => x.kind === 'set-stage')) {
      tally.set(a.stageName, (tally.get(a.stageName) ?? 0) + 1)
    }
    expect([...tally.keys()].sort()).toEqual(LIVE_STAGES.map((s) => s.name).sort())
    // The two numbers the docs quote: the pile that becomes the stalled list
    // once `expected_days` is set on `Integrating`, and the "nobody has said"
    // bucket, which is a different fact from `Not started`.
    expect(tally.get('Integrating & Testing')).toBe(18)
    expect(FILE_ORGS.filter((o) => o.stage === '').length).toBe(22)
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])
    expect(sorted[0][0]).toBe('Integrating & Testing')
    expect(sorted[0][1]).toBeGreaterThan(sorted[1][1] * 1.5)
  })

  it('names only the two members who actually resolve', () => {
    const named = [...new Set(FILE_ROWS.map((r) => r.accountManager).filter(Boolean))].sort()
    expect(named).toEqual(['Abdulaziz Alsaloom', 'nasser'])
  })

  it('names no vendor that could be mistaken for a real integrator', () => {
    expect(plan.summary.vendors.every((v) => v.name.startsWith('Demo Vendor '))).toBe(true)
  })

  // The Arabic column is not a translation exercise — it is the half of the
  // pairing that has to WRAP, and it is the half that shipped as one line at
  // every breakpoint until `EXTRA_LINE_AR` existed. Both halves of the rule
  // Arabic applies to a counted noun are checked, because the plural form is
  // what an Arabic-first reader sees as broken on first glance.
  it('puts RTL wrapping on screen, and counts its nouns the way Arabic does', () => {
    const arabic = FILE_ROWS.map((r) => r.descriptionAr).filter((d) => d !== '')
    expect(arabic.filter((d) => d.length > 200).length).toBeGreaterThanOrEqual(2)
    // 11–99 takes a SINGULAR accusative tamyiz. A plural there — `بـ 34 غرف` —
    // is the bug the n-aware `SIZE_PHRASE_AR` band exists to prevent. The
    // lookahead is what keeps `غرف` from matching the correct `غرفةً`.
    for (const description of arabic) {
      expect(description).not.toMatch(/بـ (?:1[1-9]|[2-9]\d) (?:غرف|منصات|أجهزة|نوافذ)(?![ء-ي])/u)
    }
  })

  it('THE SECOND PLAN IS EMPTY — an interrupted apply is fixed by re-running', () => {
    const before = demoWorkspace()
    const after = applyToSnapshot(before, planCsv(SLICE, before).actions)
    const second = planCsv(SLICE, after)
    expect(codes(second)).toEqual([])
    expect(second.actions).toEqual([])
  })
})

// ── the fixes this wave landed ──────────────────────────────────────────────

describe('a column of your own is named as such, not as nine bad statuses', () => {
  const CSV = [
    `${FIXED_COLUMNS.join(',')},ADT,Outstanding issue`,
    'UHR > A,,,,,,,,,,live,Waiting on vendor',
    'UHR > B,,,,,,,,,,live,Waiting on vendor',
  ].join('\n')

  it('refuses the COLUMN once and suppresses the per-row status noise', () => {
    const plan = planCsv(CSV)
    expect(codes(plan)).toEqual(['use_case_unknown'])
    expect(plan.refusals[0].message).toContain('no use case named `Outstanding issue`')
  })

  it('still refuses a genuinely mistyped status under a REAL capability', () => {
    const plan = planCsv(`${HEADER}\nUHR > A,,,,,,,,,,in progress,,`)
    expect(codes(plan)).toEqual(['status_unknown'])
  })

  it('offers the nearest catalogue name before it offers --add-use-cases', () => {
    const plan = planCsv(
      [`${FIXED_COLUMNS.join(',')},Radiolegy Report`, 'UHR > A,,,,,,,,,,live'].join('\n'),
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
        'UHR > OB > One,عيادة الروضة,Organization,,,,,,,,,,',
        'UHR > OB > Two,عيادة الروضة,Organization,,,,,,,,,,',
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
    const plan = planCsv(`${HEADER}\nUHR > Other,مركز,Organization,,,,,,,,,,`, workspace)
    expect(codes(plan)).toEqual(['duplicate_sibling_name_ar'])
  })

  it('lets a node keep its OWN Arabic name on a re-run', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      { id: 'n-1', parent_id: null, track_id: 't-uhr', name: 'Existing', name_ar: 'مركز', map_node_use_cases: [] },
    ]
    expect(codes(planCsv(`${HEADER}\nUHR > Existing,مركز,,,,,,,,,,,`, workspace))).toEqual([])
  })

  it('ignores blanks — the index is PARTIAL on btrim(name_ar) <> \'\'', () => {
    const plan = planCsv(
      [HEADER, 'UHR > OB > One,,Organization,,,,,,,,,,', 'UHR > OB > Two,,Organization,,,,,,,,,,'].join('\n'),
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
    const plan = planCsv(`${HEADER}\nUHR > ${nfd},,,,,,,,,,,,`, workspace)
    expect(plan.actions).toEqual([])
    expect(plan.notes.filter((n) => n.kind === 'not_in_file')).toEqual([])
  })
})

describe('a repaired path says so, even when nothing is refused', () => {
  it('notes a zero-width space that joined two words', () => {
    const plan = planCsv(`${HEADER}\nUHR > Riyadh​Care,,,,,,,,,,,,`)
    const repaired = plan.notes.filter((n) => n.kind === 'repaired_path')
    expect(repaired).toHaveLength(1)
    expect(repaired[0].message).toContain('zero-width space')
    expect(plan.actions[0].name).toBe('RiyadhCare')
  })

  it('says NOTHING on an ordinary path — a note on every row is a note nobody reads', () => {
    const plan = planCsv(`${HEADER}\nUHR > Onboarding > Riyadh Care,,,,,,,,,,,,`)
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
    const plan = planCsv(`${HEADER}\nUHR > Ops > Riyadh Care,,,,,,,,,,live,,`, workspace)
    const move = plan.notes.find((n) => n.kind === 'looks_like_a_move')
    expect(move).toBeTruthy()
    expect(move.message).toContain('Onboarding')
    expect(move.message).toContain('TWO of them')
  })
})

describe('the vendors are rolled up, because the filter groups on the exact string', () => {
  const CSV = [
    HEADER,
    'UHR > A,,,,Mirqab Integration Co.,,,,,,,,',
    'UHR > B,,,,"Mirqab Integration Co., Riyadh",,,,,,,,',
    'UHR > C,,,,Mirqab Integration Co.,,,,,,,,',
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
    const plan = planCsv(`${HEADER}\nUHR > A,,,,,"line one\r\nline two",,,,,,,`, workspace)
    // Identical after folding, so there is NO update at all — the old behaviour
    // emitted one whose two sides printed the same and PATCHed a \r into the row.
    expect(plan.actions).toEqual([])
  })

  it('never emits a carriage return into the plan', () => {
    const workspace = emptyWorkspace()
    workspace.nodes = [
      { id: 'n-1', parent_id: null, track_id: 't-uhr', name: 'A', name_ar: '', description: 'old', map_node_use_cases: [] },
    ]
    const plan = planCsv(`${HEADER}\nUHR > A,,,,,"new\r\nsecond line",,,,,,,`, workspace)
    expect(renderPlan(plan, {}).includes('\r')).toBe(false)
  })
})

describe('the plan shows the position the map will draw in', () => {
  it('prints [position N] beside each new node, taken from FILE order', () => {
    const printed = renderPlan(
      planCsv([HEADER, 'UHR > Zulu,,,,,,,,,,,,', 'UHR > Alpha,,,,,,,,,,,,'].join('\n')),
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
    const plan = planCsv(`${HEADER}\nUHR > A,,Organisation,,,,,,,,,,`)
    expect(codes(plan)).toEqual(['kind_unknown'])
    expect(plan.refusals[0].message).toContain('Settings › Catalogue')
    expect(plan.refusals[0].message).not.toContain('Settings › Structure')
    expect(plan.refusals[0].message).toContain('Did you mean `Organization`?')
  })
})

// ── wave 8: the stage and the goal ──────────────────────────────────────────
//
// THREE COLUMNS, AND EVERY ONE OF THEM BREAKS A RULE THE OTHER SEVEN KEEP.
// `vendor` blank CLEARS a vendor; `stage` blank changes NOTHING. That asymmetry
// is the single most destructive thing in this file if it is ever quietly
// reversed — one colleague filling in vendors and leaving `stage` alone would
// return four hundred organizations to "nobody has said" and destroy every
// `stage_changed_at` with them, which 0026's stamp trigger cannot give back.
// So it is asserted first, and from both directions.

/** The same fixed columns with the wave-8 three named, for readability. */
const rowWith = ({ path, stage = '', targetDate = '', target = '', ...rest }) =>
  [
    path,
    rest.nameAr ?? '',
    rest.kind ?? '',
    rest.am ?? '',
    rest.vendor ?? '',
    '',
    '',
    stage,
    targetDate,
    target,
    rest.adt ?? '',
    '',
    '',
  ].join(',')

describe('the stage column reads the ladder out of the DATABASE', () => {
  it('records a stage on a node that had none, and says nobody had said before', () => {
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', stage: 'Integrating' })}`,
      populated(),
    )
    expect(codes(result)).toEqual([])
    const stage = result.actions.find((a) => a.kind === 'set-stage')
    expect(stage).toMatchObject({ stageId: 's-integrating', stageName: 'Integrating', from: null, hadRow: false })
    expect(renderPlan(result, {})).toContain('(nobody had said)')
  })

  it('matches the rung case-insensitively and through an NFD paste', () => {
    const workspace = populated()
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', stage: '  gO-LIVE ready ' })}`,
      workspace,
    )
    expect(codes(result)).toEqual([])
    expect(result.actions.find((a) => a.kind === 'set-stage').stageId).toBe('s-ready')
  })

  it('matches the ARABIC name of a rung and says which name matched', () => {
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', stage: 'قيد التكامل' })}`,
      populated(),
    )
    expect(codes(result)).toEqual([])
    expect(result.notes.some((n) => n.kind === 'stage_matched_ar')).toBe(true)
    expect(result.actions.find((a) => a.kind === 'set-stage').stageId).toBe('s-integrating')
  })

  it('⚠ A BLANK STAGE CHANGES NOTHING — it is never written as "Not started"', () => {
    // The whole argument in one test. `vendor` blank clears; `stage` blank is
    // silence, and silence is not a statement that nothing is true.
    const workspace = populated()
    workspace.progress = [{ node_id: 'n-rc', stage_id: 's-integrating' }]
    const result = planCsv(
      `${HEADER}\nUHR > Onboarding > Riyadh Care,,Organization,sara.alsaab,Acme,,,,,,testing,,`,
      workspace,
    )
    expect(codes(result)).toEqual([])
    expect(result.actions.filter((a) => a.kind === 'set-stage')).toEqual([])
    expect(renderPlan(result, {})).not.toContain('Not started')
  })

  it('says nothing when the node is already on that rung — the re-run property', () => {
    const workspace = populated()
    workspace.progress = [{ node_id: 'n-rc', stage_id: 's-live' }]
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', stage: 'Live', kind: 'Organization', am: 'sara.alsaab', vendor: 'Acme', adt: 'testing' })}`,
      workspace,
    )
    expect(result.actions).toEqual([])
  })

  it('carries the PREVIOUS rung by name, and hadRow, so the undo can tell the two apart', () => {
    const workspace = populated()
    workspace.progress = [{ node_id: 'n-rc', stage_id: 's-kickoff' }]
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', stage: 'Live' })}`,
      workspace,
    )
    const stage = result.actions.find((a) => a.kind === 'set-stage')
    // `hadRow: true` is what makes the undo PATCH rather than DELETE — a row
    // with a null stage says "somebody looked and cleared it", which is a
    // sentence nobody said.
    expect(stage).toMatchObject({ from: 's-kickoff', fromLabel: 'Kickoff', hadRow: true })
    expect(renderPlan(result, {})).toContain('Kickoff')
  })

  it('refuses a rung this workspace does not have, and names the nearest one it does', () => {
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', stage: 'Integraton' })}`,
      populated(),
    )
    expect(codes(result)).toEqual(['stage_unknown'])
    const message = result.refusals[0].message
    expect(message).toContain('Did you mean `Integrating`?')
    // The whole ladder, in its order, so a person can see what he may type.
    expect(message).toContain('Not started → Kickoff → Integrating')
    expect(message).toContain('does NOT create stages')
    expect(result.actions.filter((a) => a.kind === 'set-stage')).toEqual([])
  })

  it('notes a HIDDEN rung rather than refusing it — a node can legitimately sit there', () => {
    const workspace = populated()
    workspace.stages = STAGES.map((s) => (s.id === 's-paused' ? { ...s, hidden: true } : s))
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', stage: 'Paused' })}`,
      workspace,
    )
    expect(codes(result)).toEqual([])
    expect(result.notes.some((n) => n.kind === 'stage_hidden')).toBe(true)
    expect(result.actions.some((a) => a.kind === 'set-stage')).toBe(true)
  })

  it('NO STAGE NAME IS WRITTEN DOWN IN THE PLANNER — the ladder is renameable', () => {
    // A `STAGE_NAMES` constant is the obvious thing to write and it is wrong in
    // a way nothing catches: 0026 SEEDS these seven and every one is renameable
    // in Settings › Catalogue, so a copy here would refuse a rung the app draws
    // on every row. The disposition Aziz audits is the one the database holds.
    const source = readFileSync(new URL('./structurePlan.mjs', import.meta.url), 'utf8')
    for (const rung of ['Kickoff', 'Testing/UAT', 'Go-live ready']) {
      expect(source).not.toContain(rung)
    }
  })
})

describe('the goal columns — at most one goal per row, and it is the row’s own', () => {
  // The row as `populated()` already holds it, so the ONLY thing any of these
  // plans can contain is what the goal columns caused. A row that also cleared
  // the vendor would pass the same assertions for the wrong reason.
  const goalRow = (over) =>
    rowWith({
      path: 'UHR > Onboarding > Riyadh Care',
      kind: 'Organization',
      am: 'sara.alsaab',
      vendor: 'Acme',
      adt: 'testing',
      ...over,
    })

  it('a date with no target is "this node is there by then"', () => {
    const result = planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31' })}`, populated())
    expect(codes(result)).toEqual([])
    expect(result.actions.find((a) => a.kind === 'create-goal')).toMatchObject({
      target: null,
      targetDate: '2026-12-31',
      nodeId: 'n-rc',
    })
    expect(renderPlan(result, {})).toContain('goal: by 2026-12-31')
  })

  it('a date with a target is a count of organizations beneath it', () => {
    const result = planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31', target: '40' })}`, populated())
    expect(result.actions.find((a) => a.kind === 'create-goal').target).toBe(40)
    expect(renderPlan(result, {})).toContain('40 organization(s) by 2026-12-31')
  })

  it('⚠ REFUSES A DD/MM/YYYY DATE AND NAMES EXCEL AS THE AUTHOR', () => {
    // `01/12/2026` is December in Riyadh and January in San Francisco, and the
    // file cannot say which. Accepting either silently moves a commitment by
    // eleven months.
    const result = planCsv(`${HEADER}\n${goalRow({ targetDate: '01/12/2026' })}`, populated())
    expect(codes(result)).toEqual(['target_date_shape'])
    const message = result.refusals[0].message
    expect(message).toContain('EXCEL WROTE IT')
    expect(message).toContain('YYYY-MM-DD')
    expect(message).toContain('TEXT')
  })

  it('refuses a day that does not exist, where it costs a line number and not a batch', () => {
    // `new Date('2026-02-30')` rolls forward to 2 March and Postgres raises
    // 22008 — mid-apply, after the nodes have landed.
    expect(codes(planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-02-30' })}`, populated()))).toEqual([
      'target_date_shape',
    ])
    expect(codes(planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-02-28' })}`, populated()))).toEqual([])
  })

  it('refuses a target with no date, a zero target, and a five-digit one', () => {
    expect(codes(planCsv(`${HEADER}\n${goalRow({ target: '40' })}`, populated()))).toEqual(['target_without_date'])
    expect(
      codes(planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31', target: '0' })}`, populated())),
    ).toEqual(['target_zero'])
    const serial = planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31', target: '46022' })}`, populated())
    expect(codes(serial)).toEqual(['target_too_large'])
    // The number Excel writes when a DATE lands in this column.
    expect(serial.refusals[0].message).toContain('forty-thousands')
  })

  it('refuses `40 orgs` rather than reading the number out of it', () => {
    expect(
      codes(planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31', target: '40 orgs' })}`, populated())),
    ).toEqual(['target_not_a_number'])
  })

  it('MOVES ITS OWN GOAL RATHER THAN ADDING A SECOND — 0027 has no unique index', () => {
    const workspace = populated()
    workspace.goals = [
      { id: 'g-1', node_id: 'n-rc', label: '', stage_id: null, target: null, target_date: '2026-06-30' },
    ]
    const result = planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31' })}`, workspace)
    expect(kinds(result)).toEqual(['update-goal'])
    expect(result.actions[0]).toMatchObject({
      goalId: 'g-1',
      targetDate: '2026-12-31',
      from: { target: null, targetDate: '2026-06-30' },
    })
    expect(renderPlan(result, {})).toContain('by 2026-06-30 -> by 2026-12-31')
  })

  it('never touches a goal an Associate Director labelled or narrowed to a stage', () => {
    const workspace = populated()
    workspace.goals = [
      { id: 'g-ad', node_id: 'n-rc', label: 'Phase 2 go-live', stage_id: null, target: null, target_date: '2026-06-30' },
      { id: 'g-stage', node_id: 'n-rc', label: '', stage_id: 's-ready', target: 5, target_date: '2026-07-31' },
    ]
    const result = planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31' })}`, workspace)
    // A CREATE, beside both of them: this file can only speak about the
    // unlabelled, stage-less one, and neither of those is it.
    expect(kinds(result)).toEqual(['create-goal'])
  })

  it('refuses when two unlabelled goals could each be the one this row means', () => {
    const workspace = populated()
    workspace.goals = [
      { id: 'g-1', node_id: 'n-rc', label: '', stage_id: null, target: null, target_date: '2026-06-30' },
      { id: 'g-2', node_id: 'n-rc', label: '', stage_id: null, target: 10, target_date: '2026-09-30' },
    ]
    expect(codes(planCsv(`${HEADER}\n${goalRow({ targetDate: '2026-12-31' })}`, workspace))).toEqual([
      'goal_ambiguous',
    ])
  })

  it('says nothing when the goal already reads exactly this', () => {
    const workspace = populated()
    workspace.goals = [
      { id: 'g-1', node_id: 'n-rc', label: '', stage_id: null, target: 40, target_date: '2026-12-31' },
    ]
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > Onboarding > Riyadh Care', kind: 'Organization', am: 'sara.alsaab', vendor: 'Acme', adt: 'testing', targetDate: '2026-12-31', target: '40' })}`,
      workspace,
    )
    expect(result.actions).toEqual([])
  })
})

describe('the pre-migration refusal — 0026/0027 are applied by hand, and may not be', () => {
  const noSchema = () => ({ ...emptyWorkspace(), stages: [], progress: [], goals: [] })

  it('refuses BY NAME when a row names a stage and the tables are not there', () => {
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > A', stage: 'Integrating' })}`,
      noSchema(),
      { schema: { stages: false, goals: false } },
    )
    expect(codes(result)).toContain('stage_tables_missing')
    const message = result.refusals.find((r) => r.code === 'stage_tables_missing').message
    expect(message).toContain('0026 HAS NOT BEEN RUN')
    expect(message).toContain('docs/RUN-0026-0027-0028.md')
    // NOT a raw Postgres code. The point of the whole probe is that nobody ever
    // reads `42P01` out of the middle of a batch.
    expect(message).not.toContain('42P01')
  })

  it('refuses by name for a goal against a project without 0027', () => {
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > A', targetDate: '2026-12-31' })}`,
      noSchema(),
      { schema: { stages: true, goals: false } },
    )
    expect(codes(result)).toContain('goal_table_missing')
    expect(result.refusals[0].message).toContain('0027 HAS NOT BEEN RUN')
  })

  it('⚠ AND A STAGE-FREE FILE IMPORTS PERFECTLY AGAINST THE OLD SCHEMA', () => {
    // The property that lets him land the real structure before he finds a
    // free hour for the SQL Editor.
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > A', kind: 'Organization', adt: 'live' })}`,
      noSchema(),
      { schema: { stages: false, goals: false } },
    )
    expect(codes(result)).toEqual([])
    expect(kinds(result)).toEqual(['create-node', 'set-use-case'])
  })
})

describe('the header check catches a pre-wave-8 file at column 8, by name', () => {
  it('names the column, the count and the template — and the count is INTERPOLATED', () => {
    const old = ['path', 'name_ar', 'kind', 'account_manager', 'vendor', 'description', 'description_ar']
    const { refusals } = parseStructureCsv(`${old.join(',')},ADT\nUHR > A,,,,,,,live`)
    expect(refusals.map((r) => r.code)).toEqual(['header_columns'])
    const message = refusals[0].message
    expect(message).toContain('column 8 of the header should be `stage`')
    expect(message).toContain('reads `ADT`')
    // ⚠ THE COUNT COMES FROM FIXED_COLUMNS.length. It read "seven" for as long
    // as there were seven, and this is now the ONE message a pre-wave-8 file
    // reaches: a stale number here would tell the person holding exactly that
    // file that his header is already complete.
    expect(message).toContain(`The first ${FIXED_COLUMNS.length} columns are fixed`)
    expect(message).not.toContain('seven')
    expect(message).toContain('docs/templates/structure.csv')
  })
})

describe('the stage and the goals are written LAST, after every node and link', () => {
  it('orders set-stage and the goals after the use-case links', () => {
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > A > B', stage: 'Kickoff', targetDate: '2026-12-31', adt: 'live' })}`,
    )
    const order = kinds(result)
    expect(order.lastIndexOf('create-node')).toBeLessThan(order.indexOf('set-use-case'))
    expect(order.indexOf('set-use-case')).toBeLessThan(order.indexOf('set-stage'))
    expect(order.indexOf('set-stage')).toBeLessThan(order.indexOf('create-goal'))
  })

  it('counts them in the reconciliation line', () => {
    const result = planCsv(
      `${HEADER}\n${rowWith({ path: 'UHR > A', stage: 'Kickoff', targetDate: '2026-12-31', target: '9' })}`,
    )
    expect(renderPlan(result, {})).toMatch(/1 stage\(s\) to record · 1 goal\(s\) to write/u)
  })
})

describe('RE-RUNNABLE WITH STAGES AND GOALS — the second plan is still empty', () => {
  const FILE = [
    HEADER,
    rowWith({ path: 'UHR > Onboarding', kind: 'Phase', targetDate: '2026-12-31', target: '40' }),
    rowWith({
      path: 'UHR > Onboarding > Riyadh Care',
      kind: 'Organization',
      am: 'sara.alsaab',
      stage: 'Integrating',
      targetDate: '2026-09-30',
      adt: 'live',
    }),
    rowWith({ path: 'UHR > Onboarding > Jeddah Clinic', kind: 'Organization', stage: 'Kickoff' }),
  ].join('\r\n')

  it('lands the stages and the goals, then has nothing left to do', () => {
    const before = emptyWorkspace()
    const first = planCsv(FILE, before)
    expect(codes(first)).toEqual([])
    expect(first.summary.stages).toBe(2)
    expect(first.summary.newGoals).toBe(2)

    const after = applyToSnapshot(before, first.actions)
    expect(after.progress.map((p) => p.stage_id).sort()).toEqual(['s-integrating', 's-kickoff'])
    expect(after.goals).toHaveLength(2)

    const second = planCsv(FILE, after)
    expect(codes(second)).toEqual([])
    expect(second.actions).toEqual([])
    expect(renderPlan(second, {})).toContain('NOTHING TO DO')
  })

  it('re-runs after moving one date, planning only that move', () => {
    const before = emptyWorkspace()
    const after = applyToSnapshot(before, planCsv(FILE, before).actions)
    const moved = FILE.replace('2026-09-30', '2026-10-31')
    const plan = planCsv(moved, after)
    expect(codes(plan)).toEqual([])
    expect(kinds(plan)).toEqual(['update-goal'])
    expect(plan.actions[0].targetDate).toBe('2026-10-31')
  })

  it('re-runs after moving one organization up the ladder, planning only that', () => {
    const before = emptyWorkspace()
    const after = applyToSnapshot(before, planCsv(FILE, before).actions)
    const promoted = FILE.replace(',Integrating,', ',Go-live ready,')
    const plan = planCsv(promoted, after)
    expect(kinds(plan)).toEqual(['set-stage'])
    expect(plan.actions[0]).toMatchObject({ stageId: 's-ready', from: 's-integrating', hadRow: true })
  })
})

// ── ordering helper ─────────────────────────────────────────────────────────

describe('comparePaths sorts segment by segment', () => {
  it('keeps a subtree together rather than sorting on the joined string', () => {
    const paths = [['UHR', 'AB'], ['UHR', 'A'], ['UHR', 'A', 'B']]
    expect(paths.sort(comparePaths)).toEqual([['UHR', 'A'], ['UHR', 'A', 'B'], ['UHR', 'AB']])
  })
})
