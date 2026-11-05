-- 0013 Read-model cache for the map and region counts
--
-- Live testing on 04/11/2026 with the anon key showed region_counts() hitting
-- the 3 s anon statement_timeout and map_sites() at country zoom taking ~3 s.
-- Both did the joins (sites x companies x routes x vacancies) on every call.
-- This migration precomputes those joins into materialized views in a private
-- schema and points the two functions at them.
--
--   cache.map_points    one row per site of an active company, with the
--                       filter columns already resolved (route_ids, live).
--   cache.region_stats  the region / county counts.
--   public.refresh_read_models()  refreshes both; called by every import
--                       script after commit. Not callable by anon/authenticated.
--
-- Staleness: the map and region counts reflect the last import or manual
-- refresh. Search (rank_companies) and company pages still read live tables.

create schema if not exists cache;
revoke all on schema cache from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- cache.map_points
-- ---------------------------------------------------------------------------
create materialized view cache.map_points as
select
  s.id as site_id,
  c.id as company_id,
  c.name,
  c.data_source,
  c.takes_tlevel,
  s.location::extensions.geometry as g,
  coalesce((
    select array_agg(r.id order by r.id)
    from public.tlevel_routes r
    where c.specialisms && r.occupational_specialisms
       or exists (select 1 from unnest(r.sic_prefixes) pre, unnest(c.sic_codes) code
                  where code like pre || '%')
  ), '{}') as route_ids,
  exists (select 1 from public.vacancies v
          where v.company_id = c.id
            and (v.closing_date is null or v.closing_date >= current_date)) as live
from public.company_sites s
join public.companies c on c.id = s.company_id
where c.status = 'active'
with data;

create unique index map_points_site_uidx on cache.map_points (site_id);
create index map_points_g_gix on cache.map_points using gist (g);
create index map_points_route_gin on cache.map_points using gin (route_ids);

-- ---------------------------------------------------------------------------
-- cache.region_stats
-- ---------------------------------------------------------------------------
create materialized view cache.region_stats as
with site_company as (
  select distinct s.region, s.county, c.id, c.data_source,
         exists (select 1 from public.vacancies v where v.company_id = c.id
                 and (v.closing_date is null or v.closing_date >= current_date)) as live
  from public.company_sites s
  join public.companies c on c.id = s.company_id
  where c.status = 'active' and s.region is not null
),
grouped as (
  select region, county, grouping(county) = 1 as is_region_total,
         count(distinct id) as companies,
         count(distinct id) filter (where data_source = 'verified') as verified,
         count(distinct id) filter (where live) as with_vacancies
  from site_company
  group by grouping sets ((region), (region, county))
)
-- Sites with no county still count in their region total, but get no county
-- row (it would be indistinguishable from the total).
select region, county, companies, verified, with_vacancies,
       coalesce(county, '') as county_key
from grouped
where is_region_total or county is not null
with data;

-- Plain-column unique index: REFRESH ... CONCURRENTLY needs one.
create unique index region_stats_uidx on cache.region_stats (region, county_key);

revoke all on all tables in schema cache from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- refresh_read_models
-- ---------------------------------------------------------------------------
create or replace function public.refresh_read_models()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '10min'
as $$
begin
  refresh materialized view concurrently cache.map_points;
  refresh materialized view concurrently cache.region_stats;
end;
$$;

revoke execute on function public.refresh_read_models() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- region_counts: now a read of the cache
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
  select region, county, companies, verified, with_vacancies
  from cache.region_stats
  order by region, county nulls first;
$$;

-- ---------------------------------------------------------------------------
-- map_sites: same signature and output as 0012, reading cache.map_points
-- ---------------------------------------------------------------------------
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
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_env geometry;
  v_zoom int := least(greatest(coalesce(p_zoom, 6), 0), 22);
  v_cell double precision;
  v_route text := nullif(p_filters ->> 'route_id', '');
  v_sources data_source[];
  v_taken boolean := coalesce((p_filters ->> 'has_taken_tlevel')::boolean, false);
  v_live boolean := coalesce((p_filters ->> 'has_live_vacancies')::boolean, false);
  v_limit constant int := 2000;
  v_result jsonb;
begin
  v_env := st_makeenvelope(
    greatest(p_min_lng, -7.0), greatest(p_min_lat, 49.5),
    least(p_max_lng, 2.5), least(p_max_lat, 56.0), 4326);

  if jsonb_typeof(p_filters -> 'data_sources') = 'array' then
    v_sources := array(select jsonb_array_elements_text(p_filters -> 'data_sources'))::data_source[];
  end if;

  if v_zoom < 10 then
    v_cell := 360.0 / (2 ^ v_zoom) / 8.0; -- roughly 30-60 px cells
    select jsonb_build_object(
      'type', 'FeatureCollection',
      'clustered', true,
      'features', coalesce(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'geometry', jsonb_build_object('type', 'Point', 'coordinates',
          jsonb_build_array(round(cx::numeric, 5), round(cy::numeric, 5))),
        'properties', jsonb_build_object('count', n, 'verified', nv)
      )), '[]'::jsonb)
    ) into v_result
    from (
      -- avg of x/y is a cheap centroid; count(distinct) keeps multi-site
      -- companies to one per cell.
      select avg(st_x(p.g)) as cx, avg(st_y(p.g)) as cy,
             count(distinct p.company_id) as n,
             count(distinct p.company_id) filter (where p.data_source = 'verified') as nv
      from cache.map_points p
      where p.g && v_env
        and (v_route is null or p.route_ids @> array[v_route])
        and (v_sources is null or p.data_source = any (v_sources))
        and (not v_taken or p.takes_tlevel = 'yes')
        and (not v_live or p.live)
      group by floor(st_x(p.g) / v_cell), floor(st_y(p.g) / v_cell)
    ) k;
  else
    with pts as (
      select p.company_id, p.name, p.data_source, p.takes_tlevel, p.g
      from cache.map_points p
      where p.g && v_env
        and (v_route is null or p.route_ids @> array[v_route])
        and (v_sources is null or p.data_source = any (v_sources))
        and (not v_taken or p.takes_tlevel = 'yes')
        and (not v_live or p.live)
    ),
    capped as (
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
