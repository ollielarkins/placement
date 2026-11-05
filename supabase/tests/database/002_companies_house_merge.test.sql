-- pgTAP tests: import.merge_companies_house().
-- Run with: supabase test db
-- All fixtures are fictional and rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Helper: new run + staged rows from a compact spec.
create function pg_temp.stage(p_full boolean, p_rows jsonb) returns uuid
language plpgsql as $$
declare v_run uuid;
begin
  insert into import.runs (source, file_name, is_full) values ('companies_house', 'test.zip', p_full)
  returning id into v_run;
  insert into import.ch_companies (run_id, ch_number, name, ch_status, in_scope, sic_codes, sectors,
    keywords, size_band, postcode, region, county, lat, lon)
  select v_run, r->>'ch', r->>'name', coalesce(r->>'status', 'Active'), coalesce((r->>'in_scope')::boolean, true),
         array['26110'], array['electronics'], array['Manufacture of electronic components'],
         coalesce(r->>'size', 'small')::size_band, r->>'pc', 'east_of_england', 'Bedfordshire',
         coalesce((r->>'lat')::float8, 52.0), coalesce((r->>'lon')::float8, -0.45)
  from jsonb_array_elements(p_rows) r;
  return v_run;
end $$;

-- Fixtures: one curated company with no CH number yet, one curated with a CH
-- number, one admin-hidden imported company.
insert into public.companies (id, name, data_source, verified_at, size_band, summary) values
  ('20000000-0000-0000-0000-00000000000a', 'Fixture Curated Electronics Ltd', 'verified', now(), 'large',
   'Curated summary'),
  ('20000000-0000-0000-0000-00000000000b', 'Fixture Curated Two', 'verified', now(), 'large', null);
update public.companies set ch_number = 'TT000002' where id = '20000000-0000-0000-0000-00000000000b';
insert into public.company_sites (company_id, label, postcode, location) values
  ('20000000-0000-0000-0000-00000000000a', 'Main works', 'MK45 1ZZ',
   extensions.st_setsrid(extensions.st_makepoint(-0.45, 52.0), 4326)::extensions.geography);
insert into public.companies (name, ch_number, data_source, status, status_reason) values
  ('FIXTURE ADMIN HIDDEN LTD', 'TT000009', 'imported', 'hidden', 'admin: employer takedown request');

-- ---------------------------------------------------------------------------
-- Run 1 (full)
-- ---------------------------------------------------------------------------
select pg_temp.stage(true, '[
  {"ch":"TT000001","name":"FIXTURE NEW ENGINEERING LTD","pc":"MK45 1AA"},
  {"ch":"TT000003","name":"FIXTURE CURATED ELECTRONICS LIMITED","pc":"MK45 1ZZ","size":"medium"},
  {"ch":"TT000002","name":"FIXTURE CURATED TWO LTD","pc":"MK45 1BB","size":"micro"},
  {"ch":"TT000004","name":"FIXTURE WELSH LTD","pc":"CF10 1AA","in_scope":false},
  {"ch":"TT000005","name":"FIXTURE LIQUIDATING LTD","pc":"MK45 1CC"},
  {"ch":"TT000006","name":"FIXTURE GONE NEXT MONTH LTD","pc":"MK45 1DD"},
  {"ch":"TT000009","name":"FIXTURE ADMIN HIDDEN LTD","pc":"MK45 1EE"}
]') as run1 \gset
select lives_ok(format('select import.merge_companies_house(%L)', :'run1'), 'run 1 merges');

select is((select data_source::text from public.companies where ch_number = 'TT000001'), 'imported',
  'new in-scope company is created as imported');
select is((select verified_at from public.companies where ch_number = 'TT000001'), null,
  'imported company has no verified_at');
select is((select count(*)::int from public.company_sites s join public.companies c on c.id = s.company_id
           where c.ch_number = 'TT000001' and s.kind = 'registered_office'), 1,
  'registered office site written');
select is((select count(*)::int from public.company_sources s join public.companies c on c.id = s.company_id
           where c.ch_number = 'TT000001' and s.field = 'companies_house'
             and s.url = 'https://find-and-update.company-information.service.gov.uk/company/TT000001'), 1,
  'Companies House source URL recorded');
select is((select count(*)::int from public.companies where ch_number = 'TT000004'), 0,
  'out-of-scope company we do not hold is not created');

-- Curated record linked on name + postcode, not duplicated.
select is((select ch_number from public.companies where id = '20000000-0000-0000-0000-00000000000a'), 'TT000003',
  'curated record without a CH number is linked on normalised name + postcode');
select is((select count(*)::int from public.companies where name_normalised = 'fixture curated electronics'), 1,
  'linking does not create a duplicate');
select is((select (data_source::text, name, size_band::text, summary)::text
           from public.companies where id = '20000000-0000-0000-0000-00000000000a'),
  '(verified,"Fixture Curated Electronics Ltd",large,"Curated summary")',
  'linking keeps curated name, size band and summary');

-- Curated record already holding a CH number: SIC updated, curated fields kept.
select is((select (name, size_band::text, sic_codes)::text from public.companies where ch_number = 'TT000002'),
  '("Fixture Curated Two",large,{26110})',
  'CH refreshes SIC codes on a verified record but not its name or size band');
select is((select count(*)::int from public.company_sites s join public.companies c on c.id = s.company_id
           where c.ch_number = 'TT000002' and s.kind = 'registered_office'), 1,
  'verified record gains a registered office site');

select is((select status::text from public.companies where ch_number = 'TT000009'), 'hidden',
  'admin-hidden company stays hidden');

select throws_ok(format('select import.merge_companies_house(%L)', :'run1'), 'P0001', null,
  'a run cannot be merged twice');
select is((select count(*)::int from import.ch_companies where run_id = :'run1'), 0,
  'staging rows are cleared after the merge');

-- ---------------------------------------------------------------------------
-- Run 2 (full): rename, liquidation, one company gone, registered office moved
-- ---------------------------------------------------------------------------
select pg_temp.stage(true, '[
  {"ch":"TT000001","name":"FIXTURE RENAMED ENGINEERING LTD","pc":"MK45 2AA","lat":52.1},
  {"ch":"TT000003","name":"FIXTURE CURATED ELECTRONICS LIMITED","pc":"MK45 1ZZ"},
  {"ch":"TT000002","name":"FIXTURE CURATED TWO LTD","pc":"MK45 1BB"},
  {"ch":"TT000005","name":"FIXTURE LIQUIDATING LTD","pc":"MK45 1CC","status":"Liquidation","in_scope":false},
  {"ch":"TT000009","name":"FIXTURE ADMIN HIDDEN LTD","pc":"MK45 1EE"}
]') as run2 \gset
select lives_ok(format('select import.merge_companies_house(%L)', :'run2'), 'run 2 merges');

select is((select name from public.companies where ch_number = 'TT000001'), 'FIXTURE RENAMED ENGINEERING LTD',
  'imported company takes the new CH name');
select is((select s.postcode from public.company_sites s join public.companies c on c.id = s.company_id
           where c.ch_number = 'TT000001' and s.kind = 'registered_office'), 'MK45 2AA',
  'registered office moves rather than duplicating');
select is((select (status, status_reason)::text from public.companies where ch_number = 'TT000005'),
  '(hidden,ch:Liquidation)', 'company in liquidation is hidden with the reason');
select is((select (status, status_reason)::text from public.companies where ch_number = 'TT000006'),
  '(dissolved,ch:not_in_snapshot)', 'imported company missing from a full snapshot is dissolved');
select is((select status::text from public.companies where ch_number = 'TT000009'), 'hidden',
  'admin hide survives a run where CH says Active');

-- ---------------------------------------------------------------------------
-- Run 3 (partial): the liquidation was rescinded
-- ---------------------------------------------------------------------------
select pg_temp.stage(false, '[{"ch":"TT000005","name":"FIXTURE LIQUIDATING LTD","pc":"MK45 1CC"}]') as run3 \gset
select import.merge_companies_house(:'run3');
select is((select (status, status_reason)::text from public.companies where ch_number = 'TT000005'),
  '(active,)', 'our own hide is undone when the company is Active and in scope again');

-- ---------------------------------------------------------------------------
-- Safety and privileges
-- ---------------------------------------------------------------------------
insert into public.companies (name, ch_number, data_source)
select 'BULK ' || g, 'BK' || lpad(g::text, 6, '0'), 'imported' from generate_series(1, 1100) g;
select pg_temp.stage(true, '[{"ch":"TT000001","name":"FIXTURE RENAMED ENGINEERING LTD","pc":"MK45 2AA"}]') as run4 \gset
select throws_like(format('select import.merge_companies_house(%L)', :'run4'), '%refusing to merge%',
  'a truncated full run cannot dissolve the register');

set local role anon;
select throws_ok('select * from import.ch_companies', '42501', null, 'anon cannot read staging');
reset role;
set local role authenticated;
select throws_ok(format('select import.merge_companies_house(%L)', :'run4'), '42501', null,
  'authenticated cannot run the merge');
reset role;

select * from finish();
rollback;
