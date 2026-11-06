-- pgTAP tests: home page figures (migration 0027).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.companies (id, name, data_source) values ('e1800000-0000-0000-0000-00000000000a', 'Fixture Eighteen Ltd', 'imported');
insert into public.company_contacts (company_id, kind, value, source_url, method)
values ('e1800000-0000-0000-0000-00000000000a', 'email', 'careers@fixture18.co.uk', 'https://fixture18.co.uk/', 'crawler');
select public.refresh_read_models();

set local role anon;
select ok((public.site_stats() ->> 'employers')::int >= 1, 'counts employers');
select ok((public.site_stats() ->> 'employers_with_contacts')::int >= 1, 'counts employers with a contact');
select throws_ok($$select * from cache.site_stats$$, '42501', null, 'the cache itself is not readable by the public');

select * from finish();
rollback;
