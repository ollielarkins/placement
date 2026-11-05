import { NextResponse } from 'next/server';
import { toOutwardCode } from '@/lib/outcode';

// The location form POSTs here so a full postcode never lands in a URL,
// browser history or a request log. We keep only the outward code and
// redirect (303) to the search page.
export async function POST(req: Request) {
  const form = await req.formData();
  const oc = toOutwardCode(String(form.get('postcode') ?? ''));
  const next = new URLSearchParams();
  if (oc) next.set('oc', oc);
  else if (String(form.get('postcode') ?? '').trim()) next.set('pcerror', '1');

  // Carry the other (non-personal) search fields through unchanged.
  for (const key of ['km', 'route', 'spec', 'q']) {
    const v = String(form.get(key) ?? '').trim();
    if (v) next.set(key, v);
  }
  const dest = String(form.get('dest') ?? '') === 'map' ? '/map' : '/search';
  return NextResponse.redirect(new URL(`${dest}?${next.toString()}`, req.url), 303);
}
