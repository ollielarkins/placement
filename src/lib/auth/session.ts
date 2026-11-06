import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

// Signed-in pages only. Public pages (search, map, companies) keep using the
// cookie-free anon client in lib/supabase.ts so they stay cacheable.
export async function sessionDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component: cookies are read-only there. The
          // proxy (src/proxy.ts) refreshes the session on the next request.
        }
      },
    },
  });
}

/** The verified signed-in user (checked with the auth server), or null. */
export async function currentUser(): Promise<User | null> {
  const db = await sessionDb();
  const { data } = await db.auth.getUser();
  return data.user ?? null;
}

export interface AccountState {
  user: User;
  ageConfirmed: boolean;
}

/** For pages that need an account: sends signed-out visitors to sign in. */
export async function requireUser(next: string): Promise<AccountState> {
  const db = await sessionDb();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const { data: profile } = await db.from('profiles').select('age_confirmed_at').eq('user_id', data.user.id).maybeSingle();
  return { user: data.user, ageConfirmed: Boolean(profile?.age_confirmed_at) };
}

/** Our own origin, for auth redirect links. */
export async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Only same-site relative paths, so ?next= can't send anyone elsewhere. */
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  return next && next.length <= 1000 && /^\/(?!\/)[\w\-./?=&%,+:]*$/.test(next) ? next : fallback;
}

export const PRIVACY_NOTICE_VERSION = '2026-11-06';
