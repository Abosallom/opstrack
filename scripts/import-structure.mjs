#!/usr/bin/env node
// import-structure — Aziz's organisation, entered ONCE, from one spreadsheet.
//
//   node scripts/import-structure.mjs docs/templates/structure.csv            # DRY RUN
//   node scripts/import-structure.mjs docs/templates/structure.csv --apply    # writes
//   node scripts/import-structure.mjs docs/templates/structure.csv --add-use-cases
//   node scripts/import-structure.mjs --undo docs/EVIDENCE/import-runs/…json  # DRY RUN
//   node scripts/import-structure.mjs --undo …json --apply                    # removes
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
//
// ═══ --undo: THE ONE WAY THIS SCRIPT REMOVES ANYTHING ═══
//
// `--apply` writes a RUN MANIFEST to `docs/EVIDENCE/import-runs/` naming every
// row it actually created: node ids, use-case links with the status that was
// there before, the fields it overwrote with their old values, the project ref,
// the clock. `--undo <manifest>` reverses exactly that list.
//
// EXACTLY THAT LIST AND NOTHING ELSE. There is no "delete everything the demo
// created" heuristic, because there is no honest way to write one — `map_nodes`
// has no column that could mark a row as demo-created (`source` is
// `check (source in ('local','jira'))`, 0023:341) and a marker in `description`
// is text a person edits. A manifest needs no migration, is exact, and answers
// the more general question too: this is "undo my last import", and it is as
// useful for a real import run against the wrong project as it is for a demo.
//
// UNDO IS DRY-RUN BY DEFAULT, like everything else here, and it RE-READS the
// live workspace before it removes anything: a node that has gained children or
// entries this manifest never created is a node somebody has USED, and it is
// refused by name while the rest of the undo carries on. See
// `scripts/lib/importManifest.mjs` — the deciding is all there, and pure.
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

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath } from 'node:path'

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
import {
  buildManifest,
  manifestFileName,
  manifestIsEmpty,
  manifestNodeIds,
  parseManifest,
  planUndo,
  renderUndoPlan,
  serializeManifest,
  MANIFEST_DIR,
} from './lib/importManifest.mjs'

// ── arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const KNOWN = ['--apply', '--dry-run', '--add-use-cases', '--archive-refused', '--help', '-h']

// `--undo <file>` AND `--undo=<file>`, and the value is lifted out of argv
// BEFORE the flag/positional split. Otherwise the manifest path lands in
// `positionals` beside the CSV path and the two are indistinguishable — which
// matters more here than in most argument parsers, because the two arguments
// mean opposite things and one of them deletes rows.
const argvRest = []
let UNDO = false
let undoValue = null
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a === '--undo') {
    UNDO = true
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('-')) {
      undoValue = next
      i += 1
    }
    continue
  }
  if (a.startsWith('--undo=')) {
    UNDO = true
    undoValue = a.slice('--undo='.length)
    continue
  }
  argvRest.push(a)
}

const flags = new Set(argvRest.filter((a) => a.startsWith('-')))
const positionals = argvRest.filter((a) => !a.startsWith('-'))

const APPLY = flags.has('--apply')
const ADD_USE_CASES = flags.has('--add-use-cases')
const ARCHIVE_REFUSED = flags.has('--archive-refused')

if (flags.has('--help') || flags.has('-h')) {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/import-structure.mjs <file.csv> [--apply] [--add-use-cases]',
      '  node scripts/import-structure.mjs --undo <manifest.json> [--apply]',
      '',
      'Without --apply nothing is written: the plan is printed and the script exits.',
      '',
      'Options:',
      '  --apply           write the plan. Refused outright if the plan has any refusal.',
      '  --add-use-cases   a column naming no known capability CREATES it, instead of',
      '                    being refused. The plan lists exactly what would be added.',
      '  --dry-run         the default; accepted so it can be written out loud.',
      '',
      'Undo:',
      `  --undo <file>     reverse ONE recorded run. --apply writes each run's manifest`,
      `                    to ${MANIFEST_DIR}/ naming every row it created;`,
      '                    --undo reverses exactly that and can touch nothing else.',
      '                    Dry run by default, like everything here. A node that has',
      '                    gained children or entries since the import is REFUSED by',
      '                    name and left exactly as it is; the rest still comes off.',
      '  --archive-refused archive a refused node instead of leaving it — allowed only',
      '                    where it has no children at all, because archiving cascades',
      '                    to every descendant (0023). Off by default.',
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

// `--undo` with no value of its own falls back to the single positional, so
// both `--undo x.json` and `x.json --undo` work. `--add-use-cases` alongside it
// is refused rather than ignored: it names a thing an undo cannot do, and an
// ignored flag is how somebody believes a run did something it did not.
if (UNDO && !undoValue && positionals.length === 1) undoValue = positionals[0]
if (UNDO && ADD_USE_CASES) {
  process.stderr.write('--add-use-cases means nothing with --undo: an undo creates nothing.\nTry --help.\n')
  process.exit(2)
}
if (!UNDO && ARCHIVE_REFUSED) {
  process.stderr.write('--archive-refused means nothing without --undo: an import archives nothing.\nTry --help.\n')
  process.exit(2)
}

const TARGET = UNDO ? undoValue : positionals[0]
if (!TARGET) {
  process.stderr.write(
    UNDO
      ? `Which manifest? Usage: node scripts/import-structure.mjs --undo <file.json> [--apply]\nThey are written to ${MANIFEST_DIR}/ by every --apply.\n`
      : 'Which file? Usage: node scripts/import-structure.mjs <file.csv> [--apply]\nTry --help.\n',
  )
  process.exit(2)
}
if (!UNDO && positionals.length !== 1) {
  process.stderr.write(`Expected one file, got ${positionals.length}: ${positionals.join(' ')}\nTry --help.\n`)
  process.exit(2)
}
if (UNDO && positionals.length > 1) {
  process.stderr.write(
    `Expected one manifest, got ${positionals.length + 1}. An undo reverses ONE recorded run.\nTry --help.\n`,
  )
  process.exit(2)
}

const FILE = resolvePath(process.cwd(), TARGET)
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

/**
 * `https://abcdefgh.supabase.co` -> `abcdefgh`. The only thing safe to print.
 *
 * ⚠ EMPTY WHEN IT CANNOT BE EXTRACTED, NEVER A PLACEHOLDER. This used to answer
 * `'(a non-Supabase URL)'` for anything that did not match — a literal string,
 * identical for every such URL. The manifest stamps this value and `--undo`
 * refuses a manifest whose ref differs from the connected project, so two
 * different projects behind two custom domains would stamp the SAME ref and
 * that guard would wave a foreign manifest straight through, deleting by uuid
 * in a workspace it had never been applied to. An unidentifiable project gets
 * no ref, and every caller that needs one refuses instead of guessing.
 */
function projectRef(url) {
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\./iu.exec(url)
  return m ? m[1] : ''
}

/** For printing only — never for comparing. */
const refLabel = (ref) => ref || (URL_BASE ? '(unidentifiable — SUPABASE_URL is not a *.supabase.co host)' : '(unset)')

// ── the file ────────────────────────────────────────────────────────────────
//
// NOT IN UNDO MODE. There the file is a manifest, not a CSV, and running the
// spreadsheet parser over JSON would print a page of column complaints about a
// file that has no columns.

const parsed = UNDO ? null : parseStructureCsv(readFileSync(FILE, 'utf8'))

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
async function restAll(path, key = 'id') {
  // ⚠ EVERY PAGED READ IS ORDERED, AND A UNIQUE KEY IS ALWAYS THE LAST ONE.
  //
  // ⚠ AND THAT KEY IS NOT ALWAYS `id`. `map_node_use_cases` has no `id` column
  // at all — its primary key is the pair `(node_id, use_case_id)` (0024:358) —
  // and the hardcoded `order=id` this function used to append made every read of
  // that table fail outright with `column map_node_use_cases.id does not exist
  // [42703]`. That is not a hypothetical: it is what the first live dry run of
  // `--undo` printed, and it was invisible until then because the import half
  // only ever reads that table as an EMBEDDED resource on `map_nodes`, where
  // PostgREST orders it by the parent. So the key is a parameter, it defaults to
  // the `id` every other table here has, and the composite tables pass their own.
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
    ? path.replace(/(^|[?&])order=([^&]*)/u, (_m, lead, value) => `${lead}order=${value},${key}`)
    : `${path}${path.includes('?') ? '&' : '?'}order=${key}`
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

/**
 * A filtered read for a list of ids, chunked.
 *
 * `id=in.(…)` is a URL, and a URL has a length nobody documents until a proxy
 * truncates one. Fifty uuids is 1,850 characters; two hundred is over seven
 * thousand, which is past what several gateways will forward. Chunking at 100
 * keeps every request comfortably short — and `restAll` still pages each chunk,
 * because the 1000-row clamp applies to a filtered read exactly as it does to a
 * whole table.
 */
async function readIn(table, column, ids, select, key = 'id') {
  const rows = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map((v) => encodeURIComponent(v))
    rows.push(...(await restAll(`/rest/v1/${table}?${column}=in.(${chunk.join(',')})&select=${select}`, key)))
  }
  return rows
}

/** `map_node_use_cases` is keyed on the pair, not on an id. See `restAll`. */
const LINK_KEY = 'node_id,use_case_id'

// ── UNDO ────────────────────────────────────────────────────────────────────
//
// Everything above this point is shared. Everything below it, until the marker
// that ends it, runs ONLY for `--undo` and exits — the import half is never
// reached, and the two halves share no mutable state.

if (UNDO) {
  if (!URL_BASE || !SERVICE_KEY) {
    // NO OFFLINE HALF HERE, deliberately — unlike the import, which can still
    // say useful things about a CSV with no credentials. An undo's entire job is
    // to compare a record of the past against what is true NOW; without the
    // workspace there is nothing to compare and the only honest output would be
    // the manifest read back to you.
    out('')
    out('  NphiesCore — undo a structure import')
    out('')
    out('  NO CREDENTIALS, SO NOTHING CAN BE CHECKED.')
    if (!URL_BASE) out('    - SUPABASE_URL (or VITE_SUPABASE_URL) is missing')
    if (!SERVICE_KEY) out('    - SUPABASE_SERVICE_ROLE_KEY is missing')
    out('')
    out('  An undo re-reads every node it is about to remove and refuses the ones')
    out('  that have gained children or entries since the import. That check is the')
    out('  whole safety property and it cannot be done from the manifest alone.')
    out('  Put the credentials in .env.local and run this again.')
    out('')
    process.exit(2)
  }

  const { manifest, errors: manifestErrors } = parseManifest(readFileSync(FILE, 'utf8'))
  if (manifestErrors.length) {
    out('')
    out('  NphiesCore — undo a structure import')
    out(`  Manifest: ${TARGET}`)
    out('')
    out('  THIS FILE CANNOT BE USED AS AN UNDO:')
    for (const e of manifestErrors) out(`    - ${isolate(e)}`)
    out('')
    out('  Nothing has been read and nothing has been removed. Manifests are written')
    out(`  by --apply into ${MANIFEST_DIR}/ and are not meant to be edited by hand.`)
    out('')
    process.exit(2)
  }

  const ref = projectRef(URL_BASE)
  if (!ref) {
    // The wrong-project guard below is an equality test, and an equality test
    // against a value that could not be derived is not a check. Stop here rather
    // than compare two placeholders and call it a match.
    out('')
    out('  NphiesCore — undo a structure import')
    out(`  Manifest: ${TARGET}`)
    out('')
    out('  THE PROJECT CANNOT BE IDENTIFIED. REFUSED.')
    out('  SUPABASE_URL is not a `https://<ref>.supabase.co` host, so there is no')
    out('  project ref to compare against the one this manifest records')
    out(`  (${isolate(manifest.projectRef)}). The whole safety of an undo is that it runs`)
    out('  against the project the import ran against; that cannot be established')
    out('  here, and deleting by uuid in the wrong workspace is unrecoverable.')
    out('')
    process.exit(2)
  }
  if (manifest.projectRef !== ref) {
    // ⚠ THE HIGHEST-VALUE REFUSAL IN THIS FILE. Two projects, one manifest: the
    // uuids would mostly not exist in the wrong project and the run would report
    // a tidy list of "already gone" — a green, confident, completely false
    // reassurance that the demo had been reset. And the uuids that DID resolve
    // would be somebody else's rows.
    out('')
    out('  NphiesCore — undo a structure import')
    out(`  Manifest: ${TARGET}`)
    out('')
    out('  WRONG PROJECT. REFUSED.')
    out(`    this manifest records a run against  ${manifest.projectRef}`)
    out(`    SUPABASE_URL points at              ${ref}`)
    out('')
    out('  Nothing has been read and nothing has been removed. Point SUPABASE_URL at')
    out('  the project this manifest was written against, or use the manifest that')
    out('  belongs to this one.')
    out('')
    process.exit(2)
  }

  // ── the live re-read ──
  //
  // EVERY QUESTION IS ASKED OF THE DATABASE, NOW. The manifest says what was
  // true at the end of the import; the only thing that decides what may be
  // removed is what is true at the moment of the undo.
  const nodeIds = manifestNodeIds(manifest)
  const useCaseIds = (manifest.createdUseCases ?? []).map((u) => u.id)
  let probe
  try {
    probe = {
      nodes: nodeIds.length
        ? await readIn(
            'map_nodes',
            'id',
            nodeIds,
            'id,parent_id,track_id,kind_id,name,name_ar,description,description_ar,account_manager_id,vendor,archived',
          )
        : [],
      // Children are read by `parent_id`, NOT taken from the manifest. The whole
      // point is the child the manifest has never heard of.
      children: nodeIds.length ? await readIn('map_nodes', 'parent_id', nodeIds, 'id,parent_id,name,archived') : [],
      entries: nodeIds.length ? await readIn('entries', 'node_id', nodeIds, 'id,node_id') : [],
      links: nodeIds.length
        ? await readIn('map_node_use_cases', 'node_id', nodeIds, 'node_id,use_case_id,status', LINK_KEY)
        : [],
      useCases: useCaseIds.length ? await readIn('use_cases', 'id', useCaseIds, 'id,name') : [],
      useCaseLinks: useCaseIds.length
        ? await readIn('map_node_use_cases', 'use_case_id', useCaseIds, 'node_id,use_case_id,status', LINK_KEY)
        : [],
    }
  } catch (e) {
    out('')
    out(`  FAILED to re-read the workspace: ${e.message}${e.code ? ` [${e.code}]` : ''}`)
    out(`  Project: ${ref}`)
    out('')
    out('  NOTHING HAS BEEN REMOVED. The check that decides what may be removed did')
    out('  not complete, and an undo that cannot see the workspace does not proceed.')
    out('')
    process.exit(1)
  }

  const undo = planUndo({ manifest, ...probe, archiveRefused: ARCHIVE_REFUSED })

  out(renderUndoPlan(undo, { apply: APPLY, manifestPath: TARGET, manifest }))
  out(`  Project: ${ref} · ${probe.nodes.length} of ${nodeIds.length} recorded node(s) still exist`)
  out('')

  if (!APPLY) {
    out('  DRY RUN — nothing was removed. Re-run with --undo … --apply to do exactly')
    out('  the above. Nothing outside the list above can be touched by that command.')
    out('')
    process.exit(0)
  }

  if (!undo.actions.length) {
    out('  Nothing to do. This manifest has already been reversed, or everything it')
    out('  created has been removed by hand.')
    out('')
    process.exit(0)
  }

  out('  ── REMOVING ──────────────────────────────────────────────────────────')
  out('')

  const done = []
  const problems = []
  // A node whose delete FAILED blocks its ancestors — the database will refuse
  // them for the same reason, one confusing error each. Recorded by path so the
  // ancestor is skipped with a sentence that names the child instead.
  const undeleted = []

  for (const action of undo.actions) {
    try {
      if (action.kind === 'remove-links') {
        const ids = action.useCaseIds.map((v) => encodeURIComponent(v)).join(',')
        await rest(
          `/rest/v1/map_node_use_cases?node_id=eq.${encodeURIComponent(action.nodeId)}&use_case_id=in.(${ids})`,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        )
        done.push(`${action.useCaseIds.length} link(s) removed from ${action.path.join(' > ')}`)
      } else if (action.kind === 'restore-link') {
        // merge-duplicates: the row may or may not be there, and putting it back
        // has to work either way. This is the one place an undo CREATES.
        await rest('/rest/v1/map_node_use_cases', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{ node_id: action.nodeId, use_case_id: action.useCaseId, status: action.status }]),
        })
        done.push(`${action.useCase} put back as ${action.status} on ${action.path.join(' > ')}`)
      } else if (action.kind === 'revert-node') {
        await rest(`/rest/v1/map_nodes?id=eq.${encodeURIComponent(action.nodeId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(action.patch),
        })
        done.push(`${action.changes.map((c) => c.column).join(', ')} put back on ${action.path.join(' > ')}`)
      } else if (action.kind === 'delete-node') {
        const blocker = undeleted.find(
          (p) => p.length > action.path.length && p.slice(0, action.path.length).join('\u0000') === action.path.join('\u0000'),
        )
        if (blocker) {
          problems.push(
            `${action.path.join(' > ')}: not attempted — ${blocker.join(' > ')} below it is still there, so the database would refuse this too.`,
          )
          undeleted.push(action.path)
          continue
        }
        await rest(`/rest/v1/map_nodes?id=eq.${encodeURIComponent(action.nodeId)}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        })
        done.push(`deleted ${action.path.join(' > ')}`)
      } else if (action.kind === 'archive-node') {
        await rest(`/rest/v1/map_nodes?id=eq.${encodeURIComponent(action.nodeId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ archived: true }),
        })
        done.push(`archived ${action.path.join(' > ')}`)
      } else if (action.kind === 'delete-use-case') {
        await rest(`/rest/v1/use_cases?id=eq.${encodeURIComponent(action.useCaseId)}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        })
        done.push(`deleted capability ${action.name}`)
      }
    } catch (e) {
      const where =
        action.kind === 'delete-use-case' ? `capability ${action.name}` : (action.path ?? []).join(' > ')
      // `map_node_in_use` is 0023's own token for "something still points at
      // this". Reaching it here means the workspace changed between the re-read
      // a second ago and this DELETE — rare, and exactly the race the token was
      // given a stable prefix for.
      const inUse = String(e.message).includes('map_node_in_use')
      problems.push(
        `${where}: ${e.message}${e.code ? ` [${e.code}]` : ''}${
          inUse ? ' — something started pointing at it between the check and the delete. Re-run this manifest.' : ''
        }`,
      )
      if (action.kind === 'delete-node') undeleted.push(action.path)
    }
  }

  out(`  ${done.length} operation(s) done.`)
  for (const d of done) out(`    ${isolate(d)}`)
  out('')

  if (problems.length) {
    out('  ══ WHAT DID NOT COME OFF ═════════════════════════════════════════════')
    for (const p of problems) out(`    - ${isolate(p)}`)
    out('')
    out('  THE LIST ABOVE IS WHAT LANDED. RE-RUNNING THIS MANIFEST IS SAFE and is')
    out('  the right next step: everything here is matched by id, a row already gone')
    out('  is a no-op, and the dry run will show you exactly the remainder.')
    out('')
    process.exit(1)
  }

  out('  Done. The manifest is kept — re-running it is a no-op and it stays the')
  out('  record of what that import wrote.')
  out('')
  process.exit(0)
}

// ── END OF UNDO ─────────────────────────────────────────────────────────────

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
    out(`  Project: ${refLabel(projectRef(URL_BASE))}`)
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

out(`  Project: ${refLabel(projectRef(URL_BASE))} · ${snapshot.tracks.length} track(s) · ${snapshot.nodes.length} existing node(s) · ${snapshot.useCases.length} use case(s)`)
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

// ⚠ NO REF, NO APPLY. The manifest stamps the project ref and `--undo` refuses
// any manifest whose ref is not the connected project. A run that cannot derive
// one writes rows whose only record carries an empty ref — a file the undo will
// then refuse, which is a demo in the workspace with no reset. Caught HERE,
// before the first write, rather than in the manifest write at the end.
if (!projectRef(URL_BASE)) {
  out('  ── REFUSED, BEFORE ANYTHING WAS WRITTEN ──────────────────────────────')
  out('')
  out('  SUPABASE_URL is not a `https://<ref>.supabase.co` host, so this run has no')
  out('  project ref to stamp on its manifest — and `--undo` refuses a manifest it')
  out('  cannot match to the connected project. Applying now would put rows in the')
  out('  workspace with no working way to take them back.')
  out('')
  out('  Point SUPABASE_URL at the project URL from the Supabase dashboard.')
  out('')
  process.exit(2)
}

out('  ── APPLYING ──────────────────────────────────────────────────────────')
out('')

const landed = []
const failures = []

// ── the run manifest ────────────────────────────────────────────────────────
//
// FILLED AS ROWS LAND, NOT COMPOSED FROM THE PLAN AT THE END. The plan is what
// this run INTENDED; the manifest must be what it DID. The two are the same
// thing right up until the moment they are not — a create that failed, a batch
// that never ran — and it is exactly then that somebody needs the undo. So every
// entry below is pushed inside the success branch of the call that wrote it,
// after the database has handed back the id.
//
// WRITTEN ON THE WAY OUT WHETHER THE RUN SUCCEEDED OR FAILED, for the same
// reason. A half-applied import is the case with no other record: the CSV
// describes a tree that is not there and the plan is gone with the process.
const RUN_STARTED_AT = new Date().toISOString()
const wrote = { createdUseCases: [], createdNodes: [], updatedNodes: [], setUseCases: [], clearedUseCases: [] }

/**
 * The planner's field names -> the columns a PATCH names. One mapping, used by
 * the PATCH and by the manifest, so an undo can never restore `kind` into a
 * column called `kind_id`.
 */
const columnOf = (field) => (field === 'kind' ? 'kind_id' : field === 'account_manager' ? 'account_manager_id' : field)

/**
 * Records that could not be shaped into something reversible. Each one is a row
 * that IS in the project and is NOT in the manifest, so it is printed at the
 * loudest volume this script has.
 */
const droppedRecords = []

/** Returns the path it wrote, or null when there was nothing to record. */
function writeRunManifest(outcome) {
  // ⚠ THE SECOND ARGUMENT IS NOT OPTIONAL HERE. `buildManifest` is strict by
  // default and throws on a record it cannot reverse — right, for a caller that
  // can still decide not to write. At THIS call site the rows are already in
  // the live project, and one capability POST that came back without an id
  // would throw away the record of the other ninety-nine. Ninety-nine beats
  // none; the gap is screamed about below rather than swallowed.
  const manifest = buildManifest(
    {
      file: positionals[0],
      projectRef: projectRef(URL_BASE),
      startedAt: RUN_STARTED_AT,
      finishedAt: new Date().toISOString(),
      outcome,
      ...wrote,
    },
    (problem) => droppedRecords.push(problem),
  )
  if (manifestIsEmpty(manifest)) return null
  const dir = resolvePath(process.cwd(), MANIFEST_DIR)
  mkdirSync(dir, { recursive: true })
  const name = manifestFileName(RUN_STARTED_AT, manifest.projectRef)
  writeFileSync(joinPath(dir, name), serializeManifest(manifest), 'utf8')
  return `${MANIFEST_DIR}/${name}`
}

// ── the manifest survives an interruption ───────────────────────────────────
//
// ⚠ WITHOUT THIS, Ctrl-C IS DATA WITH NO UNDO. The demo apply is twenty-two
// creates and sixty-seven link writes against a live project over a network.
// The normal write happens after the last REST call returns, so a laptop that
// sleeps, a VPN that drops, an impatient Ctrl-C or any throw outside the
// per-call `try` blocks ends the process with rows in the workspace and
// `docs/EVIDENCE/import-runs/` empty — and the documented fallback is then
// twenty-two confirmations by hand in the app.
//
// So the same writer runs on the way out of an interrupted process, marked
// `partial`, which is exactly what such a run is: `planUndo` prints
// "THE RUN THIS MANIFEST RECORDS STOPPED PART-WAY" from that word.
let manifestFlushed = false
function flushManifestOnExit(why) {
  if (manifestFlushed) return
  manifestFlushed = true
  try {
    const path = writeRunManifest('partial')
    out('')
    out(`  ⚠ INTERRUPTED (${why}) — the rows that landed before this point are in`)
    out('  the project. What landed is recorded in:')
    out(`    ${path ?? '(nothing had landed yet, so no manifest was written)'}`)
    if (path) {
      out('  Re-run the same file to finish, or --undo that manifest to take it back.')
    }
    out('')
  } catch (e) {
    out('')
    out(`  ⚠ INTERRUPTED (${why}) AND THE MANIFEST COULD NOT BE WRITTEN: ${e.message}`)
    out('  Rows may be in the project with no recorded undo. Run the dry run to see')
    out('  what is there before doing anything else.')
    out('')
  }
}
process.on('SIGINT', () => {
  flushManifestOnExit('Ctrl-C')
  process.exit(130)
})
process.on('SIGTERM', () => {
  flushManifestOnExit('SIGTERM')
  process.exit(143)
})
process.on('uncaughtException', (e) => {
  flushManifestOnExit(`crash: ${e?.message ?? e}`)
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  flushManifestOnExit(`crash: ${e?.message ?? e}`)
  process.exit(1)
})

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
    wrote.createdUseCases.push({ id: row.id, name: action.name })
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
      wrote.createdNodes.push({
        id: row.id,
        path: batch[i].path,
        depth: batch[i].depth,
        // The parent as SENT, not as read back: the undo compares it against the
        // live `parent_id` to spot a node somebody re-parented into their real
        // tree, and that comparison is only meaningful against what we wrote.
        parentId: rows[i].parent_id,
        trackId: batch[i].trackId,
        implied: batch[i].implied,
      })
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
    for (const change of action.changes) patch[columnOf(change.field)] = change.to
    try {
      await rest(`/rest/v1/map_nodes?id=eq.${encodeURIComponent(action.nodeId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      })
      wrote.updatedNodes.push({
        id: action.nodeId,
        path: action.path,
        changes: action.changes.map((c) => ({
          column: columnOf(c.field),
          from: c.from ?? null,
          to: c.to ?? null,
          fromLabel: c.fromLabel ?? null,
          toLabel: c.toLabel ?? null,
        })),
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
  const readyActions = sets.filter((_, i) => links[i].node_id && links[i].use_case_id)
  if (ready.length) {
    try {
      await rest('/rest/v1/map_node_use_cases', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(ready),
      })
      // `previousStatus` is `action.from` — null when this link did not exist,
      // and the old status when the import re-statused one that did. That single
      // field is what lets the undo delete the first kind and RESTORE the
      // second, instead of deleting a statement somebody else made.
      readyActions.forEach((a, i) => {
        wrote.setUseCases.push({
          nodeId: ready[i].node_id,
          useCaseId: ready[i].use_case_id,
          path: a.path,
          useCase: a.useCase,
          status: a.status,
          previousStatus: a.from ?? null,
        })
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
      wrote.clearedUseCases.push({
        nodeId,
        useCaseId: action.useCaseId,
        path: action.path,
        useCase: action.useCase,
        previousStatus: action.from ?? null,
      })
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

// ── the manifest, written before anything else is said ──────────────────────
//
// BEFORE THE FAILURE REPORT AND BEFORE EVERY EXIT. If writing it were the last
// thing this script did, the run that most needs an undo — the one that stopped
// half-way — is the one that would never get a file.
let manifestPath = null
let manifestError = null
try {
  // Claims the flag the signal handlers check: the run reached its own end, so
  // an exit handler must not write a second, `partial`, file over this one.
  manifestFlushed = true
  manifestPath = writeRunManifest(failures.length ? 'partial' : 'complete')
} catch (e) {
  manifestError = e.message
}

if (droppedRecords.length) {
  // Louder than the failure block, and before it. A dropped record is a row that
  // IS in the project and is NOT in the manifest — the one state where the undo
  // is silently incomplete rather than refused.
  out(`  ⚠ ${droppedRecords.length} ROW(S) LANDED THAT THE MANIFEST COULD NOT RECORD.`)
  for (const d of droppedRecords) out(`    - ${isolate(d)}`)
  out('  An --undo of this run will NOT take those back; everything else it lists,')
  out('  it will. Remove them in Settings › Structure, where the app asks first.')
  out('')
}

if (manifestPath) {
  out('  ── HOW TO TAKE THIS BACK ─────────────────────────────────────────────')
  out(`  ${manifestPath}`)
  out('  records every row this run created. To reverse exactly this run:')
  out('')
  out(`      node scripts/import-structure.mjs --undo ${manifestPath}`)
  out('')
  out('  That is a DRY RUN: it prints what it would remove and stops. Add --apply')
  out('  to perform it. It touches nothing that is not in that file, and it refuses')
  out('  any node that has gained children or entries since this run.')
  out('  COMMIT THAT FILE — it holds no secrets, and an undo that only exists on')
  out('  one laptop is not an undo.')
  out('')
} else if (manifestError) {
  // Loud, because the rows are already written. A silent failure here leaves a
  // workspace nobody can reverse and a script that reported success.
  out('  ⚠ THE RUN MANIFEST COULD NOT BE WRITTEN, AND THE ROWS ABOVE ARE ALREADY')
  out(`  IN THE PROJECT: ${manifestError}`)
  out('  There is no --undo for this run. Write down what landed, above, before')
  out(`  you close this terminal, and check that ${MANIFEST_DIR}/ is writable.`)
  out('')
}

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
