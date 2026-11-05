import Link from 'next/link';
import { LocationForm } from '@/components/LocationForm';
import { referenceData, regionCounts } from '@/lib/data';

export const revalidate = 3600;

export default async function HomePage() {
  const [ref, counts] = await Promise.all([referenceData(), regionCounts()]);
  const totals = counts.filter((c) => c.county === null);
  const all = totals.reduce((n, c) => n + c.companies, 0);
  const verified = totals.reduce((n, c) => n + c.verified, 0);
  const withVacancies = totals.reduce((n, c) => n + c.with_vacancies, 0);

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h1 className="text-2xl font-semibold sm:text-3xl">Find your T Level engineering placement</h1>
        <p className="max-w-2xl text-slate-700">
          Search engineering employers across England, ranked for your T Level, your specialism and how far you can
          travel. Every company shows where its information came from. No account needed.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <LocationForm reference={ref} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat value={all} label="engineering employers in England" />
        <Stat value={verified} label="checked by a person for T Level placements" />
        <Stat value={withVacancies} label="with live apprenticeship adverts" />
      </section>

      <p className="text-sm text-slate-600">
        Not sure where to start? <Link className="text-brand-700 underline" href="/regions">See where employers are</Link>{' '}
        or <Link className="text-brand-700 underline" href="/map">browse the map</Link>.
      </p>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString('en-GB')}</div>
      <div className="text-sm text-slate-600">{label}</div>
    </div>
  );
}
