-- 0015 Organisation contacts and college links (Phase 1, decided 04/11/2026)
--
-- Contacts: organisation routes only (careers or apply pages, a contact page
-- or form, role mailboxes such as careers@ or info@, switchboard numbers).
-- Never named staff. The table enforces that itself:
--   * emails must have a role local part (public.is_role_email), so
--     jane.smith@ or jsmith@ is rejected even if a script tries to write it;
--   * phone numbers must not be UK mobiles (07 / +447), which usually reach
--     one person.
-- Every contact carries the page it was found on (source_url), how it was
-- found (method) and when it was last seen. verified_at is set only when a
-- person has checked it.
--
-- College links: evidence that an employer works with a college, with the
-- wording driven by what the source says (public.college_link_label).
-- "Mainly" or "only" appears only when mainly_from_this_college is set,
-- which needs a source that says so.
--
-- Also adds the private work tables for the website/contact crawler
-- (scripts/contacts/crawl-contacts.ts): import.website_candidates and
-- import.contact_crawl.

-- ---------------------------------------------------------------------------
-- Guards used by the check constraints
-- ---------------------------------------------------------------------------

-- Role mailboxes we accept. Anything else (a person's name, initials) is
-- treated as a named individual and refused.
create or replace function public.is_role_email(p_email text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p_email ~* ('^(info|information|enquiries|enquiry|enquire|hello|contact|contactus|contact-us|contact_us'
      || '|office|admin|administration|reception|general|mail|email'
      || '|careers|career|jobs|job|recruitment|recruiting|recruit|vacancies|vacancy|talent|people|hr|humanresources'
      || '|apprenticeships|apprenticeship|apprentices|apprentice|earlycareers|early-careers|early\.careers|early_careers'
      || '|graduates|graduate|emerging-talent|emergingtalent|futuretalent|future-talent'
      || '|placements|placement|workexperience|work-experience|work\.experience|students|student'
      || '|education|schools|outreach|stem|skills|training|academy'
      || '|sales|customerservice|customer-services|customerservices|customer\.services|service|services|support|team'
      || ')([._-]?(uk|gb|team|dept|enquiries|[0-9]{1,3}))?@[a-z0-9.-]+\.[a-z]{2,}$')
$$;

comment on function public.is_role_email(text) is
  'True for role mailboxes (careers@, info@, early-careers@ ...). Named-person addresses return false.';

-- Accept UK landline, 03, 08 and international non-mobile numbers. Reject
-- UK mobiles. Input is the display form; spaces, brackets and dashes allowed.
create or replace function public.is_org_phone(p_phone text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p_phone ~ '^\+?[0-9 ()-]{9,20}$'
     and regexp_replace(p_phone, '[^0-9+]', '', 'g') !~ '^(07|\+447|\+4407|00447|004407|447)'
$$;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.contact_kind as enum (
  'website', 'careers_page', 'apply_page', 'contact_page', 'contact_form', 'email', 'phone'
);
create type public.contact_purpose as enum (
  'general', 'careers', 'early_careers', 'apprenticeships', 'placements', 'hr'
);
create type public.evidence_method as enum (
  'curated', 'crawler', 'vacancy_import', 'student_submitted'
);
create type public.college_link_kind as enum (
  'tlevel_placements',      -- source says it hosted T Level students from the college
  'industry_placements',    -- hosted placement students from the college (not stated as T Level)
  'apprenticeships',        -- trains apprentices with the college
  'partner'                 -- named partner employer (employer board, partner list)
);

-- ---------------------------------------------------------------------------
-- company_contacts
-- ---------------------------------------------------------------------------
create table public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.contact_kind not null,
  purpose public.contact_purpose not null default 'general',
  value text not null,
  label text,
  source_url text not null,
  method public.evidence_method not null,
  verified_at timestamptz,
  found_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  hidden boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_contacts_unique unique (company_id, kind, value),
  constraint contact_value_shape check (
    case kind
      when 'email' then public.is_role_email(value)
      when 'phone' then public.is_org_phone(value)
      else value ~ '^https?://[^\s]+$' and length(value) <= 2048
    end
  ),
  constraint contact_source_is_url check (source_url ~ '^https?://[^\s]+$'),
  constraint contact_label_length check (label is null or length(label) <= 120),
  constraint contact_hidden_reason check (not hidden or hidden_reason is not null)
);

comment on table public.company_contacts is
  'Organisation contact routes for a company. Never named individuals: emails must pass is_role_email, phones is_org_phone.';

create index company_contacts_company_idx on public.company_contacts (company_id) where not hidden;

create trigger company_contacts_touch before update on public.company_contacts
  for each row execute function public.set_updated_at();

alter table public.company_contacts enable row level security;

create policy "contacts: public read" on public.company_contacts
  for select to anon, authenticated
  using ((not hidden and exists (select 1 from public.companies c where c.id = company_id))
         or (select public.is_admin()));
create policy "contacts: admin write" on public.company_contacts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- company_college_links
-- ---------------------------------------------------------------------------
create table public.company_college_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  college_id uuid not null references public.colleges (id) on delete cascade,
  kind public.college_link_kind not null,
  -- Only true when a source says the employer takes placements mainly or only
  -- from this college. Drives the "mainly" wording.
  mainly_from_this_college boolean not null default false,
  source_url text not null,
  evidence_note text,
  observed_on date,
  method public.evidence_method not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_college_links_unique unique (company_id, college_id, kind),
  constraint college_link_source_is_url check (source_url ~ '^https?://[^\s]+$'),
  constraint college_link_note_length check (evidence_note is null or length(evidence_note) <= 500)
);

comment on table public.company_college_links is
  'Evidence that a company works with a college. Wording comes from college_link_label(); "mainly" only when a source says so.';

create index company_college_links_company_idx on public.company_college_links (company_id);
create index company_college_links_college_idx on public.company_college_links (college_id);

create trigger company_college_links_touch before update on public.company_college_links
  for each row execute function public.set_updated_at();

alter table public.company_college_links enable row level security;

create policy "college links: public read" on public.company_college_links
  for select to anon, authenticated
  using (exists (select 1 from public.companies c where c.id = company_id));
create policy "college links: admin write" on public.company_college_links
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- The sentence students see. Keep in step with the spec ("College links").
create or replace function public.college_link_label(
  p_kind public.college_link_kind,
  p_college text,
  p_mainly boolean
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_mainly then 'Takes placements mainly from ' || p_college
    when p_kind = 'tlevel_placements' then 'Has hosted T Level students from ' || p_college
    when p_kind = 'industry_placements' then 'Has hosted placement students from ' || p_college
    when p_kind = 'apprenticeships' then 'Trains apprentices with ' || p_college
    else 'Partner employer of ' || p_college
  end
$$;

-- ---------------------------------------------------------------------------
-- Crawler work tables (private: the import schema has no anon/authenticated
-- access)
-- ---------------------------------------------------------------------------

-- Websites we were told about, before the crawler confirms them.
create table import.website_candidates (
  company_id uuid not null references public.companies (id) on delete cascade,
  url text not null,
  origin text not null check (origin in ('curated', 'faa_vacancy', 'student_submitted', 'manual')),
  added_at timestamptz not null default now(),
  primary key (company_id, url)
);

create type import.crawl_state as enum ('pending', 'done', 'no_site', 'failed');

create table import.contact_crawl (
  company_id uuid primary key references public.companies (id) on delete cascade,
  state import.crawl_state not null default 'pending',
  priority smallint not null default 5,  -- lower runs first
  attempts smallint not null default 0,
  site_url text,               -- the confirmed website, when found
  matched_on text,             -- 'company_number', 'postcode' or 'curated'
  contacts_found smallint,
  last_error text,
  checked_at timestamptz,
  next_check_after timestamptz not null default now()
);

create index contact_crawl_queue_idx on import.contact_crawl (priority, next_check_after)
  where state in ('pending', 'failed');

-- Adds every active company to the queue (idempotent). Verified companies and
-- those with live vacancies go first. Called by the crawler at start-up.
create or replace function import.enqueue_contact_crawl()
returns integer
language sql
set search_path = public, import, pg_temp
as $$
  with ins as (
    insert into import.contact_crawl (company_id, priority)
    select c.id,
           case when c.data_source = 'verified' then 1
                when exists (select 1 from public.vacancies v where v.company_id = c.id) then 2
                when c.website is not null then 3
                when c.size_band in ('large', 'medium') then 4
                else 5 end
    from public.companies c
    where c.status = 'active'
    on conflict (company_id) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

revoke all on import.website_candidates, import.contact_crawl from public, anon, authenticated;
revoke execute on function import.enqueue_contact_crawl() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- company_detail: now with contacts and college links
-- ---------------------------------------------------------------------------
create or replace function public.company_detail(p_id uuid)
returns jsonb
language sql
stable
security invoker -- RLS on companies already hides hidden records
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'ch_number', c.ch_number,
    'website', c.website,
    'summary', c.summary,
    'size_band', c.size_band,
    'sectors', c.sectors,
    'keywords', c.keywords,
    'specialisms', c.specialisms,
    'takes_tlevel', c.takes_tlevel,
    'tlevel_evidence_url', c.tlevel_evidence_url,
    'routes_onward', c.routes_onward,
    'placement_patterns', c.placement_patterns,
    'accepts_under_18', c.accepts_under_18,
    'early_careers_programme', c.early_careers_programme,
    'trade_bodies', c.trade_bodies,
    'how_to_apply', c.how_to_apply,
    'data_source', c.data_source,
    'verified_at', c.verified_at,
    'status', c.status,
    'sic_codes', c.sic_codes,
    'updated_at', c.updated_at,
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'label', s.label, 'postcode', s.postcode,
        'region', s.region, 'county', s.county,
        'lat', st_y(s.location::geometry), 'lng', st_x(s.location::geometry)
      ) order by s.kind desc, s.label)
      from company_sites s where s.company_id = c.id
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('field', x.field, 'url', x.url, 'captured_at', x.captured_at)
                       order by x.field, x.url)
      from company_sources x where x.company_id = c.id
    ), '[]'::jsonb),
    'vacancies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', v.title, 'level', v.level, 'course_title', v.course_title,
        'closing_date', v.closing_date, 'url', v.url, 'postcode', st.postcode
      ) order by v.closing_date nulls last)
      from vacancies v left join company_sites st on st.id = v.site_id
      where v.company_id = c.id and (v.closing_date is null or v.closing_date >= current_date)
    ), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'purpose', k.purpose, 'value', k.value, 'label', k.label,
        'source_url', k.source_url, 'method', k.method, 'verified_at', k.verified_at,
        'last_seen_at', k.last_seen_at
      ) order by (k.verified_at is null), k.purpose, k.kind, k.value)
      from company_contacts k where k.company_id = c.id and not k.hidden
    ), '[]'::jsonb),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'college_id', l.college_id, 'college', co.name, 'kind', l.kind,
        'mainly', l.mainly_from_this_college,
        'label', college_link_label(l.kind, co.name, l.mainly_from_this_college),
        'source_url', l.source_url, 'observed_on', l.observed_on, 'verified_at', l.verified_at
      ) order by l.mainly_from_this_college desc, l.kind, co.name)
      from company_college_links l join colleges co on co.id = l.college_id
      where l.company_id = c.id
    ), '[]'::jsonb)
  )
  from companies c
  where c.id = p_id
    and c.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- college_tags: the tags for a page of search results (one round trip)
-- ---------------------------------------------------------------------------
create or replace function public.college_tags(p_company_ids uuid[])
returns table (company_id uuid, college_id uuid, label text, mainly boolean)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select l.company_id, l.college_id,
         college_link_label(l.kind, co.name, l.mainly_from_this_college),
         l.mainly_from_this_college
  from company_college_links l
  join colleges co on co.id = l.college_id
  where l.company_id = any (p_company_ids[1:200])
  order by l.company_id, l.mainly_from_this_college desc, l.kind, co.name;
$$;

revoke execute on function public.college_tags(uuid[]) from public;
grant execute on function public.college_tags(uuid[]) to anon, authenticated;
