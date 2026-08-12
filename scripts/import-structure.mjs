#!/usr/bin/env node
// import-structure — Aziz's organisation, entered ONCE, from one spreadsheet.
//
//   node scripts/import-structure.mjs docs/templates/structure.csv            # DRY RUN
//   node scripts/import-structure.mjs docs/templates/structure.csv --apply    # writes
//   node scripts/import-structure.mjs docs/templates/structure.csv --add-use-cases
//
// DRY RUN IS THE DEFAULT, and it is the same argument `provision-people.mjs`
// makes at length in its own header: the thing this script writes is not a row
// somebody can shrug at and retype. It is the SHAPE of the workspace — a tree
// whose nodes carry entries, whose paths become the map every screen draws, and
// whose sibling names are unique by index, so a typo is not a cosmetic problem
// but a second organization nobody can tell from the first. So the first thing
// this prints, before it has written anything, is the full plan: every node it
// would create, every field it would change with its old value beside the new
// one, every use-case link it would set and every one it would clear. A human
// reads that and decides. Correct the file, run the dry run again; there is no
// flag that skips this step, because the file is the record.
//
//
// ═══ WHY A CSV AND NOT SOMETHING NICER ═══
//
// Because Aziz lives in spreadsheets, will fill this in Excel, may hand it to a
// colleague to fill in, and will save it back from Excel. Every design decision
// downstream follows from that one fact — the BOM, the CRLF handling, the
// RFC 4180 parser, the "format the column as Text" warning. A YAML file he
// cannot open in the tool he actually uses is a beautiful format nobody fills in.
//
// The alternative this replaces is Settings › Structure: one form submission per
// node, per organization, per use case. For eighteen people, six departments and
// ten capabilities that is several hundred clicks, which is why the workspace is
// still nearly empty. Fill one file, check what it would do, apply it.
//
//
// ═══ WHAT THIS SCRIPT IS ALLOWED TO DO ═══
//
// CREATE map_nodes · UPDATE the seven fields of a map_node the file names ·
// SET or CLEAR a row of map_node_use_cases · and, only with --add-use-cases,
// CREATE a use_cases row. That is the whole list.
//
// IT CREATES NO TRACKS. The first segment of every path is a track and it must
// already exist. A track carries a colour, a light-mode colour, an icon, a
// group and a whole track×priority SLA matrix, none of which belong in a
// spreadsheet column — so a missing track is a refusal that points at
// Settings › Tracks rather than a guess with five defaults in it.
//
// IT ARCHIVES AND DELETES NOTHING. A node that exists in the app and is missing
// from the file is REPORTED and left alone. Deleting by omission would mean a
// colleague who filters this spreadsheet, saves it and hands it back silently
// archives half the workspace, and there is no undo for that shaped like a
// spreadsheet.
//
// ALL OR NOTHING, AND THAT IS A PROMISE ABOUT REFUSALS ONLY. If the plan
// contains even one refusal, `--apply` writes NOTHING — not the good rows, not
// the rows above the bad one. A half-imported spreadsheet leaves a tree that
// neither the file nor the app describes.
//
// ⚠ IT IS NOT A TRANSACTION. The apply is a SEQUENCE of REST calls, and there is
// no BEGIN around them. A refusal cannot get past the gate; a RUNTIME failure —
// a unique violation nobody predicted, a dropped connection, a key that expires
// between two batches — stops the run with part of the file written. That is why
// every path is matched in full and every create is skipped once the node
// exists: RE-RUNNING THE SAME FILE IS THE RECOVERY, and the failure report names
// exactly which paths landed so the dry run afterwards is readable. The refusals
// that were pulled forward out of the database (the depth cap, the name lengths,
// the sibling Arabic name) exist to keep that recovery path rare.
//
//
// ═══ CREDENTIALS ═══
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, read from the environment or from
// `.env.local` (which `.gitignore` already covers, twice: `*.local` and
// `.env.*`). They are NEVER hardcoded here and NEVER printed — the summary says
// which project it is talking to by its ref, and nothing else.
//
// THE SERVICE ROLE, and not an admin's JWT, for two reasons that are not
// convenience. `map_nodes` is admin-write under RLS and `use_cases` is too, so a
// member's token could not do half of this; and `created_by` on every row this
// writes should honestly be nobody, which is exactly what `auth.uid() is null`
// gives — 0023 and 0024 both provide for the JWT-less writer on purpose. The
// service key bypasses RLS. Never put it in `.env`: Vite inlines that file into
// the browser bundle. `.env.local` is not read by Vite's `loadEnv` for the
// client bundle unless prefixed `VITE_`, and this key must never be.
//
// ⚠ NOBODY ON THIS FLEET RUNS THIS AGAINST THE LIVE PROJECT. Aziz does that
// himself, watching. Everything above is written so that the run he watches is
// one he can read first.

import { readFileSync, existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import {
  parseStructureCsv,
  planStructure,
  renderPlan,
  mergeRefusals,
  keyOf,
  nameKey,
  isolate,
  formatPath,
} from './lib/structurePlan.mjs'

// ── arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const KNOWN = ['--apply', '--dry-run', '--add-use-cases', '--help', '-h']
const flags = new Set(argv.filter((a) => a.startsWith('-')))
const positionals = argv.filter((a) => !a.startsWith('-'))

const APPLY = flags.has('--apply')
const ADD_USE_CASES = flags.has('--add-use-cases')

if (flags.has('--help') || flags.has('-h')) {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/import-structure.mjs <file.csv> [--apply] [--add-use-cases]',
      '',
      'Without --apply nothing is written: the plan is printed and the script exits.',
      '',
      'Options:',
      '  --apply           write the plan. Refused outright if the plan has any refusal.',
      '  --add-use-cases   a column naming no known capability CREATES it, instead of',
      '                    being refused. The plan lists exactly what would be added.',
      '  --dry-run         the default; accepted so it can be written out loud.',
      '',
      'Environment (or .env.local):',
      '  SUPABASE_URL               (or VITE_SUPABASE_URL)  https://<ref>.supabase.co',
      '  SUPABASE_SERVICE_ROLE_KEY  Project Settings > API > service_role.',
      '                             Bypasses RLS. Never put it in .env — Vite inlines that.',
      '',
      'The template and a filled-in example live in docs/templates/.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const unknown = [...flags].filter((f) => !KNOWN.includes(f))
if (unknown.length) {
  process.stderr.write(`Unknown option(s): ${unknown.join(' ')}\nTry --help.\n`)
  process.exit(2)
}
if (positionals.length !== 1) {
  process.stderr.write(
    positionals.length === 0
      ? 'Which file? Usage: node scripts/import-structure.mjs <file.csv> [--apply]\nTry --help.\n'
      : `Expected one file, got ${positionals.length}: ${positionals.join(' ')}\nTry --help.\n`,
  )
  process.exit(2)
}

const FILE = resolvePath(process.cwd(), positionals[0])
if (!existsSync(FILE)) {
  process.stderr.write(`No such file: ${FILE}\n`)
  process.exit(2)
}

const out = (line = '') => process.stdout.write(`${line}\n`)

// ── credentials ─────────────────────────────────────────────────────────────
//
// `.env.local` is read here and NOWHERE ELSE, with node:fs and no dependency —
// the house rule is Node built-ins only, and a dotenv package to split a string
// on `=` would be a supply-chain surface for forty lines of parsing.
//
// THE ENVIRONMENT WINS over the file. A value already exported in the shell is
// a deliberate act for this one run (a second project, a rotated key); a value
// in a file is the standing default. Overriding the deliberate act with the
// default is how somebody imports into the wrong project.

/** Parse a `.env`-shaped file. Never logs, never returns the values it read. */
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
    // A quoted value keeps its inner spaces and loses its quotes; an unquoted
    // one loses a trailing ` # comment`, which is the shape people actually type.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/u, '').trim()
    }
    found.set(key, value)
  }
  return found
}

const fileEnv = readEnvFile(resolvePath(process.cwd(), '.env.local'))
const env = (key) => process.env[key] || fileEnv.get(key) || ''

const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')

/** `https://abcdefgh.supabase.co` -> `abcdefgh`. The only thing safe to print. */
function projectRef(url) {
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\./iu.exec(url)
  return m ? m[1] : url ? '(a non-Supabase URL)' : '(unset)'
}

// ── the file ────────────────────────────────────────────────────────────────

const text = readFileSync(FILE, 'utf8')
const parsed = parseStructureCsv(text)

// ── plumbing ────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** One service-role request. `path` is everything after the origin. */
async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const body = await res.text()
  let payload = null
  try {
    payload = body ? JSON.parse(body) : null
  } catch {
    // A gateway HTML page. The status and the raw text are all there is.
  }
  if (!res.ok) {
    throw new ApiError(
      (payload && (payload.message || payload.error || payload.hint)) || body.slice(0, 200) || `HTTP ${res.status}`,
      payload && payload.code,
      res.status,
    )
  }
  return { payload, headers: res.headers }
}

/**
 * A whole table, in pages.
 *
 * POSTGREST CLAMPS EVERY RESPONSE — the project's `max-rows` is 1000, and a
 * silently truncated read here is the worst possible failure: the planner would
 * conclude that the 1001st organization does not exist and emit a CREATE for it,
 * which the sibling-name index then refuses at apply time, halfway through a
 * batch. C8 fixed exactly this class of bug on the app side; this is the same
 * bug on the script side, and the fix is the same — page until the server stops
 * giving.
 */
async function restAll(path) {
  // ⚠ EVERY PAGED READ IS ORDERED, AND `id` IS ALWAYS THE LAST KEY.
  //
  // `limit`/`offset` without an ORDER BY is undefined in Postgres: the planner
  // may return rows in a different sequence per page, so one row can appear
  // twice and another never at all. A SKIPPED node is invisible to the planner,
  // which then emits a `create-node` for a node that exists — and
  // `map_nodes_sibling_name_uidx` kills that whole depth batch mid-apply. A
  // skipped node WITH CHILDREN is worse: `pathOf` drops the orphan silently
  // while the plan prints a tree that looks right.
  //
  // Appending to an existing `order=` rather than replacing it: `use_cases` and
  // `map_node_kinds` are read in catalogue order on purpose, and `id` only has
  // to break the ties that order leaves. Latent today — his workspace is nearly
  // empty — and unbounded as eighteen people fill it in.
  const ordered = /(^|[?&])order=/u.test(path)
    ? path.replace(/(^|[?&])order=([^&]*)/u, (_m, lead, value) => `${lead}order=${value},id`)
    : `${path}${path.includes('?') ? '&' : '?'}order=id`
  const rows = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const sep = ordered.includes('?') ? '&' : '?'
    const { payload } = await rest(`${ordered}${sep}limit=${size}&offset=${from}`)
    const page = Array.isArray(payload) ? payload : []
    rows.push(...page)
    if (page.length < size) return rows
  }
}

// ── read the workspace ──────────────────────────────────────────────────────

let snapshot = { tracks: [], nodes: [], kinds: [], members: [], useCases: [] }
let live = false

if (URL_BASE && SERVICE_KEY) {
  try {
    // `map_node_use_cases(...)` is an EMBEDDED RESOURCE, not a second query.
    // The planner's contract takes the links hanging off each node, and this is
    // literally the shape PostgREST answers with — no client-side join to get
    // subtly wrong, and one round trip instead of two that could disagree.
    const [tracks, nodes, kinds, useCases, profiles] = await Promise.all([
      restAll('/rest/v1/tracks?select=id,name,name_ar,archived'),
      restAll(
        '/rest/v1/map_nodes?select=id,parent_id,track_id,kind_id,name,name_ar,description,description_ar,account_manager_id,vendor,sort_order,archived,map_node_use_cases(use_case_id,status)',
      ),
      restAll('/rest/v1/map_node_kinds?select=id,name&order=sort_order'),
      restAll('/rest/v1/use_cases?select=id,name,sort_order,hidden&order=sort_order'),
      restAll('/rest/v1/profiles?select=id,display_name'),
    ])

    // The username and the email live in `auth.users`, which PostgREST cannot
    // reach at all — `member_directory()` is the app's answer and it needs a
    // member's JWT. With the service role the admin API is the door, and it is
    // the same one provision-people.mjs uses. Emails and usernames are read into
    // memory for MATCHING ONLY; nothing prints them.
    const users = await readAuthUsers()
    const byId = new Map(users.map((u) => [u.id, u]))
    snapshot = {
      tracks,
      nodes,
      kinds,
      useCases,
      members: profiles.map((p) => {
        const u = byId.get(p.id)
        const email = String(u?.email ?? '')
        const username = email.toLowerCase().endsWith('@opstrack.internal')
          ? email.slice(0, -'@opstrack.internal'.length).toLowerCase()
          : null
        return { id: p.id, display_name: p.display_name ?? '', username, email }
      }),
    }
    live = true
  } catch (e) {
    out('')
    out(`  FAILED to read the workspace: ${e.message}${e.code ? ` [${e.code}]` : ''}`)
    out(`  Project: ${projectRef(URL_BASE)}`)
    out('')
    if (e.status === 401 || e.status === 403) {
      out('  That key was rejected. SUPABASE_SERVICE_ROLE_KEY must be the service_role')
      out('  key from Project Settings › API — the anon key cannot read profiles.')
    }
    if (e.code === '42P01') {
      out('  A table is missing. 0023, 0024 and 0025 must all be applied first.')
    }
    out('')
    process.exit(1)
  }
}

/**
 * Every auth user, paged. The admin endpoint's page size is its own, so this
 * follows its `per_page` rather than PostgREST's clamp.
 */
async function readAuthUsers() {
  const users = []
  for (let page = 1; ; page += 1) {
    const { payload } = await rest(`/auth/v1/admin/users?page=${page}&per_page=200`)
    const batch = Array.isArray(payload?.users) ? payload.users : []
    users.push(...batch)
    if (batch.length < 200) return users
  }
}

// ── the file alone, when there is no workspace to check it against ──────────
//
// WITHOUT CREDENTIALS THE PLANNER IS NOT RUN AT ALL, and that is a correction
// rather than a limitation. Against an empty snapshot every track is missing,
// every member is unknown and every use-case column names nothing — so it would
// print a page of refusals, all of them false, and the two REAL problems in the
// file (a ragged row, an illegal status) would be lost among them. A refusal
// list that is mostly noise trains a reader to skim it, which is exactly the
// habit this script cannot afford.
//
// So this half reports what CAN be known from the file alone — the same bargain
// provision-people.mjs strikes when it prints the derived usernames with no
// network in sight.
if (!live) {
  out('')
  out('  NphiesCore — structure import')
  out(`  File: ${positionals[0]}`)
  out('')
  out('  ── NO WORKSPACE WAS READ ─────────────────────────────────────────────')
  out('  Missing:')
  if (!URL_BASE) out('    - SUPABASE_URL (or VITE_SUPABASE_URL)')
  if (!SERVICE_KEY) out('    - SUPABASE_SERVICE_ROLE_KEY')
  out('')
  out('  Nothing below has been checked against the workspace: not one track, not')
  out('  one member, not one use case, and not one node that already exists. This')
  out('  is the FILE, read and checked for the things a file can be wrong about on')
  out('  its own. Put the credentials in .env.local to see the real plan.')
  out('')

  if (parsed.refusals.length) {
    out(`  ══ PROBLEMS IN THE FILE (${parsed.refusals.length}) ══════════════════════════════════`)
    for (const r of parsed.refusals) {
      out(`    ${r.line === null ? 'header' : `line ${r.line}`}  [${r.code}]  ${r.message}`)
    }
    out('')
  } else {
    out('  No structural problem found: the header is right, every path is within')
    out('  the depth cap, every name is within 60 characters, and every use-case')
    out('  cell is blank or one of planned/testing/live.')
    out('')
  }

  out(`  ${parsed.rows.length} row(s) · ${parsed.useCaseColumns.length} use-case column(s):`)
  for (const column of parsed.useCaseColumns) out(`      ${isolate(column)}`)
  out('')
  out('  The tree this file describes:')
  for (const row of parsed.rows) out(`      ${formatPath(row.segments)}`)
  out('')
  process.exit(parsed.refusals.length ? 1 : 0)
}

// ── plan ────────────────────────────────────────────────────────────────────
//
// ONE CALL. The dry run and the apply both take their instructions from this
// object and no other — what is printed below is the list that is executed
// above the fold. If they could diverge, the printout would be decoration.

const plan = planStructure({
  rows: parsed.rows,
  tracks: snapshot.tracks,
  nodes: snapshot.nodes,
  kinds: snapshot.kinds,
  members: snapshot.members,
  useCases: snapshot.useCases,
  addUseCases: ADD_USE_CASES,
})

// Parse refusals come first: a header that names the wrong columns makes every
// later complaint a consequence of it, and burying it under forty of those is
// how a fixable file looks unfixable.
//
// THROUGH `mergeRefusals`, which drops the ones that are consequences of another
// refusal — a cell that is not a status, under a column that is not a capability.
// Add an `Outstanding issue` column and the naive concatenation prints
// "write one of planned, testing, live" once per row and never once prints
// "no use case named `Outstanding issue`".
const refusals = mergeRefusals(parsed.refusals, plan)
const summary = { ...plan.summary, rows: parsed.rows.length, refusals: refusals.length }

out(renderPlan({ ...plan, refusals, summary }, { apply: APPLY, file: positionals[0] }))

out(`  Project: ${projectRef(URL_BASE)} · ${snapshot.tracks.length} track(s) · ${snapshot.nodes.length} existing node(s) · ${snapshot.useCases.length} use case(s)`)
out('')

if (refusals.length) {
  out(`  REFUSED: ${refusals.length} problem(s) above. Nothing has been written.`)
  out('  Fix the file and run the dry run again. --apply would do nothing either:')
  out('  this import is all-or-nothing by design.')
  out('')
  process.exit(1)
}

if (!APPLY) {
  out('  DRY RUN — nothing was written. Re-run with --apply to do exactly the above.')
  out('')
  process.exit(0)
}

// ── apply ───────────────────────────────────────────────────────────────────
//
// The plan, executed in the order it was sorted into: new capabilities, then
// nodes shallowest-first, then the use-case links. Nothing here re-decides
// anything — the only new information is the id the database hands back for a
// row that did not exist, which is what a child's `parent_id` and a link's
// `node_id` are then resolved from.
//
// ON A PARTIAL FAILURE THIS SAYS EXACTLY WHICH PATHS LANDED. It has to: the
// whole file is safe to re-run — every match is on the full path and every
// create is skipped once the node exists — but "safe to re-run" is only
// reassuring if you can see where it stopped.

out('  ── APPLYING ──────────────────────────────────────────────────────────')
out('')

const landed = []
const failures = []

/** path key -> the node's id, filled in as creates land. */
const idByKey = new Map()
const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]))

/**
 * The key `planStructure` puts on every action, computed for a node that
 * already exists.
 *
 * THROUGH THE PLANNER'S OWN `keyOf`, and not a copy of it. A second
 * implementation that drifted by one character — a space where the planner used
 * a NUL — resolves every parent to `undefined` at apply time, AFTER the plan
 * printed perfectly. That is not hypothetical; it is what the first draft of
 * this file did, and only the round-trip test caught it.
 */
function nodeKey(node) {
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
  // ⚠ NULL, NOT A SHORTER KEY. The loop used to stop at an ancestor it could not
  // see and hand back a key one segment short — a plausible key for a DIFFERENT
  // path, which then answers a create's parent lookup with the wrong id after the
  // plan printed the right tree. `pathOf` in the planner returns null in exactly
  // this case, and these two walks must fail the same way or the drift is
  // invisible until it corrupts a tree.
  if (!cursor) return null
  return keyOf(node.track_id, names)
}

for (const node of snapshot.nodes) {
  const key = nodeKey(node)
  if (key) idByKey.set(key, node.id)
}

const useCaseIdByName = new Map(snapshot.useCases.map((u) => [nameKey(u.name), u.id]))

let aborted = false

// ① new capabilities
for (const action of plan.actions.filter((a) => a.kind === 'create-use-case')) {
  try {
    const { payload } = await rest('/rest/v1/use_cases', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: action.name, name_ar: '', sort_order: action.sortOrder }),
    })
    const row = Array.isArray(payload) ? payload[0] : payload
    useCaseIdByName.set(nameKey(action.name), row.id)
    landed.push(`use case ${action.name}`)
  } catch (e) {
    failures.push(`use case "${action.name}": ${e.message}${e.code ? ` [${e.code}]` : ''}`)
    aborted = true
  }
}

// ② nodes, batched one DEPTH at a time.
//
// Batched because a depth is a set of rows with no dependency on each other;
// one depth at a time because the NEXT depth's `parent_id` is an id this depth
// returns. A single POST per depth is the largest batch that is still correct,
// and correctness here is not negotiable: 0023's derive trigger raises
// `map_node_missing` for a parent that is not there yet, mid-batch, having
// already written the rows before it.
const creates = plan.actions.filter((a) => a.kind === 'create-node')
const depths = [...new Set(creates.map((a) => a.depth))].sort((a, b) => a - b)

for (const depth of depths) {
  if (aborted) break
  const batch = creates.filter((a) => a.depth === depth)
  const rows = batch.map((a) => ({
    parent_id: a.parentKey ? (idByKey.get(a.parentKey) ?? null) : null,
    track_id: a.trackId,
    kind_id: a.values.kind_id,
    name: a.name,
    name_ar: a.values.name_ar,
    description: a.values.description,
    description_ar: a.values.description_ar,
    account_manager_id: a.values.account_manager_id,
    vendor: a.values.vendor,
    sort_order: a.sortOrder,
    // Written explicitly rather than left to the column default, for
    // createMapNode's reason: this sends the whole row it means.
    source: 'local',
    // NULL, and honestly so. `auth.uid()` is null for the service role, and a
    // node created by an import was created by nobody in particular — inventing
    // an author here would put Aziz's name on rows a colleague filled in.
    created_by: null,
  }))

  const missingParent = batch.filter((a) => a.parentKey && !idByKey.has(a.parentKey))
  if (missingParent.length) {
    failures.push(
      `internal: ${missingParent.length} node(s) at depth ${depth} have no parent id — ${missingParent.map((a) => a.path.join(' > ')).join(', ')}. The plan's ordering did not hold; nothing further was written.`,
    )
    aborted = true
    break
  }

  try {
    const { payload } = await rest('/rest/v1/map_nodes', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    })
    const created = Array.isArray(payload) ? payload : [payload]
    // PostgREST returns the rows in the order they were sent.
    created.forEach((row, i) => {
      idByKey.set(batch[i].key, row.id)
      landed.push(`created ${batch[i].path.join(' > ')}`)
    })
  } catch (e) {
    failures.push(
      `depth ${depth}: ${e.message}${e.code ? ` [${e.code}]` : ''} — none of these ${batch.length} node(s) landed: ${batch.map((a) => a.path.join(' > ')).join(', ')}`,
    )
    aborted = true
  }
}

// ③ updates. Independent of each other, so one failure does not stop the rest —
// and every one of them is safe to repeat, because the plan is a diff.
if (!aborted) {
  for (const action of plan.actions.filter((a) => a.kind === 'update-node')) {
    const patch = {}
    for (const change of action.changes) {
      if (change.field === 'kind') patch.kind_id = change.to
      else if (change.field === 'account_manager') patch.account_manager_id = change.to
      else patch[change.field] = change.to
    }
    try {
      await rest(`/rest/v1/map_nodes?id=eq.${encodeURIComponent(action.nodeId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      })
      landed.push(`updated ${action.path.join(' > ')}`)
    } catch (e) {
      failures.push(`${action.path.join(' > ')}: update failed — ${e.message}${e.code ? ` [${e.code}]` : ''}`)
    }
  }
}

// ④ the use-case matrix. Sets are one upsert; clears are one delete each,
// because a composite-key delete cannot be expressed as a single filter for
// many pairs and the count here is small by construction.
if (!aborted) {
  const sets = plan.actions.filter((a) => a.kind === 'set-use-case')
  const links = sets.map((a) => ({
    node_id: a.nodeId ?? idByKey.get(a.key),
    use_case_id: a.useCaseId ?? useCaseIdByName.get(nameKey(a.useCase)),
    status: a.status,
  }))
  const unresolvable = sets.filter((_, i) => !links[i].node_id || !links[i].use_case_id)
  if (unresolvable.length) {
    failures.push(
      `internal: ${unresolvable.length} use-case link(s) could not be resolved to a node or a capability id.`,
    )
  }
  const ready = links.filter((l) => l.node_id && l.use_case_id)
  if (ready.length) {
    try {
      await rest('/rest/v1/map_node_use_cases', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(ready),
      })
      landed.push(`${ready.length} use-case link(s) set`)
    } catch (e) {
      failures.push(`use-case links: ${e.message}${e.code ? ` [${e.code}]` : ''} — none of the ${ready.length} were set`)
    }
  }

  for (const action of plan.actions.filter((a) => a.kind === 'clear-use-case')) {
    const nodeId = action.nodeId ?? idByKey.get(action.key)
    if (!nodeId || !action.useCaseId) continue
    try {
      await rest(
        `/rest/v1/map_node_use_cases?node_id=eq.${encodeURIComponent(nodeId)}&use_case_id=eq.${encodeURIComponent(action.useCaseId)}`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
      )
      landed.push(`cleared ${action.useCase} on ${action.path.join(' > ')}`)
    } catch (e) {
      failures.push(
        `${action.path.join(' > ')} / ${action.useCase}: clear failed — ${e.message}${e.code ? ` [${e.code}]` : ''}`,
      )
    }
  }
}

// ── what happened ───────────────────────────────────────────────────────────

out(`  ${landed.length} operation(s) landed.`)
for (const l of landed) out(`    ${isolate(l)}`)
out('')

if (failures.length) {
  out('  ══ FAILURES ══════════════════════════════════════════════════════════')
  for (const f of failures) out(`    - ${isolate(f)}`)
  out('')
  out('  THE LIST ABOVE IS WHAT LANDED. Everything else in the plan did not.')
  out('  RE-RUNNING THIS FILE IS SAFE and is the right next step: every node is')
  out('  matched on its full path, so what landed is found rather than duplicated,')
  out('  and the dry run will show you exactly the remainder.')
  if (aborted) {
    out('')
    out('  The run STOPPED EARLY: a node create failed, and the nodes below it would')
    out('  have had no parent to point at. Nothing after that point was attempted.')
  }
  out('')
  process.exit(1)
}

out('  Done. Re-run the dry run to confirm it now says NOTHING TO DO — that is the')
out('  property that makes this file editable rather than single-use.')
out('')
process.exit(0)
