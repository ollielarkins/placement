-- 0027: headline figures for the home page (06/11/2026).
--
-- One precomputed row, rebuilt by refresh_read_models() (after imports and
-- nightly), so the home page never counts large tables on request.

create materialized view cache.site_stats as
select 1 as id,
       (select count(*) from public.companies where status = 'active') as employers,
       (select count(*) from public.companies where status = 'active' and data_source = 'verified') as verified,
       (select count(distinct k.company_id) from public.company_contacts k
          join public.companies c on c.id = k.company_id and c.status = 'active'
         where not k.hidden) as employers_with_contacts,
       (select count(*) from public.company_contacts where not hidden) as contacts,
       (select count(*) from public.vacancies where closing_date is null or closing_date >= current_date) as live_adverts,
       (select count(*) from cache.apprenticeship_schemes) as apprenticeship_employers,
       (select count(*) from public.uni_courses) as uni_courses,
       (select count(*) from public.uni_courses where tlevel_status <> 'unknown') as uni_courses_labelled,
       (select count(*) from public.universities) as universities,
       now() as refreshed_at;

create unique index site_stats_id on cache.site_stats (id);

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
  refresh materialized view concurrently cache.site_stats; -- after apprenticeship_schemes, which it counts
end;
$$;
revoke execute on function public.refresh_read_models() from public, anon, authenticated;

create or replace function public.site_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(s) - 'id' from cache.site_stats s;
$$;
grant execute on function public.site_stats() to anon, authenticated;
