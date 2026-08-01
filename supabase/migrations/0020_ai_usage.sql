-- 0020 — ai_usage: the AI capture assist costs money, so the money is MEASURED.
--
-- `capture-assist` (supabase/functions/capture-assist/index.ts) calls the
-- Anthropic Messages API with the owner's own key. Every call is billed to him
-- personally. A feature that spends a person's money without ever telling him
-- how much is not a feature, it is a leak — so this file gives every call a ROW,
-- with the token counts the API itself reported, and gives the function a hard
-- daily ceiling to read before it spends anything.
--
-- THREE THINGS, ALL SMALL:
--
--   1. `public.ai_usage` — one row per (member, day) carrying calls,
--      input_tokens and output_tokens. This is the answer to "what did this
--      cost last week", computed from measurements rather than from a guess.
--   2. `ai_usage_today()` / `ai_usage_record()` — the read the function does
--      BEFORE it spends and the write it does AFTER, both service_role only.
--   3. Two new values on 0010's `claim_counters.scope` check constraint, so the
--      per-minute burst limiter can reuse that table instead of growing a
--      second one with an identical shape and an identical GC problem.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run (or the Management
-- API `/database/query` endpoint). Re-runnable from the top in any state, same
-- discipline as 0001-0019: `create table if not exists`, `add column if not
-- exists`, `drop constraint if exists` before every add, `drop policy if
-- exists` before every create, `create or replace` on every function, explicit
-- `revoke`/`grant` restated every run, and a probe block that rolls its own
-- state back. A re-run must not change a single recorded token, which is
-- trivially true here: there is no seed, and every write path is additive.
--
--
-- ═══ WHY THE DAY IS Asia/Riyadh AND NOT UTC ═══
--
-- `current_date` on this project is UTC, so a UTC day rolls over at 03:00 local
-- for everyone who will ever use this workspace. A member capturing at 01:00
-- would see "0 calls today" while the row they just created sits under
-- yesterday's date, and a daily ceiling would reset in the middle of the night
-- rather than at the start of a working day. The ceiling is a budget a HUMAN
-- reads, so it rolls when that human's day rolls.
--
-- The zone appears in exactly ONE place — `ai_usage_day()` — so changing it is
-- one edit and cannot drift between the reader and the writer. That is the only
-- reason the helper exists; it does nothing else.
--
--
-- ═══ WHY THE COUNTERS REUSE claim_counters, AND THE ONE HAZARD ═══
--
-- The burst limiter needs exactly what 0010 already built: an atomic
-- increment inside a rolling window, a peek that costs nothing, and a bounded
-- GC pass so a spray cannot grow the table without limit. Building a second
-- table with the same three functions would be a second thing to get wrong.
-- So this file widens `claim_counters_scope_ck` by two values and stops there.
--
-- ⚠ HAZARD, STATED RATHER THAN DISCOVERED LATER. `0010_claim_counters.sql` is
-- re-runnable and drops-then-adds that same constraint with its own two-value
-- list. Running 0010 again AFTER this file silently reverts the widening, and
-- every `claim_bump('ai_user', …)` then fails with 23514.
--
-- The blast radius is bounded ON PURPOSE and is worth reading before anyone
-- "fixes" it: `bump()` in capture-assist logs its error and returns, exactly as
-- claim-account's does, so a reverted constraint costs the BURST limiter and
-- nothing else. The DAILY ceiling lives in `ai_usage` below, is read before any
-- spend, and fails CLOSED — so the wallet is still guarded by the guard that
-- actually protects it. The fix is a one-line edit to 0010's constraint list;
-- it is named in the W-AI handoff note because 0010 is not this file's to edit.
--
--
-- ═══ WHAT IS DELIBERATELY NOT HERE ═══
--
-- NO cache_creation/cache_read COLUMNS. Prompt caching needs a 1024-token
-- prefix on Sonnet 5; this prompt is a few hundred tokens of track and member
-- names and will never reach it, so those two columns would be a permanent pair
-- of zeroes inviting the next reader to believe caching was measured and found
-- to be nil. If the prompt ever grows past the minimum, add them then — with a
-- migration, in the same breath as the `cache_control` that earns them.
--
-- NO PROMPT OR RESPONSE TEXT. Not the capture line, not the suggestion, not a
-- hash of either. This table answers "how much" and never "about what": the
-- capture line is the member's raw thought before it is even an entry, and a
-- cost table is the last place it should be durable. The audit trail for what
-- was actually FILED is `entry_updates`, where it belongs.
--
-- NO API KEY, obviously, and nothing derived from one.


-- ═══ PART 1 ═══ the day boundary, in one place

/**
 * Today, in the workspace's timezone. `stable`, never `immutable` — it reads
 * the clock, and marking it immutable would let the planner fold it into an
 * index expression and freeze the answer.
 *
 * See the header for why this is not `current_date`.
 */
create or replace function public.ai_usage_day()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;

comment on function public.ai_usage_day() is
  'The workspace day boundary (Asia/Riyadh) for AI usage accounting. The zone '
  'lives here and nowhere else so the reader and the writer cannot disagree.';


-- ═══ PART 2 ═══ the table

create table if not exists public.ai_usage (
  -- Cascade, not `set null`. This is a spend ledger for a three-person team,
  -- not an authorship record: when a member is removed there is nobody left to
  -- bill and nothing to attribute, and keeping an orphaned row would mean
  -- keeping a per-person usage profile of somebody who has left. Compare
  -- entries.owner_id, which is nullable-on-delete precisely BECAUSE the work
  -- outlives the worker (0012). Cost does not.
  user_id       uuid        not null references public.profiles (id) on delete cascade,
  day           date        not null,
  calls         integer     not null default 0,
  -- bigint, not integer. A year of heavy use is on the order of 10^8 input
  -- tokens per person; int4 tops out at 2.1 × 10^9 and the failure mode of
  -- guessing wrong is an overflow in a bookkeeping row nobody is watching.
  input_tokens  bigint      not null default 0,
  output_tokens bigint      not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id, day)
);

-- Added separately rather than inline so the file stays re-runnable against a
-- table an earlier run already created. Non-negative because every one of these
-- is a count: a negative here means the edge function passed through something
-- the upstream API never said, and the row should refuse rather than record it.
alter table public.ai_usage drop constraint if exists ai_usage_nonneg_ck;
alter table public.ai_usage
  add constraint ai_usage_nonneg_ck
  check (calls >= 0 and input_tokens >= 0 and output_tokens >= 0);

-- "What did the whole team spend last week" is a scan by DAY across every
-- member, and the primary key leads with user_id, so without this it is a seq
-- scan. Descending because every question about cost is asked about the recent
-- past.
create index if not exists ai_usage_day_idx on public.ai_usage (day desc);

comment on table public.ai_usage is
  'Per-member, per-day token accounting for the AI capture assist. Written only '
  'by ai_usage_record() from the capture-assist edge function, using the token '
  'counts the Anthropic API reported. Holds no prompt or response text of any '
  'kind — see 0020''s header.';
comment on column public.ai_usage.day is
  'The workspace day (Asia/Riyadh) from ai_usage_day(), not the UTC date.';


-- ═══ PART 3 ═══ who may see it
--
-- A member may read their OWN row and no one else's. That is not a security
-- boundary this app otherwise draws — permissions are open by design
-- (src/lib/permissions.ts:30) — but a spend ledger is the one thing where
-- "everyone can see everything" turns into "who has been using the AI a lot",
-- and there is no product reason for one intern to be able to ask that about
-- the other. The owner reads the whole table from the SQL editor, as he does
-- for every other operational question.
--
-- The self-select policy also exists so Settings › AI can render "N calls
-- today" without a new migration and without routing a trivial read through an
-- edge function. See the handoff note.

alter table public.ai_usage enable row level security;

revoke all on public.ai_usage from public;
revoke all on public.ai_usage from anon;
revoke all on public.ai_usage from authenticated;

-- SELECT only. Every write goes through ai_usage_record() under the service
-- role, so a client that could INSERT here could forge its own quota headroom.
grant select on public.ai_usage to authenticated;
grant select, insert, update, delete on public.ai_usage to service_role;

drop policy if exists ai_usage_select_self on public.ai_usage;
-- `(select auth.uid())` rather than a bare `auth.uid()`: 0009's InitPlan fix.
-- The bare call is re-evaluated per row, which on a table that will one day
-- hold a row per member per day is a per-row function call for nothing.
create policy ai_usage_select_self on public.ai_usage
  for select using (user_id = (select auth.uid()));


-- ═══ PART 4 ═══ the read before the spend, and the write after it

/**
 * How many assist calls this member has already made today.
 *
 * Read by capture-assist BEFORE it calls the upstream API, and the answer is
 * compared against a hard ceiling. The function deliberately returns 0 rather
 * than null for a member with no row: "no row" and "no calls" are the same
 * fact, and making the caller coalesce is making the caller remember.
 */
create or replace function public.ai_usage_today(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.calls
     from public.ai_usage u
     where u.user_id = p_user
       and u.day = public.ai_usage_day()),
    0
  );
$$;

/**
 * Record one completed assist call and return the member's new daily total.
 *
 * ONE STATEMENT, for the same reason 0010's claim_bump() is one: two parallel
 * captures must not both read n and both write n+1. The `on conflict do update`
 * re-evaluates its SET against the committed row after waiting on any
 * concurrent writer's lock, and `returning` hands back the value THIS caller
 * wrote — so the number the browser is shown is a number that is actually in
 * the table.
 *
 * `greatest(coalesce(…, 0), 0)` on both token counts is not defensive noise: it
 * is the boundary where a number the edge function read out of a third party's
 * JSON stops being untrusted. A missing `usage` object, a null, or a negative
 * lands as zero instead of as a constraint violation that would throw away the
 * call record entirely.
 *
 * IT IS CALLED ONLY AFTER A BILLED CALL SUCCEEDS. A call that timed out or was
 * refused upstream is not recorded here — it is counted by the per-minute
 * `claim_counters` buckets, which is the counter that exists to throttle
 * attempts rather than to account for spend.
 */
create or replace function public.ai_usage_record(
  p_user   uuid,
  p_input  integer,
  p_output integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calls integer;
begin
  insert into public.ai_usage as a (user_id, day, calls, input_tokens, output_tokens, updated_at)
  values (
    p_user,
    public.ai_usage_day(),
    1,
    greatest(coalesce(p_input, 0), 0),
    greatest(coalesce(p_output, 0), 0),
    now()
  )
  on conflict (user_id, day) do update
    set calls         = a.calls + 1,
        input_tokens  = a.input_tokens + greatest(coalesce(p_input, 0), 0),
        output_tokens = a.output_tokens + greatest(coalesce(p_output, 0), 0),
        updated_at    = now()
  returning a.calls into v_calls;

  return v_calls;
end;
$$;

comment on function public.ai_usage_record(uuid, integer, integer) is
  'Record one billed capture-assist call and return the member''s new daily '
  'total. service_role only: a client that could call this could inflate its '
  'own usage, or another member''s, to the daily ceiling.';


-- ═══ PART 5 ═══ the burst-limiter scopes
--
-- 0010's constraint listed exactly ('username', 'ip') because those were the
-- only two dimensions claim-account had. capture-assist adds two more, and they
-- are named rather than folded into the existing ones so that a reader of the
-- table can tell an invite-guessing attempt from an AI call at a glance, and so
-- that clearing one can never clear the other. See the header for the re-run
-- hazard this creates and why its blast radius is bounded.

alter table public.claim_counters drop constraint if exists claim_counters_scope_ck;
alter table public.claim_counters
  add constraint claim_counters_scope_ck
  check (scope in ('username', 'ip', 'ai_user', 'ai_ip'));


-- ═══ PART 6 ═══ grants, restated every run
--
-- A `security definer` function is EXECUTE-able by PUBLIC the moment it is
-- created. Without these lines the anon key that ships inside the built
-- frontend could call ai_usage_record() directly and burn any member's daily
-- ceiling to zero — a denial of service against a feature, using a credential
-- that is public by design.

revoke all on function public.ai_usage_day() from public;
revoke all on function public.ai_usage_day() from anon;
grant execute on function public.ai_usage_day() to authenticated;
grant execute on function public.ai_usage_day() to service_role;

revoke all on function public.ai_usage_today(uuid) from public;
revoke all on function public.ai_usage_today(uuid) from anon;
revoke all on function public.ai_usage_today(uuid) from authenticated;
grant execute on function public.ai_usage_today(uuid) to service_role;

revoke all on function public.ai_usage_record(uuid, integer, integer) from public;
revoke all on function public.ai_usage_record(uuid, integer, integer) from anon;
revoke all on function public.ai_usage_record(uuid, integer, integer) from authenticated;
grant execute on function public.ai_usage_record(uuid, integer, integer) to service_role;


-- ═══ PART 7 ═══ probe
--
-- Everything below rolls its own state back. The write probe uses the reserved
-- day 1999-01-01 — a date `ai_usage_day()` can never return and therefore a row
-- no real call can ever collide with — so a re-run against a live table cannot
-- touch, inflate or delete one recorded token. A probe failure raises, and the
-- raise rolls the whole migration back.

do $prove$
declare
  v_user   uuid;
  v_probe  constant date := date '1999-01-01';
  v_calls  integer;
  v_input  bigint;
  v_ok     boolean;
begin
  -- 1. shape ---------------------------------------------------------------
  if to_regclass('public.ai_usage') is null then
    raise exception 'OpsTrack 0020 FAILED: public.ai_usage does not exist.';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ai_usage' and c.relrowsecurity
  ) then
    raise exception 'OpsTrack 0020 FAILED: RLS is not enabled on ai_usage.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_usage'
      and policyname = 'ai_usage_select_self'
  ) then
    raise exception 'OpsTrack 0020 FAILED: ai_usage_select_self policy is missing.';
  end if;

  -- 2. grants — the anon key must not reach the writers ---------------------
  if has_table_privilege('anon', 'public.ai_usage', 'select') then
    raise exception 'OpsTrack 0020 FAILED: anon can select ai_usage.';
  end if;
  if has_table_privilege('authenticated', 'public.ai_usage', 'insert') then
    raise exception 'OpsTrack 0020 FAILED: authenticated can insert into ai_usage.';
  end if;
  if not has_table_privilege('authenticated', 'public.ai_usage', 'select') then
    raise exception 'OpsTrack 0020 FAILED: authenticated cannot select ai_usage.';
  end if;

  if has_function_privilege('anon', 'public.ai_usage_record(uuid, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ai_usage_record(uuid, integer, integer)', 'execute') then
    raise exception 'OpsTrack 0020 FAILED: ai_usage_record() is reachable with the anon key.';
  end if;
  if has_function_privilege('anon', 'public.ai_usage_today(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.ai_usage_today(uuid)', 'execute') then
    raise exception 'OpsTrack 0020 FAILED: ai_usage_today() is reachable with the anon key.';
  end if;
  if not has_function_privilege('service_role', 'public.ai_usage_record(uuid, integer, integer)', 'execute') then
    raise exception 'OpsTrack 0020 FAILED: service_role cannot execute ai_usage_record().';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.ai_usage_record(uuid, integer, integer)'::regprocedure and prosecdef
  ) then
    raise exception 'OpsTrack 0020 FAILED: ai_usage_record() is not SECURITY DEFINER.';
  end if;

  -- 3. the day boundary is a real date and is not UTC-by-accident ----------
  if public.ai_usage_day() is null then
    raise exception 'OpsTrack 0020 FAILED: ai_usage_day() returned null.';
  end if;
  if public.ai_usage_day() <> (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'OpsTrack 0020 FAILED: ai_usage_day() is not the Riyadh date.';
  end if;

  -- 4. the widened scope constraint ----------------------------------------
  --    Inserted and removed under a reserved bucket prefix no real caller can
  --    produce: a submitted username is matched against USERNAME_RE, which
  --    forbids '$'.
  begin
    insert into public.claim_counters (scope, bucket, n) values ('ai_user', '$probe0020', 1);
    insert into public.claim_counters (scope, bucket, n) values ('ai_ip', '$probe0020', 1);
  exception when check_violation then
    raise exception 'OpsTrack 0020 FAILED: claim_counters still refuses the ai_* scopes.';
  end;
  delete from public.claim_counters where bucket = '$probe0020';

  v_ok := false;
  begin
    insert into public.claim_counters (scope, bucket, n) values ('nonsense', '$probe0020', 1);
  exception when check_violation then
    v_ok := true;
  end;
  delete from public.claim_counters where bucket = '$probe0020';
  if not v_ok then
    raise exception 'OpsTrack 0020 FAILED: claim_counters accepted an unknown scope.';
  end if;

  -- 5. accumulation, on the reserved day -----------------------------------
  select p.id into v_user from public.profiles p order by p.id limit 1;
  if v_user is null then
    raise notice 'OpsTrack 0020: no profiles row — skipping the accumulation probe.';
  else
    delete from public.ai_usage where user_id = v_user and day = v_probe;

    insert into public.ai_usage as a (user_id, day, calls, input_tokens, output_tokens)
    values (v_user, v_probe, 1, 700, 120)
    on conflict (user_id, day) do update
      set calls = a.calls + 1,
          input_tokens = a.input_tokens + 700,
          output_tokens = a.output_tokens + 120;

    insert into public.ai_usage as a (user_id, day, calls, input_tokens, output_tokens)
    values (v_user, v_probe, 1, 700, 120)
    on conflict (user_id, day) do update
      set calls = a.calls + 1,
          input_tokens = a.input_tokens + 700,
          output_tokens = a.output_tokens + 120;

    select calls, input_tokens into v_calls, v_input
    from public.ai_usage where user_id = v_user and day = v_probe;

    if v_calls <> 2 or v_input <> 1400 then
      delete from public.ai_usage where user_id = v_user and day = v_probe;
      raise exception 'OpsTrack 0020 FAILED: upsert did not accumulate (calls=%, input=%).',
        v_calls, v_input;
    end if;

    -- the non-negative constraint actually bites
    v_ok := false;
    begin
      update public.ai_usage set input_tokens = -1 where user_id = v_user and day = v_probe;
    exception when check_violation then
      v_ok := true;
    end;
    if not v_ok then
      delete from public.ai_usage where user_id = v_user and day = v_probe;
      raise exception 'OpsTrack 0020 FAILED: ai_usage accepted a negative token count.';
    end if;

    delete from public.ai_usage where user_id = v_user and day = v_probe;
  end if;

  raise notice 'OpsTrack 0020 OK: ai_usage + ai_usage_day/today/record in place, '
               'writers are service_role-only, members read only their own row, '
               'claim_counters accepts ai_user/ai_ip and still refuses anything else.';
end
$prove$;
