// College links from T Level evidence pages (Phase 1).
//
// For every company with takes_tlevel = 'yes', opens the pages already cited
// as evidence that it took T Level students (tlevel_evidence_url and its
// takes_tlevel sources) and looks for the names of T Level
// providers (public.colleges, plus data/college-aliases.csv for brand names
// such as "Kingston College" in South Thames Colleges Group).
//
// A link is written only when the page talks about T Levels and names
// exactly one provider (several names usually means a round-up article
// where we can't tell who placed whom). Kind is always 'tlevel_placements';
// "mainly" is never set here: that needs a person reading a source that says
// so. Everything else is printed for review, not written.
//
//   npm run colleges:link              write links
//   npm run colleges:link -- --dry-run print only
//
// Needs DATABASE_URL and CRAWLER_CONTACT (environment or .env).

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
// cheerio/slim: the full entry point loads the undici package and installs it as
// the global fetch dispatcher, which crashed long crawls on Node 26 (an
// internal assert when a server closed a TLS connection mid-response).
import * as cheerio from 'cheerio/slim';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
import { PoliteFetcher } from '../contacts/fetcher.ts';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface College {
  id: string;
  name: string;
  patterns: RegExp[];
}

function collegePatterns(name: string, aliases: string[]): RegExp[] {
  const names = new Set([name, ...aliases]);
  // "Wiltshire College and University Centre" is usually "Wiltshire College".
  names.add(name.replace(/\s+and University Centre$/i, ''));
  return [...names]
    // Too generic on its own to identify a provider.
    .filter((n) => n.split(/\s+/).length >= 2 || /^[A-Z]{3,}$/.test(n) || n.length >= 7)
    .map((n) => new RegExp(`(?<![A-Za-z])${escape(n).replace(/\s+/g, '\\s+')}(?![A-Za-z])`, 'i'));
}

async function main() {
  loadEnv();
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const fetcher = new PoliteFetcher(process.env.CRAWLER_CONTACT ?? '');
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await db.connect();

  const aliasRows = parse(readFileSync('data/college-aliases.csv'), { columns: true, skip_empty_lines: true }) as {
    college_name: string;
    alias: string;
  }[];
  const aliasesBy = new Map<string, string[]>();
  for (const r of aliasRows) aliasesBy.set(r.college_name, [...(aliasesBy.get(r.college_name) ?? []), r.alias]);

  const { rows: collegeRows } = await db.query<{ id: string; name: string }>('select id, name from public.colleges');
  const colleges: College[] = collegeRows.map((c) => ({ ...c, patterns: collegePatterns(c.name, aliasesBy.get(c.name) ?? []) }));
  for (const name of aliasesBy.keys()) {
    if (!collegeRows.some((c) => c.name === name)) console.warn(`alias file: no college called "${name}"`);
  }

  const { rows: evidence } = await db.query<{ company_id: string; company: string; urls: string[] }>(
    `select c.id as company_id, c.name as company,
            array_remove(array_agg(distinct u.url), null) as urls
       from public.companies c
       left join lateral (
         -- Only pages cited as evidence that the company took T Level
         -- students: a college named there is where those students came from.
         select c.tlevel_evidence_url as url
         union
         select s.url from public.company_sources s
          where s.company_id = c.id and s.field = 'takes_tlevel'
       ) u on true
      where c.takes_tlevel = 'yes' and c.status = 'active'
      group by c.id, c.name
      order by c.name`,
  );

  let written = 0;
  const review: string[] = [];
  for (const e of evidence) {
    for (const url of e.urls) {
      const page = await fetcher.get(url);
      if (!page) {
        review.push(`${e.company}: could not open ${url}`);
        continue;
      }
      const $ = cheerio.load(page.html);
      // The page title keeps the college's name on its own news pages
      // ("... | Middlesbrough College"); nav, header and footer are dropped so
      // partner logos and site-wide links don't count.
      const title = $('title').text();
      $('script, style, noscript, nav, footer, header').remove();
      const text = `${title} ${$('body').text()}`.replace(/\s+/g, ' ');
      if (!/\bT[\s-]?Levels?\b/i.test(text)) continue;
      const named = colleges.filter((c) => c.patterns.some((p) => p.test(text)));
      if (named.length === 0) continue;
      if (named.length > 1) {
        review.push(`${e.company}: ${url} names ${named.map((c) => c.name).join(', ')}; not written`);
        continue;
      }
      const college = named[0]!;
      console.log(`${e.company} -> ${college.name} (${url})`);
      if (!values['dry-run']) {
        const res = await db.query(
          `insert into public.company_college_links (company_id, college_id, kind, source_url, method, evidence_note)
           values ($1, $2, 'tlevel_placements', $3, 'crawler', 'T Level evidence page names this college')
           on conflict (company_id, college_id, kind) do nothing`,
          [e.company_id, college.id, url],
        );
        written += res.rowCount ?? 0;
      }
    }
  }
  if (review.length) {
    console.log('\nfor review (nothing written):');
    for (const r of review) console.log(`  ${r}`);
  }
  console.log(values['dry-run'] ? 'dry run: nothing written' : `${written} links written`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
