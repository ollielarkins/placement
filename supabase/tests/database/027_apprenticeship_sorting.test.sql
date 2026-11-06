-- pgTAP tests: apprenticeship wage figure, level bands, sorting and summary (migration 0036).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(public.wage_annual('£24,000 a year'), 24000, 'yearly wage');
select is(public.wage_annual('£1,800 a month. Plus overtime'), 21600, 'monthly wage x 12');
select is(public.wage_annual('£450 a week'), 23400, 'weekly wage x 52');
select is(public.wage_annual('National Minimum Wage for apprentices'), null, 'no figure for minimum wage');

insert into public.companies (id, name, data_source) values ('f2700000-0000-0000-0000-0000000000e1', 'Fixture TwentySeven Ltd', 'imported');
insert into public.vacancies (company_id, external_ref, title, closing_date, course_level, wage_text, posted_on) values
  ('f2700000-0000-0000-0000-0000000000e1', 'fx27-a', 'Fixture TwentySeven Degree', current_date + 30, 6, '£22,000 a year', current_date - 1),
  ('f2700000-0000-0000-0000-0000000000e1', 'fx27-b', 'Fixture TwentySeven Advanced', current_date + 3, 3, '£500 a week', current_date - 20),
  ('f2700000-0000-0000-0000-0000000000e1', 'fx27-c', 'Fixture TwentySeven Higher', current_date + 10, 4, 'National Minimum Wage for apprentices', current_date - 5),
  ('f2700000-0000-0000-0000-0000000000e1', 'fx27-d', 'Fixture TwentySeven Closed', current_date - 1, 6, '£40,000 a year', current_date - 60);

set local role anon;
select is((select array_agg(title) from public.search_apprenticeships('{"q":"Fixture TwentySeven","sort":"wage"}')),
  array['Fixture TwentySeven Advanced', 'Fixture TwentySeven Degree', 'Fixture TwentySeven Higher'], 'highest wage first, none last, closed adverts left out');
select is((select array_agg(title) from public.search_apprenticeships('{"q":"Fixture TwentySeven","sort":"closing"}')),
  array['Fixture TwentySeven Advanced', 'Fixture TwentySeven Higher', 'Fixture TwentySeven Degree'], 'closing soonest first');
select is((select array_agg(title) from public.search_apprenticeships('{"q":"Fixture TwentySeven","band":"higher"}')),
  array['Fixture TwentySeven Higher'], 'higher band is levels 4 and 5');
select is((select (total, advanced, higher, degree, closing_this_week, top_wage)::text from public.apprenticeship_summary('{"q":"Fixture TwentySeven"}')),
  '(3,1,1,1,1,26000)', 'summary counts');
reset role;

select * from finish();
rollback;
