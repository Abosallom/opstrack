// structurePlan — the whole of the thinking behind `node scripts/import-structure.mjs`,
// with none of the I/O.
//
// ═══ WHY THIS FILE IS SEPARATE, AND WHY IT IS PURE ═══
//
// The importer has exactly one job that matters: SAY WHAT WOULD CHANGE, THEN
// CHANGE IT. Those two sentences are the same sentence only if the dry run and
// the apply run the *same* code — otherwise the dry run is theatre, and the one
// thing a person can never check is the thing he was shown before he agreed.
//
// So the decision — "which nodes exist, which have to be made, which fields
// actually differ, which use-case links to set and which to clear" — lives here,
// in a function that performs NO I/O, reads no clock, and touches no network:
//
//     planStructure({ rows, tracks, nodes, kinds, members, useCases }) -> { actions, refusals, … }
//
// `import-structure.mjs` reads the file, reads the workspace, calls this ONCE,
// prints the result, and — only with `--apply`, and only if `refusals` is empty
// — executes the very list it printed. Everything below is testable without a
// database, an Excel licence or a network, which is exactly the coverage the
// traps in the brief need.
//
// The parser is here for the same reason. `parseCsv` is a pure string→records
// function and every one of its failure modes (a BOM, a CRLF, a quoted comma, a
// quoted newline, a doubled quote, an unterminated quote) is silent corruption
// rather than an error — the row still imports, into the wrong columns. Silent
// corruption is precisely what only a test can catch, and a test can only reach
// it if the parser has no file in front of it.
//
//
// ═══ THE FILE CONTRACT THIS IMPLEMENTS ═══
//
// One row per node. Seven fixed columns, in this order, then one column per use
// case:
//
//   path             THE WHOLE PATH INCLUDING THE TRACK — `UHR > Onboarding > Riyadh Care`.
//                    First segment is a TRACK and must already exist (this
//                    script does not create tracks). The rest are map_nodes.
//                    The LAST segment is the node the row is about.
//   name_ar          Arabic name of the LAST segment. Blank = '' (the column is
//                    `not null default ''`, and the app falls back to English).
//   kind             map_node_kinds.name — Programme, Phase, Organization. Blank legal.
//   account_manager  a member: username, email, or exact display name. Blank = unassigned.
//   vendor           free text, the integrator. Blank = '' = "not recorded".
//   description      blank legal.
//   description_ar   blank legal.
//   <use case>…      one column per use_cases.name, cell ∈ { blank, planned, testing, live }.
//
// A BLANK USE-CASE CELL IS NOT A FOURTH STATUS. `UseCaseStatus` has three
// members and no fourth (src/types.ts:795): "not integrated at all" is the
// ABSENCE of the row, which is why `setNodeUseCase` DELETEs on null. So a blank
// cell means *clear the link if one exists*, and it is never written as a status.
//
// ROWS FOR INTERMEDIATE NODES ARE OPTIONAL. A row for `UHR > Onboarding > Riyadh
// Care` implies `UHR > Onboarding`, which is created if it is absent. Listing
// the intermediate explicitly is how you give it a kind or an Arabic name — and
// a person who lists every level and a person who lists only leaves must end up
// with the same tree. Both do; see `desiredNodes()`.
//
// AN EXPLICIT ROW IS AUTHORITATIVE FOR ITS OWN SEVEN FIELDS, blanks included.
// The contract fixes the meaning of a blank for three of them ("no Arabic name",
// "unassigned", "not recorded"), and applying a different rule to the other four
// would make the file mean two things at once. So a row whose `vendor` is blank
// CLEARS a vendor that is set in the app — and the plan prints that as
// `vendor: "Acme" -> (blank)` rather than burying it, because it is the one
// surprise in the contract. An IMPLIED node speaks about nothing and is never
// updated.
//
// THE FILE IS NOT AUTHORITATIVE FOR DELETION, and that asymmetry is deliberate.
// A node in the app that is missing from the file is REPORTED and left exactly
// as it is. Deleting by omission would mean a colleague who filters the
// spreadsheet, saves it, and hands it back silently archives half the workspace.
//
//
// ═══ WHAT THIS FILE DELIBERATELY DOES NOT DO ═══
//
// * IT CREATES NO TRACKS. A track carries a colour, a light-mode colour, an
//   icon, a group and a whole track×priority SLA matrix, none of which belong in
//   a spreadsheet column. A path naming a track that does not exist is a refusal
//   that says so and points at Settings › Tracks.
// * IT ARCHIVES AND DELETES NOTHING. Every action it can emit is a create, a
//   field update, or a use-case link set/cleared.
// * IT NEVER GUESSES A PERSON. An account manager matching no member is a
//   refusal; matching two is a refusal that NAMES BOTH. Silently preferring one
//   is how the wrong person ends up accountable for an organization.

// ── bidi ────────────────────────────────────────────────────────────────────
//
// Mirrored from src/lib/bidi.ts, which is TypeScript and cannot be imported from
// a `.mjs` script. Read that file for the full argument; the short version is
// that a path mixing Arabic and Latin REORDERS ITSELF on a terminal line unless
// each run is isolated, and a reader then approves a tree that is not the one
// being written.
//
// Two levels, and both are load-bearing:
//   LRI…PDI around the WHOLE path, because the path's own structure — `A > B > C`
//   — is left-to-right no matter what the names are.
//   FSI…PDI around EACH SEGMENT, because a segment's direction is a property of
//   the segment and is not known until it is read.

/** U+2066 — the run is left-to-right. src/lib/bidi.ts:LRI. */
export const LRI = '⁦'
/** U+2068 — the run takes the direction of its own first strong character. src/lib/bidi.ts:FSI. */
export const FSI = '⁨'
/** U+2069 — closes the innermost open isolate. src/lib/bidi.ts:PDI. */
export const PDI = '⁩'

/** One value, rendered by its own first strong character. */
export function isolate(value) {
  return value === '' || value === undefined || value === null ? '' : FSI + value + PDI
}

/** A path, as ONE left-to-right run of independently-isolated segments. */
export function formatPath(segments) {
  return LRI + segments.map((s) => isolate(String(s))).join(PATH_SEPARATOR) + PDI
}

// ── the shape of the file ───────────────────────────────────────────────────

/** ` > ` — space, greater-than, space. Surrounding whitespace is tolerated. */
export const PATH_SEPARATOR = ' > '

/** The seven fixed columns, in order. Everything after them is a use case. */
export const FIXED_COLUMNS = [
  'path',
  'name_ar',
  'kind',
  'account_manager',
  'vendor',
  'description',
  'description_ar',
]

/**
 * The three legal use-case cell values. THERE IS NO FOURTH AND BLANK IS NOT ONE
 * OF THEM — see the header, and src/types.ts:795.
 */
export const USE_CASE_STATUSES = ['planned', 'testing', 'live']

/**
 * How many map_nodes may sit below a track. SIX, and it is not this file's
 * choice: 0023's `map_nodes_check_tree()` is a DEFERRED constraint trigger that
 * raises `map_node_depth` at COMMIT. Refusing here, naming the offending path,
 * is the difference between "row 41 is seven deep" and a batch that half-lands
 * and then reports a uuid.
 */
export const MAX_NODE_DEPTH = 6

/** `map_nodes_name_len_chk` — 1..60 on the BTRIMMED value. */
export const MAX_NAME_LENGTH = 60

// ── text hygiene ────────────────────────────────────────────────────────────
//
// TRAP 5, AND IT IS THE ONE THAT COSTS AN AFTERNOON. A path pasted out of a web
// page, a Teams message or a PDF carries characters that are invisible in Excel
// and in a terminal and are NOT the characters they look like: U+00A0 no-break
// space instead of U+0020, U+200B zero-width space, U+200E/U+200F bidi marks,
// U+061C the Arabic letter mark, U+FEFF as a stray joiner. `'UHR '` does
// not equal `'UHR'`, so the track lookup fails — and "no such track" sends a
// person hunting for a track that is sitting right there on his screen.
//
// So: strip every Unicode FORMAT character (\p{Cf} — the same class
// src/lib/bidi.ts's stripInvisible() uses, and a strict superset of the isolate
// controls), fold every run of whitespace to one plain space, and trim. Then,
// when a lookup fails anyway, SAY WHAT WAS ODD ABOUT THE INPUT — see
// `describeOddCharacters()`. A refusal that reads "no track named `UHR ` (note
// the trailing space)" is fixable; "no such track" is not.

const INVISIBLE = /\p{Cf}/gu
// The same class WITHOUT /g, for testing one character. `RegExp.test` on a
// global regex advances `lastIndex` and the next call starts from there — an
// every-other-call-fails bug that looks like flakiness.
const INVISIBLE_ONE = /\p{Cf}/u

/**
 * Strip invisible format characters, fold whitespace runs, trim — and NORMALISE
 * TO NFC FIRST.
 *
 * ⚠ NFC IS NOT COSMETIC, IT DECIDES WHETHER A NAME MATCHES ITSELF. Arabic (and
 * anything else that carries marks) has two byte sequences for the same word:
 * composed (NFC) and decomposed (NFD). The app writes NFC — src/lib/text.ts
 * normalises on the way in — but a name pasted out of Finder, an older Mac app
 * or many PDFs arrives NFD. Postgres does NOT normalise either, so
 * `map_nodes_sibling_name_uidx` (`lower(btrim(name))`) does not catch it and the
 * INSERT SUCCEEDS: the map then draws two pixel-identical organizations, the
 * original still holding every use-case link and every entry filed against it,
 * and a new empty one that got this run's statuses. Nothing on any surface tells
 * them apart. One `.normalize('NFC')` is the whole defence.
 */
export function clean(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * The same, for FREE TEXT that may legitimately contain a newline — a
 * description typed into a quoted CSV field over three lines. Invisibles go and
 * the ends are trimmed; the internal shape is the author's business.
 *
 * CRLF IS FOLDED TO LF, and that one line is what keeps the dry run honest.
 * Excel writes `\r\n` inside a quoted field just as it does between records. A
 * surviving `\r` differs from what the app stored while PRINTING IDENTICALLY —
 * the plan would read `description: "line one/line two" -> "line one/line two"`
 * and he would approve a no-op that PATCHes a carriage return into the column.
 * Worse, it is permanently non-idempotent: every later dry run re-emits the same
 * invisible update, forever.
 */
export function cleanText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .trim()
}

/** The comparison key for a name. `map_nodes` is unique on `lower(btrim(name))`. */
export function nameKey(value) {
  return clean(value).toLowerCase()
}

const CHARACTER_NAMES = new Map([
  [' ', 'a non-breaking space (U+00A0)'],
  ['​', 'a zero-width space (U+200B)'],
  ['‌', 'a zero-width non-joiner (U+200C)'],
  ['‍', 'a zero-width joiner (U+200D)'],
  ['‎', 'a left-to-right mark (U+200E)'],
  ['‏', 'a right-to-left mark (U+200F)'],
  ['؜', 'an Arabic letter mark (U+061C)'],
  ['⁠', 'a word joiner (U+2060)'],
  ['﻿', 'a byte-order mark (U+FEFF)'],
  ['­', 'a soft hyphen (U+00AD)'],
  ['\t', 'a tab'],
])

/**
 * What was hiding in this cell, for a refusal message.
 *
 * ⚠ IT DOES NOT FLAG PLAIN SPACES, and the reason is worth stating because the
 * obvious version of this function does. The path separator is ` > ` — a space
 * on each side — so splitting `UHR > Onboarding` on `>` hands this function
 * `'UHR '`, and a naive "note the trailing space" fires on EVERY path segment in
 * every file, on every row. A note that is always printed is a note nobody
 * reads, and it would sit right beside the one that matters.
 *
 * `clean()` normalises both sides of every comparison, so an ordinary space can
 * never be the cause of a mismatch anyway. What CAN look like a space and is
 * not — U+00A0, U+200B, the bidi marks, a soft hyphen — is what this names, and
 * it is named as "here is what was in the cell", not as "here is why it failed",
 * because it was removed before the lookup ran.
 *
 * Returns '' when there was nothing invisible in the value.
 */
export function describeOddCharacters(raw) {
  const value = String(raw ?? '')
  const found = []
  for (const [ch, name] of CHARACTER_NAMES) {
    if (value.includes(ch)) found.push(name)
  }
  if (!found.length) {
    // Something in \p{Cf} we have no friendly name for. Name it by code point
    // rather than saying nothing — an unnamed U+2062 is still a lead.
    const odd = [...value].find((ch) => INVISIBLE_ONE.test(ch))
    if (odd) found.push(`U+${odd.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
  }
  if (!found.length) return ''
  return ` (the cell also held ${found.join(' and ')}, stripped before this lookup — if you pasted this from a web page, retype it)`
}

/**
 * TRAP 4 — Excel eats values that look like something else.
 *
 * A vendor called `1-2-3 Systems`, an org called `3-8 Clinic`, a use case cell
 * left as `1/2` — Excel's General format converts each of these to a DATE on
 * open, and if the file is then saved the conversion is what is on disk. Nothing
 * in a parser can undo that: by the time we see the file, `1-2-3 Systems` is
 * `2003-02-01` or `Feb 1` and both are perfectly valid strings.
 *
 * So this does the only useful thing: it FLAGS a value that looks date-shaped
 * where a name is expected, loudly, without refusing — because "2024 Systems" is
 * a real company and refusing it would be worse than the warning. The guide's
 * job is to say "format these columns as Text before you type"; this is the
 * backstop for the day somebody forgets.
 */
export function looksDateShaped(value) {
  const v = clean(value)
  if (!v) return false
  return (
    /^\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?$/u.test(v) ||
    /^\d{1,2}[-/ ](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*([-/ ]\d{2,4})?$/iu.test(v) ||
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ]\d{1,4}([-/ ]\d{2,4})?$/iu.test(v) ||
    // Excel's other favourite: a date that came back as its serial number.
    /^4[0-6]\d{3}$/u.test(v)
  )
}

// ── the CSV parser ──────────────────────────────────────────────────────────

/** A malformed CSV, with the line the trouble started on. */
export class CsvError extends Error {
  constructor(message, line) {
    super(message)
    this.name = 'CsvError'
    this.line = line
  }
}

/**
 * RFC 4180, and NOT `split(',')`.
 *
 * THIS IS THE PARSER THE WHOLE FILE FORMAT RESTS ON, so it is worth being
 * explicit about what `split(',')` would do instead of failing: nothing. A row
 * reading `UHR > OB > Ministry of Health, Riyadh,,Organization,…` becomes eight
 * fields where seven were meant, every column right of the comma shifts one to
 * the left, the row still imports, `Organization` lands in `account_manager`,
 * and the only symptom is a tree that is subtly wrong. There is no error to see.
 *
 * The three things a quoted field buys, all of which arrive from Excel and all
 * of which are tested:
 *   `"Ministry of Health, Riyadh"`  — a comma inside a field
 *   `"He said ""yes"""`             — a doubled quote is one literal quote
 *   `"line one\nline two"`          — a newline inside a field
 *
 * Plus the two shapes Excel produces that a hand-rolled parser usually misses:
 * CRLF line endings (trap 2), and a final line with no terminator at all.
 *
 * A LEADING BOM IS STRIPPED HERE (trap 1's second half). The templates are
 * WRITTEN with a BOM on purpose — without one Excel guesses the local ANSI
 * codepage and every Arabic name opens as mojibake, which is then what gets
 * saved. The cost is that the first header would otherwise read `﻿path`
 * and match nothing, so it is removed before anything else looks at the text.
 *
 * @param {string} text
 * @returns {{ cells: string[], line: number }[]} one record per row, with the
 *   1-based line the record STARTED on — which is not its index when a field
 *   contains a newline, and the line number is what a person greps for.
 */
export function parseCsv(text) {
  let src = String(text ?? '')
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)

  const records = []
  let cells = []
  let field = ''
  let quoted = false
  let touched = false // has this record any content at all?
  let line = 1
  let recordLine = 1
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      if (ch === '\n') line += 1
      field += ch
      i += 1
      continue
    }

    if (ch === '"' && field === '') {
      quoted = true
      touched = true
      i += 1
      continue
    }
    if (ch === ',') {
      cells.push(field)
      field = ''
      touched = true
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      // \r\n, \n and a lone \r all end one record. Excel writes the first.
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      cells.push(field)
      records.push({ cells, line: recordLine })
      cells = []
      field = ''
      touched = false
      line += 1
      recordLine = line
      i += 1
      continue
    }

    field += ch
    touched = true
    i += 1
  }

  if (quoted) {
    // C4's lesson, one file over: an unterminated quote otherwise swallows the
    // rest of the file into one field and reports success on a one-row import.
    throw new CsvError(
      `unterminated quoted field starting on line ${recordLine}: the file ends inside a "quoted" value. Check for a stray " and make sure every quote inside a quoted field is doubled ("").`,
      recordLine,
    )
  }
  // The final line, when the file does not end with a newline.
  if (touched || cells.length) {
    cells.push(field)
    records.push({ cells, line: recordLine })
  }

  return records
}

// ── the file, read into rows ────────────────────────────────────────────────

/**
 * Read the template into rows the planner can reason about.
 *
 * Structural problems only — a bad header, a ragged row, an illegal status, a
 * path that is too deep or too long. Anything that needs to know what the
 * WORKSPACE holds (does this track exist, is this a real member) belongs in
 * `planStructure` and is refused there.
 *
 * @returns {{ rows: object[], useCaseColumns: string[], refusals: object[] }}
 */
export function parseStructureCsv(text) {
  const refusals = []
  let records
  try {
    records = parseCsv(text)
  } catch (e) {
    if (e instanceof CsvError) {
      return { rows: [], useCaseColumns: [], refusals: [refuse('csv_malformed', e.line, e.message)] }
    }
    throw e
  }

  // Excel likes to leave trailing blank lines; a blank line anywhere is noise,
  // not a node.
  const meaningful = records.filter((r) => r.cells.some((c) => clean(c) !== ''))
  if (!meaningful.length) {
    return {
      rows: [],
      useCaseColumns: [],
      refusals: [refuse('csv_empty', 1, 'the file has no rows at all — not even a header.')],
    }
  }

  const header = meaningful[0]
  const headerCells = header.cells.map((c) => clean(c))

  // The seven fixed columns, in order and by name. A file whose columns have
  // been reordered is a file whose every row means something else, so this is a
  // refusal rather than a remap: remapping would quietly accept a file somebody
  // built by hand from a half-remembered spec.
  for (let i = 0; i < FIXED_COLUMNS.length; i += 1) {
    const want = FIXED_COLUMNS[i]
    const got = headerCells[i]
    if ((got ?? '').toLowerCase() !== want) {
      refusals.push(
        refuse(
          'header_columns',
          header.line,
          `column ${i + 1} of the header should be \`${want}\` and reads \`${got ?? '(missing)'}\`${describeOddCharacters(header.cells[i] ?? '')}. The first seven columns are fixed and ordered: ${FIXED_COLUMNS.join(', ')}. Start from docs/templates/structure.csv rather than rebuilding the header by hand.`,
        ),
      )
      return { rows: [], useCaseColumns: [], refusals }
    }
  }

  const useCaseColumns = []
  const seenColumn = new Map()
  for (let i = FIXED_COLUMNS.length; i < headerCells.length; i += 1) {
    const name = headerCells[i]
    if (name === '') {
      // A trailing empty header cell is Excel padding the row, not a column.
      // One with data under it is a column nobody named.
      const used = meaningful.slice(1).some((r) => clean(r.cells[i] ?? '') !== '')
      if (used) {
        refusals.push(
          refuse('header_blank', header.line, `column ${i + 1} has no name but has values under it.`),
        )
      }
      useCaseColumns.push(null)
      continue
    }
    const prior = seenColumn.get(name.toLowerCase())
    if (prior !== undefined) {
      refusals.push(
        refuse(
          'header_duplicate',
          header.line,
          `the use-case column \`${name}\` appears twice, at columns ${prior + 1} and ${i + 1}. Two columns for one capability cannot both be right.`,
        ),
      )
    } else {
      seenColumn.set(name.toLowerCase(), i)
    }
    useCaseColumns.push(name)
  }

  const rows = []
  for (const record of meaningful.slice(1)) {
    // ═══ EVERY ROW HAS EXACTLY THE HEADER'S FIELD COUNT. BOTH DIRECTIONS. ═══
    //
    // TOO MANY is the `split(',')` symptom arriving through a file somebody
    // edited outside Excel: an unquoted comma. The row would otherwise import
    // into shifted columns with no signal at all.
    //
    // TOO FEW used to be tolerated as "Excel omitting trailing empties" — and
    // that tolerance was two silent-corruption holes wearing one coat:
    //
    //   1. IT DID NOT CATCH THE SHIFT ON A SPARSE ROW. The use-case matrix is
    //      mostly blank, so a row with an unquoted comma in `vendor` still comes
    //      out SHORTER than the header: `…,Mirqab Integration Co., Riyadh,,,live`
    //      is 9 fields against 17. Zero refusals, `Riyadh` filed as the
    //      description, and `live` relocated from ADT to Medication Prescribe V1.
    //      The tree printed plausibly. This is exactly the failure the RFC 4180
    //      parser exists to prevent, arriving through the back door.
    //   2. IT MANUFACTURED AUTHORITATIVE BLANKS. `record.cells[i] ?? ''` cannot
    //      tell "the cell is empty" from "the cell is not there", and an empty
    //      cell on an explicit row CLEARS the field. So the one-cell row
    //      `UHR > Riyadh Care` — a hand edit, a merge artifact — wiped name_ar,
    //      both descriptions, the vendor, the kind and the account manager, and
    //      deleted every use-case link on the node.
    //
    // Nothing in a field count can tell those apart from a legitimately short
    // row, so the count has to be exact. This costs nothing on the path that
    // matters: Excel and Google Sheets both write every field of every row in the
    // used range — the shipped template and example are 17 fields on every line,
    // verified — and a person who deletes a use-case column deletes it from the
    // header too, which moves both sides together.
    if (record.cells.length !== headerCells.length) {
      const wide = record.cells.length > headerCells.length
      const lastIsEmpty = clean(record.cells[record.cells.length - 1] ?? '') === ''
      refusals.push(
        refuse(
          wide ? 'row_too_wide' : 'row_too_narrow',
          record.line,
          `${record.cells.length} fields where the header has ${headerCells.length}. ` +
            (wide
              ? lastIsEmpty
                ? 'If the line ends in a stray extra comma, delete it. Otherwise a comma inside a value has to be quoted: "Ministry of Health, Riyadh".'
                : 'A comma inside a value has to be quoted: "Ministry of Health, Riyadh" — an unquoted one shifts every column to its right into the wrong field.'
              : 'Every row needs the same number of commas as the header; a blank cell is still a comma. A short row is either a hand edit that dropped the trailing commas — re-save it from Excel and it comes back — or an unquoted comma that swallowed a column. Either way the values would land in the wrong fields, and the blanks it invents would CLEAR whatever those fields hold today.'),
        ),
      )
      continue
    }
    const at = (i) => record.cells[i] ?? ''

    const rawPath = at(0)
    const row = {
      line: record.line,
      rawPath,
      segments: rawPath
        .split('>')
        .map((s) => clean(s))
        // A path is `A > B > C`; `A > B > ` is a trailing separator Excel or a
        // hand edit left behind, and dropping ONLY a trailing blank is safe.
        // A blank in the middle is a missing name and is refused below.
        .filter((s, idx, all) => !(s === '' && idx === all.length - 1)),
      rawSegments: rawPath.split('>'),
      nameAr: clean(at(1)),
      kind: clean(at(2)),
      accountManager: clean(at(3)),
      vendor: clean(at(4)),
      description: cleanText(at(5)),
      descriptionAr: cleanText(at(6)),
      cells: [],
      // EVERY use-case column this row sat under, valid cell or not.
      //
      // `cells` holds only the ones that parsed, and `planStructure` used to
      // derive the column list from it — so a column whose EVERY cell was
      // refused (an `Outstanding issue` column full of prose) never reached the
      // catalogue check at all, and the one message that names the real problem
      // could not fire. The column list has to survive its own bad cells.
      columns: [],
    }

    for (let i = FIXED_COLUMNS.length; i < headerCells.length; i += 1) {
      const column = useCaseColumns[i - FIXED_COLUMNS.length]
      if (column === null) continue
      row.columns.push(column)
      const raw = at(i)
      const value = clean(raw).toLowerCase()
      if (value !== '' && !USE_CASE_STATUSES.includes(value)) {
        // ⚠ TAGGED WITH ITS COLUMN, and that tag is load-bearing.
        //
        // The commonest way to hit this refusal is not a mistyped status at all
        // — it is a column of your own. Aziz's stated requirement per
        // Organization is "Account Manager, Use cases integrated, outstanding
        // issue", so an `Outstanding issue` column with `Waiting on vendor` in it
        // is the natural thing to add. Every row then fails HERE, nine times,
        // saying "write one of planned, testing, live" — while the one message
        // that names the real problem (`no use case named 'Outstanding issue'`)
        // is only reachable in `planStructure`, which knows the catalogue. Read
        // nine copies of the wrong message and you conclude the app wants a
        // status in your notes column.
        //
        // `mergeRefusals()` drops these once the column has been refused as an
        // unknown capability. See it, and `planStructure`'s `unknownColumns`.
        refusals.push({
          ...refuse(
            'status_unknown',
            record.line,
            `\`${clean(raw)}\`${describeOddCharacters(raw)} is not a use-case status, under \`${column}\` on ${describePath(row.segments)}. Write one of ${USE_CASE_STATUSES.join(', ')} — or leave the cell BLANK, which clears the link. Blank is not a fourth status; it is the absence of the row.`,
          ),
          column,
        })
        continue
      }
      row.cells.push({ column, status: value === '' ? null : value, raw })
    }

    // ── the path, checked against what the database will accept ──
    if (!row.segments.length || row.segments.every((s) => s === '')) {
      refusals.push(refuse('path_empty', record.line, 'the `path` cell is empty, so this row is about nothing.'))
      continue
    }
    if (row.segments.length === 1) {
      refusals.push(
        refuse(
          'path_track_only',
          record.line,
          `${describePath(row.segments)} names a track and nothing else. The first segment is the TRACK; a row has to name at least one node beneath it.`,
        ),
      )
      continue
    }
    const blankAt = row.segments.findIndex((s) => s === '')
    if (blankAt !== -1) {
      refusals.push(
        refuse(
          'path_segment_empty',
          record.line,
          `segment ${blankAt + 1} of \`${rawPath}\` is empty — two separators with nothing between them.`,
        ),
      )
      continue
    }
    const nodeDepth = row.segments.length - 1
    if (nodeDepth > MAX_NODE_DEPTH) {
      refusals.push(
        refuse(
          'path_too_deep',
          record.line,
          `${describePath(row.segments)} puts a node ${nodeDepth} levels below its track, and 0023 caps the map at ${MAX_NODE_DEPTH}. The database would refuse this at COMMIT, in the middle of the batch, with a uuid instead of a path.`,
        ),
      )
      continue
    }
    const tooLong = row.segments.find((s) => s.length > MAX_NAME_LENGTH)
    if (tooLong) {
      refusals.push(
        refuse(
          'name_too_long',
          record.line,
          `\`${tooLong}\` is ${tooLong.length} characters and \`map_nodes_name_len_chk\` allows ${MAX_NAME_LENGTH}.`,
        ),
      )
      continue
    }
    if (row.nameAr.length > MAX_NAME_LENGTH) {
      refusals.push(
        refuse(
          'name_ar_too_long',
          record.line,
          `the Arabic name on ${describePath(row.segments)} is ${row.nameAr.length} characters and \`map_nodes_name_ar_len_chk\` allows ${MAX_NAME_LENGTH}.`,
        ),
      )
      continue
    }

    rows.push(row)
  }

  return { rows, useCaseColumns: useCaseColumns.filter((c) => c !== null), refusals }
}

// ── the planner ─────────────────────────────────────────────────────────────

/**
 * Decide what would have to happen, given the file and a snapshot of the
 * workspace. NO I/O. Deterministic. The dry run and the apply both call this,
 * once, and the apply executes the list this returned — which is what makes the
 * printed plan a promise rather than an estimate.
 *
 * @param {object} input
 * @param {object[]} input.rows            from `parseStructureCsv`
 * @param {object[]} input.tracks          `{ id, name, name_ar, archived }`
 * @param {object[]} input.nodes           `map_nodes` rows, each optionally carrying
 *                                         `map_node_use_cases: [{ use_case_id, status }]`
 *                                         — PostgREST returns exactly that shape from
 *                                         `select=*,map_node_use_cases(use_case_id,status)`.
 * @param {object[]} input.kinds           `{ id, name }`
 * @param {object[]} input.members         `{ id, display_name, username, email }`
 * @param {object[]} input.useCases        `{ id, name, sort_order }`
 * @param {boolean}  [input.addUseCases]   `--add-use-cases`: create unknown columns
 *                                         instead of refusing them.
 * @returns {{ actions: object[], refusals: object[], notes: object[], summary: object }}
 */
export function planStructure({
  rows = [],
  tracks = [],
  nodes = [],
  kinds = [],
  members = [],
  useCases = [],
  addUseCases = false,
} = {}) {
  const refusals = []
  const notes = []
  const actions = []

  // ── lookups ──
  const trackByName = indexBy(tracks, (t) => nameKey(t.name))
  const trackByNameAr = indexBy(
    tracks.filter((t) => clean(t.name_ar) !== ''),
    (t) => nameKey(t.name_ar),
  )
  const kindByName = indexBy(kinds, (k) => nameKey(k.name))
  const useCaseByName = indexBy(useCases, (u) => nameKey(u.name))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const memberById = new Map(members.map((m) => [m.id, m]))

  // ── every existing node, keyed by its full path ──
  //
  // MATCHED ON THE FULL PATH, and case-insensitively on the btrimmed name —
  // which is not a nicety, it is `map_nodes_sibling_name_uidx`
  // (`lower(btrim(name))`, nulls not distinct). Matching any other way would let
  // a second run "create" a node the database then rejects as a duplicate, and
  // the whole re-runnability property would be a coin toss.
  const existingByKey = new Map()
  const existingPath = new Map()
  for (const node of nodes) {
    const segments = pathOf(node, nodeById, tracks)
    if (!segments) continue // orphaned by a track we cannot see; nothing to say
    existingPath.set(node.id, segments)
    existingByKey.set(keyOf(node.track_id, segments.slice(1)), node)
  }

  // ── the use-case columns ──
  // FROM `row.columns`, NOT `row.cells` — a column whose every cell was refused
  // still has to reach the catalogue check, or the only message printed is the
  // one about the cells. See `row.columns` in the parser.
  const columnNames = []
  for (const row of rows) {
    for (const column of row.columns ?? row.cells.map((c) => c.column)) {
      if (!columnNames.includes(column)) columnNames.push(column)
    }
  }
  const columnToUseCase = new Map()
  const createdUseCases = new Map()
  let nextUseCaseSort = useCases.reduce((max, u) => Math.max(max, Number(u.sort_order) || 0), 0)
  for (const column of columnNames) {
    const found = useCaseByName.get(nameKey(column))
    if (found && found.length === 1) {
      columnToUseCase.set(column, found[0])
      continue
    }
    if (found && found.length > 1) {
      refusals.push(
        refuse(
          'use_case_ambiguous',
          null,
          `the column \`${column}\` matches ${found.length} use cases in the catalogue. Rename one in Settings › Catalogue.`,
        ),
      )
      continue
    }
    if (addUseCases) {
      nextUseCaseSort += 1
      const pending = { id: null, name: column, sort_order: nextUseCaseSort, pending: true }
      createdUseCases.set(column, pending)
      columnToUseCase.set(column, pending)
      actions.push({
        kind: 'create-use-case',
        name: column,
        sortOrder: nextUseCaseSort,
      })
      continue
    }
    // ⚠ THE NEAREST MATCH COMES FIRST, AND `--add-use-cases` COMES LAST, WITH
    // ITS PRICE ATTACHED.
    //
    // The column somebody actually types is `Radiolegy Report` — that is Aziz's
    // own spelling, in his own message. Offering `--add-use-cases` as an equal
    // alternative to fixing the header invites him to write the typo into the
    // live catalogue, and 0024 makes `use_cases` `ON DELETE RESTRICT` the moment
    // one organization links to it: a junk capability cannot then be deleted, only
    // hidden. So the suggestion leads and the flag is a second sentence that says
    // what it costs.
    const near = nearestName(column, useCases.map((u) => u.name))
    refusals.push({
      ...refuse(
        'use_case_unknown',
        null,
        `no use case named \`${column}\`${describeOddCharacters(column)}.${near ? ` Did you mean \`${near}\`?` : ''} The catalogue holds: ${useCases.map((u) => u.name).join(', ') || '(nothing)'}. Fix the header to match one of those exactly. \`--add-use-cases\` would instead CREATE this column as a new capability — permanently: once one organization is recorded against it, 0024's \`on delete restrict\` means it can be hidden but never deleted.`,
      ),
      column,
    })
  }
  const unknownColumns = refusals.filter((r) => r.code === 'use_case_unknown').map((r) => r.column)

  // ── resolve each row's track, and refuse the rows we cannot place ──
  const placed = []
  const seenPath = new Map()
  const touchedTracks = new Map()
  for (const row of rows) {
    const rawTrack = row.rawSegments[0] ?? ''
    const trackName = row.segments[0]
    const byName = trackByName.get(nameKey(trackName)) ?? []
    const byAr = trackByNameAr.get(nameKey(trackName)) ?? []
    const found = byName.length ? byName : byAr

    if (!found.length) {
      refusals.push(
        refuse(
          'track_missing',
          row.line,
          `no track named \`${trackName}\`${describeOddCharacters(rawTrack)}. This script does NOT create tracks — a track carries a colour, a light-mode colour, an icon, a group and an SLA matrix, none of which belong in this file. Make it in Settings › Tracks first. Tracks that exist: ${tracks.map((t) => t.name).join(', ') || '(none)'}.`,
        ),
      )
      continue
    }
    if (found.length > 1) {
      refusals.push(
        refuse(
          'track_ambiguous',
          row.line,
          `\`${trackName}\` matches ${found.length} tracks (${found.map((t) => t.id).join(', ')}). Rename one in Settings › Tracks.`,
        ),
      )
      continue
    }
    const track = found[0]
    if (track.archived) {
      refusals.push(
        refuse(
          'track_archived',
          row.line,
          `the track \`${track.name}\` is ARCHIVED. Restore it in Settings › Tracks before importing anything beneath it — a node hanging off an archived track is invisible on the map.`,
        ),
      )
      continue
    }
    if (byName.length === 0 && byAr.length === 1) {
      notes.push(
        note(
          'track_matched_ar',
          `line ${row.line}: \`${trackName}\` matched the ARABIC name of the track \`${track.name}\`.`,
        ),
      )
    }
    touchedTracks.set(track.id, track)

    const nodeSegments = row.segments.slice(1)
    const key = keyOf(track.id, nodeSegments)
    const prior = seenPath.get(key)
    if (prior) {
      refusals.push(
        refuse(
          'duplicate_path',
          row.line,
          `${describePath(row.segments)} appears on line ${prior.line} as well. One row per node — two rows for one node cannot both be applied, and which one won would depend on the order of the file.`,
        ),
      )
      continue
    }
    seenPath.set(key, row)
    placed.push({ row, track, nodeSegments, key })

    // ── TRAP 5's OTHER HALF: SAY SO WHEN A REPAIR CHANGED WHICH NODE THIS IS ──
    //
    // `clean()` strips every \p{Cf}, and that is right — it is what lets a path
    // pasted out of a web page still find its track. But the repair is silent,
    // and when the repaired path matches nothing the planner simply CREATES a
    // node and says nothing at all. A zero-width space is the bad case: it is
    // DELETED rather than turned into a space, so `Riyadh​Care` becomes
    // `RiyadhCare` — a new organization whose name has no space in it, beside the
    // real one, with no refusal and nothing in the printout to notice.
    //
    // The brief's requirement is "SAY in the refusal when that is what happened";
    // the refusal path was implemented and this one was not. It is compared
    // against a whitespace-only normalisation rather than the raw string, because
    // every segment of every path arrives with a space beside the ` > ` separator
    // and a note that fires on every row is a note nobody reads.
    for (const rawSegment of row.rawSegments) {
      const cleaned = clean(rawSegment)
      const whitespaceOnly = String(rawSegment).normalize('NFC').replace(/\s+/gu, ' ').trim()
      if (cleaned === whitespaceOnly) continue
      notes.push(
        note(
          'repaired_path',
          `line ${row.line}: a segment of this path was repaired before it was matched — \`${whitespaceOnly}\` was read as ${isolate(cleaned)}${describeOddCharacters(rawSegment)}. Check that it names the node you meant: a zero-width character is DELETED, which joins the two words either side of it.`,
        ),
      )
    }
  }

  // ── the desired tree: explicit rows, plus every ancestor they imply ──
  //
  // An ancestor that HAS a row of its own keeps that row — that is how a person
  // gives an intermediate node a kind or an Arabic name. An ancestor with no row
  // is IMPLIED: created if absent, and never updated, because it speaks about
  // nothing. Listing every level and listing only leaves therefore produce the
  // same tree, which is the property the file contract promises.
  const desired = new Map()
  placed.forEach((entry, fileIndex) => {
    for (let depth = 1; depth <= entry.nodeSegments.length; depth += 1) {
      const segments = entry.nodeSegments.slice(0, depth)
      const key = keyOf(entry.track.id, segments)
      const explicit = depth === entry.nodeSegments.length
      const already = desired.get(key)
      if (already && !(explicit && already.implied)) continue
      desired.set(key, {
        key,
        track: entry.track,
        segments,
        fullSegments: [entry.track.name, ...segments],
        depth,
        implied: !explicit,
        row: explicit ? entry.row : null,
        parentKey: depth > 1 ? keyOf(entry.track.id, segments.slice(0, depth - 1)) : null,
        // Where this node FIRST appeared in the file — its own row, or the row
        // of the first leaf that implied it. It is what `sort_order` is assigned
        // from, so the sequence he typed is the sequence the map draws.
        fileIndex: already ? already.fileIndex : fileIndex,
      })
    }
  })

  // ── ORDERING IS LOAD-BEARING ──
  //
  // Parents before children, ALWAYS: a child created first has no parent to
  // point at, and `map_nodes_derive_track()` raises `map_node_missing` rather
  // than guessing. Sorting by depth is what guarantees it, and it is stated here
  // rather than left to fall out of the iteration order of a Map.
  //
  // WITHIN a depth, FILE ORDER — because that is what `sort_order` is assigned
  // from below, and the order he typed his organizations in is the order he
  // expects to read them off the map. Nothing about correctness depends on it;
  // everything about recognising your own list does.
  const ordered = [...desired.values()].sort((a, b) => a.depth - b.depth || a.fileIndex - b.fileIndex)

  // ── TWO SIBLINGS CANNOT SHARE AN ARABIC NAME. REFUSE IT HERE, NOT IN POSTGRES ──
  //
  // 0023 carries `map_nodes_sibling_name_ar_uidx` — unique on
  // `(track_id, parent_id, lower(btrim(name_ar)))`, `nulls not distinct`, PARTIAL
  // on `btrim(name_ar) <> ''`. Only the LENGTH of `name_ar` was checked anywhere,
  // so two organizations under one parent both called `عيادة الروضة` produced a
  // plan with ZERO refusals — and then a 23505 from inside the apply, which is a
  // sequence of REST calls and not a transaction. Every create at one depth goes
  // out as a SINGLE POST, so the violation kills that whole depth and everything
  // below it, while the shallower depths are already written. With nine
  // organizations carrying Arabic names a collision is ordinary, not exotic.
  //
  // This is the same argument that pulled the depth cap and the name-length check
  // forward into the parser: the database's own refusal arrives too late to be
  // readable and too late to be atomic.
  //
  // CHECKED AGAINST THE APP TOO, not just row-against-row. And deliberately
  // strict about the swap case (A gives up `X`, B takes it in the same file):
  // the apply writes creates before updates, so the moment B is inserted A still
  // holds `X`. The message says to do that one in the app.
  {
    const arSlot = new Map()
    const slotKey = (parentKey, ar) => `${parentKey}${KEY_SEPARATOR}${nameKey(ar)}`
    for (const node of nodes) {
      const segments = existingPath.get(node.id)
      if (!segments) continue
      const ar = clean(node.name_ar ?? '')
      if (!ar) continue
      arSlot.set(slotKey(keyOf(node.track_id, segments.slice(1, -1)), ar), {
        key: keyOf(node.track_id, segments.slice(1)),
        label: `${describePath(segments)} (already in the app)`,
      })
    }
    for (const want of ordered) {
      if (!want.row || !want.row.nameAr) continue
      const slot = slotKey(want.parentKey ?? keyOf(want.track.id, []), want.row.nameAr)
      const prior = arSlot.get(slot)
      if (prior && prior.key !== want.key) {
        refusals.push(
          refuse(
            'duplicate_sibling_name_ar',
            want.row.line,
            `the Arabic name ${isolate(want.row.nameAr)} is already taken under the same parent by ${prior.label}. \`map_nodes_sibling_name_ar_uidx\` in 0023 makes two siblings with one Arabic name impossible, and the apply is a sequence of writes rather than one transaction — so this would land as a database error partway through, with some of the file already written. Give one of them a different Arabic name, or clear one. (Swapping two Arabic names between existing nodes has to be done in the app: this import writes every create before any update.)`,
          ),
        )
        continue
      }
      if (!prior) {
        arSlot.set(slot, { key: want.key, label: `${describePath(want.fullSegments)} (line ${want.row.line})` })
      }
    }
  }

  // Sort order is assigned per parent so that FILE ORDER BECOMES MAP ORDER: the
  // sequence he typed is the sequence he sees. Existing siblings keep theirs and
  // new ones land after them, exactly as `nextSortOrder()` does in src/api/map.ts.
  const nextSort = new Map()
  const sortSeed = (parentKey) => {
    if (nextSort.has(parentKey)) return nextSort.get(parentKey)
    let max = 0
    for (const node of nodes) {
      const segments = existingPath.get(node.id)
      if (!segments) continue
      const nodeParentKey =
        segments.length > 2 ? keyOf(node.track_id, segments.slice(1, -1)) : keyOf(node.track_id, [])
      if (nodeParentKey === parentKey) max = Math.max(max, Number(node.sort_order) || 0)
    }
    nextSort.set(parentKey, max)
    return max
  }

  const plannedNodeKeys = new Set(desired.keys())
  // A node whose kind or account manager could not be resolved. It is refused,
  // so nothing will be applied at all — but emitting its use-case links too
  // would bury the one refusal that matters under a page of consequences.
  const unresolved = new Set()
  for (const want of ordered) {
    const existing = existingByKey.get(want.key)
    const name = want.segments[want.segments.length - 1]
    const parentKeyForSort = want.parentKey ?? keyOf(want.track.id, [])

    // The seven fields the file speaks about, resolved. An implied node speaks
    // about nothing and gets the column defaults.
    const fields = want.row
      ? resolveFields(want.row, { kindByName, members, refusals })
      : { name_ar: '', kind_id: null, kindName: '', account_manager_id: null, amLabel: '', amMatchedBy: '', vendor: '', description: '', description_ar: '' }
    if (fields === null) {
      // A refusal was recorded; this node cannot be placed.
      unresolved.add(want.key)
      continue
    }

    if (!existing) {
      const seed = sortSeed(parentKeyForSort) + 1
      nextSort.set(parentKeyForSort, seed)
      actions.push({
        kind: 'create-node',
        key: want.key,
        path: want.fullSegments,
        depth: want.depth,
        line: want.row ? want.row.line : null,
        implied: want.implied,
        trackId: want.track.id,
        trackName: want.track.name,
        parentKey: want.parentKey,
        name,
        sortOrder: seed,
        values: fields,
      })
      continue
    }

    if (want.implied) {
      // It exists and the file says nothing about it. Nothing to do — and
      // saying nothing is the correct amount to say.
      if (existing.archived) {
        notes.push(
          note(
            'archived_ancestor',
            `${describePath(want.fullSegments)} exists but is ARCHIVED, and its subtree is hidden on the map. Nothing in this file restores it — do that in the app.`,
          ),
        )
      }
      continue
    }

    const changes = diffFields(existing, fields, { memberById, kinds })
    if (existing.archived) {
      notes.push(
        note(
          'archived_node',
          `${describePath(want.fullSegments)} exists but is ARCHIVED. This import ${changes.length ? 'updates its fields and ' : ''}leaves it archived — restoring is a decision for the app, not a spreadsheet.`,
        ),
      )
    }
    if (changes.length) {
      actions.push({
        kind: 'update-node',
        key: want.key,
        path: want.fullSegments,
        depth: want.depth,
        line: want.row.line,
        nodeId: existing.id,
        trackName: want.track.name,
        name,
        changes,
      })
    }
  }

  // ── the use-case matrix ──
  //
  // BLANK CLEARS. Every column of every explicit row is considered, because the
  // absence of a status is a statement — see the header and src/types.ts:795.
  for (const entry of placed) {
    const want = desired.get(entry.key)
    if (!want || want.row !== entry.row) continue
    if (unresolved.has(entry.key)) continue
    const existing = existingByKey.get(entry.key)
    const links = new Map(
      (existing?.map_node_use_cases ?? []).map((l) => [l.use_case_id, l.status]),
    )
    for (const cell of entry.row.cells) {
      const useCase = columnToUseCase.get(cell.column)
      if (!useCase) continue // an unknown column: already refused above
      const current = useCase.id === null ? undefined : links.get(useCase.id)
      if (cell.status === null) {
        if (current === undefined) continue // nothing there, nothing to clear
        actions.push({
          kind: 'clear-use-case',
          key: entry.key,
          path: want.fullSegments,
          depth: want.depth,
          line: entry.row.line,
          nodeId: existing ? existing.id : null,
          useCase: useCase.name,
          useCaseId: useCase.id,
          from: current,
        })
        continue
      }
      if (current === cell.status) continue // already says exactly this
      actions.push({
        kind: 'set-use-case',
        key: entry.key,
        path: want.fullSegments,
        depth: want.depth,
        line: entry.row.line,
        nodeId: existing ? existing.id : null,
        useCase: useCase.name,
        useCaseId: useCase.id,
        status: cell.status,
        from: current ?? null,
      })
    }
  }

  // ── what exists here and is not in the file ──
  //
  // A NOTE. NEVER AN ACTION. See the header: deleting by omission turns a
  // colleague's filtered save into a silent archive of half the workspace.
  // Scoped to the tracks this file actually touches, because listing every node
  // under six untouched tracks is noise that trains a reader to skip the block.
  for (const node of nodes) {
    const segments = existingPath.get(node.id)
    if (!segments) continue
    if (!touchedTracks.has(node.track_id)) continue
    if (plannedNodeKeys.has(keyOf(node.track_id, segments.slice(1)))) continue
    notes.push(note('not_in_file', describePath(segments), segments))
  }

  // ── the date-shaped warning (trap 4) ──
  for (const entry of placed) {
    const suspects = [
      ['the last path segment', entry.nodeSegments[entry.nodeSegments.length - 1]],
      ['vendor', entry.row.vendor],
      ['account_manager', entry.row.accountManager],
    ]
    for (const [what, value] of suspects) {
      if (looksDateShaped(value)) {
        notes.push(
          note(
            'date_shaped',
            `line ${entry.row.line}: ${what} reads \`${clean(value)}\`, which is date-shaped. Excel converts values like \`1-2-3 Systems\` to a date on open and writes the date back on save. If that really is the name, ignore this; if it is not, format the column as Text and retype it.`,
          ),
        )
      }
    }
  }

  // ── "THIS LOOKS LIKE A MOVE, AND THIS IMPORTER CANNOT MOVE THINGS" ──
  //
  // A node is matched on its FULL PATH, so re-parenting an organization in the
  // spreadsheet is not a move — it is a CREATE of a second node with the same
  // name under the new parent, carrying this run's use-case statuses, while the
  // original keeps its links, its account manager and every entry ever filed
  // against it. The plan does print both halves, but nothing connects them, and
  // the `not_in_file` block's own header reads "NOTHING BELOW IS TOUCHED" —
  // reassurance at the exact moment it is the warning.
  //
  // A restructure is *why* he owns these six departments, so this is the edit he
  // is most likely to make. One note, naming both paths.
  {
    const unclaimed = []
    for (const node of nodes) {
      const segments = existingPath.get(node.id)
      if (!segments) continue
      if (plannedNodeKeys.has(keyOf(node.track_id, segments.slice(1)))) continue
      unclaimed.push({ node, segments })
    }
    for (const a of actions) {
      if (a.kind !== 'create-node') continue
      const hits = unclaimed.filter(
        (u) => u.node.track_id === a.trackId && nameKey(u.segments[u.segments.length - 1]) === nameKey(a.name),
      )
      if (hits.length !== 1) continue
      notes.push(
        note(
          'looks_like_a_move',
          `${describePath(hits[0].segments)} already exists and ${describePath(a.path)} would be CREATED — same name, different parent. If you moved this node in the spreadsheet, that is not what will happen: a node is identified by its whole path, so you would get TWO of them, and the original keeps its use-case links, its account manager and every entry filed against it. Move it in the app, then match the file to where it ended up.`,
        ),
      )
    }
  }

  // ── VENDORS, ROLLED UP, BECAUSE THE FILTER GROUPS ON THE EXACT STRING ──
  //
  // He asked for this column so he can "filter them out as per the vendor".
  // `vendor` is free text, trimmed but not folded (src/api/map.ts), so
  // `Mirqab Integration Co.` and `Mirqab Integration Co., Riyadh` are two
  // vendors in every filter, forever, and re-running the file does not converge
  // them because both spellings are legal. Nothing else in the plan would show
  // that: vendor is printed per node and never counted.
  //
  // So: the distinct vendors with their counts, and a note when two of them are
  // suspiciously close — the same string in different case, or one a prefix of
  // the other, which is exactly the `…, Riyadh` shape.
  const vendorCounts = new Map()
  for (const entry of placed) {
    if (!entry.row.vendor) continue
    const existing = vendorCounts.get(entry.row.vendor)
    vendorCounts.set(entry.row.vendor, (existing ?? 0) + 1)
  }
  const vendors = [...vendorCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (let i = 0; i < vendors.length; i += 1) {
    for (let j = i + 1; j < vendors.length; j += 1) {
      const a = nameKey(vendors[i].name)
      const b = nameKey(vendors[j].name)
      const close = a === b || a.startsWith(b) || b.startsWith(a)
      if (!close) continue
      notes.push(
        note(
          'vendor_near_duplicate',
          `two vendor spellings in this file are nearly the same: ${isolate(vendors[i].name)} and ${isolate(vendors[j].name)}. Filtering by vendor groups on the EXACT string, so these would be two entries in the list rather than one integrator. Pick one spelling and use it on every row.`,
        ),
      )
    }
  }

  actions.sort(compareActions)

  const summary = {
    rows: rows.length,
    vendors,
    create: actions.filter((a) => a.kind === 'create-node').length,
    createImplied: actions.filter((a) => a.kind === 'create-node' && a.implied).length,
    update: actions.filter((a) => a.kind === 'update-node').length,
    setLinks: actions.filter((a) => a.kind === 'set-use-case').length,
    clearLinks: actions.filter((a) => a.kind === 'clear-use-case').length,
    newUseCases: actions.filter((a) => a.kind === 'create-use-case').length,
    refusals: refusals.length,
    notInFile: notes.filter((n) => n.kind === 'not_in_file').length,
  }

  return { actions, refusals, notes, summary, unknownColumns }
}

/**
 * THE ONE REFUSAL LIST, with the consequences of another refusal removed.
 *
 * `parseStructureCsv` cannot know the catalogue, so it validates every cell
 * under every column — including a column of your own that is not a capability
 * at all. `planStructure` is the half that knows, and it refuses that column BY
 * NAME. Printed together, the useless message is on every row and the useful one
 * is on none of them.
 *
 * So: a `status_unknown` under a column that was itself refused as an unknown
 * capability is DROPPED. Both halves keep their own logic; the reader gets the
 * sentence that names the actual problem.
 */
export function mergeRefusals(parseRefusals = [], plan = {}) {
  const unknown = new Set((plan.unknownColumns ?? []).filter(Boolean).map((c) => nameKey(c)))
  const kept = parseRefusals.filter((r) => !(r.column && unknown.has(nameKey(r.column))))
  return [...kept, ...(plan.refusals ?? [])]
}

/**
 * The closest catalogue name to what was typed, or '' when nothing is close.
 *
 * Levenshtein, capped at a third of the length, because the refusal it feeds is
 * read by somebody who typed `Radiolegy Report` and needs to be told
 * `Radiology Report` rather than handed the whole catalogue and left to spot the
 * difference. A suggestion that fires on anything is worse than none: it would
 * offer `Lab Order` for `Outstanding issue`, which sends a reader down a path
 * that does not exist.
 */
export function nearestName(value, candidates) {
  const needle = nameKey(value)
  if (!needle) return ''
  let best = ''
  let bestScore = Infinity
  for (const candidate of candidates) {
    const d = editDistance(needle, nameKey(candidate))
    if (d < bestScore) {
      bestScore = d
      best = candidate
    }
  }
  const limit = Math.max(1, Math.floor(needle.length / 3))
  return bestScore <= limit ? best : ''
}

function editDistance(a, b) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

// ── ordering ────────────────────────────────────────────────────────────────

/**
 * THE ORDER THE APPLY EXECUTES IN, stated once and used by both halves.
 *
 *   1. create-use-case  — a link cannot name a capability that does not exist.
 *   2. create-node / update-node, SHALLOWEST FIRST — a child created before its
 *      parent has nothing to point at, and 0023's derive trigger raises
 *      `map_node_missing` rather than inventing one.
 *   3. set-use-case / clear-use-case — every node they name exists by now.
 *
 * Within a rank, by path, so two runs of the same file print the same lines in
 * the same order and a diff of two plans is readable.
 */
export function compareActions(a, b) {
  const rank = (x) =>
    x.kind === 'create-use-case' ? 0 : x.kind === 'create-node' || x.kind === 'update-node' ? 1 : 2
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  if (rank(a) === 0) return a.sortOrder - b.sortOrder
  if (rank(a) === 1 && a.depth !== b.depth) return a.depth - b.depth
  const byPath = comparePaths(a.path ?? [], b.path ?? [])
  if (byPath !== 0) return byPath
  return String(a.useCase ?? '').localeCompare(String(b.useCase ?? ''))
}

/** Segment by segment, so `A > B` sorts before `AB` rather than inside it. */
export function comparePaths(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const c = String(a[i]).localeCompare(String(b[i]))
    if (c !== 0) return c
  }
  return a.length - b.length
}

// ── the printout ────────────────────────────────────────────────────────────

/**
 * THE PRINTOUT IS THE PRODUCT. He reads this and decides.
 *
 * It lives here, beside the planner, for the reason the planner is pure: what is
 * printed has to be what is written, and the only way to be sure is for both to
 * be the same list rendered once. `import-structure.mjs` prints this string and
 * then executes `actions` — there is no second traversal that could disagree.
 *
 * Plain ASCII scaffolding, because this output is read in a terminal and pasted
 * into a chat. Names and paths are bidi-isolated; see the top of this file.
 */
export function renderPlan({ actions, refusals, notes, summary }, meta = {}) {
  const out = []
  const say = (line = '') => out.push(line)

  say('')
  say('  NphiesCore — structure import')
  say(`  ${meta.apply ? '*** --apply: THIS RUN WRITES ***' : 'dry run — nothing will be written'}`)
  say('')
  if (meta.file) say(`  File: ${meta.file}`)
  say(`  ${summary.rows} row(s) in the file.`)
  say('')

  if (refusals.length) {
    say(`  ══ REFUSALS (${refusals.length}) ═══════════════════════════════════════════════`)
    say('  --apply DOES NOTHING AT ALL while even one of these stands. A half-applied')
    say('  spreadsheet leaves a tree nobody can reason about — all or nothing.')
    say('')
    for (const r of refusals) {
      say(`  ${r.line === null ? 'header' : `line ${r.line}`}  [${r.code}]`)
      for (const chunk of wrap(r.message, 72)) say(`      ${chunk}`)
      say('')
    }
  }

  const newUseCases = actions.filter((a) => a.kind === 'create-use-case')
  if (newUseCases.length) {
    say(
      `  ══ --add-use-cases: ${newUseCases.length} NEW ${newUseCases.length === 1 ? 'CAPABILITY' : 'CAPABILITIES'} ═══════════════════════════`,
    )
    say('  These columns name nothing in the catalogue and would be CREATED, in')
    say('  Settings › Catalogue, exactly as typed:')
    for (const a of newUseCases) say(`    + ${isolate(a.name)}   (sort order ${a.sortOrder})`)
    say('')
  }

  // ── the tree ──
  const nodeActions = actions.filter((a) => a.kind === 'create-node' || a.kind === 'update-node')
  const linkActions = actions.filter((a) => a.kind === 'set-use-case' || a.kind === 'clear-use-case')

  if (!summary.rows) {
    // ⚠ NOT "NOTHING TO DO". A header with no rows under it is not a workspace
    // that agrees with the file — it is a file with nothing in it, and the two
    // read identically to somebody scanning for the headline. Excel saving the
    // wrong sheet, or a colleague returning the file with his rows on sheet 2,
    // both land here, and "the workspace already says exactly what the file
    // says" is precisely the reassurance that stops the search.
    say('  THE FILE HAS NO ROWS — only a header. Nothing to plan.')
    say('  If you expected rows here: check you saved the sheet you filled in, and')
    say('  that Excel saved it as CSV UTF-8 rather than a workbook.')
    say('')
  } else if (!nodeActions.length && !linkActions.length) {
    say('  NOTHING TO DO — the workspace already says exactly what the file says.')
    say('  (That is the answer a second run of the same file should give.)')
    say('')
  } else {
    say('  THE PLAN')
    say('')
    const byPath = new Map()
    const order = []
    const at = (path) => {
      const k = path.join('\u0000')
      if (!byPath.has(k)) {
        byPath.set(k, { path, node: null, links: [] })
        order.push(k)
      }
      return byPath.get(k)
    }
    for (const a of nodeActions) at(a.path).node = a
    for (const a of linkActions) at(a.path).links.push(a)
    // Ancestors with no action of their own still appear, unmarked, so the
    // indentation is a tree and not a ladder of orphans.
    for (const k of [...order]) {
      const { path } = byPath.get(k)
      for (let d = 1; d < path.length; d += 1) at(path.slice(0, d))
    }

    const entries = [...byPath.values()].sort((x, y) => comparePaths(x.path, y.path))
    let currentTrack = null
    for (const entry of entries) {
      if (entry.path[0] !== currentTrack) {
        currentTrack = entry.path[0]
        say(`  ${isolate(currentTrack)}`)
      }
      if (entry.path.length === 1) continue
      const indent = '  '.repeat(entry.path.length - 1)
      const name = isolate(entry.path[entry.path.length - 1])
      const a = entry.node
      if (!a) {
        say(`  ${indent}  ${name}`)
      } else if (a.kind === 'create-node') {
        const bits = describeCreate(a)
        // THE POSITION IS PRINTED because this list is not in the order the map
        // will draw. `sort_order` is assigned from FILE order — the sequence he
        // typed is the sequence the map shows — while this printout is sorted by
        // path so that two runs of one file diff cleanly. Without the number, a
        // reader sees his organizations in an order he did not choose and either
        // believes that is the map or reorders his spreadsheet to match, which
        // is exactly backwards. The guide says the same thing in words.
        say(
          `  ${indent}+ ${name}${a.implied ? '   (implied — no row of its own)' : ''}   [position ${a.sortOrder}]`,
        )
        for (const bit of bits) say(`  ${indent}      ${bit}`)
      } else {
        say(`  ${indent}~ ${name}`)
        for (const c of a.changes) {
          // BOTH SIDES THROUGH `valueLabel`, WHICH TRUNCATES AND FLATTENS.
          // A raw value here can inject a control character into the plan: a
          // description holding Excel's `\r` returns a real terminal's cursor to
          // column 0 and OVERWRITES the line just drawn, and the two sides then
          // print identically because only the invisible byte differs. He would
          // approve a no-op. `cleanText` now folds CRLF so that case cannot
          // arise, and this is the second lock on the same door.
          say(`  ${indent}      ${c.field}: ${valueLabel(c.fromLabel)} -> ${valueLabel(c.toLabel)}`)
        }
      }
      for (const link of entry.links.sort((x, y) => String(x.useCase).localeCompare(String(y.useCase)))) {
        if (link.kind === 'set-use-case') {
          say(
            `  ${indent}      ${isolate(link.useCase)}: ${link.from ? `${link.from} -> ${link.status}` : link.status}`,
          )
        } else {
          say(`  ${indent}      ${isolate(link.useCase)}: ${link.from} -> (cleared, the link is deleted)`)
        }
      }
    }
    say('')
  }

  // ── the vendors, counted ──
  //
  // Because the point of this column is "filter them out as per the vendor", and
  // the filter groups on the exact string. Three integrators typed four ways are
  // four entries in that filter and no amount of re-running converges them. This
  // block is the only place the file's vendors are ever seen side by side.
  const vendors = summary.vendors ?? []
  if (vendors.length) {
    say(`  ══ VENDORS IN THIS FILE (${vendors.length}) ═══════════════════════════════════════`)
    for (const v of vendors) say(`    ${isolate(v.name)}   ${v.count} organization(s)`)
    say('')
  }

  // ── notes ──
  const notInFile = notes.filter((n) => n.kind === 'not_in_file')
  const others = notes.filter((n) => n.kind !== 'not_in_file')
  if (notInFile.length) {
    say(`  ══ IN THE APP BUT NOT IN THIS FILE (${notInFile.length}) ══════════════════════════`)
    say('  NOTHING BELOW IS TOUCHED. A node missing from the file is NOT archived and')
    say('  NOT deleted — deleting by omission would mean a colleague who filters this')
    say('  spreadsheet and saves it silently archives half the workspace. If one of')
    say('  these should go, archive it in the app, where it asks you first.')
    say('')
    for (const n of notInFile) say(`    ${n.message}`)
    say('')
  }
  if (others.length) {
    say('  ══ WORTH KNOWING ══════════════════════════════════════════════════════')
    for (const n of others) {
      for (const chunk of wrap(n.message, 72)) say(`    ${chunk}`)
    }
    say('')
  }

  say(
    `  Summary: ${summary.create} node(s) to create (${summary.createImplied} implied) · ` +
      `${summary.update} to update · ${summary.setLinks} use-case link(s) to set · ` +
      `${summary.clearLinks} to clear · ${summary.newUseCases} new capabilit${summary.newUseCases === 1 ? 'y' : 'ies'} · ` +
      `${summary.refusals} refusal(s)`,
  )
  say('')

  return out.join('\n')
}

function describeCreate(a) {
  const v = a.values
  const bits = []
  if (v.name_ar) bits.push(`name_ar: ${isolate(v.name_ar)}`)
  if (v.kindName) bits.push(`kind: ${isolate(v.kindName)}`)
  if (v.amLabel) bits.push(`account manager: ${isolate(v.amLabel)} (matched by ${v.amMatchedBy})`)
  if (v.vendor) bits.push(`vendor: ${isolate(v.vendor)}`)
  if (v.description) bits.push(`description: ${isolate(truncate(v.description, 48))}`)
  if (v.description_ar) bits.push(`description_ar: ${isolate(truncate(v.description_ar, 48))}`)
  return bits
}

function valueLabel(value) {
  if (value === null || value === undefined || value === '') return '(blank)'
  return `"${isolate(truncate(value, 48))}"`
}

/**
 * One line, at most `n` characters, and NOTHING that can move a cursor.
 *
 * Every control character goes, not just `\n`: a `\r` that survives into the
 * printout returns a terminal's cursor to column 0 and the next characters
 * overwrite the line already drawn, which turns the plan into a different
 * document than the one the planner produced.
 */
function truncate(value, n) {
  const v = String(value)
    .replace(/[\n\r\t]/gu, ' ')
    // \p{Cc} rather than a written-out range: the category IS "control", and
    // spelling the range makes oxlint's no-control-regex right to complain.
    .replace(/\p{Cc}/gu, '')
  return v.length > n ? `${v.slice(0, n - 1)}…` : v
}

function wrap(text, width) {
  const words = String(text).split(/\s+/u)
  const lines = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

// ── field resolution ────────────────────────────────────────────────────────

/**
 * The seven columns of one row, resolved against the workspace.
 *
 * Returns null when something could not be resolved — a refusal has been pushed
 * and the node cannot be placed. A partially-resolved node is never emitted:
 * creating an organization with the wrong account manager is worse than not
 * creating it, because the wrong person is then accountable for it and nobody
 * knows.
 */
function resolveFields(row, { kindByName, members, refusals }) {
  let kindId = null
  let kindName = ''
  if (row.kind) {
    const found = kindByName.get(nameKey(row.kind)) ?? []
    if (found.length !== 1) {
      refusals.push(
        refuse(
          'kind_unknown',
          row.line,
          // ⚠ SETTINGS › CATALOGUE, NOT SETTINGS › STRUCTURE. Kinds live beside
          // the capabilities, on the screen `App.tsx` routes to CatalogueAdmin;
          // Structure has no way to add one. The value that lands here is
          // `Organisation` — the British spelling, which is what an
          // English-writing Saudi PMO types by default — and sending that person
          // to a screen with no such control is where he stops.
          found.length === 0
            ? `no node kind named \`${row.kind}\`${describeOddCharacters(row.kind)}.${nearestName(row.kind, [...kindByName.values()].flat().map((k) => k.name)) ? ` Did you mean \`${nearestName(row.kind, [...kindByName.values()].flat().map((k) => k.name))}\`?` : ''} The kinds that exist are: ${[...kindByName.values()].flat().map((k) => k.name).join(', ') || '(none)'}. Add one in Settings › Catalogue, or leave the cell blank.`
            : `\`${row.kind}\` matches ${found.length} node kinds. Rename one in Settings › Catalogue.`,
        ),
      )
      return null
    }
    kindId = found[0].id
    kindName = found[0].name
  }

  let amId = null
  let amLabel = ''
  let amMatchedBy = ''
  if (row.accountManager) {
    const resolved = resolveMember(row.accountManager, members)
    if (resolved.error) {
      refusals.push(refuse(resolved.code, row.line, resolved.error))
      return null
    }
    amId = resolved.member.id
    amLabel = memberLabel(resolved.member)
    amMatchedBy = resolved.matchedBy
  }

  return {
    name_ar: row.nameAr,
    kind_id: kindId,
    kindName,
    account_manager_id: amId,
    amLabel,
    amMatchedBy,
    vendor: row.vendor,
    description: row.description,
    description_ar: row.descriptionAr,
  }
}

/**
 * USERNAME, THEN EMAIL, THEN EXACT DISPLAY NAME — in that order, and the plan
 * says which one matched.
 *
 * The order is not arbitrary: a username is unique by construction and is what
 * `admin-members` enforces; an email is unique in `auth.users`; a display name
 * is unique by nothing at all, and this workspace has three people called Ahmed
 * (provision-people.mjs's roster). SILENTLY PREFERRING ONE MATCH OVER ANOTHER IS
 * HOW THE WRONG PERSON ENDS UP ACCOUNTABLE FOR AN ORGANIZATION, so two matches
 * inside a tier is a refusal that names both, with the username that would
 * disambiguate them.
 *
 * A leading `@` is tolerated because that is how a handle is written everywhere
 * else in this app.
 */
export function resolveMember(raw, members) {
  const value = clean(raw).replace(/^@/u, '')
  const lower = value.toLowerCase()

  const tiers = [
    ['username', members.filter((m) => String(m.username ?? '').toLowerCase() === lower && lower !== '')],
    ['email', members.filter((m) => String(m.email ?? '').toLowerCase() === lower && lower !== '')],
    ['display name', members.filter((m) => clean(m.display_name).toLowerCase() === lower && lower !== '')],
  ]

  for (const [matchedBy, hits] of tiers) {
    if (hits.length === 1) return { member: hits[0], matchedBy }
    if (hits.length > 1) {
      return {
        code: 'member_ambiguous',
        error: `\`${value}\` matches ${hits.length} people by ${matchedBy}: ${hits.map((m) => `${m.display_name} (@${m.username ?? m.email ?? m.id})`).join(', ')}. Use the username instead — it is unique and it is what each of them signs in with.`,
      }
    }
  }

  return {
    code: 'member_unknown',
    error: `\`${value}\`${describeOddCharacters(raw)} is not a member of this workspace. Try the username (\`sara.alsaab\`), the email, or the display name exactly as it appears in Settings › Team members. An account manager is left BLANK for unassigned — it is never guessed.`,
  }
}

function memberLabel(member) {
  const handle = member.username ? `@${member.username}` : member.email || member.id
  return `${clean(member.display_name) || handle} (${handle})`
}

/** ONLY THE FIELDS THAT ACTUALLY DIFFER. An update that changes nothing is not an update. */
function diffFields(existing, fields, { memberById, kinds }) {
  const changes = []
  const push = (field, from, to, fromLabel, toLabel) => {
    if (from === to) return
    changes.push({ field, from, to, fromLabel: fromLabel ?? from, toLabel: toLabel ?? to })
  }

  push('name_ar', clean(existing.name_ar ?? ''), fields.name_ar)
  push('description', cleanText(existing.description ?? ''), fields.description)
  push('description_ar', cleanText(existing.description_ar ?? ''), fields.description_ar)
  push('vendor', clean(existing.vendor ?? ''), fields.vendor)

  const currentKind = kinds.find((k) => k.id === existing.kind_id)
  push(
    'kind',
    existing.kind_id ?? null,
    fields.kind_id,
    currentKind ? currentKind.name : '',
    fields.kindName,
  )

  const currentAm = memberById.get(existing.account_manager_id)
  push(
    'account_manager',
    existing.account_manager_id ?? null,
    fields.account_manager_id,
    currentAm ? memberLabel(currentAm) : existing.account_manager_id ? `(unknown profile ${existing.account_manager_id})` : '',
    fields.amLabel,
  )

  return changes
}

// ── small shared helpers ────────────────────────────────────────────────────

function refuse(code, line, message) {
  return { code, line: line ?? null, message }
}

function note(kind, message, extra) {
  return { kind, message, path: extra ?? null }
}

function indexBy(list, key) {
  const map = new Map()
  for (const item of list) {
    const k = key(item)
    const bucket = map.get(k)
    if (bucket) bucket.push(item)
    else map.set(k, [item])
  }
  return map
}

/**
 * The identity of a path, for matching. `map_nodes_sibling_name_uidx` is
 * `(track_id, parent_id, lower(btrim(name)))`, so the key has to be the track's
 * ID plus the lowercased, trimmed names — anything looser matches two nodes and
 * anything tighter creates a duplicate the database then refuses.
 *
 * EXPORTED, and it has to be. `import-structure.mjs` keeps its own map of
 * "path -> the id the database just handed back", so that a child created in
 * the next batch can name its parent. A SECOND IMPLEMENTATION OF THIS FUNCTION
 * THAT DRIFTED BY ONE CHARACTER would resolve every parent to undefined at
 * apply time — after the plan had already printed perfectly. It did, once, in
 * the hour this file was written: a `.join(' ')` against a `.join('\u0000')`.
 */
export function keyOf(trackId, segments) {
  return [String(trackId), ...segments.map((s) => nameKey(s))].join(KEY_SEPARATOR)
}

/**
 * U+0000, and NOT a space, a slash or a `>`.
 *
 * A node may legitimately be called `Ministry of Health, Riyadh`, and a
 * separator that a NAME can contain makes two different paths share one key:
 * under a space, `['a b']` and `['a', 'b']` are the same string, and the second
 * would silently update the first. `clean()` strips every \p{Cf} and folds every
 * whitespace run, so a NUL cannot survive into a segment and therefore cannot
 * collide with one.
 */
const KEY_SEPARATOR = '\u0000'

/** A node's full path, track first. Null when its track is not in the snapshot. */
function pathOf(node, nodeById, tracks) {
  const names = []
  let cursor = node
  const seen = new Set()
  while (cursor) {
    if (seen.has(cursor.id)) return null // a cycle the database should make impossible
    seen.add(cursor.id)
    names.unshift(cursor.name)
    if (!cursor.parent_id) break
    cursor = nodeById.get(cursor.parent_id)
  }
  if (!cursor) return null // an ancestor we cannot see: not ours to describe
  const track = tracks.find((t) => t.id === node.track_id)
  if (!track) return null
  return [track.name, ...names]
}

function describePath(segments) {
  return formatPath(segments)
}
