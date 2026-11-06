-- 0031: link each subject to its Complete University Guide table (06/11/2026).
--
-- The CUG tables are copyright, so we link to them rather than copying
-- positions; publishing positions waits for the publisher's permission.
-- URLs checked 06/11/2026 against the 2027 subject tables.

alter table public.cah_subjects
  add column league_table_url text check (league_table_url is null or league_table_url ~* '^https://www\.thecompleteuniversityguide\.co\.uk/');

update public.cah_subjects set league_table_url = 'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings/' || slug
from (values
  ('CAH10-01-08', 'electrical-and-electronic-engineering'),
  ('CAH10-01-04', 'aeronautical-and-aerospace-engineering'),
  ('CAH10-01-02', 'mechanical-engineering'),
  ('CAH11-01-01', 'computer-science')
) as v (code, slug)
where cah_subjects.code = v.code;

drop function public.uni_course_detail(uuid);

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
    'subject_label', s.label, 'subject_league_table_url', s.league_table_url,
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

grant execute on function public.uni_course_detail(uuid) to anon, authenticated;
