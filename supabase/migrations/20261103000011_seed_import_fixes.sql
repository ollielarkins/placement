-- Curated seed import fixes (03/11/2026), found filling in CH numbers and
-- sites for the first research pass:
--
-- 1. Idempotency: a row with no CH number, site or website (public bodies
--    such as an NHS trust or a military unit) had no dedupe key, so every
--    re-run created another copy. merge_seed() now falls back to the single
--    curated record with the same normalised name and no CH number.
-- 2. Rows created by the seed import are tagged added_by = 'seed'.
-- 3. One-off clean-up: the first load created keyless curated records for
--    companies whose CSV rows now carry a CH number (or a site/website) and
--    so match the existing Companies House record instead. Those orphans are
--    removed, but only if nothing student-owned points at them. On a database
--    where the first load never ran, this deletes nothing.

update public.companies set added_by = 'seed'
where data_source = 'verified' and added_by is null and ch_number is null;

delete from public.companies c
where c.data_source = 'verified'
  and c.ch_number is null
  and c.name in (
    'Thales (Crawley)', 'Southeastern (Ramsgate Depot)', 'R&B Switchgear Group', 'Sellafield Ltd',
    'Leyland Trucks', 'Teledyne e2v', 'Britcom', 'Rotamec', 'Albert Jagger',
    'Procter & Chester Measurements (PCM)', 'HC Controls'
  )
  and not exists (select 1 from public.tracker_items t where t.company_id = c.id)
  and not exists (select 1 from public.reviews v where v.company_id = c.id)
  and not exists (select 1 from public.outreach_drafts d where d.company_id = c.id)
  and not exists (select 1 from public.company_submissions s where s.matched_company_id = c.id);

-- Keyless duplicates from repeated runs: keep the oldest per name.
delete from public.companies c
using public.companies k
where c.data_source = 'verified' and k.data_source = 'verified'
  and c.ch_number is null and k.ch_number is null
  and c.name_normalised = k.name_normalised
  and (c.created_at, c.id) > (k.created_at, k.id)
  and not exists (select 1 from public.tracker_items t where t.company_id = c.id)
  and not exists (select 1 from public.reviews v where v.company_id = c.id);

create or replace function import.merge_seed(p_run_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_run import.runs;
  r import.seed_companies;
  v_by_ch uuid;
  v_by_name uuid[];
  v_by_domain uuid[];
  v_ids uuid[];
  v_id uuid;
  v_on text;
  v_norm text;
  v_domain text;
  v_postcodes text[];
  v_by_vname uuid[];
begin
  select * into v_run from import.runs where id = p_run_id for update;
  if not found then raise exception 'import run % not found', p_run_id; end if;
  if v_run.source <> 'curated_seed' then raise exception 'run % is not a curated_seed run', p_run_id; end if;
  if v_run.finished_at is not null then raise exception 'import run % already merged', p_run_id; end if;

  for r in
    select * from import.seed_companies where run_id = p_run_id order by file_name, row_no
  loop
    -- Same normalisation as the generated columns on public.companies.
    v_norm := trim(regexp_replace(
      regexp_replace(lower(r.name), '\m(ltd|limited|plc|llp|uk|the|group|co)\M', '', 'g'),
      '[^a-z0-9]+', ' ', 'g'));
    v_domain := nullif(regexp_replace(lower(r.website), '^https?://(www\.)?([^/:?#]+).*$', '\2'), lower(r.website));
    v_postcodes := array(
      select replace(upper(s ->> 'postcode'), ' ', '') from jsonb_array_elements(r.sites) s
      where s ->> 'postcode' is not null
    );

    v_by_ch := null;
    if r.ch_number is not null then
      select id into v_by_ch from public.companies where ch_number = r.ch_number;
    end if;

    v_by_name := array(
      select distinct c.id from public.companies c
      join public.company_sites cs on cs.company_id = c.id
      where c.name_normalised = v_norm
        and replace(upper(cs.postcode), ' ', '') = any (v_postcodes)
    );
    v_by_domain := case when v_domain is null then '{}'::uuid[] else array(
      select id from public.companies where website_domain = v_domain
    ) end;

    v_ids := array(
      select distinct x from unnest(array[v_by_ch] || v_by_name || v_by_domain) x where x is not null
    );

    if cardinality(v_ids) > 1 then
      insert into import.seed_results (run_id, file_name, row_no, action, message)
      values (p_run_id, r.file_name, r.row_no, 'rejected',
        format('matches %s existing companies (CH number, name + postcode and domain disagree): %s',
               cardinality(v_ids), array_to_string(v_ids, ', ')));
      continue;
    end if;

    -- The CH number would collide with a different record: also reject.
    if cardinality(v_ids) = 1 and r.ch_number is not null and v_by_ch is null and exists (
      select 1 from public.companies where id = v_ids[1] and ch_number is not null and ch_number <> r.ch_number
    ) then
      insert into import.seed_results (run_id, file_name, row_no, action, company_id, message)
      values (p_run_id, r.file_name, r.row_no, 'rejected', v_ids[1],
        'matched on name/domain, but that company has a different CH number');
      continue;
    end if;

    v_on := case
      when v_by_ch is not null then 'ch_number'
      when cardinality(v_by_name) = 1 then 'name_postcode'
      when cardinality(v_by_domain) = 1 then 'domain'
    end;

    -- 4. A curated row with no CH number, site or website (e.g. a public body)
    --    has no other key: match the one curated record with the same
    --    normalised name and no CH number, so re-runs don't duplicate it.
    if cardinality(v_ids) = 0 then
      v_by_vname := array(
        select id from public.companies
        where data_source = 'verified' and ch_number is null and name_normalised = v_norm
      );
      if cardinality(v_by_vname) = 1 then
        v_ids := v_by_vname;
        v_on := 'name_curated';
      end if;
    end if;

    if cardinality(v_ids) = 0 then
      insert into public.companies (
        name, ch_number, website, summary, size_band, sectors, keywords, specialisms,
        takes_tlevel, tlevel_evidence_url, routes_onward, placement_patterns, accepts_under_18,
        early_careers_programme, trade_bodies, how_to_apply, data_source, verified_at, added_by
      ) values (
        r.name, r.ch_number, r.website, r.summary, coalesce(r.size_band, 'unknown'),
        coalesce(r.sectors, '{}'), coalesce(r.keywords, '{}'), coalesce(r.specialisms, '{}'),
        coalesce(r.takes_tlevel, 'unknown'), r.tlevel_evidence_url, coalesce(r.routes_onward, '{}'),
        coalesce(r.placement_patterns, '{}'), coalesce(r.accepts_under_18, 'unknown'),
        coalesce(r.early_careers_programme, false), coalesce(r.trade_bodies, '{}'), r.how_to_apply,
        'verified', r.verified_at, 'seed'
      ) returning id into v_id;
    else
      v_id := v_ids[1];
      update public.companies c set
        name = r.name,
        ch_number = coalesce(c.ch_number, r.ch_number),
        website = coalesce(r.website, c.website),
        summary = coalesce(r.summary, c.summary),
        size_band = coalesce(r.size_band, c.size_band),
        sectors = coalesce(r.sectors, c.sectors),
        keywords = coalesce(r.keywords, c.keywords),
        specialisms = coalesce(r.specialisms, c.specialisms),
        takes_tlevel = coalesce(r.takes_tlevel, c.takes_tlevel),
        tlevel_evidence_url = coalesce(r.tlevel_evidence_url, c.tlevel_evidence_url),
        routes_onward = coalesce(r.routes_onward, c.routes_onward),
        placement_patterns = coalesce(r.placement_patterns, c.placement_patterns),
        accepts_under_18 = coalesce(r.accepts_under_18, c.accepts_under_18),
        early_careers_programme = coalesce(r.early_careers_programme, c.early_careers_programme),
        trade_bodies = coalesce(r.trade_bodies, c.trade_bodies),
        how_to_apply = coalesce(r.how_to_apply, c.how_to_apply),
        data_source = 'verified',
        verified_at = r.verified_at,
        -- New T Level evidence re-opens a company marked as not taking
        -- placements. Hidden and dissolved are left alone (admin / CH decide).
        status = case when c.status = 'not_taking_placements' and r.takes_tlevel = 'yes'
                      then 'active' else c.status end
      where c.id = v_id;
    end if;

    if jsonb_array_length(r.sites) > 0 then
      delete from public.company_sites where company_id = v_id and kind = 'operating_site';
      insert into public.company_sites (company_id, kind, label, postcode, region, county, location)
      select v_id, 'operating_site', s ->> 'label', s ->> 'postcode',
             (s ->> 'region')::public.england_region, s ->> 'county',
             extensions.st_setsrid(extensions.st_makepoint((s ->> 'lon')::float8, (s ->> 'lat')::float8), 4326)::extensions.geography
      from jsonb_array_elements(r.sites) s;
    end if;

    insert into public.company_sources (company_id, field, url)
    select v_id, s ->> 'field', s ->> 'url' from jsonb_array_elements(r.sources) s
    on conflict (company_id, field, url) do update set captured_at = now();

    insert into import.seed_results (run_id, file_name, row_no, action, matched_on, company_id)
    values (p_run_id, r.file_name, r.row_no,
            case when v_on is null then 'created' else 'updated' end, v_on, v_id);
  end loop;

  delete from import.seed_companies where run_id = p_run_id;
  update import.runs set finished_at = now(), stats = (
    select jsonb_object_agg(action, n) from (
      select action, count(*) as n from import.seed_results where run_id = p_run_id group by action
    ) t
  ) where id = p_run_id;
  return (select stats from import.runs where id = p_run_id);
end;
$$;

revoke execute on function import.merge_seed(uuid) from public, anon, authenticated;
