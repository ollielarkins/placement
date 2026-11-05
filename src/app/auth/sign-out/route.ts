import { NextResponse, type NextRequest } from 'next/server';
import { sessionDb } from '@/lib/auth/session';

// POST only, so a link or prefetch can't sign anyone out.
export async function POST(request: NextRequest) {
  const db = await sessionDb();
  await db.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
