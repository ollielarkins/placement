import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { deleteAccount } from './actions';

export const metadata: Metadata = { title: 'Your account' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AccountPage({ searchParams }: Props) {
  const p = await searchParams;
  const { user, ageConfirmed } = await requireUser('/account');
  if (!ageConfirmed) redirect('/welcome?next=/account');
  const via = user.app_metadata?.provider === 'google' ? 'Google' : 'email link';

  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="text-sm text-slate-600">Signed in as {user.email} (by {via}).</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Coming next</h2>
        <p className="text-sm text-slate-700">
          Your profile (T Level, specialism, college, travel) and a shortlist with an application tracker are being
          built now. Until then, <Link href="/search" className="text-brand-700 underline">search works as before</Link>.
        </p>
      </section>

      <form action="/auth/sign-out" method="post">
        <button type="submit" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
          Sign out
        </button>
      </form>

      <section className="rounded-xl border border-red-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Delete your account</h2>
        <p className="mb-3 text-sm text-slate-700">
          This removes your account, profile, shortlist and drafts straight away. It can’t be undone.
        </p>
        {p.error ? (
          <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
            {p.error === 'confirm' ? 'Type delete in the box to confirm.' : 'We couldn’t delete it just now. Try again.'}
          </p>
        ) : null}
        <form action={deleteAccount} className="flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1">
            <span>Type <strong>delete</strong> to confirm</span>
            <input name="confirm" autoComplete="off" className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <button type="submit" className="rounded-md bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800">
            Delete my account
          </button>
        </form>
      </section>
    </div>
  );
}
