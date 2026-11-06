import 'server-only';
import { unstable_cache } from 'next/cache';
import { publicDb, rpcRetry } from './supabase';
import type { OutcodeCentroid } from './outcode';

// Universities and Apprenticeships tabs (migration 0024). Public, read-only,
// through the RPCs; search state lives in the URL like the employer search.

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || null;
};
const many = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
};
const int = (v: string | null, lo: number, hi: number, d: number) => {
  const n = v == null ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d;
};
const outcode = (p: Params) => {
  const oc = one(p, 'oc')?.toUpperCase().replace(/\s/g, '') ?? null;
  return oc && /^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(oc) ? oc : null;
};

export const UNI_PAGE_SIZE = 20;

// Search results depend only on the filters (and an outward code's centre
// point, never a student), so they're shared through Vercel's data cache for
// 10 minutes, like the employer search.
const rpcCached = unstable_cache(
  async (fn: string, p: Record<string, unknown>) => (await rpcRetry<unknown[]>(fn, { p })) ?? [],
  ['opportunities', 'v1'],
  { revalidate: 600, tags: ['opportunities'] },
);
const cachedRpc = async <T,>(fn: string, p: Record<string, unknown>) => (await rpcCached(fn, JSON.parse(JSON.stringify(p)))) as T;

// ---------------------------------------------------------------------------
// Universities
// ---------------------------------------------------------------------------
export type TLevelStatus = 'accepted' | 'accepted_with_maths' | 'case_by_case' | 'not_accepted' | 'unknown';
export type SubjectGroup = 'engineering' | 'computing' | 'physics' | 'maths' | 'built_environment' | 'other';
export type Nation = 'england' | 'scotland' | 'wales' | 'northern_ireland';

export const TLEVEL_STATUS: Record<TLevelStatus, { label: string; short: string; help: string }> = {
  accepted: {
    label: 'Accepts T Levels',
    short: 'T Level accepted',
    help: 'The course page says an engineering T Level meets the entry requirement.',
  },
  accepted_with_maths: {
    label: 'T Level + A level',
    short: 'T Level + A level',
    help: 'Accepted only alongside an A level, usually Maths. The tag shows which A level and the grade when the course page says.',
  },
  case_by_case: {
    label: 'Case by case',
    short: 'Case by case',
    help: 'T Level applicants are considered individually. Contact admissions before applying.',
  },
  not_accepted: {
    label: 'Not accepted',
    short: 'Not accepted',
    help: 'The course page says T Levels aren’t accepted for this course. A foundation year may be an option.',
  },
  unknown: {
    label: 'Check with the university',
    short: 'Not stated',
    help: 'We couldn’t find a clear statement about T Levels on the course page.',
  },
};
/**
 * The tag's text: "T Level Merit + A level Maths at B", "T Level accepted · Distinction".
 * Only a grade word is shown as the T Level grade; longer wording stays in the quote.
 */
export function tlevelTagText(status: TLevelStatus, requirement: string | null | undefined, alevel: string | null | undefined, long = false): string {
  const s = TLEVEL_STATUS[status];
  const grade = requirement && /^(Pass|Merit|Distinction\*?|D\*?|M|P)\b/i.test(requirement) ? requirement : null;
  if (status === 'accepted_with_maths') return `T Level${grade ? ` ${grade}` : ''} + ${alevel ?? 'an A level'}`;
  if (status === 'accepted' && requirement) return `${long ? s.label : s.short} · ${requirement}`;
  return long ? s.label : s.short;
}

export const STATUS_ORDER: TLevelStatus[] = ['accepted', 'accepted_with_maths', 'case_by_case', 'not_accepted', 'unknown'];

export const SUBJECT_GROUPS: Record<Exclude<SubjectGroup, 'other'>, string> = {
  engineering: 'Engineering',
  computing: 'Computing',
  physics: 'Physics',
  maths: 'Maths',
  built_environment: 'Architecture and building',
};
export const NATIONS: Record<Nation, string> = {
  england: 'England',
  scotland: 'Scotland',
  wales: 'Wales',
  northern_ireland: 'Northern Ireland',
};

/** Sort orders for university courses (search_uni_courses, 0033). */
export const UNI_SORTS = ['default', 'easiest', 'cug', 'cug_uni', 'rank', 'satisfaction', 'salary', 'nearest', 'name'] as const;
export type UniSort = (typeof UNI_SORTS)[number];
export const UNI_SORT_LABEL: Record<UniSort, string> = {
  default: 'Best T Level fit',
  easiest: 'Easiest T Level entry',
  cug: 'League table: subject',
  cug_uni: 'League table: university',
  rank: 'Our open-data rank',
  satisfaction: 'Student satisfaction',
  salary: 'Graduate salary',
  nearest: 'Nearest to you',
  name: 'University A to Z',
};

export interface UniSearch {
  oc: string | null;
  km: number; // 0 = anywhere
  q: string | null;
  status: TLevelStatus[];
  group: Exclude<SubjectGroup, 'other'> | null;
  nation: Nation | null;
  dfe: boolean;
  russell: boolean;
  /** UKPRNs of universities to leave out. */
  hide: string[];
  fy: 'yes' | 'no' | null; // foundation year available / not
  sort: UniSort;
  page: number;
}

export function parseUniSearch(p: Params): UniSearch {
  const group = one(p, 'group');
  const nation = one(p, 'nation');
  return {
    oc: outcode(p),
    km: int(one(p, 'km'), 0, 1000, 0),
    q: one(p, 'q')?.slice(0, 100) ?? null,
    status: many(p, 'status').filter((s): s is TLevelStatus => (STATUS_ORDER as string[]).includes(s)),
    // Engineering by default: the T Levels this app is for.
    group: group === 'all' ? null : group && group in SUBJECT_GROUPS ? (group as UniSearch['group']) : 'engineering',
    nation: nation && nation in NATIONS ? (nation as Nation) : null,
    dfe: one(p, 'dfe') === '1',
    russell: one(p, 'rg') === '1',
    hide: [...new Set(many(p, 'xu').filter((x) => /^[0-9]{8}$/.test(x)))].slice(0, 100),
    fy: one(p, 'fy') === 'yes' ? 'yes' : one(p, 'fy') === 'no' ? 'no' : null,
    sort: (UNI_SORTS as readonly string[]).includes(one(p, 'sort') ?? '') ? (one(p, 'sort') as UniSort) : 'default',
    page: int(one(p, 'page'), 1, 100, 1),
  };
}

export function uniHref(s: UniSearch, over: Partial<UniSearch> = {}): string {
  const v = { ...s, ...over };
  const u = new URLSearchParams();
  if (v.oc) u.set('oc', v.oc);
  if (v.km) u.set('km', String(v.km));
  if (v.q) u.set('q', v.q);
  for (const st of v.status) u.append('status', st);
  u.set('group', v.group ?? 'all');
  if (v.nation) u.set('nation', v.nation);
  if (v.dfe) u.set('dfe', '1');
  if (v.russell) u.set('rg', '1');
  for (const x of v.hide) u.append('xu', x);
  if (v.fy) u.set('fy', v.fy);
  if (v.sort !== 'default') u.set('sort', v.sort);
  if (v.page > 1) u.set('page', String(v.page));
  return `/universities?${u.toString()}`;
}

export interface CourseRow {
  id: string;
  title: string;
  qualification: string | null;
  subject_group: SubjectGroup;
  university_id: string;
  university: string;
  on_dfe_tlevel_list: boolean;
  nation: Nation | null;
  location_name: string | null;
  distance_km: number | null;
  tlevel_status: TLevelStatus;
  tlevel_requirement: string | null;
  /** For accepted_with_maths: the A level asked for alongside, e.g. "A level Maths at B" (0034). */
  tlevel_alevel: string | null;
  course_url: string | null;
  foundation_year: boolean | null;
  sandwich_year: boolean | null;
  /** university: the label comes from the university's general T Level statement (0025). */
  tlevel_scope: 'course' | 'university';
  russell_group: boolean;
  tef_overall: TefRating | null;
  overall_rank: number | null;
  overall_rank_of: number | null;
  overall_rank_tied: boolean | null;
  subject_label: string | null;
  subject_rank: number | null;
  subject_rank_of: number | null;
  subject_rank_tied: boolean | null;
  cug_subject_label: string | null;
  cug_subject_position: number | null;
  cug_subject_tied: boolean | null;
  cug_subject_of: number | null;
  cug_overall_position: number | null;
  cug_overall_tied: boolean | null;
  cug_overall_of: number | null;
  satisfaction_pct: number | null;
  median_salary: number | null;
  /** UCAS Tariff points the T Level requirement works out to (0033). */
  tlevel_points: number | null;
  total: number;
}

export async function searchUniCourses(s: UniSearch, origin: OutcodeCentroid | null) {
  const p: Record<string, unknown> = { page: s.page, limit: UNI_PAGE_SIZE, dfe_list: s.dfe, russell: s.russell };
  if (s.fy) p.foundation = s.fy;
  if (s.sort !== 'default') p.sort = s.sort;
  if (s.q) p.q = s.q;
  if (s.status.length) p.status = s.status;
  if (s.group) p.group = s.group;
  if (s.nation) p.nation = s.nation;
  if (origin) Object.assign(p, { lat: origin.lat, lng: origin.lng, km: s.km });
  if (s.hide.length) p.hide = s.hide;
  const rows = await cachedRpc<CourseRow[]>('search_uni_courses', p);
  return { rows, total: Number(rows[0]?.total ?? 0) };
}

export interface UniFacet {
  ukprn: string;
  name: string;
  courses: number;
}

/** Every university in the search (hidden ones included) with its course count, for the filter list. */
export async function uniCourseUniversities(s: UniSearch, origin: OutcodeCentroid | null): Promise<UniFacet[]> {
  const p: Record<string, unknown> = { dfe_list: s.dfe, russell: s.russell };
  if (s.fy) p.foundation = s.fy;
  if (s.q) p.q = s.q;
  if (s.status.length) p.status = s.status;
  if (s.group) p.group = s.group;
  if (s.nation) p.nation = s.nation;
  if (origin) Object.assign(p, { lat: origin.lat, lng: origin.lng, km: s.km });
  const rows = await cachedRpc<UniFacet[]>('uni_course_universities', p);
  // "University of Bath" files under B, next to "Bath Spa University".
  const key = (n: string) => n.replace(/^(the\s+)?university\s+(of\s+(the\s+)?)?/i, '').toLowerCase();
  return rows.map((r) => ({ ...r, courses: Number(r.courses) })).sort((a, b) => key(a.name).localeCompare(key(b.name), 'en-GB'));
}

export interface CourseDetail {
  id: string;
  title: string;
  qualification: string | null;
  subject_group: SubjectGroup;
  ucas_codes: string[];
  course_url: string | null;
  foundation_year: boolean | null;
  sandwich_year: boolean | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  entry_alevel_pct: number | null;
  entry_other_pct: number | null;
  tlevel_status: TLevelStatus;
  tlevel_requirement: string | null;
  tlevel_alevel: string | null;
  tlevel_quote: string | null;
  tlevel_quote_url: string | null;
  tlevel_assessed_by: 'rules' | 'claude' | 'curated' | null;
  tlevel_assessed_at: string | null;
  tlevel_scope: 'course' | 'university';
  alevel_requirement: string | null;
  subject_label: string | null;
  /** The Complete University Guide table for this subject, where we have one (0031). */
  subject_league_table_url: string | null;
  cug: CugPositions | null;
  subject_rank: number | null;
  subject_rank_of: number | null;
  subject_rank_tied: boolean | null;
  satisfaction_pct: number | null;
  continuation_pct: number | null;
  work_study_pct: number | null;
  median_salary: number | null;
  source_url: string;
  fetched_at: string;
  university: {
    id: string;
    name: string;
    nation: Nation | null;
    website: string | null;
    russell_group: boolean;
    on_dfe_tlevel_list: boolean;
    dfe_list_url: string | null;
    dfe_list_checked_on: string | null;
    tlevel_policy_status: TLevelStatus | null;
    tlevel_policy_quote: string | null;
    tlevel_policy_url: string | null;
    tlevel_policy_checked_at: string | null;
    tef_overall: TefRating | null;
    tef_experience: TefRating | null;
    tef_outcomes: TefRating | null;
    tef_url: string | null;
    overall_rank: number | null;
    overall_rank_of: number | null;
    overall_rank_tied: boolean | null;
    rankings_on: string | null;
  };
}

/** Complete University Guide positions, published with permission (0032). Credit and link wherever shown. */
export interface CugPositions {
  edition: number;
  subject_label: string | null;
  subject_url: string | null;
  subject_position: number | null;
  subject_tied: boolean | null;
  subject_of: number | null;
  overall_position: number | null;
  overall_tied: boolean | null;
  overall_of: number | null;
  overall_url: string;
}

export const CUG_NAME = 'Complete University Guide';
export const CUG_URL = 'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings';

export type TefRating = 'Gold' | 'Silver' | 'Bronze' | 'Requires improvement';

/** "=12th of 207" style, or null when unranked. */
export function rankText(rank: number | null, of: number | null, tied: boolean | null): string | null {
  if (!rank || !of) return null;
  return `${ordinal(rank, tied)} of ${of}`;
}

export { ordinal, type RankStat } from './rank';
import { ordinal, type RankStat } from './rank';

type RankFields = Pick<
  CourseRow,
  | 'cug_subject_label' | 'cug_subject_position' | 'cug_subject_tied' | 'cug_subject_of'
  | 'cug_overall_position' | 'cug_overall_tied' | 'cug_overall_of'
  | 'subject_label' | 'subject_rank' | 'subject_rank_of' | 'subject_rank_tied'
  | 'overall_rank' | 'overall_rank_of' | 'overall_rank_tied'
>;

export function rankStats(r: RankFields): RankStat[] {
  const cug = 'Complete University Guide 2027';
  const ours = 'Our open-data rank';
  const subj: RankStat | null =
    r.cug_subject_position && r.cug_subject_of && r.cug_subject_label
      ? { position: r.cug_subject_position, of: r.cug_subject_of, tied: !!r.cug_subject_tied, label: r.cug_subject_label, source: cug }
      : r.subject_rank && r.subject_rank_of && r.subject_label
        ? { position: r.subject_rank, of: r.subject_rank_of, tied: !!r.subject_rank_tied, label: r.subject_label, source: ours }
        : null;
  const uni: RankStat | null =
    r.cug_overall_position && r.cug_overall_of
      ? { position: r.cug_overall_position, of: r.cug_overall_of, tied: !!r.cug_overall_tied, label: 'University overall', source: cug }
      : r.overall_rank && r.overall_rank_of
        ? { position: r.overall_rank, of: r.overall_rank_of, tied: !!r.overall_rank_tied, label: 'University overall', source: ours }
        : null;
  return [subj, uni].filter((x): x is RankStat => !!x);
}

/** Published UK league tables we link to (their tables are copyright, so we don't copy them). */
export const LEAGUE_TABLES = [
  { name: 'Complete University Guide', url: 'https://www.thecompleteuniversityguide.co.uk/league-tables/rankings' },
  { name: 'Guardian University Guide', url: 'https://www.theguardian.com/education/universityguide' },
  { name: 'QS World University Rankings', url: 'https://www.topuniversities.com/world-university-rankings' },
] as const;

export async function uniCourseDetail(id: string): Promise<CourseDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await publicDb().rpc('uni_course_detail', { p_id: id });
  if (error) throw new Error(`uni_course_detail: ${error.message}`);
  return (data as CourseDetail | null) ?? null;
}

// ---------------------------------------------------------------------------
// Apprenticeships
// ---------------------------------------------------------------------------
export interface ApprenticeshipSearch {
  oc: string | null;
  km: number;
  q: string | null;
  level: number | null;
  tlevel: boolean;
  page: number;
}

export function parseApprenticeshipSearch(p: Params): ApprenticeshipSearch {
  const level = one(p, 'level');
  return {
    oc: outcode(p),
    km: int(one(p, 'km'), 0, 1000, 40),
    q: one(p, 'q')?.slice(0, 100) ?? null,
    level: level && /^[2-7]$/.test(level) ? Number(level) : null,
    tlevel: one(p, 'tlevel') === '1',
    page: int(one(p, 'page'), 1, 100, 1),
  };
}

export function apprenticeshipHref(s: ApprenticeshipSearch, over: Partial<ApprenticeshipSearch> = {}): string {
  const v = { ...s, ...over };
  const u = new URLSearchParams();
  if (v.oc) u.set('oc', v.oc);
  if (v.km !== 40) u.set('km', String(v.km));
  if (v.q) u.set('q', v.q);
  if (v.level) u.set('level', String(v.level));
  if (v.tlevel) u.set('tlevel', '1');
  if (v.page > 1) u.set('page', String(v.page));
  return `/apprenticeships?${u.toString()}`;
}

export const LEVEL_LABEL: Record<number, string> = {
  2: 'Intermediate (level 2)',
  3: 'Advanced (level 3)',
  4: 'Higher (level 4)',
  5: 'Higher (level 5)',
  6: 'Degree (level 6)',
  7: 'Degree (level 7)',
};

export interface AdvertRow {
  id: string;
  title: string;
  employer: string;
  company_id: string;
  course_title: string | null;
  course_level: number | null;
  level: string | null;
  wage_text: string | null;
  closing_date: string | null;
  start_on: string | null;
  url: string | null;
  postcode: string | null;
  distance_km: number | null;
  tlevel_mention: string | null;
  training_provider: string | null;
  total: number;
}

export interface SchemeRow {
  id: string;
  name: string;
  size_band: string;
  scheme_url: string | null;
  has_degree_apprenticeship: boolean;
  distance_km: number | null;
  verified: boolean;
  total: number;
}

export async function searchApprenticeships(s: ApprenticeshipSearch, origin: OutcodeCentroid | null) {
  const p: Record<string, unknown> = { page: s.page, limit: 20, tlevel: s.tlevel };
  if (s.q) p.q = s.q;
  if (s.level) p.level = String(s.level);
  if (origin) Object.assign(p, { lat: origin.lat, lng: origin.lng, km: s.km });
  const rows = await cachedRpc<AdvertRow[]>('search_apprenticeships', p);
  return { rows, total: Number(rows[0]?.total ?? 0) };
}

export async function apprenticeshipEmployers(s: ApprenticeshipSearch, origin: OutcodeCentroid | null) {
  const p: Record<string, unknown> = { page: 1, limit: 12 };
  if (origin) Object.assign(p, { lat: origin.lat, lng: origin.lng, km: s.km });
  const rows = await cachedRpc<SchemeRow[]>('apprenticeship_employers', p);
  return { rows, total: Number(rows[0]?.total ?? 0) };
}
