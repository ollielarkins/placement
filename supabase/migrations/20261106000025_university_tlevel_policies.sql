-- 0025: university-wide T Level statements as a fallback (06/11/2026).
--
-- Many course pages say nothing about T Levels, but the university has a
-- general entry requirements page or a T Level admissions statement.
-- scripts/universities/policies.ts finds those pages, reads them with the
-- same rules as course pages (only passages that are general - "all our
-- courses", "T Levels are accepted" - or name engineering T Levels), and
-- records the result on the university. Courses with no reading of their own
-- then take it with tlevel_scope = 'university', and the app says it comes
-- from the university's general statement. A course's own page always wins.

create type public.tlevel_scope as enum ('course', 'university');

alter table public.universities
  add column tlevel_policy_status public.tlevel_status,
  add column tlevel_policy_requirement text check (length(tlevel_policy_requirement) <= 120),
  add column tlevel_policy_quote text check (length(tlevel_policy_quote) <= 600),
  add column tlevel_policy_url text check (tlevel_policy_url is null or tlevel_policy_url ~* '^https?://'),
  add column tlevel_policy_checked_at timestamptz,
  add constraint tlevel_policy_needs_quote check (
    tlevel_policy_status is null or tlevel_policy_status = 'unknown'
    or (tlevel_policy_quote is not null and tlevel_policy_url is not null));

alter table public.uni_courses add column tlevel_scope public.tlevel_scope not null default 'course';

comment on column public.uni_courses.tlevel_scope is
  'course: read from the course''s own page. university: the course page says nothing, so the university''s general T Level statement is shown.';

-- Courses whose own page gave no answer take the university's statement;
-- ones that took it before but whose university now has none go back to unknown.
create or replace function import.apply_university_tlevel_policies()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with fill as (
    update public.uni_courses c set
      tlevel_status = u.tlevel_policy_status, tlevel_requirement = u.tlevel_policy_requirement,
      tlevel_quote = u.tlevel_policy_quote, tlevel_quote_url = u.tlevel_policy_url,
      tlevel_scope = 'university'
    from public.universities u
    where u.id = c.university_id
      and u.tlevel_policy_status is not null and u.tlevel_policy_status <> 'unknown'
      and c.tlevel_assessed_by is distinct from 'curated'
      and (c.tlevel_scope = 'university' or (c.tlevel_status = 'unknown' and c.tlevel_assessed_at is not null))
    returning 1
  ), clear as (
    update public.uni_courses c set
      tlevel_status = 'unknown', tlevel_requirement = null, tlevel_quote = null, tlevel_quote_url = null,
      tlevel_scope = 'course'
    from public.universities u
    where u.id = c.university_id and c.tlevel_scope = 'university'
      and (u.tlevel_policy_status is null or u.tlevel_policy_status = 'unknown')
    returning 1
  )
  select ((select count(*) from fill) + (select count(*) from clear))::int;
$$;
revoke execute on function import.apply_university_tlevel_policies() from public, anon, authenticated;

-- Return types change, so drop and recreate the read API.
drop function public.search_uni_courses(jsonb);
drop function public.uni_course_detail(uuid);

create or replace function public.search_uni_courses(p jsonb)
returns table (
  id uuid, title text, qualification text, subject_group public.course_subject_group,
  university_id uuid, university text, on_dfe_tlevel_list boolean, nation public.uk_nation,
  location_name text, distance_km double precision,
  tlevel_status public.tlevel_status, tlevel_requirement text, course_url text,
  foundation_year boolean, sandwich_year boolean, tlevel_scope public.tlevel_scope, total bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with args as (
    select nullif(trim(p ->> 'q'), '') as q,
           coalesce((select array_agg(x::public.tlevel_status) from jsonb_array_elements_text(p -> 'status') x
                     where x in ('accepted', 'accepted_with_maths', 'case_by_case', 'not_accepted', 'unknown')), '{}') as statuses,
           case when p ->> 'group' in ('engineering', 'computing', 'physics', 'maths', 'built_environment', 'other')
                then (p ->> 'group')::public.course_subject_group end as grp,
           case when p ->> 'nation' in ('england', 'scotland', 'wales', 'northern_ireland')
                then (p ->> 'nation')::public.uk_nation end as nation,
           coalesce((p ->> 'dfe_list')::boolean, false) as dfe_only,
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), hits as (
    select c.*, u.name as uni_name, u.on_dfe_tlevel_list, u.nation as uni_nation,
           case when a.origin is not null and c.location is not null
                then st_distance(c.location, a.origin) / 1000.0 end as dist
    from public.uni_courses c
    join public.universities u on u.id = c.university_id
    cross join args a
    where (a.q is null or c.search @@ websearch_to_tsquery('english', a.q) or u.name ilike '%' || a.q || '%')
      and (cardinality(a.statuses) = 0 or c.tlevel_status = any (a.statuses))
      and (a.grp is null or c.subject_group = a.grp)
      and (a.nation is null or u.nation = a.nation)
      and (not a.dfe_only or u.on_dfe_tlevel_list)
      and (a.origin is null or a.km = 0 or (c.location is not null and st_dwithin(c.location, a.origin, a.km * 1000)))
  )
  select h.id, h.title, h.qualification, h.subject_group, h.university_id, h.uni_name, h.on_dfe_tlevel_list,
         h.uni_nation, h.location_name, h.dist, h.tlevel_status, h.tlevel_requirement, h.course_url,
         h.foundation_year, h.sandwich_year, h.tlevel_scope, count(*) over ()
  from hits h, args a
  order by case h.tlevel_status when 'accepted' then 0 when 'accepted_with_maths' then 1 when 'case_by_case' then 2
                                when 'unknown' then 3 else 4 end,
           h.dist nulls last, h.uni_name collate "C", h.title collate "C"
  limit (select lim from args) offset (select (page - 1) * lim from args);
$$;

create or replace function public.uni_course_detail(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', c.id, 'title', c.title, 'qualification', c.qualification, 'subject_group', c.subject_group,
    'ucas_codes', c.ucas_codes, 'course_url', c.course_url,
    'foundation_year', c.foundation_year, 'sandwich_year', c.sandwich_year,
    'location_name', c.location_name,
    'lat', st_y(c.location::geometry), 'lng', st_x(c.location::geometry),
    'entry_alevel_pct', c.entry_alevel_pct, 'entry_other_pct', c.entry_other_pct,
    'tlevel_status', c.tlevel_status, 'tlevel_requirement', c.tlevel_requirement,
    'tlevel_quote', c.tlevel_quote, 'tlevel_quote_url', c.tlevel_quote_url,
    'tlevel_assessed_by', c.tlevel_assessed_by, 'tlevel_assessed_at', c.tlevel_assessed_at, 'tlevel_scope', c.tlevel_scope,
    'alevel_requirement', c.alevel_requirement,
    'source_url', c.source_url, 'fetched_at', c.fetched_at,
    'university', jsonb_build_object(
      'id', u.id, 'name', u.name, 'nation', u.nation, 'website', u.website,
      'on_dfe_tlevel_list', u.on_dfe_tlevel_list, 'dfe_list_url', u.dfe_list_url,
      'dfe_list_checked_on', u.dfe_list_checked_on,
      'tlevel_policy_status', u.tlevel_policy_status, 'tlevel_policy_quote', u.tlevel_policy_quote,
      'tlevel_policy_url', u.tlevel_policy_url, 'tlevel_policy_checked_at', u.tlevel_policy_checked_at)
  )
  from public.uni_courses c join public.universities u on u.id = c.university_id
  where c.id = p_id;
$$;

grant execute on function public.search_uni_courses(jsonb), public.uni_course_detail(uuid) to anon, authenticated;
