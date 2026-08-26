// Fill the grid: every organization gets all eleven use cases. DRY RUN unless --apply.
//
// ── WHY A SEED AT ALL ─────────────────────────────────────────────────────
//
// The owner's words: "list all org. and set the default use cases, then get the
// updates from jira export". Today 140 organizations carry 694 links between
// them — so roughly 70% of the grid is nothing at all, and the detail panel can
// only show a hospital the rows somebody happened to file a ticket about.
//
// Seeding turns "70% of the grid is blank" into "the grid exists and most of it
// is at the bottom rung", which is a different and truer statement. A cell
// nobody has spoken about becomes a real row at `planned`, and the panel can
// print eleven rows for every hospital because eleven rows exist.
//
// ⚠ THIS IS NOT THE FOURTH STATE, AND THE DISTINCTION IS THE WHOLE POINT.
//   extract.mjs is right that an unfilled cell is "nobody has said", not zero —
//   for a REPORT computed off the export. This script is the act of somebody
//   saying: the owner has ruled that all eleven apply to every organization
//   until a human marks one out of scope. That ruling is what 0032's `scope`
//   column exists to record. So after this runs, `planned` means planned.
//
// ── WHY `planned` AND NOT `intake` ────────────────────────────────────────
//
// 0032 introduces the five-rung ladder (intake → dev → stg → coc → prod) and
// backfills `rung` from `status`. It is written but NOT YET APPLIED. So this
// script writes `status`, the column that exists, and writes `rung` as well IF
// AND ONLY IF the database already has it — probed, not assumed, so that a seed
// run after 0032 lands does not leave 1,540 rows with a null rung that 0032's
// one-time backfill has already sailed past.
//
// ── WHAT IT WILL NOT DO ───────────────────────────────────────────────────
//
//   · it never LOWERS a cell. live beats testing beats planned is rebuild.mjs's
//     rule and it does not change: a hospital that got ADT live does not
//     un-live it because a later ticket about it is still open.
//   · it never touches a row a PERSON edited. `updated_by` non-null or a
//     non-empty `overrides` array means somebody typed that cell, and an import
//     that overwrites fieldwork is the failure this repo has already had once
//     with the stage clocks.
//   · it writes its undo manifest BEFORE it writes a row.

import { readFileSync, writeFileSync } from 'node:fs'
import { all, env, parseCsv } from './extract.mjs'
import { capabilityOf, cleanOrg, orgKey, splitSummary, stateOf } from './rebuild.mjs'
// The eleven and the two-vocabulary bridge, shared with tickets.mjs.
import { BRIDGE, ELEVEN } from './useCases.mjs'

const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const APPLY = process.argv.includes('--apply')
const EXPORT = process.argv.find((a) => a.endsWith('.csv'))

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
async function send(method, path, body, prefer) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: { ...H, Prefer: prefer ?? 'return=minimal' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 240)}`)
  return text ? JSON.parse(text) : []
}

const RANK = { planned: 1, testing: 2, live: 3 }
const RUNG_OF = { planned: 'intake', testing: 'stg', live: 'prod' }

/* ───────────────────────────── read the world ───────────────────────────── */

const kinds = await all('map_node_kinds?select=id,name')
const orgKindId = kinds.find((k) => /organi/i.test(k.name))?.id
if (!orgKindId) throw new Error('[grid] no Organization kind')

const nodes = await all('map_nodes?select=id,name,kind_id,archived')
const orgs = nodes.filter((n) => n.kind_id === orgKindId && !n.archived)

const catalogue = await all('use_cases?select=id,name')
const byName = new Map(catalogue.map((u) => [u.name.trim().toLowerCase(), u]))
const eleven = ELEVEN.map((name) => {
  const row = byName.get(name.toLowerCase())
  // ⚠ REFUSE rather than seed ten. A missing catalogue row is a schema problem
  //   a human must see; quietly seeding the ones that resolved would leave a
  //   grid that looks complete and is not.
  if (!row) throw new Error(`[grid] the catalogue has no use case named "${name}"`)
  return row
})
const elevenIds = new Set(eleven.map((u) => u.id))

// ⚠ PROBE, DO NOT ASSUME. `rung` arrives with 0032, which is written and not
//   yet applied. Asking the database is one request and removes the guess.
let hasRung = false
try {
  await all('map_node_use_cases?select=rung&limit=1')
  hasRung = true
} catch { hasRung = false }

const links = await all(
  'map_node_use_cases?select=node_id,use_case_id,status,source,overrides,updated_by',
)
const existing = new Map(links.map((l) => [`${l.node_id}:${l.use_case_id}`, l]))
const touched = (l) => l.updated_by !== null || (l.overrides ?? []).length > 0

/* ─────────────────────────────── the seed ──────────────────────────────── */

const seed = []
for (const org of orgs) {
  for (const uc of eleven) {
    if (existing.has(`${org.id}:${uc.id}`)) continue
    seed.push({ node_id: org.id, use_case_id: uc.id, status: 'planned', source: 'jira' })
  }
}

/* ────────────────────────── then the export speaks ─────────────────────── */

/**
 * ⚠ TWO TIERS, AND THE SECOND ONE MAY NOT SAY `live`. THIS IS THE WHOLE CARE.
 *
 * Tier 1 is the three sentence conventions rebuild.mjs already reads —
 * `Onboarding | Org | Use case` and its dash and Interface-Build cousins. A
 * ticket written that way IS the onboarding record for that cell, so its Jira
 * status means what stateOf says it means, up to and including live.
 *
 * Tier 2 is everything else that names an organization on the map and one of
 * the eleven anywhere in its summary: `Aljouf - Medication dispense - Raqeeb
 * 400 Error`, `United Doc - STG ADT error`, `Taif University Hospital -
 * Interface build- Rad Report`. There are 852 of these and they are real
 * evidence — you cannot have an ADT error in STG without an ADT in STG.
 *
 * But their statuses DO NOT mean the same thing, and the measurement is not
 * close: of the tier-2 tickets that read as fault reports, 298 are Resolved or
 * Closed. Read the way tier 1 is read, those 298 would each mark a cell LIVE —
 * because somebody fixed an SSL error. Closing a bug is not a go-live, and a
 * grid that claimed three hundred of them would be worse than the blank grid it
 * replaced.
 *
 * So tier 2 is capped at `testing`: it can say "this pair is real and in
 * flight", which is more than the seed's `planned` and strictly less than a
 * claim nobody made. A cell that genuinely went live has a tier-1 ticket, or a
 * person ticks it — and a person's tick is the one thing this script never
 * overwrites.
 */
const TIER2_CEILING = 'testing'

/** `node.name` → node, by the same key the importer folds spellings with. */
const orgByKey = new Map()
for (const o of orgs) {
  const k = orgKey(o.name)
  if (k && !orgByKey.has(k)) orgByKey.set(k, o)
}

/**
 * Word-boundary probes for the loose scan, longest first.
 *
 * ⚠ THE BOUNDARY IS NOT `\b`: an earlier cut of this matching refused every name
 *   under five characters, which quietly excluded KFMC, SGH, NMC and eleven
 *   more. Bracketing on non-alphanumerics keeps the short names and still
 *   refuses a match inside a longer word.
 *
 * ⚠ LONGEST FIRST IS LOAD-BEARING: `Makkah 1` and `Makkah 2` both contain
 *   `Makkah`. First match wins, so the more specific name must be asked first.
 *
 * ⚠ AND A STEM TWO ORGANIZATIONS SHARE IS NOT A PROBE AT ALL. Dropping the
 *   parenthetical turns `Aseer (Care Ware)` and `Aseer (Vida Plus)` into one
 *   string, and `Jazan cluster (MedicaCloud)` and `Jazan Cluster (MCC)` into
 *   another — the two pairs the owner ruled must stay apart. Whichever sorted
 *   first would have swallowed every bare `Aseer` ticket in the file, which is
 *   the same mistake that once invented a third Aseer out of a merge script.
 *   So a colliding stem is REMOVED and those tickets are reported unmatched.
 *   The full name, with the parenthetical flattened into words rather than
 *   discarded, still matches `Aseer Care Ware` the way the tickets write it.
 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ⚠ FLATTEN THE HAYSTACK TOO. The probe for `Aseer (Care Ware)` is built as
//   `Aseer Care Ware`, and the ticket writes `Aseer (Care Ware) Cluster` — the
//   bracket sits exactly where the probe expects a space, so seven tickets
//   matched nothing until both sides were flattened the same way.
const flat = (t) => t.replace(/[()[\]]/g, ' ').replace(/\s{2,}/g, ' ')
const asProbe = (text) =>
  new RegExp(`(?:^|[^a-z0-9])${escapeRe(text).replace(/\s+/g, '[\\s-]+')}(?:$|[^a-z0-9])`, 'i')

// The generic words are in every name and carry no signal on their own.
const GENERIC = /\b(?:hospitals?|clusters?|medical|centers?|centres?|health)\b/gi
const tidy = (t) => t.replace(/\s{2,}/g, ' ').trim()
const flatName = (name) => tidy(name.replace(/[()]/g, ' '))

const stemsSeen = new Map()
for (const o of orgs) {
  const k = tidy(o.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(GENERIC, ' ')).toLowerCase()
  stemsSeen.set(k, (stemsSeen.get(k) ?? 0) + 1)
}

const probes = []
const ambiguous = new Set()
for (const o of orgs) {
  const full = flatName(o.name)
  if (full.length >= 3) probes.push({ org: o, len: full.length + 100, re: asProbe(full) })
  const stem = tidy(o.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(GENERIC, ' '))
  if (stem.length < 3) continue
  if ((stemsSeen.get(stem.toLowerCase()) ?? 0) > 1) { ambiguous.add(stem); continue }
  if (stem.toLowerCase() !== full.toLowerCase()) probes.push({ org: o, len: stem.length, re: asProbe(stem) })
}
// The full names sort above every stem (+100), and within each group the longer
// name is asked first.
probes.sort((a, b) => b.len - a.len)

const raises = []
const miss = { org: new Map(), unparsed: 0, noState: 0, notEleven: 0, noOrgAnywhere: 0 }
const tally = { tier1: 0, tier2: 0, capped: 0 }
let read = 0

/** reader's capability name → the catalogue row, or null if not one of the eleven. */
function elevenOf(capRaw) {
  if (!capRaw) return null
  const uc = byName.get((BRIDGE.get(capRaw) ?? capRaw).toLowerCase())
  return uc && elevenIds.has(uc.id) ? uc : null
}

if (EXPORT) {
  const rows = parseCsv(readFileSync(EXPORT, 'utf8'))
  const hdr = rows[0].map((h) => h.trim())
  const iSummary = hdr.indexOf('Summary')
  const iStatus = hdr.indexOf('Status')
  if (iSummary < 0 || iStatus < 0) throw new Error('[grid] export has no Summary/Status column')

  // Collapse to one state per cell FIRST, on live > testing > planned, so the
  // order tickets happen to sit in the file cannot decide the answer.
  const best = new Map()
  const offer = (org, uc, state, tier) => {
    const key = `${org.id}:${uc.id}`
    const prior = best.get(key)
    if (!prior || RANK[state] > RANK[prior.state]) best.set(key, { org, uc, state, tier })
  }

  for (const row of rows.slice(1)) {
    const summary = row[iSummary] ?? ''
    if (!summary.trim()) continue
    read += 1
    const state = stateOf(row[iStatus] ?? '')
    if (!state) { miss.noState += 1; continue }
    const flatSummary = flat(summary)

    // ── tier 1 ──
    const split = splitSummary(summary)
    const uc1 = split ? elevenOf(capabilityOf(split.cap)) : null
    if (uc1) {
      // The exact key first, then the same word-boundary scan tier 2 uses.
      // ⚠ THE STATE STAYS FULLY TRUSTED HERE and that is deliberate: the ticket
      //   is written in the onboarding convention, so its status means what it
      //   says. Only WHICH HOSPITAL was matched loosely, and an ambiguous stem
      //   has already been removed from the probes rather than guessed at.
      const org = orgByKey.get(orgKey(cleanOrg(split.org)))
        ?? probes.find((p) => p.re.test(flat(split.org)))?.org
      if (org) { tally.tier1 += 1; offer(org, uc1, state, 1); continue }
      const name = cleanOrg(split.org)
      miss.org.set(name, (miss.org.get(name) ?? 0) + 1)
      continue
    }

    // ── tier 2 ──
    const uc2 = elevenOf(capabilityOf(summary))
    if (!uc2) {
      // Either no capability at all (whitelisting, SSO, deployments) or one of
      // the four that are not among the eleven. Both are refusals, not faults.
      if (capabilityOf(summary)) miss.notEleven += 1
      else miss.unparsed += 1
      continue
    }
    const hit = probes.find((p) => p.re.test(flatSummary))
    if (!hit) { miss.noOrgAnywhere += 1; continue }
    tally.tier2 += 1
    if (RANK[state] > RANK[TIER2_CEILING]) tally.capped += 1
    offer(hit.org, uc2, RANK[state] > RANK[TIER2_CEILING] ? TIER2_CEILING : state, 2)
  }

  for (const [key, cell] of best) {
    const now = existing.get(key)
    // ⚠ never lower, and never over a person's own hand.
    if (now && touched(now)) continue
    const from = now?.status ?? 'planned'
    if (RANK[cell.state] <= RANK[from]) continue
    raises.push({
      key, node_id: cell.org.id, use_case_id: cell.uc.id,
      org: cell.org.name, uc: cell.uc.name, from, to: cell.state, tier: cell.tier,
    })
  }
}

/* ──────────────────────────────── report ───────────────────────────────── */

const grid = orgs.length * eleven.length
console.log(`organizations       ${orgs.length}`)
console.log(`use cases           ${eleven.length} — ${eleven.map((u) => u.name).join(' · ')}`)
console.log(`the grid            ${grid} cells`)
console.log(`  filled today      ${links.filter((l) => elevenIds.has(l.use_case_id)).length}`)
console.log(`  to seed           ${seed.length} at planned`)
console.log(`rung column         ${hasRung ? 'present — writing it too' : 'absent (0032 not applied) — writing status only'}`)
if (EXPORT) {
  console.log(`\nexport              ${EXPORT}`)
  console.log(`  tickets read      ${read}`)
  console.log(`  read by tier      ${tally.tier1} onboarding-shaped · ${tally.tier2} named in passing`)
  if (ambiguous.size) console.log(`  names too ambiguous to match  ${[...ambiguous].join(' · ')}`)
  console.log(`  capped at testing ${tally.capped} — resolved tickets that are not go-lives`)
  console.log(`  cells to raise    ${raises.length}`)
  const per = {}
  for (const r of raises) {
    const k = `${r.from} → ${r.to}  (tier ${r.tier})`
    per[k] = (per[k] ?? 0) + 1
  }
  for (const [k, n] of Object.entries(per).sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`)
  console.log(`  refused           ${miss.unparsed} no capability · ${miss.noState} no state · ${miss.notEleven} not one of the eleven · ${miss.noOrgAnywhere} no organization on the map`)
  const orphan = [...miss.org.entries()].sort((a, b) => b[1] - a[1])
  console.log(`  tier-1 organizations on no map  ${orphan.length} names, ${orphan.reduce((s, [, n]) => s + n, 0)} tickets`)
  for (const [name, n] of orphan.slice(0, 12)) console.log(`     ${String(n).padStart(4)}  ${name || '(empty)'}`)
  if (orphan.length > 12) console.log(`     … and ${orphan.length - 12} more`)
} else {
  console.log('\nno export given — seeding only. Pass a CSV path to raise from it.')
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with --apply.')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const file = `docs/EVIDENCE/import-runs/grid-${stamp}.json`
writeFileSync(file, JSON.stringify({
  kind: 'grid-fill', at: new Date().toISOString(),
  // Undo for the seed is a DELETE of exactly these pairs; undo for a raise is a
  // PATCH back to `from`. Both are here in full, row by row.
  seeded: seed.map((s) => ({ node_id: s.node_id, use_case_id: s.use_case_id })),
  raised: raises.map((r) => ({ node_id: r.node_id, use_case_id: r.use_case_id, from: r.from, to: r.to, tier: r.tier })),
}, null, 1))
console.log(`\nmanifest written first: ${file}`)

const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

let wrote = 0
for (const batch of chunk(seed, 200)) {
  const body = hasRung ? batch.map((b) => ({ ...b, rung: RUNG_OF[b.status] })) : batch
  // ignore-duplicates, not merge: a row that appeared between the read and now
  // belongs to whoever wrote it, and this pass has nothing to say about it.
  await send('POST', 'map_node_use_cases', body, 'return=minimal,resolution=ignore-duplicates')
  wrote += batch.length
  process.stdout.write(`\r  seeded ${wrote}/${seed.length}`)
}
if (seed.length) console.log('')

let up = 0
for (const batch of chunk(raises, 200)) {
  const body = batch.map((r) => hasRung
    ? { node_id: r.node_id, use_case_id: r.use_case_id, status: r.to, rung: RUNG_OF[r.to] }
    : { node_id: r.node_id, use_case_id: r.use_case_id, status: r.to })
  // merge-duplicates updates only the columns in the payload, so `overrides`,
  // `updated_by` and `created_at` on an existing row are left as they were.
  await send('POST', 'map_node_use_cases', body, 'return=minimal,resolution=merge-duplicates')
  up += batch.length
  process.stdout.write(`\r  raised ${up}/${raises.length}`)
}
if (raises.length) console.log('')
console.log(`done — ${seed.length} seeded, ${raises.length} raised`)
