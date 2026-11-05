-- rank_companies(): run with definer rights.
--
-- Found with the first real Companies House load (92,634 companies): as anon
-- the function took ~3.8 s against ~80 ms as postgres. The company_sites read
-- policy is an EXISTS on companies, and PostGIS's && / ST_DWithin aren't
-- LEAKPROOF, so under RLS Postgres must check the policy on every site before
-- it may use the spatial index: a scan of all 92k sites per search.
--
-- Running as the owner is safe here because the function already enforces
-- everything the read policies do, and more:
--   * it only ever returns companies with status = 'active' (hidden,
--     dissolved and not-taking-placements are hard-filtered);
--   * it reads only public reference data (companies, company_sites,
--     vacancies, tlevel_routes), never profiles or other student data;
--     the caller's profile arrives as an argument (rank_companies_for_me
--     stays security invoker, so RLS still scopes the profile it reads).
-- pg_temp goes last on the search_path so a caller can't shadow anything.

alter function public.rank_companies(jsonb, jsonb)
  security definer
  set search_path = public, extensions, pg_temp;

comment on function public.rank_companies(jsonb, jsonb) is
  'Ranks active companies 0-100 for a student profile (signed in or not). See spec "Ranking model". '
  'SECURITY DEFINER for spatial index use under RLS; returns only status = active companies.';
