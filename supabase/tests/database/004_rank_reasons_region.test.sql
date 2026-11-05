-- pgTAP tests: rank_companies() reasons wording and region/county filter (migration 0009).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.tlevel_routes (id, name, occupational_specialisms, specialism_labels, sic_prefixes) values
  ('fx_route', 'Fixture Route 4', array['fx_eee'], '{"fx_eee":"Fixture EEE"}', array['26']);

insert into public.companies (id, name, specialisms, routes_onward, data_source, verified_at) values
  ('40000000-0000-0000-0000-00000000000a', 'Fixture North Apprenticeships', array['fx_eee'],
   array['apprenticeship']::route_onward[], 'verified', now()),
  ('40000000-0000-0000-0000-00000000000b', 'Fixture South Works', '{}', '{}', 'imported', null);
insert into public.company_sites (company_id, kind, postcode, region, county, location) values
  ('40000000-0000-0000-0000-00000000000a', 'operating_site', 'NE1 1AA', 'north_east', 'Tyne and Wear',
   extensions.st_setsrid(extensions.st_makepoint(-1.61, 54.97), 4326)::extensions.geography),
  ('40000000-0000-0000-0000-00000000000a', 'registered_office', 'SW1A 1AA', 'london', null,
   extensions.st_setsrid(extensions.st_makepoint(-0.14, 51.50), 4326)::extensions.geography),
  ('40000000-0000-0000-0000-00000000000b', 'operating_site', 'BN1 1AA', 'south_east', 'East Sussex',
   extensions.st_setsrid(extensions.st_makepoint(-0.14, 50.82), 4326)::extensions.geography);

set local role anon;

select ok(
  (select 'Runs apprenticeships' = any (reasons) from public.rank_companies(
     '{"route_id":"fx_route","specialism":"fx_eee"}', '{"q":"Fixture North Apprenticeships"}') limit 1),
  'apprenticeship reason makes no specialism claim');
select ok(
  not exists (select 1 from public.rank_companies('{"route_id":"fx_route","specialism":"fx_eee"}', '{"limit":200}') r,
              unnest(r.reasons) t where t ilike '%apprenticeship in your%'),
  'no reason says "apprenticeship in your specialism"');
select ok(
  (select 'Matches your specialism' = any (reasons) from public.rank_companies(
     '{"route_id":"fx_route","specialism":"fx_eee"}', '{"q":"Fixture North Apprenticeships"}') limit 1),
  'specialism match is still its own reason');

select is((select array_agg(name order by name) from public.rank_companies('{}', '{"region":"north_east","q":"Fixture"}')),
  array['Fixture North Apprenticeships'], 'region filter keeps companies with a site in the region');
select is((select array_agg(name order by name) from public.rank_companies('{}', '{"region":"london","q":"Fixture"}')),
  array['Fixture North Apprenticeships'], 'any site counts, including the registered office');
select is((select array_agg(name order by name) from public.rank_companies('{}', '{"county":"east sussex","q":"Fixture"}')),
  array['Fixture South Works'], 'county filter is case-insensitive');

select * from finish();
rollback;
