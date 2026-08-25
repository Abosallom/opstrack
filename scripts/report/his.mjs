// Propose an HIS for each organization, from strings the data already holds.
// Writes nothing. Every line is a PROPOSAL for a person to confirm.
import { parseCsv } from '/Users/aziz/Claude/nphiescore/scripts/report/extract.mjs'
import { readFileSync } from 'node:fs'

const rows = parseCsv(readFileSync(process.argv[2], 'utf8'))
const H = rows[0].map((h) => String(h).trim())
const sumI = H.indexOf('Summary')
const body = rows.slice(1)

const orgs = readFileSync('/Users/aziz/Claude/nphiescore/scripts/report/structure.csv', 'utf8')
  .split('\n').slice(1).filter(Boolean).map((line) => {
    const first = line.startsWith('"') ? /^"((?:[^"]|"")*)"/.exec(line)?.[1].replace(/""/g, '"') : line.split(',')[0]
    return (first ?? '').split('>').pop().trim()
  }).filter(Boolean)

/*
 * The catalogue. Spellings observed in the owner's own data, folded to one name.
 *
 * ⚠ RHAPSODY IS NOT HERE AND MUST NOT BE. It is the integration engine the
 *   technical team builds interfaces IN — "requesting the technical team to
 *   build the interface in rhapsody to the needed hospital", in the owner's
 *   words. It is named 93 times in ticket text and would top any frequency
 *   ranking, which is exactly the trap: it is OUR tool, not a property of a
 *   hospital. Putting it in this catalogue would tag most of the estate with
 *   the same meaningless value and make the HIS axis useless on its first day.
 */
const HIS = [
  ['Careware',     /\bcare\s?ware\b/i],
  ['Vida Plus',    /\bvida\s?plus\b/i],
  ['InterSystems', /\binter\s?system(s)?\b/i],
  ['TrakCare',     /\btrak\s?care\b/i],
  ['Epic',         /\bepic\b/i],
  ['Cerner',       /\bcerner\b/i],
  ['Oracle Health',/\boracle\b/i],
  ['MedicaCloud',  /\bmedica\s?cloud\b|\bMCC\b/],
  ['Mirth',        /\bmirth\b/i],
  ['Malaffi',      /\bmalaffi\b/i],
  ['Andalusia HIS',/\bandalusia\b|\bandakusia\b/i],
  ['Nabd',         /\bnabd\b/i],
  ['Yakeen',       /\byakeen\b|\byaqeen\b/i],
]

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

const fromName = new Map()
for (const o of orgs) for (const [name, re] of HIS) if (re.test(o)) fromName.set(o, name)

// Second pass: the ticket text, but only where the ORGANIZATION is also named.
const fromTickets = new Map()
for (const r of body) {
  const s = String(r[sumI] ?? '')
  const n = norm(s)
  for (const o of orgs) {
    if (fromName.has(o)) continue
    // Same lesson as the rulings sheet: a length floor made the matcher refuse
    // real hospitals. Short names are searched with word boundaries instead.
    const key = norm(o).replace(/\b(hospital|medical|center|centre|group|clinic|cluster|general|health|care|company|est)\b/g, '').replace(/\s+/g, ' ').trim()
    if (key.length < 3) continue
    const hit = key.length < 5
      ? new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(n)
      : n.includes(key)
    if (!hit) continue
    for (const [name, re] of HIS) {
      if (!re.test(s)) continue
      if (!fromTickets.has(o)) fromTickets.set(o, new Map())
      const m = fromTickets.get(o)
      m.set(name, (m.get(name) ?? 0) + 1)
    }
  }
}

const proposed = new Map(fromName)
const contested = []
for (const [o, counts] of fromTickets) {
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  if (ranked.length === 1) proposed.set(o, ranked[0][0])
  else contested.push([o, ranked])
}

console.log(`# HIS — proposals for confirmation\n`)
console.log(`Measured over ${orgs.length} organizations and ${body.length} tickets. **Nothing is written.**\n`)
console.log(`## A · From the organization's own name (${fromName.size}) — highest confidence\n`)
for (const [o, h] of [...fromName].sort()) console.log(`- \`${o}\` → **${h}**`)
console.log(`\n## B · From ticket text, one candidate only (${proposed.size - fromName.size})\n`)
for (const [o, h] of [...proposed].filter(([o]) => !fromName.has(o)).sort()) console.log(`- \`${o}\` → **${h}**`)
console.log(`\n## C · Ticket text names more than one (${contested.length}) — needs a person\n`)
for (const [o, ranked] of contested.sort()) console.log(`- \`${o}\` → ${ranked.map(([n, c]) => `${n} (${c})`).join(' · ')}`)
const none = orgs.filter((o) => !proposed.has(o) && !contested.some(([x]) => x === o))
console.log(`\n## D · Nothing in the data names a system (${none.length}) — ask the account manager\n`)
for (const o of none.sort()) console.log(`- \`${o}\``)
console.log(`\n---\n**${proposed.size} of ${orgs.length} proposed · ${contested.length} contested · ${none.length} unknown.**`)
