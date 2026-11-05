-- 0014 rank_companies performance
--
-- Live on 04/11/2026 the search page hit the anon statement_timeout (3 s) in
-- rank_companies. Locally (full data, warm cache) the same calls took
-- 0.9 s with no postcode and 3.0 s with "show employers further away";
-- Supabase's compute is roughly twice as slow. Results are unchanged:
-- same rows, same order, same reasons (checked against the 0009 version).
--
-- What changed:
-- 1. companies.sic_prefix_set: a stored generated column with every 2-5
--    character prefix of each SIC code, so the route SIC match is one array
--    overlap instead of a nested unnest/LIKE per company.
-- 2. Scoring in float8, not numeric. Numeric arithmetic over ~93k rows was
--    most of the remaining time. Outputs are still rounded numerics.
-- 3. candidates carries only the columns the score needs (it was c.*,
--    including the search tsvector).
-- 4. The total for the pager is a count over candidates, not a
--    count(*) over () window that buffered every scored row.
-- 5. Distances use the sphere (use_spheroid => false): under 0.5% different,
--    several times cheaper, and it matters when every site is measured.
-- 6. The name tie-break uses name_normalised with the "C" collation. Most
--    imported rows tie on score, so the locale-aware comparison ran ~93k times.
--
-- Local timings after (min of 5): 0.25-0.36 s without a postcode, ~50 ms
-- with a postcode and radius, ~0.9 s with "further away".

create or replace function public.sic_prefix_set(p_codes text[])
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(array_agg(distinct left(code, n) order by left(code, n)), '{}')
  from unnest(p_codes) code, generate_series(2, 5) n
  where length(code) >= n
$$;

comment on function public.sic_prefix_set(text[]) is
  'Every 2-5 character prefix of each SIC code, e.g. {26110} -> {26,261,2611,26110}. Feeds companies.sic_prefix_set.';

alter table public.companies
  add column sic_prefix_set text[] generated always as (public.sic_prefix_set(sic_codes)) stored;

create or replace function public.rank_companies(
  p_profile jsonb default '{}'::jsonb,
  p_filters jsonb default '{}'::jsonb
)
returns setof public.ranked_company
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Student
  v_route_id text := nullif(p_profile ->> 'route_id', '');
  v_specialism text := nullif(p_profile ->> 'specialism', '');
  v_origin geography;
  v_max_km float8 := least(greatest(coalesce((p_profile ->> 'max_travel_km')::float8, 25), 1), 200);
  v_pattern placement_pattern := nullif(p_profile ->> 'placement_pattern', '')::placement_pattern;
  v_targets uuid[];
  -- float8 throughout the scoring: numeric arithmetic over ~93k rows was
  -- most of the run time.
  v_w_r float8; v_w_s float8; v_w_p float8; v_w_b float8; v_w_sum float8;
  v_route_specs text[] := '{}';
  v_route_sics text[] := '{}';
  -- Filters
  v_q text := nullif(trim(p_filters ->> 'q'), '');
  v_tsq tsquery;
  v_f_route_specs text[];
  v_f_specialism text := nullif(p_filters ->> 'specialism', '');
  v_f_region england_region := nullif(p_filters ->> 'region', '')::england_region;
  v_f_county text := nullif(p_filters ->> 'county', '');
  v_f_sectors text[];
  v_f_sizes size_band[];
  v_f_taken boolean := coalesce((p_filters ->> 'has_taken_tlevel')::boolean, false);
  v_f_onward boolean := coalesce((p_filters ->> 'has_route_onward')::boolean, false);
  v_f_sources data_source[];
  v_f_outside boolean := coalesce((p_filters ->> 'include_outside_radius')::boolean, false);
  v_limit int := least(greatest(coalesce((p_filters ->> 'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p_filters ->> 'offset')::int, 0), 0);
begin
  if (p_profile ->> 'lat') is not null and (p_profile ->> 'lng') is not null then
    v_origin := st_setsrid(st_makepoint((p_profile ->> 'lng')::float8, (p_profile ->> 'lat')::float8), 4326)::geography;
  end if;

  v_targets := coalesce(array(
    select x::uuid from jsonb_array_elements_text(coalesce(p_profile -> 'target_company_ids', '[]')) x
  ), '{}');

  v_w_r := greatest(coalesce((p_profile -> 'weights' ->> 'route_onward')::float8, 30), 0);
  v_w_s := greatest(coalesce((p_profile -> 'weights' ->> 'specialism_fit')::float8, 25), 0);
  v_w_p := greatest(coalesce((p_profile -> 'weights' ->> 'practicalities')::float8, 25), 0);
  v_w_b := greatest(coalesce((p_profile -> 'weights' ->> 'brand')::float8, 20), 0);
  if v_w_r + v_w_s + v_w_p + v_w_b = 0 then
    v_w_r := 30; v_w_s := 25; v_w_p := 25; v_w_b := 20;
  end if;
  v_w_sum := v_w_r + v_w_s + v_w_p + v_w_b;

  select r.occupational_specialisms, r.sic_prefixes into v_route_specs, v_route_sics
  from tlevel_routes r where r.id = coalesce(v_route_id, nullif(p_filters ->> 'route_id', ''));
  v_route_specs := coalesce(v_route_specs, '{}');
  v_route_sics := coalesce(v_route_sics, '{}');

  if nullif(p_filters ->> 'route_id', '') is not null then
    select r.occupational_specialisms into v_f_route_specs
    from tlevel_routes r where r.id = p_filters ->> 'route_id';
    v_f_route_specs := coalesce(v_f_route_specs, '{}');
  end if;

  if v_q is not null then
    v_tsq := websearch_to_tsquery('english', v_q);
  end if;
  if jsonb_typeof(p_filters -> 'sectors') = 'array' then
    v_f_sectors := array(select jsonb_array_elements_text(p_filters -> 'sectors'));
  end if;
  if jsonb_typeof(p_filters -> 'size_bands') = 'array' then
    v_f_sizes := array(select jsonb_array_elements_text(p_filters -> 'size_bands'))::size_band[];
  end if;
  if jsonb_typeof(p_filters -> 'data_sources') = 'array' then
    v_f_sources := array(select jsonb_array_elements_text(p_filters -> 'data_sources'))::data_source[];
  end if;

  return query
  with near as (
    -- Nearest site per company. Sphere, not spheroid, distances (under 0.5%
    -- different, several times cheaper). With a radius the GiST index on
    -- sites does the cut first.
    select distinct on (d.company_id) d.company_id, d.site_id, d.km
    from (
      select s.company_id, s.id as site_id,
             st_distance(s.location, v_origin, false) / 1000.0 as km
      from company_sites s
      where v_origin is not null
        and (v_f_outside or st_dwithin(s.location, v_origin, v_max_km * 1000, false))
    ) d
    order by d.company_id, d.km
  ),
  in_area as (
    -- Region/county filter as one set, joined below. The old per-company
    -- EXISTS sat inside an OR and was re-run for every company (~2.7 s).
    select distinct s.company_id
    from company_sites s
    where (v_f_region is not null or v_f_county is not null)
      and (v_f_region is null or s.region = v_f_region)
      and (v_f_county is null or s.county ilike v_f_county)
  ),
  live as (
    select vac.company_id, count(*)::int as n
    from vacancies vac
    where vac.closing_date is null or vac.closing_date >= current_date
    group by vac.company_id
  ),
  candidates as (
    -- Narrow rows only: everything after this sorts and windows over up to
    -- ~93k rows, and carrying c.* (tsvector, long text) was the main cost.
    select c.id, c.name, c.name_normalised, c.specialisms, c.sic_prefix_set, c.routes_onward, c.takes_tlevel,
           c.placement_patterns, c.accepts_under_18, c.size_band, c.early_careers_programme,
           cardinality(c.trade_bodies) > 0 as has_trade_body, c.data_source, c.verified_at,
           n.site_id as nearest_site_id, n.km as distance_km, coalesce(l.n, 0) as live_vacancies
    from companies c
    left join near n on n.company_id = c.id
    left join live l on l.company_id = c.id
    left join in_area a on a.company_id = c.id
    where c.status = 'active'                                   -- hard filter
      and (v_origin is null or v_f_outside or n.company_id is not null) -- radius
      and (v_q is null or c.search @@ v_tsq or c.name ilike '%' || v_q || '%')
      and (v_f_specialism is null or c.specialisms @> array[v_f_specialism])
      and (v_f_route_specs is null or c.specialisms && v_f_route_specs)
      and (v_f_region is null and v_f_county is null or a.company_id is not null)
      and (v_f_sectors is null or c.sectors && v_f_sectors)
      and (v_f_sizes is null or c.size_band = any (v_f_sizes))
      and (not v_f_taken or c.takes_tlevel = 'yes')
      and (not v_f_onward or cardinality(c.routes_onward) > 0)
      and (v_f_sources is null or c.data_source = any (v_f_sources))
  ),
  signals as (
    select
      c.*,
      -- R: route onward
      case
        when 'apprenticeship' = any (c.routes_onward)
          and (v_specialism is null or c.specialisms @> array[v_specialism]) then 1.0::float8
        when 'apprenticeship' = any (c.routes_onward) then 0.5::float8
        else 0.0::float8
      end as r_apprenticeship,
      case when c.routes_onward && array['degree_apprenticeship', 'sponsored_degree']::route_onward[]
        then 1.0::float8 else 0.0::float8 end as r_degree,
      case when 'tlevel_kept_on' = any (c.routes_onward) then 1.0::float8 else 0.0::float8 end as r_kept_on,
      case when c.live_vacancies > 0 then 1.0::float8 else 0.0::float8 end as r_vacancies,
      -- S: specialism fit
      case
        when v_specialism is null and v_route_id is null then 0.5::float8
        when v_specialism is not null and c.specialisms @> array[v_specialism] then 1.0::float8
        when c.specialisms && v_route_specs then 0.6::float8
        when cardinality(c.specialisms) = 0 then 0.3::float8
        else 0.0::float8
      end as s_tagged,
      case
        when v_route_id is null then 0.5::float8
        when cardinality(c.sic_prefix_set) = 0 then 0.3::float8
        -- sic_prefix_set holds every 2-5 character prefix of each SIC code,
        -- so a route prefix match is one array overlap.
        when c.sic_prefix_set && v_route_sics then 1.0::float8
        else 0.0::float8
      end as s_sic,
      -- P: practicalities
      case
        when v_origin is null then 0.5::float8
        when c.distance_km is null then 0.0::float8
        when c.distance_km <= v_max_km then 1.0::float8 - 0.4::float8 * (c.distance_km / v_max_km)
        else 0.6::float8 * exp(-((c.distance_km - v_max_km) / v_max_km))
      end as p_distance,
      case c.takes_tlevel when 'yes' then 1.0::float8 when 'unknown' then 0.3::float8 else 0.0::float8 end as p_tlevel,
      case
        when v_pattern is null then 0.5::float8
        when cardinality(c.placement_patterns) = 0 then 0.3::float8
        when v_pattern = any (c.placement_patterns) then 1.0::float8
        else 0.0::float8
      end as p_pattern,
      case c.accepts_under_18 when 'yes' then 1.0::float8 when 'unknown' then 0.3::float8 else 0.0::float8 end as p_under_18,
      -- B: brand
      case c.size_band
        when 'large' then 1.0::float8 when 'medium' then 0.7::float8 when 'small' then 0.4::float8
        when 'micro' then 0.2::float8 else 0.3::float8
      end as b_size,
      case when c.early_careers_programme then 1.0::float8 else 0.0::float8 end as b_early_careers,
      case when c.has_trade_body then 1.0::float8 else 0.0::float8 end as b_trade_body,
      c.id = any (v_targets) as is_target,
      -- C: confidence
      case
        when c.data_source = 'verified' then 1.0::float8
        when c.data_source = 'imported' and c.live_vacancies > 0 then 0.85::float8
        when c.data_source = 'imported' then 0.7::float8
        else 0.6::float8
      end as conf
    from candidates c
  ),
  scored as (
    select
      f.*,
      100.0::float8 * (v_w_r * f.f_r + v_w_s * f.f_s + v_w_p * f.f_p + v_w_b * f.f_b) / v_w_sum * f.conf as raw_score
    from (
      select
        s.*,
        (s.r_apprenticeship + s.r_degree + s.r_kept_on + s.r_vacancies) / 4.0::float8 as f_r,
        (s.s_tagged + s.s_sic) / 2.0::float8 as f_s,
        (s.p_distance + s.p_tlevel + s.p_pattern + s.p_under_18) / 4.0::float8 as f_p,
        case when s.is_target then 1.0::float8
          else (s.b_size + s.b_early_careers + s.b_trade_body) / 3.0::float8 end as f_b
      from signals s
    ) f
  ),
  -- Total for the pager. A count(*) over () window here made Postgres buffer
  -- every scored row (all signal columns, ~93k rows) before the top-N sort.
  total as (
    select count(*) as n from candidates
  ),
  page as (
    select * from scored
    -- Most rows tie on score, so the name tie-break runs ~93k times: compare
    -- the normalised name bytewise rather than through the locale.
    order by raw_score desc, distance_km asc nulls last, name_normalised collate "C", id
    limit v_limit offset v_offset
  )
  select
    pg.id,
    pg.name,
    round(pg.raw_score::numeric, 1),
    round(pg.f_r::numeric, 3),
    round(pg.f_s::numeric, 3),
    round(pg.f_p::numeric, 3),
    round(pg.f_b::numeric, 3),
    pg.conf::numeric,
    round(pg.distance_km::numeric, 1),
    pg.nearest_site_id,
    pg.live_vacancies,
    -- Plain-English "why": each positive signal's weighted contribution, top three.
    array(
      select txt from (
        values
          -- We record that a company runs apprenticeships, not which ones, so
          -- the reason never claims one is in the student's specialism.
          (v_w_r * pg.r_apprenticeship / 4, case when pg.r_apprenticeship > 0
             then 'Runs apprenticeships' end),
          (v_w_r * pg.r_degree / 4, case when pg.r_degree > 0
             then 'Offers a degree apprenticeship or sponsored degree' end),
          (v_w_r * pg.r_kept_on / 4, case when pg.r_kept_on > 0
             then 'Has kept T Level students on afterwards' end),
          (v_w_r * pg.r_vacancies / 4, case when pg.live_vacancies > 0
             then format('%s live apprenticeship %s', pg.live_vacancies,
                         case when pg.live_vacancies = 1 then 'vacancy' else 'vacancies' end) end),
          (v_w_s * pg.s_tagged / 2, case when pg.s_tagged = 1.0 and v_specialism is not null
             then 'Matches your specialism' end),
          (v_w_p * pg.p_distance / 4, case when v_origin is not null and pg.distance_km is not null
             then case when pg.distance_km * 0.621371 < 1 then 'Less than a mile away'
                       when round(pg.distance_km * 0.621371) = 1 then 'About a mile away'
                       else format('%s miles away', round(pg.distance_km * 0.621371)) end end),
          (v_w_p * pg.p_tlevel / 4, case when pg.takes_tlevel = 'yes'
             then 'Has taken T Level students before' end),
          (v_w_p * pg.p_pattern / 4, case when pg.p_pattern = 1.0
             then 'Offers ' || replace(v_pattern::text, '_', ' ') || ' placements' end),
          (v_w_b * 1.0, case when pg.is_target then 'One of your target companies' end),
          (v_w_b * pg.b_early_careers / 3, case when pg.early_careers_programme
             then 'Runs an early-careers programme' end)
      ) as r(contrib, txt)
      where txt is not null and contrib > 0
      order by contrib desc
      limit 3
    ),
    pg.data_source,
    pg.verified_at,
    (select t.n from total t)
  from page pg
  order by pg.raw_score desc, pg.distance_km asc nulls last, pg.name_normalised collate "C", pg.id;
end;
$$;

comment on function public.rank_companies(jsonb, jsonb) is
  'Ranks active companies 0-100 for a student profile (signed in or not). See spec "Ranking model". '
  'SECURITY DEFINER for spatial index use under RLS; returns only status = active companies.';

revoke execute on function public.rank_companies(jsonb, jsonb) from public;
grant execute on function public.rank_companies(jsonb, jsonb) to anon, authenticated;

-- Safety net: anonymous requests get 8 s instead of Supabase's default 3 s.
-- The rewrite above should keep normal searches well under 3 s; this covers
-- a cold cache or "show employers further away" across all of England.
-- Supabase documents this setting (Database > Timeouts). Wrapped so the
-- migration still applies if the role can't be altered.
do $$
begin
  execute 'alter role anon set statement_timeout = ''8s''';
exception when insufficient_privilege then
  raise notice 'could not raise anon statement_timeout: %', sqlerrm;
end
$$;
notify pgrst, 'reload config';
