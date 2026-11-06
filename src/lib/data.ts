import 'server-only';
import { unstable_cache } from 'next/cache';
import type {
  DataSource,
  EnglandRegion,
  PlacementPattern,
  RankedCompany,
  RouteOnward,
  SiteKind,
  SizeBand,
  TriState,
} from '@/types/domain';
import { cached, publicDb, rpcRetry } from './supabase';
import type { OutcodeCentroid } from './outcode';
import { PAGE_SIZE, type SearchState } from './filters';

export interface ReferenceData {
  routes: { id: string; name: string; specialisms: { id: string; name: string }[] }[];
  sectors: string[];
}

export function referenceData(): Promise<ReferenceData> {
  return cached('reference_data', 60 * 60 * 1000, async () => {
    const { data, error } = await publicDb().rpc('reference_data');
    if (error) throw new Error(`reference_data: ${error.message}`);
    return data as ReferenceData;
  });
}

export async function specialismNames(): Promise<Map<string, string>> {
  const ref = await referenceData();
  return new Map(ref.routes.flatMap((r) => r.specialisms.map((s) => [s.id, s.name] as const)));
}

export interface SearchResult {
  rows: RankedCompany[];
  total: number;
}

export async function searchCompanies(s: SearchState, origin: OutcodeCentroid | null): Promise<SearchResult> {
  const profile: Record<string, unknown> = {
    route_id: s.route ?? undefined,
    specialism: s.spec ?? undefined,
    max_travel_km: s.km,
    weights: s.weights,
  };
  if (origin) {
    profile.lat = origin.lat;
    profile.lng = origin.lng;
  }
  const filters: Record<string, unknown> = {
    q: s.q ?? undefined,
    region: s.region ?? undefined,
    sectors: s.sectors.length ? s.sectors : undefined,
    size_bands: s.sizes.length ? s.sizes : undefined,
    has_taken_tlevel: s.taken || undefined,
    has_route_onward: s.onward || undefined,
    core_only: s.core || undefined,
    data_sources: s.sources.length ? s.sources : undefined,
    include_outside_radius: s.outside || undefined,
    limit: PAGE_SIZE,
    offset: (s.page - 1) * PAGE_SIZE,
  };
  // Same inputs, same results for everyone: no personal data goes in (only
  // the outward code's centre point), so results are shared through Vercel's
  // data cache for 10 minutes. Repeat searches skip the database entirely.
  return rankCached(JSON.parse(JSON.stringify(profile)), JSON.parse(JSON.stringify(filters)));
}

const rankCached = unstable_cache(
  async (profile: Record<string, unknown>, filters: Record<string, unknown>): Promise<SearchResult> => {
    // Throwing means errors are never cached; the next request tries again.
    const rows = ((await rpcRetry<RankedCompany[]>('rank_companies', { p_profile: profile, p_filters: filters })) ?? []) as RankedCompany[];
    return { rows, total: rows[0]?.total_count ?? 0 };
  },
  ['rank_companies', 'v2'],
  { revalidate: 600, tags: ['rank'] },
);

export interface CompanyDetail {
  id: string;
  name: string;
  ch_number: string | null;
  website: string | null;
  summary: string | null;
  size_band: SizeBand;
  sectors: string[];
  keywords: string[];
  specialisms: string[];
  takes_tlevel: TriState;
  tlevel_evidence_url: string | null;
  routes_onward: RouteOnward[];
  placement_patterns: PlacementPattern[];
  accepts_under_18: TriState;
  early_careers_programme: boolean;
  trade_bodies: string[];
  how_to_apply: string | null;
  data_source: DataSource;
  verified_at: string | null;
  sic_codes: string[];
  engineering_tier: 'core' | 'adjacent';
  updated_at: string;
  sites: {
    id: string;
    kind: SiteKind;
    label: string | null;
    postcode: string | null;
    region: EnglandRegion | null;
    county: string | null;
    lat: number;
    lng: number;
  }[];
  sources: { field: string; url: string; captured_at: string }[];
  vacancies: {
    title: string;
    level: string | null;
    course_title: string | null;
    closing_date: string | null;
    url: string | null;
    postcode: string | null;
  }[];
  contacts: CompanyContact[];
  colleges: CollegeLink[];
}

export type ContactKind = 'website' | 'careers_page' | 'apply_page' | 'contact_page' | 'contact_form' | 'email' | 'phone' | 'linkedin';
export type ContactPurpose = 'general' | 'careers' | 'early_careers' | 'apprenticeships' | 'placements' | 'hr';

export interface CompanyContact {
  kind: ContactKind;
  purpose: ContactPurpose;
  value: string;
  label: string | null;
  source_url: string;
  method: 'curated' | 'crawler' | 'vacancy_import' | 'student_submitted';
  verified_at: string | null;
  last_seen_at: string;
  /** name_match: website found by the company's full name only (0022). */
  confidence: 'confirmed' | 'name_match';
}

export interface CollegeLink {
  college_id: string;
  college: string;
  kind: 'tlevel_placements' | 'industry_placements' | 'apprenticeships' | 'partner';
  mainly: boolean;
  label: string;
  source_url: string;
  observed_on: string | null;
  verified_at: string | null;
}

/** College tags for a page of results, keyed by company id. */
export async function collegeTags(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  let data: { company_id: string; label: string }[];
  try {
    data = await collegeTagsCached(ids);
  } catch {
    return out; // a nice-to-have on the results list: never fail the search for it
  }
  for (const t of data) {
    out.set(t.company_id, [...(out.get(t.company_id) ?? []), t.label]);
  }
  return out;
}

const collegeTagsCached = unstable_cache(
  async (ids: string[]) => {
    const { data, error } = await publicDb().rpc('college_tags', { p_company_ids: ids });
    if (error) throw new Error(`college_tags: ${error.message}`);
    return (data ?? []) as { company_id: string; label: string }[];
  },
  ['college_tags', 'v1'],
  { revalidate: 600, tags: ['rank'] },
);

export async function companyDetail(id: string): Promise<CompanyDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await publicDb().rpc('company_detail', { p_id: id });
  if (error) throw new Error(`company_detail: ${error.message}`);
  return (data as CompanyDetail | null) ?? null;
}

export interface RegionCount {
  region: EnglandRegion;
  county: string | null;
  companies: number;
  verified: number;
  with_vacancies: number;
}

export function regionCounts(): Promise<RegionCount[]> {
  return cached('region_counts', 60 * 60 * 1000, async () => {
    const { data, error } = await publicDb().rpc('region_counts');
    if (error) throw new Error(`region_counts: ${error.message}`);
    return (data ?? []) as RegionCount[];
  });
}
