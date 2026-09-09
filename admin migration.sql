-- ============================================================
-- RELAY — ADD ADMIN ROLE
-- Run this in Supabase SQL Editor. Safe to run on your existing
-- database — it does NOT drop or delete anything you already have.
-- ============================================================

-- 1. Allow 'admin' as a valid role
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('mechanic','shop','fleet','admin'));

-- 2. Give admins full access to everything
create policy "profiles_admin_full_access" on profiles
  for all
  using ( exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') )
  with check ( exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') );

create policy "jobs_admin_full_access" on jobs
  for all
  using ( exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') )
  with check ( exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') );

create policy "locations_admin_full_access" on locations
  for all
  using ( exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') )
  with check ( exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') );

-- 3. Promote YOUR OWN account to admin.
-- First sign up / log in normally on the site with whatever account
-- you want to be the admin, then run this line with your real email:
--
-- update profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'you@example.com');
--
-- Admin is intentionally NOT selectable in the signup form — the only
-- way to become admin is this manual SQL step, so random users can
-- never grant themselves admin access.
