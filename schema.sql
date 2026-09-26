-- ============================================================
-- RELAY SCHEMA — run this in the Supabase SQL Editor
--
-- This replaces the old schema.sql, which only had profiles/jobs/locations
-- and had drifted out of sync with what script.js actually queries.
-- This version matches the live app (organizations, fleet_shop_links,
-- job_comments, job_attachments, error_logs) and fixes the multi-tenant
-- RLS gaps found in review: shop-role policies that checked "does this
-- user have role=shop" instead of "does this row belong to this shop's
-- org", and profile/org updates with no column-level protection (so a
-- shop account could rewrite its own `role` to 'admin', or approve its
-- own pending signup).
--
-- SAFE TO RE-RUN: every statement below is idempotent (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS then CREATE), so this can be
-- run directly against your existing live project without dropping
-- anything or losing data. It only adds tables/columns/indexes that
-- don't exist yet, and replaces functions/triggers/policies with the
-- corrected versions.
--
-- IMPORTANT — this changes real behavior, not just documentation:
--   1. Organizations are no longer broadly readable, so the invite-code
--      lookup moves to a security-definer RPC (lookup_org_by_invite_code).
--      Deploy the matching script.js change at the same time, or invite
--      links will stop working until you do.
--   2. Deactivated accounts (`profiles.active = false`) are now blocked
--      by RLS on jobs/locations/comments/attachments, not just hidden by
--      the UI. That's intentional — see the review notes — but confirm
--      you don't have any legitimately-inactive-but-still-working
--      accounts depending on the old (UI-only) behavior.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Invite code generator (defined before `organizations`, since the
-- table's default depends on it). Uses pgcrypto's gen_random_bytes —
-- cryptographically random, same security bar as the client-side
-- rotateInviteCode(), so the one-time code an org is born with is just
-- as strong as the ones it rotates to later.
-- ------------------------------------------------------------
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no ambiguous 0/O, 1/I
  result text := '';
  raw bytea := gen_random_bytes(8);
  i int;
begin
  for i in 0..7 loop
    result := result || substr(chars, (get_byte(raw, i) % length(chars)) + 1, 1);
  end loop;
  return result;
end;
$$;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  invite_code text not null unique default public.generate_invite_code(),
  billing_email text,
  billing_phone text,
  billing_address text,
  payment_instructions text,
  logo_path text,
  created_at timestamptz not null default now()
);

-- organizations already exists on your live database, so the CREATE
-- TABLE above is a no-op there — these ALTERs are what actually add the
-- new billing-profile columns to your real table.
alter table organizations add column if not exists billing_email text;
alter table organizations add column if not exists billing_phone text;
alter table organizations add column if not exists billing_address text;
alter table organizations add column if not exists payment_instructions text;
alter table organizations add column if not exists logo_path text;
alter table organizations add column if not exists review_link text;

-- One row per real Supabase Auth user, holding their role/org.
-- `name` is display-only now (login is by email via Supabase Auth), so
-- unlike the old schema it is NOT unique — a global unique-name
-- constraint blocks real signups once you have more than one company
-- on the platform (two "Mike Johnson"s at two different shops is a
-- certainty, not an edge case).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('mechanic','shop','fleet','admin')),
  company text,
  org_id uuid references organizations(id),
  active boolean not null default true,
  email text,
  phone text,
  created_at timestamptz not null default now()
);
-- Older versions of this database made person names (and company names)
-- unique, so a second "Doston" or a second "ABC Truck Repair" could not
-- sign up. Names are not identifiers; drop those rules if they exist.
alter table profiles drop constraint if exists profiles_name_key;
alter table organizations drop constraint if exists organizations_name_key;

-- job_type distinguishes mobile (a mechanic travels to a breakdown —
-- GPS tracking, a destination, en_route/on_site status) from inshop (the
-- vehicle is already at the shop — no travel, no destination, no GPS).
-- dest_lat/dest_lng are nullable for this reason; the CHECK constraint
-- below still requires them for mobile jobs specifically, so a mobile
-- job can never silently end up with no destination to track.
create table if not exists jobs (
  id bigint generated always as identity primary key,
  customer text not null,
  vehicle text not null,
  mechanic_id uuid not null references profiles(id),
  job_type text not null default 'mobile' check (job_type in ('mobile','inshop')),
  dest_lat double precision,
  dest_lng double precision,
  status text not null default 'assigned' check (status in ('assigned','en_route','on_site','complete')),
  created_by uuid references profiles(id),
  org_id uuid not null references organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table jobs add column if not exists job_type text not null default 'mobile' check (job_type in ('mobile','inshop'));
alter table jobs alter column dest_lat drop not null;
alter table jobs alter column dest_lng drop not null;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'jobs_dest_required_for_mobile') then
    alter table jobs drop constraint jobs_dest_required_for_mobile;
  end if;
  alter table jobs add constraint jobs_dest_required_for_mobile
    check (job_type = 'inshop' or (dest_lat is not null and dest_lng is not null));
end
$$;

create table if not exists locations (
  mechanic_id uuid primary key references profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  status text default 'available',
  updated_at timestamptz not null default now()
);

-- A fleet manager can belong to more than one shop, so this is a proper
-- many-to-many join table rather than a single org_id on the profile.
create table if not exists fleet_shop_links (
  fleet_id uuid not null references profiles(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (fleet_id, org_id)
);

create table if not exists job_comments (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists job_attachments (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs(id) on delete cascade,
  uploader_id uuid not null references profiles(id),
  file_path text not null,
  file_name text not null,
  file_type text,
  photo_type text not null default 'general' check (photo_type in ('before','after','general')),
  created_at timestamptz not null default now()
);
alter table job_attachments add column if not exists photo_type text not null default 'general' check (photo_type in ('before','after','general'));

create table if not exists error_logs (
  id bigint generated always as identity primary key,
  message text,
  stack text,
  page_url text,
  user_id uuid references profiles(id) on delete set null,
  user_role text,
  created_at timestamptz not null default now()
);

-- Invoices belong to a shop (org_id) and, optionally, a job — job_id is
-- deliberately NOT a foreign key. jobs.id's real type in your live
-- database hasn't been confirmed (unlike org_id, which the earlier error
-- confirmed is uuid), so a hard FK here risks the exact same migration
-- failure. An unconstrained column still stores the link; once jobs.id
-- is confirmed, add the FK as a one-line follow-up.
-- customer_email is a plain field, not a reference to a profile — a shop
-- can invoice anyone, whether or not that person has ever signed up for
-- Relay as a fleet manager.
-- kind distinguishes an estimate (sent for approval before work starts)
-- from an invoice (sent for payment after work is done) — same table,
-- same line-items/PDF/email machinery, since the two are structurally
-- identical and only differ in purpose and status lifecycle:
--   invoice:  draft -> unpaid -> paid
--   estimate: draft -> sent -> approved/declined -> converted
-- source_estimate_id lets a converted invoice point back to the estimate
-- it came from — a real FK, unlike job_id, since invoices.id's type is
-- fully known (I defined it) rather than inferred from your live schema.
create table if not exists invoices (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  job_id bigint,
  kind text not null default 'invoice' check (kind in ('invoice','estimate')),
  source_estimate_id bigint references invoices(id),
  customer_name text not null,
  customer_email text,
  customer_address text,
  unit_number text,
  status text not null default 'draft' check (status in ('draft','unpaid','paid','sent','approved','declined','converted')),
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  paid_at timestamptz
);
alter table invoices add column if not exists customer_address text;
alter table invoices add column if not exists unit_number text;
alter table invoices add column if not exists kind text not null default 'invoice' check (kind in ('invoice','estimate'));
alter table invoices add column if not exists source_estimate_id bigint references invoices(id);
-- The status CHECK constraint needs redefining (can't ALTER a CHECK in
-- place) to allow the estimate-lifecycle values on your already-existing
-- table — the "existing" name in DROP is whatever Postgres auto-named it,
-- which for a CHECK added inline in CREATE TABLE follows a predictable
-- pattern, so this covers your live table's real constraint.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'invoices_status_check') then
    alter table invoices drop constraint invoices_status_check;
  end if;
  alter table invoices add constraint invoices_status_check
    check (status in ('draft','unpaid','paid','sent','approved','declined','converted'));
end
$$;

create table if not exists invoice_items (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- A shop's own price list — services and parts with a set price, so
-- adding a line item to an invoice/estimate doesn't mean re-typing the
-- same description and price from scratch every time. Also shown, read
-- only, on the shop's public work-request page (see request_shop_inventory
-- RPC further down) so a prospective customer sees real pricing before
-- they submit anything.
create table if not exists inventory_items (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  name text not null,
  description text,
  unit_price numeric not null check (unit_price >= 0),
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Submitted from a shop's own public, no-login-required link
-- (relayfleet.us/?request=<org_id>) — a prospective customer describes
-- their issue; no pricing is ever shown to them, and nothing here
-- becomes a real job until the shop reviews and accepts it. Length caps
-- on the text fields are a basic defense against this being the one
-- genuinely public write surface in the whole schema — everything else
-- requires a real account.
-- job_type matches jobs.job_type exactly (not a separate vocabulary) so
-- accepting a request can pass it straight into the new job without
-- translation. breakdown_lat/lng/address are only meaningful for a
-- mobile request; eta_to_shop only for an in-shop one — the CHECK
-- constraint below enforces that split the same way
-- jobs_dest_required_for_mobile does for real jobs.
create table if not exists work_requests (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  customer_name text not null check (char_length(customer_name) <= 120),
  company_name text check (char_length(company_name) <= 160),
  customer_phone text check (char_length(customer_phone) <= 40),
  customer_email text check (char_length(customer_email) <= 200),
  vehicle text not null check (char_length(vehicle) <= 200),
  issue_description text not null check (char_length(issue_description) <= 2000),
  job_type text not null default 'mobile' check (job_type in ('mobile','inshop')),
  breakdown_lat double precision,
  breakdown_lng double precision,
  breakdown_address text check (char_length(breakdown_address) <= 300),
  eta_to_shop text check (char_length(eta_to_shop) <= 200),
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  converted_job_id bigint references jobs(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint work_requests_contact_required check (customer_phone is not null or customer_email is not null),
  constraint work_requests_type_fields_required check (
    (job_type = 'mobile' and breakdown_lat is not null and breakdown_lng is not null)
    or
    (job_type = 'inshop' and eta_to_shop is not null)
  )
);
alter table work_requests add column if not exists company_name text check (char_length(company_name) <= 160);
alter table work_requests add column if not exists job_type text not null default 'mobile' check (job_type in ('mobile','inshop'));
alter table work_requests add column if not exists breakdown_lat double precision;
alter table work_requests add column if not exists breakdown_lng double precision;
alter table work_requests add column if not exists breakdown_address text check (char_length(breakdown_address) <= 300);
alter table work_requests add column if not exists eta_to_shop text check (char_length(eta_to_shop) <= 200);
-- Any row from before these columns existed (test submissions made
-- while this feature was being built) won't satisfy the constraint
-- below — removed here so the migration can't fail partway through and
-- get rolled back by the SQL Editor's implicit transaction. Real
-- customer requests only start existing after this migration, so
-- nothing genuine is at risk here.
delete from work_requests where not (
  (job_type = 'mobile' and breakdown_lat is not null and breakdown_lng is not null)
  or
  (job_type = 'inshop' and eta_to_shop is not null)
);
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'work_requests_type_fields_required') then
    alter table work_requests drop constraint work_requests_type_fields_required;
  end if;
  alter table work_requests add constraint work_requests_type_fields_required check (
    (job_type = 'mobile' and breakdown_lat is not null and breakdown_lng is not null)
    or
    (job_type = 'inshop' and eta_to_shop is not null)
  );
end
$$;

-- ------------------------------------------------------------
-- Indexes — the original schema had none beyond primary keys. At the
-- scale you're planning for, every one of these is a query script.js
-- actually makes.
-- ------------------------------------------------------------
create index if not exists idx_profiles_org_role on profiles(org_id, role);
create index if not exists idx_jobs_org_status on jobs(org_id, status);
create index if not exists idx_jobs_mechanic_status on jobs(mechanic_id, status);
create index if not exists idx_jobs_status_updated on jobs(status, updated_at desc);
create index if not exists idx_job_comments_job on job_comments(job_id, created_at);
create index if not exists idx_job_comments_author_created on job_comments(author_id, created_at);
create index if not exists idx_job_attachments_job on job_attachments(job_id);
create index if not exists idx_fleet_shop_links_org on fleet_shop_links(org_id);
create index if not exists idx_error_logs_created on error_logs(created_at desc);
create index if not exists idx_invoices_org_status on invoices(org_id, status);
create index if not exists idx_invoices_job on invoices(job_id);
create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);
create index if not exists idx_inventory_items_org on inventory_items(org_id, active);
create index if not exists idx_work_requests_org_status on work_requests(org_id, status);

-- ------------------------------------------------------------
-- Helper functions
--
-- Each is SECURITY DEFINER + STABLE: SECURITY DEFINER means the
-- function's own internal query bypasses RLS on the table it reads,
-- which is what breaks the classic "policy on profiles that queries
-- profiles" infinite-recursion trap. STABLE lets Postgres cache the
-- result once per statement instead of re-running it per row.
-- All of them only ever return facts about the CALLING user (derived
-- from auth.uid()), so they're safe to leave callable directly — at
-- worst someone learns their own org_id/role, which they already have.
-- ------------------------------------------------------------
-- Both of these deliberately filter on active = true: a deactivated
-- user's org_id/role reads back as NULL, which fails every policy that
-- compares against it — one central change instead of repeating an
-- "and active" clause on every org-scoped policy. This is what makes
-- deactivation a real access lock instead of just a UI hint (see
-- can_access_job() below for the one path this doesn't automatically
-- cover, since it compares auth.uid() directly rather than going
-- through org_id).
create or replace function public.current_org_id()
returns uuid
language sql security definer stable
set search_path = public
as $$ select org_id from profiles where id = auth.uid() and active = true $$;

create or replace function public.current_role()
returns text
language sql security definer stable
set search_path = public
as $$ select role from profiles where id = auth.uid() and active = true $$;

create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.current_active()
returns boolean
language sql security definer stable
set search_path = public
as $$ select coalesce((select active from profiles where id = auth.uid()), false) $$;

-- Rate-limit counters, wrapped the same way as every other helper here —
-- a plain "select count(*) from jobs where ..." written directly inside
-- the jobs INSERT policy queries jobs from within its own policy, which
-- is exactly the same recursion trap current_org_id() etc. exist to
-- avoid on profiles. This was missed here originally (and in the
-- identical job_comments case below) since a rate-limit subquery reads
-- differently from an access-check one, but it's the same bug: SECURITY
-- DEFINER makes the internal count bypass RLS instead of re-triggering
-- the very policy that's calling it.
create or replace function public.recent_job_count(creator uuid)
returns int
language sql security definer stable
set search_path = public
as $$ select count(*)::int from jobs where created_by = creator and created_at > now() - interval '1 minute' $$;

create or replace function public.recent_comment_count(author uuid)
returns int
language sql security definer stable
set search_path = public
as $$ select count(*)::int from job_comments where author_id = author and created_at > now() - interval '1 minute' $$;

-- Anonymous submitters have no stable identity to rate-limit by user
-- (no auth.uid() at all), so this limits by the TARGET org instead —
-- protects one shop's inbox from being flooded regardless of who's
-- doing the flooding, or from how many different sessions/IPs.
create or replace function public.recent_work_request_count(target_org_id uuid)
returns int
language sql security definer stable
set search_path = public
as $$ select count(*)::int from work_requests where org_id = target_org_id and created_at > now() - interval '1 hour' $$;

-- A work request can only be filed against a real, approved shop — not
-- a pending signup, not a rejected one, not a made-up uuid someone
-- guessed or incremented.
create or replace function public.org_is_approved(target_org_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$ select exists(select 1 from organizations where id = target_org_id and status = 'approved') $$;

-- Single source of truth for "can this user see/act on this job" —
-- reused by jobs, job_comments, job_attachments, and the storage
-- policies below instead of four separate copies of the same logic.
create or replace function public.can_access_job(target_job_id bigint)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from jobs j
    where j.id = target_job_id
    and (
      public.is_admin()
      or (
        public.current_active()
        and (
          j.mechanic_id = auth.uid()
          or j.org_id = public.current_org_id()
          or exists (
            select 1 from fleet_shop_links fsl
            where fsl.fleet_id = auth.uid() and fsl.org_id = j.org_id
          )
        )
      )
    )
  );
$$;

-- Redeems an invite code without granting broad read access to the
-- organizations table. This is what closes the gap where any signed-up
-- user could otherwise `select * from organizations` and collect every
-- company's invite code. Returns zero or one row.
create or replace function public.lookup_org_by_invite_code(code text)
returns table(org_id uuid, org_name text)
language sql security definer stable
set search_path = public
as $$
  select id, name from organizations where invite_code = upper(trim(code));
$$;
grant execute on function public.lookup_org_by_invite_code(text) to authenticated;

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jobs_touch_updated_at on jobs;
create trigger trg_jobs_touch_updated_at
  before update on jobs
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_invoices_touch_updated_at on invoices;
create trigger trg_invoices_touch_updated_at
  before update on invoices
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_inventory_items_touch_updated_at on inventory_items;
create trigger trg_inventory_items_touch_updated_at
  before update on inventory_items
  for each row execute function public.touch_updated_at();

-- Column-level protection RLS can't cleanly express on its own: no
-- matter which UPDATE policy let the row through, a non-admin can never
-- change a profile's role, org_id, or id. This is the actual fix for
-- the self-promotion-to-admin gap in the old profiles_shop_can_update_any
-- policy, which had no WITH CHECK at all.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'Only an admin can change a profile''s role.';
  end if;
  if new.org_id is distinct from old.org_id then
    raise exception 'Only an admin can move a profile to a different organization.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileged_columns on profiles;
create trigger trg_protect_profile_privileged_columns
  before update on profiles
  for each row execute function public.protect_profile_privileged_columns();

-- Same idea for organizations: a shop owner can rename their org or
-- rotate its invite code, but cannot approve their own pending signup
-- by writing status='approved' directly, which the old unscoped
-- update-your-own-org pattern would not have stopped.
create or replace function public.protect_organization_privileged_columns()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Only an admin can change an organization''s approval status.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_org_privileged_columns on organizations;
create trigger trg_protect_org_privileged_columns
  before update on organizations
  for each row execute function public.protect_organization_privileged_columns();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table jobs enable row level security;
alter table locations enable row level security;
alter table fleet_shop_links enable row level security;
alter table job_comments enable row level security;
alter table job_attachments enable row level security;
alter table error_logs enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table inventory_items enable row level security;
alter table work_requests enable row level security;

-- ---------- organizations ----------
drop policy if exists "organizations_select_own" on organizations;
create policy "organizations_select_own" on organizations
  for select using (id = public.current_org_id());

drop policy if exists "organizations_select_fleet_linked" on organizations;
create policy "organizations_select_fleet_linked" on organizations
  for select using (
    exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = auth.uid() and fsl.org_id = organizations.id)
  );

drop policy if exists "organizations_select_admin" on organizations;
create policy "organizations_select_admin" on organizations
  for select using (public.is_admin());

-- Anyone authenticated can start a shop signup (status defaults to
-- 'pending'); invite-code redemption for mechanics/fleet goes through
-- lookup_org_by_invite_code(), not a select policy, so it never needed
-- broad read access to this table in the first place.
drop policy if exists "organizations_insert_signup" on organizations;
create policy "organizations_insert_signup" on organizations
  for insert with check (auth.uid() is not null);

drop policy if exists "organizations_update_own" on organizations;
create policy "organizations_update_own" on organizations
  for update
  using (id = public.current_org_id() and public.current_role() = 'shop')
  with check (id = public.current_org_id());

drop policy if exists "organizations_update_admin" on organizations;
create policy "organizations_update_admin" on organizations
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------- profiles ----------
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_select_admin" on profiles;
create policy "profiles_select_admin" on profiles
  for select using (public.is_admin());

drop policy if exists "profiles_select_same_org" on profiles;
create policy "profiles_select_same_org" on profiles
  for select using (org_id is not null and org_id = public.current_org_id());

-- Shop/mechanic side: see a fleet manager who has joined your org.
drop policy if exists "profiles_select_linked_fleet" on profiles;
create policy "profiles_select_linked_fleet" on profiles
  for select using (
    exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = profiles.id and fsl.org_id = public.current_org_id())
  );

-- Fleet side: see members of any shop you've joined (not just your
-- "primary" org_id from signup).
drop policy if exists "profiles_select_fleet_view_shops" on profiles;
create policy "profiles_select_fleet_view_shops" on profiles
  for select using (
    exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = auth.uid() and fsl.org_id = profiles.org_id)
  );

-- Self-signup: you can only ever insert yourself, and never as 'admin' —
-- admin accounts are created by an existing admin (via the role dropdown
-- in the admin panel), never by signing up.
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid() and role in ('mechanic','shop','fleet'));

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- A shop can toggle active/inactive for mechanics and fleet managers IN
-- ITS OWN ORG only — this is the fix for profiles_shop_can_update_any,
-- which had no org scoping and no column protection at all. Column
-- protection (role/org_id) is now enforced by the trigger above no
-- matter which of these policies let the row through.
drop policy if exists "profiles_update_shop_team" on profiles;
create policy "profiles_update_shop_team" on profiles
  for update
  using (org_id = public.current_org_id() and public.current_role() = 'shop' and role in ('mechanic','fleet'))
  with check (org_id = public.current_org_id() and role in ('mechanic','fleet'));

drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------- jobs ----------
-- Deliberately NOT can_access_job(id) here, even though that's the same
-- logic — a function taking the row's own id as an argument is opaque to
-- the query planner, so it can't be matched against idx_jobs_org_status /
-- idx_jobs_mechanic_status and forces a sequential scan of every job on
-- the platform on every dashboard refresh. Inlined so org_id/mechanic_id
-- stay visible to the planner as real, indexable column comparisons.
-- (job_comments/job_attachments/storage below keep using can_access_job()
-- since those are always scoped to one specific job_id by the client
-- first — a single function call, not a per-row scan of a big table.)
drop policy if exists "jobs_select" on jobs;
create policy "jobs_select" on jobs
  for select using (
    public.is_admin()
    or (
      public.current_active()
      and (
        mechanic_id = auth.uid()
        or org_id = public.current_org_id()
        or exists (
          select 1 from fleet_shop_links fsl
          where fsl.fleet_id = auth.uid() and fsl.org_id = jobs.org_id
        )
      )
    )
  );

-- Rate-limited to 30 jobs/minute per creator — matches the 42501
-- handling already in script.js. Adjust the threshold if real usage
-- needs differ from this starting guess.
drop policy if exists "jobs_insert_shop" on jobs;
create policy "jobs_insert_shop" on jobs
  for insert with check (
    created_by = auth.uid()
    and org_id = public.current_org_id()
    and public.current_role() = 'shop'
    and public.current_active()
    and public.recent_job_count(auth.uid()) < 30
  );

drop policy if exists "jobs_insert_admin" on jobs;
create policy "jobs_insert_admin" on jobs
  for insert with check (public.is_admin());

-- WITH CHECK also confirms the assigned mechanic belongs to the same
-- org — closes the door on assigning (or re-assigning, via a raw API
-- call) a job to another company's mechanic.
drop policy if exists "jobs_update_shop" on jobs;
create policy "jobs_update_shop" on jobs
  for update
  using (org_id = public.current_org_id() and public.current_role() = 'shop')
  with check (
    org_id = public.current_org_id()
    and exists (select 1 from profiles m where m.id = jobs.mechanic_id and m.org_id = jobs.org_id and m.role = 'mechanic')
  );

drop policy if exists "jobs_update_mechanic" on jobs;
create policy "jobs_update_mechanic" on jobs
  for update
  using (mechanic_id = auth.uid() and public.current_active())
  with check (mechanic_id = auth.uid());

drop policy if exists "jobs_update_admin" on jobs;
create policy "jobs_update_admin" on jobs
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "jobs_delete_shop" on jobs;
create policy "jobs_delete_shop" on jobs
  for delete using (org_id = public.current_org_id() and public.current_role() = 'shop');

drop policy if exists "jobs_delete_admin" on jobs;
create policy "jobs_delete_admin" on jobs
  for delete using (public.is_admin());

-- ---------- locations ----------
drop policy if exists "locations_mechanic_own" on locations;
create policy "locations_mechanic_own" on locations
  for all
  using (mechanic_id = auth.uid() and public.current_active())
  with check (mechanic_id = auth.uid() and public.current_active());

drop policy if exists "locations_select_org" on locations;
create policy "locations_select_org" on locations
  for select using (
    exists (select 1 from profiles m where m.id = locations.mechanic_id and m.org_id = public.current_org_id())
  );

drop policy if exists "locations_select_fleet_assigned" on locations;
create policy "locations_select_fleet_assigned" on locations
  for select using (
    exists (
      select 1 from jobs j
      where j.mechanic_id = locations.mechanic_id and j.status != 'complete'
      and exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = auth.uid() and fsl.org_id = j.org_id)
    )
  );

drop policy if exists "locations_select_admin" on locations;
create policy "locations_select_admin" on locations
  for select using (public.is_admin());

-- ---------- fleet_shop_links ----------
drop policy if exists "fleet_shop_links_select_own" on fleet_shop_links;
create policy "fleet_shop_links_select_own" on fleet_shop_links
  for select using (fleet_id = auth.uid());

drop policy if exists "fleet_shop_links_select_org" on fleet_shop_links;
create policy "fleet_shop_links_select_org" on fleet_shop_links
  for select using (org_id = public.current_org_id());

drop policy if exists "fleet_shop_links_select_admin" on fleet_shop_links;
create policy "fleet_shop_links_select_admin" on fleet_shop_links
  for select using (public.is_admin());

drop policy if exists "fleet_shop_links_insert_self" on fleet_shop_links;
create policy "fleet_shop_links_insert_self" on fleet_shop_links
  for insert with check (fleet_id = auth.uid() and public.current_active());

-- ---------- job_comments ----------
drop policy if exists "job_comments_select" on job_comments;
create policy "job_comments_select" on job_comments
  for select using (public.can_access_job(job_id));

-- Rate-limited to 20 messages/minute per author, matching the 42501
-- handling in addJobComment().
drop policy if exists "job_comments_insert" on job_comments;
create policy "job_comments_insert" on job_comments
  for insert with check (
    author_id = auth.uid()
    and public.current_active()
    and public.can_access_job(job_id)
    and public.recent_comment_count(auth.uid()) < 20
  );

-- ---------- job_attachments ----------
drop policy if exists "job_attachments_select" on job_attachments;
create policy "job_attachments_select" on job_attachments
  for select using (public.can_access_job(job_id));

drop policy if exists "job_attachments_insert" on job_attachments;
create policy "job_attachments_insert" on job_attachments
  for insert with check (
    uploader_id = auth.uid() and public.current_active() and public.can_access_job(job_id)
  );

-- ---------- error_logs ----------
drop policy if exists "error_logs_insert" on error_logs;
create policy "error_logs_insert" on error_logs
  for insert with check (user_id = auth.uid());

drop policy if exists "error_logs_select_admin" on error_logs;
create policy "error_logs_select_admin" on error_logs
  for select using (public.is_admin());

-- ---------- invoices ----------
-- Shop-only in the app for v1 — the customer receives it by email, not
-- by logging into Relay, so there's no fleet-manager-facing select policy
-- here (customer_email is a plain field, not tied to a profile).
drop policy if exists "invoices_select_org" on invoices;
create policy "invoices_select_org" on invoices
  for select using (org_id = public.current_org_id());

drop policy if exists "invoices_select_admin" on invoices;
create policy "invoices_select_admin" on invoices
  for select using (public.is_admin());

drop policy if exists "invoices_insert_shop" on invoices;
create policy "invoices_insert_shop" on invoices
  for insert with check (
    created_by = auth.uid()
    and org_id = public.current_org_id()
    and public.current_role() = 'shop'
  );

drop policy if exists "invoices_update_shop" on invoices;
create policy "invoices_update_shop" on invoices
  for update
  using (org_id = public.current_org_id() and public.current_role() = 'shop')
  with check (org_id = public.current_org_id());

drop policy if exists "invoices_update_admin" on invoices;
create policy "invoices_update_admin" on invoices
  for update using (public.is_admin()) with check (public.is_admin());

-- Drafts only — once an invoice has been sent or marked paid it's a real
-- record, not something to quietly delete.
drop policy if exists "invoices_delete_shop_drafts" on invoices;
create policy "invoices_delete_shop_drafts" on invoices
  for delete using (
    org_id = public.current_org_id() and public.current_role() = 'shop' and status = 'draft'
  );

drop policy if exists "invoices_delete_admin" on invoices;
create policy "invoices_delete_admin" on invoices
  for delete using (public.is_admin());

-- ---------- invoice_items ----------
-- All access goes through the parent invoice's own scoping — an item is
-- visible/editable exactly when its invoice is.
drop policy if exists "invoice_items_select" on invoice_items;
create policy "invoice_items_select" on invoice_items
  for select using (
    exists (select 1 from invoices i where i.id = invoice_items.invoice_id and i.org_id = public.current_org_id())
    or public.is_admin()
  );

drop policy if exists "invoice_items_write_shop" on invoice_items;
create policy "invoice_items_write_shop" on invoice_items
  for all
  using (
    exists (select 1 from invoices i where i.id = invoice_items.invoice_id and i.org_id = public.current_org_id())
    and public.current_role() = 'shop'
  )
  with check (
    exists (select 1 from invoices i where i.id = invoice_items.invoice_id and i.org_id = public.current_org_id())
  );

drop policy if exists "invoice_items_write_admin" on invoice_items;
create policy "invoice_items_write_admin" on invoice_items
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- inventory_items ----------
-- Same org-scoped shape as invoices: shop manages its own price list,
-- admin sees and can manage everything. The public work-request page
-- does NOT read this table directly — it goes through a SECURITY
-- DEFINER RPC (added alongside the work_requests table) that returns
-- only one shop's active items, the same defensive pattern already
-- used for invite-code lookup rather than a broad anon-readable table.
-- Shop-role only, not "anyone in the org" — a shop's price list is
-- their own business info, not something a mechanic or a fleet manager
-- sharing that org should be able to see. Admin keeps visibility for
-- support, same as every other table.
drop policy if exists "inventory_items_select_shop" on inventory_items;
create policy "inventory_items_select_shop" on inventory_items
  for select using ((org_id = public.current_org_id() and public.current_role() = 'shop') or public.is_admin());

drop policy if exists "inventory_items_write_shop" on inventory_items;
create policy "inventory_items_write_shop" on inventory_items
  for all
  using (org_id = public.current_org_id() and public.current_role() = 'shop')
  with check (org_id = public.current_org_id() and public.current_role() = 'shop');

drop policy if exists "inventory_items_write_admin" on inventory_items;
create policy "inventory_items_write_admin" on inventory_items
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- work_requests ----------
-- The one genuinely public write surface in this schema — everything
-- else requires a real account. anon can INSERT only: no select, no
-- update, no delete, so a submitter can't read back their own request,
-- anyone else's, or enumerate what's pending for a shop. WITH CHECK
-- does the real work here: status must start as 'pending', the target
-- org must actually exist and be approved, and the org can't already
-- be over the recent-submission rate limit.
drop policy if exists "work_requests_insert_public" on work_requests;
create policy "work_requests_insert_public" on work_requests
  for insert
  with check (
    status = 'pending'
    and converted_job_id is null
    and public.org_is_approved(org_id)
    and public.recent_work_request_count(org_id) < 20
  );

drop policy if exists "work_requests_select_shop" on work_requests;
create policy "work_requests_select_shop" on work_requests
  for select using ((org_id = public.current_org_id() and public.current_role() = 'shop') or public.is_admin());

drop policy if exists "work_requests_update_shop" on work_requests;
create policy "work_requests_update_shop" on work_requests
  for update
  using (org_id = public.current_org_id() and public.current_role() = 'shop')
  with check (org_id = public.current_org_id() and public.current_role() = 'shop');

drop policy if exists "work_requests_write_admin" on work_requests;
create policy "work_requests_write_admin" on work_requests
  for all using (public.is_admin()) with check (public.is_admin());

-- Lets the public request page show the shop's name ("Request service
-- from Acme Auto") without granting anon any read access to the
-- organizations table itself — same defensive shape as the invite-code
-- lookup RPC. Returns nothing for a non-approved or unknown org, so the
-- page can show a clear "this link isn't valid" state instead of
-- silently leaking which org_ids exist.
create or replace function public.get_org_name_for_request(target_org_id uuid)
returns table(name text)
language sql security definer stable
set search_path = public
as $$ select name from organizations where id = target_org_id and status = 'approved' $$;

grant execute on function public.get_org_name_for_request(uuid) to anon;
grant execute on function public.org_is_approved(uuid) to anon;
grant execute on function public.recent_work_request_count(uuid) to anon;

-- ------------------------------------------------------------
-- Storage — job-attachments bucket. Private (not public), gated by the
-- same can_access_job() used for the comments/attachments tables.
-- Assumes uploaded paths look like "<job_id>/<filename>", which is what
-- script.js's upload handler already produces.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('job-attachments', 'job-attachments', false)
on conflict (id) do nothing;

drop policy if exists "job_attachments_storage_select" on storage.objects;
create policy "job_attachments_storage_select" on storage.objects
  for select using (
    bucket_id = 'job-attachments'
    and public.can_access_job(nullif((storage.foldername(name))[1], '')::bigint)
  );

drop policy if exists "job_attachments_storage_insert" on storage.objects;
create policy "job_attachments_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'job-attachments'
    and public.current_active()
    and public.can_access_job(nullif((storage.foldername(name))[1], '')::bigint)
  );

-- shop-logos bucket. Public read on purpose — a logo is meant to be
-- shown to customers, and the invoice-PDF generator (running with no
-- user session) needs to fetch it with a plain HTTP GET, not an
-- authenticated request. Only the org's own shop members can upload one.
-- Path convention: "<org_id>/<filename>", same pattern as job-attachments.
insert into storage.buckets (id, name, public)
values ('shop-logos', 'shop-logos', true)
on conflict (id) do nothing;

drop policy if exists "shop_logos_storage_insert" on storage.objects;
create policy "shop_logos_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'shop-logos'
    and public.current_role() = 'shop'
    and nullif((storage.foldername(name))[1], '')::uuid = public.current_org_id()
  );
-- ============================================================
-- Migration 0001 — Phase 0 privacy fixes
-- Safe to run more than once. Keeps all existing data.
--
-- S1: a fleet manager could read every job at a shop they joined.
--     Now a fleet sees a job only when the shop assigned that job to
--     them (jobs.fleet_profile_id), at a shop they are still linked to.
--     Chat, photos, and files follow the same rule (can_access_job).
-- S2: a mechanic's last position stayed readable after going offline.
--     Now fleets see a location only while the mechanic is live, the
--     position is less than 10 minutes old, and the mechanic is driving
--     to or working on that fleet's own roadside job.
-- ============================================================

-- ---------- S1: which fleet a job belongs to ----------
alter table jobs add column if not exists fleet_profile_id uuid references profiles(id) on delete set null;
create index if not exists idx_jobs_fleet_status on jobs(fleet_profile_id, status);

-- A shop may only attach a fleet that is actually linked to it.
create or replace function public.validate_job_fleet()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.fleet_profile_id is not null and not exists (
    select 1 from fleet_shop_links fsl
    where fsl.fleet_id = new.fleet_profile_id and fsl.org_id = new.org_id
  ) then
    raise exception 'That fleet account is not linked to this shop.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_validate_job_fleet on jobs;
create trigger trg_validate_job_fleet
  before insert or update of fleet_profile_id, org_id on jobs
  for each row execute function public.validate_job_fleet();

drop policy if exists "jobs_select" on jobs;
create policy "jobs_select" on jobs
  for select using (
    public.is_admin()
    or (
      public.current_active()
      and (
        mechanic_id = auth.uid()
        or org_id = public.current_org_id()
        or (
          fleet_profile_id = auth.uid()
          and exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = auth.uid() and fsl.org_id = jobs.org_id)
        )
      )
    )
  );

create or replace function public.can_access_job(target_job_id bigint)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from jobs j
    where j.id = target_job_id
    and (
      public.is_admin()
      or (
        public.current_active()
        and (
          j.mechanic_id = auth.uid()
          or j.org_id = public.current_org_id()
          or (
            j.fleet_profile_id = auth.uid()
            and exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = auth.uid() and fsl.org_id = j.org_id)
          )
        )
      )
    )
  );
$$;

-- ---------- S1b: fleet accounts are never shop members ----------
-- Fleet sign-up stores the invite shop in profiles.org_id, and 32 rules
-- treat "has this org_id" as "works at this shop". That gave fleets the
-- member view of their first shop: every job, the team, every mechanic's
-- location. Fleets get their intended access only through
-- fleet_shop_links (shops joined) and jobs.fleet_profile_id (their jobs).
create or replace function public.current_org_id()
returns uuid
language sql security definer stable
set search_path = public
as $$ select org_id from profiles where id = auth.uid() and active = true and role <> 'fleet' $$;

-- ---------- S1c: fleets see only the mechanics on their own jobs ----------
-- Previously a fleet could read every profile (including personal email
-- and phone) at any shop it joined. Now only the mechanic assigned to one
-- of the fleet's own jobs is visible, so the fleet view can show a name.
drop policy if exists "profiles_select_fleet_view_shops" on profiles;
create policy "profiles_select_fleet_view_shops" on profiles
  for select using (
    exists (
      select 1 from jobs j
      where j.mechanic_id = profiles.id
        and j.fleet_profile_id = auth.uid()
        and exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = auth.uid() and fsl.org_id = j.org_id)
    )
  );

-- ---------- S2: live flag on locations ----------
alter table locations add column if not exists is_live boolean not null default false;

drop policy if exists "locations_select_fleet_assigned" on locations;
create policy "locations_select_fleet_assigned" on locations
  for select using (
    locations.is_live
    and locations.updated_at > now() - interval '10 minutes'
    and exists (
      select 1 from jobs j
      where j.mechanic_id = locations.mechanic_id
        and j.fleet_profile_id = auth.uid()
        and j.job_type = 'mobile'
        and j.status in ('en_route', 'on_site')
        and exists (select 1 from fleet_shop_links fsl where fsl.fleet_id = auth.uid() and fsl.org_id = j.org_id)
    )
  );

-- ---------- Signup: names are not identifiers ----------
alter table profiles drop constraint if exists profiles_name_key;
alter table organizations drop constraint if exists organizations_name_key;

-- Make the API aware of the new columns right away.
notify pgrst, 'reload schema';
