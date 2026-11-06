// Apprenticeship vacancies import (Phase 0).
//
// Fetches every live "Engineering and manufacturing" advert from Find an
// apprenticeship (Display Advert API v2), resolves each employer to a company,
// and merges the adverts into public.vacancies. Employers we don't hold are
// looked up by exact (normalised) name in the full Companies House register;
// a single active match is added as an Imported company.
//
//   npm run import:vacancies                 full sync (removes withdrawn adverts)
//   npm run import:vacancies -- --dry-run    fetch + resolve, print, write nothing
//   npm run import:vacancies -- --no-ch-lookup   skip the register scan (faster)
//
// Needs FAA_API_KEY and DATABASE_URL (environment or .env). The register scan
// reads the Companies House snapshot in .data/ (downloads it if missing).
//
// Data: Find an apprenticeship, Department for Education. Companies House Free
// Company Data Product. Both Open Government Licence v3.0.

import { existsSync, readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { PostcodeGeocoder, normalisePostcode } from '../lib/postcodes.ts';
import { ACCOUNTS, csvRows, download, extractCsv } from '../companies-house/import.ts';
import type { EnglandRegion, SizeBand } from '../../src/types/domain.ts';

const API = 'https://api.apprenticeships.education.gov.uk/vacancies';
const ROUTE = 'Engineering and manufacturing';
const CACHE_DIR = '.data';

interface ApiAddress {
  postcode?: string;
  latitude?: number;
  longitude?: number;
}
interface ApiVacancy {
  vacancyReference: string;
  title: string;
  employerName: string;
  employerWebsiteUrl?: string;
  apprenticeshipLevel?: string;
  course?: { title?: string; level?: number; route?: string };
  vacancyUrl?: string;
  // Returned with IncludeDetails=true. Named employer contacts
  // (employerContactName/Email/Phone) are deliberately not read.
  description?: string;
  fullDescription?: string;
  trainingDescription?: string;
  additionalTrainingDescription?: string;
  outcomeDescription?: string;
  thingsToConsider?: string;
  wage?: { wageType?: string; wageAmount?: number; wageUnit?: string; wageAdditionalInformation?: string };
  hoursPerWeek?: number;
  expectedDuration?: string;
  providerName?: string;
  skills?: string[];
  qualifications?: { qualificationType?: string; subject?: string; grade?: string; weighting?: string }[];
  postedDate?: string;
  closingDate?: string;
  startDate?: string;
  addresses: ApiAddress[];
}
interface ApiPage {
  vacancies: ApiVacancy[];
  totalFiltered: number;
  totalPages: number;
}

interface ChCandidate {
  ch_number: string;
  name: string;
  sic_codes: string[];
  size_band: SizeBand;
  postcode: string | null;
  region?: EnglandRegion | null;
  county?: string | null;
  lat?: number;
  lon?: number;
}

/** Mirrors companies.name_normalised / import.normalise_name() in SQL. */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|llp|uk|the|group|co)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Advert details (migration 0024)
// ---------------------------------------------------------------------------

/** Plain text from the API's HTML fields. */
export function plainText(html: string | undefined | null): string {
  return (html ?? '')
    .replace(/<\s*(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const T_LEVEL = /\bT[\s-]?Levels?\b/i;

/** The sentence where the advert mentions T Levels, or null. */
export function tLevelMention(texts: (string | undefined | null)[]): string | null {
  for (const t of texts) {
    const text = plainText(t);
    const m = T_LEVEL.exec(text);
    if (!m) continue;
    // Sentence (or line) around the match.
    const before = text.slice(0, m.index);
    const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n'), before.lastIndexOf('? '), before.lastIndexOf('! ')) + 1;
    const rest = text.slice(m.index);
    const endRel = rest.search(/(\.\s|\n|\?\s|!\s|$)/);
    const sentence = text.slice(start, m.index + endRel + 1).trim();
    return sentence.length > 600 ? `${sentence.slice(0, 597)}...` : sentence;
  }
  return null;
}

/** "£24,000 a year", "£300.00 a week", "National Minimum Wage for apprentices", plus any note. */
export function wageText(w: ApiVacancy['wage']): string | null {
  if (!w) return null;
  const unit: Record<string, string> = { Weekly: 'a week', Monthly: 'a month', Annually: 'a year' };
  let main: string | null = null;
  if (w.wageType === 'ApprenticeshipMinimum') main = 'National Minimum Wage for apprentices';
  else if (w.wageType === 'NationalMinimum') main = 'National Minimum Wage';
  else if (w.wageType === 'CompetitiveSalary') main = 'Competitive salary';
  else if (w.wageAmount && w.wageAmount > 0) {
    const amount = w.wageAmount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: w.wageAmount % 1 ? 2 : 0 });
    main = `${amount} ${unit[w.wageUnit ?? ''] ?? 'a year'}`;
  }
  const extra = plainText(w.wageAdditionalInformation).replace(/\s+/g, ' ');
  const out = [main, extra && extra.length <= 150 ? extra : null].filter(Boolean).join('. ');
  return out ? out.slice(0, 300) : null;
}

export function advertDetails(a: ApiVacancy) {
  return {
    external_ref: a.vacancyReference,
    summary: plainText(a.description).slice(0, 1000) || null,
    wage_text: wageText(a.wage),
    hours_per_week: typeof a.hoursPerWeek === 'number' && a.hoursPerWeek > 0 && a.hoursPerWeek <= 60 ? a.hoursPerWeek : null,
    expected_duration: a.expectedDuration?.trim().slice(0, 100) || null,
    training_provider: a.providerName?.trim().slice(0, 200) || null,
    course_level: a.course?.level && a.course.level >= 2 && a.course.level <= 7 ? a.course.level : null,
    qualifications: (a.qualifications ?? []).slice(0, 12).map((q) => ({
      type: q.qualificationType?.slice(0, 80) ?? null,
      subject: q.subject?.slice(0, 120) ?? null,
      grade: q.grade?.slice(0, 80) ?? null,
      essential: q.weighting === 'Essential',
    })),
    skills: (a.skills ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 15),
    tlevel_mention: tLevelMention([
      a.description,
      a.fullDescription,
      ...(a.qualifications ?? []).map((q) => [q.qualificationType, q.subject, q.grade].filter(Boolean).join(' ')),
      a.thingsToConsider,
      a.trainingDescription,
      a.additionalTrainingDescription,
      a.outcomeDescription,
    ]),
  };
}

const isoDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

async function getPage(key: string, page: number, attempt = 1): Promise<ApiPage> {
  const url = `${API}/vacancy?Routes=${encodeURIComponent(ROUTE)}&PageSize=100&PageNumber=${page}&Sort=AgeDesc&IncludeDetails=true`;
  try {
    const res = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'X-Version': '2' },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`API key rejected (${res.status})`), { fatal: true });
    if (!res.ok) throw new Error(`Display Advert API ${res.status}`);
    return (await res.json()) as ApiPage;
  } catch (err) {
    if ((err as { fatal?: boolean }).fatal || attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return getPage(key, page, attempt + 1);
  }
}

async function fetchAll(key: string): Promise<ApiVacancy[]> {
  const out: ApiVacancy[] = [];
  const first = await getPage(key, 1);
  out.push(...first.vacancies);
  for (let p = 2; p <= first.totalPages; p++) {
    await new Promise((r) => setTimeout(r, 250)); // be gentle
    out.push(...(await getPage(key, p)).vacancies);
  }
  const unique = new Map(out.map((v) => [v.vacancyReference, v]));
  if (unique.size < first.totalFiltered) {
    console.warn(`expected ${first.totalFiltered} adverts, got ${unique.size} (list changed while paging?)`);
  }
  return [...unique.values()];
}

function latestSnapshot(): string | null {
  if (!existsSync(CACHE_DIR)) return null;
  const files = readdirSync(CACHE_DIR)
    .filter((f) => /^BasicCompanyDataAsOneFile-\d{4}-\d{2}-\d{2}\.(csv|zip)$/.test(f))
    .sort()
    .reverse();
  // Prefer an extracted CSV of the newest month.
  const newest = files[0]?.slice(0, -4);
  if (!newest) return null;
  return files.includes(`${newest}.csv`) ? `${CACHE_DIR}/${newest}.csv` : `${CACHE_DIR}/${newest}.zip`;
}

/** Active companies in the register whose normalised name is in `names`. */
async function lookupRegister(names: Set<string>): Promise<Map<string, ChCandidate[]>> {
  let snap = latestSnapshot();
  if (!snap) {
    const d = new Date();
    const name = `BasicCompanyDataAsOneFile-${new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10)}.zip`;
    snap = `${CACHE_DIR}/${name}`;
    await download(`https://download.companieshouse.gov.uk/${name}`, snap);
  }
  const csv = snap.endsWith('.zip') ? await extractCsv(snap) : snap;
  console.log(`scanning ${csv} for ${names.size} employer names`);
  const out = new Map<string, ChCandidate[]>();
  let read = 0;
  const beat = setInterval(() => console.log(`  still scanning: ${read.toLocaleString('en-GB')} rows`), 30_000);
  beat.unref();
  for await (const r of csvRows(csv)) {
    read++;
    if ((r['CompanyStatus'] ?? '').trim() !== 'Active') continue;
    const nn = normaliseName(r['CompanyName'] ?? '');
    if (!names.has(nn)) continue;
    const sics: string[] = [];
    for (const k of [1, 2, 3, 4]) {
      const m = (r[`SICCode.SicText_${k}`] ?? '').trim().match(/^(\d{4,5})\s*-/);
      if (m) sics.push(m[1]!);
    }
    const list = out.get(nn) ?? [];
    list.push({
      ch_number: (r['CompanyNumber'] ?? '').trim().toUpperCase(),
      name: (r['CompanyName'] ?? '').trim(),
      sic_codes: sics,
      size_band: ACCOUNTS[(r['Accounts.AccountCategory'] ?? '').trim()]?.band ?? 'unknown',
      postcode: normalisePostcode(r['RegAddress.PostCode']),
    });
    out.set(nn, list);
  }
  clearInterval(beat);
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'no-ch-lookup': { type: 'boolean', default: false },
    },
  });
  if ((!process.env.DATABASE_URL || !process.env.FAA_API_KEY) && existsSync('.env')) process.loadEnvFile('.env');
  const key = process.env.FAA_API_KEY;
  if (!key) throw new Error('FAA_API_KEY is not set (add it to .env)');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (add it to .env)');

  console.log(`fetching "${ROUTE}" adverts from Find an apprenticeship`);
  const adverts = await fetchAll(key);
  console.log(`${adverts.length} live adverts`);

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // Which employers do we already hold (by normalised name)? Domain and
    // name + postcode matching happen in the merge; this only decides whom
    // to look up in the register.
    const names = [...new Set(adverts.map((a) => a.employerName.trim()))];
    const held = await db.query<{ n: string; nn: string; held: boolean }>(
      `select n, import.normalise_name(n) as nn,
              exists (select 1 from public.companies c
                      where c.name_normalised = import.normalise_name(n) and c.status = 'active') as held
       from unnest($1::text[]) n`,
      [names],
    );
    // Look every employer up in the register: a name that is unique there is
    // the strongest match we have, even for companies we already hold.
    const lookup = new Set(held.rows.map((r) => r.nn).filter(Boolean));
    const heldCount = held.rows.filter((r) => r.held).length;
    console.log(`${names.length} employers (${heldCount} share a name with a company we hold)`);

    const candidates =
      values['no-ch-lookup'] || lookup.size === 0 ? new Map<string, ChCandidate[]>() : await lookupRegister(lookup);

    // Geocode advert and candidate postcodes.
    const geo = new PostcodeGeocoder(`${CACHE_DIR}/postcodes-cache.json`);
    const pcs = [
      ...adverts.flatMap((a) => a.addresses.map((x) => x.postcode ?? '')),
      ...[...candidates.values()].flat().map((c) => c.postcode ?? ''),
    ].filter(Boolean);
    const fixes = await geo.lookupMany(pcs);
    for (const c of [...candidates.values()].flat()) {
      const f = c.postcode ? fixes.get(c.postcode) : null;
      if (f) Object.assign(c, { region: f.region, county: f.county, lat: f.lat, lon: f.lon });
    }

    const nnByName = new Map(held.rows.map((r) => [r.n, r.nn]));
    const rows = adverts.map((a) => {
      const addr = a.addresses.find((x) => x.postcode) ?? a.addresses[0];
      const pc = normalisePostcode(addr?.postcode);
      const f = pc ? fixes.get(pc) : null;
      const nn = nnByName.get(a.employerName.trim()) ?? normaliseName(a.employerName);
      return {
        external_ref: a.vacancyReference,
        employer_name: a.employerName.trim(),
        employer_website: a.employerWebsiteUrl?.trim() || null,
        title: a.title.trim(),
        level: a.course?.level ? `${a.apprenticeshipLevel ?? ''} (level ${a.course.level})`.trim() : a.apprenticeshipLevel ?? null,
        course_title: a.course?.title ?? null,
        route: a.course?.route ?? null,
        url: a.vacancyUrl ?? null,
        posted_on: isoDate(a.postedDate),
        closing_date: isoDate(a.closingDate),
        start_on: isoDate(a.startDate),
        postcode: pc,
        region: f?.region ?? null,
        county: f?.county ?? null,
        lat: f?.lat ?? addr?.latitude ?? null,
        lon: f?.lon ?? addr?.longitude ?? null,
        ch_candidates: candidates.get(nn) ?? [],
      };
    });

    const single = new Set([...candidates].filter(([, v]) => v.length === 1).map(([k]) => k));
    const multi = [...candidates].filter(([, v]) => v.length > 1).length;
    console.log(`register lookup: ${single.size} employers with one active match, ${multi} ambiguous, ${lookup.size - candidates.size} not found`);

    if (values['dry-run']) {
      console.log('dry run: nothing written');
      return;
    }

    await db.query('begin');
    const run = await db.query<{ id: string }>(
      `insert into import.runs (source, file_name, is_full) values ('apprenticeship_vacancies', $1, true) returning id`,
      [`display-advert-api-v2 ${ROUTE} ${new Date().toISOString()}`],
    );
    const runId = run.rows[0]!.id;
    await db.query(
      `insert into import.faa_vacancies (run_id, external_ref, employer_name, employer_website, title, level,
         course_title, route, url, posted_on, closing_date, start_on, postcode, region, county, lat, lon, ch_candidates)
       select $1, x.external_ref, x.employer_name, x.employer_website, x.title, x.level, x.course_title, x.route,
              x.url, x.posted_on, x.closing_date, x.start_on, x.postcode, x.region, x.county, x.lat, x.lon,
              coalesce(x.ch_candidates, '[]')
       from jsonb_to_recordset($2::jsonb) as x(
         external_ref text, employer_name text, employer_website text, title text, level text,
         course_title text, route text, url text, posted_on date, closing_date date, start_on date,
         postcode text, region public.england_region, county text, lat float8, lon float8, ch_candidates jsonb)`,
      [runId, JSON.stringify(rows)],
    );
    const res = await db.query<{ stats: unknown }>('select import.merge_vacancies($1) as stats', [runId]);
    // Advert details and T Level mentions (0024), loaded by advert reference.
    const details = adverts.map(advertDetails);
    await db.query(
      `insert into import.faa_vacancy_details as d (external_ref, summary, wage_text, hours_per_week, expected_duration,
         training_provider, course_level, qualifications, skills, tlevel_mention, fetched_at)
       select x.external_ref, x.summary, x.wage_text, x.hours_per_week, x.expected_duration, x.training_provider,
              x.course_level, coalesce(x.qualifications, '[]'), coalesce(x.skills, '{}'), x.tlevel_mention, now()
       from jsonb_to_recordset($1::jsonb) as x(external_ref text, summary text, wage_text text, hours_per_week numeric,
         expected_duration text, training_provider text, course_level smallint, qualifications jsonb, skills text[],
         tlevel_mention text)
       on conflict (external_ref) do update set summary = excluded.summary, wage_text = excluded.wage_text,
         hours_per_week = excluded.hours_per_week, expected_duration = excluded.expected_duration,
         training_provider = excluded.training_provider, course_level = excluded.course_level,
         qualifications = excluded.qualifications, skills = excluded.skills,
         tlevel_mention = excluded.tlevel_mention, fetched_at = now()`,
      [JSON.stringify(details)],
    );
    const applied = await db.query<{ n: number }>('select import.apply_vacancy_details() as n');
    const mentions = details.filter((d) => d.tlevel_mention).length;
    console.log(`advert details: ${applied.rows[0]!.n} adverts updated, ${mentions} mention T Levels`);
    // The employer's own website from the advert, for the contact crawler
    // (scripts/contacts/crawl-contacts.ts) to start from.
    await db.query(
      `insert into import.website_candidates (company_id, url, origin)
       select distinct r.company_id,
              case when x.employer_website ~* '^https?://' then x.employer_website else 'https://' || x.employer_website end,
              'faa_vacancy'
       from import.vacancy_results r
       join jsonb_to_recordset($2::jsonb) as x(external_ref text, employer_website text) on x.external_ref = r.external_ref
       where r.run_id = $1 and r.company_id is not null
         and x.employer_website ~* '^(https?://)?[a-z0-9-]+(\\.[a-z0-9-]+)+(/[^ ]*)?$'
       on conflict do nothing`,
      [runId, JSON.stringify(rows.map((r) => ({ external_ref: r.external_ref, employer_website: r.employer_website })))],
    );
    const unmatched = await db.query<{ employer_name: string; n: number; message: string }>(
      `select employer_name, count(*)::int as n, min(message) as message
       from import.vacancy_results where run_id = $1 and action = 'unmatched'
       group by 1 order by 2 desc, 1`,
      [runId],
    );
    await db.query('commit');
    // Map and region counts read precomputed views (migration 0013).
    await db.query('select public.refresh_read_models()');
    console.log('refreshed map and region caches');
    console.log('merged', res.rows[0]!.stats);
    if (unmatched.rows.length) {
      console.log('unmatched employers (not added):');
      for (const u of unmatched.rows) console.log(`  ${u.employer_name} (${u.n}): ${u.message}`);
    }
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

if (/import-vacancies\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
