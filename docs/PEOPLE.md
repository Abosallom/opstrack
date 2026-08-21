# The people of this workspace

Eighteen real colleagues. This page is the record of who they are, what they are
called, what they sign in as, and what they are allowed to do — and it is the
input to [`scripts/provision-people.mjs`](../scripts/provision-people.mjs), which
creates the accounts. The `ROSTER` constant in that script and the table below
are the same list said twice; if they ever disagree, the script is what runs and
this page is what a human reads, so **change both in the same commit**.

**Spell every name exactly as it appears here.** These are transliterations
their owners answer to, not strings to be tidied. If one is wrong, correct it in
the script's `ROSTER`, re-run the dry run, and correct it here.

---

## The roster

| Name | Position | Signs in as | Role | Starting altitude |
|---|---|---|---|---|
| Ahmed Alnaji | Executive Director, UHR | `ahmed.alnaji` | Member | Portfolio |
| Alhanouf Alsamani | Alnaji's Office | `alhanouf.alsamani` | Director | Portfolio |
| Nawaf Alharbi | PMO Director | `nawaf.alharbi` | Director | Programme |
| Massis Ovansoff | Technical Director | `massis.ovansoff` | Director | Programme |
| Areej Alhasawi | Business Operations & Product Director (Delegation) | `areej.alhasawi` | Director | Programme |
| Maher Alshehri | Ayenati Business Director | `maher.alshehri` | Director | Programme |
| Ahmed Alkanhal | PMO Associate Director | `ahmed.alkanhal` | Director | Delivery |
| **Nasser Alabri** | PMO Associate Director | **`nasser`** — already exists | **Admin** | Delivery |
| Sara Alqhahtani | PMO (OB related) | `sara.alqhahtani` | Director | Delivery |
| Abdulrahman Alhumaidan | OB Associate Director | `abdulrahman.alhumaidan` | Member | Delivery |
| Aseel Altheeb | OB Associate Director | `aseel.altheeb` | Member | Delivery |
| Ahmed Alshengiti | Ayenati Associate Director | `ahmed.alshengiti` | Member | Delivery |
| Hussain Alharthi | IT Ops Associate Director | `hussain.alharthi` | Member | Delivery |
| Mohammed Alkherb | Product Associate Director | `mohammed.alkherb` | Member | Delivery |
| Sara Alsaab | Integration Expert | `sara.alsaab` | Member | Work |
| Nada Alsuwaida | Raqeeb Clinical Expert | `nada.alsuwaida` | Member | Work |
| Reema Alsoairy | Developer | `reema.alsoairy` | Member | Work |
| **Abdulaziz Alsaloom** | Admin (PMO Lead) | **`az.alsaloom@gmail.com`** — already exists | **Admin** | Portfolio |

UHR = Unified Health Record · OB = Onboarding · Org = Organization.

**Usernames are `first.last`, lowercased and ASCII-folded.** The surname is not
optional and cannot be: there are three Ahmeds on this roster — Alnaji, Alkanhal
and Alshengiti — and `ahmed` alone identifies none of them. A username is
semi-public by design (RUNBOOK §1.2 sets out exactly how public), and it is the
string its owner types at every sign-in. **It cannot be changed afterwards
without locking that person out**: a username account authenticates against
`<username>@opstrack.internal`, a domain RFC 6761 reserves so that it can never
resolve, so there is no mailbox for a reset to arrive at and no self-service way
back in. That is why the provisioning script prints the derived table and stops.

---

## The two accounts that already exist

**Nasser Alabri signs in as `nasser`.** Not `nasser.alabri` — `nasser`. That
username *is* his login. Changing it would lock him out for the reason above, and
recovering him would take another admin, or the SQL Editor. The provisioning
script never creates him and never mints him a code; it sets his display name, his
position, and promotes him to admin, and it says so on stdout rather than doing it
quietly.

**Abdulaziz Alsaloom signs in as `az.alsaloom@gmail.com`.** A real address, and
the bootstrap allow-list inside `admin-members` — the floor under the admin gate
that lets a workspace be recovered when the database cannot answer. Deriving
`abdulaziz.alsaloom` and creating it would give the one person who cannot afford
it a second identity: two rows in every owner picker, his history split down the
middle, and the new one *not* on the bootstrap list.

So the arithmetic is **18 − 2 = 16 accounts to create**, not 17.

---

## Position is display-only and gates nothing

A position is a label a person is shown beside their name, and that is the whole
of it. **Nothing in this app may read a job title to decide what someone can do.**
Permission comes from the role and only from the role; the starting altitude in
the table above is a per-person default the reader can move at any time with the
altitude control, never a ceiling and never a floor. The reason is not
squeamishness about hierarchy — it is that a job-title string is free text that
changes when someone is promoted, is transliterated three different ways by three
different people, is written in Arabic on one row and English on the next, and is
about to have "(Delegation)" appended to it. Any code that infers seniority from
such a string is a permission check that a rename can silently defeat, in both
directions: an Associate Director who becomes a Director gains nothing they were
not granted, and a typo grants nobody anything. **Roles are checked, positions are
printed.**

---

## Roles, and what is not built yet

**Full `workspace.admin` for Abdulaziz and Nasser only.** Two people who can
create and delete accounts, edit the structure, and edit the vocabulary.

**A `Director` role for seven** — Ahmed Alkanhal, Nawaf Alharbi, Massis Ovansoff,
Areej Alhasawi, Maher Alshehri, Alhanouf Alsamani and Sara Alqhahtani. It carries
structure and vocabulary permissions and **not** `members.manage`: nine people who
can each delete a colleague's account is a bigger blast radius than the problem
needed. This is the split Aziz ruled on.

**Ahmed Alnaji is a full member, not a viewer — his own decision.** No read-only
role ships. The executive view is served by *altitude*, not by permissions: he
lands at Portfolio and can move anywhere.

⚠ **The Director role needs migration 0025 to have been APPLIED, not merely
written.** `0025_roles_permissions.sql` adds `roles`, `role_permissions`,
`profiles.role_id` and `profiles.position`, and seeds the three roles; the file
being on this branch is not the same as it having run against the project, and
only the database can answer which. So the provisioning script **probes** and
behaves accordingly:

- **0025 applied** — it writes `profiles.role_id` for the seven Directors, and
  `profiles.position` for everyone.
- **0025 not applied** — `profiles.role` is `check (role in ('admin','member'))`,
  so there is no third value to write. The seven are created as **members** and
  printed under a STILL TO DO heading on every run until the migration lands and
  the script is re-run. It deliberately does *not* park a `role_key` in metadata
  as a placeholder: a permission key nothing checks grants nothing, and writing
  one would make this page's own table a lie about who can do what.

**The Director write only ever fills a blank `role_id` or raises a plain
Member** — 0025's own backfill idiom, for its reason. Give somebody a different
role afterwards and a re-run leaves them alone and says so. The two Admins keep
going through the edge function's guarded `set-role`; 0025's
`profiles_role_sync()` bridges the legacy text it writes onto `role_id`.

`position` is gentler, because it grants nothing: the script writes the column
when it is there, and the auth user's `user_metadata` either way.

---

## Provisioning

Full detail lives in the script's own header. The shape of it:

```bash
# 1. Read the derived usernames. Nothing is written. Do this first, every time.
node scripts/provision-people.mjs

# 2. When the table is right, and with Aziz watching:
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon> \
ADMIN_ACCESS_TOKEN=<an admin session token — RUNBOOK §1.1> \
SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  node scripts/provision-people.mjs --apply
```

- **Dry run is the default.** `--apply` is the only thing that writes.
- **It is idempotent.** Re-running creates no duplicates and — this is the one
  that matters — **never reissues a code**, because reissuing *is* the password
  reset for a username account and would clear whatever the member already set.
  An account that exists is left alone.
- **Two credentials, and both are needed for different reasons.** Account
  creation goes through the `admin-members` edge function, which needs an
  *admin's* JWT and cannot be replaced by a local implementation: the invite
  digest is an HMAC under `INVITE_PEPPER`, a function secret this machine has no
  copy of, so a code minted anywhere else would be unredeemable. Display names and
  positions need the *service role*, because migration 0016 pins
  `profiles.display_name` against every caller holding a JWT, an admin's included.
- **The invite codes print once, as a table, at the end.** They are credentials
  with a fourteen-day life; the project keeps only an HMAC and there is no path
  anywhere that can show one again. Do not redirect the command's output into a
  file — the script warns when stdout is not a terminal. Hand each pair over in
  person or on a call; these accounts have no inbox by design.

Each person then opens the app, taps **First time here? Claim your account**,
enters their username and code, and picks their own password. Nobody's password
is ever set by anybody else.

---

## Where the rest of the reasoning lives

- [`supabase/migrations/0025_roles_permissions.sql`](../supabase/migrations/0025_roles_permissions.sql)
  — the roles, the permission keys, and why `is_admin()` became a thin alias
  rather than 183 rewritten policy call sites.
- [`docs/RUNBOOK.md`](RUNBOOK.md) §1 — adding, reissuing and deleting by hand,
  and §3.1 on why a locked-out username admin is the one lockout with no move.
- [`ADMIN.md`](../ADMIN.md) — the full username / invite / claim lifecycle.
- [`supabase/functions/admin-members/index.ts`](../supabase/functions/admin-members/index.ts)
  — the only door an account can come into existence through.
