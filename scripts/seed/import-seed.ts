// Curated seed import (Phase 0).
//
// Loads data/seed/companies-seed-<region>.csv into public.companies as
// Verified records. Every claim must carry a source URL; the whole run is
// refused if any row fails validation, so a half-checked file never loads.
//
//   npm run import:seed -- --dry-run            validate + geocode only
//   npm run import:seed                          all data/seed/companies-seed-*.csv
//   npm run import:seed -- --file data/seed/companies-seed-east-of-england.csv
//
// DATABASE_URL comes from the environment or .env (see .env.example).
// Column reference: scripts/README.md.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import { PostcodeGeocoder, normalisePostcode } from '../lib/postcodes.ts';
import type {
  PlacementPattern,
  RouteOnward,
  SizeBand,
  TriState,
} from '../../src/types/domain.ts';

const SEED_DIR = 'data/seed';
const CACHE_DIR = '.data';

export const COLUMNS = [
  'name', 'ch_number', 'website', 'summary', 'size_band', 'sectors', 'keywords', 'specialisms',
  'takes_tlevel', 'tlevel_evidence_url', 'routes_onward', 'placement_patterns', 'accepts_under_18',
  'early_careers_programme', 'trade_bodies', 'how_to_apply', 'sites', 'verified_at', 'sources',
] as const;

/** Fields that state a fact about the company: each needs its own source when filled in. */
export const CLAIM_FIELDS = [
  'summary', 'size_band', 'specialisms', 'takes_tlevel', 'routes_onward', 'placement_patterns',
  'accepts_under_18', 'early_careers_programme', 'trade_bodies', 'how_to_apply', 'sites',
] as const;
/** 'company' covers identity: name, CH number, website, sector. */
const SOURCE_FIELDS = new Set<string>(['company', ...CLAIM_FIELDS]);

const SIZE_BANDS: SizeBand[] = ['micro', 'small', 'medium', 'large'];
const TRI: TriState[] = ['yes', 'no', 'unknown'];
const ROUTES: RouteOnward[] = ['apprenticeship', 'degree_apprenticeship', 'sponsored_degree', 'job', 'tlevel_kept_on'];
const PATTERNS: PlacementPattern[] = ['block', 'day_release', 'mixed'];

export interface SeedSite {
  label: string | null;
  postcode: string;
  region?: string | null;
  county?: string | null;
  lat?: number;
  lon?: number;
}

export interface SeedRow {
  file_name: string;
  row_no: number;
  name: string;
  ch_number: string | null;
  website: string | null;
  summary: string | null;
  size_band: SizeBand | null;
  sectors: string[] | null;
  keywords: string[] | null;
  specialisms: string[] | null;
  takes_tlevel: TriState | null;
  tlevel_evidence_url: string | null;
  routes_onward: RouteOnward[] | null;
  placement_patterns: PlacementPattern[] | null;
  accepts_under_18: TriState | null;
  early_careers_programme: boolean | null;
  trade_bodies: string[] | null;
  how_to_apply: string | null;
  verified_at: string; // ISO date
  sites: SeedSite[];
  sources: { field: string; url: string }[];
}

const blank = (v: string | undefined) => (v ?? '').trim() === '';
const list = (v: string | undefined) =>
  blank(v) ? null : v!.split(';').map((s) => s.trim()).filter(Boolean);

function httpUrl(v: string): string | null {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

/** Validates one CSV record. Returns the row, or the list of problems. */
export function validateRow(
  rec: Record<string, string>,
  fileName: string,
  rowNo: number,
  specialismSlugs: Set<string> | null,
  today = new Date(),
): { row?: SeedRow; errors: string[] } {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);

  const name = (rec.name ?? '').trim();
  if (!name) err('name is required');

  let ch: string | null = null;
  if (!blank(rec.ch_number)) {
    ch = rec.ch_number!.trim().toUpperCase().replace(/\s/g, '');
    if (/^\d{1,7}$/.test(ch)) ch = ch.padStart(8, '0'); // spreadsheets drop leading zeros
    if (!/^[A-Z0-9]{8}$/.test(ch)) err(`ch_number "${rec.ch_number}" is not a Companies House number`);
  }

  let website: string | null = null;
  if (!blank(rec.website)) {
    website = httpUrl(rec.website!);
    if (!website) err(`website "${rec.website}" is not an http(s) URL`);
  }

  const enumOne = <T extends string>(field: string, allowed: readonly T[]): T | null => {
    if (blank(rec[field])) return null;
    const v = rec[field]!.trim().toLowerCase() as T;
    if (!allowed.includes(v)) err(`${field} "${rec[field]}" must be one of ${allowed.join(', ')}`);
    return v;
  };
  const enumList = <T extends string>(field: string, allowed: readonly T[]): T[] | null => {
    const vs = list(rec[field])?.map((s) => s.toLowerCase() as T) ?? null;
    for (const v of vs ?? []) if (!allowed.includes(v)) err(`${field} "${v}" must be one of ${allowed.join(', ')}`);
    return vs;
  };

  const size_band = enumOne('size_band', SIZE_BANDS);
  const takes_tlevel = enumOne('takes_tlevel', TRI);
  const accepts_under_18 = enumOne('accepts_under_18', TRI);
  const routes_onward = enumList('routes_onward', ROUTES);
  const placement_patterns = enumList('placement_patterns', PATTERNS);

  const specialisms = list(rec.specialisms);
  if (specialisms && specialismSlugs) {
    for (const s of specialisms) if (!specialismSlugs.has(s)) err(`specialism "${s}" is not a known slug`);
  }

  let early: boolean | null = null;
  if (!blank(rec.early_careers_programme)) {
    const v = rec.early_careers_programme!.trim().toLowerCase();
    if (['yes', 'true', 'y'].includes(v)) early = true;
    else if (['no', 'false', 'n'].includes(v)) early = false;
    else err(`early_careers_programme "${rec.early_careers_programme}" must be yes or no`);
  }

  let tlevel_evidence_url: string | null = null;
  if (!blank(rec.tlevel_evidence_url)) {
    tlevel_evidence_url = httpUrl(rec.tlevel_evidence_url!);
    if (!tlevel_evidence_url) err('tlevel_evidence_url is not an http(s) URL');
  }
  if (takes_tlevel === 'yes' && !tlevel_evidence_url) err('takes_tlevel = yes needs tlevel_evidence_url');

  // DD/MM/YYYY, a real date, not in the future.
  let verified_at = '';
  const m = (rec.verified_at ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) err('verified_at must be DD/MM/YYYY');
  else {
    const d = new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!));
    if (d.getUTCDate() !== +m[1]! || d.getUTCMonth() !== +m[2]! - 1) err(`verified_at "${rec.verified_at}" is not a real date`);
    else if (d.getTime() > today.getTime()) err('verified_at is in the future');
    verified_at = d.toISOString().slice(0, 10);
  }

  const sites: SeedSite[] = [];
  for (const part of list(rec.sites) ?? []) {
    const [a, b] = part.includes('|') ? part.split('|').map((s) => s.trim()) : [null, part];
    const pc = normalisePostcode(b);
    if (!pc) err(`site "${part}" needs a full postcode (Label|POSTCODE)`);
    else sites.push({ label: a || null, postcode: pc });
  }

  const sources: { field: string; url: string }[] = [];
  for (const part of list(rec.sources) ?? []) {
    const i = part.indexOf('|');
    const field = i > 0 ? part.slice(0, i).trim().toLowerCase() : '';
    const url = httpUrl(i > 0 ? part.slice(i + 1) : '');
    if (!SOURCE_FIELDS.has(field)) err(`source "${part}": field must be one of ${[...SOURCE_FIELDS].join(', ')}`);
    else if (!url) err(`source "${part}": not an http(s) URL`);
    else if (!sources.some((s) => s.field === field && s.url === url)) sources.push({ field, url });
  }
  if (!sources.length) err('at least one source is required');
  if (!sources.some((s) => s.field === 'company')) err('needs a "company|<url>" source for the name and identity');

  // Every filled-in claim needs a source for that field.
  const filled: Record<(typeof CLAIM_FIELDS)[number], boolean> = {
    summary: !blank(rec.summary),
    size_band: size_band !== null,
    specialisms: specialisms !== null,
    takes_tlevel: takes_tlevel !== null && takes_tlevel !== 'unknown',
    routes_onward: routes_onward !== null,
    placement_patterns: placement_patterns !== null,
    accepts_under_18: accepts_under_18 !== null && accepts_under_18 !== 'unknown',
    early_careers_programme: early !== null,
    trade_bodies: !blank(rec.trade_bodies),
    how_to_apply: !blank(rec.how_to_apply),
    sites: sites.length > 0,
  };
  // Verified lifts the confidence multiplier to 1.0, so it has to mean the
  // company was actually researched for placements, not just found.
  if (!(filled.specialisms || filled.takes_tlevel || filled.routes_onward || filled.how_to_apply)) {
    err('a curated row must research at least one of specialisms, takes_tlevel, routes_onward, how_to_apply');
  }
  for (const [field, isFilled] of Object.entries(filled)) {
    if (isFilled && !sources.some((s) => s.field === field)) err(`${field} is filled in but has no "${field}|<url>" source`);
  }

  if (errors.length) return { errors: errors.map((e) => `${fileName}:${rowNo}: ${e}`) };
  return {
    errors: [],
    row: {
      file_name: fileName,
      row_no: rowNo,
      name,
      ch_number: ch,
      website,
      summary: blank(rec.summary) ? null : rec.summary!.trim(),
      size_band,
      sectors: list(rec.sectors)?.map((s) => s.toLowerCase().replace(/\s+/g, '_')) ?? null,
      keywords: list(rec.keywords),
      specialisms,
      takes_tlevel,
      tlevel_evidence_url,
      routes_onward,
      placement_patterns,
      accepts_under_18,
      early_careers_programme: early,
      trade_bodies: list(rec.trade_bodies),
      how_to_apply: blank(rec.how_to_apply) ? null : rec.how_to_apply!.trim(),
      verified_at,
      sites,
      sources,
    },
  };
}

export function readSeedFile(path: string): Record<string, string>[] & { lines?: number[] } {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, ''); // Excel adds a BOM
  const records = parse(text, { columns: true, skip_empty_lines: true, info: true, trim: false }) as {
    record: Record<string, string>;
    info: { lines: number };
  }[];
  const header = Object.keys(records[0]?.record ?? {});
  const missing = COLUMNS.filter((c) => !header.includes(c));
  const extra = header.filter((c) => !(COLUMNS as readonly string[]).includes(c));
  if (records.length && (missing.length || extra.length)) {
    throw new Error(`${path}: header mismatch. Missing: ${missing.join(', ') || 'none'}. Unknown: ${extra.join(', ') || 'none'}`);
  }
  const out = records.map((r) => r.record) as Record<string, string>[] & { lines?: number[] };
  out.lines = records.map((r) => r.info.lines);
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

  const files =
    values.file ??
    (existsSync(SEED_DIR)
      ? readdirSync(SEED_DIR).filter((f) => /^companies-seed-.+\.csv$/.test(f)).map((f) => join(SEED_DIR, f))
      : []);
  if (!files.length) throw new Error(`no seed files: expected ${SEED_DIR}/companies-seed-<region>.csv`);

  const db = process.env.DATABASE_URL ? new pg.Client({ connectionString: process.env.DATABASE_URL }) : null;
  if (!db && !values['dry-run']) throw new Error('DATABASE_URL is not set (or pass --dry-run)');
  await db?.connect();

  let slugs: Set<string> | null = null;
  if (db) {
    const r = await db.query<{ s: string }>('select unnest(occupational_specialisms) as s from public.tlevel_routes');
    slugs = new Set(r.rows.map((x) => x.s));
  } else {
    console.warn('no DATABASE_URL: specialism slugs not checked');
  }

  const rows: SeedRow[] = [];
  const errors: string[] = [];
  for (const path of files) {
    const recs = readSeedFile(path);
    recs.forEach((rec, i) => {
      const res = validateRow(rec, basename(path), recs.lines?.[i] ?? i + 2, slugs);
      errors.push(...res.errors);
      if (res.row) rows.push(res.row);
    });
  }

  // The same company twice in one run would make the merge order matter.
  const seen = new Map<string, string>();
  for (const r of rows) {
    const keys = [r.ch_number && `CH ${r.ch_number}`, r.website && `website ${new URL(r.website).hostname.replace(/^www\./, '')}`];
    for (const k of keys.filter(Boolean) as string[]) {
      const at = `${r.file_name}:${r.row_no}`;
      if (seen.has(k)) errors.push(`${at}: same ${k} as ${seen.get(k)}`);
      else seen.set(k, at);
    }
  }

  // Geocode sites; every site must resolve.
  const geo = new PostcodeGeocoder(`${CACHE_DIR}/postcodes-cache.json`);
  const fixes = await geo.lookupMany(rows.flatMap((r) => r.sites.map((s) => s.postcode)));
  for (const r of rows) {
    for (const s of r.sites) {
      const f = fixes.get(s.postcode);
      if (!f) errors.push(`${r.file_name}:${r.row_no}: site postcode ${s.postcode} not found`);
      else {
        if (f.country !== 'England') console.warn(`${r.file_name}:${r.row_no}: site ${s.postcode} is in ${f.country}`);
        Object.assign(s, { region: f.region, county: f.county, lat: f.lat, lon: f.lon });
      }
    }
  }

  console.log(`${files.length} file(s), ${rows.length} valid row(s), ${errors.length} problem(s)`);
  if (errors.length) {
    for (const e of errors) console.error(`  ${e}`);
    await db?.end();
    process.exitCode = 1;
    console.error('nothing loaded: fix the rows above and re-run');
    return;
  }
  if (values['dry-run'] || !db) {
    console.log('dry run: all rows valid, nothing loaded');
    await db?.end();
    return;
  }

  try {
    await db.query('begin');
    const run = await db.query<{ id: string }>(
      `insert into import.runs (source, file_name, is_full) values ('curated_seed', $1, false) returning id`,
      [files.map((f) => basename(f)).join(', ')],
    );
    const runId = run.rows[0]!.id;
    const cols = [
      'run_id', 'file_name', 'row_no', 'name', 'ch_number', 'website', 'summary', 'size_band', 'sectors',
      'keywords', 'specialisms', 'takes_tlevel', 'tlevel_evidence_url', 'routes_onward', 'placement_patterns',
      'accepts_under_18', 'early_careers_programme', 'trade_bodies', 'how_to_apply', 'verified_at', 'sites',
      'sources',
    ] as const;
    // Small files: parameterised inserts are simpler than COPY and fast enough.
    for (const r of rows) {
      const vals = cols.map((c) => (c === 'run_id' ? runId : c === 'sites' || c === 'sources' ? JSON.stringify(r[c]) : r[c as keyof SeedRow]));
      await db.query(
        `insert into import.seed_companies (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        vals,
      );
    }
    const res = await db.query<{ stats: Record<string, number> }>('select import.merge_seed($1) as stats', [runId]);
    const results = await db.query<{ file_name: string; row_no: number; action: string; matched_on: string | null; message: string | null }>(
      `select file_name, row_no, action, matched_on, message from import.seed_results where run_id = $1 order by file_name, row_no`,
      [runId],
    );
    await db.query('commit');
    // Map and region counts read precomputed views (migration 0013).
    await db.query('select public.refresh_read_models()');
    console.log('refreshed map and region caches');
    for (const r of results.rows) {
      const how = r.action === 'updated' ? ` (matched on ${r.matched_on})` : '';
      console.log(`  ${r.file_name}:${r.row_no} ${r.action}${how}${r.message ? `: ${r.message}` : ''}`);
    }
    console.log('merged', res.rows[0]!.stats);
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith('import-seed.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

