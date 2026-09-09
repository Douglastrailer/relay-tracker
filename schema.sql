-- ============================================================
-- RELAY v2 SCHEMA — run this in Supabase SQL Editor
-- If you have the old tables from v1, drop them first:
--   drop table if exists jobs cascade;
--   drop table if exists locations cascade;
--   drop table if exists accounts cascade;
-- ============================================================

-- Profiles: one row per real Supabase Auth user, holding their role/company
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null unique,
  role text not null check (role in ('mechanic','shop','fleet')),
  company text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Jobs: a service call, linked to the mechanic by real id (not by name)
create table jobs (
  id bigint generated always as identity primary key,
  customer text not null,
  vehicle text not null,
  mechanic_id uuid not null references profiles(id),
  dest_lat double precision not null,
  dest_lng double precision not null,
  status text not null default 'assigned' check (status in ('assigned','en_route','on_site','complete')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Locations: one row per mechanic, their latest live position
create table locations (
  mechanic_id uuid primary key references profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  status text default 'available',
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table jobs enable row level security;
alter table locations enable row level security;

-- ---------- profiles ----------
-- Anyone logged in can see names/roles/companies (needed for assignment
-- dropdowns and matching) but can only change their OWN row, except shop
-- owners can also toggle a mechanic's active flag (see below).
create policy "profiles_read_authenticated" on profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

create policy "profiles_shop_can_update_any" on profiles
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'shop')
  );

-- ---------- jobs ----------
create policy "jobs_shop_read_all" on jobs
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'shop')
  );

create policy "jobs_mechanic_read_own" on jobs
  for select using (mechanic_id = auth.uid());

create policy "jobs_fleet_read_own_company" on jobs
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'fleet'
        and lower(trim(p.company)) = lower(trim(jobs.customer))
    )
  );

create policy "jobs_shop_insert" on jobs
  for insert with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'shop')
  );

create policy "jobs_shop_update_any" on jobs
  for update using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'shop')
  );

create policy "jobs_mechanic_update_own" on jobs
  for update using (mechanic_id = auth.uid())
  with check (mechanic_id = auth.uid());

create policy "jobs_shop_delete" on jobs
  for delete using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'shop')
  );

-- ---------- locations ----------
create policy "locations_mechanic_insert_own" on locations
  for insert with check (mechanic_id = auth.uid());

create policy "locations_mechanic_update_own" on locations
  for update using (mechanic_id = auth.uid());

create policy "locations_mechanic_read_own" on locations
  for select using (mechanic_id = auth.uid());

create policy "locations_shop_read_all" on locations
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'shop')
  );

create policy "locations_fleet_read_assigned" on locations
  for select using (
    exists (
      select 1 from jobs j
      join profiles p on p.id = auth.uid() and p.role = 'fleet'
      where j.mechanic_id = locations.mechanic_id
        and lower(trim(p.company)) = lower(trim(j.customer))
        and j.status != 'complete'
    )
  );
