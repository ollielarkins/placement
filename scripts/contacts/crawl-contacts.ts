// Website and organisation-contact crawler (Phase 1).
//
// Works through every active company, slowly and resumably:
//   1. Find the website. Known first (curated record, the employer's own
//      website on an apprenticeship advert), otherwise guessed from the name
//      (acme-engineering.co.uk, acmeengineering.com, ...). A guessed site is
//      confirmed if it shows the company's Companies House number or its
//      registered office postcode; failing that, a "name match" (full-name
//      address, distinctive name, page names the company, no other company's
//      number) is kept and labelled not confirmed. See extract.ts.
//      Domains from Common Crawl's domain list (npm run domains:candidates)
//      are tried after the guesses, under the same rules (stricter for name
//      matches).
//   2. Read the home page, up to two contact pages and two careers pages.
//   3. Keep organisation routes only: role mailboxes on the company's own
//      domain, non-mobile phone numbers, contact/careers/apply pages. The
//      database refuses anything else (migration 0015).
//
//   npm run crawl:contacts                     run until the queue is empty (Ctrl+C to stop; it resumes)
//   npm run crawl:contacts -- --limit 200      stop after 200 companies
//   npm run crawl:contacts -- --dry-run --limit 20    print what it would save (one batch)
//   npm run crawl:contacts -- --company <uuid> one company (any state)
//
// Needs DATABASE_URL and CRAWLER_CONTACT (a URL or email address a site owner
// can use to reach you; it goes in the User-Agent). Both from the environment
// or .env.
//
// Pace: ~2-3 companies a second at the default concurrency, so the full
// register (~93k) takes most of a day. Re-checks done companies after 180
// days, companies with no site after 90.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { PoliteFetcher, type Page } from './fetcher.ts';
import {
  candidateHosts,
  dedupe,
  extractContacts,
  interestingLinks,
  domainNameMatchable,
  hostOf,
  isDistinctiveName,
  isFullNameHost,
  matchIdentity,
  pageHasNamePhrase,
  pageNamesCompany,
  showsOtherCompanyNumber,
  splitHost,
  mentionsName,
  type FoundContact,
  type Match,
} from './extract.ts';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}

interface Job {
  company_id: string;
  name: string;
  ch_number: string | null;
  website: string | null;
  data_source: string;
  postcodes: string[];
  candidates: { url: string; origin: string }[];
}

interface Result {
  state: 'done' | 'no_site' | 'failed';
  site: string | null;
  matched_on: Match | 'curated' | 'vacancy_advert' | null;
  confidence: 'confirmed' | 'name_match';
  contacts: FoundContact[];
  error?: string;
}

const COMPANY_TIMEOUT_MS = 3 * 60_000;

async function crawlOne(f: PoliteFetcher, job: Job): Promise<Result> {
  // 1. Known websites.
  const known: { url: string; how: 'curated' | 'vacancy_advert' }[] = [];
  if (job.website) known.push({ url: job.website, how: 'curated' });
  for (const c of job.candidates) {
    if (c.origin === 'domain_list') continue; // real domains, but still to be confirmed (step 2)
    known.push({ url: c.url, how: c.origin === 'faa_vacancy' ? 'vacancy_advert' : 'curated' });
  }

  let home: Page | null = null;
  let matched: Result['matched_on'] = null;
  for (const k of known) {
    const url = /^https?:\/\//i.test(k.url) ? k.url : `https://${k.url}`;
    home = await f.get(url);
    if (home) {
      matched = k.how;
      break;
    }
  }

  // 2. Guessed websites, confirmed against the company's identity.
  if (!home) {
    const id = { chNumber: job.ch_number, postcodes: job.postcodes };
    const distinctive = isDistinctiveName(job.name);
    let fallback: Page | null = null; // first name-match site, used only if nothing confirms
    if (!id.chNumber && !id.postcodes.length) return { state: 'no_site', site: null, matched_on: null, confidence: 'confirmed', contacts: [] };
    // Guesses first (the full name is the likeliest address), then domains
    // from Common Crawl's list that read as the company's name (domain-candidates.ts).
    const guessed = candidateHosts(job.name);
    const listed = job.candidates
      .filter((c) => c.origin === 'domain_list')
      .map((c) => hostOf(c.url))
      .filter((h): h is string => !!h && !guessed.includes(h));
    for (const host of [...guessed, ...listed]) {
      if (!(await f.resolves(host))) continue;
      const page = (await f.get(`https://www.${host}/`)) ?? (await f.get(`https://${host}/`));
      if (!page) continue;
      let m = matchIdentity(page.html, id);
      if (!m && mentionsName(page.html, job.name)) {
        // Company numbers usually sit in the footer, privacy or terms page.
        const links = interestingLinks(page.html, page.url);
        for (const u of [...links.legalPages, ...links.contactPages].slice(0, 2)) {
          const p = await f.get(u);
          if (p && (m = matchIdentity(p.html, id))) break;
        }
      }
      if (m) {
        home = page;
        matched = m;
        break;
      }
      if (!fallback && distinctive && pageNamesCompany(page.html, job.name) && !showsOtherCompanyNumber(page.html, job.ch_number)) {
        const split = splitHost(host);
        const ok = guessed.includes(host)
          ? isFullNameHost(host, job.name)
          : !!split && domainNameMatchable(split.label, split.tld, job.name) && pageHasNamePhrase(page.html, job.name);
        if (ok) fallback = page;
      }
    }
    if (!home && fallback) {
      home = fallback;
      matched = 'name_match';
    }
  }
  if (!home) return { state: 'no_site', site: null, matched_on: null, confidence: 'confirmed', contacts: [] };

  // 3. Contacts from the home page, contact pages and careers pages.
  const root = new URL(home.url);
  const site = `${root.protocol}//${root.host}/`;
  const found: FoundContact[] = [{ kind: 'website', purpose: 'general', value: site, label: null, source_url: home.url }];
  found.push(...extractContacts(home.html, home.url));
  const links = interestingLinks(home.html, home.url);
  for (const u of links.contactPages) {
    const p = await f.get(u);
    if (p) found.push(...extractContacts(p.html, p.url, { isContactPage: true }));
  }
  for (const u of links.careersPages.slice(0, 2)) {
    const p = await f.get(u);
    if (p) found.push(...extractContacts(p.html, p.url));
  }
  return { state: 'done', site, matched_on: matched, confidence: matched === 'name_match' ? 'name_match' : 'confirmed', contacts: dedupe(found) };
}

async function save(pool: pg.Pool, job: Job, r: Result) {
  // Own connection per company: workers run in parallel, and transactions on a
  // shared client would interleave.
  const db = await pool.connect();
  await db.query('begin');
  try {
    for (const c of r.contacts) {
      // Savepoint per contact: one the database refuses is skipped, not the company.
      await db.query('savepoint one_contact');
      try {
        await db.query(
          `insert into public.company_contacts (company_id, kind, purpose, value, label, source_url, method, confidence)
           values ($1, $2, $3, $4, $5, $6, 'crawler', $7)
           on conflict (company_id, kind, value) do update
             set last_seen_at = now(),
                 -- never downgrade a confirmed contact
                 confidence = case when excluded.confidence = 'confirmed' then 'confirmed'::public.contact_confidence
                                   else company_contacts.confidence end,
                 source_url = case when company_contacts.method = 'crawler' then excluded.source_url else company_contacts.source_url end`,
          [job.company_id, c.kind, c.purpose, c.value, c.label, c.source_url, r.confidence],
        );
        await db.query('release savepoint one_contact');
      } catch (err) {
        await db.query('rollback to savepoint one_contact');
        console.error(`${job.name}: skipped ${c.kind} ${c.value}: ${(err as Error).message}`);
      }
    }
    // Only a confirmed site becomes the company's website; a name match stays
    // a labelled contact.
    if (r.site && !job.website && r.confidence === 'confirmed') {
      await db.query(`update public.companies set website = $2 where id = $1 and website is null`, [job.company_id, r.site]);
      await db.query(
        `insert into public.company_sources (company_id, field, url) values ($1, 'website', $2) on conflict do nothing`,
        [job.company_id, r.site],
      );
    }
    if (r.contacts.length > 1) {
      await db.query(
        `insert into public.company_sources (company_id, field, url) values ($1, 'contacts', $2) on conflict do nothing`,
        [job.company_id, r.site],
      );
    }
    await db.query(
      `update import.contact_crawl
          set state = $2::import.crawl_state, site_url = $3, matched_on = $4, contacts_found = $5, last_error = $6,
              attempts = case when $2::text = 'failed' then attempts + 1 else 0 end,
              checked_at = now(),
              next_check_after = now() + case $2::text when 'done' then interval '180 days'
                                                  when 'no_site' then interval '90 days'
                                                  else interval '1 day' * power(2, least(attempts, 5)) end
        where company_id = $1`,
      [job.company_id, r.state, r.site, r.matched_on, r.contacts.length, r.error ?? null],
    );
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    db.release();
  }
}

async function nextBatch(db: pg.Pool, n: number, only?: string): Promise<Job[]> {
  const { rows } = await db.query<Job>(
    `select c.id as company_id, c.name, c.ch_number, c.website, c.data_source,
            coalesce((select array_agg(distinct s.postcode) from public.company_sites s
                      where s.company_id = c.id and s.postcode is not null), '{}') as postcodes,
            coalesce((select jsonb_agg(jsonb_build_object('url', w.url, 'origin', w.origin))
                      from import.website_candidates w where w.company_id = c.id), '[]') as candidates
       from import.contact_crawl q
       join public.companies c on c.id = q.company_id
      where ${only ? 'q.company_id = $2' : `q.state in ('pending', 'failed', 'done', 'no_site') and q.next_check_after <= now() and q.attempts < 6 and c.status = 'active'`}
      order by q.priority, q.next_check_after
      limit $1`,
    only ? [n, only] : [n],
  );
  return rows;
}

async function main() {
  loadEnv();
  const { values } = parseArgs({
    options: {
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '12' },
      'dry-run': { type: 'boolean', default: false },
      company: { type: 'string' },
    },
  });
  const limit = values.limit ? Number.parseInt(values.limit, 10) : Infinity;
  const concurrency = Math.max(1, Math.min(128, Number.parseInt(values.concurrency!, 10)));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const fetcher = new PoliteFetcher(process.env.CRAWLER_CONTACT ?? '');

  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 4, // the session pooler allows few connections; saves are quick
    // Never wait forever on the database: a connection the pooler dropped
    // silently would otherwise hang a save, and with it the whole batch.
    connectionTimeoutMillis: 20_000,
    query_timeout: 60_000,
    keepAlive: true,
    idleTimeoutMillis: 30_000,
  });
  // An idle connection dropped by the pooler emits 'error' on the pool; without
  // a listener that would end the run. The pool replaces it on next use.
  db.on('error', (err) => console.error(`database connection dropped, reconnecting: ${err.message}`));
  const added = await db.query<{ n: number }>('select import.enqueue_contact_crawl() as n');
  console.log(`queue: ${added.rows[0]!.n} companies added`);

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('\nfinishing the companies in progress, then stopping (Ctrl+C again to quit now)');
  });

  let processed = 0;
  let sites = 0;
  let contacts = 0;
  let taken = 0; // jobs handed out so far (respects --limit)
  let exhausted = false;
  const started = Date.now();
  let lastDone = Date.now();
  let lastReport = 0;
  const queue: Job[] = [];
  const inFlight = new Map<string, { name: string; at: number }>();

  // Continuous queue instead of fixed batches: workers never wait for the
  // slowest company in a batch, which was the main brake on throughput.
  let refilling: Promise<void> | null = null;
  let quietUntil = 0; // after an empty fetch, don't ask the database again for 30 s
  const refill = () =>
    (refilling ??= (async () => {
      if (Date.now() < quietUntil) {
        await new Promise((r) => setTimeout(r, 1000));
        refilling = null;
        return;
      }
      try {
        const want = Math.min(200, limit - taken - queue.length);
        if (want <= 0) {
          exhausted = true;
          return;
        }
        const batch = await nextBatch(db, want, values.company);
        // Skip anything already queued or running (possible near the end of the queue).
        const fresh = batch.filter((j) => !inFlight.has(j.company_id) && !queue.some((q) => q.company_id === j.company_id));
        if (!fresh.length) {
          if (!inFlight.size && !queue.length) exhausted = true;
          else quietUntil = Date.now() + 30_000;
          return;
        }
        if (!values['dry-run']) {
          // Hold them for 2 hours so a second run doesn't pick them up meanwhile.
          await db.query(`update import.contact_crawl set next_check_after = now() + interval '2 hours' where company_id = any($1)`, [
            fresh.map((j) => j.company_id),
          ]);
        }
        queue.push(...fresh);
        if (values.company || values['dry-run']) exhausted = true; // one batch only
      } finally {
        refilling = null;
      }
    })());

  const report = (force = false) => {
    if (!force && processed - lastReport < 200) return;
    lastReport = processed;
    fetcher.prune();
    const mins = (Date.now() - started) / 60000;
    (globalThis as { gc?: () => void }).gc?.(); // only with --expose-gc (diagnostics)
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1e6);
    console.log(`${processed} companies, ${sites} websites, ${contacts} contacts, ${(processed / Math.max(mins, 0.01)).toFixed(0)}/min, ${heapMb} MB${process.env.CRAWL_DEBUG ? ` (${fetcher.stats()})` : ''}`);
  };

  // Heartbeat: say who is slow; if nothing has finished for 10 minutes, stop
  // so the loop runner restarts cleanly.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    if (now - lastDone > 60_000) {
      const slow = [...inFlight.values()].sort((x, y) => x.at - y.at).slice(0, 3)
        .map((f) => `${f.name} (${Math.round((now - f.at) / 1000)}s)`);
      console.log(`  ...${inFlight.size} in progress${slow.length ? `; longest: ${slow.join(', ')}` : ''}`);
    }
    if (now - lastDone > 10 * 60_000) {
      console.error('nothing has finished for 10 minutes: stopping. Run the same command again to resume.');
      process.exit(2);
    }
  }, 60_000);

  const worker = async () => {
    for (;;) {
      if (stopping) return;
      if (queue.length < concurrency && !exhausted) void refill();
      if (!queue.length) {
        if (exhausted) return;
        await (refilling ?? new Promise((r) => setTimeout(r, 200)));
        continue;
      }
      const job = queue.shift()!;
      taken++;
      inFlight.set(job.company_id, { name: job.name, at: Date.now() });
      let r: Result;
      try {
        // Hard cap per company, so one hung site can't hold a worker forever.
        let timer: NodeJS.Timeout | undefined;
        r = await Promise.race([
          crawlOne(fetcher, job),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('company took over 3 minutes')), COMPANY_TIMEOUT_MS);
          }),
        ]).finally(() => clearTimeout(timer));
      } catch (err) {
        r = { state: 'failed', site: null, matched_on: null, confidence: 'confirmed', contacts: [], error: String(err).slice(0, 300) };
      }
      processed++;
      if (r.site) sites++;
      contacts += Math.max(0, r.contacts.length - 1);
      if (values['dry-run']) {
        console.log(`${job.name}: ${r.state}${r.site ? ` ${r.site} (${r.matched_on})` : ''}`);
        for (const c of r.contacts) console.log(`   ${c.kind}/${c.purpose}: ${c.value}`);
      } else {
        try {
          await save(db, job, r);
        } catch (err) {
          // A contact the database refuses (should be rare) fails the company, not the run.
          console.error(`${job.name}: not saved: ${(err as Error).message}`);
          await db
            .query(`update import.contact_crawl set state = 'failed', attempts = attempts + 1, last_error = $2 where company_id = $1`, [
              job.company_id,
              (err as Error).message.slice(0, 300),
            ])
            .catch(() => undefined); // still held for 2 hours, so it is retried later anyway
        }
      }
      inFlight.delete(job.company_id);
      lastDone = Date.now();
      report();
    }
  };

  await refill();
  await Promise.all(Array.from({ length: concurrency }, worker)).finally(() => clearInterval(heartbeat));
  report(true);
  await db.end();
}

// A misbehaving website can make the HTTP stack throw outside any promise we
// hold (a socket closing mid-response). That request is already covered by
// its own timeout, so log it and keep crawling; anything else still stops
// the run.
function isNetworkNoise(err: unknown): boolean {
  const e = err as { code?: string; stack?: string };
  return (
    /undici|client-h1|TLSSocket|_http_client|internal\/(http2|deps\/undici|net|tls|streams?)|node:(net|tls|http2)/.test(e?.stack ?? '') ||
    /^(UND_ERR|ERR_HTTP2_|ERR_HTTP_|ERR_STREAM_|ERR_SSL|ERR_TLS|ECONNRESET|ECONNABORTED|EPIPE|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN)/.test(e?.code ?? '')
  );
}

const isMain = /crawl-contacts\.ts$/.test(process.argv[1] ?? '');
if (isMain) {
  const onStray = (err: unknown) => {
    if (isNetworkNoise(err)) {
      console.error(`ignored a network error from a website: ${(err as Error)?.message ?? String(err)}`);
      return;
    }
    console.error(err);
    process.exit(1);
  };
  process.on('uncaughtException', onStray);
  process.on('unhandledRejection', onStray);
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { crawlOne };
