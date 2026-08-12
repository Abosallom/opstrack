#!/usr/bin/env node
// check-env — put the service_role key into .env.local, and prove it is the
// right one.
//
//   node scripts/check-env.mjs                  # what is in the file now?
//   node scripts/check-env.mjs --paste          # take it from the clipboard
//
// ── WHY --paste EXISTS, AND WHY IT IS THE RECOMMENDED ROUTE ────────────────
//
// `.env.local` is a dotfile: Finder hides it, so there is no double-click that
// opens it, and the obvious terminal alternative —
//
//     echo "SUPABASE_SERVICE_ROLE_KEY=eyJhb..." >> .env.local
//
// — is the worst option available. It writes the secret into `~/.zsh_history`
// in plaintext, where it outlives every rotation, and it prints it to a terminal
// that may be shared, screenshotted or scrolled back through.
//
// `--paste` reads the clipboard in-process. The value goes clipboard → file. It
// is never an argument (so never in shell history), never written to stdout, and
// never visible. The only thing printed is the `role` claim.
//
// It also REFUSES to write anything that is not a service_role key, which is the
// mistake actually worth preventing: `anon` and `service_role` are the same
// shape, both start `eyJ`, and sit one row apart in the dashboard.
//
// IT PRINTS NO SECRET, EVER, and that is the whole reason it exists. A Supabase
// legacy key is a JWT whose middle segment is unencrypted base64url, so the role
// it carries can be read locally without a network call and without the value
// ever reaching a terminal, a log, a screenshot or a chat window. The `anon` and
// `service_role` keys are the same shape, sit one row apart in the dashboard,
// and both start `eyJ` — so copying the wrong one is the obvious mistake, and
// the error it causes later is a 401 several steps downstream rather than
// anything that names the cause.
//
// The claim being read is `role`, which Supabase signs into the key itself. It
// is authoritative about WHICH key this is; it says nothing about whether the
// key is still valid, because that is the server's answer and this file makes no
// requests. `scripts/import-structure.mjs` gives the real one on its first read.

import { execFileSync } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FILE = resolve(process.cwd(), '.env.local')
const PASTE = process.argv.slice(2).includes('--paste')

/** The `role` claim, or null when this is not a readable JWT. */
function roleOf(key) {
  const segments = key.split('.')
  if (segments.length !== 3) return null
  try {
    // base64url, which Buffer's 'base64' decoder accepts once - and _ are folded
    // back. A truncated paste throws here rather than yielding a wrong answer.
    const json = Buffer.from(segments[1].replace(/-/gu, '+').replace(/_/gu, '/'), 'base64')
    return JSON.parse(json.toString('utf8'))
  } catch {
    return null
  }
}

let text
try {
  text = readFileSync(FILE, 'utf8')
} catch {
  console.log(`\n  ✗ No .env.local at ${FILE}\n`)
  process.exit(1)
}

/* ── --paste: clipboard → file, without the value ever being displayed ────── */

if (PASTE) {
  let clip = ''
  try {
    // pbpaste is macOS; the whole point is that the value arrives here as data
    // rather than as an argv entry a shell would record.
    clip = execFileSync('pbpaste', { encoding: 'utf8' })
  } catch {
    console.log('\n  ✗ Could not read the clipboard (pbpaste failed).')
    console.log('    Edit .env.local by hand instead: open -e .env.local\n')
    process.exit(1)
  }

  // Trim hard. Copying out of a web page picks up a trailing newline, and a
  // double-click selection can bring a leading space; either would be stored
  // verbatim and rejected by PostgREST with a 401 that names nothing.
  const candidate = clip.trim().replace(/^["']|["']$/gu, '')

  if (!candidate) {
    console.log('\n  ✗ The clipboard is empty. Copy the key first, then re-run.\n')
    process.exit(1)
  }

  const claims = roleOf(candidate)
  if (claims === null) {
    console.log('\n  ✗ The clipboard does not hold a Supabase key.')
    console.log('    Expected three dot-separated parts starting `eyJ`.')
    console.log('    NOTHING WAS WRITTEN — the file is unchanged.\n')
    process.exit(1)
  }
  if (claims.role !== 'service_role') {
    console.log(`\n  ✗ The clipboard holds the ${String(claims.role)} key, not service_role.`)
    console.log('    In the dashboard\'s "Legacy API keys" tab, take the SECOND row.')
    console.log('    NOTHING WAS WRITTEN — the file is unchanged.\n')
    process.exit(1)
  }

  const line = `SUPABASE_SERVICE_ROLE_KEY=${candidate}`
  const next = /^SUPABASE_SERVICE_ROLE_KEY=.*$/mu.test(text)
    ? text.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/mu, line)
    : `${text.replace(/\n*$/u, '')}\n${line}\n`

  writeFileSync(FILE, next, 'utf8')
  // Owner-only. A secrets file that any process running as another user on this
  // machine can read is a secrets file in name only.
  chmodSync(FILE, 0o600)
  text = next
  console.log('\n  ✓ Written to .env.local (mode 600), never displayed.')
}

const url = /^SUPABASE_URL=(.*)$/mu.exec(text)?.[1].trim() ?? ''
const key = /^SUPABASE_SERVICE_ROLE_KEY=(.*)$/mu.exec(text)?.[1].trim() ?? ''

console.log('')
console.log(`  SUPABASE_URL                ${url || '— not set'}`)

if (!key) {
  console.log('  SUPABASE_SERVICE_ROLE_KEY   — not set yet')
  console.log('')
  console.log('  Supabase dashboard → Project Settings → API Keys → the')
  console.log('  "Legacy API keys" tab → the service_role row → Reveal → copy.')
  console.log('  Paste it into .env.local after the = and run this again.')
  console.log('')
  process.exit(1)
}

const claims = roleOf(key)
if (claims === null) {
  console.log('  SUPABASE_SERVICE_ROLE_KEY   ✗ not a readable Supabase key')
  console.log('')
  console.log('  A legacy Supabase key is three dot-separated parts starting `eyJ`.')
  console.log('  A partial copy or a stray quote will land here.')
  console.log('')
  process.exit(1)
}

const role = String(claims.role ?? '(no role claim)')
const ok = role === 'service_role'

console.log(`  SUPABASE_SERVICE_ROLE_KEY   role: ${role}   project: ${String(claims.ref ?? '?')}`)
console.log('')
console.log(
  ok
    ? '  ✓ Correct key. Nothing was printed but the role — the key itself stays in the file.'
    : `  ✗ That is the ${role} key, one row above the one you want. Go back to the\n    "Legacy API keys" tab and take the service_role row instead.`,
)

if (ok && claims.ref && url && !url.includes(String(claims.ref))) {
  console.log(`\n  ⚠ The key belongs to project ${String(claims.ref)}, which is not the`)
  console.log('    project in SUPABASE_URL. One of the two is from another workspace.')
}

console.log('')
process.exit(ok ? 0 : 1)
