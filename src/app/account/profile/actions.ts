'use server';

import { redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';
import { lookupOutcode, toOutwardCode } from '@/lib/outcode';
import { PATTERNS, TRAVEL_KM, TRAVEL_MODES, parseTags } from '@/lib/profile';
import { referenceData } from '@/lib/data';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const fail = (code: string): never => redirect(`/account/profile?error=${code}`);

export async function saveProfile(f: FormData) {
  const db = await sessionDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect('/sign-in?next=/account/profile');

  // T Level and specialism must exist and belong together.
  const ref = await referenceData();
  const routeId = str(f, 'route') || null;
  const specialism = str(f, 'spec') || null;
  const route = routeId ? ref.routes.find((r) => r.id === routeId) : null;
  if (routeId && !route) fail('route');
  if (specialism && !route?.specialisms.some((s) => s.id === specialism)) fail('spec');

  // Postcode: only the outward code is kept, with its centre point.
  const pcRaw = str(f, 'postcode');
  let home_outcode: string | null = null;
  let home_location: string | null = null;
  if (pcRaw) {
    const oc = toOutwardCode(pcRaw);
    const centre = oc ? await lookupOutcode(oc).catch(() => null) : null;
    if (!oc || !centre) fail('postcode');
    home_outcode = centre!.outcode;
    home_location = `SRID=4326;POINT(${centre!.lng} ${centre!.lat})`;
  }

  const km = Number(str(f, 'km'));
  const travel = str(f, 'travel') || null;
  const pattern = str(f, 'pattern') || null;
  const starts = str(f, 'starts') || null;
  const ends = str(f, 'ends') || null;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if ((starts && !iso.test(starts)) || (ends && !iso.test(ends))) fail('dates');
  if (starts && ends && ends < starts) fail('dates');

  const w = (k: string) => Math.min(100, Math.max(0, Math.round(Number(str(f, k)) || 0)));
  const weights = { route_onward: w('wr'), specialism_fit: w('ws'), practicalities: w('wp'), brand: w('wb') };
  if (Object.values(weights).every((v) => v === 0)) fail('weights');

  const { error } = await db
    .from('profiles')
    .update({
      route_id: routeId,
      specialism,
      college_id: str(f, 'college') || null,
      home_outcode,
      home_location,
      max_travel_km: TRAVEL_KM.some((t) => t.km === km) ? km : 25,
      travel_mode: TRAVEL_MODES.some((t) => t.id === travel) ? travel : null,
      placement_pattern: PATTERNS.some((p) => p.id === pattern) ? pattern : null,
      placement_starts_on: starts,
      placement_ends_on: ends,
      interests: parseTags(str(f, 'interests'), 10),
      skills: parseTags(str(f, 'skills'), 20),
      about: str(f, 'about').slice(0, 1000) || null,
      weights,
    })
    .eq('user_id', auth.user!.id);
  if (error) fail('save');
  redirect('/account?saved=1');
}
