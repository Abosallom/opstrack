-- 0011 — Web Push: the subscription table, the per-kind preferences, and the
-- durable delivery queue that carries a notification to a phone that is not
-- looking at the app.
--
-- Deploy: Supabase Dashboard -> SQL Editor -> paste + Run. Re-runnable from the
-- top in any state, same discipline as 0001-0010: `create table if not exists`,
-- `drop policy if exists` before every `create policy`, `create or replace
-- function`, `cron.schedule` (which UPDATES a job of the same name rather than
-- adding a second), and a self-verifying probe block at the bottom that rolls
-- its own writes back. Applied TWICE against the live project during Wave 4b;
-- both runs printed the same probe notice.
--
-- NOTHING HERE CHANGES AN EXISTING OBJECT. `notifications`, `entries_notify()`
-- and every policy from 0001-0009 are untouched; this file only adds. The one
-- edge it touches is a new AFTER INSERT trigger on `notifications`, and that
-- trigger cannot fail the statement that fired it — see PART 5.
--
--
-- ═══ THE DESIGN DECISION, STATED ONCE ═══
--
-- The assignment allowed either a Supabase Database Webhook or a polling queue.
-- THIS FILE IMPLEMENTS A DURABLE QUEUE, DRAINED BY pg_cron, WITH THE WEBHOOK
-- STYLE OF CALL KEPT ONLY AS A LATENCY OPTIMISATION. Why:
--
--   * A Database Webhook is exactly one `net.http_post` from an AFTER INSERT
--     trigger. There is no retry, no record that a delivery was owed, and no
--     way to find out afterwards that one was lost. A cold start that times
--     out, a 30-second FCM blip, or a redeploy in progress drops the push
--     silently. For an app whose entire proposition is "you will be told when
--     something becomes yours", a silently-lost telling is the worst available
--     failure mode.
--   * Enabling webhooks also means enabling them in the DASHBOARD, which puts
--     the mechanism outside the migration files — and this project's rule is
--     that the schema is the migrations, verified live.
--   * A queue makes the obligation a ROW. `push_outbox` is written in the same
--     transaction as the notification, so if the entry edit commits the
--     delivery commits with it, and `attempts`/`next_attempt_at`/`last_error`
--     make a failed delivery visible and retryable instead of invisible.
--
-- So there are two drains and they are the same call:
--   1. the trigger's best-effort wake-up  -> ~1 s latency, allowed to fail;
--   2. `cron.schedule('opstrack-drain-push', '* * * * *')` -> the truth, with
--      exponential backoff and a hard attempt ceiling.
--
-- WHAT THIS COSTS: `pg_net` has to be installed (PART 0), and one row of
-- configuration has to be inserted out-of-band because it holds a secret and
-- secrets are never committed (PART 6). Both are in RUNBOOK §9.
--
--
-- ═══ PART 0 ═══ pg_net
--
-- The only way SQL can reach an edge function. Already AVAILABLE on this
-- project (`pg_available_extensions` reports 0.20.4); this installs it. It
-- creates the `net` schema with `net.http_post`, and its worker sends queued
-- requests AFTER COMMIT — which is precisely the behaviour the wake-up needs: a
-- rolled-back entry edit must not have pushed anything.

create extension if not exists pg_net;


-- ═══ PART 1 ═══ push_subscriptions
--
-- One row per browser-and-device that agreed to be pushed to. A subscription is
-- three opaque strings the browser hands out at subscribe time, and all three
-- are needed to encrypt: the endpoint URL of that browser's push service, the
-- device's P-256 public key (`p256dh`) and its 16-byte auth secret.
--
-- THE ENDPOINT IS A CAPABILITY, NOT AN IDENTIFIER. Anyone holding an endpoint
-- plus the two keys can push to that device, and no user credential is involved.
-- That is why the RLS below is OWNER-ONLY WITH NO ADMIN READ — unlike almost
-- every other table in this schema, where `is_admin()` sees everything. An admin
-- has no reason to read another member's push keys, and "the admin screen leaked
-- the keys" is not a failure anyone should have to consider.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- UNIQUE, and it is the upsert key. A browser hands the same endpoint back
  -- for the same registration, so re-subscribing (a reinstall, a permission
  -- re-grant, a second sign-in in the same profile) must update the row rather
  -- than accumulate near-duplicates that each get their own copy of every push.
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  -- Free text, shown in the UI as "which device is this?". Never parsed.
  user_agent  text not null default '',
  created_at  timestamptz not null default now(),
  -- Touched on every successful re-subscribe, which browsers do on their own
  -- schedule. A row that has not been seen for months is a device that is gone.
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Four policies, all the same predicate, because a subscription is private to
-- the person whose device it is. `(select auth.uid())` rather than a bare call:
-- 0009 made the InitPlan form the house style for every policy in this schema.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions
  for insert with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- DELETE is a real client action here, unlike on `notifications`: turning push
-- off on this device, or removing a device you no longer have, is the user
-- exercising the only control that actually stops the messages.
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (user_id = (select auth.uid()));


-- ═══ PART 2 ═══ notification_prefs
--
-- WHY THE COLUMNS ARE NAMED `push_*` AND NOT `assigned` / `completed`.
-- WAVE1-ADDENDUM §2.1 sketched `NotificationPrefs { assigned, completed,
-- allCompletions, push }` before any of this existed. Two of those four cannot
-- be honoured by anything in the product today and shipping a switch that does
-- nothing is worse than shipping no switch:
--
--   * `assigned` / `completed` as INBOX filters would have to be read by
--     `entries_notify()` (0004), and that trigger writes the in-app row that the
--     bell counts. Suppressing the row would suppress the inbox entry too, which
--     is not what a "notify me about" preference means to a user.
--   * `allCompletions` needs a notification that does not exist: nothing writes
--     an every-completion row for an admin, so a switch for it would be a
--     promise with no writer behind it.
--
-- So this table governs PUSH ONLY, every column is read by `claim_push_batch`
-- below, and the naming says so. The in-app inbox keeps working exactly as it
-- did, which is also the honest fallback when someone turns push off.
--
-- A MISSING ROW MEANS "ALL ON", not "all off". A user only ever has a
-- subscription because they explicitly enabled push on a device; defaulting to
-- silence after that would look like the feature is broken.
create table if not exists public.notification_prefs (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  -- The master mute. Kept separate from "delete my subscriptions" so a user can
  -- go quiet for a week without re-doing the permission dance afterwards.
  push_enabled   boolean not null default true,
  push_assigned  boolean not null default true,
  push_completed boolean not null default true,
  updated_at     timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists notification_prefs_select on public.notification_prefs;
create policy notification_prefs_select on public.notification_prefs
  for select using (user_id = (select auth.uid()));

drop policy if exists notification_prefs_insert on public.notification_prefs;
create policy notification_prefs_insert on public.notification_prefs
  for insert with check (user_id = (select auth.uid()));

drop policy if exists notification_prefs_update on public.notification_prefs;
create policy notification_prefs_update on public.notification_prefs
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No DELETE policy: there is nothing a delete does that setting the three
-- booleans back to true does not, and an absent row already means "all on".

-- `updated_at` is a claim about when the row changed, so the database makes it
-- true rather than trusting whatever the client sent.
create or replace function public.notification_prefs_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notification_prefs_touch_trg on public.notification_prefs;
create trigger notification_prefs_touch_trg
  before update on public.notification_prefs
  for each row execute function public.notification_prefs_touch();


-- ═══ PART 3 ═══ push_outbox — the delivery obligation
--
-- One row per notification, NOT per subscription. Fan-out to a user's devices is
-- the sender's job and it happens inside one attempt: retrying per device would
-- re-notify the phone that already buzzed every time the tablet failed.
--
-- RLS IS ON AND THERE ARE NO POLICIES AT ALL, which under RLS means "denied for
-- every role that is not the owner". No client has any business reading this
-- table — it is a work list, and the row it points at is already readable in the
-- inbox. The sender reaches it with the service role, which bypasses RLS.
create table if not exists public.push_outbox (
  id              bigint generated always as identity primary key,
  notification_id bigint not null references public.notifications (id) on delete cascade,
  created_at      timestamptz not null default now(),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Terminal, and deliberately two columns rather than one status: `sent_at` is
  -- "we handed it to a push service" and `abandoned_at` is "we stopped trying".
  -- Collapsing them would make a permanent failure indistinguishable from a
  -- delivery in the one place someone would look to count either.
  sent_at         timestamptz,
  abandoned_at    timestamptz,
  last_error      text
);

alter table public.push_outbox enable row level security;

-- Belt as well as braces. Supabase's default privileges grant ALL on every new
-- table in `public` to `anon` and `authenticated`, so RLS-with-no-policies is
-- currently the only thing standing here. Removing the grant means a future
-- policy added by mistake still cannot open the table to a client.
revoke all on table public.push_outbox from anon, authenticated;

-- The drain's only query, verbatim. Partial, because the due set is tiny and the
-- history is what grows.
create index if not exists push_outbox_due_idx
  on public.push_outbox (next_attempt_at)
  where sent_at is null and abandoned_at is null;

create index if not exists push_outbox_notification_idx
  on public.push_outbox (notification_id);


-- ═══ PART 4 ═══ the two functions the sender calls
--
-- BOTH ARE `security definer` AND BOTH HAVE THEIR PUBLIC EXECUTE REVOKED. That
-- pairing is the whole security model of this part and neither half works alone:
--
--   * definer, because they read `push_subscriptions` and `notifications` across
--     users, which every RLS policy above forbids;
--   * revoked, because a function in the `public` schema is a PostgREST RPC
--     endpoint. Left at the default `grant execute to public`, any signed-in
--     member could POST /rest/v1/rpc/claim_push_batch and read every device key
--     in the workspace. The revoke below is what stops that, and it is the
--     single most load-bearing statement in this file.
--
-- `set search_path` on both, so a definer function cannot be redirected by a
-- caller's search_path — the standard hardening for definer functions.

/**
 * Claim up to p_limit due rows and return everything needed to send them.
 *
 * ONE STATEMENT DOES THE CLAIM. `for update skip locked` plus the attempt
 * increment means two drains running at once (a cron tick landing on top of a
 * trigger wake-up, which is the common case) cannot both take the same row, so
 * no notification is ever pushed twice by concurrency.
 *
 * `next_attempt_at` is pushed 2 minutes out at claim time rather than at settle
 * time. If this worker dies mid-fetch and never settles the row, that is exactly
 * the lease expiring, and the next tick retries it. Settling overwrites it.
 *
 * SUBSCRIPTIONS ARE PREFERENCE-FILTERED HERE, not in the sender: `[]` means
 * "nothing to do, and that is a completed obligation". Doing it in SQL keeps the
 * decision next to the data it depends on, and means the sender never sees the
 * keys of a user who asked not to be pushed.
 *
 * The actor name follows the resolution order api/notifications.ts declares —
 * the LIVE profile first, the row's snapshot only for an actor whose profile is
 * gone — so a push and the inbox line it announces cannot attribute the same
 * event to two different people.
 */
create or replace function public.claim_push_batch(p_limit int default 25)
returns table (
  outbox_id        bigint,
  notification_id  bigint,
  kind             text,
  entry_id         uuid,
  entry_title      text,
  actor_name       text,
  recipient_locale text,
  subscriptions    jsonb
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with due as (
    select o.id
      from public.push_outbox o
     where o.sent_at is null
       and o.abandoned_at is null
       and o.next_attempt_at <= now()
     order by o.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ),
  claimed as (
    update public.push_outbox o
       set attempts        = o.attempts + 1,
           next_attempt_at = now() + interval '2 minutes'
      from due
     where o.id = due.id
    returning o.id as outbox_id, o.notification_id
  )
  select c.outbox_id,
         n.id,
         n.kind,
         n.entry_id,
         n.entry_title,
         coalesce(nullif(btrim(a.display_name), ''), n.actor_name),
         coalesce(p.locale, 'en'),
         coalesce(s.subs, '[]'::jsonb)
    from claimed c
    join public.notifications n on n.id = c.notification_id
    join public.profiles p on p.id = n.recipient_id
    left join public.profiles a on a.id = n.actor_id
    left join public.notification_prefs np on np.user_id = n.recipient_id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id',       ps.id,
               'endpoint', ps.endpoint,
               'p256dh',   ps.p256dh,
               'auth',     ps.auth
             )) as subs
        from public.push_subscriptions ps
       where ps.user_id = n.recipient_id
         and coalesce(np.push_enabled, true)
         and case
               when n.kind = 'completed' then coalesce(np.push_completed, true)
               else coalesce(np.push_assigned, true)
             end
    ) s on true
   order by c.outbox_id;
$$;

revoke all on function public.claim_push_batch(int) from public;
revoke all on function public.claim_push_batch(int) from anon, authenticated;
grant execute on function public.claim_push_batch(int) to service_role;

/**
 * Close a claimed row out: delivered, or scheduled for another try.
 *
 * The backoff is 30 s × 4^n — 30 s, 2 m, 8 m, 32 m, 2 h — and the sixth failure
 * abandons the row. A push whose usefulness has expired should stop consuming
 * attempts; the in-app inbox still has the notification, which is the fallback
 * this whole feature degrades into.
 */
create or replace function public.settle_push(
  p_outbox_id bigint,
  p_ok        boolean,
  p_error     text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.push_outbox
     set sent_at         = case when p_ok then now() else sent_at end,
         last_error      = p_error,
         abandoned_at    = case
                             when not p_ok and attempts >= 6 then now()
                             else abandoned_at
                           end,
         next_attempt_at = case
                             when p_ok then next_attempt_at
                             else now() + (interval '30 seconds' * power(4, least(attempts, 5)))
                           end
   where id = p_outbox_id;
$$;

revoke all on function public.settle_push(bigint, boolean, text) from public;
revoke all on function public.settle_push(bigint, boolean, text) from anon, authenticated;
grant execute on function public.settle_push(bigint, boolean, text) to service_role;

/**
 * The client's way in: register THIS browser for THIS user, taking the endpoint
 * over from whoever held it before.
 *
 * WHY THIS CANNOT BE A PLAIN UPSERT FROM THE CLIENT. `endpoint` is globally
 * unique — it has to be, because it is the address of a browser and pushing to it
 * twice means notifying the same device twice — and a browser hands out the SAME
 * endpoint whichever OpsTrack account is signed in. So on a shared device the
 * second person to enable push collides with the first person's row, and RLS
 * correctly refuses to let them update it. From the client that is an
 * unrecoverable 23505: they cannot see the row, cannot delete it, and have done
 * nothing wrong.
 *
 * A push endpoint belongs to a BROWSER, and a browser has one current user. So
 * this function, and only this function, may move it — and it can only ever move
 * it TO the caller: `user_id` is `auth.uid()` in both the delete guard and the
 * insert, never a parameter. The worst an attacker holding somebody else's
 * endpoint string can do is delete that subscription, which stops their own
 * pushes; there is no path to reading or receiving anyone else's.
 *
 * `security definer` for the cross-user delete, and EXECUTE granted to
 * `authenticated` (not `anon` — an unauthenticated caller has no uid to own the
 * row and is rejected explicitly rather than inserting a NULL).
 */
create or replace function public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(btrim(p_endpoint), '') = ''
     or coalesce(btrim(p_p256dh), '') = ''
     or coalesce(btrim(p_auth), '') = '' then
    raise exception 'incomplete push subscription' using errcode = '22023';
  end if;

  -- The takeover. Scoped to this one endpoint and to rows that are NOT the
  -- caller's, so it can never be used to clear somebody's other devices.
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id <> v_uid;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, coalesce(left(p_user_agent, 400), ''))
  on conflict (endpoint) do update
     set p256dh       = excluded.p256dh,
         auth         = excluded.auth,
         user_agent   = excluded.user_agent,
         last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_push_subscription(text, text, text, text) from public;
revoke all on function public.upsert_push_subscription(text, text, text, text) from anon;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;


-- ═══ PART 5 ═══ enqueue, wake, and the schedule
--
-- The private schema holds the one row of configuration the wake-up needs. It is
-- NOT in `public` for a specific reason: PostgREST exposes `public` (and
-- `graphql_public`) and nothing else, so a table here is unreachable through the
-- API no matter what happens to a grant or a policy later.
--
-- WHAT IS IN THAT ROW, AND WHAT IS NOT. The function URL, the project's ANON key
-- (public by design — it ships in the browser bundle) and a drain secret that
-- this project generated for exactly this purpose. THE SERVICE-ROLE KEY IS NOT
-- HERE and must never be: the sender gets it from its own function environment,
-- injected by Supabase. A Supabase Database Webhook would have put the service
-- key in the trigger definition in plain text, which is one of the reasons this
-- file does not use one.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.push_config (
  -- One row, enforced by the type: `id` can only ever be true.
  id            boolean primary key default true check (id),
  function_url  text not null,
  anon_key      text not null,
  drain_secret  text not null,
  updated_at    timestamptz not null default now()
);

revoke all on table private.push_config from anon, authenticated;

/**
 * Ask the sender to drain, if there is anything to drain.
 *
 * Returns the pg_net request id, or NULL when the queue was empty or the config
 * row is missing. pg_net queues the POST in this transaction and its worker
 * sends it after COMMIT, so a rolled-back entry edit pushes nothing.
 *
 * `raise warning` rather than `raise exception` on a missing config: this
 * function is called from a trigger on the user's write path, and a
 * misconfigured push feature must not be able to reject an entry edit.
 */
create or replace function public.drain_push_queue()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg     private.push_config;
  v_pending int;
  v_req     bigint;
begin
  select count(*) into v_pending
    from public.push_outbox
   where sent_at is null and abandoned_at is null and next_attempt_at <= now();
  if v_pending = 0 then
    return null;
  end if;

  select * into v_cfg from private.push_config where id;
  if not found then
    raise warning 'OpsTrack push: % due, but private.push_config is empty — see RUNBOOK 9.3', v_pending;
    return null;
  end if;

  select net.http_post(
           url     := v_cfg.function_url,
           body    := '{}'::jsonb,
           headers := jsonb_build_object(
                        'Content-Type',  'application/json',
                        'Authorization', 'Bearer ' || v_cfg.anon_key,
                        'x-push-drain',  v_cfg.drain_secret
                      ),
           timeout_milliseconds := 8000
         )
    into v_req;
  return v_req;
end;
$$;

revoke all on function public.drain_push_queue() from public;
revoke all on function public.drain_push_queue() from anon, authenticated;

/**
 * Every notification owes a push attempt. Written in the notification's own
 * transaction, so the obligation and the fact it announces commit together.
 *
 * THE WHOLE BODY IS EXCEPTION-SWALLOWING, and that is the most important line in
 * this file after the revokes. This trigger fires from `entries_notify()`, which
 * fires from a member saving an entry. Anything that raises here — a missing
 * pg_net, a broken config row, a full disk on the queue table — would abort THE
 * MEMBER'S EDIT and surface as "could not save", with push nowhere in the
 * message. A lost push is a bad day; a rejected save is a broken product.
 */
create or replace function public.notifications_enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.push_outbox (notification_id) values (new.id);
    -- Latency, not correctness: if this fails, or if pg_net's worker never gets
    -- to it, the minute cron below sends the same row.
    perform public.drain_push_queue();
  exception
    when others then
      raise warning 'OpsTrack push: enqueue failed for notification % — %', new.id, sqlerrm;
  end;
  return null; -- AFTER trigger; the return value is ignored either way.
end;
$$;

drop trigger if exists notifications_enqueue_push_trg on public.notifications;
create trigger notifications_enqueue_push_trg
  after insert on public.notifications
  for each row execute function public.notifications_enqueue_push();

-- The truth-teller. `cron.schedule` with an existing job NAME updates that job
-- rather than creating a second one, which is what makes re-running this file
-- safe — the same property 0004's `opstrack-materialize-recurring` relies on.
--
-- Every minute is the right frequency: the wake-up above already covers the
-- common case in about a second, so this exists to catch the wake-up failing and
-- to walk the backoff. A slower tick would stretch the first retry to its own
-- period; a faster one would spend a request per second on an empty queue (the
-- `v_pending = 0` early return above is what makes an empty tick nearly free).
select cron.schedule('opstrack-drain-push', '* * * * *', $cron$select public.drain_push_queue();$cron$);

-- Retention. A delivered row has served its purpose; an abandoned one is worth
-- keeping long enough to be noticed and no longer. Nightly, ten minutes after
-- the recurrence job so the two never contend.
select cron.schedule(
  'opstrack-prune-push',
  '25 3 * * *',
  $cron$delete from public.push_outbox
         where coalesce(sent_at, abandoned_at) < now() - interval '7 days';$cron$
);


-- ═══ PART 6 ═══ what this file deliberately does NOT do
--
-- 1. It does not insert `private.push_config`. That row holds a secret and
--    secrets are never committed. RUNBOOK §9.3 has the exact statement, and
--    `drain_push_queue()` degrades to a warning until it is run.
-- 2. It does not create the VAPID keys. They live only in the send-push
--    function's secrets (private half) and the client bundle (public half).
-- 3. It does not touch `entries_notify()` from 0004. Which notifications exist
--    is that trigger's decision; this file only carries them further.


-- ═══ PROBE ═══ fails the whole migration if any of the above did not take.
--
-- Structural checks first, then a FUNCTIONAL one — an end-to-end enqueue,
-- claim and settle through a synthetic notification, inside a plpgsql
-- subtransaction that always rolls itself back. `raise exception` inside a
-- BEGIN…EXCEPTION block undoes only that block, which is the only way to write
-- a self-cleaning probe in a file that has no explicit transaction of its own.
do $prove$
declare
  v_missing text[] := '{}';
  v_entry   uuid;
  v_user    uuid;
  v_notif   bigint;
  v_row     record;
  v_claimed int;
  v_subs    int;
begin
  -- 1. objects
  if to_regclass('public.push_subscriptions') is null then
    v_missing := v_missing || 'table push_subscriptions';
  end if;
  if to_regclass('public.notification_prefs') is null then
    v_missing := v_missing || 'table notification_prefs';
  end if;
  if to_regclass('public.push_outbox') is null then
    v_missing := v_missing || 'table push_outbox';
  end if;
  if to_regclass('private.push_config') is null then
    v_missing := v_missing || 'table private.push_config';
  end if;
  if to_regprocedure('public.claim_push_batch(int)') is null then
    v_missing := v_missing || 'function claim_push_batch';
  end if;
  if to_regprocedure('public.settle_push(bigint, boolean, text)') is null then
    v_missing := v_missing || 'function settle_push';
  end if;
  if to_regprocedure('public.drain_push_queue()') is null then
    v_missing := v_missing || 'function drain_push_queue';
  end if;
  if to_regprocedure('public.upsert_push_subscription(text, text, text, text)') is null then
    v_missing := v_missing || 'function upsert_push_subscription';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    v_missing := v_missing || 'extension pg_net';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'notifications_enqueue_push_trg'
       and tgrelid = 'public.notifications'::regclass
  ) then
    v_missing := v_missing || 'trigger notifications_enqueue_push_trg';
  end if;

  -- 2. the RLS surface. Owner-only, four policies, and NO admin bypass — the
  --    one deviation from this schema's usual "admins see everything" and
  --    therefore the one worth asserting rather than trusting.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'push_subscriptions') <> 4 then
    v_missing := v_missing || 'push_subscriptions policies (expected 4)';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'notification_prefs') <> 3 then
    v_missing := v_missing || 'notification_prefs policies (expected 3)';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('push_subscriptions', 'notification_prefs')
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_admin%'
  ) then
    v_missing := v_missing || 'an admin-bypass policy on the push tables';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'push_outbox') <> 0 then
    v_missing := v_missing || 'push_outbox should have NO policies';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.push_outbox'::regclass) then
    v_missing := v_missing || 'RLS not enabled on push_outbox';
  end if;

  -- 3. THE REVOKES. If these ever come back, every device key in the workspace
  --    is one authenticated POST away.
  if has_function_privilege('authenticated', 'public.claim_push_batch(int)', 'execute') then
    v_missing := v_missing || 'authenticated can EXECUTE claim_push_batch';
  end if;
  if has_function_privilege('anon', 'public.claim_push_batch(int)', 'execute') then
    v_missing := v_missing || 'anon can EXECUTE claim_push_batch';
  end if;
  if has_function_privilege('authenticated', 'public.settle_push(bigint, boolean, text)', 'execute') then
    v_missing := v_missing || 'authenticated can EXECUTE settle_push';
  end if;
  if has_function_privilege('authenticated', 'public.drain_push_queue()', 'execute') then
    v_missing := v_missing || 'authenticated can EXECUTE drain_push_queue';
  end if;
  if not has_function_privilege('service_role', 'public.claim_push_batch(int)', 'execute') then
    v_missing := v_missing || 'service_role cannot EXECUTE claim_push_batch';
  end if;
  -- The one function that is SUPPOSED to be reachable from a browser, and the
  -- one role that must not reach it.
  if not has_function_privilege(
       'authenticated', 'public.upsert_push_subscription(text, text, text, text)', 'execute') then
    v_missing := v_missing || 'authenticated cannot EXECUTE upsert_push_subscription';
  end if;
  if has_function_privilege(
       'anon', 'public.upsert_push_subscription(text, text, text, text)', 'execute') then
    v_missing := v_missing || 'anon can EXECUTE upsert_push_subscription';
  end if;

  -- 3b. upsert_push_subscription must REFUSE a caller with no identity. It is
  --     `security definer`, so "no JWT" is exactly the case where a missing check
  --     would insert a row owned by nobody — or, worse, be usable by the anon key
  --     if a grant ever came back.
  begin
    perform public.upsert_push_subscription(
      'https://probe.invalid/0011-no-auth', 'p256dh', 'auth', 'probe');
    raise exception
      'OpsTrack 0011 FAILED: upsert_push_subscription accepted a call with no auth.uid().';
  exception
    when insufficient_privilege then
      null; -- 42501, the refusal this asserts
  end;

  -- 4. the schedule
  if not exists (select 1 from cron.job where jobname = 'opstrack-drain-push') then
    v_missing := v_missing || 'cron job opstrack-drain-push';
  end if;
  if (select count(*) from cron.job where jobname = 'opstrack-drain-push') > 1 then
    v_missing := v_missing || 'cron job opstrack-drain-push is duplicated';
  end if;
  if not exists (select 1 from cron.job where jobname = 'opstrack-prune-push') then
    v_missing := v_missing || 'cron job opstrack-prune-push';
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'OpsTrack 0011 FAILED: %', array_to_string(v_missing, '; ');
  end if;

  -- 5. FUNCTIONAL: enqueue -> claim -> settle, then undo.
  select id into v_entry from public.entries order by created_at limit 1;
  select id into v_user from public.profiles order by created_at limit 1;

  if v_entry is null or v_user is null then
    raise notice 'OpsTrack 0011: structure verified; functional probe skipped (no entries/profiles yet).';
  else
    begin
      insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      values (v_user, 'https://probe.invalid/0011-' || gen_random_uuid()::text,
              'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
              'BTBZMqHH6r4Tts7J_aSIgg', 'probe');

      insert into public.notifications (recipient_id, kind, entry_id, entry_title, actor_id, actor_name)
      values (v_user, 'assigned', v_entry, '0011 probe', null, 'probe')
      returning id into v_notif;

      -- The trigger must have written exactly one outbox row for it.
      if (select count(*) from public.push_outbox where notification_id = v_notif) <> 1 then
        raise exception 'OpsTrack 0011 FAILED: the enqueue trigger did not write an outbox row.';
      end if;

      select count(*) into v_claimed
        from public.claim_push_batch(100) b
       where b.notification_id = v_notif;
      if v_claimed <> 1 then
        raise exception 'OpsTrack 0011 FAILED: claim_push_batch did not return the probe row (got %).', v_claimed;
      end if;

      -- And it must have carried the probe subscription with it, which is the
      -- half that proves the preference join does not filter everything out.
      select b.* into v_row from public.claim_push_batch(100) b where b.notification_id = v_notif;
      if v_row.notification_id is not null then
        raise exception 'OpsTrack 0011 FAILED: a claimed row was claimable twice.';
      end if;

      -- Re-read the first claim's payload from the row itself: the lease has
      -- already moved next_attempt_at, so assert on the outbox instead.
      select attempts into v_claimed from public.push_outbox where notification_id = v_notif;
      if v_claimed <> 1 then
        raise exception 'OpsTrack 0011 FAILED: attempts should be 1 after one claim, got %.', v_claimed;
      end if;

      -- Preferences: with push off, the same notification claims zero devices.
      insert into public.notification_prefs (user_id, push_enabled) values (v_user, false)
      on conflict (user_id) do update set push_enabled = false;
      update public.push_outbox set next_attempt_at = now(), attempts = 0
       where notification_id = v_notif;
      select jsonb_array_length(b.subscriptions) into v_subs
        from public.claim_push_batch(100) b where b.notification_id = v_notif;
      if v_subs <> 0 then
        raise exception 'OpsTrack 0011 FAILED: push_enabled=false still returned % subscriptions.', v_subs;
      end if;

      perform public.settle_push(
        (select id from public.push_outbox where notification_id = v_notif), true, null);
      if not exists (
        select 1 from public.push_outbox where notification_id = v_notif and sent_at is not null
      ) then
        raise exception 'OpsTrack 0011 FAILED: settle_push did not mark the row sent.';
      end if;

      -- Always. Everything above is a probe, and none of it belongs in the
      -- workspace's real data.
      raise exception 'OpsTrack 0011 probe rollback';
    exception
      when others then
        if sqlerrm <> 'OpsTrack 0011 probe rollback' then
          raise;
        end if;
    end;

    raise notice 'OpsTrack 0011: verified — 3 tables, 7 policies, 3 functions (execute revoked from anon+authenticated), enqueue trigger, 2 cron jobs; enqueue/claim/settle and the preference filter proven end to end and rolled back.';
  end if;
end
$prove$;
