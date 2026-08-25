# NphiesCore — the requirement register

**Owner: Abdulaziz "Aziz" Alsaloom, PMO Lead. He alone approves this document.**

## What this is

This is the register of what the UHR onboarding programme has decided. Thirty-seven numbered
requirements, taken with the owner on 25 and 26 August 2026, each carrying the same eight parts:
its id, its title, the state it is actually in, the statement of what is required, the **measured
ground fact that made it necessary**, the house rule it is held to, the proof that will show it
has landed, and the files it touches.

It is a register rather than a proposal. Nothing here is a preference, an intention or a
best practice; every line is either a decision the owner took or a measurement somebody made.

## The rule of entry

**A numbered requirement without a measured ground fact does not belong in this document.** Not a
plausible one, not an estimate, not a majority-vote reading of a Jira column presented as a fact
nobody stated — a counted one, with its denominator beside it. The reason is in the register
itself: this programme's six departments and its 119 account managers were once read off a
spreadsheet by a script and printed as facts, and eight database tables were created three days
before nobody wrote to them, with no requirement anywhere explaining why they exist.

A requirement whose ground is "it would be good if" is a preference. It goes somewhere else.

## The four house rules

Every statement in this register is held to these. They are tested invariants, not preferences.

1. **Never a bare percentage.** `222 of 715`, never a naked share. A share hides its denominator
   and the denominator is the honest part.
2. **"Nobody has said" is never zero.** An unrecorded fact is not a zero measurement.
3. **No KPI from unconfigured inputs.** "0 at risk" is true arithmetic and a false sentence.
4. **An ordered ladder is drawn as position, never as hues.** Colour is never the only channel.

And one more that applies to every user-visible string the register describes: it goes through
`t()` with English and Arabic parity.

## The states

| State | Meaning |
|---|---|
| `built` | In the repository, with a test standing over it. |
| `agreed` | The owner decided it. Not yet built. |
| `gated` | Decided, and deliberately blocked behind a named precondition. |
| `deferred` | Decided to wait. The reason is in the requirement. |

Nothing moves from `agreed` to `built` without the owner's dated approval on this document.

## Approval

> Approved by: ______________________  Abdulaziz Alsaloom, PMO Lead
>
> Date: ______________________

---

# governance

### BRD-001 — Patient-data quarantine

- **State** — built
- **Statement** — Ticket descriptions, comments, attachments, environment and worklog are never
  fetched, quoted or re-derived: `jira-read` refuses those field names outright and refuses the
  `*all` / `*navigable` wildcards that would fetch them without naming them, and every measurement
  in the programme is taken from the safe projection. Cleaning the source field is separate, later
  work with its own owner. If a question can only be answered by reading Description, the answer is
  that the question is not answered yet.
- **Ground** — The scan of the 2,971-ticket export found raw HL7 v2 clinical payloads pasted into
  ticket Descriptions — 522 IPv4 addresses, 37 ten-digit national-ID/Iqama-shaped numbers, 22 MRN
  or patient-id mentions, 9 certificate or private-key blocks, 57 email addresses. The safe
  projection keeps 628 of 702 columns over the same 2,971 rows and was verified before use: HL7
  segment markers 8 to 0, key blocks 24 to 0, emails 197 to 1.
- **Honesty rule** — none beyond the standing four.
- **Proof** — A request naming `description` returns a refusal rather than a 200 carrying none of
  it; the test that names `description` as a literal reddens the moment the denylist entry is
  removed; and `jira-read/index.ts` still contains exactly two `fetch(` calls and one
  `Authorization:` header.
- **Files** — `supabase/functions/jira-read/index.ts`, `supabase/functions/jira-read/index.test.ts`, `docs/OPERATING-MODEL.md`

### BRD-023 — The CHI contact is a name and nothing else

- **State** — agreed
- **Statement** — `coc_contact` holds a person's name. No email, no phone, no title. A contact
  outside the organization is a higher bar than a colleague, not a lower one; contact details stay
  in whatever system the PMO already keeps them in.
- **Ground** — This workspace holds no staff emails by design and forbids attachments outright, and
  its privacy page is written from what the schema actually contains. The safe projection had to
  reduce 197 email addresses to 1 before anything could be measured at all.
- **Honesty rule** — none beyond the standing four.
- **Proof** — The migration adds one text column and no contact-detail column; `src/pages/Privacy.tsx`
  and both locale bundles gain exactly one line — a name — in the same commit.
- **Files** — `src/pages/Privacy.tsx`

### BRD-034 — The weekly report carries its denominators

- **State** — agreed
- **Statement** — The compliance report runs fourteen rules, resolves each to a person (the
  Assignee, then the organization's Account Manager, then the PMO Lead — and a rule that resolves to
  nobody is a finding in its own right), prints every sentence against its denominator and never as
  a bare percentage, and goes out in Arabic and English at Sunday 07:00 Asia/Riyadh.
- **Ground** — Its first run reads 497 of 1,551 pairs with a live record, 179 with only a closed one
  and roughly 1,100 never written; 531 of 552 open onboarding tickets name no rung, 552 of 552 carry
  no due date, 550 of 552 have no checklist and 435 of 552 are held by four people.
- **Honesty rule** — Never a bare percentage.
- **Proof** — Every line of the sent digest reads `N of M`, each dashboard gadget is titled with its
  denominator, and a rule resolving to nobody appears as R5 rather than disappearing.
- **Files** — none yet; not built.

---

# data-model

### BRD-002 — One record per pair

- **State** — agreed
- **Statement** — The onboarding record is one Jira ticket per (organization × use case), opened at
  initiation and kept open until go-live. The pair lives in two dropdown fields and the title is
  generated from them — `Onboarding | Organization | Use case` — so the title is decorative, the
  thirteen conventions retire, and a second ticket is never opened for a pair that already has one.
- **Ground** — 744 distinct pairs are readable from only 922 of 2,971 tickets, across thirteen title
  conventions of which the largest, `Onboarding | Org | Use case`, already covers 391 tickets with
  344 still open. 149 of the 744 pairs already carry more than one ticket (327 tickets, 178 to be
  absorbed) and 37 summary strings are exact duplicates covering 77 tickets.
- **Honesty rule** — none beyond the standing four.
- **Proof** — Saved query 11 (Components × Nphies Use Case, statusCategory != Done) returns no two
  adjacent rows sharing both values, and the duplicate-pair rule has linked and flagged every
  attempt: R3 prints 0 of 1,551 where it prints 26 of 744 today.
- **Files** — none yet; not built.

### BRD-008 — Eleven use cases, and the list is the universe

- **State** — agreed
- **Statement** — The use-case option list is eleven — ADT, Medication Prescribe V1, Medication
  Prescribe V2, Medication Dispense V1, Medication Dispense V2, Rad Report, Rad Order, Lab Result,
  Lab Order, Clinical Notes, Vital Signs — carried by the existing `Nphies Use Case` single-select
  with bilingual option labels, scoped to NONP and the Onboarding type. The option list is the
  target universe; Immunization, Genomics, Consent and NVR stay operational.
- **Ground** — `Nphies Use Case` already exists and is filled on 0 of 2,971 rows. Vital Signs was
  already live in the data on 36 tickets and 4 distinct pairs, and without an option value those
  tickets could not be filed as onboarding records at all. The product's own catalogue seeds ten
  rows with `name_ar` empty on all ten.
- **Honesty rule** — Every user-visible string goes through `t()` with en/ar parity.
- **Proof** — Eleven rows in `public.use_cases`, each with a non-empty `name_ar`, giving 11 × 141 =
  1,551 addressable cells, and all 36 Vital Signs tickets filed as records.
- **Files** — `supabase/migrations/0024_map_use_cases.sql`, `supabase/migrations/0032_use_case_rungs.sql`

### BRD-009 — 141 organizations, and the grid is 1,551

- **State** — agreed
- **Statement** — The thirteen identity rulings of 25 August are applied as data, not as a script's
  guess: Aseer splits into two by hospital system (Care Ware, Vida Plus), Najran into a cluster and
  a specialized hospital, AlSalama merges to one, all seven of section A merge and all of section B1
  merges including Samer Abbas / Samir Abbas. 161 organizations become 141 and the grid becomes
  141 × 11 = 1,551. The apply writes an undo manifest before its first write.
- **Ground** — 161 tracker organizations, 24 clusters of near-duplicate map rows and 20 ticket names
  matching no row. The rulings collapse 20 rows, moving the grid from 1,771 to 1,551, and every row
  a ruling names was checked against `structure.csv` first — 0 missing. Aseer alone is 5 rows and
  41 tickets; `Aseer` and `Aseer Cluster` name no system and stay flagged pending allocation rather
  than becoming a 142nd organization.
- **Honesty rule** — Destructive operations write an undo manifest first.
- **Proof** — An undo manifest in `docs/EVIDENCE/import-runs/` naming all 161 pre-merge rows, and
  `structure.csv` reading 141 rows afterwards with the two Aseer rows still marked pending
  allocation.
- **Files** — `scripts/report/org-merges.mjs`, `scripts/report/structure.csv`, `docs/ORG-RULINGS.md`

### BRD-010 — Jazan is two, and one row is unallocated

- **State** — deferred
- **Statement** — MCC and MedicaCloud are DIFFERENT systems, so Jazan is two organizations, not one and not three. `Jazan Cluster (MCC)` and `Jazan cluster (MedicaCloud)` both stand. The bare `Jazan` row names no system and is **pending allocation** between them, exactly as Aseer\'s two bare rows are — a script may not decide which of two real organizations a row belongs to.
- **Ground** — Jazan is 3 rows and 100 tickets, 16 of them open — the largest ticket count of any
  unresolved cluster. If it later merges to one the grid moves from 1,551 to 1,529.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — `structure.csv` still carries `Jazan`, `Jazan Cluster (MCC)` and
  `Jazan cluster (MedicaCloud)` as three rows, and every denominator printed anywhere reads 1,551
  until a ruling changes it.
- **Files** — `docs/ORG-RULINGS.md`, `scripts/report/org-merges.mjs`

### BRD-013 — Medication records default to V1

- **State** — agreed
- **Statement** — Every migrated medication record starts at V1 and is corrected when an OB Account
  Manager touches it. The version is never inferred from ticket history, and the correction is
  recorded as a person's act.
- **Ground** — Of the 1,047 convention tickets naming a use case, 52 say V2 and zero say V1, across
  roughly 142 covered medication cells — history cannot answer the question, so a default plus a
  correction is the only honest shape.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — Every migrated medication record carries a version, and the count of records whose
  version was changed by a named person is reportable against the 142.
- **Files** — none yet; not built.

### BRD-022 — The COC chase lives in NphiesCore

- **State** — agreed
- **Statement** — Jira holds the ticket and its rung; NphiesCore holds the chase —
  `coc_submitted_on`, `coc_contact`, `coc_reference`, and the chase thread as `entry_updates` rows
  rather than a fifth column. This is the first write path in the product that anyone uses daily,
  because the person who needs it is the person asking for it.
- **Ground** — `setNodeUseCase` in `src/api/map.ts` has zero production call sites — the atom of
  progress cannot be written from anywhere in the UI — and the product has eight ways to look at
  data against almost no way to change any of it. `entry_updates` is already append-only, authored
  and timestamped, so a `coc_notes` column would be a second thread whose entries could not be
  attributed.
- **Honesty rule** — none beyond the standing four.
- **Proof** — A row in `map_node_use_cases` and a row in `entry_updates` written from the COC queue
  by a named person with a non-null author — not by a service-role script.
- **Files** — `src/api/map.ts`, `supabase/migrations/0024_map_use_cases.sql`

### BRD-029 — Nothing is cleared until the API is proven

- **State** — agreed
- **Statement** — The 715 imported use-case statuses and the 161 stage records stay in place until
  the Jira integration is proven. They were given as scaffolding to fine-tune before go-live, and
  scaffolding comes down after the building stands — and its removal writes an undo manifest first.
- **Ground** — 715 use-case statuses and 161 stage records are in the database, every one of the 161
  progress rows written by a script with `updated_by = null`; meanwhile the read connection returns
  200 with zero rows for every content query. Clearing them today would leave the product with
  nothing and prove nothing.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — The row counts stay at 715 and 161 until a read against a named project returns a
  non-zero row count, and the clearing run leaves a manifest in `docs/EVIDENCE/import-runs/`.
- **Files** — `supabase/migrations/0026_map_node_stages.sql`, `supabase/migrations/0024_map_use_cases.sql`

---

# process

### BRD-003 — The ladder is the status

- **State** — agreed
- **Statement** — The ladder is DEV → STG/TEST → COC → PROD, per use case, and it lives in the
  workflow status — never in a field and never in the title. Six statuses: Intake, DEV, STG/TEST,
  COC, PROD, Closed. `Intake` means nobody has said anything about this pair yet; it is not a claim
  that work has not started, and the seven old statuses retire on this issue type only.
- **Ground** — `Stage` is filled on 0 of 2,971 rows; `Application Environment` is filled on 1,274
  and every one says `Production`; `Environments` is filled on all 2,971 with platform tenants
  (OnboardA 1,849 / Staging 1,065 / OnboardB 57). Meanwhile 0 of the 445 Onboarding-family titles
  name an environment word and 708 tickets elsewhere do — the pair is written on one population and
  the rung on another.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — Roughly 1,100 of the 1,551 pairs sit in `Intake` as counted rows on day one, and
  `status CHANGED` history returns a rung for every open record — against 531 of 552 open onboarding
  tickets naming no rung today.
- **Files** — none yet; not built., `supabase/migrations/0032_use_case_rungs.sql`

### BRD-004 — Blocked is a flag, not a status

- **State** — agreed
- **Statement** — Blocked is recorded on three fields that already exist — `Flagged = Impediment`,
  `Action Pending With` (one of eight parties), `Expected Resolution Date` — plus one comment line
  saying what was asked and when. The record keeps its rung. `Pending on Vendor` retires as a
  status, and an expected date in the past is the escalation trigger.
- **Ground** — All 60 `Pending on Vendor` tickets sit in Jira's `To Do` category with real build work
  behind them, so the status did not merely fail to record the rung, it recorded the wrong one.
  Their rung is unrecoverable, their median age is 118 days (oldest 826), 1 of the 60 carries a due
  date and only 14 of the 60 name a vendor word in the summary. `Flagged` is set on 2 of 2,971 and
  `Action Pending With` on 0 of 2,971.
- **Honesty rule** — none beyond the standing four.
- **Proof** — The weekly report prints "of the N records at STG/TEST, M are flagged, and here is who
  each is waiting on" — a sentence today's data cannot produce at all — and query 10 (Flagged set,
  Action Pending With empty) returns 0.
- **Files** — none yet; not built.

### BRD-005 — A record closes only from PROD, only with a reason

- **State** — agreed
- **Statement** — An Onboarding record may be closed only from PROD, only when all six PROD
  conditions are met, and only with a Resolution that says why: `Live`, `Merged into duplicate`,
  `Superseded`, `Not applicable`, `Withdrawn`. PROD stays in the In Progress category because a
  cutover is not done; `Closed` is the single terminal state and withdrawal is a Resolution, not a
  status. Nothing is ever closed for inactivity, to clear a queue, or closed-and-reraised.
- **Ground** — All 2,165 resolved-and-closed tickets in this instance carry the single Resolution
  `Done` — including 370 of 370 closed onboarding tickets — so the tracker has never once recorded
  why anything closed. Re-raising is how 149 pairs came to carry more than one ticket and 37 summary
  strings became exact duplicates over 77 tickets.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — Every close after go-live carries a Resolution other than `Done`, and R8 falls from
  370 of 370 unexplained closes to a count of closes whose stated reason is readable.
- **Files** — none yet; not built.

### BRD-012 — The unowned organizations get a state, not a guess

- **State** — agreed
- **Statement** — An organization with no OB Account Manager is marked pending assignment —
  component lead unset, `pending-owner` on every ticket it carries, `Action Pending With` set to the
  PMO queue — and the compliance report counts it on its own line so the number is visible on day
  one and counts down. Its records are created on schedule; an unowned row is the PMO Lead's row
  until it is given away.
- **Ground** — 42 of 161 organizations have no Account Manager and those 42 hold 203 of the 773
  never-written pairs — the single largest block of the backlog. 12 of the 36 organizations with
  zero coverage are also unowned. Blank is what all 42 already are, and blank cannot be told apart
  from nobody-has-looked.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — A `pending-owner` count printed against 141 organizations on day one and falling as
  owners are named — never a blank cell and never a majority-assignee guess.
- **Files** — none yet; not built.

### BRD-014 — Ten days per rung, written by automation

- **State** — agreed
- **Statement** — The rung budget is 10 days, uniform across DEV, STG/TEST, COC and PROD and
  configurable as four numbers in one automation rule. `Due date` is written by automation on every
  rung transition and never typed by a person, and the budget is presented as a measuring stick, not
  as an observed duration.
- **Ground** — 89 of 2,971 tickets carry a due date, 3 of the 828 open ones and 0 of the 552 open
  onboarding ones — asking humans for dates has already been tried here. The only end-to-end
  evidence is 43 pipe-convention tickets that have ever resolved, at a median of 43 days each,
  against an instance-wide median of 55 days and a slowest tenth above 361.
- **Honesty rule** — No KPI from unconfigured inputs.
- **Proof** — Query 4 (on the ladder, no target date) falls from 552 of 552 to 0 once the rung-clock
  rule has fired once on each record, and every due date's author is the automation account rather
  than a person.
- **Files** — none yet; not built.

### BRD-024 — COC is the one rung only the PMO moves

- **State** — agreed
- **Statement** — Any OB Account Manager may advance a record through DEV → STG/TEST → COC; it is
  faster and it survives leave, and the audit trail records who. Moving off COC is PMO-only, because
  that is not a delivery act — it records that CHI signed, and it notifies somebody else.
- **Ground** — 9 OB Account Managers do this work inside 28 accounts, and four people hold 435 of the
  552 open onboarding tickets; a PMO-only gate on one rung of four is the smallest restriction that
  keeps the signature honest.
- **Honesty rule** — none beyond the standing four.
- **Proof** — A rung move on DEV → STG/TEST → COC by a named OB Account Manager succeeds and is
  attributed; the same account's attempt to move off COC is refused, and both appear in the audit
  trail.
- **Files** — none yet; not built.

### BRD-030 — The announcement stays drafted

- **State** — deferred
- **Statement** — The bilingual announcement — the email in Arabic and English and the
  one-paragraph WhatsApp version — stays drafted and unsent, kept because it gave the process a
  concrete shape. Its three dates are placeholders and none of them is promised until the identity
  rulings are applied and the Teams channel and open-hour slot are confirmed.
- **Ground** — No dates are committed anywhere in this programme: 89 of 2,971 tickets carry a due
  date, 3 of the 828 open ones and 0 of the 552 open onboarding ones. The 1 October migration date
  in the draft depends on a ruling that had not been made when it was written.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — §9 remains unsent with its three dates marked as placeholders, and the count of dates
  committed to the programme stays 0 until the owner names them.
- **Files** — `docs/OPERATING-MODEL.md`

### BRD-031 — Two of every three tickets are not the record

- **State** — agreed
- **Statement** — 2,049 of the 2,971 tickets are not the onboarding record and are not migrated:
  they keep their issue type, their queues and their workflow, gain zero required fields, and are
  attached to a pair with a `Relates` link rather than absorbed. Re-titling a helpdesk ticket into
  the `Onboarding |` convention, or re-typing an Incident as a record, is itself a finding.
- **Ground** — 2,049 of 2,971 tickets are support, SSO, whitelisting, errors and configuration —
  276 of them still open. 1,863 summaries match none of the thirteen conventions at all, and all 180
  Problems, all 150 Incidents and all 5 Tests are operational by construction. Any process that
  treats the project as the record is wrong about 2,049 of 2,971 rows.
- **Honesty rule** — Never a bare percentage.
- **Proof** — R14 prints 0 conversions in the period against 2,049 of 2,971 outside the record, and
  the covered-pair count never rises because of a re-title.
- **Files** — none yet; not built.

### BRD-032 — Closed-only pairs are attested, then split at 90 days

- **State** — agreed
- **Statement** — For every pair whose only tickets are closed, an OB Account Manager attests the
  rung the work actually reached; only then does a script split at the 90-day line — reopen the 99
  closed within 90 days, recreate the 119 older ones and `Relates`-link each to its closed original.
  An absorbed or superseded ticket is never deleted, never edited and never reopened, so its clocks
  survive.
- **Ground** — 218 of the 744 pairs have no open ticket — 179 of the grid's cells — of which 99
  closed within 90 days, 47 within a year and 72 longer ago, at a median resolution date of 21 April
  2026. All 370 of 370 closed onboarding tickets carry Resolution `Done`, so no rung can be read
  from a close, while the map records only 170 of its use-case cells as live.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — 218 attestations each naming the person who made it, and `Time to resolution` and
  `[CHART] Time in Status` unchanged on all 119 recreated pairs' originals.
- **Files** — none yet; not built.

---

# jira

### BRD-006 — Zero new custom fields

- **State** — agreed
- **Statement** — The design creates no new custom field. Seven fields that already exist carry the
  record — `Components`, `Nphies Use Case`, `Account Manager`, `Due date`, `COC Status`,
  `Baseline end date`, `Action Pending With` — with exactly three required at creation and the rest
  required only at the transition that needs them. The 498 empty fields are hidden from NONP's
  screens and contexts rather than bulk-deleted, the nine constant-valued fields are hidden and
  never repurposed, and no new field is created for NONP without deleting or repurposing one.
- **Ground** — 533 distinct custom fields exist and 498 are empty on all 2,971 rows — including
  `Account Manager`, `Delivery status`, `COC Status`, `Checklist Progress %` and
  `Conformance Status 1` through `17`. A complete governance process was configured here once and
  every field it depended on is empty. Nine more fields are filled on 178 to 2,971 rows and carry
  exactly one distinct value each.
- **Honesty rule** — No KPI from unconfigured inputs.
- **Proof** — The NONP custom-field count is unchanged after configuration, and the
  `NONP – Onboarding` field configuration lists 498 fields Hidden with exactly three Required.
- **Files** — none yet; not built.

### BRD-007 — Organization lives in Components

- **State** — agreed
- **Statement** — The organization is the system `Components` field, one component per organization:
  the canonical English name as the stable JQL key, the Arabic name in the description, and the OB
  Account Manager as Component Lead — left blank where there is no owner rather than filled with a
  placeholder. Exactly one component per record is enforced at the create transition. The six empty
  fields competing to be the organization field are hidden.
- **Ground** — `Related to (migrated)` is filled on 1,940 of 2,971 rows and 26 of its 27 values are
  organization names, which seed the component list and back-fill 683 tickets on day one (the 1,257
  rows saying `Lean Business` name the integrator, not a hospital). 42 of 161 organizations have no
  owner, and Component Lead turns that statistic into one screen.
- **Honesty rule** — Every user-visible string goes through `t()` with en/ar parity.
- **Proof** — 141 components exist, each carrying an Arabic name in its description, and R13 falls
  from 531 of 552 open records naming no hospital — 420 saying `Lean Business`, 111 empty — to
  `component IS EMPTY` returning 0.
- **Files** — `scripts/report/structure.csv`

### BRD-025 — The Jira write-back is a new function

- **State** — gated
- **Statement** — When the PMO records a certificate as signed, a new `jira-write` edge function
  writes the signed date and CHI reference to the ticket, posts a comment, and re-assigns to the OB
  Account Manager only if the ticket is unassigned or held by the PMO — otherwise it comments and
  leaves the assignee alone. `jira-read` is never widened. Nothing writes until reading works and is
  trusted.
- **Ground** — `jira-read`'s frozen four-endpoint allow-list and the test asserting the file contains
  exactly two `fetch(` calls and one `Authorization:` header are the only formal proof of read-only
  in this system; widening it would destroy that proof for every existing caller. The read
  connection does not work yet — the scoped token authenticates as an app with no project grants and
  every content query returns 200 with zero rows.
- **Honesty rule** — none beyond the standing four.
- **Proof** — `jira-read/index.ts` still counts two `fetch(` and one `Authorization:`; `jira-write`
  carries its own counted-call test over exactly three operations; and the first write happens only
  after a read against a named project returns a non-zero row count.
- **Files** — `supabase/functions/jira-read/index.ts`, `supabase/functions/jira-read/index.test.ts`

### BRD-033 — Evidence is a link or a tick

- **State** — agreed
- **Statement** — Every rung gate takes a link or a checklist tick and never free text: one accepted
  message of this use case referenced for DEV, the interface checklist reading All Completed
  enforced at exactly the STG/TEST → COC transition, a signed certificate for this exact pair at
  COC → PROD — a sibling use case never promotes this one — and a required comment on every backward
  transition.
- **Ground** — `Resolved confirmation` is filled on 949 rows with 331 distinct values, of which 214
  say "done", 103 say "." and 103 say "," — free-text evidence has already decayed into punctuation
  in this instance. The checklist reached 113 of 2,971 tickets and 105 of those read Not Completed
  against 9 All Completed, and 550 of 552 open onboarding tickets have none at all.
- **Honesty rule** — none beyond the standing four.
- **Proof** — R12 falls from 550 of 552 records with no checklist, and no record reaches COC without
  a checklist reading All Completed because the validator makes it unreachable.
- **Files** — none yet; not built.

---

# ai

### BRD-011 — Nothing is guessed by an algorithm

- **State** — agreed
- **Statement** — No algorithm may assert that two organization names are one hospital, that a rung
  was reached, or that a person owns an organization. Scripts print the evidence beside each
  candidate and stop; the merge, the rung attestation and the owner assignment are made by a named
  person. Auto-transitioning a rung from ticket keywords, auto-closing stale records and round-robin
  assignment are refused for the same reason.
- **Ground** — The same edit-distance rule at one looser notch collapsed KFSHB into KFSHRC, Rabet
  into Rabia, Abeer into Aseer, Aya into GAMA and Hail Cluster into Taif Cluster — five different
  hospitals, no error message — giving 149 organizations and 750 pairs against the conservative 161
  and 744. The rulings script's own first run invented a 142nd organization and had to be caught by
  hand. The programme's six departments and 119 account managers were majority-vote readings of Jira
  columns rather than statements anyone made.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — Every merged row in `org-merges.mjs` cites the ruling line that authorised it, and any
  run that moves the denominator names the person who signed it.
- **Files** — `scripts/report/org-merges.mjs`, `scripts/report/rulings.mjs`, `docs/ORG-RULINGS.md`

---

# ob-monitoring

### BRD-015 — A stage clock counts only if a person started it

- **State** — built
- **Statement** — A progress row whose `updated_by` is null was written by a service-role script, so
  its `stage_changed_at` is the moment the script ran: it reads as null days everywhere rather than
  as zero, and no lateness, budget or quiet verdict is computed from it. Authorship is the test, not
  a shared timestamp — three rows written in one bulk-bar statement by a person all count.
- **Ground** — All 161 `map_node_progress` rows carry `updated_by = null` and exactly two
  `stage_changed_at` values — 75 rows at 2026-08-22T14:44:16.991611Z and 86 rows at
  2026-08-23T17:11:53.997788Z, to the microsecond. Ten days after those instants all 124
  not-yet-Live organizations would have crossed their rung threshold within a day of each other and
  every surface would have reported a programme-wide stall that never happened.
- **Honesty rule** — No KPI from unconfigured inputs.
- **Proof** — `isAtRisk` answers false for null days, no surface prints "0 days", and the test named
  for the bulk-bar case keeps three rows sharing one instant counted because they have an author.
- **Files** — `src/lib/portfolio/fields.ts`, `supabase/migrations/0026_map_node_stages.sql`, `supabase/migrations/0032_use_case_rungs.sql`

### BRD-016 — The lateness card names which silence it found

- **State** — built
- **Statement** — When nothing is measurable the card says which half is missing: `no-clock` when
  the rungs carry expected durations and nobody has staged an organization, `no-expectation` when no
  rung has a time yet. It never sends the reader off to do something they have already done, and the
  two silences cannot merge back into one.
- **Ground** — The expected durations are set — Kickoff 10, Integrating & Testing 10, UAT 2, Go-live
  readiness 3 — yet `measurable` fell to 0 across the workspace once import-written clocks stopped
  counting, and the single arm for that case told the reader to give a stage an expected duration.
- **Honesty rule** — No KPI from unconfigured inputs.
- **Proof** — The closed `LatenessVerdict` union has no `default:`, so a new arm breaks `Pmo.tsx`'s
  switch at compile time rather than rendering a blank card; one test pins `no-clock` on a rung
  carrying `expected_days` and a sibling pins the genuine `no-expectation` case beside it; 5,642
  tests green and the card read in Arabic on screen.
- **Files** — `src/lib/pmo/summary.ts`, `src/lib/pmo/summary.test.ts`, `src/pages/Pmo.tsx`

### BRD-017 — Quiet is fourteen days

- **State** — agreed
- **Statement** — A record is quiet when it has had no movement and no comment for 14 calendar days,
  at any rung. The threshold is configurable and is not to be softened before anyone has seen what
  it says; quiet starts counting from the first movement a person makes, never from an import stamp.
- **Ground** — The median open item is 216 days old, 261 are older than a year and the oldest is 875
  days, so a fortnight's threshold lights a large part of the board in week one — the first honest
  measurement this programme has had rather than a miscalibrated instrument.
- **Honesty rule** — No KPI from unconfigured inputs.
- **Proof** — The quiet count on day one printed against 1,551, beside the count of records excluded
  because no person has yet touched them.
- **Files** — none yet; not built.

### BRD-018 — The section opens on what is stuck

- **State** — agreed
- **Statement** — OB monitoring opens on the exception list — what is stuck right now — with
  coverage, the weekly delta and load below it. Four things raise a flag: flagged as blocked, past
  the 10-day rung budget, no owner, and gone quiet. A flag that cannot yet be computed is shown as
  unmeasurable, not as zero.
- **Ground** — Only two of the four can fire on today's data: 42 of 161 organizations have no owner
  and the median open item is 216 days old, while 0 of 552 open onboarding tickets carry a due date
  and `Flagged` is set on 2 of 2,971. A dashboard whose first screen is a progress bar is one people
  stop opening.
- **Honesty rule** — No KPI from unconfigured inputs.
- **Proof** — The first screen renders the exception list with every count against its denominator,
  and the budget flag renders as unmeasurable until real rung transitions exist — never as
  "0 at risk".
- **Files** — `src/pages/Pmo.tsx`

### BRD-019 — The row is a hospital

- **State** — agreed
- **Statement** — 141 rows, one per organization, each carrying its eleven use cases as a strip of
  rung markers, and the cell is where you drill. All three tiers read the same page and the same
  numbers, differing only in what it opens on — which means it names individuals, because an
  Associate Director's queue is a person's queue.
- **Ground** — The atom is 141 × 11 = 1,551 records, more than anyone reads; one row per use case
  would answer "how is Lab Order going" and lose the hospital. Four people hold 435 of the 552 open
  onboarding tickets and 526 of the 828 open items instance-wide — the most actionable fact the PMO
  holds. The tab it replaces has one row per organization and no use-case dimension at all.
- **Honesty rule** — Never a bare percentage.
- **Proof** — 141 rows × 11 tracks rendered from one dataset, and the load view naming the four
  people who hold 435 of 552 rather than printing a share.
- **Files** — `src/pages/Pmo.tsx`

### BRD-020 — The strip reads as position

- **State** — agreed
- **Statement** — Each use-case track is drawn as position — the marker's distance along
  DEV → STG/TEST → COC → PROD is the progress — and never as a set of hues. A pair nobody has
  written down is untouched paper with no marker at all, never a marker at position zero.
- **Ground** — Roughly 1,100 of the 1,551 tracks are empty on day one, so the drawing is mostly a
  picture of what nobody has said. The same rule is already enforced by `0026_map_node_stages.sql`
  on the ladder, by `cover.mjs` on the printed report, and by `INK.unrecorded = 'none'` in
  `build.mjs`.
- **Honesty rule** — An ordered ladder is drawn as position, never as hues.
- **Proof** — The strip is legible in greyscale, in a screenshot and to a reader who does not know
  the palette — colour is not a channel — and the count of empty tracks equals the count of pairs
  never written.
- **Files** — `scripts/report/build.mjs`, `supabase/migrations/0026_map_node_stages.sql`

### BRD-021 — COC has its own channel

- **State** — agreed
- **Statement** — COC is the Certificate of Completion, signed by CHI, the client. Records at COC
  get their own count, their own list and their own words, and are never folded into "stuck" or
  coloured as a fault: the waiting party is outside the programme, it is the one rung the PMO itself
  works, and ten days at COC is a question for CHI rather than for a delivery team.
- **Ground** — 49 of 2,971 tickets say COC or conformance and `COC Status` is filled on 0 of 2,971 —
  nothing anywhere surfaces this rung today. Every "chase the assignee" sentence applied to a COC
  record points the reader at somebody who cannot move it.
- **Honesty rule** — none beyond the standing four.
- **Proof** — The COC count renders in its own section with a sentence naming CHI, and no record
  whose only condition is being at COC carries a warning colour anywhere on the page.
- **Files** — `src/pages/Pmo.tsx`

---

# map

### BRD-027 — Ayenati and Raqeeb are separate tracks

- **State** — agreed
- **Statement** — Ayenati and Raqeeb are separate programmes with their own tracks and their own
  organizations — not a tag on a hospital and not a grouping of the eleven use cases. A report
  scopes to a track, which is what "a report for a certain product" means here.
- **Ground** — `map_nodes.track_id` is derived from the parent by a trigger and is NOT NULL at every
  depth, so two filing axes are unrepresentable and a second track is a first-class thing rather
  than a workaround. The nine archived tracks from the old product were removed for being empty, not
  because a workspace may hold only one.
- **Honesty rule** — none beyond the standing four.
- **Proof** — A second track exists carrying its own organizations, and a report scoped to it
  returns none of the 141 UHR organizations.
- **Files** — `supabase/migrations/0023_map_nodes.sql`

### BRD-028 — One computation, two surfaces

- **State** — agreed
- **Statement** — The exception list on the PMO dashboard and the same data drawn on the map — by
  department, by vendor, by HIS — read one function. Neither surface restates the other's
  arithmetic, and a roll-up never shows a number its own children contradict.
- **Ground** — Both surfaces read the same 1,551 records, and `MapBranchDetail.tsx` already carries
  the rule that a roll-up cannot know the reader's filter and that a branch labelled 12 showing 3 is
  the worst thing this map can do.
- **Honesty rule** — Never a bare percentage.
- **Proof** — A test that changes the filter and re-reads both surfaces finds the branch label and
  the rows beneath it agreeing every time, each printed as N of M.
- **Files** — `src/components/map/MapBranchDetail.tsx`, `src/pages/Pmo.tsx`

---

# attachments

### BRD-026 — Attachments come in, with three redactions

- **State** — deferred
- **Statement** — Attachments are brought in, and "with redaction" means three different things:
  redact-by-rule for structured text, extract-and-redact for documents, and for images either a
  human review step before an image becomes visible or images stay a link out to Jira. Nothing lands
  before the schema gains file storage and `src/pages/Privacy.tsx`, both locale bundles and
  `ios/App/App/PrivacyInfo.xcprivacy` change in the same commit. Sequenced after the ticket
  contract, never ahead of it.
- **Ground** — 5,339 attachments: roughly 2,455 images, 1,688 documents and 969 structured-text
  files. By filename alone 2,307 are named screenshot or capture, 121 name a certificate or a key,
  117 an HL7 or message sample, and 23 name a patient, an MRN or an iqama. A screenshot of a patient
  list cannot be redacted by a rule, and the Apple filing currently declares no health data.
- **Honesty rule** — none beyond the standing four.
- **Proof** — A redaction test suite over the 969 structured-text files with a counted miss rate;
  zero of the 2,455 images visible in the product until a named person has reviewed each; and the
  privacy declarations changed in the same commit as the first stored file.
- **Files** — `src/pages/Privacy.tsx`, `ios/App/App/PrivacyInfo.xcprivacy`

---

# brief

### BRD-035 — The brief is bilingual, side by side

- **State** — agreed
- **Statement** — Every requirement in this brief carries its English and its Arabic side by side,
  in one file — never as a second document that drifts. The Arabic is written as an original, not
  fetched as a translation, and every user-visible string in the product it describes goes through
  `t()` with en/ar parity.
- **Ground** — 0 of the 2,971 ticket summaries contain any Arabic in a programme whose first
  language is Arabic, and the product's own use-case catalogue seeds ten rows with `name_ar` empty
  on all ten — a second-language column left blank is exactly how the second document drifts.
- **Honesty rule** — Every user-visible string goes through `t()` with en/ar parity.
- **Proof** — One file, and a count of requirements carrying an Arabic column equal to the total
  count of requirements.
- **Files** — none yet; not built.

### BRD-036 — Before and after, per requirement

- **State** — agreed
- **Statement** — Each requirement that changes a surface shows that surface as it is today beside
  how it will read, side by side, so the change is visible rather than described.
- **Ground** — Three captures of today's surfaces are on disk — the map, the PMO overview and the
  PMO delivery tab — and the delivery tab they show carries one row per organization with stage,
  days-in-stage, owner and an open count, with no use-case dimension at all against 1,551 records.
- **Honesty rule** — An ordered ladder is drawn as position, never as hues.
- **Proof** — The number of before-and-after image pairs in the brief equals the number of
  requirements that change a surface.
- **Files** — `docs/brd-assets/today-map.jpg`, `docs/brd-assets/today-pmo-overview.jpg`, `docs/brd-assets/today-pmo-delivery.jpg`

### BRD-037 — The owner alone approves

- **State** — agreed
- **Statement** — Abdulaziz Alsaloom approves this brief, and nothing in it is built before he does.
  A job title never carries approval and never grants permission: roles are checked, positions are
  printed.
- **Ground** — 18 people are on the roster and exactly 2 hold `workspace.admin`; the programme's six
  departments and 119 account managers were majority-vote readings of Jira columns presented as
  facts nobody had stated, which is what an unapproved fact costs. Eight database tables were
  created three days before nobody used them and no requirement anywhere explains them.
- **Honesty rule** — "Nobody has said" is never zero.
- **Proof** — A dated approval line signed by the owner on this brief, and no requirement moving
  from `agreed` to `built` without one.
- **Files** — `docs/PEOPLE.md`

---

# The permission keys

Five keys exist, and the catalogue is code-defined: `role_permissions_key_ck` in
`0025_roles_permissions.sql` refuses any other string, because a key nobody checks grants nothing.
They are listed here because BRD-024 and BRD-037 are both statements about who may do what, and a
requirement about permission that does not name the keys is a requirement about a feeling.

| Key | What it gates | Register lines that lean on it |
|---|---|---|
| `workspace.admin` | The workspace itself. Held by exactly 2 of the 18 people on the roster. | BRD-037 |
| `structure.edit` | `map_nodes` and `map_node_kinds` — the 141 organizations and the shape above them. | BRD-009, BRD-019 |
| `vocab.edit` | `use_cases`, `vocab_options`, `label_overrides` — the eleven, and every renameable label. | BRD-008, BRD-035 |
| `members.manage` | `profiles`, `roles`, `role_permissions` — the escalation boundary, held back on purpose. | BRD-012, BRD-024 |
| `capture.write` | The day-to-day write: a rung move an OB Account Manager makes, and the COC chase. | BRD-022, BRD-024 |

# Migration ledger

Every file in `supabase/migrations/`, and the requirement that explains it. **A migration no
requirement explains is either dead or undocumented** — which is precisely the finding BRD-037
records against `0031_pmo_portfolio.sql`: eight tables, created three days before nobody wrote to
them, that no requirement had asked for.

`pre-brief` marks the twenty-two OpsTrack migrations that predate this programme (29 July to
1 August 2026, all of them before `0023`). They are the product this one is built on, and the
boundary is fixed at `0023`: a new migration may never be filed as `pre-brief`.

| Migration | Explained by | What it is |
|---|---|---|
| `0001_opstrack_core.sql` | pre-brief | Profiles, tracks, entries, the append-only update thread. |
| `0002_config_foundation.sql` | pre-brief | The admin's configuration surface and `config_audit`. |
| `0003_vocab_options.sql` | pre-brief | Renameable status, priority and type options. |
| `0004_workspace_data.sql` | pre-brief | The sixth track, per-track tags, meetings. |
| `0005_sla_off_by_default.sql` | pre-brief | SLA ships off. |
| `0006_track_slas.sql` | pre-brief | SLA becomes a track × priority matrix. |
| `0007_activity_diff_ignores_updated_by.sql` | pre-brief | The staleness clock stops counting its own bookkeeping. |
| `0008_meeting_line_guard_and_run_now_backlog.sql` | pre-brief | A deletable meeting line, and an authorless "Run now". |
| `0009_rls_initplan_and_closed_index.sql` | pre-brief | RLS predicates stop running once per row. |
| `0010_claim_counters.sql` | pre-brief | The claim throttle becomes a row. |
| `0011_push_subscriptions.sql` | pre-brief | Web Push subscriptions and per-kind preferences. |
| `0012_preserve_owner_name.sql` | pre-brief | A member leaves; their name stays on the work. |
| `0013_member_usernames.sql` | pre-brief | The roster's usernames, readable by the app. |
| `0014_recurring_template_authorship.sql` | pre-brief | Recurring templates gain an author and an audit trail. |
| `0015_entry_write_guard_and_line_authorship.sql` | pre-brief | The column guard, and line authorship. |
| `0016_name_pin_close_date_and_handover_clock.sql` | pre-brief | Three columns a member could write that nobody meant them to. |
| `0017_label_overrides.sql` | pre-brief | The owner renames anything a person reads, in both languages. |
| `0018_track_groups.sql` | pre-brief | A level above tracks. |
| `0019_nudges.sql` | pre-brief | The chase, recorded. |
| `0020_ai_usage.sql` | pre-brief | The AI assist costs money, so the money is measured. |
| `0021_ai_prefs.sql` | pre-brief | The per-member AI switch. |
| `0022_nudge_stamps_on_insert.sql` | pre-brief | The nudge stamps are the server's on INSERT too. |
| `0023_map_nodes.sql` | BRD-027 | The hierarchy below the tracks, and `track_id` NOT NULL at every depth — which is why a second programme is a track and not a tag. |
| `0024_map_use_cases.sql` | BRD-008, BRD-022, BRD-029 | The use-case catalogue, the node × use-case join, and `entries.node_id`. |
| `0025_roles_permissions.sql` | BRD-024, BRD-037 | Roles become data, and the five permission keys above. A role is checked; a job title is printed. |
| `0026_map_node_stages.sql` | BRD-015, BRD-020, BRD-029 | The stage ladder and the progress row — the ladder drawn as position, and the clock BRD-015 refuses to read. |
| `0027_map_node_goals_and_counts.sql` | BRD-028 | Goals against a node and the first server-side aggregate on the map — the roll-up BRD-028 forbids from contradicting its children. |
| `0028_jira_settings.sql` | BRD-001, BRD-025 | The saved Jira configuration and the off-switch, which is what `jira-read` and a later `jira-write` are configured through. |
| `0029_org_identity.sql` | BRD-009 | Who an organization IS to NPHIES — the identity the thirteen rulings settle. |
| `0030_map_view_settings.sql` | BRD-020 | How the map draws, with `colour_by` pinned to a single value because exactly one hue source exists. |
| `0032_use_case_rungs.sql` | BRD-003, BRD-008, BRD-015 | The rung ladder per use case, `scope` for not-applicable, the blocked flag, the COC queue's four columns, the append-only event log, and the XD/Encounter History merge into the eleven. |
| `0031_pmo_portfolio.sql` | BRD-037 | Eight `pmo_*` tables — projects, initiatives, actions, risks, revenue, objectives, key results, milestones — created before any requirement asked for them. Named here as the finding BRD-037 records, not as a decision. |
