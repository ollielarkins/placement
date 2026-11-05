import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { specialismNames } from '@/lib/data';
import { isOverdue, type TrackerStage } from '@/lib/tracker';
import { PROFILE_COLUMNS, TRAVEL_KM, profileSearchHref, type Profile } from '@/lib/profile';
import { deleteAccount } from './actions';

export const metadata: Metadata = { title: 'Your account' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AccountPage({ searchParams }: Props) {
  const p = await searchParams;
  const { user, ageConfirmed } = await requireUser('/account');
  if (!ageConfirmed) redirect('/welcome?next=/account');
  const via = user.app_metadata?.provider === 'google' ? 'Google' : 'email link';
  const db = await sessionDb();
  const [{ data }, specNames] = await Promise.all([
    db.from('profiles').select(PROFILE_COLUMNS).eq('user_id', user.id).single(),
    specialismNames(),
  ]);
  const pr = data as Profile | null;
  const { data: tracked } = await db.from('tracker_items').select('stage, follow_up_on').eq('user_id', user.id);
  const saved = tracked?.length ?? 0;
  const due = (tracked ?? []).filter((t) => isOverdue(t as { stage: TrackerStage; follow_up_on: string | null })).length;
  const complete = Boolean(pr?.home_outcode && pr?.route_id);

  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <h1 className="display text-3xl sm:text-4xl">Your account</h1>
        <p className="text-sm text-slate-600">Signed in as {user.email} (by {via}).</p>
      </header>

      {p.saved ? <p role="status" className="border-2 border-ink bg-volt p-3 text-sm font-medium">Profile saved.</p> : null}

      <section className="grid gap-3 border-2 border-ink bg-white p-4">
        <h2 className="font-semibold">Your profile</h2>
        {pr && complete ? (
          <dl className="grid gap-1 text-sm">
            <div><dt className="inline text-slate-600">Specialism: </dt><dd className="inline">{pr.specialism ? specNames.get(pr.specialism) ?? pr.specialism : 'not chosen'}</dd></div>
            <div><dt className="inline text-slate-600">From: </dt><dd className="inline">{pr.home_outcode}, up to {TRAVEL_KM.find((t) => t.km === Math.round(Number(pr.max_travel_km)))?.label ?? `${pr.max_travel_km} km`}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-700">Add your T Level and the first half of your postcode, and every search starts from them.</p>
        )}
        <div className="flex flex-wrap gap-3">
          {pr && complete ? (
            <Link href={profileSearchHref(pr)} className="border-2 border-ink bg-ink px-4 py-2 text-sm font-bold text-volt hover:bg-volt hover:text-ink">
              Search with my profile
            </Link>
          ) : null}
          <Link href="/account/profile" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
            {complete ? 'Edit profile' : 'Set up your profile'}
          </Link>
        </div>
      </section>

      <section className="grid gap-2 border-2 border-ink bg-white p-4">
        <h2 className="font-semibold">Your shortlist</h2>
        <p className="text-sm text-slate-700">
          {saved} saved{due ? `, ${due} to follow up today` : ''}.
        </p>
        <Link href="/account/shortlist" className="w-fit rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
          Open shortlist
        </Link>
        <Link href="/account/drafts" className="w-fit text-sm text-brand-700 underline">Your message drafts</Link>
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
          <p role="alert" className="mb-3 border-2 border-red-700 bg-white p-3 text-sm font-medium text-red-800">
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
