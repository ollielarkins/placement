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
    <div className="grid gap-12">
      <section className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <div className="grid gap-5">
          <p className="w-fit border-2 border-ink bg-volt px-2 py-0.5 text-xs font-bold tracking-[0.15em]">
            ENGINEERING &amp; MANUFACTURING T LEVELS
          </p>
          <h1 className="display text-[2.6rem] min-[420px]:text-5xl sm:text-7xl">
            Find the
            <br />
            placement
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">that fits.</span>
              <span aria-hidden className="absolute inset-x-0 bottom-1 -z-0 h-4 bg-volt sm:h-6" />
            </span>
          </h1>
          <p className="max-w-xl text-lg">
            Your 315 hours, sorted. Every engineering employer in England, ranked for your specialism and how far
            you can get. No account, no catch.
          </p>
        </div>

        <section aria-label="Start a search" className="border-2 border-ink bg-white p-5 shadow-[8px_8px_0_0_var(--color-ink)]">
          <LocationForm reference={ref} />
        </section>
      </section>

      <section aria-label="What's in here" className="grid border-2 border-ink bg-white sm:grid-cols-3">
        <Stat value={all} label="engineering employers in England" />
        <Stat value={verified} label="checked by a person for T Level placements" highlight />
        <Stat value={withVacancies} label="with live apprenticeship adverts" />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Step n="01" title="Tell us where you are">
          Just the first half of your postcode. We use it for distance and forget the rest.
        </Step>
        <Step n="02" title="See who fits">
          Every company gets a score out of 100, with the reasons spelled out. You choose what matters most.
        </Step>
        <Step n="03" title="Get in touch">
          Save a shortlist, track who you’ve contacted, and get help drafting your first message.
        </Step>
      </section>

      <p className="text-base">
        Not sure where to start?{' '}
        <Link className="font-semibold underline" href="/regions">See where the employers are</Link> or{' '}
        <Link className="font-semibold underline" href="/map">browse the map</Link>.
      </p>
    </div>
  );
}

function Stat({ value, label, highlight = false }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div className={`grid gap-1 border-ink p-5 not-last:border-b-2 sm:not-last:border-b-0 sm:not-last:border-r-2 ${highlight ? 'bg-volt' : ''}`}>
      <div className="display text-4xl tabular-nums sm:text-5xl">{value.toLocaleString('en-GB')}</div>
      <div className="text-sm font-medium">{label}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-2 border-t-2 border-ink pt-3">
      <span className="font-mono text-sm font-bold">{n}</span>
      <h2 className="display text-xl">{title}</h2>
      <p className="text-slate-700">{children}</p>
    </div>
  );
}
