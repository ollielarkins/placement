import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { CHANNEL_LABEL } from '@/lib/drafts';
import { displayName, ukDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Your drafts' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function DraftsPage({ searchParams }: Props) {
  const p = await searchParams;
  const { user, ageConfirmed } = await requireUser('/account/drafts');
  if (!ageConfirmed) redirect('/welcome?next=/account/drafts');
  const db = await sessionDb();
  const { data } = await db
    .from('outreach_drafts')
    .select('id, channel, subject, created_at, sent_at, companies(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  const drafts = data ?? [];
  return (
    <div className="grid max-w-2xl gap-5">
      <header className="grid gap-1">
        <p className="text-sm"><Link href="/account" className="text-brand-700 underline">Your account</Link></p>
        <h1 className="display text-3xl sm:text-4xl">Your drafts</h1>
        <p className="text-sm text-slate-600">Start a new one from any company on your <Link href="/account/shortlist" className="underline">shortlist</Link>.</p>
      </header>
      {p.deleted ? <p role="status" className="border-2 border-ink bg-white p-3 text-sm">Draft deleted.</p> : null}
      {drafts.length ? (
        <ul className="grid gap-2">
          {drafts.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <Link href={`/account/drafts/${d.id}`} className="font-medium hover:underline">
                {CHANNEL_LABEL[d.channel]} to {displayName((d.companies as unknown as { name: string } | null)?.name ?? 'company')}
              </Link>
              <p className="text-xs text-slate-500">
                {d.subject ? `${d.subject} · ` : ''}drafted {ukDate(d.created_at)}{d.sent_at ? ` · sent ${ukDate(d.sent_at)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-2 border-dashed border-ink bg-white p-6 text-slate-700">No drafts yet.</p>
      )}
    </div>
  );
}
