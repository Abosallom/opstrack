// Put every organization under its department. DRY RUN unless --apply.
//
// ── WHY THIS IS NOT AN IMPORT ─────────────────────────────────────────────
//
// `import-structure.mjs` identifies a node by its WHOLE PATH, so a file that
// moved an organization from `UHR > Onboarding > X` to `UHR > Business
// Operations > X` would not move it — it would create a second one, and the
// original would keep its capability links, its account manager and all 627
// entries filed against it. The importer refuses that by name and says so:
// "Move it in the app, then match the file to where it ended up." This is that
// move, done as a move: one `parent_id` per organization.
//
// ── WHY DEPARTMENTS AT ALL ────────────────────────────────────────────────
//
// One parent with 161 children draws as a wall of identical grey bricks — the
// owner's words were that it "looked terrible", and the picture proves him
// right: at the fit zoom every card is 74x24 px with a 5.5px label. Six parents
// of 13 to 65 is a drawing a person can read, and it is the hierarchy he asked
// for: UHR above, cascading to departments, organizations beneath.
//
// The department is the team that owns most of that hospital's tickets — a
// reading of the data, not a filing decision. Nothing is invented.

import { readFileSync, writeFileSync } from 'node:fs'
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

/** `path,…` → the department each organization belongs in, from the built CSV. */
function plan() {
  const lines = readFileSync('scripts/report/structure.csv', 'utf8').split('\n').slice(1)
  const want = new Map()
  for (const line of lines) {
    if (!line.trim()) continue
    const path = line.startsWith('"') ? /^"((?:[^"]|"")*)"/.exec(line)?.[1].replace(/""/g, '"') : line.split(',')[0]
    const parts = (path ?? '').split('>').map((p) => p.trim())
    if (parts.length < 3) continue
    want.set(parts.at(-1).toLowerCase(), parts.at(-2))
  }
  return want
}

const want = plan()
const kinds = await all('map_node_kinds?select=id,name')
const orgKind = kinds.find((k) => /organi/i.test(k.name))?.id
const phaseKind = kinds.find((k) => /phase/i.test(k.name))?.id
  ?? kinds.find((k) => /programme/i.test(k.name))?.id
const nodes = (await all('map_nodes?select=id,name,kind_id,parent_id,track_id,sort_order,archived'))
  .filter((n) => !n.archived)

const orgs = nodes.filter((n) => n.kind_id === orgKind)
// The one node the organizations hang off today — the old "OB", now "Onboarding".
const home = nodes.find((n) => n.kind_id !== orgKind && n.parent_id !== null)
  ?? nodes.find((n) => n.kind_id !== orgKind)
if (!home) throw new Error('[departments] no parent node found')

const departments = [...new Set([...want.values()])].sort()
const existing = new Map(
  nodes.filter((n) => n.kind_id !== orgKind).map((n) => [n.name.trim().toLowerCase(), n]),
)

const toCreate = departments.filter((d) => !existing.has(d.toLowerCase()))
const moves = []
for (const org of orgs) {
  const dept = want.get(org.name.trim().toLowerCase())
  if (!dept) continue
  const target = existing.get(dept.toLowerCase())
  // A department that does not exist yet has no id, so the move is planned
  // against its NAME and resolved after the creates.
  if (target && target.id === org.parent_id) continue
  moves.push({ org, dept })
}

console.log(`departments        ${departments.length} — ${departments.join(' · ')}`)
console.log(`  already present  ${departments.filter((d) => existing.has(d.toLowerCase())).map((d) => d).join(' · ') || 'none'}`)
console.log(`  to create        ${toCreate.join(' · ') || 'none'}`)
console.log(`organizations      ${orgs.length}`)
console.log(`  to move          ${moves.length}`)
const per = new Map()
for (const m of moves) per.set(m.dept, (per.get(m.dept) ?? 0) + 1)
for (const [d, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(3)}  → ${d}`)
console.log(`  staying put      ${orgs.length - moves.length}`)

if (!APPLY) { console.log('\nDRY RUN — nothing was written. Re-run with --apply.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const file = `docs/EVIDENCE/import-runs/departments-${stamp}.json`
writeFileSync(file, JSON.stringify({
  kind: 'department-move', at: new Date().toISOString(),
  created: toCreate,
  // Every organization's PREVIOUS parent, so this is reversible row by row.
  moves: moves.map((m) => ({ id: m.org.id, name: m.org.name, from: m.org.parent_id, toName: m.dept })),
}, null, 1))
console.log(`\nmanifest written first: ${file}`)

let order = Math.max(0, ...nodes.filter((n) => n.parent_id === home.parent_id).map((n) => n.sort_order ?? 0))
for (const name of toCreate) {
  order += 1
  const [made] = await send('POST', 'map_nodes', [{
    name, track_id: home.track_id, parent_id: home.parent_id,
    kind_id: phaseKind, sort_order: order,
  }])
  existing.set(name.toLowerCase(), made)
  console.log(`  created department ${name}`)
}

let moved = 0
for (const m of moves) {
  const target = existing.get(m.dept.toLowerCase())
  if (!target) { console.log(`  ⚠ no node for ${m.dept}, skipped ${m.org.name}`); continue }
  await send('PATCH', `map_nodes?id=eq.${m.org.id}`, { parent_id: target.id })
  moved += 1
  process.stdout.write(`\r  moved ${moved}/${moves.length}`)
}
console.log(`\ndone — ${moved} organizations moved`)
