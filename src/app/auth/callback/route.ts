import { NextResponse, type NextRequest } from 'next/server';
import { safeNext, sessionDb } from '@/lib/auth/session';

// Magic links and Google both land here with ?code=... (PKCE).
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (code) {
    const db = await sessionDb();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/sign-in?error=link', url.origin));
}
