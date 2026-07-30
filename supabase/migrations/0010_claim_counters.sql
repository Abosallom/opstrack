-- 0010 — the claim throttle stops being a read-modify-write and becomes a row.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0009: `create table if not exists`,
-- `create or replace function`, explicit `revoke`/`grant` every time, and a
-- self-verifying probe block at the bottom that fails the whole migration if
-- the shape it just created is not the shape it promised.
--
-- NO EXPLICIT `begin;`/`commit;`, on purpose and like 0006, 0008 and 0009. The
-- SQL Editor runs a pasted file as one implicit transaction, which is what lets
-- the probe fail the WHOLE migration — the promise RUNBOOK 5.2 makes about
-- probe-bearing files: "a probe failure means the migration did not take."
--
--
-- ═══ WHY ═══ FIX-BACKLOG S1c, and its own source comment agreeing
--
-- `claim-account` throttled wrong invite guesses by counting them in the target
-- account's `user_metadata`, through the GoTrue admin API:
--
--     read  meta.claim_fail_count            (listUsers / getUserById)
--     write meta.claim_fail_count = n + 1    (updateUserById)
--
-- There is no compare-and-set anywhere in that API, and the function's own
-- header said so in as many words: "It does not make it ATOMIC, and it cannot
-- be… If the throttle ever has to bound guesses exactly, the counter has to
-- move out of the metadata bag and into a row this project can
-- `update … returning` atomically." Two guesses issued in parallel read the
-- same n and both write n+1, so the ceiling bounded ROUNDS of concurrent
-- guessing, each round arbitrarily wide. This file is that row.
--
-- `insert … on conflict do update set n = c.n + 1 … returning c.n` is one
-- statement. Under READ COMMITTED the second writer blocks on the first's row
-- lock, then re-evaluates the SET against the row version the first COMMITTED —
-- so two concurrent bumps return 1 and 2, never 1 and 1. That is the whole
-- point of the table and it is what the migration's probe and the live curl
-- probe in the handoff both check.
--
--
-- ═══ WHAT IS COUNTED ═══ two dimensions, and neither one can lock anybody out
--
-- SCOPE 'username' — keyed on the SUBMITTED USERNAME STRING, never on a user
-- id, and this is a security property rather than a convenience. If the counter
-- only existed for accounts that exist, then "did my eleventh guess get
-- throttled?" would answer "does this username exist?" — the exact enumeration
-- oracle (S1a) the rewrite of claim-account exists to close. A guess at a
-- username nobody ever registered has to cost the same and be counted the same
-- as a guess at a real one, so the key is the string.
--
-- SCOPE 'ip' — keyed on a PEPPERED HASH of the caller's address prefix (/24
-- for IPv4, /48 for IPv6), computed in the edge function. The prefix rather
-- than the address because rotating inside a subnet is free; the hash rather
-- than the address because this table would otherwise be a log of who tried to
-- sign in from where, and it never needs to be readable as one.
--
-- NEITHER DIMENSION EVER REFUSES A CLAIM. That is S1b: the old per-account
-- ceiling meant ten wrong guesses locked a known username out of claiming for
-- fifteen minutes, the admin's remedy (reissue) cleared the counter, and the
-- attacker could burn it again in ten more requests — a renewable denial of
-- service against a member who did nothing. The counter now buys DELAY, not
-- refusal: the edge function turns n into an exponential backoff, capped, and
-- then processes the request anyway. A member holding a real code always gets
-- in; an attacker pays geometrically for every guess.
--
-- The one exception is deliberately not account-shaped: a per-IP volume ceiling
-- far above anything a human reaches, which answers 429. It keys on the
-- CALLER's own address, so it can only ever shut out the machine doing the
-- spraying, and it tells that machine nothing about any account.
--
--
-- ═══ WHO MAY TOUCH IT ═══
--
-- Supabase's default privileges grant every new public table to `anon` and
-- `authenticated`, and a `security definer` function is executable by PUBLIC
-- unless you say otherwise. Either default would hand the open internet a way
-- to inflate somebody else's backoff with the anon key that ships in the built
-- frontend. So: RLS on with NO policies, explicit revokes on the table, and
-- EXECUTE revoked from public/anon/authenticated on all three functions and
-- granted only to service_role — which is the only principal the edge
-- functions use to reach this schema.

-- ── the table ──────────────────────────────────────────────────────────────

create table if not exists public.claim_counters (
  -- 'username' or 'ip'. Two dimensions in one table rather than two tables:
  -- they have identical lifecycles, identical GC and one bump function.
  scope        text        not null,
  -- The username as submitted (lowercased, length-capped by the caller) or the
  -- peppered hex of an address prefix. Opaque here on purpose.
  bucket       text        not null,
  n            integer     not null default 0,
  -- Start of the ROLLING window. A bump that arrives after the window has
  -- elapsed resets both this and n in the same statement, so an expired window
  -- costs no separate cleanup pass to be correct.
  window_start timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (scope, bucket)
);

-- Added separately rather than inline so the file stays re-runnable against a
-- table that already exists from an earlier run.
alter table public.claim_counters drop constraint if exists claim_counters_scope_ck;
alter table public.claim_counters
  add constraint claim_counters_scope_ck check (scope in ('username', 'ip'));

-- The GC below deletes by age; without this it is a seq scan on every bump.
create index if not exists claim_counters_updated_idx
  on public.claim_counters (updated_at);

comment on table public.claim_counters is
  'claim-account failure counters. Two scopes: username (the submitted string, '
  'so a nonexistent account throttles identically to a real one) and ip (a '
  'peppered hash of the caller address prefix). Bumped only through '
  'claim_bump(); service_role only.';

-- RLS with zero policies is the deny-all. Nothing in the app reads this table;
-- the edge functions reach it as service_role, which bypasses RLS, so an empty
-- policy set costs nothing and closes the default grants below it.
alter table public.claim_counters enable row level security;

revoke all on public.claim_counters from public;
revoke all on public.claim_counters from anon;
revoke all on public.claim_counters from authenticated;
grant select, insert, update, delete on public.claim_counters to service_role;

-- ── bump: the atomic increment ─────────────────────────────────────────────

/**
 * Count one failure and return the count.
 *
 * ONE STATEMENT. The `on conflict do update` re-evaluates its SET against the
 * committed row after waiting on any concurrent writer's lock, which is the
 * compare-and-set the GoTrue admin API could not offer. `returning` hands back
 * the value this caller actually wrote, so two racing guesses see 1 and 2.
 *
 * The window reset lives inside the same CASE rather than in a preceding
 * `delete … where window_start < …`: a separate statement would be a second
 * chance to interleave, and the whole reason this function exists is that
 * two-statement counters do not hold.
 */
create or replace function public.claim_bump(
  p_scope text,
  p_bucket text,
  p_window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n      integer;
  v_cutoff timestamptz := now() - make_interval(secs => p_window_seconds);
begin
  -- Bounded, index-backed, and best-effort: a spray against random usernames
  -- would otherwise grow this table without limit. 100 rows per call keeps the
  -- cost flat and the table converges because every attempt does one pass.
  delete from public.claim_counters
  where ctid in (
    select ctid from public.claim_counters
    where updated_at < now() - interval '1 day'
    limit 100
  );

  insert into public.claim_counters as c (scope, bucket, n, window_start, updated_at)
  values (p_scope, left(p_bucket, 200), 1, now(), now())
  on conflict (scope, bucket) do update
    set n            = case when c.window_start < v_cutoff then 1 else c.n + 1 end,
        window_start = case when c.window_start < v_cutoff then now() else c.window_start end,
        updated_at   = now()
  returning c.n into v_n;

  return v_n;
end;
$$;

-- ── peek: the count without paying for it ──────────────────────────────────

/**
 * The live count, or 0 if there is none or the window has elapsed.
 *
 * Read-only by design. The edge function calls this BEFORE doing any work, to
 * decide how long to sleep; making that decision through claim_bump() would
 * mean a successful claim increments the failure counter, and would let a
 * throttled attacker keep paying one write per request — turning the throttle
 * into the amplifier.
 */
create or replace function public.claim_peek(
  p_scope text,
  p_bucket text,
  p_window_seconds integer
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.n
     from public.claim_counters c
     where c.scope = p_scope
       and c.bucket = left(p_bucket, 200)
       and c.window_start >= now() - make_interval(secs => p_window_seconds)),
    0
  );
$$;

-- ── reset: what an admin's remedy clears ───────────────────────────────────

/**
 * Drop one bucket's counter.
 *
 * `admin-members` calls this for the USERNAME scope when it issues or reissues
 * a code, so an admin saying "here is a new code, try again" is telling the
 * truth about the very next attempt. It deliberately has no reach into the 'ip'
 * scope: clearing that on reissue would hand a sprayer a free reset, which is
 * the shape of the bug S1b was.
 */
create or replace function public.claim_reset(p_scope text, p_bucket text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.claim_counters
  where scope = p_scope and bucket = left(p_bucket, 200);
$$;

-- ── lookup: the other half of "identical failures" ─────────────────────────

/**
 * The four invite facts `claim-account` needs about one synthetic address.
 *
 * WHY THIS EXISTS AND IS NOT A CONVENIENCE. The GoTrue admin API has no "get
 * user by email", so the function paged `listUsers({perPage: 200})` up to five
 * times and scanned. That is a TIMING ORACLE of exactly the kind S1a is about:
 * past 200 accounts, a hit on page 1 returns after one round trip and a miss
 * returns after five, so "how long did my 403 take" answers "does this username
 * exist" — and no amount of making the RESPONSES identical fixes it. It also
 * capped the workspace at 1000 accounts, silently: user 1001 could never claim.
 * One indexed lookup answers in the same time either way.
 *
 * THE RETURN SHAPE IS THE WHOLE BLAST RADIUS, so it is four columns and not
 * `raw_user_meta_data`. Nothing here is a credential: `invite_hash` is an HMAC
 * under a secret this database does not hold, and the rest is bookkeeping. The
 * display name, `created_by` and every other key stay where they are.
 *
 * `security definer` because `auth.users` is not reachable from PostgREST and
 * not readable by any app role — which is the point. EXECUTE is service_role
 * only, asserted by the probe below on every re-run.
 */
create or replace function public.claim_lookup(p_email text)
returns table (
  user_id           uuid,
  invite_hash       text,
  invite_issued_at  text,
  invite_alg        text,
  claimed           boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.raw_user_meta_data ->> 'invite_hash',
    u.raw_user_meta_data ->> 'invite_issued_at',
    u.raw_user_meta_data ->> 'invite_alg',
    coalesce((u.raw_user_meta_data ->> 'claimed')::boolean, false)
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

-- ── grants ─────────────────────────────────────────────────────────────────
--
-- A `security definer` function is EXECUTE-able by PUBLIC the moment it is
-- created. Without these four lines the anon key in the built frontend could
-- call claim_bump() directly and inflate any member's backoff, or call
-- claim_reset() and erase an attacker's.

revoke all on function public.claim_bump(text, text, integer) from public;
revoke all on function public.claim_bump(text, text, integer) from anon;
revoke all on function public.claim_bump(text, text, integer) from authenticated;
grant execute on function public.claim_bump(text, text, integer) to service_role;

revoke all on function public.claim_peek(text, text, integer) from public;
revoke all on function public.claim_peek(text, text, integer) from anon;
revoke all on function public.claim_peek(text, text, integer) from authenticated;
grant execute on function public.claim_peek(text, text, integer) to service_role;

revoke all on function public.claim_reset(text, text) from public;
revoke all on function public.claim_reset(text, text) from anon;
revoke all on function public.claim_reset(text, text) from authenticated;
grant execute on function public.claim_reset(text, text) to service_role;

revoke all on function public.claim_lookup(text) from public;
revoke all on function public.claim_lookup(text) from anon;
revoke all on function public.claim_lookup(text) from authenticated;
grant execute on function public.claim_lookup(text) to service_role;

-- ── probe ──────────────────────────────────────────────────────────────────
--
-- Everything below rolls its own state back by deleting the buckets it created;
-- it uses a reserved prefix no real caller can produce (a submitted username is
-- matched against USERNAME_RE, which forbids `$`).

do $prove$
declare
  c_bucket constant text := '$probe$0010';
  v_a          integer;
  v_b          integer;
  v_peek       integer;
  v_bad        text;
  v_any_email  text;
  v_any_id     uuid;
begin
  -- 1. increments, and RETURNS what it wrote.
  delete from public.claim_counters where bucket = c_bucket;
  v_a := public.claim_bump('username', c_bucket, 900);
  v_b := public.claim_bump('username', c_bucket, 900);
  if v_a <> 1 or v_b <> 2 then
    raise exception 'OpsTrack 0010 FAILED: claim_bump returned %, % — expected 1, 2.', v_a, v_b;
  end if;

  -- 2. peek sees the live count and does not change it.
  v_peek := public.claim_peek('username', c_bucket, 900);
  if v_peek <> 2 then
    raise exception 'OpsTrack 0010 FAILED: claim_peek returned % — expected 2.', v_peek;
  end if;
  if public.claim_peek('username', c_bucket, 900) <> 2 then
    raise exception 'OpsTrack 0010 FAILED: claim_peek is not read-only.';
  end if;

  -- 3. an elapsed window resets to 1 rather than continuing to climb — the
  --    difference between a rolling throttle and a permanent lockout.
  update public.claim_counters
    set window_start = now() - interval '2 hours'
  where scope = 'username' and bucket = c_bucket;
  v_a := public.claim_bump('username', c_bucket, 900);
  if v_a <> 1 then
    raise exception 'OpsTrack 0010 FAILED: an expired window bumped to % — expected 1.', v_a;
  end if;
  if public.claim_peek('username', c_bucket, 900) <> 1 then
    raise exception 'OpsTrack 0010 FAILED: the window did not move with the reset.';
  end if;

  -- 4. peek ignores a window that has elapsed.
  update public.claim_counters
    set window_start = now() - interval '2 hours'
  where scope = 'username' and bucket = c_bucket;
  if public.claim_peek('username', c_bucket, 900) <> 0 then
    raise exception 'OpsTrack 0010 FAILED: claim_peek honoured an expired window.';
  end if;

  -- 5. reset removes the row.
  perform public.claim_bump('ip', c_bucket, 900);
  perform public.claim_reset('ip', c_bucket);
  if exists (select 1 from public.claim_counters where scope = 'ip' and bucket = c_bucket) then
    raise exception 'OpsTrack 0010 FAILED: claim_reset left the row behind.';
  end if;

  -- 6. the scope check is real.
  begin
    insert into public.claim_counters (scope, bucket) values ('nonsense', c_bucket);
    raise exception 'OpsTrack 0010 FAILED: claim_counters_scope_ck did not fire.';
  exception
    when check_violation then null;
  end;

  delete from public.claim_counters where bucket = c_bucket;

  -- 7. the lookup answers, and answers nothing for an address that is not there.
  if (select count(*) from public.claim_lookup('$probe$0010@opstrack.internal')) <> 0 then
    raise exception 'OpsTrack 0010 FAILED: claim_lookup invented a user.';
  end if;
  select u.email into v_any_email from auth.users u order by u.created_at limit 1;
  if v_any_email is not null then
    select l.user_id into v_any_id from public.claim_lookup(v_any_email) l;
    if v_any_id is null or v_any_id <> (select u.id from auth.users u where u.email = v_any_email) then
      raise exception 'OpsTrack 0010 FAILED: claim_lookup did not resolve an existing address.';
    end if;
  end if;

  -- 8. nobody but service_role may execute the four functions, and neither
  --    anon nor authenticated may read the table. This is the check that would
  --    catch the Supabase default grants creeping back in on a restore.
  --
  --    PUBLIC is not named: `has_*_privilege` takes a real role and rejects the
  --    pseudo-role, and it does not need to be named — a grant to PUBLIC is a
  --    grant anon and authenticated both inherit, so asking about them asks
  --    about PUBLIC too.
  select string_agg(format('%s→%s', p.proname, g.grantee), ', ')
    into v_bad
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as g(grantee)
  where ns.nspname = 'public'
    and p.proname in ('claim_bump', 'claim_peek', 'claim_reset', 'claim_lookup')
    and has_function_privilege(g.grantee, p.oid, 'execute');
  if v_bad is not null then
    raise exception 'OpsTrack 0010 FAILED: EXECUTE still granted — %.', v_bad;
  end if;

  select string_agg(format('%s→%s', g.grantee, p.priv), ', ')
    into v_bad
  from (values ('anon'), ('authenticated')) as g(grantee)
  cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)
  where has_table_privilege(g.grantee, 'public.claim_counters', p.priv);
  if v_bad is not null then
    raise exception 'OpsTrack 0010 FAILED: table privilege still granted — %.', v_bad;
  end if;

  if not (
    select relrowsecurity from pg_class
    where oid = 'public.claim_counters'::regclass
  ) then
    raise exception 'OpsTrack 0010 FAILED: RLS is not enabled on claim_counters.';
  end if;

  raise notice
    'OpsTrack 0010: claim_counters present, bump atomic and windowed, peek read-only, '
    'reset clears, RLS on, EXECUTE service_role-only.';
end
$prove$;
