-- pgTAP tests: outreach drafting rules (migration 0019).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('d0000000-0000-0000-0000-0000000000a1', 'drafts@example.org');
insert into public.companies (id, name, data_source) values ('d0000000-0000-0000-0000-00000000000c', 'Fixture Thirteen', 'imported');
insert into public.outreach_requests (user_id, company_id, channel, ok)
select 'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-00000000000c', 'email', true from generate_series(1, 3);
insert into public.outreach_requests (user_id, company_id, channel, ok, created_at)
values ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-00000000000c', 'email', true, now() - interval '2 days');
insert into public.outreach_drafts (id, user_id, company_id, channel, subject, body) values
  ('d0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-00000000000c',
   'email', 'T Level placement enquiry', 'Dear [Name], ...');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(public.outreach_quota(), 7, 'quota counts the last 24 hours only');
select throws_ok('select count(*) from public.outreach_requests', '42501', null, 'students cannot read the request log');
select throws_ok($$insert into public.outreach_drafts (user_id, company_id, channel, body)
  values ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-00000000000c', 'email', 'x')$$,
  '42501', null, 'students cannot create drafts directly (only the edge function)');
select lives_ok($$update public.outreach_drafts set body = 'edited', sent_at = now() where id = 'd0000000-0000-0000-0000-0000000000d1'$$,
  'student edits a draft and marks it sent');
select throws_ok($$update public.outreach_drafts set model = 'x' where id = 'd0000000-0000-0000-0000-0000000000d1'$$,
  '42501', null, 'other draft columns are read-only');

select * from finish();
rollback;
