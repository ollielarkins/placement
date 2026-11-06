import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SaveButton, SaveCourseButton } from '@/components/SaveButton';
import { TLevelBadge } from '@/components/TLevelBadge';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { displayName, ukDate } from '@/lib/format';
import { LEVEL_LABEL, rankText, type CugPositions, type TLevelStatus } from '@/lib/opportunities';
import { removeLike } from './actions';

export const metadata: Metadata = { title: 'Liked' };

interface Liked {
  companies: { id: string; name: string; county: string | null; shortlisted: boolean }[];
  courses: {
    id: string;
    title: string;
    qualification: string | null;
    university: string;
    tlevel_status: TLevelStatus;
    tlevel_requirement: string | null;
    course_url: string | null;
    subject_label: string | null;
    subject_rank: number | null;
    subject_rank_of: number | null;
    subject_rank_tied: boolean | null;
    overall_rank: number | null;
    overall_rank_of: number | null;
    overall_rank_tied: boolean | null;
    tef_overall: string | null;
    cug: CugPositions | null;
    shortlisted: boolean;
  }[];
  vacancies: {
    id: string;
    title: string;
    employer: string;
    company_id: string;
    closing_date: string | null;
    url: string | null;
    wage_text: string | null;
    course_level: number | null;
    shortlisted: boolean;
  }[];
}

export default async function LikedPage() {
  const { ageConfirmed } = await requireUser('/account/liked');
  if (!ageConfirmed) redirect('/welcome?next=/account/liked');
  const db = await sessionDb();
  const { data } = await db.rpc('liked_items');
  const liked = (data ?? { companies: [], courses: [], vacancies: [] }) as Liked;
  const total = liked.companies.length + liked.courses.length + liked.vacancies.length;

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm">
          <Link href="/account" className="text-brand-700 underline">Your account</Link>
        </p>
        <h1 className="display text-3xl sm:text-4xl">Liked</h1>
        <p className="text-sm text-slate-600">
          Everything you liked in card mode. Add the ones you want to follow up to your{' '}
          <Link href="/account/shortlist" className="underline">shortlist</Link>. Only you can see this.
        </p>
      </header>

      {total === 0 ? (
        <p className="border-2 border-dashed border-ink bg-white p-6 text-slate-700">
          Nothing liked yet. Switch any results page to <strong>Cards</strong>:{' '}
          <Link href="/search?view=cards" className="underline">placements</Link>,{' '}
          <Link href="/apprenticeships?view=cards" className="underline">apprenticeships</Link> or{' '}
          <Link href="/universities?view=cards" className="underline">universities</Link>.
        </p>
      ) : null}

      {liked.companies.length ? (
        <Section title="Placements" count={liked.companies.length}>
          {liked.companies.map((c) => (
            <Row key={c.id} type="company" id={c.id} action={<SaveButton companyId={c.id} compact />}>
              <Link href={`/companies/${c.id}`} className="font-bold hover:underline">{displayName(c.name)}</Link>
              {c.county ? <p className="text-sm text-slate-600">{c.county}</p> : null}
            </Row>
          ))}
        </Section>
      ) : null}

      {liked.vacancies.length ? (
        <Section title="Apprenticeships" count={liked.vacancies.length}>
          {liked.vacancies.map((v) => (
            <Row key={v.id} type="vacancy" id={v.id} action={<SaveButton companyId={v.company_id} compact />}>
              {v.url ? (
                <a href={v.url} rel="noopener noreferrer nofollow" target="_blank" className="font-bold hover:underline">{v.title}</a>
              ) : (
                <span className="font-bold">{v.title}</span>
              )}
              <p className="text-sm text-slate-600">
                {[
                  displayName(v.employer),
                  v.course_level ? LEVEL_LABEL[v.course_level] : null,
                  v.wage_text,
                  v.closing_date ? `closes ${ukDate(v.closing_date)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-xs text-slate-500">Adding it to your shortlist saves the employer, so you can track your application.</p>
            </Row>
          ))}
        </Section>
      ) : null}

      {liked.courses.length ? (
        <Section title="University courses" count={liked.courses.length}>
          {liked.courses.map((c) => (
            <Row key={c.id} type="course" id={c.id} action={<SaveCourseButton courseId={c.id} compact />}>
              <Link href={`/universities/${c.id}`} className="font-bold hover:underline">{c.title}</Link>
              <p className="text-sm text-slate-600">{[c.university, c.qualification].filter(Boolean).join(' · ')}</p>
              {c.cug ? (
                <p className="text-xs font-semibold">
                  {[
                    c.cug.subject_label && rankText(c.cug.subject_position, c.cug.subject_of, c.cug.subject_tied)
                      ? `${c.cug.subject_label}: ${rankText(c.cug.subject_position, c.cug.subject_of, c.cug.subject_tied)}`
                      : null,
                    rankText(c.cug.overall_position, c.cug.overall_of, c.cug.overall_tied)
                      ? `overall: ${rankText(c.cug.overall_position, c.cug.overall_of, c.cug.overall_tied)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  (Complete University Guide {c.cug.edition})
                </p>
              ) : null}
              <p className="text-xs font-semibold text-cobalt">
                {[
                  c.subject_label && rankText(c.subject_rank, c.subject_rank_of, c.subject_rank_tied)
                    ? `${c.subject_label}: ${rankText(c.subject_rank, c.subject_rank_of, c.subject_rank_tied)}`
                    : null,
                  rankText(c.overall_rank, c.overall_rank_of, c.overall_rank_tied) ? `University: ${rankText(c.overall_rank, c.overall_rank_of, c.overall_rank_tied)}` : null,
                  c.tef_overall ? `TEF ${c.tef_overall}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <TLevelBadge status={c.tlevel_status} requirement={c.tlevel_requirement} />
            </Row>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="display flex items-center gap-3 text-2xl">
        {title} <span className="bg-ink px-2 font-mono text-base text-volt">{count}</span>
      </h2>
      <ul className="grid gap-3 md:grid-cols-2">{children}</ul>
    </section>
  );
}

function Row({ type, id, action, children }: { type: string; id: string; action: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="grid gap-2 border-2 border-ink bg-white p-4">
      <div className="grid gap-1">{children}</div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {action}
        <form action={removeLike}>
          <input type="hidden" name="item_type" value={type} />
          <input type="hidden" name="item_id" value={id} />
          <button className="text-xs text-red-700 underline">Remove like</button>
        </form>
      </div>
    </li>
  );
}
