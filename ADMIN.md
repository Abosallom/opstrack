# CoreTrack — administration

> **Pending database migrations:** see [`docs/PENDING-MIGRATIONS.md`](docs/PENDING-MIGRATIONS.md). Migrations `0014`–`0017` are written, tested and **not yet
> applied**; four user-facing guarantees are broken until they are run.


What an admin can change from the app, what is deliberately not changeable, what
it costs to change one of those things anyway, how member accounts are created and
claimed, and how to recover when the last admin loses the role.

This is the *why*. The step-by-step procedures — add a member, rotate a key,
apply a migration, roll back a deploy — are [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

Everything here assumes the migrations in [`supabase/migrations/`](supabase/migrations)
have been applied in numeric order.

---

## Who is an admin

`profiles.role = 'admin'`. That column decides it, everywhere it matters:
`is_admin()` reads it for every RLS policy, `store/auth.ts` reads the same column
to decide which controls render, and the member-provisioning edge function reads
it with the service role before doing anything privileged. There is no email
allow-list in the browser — see the note in
[`src/lib/admin.ts`](src/lib/admin.ts) for why a second source is worse than
none.

The first admin is promoted by the bootstrap block at the bottom of
[`0002_config_foundation.sql`](supabase/migrations/0002_config_foundation.sql).
It only works if the auth user already exists, so on a brand new project the
order is: run 0001 → run 0002 → sign in once with the admin address → run 0002
again (or just the recovery statement below). 0002 prints a `NOTICE` telling you
which of those three happened.

**Promoting a second admin is one statement**, and it has to be run somewhere with
no session — the SQL Editor or the service role — because `guard_profile_role()`
silently reverts a role change made by anyone holding a JWT who is not already an
admin:

```sql
update public.profiles p
   set role = 'admin'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'someone@example.com';
```

They have to sign out and back in afterwards. The role is read once per sign-in,
so an open tab keeps the old answer and will render member chrome while the server
happily accepts admin writes — confusing in exactly the direction that makes
people think the promotion failed.

---

## Who can provision members

Being an admin and being able to *create accounts* were two different questions
for three waves. They are now one, with a bootstrap door left open on purpose.

`admin-members` re-verifies the caller for itself, with the service role, so RLS
is never the thing that answers. Two ways to pass:

1. **`profiles.role = 'admin'`**, looked up by the function against the caller's
   own id. This is the general path: **a second admin promoted with the statement
   above can provision members**, immediately, with no redeploy.
2. **The `ADMIN_EMAILS` array inside the function**, which is a *bootstrap*
   allow-list and nothing else. It exists because the profile lookup is a
   database read, and a project whose `profiles` table is unreachable or whose
   only admin row has been wiped still has to be recoverable by somebody. It is
   the door you use when the room is on fire.

So: adding an address to `ADMIN_EMAILS` does not make anyone an admin — it grants
one capability, member provisioning, and nothing else. And promoting someone in
`profiles` *does* now grant them that capability, which was not true before
Wave 4. If you are reading an older note that says a second admin "can manage
tracks but cannot provision members", that was accurate and is no longer.

Changing `ADMIN_EMAILS` means editing the file and **redeploying the function** —
see [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §4. Changing `profiles.role` takes
effect on the target's next sign-in and needs no deploy. Prefer the second.

**A member who is not an admin gets `403 Only an admin can manage members` from
the function and `42501` from any admin-only write.** Both are the server
refusing, not a hidden button: the browser's role check decides what renders and
carries no authority at all.

---

## What an admin can change

**Tracks** — `/settings/tracks`, admin only:

| Action | Notes |
| --- | --- |
| Add a track | Name (EN + AR), description (EN + AR), colour, light-theme colour, icon |
| Rename | Both languages, any time. Nothing stores a track *name*, only its id, so a rename re-labels every entry, meeting, template and digest immediately and writes nothing else |
| Recolour | Two hexes: `color` for the dark theme, `color_light` for light. Leave the light one empty and the dark hex is used in both, which is usually too pale to see on white |
| Re-icon | From the glyph set in `src/lib/trackIcons.ts`. An unknown name falls back to a circle rather than breaking the row — which is why the database has no CHECK on `icon` |
| Reorder | Drag; writes `sort_order` for the tracks that actually moved |
| Archive / restore | The normal way to retire a track. Its entries and history stay, it drops out of pickers, and its recurring templates stop producing entries |
| Delete | Refused while anything still references the track. The UI then offers to move those rows to another track first, and does both in one transaction. The destination must be an **active** track: an archived one is hidden from every picker and stops its recurring templates, so moving rows there would lose them quietly. There is no "leave them unassigned" option — the database refuses that, since every `track_id` FK is `on delete set null` |
| SLA overrides | One optional number of days per priority, in the track editor. Empty means the track inherits the workspace default for that priority. See [Service-level agreements](#service-level-agreements-sla) below |

**Members** — `/settings/members`, admin only. Create an account, hand over its
one-time invite code, reissue a code, see who has not claimed yet, remove someone.
Every one of those goes through the `admin-members` edge function; the screen never
touches `auth.users` itself, because it cannot — that needs the service role, and
the service role never reaches a browser. The same operations by hand, for when the
app is the thing that is broken, are in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) §1. The full lifecycle and its rules are
[below](#member-accounts-usernames-invites-and-claiming).

**Everything is audited.** Every track insert, update and delete writes a row to
`config_audit` with the actor and full before/after images, and a
delete-with-reassign writes an extra `move` row carrying the counts. The images
are whole rows on purpose: the log still reads `Deleted Network (#06b6d4)` after
the track itself is gone. Admins can read it in the SQL Editor:

```sql
select created_at, action, actor_id,
       before ->> 'name' as before_name,
       after  ->> 'name' as after_name,
       after
  from public.config_audit
 order by created_at desc
 limit 50;
```

The table has a SELECT policy and no INSERT, UPDATE or DELETE policy, which under
RLS denies those operations to everyone — the same immutability trick
`entry_updates` uses. Never add `force row level security` to it; the audit rows
are written by a `SECURITY DEFINER` function that depends on the owner being
exempt, and forcing RLS would turn every audited track edit into a failure.

---

## Service-level agreements (SLA)

**SLA ships OFF, and nothing turns it on by itself.** No migration seeds a
number, and there is no `DEFAULT_SLA_DAYS` anywhere in the client. That is
deliberate: a breach is computed from `created_at` with no regard for *when* the
number was chosen, so seeding one would retroactively report every open item
older than the threshold as a missed commitment — against a target this workspace
never agreed to.

### The matrix

An SLA is resolved per **(track, priority)** pair, in this order, by
`v_entry_health` in the database and by `resolveSlaDays()` in
[`src/lib/health.ts`](src/lib/health.ts) — which is a mirror of the view, not a
second opinion:

| Order | Where it lives | Who edits it | Meaning |
| --- | --- | --- | --- |
| 1 | `track_slas (track_id, priority)` | Track editor → **SLA overrides** | This track's own promise for this priority |
| 2 | `vocab_options.sla_days` (priority rows) | Vocabulary screen → the priority's **Service deadline** field | The workspace default for this priority |
| 3 | — | — | No SLA. `sla_due_at` is null and `sla_breached` is false |

Read it as: the track's number wins; where the track is silent the priority
default applies; where neither is set, that priority has no SLA. Both screens
state that sentence on the screen itself.

"Inherit" is the **absence of a row**, not a zero or a sentinel. Clearing the
input in the track editor deletes the override; `sla_days` is `not null check
between 1 and 3650`, so a cell can only ever be "a number" or "no row".

### What it measures, and what it does not

- **The SLA clock starts at `created_at`.** Staleness starts at
  `last_activity_at`. They answer different questions and neither substitutes for
  the other: an item updated hourly for a month is never stale and can still blow
  its SLA; an item finished in an hour and then ignored is stale and never
  breaches.
- **`due_date` is unrelated.** That is what one person promised about one item.
  The SLA is what the workspace promises about a *class* of items.
- **Closed entries never report a breach.** `v_entry_health` has no row for
  `done` or `cancelled`, so the view answers "what is at risk right now". "Was
  this closed late" is a different question, asked of `entries.closed_at`.
- **Breach is strict.** `now() > sla_due_at` — at exactly the deadline the
  commitment has been met, not missed.

### Turning it on and off

Arm a workspace-wide default for one priority, from the vocabulary screen or
directly:

```sql
-- 3 days for every critical item, in every track that does not override it.
update public.vocab_options set sla_days = 3 where kind = 'priority' and key = 'critical';

-- Off again, everywhere that inherits it.
update public.vocab_options set sla_days = null where kind = 'priority' and key = 'critical';
```

Override one track (the track editor does this for you):

```sql
insert into public.track_slas (track_id, priority, sla_days)
select id, 'critical', 1 from public.tracks where name = 'Network'
on conflict (track_id, priority) do update set sla_days = excluded.sla_days;

-- Back to inheriting:
delete from public.track_slas
 where priority = 'critical'
   and track_id = (select id from public.tracks where name = 'Network');
```

What is actually in force, everywhere, in one query:

```sql
select t.name, p.key as priority,
       ts.sla_days as track_override,
       vp.sla_days as priority_default,
       coalesce(ts.sla_days, vp.sla_days) as in_force
  from public.tracks t
 cross join (select key from public.vocab_options where kind = 'priority') p
  left join public.vocab_options vp on vp.kind = 'priority' and vp.key = p.key
  left join public.track_slas ts on ts.track_id = t.id and ts.priority = p.key
 order by t.sort_order, vp.sort_order;
```

### Operational notes

- **Overrides are audited** like tracks and vocabulary: every insert, update and
  delete writes a `config_audit` row with `table_name = 'track_slas'`, the actor,
  and full before/after images. `row_id` is the **track** id, so
  `where table_name = 'track_slas' and row_id = '…'` reads back one track's whole
  SLA history.
- **Deleting a track removes its overrides.** `track_slas.track_id` is
  `on delete cascade` — unlike every other `track_id` FK in the schema, which is
  `on delete set null`. A row here has no content beyond the track it names.
- **RLS:** any member may read the numbers (they are the commitments those
  members are expected to meet); only an admin may write them.
- **Changing a number is retroactive by construction.** Tightening a track's
  critical SLA from 7 days to 1 re-colours every open critical item in that track
  as breached, at once. That is why the change is audited, and why the editor
  shows the resolved value on every row before you save.
- **`0006_track_slas.sql` refuses to finish if the join it adds changes the row
  count of `v_entry_health`.** It compares the view against a plain count of open
  entries and raises. Everything in the file is idempotent, so a failure is
  fix-and-re-run, not a repair job.

---

## Member accounts: usernames, invites and claiming

**This screen is the directory.** There is no Microsoft Entra, no Azure AD, no
Google, no SAML, no LDAP — no external identity provider of any kind, and none is
planned. An account exists because an admin created it here and the member claimed
it; that is the only way one comes into existence, and membership of your company's
tenant grants nothing. The owner chose this deliberately over tenant SSO
(`docs/WAVE5-NOTES.md` §2), and a Wave-4b Entra button was removed whole rather
than left switched off, so there is nothing dormant to discover on the sign-in
screen. If someone asks "can we just use our work logins?", the answer is that
their work login is not what this product trusts — the row you create below is.

Two kinds of account exist and they authenticate completely differently. Nearly
every support question is really a question about which kind you are holding.

|  | **Your account** | **Everyone else** |
| --- | --- | --- |
| Identity | a real email address | a **username** |
| Auth address | that address | `<username>@opstrack.internal` |
| Ways in | password, or a magic link mailed to you | password only |
| Got the password how | you set it in the dashboard | chose it themselves, redeeming a one-time invite code |
| Password reset | **"Forgot your password?" on the sign-in screen** mails a recovery link; the dashboard is the fallback | **the admin reissues a code** — there is no mailbox to send a link to |

`@opstrack.internal` is reserved by RFC 6761 and can never receive mail. That is
the point: it makes it structurally impossible for any feature to quietly grow a
dependency on emailing a member. If a future feature needs to reach them, it has
to reach them somewhere that exists.

The domain keeps the old slug deliberately. It is the stored auth address of every
username account, so renaming it is an account migration, not a find-and-replace —
it happens in the one clean identity cut at launch, with the repo, the URL, the
storage keys and the bundle id (`docs/WAVE5-NOTES.md` §1). No admin ever types it.

### The lifecycle

**1. Issue.** An admin creates the account from **Settings › Team members**. The
username must be 3–32 characters, lowercase letters and digits, with `.` `-` `_`
allowed only in the middle — `ahmed.otaibi` and `it-ops` are fine, `-ops`,
`Ahmed` and `ops.` are not. The reply contains an **invite code, shown exactly
once**: eight characters from a 32-symbol alphabet with `I`, `O`, `0` and `1`
removed, because those are the pairs people transcribe wrong off a screen. Forty
uniform bits.

Only an **HMAC** of `username:CODE` is stored, under a function secret the
database does not hold. There is no "show it again" — the workspace genuinely
cannot recover the code, only replace it.

**2. Hand over.** In person or on a call. Not by email, because the account has no
inbox, and not in a chat log you would not want the code sitting in for a
fortnight. The member goes to the app, taps **First time here? Claim your
account**, and enters the username, the code, and a password of at least 8
characters — length is the only rule, so long beats complicated.

**3. Claim.** One request sets the password *and* burns the code, in a single
write. Two writes would leave a window where the password is already changed but
the invite still verifies, and "the request died halfway" is exactly the case a
single-use credential has to survive. After it, the password is the only
credential and the code is dead.

**4. Reissue** is both the lost-code path and the forgotten-password path, and
there is nothing else. It mints a fresh code with a fresh 14 days, clears the
account's `claimed` flag so the claim screen accepts it again, and resets that
username's throttle bucket so the member is not made to wait out someone else's
failed guesses. A **reissued code un-claims the account**, which is what lets the
claim screen accept a code for it a second time; redeeming it sets the password
the member types there, and that is the reset. **Their old password keeps working
until they redeem it.** `issueCode()` writes `user_metadata` only and never
touches the password, and nothing in the sign-in path reads `claimed` — so a
reissue is a spare key, not a lock change. It is the right remedy for a forgotten
password and the wrong one for a leaked password; for that, delete the account
and create it again.

Codes expire after **14 days** and work **once**.

### What a wrong code costs, and what it does not

Getting this wrong in either direction is easy, so it is worth being explicit
about the shape that shipped.

- **Every failure looks the same.** No such username, not a username account, no
  outstanding invite, wrong code, expired code, already claimed — one `403` with
  one body. Usernames here are guessable by construction (they are handed out in
  person), so the *code* is the secret, and a claim screen that confirmed a
  username exists would be handing out the free half of the pair while the
  attacker works on the other one. The lookup is a single indexed read, so the
  *timing* does not leak either — an earlier version paged through the user list
  and answered a hit faster than a miss, which was the same oracle wearing a
  different hat.
- **A member who forgot they had claimed** therefore gets the same "check both
  fields, or ask your admin" message as anyone else. Slightly worse for them;
  the right advice regardless, since the admin's reissue is the reset.
- **Wrong guesses buy delay, never refusal.** Two free, then 0.25s, 0.5s, 1s,
  2s, 4s and no further, counted in a rolling 15-minute window against both the
  submitted username and the caller's address prefix. **Nobody can be locked
  out**: a member holding a real code always gets in, however many times someone
  else has guessed at their username. An earlier version refused for fifteen
  minutes after ten failures, which meant an attacker could deny a member their
  own account indefinitely, ten requests at a time.
- **The one hard refusal is per-address, not per-account.** A volume ceiling far
  above anything a human reaches answers `429`. It can only shut out the machine
  doing the spraying, and it says nothing about any account.
- **The counter is a database row**, not a field on the user, so two guesses in
  parallel count as two. It is readable and writable only by the service role —
  the anon key ships in every browser bundle, and a counter reachable with it
  would let anyone inflate a stranger's backoff.

**And one thing this shape does *not* buy, stated plainly because an earlier
version of this page implied it did.** The silence above is a property of *the
claim flow*, not of the project. The claim endpoint will not tell you whether a
username exists — and **something else on the same host will**: Supabase's own
password-recovery endpoint answers that question to anyone holding the anon key,
which ships in the browser bundle by design and cannot be taken back. It is a
platform endpoint rather than ours, and switching it off would cost the owner his
emailed sign-in link. **The owner read this and accepted it** (`S5-1` in
[`docs/FIX-BACKLOG.md`](docs/FIX-BACKLOG.md), 31 July 2026), for the reason that
governs the whole design here: a username is not a secret. It is printed beside
every person on the screen you provision from, and its owner types it at every
sign-in. So treat the member list as semi-public, keep the **code** secret — that
part is untouched by any of this — and follow the one operational rule that
comes out of it, in [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §1.2: do not encode
anything sensitive in a username.

### Operating it

Day-to-day commands — create, hand over, reissue, list who has not claimed,
remove — are [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §1, including the raw `curl`
form for when the app itself is the broken thing. Three notes that belong here
rather than there:

- **`list` reports `claimed`, `invite_expires_at`, `last_sign_in_at` and
  `has_profile`.** `has_profile: false` means an auth user exists with no
  `profiles` row — they can authenticate and will see nothing, because every RLS
  policy keys off that row. Delete and re-create them.
- **Removing someone keeps their work.** `owner_id` and `created_by` are
  nullable, so entries, updates and meeting lines survive; the name goes. The
  function refuses to delete you, and refuses to delete the last remaining admin.
- **`set-role` promotes and demotes** through the same function, and it is the
  supported way: it holds the service role, so `guard_profile_role()` lets the
  write through. Three refusals are wired into it, all of them protecting against
  an unrecoverable workspace, since this endpoint is the *only* way an account
  comes into existence: you cannot demote **yourself**, you cannot demote the
  **last remaining admin**, and you cannot demote the **bootstrap address** —
  that one is an admin by the allow-list whatever its row says, so writing
  `member` onto it would only make the screen disagree with the server.

  Role changes are **not** written to `config_audit`. That table covers tracks,
  vocabulary and SLA overrides; `auth.users` and `profiles.role` are outside it.
  If you need a history of who was an admin when, that is a gap, not a query you
  have not found. The SQL statement earlier in this file remains the recovery
  path for when the app cannot be reached at all.

---

## What an admin cannot change — and why

**The entry vocabulary is frozen.** These value lists are fixed in the schema and
have no editor:

- `type` — action, decision, issue, request, change, escalation, note
- `status` — new, in_progress, blocked, waiting_on, done, cancelled
- `priority` — low, medium, high, critical
- `cadence` (recurring templates) — daily, weekly, biweekly, monthly, quarterly,
  custom

This is a decision, not a gap. Four things key off those exact strings:

1. **Terminal statuses.** `done` and `cancelled` are hardcoded in
   `entries_touch()`, `entries_set_closed_at()` and `v_entry_health`. A status
   that is *meant* to close an item but is not in those three lists produces
   entries that are finished and still ageing on the dashboard.
2. **Staleness thresholds.** `v_entry_health` maps priority to a day count
   (critical 2, high 4, medium 8, low 15). An unknown priority silently gets the
   15-day fallback.
3. **The update thread.** `entry_updates` is append-only and stores
   `status_from` / `status_to` as raw text. Under frozen keys a *rename* relabels
   all of that history at render time with zero writes; under editable keys,
   deleting or merging a status leaves history pointing at a value that no longer
   exists.
4. **Translations.** Every value has an `i18n` key in both locale files. A value
   with no key renders as the raw key — in an RTL layout, next to real Arabic.

The specific hazard that settled it: a fully editable status list admits a
two-click merge that rewrites every completed entry in the workspace, with no
undo and no record of what each entry's status used to be.

**Renaming is not blocked.** What you see in the UI is a label, not the stored
value. The vocabulary screen at `/settings/vocabulary` exists for exactly that:
relabel in both languages, recolour, reorder, hide — without touching the keys
underneath. Almost every "I need a different status" turns out to be "I need this
one to say something else", and that is free, instant and audited.

---

## Escape hatch: widening a frozen list

Sometimes it is genuinely a new value. It is possible; it is not a setting. Here
is the honest cost, using "add an entry status `deferred`" as the worked example.

**Every one of these must ship together.** A value in the database with no
translation renders as a raw key; a value in the TypeScript union that the CHECK
rejects is a `23514` at save time.

### Floor: 4 edits

1. **A new migration** (`0003_…sql`, or the next free number) — drop and re-add
   the one named constraint. This is what naming them in 0002 bought you; before
   that it was a lookup against a Postgres-generated identifier.

   ```sql
   alter table public.entries drop constraint if exists entries_status_chk;
   alter table public.entries add constraint entries_status_chk
     check (status in ('new','in_progress','blocked','waiting_on','done','cancelled','deferred'));
   ```

2. `src/types.ts` — add `| 'deferred'` to the `EntryStatus` union.
3. `src/locales/en/status.json` — `status.deferred`.
4. `src/locales/ar/status.json` — `status.deferred`.

   The locale tree is **one JSON file per namespace**, not two big files. It used
   to be `src/locales/en.json` and `ar.json`; those were split during Wave 1 and
   creating them again produces two files nothing imports and a screen full of raw
   dot paths — the exact failure this section warns about, arrived at by following
   this section. Add the key to the *existing* `status.json` in both trees.

   You do **not** need to touch `src/locales/index.ts` for a new key inside an
   existing namespace; that file registers namespaces, and `status` is already
   registered. A brand-new namespace is a different story, and it is the one thing
   here that no gate catches on its own: an unregistered namespace renders every
   one of its strings as its own dot path, in both languages, and the parity gate
   walks the registered list, so it cannot see what is missing.

### If the new value is a *type* or a *priority*, not a status: +1

`type` and `priority` are declared twice — on `entries` and on
`recurring_templates`. Both constraints (`entries_type_chk` **and**
`recurring_templates_type_chk`) have to move together, or a template can never
produce the entry it describes.

**A new *priority* costs one more still: `track_slas_priority_frozen`** in
[`0006_track_slas.sql`](supabase/migrations/0006_track_slas.sql), plus the
`PRIORITIES` list in `src/pages/settings/TrackEditor.tsx`. Miss the CHECK and no
track can ever be given an SLA for the new priority; miss the list and the cell
simply never appears in the editor.

### If the new value is *terminal* (it closes an item): +3

In the same migration, add it to all three lists that decide what "closed" means:

- `entries_touch()` — the `new.status in ('done','cancelled')` test
- `entries_set_closed_at()` — the same test on insert
- `v_entry_health` — `where e.status not in ('done','cancelled')`, which is what
  keeps closed items out of the staleness maths

### The vocabulary seed row: +1, always

`vocab_options` needs a seed row for the new key (`kind`, `key`, `label`,
`label_ar`, colour, sort order), or the value exists but has no presentation and
sorts last with no colour. This is not conditional any more — the table shipped in
`0003` and the vocabulary screen is live at `/settings/vocabulary`, so a value with
no row is a value the admin cannot see, order or recolour.

### Everything that groups by the value

The board's columns and the digest's sections both derive from the vocabulary
rather than from a hardcoded list, so they pick up a new value with no edit —
that was the point of building them that way. But **each one has an overflow
path** for values it did not expect: the board files an unknown or retired option
into a source-only rail that cannot be dropped onto. Add the seed row and the
value behaves; skip it and the value technically works while being undraggable,
which is a worse bug than a missing translation because nothing about it looks
broken.

**So: 5 edits for a plain status, 6 for a type or priority, 8 for a terminal
status** — the floor of four, plus the vocabulary seed row, plus whichever of the
two conditions above apply. All in one commit, all deployed with the migration, in
that order: migration first, then the app.

Also note the number `0003` in the example above is now taken, as is everything
up to `0013`. "The next free number" means exactly that — look in
[`supabase/migrations/`](supabase/migrations) first. Supabase keeps no ledger of
what has been applied, so a duplicated number is not caught by anything.

---

## Recovery: the admin role was lost

**First: check whether there is another admin left**, because if there is, this
whole section is unnecessary — they can promote you back from **Settings › Team
members** in about ten seconds.

```sql
select u.email, p.role from public.profiles p
  join auth.users u on u.id = p.id where p.role = 'admin';
```

The live workspace has run on a single admin, and `set-role` refuses to demote the
last one, so reaching zero takes a hand-written SQL statement or a deleted row.

If that query returns nothing, **nobody can restore the role from the browser**,
and this is by design, not an oversight: `guard_profile_role()` (0001) reverts any
role change made by a caller who holds a JWT and is not already an admin. It
reverts it *silently* — the write reports success and the value does not move.

The one path that works is the **Supabase Dashboard → SQL Editor**, which runs
with `auth.uid()` null. The guard passes JWT-less callers straight through,
deliberately: the SQL Editor and the service role are the only two principals
that are supposed to be able to assign a role.

```sql
-- Restore the admin role. Replace the address; keep it lowercase.
update public.profiles p
   set role = 'admin'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'az.alsaloom@gmail.com';
```

Then confirm it took — if this returns `member`, the update matched no row
(usually the address has never signed in, so there is no `auth.users` row and no
profile yet):

```sql
select u.email, p.role
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.role, u.email;
```

Sign out and back in afterwards. `role` is read once per sign-in.

Re-running `0002_config_foundation.sql` in full does the same thing for the
bootstrap address and is safe at any time — the file is written to be re-runnable
and every seed repair in it is scoped so a second pass matches nothing.

---

## Errors you will meet, and what they mean

The client maps these to translated messages via `src/lib/pgError.ts`; in the SQL
Editor you see them raw.

| Code | Message contains | Meaning |
| --- | --- | --- |
| `23505` | `tracks_name_uidx` | Another track already has that English name (case-insensitive) |
| `23505` | `tracks_name_ar_uidx` | Another track already has that Arabic name. Blank Arabic names never collide — the unique index is partial for exactly that reason |
| `23503` | `track_in_use:` | The track still has entries, meetings or templates. The message carries the counts. Move them, or archive instead of deleting |
| `23514` | `last_active_track` | You tried to archive or delete the last active track. The workspace must always have somewhere to file work |
| `23514` | `tracks_color_chk` | Colour must be a six-digit hex like `#06b6d4` |
| `23514` | `tracks_name_len_chk` | Track name must be 1–40 characters after trimming |
| `23514` | `track_slas_days_range` | An SLA override must be a whole number of days from 1 to 3650. Zero breaches the instant the entry is created; empty the field instead, which deletes the row and inherits |
| `23514` | `track_slas_priority_frozen` | The priority is not one of `low`, `medium`, `high`, `critical`. Only reachable by hand-written SQL — the editor cannot produce it |
| `23514` | `vocab_sla_range` | The same bounds for a *priority default*, in `vocab_options` |
| `42501` | — | Not an admin. If the screen rendered but the write failed, `profiles.role` and the UI disagree: see recovery above |

---

## Three behaviours that surprise people

**Archiving a track pauses its recurring templates; un-archiving replays what was
missed.** `materialize_due_recurring()` skips templates whose track is archived,
and it deliberately does not touch the template's own `active` flag — that switch
belongs to whoever wrote the template, not to the admin retiring a track. But a
skipped template's `next_run_on` is never advanced either, so restoring a track
after three weeks materialises those three weeks of occurrences on the next run
(capped at 60 per template). If that is not what you want, deactivate the
templates before archiving the track.

**"Run now" consumes one occurrence, not the whole backlog.** On a template that
is eleven runs overdue, Run now creates one entry dated today and moves
`next_run_on` forward by exactly one occurrence — so the template is still
overdue afterwards and the scheduler creates the other ten on its next pass,
which is what the overdue banner on the screen says will happen. Discarding a
backlog on purpose is the separate **Skip to <date>** button. Clicking Run now
repeatedly on the same day is a no-op: the due date is anchored to today, so the
`(template_id, due_date)` unique index absorbs the second insert and the schedule
does not advance again.

> This became true only with migration **0008**. Between `0004` and `0008`, one
> Run now click walked `next_run_on` past today in a loop and silently cancelled
> every owed occurrence — measured live: a weekly template 70 days behind
> produced 1 entry instead of 11, with no record of the other 10. If your project
> has not applied `0008`, apply it. Nothing repairs occurrences already lost;
> re-create them by hand from the template if you need them.

**Moving entries between tracks does not count as activity.** `entries_touch()`
bumps `updated_at` on a track change but leaves `last_activity_at` alone, so a
delete-with-reassign cannot launder a hundred stale items into fresh ones. This
is the difference between the bookkeeping clock and the staleness clock, and the
follow-ups screen and the digest both read the second one.

> This became true again only with migration **0007**. Between `0004` and `0007`
> it was false: `0004` added `entries.updated_by` and stamps it from a trigger
> that runs just before `entries_touch()`, and `entries_touch()` did not exclude
> that column from its diff — so it saw its own bookkeeping as a change and
> moved the staleness clock on every track move. If your project has not applied
> `0007`, apply it: `last_activity_at` on any entry moved between tracks since
> `0004` reads later than the work on it actually stopped, and nothing repairs
> the history — only the behaviour from here on.
