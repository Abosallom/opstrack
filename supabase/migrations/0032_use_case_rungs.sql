-- 0032 — the use case rung: Intake → DEV → STG/TEST → COC → PROD
--
-- ── WHY THE LADDER MOVES FROM THE ORGANIZATION TO THE USE CASE ──────────────
--
-- 0026 gave the ORGANIZATION a seven-rung ladder. Two findings retire it.
--
-- ⚠ THE FIRST IS THAT IT WAS NEVER A MEASUREMENT. For 161 of 161 organizations
--   the recorded stage is exactly computable from the use-case cells beside it —
--   all live → Live, none live or testing → Kickoff, otherwise Integrating —
--   with zero exceptions in either direction, and only two distinct
--   `stage_changed_at` values in the whole estate, one per import run. Reporting
--   "37 Live" beside "222 live use cases" told a steering committee ONE FACT
--   TWICE and sounded like corroboration.
--
-- ⚠ THE SECOND IS THAT FOUR OF ITS SEVEN RUNGS WERE UNREACHABLE. Nothing in the
--   source could ever land on Not started, UAT, Go-live readiness or Paused —
--   `scripts/report/rebuild.mjs` says so and refuses to place them, correctly.
--
-- The owner's own words are the replacement, and they are the words his team
-- already writes in ticket titles every day: DEV → STG/TEST → COC → PROD, per
-- use case. `Intake` is prepended as the entry rung — the roughly 1,100 pairs
-- nobody has ever written down have to arrive somewhere, and "written down but
-- not begun" is a different fact from "nobody has said anything", which stays
-- the absence of a row.
--
-- ⚠ COC IS THE CERTIFICATE OF **COMPLETION**, SIGNED BY CHI — the client. Not a
--   Certificate of Conformance and not an internal gate. The waiting party is
--   outside the programme, which is why §11 of docs/OPERATING-MODEL.md gives it
--   its own channel in every view: nobody on this roster moves it by working
--   harder, and painting it the same colour as "your account manager has not
--   touched this in 40 days" points the reader at the wrong person.
--
-- ── WHY `status` IS KEPT AND NOT DROPPED HERE ───────────────────────────────
--
-- `rung` is the new truth and `status` is backfilled into it below. Dropping the
-- old column in the same migration would break every screen in the app on the
-- instant it applied, so it survives one release, unread, and a later migration
-- removes it once nothing selects it. Two columns meaning one thing is the
-- "second answer" this schema refuses elsewhere — so this is a deliberate,
-- time-boxed exception with the removal named, not a permanent pair.

-- ── the rung ────────────────────────────────────────────────────────────────

alter table public.map_node_use_cases
  add column if not exists rung text;

alter table public.map_node_use_cases drop constraint if exists map_node_use_cases_rung_chk;
alter table public.map_node_use_cases add constraint map_node_use_cases_rung_chk
  check (rung is null or rung in ('intake', 'dev', 'stg', 'coc', 'prod'));

comment on column public.map_node_use_cases.rung is
  'How far this organization x use case has got: intake, dev, stg (STG/TEST), coc (Certificate of Completion, awaiting CHI''s signature), prod. ORDER IS THE MEANING — the five values are a ladder and position is how every surface draws it, never a colour. NULL means the row exists but nobody has placed it, which is different from the row not existing at all (nobody has said anything).';

-- ── scope: "not applicable" is a ROW, never a fourth rung ───────────────────
--
-- ⚠ THE DENOMINATOR IS THE ARGUMENT. `useCaseProgress` in src/lib/mapNodes.ts
--   counts against the WHOLE catalogue, so a hospital that will never do
--   radiology reads "4 of 11" for ever and appears permanently 36 percent done.
--   Without a way to say "out of scope" that arithmetic is structurally wrong
--   and no amount of fieldwork can fix it.
--
-- It is NOT a value of `rung`, because rung means HOW FAR ALONG and scope means
-- WHETHER IT APPLIES. Merging them makes "how many are at prod" ambiguous the
-- day somebody asks.
alter table public.map_node_use_cases
  add column if not exists scope text not null default 'in_scope';

alter table public.map_node_use_cases drop constraint if exists map_node_use_cases_scope_chk;
alter table public.map_node_use_cases add constraint map_node_use_cases_scope_chk
  check (scope in ('in_scope', 'not_applicable'));

comment on column public.map_node_use_cases.scope is
  'Whether this use case applies to this organization at all. `not_applicable` leaves the denominator: a hospital with no radiology department reads "6 of 7", not "6 of 11". `rung` is meaningless when scope is not_applicable and readers must skip the row rather than counting it as unstarted.';

-- ── the blockage, which is a FLAG and not a rung ─────────────────────────────
--
-- A record blocked at STG/TEST is still at STG/TEST. Collapsing the two loses
-- exactly the information a reader needs — where it stopped — and it is the same
-- argument 0026 already makes for `map_node_stages.paused` being a flag on a row
-- rather than a word the code compares against.
--
-- Sixty open tickets sit at `Pending on Vendor` today and no view in this
-- product surfaces a single one of them.
alter table public.map_node_use_cases
  add column if not exists blocked_since  date,
  add column if not exists blocked_reason text not null default '',
  add column if not exists pending_with   text not null default '';

alter table public.map_node_use_cases drop constraint if exists map_node_use_cases_blocked_chk;
alter table public.map_node_use_cases add constraint map_node_use_cases_blocked_chk
  check (blocked_since is not null or (btrim(blocked_reason) = '' and btrim(pending_with) = ''));

comment on column public.map_node_use_cases.pending_with is
  'Who we are waiting on, as free text — a vendor, CHI, the hospital, an internal team. Free text and not an FK on purpose: most of the parties this names are outside the workspace, exactly as map_nodes.vendor is.';

-- ── the dates a record actually has ──────────────────────────────────────────
--
-- `date` and not `timestamptz`, for map_node_goals.target_date's stated reason:
-- a commitment is a day somebody named, and an instant would invite a timezone
-- to move it.
--
-- ⚠ NO `owner_id` HERE, DELIBERATELY. It would be 1,551 potential owners in a
--   28-account workspace where 42 organizations do not yet have an account
--   manager. The evidence says it would be as empty as `map_nodes.vendor`, which
--   is filled on 0 of 161 rows after two years. Ownership lives on the
--   organization and is inherited.
alter table public.map_node_use_cases
  add column if not exists target_date       date,
  add column if not exists live_on           date,
  add column if not exists status_changed_at timestamptz;

comment on column public.map_node_use_cases.live_on is
  'The day this use case actually reached PROD at this organization. What makes "what went live this quarter" answerable, which is the question a steering meeting asks and no table in this schema could answer before.';

-- ── the COC queue: the one place the PMO writes ─────────────────────────────
--
-- COC is the rung the PMO itself works — chasing a counter-signature is a PMO
-- job, not integration work — so it is the one rung that needs recording rather
-- than reading.
--
-- ⚠ `coc_contact` IS A NAME AND NOTHING ELSE. No email, no telephone. This
--   workspace holds no staff email addresses by design (usernames are
--   `<name>@opstrack.internal`, which can never resolve) and forbids attachments
--   outright. A contact at CHI is a person OUTSIDE the organization, which is a
--   higher bar than a colleague and not a lower one. A name is what makes a
--   chase possible; contact details belong in whatever system already holds them.
--
-- ⚠ AND THERE IS NO `coc_notes` COLUMN. The chase thread is `entry_updates`,
--   which is already append-only, authored and timestamped against a work item.
--   A fifth column here would be a second thread implementation whose entries
--   could not be attributed to anybody.
alter table public.map_node_use_cases
  add column if not exists coc_submitted_on date,
  add column if not exists coc_contact      text not null default '',
  add column if not exists coc_reference    text not null default '',
  add column if not exists coc_signed_on    date;

comment on column public.map_node_use_cases.coc_submitted_on is
  'When the completion evidence went to CHI. Without it the age of the wait is unknowable, and the age is the entire reason to chase.';

-- ── the history, which is what makes "what moved" answerable ────────────────
--
-- 0026 named this shape and declined to build it: "the full ladder history is
-- not recorded, and if it is ever wanted it is a `map_node_progress_history`
-- table, not a trigger bolted onto this one." It is wanted. Every question a
-- weekly meeting asks is a delta question, and this schema could answer none of
-- them.
--
-- ⚠ NO COMPOSITE FK BACK TO map_node_use_cases. Deleting the link is how "not
--   integrated after all" is expressed (src/api/map.ts DELETEs it), and a
--   cascade would erase the record that the row was ever at PROD. That is
--   0024's own `use_case_id on delete restrict` argument, one table over.
create table if not exists public.map_node_use_case_events (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references public.map_nodes (id) on delete cascade,
  use_case_id uuid not null references public.use_cases (id) on delete restrict,
  rung_from   text check (rung_from is null or rung_from in ('intake', 'dev', 'stg', 'coc', 'prod')),
  rung_to     text check (rung_to   is null or rung_to   in ('intake', 'dev', 'stg', 'coc', 'prod')),
  scope_from  text,
  scope_to    text,
  at          timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null,
  source      text not null default 'local' check (source in ('local', 'jira', 'migration')),
  note        text not null default ''
);

create index if not exists map_node_use_case_events_node_idx on public.map_node_use_case_events (node_id, at desc);
create index if not exists map_node_use_case_events_uc_idx   on public.map_node_use_case_events (use_case_id, at desc);

comment on table public.map_node_use_case_events is
  'Append-only. Every rung and scope change on an organization x use case, with who and when. WRITTEN ONLY BY THE TRIGGER BELOW — insert is revoked from authenticated, on the same doctrine that makes map_node_progress_stage_stamp() the sole writer of stage_changed_at. Time-in-rung is measurable exactly for the rungs this app WATCHED a record enter, which is the honest limit and the reason portfolio/fields.ts discards a clock nobody authored.';

alter table public.map_node_use_case_events enable row level security;

drop policy if exists map_node_use_case_events_select on public.map_node_use_case_events;
create policy map_node_use_case_events_select on public.map_node_use_case_events
  for select using ((select public.is_member()));

grant select on public.map_node_use_case_events to authenticated;
revoke insert, update, delete on public.map_node_use_case_events from authenticated;

create or replace function public.map_node_use_cases_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.rung is distinct from old.rung then
    new.status_changed_at := now();
  end if;

  if tg_op = 'INSERT'
     or new.rung is distinct from old.rung
     or new.scope is distinct from old.scope then
    insert into public.map_node_use_case_events
      (node_id, use_case_id, rung_from, rung_to, scope_from, scope_to, actor_id, source)
    values
      (new.node_id, new.use_case_id,
       case when tg_op = 'INSERT' then null else old.rung end, new.rung,
       case when tg_op = 'INSERT' then null else old.scope end, new.scope,
       (select p.id from public.profiles p where p.id = auth.uid()),
       case when auth.uid() is null then 'migration' else 'local' end);
  end if;

  return new;
end;
$$;

revoke all on function public.map_node_use_cases_stamp() from public, anon;

drop trigger if exists map_node_use_cases_stamp_trg on public.map_node_use_cases;
create trigger map_node_use_cases_stamp_trg
  before insert or update on public.map_node_use_cases
  for each row execute function public.map_node_use_cases_stamp();

-- ── the backfill: 1,540 statuses become rungs ───────────────────────────────
--
-- The mapping is `rebuild.mjs`'s own reading of Jira, run backwards:
--   planned = Open BO / Reopened   → nothing has begun  → intake
--   testing = WIP / Pending Vendor → in flight          → stg
--   live    = Resolved / Closed    → done               → prod
--
-- ⚠ `planned` BECOMES `intake`, NOT `dev`. Planned meant the ticket was open and
--   untouched, which is the entry rung and not "in development". Reading it as
--   dev would report the whole estate as further along than it is on the day
--   this applies.
--
-- ⚠ AND NO `live_on` IS BACKFILLED. Every one of these rows shares one
--   `updated_at` from an import, so filling live_on from it would assert that
--   222 use cases went live on 22 August 2026. That is false, it would look
--   authoritative, and it is 0026's no-backfill argument exactly.
update public.map_node_use_cases
   set rung = case status
                when 'planned' then 'intake'
                when 'testing' then 'stg'
                when 'live'    then 'prod'
              end
 where rung is null;

comment on column public.map_node_use_cases.status is
  'DEPRECATED and unread from the release that follows 0032. Superseded by `rung`, which was backfilled from it here. It survives one release so that applying this migration does not break every screen at the instant it lands; a later migration drops it. Two columns meaning one thing is the "second answer" this schema refuses elsewhere — this is a time-boxed exception with its removal named, not a permanent pair.';

-- ── the XD family is CDA, not four more use cases ───────────────────────────
--
-- The owner, asked directly: "xdrado means rad order, xddocs means clinical
-- notes, etc". So the XD rows are the CDA DELIVERY of use cases already in the
-- list, and Encounter History is what ADT carries. This settles a question this
-- repository has raised in four files and never answered — `rebuild.mjs`
-- recorded that "the FHIR vs CDA distinction is erased" without knowing whether
-- erasing it was right. It was.
--
--   XDLABO           (21 rows) → Lab Order
--   XDRADO           (20 rows) → Radiology Order
--   XDDOCS           (13 rows) → Clinical Notes
--   Encounter History(13 rows) → ADT
--
-- ⚠ THE COLLISION RULE IS `rebuild.mjs`'s, UNCHANGED: prod beats stg beats
--   intake. Lab Order already carries 86 rows and XDLABO 21, so a hospital can
--   hold both. A hospital at PROD over FHIR and intake over CDA is at PROD on
--   Lab Order. Taking the newer row, or preferring the CDA one, would silently
--   demote work already delivered.
--
-- ⚠ AND THE SOURCE ROW IS DELETED, NOT LEFT BESIDE ITS TARGET. Hiding the use
--   case would leave 67 rows still counted by every roll-up that walks the
--   table, double-counting the same work under two names. The deletion is
--   recorded in map_node_use_case_events first, which is what that table is for
--   — this is the migration auditing itself rather than asking to be trusted.

do $$
declare
  pair record;
  rank_of constant jsonb := '{"intake":0,"dev":1,"stg":2,"coc":3,"prod":4}'::jsonb;
begin
  for pair in
    select s.id as src_id, t.id as tgt_id, s.name as src_name, t.name as tgt_name
      from (values ('XDLABO', 'Lab Order'),
                   ('XDRADO', 'Radiology Order'),
                   ('XDDOCS', 'Clinical Notes'),
                   ('Encounter History', 'ADT')) as m(src, tgt)
      join public.use_cases s on lower(btrim(s.name)) = lower(m.src)
      join public.use_cases t on lower(btrim(t.name)) = lower(m.tgt)
  loop
    -- Record every row about to move or vanish, BEFORE it does.
    insert into public.map_node_use_case_events
      (node_id, use_case_id, rung_from, rung_to, source, note)
    select l.node_id, l.use_case_id, l.rung, null, 'migration',
           format('0032: %s merged into %s', pair.src_name, pair.tgt_name)
      from public.map_node_use_cases l
     where l.use_case_id = pair.src_id;

    -- Carry the rung up where the target is absent or stands lower.
    insert into public.map_node_use_cases (node_id, use_case_id, status, rung, scope)
    select l.node_id, pair.tgt_id, l.status, l.rung, l.scope
      from public.map_node_use_cases l
     where l.use_case_id = pair.src_id
    on conflict (node_id, use_case_id) do update
      set rung = case
                   when (rank_of ->> coalesce(excluded.rung, 'intake'))::int
                      > (rank_of ->> coalesce(public.map_node_use_cases.rung, 'intake'))::int
                   then excluded.rung
                   else public.map_node_use_cases.rung
                 end;

    delete from public.map_node_use_cases where use_case_id = pair.src_id;

    -- The use case itself is HIDDEN, never deleted: `use_cases.hidden` already
    -- promises it leaves the pickers without un-tagging what is on it, and a
    -- deleted row would take its name out of every historical event above.
    update public.use_cases set hidden = true where id = pair.src_id;
  end loop;
end $$;

-- ── the eleven, in the owner's own words ────────────────────────────────────
--
-- He listed them himself, and the words matter: this whole exercise began with
-- "what is capablities, i didn't undersatnd the question overall" — the product's
-- central axis was named in a word he does not use. The catalogue now says what
-- his team says out loud.
update public.use_cases set name = 'Rad Report'  where lower(btrim(name)) = 'radiology report';
update public.use_cases set name = 'Rad Order'   where lower(btrim(name)) = 'radiology order';
update public.use_cases set name = 'Lab Result'  where lower(btrim(name)) = 'lab results';

update public.use_cases set hidden = false
 where lower(btrim(name)) in ('adt', 'medication prescribe v1', 'medication prescribe v2',
                              'medication dispense v1', 'medication dispense v2',
                              'rad report', 'rad order', 'lab result', 'lab order',
                              'clinical notes', 'vital signs');

-- ── probes ──────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.use_cases where not hidden;
  if n <> 11 then
    raise exception '0032 probe 1: expected 11 visible use cases, found %', n;
  end if;

  select count(*) into n from public.map_node_use_cases where rung is null;
  if n <> 0 then
    raise exception '0032 probe 2: % rows still have no rung after the backfill', n;
  end if;

  select count(*) into n
    from public.map_node_use_cases l
    join public.use_cases u on u.id = l.use_case_id
   where u.hidden;
  if n <> 0 then
    raise exception '0032 probe 3: % rows still point at a hidden use case', n;
  end if;

  select count(*) into n from public.map_node_use_case_events;
  if n = 0 then
    raise exception '0032 probe 4: the merge recorded nothing, so it audited nothing';
  end if;
end $$;
