import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { BigFacts, type BigFact } from '@/components/BigFacts';
import { PendingButton } from '@/components/PendingButton';
import { CardStack, ViewToggle } from '@/components/CardStack';
import { SaveButton } from '@/components/SaveButton';
import { displayName, miles, ukDate } from '@/lib/format';
import {
  APP_BANDS,
  APP_BAND_LABEL,
  APP_SORTS,
  APP_SORT_LABEL,
  LEVEL_LABEL,
  apprenticeshipEmployers,
  apprenticeshipHref,
  apprenticeshipSummary,
  parseApprenticeshipSearch,
  searchApprenticeships,
  type AdvertRow,
  type AppBand,
  type AppSummary,
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
  const [ads, schemes, summary] = await Promise.all([
    searchApprenticeships(s, origin),
    s.page === 1 ? apprenticeshipEmployers(s, origin) : Promise.resolve({ rows: [], total: 0 }),
    apprenticeshipSummary(s, origin),
  ]);
  const pages = Math.ceil(ads.total / 20);
  const cards = params.view === 'cards';
  const withView = (href: string) => (cards ? `${href}${href.includes('?') ? '&' : '?'}view=cards` : href);

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="display text-3xl sm:text-4xl">Apprenticeships</h1>
        <p className="max-w-3xl text-slate-700">
          Live engineering apprenticeship adverts from the government&apos;s Find an apprenticeship service. Higher and degree
          apprenticeships (level 4 to 7) are the usual next step after a T Level. Where an advert mentions T Levels, we show
          the exact sentence.
        </p>
        <SummaryStrip summary={summary} />
        <BandPills s={s} summary={summary} cards={cards} />
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
              <div className="flex flex-wrap items-center gap-2">
                <SortMenu s={s} hasOrigin={!!origin} cards={cards} />
                <ViewToggle listHref={apprenticeshipHref(s)} cardsHref={withViewOn(apprenticeshipHref(s, { page: 1 }))} cards={cards} />
              </div>
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
                  badge: r.course_level ? { text: LEVEL_LABEL[r.course_level] ?? `Level ${r.course_level}`, tone: levelTone(r.course_level) } : null,
                  facts: advertFacts(r, !!origin),
                  chips: [
                    r.tlevel_mention ? 'Mentions T Levels' : null,
                    isNew(r) ? 'New this week' : null,
                    r.course_title,
                    r.hours_per_week ? `${Number(r.hours_per_week)} hours a week` : null,
                    r.closing_date ? `Closes ${ukDate(r.closing_date)}` : null,
                    origin ? null : r.postcode?.split(' ')[0] ?? null,
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
              <p className="border-2 border-dashed border-ink bg-white p-6">
                No live adverts match. Try a wider distance, another level, or fewer filters. Adverts come and go every
                week, so save the employers below and check back.
              </p>
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

const daysLeft = (d: string | null) => (d ? Math.floor((Date.parse(`${d.slice(0, 10)}T23:59:59Z`) - Date.now()) / 86_400_000) : null);
const isNew = (r: AdvertRow) => !!r.posted_on && Date.now() - Date.parse(r.posted_on) < 7 * 86_400_000;
const levelTone = (l: number | null) => (l && l >= 6 ? 'volt' : l && l >= 4 ? 'cobalt' : l === 3 ? 'ink' : 'plain') as 'volt' | 'cobalt' | 'ink' | 'plain';
const LEVEL_STYLE = { volt: 'bg-volt text-ink border-ink', cobalt: 'bg-cobalt text-white border-cobalt', ink: 'bg-ink text-paper border-ink', plain: 'bg-white text-ink border-ink border-dashed' };

/** The big figures on an advert: wage, time left to apply, distance, length. */
function advertFacts(r: AdvertRow, showDistance: boolean): BigFact[] {
  const out: BigFact[] = [];
  if (r.wage_annual) out.push({ value: `£${r.wage_annual.toLocaleString('en-GB')}`, unit: '/ year', label: 'Wage' });
  else if (r.wage_text)
    out.push({
      value: /minimum wage for apprentices/i.test(r.wage_text) ? 'Apprentice minimum' : /national minimum/i.test(r.wage_text) ? 'National minimum' : /competitive/i.test(r.wage_text) ? 'Competitive' : 'See advert',
      label: 'Wage',
      tone: 'muted',
    });
  const left = daysLeft(r.closing_date);
  if (left != null)
    out.push(
      left <= 0
        ? { value: 'Today', label: 'Closes', tone: 'urgent' }
        : { value: String(left), unit: left === 1 ? 'day' : 'days', label: 'Left to apply', tone: left <= 7 ? 'urgent' : 'normal' },
    );
  if (showDistance && r.distance_km != null) out.push({ value: (r.distance_km / 1.609).toFixed(r.distance_km < 16 ? 1 : 0), unit: 'miles', label: 'Away' });
  const yrs = r.expected_duration?.match(/(\d+(?:\.\d+)?)\s*(year|month)/i);
  if (yrs) out.push({ value: yrs[1]!, unit: `${yrs[2]!.toLowerCase()}${yrs[1] === '1' ? '' : 's'}`, label: 'Course length' });
  return out;
}

function Advert({ r, showDistance }: { r: AdvertRow; showDistance: boolean }) {
  const tone = levelTone(r.course_level);
  const level = r.course_level ? LEVEL_LABEL[r.course_level] : r.level;
  return (
    <li className="grid gap-3 border-2 border-ink bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-hard">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        {level ? <span className={`border-2 px-2 py-0.5 ${LEVEL_STYLE[tone]}`}>{level}</span> : null}
        {r.tlevel_mention ? <span className="border-2 border-ink bg-volt px-2 py-0.5">Mentions T Levels</span> : null}
        {isNew(r) ? <span className="border-2 border-ink px-2 py-0.5">New this week</span> : null}
        <span className="ml-auto">
          <SaveButton companyId={r.company_id} compact />
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="text-xl font-bold leading-tight">
          {r.url ? (
            <a href={r.url} rel="noopener noreferrer nofollow" target="_blank" className="hover:underline">
              {r.title}
            </a>
          ) : (
            r.title
          )}
        </h3>
        <p className="mt-0.5 text-slate-700">
          <Link href={`/companies/${r.company_id}`} className="font-semibold text-ink hover:underline">
            {displayName(r.employer)}
          </Link>
          {r.postcode ? ` · ${r.postcode.split(' ')[0]}` : ''}
        </p>
      </div>
      <div className="border-l-8 border-volt pl-3">
        <BigFacts facts={advertFacts(r, showDistance)} />
      </div>
      {r.tlevel_mention ? (
        <p className="border-l-4 border-cobalt bg-paper px-3 py-1 text-sm">
          <span className="font-bold">On T Levels:</span> &ldquo;{r.tlevel_mention}&rdquo;
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        {r.course_title ? <span className="border border-ink px-2 py-0.5">{r.course_title}</span> : null}
        {r.hours_per_week ? <span className="border border-ink px-2 py-0.5">{Number(r.hours_per_week)} hours a week</span> : null}
        {r.start_on ? <span className="border border-ink px-2 py-0.5">Starts {ukDate(r.start_on)}</span> : null}
        {r.closing_date ? <span className="border border-ink px-2 py-0.5">Closes {ukDate(r.closing_date)}</span> : null}
        {r.training_provider ? <span className="border border-ink px-2 py-0.5">Training: {r.training_provider}</span> : null}
        {r.wage_text && r.wage_annual ? <span className="text-slate-600">{r.wage_text}</span> : null}
        {r.url ? (
          <a
            href={r.url}
            rel="noopener noreferrer nofollow"
            target="_blank"
            className="ml-auto border-2 border-ink bg-ink px-3 py-1 text-sm font-bold text-volt hover:bg-volt hover:text-ink"
          >
            View and apply
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** Big headline numbers for the current search. */
function SummaryStrip({ summary }: { summary: AppSummary }) {
  const facts: BigFact[] = [
    { value: summary.total.toLocaleString('en-GB'), label: 'Live adverts' },
    { value: summary.degree.toLocaleString('en-GB'), label: 'Degree apprenticeships' },
    { value: summary.closing_this_week.toLocaleString('en-GB'), label: 'Closing this week', tone: summary.closing_this_week ? 'urgent' : 'normal' },
    { value: summary.mention_tlevels.toLocaleString('en-GB'), label: 'Mention T Levels' },
  ];
  if (summary.top_wage) facts.push({ value: `£${summary.top_wage.toLocaleString('en-GB')}`, unit: '/ year', label: 'Top stated wage' });
  return (
    <div className="mt-2 border-2 border-ink bg-white p-4 shadow-hard">
      <BigFacts facts={facts} size="lg" />
    </div>
  );
}

/** Level pills with counts. */
function BandPills({ s, summary, cards }: { s: ApprenticeshipSearch; summary: AppSummary; cards: boolean }) {
  const href = (band: AppBand | null) => `${apprenticeshipHref(s, { band, level: null, page: 1 })}${cards ? '&view=cards' : ''}`;
  const pill = (on: boolean) => `border-2 border-ink px-3 py-1 text-sm font-bold ${on ? 'bg-ink text-volt' : 'bg-white hover:bg-volt'}`;
  return (
    <nav aria-label="Level" className="flex flex-wrap gap-2">
      <Link href={href(null)} className={pill(!s.band && !s.level)} aria-current={!s.band && !s.level ? 'page' : undefined}>
        All levels <span className="font-mono">{summary.total}</span>
      </Link>
      {APP_BANDS.map((b) => (
        <Link key={b} href={href(b)} className={pill(s.band === b)} aria-current={s.band === b ? 'page' : undefined}>
          {APP_BAND_LABEL[b]} <span className="font-mono">{summary[b]}</span>
        </Link>
      ))}
    </nav>
  );
}

/** "Sort by" menu: plain links, so it works instantly and without JavaScript. */
function SortMenu({ s, hasOrigin, cards }: { s: ApprenticeshipSearch; hasOrigin: boolean; cards: boolean }) {
  const href = (sort: ApprenticeshipSearch['sort']) => `${apprenticeshipHref(s, { sort, page: 1 })}${cards ? '&view=cards' : ''}`;
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 border-2 border-ink bg-white px-3 py-1 text-sm font-semibold hover:bg-volt">
        <span className="text-slate-600">Sort by</span> {APP_SORT_LABEL[s.sort]} <span aria-hidden>▾</span>
      </summary>
      <ul className="absolute right-0 z-20 mt-1 grid w-56 border-2 border-ink bg-white text-sm shadow-hard">
        {APP_SORTS.filter((k) => k !== 'nearest' || hasOrigin).map((k) => (
          <li key={k}>
            <Link
              href={href(k)}
              aria-current={k === s.sort ? 'true' : undefined}
              className={`block px-3 py-2 ${k === s.sort ? 'bg-ink font-bold text-volt' : 'hover:bg-volt'}`}
            >
              {APP_SORT_LABEL[k]}
            </Link>
          </li>
        ))}
        {!hasOrigin ? <li className="px-3 py-2 text-xs text-slate-500">Set your postcode to sort by distance.</li> : null}
      </ul>
    </details>
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
        {s.band ? <input type="hidden" name="band" value={s.band} /> : null}
        {s.sort !== 'default' ? <input type="hidden" name="sort" value={s.sort} /> : null}
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
        {s.band ? <input type="hidden" name="band" value={s.band} /> : null}
        {s.sort !== 'default' ? <input type="hidden" name="sort" value={s.sort} /> : null}
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
