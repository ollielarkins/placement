import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PendingButton } from '@/components/PendingButton';
import { requireUser } from '@/lib/auth/session';
import { REPORT_REASONS, type ReportReason } from '@/lib/reviews';
import { fileReport } from '../account/reviews/actions';

export const metadata: Metadata = { title: 'Report a problem', robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const FOR_REVIEW: ReportReason[] = ['personal_info', 'untrue', 'offensive', 'safeguarding', 'spam', 'other'];
const FOR_COMPANY: ReportReason[] = ['wrong_info', 'closed', 'offensive', 'other'];

export default async function ReportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const type = sp.type === 'company' ? 'company' : 'review';
  const id = typeof sp.id === 'string' && /^[0-9a-f-]{36}$/i.test(sp.id) ? sp.id : null;
  const back = typeof sp.back === 'string' && sp.back.startsWith('/') && !sp.back.startsWith('//') ? sp.back : '/';
  if (!id) redirect(back);
  const here = `/report?type=${type}&id=${id}&back=${encodeURIComponent(back)}`;
  const { ageConfirmed } = await requireUser(here);
  if (!ageConfirmed) redirect(`/welcome?next=${encodeURIComponent(here)}`);
  const done = typeof sp.done === 'string' ? sp.done : null;

  return (
    <div className="grid max-w-xl gap-6">
      <header className="grid gap-1">
        <p className="text-sm"><Link href={back} className="text-brand-700 underline">Back</Link></p>
        <h1 className="display text-3xl">{type === 'review' ? 'Report a review' : 'Report a problem with this page'}</h1>
      </header>
      {done === 'ok' || done === 'already' ? (
        <p role="status" className="border-2 border-ink bg-volt p-4 font-semibold">
          {done === 'ok' ? 'Thanks. A person will look at it.' : 'You’ve already reported this. A person will look at it.'}
          {type === 'review' ? ' A review reported by three people is hidden until then.' : ''}
        </p>
      ) : (
        <form action={fileReport} className="grid gap-4 border-2 border-ink bg-white p-4">
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="back" value={back} />
          {done === 'error' || sp.error ? <p role="alert" className="text-sm text-red-700">That didn’t send. Pick a reason and try again.</p> : null}
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">What’s wrong?</legend>
            {(type === 'review' ? FOR_REVIEW : FOR_COMPANY).map((r) => (
              <label key={r} className="flex items-center gap-2">
                <input type="radio" name="reason" value={r} required /> {REPORT_REASONS[r]}
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1">
            <span className="font-semibold">Anything to add? (optional)</span>
            <textarea name="details" maxLength={400} rows={3} className="border-2 border-ink p-2" />
          </label>
          <p className="text-xs text-slate-600">
            If someone may be in danger right now, call 999. If something worried you at a placement, tell your college’s
            safeguarding lead too.
          </p>
          <PendingButton className="w-fit border-2 border-ink bg-ink px-4 py-2 font-bold text-volt" pendingText="Sending…">Send report</PendingButton>
        </form>
      )}
    </div>
  );
}
