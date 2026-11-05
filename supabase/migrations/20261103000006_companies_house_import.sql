-- T Level Placement Finder: Companies House import, Phase 0.
--
-- The import script (scripts/companies-house/import.ts) streams the monthly
-- Free Company Data Product, filters it (engineering SIC codes from
-- data/sic-codes.csv, registered office in England, Active, not dormant),
-- geocodes postcodes and COPYs the rows into import.ch_companies. Then
-- import.merge_companies_house() folds them into public.companies in one
-- transaction.
--
-- Rules the merge follows:
--   * Match on CH number first, then normalised name + postcode against
--     records that have no CH number yet (curated or student-submitted).
--     CH has no website field, so the domain rule can't apply here.
--   * Companies House is the authority for CH number, SIC codes and company
--     status. It never overwrites curated content (name, summary, size band,
--     specialisms, T Level evidence) on a Verified or Student-submitted record.
--   * New companies are created as data_source 'imported', verified_at null.
--   * The registered office becomes a site of kind 'registered_office'. It is
--     where the company is registered, not necessarily where anyone works;
--     curated sites are kept separately and never touched.
--   * A company that is no longer Active at CH is hidden, with the reason in
--     status_reason. On a full run, an imported company missing from the
--     snapshot (which only lists live companies) is marked dissolved. Admin
--     decisions (status_reason not starting 'ch:') are never undone.

-- ---------------------------------------------------------------------------
-- Columns the import needs (proposed spec update, see phase0-schema-notes)
-- ---------------------------------------------------------------------------
create type public.site_kind as enum ('registered_office', 'operating_site');

alter table public.company_sites
  add column kind public.site_kind not null default 'operating_site';
create unique index company_sites_one_registered_office
  on public.company_sites (company_id) where kind = 'registered_office';

alter table public.companies
  add column status_reason text,
  add column ch_status text,
  add column ch_incorporated_on date,
  add column ch_synced_at timestamptz;

create unique index company_sources_dedupe on public.company_sources (company_id, field, url);

-- ---------------------------------------------------------------------------
-- Private import schema. Not in the API's exposed schemas (config.toml), and
-- locked down anyway: RLS on, no policies, no grants. Only the postgres /
-- service connection the import script uses can reach it.
-- ---------------------------------------------------------------------------
create schema if not exists import;
revoke all on schema import from public, anon, authenticated;

create table import.runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('companies_house', 'apprenticeship_vacancies')),
  file_name text not null,
  is_full boolean not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb
);

-- One row per company from the snapshot that is either in scope, or already
-- in public.companies (so the merge can see status and scope changes).
create table import.ch_companies (
  run_id uuid not null references import.runs (id) on delete cascade,
  ch_number text not null check (ch_number ~ '^[A-Z0-9]{8}$'),
  name text not null,
  ch_status text not null,
  in_scope boolean not null,
  sic_codes text[] not null default '{}',
  sectors text[] not null default '{}',
  keywords text[] not null default '{}',
  size_band public.size_band not null default 'unknown',
  incorporated_on date,
  postcode text,
  town text,
  region public.england_region,
  county text,
  lat double precision,
  lon double precision,
  primary key (run_id, ch_number)
);

alter table import.runs enable row level security;
alter table import.ch_companies enable row level security;
revoke all on all tables in schema import from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Merge
-- ---------------------------------------------------------------------------
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
      and (s.ch_status <> 'Active' or (not s.in_scope and c.data_source = 'imported'))
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
      and (s.in_scope or c.data_source <> 'imported')
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
      name, ch_number, sic_codes, sectors, keywords, size_band, data_source,
      ch_status, ch_incorporated_on, ch_synced_at
    )
    select s.name, s.ch_number, s.sic_codes, s.sectors, s.keywords, s.size_band, 'imported',
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
