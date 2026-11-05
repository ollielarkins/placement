'use server';

import { redirect } from 'next/navigation';
import { PRIVACY_NOTICE_VERSION, safeNext, sessionDb } from '@/lib/auth/session';

export async function confirmAge(formData: FormData) {
  const next = safeNext(String(formData.get('next') ?? ''));
  if (formData.get('over16') !== 'yes' || formData.get('privacy') !== 'yes') redirect(`/welcome?error=1&next=${encodeURIComponent(next)}`);
  const db = await sessionDb();
  const { error } = await db.rpc('confirm_age', { p_privacy_notice_version: PRIVACY_NOTICE_VERSION });
  if (error) redirect(`/welcome?error=2&next=${encodeURIComponent(next)}`);
  redirect(next);
}

/** Under 16: the account is deleted straight away (ICO Children's Code). */
export async function underSixteen() {
  const db = await sessionDb();
  await db.rpc('delete_my_account');
  await db.auth.signOut();
  redirect('/under-16');
}

export async function deleteAccount(formData: FormData) {
  if (formData.get('confirm') !== 'delete') redirect('/account?error=confirm');
  const db = await sessionDb();
  const { error } = await db.rpc('delete_my_account');
  if (error) redirect('/account?error=delete');
  await db.auth.signOut();
  redirect('/?deleted=1');
}
