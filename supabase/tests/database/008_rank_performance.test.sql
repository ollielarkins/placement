-- pgTAP tests: rank_companies after the 0014 performance rewrite.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(public.sic_prefix_set(array['26110', '7112']),
  array['26', '261', '2611', '26110', '71', '711', '7112'], 'sic_prefix_set lists every 2-5 character prefix');
select is(public.sic_prefix_set('{}'), '{}'::text[], 'no codes, no prefixes');

insert into public.tlevel_routes (id, name, occupational_specialisms, specialism_labels, sic_prefixes) values
  ('fx_route8', 'Fixture Route 8', array['fx8_spec'], '{"fx8_spec":"Fixture"}', array['9912']);
insert into public.companies (id, name, sic_codes, data_source) values
  ('80000000-0000-0000-0000-00000000000a', 'Fixture Eight Match', array['99123'], 'imported'),
  ('80000000-0000-0000-0000-00000000000b', 'Fixture Eight Near Miss', array['99213'], 'imported'),
  ('80000000-0000-0000-0000-00000000000c', 'Fixture Eight No SIC', '{}', 'imported');

select is((select sic_prefix_set from public.companies where id = '80000000-0000-0000-0000-00000000000a'),
  array['99', '991', '9912', '99123'], 'generated column is filled');

set local role anon;

select is(
  (select array_agg(specialism_fit order by name) from public.rank_companies('{"route_id":"fx_route8"}', '{"q":"Fixture Eight","limit":10}')),
  -- s_sic 1.0 / 0.0 / 0.3 with s_tagged 0.3 (no specialisms), averaged
  array[0.650, 0.150, 0.300]::numeric[], 'route SIC prefix match, miss and unknown');
select is(
  (select max(total_count) from public.rank_companies('{}', '{"q":"Fixture Eight","limit":1}')),
  3::bigint, 'total_count counts every match, not just the page');
select is(
  (select array_agg(name order by score desc, name) from public.rank_companies('{}', '{"q":"Fixture Eight","limit":10}')),
  array['Fixture Eight Match', 'Fixture Eight Near Miss', 'Fixture Eight No SIC'], 'ties still order by name');

select * from finish();
rollback;
