-- 0037: keep apprenticeship adverts whose employer we can't match (06/11/2026).
--
-- About a third of live adverts were dropped because the employer's name
-- matched no single Companies House company (common names, or bodies such
-- as the armed forces, councils and NHS trusts). They are now kept with
-- company_id null: the advert shows the employer's name, with no company
-- page or shortlist button.
--
-- * vacancies.company_id is nullable; vacancies.postcode and location hold
--   the advert's own address, so distance works without a company site.
-- * import.merge_vacancies keeps unmatched adverts (and still never creates a
--   company for them).
-- * search_apprenticeships, apprenticeship_summary and liked_items include
--   them.

alter table public.vacancies
  alter column company_id drop not null,
  add column postcode text check (length(postcode) <= 10),
  add column location extensions.geography(point, 4326);
create index vacancies_location_gix on public.vacancies using gist (location);

comment on column public.vacancies.company_id is
  'Null when the advert''s employer matched no single company; employer_name still shows who it is.';

create or replace function import.merge_vacancies(p_run_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_run import.runs;
  e record;
  v_id uuid;
  v_on text;
  v_ids uuid[];
  v_cand jsonb;
  v_live int;
  v_staged int;
  v_deleted int := 0;
begin
  select * into v_run from import.runs where id = p_run_id for update;
  if not found then raise exception 'import run % not found', p_run_id; end if;
  if v_run.source <> 'apprenticeship_vacancies' then raise exception 'run % is not a vacancies run', p_run_id; end if;
  if v_run.finished_at is not null then raise exception 'import run % already merged', p_run_id; end if;

  select count(*) into v_staged from import.faa_vacancies where run_id = p_run_id;
  select count(*) into v_live from public.vacancies;
  -- A failed or partial fetch must not wipe the table.
  if v_run.is_full and v_live > 50 and v_staged < v_live * 0.5 then
    raise exception 'full run has % adverts but % are stored: refusing to merge', v_staged, v_live;
  end if;

  -- One decision per employer (name + website + candidates), applied to all its adverts.
  for e in
    select import.normalise_name(employer_name) as nn,
           nullif(regexp_replace(lower(trim(employer_website)), '^https?://(www\.)?([^/:?#]+).*$', '\2'),
                  lower(trim(employer_website))) as dom,
           array_agg(external_ref) as refs,
           array_agg(distinct replace(upper(postcode), ' ', '')) filter (where postcode is not null) as pcs,
           (array_agg(ch_candidates order by jsonb_array_length(ch_candidates) desc))[1] as cands,
           min(employer_name) as employer_name
    from import.faa_vacancies
    where run_id = p_run_id
    group by 1, 2
  loop
    v_id := null; v_on := null;

    -- 1. website domain
    if e.dom is not null then
      v_ids := array(select id from public.companies where website_domain = e.dom and status = 'active');
      if cardinality(v_ids) = 1 then v_id := v_ids[1]; v_on := 'domain'; end if;
    end if;

    -- 2. normalised name + advert postcode
    if v_id is null and e.pcs is not null then
      v_ids := array(
        select distinct c.id from public.companies c
        join public.company_sites s on s.company_id = c.id
        where c.name_normalised = e.nn and c.status = 'active'
          and replace(upper(s.postcode), ' ', '') = any (e.pcs));
      if cardinality(v_ids) = 1 then v_id := v_ids[1]; v_on := 'name_postcode'; end if;
    end if;

    -- 3. the one active company with this name in the whole CH register
    --    (linked if we hold it, otherwise created as Imported)
    if v_id is null and jsonb_array_length(e.cands) = 1 then
      v_cand := e.cands -> 0;
      select id into v_id from public.companies where ch_number = v_cand ->> 'ch_number';
      if v_id is not null then
        v_on := 'ch_lookup';
      else
        insert into public.companies (name, ch_number, sic_codes, size_band, data_source, added_by,
                                      ch_status, ch_synced_at)
        values (v_cand ->> 'name', v_cand ->> 'ch_number',
                coalesce(array(select jsonb_array_elements_text(v_cand -> 'sic_codes')), '{}'),
                coalesce((v_cand ->> 'size_band')::public.size_band, 'unknown'),
                'imported', 'vacancies', 'Active', now())
        returning id into v_id;
        v_on := 'created';
        if v_cand ->> 'lat' is not null then
          insert into public.company_sites (company_id, kind, label, postcode, region, county, location)
          values (v_id, 'registered_office', 'Registered office', v_cand ->> 'postcode',
                  (v_cand ->> 'region')::public.england_region, v_cand ->> 'county',
                  extensions.st_setsrid(extensions.st_makepoint((v_cand ->> 'lon')::float8,
                    (v_cand ->> 'lat')::float8), 4326)::extensions.geography);
        end if;
        insert into public.company_sources (company_id, field, url)
        values (v_id, 'companies_house',
                'https://find-and-update.company-information.service.gov.uk/company/' || (v_cand ->> 'ch_number'))
        on conflict (company_id, field, url) do nothing;
      end if;
    end if;

    -- 4. fallback when the register lookup didn't run or wasn't unique:
    --    a distinctive name held by exactly one of our companies
    if v_id is null and (length(e.nn) >= 8 or e.nn like '% %') then
      v_ids := array(select id from public.companies where name_normalised = e.nn and status = 'active');
      if cardinality(v_ids) = 1 then v_id := v_ids[1]; v_on := 'name'; end if;
    end if;

    if v_id is null then
      insert into import.vacancy_results (run_id, external_ref, employer_name, action, message)
      select p_run_id, r, e.employer_name, 'unmatched',
             case jsonb_array_length(e.cands)
               when 0 then 'name not found among active companies in the Companies House register'
               else format('%s active Companies House companies have this name', jsonb_array_length(e.cands)) end
      from unnest(e.refs) r;
      continue;
    end if;

    insert into import.vacancy_results (run_id, external_ref, employer_name, action, matched_on, company_id)
    select p_run_id, r, e.employer_name,
           case when v_on = 'created' then 'created_company' else 'linked' end,
           case when v_on = 'created' then 'ch_lookup' else v_on end, v_id
    from unnest(e.refs) r;
  end loop;

  -- Vacancy sites: one per company + postcode.
  insert into public.company_sites (company_id, kind, label, postcode, region, county, location)
  select distinct on (r.company_id, replace(upper(v.postcode), ' ', ''))
         r.company_id, 'vacancy_site', 'Apprenticeship location', v.postcode, v.region, v.county,
         extensions.st_setsrid(extensions.st_makepoint(v.lon, v.lat), 4326)::extensions.geography
  from import.faa_vacancies v
  join import.vacancy_results r on r.run_id = v.run_id and r.external_ref = v.external_ref
  where v.run_id = p_run_id and r.company_id is not null and v.lat is not null and v.postcode is not null
    and not exists (
      select 1 from public.company_sites s
      where s.company_id = r.company_id
        and replace(upper(s.postcode), ' ', '') = replace(upper(v.postcode), ' ', ''))
  order by r.company_id, replace(upper(v.postcode), ' ', '');

  -- Adverts.
  insert into public.vacancies (company_id, site_id, external_ref, title, level, closing_date, url,
                                employer_name, course_title, route, posted_on, start_on, fetched_at,
                                postcode, location)
  select r.company_id,
         (select s.id from public.company_sites s
          where s.company_id = r.company_id
            and replace(upper(s.postcode), ' ', '') = replace(upper(v.postcode), ' ', '')
          order by s.kind limit 1),
         v.external_ref, v.title, v.level, v.closing_date, v.url,
         v.employer_name, v.course_title, v.route, v.posted_on, v.start_on, now(),
         v.postcode,
         case when v.lat is not null and v.lon is not null
              then extensions.st_setsrid(extensions.st_makepoint(v.lon, v.lat), 4326)::extensions.geography end
  from import.faa_vacancies v
  join import.vacancy_results r on r.run_id = v.run_id and r.external_ref = v.external_ref
  -- Unmatched employers too (0037): the advert shows the employer's name without a company page.
  where v.run_id = p_run_id
  on conflict (external_ref) do update set
    company_id = excluded.company_id, site_id = excluded.site_id, title = excluded.title,
    level = excluded.level, closing_date = excluded.closing_date, url = excluded.url,
    employer_name = excluded.employer_name, course_title = excluded.course_title,
    route = excluded.route, posted_on = excluded.posted_on, start_on = excluded.start_on,
    fetched_at = excluded.fetched_at, postcode = excluded.postcode, location = excluded.location;

  -- The advert is the source for "has live vacancies".
  insert into public.company_sources (company_id, field, url)
  select distinct r.company_id, 'vacancies', v.url
  from import.faa_vacancies v
  join import.vacancy_results r on r.run_id = v.run_id and r.external_ref = v.external_ref
  where v.run_id = p_run_id and r.company_id is not null and v.url ~* '^https?://'
  on conflict (company_id, field, url) do update set captured_at = now();

  if v_run.is_full then
    with d as (
      delete from public.vacancies x
      where not exists (
        select 1 from import.vacancy_results r
        where r.run_id = p_run_id and r.external_ref = x.external_ref)
      returning x.company_id, x.url
    ), src as (
      delete from public.company_sources cs using d
      where cs.company_id = d.company_id and cs.field = 'vacancies' and cs.url = d.url
    )
    select count(*) into v_deleted from d;

    delete from public.company_sites s
    where s.kind = 'vacancy_site'
      and not exists (select 1 from public.vacancies x where x.site_id = s.id);
  end if;

  delete from import.faa_vacancies where run_id = p_run_id;
  update import.runs set finished_at = now(), stats = (
    select jsonb_build_object(
      'adverts', count(*),
      'linked', count(*) filter (where action = 'linked'),
      'created_company', count(*) filter (where action = 'created_company'),
      'unmatched', count(*) filter (where action = 'unmatched'),
      'companies_with_adverts', count(distinct company_id),
      'kept_without_company', count(*) filter (where company_id is null),
      'removed', v_deleted)
    from import.vacancy_results where run_id = p_run_id
  ) where id = p_run_id;
  return (select stats from import.runs where id = p_run_id);
end;
$$;

revoke execute on function import.merge_vacancies(uuid) from public, anon, authenticated;

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
    select v.*, coalesce(v.employer_name, c.name) as employer_label, coalesce(s.postcode, v.postcode) as site_postcode,
           public.wage_annual(v.wage_text) as wage_yr,
           case when a.origin is not null and coalesce(s.location, v.location) is not null
                then st_distance(coalesce(s.location, v.location), a.origin) / 1000.0 end as dist
    from public.vacancies v
    left join public.companies c on c.id = v.company_id
    left join public.company_sites s on s.id = v.site_id
    cross join args a
    where (v.closing_date is null or v.closing_date >= current_date)
      and (v.company_id is null or c.status = 'active')
      and (a.q is null or v.title ilike '%' || a.q || '%' or v.course_title ilike '%' || a.q || '%'
           or coalesce(v.employer_name, c.name) ilike '%' || a.q || '%')
      and (a.lvl is null or v.course_level = a.lvl)
      and (a.band is null or a.band @> v.course_level::int)
      and (not a.tl_only or v.tlevel_mention is not null)
      and (a.origin is null or a.km = 0 or (coalesce(s.location, v.location) is not null and st_dwithin(coalesce(s.location, v.location), a.origin, a.km * 1000)))
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
    left join public.companies c on c.id = v.company_id
    left join public.company_sites s on s.id = v.site_id
    cross join args a
    where (v.closing_date is null or v.closing_date >= current_date)
      and (v.company_id is null or c.status = 'active')
      and (a.q is null or v.title ilike '%' || a.q || '%' or v.course_title ilike '%' || a.q || '%'
           or coalesce(v.employer_name, c.name) ilike '%' || a.q || '%')
      and (not a.tl_only or v.tlevel_mention is not null)
      and (a.origin is null or a.km = 0 or (coalesce(s.location, v.location) is not null and st_dwithin(coalesce(s.location, v.location), a.origin, a.km * 1000)))
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
      from reactions r join vacancies v on v.id = r.item_id left join companies c on c.id = v.company_id
      where r.user_id = (select auth.uid()) and r.item_type = 'vacancy' and r.reaction = 'like'
        and (v.company_id is null or c.status = 'active')
    ), '[]'::jsonb)
  );
$$;
