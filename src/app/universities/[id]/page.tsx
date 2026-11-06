import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SaveCourseButton } from '@/components/SaveButton';
import { TLevelBadge } from '@/components/TLevelBadge';
import { ukDate } from '@/lib/format';
import { CUG_NAME, LEAGUE_TABLES, NATIONS, SUBJECT_GROUPS, TLEVEL_STATUS, rankStats, rankText, uniCourseDetail, type CourseDetail } from '@/lib/opportunities';
import { RankStats } from '@/components/RankStats';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await uniCourseDetail((await params).id);
  return c ? { title: `${c.title}, ${c.university.name}` } : { title: 'Course not found' };
}

export default async function CoursePage({ params }: Props) {
  const c = await uniCourseDetail((await params).id);
  if (!c) notFound();
  const st = TLEVEL_STATUS[c.tlevel_status];
  const g = c.cug;
  const stats = rankStats({
    cug_subject_label: g?.subject_label ?? null, cug_subject_position: g?.subject_position ?? null,
    cug_subject_tied: g?.subject_tied ?? null, cug_subject_of: g?.subject_of ?? null,
    cug_overall_position: g?.overall_position ?? null, cug_overall_tied: g?.overall_tied ?? null, cug_overall_of: g?.overall_of ?? null,
    subject_label: c.subject_label, subject_rank: c.subject_rank, subject_rank_of: c.subject_rank_of, subject_rank_tied: c.subject_rank_tied,
    overall_rank: c.university.overall_rank, overall_rank_of: c.university.overall_rank_of, overall_rank_tied: c.university.overall_rank_tied,
  });
  const facts: [string, string][] = [
    ['Qualification', c.qualification ?? 'Not stated'],
    ['Subject area', c.subject_group in SUBJECT_GROUPS ? SUBJECT_GROUPS[c.subject_group as keyof typeof SUBJECT_GROUPS] : 'Other'],
    ['Russell Group', c.university.russell_group ? 'Yes' : 'No'],
    ['Where', [c.location_name, c.university.nation ? NATIONS[c.university.nation] : null].filter(Boolean).join(', ') || 'Not stated'],
    // Only codes shaped like UCAS course codes (H600, H6H3); some providers send internal numbers.
    ['UCAS course code', c.ucas_codes.filter((x) => /^(?=.*[A-Z])[A-Z0-9]{4}$/.test(x)).join(', ') || 'See the course page'],
    ['Foundation year', c.foundation_year == null ? 'Not stated' : c.foundation_year ? 'Available' : 'No'],
    ['Placement year', c.sandwich_year == null ? 'Not stated' : c.sandwich_year ? 'Available' : 'No'],
  ];

  return (
    <article className="grid gap-6">
      <header className="grid gap-2">
        <p className="text-sm">
          <Link href="/universities" className="text-brand-700 underline">
            Back to universities
          </Link>
        </p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="display text-3xl sm:text-4xl">{c.title}</h1>
            <p className="mt-1 text-lg font-semibold">{c.university.name}</p>
          </div>
          <SaveCourseButton courseId={c.id} />
        </div>
        {stats.length ? (
          <div className="mt-3 grid gap-2 border-l-8 border-volt pl-4">
            <RankStats stats={stats} size="lg" />
            {g && (g.subject_position || g.overall_position) ? (
              <p className="text-xs">
                {g.subject_url && g.subject_position ? (
                  <a href={g.subject_url} rel="noopener noreferrer nofollow" target="_blank" className="font-semibold underline">
                    Full {g.subject_label?.toLowerCase()} table
                  </a>
                ) : null}
                {g.subject_url && g.subject_position && g.overall_position ? ' · ' : ''}
                {g.overall_position ? (
                  <a href={g.overall_url} rel="noopener noreferrer nofollow" target="_blank" className="font-semibold underline">
                    Full university table
                  </a>
                ) : null}
                {' '}· Positions from the {CUG_NAME} {g.edition}, used with permission.
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      <section aria-labelledby="tl" className="grid gap-3 border-2 border-ink bg-white p-4 shadow-hard">
        <h2 id="tl" className="text-xl font-bold">
          T Level entry
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <TLevelBadge status={c.tlevel_status} requirement={c.tlevel_requirement} large />
          <span className="text-slate-700">{st.help}</span>
        </div>
        {c.tlevel_quote ? (
          <figure className="grid gap-1 border-l-4 border-cobalt pl-3">
            <blockquote className="text-slate-900">“{c.tlevel_quote}”</blockquote>
            <figcaption className="text-xs text-slate-500">
              {c.tlevel_status === 'unknown' ? 'The wording wasn’t clear enough to label. ' : ''}
              {c.tlevel_scope === 'university' ? 'The course page doesn’t say, so this is from ' : 'From '}
              {c.tlevel_quote_url ? (
                <a href={c.tlevel_quote_url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                  {c.tlevel_scope === 'university' ? `${c.university.name}’s general T Level statement` : 'the course page'}
                </a>
              ) : c.tlevel_scope === 'university' ? (
                `${c.university.name}’s general T Level statement`
              ) : (
                'the course page'
              )}
              {c.tlevel_assessed_at ? `, read ${ukDate(c.tlevel_assessed_at)}` : ''}
              {c.tlevel_assessed_by === 'claude' ? ' (labelled with AI help from this exact quote)' : ''}.
            </figcaption>
          </figure>
        ) : null}
        {c.tlevel_status === 'unknown' && c.tlevel_scope === 'course' && c.university.tlevel_policy_url ? (
          <div className="grid gap-1 border-2 border-dashed border-ink bg-paper p-3 text-sm">
            <p className="font-medium">
              {c.university.name} has a general T Level page.{' '}
              <a href={c.university.tlevel_policy_url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                Read it here
              </a>
              . It may list which courses accept T Levels.
            </p>
            {c.university.tlevel_policy_quote ? <p className="text-slate-700">“{c.university.tlevel_policy_quote}”</p> : null}
          </div>
        ) : null}
        {c.alevel_requirement ? (
          <p>
            <span className="font-medium">A level offer on the page:</span> {c.alevel_requirement}
          </p>
        ) : null}
        <p className="text-sm">
          {c.university.on_dfe_tlevel_list ? (
            <>
              {c.university.name} is on the Department for Education&apos;s{' '}
              <a href={c.university.dfe_list_url ?? '#'} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                list of providers that consider T Levels
              </a>{' '}
              for at least one course
              {c.university.dfe_list_checked_on ? ` (checked ${ukDate(c.university.dfe_list_checked_on)})` : ''}.
            </>
          ) : (
            <>{c.university.name} isn&apos;t on the Department for Education&apos;s list of providers that consider T Levels. That list isn&apos;t complete, so check with the university.</>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          {c.course_url ? (
            <a href={c.course_url} rel="noopener noreferrer nofollow" target="_blank" className="border-2 border-ink bg-volt px-4 py-2 font-bold hover:-translate-y-0.5 hover:shadow-hard-sm">
              Open the course page
            </a>
          ) : null}
          {c.university.website ? (
            <a href={c.university.website} rel="noopener noreferrer nofollow" target="_blank" className="border-2 border-ink px-4 py-2 font-bold hover:bg-volt">
              University website
            </a>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Entry rules change every year. Check the course page, or ask admissions, before you apply.
        </p>
      </section>

      <Rankings c={c} />

      <section aria-labelledby="facts" className="grid gap-3">
        <h2 id="facts" className="text-xl font-bold">
          About the course
        </h2>
        <dl className="grid gap-x-6 gap-y-2 border-2 border-ink bg-white p-4 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="grid">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {c.entry_alevel_pct != null || c.entry_other_pct != null ? (
          <p className="text-sm text-slate-700">
            Recent entrants&apos; highest qualification:
            {c.entry_alevel_pct != null ? ` ${c.entry_alevel_pct}% A levels` : ''}
            {c.entry_other_pct != null ? `, ${c.entry_other_pct}% other qualifications` : ''}.
          </p>
        ) : null}
      </section>

      <p className="text-xs text-slate-500">
        Course details: Discover Uni dataset (HESA and the Office for Students), CC BY 4.0, updated {ukDate(c.fetched_at)}.
      </p>
    </article>
  );
}

function Rankings({ c }: { c: CourseDetail }) {
  const u = c.university;
  const subj = rankText(c.subject_rank, c.subject_rank_of, c.subject_rank_tied);
  const uni = rankText(u.overall_rank, u.overall_rank_of, u.overall_rank_tied);
  const measures: [string, string | null][] = [
    ['Student satisfaction', c.satisfaction_pct != null ? `${c.satisfaction_pct}%` : null],
    ['Still on course or qualified after a year', c.continuation_pct != null ? `${c.continuation_pct}%` : null],
    ['In work or study 15 months after', c.work_study_pct != null ? `${c.work_study_pct}%` : null],
    ['Median graduate salary', c.median_salary != null ? `£${c.median_salary.toLocaleString('en-GB')}` : null],
  ];
  const shown = measures.filter(([, v]) => v);
  const gSubj = c.cug ? rankText(c.cug.subject_position, c.cug.subject_of, c.cug.subject_tied) : null;
  return (
    <section aria-labelledby="rank" className="grid gap-3">
      <h2 id="rank" className="text-xl font-bold">
        How it ranks
      </h2>
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Our open-data rank</h3>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="grid content-start gap-1 border-2 border-ink bg-white p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.subject_label ?? 'Subject'}</dt>
          <dd className="display text-2xl">{subj ?? 'Not ranked'}</dd>
          <dd className="text-xs text-slate-600">
            {subj ? 'Among UK providers teaching this subject.' : 'Too few providers or too little data to rank fairly.'}
          </dd>
          {c.subject_league_table_url && !gSubj ? (
            <dd className="text-xs">
              <a href={c.subject_league_table_url} rel="noopener noreferrer nofollow" target="_blank" className="font-semibold underline">
                See {u.name} in the Complete University Guide {c.subject_label?.toLowerCase()} table
              </a>
            </dd>
          ) : null}
        </div>
        <div className="grid content-start gap-1 border-2 border-ink bg-white p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{u.name}</dt>
          <dd className="display text-2xl">{uni ?? 'Not ranked'}</dd>
          <dd className="text-xs text-slate-600">{uni ? 'Across every subject it teaches.' : 'Too few subjects with data to rank.'}</dd>
        </div>
        <div className="grid content-start gap-1 border-2 border-ink bg-white p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Teaching Excellence Framework</dt>
          <dd className="display text-2xl">{u.tef_overall ?? 'No rating'}</dd>
          <dd className="text-xs text-slate-600">
            {u.tef_overall ? (
              <>
                Student experience {u.tef_experience ?? 'not stated'}, outcomes {u.tef_outcomes ?? 'not stated'}.{' '}
                {u.tef_url ? (
                  <a href={u.tef_url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                    Office for Students report
                  </a>
                ) : null}
              </>
            ) : (
              'The TEF covers English providers that took part; others have no rating.'
            )}
          </dd>
        </div>
      </dl>
      {shown.length ? (
        <dl className="grid gap-x-6 gap-y-2 border-2 border-ink bg-white p-4 sm:grid-cols-2">
          {shown.map(([k, v]) => (
            <div key={k} className="grid">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <details className="border-2 border-ink bg-white px-4 py-2 text-sm">
        <summary className="cursor-pointer font-medium">How we rank, and published league tables</summary>
        <div className="mt-2 grid gap-2 text-slate-700">
          <p>
            These ranks are ours, worked out from the government&apos;s open Discover Uni data, not a published league table.
            For each subject we compare UK providers on four measures: student satisfaction (National Student Survey),
            students still on their course or qualified after a year, graduates in work or further study 15 months on, and
            median graduate salary. Small courses are pulled towards the average so a handful of students can&apos;t top the
            table. The university rank averages its scores across every subject it teaches. &ldquo;=&rdquo; means a tie.
          </p>
          <p>
            League tables use different measures and weights, so positions differ. Compare with:{' '}
            {LEAGUE_TABLES.map((t, i) => (
              <span key={t.name}>
                {i ? ', ' : ''}
                <a href={t.url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                  {t.name}
                </a>
              </span>
            ))}
            .
          </p>
          {u.rankings_on ? <p className="text-xs text-slate-500">Ranks worked out {ukDate(u.rankings_on)}.</p> : null}
        </div>
      </details>
    </section>
  );
}
