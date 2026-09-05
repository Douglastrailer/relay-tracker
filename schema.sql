-- Accounts: mechanics, shop owners, fleet managers
create table accounts (
  id bigint generated always as identity primary key,
  name text not null unique,
  role text not null check (role in ('mechanic','shop','fleet')),
  company text,
  passcode text not null,
  created_at timestamptz default now()
);

-- Jobs: a service call / breakdown assigned to a mechanic
create table jobs (
  id bigint generated always as identity primary key,
  customer text not null,
  vehicle text not null,
  mechanic text not null,
  dest_lat double precision not null,
  dest_lng double precision not null,
  status text not null default 'assigned' check (status in ('assigned','en_route','on_site','complete')),
  created_at timestamptz default now()
);

-- Locations: each mechanic's latest live position (one row per mechanic, overwritten on update)
create table locations (
  mechanic_name text primary key,
  lat double precision not null,
  lng double precision not null,
  status text default 'available',
  updated_at timestamptz default now()
);

-- Allow the app (using the public anon key) to read and write these tables.
-- This is intentionally open for the prototype stage — before real launch,
-- you'll want proper Row Level Security policies tied to logged-in users.
alter table accounts enable row level security;
alter table jobs enable row level security;
alter table locations enable row level security;

create policy "public read accounts" on accounts for select using (true);
create policy "public insert accounts" on accounts for insert with check (true);

create policy "public read jobs" on jobs for select using (true);
create policy "public insert jobs" on jobs for insert with check (true);
create policy "public update jobs" on jobs for update using (true);

create policy "public read locations" on locations for select using (true);
create policy "public upsert locations" on locations for insert with check (true);
create policy "public update locations" on locations for update using (true);
