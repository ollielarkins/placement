-- pgTAP tests: Phase 1 read API (0012) and the read-model cache (0013).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.tlevel_routes (id, name, occupational_specialisms, specialism_labels, sic_prefixes) values
  ('fx_route7', 'Fixture Route 7', array['fx7_eee'], '{"fx7_eee":"Fixture EEE"}', array['99']);

insert into public.companies (id, name, specialisms, data_source, verified_at, takes_tlevel, tlevel_evidence_url, sic_codes) values
  ('70000000-0000-0000-0000-00000000000a', 'Fixture Seven Verified', array['fx7_eee'], 'verified', now(), 'yes', 'https://example.org/evidence', '{}'),
  ('70000000-0000-0000-0000-00000000000b', 'Fixture Seven SIC', '{}', 'imported', null, 'unknown', null, array['99001']),
  ('70000000-0000-0000-0000-00000000000c', 'Fixture Seven Other', '{}', 'imported', null, 'unknown', null, array['11111']);
-- All three on a remote spot (Lundy) so no real data shares the bbox.
insert into public.company_sites (company_id, kind, postcode, region, county, location) values
  ('70000000-0000-0000-0000-00000000000a', 'operating_site', 'EX39 2LY', 'south_west', null,
   extensions.st_setsrid(extensions.st_makepoint(-4.670, 51.180), 4326)::extensions.geography),
  ('70000000-0000-0000-0000-00000000000b', 'operating_site', 'EX39 2LY', 'south_west', null,
   extensions.st_setsrid(extensions.st_makepoint(-4.671, 51.181), 4326)::extensions.geography),
  ('70000000-0000-0000-0000-00000000000c', 'operating_site', 'EX39 2LY', 'south_west', null,
   extensions.st_setsrid(extensions.st_makepoint(-4.672, 51.182), 4326)::extensions.geography);

select public.refresh_read_models();

set local role anon;

select throws_ok('select count(*) from cache.map_points', '42501', null, 'anon cannot read the cache directly');
select throws_ok('select public.refresh_read_models()', '42501', null, 'anon cannot refresh the cache');

select is(
  (select jsonb_array_length(public.map_sites(-4.70, 51.17, -4.65, 51.19, 12, '{}') -> 'features')),
  3, 'zoomed in: one point per site');
select is(
  (select array_agg(f -> 'properties' ->> 'name' order by f -> 'properties' ->> 'name')
   from jsonb_array_elements(public.map_sites(-4.70, 51.17, -4.65, 51.19, 12, '{"route_id":"fx_route7"}') -> 'features') f),
  array['Fixture Seven SIC', 'Fixture Seven Verified'], 'route filter matches on specialism or SIC prefix');
select is(
  (select jsonb_array_length(public.map_sites(-4.70, 51.17, -4.65, 51.19, 12, '{"has_taken_tlevel":true}') -> 'features')),
  1, 'has_taken_tlevel filter');
select is(
  (select jsonb_array_length(public.map_sites(-4.70, 51.17, -4.65, 51.19, 12, '{"data_sources":["verified"]}') -> 'features')),
  1, 'data_sources filter');
select is(
  (select (f -> 'properties' ->> 'count')::int
   from jsonb_array_elements(public.map_sites(-4.80, 51.10, -4.60, 51.25, 6, '{}') -> 'features') f
   where (f -> 'geometry' -> 'coordinates' ->> 0)::float between -4.7 and -4.6),
  3, 'zoomed out: the three sites form one cluster of 3 companies');
select is(
  (select (public.map_sites(-4.70, 51.17, -4.65, 51.19, 12, '{}') ->> 'clustered')::boolean),
  false, 'zoom 12 is not clustered');

select is(
  (select count(*)::int from public.region_counts() where region = 'south_west' and county is null),
  1, 'one region-total row even when sites have no county');
select ok(
  (select companies >= 3 from public.region_counts() where region = 'south_west' and county is null),
  'region total includes sites with no county');

select is(
  (select public.company_detail('70000000-0000-0000-0000-00000000000a') ->> 'name'),
  'Fixture Seven Verified', 'company_detail works for anon');

select * from finish();
rollback;
