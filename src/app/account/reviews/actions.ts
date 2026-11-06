'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';
import { REPORT_REASONS } from '@/lib/reviews';

const UUID = /^[0-9a-f-]{36}$/i;
const rating = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

/** Screens a new post; the edge function decides whether a review goes live. */
async function screen(db: Awaited<ReturnType<typeof sessionDb>>, kind: 'review' | 'submission', id: string) {
  const { data } = await db.functions.invoke<{ status: string }>('moderate-post', { body: { kind, id } });
  return data?.status ?? null;
}

export async function submitReview(f: FormData) {
  const company = String(f.get('company') ?? '');
  const tracker = String(f.get('tracker') ?? '');
  const back = `/account/reviews/new?company=${company}`;
  if (!UUID.test(company) || !UUID.test(tracker)) redirect(`${back}&error=input`);
  const ratings = {
    overall: rating(f.get('overall')),
    learning: rating(f.get('learning')),
    support: rating(f.get('support')),
    route_onward: rating(f.get('route_onward')),
  };
  const body = String(f.get('body') ?? '').trim();
  const tips = String(f.get('tips') ?? '').trim();
  if (Object.values(ratings).some((x) => x === null)) redirect(`${back}&error=ratings`);
  if (body.length < 20 || body.length > 4000 || tips.length > 2000) redirect(`${back}&error=length`);
  if (f.get('no_names') !== 'on') redirect(`${back}&error=names`);

  const db = await sessionDb();
  const { data, error } = await db
    .from('reviews')
    .insert({ company_id: company, tracker_item_id: tracker, ratings, body, tips: tips || null })
    .select('id')
    .single();
  if (error || !data) redirect(`${back}&error=${error?.code === '23505' ? 'exists' : 'save'}`);
  const status = (await screen(db, 'review', data!.id)) ?? 'pending';
  revalidatePath(`/companies/${company}`);
  revalidatePath('/account/reviews');
  redirect(`/account/reviews?posted=${encodeURIComponent(status)}`);
}

export async function deleteReview(f: FormData) {
  const id = String(f.get('id') ?? '');
  if (!UUID.test(id)) redirect('/account/reviews');
  const db = await sessionDb();
  await db.from('reviews').delete().eq('id', id);
  revalidatePath('/account/reviews');
  redirect('/account/reviews');
}

export async function submitCompany(f: FormData) {
  const payload = {
    name: String(f.get('name') ?? '').trim().slice(0, 200),
    website: String(f.get('website') ?? '').trim().slice(0, 300) || undefined,
    location: String(f.get('location') ?? '').trim().slice(0, 100) || undefined,
    why: String(f.get('why') ?? '').trim().slice(0, 1000) || undefined,
  };
  if (payload.name.length < 2) redirect('/submit?error=name');
  const db = await sessionDb();
  const { data, error } = await db
    .from('company_submissions')
    .insert({ payload })
    .select('id, status, matched_company_id')
    .single();
  if (error || !data) {
    const code = error?.code === '54000' ? 'limit' : error?.message?.includes('website') ? 'website' : 'save';
    redirect(`/submit?error=${code}`);
  }
  const status = (await screen(db, 'submission', data!.id)) ?? data!.status;
  revalidatePath('/account/reviews');
  redirect(
    status === 'matched' && data!.matched_company_id
      ? `/account/reviews?suggested=matched&company=${data!.matched_company_id}`
      : `/account/reviews?suggested=${encodeURIComponent(status)}`,
  );
}

export async function fileReport(f: FormData) {
  const type = f.get('type') === 'company' ? 'company' : 'review';
  const id = String(f.get('id') ?? '');
  const back = String(f.get('back') ?? '/');
  const reason = String(f.get('reason') ?? '');
  const details = String(f.get('details') ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const safeBack = back.startsWith('/') && !back.startsWith('//') ? back : '/';
  if (!UUID.test(id) || !(reason in REPORT_REASONS)) redirect(`/report?type=${type}&id=${id}&back=${encodeURIComponent(safeBack)}&error=input`);
  const db = await sessionDb();
  const { error } = await db.from('reports').insert({ target_type: type, target_id: id, reason: details ? `${reason}: ${details}` : reason });
  redirect(`/report?type=${type}&id=${id}&back=${encodeURIComponent(safeBack)}&done=${error?.code === '23505' ? 'already' : error ? 'error' : 'ok'}`);
}
