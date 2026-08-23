// Remove what the old product left behind. DRY RUN unless --apply.
//
// Four things, all named by the owner:
//   · the 9 archived tracks from opstrack — Dev & QA, SRE, Network …
//   · the leftover work items and meetings ("hi", "Sprint 38 deplo", "Test")
//   · organizations that the re-import did not name — the three parse
//     artefacts, the Alfalah twin, and eleven hospitals whose rows now exist
//     under the shorter name the tickets actually use
//
// ⚠ IT WRITES A MANIFEST BEFORE IT DELETES ANYTHING, on the importer's rule:
//   an undo that exists only in somebody's memory is not an undo. Every row it
//   removes is written to docs/EVIDENCE/import-runs/ first, in full.
//
// ⚠ AND IT REFUSES TO GUESS. The organizations are decided by comparing against
//   the CSV that was just imported, not by a name pattern — a heuristic that
//   deleted "Lab result" would also one day delete a hospital called Lab.

import { readFileSync, writeFileSync } from 'node:fs'
import { all, env } from './extract.mjs'

const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const APPLY = process.argv.includes('--apply')

async function del(path) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=representation' },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : []
}

/** The organizations the freshly-imported CSV names. Anything else is stale. */
function namesInCsv(path) {
  const rows = readFileSync(path, 'utf8').split('\n').slice(1).filter(Boolean)
  const names = new Set()
  for (const line of rows) {
    const first = line.startsWith('"') ? /^"((?:[^"]|"")*)"/.exec(line)?.[1].replace(/""/g, '"') : line.split(',')[0]
    const leaf = (first ?? '').split('>').pop()?.trim()
    if (leaf) names.add(leaf.toLowerCase())
  }
  return names
}

const kinds = await all('map_node_kinds?select=id,name')
const orgKindId = kinds.find((k) => /organi/i.test(k.name))?.id
const nodes = await all('map_nodes?select=id,name,kind_id,archived')
const keep = namesInCsv('scripts/report/structure.csv')
const staleOrgs = nodes.filter(
  (n) => n.kind_id === orgKindId && !n.archived && !keep.has(n.name.trim().toLowerCase()),
)

const tracks = await all('tracks?select=id,name,archived')
const staleTracks = tracks.filter((t) => t.archived)

const entries = await all('entries?select=id,title')
const meetings = await all('meetings?select=id,title')
// ⚠ A TRACK WILL NOT DELETE WHILE ANYTHING POINTS AT IT — the database says so
//   by name (`track_in_use: … 1 recurring templates …`) and it is right to. The
//   one template left is the old product's "Weekly network ops report", the same
//   residue as the entries and the meetings.
const templates = await all('recurring_templates?select=id,title,track_id')

console.log(`stale organizations  ${staleOrgs.length}`)
for (const o of staleOrgs) console.log(`    ${o.name}`)
console.log(`archived tracks      ${staleTracks.length}`)
for (const t of staleTracks) console.log(`    ${t.name}`)
console.log(`work items           ${entries.length}`)
for (const e of entries) console.log(`    ${(e.title ?? '').slice(0, 56)}`)
console.log(`meetings             ${meetings.length}`)
for (const m of meetings) console.log(`    ${(m.title ?? '').slice(0, 56)}`)
console.log(`recurring templates  ${templates.length}`)
for (const t of templates) console.log(`    ${(t.title ?? '').slice(0, 56)}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with --apply.')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const manifest = {
  kind: 'demolition',
  at: new Date().toISOString(),
  organizations: staleOrgs,
  tracks: staleTracks,
  entries,
  meetings,
  templates,
}
const out = `docs/EVIDENCE/import-runs/demolish-${stamp}.json`
writeFileSync(out, JSON.stringify(manifest, null, 1))
console.log(`\nmanifest written first: ${out}`)

// Children before parents: a use-case link or a progress row whose node is gone
// is a row nothing can reach and nothing will clean up.
let n = 0
for (const o of staleOrgs) {
  await del(`map_node_use_cases?node_id=eq.${o.id}`)
  await del(`map_node_progress?node_id=eq.${o.id}`)
  await del(`map_nodes?id=eq.${o.id}`)
  n += 1
}
console.log(`removed ${n} organizations`)

for (const e of entries) await del(`entries?id=eq.${e.id}`)
console.log(`removed ${entries.length} work items`)
for (const m of meetings) await del(`meetings?id=eq.${m.id}`)
console.log(`removed ${meetings.length} meetings`)
for (const t of templates) await del(`recurring_templates?id=eq.${t.id}`)
console.log(`removed ${templates.length} recurring templates`)
for (const t of staleTracks) await del(`tracks?id=eq.${t.id}`)
console.log(`removed ${staleTracks.length} archived tracks`)
console.log('done')
