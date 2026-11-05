-- T Level Placement Finder: Phase 1 read API.
--
-- Everything the public pages need, as Postgres functions the app calls over
-- PostgREST RPC with the anon key: one round trip per page, the shaping done
-- next to the data, and nothing a browser could use to pull the whole table.
--
--   company_detail(id)         one company page (jsonb)
--   map_sites(bbox, zoom, f)   GeoJSON for the map: grid clusters when zoomed
--                              out, individual sites when zoomed in, capped
--   region_counts()            companies per region and county, for the
--                              region view
--   reference_data()           routes, specialisms, sectors for the filters
--
-- Public data only. Hidden, dissolved and not-taking-placements companies
-- never appear (same hard filter as rank_companies).

-- ---------------------------------------------------------------------------
-- company_detail
-- ---------------------------------------------------------------------------
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
    ), '[]'::jsonb)
  )
  from companies c
  where c.id = p_id
    and c.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- map_sites
-- ---------------------------------------------------------------------------
-- Returns a GeoJSON FeatureCollection. Below zoom 10 sites are snapped to a
-- grid sized to the zoom and returned as clusters with a count, so the
-- payload stays small at country scale. From zoom 10 individual sites are
-- returned, capped at 2,000 (the response says when the cap was hit).
-- Filters (all optional): route_id, data_sources[], has_taken_tlevel,
-- has_live_vacancies.
create or replace function public.map_sites(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom integer,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer -- spatial index under RLS, as rank_companies (0007)
set search_path = public, extensions, pg_temp
as $$
declare
  v_env geometry;
  v_zoom int := least(greatest(coalesce(p_zoom, 6), 0), 22);
  v_cell double precision;
  v_route_specs text[];
  v_sources data_source[];
  v_taken boolean := coalesce((p_filters ->> 'has_taken_tlevel')::boolean, false);
  v_live boolean := coalesce((p_filters ->> 'has_live_vacancies')::boolean, false);
  v_limit constant int := 2000;
  v_result jsonb;
begin
  -- England plus a margin; anything wider is clamped.
  v_env := st_makeenvelope(
    greatest(p_min_lng, -7.0), greatest(p_min_lat, 49.5),
    least(p_max_lng, 2.5), least(p_max_lat, 56.0), 4326);

  if nullif(p_filters ->> 'route_id', '') is not null then
    select occupational_specialisms into v_route_specs from tlevel_routes where id = p_filters ->> 'route_id';
  end if;
  if jsonb_typeof(p_filters -> 'data_sources') = 'array' then
    v_sources := array(select jsonb_array_elements_text(p_filters -> 'data_sources'))::data_source[];
  end if;

  if v_zoom < 10 then
    -- Grid cell of roughly 60 screen pixels at this zoom.
    v_cell := 360.0 / (2 ^ v_zoom) / 4.0;
    with pts as (
      select c.id as company_id, c.data_source, s.location::geometry as g
      from company_sites s
      join companies c on c.id = s.company_id
      where s.location && v_env::geography
        and c.status = 'active'
        and (v_sources is null or c.data_source = any (v_sources))
        and (not v_taken or c.takes_tlevel = 'yes')
        and (v_route_specs is null or c.specialisms && v_route_specs
             or exists (select 1 from tlevel_routes r, unnest(r.sic_prefixes) pre, unnest(c.sic_codes) code
                        where r.id = p_filters ->> 'route_id' and code like pre || '%'))
        and (not v_live or exists (select 1 from vacancies v where v.company_id = c.id
                                   and (v.closing_date is null or v.closing_date >= current_date)))
    )
    select jsonb_build_object(
      'type', 'FeatureCollection',
      'clustered', true,
      'features', coalesce(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'geometry', jsonb_build_object('type', 'Point', 'coordinates',
          jsonb_build_array(round(st_x(ctr)::numeric, 5), round(st_y(ctr)::numeric, 5))),
        'properties', jsonb_build_object('count', n, 'verified', nv)
      )), '[]'::jsonb)
    ) into v_result
    from (
      select st_centroid(st_collect(g)) as ctr, count(distinct company_id) as n,
             count(distinct company_id) filter (where data_source = 'verified') as nv
      from pts
      group by st_snaptogrid(g, v_cell)
    ) k;
  else
    with pts as (
      select c.id as company_id, c.name, c.data_source, c.takes_tlevel, s.location::geometry as g
      from company_sites s
      join companies c on c.id = s.company_id
      where s.location && v_env::geography
        and c.status = 'active'
        and (v_sources is null or c.data_source = any (v_sources))
        and (not v_taken or c.takes_tlevel = 'yes')
        and (v_route_specs is null or c.specialisms && v_route_specs
             or exists (select 1 from tlevel_routes r, unnest(r.sic_prefixes) pre, unnest(c.sic_codes) code
                        where r.id = p_filters ->> 'route_id' and code like pre || '%'))
        and (not v_live or exists (select 1 from vacancies v where v.company_id = c.id
                                   and (v.closing_date is null or v.closing_date >= current_date)))
    ),
    capped as (
      -- Verified first so they survive the cap.
      select *, count(*) over () as total from pts
      order by (data_source = 'verified') desc, company_id
      limit v_limit
    )
    select jsonb_build_object(
      'type', 'FeatureCollection',
      'clustered', false,
      'truncated', coalesce(max(total), 0) > v_limit,
      'features', coalesce(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'geometry', jsonb_build_object('type', 'Point', 'coordinates',
          jsonb_build_array(round(st_x(g)::numeric, 5), round(st_y(g)::numeric, 5))),
        'properties', jsonb_build_object('company_id', company_id, 'name', name,
          'data_source', data_source, 'takes_tlevel', takes_tlevel)
      )), '[]'::jsonb)
    ) into v_result
    from capped;
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- region_counts
-- ---------------------------------------------------------------------------
create or replace function public.region_counts()
returns table (
  region england_region,
  county text,
  companies bigint,
  verified bigint,
  with_vacancies bigint
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with site_company as (
    select distinct s.region, s.county, c.id, c.data_source,
           exists (select 1 from vacancies v where v.company_id = c.id
                   and (v.closing_date is null or v.closing_date >= current_date)) as live
    from company_sites s
    join companies c on c.id = s.company_id
    where c.status = 'active' and s.region is not null
  )
  select region, county,
         count(distinct id),
         count(distinct id) filter (where data_source = 'verified'),
         count(distinct id) filter (where live)
  from site_company
  group by grouping sets ((region), (region, county))
  order by region, county nulls first;
$$;

-- ---------------------------------------------------------------------------
-- reference_data
-- ---------------------------------------------------------------------------
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
      'research_and_development'])
  );
$$;

revoke execute on function public.company_detail(uuid), public.map_sites(double precision, double precision,
  double precision, double precision, integer, jsonb), public.region_counts(), public.reference_data()
  from public;
grant execute on function public.company_detail(uuid), public.map_sites(double precision, double precision,
  double precision, double precision, integer, jsonb), public.region_counts(), public.reference_data()
  to anon, authenticated;
