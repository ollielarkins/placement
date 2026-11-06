-- pgTAP tests: league table links (migration 0031).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
insert into public.universities (id, ukprn, name, source_url) values
  ('f2200000-0000-0000-0000-0000000000a1', '22000001', 'Fixture TwentyTwo', 'https://example.org/du');
insert into public.uni_courses (id, university_id, kis_course_id, kis_mode, title, subject_group, source_url, rank_subject) values
  ('f2200000-0000-0000-0000-0000000000c1', 'f2200000-0000-0000-0000-0000000000a1', 'A', 1, 'Fixture TwentyTwo EEE', 'engineering', 'https://example.org/du', 'CAH10-01-08'),
  ('f2200000-0000-0000-0000-0000000000c2', 'f2200000-0000-0000-0000-0000000000a1', 'B', 1, 'Fixture TwentyTwo Civil', 'engineering', 'https://example.org/du', 'CAH10-01-07');
set local role anon;
select is((select count(*)::int from public.cah_subjects where league_table_url is not null), 4, 'four subjects link to a table');
select is(public.uni_course_detail('f2200000-0000-0000-0000-0000000000c1') ->> 'subject_league_table_url',
  'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings/electrical-and-electronic-engineering', 'EEE course links to its table');
select is(public.uni_course_detail('f2200000-0000-0000-0000-0000000000c2') ->> 'subject_league_table_url', null, 'no link where we have none');
reset role;
select * from finish();
rollback;
