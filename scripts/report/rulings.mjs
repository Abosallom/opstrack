// Build the organization-identity ruling sheet: every decision a person must
// take, with the evidence beside it. Reads the SAFE projection and the tracker's
// own structure.csv. Writes nothing but the sheet.
import { parseCsv } from '/Users/aziz/Claude/nphiescore/scripts/report/extract.mjs'
import { readFileSync } from 'node:fs'

const SAFE = process.argv[2] // the safe projection; see BRD-001
const rows = parseCsv(readFileSync(SAFE, 'utf8'))
const H = rows[0].map((h) => String(h).trim())
const sumI = H.indexOf('Summary'), stI = H.indexOf('Status'), keyI = H.indexOf('Issue key')
const body = rows.slice(1)

// The 161 map organizations, from the file the tracker was built from.
const csv = readFileSync('/Users/aziz/Claude/nphiescore/scripts/report/structure.csv', 'utf8')
const mapOrgs = csv.split('\n').slice(1).filter(Boolean).map((line) => {
  const first = line.startsWith('"') ? /^"((?:[^"]|"")*)"/.exec(line)?.[1].replace(/""/g, '"') : line.split(',')[0]
  return (first ?? '').split('>').pop().trim()
}).filter(Boolean)

const GENERIC = /\b(hospital|hospitals|medical|centre|center|centers|group|clinic|clinics|company|co|est|cluster|health|healthcare|care|general|specialist|specialized|complex|ltd|llc|polyclinic)\b/g
const norm = (s) => {
  const t = s.replace(/\(.*?\)/g, ' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const sh = t.replace(GENERIC, ' ').replace(/\s+/g, ' ').trim()
  return sh || t
}
const lev = (a, b) => {
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}

// ── A. duplicate rows INSIDE the tracker ──────────────────────────────────
const byNorm = new Map()
for (const name of mapOrgs) {
  const k = norm(name)
  if (!byNorm.has(k)) byNorm.set(k, [])
  byNorm.get(k).push(name)
}
const exactDupes = [...byNorm].filter(([, v]) => v.length > 1)

const keys = [...byNorm.keys()]
const near = []
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j]
    if (Math.abs(a.length - b.length) > 2) continue
    if (a.length < 5 || b.length < 5) continue
    // digits must agree: "Makkah 1" and "Makkah 2" are two hospitals.
    const da = (a.match(/\d+/g) ?? []).join(''), db = (b.match(/\d+/g) ?? []).join('')
    if (da !== db) continue
    const d = lev(a, b)
    if (d > 0 && d <= 2) near.push([a, b, d, byNorm.get(a), byNorm.get(b)])
  }
}

// ── B. how much work each candidate carries, so a ruling is weighted ──────
const ticketsFor = new Map()
for (const r of body) {
  const s = String(r[sumI] ?? '')
  const open = !/^(resolved|closed)$/i.test(String(r[stI] ?? '').trim())
  for (const name of mapOrgs) {
    const k = norm(name)
    if (k.length < 5) continue
    if (norm(s).includes(k)) {
      if (!ticketsFor.has(name)) ticketsFor.set(name, { total: 0, open: 0 })
      const t = ticketsFor.get(name); t.total += 1; if (open) t.open += 1
    }
  }
}
// ⚠ THE COUNT IS THE CLUSTER'S, NOT THE ROW'S, because the match is on the
//   normalised key and every row in a cluster shares it. Printing it against
//   each row made five Aseer rows all read "41 tickets" as though there were 205.
const w = (n) => { const t = ticketsFor.get(n); return t ? `${t.total} tickets, ${t.open} open` : 'no tickets found' }

/**
 * What each row says INSIDE its brackets, which is the whole question for a
 * cluster like Aseer.
 *
 * ⚠ THE NORMALISER STRIPS PARENTHESES, so `Aseer (Care Ware) Cluster` and
 *   `Aseer (Vida Plus) Cluster` collapse to one key — and they are almost
 *   certainly TWO things, because Careware and Vida Plus are different hospital
 *   information systems. A sheet that recommended merging them would destroy the
 *   very distinction the owner asked to group by. So a cluster whose rows carry
 *   DIFFERENT bracketed text is reported as a question, never as a default merge.
 */
const brackets = (n) => (n.match(/\(([^)]*)\)/g) ?? []).map((b) => b.slice(1, -1).trim()).filter(Boolean)

console.log('# Organization identity — the rulings\n')
console.log(`Measured over ${mapOrgs.length} tracker organizations and ${body.length} tickets.\n`)
const sameBrackets = ([, names]) => {
  const sets = names.map((n) => brackets(n).join('|').toLowerCase())
  const nonEmpty = sets.filter(Boolean)
  return nonEmpty.length === 0 || new Set(nonEmpty).size === 1
}
const plainDupes = exactDupes.filter(sameBrackets)
const bracketDupes = exactDupes.filter((c) => !sameBrackets(c))

console.log(`## A · Same name, nothing in brackets to separate them (${plainDupes.length})\n`)
console.log('One hospital written more than one way. **Merging is the recommended default.**')
console.log('The ticket count is the CLUSTER\'s, not each row\'s.\n')
for (const [k, names] of plainDupes) {
  console.log(`- **${k}** — ${names.length} rows, ${w(names[0])} between them:`)
  for (const n of names) console.log(`    - \`${n}\``)
}

console.log(`\n## A2 · Same name, but the BRACKETS DISAGREE (${bracketDupes.length}) — do not merge blind\n`)
console.log('⚠ These collapse to one name only because the normaliser strips brackets. What is inside')
console.log('the brackets is usually the hospital information system, and two different systems at one')
console.log('site is exactly the distinction you asked to be able to group by. **Each needs a ruling:**')
console.log('one site with two systems, two sites, or one row written carelessly.\n')
for (const [k, names] of bracketDupes) {
  console.log(`- **${k}** — ${names.length} rows, ${w(names[0])} between them:`)
  for (const n of names) {
    const b = brackets(n)
    console.log(`    - \`${n}\`${b.length ? `   → brackets say: **${b.join(', ')}**` : '   → no brackets'}`)
  }
}
/*
 * ⚠ EDIT DISTANCE ALONE PRODUCES NOISE AND THE FIRST DRAFT PRINTED IT. `Abeer
 *   Medical Group` and `Aseer` are one character apart and are a medical group
 *   and a region; `Al Hasa` and `Al Hayat` likewise. A sheet that lists those
 *   beside `Jedda Oasis` / `Jeddah Oasis` teaches the reader to skim, and a
 *   skimmed ruling sheet is worse than none.
 *
 * The signal that separates them is a SHARED ANCHOR at one end. Two spellings of
 * one name agree at the start or at the finish and differ in the middle; two
 * different names diverge early AND end differently.
 *
 * ⚠ A FIRST-FOUR-CHARACTERS RULE WAS TOO STRICT AND DROPPED A REAL ONE. `Samer
 *   Abbas` and `Samir Abbas` differ at character four, and they are the
 *   duplicate this repository has flagged more than any other. Anchoring at
 *   EITHER end catches them on their shared tail, and still refuses `abeer` /
 *   `aseer`, which the length floor excludes anyway.
 */
const likely = ([a, b, d]) =>
  d === 1 &&
  Math.min(a.length, b.length) >= 7 &&
  (a.slice(0, 3) === b.slice(0, 3) || a.slice(-4) === b.slice(-4))
const show = ([a, b, d, an, bn]) => {
  console.log(`- \`${an.join(' / ')}\`  **vs**  \`${bn.join(' / ')}\`   — ${d} character${d > 1 ? 's' : ''} apart`)
  console.log(`    - ${an[0]}: ${w(an[0])}`)
  console.log(`    - ${bn[0]}: ${w(bn[0])}`)
}
const B1 = near.filter(likely), B2 = near.filter((x) => !likely(x))
console.log(`\n## B · Spellings one or two characters apart\n`)
console.log('A digit difference was excluded, so "Makkah 1" and "Makkah 2" are not here.\n')
console.log(`### B1 · Likely the same hospital (${B1.length}) — these are the ones worth your time\n`)
for (const x of B1.sort((p, q) => p[2] - q[2])) show(x)
console.log(`\n### B2 · Probably two different hospitals (${B2.length}) — listed so nothing is hidden\n`)
console.log('They are close only by character count and diverge in the first four letters.\n')
for (const x of B2.sort((p, q) => p[2] - q[2])) show(x)
console.log(`\n## C · Tracker organizations no ticket names (${mapOrgs.filter((n) => !ticketsFor.has(n)).length})\n`)
console.log('Either the hospital is written differently in Jira, or it is not yet in the programme.\n')
for (const n of mapOrgs.filter((x) => !ticketsFor.has(x))) console.log(`- \`${n}\``)
