// Turn the Jira export into the importer's CSV, reading every convention.
//
// ── WHY A SEPARATE READER AND NOT A CHANGE TO THE IMPORTER ────────────────
//
// `scripts/import-structure.mjs` writes to the database, is idempotent, refuses
// a whole run if any row is refused, and leaves an undo manifest. None of that
// should be re-litigated to teach it a new file format. So this reads Jira and
// emits the CSV that importer already accepts; the writing half is unchanged.
//
// ── WHAT THE OLD IMPORT MISSED ────────────────────────────────────────────
//
// It read one sentence pattern — `Onboarding | Org | Use case` — and got 381 of
// 2,971 tickets. This reads three:
//
//     Onboarding | Org | Use case          the pipe form      381
//     Onboarding - Org - Use case          the dash form       54   dropped on punctuation alone
//     Interface Build - Org - Use case    a second convention 342   never taught to the reader
//
// It does NOT read the other 2,083 — whitelisting, SSO, errors, config. Those
// are support work, and putting them on a map that answers "how far has this
// hospital got" would make the map mean two things at once.
//
// ── NOTHING IS DROPPED SILENTLY ───────────────────────────────────────────
//
// Every ticket this cannot place is counted and printed by reason. A reader who
// runs this and sees "unmatched capability: 41" can decide whether that is a
// typo to fold or a capability to configure; a reader who sees nothing learns
// nothing. `--verbose` prints the actual strings.

import { readFileSync, writeFileSync } from 'node:fs'

/* ─────────────────────────── the CSV both ways ─────────────────────────── */

/** RFC 4180, enough of it: quotes, doubled quotes, embedded newlines, CRLF. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i += 1 } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/* ──────────────────────────── the vocabulary ───────────────────────────── */

/**
 * The capability catalogue this import writes to.
 *
 * Ten are what the workspace already has. Five are the families the owner chose
 * to add because the export names them and the map had nowhere to put them:
 * the CDA/XD document set, Vital Signs and Encounter History.
 *
 * ⚠ FHIR AND CDA ARE NOT SPLIT, by decision. Jira says both `Lab Result FHIR`
 *   and `Lab result CDA`; splitting every capability by message format would
 *   roughly double the column count and was declined. Both fold into one.
 */
const CAPABILITIES = [
  'ADT',
  'Medication Prescribe V1', 'Medication Prescribe V2',
  'Medication Dispense V1', 'Medication Dispense V2',
  'Radiology Order', 'Radiology Report',
  'Lab Order', 'Lab Results',
  'Clinical Notes',
  'XDRADO', 'XDLABO', 'XDDOCS',
  'Vital Signs', 'Encounter History',
]

/**
 * Ticket text → capability, by rule rather than by lookup table.
 *
 * A table of 246 strings would be right today and wrong the moment somebody
 * types `Lab Ordrer` again — and they will, because six of the spellings in the
 * file today are typos. These are ordered: the first match wins, so V2 is asked
 * before V1 and the XD family before the plain radiology and lab rules that
 * would otherwise swallow `XDRADO`.
 */
const RULES = [
  // The XD/CDA document family FIRST: `XDRAD` would otherwise read as radiology
  // and `XDLAB` as a lab order.
  [/\bxd\s*rado?\b/i, 'XDRADO'],
  [/\bxd\s*labo?\b/i, 'XDLABO'],
  [/\bxd\s*d(?:ocs?|cos)\b/i, 'XDDOCS'],          // `XDDCOS` is in the file

  [/\bencounter\s*hist/i, 'Encounter History'],
  [/\bvital\s*(?:signs?|sings?)\b/i, 'Vital Signs'],   // `Vital Sings` is in the file

  // MEDICATION, and the spelling here is not tidiness — the file carries
  // dispense · dispence · dispinse · despense · despinse · despines, and
  // prescribe · priscribe · prescription · request, sometimes as `eDispense`
  // with no space. `d[ei]sp[ei]n` covers all six of the first set without
  // demanding a letter any one of them lacks; an earlier attempt required a
  // trailing `s` and silently dropped twelve tickets spelled `dispence`.
  // V2 is asked before V1 in each pair.
  [/medicat\w*[\s\S]*d[ei]sp[ei]n\w*[\s\S]*\bv?\s*2\b/i, 'Medication Dispense V2'],
  [/medicat\w*[\s\S]*d[ei]sp[ei]n\w*/i, 'Medication Dispense V1'],
  [/medicat\w*[\s\S]*(?:pr[ei]scri\w*|request)[\s\S]*\bv?\s*2\b/i, 'Medication Prescribe V2'],
  [/medicat\w*[\s\S]*(?:pr[ei]scri\w*|request)/i, 'Medication Prescribe V1'],

  // `Rad Result` is a radiology REPORT: there is no separate result type for
  // imaging in this file and the two words are used interchangeably.
  [/\b(?:rad|radiology)\b[\s\S]*\b(?:report\w*|repot\w*|result\w*|reslut\w*)/i, 'Radiology Report'],
  [/\b(?:rad|radiology)\b[\s\S]*\b(?:order\w*|ordrer|oder\w*)/i, 'Radiology Order'],
  [/\blab\w*[\s\S]*\b(?:result\w*|reslut\w*)/i, 'Lab Results'],
  [/\blab\w*[\s\S]*\b(?:order\w*|ordrer|oder\w*)/i, 'Lab Order'],

  [/\bclinical\s*(?:note|notes|not)\b/i, 'Clinical Notes'],
  [/\badt\b/i, 'ADT'],
]

function capabilityOf(text) {
  for (const [re, name] of RULES) if (re.test(text)) return name
  return null
}

/**
 * Jira status → the state a capability link carries.
 *
 * The owner's own mapping, unchanged from the first import. `Reopened` and
 * `Pending on Production` are new here: the first is work that came back and is
 * plainly not live, and the second is the closest thing in the whole dataset to
 * "waiting to go live" — both were silently discarded before.
 */
function stateOf(status) {
  const s = status.trim().toLowerCase()
  if (s === 'resolved' || s === 'closed') return 'live'
  if (s === 'work in progress' || s === 'pending on vendor' || s === 'pending on production') return 'testing'
  if (s === 'open bo' || s === 'reopened') return 'planned'
  return null
}

/** live beats testing beats planned: an organization that got one capability to
 *  live does not un-live it because a later ticket about it is still open. */
const RANK = { planned: 1, testing: 2, live: 3 }

/* ────────────────────────────── the reading ────────────────────────────── */

/**
 * Split a summary into its two halves and decide WHICH IS WHICH by content.
 *
 * ⚠ THIS IS THE BUG THAT PUT CAPABILITIES ON THE MAP AS HOSPITALS. The two
 *   segments arrive in either order, in both conventions:
 *
 *     Interface Build - Khafgi Hospital - Lab ordere            org first
 *     Interface Build - Medication V2 - Dr. Erfan & Bagedo …    capability first
 *     Onboarding | Encounter History ADT | Najran specialized   capability first
 *
 *   The old reader always took segment one as the organization, which is
 *   precisely why `Encounter History ADT`, `Lab result` and `Rad report` are
 *   sitting in the live map today as organizations with capability cells of
 *   their own. Position is not the signal and never was.
 *
 * So both segments are offered to `capabilityOf` and the one that answers is
 * the capability. If BOTH answer the first is taken as the capability — the
 * file's commoner order once the org-first cases are excluded — and if NEITHER
 * does the row is refused rather than guessed at.
 */
function splitSummary(s) {
  const t = s.trim()
  let a = null, b = null, via = null
  let m = /^\s*onboarding\s*\|([^|]+)\|(.+)$/i.exec(t)
  if (m) { a = m[1]; b = m[2]; via = 'pipe' }
  if (!via) {
    m = /^\s*onboarding\s*[-–]\s*([^-–]+?)\s*[-–]\s*(.+)$/i.exec(t)
    if (m) { a = m[1]; b = m[2]; via = 'dash' }
  }
  if (!via) {
    m = /^\s*interface\s*(?:build|bulid|development(?:\s+request)?)\s*[-–:]?\s*([^-–|]+?)\s*[-–|]\s*(.+)$/i.exec(t)
    if (m) { a = m[1]; b = m[2]; via = 'interface' }
  }
  if (!via) return null
  const first = a.trim(), second = b.trim()
  const capFirst = capabilityOf(first) !== null
  const capSecond = capabilityOf(second) !== null
  if (capFirst && !capSecond) return { org: second, cap: first, via, flipped: true }
  if (capSecond && !capFirst) return { org: first, cap: second, via, flipped: false }
  if (capFirst && capSecond) return { org: second, cap: first, via, flipped: true }
  return { org: first, cap: second, via, flipped: false }
}

/**
 * Tidy an organization name before it becomes a row.
 *
 * The summaries carry connective words into the segment — `Interface
 * Development Request - Dar Al Afia Hospital`, `... for Jazan cluster` — and
 * without this they become part of the hospital's name on the map.
 */
function cleanOrg(raw) {
  return raw
    // REPEATED, not once: the file writes `Interface Build request for
    // Andalusia`, so the segment arrives as "request for Andalusia" and a single
    // strip leaves "for Andalusia" as the hospital's name on the map.
    // `the`/`a` are deliberately not in this list — a hospital may legitimately
    // begin with either, and no ticket in the file needs them removed.
    .replace(/^\s*(?:(?:request|build|for)\b\s*)+/i, '')
    .replace(/\s*\buse\s*case\b\.?\s*$/i, '')
    .replace(/^[\s\-–:|]+|[\s\-–:|.]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Fold spellings of one organization together.
 *
 * ⚠ THE SUFFIX IS DROPPED FOR COMPARISON ONLY. The file writes one hospital as
 *   `Alfalah`, `Alfalah Hospita` and `Alfalah Hospital`, and comparing the whole
 *   string keeps all three — which is exactly the duplicate sitting in the live
 *   map today. Stripping a trailing hospital-word makes those one key while
 *   leaving `Makkah 1` and `Makkah 2`, or a Hospital and a Cluster of the same
 *   name, safely distinct.
 *
 *   It does NOT fold a misspelt STEM: `Samer Abbas` and `Samir Abbas` stay two
 *   rows. Guessing that two differently-spelled names are one hospital is how a
 *   merge quietly deletes a real organization, so those are REPORTED for a human
 *   instead — see `nearDuplicates` below.
 */
const orgKey = (s) =>
  cleanOrg(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(hospitals?|hospitals?|hopitals?|hospita|hosp)$/, '')

/** Names that differ by one or two characters — probably one hospital, but not
 *  a call this script may make on its own. */
function nearDuplicates(names) {
  const near = []
  const dist = (a, b) => {
    if (Math.abs(a.length - b.length) > 2) return 9
    const d = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i += 1) {
      let prev = d[0]; d[0] = i
      for (let j = 1; j <= b.length; j += 1) {
        const t = d[j]
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
        prev = t
      }
    }
    return d[b.length]
  }
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = orgKey(names[i]), b = orgKey(names[j])
      if (a.length < 6 || b.length < 6) continue
      if (dist(a, b) <= 2) near.push([names[i], names[j]])
    }
  }
  return near
}

/**
 * The rung an organization stands on, from the work recorded against it.
 *
 * ⚠ THREE RUNGS STAY EMPTY AND THAT IS CORRECT. Jira has no status meaning
 *   "Not started", "UAT" or "Go-live readiness", so nothing may be placed on
 *   them. A guessed rung is worse than an empty one — it would put a date on a
 *   promise nobody made.
 */
function rungFor(states) {
  if (states.length === 0) return ''
  if (states.every((s) => s === 'live')) return 'Live'
  if (states.some((s) => s === 'testing' || s === 'live')) return 'Integrating & Testing'
  return 'Kickoff'
}

export function rebuild(exportPath, { members = null } = {}) {
  const rows = parseCsv(readFileSync(exportPath, 'utf8'))
  const hdr = rows[0].map((h) => h.trim())
  const iSummary = hdr.indexOf('Summary')
  const iStatus = hdr.indexOf('Status')
  const iAssignee = hdr.indexOf('Assignee')
  if (iSummary === -1 || iStatus === -1) throw new Error('[rebuild] no Summary/Status column')

  const orgs = new Map()   // key -> { name, spellings:Map, caps:Map<capability,state> }
  const skipped = { noConvention: 0, unmatchedCapability: 0, unmappedStatus: 0 }
  const unmatchedText = new Map()
  const byConvention = { pipe: 0, dash: 0, interface: 0 }

  for (const r of rows.slice(1)) {
    if (r.length <= Math.max(iSummary, iStatus)) continue
    const summary = (r[iSummary] ?? '').trim()
    if (!summary) continue
    const split = splitSummary(summary)
    if (!split) { skipped.noConvention += 1; continue }
    const orgName = cleanOrg(split.org)
    if (!orgName || orgName.length < 2) { skipped.noConvention += 1; continue }

    const capability = capabilityOf(split.cap)
    if (!capability) {
      skipped.unmatchedCapability += 1
      unmatchedText.set(split.cap, (unmatchedText.get(split.cap) ?? 0) + 1)
      continue
    }
    const state = stateOf(r[iStatus] ?? '')
    if (!state) { skipped.unmappedStatus += 1; continue }

    byConvention[split.via] += 1
    const key = orgKey(orgName)
    let org = orgs.get(key)
    if (!org) { org = { name: orgName, spellings: new Map(), caps: new Map(), owners: new Map() }; orgs.set(key, org) }
    org.spellings.set(orgName, (org.spellings.get(orgName) ?? 0) + 1)
    // The commonest spelling wins the row's name — a typo seen once should not
    // name a hospital that is spelled correctly forty times.
    const best = [...org.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    org.name = best
    // WHO IS CARRYING IT, counted per organization. Every ticket names an
    // assignee; the map's `account_manager` was set from this in a separate
    // pass last time and would be BLANKED by an import that left the column
    // empty — 71 organizations losing their owner silently.
    const assignee = iAssignee === -1 ? '' : (r[iAssignee] ?? '').trim()
    if (assignee) org.owners.set(assignee, (org.owners.get(assignee) ?? 0) + 1)

    const had = org.caps.get(capability)
    if (!had || RANK[state] > RANK[had]) org.caps.set(capability, state)
  }

  for (const org of orgs.values()) {
    // ⚠ THE SAME 60% BAR THE FIRST OWNER PASS USED, and for its reason: a wrong
    //   owner is worse than none. It sends a chase to somebody who cannot act
    //   and quietly reports the question as handled. Below the bar the field is
    //   left blank and the organization shows as unassigned, which is true.
    // ⚠ ONLY SOMEBODY THIS WORKSPACE KNOWS. The export names 66 assignees and
    //   the workspace has 27 members: Jira carries vendors, contractors and
    //   people who have left. Naming one of them here is not a near miss, it is
    //   a REFUSAL that stops the whole import — and the honest reading of "the
    //   ticket's assignee is not in this workspace" is that nobody here owns it.
    const known = members === null
      ? [...org.owners]
      : [...org.owners].filter(([name]) => members.has(name.trim().toLowerCase()))
    const total = known.reduce((n, [, v]) => n + v, 0)
    const top = known.sort((a, b) => b[1] - a[1])[0]
    org.owner = top && total > 0 && top[1] / total >= 0.6 ? top[0] : ''
  }
  const list = [...orgs.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { list, skipped, unmatchedText, byConvention, near: nearDuplicates(list.map((o) => o.name)) }
}

export function toCsv(list) {
  const head = ['path', 'name_ar', 'kind', 'account_manager', 'vendor', 'description',
                'description_ar', 'stage', 'target_date', 'target', ...CAPABILITIES]
  const lines = [head.map(cell).join(',')]
  for (const org of list) {
    const states = [...org.caps.values()]
    const row = [
      `UHR > OB > ${org.name}`, '', 'Organization', org.owner ?? '', '', '', '',
      rungFor(states), '', '',
      ...CAPABILITIES.map((c) => org.caps.get(c) ?? ''),
    ]
    lines.push(row.map(cell).join(','))
  }
  return lines.join('\n') + '\n'
}

export { CAPABILITIES, capabilityOf, stateOf, rungFor, splitSummary, orgKey, cleanOrg }

/* ─────────────────────────────────── cli ───────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const src = args.find((a) => !a.startsWith('--')) || '/Users/aziz/Downloads/Jira for Lean (1).csv'
  const out = 'scripts/report/structure.csv'

  // The roster, so an assignee this workspace has never heard of does not
  // become a refusal that blocks the entire run.
  let members = null
  try {
    const { all } = await import('./extract.mjs')
    const rows = await all('profiles?select=display_name')
    members = new Set(rows.map((r) => (r.display_name ?? '').trim().toLowerCase()).filter(Boolean))
  } catch (e) {
    console.log(`(roster unavailable — every assignee kept: ${e.message.slice(0, 60)})`)
  }
  const { list, skipped, unmatchedText, byConvention, near } = rebuild(src, { members })
  writeFileSync(out, toCsv(list))

  const links = list.reduce((n, o) => n + o.caps.size, 0)
  const tally = (s) => list.reduce((n, o) => n + [...o.caps.values()].filter((v) => v === s).length, 0)
  const rungs = new Map()
  for (const o of list) {
    const r = rungFor([...o.caps.values()]) || '(none)'
    rungs.set(r, (rungs.get(r) ?? 0) + 1)
  }

  console.log(`read     ${src.split('/').pop()}`)
  console.log(`         pipe ${byConvention.pipe} · dash ${byConvention.dash} · interface ${byConvention.interface}`)
  console.log(`skipped  not one of the three conventions ${skipped.noConvention}`)
  console.log(`         capability matched no rule       ${skipped.unmatchedCapability}`)
  console.log(`         status mapped to no state        ${skipped.unmappedStatus}`)
  console.log(`built    ${list.length} organizations · ${links} capability links`)
  console.log(`         live ${tally('live')} · testing ${tally('testing')} · planned ${tally('planned')}`)
  console.log(`rungs    ${[...rungs].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  console.log(`wrote    ${out}`)
  if (near.length) {
    console.log(`\nnames that may be one organization — NOT merged, decide by hand (${near.length}):`)
    for (const [a, b] of near) console.log(`   ${a}   ~   ${b}`)
  }
  if (unmatchedText.size) {
    const top = [...unmatchedText].sort((a, b) => b[1] - a[1])
    console.log(`\nunmatched capability strings (${unmatchedText.size} distinct)${verbose ? '' : ' — top 12, --verbose for all'}:`)
    for (const [t, n] of (verbose ? top : top.slice(0, 12))) console.log(`   ${String(n).padStart(3)}  ${t}`)
  }
}
