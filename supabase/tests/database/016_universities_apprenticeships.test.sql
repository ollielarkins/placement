-- pgTAP tests: universities, course shortlist, apprenticeships (migration 0024).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.universities (id, ukprn, name, nation, on_dfe_tlevel_list, source_url) values
  ('d1600000-0000-0000-0000-0000000000a1', '10000001', 'Fixture Sixteen University', 'england', true, 'https://example.org/du'),
  ('d1600000-0000-0000-0000-0000000000a2', '10000002', 'Fixture Sixteen College of HE', 'wales', false, 'https://example.org/du');
insert into public.uni_courses (id, university_id, kis_course_id, kis_mode, title, qualification, subject_group, course_url,
                                location, tlevel_status, tlevel_requirement, tlevel_quote, tlevel_quote_url, source_url) values
  ('d1600000-0000-0000-0000-0000000000c1', 'd1600000-0000-0000-0000-0000000000a1', 'EEE1', 1, 'Electrical and Electronic Engineering', 'BEng (Hons)',
   'engineering', 'https://example.org/eee', st_setsrid(st_makepoint(-0.47, 52.13), 4326)::geography,
   'accepted_with_maths', 'Distinction', 'T Level in Engineering: Distinction plus A level Maths at B.', 'https://example.org/eee', 'https://example.org/du'),
  ('d1600000-0000-0000-0000-0000000000c2', 'd1600000-0000-0000-0000-0000000000a2', 'CS1', 1, 'Computer Science', 'BSc (Hons)',
   'computing', null, null, 'unknown', null, null, null, 'https://example.org/du');

select throws_ok($$insert into public.uni_courses (university_id, kis_course_id, kis_mode, title, subject_group, tlevel_status, source_url)
  values ('d1600000-0000-0000-0000-0000000000a1', 'X', 1, 'No quote', 'engineering', 'accepted', 'https://example.org/du')$$,
  '23514', null, 'a known T Level status needs the quote it came from');

set local role anon;
select is((select count(*)::int from public.search_uni_courses('{"q":"Fixture Sixteen"}')), 2, 'anon searches courses by university name');
select is((select title from public.search_uni_courses('{"q":"Fixture Sixteen","status":["accepted_with_maths"]}')),
  'Electrical and Electronic Engineering', 'filter by T Level status');
select is((select count(*)::int from public.search_uni_courses('{"q":"Fixture Sixteen","dfe_list":true}')), 1, 'filter to the DfE list');
select is((select count(*)::int from public.search_uni_courses('{"q":"Fixture Sixteen","lat":52.0,"lng":-0.5,"km":50}')), 1,
  'distance filter keeps nearby courses only');
select is((select count(*)::int from public.search_uni_courses('{"q":"Fixture Sixteen","nation":"wales"}')), 1, 'filter by nation');
select is(public.uni_course_detail('d1600000-0000-0000-0000-0000000000c1') ->> 'tlevel_quote',
  'T Level in Engineering: Distinction plus A level Maths at B.', 'detail returns the evidence quote');
select is(public.uni_course_detail('d1600000-0000-0000-0000-0000000000c1') -> 'university' ->> 'name',
  'Fixture Sixteen University', 'detail returns the university');
reset role;

insert into auth.users (id, email) values
  ('d1600000-0000-0000-0000-0000000000e1', 'ready16@example.org'),
  ('d1600000-0000-0000-0000-0000000000e2', 'new16@example.org');
update public.profiles set age_confirmed_at = now() where user_id = 'd1600000-0000-0000-0000-0000000000e1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1600000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ok($$insert into public.course_shortlist (course_id) values ('d1600000-0000-0000-0000-0000000000c1')$$,
  '42501', null, 'cannot shortlist a course before confirming age');
set local request.jwt.claims = '{"sub":"d1600000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok($$insert into public.course_shortlist (course_id) values ('d1600000-0000-0000-0000-0000000000c1')$$,
  'ready student shortlists a course');
set local request.jwt.claims = '{"sub":"d1600000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((select count(*)::int from public.course_shortlist), 0, 'another student sees no saved courses');
reset role;

-- Apprenticeships
insert into public.companies (id, name, data_source, verified_at, routes_onward) values
  ('d1600000-0000-0000-0000-0000000000f1', 'Fixture Sixteen Engineering', 'verified', now(), array['degree_apprenticeship']::public.route_onward[]);
insert into public.vacancies (company_id, external_ref, title, closing_date, url, course_level) values
  ('d1600000-0000-0000-0000-0000000000f1', 'FX16-1', 'Fixture Sixteen Apprentice A', current_date + 10, 'https://example.org/v1', 3),
  ('d1600000-0000-0000-0000-0000000000f1', 'FX16-2', 'Fixture Sixteen Apprentice B', current_date + 10, 'https://example.org/v2', 6);
insert into import.faa_vacancy_details (external_ref, wage_text, course_level, tlevel_mention) values
  ('FX16-2', '£24,000 a year', 6, 'Applicants with a T Level in Engineering are welcome.');
select is(import.apply_vacancy_details() >= 1, true, 'advert details load by reference');

set local role anon;
select is((select title from public.search_apprenticeships('{"q":"Fixture Sixteen Apprentice","tlevel":true}')),
  'Fixture Sixteen Apprentice B', 'filter to adverts that mention T Levels');
select ok(exists (select 1 from public.apprenticeship_employers('{"limit":50}') where name = 'Fixture Sixteen Engineering'),
  'employers with a degree apprenticeship route are listed');

select * from finish();
rollback;
