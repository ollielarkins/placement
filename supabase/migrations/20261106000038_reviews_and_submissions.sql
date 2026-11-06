-- 0038: reviews, company submissions and reports go live (Phase 4, 06/11/2026).
--
-- The tables, RLS and moderation guards exist since 0001/0002. This adds:
-- * admin_alerts: safeguarding flags (and other things an admin must see),
--   written by the moderate-post edge function. Admins only.
-- * company_submissions: payload checked and tidied on insert, a limit of 5 a
--   day per student, a ready account (age confirmed), and automatic matching
--   to a company we already hold (website domain, else exact normalised
--   name) - "Companies House matching and de-duplication run automatically".
-- * reviews: a ready account is needed to write one; my_review_status() for
--   the company page's "write a review" prompt.
-- * reports: a ready account; a reason from a fixed list plus optional words.
-- * admin_create_company(submission): turns a checked submission into a
--   Student-submitted company. Admins only; logged by the audit trigger.
-- * company_review_summary(company): count and average ratings of published
--   reviews, for the company page.

-- ---------------------------------------------------------------------------
-- Admin alerts
-- ---------------------------------------------------------------------------
create table public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('safeguarding', 'moderation_failed')),
  target_type text not null check (target_type in ('review', 'submission')),
  target_id uuid not null,
  message text not null check (length(message) <= 2000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index admin_alerts_open_idx on public.admin_alerts (created_at desc) where resolved_at is null;
alter table public.admin_alerts enable row level security;
create policy "alerts: admin read" on public.admin_alerts
  for select to authenticated using ((select public.is_admin()));
create policy "alerts: admin resolve" on public.admin_alerts
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, update (resolved_at, resolved_by) on public.admin_alerts to authenticated;

-- ---------------------------------------------------------------------------
-- Ready accounts only
-- ---------------------------------------------------------------------------
drop policy "reviews: owner create for secured placement" on public.reviews;
create policy "reviews: owner create for secured placement" on public.reviews
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.account_ready())
    and exists (
      select 1 from public.tracker_items t
      where t.id = tracker_item_id
        and t.user_id = (select auth.uid())
        and t.company_id = reviews.company_id
        and t.stage = 'secured'
    )
  );

drop policy "submissions: owner create" on public.company_submissions;
create policy "submissions: owner create" on public.company_submissions
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.account_ready()));

drop policy "reports: signed-in create" on public.reports;
create policy "reports: signed-in create" on public.reports
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.account_ready()));

-- ---------------------------------------------------------------------------
-- Submissions: tidy, limit, match
-- ---------------------------------------------------------------------------
-- payload = { name, website?, location?, why? } (strings). Anything else is dropped.
create or replace function public.submission_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb := new.payload;
  v_name text := left(trim(coalesce(p ->> 'name', '')), 200);
  v_site text := nullif(left(trim(coalesce(p ->> 'website', '')), 300), '');
  v_where text := nullif(left(trim(coalesce(p ->> 'location', '')), 100), '');
  v_why text := nullif(left(trim(coalesce(p ->> 'why', '')), 1000), '');
  v_dom text;
  v_ids uuid[];
begin
  if length(v_name) < 2 then
    raise exception 'company name is required' using errcode = '23514';
  end if;
  if v_site is not null and v_site !~* '^https?://' then v_site := 'https://' || v_site; end if;
  if v_site is not null and v_site !~* '^https?://[a-z0-9.-]+\.[a-z]{2,}(/\S*)?$' then
    raise exception 'website does not look like a web address' using errcode = '23514';
  end if;
  if auth.uid() is not null and not public.is_admin() and (
    select count(*) from public.company_submissions s
    where s.user_id = auth.uid() and s.created_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception 'too many suggestions today (5)' using errcode = '54000';
  end if;

  new.payload := jsonb_strip_nulls(jsonb_build_object('name', v_name, 'website', v_site, 'location', v_where, 'why', v_why));
  if auth.uid() is not null and not public.is_admin() then
    new.status := 'pending';
    new.moderation := null;
    new.matched_company_id := null;
  end if;

  -- Already listed? Website domain first, then the exact normalised name.
  v_dom := lower(substring(v_site from '^https?://(?:www\.)?([^/:?#]+)'));
  if v_dom is not null then
    v_ids := array(select id from public.companies where website_domain = v_dom and status <> 'hidden');
  end if;
  if coalesce(cardinality(v_ids), 0) <> 1 then
    v_ids := array(select id from public.companies
                   where name_normalised = import.normalise_name(v_name) and status <> 'hidden');
  end if;
  if cardinality(v_ids) = 1 then
    new.matched_company_id := v_ids[1];
    new.status := 'matched';
  end if;
  return new;
end;
$$;
create trigger company_submissions_prepare before insert on public.company_submissions
  for each row execute function public.submission_prepare();
revoke execute on function public.submission_prepare() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports: a reason from a fixed list
-- ---------------------------------------------------------------------------
alter table public.reports add constraint reports_reason_kind check (
  reason ~ '^(personal_info|untrue|offensive|safeguarding|spam|wrong_info|closed|other)(: .+)?$'
);

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
create or replace function public.company_review_summary(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'overall', round(avg((ratings ->> 'overall')::numeric), 1),
    'learning', round(avg((ratings ->> 'learning')::numeric), 1),
    'support', round(avg((ratings ->> 'support')::numeric), 1),
    'route_onward', round(avg((ratings ->> 'route_onward')::numeric), 1))
  from reviews_public where company_id = p_company;
$$;
grant execute on function public.company_review_summary(uuid) to anon, authenticated;

-- For the signed-in student on a company page: can they review it, and have they?
create or replace function public.my_review_status(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'tracker_item_id', (select t.id from tracker_items t
                        where t.user_id = (select auth.uid()) and t.company_id = p_company and t.stage = 'secured'
                        limit 1),
    'review', (select jsonb_build_object('id', r.id, 'status', r.status) from reviews r
               where r.user_id = (select auth.uid()) and r.company_id = p_company
               order by r.created_at desc limit 1));
$$;
revoke execute on function public.my_review_status(uuid) from public, anon;
grant execute on function public.my_review_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: create a company from a submission
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_company(p_submission uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.company_submissions;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into s from public.company_submissions where id = p_submission for update;
  if not found then raise exception 'submission not found'; end if;
  if s.status not in ('pending', 'matched') then raise exception 'submission already handled'; end if;

  insert into public.companies (name, website, data_source, added_by, summary)
  values (s.payload ->> 'name', s.payload ->> 'website', 'student_submitted', 'submission',
          nullif(left(s.payload ->> 'why', 600), ''))
  returning id into v_id;
  if s.payload ->> 'website' is not null then
    insert into public.company_sources (company_id, field, url)
    values (v_id, 'website', s.payload ->> 'website') on conflict do nothing;
  end if;
  update public.company_submissions set status = 'created', matched_company_id = v_id where id = p_submission;
  return v_id;
end;
$$;
revoke execute on function public.admin_create_company(uuid) from public, anon;
grant execute on function public.admin_create_company(uuid) to authenticated;
