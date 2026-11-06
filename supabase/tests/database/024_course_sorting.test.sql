-- pgTAP tests: course sorting (migration 0033).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is((select array_agg(public.tlevel_entry_points(r) order by o) from unnest(array[
  'Pass', 'Merit', 'Distinction', 'Distinction*', '96–112 UCAS points including maths', 'A full T Level', 'Alongside A levels', null
]) with ordinality as t (r, o)), array[72, 96, 144, 168, 96, 72, null, null]::smallint[], 'requirements become Tariff points');

insert into public.universities (id, ukprn, name, source_url) values
  ('f2400000-0000-0000-0000-0000000000a1', '24000001', 'Fixture TwentyFour Alpha', 'https://example.org/du'),
  ('f2400000-0000-0000-0000-0000000000a2', '24000002', 'Fixture TwentyFour Beta', 'https://example.org/du');
insert into public.uni_courses (university_id, kis_course_id, kis_mode, title, subject_group, source_url,
                                tlevel_status, tlevel_requirement, tlevel_quote, tlevel_quote_url, satisfaction_pct, median_salary) values
  ('f2400000-0000-0000-0000-0000000000a1', 'A', 1, 'Fixture TwentyFour Distinction', 'engineering', 'https://example.org/du',
   'accepted', 'Distinction', 'q', 'https://example.org/c', 70, 40000),
  ('f2400000-0000-0000-0000-0000000000a2', 'B', 1, 'Fixture TwentyFour Pass', 'engineering', 'https://example.org/du',
   'accepted', 'Pass', 'q', 'https://example.org/c', 90, 30000),
  ('f2400000-0000-0000-0000-0000000000a2', 'C', 1, 'Fixture TwentyFour Maths Merit', 'engineering', 'https://example.org/du',
   'accepted_with_maths', 'Merit', 'q', 'https://example.org/c', null, null);

set local role anon;
select is((select array_agg(title) from public.search_uni_courses('{"q":"Fixture TwentyFour","sort":"easiest"}')),
  array['Fixture TwentyFour Pass', 'Fixture TwentyFour Distinction', 'Fixture TwentyFour Maths Merit'], 'easiest entry first');
select is((select array_agg(title) from public.search_uni_courses('{"q":"Fixture TwentyFour","sort":"satisfaction"}')),
  array['Fixture TwentyFour Pass', 'Fixture TwentyFour Distinction', 'Fixture TwentyFour Maths Merit'], 'most satisfied first, no data last');
select is((select array_agg(title) from public.search_uni_courses('{"q":"Fixture TwentyFour","sort":"salary"}')),
  array['Fixture TwentyFour Distinction', 'Fixture TwentyFour Pass', 'Fixture TwentyFour Maths Merit'], 'highest salary first');
select is((select array_agg(university) from public.search_uni_courses('{"q":"Fixture TwentyFour","sort":"name"}'))[1],
  'Fixture TwentyFour Alpha', 'A to Z by university');
select is((select tlevel_points from public.search_uni_courses('{"q":"Fixture TwentyFour Pass"}') limit 1), 72::smallint, 'returns the points');
reset role;

select * from finish();
rollback;
