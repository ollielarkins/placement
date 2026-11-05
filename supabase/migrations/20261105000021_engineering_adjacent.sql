-- 0021 Engineering-adjacent employers
--
-- Decided 05/11/2026: alongside core engineering companies, include
-- employers outside engineering that have engineering teams:
--   1. adjacent sectors from Companies House (data/sic-codes.csv, second
--      block: food and drink, chemicals and pharma, materials, metals,
--      medical devices, utilities, rail and air transport, telecoms, data
--      centres, facilities management, hospitals, test labs, equipment
--      repair), medium and large firms only for most of them;
--   2. any company (banks, tech, AI ...) when there is evidence of
--      engineering roles: an engineering apprenticeship advert (already
--      imported), curated research, or later a student suggestion.
-- Software-only roles suit the Digital T Level, so nothing is added just
-- for being "tech".
--
-- companies.engineering_tier ('core' | 'adjacent') is derived from the SIC
-- codes: core if any code is in the core engineering list, otherwise
-- adjacent. rank_companies returns it and takes a core_only filter;
-- company_detail returns it; reference_data lists the new sectors.

create or replace function public.engineering_tier(p_sic_codes text[])
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when public.sic_prefix_set(p_sic_codes)
         && array['25', '26', '27', '28', '29', '30', '33', '351', '7112', '7219']
    then 'core' else 'adjacent' end
$$;

comment on function public.engineering_tier(text[]) is
  'core = an engineering SIC code (the original filter); adjacent = everything else (adjacent sectors, or added on evidence).';

alter table public.companies
  add column engineering_tier text generated always as (public.engineering_tier(sic_codes)) stored;

create index companies_tier_idx on public.companies (engineering_tier) where engineering_tier = 'adjacent';

alter type public.ranked_company add attribute engineering_tier text;

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
  v_f_core_only boolean := coalesce((p_filters ->> 'core_only')::boolean, false);
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
    -- Only what the score needs. Signals that don't depend on the student are
    -- stored on companies (rank_*_static, migration 0016).
    select c.id, c.name_normalised, c.specialisms, c.sic_prefix_set, c.placement_patterns, c.data_source,
           c.rank_has_apprenticeship, c.rank_r_static, c.rank_p_static, c.rank_b_static,
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
      and (not v_f_core_only or c.engineering_tier = 'core')
      and (v_f_sources is null or c.data_source = any (v_f_sources))
  ),
  ranked as (
    -- The score for every candidate, as one narrow row each. The breakdown
    -- and reasons are worked out below for the page only. Keep the formulas
    -- in step with the signals CTE (pgTAP 010 checks they agree).
    select
      c.id, c.name_normalised, c.distance_km, c.nearest_site_id, c.live_vacancies,
      100.0::float8 * (
          v_w_r * ((case when c.rank_has_apprenticeship
                           and (v_specialism is null or c.specialisms @> array[v_specialism]) then 1.0::float8
                         when c.rank_has_apprenticeship then 0.5::float8 else 0.0::float8 end)
                   + c.rank_r_static
                   + (case when c.live_vacancies > 0 then 1.0::float8 else 0.0::float8 end)) / 4.0::float8
        + v_w_s * (case
                     when v_specialism is null and v_route_id is null then 0.5::float8
                     when v_specialism is not null and c.specialisms @> array[v_specialism] then 1.0::float8
                     when c.specialisms && v_route_specs then 0.6::float8
                     when cardinality(c.specialisms) = 0 then 0.3::float8
                     else 0.0::float8 end
                   + case
                     when v_route_id is null then 0.5::float8
                     when cardinality(c.sic_prefix_set) = 0 then 0.3::float8
                     when c.sic_prefix_set && v_route_sics then 1.0::float8
                     else 0.0::float8 end) / 2.0::float8
        + v_w_p * (case
                     when v_origin is null then 0.5::float8
                     when c.distance_km is null then 0.0::float8
                     when c.distance_km <= v_max_km then 1.0::float8 - 0.4::float8 * (c.distance_km / v_max_km)
                     else 0.6::float8 * exp(-((c.distance_km - v_max_km) / v_max_km)) end
                   + c.rank_p_static
                   + case
                     when v_pattern is null then 0.5::float8
                     when cardinality(c.placement_patterns) = 0 then 0.3::float8
                     when v_pattern = any (c.placement_patterns) then 1.0::float8
                     else 0.0::float8 end) / 4.0::float8
        + v_w_b * (case when c.id = any (v_targets) then 1.0::float8 else c.rank_b_static end)
      ) / v_w_sum * (case
        when c.data_source = 'verified' then 1.0::float8
        when c.data_source = 'imported' and c.live_vacancies > 0 then 0.85::float8
        when c.data_source = 'imported' then 0.7::float8
        else 0.6::float8 end) as raw_score,
      count(*) over () as total
    from candidates c
  ),
  page as (
    select * from ranked
    -- Most rows tie on score, so the name tie-break runs ~93k times: compare
    -- the normalised name bytewise rather than through the locale.
    order by raw_score desc, distance_km asc nulls last, name_normalised collate "C", id
    limit v_limit offset v_offset
  ),
  signals as (
    -- Full breakdown, for the page rows only.
    select
      c.id, c.name, c.name_normalised, c.routes_onward, c.takes_tlevel, c.early_careers_programme,
      c.data_source, c.verified_at, c.engineering_tier,
      p.distance_km, p.nearest_site_id, p.live_vacancies, p.raw_score, p.total,
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
      case when p.live_vacancies > 0 then 1.0::float8 else 0.0::float8 end as r_vacancies,
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
        when p.distance_km is null then 0.0::float8
        when p.distance_km <= v_max_km then 1.0::float8 - 0.4::float8 * (p.distance_km / v_max_km)
        else 0.6::float8 * exp(-((p.distance_km - v_max_km) / v_max_km))
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
      case when cardinality(c.trade_bodies) > 0 then 1.0::float8 else 0.0::float8 end as b_trade_body,
      c.id = any (v_targets) as is_target,
      -- C: confidence
      case
        when c.data_source = 'verified' then 1.0::float8
        when c.data_source = 'imported' and p.live_vacancies > 0 then 0.85::float8
        when c.data_source = 'imported' then 0.7::float8
        else 0.6::float8
      end as conf
    from page p
    join companies c on c.id = p.id
  ),
  scored as (
    select f.*
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
    pg.total,
    pg.engineering_tier
  from scored pg
  order by pg.raw_score desc, pg.distance_km asc nulls last, pg.name_normalised collate "C", pg.id;
end;
$$;

create or replace function public.company_detail(p_id uuid)
returns jsonb
language sql
stable
security invoker -- RLS on companies already hides hidden records
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'ch_number', c.ch_number,
    'website', c.website,
    'summary', c.summary,
    'size_band', c.size_band,
    'sectors', c.sectors,
    'keywords', c.keywords,
    'specialisms', c.specialisms,
    'takes_tlevel', c.takes_tlevel,
    'tlevel_evidence_url', c.tlevel_evidence_url,
    'routes_onward', c.routes_onward,
    'placement_patterns', c.placement_patterns,
    'accepts_under_18', c.accepts_under_18,
    'early_careers_programme', c.early_careers_programme,
    'trade_bodies', c.trade_bodies,
    'how_to_apply', c.how_to_apply,
    'data_source', c.data_source,
    'verified_at', c.verified_at,
    'status', c.status,
    'sic_codes', c.sic_codes,
    'engineering_tier', c.engineering_tier,
    'updated_at', c.updated_at,
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'label', s.label, 'postcode', s.postcode,
        'region', s.region, 'county', s.county,
        'lat', st_y(s.location::geometry), 'lng', st_x(s.location::geometry)
      ) order by s.kind desc, s.label)
      from company_sites s where s.company_id = c.id
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('field', x.field, 'url', x.url, 'captured_at', x.captured_at)
                       order by x.field, x.url)
      from company_sources x where x.company_id = c.id
    ), '[]'::jsonb),
    'vacancies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', v.title, 'level', v.level, 'course_title', v.course_title,
        'closing_date', v.closing_date, 'url', v.url, 'postcode', st.postcode
      ) order by v.closing_date nulls last)
      from vacancies v left join company_sites st on st.id = v.site_id
      where v.company_id = c.id and (v.closing_date is null or v.closing_date >= current_date)
    ), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'purpose', k.purpose, 'value', k.value, 'label', k.label,
        'source_url', k.source_url, 'method', k.method, 'verified_at', k.verified_at,
        'last_seen_at', k.last_seen_at
      ) order by (k.verified_at is null), k.purpose, k.kind, k.value)
      from company_contacts k where k.company_id = c.id and not k.hidden
    ), '[]'::jsonb),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'college_id', l.college_id, 'college', co.name, 'kind', l.kind,
        'mainly', l.mainly_from_this_college,
        'label', college_link_label(l.kind, co.name, l.mainly_from_this_college),
        'source_url', l.source_url, 'observed_on', l.observed_on, 'verified_at', l.verified_at
      ) order by l.mainly_from_this_college desc, l.kind, co.name)
      from company_college_links l join colleges co on co.id = l.college_id
      where l.company_id = c.id
    ), '[]'::jsonb)
  )
  from companies c
  where c.id = p_id
    and c.status = 'active';
$$;

create or replace function public.reference_data()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'routes', (select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'name', r.name,
                 'specialisms', (select jsonb_agg(jsonb_build_object('id', s, 'name', r.specialism_labels ->> s)
                                                  order by ord)
                                 from unnest(r.occupational_specialisms) with ordinality as u(s, ord)))
               order by r.name)
               from tlevel_routes r),
    -- The canonical sector list from data/sic-codes.csv. Curated rows carry
    -- free-text sectors too; they feed search, not this filter.
    'sectors', to_jsonb(array['aerospace','automotive','defence','electrical','electronics','energy',
      'engineering_services','maintenance_and_repair','manufacturing','marine','rail',
      'research_and_development',
      -- engineering-adjacent sectors (0021)
      'aviation','chemicals_and_pharma','data_centres','facilities_management','food_and_drink',
      'healthcare','materials','medical_devices','metals','telecoms','utilities'])
  );
$$;

comment on function public.rank_companies(jsonb, jsonb) is
  'Ranks active companies 0-100 for a student profile (signed in or not). See spec "Ranking model". '
  'SECURITY DEFINER for spatial index use under RLS; returns only status = active companies.';

revoke execute on function public.rank_companies(jsonb, jsonb) from public;
grant execute on function public.rank_companies(jsonb, jsonb) to anon, authenticated;
