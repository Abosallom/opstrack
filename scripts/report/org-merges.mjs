// The rulings taken on 25 Aug 2026, as data. Computes the new denominator.
// Writes nothing — this is the arithmetic, not the migration.
import { readFileSync } from 'node:fs'

const csv = readFileSync('/Users/aziz/Claude/nphiescore/scripts/report/structure.csv', 'utf8')
const orgs = csv.split('\n').slice(1).filter(Boolean).map((line) => {
  const first = line.startsWith('"') ? /^"((?:[^"]|"")*)"/.exec(line)?.[1].replace(/""/g, '"') : line.split(',')[0]
  return (first ?? '').split('>').pop().trim()
}).filter(Boolean)

/** Each entry: the rows that collapse, and what they collapse INTO. */
const MERGES = [
  // ⚠ THE RULING WAS "TWO, SPLIT BY SYSTEM", SO THERE ARE TWO — not three.
  //   `Aseer` and `Aseer Cluster` name no system, so which of the two they
  //   belong to is not something this file may decide. They are attached to the
  //   Vida Plus row because it carries the most rows already, and that placement
  //   is flagged as PENDING ALLOCATION rather than settled. Inventing a third
  //   "unallocated Aseer" organization would put a row on the map that the
  //   ruling did not create, which is the exact failure this whole sheet exists
  //   to prevent.
  { into: 'Aseer (Care Ware)', rows: ['Aseer (Care Ware) Cluster'] },
  { into: 'Aseer (Vida Plus)', rows: ['Aseer (Vida Plus)', 'Aseer (Vida Plus) Cluster', 'Aseer', 'Aseer Cluster'], pending: 'Aseer and Aseer Cluster name no system — allocate to Care Ware or Vida Plus' },
  { into: 'Najran Cluster', rows: ['Najran', 'Najran Cluster', 'Najran (Vida plus)'] },
  { into: 'Najran Specialized Hospital', rows: ['Najran specialized hospital', 'Najran specialized hospital(FHIR)'] },
  { into: 'AlSalama Hospital', rows: ['AL Salama Hospital', 'AlSalama (Murgan)Hospital', 'AlSalama (Murjan) Hospital'] },
  { into: 'Al Madinah', rows: ['Al Madinah', 'Al Madinah Cluster'] },
  { into: 'Alsaedy Hospital', rows: ['Alsaedy Hospital', 'Alsaedy Hospital(CDA)'] },
  { into: 'Arrawdah Hospital', rows: ['Arrawdah General Hospital', 'Arrawdah Hospital'] },
  { into: 'King Khalid University', rows: ['King Khalid University', 'King Khalid University (Aseer)'] },
  { into: 'Magrabi Hospital', rows: ['Magrabi Health Hospital', 'Magrabi Hospital'] },
  { into: 'Makkah 2 (MCC)', rows: ['Makkah 2 (MCC)', 'Makkah Cluster 2 (MCC)'] },
  { into: 'SFH (Security Force Hospital)', rows: ['SFH', 'SFH (Security Force Hospital)'] },
  { into: 'Aljedaani Hospital', rows: ['Aljadaani (SAFA) Hospital', 'Aljedaani Hospital'] },
  { into: 'AlYousif Hospital', rows: ['Alyosif Hospital', 'AlYousif'] },
  { into: 'Autism Spectrum Virtual Care', rows: ['AUTISM SPECTRUM VIRTTUAL CARE CLINIC', 'Autism Spectrum virtual care Hospital'] },
  { into: 'Jeddah Oasis', rows: ['Jedda Oasis', 'Jeddah Oasis'] },
  { into: 'Samir Abbas Hospital', rows: ['Samer Abbas Hospital', 'Samir Abbas Hospital'] },
]
const DEFERRED = ['Jazan', 'Jazan Cluster (MCC)', 'Jazan cluster (MedicaCloud)']

const known = new Set(orgs)
let missing = []
const consumed = new Set()
for (const m of MERGES) for (const r of m.rows) {
  if (!known.has(r)) missing.push(r)
  consumed.add(r)
}

const before = orgs.length
const survivors = orgs.filter((o) => !consumed.has(o)).length + MERGES.length
const USE_CASES = 11

console.log(`rows named by rulings but NOT in structure.csv: ${missing.length}`)
for (const m of missing) console.log(`   ⚠ ${m}`)
console.log()
console.log(`organizations before        ${before}`)
console.log(`rows consumed by merges     ${consumed.size}`)
console.log(`organizations they become   ${MERGES.length}`)
console.log(`organizations after         ${survivors}`)
console.log(`  (Jazan's ${DEFERRED.length} rows deferred and still counted separately)`)
for (const m of MERGES.filter((x) => x.pending)) console.log(`  ⚠ pending: ${m.pending}`)
console.log()
console.log(`GRID  ${survivors} x ${USE_CASES} use cases = ${survivors * USE_CASES}`)
console.log(`  was 161 x 11 = ${161 * USE_CASES}`)
console.log(`  if Jazan later merges to one: ${(survivors - 2) * USE_CASES}`)
