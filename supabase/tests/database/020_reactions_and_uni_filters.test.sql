-- pgTAP tests: reactions, liked_items(), Russell Group and foundation-year filters (migration 0029).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.universities (id, ukprn, name, source_url, russell_group) values
  ('f2000000-0000-0000-0000-0000000000a1', '20000001', 'Fixture Twenty RG', 'https://example.org/du', true),
  ('f2000000-0000-0000-0000-0000000000a2', '20000002', 'Fixture Twenty Other', 'https://example.org/du', false);
insert into public.uni_courses (id, university_id, kis_course_id, kis_mode, title, subject_group, source_url, foundation_year) values
  ('f2000000-0000-0000-0000-0000000000c1', 'f2000000-0000-0000-0000-0000000000a1', 'A', 1, 'Fixture Twenty Electronic Engineering', 'engineering', 'https://example.org/du', false),
  ('f2000000-0000-0000-0000-0000000000c2', 'f2000000-0000-0000-0000-0000000000a2', 'B', 1, 'Fixture Twenty Mechanical Engineering with Foundation Year', 'engineering', 'https://example.org/du', null),
  ('f2000000-0000-0000-0000-0000000000c3', 'f2000000-0000-0000-0000-0000000000a2', 'C', 1, 'Fixture Twenty Civil Engineering', 'engineering', 'https://example.org/du', true);
insert into public.companies (id, name, data_source) values
  ('f2000000-0000-0000-0000-0000000000e1', 'Fixture Twenty Ltd', 'imported');

set local role anon;
select is((select array_agg(title order by title) from public.search_uni_courses('{"q":"Fixture Twenty","russell":true}')),
  array['Fixture Twenty Electronic Engineering'], 'Russell Group filter');
select is((select array_agg(title order by title) from public.search_uni_courses('{"q":"Fixture Twenty","foundation":"yes"}')),
  array['Fixture Twenty Civil Engineering', 'Fixture Twenty Mechanical Engineering with Foundation Year'], 'foundation year: flag or title');
select is((select array_agg(title order by title) from public.search_uni_courses('{"q":"Fixture Twenty","foundation":"no"}')),
  array['Fixture Twenty Electronic Engineering'], 'no foundation year');
select is((select russell_group from public.search_uni_courses('{"q":"Fixture Twenty Electronic"}') limit 1), true, 'search returns russell_group');
reset role;

insert into auth.users (id, email) values
  ('f2000000-0000-0000-0000-0000000000f1', 'ready20@example.org'),
  ('f2000000-0000-0000-0000-0000000000f2', 'new20@example.org');
update public.profiles set age_confirmed_at = now() where user_id = 'f2000000-0000-0000-0000-0000000000f1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$insert into public.reactions (item_type, item_id, reaction) values ('course', 'f2000000-0000-0000-0000-0000000000c1', 'like')$$,
  '42501', null, 'cannot react before confirming age');
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$insert into public.reactions (item_type, item_id, reaction) values
  ('course', 'f2000000-0000-0000-0000-0000000000c1', 'like'),
  ('course', 'f2000000-0000-0000-0000-0000000000c2', 'dislike'),
  ('company', 'f2000000-0000-0000-0000-0000000000e1', 'like')$$, 'ready student likes and dislikes');
select throws_ok($$insert into public.reactions (item_type, item_id, reaction) values ('course', 'f2000000-0000-0000-0000-00000000dead', 'like')$$,
  '23503', null, 'an item that does not exist is refused');
select lives_ok($$update public.reactions set reaction = 'like' where item_id = 'f2000000-0000-0000-0000-0000000000c2'$$, 'changing a reaction');
select is(jsonb_array_length(public.liked_items() -> 'courses'), 2, 'liked courses listed');
select is((public.liked_items() -> 'companies' -> 0 ->> 'shortlisted')::boolean, false, 'shows whether it is shortlisted');
set local request.jwt.claims = '{"sub":"f2000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select is((select count(*)::int from public.reactions), 0, 'another student sees no reactions');
select is(jsonb_array_length(public.liked_items() -> 'courses'), 0, 'and an empty Liked area');

select * from finish();
rollback;
