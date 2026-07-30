-- 0013 — the roster's USERNAMES, readable by the app.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0012: `create or replace function`
-- everywhere, grants restated every run, and a self-verifying probe block at the
-- bottom that raises if the file did not achieve what it claims.
--
-- NOTHING HERE CHANGES AN EXISTING OBJECT. No table is altered, no policy is
-- rewritten, no trigger is touched. This file only ADDS two functions. Dropping
-- both (`drop function public.member_directory(); drop function
-- public.username_from_email(text);`) returns the database to its 0011 state.
--
--
-- ═══ WHY THIS FILE EXISTS ═══
--
-- The Members screen hands a person a USERNAME — `@zz.smoke.v100` — and that
-- username is the identifier they sign in with and the one tied to their invite
-- code. Then quick capture's `@handle` matched only against `profiles.
-- display_name`, so typing the identifier you were given produced a FREE-TEXT
-- owner: no assignment, no notification, and nothing rendering red. (Release
-- smoke item R4; the seeded example hid it, because `@ahmed` happens to be a
-- prefix of the display name "Ahmed Al-Otaibi".)
--
-- Fixing the matcher is a client change. Fixing the DATA is this file: a
-- username lives in `auth.users` — the account authenticates as
-- `<username>@opstrack.internal` — and PostgREST cannot reach that schema at
-- all. No view, no policy, no join. `listMembers()` had no way to know.
--
--
-- ═══ THE THREE DECISIONS ═══
--
-- 1. A FUNCTION, NOT A COLUMN ON `profiles`.
--    A `profiles.username` column would have to be backfilled, kept in sync by
--    the auth trigger and by `admin-members`, and — this is the part that
--    decides it — GUARDED, because `profiles_update` (0001) lets a member edit
--    their own row. A member who can write their own username can write
--    somebody else's, and the parser would then hand that person's work to
--    them. Deriving from the address at read time has nothing to guard: the
--    address IS the sign-in identity, and changing it is an auth operation, not
--    a profile edit.
--
-- 2. DERIVED FROM `auth.users.email`, NEVER FROM `raw_user_meta_data`.
--    The metadata bag holds a `username` key that `admin-members` writes, and
--    reading it here would be one line shorter. It is also CLIENT-WRITABLE: any
--    signed-in member can PUT /auth/v1/user with `{"data":{"username":"…"}}`.
--    That is the same trap 0001's `handle_new_user()` documents for `role`, one
--    field over, and the consequence is the same class of theft — spoof the
--    lead's handle and quietly collect their assignments. The email cannot be
--    changed to an `@opstrack.internal` address that already exists, and cannot
--    be confirmed at one that does not (the domain receives no mail).
--
-- 3. EVERY MEMBER READS IT, NOT JUST ADMINS.
--    `@handle` resolution happens in the browser, on every keystroke, for
--    everyone who captures — so every client needs the roster's handles. This
--    widens what a signed-in member can see by exactly one field. It is the
--    right trade: usernames are guessable BY CONSTRUCTION (they are handed out
--    in person and typed at sign-in), the INVITE CODE is the secret that stops
--    an account being claimed, and `profiles_select` already shows every member
--    the whole roster. Anon sees nothing: execute is revoked below, and the body
--    gates on `is_member()` regardless.


-- ═══ PART 1 ═══ the derivation, in one place

-- `<username>@opstrack.internal` -> `username`. A real address -> NULL, because
-- the local part of somebody's personal mail is not a handle and must never be
-- rendered as one.
--
-- Mirrors `emailToUsername()` in supabase/functions/admin-members/index.ts
-- exactly, including the lowercase fold: the function and this file are the two
-- places that know the synthetic-domain rule, and they must not disagree about
-- who owns which handle.
--
-- OWNER-ONLY. It is called from inside a SECURITY DEFINER body, so no client
-- role needs execute — PART 3 revokes it from all of them rather than leaving a
-- string helper on the public RPC surface for no reason.
create or replace function public.username_from_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  with e as (select lower(coalesce(p_email, '')) as v)
  select case
           when e.v like '%@opstrack.internal'
            and length(e.v) > length('@opstrack.internal')
           then left(e.v, length(e.v) - length('@opstrack.internal'))
           else null
         end
  from e;
$$;

comment on function public.username_from_email(text) is
  'Synthetic sign-in address -> username; NULL for a real address. Owner-only; '
  'the one definition of the @opstrack.internal rule on the SQL side.';


-- ═══ PART 2 ═══ the roster, with handles

-- Every provisioned member, ordered by display name — the same row set
-- `listMembers()` has always read from `profiles`, plus `username`.
--
-- SECURITY DEFINER because `auth.users` is unreachable any other way, so the
-- gate has to be written by hand: `where public.is_member()` is the exact
-- predicate `profiles_select` uses, and a caller without a profile row gets zero
-- rows rather than an error (an error would answer "does this project have a
-- roster?" to anyone holding the anon key).
--
-- LEFT JOIN, not join. The FK makes a profile without an auth user impossible,
-- and if that ever stops being true the roster must not silently lose the row —
-- a member who vanishes from every owner picker is a worse failure than a null
-- handle.
create or replace function public.member_directory()
returns table (id uuid, display_name text, role text, username text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.display_name,
         p.role,
         public.username_from_email(u.email)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_member()
  order by p.display_name;
$$;

comment on function public.member_directory() is
  'The owner-picker roster plus each account''s username, for @handle capture. '
  'SECURITY DEFINER over auth.users, gated on is_member(); authenticated only.';


-- ═══ PART 3 ═══ grants, restated every run

-- `create or replace` does not reset privileges, but a first run inherits the
-- project default (execute to anon as well), so both are stated explicitly and
-- unconditionally.
revoke all on function public.member_directory() from public;
revoke all on function public.member_directory() from anon;
grant execute on function public.member_directory() to authenticated;
grant execute on function public.member_directory() to service_role;

revoke all on function public.username_from_email(text) from public;
revoke all on function public.username_from_email(text) from anon;
revoke all on function public.username_from_email(text) from authenticated;


-- ═══ PART 4 ═══ the probe

-- Raises if anything above did not take. Writes nothing: the only state it
-- touches is a transaction-local JWT claim, which is how it can prove the gate
-- from both sides — no session sees no rows, a real member sees the roster.
do $prove$
declare
  v_owner   uuid;
  v_rows    bigint;
  v_roster  bigint;
  v_wrong   bigint;
begin
  -- ── the derivation ──
  if public.username_from_email('ZZ.Smoke.V100@OpsTrack.Internal') is distinct from 'zz.smoke.v100' then
    raise exception 'OpsTrack 0013 FAILED: a synthetic address did not fold to its username.';
  end if;
  if public.username_from_email('az.alsaloom@gmail.com') is not null then
    raise exception 'OpsTrack 0013 FAILED: a real address yielded a handle instead of NULL.';
  end if;
  if public.username_from_email(null) is not null
     or public.username_from_email('') is not null
     or public.username_from_email('@opstrack.internal') is not null then
    raise exception 'OpsTrack 0013 FAILED: degenerate input yielded a handle instead of NULL.';
  end if;

  -- ── the grants ──
  if has_function_privilege('anon', 'public.member_directory()', 'execute') then
    raise exception 'OpsTrack 0013 FAILED: anon can execute member_directory().';
  end if;
  if not has_function_privilege('authenticated', 'public.member_directory()', 'execute') then
    raise exception 'OpsTrack 0013 FAILED: authenticated cannot execute member_directory().';
  end if;
  if has_function_privilege('anon', 'public.username_from_email(text)', 'execute')
     or has_function_privilege('authenticated', 'public.username_from_email(text)', 'execute') then
    raise exception 'OpsTrack 0013 FAILED: the helper is reachable from a client role.';
  end if;
  if not exists (
    select 1 from pg_proc where oid = 'public.member_directory()'::regprocedure and prosecdef
  ) then
    raise exception 'OpsTrack 0013 FAILED: member_directory() is not SECURITY DEFINER.';
  end if;

  -- ── the gate, with no session ──
  select count(*) into v_rows from public.member_directory();
  if v_rows <> 0 then
    raise exception 'OpsTrack 0013 FAILED: with no JWT it returned % rows.', v_rows;
  end if;

  -- ── the gate, as a real member ──
  select count(*) into v_roster from public.profiles;
  select id into v_owner from public.profiles order by created_at limit 1;
  if v_owner is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

    select count(*) into v_rows from public.member_directory();
    if v_rows <> v_roster then
      raise exception 'OpsTrack 0013 FAILED: a member saw % of % roster rows.', v_rows, v_roster;
    end if;

    -- Every handle agrees with the address it was derived from, and a real
    -- address carries none.
    select count(*) into v_wrong
      from public.member_directory() d
      left join auth.users u on u.id = d.id
     where d.username is distinct from public.username_from_email(u.email);
    if v_wrong <> 0 then
      raise exception 'OpsTrack 0013 FAILED: % row(s) carry a handle their address does not support.', v_wrong;
    end if;

    perform set_config('request.jwt.claims', '', true);
  end if;

  raise notice
    'OpsTrack 0013: verified — username_from_email() folds the synthetic domain and refuses everything else; '
    'member_directory() is SECURITY DEFINER, execute revoked from anon, returns 0 rows with no session and all % '
    'roster row(s) to a member, every handle matching its sign-in address.', v_roster;
end
$prove$;
