-- pgTAP tests: stored static signals and narrow scoring (migration 0016).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.companies (id, name, data_source, verified_at, routes_onward, takes_tlevel, tlevel_evidence_url,
                              accepts_under_18, size_band, early_careers_programme, trade_bodies, specialisms) values
  ('a0000000-0000-0000-0000-00000000000a', 'Fixture Ten Full', 'verified', now(),
   array['apprenticeship', 'tlevel_kept_on']::route_onward[], 'yes', 'https://example.org/e', 'yes', 'large', true,
   array['Make UK'], array['dd_mechanical']),
  ('a0000000-0000-0000-0000-00000000000b', 'Fixture Ten Bare', 'imported', null, '{}', 'unknown', null, 'unknown',
   'unknown', false, '{}', '{}');

select is((select array[rank_r_static, rank_p_static, rank_b_static] from public.companies
            where id = 'a0000000-0000-0000-0000-00000000000a'),
  array[1.0, 2.0, 1.0]::float8[], 'static signals for a fully evidenced company');
select is((select array[rank_r_static, rank_p_static, rank_b_static] from public.companies
            where id = 'a0000000-0000-0000-0000-00000000000b'),
  array[0.0, 0.6, (0.3::float8 + 0 + 0) / 3]::float8[], 'static signals for a bare import');
select ok((select rank_has_apprenticeship from public.companies where id = 'a0000000-0000-0000-0000-00000000000a'),
  'apprenticeship flag');

set local role anon;

-- The score from the narrow ranking pass must equal the breakdown shown on
-- the page: 100 * (30 R + 25 S + 25 P + 20 B) / 100 * confidence, allowing
-- for the components being rounded to 3 dp.
select is(
  (select count(*)::int from public.rank_companies(
     '{"route_id":"design_development","specialism":"dd_mechanical","weights":{"route_onward":30,"specialism_fit":25,"practicalities":25,"brand":20}}',
     '{"limit":200}') r
   where abs(r.score - (30 * r.route_onward + 25 * r.specialism_fit + 25 * r.practicalities + 20 * r.brand) * r.confidence) > 0.15),
  0, 'every score equals its weighted components');
select ok(
  (select array_agg(name order by score desc) from public.rank_companies('{"specialism":"dd_mechanical"}', '{"q":"Fixture Ten"}'))
    = array['Fixture Ten Full', 'Fixture Ten Bare'],
  'the evidenced company ranks first');

select * from finish();
rollback;
