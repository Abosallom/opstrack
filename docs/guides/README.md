# The owner guides

Picture-led PDFs for the steps that are the owner's alone, **written for someone doing this
for the first time**: every term defined before it is used, one action per page, and what the
screen should look like after each one.

All were written against a **live probe** rather than the prose in `docs/`, whose dates had
drifted — the first three on 21 August 2026 16:14 UTC, `yours.pdf` on 22 August.

⚠ **`next-steps.pdf` supersedes `yours.pdf` and `remaining.pdf`.** Both were written before the PMO portfolio existed and before the roster was probed against `auth.users`; the 22 August evening probe found 25 of 27 accounts have never been signed into, which is the fact the whole list now turns on.

⚠ **`yours.pdf` supersedes `next.pdf`.** `next.pdf` lists eight remaining steps against the
state of 21 August; the probe on the 22nd found the workspace still holds only demo data and
that the organisation list is in Jira, which collapses the owner's list to **one token now and
real email addresses later**. Read `yours.pdf`; the other three are reference for steps already
done or not yet reached.

| File | Covers | Pages | Source of record |
|---|---|---|---|
| `walkthrough.pdf` | **Do this before handing out any code.** Fifteen minutes on a phone: ten things to try and exactly what each should do, plus the list of what is expected-not-broken | 4 | Driven end-to-end as a real member account, 23 Aug 2026 |
| `next-steps.pdf` | **Start here.** The four things left that are yours: hand out 9 codes, reissue 16, put one project in the new portfolio, decide the 33 unowned organizations | 9 | A live probe of the database and auth users, 22 Aug 2026 |
| `yours.pdf` | **What is on you, and nothing else.** One Jira token now, real email addresses later — plus the live check that found the workspace is still demo data | 8 | A live probe of the database, 22 Aug 2026 |
| `next.pdf` | ~~Start here.~~ **Superseded — see above.** The eight remaining steps, with diagrams — what is done, what is next, who does each | 12 | OWNER-PLAYBOOK + the live probes |
| `sql.pdf` | Step 1 in detail — the four SQL files, each run twice | 11 | RUN-0026-0027-0028 |
| `dns.pdf` | The nine DNS entries at Hostinger — **done, kept for reference** | 10 | DOMAIN-CUTOVER §2 |

These are the *beginner* rendering. The full technical detail — exact NOTICE text, the §5
verification queries, the reasoning behind every constraint — stays in the markdown they are
drawn from, which is where it belongs.

## Editorial rules these follow

- **No unexplained jargon.** Each guide has a glossary page early on (p2), and nothing appears
  in the instructions that is not defined there or on the spot.
- **Say what you will see.** Every action carries the observable result, so the reader can tell
  whether it worked without understanding why.
- **Name the traps, and say they are traps.** The Supabase editor saving drafts silently; the
  `www` value being GitHub's host and not the domain; renaming a stage before the second run.
- **Say plainly when nothing is wrong.** "Propagation", `SKIPPED`, `Success. No rows returned`,
  and the gap where the domain answers nothing are all called out as expected, not faults.
- **Prefer a command that cannot be got half-right.** `sql.pdf` uses
  `pbcopy < <file>` rather than "open the file, select all, copy" — verified to put the file on
  the clipboard byte-for-byte (106,251 bytes for `0026`).

## Regenerating

```bash
./render.sh dns.html sql.html      # -> dns.pdf, sql.pdf
./preview.sh sql.html              # -> preview/sql/p01.png … one PNG per page
```

`render.sh` inlines `_base.css` and prints through headless Chrome. No network, no external
assets, no fonts beyond the system stack — reproducible offline.

`preview.sh` splits the same HTML into one file per `.page` and screenshots each at A4
proportions. It exists because the PDFs must be **looked at**, not assumed: `.page` sets
`overflow: hidden`, so content that overruns a page is clipped silently rather than reflowing.
Check the PNGs after any edit — that is how the wrapped IPv6 addresses, the upper-cased
filenames and a double-boxed panel were each caught.

## What is deliberately not in them

- **Screenshots of a logged-in Hostinger panel or Supabase editor.** Both are drawn
  reconstructions. Field names and layout match; pixel styling does not.
- **The verification SQL, copied out in full.** `sql.pdf` prints the expected *results* and says
  to copy the queries from `RUN-0026-0027-0028.md` §5 and `PENDING-MIGRATIONS.md`. Duplicating a
  query into a PDF is how a stale copy gets pasted a year from now.

## Known gap these surfaced

`RUN-0026-0027-0028.md` §5 has verification queries for `0026`, `0027` and `0028` but **none for
`0029`** — the page was named for three files and now carries four. `sql.pdf` falls back to the
five-table self-check, which covers existence but not shape.
