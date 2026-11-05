// Builds the colleges reference data: every provider on the DfE "T Levels
// provider list: 2026 to 2027 academic year", joined to Get Information About
// Schools (GIAS) for UKPRN, postcode and website, then geocoded.
//
// Output: supabase/migrations/20261103000005_colleges.sql (reference data goes
// in a migration so it reaches production, same as tlevel_routes).
//
//   npm run colleges:build
//
// Unmatched providers are still loaded (name, type, region) so students can
// pick them; they just have no UKPRN or location until an override is added
// in data/colleges-overrides.csv.

import { createReadStream, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parse } from 'csv-parse';
import ExcelJS from 'exceljs';
import { PostcodeGeocoder, normalisePostcode, regionFromOnsName } from '../lib/postcodes.ts';
import type { EnglandRegion } from '../../src/types/domain.ts';

const PROVIDER_LIST_PAGE = 'https://www.gov.uk/government/publications/providers-selected-to-deliver-t-levels';
const PROVIDER_LIST_XLSX =
  'https://assets.publishing.service.gov.uk/media/6978a76c128d9c1d09a98bea/T_Level_registered_providers_2026_to_2027_-_January_2026_version.xlsx';
const GIAS_PAGE = 'https://get-information-schools.service.gov.uk/Downloads';
const giasCsvUrl = (d: Date) =>
  `https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata${d
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '')}.csv`;

const CACHE_DIR = '.data';
const OUT = 'supabase/migrations/20261103000005_colleges.sql';
const OVERRIDES = 'data/colleges-overrides.csv';

interface Provider {
  name: string;
  type: string | null;
  region: EnglandRegion | null;
}

interface GiasRow {
  name: string;
  type: string;
  open: boolean;
  ukprn: number | null;
  postcode: string | null;
  website: string | null;
  region: EnglandRegion | null;
}

interface Override {
  provider_name: string;
  ukprn: number | null;
  postcode: string | null;
  source_url: string;
}

interface College extends Provider {
  ukprn: number | null;
  postcode: string | null;
  website: string | null;
  lat: number | null;
  lon: number | null;
  sources: string[];
  how: 'gias' | 'override' | 'unmatched';
}

// "Bridgwater & Taunton College" == "BRIDGWATER AND TAUNTON COLLEGE"
export function normaliseOrgName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`.,()\-/]/g, ' ')
    .replace(/\b(the|limited|ltd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// GIAS types that can deliver a T Level, most likely first (tie-break only).
const TYPE_PREFERENCE = [
  'Further education',
  'Sixth form centres',
  'University technical college',
  'Free schools 16 to 19',
  'Academy 16-19 converter',
  'Academy 16-19 sponsor led',
  'Studio schools',
];

async function download(url: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

async function readProviders(path: string): Promise<Provider[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('provider list has no sheet');
  const out: Provider[] = [];
  let headerSeen = false;
  ws.eachRow((row) => {
    const cells = (row.values as unknown[]).slice(1).map((v) => (v == null ? null : String(v).trim()));
    const [name, type, region] = cells;
    if (!headerSeen) {
      headerSeen = name === 'Provider Name';
      return;
    }
    if (!name || name === 'Total' || name === 'Provider Name') return;
    out.push({ name, type: type ?? null, region: regionFromOnsName(region) });
  });
  if (!headerSeen) throw new Error('provider list header row not found: has the layout changed?');
  return out;
}

async function readGias(path: string): Promise<Map<string, GiasRow[]>> {
  const byName = new Map<string, GiasRow[]>();
  const parser = createReadStream(path).pipe(
    parse({ columns: true, bom: true, encoding: 'latin1', relax_column_count: true }),
  );
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    const name = r['EstablishmentName'];
    if (!name) continue;
    const row: GiasRow = {
      name,
      type: r['TypeOfEstablishment (name)'] ?? '',
      open: (r['EstablishmentStatus (name)'] ?? '').startsWith('Open'),
      ukprn: r['UKPRN'] ? Number(r['UKPRN']) : null,
      postcode: normalisePostcode(r['Postcode']),
      website: cleanWebsite(r['SchoolWebsite']),
      region: regionFromOnsName(r['GOR (name)']),
    };
    const key = normaliseOrgName(name);
    const list = byName.get(key) ?? [];
    list.push(row);
    byName.set(key, list);
  }
  return byName;
}

function cleanWebsite(raw: string | undefined): string | null {
  if (!raw) return null;
  let w = raw.trim();
  if (!w) return null;
  if (!/^https?:\/\//i.test(w)) w = `https://${w.replace(/^\/\//, '')}`;
  try {
    return new URL(w).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'at']);
const KEEP_UPPER = new Set(['UTC', 'NCG', 'LTD', 'UK', 'CofE', 'BCoT', 'MIT']);

/** "ABINGDON AND WITNEY COLLEGE" -> "Abingdon and Witney College". Only for names GIAS can't supply. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s; // already mixed case: trust it
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i) => {
      if (KEEP_UPPER.has(w.toUpperCase())) return w.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      return w.replace(/^(\w)|(?<=[.'’])(\w)/g, (c) => c.toUpperCase());
    })
    .join('');
}

function readOverrides(): Map<string, Override> {
  const out = new Map<string, Override>();
  if (!existsSync(OVERRIDES)) return out;
  const lines = readFileSync(OVERRIDES, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const header = lines.shift()?.split(',');
  if (header?.join(',') !== 'provider_name,ukprn,postcode,source_url') {
    throw new Error(`${OVERRIDES}: expected header provider_name,ukprn,postcode,source_url`);
  }
  for (const line of lines) {
    const [provider_name, ukprn, postcode, source_url] = line.split(',').map((s) => s.trim());
    if (!provider_name || !source_url) throw new Error(`${OVERRIDES}: bad line "${line}"`);
    out.set(normaliseOrgName(provider_name), {
      provider_name,
      ukprn: ukprn ? Number(ukprn) : null,
      postcode: normalisePostcode(postcode),
      source_url,
    });
  }
  return out;
}

function pickGias(candidates: GiasRow[], p: Provider): GiasRow | null {
  const open = candidates.filter((c) => c.open && c.ukprn);
  if (open.length <= 1) return open[0] ?? null;
  const inRegion = open.filter((c) => c.region === p.region);
  const pool = inRegion.length ? inRegion : open;
  const rank = (c: GiasRow) => {
    const i = TYPE_PREFERENCE.indexOf(c.type);
    return i === -1 ? TYPE_PREFERENCE.length : i;
  };
  pool.sort((a, b) => rank(a) - rank(b));
  // Still ambiguous (same name, same region, same type): don't guess.
  if (pool.length > 1 && rank(pool[0]!) === rank(pool[1]!)) return null;
  return pool[0] ?? null;
}

const sqlStr = (v: string | null) => (v == null ? 'null' : `'${v.replace(/'/g, "''")}'`);
const sqlArr = (v: string[]) => `array[${v.map(sqlStr).join(', ')}]::text[]`;

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const today = new Date();
  const providersPath = `${CACHE_DIR}/tlevel-providers-2026-27.xlsx`;
  const giasPath = `${CACHE_DIR}/gias-${today.toISOString().slice(0, 10)}.csv`;
  await download(PROVIDER_LIST_XLSX, providersPath);
  await download(giasCsvUrl(today), giasPath);

  const providers = await readProviders(providersPath);
  const gias = await readGias(giasPath);
  const overrides = readOverrides();

  const colleges: College[] = providers.map((p) => {
    const key = normaliseOrgName(p.name);
    const o = overrides.get(key);
    if (o) {
      const g = o.ukprn
        ? [...gias.values()].flat().find((r) => r.ukprn === o.ukprn && r.open)
        : undefined;
      return {
        ...p,
        name: titleCase(p.name),
        ukprn: o.ukprn,
        postcode: o.postcode ?? g?.postcode ?? null,
        website: g?.website ?? null,
        lat: null,
        lon: null,
        sources: [PROVIDER_LIST_PAGE, o.source_url],
        how: 'override',
      };
    }
    const g = pickGias(gias.get(key) ?? [], p);
    return {
      ...p,
      // GIAS has the proper casing ("Bedford College"); the DfE list is in capitals.
      name: g ? g.name : titleCase(p.name),
      ukprn: g?.ukprn ?? null,
      postcode: g?.postcode ?? null,
      website: g?.website ?? null,
      lat: null,
      lon: null,
      sources: g ? [PROVIDER_LIST_PAGE, GIAS_PAGE] : [PROVIDER_LIST_PAGE],
      how: g ? 'gias' : 'unmatched',
    };
  });

  // Two providers resolving to one UKPRN would break the unique constraint
  // and means a bad match: drop the UKPRN from both and report it.
  const seen = new Map<number, College[]>();
  for (const c of colleges) if (c.ukprn) seen.set(c.ukprn, [...(seen.get(c.ukprn) ?? []), c]);
  for (const [ukprn, list] of seen) {
    if (list.length > 1) {
      console.warn(`UKPRN ${ukprn} matched ${list.map((c) => c.name).join(' / ')}; leaving unmatched`);
      for (const c of list) Object.assign(c, { ukprn: null, postcode: null, website: null, how: 'unmatched' });
    }
  }

  const geo = new PostcodeGeocoder(`${CACHE_DIR}/postcodes-cache.json`);
  const fixes = await geo.lookupMany(colleges.flatMap((c) => (c.postcode ? [c.postcode] : [])));
  for (const c of colleges) {
    const f = c.postcode ? fixes.get(c.postcode) : null;
    if (f) {
      c.lat = f.lat;
      c.lon = f.lon;
      c.region ??= f.region;
    }
  }

  colleges.sort((a, b) => a.name.localeCompare(b.name));
  const rows = colleges.map(
    (c) =>
      `  (${sqlStr(c.name)}, ${c.ukprn ?? 'null'}, ${sqlStr(c.type)}, ${sqlStr(c.postcode)}, ` +
      `${c.region ? `'${c.region}'` : 'null'}, ` +
      `${c.lat != null ? `extensions.st_setsrid(extensions.st_makepoint(${c.lon}, ${c.lat}), 4326)::extensions.geography` : 'null'}, ` +
      `${sqlStr(c.website)}, ${sqlArr(c.sources)})`,
  );

  const counts = {
    total: colleges.length,
    gias: colleges.filter((c) => c.how === 'gias').length,
    override: colleges.filter((c) => c.how === 'override').length,
    unmatched: colleges.filter((c) => c.how === 'unmatched').length,
    located: colleges.filter((c) => c.lat != null).length,
  };

  const sql = `-- T Level Placement Finder: colleges (T Level providers), Phase 0.
-- GENERATED by scripts/colleges/build-colleges.ts on ${today.toISOString().slice(0, 10)}. Do not edit by hand:
-- fix data/colleges-overrides.csv and re-run \`npm run colleges:build\`.
--
-- Source: DfE "T Levels provider list: 2026 to 2027 academic year" (January 2026),
-- ${PROVIDER_LIST_PAGE}
-- DfE says it will not update this list again (funding changes from 2027/28).
-- UKPRN, postcode and website from Get Information About Schools; locations from
-- postcodes.io (ONS Postcode Directory). Contains public sector information
-- licensed under the Open Government Licence v3.0.
--
-- ${counts.total} providers: ${counts.gias} matched to GIAS, ${counts.override} by override, ${counts.unmatched} unmatched (name and region only).
-- ${counts.located} have a location.

alter table public.colleges
  add column provider_type text,
  add column website text check (website ~* '^https?://'),
  add column source_urls text[] not null default '{}',
  add column updated_at timestamptz not null default now();

create unique index colleges_name_key on public.colleges (lower(name));
create trigger colleges_updated_at before update on public.colleges
  for each row execute function public.set_updated_at();

insert into public.colleges (name, ukprn, provider_type, postcode, region, location, website, source_urls)
values
${rows.join(',\n')}
on conflict (lower(name)) do update set
  ukprn = excluded.ukprn,
  provider_type = excluded.provider_type,
  postcode = excluded.postcode,
  region = excluded.region,
  location = excluded.location,
  website = excluded.website,
  source_urls = excluded.source_urls;
`;
  writeFileSync(OUT, sql);
  console.log(`wrote ${OUT}`, counts);
  for (const c of colleges.filter((c) => c.how === 'unmatched')) console.log(`  unmatched: ${c.name} (${c.type}, ${c.region})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
