// Postcode geocoding via postcodes.io (ONS Postcode Directory, OGL).
// Bulk lookups of 100, cached on disk so re-runs and later imports are cheap.
// Only full postcodes of organisations go through here. Student postcodes are
// reduced to an outward code in the app and never sent to a third party.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EnglandRegion } from '../../src/types/domain.ts';

export interface PostcodeFix {
  postcode: string; // canonical form, e.g. "MK45 1AB"
  lat: number;
  lon: number;
  country: string; // "England", "Wales", ...
  region: EnglandRegion | null; // null outside England
  county: string | null; // admin county, else the district (unitaries)
}

const REGION_BY_ONS_NAME: Record<string, EnglandRegion> = {
  'North East': 'north_east',
  'North West': 'north_west',
  'Yorkshire and The Humber': 'yorkshire_and_the_humber',
  'East Midlands': 'east_midlands',
  'West Midlands': 'west_midlands',
  'East of England': 'east_of_england',
  London: 'london',
  'South East': 'south_east',
  'South West': 'south_west',
};

export function regionFromOnsName(name: string | null | undefined): EnglandRegion | null {
  if (!name) return null;
  return REGION_BY_ONS_NAME[name] ?? REGION_BY_ONS_NAME[name.replace(/ the /i, ' The ')] ?? null;
}

const POSTCODE_RE = /^([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][A-Z]{2})$/;

/** Uppercase, single space before the inward code. Null if it isn't a UK postcode shape. */
export function normalisePostcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^([A-Z0-9]+)([0-9][A-Z]{2})$/);
  if (!m) return null;
  const pc = `${m[1]} ${m[2]}`;
  return POSTCODE_RE.test(pc) ? pc : null;
}

interface ApiResult {
  query: string;
  result: null | {
    postcode: string;
    latitude: number | null;
    longitude: number | null;
    country: string;
    region: string | null;
    admin_county: string | null;
    admin_district: string | null;
  };
}

type CacheEntry = PostcodeFix | null; // null = postcodes.io doesn't know it (terminated, typo)

export class PostcodeGeocoder {
  private cache: Map<string, CacheEntry>;
  private dirty = 0;

  constructor(
    private readonly cachePath: string,
    private readonly endpoint = 'https://api.postcodes.io/postcodes',
  ) {
    this.cache = existsSync(cachePath)
      ? new Map(Object.entries(JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, CacheEntry>))
      : new Map();
  }

  get size(): number {
    return this.cache.size;
  }

  /** Geocode many postcodes. Returns a map keyed by normalised postcode. */
  async lookupMany(
    postcodes: Iterable<string>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, PostcodeFix | null>> {
    const wanted = new Set<string>();
    for (const p of postcodes) {
      const n = normalisePostcode(p);
      if (n) wanted.add(n);
    }
    const missing = [...wanted].filter((p) => !this.cache.has(p));
    for (let i = 0; i < missing.length; i += 100) {
      await this.fetchBatch(missing.slice(i, i + 100));
      onProgress?.(Math.min(i + 100, missing.length), missing.length);
      if (this.dirty >= 5000) this.save();
    }
    // Registered offices often sit on postcodes that have since been
    // terminated. postcodes.io still knows where they were; take the region
    // and county from the nearest live postcode.
    const unknown = missing.filter((p) => this.cache.get(p) === null);
    for (let i = 0; i < unknown.length; i += 8) {
      await Promise.all(unknown.slice(i, i + 8).map((p) => this.fetchTerminated(p)));
    }
    this.save();
    const out = new Map<string, PostcodeFix | null>();
    for (const p of wanted) out.set(p, this.cache.get(p) ?? null);
    return out;
  }

  private async fetchBatch(batch: string[], attempt = 1): Promise<void> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`postcodes.io ${res.status}`);
      if (!res.ok) throw new Error(`postcodes.io ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { result: ApiResult[] };
      for (const { query, result: r } of body.result) {
        const key = normalisePostcode(query) ?? query;
        if (!r || r.latitude == null || r.longitude == null) {
          this.cache.set(key, null);
        } else {
          this.cache.set(key, {
            postcode: r.postcode,
            lat: r.latitude,
            lon: r.longitude,
            country: r.country,
            region: r.country === 'England' ? regionFromOnsName(r.region) : null,
            county: r.admin_county ?? r.admin_district ?? null,
          });
        }
        this.dirty++;
      }
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return this.fetchBatch(batch, attempt + 1);
    }
  }

  private async getJson<T>(url: string, attempt = 1): Promise<T | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`postcodes.io ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return this.getJson<T>(url, attempt + 1);
    }
  }

  private async fetchTerminated(postcode: string): Promise<void> {
    const base = this.endpoint.replace(/\/postcodes$/, '');
    const t = await this.getJson<{ result: { latitude: number | null; longitude: number | null } }>(
      `${base}/terminated_postcodes/${encodeURIComponent(postcode)}`,
    );
    const lat = t?.result.latitude;
    const lon = t?.result.longitude;
    if (lat == null || lon == null) return; // stays null: genuinely unknown
    const near = await this.getJson<{ result: ApiResult['result'][] | null }>(
      `${base}/postcodes?lon=${lon}&lat=${lat}&limit=1&radius=2000`,
    );
    const r = near?.result?.[0];
    this.cache.set(postcode, {
      postcode,
      lat,
      lon,
      country: r?.country ?? 'unknown',
      region: r && r.country === 'England' ? regionFromOnsName(r.region) : null,
      county: r ? (r.admin_county ?? r.admin_district ?? null) : null,
    });
    this.dirty++;
  }

  save(): void {
    if (this.dirty === 0 && existsSync(this.cachePath)) return;
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify(Object.fromEntries(this.cache)));
    this.dirty = 0;
  }
}
