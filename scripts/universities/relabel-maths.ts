// Re-reads the T Level wording already saved on each course (no fetching)
// and marks "T Level + A level Maths" where the saved quote names A level
// Maths in the requirement itself (mathsAfterTLevel in tlevel.ts). Only ever
// changes accepted -> accepted_with_maths; everything else is left alone.
//
//   npm run unis:relabel-maths              save
//   npm run unis:relabel-maths -- --dry-run list the changes only

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { mathsAfterTLevel } from './tlevel.ts';

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
    const { rows } = await db.query<{ id: string; title: string; uni: string; quote: string }>(
      `select c.id, c.title, u.name as uni, c.tlevel_quote as quote
         from public.uni_courses c join public.universities u on u.id = c.university_id
        where c.tlevel_status = 'accepted' and c.tlevel_quote is not null`,
    );
    const ids = rows.filter((r) => mathsAfterTLevel(r.quote)).map((r) => r.id);
    for (const r of rows.filter((x) => ids.includes(x.id))) console.log(`${r.uni} | ${r.title}`);
    const pol = await db.query<{ id: string; name: string; quote: string }>(
      `select id, name, tlevel_policy_quote as quote from public.universities
        where tlevel_policy_status = 'accepted' and tlevel_policy_quote is not null`,
    );
    const polIds = pol.rows.filter((r) => mathsAfterTLevel(r.quote)).map((r) => r.id);
    for (const r of pol.rows.filter((x) => polIds.includes(x.id))) console.log(`${r.name} | university-wide statement`);
    console.log(`${ids.length} courses and ${polIds.length} university statements need A level Maths`);
    if (values['dry-run'] || (!ids.length && !polIds.length)) return;
    await db.query('begin');
    await db.query(`update public.uni_courses set tlevel_status = 'accepted_with_maths' where id = any ($1::uuid[]) and tlevel_status = 'accepted'`, [ids]);
    if (polIds.length) {
      await db.query(`update public.universities set tlevel_policy_status = 'accepted_with_maths' where id = any ($1::uuid[]) and tlevel_policy_status = 'accepted'`, [polIds]);
      // Courses labelled from those statements follow them.
      await db.query(
        `update public.uni_courses set tlevel_status = 'accepted_with_maths'
          where university_id = any ($1::uuid[]) and tlevel_scope = 'university' and tlevel_status = 'accepted'`,
        [polIds],
      );
    }
    await db.query('commit');
    console.log('saved');
  } catch (err) {
    await db.query('rollback').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
