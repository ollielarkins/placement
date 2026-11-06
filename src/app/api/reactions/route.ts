import { NextResponse, type NextRequest } from 'next/server';
import { sessionDb } from '@/lib/auth/session';

// The signed-in student's reactions of one type, so card mode can skip what
// they've already swiped. Per user: never cached.
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!['company', 'course', 'vacancy'].includes(type ?? '') || !req.cookies.getAll().some((c) => c.name.startsWith('sb-'))) {
    return NextResponse.json({ signedIn: false, liked: [], disliked: [] }, { headers });
  }
  const db = await sessionDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ signedIn: false, liked: [], disliked: [] }, { headers });
  const { data } = await db.from('reactions').select('item_id, reaction').eq('item_type', type!).limit(5000);
  const rows = data ?? [];
  return NextResponse.json(
    {
      signedIn: true,
      liked: rows.filter((r) => r.reaction === 'like').map((r) => r.item_id),
      disliked: rows.filter((r) => r.reaction === 'dislike').map((r) => r.item_id),
    },
    { headers },
  );
}
