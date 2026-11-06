-- 0036: richer apprenticeship search (06/11/2026).
--
-- * wage_annual(wage_text): a yearly figure from an advert's stated wage
--   ("£24,000 a year", "£1,800 a month" x 12, "£450 a week" x 52). Null for
--   "National Minimum Wage for apprentices", "Competitive salary" and anything
--   else without a stated amount; we never estimate a wage.
-- * search_apprenticeships: band filter (intermediate = level 2, advanced = 3,
--   higher = 4-5, degree = 6-7), sort = default | closing | newest | wage |
--   level | nearest | employer, and returns posted_on, hours_per_week,
--   expected_duration and wage_annual.
-- * apprenticeship_summary(p): counts for the page's summary strip and level
--   pills, using the same filters (band and paging aside).

create or replace function public.wage_annual(p_wage text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when m is null then null
    when m[2] = 'a year' then round(replace(m[1], ',', '')::numeric)::integer
    when m[2] = 'a month' then round(replace(m[1], ',', '')::numeric * 12)::integer
    when m[2] = 'a week' then round(replace(m[1], ',', '')::numeric * 52)::integer
  end
  from (select regexp_match(p_wage, '^£([0-9][0-9,]*(?:\.[0-9]+)?) (a year|a month|a week)') as m) x
  where m is null or replace(m[1], ',', '')::numeric between 1 and 500000;
$$;
grant execute on function public.wage_annual(text) to anon, authenticated;

drop function public.search_apprenticeships(jsonb);

create or replace function public.search_apprenticeships(p jsonb)
returns table (
  id uuid, title text, employer text, company_id uuid, course_title text, course_level smallint,
  level text, wage_text text, closing_date date, start_on date, url text, postcode text,
  distance_km double precision, tlevel_mention text, training_provider text,
  posted_on date, hours_per_week numeric, expected_duration text, wage_annual integer, total bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with args as (
    select nullif(trim(p ->> 'q'), '') as q,
           case when (p ->> 'level') ~ '^[2-7]$' then (p ->> 'level')::smallint end as lvl,
           case p ->> 'band' when 'intermediate' then int4range(2, 3) when 'advanced' then int4range(3, 4)
                             when 'higher' then int4range(4, 6) when 'degree' then int4range(6, 8) end as band,
           coalesce((p ->> 'tlevel')::boolean, false) as tl_only,
           case when p ->> 'sort' in ('closing', 'newest', 'wage', 'level', 'nearest', 'employer')
                then p ->> 'sort' else 'default' end as sort,
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), hits as (
    select v.*, coalesce(v.employer_name, c.name) as employer_label, s.postcode as site_postcode,
           public.wage_annual(v.wage_text) as wage_yr,
           case when a.origin is not null and s.location is not null
                then st_distance(s.location, a.origin) / 1000.0 end as dist
    from public.vacancies v
    join public.companies c on c.id = v.company_id and c.status = 'active'
    left join public.company_sites s on s.id = v.site_id
    cross join args a
    where (v.closing_date is null or v.closing_date >= current_date)
      and (a.q is null or v.title ilike '%' || a.q || '%' or v.course_title ilike '%' || a.q || '%'
           or coalesce(v.employer_name, c.name) ilike '%' || a.q || '%')
      and (a.lvl is null or v.course_level = a.lvl)
      and (a.band is null or a.band @> v.course_level::int)
      and (not a.tl_only or v.tlevel_mention is not null)
      and (a.origin is null or a.km = 0 or (s.location is not null and st_dwithin(s.location, a.origin, a.km * 1000)))
  )
  select h.id, h.title, h.employer_label, h.company_id, h.course_title, h.course_level,
         h.level, h.wage_text, h.closing_date, h.start_on, h.url, h.site_postcode, h.dist, h.tlevel_mention,
         h.training_provider, h.posted_on, h.hours_per_week, h.expected_duration, h.wage_yr, count(*) over ()
  from hits h, args a
  order by
    case when a.sort = 'closing' then h.closing_date end nulls last,
    case when a.sort = 'newest' then h.posted_on end desc nulls last,
    case when a.sort = 'wage' then h.wage_yr end desc nulls last,
    case when a.sort = 'level' then h.course_level end desc nulls last,
    case when a.sort = 'nearest' then h.dist end nulls last,
    case when a.sort = 'employer' then h.employer_label end collate "C",
    -- Default: adverts that mention T Levels, then nearest, then closing soonest.
    case when a.sort = 'default' then (h.tlevel_mention is null) end,
    h.dist nulls last, h.closing_date nulls last, h.title collate "C"
  limit (select lim from args) offset (select (page - 1) * lim from args);
$$;

create or replace function public.apprenticeship_summary(p jsonb)
returns table (
  total bigint, intermediate bigint, advanced bigint, higher bigint, degree bigint,
  closing_this_week bigint, mention_tlevels bigint, top_wage integer
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  -- Same filters as search_apprenticeships (keep the two in step), except the
  -- level band, so each level pill can show its own count.
  with args as (
    select nullif(trim(p ->> 'q'), '') as q,
           coalesce((p ->> 'tlevel')::boolean, false) as tl_only,
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km
  ), hits as (
    select v.course_level, v.closing_date, v.tlevel_mention, public.wage_annual(v.wage_text) as wage_yr
    from public.vacancies v
    join public.companies c on c.id = v.company_id and c.status = 'active'
    left join public.company_sites s on s.id = v.site_id
    cross join args a
    where (v.closing_date is null or v.closing_date >= current_date)
      and (a.q is null or v.title ilike '%' || a.q || '%' or v.course_title ilike '%' || a.q || '%'
           or coalesce(v.employer_name, c.name) ilike '%' || a.q || '%')
      and (not a.tl_only or v.tlevel_mention is not null)
      and (a.origin is null or a.km = 0 or (s.location is not null and st_dwithin(s.location, a.origin, a.km * 1000)))
  )
  select count(*),
         count(*) filter (where course_level = 2), count(*) filter (where course_level = 3),
         count(*) filter (where course_level in (4, 5)), count(*) filter (where course_level in (6, 7)),
         count(*) filter (where closing_date < current_date + 7),
         count(*) filter (where tlevel_mention is not null),
         max(wage_yr)
  from hits;
$$;

grant execute on function public.search_apprenticeships(jsonb), public.apprenticeship_summary(jsonb) to anon, authenticated;
