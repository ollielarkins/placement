import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CopyButton } from '@/components/CopyButton';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { CHANNEL_LABEL } from '@/lib/drafts';
import { displayName, ukDate } from '@/lib/format';
import { deleteDraft, markSent, saveDraft } from '../actions';

export const metadata: Metadata = { title: 'Your draft' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function DraftPage({ params, searchParams }: Props) {
  const { id } = await params;
  const p = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { ageConfirmed } = await requireUser(`/account/drafts/${id}`);
  if (!ageConfirmed) redirect('/welcome');
  const db = await sessionDb();
  const { data: d } = await db
    .from('outreach_drafts')
    .select('id, company_id, channel, subject, body, created_at, sent_at, companies(name)')
    .eq('id', id)
    .maybeSingle();
  if (!d) notFound();
  const { data: contacts } = await db
    .from('company_contacts')
    .select('kind, value')
    .eq('company_id', d.company_id)
    .in('kind', ['email', 'contact_form', 'apply_page', 'careers_page'])
    .limit(6);
  const name = displayName((d.companies as unknown as { name: string } | null)?.name ?? 'the company');
  const placeholders = [...new Set(d.body.match(/\[[^\]]{1,40}\]/g) ?? [])];
  const full = d.subject ? `Subject: ${d.subject}\n\n${d.body}` : d.body;

  return (
    <div className="grid max-w-2xl gap-5">
      <header className="grid gap-1">
        <p className="text-sm"><Link href="/account/drafts" className="text-brand-700 underline">Your drafts</Link></p>
        <h1 className="display text-3xl sm:text-4xl">{CHANNEL_LABEL[d.channel]} to {name}</h1>
        <p className="text-sm text-slate-600">
          Drafted {ukDate(d.created_at)}{d.sent_at ? ` · you sent it ${ukDate(d.sent_at)}` : ''}. Check every line before
          you send it: it’s your message.
        </p>
      </header>

      {p.saved ? <p role="status" className="border-2 border-ink bg-volt p-3 text-sm font-medium">Saved.</p> : null}
      {p.sent ? (
        <p role="status" className="border-2 border-ink bg-volt p-3 text-sm font-medium">
          Marked as sent. {name} is now under Contacted on your <Link href="/account/shortlist" className="underline">shortlist</Link>.
          Set a follow-up date there for about a week’s time.
        </p>
      ) : null}
      {placeholders.length ? (
        <p className="border-2 border-dashed border-ink bg-white p-3 text-sm">
          Fill in before sending: {placeholders.join(', ')}
        </p>
      ) : null}

      <form action={saveDraft} className="grid gap-3 border-2 border-ink bg-white p-4">
        <input type="hidden" name="id" value={d.id} />
        {d.channel === 'email' ? (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Subject</span>
            <input name="subject" defaultValue={d.subject ?? ''} maxLength={200} className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Message</span>
          <textarea name="body" defaultValue={d.body} rows={14} maxLength={5000} className="rounded-md border border-slate-300 px-3 py-2 font-[inherit]" />
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="border-2 border-ink bg-ink px-4 py-2 text-sm font-bold text-volt hover:bg-volt hover:text-ink">Save changes</button>
          <CopyButton text={full} />
        </div>
      </form>

      {contacts?.length ? (
        <section className="border-2 border-ink bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">Where to send it</h2>
          <ul className="grid gap-1">
            {contacts.map((k) => (
              <li key={k.value}>
                {k.kind === 'email' ? (
                  <a className="text-brand-700 underline" href={`mailto:${k.value}`}>{k.value}</a>
                ) : (
                  <a className="text-brand-700 underline" href={k.value} rel="noopener noreferrer nofollow" target="_blank">
                    {k.kind === 'contact_form' ? 'Contact form' : k.kind === 'apply_page' ? 'Apply online' : 'Careers page'}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">General company contacts we found. Check they’re right on the company’s own website.</p>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        {!d.sent_at ? (
          <form action={markSent}>
            <input type="hidden" name="id" value={d.id} />
            <button type="submit" className="rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
              I’ve sent it
            </button>
          </form>
        ) : null}
        <form action={deleteDraft}>
          <input type="hidden" name="id" value={d.id} />
          <button type="submit" className="text-sm text-red-700 underline">Delete draft</button>
        </form>
      </div>
    </div>
  );
}
