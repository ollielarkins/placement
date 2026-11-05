'use server';

import { redirect } from 'next/navigation';
import { safeNext, sessionDb, siteOrigin } from '@/lib/auth/session';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const next = safeNext(String(formData.get('next') ?? ''));
  if (!EMAIL.test(email) || email.length > 254) redirect(`/sign-in?error=email&next=${encodeURIComponent(next)}`);
  const db = await sessionDb();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true },
  });
  // The address never goes in a URL or a log; the page just says "check your email".
  if (error) redirect(`/sign-in?error=${error.status === 429 ? 'rate' : 'send'}&next=${encodeURIComponent(next)}`);
  redirect(`/sign-in?sent=1`);
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNext(String(formData.get('next') ?? ''));
  const db = await sessionDb();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/sign-in?error=google&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}
