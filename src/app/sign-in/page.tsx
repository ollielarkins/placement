import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, safeNext } from '@/lib/auth/session';
import { sendMagicLink, signInWithGoogle } from './actions';

export const metadata: Metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const ERRORS: Record<string, string> = {
  email: 'That doesn’t look like an email address. Check it and try again.',
  send: 'We couldn’t send the link just now. Try again in a minute.',
  rate: 'Too many sign-in emails in a short time. Wait a few minutes, then try again.',
  google: 'Google sign-in didn’t work. Try again, or use your email instead.',
  link: 'That sign-in link has expired or was already used. Ask for a new one below.',
};

export default async function SignInPage({ searchParams }: Props) {
  const p = await searchParams;
  const next = safeNext(p.next);
  if (await currentUser()) redirect(next);

  if (p.sent === '1') {
    return (
      <section className="mx-auto grid max-w-md gap-3 border-2 border-ink bg-white p-6">
        <h1 className="display text-2xl">Check your email</h1>
        <p className="text-slate-700">
          We’ve sent you a sign-in link. Open it on this device to sign in. It works once and expires after an hour.
        </p>
        <p className="text-sm text-slate-600">Nothing there? Check your spam folder, or <Link className="text-brand-700 underline" href="/sign-in">try again</Link>.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto grid max-w-md gap-5 border-2 border-ink bg-white p-6">
      <header className="grid gap-1">
        <h1 className="display text-2xl">Sign in or create an account</h1>
        <p className="text-sm text-slate-700">
          You don’t need an account to search. Sign in to save a shortlist and track your applications. You must be 16
          or over.
        </p>
      </header>
      {p.error && ERRORS[p.error] ? (
        <p role="alert" className="border-2 border-red-700 bg-white p-3 text-sm font-medium text-red-800">{ERRORS[p.error]}</p>
      ) : null}

      <form action={sendMagicLink} className="grid gap-2">
        <input type="hidden" name="next" value={next} />
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Email address</span>
          <input name="email" type="email" required autoComplete="email" inputMode="email" maxLength={254}
            className="rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <button type="submit" className="border-2 border-ink bg-ink px-4 py-2 font-bold text-volt hover:bg-volt hover:text-ink">
          Email me a sign-in link
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-slate-500" aria-hidden>
        <span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" />
      </div>

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="w-full rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50">
          Continue with Google
        </button>
      </form>

      <p className="text-xs text-slate-500">
        We only keep your email address and what you choose to add. No date of birth, no public profile, and nobody
        else can see your shortlist. <Link className="underline" href="/privacy">Privacy notice</Link>.
      </p>
    </section>
  );
}
