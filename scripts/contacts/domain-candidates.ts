// Real domains for companies with no known website, from Common Crawl's
// free list of registered domains (its quarterly web graph: about 1 GB
// compressed, ~100 million domains).
//
// For every active company without a website, finds domains that read as the
// company's name: they start with its brand word and are made only of its
// name words (or prefixes of them) plus filler like "uk", "ltd" or "group"
// (extract.ts, domainFits). "earthmill-uk.co.uk" fits "Earthmill Maintenance
// Ltd"; "earthmillpizza.com" doesn't. Up to 6 per company go into
// import.website_candidates with origin 'domain_list'. The contact crawler
// then tries them after its own guesses and keeps one only if the site shows
// the company number or postcode, or passes the stricter name-match rules.
// Nothing here is shown to students directly.
//
//   npm run domains:candidates                       download the latest graph and save candidates
//   npm run domains:candidates -- --dry-run          count only, save nothing
//   npm run domains:candidates -- --file vertices.txt.gz   use a downloaded file
//   npm run domains:candidates -- --graph cc-main-2026-aug-sep-oct
//
// Then queue the companies for re-checking and run the crawler (see
// claude/contacts-and-college-links.md). Needs DATABASE_URL (env or .env).
// Takes about 5-10 minutes; memory stays small because the file is streamed.

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import pg from 'pg';
import { brandWord, composable, domainFits, domainParts } from './extract.ts';

const DEFAULT_GRAPH = 'cc-main-2026-aug-sep-oct'; // https://commoncrawl.org/web-graphs
const PER_COMPANY = 6;
const TLD_ORDER: Record<string, number> = { 'co.uk': 0, com: 1, uk: 2, 'org.uk': 3, net: 4 };

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}

/** "uk.co.earthmill" (Common Crawl's reversed form) -> label + TLD, for the TLDs we use. */
export function parseReversed(rev: string): { label: string; tld: string } | null {
  const p = rev.split('.');
  if (p.length === 3 && p[0] === 'uk' && (p[1] === 'co' || p[1] === 'org')) return { label: p[2]!, tld: `${p[1]}.uk` };
  if (p.length === 2 && (p[0] === 'com' || p[0] === 'net' || p[0] === 'uk')) return { label: p[1]!, tld: p[0]! };
  return null;
}

function download(url: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'TLevelPlacementFinder domain-candidates' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${url}: HTTP ${res.statusCode}`));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

interface Company {
  id: string;
  name: string;
}
interface Candidate {
  host: string;
  tld: string;
  cover: number;
  hosts: number;
}

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: {
      graph: { type: 'string', default: DEFAULT_GRAPH },
      file: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  // 1. Companies without a website, grouped by brand word.
  const { rows } = await db.query<Company>(
    `select c.id, c.name from public.companies c where c.status = 'active' and c.website is null`,
  );
  // Per brand word: its companies and the union of their name parts, so one
  // cheap check rules a domain out for every company sharing the brand.
  const byBrand = new Map<string, { companies: Company[]; parts: Set<string>; max: number }>();
  let maxBrand = 0;
  for (const c of rows) {
    const b = brandWord(c.name);
    if (!b) continue;
    const g = byBrand.get(b) ?? byBrand.set(b, { companies: [], parts: new Set(), max: 0 }).get(b)!;
    g.companies.push(c);
    for (const p of domainParts(c.name)) {
      g.parts.add(p);
      g.max = Math.max(g.max, p.length);
    }
    maxBrand = Math.max(maxBrand, b.length);
  }
  console.log(`${rows.length} companies without a website, ${byBrand.size} brand words`);

  // 2. Stream the domain list and match each domain against the brand words.
  let input: Readable;
  if (values.file) {
    input = createReadStream(values.file);
    if (values.file.endsWith('.gz')) input = input.pipe(zlib.createGunzip());
  } else {
    const g = values.graph!;
    const url = `https://data.commoncrawl.org/projects/hyperlinkgraph/${g}/domain/${g}-domain-vertices.txt.gz`;
    console.log(`downloading ${url}`);
    input = (await download(url)).pipe(zlib.createGunzip());
  }
  const found = new Map<string, Candidate[]>(); // company id -> candidates
  let lines = 0;
  const t0 = Date.now();
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (++lines % 10_000_000 === 0) console.log(`  ${lines / 1e6}M domains read, ${((Date.now() - t0) / 1000) | 0}s`);
    // "id<TAB>reversed domain<TAB>host count" (or "reversed<TAB>count").
    const cols = line.split('\t');
    const rev = cols.length >= 3 ? cols[1]! : cols[0]!;
    const d = parseReversed(rev);
    if (!d) continue;
    const plain = d.label.replace(/-/g, '');
    for (let n = 4; n <= Math.min(plain.length, maxBrand); n++) {
      const g = byBrand.get(plain.slice(0, n));
      if (!g || !composable(plain, g.parts, g.max)) continue;
      for (const c of g.companies) {
        const fit = domainFits(d.label, c.name);
        if (!fit) continue;
        const list = found.get(c.id) ?? found.set(c.id, []).get(c.id)!;
        list.push({ host: `${d.label}.${d.tld}`, tld: d.tld, cover: fit.cover, hosts: Number(cols.at(-1)) || 0 });
      }
    }
  }
  const best = [...found].map(([id, list]) => ({
    id,
    hosts: list
      .sort((a, b) => b.cover - a.cover || (TLD_ORDER[a.tld] ?? 9) - (TLD_ORDER[b.tld] ?? 9) || b.hosts - a.hosts)
      .slice(0, PER_COMPANY)
      .map((x) => x.host),
  }));
  const total = best.reduce((n, b) => n + b.hosts.length, 0);
  console.log(`${lines} domains read; ${best.length} companies have candidates (${total} domains)`);

  // 3. Save, replacing the previous run's candidates.
  if (values['dry-run']) {
    for (const b of best.slice(0, 10)) console.log(`  ${rows.find((r) => r.id === b.id)!.name}: ${b.hosts.join(', ')}`);
  } else {
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(`delete from import.website_candidates where origin = 'domain_list'`);
      const ids: string[] = [];
      const urls: string[] = [];
      for (const b of best) for (const h of b.hosts) (ids.push(b.id), urls.push(`https://${h}/`));
      for (let i = 0; i < ids.length; i += 5000) {
        await client.query(
          `insert into import.website_candidates (company_id, url, origin)
           select * , 'domain_list' from unnest($1::uuid[], $2::text[])
           on conflict (company_id, url) do nothing`,
          [ids.slice(i, i + 5000), urls.slice(i, i + 5000)],
        );
      }
      await client.query('commit');
      console.log(`saved ${ids.length} candidates`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
  await db.end();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('domain-candidates.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
