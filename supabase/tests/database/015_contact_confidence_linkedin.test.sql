-- pgTAP tests: name-match confidence and LinkedIn company pages (migration 0022).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.companies (id, name, data_source, sic_codes) values
  ('e1500000-0000-0000-0000-00000000000a', 'Fixture Fifteen Ltd', 'imported', array['27110']);

select lives_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('e1500000-0000-0000-0000-00000000000a', 'linkedin', 'https://www.linkedin.com/company/fixture-fifteen/', 'https://fixturefifteen.co.uk/', 'crawler')$$,
  'a LinkedIn company page is accepted');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('e1500000-0000-0000-0000-00000000000a', 'linkedin', 'https://www.linkedin.com/in/jane-smith/', 'https://fixturefifteen.co.uk/', 'crawler')$$,
  '23514', null, 'a personal LinkedIn profile is refused');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('e1500000-0000-0000-0000-00000000000a', 'linkedin', 'https://evil.example/company/x/', 'https://fixturefifteen.co.uk/', 'crawler')$$,
  '23514', null, 'a non-LinkedIn URL is refused for kind linkedin');
select lives_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method, confidence)
  values ('e1500000-0000-0000-0000-00000000000a', 'website', 'https://fixturefifteen.co.uk/', 'https://fixturefifteen.co.uk/', 'crawler', 'name_match')$$,
  'a crawled name-match website is accepted');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method, confidence)
  values ('e1500000-0000-0000-0000-00000000000a', 'contact_page', 'https://fixturefifteen.co.uk/contact', 'https://fixturefifteen.co.uk/', 'curated', 'name_match')$$,
  '23514', null, 'only crawled contacts can be name matches');

set local role anon;
select is((select array_agg(x ->> 'confidence' order by x ->> 'kind')
           from jsonb_array_elements(public.company_detail('e1500000-0000-0000-0000-00000000000a') -> 'contacts') x),
  array['confirmed', 'name_match'], 'company_detail returns confidence');
select is((select (x ->> 'kind') from jsonb_array_elements(public.company_detail('e1500000-0000-0000-0000-00000000000a') -> 'contacts') x limit 1),
  'linkedin', 'confirmed contacts are listed before name matches');

select * from finish();
rollback;
