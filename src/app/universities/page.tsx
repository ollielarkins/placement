import type { Metadata } from 'next';
import Link from 'next/link';
import { SaveCourseButton } from '@/components/SaveButton';
import { TLevelBadge } from '@/components/TLevelBadge';
import { miles } from '@/lib/format';
import {
  NATIONS,
  STATUS_ORDER,
  SUBJECT_GROUPS,
  TLEVEL_STATUS,
  UNI_PAGE_SIZE,
  parseUniSearch,
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
          <Filters s={s} />
        </details>
        <div className="hidden lg:block">
          <Filters s={s} />
        </div>

        <section aria-labelledby="results" className="grid content-start gap-3">
          <h2 id="results" className="text-lg font-semibold">
            {total.toLocaleString('en-GB')} {total === 1 ? 'course' : 'courses'}
            {origin && s.km ? ` within ${miles(s.km)} of ${origin.outcode}` : ''}
          </h2>
          {s.oc && !origin ? (
            <p role="alert" className="text-sm text-red-700">We couldn&apos;t find that postcode. Try the first half only, for example MK45.</p>
          ) : null}
          <Legend />
          {rows.length ? (
            <ul className="grid gap-3">
              {rows.map((r) => (
                <CourseCard key={r.id} r={r} showDistance={!!origin} />
              ))}
            </ul>
          ) : (
            <p className="border-2 border-ink bg-white p-4">No courses match. Try removing a filter or widening the distance.</p>
          )}
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
              {s.page > 1 ? <Link className="border-2 border-ink px-3 py-1 font-semibold hover:bg-volt" href={uniHref(s, { page: s.page - 1 })}>Previous</Link> : null}
              <span>
                Page {s.page} of {Math.min(pages, 100)}
              </span>
              {s.page < Math.min(pages, 100) ? <Link className="border-2 border-ink px-3 py-1 font-semibold hover:bg-volt" href={uniHref(s, { page: s.page + 1 })}>Next</Link> : null}
            </nav>
          ) : null}
          <p className="text-xs text-slate-500">
            Courses: Discover Uni dataset (HESA and the Office for Students), CC BY 4.0. T Level list: Department for Education,
            Open Government Licence v3.0. T Level wording read from each course page.
          </p>
        </section>
      </div>
    </div>
  );
}

function CourseCard({ r, showDistance }: { r: CourseRow; showDistance: boolean }) {
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
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <TLevelBadge status={r.tlevel_status} requirement={r.tlevel_requirement} />
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

function Filters({ s }: { s: UniSearch }) {
  return (
    <div className="grid gap-4 border-2 border-ink bg-white p-4 text-sm">
      {/* The postcode goes through /go so only its first half ever reaches a URL. */}
      <form method="post" action="/go" className="grid gap-2">
        <input type="hidden" name="dest" value="universities" />
        {s.group ? <input type="hidden" name="group" value={s.group} /> : <input type="hidden" name="group" value="all" />}
        {s.status.map((st) => <input key={st} type="hidden" name="status" value={st} />)}
        {s.q ? <input type="hidden" name="q" value={s.q} /> : null}
        {s.nation ? <input type="hidden" name="nation" value={s.nation} /> : null}
        {s.dfe ? <input type="hidden" name="dfe" value="1" /> : null}
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
        <button className="border-2 border-ink bg-ink px-3 py-1.5 font-bold text-volt hover:bg-volt hover:text-ink">Set location</button>
      </form>

      <form method="get" action="/universities" className="grid gap-3">
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
        <button className="border-2 border-ink bg-volt px-3 py-1.5 font-bold hover:-translate-y-0.5 hover:shadow-hard-sm">Show courses</button>
        <Link href="/universities" className="text-center underline">
          Clear filters
        </Link>
      </form>
    </div>
  );
}
