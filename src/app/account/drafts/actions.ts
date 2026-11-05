'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';

const UUID = /^[0-9a-f-]{36}$/i;
const CHANNELS = ['email', 'linkedin', 'application_cover_note'];

export async function createDraft(f: FormData) {
  const company = String(f.get('company') ?? '');
  const channel = String(f.get('channel') ?? '');
  const purpose = f.get('purpose') === 'follow_up' ? 'follow_up' : 'placement';
  const back = `/account/drafts/new?company=${company}&channel=${channel}&purpose=${purpose}`;
  if (!UUID.test(company) || !CHANNELS.includes(channel)) redirect(`${back}&error=input`);
  const db = await sessionDb();
  const { data, error } = await db.functions.invoke<{ id: string }>('draft-outreach', {
    body: { company_id: company, channel, purpose },
  });
  if (error || !data?.id) {
    let code = 'model';
    try {
      const ctx = (error as { context?: Response } | null)?.context;
      code = ((await ctx?.json()) as { error?: string } | undefined)?.error ?? code;
    } catch {
      /* keep the default */
    }
    redirect(`${back}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath('/account/drafts');
  redirect(`/account/drafts/${data!.id}`);
}

export async function saveDraft(f: FormData) {
  const id = String(f.get('id') ?? '');
  if (!UUID.test(id)) redirect('/account/drafts');
  const db = await sessionDb();
  await db
    .from('outreach_drafts')
    .update({
      subject: String(f.get('subject') ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || null,
      body: String(f.get('body') ?? '').trim().slice(0, 5000) || ' ',
    })
    .eq('id', id);
  redirect(`/account/drafts/${id}?saved=1`);
}

/** "I've sent it": stamps the draft and moves the company to Contacted. */
export async function markSent(f: FormData) {
  const id = String(f.get('id') ?? '');
  if (!UUID.test(id)) redirect('/account/drafts');
  const db = await sessionDb();
  const { data: d } = await db.from('outreach_drafts').select('company_id, channel').eq('id', id).single();
  if (!d) redirect('/account/drafts');
  await db.from('outreach_drafts').update({ sent_at: new Date().toISOString() }).eq('id', id);
  const how = d!.channel === 'linkedin' ? 'LinkedIn message' : d!.channel === 'email' ? 'Email' : 'Application form';
  const { data: item } = await db.from('tracker_items').select('id, stage').eq('company_id', d!.company_id).maybeSingle();
  if (!item) {
    await db.from('tracker_items').insert({ company_id: d!.company_id, stage: 'contacted', contact_used: how });
  } else if (item.stage === 'researching') {
    await db.from('tracker_items').update({ stage: 'contacted', contact_used: how }).eq('id', item.id);
  }
  revalidatePath('/account/shortlist');
  redirect(`/account/drafts/${id}?sent=1`);
}

export async function deleteDraft(f: FormData) {
  const id = String(f.get('id') ?? '');
  if (UUID.test(id)) {
    const db = await sessionDb();
    await db.from('outreach_drafts').delete().eq('id', id);
  }
  revalidatePath('/account/drafts');
  redirect('/account/drafts?deleted=1');
}
