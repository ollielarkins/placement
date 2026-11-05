import 'server-only';
import { cached } from './supabase';

// Students' locations are reduced to the OUTWARD code (MK45, SW1A, B1) as
// early as possible, on the server: the full postcode is never stored, put in
// a URL, logged or sent to a third party. Only the outward code goes to
// postcodes.io to find its centroid.

const OUTWARD = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const FULL = /^([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})$/;

/** "mk45 1ab" -> "MK45", "MK45" -> "MK45", anything else -> null. */
export function toOutwardCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 9) return null;
  const full = s.replace(/ /g, '').match(FULL);
  if (full) return full[1]!;
  const out = s.replace(/ /g, '');
  return OUTWARD.test(out) ? out : null;
}

export interface OutcodeCentroid {
  outcode: string;
  lat: number;
  lng: number;
  inEngland: boolean;
}

export async function lookupOutcode(outcode: string): Promise<OutcodeCentroid | null> {
  if (!OUTWARD.test(outcode)) return null;
  return cached(`outcode:${outcode}`, 24 * 60 * 60 * 1000, async () => {
    const res = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`postcodes.io ${res.status}`);
    const body = (await res.json()) as {
      result: { latitude: number | null; longitude: number | null; country: string[] | null } | null;
    };
    const r = body.result;
    if (!r || r.latitude == null || r.longitude == null) return null;
    return {
      outcode,
      lat: r.latitude,
      lng: r.longitude,
      inEngland: (r.country ?? []).includes('England'),
    };
  });
}
