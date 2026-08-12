# Importing your structure from a spreadsheet

Building the map through **Settings › Structure** is one form submission per
node, per organization, per use case. For a real portfolio that is several
hundred clicks. This is the other way: **fill in one spreadsheet, check what it
would do, then apply it.**

| File | What it is |
|---|---|
| [`structure.csv`](structure.csv) | The empty template. Header row only. **This is the file you fill in.** |
| [`structure.example.csv`](structure.example.csv) | The same header, filled in with invented data, so you can see the shape before you type anything. |

Everything in the example file is a placeholder — the hospitals, the vendors and
the people are all made up. It is there to be read, not imported.

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
| …then **one column per use case** | legal | `ADT`, `Medication Prescribe V1`, … See [Use cases](#the-use-case-columns). |

**Blank is legal everywhere except `path`.** Nothing here has to be filled in on
the first pass — put the tree in, apply it, and add account managers and vendors
in a later edit of the same file.

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
* **It does not create kinds or capabilities.** Both are managed in **Settings ›
  Catalogue**. A `kind` or a column header that does not match one is refused.
* **It does not create people.** `account_manager` must match a member who
  already has an account (`scripts/provision-people.mjs` creates those).
* **It does not delete.** A node you removed from the file stays in the app.
  Deleting is done in the app, deliberately, one node at a time, with the
  guard that refuses to delete a node that still has work under it.
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

### 3. The header row: the first seven are fixed, the rest are yours to delete

The two halves of the header behave differently, and the difference is worth
knowing before you start deleting things.

**The first seven columns** — `path`, `name_ar`, `kind`, `account_manager`,
`vendor`, `description`, `description_ar` — are fixed in **name, order and lower
case**, and are matched by *position*. Renaming one, reordering two, or
translating any of them is refused, by column number. Do not touch them.

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
