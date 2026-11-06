-- 0026: faster Apprenticeships page (06/11/2026).
--
-- apprenticeship_employers() took ~4 s: it checked every active company
-- against its contacts on each request. The list of employers with
-- apprenticeship schemes now lives in cache.apprenticeship_schemes, rebuilt
-- by refresh_read_models() (after imports, and nightly by pg_cron so new
-- contacts from the crawler show up). The warm-up job also runs the
-- Universities and Apprenticeships queries.

create materialized view cache.apprenticeship_schemes as
select c.id, c.name, c.size_band,
       (select k.value from public.company_contacts k
         where k.company_id = c.id and not k.hidden and k.confidence = 'confirmed'
           and k.kind in ('careers_page', 'apply_page') and k.purpose in ('apprenticeships', 'early_careers')
         order by (k.purpose = 'apprenticeships') desc, k.value limit 1) as scheme_url,
       c.routes_onward && array['degree_apprenticeship']::public.route_onward[] as has_degree_apprenticeship,
       c.data_source = 'verified' as verified
from public.companies c
where c.status = 'active'
  and (c.rank_has_apprenticeship
       or c.routes_onward && array['degree_apprenticeship']::public.route_onward[]
       or exists (select 1 from public.company_contacts k
                  where k.company_id = c.id and not k.hidden and k.confidence = 'confirmed'
                    and k.purpose = 'apprenticeships'));

create unique index apprenticeship_schemes_id on cache.apprenticeship_schemes (id);
create index apprenticeship_schemes_order on cache.apprenticeship_schemes (verified desc, name);

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
  refresh materialized view concurrently cache.apprenticeship_schemes;
end;
$$;
revoke execute on function public.refresh_read_models() from public, anon, authenticated;

-- Same signature and output as 0024, reading the cache. SECURITY DEFINER
-- because cache.* isn't exposed to the API roles; it returns only active
-- companies' public fields.
create or replace function public.apprenticeship_employers(p jsonb)
returns table (
  id uuid, name text, size_band public.size_band, scheme_url text, has_degree_apprenticeship boolean,
  distance_km double precision, verified boolean, total bigint
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with args as (
    select case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), located as (
    select s.*,
           case when a.origin is null then null
                else (select min(st_distance(cs.location, a.origin)) / 1000.0
                      from public.company_sites cs where cs.company_id = s.id) end as dist
    from cache.apprenticeship_schemes s, args a
  )
  select l.id, l.name, l.size_band, l.scheme_url, l.has_degree_apprenticeship, l.dist, l.verified, count(*) over ()
  from located l, args a
  where a.origin is null or a.km = 0 or l.dist <= a.km
  order by l.verified desc, l.dist nulls last, l.name collate "C"
  limit (select lim from args) offset (select (page - 1) * lim from args);
$$;
grant execute on function public.apprenticeship_employers(jsonb) to anon, authenticated;

-- Nightly rebuild (new contacts from the crawler) and a warmer warm-up.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('refresh-read-models', 'keep-search-warm');
    perform cron.schedule('refresh-read-models', '17 3 * * *', $job$select public.refresh_read_models();$job$);
    perform cron.schedule(
      'keep-search-warm',
      '*/4 * * * *',
      $job$
        select count(*) from public.rank_companies('{}'::jsonb, '{"limit":1}'::jsonb);
        select count(*) from public.rank_companies('{"lat":52.5,"lng":-1.5,"max_travel_km":40}'::jsonb, '{"limit":1}'::jsonb);
        select public.map_sites(-6.4, 49.9, 1.8, 55.8, 6, '{}'::jsonb) is not null;
        select count(*) from public.company_contacts;
        select count(*) from public.search_uni_courses('{"group":"engineering","limit":1}'::jsonb);
        select count(*) from public.search_apprenticeships('{"limit":1}'::jsonb);
        select count(*) from public.apprenticeship_employers('{"limit":1}'::jsonb);
      $job$
    );
  else
    raise notice 'pg_cron not available here: jobs not scheduled';
  end if;
end
$$;
