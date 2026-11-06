// Re-reads the T Level wording already saved on each course (no fetching):
// * marks "T Level + A level" where the saved quote asks for an A level
//   alongside the T Level (aLevelAlongside in tlevel.ts). Only ever upgrades
//   accepted or unknown -> accepted_with_maths; nothing else changes.
// * fills in tlevel_alevel (e.g. "A level Maths at B") on every
//   accepted_with_maths course, so the tag can show the A level and grade.
//
//   npm run unis:relabel-maths              save
//   npm run unis:relabel-maths -- --dry-run list the changes only

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { aLevelAlongside, gradeIn } from './tlevel.ts';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}

async function main() {
  loadEnv();
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{
      id: string; title: string; uni: string; quote: string; status: string; requirement: string | null; alevel: string | null;
    }>(
      `select c.id, c.title, u.name as uni, c.tlevel_quote as quote, c.tlevel_status::text as status,
              c.tlevel_requirement as requirement, c.tlevel_alevel as alevel
         from public.uni_courses c join public.universities u on u.id = c.university_id
        where c.tlevel_quote is not null and c.tlevel_status in ('accepted', 'unknown', 'accepted_with_maths')
          and c.tlevel_assessed_by is distinct from 'curated'`,
    );
    const updates: { id: string; status: string; requirement: string | null; alevel: string | null }[] = [];
    let upgraded = 0;
    for (const r of rows) {
      const alevel = aLevelAlongside(r.quote);
      if (r.status === 'accepted_with_maths') {
        if (alevel !== r.alevel) updates.push({ id: r.id, status: r.status, requirement: r.requirement, alevel });
      } else if (alevel) {
        upgraded++;
        console.log(`${r.uni} | ${r.title}: ${r.status} -> T Level + ${alevel}`);
        updates.push({ id: r.id, status: 'accepted_with_maths', requirement: r.requirement ?? gradeIn(r.quote), alevel });
      }
    }
    console.log(`${upgraded} courses newly need an A level; ${updates.length - upgraded} more get the A level and grade on their tag`);
    if (values['dry-run'] || !updates.length) return;
    await db.query(
      `update public.uni_courses c set tlevel_status = x.status::public.tlevel_status, tlevel_requirement = x.requirement,
              tlevel_alevel = x.alevel
         from jsonb_to_recordset($1::jsonb) as x(id uuid, status text, requirement text, alevel text)
        where c.id = x.id`,
      [JSON.stringify(updates)],
    );
    console.log('saved');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
