import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { CHANNEL_LABEL } from '@/lib/drafts';
import { displayName } from '@/lib/format';
import { createDraft } from '../actions';

export const metadata: Metadata = { title: 'Draft a message' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const ERRORS: Record<string, string> = {
  limit: 'You’ve used today’s 10 drafts. You can draft more tomorrow, or edit one you already have.',
  confirm: 'Confirm you’re 16 or over first.',
  company: 'That company isn’t available.',
  input: 'Pick a company and a type of message.',
  model: 'The drafting service didn’t respond. Try again in a minute.',
};

export default async function NewDraftPage({ searchParams }: Props) {
  const p = await searchParams;
  const company = p.company && /^[0-9a-f-]{36}$/i.test(p.company) ? p.company : null;
  const here = `/account/drafts/new${company ? `?company=${company}` : ''}`;
  const { ageConfirmed } = await requireUser(here);
  if (!ageConfirmed) redirect(`/welcome?next=${encodeURIComponent(here)}`);
  const db = await sessionDb();
  const [{ data: c }, { data: quota }, { data: profile }] = await Promise.all([
    company ? db.from('companies').select('id, name').eq('id', company).maybeSingle() : Promise.resolve({ data: null }),
    db.rpc('outreach_quota'),
    db.from('profiles').select('route_id, specialism').maybeSingle(),
  ]);
  if (!c) redirect('/account/shortlist');
  const left = typeof quota === 'number' ? quota : 0;

  return (
    <div className="grid max-w-xl gap-5">
      <header className="grid gap-1">
        <p className="text-sm"><Link href="/account/shortlist" className="text-brand-700 underline">Your shortlist</Link></p>
        <h1 className="display text-3xl sm:text-4xl">Draft a message to {displayName(c.name)}</h1>
        <p className="text-sm text-slate-600">
          Claude writes a first draft from your profile and what we know about the company. You check it, fill in the
          [gaps] and send it yourself. We never contact employers for you.
        </p>
      </header>
      {p.error ? (
        <p role="alert" className="border-2 border-red-700 bg-white p-3 text-sm font-medium text-red-800">{ERRORS[p.error] ?? ERRORS.model}</p>
      ) : null}
      {!profile?.route_id ? (
        <p className="border-2 border-dashed border-ink bg-white p-3 text-sm">
          Your profile is empty, so the draft will be mostly [gaps].{' '}
          <Link href="/account/profile" className="underline">Add your T Level and skills</Link> for a better draft.
        </p>
      ) : null}
      <form action={createDraft} className="grid gap-4 border-2 border-ink bg-white p-4">
        <input type="hidden" name="company" value={c.id} />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Type of message</legend>
          {Object.entries(CHANNEL_LABEL).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="channel" value={id} defaultChecked={(p.channel ?? 'email') === id} className="accent-brand-600" />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">What is it for?</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="purpose" value="placement" defaultChecked={p.purpose !== 'follow_up'} className="accent-brand-600" />
            Asking about a placement
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="purpose" value="follow_up" defaultChecked={p.purpose === 'follow_up'} className="accent-brand-600" />
            Following up (no reply yet)
          </label>
        </fieldset>
        <button type="submit" disabled={left === 0}
          className="border-2 border-ink bg-ink px-4 py-2 font-bold text-volt hover:bg-volt hover:text-ink disabled:opacity-50">
          Write my draft
        </button>
        <p className="text-xs text-slate-500">
          {left} of 10 drafts left today. To write it, we send Claude (by Anthropic) your T Level, specialism, college,
          placement dates, interests, skills and “about you” text. Never your email address, name or postcode.
        </p>
      </form>
    </div>
  );
}
