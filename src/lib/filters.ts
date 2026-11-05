import type { DataSource, EnglandRegion, RankWeights, SizeBand } from '@/types/domain';
import { DEFAULT_WEIGHTS, ENGLAND_REGION_LABELS } from '@/types/domain';

// Search state lives in the URL (shareable, back-button friendly, works
// without JavaScript). Only an OUTWARD code ever appears here.

export interface SearchState {
  oc: string | null; // outward code
  km: number;
  route: string | null;
  spec: string | null;
  q: string | null;
  region: EnglandRegion | null;
  sectors: string[];
  sizes: SizeBand[];
  taken: boolean;
  onward: boolean;
  sources: DataSource[];
  outside: boolean;
  core: boolean; // engineering companies only (hide engineering-adjacent)
  weights: RankWeights;
  page: number;
}

export const PAGE_SIZE = 20;
const SIZES: SizeBand[] = ['micro', 'small', 'medium', 'large'];
const SOURCES: DataSource[] = ['verified', 'imported', 'student_submitted'];

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || null;
};
const many = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
};
const clampInt = (v: string | null, lo: number, hi: number, dflt: number) => {
  const n = v == null ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
};
const slug = (v: string | null) => (v && /^[a-z0-9_]{1,64}$/.test(v) ? v : null);

export function parseSearch(p: Params): SearchState {
  const oc = one(p, 'oc')?.toUpperCase().replace(/\s/g, '') ?? null;
  const region = one(p, 'region') as EnglandRegion | null;
  return {
    oc: oc && /^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(oc) ? oc : null,
    km: clampInt(one(p, 'km'), 1, 200, 25),
    route: slug(one(p, 'route')),
    spec: slug(one(p, 'spec')),
    q: one(p, 'q')?.slice(0, 100) ?? null,
    region: region && region in ENGLAND_REGION_LABELS ? region : null,
    sectors: many(p, 'sector').filter((s) => /^[a-z_]{1,40}$/.test(s)).slice(0, 12),
    sizes: many(p, 'size').filter((s): s is SizeBand => (SIZES as string[]).includes(s)),
    taken: one(p, 'taken') === '1',
    onward: one(p, 'onward') === '1',
    sources: many(p, 'source').filter((s): s is DataSource => (SOURCES as string[]).includes(s)),
    outside: one(p, 'outside') === '1',
    core: one(p, 'core') === '1',
    weights: {
      route_onward: clampInt(one(p, 'wr'), 0, 100, DEFAULT_WEIGHTS.route_onward),
      specialism_fit: clampInt(one(p, 'ws'), 0, 100, DEFAULT_WEIGHTS.specialism_fit),
      practicalities: clampInt(one(p, 'wp'), 0, 100, DEFAULT_WEIGHTS.practicalities),
      brand: clampInt(one(p, 'wb'), 0, 100, DEFAULT_WEIGHTS.brand),
    },
    page: clampInt(one(p, 'page'), 1, 50, 1),
  };
}

/** URL for a search state, with optional overrides (used for pagination links). */
export function searchHref(s: SearchState, over: Partial<SearchState> = {}): string {
  const v = { ...s, ...over };
  const u = new URLSearchParams();
  if (v.oc) u.set('oc', v.oc);
  if (v.km !== 25) u.set('km', String(v.km));
  if (v.route) u.set('route', v.route);
  if (v.spec) u.set('spec', v.spec);
  if (v.q) u.set('q', v.q);
  if (v.region) u.set('region', v.region);
  for (const x of v.sectors) u.append('sector', x);
  for (const x of v.sizes) u.append('size', x);
  if (v.taken) u.set('taken', '1');
  if (v.onward) u.set('onward', '1');
  for (const x of v.sources) u.append('source', x);
  if (v.outside) u.set('outside', '1');
  if (v.core) u.set('core', '1');
  const w = v.weights;
  if (w.route_onward !== DEFAULT_WEIGHTS.route_onward) u.set('wr', String(w.route_onward));
  if (w.specialism_fit !== DEFAULT_WEIGHTS.specialism_fit) u.set('ws', String(w.specialism_fit));
  if (w.practicalities !== DEFAULT_WEIGHTS.practicalities) u.set('wp', String(w.practicalities));
  if (w.brand !== DEFAULT_WEIGHTS.brand) u.set('wb', String(w.brand));
  if (v.page > 1) u.set('page', String(v.page));
  const qs = u.toString();
  return qs ? `/search?${qs}` : '/search';
}
