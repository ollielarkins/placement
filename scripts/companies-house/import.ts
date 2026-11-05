// Companies House import (Phase 0).
//
// Streams the monthly Free Company Data Product, keeps engineering companies
// registered in England, geocodes them and merges them into public.companies.
//
//   DATABASE_URL=postgres://... npm run import:ch -- [--file path.zip] [--date 2026-11-01] [--dry-run]
//
// DATABASE_URL must be the direct (or session pooler) connection for the
// postgres role: the merge writes to the private import schema. Never run this
// with a key that ships to the browser.
//
// Data: Companies House Free Company Data Product, Open Government Licence v3.0.
// https://download.companieshouse.gov.uk/en_output.html

import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse';
import yauzl from 'yauzl';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { PostcodeGeocoder, normalisePostcode } from '../lib/postcodes.ts';
import type { EnglandRegion, SizeBand } from '../../src/types/domain.ts';

const CACHE_DIR = '.data';
const SIC_FILE = 'data/sic-codes.csv';

// ---------------------------------------------------------------------------
// SIC filter
// ---------------------------------------------------------------------------
// 'medium' is for engineering-adjacent sectors (data/sic-codes.csv, second
// block): only firms big enough to have their own engineering team.
type MinAccounts = 'any' | 'small' | 'medium';
interface SicRule {
  prefix: string;
  title: string;
  sector: string;
  minAccounts: MinAccounts;
}

export function loadSicRules(path = SIC_FILE): SicRule[] {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  if (header !== 'sic_prefix,title,sector,min_accounts') throw new Error(`${path}: unexpected header`);
  return lines
    .map((l) => {
      const [prefix, title, sector, min] = l.split(',').map((s) => s.trim());
      if (!prefix || !/^\d{2,5}$/.test(prefix) || !title || !sector || !['any', 'small', 'medium'].includes(min ?? '')) {
        throw new Error(`${path}: bad line "${l}"`);
      }
      return { prefix, title, sector, minAccounts: min as MinAccounts };
    })
    .sort((a, b) => b.prefix.length - a.prefix.length); // longest prefix first
}

export function ruleFor(sic: string, rules: SicRule[]): SicRule | undefined {
  return rules.find((r) => sic.startsWith(r.prefix));
}

// ---------------------------------------------------------------------------
// Accounts category -> size band. Companies House doesn't publish headcount,
// so the accounts regime a company files under is the best free proxy.
// FULL and GROUP mean "not small": medium or large. We record medium rather
// than overclaim; curation sets 'large' for companies that really are.
// ---------------------------------------------------------------------------
export const ACCOUNTS: Record<string, { band: SizeBand; atLeastSmall: boolean; atLeastMedium?: true; dormant?: true }> = {
  'DORMANT': { band: 'micro', atLeastSmall: false, dormant: true },
  'MICRO ENTITY': { band: 'micro', atLeastSmall: false },
  'NO ACCOUNTS FILED': { band: 'unknown', atLeastSmall: false },
  'ACCOUNTS TYPE NOT AVAILABLE': { band: 'unknown', atLeastSmall: false },
  'TOTAL EXEMPTION FULL': { band: 'small', atLeastSmall: true },
  'TOTAL EXEMPTION SMALL': { band: 'small', atLeastSmall: true },
  'UNAUDITED ABRIDGED': { band: 'small', atLeastSmall: true },
  'AUDITED ABRIDGED': { band: 'small', atLeastSmall: true },
  'SMALL': { band: 'small', atLeastSmall: true },
  'MEDIUM': { band: 'medium', atLeastSmall: true, atLeastMedium: true },
  'FULL': { band: 'medium', atLeastSmall: true, atLeastMedium: true },
  'GROUP': { band: 'medium', atLeastSmall: true, atLeastMedium: true },
  'AUDIT EXEMPTION SUBSIDIARY': { band: 'unknown', atLeastSmall: true },
  'FILING EXEMPTION SUBSIDIARY': { band: 'unknown', atLeastSmall: true },
};

// ---------------------------------------------------------------------------
// Row handling
// ---------------------------------------------------------------------------
export interface StagedCompany {
  ch_number: string;
  name: string;
  ch_status: string;
  in_scope: boolean;
  sic_codes: string[];
  sectors: string[];
  keywords: string[];
  size_band: SizeBand;
  incorporated_on: string | null; // ISO date
  postcode: string | null;
  town: string | null;
  region: EnglandRegion | null;
  county: string | null;
  lat: number | null;
  lon: number | null;
}

type Candidate = Omit<StagedCompany, 'region' | 'county' | 'lat' | 'lon'> & { countryHint: string };

const NON_ENGLAND = new Set(['SCOTLAND', 'WALES', 'NORTHERN IRELAND', 'CYMRU']);

function ukDate(d: string | undefined): string | null {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Pre-geocoding filter. Returns null for rows we never need. in_scope is
 * provisional here: it becomes false later if the postcode isn't in England.
 */
export function toCandidate(r: Record<string, string>, rules: SicRule[], known: Set<string>): Candidate | null {
  const ch_number = (r['CompanyNumber'] ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(ch_number)) return null;

  const sics: { code: string; text: string }[] = [];
  for (const k of [1, 2, 3, 4]) {
    const raw = (r[`SICCode.SicText_${k}`] ?? '').trim();
    const m = raw.match(/^(\d{4,5})\s*-\s*(.+)$/);
    if (m) sics.push({ code: m[1]!, text: m[2]!.trim() });
  }
  const matched = sics.filter((s) => ruleFor(s.code, rules));
  const isKnown = known.has(ch_number);
  if (!matched.length && !isKnown) return null;

  const status = (r['CompanyStatus'] ?? '').trim();
  const accounts = ACCOUNTS[(r['Accounts.AccountCategory'] ?? '').trim()] ?? {
    band: 'unknown' as SizeBand,
    atLeastSmall: false,
  };
  const country = (r['RegAddress.Country'] ?? '').trim().toUpperCase();

  // Size rule: a company passes if ANY of its engineering SIC codes allows its accounts regime.
  const sizeOk = matched.some((s) => {
    const min = ruleFor(s.code, rules)!.minAccounts;
    return min === 'any' || (min === 'small' && accounts.atLeastSmall) || (min === 'medium' && Boolean(accounts.atLeastMedium));
  });
  const in_scope =
    matched.length > 0 && status === 'Active' && !accounts.dormant && sizeOk && !NON_ENGLAND.has(country);

  if (!in_scope && !isKnown) return null;

  return {
    ch_number,
    name: (r['CompanyName'] ?? '').trim(),
    ch_status: status || 'unknown',
    in_scope,
    sic_codes: sics.map((s) => s.code),
    sectors: [...new Set(matched.map((s) => ruleFor(s.code, rules)!.sector))],
    keywords: [...new Set(matched.map((s) => s.text))],
    size_band: accounts.band,
    incorporated_on: ukDate(r['IncorporationDate']),
    postcode: normalisePostcode(r['RegAddress.PostCode']),
    town: (r['RegAddress.PostTown'] ?? '').trim() || null,
    countryHint: country,
  };
}

/** Extract the CSV next to the zip once (pipeline() resolves only when it is fully on disk). */
export async function extractCsv(zipPath: string): Promise<string> {
  const out = zipPath.replace(/\.zip$/i, '') + '.csv';
  if (existsSync(out)) return out;
  console.log(`extracting ${out}`);
  // Prefer the OS's own unzip: on Windows the yauzl stream stalled ~19 KB
  // before the end of the 2.8 GB entry. tar.exe (bsdtar) ships with Windows 10+.
  const dir = dirname(zipPath);
  const tool =
    process.platform === 'win32'
      ? spawnSync('tar', ['-xf', zipPath, '-C', dir], { stdio: 'inherit' })
      : spawnSync('unzip', ['-o', '-q', zipPath, '-d', dir], { stdio: 'inherit' });
  if (tool.status === 0 && existsSync(out)) return out;
  console.log('system unzip unavailable or failed; falling back to the built-in extractor');
  const zip = await new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (e, z) => (e ? rej(e) : res(z!))),
  );
  const entryStream = await new Promise<Readable>((res, rej) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      if (!entry.fileName.toLowerCase().endsWith('.csv')) return zip.readEntry();
      zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s!)));
    });
    zip.on('end', () => rej(new Error(`${zipPath}: no CSV inside`)));
    zip.readEntry();
  });
  await pipeline(entryStream, createWriteStream(`${out}.part`));
  zip.close();
  renameSync(`${out}.part`, out);
  return out;
}

export async function* csvRows(csvPath: string): AsyncGenerator<Record<string, string>> {
  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: (h: string[]) => h.map((c) => c.trim()),
      relax_column_count: true, // the snapshot has the odd short row
      skip_records_with_error: true,
    }),
  );
  yield* parser as AsyncIterable<Record<string, string>>;
}

export async function download(url: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${path}.part`));
  renameSync(`${path}.part`, path);
}

// COPY text format escaping
const cp = (v: unknown): string => {
  if (v === null || v === undefined) return '\\N';
  if (Array.isArray(v)) {
    return cp(`{${v.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`);
  }
  return String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
};

// ---------------------------------------------------------------------------
async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      date: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  mkdirSync(CACHE_DIR, { recursive: true });

  let zipPath = values.file;
  if (!zipPath) {
    const date = values.date ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const name = `BasicCompanyDataAsOneFile-${date}.zip`;
    zipPath = `${CACHE_DIR}/${name}`;
    await download(`https://download.companieshouse.gov.uk/${name}`, zipPath);
  }
  const fileName = zipPath.split(/[\\/]/).pop()!;

  const rules = loadSicRules();
  // .env in the repo root (git-ignored) so DATABASE_URL survives new terminals.
  if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl && !values['dry-run']) throw new Error('DATABASE_URL is not set (or pass --dry-run)');
  const db = dbUrl ? new pg.Client({ connectionString: dbUrl }) : null;
  await db?.connect();

  // Companies we already hold, so status and scope changes reach them too.
  const known = new Set<string>(
    db
      ? (await db.query<{ ch_number: string }>('select ch_number from public.companies where ch_number is not null'))
          .rows.map((r) => r.ch_number)
      : [],
  );

  // Heartbeat: a silent stall should never look like work.
  const status = { stage: 'extracting', detail: () => '' };
  const heartbeat = setInterval(() => {
    console.log(`  [${new Date().toLocaleTimeString('en-GB')}] still ${status.stage}${status.detail()}`);
  }, 30_000);
  heartbeat.unref();

  const csvPath = await extractCsv(zipPath);
  console.log(`reading ${csvPath}`);
  const candidates: Candidate[] = [];
  let read = 0;
  status.stage = 'reading';
  status.detail = () => `: ${read.toLocaleString('en-GB')} rows`;
  for await (const row of csvRows(csvPath)) {
    if (++read % 1_000_000 === 0) console.log(`  ${read.toLocaleString('en-GB')} rows, ${candidates.length} kept`);
    const c = toCandidate(row, rules, known);
    if (c) candidates.push(c);
  }
  console.log(`read ${read.toLocaleString('en-GB')} rows; ${candidates.length} candidates`);
  console.log(`geocoding postcodes via postcodes.io (cached in ${CACHE_DIR}/postcodes-cache.json)`);
  let geoDone = 0;
  let geoTotal = 0;
  status.stage = 'geocoding';
  status.detail = () => `: ${geoDone}/${geoTotal}`;

  const geo = new PostcodeGeocoder(`${CACHE_DIR}/postcodes-cache.json`);
  const fixes = await geo.lookupMany(
    candidates.flatMap((c) => (c.postcode ? [c.postcode] : [])),
    (done, total) => {
      geoDone = done;
      geoTotal = total;
      if (done % 1_000 < 100 || done === total) console.log(`  geocoded ${done}/${total}`);
    },
  );

  const staged: StagedCompany[] = candidates.map(({ countryHint: _c, ...c }) => {
    const f = c.postcode ? fixes.get(c.postcode) : null;
    // England is decided by where the postcode is, not the free-text country field.
    const inEngland = f ? f.country === 'England' : false;
    return {
      ...c,
      in_scope: c.in_scope && inEngland,
      region: f?.region ?? null,
      county: f?.county ?? null,
      lat: f?.lat ?? null,
      lon: f?.lon ?? null,
    };
  });

  const inScope = staged.filter((s) => s.in_scope);
  const byRegion: Record<string, number> = {};
  for (const s of inScope) byRegion[s.region ?? 'unknown'] = (byRegion[s.region ?? 'unknown'] ?? 0) + 1;
  const bySize: Record<string, number> = {};
  for (const s of inScope) bySize[s.size_band] = (bySize[s.size_band] ?? 0) + 1;
  console.log({ staged: staged.length, in_scope: inScope.length, no_location: candidates.length - staged.filter((s) => s.lat != null).length });
  console.log('in scope by region', byRegion);
  console.log('in scope by size band', bySize);

  if (values['dry-run'] || !db) {
    const out = `${CACHE_DIR}/ch-staged-${fileName.replace(/\.zip$/, '')}.ndjson`;
    const w = createWriteStream(out);
    for (const s of staged) w.write(`${JSON.stringify(s)}\n`);
    w.end();
    console.log(`dry run: wrote ${out}`);
    await db?.end();
    return;
  }

  const cols = [
    'run_id', 'ch_number', 'name', 'ch_status', 'in_scope', 'sic_codes', 'sectors', 'keywords',
    'size_band', 'incorporated_on', 'postcode', 'town', 'region', 'county', 'lat', 'lon',
  ] as const;
  try {
    const run = await db.query<{ id: string }>(
      `insert into import.runs (source, file_name, is_full) values ('companies_house', $1, true) returning id`,
      [fileName],
    );
    const runId = run.rows[0]!.id;
    status.stage = 'uploading';
    status.detail = () => '';
    console.log(`uploading ${staged.length} rows to import.ch_companies`);
    const copy = db.query(copyFrom(`copy import.ch_companies (${cols.join(', ')}) from stdin`));
    await pipeline(
      Readable.from(
        (function* () {
          for (const s of staged) {
            yield `${[runId, ...cols.slice(1).map((k) => s[k as keyof StagedCompany])].map(cp).join('\t')}\n`;
          }
        })(),
      ),
      copy,
    );
    console.log(`staged ${staged.length} rows as run ${runId}; merging (can take a few minutes)`);
    status.stage = 'merging';
    await db.query('begin');
    await db.query(`set local statement_timeout = '15min'`);
    const res = await db.query<{ stats: unknown }>('select import.merge_companies_house($1) as stats', [runId]);
    await db.query('commit');
    // Map and region counts read precomputed views (migration 0013).
    await db.query('select public.refresh_read_models()');
    console.log('refreshed map and region caches');
    console.log('merged', res.rows[0]!.stats);
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

// Run only when executed directly, not when imported by another script.
if (/companies-house[\\/]import\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
