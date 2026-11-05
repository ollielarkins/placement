-- pgTAP tests: RLS, moderation guards and rank_companies().
-- Run with: supabase test db
-- All fixtures are fictional and rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'student1@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'student2@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'student3@example.test'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.test');

insert into public.tlevel_routes (id, name, occupational_specialisms, specialism_labels, sic_prefixes) values
  ('fixture_route', 'Fixture Route', array['fixture_eee', 'fixture_mech'],
   '{"fixture_eee":"Fixture EEE","fixture_mech":"Fixture Mech"}', array['26', '27']),
  ('other_route', 'Other Route', array['other_spec'], '{"other_spec":"Other"}', array['41']);

-- Origin for anonymous ranking: 52.00, -0.50.
insert into public.companies (id, name, ch_number, website, sic_codes, size_band, specialisms,
  takes_tlevel, tlevel_evidence_url, routes_onward, placement_patterns, accepts_under_18,
  early_careers_programme, data_source, verified_at, status, sectors) values
  ('10000000-0000-0000-0000-00000000000a', 'Fixture Alpha Ltd', 'FX000001', 'https://www.alpha.example',
   array['27110'], 'large', array['fixture_eee'], 'yes', 'https://alpha.example/tlevels',
   array['apprenticeship', 'tlevel_kept_on']::route_onward[], array['block']::placement_pattern[], 'yes',
   true, 'verified', now(), 'active', array['electronics']),
  ('10000000-0000-0000-0000-00000000000b', 'Fixture Beta', 'FX000002', null,
   array['28290'], 'medium', '{}', 'unknown', null, '{}', '{}', 'unknown',
   false, 'imported', null, 'active', array['manufacturing']),
  ('10000000-0000-0000-0000-00000000000c', 'Fixture Gamma', null, null,
   '{}', 'unknown', '{}', 'unknown', null, '{}', '{}', 'unknown',
   false, 'student_submitted', null, 'active', '{}'),
  ('10000000-0000-0000-0000-00000000000d', 'Fixture Dissolved', 'FX000004', null,
   array['27110'], 'large', array['fixture_eee'], 'unknown', null, '{}', '{}', 'unknown',
   false, 'imported', null, 'dissolved', '{}'),
  ('10000000-0000-0000-0000-00000000000e', 'Fixture Hidden', 'FX000005', null,
   array['27110'], 'large', array['fixture_eee'], 'unknown', null, '{}', '{}', 'unknown',
   false, 'imported', null, 'hidden', '{}');

insert into public.company_sites (company_id, label, region, county, location) values
  ('10000000-0000-0000-0000-00000000000a', 'Alpha HQ', 'east_of_england', 'Bedfordshire',
   st_setsrid(st_makepoint(-0.45, 52.05), 4326)::geography),            -- ~6.6 km
  ('10000000-0000-0000-0000-00000000000b', 'Beta works', 'east_midlands', 'Northamptonshire',
   st_setsrid(st_makepoint(-0.50, 52.30), 4326)::geography),            -- ~33 km
  ('10000000-0000-0000-0000-00000000000c', 'Gamma unit', 'london', 'Greater London',
   st_setsrid(st_makepoint(-0.50, 51.00), 4326)::geography),            -- ~111 km
  ('10000000-0000-0000-0000-00000000000d', 'Dissolved site', 'east_of_england', 'Bedfordshire',
   st_setsrid(st_makepoint(-0.50, 52.01), 4326)::geography),
  ('10000000-0000-0000-0000-00000000000e', 'Hidden site', 'east_of_england', 'Bedfordshire',
   st_setsrid(st_makepoint(-0.50, 52.01), 4326)::geography);

insert into public.vacancies (company_id, external_ref, title, closing_date) values
  ('10000000-0000-0000-0000-00000000000b', 'FIXTURE-VAC-1', 'Fixture apprentice', current_date + 30),
  ('10000000-0000-0000-0000-00000000000b', 'FIXTURE-VAC-2', 'Closed fixture apprentice', current_date - 1);

-- ---------------------------------------------------------------------------
-- Anonymous visitor
-- ---------------------------------------------------------------------------
set local role anon;
select is((select count(*) from public.companies)::int, 4, 'anon reads companies, not hidden ones');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.reviews', '42501', null, 'anon cannot read the reviews table');
select lives_ok('select * from public.reviews_public', 'anon can read reviews_public');
select throws_ok($$insert into public.companies (name, data_source) values ('X', 'imported')$$,
  '42501', null, 'anon cannot write companies');

-- Ranking without sign-in: postcode centroid only, 25 km radius.
select results_eq(
  $$select company_id from public.rank_companies('{"lat":52.0,"lng":-0.5,"max_travel_km":25}')$$,
  $$values ('10000000-0000-0000-0000-00000000000a'::uuid)$$,
  'radius filter keeps only Alpha; dissolved and hidden never appear');

select results_eq(
  $$select company_id from public.rank_companies('{"lat":52.0,"lng":-0.5,"max_travel_km":25}',
                                                 '{"include_outside_radius":true}')$$,
  $$values ('10000000-0000-0000-0000-00000000000a'::uuid),
           ('10000000-0000-0000-0000-00000000000b'::uuid),
           ('10000000-0000-0000-0000-00000000000c'::uuid)$$,
  'outside radius on request, best first');

select is(
  (select confidence from public.rank_companies('{}', '{"include_outside_radius":true}')
   where company_id = '10000000-0000-0000-0000-00000000000b'),
  0.85, 'imported with a live vacancy gets confidence 0.85');

select is(
  (select live_vacancies from public.rank_companies('{}')
   where company_id = '10000000-0000-0000-0000-00000000000b'),
  1, 'closed vacancies are not counted');

select ok(
  (select reasons[1] = 'Matches your specialism'
   from public.rank_companies('{"lat":52.0,"lng":-0.5,"specialism":"fixture_eee","route_id":"fixture_route"}')
   where company_id = '10000000-0000-0000-0000-00000000000a'),
  'reasons lead with the biggest contribution');

select ok(
  (select cardinality(reasons) between 1 and 3 from public.rank_companies('{"lat":52.0,"lng":-0.5}') limit 1),
  'at most three reasons');

select ok(
  (select bool_and(score between 0 and 100) from public.rank_companies('{}')),
  'scores are within 0 to 100');

select lives_ok(
  $$select * from public.rank_companies('{"weights":{"route_onward":0,"specialism_fit":0,"practicalities":0,"brand":0}}')$$,
  'zero weights fall back to defaults instead of dividing by zero');

select is(
  (select count(*)::int from public.rank_companies('{}', '{"q":"alpha"}')),
  1, 'full-text search');

select is(
  (select count(*)::int from public.rank_companies('{}', '{"region":"east_midlands"}')),
  1, 'region filter');

select ok(
  (select a.score > b.score
   from public.rank_companies('{"weights":{"route_onward":100,"specialism_fit":0,"practicalities":0,"brand":0}}') a,
        public.rank_companies('{"weights":{"route_onward":100,"specialism_fit":0,"practicalities":0,"brand":0}}') b
   where a.company_id = '10000000-0000-0000-0000-00000000000a'
     and b.company_id = '10000000-0000-0000-0000-00000000000b'),
  'route-onward weighting favours the company with an apprenticeship route');

-- ---------------------------------------------------------------------------
-- Student 1
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$insert into public.profiles (user_id, home_outcode) values ('00000000-0000-0000-0000-0000000000a1', 'MK45 1AB')$$,
  '23514', null, 'full postcodes are rejected; outward code only');

select throws_ok(
  $$insert into public.profiles (user_id, route_id, specialism)
    values ('00000000-0000-0000-0000-0000000000a1', 'fixture_route', 'other_spec')$$,
  '23514', null, 'specialism must belong to the route');

select lives_ok(
  $$insert into public.profiles (user_id, route_id, specialism, home_outcode, home_location, max_travel_km, placement_pattern)
    values ('00000000-0000-0000-0000-0000000000a1', 'fixture_route', 'fixture_eee', 'MK45',
            st_setsrid(st_makepoint(-0.5, 52.0), 4326)::geography, 25, 'block')$$,
  'student creates own profile');

select is(
  (select company_id from public.rank_companies_for_me() limit 1),
  '10000000-0000-0000-0000-00000000000a'::uuid, 'rank_companies_for_me uses the saved profile');

insert into public.tracker_items (id, company_id)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into public.reviews (company_id, tracker_item_id, ratings, body)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001',
            '{"overall":5,"learning":5,"support":4,"route_onward":4}', 'A long enough review body for the check.')$$,
  '42501', null, 'no review until the placement is Secured');

update public.tracker_items set stage = 'secured' where id = '20000000-0000-0000-0000-000000000001';

select throws_ok(
  $$insert into public.reviews (company_id, tracker_item_id, ratings, body, status)
    values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001',
            '{"overall":5,"learning":5,"support":4,"route_onward":4}', 'A long enough review body for the check.', 'published')$$,
  '42501', null, 'students cannot set review status');

insert into public.reviews (company_id, tracker_item_id, ratings, body)
values ('10000000-0000-0000-0000-00000000000a',
        '20000000-0000-0000-0000-000000000001',
        '{"overall":5,"learning":5,"support":4,"route_onward":4}', 'A long enough review body for the check.');
select isnt(set_config('fixture.review_id',
  (select id::text from public.reviews where tracker_item_id = '20000000-0000-0000-0000-000000000001'), true),
  null, 'student creates a review for a secured placement');

select is((select status::text from public.reviews where id = current_setting('fixture.review_id')::uuid),
  'pending', 'new reviews start pending');

-- Student 2 sees none of student 1's data.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select count(*)::int from public.profiles) + (select count(*)::int from public.tracker_items)
    + (select count(*)::int from public.reviews),
  0, 'another student sees no profile, tracker or review rows');

-- ---------------------------------------------------------------------------
-- Moderation edge function (service role)
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok(
  $$update public.reviews set status = 'published',
      moderation = '{"verdict":"publish","uncertain":false,"checks":{"personal_data":false,"names_individual":true,"abuse":false,"safeguarding":false,"serious_claim":false,"spam":false,"not_real_placement":false}}'
    where id = current_setting('fixture.review_id')::uuid$$,
  '42501', null, 'a review naming an individual cannot be auto-published');

update public.reviews set status = 'published',
  moderation = '{"verdict":"publish","uncertain":false,"checks":{"personal_data":false,"names_individual":false,"abuse":false,"safeguarding":false,"serious_claim":false,"spam":false,"not_real_placement":false}}'
where id = current_setting('fixture.review_id')::uuid;

reset role;
set local role anon;
select is((select count(*)::int from public.reviews_public), 1, 'clean review is public');
select hasnt_column('public', 'reviews_public', 'user_id', 'public view never exposes user_id');

-- ---------------------------------------------------------------------------
-- Three reports hide it
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
insert into public.reports (target_type, target_id, reason) values ('review', current_setting('fixture.review_id')::uuid, 'r1');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
insert into public.reports (target_type, target_id, reason) values ('review', current_setting('fixture.review_id')::uuid, 'r2');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
insert into public.reports (target_type, target_id, reason) values ('review', current_setting('fixture.review_id')::uuid, 'r3');

reset role;
select is((select status::text from public.reviews where id = current_setting('fixture.review_id')::uuid),
  'held', 'three reports hold the review for an admin');

-- Safeguarding flag forces held even if publish is requested.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
update public.reviews set status = 'published',
  moderation = '{"verdict":"safeguarding","uncertain":false,"checks":{"personal_data":false,"names_individual":false,"abuse":false,"safeguarding":true,"serious_claim":false,"spam":false,"not_real_placement":false}}'
where id = current_setting('fixture.review_id')::uuid;
reset role;
select is((select status::text from public.reviews where id = current_setting('fixture.review_id')::uuid),
  'held', 'safeguarding flags are never auto-published');

-- ---------------------------------------------------------------------------
-- Admin writes are audited
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ad","app_metadata":{"role":"admin"}}';
update public.companies set summary = 'Checked by admin' where id = '10000000-0000-0000-0000-00000000000b';
select is(
  (select count(*)::int from public.admin_audit_log where table_name = 'companies' and action = 'update'),
  1, 'admin edits are logged');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
update public.companies set summary = 'Student edit' where id = '10000000-0000-0000-0000-00000000000b';
reset role;
select is((select summary from public.companies where id = '10000000-0000-0000-0000-00000000000b'),
  'Checked by admin', 'students cannot edit companies');

reset role;
select is((select count(*)::int from public.tlevel_routes
           where id in ('design_development','maintenance_installation_repair','manufacturing_processing_control')),
  3, 'three Engineering routes are loaded');
select is((select sum(cardinality(occupational_specialisms))::int from public.tlevel_routes
           where id not like '%fixture%' and id <> 'other_route'),
  13, 'thirteen official specialisms');
select throws_ok($$insert into public.tlevel_routes (id, name, occupational_specialisms) values ('x', 'X', array['a'])$$,
  '23514', null, 'every specialism needs a label');
select * from finish();
rollback;
