-- 0028: free database space without losing anything in use (06/11/2026).
--
-- * company_sources_company_idx (company_id, field) duplicates the leading
--   columns of the unique company_sources_dedupe (company_id, field, url),
--   which serves the same lookups.
-- * import.free_space(): deletes domain-list website candidates for companies
--   the crawler has already checked since the candidate was added (they've
--   been used), and empties the import staging tables, which are refilled by
--   each import run and only read during it.
-- Deleting doesn't shrink files on disk. Afterwards, in the SQL editor (it
-- can't run inside a migration; each table is locked for a few seconds):
--   select import.free_space();
--   vacuum full import.website_candidates, import.contact_crawl, public.company_contacts,
--               public.companies, public.company_sources, public.company_sites;

drop index if exists public.company_sources_company_idx;

create or replace function import.free_space()
returns jsonb
language plpgsql
security definer
set search_path = public, import, pg_temp
as $$
declare
  v_candidates bigint;
begin
  delete from import.website_candidates w
  using import.contact_crawl q
  where q.company_id = w.company_id
    and w.origin = 'domain_list'
    and q.state in ('done', 'no_site')
    and q.checked_at > w.added_at;
  get diagnostics v_candidates = row_count;

  -- Staging rows are only read while their import run is merging.
  truncate import.ch_companies, import.faa_vacancies, import.seed_companies;

  return jsonb_build_object('domain_candidates_removed', v_candidates, 'staging_emptied', true);
end;
$$;
revoke execute on function import.free_space() from public, anon, authenticated;
