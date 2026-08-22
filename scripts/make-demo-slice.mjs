#!/usr/bin/env node
// make-demo-slice — writes `docs/templates/structure.slice.csv`, and writes the
// SAME BYTES every time it is run.
//
//   npm run demo:slice
//   npm run demo:slice && git diff --stat docs/templates/   # → empty
//
// ═══ WHY A SECOND, SMALLER FILE INSTEAD OF SHRINKING THE FIRST ═══
//
// `make-demo-400.mjs` stays exactly as it is, and so does
// `docs/templates/structure.demo.csv`. That file is the stress case — four
// hundred organizations is what the canvas, the roll-up and the importer have to
// survive, and `scripts/lib/structurePlan.test.mjs` reads that exact filename
// and pins its tier names and its 380–430 organization range. Editing it to make
// it smaller would delete the evidence that the big case works.
//
// This is the OTHER question: what goes into the live project on the day the
// owner wants a workspace to look at, knowing the real NPHIES Master Status
// Report is coming and everything here has to come back out. Seventy-two
// organizations undo in a few seconds and read in one screen; four hundred do
// not. Both files import through the same planner, both hang under ONE deletable
// root, and the roots are different names (`Demo Portfolio` / `Demo Slice`) so a
// workspace can even hold both and delete either.
//
// ⚠ DETERMINISTIC, AND THAT IS THE TEST — LITERALLY, NOW. No `Math.random()`,
// no `Date.now()`, no `new Date()` that is not `Date.UTC` arithmetic off a fixed
// base. One seeded PRNG (`SEED`) consumed in one fixed order, one `BASE_DATE`,
// one `AS_OF`. Run it twice and the bytes are identical, which is what makes the
// committed CSV reviewable as a diff instead of a 83-line churn on every
// regeneration.
//
// `structurePlan.test.mjs` imports `build()` and `render()` and compares the
// result against `docs/templates/structure.slice.csv` BYTE FOR BYTE, which is
// why `main()` is guarded at the bottom of this file rather than called
// outright. Until that test existed this paragraph was a comment: `verify()`
// measures counts, and every count here stays inside its band under a reshuffle
// — so a `pick()` inserted before the stem draw would churn all 83 rows, pass
// every gate, and land as a diff a reviewer reads as noise.
//
// ⚠ THE HEADER IS READ FROM `docs/templates/structure.csv`, NEVER REBUILT — for
// the reason make-demo-400 gives at its own line 26. The ten fixed columns are
// `structurePlan.mjs`'s `FIXED_COLUMNS` and everything to the right of the tenth
// comma is a use case, whatever 0024 called it. A header assembled from a list
// in here would drift the day an eleventh capability is seeded, and the
// three-template header-identity test would then fail on the template that was
// right.
//
// ═══ WHAT THIS SLICE HAS TO MAKE LEGIBLE, AND THE NUMBER THAT BUYS EACH ═══
//
// A small file is easy to make; a small file that still draws every surface is
// not. Each of these is a count in the tables below rather than a hope:
//
//   · A RING THAT ACTUALLY COHORTS. `RING_CAP` is 24 on a desktop
//     (src/lib/mindtree/model.ts:242), not the "~9" that gets quoted around —
//     nine is a prose figure about `packRing` card sizes, not a threshold. So
//     `Account Book One` carries 26 organizations AS DIRECT CHILDREN, with no
//     type tier under it, and is the one ring in the file that crosses the cap.
//     `assertShape()` refuses to write the file if that stops being true.
//   · AND IT COHORTS BY THE INTERESTING AXIS — ONCE A GROUPING IS ASKED FOR,
//     WHICH IS NOT THE STATE THE CANVAS OPENS IN. A reader who has pressed
//     nothing gets `canvasBy = BY_FOR_GROUPING.none`, and that is `phase` by
//     construction (Mindtree.tsx:493-500, useMapModel.ts's `GROUPING_FOR_BY`
//     inverted); `groupEntities` returns `{ grouped: false }` outright for
//     grouping `none` (model.ts:1260). So on first open Book One draws as 26
//     UNGROUPED marks, which is the n = 25..60 band model.ts:211 says renders
//     no text by design — 26 unnamed dots, and no cohort. Pressing any grouping
//     chip, or opening `?by=stage` directly, is what enters `groupRing`.
//     After that: `groupRing` tries the reader's axis first, then manager →
//     type → stage → vendor, and accepts the first giving ≥2 buckets and fewer
//     buckets than organizations. Every organization in Book One carries `Aziz`
//     — one manager bucket, which the ladder refuses — and `type` is the node
//     KIND (all `Organization`, one bucket, refused too), so whichever chip is
//     pressed, the cut that lands is STAGE. Give three of those 26 a blank
//     account manager and the ring would cohort into "Aziz / Unassigned" and
//     never show the ladder.
//   · ALL SEVEN RUNGS, WITH A BOTTLENECK. 18 of 72 on `Integrating` against 8 on
//     the next-largest rung, 3 `Paused` so the stopped clock draws, and 22 (31%)
//     on NO rung at all — "nobody has said", which is a different fact from
//     `Not started` and the one the lenses have to tell apart.
//   · TEAM AND VENDORS. Two managers who resolve, one whole book deliberately
//     unassigned, six vendors with a dominant cohort (22 against 14) and nine
//     organizations (13%) with no vendor recorded.
//   · GOALS THAT ARE NOT ALL IN THE FUTURE. Twelve goals: nine dates on
//     organizations, three counts on the tiers above them, and five of the
//     twelve fall BEFORE `AS_OF` so the overdue clock in the goal panel actually
//     draws red. `make-demo-400` has no overdue goal at all.
//   · RTL, IN BOTH LENGTHS. 60% of organizations carry an Arabic name, and
//     every described organization with one carries an Arabic description
//     beside the English. Five of those Arabic descriptions run past 200
//     characters, because the pairing's harder half is WRAPPING and an Arabic
//     column that stops at 90 characters is one line at every breakpoint — the
//     reviewer who opens the demo to look at RTL line-breaking would find
//     nothing to look at. `verify()` measures the Arabic side against the same
//     bar as the English, and refuses a plural counted noun past ten while it
//     is there (`بـ 34 غرف` is text an Arabic reader sees as broken).
//
// ═══ THE ONE THING THIS FILE CANNOT DO, STATED RATHER THAN FAKED ═══
//
// THE STALLED LIST IS NOT REACHABLE FROM A CSV, AND NO ARRANGEMENT OF THESE
// COUNTS MAKES IT REACHABLE. `atRisk` is `daysInStage > threshold` and nothing
// else (src/lib/portfolio/rows.ts:61, src/lib/lifecycle.ts:121). Both halves are
// out of a spreadsheet's reach:
//
//   1. `expected_days` is seeded NULL on every one of 0026's seven rungs on
//      purpose, and `PortfolioStage` passes `fallbackStallDays: null`
//      (PortfolioStage.tsx:618) — so `resolveStallDays` answers null for every
//      rung and `isAtRisk` returns false before it looks at anything else.
//   2. `stage_changed_at` is written ONLY by 0026's stamp trigger and the
//      importer deliberately never sends it (import-structure.mjs:1468), so on
//      import day every staged organization reads ZERO days in stage.
//
// So `?by=stage&risk=1` — the default view — is empty on import day for this
// file, for `structure.demo.csv`, and for any CSV anybody ever writes. A demo
// that claimed otherwise would be a demo that lied, and the honest version is
// worth more: what the reader sees instead is the `portfolioNoThreshold` banner
// (PortfolioStage.tsx:863), which is the app correctly saying "nobody has
// stated an expectation yet". Turning the risk cut into something with rows in
// it is two owner actions, in this order:
//
//   a. Settings › Catalogue → give `Integrating` an expected days of, say, 14.
//      The banner goes away and the rung is now judgeable.
//   b. Let the clock run, or move one organization onto and off a rung so the
//      stamp trigger back-dates nothing but starts counting. Fifteen days after
//      the import the eighteen `Integrating` organizations are the stalled pile,
//      and they are the largest rung in the file precisely so that pile is the
//      one the reader meets.
//
// What the slice CAN put on screen with no owner action is the bottleneck
// itself: `by=stage` with the risk cut off is 18 organizations stacked on one
// middle rung, the `one fix unblocks N` column reading off that rung, three
// `Paused` rows with a stopped clock, and 22 organizations nobody has staged.
//
// ═══ APPLYING IT NEEDS 0026 AND 0027 ═══
//
// This file fills `stage`, `target_date` and `target`, and those three columns
// are the deliberate pre-migration tripwire: `structurePlan.mjs` refuses the
// whole import by name — `stage_tables_missing` / `goal_table_missing` — against
// a project where 0026/0027 have not been run, before it reads a single value.
// As of this writing they have NOT been run against the live project. Run the
// sitting first (docs/RUN-0026-0027-0028.md); a file whose three wave-8 columns
// are blank imports fine today, and this one's are not blank on purpose, because
// a slice with no ladder and no goals cannot show the two lenses it exists for.
//
// ═══ WHAT IS INVENTED, AND HOW OBVIOUSLY ═══
//
// Everything except two names. Vendors are `Demo Vendor …`; organizations are an
// ordinary Arabic noun plus a facility word; no tier mirrors a real cluster or
// city; and the only people named are `Aziz` and `Nasser Alabri`, the two
// provisioned accounts, which is why they are the only two an import can
// resolve — a third invented name is refused row by row as `member_unknown`.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// ── the constants that make this reproducible ───────────────────────────────

/** The one seed. Its own value, not make-demo-400's, so the two files' invented
 *  names do not line up row for row and read as a copy. */
const SEED = 0x4e50534c

/**
 * Every goal date is `BASE_DATE + n days`, and n may be NEGATIVE.
 *
 * ⚠ NOT `new Date()`. A goal dated from the clock re-dates itself on every run
 * and the committed file changes whenever anybody regenerates it.
 */
const BASE_DATE = '2026-09-01'

/**
 * The day this slice is cut FOR — the reference the words "ahead" and "overdue"
 * are measured against in the summary and in `verify()`.
 *
 * ⚠ A FIXED LITERAL, NOT A CLOCK, and therefore something that ages. It is here
 * as one line rather than spread through the goal table so that regenerating
 * this file next spring is one edit: move `AS_OF` forward, and move the negative
 * offsets in `GOAL_DAYS` with it. If `AS_OF` ever drifts past the demo day the
 * only thing that breaks is the claim below that five goals read as overdue —
 * they would read as ahead, which is a duller demo, not a wrong file.
 */
const AS_OF = '2026-08-21'

const TEMPLATE = new URL('../docs/templates/structure.csv', import.meta.url)
const OUTPUT = new URL('../docs/templates/structure.slice.csv', import.meta.url)

const TRACK = 'UHR'

/**
 * A DIFFERENT ROOT FROM `structure.demo.csv`'s `Demo Portfolio`, on purpose.
 * `map_nodes` has no column marking a row as demo-created, so the subtree IS the
 * reset story: delete this one node and every invented row goes with it. Two
 * different roots mean a workspace can hold the slice and the four-hundred file
 * at once, and undo either without touching the other.
 */
const ROOT = 'Demo Slice'

/** The two provisioned members. Everything else in the AM column is blank. */
const AM_AZIZ = 'Abdulaziz Alsaloom'
const AM_NASSER = 'nasser'

/**
 * 0026's seven rungs, verbatim.
 *
 * ⚠ DATA FOR A SPREADSHEET CELL, NOT A LIST THE IMPORTER READS.
 * `structurePlan.mjs` holds no stage name at all and reads the ladder out of the
 * database, because every rung is renameable in Settings › Catalogue. If a rung
 * is renamed these cells stop matching and the importer refuses by name, which
 * is the correct failure and not a bug in this file.
 */
const STAGE = {
  notStarted: 'Not started',
  kickoff: 'Kickoff',
  integrating: 'Integrating & Testing',
  testing: 'UAT',
  ready: 'Go-live readiness',
  live: 'Live',
  paused: 'Paused',
}

/**
 * `src/lib/mindtree/model.ts:242`, MIRRORED HERE SO `assertShape()` CAN CHECK
 * AGAINST IT — and mirrored with its consequence spelled out, because a mirror
 * that drifts silently is worse than no mirror. If somebody lowers or raises
 * `RING_CAP` in the model, this constant is wrong and the file it writes stops
 * demonstrating the cohort. It is not imported because that module is TypeScript
 * inside the app bundle and this is a plain Node script the app never loads.
 */
const RING_CAP = 24

// ── the shape, as tables of counts ──────────────────────────────────────────
//
// Exact counts rather than probabilities, for the reason make-demo-400 gives at
// its line 114 and doubly at this size: 30% of 72 produced by coin flips is
// 30% ± 11, and the summary printed at the end would be a measurement of luck.
// The pools below are shuffled, so WHICH organization gets which value is
// pseudo-random; HOW MANY get it is stated here.

/**
 * Four account-manager books. 26 + 22 + 14 + 10 = 72 organizations.
 *
 * `tiered: false` is the load-bearing field. A book with no type tier holds its
 * organizations as DIRECT children, so its ring is the whole book — which is the
 * only way a 72-organization file gets a ring past `RING_CAP`. Book One is the
 * cohort demonstration; Book Four is flat too but small (10), which is what the
 * same ring looks like UNDER the cap, drawn as named cards.
 *
 * `amAlways` forces every organization in the book to carry the manager rather
 * than the usual nine-in-ten. It is true for exactly one book, and only so that
 * Book One's ring cannot cohort on `manager` — see the header.
 */
const BOOKS = [
  {
    name: 'Account Book One',
    ar: 'محفظة الحسابات الأولى',
    size: 26,
    am: AM_AZIZ,
    amAlways: true,
    ad: 0,
    tiered: false,
  },
  {
    name: 'Account Book Two',
    ar: 'محفظة الحسابات الثانية',
    size: 22,
    am: AM_NASSER,
    amAlways: false,
    ad: 0,
    tiered: true,
  },
  {
    name: 'Account Book Three',
    ar: 'محفظة الحسابات الثالثة',
    size: 14,
    am: '',
    amAlways: false,
    ad: 1,
    tiered: true,
  },
  {
    name: 'Account Book Four',
    ar: 'محفظة الحسابات الرابعة',
    size: 10,
    am: AM_AZIZ,
    amAlways: false,
    ad: 1,
    tiered: false,
  },
]

/**
 * Two Associate Directorates, uneven — 48 organizations against 24. A tree whose
 * branches are the same size draws as a wheel and says nothing about where the
 * work is.
 */
const DIRECTORATES = [
  { name: 'Associate Directorate Alpha', ar: 'الإدارة المساعدة ألفا' },
  { name: 'Associate Directorate Beta', ar: 'الإدارة المساعدة بيتا' },
]

/**
 * The six organization types, with the facility words a name is built from and
 * the capabilities that type records first.
 *
 * ⚠ NO `kind` ON THE TIER ROW, ON PURPOSE. 0023 seeds exactly three kinds —
 * Programme, Phase, Organization — and none of them is "a folder of hospitals".
 * A blank kind is legal and says nothing, which is right for a grouping node.
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
 * How many organizations of each type each book holds — EXACT COUNTS, not
 * weights, because at 72 a largest-remainder split of a percentage is a table
 * nobody can check by eye.
 *
 * A ZERO IS MEANINGFUL: in a tiered book it means that type has no tier row and
 * no organizations, so the tier simply is not there. Book Two is a
 * hospital/clinic/laboratory book and Book Three is a polyclinic/pharmacy one,
 * which is what gives `?by=phase` more than one phase to draw. The two flat
 * books spread across all six types — the type is then only visible in the
 * facility word, which is exactly the point: their rings must NOT be cuttable by
 * anything except stage and vendor.
 */
const TYPE_COUNTS = [
  // Hospitals, Clinics, Laboratories, Polyclinics, Imaging, Pharmacies
  [6, 7, 4, 4, 3, 2], // Book One   — flat, 26
  [9, 7, 6, 0, 0, 0], // Book Two   — tiered, 22
  [0, 0, 0, 8, 0, 6], // Book Three — tiered, 14
  [2, 3, 1, 1, 2, 1], // Book Four  — flat, 10
]

/**
 * Vendors per book, with a seventh "none" column.
 *
 * Alpha carries 22 of 72 and is concentrated in Book One rather than sprinkled
 * evenly, because a cohort spread uniformly across four books is not a cohort,
 * it is a background. Nine organizations (13%) carry no vendor at all: *not
 * recorded* is the state most real rows are in and the one the filter has to be
 * able to draw.
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
  [12, 5, 3, 2, 1, 0, 3], // 26
  [6, 5, 4, 3, 2, 1, 1], // 22
  [3, 3, 2, 2, 1, 1, 2], // 14
  [1, 1, 2, 1, 1, 1, 3], // 10
]

/**
 * Stages per book, INCLUDING the blank column.
 *
 * 22 blanks (31%) is "nobody has said", which is not the same fact as
 * `Not started` and is the one the Portfolio lens has to tell apart. 18 on
 * `Integrating` against 8 on the next-largest rung is the bottleneck the whole
 * stage feature exists to make visible — and, once an `expected_days` is typed
 * into the catalogue, it is the stalled pile. Three `Paused`: enough to draw a
 * stopped clock, few enough to read as deliberate.
 *
 * ⚠ EVERY ROW OF THIS TABLE MUST KEEP AT LEAST TWO NON-ZERO ENTRIES FOR BOOK
 * ONE, or its 26-organization ring has one stage bucket, `groupRing` refuses the
 * axis, and the ring the file exists to demonstrate draws wide. `assertShape()`
 * checks it.
 */
const STAGE_MIX = [
  // blank, Not started, Kickoff, Integrating, Testing/UAT, Go-live ready, Live, Paused
  [8, 2, 3, 7, 3, 1, 1, 1], // 26
  [6, 1, 2, 6, 3, 1, 2, 1], // 22
  [5, 1, 1, 3, 1, 1, 1, 1], // 14
  [3, 1, 1, 2, 1, 1, 1, 0], // 10
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
 * How many use-case links each organization carries. 32 of 72 (44%) carry NONE —
 * the em-dash state, which a full demo never renders — and the rest run 1..8
 * with a long tail.
 *
 * The three all-ten rows are handled separately (`FLAGSHIPS`): every capability
 * `live`, sitting on the `Live` rung, the other end of the same axis as the
 * empty ones.
 */
const LINK_COUNTS = [
  [0, 32],
  [1, 12],
  [2, 8],
  [3, 6],
  [4, 4],
  [5, 3],
  [6, 2],
  [7, 1],
  [8, 1],
]
const FLAGSHIPS = 3

/**
 * How a link's status is drawn, per rung. Ordered `planned, testing, live`.
 *
 * A stage and a use-case status are different facts, but they are not
 * independent: a site on `Not started` with six capabilities live teaches the
 * reader that the two columns have nothing to do with each other.
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
 * The count-form goals, on the tiers ABOVE the organizations — the only place a
 * count means anything ("thirty of the ones beneath me"). Three of them, and one
 * is deliberately in the past so an OVERDUE COUNT GOAL draws.
 *
 * Targets are checked against what is actually beneath each path by
 * `assertShape()`: a commitment of 30 under a directorate holding 24
 * organizations is a commitment that can never be met, which reads as a bug in
 * the app rather than as a number somebody chose.
 */
const COUNT_GOALS = [
  { path: ['Associate Directorate Alpha'], target: 30, day: 180 },
  { path: ['Associate Directorate Beta'], target: 12, day: 240 },
  { path: ['Associate Directorate Alpha', 'Account Book One'], target: 15, day: -20 },
]

/**
 * The date-only goals on organizations, as an EXPLICIT LIST OF OFFSETS rather
 * than a count and a range.
 *
 * make-demo-400 draws 34 dates out of `21 + int(344)` and every one of them is
 * in the future, so nothing in that file ever draws the overdue clock. Nine
 * goals is too few to leave that to a draw: four are stated as negative offsets
 * (before `AS_OF`, so they render as late) and five are ahead. `verify()`
 * measures both halves against `AS_OF` after the file is built rather than
 * trusting this comment.
 */
const GOAL_DAYS = [-62, -41, -27, -13, 24, 55, 96, 143, 210]

/**
 * ONE tier is left with no row of its own, so its node is IMPLIED by the
 * organizations beneath it.
 *
 * Listing every level and listing only the leaves must produce the same tree —
 * the file contract's own promise — and a file in which every ancestor is
 * spelled out never exercises the half of the planner that makes it true.
 * `Pharmacies` under `Account Book Three` has no row; the plan reports it as the
 * one implied create.
 */
const IMPLIED = { book: 'Account Book Three', type: 'Pharmacies' }

/**
 * The book whose first organization is forced BARE — no Arabic name, no manager,
 * no vendor, no description, no stage, no link.
 *
 * At four hundred rows a bare row happens by itself; at seventy-two it does not,
 * and the panel that has to draw an organization about which NOTHING is recorded
 * is the one most likely to be shipped broken. So it is constructed, and it is
 * constructed by SWAPPING values with another organization in the same book
 * (`makeBare()`) rather than by clearing them, so every count in `STAGE_MIX` and
 * `VENDOR_MIX` still holds afterwards. Book Three because it has no account
 * manager, which is the one field a swap cannot fix.
 */
const BARE_BOOK = 'Account Book Three'

/**
 * Ordinary Arabic nouns — dew, dawn, coral, amber. Words, not companies, and no
 * near-miss on a real provider or integrator.
 *
 * ⚠ DRAWN WITHOUT REPLACEMENT ACROSS THE WHOLE FILE, not per type as
 * make-demo-400 does it. That file needs 400 names out of 96 stems and can only
 * afford uniqueness within a type; this one needs 72 out of 96 and can afford it
 * globally — which matters because two of the four books are FLAT, so
 * organizations of different types are siblings there and
 * `map_nodes_sibling_name_uidx` (and its Arabic twin) would kill the apply
 * mid-depth on a collision a per-type queue would happily produce.
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
 * only property that matters here — the same sequence on every machine and every
 * Node version, because `Math.random()` is explicitly allowed to differ between
 * engines and even between runs of one engine.
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
 * `BASE_DATE` plus n days (n may be negative), as `YYYY-MM-DD`.
 *
 * UTC ARITHMETIC, NOT LOCAL. `new Date('2026-09-01')` is parsed as UTC midnight
 * and `.getDate()` reads it back in the machine's zone — west of Greenwich that
 * is the 31st of August, so the same script would write different dates on two
 * laptops and the "byte-identical" promise would be a lie that only shows up on
 * somebody else's machine.
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
 * identically either way — but the stage names are the one column whose values a
 * person copies out of a migration and pastes into Excel, and a bare slash in a
 * CSV cell is the kind of thing an import wizard offers to "split" on. Quoting
 * costs two bytes and removes the question.
 */
function field(value) {
  const text = String(value ?? '')
  if (!/[",\r\n/]/u.test(text)) return text
  return `"${text.replace(/"/gu, '""')}"`
}

const csvRow = (cells) => cells.map(field).join(',')

// ── descriptions ────────────────────────────────────────────────────────────
//
// ⚠ THESE DESCRIBE ORGANIZATIONS, NOT THIS DATASET. The demo file that preceded
// make-demo-400 failed a review on exactly this: rows that explained the demo to
// the reader, in the field that renders as a hospital's description in the
// panel. Length, wrapping and the Arabic/English pairing cannot be judged
// against copy nobody would write, and a screenshot that leaves the room then
// shows the build's own reasoning back at itself. So: bed counts, room counts,
// what is in production and what is waiting on whom. Nothing about the map.

const SIZE_PHRASE = {
  hospitals: (n) => `${n}-bed`,
  clinics: (n) => `${n}-room`,
  labs: (n) => `${n}-bench`,
  polyclinics: (n) => `${n}-room`,
  imaging: (n) => `${n}-modality`,
  pharmacies: (n) => `${n}-counter`,
}
/**
 * ⚠ NO LOW END BELOW THREE, AND THAT IS AN ARABIC CONSTRAINT RATHER THAN A
 * CLINICAL ONE. One and two are not counted with a numeral and a noun in Arabic
 * at all — they are a word FORM (`غرفة` / `غرفتان`), so `بـ 2 أجهزة تصوير` is
 * broken however the plural is spelled, and no `SIZE_PHRASE_AR` band can repair
 * it. Three is the first number that takes an ordinary tamyiz. `assertShape()`
 * refuses the file if a floor ever drops below it.
 */
const SIZE_RANGE = {
  hospitals: [40, 720],
  clinics: [3, 18],
  labs: [4, 30],
  polyclinics: [6, 40],
  imaging: [3, 9],
  pharmacies: [3, 12],
}
/**
 * ⚠ N-AWARE, BECAUSE THE ARABIC COUNTED NOUN IS. This table shipped as five
 * fixed plurals and rendered `بـ 11 غرف`, `بـ 24 منصات فحص`, `بـ 34 غرف` — text
 * an Arabic-first reader reads as broken on first glance, in the one column
 * whose whole purpose is to prove the Arabic/English pairing is real copy. The
 * rule the plurals were ignoring:
 *
 *   · 3–10  → plural, genitive (`تمييز` as a plural مضاف إليه): `بـ 7 غرفٍ`.
 *   · 11–99 → SINGULAR, accusative: `بـ 34 غرفةً`, never `بـ 34 غرف`.
 *   · 100, 200, … → singular again, but GENITIVE: `بسعة 300 سريرٍ`, while
 *     `250` is governed by its `خمسون` and stays accusative (`سريراً`).
 *
 * `hospitals` is the entry that was already right, and it is right for the
 * narrow reason that its range starts at 40 — it never enters the 3–10 band at
 * all, so a single accusative form covered every number it could draw until the
 * hundreds rule above was added. The other five draw across the boundary, which
 * is why they need the branch. `verify()` refuses the file if a plural ever
 * lands beside a number past ten.
 */
const SIZE_PHRASE_AR = {
  hospitals: (n) => `بسعة ${n} ${n % 100 === 0 ? 'سريرٍ' : 'سريراً'}`,
  clinics: (n) => (n <= 10 ? `بـ ${n} غرفٍ` : `بـ ${n} غرفةً`),
  labs: (n) => (n <= 10 ? `بـ ${n} منصاتِ فحصٍ` : `بـ ${n} منصةَ فحصٍ`),
  polyclinics: (n) => (n <= 10 ? `بـ ${n} غرفٍ` : `بـ ${n} غرفةً`),
  imaging: (n) => (n <= 10 ? `بـ ${n} أجهزةِ تصويرٍ` : `بـ ${n} جهازَ تصويرٍ`),
  pharmacies: (n) => (n <= 10 ? `بـ ${n} نوافذِ صرفٍ` : `بـ ${n} نافذةَ صرفٍ`),
}
/**
 * The plural forms above, as the regression fence `verify()` swings at the
 * finished rows: any of these standing after a number of eleven or more is the
 * bug this table was rewritten to remove.
 *
 * ⚠ THE TRAILING LOOKAHEAD IS LOAD-BEARING. Arabic script has no word boundary
 * `\b` can find, and `غرف` is a PREFIX of the correct singular `غرفةً` — without
 * the lookahead this pattern condemns the very form it exists to require. The
 * class is the Arabic letters; the harakat that end a vowelled plural (`غرفٍ`,
 * `منصاتِ`) sit outside it, so a plural still matches and a singular does not.
 */
const AR_PLURAL_NOUNS = /بـ (?:1[1-9]|[2-9]\d) (?:غرف|منصات|أجهزة|نوافذ)(?![ء-ي])/u

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

/**
 * The same five sentences in Arabic, AND THEY ARE NOT DECORATION.
 *
 * The English half of this pair was the only half that ever grew: the longest
 * English description in the committed file ran past 300 characters and the
 * longest Arabic one stopped at 90 — one line in the branch panel at every
 * breakpoint. So the harder and more failure-prone half of the pairing, RTL
 * WRAPPING, was the one case the file could not put on screen, in a file whose
 * header names wrapping and the Arabic/English pairing as the properties these
 * descriptions exist to make judgeable. They are appended to `descriptionAr` on
 * the same rows the English extras are appended to, and `verify()` measures the
 * result against the same 200-character bar.
 */
const EXTRA_LINE_AR = [
  'طلب الفريق السريري جولة تدريب ثانية قبل تشغيل الخدمة التالية، وحُجزت لها نافذة في الشهر المقبل.',
  'يُتوقع أن يتبع موقع ثانٍ تابع للمشغّل نفسه بناءَ الواجهات ذاته دون تغيير في النطاق المتفق عليه.',
  'خصّص المورد مهندساً واحداً لهذا العمل، وهو ما يحدد وتيرة التنفيذ هنا أكثر من أي عامل آخر.',
  'الأحجام موسمية، ونافذة الإطلاق مختارة بحيث تتجنب ذروة الموسم في هذه المنشأة تحديداً.',
  'اثنتان من الواجهات مشتركة مع المختبر المرجعي وتتحركان معاً في كل إصدار.',
]

/**
 * A long description takes TWO extra lines, not one.
 *
 * make-demo-400 adds a single sentence to a tenth of four hundred rows and can
 * be confident the longest lands past 200 characters somewhere. Forty-odd
 * described rows cannot be confident of that, and the wrapping case is exactly
 * the one worth having in a file this small — so the long form is BUILT to clear
 * the bar instead of being drawn and hoped for. `verify()` measures it.
 */
const LONG_EXTRAS = 2

// ── build ───────────────────────────────────────────────────────────────────

function assertShape() {
  const total = BOOKS.reduce((sum, b) => sum + b.size, 0)

  for (let b = 0; b < BOOKS.length; b += 1) {
    const book = BOOKS[b]
    const typeSum = TYPE_COUNTS[b].reduce((a, c) => a + c, 0)
    if (typeSum !== book.size) {
      throw new Error(`TYPE_COUNTS[${b}] sums to ${typeSum}, and ${book.name} holds ${book.size}.`)
    }
    const vendorSum = VENDOR_MIX[b].reduce((a, c) => a + c, 0)
    if (vendorSum !== book.size) {
      throw new Error(`VENDOR_MIX[${b}] sums to ${vendorSum}, and ${book.name} holds ${book.size}.`)
    }
    const stageSum = STAGE_MIX[b].reduce((a, c) => a + c, 0)
    if (stageSum !== book.size) {
      throw new Error(`STAGE_MIX[${b}] sums to ${stageSum}, and ${book.name} holds ${book.size}.`)
    }
  }

  // The whole reason this file is 72 and not 40: at least one ring must cross
  // the canvas's cap, and a ring is a FLAT book's whole population.
  const widest = Math.max(...BOOKS.filter((b) => !b.tiered).map((b) => b.size), 0)
  if (widest <= RING_CAP) {
    throw new Error(
      `the widest flat book holds ${widest} organizations and RING_CAP is ${RING_CAP}: no ring in this file would cohort, which is the one thing the slice exists to show. Grow a flat book past ${RING_CAP} or drop a book's type tier.`,
    )
  }

  // ...and that ring must have something to cut ON. Manager is one bucket there
  // by construction (`amAlways`) and `type` is the node kind (all Organization),
  // so stage and vendor are the only axes left; each needs ≥2 buckets and fewer
  // buckets than organizations.
  for (let b = 0; b < BOOKS.length; b += 1) {
    if (BOOKS[b].tiered || BOOKS[b].size <= RING_CAP) continue
    const stages = STAGE_MIX[b].filter((n) => n > 0).length
    const vendors = VENDOR_MIX[b].filter((n) => n > 0).length
    if (stages < 2 && vendors < 2) {
      throw new Error(
        `${BOOKS[b].name} is the ring that has to cohort and it holds ${stages} stage value(s) and ${vendors} vendor value(s). groupRing needs an axis with at least two buckets.`,
      )
    }
  }

  const links = LINK_COUNTS.reduce((a, [, c]) => a + c, 0) + FLAGSHIPS
  if (links !== total) {
    throw new Error(`LINK_COUNTS + FLAGSHIPS is ${links}, and the file holds ${total} organizations.`)
  }
  const liveRung = STAGE_MIX.reduce((a, row) => a + row[6], 0)
  if (FLAGSHIPS > liveRung) {
    throw new Error(`${FLAGSHIPS} flagships need ${FLAGSHIPS} Live rows and STAGE_MIX gives ${liveRung}.`)
  }

  // A count goal larger than the population beneath it is a commitment that can
  // never be met, and it reads as a bug in the app rather than as a number.
  for (const goal of COUNT_GOALS) {
    const beneath = BOOKS.filter((book) => {
      const ad = DIRECTORATES[book.ad].name
      return goal.path.length === 1 ? goal.path[0] === ad : goal.path[1] === book.name
    }).reduce((sum, book) => sum + book.size, 0)
    if (goal.target > beneath || goal.target <= 0) {
      throw new Error(
        `the count goal on ${goal.path.join(' > ')} asks for ${goal.target} and there are ${beneath} organizations beneath it.`,
      )
    }
  }

  // One and two are a word form in Arabic, not a numeral and a noun, so no
  // `SIZE_PHRASE_AR` band can render them — see SIZE_RANGE.
  for (const [key, [lo]] of Object.entries(SIZE_RANGE)) {
    if (lo < 3) {
      throw new Error(
        `SIZE_RANGE.${key} starts at ${lo}, and Arabic counts one and two as a word form rather than as a number beside a noun: \`بـ 2 أجهزة تصوير\` is broken however the plural is spelled. Start at 3.`,
      )
    }
  }

  const needed = total
  if (needed > STEMS.length) {
    throw new Error(`${needed} organizations need ${needed} stems and STEMS holds ${STEMS.length}.`)
  }
  if (BOOKS.every((b) => b.name !== BARE_BOOK)) {
    throw new Error(`BARE_BOOK names ${BARE_BOOK}, which is not one of the books.`)
  }
  // The implied tier has to be a tier that EXISTS in the data and simply gets no
  // row of its own. Naming an empty one leaves the plan reporting zero implied
  // creates, and the "listing leaves == listing every level" half of the planner
  // then goes unexercised by this file without anything saying so.
  const impliedBook = BOOKS.findIndex((b) => b.name === IMPLIED.book)
  const impliedType = TYPES.findIndex((t) => t.name === IMPLIED.type)
  if (impliedBook < 0 || impliedType < 0 || !BOOKS[impliedBook].tiered || TYPE_COUNTS[impliedBook][impliedType] === 0) {
    throw new Error(
      `IMPLIED names ${IMPLIED.book} > ${IMPLIED.type}, and that tier is either unknown, not tiered, or holds no organizations — so nothing beneath it would imply it.`,
    )
  }
}

/**
 * Force one organization to be completely bare, WITHOUT moving any count.
 *
 * A swap rather than a clear: the target trades its stage with the first
 * organization in the same book already holding a blank stage, and its vendor
 * with the first holding a blank vendor. Both pools were dealt per book, so a
 * swap inside the book leaves `STAGE_MIX` and `VENDOR_MIX` exactly as stated —
 * which is what lets the summary keep printing the tables as facts. If the
 * target already holds the blank, the swap is with itself and nothing moves.
 */
function makeBare(orgs) {
  const inBook = orgs.filter((o) => o.bookName === BARE_BOOK)
  const target = inBook[0]
  const blankStage = inBook.find((o) => o.stage === '')
  const blankVendor = inBook.find((o) => o.vendor === '')
  if (!target || !blankStage || !blankVendor) {
    throw new Error(
      `${BARE_BOOK} cannot supply a bare organization: it needs at least one blank stage and one blank vendor in its own mix.`,
    )
  }
  const stage = target.stage
  target.stage = blankStage.stage
  blankStage.stage = stage
  const vendor = target.vendor
  target.vendor = blankVendor.vendor
  blankVendor.vendor = vendor

  target.hasArabic = false
  target.describe = false
  target.long = false
  target.bare = true
  return target
}

function build() {
  assertShape()

  // The header, verbatim from the empty template. Everything to the right of the
  // tenth column is a use case, whatever 0024 called it.
  const template = readFileSync(TEMPLATE, 'utf8').replace(/^﻿/u, '')
  const header = template.split(/\r?\n/u)[0]
  const columns = header.split(',')
  const useCases = columns.slice(10)
  if (columns.length <= 10 || useCases.some((c) => c === '')) {
    throw new Error(`docs/templates/structure.csv has no use-case columns to copy: ${header}`)
  }

  // One stem queue for the whole file, drawn without replacement — see STEMS.
  const stemQueue = shuffled(STEMS)
  let stemCursor = 0

  // Per-book pools. Shuffled here, consumed in path order below, so WHICH
  // organization gets which vendor is stable and HOW MANY each vendor gets is
  // exact.
  const vendorPool = VENDOR_MIX.map((mix) =>
    pool([...VENDORS.map((v, i) => [v, mix[i]]), ['', mix[6]]]),
  )
  const stagePool = STAGE_MIX.map((mix) => pool(STAGE_ORDER.map((s, i) => [s, mix[i]])))

  // ── the rows, in tree order ──
  //
  // ⚠ ORGANIZATION ROWS ARE PLACED HERE AND FILLED IN LATER. `sort_order` comes
  // out of FILE ORDER, so the sequence in this file is the sequence the map
  // draws — an appendix of seventy-two organizations after all eleven tier rows
  // would be correct, unreadable, and would file every book's contents somewhere
  // other than under the book. But the flagships cannot be chosen until every
  // stage has been dealt (they are drawn from the rows already on the terminal
  // rung), so the organization rows are RESERVED in place during the walk and
  // rendered after.
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
    nameAr: 'الشريحة التجريبية',
    kind: 'Programme',
    am: AM_AZIZ,
    description:
      'DEMO DATA — a small slice, sized to be deleted. Every organization, vendor and person below this node is invented. Delete this one branch to reset the workspace before the real structure is imported.',
    descriptionAr:
      'بيانات تجريبية — شريحة صغيرة يسهل حذفها. جميع المنشآت والموردين والأشخاص أدناه غير حقيقيين، ويُحذف هذا الفرع بالكامل قبل استيراد الهيكل الفعلي.',
  })

  const goalByPath = new Map(COUNT_GOALS.map((g) => [g.path.join(' > '), g]))

  for (let d = 0; d < DIRECTORATES.length; d += 1) {
    const ad = DIRECTORATES[d]
    const adGoal = goalByPath.get(ad.name)
    const adSize = BOOKS.filter((b) => b.ad === d).reduce((sum, b) => sum + b.size, 0)
    emit([ROOT, ad.name], {
      nameAr: ad.ar,
      kind: 'Programme',
      description:
        d === 0
          ? `The larger of the two directorates: two account books and ${adSize} organizations, most of them in build.`
          : `The second directorate: two account books and ${adSize} organizations, opened this year.`,
      descriptionAr:
        d === 0
          ? `الأكبر بين الإدارتين: محفظتا حسابات و${adSize} منشأة، معظمها قيد البناء.`
          : `الإدارة الثانية: محفظتا حسابات و${adSize} منشأة، فُتحتا هذا العام.`,
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

      for (let t = 0; t < TYPES.length; t += 1) {
        const type = TYPES[t]
        const count = TYPE_COUNTS[b][t]
        if (count === 0) continue

        // A flat book files its organizations directly under itself; that is
        // what makes its ring the whole book.
        const segments = book.tiered
          ? [ROOT, ad.name, book.name, type.name]
          : [ROOT, ad.name, book.name]

        const impliedHere = IMPLIED.book === book.name && IMPLIED.type === type.name
        if (book.tiered && !impliedHere) {
          emit(segments, {
            nameAr: type.ar,
            description: `${count} ${type.name.toLowerCase()} in ${book.name.toLowerCase()}.`,
          })
        }

        for (let n = 0; n < count; n += 1) {
          const stem = stemQueue[stemCursor]
          stemCursor += 1
          if (!stem) {
            throw new Error(
              `ran out of stems: ${STEMS.length} available, ${stemCursor} needed. Widen STEMS or shrink a book.`,
            )
          }
          const [variantEn, variantAr] = pick(type.variants)
          const vendor = vendorPool[b].pop()
          const stage = stagePool[b].pop()
          const [catchmentEn, catchmentAr] = pick(CATCHMENTS)
          const [lo, hi] = SIZE_RANGE[type.key]
          const size = lo + int(hi - lo + 1)
          orgs.push({
            book: b,
            bookName: book.name,
            adName: ad.name,
            type,
            name: `${stem[0]} ${variantEn}`,
            nameAr: variantAr(stem[1]),
            hasArabic: chance(0.6),
            am: book.am,
            amHere: book.am ? (book.amAlways || chance(0.85)) : false,
            vendor,
            stage,
            size,
            catchmentEn,
            catchmentAr,
            segments,
            describe: chance(0.58),
            long: chance(0.2),
            bare: false,
            links: {},
          })
          sequence.push({ org: orgs[orgs.length - 1] })
        }
      }
    }
  }

  // ── the one bare organization, before anything reads a stage ──
  const bare = makeBare(orgs)

  // ── the flagships, then everybody else's link counts ──
  //
  // Chosen from the rows already on the terminal rung rather than promoted onto
  // it, so the stage table the summary prints is the one STAGE_MIX states.
  const liveOrgs = orgs.filter((o) => o.stage === STAGE.live)
  const flagships = new Set(
    shuffled(liveOrgs.map((_, i) => i)).slice(0, FLAGSHIPS).map((i) => liveOrgs[i]),
  )
  if (flagships.has(bare)) {
    throw new Error('the bare organization was picked as a flagship, which it cannot be — it holds no stage.')
  }
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
  // The bare row trades its link count with the first organization already
  // holding none — a swap again, so the LINK_COUNTS table still holds.
  if (bare.linkCount !== 0) {
    const donor = orgs.find((o) => o !== bare && !flagships.has(o) && o.linkCount === 0)
    if (!donor) throw new Error('no organization holds zero links, so the bare row cannot trade for one.')
    donor.linkCount = bare.linkCount
    bare.linkCount = 0
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
  // On organizations that are actually moving: a commitment on a site nobody has
  // started is a commitment nobody made. Drawn from the rows past Kickoff, and
  // zipped against `GOAL_DAYS` so the ahead/overdue split is stated rather than
  // sampled.
  const movers = orgs.filter((o) =>
    [STAGE.integrating, STAGE.testing, STAGE.ready].includes(o.stage),
  )
  if (movers.length < GOAL_DAYS.length) {
    throw new Error(
      `${GOAL_DAYS.length} date goals need ${GOAL_DAYS.length} organizations past Kickoff and STAGE_MIX gives ${movers.length}.`,
    )
  }
  const goalDays = shuffled(GOAL_DAYS)
  shuffled(movers)
    .slice(0, GOAL_DAYS.length)
    .forEach((org, i) => {
      org.targetDate = dayOffset(goalDays[i])
    })

  // ── the copy, written last so it can read the stage the row ended up on ──
  for (const org of orgs) {
    org.description = ''
    org.descriptionAr = ''
    if (!org.describe) continue
    const sizePhrase = SIZE_PHRASE[org.type.key](org.size)
    const noun = org.name.split(' ').slice(1).join(' ').toLowerCase()
    const line = pick(STAGE_LINE[org.stage])
    const head = `${sizePhrase} ${noun} serving ${org.catchmentEn}.`
    org.description = org.long
      ? `${head} ${line} ${shuffled(EXTRA_LINE).slice(0, LONG_EXTRAS).join(' ')}`
      : `${head} ${line}`
    if (org.hasArabic) {
      const headAr = `منشأة ${SIZE_PHRASE_AR[org.type.key](org.size)} تخدم ${org.catchmentAr}.`
      const lineAr = pick(STAGE_LINE_AR[org.stage])
      // The long form grows in BOTH languages or the wrapping case is only
      // half on screen — see EXTRA_LINE_AR.
      org.descriptionAr = org.long
        ? `${headAr} ${lineAr} ${shuffled(EXTRA_LINE_AR).slice(0, LONG_EXTRAS).join(' ')}`
        : `${headAr} ${lineAr}`
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

  return { header, rows, orgs, useCases, flagships, bare }
}

// ── verify ──────────────────────────────────────────────────────────────────

/**
 * Every claim the header makes, MEASURED off the rows that were actually built.
 *
 * `assertShape()` checks the tables agree with each other before a row exists;
 * this checks the rows agree with the tables afterwards, and it is the half that
 * catches a shuffle or a swap having eaten something. Each failure names the
 * surface that stops working rather than the assertion that failed, because the
 * person reading it is trying to fix a demo, not this script.
 */
function verify({ rows, orgs, flagships, bare }) {
  const fail = (message) => {
    throw new Error(`make-demo-slice: ${message}`)
  }

  for (const rung of STAGE_ORDER.slice(1)) {
    if (!orgs.some((o) => o.stage === rung)) {
      fail(`no organization sits on \`${rung}\`, so the Portfolio ladder draws six rungs and an empty one.`)
    }
  }

  const blank = orgs.filter((o) => o.stage === '').length
  const share = blank / orgs.length
  if (share < 0.2 || share > 0.4) {
    fail(
      `${blank} of ${orgs.length} organizations (${Math.round(share * 100)}%) hold no stage; the "nobody has said" bucket is meant to be 20–40% and it is the state the lenses have to tell apart from \`Not started\`.`,
    )
  }

  const byRung = STAGE_ORDER.slice(1)
    .map((s) => [s, orgs.filter((o) => o.stage === s).length])
    .sort((a, b) => b[1] - a[1])
  if (byRung[0][1] <= byRung[1][1] * 1.5) {
    fail(
      `the biggest rung (${byRung[0][0]}, ${byRung[0][1]}) is not half again the next (${byRung[1][0]}, ${byRung[1][1]}), so there is no bottleneck to point at and the "one fix unblocks N" column reads flat.`,
    )
  }

  const widestRing = Math.max(
    ...BOOKS.filter((b) => !b.tiered).map((b) => orgs.filter((o) => o.bookName === b.name).length),
  )
  if (widestRing <= RING_CAP) {
    fail(`the widest entity ring holds ${widestRing} organizations and RING_CAP is ${RING_CAP}: nothing in this file cohorts on a desktop.`)
  }
  const ringBook = BOOKS.find((b) => !b.tiered && b.size > RING_CAP)
  const ringOrgs = orgs.filter((o) => o.bookName === ringBook.name)
  if (ringOrgs.some((o) => !o.amHere)) {
    fail(
      `${ringOrgs.filter((o) => !o.amHere).length} organizations in ${ringBook.name} carry no account manager, so its ring cohorts by manager into "Aziz / Unassigned" and never shows the stage ladder.`,
    )
  }
  const ringStages = new Set(ringOrgs.map((o) => o.stage))
  if (ringStages.size < 2 || ringStages.size >= ringOrgs.length) {
    fail(`${ringBook.name}'s ring holds ${ringStages.size} distinct stage values against ${ringOrgs.length} organizations; groupRing needs at least two buckets and fewer buckets than entities.`)
  }

  if (!bare.bare || bare.stage !== '' || bare.vendor !== '' || bare.amHere || bare.hasArabic || bare.description !== '' || bare.linkCount !== 0) {
    fail('the bare organization is not bare, so nothing in the file exercises the panel for a row about which nothing is recorded.')
  }

  const managers = new Set(orgs.filter((o) => o.amHere).map((o) => o.am))
  const unassigned = orgs.filter((o) => !o.amHere).length
  if (managers.size < 2 || unassigned === 0) {
    fail(`Team needs at least two managers and a non-empty Unassigned bucket; this file has ${managers.size} and ${unassigned}.`)
  }

  const vendorCounts = [...VENDORS.map((v) => [v, orgs.filter((o) => o.vendor === v).length])]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  const noVendor = orgs.filter((o) => !o.vendor).length
  if (vendorCounts.length < 4) fail(`only ${vendorCounts.length} vendors appear; the Vendors grouping needs several to be worth drawing.`)
  if (vendorCounts[0][1] <= vendorCounts[1][1] * 1.3) {
    fail(`the largest vendor cohort (${vendorCounts[0][1]}) is not half again the second (${vendorCounts[1][1]}), so the vendor lens has no story.`)
  }
  const vendorBlankShare = noVendor / orgs.length
  if (vendorBlankShare < 0.05 || vendorBlankShare > 0.2) {
    fail(`${noVendor} organizations (${Math.round(vendorBlankShare * 100)}%) record no vendor; *not recorded* should be 5–20% because it is the state most real rows are in.`)
  }

  const arabic = orgs.filter((o) => o.hasArabic).length / orgs.length
  if (arabic < 0.5 || arabic > 0.8) {
    fail(`${Math.round(arabic * 100)}% of organizations carry an Arabic name; RTL wants 50–80% so the mixed case is the one on screen.`)
  }

  const descriptions = orgs.map((o) => o.description.length)
  if (Math.max(...descriptions) <= 200) {
    fail(`the longest description is ${Math.max(...descriptions)} characters; wrapping is not judgeable under 200.`)
  }
  if (Math.min(...descriptions) !== 0) fail('every organization carries a description, so the empty case never draws.')

  // THE SAME BAR ON THE ARABIC, which is the half that was missing while the
  // gate above read `o.description` and nothing read `o.descriptionAr` at all:
  // every Arabic description in the committed file was one line at every
  // breakpoint, so RTL line-breaking — the harder half — was the one case the
  // file could not put on screen.
  const arDescriptions = orgs.filter((o) => o.descriptionAr !== '').map((o) => o.descriptionAr.length)
  if (arDescriptions.length === 0) fail('no organization carries an Arabic description, so the pairing never draws.')
  const arWrapping = arDescriptions.filter((n) => n > 200).length
  if (arWrapping < 2) {
    fail(
      `${arWrapping} Arabic description(s) run past 200 characters (longest ${Math.max(...arDescriptions)}); RTL wrapping is not judgeable under 200 and it is the half of the pairing most likely to be shipped broken.`,
    )
  }

  // ARABIC NUMBER AGREEMENT, MEASURED RATHER THAN TRUSTED — see SIZE_PHRASE_AR.
  // Eleven and up take a SINGULAR accusative tamyiz; a plural there is text an
  // Arabic-first reader reads as broken, in the column that exists to prove the
  // Arabic copy is real.
  const broken = orgs.filter((o) => AR_PLURAL_NOUNS.test(o.descriptionAr))
  if (broken.length > 0) {
    fail(
      `${broken.length} Arabic description(s) put a plural after a number of eleven or more — e.g. \`${broken[0].descriptionAr.slice(0, 40)}…\`. Arabic wants the singular accusative there (\`بـ 34 غرفةً\`), and SIZE_PHRASE_AR has the band for it.`,
    )
  }

  const links = orgs.flatMap((o) => Object.entries(o.links))
  for (const status of ['planned', 'testing', 'live']) {
    if (!links.some(([, s]) => s === status)) fail(`no use-case link is \`${status}\`, so one third of the panel never draws.`)
  }
  const none = orgs.filter((o) => o.linkCount === 0).length / orgs.length
  if (none < 0.35 || none > 0.55) {
    fail(`${Math.round(none * 100)}% of organizations carry no use-case link; 35–55% keeps both ends of the panel on screen.`)
  }
  if (orgs.filter((o) => o.linkCount === 1).length < 8) fail('fewer than eight organizations carry exactly one link, and the single-chip row is the commonest real shape.')
  if (flagships.size < 2) fail('fewer than two organizations carry the whole catalogue live, so the finished end of the axis never draws.')

  // Goals, against AS_OF rather than against the clock.
  const goalDates = rows.map((r) => r[8]).filter((d) => d !== '')
  const overdue = goalDates.filter((d) => d < AS_OF).length
  const ahead = goalDates.filter((d) => d >= AS_OF).length
  if (overdue < 3) fail(`${overdue} goals fall before ${AS_OF}; the overdue clock in the goal panel needs at least three to be worth showing.`)
  if (ahead < 3) fail(`${ahead} goals fall on or after ${AS_OF}; a file whose every goal is late reads as abandoned rather than as a portfolio.`)
  const counts = rows.filter((r) => r[9] !== '').length
  if (counts >= goalDates.length - counts) fail(`${counts} count goals against ${goalDates.length - counts} date goals; counts belong on the tiers above and should be the rarer form.`)
  for (const row of rows) {
    if (row[9] !== '' && row[8] === '') fail('a `target` was written without a `target_date`, which 0027 has no row shape for.')
  }

  return {
    blank,
    byRung,
    widestRing,
    vendorCounts,
    noVendor,
    links,
    overdue,
    ahead,
    counts,
    descriptions,
    arDescriptions,
  }
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

/**
 * The finished bytes, WITHOUT WRITING THEM — the one place the BOM, the CRLF
 * and the trailing newline are decided.
 *
 * ⚠ BOM, ALWAYS. Without it Excel guesses the local ANSI codepage and every
 * Arabic name in this file opens as mojibake — which is then what gets saved
 * back and re-imported. CRLF for the same reason: this is a file somebody opens
 * in Excel on Windows.
 *
 * It is a function of its own, and exported, so `structurePlan.test.mjs` can
 * assert that re-rendering equals the committed file BYTE FOR BYTE. That is the
 * assertion behind line 3's promise: `verify()` measures counts, and every count
 * in here stays inside its band under a reshuffle, so a stray `Math.random()`,
 * a moved `chance()` or a `pick()` inserted before the stem draw would churn all
 * 83 rows while every gate stayed green. Comparing bytes is what notices.
 */
function render({ header, rows }) {
  return `﻿${[header, ...rows.map(csvRow)].join('\r\n')}\r\n`
}

function main() {
  const built = build()
  const { rows, orgs, useCases, flagships } = built
  const measured = verify(built)

  const text = render(built)
  writeFileSync(OUTPUT, text)

  const total = orgs.length
  const goalRows = rows.filter((r) => r[8] !== '')

  const out = []
  out.push(`docs/templates/structure.slice.csv — ${rows.length} rows, ${text.length} chars`)
  out.push(`  header copied from docs/templates/structure.csv · ${useCases.length} use-case columns`)
  out.push(`  seed 0x${SEED.toString(16)} · base date ${BASE_DATE} · as of ${AS_OF} · re-running writes the same bytes`)
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
    '    ⚠ one of the four books is BLANK in the account_manager column, and that is the point',
    '      rather than an omission: Aziz and Nasser Alabri are the only two provisioned accounts',
    '      in this workspace, so they are the only two names an import can resolve. A third name',
    '      would be an invented person and every row carrying it would be refused as',
    '      `member_unknown` rather than left unassigned.',
    '',
  )

  out.push(table('type', [...tally(orgs, (o) => o.type.name)], total), '')
  out.push(
    table(
      'book',
      [
        ...BOOKS.map((b) => [
          `${DIRECTORATES[b.ad].name.replace('Associate Directorate ', 'AD ')} › ${b.name}${b.tiered ? '' : '  (flat — one ring)'}`,
          orgs.filter((o) => o.bookName === b.name).length,
        ]),
      ],
      total,
    ),
    `    widest entity ring ${measured.widestRing} against RING_CAP ${RING_CAP} — it cohorts on a desktop, by stage`,
    '',
  )
  out.push(
    table(
      'vendor',
      [...measured.vendorCounts, ['(none recorded)', measured.noVendor]],
      total,
    ),
    '',
  )
  out.push(
    table(
      'stage',
      [
        ...STAGE_ORDER.slice(1).map((s) => [s, orgs.filter((o) => o.stage === s).length]),
        ['(nobody has said)', measured.blank],
      ],
      total,
    ),
    `    the pile-up is ${measured.byRung[0][0]} at ${measured.byRung[0][1]}, against ${measured.byRung[1][1]} on ${measured.byRung[1][0]}`,
    '    ⚠ the STALLED list is still empty on import day, and no CSV can change that:',
    '      `expected_days` is seeded null on every rung and `stage_changed_at` is written only by',
    '      0026\'s trigger, so every imported organization reads 0 days in stage. Give `Integrating`',
    '      an expected days in Settings › Catalogue and the pile above becomes the stalled pile as',
    '      the clock runs. Until then `?risk=1` shows the no-threshold banner, correctly.',
    '',
  )

  const linkBuckets = [
    ['0 (nothing recorded)', orgs.filter((o) => o.linkCount === 0).length],
    ['1', orgs.filter((o) => o.linkCount === 1).length],
    ['2–4', orgs.filter((o) => o.linkCount >= 2 && o.linkCount <= 4).length],
    ['5–8', orgs.filter((o) => o.linkCount >= 5 && o.linkCount <= 8).length],
    [`${useCases.length} (all, all live)`, flagships.size],
  ]
  out.push(table('use-case links per organization', linkBuckets, total))
  out.push(
    table(
      'use-case link status',
      [...tally(measured.links, ([, status]) => status)].sort((a, b) => a[0].localeCompare(b[0])),
      measured.links.length,
    ),
  )
  out.push(`    ${measured.links.length} links in total`, '')

  out.push(
    table('goals', [
      ['date only, on an organization', goalRows.length - measured.counts],
      ['count, on a directorate or book', measured.counts],
      [`overdue as of ${AS_OF}`, measured.overdue],
      ['ahead', measured.ahead],
    ]),
    `    dates run ${goalRows.map((r) => r[8]).sort()[0]} → ${goalRows.map((r) => r[8]).sort().at(-1)}, all offsets from ${BASE_DATE}`,
    '',
  )

  out.push(
    table('descriptions', [
      ['written', orgs.filter((o) => o.description !== '').length],
      ['blank', orgs.filter((o) => o.description === '').length],
      ['with Arabic beside them', orgs.filter((o) => o.descriptionAr !== '').length],
    ]),
    `    longest ${Math.max(...measured.descriptions)} characters, shortest ${Math.min(...measured.descriptions)}`,
    `    longest Arabic ${Math.max(...measured.arDescriptions)} characters, ${measured.arDescriptions.filter((n) => n > 200).length} past 200 — RTL wrapping is on screen too`,
    `    ${orgs.filter((o) => o.hasArabic).length} of ${total} organizations carry an Arabic name`,
    '',
  )

  out.push(
    `  one tier is left implied — ${IMPLIED.book} > ${IMPLIED.type} has no row of its own and is`,
    '  created from the paths beneath it, so the plan reports exactly 1 implied node.',
    `  every row hangs under ${TRACK} > ${ROOT}; deleting that one node undoes the whole slice.`,
    '  ⚠ 0026 AND 0027 MUST BE APPLIED FIRST. This file fills `stage`, `target_date` and',
    '    `target`, and the planner refuses the whole import by name (`stage_tables_missing`,',
    '    `goal_table_missing`) against a project where they have not been run.',
  )

  process.stdout.write(`${out.join('\n')}\n`)
}

/**
 * ⚠ RUN ONLY WHEN RUN, NOT WHEN IMPORTED. `main()` used to be called
 * unconditionally at the bottom of this file, which made the module unimportable
 * — a test could not reach `build()` without writing into `docs/templates/`, so
 * the determinism promise at the top of this file stayed a comment. The guard
 * compares this module's URL against the script Node was actually given.
 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()

export { build, verify, render, AS_OF, ROOT, TRACK, IMPLIED, STAGE }
