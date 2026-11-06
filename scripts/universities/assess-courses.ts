// Reads each course page and records what it says about T Levels
// (uni_courses.tlevel_*, migration 0024).
//
//   npm run unis:assess                     courses never checked or checked over 60 days ago
//   npm run unis:assess -- --limit 200      stop after 200 courses
//   npm run unis:assess -- --dry-run --limit 20    print, save nothing
//   npm run unis:assess -- --no-claude      rules only
//
// For each course: fetch the course page (politely: robots.txt, one request
// per site at a time, 1.5 s apart), and if it says nothing about T Levels,
// one linked "entry requirements" page on the same site. Rules read the T
// Level passages (tlevel.ts); unclear ones go to Claude when
// ANTHROPIC_API_KEY is set (classify-claude.ts). The passage relied on and
// its page are saved with the answer. Needs DATABASE_URL and CRAWLER_CONTACT.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import * as cheerio from 'cheerio/slim';
import pg from 'pg';
import { PoliteFetcher } from '../contacts/fetcher.ts';
import { classifyWithClaude } from './classify-claude.ts';
import { aLevelAlongside, aLevelRequirement, pageText, readTLevels, tLevelPassages, type Reading } from './tlevel.ts';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}

interface Course {
  id: string;
  title: string;
  university: string;
  course_url: string;
  key: string; // ukprn|kis_course_id|kis_mode
}

type Readings = Map<string, { status: Reading['status']; requirement: string | null; quote: string }>;

/**
 * Readings of unclear wording made by hand (data/uni-tlevel-readings.csv,
 * read by Claude in a build session on 06/11/2026). Used only while the
 * exact quote is still on the page, so a changed page falls back to the
 * rules instead of keeping a stale answer.
 */
export function loadReadings(path = 'data/uni-tlevel-readings.csv'): Readings {
  const out: Readings = new Map();
  if (!existsSync(path)) return out;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  for (const line of lines) {
    const cols: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"', i++);
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') (cols.push(cur), (cur = ''));
      else cur += ch;
    }
    cols.push(cur);
    const [ukprn, kis, mode, status, requirement, quote] = cols;
    if (ukprn && kis && mode && status && quote)
      out.set(`${ukprn}|${kis}|${Number.parseInt(mode, 10)}`, { status: status as Reading['status'], requirement: requirement || null, quote });
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

interface Result extends Reading {
  quoteUrl: string | null;
  alevel: string | null;
  by: 'rules' | 'claude';
}

/** Same-site links to an entry requirements section/page. */
export function entryRequirementLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const out: string[] = [];
  $('a[href]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href')!;
    if (!/entry\s+requirements?|requirements|how\s+to\s+apply|admissions/i.test(`${text} ${href}`)) return;
    try {
      const u = new URL(href, base);
      u.hash = '';
      if (u.hostname === base.hostname && u.toString() !== pageUrl && /^https?:$/.test(u.protocol)) out.push(u.toString());
    } catch {
      /* ignore */
    }
  });
  return [...new Set(out)].slice(0, 1);
}

async function assess(f: PoliteFetcher, c: Course, apiKey: string | null, readings: Readings): Promise<Result> {
  const pages: { url: string; text: string }[] = [];
  const first = await f.get(c.course_url);
  if (!first) return { status: 'unknown', requirement: null, quote: null, ambiguous: false, quoteUrl: null, alevel: null, by: 'rules' };
  pages.push({ url: first.url, text: pageText(first.html) });
  if (!tLevelPassages(pages[0]!.text).length) {
    for (const u of entryRequirementLinks(first.html, first.url)) {
      const p = await f.get(u);
      if (p) pages.push({ url: p.url, text: pageText(p.html) });
    }
  }
  const alevel = pages.map((p) => aLevelRequirement(p.text)).find(Boolean) ?? null;
  for (const p of pages) {
    const passages = tLevelPassages(p.text);
    if (!passages.length) continue;
    let r = readTLevels(passages, { courseTitle: c.title });
    let by: Result['by'] = 'rules';
    const saved = r.status === 'unknown' ? readings.get(c.key) : undefined;
    if (saved && passages.some((x) => squash(x).includes(squash(saved.quote)))) {
      r = { status: saved.status, requirement: saved.requirement, quote: saved.quote, ambiguous: false };
      by = 'claude';
    } else if (r.ambiguous && apiKey) {
      const ai = await classifyWithClaude(passages, c, apiKey).catch((err) => {
        console.error(`${c.university} / ${c.title}: Claude failed: ${(err as Error).message}`);
        return null;
      });
      if (ai) {
        r = ai;
        by = 'claude';
      }
    }
    return { ...r, quoteUrl: r.quote ? p.url : null, alevel, by };
  }
  return { status: 'unknown', requirement: null, quote: null, ambiguous: false, quoteUrl: null, alevel, by: 'rules' };
}

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: {
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '24' },
      'dry-run': { type: 'boolean', default: false },
      'no-claude': { type: 'boolean', default: false },
      group: { type: 'string' }, // engineering, computing, ... (default: all)
      random: { type: 'boolean', default: false }, // random order, for sampling
      'recheck-unknown': { type: 'boolean', default: false }, // re-read every course still "unknown" now
    },
  });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const f = new PoliteFetcher(process.env.CRAWLER_CONTACT ?? '', { timeoutMs: 20_000 }) // some university sites take 5-10 s;
  const apiKey = values['no-claude'] ? null : (process.env.ANTHROPIC_API_KEY ?? null);
  const readings = loadReadings();
  console.log(`${readings.size} saved readings of unclear wording (data/uni-tlevel-readings.csv)`);
  if (!apiKey) console.log('Claude pass off (no ANTHROPIC_API_KEY or --no-claude): unclear wording stays "unknown"');
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 20_000, query_timeout: 60_000 });
  const limit = values.limit ? Number.parseInt(values.limit, 10) : 1_000_000;
  const { rows } = await db.query<Course>(
    `select c.id, c.title, u.name as university, c.course_url, u.ukprn || '|' || c.kis_course_id || '|' || c.kis_mode as key
       from public.uni_courses c join public.universities u on u.id = c.university_id
      where c.course_url is not null
        and (c.tlevel_assessed_at is null or c.tlevel_assessed_at < now() - interval '60 days'
             or ($4 and c.tlevel_status = 'unknown') or ($4 and c.tlevel_scope = 'university'))
        and c.tlevel_assessed_by is distinct from 'curated'
        and ($2::text is null or c.subject_group::text = $2)
      -- One course per university per round: each site allows one request at a
      -- time, so courses grouped by university would queue behind each other.
      order by case when $3 then random() end, c.tlevel_assessed_at nulls first,
               (c.subject_group = 'engineering') desc,
               row_number() over (partition by c.university_id order by c.title), u.name
      limit $1`,
    [values['dry-run'] ? Math.min(limit, 80) : limit, values.group ?? null, values.random, values['recheck-unknown']],
  );
  console.log(`${rows.length} courses to check`);
  const counts: Record<string, number> = {};
  let done = 0;
  const t0 = Date.now();
  const queue = [...rows];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      let r: Result;
      try {
        r = await Promise.race([
          assess(f, c, apiKey, readings),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 120_000)),
        ]);
      } catch {
        continue; // retried on the next run
      }
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      if (values['dry-run']) {
        console.log(`${c.university} / ${c.title}: ${r.status}${r.requirement ? ` (${r.requirement})` : ''} [${r.by}]${r.quote ? `\n    "${r.quote.slice(0, 200)}"` : ''}`);
      } else {
        await db.query(
          `update public.uni_courses set tlevel_status = $2, tlevel_requirement = $3, tlevel_quote = $4, tlevel_quote_url = $5,
                  tlevel_assessed_by = $6, tlevel_assessed_at = now(), tlevel_scope = 'course',
                  alevel_requirement = coalesce($7, alevel_requirement), tlevel_alevel = $8
            where id = $1 and tlevel_assessed_by is distinct from 'curated'`,
          // An unclear passage is kept with "unknown" so students can read it themselves.
          [c.id, r.status, r.requirement, r.quote, r.quote ? r.quoteUrl : null, r.by, r.alevel,
           r.status === 'accepted_with_maths' && r.quote ? aLevelAlongside(r.quote) : null],
        );
      }
      if (++done % 100 === 0) {
        console.log(`${done} courses, ${((done / ((Date.now() - t0) / 60_000)) | 0)}/min: ${JSON.stringify(counts)}`);
        f.prune();
      }
    }
  };
  const n = Math.max(1, Math.min(64, Number.parseInt(values.concurrency!, 10)));
  await Promise.all(Array.from({ length: n }, worker));
  console.log(`done: ${done} courses ${JSON.stringify(counts)}`);
  await db.end();
}

if (/assess-courses\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
