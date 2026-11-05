import { NextResponse } from 'next/server';
import { publicDb } from '@/lib/supabase';

// GeoJSON for the map viewport. Clustered below zoom 10, individual sites
// above (capped at 2,000 in map_sites). Rounded bbox keeps responses
// cacheable at the edge.
// Allow for a cold database on the first search after a quiet spell (default is 10 s).
export const maxDuration = 30;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const n = (k: string) => Number.parseFloat(u.searchParams.get(k) ?? '');
  const [w, s, e, nn, z] = [n('w'), n('s'), n('e'), n('n'), Math.round(n('z'))];
  if (![w, s, e, nn, z].every(Number.isFinite) || w >= e || s >= nn) {
    return NextResponse.json({ error: 'bad bbox' }, { status: 400 });
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  const filters: Record<string, unknown> = {};
  const route = u.searchParams.get('route');
  if (route && /^[a-z_]{1,64}$/.test(route)) filters.route_id = route;
  if (u.searchParams.get('verified') === '1') filters.data_sources = ['verified'];
  if (u.searchParams.get('taken') === '1') filters.has_taken_tlevel = true;
  if (u.searchParams.get('live') === '1') filters.has_live_vacancies = true;

  const { data, error } = await publicDb().rpc('map_sites', {
    p_min_lng: round(w) - 0.01,
    p_min_lat: round(s) - 0.01,
    p_max_lng: round(e) + 0.01,
    p_max_lat: round(nn) + 0.01,
    p_zoom: z,
    p_filters: filters,
  });
  if (error) return NextResponse.json({ error: 'map query failed' }, { status: 502 });
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
