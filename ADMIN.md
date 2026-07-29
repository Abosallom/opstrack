# OpsTrack — administration

What an admin can change from the app, what is deliberately not changeable, what
it costs to change one of those things anyway, and how to recover when the only
admin loses the role.

Everything here assumes the migrations in [`supabase/migrations/`](supabase/migrations)
have been applied in numeric order.

---

## Who is an admin

`profiles.role = 'admin'`. That column is the only admin signal in the entire
system: `is_admin()` reads it for every RLS policy, and `store/auth.ts` reads the
same column for the UI. There is no email allow-list gate any more — see the note
in [`src/lib/admin.ts`](src/lib/admin.ts) for why a second source is worse than
none.

The first admin is promoted by the bootstrap block at the bottom of
[`0002_config_foundation.sql`](supabase/migrations/0002_config_foundation.sql).
It only works if the auth user already exists, so on a brand new project the
order is: run 0001 → run 0002 → sign in once with the admin address → run 0002
again (or just the recovery statement below). 0002 prints a `NOTICE` telling you
which of those three happened.

The allow-list inside `supabase/functions/admin-members/index.ts` is **not** an
admin gate. It decides who may call the member-provisioning edge function with
the service role. Adding an address there does not make anyone an admin.

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

**Members** — provisioned through the `admin-members` edge function (see the
README). The members *screen* is deferred until after entries CRUD.

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
value. Sitting 2 adds a vocabulary screen for exactly that: relabel in both
languages, recolour, reorder, hide — without touching the keys underneath. Almost
every "I need a different status" turns out to be "I need this one to say
something else", and that is free.

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
3. `src/locales/en.json` — `status.deferred`.
4. `src/locales/ar.json` — `status.deferred`.

### If the new value is a *type* or a *priority*, not a status: +1

`type` and `priority` are declared twice — on `entries` and on
`recurring_templates`. Both constraints (`entries_type_chk` **and**
`recurring_templates_type_chk`) have to move together, or a template can never
produce the entry it describes.

### If the new value is *terminal* (it closes an item): +3

In the same migration, add it to all three lists that decide what "closed" means:

- `entries_touch()` — the `new.status in ('done','cancelled')` test
- `entries_set_closed_at()` — the same test on insert
- `v_entry_health` — `where e.status not in ('done','cancelled')`, which is what
  keeps closed items out of the staleness maths

### Once sitting 2 lands: +1

`vocab_options` needs a seed row for the new key (`kind`, `key`, `label`,
`label_ar`, colour, sort order), or the value exists but has no presentation and
sorts last with no colour.

### As later phases land

Anything that groups by the value — the board's column mapping (phase 5), the
digest's sections (phase 8) — gains a case. Neither exists yet; there is nothing
to edit today.

**So: 4 edits for a plain status, 5 for a type or priority, 7 for a terminal
status, plus one more once the vocabulary table exists.** All in one commit, all
deployed with the migration, in that order — migration first, then the app.

---

## Recovery: the admin role was lost

There is exactly one admin. If that role is cleared or downgraded, **nobody can
restore it from the browser**, and this is by design, not an oversight:
`guard_profile_role()` (0001) reverts any role change made by a caller who holds
a JWT and is not already an admin. It reverts it *silently* — the write reports
success and the value does not move.

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
| `42501` | — | Not an admin. If the screen rendered but the write failed, `profiles.role` and the UI disagree: see recovery above |

---

## Two behaviours that surprise people

**Archiving a track pauses its recurring templates; un-archiving replays what was
missed.** `materialize_due_recurring()` skips templates whose track is archived,
and it deliberately does not touch the template's own `active` flag — that switch
belongs to whoever wrote the template, not to the admin retiring a track. But a
skipped template's `next_run_on` is never advanced either, so restoring a track
after three weeks materialises those three weeks of occurrences on the next run
(capped at 60 per template). If that is not what you want, deactivate the
templates before archiving the track.

**Moving entries between tracks does not count as activity.** `entries_touch()`
bumps `updated_at` on a track change but leaves `last_activity_at` alone, so a
delete-with-reassign cannot launder a hundred stale items into fresh ones. This
is the difference between the bookkeeping clock and the staleness clock, and the
follow-ups screen and the digest both read the second one.
