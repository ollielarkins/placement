-- 0022: website "name matches" and LinkedIn company pages (decided 06/11/2026).
--
-- * contact_confidence: 'confirmed' (site shows the company number or the
--   registered office postcode, or a person checked it) or 'name_match' (the
--   address is the full, distinctive company name and the page names the
--   company, but nothing official ties it to the company). Name-match
--   contacts are shown labelled "not confirmed" and never become
--   companies.website.
-- * contact_kind 'linkedin': a LinkedIn company page linked from the
--   company's own website. Company pages only, never a person's profile; the
--   value shape is enforced here.
--
-- ALTER TYPE ... ADD VALUE can't be used in the same transaction, so the
-- check below compares kind::text.

alter type public.contact_kind add value if not exists 'linkedin';

create type public.contact_confidence as enum ('confirmed', 'name_match');

alter table public.company_contacts
  add column confidence public.contact_confidence not null default 'confirmed';

comment on column public.company_contacts.confidence is
  'confirmed: tied to the company by its number, postcode or a person. name_match: website found by full company name only; shown as not confirmed.';

alter table public.company_contacts drop constraint contact_value_shape;
alter table public.company_contacts add constraint contact_value_shape check (
  case kind::text
    when 'email' then public.is_role_email(value)
    when 'phone' then public.is_org_phone(value)
    when 'linkedin' then value ~ '^https://www\.linkedin\.com/company/[a-z0-9][a-z0-9._-]{1,99}/$'
    else value ~ '^https?://[^\s]+$' and length(value) <= 2048
  end
);

-- Curated and student-submitted contacts are checked by a person.
alter table public.company_contacts add constraint contact_name_match_is_crawled
  check (confidence = 'confirmed' or method = 'crawler');

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
    'engineering_tier', c.engineering_tier,
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
        'last_seen_at', k.last_seen_at, 'confidence', k.confidence
      ) order by (k.confidence <> 'confirmed'), (k.verified_at is null), k.purpose, k.kind, k.value)
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
