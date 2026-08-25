// The open Jira work, imported as entries. DRY RUN unless --apply.
//
// ── WHY entries, AND WHY NO MIGRATION ─────────────────────────────────────
//
// `entries` already carries a title, a type, a status, a priority, an owner,
// dates and tags, and `entries.node_id` attaches one to an ORGANIZATION. Every
// surface that would show this work is already built and already reading that
// column — `useNodeCounts`, `NodeFields.open`, "Needs attention", the board, the
// PMO action register. They have all been rendering zero because the table is
// empty. So this is a data problem with a data answer: no new table, no new
// screen, no migration.
//
// ── WHAT IT TAKES ─────────────────────────────────────────────────────────
//
// Only OPEN tickets, and only ones naming an organization that is on the map.
// A closed ticket is history the map does not ask about, and a ticket naming a
// hospital nobody has imported has nowhere to hang.
//
// ⚠ created_at CARRIES THE JIRA DATE, and that is the whole point. Left to
//   default, all 828 rows would be one day old, every age would read zero, and
//   the most useful fact in the export — 318 items older than a year, median
//   211 days — would be destroyed on the way in. An import that quietly resets
//   the clock is worse than no import, because the number it invents looks fine.

import { readFileSync, writeFileSync } from 'node:fs'
import { all, env } from './extract.mjs'
import { splitSummary, orgKey, cleanOrg } from './rebuild.mjs'

const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const APPLY = process.argv.includes('--apply')
const SRC = process.argv.find((a) => !a.startsWith('--') && a.endsWith('.csv'))
  || '/Users/aziz/Downloads/Jira for Lean (1).csv'

/* ─────────────────────────────── the wire ──────────────────────────────── */

async function post(path, rows) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : []
}

/* ─────────────────────────── the vocabularies ──────────────────────────── */

/**
 * Jira status → the app's `entries.status`.
 *
 * `Pending on Vendor` is `waiting_on` rather than `blocked`, and the difference
 * is real: blocked is nobody's turn, waiting_on is somebody else's. Every one of
 * these is open by definition — a closed ticket never reaches this table.
 */
const STATUS = {
  'open bo': 'new',
  'work in progress': 'in_progress',
  'pending on vendor': 'waiting_on',
  'pending on production': 'waiting_on',
  reopened: 'new',
}

/** Jira has five priorities and the app four. Highest and High are not the same
 *  urgency and must not collapse: 158 of the open items are Highest. */
const PRIORITY = { highest: 'critical', high: 'high', medium: 'medium', low: 'low', lowest: 'low' }

/**
 * Jira issue type → the app's entry type.
 *
 * A Problem is an `issue` and an Incident an `escalation`, which is the closest
 * this vocabulary comes to "something is broken right now". A Test becomes a
 * `note` rather than being dropped — five of them exist and inventing a category
 * for five rows is worse than filing them plainly.
 */
const TYPE = {
  'service request': 'request',
  problem: 'issue',
  incident: 'escalation',
  test: 'note',
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

/** `dd/MMM/yy h:mm a` → ISO, or null. Jira prints nothing else in this export. */
function jiraDate(s) {
  const m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*([AaPp])?/.exec((s || '').trim())
  if (!m) return null
  let hour = Number(m[4])
  const half = (m[6] || '').toLowerCase()
  if (half === 'p' && hour < 12) hour += 12
  if (half === 'a' && hour === 12) hour = 0
  const d = new Date(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), hour, Number(m[5])))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/* ─────────────────────────────── the read ──────────────────────────────── */

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
 * The organization a summary names, when it follows NO convention at all.
 *
 * ⚠ THE MOST VALUABLE OPEN WORK DOES NOT FOLLOW THE CONVENTION. "United Doc -
 *   STG ADT error" is a Problem raised against a hospital that IS on the map,
 *   and `splitSummary` rejects it because it is not `Onboarding | Org | Use
 *   case`. Twenty-four open Problems and fifteen open Incidents were being
 *   dropped that way — the tickets that say something is broken right now.
 *
 * So a summary with no convention is searched for any KNOWN organization name.
 * Longest match wins, so "Al Salam Khobar" beats "Al Salam". Names shorter than
 * five characters are not searched for at all: "SGH" and "MMS" would match
 * inside ordinary words and file a ticket against the wrong hospital, which is
 * worse than not filing it.
 */
function namedOrganization(summary, names) {
  const hay = summary.toLowerCase()
  let best = null
  for (const [key, name] of names) {
    if (name.length < 5) continue
    if (hay.includes(name.toLowerCase()) && (!best || name.length > best.name.length)) {
      best = { key, name }
    }
  }
  return best
}

export function readOpenTickets(path, knownNames = []) {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const hdr = rows[0].map((h) => h.trim())
  const at = (name) => hdr.indexOf(name)
  const iS = at('Summary'), iK = at('Issue key'), iSt = at('Status')
  const iP = at('Priority'), iT = at('Issue Type'), iA = at('Assignee'), iC = at('Created')
  const groupCols = hdr.map((h, i) => (/Nphies Group/i.test(h) ? i : -1)).filter((i) => i >= 0)
  const catCols = hdr.map((h, i) => (/Ticket Main Categorization/i.test(h) ? i : -1)).filter((i) => i >= 0)
  const firstOf = (r, cols) => {
    for (const i of cols) if (i < r.length && r[i].trim()) return r[i].trim()
    return ''
  }

  const out = []
  const skipped = { closed: 0, noOrg: 0, noStatus: 0 }
  for (const r of rows.slice(1)) {
    if (r.length <= Math.max(iS, iSt)) continue
    const status = STATUS[(r[iSt] ?? '').trim().toLowerCase()]
    if (!status) { skipped.closed += 1; continue }
    const summary = (r[iS] ?? '').trim()
    const split = splitSummary(summary)
    let org = split ? cleanOrg(split.org) : ''
    let via = split ? 'convention' : ''
    if (!org || org.length < 2) {
      const named = namedOrganization(summary, knownNames)
      if (!named) { skipped.noOrg += 1; continue }
      org = named.name
      via = 'named'
    }
    out.push({
      key: (r[iK] ?? '').trim(),
      title: (r[iS] ?? '').trim(),
      orgKey: orgKey(org),
      orgName: org,
      via,
      status,
      priority: PRIORITY[(r[iP] ?? '').trim().toLowerCase()] ?? 'medium',
      type: TYPE[(r[iT] ?? '').trim().toLowerCase()] ?? 'request',
      assignee: (r[iA] ?? '').trim(),
      createdAt: jiraDate(r[iC] ?? ''),
      team: firstOf(r, groupCols),
      category: firstOf(r, catCols),
    })
  }
  return { out, skipped }
}

/* ─────────────────────────────── the build ─────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  // The map's own organization names, so a ticket that follows no convention
  // can still be filed against a hospital this workspace knows.
  const kinds0 = await all('map_node_kinds?select=id,name')
  const orgKind0 = kinds0.find((k) => /organi/i.test(k.name))?.id
  const known = (await all('map_nodes?select=id,name,kind_id,archived'))
    .filter((n) => n.kind_id === orgKind0 && !n.archived)
    .map((n) => [orgKey(n.name), n.name])
  const { out, skipped } = readOpenTickets(SRC, known)

  const kinds = kinds0
  const orgKindId = orgKind0
  const nodes = (await all('map_nodes?select=id,name,kind_id,archived,track_id'))
    .filter((n) => n.kind_id === orgKindId && !n.archived)
  const nodeByKey = new Map(nodes.map((n) => [orgKey(n.name), n]))

  const profiles = await all('profiles?select=id,display_name')
  const memberByName = new Map(
    profiles.map((p) => [(p.display_name ?? '').trim().toLowerCase(), p.id]).filter(([k]) => k),
  )

  const existing = await all('entries?select=id,tags')
  // Idempotent by JIRA KEY, which rides in `tags`. Re-running must not double
  // the queue — the map import earns its trust by being re-runnable and this
  // has to meet the same bar.
  const seen = new Set()
  for (const e of existing) for (const tg of e.tags ?? []) if (/^NONP-/.test(tg)) seen.add(tg)

  const rows = []
  const unmatched = new Map()
  let already = 0
  for (const t of out) {
    const node = nodeByKey.get(t.orgKey)
    if (!node) { unmatched.set(t.orgName, (unmatched.get(t.orgName) ?? 0) + 1); continue }
    if (t.key && seen.has(t.key)) { already += 1; continue }
    const ownerId = memberByName.get(t.assignee.toLowerCase()) ?? null
    rows.push({
      track_id: node.track_id,
      node_id: node.id,
      title: t.title.slice(0, 300),
      type: t.type,
      status: t.status,
      priority: t.priority,
      // EITHER a member OR a free-text name — `entries_single_owner` refuses
      // both, and "assigned to somebody this workspace has never heard of" is a
      // real state worth keeping rather than flattening to unassigned.
      owner_id: ownerId,
      owner_name: ownerId ? null : (t.assignee || null),
      tags: [t.key, t.team, t.category].filter(Boolean),
      created_at: t.createdAt ?? undefined,
      last_activity_at: t.createdAt ?? undefined,
    })
  }

  const age = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  const ages = rows.map((r) => (r.created_at ? age(r.created_at) : 0)).sort((a, b) => a - b)
  const tally = (f) => {
    const c = new Map()
    for (const r of rows) c.set(f(r), (c.get(f(r)) ?? 0) + 1)
    return [...c].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')
  }

  console.log(`read     ${SRC.split('/').pop()}`)
  console.log(`         open tickets naming an organization: ${out.length}`)
  console.log(`skipped  closed or resolved  ${skipped.closed}`)
  console.log(`         no organization     ${skipped.noOrg}`)
  console.log(`         already imported    ${already}`)
  console.log(`         organization not on the map: ${[...unmatched.values()].reduce((a, b) => a + b, 0)} tickets, ${unmatched.size} names`)
  console.log(`\nwould create ${rows.length} entries`)
  console.log(`  status    ${tally((r) => r.status)}`)
  console.log(`  priority  ${tally((r) => r.priority)}`)
  console.log(`  type      ${tally((r) => r.type)}`)
  console.log(`  owner     ${rows.filter((r) => r.owner_id).length} to a member · ${rows.filter((r) => r.owner_name).length} to a name · ${rows.filter((r) => !r.owner_id && !r.owner_name).length} unassigned`)
  console.log(`  organizations touched: ${new Set(rows.map((r) => r.node_id)).size}`)
  console.log(`  matched by convention ${out.filter((t) => t.via === 'convention').length} · by name in the summary ${out.filter((t) => t.via === 'named').length}`)
  if (ages.length) {
    console.log(`  AGE — median ${ages[Math.floor(ages.length / 2)]}d · oldest ${ages.at(-1)}d · over 90d ${ages.filter((a) => a > 90).length} · over 365d ${ages.filter((a) => a > 365).length}`)
    if (ages.at(-1) < 2) console.log('  ⚠ THE DATES DID NOT SURVIVE — every row reads as new. Do not apply.')
  }
  if (unmatched.size) {
    console.log(`\ntop organizations with open work but no row on the map:`)
    for (const [n, c] of [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${String(c).padStart(3)}  ${n}`)
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing was written. Re-run with --apply.'); process.exit(0) }
  if (rows.length === 0) { console.log('\nnothing to do'); process.exit(0) }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const out2 = `docs/EVIDENCE/import-runs/tickets-${stamp}.json`
  writeFileSync(out2, JSON.stringify({ kind: 'jira-open-work', at: new Date().toISOString(), source: SRC, rows }, null, 1))
  console.log(`\nmanifest written first: ${out2}`)

  let made = 0
  for (let i = 0; i < rows.length; i += 100) {
    made += (await post('entries', rows.slice(i, i + 100))).length
    process.stdout.write(`\r  created ${made}/${rows.length}`)
  }
  console.log(`\ndone — ${made} entries created`)
}
