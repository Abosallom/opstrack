-- 0034 — the hospital information system, as a catalogue
--
-- The owner asked to group the map by HIS. There was no such field, and the
-- nearest thing — `map_nodes.vendor`, free text since 0023 — is filled on 0 of
-- 161 rows after two years.
--
-- ── WHY A TABLE AND NOT A TEXT COLUMN ───────────────────────────────────────
--
-- ⚠ `vendor` IS THE CONTROL EXPERIMENT AND IT FAILED. `lib/mindtree/model.ts`
--   already records why it trails every other grouping: "it is free text with no
--   declared order and no guarantee that two spellings of one company are one
--   bucket". The entire value of "group by HIS" IS the bucket. Cerner / CERNER /
--   Oracle Cerner / Oracle Health as four cohorts is worse than no grouping at
--   all, because it looks like an answer.
--
-- ── WHY HIS AND VENDOR ARE TWO FIELDS ───────────────────────────────────────
--
-- The owner: "2 is usually right, but sometime it can become different." An HIS
-- is the product a hospital RUNS; a vendor is the integrator doing the work on
-- it. Usually the same company, sometimes not — and the question HIS answers,
-- "if we fix the ADT profile for this system, how many hospitals does that
-- unblock", is not answerable from the integrator.
--
-- ⚠ RHAPSODY IS NOT AN HIS AND MUST NEVER BE SEEDED AS ONE. It is named 93 times
--   in ticket text and would top any frequency ranking — because it is the
--   integration engine OUR OWN technical team builds in: "requesting the
--   technical team to build the interface in rhapsody to the needed hospital".
--   It is our tool, not a property of a hospital. Seeding it would tag most of
--   the estate with one meaningless value and make this axis useless on its
--   first day.

create table if not exists public.his_products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_ar    text not null default '',
  -- The company that MAKES it, free text for `vendor`'s stated reason: a
  -- supplier is a company outside this workspace and cannot be an FK to anything
  -- in it.
  supplier   text not null default '',
  sort_order int not null default 0,
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists his_products_name_uidx on public.his_products (lower(btrim(name)));
create unique index if not exists his_products_name_ar_uidx on public.his_products (lower(btrim(name_ar))) where btrim(name_ar) <> '';

comment on table public.his_products is
  'The hospital information systems the organizations run. `use_cases`'' shape exactly, including `hidden`: hiding leaves the pickers and never un-tags an organization already on it. NOT the integrator — that is map_nodes.vendor, and they are usually the same company and sometimes not.';

alter table public.map_nodes
  add column if not exists his_id uuid references public.his_products (id) on delete set null;

comment on column public.map_nodes.his_id is
  'Which hospital information system this organization runs. ON DELETE SET NULL, never restrict: retiring a product nobody runs any more must not make an organization undeletable, and `hidden` is how you stop offering it. NULL on 142 of 161 rows on the day this ships — the data names an HIS for only 16, which is a finding rather than a gap to be filled by guessing.';

alter table public.his_products enable row level security;

-- vocab.edit to shape the catalogue, member-read — `use_cases`' split, because
-- this IS a catalogue: what the programme is, rather than how it is going.
drop policy if exists his_products_select on public.his_products;
create policy his_products_select on public.his_products
  for select using ((select public.is_member()));

drop policy if exists his_products_write on public.his_products;
create policy his_products_write on public.his_products
  for all using ((select public.has_perm('vocab.edit')))
  with check ((select public.has_perm('vocab.edit')));

grant select on public.his_products to authenticated;
grant insert, update, delete on public.his_products to authenticated;

-- ── the seed, and every name in it was measured ─────────────────────────────
--
-- Taken from `scripts/report/his.mjs`, which reads only the names the owner's
-- own data already carries — in organization names like `Makkah 1 (Careware)`,
-- `Aseer (Vida Plus)` and `Andakusia His`, and in ticket text. Nothing here is
-- invented, and Rhapsody is absent for the reason set out above.
insert into public.his_products (name, name_ar, sort_order)
values ('Careware',      'كير وير',       1),
       ('Vida Plus',     'فيدا بلس',      2),
       ('InterSystems',  'إنترسيستمز',    3),
       ('TrakCare',      'تراك كير',      4),
       ('MedicaCloud',   'ميديكا كلاود',  5),
       ('Epic',          'إيبك',          6),
       ('Cerner',        'سيرنر',         7),
       ('Oracle Health', 'أوراكل هيلث',   8),
       ('Andalusia HIS', 'الأندلسية',     9),
       ('Malaffi',       'ملفي',         10),
       ('Mirth',         'ميرث',         11)
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.his_products;
  if n < 11 then raise exception '0034 probe: expected at least 11 HIS products, found %', n; end if;
end $$;
