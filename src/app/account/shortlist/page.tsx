import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { displayName, ukDate } from '@/lib/format';
import { ALL_STAGES, CLOSED_STAGES, OPEN_STAGES, STAGE_LABEL, isOverdue, type TrackerItem } from '@/lib/tracker';
import { TLevelBadge } from '@/components/TLevelBadge';
import type { TLevelStatus } from '@/lib/opportunities';
import { removeItem, updateItem } from './actions';
import { removeCourse, updateCourse, type CourseStage } from './course-actions';

const COURSE_STAGES: [CourseStage, string][] = [
  ['interested', 'Interested'],
  ['open_day', 'Open day booked'],
  ['applying', 'Applying'],
  ['applied', 'Applied'],
  ['offer', 'Offer'],
  ['firm', 'Firm choice'],
  ['insurance', 'Insurance choice'],
  ['not_for_me', 'Not for me'],
];

interface SavedCourse {
  course_id: string;
  stage: CourseStage;
  notes: string | null;
  uni_courses: {
    title: string;
    qualification: string | null;
    course_url: string | null;
    tlevel_status: TLevelStatus;
    tlevel_requirement: string | null;
    alevel_requirement: string | null;
    universities: { name: string } | null;
  } | null;
}

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
  const { data: courseData } = await db
    .from('course_shortlist')
    .select('course_id, stage, notes, uni_courses(title, qualification, course_url, tlevel_status, tlevel_requirement, alevel_requirement, universities(name))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  const courses = (courseData ?? []) as unknown as SavedCourse[];
  const overdue = items.filter((t) => isOverdue(t));
  const byStage = (id: string) => items.filter((t) => t.stage === id);
  const closed = items.filter((t) => CLOSED_STAGES.some((s) => s.id === t.stage));

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <p className="text-sm"><Link href="/account" className="text-brand-700 underline">Your account</Link></p>
        <h1 className="display text-3xl sm:text-4xl">Your shortlist</h1>
        <p className="text-sm text-slate-600">
          {items.length} {items.length === 1 ? 'company' : 'companies'}
          {courses.length ? `, ${courses.length} ${courses.length === 1 ? 'course' : 'courses'}` : ''}. Only you can see this.
        </p>
      </header>

      {p.saved ? <p role="status" className="border-2 border-ink bg-volt p-3 text-sm font-medium">Saved.</p> : null}
      {p.removed ? <p role="status" className="border-2 border-ink bg-white p-3 text-sm">Removed from your shortlist.</p> : null}
      {p.error ? <p role="alert" className="border-2 border-red-700 bg-white p-3 text-sm font-medium text-red-800">That didn’t save. Check the dates and try again.</p> : null}

      {overdue.length ? (
        <section className="border-2 border-ink bg-volt p-4 text-sm">
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
        <p className="border-2 border-dashed border-ink bg-white p-6 text-slate-700">
          Nothing saved yet. Use <strong>Save to shortlist</strong> on any company in{' '}
          <Link href="/search" className="text-brand-700 underline">search</Link>.
        </p>
      ) : (
        <>
          {/* Board: one column per stage on wide screens, stacked on phones. */}
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {OPEN_STAGES.map((s) => (
              <section key={s.id} aria-labelledby={`h-${s.id}`} className="grid content-start gap-2 border-2 border-ink bg-slate-100 p-2">
                <h2 id={`h-${s.id}`} className="flex items-center justify-between px-1 text-sm font-bold uppercase tracking-wide">
                  {s.label} <span className="bg-ink px-1.5 font-mono text-volt">{byStage(s.id).length}</span>
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

      <section id="courses" aria-labelledby="courses-h" className="grid gap-3">
        <h2 id="courses-h" className="display text-2xl">University courses</h2>
        {courses.length === 0 ? (
          <p className="border-2 border-dashed border-ink bg-white p-6 text-slate-700">
            No courses saved yet. Use <strong>Save course</strong> on any course in{' '}
            <Link href="/universities" className="text-brand-700 underline">Universities</Link>.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {courses.map((c) => (
              <li key={c.course_id} id={`c-${c.course_id}`} className="grid gap-2 border-2 border-ink bg-white p-4">
                <div>
                  <Link href={`/universities/${c.course_id}`} className="font-bold hover:underline">
                    {c.uni_courses?.title ?? 'Course'}
                  </Link>
                  {c.uni_courses?.qualification ? <span className="ml-2 text-sm text-slate-600">{c.uni_courses.qualification}</span> : null}
                  <p className="text-sm text-slate-700">{c.uni_courses?.universities?.name}</p>
                </div>
                {c.uni_courses ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <TLevelBadge status={c.uni_courses.tlevel_status} requirement={c.uni_courses.tlevel_requirement} />
                    {c.uni_courses.alevel_requirement ? <span className="text-slate-700">A levels: {c.uni_courses.alevel_requirement}</span> : null}
                    {c.uni_courses.course_url ? (
                      <a href={c.uni_courses.course_url} rel="noopener noreferrer nofollow" target="_blank" className="ml-auto font-semibold text-brand-700 underline">
                        Course page
                      </a>
                    ) : null}
                  </div>
                ) : null}
                <form action={updateCourse} className="grid gap-2 text-sm">
                  <input type="hidden" name="course_id" value={c.course_id} />
                  <label className="grid gap-1">
                    <span className="font-medium">Where you are</span>
                    <select name="stage" defaultValue={c.stage} className="border-2 border-ink px-2 py-1">
                      {COURSE_STAGES.map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="font-medium">Notes</span>
                    <textarea name="notes" defaultValue={c.notes ?? ''} maxLength={1000} rows={2} className="border-2 border-ink px-2 py-1" />
                  </label>
                  <div className="flex gap-2">
                    <button className="border-2 border-ink bg-volt px-3 py-1 font-bold">Save</button>
                  </div>
                </form>
                <form action={removeCourse}>
                  <input type="hidden" name="course_id" value={c.course_id} />
                  <button className="text-xs text-red-700 underline">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ t }: { t: TrackerItem }) {
  const name = displayName(t.companies?.name ?? 'Company');
  const due = isOverdue(t);
  return (
    <article id={`t-${t.id}`} className={`grid gap-2 border-2 border-ink bg-white p-3 text-sm ${due ? 'shadow-[4px_4px_0_0_var(--color-volt)]' : ''}`}>
      <h3 className="font-medium">
        <Link href={`/companies/${t.company_id}`} className="hover:underline">{name}</Link>
      </h3>
      <p className="text-xs text-slate-500">
        {STAGE_LABEL[t.stage]} since {ukDate(t.stage_changed_at)}
        {t.follow_up_on ? <> · <span className={due ? 'bg-volt px-1 font-bold text-ink' : ''}>follow up {ukDate(t.follow_up_on)}</span></> : null}
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
