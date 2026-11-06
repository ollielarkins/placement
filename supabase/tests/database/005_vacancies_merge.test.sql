-- pgTAP tests: import.merge_vacancies() and the CH import's added_by rule.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.stage(p_full boolean, p_rows jsonb) returns uuid
language plpgsql as $$
declare v_run uuid;
begin
  insert into import.runs (source, file_name, is_full) values ('apprenticeship_vacancies', 'test', p_full)
  returning id into v_run;
  insert into import.faa_vacancies (run_id, external_ref, employer_name, employer_website, title, level,
    url, closing_date, postcode, region, lat, lon, ch_candidates)
  select v_run, r->>'ref', r->>'employer', r->>'web', 'Fixture apprentice', 'Advanced (level 3)',
         'https://www.findapprenticeship.service.gov.uk/apprenticeship/reference/' || (r->>'ref'),
         current_date + 30, r->>'pc', 'east_of_england', 52.0, -0.45, coalesce(r->'cands', '[]')
  from jsonb_array_elements(p_rows) r;
  return v_run;
end $$;

-- Start from an empty advert table so the full-run safety check is predictable
-- (rolled back with everything else).
delete from public.vacancies;

insert into public.companies (id, name, ch_number, website, data_source, verified_at, added_by) values
  ('50000000-0000-0000-0000-00000000000a', 'FIXTURE WIDGETS LIMITED', 'VV000001', null, 'imported', null, 'companies_house'),
  ('50000000-0000-0000-0000-00000000000b', 'Fixture Web Co', null, 'https://www.fixtureweb.example', 'verified', now(), null),
  ('50000000-0000-0000-0000-00000000000c', 'FIXTURE HELD LTD', 'VV000003', null, 'imported', null, 'companies_house');
insert into public.company_sites (company_id, kind, postcode, location) values
  ('50000000-0000-0000-0000-00000000000a', 'registered_office', 'MK45 1AA',
   extensions.st_setsrid(extensions.st_makepoint(-0.45, 52.0), 4326)::extensions.geography);

select pg_temp.stage(true, '[
  {"ref":"9000001","employer":"Fixture Widgets Ltd","pc":"MK45 1AA"},
  {"ref":"9000002","employer":"Some Other Trading Name","web":"https://fixtureweb.example/careers","pc":"SG15 6RW"},
  {"ref":"9000003","employer":"FIXTURE HELD LIMITED","pc":"LU1 1AA",
   "cands":[{"ch_number":"VV000003","name":"FIXTURE HELD LTD","sic_codes":["28990"],"size_band":"small"}]},
  {"ref":"9000004","employer":"Fixture Nuclear Ltd","pc":"RG7 4PR",
   "cands":[{"ch_number":"VV000004","name":"FIXTURE NUCLEAR LIMITED","sic_codes":["84220"],"size_band":"medium",
             "postcode":"RG7 4PR","region":"south_east","lat":51.36,"lon":-1.15}]},
  {"ref":"9000005","employer":"Fixture Twins Ltd","pc":"MK45 1AA",
   "cands":[{"ch_number":"VV000005","name":"FIXTURE TWINS LTD"},{"ch_number":"VV000006","name":"FIXTURE TWINS LIMITED"}]},
  {"ref":"9000006","employer":"Royal Fixture Navy","pc":"PO1 3LS"}
]') as run1 \gset
select lives_ok(format('select import.merge_vacancies(%L)', :'run1'), 'vacancies run merges');

select is((select (action, matched_on, company_id)::text from import.vacancy_results where external_ref = '9000001'),
  '(linked,name_postcode,50000000-0000-0000-0000-00000000000a)', 'matched on name + advert postcode');
select is((select (action, matched_on, company_id)::text from import.vacancy_results where external_ref = '9000002'),
  '(linked,domain,50000000-0000-0000-0000-00000000000b)', 'matched on website domain despite a different name');
select is((select (action, matched_on, company_id)::text from import.vacancy_results where external_ref = '9000003'),
  '(linked,ch_lookup,50000000-0000-0000-0000-00000000000c)', 'register-unique name links to the company we hold');
select is((select (action, matched_on)::text from import.vacancy_results where external_ref = '9000004'),
  '(created_company,ch_lookup)', 'register-unique employer we lack is created');
select is((select (data_source, added_by, ch_number, size_band)::text from public.companies where ch_number = 'VV000004'),
  '(imported,vacancies,VV000004,medium)', 'created as Imported, tagged added_by = vacancies');
select is((select array_agg(kind::text order by kind) from public.company_sites s
           join public.companies c on c.id = s.company_id where c.ch_number = 'VV000004'),
  array['registered_office'], 'advert at the registered office postcode adds no duplicate site');
select is((select action from import.vacancy_results where external_ref = '9000005'), 'unmatched',
  'two register matches: not guessed');
select is((select action from import.vacancy_results where external_ref = '9000006'), 'unmatched',
  'no register match: not created');
-- Since 0037 unmatched adverts are kept too, without a company.
select is((select count(*)::int from public.vacancies where external_ref like '900000%'), 6,
  'every advert stored, unmatched ones included');
select is((select count(*)::int from public.vacancies where external_ref in ('9000005', '9000006') and company_id is null), 2,
  'unmatched adverts have no company');
select is((select count(*)::int from public.company_sites s where s.company_id = '50000000-0000-0000-0000-00000000000b'
           and s.kind = 'vacancy_site' and s.postcode = 'SG15 6RW'), 1, 'advert address becomes a vacancy site');
select is((select count(*)::int from public.company_sources where field = 'vacancies'
           and company_id = '50000000-0000-0000-0000-00000000000a'), 1, 'advert URL recorded as a source');

-- Ranking sees the live advert.
set local role anon;
select is((select live_vacancies from public.rank_companies('{}', '{"q":"Fixture Widgets"}') limit 1), 1,
  'rank_companies counts the live advert');
select is((select confidence from public.rank_companies('{}', '{"q":"Fixture Widgets"}') limit 1), 0.85,
  'imported company with a live advert gets confidence 0.85');
reset role;

-- Run 2 (full): advert 9000002 withdrawn.
select pg_temp.stage(true, '[
  {"ref":"9000001","employer":"Fixture Widgets Ltd","pc":"MK45 1AA"},
  {"ref":"9000003","employer":"FIXTURE HELD LIMITED","pc":"LU1 1AA",
   "cands":[{"ch_number":"VV000003","name":"FIXTURE HELD LTD"}]},
  {"ref":"9000004","employer":"Fixture Nuclear Ltd","pc":"RG7 4PR",
   "cands":[{"ch_number":"VV000004","name":"FIXTURE NUCLEAR LIMITED"}]}
]') as run2 \gset
select import.merge_vacancies(:'run2');
select is((select count(*)::int from public.vacancies where external_ref = '9000002'), 0,
  'withdrawn advert removed on a full run');
select is((select count(*)::int from public.company_sites where company_id = '50000000-0000-0000-0000-00000000000b'
           and kind = 'vacancy_site'), 0, 'its vacancy site goes with it');

-- CH import must not hide a vacancies-added company for being outside the SIC filter.
insert into import.runs (id, source, file_name, is_full)
  values ('50000000-0000-0000-0000-0000000000ff', 'companies_house', 'test.zip', false);
insert into import.ch_companies (run_id, ch_number, name, ch_status, in_scope, postcode, lat, lon) values
  ('50000000-0000-0000-0000-0000000000ff', 'VV000004', 'FIXTURE NUCLEAR LIMITED', 'Active', false, 'RG7 4PR', 51.36, -1.15);
select import.merge_companies_house('50000000-0000-0000-0000-0000000000ff');
select is((select status::text from public.companies where ch_number = 'VV000004'), 'active',
  'out-of-SIC-scope company added by vacancies stays active');

select * from finish();
rollback;
