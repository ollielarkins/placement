import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SaveButton } from '@/components/SaveButton';
import { AdjacentBadge, SourceBadge } from '@/components/SourceBadge';
import { companyDetail, specialismNames, type CompanyContact, type CompanyDetail } from '@/lib/data';

type CompanySource = CompanyDetail['sources'][number];
import {
  ROUTE_ONWARD_LABEL,
  SITE_KIND_LABEL,
  SIZE_LABEL,
  displayName,
  humanise,
  ukDate,
} from '@/lib/format';
import { ENGLAND_REGION_LABELS } from '@/types/domain';

export const revalidate = 3600;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await companyDetail((await params).id);
  if (!c) return { title: 'Employer not found' };
  return {
    title: displayName(c.name),
    description: c.summary ?? `T Level placement information for ${displayName(c.name)}.`,
  };
}

const FIELD_LABEL: Record<string, string> = {
  company: 'Company details',
  companies_house: 'Companies House record',
  summary: 'Summary',
  size_band: 'Size',
  specialisms: 'Specialisms',
  takes_tlevel: 'T Level history',
  routes_onward: 'Routes onward',
  placement_patterns: 'Placement pattern',
  accepts_under_18: 'Age 16 to 18',
  early_careers_programme: 'Early-careers programme',
  trade_bodies: 'Trade bodies',
  how_to_apply: 'How to apply',
  sites: 'Sites',
  vacancies: 'Apprenticeship adverts',
  website: 'Website',
  contacts: 'Contact details',
};

export default async function CompanyPage({ params }: Props) {
  const c = await companyDetail((await params).id);
  if (!c) notFound();
  const specNames = await specialismNames();
  const name = displayName(c.name);
  const nameMatchSite = c.contacts.find((k) => k.kind === 'website' && k.confidence === 'name_match')?.value ?? null;
  const sourcesByField = new Map<string, CompanySource[]>();
  for (const x of c.sources) sourcesByField.set(x.field, [...(sourcesByField.get(x.field) ?? []), x]);

  return (
    <article className="grid gap-6">
      <header className="grid gap-2">
        <p className="text-sm"><Link href="/search" className="text-brand-700 underline">Back to search</Link></p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="display text-3xl sm:text-4xl">{name}</h1>
          <SaveButton companyId={c.id} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <SourceBadge source={c.data_source} verifiedAt={c.verified_at} />
          {c.engineering_tier === 'adjacent' ? <AdjacentBadge /> : null}
          {c.size_band !== 'unknown' ? <span>{SIZE_LABEL[c.size_band]}</span> : null}
          {c.ch_number ? <span>Company number {c.ch_number}</span> : null}
          {c.website ? (
            <a href={c.website} rel="noopener noreferrer nofollow" target="_blank" className="text-brand-700 underline">
              Website
            </a>
          ) : nameMatchSite ? (
            <a href={nameMatchSite} rel="noopener noreferrer nofollow" target="_blank" className="text-brand-700 underline">
              Website (not confirmed)
            </a>
          ) : null}
        </div>
        {c.summary ? <p className="max-w-3xl text-slate-800">{c.summary}</p> : null}
        {c.colleges.length ? (
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Colleges it works with">
            {c.colleges.map((l) => (
              <li key={`${l.college_id}-${l.kind}`} className="bg-cobalt px-2 py-0.5 font-medium text-white">
                {l.label}{' '}
                <a className="text-white underline" href={l.source_url} rel="noopener noreferrer nofollow" target="_blank">
                  source
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {c.engineering_tier === 'adjacent' ? (
          <p className="max-w-3xl border-l-4 border-ink bg-white p-3 text-sm">
            This isn’t an engineering company, but organisations like it often have their own engineering or
            maintenance teams. Before you apply, ask what work an Engineering T Level student would do there and
            whether it fits your specialism.
          </p>
        ) : null}
        {c.data_source === 'imported' ? (
          <p className="max-w-3xl border-2 border-ink bg-white p-3 text-sm text-slate-700">
            This employer comes from public records. Nobody has checked yet whether it takes T Level students, so ask
            before you count on it.
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="T Levels">
          <Facts>
            <Fact label="Has taken T Level students">
              {c.takes_tlevel === 'yes' ? (
                <>
                  Yes
                  {c.tlevel_evidence_url ? (
                    <> (<a className="text-brand-700 underline" href={c.tlevel_evidence_url} rel="noopener noreferrer nofollow" target="_blank">evidence</a>)</>
                  ) : null}
                </>
              ) : c.takes_tlevel === 'no' ? 'No' : 'Unknown'}
            </Fact>
            <Fact label="Fits these specialisms">
              {c.specialisms.length ? c.specialisms.map((s) => specNames.get(s) ?? humanise(s)).join(', ') : 'Unknown'}
            </Fact>
            <Fact label="Placement pattern">
              {c.placement_patterns.length ? c.placement_patterns.map(humanise).join(', ') : 'Unknown'}
            </Fact>
            <Fact label="Takes students aged 16 to 18">
              {c.accepts_under_18 === 'yes' ? 'Yes' : c.accepts_under_18 === 'no' ? 'No' : 'Unknown'}
            </Fact>
          </Facts>
        </Section>

        <Section title="After the placement">
          <Facts>
            <Fact label="Routes onward">
              {c.routes_onward.length ? c.routes_onward.map((r) => ROUTE_ONWARD_LABEL[r]).join(', ') : 'Unknown'}
            </Fact>
            <Fact label="Early-careers programme">{c.early_careers_programme ? 'Yes' : 'Not known'}</Fact>
          </Facts>
          {c.how_to_apply ? (
            <div className="mt-3">
              <h3 className="text-sm font-medium">How to apply</h3>
              <p className="text-sm text-slate-800">{c.how_to_apply}</p>
            </div>
          ) : null}
        </Section>
      </div>

      <Contacts c={c} />

      {c.vacancies.length ? (
        <Section title={`Live apprenticeship adverts (${c.vacancies.length})`}>
          <ul className="grid gap-2 text-sm">
            {c.vacancies.map((v, i) => (
              <li key={`${v.url}-${i}`} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-2">
                <span>
                  {v.url ? (
                    <a className="text-brand-700 underline" href={v.url} rel="noopener noreferrer" target="_blank">{v.title}</a>
                  ) : v.title}
                  {v.level ? <span className="text-slate-500"> · {v.level}</span> : null}
                  {v.postcode ? <span className="text-slate-500"> · {v.postcode}</span> : null}
                </span>
                {v.closing_date ? <span className="text-slate-600">Closes {ukDate(v.closing_date)}</span> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">From Find an apprenticeship (gov.uk).</p>
        </Section>
      ) : null}

      {c.sites.length ? (
        <Section title="Where they are">
          <ul className="grid gap-1 text-sm">
            {c.sites.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.label ?? SITE_KIND_LABEL[s.kind]}</span>
                {s.postcode ? ` · ${s.postcode}` : ''}
                {s.region ? ` · ${ENGLAND_REGION_LABELS[s.region]}` : ''}
                {s.label && s.kind === 'registered_office' ? (
                  <span className="text-slate-500"> (registered office, may not be where people work)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Where this information comes from">
        {c.sources.length ? (
          <ul className="grid gap-2 text-sm">
            {[...sourcesByField.entries()].map(([field, list]) => (
              <li key={field}>
                <span className="font-medium">{FIELD_LABEL[field] ?? humanise(field)}:</span>{' '}
                {list.map((x, i) => (
                  <span key={x.url}>
                    {i > 0 ? ', ' : ''}
                    <a className="break-all text-brand-700 underline" href={x.url} rel="noopener noreferrer nofollow" target="_blank">
                      {new URL(x.url).hostname.replace(/^www\./, '')}
                    </a>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">No sources recorded.</p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {c.verified_at ? `Last checked ${ukDate(c.verified_at)}. ` : ''}Spotted something wrong? Reporting is coming in a later update.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-2 border-ink bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-2 text-sm">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] gap-2">
      <dt className="text-slate-600">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const PURPOSE_PAGE: Record<CompanyContact['purpose'], string> = {
  general: 'Careers page',
  careers: 'Careers page',
  early_careers: 'Early careers page',
  apprenticeships: 'Apprenticeships page',
  placements: 'Placements and work experience page',
  hr: 'Careers page',
};

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Provenance({ k }: { k: CompanyContact }) {
  return (
    <span className="text-xs text-slate-500">
      {k.confidence === 'name_match' ? (
        <strong className="font-semibold text-ink">Not confirmed: website found by company name only · </strong>
      ) : null}
      {k.verified_at ? `Checked ${ukDate(k.verified_at)} · ` : 'Found automatically · '}
      <a className="underline" href={k.source_url} rel="noopener noreferrer nofollow" target="_blank">
        {host(k.source_url)}
      </a>
      {k.verified_at ? '' : `, ${ukDate(k.last_seen_at)}`}
    </span>
  );
}

// Organisation contacts only (no named people), and the student sends any
// message themselves: the app never contacts employers.
function Contacts({ c }: { c: CompanyDetail }) {
  const apply = c.contacts.filter((k) => k.kind === 'apply_page' || k.kind === 'careers_page');
  const reach = c.contacts.filter((k) => ['email', 'phone', 'contact_form', 'contact_page', 'linkedin'].includes(k.kind));
  const hasForm = reach.some((k) => k.kind === 'contact_form');
  const chUrl = c.ch_number ? `https://find-and-update.company-information.service.gov.uk/company/${c.ch_number}` : null;

  return (
    <Section title="How to get in touch">
      {apply.length || reach.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {apply.length ? (
            <div className="grid content-start gap-2">
              <h3 className="text-sm font-medium">Careers and applying</h3>
              <ul className="grid gap-2 text-sm">
                {apply.map((k) => (
                  <li key={k.value} className="grid">
                    <a className="text-brand-700 underline" href={k.value} rel="noopener noreferrer nofollow" target="_blank">
                      {k.kind === 'apply_page' ? 'Apply online' : PURPOSE_PAGE[k.purpose]}
                    </a>
                    <Provenance k={k} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {reach.length ? (
            <div className="grid content-start gap-2">
              <h3 className="text-sm font-medium">Contact the company</h3>
              <ul className="grid gap-2 text-sm">
                {reach
                  .filter((k) => !(k.kind === 'contact_page' && hasForm))
                  .map((k) => (
                    <li key={`${k.kind}-${k.value}`} className="grid">
                      {k.kind === 'email' ? (
                        <a className="break-all text-brand-700 underline" href={`mailto:${k.value}`}>{k.value}</a>
                      ) : k.kind === 'phone' ? (
                        <a className="text-brand-700 underline" href={`tel:${k.value.replace(/\s+/g, '')}`}>{k.value}</a>
                      ) : (
                        <a className="text-brand-700 underline" href={k.value} rel="noopener noreferrer nofollow" target="_blank">
                          {k.kind === 'contact_form' ? 'Contact form' : k.kind === 'linkedin' ? 'LinkedIn page' : 'Contact page'}
                        </a>
                      )}
                      <Provenance k={k} />
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-700">
          We haven&apos;t found a phone number, email or contact form for this employer yet. These will still reach them:
        </p>
      )}
      <OtherWays c={c} chUrl={chUrl} />
      <p className="mt-3 text-xs text-slate-500">
        These are the company&apos;s general contacts, not named people. You send any message yourself; we never contact
        employers for you.
        {c.colleges.length ? ' Working with one college doesn\'t mean they only take students from there, so it\'s still worth asking.' : ''}
      </p>
    </Section>
  );
}

// Always available, for every company: its registered office (a legal
// requirement, shown on Companies House) and searches the student can run
// themselves. These are links, not data we store or vouch for. The full
// address isn't printed here: for small firms it is often a director's home,
// so we point to the official record instead.
function OtherWays({ c, chUrl }: { c: CompanyDetail; chUrl: string | null }) {
  const name = displayName(c.name).replace(/\s+(limited|ltd\.?|plc|llp)$/i, '');
  const region = c.sites.find((s) => s.region)?.region;
  const place = c.sites.find((s) => s.county)?.county ?? (region ? ENGLAND_REGION_LABELS[region] : '');
  const linkedIn = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(name)}`;
  const web = `https://www.google.com/search?q=${encodeURIComponent(`"${name}" ${place} contact`.trim())}`;
  return (
    <div className="mt-4 grid gap-2">
      <h3 className="text-sm font-medium">Other ways to reach them</h3>
      <ul className="grid gap-2 text-sm">
        {chUrl ? (
          <li className="grid">
            <a className="text-brand-700 underline" href={chUrl} rel="noopener noreferrer nofollow" target="_blank">
              Registered office address (Companies House)
            </a>
            <span className="text-xs text-slate-500">Every company must accept post here. Write a letter or use it to find their website.</span>
          </li>
        ) : null}
        {c.contacts.some((k) => k.kind === 'linkedin') ? null : (
          <li className="grid">
            <a className="text-brand-700 underline" href={linkedIn} rel="noopener noreferrer nofollow" target="_blank">
              Find them on LinkedIn
            </a>
            <span className="text-xs text-slate-500">A search, not a checked page. Message the company page or apply through its jobs tab.</span>
          </li>
        )}
        <li className="grid">
          <a className="text-brand-700 underline" href={web} rel="noopener noreferrer nofollow" target="_blank">
            Search the web for their contact details
          </a>
          <span className="text-xs text-slate-500">Check the result is the same company: the company number{c.ch_number ? ` (${c.ch_number})` : ''} should be on their website.</span>
        </li>
      </ul>
    </div>
  );
}

