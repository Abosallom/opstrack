# OPERATING-MODEL — one ticket per hospital per use case

> ⚠ **READ §10.0 FIRST — the decisions of 25 August 2026 moved the grid twice.**
> The use-case list is **eleven** (Vital Signs is in), and the organization-identity rulings
> collapsed **161 organizations to 141**. So the target universe is **141 × 11 = 1,551** — not
> 1,771 and certainly not the 1,449 that appears throughout the sections below. Every `1,449` and
> every `773 of 1,449` predates all of this and is superseded. The reasoning in each section
> stands; the arithmetic in it does not. The rulings themselves are in
> [`ORG-RULINGS.md`](./ORG-RULINGS.md) and as data in `scripts/report/org-merges.mjs`.

The onboarding operating model for the UHR programme: what the record is, where it lives, how
it moves, what happens to the 2,971 tickets that exist today, and what the weekly report is
allowed to say. Assembled from five studies — the measurement pass over the Jira export, the
ticket contract, the Jira configuration, the migration and compliance rules, and the
announcement — and it supersedes all five. Where two of them disagreed, one was chosen and the
sentence saying why is left in place.

Every number here is checkable against
[`/Users/aziz/.claude/jobs/8f812826/tmp/jira-safe.csv`](file:///Users/aziz/.claude/jobs/8f812826/tmp/jira-safe.csv)
(2,971 rows) and the organization map at
[`scripts/report/structure.csv`](../scripts/report/structure.csv) (161 organizations).

---

## 1 · What this document is, and what it is for

This is **the process, not the software.** It is what Abdulaziz Alsaloom announces to the OB
Account Managers, the Associate Directors and the technical team; it is what a Jira
administrator configures; and it is the thing the tracker in this repository will later be
built to reflect. **Nothing is built in the application until the owner approves what is written
here.** If a screen in NphiesCore ever disagrees with this page, this page is wrong or the
screen is — and the argument gets settled here first, in words, before a line of TypeScript
moves.

Three decisions were made by the owner before this document was written, and they are not
reopened anywhere in it:

1. **The record is one Jira ticket per (hospital × use case)**, living from initiation to
   go-live. Jira Service Management is officially where onboarding is traced.
2. **The word is "use case"**, never "capability". **The people are "OB Account Managers"**,
   never "engineers".
3. **The ladder is DEV → STG/TEST → COC → PROD**, per use case.

   ⚠ **COC is the Certificate of COMPLETION, and it is signed by the client — CHI.** This
   document first read it as a Certificate of *Conformance*, an internal quality gate. It is not.
   It is a signature obtained from outside the programme, which makes COC the one rung whose
   duration is **not** in the delivery team's hands and the one rung **the PMO itself works** —
   chasing a counter-signature is PMO work, not integration work. Everything downstream follows
   from that: COC is highlighted separately in the OB monitoring (§12), a record sitting at COC is
   a different kind of problem from one sitting at STG/TEST, and the 10-day budget means something
   different there. The old seven rungs — Not started, Kickoff, Integrating & Testing, UAT, Go-live
   readiness, Live, Paused — are retired.

What this document adds is everything downstream of those three: which fields carry the pair,
which status carries the rung, what blocked means, what closing means, what happens to the
tickets that already exist, and what the report prints on its first run. It ends with the
short list of decisions the council could not make on the owner's behalf (§10).

**Two house rules govern the prose, and they are not stylistic.** First: **never a bare
percentage.** "381 of 2,971", never "13%" — the denominator is the honest part, and a
percentage hides it. Second: **"nobody has said" is not zero.** An unrecorded fact is not a
measurement of absence. Most of the design below exists to keep those two sentences true when
the data gets large.

---

## 2 · BRD-001 — the Description quarantine

⚠ **This is a live governance rule, not a note about one analysis.**

A scan of the original Jira export found **raw HL7 v2 clinical payloads with patient-shaped
identifiers, certificates and private keys inside the ticket `Description` field.** Not in an
attachment, not in a restricted comment — in the body of ordinary service-request tickets that
anyone with project access can read.

Every measurement in this document was taken from a **safe projection**,
`/Users/aziz/.claude/jobs/8f812826/tmp/jira-safe.csv`, in which `Description`, `Environment`,
all 22 `Attachment` columns and all 50 `Comment` columns have been **physically removed** — 628
of 702 columns kept, 2,971 rows. The projection was verified before use: HL7 segment markers
8 → 0, certificate and private-key blocks 24 → 0, email addresses 197 → 1, and the two Jira
custom fields "patient ID (هوية المريض)" and "Physican ID (هوية الطبيب)" have **zero rows
filled**.

**The standing rules:**

- The original export is not opened, read, quoted or re-derived. Only the safe projection is.
- **No identifier-shaped value is ever pasted into a document, a commit, a chat message or a
  ticket.** Not an example, not a redacted-looking one.
- The programme's operating assumption is that **`Description` is contaminated at source**, not
  that one export was unlucky. Anything built on top of Jira — including the tracker in this
  repository — reads the fields named in §6 and does not read `Description`.
- **This rule outranks convenience.** If a question can only be answered by reading
  `Description`, the answer is that the question is not answered yet.

The clean-up of the source field is a separate piece of work with its own owner, and it is not
in scope here. What is in scope: **the new record must not recreate the problem.** That is one
of the reasons §4 puts the organization and the use case in *dropdown fields* and generates the
title from them — a controlled vocabulary cannot receive a pasted HL7 segment, and a free-text
box eventually does.

---

## 3 · The ground, measured

### 3.1 The shape of the tracker

One project — key `NONP`, named **"Nphies Non prod"** — 2,971 tickets.

| Issue type | tickets |
|---|---|
| Service request | 2,634 |
| Problem | 180 |
| Incident | 152 |
| Test | 5 |

| Status | tickets |
|---|---|
| Resolved | 1,299 |
| Closed | 844 |
| Open BO | 470 |
| Work in progress | 294 |
| Pending on Vendor | 60 |
| Reopened | 3 |
| Pending on Production | 1 |

**828 of 2,971 tickets are open.** 2,165 are Resolved or Closed, and every one of those 2,165
carries the same Resolution value: **`Done`**. No other resolution has ever been written in this
instance. The tracker has never once recorded *why* anything closed — which is why, in §7, a
closed onboarding ticket cannot be read as "went live".

### 3.2 The first finding that justifies the change: a governance process already died here

**The export carries 533 distinct custom field names. 498 of them are empty on all 2,971
rows.** Counting columns rather than fields: 585 distinct column names in the safe projection,
**503 entirely empty**, 82 with at least one non-empty row.

Among the 498 empties, by name: **Account Manager. Delivery status. COC Status. Conformance
Status 1 through Conformance Status 17. Baseline start date. Baseline end date. Actual start
date. Actual end date. Checklist Progress %.** A complete onboarding governance process was
designed and configured in this Jira once, and every field it depended on is empty.

It did not die of bad intentions. It died because it asked all 2,971 tickets for everything and
**nothing depended on the answers**.

And "filled" is not the same as "informative". Nine fields are filled on between 178 and 2,971
rows and carry exactly **one distinct value**:

| Field | Rows filled | The only value it holds |
|---|---|---|
| `Application Environment` | 1,274 | `Production` |
| `Customer Name` | 1,274 | `INTERNAL` |
| `Severity (migrated)` | 2,971 | `Minor` |
| `SA Progress` | 2,971 | `To Do` |
| `Approvals` | 2,971 | an empty struct |
| `Pending on Vacation` | 2,713 | one value |
| `Request language` | 178 | `English` |
| `Is Created from API` | 178 | one value |
| `Breached IssueType [BO]` | 20 | one value |

Subtract those and roughly **73 of the 585 columns carry any information at all.**

`Application Environment` is the tombstone and the trap in one field. It is the best-named field
in the instance, it is filled on 1,274 rows, and **all 1,274 say the same word.** Any "which
fields are actually used?" report ranks it near the top and recommends building the ladder on
it. That is precisely the mistake this document is written to avoid, and it is why §6 hides the
constant-valued fields rather than repurposing them.

**The conclusion the whole design rests on: adding a field is not the lever.** 498 empty fields
is the evidence.

### 3.3 The second finding: two conventions that share almost nothing — and there were never two

The ground fact that started this work was that the tracker holds two competing naming
conventions — `Onboarding | Org | Use case` (382 tickets, roughly 90 of every 100 still open)
and `Interface Build - Org - Use case` (413 tickets, roughly 62 of every 100 closed) — and that
they share only **14 of 581** distinct organization + use-case pairs. Two populations of tickets
about the same programme, almost never about the same pair.

The measurement pass made that finding worse, not better. **There are thirteen title conventions
in the file, not two.**

| Convention | Example | Tickets | Open | Closed |
|---|---|---|---|---|
| `Onboarding \| Org \| Use case` (pipe) | `Onboarding \| Aljedaani Hospital \| Medication Dispense V2` | 391 | 344 | 47 |
| `Interface Build - Org - Use case` | `Interface Build - SGH - Medication Despinse use case V2` | 274 | 103 | 171 |
| `Org - Interface build - Use case` | `Aljedaani Hospital - Interface build- Medication use case V2` | 82 | 18 | 64 |
| `Org - Use case Use case` (bare) | `Rabet - Clinical Notes Use case` | 75 | 15 | 60 |
| `Interface Build request (for) Org - Use case` | `Interface Build request for Procare Riyadh Hospital -Lab Result use case.` | 58 | 37 | 21 |
| `Onboarding - Org - Use case` (dash) | `Onboarding - SFH - Clinical Notes.` | 54 | 50 | 4 |
| `Org - Use case Raqeeb Interface` | `Rabet Plus - Medication E-Dispense Raqeeb Interface` | 44 | 14 | 30 |
| `Stage Request - Org - Use case` | `Stage Request - Jazan University Hospital - ADT use case` | 31 | 3 | 28 |
| `Org - Use case - stage environment` | `Dallah- rad order- stage environment` | 30 | 21 | 9 |
| `Interface Development Request - Org - Use case` | `Interface Development Request - Al Emies Group - Clinical Note Use Case` | 28 | 2 | 26 |
| `STG & COC` / `COC & Stage Request - Org - Use case` | `STG & COC - Aseer Care Ware- Clinical Note` | 24 | 4 | 20 |
| `Interface Bulid` / `Buid` (misspelled) | `Interface Bulid for Jazan University Hospital` | 9 | 0 | 9 |
| `Roll Back \| Org Use case` | `Roll Back \| Delta Lab Results` | 8 | 5 | 3 |
| **No convention at all** | `Request to Update LDX Rad Report Table` | **1,863** | 312 | 1,551 |

Counted across all thirteen, **123 of 770 pairs appear under more than one convention**, and
narrowed to the two known families, **67 pairs appear under both an `Onboarding *` and an
`Interface Build *` title** — nearly five times the 14 originally measured, because the original
measurement was comparing two of thirteen populations.

**The 14-of-581 finding stands, and it understated the problem.** It is not that two teams write
two conventions. It is that thirteen conventions exist, none of them is enforced, and the pair —
the thing the whole programme is about — is recoverable from a title only by a fuzzy rule that
makes mistakes (§7.5).

### 3.4 The single biggest finding: the ladder is not written where the pair is written

**Of the 445 tickets using an `Onboarding`-family title, 0 name any environment word. Of the 453
using an `Interface Build`-family title, 1 does.**

Meanwhile the rung words are everywhere else. Across the whole file:

| Word | Tickets whose summary contains it |
|---|---|
| STG | 223 |
| stage / staging | 197 |
| TEST / testing | 164 |
| production | 60 |
| COC / conformance | 49 |
| PROD | 48 |
| pilot | 42 |
| live / go-live | 19 |
| DEV | 9 |
| UAT | 1 |
| SIT | 0 |
| **any environment word (union)** | **708** |
| STG \| stage \| staging \| test (the one STG/TEST rung) | 576 |
| PROD \| production \| live (the one PROD rung) | 126 |

Split by population: **635 of the 2,049 operational tickets name a rung, against 72 of the 922
onboarding-shaped tickets** — and those 72 are almost entirely the `Stage Request` and
`STG & COC` conventions, which are rung *events* rather than records.

**So the programme currently writes the pair in one population of tickets and the rung in a
different population.** "One ticket per pair, carrying the rung" is therefore not a rename. It
is a **merge of two disjoint ticket populations**, and §7 treats it as one.

### 3.5 What is populated, and what it is good for

Eleven fields carry real, varying information. These are the raw material for everything in §6.

| Field | Rows filled | Distinct values / notes |
|---|---|---|
| `Status`, `Rank`, `Time to resolution`, `Time to first response` | 2,971 | Platform-maintained. Warm because nobody has to remember them. |
| `Ticket Main Categorization (migrated)` | 2,971 | 7 values: Interface 2,491 · SSO 285 · Provider Portal 105 · Message Exchange 70 · Sehati 10 · Infrastructure 9 · Clinical 1 |
| `Environments` | 2,971 | 3 values: OnboardA 1,849 · Staging 1,065 · OnboardB 57. **Platform tenants, not the ladder** — but it is the only 100%-filled field with real variance that touches environment at all, and "Staging" on 1,065 rows shows the team does record a rung when the field asks for one. |
| `Assignee` | 2,955 | 8 of the 828 open tickets unassigned. |
| `Nphies Groups` | 2,386 | IT Integration and Development 533 · On-boarding 480 · Business Operation 444 · Product 331 · IT Delivery and Solution 278 · AMS 252 · OH 61 · PMO 6 · Raqeeb 1 |
| `Breach Date [BO]` | 1,945 | SLA clock — one of only two date families the team keeps warm. |
| `Related to (migrated)` | 1,940 | 27 values, **26 of them organization names**: Lean Business 1,257 (the integrator, not a hospital), EHC 56, KFMC 48, Jazan-Vida Plus 45, KSMC 42, MMS 39, SFH 38, SMC 34, Al Madinah Cluster 34, MoDHS 31, Aljouf 31, SGH 30… 683 rows name a real customer organization. |
| `Breach by [BO]` | 1,612 | 50 values (SLA owner). |
| `Resolved confirmation` | 949 | 331 distinct free-text values; **214 say "done", 103 say ".", 103 say ","**. |
| `Labels` | 867 | InterfaceDevelopment 381 · IntegrationSupport 291 · OH 135 · Whitelisting 16 |
| `Checklist Content YAML` | 113 | A real `Nphies_Interface_development_checklist` — Source Entity Name, Source System Public IP, Sending Application, Source System NHIC ORG ID, ADT A08 Encounter… Its companion field says **105 Not Completed, 9 All Completed**. |

`Resolved confirmation` deserves its own sentence, because it is the strongest evidence in the
file for a rule in §5: **this instance already tried free-text evidence, and it decayed into
punctuation.** 103 tickets record a full stop as their proof of completion. That is measured, not
predicted, and it is why every gate in this document is a link or a checklist tick.

### 3.6 Dates, blockers and load

**Dates.** `Due date` is filled on **89 of 2,971** tickets. Only **3 of the 828 open tickets**
carry one, and **0 of the 552 open onboarding tickets** do. A ten-day-per-rung budget has
nothing in today's data to compute against except Created/Updated timestamps and the two SLA
fields.

**Blockers.** Only **145 of the 828 open tickets** name a blocker of any kind in the summary:

| Blocker class | Open tickets |
|---|---|
| build/development item — no blocker word in the title at all | 564 |
| other / unclassified | 86 |
| data / mapping error | 36 |
| error or defect reported, cause not named | 36 |
| SSO / authentication | 32 |
| stage / promotion request (COC, stage env, go-live, pilot) | 30 |
| waiting on vendor / HIS | 17 |
| endpoint / connectivity / timeout | 13 |
| whitelisting / IP | 10 |
| certificate / SSL | 4 |

Note the last two rows against §6: the field built to capture whitelisting, `Public IP`, is
filled on **14 of 2,971** tickets. And note the vendor row against the status: **17 tickets say
"vendor" in the title while 60 sit in the status `Pending on Vendor`.** The status was the
better signal — which is exactly why it must not also be carrying the rung.

**Load.** 36 distinct people hold the 828 open tickets, and **the top four hold 526 of them**
(178, 153, 104, 91). Narrowed to the 552 open onboarding tickets, **four people hold 435**
(Dema Alkassim 162, Sara Alsaab 137, Hind Almubaraki 72, Riam Alnasser 64); twelve people hold
the remaining 117 and 2 are unassigned.

**Age.** 318 of the 828 open tickets are more than a year old, median age 211 days. Among the
552 open onboarding tickets the median age is 289 days, **495 of 552 are older than 90 days and
245 of 552 are older than a year.**

### 3.7 Vocabulary the data already contains

**Vendors and platforms named in titles:** Raqeeb (national medication platform) 225 · the IHE
profile codes XDRAD / XDRADO / XDLAB / XDLABO / XDDOCS used as use-case names 213 · Raqeem 49 ·
Rhapsody 40 · Nphies 35 · Careware 24 · Vida Plus 10 · LDX 7 · NTS 6 · MedicaCloud 5 · Murjan 5 ·
Lean Business 4 · MMDR 3 · Andalusia 3 · Oracle 2 · Mirth 1 · Clinicy 1 · Sehhaty 1 · Arcus 1.
**Zero** for Epic, Cerner, InterSystems, TrakCare, Malaffi and MEDITECH — this is a
Saudi-market HIS estate and the option lists should look like one.

**Use cases the tracker actually writes:** ADT, Medication Prescribe, Medication Dispense, Rad
Report, Rad Order, Lab Result, Lab Order, Clinical Notes — **eight base families**, plus **Vital
Signs**, which is a tenth use case already live in the data: **36 tickets, 4 distinct pairs**
(`Interface Build- Raqeem- Vital Signs Use case`, `Interface Build -Samer Abbas Hospital - Vital
Signs`). Also present: Immunization 8, Genomics 5, Consent 4, NVR 1.

**V1 versus V2 cannot be recovered from history.** Among the 1,047 convention tickets naming a
use case, **52 say V2** (Medication Dispense 29, Medication Prescribe 23) and **zero say V1**.
Every migrated medication ticket needs its version picked by hand or defaulted.

**No Arabic appears in any of the 2,971 summaries. Zero.** Arabic is a first-class language for
this programme and the ticket titles are currently 100 percent English. §6 puts Arabic where it
is exact — in the controlled vocabulary and in the weekly report — rather than in free text
where it would be unsearchable.

### 3.8 Two denominators, stated once so they never confuse a reader again

Two pair counts appear in the studies and both are correct at their own definition:

- **770 pairs on 999 tickets** — every one of the thirteen structured conventions, including the
  four loose ones (`Org - Use case Use case`, `Org - Use case - stage environment`,
  `Org - Use case Raqeeb Interface`, `Roll Back | Org Use case`).
- **744 pairs on 922 tickets** — the nine **onboarding-shaped** conventions only.

**This document uses 744 on 922.** The four loose patterns were excluded because their
"organization" segment is frequently an error phrase rather than an organization — *dallah
connectivity issue*, *jhah time out error*, *whitelisting jeddah*, *fakeeh testing issue*.
Including them would inflate the universe to 818 pairs and **import 42 organization names that
do not exist**. Those 77 tickets are real work; they are operational work, and §7.7 says where
they stay.

---

## 4 · The ticket contract

**One ticket per (hospital × use case), opened at initiation, kept open until go-live.**

### 4.1 The pair lives in fields. The title is derived and decorative.

**Recommendation: the organization and the use case live in two dropdown fields, and the title
is generated from them.**

The title is where the pair lives today and §3.3 is the cost of that: thirteen conventions, the
pair readable from only 922 of 2,971 titles, and reading it at all required an edit-distance
rule that — loosened by exactly one notch — silently merged **KFSHB into KFSHRC, Abeer into
Aseer, and Rabet into Rabia.** Three different hospitals, three wrong answers, no error message.
A dropdown cannot make that mistake. A title always can.

The counter-argument is the honest one and it is answered by scope, not by hope. "Fields go
empty in this instance" is not a worry, it is a measurement — 498 of them. The answer is that
these fields are **mandatory on one issue type covering the ~1,449 onboarding records, and on
nothing else.** The 2,049 operational tickets are never asked for a value they do not have.

| What | Field | Status |
|---|---|---|
| **Organization / المنشأة** | Jira system field **`Components`**, one component per organization | **Reused system field.** No custom field created. See §6.2. |
| **Use case / حالة الاستخدام** | `Custom field (Nphies Use Case)` | **Already exists in this instance and is filled on 0 of 2,971 rows.** Somebody already had this exact idea. |

*Resolved contradiction.* The contract study proposed reusing `Related to (migrated)` as the
Organization field and creating a new Use Case field; the configuration study found that
`Nphies Use Case` already exists and that `Components` is the stronger organization carrier.
**The configuration study wins on both, because both of its claims are measurements and the
other's were proposals** — and the result is stronger than either: **this design creates zero
new custom fields.** `Related to (migrated)` keeps a real job (§6.2): its 26 organization names
seed the component list and back-fill 683 tickets on day one.

### 4.2 The title convention

```
Onboarding | <Organization> | <Use case>
```

```
Onboarding | Aljedaani Hospital | Medication Dispense V2
```

Rules: exactly two pipe characters; the organization spelled exactly as its component;
**no environment word in the title** — the rung is the status; no ticket number, no "request",
no "Interface Build", no "V1"/"V2" unless it is part of the use-case option name.

This is not a new convention. It is the one **391 tickets already use, 344 of them still open** —
the largest population of already-conforming live tickets in the file. Adopting anything else
would throw that away. **The title is written by automation from the two fields** (§6.6, rule
A4), so the convention is not something anyone has to remember.

### 4.3 The issue type

**One new issue type: `Onboarding`.** Today the onboarding record is buried inside 2,634 Service
requests. Issue type is the cheapest possible separator and it makes every governance query
exact:

- `project = NONP AND issuetype = Onboarding` → the record. Nothing else.
- `issuetype != Onboarding` → the helpdesk. Untouched by everything in this document.

Service request, Incident, Problem and Test keep today's workflow and gain **zero** required
fields. **The workflow, the mandatory fields and the closure rule below apply to `Onboarding`
only.**

### 4.4 When a record may be closed

An `Onboarding` ticket may be closed **only from `PROD`**, **only** when the PROD definition of
done in §5.4 is satisfied, and **only** with a Resolution that says why.

Reuse the existing `Resolution` field and replace its option list. Today it holds one value —
**`Done`, on all 2,165 resolved-and-closed tickets.** New options for the `Onboarding` type:

| Resolution | Means |
|---|---|
| `Live` | The PROD definition of done in §5.4 is met. |
| `Merged into duplicate` | This pair is served by the surviving ticket, named in the link. |
| `Superseded` | Replaced by another record — name it. |
| `Not applicable` | This use case does not apply to this organization — name why. |
| `Withdrawn` | Business has excluded the pair. |

`Done` stays available on the operational issue types, because 2,165 tickets already carry it and
rewriting history is not on the table.

**A record may never be closed for inactivity, never closed to clear a queue, and never
closed-and-reraised.** Re-raising is how **149 pairs came to carry more than one ticket** and how
**37 summary strings became exact duplicates covering 77 tickets**.

*Resolved contradiction.* The configuration study proposed a separate terminal status
`Withdrawn` and put `PROD` itself in Jira's `Done` category. **Rejected.** A record at `PROD` is
in a cutover window — production configuration in place, traffic not yet at full scope — and a
status category that reads `Done` while a cutover is still running is the identical defect to
the one measured on the 60 `Pending on Vendor` tickets, every one of which sits in the `To Do`
category with real build work behind it (§5.3). `PROD` is `In Progress`; `Closed` is the single
terminal state; withdrawal is a Resolution value, not a status.

---

## 5 · The workflow, and blocked-as-a-flag

### 5.1 Six statuses

| # | Status | العربية | Jira category | Means | Evidence that moves it out |
|---|---|---|---|---|---|
| 0 | **Intake** | قيد الاستلام | To Do | The pair exists as a record. **Nobody has said anything about it yet** — this is not a claim that work has not started. | An OB Account Manager is the assignee **and** the interface checklist has been instantiated on the ticket. |
| 1 | **DEV** | بيئة التطوير | In Progress | Build and configuration against the development endpoint. | At least one message of **this** use case accepted at the DEV endpoint, referenced on the ticket. |
| 2 | **STG/TEST** | بيئة الاختبار | In Progress | Messages flowing in staging; the conformance test set is being run. | The interface checklist for this ticket reads **All Completed**. |
| 3 | **COC** | شهادة الإنجاز | In Progress | Completion evidence submitted to CHI; the certificate is not yet signed. **The waiting party is outside the programme.** | A signed Certificate of Completion recorded for **this exact pair** — not for the organization in general, not for a sibling use case. |
| 4 | **PROD** | بيئة الإنتاج | In Progress | Cutover window. Production configuration in place; traffic not yet accepted at full scope. **Pilot lives here.** | The definition of done in §5.4. |
| 5 | **Closed** | مغلق | Done | Terminal. The Resolution names the outcome. | — |

*Resolved contradiction.* The two studies named the entry status **`Intake`** and **`Not
Recorded`** respectively, for the same reason — that "Not started" would assert a measurement
nobody made. **`Intake` is chosen**, because it is the word already in the announcement in both
languages and because it is a rung name people say out loud; the *meaning* taken is the other
study's, and it is written into the table above: Intake says nobody has said, not that nothing
has happened. If the owner prefers `Not Recorded`, it is a one-word change in three places
(§10, decision 5).

**`Intake` is load-bearing.** **773 of the 1,449 target pairs have never been written down in
any ticket in this tracker's history** (§7.4). They are created *in Intake*, not skipped, not
counted as zero. Intake is the status whose entire job is to make "nobody has said" a countable
row.

**Evidence is a link or a checklist tick. Never free text.** See §3.5: this instance already
tried free-text evidence and 103 of its 949 answers are a comma.

### 5.2 What happens to today's seven statuses

| Today | Tickets | Disposition on the `Onboarding` type |
|---|---|---|
| **Open BO** | 470 | **Retired.** It names a queue, not a rung — and the queue is already a field: `Nphies Groups`, filled on 2,386 of 2,971 (Business Operation 444). Migrates to `Intake` or `DEV` by evidence. |
| **Work in progress** | 294 | **Split** across DEV / STG/TEST / COC / PROD by evidence; default `DEV` where no environment evidence exists. |
| **Pending on Vendor** | 60 | **Retired as a status.** Becomes `Flagged = Impediment` + `Action Pending With = HIS Vendor`, and the ticket **keeps its rung**. See §5.3. |
| **Pending on Production** | 1 | **Mapped** to `PROD`. |
| **Reopened** | 3 | **Retired.** A record that fails goes back to the rung it failed at. The transition history records the reopening; a status called "Reopened" erases which rung it fell from. |
| **Resolved** | 1,299 | **Retired.** Resolved and Closed are both category `Done` and the difference between them has never been recorded — Resolution is `Done` on all 2,165. Two terminal states meaning the same thing are one terminal state. |
| **Closed** | 844 | **Kept**, as the single terminal state. |

All seven remain untouched on Service request, Incident, Problem and Test.

### 5.3 Blocked is a flag, not a state

**A ticket blocked at STG is still at STG.** Blocked is recorded on three fields, and **all three
already exist**:

| Field | Value | Filled today |
|---|---|---|
| `Custom field (Flagged)` | `Impediment` | **2 of 2,971.** Jira's native flag; zero configuration; renders as a visible flag on the board. |
| `Custom field (Action Pending With)` — *Action Pending With / الإجراء لدى* | one of: `OB Account Manager`, `Organization`, `HIS Vendor`, `Integration Engine Vendor`, `Nphies IT Integration and Development`, `Nphies Product`, `Nphies Business Operation`, `NHIC` | **0 of 2,971.** Eight options, one pick. The option list mirrors `Nphies Groups`, whose 2,386 filled rows prove the team will name a queue when asked. |
| `Custom field (Expected Resolution Date)` | the date we expect the block to clear | **1 of 2,971.** Mandatory whenever `Flagged` is set. **A date in the past is the escalation trigger** — and it is the only thing in this design that generates work for the PMO rather than for the account managers. |

Plus one comment line: what we asked for, and when we asked.

**Why collapsing this into the status destroys information — measured on the 60.** The 60
`Pending on Vendor` tickets are the proof, and each of these is a separate failure:

- **All 60 sit in Jira's `To Do` status category.** Every board, every burndown and every "not
  started" count in this instance currently classifies 60 tickets with real build work behind
  them as *not started*. The status did not merely fail to record the rung — **it recorded the
  wrong one.**
- **Their rung is unrecoverable.** The status says who we are waiting on and nothing else.
  Whether that hospital was blocked in DEV or one signature short of PROD is not in the file.
- **They are old.** Median **118 days** since creation, oldest **826 days**. Median **22 days**
  since anyone touched them, longest **723 days** without an update.
- **Nothing chases them.** **1 of the 60** carries a due date.
- **The title does not save you.** Only **14 of the 60** name a vendor word anywhere in the
  summary.

One status cannot hold two independent facts. **Rung is where the work is; blocked is whether it
can move.** Multiply them into one dropdown and you get 4 rungs × 8 blockers = 32 statuses, or
you get what exists today: the blocker wins and the rung is thrown away.

The flag also buys the PMO its one honest weekly sentence — *of the N pairs at STG/TEST, M are
flagged, and here is who each is waiting on* — which literally cannot be said from the current
data.

### 5.4 Definition of done, per rung

**Intake → DEV.** An OB Account Manager is the named assignee. The interface checklist is
instantiated on the ticket. The organization's NHIC ORG ID is recorded.

**DEV → STG/TEST.** At least one message of **this specific use case** accepted at the DEV
endpoint, with the reference on the ticket. Sending application and source-entity lines on the
checklist filled.

**STG/TEST → COC.** The checklist for this ticket reads **All Completed**. The agreed conformance
test set for this use case has passed in staging. Any IP whitelisting is done — a live blocker
class (10 open tickets by title, plus the `Whitelisting` label on 16) whose purpose-built field,
`Public IP`, is filled on **14 of 2,971**; the checklist's *Source System Public IP* line is the
field that will actually be used.

**COC → PROD.** A Certificate of Completion, signed by CHI, is on file **for this exact (organization, use
case) pair**, with its reference recorded and `COC Status` set to `Passed` or `Passed with
conditions`. **A conformance certificate for a sibling use case does not promote this one.**

**PROD → Closed, Resolution = `Live`.** All six of:

1. COC on file for this pair.
2. Production endpoint exchanging this use case's messages with the hospital's **production**
   HIS, with at least one successfully accepted message **per required message type** for that
   use case — for ADT that includes the A08 encounter message already named in the existing
   checklist — within the last **5 consecutive business days**.
3. **Scope is unrestricted. Pilot is not live.** 42 tickets say "pilot"; a pilot is a ticket
   sitting at `PROD` with a comment naming the restriction, never a closed ticket.
4. The support owner for run-state is named and `Nphies Groups` is set for routing.
5. `Flagged` is cleared.
6. The closing comment names the go-live date in one line.

Anything less than all six and the record stays at `PROD`. **"Nearly live" is a flagged PROD
ticket, not a closed one.**

### 5.5 On the ten-day-per-rung budget

Configure it — the owner asked for 10 days per rung, configurable — but **do not present it as
observed.** The only end-to-end evidence in the file: of the pipe-convention tickets, **43 have
ever been resolved, at a median of 43 days each**; across all 2,165 resolved tickets the median
is **55 days**, with the slowest tenth above **361 days**. Four rungs × 10 days = 40 days end to
end would be faster than any single onboarding ticket has historically been.

And there is nothing to compute against today: **89 of 2,971 tickets carry a due date, 3 of the
828 open ones do, 0 of the 552 open onboarding ones do.** So the budget is computed from the
**status-transition timestamps the workflow generates automatically**, and the `Due date` field
is **written by automation on every rung transition and never typed by a person** (§6.6, rule
A2). Asking humans for dates has already been tried in this instance, and 3 of 828 is the
result.

### 5.6 What an OB Account Manager does differently on Monday morning

Five things. Three of them take under a minute.

1. **Open the pair queue instead of the inbox.**
   `project = NONP AND issuetype = Onboarding AND assignee = currentUser() ORDER BY status`.
   *One saved filter, made once, by the PMO — not by them.*
2. **When a rung's evidence arrives, drag the ticket to the next rung.** Once, on the day it
   happens. *~30 seconds. A pair produces four of these in its entire life.*
3. **When you cannot act because someone else must act: set the flag, pick who you are waiting
   on, put a date on it.** Three clicks, no typing except the date. *~45 seconds — and this
   **replaces** changing the status to "Pending on Vendor", so it is not additional work.*
4. **When they answer, clear the flag.** *~10 seconds.*
5. **Never open a second ticket for a pair that already has one.** Comment on the existing
   record, or link the operational ticket to it. Stage requests, whitelisting requests and SSO
   tickets stay separate Service requests — they just get **linked**.

**And four things they stop doing:** stop typing environment words into titles (126 tickets say
prod/production/live, 49 say COC, 9 say DEV — all of it moves into the status); stop inventing
title formats (there are thirteen); stop filling `Resolved confirmation`; stop using `Resolved`
and `Closed` as though they differ.

**The honest cost.** Per account manager, roughly **10–20 minutes a week** of recording,
assuming ~15 pair-events touched. The real costs are elsewhere and are not small:

- **Everyone's queue gets worse-looking overnight.** Creating the full universe at `Intake` adds
  **773 tickets naming pairs nobody has ever written down.** That is not new work; it is newly
  visible work. **Say so before the import, not after**, or the first reaction will be that the
  process invented 773 problems.
- **The migration is manual where it matters.** 922 pair-naming tickets need an organization and
  a use case; ~149 duplicate sets need merging; **every V1/V2 decision is made by hand**, because
  the history contains 0 tickets saying V1.
- **The load is not evenly spread.** Four people hold 435 of the 552 open onboarding tickets,
  and 245 of those 552 are more than a year old. A real fraction of the first pass is deciding
  what is actually dead — a judgement call, not data entry.

---

## 6 · The Jira configuration

Project key **NONP**. Every field named below was checked against the safe projection and every
fill count is stated with its denominator.

### 6.1 The mandatory field set — seven fields, none of them new

**All seven already exist in this Jira. Six of them are filled on 0 of 2,971 rows. Only three
are ever typed by a human, and all three are picks.**

| # | Field | Label displayed | Fact it carries | Filled today | Type | Required when |
|---|---|---|---|---|---|---|
| 1 | `Components` (system) | Organization / المنشأة | Which organization | n/a (system) | Multi-select, exactly one enforced | **At creation** |
| 2 | `Custom field (Nphies Use Case)` | Use Case / حالة الاستخدام | Which use case | 0 of 2,971 | Single select | **At creation** |
| 3 | `Custom field (Account Manager)` | OB Account Manager / مدير حساب التهيئة | Who is accountable for this pair across all four rungs | 0 of 2,971 | User picker | **At creation** |
| 4 | `Due date` (system) | Target date — current rung | When this rung is due | 89 of 2,971; 3 of the 828 open | Date | **Never typed. Written by automation A2 on every rung transition.** |
| 5 | `Custom field (COC Status)` | COC Status / حالة شهادة المطابقة | The external conformance verdict | 0 of 2,971 | Single select: `Not Submitted`, `Submitted`, `Passed`, `Passed with conditions`, `Failed` | **At transition** into and out of `COC` |
| 6 | `Custom field (Baseline end date)` | Go-live date (committed) | The promised go-live | 0 of 2,971 | Date | **At transition** `COC → PROD` |
| 7 | `Custom field (Action Pending With)` | Action Pending With / الإجراء لدى | Who the record is waiting on | 0 of 2,971 | Single select (§5.3) | **Whenever `Flagged` is set** |

Plus `Resolution`, whose option list is replaced per §4.4.

**Why each survived the cut.**

- **Organization and Use Case** are the identity of the record. Without them it is not
  addressable and "one ticket per pair" is unenforceable. Non-negotiable.
- **OB Account Manager is not redundant with `Assignee`.** Assignee is warm — 2,955 of 2,971,
  with 8 of the 828 open tickets unassigned — but it names whoever is working *the current rung*,
  and `Nphies Groups` shows six different groups touching this work (533 / 480 / 444 / 331 /
  278 / 252 across 2,386 filled rows), so the assignee changes as a record climbs. The pair needs
  one name that survives the handoffs. Requiring it at creation also surfaces the **42
  organizations with no owner** at the moment someone tries to file work against them, instead
  of silently.
- **Due date** is the only date field the instance can compute a rung budget against, and it is
  JQL-native, board-native and SLA-native. It is required *of automation*, never of a person.
- **COC Status** is the one fact on the ladder that is a verdict rather than a position, and the
  instance's history of writing `Done` on all 2,165 closed tickets shows that a verdict you do
  not ask for at the gate is a verdict you never learn.
- **Baseline end date** is the commitment, required at `COC → PROD` — the first moment a go-live
  date is real rather than aspirational. Chosen over `Target start`/`Target end` (Advanced
  Roadmaps fields, not to be hand-edited) and over `Planned end date` (a duplicate concept in
  this instance's field list).
- **Action Pending With** buys the single largest missing fact in the open backlog: **683 of the
  828 open tickets say nothing about why they are stuck.** Required only while flagged, so a
  healthy record never sees it.

**Considered and deliberately rejected — all of these exist and all are empty; leaving them
empty is the recommendation.**

- `Delivery status` — the same fact as the workflow status. Never ask a human; mirror it with
  automation A3 so legacy reports keep working.
- `Delivery progress`, `Checklist Progress %`, `Task progress` — percentages of an undefined
  denominator. **The rung is the progress.**
- `Conformance Status 1` … `Conformance Status 17` — seventeen fields, 0 filled cells across
  all 17 × 2,971. One verdict field replaces all seventeen. Hide now; delete after `COC Status`
  has been live one quarter.
- `Baseline start date`, `Actual start date`, `Actual end date`, `Building Interface Start Date`,
  `Building Interface Complete Date` — the transition history already records when each rung
  started and ended, for free, and cannot be forgotten. Use `status CHANGED` JQL and Time in
  Status instead.
- `Application Environment`, `Environments`, `Environment`, `Stage` — `Environments` is filled on
  all 2,971 rows with platform tenants (OnboardA 1,849 / Staging 1,065 / OnboardB 57), not the
  ladder; `Application Environment` is filled on 1,274 rows and every one says `Production`;
  `Stage` is filled on 0 of 2,971, which is the entire argument for putting the ladder in the
  *status* rather than in a field, said in one measurement.
- `Public IP` — **not mandatory**, but present as an optional prompt on the `DEV → STG/TEST`
  transition screen. An optional prompt at the exact moment it matters is worth more than a
  required field at creation.
- `Facility Name`, `Select Facility Name`, `Participant Organization`, `Client`, `Cluster`,
  `Cluster Name` — six empty fields competing to be the organization field. Pick `Components` and
  **hide all six**, or the next person fills in a different one.

### 6.2 Organization → project `Components`

**One component per organization, 161 of them.**

Why the system field rather than a custom select:

- **JQL-native** (`component = "…"`, `component IS EMPTY`), requirable in a field configuration,
  bulk-editable, and on every board, filter and dashboard without a new field ID.
- **Every component has a Component Lead.** The **42 organizations with no owner** become 42
  components with an empty lead — one screen that reads as a to-do list rather than as a
  statistic. Component Lead also sets the default assignee.
- Components are shared by all issue types, so the 2,049 operational tickets *may optionally*
  name an organization without any of them being required to.
- **No new custom field is created**, which is the point of the whole exercise.

Configuration: **Name** is the canonical English string, kept stable forever because it is the
JQL key (`Aljedaani Hospital`). **Description** is the Arabic name of the organization — Arabic
belongs in the record, and the description is the right home because it never becomes a JQL key
that breaks when someone edits a diacritic. **Component Lead** is the OB Account Manager who owns
that organization; **leave it blank for the 42 with no owner** rather than assigning a
placeholder. **Default assignee: Component Lead.** Components allow multiple values, so the
create transition carries a validator requiring exactly one (or automation A1's
`{{issue.components.size}} > 1` check).

**Building the 161-component list is hand work and cannot be automated.** See §7.5.

**Free seed data:** `Related to (migrated)` is filled on 1,940 of 2,971 with 27 values of which
26 are organization names. Those 26 seed the component list and **back-fill 683 tickets by bulk
edit on day one**. The 1,257 rows saying `Lean Business` name the integrator, not a hospital, and
are not seeds.

*If the administrator insists on a strict single-value field:* `Select Facility Name`, empty on
all 2,971 rows, converted to a single-select with the same 161 options. You lose Component Lead
and the 42-orgs view, and that loss is the reason it is the alternative rather than the
recommendation.

### 6.3 Use case → `Custom field (Nphies Use Case)`

Already exists; filled on 0 of 2,971. **Do not create a second one** — `Use Case`, `UseCase` and
`Use Case - Mapping` also exist and are also empty on all 2,971 rows. Hide all three so nobody
picks the wrong one.

**Type: single select. Never text** — free text is what produced thirteen title conventions.
**Context: NONP only, issue type `Onboarding` only.** Bilingual option labels, safe here in a way
they are not for 161 components because the list is short and stable:

```
ADT — التسجيل والدخول والخروج
Medication Prescribe V1 — وصف الدواء (الإصدار الأول)
Medication Prescribe V2 — وصف الدواء (الإصدار الثاني)
Medication Dispense V1 — صرف الدواء (الإصدار الأول)
Medication Dispense V2 — صرف الدواء (الإصدار الثاني)
Rad Report — تقرير الأشعة
Rad Order — طلب الأشعة
Lab Result — نتيجة المختبر
Lab Order — طلب المختبر
Clinical Notes — الملاحظات السريرية
Vital Signs — العلامات الحيوية
```

**The option list is the target universe**, and it is now settled at **eleven** (§10.0 A). Vital
Signs is in: it was already live in the data on 4 pairs, and without an option value those tickets
could not be filed as onboarding records at all. Immunization (8 tickets), Genomics (5),
Consent (4) and NVR (1) are **not** recommended as options: they are operational tickets, they
keep the `Service request` type, and they need no use-case value.

### 6.4 Required-at-transition rules

Mechanism: a field configuration scheme for NONP mapping issue type `Onboarding` to a field
configuration `NONP – Onboarding` and every other issue type to `NONP – Operational`.

In `NONP – Onboarding`, mark **only fields 1, 2 and 3 as Required** — Jira's field-configuration
Required flag applies on every screen the field appears on, so it is the right tool only for
creation-time facts. Everything else is a **workflow validator on a specific transition**, which
is how you get data quality without nagging.

| Transition | Mechanism | Required | Why |
|---|---|---|---|
| Create | Field config | Components (exactly one), Nphies Use Case, Account Manager | The record has no identity and no owner without these three. |
| Create | Automation A1 | — | Duplicate-pair guard. |
| `Intake → DEV` | Validator | Components, Nphies Use Case, Account Manager | Repeats the creation rule, because bulk-imported and bulk-moved issues bypass create screens. |
| `DEV → STG/TEST` | Transition screen | `Public IP` — **optional prompt** | Whitelisting blocks 10 open tickets; the field is filled on 14 of 2,971. Ask when it matters; do not require it. |
| `STG/TEST → COC` | Validator | `COC Status`, and `Checklist Completed = All Completed` | The checklist already exists and already died — 113 of 2,971 reached, 105 of those Not Completed. **Enforcing it at exactly one gate is the difference between a checklist and a decoration.** |
| `COC → PROD` | Validator | `COC Status IN (Passed, Passed with conditions)`, `Baseline end date` | Nothing goes live without a verdict and a committed date. |
| `* → PROD` from anything but `COC` | Condition: hide the transition | — | A record cannot skip the COC rung. Enforced by the workflow graph, not by a rule. |
| `PROD → Closed` | Validator | `Resolution`, `Flagged` empty, closing comment | §5.4. |
| Any → `Closed` from a non-PROD rung | Validator | `Resolution IN (Merged into duplicate, Superseded, Not applicable, Withdrawn)` + comment | ~149 merges are coming; each needs a stated reason. `Live` is unreachable from anywhere but PROD. |
| Set `Flagged` | Automation A5 | `Action Pending With`, `Expected Resolution Date` | 683 of the 828 open tickets currently say nothing about why they are stuck. |
| Any backward transition (`COC → STG/TEST`, `STG/TEST → DEV`) | Transition screen | Comment (required) | **A rung going backwards is the single most informative event in the programme and currently leaves no trace.** |

Deliberately **not** required at any transition: a start date, an actual end date, a progress
percentage, an environment field, or anything with the word Conformance and a number after it.

### 6.5 The compliance JQL

**Two warnings before the queries.**

**(a) Use `cf[id]`, never names, in anything you save.** This instance has duplicate custom field
names: `Nphies Group` twice, `Related to` three times, `Team` twice, `Category` twice, `Impact`
twice, `External issue ID` three times, `Result` twice, `Total Scoring` twice, `Total Technical
Points` twice, `Total Clinical On Boarding Points` twice, plus `Environment` and `Environment `
(trailing space). Name-based JQL against a duplicated name resolves unpredictably.

**(b) JQL has no GROUP BY.** The one-ticket-per-pair contract cannot be expressed as a query.
Query 11 is the closest honest approximation; the real enforcement is automation A1.

```sql
-- 1. Missing organization
project = NONP AND issuetype = Onboarding AND component IS EMPTY ORDER BY created ASC

-- 2. Missing use case
project = NONP AND issuetype = Onboarding AND "Nphies Use Case" IS EMPTY ORDER BY created ASC

-- 3. Missing OB Account Manager
project = NONP AND issuetype = Onboarding AND "Account Manager" IS EMPTY ORDER BY component ASC
-- 3b. Organizations with no owner at all: Project settings > Components, sorted by Lead.
--     42 of 161 organizations have no owner today. This is a screen, not a query.

-- 4. On the ladder with no target date
--    Baseline: 0 of the 552 open onboarding tickets carry a due date, so on day one
--    this returns every migrated record until automation A2 has fired once on each.
project = NONP AND issuetype = Onboarding AND status IN (DEV, "STG/TEST", COC) AND duedate IS EMPTY

-- 5. Rung budget breached
project = NONP AND issuetype = Onboarding AND statusCategory != Done AND duedate < now() ORDER BY duedate ASC

-- 6. Ended without ever reaching PROD
project = NONP AND issuetype = Onboarding AND statusCategory = Done AND status WAS NOT PROD
AND resolution NOT IN ("Merged into duplicate", "Superseded", "Not applicable", "Withdrawn")

-- 7. Rung skipped: at COC without ever having been at STG/TEST
project = NONP AND issuetype = Onboarding AND status = COC AND status WAS NOT "STG/TEST"

-- 8. At COC with no conformance verdict
project = NONP AND issuetype = Onboarding AND status = COC AND "COC Status" IS EMPTY

-- 9. At PROD with no committed go-live date
project = NONP AND issuetype = Onboarding AND status = PROD AND "Baseline end date" IS EMPTY

-- 10. Stuck with no stated reason
--     Baseline: 683 of the 828 open tickets name no blocker in their title today.
project = NONP AND issuetype = Onboarding AND Flagged IS NOT EMPTY AND "Action Pending With" IS EMPTY

-- 11. Duplicate-pair candidates (visual, not automatic — JQL cannot group)
--     Save with exactly two columns: Components, Nphies Use Case. Any two adjacent rows
--     sharing both values are a contract breach. Enforcement lives in automation A1.
project = NONP AND issuetype = Onboarding AND statusCategory != Done
ORDER BY component ASC, "Nphies Use Case" ASC

-- 12. Pairs nobody has said anything about
project = NONP AND issuetype = Onboarding AND status = Intake
--     773 of the 1,449 target pairs land here on day one. That row count is the honest
--     statement of what nobody has said. It is not a count of work not started.

-- 13. Concentration check
project = NONP AND issuetype = Onboarding AND statusCategory != Done ORDER BY assignee ASC
--     Read with the Assignee column, or as an Assignee × Status two-dimensional gadget.
--     Baseline: four people hold 435 of the 552 open onboarding tickets.

-- 14. Migration burn-down: an onboarding-looking ticket that never became a record
project = NONP AND issuetype != Onboarding AND statusCategory != Done
AND (summary ~ "Onboarding" OR summary ~ "Interface Build" OR summary ~ "use case")
--     Should trend to zero and stay there.
```

Save 1, 2, 3, 4, 8, 9, 10 and 11 in a shared `NONP Contract Breaches` folder, and put them on one
dashboard as Filter Results gadgets, **each titled with its denominator** — "No target date —
552 of 552 open records".

### 6.6 Automation worth having

Six rules. **Every one removes a question from a human rather than adding one.**

**A1 — Duplicate-pair guard** (the enforcement that JQL cannot express)
Trigger: issue created, `issuetype = Onboarding`. Lookup issues:
`project = NONP AND issuetype = Onboarding AND statusCategory != Done AND component = "{{issue.components.first.name}}" AND cf[NNNNN] = "{{issue.cf[NNNNN].value}}"`.
If `{{lookupIssues.size}} > 1`: add a `Relates` link to the other record, set `Flagged`, comment
*"Duplicate pair — {{issue.components.first.name}} × {{issue.cf[NNNNN].value}} already has an
open record: {{lookupIssues.first.key}}"*, and assign to that record's OB Account Manager. Also
in this rule: if `{{issue.components.size}} > 1`, comment and flag.

**A1b — the same check on edit.** Same lookup, trigger *Field value changed* on Components or
Nphies Use Case. Without it the guard is bypassed by anyone who creates a record blank and fills
it in afterwards.

**A2 — Rung clock** (the reason nobody types a date)
Trigger: transitioned to `DEV`, `STG/TEST`, `COC` or `PROD`. Action: `Due date =
{{now.plusBusinessDays(10)}}` (fall back to `{{now.plusDays(14)}}` if this instance's automation
lacks business days). Branch on destination status so the four budgets are four numbers in one
rule — changing a budget is one edit and no code. Effect: every record on the ladder acquires a
target date, where today 3 of the 828 open tickets have one.

**A3 — Delivery status mirror** (keeps an existing field warm at zero human cost)
Trigger: any ladder transition. Action: `Delivery status = {{issue.status.name}}`; on entering
`PROD`, also `Actual end date = {{now}}`. `Delivery status` exists and is empty on all 2,971
rows; reports that expect a field rather than a status keep working, and no person is ever asked.

**A4 — Title normalizer** (retires thirteen conventions permanently)
Trigger: issue created, or Components / Nphies Use Case changed, on `issuetype = Onboarding`.
Action: `Summary = Onboarding | {{issue.components.first.name}} | {{issue.cf[NNNNN].value}}`.
**Say out loud before switching it on that this overwrites whatever a person typed.** That is the
point — the title is no longer where the record lives — but it surprises people exactly once.

**A5 — Blocked hygiene** (buys the fact 683 of 828 open tickets are missing)
Trigger 1: `Flagged` set. If `Action Pending With` or `Expected Resolution Date` is empty,
comment mentioning the assignee; re-check after one working day and escalate to the OB Account
Manager. Trigger 2: scheduled daily —
`Flagged IS NOT EMPTY AND "Expected Resolution Date" < now()` → comment mentioning the OB
Account Manager. **A blocker whose expected date has passed is a different problem from a
blocker.**

**A6 — Weekly compliance digest, bilingual**
Trigger: scheduled, **Sunday 07:00 Asia/Riyadh** (start of the working week). Run the §6.5
filters via Lookup issues and email the PMO the counts, **each written against its denominator —
`{{lookupIssues.size}} of {{total}}`, never a bare percentage.** Send the body in Arabic and
English. It is the one artefact the whole programme reads every week and the cheapest place to
stop the tracker being entirely English, as all 2,971 of today's summaries are.

**Not recommended as automation:** auto-transitioning a rung from ticket keywords, auto-closing
stale records, auto-assigning by round-robin. The first two invent measurements nobody made; the
third spreads the 435-of-552 concentration around without anyone deciding it should move.

### 6.7 What to do with the 498 empty fields

**Hide all 498 from NONP's screens and contexts. Delete only a named short list. Do not run a
bulk delete.**

Why hiding rather than deleting:

- **Hiding gets the entire benefit.** The harm from an empty field is that a human sees it on a
  screen and either fills it with noise or learns that fields are optional theatre. Removing it
  from the screen and the field configuration ends that harm completely.
- **Deletion in Jira Cloud is permanent, and these fields are instance-wide.** The export is one
  project, but the field list is obviously shared: `School Screening Time to resolution`,
  `Mystery Visitor Time to resolution`, `TAKASI Time to Resolution`, `ICD-10-AM Tenth Edition
  Standards`, `Medical Errors Time to metric` are other teams' fields. A field empty on all
  2,971 NONP tickets may be full elsewhere, and deleting it breaks that team's filters,
  dashboards, boards and automation **silently**.
- Hiding is reversible in one click. Deletion is not reversible at all.

In order:

1. **`NONP – Operational`**: all 498 Hidden, none Required. Mapped to every issue type except
   `Onboarding`.
2. **`NONP – Onboarding`**: same 498 hidden; fields 1, 2, 3 Required; 4, 5, 6, 7 Optional and
   present only on the relevant transition screens.
3. **Trim contexts, not just screens.** For custom fields whose context is global, edit the
   context to exclude NONP. This stops them appearing in the issue navigator's field picker and
   in Automation's field list — which is where the next well-meaning person finds them.
4. **Then delete a specific short list**, checking each field's "Screens and projects used in"
   tab first and deleting only those used nowhere: test debris (`test`, `test1`, `testField`,
   `first (test)`, `seconde (test)`, `Test 26/11/25`, `test SLA level 1`, `Time to resolution
   (Test)`, `Time To resolution test`, `Incident test`); the seventeen `Conformance Status N`
   fields — **but only after `COC Status` has been live one quarter**, so the replacement is
   proven before the originals go; and the duplicate-name fields from §6.5(a), keeping the copy
   with data (`Nphies Groups`, 2,386 rows) and deleting the empty near-duplicates after moving
   `NphiesGroups`' 18 rows across.
5. **Hide but never repurpose the nine constant-valued fields** listed in §3.2. These are the
   dangerous ones: any usage report ranks them as heavily used. Hiding them is what stops the
   *next* redesign from building the ladder on a field where 1,274 rows all say the same word.
6. **Write the rule into the project's admin notes: no new custom field is created for NONP
   without deleting or repurposing one.** 498 empty fields is what the absence of that rule cost.

### 6.8 Order of execution

1. Create issue type `Onboarding` and its workflow (six statuses). Nothing else changes yet.
2. Build the 161 components by hand, Arabic in the description, Component Lead where an owner
   exists.
3. Load the `Nphies Use Case` options — **eleven, Vital Signs included** (§10.0 A). **Settled; before
   loading** (§10).
4. Field configuration scheme: 498 hidden, three required at creation.
5. Validators on the §6.4 transitions.
6. Automation A1–A4. Hold A5 and A6 until real data is flowing.
7. Bulk-move and back-fill the 922 parseable tickets; adjudicate the multi-convention pairs and
   the duplicate summaries by hand; perform ~149 merges with `Resolution = Merged into
   duplicate`.
8. Reconcile the rung-naming operational tickets onto their pairs. **This is the manual step; do
   not promise a script.**
9. CSV-import the 773 never-written pairs at `Intake`.
10. Save the §6.5 filters, build the dashboard, then switch on A5 and A6.
11. One quarter later: delete the test-debris fields, the seventeen Conformance Status fields
    and the duplicate-name fields, checking usage per field.

---

## 7 · The migration

**Definition used throughout:** an onboarding record is a ticket matching one of the **nine
onboarding-shaped conventions** — `Onboarding | Org | Use case`, `Onboarding - Org - Use case`,
`Interface Build - Org - Use case`, `Org - Interface build - Use case`, `Interface Build request
for Org - Use case`, `Interface Bulid/Buid - Org - Use case`, `Interface Development Request -
Org - Use case`, `Stage Request - Org - Use case`, `STG & COC / COC & Stage Request - Org - Use
case`. **922 of 2,971 tickets, carrying 744 distinct pairs.** The four loose patterns are
excluded for the reason given in §3.8.

### 7.1 How many canonical records already effectively exist

**500 of the 744 pairs already have exactly one open ticket.** That ticket *is* the canonical
record; it needs a rung and a re-title, not a rebuild.

| | pairs |
|---|---|
| Exactly one ticket, and it is open — nothing to reconcile | **413** of 744 |
| One open ticket plus one or more closed siblings — the open one survives | **87** of 744 |
| **Pairs already holding exactly one live record** | **500** of 744 |
| Two open tickets — a duplicate live record (§7.2) | 26 of 744 |
| Zero open tickets, all closed (§7.3) | 218 of 744 |

Projected onto the 161 × 9 grid after organization names are resolved to map rows:
**497 of the 1,449 target pairs have an open ticket today.**

The 552 open onboarding tickets sit in three statuses — Open BO 336, Work in progress 185,
Pending on Vendor 31. Median age **289 days**; **495 of 552 older than 90 days, 245 of 552 older
than a year.**

### 7.2 The pairs that must be merged, and the rule

**149 of the 744 pairs carry more than one ticket** — 327 tickets in total, of which **178 are
absorbed.** The distribution is shallow, which is the good news: **124 pairs have 2 tickets, 22
have 3, 2 have 4, and exactly one has 5.** The maximum reconciliation depth anywhere in the file
is five tickets.

| Class | Pairs | Who does it |
|---|---|---|
| One open + closed siblings | **87** of 149 | script |
| All tickets closed (→ §7.3) | **36** of 149 | a ruling per pair |
| Two open tickets | **26** of 149 | **human** |

**The merge rule, in order:**

1. **The survivor is the open ticket.** Where exactly one ticket on a pair is open it survives
   regardless of convention or age. Settles **87 of 149** with no judgement.
2. **Where two are open, the survivor is the `Onboarding |` one.** From the data, not from taste:
   median creation date is **9 Feb 2026** for the Onboarding family against **22 May 2025** for
   the Interface Build family. Onboarding titles are the newer, still-open population; Interface
   Build titles are the older, mostly-closed one. Settles **11 of the 26**.
3. **A `Stage Request` / `COC & stage request` / `stage environment` ticket is never a
   survivor.** It is a **rung event, not a record.** Close it and write its rung onto the
   surviving build ticket. Settles **6 of the 26** — *Aseer Care Ware × Clinical Notes*, *Obeid ×
   ADT*, *Aster Sanad × ADT*, *SBAHC × Rad Order*, *SBAHC × Rad Report*, *Alsaedy × Rad Report*.
4. **Same convention, same day, near-identical title = a typo duplicate.** Close the later one.
   Settles **6 of the 26**, including four Dr. Arfan pairs created within two hours of each other
   on 22 May 2025 (`Interface Build - Dr. Arfan hospital - rad report` versus `Interface Build
   -Dr. Arfan hospital - Rad Report`) and *Procare Riyadh × Clinical Notes*, whose two titles
   differ only in a space and a full stop.
5. **The remaining 3 are organization-identity disputes, not ticket disputes** — *King Khalid
   University* versus *King Khalid University (Aseer)*, *Aljadaani (SAFA)* versus *Aljedaani*,
   *Makkah 2 (MCC)* versus *Makkah Cluster 2 (MCC)*. **They cannot be merged until §7.5 is
   settled**, because merging them asserts that two map rows are one hospital.

**How history is preserved.** Do not delete and do not edit the absorbed ticket. For each one:
add a Jira **`Relates`** link from the absorbed ticket to the survivor (that link type is already
in use in this instance); set the absorbed ticket to Closed with `Resolution = Merged into
duplicate`; append one line to the survivor naming the absorbed key and its close date. The
absorbed ticket keeps its Created, Resolved, Time to first response, Time to resolution and
`[CHART] Time in Status` values, **which is the entire reason not to reopen or overwrite it.**

**Never merge by title text alone.** **37 distinct summary strings are exact duplicates of
another summary, covering 77 tickets** — including `Stage Request - Jazan University Hospital -
ADT use case` and `Interface Build- Raqeem- Vital Signs Use case`, each written twice — and some
of those are genuinely different pieces of work. (An earlier pass counted 32 strings over 66
tickets; the later, larger count is used here.)

### 7.3 Pairs whose only tickets are closed

**218 of the 744 pairs have no open ticket** — 182 whose single ticket is closed, plus the 36
where every ticket of several is closed. On the resolved grid this is **179 of 1,449 cells that
have a history and no live record.**

They closed recently, not long ago: **99 of the 218** last closed within 90 days, 47 between 91
and 365 days, 72 more than a year ago. Median resolution date 21 Apr 2026.

**These cannot be read as "went live."** All **370 of the 370 closed onboarding tickets carry
Resolution `Done`**, and no other value has ever been recorded in this instance. Meanwhile the
map records only **170 of its 1,610 use-case cells as `live`** and **37 of 161 organizations at
stage `Live`**. **A closed ticket is evidence that someone stopped working, not that a use case
reached PROD.**

**Recommendation: recreate, do not reopen — with one exception.**

- **Recreate (119 of the 218):** every pair whose last close is older than 90 days. Reopening a
  ticket closed a year ago restarts `Time to resolution` and `[CHART] Time in Status` on a clock
  that has been stopped for a year, and those two fields are among the handful this instance
  actually keeps warm. Create a fresh canonical record, `Relates`-link it to the closed one, and
  start its ladder at the rung the team can attest to.
- **Reopen (99 of the 218):** pairs closed within the last 90 days, where the SLA clock is still
  meaningful and the assignee still remembers the work.

The 90-day split is a script. **The resulting rung on each of the 218 is a human attestation,
because nothing in the file records it.**

### 7.4 The pairs with no ticket at all — the real backlog

**773 of the 1,449 hospital × use-case pairs have never been written in Jira.** Not "not
started" — **never written down at all.**

| | of 1,449 |
|---|---|
| Pairs with an **open** ticket today | **497** |
| Pairs with only **closed** tickets | **179** |
| Pairs ever written, in any state | **676** |
| **Pairs never written** | **773** |

Stated the other way: **952 of the 1,449 pairs have no live record today.**

Coverage by organization, over the eight base use-case families the tracker actually writes:

| Families covered | Organizations |
|---|---|
| 0 of 8 | **36** of 161 |
| 1–3 | 35 of 161 |
| 4–6 | 24 of 161 |
| 7 | 28 of 161 |
| 8 of 8 | 38 of 161 |

**36 of the 161 organizations have never had a single onboarding-shaped ticket written for
them.** 24 of those 36 have a named Account Manager; **12 have no owner at all.**

And the gap is not evenly held:

| Owner | Orgs | Grid (9 each) | Cells ever written | Cells with an open ticket | **Never written** |
|---|---|---|---|---|---|
| **(no owner)** | 42 | 378 | 175 | 126 | **203** |
| Dema Alkassim | 33 | 297 | 134 | 124 | **163** |
| Riam Alnasser | 21 | 189 | 81 | 28 | **108** |
| Sara Alsaab | 21 | 189 | 110 | 107 | **79** |
| Shatha Alhuwaytan | 11 | 99 | 28 | 23 | **71** |
| Khalid Almutairi | 10 | 90 | 38 | 20 | **52** |
| Hind Almubaraki | 10 | 90 | 57 | 37 | **33** |
| Khalid Alghamdi | 5 | 45 | 20 | 10 | **25** |
| 7 others (1–2 orgs each) | 8 | 72 | 33 | 22 | **39** |
| **total** | **161** | **1,449** | **676** | **497** | **773** |

**The single largest holder of the backlog is nobody.** 203 of the 773 unwritten pairs belong to
the 42 organizations with no Account Manager.

*Reconciliation, not relitigation:* the grid above is **161 × 9 = 1,449** as decided. The
enumerated use-case list contains ten names and the map file already has ten use-case columns —
161 × 10 = **1,610**, at which the never-written figure becomes **934 of 1,610**. Separately, the
tracker writes Medication Prescribe and Medication Dispense **without a version on all but 52
tickets and writes "V1" zero times**, so the 142 medication cells covered today cannot be
assigned to V1 or V2 from the data. **One ruling closes both questions** (§10, decision 1).

### 7.5 Organization names a person must settle — the blocking task

**Nothing else in the migration may start until this is done**, because every later step keys on
the organization and a wrong ruling here propagates into 1,449 cells.

**(a) 20 organization names in tickets that match no map row.** As (name — tickets, pairs):
**mecca l** (8, 8) · **private** (10, 7) · **qassim kfshb** (5, 5) · **2 rabet** (4, 4) ·
**king abdullah northern jeddah** (2, 2) · **jeddah oasis changes** (2, 2) · **private tuwaiq**
(2, 2) · **shefa specialized** (2, 2) · **public interface ona onb** (2, 2) · **al salam alahsa**
(1) · **alfalah hospita** (1) · **eastern se** (1) · **mouwasat ption** (1) · **mouwasat se** (1)
· **tuwaiq** (1) · **procare riyadh raqeebuse case** (1) · and four titles beginning "Old closed"
— *old closed ali bin ali*, *old closed alzahraa qatif*, *old closed elite*, *old closed riyadh*
(1 each). Together **48 of the 922 onboarding tickets, on 45 pairs.** Several are clearly
extraction damage (*alfalah hospita*, *mouwasat se*, *eastern se*); several are probably real map
rows under a shorter name (*qassim kfshb* → `KFSHB (Qassim)`; *private* / *private tuwaiq* /
*tuwaiq* → `Raqeem Private` / `Raqeem Private Tuwaiq`; *mecca l* → a Makkah cluster row).
**None of these may be guessed.**

**(b) 6 ticket names within one or two edits of a map row.** `afalah` ~ **Alfalah Hospital** ·
`al ahsa` ~ **Alahsa** · `al hammadi` ~ **AlHammadi Hospital** · `al madinah s` ~ **Al Madinah
Cluster** · `alsalam` ~ **AlSalama (Murjan) Hospital** · `north border` ~ **North Borders**.

**(c) 24 clusters of map rows within two edits of each other — the map contains its own
duplicates.** Same entity, near-certain (a spelling or a vendor suffix only):
`AL Salama Hospital` / `AlSalama (Murgan)Hospital` / `AlSalama (Murjan) Hospital` ·
`Alsaedy Hospital` / `Alsaedy Hospital(CDA)` ·
`Aseer` / `Aseer Cluster` / `Aseer Care ware` / `Aseer (Care Ware) Cluster` / `Aseer (Vida Plus)`
/ `Aseer (Vida Plus) Cluster` — **six rows** ·
`Najran` / `Najran Cluster` / `Najran (Vida plus)` / `Najran specialized hospital` / `Najran
specialized hospital(FHIR)` — **five rows** ·
`Jazan` / `Jazan 1` / `Jazan MCC` / `Jazan Cluster (MCC)` / `Jazan cluster (MedicaCloud)` /
`Jazan University Hospital` — **six rows** ·
`King Khalid uni` / `King Khalid University` / `King Khalid University (Aseer)` ·
`Makkah 2 (MCC)` / `Makkah Cluster 2 (MCC)` · `Jedda Oasis` / `Jeddah Oasis` ·
`My Clinic` / `My Clinica` · `Aloysif Hospital` / `Alyosif Hospital` / `AlYousif` ·
`Arrawdah General Hospital` / `Arrawdah Hospital` ·
`Dr.Suliman Fakeeh Hospital` / `Suliman Fakeeh Hospital` · `SFH` / `SFH (Security Force
Hospital)` · `Al Hasa` / `Alahsa` · `KFSHRC` / `King Faisal Specialist Hospital and Research
Centre (KFSHRC)` · `Al Madinah` / `Al Madinah Cluster` / `Madina cluster` ·
`Magrabi Health Hospital` / `Magrabi Hospital` / `Magrabi Hospital and Centers` ·
`Raqeem` / `Raqeem Private` / `Raqeem Private Tuwaiq` ·
`Aljadaani (SAFA) Hospital` / `Aljedaani Hospital` ·
`Samer Abbas Hospital` / `Samir Abbas Hospital`.

**Do not merge automatically — the algorithm gets these wrong.** A looser rule on this same data
collapsed `KFSHB (Qassim)` into `KFSHRC`, `Rabet` into `Rabia Hospital`, `Aya Hospital` into
`GAMA Hospital`, `Al-anwar hospital` into `Alansari Hospital` and `Hail Cluster` into `Taif
Cluster` — **five different hospitals.** Likewise `Al Zafer Hospital` / `Al Zafer Hospital in
Najran`, `King Abdullah Medical City` / `King Abdullah Medical City- Makkah`, `Qassim (KFSHB)` /
`Qassim University Hospital` and `Taif Cluster` / `Taif University Hospital` are plausibly
distinct sites. Conservative settings give 161 organizations and 744 pairs; the loose setting
gives 149 and 750, and it is wrong.

**Every merge here changes the denominator.** Merging Aseer's six rows into one takes the grid
from 1,449 to 1,404 and moves five organizations out of the zero-coverage list. **That is exactly
why it is a ruling and not a script.**

**(d) 35 of the 161 map organizations are never named by any onboarding-shaped ticket** —
including `Al Madinah`, `Al Zafer Hospital`, `AlYousif`, `Arrawdah General Hospital`,
`Dr.Suliman Fakeeh Hospital`, `GNP`, `Hail Cluster`, `Jeddah Oasis`, `King Abdullah Medical
City`, `My Clinica`, `Qassim (KFSHB)`, `Raqeem`, `Salamat`, `Samir Abbas Hospital`, `SFH`, `Taif
Cluster`, and every `Aseer` / `Najran` / `Jazan` / `King Khalid` variant above. Most are the
duplicate rows in (c) losing to their twin; the remainder are genuinely untouched organizations.

### 7.6 Order of operations, and what it costs in people

**Step 0 — freeze the title format** (day 1, human, ~1 hour). Publish `Onboarding | <map
organization name> | <use case>`. Everything after this depends on it.

**Step 1 — settle organization identity (§7.5). Blocking.** 20 unresolved ticket names, 6
near-matches, 24 candidate duplicate map rows. **This is the only truly blocking human task.**

**Step 2 — scriptable, no judgement, one run:**
- 413 pairs: re-title only.
- 87 merges (one open + closed siblings): `Relates`-link the siblings to the open survivor.
- 6 typo duplicates: close the later, link it.
- Back-fill the resolved organization onto all 922 onboarding tickets. It matters: **420 of the
  552 open onboarding tickets currently name `Lean Business` — the integrator, not the hospital —
  and 111 are empty.**

**Step 3 — human, 20 rulings:** the 26 two-open pairs minus the 6 typo duplicates. 11 resolve by
merge rule 2 in one pass, 6 by rule 3, 3 wait on Step 1.

**Step 4 — human attestation, 218 rulings, batched by Account Manager:** for each closed-only
pair, name the rung the work actually reached. Then script the reopen/recreate split at the
90-day line (99 reopen, 119 recreate).

**Step 5 — scripted bulk creation of the never-written pairs at `Intake`.** *(Roughly 1,100 at
eleven use cases; the exact count is an output of Step 1, not an input — see the banner.)*

**No longer blocked on ownership (§10.0 B).** The 42 organizations with no Account Manager get an
explicit **pending assignment** state rather than a guess or a blank:

- the component's lead is left unset, and every ticket created for one of those organizations
  carries the label `pending-owner`;
- `Action Pending With` is set to the PMO queue, so the work has somewhere to sit rather than
  nowhere;
- the compliance report (§8) counts `pending-owner` as its own line, so the number is visible on
  day one and falls as owners are named.

⚠ **Why not simply leave the assignee blank.** Blank is what 42 of 161 organizations already are,
  and blank is indistinguishable from *nobody has looked yet* — which is precisely how this
  programme arrived at six departments and 119 account managers that were majority-vote readings
  of Jira columns rather than statements anyone made. A state that says "this needs an owner and
  does not have one" is a different assertion from silence, and only one of the two can be
  counted down.

⚠ **And why not guess from the majority assignee.** That rule is exactly what produced the
  unratified owners above. It would be a third layer of derived-fact-presented-as-fact on the
  organizations that have had the least attention — the ones with no owner are the ones nobody has
  been looking at, so a guess there is worth least and costs most.

Still blocked on Step 1: an organization that has not been resolved to a map row cannot have its
tickets created, because the pair would name a hospital that may turn out to be another hospital.

**Step 6 — turn on the compliance report (§8) against the new record.**

**Scriptable: ~1,300 operations.** **Needs a person: 20 organization rulings, 20 duplicate
rulings, 218 rung attestations, 1 V1/V2 ruling — and the 42 owner assignments are no longer on
the critical path (§10.0 B), so they come off this list and become a countdown instead.**

**And one step that no script will do.** §3.4 measured that the pair and the rung live on two
disjoint populations. Back-filling organization and use case therefore gives you **records with
no rung**, and the rung has to be set by a human reading the operational ticket population:
**635 of the 2,049 non-migrated tickets name a rung against 72 of the 922 onboarding tickets.**
Plan this as a one-time reconciliation of roughly 700 operational tickets against roughly 744
pairs. **It is the expensive part of the migration. Do not promise a script.**

### 7.7 What is deliberately NOT migrated

**2,049 of the 2,971 tickets stay exactly where they are.** 1,773 are already closed; **276 are
open.** They are real work and none of it is deleted.

By `Ticket Main Categorization`: Interface 1,592 · SSO 285 · Provider Portal 104 · Message
Exchange 49 · Sehati 10 · Infrastructure 8 · Clinical 1. By issue type: Service request 1,714 ·
Problem 180 · Incident 150 · Test 5. The 276 open ones: Interface 225 · SSO 32 · Provider Portal
16 · Sehati 2 · Message Exchange 1.

**Three tests tell them apart, in order:**

1. **Title convention.** 1,863 of 2,971 summaries match none of the thirteen conventions at all
   (`Request to Update LDX Rad Report Table`, `Fakeeh - IP Whitelisting STG`, `Add Additional
   MMDR Fields to LDX Project Schema`). A further 109 match a convention but name no readable
   pair, and 77 match only the four loose patterns and name an error phrase where an organization
   should be.
2. **Issue type.** All 180 Problems, all 150 Incidents and all 5 Tests are operational by
   construction. **Zero onboarding records are Problems or Incidents.**
3. **`Nphies Groups`.** 250 of the not-migrated tickets sit with AMS and 184 with IT Delivery and
   Solution; only 9 and 19 of those respectively are still open. **AMS and IT Delivery are
   support queues, not the onboarding queue.**

**Where they continue to live:** the same project, the same queues, unchanged. The canonical
record does not absorb them. Where an operational ticket names a pair that now has a record, add
a **`Relates`** link — one-directional, informational — so that "why is this pair stuck" has an
answer without the helpdesk ticket becoming the record.

**This is the boundary that keeps the model honest.** Roughly two of every three tickets in this
project are not the onboarding record. **Any process that treats the project as the record will
be wrong about 2,049 of 2,971 rows.**

---

## 8 · The compliance rules

Fourteen rules. Each names a condition, the person it holds accountable, and the exact sentence
the report prints. **Every printed sentence carries its denominator.** The baselines are what
each rule would print **today**, against pre-migration data — they are the starting line, not a
target.

Where a rule names a person, resolution order is: **the ticket's Assignee → the organization's
Account Manager on the map → the PMO Lead.** **A rule that resolves to nobody is a finding in its
own right** (R5).

---

**R1 · COVERAGE — the pair was never written.**
*Condition:* a cell in the 1,449-cell grid has no ticket in any state, ever.
*Names:* the organization's Account Manager; if none, the PMO Lead by name.
> `Al Hamra Hospital × Lab Order has no ticket in Jira. 773 of 1,449 hospital × use-case pairs have never been written. This one is unowned — no Account Manager is set on the map.`
>
> `مستشفى الحمراء × طلب مختبر: لا توجد تذكرة. 773 من 1,449 زوجًا (مستشفى × حالة استخدام) لم تُكتب قط.`

**Today: 773 of 1,449.** By owner: no owner 203, Dema Alkassim 163, Riam Alnasser 108, Sara
Alsaab 79, Shatha Alhuwaytan 71, Khalid Almutairi 52, Hind Almubaraki 33, Khalid Alghamdi 25,
seven others 39.

---

**R2 · DORMANT — the pair has history but no live record.**
*Condition:* every ticket on the cell is Closed or Resolved, and the map does not record the cell
as `live`. *Names:* the Assignee on the most recently closed ticket.
> `SBAHC × Rad Report has no open ticket; its last ticket closed 118 days ago with Resolution "Done". 179 of 1,449 pairs have a history and no live record. "Done" is the only resolution this tracker has ever written — 370 of 370 closed onboarding tickets carry it — so no rung can be read from the close.`

**Today: 179 of 1,449 grid cells (218 of the 744 pairs).** 99 closed within 90 days, 47 within a
year, 72 longer ago.

---

**R3 · DUPLICATE — the pair has more than one live record.**
*Condition:* a cell has two or more open tickets. Violates *one ticket per pair* directly.
*Names:* both Assignees.
> `Alsaedy Hospital × Lab Result has 2 open tickets. 26 of 744 pairs carry more than one live record. Under the merge rule the "Onboarding |" ticket survives and the other is closed and linked.`

**Today: 26 of 744. Post-migration target: 0**, enforced at creation by automation A1.

---

**R4 · NO RUNG — the record does not say where it is on the ladder.**
*Condition:* an open record whose status is not one of DEV / STG/TEST / COC / PROD (pre-migration:
whose title names no environment word). *Names:* the Assignee.
> `Onboarding | Rabia Hospital | Lab Order is open and names no rung. 531 of 552 open onboarding tickets record no position on DEV → STG/TEST → COC → PROD. The ladder is written on the other population: 635 of the 2,049 operational tickets name a rung, against 72 of the 922 onboarding tickets.`

**Today: 531 of 552.** **DEV, TEST, live and UAT appear on zero of the 922 onboarding tickets.**
**This is the rule the whole migration exists to make satisfiable.**

---

**R5 · UNOWNED — nobody is named.**
*Condition:* an organization on the map with no Account Manager, or an open record with no
Assignee. *Names:* the PMO Lead, explicitly — **an unowned row is the PMO's row until it is given
away.**
> `42 of 161 organizations have no Account Manager on the map, and those 42 hold 203 of the 773 pairs that have never been written. 2 of 552 open onboarding tickets have no assignee. Until an owner is named these belong to Abdulaziz Alsaloom.`

**Today: 42 of 161 organizations; 2 of 552 open tickets.** 12 of the 36 zero-coverage
organizations are also unowned — the compounding case.

---

**R6 · STAGE BUDGET — a rung has been held past its budget.**
*Condition:* days since the current rung was entered exceeds the budget (10 days, configurable).
*Names:* the Assignee.
> `Onboarding | Obeid Hospital | ADT has been at STG/TEST for 34 days against a 10-day budget. 0 of 552 open onboarding tickets carry a due date, so this rule reads the rung-entered timestamp, not Due date.`

**Today this rule cannot fire, and that is the finding.** 552 of 552 open onboarding tickets have
no due date; 89 of 2,971 in the whole instance have one. Until rung-entered timestamps exist the
report prints the proxy: **495 of 552 open onboarding tickets are older than 90 days and 245 of
552 older than a year, against a 10-day-per-rung budget on a four-rung ladder.** After the
migration, automation A2 writes `Due date` on every transition and the rule fires from the
transition history — never from a date somebody was asked to type.

---

**R7 · SILENT — nobody has touched it.**
*Condition:* an open record with no update in 30 days. *Names:* the Assignee.
> `232 of 552 open onboarding tickets have not been updated in 30 days. 56 of 552 have not been updated in 90 days. Median time since last update is 27 days.`

**Today: 232 of 552 at 30 days, 56 of 552 at 90 days.**

---

**R8 · UNEXPLAINED CLOSE — the record closed without saying why.**
*Condition:* a closed record whose Resolution is `Done` and which names no rung reached.
*Names:* the Assignee at close.
> `370 of 370 closed onboarding tickets carry Resolution "Done" and no other value. The tracker has never recorded why anything closed, so 179 of 1,449 pairs cannot be told apart from "live" without asking a person.`

**Today: 370 of 370.** **This rule is designed to become closable**: the moment §4.4's Resolution
options exist, a close without a reason is impossible and this rule becomes a real gate rather
than an epitaph.

---

**R9 · UNMAPPED ORGANIZATION — the ticket names a hospital that is not on the map.**
*Condition:* a ticket's organization does not resolve to one of the 161 map rows.
*Names:* the PMO Lead — this is a map decision, not an OB Account Manager decision.
> `20 of the 151 organization names written in onboarding tickets match no organization on the map, covering 48 of 922 tickets and 45 pairs — including "mecca l" (8 tickets), "private" (10 tickets), "qassim kfshb" (5 tickets). A further 6 names sit within two edits of a map row, and 24 clusters of map rows sit within two edits of each other. None may be merged automatically: the same algorithm at a looser setting merged KFSHB into KFSHRC, Rabet into Rabia and Aya into GAMA.`

**Today: 20 of 151 names unmatched, 6 near-matches, 24 candidate duplicate map-row clusters, 35
of 161 map organizations never named.**

---

**R10 · CONCENTRATION — one person holds too much.**
*Condition:* an OB Account Manager holds more open records than the threshold (default 60).
*Names:* the person and their manager.
> `Dema Alkassim holds 162 of the 552 open onboarding tickets. Sara Alsaab holds 137, Hind Almubaraki 72, Riam Alnasser 64. Four people hold 435 of the 552 open onboarding records, and the same four are the Account Managers for 85 of the 161 organizations.`

**Today: 435 of 552 on four people.** Twelve people hold the remaining 117; 2 tickets have no
assignee. Instance-wide the same shape holds: 36 people hold the 828 open tickets and the top
four hold 526 (178, 153, 104, 91).

---

**R11 · WAITING ON SOMEONE OUTSIDE — the record is blocked.**
*Condition:* `Flagged` is set (pre-migration: status is `Pending on Vendor` or `Pending on
Production`). *Names:* the Assignee, and the value of `Action Pending With`.
> `31 of 552 open onboarding tickets sit in status "Pending on Vendor". Status is the reliable signal here: 60 of 2,971 tickets across the instance carry that status, while only 17 titles say "vendor".`

**Today: 31 of 552 open onboarding tickets; 29 more among the 2,049 not migrated.** After the
migration this rule reports the rung *and* the blocker together — `of the N records at STG/TEST,
M are flagged, and here is who each is waiting on` — the sentence that cannot be said from
today's data at all.

---

**R12 · CHECKLIST NOT STARTED — the checklist that already exists is not filled.**
*Condition:* an open record with an empty `Checklist Content YAML`. *Names:* the Assignee.
> `550 of 552 open onboarding tickets have no interface checklist. The checklist already exists in this Jira — "Nphies_Interface_development_checklist" (Source Entity Name, Source System Public IP, Sending Application, Source System NHIC ORG ID, ADT A08 Encounter …) — and reached 113 of 2,971 tickets, of which 105 are marked Not Completed and 9 All Completed.`

**Today: 550 of 552.** The checklist is the right shape and it died once, because nothing
depended on it. **The `STG/TEST → COC` validator is what keeps it alive the second time.**

---

**R13 · WRONG ORGANIZATION — the record does not name its hospital.**
*Condition:* an `Onboarding` record with no component (pre-migration: `Related to (migrated)`
empty or saying `Lean Business`). *Names:* the Assignee.
> `531 of 552 open onboarding tickets do not name their hospital in an organization field: 420 say "Lean Business" (the integrator) and 111 are empty. That field is filled on 1,940 of 2,971 tickets across the instance and 26 of its 27 values are organization names — it is the closest thing to an Organization field this Jira has today, and it is being replaced by Components.`

**Today: 531 of 552.** Post-migration the condition is `component IS EMPTY`, which the creation
validator makes unreachable — so this rule's real job after go-live is catching bulk imports and
bulk moves, which bypass create screens.

---

**R14 · SCOPE GUARD — operational work is not being turned into records.**
*Condition:* a ticket outside the canonical set has been re-titled into the `Onboarding |`
convention without an organization that resolves to the map, or an Incident/Problem has been
re-typed as an onboarding record. *Names:* whoever made the change.
> `2,049 of 2,971 tickets are support, SSO, whitelisting, errors and configuration — not onboarding. 276 of them are open and they stay in their own queues. 0 of them have been converted into onboarding records this period.`

**Today: 2,049 of 2,971 outside the record, 276 of them open; 0 conversions.** **This rule
protects the denominator.** Without it, "1,449 pairs covered" can be reached by relabelling
helpdesk tickets.

---

### What the report says on its first run, in one paragraph

> 497 of 1,449 hospital × use-case pairs have a live record. 179 have a closed record and no live
> one. **773 have never been written at all** — 203 of them belonging to the 42 of 161
> organizations that have no Account Manager. Of the 552 open onboarding tickets, 531 name no
> rung, 552 carry no due date, 550 have no checklist, and 435 are held by four people. Nothing
> here is a percentage, and nothing here is a zero measurement: an unwritten pair is a pair
> nobody has said anything about.

---

## 9 · The announcement

> **DEFERRED (25 Aug 2026).** Kept as drafted because it gives the process a concrete shape and
> was useful for that. It is not the next thing to act on, and its three dates are placeholders.

Three artefacts, ready to send once §10's decisions are made and the three dates are confirmed.
**The Arabic is the original, not a translation of the English** — send both.

### 9.1 النسخة العربية

**الموضوع: تذكرة واحدة لكل منشأة ولكل حالة استخدام — تبدأ الأحد ٦ سبتمبر**

الزملاء في فريق OB Account Managers، والمدراء المشاركين (Associate Directors)، والفريق التقني،

#### ما الذي يتغير
- سجل الـ onboarding يصير **تذكرة واحدة لكل (منشأة × حالة استخدام)**، تُفتح من بداية العمل وتبقى مفتوحة حتى الـ go-live. ما نفتح تذكرة ثانية لنفس الزوج أبداً.
- نوع تذاكر جديد في NONP اسمه `Onboarding`، فيه حقلان إلزاميان فقط، والاثنان قوائم اختيار: **المنشأة / Organization** و **حالة الاستخدام / Use case**. العنوان يتولّد منهما: `Onboarding | المنشأة | حالة الاستخدام`.
- الحالات صارت السلّم اللي نقوله أصلاً كل يوم: **Intake** ثم **DEV** ثم **STG/TEST** ثم **COC** ثم **PROD** ثم **Closed**.
- **التعليق (blocked) صار علامة، مو حالة.** ترفع Flag، وتختار "بانتظار مَن"، وتحط تاريخاً متوقعاً — والتذكرة **تبقى في درجتها**. حالة Pending on Vendor تتقاعد.
- التذكرة ما تُقفل إلا من PROD، وبسبب مكتوب في Resolution: ‏`Live` أو `Superseded` أو `Not applicable` أو `Withdrawn`. وما نقفل تذكرة لأنها ساكنة.
- هذا كله على نوع `Onboarding` فقط. تذاكر الدعم والـ Incident والـ Problem ما تغيّر فيها شيء.

#### من متى
- **الخميس ٣ سبتمبر**: يكتمل الإعداد في Jira.
- **الأحد ٦ سبتمبر**: أي عمل onboarding جديد يبدأ على النظام الجديد.
- **الخميس ١ أكتوبر**: كل تذكرة onboarding مفتوحة اليوم تكون محوّلة — منشأة وحالة استخدام ودرجة صحيحة، والمكرر مدموج في تذكرة واحدة.

#### وش يتغير في يومك
1. تفتح قائمة الأزواج بدل الإنبوكس — فلتر محفوظ نجهزه لكم، ما تبنونه بأنفسكم.
2. أول ما يوصل دليل الدرجة، تسحب التذكرة للدرجة اللي بعدها. أربع مرات في عمر التذكرة كاملاً.
3. إذا وقف شغلك على غيرك: Flag + بانتظار مَن + تاريخ. ثلاث ضغطات، بدل تغيير الحالة.
4. أول ما يردّون، تشيل الـ Flag.
5. نوقف كتابة أسماء البيئات في العناوين — البيئة صارت هي الحالة.

توقّعوا أن الطوابير تكبر شكلياً أول أسبوع: بنفتح الأزواج اللي ما كُتبت في تاريخ التراكر كله. هذا شغل صار **ظاهراً**، مو شغل جديد.

#### ليش
اليوم ما نقدر نجاوب "وين وصلت منشأة فلان في Lab Order؟" إلا بالسؤال عن شخص. في المشروع ٥٣٣ حقل مخصص، ٤٩٨ منها ما امتلأ ولا مرة واحدة — فالجواب يعيش في رؤوس الناس وفي المحادثات. لذلك ما نطلب هالمرة إلا اختيارين من قائمة وسحبة واحدة، ولا شيء غيرها. وأي حقل منها ما يُستخدم فعلاً، نحذفه ولا نعيد طلبه.

**الأسئلة**: قناة *NPHIES Onboarding* على Teams، أو الساعة المفتوحة كل أحد ١١:٠٠–١٢:٠٠. وإذا كان السؤال عن تذكرة بعينها، اكتبه في التذكرة نفسها.

عبدالعزيز السلوم — قائد مكتب إدارة المشاريع

### 9.2 English version

**Subject: One ticket per hospital per use case — starting Sunday 6 September**

OB Account Managers, Associate Directors, technical team,

#### What changes
- The onboarding record becomes **one ticket per (hospital × use case)**, opened at initiation
  and kept open until go-live. We never open a second ticket for a pair that already has one.
- A new issue type in NONP called `Onboarding`, with exactly two mandatory fields, both
  dropdowns: **Organization / المنشأة** and **Use case / حالة الاستخدام**. The title is generated
  from them: `Onboarding | Organization | Use case`.
- Statuses are the ladder we already say out loud: **Intake → DEV → STG/TEST → COC → PROD →
  Closed**.
- **Blocked is a flag, not a status.** Raise the flag, pick who you are waiting on, add an
  expected date — and the ticket **keeps its rung**. Pending on Vendor retires.
- A ticket closes only from PROD, and only with a Resolution that says why: `Live`, `Superseded`,
  `Not applicable`, `Withdrawn`. Nothing is closed for being quiet.
- All of this applies to `Onboarding` tickets only. Service requests, Incidents and Problems are
  untouched.

#### From when
- **Thursday 3 September** — Jira configuration complete.
- **Sunday 6 September** — all new onboarding work starts on the new type.
- **Thursday 1 October** — every currently open onboarding ticket migrated: organization, use
  case and correct rung set, duplicates merged into one.

#### What you do differently
1. Open your pair queue instead of your inbox — a saved filter we build for you.
2. When a rung's evidence arrives, drag the ticket to the next rung. Four times in a ticket's
   whole life.
3. When you are waiting on someone else: flag + who + date. Three clicks, instead of changing the
   status.
4. When they answer, clear the flag.
5. Stop putting environment words in titles — the environment is now the status.

Expect queues to look bigger in week one: we are creating the pairs nobody has ever written down.
That is work becoming **visible**, not new work.

#### Why
Today we cannot answer "where is this hospital on Lab Order?" without asking a person. This
project has 533 custom fields and 498 of them have never been filled once — so the answer lives
in people's heads and in chat threads. This time we ask for two dropdown picks and one drag, and
nothing else. Any field here that goes unused gets deleted, not re-requested.

**Questions**: the *NPHIES Onboarding* channel on Teams, or open hour every Sunday 11:00–12:00.
If it is about one specific ticket, ask it on that ticket.

Abdulaziz Alsaloom — PMO Lead

### 9.3 WhatsApp — نسخة الفقرة الواحدة

**عربي:** من الأحد ٦ سبتمبر، سجل الـ onboarding يصير **تذكرة واحدة لكل منشأة ولكل حالة استخدام**، تُفتح من البداية وتبقى مفتوحة حتى الـ go-live — نوع تذاكر جديد اسمه `Onboarding` فيه حقلان إلزاميان من قائمة (المنشأة وحالة الاستخدام)، وحالاته هي السلّم اللي نقوله أصلاً: Intake ثم DEV ثم STG/TEST ثم COC ثم PROD ثم Closed. إذا وقف شغلك على غيرك، ارفع Flag وحدد بانتظار مَن وتاريخاً متوقعاً — والتذكرة تبقى في درجتها؛ وما تُقفل إلا من PROD وبسبب مكتوب. المطلوب منكم: اختياران من قائمة عند الفتح، وسحبة للدرجة الجاية أول ما يوصل دليلها، وما نفتح تذكرة ثانية لنفس الزوج. توقّعوا الطوابير تكبر شكلياً أول أسبوع لأننا بنفتح الأزواج اللي ما كُتبت من قبل — شغل ظاهر، مو جديد. السبب باختصار: اليوم ما نقدر نعرف وين وصلت أي منشأة إلا بالسؤال عن شخص. المهلة: التحويل يكتمل الخميس ١ أكتوبر. الأسئلة على قناة NPHIES Onboarding في Teams أو الساعة المفتوحة كل أحد ١١–١٢.

**English:** From Sunday 6 September, the onboarding record becomes **one ticket per hospital per use case**, opened at initiation and kept open until go-live — a new `Onboarding` issue type with two mandatory dropdowns (Organization, Use case), and statuses that are the ladder we already use: Intake → DEV → STG/TEST → COC → PROD → Closed. If you are waiting on someone else, raise the flag, name who and a date — the ticket keeps its rung; it closes only from PROD, only with a reason. What we ask of you: two dropdown picks at creation, one drag when a rung's evidence arrives, and never a second ticket for a pair that already has one. Queues will look bigger in week one because we are creating the pairs nobody ever wrote down — visible work, not new work. The reason, plainly: today nobody can say where a hospital stands without asking a person. Migration of open tickets completes Thursday 1 October. Questions: NPHIES Onboarding channel on Teams, or open hour Sundays 11:00–12:00.

---

**Before sending, confirm three things: the three dates (3 Sep, 6 Sep, 1 Oct), the Teams channel
name, and the open-hour slot.** Everything else is copy-ready. One caveat on the dates: §7.6
makes the organization ruling (§7.5) blocking, and 1 October assumes it is finished in the first
half of September. If the ruling slips, the 1 October date slips with it — the announcement
should not promise a migration date that depends on a decision not yet made.

---

## 10 · Open decisions for the owner

### 10.0 Settled on 25 August 2026

Three of the nine are now answered, and they change the grid.

**A · The use-case list is ELEVEN.** The owner's list was ten — ADT, Medication Prescribe V1 and
V2, Medication Dispense V1 and V2, Rad Report, Rad Order, Lab Result, Lab Order, Clinical Notes —
and **Vital Signs is an eleventh, confirmed as a real use case** rather than an artefact. It was
already live in the data on 4 pairs. So the grid is **161 × 11 = 1,771**, not 1,449.

⚠ **The backlog figure cannot be stated precisely yet, and this document should stop implying it
  can.** Two independent passes over the same file counted 676 and 610 written pairs, and the gap
  is entirely the normalisation of hospital names — which is decision 6 below. There are 24
  clusters of duplicate map rows and about 20 ticket names matching no row, and **every merge
  changes the denominator**. The honest statement today is **roughly 1,100 of the 1,771 pairs have
  never been written down**, and the exact number is an output of the identity rulings, not an
  input to them. Every "773 of 1,449" below is superseded by that sentence.

**B · The 42 organizations with no Account Manager get an explicit state, not a guess.** They are
marked **pending assignment of an account manager** — a named, visible, countable state. Not left
blank, because blank is indistinguishable from nobody-has-looked; and not guessed from the
majority Jira assignee, because that is how the six departments and 119 owners became facts nobody
stated. Their tickets are created on schedule with the component lead unset and the pending marker
on, so the backlog is visible from day one and shrinks as owners are named.

**C · The announcement is deferred.** §9 stays in this document as drafted, and is not the next
thing to act on. It was written to give the process a concrete shape, and its three dates remain
unconfirmed placeholders.

### 10.0b Settled later the same day

**D · The organization rulings are made** — see [`ORG-RULINGS.md`](./ORG-RULINGS.md). Aseer splits
into two by system; Najran into a cluster and a specialized hospital; AlSalama merges to one; all
of section A and all of section B1 merge. **Jazan is deferred** pending whether MCC and
MedicaCloud are one vendor. 161 organizations become **141**, and the grid becomes **1,551**.

**E · V1 versus V2 → default to V1.** History cannot answer it (52 tickets say V2, none say V1),
so every migrated medication record starts at V1 and is corrected when an OB Account Manager
touches it.

**F · The entry status is `Intake`.**

**G · `NONP` keeps its name.** It is the same space; the code was changed for a period. The PROD
rung lives here, and that is now written down rather than assumed.

**H · The stage budget is 10 days per rung, uniform.** The owner's reason is the right one and is
worth preserving: *"10 days is better because it's measurable, and we don't have the actual
reasonable duration."* It is a measuring stick, not a forecast. The only historical evidence says
four rungs at 10 days would be faster end to end than any onboarding ticket has ever been — 43
tickets have resolved, at a median of 43 days each — so the first weeks will flag a great many
records, and that is the instrument working rather than the programme failing.

### 10.1 Still open

Two questions remain. Each is phrased so it can be
answered in one line.

1. ~~**Is the use-case option list 9 items or 10?**~~ **SETTLED — eleven, see 10.0 A.**
   Original text: The decided list reads ADT, Medication
   Prescribe V1, Medication Prescribe V2, Medication Dispense V1, Medication Dispense V2, Rad
   Report, Rad Order, Lab Result, Lab Order, Clinical Notes — **that is ten entries**, while the
   target universe was stated as 161 × 9 = 1,449. **The option list *is* the target universe.**
   161 × 10 = 1,610, at which "never written" becomes 934 of 1,610 instead of 773 of 1,449.

2. ~~**Vital Signs — in or out?**~~ **SETTLED — in, see 10.0 A.**
   Original text: It is already live in the data: **36 tickets, 4 distinct pairs.**
   Without an option value those 36 tickets cannot be filed as onboarding records at all. In
   makes the grid 161 × 11 = 1,771. (Immunization 8, Genomics 5, Consent 4 and NVR 1 stay
   operational and need no answer.)

3. **V1 versus V2 on the ~142 covered medication cells — default or attest?** The tracker writes
   **52 tickets saying V2 and zero saying V1**, so history cannot answer it. Either every migrated
   medication record is defaulted to one version and corrected later, or an OB Account Manager
   picks each one by hand.

4. ~~**Who owns the 42 organizations with no Account Manager?**~~ **SETTLED — see 10.0 B.**
   Original text: They hold **203 of the 773
   never-written pairs** — the single largest block of the backlog. §7.6 Step 5 is blocked on this
   because otherwise 203 tickets are created unassigned.

5. **`Intake` or `Not Recorded` as the name of the entry status?** This document uses `Intake`
   because the announcement already says it in both languages. `Not Recorded` states the meaning
   more literally. **One word, three places.**

6. **The organization identity rulings — who signs them, and when?** 20 unmatched ticket names, 6
   near-matches, **24 clusters of duplicate map rows** (§7.5). It is the only blocking task in the
   migration, and **every merge changes the denominator**: collapsing Aseer's six rows alone takes
   the grid from 1,449 to 1,404.

7. ~~**Are the three announcement dates confirmed**~~ **DEFERRED with §9, see 10.0 C.** Original: — 3 September, 6 September, 1 October?** Plus the
   Teams channel name and the Sunday open-hour slot. The 1 October date depends on decision 6.

8. **The project is keyed `NONP` and named "Nphies Non prod", and 9 of 2,971 rows link out to a
   different project, `PGCJ`.** A contract that runs "from initiation to go-live" ends its life at
   a PROD rung inside a project whose name says non-prod. **Either the project is renamed, or the
   PROD rung and its closure are explicitly agreed to live here.** Worth settling before 1,449
   records are created in it.

9. **Is the stage budget 10 days per rung, uniformly?** It is configurable per rung in automation
   A2 at no extra cost. The only historical evidence says four rungs at 10 days would be faster
   end-to-end than any onboarding ticket has ever been: 43 pipe-convention tickets have ever
   resolved, at a **median of 43 days each**, and the instance-wide median is **55 days** with the
   slowest tenth above **361 days**.

---

## 11 · OB monitoring in the PMO dashboard

Decided with the owner on 25 August 2026. This replaces the Delivery tab's current shape, which
is one row per organization carrying stage, days-in-stage, owner and an open count — and **no use
case dimension at all**, which the new model makes the atom.

### 11.1 What it answers first

**What is stuck right now.** Not coverage, not the weekly delta, not load — those are all on the
page, below. The section opens with the exception list, because that is what the owner opens it
to find. A dashboard whose first screen is a progress bar is a dashboard people stop opening.

### 11.2 The row is a hospital

**141 rows, one per organization, each carrying its eleven use cases as a strip of rung markers.**

The atom is (hospital × use case) and there are 1,551 of them, which is more than anyone reads.
One row per use case would answer "how is Lab Order going" and lose the hospital; the full grid
answers neither question, it only shows patterns. A hospital row with eleven markers on it is a
whole picture on one line, and the cell is where you drill.

### 11.3 What raises a flag — five things, and the fifth is not like the others

1. **Flagged as blocked.** Somebody raised the flag and named who they are waiting on. Sixty open
   tickets sit at `Pending on Vendor` today and nothing anywhere surfaces them.
2. **Past its 10-day rung budget.** Only meaningful once people move rungs — it cannot fire on
   imported data, and `portfolio/fields.ts` refuses to let it.
3. **No owner.** The hospital is pending assignment of an OB Account Manager. Forty-two today,
   holding the largest single block of never-started records.
4. **Gone quiet.** No movement and no comment for N days, at any rung. This is the one that will
   fire immediately and honestly: the median open ticket is 216 days old and 261 are over a year.

5. ⚠ **AT COC — HIGHLIGHTED SEPARATELY, AND NOT AS A FAULT.**

   COC is the Certificate of **Completion**, signed by **CHI**, the client. Three consequences,
   and they are why this is its own channel rather than a fifth reason a row turns amber:

   - **The waiting party is outside the programme.** Nobody on this roster can move it by working
     harder. Presenting it in the same colour as "your engineer has not touched this in 40 days"
     tells the reader to chase the wrong person.
   - **It is the rung the PMO itself works.** Every other rung is delivery work; COC is a
     counter-signature, and chasing it is a PMO job. So the count of records at COC is not a
     warning to somebody else — it is this office's own queue, and it belongs on the PMO's
     dashboard more than anything else on the page.
   - **The 10-day budget means something different here.** Ten days on STG/TEST is a delivery
     question. Ten days at COC is a question for CHI, and the honest sentence names them.

   So: records at COC get their own count, their own list, and their own words. They are not
   merged into "stuck".

### 11.4 One page, three readers

**All three tiers read the same page and the same numbers** — the owner as PMO Lead, the
Associate Directors for their own queue, the PMO Director and above for the trajectory. What
differs is only what it opens on, not what it contains, because the alternative is three pages
that disagree and an argument about whose figure is right.

Which means one constraint, and it is not negotiable: **it names individuals.** An Associate
Director's queue is a person's queue. The load imbalance — four people holding 526 of 828 open
items — is the single most actionable fact the PMO holds, and softening it for a wider audience
would remove the reason to look.

---

### 11.5 The strip reads as POSITION, not as colour

Each of the eleven use cases is a short track with one marker on it, at DEV, STG/TEST, COC or
PROD. **Distance along the track is the progress**, so a hospital that is nearly done looks nearly
done from across a room, and a row of markers bunched at the left is a hospital nobody has
started.

This is the same rule `0026_map_node_stages.sql` already enforces on the ladder and
`scripts/report/views/cover.mjs` on the printed report: *an ordered ladder is drawn as position,
never as seven hues.* It satisfies WCAG 1.4.1 for free — colour is never the only channel because
colour is not a channel at all here — and it survives being screenshotted into a message, printed
in grey, or read by somebody who does not know the palette.

An empty track — no marker — is **nobody has said anything about this pair**, and it is drawn as
untouched paper, never as a marker at position zero. `INK.unrecorded = 'none'` in
`scripts/report/build.mjs` is the same decision in the printed report: *the honest way to draw a
measurement nobody took is to leave the paper alone.* At 141 hospitals × 11 use cases, roughly
1,100 of the 1,551 tracks are empty on day one, and the picture should say so plainly.

### 11.6 Quiet is fourteen days

No movement and no comment for **14 calendar days**, at any rung.

⚠ **IT WILL FIRE HARD IN WEEK ONE AND THAT IS THE POINT.** The median open ticket is 216 days old
and 261 are over a year, so a fortnight's threshold lights up a large part of the board
immediately. That is not the instrument miscalibrated; it is the first honest measurement this
programme has had. The number is configurable, and the temptation to soften it before anyone has
seen it should be resisted — a threshold chosen to make the first screenshot comfortable is a
threshold that never tells anyone anything.

⚠ **QUIET IS NOT MEASURABLE ON IMPORTED DATA EITHER.** The same rule that governs the rung budget
governs this: `portfolio/fields.ts` discards a clock whose row records no author, because such a
stamp is the moment a script ran. Quiet starts counting from the first movement a person makes.

### 11.7 The COC queue, and the first write path the PMO would use daily

COC is the one rung this office works, so it is the one place the PMO needs to **record** rather
than read. Four fields, all confirmed with the owner:

| Field | What it is | Why |
|---|---|---|
| `coc_submitted_on` | date the completion evidence went to CHI | without it the age of the wait is unknowable, and the age is the entire reason to chase |
| `coc_contact` | the named person at CHI holding it | turns "waiting on CHI" into "waiting on a person", which is what makes a chase possible |
| `coc_reference` | CHI's own reference or certificate number | so a follow-up can quote it, and a signed certificate can be matched back to this exact (hospital, use case) |
| the chase thread | a short line per chase — *"chased 12 Aug, promised this week"* | the thread, not just the state |

**The thread is not a new table.** `entry_updates` is already an append-only, authored,
timestamped trail against a work item, and a chase is exactly that. Adding a fifth column called
`coc_notes` would be a second thread implementation whose entries could not be attributed.

⚠ **`coc_contact` IS A NAME AND NOTHING ELSE — no email, no phone.** This workspace holds no staff
emails by design, forbids attachments outright, and its privacy page is written from what the
schema actually contains. A CHI contact is a person outside the organization, so the bar is
higher, not lower. A name is what makes the chase possible; contact details belong in whatever
system the PMO already uses for them.

**This matters beyond COC.** The diagnosis behind this whole exercise was that the product has
eight ways to look at data and almost no way to change any of it — `setNodeUseCase` has zero call
sites — and that "nobody has ever hand-edited anything" is a consequence rather than a habit. The
COC queue is the best available candidate for the first write path anyone uses every day, because
the person who needs it is the person asking for it.

### 11.8 Both surfaces, one source

The exception list lives on the **PMO dashboard**; the same data is drawn on the **map** when the
question is "by department" or "by vendor" or "by HIS". One computation, two surfaces.

The rule that makes that safe is already written in `MapBranchDetail.tsx`: a roll-up cannot know
the reader's filter, and *a branch labelled 12 showing 3 is the worst thing this map can do.* So
both surfaces read one function; neither restates its arithmetic.

---

## 12 · Where the five studies disagreed, and which way it was settled

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Pair universe | **744 pairs on 922 tickets** | 770 on 999 | The wider count includes four loose conventions whose "organization" segment is often an error phrase; it would import 42 organization names that do not exist. |
| Pairs never written | **773 of 1,449** | 679 | 773 is projected onto the 161 map organizations; 679 counted distinct ticket strings, which double-counts spelling variants and misses organizations the tracker never named. |
| Organization field | **`Components`** (system) | `Related to (migrated)` renamed | Components is JQL-native, creates no custom field, and its Component Lead turns "42 organizations with no owner" into a screen. `Related to (migrated)` keeps a real job: it seeds the list and back-fills 683 tickets. |
| Use case field | **`Nphies Use Case`** (exists, 0 of 2,971 filled) | a new single-select | It already exists. The result is that **the design creates zero new custom fields.** |
| "Waiting on" field | **`Action Pending With`** (exists, 0 of 2,971) | a new "Waiting on" field | Same reason; and its option list mirrors `Nphies Groups`, which 2,386 filled rows prove the team will populate. |
| Entry status | **`Intake`** | `Not Recorded` | Same meaning; `Intake` is already in the announcement in both languages. Reopenable in one line (§10, decision 5). |
| `PROD`'s status category | **In Progress**, with `Closed` terminal | `PROD` as category `Done`, plus a `Withdrawn` status | A cutover in progress reported as Done is the identical defect to 60 `Pending on Vendor` tickets sitting in `To Do`. Withdrawal is a Resolution, not a status. |
| Merge count | **149 pairs, 178 tickets absorbed** | 143 merges | Computed on the 744-pair definition rather than the 770-pair one. |
| Duplicate summaries | **37 strings over 77 tickets** | 32 over 66 | The later pass over the same file. |
| Convention families | **thirteen** | two | The two-convention finding was comparing two of thirteen populations; the shared-pair overlap is 67, not 14. |

---

## 13 · Architecture decisions, 26 August 2026

### 13.1 The COC record lives in NphiesCore, and it is the one place the PMO writes

Jira holds the ticket and its rung. **NphiesCore holds the chase** — submitted date, the named CHI
contact, CHI's reference, and the thread. The PMO works here because it is their queue and their
tool; everyone else works in Jira.

### 13.2 Rungs move freely, except COC

**Any OB Account Manager may advance any record** through DEV → STG/TEST → COC. It is faster and
survives leave, and the audit trail records who.

**COC is PMO-only**, because moving off it is not a delivery act — it is recording that CHI signed,
and it notifies somebody else.

### 13.3 The Jira write-back — the first thing this product will ever write to Jira

When the PMO records a Certificate of Completion as signed, NphiesCore:

1. **writes the signed date and CHI reference into fields** on the Jira ticket;
2. **posts a comment** — signed on ⟨date⟩, reference ⟨number⟩, proceed to go-live;
3. **re-assigns the ticket to the OB Account Manager — but only if it is unassigned or held by the
   PMO.** If somebody else holds it, comment and leave the assignee alone; they may be mid-task and
   a ticket vanishing off a desk is how a tool loses a user.

⚠ **THIS MUST BE A NEW EDGE FUNCTION, NEVER A CHANGE TO `jira-read`.** That function's frozen
  four-endpoint allow-list, and the test asserting the file contains exactly two `fetch(` calls
  and one `Authorization:` header, are the only formal proof of read-only in this system. Widening
  it would destroy the proof for every existing caller. A `jira-write` beside it, with its own
  allow-list of exactly the three operations above and its own counted-call test, keeps both
  properties provable.

⚠ **AND IT IS GATED ON A GATE THAT IS STILL SHUT.** The owner's own words, quoted in five files:
  *"i can not connect the app to jira until we verify the tracker very well."* The read connection
  does not work yet — the current scoped token authenticates as an app with no project grants and
  every content query returns 200 with zero rows. **Reading must work, and be trusted, before
  anything writes.**

### 13.4 Attachments — decided: bring them in, with redaction

The owner was shown the objection and reaffirmed the decision, so it is the decision. What it
costs, stated once so nobody is surprised later:

**The evidence.** 5,339 attachments: 2,427 `.png`, 825 `.docx`, 741 `.xlsx`, 495 `.txt`, 279
`.xml`, 122 `.pdf`, 115 `.json`, 69 `.zip`, 48 `.csv`, 32 `.sql`. By filename alone, **2,307 are
named screenshot or capture**, **121 name a certificate or a key**, **117 an HL7 or message
sample**, and **23 name a patient, an MRN or an iqama**.

**It is three projects, not one, and they carry different risk:**

| Class | Files | Can a RULE redact it? |
|---|---|---|
| Structured text — `.txt` `.xml` `.json` `.csv` `.sql` | ~969 | **Yes.** The same rule BRD-001 needs for descriptions: drop HL7 payloads whole, mask identifier-shaped numbers, strip key blocks. Testable. |
| Documents — `.docx` `.xlsx` `.pdf` | ~1,688 | **Partly.** Text extracts and redacts; embedded images and layout do not. |
| Images — `.png` `.jpg` | ~2,455 | **No.** A screenshot of a patient list cannot be redacted by a rule. It needs OCR plus judgement, or a person, and neither is a test you can write. |

⚠ **"WITH REDACTION" CANNOT MEAN THE SAME THING FOR ALL THREE.** Shipping image redaction as
  though it were solved is worse than not shipping it, because it converts a known risk into an
  assumed safety. The honest shapes are: redact-by-rule for structured text, extract-and-redact for
  documents, and for images either a human review step before an image becomes visible, or images
  stay a link out to Jira.

**Three things it changes that are not code:** the schema gains file storage it deliberately does
not have; `src/pages/Privacy.tsx` and both locale bundles must be rewritten in the same commit;
and `ios/App/App/PrivacyInfo.xcprivacy` currently declares no health data, which stops being true
the moment a redaction miss lands one screenshot in the database.

**Sequencing:** this is not on the critical path for the onboarding process. It should follow the
ticket contract rather than delay it.

### 13.5 Ayenati and Raqeeb are separate programmes

Not a tag on a hospital and not a grouping of the eleven use cases: **their own tracks, with their
own organizations.** The schema already supports this — `map_nodes.track_id` is derived from the
parent by a trigger, so two filing axes are unrepresentable and a second track is a first-class
thing rather than a workaround. The nine archived tracks from the old product were removed for
being empty, not because a workspace may only hold one.

Reports scope to a track, which is what "a report for a certain product" means here.

### 13.6 Nothing is cleared yet

The 715 use-case statuses and 161 stage records stay until the API integration is proven. The
export was given, in the owner's words, *"just to fine tune before the go live"* — it is
scaffolding, and scaffolding comes down after the building stands.

---

## Provenance

- **Source of every number:** `/Users/aziz/.claude/jobs/8f812826/tmp/jira-safe.csv` (2,971 rows,
  628 of 702 columns — see §2) and [`scripts/report/structure.csv`](../scripts/report/structure.csv)
  (161 organizations).
- **Analysis scripts are throwaway and live outside this repository** at `/tmp/nph8f/`
  (`lib.mjs`, `classify.mjs`, `rest.mjs`, `fields.mjs`, `final.mjs`, `other.mjs`, `migrate.mjs`,
  `mapmatch2.mjs`, `coverage.mjs`, `merge.mjs`, `gap.mjs`, `rest2.mjs`, `final2.mjs`,
  `recency.mjs`). They are not part of the build and nothing depends on them.
- The CSV parser in those scripts was **copied** from
  [`scripts/report/extract.mjs`](../scripts/report/extract.mjs) rather than imported, because
  that module calls `process.exit(1)` at import time when `SUPABASE_URL` is unset.
- Repeated column names were resolved to **every** index bearing the name and collected across
  all of them (`Watchers` ×11, `Labels` ×3, `Approvers` ×2, `Gantt End to End` ×2).
