-- T Level Placement Finder: apprenticeship vacancies import, Phase 0.
--
-- Source: Find an apprenticeship, Display Advert API v2
-- (https://api.apprenticeships.education.gov.uk/vacancies), route
-- "Engineering and manufacturing". scripts/vacancies/import.ts fetches every
-- live advert, geocodes the advert addresses, and for employers we don't
-- hold looks the name up in the full Companies House register (all SIC
-- codes). import.merge_vacancies() then:
--
--   1. matches each advert's employer to a company:
--        website domain -> normalised name + advert postcode ->
--        the single active company with that name in the whole CH register
--        (linked if we hold it, created as Imported if not) -> normalised
--        name alone (only if exactly one of our companies has it and the
--        name is distinctive);
--   2. upserts the advert into public.vacancies and records the advert
--      address as a site of kind 'vacancy_site' (a real workplace, unlike
--      many registered offices);
--   3. on a full run, deletes adverts that are no longer listed, then
--      vacancy sites no advert points at.
-- Employers that can't be resolved (several CH matches, none, or a body
-- such as the Royal Navy with no CH record) are reported in
-- import.vacancy_results and not created.
--
-- Companies added this way carry added_by = 'vacancies', so the Companies
-- House import doesn't hide them for falling outside its SIC filter
-- (merge_companies_house is re-created below with that rule).

alter type public.site_kind add value if not exists 'vacancy_site';

alter table public.companies add column added_by text
  check (added_by in ('companies_house', 'vacancies', 'seed', 'submission', 'admin'));
update public.companies set added_by = 'companies_house'
  where data_source = 'imported' and ch_number is not null;

alter table public.vacancies
  add column employer_name text,
  add column course_title text,
  add column route text,
  add column posted_on date,
  add column start_on date;

alter table import.runs drop constraint runs_source_check;
alter table import.runs add constraint runs_source_check
  check (source in ('companies_house', 'apprenticeship_vacancies', 'curated_seed'));

create table import.faa_vacancies (
  run_id uuid not null references import.runs (id) on delete cascade,
  external_ref text not null,
  employer_name text not null,
  employer_website text,
  title text not null,
  level text,
  course_title text,
  route text,
  url text,
  posted_on date,
  closing_date date,
  start_on date,
  postcode text,
  region public.england_region,
  county text,
  lat double precision,
  lon double precision,
  -- Active CH companies whose normalised name equals the employer's, from the
  -- full register: [{ch_number, name, sic_codes[], size_band, postcode,
  -- region, county, lat, lon}]. Empty if the lookup was skipped.
  ch_candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(ch_candidates) = 'array'),
  primary key (run_id, external_ref)
);

create table import.vacancy_results (
  run_id uuid not null references import.runs (id) on delete cascade,
  external_ref text not null,
  employer_name text not null,
  action text not null check (action in ('linked', 'created_company', 'unmatched')),
  matched_on text,
  company_id uuid,
  message text,
  primary key (run_id, external_ref)
);

alter table import.faa_vacancies enable row level security;
alter table import.vacancy_results enable row level security;
revoke all on import.faa_vacancies, import.vacancy_results from public, anon, authenticated;

-- Same normalisation as companies.name_normalised.
create or replace function import.normalise_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(lower(p), '\m(ltd|limited|plc|llp|uk|the|group|co)\M', '', 'g'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

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
                                employer_name, course_title, route, posted_on, start_on, fetched_at)
  select r.company_id,
         (select s.id from public.company_sites s
          where s.company_id = r.company_id
            and replace(upper(s.postcode), ' ', '') = replace(upper(v.postcode), ' ', '')
          order by s.kind limit 1),
         v.external_ref, v.title, v.level, v.closing_date, v.url,
         v.employer_name, v.course_title, v.route, v.posted_on, v.start_on, now()
  from import.faa_vacancies v
  join import.vacancy_results r on r.run_id = v.run_id and r.external_ref = v.external_ref
  where v.run_id = p_run_id and r.company_id is not null
  on conflict (external_ref) do update set
    company_id = excluded.company_id, site_id = excluded.site_id, title = excluded.title,
    level = excluded.level, closing_date = excluded.closing_date, url = excluded.url,
    employer_name = excluded.employer_name, course_title = excluded.course_title,
    route = excluded.route, posted_on = excluded.posted_on, start_on = excluded.start_on,
    fetched_at = excluded.fetched_at;

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
        where r.run_id = p_run_id and r.external_ref = x.external_ref and r.company_id is not null)
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
      'removed', v_deleted)
    from import.vacancy_results where run_id = p_run_id
  ) where id = p_run_id;
  return (select stats from import.runs where id = p_run_id);
end;
$$;

revoke execute on function import.merge_vacancies(uuid) from public, anon, authenticated;
revoke execute on function import.normalise_name(text) from public, anon, authenticated;

-- Companies House merge: the out-of-scope hide applies only to companies the
-- CH import itself added (added_by = 'companies_house'), and new CH companies
-- are tagged. Otherwise identical to 0006.
create or replace function import.merge_companies_house(p_run_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_run import.runs;
  v_staged int;
  v_live_imported int;
  v_updated int := 0;
  v_hidden int := 0;
  v_reactivated int := 0;
  v_linked int := 0;
  v_created int := 0;
  v_dissolved int := 0;
  v_sites int := 0;
  v_stats jsonb;
begin
  select * into v_run from import.runs where id = p_run_id for update;
  if not found then raise exception 'import run % not found', p_run_id; end if;
  if v_run.finished_at is not null then raise exception 'import run % already merged', p_run_id; end if;

  select count(*) into v_staged from import.ch_companies where run_id = p_run_id and in_scope;
  select count(*) into v_live_imported from public.companies
    where data_source = 'imported' and ch_number is not null and status = 'active';

  -- A truncated download must not dissolve half of England.
  if v_run.is_full and v_live_imported > 1000 and v_staged < v_live_imported * 0.9 then
    raise exception 'full run has % in-scope rows but % companies are live: refusing to merge',
      v_staged, v_live_imported;
  end if;

  -- Working copy of this run. Dropped at the end so the function can run
  -- more than once in a transaction (tests) without 'on commit drop' clashes.
  drop table if exists pg_temp.s;
  create temporary table s as
    select * from import.ch_companies where run_id = p_run_id;
  create index on s (ch_number);
  analyze s;

  -- 1. Existing companies matched on CH number ------------------------------
  with upd as (
    update public.companies c set
      sic_codes = s.sic_codes,
      ch_status = s.ch_status,
      ch_incorporated_on = s.incorporated_on,
      ch_synced_at = now(),
      name = case when c.data_source = 'imported' then s.name else c.name end,
      sectors = case when c.data_source = 'imported' then s.sectors else c.sectors end,
      keywords = case when c.data_source = 'imported' then s.keywords else c.keywords end,
      size_band = case when c.data_source = 'imported' or c.size_band = 'unknown'
                       then s.size_band else c.size_band end
    from s
    where c.ch_number = s.ch_number
    returning c.id
  )
  select count(*) into v_updated from upd;

  -- Hide companies that are no longer Active, or (imported only) out of scope.
  with h as (
    update public.companies c set
      status = 'hidden',
      status_reason = case when s.ch_status <> 'Active' then 'ch:' || s.ch_status else 'ch:out_of_scope' end
    from s
    where c.ch_number = s.ch_number
      and c.status = 'active'
      and (s.ch_status <> 'Active' or (not s.in_scope and c.added_by = 'companies_house'))
    returning c.id
  )
  select count(*) into v_hidden from h;

  -- Undo our own earlier hide once the company is back in scope.
  with r as (
    update public.companies c set status = 'active', status_reason = null
    from s
    where c.ch_number = s.ch_number
      and c.status in ('hidden', 'dissolved')
      and c.status_reason like 'ch:%'
      and s.ch_status = 'Active'
      and (s.in_scope or c.added_by is distinct from 'companies_house')
    returning c.id
  )
  select count(*) into v_reactivated from r;

  -- 2. Link curated / submitted records that have no CH number yet ----------
  -- Normalised name + registered-office postcode, and only when the match is
  -- unambiguous on both sides.
  with cand as (
    select s.ch_number, c.id as company_id
    from s
    join public.companies c
      on c.ch_number is null
     and c.name_normalised = trim(regexp_replace(
           regexp_replace(lower(s.name), '\m(ltd|limited|plc|llp|uk|the|group|co)\M', '', 'g'),
           '[^a-z0-9]+', ' ', 'g'))
    join public.company_sites cs
      on cs.company_id = c.id
     and replace(upper(cs.postcode), ' ', '') = replace(upper(s.postcode), ' ', '')
    where s.in_scope
      and not exists (select 1 from public.companies x where x.ch_number = s.ch_number)
    group by s.ch_number, c.id
  ),
  uniq as (
    select ch_number, company_id from cand
    where ch_number in (select ch_number from cand group by 1 having count(distinct company_id) = 1)
      and company_id in (select company_id from cand group by 1 having count(distinct ch_number) = 1)
  ),
  lnk as (
    update public.companies c set
      ch_number = s.ch_number,
      sic_codes = s.sic_codes,
      ch_status = s.ch_status,
      ch_incorporated_on = s.incorporated_on,
      ch_synced_at = now(),
      size_band = case when c.size_band = 'unknown' then s.size_band else c.size_band end
    from uniq join s using (ch_number)
    where c.id = uniq.company_id
    returning c.id
  )
  select count(*) into v_linked from lnk;

  -- 3. New companies ---------------------------------------------------------
  with ins as (
    insert into public.companies (
      name, ch_number, sic_codes, sectors, keywords, size_band, data_source, added_by,
      ch_status, ch_incorporated_on, ch_synced_at
    )
    select s.name, s.ch_number, s.sic_codes, s.sectors, s.keywords, s.size_band, 'imported', 'companies_house',
           s.ch_status, s.incorporated_on, now()
    from s
    where s.in_scope
      and s.ch_status = 'Active'
      and not exists (select 1 from public.companies c where c.ch_number = s.ch_number)
    returning id
  )
  select count(*) into v_created from ins;

  -- 4. Registered office sites and provenance --------------------------------
  with site as (
    insert into public.company_sites (company_id, kind, label, postcode, region, county, location)
    select c.id, 'registered_office', 'Registered office', s.postcode, s.region, s.county,
           extensions.st_setsrid(extensions.st_makepoint(s.lon, s.lat), 4326)::extensions.geography
    from s
    join public.companies c on c.ch_number = s.ch_number
    where s.lat is not null and s.lon is not null
    on conflict (company_id) where kind = 'registered_office' do update set
      postcode = excluded.postcode,
      region = excluded.region,
      county = excluded.county,
      location = excluded.location
    where company_sites.postcode is distinct from excluded.postcode
    returning 1
  )
  select count(*) into v_sites from site;

  insert into public.company_sources (company_id, field, url)
  select c.id, 'companies_house',
         'https://find-and-update.company-information.service.gov.uk/company/' || s.ch_number
  from s join public.companies c on c.ch_number = s.ch_number
  on conflict (company_id, field, url) do update set captured_at = now();

  -- 5. Full run: imported companies no longer in the snapshot are dissolved --
  if v_run.is_full then
    with d as (
      update public.companies c set status = 'dissolved', status_reason = 'ch:not_in_snapshot'
      where c.data_source = 'imported'
        and c.ch_number is not null
        and c.status <> 'dissolved'
        and (c.status_reason is null or c.status_reason like 'ch:%')
        and not exists (select 1 from s where s.ch_number = c.ch_number)
      returning c.id
    )
    select count(*) into v_dissolved from d;
  end if;

  v_stats := jsonb_build_object(
    'staged', (select count(*) from s),
    'in_scope', v_staged,
    'updated', v_updated,
    'hidden', v_hidden,
    'reactivated', v_reactivated,
    'linked_existing', v_linked,
    'created', v_created,
    'sites_written', v_sites,
    'dissolved', v_dissolved
  );

  drop table pg_temp.s;
  update import.runs set finished_at = now(), stats = v_stats where id = p_run_id;
  -- Staging is only needed until the merge has committed.
  delete from import.ch_companies where run_id = p_run_id;
  return v_stats;
end;
$$;

revoke execute on function import.merge_companies_house(uuid) from public, anon, authenticated;
