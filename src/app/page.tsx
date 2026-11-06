import Link from 'next/link';
import { LocationForm } from '@/components/LocationForm';
import { referenceData, regionCounts, siteStats } from '@/lib/data';

export const revalidate = 3600;

export default async function HomePage() {
  const [ref, counts, stats] = await Promise.all([referenceData(), regionCounts(), siteStats()]);
  const totals = counts.filter((c) => c.county === null);
  const all = stats?.employers ?? totals.reduce((n, c) => n + c.companies, 0);
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
            Your 315 hours, sorted, and what comes after. Every engineering employer in England ranked for your
            specialism and how far you can get, plus the apprenticeships and degrees that take your T Level. No
            account, no catch.
          </p>
        </div>

        <section aria-label="Start a search" className="border-2 border-ink bg-white p-5 shadow-[8px_8px_0_0_var(--color-ink)]">
          <LocationForm reference={ref} />
        </section>
      </section>

      <section aria-label="What's in here" className={`grid gap-[2px] border-2 border-ink bg-ink ${stats?.employers_with_contacts != null ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <Stat value={all} label="engineering employers in England" highlight />
        <Stat value={stats?.live_adverts ?? withVacancies} label={stats?.live_adverts != null ? 'live engineering apprenticeship adverts' : 'employers with live apprenticeship adverts'} />
        {stats?.uni_courses != null ? (
          <Stat
            value={stats.uni_courses}
            label={stats.universities ? `degree courses at ${stats.universities.toLocaleString('en-GB')} universities and colleges` : 'engineering, computing, maths and science degree courses'}
          />
        ) : null}
        {stats?.employers_with_contacts != null ? (
          <Stat value={stats.employers_with_contacts} label="employers with a way to get in touch" />
        ) : null}
      </section>

      <section aria-labelledby="paths" className="grid gap-4">
        <h2 id="paths" className="display text-3xl sm:text-4xl">Three ways forward</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Path
            href="/search"
            tag="Now"
            title="Placements"
            cta="Find a placement"
            accent="bg-volt"
          >
            Your 315 hours. Every engineering employer in England, ranked for your specialism and how far you can travel,
            with the reasons shown and how to get in touch.
          </Path>
          <Path href="/apprenticeships" tag="After" title="Apprenticeships" cta="See apprenticeships" accent="bg-cobalt text-white">
            Live engineering adverts, with any T Level mention quoted. Higher and degree apprenticeships (level 4 to 7) are
            the usual next step after a T Level.
          </Path>
          <Path href="/universities" tag="After" title="Universities" cta="Check degrees" accent="bg-ink text-volt">
            Which degrees take your T Level: on its own, with A level Maths, case by case or not at all. We quote the
            course page so you can check it yourself.
          </Path>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Step n="01" title="Tell us where you are">
          Just the first half of your postcode. We use it for distance and forget the rest.
        </Step>
        <Step n="02" title="See who fits">
          Every company gets a score out of 100, with the reasons spelled out. You choose what matters most.
        </Step>
        <Step n="03" title="Get in touch">
          Each employer shows its careers page, role email, switchboard or contact form. Save a shortlist, track who you’ve
          contacted, and get help drafting your first message.
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
  // The 2px gaps on the ink background draw the dividing lines, whatever the layout.
  return (
    <div className={`grid content-start gap-1 p-5 ${highlight ? 'bg-volt' : 'bg-white'}`}>
      <div className="display text-4xl tabular-nums sm:text-5xl">{value.toLocaleString('en-GB')}</div>
      <div className="text-sm font-medium">{label}</div>
    </div>
  );
}

function Path({
  href,
  tag,
  title,
  cta,
  accent,
  children,
}: {
  href: string;
  tag: string;
  title: string;
  cta: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group grid content-start gap-3 border-2 border-ink bg-white p-5 transition hover:-translate-y-1 hover:shadow-hard"
    >
      <span className={`w-fit px-2 py-0.5 text-xs font-bold tracking-[0.15em] ${accent}`}>{tag.toUpperCase()}</span>
      <h3 className="display text-2xl">{title}</h3>
      <p className="text-slate-700">{children}</p>
      <span className="font-bold underline decoration-volt decoration-4 underline-offset-4 group-hover:decoration-ink">
        {cta} →
      </span>
    </Link>
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
