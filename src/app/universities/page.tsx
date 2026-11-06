import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { PendingButton } from '@/components/PendingButton';
import { CardStack, ViewToggle } from '@/components/CardStack';
import { SaveCourseButton } from '@/components/SaveButton';
import { RankStats } from '@/components/RankStats';
import { TLevelBadge } from '@/components/TLevelBadge';
import { miles } from '@/lib/format';
import {
  CUG_NAME,
  CUG_URL,
  NATIONS,
  STATUS_ORDER,
  UNI_SORTS,
  UNI_SORT_LABEL,
  SUBJECT_GROUPS,
  TLEVEL_STATUS,
  UNI_PAGE_SIZE,
  parseUniSearch,
  rankStats,
  rankText,
  searchUniCourses,
  uniHref,
  type CourseRow,
  type UniSearch,
} from '@/lib/opportunities';
import { lookupOutcode } from '@/lib/outcode';

export const maxDuration = 30;
export const metadata: Metadata = {
  title: 'Universities',
  description: 'UK engineering degrees and whether they accept a T Level: outright, with A level Maths, case by case or not at all.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function UniversitiesPage({ searchParams }: Props) {
  const params = await searchParams;
  const s = parseUniSearch(params);
  const origin = s.oc ? await lookupOutcode(s.oc).catch(() => null) : null;
  const { rows, total } = await searchUniCourses(s, origin);
  const pages = Math.ceil(total / UNI_PAGE_SIZE);
  const cards = params.view === 'cards';
  const withView = (href: string) => (cards ? `${href}&view=cards` : href);

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="display text-3xl sm:text-4xl">Universities</h1>
        <p className="max-w-3xl text-slate-700">
          Degrees across the UK and what each course page says about T Levels. We quote the exact wording and link to it,
          because entry rules change: always check the course page before you apply.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <details className="border-2 border-ink bg-white lg:hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Filters</summary>
          <Filters s={s} cards={cards} />
        </details>
        <div className="hidden lg:block">
          <Filters s={s} cards={cards} />
        </div>

        <section aria-labelledby="results" className="grid content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="results" className="text-lg font-semibold">
              {total.toLocaleString('en-GB')} {total === 1 ? 'course' : 'courses'}
              {origin && s.km ? ` within ${miles(s.km)} of ${origin.outcode}` : ''}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <SortMenu s={s} hasOrigin={!!origin} cards={cards} />
              <ViewToggle listHref={uniHref(s)} cardsHref={`${uniHref(s, { page: 1 })}&view=cards`} cards={cards} />
            </div>
          </div>
          {s.oc && !origin ? (
            <p role="alert" className="text-sm text-red-700">We couldn&apos;t find that postcode. Try the first half only, for example MK45.</p>
          ) : null}
          {cards ? null : <Legend />}
          {cards ? (
            <CardStack
              itemType="course"
              label="courses"
              nextPageHref={s.page < Math.min(pages, 100) ? withView(uniHref(s, { page: s.page + 1 })) : null}
              items={rows.map((r) => ({
                id: r.id,
                title: r.title,
                subtitle: [r.university, r.qualification].filter(Boolean).join(' · '),
                badge: {
                  text: `${TLEVEL_STATUS[r.tlevel_status].label}${r.tlevel_requirement && (r.tlevel_status === 'accepted' || r.tlevel_status === 'accepted_with_maths') ? ` · ${r.tlevel_requirement}` : ''}`,
                  tone: r.tlevel_status === 'accepted' ? 'volt' : r.tlevel_status === 'accepted_with_maths' ? 'cobalt' : r.tlevel_status === 'not_accepted' ? 'ink' : 'plain',
                },
                stats: rankStats(r),
                chips: [
                  sortValue(r, s.sort),
                  ...secondaryRanks(r),
                  r.russell_group ? 'Russell Group' : null,
                  r.foundation_year ? 'Foundation year available' : null,
                  r.sandwich_year ? 'Placement year available' : null,
                  r.location_name && r.location_name !== r.university ? r.location_name : null,
                  origin && r.distance_km != null ? `${miles(r.distance_km)} away` : null,
                ].filter((x): x is string => !!x),
                href: `/universities/${r.id}`,
              }))}
            />
          ) : rows.length ? (
            <ul className="grid gap-3">
              {rows.map((r) => (
                <CourseCard key={r.id} r={r} showDistance={!!origin} sort={s.sort} />
              ))}
            </ul>
          ) : (
            <p className="border-2 border-ink bg-white p-4">No courses match. Try removing a filter or widening the distance.</p>
          )}
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
              {s.page > 1 ? <Link className="border-2 border-ink px-3 py-1 font-semibold hover:bg-volt" href={withView(uniHref(s, { page: s.page - 1 }))}>Previous</Link> : null}
              <span>
                Page {s.page} of {Math.min(pages, 100)}
              </span>
              {s.page < Math.min(pages, 100) ? <Link className="border-2 border-ink px-3 py-1 font-semibold hover:bg-volt" href={withView(uniHref(s, { page: s.page + 1 }))}>Next</Link> : null}
            </nav>
          ) : null}
          <p className="text-xs text-slate-500">
            Courses: Discover Uni dataset (HESA and the Office for Students), CC BY 4.0. T Level list: Department for Education,
            Open Government Licence v3.0. T Level wording read from each course page. League table positions (CUG 2027):{' '}
            <a href={CUG_URL} rel="noopener noreferrer nofollow" target="_blank" className="underline">
              {CUG_NAME} 2027
            </a>
            , used with permission. &ldquo;Our rank&rdquo; is worked out from Discover Uni open data; each course page shows how.
          </p>
        </section>
      </div>
    </div>
  );
}

/** Smaller extras beside the big numbers: our own ranks (when the big numbers are CUG's) and the TEF rating. */
function secondaryRanks(r: CourseRow): string[] {
  const shown = new Set(rankStats(r).map((x) => x.source));
  const ours = !shown.has('Our open-data rank');
  const uni = rankText(r.overall_rank, r.overall_rank_of, r.overall_rank_tied);
  const subj = rankText(r.subject_rank, r.subject_rank_of, r.subject_rank_tied);
  return [
    ours && subj && r.subject_label ? `Our rank: ${subj} for ${r.subject_label.toLowerCase()}` : null,
    ours && uni ? `Our rank: ${uni} overall` : null,
    r.tef_overall ? `TEF ${r.tef_overall}` : null,
  ].filter((x): x is string => !!x);
}

/** The measure being sorted on, shown on each course so the order makes sense. */
function sortValue(r: CourseRow, sort: UniSearch['sort']): string | null {
  if (sort === 'satisfaction') return r.satisfaction_pct != null ? `${r.satisfaction_pct}% satisfied` : 'No satisfaction data';
  if (sort === 'salary') return r.median_salary != null ? `£${r.median_salary.toLocaleString('en-GB')} median graduate salary` : 'No salary data';
  return null;
}

/** "Sort by" menu: plain links, so it works instantly and without JavaScript. */
function SortMenu({ s, hasOrigin, cards }: { s: UniSearch; hasOrigin: boolean; cards: boolean }) {
  const href = (sort: UniSearch['sort']) => `${uniHref(s, { sort, page: 1 })}${cards ? '&view=cards' : ''}`;
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 border-2 border-ink bg-white px-3 py-1 text-sm font-semibold hover:bg-volt">
        <span className="text-slate-600">Sort by</span> {UNI_SORT_LABEL[s.sort]} <span aria-hidden>▾</span>
      </summary>
      <ul className="absolute right-0 z-20 mt-1 grid w-64 border-2 border-ink bg-white text-sm shadow-hard">
        {UNI_SORTS.filter((k) => k !== 'nearest' || hasOrigin).map((k) => (
          <li key={k}>
            <Link
              href={href(k)}
              aria-current={k === s.sort ? 'true' : undefined}
              className={`block px-3 py-2 ${k === s.sort ? 'bg-ink font-bold text-volt' : 'hover:bg-volt'}`}
            >
              {UNI_SORT_LABEL[k]}
            </Link>
          </li>
        ))}
        {!hasOrigin ? <li className="px-3 py-2 text-xs text-slate-500">Set your postcode to sort by distance.</li> : null}
      </ul>
    </details>
  );
}

function CourseCard({ r, showDistance, sort }: { r: CourseRow; showDistance: boolean; sort: UniSearch['sort'] }) {
  const stats = rankStats(r);
  const ranks = secondaryRanks(r);
  const sorted = sortValue(r, sort);
  const extras = [r.foundation_year ? 'Foundation year available' : null, r.sandwich_year ? 'Placement year available' : null].filter(Boolean);
  return (
    <li className="border-2 border-ink bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-hard">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-tight">
            <Link href={`/universities/${r.id}`} className="hover:underline">
              {r.title}
            </Link>
            {r.qualification ? <span className="ml-2 text-sm font-medium text-slate-600">{r.qualification}</span> : null}
          </h3>
          <p className="text-sm text-slate-700">
            {r.university}
            {r.location_name && r.location_name !== r.university ? ` · ${r.location_name}` : ''}
            {showDistance && r.distance_km != null ? ` · ${miles(r.distance_km)} away` : ''}
          </p>
        </div>
        <SaveCourseButton courseId={r.id} compact />
      </div>
      {sorted ? <p className="mt-2 w-fit bg-ink px-2 py-0.5 text-sm font-bold text-volt">{sorted}</p> : null}
      {stats.length ? (
        <div className="mt-3 border-l-8 border-volt pl-3">
          <RankStats stats={stats} />
        </div>
      ) : null}
      {ranks.length ? (
        <ul aria-label="More rankings" className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          {ranks.map((x) => (
            <li key={x} className="border-2 border-cobalt px-2 py-0.5 text-cobalt">
              {x}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <TLevelBadge status={r.tlevel_status} requirement={r.tlevel_requirement} />
        {r.tlevel_scope === 'university' && r.tlevel_status !== 'unknown' ? (
          <span className="text-xs text-slate-600" title="The course page doesn't say; this is the university's general T Level statement.">
            university-wide statement
          </span>
        ) : null}
        {r.russell_group ? <span className="border border-ink px-2 py-0.5 text-xs font-medium">Russell Group</span> : null}
        {r.on_dfe_tlevel_list ? <span className="border border-ink px-2 py-0.5 text-xs font-medium">On DfE T Level list</span> : null}
        {extras.map((e) => (
          <span key={e} className="border border-ink px-2 py-0.5 text-xs font-medium">
            {e}
          </span>
        ))}
        {r.course_url ? (
          <a href={r.course_url} rel="noopener noreferrer nofollow" target="_blank" className="ml-auto text-sm font-semibold text-brand-700 underline">
            Course page
          </a>
        ) : null}
      </div>
    </li>
  );
}

function Legend() {
  return (
    <details className="border-2 border-ink bg-white px-4 py-2 text-sm">
      <summary className="cursor-pointer font-medium">What the labels mean</summary>
      <dl className="mt-2 grid gap-2">
        {STATUS_ORDER.map((st) => (
          <div key={st} className="grid gap-1 sm:grid-cols-[12rem_1fr]">
            <dt>
              <TLevelBadge status={st} />
            </dt>
            <dd className="text-slate-700">{TLEVEL_STATUS[st].help}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Filters({ s, cards }: { s: UniSearch; cards: boolean }) {
  return (
    <div className="grid gap-4 border-2 border-ink bg-white p-4 text-sm">
      {/* The postcode goes through /go so only its first half ever reaches a URL. */}
      <form method="post" action="/go" className="grid gap-2">
        <input type="hidden" name="dest" value="universities" />
        {cards ? <input type="hidden" name="view" value="cards" /> : null}
        {s.group ? <input type="hidden" name="group" value={s.group} /> : <input type="hidden" name="group" value="all" />}
        {s.status.map((st) => <input key={st} type="hidden" name="status" value={st} />)}
        {s.q ? <input type="hidden" name="q" value={s.q} /> : null}
        {s.nation ? <input type="hidden" name="nation" value={s.nation} /> : null}
        {s.dfe ? <input type="hidden" name="dfe" value="1" /> : null}
        {s.russell ? <input type="hidden" name="rg" value="1" /> : null}
        {s.fy ? <input type="hidden" name="fy" value={s.fy} /> : null}
        {s.sort !== 'default' ? <input type="hidden" name="sort" value={s.sort} /> : null}
        <label className="grid gap-1">
          <span className="font-medium">Your postcode</span>
          <input name="postcode" autoComplete="postal-code" defaultValue={s.oc ?? ''} placeholder="e.g. MK45" className="border-2 border-ink px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Distance</span>
          <select name="km" defaultValue={String(s.km)} className="border-2 border-ink px-2 py-1">
            <option value="0">Anywhere in the UK</option>
            <option value="40">25 miles</option>
            <option value="80">50 miles</option>
            <option value="160">100 miles</option>
            <option value="320">200 miles</option>
          </select>
        </label>
        <PendingButton className="border-2 border-ink bg-ink px-3 py-1.5 font-bold text-volt hover:bg-volt hover:text-ink" pendingText="Finding…">Set location</PendingButton>
      </form>

      <Form action="/universities" className="grid gap-3">
        {cards ? <input type="hidden" name="view" value="cards" /> : null}
        {s.sort !== 'default' ? <input type="hidden" name="sort" value={s.sort} /> : null}
        {s.oc ? <input type="hidden" name="oc" value={s.oc} /> : null}
        {s.km ? <input type="hidden" name="km" value={s.km} /> : null}
        <label className="grid gap-1">
          <span className="font-medium">Course or university</span>
          <input name="q" defaultValue={s.q ?? ''} placeholder="e.g. electronic, Bath" className="border-2 border-ink px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Subject</span>
          <select name="group" defaultValue={s.group ?? 'all'} className="border-2 border-ink px-2 py-1">
            {Object.entries(SUBJECT_GROUPS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
            <option value="all">All subjects</option>
          </select>
        </label>
        <fieldset className="grid gap-1">
          <legend className="font-medium">T Level entry</legend>
          {STATUS_ORDER.map((st) => (
            <label key={st} className="flex items-center gap-2">
              <input type="checkbox" name="status" value={st} defaultChecked={s.status.includes(st)} />
              {TLEVEL_STATUS[st].label}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="dfe" value="1" defaultChecked={s.dfe} />
          Only universities on DfE&apos;s T Level list
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="rg" value="1" defaultChecked={s.russell} />
          Only Russell Group universities
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Foundation year</span>
          <select name="fy" defaultValue={s.fy ?? ''} className="border-2 border-ink px-2 py-1">
            <option value="">Either</option>
            <option value="yes">With a foundation year</option>
            <option value="no">Without a foundation year</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Nation</span>
          <select name="nation" defaultValue={s.nation ?? ''} className="border-2 border-ink px-2 py-1">
            <option value="">Anywhere in the UK</option>
            {Object.entries(NATIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <PendingButton className="border-2 border-ink bg-volt px-3 py-1.5 font-bold hover:-translate-y-0.5 hover:shadow-hard-sm" pendingText="Searching…" resetKey={uniHref(s)}>Show courses</PendingButton>
        <Link href="/universities" className="text-center underline">
          Clear filters
        </Link>
      </Form>
    </div>
  );
}
