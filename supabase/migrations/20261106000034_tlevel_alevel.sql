-- 0034: the A level a course asks for alongside the T Level (06/11/2026).
--
-- * uni_courses.tlevel_alevel: e.g. "A level Maths at B", "A levels in
--   Maths and Physics at BB", "A level Maths or Physics at C", read from the
--   saved T Level quote by scripts/universities/tlevel.ts (aLevelAlongside).
--   Set for accepted_with_maths courses, which now means "T Level + an A
--   level" (Maths, or another subject the course names).
-- * search_uni_courses, uni_course_detail and liked_items return it.

alter table public.uni_courses
  add column tlevel_alevel text check (length(tlevel_alevel) between 3 and 120),
  add constraint tlevel_alevel_needs_status check (tlevel_alevel is null or tlevel_status = 'accepted_with_maths');

comment on column public.uni_courses.tlevel_alevel is
  'For accepted_with_maths: the A level asked for alongside the T Level, in words, from tlevel_quote.';

drop function public.search_uni_courses(jsonb);
drop function public.uni_course_detail(uuid);

create or replace function public.search_uni_courses(p jsonb)
returns table (
  id uuid, title text, qualification text, subject_group public.course_subject_group,
  university_id uuid, university text, on_dfe_tlevel_list boolean, nation public.uk_nation,
  location_name text, distance_km double precision,
  tlevel_status public.tlevel_status, tlevel_requirement text, course_url text,
  foundation_year boolean, sandwich_year boolean, tlevel_scope public.tlevel_scope, russell_group boolean,
  tef_overall text, overall_rank smallint, overall_rank_of smallint, overall_rank_tied boolean,
  subject_label text, subject_rank smallint, subject_rank_of smallint, subject_rank_tied boolean,
  cug_subject_label text, cug_subject_position smallint, cug_subject_tied boolean, cug_subject_of smallint,
  cug_overall_position smallint, cug_overall_tied boolean, cug_overall_of smallint,
  satisfaction_pct smallint, median_salary integer, tlevel_points smallint, tlevel_alevel text,
  total bigint
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
           coalesce((p ->> 'russell')::boolean, false) as russell_only,
           case when p ->> 'foundation' in ('yes', 'no') then p ->> 'foundation' end as fy,
           case when p ->> 'sort' in ('easiest', 'cug', 'cug_uni', 'rank', 'satisfaction', 'salary', 'nearest', 'name')
                then p ->> 'sort' else 'default' end as sort,
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), hits as (
    select c.*, u.name as uni_name, u.on_dfe_tlevel_list, u.nation as uni_nation, u.russell_group,
           u.tef_overall, u.overall_rank, u.overall_rank_of, u.overall_rank_tied, s.label as subject_label,
           gs.label as cug_subject_label, gs.position as cug_subject_position, gs.tied as cug_subject_tied,
           gs.table_size as cug_subject_of, go.position as cug_overall_position, go.tied as cug_overall_tied,
           go.table_size as cug_overall_of,
           case when a.origin is not null and c.location is not null
                then st_distance(c.location, a.origin) / 1000.0 end as dist
    from public.uni_courses c
    join public.universities u on u.id = c.university_id
    left join public.cah_subjects s on s.code = c.rank_subject
    -- Complete University Guide: the first of the course's subjects with a table, and the overall table.
    left join lateral (
      select x.label, l.position, l.tied, l.table_size
      from unnest(c.subject_codes) with ordinality as sc (code, ord)
      join public.league_table_positions l on l.cah_code = sc.code and l.university_id = c.university_id
      join public.cah_subjects x on x.code = l.cah_code
      order by l.edition desc, sc.ord
      limit 1
    ) gs on true
    left join lateral (
      select l.position, l.tied, l.table_size from public.league_table_positions l
      where l.cah_code is null and l.university_id = c.university_id
      order by l.edition desc limit 1
    ) go on true
    cross join args a
    where (a.q is null or c.search @@ websearch_to_tsquery('english', a.q) or u.name ilike '%' || a.q || '%')
      and (cardinality(a.statuses) = 0 or c.tlevel_status = any (a.statuses))
      and (a.grp is null or c.subject_group = a.grp)
      and (a.nation is null or u.nation = a.nation)
      and (not a.dfe_only or u.on_dfe_tlevel_list)
      and (not a.russell_only or u.russell_group)
      and (a.fy is null
           or (a.fy = 'yes' and (c.foundation_year or c.title ~* 'foundation\s+year|with\s+(an?\s+)?(integrated\s+)?foundation'))
           or (a.fy = 'no' and coalesce(c.foundation_year, false) = false and c.title !~* 'foundation'))
      and (a.origin is null or a.km = 0 or (c.location is not null and st_dwithin(c.location, a.origin, a.km * 1000)))
  )
  select h.id, h.title, h.qualification, h.subject_group, h.university_id, h.uni_name, h.on_dfe_tlevel_list,
         h.uni_nation, h.location_name, h.dist, h.tlevel_status, h.tlevel_requirement, h.course_url,
         h.foundation_year, h.sandwich_year, h.tlevel_scope, h.russell_group,
         h.tef_overall, h.overall_rank, h.overall_rank_of, h.overall_rank_tied,
         h.subject_label, h.subject_rank, h.subject_rank_of, h.subject_rank_tied,
         h.cug_subject_label, h.cug_subject_position, h.cug_subject_tied, h.cug_subject_of,
         h.cug_overall_position, h.cug_overall_tied, h.cug_overall_of,
         h.satisfaction_pct, h.median_salary, public.tlevel_entry_points(h.tlevel_requirement), h.tlevel_alevel, count(*) over ()
  from hits h, args a
  order by
    -- Easiest entry: takes a T Level outright, then with Maths, then case by case; lowest grade first.
    case when a.sort = 'easiest' then
      case h.tlevel_status when 'accepted' then 0 when 'accepted_with_maths' then 1 when 'case_by_case' then 2
                           when 'unknown' then 3 else 4 end end,
    case when a.sort = 'easiest' then public.tlevel_entry_points(h.tlevel_requirement) end nulls last,
    -- Complete University Guide: subject position, then overall (and the reverse for cug_uni).
    case when a.sort = 'cug' then h.cug_subject_position end nulls last,
    case when a.sort in ('cug', 'cug_uni') then h.cug_overall_position end nulls last,
    case when a.sort = 'cug_uni' then h.cug_subject_position end nulls last,
    -- Our open-data rank: position within the subject as a share of the field, then overall.
    case when a.sort = 'rank' then h.subject_rank::float8 / nullif(h.subject_rank_of, 0) end nulls last,
    case when a.sort = 'rank' then h.overall_rank::float8 / nullif(h.overall_rank_of, 0) end nulls last,
    case when a.sort = 'satisfaction' then h.satisfaction_pct end desc nulls last,
    case when a.sort = 'salary' then h.median_salary end desc nulls last,
    case when a.sort = 'name' then h.uni_name end collate "C",
    case when a.sort = 'nearest' then h.dist end nulls last,
    -- Default: best T Level fit first, then nearest.
    case h.tlevel_status when 'accepted' then 0 when 'accepted_with_maths' then 1 when 'case_by_case' then 2
                         when 'unknown' then 3 else 4 end,
    -- Easiest entry within a T Level label, then a better-ranked course among equals.
    case when a.sort = 'default' then public.tlevel_entry_points(h.tlevel_requirement) end nulls last,
    case when a.sort = 'easiest' then h.cug_subject_position end nulls last,
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
    'tlevel_status', c.tlevel_status, 'tlevel_requirement', c.tlevel_requirement, 'tlevel_alevel', c.tlevel_alevel,
    'tlevel_quote', c.tlevel_quote, 'tlevel_quote_url', c.tlevel_quote_url,
    'tlevel_assessed_by', c.tlevel_assessed_by, 'tlevel_assessed_at', c.tlevel_assessed_at, 'tlevel_scope', c.tlevel_scope,
    'alevel_requirement', c.alevel_requirement,
    'subject_label', s.label, 'subject_league_table_url', s.league_table_url,
    'cug', (select to_jsonb(g) from public.cug_positions(c.university_id, c.subject_codes) g),
    'subject_rank', c.subject_rank, 'subject_rank_of', c.subject_rank_of,
    'subject_rank_tied', c.subject_rank_tied,
    'satisfaction_pct', c.satisfaction_pct, 'continuation_pct', c.continuation_pct,
    'work_study_pct', c.work_study_pct, 'median_salary', c.median_salary,
    'source_url', c.source_url, 'fetched_at', c.fetched_at,
    'university', jsonb_build_object(
      'id', u.id, 'name', u.name, 'nation', u.nation, 'website', u.website, 'russell_group', u.russell_group,
      'on_dfe_tlevel_list', u.on_dfe_tlevel_list, 'dfe_list_url', u.dfe_list_url,
      'dfe_list_checked_on', u.dfe_list_checked_on,
      'tlevel_policy_status', u.tlevel_policy_status, 'tlevel_policy_quote', u.tlevel_policy_quote,
      'tlevel_policy_url', u.tlevel_policy_url, 'tlevel_policy_checked_at', u.tlevel_policy_checked_at,
      'tef_overall', u.tef_overall, 'tef_experience', u.tef_experience, 'tef_outcomes', u.tef_outcomes,
      'tef_url', u.tef_url, 'overall_rank', u.overall_rank, 'overall_rank_of', u.overall_rank_of,
      'overall_rank_tied', u.overall_rank_tied, 'rankings_on', u.rankings_on)
  )
  from public.uni_courses c
  join public.universities u on u.id = c.university_id
  left join public.cah_subjects s on s.code = c.rank_subject
  where c.id = p_id;
$$;

grant execute on function public.search_uni_courses(jsonb), public.uni_course_detail(uuid) to anon, authenticated;

create or replace function public.liked_items()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'size_band', c.size_band, 'data_source', c.data_source,
        'county', (select s.county from company_sites s where s.company_id = c.id and s.county is not null order by s.kind desc limit 1),
        'liked_at', r.created_at,
        'shortlisted', exists (select 1 from tracker_items t where t.company_id = c.id and t.user_id = r.user_id)
      ) order by r.created_at desc)
      from reactions r join companies c on c.id = r.item_id and c.status = 'active'
      where r.user_id = (select auth.uid()) and r.item_type = 'company' and r.reaction = 'like'
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'title', k.title, 'qualification', k.qualification, 'university', u.name,
        'tlevel_status', k.tlevel_status, 'tlevel_requirement', k.tlevel_requirement, 'tlevel_alevel', k.tlevel_alevel,
        'course_url', k.course_url,
        'subject_label', (select x.label from cah_subjects x where x.code = k.rank_subject),
        'subject_rank', k.subject_rank, 'subject_rank_of', k.subject_rank_of, 'subject_rank_tied', k.subject_rank_tied,
        'overall_rank', u.overall_rank, 'overall_rank_of', u.overall_rank_of, 'overall_rank_tied', u.overall_rank_tied,
        'tef_overall', u.tef_overall,
        'cug', (select to_jsonb(g) from public.cug_positions(k.university_id, k.subject_codes) g),
        'liked_at', r.created_at,
        'shortlisted', exists (select 1 from course_shortlist s where s.course_id = k.id and s.user_id = r.user_id)
      ) order by r.created_at desc)
      from reactions r join uni_courses k on k.id = r.item_id join universities u on u.id = k.university_id
      where r.user_id = (select auth.uid()) and r.item_type = 'course' and r.reaction = 'like'
    ), '[]'::jsonb),
    'vacancies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'title', v.title, 'employer', coalesce(v.employer_name, c.name), 'company_id', v.company_id,
        'closing_date', v.closing_date, 'url', v.url, 'wage_text', v.wage_text, 'course_level', v.course_level,
        'liked_at', r.created_at,
        'shortlisted', exists (select 1 from tracker_items t where t.company_id = v.company_id and t.user_id = r.user_id)
      ) order by r.created_at desc)
      from reactions r join vacancies v on v.id = r.item_id join companies c on c.id = v.company_id and c.status = 'active'
      where r.user_id = (select auth.uid()) and r.item_type = 'vacancy' and r.reaction = 'like'
    ), '[]'::jsonb)
  );
$$;
