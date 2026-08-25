# ORG-RULINGS — the organization identity decisions

**This is a worksheet, not a document.** It exists because §10.1 decision 6 of
[`OPERATING-MODEL.md`](./OPERATING-MODEL.md) is the one thing blocking the migration, and it is
blocking it in a way no script may resolve: **guessing that two differently-spelled names are one
hospital is how a merge quietly deletes a real organization.**

Every merge also **moves the denominator**. The programme's scoreboard is 161 organizations × 11
use cases = 1,771 cells; collapsing Aseer's five rows alone takes it to 1,727. That is why the
backlog figure in `OPERATING-MODEL.md` is stated as *roughly* 1,100 — the exact number is an
output of these rulings, not an input to them.

## How to use it

Each entry needs one of three answers: **one hospital** (merge), **two hospitals** (keep both), or
**not ours** (archive). Write the answer beside the line. Nothing is applied until the whole sheet
is answered, and when it is applied it writes an undo manifest into `docs/EVIDENCE/import-runs/`
first, as every destructive script in this repository does.

## What the sections mean

- **A** — rows that reduce to the same name with nothing to tell them apart. Merging is the
  recommended default.
- **A2** — rows that reduce to the same name **but disagree inside their brackets.** Do not merge
  these blind. The bracketed text is usually the hospital information system, and one site running
  two systems is exactly the distinction you asked to be able to group by.
- **B1** — different spellings that are likely one hospital. The short list worth your time.
- **B2** — pairs that are close only by character count. Printed so nothing is hidden, not because
  they need deciding.
- **C** — tracker organizations that no ticket names at all. Either the hospital is written
  differently in Jira, or it is not yet in the programme.

⚠ **Generated from the safe projection of the Jira export** (BRD-001: ticket descriptions are
quarantined and were never read). Regenerate rather than hand-edit the counts.

---

# Organization identity — the rulings

Measured over 161 tracker organizations and 2971 tickets.

## A · Same name, nothing in brackets to separate them (7)

One hospital written more than one way. **Merging is the recommended default.**
The ticket count is the CLUSTER's, not each row's.

- **al madinah** — 2 rows, 39 tickets, 3 open between them:
    - `Al Madinah`
    - `Al Madinah Cluster`
- **alsaedy** — 2 rows, 13 tickets, 9 open between them:
    - `Alsaedy Hospital`
    - `Alsaedy Hospital(CDA)`
- **arrawdah** — 2 rows, 10 tickets, 8 open between them:
    - `Arrawdah General Hospital`
    - `Arrawdah Hospital`
- **king khalid university** — 2 rows, 15 tickets, 7 open between them:
    - `King Khalid University`
    - `King Khalid University (Aseer)`
- **magrabi** — 2 rows, 17 tickets, 7 open between them:
    - `Magrabi Health Hospital`
    - `Magrabi Hospital`
- **makkah 2** — 2 rows, 12 tickets, 3 open between them:
    - `Makkah 2 (MCC)`
    - `Makkah Cluster 2 (MCC)`
- **sfh** — 2 rows, no tickets found between them:
    - `SFH`
    - `SFH (Security Force Hospital)`

## A2 · Same name, but the BRACKETS DISAGREE (4) — do not merge blind

⚠ These collapse to one name only because the normaliser strips brackets. What is inside
the brackets is usually the hospital information system, and two different systems at one
site is exactly the distinction you asked to be able to group by. **Each needs a ruling:**
one site with two systems, two sites, or one row written carelessly.

- **alsalama** — 2 rows, 21 tickets, 12 open between them:
    - `AlSalama (Murgan)Hospital`   → brackets say: **Murgan**
    - `AlSalama (Murjan) Hospital`   → brackets say: **Murjan**
- **aseer** — 5 rows, 41 tickets, 11 open between them:
    - `Aseer`   → no brackets
    - `Aseer (Care Ware) Cluster`   → brackets say: **Care Ware**
    - `Aseer (Vida Plus)`   → brackets say: **Vida Plus**
    - `Aseer (Vida Plus) Cluster`   → brackets say: **Vida Plus**
    - `Aseer Cluster`   → no brackets
- **jazan** — 3 rows, 100 tickets, 16 open between them:
    - `Jazan`   → no brackets
    - `Jazan Cluster (MCC)`   → brackets say: **MCC**
    - `Jazan cluster (MedicaCloud)`   → brackets say: **MedicaCloud**
- **najran** — 5 rows, 79 tickets, 15 open between them:
    - `Najran`   → no brackets
    - `Najran (Vida plus)`   → brackets say: **Vida plus**
    - `Najran Cluster`   → no brackets
    - `Najran specialized hospital`   → no brackets
    - `Najran specialized hospital(FHIR)`   → brackets say: **FHIR**

## B · Spellings one or two characters apart

A digit difference was excluded, so "Makkah 1" and "Makkah 2" are not here.

### B1 · Likely the same hospital (6) — these are the ones worth your time

- `AL Salama Hospital`  **vs**  `AlSalama (Murgan)Hospital / AlSalama (Murjan) Hospital`   — 1 character apart
    - AL Salama Hospital: 24 tickets, 4 open
    - AlSalama (Murgan)Hospital: 21 tickets, 12 open
- `Aljadaani (SAFA) Hospital`  **vs**  `Aljedaani Hospital`   — 1 character apart
    - Aljadaani (SAFA) Hospital: 8 tickets, 8 open
    - Aljedaani Hospital: 9 tickets, 6 open
- `Alyosif Hospital`  **vs**  `AlYousif`   — 1 character apart
    - Alyosif Hospital: 3 tickets, 3 open
    - AlYousif: 12 tickets, 4 open
- `AUTISM SPECTRUM VIRTTUAL CARE CLINIC`  **vs**  `Autism Spectrum virtual care Hospital`   — 1 character apart
    - AUTISM SPECTRUM VIRTTUAL CARE CLINIC: 7 tickets, 1 open
    - Autism Spectrum virtual care Hospital: 6 tickets, 0 open
- `Jedda Oasis`  **vs**  `Jeddah Oasis`   — 1 character apart
    - Jedda Oasis: 1 tickets, 0 open
    - Jeddah Oasis: 17 tickets, 2 open
- `Samer Abbas Hospital`  **vs**  `Samir Abbas Hospital`   — 1 character apart
    - Samer Abbas Hospital: 1 tickets, 1 open
    - Samir Abbas Hospital: 4 tickets, 1 open

### B2 · Probably two different hospitals (11) — listed so nothing is hidden

They are close only by character count and diverge in the first four letters.

- `Abeer Medical Group`  **vs**  `Aseer / Aseer (Care Ware) Cluster / Aseer (Vida Plus) / Aseer (Vida Plus) Cluster / Aseer Cluster`   — 1 character apart
    - Abeer Medical Group: 13 tickets, 8 open
    - Aseer: 41 tickets, 11 open
- `Al edwani Hospital`  **vs**  `Aljedaani Hospital`   — 2 characters apart
    - Al edwani Hospital: 5 tickets, 3 open
    - Aljedaani Hospital: 9 tickets, 6 open
- `Al Hamra Hospital`  **vs**  `Al Hasa`   — 2 characters apart
    - Al Hamra Hospital: 5 tickets, 1 open
    - Al Hasa: 6 tickets, 0 open
- `Al Hasa`  **vs**  `Al Hayat Group Hospital`   — 2 characters apart
    - Al Hasa: 6 tickets, 0 open
    - Al Hayat Group Hospital: 12 tickets, 9 open
- `Al Hasa`  **vs**  `Alahsa`   — 2 characters apart
    - Al Hasa: 6 tickets, 0 open
    - Alahsa: 21 tickets, 4 open
- `Alahli Hospital`  **vs**  `Alahsa`   — 2 characters apart
    - Alahli Hospital: 1 tickets, 1 open
    - Alahsa: 21 tickets, 4 open
- `Alahsa`  **vs**  `Alnahda Hospital`   — 2 characters apart
    - Alahsa: 21 tickets, 4 open
    - Alnahda Hospital: 8 tickets, 8 open
- `Aloysif Hospital`  **vs**  `Alyosif Hospital`   — 2 characters apart
    - Aloysif Hospital: 1 tickets, 1 open
    - Alyosif Hospital: 3 tickets, 3 open
- `Aloysif Hospital`  **vs**  `AlYousif`   — 2 characters apart
    - Aloysif Hospital: 1 tickets, 1 open
    - AlYousif: 12 tickets, 4 open
- `KFSHB (Qassim)`  **vs**  `KFSHRC`   — 2 characters apart
    - KFSHB (Qassim): 19 tickets, 1 open
    - KFSHRC: 12 tickets, 3 open
- `Rabet`  **vs**  `Rabia Hospital`   — 2 characters apart
    - Rabet: 43 tickets, 8 open
    - Rabia Hospital: 22 tickets, 9 open

## C · Tracker organizations no ticket names (18)

Either the hospital is written differently in Jira, or it is not yet in the programme.

- `Aya Hospital`
- `CMRC`
- `EHC`
- `GAMA Hospital`
- `GNB hospital`
- `GNP`
- `Hail Cluster`
- `HMC Hospital`
- `KFMC`
- `MMS`
- `My Clinic`
- `NMC`
- `RCH`
- `SFH`
- `SFH (Security Force Hospital)`
- `SGH`
- `SMC`
- `Taif Cluster`
