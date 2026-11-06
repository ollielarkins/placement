-- pgTAP tests: reviews, submissions, reports and alerts go live (migration 0038).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.companies (id, name, website, data_source) values
  ('f2800000-0000-0000-0000-0000000000e1', 'Fixture TwentyEight Engineering Ltd', 'https://www.fixture28.example.com', 'imported');
insert into auth.users (id, email) values
  ('f2800000-0000-0000-0000-0000000000f1', 'ready28@example.org'),
  ('f2800000-0000-0000-0000-0000000000f2', 'new28@example.org'),
  ('f2800000-0000-0000-0000-0000000000f3', 'admin28@example.org');
update public.profiles set age_confirmed_at = now() where user_id in ('f2800000-0000-0000-0000-0000000000f1', 'f2800000-0000-0000-0000-0000000000f3');
insert into public.tracker_items (id, user_id, company_id, stage) values
  ('f2800000-0000-0000-0000-0000000000d1', 'f2800000-0000-0000-0000-0000000000f1', 'f2800000-0000-0000-0000-0000000000e1', 'secured');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f2800000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$insert into public.company_submissions (payload) values ('{"name":"Somewhere Ltd"}')$$, '42501', null,
  'a suggestion needs a ready account');

set local request.jwt.claims = '{"sub":"f2800000-0000-0000-0000-0000000000f1","role":"authenticated"}';
insert into public.company_submissions (payload) values ('{"name":"  Fixture TwentyEight Engineering Limited ","junk":"x"}');
select is((select (status, matched_company_id)::text from public.company_submissions order by created_at desc limit 1),
  '(matched,f2800000-0000-0000-0000-0000000000e1)', 'matched to a company we hold by name');
select is((select payload from public.company_submissions order by created_at desc limit 1),
  '{"name": "Fixture TwentyEight Engineering Limited"}'::jsonb, 'payload tidied, unknown keys dropped');
insert into public.company_submissions (payload) values ('{"name":"Another Name","website":"fixture28.example.com/about"}');
select is((select matched_company_id from public.company_submissions where payload ->> 'name' = 'Another Name'),
  'f2800000-0000-0000-0000-0000000000e1'::uuid, 'matched by website domain');
select throws_ok($$insert into public.company_submissions (payload) values ('{"name":"Bad","website":"not a site"}')$$, '23514', null,
  'a website must look like one');
insert into public.company_submissions (payload) values ('{"name":"New One A"}'), ('{"name":"New One B"}'), ('{"name":"New One C"}');
select throws_ok($$insert into public.company_submissions (payload) values ('{"name":"Sixth"}')$$, '54000', null, 'five a day');

select is((public.my_review_status('f2800000-0000-0000-0000-0000000000e1') ->> 'tracker_item_id')::uuid,
  'f2800000-0000-0000-0000-0000000000d1'::uuid, 'the secured placement is offered for review');
insert into public.reviews (company_id, tracker_item_id, ratings, body)
values ('f2800000-0000-0000-0000-0000000000e1', 'f2800000-0000-0000-0000-0000000000d1',
        '{"overall":4,"learning":5,"support":3,"route_onward":4}', 'Wired control panels and tested PLC logic every week.');
select is((select status::text from public.reviews limit 1), 'pending', 'a new review waits for screening');
select throws_ok($$insert into public.reports (target_type, target_id, reason) values ('company', 'f2800000-0000-0000-0000-0000000000e1', 'because')$$,
  '23514', null, 'a report needs a reason from the list');
select lives_ok($$insert into public.reports (target_type, target_id, reason) values ('company', 'f2800000-0000-0000-0000-0000000000e1', 'wrong_info: moved to Luton')$$,
  'a listed reason with words');
select throws_ok($$select public.admin_create_company((select id from public.company_submissions where payload ->> 'name' = 'New One A'))$$,
  '42501', null, 'only admins create companies from suggestions');
select is((select count(*)::int from public.admin_alerts), 0, 'students cannot see alerts');

set local request.jwt.claims = '{"sub":"f2800000-0000-0000-0000-0000000000f3","role":"authenticated","app_metadata":{"role":"admin"}}';
select isnt(public.admin_create_company((select id from public.company_submissions where payload ->> 'name' = 'New One A')), null,
  'an admin can');
select is((select data_source::text from public.companies where name = 'New One A'), 'student_submitted', 'as Student-submitted');
reset role;

select * from finish();
rollback;
