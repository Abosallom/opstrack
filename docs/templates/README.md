# Importing your structure from a spreadsheet

Building the map through **Settings › Structure** is one form submission per
node, per organization, per use case. For a real portfolio that is several
hundred clicks. This is the other way: **fill in one spreadsheet, check what it
would do, then apply it.**

| File | What it is |
|---|---|
| [`structure.csv`](structure.csv) | The empty template. Header row only. **This is the file you fill in.** |
| [`structure.example.csv`](structure.example.csv) | The same header, filled in with invented data, so you can see the shape before you type anything. |
| [`structure.demo.csv`](structure.demo.csv) | Invented organizations, **made to be run**, so the map is full while the real structure is still being collected. It can be taken back out exactly — see [The demo data](#the-demo-data). |

Everything in the example file is a placeholder — the hospitals, the vendors and
the people are all made up. It is there to be read, not imported: the people it
names have no accounts, so an import of it is refused. The demo file is invented
too, but it is invented to run.

**If the real structure is not collected yet, start with the demo file.** It
fills the map today and comes back out exactly when the real one arrives:
[The demo data](#the-demo-data).

---

## The three steps

```sh
# 1. Fill in docs/templates/structure.csv in Excel and save it.

# 2. See what it would do. This writes NOTHING.
node scripts/import-structure.mjs docs/templates/structure.csv

# 3. When the printed plan is what you meant, apply it.
node scripts/import-structure.mjs docs/templates/structure.csv --apply
```

**Step 2 is the whole point of the design.** The importer is dry-run by default,
for the same reason `scripts/provision-people.mjs` is: the plan it prints is the
last chance a human gets to notice that a path is misspelled or an organization
landed under the wrong wave. Read the plan. Then apply.

You can keep the file anywhere — `docs/templates/structure.csv` is just the
copy that ships. A file on your Desktop works the same way.

The importer reads its credentials from `.env.local` in the repo root and never
takes them on the command line. If it says a value is missing, it names which
one; see the RUNBOOK for where each one comes from.

---

## The demo data

`structure.demo.csv` is a filled-in file of **invented** organizations that is
meant to be run, not only read. Import it and the map is full.

**It is here because an empty map cannot be judged.** A workspace holding one
node under one track answers none of the questions the app exists to answer: the
tiers do not nest, the Organization panel has nothing beside it, the vendor
grouping has one vendor to group, and "6 of 9 live" is a sentence with nothing
behind it. Deciding whether a screen works needs something on the screen.
Collecting the real structure takes weeks. This takes a minute — and, which is
the point, it comes back out in a minute.

Everything in it is made up: the organizations, their Arabic names, the vendors,
the descriptions, every use-case status. It is shaped rather than random — four
waves of deliberately unequal size, sixteen organizations, and four vendors
across fourteen of them so the vendor grouping has more than a token to group
and *no vendor recorded* is represented too. The states each screen has to
render are all present on purpose: two sites with every capability live, three
with nothing recorded at all, one with a vendor but no capability, one with a
capability but no vendor, a laboratory whose scope is genuinely narrow, and
several mid-migration. A map where every branch looks the same tests nothing.

The 67 statuses are **33 `live`, 16 `testing`, 18 `planned`**, and that split is
deliberate too: `Wave 4` reads as a branch that has barely started (1 live, 3
testing, 9 planned) while `Wave 1` and `Wave 2` carry the finished sites. A
dataset that is two-thirds `live` everywhere puts every progress affordance —
the *6 of 9 live* matrix, any roll-up, any colour ramp — at the top of its range
and never draws the interesting end of the scale.

Three decisions worth knowing before you judge what you see:

* **Nothing in it is a real name.** The vendors are `Demo Vendor Alpha` through
  `Delta` rather than plausible integrator names, and no tier or organization
  borrows a real cluster, city or facility. That is not timidity — a screenshot
  of the vendor view showing a real integrator with an invented book of business
  is a screenshot that misstates somebody's business inside a Nphies PMO.
* **The four tiers are `Wave 1`–`Wave 4`, typed `Phase`.** `Programme`, `Phase`
  and `Organization` are the only kinds the catalogue seeds, so the names were
  chosen to match the kind they carry. If your real structure wants a `Cluster`
  or a `Department` tier, add the kind in **Settings › Catalogue** *before* the
  real import — the demo is not making that decision for you.
* **`Areej Day Surgery Unit` is completely bare** — no Arabic name, no account
  manager, no vendor, no description, no capability. It is there so the empty
  Organization panel can be looked at, because that is what most of the map will
  look like on day one of the real import. Its own row says nothing about that
  on purpose: a description in it would be the one thing stopping it being empty.

The only values in it that are *not* invented are the ones that cannot be: the
track it hangs from (`UHR`), the capability column names, and the two account
managers it names — the two people who actually have accounts. The demo file
gets no exemption from any rule on this page.

**It all hangs off one node, `UHR > Demo Portfolio`,** whose description says so
in both languages. That is on purpose: one branch is one thing to find, look at,
and take away. It does cost one tier: the deepest demo path is five segments
(`UHR > Demo Portfolio > Wave 1 > Sarab Group > Ghadeer Family Medicine
Centre`), so what you are looking at is **one level deeper than the real
structure will be** once it hangs directly off `UHR`. Read the nesting with that
one-tier offset in mind; the wrapper is what makes the reset one branch instead
of twenty-two.

It goes through the same planner as any other file. Same dry run, same refusals,
same behaviour on a second run. There is no demo mode:

```sh
node scripts/import-structure.mjs docs/templates/structure.demo.csv
node scripts/import-structure.mjs docs/templates/structure.demo.csv --apply
```

The dry run against the workspace as it stands today reports what the file is
built to report — **22 nodes to create, 0 to update, 67 use-case links to set,
0 refusals** — and lists `UHR > OB`, the node that was already there, under *in
the app but not in this file*, untouched. **Nothing in this file updates
anything**, and that is what makes its removal exact rather than approximate:
see [what it puts back, and what it cannot](#what-it-puts-back-and-what-it-cannot),
none of which bites a file that only creates.

**Nothing in the database says "demo".** A node written by this importer has
`source = 'local'`, and so does every node created by hand in the app; there is
no third value, and adding one would put a word in the schema that every screen,
filter and export would then have to understand. What tells the demo rows from
the real ones is not a column — it is the **manifest** that the apply writes: a
file, on disk, listing exactly what that run created. **Keep it.** It is the only
record of which rows came from this file.

Losing it is survivable *for this file only*, and only because of the shape
above: `UHR > Demo Portfolio` is one branch, so you could delete it in the app
by hand — deepest node first, because a node with children underneath it cannot
be deleted. That is twenty-two confirmations instead of one command. Keep the
manifest.

### Taking it out when the real data arrives

Remove the demo **first**, then import the real file:

```sh
# 1 & 2. Remove the demo — dry run, then apply. See "Taking an import back".
node scripts/import-structure.mjs --undo <the manifest the demo apply printed>
node scripts/import-structure.mjs --undo <the manifest the demo apply printed> --apply

# 3 & 4. Now import the real structure.
node scripts/import-structure.mjs docs/templates/structure.csv
node scripts/import-structure.mjs docs/templates/structure.csv --apply
```

**The order matters, and not for tidiness.** Nodes are matched on their full
path. A real organization that happens to sit at a path the demo invented is
therefore not a new node — the real import *adopts* the demo node and writes the
real values onto it. That node now holds real data while the manifest still
lists it as demo-created, so an undo run afterwards deletes it. Take the demo out
while it is still unambiguously demo.

---

## Taking an import back

Every `--apply` writes a **manifest**: one JSON file recording what that run did
— which project, which file, when, the id and full path of every node it
created, every use-case link it set or cleared with the status that was there
before, and every field it overwrote with its old value beside the new one. It
holds no credentials. Manifests land in `docs/EVIDENCE/import-runs/`, named
`import-<UTC stamp>-<project ref>.json` so a plain `ls` puts the newest last:

```
docs/EVIDENCE/import-runs/import-20260812T190400Z-lrysgpbkmuqgzsjesfkr.json
```

**Its path is printed at the end of the run, and that printed path is the one you
pass back** — you never have to construct it. Undoing is a mode of the same
script, and dry-run by default like everything else here:

```sh
# 1. See what it would remove. This writes NOTHING.
node scripts/import-structure.mjs --undo docs/EVIDENCE/import-runs/import-20260812T190400Z-lrysgpbkmuqgzsjesfkr.json

# 2. When the printed list is what you meant, remove it.
node scripts/import-structure.mjs --undo docs/EVIDENCE/import-runs/import-20260812T190400Z-lrysgpbkmuqgzsjesfkr.json --apply
```

**Commit the manifests.** They hold node ids, node names and capability names —
no keys, no emails, no usernames. An undo that only exists on one laptop is not
an undo: it has to survive a `git clean`, a fresh clone, and the machine the demo
was loaded from.

### Four things to know before you rely on it

**It removes only what THAT run created.** Not the workspace, not the tree, not
an earlier import. One run, one manifest, one undo. Nodes that existed before the
run are left standing; nodes created by a different run are that run's
manifest's business. Import the same file three times and you have three
manifests, each knowing only its own creates — the second and third are nearly
empty, because by then there was nothing left to create. **The manifest worth
keeping is the one from the run that created the nodes**, which is normally the
first.

**It refuses the wrong project outright.** The manifest records which project it
was applied to. If `SUPABASE_URL` points somewhere else, the run stops before it
reads anything — because most of those ids would simply not exist in the other
project, and the undo would print a tidy list of *already gone* that reads
exactly like a successful reset.

**A node somebody has since used is refused, not deleted.** This is the rule the
whole command is built around, and it is wider than the database's own guard.
A demo node is left exactly where it is when *any* of these is true:

| What happened to it | Why it is not this script's to remove |
|---|---|
| It has a **child node this import did not create** | Somebody built under it. Deleting the parent would take their node with it. |
| **Entries are filed on it** | Real work is recorded against it. |
| A **capability status was set or changed by hand** on it | That is the sentence *"this hospital integrates ADT"* — a person wrote it, and this script did not. |
| It has been **moved** — to another parent, or to another track | A deliberate placement. Everything *below* a moved node is kept too, because the subtree moved with it. |
| Something **below it is being kept** | A node with a child cannot be deleted, so one kept organization keeps its wave and its programme with it. |

Each one is named in the plan with exactly what is in the way, before anything
is removed. That is the behaviour working, not failing. Move or close the work,
then run the same manifest again to take the rest. A **rename** is *not* a
refusal — a renamed dummy is still a dummy — but the plan prints the new name
before it deletes it.

**Running it twice is safe.** The undo asks what is still there rather than
assuming; a node that is already gone is not an error, it is nothing to do. A
second run against the same manifest prints an empty plan. And since this is a
sequence of REST calls rather than a transaction — exactly as the import is — a
run that stops partway is recovered the same way: run it again.

### What it puts back, and what it cannot

**It does put field values back**, on any node whose values still look exactly
like what the import wrote. A vendor the import overwrote, a description it
replaced, an account manager it reassigned: the manifest carries the old value
and the undo PATCHes it back — including on a node that existed long before the
run. In this workspace `UHR > OB` is that node. Same rule for a use-case status
the import *raised* rather than created: `testing` that the import pushed to
`live` goes back to `testing`, and a link the import created is removed
outright.

**The rule that governs all of it: only what still looks exactly like what the
import wrote is put back.** A field somebody has edited since is left at their
value and printed as `edited since the import — left alone`. A status somebody
has moved since is left alone too — and, as the table above says, it now also
stops the node being deleted.

**It puts stages and goals back too.** A stage the import recorded is set back
to whatever was there before it — and where the import created the record from
nothing ("nobody had said"), the undo removes the record rather than leaving a
blank one behind, so the node goes back to genuinely unrecorded. A goal the
import wrote is deleted; a goal it *moved* is moved back.

> **⚠ Putting a stage back resets its clock.** The database re-stamps the
> arrival time on any write, including this one, so a node the undo returns to
> `Integration` will read *"in this stage since today"*. The plan says
> `time-in-stage is reset by this undo` beside every stage it touches. The tree
> is restored; the history of how long it sat there is not.

Two things it genuinely cannot do:

* **A capability created by `--add-use-cases` stays in the catalogue** if
  anything still points at it. The database refuses to delete a capability that
  has any record against it, deliberately — see
  [`--add-use-cases`](#--add-use-cases). One with nothing left pointing at it
  after the undo *is* removed.
* **It is not a transaction.** If it stops partway, what came off has come off;
  re-run the same manifest for the rest.

### `--archive-refused`

```sh
node scripts/import-structure.mjs --undo <manifest> --archive-refused
```

Archives a refused node instead of leaving it, and it applies in **one** case
only: a node with no children at all whose sole blocker is the entries filed on
it. Archiving cascades to every descendant, so archiving a node that was refused
*because* somebody put a node under it would archive their node too — which is
the loss the refusal existed to prevent, arriving through the gentle-looking
door. The plan says per node which of the two happened, and why the fallback did
not apply when it did not.

It is off by default and it is rarely what you want: an archived node still holds
its name against the sibling-name index, so an archived demo `Nawras General
Hospital` makes a real one un-creatable under the same parent.

---

## The columns

One row per node. The columns are, in this order:

| Column | Blank? | What it means |
|---|---|---|
| `path` | **required** | The whole path to this node, **including the track**, separated by ` > `. See below. |
| `name_ar` | legal | The Arabic name of the **last segment only**. Blank means there is no Arabic name and the app shows the English one. |
| `kind` | legal | `Programme`, `Phase` or `Organization` — whatever is in **Settings › Catalogue**. Blank means the node has no kind. |
| `account_manager` | legal | The member who owns this organization. A username (`first.last`), an email address, or their exact display name. Blank means unassigned. |
| `vendor` | legal | The integrator doing this organization's work. Free text — type the company name. Blank means *not recorded*. |
| `description` | legal | Free text. |
| `description_ar` | legal | Free text, Arabic. |
| `stage` | legal | Which rung of the onboarding ladder this node has got to — `Kickoff`, `Testing/UAT`, `Live`, whatever is in **Settings › Catalogue**. Blank **leaves the stage exactly as it is.** See [Stages and goals](#stages-and-goals). |
| `target_date` | legal | `YYYY-MM-DD`, and the date of the one goal this row may carry. Blank means no goal. |
| `target` | legal | A whole number of organizations beneath this node that must reach a terminal stage by `target_date`. Blank **with** a date means "*this* node gets there by then". A number with no date is refused. |
| …then **one column per use case** | legal | `ADT`, `Medication Prescribe V1`, … See [Use cases](#the-use-case-columns). |

**Blank is legal everywhere except `path`.** Nothing here has to be filled in on
the first pass — put the tree in, apply it, and add account managers and vendors
in a later edit of the same file.

**`stage`, `target_date` and `target` are the exception to "a blank cell is a
statement", and deliberately so** — see the next section for why.

---

## Stages and goals

These three columns arrived after the first seven and they behave differently
from all of them. Read this once before you use them.

### A blank `stage` changes nothing

Everywhere else in this file a blank cell is a statement: clear the vendor, drop
the capability. **A blank `stage` is not.** It leaves whatever is recorded
exactly where it is.

The reason is a one-way door. The database stamps the moment a node arrives on a
rung, and that stamp is what every "stalled since" and "time in stage" reading
is computed from. It is re-stamped on the way *back*, so a file that blanked a
stage and then put it back would leave four hundred organizations reading *"in
this stage since today"* — and there is no way to recover the real dates. A file
that a colleague filled in for vendors, with the `stage` column left empty,
would have silently done exactly that.

So the trade is: **a stage is write-only from this file.** You can set one, you
can move one along, and you cannot clear one here. Clearing a stage is done in
the app, on the node, where it asks you first.

### The stages themselves are not created here

The `stage` cell names a rung that must already exist in **Settings ›
Catalogue**. A rung is not just a label — it carries an order, a terminal flag, a
paused flag and a stalled threshold, and adding one restates every count-form
goal in the workspace. A stage this workspace does not have is refused, with the
nearest rung it *does* have suggested:

```
no stage named `Tesing/UAT` on UHR > Onboarding > Al Faridah General Hospital.
Did you mean `Testing/UAT`? The ladder is: Kickoff → Integration → Testing/UAT
→ Live → Closed.
```

Matching is case-insensitive, and the Arabic name of a rung matches too — the
plan tells you when that is what happened.

### One goal per row

A row may carry **at most one** goal, and it is a goal about that row's own
node. The two shapes:

| `target_date` | `target` | What it means |
|---|---|---|
| `2026-09-30` | *blank* | **This node** reaches a terminal stage by 30 September 2026. |
| `2026-12-31` | `40` | **Forty organizations beneath this node** reach a terminal stage by 31 December 2026. |
| *blank* | `40` | **Refused.** A count with no date is not a commitment. |

Re-running the file **moves** that goal rather than adding a second one, so the
panel does not fill up with copies of one promise. A goal somebody wrote in the
app — those carry a label, or name a specific stage — is never touched by this
file.

### Before either column can do anything

Stages and goals live in tables created by migrations `0026` and `0027`. If
those have not been run against your project yet, a file that names a stage or a
date is **refused by name, before anything is written**:

```
3 row(s) name a `stage`, and this project has no
`map_node_stages`/`map_node_progress` tables — 0026 HAS NOT BEEN RUN AGAINST
IT. Run it first: docs/RUN-0026-0027-0028.md
```

A file whose `stage`, `target_date` and `target` columns are **all blank**
imports normally either way, so nothing about the older schema is broken by the
three new columns being present in your sheet.

---

## How paths work

`path` is the **whole** path from the track down to the node this row is about.
The separator is ` > ` — a greater-than sign with a space on each side. Extra
spaces around a segment are ignored.

* **The first segment is a TRACK, and the track must already exist.** In your
  workspace that is `UHR`. The importer does not create tracks — create those in
  Settings › Tracks, where they get their colour and their icon.
* **Every segment after the first is a node.**
* **The last segment is the node this row is about.** Every other column on the
  row — the Arabic name, the kind, the vendor, the account manager — describes
  that last segment and nothing else.

### Rows for the levels in between are optional

This is the part worth ten seconds of attention. These four rows:

```
UHR > Onboarding
UHR > Onboarding > Wave 1 Hospitals > Al Faridah General Hospital
UHR > Onboarding > Wave 1 Hospitals > Nakhil Specialist Hospital
UHR > Onboarding > Wave 2 Clinics > Rawdah Family Clinic
```

…produce this tree:

```
UHR                                      the track — must already exist
└── Onboarding                           has its own row, so it gets a kind
    │                                    and an Arabic name from that row
    ├── Wave 1 Hospitals                 no row of its own — created for you,
    │   │                                with no kind and no Arabic name
    │   ├── Al Faridah General Hospital
    │   └── Nakhil Specialist Hospital
    └── Wave 2 Clinics                   also created for you
        └── Rawdah Family Clinic
```

Six nodes from four rows. A level that appears only inside somebody else's path
is created automatically. **Giving it a row of its own is how you give it a
kind, an Arabic name, or a description** — that, and nothing else, is what the
`UHR > Onboarding` row is for.

So a person who lists every level and a person who lists only the leaves get the
same tree. Both are correct. List the levels you have something to say about.

**List each path at most once.** Two rows with the same path are two
descriptions of one node, and there is no rule that says which one wins.

### The limits

* **Depth: 6 levels below the track.** So a path may have at most seven
  segments — the track plus six. This is enforced by the database, and the
  importer refuses at the file rather than letting a half-written batch fail.
* **Names: 1 to 60 characters**, per segment, after trimming. Sixty is generous
  on purpose — "King Faisal Specialist Hospital & Research Centre" is 48
  characters, and organizations are entitled to their real names.
* **`name_ar`: up to 60 characters.**
* **Two nodes under the same parent cannot share a name, in either language.**
  The English one you would expect; the Arabic one catches people out, because
  two different organizations can have the same short Arabic name. The importer
  refuses it at the file rather than letting the database reject it partway
  through the write.
* **Every row must have the same number of commas as the header.** Excel and
  Google Sheets do this for you. It matters if you edit the file in a text
  editor: a row that is short by three commas is not "three blank cells", it is
  a row whose values may have shifted into the wrong columns, so it is refused.

---

## The use case columns

Everything after `description_ar` is one column per use case — the app calls
these **capabilities** — named exactly as the catalogue names it, in catalogue
order:

`ADT` · `Medication Prescribe V1` · `Medication Prescribe V2` ·
`Medication Dispense V1` · `Medication Dispense V2` · `Radiology Order` ·
`Radiology Report` · `Lab Order` · `Lab Results` · `Clinical Notes`

A cell holds one of the three statuses, or nothing at all:

| Cell | Meaning |
|---|---|
| `planned` | Agreed, not started. |
| `testing` | In integration testing. |
| `live` | In production. |
| *(blank)* | **Not integrated at all** — and this is not a fourth status. |

**Blank is not a fourth status — it is the absence of the record.** There are
exactly three statuses, and "not integrated" is stored as *no row at all* rather
than as a fourth value, so that there is only ever one way to say nothing. What
this means for you in practice: **clearing a cell removes the link.** If
`Lab Order` says `testing` today and you blank it and re-import, that use case
stops being recorded against that organization.

Leave the use case columns empty on any row that is not an organization. A
programme or a phase does not integrate anything.

**Adding a use case later** ("and more to be added later" is a real requirement,
not a footnote): add it in the app first — **Settings › Catalogue** — then add a
column with exactly that name. A column whose header is not a capability the app
knows about is refused, by name, rather than quietly ignored.

---

## What happens on a second run

**The importer matches on the full path, so re-importing an edited file updates
what is already there rather than creating a second copy of it.**

Fix a spelling, add a vendor, move a use case from `testing` to `live` — save
the file, dry-run it, apply it. The nodes keep their identity, and everything
filed under them keeps working. This file is meant to be edited and re-run, not
used once and archived.

Renaming the **last** segment of a path creates a new node, because a path is
how a node is identified. Rename nodes in the app; use the file for everything
else.

## What it does not do

Naming the boundary matters more than it looks, because the file is not the
whole truth of your workspace:

* **It does not create tracks.** The first segment of every path must already
  exist as a track.
* **It does not create kinds, capabilities or stages.** All three are managed in
  **Settings › Catalogue**. A `kind`, a `stage`, or a column header that does not
  match one is refused, with the nearest match suggested.
* **It does not clear a stage.** Blank leaves it alone; see
  [Stages and goals](#stages-and-goals).
* **It does not create people.** `account_manager` must match a member who
  already has an account (`scripts/provision-people.mjs` creates those).
* **It does not delete.** A node you removed from the file stays in the app.
  Deleting is done in the app, deliberately, one node at a time, with the
  guard that refuses to delete a node that still has work under it. The one
  way to delete from a file is `--undo <manifest>`, which removes what a single
  named run created and nothing else — see
  [Taking an import back](#taking-an-import-back).
* **It does not import outstanding issues.** Those are entries — they have
  owners, dates, statuses and a comment thread — and they will get their own
  file. Nothing in this one touches them.

---

## Working in Excel without losing your data

Four traps, all of which look fine on screen and go wrong on disk.

### 1. Save as **CSV UTF-8**, never plain CSV

This is the one that destroys Arabic. In the Save-as dialog choose
**`CSV UTF-8 (Comma delimited) (.csv)`**. The entry called just
`CSV (Comma delimited)` writes your local Windows codepage, and every Arabic
name in the file becomes unrecoverable mojibake the moment you save.

The templates here ship with a UTF-8 byte-order mark, which is what makes Excel
open them correctly in the first place. Keep it — saving as CSV UTF-8 keeps it
for you.

If Arabic opens as `Ø§Ù„Ø§Ù†Ø¶Ù…Ø§Ù…`, **close the file without saving.** The
copy on disk is still fine; it is Excel's reading of it that is wrong, and
saving is what would make it permanent.

*(Google Sheets and Numbers always read and write UTF-8, so if either is easier
for you, neither has this problem. File › Download › Comma-separated values.)*

### 2. Format the columns as Text before you type

Excel rewrites anything that looks like something else. A vendor called
`1-2-3 Systems` comes back as a date. `007` comes back as `7`. Select the
columns, then **Home › Number Format › Text**, before entering data.

The dry run flags cells that look date-shaped where a name is expected, but it
cannot recover what Excel already threw away — so do this first.

**⚠ This trap has a second mouth, and `target_date` is standing in it.** A cell
formatted as *Date* is saved back in **the machine's own locale**. You type
`2026-03-04`, Excel shows you `04/03/2026`, and that is what lands on disk — and
`03/04/2026` means March in one country and April in the next. Nothing in the
file records which machine wrote it, so there is no way to tell the two apart
afterwards and **neither is accepted**:

```
`31/12/2026` is not a date this file accepts, on UHR > Onboarding. Write it as
`YYYY-MM-DD` — `2026-12-31` — and nothing else. ⚠ IF THIS READS AS `31/12/2026`
OR `12/31/2026`, EXCEL WROTE IT, NOT YOU […] Format the `target_date` column as
TEXT before you type, then retype the date.
```

Format `target_date` as **Text** before you type in it. The same slip in the
other direction is caught too: a date typed into the `target` column is stored
by Excel as a five-digit serial number, so a target in the forty-thousands is
refused with that explanation attached rather than being read as a commitment to
forty thousand organizations.

### 3. The header row: the first ten are fixed, the rest are yours to delete

The two halves of the header behave differently, and the difference is worth
knowing before you start deleting things.

**The first ten columns** — `path`, `name_ar`, `kind`, `account_manager`,
`vendor`, `description`, `description_ar`, `stage`, `target_date`, `target` —
are fixed in **name, order and lower case**, and are matched by *position*.
Renaming one, reordering two, or translating any of them is refused, by column
number. Do not touch them.

**If you are holding a file from before the stage columns existed**, it has
seven fixed columns and it will be refused at column 8 — the three new ones were
*appended* to the fixed block rather than inserted into it, precisely so that an
old file fails loudly on the header instead of quietly writing every use-case
status three columns to the left:

```
column 8 of the header should be `stage` and reads `ADT`. The first 10 columns
are fixed and ordered: path, name_ar, kind, account_manager, vendor,
description, description_ar, stage, target_date, target. Start from
docs/templates/structure.csv rather than rebuilding the header by hand.
```

Copy your rows into a fresh `structure.csv` and they will line up.

**The use case columns** are matched by *name*, and **you may delete any of them
freely.** This is the rule that matters most on a sparse sheet, and it is
really one rule with two halves:

| What you do | What happens |
|---|---|
| **Delete the whole column** | That capability is **left exactly as it is** on every organization. The file simply does not speak about it. |
| **Keep the column, leave a cell blank** | That capability is **removed** from that organization. A blank cell is a statement. |

So if you have nine organizations and only three capabilities are in play,
deleting the other seven columns is the right move — it makes the sheet readable
and it cannot lose anything. What you must not do is keep a column you are not
maintaining and leave it blank, because that clears whatever is recorded there.

Adding a column back later is fine: give it the capability's exact name.

### 4. Beware of pasting from a web page or an email

Text copied out of a browser or Outlook carries invisible characters —
non-breaking spaces, zero-width joiners, right-to-left marks. A non-breaking
space is not a space, so `UHR > Onboarding` pasted from a web page can fail to
match the track called `UHR` while looking identical on screen.

The importer normalises these, and then tells you what was in the cell rather
than just saying the lookup failed. A real refusal reads:

```
no track named `UHR` (the cell also held a non-breaking space (U+00A0),
stripped before this lookup — if you pasted this from a web page, retype it)
```

You will also see a note in the **WORTH KNOWING** block whenever a path segment
had to be repaired, even when the import goes on to succeed. Read those: a
zero-width space is *deleted* rather than turned into a space, so
`Riyadh​Care` becomes `RiyadhCare` — a new organization sitting beside the real
one, with the same name to your eye. If you see that note, retype the segment by
hand.

**Commas and quotes inside a value are fine.** Excel handles the quoting for
you, and the importer reads it properly: `Mirqab Integration Co., Riyadh` is one
vendor, not two columns. You never need to avoid a comma in a name.

---

## When something is refused

A refusal names the row it came from and the value it objected to. Fix the file
and run the dry run again — it writes nothing, costs nothing, and is the fastest
way to get the plan you meant. Nothing is applied until you pass `--apply`, so a
file with a mistake in it has done no damage.

**One refusal stops the whole import**, including the rows that were fine. That
is deliberate: a half-imported spreadsheet leaves a tree that neither the file
nor the app describes.

### If the apply itself fails partway

That guarantee covers refusals — the things the dry run can see. It is **not** a
database transaction. Once `--apply` starts writing, a runtime failure (a
connection that drops, a key that expires, a constraint nobody predicted) can
stop the run with part of the file already written.

If that happens the script prints exactly which paths landed, and the fix is to
**run the same file again**. Every node is matched on its full path, so what
already landed is found rather than duplicated, and the dry run in between shows
you precisely what is left. Re-running is the recovery, not a risk.

### Two things the plan will not tell you unless you look

* **The plan is listed alphabetically; the map draws in the order you typed.**
  Each new node shows its `[position N]` — that is the order it will appear in
  under its parent, taken from the order of rows in your file. Do not reorder
  your spreadsheet to match the printout.
* **Vendors are grouped by the exact string.** The plan prints a
  *Vendors in this file* block with a count beside each one. If you see
  `Mirqab Integration Co.` and `Mirqab Integration Co., Riyadh` in that list,
  those are two vendors in every filter, forever — pick one spelling and use it
  on every row.

### `--add-use-cases`

There is a third flag, and it is worth knowing what it costs before you use it:

```sh
node scripts/import-structure.mjs docs/templates/structure.csv --add-use-cases
```

A column header that names no capability is normally refused, with the nearest
match suggested. This flag **creates it instead, permanently.** Once a single
organization is recorded against a capability the database refuses to delete it
— it can only be hidden. So a typo applied with this flag (`Radiolegy Report`)
is in the catalogue for good. Use it only when you really are adding a
capability Nphies has published, and prefer adding it in **Settings › Catalogue**
first, where you can also give it its Arabic name.

### Statuses are case-insensitive

`live`, `Live` and `LIVE` are all read as `live`. Excel capitalises the first
letter of a cell on its own and there is nothing useful to be gained by refusing
its help.

Arabic and English on the same line are printed with the isolation marks that
keep a mixed path in the order it is actually stored, so what you read in the
plan is what will be written.
