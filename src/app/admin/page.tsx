import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';
import { displayName, ukDate } from '@/lib/format';
import { REPORT_REASONS } from '@/lib/reviews';
import {
  createCompany,
  linkSubmission,
  publishReview,
  rejectSubmission,
  removeReview,
  rescreen,
  resolveAlert,
  resolveReport,
} from './actions';

export const metadata: Metadata = { title: 'Moderation', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Moderation = { verdict?: string; uncertain?: boolean; checks?: Record<string, boolean>; reasons?: string[]; model?: string | null } | null;

const btn = 'border-2 border-ink px-3 py-1 text-sm font-bold';

export default async function AdminPage({ searchParams }: Props) {
  const sp = await searchParams;
  const db = await sessionDb();
  const { data: who } = await db.auth.getUser();
  if (!who.user) redirect('/sign-in?next=/admin');
  if (who.user.app_metadata?.role !== 'admin') notFound();

  const [{ data: alerts }, { data: reviews }, { data: subs }, { data: reports }] = await Promise.all([
    db.from('admin_alerts').select('*').is('resolved_at', null).order('created_at', { ascending: false }),
    db.from('reviews').select('id, company_id, status, body, tips, ratings, moderation, created_at, companies(name)')
      .in('status', ['pending', 'held']).order('created_at'),
    db.from('company_submissions').select('id, payload, status, moderation, matched_company_id, created_at')
      .eq('status', 'pending').order('created_at').limit(100),
    db.from('reports').select('id, target_type, target_id, reason, created_at').eq('status', 'open').order('created_at'),
  ]);

  // What each report points at.
  const reviewIds = [...new Set((reports ?? []).filter((r) => r.target_type === 'review').map((r) => r.target_id))];
  const companyIds = [...new Set((reports ?? []).filter((r) => r.target_type === 'company').map((r) => r.target_id))];
  const [{ data: reported }, { data: companies }] = await Promise.all([
    reviewIds.length ? db.from('reviews').select('id, company_id, status, body').in('id', reviewIds) : Promise.resolve({ data: [] }),
    companyIds.length ? db.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [] }),
  ]);
  // Possible existing matches for each suggestion, by name.
  const names = (subs ?? []).map((s) => (s.payload as { name: string }).name);
  const matches = new Map<string, { id: string; name: string }[]>();
  for (const n of names) {
    const term = n.replace(/\b(ltd|limited|plc|llp)\b\.?/gi, '').trim();
    if (term.length < 3) continue;
    const { data } = await db.from('companies').select('id, name').ilike('name', `%${term}%`).neq('status', 'hidden').limit(5);
    matches.set(n, data ?? []);
  }

  const safeguarding = (alerts ?? []).filter((a) => a.kind === 'safeguarding');
  const other = (alerts ?? []).filter((a) => a.kind !== 'safeguarding');

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <h1 className="display text-3xl sm:text-4xl">Moderation</h1>
        <p className="text-sm text-slate-600">Every change here is logged with your account.</p>
      </header>
      {typeof sp.done === 'string' ? <p role="status" className="border-2 border-ink bg-volt p-2 font-semibold">{sp.done}</p> : null}
      {typeof sp.error === 'string' ? <p role="alert" className="border-2 border-red-700 bg-white p-2 text-red-800">{sp.error}</p> : null}

      {safeguarding.length ? (
        <section className="grid gap-3 border-4 border-red-700 bg-white p-4">
          <h2 className="text-xl font-bold text-red-800">Safeguarding ({safeguarding.length})</h2>
          {safeguarding.map((a) => (
            <div key={a.id} className="grid gap-2 border-l-4 border-red-700 pl-3">
              <p className="text-sm">{a.message}</p>
              <p className="text-xs text-slate-600">
                {a.target_type} {a.target_id} · raised {ukDate(a.created_at)}. The post is hidden and listed below.
              </p>
              <form action={resolveAlert}>
                <input type="hidden" name="id" value={a.id} />
                <button className={btn}>I’ve dealt with this</button>
              </form>
            </div>
          ))}
        </section>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-xl font-bold">Reviews waiting ({reviews?.length ?? 0})</h2>
        {(reviews ?? []).map((r) => {
          const m = r.moderation as Moderation;
          const flags = Object.entries(m?.checks ?? {}).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' '));
          return (
            <article key={r.id} className={`grid gap-2 border-2 bg-white p-4 ${m?.checks?.safeguarding ? 'border-red-700' : 'border-ink'}`}>
              <p className="text-sm">
                <Link href={`/companies/${r.company_id}`} className="font-bold underline">
                  {displayName((r.companies as unknown as { name: string } | null)?.name ?? 'Company')}
                </Link>{' '}
                · {r.status} · {ukDate(r.created_at)} · overall {(r.ratings as { overall: number }).overall}/5
              </p>
              <p className="whitespace-pre-line text-sm">{r.body}</p>
              {r.tips ? <p className="whitespace-pre-line text-sm"><strong>Tips:</strong> {r.tips}</p> : null}
              <p className="text-xs text-slate-700">
                {m ? (
                  <>
                    Verdict: <strong>{m.verdict}</strong>{m.uncertain ? ' (unsure)' : ''}
                    {flags.length ? ` · flagged: ${flags.join(', ')}` : ''}
                    {m.reasons?.length ? ` · ${m.reasons.join(' ')}` : ''}
                  </>
                ) : (
                  'Not screened yet.'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <form action={publishReview}><input type="hidden" name="id" value={r.id} /><button className={`${btn} bg-volt`}>Publish</button></form>
                <form action={removeReview}><input type="hidden" name="id" value={r.id} /><button className={btn}>Don’t publish</button></form>
                <form action={rescreen}><input type="hidden" name="kind" value="review" /><input type="hidden" name="id" value={r.id} /><button className={btn}>Screen again</button></form>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-bold">Company suggestions ({subs?.length ?? 0})</h2>
        {(subs ?? []).map((s) => {
          const p = s.payload as { name: string; website?: string; location?: string; why?: string };
          const m = s.moderation as Moderation;
          const flags = Object.entries(m?.checks ?? {}).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' '));
          const near = matches.get(p.name) ?? [];
          return (
            <article key={s.id} className="grid gap-2 border-2 border-ink bg-white p-4 text-sm">
              <p>
                <strong>{p.name}</strong>
                {p.website ? <> · <a href={p.website} rel="noopener noreferrer nofollow" target="_blank" className="underline">{p.website}</a></> : null}
                {p.location ? ` · ${p.location}` : ''} · {ukDate(s.created_at)}
              </p>
              {p.why ? <p className="whitespace-pre-line">{p.why}</p> : null}
              <p className="text-xs text-slate-700">
                {m ? <>Verdict: <strong>{m.verdict}</strong>{m.uncertain ? ' (unsure)' : ''}{flags.length ? ` · flagged: ${flags.join(', ')}` : ''}{m.reasons?.length ? ` · ${m.reasons.join(' ')}` : ''}</> : 'Not screened yet.'}
              </p>
              {near.length ? (
                <div className="grid gap-1">
                  <p className="text-xs font-semibold">Already listed? Similar names:</p>
                  {near.map((c) => (
                    <form key={c.id} action={linkSubmission} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="company" value={c.id} />
                      <Link href={`/companies/${c.id}`} className="underline">{displayName(c.name)}</Link>
                      <button className="text-xs underline">This is it</button>
                    </form>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <form action={createCompany}><input type="hidden" name="id" value={s.id} /><button className={`${btn} bg-volt`}>Add as a new company</button></form>
                <form action={rejectSubmission}><input type="hidden" name="id" value={s.id} /><button className={btn}>Reject</button></form>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-bold">Reports ({reports?.length ?? 0})</h2>
        {(reports ?? []).map((r) => {
          const rev = (reported ?? []).find((x) => x.id === r.target_id) as { company_id: string; status: string; body: string } | undefined;
          const co = (companies ?? []).find((x) => x.id === r.target_id) as { id: string; name: string } | undefined;
          const [kind, ...rest] = r.reason.split(': ');
          return (
            <article key={r.id} className="grid gap-2 border-2 border-ink bg-white p-4 text-sm">
              <p>
                <strong>{REPORT_REASONS[kind as keyof typeof REPORT_REASONS] ?? kind}</strong>
                {rest.length ? ` · “${rest.join(': ')}”` : ''} · {ukDate(r.created_at)}
              </p>
              {rev ? (
                <p className="border-l-4 border-ink pl-2">
                  Review ({rev.status}) on <Link href={`/companies/${rev.company_id}`} className="underline">its company</Link>: {rev.body.slice(0, 400)}
                </p>
              ) : co ? (
                <p>Company page: <Link href={`/companies/${co.id}`} className="underline">{displayName(co.name)}</Link></p>
              ) : (
                <p className="text-slate-500">The reported item no longer exists.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <form action={resolveReport}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="outcome" value="upheld" /><button className={`${btn} bg-volt`}>{r.target_type === 'review' ? 'Uphold and remove the review' : 'Uphold (fix the page)'}</button></form>
                <form action={resolveReport}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="outcome" value="dismissed" /><button className={btn}>Dismiss</button></form>
              </div>
            </article>
          );
        })}
      </section>

      {other.length ? (
        <section className="grid gap-2">
          <h2 className="text-xl font-bold">Other alerts</h2>
          {other.map((a) => (
            <form key={a.id} action={resolveAlert} className="flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="id" value={a.id} />
              <span>{a.message} ({a.target_type}, {ukDate(a.created_at)})</span>
              <button className="underline">Close</button>
            </form>
          ))}
        </section>
      ) : null}
    </div>
  );
}
