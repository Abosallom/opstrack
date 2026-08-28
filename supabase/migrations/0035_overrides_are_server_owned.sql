-- 0035 — `map_node_use_cases.overrides` stops being the client's to write.
--
-- ── THE BUG THIS CLOSES, WHICH 0024 PREDICTED IN CAPITALS ──────────────────
--
-- `src/api/map.ts` has carried this paragraph since 0024:
--
--   THE SET FORM IS THE APPEND FORM TODAY … `status` is the only field of this
--   row a person can edit, so the array is only ever `[]` or `['status']` and
--   writing it whole is writing the union. THE DAY A SECOND FIELD BECOMES
--   EDITABLE HERE, THIS LINE IS WRONG — it would drop the other entry — and the
--   fix is a read-modify-write or a Postgres `array_agg` in an RPC, because
--   PostgREST cannot union an array in an upsert.
--
-- 0032 made `rung` and `scope` that second and third field, so the day has
-- arrived. Two account managers on the same organization — one setting a rung,
-- one setting a target date — each send the whole array they read when they
-- opened the panel, and the second write silently drops the first's entry.
--
-- ⚠ AND THE CONSEQUENCE IS NOT COSMETIC. `overrides` is the per-field editing
--   contract: a field named there was edited BY A PERSON and a future Jira sync
--   must not overwrite it. `JiraEffect.held` (src/lib/jira/map.ts) is that
--   promise rendered on the preview screen. A dropped entry means the sync
--   quietly takes back a field somebody owns — and the failure is invisible
--   until a sync that does not exist yet runs against it, which is the worst
--   possible time to discover it.
--
-- ── WHY THE TRIGGER AND NOT A READ-MODIFY-WRITE IN THE CLIENT ─────────────
--
-- A read-modify-write is still a lost update; it only narrows the window. And
-- provenance written by whichever client remembered to write it is not
-- provenance. This is the doctrine the schema already follows everywhere else:
-- `status_changed_at`, `map_node_use_case_events`, `map_nodes.updated_by` and
-- `entries`' own stamps are all server-owned, and `src/api/map.test.ts` records
-- the house rule as "a server-owned column sent by mistake is OVERRULED rather
-- than accepted".
--
-- ── AND WHY IT IS GATED ON `auth.uid()` ───────────────────────────────────
--
-- Only a PERSON's edit marks a field as held. The service role — the importer,
-- a future sync, `scripts/report/grid.mjs` — has no `auth.uid()`, and its writes
-- must leave `overrides` exactly as they found it. That is the same gate the
-- stamp function already uses one block up to choose between 'local' and
-- 'migration', so the two cannot drift apart about who is writing.

-- ── the function ────────────────────────────────────────────────────────────
--
-- Replaces 0032's body verbatim and appends the overrides block. `create or
-- replace` rewrites the WHOLE body, so anything not repeated here would be
-- silently dropped — 0016's own warning, which is why the first two blocks
-- below are copied rather than referenced.
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

  -- ── 0035: the union, computed here so no client can get it wrong ─────────
  --
  -- ⚠ A PERSON'S EDIT ONLY. `auth.uid()` is null for the service role, and a
  --   sync marking its own writes as human-held would make `held` meaningless
  --   in exactly the direction that matters.
  if auth.uid() is not null then
    new.overrides := (
      select coalesce(array_agg(distinct field), '{}')
        from unnest(
          -- What was already held, PLUS whatever this statement changed. The
          -- union is why an edit on one screen cannot drop an edit made on
          -- another: nothing is ever removed here, only added.
          coalesce(case when tg_op = 'INSERT' then '{}' else old.overrides end, '{}')
          || array_remove(array[
               case when tg_op = 'INSERT' or new.rung           is distinct from old.rung           then 'rung'           end,
               case when tg_op = 'INSERT' or new.scope          is distinct from old.scope          then 'scope'          end,
               case when                     new.blocked_since  is distinct from old.blocked_since  then 'blocked_since'  end,
               case when                     new.blocked_reason is distinct from old.blocked_reason then 'blocked_reason' end,
               case when                     new.pending_with   is distinct from old.pending_with   then 'pending_with'   end,
               case when                     new.target_date    is distinct from old.target_date    then 'target_date'    end,
               case when                     new.live_on        is distinct from old.live_on        then 'live_on'        end,
               case when                     new.coc_submitted_on is distinct from old.coc_submitted_on then 'coc_submitted_on' end,
               case when                     new.coc_contact    is distinct from old.coc_contact    then 'coc_contact'    end,
               case when                     new.coc_reference  is distinct from old.coc_reference  then 'coc_reference'  end,
               case when                     new.coc_signed_on  is distinct from old.coc_signed_on  then 'coc_signed_on'  end
             ], null)
        ) as field
    );
  end if;

  return new;
end;
$$;

revoke all on function public.map_node_use_cases_stamp() from public, anon;

-- The trigger itself is unchanged; re-stated so a workspace that somehow lost it
-- gets it back, on 0032's own idempotence habit.
drop trigger if exists map_node_use_cases_stamp_trg on public.map_node_use_cases;
create trigger map_node_use_cases_stamp_trg
  before insert or update on public.map_node_use_cases
  for each row execute function public.map_node_use_cases_stamp();

comment on column public.map_node_use_cases.overrides is
  'Fields a PERSON has edited here since the last sync — server-owned from 0035, computed as a union by map_node_use_cases_stamp(). A client value is overruled. Written only when auth.uid() is not null, so the importer and any future sync leave it untouched: a sync that marked its own writes as human-held would make JiraEffect.held meaningless in the one direction that matters.';

-- ── probe ───────────────────────────────────────────────────────────────────
do $$
declare body text;
begin
  select prosrc into body from pg_proc where proname = 'map_node_use_cases_stamp';
  if body is null then
    raise exception '0035 probe: map_node_use_cases_stamp() is missing';
  end if;
  -- The three things that make this migration what it is. A later `create or
  -- replace` that drops one of them silently returns the lost update.
  if position('array_agg(distinct field)' in body) = 0 then
    raise exception '0035 probe: the overrides union is not in the function body';
  end if;
  if position('status_changed_at := now()' in body) = 0 then
    raise exception '0035 probe: 0032''s rung stamp was dropped by this rewrite';
  end if;
  if position('map_node_use_case_events' in body) = 0 then
    raise exception '0035 probe: 0032''s event log write was dropped by this rewrite';
  end if;
end $$;
