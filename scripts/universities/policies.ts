// University-wide T Level statements (migration 0025).
//
//   npm run unis:policies                    every university with courses
//   npm run unis:policies -- --dry-run       print, save nothing
//   npm run unis:policies -- --uni 10007784  one university (UKPRN)
//
// For each university: from its home page, and from the entry-requirements
// links on a couple of its course pages, find pages about T Levels or general
// entry requirements (same site only; at most 10 pages, politely). Read their
// T Level passages with the course-page rules, keeping only passages that
// speak for the whole university ("all our courses", "we accept T Levels")
// or name the engineering T Levels. The answer, with its quote and page, is
// saved on the university; courses whose own page said nothing then show it,
// labelled as the university's general statement. Run after unis:assess.
// Needs DATABASE_URL and CRAWLER_CONTACT.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import * as cheerio from 'cheerio/slim';
import pg from 'pg';
import { PoliteFetcher } from '../contacts/fetcher.ts';
import { ENGINEERING_ROUTE, pageText, readTLevels, tLevelPassages, type Reading } from './tlevel.ts';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}

const T_LEVEL_LINK = /\bt[\s_-]?levels?\b/i;
const ENTRY_LINK = /entry[\s_-]*requirements?|admissions?\s+(policy|criteria|statement)|accepted\s+qualifications|qualifications\s+we\s+accept|undergraduate\s+(entry|admissions)/i;
// Paths universities commonly use for their T Level statement.
const COMMON_PATHS = [
  '/t-levels', '/study/t-levels', '/undergraduate/t-levels', '/study/undergraduate/t-levels',
  '/undergraduate/entry-requirements/t-levels', '/study/undergraduate/entry-requirements/t-levels',
  '/undergraduate/applying/t-levels', '/study/undergraduate/applying/t-levels', '/admissions/t-levels',
];

/** Same-site links about T Levels (first) or general entry requirements. */
export function policyLinks(html: string, pageUrl: string): { tlevel: string[]; entry: string[] } {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const site = base.hostname.replace(/^www\./, '');
  const tlevel = new Set<string>();
  const entry = new Set<string>();
  $('a[href]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href')!;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.replace(/^www\./, '').endsWith(site)) return;
    if (/\.(pdf|docx?|xlsx?|jpg|png)$/i.test(u.pathname)) return;
    u.hash = '';
    const hay = `${text} ${decodeURIComponent(u.pathname)}`;
    // Skip the college-side "study a T Level with us" pages: we want admissions to degrees.
    if (/\b(our|study\s+a|apply\s+for\s+a)\s+t[\s-]?levels?\b|t[\s-]?level\s+courses\b/i.test(text)) return;
    if (T_LEVEL_LINK.test(hay)) tlevel.add(u.toString());
    else if (ENTRY_LINK.test(hay)) entry.add(u.toString());
  });
  return { tlevel: [...tlevel].slice(0, 4), entry: [...entry].slice(0, 3) };
}

// A passage that speaks for the whole university, or names engineering T Levels.
// Wording that speaks for every course: only these can change a course's label.
const UNIVERSAL = /\b(all|every)\s+(of\s+)?(our\s+)?(undergraduate\s+)?(courses|programmes|degrees)\b|\bwe\s+(do\s+not|don't|cannot|can't|are\s+unable\s+to)\s+(currently\s+)?(accept|consider)\s+(the\s+)?T[\s-]?Levels?\b|\bT[\s-]?Levels?\s+(are|is)\s+not\s+(currently\s+)?(accepted|considered)\s*(\.|$|for\s+(any|entry))/i;
// General wording worth quoting next to a course (never changes its label on its own).
const GENERAL = /\b(all|any|most|every)\s+(of\s+)?(our\s+)?(undergraduate\s+)?(courses|programmes|degrees|subjects|T[\s-]?Levels?)\b|\bwe\s+(do\s+not\s+|don't\s+|currently\s+)?(accept|consider|welcome)\s+(applications\s+from\s+(students|applicants)\s+(studying|taking|with)\s+)?(the\s+|a\s+)?T[\s-]?Levels?\b|\bT[\s-]?Levels?\s+(are|is)\s+(not\s+)?(currently\s+)?(accepted|considered|welcome)\b/i;
const NOT_POLICY = /\b(achieved|congratulat\w*|celebrat\w*|results\s+day|former\s+student|listed\s+as|where\s+a\s+T[\s-]?level\s+is|aged\s+\d|\d{2},\s+from)\b/i;
const SOME_COURSES = /\b(some|selected|certain|specific|a\s+number\s+of)\s+(of\s+our\s+)?(courses|programmes|degrees|T[\s-]?Level\s+qualifications)\b|course\s+pages?\s+will\s+(detail|show|confirm)|check\s+(the|individual|each)\s+course\s+page/i;

const THIS_COURSE = /\bthis\s+(course|programme|program|degree|pathway)\b|\bfor\s+the\s+(BEng|MEng|BSc|MSci)\b/i;

export function universityPassages(passages: string[]): string[] {
  return passages.filter((p) => (GENERAL.test(p) || ENGINEERING_ROUTE.test(p)) && !SOME_COURSES.test(p) && !THIS_COURSE.test(p) && !NOT_POLICY.test(p));
}

/** <loc> entries of a sitemap or sitemap index. */
export function sitemapLocs(xml: string): { index: boolean; locs: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  return { index: /<sitemapindex\b/i.test(xml), locs };
}

const POLICY_URL = /(?<![a-z])t-?levels?(?![a-z])|(?<![a-z])tlevels?(?![a-z])/i;
const ENTRY_URL = /(entry-?requirements|accepted-?qualifications|admissions-?policy|qualifications-?we-?accept|alternative-?qualifications)(?![a-z])/i;
// A college's pages about taking a T Level at 16, or for employers: not degree admissions.
const FE_PAGE = /study-?with-?us|full-?time-?courses|case-?stud|further-?education|capital-?projects|why-?study|\/courses?\/|\/information\/|school-?leavers|16-?(to-?)?(18|19)|college-?16|course-?(type|areas?|category)|find-?a-?course|employers?|t-?level-?(courses|enquiry)|\/college\/t-?levels|\/\d{4}\/\d{2}\/|news|events?\b/i;
// T Levels talked about as an entry qualification, not as a course to take.
const ABOUT_DEGREES = /\bT[\s-]?levels?\b[^.]{0,200}\b(accept\w*|consider\w*|entry\s+requirements?|UCAS\s+(tariff|points)|undergraduate)\b|\b(accept\w*|consider\w*|entry\s+requirements?|undergraduate)\b[^.]{0,120}\bT[\s-]?levels?\b/i;
const COLLEGE_COURSE = /\/(courses?|course-search|course-category|study-programmes?|subjects?)\/[^/]*t-?level|\/(course|courses)\/[^/]+\/?$/i; // a college's own T Level course

/** Policy-looking pages from a university's sitemaps (robots.txt Sitemap: lines, else /sitemap.xml). */
async function fromSitemaps(f: PoliteFetcher, origin: string, courseUrls: Set<string>) {
  const robots = await f.getXml(`${origin}/robots.txt`);
  const start = robots ? [...robots.html.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!) : [];
  const queue = start.length ? start.slice(0, 5) : [`${origin}/sitemap.xml`];
  const tl = new Set<string>();
  const entry = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < 15) {
    const sm = queue.shift()!;
    if (/\.gz$/i.test(sm)) continue;
    const doc = await f.getXml(sm);
    fetched++;
    if (!doc) continue;
    const { index, locs } = sitemapLocs(doc.html);
    if (index) {
      // Child sitemaps: pages and general content first; skip news, events, people, images.
      const kids = locs.filter((l) => !/news|event|blog|staff|people|profile|image|video|research-output|publication/i.test(l));
      queue.push(...kids.sort((a, b) => Number(/page|general|study|undergrad|admission|content/i.test(b)) - Number(/page|general|study|undergrad|admission|content/i.test(a))));
      continue;
    }
    for (const l of locs) {
      if (courseUrls.has(l.replace(/\/$/, '')) || COLLEGE_COURSE.test(l) || FE_PAGE.test(l) || /blog/i.test(l)) continue;
      if (POLICY_URL.test(l)) tl.add(l);
      else if (ENTRY_URL.test(l) && !/\/courses?\//i.test(l)) entry.add(l);
    }
  }
  // Shortest paths first: /study/t-levels beats /news/2024/t-level-results-day.
  const short = (s: Set<string>) => [...s].sort((a, b) => a.length - b.length);
  return { tlevel: short(tl).slice(0, 5), entry: short(entry).slice(0, 3) };
}

export interface PolicyReading extends Reading {
  url: string | null;
}

/**
 * Reads the policy pages (T Level pages first). A label comes only from
 * universal wording ("all our courses", "we do not accept T Levels");
 * otherwise the best general sentence and the T Level page are kept as
 * "unknown", for students to read themselves.
 */
export function readPolicy(pages: { url: string; text: string; tlevelPage: boolean }[]): PolicyReading {
  let fallback: PolicyReading = { status: 'unknown', requirement: null, quote: null, ambiguous: false, url: null };
  for (const p of pages) {
    const passages = universityPassages(tLevelPassages(p.text));
    const universal = passages.filter((x) => UNIVERSAL.test(x));
    if (universal.length) {
      const r = readTLevels(universal);
      if (r.status !== 'unknown') return { ...r, url: p.url };
    }
    if (!fallback.url && p.tlevelPage) fallback = { ...fallback, url: p.url, quote: passages[0] ?? null };
    else if (!fallback.quote && passages.length && (!fallback.url || fallback.url === p.url)) fallback = { ...fallback, url: p.url, quote: passages[0]! };
  }
  return fallback;
}

const UNIVERSITY_NAME = /\b(university|institute\s+of\s+technology|school\s+of\s+(architecture|art|economics)|conservatoire|imperial\s+college|college\s+london)\b/i;
const ADMISSIONS_PATH = /undergrad|admission|appl(y|ying|ication)|entry-?requirements|accepted-?qualifications|higher-?education|university-?(centre|level)|\/he\//i;
const STORY_PATH = /voices|stories|\/tag\/|course-?detail|celebrat|placement|success/i;

/** A college (not a university) only counts pages whose address is about degree admissions. */
export function policyPageAllowed(url: string, providerName: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }
  if (STORY_PATH.test(path)) return false;
  return UNIVERSITY_NAME.test(providerName) || ADMISSIONS_PATH.test(path);
}

async function discover(f: PoliteFetcher, uni: { name: string; website: string | null; course_urls: string[]; all_course_urls: string[] }) {
  const tl = new Set<string>();
  const entry = new Set<string>();
  const courseUrls = new Set(uni.all_course_urls.map((u) => u.replace(/#.*$/, '').replace(/\/$/, '')));
  const isCourse = (u: string) => {
    if (courseUrls.has(u.replace(/#.*$/, '').replace(/\/$/, ''))) return true;
    try {
      const path = new URL(u).pathname;
      return COLLEGE_COURSE.test(path) || FE_PAGE.test(path) || /blog/i.test(path);
    } catch {
      return true;
    }
  };
  const roots = [uni.website, ...uni.course_urls.slice(0, 2)].filter((u): u is string => !!u);
  for (const r of roots) {
    const page = await f.get(r);
    if (!page) continue;
    const links = policyLinks(page.html, page.url);
    links.tlevel.filter((u) => !isCourse(u)).forEach((u) => tl.add(u));
    links.entry.filter((u) => !isCourse(u)).forEach((u) => entry.add(u));
  }
  // Entry requirements pages often link on to the T Level statement.
  for (const e of [...entry].slice(0, 3)) {
    const page = await f.get(e);
    if (page) policyLinks(page.html, page.url).tlevel.filter((u) => !isCourse(u)).forEach((u) => tl.add(u));
  }
  const origin = (() => {
    try {
      return new URL(uni.website ?? uni.course_urls[0] ?? '').origin;
    } catch {
      return null;
    }
  })();
  if (origin) {
    const sm = await fromSitemaps(f, origin, courseUrls);
    sm.tlevel.forEach((u) => tl.add(u));
    sm.entry.forEach((u) => entry.add(u));
  }
  const guesses = origin ? COMMON_PATHS.map((p) => origin + p) : [];
  const ok = (u: string) => !isCourse(u) && policyPageAllowed(u, uni.name);
  return { tlevel: [...tl].filter(ok).slice(0, 8), entry: [...entry].filter(ok).slice(0, 4), guesses: guesses.filter(ok) };
}

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false }, verbose: { type: 'boolean', default: false }, limit: { type: 'string' }, uni: { type: 'string' }, concurrency: { type: 'string', default: '24' } },
  });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const f = new PoliteFetcher(process.env.CRAWLER_CONTACT ?? '');
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 20_000, query_timeout: 60_000 });
  const { rows } = await db.query<{ id: string; ukprn: string; name: string; website: string | null; course_urls: string[]; all_course_urls: string[] }>(
    `select u.id, u.ukprn, u.name, u.website,
            (select array_agg(c.course_url order by (c.subject_group = 'engineering') desc, c.title)
               from (select * from public.uni_courses c where c.university_id = u.id and c.course_url is not null limit 5) c) as course_urls,
            (select array_agg(c.course_url) from public.uni_courses c where c.university_id = u.id and c.course_url is not null) as all_course_urls
       from public.universities u
      where exists (select 1 from public.uni_courses c where c.university_id = u.id)
        and ($1::text is null or u.ukprn = $1)
      order by u.on_dfe_tlevel_list desc, u.name
      limit $2`,
    [values.uni ?? null, values.limit ? Number.parseInt(values.limit, 10) : 10_000],
  );
  console.log(`${rows.length} universities`);
  const counts: Record<string, number> = {};
  const queue = [...rows];
  let done = 0;
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      let r: PolicyReading = { status: 'unknown', requirement: null, quote: null, ambiguous: false, url: null };
      try {
        const found = await Promise.race([
          discover(f, { name: u.name, website: u.website, course_urls: u.course_urls ?? [], all_course_urls: u.all_course_urls ?? [] }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 180_000)),
        ]);
        if (values.verbose) console.log(`${u.name}: T Level pages ${JSON.stringify(found.tlevel)} entry ${JSON.stringify(found.entry)}`);
        const pages: { url: string; text: string; tlevelPage: boolean }[] = [];
        for (const url of [...found.tlevel, ...found.entry]) {
          const p = await f.get(url);
          // A T Level page that actually talks about T Levels.
          if (!p || !policyPageAllowed(p.url, u.name)) continue; // the final address, after redirects
          const text = pageText(p.html);
          // Only pages about getting onto a degree count (not a college's "study a T Level" page).
          if (!ABOUT_DEGREES.test(text)) continue;
          pages.push({ url: p.url, text, tlevelPage: found.tlevel.includes(url) && /t[\s-]?level/i.test(text) });
        }
        r = readPolicy(pages);
        // Only guess common addresses when nothing linked gave an answer.
        if (r.status === 'unknown' && !r.url) {
          const guessed: { url: string; text: string; tlevelPage: boolean }[] = [];
          for (const url of found.guesses) {
            const p = await f.get(url);
            if (p && /t[\s-]?level/i.test(p.html) && ABOUT_DEGREES.test(p.html) && !FE_PAGE.test(new URL(p.url).pathname) && policyPageAllowed(p.url, u.name))
              guessed.push({ url: p.url, text: pageText(p.html), tlevelPage: true });
            if (guessed.length) break;
          }
          r = readPolicy(guessed);
        }
      } catch {
        /* unknown */
      }
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      if (values['dry-run']) {
        if (r.url) console.log(`${u.name}: ${r.status}${r.requirement ? ` (${r.requirement})` : ''}\n    "${r.quote?.slice(0, 220)}"\n    ${r.url}`);
      } else {
        await db.query(
          `update public.universities set tlevel_policy_status = $2, tlevel_policy_requirement = $3, tlevel_policy_quote = $4,
                  tlevel_policy_url = $5, tlevel_policy_checked_at = now() where id = $1`,
          [u.id, r.status, r.requirement, r.quote, r.url],
        );
      }
      if (++done % 20 === 0) {
        console.log(`${done} universities: ${JSON.stringify(counts)}`);
        f.prune();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(48, Number.parseInt(values.concurrency!, 10))) }, worker));
  if (!values['dry-run']) {
    const applied = await db.query<{ n: number }>('select import.apply_university_tlevel_policies() as n');
    console.log(`courses updated from university statements: ${applied.rows[0]!.n}`);
  }
  console.log(`done: ${JSON.stringify(counts)}`);
  await db.end();
}

if (/policies\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
