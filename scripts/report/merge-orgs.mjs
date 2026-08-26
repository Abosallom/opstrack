// Apply the organization identity rulings. DRY RUN unless --apply.
//
// ⚠ THIS IS THE DESTRUCTIVE ONE. It removes 21 rows from the map and moves
//   everything filed against them onto the survivor. The rulings behind it are
//   in docs/ORG-RULINGS.md and the arithmetic is in org-merges.mjs; this file
//   only carries them out.
//
// ⚠ IT WRITES THE MANIFEST BEFORE IT TOUCHES ANYTHING, on this repository's own
//   rule: an undo that exists only in somebody's memory is not an undo. Every
//   absorbed row is recorded in full — the node, its use-case links, its
//   progress row, and the ids of every entry moved — so the merge can be walked
//   back row by row.
//
// ⚠ AND IT REFUSES TO GUESS. A merge group whose survivor cannot be identified,
//   or that names a row the database does not have, aborts the whole run. A
//   partial merge is worse than none: it leaves work filed against a node that
//   no longer means what it meant.

import { writeFileSync } from 'node:fs'
import { all, env } from './extract.mjs'

const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const APPLY = process.argv.includes('--apply')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function send(method, path, body) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: { ...H, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : []
}

/** The rulings, read from the file that computes the arithmetic so the two cannot drift. */
const MERGES = (await import('./org-merges.mjs')).MERGES ?? null
if (MERGES === null) {
  console.error('org-merges.mjs does not export MERGES — read it and export the table.')
  process.exit(1)
}

const kinds = await all('map_node_kinds?select=id,name')
const orgKind = kinds.find((k) => /organi/i.test(k.name))?.id
const nodes = (await all('map_nodes?select=*')).filter((n) => !n.archived)
const byName = new Map(nodes.map((n) => [n.name.trim(), n]))

// ── resolve every group before writing anything ─────────────────────────────
const plan = []
const problems = []
for (const m of MERGES) {
  const rows = m.rows.map((name) => byName.get(name)).filter(Boolean)
  if (rows.length !== m.rows.length) {
    problems.push(`${m.into}: ${m.rows.filter((n) => !byName.has(n)).join(', ')} not in the database`)
    continue
  }
  if (rows.length === 0) { problems.push(`${m.into}: no rows at all`); continue }
  // The survivor is the row already named `into` where one exists, else the
  // first — and it is RENAMED to `into`, because the ruling named the result.
  const survivor = rows.find((r) => r.name.trim() === m.into) ?? rows[0]
  const absorbed = rows.filter((r) => r.id !== survivor.id)
  // ⚠ A GROUP WITH NOTHING TO ABSORB STILL MAY NEED ITS RENAME. `Aseer (Care
  //   Ware) Cluster` is the only row of its group and the ruling named the
  //   result `Aseer (Care Ware)`; skipping on `absorbed.length === 0` dropped
  //   that rename silently, leaving one of the two Aseers still called Cluster.
  if (absorbed.length === 0 && survivor.name.trim() === m.into) continue
  plan.push({ into: m.into, survivor, absorbed, pending: m.pending ?? null })
}

if (problems.length > 0) {
  console.error('REFUSING TO RUN — the rulings name rows this database does not have:')
  for (const p of problems) console.error(`   ${p}`)
  process.exit(1)
}

const absorbedIds = plan.flatMap((g) => g.absorbed.map((a) => a.id))
const links = (await all('map_node_use_cases?select=*')).filter((l) => absorbedIds.includes(l.node_id) || plan.some((g) => g.survivor.id === l.node_id))
const progress = (await all('map_node_progress?select=*')).filter((p) => absorbedIds.includes(p.node_id))
const entries = (await all('entries?select=id,node_id,title')).filter((e) => absorbedIds.includes(e.node_id))

console.log(`groups            ${plan.length}`)
console.log(`rows absorbed     ${absorbedIds.length}`)
console.log(`organizations     ${nodes.filter((n) => n.kind_id === orgKind).length} -> ${nodes.filter((n) => n.kind_id === orgKind).length - absorbedIds.length}`)
console.log(`use-case links    ${links.filter((l) => absorbedIds.includes(l.node_id)).length} on absorbed rows`)
console.log(`progress rows     ${progress.length} on absorbed rows`)
console.log(`work items        ${entries.length} to re-file`)
console.log()
for (const g of plan) {
  console.log(`  ${g.survivor.name.trim()}  ←  ${g.absorbed.map((a) => a.name.trim()).join(' · ')}`)
  if (g.survivor.name.trim() !== g.into) console.log(`      (renamed to "${g.into}")`)
  if (g.pending) console.log(`      ⚠ ${g.pending}`)
}

if (!APPLY) { console.log('\nDRY RUN — nothing was written. Re-run with --apply.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const file = `docs/EVIDENCE/import-runs/org-merge-${stamp}.json`
writeFileSync(file, JSON.stringify({
  kind: 'organization-merge', at: new Date().toISOString(),
  groups: plan.map((g) => ({
    into: g.into,
    survivor: { id: g.survivor.id, name: g.survivor.name },
    absorbed: g.absorbed,
    links: links.filter((l) => g.absorbed.some((a) => a.id === l.node_id)),
    progress: progress.filter((p) => g.absorbed.some((a) => a.id === p.node_id)),
    entries: entries.filter((e) => g.absorbed.some((a) => a.id === e.node_id)).map((e) => e.id),
  })),
}, null, 1))
console.log(`\nmanifest written first: ${file}`)

const RANK = { planned: 0, testing: 1, live: 2 }
let movedEntries = 0, movedLinks = 0, removed = 0

for (const g of plan) {
  const survivorLinks = new Map(
    links.filter((l) => l.node_id === g.survivor.id).map((l) => [l.use_case_id, l]),
  )
  for (const a of g.absorbed) {
    // Use-case links: the more advanced statement wins, which is rebuild.mjs's
    // rule. Demoting a hospital that is live somewhere would be the one
    // unrecoverable mistake here.
    for (const l of links.filter((x) => x.node_id === a.id)) {
      const held = survivorLinks.get(l.use_case_id)
      if (held === undefined) {
        await send('POST', 'map_node_use_cases', [{ ...l, node_id: g.survivor.id }])
        survivorLinks.set(l.use_case_id, { ...l, node_id: g.survivor.id })
        movedLinks += 1
      } else if ((RANK[l.status] ?? -1) > (RANK[held.status] ?? -1)) {
        await send('PATCH', `map_node_use_cases?node_id=eq.${g.survivor.id}&use_case_id=eq.${l.use_case_id}`, { status: l.status })
        movedLinks += 1
      }
      await send('DELETE', `map_node_use_cases?node_id=eq.${a.id}&use_case_id=eq.${l.use_case_id}`)
    }
    for (const e of entries.filter((x) => x.node_id === a.id)) {
      await send('PATCH', `entries?id=eq.${e.id}`, { node_id: g.survivor.id })
      movedEntries += 1
    }
    await send('DELETE', `map_node_progress?node_id=eq.${a.id}`)
    await send('DELETE', `map_nodes?id=eq.${a.id}`)
    removed += 1
    process.stdout.write(`\r  merged ${removed}/${absorbedIds.length}`)
  }
  if (g.survivor.name.trim() !== g.into) {
    await send('PATCH', `map_nodes?id=eq.${g.survivor.id}`, { name: g.into })
  }
}
console.log(`\ndone — ${removed} rows absorbed, ${movedLinks} use-case links carried, ${movedEntries} work items re-filed`)
