#!/usr/bin/env node
// provision-people — the eighteen real people of this workspace, provisioned
// through the SAME door the Members screen uses and no other.
//
//   node scripts/provision-people.mjs              # dry run: says what it WOULD do
//   node scripts/provision-people.mjs --apply      # actually writes
//   node scripts/provision-people.mjs --only=nada.alsuwaida,reema.alsoairy
//
// DRY RUN IS THE DEFAULT AND THAT IS THE POINT. The roster below carries
// transliterated names of real colleagues; the username derived from a name is
// the identifier that person types at every sign-in and cannot be changed
// afterwards without locking them out. So the first thing this prints — before
// it has touched the network, with or without credentials — is the full derived
// table, for a human to read and correct. Correct a transliteration by editing
// ROSTER in this file and running the dry run again; there is no flag for it,
// because the roster is the record.
//
//
// ═══ WHAT THIS SCRIPT IS ALLOWED TO DO, AND WHY IT NEEDS TWO CREDENTIALS ═══
//
// 1. CREATE ACCOUNTS — through the `admin-members` edge function's `create`
//    action, exactly as `createUsernameMember()` (src/api/members.ts:403) and
//    RUNBOOK §1.2 do. NOT reimplemented here, and it could not be: the invite
//    digest is an HMAC keyed by `INVITE_PEPPER`, a function secret the database
//    never holds and this machine has no copy of. A script that minted its own
//    invite hash would write a digest `claim-account` can never verify, and
//    every code it printed would be dead on arrival. That single fact is what
//    makes the edge function the only creation path.
//
//    The function requires an ADMIN'S JWT, not the service role — it calls
//    `auth.getUser(token)` and a service-role key carries no `sub`. So:
//    ADMIN_ACCESS_TOKEN, obtained exactly as RUNBOOK §1.1 says (DevTools →
//    Console → the localStorage line). It expires in about an hour, which is
//    ample for eighteen rows.
//
// 2. SET DISPLAY NAMES AND POSITIONS — with the SERVICE ROLE key, and there is
//    no alternative. Migration 0016 pins `profiles.display_name` against every
//    caller holding a JWT *including an admin's* (its own header: "Pinned for
//    ADMINS TOO"), and `admin-members` has no rename action at all. The only
//    writers that get through are the ones with `auth.uid()` null: the SQL
//    Editor and the service role. A fresh account gets its name from the
//    `create` call itself; an account that already exists — Nasser's, Aziz's —
//    can only be renamed this way.
//
// The service key bypasses RLS. Never put it in `.env`: Vite inlines that file
// into the browser bundle. Pass it on the command line or via `--env-file`.
//
//
// ═══ WHAT THIS SCRIPT REFUSES TO DO ═══
//
// * IT NEVER REISSUES A CODE. Re-running must not reset anybody's password, and
//   `reissue-code` IS the password reset for a username account — it clears
//   `claimed` and invalidates whatever the member already set. An account that
//   exists is left alone. If someone genuinely needs a new code, that is a
//   deliberate act on Settings › Team members, by a human, for one person.
//
// * IT NEVER WRITES A FILE, and adds nothing to git. The invite codes it prints
//   are credentials with a fourteen-day life that exist in exactly two places
//   by design — the admin's screen and the member's hand. Do not redirect this
//   command's output into a file; it will say so if it notices you have.
//
// * IT NEVER DELETES, DEMOTES OR REPARENTS ANYTHING. Every write here is a
//   create, a name, a position, or a promotion to admin.
//
//
// ═══ TWO PEOPLE ON THIS ROSTER ALREADY HAVE ACCOUNTS ═══
//
// NASSER ALABRI signs in as `nasser`. His username IS his login
// (`nasser@opstrack.internal`) — changing it to `nasser.alabri` would lock him
// out with no way back, because that domain can receive no mail and a username
// account has no self-service reset (RUNBOOK §3.1). He is created by NOBODY.
// The script sets his display name, his position, and promotes him to admin,
// and it says all of that out loud rather than doing it quietly.
//
// ABDULAZIZ ALSALOOM is the workspace owner and signs in with a real address,
// `az.alsaloom@gmail.com` — the bootstrap allow-list inside `admin-members`
// (index.ts:85). Deriving `abdulaziz.alsaloom` and creating it would hand the
// one person who cannot afford it a SECOND identity: two rows in the owner
// picker, history split down the middle, and the new one not on the bootstrap
// list. So he is matched by email and never created either.
//
// Which makes the arithmetic 18 − 2 = **16 accounts to create**, not 17.
//
//
// ═══ WHAT DEPENDS ON MIGRATION 0025 HAVING BEEN APPLIED ═══
//
// 0025 adds `profiles."position"`, `roles`, `role_permissions` and
// `profiles.role_id`, and seeds the three roles admin / director / member. The
// FILE is on this branch; whether it has RUN against the project is a different
// question, and only the database can answer it. So this script PROBES for both
// and degrades honestly rather than assuming either way:
//
//   POSITION goes to `profiles.position` when the column is there, and to the
//   auth user's `user_metadata` either way — beside the `display_name` that
//   `admin-members` already keeps there as its fallback. Parking it in metadata
//   grants nobody anything, which is exactly why it is safe to park: position
//   is display-only and gates nothing. See docs/PEOPLE.md.
//
//   THE DIRECTOR ROLE is written as `profiles.role_id`, and only once 0025 has
//   run — `profiles.role` is `check (role in ('admin','member'))` (0002:58), so
//   there is no third value to write without it. Until then the seven are
//   created as members and printed under STILL TO DO. Nothing is parked in
//   metadata as a placeholder: a permission key nothing checks grants nothing,
//   and writing one would be a promise the code does not keep.
//
//   THE TWO ADMINS still go through the edge function's `set-role` — the
//   guarded, audited door — and 0025's `profiles_role_sync()` bridges the
//   legacy text it writes onto `role_id`. The Director write, by contrast, only
//   ever FILLS a blank `role_id` or raises a plain Member. It never moves
//   anyone off a role you gave them: 0025's own backfill idiom, for 0025's own
//   reason.

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => !a.startsWith('--only=')))
const APPLY = flags.has('--apply')
const ONLY = (() => {
  const raw = args.find((a) => a.startsWith('--only='))
  if (!raw) return null
  const list = raw
    .slice('--only='.length)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.length ? new Set(list) : null
})()

if (flags.has('--help') || flags.has('-h')) {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/provision-people.mjs [--apply] [--only=user1,user2]',
      '',
      'Environment:',
      '  SUPABASE_URL              (or VITE_SUPABASE_URL)  https://<ref>.supabase.co',
      '  SUPABASE_ANON_KEY         (or VITE_SUPABASE_ANON_KEY)  the apikey header',
      '  ADMIN_ACCESS_TOKEN        an admin session token — RUNBOOK §1.1',
      '  SUPABASE_SERVICE_ROLE_KEY required for --apply (0016 pins display_name)',
      '',
      'Without --apply nothing is written. Without credentials the derived',
      'usernames are still printed, from the roster alone.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const UNKNOWN = args.filter(
  (a) => !['--apply', '--help', '-h', '--dry-run'].includes(a) && !a.startsWith('--only='),
)
if (UNKNOWN.length) {
  process.stderr.write(`Unknown option(s): ${UNKNOWN.join(' ')}\nTry --help.\n`)
  process.exit(2)
}

// ── the roster ──────────────────────────────────────────────────────────────
//
// Eighteen real colleagues. SPELL EVERY NAME EXACTLY AS GIVEN — a name is not a
// string to be tidied, and the transliteration Aziz supplied is the one these
// people answer to. `first` and `last` are what the username is derived from;
// `position` is display-only and gates nothing.
//
// `roleIntent` is what Aziz decided, not what the schema can express today:
//   'admin'    → full `workspace.admin`. Two people, and only two.
//   'director' → structure and vocabulary, but NOT members.manage. Seven people.
//                Written as 'member' today; see the header.
//   'member'   → a full member. Ahmed Alnaji is one of these BY HIS OWN
//                DECISION — the Executive Director is not a viewer, and no
//                read-only role ships. His view is served by altitude.
//
// `existingUsername` / `existingEmail` mark the two accounts that already
// exist. Both are load-bearing; see the header.
const ROSTER = [
  { first: 'Ahmed', last: 'Alnaji', position: 'Executive Director, UHR', roleIntent: 'member' },
  { first: 'Alhanouf', last: 'Alsamani', position: "Alnaji's Office", roleIntent: 'director' },
  { first: 'Nawaf', last: 'Alharbi', position: 'PMO Director', roleIntent: 'director' },
  { first: 'Massis', last: 'Ovansoff', position: 'Technical Director', roleIntent: 'director' },
  {
    first: 'Areej',
    last: 'Alhasawi',
    position: 'Business Operations & Product Director (Delegation)',
    roleIntent: 'director',
  },
  { first: 'Maher', last: 'Alshehri', position: 'Ayenati Business Director', roleIntent: 'director' },
  { first: 'Ahmed', last: 'Alkanhal', position: 'PMO Associate Director', roleIntent: 'director' },
  {
    first: 'Nasser',
    last: 'Alabri',
    position: 'PMO Associate Director',
    roleIntent: 'admin',
    // HIS USERNAME IS HIS LOGIN. Never derived, never changed. See the header.
    existingUsername: 'nasser',
  },
  { first: 'Sara', last: 'Alqhahtani', position: 'PMO (OB related)', roleIntent: 'director' },
  {
    first: 'Abdulrahman',
    last: 'Alhumaidan',
    position: 'OB Associate Director',
    roleIntent: 'member',
  },
  { first: 'Aseel', last: 'Altheeb', position: 'OB Associate Director', roleIntent: 'member' },
  { first: 'Ahmed', last: 'Alshengiti', position: 'Ayenati Associate Director', roleIntent: 'member' },
  { first: 'Hussain', last: 'Alharthi', position: 'IT Ops Associate Director', roleIntent: 'member' },
  { first: 'Mohammed', last: 'Alkherb', position: 'Product Associate Director', roleIntent: 'member' },
  { first: 'Sara', last: 'Alsaab', position: 'Integration Expert', roleIntent: 'member' },
  { first: 'Nada', last: 'Alsuwaida', position: 'Raqeeb Clinical Expert', roleIntent: 'member' },
  { first: 'Reema', last: 'Alsoairy', position: 'Developer', roleIntent: 'member' },
  // ── THE ONBOARDING TEAM ────────────────────────────────────────────────
  //
  // ⚠ THE PEOPLE DOING THE WORK WERE NOT IN THE WORKSPACE. The eighteen above
  //   are directors and associate directors; the nine below are the engineers
  //   whose names are on the Jira tickets, and between them they carry 71 of
  //   the 104 organizations on the map. `map_nodes.account_manager_id` is a
  //   foreign key into `profiles`, so until these rows exist the map cannot
  //   answer "who do I chase about Al Hamra Hospital" for two thirds of it —
  //   and no member can ever be shown their own work, because the roster
  //   excluded the workers.
  //
  //   Ordered by how many organizations each carries, which is also the order
  //   in which their absence was costing something.
  { first: 'Dema', last: 'Alkassim', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Riam', last: 'Alnasser', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Shatha', last: 'Alhuwaytan', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Khalid', last: 'Alghamdi', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Khalid', last: 'Almutairi', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Hind', last: 'Almubaraki', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Nawaf', last: 'Alfaqih', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Lama', last: 'Alsmay', position: 'Onboarding Engineer', roleIntent: 'member' },
  { first: 'Omar', last: 'Almohsen', position: 'Onboarding Engineer', roleIntent: 'member' },
  {
    first: 'Abdulaziz',
    last: 'Alsaloom',
    position: 'Admin (PMO Lead)',
    roleIntent: 'admin',
    // The workspace owner, on the bootstrap allow-list. Matched, never created.
    existingEmail: 'az.alsaloom@gmail.com',
  },
]

// ── username derivation ─────────────────────────────────────────────────────
//
// `first.last`, lowercased and ASCII-folded. THE SURNAME IS NOT OPTIONAL: there
// are three Ahmeds on this roster (Alnaji, Alkanhal, Alshengiti) and `ahmed`
// alone identifies none of them.
//
// The fold is NFD + strip combining marks, so a name that arrives carrying
// diacritics loses them rather than producing a username with a byte nobody can
// type at a sign-in form. Anything still outside [a-z0-9] after that is dropped
// — the `-` and `_` the function allows are for handles like `it-ops`, not for
// people's names.

/** One name part, folded to the ASCII a sign-in form can accept. */
function fold(part) {
  return part
    .normalize('NFD')
    // U+0300–U+036F, written as escapes: the literal characters are invisible
    // in an editor and one stray paste would silently widen or empty the class.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** The username this person will sign in with, or their existing one. */
function usernameFor(person) {
  if (person.existingUsername) return person.existingUsername
  return `${fold(person.first)}.${fold(person.last)}`
}

function displayNameFor(person) {
  return `${person.first} ${person.last}`
}

/**
 * Must stay byte-identical to USERNAME_RE in
 * supabase/functions/admin-members/index.ts:114 — 3–32 characters, lowercase,
 * starting and ending alphanumeric. Checked HERE so a bad transliteration is
 * refused on the local table rather than sixteen HTTP calls later.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/

/** Must stay byte-identical to USERNAME_EMAIL_DOMAIN in the two edge functions. */
const USERNAME_EMAIL_DOMAIN = '@opstrack.internal'

// ── plumbing ────────────────────────────────────────────────────────────────

const URL_BASE = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const ADMIN_TOKEN = process.env.ADMIN_ACCESS_TOKEN || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const out = (line = '') => process.stdout.write(`${line}\n`)

/**
 * A fixed-width table. Plain ASCII on purpose: this output is read in a
 * terminal, pasted into a chat, and — for the codes — read aloud.
 */
function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)),
  )
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ')
  out(`  ${line(headers)}`)
  out(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`)
  for (const r of rows) out(`  ${line(r)}`)
}

class ApiError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

/** One `admin-members` call, as the admin. Throws ApiError on any non-2xx. */
async function callFunction(body) {
  const res = await fetch(`${URL_BASE}/functions/v1/admin-members`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // A gateway HTML page. The status and the raw text are all there is.
  }
  if (!res.ok) {
    const code = payload && typeof payload.code === 'string' ? payload.code : `http_${res.status}`
    const msg = payload && typeof payload.error === 'string' ? payload.error : text.slice(0, 200)
    throw new ApiError(msg || `HTTP ${res.status}`, code)
  }
  return payload
}

/** One service-role request. `path` is everything after the origin. */
async function serviceFetch(path, init = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, payload, text }
}

// ── phase 1: derive, and show the derivation ────────────────────────────────

out('')
out('  NphiesCore — provisioning the workspace roster')
out(`  ${APPLY ? '*** --apply: THIS RUN WRITES ***' : 'dry run — nothing will be written'}`)
out('')

const people = ROSTER.map((person) => ({
  ...person,
  // `username` is the KEY this script works by — the map lookup, the --only
  // filter, the validity check. `identity` is what a human is shown, and for
  // the owner those two differ on purpose: he signs in with a real address, and
  // printing a derived `abdulaziz.alsaloom` beside his name is an invitation to
  // create it.
  username: usernameFor(person),
  identity: person.existingEmail ?? usernameFor(person),
  displayName: displayNameFor(person),
}))

out('  DERIVED USERNAMES — read this table before anything is created.')
out('  A username cannot be changed afterwards without locking its owner out.')
out('')
table(
  ['Name', 'Position', 'Signs in as', 'Role', 'Note'],
  people.map((p) => [
    p.displayName,
    p.position,
    p.identity,
    p.roleIntent,
    p.existingUsername
      ? 'EXISTS — this username IS the login, never derived'
      : p.existingEmail
        ? 'EXISTS — the workspace owner, on the bootstrap list'
        : '',
  ]),
)
out('')
out('  To correct a transliteration: edit ROSTER in this file and run the dry run again.')
out('')

// Refuse the whole run on a username the function would reject, or on a
// collision. A duplicate here would mean two colleagues sharing one login, and
// the second `create` would fail with `username_taken` halfway through a run —
// far better to catch it on the local table.
const problems = []
const seen = new Map()
for (const p of people) {
  if (!USERNAME_RE.test(p.username)) {
    problems.push(`${p.displayName}: "${p.username}" is not a valid username (3–32, a–z 0–9 . - _)`)
  }
  const prior = seen.get(p.username)
  if (prior) problems.push(`${p.displayName} and ${prior} both derive "${p.username}"`)
  else seen.set(p.username, p.displayName)
}
if (problems.length) {
  out('  REFUSING TO CONTINUE:')
  for (const line of problems) out(`    - ${line}`)
  out('')
  process.exit(1)
}

const targets = ONLY
  ? people.filter((p) => ONLY.has(p.username) || ONLY.has(p.identity.toLowerCase()))
  : people
if (ONLY) {
  const missed = [...ONLY].filter(
    (u) => !people.some((p) => p.username === u || p.identity.toLowerCase() === u),
  )
  if (missed.length) {
    out(`  REFUSING TO CONTINUE: --only names nobody on the roster: ${missed.join(', ')}`)
    out('')
    process.exit(1)
  }
  out(`  --only: acting on ${targets.length} of ${people.length} — ${targets.map((p) => p.username).join(', ')}`)
  out('')
}

// ── phase 2: what is already there ──────────────────────────────────────────

const missingCreds = []
if (!URL_BASE) missingCreds.push('SUPABASE_URL (or VITE_SUPABASE_URL)')
if (!ANON_KEY) missingCreds.push('SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)')
if (!ADMIN_TOKEN) missingCreds.push('ADMIN_ACCESS_TOKEN — RUNBOOK §1.1')

if (missingCreds.length) {
  out('  No live check: missing')
  for (const m of missingCreds) out(`    - ${m}`)
  out('')
  out('  The table above is the whole of what this run can tell you. Supply the')
  out('  credentials to see which accounts already exist.')
  out('')
  process.exit(APPLY ? 1 : 0)
}

out('  Reading the existing roster…')
let existing
try {
  const payload = await callFunction({ action: 'list' })
  existing = payload && Array.isArray(payload.members) ? payload.members : []
} catch (e) {
  out(`  FAILED to list members: ${e.message} [${e.code}]`)
  out('')
  if (e.code === 'not_signed_in') {
    out('  ADMIN_ACCESS_TOKEN is missing, expired or not a session token. It lives')
    out('  about an hour; take a fresh one per RUNBOOK §1.1.')
  }
  if (e.code === 'forbidden') out('  That token belongs to an account that is not an admin.')
  out('')
  process.exit(1)
}
out(`  ${existing.length} account(s) exist on this project.`)
out('')

const byUsername = new Map(
  existing.filter((m) => m.username).map((m) => [String(m.username).toLowerCase(), m]),
)
const byEmail = new Map(existing.map((m) => [String(m.email || '').toLowerCase(), m]))

/** Does `profiles.position` exist on this project? Probed, never assumed. */
let hasPositionColumn = false
let positionProbeNote = 'not probed (no service-role key)'
if (SERVICE_KEY) {
  const probe = await serviceFetch('/rest/v1/profiles?select=position&limit=1')
  hasPositionColumn = probe.ok
  positionProbeNote = probe.ok
    ? 'present — positions will be written to the column AND to user_metadata'
    : `absent (${(probe.payload && probe.payload.message) || `HTTP ${probe.status}`}) — positions go to user_metadata only`
}

/**
 * Has migration 0025 been APPLIED to this project?
 *
 * The file is on disk in this branch; whether it has run against the live
 * database is a different question and only the database can answer it. So this
 * probes for the table and reads the seeded keys, rather than assuming either
 * way — the same script has to work on a project that is one migration behind.
 */
let rolesByKey = null
let roleKeyById = new Map()
if (SERVICE_KEY) {
  const probe = await serviceFetch('/rest/v1/roles?select=id,key')
  if (probe.ok && Array.isArray(probe.payload)) {
    rolesByKey = new Map(probe.payload.map((r) => [r.key, r.id]))
    roleKeyById = new Map(probe.payload.map((r) => [r.id, r.key]))
  }
}
const hasRolesTable = rolesByKey !== null

/**
 * Everyone's current `role_id`, so the Director assignment can be idempotent.
 *
 * `admin-members`' list action predates 0025 and answers the legacy text
 * column, which cannot distinguish a Director from a Member — the trigger
 * derives both to 'member'. This is the only read that can.
 */
const roleIdByProfile = new Map()
if (hasRolesTable) {
  const rows = await serviceFetch('/rest/v1/profiles?select=id,role_id')
  if (rows.ok && Array.isArray(rows.payload)) {
    for (const r of rows.payload) roleIdByProfile.set(r.id, r.role_id ?? null)
  }
}

/**
 * May this script write the Director role onto this person?
 *
 * ONLY IF IT IS FILLING A BLANK OR RAISING A PLAIN MEMBER — 0025's own backfill
 * idiom, and for its reason: a re-run must never move somebody from a role
 * Aziz gave them to one this file guessed at. A person already holding
 * Director, Admin, or anything he invents later is left exactly alone.
 */
function mayAssignRole(profileId) {
  if (!hasRolesTable) return false
  const current = roleIdByProfile.get(profileId) ?? null
  return current === null || roleKeyById.get(current) === 'member'
}

// ── phase 3: the plan ───────────────────────────────────────────────────────
//
// Every person resolves to one row of intent. Nothing is written in this loop:
// the whole plan is printed first, and only then executed. That ordering is
// what makes `--apply` a decision rather than a surprise.

const plan = targets.map((p) => {
  const account = p.existingEmail
    ? byEmail.get(p.existingEmail.toLowerCase())
    : (byUsername.get(p.username) ?? byEmail.get(`${p.username}${USERNAME_EMAIL_DOMAIN}`))

  const steps = []
  const markedExisting = Boolean(p.existingUsername || p.existingEmail)

  if (!account && markedExisting) {
    // The two people the roster says already have accounts, and one of them is
    // not there. DO NOT FALL THROUGH TO CREATE. For Nasser that would mint an
    // invite code against the login he is using right now; for the owner it
    // would produce the second identity this whole file exists to avoid. An
    // absent account here means the roster is wrong about him, and a human has
    // to look — so the plan says "nothing" and says why.
    steps.push({ kind: 'missing', why: 'the roster says this account exists, and it does not' })
  } else if (!account) {
    steps.push({ kind: 'create', why: 'no account with this username' })
  } else {
    if ((account.display_name || '').trim() !== p.displayName) {
      steps.push({
        kind: 'name',
        why: `display name is "${(account.display_name || '').trim() || '(blank)'}"`,
      })
    }
    if (p.roleIntent === 'admin' && account.role !== 'admin') {
      steps.push({ kind: 'role', why: `role is "${account.role}"` })
    }
  }

  // The Director role, once 0025 has actually run. Admins keep going through
  // the edge function's `set-role` — it is the guarded, audited door, and
  // 0025's `profiles_role_sync()` bridges the legacy text it writes onto
  // `role_id` for us. Director has no such door, because `profiles.role` is
  // `check (role in ('admin','member'))` and always will be.
  if (p.roleIntent === 'director' && hasRolesTable) {
    const creating = steps.some((s) => s.kind === 'create')
    // A brand-new account is a plain Member by construction (0025's INSERT
    // branch), so it is always eligible; an existing one has to be checked.
    if (creating || (account && mayAssignRole(account.id))) {
      steps.push({ kind: 'roleId', why: 'Director — structure + vocabulary, not members.manage' })
    }
  }

  // Position is written on every run for everyone who will have an account by
  // the end of it: it is the one field this script owns end to end, it is
  // cheap, and re-running after the column lands is how it gets into the
  // column.
  if (account || steps.some((s) => s.kind === 'create')) {
    steps.push({
      kind: 'position',
      why: !SERVICE_KEY
        ? 'destination not probed — no service-role key'
        : hasPositionColumn
          ? 'column + metadata'
          : 'metadata only',
    })
  }

  return { person: p, account: account ?? null, steps }
})

/** One person's intent, in the words a human would use to approve it. */
function describeSteps(steps) {
  if (!steps.length) return 'nothing — already exactly as the roster says'
  return steps
    .map((s) => {
      if (s.kind === 'create') return 'CREATE + mint one-time invite code'
      if (s.kind === 'name') return `set display name (${s.why})`
      if (s.kind === 'role') return `promote to admin (${s.why})`
      if (s.kind === 'roleId') return `assign the Director role (${s.why})`
      if (s.kind === 'missing') return `NOTHING — ${s.why}`
      return `set position (${s.why})`
    })
    .join(' · ')
}

const creates = plan.filter((r) => r.steps.some((s) => s.kind === 'create'))
const renames = plan.filter((r) => r.steps.some((s) => s.kind === 'name'))
const promotes = plan.filter((r) => r.steps.some((s) => s.kind === 'role'))

out('  THE PLAN')
out('')
table(
  ['Signs in as', 'Name', 'What would happen'],
  plan.map((r) => [
    r.person.identity,
    r.person.displayName,
    describeSteps(r.steps),
  ]),
)
out('')

// The two loud paragraphs. These are printed on EVERY run, dry or not, because
// the whole risk of this script is somebody assuming it did the obvious thing.
const nasser = plan.find((r) => r.person.existingUsername)
if (nasser) {
  out('  ── NASSER ALABRI ──────────────────────────────────────────────────────')
  out(`  He ALREADY EXISTS as "${nasser.person.existingUsername}". That username IS his login`)
  out(`  (${nasser.person.existingUsername}${USERNAME_EMAIL_DOMAIN}); changing it locks him out, and a username`)
  out('  account has no self-service reset. NO ACCOUNT IS CREATED FOR HIM and no')
  out('  invite code is minted. He gets a display name, a position, and admin.')
  if (!nasser.account) {
    out('  ⚠ …except he was NOT FOUND on this project. Nothing will be done for him.')
    out('    Check the username before assuming it is missing.')
  }
  out('')
}
const owner = plan.find((r) => r.person.existingEmail)
if (owner) {
  out('  ── ABDULAZIZ ALSALOOM ─────────────────────────────────────────────────')
  out(`  The workspace owner, signing in as ${owner.person.existingEmail} — the`)
  out('  bootstrap address inside admin-members. NOT created as a username account:')
  out('  a second identity would split his history and sit off the bootstrap list.')
  if (!owner.account) {
    out('  ⚠ …except that address was NOT FOUND on this project. Nothing will be done.')
  }
  out('')
}

out(`  Summary: ${creates.length} to create · ${renames.length} name(s) to set · ${promotes.length} to promote to admin`)
out(`  profiles.position: ${positionProbeNote}`)
out('')

// The seven Directors — assigned if 0025 has run, deferred out loud if not.
const directors = plan.filter((r) => r.person.roleIntent === 'director')
const assignedDirectors = directors.filter((r) => r.steps.some((s) => s.kind === 'roleId'))
const currentRoleKey = (row) =>
  row.account ? roleKeyById.get(roleIdByProfile.get(row.account.id) ?? '') : undefined
// Already Director is not a deferral, it is the finished state — and telling a
// re-run's reader "still to do" about seven people who are done is how a
// correct script gets mistaken for a broken one.
const settledDirectors = directors.filter(
  (r) => !r.steps.some((s) => s.kind === 'roleId') && currentRoleKey(r) === 'director',
)
const deferredDirectors = directors.filter(
  (r) => !r.steps.some((s) => s.kind === 'roleId') && currentRoleKey(r) !== 'director',
)
if (assignedDirectors.length) {
  out(`  Director role: ${assignedDirectors.length} to assign — ${assignedDirectors.map((r) => r.person.username).join(', ')}`)
  out('  (structure.edit + vocab.edit + capture.write, and NOT members.manage.)')
  out('')
}
if (settledDirectors.length) {
  out(`  Director role: ${settledDirectors.length} already hold it — nothing to do.`)
  out('')
}
if (deferredDirectors.length) {
  out('  ── STILL TO DO, AND THIS SCRIPT CANNOT DO IT ──────────────────────────')
  out(`  ${deferredDirectors.length} people are meant to hold a DIRECTOR role — structure and vocabulary,`)
  out("  but NOT members.manage. profiles.role is check (role in ('admin','member')),")
  out('  so there is nowhere to put a third value; they stay members for now.')
  if (!hasRolesTable) {
    out('  Migration 0025 has NOT been applied to this project — no `roles` table.')
    out('  Apply it, then re-run this script: the assignment is idempotent and this')
    out('  block disappears. Nothing here is written to metadata as a placeholder;')
    out('  a permission key nothing checks would grant nothing and say otherwise.')
  } else {
    out('  These already hold a role this script will not overwrite. It only ever')
    out('  fills a blank role_id or raises a plain Member — never moves somebody')
    out('  off a role you gave them. Change these on the members admin screen.')
  }
  out(`  Them: ${deferredDirectors.map((r) => r.person.username).join(', ')}`)
  out('')
}

if (!APPLY) {
  out('  DRY RUN — nothing was written. Re-run with --apply to do the above.')
  out('')
  process.exit(0)
}

// ── phase 4: apply ──────────────────────────────────────────────────────────

if (!SERVICE_KEY) {
  out('  REFUSING TO APPLY: SUPABASE_SERVICE_ROLE_KEY is not set.')
  out('')
  out('  Migration 0016 pins profiles.display_name against every caller holding a')
  out('  JWT — an admin\'s included — so names and positions can only be written')
  out('  with the service role. Half a run is worse than none: the creates would')
  out('  succeed, the names would silently not.')
  out('')
  out('  Project Settings › API › service_role. Never put it in .env.')
  out('')
  process.exit(1)
}

if (!process.stdout.isTTY) {
  out('  ⚠ stdout is not a terminal. The invite codes below are going somewhere')
  out('    other than a screen. They are credentials — make sure that somewhere')
  out('    is not a file in this repository.')
  out('')
}

/** Write columns on a profiles row with the service role. 0016 requires it. */
async function setProfile(id, patch) {
  const res = await serviceFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    throw new ApiError(
      (res.payload && (res.payload.message || res.payload.error)) || `HTTP ${res.status}`,
      res.payload && res.payload.code,
    )
  }
}

/**
 * Merge keys into an auth user's `user_metadata`.
 *
 * READ FIRST, THEN SPREAD — the same defence `issueCode()` uses in the edge
 * function. `invite_hash`, `invite_issued_at` and `claimed` live in this bag,
 * and clobbering them would invalidate an outstanding invite or, worse, mark a
 * claimed account unclaimed and hand its owner's login back to a stale code.
 */
async function setMetadata(id, patch) {
  const got = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`)
  if (!got.ok) {
    throw new ApiError((got.payload && got.payload.msg) || `HTTP ${got.status}`, 'metadata_read')
  }
  const current = (got.payload && got.payload.user_metadata) || {}
  const put = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ user_metadata: { ...current, ...patch } }),
  })
  if (!put.ok) {
    throw new ApiError((put.payload && put.payload.msg) || `HTTP ${put.status}`, 'metadata_write')
  }
}

const minted = []
const failures = []
const done = []

for (const row of plan) {
  const { person } = row
  let account = row.account

  for (const step of row.steps) {
    try {
      if (step.kind === 'create') {
        const res = await callFunction({
          action: 'create',
          username: person.username,
          displayName: person.displayName,
          // Never 'admin' on create: the only two admins already have accounts,
          // and a fresh account minted straight into admin is a promotion
          // nobody watched happen.
          role: 'member',
        })
        account = { id: res.id, username: res.username, display_name: person.displayName, role: 'member' }
        minted.push({
          username: res.username,
          name: person.displayName,
          code: res.inviteCode,
          expires: String(res.expiresAt || '').slice(0, 10),
        })
        done.push(`created ${person.username}`)
      } else if (step.kind === 'name') {
        if (!account) continue
        await setProfile(account.id, { display_name: person.displayName })
        done.push(`named ${person.username}`)
      } else if (step.kind === 'role') {
        if (!account) continue
        await callFunction({ action: 'set-role', userId: account.id, role: 'admin' })
        done.push(`promoted ${person.username}`)
      } else if (step.kind === 'roleId') {
        if (!account) continue
        const directorId = rolesByKey && rolesByKey.get('director')
        if (!directorId) throw new ApiError('no role with key "director"', 'no_director_role')
        // Re-check on the way in. The plan was computed against a read taken
        // before the creates ran, and this is the one write that could move a
        // person off a role somebody else gave them.
        if (account.id && !mayAssignRole(account.id)) {
          throw new ApiError('already holds a role this script will not overwrite', 'role_held')
        }
        await setProfile(account.id, { role_id: directorId })
        roleIdByProfile.set(account.id, directorId)
        done.push(`director ${person.username}`)
      } else if (step.kind === 'position') {
        if (!account) continue
        if (hasPositionColumn) await setProfile(account.id, { position: person.position })
        await setMetadata(account.id, { display_name: person.displayName, position: person.position })
        done.push(`positioned ${person.username}`)
      }
    } catch (e) {
      // Never abort the run: this script is idempotent, so finishing the other
      // fifteen and reporting the one failure is strictly better than leaving
      // the roster half-provisioned with no record of where it stopped.
      failures.push(`${person.username}: ${step.kind} failed — ${e.message}${e.code ? ` [${e.code}]` : ''}`)
    }
  }
}

// ── phase 5: the codes ──────────────────────────────────────────────────────

out('')
out(`  Done: ${done.length} operation(s).`)
if (failures.length) {
  out('')
  out('  FAILURES — re-running is safe and will retry only these:')
  for (const f of failures) out(`    - ${f}`)
}
out('')

if (minted.length) {
  out('  ══ INVITE CODES ═══════════════════════════════════════════════════════')
  out('  READ ONCE. The project keeps only an HMAC of each of these; there is no')
  out('  path anywhere that can show one again — only reissue, which resets that')
  out('  person\'s password. Hand each pair over in person or on a call, not by')
  out('  email: these accounts have no inbox by design.')
  out('')
  table(
    ['Username', 'Name', 'Code', 'Use before'],
    minted.map((m) => [m.username, m.name, m.code, m.expires]),
  )
  out('')
  out('  What to tell each person:')
  out('    Open the app, tap "First time here? Claim your account", enter your')
  out('    username and the code, and pick a password of at least 8 characters.')
  out('')
}

process.exit(failures.length ? 1 : 0)
