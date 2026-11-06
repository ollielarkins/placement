-- pgTAP tests: hiding universities from a course search (migration 0035).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.universities (id, ukprn, name, source_url) values
  ('f2600000-0000-0000-0000-0000000000a1', '26000001', 'Fixture TwentySix Alpha', 'https://example.org/du'),
  ('f2600000-0000-0000-0000-0000000000a2', '26000002', 'Fixture TwentySix Beta', 'https://example.org/du');
insert into public.uni_courses (university_id, kis_course_id, kis_mode, title, subject_group, source_url) values
  ('f2600000-0000-0000-0000-0000000000a1', 'A', 1, 'Fixture TwentySix One', 'engineering', 'https://example.org/du'),
  ('f2600000-0000-0000-0000-0000000000a1', 'B', 1, 'Fixture TwentySix Two', 'engineering', 'https://example.org/du'),
  ('f2600000-0000-0000-0000-0000000000a2', 'C', 1, 'Fixture TwentySix Three', 'engineering', 'https://example.org/du');

set local role anon;
select is((select array_agg(distinct university) from public.search_uni_courses('{"q":"Fixture TwentySix","hide":["26000001"]}')),
  array['Fixture TwentySix Beta'], 'a hidden university is left out');
select is((select total from public.search_uni_courses('{"q":"Fixture TwentySix","hide":["26000001","not-a-ukprn"]}') limit 1), 1::bigint,
  'bad values are ignored');
select is((select array_agg(name || ':' || courses order by name) from public.uni_course_universities('{"q":"Fixture TwentySix","hide":["26000001"]}')),
  array['Fixture TwentySix Alpha:2', 'Fixture TwentySix Beta:1'], 'the list still includes hidden ones, with counts');
select is((select sum(courses)::bigint from public.uni_course_universities('{"q":"Fixture TwentySix"}')),
  (select total from public.search_uni_courses('{"q":"Fixture TwentySix"}') limit 1), 'counts match the search');
reset role;

select * from finish();
rollback;
