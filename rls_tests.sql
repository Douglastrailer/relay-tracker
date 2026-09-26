-- Seed data as postgres (bypasses RLS — this is just setup)
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'shop_a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'mech_a1@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'shop_b@test.com'),
  ('44444444-4444-4444-4444-444444444444', 'mech_b1@test.com'),
  ('55555555-5555-5555-5555-555555555555', 'fleet_x@test.com'),
  ('66666666-6666-6666-6666-666666666666', 'admin@test.com');

insert into organizations (id, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Acme Shop', 'approved'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Beta Shop', 'approved');

insert into profiles (id, name, role, org_id, active, email, phone) values
  ('11111111-1111-1111-1111-111111111111', 'Shop A Owner', 'shop', 'aaaaaaaa-0000-0000-0000-000000000001', true, 'shop_a@test.com', '555'),
  ('22222222-2222-2222-2222-222222222222', 'Mechanic A1', 'mechanic', 'aaaaaaaa-0000-0000-0000-000000000001', true, 'mech_a1@test.com', '555'),
  ('33333333-3333-3333-3333-333333333333', 'Shop B Owner', 'shop', 'bbbbbbbb-0000-0000-0000-000000000002', true, 'shop_b@test.com', '555'),
  ('44444444-4444-4444-4444-444444444444', 'Mechanic B1', 'mechanic', 'bbbbbbbb-0000-0000-0000-000000000002', true, 'mech_b1@test.com', '555'),
  ('55555555-5555-5555-5555-555555555555', 'Fleet X', 'fleet', 'aaaaaaaa-0000-0000-0000-000000000001', true, 'fleet_x@test.com', '555'),
  ('66666666-6666-6666-6666-666666666666', 'Admin', 'admin', null, true, 'admin@test.com', '555');

insert into jobs (customer, vehicle, mechanic_id, dest_lat, dest_lng, org_id, created_by) values
  ('Acme Customer', 'Truck 1', '22222222-2222-2222-2222-222222222222', 42.1, -83.1, 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('Beta Customer', 'Truck 2', '44444444-4444-4444-4444-444444444444', 42.2, -83.2, 'bbbbbbbb-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333');

\echo '=== TEST 1: Shop A should see only its own org profiles (self + mechanic A1), never Shop B/Mechanic B1 ==='
set role authenticated;
select set_current_user('11111111-1111-1111-1111-111111111111');
select name, role, org_id from profiles order by name;
reset role;

\echo '=== TEST 2: Shop A should see only its own org jobs (Acme), never Beta ==='
set role authenticated;
select set_current_user('11111111-1111-1111-1111-111111111111');
select customer, org_id from jobs order by customer;
reset role;

\echo '=== TEST 3: fetchAllMechanics()-style query (role=mechanic, no org filter) as Shop A — RLS should still narrow it to just Mechanic A1 ==='
set role authenticated;
select set_current_user('11111111-1111-1111-1111-111111111111');
select name from profiles where role = 'mechanic';
reset role;

\echo '=== TEST 4: Shop A tries to update Mechanic B1 (cross-org) — expect 0 rows affected ==='
set role authenticated;
select set_current_user('11111111-1111-1111-1111-111111111111');
update profiles set active = false where id = '44444444-4444-4444-4444-444444444444';
reset role;

\echo '=== TEST 5: Shop A tries to self-promote to admin — expect ERROR from trigger ==='
set role authenticated;
select set_current_user('11111111-1111-1111-1111-111111111111');
do $$
begin
  update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'FAIL: self-promotion to admin was NOT blocked';
exception when others then
  raise notice 'PASS: self-promotion blocked — %', sqlerrm;
end
$$;
reset role;

\echo '=== TEST 6: A pending shop tries to self-approve by writing status directly — expect ERROR from trigger ==='
insert into organizations (id, name, status) values ('cccccccc-0000-0000-0000-000000000003', 'Shady Shop', 'pending');
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'shop_c@test.com');
insert into profiles (id, name, role, org_id, active, email, phone)
  values ('77777777-7777-7777-7777-777777777777', 'Shop C Owner (pending)', 'shop', 'cccccccc-0000-0000-0000-000000000003', true, 'shop_c@test.com', '555');
set role authenticated;
select set_current_user('77777777-7777-7777-7777-777777777777');
do $$
begin
  update organizations set status = 'approved' where id = 'cccccccc-0000-0000-0000-000000000003';
  raise notice 'FAIL: self-approval was NOT blocked';
exception when others then
  raise notice 'PASS: self-approval blocked — %', sqlerrm;
end
$$;
-- Renaming (a non-privileged column) should still work for the org's own shop owner.
update organizations set name = 'Shady Shop Renamed' where id = 'cccccccc-0000-0000-0000-000000000003';
select name from organizations where id = 'cccccccc-0000-0000-0000-000000000003';
reset role;

\echo '=== TEST 7: invite-code RPC — a brand-new signup (no profile row yet) looks up Beta Shop by its real invite code, and a wrong code returns nothing ==='
select invite_code as beta_code from organizations where id = 'bbbbbbbb-0000-0000-0000-000000000002' \gset
set role authenticated;
select set_current_user('88888888-8888-8888-8888-888888888888');
select org_id, org_name from lookup_org_by_invite_code(:'beta_code');
select count(*) as should_be_zero from lookup_org_by_invite_code('WRONGCODE');
reset role;

\echo '=== TEST 8: organizations table itself is not broadly readable (Shop A should see only its own org, not Beta) ==='
set role authenticated;
select set_current_user('11111111-1111-1111-1111-111111111111');
select id, name from organizations order by id;
reset role;

\echo '=== TEST 9: deactivate Mechanic A1, then confirm they lose access to jobs (hard lock, not just UI) ==='
update profiles set active = false where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select set_current_user('22222222-2222-2222-2222-222222222222');
select count(*) as jobs_visible_should_be_zero from jobs;
reset role;
update profiles set active = true where id = '22222222-2222-2222-2222-222222222222';

\echo '=== TEST 10: Admin sees everything across both orgs ==='
set role authenticated;
select set_current_user('66666666-6666-6666-6666-666666666666');
select count(*) as profiles_visible_should_be_7 from profiles;
select count(*) as jobs_visible_should_be_2 from jobs;
reset role;

\echo '=== TEST 11: Fleet manager sees only jobs assigned to them, at shops they joined ==='
insert into fleet_shop_links (fleet_id, org_id) values ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select set_current_user('55555555-5555-5555-5555-555555555555');
\echo 'expect 0: the fleet was linked but no job was assigned to it'
select count(*) as fleet_jobs_visible_should_be_0 from jobs;
reset role;
update jobs set fleet_profile_id = '55555555-5555-5555-5555-555555555555' where id = (select min(id) from jobs where org_id = 'aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select set_current_user('55555555-5555-5555-5555-555555555555');
select count(*) as fleet_jobs_visible_should_be_1 from jobs;
select count(*) as fleet_sees_only_assigned_mechanic_should_be_1 from profiles where role in ('mechanic','shop');
select count(*) as fleet_sees_linked_shop_name_should_be_1 from organizations;
reset role;
