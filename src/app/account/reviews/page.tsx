import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { displayName, ukDate } from '@/lib/format';
import { deleteReview } from './actions';

export const metadata: Metadata = { title: 'Your reviews and suggestions' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const REVIEW_STATUS: Record<string, { label: string; help: string }> = {
  published: { label: 'Published', help: 'Live on the company page.' },
  pending: { label: 'Being checked', help: 'We’re checking it. This usually takes a moment.' },
  held: { label: 'Waiting for a person', help: 'A person will read it before it goes live, usually within a few days.' },
  removed: { label: 'Not published', help: 'It didn’t meet the review rules.' },
};
const SUBMISSION_STATUS: Record<string, string> = {
  pending: 'Thanks. We’ll check it and add it if it fits.',
  matched: 'We already list this company.',
  created: 'Added to the site.',
  rejected: 'Not added.',
};

export default async function MyReviewsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { ageConfirmed } = await requireUser('/account/reviews');
  if (!ageConfirmed) redirect('/welcome?next=/account/reviews');
  const db = await sessionDb();
  const [{ data: reviews }, { data: subs }] = await Promise.all([
    db.from('reviews').select('id, company_id, status, created_at, published_at, companies(name)').order('created_at', { ascending: false }),
    db.from('company_submissions').select('id, payload, status, matched_company_id, created_at').order('created_at', { ascending: false }).limit(50),
  ]);
  const posted = typeof sp.posted === 'string' ? sp.posted : null;
  const suggested = typeof sp.suggested === 'string' ? sp.suggested : null;

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm"><Link href="/account" className="text-brand-700 underline">Your account</Link></p>
        <h1 className="display text-3xl sm:text-4xl">Your reviews and suggestions</h1>
      </header>

      {posted ? (
        <p role="status" className="border-2 border-ink bg-volt p-3 font-semibold">
          {posted === 'published' ? 'Thanks! Your review is live.' : 'Thanks! A person will read your review before it goes live.'}
        </p>
      ) : null}
      {suggested ? (
        <p role="status" className="border-2 border-ink bg-volt p-3 font-semibold">
          {suggested === 'matched' ? (
            <>
              We already list that company.{' '}
              {typeof sp.company === 'string' ? <Link href={`/companies/${sp.company}`} className="underline">Open its page</Link> : null}
            </>
          ) : suggested === 'rejected' ? (
            'Thanks, but we couldn’t add that suggestion.'
          ) : (
            'Thanks! We’ll check your suggestion and add it if it fits.'
          )}
        </p>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-xl font-bold">Reviews</h2>
        {reviews?.length ? (
          <ul className="grid gap-3">
            {reviews.map((r) => {
              const st = REVIEW_STATUS[r.status] ?? REVIEW_STATUS.pending!;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink bg-white p-4">
                  <div>
                    <Link href={`/companies/${r.company_id}`} className="font-bold hover:underline">
                      {displayName((r.companies as unknown as { name: string } | null)?.name ?? 'Company')}
                    </Link>
                    <p className="text-sm text-slate-600">
                      <span className="font-semibold text-ink">{st.label}</span> · {st.help} Written {ukDate(r.created_at)}.
                    </p>
                  </div>
                  <form action={deleteReview}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-sm text-red-700 underline">Delete</button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-slate-700">
            No reviews yet. When a placement on your <Link href="/account/shortlist" className="underline">shortlist</Link> is
            Secured, you can review it.
          </p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-bold">Companies you suggested</h2>
        {subs?.length ? (
          <ul className="grid gap-2">
            {subs.map((s) => (
              <li key={s.id} className="border-2 border-ink bg-white p-3 text-sm">
                <span className="font-bold">{(s.payload as { name: string }).name}</span> ·{' '}
                {s.matched_company_id && (s.status === 'matched' || s.status === 'created') ? (
                  <Link href={`/companies/${s.matched_company_id}`} className="underline">{SUBMISSION_STATUS[s.status]}</Link>
                ) : (
                  SUBMISSION_STATUS[s.status]
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/submit" className="w-fit border-2 border-ink px-4 py-2 font-bold hover:bg-volt">
          Suggest a company
        </Link>
      </section>
    </div>
  );
}
