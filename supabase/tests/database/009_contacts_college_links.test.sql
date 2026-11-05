-- pgTAP tests: organisation contacts and college links (migration 0015).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into public.companies (id, name, data_source) values
  ('90000000-0000-0000-0000-00000000000a', 'Fixture Nine Contacts', 'imported');
insert into public.colleges (id, name) values
  ('90000000-0000-0000-0000-0000000000c1', 'Fixture Nine College');

-- Named people and mobiles are refused by the table itself.
select lives_ok($$insert into public.company_contacts (company_id, kind, purpose, value, source_url, method)
  values ('90000000-0000-0000-0000-00000000000a', 'email', 'careers', 'careers@fixture.co.uk', 'https://fixture.co.uk/careers', 'crawler')$$,
  'role mailbox accepted');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('90000000-0000-0000-0000-00000000000a', 'email', 'jane.smith@fixture.co.uk', 'https://fixture.co.uk', 'crawler')$$,
  '23514', null, 'named-person email refused');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('90000000-0000-0000-0000-00000000000a', 'email', 'jsmith@fixture.co.uk', 'https://fixture.co.uk', 'crawler')$$,
  '23514', null, 'initial-and-surname email refused');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('90000000-0000-0000-0000-00000000000a', 'phone', '07700 900123', 'https://fixture.co.uk', 'crawler')$$,
  '23514', null, 'mobile number refused');
select lives_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('90000000-0000-0000-0000-00000000000a', 'phone', '01525 841000', 'https://fixture.co.uk/contact', 'crawler')$$,
  'landline accepted');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('90000000-0000-0000-0000-00000000000a', 'careers_page', 'javascript:alert(1)', 'https://fixture.co.uk', 'crawler')$$,
  '23514', null, 'page contacts must be http(s) URLs');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method, hidden)
  values ('90000000-0000-0000-0000-00000000000a', 'contact_form', 'https://fixture.co.uk/contact', 'https://fixture.co.uk', 'crawler', true)$$,
  '23514', null, 'hiding needs a reason');
insert into public.company_contacts (company_id, kind, value, source_url, method, hidden, hidden_reason)
  values ('90000000-0000-0000-0000-00000000000a', 'contact_form', 'https://fixture.co.uk/contact', 'https://fixture.co.uk', 'crawler', true, 'removal request');

insert into public.company_college_links (company_id, college_id, kind, source_url, method) values
  ('90000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000c1', 'tlevel_placements', 'https://fixture.ac.uk/news', 'crawler');

select is(public.college_link_label('tlevel_placements', 'X College', false), 'Has hosted T Level students from X College', 'T Level wording');
select is(public.college_link_label('partner', 'X College', true), 'Takes placements mainly from X College', '"mainly" only from the flag');
select is(public.college_link_label('apprenticeships', 'X College', false), 'Trains apprentices with X College', 'apprenticeship wording');

set local role anon;

select is((select count(*)::int from public.company_contacts where company_id = '90000000-0000-0000-0000-00000000000a'),
  2, 'anon sees visible contacts, not hidden ones');
select is(
  (select jsonb_array_length(public.company_detail('90000000-0000-0000-0000-00000000000a') -> 'contacts')),
  2, 'company_detail lists visible contacts');
select is(
  (select public.company_detail('90000000-0000-0000-0000-00000000000a') -> 'colleges' -> 0 ->> 'label'),
  'Has hosted T Level students from Fixture Nine College', 'company_detail carries the college label');
select is(
  (select label from public.college_tags(array['90000000-0000-0000-0000-00000000000a'::uuid])),
  'Has hosted T Level students from Fixture Nine College', 'college_tags for a results page');
select throws_ok($$insert into public.company_contacts (company_id, kind, value, source_url, method)
  values ('90000000-0000-0000-0000-00000000000a', 'email', 'info@fixture.co.uk', 'https://fixture.co.uk', 'crawler')$$,
  '42501', null, 'anon cannot write contacts');
select throws_ok('select count(*) from import.contact_crawl', '42501', null, 'anon cannot read the crawl queue');

select * from finish();
rollback;
