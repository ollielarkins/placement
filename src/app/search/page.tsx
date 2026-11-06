import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { PendingButton } from '@/components/PendingButton';
import { LocationForm } from '@/components/LocationForm';
import { ResultCard } from '@/components/ResultCard';
import { collegeTags, referenceData, searchCompanies } from '@/lib/data';
import { PAGE_SIZE, parseSearch, searchHref, type SearchState } from '@/lib/filters';
import { humanise } from '@/lib/format';
import { lookupOutcode } from '@/lib/outcode';
import { ENGLAND_REGION_LABELS } from '@/types/domain';

// Allow for a cold database on the first search after a quiet spell (default is 10 s).
export const maxDuration = 30;

export const metadata: Metadata = { title: 'Search employers' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const s = parseSearch(params);
  const [ref, origin] = await Promise.all([
    referenceData(),
    s.oc ? lookupOutcode(s.oc).catch(() => null) : Promise.resolve(null),
  ]);
  const { rows, total } = await searchCompanies(s, origin);
  const tags = await collegeTags(rows.map((r) => r.company_id));
  const pages = Math.ceil(total / PAGE_SIZE);
  const pcError = params.pcerror === '1' || (s.oc && !origin);

  return (
    <div className="grid gap-6">
      <section className="border-2 border-ink bg-white p-4">
        <LocationForm reference={ref} defaults={{ oc: s.oc, km: s.km, route: s.route, spec: s.spec }} compact />
        {pcError ? (
          <p role="alert" className="mt-2 text-sm text-red-700">
            We couldn&apos;t find that postcode. Try the first half only, for example MK45.
          </p>
        ) : null}
        {origin && !origin.inEngland ? (
          <p className="mt-2 text-sm text-amber-800">
            {origin.outcode} is outside England. This app covers employers in England only for now.
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        {/* Phones: filters collapse so results come first. Desktop: always-open sidebar. Same GET form, no JS. */}
        <details className="border-2 border-ink bg-white lg:hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Filters and what matters to you</summary>
          <Filters s={s} sectors={ref.sectors} bare />
        </details>
        <div className="hidden lg:block">
          <Filters s={s} sectors={ref.sectors} />
        </div>

        <section aria-labelledby="results-heading" className="grid content-start gap-3">
          <h2 id="results-heading" className="text-lg font-semibold">
            {total.toLocaleString('en-GB')} {total === 1 ? 'employer' : 'employers'}
            {origin ? ` within reach of ${origin.outcode}` : ' in England'}
          </h2>
          {!origin ? (
            <p className="text-sm text-slate-600">Add your postcode to rank employers by distance as well.</p>
          ) : null}
          {rows.length === 0 ? (
            <p className="border-2 border-dashed border-ink bg-white p-6 text-slate-600">
              No employers match. Try a bigger travel distance, fewer filters, or tick &quot;show employers further
              away&quot;.
            </p>
          ) : (
            <ol className="grid gap-3">
              {rows.map((r) => (
                <ResultCard key={r.company_id} r={r} hasOrigin={Boolean(origin)} colleges={tags.get(r.company_id) ?? []} />
              ))}
            </ol>
          )}
          {pages > 1 ? <Pager s={s} pages={pages} /> : null}
        </section>
      </div>
    </div>
  );
}

function Filters({ s, sectors, bare = false }: { s: SearchState; sectors: string[]; bare?: boolean }) {
  return (
    <Form
      action="/search"
      className={`grid content-start gap-5 p-4 text-sm ${bare ? 'border-t border-slate-100' : 'border-2 border-ink bg-white'}`}
    >
      {/* Location and route come from the form above; keep them. */}
      {s.oc ? <input type="hidden" name="oc" value={s.oc} /> : null}
      <input type="hidden" name="km" value={s.km} />
      {s.route ? <input type="hidden" name="route" value={s.route} /> : null}
      {s.spec ? <input type="hidden" name="spec" value={s.spec} /> : null}

      <label className="grid gap-1">
        <span className="font-medium">Search</span>
        <input name="q" defaultValue={s.q ?? ''} placeholder="Company, sector or keyword" className="rounded-md border border-slate-300 px-3 py-2" />
      </label>

      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium">Show only</legend>
        <Check name="taken" checked={s.taken} label="Has taken T Level students" />
        <Check name="onward" checked={s.onward} label="Has a route onward (apprenticeship, job)" />
        <Check name="core" checked={s.core} label="Engineering companies only (hide engineering-adjacent)" />
        <Check name="source" value="verified" checked={s.sources.includes('verified')} label="Checked by a person" />
        <Check name="outside" checked={s.outside} label="Show employers further away" />
      </fieldset>

      <label className="grid gap-1">
        <span className="font-medium">Region</span>
        <select name="region" defaultValue={s.region ?? ''} className="rounded-md border border-slate-300 px-3 py-2">
          <option value="">All of England</option>
          {Object.entries(ENGLAND_REGION_LABELS).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium">Sector</legend>
        {sectors.map((x) => (
          <Check key={x} name="sector" value={x} checked={s.sectors.includes(x)} label={humanise(x)} />
        ))}
      </fieldset>

      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium">Company size</legend>
        {(['micro', 'small', 'medium', 'large'] as const).map((x) => (
          <Check key={x} name="size" value={x} checked={s.sizes.includes(x)} label={humanise(x)} />
        ))}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">What matters most to you?</legend>
        <Slider name="wr" value={s.weights.route_onward} label="Route onward (apprenticeship, job)" />
        <Slider name="ws" value={s.weights.specialism_fit} label="Fits my specialism" />
        <Slider name="wp" value={s.weights.practicalities} label="Practicalities (distance, takes students)" />
        <Slider name="wb" value={s.weights.brand} label="Size and reputation" />
      </fieldset>

      <div className="flex gap-2">
        <PendingButton className="border-2 border-ink bg-ink px-4 py-2 font-bold text-volt hover:bg-volt hover:text-ink" pendingText="Searching…" resetKey={searchHref(s)}>
          Apply
        </PendingButton>
        <Link href={searchHref({ ...s, q: null, region: null, sectors: [], sizes: [], taken: false, onward: false, sources: [], outside: false, core: false, weights: { route_onward: 30, specialism_fit: 25, practicalities: 25, brand: 20 }, page: 1 })} className="rounded-md px-4 py-2 text-slate-600 hover:underline">
          Clear
        </Link>
      </div>
    </Form>
  );
}

function Check({ name, value = '1', checked, label }: { name: string; value?: string; checked: boolean; label: string }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} value={value} defaultChecked={checked} className="size-4 accent-brand-600" />
      {label}
    </label>
  );
}

function Slider({ name, value, label }: { name: string; value: number; label: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-slate-700">{label}</span>
      <input type="range" name={name} min={0} max={100} step={5} defaultValue={value} className="accent-brand-600" />
    </label>
  );
}

function Pager({ s, pages }: { s: SearchState; pages: number }) {
  return (
    <nav aria-label="Pages" className="flex items-center justify-between pt-2 text-sm">
      {s.page > 1 ? (
        <Link className="text-brand-700 underline" href={searchHref(s, { page: s.page - 1 })}>Previous</Link>
      ) : <span />}
      <span className="text-slate-600">Page {s.page} of {pages}</span>
      {s.page < pages ? (
        <Link className="text-brand-700 underline" href={searchHref(s, { page: s.page + 1 })}>Next</Link>
      ) : <span />}
    </nav>
  );
}
