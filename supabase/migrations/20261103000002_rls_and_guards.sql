-- T Level Placement Finder: privileges, RLS policies and moderation guards.
-- Defence in depth: table privileges decide which columns a role may touch;
-- RLS decides which rows. Supabase grants ALL to anon/authenticated by
-- default, so we revoke and grant back only what each role needs.

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

-- Public reference data and companies: anyone may read.
grant select on public.tlevel_routes, public.colleges, public.companies,
  public.company_sites, public.company_sources, public.vacancies
  to anon, authenticated;

-- Admins write these through the app (RLS limits it to admins).
grant insert, update, delete on public.tlevel_routes, public.colleges, public.companies,
  public.company_sites, public.company_sources
  to authenticated;

-- Student-owned tables.
grant select, insert, update, delete on public.profiles, public.tracker_items to authenticated;
grant select, delete on public.outreach_drafts to authenticated;
grant update (subject, body) on public.outreach_drafts to authenticated;

-- Reviews: students may only set content. user_id defaults to auth.uid();
-- status and moderation are set by the moderation edge function or an admin.
grant select, delete on public.reviews to authenticated;
grant insert (company_id, tracker_item_id, ratings, body, tips) on public.reviews to authenticated;
grant update (status) on public.reviews to authenticated; -- admins only, via RLS

grant select on public.company_submissions to authenticated;
grant insert (payload) on public.company_submissions to authenticated;
grant update (status, matched_company_id) on public.company_submissions to authenticated; -- admins

grant select on public.reports to authenticated;
grant insert (target_type, target_id, reason) on public.reports to authenticated;
grant update (status) on public.reports to authenticated; -- admins

grant select on public.admin_audit_log to authenticated; -- admins, via RLS

-- ---------------------------------------------------------------------------
-- RLS: enable on every table
-- ---------------------------------------------------------------------------
alter table public.tlevel_routes enable row level security;
alter table public.colleges enable row level security;
alter table public.companies enable row level security;
alter table public.company_sites enable row level security;
alter table public.company_sources enable row level security;
alter table public.vacancies enable row level security;
alter table public.profiles enable row level security;
alter table public.tracker_items enable row level security;
alter table public.outreach_drafts enable row level security;
alter table public.reviews enable row level security;
alter table public.company_submissions enable row level security;
alter table public.reports enable row level security;
alter table public.admin_audit_log enable row level security;

-- Reference data -------------------------------------------------------------
create policy "routes: public read" on public.tlevel_routes
  for select to anon, authenticated using (true);
create policy "routes: admin write" on public.tlevel_routes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "colleges: public read" on public.colleges
  for select to anon, authenticated using (true);
create policy "colleges: admin write" on public.colleges
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Companies: hidden records are admin-only ------------------------------------
create policy "companies: public read" on public.companies
  for select to anon, authenticated using (status <> 'hidden' or (select public.is_admin()));
create policy "companies: admin write" on public.companies
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "sites: public read" on public.company_sites
  for select to anon, authenticated
  using (exists (select 1 from public.companies c where c.id = company_id));
create policy "sites: admin write" on public.company_sites
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "sources: public read" on public.company_sources
  for select to anon, authenticated
  using (exists (select 1 from public.companies c where c.id = company_id));
create policy "sources: admin write" on public.company_sources
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Vacancies: written only by the import job (service role).
create policy "vacancies: public read" on public.vacancies
  for select to anon, authenticated
  using (exists (select 1 from public.companies c where c.id = company_id));

-- Profiles: owner only. No public profiles, ever. ----------------------------
create policy "profiles: owner" on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Tracker: owner only ---------------------------------------------------------
create policy "tracker: owner" on public.tracker_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Outreach drafts: created by the edge function; owner reads, edits, deletes --
create policy "drafts: owner read" on public.outreach_drafts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "drafts: owner update" on public.outreach_drafts
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "drafts: owner delete" on public.outreach_drafts
  for delete to authenticated using (user_id = (select auth.uid()));

-- Reviews ---------------------------------------------------------------------
-- The base table is never public: anon has no grant. Public reads go through
-- the reviews_public view, which strips user_id.
create policy "reviews: owner read" on public.reviews
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Only for a company on the student's own tracker at Secured.
create policy "reviews: owner create for secured placement" on public.reviews
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.tracker_items t
      where t.id = tracker_item_id
        and t.user_id = (select auth.uid())
        and t.company_id = reviews.company_id
        and t.stage = 'secured'
    )
  );

create policy "reviews: owner delete" on public.reviews
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "reviews: admin moderate" on public.reviews
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Company submissions ---------------------------------------------------------
create policy "submissions: owner read" on public.company_submissions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "submissions: owner create" on public.company_submissions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "submissions: admin update" on public.company_submissions
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Reports: any signed-in user files one; admins read and resolve --------------
create policy "reports: signed-in create" on public.reports
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "reports: admin read" on public.reports
  for select to authenticated using ((select public.is_admin()));
create policy "reports: admin update" on public.reports
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "audit: admin read" on public.admin_audit_log
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Moderation guards
-- ---------------------------------------------------------------------------

-- Expected moderation verdict shape, written by the moderation edge function:
-- {
--   "verdict": "publish" | "hold" | "safeguarding",
--   "uncertain": bool,
--   "checks": { "personal_data", "names_individual", "abuse", "safeguarding",
--               "serious_claim", "spam", "not_real_placement" : bool },
--   "model": text, "screened_at": timestamptz, "reasons": [text]
-- }
-- Auto-publish (anyone other than an admin) needs a clean verdict. A
-- safeguarding flag is never auto-published and forces the review to held.
create or replace function public.guard_review_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.moderation, '{}'::jsonb);
  clean boolean;
begin
  if coalesce((m -> 'checks' ->> 'safeguarding')::boolean, false)
     or m ->> 'verdict' = 'safeguarding' then
    if new.status = 'published' and not public.is_admin() then
      new.status := 'held';
    end if;
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    clean := m ->> 'verdict' = 'publish'
      and coalesce((m ->> 'uncertain')::boolean, true) = false
      and coalesce((
        select bool_and(v = 'false'::jsonb)
        from jsonb_each(m -> 'checks') as e(k, v)
      ), false)
      and (m -> 'checks') ?& array['personal_data', 'names_individual', 'abuse',
                                   'safeguarding', 'serious_claim', 'spam', 'not_real_placement'];
    if not clean and not public.is_admin() then
      raise exception 'review % cannot be auto-published without a clean moderation verdict', new.id
        using errcode = '42501';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;

  if new.status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;
create trigger reviews_guard_status before insert or update of status, moderation
  on public.reviews for each row execute function public.guard_review_status();

-- Students always submit as pending, and the review carries their route
-- (needed for the public "route and year" attribution after anonymisation).
create or replace function public.review_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.status := 'pending';
    new.moderation := null;
  end if;
  if new.route_id is null and new.user_id is not null then
    select p.route_id into new.route_id from public.profiles p where p.user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger reviews_defaults before insert on public.reviews
  for each row execute function public.review_defaults();

-- Three reports from different users hide a published review until an admin
-- looks at it.
create or replace function public.auto_hide_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_type = 'review' and (
    select count(distinct r.user_id) from public.reports r
    where r.target_type = 'review' and r.target_id = new.target_id and r.status = 'open'
  ) >= 3 then
    update public.reviews
       set status = 'held',
           moderation = coalesce(moderation, '{}'::jsonb)
             || jsonb_build_object('auto_hidden', 'three_reports', 'auto_hidden_at', now())
     where id = new.target_id and status = 'published';
  end if;
  return null;
end;
$$;
create trigger reports_auto_hide after insert on public.reports
  for each row execute function public.auto_hide_reported();

-- Audit every write an admin makes through the app. Import jobs and edge
-- functions (service role, no auth.uid()) are not admin actions.
create or replace function public.audit_admin_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  if auth.uid() is not null and public.is_admin() then
    insert into public.admin_audit_log (actor, action, table_name, record_id, old_row, new_row)
    values (
      auth.uid(), lower(tg_op), tg_table_name, rec ->> 'id',
      case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    );
  end if;
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tlevel_routes', 'colleges', 'companies', 'company_sites',
                           'company_sources', 'reviews', 'company_submissions', 'reports']
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_admin_write()', t || '_audit', t);
  end loop;
end $$;

-- Trigger functions are not callable as RPCs.
revoke execute on function public.guard_review_status(), public.review_defaults(),
  public.auto_hide_reported(), public.audit_admin_write(), public.check_profile_specialism(),
  public.tracker_stage_change(), public.set_updated_at()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public reviews view
-- ---------------------------------------------------------------------------
-- Deliberately runs with the view owner's rights (not security_invoker) so it
-- can read published rows from a table anon cannot touch, while exposing no
-- user_id, tracker link or moderation data. Supabase's advisor will flag it as
-- a security-definer view; that is intended here.
create view public.reviews_public as
select
  r.id,
  r.company_id,
  rt.name as route_name,
  extract(year from coalesce(r.published_at, r.created_at))::int as year,
  r.ratings,
  r.body,
  r.tips,
  r.published_at
from public.reviews r
left join public.tlevel_routes rt on rt.id = r.route_id
join public.companies c on c.id = r.company_id and c.status <> 'hidden'
where r.status = 'published';

grant select on public.reviews_public to anon, authenticated;
