import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { displayName, ukDate } from '@/lib/format';
import { ALL_STAGES, CLOSED_STAGES, OPEN_STAGES, STAGE_LABEL, isOverdue, type TrackerItem } from '@/lib/tracker';
import { removeItem, updateItem } from './actions';

export const metadata: Metadata = { title: 'Your shortlist' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function ShortlistPage({ searchParams }: Props) {
  const p = await searchParams;
  const { user, ageConfirmed } = await requireUser('/account/shortlist');
  if (!ageConfirmed) redirect('/welcome?next=/account/shortlist');
  const db = await sessionDb();
  const { data } = await db
    .from('tracker_items')
    .select('id, company_id, stage, contact_used, contacted_at, follow_up_on, notes, stage_changed_at, companies(name, data_source)')
    .eq('user_id', user.id)
    .order('stage_changed_at', { ascending: false });
  const items = (data ?? []) as unknown as TrackerItem[];
  const overdue = items.filter((t) => isOverdue(t));
  const byStage = (id: string) => items.filter((t) => t.stage === id);
  const closed = items.filter((t) => CLOSED_STAGES.some((s) => s.id === t.stage));

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <p className="text-sm"><Link href="/account" className="text-brand-700 underline">Your account</Link></p>
        <h1 className="display text-3xl sm:text-4xl">Your shortlist</h1>
        <p className="text-sm text-slate-600">
          {items.length} {items.length === 1 ? 'company' : 'companies'}. Only you can see this.
        </p>
      </header>

      {p.saved ? <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">Saved.</p> : null}
      {p.removed ? <p role="status" className="rounded-md bg-slate-100 p-3 text-sm">Removed from your shortlist.</p> : null}
      {p.error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">That didn’t save. Check the dates and try again.</p> : null}

      {overdue.length ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 className="font-semibold">Follow up today</h2>
          <ul className="mt-1 list-disc pl-5">
            {overdue.map((t) => (
              <li key={t.id}>
                <a href={`#t-${t.id}`} className="underline">{displayName(t.companies?.name ?? 'Company')}</a>
                {' '}(due {ukDate(t.follow_up_on!)})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-slate-700">
          Nothing saved yet. Use <strong>Save to shortlist</strong> on any company in{' '}
          <Link href="/search" className="text-brand-700 underline">search</Link>.
        </p>
      ) : (
        <>
          {/* Board: one column per stage on wide screens, stacked on phones. */}
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {OPEN_STAGES.map((s) => (
              <section key={s.id} aria-labelledby={`h-${s.id}`} className="grid content-start gap-2 rounded-xl bg-slate-100 p-2">
                <h2 id={`h-${s.id}`} className="px-1 text-sm font-semibold">
                  {s.label} <span className="font-normal text-slate-500">({byStage(s.id).length})</span>
                </h2>
                <p className="px-1 text-xs text-slate-500">{s.hint}</p>
                {byStage(s.id).map((t) => <Card key={t.id} t={t} />)}
              </section>
            ))}
          </div>
          {closed.length ? (
            <details className="border-2 border-ink bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold">Closed ({closed.length})</summary>
              <div className="mt-3 grid gap-2 md:grid-cols-3">{closed.map((t) => <Card key={t.id} t={t} />)}</div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function Card({ t }: { t: TrackerItem }) {
  const name = displayName(t.companies?.name ?? 'Company');
  const due = isOverdue(t);
  return (
    <article id={`t-${t.id}`} className={`grid gap-2 rounded-lg border bg-white p-3 text-sm ${due ? 'border-amber-400' : 'border-slate-200'}`}>
      <h3 className="font-medium">
        <Link href={`/companies/${t.company_id}`} className="hover:underline">{name}</Link>
      </h3>
      <p className="text-xs text-slate-500">
        {STAGE_LABEL[t.stage]} since {ukDate(t.stage_changed_at)}
        {t.follow_up_on ? <> · <span className={due ? 'font-semibold text-amber-800' : ''}>follow up {ukDate(t.follow_up_on)}</span></> : null}
      </p>
      <p className="flex gap-3 text-xs">
        <Link href={`/account/drafts/new?company=${t.company_id}&purpose=${t.stage === 'contacted' ? 'follow_up' : 'placement'}`}
          className="text-brand-700 underline">
          {t.stage === 'contacted' ? 'Draft a follow-up' : 'Draft a message'}
        </Link>
      </p>
      <details>
        <summary className="cursor-pointer text-xs text-brand-700 underline">Update</summary>
        <form action={updateItem} className="mt-2 grid gap-2">
          <input type="hidden" name="id" value={t.id} />
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Stage</span>
            <select name="stage" defaultValue={t.stage} className="rounded-md border border-slate-300 px-2 py-1">
              {ALL_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Follow up on</span>
            <input type="date" name="follow_up_on" defaultValue={t.follow_up_on ?? ''} className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Contacted on</span>
            <input type="date" name="contacted_at" defaultValue={t.contacted_at ?? ''} className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">How you contacted them</span>
            <input name="contact_used" defaultValue={t.contact_used ?? ''} maxLength={200} placeholder="e.g. careers@ email, online form"
              className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Notes</span>
            <textarea name="notes" defaultValue={t.notes ?? ''} maxLength={5000} rows={3} className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <button type="submit" className="border-2 border-ink bg-ink px-3 py-1.5 text-xs font-bold text-volt hover:bg-volt hover:text-ink">Save</button>
        </form>
        <form action={removeItem} className="mt-2">
          <input type="hidden" name="id" value={t.id} />
          <button type="submit" className="text-xs text-red-700 underline">Remove from shortlist</button>
        </form>
      </details>
    </article>
  );
}
