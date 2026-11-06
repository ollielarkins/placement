import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PendingButton } from '@/components/PendingButton';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { displayName } from '@/lib/format';
import { RATING_LABEL } from '@/lib/reviews';
import { submitReview } from '../actions';

export const metadata: Metadata = { title: 'Review your placement' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const ERRORS: Record<string, string> = {
  input: 'Something went wrong. Open the form again from the company page.',
  ratings: 'Give all four ratings, from 1 to 5.',
  length: 'Write at least 20 characters about what you did (up to 4,000), and keep tips under 2,000.',
  names: 'Tick the box to confirm you haven’t named anyone or shared contact details.',
  exists: 'You’ve already reviewed this placement.',
  save: 'That didn’t save. Try again in a minute.',
};

export default async function NewReviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const company = typeof sp.company === 'string' && /^[0-9a-f-]{36}$/i.test(sp.company) ? sp.company : null;
  if (!company) redirect('/account/shortlist');
  const { ageConfirmed } = await requireUser(`/account/reviews/new?company=${company}`);
  if (!ageConfirmed) redirect(`/welcome?next=${encodeURIComponent(`/account/reviews/new?company=${company}`)}`);
  const db = await sessionDb();
  const [{ data: c }, { data: mine }] = await Promise.all([
    db.from('companies').select('id, name').eq('id', company).maybeSingle(),
    db.rpc('my_review_status', { p_company: company }),
  ]);
  if (!c) redirect('/account/shortlist');
  const state = (mine ?? {}) as { tracker_item_id: string | null; review: { id: string; status: string } | null };
  const name = displayName(c.name);
  const error = typeof sp.error === 'string' ? ERRORS[sp.error] : null;

  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <p className="text-sm">
          <Link href={`/companies/${c.id}`} className="text-brand-700 underline">{name}</Link>
        </p>
        <h1 className="display text-3xl sm:text-4xl">Review your placement</h1>
        <p className="text-slate-700">
          Help the next T Level student decide. Your review shows only your T Level and the year, never your name.
        </p>
      </header>

      {state.review ? (
        <p className="border-2 border-ink bg-white p-4">
          You’ve already reviewed {name}. See it in <Link href="/account/reviews" className="underline">your reviews</Link>.
        </p>
      ) : !state.tracker_item_id ? (
        <div className="grid gap-2 border-2 border-dashed border-ink bg-white p-4">
          <p className="font-semibold">Reviews are for placements you’ve secured.</p>
          <p className="text-slate-700">
            Add {name} to your <Link href="/account/shortlist" className="underline">shortlist</Link> and move it to
            <strong> Secured</strong>, then come back here. That keeps reviews to students who really did a placement there.
          </p>
        </div>
      ) : (
        <form action={submitReview} className="grid gap-5 border-2 border-ink bg-white p-4">
          <input type="hidden" name="company" value={c.id} />
          <input type="hidden" name="tracker" value={state.tracker_item_id} />
          {error ? <p role="alert" className="border-2 border-red-700 p-2 text-sm text-red-800">{error}</p> : null}

          <fieldset className="grid gap-3">
            <legend className="mb-1 font-semibold">Ratings (1 = poor, 5 = excellent)</legend>
            {(Object.keys(RATING_LABEL) as (keyof typeof RATING_LABEL)[]).map((k) => (
              <div key={k} className="grid gap-1 sm:grid-cols-[16rem_1fr] sm:items-center">
                <span className="text-sm font-medium" id={`l-${k}`}>{RATING_LABEL[k]}</span>
                <div role="radiogroup" aria-labelledby={`l-${k}`} className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="cursor-pointer">
                      <input type="radio" name={k} value={n} required className="peer sr-only" />
                      <span className="grid h-10 w-10 place-items-center border-2 border-ink font-bold peer-checked:bg-volt peer-focus-visible:outline peer-focus-visible:outline-2">
                        {n}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>

          <label className="grid gap-1">
            <span className="font-semibold">What did you do there?</span>
            <span className="text-xs text-slate-600">The work, what you learned, what the place was like. At least 20 characters.</span>
            <textarea name="body" required minLength={20} maxLength={4000} rows={6} className="border-2 border-ink p-2" />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold">Tips for the next student (optional)</span>
            <textarea name="tips" maxLength={2000} rows={3} className="border-2 border-ink p-2" />
          </label>

          <div className="grid gap-2 border-l-4 border-cobalt bg-paper p-3 text-sm">
            <p>
              Don’t name anyone (managers, colleagues, yourself) or share contact details. Reviews are checked
              automatically; anything that names a person or raises a serious problem is read by a person first.
            </p>
            <p>
              If something at your placement made you feel unsafe, please tell your college’s safeguarding lead or a
              trusted adult as well as writing here.
            </p>
            <label className="flex items-start gap-2 font-medium">
              <input type="checkbox" name="no_names" required className="mt-1" />
              I haven’t named anyone or shared contact details.
            </label>
          </div>

          <PendingButton className="w-fit border-2 border-ink bg-volt px-4 py-2 font-bold hover:-translate-y-0.5 hover:shadow-hard-sm" pendingText="Checking…">
            Post review
          </PendingButton>
        </form>
      )}
    </div>
  );
}
