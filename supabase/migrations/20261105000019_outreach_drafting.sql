-- 0019 AI outreach drafting (Phase 3)
--
-- Drafts are written by the draft-outreach edge function (service role) and
-- belong to the student: they can read, edit (subject, body) and delete them
-- (0001/0002). This adds:
-- * outreach_requests: one row per drafting request, kept for the daily
--   limit even if the student deletes the draft. Not readable by students;
--   deleted with the account.
-- * outreach_quota(): how many drafts the signed-in student has left today.
-- * outreach_drafts.sent_at: set when the student says they've sent it.

create table public.outreach_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  channel public.outreach_channel not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index outreach_requests_user_time_idx on public.outreach_requests (user_id, created_at desc);
alter table public.outreach_requests enable row level security;
-- No policies: only the service role (edge function) reads or writes it.
revoke all on public.outreach_requests from anon, authenticated;

alter table public.outreach_drafts add column sent_at timestamptz;
grant update (sent_at) on public.outreach_drafts to authenticated;

create or replace function public.outreach_daily_limit()
returns integer language sql immutable as $$ select 10 $$;

create or replace function public.outreach_quota()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(0, public.outreach_daily_limit() - (
    select count(*)::int from public.outreach_requests r
    where r.user_id = (select auth.uid()) and r.created_at > now() - interval '24 hours'
  ));
$$;

revoke execute on function public.outreach_quota() from public, anon;
grant execute on function public.outreach_quota() to authenticated;
