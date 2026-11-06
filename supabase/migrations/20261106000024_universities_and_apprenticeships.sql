-- 0024: Universities and Apprenticeships tabs (Phase 2.5, decided 06/11/2026).
--
-- Universities
-- * universities: every UK higher education provider in the Discover Uni
--   dataset (HESA/OfS, CC BY 4.0), plus whether it is on DfE's list of
--   providers that consider T Levels for entry
--   (gov.uk "higher education providers with T Levels in entry requirements").
-- * uni_courses: engineering-related undergraduate courses from Discover Uni,
--   each with its course page URL. tlevel_* columns record what the course
--   page says about T Levels, with the sentence it was read from:
--     accepted             the T Level alone meets the requirement
--     accepted_with_maths  needs A level Maths (or similar) alongside it
--     case_by_case         considered individually / contact admissions
--     not_accepted         the page says T Levels aren't accepted
--     unknown              the page doesn't say, or we couldn't read it
--   Nothing here is invented: unknown is shown as "Check with the university".
-- * course_shortlist: a student's saved courses (owner-only, like
--   tracker_items).
--
-- Apprenticeships
-- * vacancies gains the advert details the Display Advert API returns
--   (summary, wage text, hours, duration, training provider, qualifications,
--   skills) and tlevel_mention: the sentence where the advert mentions T
--   Levels, if any. Named employer contacts from the API are never stored.
-- * import.faa_vacancy_details + import.apply_vacancy_details() load those
--   details by advert reference after import.merge_vacancies().

-- ---------------------------------------------------------------------------
-- Universities
-- ---------------------------------------------------------------------------
create type public.uk_nation as enum ('england', 'scotland', 'wales', 'northern_ireland');
create type public.tlevel_status as enum ('accepted', 'accepted_with_maths', 'case_by_case', 'not_accepted', 'unknown');
create type public.course_subject_group as enum ('engineering', 'computing', 'physics', 'maths', 'built_environment', 'other');

create table public.universities (
  id uuid primary key default gen_random_uuid(),
  ukprn text not null unique check (ukprn ~ '^[0-9]{8}$'),
  name text not null check (length(name) between 2 and 200),
  nation public.uk_nation,
  website text check (website is null or website ~* '^https?://'),
  on_dfe_tlevel_list boolean not null default false,
  dfe_list_url text check (dfe_list_url is null or dfe_list_url ~* '^https?://'),
  dfe_list_checked_on date,
  source_url text not null check (source_url ~* '^https?://'),
  fetched_at timestamptz not null default now()
);

comment on table public.universities is
  'UK higher education providers (Discover Uni dataset, CC BY 4.0). on_dfe_tlevel_list: named on DfE''s list of providers that consider T Levels for at least one course.';

create table public.uni_courses (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities (id) on delete cascade,
  kis_course_id text not null check (length(kis_course_id) between 1 and 60),
  kis_mode smallint not null check (kis_mode in (1, 2, 3)), -- 1 full-time, 2 part-time, 3 both
  title text not null check (length(title) between 2 and 300),
  qualification text,                       -- e.g. "BEng (Hons)", from KISAIM
  subject_group public.course_subject_group not null,
  subject_codes text[] not null default '{}', -- CAH codes
  ucas_codes text[] not null default '{}',
  course_url text check (course_url is null or course_url ~* '^https?://'),
  foundation_year boolean,
  sandwich_year boolean,
  location_name text,
  location extensions.geography(point, 4326),
  -- Share of entrants by highest qualification (Discover Uni Entry.*), for context.
  entry_alevel_pct smallint check (entry_alevel_pct between 0 and 100),
  entry_other_pct smallint check (entry_other_pct between 0 and 100),
  -- What the course page says about T Levels.
  tlevel_status public.tlevel_status not null default 'unknown',
  tlevel_requirement text check (length(tlevel_requirement) <= 120),   -- e.g. "Distinction (D)"
  tlevel_quote text check (length(tlevel_quote) <= 600),
  tlevel_quote_url text check (tlevel_quote_url is null or tlevel_quote_url ~* '^https?://'),
  tlevel_assessed_by text check (tlevel_assessed_by in ('rules', 'claude', 'curated')),
  tlevel_assessed_at timestamptz,
  alevel_requirement text check (length(alevel_requirement) <= 200),   -- e.g. "AAB including Maths"
  source_url text not null check (source_url ~* '^https?://'),
  fetched_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(qualification, ''))) stored,
  unique (university_id, kis_course_id, kis_mode),
  constraint tlevel_quote_needs_source check (tlevel_quote is null or tlevel_quote_url is not null),
  constraint tlevel_known_needs_quote check (tlevel_status = 'unknown' or tlevel_quote is not null)
);

comment on column public.uni_courses.tlevel_status is
  'From the course page wording (tlevel_quote, at tlevel_quote_url). unknown = the page does not say; never inferred.';

create index uni_courses_university_idx on public.uni_courses (university_id);
create index uni_courses_status_idx on public.uni_courses (tlevel_status, subject_group);
create index uni_courses_location_gix on public.uni_courses using gist (location);
create index uni_courses_search_idx on public.uni_courses using gin (search);

alter table public.universities enable row level security;
alter table public.uni_courses enable row level security;

create policy "universities: public read" on public.universities for select to anon, authenticated using (true);
create policy "universities: admin write" on public.universities for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "uni_courses: public read" on public.uni_courses for select to anon, authenticated using (true);
create policy "uni_courses: admin write" on public.uni_courses for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Course shortlist (owner-only)
-- ---------------------------------------------------------------------------
create type public.course_stage as enum ('interested', 'open_day', 'applying', 'applied', 'offer', 'firm', 'insurance', 'not_for_me');

create table public.course_shortlist (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.uni_courses (id) on delete cascade,
  stage public.course_stage not null default 'interested',
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create trigger course_shortlist_touch before update on public.course_shortlist
  for each row execute function public.set_updated_at();

alter table public.course_shortlist enable row level security;

create policy "course_shortlist: owner read" on public.course_shortlist
  for select to authenticated using (user_id = (select auth.uid()));
create policy "course_shortlist: owner delete" on public.course_shortlist
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "course_shortlist: owner add" on public.course_shortlist
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.account_ready()));
create policy "course_shortlist: owner update" on public.course_shortlist
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.account_ready()));

create or replace function public.course_shortlist_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.course_shortlist where user_id = new.user_id) >= 100 then
    raise exception 'course shortlist is full (100 courses)' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke execute on function public.course_shortlist_guard() from public, anon, authenticated;
create trigger course_shortlist_insert_guard before insert on public.course_shortlist
  for each row execute function public.course_shortlist_guard();

-- ---------------------------------------------------------------------------
-- University read API
-- ---------------------------------------------------------------------------

-- p: {q, status: [..], group, nation, dfe_list: bool, lat, lng, km, page, limit}
create or replace function public.search_uni_courses(p jsonb)
returns table (
  id uuid, title text, qualification text, subject_group public.course_subject_group,
  university_id uuid, university text, on_dfe_tlevel_list boolean, nation public.uk_nation,
  location_name text, distance_km double precision,
  tlevel_status public.tlevel_status, tlevel_requirement text, course_url text,
  foundation_year boolean, sandwich_year boolean, total bigint
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
         h.foundation_year, h.sandwich_year, count(*) over ()
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
    'tlevel_assessed_by', c.tlevel_assessed_by, 'tlevel_assessed_at', c.tlevel_assessed_at,
    'alevel_requirement', c.alevel_requirement,
    'source_url', c.source_url, 'fetched_at', c.fetched_at,
    'university', jsonb_build_object(
      'id', u.id, 'name', u.name, 'nation', u.nation, 'website', u.website,
      'on_dfe_tlevel_list', u.on_dfe_tlevel_list, 'dfe_list_url', u.dfe_list_url,
      'dfe_list_checked_on', u.dfe_list_checked_on)
  )
  from public.uni_courses c join public.universities u on u.id = c.university_id
  where c.id = p_id;
$$;

grant execute on function public.search_uni_courses(jsonb), public.uni_course_detail(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Apprenticeships: advert details
-- ---------------------------------------------------------------------------
alter table public.vacancies
  add column summary text check (length(summary) <= 1000),
  add column wage_text text check (length(wage_text) <= 300),
  add column hours_per_week numeric(4, 1) check (hours_per_week > 0 and hours_per_week <= 60),
  add column expected_duration text check (length(expected_duration) <= 100),
  add column training_provider text check (length(training_provider) <= 200),
  add column course_level smallint check (course_level between 2 and 7),
  add column qualifications jsonb not null default '[]'::jsonb check (jsonb_typeof(qualifications) = 'array'),
  add column skills text[] not null default '{}',
  add column tlevel_mention text check (length(tlevel_mention) <= 600);

comment on column public.vacancies.tlevel_mention is
  'The sentence where the advert mentions T Levels (from the Display Advert API text), or null if it does not.';

create table import.faa_vacancy_details (
  external_ref text primary key,
  summary text,
  wage_text text,
  hours_per_week numeric(4, 1),
  expected_duration text,
  training_provider text,
  course_level smallint,
  qualifications jsonb not null default '[]'::jsonb,
  skills text[] not null default '{}',
  tlevel_mention text,
  fetched_at timestamptz not null default now()
);
revoke all on import.faa_vacancy_details from public, anon, authenticated;

create or replace function import.apply_vacancy_details()
returns integer
language sql
security definer
set search_path = public, import, pg_temp
as $$
  with u as (
    update public.vacancies v set
      summary = left(d.summary, 1000),
      wage_text = left(d.wage_text, 300),
      hours_per_week = case when d.hours_per_week > 0 and d.hours_per_week <= 60 then d.hours_per_week end,
      expected_duration = left(d.expected_duration, 100),
      training_provider = left(d.training_provider, 200),
      course_level = case when d.course_level between 2 and 7 then d.course_level end,
      qualifications = d.qualifications,
      skills = d.skills,
      tlevel_mention = left(d.tlevel_mention, 600)
    from import.faa_vacancy_details d
    where d.external_ref = v.external_ref
    returning 1
  )
  select count(*)::int from u;
$$;
revoke execute on function import.apply_vacancy_details() from public, anon, authenticated;

-- p: {q, level, tlevel: bool, lat, lng, km, page, limit}
create or replace function public.search_apprenticeships(p jsonb)
returns table (
  id uuid, title text, employer text, company_id uuid, course_title text, course_level smallint,
  level text, wage_text text, closing_date date, start_on date, url text, postcode text,
  distance_km double precision, tlevel_mention text, training_provider text, total bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with args as (
    select nullif(trim(p ->> 'q'), '') as q,
           case when (p ->> 'level') ~ '^[2-7]$' then (p ->> 'level')::smallint end as lvl,
           coalesce((p ->> 'tlevel')::boolean, false) as tl_only,
           case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), hits as (
    select v.*, c.name as company_name, s.postcode as site_postcode,
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
      and (not a.tl_only or v.tlevel_mention is not null)
      and (a.origin is null or a.km = 0 or (s.location is not null and st_dwithin(s.location, a.origin, a.km * 1000)))
  )
  select h.id, h.title, coalesce(h.employer_name, h.company_name), h.company_id, h.course_title, h.course_level,
         h.level, h.wage_text, h.closing_date, h.start_on, h.url, h.site_postcode, h.dist, h.tlevel_mention,
         h.training_provider, count(*) over ()
  from hits h
  order by (h.tlevel_mention is null), h.dist nulls last, h.closing_date nulls last, h.title collate "C"
  limit (select lim from args) offset (select (page - 1) * lim from args);
$$;

-- Employers with an apprenticeship route but no live advert listed above:
-- curated routes_onward or an apprenticeships page found by the crawler.
create or replace function public.apprenticeship_employers(p jsonb)
returns table (
  id uuid, name text, size_band public.size_band, scheme_url text, has_degree_apprenticeship boolean,
  distance_km double precision, verified boolean, total bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with args as (
    select case when p ? 'lat' and p ? 'lng'
                then st_setsrid(st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::geography end as origin,
           least(greatest(coalesce((p ->> 'km')::float8, 0), 0), 1000) as km,
           least(greatest(coalesce((p ->> 'limit')::int, 20), 1), 50) as lim,
           least(greatest(coalesce((p ->> 'page')::int, 1), 1), 100) as page
  ), schemes as (
    select c.id, c.name, c.size_band,
           (select k.value from public.company_contacts k
             where k.company_id = c.id and not k.hidden and k.confidence = 'confirmed'
               and k.kind in ('careers_page', 'apply_page') and k.purpose in ('apprenticeships', 'early_careers')
             order by (k.purpose = 'apprenticeships') desc, k.value limit 1) as scheme_url,
           c.routes_onward && array['degree_apprenticeship']::public.route_onward[] as degree,
           c.data_source = 'verified' as verified
    from public.companies c
    where c.status = 'active'
      and (c.rank_has_apprenticeship
           or c.routes_onward && array['degree_apprenticeship']::public.route_onward[]
           or exists (select 1 from public.company_contacts k
                      where k.company_id = c.id and not k.hidden and k.confidence = 'confirmed'
                        and k.purpose = 'apprenticeships'))
  ), located as (
    select s.*, (select min(st_distance(cs.location, a.origin)) / 1000.0
                 from public.company_sites cs where cs.company_id = s.id) as dist
    from schemes s, args a
  )
  select l.id, l.name, l.size_band, l.scheme_url, l.degree, l.dist, l.verified, count(*) over ()
  from located l, args a
  where a.origin is null or a.km = 0 or l.dist <= a.km
  order by l.verified desc, l.dist nulls last, l.name collate "C"
  limit (select lim from args) offset (select (page - 1) * lim from args);
$$;

grant execute on function public.search_apprenticeships(jsonb), public.apprenticeship_employers(jsonb) to anon, authenticated;
