# The owner's playbook — every step that is yours, in order

**Written for Aziz, alone at his desk, 13 August 2026.** The revamp is built: fourteen commits
on `feat/map-hierarchy`, 5,101 tests green, nothing pushed. Everything below is either a step
only you can take, or a judgement only you can make. Each step says what it needs, what you
will see, and what happens after.

**If you only have 15 minutes today: do Step 1 and Step 2.** Everything else can wait.

**Verified state, 13 Aug 2026 (probed against the live project, not assumed):**

| # | Step | State | Evidence |
|---|---|---|---|
| 0 | Rotate the exposed credentials | ✅ done | `.env.supabase-admin` deleted |
| 1 | The SQL sitting (0026 / 0027 / 0028) | ❌ **not landed** | all five objects 404 on the live project — see the self-check below |
| 2 | Tell me — I import the 400-org demo | ⏳ waits on 1 | — |
| 3 | Redeploy `jira-read` | ❓ unverifiable from outside | redoing it is free and idempotent |
| 4 | Provision the 16 people | ❌ not done | `profiles` holds 2 rows |
| 5 | Connect Jira | ⏳ waits on 1 (needs 0028's table) | — |
| 6 | The verification tour | ⏳ waits on 1–2 | — |
| 7 | The real 400 organizations | when data is ready | — |
| 8 | Push / deploy decision | ❌ not done | branch has no upstream |
| — | Later: `/nphiescore/` move, TestFlight | scheduled separately | |

**If you believe you already ran the SQL and this table says otherwise**, one of three things
happened: the Editor was on a different project (check the picker top-left — the right URL is
`supabase.com/dashboard/project/lrysgpbkmuqgzsjesfkr/sql`), the file was pasted but never
Run (⌘⏎ executes; the Editor happily saves drafts), or it errored and the red line at the
bottom of the results panel went unseen. The 30-second self-check, safe to paste any time:

```sql
select relname from pg_class
 where relname in ('map_node_stages','map_node_progress','map_node_goals','jira_settings')
 order by 1;
```

Four rows = the sitting landed. Zero = it did not, whatever the Editor seemed to say.

---

## Step 0 — Rotate the exposed credentials (5 min, overdue)

Three credentials were pasted into chat earlier in this project. Anything typed into a chat
window should be treated as burned.

1. Open **https://supabase.com/dashboard/account/tokens**
   - Revoke the token created **1 Aug 2026** (labelled for applying migrations) and the other
     `sbp_` token. The page shows names and dates, not values.
   - *What breaks:* nothing. The migrations they applied are done. `.env.supabase-admin` goes
     dead — delete it:
     ```bash
     rm /Users/aziz/Claude/nphiescore/.env.supabase-admin
     ```
2. Open **https://console.anthropic.com/settings/keys**
   - Find the key starting `sk-ant-api03-4Qh`, menu (⋯) → **Delete**. Create a fresh one if
     anything of yours uses it.
3. **The rule from here:** credentials go in files, never in chat. When one is needed, I name
   the file; the scripts read the file, I read the script. The value never reaches me.

> Note: revoking the `sbp_` tokens does **not** affect the `service_role` key in `.env.local`
> — different systems. That key stays, and stays only there.

---

## Step 1 — The SQL sitting (10 min)

**The full runbook is [`docs/RUN-0026-0027-0028.md`](RUN-0026-0027-0028.md) — open it beside
the SQL Editor.** The one-screen version:

| Paste | Expect |
|---|---|
| `supabase/migrations/0026_map_node_stages.sql` | 4 NOTICEs, no ERROR |
| the same file **again, same sitting** | the same 4 NOTICEs |
| `supabase/migrations/0027_map_node_goals_and_counts.sql` | 4 NOTICEs, no ERROR |
| again | the same 4 NOTICEs |
| `supabase/migrations/0028_jira_settings.sql` | 3 NOTICEs, no ERROR |
| again | the same 3 NOTICEs |
| the runbook §5 verification queries | the expected rows, exactly |
| the runbook §6 canary query | `f_0025 = true`, `w_0025 = 1` — **unchanged** |

Three rules, each argued in the runbook:

- **Each file runs twice, back to back.** The second run must be a no-op that still passes
  every probe — that is the re-runnability test, not a formality.
- **Do not rename any stage rung until 0026's second run is done.** A rename before the
  re-run makes the seed re-insert the original seven words beside your renamed ones.
- **Never re-run 0023, 0024 or 0025.** The canary query exists to prove you didn't need to.

What you get: the stage ladder (7 renameable rungs — *Not started, Kickoff, Integrating,
Testing/UAT, Go-live ready, Live ✓, Paused ⏸*), the progress table your AMs write, the goals
table your ADs write, per-org counts, and Jira's settings row. **The app already understands
all of it** — the client shipped ahead of the database, so everything lights up on the next
reload with nothing else to do.

Afterwards, in **Settings → Catalogue**: rename the rungs to your real words, add the Arabic
(seeded blank on purpose — those seven words are yours to translate), set `expected_days` on
the rungs where "stuck too long" has a number (blank = the stalled clock is off for that
rung), and check which rung is marked **terminal** (counts as arrived) and **paused** (the
clock stops).

---

## Step 2 — Tell me, and I import the 400-org demo (your part: one message)

Say **"SQL is done"** (or anything like it). Then I, at the keyboard:

1. Dry-run `docs/templates/structure.demo.csv` against the live project and read the plan
   (~400 creates, 280 stages, 40 goals, 812 use-case links)
2. Apply it in one shot — the undo manifest is written to `docs/EVIDENCE/import-runs/` and
   committed, so the whole demo remains one command from gone
3. Take back the old 22-node demo via its own manifest
4. Run the live half of the verification: the audit-row checks, the paged-read proofs, the
   canary again

You watch or you don't — every write is recorded and reversible. When the real data is ready
(Step 7), the demo comes off the same way it went on.

---

## Step 3 — Redeploy `jira-read` (2 min)

Wave 7 fixed four security findings in the function, but **the live deployment still has all
four holes until you redeploy**:

```bash
cd /Users/aziz/Claude/nphiescore && npx supabase@latest functions deploy jira-read --project-ref lrysgpbkmuqgzsjesfkr --use-api
```

No secrets change; they are read per-request. Do this even if you never use Jira — the
deployed function exists either way.

---

## Step 4 — Provision the 16 people (15 min)

The demo left three account-manager books deliberately unassigned because only you and Nasser
exist. This step makes them real. Full background: [`docs/RUNBOOK.md`](RUNBOOK.md) §1 and
[`docs/PEOPLE.md`](PEOPLE.md).

1. **Get your admin session token** — sign in to the app, DevTools → Console, and run the
   one-liner from RUNBOOK §1.1. It expires in about an hour; that's ample.
2. **Dry run — read the username table carefully:**
   ```bash
   cd /Users/aziz/Claude/nphiescore && SUPABASE_URL=https://lrysgpbkmuqgzsjesfkr.supabase.co ADMIN_ACCESS_TOKEN='<paste from DevTools>' node scripts/provision-people.mjs
   ```
   **A username is what that person types at every sign-in and cannot be changed later
   without locking them out.** Check every transliteration — `sara.alqhahtani` especially.
   Fix any by editing `ROSTER` inside the script, re-run the dry run.
3. **Apply — stay at the keyboard:**
   ```bash
   cd /Users/aziz/Claude/nphiescore && SUPABASE_URL=https://lrysgpbkmuqgzsjesfkr.supabase.co ADMIN_ACCESS_TOKEN='<paste>' SUPABASE_SERVICE_ROLE_KEY='<from .env.local>' node scripts/provision-people.mjs --apply
   ```
   **16 invite codes print once and are never recoverable.** Copy them out of the terminal
   before closing it. Hand each person theirs; they claim at the sign-in screen's "First time
   here?" link. Don't paste the codes into chat.
4. In **Settings → Roles**, confirm the two senior experts hold **Director** and the three
   account managers stay **Member** — that split is what the stage-writing permissions were
   built around (recording progress is the team's; shape and commitments are the owner's).

---

## Step 5 — Connect Jira (optional; whenever you want it)

Jira is off by default and invisible until configured. When you want it:

1. **Mint a token:** https://id.atlassian.com/manage-profile/security/api-tokens →
   **Create API token**, label `nphiescore-read`, copy immediately (shown once).
   > An Atlassian token is **not** project-scoped and **not** read-only — it carries
   > everything that account can do. If you can use a low-privilege account with just
   > *Browse Projects*, do. Our function's four-endpoint allow-list is what makes this
   > read-only, not the token.
2. **Set three secrets** — Supabase dashboard → Edge Functions → `jira-read` → Secrets:
   | Name | Value |
   |---|---|
   | `JIRA_BASE_URL` | `https://<your-site>.atlassian.net` — just the site, nothing after |
   | `JIRA_EMAIL` | the Atlassian account **email** |
   | `JIRA_API_TOKEN` | from step 1 |
3. In the app: **Settings → Jira** → **Test connection**. Green shows the account and site it
   authenticated as; red names exactly which secret is wrong. If your name comes back, the
   whole path works.
4. Press **Fields**, find the two fields that carry the **organization** and the **use case**
   (they look like `customfield_10042`), pick them in the mapping, map your Jira statuses onto
   planned/testing/live, **Save**, and flip **Enabled**.
5. Run your JQL and read the reconciliation: *"N matched, M did not"* — with every reason
   listed per issue, not just the first. **Nothing is written, to Jira or here** — the screen
   says so and the tests prove it by grep. The write-back ships only after you say the
   tracker is verified.

Full function documentation: [`supabase/functions/jira-read/README.md`](../supabase/functions/jira-read/README.md).

---

## Step 6 — The verification tour: the judgements only you can make (20 min)

After Steps 1–2, sign in at the dev server (`npm run dev -- --port 5201 --strictPort`) or the
live site, and walk this list. These are the calls arithmetic can't make — everything
measurable has already been measured.

**Desktop, 1600×900, English:**
1. **The opening.** You should land framed on a book — named rings, counts, organizations as
   discs that resolve as you dive. *Does it read as your programme?*
2. **The purple.** The accent, the chips, the selection. *Does it read as the nphies ring
   now, or still blue?*
3. **The Portfolio chip.** Its badge is the at-risk count. Tap it: the stalled list, longest
   stuck first. Tap **Team** — five books plus the unassigned pile. Tap **Vendors** — the
   120-org cohort should dominate. *Is this your morning answer?*
4. **Change a stage.** Tap a row's stage cell, pick a rung. No dialog; an undo toast. Press
   undo once to see it restore. *Two taps?*
5. **Find an org.** Type four letters of any demo hospital into the search. *Is it there,
   with one tap to open?*
6. **Zoom.** The dive you liked is untouched — in to one organization (its name, manager,
   vendor, the progress underscore), out to the whole workspace (the show-people picture).
7. **Right-click a branch** — add a child, archive one; the dialog now tells the truth about
   what leaves the map and what stays marked.

**Then Arabic (العربية toggle):** the same tour mirrored — rings, labels, the portfolio
table, plurals on every count. **Then the phone (375px or your real phone):** your book on
opening, the sheet, a stage change through it, and the one open judgement — at the opening,
the six type-worlds show **counts without names** (naming them costs framing 60% of the world
off-glass; the alternative is one dive). *Which do you prefer? That's a one-line change either
way.*

Anything that reads wrong: tell me in a sentence, it goes into a fix wave against the
committed pictures.

---

## Step 7 — The real 400 organizations (when the data is gathered)

The template now carries ten fixed columns — the original seven plus **`stage`**,
**`target_date`**, **`target`** — then one column per capability. Full guide:
[`docs/templates/README.md`](templates/README.md). The short version:

1. `open docs/templates/structure.csv` (and the example beside it)
2. **Select all columns → Format as Text — before typing.** Excel rewrites `1-2-3 Systems`
   into a date, permanently.
3. One row per organization; `path` is the whole path:
   `UHR > Onboarding > <AD> > <AM book> > <type> > Org name`. Middle levels are created
   automatically.
4. `stage`: your rung's name exactly as the app shows it (blank = says nothing — it will
   sit in the "nobody has said" pile, which is honest). `target_date`: ISO `YYYY-MM-DD`
   **only** — Excel's `31/12/2026` is refused by name. `account_manager`: username, email,
   or exact display name (they exist after Step 4).
5. **Save As → CSV UTF-8 (Comma delimited).** Plain CSV destroys the Arabic.
6. Dry run, read the plan, fix refusals, repeat until `0 refusal(s)`:
   ```bash
   cd /Users/aziz/Claude/nphiescore && node scripts/import-structure.mjs docs/templates/structure.csv
   ```
7. Apply:
   ```bash
   cd /Users/aziz/Claude/nphiescore && node scripts/import-structure.mjs docs/templates/structure.csv --apply
   ```
8. Tell me — I take the demo off via its manifest, and your real portfolio stands alone.

Re-running an edited file is the normal way to use it: rows match on the full path, an
unchanged file does nothing, and every apply writes an undo manifest.

---

## Step 8 — Push and deploy (your word)

Fourteen commits sit local on `feat/map-hierarchy`. When you're satisfied with the tour:

- Say **"push"** — I push the branch, watch CI, and confirm live = HEAD
- Or name what to change first

---

## Later, scheduled separately

- **The `/nphiescore/` move** — the Supabase redirect allow-list moves in the same change;
  one sitting, planned when you want it
- **TestFlight** — needs your Apple ID in your hands; I prepare, you submit
- **Jira write-back** — designed (preview → apply → downloadable undo manifest), built only
  after your "the tracker is verified"

---

## The document map — what exists and what each is for

| Document | What it's for |
|---|---|
| [`docs/RUN-0026-0027-0028.md`](RUN-0026-0027-0028.md) | **Step 1.** The SQL sitting, NOTICE by NOTICE |
| [`docs/PENDING-MIGRATIONS.md`](PENDING-MIGRATIONS.md) | The permanent record of what is applied and what is pending, with the canary query |
| [`docs/templates/README.md`](templates/README.md) | **Step 7.** Filling the CSV — every column, every trap |
| `docs/templates/structure.csv` / `.example.csv` / `.demo.csv` | The empty template, the readable example, the 400-org demo |
| [`docs/RUNBOOK.md`](RUNBOOK.md) | Operations: tokens, secrets, invite codes, recovery |
| [`docs/PEOPLE.md`](PEOPLE.md) | The roster behind Step 4 |
| [`supabase/functions/jira-read/README.md`](../supabase/functions/jira-read/README.md) | **Step 5.** The Jira function: secrets, security model, revocation |
| `docs/EVIDENCE/` | Everything written to the live workspace: import manifests (each one an undo), the deleted-entries export, the Fable review PDF |
| `docs/EVIDENCE/fable-differential-review-2026-08-12.pdf` | The 10-finding differential review, with dispositions |
| [`docs/MAP-CONTRACT.md`](MAP-CONTRACT.md) / [`MAP-ZOOM.md`](MAP-ZOOM.md) | The map's design contracts (background reading, not steps) |
| `public/__lookat/index.html` | The 25 committed pictures of the map — the render gate's visual evidence, regenerated by `npm run lookat` |
| [`ADMIN.md`](../ADMIN.md) | Admin screens reference (repo root) |
| This file | The order to do it all in |
