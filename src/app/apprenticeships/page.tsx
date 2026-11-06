import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { PendingButton } from '@/components/PendingButton';
import { CardStack, ViewToggle } from '@/components/CardStack';
import { SaveButton } from '@/components/SaveButton';
import { displayName, miles, ukDate } from '@/lib/format';
import {
  LEVEL_LABEL,
  apprenticeshipEmployers,
  apprenticeshipHref,
  parseApprenticeshipSearch,
  searchApprenticeships,
  type AdvertRow,
  type ApprenticeshipSearch,
} from '@/lib/opportunities';
import { lookupOutcode } from '@/lib/outcode';

export const maxDuration = 30;
export const metadata: Metadata = {
  title: 'Apprenticeships',
  description: 'Live engineering apprenticeships in England, and employers with apprenticeship schemes. Adverts that mention T Levels are marked.',
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ApprenticeshipsPage({ searchParams }: Props) {
  const params = await searchParams;
  const s = parseApprenticeshipSearch(params);
  const origin = s.oc ? await lookupOutcode(s.oc).catch(() => null) : null;
  const [ads, schemes] = await Promise.all([
    searchApprenticeships(s, origin),
    s.page === 1 ? apprenticeshipEmployers(s, origin) : Promise.resolve({ rows: [], total: 0 }),
  ]);
  const pages = Math.ceil(ads.total / 20);
  const cards = params.view === 'cards';
  const withView = (href: string) => (cards ? `${href}${href.includes('?') ? '&' : '?'}view=cards` : href);

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="display text-3xl sm:text-4xl">Apprenticeships</h1>
        <p className="max-w-3xl text-slate-700">
          Live engineering apprenticeship adverts from the government&apos;s Find an apprenticeship service. Few adverts say
          anything about T Levels. Where one does, we show the exact sentence. Higher and degree apprenticeships (level 4 to 7)
          are the usual next step after a T Level.
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

        <div className="grid content-start gap-8">
          <section aria-labelledby="ads" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="ads" className="text-lg font-semibold">
              {ads.total.toLocaleString('en-GB')} live {ads.total === 1 ? 'advert' : 'adverts'}
              {origin && s.km ? ` within ${miles(s.km)} of ${origin.outcode}` : ' in England'}
            </h2>
              <ViewToggle listHref={apprenticeshipHref(s)} cardsHref={withViewOn(apprenticeshipHref(s, { page: 1 }))} cards={cards} />
            </div>
            {s.oc && !origin ? (
              <p role="alert" className="text-sm text-red-700">We couldn&apos;t find that postcode. Try the first half only, for example MK45.</p>
            ) : null}
            {cards ? (
              <CardStack
                itemType="vacancy"
                label="apprenticeships"
                nextPageHref={s.page < Math.min(pages, 100) ? withView(apprenticeshipHref(s, { page: s.page + 1 })) : null}
                items={ads.rows.map((r) => ({
                  id: r.id,
                  title: r.title,
                  subtitle: displayName(r.employer),
                  badge: r.tlevel_mention ? { text: 'Mentions T Levels', tone: 'volt' as const } : null,
                  chips: [
                    r.course_level ? LEVEL_LABEL[r.course_level] ?? null : r.level,
                    r.course_title,
                    r.wage_text,
                    r.closing_date ? `Closes ${ukDate(r.closing_date)}` : null,
                    origin && r.distance_km != null ? `${miles(r.distance_km)} away` : r.postcode?.split(' ')[0] ?? null,
                  ].filter((x): x is string => !!x),
                  note: r.tlevel_mention ? `“${r.tlevel_mention}”` : null,
                  href: r.url ?? `/companies/${r.company_id}`,
                  external: !!r.url,
                }))}
              />
            ) : ads.rows.length ? (
              <ul className="grid gap-3">
                {ads.rows.map((r) => (
                  <Advert key={r.id} r={r} showDistance={!!origin} />
                ))}
              </ul>
            ) : (
              <p className="border-2 border-ink bg-white p-4">No live adverts match. Try a wider distance or fewer filters.</p>
            )}
            {pages > 1 ? (
              <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
                {s.page > 1 ? <Link className="border-2 border-ink px-3 py-1 font-semibold hover:bg-volt" href={withView(apprenticeshipHref(s, { page: s.page - 1 }))}>Previous</Link> : null}
                <span>
                  Page {s.page} of {Math.min(pages, 100)}
                </span>
                {s.page < Math.min(pages, 100) ? <Link className="border-2 border-ink px-3 py-1 font-semibold hover:bg-volt" href={withView(apprenticeshipHref(s, { page: s.page + 1 }))}>Next</Link> : null}
              </nav>
            ) : null}
          </section>

          {s.page === 1 && !cards ? (
            <section aria-labelledby="schemes" className="grid gap-3">
              <h2 id="schemes" className="text-lg font-semibold">
                Employers with apprenticeship schemes{origin && s.km ? ` near ${origin.outcode}` : ''}
              </h2>
              <p className="text-sm text-slate-700">
                These employers run apprenticeships, from our research or their own careers pages, but may have no advert open
                right now. Save them and check back before their next intake.
              </p>
              {schemes.rows.length ? (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {schemes.rows.map((e) => (
                    <li key={e.id} className="grid content-start gap-2 border-2 border-ink bg-white p-4">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/companies/${e.id}`} className="font-bold hover:underline">
                          {displayName(e.name)}
                        </Link>
                        <SaveButton companyId={e.id} compact />
                      </div>
                      <p className="text-sm text-slate-700">
                        {[e.has_degree_apprenticeship ? 'Degree apprenticeships' : null, origin && e.distance_km != null ? `${miles(e.distance_km)} away` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {e.scheme_url ? (
                        <a href={e.scheme_url} rel="noopener noreferrer nofollow" target="_blank" className="text-sm font-semibold text-brand-700 underline">
                          Their apprenticeships page
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-2 border-ink bg-white p-4">None found nearby yet.</p>
              )}
            </section>
          ) : null}

          <p className="text-xs text-slate-500">
            Adverts: Find an apprenticeship, Department for Education, Open Government Licence v3.0. Apply through the advert;
            this site never contacts employers for you.
          </p>
        </div>
      </div>
    </div>
  );
}

function Advert({ r, showDistance }: { r: AdvertRow; showDistance: boolean }) {
  const level = r.course_level ? LEVEL_LABEL[r.course_level] : r.level;
  return (
    <li className="border-2 border-ink bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-hard">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-tight">
            {r.url ? (
              <a href={r.url} rel="noopener noreferrer nofollow" target="_blank" className="hover:underline">
                {r.title}
              </a>
            ) : (
              r.title
            )}
          </h3>
          <p className="text-sm text-slate-700">
            <Link href={`/companies/${r.company_id}`} className="font-semibold hover:underline">
              {displayName(r.employer)}
            </Link>
            {r.postcode ? ` · ${r.postcode.split(' ')[0]}` : ''}
            {showDistance && r.distance_km != null ? ` · ${miles(r.distance_km)} away` : ''}
          </p>
        </div>
        <SaveButton companyId={r.company_id} compact />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
        {level ? <span className="border border-ink px-2 py-0.5">{level}</span> : null}
        {r.course_title ? <span className="border border-ink px-2 py-0.5">{r.course_title}</span> : null}
        {r.wage_text ? <span className="border border-ink px-2 py-0.5">{r.wage_text}</span> : null}
        {r.closing_date ? <span className="border border-ink px-2 py-0.5">Closes {ukDate(r.closing_date)}</span> : null}
      </div>
      {r.tlevel_mention ? (
        <p className="mt-2 border-l-4 border-volt bg-paper px-3 py-1 text-sm">
          <span className="font-bold">Mentions T Levels:</span> “{r.tlevel_mention}”
        </p>
      ) : null}
    </li>
  );
}

const withViewOn = (href: string) => `${href}${href.includes('?') ? '&' : '?'}view=cards`;

function Filters({ s, cards }: { s: ApprenticeshipSearch; cards: boolean }) {
  return (
    <div className="grid gap-4 border-2 border-ink bg-white p-4 text-sm">
      <form method="post" action="/go" className="grid gap-2">
        <input type="hidden" name="dest" value="apprenticeships" />
        {cards ? <input type="hidden" name="view" value="cards" /> : null}
        {s.q ? <input type="hidden" name="q" value={s.q} /> : null}
        {s.level ? <input type="hidden" name="level" value={s.level} /> : null}
        {s.tlevel ? <input type="hidden" name="tlevel" value="1" /> : null}
        <label className="grid gap-1">
          <span className="font-medium">Your postcode</span>
          <input name="postcode" autoComplete="postal-code" defaultValue={s.oc ?? ''} placeholder="e.g. MK45" className="border-2 border-ink px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Distance</span>
          <select name="km" defaultValue={String(s.km)} className="border-2 border-ink px-2 py-1">
            <option value="16">10 miles</option>
            <option value="40">25 miles</option>
            <option value="80">50 miles</option>
            <option value="160">100 miles</option>
            <option value="0">Anywhere in England</option>
          </select>
        </label>
        <PendingButton className="border-2 border-ink bg-ink px-3 py-1.5 font-bold text-volt hover:bg-volt hover:text-ink" pendingText="Finding…">Set location</PendingButton>
      </form>
      <Form action="/apprenticeships" className="grid gap-3">
        {cards ? <input type="hidden" name="view" value="cards" /> : null}
        {s.oc ? <input type="hidden" name="oc" value={s.oc} /> : null}
        {s.km !== 40 ? <input type="hidden" name="km" value={s.km} /> : null}
        <label className="grid gap-1">
          <span className="font-medium">Role, course or employer</span>
          <input name="q" defaultValue={s.q ?? ''} placeholder="e.g. electrical, maintenance" className="border-2 border-ink px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="font-medium">Level</span>
          <select name="level" defaultValue={s.level ? String(s.level) : ''} className="border-2 border-ink px-2 py-1">
            <option value="">Any level</option>
            {Object.entries(LEVEL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="tlevel" value="1" defaultChecked={s.tlevel} />
          Only adverts that mention T Levels
        </label>
        <PendingButton className="border-2 border-ink bg-volt px-3 py-1.5 font-bold hover:-translate-y-0.5 hover:shadow-hard-sm" pendingText="Searching…" resetKey={apprenticeshipHref(s)}>Show adverts</PendingButton>
        <Link href="/apprenticeships" className="text-center underline">
          Clear filters
        </Link>
      </Form>
    </div>
  );
}
