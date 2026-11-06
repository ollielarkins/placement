-- pgTAP tests: university-wide T Level statements (migration 0025).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.universities (id, ukprn, name, source_url, tlevel_policy_status, tlevel_policy_quote, tlevel_policy_url) values
  ('d1700000-0000-0000-0000-0000000000a1', '17000001', 'Fixture Seventeen Uni', 'https://example.org/du',
   'not_accepted', 'We do not currently accept T Levels.', 'https://example.org/t-levels');
insert into public.uni_courses (id, university_id, kis_course_id, kis_mode, title, subject_group, source_url,
                                tlevel_status, tlevel_quote, tlevel_quote_url, tlevel_assessed_at) values
  ('d1700000-0000-0000-0000-0000000000c1', 'd1700000-0000-0000-0000-0000000000a1', 'A', 1, 'Silent page', 'engineering', 'https://example.org/du', 'unknown', null, null, now()),
  ('d1700000-0000-0000-0000-0000000000c2', 'd1700000-0000-0000-0000-0000000000a1', 'B', 1, 'Own answer', 'engineering', 'https://example.org/du',
   'accepted', 'T Levels: Merit.', 'https://example.org/b', now()),
  ('d1700000-0000-0000-0000-0000000000c3', 'd1700000-0000-0000-0000-0000000000a1', 'C', 1, 'Not checked yet', 'engineering', 'https://example.org/du', 'unknown', null, null, null);

select ok(import.apply_university_tlevel_policies() >= 1, 'policies apply');
select is((select tlevel_status::text || '/' || tlevel_scope::text from public.uni_courses where id = 'd1700000-0000-0000-0000-0000000000c1'),
  'not_accepted/university', 'a silent course takes the university statement');
select is((select tlevel_status::text || '/' || tlevel_scope::text from public.uni_courses where id = 'd1700000-0000-0000-0000-0000000000c2'),
  'accepted/course', 'a course''s own page wins');
select is((select tlevel_status::text from public.uni_courses where id = 'd1700000-0000-0000-0000-0000000000c3'),
  'unknown', 'courses not checked yet are left alone');

update public.universities set tlevel_policy_status = 'unknown' where id = 'd1700000-0000-0000-0000-0000000000a1';
select ok(import.apply_university_tlevel_policies() >= 1, 'a withdrawn statement is removed');
set local role anon;
select is((select tlevel_scope::text from public.search_uni_courses('{"q":"Fixture Seventeen","group":"engineering"}') where title = 'Silent page'),
  'course', 'search returns the scope, back to the course''s own (unknown) reading');

select * from finish();
rollback;
