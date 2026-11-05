-- pgTAP tests: engineering-adjacent employers (migration 0021).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.companies (id, name, data_source, sic_codes, verified_at) values
  ('e0000000-0000-0000-0000-00000000000a', 'Fixture Fourteen Core Electrics', 'imported', array['27110'], null),
  ('e0000000-0000-0000-0000-00000000000b', 'Fixture Fourteen Adjacent Foods', 'imported', array['10890'], null),
  ('e0000000-0000-0000-0000-00000000000c', 'Fixture Fourteen Both', 'imported', array['10890', '33120'], null),
  ('e0000000-0000-0000-0000-00000000000d', 'Fixture Fourteen No SIC', 'verified', '{}', now());

select is((select array_agg(engineering_tier order by name) from public.companies where name like 'Fixture Fourteen%'),
  array['adjacent', 'core', 'core', 'adjacent'], 'tier from SIC codes: any core code makes a company core');

set local role anon;
select is((select count(*)::int from public.rank_companies('{}', '{"q":"Fixture Fourteen","limit":50}')), 4,
  'adjacent companies appear by default');
select is((select array_agg(name order by name) from public.rank_companies('{}', '{"q":"Fixture Fourteen","core_only":true,"limit":50}')),
  array['Fixture Fourteen Both', 'Fixture Fourteen Core Electrics'], 'core_only hides adjacent companies');
select is((select engineering_tier from public.rank_companies('{}', '{"q":"Fixture Fourteen Adjacent","limit":5}') limit 1),
  'adjacent', 'rank_companies returns the tier');
select is((public.company_detail('e0000000-0000-0000-0000-00000000000b') ->> 'engineering_tier'), 'adjacent',
  'company_detail returns the tier');
select ok((public.reference_data() -> 'sectors') ? 'food_and_drink', 'new sectors in reference data');

select * from finish();
rollback;
