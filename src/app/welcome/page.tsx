import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, safeNext } from '@/lib/auth/session';
import { confirmAge, underSixteen } from '../account/actions';

export const metadata: Metadata = { title: 'Welcome' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function WelcomePage({ searchParams }: Props) {
  const p = await searchParams;
  const next = safeNext(p.next);
  const { ageConfirmed } = await requireUser('/welcome');
  if (ageConfirmed) redirect(next);

  return (
    <section className="mx-auto grid max-w-lg gap-5 border-2 border-ink bg-white p-6">
      <h1 className="display text-2xl">One quick check</h1>
      <p className="text-slate-700">
        This service is for T Level students aged 16 and over. We don’t ask for your date of birth, just that you
        confirm it.
      </p>
      {p.error ? (
        <p role="alert" className="border-2 border-red-700 bg-white p-3 text-sm font-medium text-red-800">
          {p.error === '1' ? 'Tick both boxes to carry on.' : 'Something went wrong saving that. Try again.'}
        </p>
      ) : null}
      <form action={confirmAge} className="grid gap-3">
        <input type="hidden" name="next" value={next} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="over16" value="yes" required className="mt-0.5 size-4 accent-brand-600" />
          <span>I’m 16 or over.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="privacy" value="yes" required className="mt-0.5 size-4 accent-brand-600" />
          <span>
            I’ve read the <Link href="/privacy" className="text-brand-700 underline" target="_blank">privacy notice</Link>{' '}
            (what we keep, why, and how to delete it).
          </span>
        </label>
        <button type="submit" className="border-2 border-ink bg-ink px-4 py-2 font-bold text-volt hover:bg-volt hover:text-ink">
          Continue
        </button>
      </form>
      <form action={underSixteen} className="border-t border-slate-100 pt-4 text-sm">
        <p className="mb-2 text-slate-600">Under 16? You can still search without an account.</p>
        <button type="submit" className="text-brand-700 underline">I’m under 16: delete my account</button>
      </form>
    </section>
  );
}
