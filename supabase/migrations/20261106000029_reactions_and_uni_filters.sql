-- 0029: like/dislike card mode, Russell Group and foundation-year filters (06/11/2026).
--
-- * reactions: a student's likes and dislikes on placements (companies),
--   university courses and apprenticeship adverts, saved in their account
--   (decided by Ollie). Owner-only, like the shortlist; writing needs a ready
--   account (age confirmed). Deleted with the account. A dislike only hides
--   the item from card mode.
-- * liked_items(): the Liked area - liked items with their details and
--   whether each is already on the shortlist.
-- * universities.russell_group: the 24 members listed at
--   https://russellgroup.ac.uk/about/our-universities/ (checked 06/11/2026;
--   data/russell-group.csv), matched by UKPRN.
-- * search_uni_courses gains filters russell (bool) and foundation
--   ('yes' | 'no') and returns russell_group.

-- ---------------------------------------------------------------------------
-- Russell Group
-- ---------------------------------------------------------------------------
alter table public.universities add column russell_group boolean not null default false;

update public.universities set russell_group = true
where ukprn in ('10006840', '10007786', '10007788', '10007814', '10007143', '10007790', '10007792', '10007794',
                '10003270', '10003645', '10007795', '10006842', '10004063', '10007798', '10007799', '10007154',
                '10007774', '10007775', '10005343', '10007157', '10007158', '10007784', '10007163', '10007167');

drop function public.search_uni_courses(jsonb);
drop function public.uni_course_detail(uuid);

create or replace function public.search_uni_courses(p jsonb)
returns table (
  id uuid, title text, qualification text, subject_group public.course_subject_group,
  university_id uuid, university text, on_dfe_tlevel_list boolean, nation public.uk_nation,
  location_name text, distance_km double precision,
  tlevel_status public.tlevel_status, tlevel_requirement text, course_url text,
  foundation_year boolean, sandwich_year boolean, tlevel_scope public.tlevel_scope, russell_group boolean, total bigint
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
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), hits as (
    select c.*, u.name as uni_name, u.on_dfe_tlevel_list, u.nation as uni_nation, u.russell_group,
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
      and (not a.russell_only or u.russell_group)
      -- Foundation year: the dataset's flag, or a course that is itself the foundation-year version.
      and (a.fy is null
           or (a.fy = 'yes' and (c.foundation_year or c.title ~* 'foundation\s+year|with\s+(an?\s+)?(integrated\s+)?foundation'))
           or (a.fy = 'no' and coalesce(c.foundation_year, false) = false and c.title !~* 'foundation'))
      and (a.origin is null or a.km = 0 or (c.location is not null and st_dwithin(c.location, a.origin, a.km * 1000)))
  )
  select h.id, h.title, h.qualification, h.subject_group, h.university_id, h.uni_name, h.on_dfe_tlevel_list,
         h.uni_nation, h.location_name, h.dist, h.tlevel_status, h.tlevel_requirement, h.course_url,
         h.foundation_year, h.sandwich_year, h.tlevel_scope, h.russell_group, count(*) over ()
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
      'id', u.id, 'name', u.name, 'nation', u.nation, 'website', u.website, 'russell_group', u.russell_group,
      'on_dfe_tlevel_list', u.on_dfe_tlevel_list, 'dfe_list_url', u.dfe_list_url,
      'dfe_list_checked_on', u.dfe_list_checked_on,
      'tlevel_policy_status', u.tlevel_policy_status, 'tlevel_policy_quote', u.tlevel_policy_quote,
      'tlevel_policy_url', u.tlevel_policy_url, 'tlevel_policy_checked_at', u.tlevel_policy_checked_at)
  )
  from public.uni_courses c join public.universities u on u.id = c.university_id
  where c.id = p_id;
$$;

grant execute on function public.search_uni_courses(jsonb), public.uni_course_detail(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------
create type public.reaction_item as enum ('company', 'course', 'vacancy');
create type public.reaction_kind as enum ('like', 'dislike');

create table public.reactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_type public.reaction_item not null,
  item_id uuid not null,
  reaction public.reaction_kind not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

create index reactions_user_like_idx on public.reactions (user_id, item_type) where reaction = 'like';

create trigger reactions_touch before update on public.reactions
  for each row execute function public.set_updated_at();

alter table public.reactions enable row level security;

create policy "reactions: owner read" on public.reactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "reactions: owner delete" on public.reactions
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "reactions: owner add" on public.reactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.account_ready()));
create policy "reactions: owner update" on public.reactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.account_ready()));

-- The item must exist (and a company must be active); at most 5,000 per student.
create or replace function public.reactions_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
begin
  if tg_op = 'INSERT' and (select count(*) from public.reactions where user_id = new.user_id) >= 5000 then
    raise exception 'too many reactions (5,000)' using errcode = '54000';
  end if;
  v_exists := case new.item_type
    when 'company' then exists (select 1 from public.companies where id = new.item_id and status = 'active')
    when 'course' then exists (select 1 from public.uni_courses where id = new.item_id)
    when 'vacancy' then exists (select 1 from public.vacancies where id = new.item_id)
  end;
  if not coalesce(v_exists, false) then
    raise exception 'item not available' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.reactions_guard() from public, anon, authenticated;

create trigger reactions_guard before insert or update of item_type, item_id on public.reactions
  for each row execute function public.reactions_guard();

-- The Liked area. SECURITY INVOKER: RLS limits it to the caller's own rows.
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
revoke execute on function public.liked_items() from public, anon;
grant execute on function public.liked_items() to authenticated;
