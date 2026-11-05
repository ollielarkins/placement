-- pgTAP tests: import.merge_seed() (curated seed import).
-- Run with: supabase test db
-- All fixtures are fictional and rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.seed(p_rows jsonb) returns uuid
language plpgsql as $$
declare v_run uuid;
begin
  insert into import.runs (source, file_name, is_full) values ('curated_seed', 'test.csv', false)
  returning id into v_run;
  insert into import.seed_companies (run_id, file_name, row_no, name, ch_number, website, summary,
    size_band, specialisms, takes_tlevel, tlevel_evidence_url, verified_at, sites, sources)
  select v_run, 'test.csv', (r->>'row')::int, r->>'name', r->>'ch', r->>'web', r->>'summary',
         (r->>'size')::size_band,
         case when r ? 'specs' then array(select jsonb_array_elements_text(r->'specs')) end,
         (r->>'takes')::tri_state, r->>'evidence', '2026-11-01',
         coalesce(r->'sites', '[]'), '[{"field":"company","url":"https://example.test/src"}]'
  from jsonb_array_elements(p_rows) r;
  return v_run;
end $$;

-- Existing records: an imported company with a registered office and an
-- operating site, a student-submitted one with a website, two that will
-- collide, and one marked not taking placements.
insert into public.companies (id, name, ch_number, website, data_source, size_band, summary, status) values
  ('30000000-0000-0000-0000-00000000000a', 'FIXTURE IMPORTED LTD', 'SS000001', null, 'imported', 'small', 'Imported summary', 'active'),
  ('30000000-0000-0000-0000-00000000000b', 'Fixture Submitted', null, 'https://www.submitted.example', 'student_submitted', 'unknown', null, 'active'),
  ('30000000-0000-0000-0000-00000000000c', 'Fixture Clash One', 'SS000003', null, 'imported', 'unknown', null, 'active'),
  ('30000000-0000-0000-0000-00000000000d', 'Fixture Clash Two', null, 'https://clash.example', 'imported', 'unknown', null, 'active'),
  ('30000000-0000-0000-0000-00000000000e', 'Fixture Closed Door', 'SS000005', null, 'imported', 'unknown', null, 'not_taking_placements'),
  ('30000000-0000-0000-0000-00000000000f', 'Fixture Name Match', null, null, 'student_submitted', 'unknown', null, 'active');
insert into public.company_sites (company_id, kind, label, postcode, location) values
  ('30000000-0000-0000-0000-00000000000a', 'registered_office', 'Registered office', 'EC1A 1AA',
   extensions.st_setsrid(extensions.st_makepoint(-0.1, 51.5), 4326)::extensions.geography),
  ('30000000-0000-0000-0000-00000000000a', 'operating_site', 'Old works', 'MK45 9ZZ',
   extensions.st_setsrid(extensions.st_makepoint(-0.45, 52.0), 4326)::extensions.geography),
  ('30000000-0000-0000-0000-00000000000f', 'operating_site', 'Unit 4', 'MK42 9AH',
   extensions.st_setsrid(extensions.st_makepoint(-0.47, 52.13), 4326)::extensions.geography);

select pg_temp.seed('[
  {"row":2,"name":"Fixture Imported Ltd","ch":"SS000001","specs":["dd_electrical_electronic"],
   "sites":[{"label":"New works","postcode":"MK45 1AA","region":"east_of_england","lat":52.0,"lon":-0.45}]},
  {"row":3,"name":"Fixture Submitted Engineering","web":"https://submitted.example/about","takes":"no"},
  {"row":4,"name":"Fixture Clash","ch":"SS000003","web":"https://clash.example","takes":"no"},
  {"row":5,"name":"Fixture Closed Door","ch":"SS000005","takes":"yes","evidence":"https://closed.example/tl"},
  {"row":6,"name":"Fixture Name Match","specs":["dd_mechanical"],
   "sites":[{"label":"Unit 4","postcode":"mk429ah","region":"east_of_england","lat":52.13,"lon":-0.47}]},
  {"row":7,"name":"Fixture Brand New","ch":"SS000099","specs":["mpc_composites"]},
  {"row":8,"name":"Fixture Wrong Number","ch":"SS000088","web":"https://www.submitted.example","takes":"no"}
]') as run1 \gset
select lives_ok(format('select import.merge_seed(%L)', :'run1'), 'seed run merges');

-- Row 2: CH number match
select is((select (action, matched_on)::text from import.seed_results where run_id = :'run1' and row_no = 2),
  '(updated,ch_number)', 'matched on CH number');
select is((select (data_source, name, verified_at::date)::text from public.companies where ch_number = 'SS000001'),
  '(verified,"Fixture Imported Ltd",2026-11-01)', 'imported record becomes Verified with the curated name');
select is((select (summary, size_band)::text from public.companies where ch_number = 'SS000001'),
  '("Imported summary",small)', 'blank curated columns keep existing values');
select is((select array_agg(label order by label)::text from public.company_sites
           where company_id = '30000000-0000-0000-0000-00000000000a'),
  '{"New works","Registered office"}', 'operating sites replaced; registered office untouched');
select is((select count(*)::int from public.company_sources
           where company_id = '30000000-0000-0000-0000-00000000000a' and field = 'company'), 1,
  'source recorded');

-- Row 3: domain match (www and path ignored)
select is((select (action, matched_on, company_id)::text from import.seed_results where run_id = :'run1' and row_no = 3),
  '(updated,domain,30000000-0000-0000-0000-00000000000b)', 'matched on website domain');
select is((select data_source::text from public.companies where id = '30000000-0000-0000-0000-00000000000b'),
  'verified', 'student-submitted record becomes Verified');

-- Row 4: CH number and domain point at different companies
select is((select action from import.seed_results where run_id = :'run1' and row_no = 4), 'rejected',
  'conflicting keys are rejected, not guessed');
select is((select data_source::text from public.companies where id = '30000000-0000-0000-0000-00000000000d'),
  'imported', 'neither clashing record is touched');

-- Row 5: T Level evidence re-opens a company marked not taking placements
select is((select status::text from public.companies where ch_number = 'SS000005'), 'active',
  'new T Level evidence re-opens a not-taking-placements company');

-- Row 6: name + postcode match (postcode normalised)
select is((select (action, matched_on)::text from import.seed_results where run_id = :'run1' and row_no = 6),
  '(updated,name_postcode)', 'matched on normalised name + postcode');

-- Row 7: new
select is((select (data_source, ch_number)::text from public.companies c
           join import.seed_results r on r.company_id = c.id where r.run_id = :'run1' and r.row_no = 7),
  '(verified,SS000099)', 'unmatched row creates a Verified company');

-- Row 8: domain match but that company already has a different CH number?
-- (b has none, so the CH number is adopted.)
select is((select action from import.seed_results where run_id = :'run1' and row_no = 8), 'updated',
  'domain match with no CH number on file adopts the curated CH number');
select is((select ch_number from public.companies where id = '30000000-0000-0000-0000-00000000000b'), 'SS000088',
  'CH number filled in');

select throws_ok(format('select import.merge_seed(%L)', :'run1'), 'P0001', null, 'a run cannot be merged twice');

set local role authenticated;
select throws_ok(format('select import.merge_seed(%L)', :'run1'), '42501', null, 'authenticated cannot run the merge');
reset role;

select * from finish();
rollback;
