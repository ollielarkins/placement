-- 0017 Accounts (Phase 2, step 1: sign-in)
--
-- Sign-in is optional: search, map and company pages never need it. An
-- account adds the profile, shortlist and tracker (later steps).
--
-- * A profile row is created for every new auth user (trigger below), empty
--   except the defaults. No date of birth is ever stored.
-- * Age: the service is for 16 and over (ICO Children's Code: T Levels start
--   at 16). After first sign-in the student confirms they are 16 or over;
--   age_confirmed_at records when. Until then account features stay locked
--   (public.account_ready()). Saying they are under 16 deletes the account.
-- * delete_my_account(): the student can delete their account and everything
--   tied to it at any time, from the account page.

alter table public.profiles
  add column age_confirmed_at timestamptz,
  add column privacy_notice_version text;

comment on column public.profiles.age_confirmed_at is
  'When the student confirmed they are 16 or over. No date of birth is stored.';
comment on column public.profiles.privacy_notice_version is
  'Version of the privacy notice shown when they confirmed (e.g. 2026-11-05).';

-- New auth user -> empty profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for anyone who signed up before this migration.
insert into public.profiles (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

-- True when the signed-in student has confirmed their age. Later steps use
-- it in RLS so account features stay locked until then.
create or replace function public.account_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.age_confirmed_at is not null
  );
$$;

revoke execute on function public.account_ready() from public, anon;
grant execute on function public.account_ready() to authenticated;

-- Confirm 16+ (and record which privacy notice they saw). Only sets the
-- caller's own row; once set it is not changed.
create or replace function public.confirm_age(p_privacy_notice_version text)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.profiles
     set age_confirmed_at = coalesce(age_confirmed_at, now()),
         privacy_notice_version = coalesce(privacy_notice_version, left(p_privacy_notice_version, 20))
   where user_id = (select auth.uid());
$$;

revoke execute on function public.confirm_age(text) from public, anon;
grant execute on function public.confirm_age(text) to authenticated;

-- Delete the caller's account. Cascades remove the profile, tracker items and
-- drafts; reviews and submissions keep their moderated text but lose the link
-- to the student (user_id set null, as the 0001 foreign keys say).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
