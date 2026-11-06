-- 0030: university and subject rankings on every course (06/11/2026).
--
-- The published league tables (Complete University Guide, Guardian, Times,
-- QS) are copyright, with no licence to copy their tables, so the course page
-- links to them and we rank from open data instead:
-- * universities.tef_*: the Office for Students' Teaching Excellence
--   Framework 2023 rating (Discover Uni TEFOutcome, CC BY 4.0).
-- * universities.overall_rank / uni_courses.subject_rank: our own ranking
--   from Discover Uni measures (student satisfaction, continuation, work or
--   study 15 months on, median salary), computed by
--   scripts/universities/rankings.ts (npm run unis:rank), which documents the
--   method. Null when there isn't enough data to rank.
-- * cah_subjects: HESA Common Aggregation Hierarchy level 3 labels for the
--   subjects in scope (v1.3.5,
--   https://www.hesa.ac.uk/collection/c20054/derived/UNISTATS_XCAH03).
-- * search_uni_courses returns the ranks and gains sort = 'rank';
--   uni_course_detail returns the ranks and the four measures.

create table public.cah_subjects (
  code text primary key check (code ~ '^CAH[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
  label text not null check (length(label) between 2 and 120)
);
alter table public.cah_subjects enable row level security;
create policy "cah_subjects: public read" on public.cah_subjects for select to anon, authenticated using (true);
grant select on public.cah_subjects to anon, authenticated;

insert into public.cah_subjects (code, label) values
  ('CAH07-01-01', 'Physics'),
  ('CAH07-01-02', 'Astronomy'),
  ('CAH09-01-01', 'Mathematics'),
  ('CAH09-01-02', 'Operational research'),
  ('CAH09-01-03', 'Statistics'),
  ('CAH10-01-01', 'Engineering (non-specific)'),
  ('CAH10-01-02', 'Mechanical engineering'),
  ('CAH10-01-03', 'Production and manufacturing engineering'),
  ('CAH10-01-04', 'Aeronautical and aerospace engineering'),
  ('CAH10-01-05', 'Naval architecture'),
  ('CAH10-01-06', 'Bioengineering, medical and biomedical engineering'),
  ('CAH10-01-07', 'Civil engineering'),
  ('CAH10-01-08', 'Electrical and electronic engineering'),
  ('CAH10-01-09', 'Chemical, process and energy engineering'),
  ('CAH10-01-10', 'Other engineering'),
  ('CAH10-03-01', 'Minerals technology'),
  ('CAH10-03-02', 'Materials technology'),
  ('CAH10-03-03', 'Polymers and textiles'),
  ('CAH10-03-04', 'Maritime technology'),
  ('CAH10-03-05', 'Biotechnology'),
  ('CAH10-03-06', 'Other technology'),
  ('CAH10-03-07', 'Materials science'),
  ('CAH11-01-01', 'Computer science'),
  ('CAH11-01-02', 'Information technology'),
  ('CAH11-01-03', 'Information systems'),
  ('CAH11-01-04', 'Software engineering'),
  ('CAH11-01-05', 'Artificial intelligence'),
  ('CAH11-01-06', 'Computer games and animation'),
  ('CAH11-01-07', 'Business computing'),
  ('CAH11-01-08', 'Other computing'),
  ('CAH13-01-01', 'Architecture'),
  ('CAH13-01-02', 'Building'),
  ('CAH13-01-03', 'Landscape design'),
  ('CAH13-01-04', 'Planning (urban, rural and regional)');

alter table public.universities
  add column tef_overall text check (tef_overall in ('Gold', 'Silver', 'Bronze', 'Requires improvement')),
  add column tef_experience text check (tef_experience in ('Gold', 'Silver', 'Bronze', 'Requires improvement')),
  add column tef_outcomes text check (tef_outcomes in ('Gold', 'Silver', 'Bronze', 'Requires improvement')),
  add column tef_url text check (tef_url is null or tef_url ~* '^https://'),
  add column overall_rank smallint check (overall_rank > 0),
  add column overall_rank_of smallint check (overall_rank_of > 0),
  add column overall_rank_tied boolean,
  add column rankings_on date,
  add constraint overall_rank_in_range check (overall_rank is null or (overall_rank_of is not null and overall_rank <= overall_rank_of));

alter table public.uni_courses
  add column rank_subject text check (rank_subject ~ '^CAH[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
  add column subject_rank smallint check (subject_rank > 0),
  add column subject_rank_of smallint check (subject_rank_of > 0),
  add column subject_rank_tied boolean,
  add column satisfaction_pct smallint check (satisfaction_pct between 0 and 100),
  add column continuation_pct smallint check (continuation_pct between 0 and 100),
  add column work_study_pct smallint check (work_study_pct between 0 and 100),
  add column median_salary integer check (median_salary between 1000 and 500000),
  add constraint subject_rank_in_range check (subject_rank is null or (subject_rank_of is not null and subject_rank <= subject_rank_of and rank_subject is not null));

comment on column public.universities.overall_rank is
  'Our open-data rank across all subjects (scripts/universities/rankings.ts), not a published league table position.';
comment on column public.uni_courses.subject_rank is
  'Our open-data rank of this provider within rank_subject (CAH3), not a published league table position.';

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
           coalesce(p ->> 'sort', '') = 'rank' as by_rank,
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), hits as (
    select c.*, u.name as uni_name, u.on_dfe_tlevel_list, u.nation as uni_nation, u.russell_group,
           u.tef_overall, u.overall_rank, u.overall_rank_of, u.overall_rank_tied, s.label as subject_label,
           case when a.origin is not null and c.location is not null
                then st_distance(c.location, a.origin) / 1000.0 end as dist
    from public.uni_courses c
    join public.universities u on u.id = c.university_id
    left join public.cah_subjects s on s.code = c.rank_subject
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
         h.subject_label, h.subject_rank, h.subject_rank_of, h.subject_rank_tied, count(*) over ()
  from hits h, args a
  order by
    -- Best ranked: position within the subject as a share of the field, then overall.
    case when a.by_rank then h.subject_rank::float8 / nullif(h.subject_rank_of, 0) end nulls last,
    case when a.by_rank then h.overall_rank::float8 / nullif(h.overall_rank_of, 0) end nulls last,
    case h.tlevel_status when 'accepted' then 0 when 'accepted_with_maths' then 1 when 'case_by_case' then 2
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
    'subject_label', s.label, 'subject_rank', c.subject_rank, 'subject_rank_of', c.subject_rank_of,
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

-- The Liked area shows the ranks too (otherwise as in 0029).
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
        'tlevel_status', k.tlevel_status, 'tlevel_requirement', k.tlevel_requirement, 'course_url', k.course_url,
        'subject_label', (select x.label from cah_subjects x where x.code = k.rank_subject),
        'subject_rank', k.subject_rank, 'subject_rank_of', k.subject_rank_of, 'subject_rank_tied', k.subject_rank_tied,
        'overall_rank', u.overall_rank, 'overall_rank_of', u.overall_rank_of, 'overall_rank_tied', u.overall_rank_tied,
        'tef_overall', u.tef_overall,
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

