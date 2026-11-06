import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PendingButton } from '@/components/PendingButton';
import { requireUser } from '@/lib/auth/session';
import { submitCompany } from '../account/reviews/actions';

export const metadata: Metadata = {
  title: 'Suggest a company',
  description: 'Know an engineering employer that takes T Level students? Suggest it and we’ll check it and add it.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const ERRORS: Record<string, string> = {
  name: 'Add the company’s name.',
  website: 'That website doesn’t look like a web address. Leave it blank if you’re not sure.',
  limit: 'You can suggest up to 5 companies a day. Try again tomorrow.',
  save: 'That didn’t save. Try again in a minute.',
};

export default async function SubmitPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { ageConfirmed } = await requireUser('/submit');
  if (!ageConfirmed) redirect('/welcome?next=/submit');
  const error = typeof sp.error === 'string' ? ERRORS[sp.error] : null;
  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h1 className="display text-3xl sm:text-4xl">Suggest a company</h1>
        <p className="text-slate-700">
          Know an employer that would make a good engineering placement and isn’t on the site? Tell us. We check whether
          we already list it, then a person checks it before it’s added.
        </p>
      </header>
      <form action={submitCompany} className="grid gap-4 border-2 border-ink bg-white p-4">
        {error ? <p role="alert" className="border-2 border-red-700 p-2 text-sm text-red-800">{error}</p> : null}
        <label className="grid gap-1">
          <span className="font-semibold">Company name</span>
          <input name="name" required minLength={2} maxLength={200} className="border-2 border-ink px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="font-semibold">Website (optional)</span>
          <input name="website" inputMode="url" maxLength={300} placeholder="e.g. example.co.uk" className="border-2 border-ink px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="font-semibold">Town or area (optional)</span>
          <input name="location" maxLength={100} placeholder="e.g. Bedford" className="border-2 border-ink px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="font-semibold">Why is it a good placement? (optional)</span>
          <span className="text-xs text-slate-600">What they do, and whether they’ve taken T Level students. Please don’t name people.</span>
          <textarea name="why" maxLength={1000} rows={4} className="border-2 border-ink p-2" />
        </label>
        <PendingButton className="w-fit border-2 border-ink bg-volt px-4 py-2 font-bold hover:-translate-y-0.5 hover:shadow-hard-sm" pendingText="Sending…">
          Suggest it
        </PendingButton>
        <p className="text-xs text-slate-500">
          See what happened to your suggestions in <Link href="/account/reviews" className="underline">your account</Link>.
        </p>
      </form>
    </div>
  );
}
