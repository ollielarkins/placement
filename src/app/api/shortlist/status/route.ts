import { NextResponse, type NextRequest } from 'next/server';
import { sessionDb } from '@/lib/auth/session';

// Which of these companies are on the signed-in student's shortlist. Per
// user, so never cached; public pages call it from the browser so they can
// stay cacheable themselves.
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
    .slice(0, 50);
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!ids.length || !req.cookies.getAll().some((c) => c.name.startsWith('sb-'))) {
    return NextResponse.json({ signedIn: false, saved: [] }, { headers });
  }
  const db = await sessionDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ signedIn: false, saved: [] }, { headers });
  const { data } = await db.from('tracker_items').select('company_id').in('company_id', ids);
  return NextResponse.json({ signedIn: true, saved: (data ?? []).map((r) => r.company_id) }, { headers });
}
