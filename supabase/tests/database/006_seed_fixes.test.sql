-- pgTAP tests: merge_seed() fixes in migration 0011.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

create function pg_temp.seed(p_name text) returns uuid
language plpgsql as $$
declare v_run uuid;
begin
  insert into import.runs (source, file_name, is_full) values ('curated_seed', 'test.csv', false)
  returning id into v_run;
  insert into import.seed_companies (run_id, file_name, row_no, name, takes_tlevel, tlevel_evidence_url,
    verified_at, sources)
  values (v_run, 'test.csv', 2, p_name, 'yes', 'https://example.test/tl', '2026-11-01',
          '[{"field":"company","url":"https://example.test/src"}]');
  return v_run;
end $$;

select import.merge_seed(pg_temp.seed('Fixture Keyless Public Body'));
select is((select added_by from public.companies where name = 'Fixture Keyless Public Body'), 'seed',
  'seed-created companies are tagged added_by = seed');

select import.merge_seed(pg_temp.seed('Fixture Keyless Public Body'));
select is((select count(*)::int from public.companies where name = 'Fixture Keyless Public Body'), 1,
  'a keyless curated row does not duplicate on re-run');
select is((select matched_on from import.seed_results r join import.runs u on u.id = r.run_id
           order by u.started_at desc, r.matched_on nulls last limit 1), 'name_curated',
  'second run matched on the curated name');

-- The fallback never captures an imported company with the same name.
insert into public.companies (name, ch_number, data_source) values ('FIXTURE NAMESAKE LTD', 'NS000001', 'imported');
select import.merge_seed(pg_temp.seed('Fixture Namesake Ltd'));
select is((select count(*)::int from public.companies where name_normalised = 'fixture namesake'), 2,
  'name-only fallback is limited to curated records without a CH number');

select * from finish();
rollback;
