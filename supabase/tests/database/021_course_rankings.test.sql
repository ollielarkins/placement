-- pgTAP tests: rankings on courses (migration 0030).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.universities (id, ukprn, name, source_url, tef_overall, overall_rank, overall_rank_of, overall_rank_tied) values
  ('f2100000-0000-0000-0000-0000000000a1', '21000001', 'Fixture TwentyOne High', 'https://example.org/du', 'Gold', 3, 200, false),
  ('f2100000-0000-0000-0000-0000000000a2', '21000002', 'Fixture TwentyOne Low', 'https://example.org/du', null, null, null, null);
insert into public.uni_courses (id, university_id, kis_course_id, kis_mode, title, subject_group, source_url,
                                rank_subject, subject_rank, subject_rank_of, subject_rank_tied, satisfaction_pct, median_salary) values
  ('f2100000-0000-0000-0000-0000000000c1', 'f2100000-0000-0000-0000-0000000000a2', 'A', 1, 'Fixture TwentyOne Electronics', 'engineering',
   'https://example.org/du', 'CAH10-01-08', 40, 100, false, 77, 28000),
  ('f2100000-0000-0000-0000-0000000000c2', 'f2100000-0000-0000-0000-0000000000a1', 'B', 1, 'Fixture TwentyOne Electrical', 'engineering',
   'https://example.org/du', 'CAH10-01-08', 2, 100, true, 85, 32000),
  ('f2100000-0000-0000-0000-0000000000c3', 'f2100000-0000-0000-0000-0000000000a2', 'C', 1, 'Fixture TwentyOne Unranked', 'engineering',
   'https://example.org/du', null, null, null, null, null, null);

select throws_ok($$update public.uni_courses set subject_rank = 101 where id = 'f2100000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'a rank cannot exceed the field');
select throws_ok($$update public.universities set tef_overall = 'Platinum' where id = 'f2100000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'only official TEF ratings');

set local role anon;
select is((select count(*)::int from public.cah_subjects), 34, 'subject labels are public');
select is((select array_agg(title order by title) from public.search_uni_courses('{"q":"Fixture TwentyOne"}')) is not null, true, 'search still works');
select is((select array_agg(title) from public.search_uni_courses('{"q":"Fixture TwentyOne","sort":"rank"}')),
  array['Fixture TwentyOne Electrical', 'Fixture TwentyOne Electronics', 'Fixture TwentyOne Unranked'], 'best ranked first, unranked last');
select is((select subject_label from public.search_uni_courses('{"q":"Fixture TwentyOne Electrical"}') limit 1),
  'Electrical and electronic engineering', 'search returns the subject label');
select is((select (tef_overall, overall_rank, subject_rank, subject_rank_tied)::text from public.search_uni_courses('{"q":"Fixture TwentyOne Electrical"}') limit 1),
  '(Gold,3,2,t)', 'search returns TEF and both ranks');
select is(public.uni_course_detail('f2100000-0000-0000-0000-0000000000c2') -> 'university' ->> 'overall_rank_of', '200', 'detail has the overall rank');
select is((public.uni_course_detail('f2100000-0000-0000-0000-0000000000c1') ->> 'median_salary')::int, 28000, 'detail has the measures');
reset role;

select * from finish();
rollback;
