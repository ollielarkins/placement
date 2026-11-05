-- pgTAP tests: accounts (migration 0017).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000000a1', 'one@example.org'),
  ('b0000000-0000-0000-0000-0000000000a2', 'two@example.org');

select is((select count(*)::int from public.profiles where user_id in
  ('b0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a2')),
  2, 'every new user gets a profile row');
select ok((select age_confirmed_at is null from public.profiles where user_id = 'b0000000-0000-0000-0000-0000000000a1'),
  'age not confirmed until the student says so');

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok(not public.account_ready(), 'account features locked before confirming');
select lives_ok($$select public.confirm_age('2026-11-05')$$, 'student confirms 16 or over');
select ok(public.account_ready(), 'account ready after confirming');
select is((select privacy_notice_version from public.profiles where user_id = 'b0000000-0000-0000-0000-0000000000a1'),
  '2026-11-05', 'privacy notice version recorded');

-- Student 2 deletes their own account; student 1 is untouched.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.delete_my_account()$$, 'student deletes own account');
reset role;
select is((select count(*)::int from auth.users where id = 'b0000000-0000-0000-0000-0000000000a2'), 0,
  'deleted user and profile are gone');

set local role anon;
select throws_ok($$select public.delete_my_account()$$, '42501', null, 'anon cannot call delete_my_account');

select * from finish();
rollback;
