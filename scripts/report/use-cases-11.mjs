// Bring the catalogue to the owner's eleven use cases. DRY RUN unless --apply.
//
// ⚠ THIS IS THE ROW HALF OF MIGRATION 0032, RUN OVER REST BECAUSE THE COLUMN
//   HALF CANNOT BE. Adding `rung`, `scope`, the COC columns and the event table
//   is DDL and needs the SQL Editor. Merging the XD family into the eleven,
//   hiding what retires and renaming three rows is all DML, and there is no
//   reason the owner should look at a catalogue of fifteen for another day
//   because of that.
//
//   0032 stays complete and idempotent: when it is run its merge loop will find
//   nothing left to move, which is the correct behaviour for a migration that
//   must also work against a fresh database.
//
// ⚠ AND IT WRITES A MANIFEST FIRST. 0032 would have recorded every moved row in
//   `map_node_use_case_events`; that table does not exist yet, so the manifest
//   is the audit trail instead, and it holds each row in full.

import { writeFileSync } from 'node:fs'
import { all, env } from './extract.mjs'

const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const APPLY = process.argv.includes('--apply')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function send(method, path, body) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method, headers: { ...H, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 240)}`)
  return text ? JSON.parse(text) : []
}

/*
 * The owner, asked directly: "xdrado means rad order, xddocs means clinical
 * notes, etc" — and Encounter History "ita ADT". So these four are not use cases
 * of their own; they are the CDA delivery of use cases already in the eleven,
 * and ADT is what carries encounter history.
 */
const MERGE = [
  ['XDLABO', 'Lab Order'],
  ['XDRADO', 'Radiology Order'],
  ['XDDOCS', 'Clinical Notes'],
  ['Encounter History', 'ADT'],
]

/** The owner's own words for three rows the catalogue spelled differently. */
const RENAME = [
  ['Radiology Report', 'Rad Report'],
  ['Radiology Order', 'Rad Order'],
  ['Lab Results', 'Lab Result'],
]

const KEEP = ['ADT', 'Medication Prescribe V1', 'Medication Prescribe V2',
  'Medication Dispense V1', 'Medication Dispense V2', 'Rad Report', 'Rad Order',
  'Lab Result', 'Lab Order', 'Clinical Notes', 'Vital Signs']

const RANK = { planned: 0, testing: 1, live: 2 }

const ucs = await all('use_cases?select=*')
const byName = new Map(ucs.map((u) => [u.name.trim().toLowerCase(), u]))
const links = await all('map_node_use_cases?select=*')

const plan = []
for (const [src, tgt] of MERGE) {
  const s = byName.get(src.toLowerCase()), t = byName.get(tgt.toLowerCase())
  if (!s || !t) { console.error(`REFUSING — "${src}" or "${tgt}" is not in the catalogue`); process.exit(1) }
  const rows = links.filter((l) => l.use_case_id === s.id)
  const held = new Map(links.filter((l) => l.use_case_id === t.id).map((l) => [l.node_id, l]))
  plan.push({ src: s, tgt: t, rows, held })
}

console.log(`catalogue now      ${ucs.length} use cases, ${ucs.filter((u) => !u.hidden).length} visible`)
for (const p of plan) {
  const lift = p.rows.filter((r) => {
    const h = p.held.get(r.node_id)
    return h === undefined || (RANK[r.status] ?? -1) > (RANK[h.status] ?? -1)
  }).length
  console.log(`  ${p.src.name.padEnd(18)} → ${p.tgt.name.padEnd(18)} ${String(p.rows.length).padStart(3)} rows, ${lift} raise the target`)
}
console.log(`renames            ${RENAME.map(([a, b]) => `${a} → ${b}`).join(' · ')}`)
console.log(`visible after      ${KEEP.length}`)

if (!APPLY) { console.log('\nDRY RUN — nothing was written. Re-run with --apply.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const file = `docs/EVIDENCE/import-runs/use-cases-11-${stamp}.json`
writeFileSync(file, JSON.stringify({
  kind: 'use-case-merge', at: new Date().toISOString(),
  note: 'The row half of migration 0032, run over REST. Every moved and deleted row in full.',
  merges: plan.map((p) => ({ from: p.src, to: { id: p.tgt.id, name: p.tgt.name }, rows: p.rows })),
  renames: RENAME,
}, null, 1))
console.log(`\nmanifest written first: ${file}`)

let raised = 0, moved = 0
for (const p of plan) {
  for (const r of p.rows) {
    const h = p.held.get(r.node_id)
    if (h === undefined) {
      await send('POST', 'map_node_use_cases', [{ node_id: r.node_id, use_case_id: p.tgt.id, status: r.status }])
      moved += 1
    } else if ((RANK[r.status] ?? -1) > (RANK[h.status] ?? -1)) {
      await send('PATCH', `map_node_use_cases?node_id=eq.${r.node_id}&use_case_id=eq.${p.tgt.id}`, { status: r.status })
      raised += 1
    }
    await send('DELETE', `map_node_use_cases?node_id=eq.${r.node_id}&use_case_id=eq.${p.src.id}`)
  }
  await send('PATCH', `use_cases?id=eq.${p.src.id}`, { hidden: true })
}
for (const [from, to] of RENAME) {
  const u = byName.get(from.toLowerCase())
  if (u) await send('PATCH', `use_cases?id=eq.${u.id}`, { name: to })
}
console.log(`done — ${moved} rows carried across, ${raised} raised a target, ${plan.reduce((n, p) => n + p.rows.length, 0)} source rows removed`)
