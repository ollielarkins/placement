// Domain types for the Phase 0 schema (supabase/migrations/2026110300000*).
// Once the Supabase project exists, generate the full client types with
//   supabase gen types typescript --project-id <id> > src/types/database.ts
// and keep this file for the jsonb shapes and RPC contracts, which the
// generator types only as `Json`.

export type DataSource = 'verified' | 'imported' | 'student_submitted';
export type CompanyStatus = 'active' | 'dissolved' | 'not_taking_placements' | 'hidden';
export type TriState = 'yes' | 'no' | 'unknown';
export type SizeBand = 'micro' | 'small' | 'medium' | 'large' | 'unknown';
export type RouteOnward =
  | 'apprenticeship'
  | 'degree_apprenticeship'
  | 'sponsored_degree'
  | 'job'
  | 'tlevel_kept_on';
export type PlacementPattern = 'block' | 'day_release' | 'mixed';
export type TravelMode = 'walk' | 'cycle' | 'public_transport' | 'car' | 'lift';
export type EnglandRegion =
  | 'north_east'
  | 'north_west'
  | 'yorkshire_and_the_humber'
  | 'east_midlands'
  | 'west_midlands'
  | 'east_of_england'
  | 'london'
  | 'south_east'
  | 'south_west';
export type TrackerStage =
  | 'researching'
  | 'contacted'
  | 'replied'
  | 'interview'
  | 'offered'
  | 'secured'
  | 'rejected'
  | 'withdrawn';
export type SiteKind = 'registered_office' | 'operating_site';
export type OutreachChannel = 'email' | 'linkedin' | 'application_cover_note';
export type ReviewStatus = 'pending' | 'published' | 'held' | 'removed';
export type SubmissionStatus = 'pending' | 'matched' | 'created' | 'rejected';
export type ReportTarget = 'review' | 'company';
export type ReportStatus = 'open' | 'upheld' | 'dismissed';

export const ENGLAND_REGION_LABELS: Record<EnglandRegion, string> = {
  north_east: 'North East',
  north_west: 'North West',
  yorkshire_and_the_humber: 'Yorkshire and the Humber',
  east_midlands: 'East Midlands',
  west_midlands: 'West Midlands',
  east_of_england: 'East of England',
  london: 'London',
  south_east: 'South East',
  south_west: 'South West',
};

export const TRACKER_PIPELINE: readonly TrackerStage[] = [
  'researching',
  'contacted',
  'replied',
  'interview',
  'offered',
  'secured',
] as const;

// ---------------------------------------------------------------------------
// jsonb shapes (enforced by CHECK constraints / triggers in the database)
// ---------------------------------------------------------------------------

/** profiles.weights. Each 0 to 100; they need not sum to 100. */
export interface RankWeights {
  route_onward: number;
  specialism_fit: number;
  practicalities: number;
  brand: number;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  route_onward: 30,
  specialism_fit: 25,
  practicalities: 25,
  brand: 20,
};

/** reviews.ratings. Integers 1 to 5. */
export interface ReviewRatings {
  overall: 1 | 2 | 3 | 4 | 5;
  learning: 1 | 2 | 3 | 4 | 5;
  support: 1 | 2 | 3 | 4 | 5;
  route_onward: 1 | 2 | 3 | 4 | 5;
}

/** reviews.moderation, written by the moderation edge function. */
export interface ModerationVerdict {
  verdict: 'publish' | 'hold' | 'safeguarding';
  uncertain: boolean;
  checks: {
    personal_data: boolean;
    names_individual: boolean;
    abuse: boolean;
    safeguarding: boolean;
    serious_claim: boolean;
    spam: boolean;
    not_real_placement: boolean;
  };
  reasons: string[];
  model: string;
  screened_at: string; // ISO timestamp
  auto_hidden?: 'three_reports';
  auto_hidden_at?: string;
}

/** company_submissions.payload */
export interface CompanySubmissionPayload {
  name: string;
  website?: string;
  postcode?: string;
  why_suitable?: string;
}

// ---------------------------------------------------------------------------
// rank_companies() RPC
// ---------------------------------------------------------------------------

/** p_profile. Every key is optional so ranking works without sign-in. */
export interface RankProfileInput {
  route_id?: string;
  specialism?: string;
  /** Outward-code centroid only. Never send a full-postcode location. */
  lat?: number;
  lng?: number;
  max_travel_km?: number;
  placement_pattern?: PlacementPattern;
  target_company_ids?: string[];
  weights?: RankWeights;
}

export interface RankFilters {
  q?: string;
  route_id?: string;
  specialism?: string;
  region?: EnglandRegion;
  county?: string;
  sectors?: string[];
  size_bands?: SizeBand[];
  has_taken_tlevel?: boolean;
  has_route_onward?: boolean;
  data_sources?: DataSource[];
  include_outside_radius?: boolean;
  /** Default 50, max 200. */
  limit?: number;
  offset?: number;
}

export interface RankedCompany {
  company_id: string;
  name: string;
  /** 0 to 100 */
  score: number;
  /** Factor scores, 0 to 1 */
  route_onward: number;
  specialism_fit: number;
  practicalities: number;
  brand: number;
  /** 1.0 verified, 0.85 imported + live vacancies, 0.7 imported, 0.6 student-submitted */
  confidence: number;
  distance_km: number | null;
  nearest_site_id: string | null;
  live_vacancies: number;
  /** Up to three plain-English reasons, biggest contribution first. */
  reasons: string[];
  data_source: DataSource;
  verified_at: string | null;
  /** Total matches before limit/offset, for pagination. */
  total_count: number;
  /** 'core' engineering company, or 'adjacent': engineering team in another sector (0021). */
  engineering_tier: 'core' | 'adjacent';
}

/** Public review as exposed by the reviews_public view (no user_id). */
export interface PublicReview {
  id: string;
  company_id: string;
  route_name: string | null;
  year: number;
  ratings: ReviewRatings;
  body: string;
  tips: string | null;
  published_at: string;
}

// Returned by import.merge_companies_house() (migration 0006) and stored in import.runs.stats.
export interface CompaniesHouseMergeStats {
  staged: number;
  in_scope: number;
  updated: number;
  hidden: number;
  reactivated: number;
  linked_existing: number;
  created: number;
  sites_written: number;
  dissolved: number;
}
