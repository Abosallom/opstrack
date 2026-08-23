// One read, one fixture — the spine of the interfaces report.
//
// WHY A FIXTURE AND NOT A READ PER VIEW. Eight diagrams draw the same programme.
// If each fetched for itself, a row added between two fetches would put two
// different truths in one document, and the reader would have no way to tell.
// So the whole document is a pure function of this file.
//
// ⚠ THE FOURTH STATE IS COMPUTED HERE, ONCE. 104 organizations x 10 capabilities
//   is 1,040 cells and only 406 are filled. The other 634 are NOT "planned" —
//   nobody has said anything about them. src/lib/home/summary.ts states the rule
//   this file obeys: "A renderer that prints 0 for the first case is printing a
//   measurement nobody took."
//
// Node built-ins only, and the env/rest/paging idiom is import-structure.mjs's.

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

/** Parse a `.env`-shaped file. Never logs, never returns what it read. */
function readEnvFile(path) {
  const found = new Map()
  if (!existsSync(path)) return found
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/u, '')
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/u, '').trim()
    found.set(key, value)
  }
  return found
}

const local = readEnvFile(resolvePath(process.cwd(), '.env.local'))
const shared = readEnvFile(resolvePath(process.cwd(), '.env'))
// THE ENVIRONMENT WINS over the file — a value exported in the shell is a
// deliberate act for this run; a file is the standing default.
const env = (k) => process.env[k] || local.get(k) || shared.get(k) || ''
const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
if (!URL_BASE || !KEY) { console.error('[report] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1) }

/**
 * Read a table in full.
 *
 * ⚠ POSTGREST CLAMPS EVERY RESPONSE at the project's max-rows (1000). A bare
 *   select on map_node_use_cases would silently return a prefix, and a report
 *   built on a truncated read is the worst failure available here — it looks
 *   right. So every read pages until the server says it is done.
 */
async function all(path, pageSize = 500) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`,
                 Range: `${from}-${from + pageSize - 1}`, Prefer: 'count=exact' },
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`[report] ${path} -> ${res.status} ${text.slice(0, 160)}`)
    const page = JSON.parse(text)
    rows.push(...page)
    const total = Number((res.headers.get('content-range') || '').split('/')[1])
    if (page.length < pageSize || (Number.isFinite(total) && rows.length >= total)) return rows
  }
}
export { all, env, URL_BASE, KEY }

/* ────────────────────────── the tracker's half ─────────────────────────── */

async function readTracker() {
  const [kinds, nodes, useCases, links, stages, progress, profiles] = await Promise.all([
    all('map_node_kinds?select=id,name'),
    all('map_nodes?select=id,name,name_ar,kind_id,parent_id,account_manager_id,archived,external_ref'),
    all('use_cases?select=id,name,name_ar,sort_order&order=sort_order'),
    all('map_node_use_cases?select=node_id,use_case_id,status,external_ref'),
    all('map_node_stages?select=id,name,sort_order,terminal,paused,expected_days&order=sort_order'),
    all('map_node_progress?select=node_id,stage_id,stage_changed_at'),
    all('profiles?select=id,display_name,position'),
  ])
  const orgKind = kinds.find((k) => /organi/i.test(JSON.stringify(k)))
  const orgs = nodes.filter((n) => n.kind_id === orgKind?.id && !n.archived)

  const stageById = new Map(stages.map((s) => [s.id, s]))
  const progressByNode = new Map(progress.map((p) => [p.node_id, p]))
  const ownerById = new Map(profiles.map((p) => [p.id, p.display_name]))

  // status per (org, capability). Absent from this map === nobody has said.
  const cellByOrg = new Map(orgs.map((o) => [o.id, new Map()]))
  for (const l of links) cellByOrg.get(l.node_id)?.set(l.use_case_id, l.status)

  const rows = orgs.map((o) => {
    const cells = cellByOrg.get(o.id) ?? new Map()
    const byCap = useCases.map((u) => cells.get(u.id) ?? null) // null = unrecorded
    const recorded = byCap.filter(Boolean).length
    const p = progressByNode.get(o.id)
    return {
      id: o.id,
      name: o.name,
      nameAr: o.name_ar || null,
      owner: o.account_manager_id ? (ownerById.get(o.account_manager_id) ?? null) : null,
      stage: p ? (stageById.get(p.stage_id)?.name ?? null) : null,
      stageChangedAt: p?.stage_changed_at ?? null,
      byCap,
      recorded,
      live: byCap.filter((s) => s === 'live').length,
      testing: byCap.filter((s) => s === 'testing').length,
      planned: byCap.filter((s) => s === 'planned').length,
    }
  })
  rows.sort((a, b) => a.name.localeCompare(b.name))

  const cells = rows.length * useCases.length
  const filled = rows.reduce((n, r) => n + r.recorded, 0)
  return {
    capabilities: useCases.map((u) => ({ id: u.id, name: u.name })),
    stages: stages.map((s) => ({ name: s.name, terminal: s.terminal, paused: s.paused, expectedDays: s.expected_days })),
    orgs: rows,
    totals: {
      organizations: rows.length,
      cells,
      recorded: filled,
      // ⚠ NOT "planned". The grid's empty cells are a measurement nobody took.
      unrecorded: cells - filled,
      live: rows.reduce((n, r) => n + r.live, 0),
      testing: rows.reduce((n, r) => n + r.testing, 0),
      planned: rows.reduce((n, r) => n + r.planned, 0),
      withOwner: rows.filter((r) => r.owner).length,
    },
  }
}
export { readTracker }

/* ────────────────────────── the export's half ──────────────────────────── */

/** RFC 4180, enough of it: quotes, doubled quotes, embedded newlines, CRLF. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i += 1 } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/**
 * Read the raw Jira export.
 *
 * ⚠ REPEATED COLUMN NAMES ARE THE NORM HERE, not a fault: `Comment` appears 50
 *   times, `Attachment` 22. So a header is resolved to the FIRST index bearing
 *   that name, and multi-value fields are collected across every index.
 */
function readExport(path) {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const header = rows[0].map((h) => h.trim())
  const body = rows.slice(1).filter((r) => r.length > 1 && r.some((c) => c !== ''))
  const firstOf = (name) => header.indexOf(name)
  const at = (r, name) => { const i = firstOf(name); return i === -1 ? '' : (r[i] ?? '').trim() }

  const issues = body.map((r) => ({
    key: at(r, 'Issue key'),
    summary: at(r, 'Summary'),
    type: at(r, 'Issue Type'),
    status: at(r, 'Status'),
    priority: at(r, 'Priority'),
    assignee: at(r, 'Assignee'),
    created: at(r, 'Created'),
    resolved: at(r, 'Resolved'),
  })).filter((x) => x.key)

  // Jira prints `dd/MMM/yy h:mm a`. Month names only — no locale parsing needed.
  const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 }
  const ym = (s) => {
    const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2})/.exec(s)
    if (!m) return null
    const year = 2000 + Number(m[3])
    return `${year}-${String(MONTHS[m[2]] + 1).padStart(2, '0')}`
  }

  const CONV = (s) => {
    if (/^\s*onboarding\s*\|/i.test(s) && (s.match(/\|/g) || []).length >= 2) return 'pipe'
    if (/^\s*onboarding\s*[-–]/i.test(s)) return 'dash'
    if (/interface\s*(build|bulid|development)/i.test(s)) return 'interface'
    return 'other'
  }
  const byConvention = { pipe: 0, dash: 0, interface: 0, other: 0 }
  const months = new Map()   // ym -> { created, resolved }
  const byStatus = new Map(), byType = new Map(), byPriority = new Map(), byAssignee = new Map()
  const bump = (m, k) => { if (k) m.set(k, (m.get(k) ?? 0) + 1) }

  for (const i of issues) {
    byConvention[CONV(i.summary)] += 1
    bump(byStatus, i.status); bump(byType, i.type); bump(byPriority, i.priority); bump(byAssignee, i.assignee)
    const c = ym(i.created); if (c) { const e = months.get(c) ?? { created: 0, resolved: 0 }; e.created += 1; months.set(c, e) }
    const r = ym(i.resolved); if (r) { const e = months.get(r) ?? { created: 0, resolved: 0 }; e.resolved += 1; months.set(r, e) }
  }
  const sortDesc = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: k, n }))
  return {
    file: path.split('/').pop(),
    issues: issues.length,
    byConvention,
    months: [...months].sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]) => ({ month: m, ...v })),
    status: sortDesc(byStatus), type: sortDesc(byType),
    priority: sortDesc(byPriority), assignees: sortDesc(byAssignee).slice(0, 12),
  }
}
export { readExport, parseCsv }

/* ─────────────────────────────── the fixture ───────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const exportPath = process.argv[2] || '/Users/aziz/Downloads/Jira for Lean (1).csv'
  const tracker = await readTracker()
  const exp = existsSync(exportPath) ? readExport(exportPath) : null
  // The clock is stamped ONCE, here, so nothing downstream reads it and every
  // page of the document agrees about what "today" was.
  const fixture = { generatedAt: new Date().toISOString(), tracker, export: exp }
  writeFileSync('scripts/report/fixture.json', JSON.stringify(fixture, null, 1))
  const t = tracker.totals
  console.log(`tracker  ${t.organizations} orgs · ${t.recorded} recorded of ${t.cells} cells · ${t.unrecorded} unrecorded`)
  console.log(`         live ${t.live} · testing ${t.testing} · planned ${t.planned} · owned ${t.withOwner}`)
  if (exp) console.log(`export   ${exp.issues} issues · pipe ${exp.byConvention.pipe} · dash ${exp.byConvention.dash} · interface ${exp.byConvention.interface} · other ${exp.byConvention.other}`)
  console.log('wrote    scripts/report/fixture.json')
}
