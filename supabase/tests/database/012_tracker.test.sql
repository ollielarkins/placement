-- pgTAP tests: shortlist and tracker rules (migration 0018).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-0000000000a1', 'ready@example.org'),
  ('c0000000-0000-0000-0000-0000000000a2', 'new@example.org');
update public.profiles set age_confirmed_at = now() where user_id = 'c0000000-0000-0000-0000-0000000000a1';
insert into public.companies (id, name, data_source, status) values
  ('c0000000-0000-0000-0000-00000000000c', 'Fixture Twelve Active', 'imported', 'active'),
  ('c0000000-0000-0000-0000-00000000000d', 'Fixture Twelve Hidden', 'imported', 'hidden');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$insert into public.tracker_items (company_id) values ('c0000000-0000-0000-0000-00000000000c')$$,
  '42501', null, 'cannot save before confirming age');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into public.tracker_items (company_id) values ('c0000000-0000-0000-0000-00000000000c')$$,
  'ready student saves a company');
select throws_ok($$insert into public.tracker_items (company_id) values ('c0000000-0000-0000-0000-00000000000d')$$,
  null, null, 'hidden company cannot be saved');
select throws_ok($$insert into public.tracker_items (company_id) values ('c0000000-0000-0000-0000-00000000000c')$$,
  '23505', null, 'same company twice is refused');

update public.tracker_items set stage = 'contacted' where company_id = 'c0000000-0000-0000-0000-00000000000c';
select is((select contacted_at from public.tracker_items where company_id = 'c0000000-0000-0000-0000-00000000000c'),
  current_date, 'moving to contacted stamps the date');

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.tracker_items), 0, 'another student sees nothing');
delete from public.tracker_items;

set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.tracker_items), 1, 'another student deleted nothing');
delete from public.tracker_items where company_id = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.tracker_items), 0, 'owner can always remove');

select * from finish();
rollback;
