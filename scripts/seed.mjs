#!/usr/bin/env node
// OpsTrack demo seed — ~34 entries across all six tracks, with the spread of
// ages, owners, statuses, priorities and tags the screens are designed around.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service key> \
//   npm run seed
//
// Flags: --force (insert even when entries already exist) · --dry-run (build
// and report, write nothing) · --help.
//
// THIS SCRIPT CREATES NO TRACKS. The six tracks are schema — five from 0001,
// Onboarding from 0004 — and they carry ids that entries, meetings and
// templates already reference. A seed that invented its own would either
// duplicate them or fail the lower(name) unique index, and on a workspace that
// has been used it would be the one destructive thing in an otherwise additive
// script. If a track is missing, this exits and tells you to run the migration.
//
// It uses the SERVICE ROLE key, not the anon key, for two reasons that are not
// convenience: entries_insert requires `created_by = auth.uid()` and this
// script has no session, and every row here is backdated — created_at and
// last_activity_at are written explicitly so the follow-ups sections and the age
// pills have something to show on the day you seed. The key therefore never goes
// in .env (which Vite inlines into the bundle); pass it on the command line or
// through `node --env-file=.env.seed`.
//
// The SLA badges stay EMPTY after a seed, and that is correct: 0005 ships
// sla_days NULL on all four priorities, so the workspace has made no timing
// commitment yet and nothing can have missed one. To demo the SLA surfaces, set
// a target first — that is the same one-statement act a real admin performs:
//   update public.vocab_options set sla_days = 3 where kind='priority' and key='high';
//
// SIDE EFFECT, on purpose and worth knowing: every entry seeded with an
// owner_id fires the `assigned` notification trigger from 0004, so the owners
// will each open the app to a populated inbox. That is what makes the
// notification centre demonstrable. To start clean instead:
//   delete from public.notifications;

const args = new Set(process.argv.slice(2))
const FORCE = args.has('--force')
const DRY_RUN = args.has('--dry-run')

if (args.has('--help') || args.has('-h')) {
  process.stdout.write(
    'Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run seed [-- --force] [-- --dry-run]\n',
  )
  process.exit(0)
}

const URL_BASE = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!URL_BASE || !SERVICE_KEY) {
  fail(
    'Missing credentials.\n' +
      '  SUPABASE_URL              (or VITE_SUPABASE_URL) — https://<ref>.supabase.co\n' +
      '  SUPABASE_SERVICE_ROLE_KEY — Project Settings › API › service_role\n\n' +
      'The service_role key bypasses RLS. Never put it in .env — Vite inlines that file\n' +
      'into the browser bundle. Pass it on the command line or via --env-file.',
  )
}

// ── the shape of the demo workspace ─────────────────────────────────────────
//
// `age` is days since creation AND since last activity unless `quiet` says
// otherwise: an item worked on yesterday but opened three weeks ago is a
// different signal from one nobody has touched since it was raised, and
// v_entry_health reads the second number. `quiet` is what produces the stale
// section; `due` in the past is what produces overdue.
//
// Owners are symbolic — 'me' is the first admin, 'team' rotates through the
// remaining profiles, 'vendor:X' is the free-text owner_name path (a supplier
// or another department, which the spec treats as a first-class owner), and
// null is deliberately unassigned so the follow-ups screen has its fifth
// section. On a fresh workspace with exactly one profile, 'team' collapses onto
// that profile; the mix survives, it just has fewer names in it.
//
// Six titles are Arabic on purpose. The RTL audit in Wave 5 needs real
// bidirectional rows in the list, and a workspace where every title is Latin
// hides exactly the bugs that audit is looking for.
const PLAN = [
  // ── PMO ───────────────────────────────────────────────────────────────────
  { track: 'PMO', title: 'Q3 portfolio review pack for the steering committee',
    type: 'action', status: 'in_progress', priority: 'high', owner: 'me',
    age: 9, quiet: 1, due: 4, followUp: 2, tags: ['reporting', 'quarterly'],
    desc: 'One slide per programme: spend to date, RAG, and the three decisions we need from the committee.' },
  { track: 'PMO', title: 'Vendor contract renewal — network monitoring platform',
    type: 'decision', status: 'waiting_on', priority: 'high', owner: 'vendor:Procurement',
    age: 22, quiet: 8, due: 11, tags: ['contract', 'renewal'],
    desc: 'Three-year renewal on the table. Legal wants the exit clause rewritten before we sign.' },
  { track: 'PMO', title: 'تحديث خطة المشاريع للربع القادم',
    type: 'action', status: 'new', priority: 'medium', owner: 'team',
    age: 3, due: 14, tags: ['planning'],
    desc: 'مراجعة النطاق والموارد لكل مشروع قبل اجتماع اللجنة.' },
  { track: 'PMO', title: 'Close out the data-centre migration programme',
    type: 'action', status: 'done', priority: 'medium', owner: 'me',
    age: 61, quiet: 12, tags: ['programme', 'closure'],
    desc: 'Benefits realised, lessons logged, budget released.' },
  { track: 'PMO', title: 'Weekly status roll-up is being assembled by hand',
    type: 'issue', status: 'blocked', priority: 'medium', owner: null,
    age: 34, quiet: 19, tags: ['reporting', 'toil'],
    desc: 'Four people copy-paste the same numbers every Sunday. Blocked on getting read access to the finance export.' },

  // ── IT Operations ─────────────────────────────────────────────────────────
  { track: 'IT Operations', title: 'Service desk backlog above 200 tickets for a third week',
    type: 'escalation', status: 'in_progress', priority: 'critical', owner: 'me',
    age: 17, quiet: 0, due: -2, tags: ['servicedesk', 'backlog'],
    desc: 'Two agents on leave and the laptop refresh landed in the same fortnight.' },
  { track: 'IT Operations', title: 'Retire the legacy print server',
    type: 'change', status: 'waiting_on', priority: 'low', owner: 'team',
    age: 47, quiet: 21, due: 30, tags: ['decommission'],
    desc: 'Two departments still print to it. Waiting on Finance to confirm they have moved.' },
  { track: 'IT Operations', title: 'مراجعة صلاحيات الوصول للأنظمة الحساسة',
    type: 'action', status: 'in_progress', priority: 'high', owner: 'team',
    age: 12, quiet: 3, due: 6, followUp: 3, tags: ['access', 'audit'],
    desc: 'قائمة المستخدمين لكل نظام، وإزالة الصلاحيات غير المستخدمة منذ ٩٠ يوماً.' },
  { track: 'IT Operations', title: 'Mailbox quota increase for the finance team',
    type: 'request', status: 'done', priority: 'low', owner: 'me',
    age: 26, quiet: 20, tags: ['email'],
    desc: 'Raised to 50 GB for the eleven accounts named in the request.' },
  { track: 'IT Operations', title: 'Standardise the laptop build image',
    type: 'action', status: 'new', priority: 'medium', owner: null,
    age: 8, tags: ['endpoint', 'standards'],
    desc: 'Three images in circulation, none documented. One image, one document, one owner.' },
  { track: 'IT Operations', title: 'Shared drive permissions review flagged 40 open folders',
    type: 'issue', status: 'blocked', priority: 'high', owner: 'team',
    age: 29, quiet: 14, due: -6, tags: ['access', 'audit'],
    desc: 'Blocked: nobody can name the owner of the largest three.' },

  // ── Network ───────────────────────────────────────────────────────────────
  { track: 'Network', title: 'Core switch firmware upgrade — maintenance window',
    type: 'change', status: 'in_progress', priority: 'critical', owner: 'me',
    age: 5, quiet: 0, due: 2, followUp: 1, tags: ['maintenance', 'firmware'],
    desc: 'Two-hour window, Friday 01:00. Rollback plan written and tested on the lab pair.' },
  { track: 'Network', title: 'Intermittent packet loss on the branch VPN',
    type: 'issue', status: 'in_progress', priority: 'high', owner: 'team',
    age: 14, quiet: 2, due: 1, tags: ['vpn', 'incident'],
    desc: 'Loss spikes between 13:00 and 15:00. Correlates with the backup window, not proven yet.' },
  { track: 'Network', title: 'ترقية نقاط الوصول اللاسلكية في المبنى الرئيسي',
    type: 'change', status: 'new', priority: 'medium', owner: 'team',
    age: 6, due: 25, tags: ['wifi'],
    desc: 'أربعون نقطة وصول، تُستبدل على ثلاث مراحل خارج ساعات العمل.' },
  { track: 'Network', title: 'Guest wifi captive portal certificate expires next month',
    type: 'action', status: 'new', priority: 'high', owner: null,
    age: 2, due: 27, followUp: 10, tags: ['certificates', 'wifi'],
    desc: 'Renew and stage before the expiry, not on the day.' },
  { track: 'Network', title: 'Document the DR site link topology',
    type: 'action', status: 'blocked', priority: 'low', owner: 'vendor:Etisalat',
    age: 52, quiet: 33, tags: ['documentation', 'dr'],
    desc: 'Blocked on the carrier confirming the second path is genuinely diverse.' },
  { track: 'Network', title: 'Decommission the old MPLS circuit',
    type: 'change', status: 'cancelled', priority: 'medium', owner: 'me',
    age: 40, quiet: 30, tags: ['decommission', 'cost'],
    desc: 'Cancelled — the contract runs to year end and there is no early exit.' },

  // ── Infrastructure ────────────────────────────────────────────────────────
  { track: 'Infrastructure', title: 'Backup job failing silently on the ERP volume',
    type: 'issue', status: 'in_progress', priority: 'critical', owner: 'me',
    age: 4, quiet: 0, due: 0, tags: ['backup', 'incident'],
    desc: 'The job reports success and writes nothing. Last verified restore was in April.' },
  { track: 'Infrastructure', title: 'Storage array at 84% — plan the expansion',
    type: 'action', status: 'new', priority: 'high', owner: 'team',
    age: 11, due: 20, followUp: 5, tags: ['capacity', 'storage'],
    desc: 'At the current growth rate we hit 90% in seven weeks. Quote requested.' },
  { track: 'Infrastructure', title: 'توثيق إجراءات التعافي من الكوارث',
    type: 'action', status: 'waiting_on', priority: 'high', owner: 'team',
    age: 24, quiet: 9, due: 16, tags: ['dr', 'documentation'],
    desc: 'بانتظار موافقة الإدارة على زمن التعافي المستهدف قبل إكمال المستند.' },
  { track: 'Infrastructure', title: 'Virtualisation host licence renewal',
    type: 'request', status: 'waiting_on', priority: 'medium', owner: 'vendor:Procurement',
    age: 19, quiet: 7, due: 9, tags: ['licence', 'renewal'],
    desc: 'Quote with Procurement. Renewal date is fixed and does not move.' },
  { track: 'Infrastructure', title: 'UPS battery replacement in rack row B',
    type: 'action', status: 'done', priority: 'high', owner: 'team',
    age: 33, quiet: 15, tags: ['datacentre', 'maintenance'],
    desc: 'Replaced and load-tested. Next check scheduled with the annual PM.' },
  { track: 'Infrastructure', title: 'Old test servers still drawing power',
    type: 'issue', status: 'new', priority: 'low', owner: null,
    age: 68, quiet: 41, tags: ['cost', 'decommission'],
    desc: 'Nine hosts nobody claims. Power them down for a fortnight and see who shouts.' },

  // ── SRE ───────────────────────────────────────────────────────────────────
  { track: 'SRE', title: 'Alert fatigue — 300 pages last month, 6 actionable',
    type: 'issue', status: 'in_progress', priority: 'high', owner: 'me',
    age: 21, quiet: 1, due: 7, followUp: 4, tags: ['alerting', 'toil'],
    desc: 'Every noisy alert either gets a threshold that means something or gets deleted.' },
  { track: 'SRE', title: 'Post-incident review — payment gateway outage',
    type: 'action', status: 'waiting_on', priority: 'critical', owner: 'team',
    age: 7, quiet: 4, due: -1, tags: ['incident', 'review'],
    desc: 'Timeline drafted. Waiting on the vendor RCA before we publish ours.' },
  { track: 'SRE', title: 'Define SLOs for the three tier-1 services',
    type: 'decision', status: 'new', priority: 'medium', owner: 'team',
    age: 15, quiet: 10, due: 21, tags: ['slo', 'standards'],
    desc: 'Availability and latency targets the business will actually recognise.' },
  { track: 'SRE', title: 'مراقبة زمن الاستجابة لبوابة الخدمات',
    type: 'action', status: 'in_progress', priority: 'medium', owner: 'team',
    age: 13, quiet: 5, tags: ['monitoring'],
    desc: 'إضافة لوحة قياس لزمن الاستجابة من ثلاث مناطق جغرافية.' },
  { track: 'SRE', title: 'Runbook for the nightly reconciliation job',
    type: 'action', status: 'blocked', priority: 'low', owner: null,
    age: 44, quiet: 26, tags: ['documentation', 'toil'],
    desc: 'Blocked: the only person who knows the failure modes is on secondment.' },
  { track: 'SRE', title: 'Chaos test the failover path',
    type: 'action', status: 'cancelled', priority: 'medium', owner: 'me',
    age: 55, quiet: 38, tags: ['dr', 'testing'],
    desc: 'Cancelled for this quarter — deferred until the DR documentation exists.' },

  // ── Onboarding ────────────────────────────────────────────────────────────
  // Every Onboarding row carries exactly one of the two suggested tags, because
  // that is the split the track exists to report on: an entity is integrated
  // directly or it is handed the portal, and mixing both on one row makes the
  // breakdown meaningless.
  { track: 'Onboarding', title: 'Al-Rajhi — direct integration, UAT phase',
    type: 'action', status: 'in_progress', priority: 'high', owner: 'me',
    age: 18, quiet: 2, due: 5, followUp: 3, tags: ['direct-integration', 'uat'],
    desc: 'Endpoints delivered, credentials issued. UAT sign-off expected this week.' },
  { track: 'Onboarding', title: 'Ministry of Health — portal accounts for 12 users',
    type: 'request', status: 'in_progress', priority: 'medium', owner: 'team',
    age: 10, quiet: 3, due: 8, tags: ['portal', 'accounts'],
    desc: 'Twelve named users, two of them administrators. Training session booked.' },
  { track: 'Onboarding', title: 'ربط شركة النقل الوطنية عبر التكامل المباشر',
    type: 'action', status: 'new', priority: 'high', owner: 'team',
    age: 5, due: 18, tags: ['direct-integration'],
    desc: 'بانتظار عنوان الـIP الثابت من الطرف الآخر لفتح المنفذ.' },
  { track: 'Onboarding', title: 'Portal handover pack is out of date',
    type: 'issue', status: 'blocked', priority: 'medium', owner: null,
    age: 37, quiet: 23, tags: ['portal', 'documentation'],
    desc: 'Screenshots predate the redesign. Blocked on getting the new brand assets.' },
  { track: 'Onboarding', title: 'Saudi Post — direct integration went live',
    type: 'action', status: 'done', priority: 'high', owner: 'me',
    age: 29, quiet: 16, tags: ['direct-integration'],
    desc: 'Live since the 12th, first week clean. Moved to business-as-usual support.' },
  { track: 'Onboarding', title: 'Escalation: portal onboarding taking six weeks',
    type: 'escalation', status: 'waiting_on', priority: 'critical', owner: 'vendor:Business Ops',
    age: 25, quiet: 6, due: -4, tags: ['portal', 'process'],
    desc: 'Target is ten working days. Waiting on Business Ops to agree who approves the account request.' },
]

// ── helpers ─────────────────────────────────────────────────────────────────

function fail(message) {
  process.stderr.write(`\nseed: ${message}\n\n`)
  process.exit(1)
}

/** ISO instant `n` days before now, at a plausible working hour rather than
 *  exactly now-minus-n — every row sharing a timestamp to the millisecond
 *  reads as a machine and sorts arbitrarily. */
function daysAgo(n, hourSeed) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(8 + (hourSeed % 9), (hourSeed * 17) % 60, (hourSeed * 7) % 60, 0)
  return d.toISOString()
}

/** ISO date (YYYY-MM-DD) `n` days from today; negative is the past. Built from
 *  local calendar parts, never from toISOString().slice(0,10), which is UTC and
 *  reads back as yesterday west of Greenwich. */
function dateIn(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    fail(`${init.method || 'GET'} ${path} → ${res.status}\n${text}`)
  }
  return { body: text ? JSON.parse(text) : null, headers: res.headers }
}

// ── run ─────────────────────────────────────────────────────────────────────

const { body: tracks } = await rest('tracks?select=id,name,archived&order=sort_order')
const trackByName = new Map(tracks.map((t) => [t.name.toLowerCase(), t]))

const wanted = [...new Set(PLAN.map((p) => p.track))]
const missing = wanted.filter((n) => !trackByName.has(n.toLowerCase()))
if (missing.length) {
  fail(
    `these tracks do not exist: ${missing.join(', ')}\n` +
      'This script creates no tracks — apply supabase/migrations/0001 and 0004 first.',
  )
}

const { body: profiles } = await rest('profiles?select=id,display_name,role&order=created_at')
if (!profiles.length) {
  fail('no profiles exist yet. Sign in once so the first admin profile is created, then re-run.')
}
const admin = profiles.find((p) => p.role === 'admin') || profiles[0]
const others = profiles.filter((p) => p.id !== admin.id)

// The re-run guard. `count=exact` reports the whole table in Content-Range
// while `limit=1` keeps the body to a single id. (A `Range: 0-0` header would
// read better and answers 416 on an empty table, which is a hard failure here.)
const { headers: countHeaders } = await rest('entries?select=id&limit=1', {
  headers: { Prefer: 'count=exact' },
})
const existing = Number((countHeaders.get('content-range') || '*/0').split('/')[1] || 0)

if (existing > 0 && !FORCE) {
  fail(
    `entries already has ${existing} row(s).\n` +
      'Seeding on top would double every demo row and make the dashboard lie.\n' +
      'Re-run with --force if that is genuinely what you want.',
  )
}

const rows = PLAN.map((p, i) => {
  const track = trackByName.get(p.track.toLowerCase())
  const quiet = p.quiet === undefined ? p.age : p.quiet

  // owner_id and owner_name are mutually exclusive (entries_single_owner).
  let ownerId = null
  let ownerName = null
  if (p.owner === 'me') ownerId = admin.id
  else if (p.owner === 'team') ownerId = others.length ? others[i % others.length].id : admin.id
  else if (typeof p.owner === 'string' && p.owner.startsWith('vendor:')) ownerName = p.owner.slice(7)

  return {
    track_id: track.id,
    title: p.title,
    description: p.desc || '',
    type: p.type,
    status: p.status,
    priority: p.priority,
    owner_id: ownerId,
    owner_name: ownerName,
    due_date: p.due === undefined ? null : dateIn(p.due),
    follow_up_date: p.followUp === undefined ? null : dateIn(p.followUp),
    tags: p.tags || [],
    links: [],
    created_by: admin.id,
    created_at: daysAgo(p.age, i),
    updated_at: daysAgo(quiet, i),
    // The column staleness is measured from. Written explicitly because the
    // default is now(), and a workspace where nothing is stale demonstrates
    // none of the screens that exist to surface stale work.
    last_activity_at: daysAgo(quiet, i),
  }
})

if (DRY_RUN) {
  process.stdout.write(`\nseed --dry-run: ${rows.length} entries would be written\n`)
  summarise(rows)
  process.exit(0)
}

// Chunked so one oversized request cannot fail the whole run, and so a partial
// failure leaves a legible boundary rather than an all-or-nothing mystery.
const CHUNK = 12
let written = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const { body } = await rest('entries', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(rows.slice(i, i + CHUNK)),
  })
  written += body.length
}

process.stdout.write(`\nseed: wrote ${written} entries.\n`)
summarise(rows)

const { headers: notifHeaders } = await rest('notifications?select=id&limit=1', {
  headers: { Prefer: 'count=exact' },
})
const notifs = Number((notifHeaders.get('content-range') || '*/0').split('/')[1] || 0)
if (notifs > 0) {
  process.stdout.write(
    `\n  ${notifs} notification(s) were written by the 0004 triggers — one per assigned entry.\n` +
      '  That is the notification centre having something to show. To start clean:\n' +
      '  delete from public.notifications;\n',
  )
}

function summarise(list) {
  const by = (key) =>
    [...list.reduce((m, r) => m.set(r[key], (m.get(r[key]) || 0) + 1), new Map())]
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')

  const trackName = new Map(tracks.map((t) => [t.id, t.name]))
  const perTrack = [...list.reduce((m, r) => m.set(trackName.get(r.track_id), (m.get(trackName.get(r.track_id)) || 0) + 1), new Map())]
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')

  const owned = list.filter((r) => r.owner_id).length
  const named = list.filter((r) => r.owner_name).length
  const oldest = list.reduce((max, r) => Math.max(max, Date.now() - Date.parse(r.last_activity_at)), 0)

  process.stdout.write(
    `  tracks     ${perTrack}\n` +
      `  status     ${by('status')}\n` +
      `  priority   ${by('priority')}\n` +
      `  owners     assigned ${owned} · free-text ${named} · unassigned ${list.length - owned - named}\n` +
      `  quietest   ${Math.round(oldest / 86400000)} days without activity\n` +
      `  overdue    ${list.filter((r) => r.due_date && r.due_date < dateIn(0)).length} past due · ` +
      `${list.filter((r) => r.follow_up_date).length} with a follow-up date\n`,
  )
}
