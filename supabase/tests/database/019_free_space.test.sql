-- pgTAP tests: import.free_space() (migration 0028).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.companies (id, name, data_source) values
  ('e1900000-0000-0000-0000-00000000000a', 'Fixture Nineteen Checked', 'imported'),
  ('e1900000-0000-0000-0000-00000000000b', 'Fixture Nineteen Waiting', 'imported');
insert into import.contact_crawl (company_id, state, checked_at) values
  ('e1900000-0000-0000-0000-00000000000a', 'no_site', now() + interval '1 minute'),
  ('e1900000-0000-0000-0000-00000000000b', 'pending', null)
on conflict (company_id) do update set state = excluded.state, checked_at = excluded.checked_at;
insert into import.website_candidates (company_id, url, origin) values
  ('e1900000-0000-0000-0000-00000000000a', 'https://checked.example/', 'domain_list'),
  ('e1900000-0000-0000-0000-00000000000b', 'https://waiting.example/', 'domain_list'),
  ('e1900000-0000-0000-0000-00000000000a', 'https://advert.example/', 'faa_vacancy');

select ok((import.free_space() ->> 'domain_candidates_removed')::int >= 1, 'used domain-list candidates are removed');
select is((select count(*)::int from import.website_candidates where url = 'https://waiting.example/'), 1,
  'candidates not yet crawled are kept');
select is((select count(*)::int from import.website_candidates where url = 'https://advert.example/'), 1,
  'other candidate origins are kept');

select * from finish();
rollback;
