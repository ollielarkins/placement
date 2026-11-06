// Course and university rankings built from open data only (Discover Uni,
// HESA / Office for Students, CC BY 4.0), plus each provider's TEF rating.
//
//   npm run unis:rank                         uses .data/discoveruni/DiscoverUni_latest.zip
//   npm run unis:rank -- --zip path/to/file.zip
//   npm run unis:rank -- --dry-run            compute and print, write nothing
//
// Why our own ranking: the published league tables (Complete University
// Guide, Guardian, Times, QS) are copyright and give no licence to copy their
// tables into another product, so we link to them instead and rank from the
// open data they also draw on.
//
// Method (shown to students on every course page):
// * Four measures per full-time course, from Discover Uni: student
//   satisfaction (mean of the seven NSS theme scores), continuation (% still
//   studying or qualified a year in), graduates in work or further study
//   15 months on (%), and median graduate salary.
// * Courses are grouped by provider and subject (CAH level 3, e.g. electrical
//   and electronic engineering); each group takes the median of its courses.
// * Within a subject, each measure becomes a z-score; a group's score is the
//   mean of the z-scores it has (at least two of the four). Subjects with
//   fewer than MIN_SUBJECT ranked providers are not ranked.
// * A provider's overall score is the course-weighted mean of its subject
//   scores, across every subject it teaches (not just engineering). Providers
//   need MIN_OVERALL ranked subjects.
// * Standard competition ranking: equal scores share a rank, shown as "=".

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { csvRows } from '../companies-house/import.ts';
import { extract, loadEnv, subjectGroup } from './import-discover-uni.ts';

export const MIN_SUBJECT = 5;
export const MIN_OVERALL = 5;
/** Shrinkage: a measure from n students counts n / (n + SHRINK) of the way from the subject average. */
export const SHRINK = 30;

export interface Metrics {
  satisfaction: number | null;
  continuation: number | null;
  workStudy: number | null;
  salary: number | null;
  /** Students behind each measure (Discover Uni *POP); small groups are pulled toward the subject average. */
  pop?: Partial<Record<'satisfaction' | 'continuation' | 'workStudy' | 'salary', number | null>>;
}
const KEYS = ['satisfaction', 'continuation', 'workStudy', 'salary'] as const;

export interface CourseInput {
  ukprn: string;
  subjects: string[]; // CAH3 codes
  m: Metrics;
}

export interface Rank {
  rank: number;
  of: number;
  tied: boolean;
  score: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Standard competition ranking, highest score first; scores equal to 3 dp tie. */
export function competitionRank<K>(scores: Map<K, number>): Map<K, Rank> {
  const list = [...scores].map(([k, s]) => ({ k, s, r: Math.round(s * 1000) })).sort((a, b) => b.r - a.r);
  const out = new Map<K, Rank>();
  list.forEach((x, i) => {
    let first = i;
    while (first > 0 && list[first - 1]!.r === x.r) first--;
    const tied = (i > 0 && list[i - 1]!.r === x.r) || (i < list.length - 1 && list[i + 1]!.r === x.r);
    out.set(x.k, { rank: first + 1, of: list.length, tied, score: x.s });
  });
  return out;
}

/** Subject ranks keyed `${ukprn}|${cah}`, and overall ranks keyed by UKPRN. */
export function computeRankings(courses: CourseInput[]) {
  // Provider x subject groups.
  type Vals = Record<(typeof KEYS)[number], number[]>;
  const groups = new Map<string, { ukprn: string; cah: string; n: number; vals: Vals; pops: Vals }>();
  for (const c of courses)
    for (const cah of new Set(c.subjects)) {
      const k = `${c.ukprn}|${cah}`;
      let g = groups.get(k);
      if (!g) {
        const empty = (): Vals => ({ satisfaction: [], continuation: [], workStudy: [], salary: [] });
        groups.set(k, (g = { ukprn: c.ukprn, cah, n: 0, vals: empty(), pops: empty() }));
      }
      g.n++;
      for (const m of KEYS)
        if (c.m[m] != null) {
          g.vals[m].push(c.m[m]!);
          if (c.m.pop?.[m] != null) g.pops[m].push(c.m.pop[m]!);
        }
    }

  const bySubject = new Map<string, { key: string; ukprn: string; n: number; m: Metrics; pop: Record<string, number | null> }[]>();
  for (const [key, g] of groups) {
    const m = Object.fromEntries(KEYS.map((x) => [x, median(g.vals[x])])) as unknown as Metrics;
    const pop = Object.fromEntries(KEYS.map((x) => [x, median(g.pops[x])]));
    (bySubject.get(g.cah) ?? bySubject.set(g.cah, []).get(g.cah)!).push({ key, ukprn: g.ukprn, n: g.n, m, pop });
  }

  const subject = new Map<string, Rank>();
  const groupScore = new Map<string, { ukprn: string; n: number; score: number }>();
  for (const list of bySubject.values()) {
    const stats = KEYS.map((m) => {
      const xs = list.map((g) => g.m[m]).filter((x): x is number => x != null);
      const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1));
      return { m, mean, sd, n: xs.length };
    });
    const scores = new Map<string, number>();
    for (const g of list) {
      const zs = stats
        .filter((s) => s.sd > 0 && s.n >= MIN_SUBJECT && g.m[s.m] != null)
        .map((s) => {
          // No population given: treat as a typical-sized group (no extra pull).
          const n = g.pop[s.m] ?? Infinity;
          const w = n === Infinity ? 1 : n / (n + SHRINK);
          return (w * (g.m[s.m]! - s.mean)) / s.sd;
        });
      if (zs.length >= 2) scores.set(g.key, zs.reduce((a, b) => a + b, 0) / zs.length);
    }
    for (const g of list) if (scores.has(g.key)) groupScore.set(g.key, { ukprn: g.ukprn, n: g.n, score: scores.get(g.key)! });
    if (scores.size >= MIN_SUBJECT) for (const [k, r] of competitionRank(scores)) subject.set(k, r);
  }

  const per = new Map<string, { w: number; s: number; subjects: number }>();
  for (const g of groupScore.values()) {
    const p = per.get(g.ukprn) ?? { w: 0, s: 0, subjects: 0 };
    p.w += g.n;
    p.s += g.score * g.n;
    p.subjects++;
    per.set(g.ukprn, p);
  }
  const overallScores = new Map<string, number>();
  for (const [u, p] of per) if (p.subjects >= MIN_OVERALL) overallScores.set(u, p.s / p.w);
  return { subject, overall: competitionRank(overallScores) };
}

const num = (v: string | undefined, lo: number, hi: number) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && v!.trim() !== '' && n >= lo && n <= hi ? n : null;
};

/** Mean of the NSS theme scores T1-T7 that are present. */
export function satisfaction(r: Record<string, string>): number | null {
  const xs = [1, 2, 3, 4, 5, 6, 7].map((i) => num(r[`T${i}`], 0, 100)).filter((x): x is number => x != null);
  return xs.length >= 4 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

const TEF = new Set(['Gold', 'Silver', 'Bronze', 'Requires improvement']);
export const tefRating = (v: string | undefined) => {
  const s = (v ?? '').trim().replace(/^Requires Improvement$/i, 'Requires improvement');
  return TEF.has(s) ? s : null;
};

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: {
      zip: { type: 'string', default: '.data/discoveruni/DiscoverUni_latest.zip' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!existsSync(values.zip!)) throw new Error(`${values.zip} not found: download it from https://www.hesa.ac.uk/kisdata`);
  const dir = extract(values.zip!);
  const csv = (n: string) => csvRows(join(dir, n));
  const key = (r: Record<string, string>) => `${r.PUBUKPRN}|${r.KISCOURSEID}|${r.KISMODE}`;

  const subjects = new Map<string, string[]>();
  for await (const r of csv('SBJ.csv')) (subjects.get(key(r)) ?? subjects.set(key(r), []).get(key(r))!).push(r.SBJ!);

  const metrics = new Map<string, Metrics>();
  const get = (r: Record<string, string>) => {
    let m = metrics.get(key(r));
    if (!m) metrics.set(key(r), (m = { satisfaction: null, continuation: null, workStudy: null, salary: null, pop: {} }));
    return m;
  };
  const pop = (v: string | undefined) => num(v, 0, 1e6);
  for await (const r of csv('NSS.csv')) Object.assign(get(r), { satisfaction: satisfaction(r) }).pop!.satisfaction = pop(r.NSSPOP);
  for await (const r of csv('CONTINUATION.csv')) Object.assign(get(r), { continuation: num(r.UCONT, 0, 100) }).pop!.continuation = pop(r.CONTPOP);
  for await (const r of csv('EMPLOYMENT.csv')) Object.assign(get(r), { workStudy: num(r.WORKSTUDY, 0, 100) }).pop!.workStudy = pop(r.EMPPOP);
  for await (const r of csv('GOSALARY.csv')) Object.assign(get(r), { salary: num(r.GOINSTMED, 1000, 500000) }).pop!.salary = pop(r.GOSALPOP);

  // Rank on full-time courses; every mode of a course shows its subject's rank.
  const inputs: CourseInput[] = [];
  for (const [k, m] of metrics) {
    const [ukprn, , mode] = k.split('|');
    if (mode === '01' && subjects.has(k)) inputs.push({ ukprn: ukprn!, subjects: subjects.get(k)!, m });
  }
  const { subject, overall } = computeRankings(inputs);

  const tef = new Map<string, { overall: string; experience: string | null; outcomes: string | null; url: string | null }>();
  for await (const r of csv('TEFOutcome.csv')) {
    const o = tefRating(r.OVERALL_RATING);
    if (!o || (tef.has(r.PUBUKPRN!) && r.REPORT_UKPRN !== r.PUBUKPRN)) continue;
    const u = (r.OUTCOME_URL ?? '').trim();
    tef.set(r.PUBUKPRN!, {
      overall: o, experience: tefRating(r.STUDENT_EXPERIENCE_RATING), outcomes: tefRating(r.STUDENT_OUTCOMES_RATING),
      url: /^https:\/\/[^\s]+$/.test(u) && u.length <= 500 ? u : null,
    });
  }

  // The courses we list: their rank subject is their first in-scope CAH code that has a rank, else the first in scope.
  const courses: Record<string, unknown>[] = [];
  for await (const r of csv('KISCOURSE.csv')) {
    const codes = subjects.get(key(r)) ?? [];
    if (!subjectGroup(codes)) continue;
    const inScope = codes.filter((c) => subjectGroup([c]));
    const cah = inScope.find((c) => subject.has(`${r.PUBUKPRN}|${c}`)) ?? inScope[0] ?? null;
    const rk = cah ? subject.get(`${r.PUBUKPRN}|${cah}`) : undefined;
    const m = metrics.get(key(r));
    courses.push({
      ukprn: r.PUBUKPRN, kis_course_id: r.KISCOURSEID, kis_mode: Number.parseInt(r.KISMODE!, 10),
      cah, rank: rk?.rank ?? null, of: rk?.of ?? null, tied: rk?.tied ?? null,
      sat: m?.satisfaction != null ? Math.round(m.satisfaction) : null, cont: m?.continuation ?? null,
      work: m?.workStudy ?? null, salary: m?.salary ?? null,
    });
  }
  const unis = [...new Set([...overall.keys(), ...tef.keys()])].map((u) => ({
    ukprn: u, rank: overall.get(u)?.rank ?? null, of: overall.get(u)?.of ?? null, tied: overall.get(u)?.tied ?? null,
    tef: tef.get(u)?.overall ?? null, tef_exp: tef.get(u)?.experience ?? null, tef_out: tef.get(u)?.outcomes ?? null, tef_url: tef.get(u)?.url ?? null,
  }));

  const ranked = courses.filter((c) => c.rank != null).length;
  console.log(`${overall.size} providers ranked overall; ${tef.size} TEF ratings; ${ranked} of ${courses.length} listed courses have a subject rank`);
  if (values['dry-run']) return;

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('begin');
    await db.query(
      `update public.universities set overall_rank = null, overall_rank_of = null, overall_rank_tied = null,
         tef_overall = null, tef_experience = null, tef_outcomes = null, tef_url = null, rankings_on = current_date`,
    );
    await db.query(
      `update public.universities u set overall_rank = x.rank, overall_rank_of = x.of, overall_rank_tied = x.tied,
         tef_overall = x.tef, tef_experience = x.tef_exp, tef_outcomes = x.tef_out, tef_url = x.tef_url
       from jsonb_to_recordset($1::jsonb) as x(ukprn text, rank smallint, of smallint, tied boolean,
         tef text, tef_exp text, tef_out text, tef_url text)
       where u.ukprn = x.ukprn`,
      [JSON.stringify(unis)],
    );
    for (let i = 0; i < courses.length; i += 5000) {
      await db.query(
        `update public.uni_courses c set rank_subject = x.cah, subject_rank = x.rank, subject_rank_of = x.of,
           subject_rank_tied = x.tied, satisfaction_pct = x.sat, continuation_pct = x.cont,
           work_study_pct = x.work, median_salary = x.salary
         from jsonb_to_recordset($1::jsonb) as x(ukprn text, kis_course_id text, kis_mode smallint, cah text,
           rank smallint, of smallint, tied boolean, sat smallint, cont smallint, work smallint, salary int),
           public.universities u
         where u.ukprn = x.ukprn and c.university_id = u.id and c.kis_course_id = x.kis_course_id and c.kis_mode = x.kis_mode`,
        [JSON.stringify(courses.slice(i, i + 5000))],
      );
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

if (/rankings\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
