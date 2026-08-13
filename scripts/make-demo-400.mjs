#!/usr/bin/env node
// make-demo-400 — writes `docs/templates/structure.demo.csv`, and writes the
// SAME BYTES every time it is run.
//
//   node scripts/make-demo-400.mjs
//   node scripts/make-demo-400.mjs && git diff --stat docs/templates/   # → empty
//
// ═══ WHY A GENERATOR AND NOT A FILE SOMEBODY TYPED ═══
//
// The demo file used to be sixteen organizations, hand-written, and it was the
// right size for judging one panel. It is the wrong size for judging the thing
// the map actually has to survive: four hundred organizations, five books, six
// vendors, a stage ladder with a bottleneck on one rung and a third of the
// portfolio on none of them. Nobody types four hundred rows, and nobody
// re-types them when a column is added — so the rows are DERIVED, the shape is
// stated once as a table of counts at the top of this file, and the file on
// disk is an artefact of running this.
//
// ⚠ DETERMINISTIC, AND THAT IS THE TEST. There is no `Math.random()` and no
// `Date.now()` anywhere below: one seeded PRNG (`SEED`), consumed in one fixed
// order, and one fixed `BASE_DATE` that every goal date is an offset from. Run
// this twice and `cmp` the two outputs — they are byte-identical, which is what
// makes the committed CSV reviewable in a diff instead of a 400-line churn on
// every regeneration. A clock in here would make every run a false change.
//
// ⚠ THE HEADER IS READ FROM `docs/templates/structure.csv`, NEVER REBUILT.
// `structurePlan.mjs` pins the ten fixed columns AND the ten seeded use cases
// by exact name, and the test asserts the three templates share one header. A
// header assembled from a list in this file would drift the day 0024 seeds an
// eleventh capability. So the first line of the empty template IS the first
// line of this one, copied verbatim, and the use-case columns are whatever is
// to the right of the tenth comma.
//
// ═══ WHAT THE SHAPE IS FOR ═══
//
// Every number in the tables below is a surface somebody has to be able to
// judge, and it is here rather than in a comment beside the row because the row
// does not exist until this runs:
//
//   · 400 organizations under ONE deletable root (`UHR > Demo Portfolio`).
//     That single subtree is the whole reset story — `map_nodes` has no column
//     that could mark a row as demo-created, so the marker is the SHAPE.
//   · Two account managers who resolve, three books deliberately unassigned.
//     The unassigned pile is a feature under test, not an omission.
//   · Six vendors, one carrying 120 organizations — a cohort big enough that
//     the vendor filter has a story and the canvas has a group to draw.
//   · Seven stage rungs used, 30% of organizations on NONE of them, and a
//     pile-up of 112 on one middle rung. A ladder where everything is near the
//     top never draws its interesting end.
//   · 45% of organizations with no use-case link at all — the state most real
//     rows are in on day one and the one a full demo never renders.
//   · 40 goals: mostly a date on an organization, a few counts on the tiers
//     above, all inside twelve months of `BASE_DATE`.
//
// ═══ WHAT IS INVENTED, AND HOW OBVIOUSLY ═══
//
// Everything except two names. The vendors are `Demo Vendor …` because a
// screenshot taken inside a real PMO reading "<real integrator> — 120
// organizations" is a real company with an invented book of business. The
// organizations are built from ordinary Arabic nouns (dew, dawn, coral) and a
// facility word; no tier mirrors a real national cluster structure, and no
// person appears anywhere except `Aziz` and `Nasser Alabri` in the
// `account_manager` column — the only two provisioned accounts, which is why
// they are the only two that resolve.

import { readFileSync, writeFileSync } from 'node:fs'

// ── the constants that make this reproducible ───────────────────────────────

/** The one seed. Change it and every invented name, vendor and date moves. */
const SEED = 0x4e504834

/**
 * Every goal date is `BASE_DATE + n days`.
 *
 * ⚠ NOT `new Date()`. A goal dated from the clock re-dates itself on every run,
 * so the committed file changes whenever anybody regenerates it and the diff
 * stops being readable. It also means the demo's commitments drift out of the
 * window the Portfolio lens draws. Fixed base, fixed offsets, and the file is
 * refreshed by editing this line.
 */
const BASE_DATE = '2026-09-01'

const TEMPLATE = new URL('../docs/templates/structure.csv', import.meta.url)
const OUTPUT = new URL('../docs/templates/structure.demo.csv', import.meta.url)

const TRACK = 'UHR'
const ROOT = 'Demo Portfolio'

/** The two provisioned members. Everything else in the AM column is blank. */
const AM_AZIZ = 'Aziz'
const AM_NASSER = 'Nasser Alabri'

/**
 * 0026's seven rungs, verbatim.
 *
 * ⚠ THIS IS DATA FOR A FILE, NOT A LIST THE IMPORTER READS. `structurePlan.mjs`
 * contains no stage name at all and reads the ladder out of the database,
 * because every rung is renameable in Settings › Catalogue. These strings are
 * here for the same reason `Organization` is: they are what gets TYPED into a
 * spreadsheet cell. If Aziz renames a rung, this file's stage cells stop
 * matching and the importer says so by name — which is the correct failure.
 */
const STAGE = {
  notStarted: 'Not started',
  kickoff: 'Kickoff',
  integrating: 'Integrating',
  testing: 'Testing/UAT',
  ready: 'Go-live ready',
  live: 'Live',
  paused: 'Paused',
}

// ── the shape, as tables of counts ──────────────────────────────────────────
//
// Exact counts rather than probabilities. A 30%-blank stage column produced by
// coin flips is 30% ± 5 and the summary printed at the end is then a
// measurement of luck; the pools below are shuffled, so WHICH organization gets
// which value is pseudo-random, but HOW MANY get it is stated here and is what
// the summary prints back.

/** Five account-manager books, deliberately uneven. 104+92+79+67+58 = 400. */
const BOOKS = [
  { name: 'Account Book One', ar: 'محفظة الحسابات الأولى', size: 104, am: AM_AZIZ, ad: 0 },
  { name: 'Account Book Two', ar: 'محفظة الحسابات الثانية', size: 92, am: AM_NASSER, ad: 0 },
  { name: 'Account Book Three', ar: 'محفظة الحسابات الثالثة', size: 79, am: '', ad: 0 },
  { name: 'Account Book Four', ar: 'محفظة الحسابات الرابعة', size: 67, am: '', ad: 1 },
  { name: 'Account Book Five', ar: 'محفظة الحسابات الخامسة', size: 58, am: '', ad: 1 },
]

/**
 * Two Associate Directorates, also uneven — 275 organizations against 125.
 * A tree whose branches are the same size draws as a wheel and tells you
 * nothing about where the work is.
 */
const DIRECTORATES = [
  { name: 'Associate Directorate Alpha', ar: 'الإدارة المساعدة ألفا' },
  { name: 'Associate Directorate Beta', ar: 'الإدارة المساعدة بيتا' },
]

/**
 * The six organization types each book is split into, with the facility words
 * an invented name is built from.
 *
 * ⚠ NO `kind` ON THIS TIER, ON PURPOSE. 0023 seeds exactly three kinds —
 * Programme, Phase, Organization — and none of them is "a folder of hospitals".
 * Labelling this row `Phase` would draw "Hospitals · Phase" on the map and
 * invite a bug report about the kind vocabulary instead of the decision (add a
 * kind in Settings › Catalogue, or do not). A blank kind is legal and says
 * nothing, which is exactly right for a grouping node.
 */
const TYPES = [
  {
    key: 'hospitals',
    name: 'Hospitals',
    ar: 'المستشفيات',
    variants: [
      ['General Hospital', (ar) => `مستشفى ${ar} العام`],
      ['Specialist Hospital', (ar) => `مستشفى ${ar} التخصصي`],
      ['Community Hospital', (ar) => `مستشفى ${ar} المجتمعي`],
      ['Maternity Hospital', (ar) => `مستشفى ${ar} للولادة`],
    ],
    prefers: ['ADT', 'Clinical Notes', 'Lab Order', 'Lab Results'],
  },
  {
    key: 'clinics',
    name: 'Clinics',
    ar: 'العيادات',
    variants: [
      ['Clinic', (ar) => `عيادة ${ar}`],
      ['Family Clinic', (ar) => `عيادة ${ar} للأسرة`],
      ['Dental Clinic', (ar) => `عيادة ${ar} للأسنان`],
    ],
    prefers: ['ADT', 'Medication Prescribe V1', 'Clinical Notes'],
  },
  {
    key: 'labs',
    name: 'Laboratories',
    ar: 'المختبرات',
    variants: [
      ['Laboratory', (ar) => `مختبر ${ar}`],
      ['Reference Laboratory', (ar) => `مختبر ${ar} المرجعي`],
      ['Diagnostic Laboratory', (ar) => `مختبر ${ar} للتشخيص`],
    ],
    prefers: ['Lab Order', 'Lab Results'],
  },
  {
    key: 'polyclinics',
    name: 'Polyclinics',
    ar: 'المجمعات الطبية',
    variants: [
      ['Polyclinic', (ar) => `مجمع ${ar} الطبي`],
      ['Specialist Polyclinic', (ar) => `مجمع ${ar} الطبي التخصصي`],
      ['Day Surgery Polyclinic', (ar) => `مجمع ${ar} لجراحة اليوم الواحد`],
    ],
    prefers: ['ADT', 'Medication Prescribe V1', 'Radiology Order', 'Clinical Notes'],
  },
  {
    key: 'imaging',
    name: 'Imaging Centres',
    ar: 'مراكز الأشعة',
    variants: [
      ['Imaging Centre', (ar) => `مركز ${ar} للأشعة`],
      ['Radiology Centre', (ar) => `مركز ${ar} للتصوير الطبي`],
      ['Diagnostic Imaging Centre', (ar) => `مركز ${ar} للتشخيص بالأشعة`],
    ],
    prefers: ['Radiology Order', 'Radiology Report'],
  },
  {
    key: 'pharmacies',
    name: 'Pharmacies',
    ar: 'الصيدليات',
    variants: [
      ['Pharmacy', (ar) => `صيدلية ${ar}`],
      ['Community Pharmacy', (ar) => `صيدلية ${ar} المجتمعية`],
      ['Hospital Pharmacy', (ar) => `صيدلية ${ar} للمستشفيات`],
    ],
    prefers: ['Medication Dispense V1', 'Medication Dispense V2', 'Medication Prescribe V1'],
  },
]

/**
 * How each book splits across the six types, as counts. Written as weights and
 * resolved by largest remainder so each row sums to the book's own size.
 *
 * The weights are kept within a factor of two of each other for one unglamorous
 * reason: an invented organization name is a STEM plus a facility word, the
 * stems are drawn without replacement per type so that no two organizations of
 * one type ever collide, and there are 96 stems. A book that was 40% clinics
 * would need more clinic stems than exist. `assertShape()` below checks it
 * rather than trusting this paragraph.
 */
const TYPE_WEIGHTS = [
  [0.2, 0.22, 0.14, 0.16, 0.12, 0.16],
  [0.16, 0.2, 0.16, 0.16, 0.14, 0.18],
  [0.24, 0.18, 0.16, 0.14, 0.14, 0.14],
  [0.14, 0.22, 0.16, 0.16, 0.16, 0.16],
  [0.18, 0.2, 0.14, 0.18, 0.14, 0.16],
]

/**
 * Vendors per book. Alpha carries 120 of the 400 — the cohort — and it is
 * concentrated in books one and three rather than sprinkled evenly, because a
 * cohort spread uniformly over five books is not a cohort, it is a background.
 * Forty organizations (10%) carry no vendor at all: *not recorded* is a state
 * the filter has to draw and the state most real rows are in.
 */
const VENDORS = [
  'Demo Vendor Alpha',
  'Demo Vendor Beta',
  'Demo Vendor Gamma',
  'Demo Vendor Delta',
  'Demo Vendor Epsilon',
  'Demo Vendor Zeta',
]
const VENDOR_MIX = [
  // Alpha, Beta, Gamma, Delta, Epsilon, Zeta, (none)
  [52, 20, 12, 8, 4, 0, 8],
  [18, 26, 20, 10, 6, 3, 9],
  [34, 12, 10, 8, 5, 2, 8],
  [10, 14, 12, 10, 8, 6, 7],
  [6, 8, 12, 8, 8, 8, 8],
]

/**
 * Stages per book, INCLUDING the blank column.
 *
 * 120 blanks (30%) is "nobody has said", which is not the same fact as "Not
 * started" and is the one the Stalled and Portfolio lenses have to tell apart.
 * 112 on `Integrating` is the bottleneck the whole stage feature exists to make
 * visible. Six `Paused` — enough to draw, few enough to read as deliberate.
 */
const STAGE_MIX = [
  // blank, Not started, Kickoff, Integrating, Testing/UAT, Go-live ready, Live, Paused
  [26, 6, 10, 28, 14, 8, 10, 2],
  [27, 8, 12, 26, 10, 5, 3, 1],
  [24, 6, 8, 24, 8, 5, 3, 1],
  [22, 8, 10, 18, 5, 2, 1, 1],
  [21, 6, 6, 16, 4, 2, 2, 1],
]
const STAGE_ORDER = [
  '',
  STAGE.notStarted,
  STAGE.kickoff,
  STAGE.integrating,
  STAGE.testing,
  STAGE.ready,
  STAGE.live,
  STAGE.paused,
]

/**
 * How many use-case links each organization carries. 180 of 400 carry NONE —
 * the em-dash state — and the rest run 1..10 with a long tail, because a
 * portfolio where every site has the full catalogue is a portfolio nobody has
 * to prioritise.
 *
 * The six ten-link rows are handled separately (`FLAGSHIPS`): they are all-ten
 * `live`, they sit on the `Live` rung, and they are the other end of the same
 * axis as the empty ones.
 */
const LINK_COUNTS = [
  [0, 180],
  [1, 46],
  [2, 40],
  [3, 34],
  [4, 28],
  [5, 24],
  [6, 18],
  [7, 12],
  [8, 8],
  [9, 4],
]
const FLAGSHIPS = 6

/**
 * How a link's status is drawn, per rung. Ordered `planned, testing, live`.
 *
 * A stage and a use-case status are different facts — the rung is where the
 * ORGANIZATION is, the status is where one capability is — but they are not
 * independent, and a demo where a site on `Not started` has six capabilities
 * live is a demo that teaches the reader the two columns are unrelated.
 */
const STATUS_MIX = {
  '': [8, 2, 0],
  [STAGE.notStarted]: [9, 1, 0],
  [STAGE.kickoff]: [8, 2, 0],
  [STAGE.integrating]: [5, 5, 0],
  [STAGE.testing]: [2, 7, 1],
  [STAGE.ready]: [1, 5, 4],
  [STAGE.live]: [1, 2, 7],
  [STAGE.paused]: [5, 4, 1],
}

/**
 * The count-form goals, on the tiers ABOVE the organizations — which is the
 * only place a count means anything ("forty of the ones beneath me"). Six of
 * them; the other thirty-four are dates on organizations, written below.
 */
const COUNT_GOALS = [
  { path: ['Associate Directorate Alpha'], target: 120, day: 302 },
  { path: ['Associate Directorate Beta'], target: 60, day: 211 },
  { path: ['Associate Directorate Alpha', 'Account Book One'], target: 45, day: 121 },
  { path: ['Associate Directorate Alpha', 'Account Book Two'], target: 40, day: 152 },
  { path: ['Associate Directorate Alpha', 'Account Book Three'], target: 30, day: 241 },
  { path: ['Associate Directorate Beta', 'Account Book Four'], target: 25, day: 364 },
]
/** Date-only goals on organizations. 34 + 6 = 40. */
const DATE_GOALS = 34

/**
 * ONE type tier is left with no row of its own, so its node is IMPLIED by the
 * organizations beneath it.
 *
 * Listing every level and listing only the leaves must produce the same tree —
 * that is the file contract's own promise — and a demo file in which every
 * ancestor is spelled out never exercises the half of the planner that makes
 * it true. `Polyclinics` under `Account Book Five` has no row; the plan
 * reports it as the one implied create.
 */
const IMPLIED = { book: 'Account Book Five', type: 'Polyclinics' }

/**
 * Ninety-six ordinary Arabic nouns. Dew, dawn, coral, amber — words, not
 * companies, and no near-miss on a real provider or integrator. A name is one
 * of these plus a facility word, and the stems are drawn WITHOUT REPLACEMENT
 * per type, which is what makes every sibling name (and every sibling Arabic
 * name) unique without a retry loop: `map_nodes_sibling_name_uidx` and
 * `map_nodes_sibling_name_ar_uidx` would both otherwise fail mid-apply.
 */
const STEMS = [
  ['Nawras', 'نورس'], ['Khuzama', 'خزامى'], ['Rimal', 'رمال'], ['Yaqoot', 'ياقوت'],
  ['Wateen', 'وتين'], ['Ghadeer', 'غدير'], ['Areej', 'أريج'], ['Falak', 'فلك'],
  ['Marjan', 'مرجان'], ['Salsabeel', 'سلسبيل'], ['Shurooq', 'شروق'], ['Lulwah', 'لؤلوة'],
  ['Basateen', 'بساتين'], ['Anwa', 'أنواء'], ['Rawnaq', 'رونق'], ['Sadeem', 'سديم'],
  ['Jumana', 'جمانة'], ['Reeman', 'ريمان'], ['Buraq', 'براق'], ['Sanam', 'سنام'],
  ['Dorra', 'درة'], ['Kanan', 'كنان'], ['Zahwa', 'زهوة'], ['Lamha', 'لمحة'],
  ['Nasaem', 'نسائم'], ['Wafeer', 'وفير'], ['Ghaim', 'غيم'], ['Nada', 'ندى'],
  ['Rabee', 'ربيع'], ['Kharif', 'خريف'], ['Sana', 'سنا'], ['Diya', 'ضياء'],
  ['Bareq', 'بارق'], ['Wameed', 'وميض'], ['Shafaq', 'شفق'], ['Suhail', 'سهيل'],
  ['Najma', 'نجمة'], ['Thurayya', 'ثريا'], ['Zuhal', 'زحل'], ['Utarid', 'عطارد'],
  ['Samaa', 'سماء'], ['Ufuq', 'أفق'], ['Nasim', 'نسيم'], ['Wadi', 'وادي'],
  ['Talaa', 'طلعة'], ['Sahl', 'سهل'], ['Marj', 'مرج'], ['Rawd', 'روض'],
  ['Zahra', 'زهرة'], ['Yasmeen', 'ياسمين'], ['Narjis', 'نرجس'], ['Reehan', 'ريحان'],
  ['Zaytoon', 'زيتون'], ['Nakheel', 'نخيل'], ['Sidr', 'سدر'], ['Ghaf', 'غاف'],
  ['Arak', 'أراك'], ['Samar', 'سمر'], ['Talh', 'طلح'], ['Athl', 'أثل'],
  ['Bahar', 'بهار'], ['Kadi', 'كادي'], ['Fill', 'فل'], ['Ward', 'ورد'],
  ['Anbar', 'عنبر'], ['Misk', 'مسك'], ['Kafoor', 'كافور'], ['Lujain', 'لجين'],
  ['Nudar', 'نضار'], ['Tibr', 'تبر'], ['Almas', 'ألماس'], ['Zumurrud', 'زمرد'],
  ['Firuz', 'فيروز'], ['Aqeeq', 'عقيق'], ['Sadaf', 'صدف'], ['Bilaur', 'بلور'],
  ['Kahraman', 'كهرمان'], ['Jawhara', 'جوهرة'], ['Yaqeen', 'يقين'], ['Amal', 'أمل'],
  ['Rajaa', 'رجاء'], ['Wafa', 'وفاء'], ['Safaa', 'صفاء'], ['Naqaa', 'نقاء'],
  ['Hana', 'هناء'], ['Bushra', 'بشرى'], ['Salwa', 'سلوى'], ['Ilham', 'إلهام'],
  ['Basma', 'بسمة'], ['Dhikra', 'ذكرى'], ['Fajr', 'فجر'], ['Duha', 'ضحى'],
  ['Aseel', 'أصيل'], ['Ghuroob', 'غروب'], ['Layali', 'ليالي'], ['Qamar', 'قمر'],
]

/** Invented catchments. Compass directions, not the MOH cluster structure. */
const CATCHMENTS = [
  ['the northern catchment', 'النطاق الشمالي'],
  ['the coastal catchment', 'النطاق الساحلي'],
  ['the inland catchment', 'النطاق الداخلي'],
  ['the southern catchment', 'النطاق الجنوبي'],
  ['the western catchment', 'النطاق الغربي'],
  ['the eastern catchment', 'النطاق الشرقي'],
]

// ── the PRNG ────────────────────────────────────────────────────────────────

/**
 * mulberry32. Thirty-two bits of state, one multiply-xorshift round, and — the
 * only property that matters here — the same sequence on every machine and
 * every Node version, because `Math.random()` is explicitly allowed to differ
 * between engines and even between runs of one engine.
 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(SEED)
const int = (n) => Math.floor(rand() * n)
const pick = (list) => list[int(list.length)]
const chance = (p) => rand() < p

/** Fisher-Yates, on a copy, off the one PRNG stream. */
function shuffled(list) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = int(i + 1)
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

/** A pool of `[value, count]` pairs, flattened and shuffled. */
function pool(pairs) {
  const flat = []
  for (const [value, count] of pairs) for (let i = 0; i < count; i += 1) flat.push(value)
  return shuffled(flat)
}

/** One value from a weighted list of `[value, weight]`. */
function weighted(pairs) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0)
  let roll = rand() * total
  for (const [value, w] of pairs) {
    roll -= w
    if (roll < 0) return value
  }
  return pairs[pairs.length - 1][0]
}

// ── dates ───────────────────────────────────────────────────────────────────

/**
 * `BASE_DATE` plus n days, as `YYYY-MM-DD`.
 *
 * UTC ARITHMETIC, NOT LOCAL. `new Date('2026-09-01')` is parsed as UTC midnight
 * and `.getDate()` reads it back in the machine's zone — west of Greenwich that
 * is the 31st of August, so the same script would write different dates on two
 * laptops and the "byte-identical" property would be a lie that only shows up
 * on somebody else's machine.
 */
function dayOffset(days) {
  const [y, m, d] = BASE_DATE.split('-').map(Number)
  const stamp = new Date(Date.UTC(y, m - 1, d + days))
  const pad = (n) => String(n).padStart(2, '0')
  return `${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())}`
}

// ── the CSV writer ──────────────────────────────────────────────────────────

/**
 * One field, quoted when it has to be.
 *
 * RFC 4180 requires quoting for a comma, a quote or a newline. The SLASH is
 * quoted too, and only one value in this file has one: `Testing/UAT`. It parses
 * identically either way — but the stage names are the one column whose values
 * a person copies out of a migration and pastes into Excel, and a bare slash in
 * a CSV cell is the kind of thing a spreadsheet's import wizard offers to
 * "split" on. Quoting costs two bytes and removes the question.
 */
function field(value) {
  const text = String(value ?? '')
  if (!/[",\r\n/]/u.test(text)) return text
  return `"${text.replace(/"/gu, '""')}"`
}

const csvRow = (cells) => cells.map(field).join(',')

// ── descriptions ────────────────────────────────────────────────────────────
//
// ⚠ THESE DESCRIBE ORGANIZATIONS, NOT THIS DATASET. The previous demo file
// failed a review on exactly this: seven of its rows explained the demo to the
// reader ("the largest branch on purpose: the map encodes descendant count as
// size…") in the field that renders as a hospital's description in the panel.
// Length, wrapping and the Arabic/English pairing cannot be judged against copy
// nobody would write, and a screenshot that leaves the room then shows the
// build's own reasoning back at itself. So: bed counts, room counts, what is in
// production and what is waiting on whom. Nothing about the map.

const SIZE_PHRASE = {
  hospitals: (n) => `${n}-bed`,
  clinics: (n) => `${n}-room`,
  labs: (n) => `${n}-bench`,
  polyclinics: (n) => `${n}-room`,
  imaging: (n) => `${n}-modality`,
  pharmacies: (n) => `${n}-counter`,
}
const SIZE_RANGE = {
  hospitals: [40, 720],
  clinics: [3, 18],
  labs: [4, 30],
  polyclinics: [6, 40],
  imaging: [2, 9],
  pharmacies: [2, 12],
}
const SIZE_PHRASE_AR = {
  hospitals: (n) => `بسعة ${n} سريراً`,
  clinics: (n) => `بـ ${n} غرف`,
  labs: (n) => `بـ ${n} منصات فحص`,
  polyclinics: (n) => `بـ ${n} غرف`,
  imaging: (n) => `بـ ${n} أجهزة تصوير`,
  pharmacies: (n) => `بـ ${n} نوافذ صرف`,
}

const STAGE_LINE = {
  '': [
    'Scope not agreed yet; the first scoping session is being arranged.',
    'Contracted, with no integration work scheduled.',
    'Recorded for completeness while the onboarding order is decided.',
  ],
  [STAGE.notStarted]: [
    'Onboarding agreed and nothing has begun.',
    'On the list for this year; no work has started.',
  ],
  [STAGE.kickoff]: [
    'Kickoff held with the vendor; the interface catalogue is being confirmed.',
    'Kickoff done and the technical contacts are named on both sides.',
  ],
  [STAGE.integrating]: [
    'Interfaces are being built against the sandbox.',
    'Message mapping is in progress; the first end-to-end call has been made.',
    'Build under way, held up on the identity feed.',
  ],
  [STAGE.testing]: [
    'In integration testing with the vendor.',
    'User acceptance testing is running with the clinical team.',
    'Testing is complete on the first two capabilities and continuing on the rest.',
  ],
  [STAGE.ready]: [
    'Testing signed off and a go-live window is being booked.',
    'Ready to go live, waiting on the change freeze to lift.',
  ],
  [STAGE.live]: [
    'In production and reporting daily volumes.',
    'Live since the last release window, with support in hypercare.',
  ],
  [STAGE.paused]: [
    'Paused at the site’s request until the estate work finishes.',
    'Paused while the vendor contract is renegotiated.',
  ],
}
const STAGE_LINE_AR = {
  '': ['لم يُتفق على النطاق بعد.', 'تم التعاقد ولم تُجدول أعمال التكامل.'],
  [STAGE.notStarted]: ['متفق على التأهيل ولم يبدأ العمل.', 'مدرج ضمن خطة هذا العام ولم يبدأ بعد.'],
  [STAGE.kickoff]: ['عُقد اجتماع الانطلاق مع المورد.', 'اكتمل اجتماع الانطلاق وحُددت جهات الاتصال الفنية.'],
  [STAGE.integrating]: ['يجري بناء الواجهات على البيئة التجريبية.', 'ربط الرسائل قيد التنفيذ.'],
  [STAGE.testing]: ['قيد اختبار التكامل مع المورد.', 'اختبار القبول جارٍ مع الفريق السريري.'],
  [STAGE.ready]: ['اكتمل الاختبار ويجري حجز موعد الإطلاق.', 'جاهز للإطلاق بانتظار رفع تجميد التغييرات.'],
  [STAGE.live]: ['في الإنتاج ويرسل الأحجام اليومية.', 'دخل الإنتاج في نافذة الإصدار الأخيرة.'],
  [STAGE.paused]: ['موقوف بطلب من المنشأة.', 'موقوف ريثما تُستكمل مراجعة العقد.'],
}

const EXTRA_LINE = [
  'The clinical team has asked for a second training round before the next capability is switched on.',
  'A second site under the same operator is expected to follow the same interface build.',
  'The vendor has one engineer allocated, which is what sets the pace here.',
  'Volumes are seasonal and the go-live window avoids the peak.',
  'Two of the interfaces are shared with the reference laboratory and move together.',
]

// ── build ───────────────────────────────────────────────────────────────────

/** Largest-remainder split of `total` across `weights`. */
function split(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const exact = weights.map((w) => (w / sum) * total)
  const counts = exact.map(Math.floor)
  let left = total - counts.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, i) => ({ i, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0; k += 1, left -= 1) counts[order[k % order.length].i] += 1
  return counts
}

function assertShape() {
  const total = BOOKS.reduce((sum, b) => sum + b.size, 0)
  for (let b = 0; b < BOOKS.length; b += 1) {
    const vendorSum = VENDOR_MIX[b].reduce((a, c) => a + c, 0)
    if (vendorSum !== BOOKS[b].size) {
      throw new Error(`VENDOR_MIX[${b}] sums to ${vendorSum}, and ${BOOKS[b].name} holds ${BOOKS[b].size}.`)
    }
    const stageSum = STAGE_MIX[b].reduce((a, c) => a + c, 0)
    if (stageSum !== BOOKS[b].size) {
      throw new Error(`STAGE_MIX[${b}] sums to ${stageSum}, and ${BOOKS[b].name} holds ${BOOKS[b].size}.`)
    }
  }
  const links = LINK_COUNTS.reduce((a, [, c]) => a + c, 0) + FLAGSHIPS
  if (links !== total) throw new Error(`LINK_COUNTS + FLAGSHIPS is ${links}, and the file holds ${total} organizations.`)
  const liveRung = STAGE_MIX.reduce((a, row) => a + row[6], 0)
  if (FLAGSHIPS > liveRung) throw new Error(`${FLAGSHIPS} flagships need ${FLAGSHIPS} Live rows and STAGE_MIX gives ${liveRung}.`)
}

function build() {
  assertShape()

  // The header, verbatim from the empty template. Everything to the right of
  // the tenth column is a use case, whatever 0024 called it.
  const template = readFileSync(TEMPLATE, 'utf8').replace(/^﻿/u, '')
  const header = template.split(/\r?\n/u)[0]
  const columns = header.split(',')
  const useCases = columns.slice(10)
  if (columns.length <= 10 || useCases.some((c) => c === '')) {
    throw new Error(`docs/templates/structure.csv has no use-case columns to copy: ${header}`)
  }

  // One stem queue per type, drawn without replacement.
  const stemQueue = TYPES.map(() => shuffled(STEMS))
  const stemCursor = TYPES.map(() => 0)

  // Per-book pools. Shuffled here, consumed in path order below, so which
  // organization gets which vendor is stable and which COUNT each vendor gets
  // is exact.
  const vendorPool = VENDOR_MIX.map((mix) =>
    pool([...VENDORS.map((v, i) => [v, mix[i]]), ['', mix[6]]]),
  )
  const stagePool = STAGE_MIX.map((mix) => pool(STAGE_ORDER.map((s, i) => [s, mix[i]])))

  // ── the rows, in tree order ──
  //
  // ⚠ ORGANIZATION ROWS ARE PLACED HERE AND FILLED IN LATER. `sort_order` comes
  // out of FILE ORDER, so the sequence in this file is the sequence the map
  // draws — an appendix of four hundred organizations after all thirty-eight
  // tier rows would be correct and unreadable, and would put every book's
  // contents somewhere other than under the book. But the six flagship rows
  // cannot be chosen until every stage has been dealt (they are drawn from the
  // rows already on the terminal rung), so the org rows are RESERVED in place
  // during the walk and rendered after.
  const sequence = []
  const orgs = []

  const emit = (segments, values) => {
    sequence.push({
      cells: [
        [TRACK, ...segments].join(' > '),
        values.nameAr ?? '',
        values.kind ?? '',
        values.am ?? '',
        values.vendor ?? '',
        values.description ?? '',
        values.descriptionAr ?? '',
        values.stage ?? '',
        values.targetDate ?? '',
        values.target ?? '',
        ...useCases.map((name) => values.links?.[name] ?? ''),
      ],
    })
  }

  emit([ROOT], {
    nameAr: 'المحفظة التجريبية',
    kind: 'Programme',
    am: AM_AZIZ,
    description:
      'DEMO DATA. Every organization, vendor and person below this node is invented. Delete this one branch to reset the workspace before the real structure is imported.',
    descriptionAr:
      'بيانات تجريبية. جميع المنشآت والموردين والأشخاص أدناه غير حقيقيين، ويُحذف هذا الفرع بالكامل قبل استيراد الهيكل الفعلي.',
  })

  const goalByPath = new Map(COUNT_GOALS.map((g) => [g.path.join(' > '), g]))

  for (let d = 0; d < DIRECTORATES.length; d += 1) {
    const ad = DIRECTORATES[d]
    const adGoal = goalByPath.get(ad.name)
    emit([ROOT, ad.name], {
      nameAr: ad.ar,
      kind: 'Programme',
      description:
        d === 0
          ? 'The larger of the two directorates: three account books, and the sites that came in with the first onboarding wave.'
          : 'The second directorate: two account books, opened this year, still mostly in build.',
      descriptionAr:
        d === 0
          ? 'الأكبر بين الإدارتين: ثلاث محافظ حسابات، والمنشآت التي انضمت في موجة التأهيل الأولى.'
          : 'الإدارة الثانية: محفظتا حسابات، فُتحتا هذا العام ومعظم أعمالهما قيد البناء.',
      targetDate: adGoal ? dayOffset(adGoal.day) : '',
      target: adGoal ? String(adGoal.target) : '',
    })

    for (let b = 0; b < BOOKS.length; b += 1) {
      const book = BOOKS[b]
      if (book.ad !== d) continue
      const bookGoal = goalByPath.get(`${ad.name} > ${book.name}`)
      emit([ROOT, ad.name, book.name], {
        nameAr: book.ar,
        am: book.am,
        description: book.am
          ? `${book.size} organizations, managed end to end by one account manager.`
          : `${book.size} organizations with no account manager assigned yet.`,
        descriptionAr: book.am
          ? `${book.size} منشأة يديرها مدير حساب واحد.`
          : `${book.size} منشأة لم يُعيَّن لها مدير حساب بعد.`,
        targetDate: bookGoal ? dayOffset(bookGoal.day) : '',
        target: bookGoal ? String(bookGoal.target) : '',
      })

      const counts = split(book.size, TYPE_WEIGHTS[b])
      for (let t = 0; t < TYPES.length; t += 1) {
        const type = TYPES[t]
        const impliedHere = IMPLIED.book === book.name && IMPLIED.type === type.name
        if (!impliedHere) {
          emit([ROOT, ad.name, book.name, type.name], {
            nameAr: type.ar,
            description: `${counts[t]} ${type.name.toLowerCase()} in ${book.name.toLowerCase()}.`,
          })
        }

        for (let n = 0; n < counts[t]; n += 1) {
          const stem = stemQueue[t][stemCursor[t]]
          stemCursor[t] += 1
          if (!stem) {
            throw new Error(
              `ran out of stems for ${type.name}: ${STEMS.length} available, ${stemCursor[t]} needed. Widen STEMS or flatten TYPE_WEIGHTS.`,
            )
          }
          const [variantEn, variantAr] = pick(type.variants)
          const vendor = vendorPool[b].pop()
          const stage = stagePool[b].pop()
          const [catchmentEn, catchmentAr] = pick(CATCHMENTS)
          const [lo, hi] = SIZE_RANGE[type.key]
          const size = lo + int(hi - lo + 1)
          const org = {
            book: b,
            bookName: book.name,
            adName: ad.name,
            type,
            typeIndex: t,
            name: `${stem[0]} ${variantEn}`,
            nameAr: variantAr(stem[1]),
            hasArabic: chance(0.6),
            am: book.am,
            amHere: book.am ? chance(0.9) : false,
            vendor,
            stage,
            size,
            catchmentEn,
            catchmentAr,
            segments: [ROOT, ad.name, book.name, type.name],
            describe: chance(0.58),
            long: chance(0.1),
            links: {},
          }
          orgs.push(org)
          sequence.push({ org })
        }
      }
    }
  }

  // ── the flagships, then everybody else's link counts ──
  //
  // Chosen from the rows already on the terminal rung rather than promoted onto
  // it, so the stage table the summary prints is the one STAGE_MIX states.
  const liveOrgs = orgs.filter((o) => o.stage === STAGE.live)
  const flagships = new Set(shuffled(liveOrgs.map((_, i) => i)).slice(0, FLAGSHIPS).map((i) => liveOrgs[i]))
  const countPool = pool(LINK_COUNTS)
  for (const org of orgs) {
    if (flagships.has(org)) {
      org.linkCount = useCases.length
      org.allLive = true
      continue
    }
    org.linkCount = countPool.pop()
    org.allLive = false
  }

  // ── which capabilities, and in what state ──
  for (const org of orgs) {
    if (org.linkCount === 0) continue
    // A laboratory records its lab pair before it records anything else. The
    // preference list is the type's; the rest of the catalogue follows in a
    // shuffled order, so no two organizations of one type carry the same set.
    const preferred = org.type.prefers.filter((n) => useCases.includes(n))
    const rest = shuffled(useCases.filter((n) => !preferred.includes(n)))
    const chosen = [...preferred, ...rest].slice(0, org.linkCount)
    const mix = STATUS_MIX[org.stage] ?? STATUS_MIX['']
    for (const name of chosen) {
      org.links[name] = org.allLive
        ? 'live'
        : weighted([
            ['planned', mix[0]],
            ['testing', mix[1]],
            ['live', mix[2]],
          ])
    }
  }

  // ── the date-only goals ──
  //
  // On organizations that are actually moving: a commitment on a site nobody
  // has started is a commitment nobody made. Drawn from the rows past Kickoff,
  // spread across the twelve months after BASE_DATE.
  const movers = orgs.filter((o) =>
    [STAGE.integrating, STAGE.testing, STAGE.ready].includes(o.stage),
  )
  for (const org of shuffled(movers).slice(0, DATE_GOALS)) {
    org.targetDate = dayOffset(21 + int(344))
  }

  // ── the copy, written last so it can read the stage the row ended up on ──
  for (const org of orgs) {
    org.description = ''
    org.descriptionAr = ''
    if (!org.describe) continue
    const sizePhrase = SIZE_PHRASE[org.type.key](org.size)
    const noun = org.name.split(' ').slice(1).join(' ').toLowerCase()
    const line = pick(STAGE_LINE[org.stage])
    const head = `${sizePhrase} ${noun} serving ${org.catchmentEn}.`
    org.description = org.long ? `${head} ${line} ${pick(EXTRA_LINE)}` : `${head} ${line}`
    if (org.hasArabic) {
      org.descriptionAr = `منشأة ${SIZE_PHRASE_AR[org.type.key](org.size)} تخدم ${org.catchmentAr}. ${pick(STAGE_LINE_AR[org.stage])}`
    }
  }

  const rows = sequence.map((item) => {
    if (item.cells) return item.cells
    const org = item.org
    return [
      [TRACK, ...org.segments, org.name].join(' > '),
      org.hasArabic ? org.nameAr : '',
      'Organization',
      org.amHere ? org.am : '',
      org.vendor,
      org.description,
      org.descriptionAr,
      org.stage,
      org.targetDate ?? '',
      '',
      ...useCases.map((name) => org.links[name] ?? ''),
    ]
  })

  return { header, rows, orgs, useCases, flagships }
}

// ── output ──────────────────────────────────────────────────────────────────

function tally(list, key) {
  const counts = new Map()
  for (const item of list) {
    const k = key(item)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

function table(title, entries, total) {
  const width = Math.max(...entries.map(([label]) => label.length), 1)
  const lines = [`  ${title}`]
  for (const [label, count] of entries) {
    const share = total ? ` ${String(Math.round((count / total) * 100)).padStart(3)}%` : ''
    lines.push(`    ${label.padEnd(width)}  ${String(count).padStart(4)}${share}`)
  }
  return lines.join('\n')
}

function main() {
  const { header, rows, orgs, useCases, flagships } = build()

  // ⚠ BOM, ALWAYS. Without it Excel guesses the local ANSI codepage and every
  // Arabic name in this file opens as mojibake — which is then what gets saved
  // back and re-imported. CRLF for the same reason: this is a file somebody
  // opens in Excel on Windows.
  const text = `﻿${[header, ...rows.map(csvRow)].join('\r\n')}\r\n`
  writeFileSync(OUTPUT, text)

  const total = orgs.length
  const links = orgs.flatMap((o) => Object.entries(o.links))
  const goalRows = rows.filter((r) => r[8] !== '')
  const countGoals = goalRows.filter((r) => r[9] !== '')

  const out = []
  out.push(`docs/templates/structure.demo.csv — ${rows.length} rows, ${text.length} chars`)
  out.push(`  header copied from docs/templates/structure.csv · ${useCases.length} use-case columns`)
  out.push(`  seed 0x${SEED.toString(16)} · base date ${BASE_DATE} · re-running writes the same bytes`)
  out.push('')

  out.push(
    table(
      'account manager',
      [
        ...[...tally(orgs.filter((o) => o.amHere), (o) => o.am)].sort((a, b) => b[1] - a[1]),
        ['(unassigned)', orgs.filter((o) => !o.amHere).length],
      ],
      total,
    ),
  )
  out.push(
    '    ⚠ three of the five books are BLANK in the account_manager column, and that is the',
    '      point rather than an omission: Aziz and Nasser Alabri are the only two provisioned',
    '      accounts in this workspace, so they are the only two names an import can resolve.',
    '      Naming the other three account managers would be inventing people — and the import',
    '      would refuse every one of those rows with `member_unknown` rather than leave them',
    '      unassigned. The unassigned pile is itself under test: it is what the map looks like',
    '      in week one, and what the Unassigned bucket has to be able to draw at this size.',
    '',
  )

  out.push(table('type', [...tally(orgs, (o) => o.type.name)], total), '')
  out.push(
    table(
      'book',
      [...tally(orgs, (o) => `${o.adName.replace('Associate Directorate ', 'AD ')} › ${o.bookName}`)],
      total,
    ),
    '',
  )
  out.push(
    table(
      'vendor',
      [
        ...[...tally(orgs.filter((o) => o.vendor), (o) => o.vendor)].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        ),
        ['(none recorded)', orgs.filter((o) => !o.vendor).length],
      ],
      total,
    ),
    '',
  )
  out.push(
    table(
      'stage',
      [
        ...STAGE_ORDER.slice(1).map((s) => [s, orgs.filter((o) => o.stage === s).length]),
        ['(nobody has said)', orgs.filter((o) => o.stage === '').length],
      ],
      total,
    ),
    '',
  )

  const linkBuckets = [
    ['0 (nothing recorded)', orgs.filter((o) => o.linkCount === 0).length],
    ['1–3', orgs.filter((o) => o.linkCount >= 1 && o.linkCount <= 3).length],
    ['4–6', orgs.filter((o) => o.linkCount >= 4 && o.linkCount <= 6).length],
    ['7–9', orgs.filter((o) => o.linkCount >= 7 && o.linkCount <= 9).length],
    [`${useCases.length} (all, all live)`, flagships.size],
  ]
  out.push(table('use-case links per organization', linkBuckets, total))
  out.push(
    table(
      'use-case link status',
      [...tally(links, ([, status]) => status)].sort((a, b) => a[0].localeCompare(b[0])),
      links.length,
    ),
  )
  out.push(`    ${links.length} links in total`, '')

  out.push(
    table('goals', [
      ['date only, on an organization', goalRows.length - countGoals.length],
      ['count, on a directorate or book', countGoals.length],
    ]),
    `    dates run ${dayOffset(21)} → ${dayOffset(364)}, all offsets from ${BASE_DATE}`,
    '',
  )

  const implied = `${IMPLIED.book} > ${IMPLIED.type}`
  out.push(
    `  one tier is left implied — ${implied} has no row of its own and is created from`,
    '  the paths beneath it, so the plan reports exactly 1 implied node.',
  )

  process.stdout.write(`${out.join('\n')}\n`)
}

main()
