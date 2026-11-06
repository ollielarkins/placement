'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';

const UUID = /^[0-9a-f-]{36}$/i;

/** Every action re-checks the role; RLS and the audit trigger back this up. */
async function adminDb() {
  const db = await sessionDb();
  const { data } = await db.auth.getUser();
  if (data.user?.app_metadata?.role !== 'admin') redirect('/');
  return { db, uid: data.user.id };
}
const id = (f: FormData, k = 'id') => {
  const v = String(f.get(k) ?? '');
  if (!UUID.test(v)) redirect('/admin?error=input');
  return v;
};
const done = (msg: string) => {
  revalidatePath('/admin');
  redirect(`/admin?done=${encodeURIComponent(msg)}`);
};

export async function publishReview(f: FormData) {
  const { db } = await adminDb();
  const { error } = await db.from('reviews').update({ status: 'published' }).eq('id', id(f));
  if (error) redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  done('Review published');
}

export async function removeReview(f: FormData) {
  const { db } = await adminDb();
  await db.from('reviews').update({ status: 'removed' }).eq('id', id(f));
  done('Review removed');
}

export async function rescreen(f: FormData) {
  const { db } = await adminDb();
  const kind = f.get('kind') === 'submission' ? 'submission' : 'review';
  const { data, error } = await db.functions.invoke<{ status: string }>('moderate-post', { body: { kind, id: id(f) } });
  done(error ? 'Screening failed' : `Screened: ${data?.status ?? 'done'}`);
}

export async function resolveAlert(f: FormData) {
  const { db, uid } = await adminDb();
  await db.from('admin_alerts').update({ resolved_at: new Date().toISOString(), resolved_by: uid }).eq('id', id(f));
  done('Alert closed');
}

export async function createCompany(f: FormData) {
  const { db } = await adminDb();
  const { data, error } = await db.rpc('admin_create_company', { p_submission: id(f) });
  if (error) redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  revalidatePath('/admin');
  redirect(`/companies/${data}`);
}

export async function linkSubmission(f: FormData) {
  const { db } = await adminDb();
  await db.from('company_submissions').update({ status: 'matched', matched_company_id: id(f, 'company') }).eq('id', id(f));
  done('Linked to the existing company');
}

export async function rejectSubmission(f: FormData) {
  const { db } = await adminDb();
  await db.from('company_submissions').update({ status: 'rejected' }).eq('id', id(f));
  done('Suggestion rejected');
}

export async function resolveReport(f: FormData) {
  const { db } = await adminDb();
  const outcome = f.get('outcome') === 'upheld' ? 'upheld' : 'dismissed';
  const reportId = id(f);
  const { data: r } = await db.from('reports').select('target_type, target_id').eq('id', reportId).single();
  // Closing one report closes every open report on the same thing.
  if (r) {
    await db.from('reports').update({ status: outcome }).eq('target_type', r.target_type).eq('target_id', r.target_id).eq('status', 'open');
    if (r.target_type === 'review' && outcome === 'upheld') await db.from('reviews').update({ status: 'removed' }).eq('id', r.target_id);
  }
  done(outcome === 'upheld' ? 'Report upheld' : 'Report dismissed');
}
