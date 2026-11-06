-- pgTAP tests: filtering courses by expected T Level and A level grades (migration 0039).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(public.alevel_grade_points('A levels: Maths at B, Physics at C'), 4::smallint, 'the highest grade asked for');

insert into public.universities (id, ukprn, name, source_url) values
  ('f2900000-0000-0000-0000-0000000000a1', '29000001', 'Fixture TwentyNine', 'https://example.org/du');
insert into public.uni_courses (university_id, kis_course_id, kis_mode, title, subject_group, source_url,
                                tlevel_status, tlevel_requirement, tlevel_quote, tlevel_quote_url, tlevel_alevel) values
  ('f2900000-0000-0000-0000-0000000000a1', 'A', 1, 'Fixture TwentyNine Merit', 'engineering', 'https://example.org/du', 'accepted', 'Merit', 'q', 'https://example.org/c', null),
  ('f2900000-0000-0000-0000-0000000000a1', 'B', 1, 'Fixture TwentyNine Distinction Maths B', 'engineering', 'https://example.org/du', 'accepted_with_maths', 'Distinction', 'q', 'https://example.org/c', 'A level Maths at B'),
  ('f2900000-0000-0000-0000-0000000000a1', 'C', 1, 'Fixture TwentyNine Merit Maths A', 'engineering', 'https://example.org/du', 'accepted_with_maths', 'Merit', 'q', 'https://example.org/c', 'A level Maths at A'),
  ('f2900000-0000-0000-0000-0000000000a1', 'D', 1, 'Fixture TwentyNine No grade', 'engineering', 'https://example.org/du', 'accepted', null, 'q', 'https://example.org/c', null),
  ('f2900000-0000-0000-0000-0000000000a1', 'E', 1, 'Fixture TwentyNine Not accepted', 'engineering', 'https://example.org/du', 'not_accepted', null, 'q', 'https://example.org/c', null);

set local role anon;
select is((select array_agg(title order by title) from public.search_uni_courses('{"q":"Fixture TwentyNine","tgrade":"merit"}')),
  array['Fixture TwentyNine Merit', 'Fixture TwentyNine Merit Maths A', 'Fixture TwentyNine No grade'], 'Merit: Merit or lower, or no stated grade');
select is((select array_agg(title order by title) from public.search_uni_courses('{"q":"Fixture TwentyNine","tgrade":"distinction","agrade":"B"}')),
  array['Fixture TwentyNine Distinction Maths B', 'Fixture TwentyNine Merit', 'Fixture TwentyNine No grade'], 'an A level B leaves out a course wanting A');
select is((select array_agg(title order by title) from public.search_uni_courses('{"q":"Fixture TwentyNine","agrade":"none"}')),
  array['Fixture TwentyNine Merit', 'Fixture TwentyNine No grade', 'Fixture TwentyNine Not accepted'], 'no A level: courses needing one left out');
select is((select courses from public.uni_course_universities('{"q":"Fixture TwentyNine","tgrade":"pass"}')), 1::bigint,
  'the university list uses the same filters');
select is((select total from public.search_uni_courses('{"q":"Fixture TwentyNine","tgrade":"bogus"}') limit 1), 5::bigint, 'an unknown grade is ignored');
reset role;

select * from finish();
rollback;
