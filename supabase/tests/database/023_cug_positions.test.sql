-- pgTAP tests: Complete University Guide positions (migration 0032).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.universities (id, ukprn, name, source_url) values
  ('f2300000-0000-0000-0000-0000000000a1', '23000001', 'Fixture TwentyThree A', 'https://example.org/du'),
  ('f2300000-0000-0000-0000-0000000000a2', '23000002', 'Fixture TwentyThree B', 'https://example.org/du');
insert into public.uni_courses (id, university_id, kis_course_id, kis_mode, title, subject_group, source_url, subject_codes) values
  ('f2300000-0000-0000-0000-0000000000c1', 'f2300000-0000-0000-0000-0000000000a1', 'A', 1, 'Fixture TwentyThree Electronics', 'engineering',
   'https://example.org/du', array['CAH10-01-08']),
  ('f2300000-0000-0000-0000-0000000000c2', 'f2300000-0000-0000-0000-0000000000a2', 'B', 1, 'Fixture TwentyThree Electronics', 'engineering',
   'https://example.org/du', array['CAH10-01-10', 'CAH10-01-08']),
  ('f2300000-0000-0000-0000-0000000000c3', 'f2300000-0000-0000-0000-0000000000a2', 'C', 1, 'Fixture TwentyThree Civil', 'engineering',
   'https://example.org/du', array['CAH10-01-07']);
insert into public.league_table_positions (edition, cah_code, university_id, position, tied, table_size) values
  (2027, 'CAH10-01-08', 'f2300000-0000-0000-0000-0000000000a1', 9, false, 71),
  (2027, 'CAH10-01-08', 'f2300000-0000-0000-0000-0000000000a2', 3, true, 71),
  (2027, null, 'f2300000-0000-0000-0000-0000000000a2', 40, false, 130);

select throws_ok($$insert into public.league_table_positions (edition, cah_code, university_id, position, table_size)
  values (2027, 'CAH10-01-08', 'f2300000-0000-0000-0000-0000000000a1', 5, 71)$$, '23505', null, 'one position per table per university');

set local role anon;
select throws_ok($$insert into public.league_table_positions (edition, university_id, position, table_size)
  values (2027, 'f2300000-0000-0000-0000-0000000000a1', 1, 130)$$, '42501', null, 'the public cannot add positions');
select is((select array_agg(university || ':' || cug_subject_position order by cug_subject_position)
           from public.search_uni_courses('{"q":"Fixture TwentyThree Electronics","sort":"cug"}')),
  array['Fixture TwentyThree B:3', 'Fixture TwentyThree A:9'], 'sort by CUG subject position');
select is((select (cug_subject_label, cug_subject_tied, cug_overall_position, cug_overall_of)::text
           from public.search_uni_courses('{"q":"Fixture TwentyThree B"}') where title like '%Electronics'),
  '("Electrical and electronic engineering",t,40,130)', 'a later subject code still finds its table');
select is((select cug_subject_position from public.search_uni_courses('{"q":"Fixture TwentyThree Civil"}')), null::smallint,
  'no subject position without a table');
select is(public.uni_course_detail('f2300000-0000-0000-0000-0000000000c1') -> 'cug' ->> 'subject_url',
  'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings/electrical-and-electronic-engineering', 'detail links the table');
select is(public.uni_course_detail('f2300000-0000-0000-0000-0000000000c1') -> 'cug' ->> 'overall_position', null, 'no overall position when not listed');
reset role;

select * from finish();
rollback;
