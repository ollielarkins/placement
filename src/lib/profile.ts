import 'server-only';
import { DEFAULT_WEIGHTS, type EnglandRegion, type RankWeights } from '@/types/domain';
import { cached, publicDb } from './supabase';
import { searchHref, type SearchState } from './filters';

export type TravelMode = 'walk' | 'cycle' | 'public_transport' | 'car' | 'lift';
export type PlacementPatternChoice = 'block' | 'day_release' | 'mixed';

export const TRAVEL_MODES: { id: TravelMode; label: string }[] = [
  { id: 'public_transport', label: 'Bus or train' },
  { id: 'lift', label: 'Lift from family or friends' },
  { id: 'car', label: 'I drive' },
  { id: 'cycle', label: 'Cycle' },
  { id: 'walk', label: 'Walk' },
];
export const PATTERNS: { id: PlacementPatternChoice; label: string }[] = [
  { id: 'block', label: 'Block (several weeks in a row)' },
  { id: 'day_release', label: 'Day release (a day or two a week)' },
  { id: 'mixed', label: 'A mix of both' },
];
export const TRAVEL_KM = [
  { km: 8, label: '5 miles' },
  { km: 16, label: '10 miles' },
  { km: 25, label: '15 miles' },
  { km: 40, label: '25 miles' },
  { km: 65, label: '40 miles' },
];

export interface Profile {
  route_id: string | null;
  specialism: string | null;
  college_id: string | null;
  home_outcode: string | null;
  max_travel_km: number;
  travel_mode: TravelMode | null;
  placement_pattern: PlacementPatternChoice | null;
  placement_starts_on: string | null;
  placement_ends_on: string | null;
  interests: string[];
  skills: string[];
  about: string | null;
  weights: RankWeights;
}

export const PROFILE_COLUMNS =
  'route_id, specialism, college_id, home_outcode, max_travel_km, travel_mode, placement_pattern, placement_starts_on, placement_ends_on, interests, skills, about, weights';

export interface CollegeOption {
  id: string;
  name: string;
  region: EnglandRegion | null;
}

/** The T Level providers students pick from (public reference data). */
export function collegeOptions(): Promise<CollegeOption[]> {
  return cached('college_options', 60 * 60 * 1000, async () => {
    const { data, error } = await publicDb().from('colleges').select('id, name, region').order('name');
    if (error) throw new Error(`colleges: ${error.message}`);
    return (data ?? []) as CollegeOption[];
  });
}

/** A search URL built from the profile. Only the outward code goes in it. */
export function profileSearchHref(p: Profile): string {
  const s: SearchState = {
    oc: p.home_outcode,
    km: Math.round(Number(p.max_travel_km) || 25),
    route: p.route_id,
    spec: p.specialism,
    q: null,
    region: null,
    sectors: [],
    sizes: [],
    taken: false,
    onward: false,
    sources: [],
    outside: false,
    core: false,
    weights: { ...DEFAULT_WEIGHTS, ...p.weights },
    page: 1,
  };
  return searchHref(s);
}

/** Comma or newline separated tags: trimmed, deduplicated, capped. */
export function parseTags(raw: string, max: number, maxLen = 40): string[] {
  const out: string[] = [];
  const lower = new Set<string>();
  for (const t of raw.split(/[,\n]/)) {
    const v = t.trim().replace(/\s+/g, ' ').slice(0, maxLen);
    if (!v || lower.has(v.toLowerCase())) continue;
    lower.add(v.toLowerCase());
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}
