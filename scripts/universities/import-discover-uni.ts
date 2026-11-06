// Universities and engineering-related courses from the Discover Uni dataset
// (HESA / Office for Students, CC BY 4.0), plus DfE's list of providers that
// consider T Levels for entry (gov.uk, Open Government Licence).
//
//   npm run unis:import                         uses .data/discoveruni/DiscoverUni_latest.zip
//   npm run unis:import -- --zip path/to/file.zip
//   npm run unis:import -- --dry-run            parse and count, write nothing
//
// HESA blocks automated downloads, so the zip is downloaded by hand from
// https://www.hesa.ac.uk/kisdata (the dataset updates weekly; re-import a few
// times a year). Course pages are then checked for T Level wording with
// npm run unis:assess. Re-importing keeps every T Level assessment.
//
// Courses kept: undergraduate courses with a subject code in engineering and
// technology (CAH10), computing (CAH11-01), physics and astronomy (CAH07-01),
// mathematics (CAH09-01) or architecture, building and planning (CAH13-01).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { csvRows } from '../companies-house/import.ts';

const DATASET_URL = 'https://www.hesa.ac.uk/kisdata';
const DFE_LIST_URL =
  'https://www.gov.uk/government/publications/higher-education-providers-with-t-levels-in-entry-requirements/list-of-higher-education-providers-that-accept-t-levels-for-entry';

export type SubjectGroup = 'engineering' | 'computing' | 'physics' | 'maths' | 'built_environment';

/** Subject group for a course's CAH codes, or null if none is in scope. */
export function subjectGroup(cah: string[]): SubjectGroup | null {
  const has = (prefix: string) => cah.some((c) => c.startsWith(prefix));
  if (has('CAH10')) return 'engineering';
  if (has('CAH11-01')) return 'computing';
  if (has('CAH07-01')) return 'physics';
  if (has('CAH09-01')) return 'maths';
  if (has('CAH13-01')) return 'built_environment';
  return null;
}

const NATION: Record<string, string> = { XF: 'england', XG: 'northern_ireland', XH: 'scotland', XI: 'wales' };

const SMALL = new Set(['of', 'and', 'the', 'at', 'for', 'in', 'on']);

/** Readable provider name: the first that isn't all capitals, else title-cased; ", The" dropped. */
export function displayUniName(candidates: (string | undefined)[]): string {
  const names = candidates.map((n) => n?.trim()).filter((n): n is string => !!n);
  const mixed = names.find((n) => n !== n.toUpperCase());
  let n = mixed ?? names[0] ?? '';
  if (!mixed)
    n = n
      .toLowerCase()
      .split(' ')
      .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[-'(])([a-z])/g, (_, a, b) => a + b.toUpperCase())))
      .join(' ');
  return n
    .replace(/\s*\(part of [^)]*\)/i, '')
    .replace(/\s+higher education corporation$/i, '')
    .replace(/,\s*the$/i, '')
    .replace(/^the\s+/i, '')
    .trim();
}

/** Comparable form of a provider name. */
export function normaliseUniName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|ltd|limited|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['university', 'college', 'centre', 'center', 'of', 'the', 'at', 'and', 'in', 'group', 'institute', 'london', 'ucen', 'campus', 'school']);
const variants = (n: string) => {
  const b = normaliseUniName(n.replace(/[’']/g, ''));
  return [
    b,
    b.replace(/ university of london$/, ''),
    b.replace(/ university centre( .*)?$/, '').replace(/^university centre (at )?/, '').replace(/ group$/, ''),
  ];
};

/**
 * Match a DfE list name to one provider: exact (after normalising and
 * dropping "University Centre", ", University of London", "Group"), else the
 * single provider whose names contain all the DfE name's distinctive words
 * ("Northumbria University" -> "University of Northumbria at Newcastle").
 * Null when nothing or more than one provider fits.
 */
// DfE list names whose provider is registered under a group or older name.
const DFE_ALIASES: Record<string, string> = {
  'City, University of London': "City St George's, University of London",
  'University Centre Leeds, Leeds City College': 'Luminate Education Group',
  'University Centre Rotherham': 'RNN Group',
  'University Centre Colchester at Colchester Institute': 'Colchester Institute',
  'University Centre at Salford City College': 'Salford City College',
  'University Centre West Anglia': 'College of West Anglia',
};

export function matchProvider(dfeName: string, providers: { ukprn: string; names: string[] }[]): string | null {
  const want = new Set([...variants(dfeName), ...(DFE_ALIASES[dfeName] ? variants(DFE_ALIASES[dfeName]) : [])]);
  for (const p of providers) if (p.names.some((n) => variants(n).some((v) => want.has(v)))) return p.ukprn;
  const words = normaliseUniName(dfeName.replace(/[’']/g, '')).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return null;
  const hits = providers.filter((p) =>
    p.names.some((n) => {
      const have = new Set(normaliseUniName(n.replace(/[’']/g, '')).split(' '));
      return words.every((w) => have.has(w));
    }),
  );
  return hits.length === 1 ? hits[0]!.ukprn : null;
}

/** Provider names on DfE's T Level list (the page's bulleted list). */
export function parseDfeList(html: string): string[] {
  const body = html.slice(Math.max(0, html.indexOf('govspeak')));
  const names: string[] = [];
  for (const m of body.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const t = m[1]!
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length >= 3 && t.length <= 150) names.push(t);
  }
  return [...new Set(names)];
}

const pct = (v: string | undefined) => {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};
const url = (v: string | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return null;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(u) && u.length <= 2048 ? u : null;
};

export function extract(zip: string): string {
  const dir = join(dirname(zip), 'extracted');
  const find = () => {
    if (!existsSync(dir)) return null;
    for (const d of readdirSync(dir)) if (existsSync(join(dir, d, 'KISCOURSE.csv'))) return join(dir, d);
    return existsSync(join(dir, 'KISCOURSE.csv')) ? dir : null;
  };
  const found = find();
  if (found) return found;
  mkdirSync(dir, { recursive: true });
  const r =
    process.platform === 'win32'
      ? spawnSync('tar', ['-xf', zip, '-C', dir], { stdio: 'inherit' })
      : spawnSync('unzip', ['-o', '-q', zip, '-d', dir], { stdio: 'inherit' });
  const out = find();
  if (r.status !== 0 || !out) throw new Error(`couldn't extract ${zip}`);
  return out;
}

export function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: {
      zip: { type: 'string', default: '.data/discoveruni/DiscoverUni_latest.zip' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!existsSync(values.zip!)) throw new Error(`${values.zip} not found: download it from ${DATASET_URL}`);
  const dir = extract(values.zip!);
  const csv = (n: string) => csvRows(join(dir, n));

  // Subjects first: decide which courses are in scope.
  const key = (r: Record<string, string>) => `${r.PUBUKPRN}|${r.KISCOURSEID}|${r.KISMODE}`;
  const cah = new Map<string, string[]>();
  for await (const r of csv('SBJ.csv')) (cah.get(key(r)) ?? cah.set(key(r), []).get(key(r))!).push(r.SBJ!);

  const aims = new Map<string, string>();
  for await (const r of csv('KISAIM.csv')) aims.set(r.KISAIMCODE!, r.KISAIMLABEL!);

  interface Course {
    pubukprn: string; kis_course_id: string; kis_mode: number; title: string; qualification: string | null;
    subject_group: SubjectGroup; subject_codes: string[]; ucas_codes: string[]; course_url: string | null;
    foundation_year: boolean | null; sandwich_year: boolean | null; location_name: string | null;
    lat: number | null; lng: number | null; entry_alevel_pct: number | null; entry_other_pct: number | null;
  }
  const courses = new Map<string, Course>();
  const ukprnOf = new Map<string, string>(); // course key -> registering UKPRN (for locations)
  for await (const r of csv('KISCOURSE.csv')) {
    const codes = cah.get(key(r)) ?? [];
    const group = subjectGroup(codes);
    if (!group || !r.TITLE?.trim()) continue;
    const opt = (v?: string) => (v === '1' || v === '2' ? true : v === '0' ? false : null);
    const aim = aims.get(r.KISAIMCODE ?? '') ?? null;
    courses.set(key(r), {
      pubukprn: r.PUBUKPRN!, kis_course_id: r.KISCOURSEID!, kis_mode: Number.parseInt(r.KISMODE!, 10),
      title: r.TITLE.trim().slice(0, 300),
      qualification: aim ? `${aim}${r.HONOURS === '1' ? ' (Hons)' : ''}` : null,
      subject_group: group, subject_codes: [...new Set(codes)], ucas_codes: [], course_url: url(r.CRSEURL),
      foundation_year: opt(r.FOUNDATION), sandwich_year: opt(r.SANDWICH),
      location_name: null, lat: null, lng: null, entry_alevel_pct: null, entry_other_pct: null,
    });
    ukprnOf.set(key(r), r.UKPRN!);
  }

  const locations = new Map<string, { name: string; lat: number; lng: number }>();
  for await (const r of csv('LOCATION.csv')) {
    const lat = Number.parseFloat(r.LATITUDE!);
    const lng = Number.parseFloat(r.LONGITUDE!);
    if (Number.isFinite(lat) && Number.isFinite(lng)) locations.set(`${r.UKPRN}|${r.LOCID}`, { name: r.LOCNAME!.trim(), lat, lng });
  }
  for await (const r of csv('COURSELOCATION.csv')) {
    const c = courses.get(key(r));
    if (!c || c.lat !== null) continue;
    const loc = locations.get(`${r.UKPRN}|${r.LOCID}`) ?? locations.get(`${r.PUBUKPRN}|${r.LOCID}`);
    if (loc) Object.assign(c, { location_name: loc.name.slice(0, 200), lat: loc.lat, lng: loc.lng });
  }
  for await (const r of csv('UCASCOURSEID.csv')) {
    const c = courses.get(key(r));
    if (c && r.UCASCOURSEID && !c.ucas_codes.includes(r.UCASCOURSEID) && c.ucas_codes.length < 10) c.ucas_codes.push(r.UCASCOURSEID);
  }
  for await (const r of csv('ENTRY.csv')) {
    const c = courses.get(key(r));
    if (c) Object.assign(c, { entry_alevel_pct: pct(r.ALEVEL), entry_other_pct: pct(r.OTHER) });
  }

  // Providers that teach at least one course in scope.
  const needed = new Set([...courses.values()].map((c) => c.pubukprn));
  const unis = new Map<string, { ukprn: string; name: string; names: string[]; nation: string | null; website: string | null }>();
  for await (const r of csv('INSTITUTION.csv')) {
    if (!needed.has(r.PUBUKPRN!) || unis.has(r.PUBUKPRN!)) continue;
    const name = displayUniName([r.FIRST_TRADING_NAME, r.LEGAL_NAME]).slice(0, 200);
    unis.set(r.PUBUKPRN!, {
      ukprn: r.PUBUKPRN!, name,
      names: [r.LEGAL_NAME, r.FIRST_TRADING_NAME, ...(r.OTHER_NAMES ?? '').split(/###|[;|]/)].map((x) => x?.trim() ?? '').filter(Boolean),
      nation: NATION[r.PUBUKPRNCOUNTRY ?? r.COUNTRY ?? ''] ?? null,
      website: url(r.PROVURL),
    });
  }

  // DfE's T Level list, matched on any of the provider's names.
  const res = await fetch(DFE_LIST_URL);
  if (!res.ok) throw new Error(`DfE list: HTTP ${res.status}`);
  const dfe = parseDfeList(await res.text());
  const onList = new Set<string>();
  const unmatched: string[] = [];
  const providers = [...unis.values()];
  for (const n of dfe) {
    const hit = matchProvider(n, providers);
    if (hit) onList.add(hit);
    else unmatched.push(n);
  }

  const byGroup: Record<string, number> = {};
  for (const c of courses.values()) byGroup[c.subject_group] = (byGroup[c.subject_group] ?? 0) + 1;
  console.log(`${unis.size} providers, ${courses.size} courses in scope ${JSON.stringify(byGroup)}`);
  console.log(`DfE T Level list: ${dfe.length} names, ${onList.size} providers matched; not matched (no course in scope, or a name difference): ${unmatched.length}`);
  if (values['dry-run']) {
    console.log('  unmatched:', unmatched.join('; '));
    return;
  }

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('begin');
    const today = new Date().toISOString().slice(0, 10);
    await db.query(
      `insert into public.universities (ukprn, name, nation, website, on_dfe_tlevel_list, dfe_list_url, dfe_list_checked_on, source_url, fetched_at)
       select x.ukprn, x.name, x.nation::public.uk_nation, x.website, x.on_list, $2, $3::date, $4, now()
       from jsonb_to_recordset($1::jsonb) as x(ukprn text, name text, nation text, website text, on_list boolean)
       on conflict (ukprn) do update set name = excluded.name, nation = excluded.nation, website = excluded.website,
         on_dfe_tlevel_list = excluded.on_dfe_tlevel_list, dfe_list_url = excluded.dfe_list_url,
         dfe_list_checked_on = excluded.dfe_list_checked_on, fetched_at = now()`,
      [JSON.stringify([...unis.values()].map((u) => ({ ...u, on_list: onList.has(u.ukprn) }))), DFE_LIST_URL, today, DATASET_URL],
    );
    const list = [...courses.values()];
    for (let i = 0; i < list.length; i += 2000) {
      await db.query(
        `insert into public.uni_courses as c (university_id, kis_course_id, kis_mode, title, qualification, subject_group,
           subject_codes, ucas_codes, course_url, foundation_year, sandwich_year, location_name, location,
           entry_alevel_pct, entry_other_pct, source_url, fetched_at)
         select u.id, x.kis_course_id, x.kis_mode, x.title, x.qualification, x.subject_group::public.course_subject_group,
                x.subject_codes, x.ucas_codes, x.course_url, x.foundation_year, x.sandwich_year, x.location_name,
                case when x.lat is not null then extensions.st_setsrid(extensions.st_makepoint(x.lng, x.lat), 4326)::extensions.geography end,
                x.entry_alevel_pct, x.entry_other_pct, $2, now()
         from jsonb_to_recordset($1::jsonb) as x(pubukprn text, kis_course_id text, kis_mode smallint, title text,
           qualification text, subject_group text, subject_codes text[], ucas_codes text[], course_url text,
           foundation_year boolean, sandwich_year boolean, location_name text, lat float8, lng float8,
           entry_alevel_pct smallint, entry_other_pct smallint)
         join public.universities u on u.ukprn = x.pubukprn
         on conflict (university_id, kis_course_id, kis_mode) do update set
           title = excluded.title, qualification = excluded.qualification, subject_group = excluded.subject_group,
           subject_codes = excluded.subject_codes, ucas_codes = excluded.ucas_codes,
           -- a changed course page means the T Level reading is out of date
           tlevel_assessed_at = case when c.course_url is distinct from excluded.course_url then null else c.tlevel_assessed_at end,
           course_url = excluded.course_url, foundation_year = excluded.foundation_year,
           sandwich_year = excluded.sandwich_year, location_name = excluded.location_name, location = excluded.location,
           entry_alevel_pct = excluded.entry_alevel_pct, entry_other_pct = excluded.entry_other_pct, fetched_at = now()`,
        [JSON.stringify(list.slice(i, i + 2000)), DATASET_URL],
      );
    }
    // Courses gone from the dataset (guarded against a partial file).
    if (list.length > 3000) {
      const keep = list.map((c) => `${c.pubukprn}|${c.kis_course_id}|${c.kis_mode}`);
      const del = await db.query(
        `delete from public.uni_courses c using public.universities u
          where u.id = c.university_id and not (u.ukprn || '|' || c.kis_course_id || '|' || c.kis_mode = any ($1::text[]))`,
        [keep],
      );
      console.log(`removed ${del.rowCount} courses no longer in the dataset`);
    }
    await db.query('commit');
    console.log('saved');
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    await db.end();
  }
}

if (/import-discover-uni\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
