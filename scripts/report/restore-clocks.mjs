// Put back the staleness clock that --retag knocked over. DRY RUN unless --apply.
//
// ── WHAT HAPPENED ─────────────────────────────────────────────────────────
//
// `tickets.mjs --retag` PATCHed `tags` on 577 activities to add their use case.
// `entries_touch()` (0016) treats any real field change as activity and stamps
// `last_activity_at := now()`, so all 577 clocks jumped to today and the
// portfolio's "gone quiet" reading collapsed from 590 stalled to 42.
//
// That is precisely the failure tickets.mjs's own header warns about in its
// third paragraph — "an import that quietly resets the clock is worse than no
// import, because the number it invents looks fine" — committed by the script
// that carries the warning. It was not visible in any test: the clock is
// database behaviour, and the retag's own output said nothing about it.
//
// ── WHY `created_at` IS THE RIGHT ANSWER AND NOT A GUESS ──────────────────
//
// The original import wrote `last_activity_at: t.createdAt` — the same value as
// `created_at`, from the Jira date — and `created_at` was never touched, because
// `entries_touch()` only moves `updated_at` and `last_activity_at`.
//
// The proof that no genuine activity is being erased is in the rows the retag
// did not reach: 42 activities carry no use case, were never PATCHed, and
// every one of them still has `last_activity_at` exactly equal to `created_at`.
// Nobody has used this workspace, `entry_updates` is empty, and so there is no
// post-import activity anywhere in the table to lose.
//
// ── WHY THE PATCH WILL NOT SIMPLY BOUNCE ──────────────────────────────────
//
// `entries_touch()` subtracts `last_activity_at` from the diff it tests, so a
// statement that changes ONLY that column is seen as "no real change" and the
// function leaves the value alone. Writing anything else in the same PATCH
// would stamp it back to now(), which is why this sends one column and nothing
// else.

import { writeFileSync } from 'node:fs'
import { all, env } from './extract.mjs'

const URL_BASE = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/u, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const APPLY = process.argv.includes('--apply')
// The day the damage was done. Passed in rather than defaulted to "today" so a
// run tomorrow repairs the same rows instead of a different set.
const DAY = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-26'

const rows = await all('entries?select=id,title,created_at,last_activity_at')
const damaged = rows.filter(
  (r) =>
    r.created_at &&
    r.last_activity_at &&
    r.last_activity_at.slice(0, 10) === DAY &&
    r.created_at.slice(0, 10) !== DAY &&
    r.last_activity_at > r.created_at,
)
const intact = rows.filter((r) => r.created_at === r.last_activity_at)

const days = (iso) => Math.round((new Date(`${DAY}T23:59:59Z`) - new Date(iso)) / 86400000)
const ages = damaged.map((r) => days(r.created_at)).sort((a, b) => a - b)

console.log(`activities              ${rows.length}`)
console.log(`  clocks stamped ${DAY}  ${damaged.length}`)
console.log(`  still equal to created  ${intact.length}  ← the proof the rule held`)
if (damaged.length) {
  console.log(`  restoring these ages    median ${ages[Math.floor(ages.length / 2)]}d · oldest ${ages.at(-1)}d`)
  console.log(`  over a year old         ${ages.filter((d) => d > 365).length}`)
}

if (!APPLY) { console.log('\nDRY RUN — nothing was written. Re-run with --apply.'); process.exit(0) }
if (!damaged.length) { console.log('\nnothing to restore.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const file = `docs/EVIDENCE/import-runs/restore-clocks-${stamp}.json`
writeFileSync(file, JSON.stringify({
  kind: 'activity-clock-restore', at: new Date().toISOString(), day: DAY,
  rows: damaged.map((r) => ({ id: r.id, from: r.last_activity_at, to: r.created_at })),
}, null, 1))
console.log(`\nmanifest written first: ${file}`)

let n = 0
for (const r of damaged) {
  // ONE COLUMN, for the reason in the header.
  const res = await fetch(`${URL_BASE}/rest/v1/entries?id=eq.${r.id}`, {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ last_activity_at: r.created_at }),
  })
  if (!res.ok) throw new Error(`restore ${r.id} -> ${res.status} ${(await res.text()).slice(0, 160)}`)
  n += 1
  if (n % 50 === 0 || n === damaged.length) process.stdout.write(`\r  restored ${n}/${damaged.length}`)
}
console.log(`\ndone — ${n} clocks put back`)
