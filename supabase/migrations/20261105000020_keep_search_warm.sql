-- 0020 Keep search warm
--
-- Search is ~0.3-1 s once the database has the companies table and its
-- indexes in memory, but the first search after a quiet spell had to read
-- them from disk and could take long enough for the page to time out.
-- A pg_cron job runs the same queries the site does every 4 minutes, so
-- they stay cached. Cost: well under a second of database time per run.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'keep-search-warm';
    perform cron.schedule(
      'keep-search-warm',
      '*/4 * * * *',
      $job$
        select count(*) from public.rank_companies('{}'::jsonb, '{"limit":1}'::jsonb);
        select count(*) from public.rank_companies('{"lat":52.5,"lng":-1.5,"max_travel_km":40}'::jsonb, '{"limit":1}'::jsonb);
        select public.map_sites(-6.4, 49.9, 1.8, 55.8, 6, '{}'::jsonb) is not null;
        select count(*) from public.company_contacts;
      $job$
    );
  else
    raise notice 'pg_cron not available here: search warm-up not scheduled';
  end if;
end
$$;
