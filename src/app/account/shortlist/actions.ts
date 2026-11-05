'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';
import { isStage } from '@/lib/tracker';

const UUID = /^[0-9a-f-]{36}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type SaveResult = 'saved' | 'already' | 'signin' | 'confirm' | 'full' | 'error';

/** Called from the save button on company pages and results. */
export async function saveCompany(companyId: string): Promise<SaveResult> {
  if (!UUID.test(companyId)) return 'error';
  const db = await sessionDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return 'signin';
  const { error } = await db.from('tracker_items').insert({ company_id: companyId });
  if (!error) {
    revalidatePath('/account/shortlist');
    return 'saved';
  }
  if (error.code === '23505') return 'already';
  if (error.code === '42501') return 'confirm'; // RLS: age not confirmed yet
  if (error.code === '54000') return 'full';
  return 'error';
}

export async function updateItem(f: FormData) {
  const id = String(f.get('id') ?? '');
  const stage = String(f.get('stage') ?? '');
  const follow = String(f.get('follow_up_on') ?? '').trim();
  const contacted = String(f.get('contacted_at') ?? '').trim();
  if (!UUID.test(id) || !isStage(stage)) redirect('/account/shortlist?error=1');
  if ((follow && !ISO.test(follow)) || (contacted && !ISO.test(contacted))) redirect('/account/shortlist?error=1');
  const db = await sessionDb();
  const { error } = await db
    .from('tracker_items')
    .update({
      stage,
      follow_up_on: follow || null,
      contacted_at: contacted || null,
      contact_used: String(f.get('contact_used') ?? '').trim().slice(0, 200) || null,
      notes: String(f.get('notes') ?? '').trim().slice(0, 5000) || null,
    })
    .eq('id', id);
  if (error) redirect('/account/shortlist?error=1');
  revalidatePath('/account/shortlist');
  redirect(`/account/shortlist?saved=1#t-${id}`);
}

export async function removeItem(f: FormData) {
  const id = String(f.get('id') ?? '');
  if (!UUID.test(id)) redirect('/account/shortlist?error=1');
  const db = await sessionDb();
  await db.from('tracker_items').delete().eq('id', id);
  revalidatePath('/account/shortlist');
  redirect('/account/shortlist?removed=1');
}
