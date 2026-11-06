-- pgTAP tests: the A level asked for alongside the T Level (migration 0034).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.universities (id, ukprn, name, source_url) values
  ('f2500000-0000-0000-0000-0000000000a1', '25000001', 'Fixture TwentyFive', 'https://example.org/du');
insert into public.uni_courses (id, university_id, kis_course_id, kis_mode, title, subject_group, source_url,
                                tlevel_status, tlevel_requirement, tlevel_quote, tlevel_quote_url, tlevel_alevel) values
  ('f2500000-0000-0000-0000-0000000000c1', 'f2500000-0000-0000-0000-0000000000a1', 'A', 1, 'Fixture TwentyFive EEE', 'engineering',
   'https://example.org/du', 'accepted_with_maths', 'Merit', 'Merit overall with B in A level Maths.', 'https://example.org/c', 'A level Maths at B');

select throws_ok($$update public.uni_courses set tlevel_status = 'accepted' where id = 'f2500000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'an A level only goes with "T Level + A level"');

set local role anon;
select is((select tlevel_alevel from public.search_uni_courses('{"q":"Fixture TwentyFive"}')), 'A level Maths at B', 'search returns it');
select is(public.uni_course_detail('f2500000-0000-0000-0000-0000000000c1') ->> 'tlevel_alevel', 'A level Maths at B', 'detail returns it');
reset role;

insert into auth.users (id, email) values ('f2500000-0000-0000-0000-0000000000f1', 'ready25@example.org');
update public.profiles set age_confirmed_at = now() where user_id = 'f2500000-0000-0000-0000-0000000000f1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2500000-0000-0000-0000-0000000000f1","role":"authenticated"}';
insert into public.reactions (item_type, item_id, reaction) values ('course', 'f2500000-0000-0000-0000-0000000000c1', 'like');
select is(public.liked_items() -> 'courses' -> 0 ->> 'tlevel_alevel', 'A level Maths at B', 'the Liked area returns it');
reset role;

select * from finish();
rollback;
