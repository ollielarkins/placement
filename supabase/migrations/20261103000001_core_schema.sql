-- T Level Placement Finder: core schema
-- Phase 0. Implements the "Data model" section of the MVP Spec.
-- Every table has RLS enabled. Import jobs and edge functions use the
-- service_role key, which bypasses RLS; nothing in the browser ever holds it.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.data_source as enum ('verified', 'imported', 'student_submitted');
create type public.company_status as enum ('active', 'dissolved', 'not_taking_placements', 'hidden');
create type public.tri_state as enum ('yes', 'no', 'unknown');
create type public.size_band as enum ('micro', 'small', 'medium', 'large', 'unknown');
create type public.route_onward as enum (
  'apprenticeship', 'degree_apprenticeship', 'sponsored_degree', 'job', 'tlevel_kept_on'
);
create type public.placement_pattern as enum ('block', 'day_release', 'mixed');
create type public.travel_mode as enum ('walk', 'cycle', 'public_transport', 'car', 'lift');
create type public.england_region as enum (
  'north_east', 'north_west', 'yorkshire_and_the_humber', 'east_midlands',
  'west_midlands', 'east_of_england', 'london', 'south_east', 'south_west'
);
create type public.tracker_stage as enum (
  'researching', 'contacted', 'replied', 'interview', 'offered', 'secured',
  'rejected', 'withdrawn'
);
create type public.outreach_channel as enum ('email', 'linkedin', 'application_cover_note');
create type public.review_status as enum ('pending', 'published', 'held', 'removed');
create type public.submission_status as enum ('pending', 'matched', 'created', 'rejected');
create type public.report_target as enum ('review', 'company');
create type public.report_status as enum ('open', 'upheld', 'dismissed');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Admins carry app_metadata.role = 'admin'. app_metadata is only writable with
-- the service role, so a student cannot grant it to themselves.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- array_to_string is STABLE, so it can't feed a generated column directly.
-- For text[] it is safe to treat as immutable.
create or replace function public.immutable_array_to_string(text[], text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select array_to_string($1, $2) $$;

-- UK outward code, e.g. MK45, SW1A, B1. Students' locations store this only.
create or replace function public.is_outward_code(text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select $1 ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$' $$;

-- ratings = {overall, learning, support, route_onward}, integers 1 to 5.
create or replace function public.valid_review_ratings(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(r) = 'object'
     and r ?& array['overall', 'learning', 'support', 'route_onward']
     and (select count(*) from jsonb_object_keys(r)) = 4
     and coalesce((
       select bool_and(jsonb_typeof(v) = 'number' and (v::text)::numeric in (1, 2, 3, 4, 5))
       from jsonb_each(r) as e(k, v)
     ), false)
$$;

-- weights = {route_onward, specialism_fit, practicalities, brand}, each 0 to 100.
create or replace function public.valid_rank_weights(w jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(w) = 'object'
     and w ?& array['route_onward', 'specialism_fit', 'practicalities', 'brand']
     and (select count(*) from jsonb_object_keys(w)) = 4
     and coalesce((
       select bool_and(jsonb_typeof(v) = 'number' and (v::text)::numeric between 0 and 100)
       from jsonb_each(w) as e(k, v)
     ), false)
     and (select sum((v::text)::numeric) from jsonb_each(w) as e(k, v)) > 0
$$;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.tlevel_routes (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  name text not null unique,
  occupational_specialisms text[] not null default '{}',
  -- UK SIC 2007 prefixes that indicate fit with this route (S factor).
  sic_prefixes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ukprn integer unique,
  postcode text,
  region public.england_region,
  location extensions.geography(point, 4326),
  created_at timestamptz not null default now()
);
create index colleges_location_gix on public.colleges using gist (location);
create index colleges_name_trgm on public.colleges using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  ch_number text unique check (ch_number ~ '^[A-Z0-9]{8}$'),
  website text check (website ~* '^https?://'),
  summary text,
  sic_codes text[] not null default '{}',
  size_band public.size_band not null default 'unknown',
  sectors text[] not null default '{}',
  keywords text[] not null default '{}',
  specialisms text[] not null default '{}',
  takes_tlevel public.tri_state not null default 'unknown',
  tlevel_evidence_url text check (tlevel_evidence_url ~* '^https?://'),
  routes_onward public.route_onward[] not null default '{}',
  placement_patterns public.placement_pattern[] not null default '{}',
  accepts_under_18 public.tri_state not null default 'unknown',
  early_careers_programme boolean not null default false,
  trade_bodies text[] not null default '{}',
  how_to_apply text,
  data_source public.data_source not null,
  verified_at timestamptz,
  status public.company_status not null default 'active',
  -- Dedupe keys (spec: CH number, then normalised name + postcode, then domain).
  name_normalised text generated always as (
    trim(regexp_replace(
      regexp_replace(lower(name), '\m(ltd|limited|plc|llp|uk|the|group|co)\M', '', 'g'),
      '[^a-z0-9]+', ' ', 'g'))
  ) stored,
  website_domain text generated always as (
    nullif(regexp_replace(lower(website), '^https?://(www\.)?([^/:?#]+).*$', '\2'), lower(website))
  ) stored,
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', public.immutable_array_to_string(sectors || keywords, ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verified_needs_date check (data_source <> 'verified' or verified_at is not null),
  constraint takes_tlevel_yes_needs_evidence check (
    takes_tlevel <> 'yes' or data_source <> 'verified' or tlevel_evidence_url is not null
  )
);
create index companies_search_gin on public.companies using gin (search);
create index companies_name_trgm on public.companies using gin (name extensions.gin_trgm_ops);
create index companies_name_norm_idx on public.companies (name_normalised);
create index companies_domain_idx on public.companies (website_domain);
create index companies_specialisms_gin on public.companies using gin (specialisms);
create index companies_sectors_gin on public.companies using gin (sectors);
create index companies_status_idx on public.companies (status);
create trigger companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

create table public.company_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  label text,
  postcode text,
  region public.england_region,
  county text,
  location extensions.geography(point, 4326) not null,
  created_at timestamptz not null default now()
);
create index company_sites_company_idx on public.company_sites (company_id);
create index company_sites_location_gix on public.company_sites using gist (location);
create index company_sites_region_idx on public.company_sites (region, county);

create table public.company_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  field text not null,
  url text not null check (url ~* '^https?://'),
  captured_at timestamptz not null default now()
);
create index company_sources_company_idx on public.company_sources (company_id, field);

create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  site_id uuid references public.company_sites (id) on delete set null,
  external_ref text not null unique,
  title text not null,
  level text,
  closing_date date,
  url text check (url ~* '^https?://'),
  fetched_at timestamptz not null default now()
);
create index vacancies_company_live_idx on public.vacancies (company_id, closing_date);

-- ---------------------------------------------------------------------------
-- Student-owned data
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (length(display_name) <= 50),
  route_id text references public.tlevel_routes (id),
  specialism text,
  college_id uuid references public.colleges (id) on delete set null,
  -- Outward code only (e.g. MK45) plus its centroid. Never a full postcode.
  home_outcode text check (home_outcode is null or public.is_outward_code(home_outcode)),
  home_location extensions.geography(point, 4326),
  max_travel_km numeric(5, 1) not null default 25 check (max_travel_km > 0 and max_travel_km <= 200),
  travel_mode public.travel_mode,
  placement_pattern public.placement_pattern,
  placement_starts_on date,
  placement_ends_on date,
  interests text[] not null default '{}',
  target_company_ids uuid[] not null default '{}' check (cardinality(target_company_ids) <= 20),
  about text check (length(about) <= 1000),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  weights jsonb not null default
    '{"route_onward":30,"specialism_fit":25,"practicalities":25,"brand":20}'::jsonb
    check (public.valid_rank_weights(weights)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_needs_outcode check (home_location is null or home_outcode is not null),
  constraint placement_dates_order check (
    placement_ends_on is null or placement_starts_on is null or placement_ends_on >= placement_starts_on
  )
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- The specialism must belong to the chosen route.
create or replace function public.check_profile_specialism()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.specialism is not null and not exists (
    select 1 from public.tlevel_routes r
    where r.id = new.route_id and new.specialism = any (r.occupational_specialisms)
  ) then
    raise exception 'specialism % is not part of route %', new.specialism, new.route_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger profiles_check_specialism before insert or update of route_id, specialism
  on public.profiles for each row execute function public.check_profile_specialism();

create table public.tracker_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  stage public.tracker_stage not null default 'researching',
  contact_used text check (length(contact_used) <= 200),
  contacted_at date,
  follow_up_on date,
  notes text check (length(notes) <= 5000),
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);
create index tracker_items_user_stage_idx on public.tracker_items (user_id, stage);
create index tracker_items_follow_up_idx on public.tracker_items (user_id, follow_up_on)
  where follow_up_on is not null;

create or replace function public.tracker_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage = 'contacted' and new.contacted_at is null then
      new.contacted_at := current_date;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger tracker_items_stage before insert or update on public.tracker_items
  for each row execute function public.tracker_stage_change();

create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  tracker_item_id uuid references public.tracker_items (id) on delete set null,
  channel public.outreach_channel not null,
  subject text,
  body text not null,
  model text,
  created_at timestamptz not null default now()
);
-- Also serves the per-student daily rate limit check in the edge function.
create index outreach_drafts_user_created_idx on public.outreach_drafts (user_id, created_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  -- Nulled on account deletion: published reviews are anonymised, not deleted.
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  company_id uuid not null references public.companies (id) on delete cascade,
  tracker_item_id uuid references public.tracker_items (id) on delete set null,
  route_id text references public.tlevel_routes (id),
  ratings jsonb not null check (public.valid_review_ratings(ratings)),
  body text not null check (length(body) between 20 and 4000),
  tips text check (length(tips) <= 2000),
  status public.review_status not null default 'pending',
  moderation jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index reviews_company_published_idx on public.reviews (company_id, published_at desc)
  where status = 'published';
create index reviews_user_idx on public.reviews (user_id);
create unique index reviews_one_per_placement on public.reviews (tracker_item_id)
  where tracker_item_id is not null;

create table public.company_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and payload ? 'name' and length(payload::text) <= 5000
  ),
  status public.submission_status not null default 'pending',
  matched_company_id uuid references public.companies (id) on delete set null,
  moderation jsonb,
  created_at timestamptz not null default now()
);
create index company_submissions_user_idx on public.company_submissions (user_id);
create index company_submissions_status_idx on public.company_submissions (status, created_at);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  target_type public.report_target not null,
  target_id uuid not null,
  reason text not null check (length(reason) between 1 and 500),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);
create index reports_target_idx on public.reports (target_type, target_id, status);

-- Spec: "Admin actions are logged (who changed what, when)."
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor uuid not null,
  action text not null,
  table_name text not null,
  record_id text,
  old_row jsonb,
  new_row jsonb,
  at timestamptz not null default now()
);
create index admin_audit_log_at_idx on public.admin_audit_log (at desc);
