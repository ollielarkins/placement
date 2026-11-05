// Polite HTTP for the contact crawler.
//
//   * Identifies itself (CRAWLER_CONTACT is required: a URL or email address
//     a site owner can use to reach us).
//   * Obeys robots.txt (our token "TLevelPlacementFinderBot", then "*"),
//     including Crawl-delay up to 10 s.
//   * One request at a time per host, at least 1.5 s apart.
//   * HTML only, 1.5 MB cap, 8 s timeout, at most 5 redirects.
//
// Uses node:http/https with a fresh connection per request instead of fetch.
// fetch keeps a connection pool per website for the life of the process, and
// across tens of thousands of websites that ran the crawler out of memory.

import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const TOKEN = 'TLevelPlacementFinderBot';
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000; // a site that hasn't answered in 8 s rarely does
const MIN_GAP_MS = 1_500;

export interface Page {
  url: string; // final URL after redirects
  status: number;
  html: string;
}

interface Rules {
  disallow: string[];
  allow: string[];
  delayMs: number;
}

export class PoliteFetcher {
  private readonly ua: string;
  private robots = new Map<string, Promise<Rules>>();
  private nextFree = new Map<string, number>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(contact: string) {
    if (!contact) throw new Error('CRAWLER_CONTACT is not set (a URL or email site owners can use to reach you)');
    this.ua = `Mozilla/5.0 (compatible; ${TOKEN}/0.1; +${contact})`;
  }

  /** True if the host has an address (cheap filter before any HTTP). */
  async resolves(host: string): Promise<boolean> {
    try {
      // getaddrinfo has no timeout of its own and can hang on Windows.
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        lookup(host),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('dns timeout')), 5_000);
        }),
      ]).finally(() => clearTimeout(timer));
      return true;
    } catch {
      return false;
    }
  }

  /** GET an HTML page, or null when blocked, missing, not HTML or failing. */
  async get(url: string): Promise<Page | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const rules = await this.rulesFor(u);
    if (!allowed(rules, u.pathname + u.search)) return null;
    return this.serial(u.host, async () => {
      await this.wait(u.host, rules.delayMs);
      return this.fetchHtml(u.toString());
    });
  }

  private async fetchHtml(url: string, hops = 0): Promise<Page | null> {
    const res = await httpGet(url, this.ua, 'text/html,application/xhtml+xml', MAX_BYTES, (h) =>
      (h['content-type'] ?? '').includes('html'),
    );
    if (!res) return null;
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hops >= 5) return null;
      let next: URL;
      try {
        next = new URL(res.location, url);
      } catch {
        return null;
      }
      if (!/^https?:$/.test(next.protocol)) return null;
      // A redirect to another host is followed, but that host's robots.txt
      // still applies.
      if (!allowed(await this.rulesFor(next), next.pathname + next.search)) return null;
      return this.fetchHtml(next.toString(), hops + 1);
    }
    if (res.status < 200 || res.status >= 300 || res.body === null) return null;
    return { url, status: res.status, html: res.body };
  }


  private rulesFor(u: URL): Promise<Rules> {
    const key = `${u.protocol}//${u.host}`;
    let p = this.robots.get(key);
    if (!p) {
      p = this.loadRobots(key);
      this.robots.set(key, p);
    }
    return p;
  }

  private async loadRobots(origin: string, hops = 0): Promise<Rules> {
    // Some robots.txt files run to megabytes; the first 500 kB is plenty.
    const res = await httpGet(`${origin}/robots.txt`, this.ua, 'text/plain', 500_000, () => true);
    // Network trouble or 5xx: treat the site as closed. 4xx: no rules.
    if (!res || res.status >= 500) return { disallow: ['/'], allow: [], delayMs: 0 };
    if (res.status >= 300 && res.status < 400 && res.location && hops < 3) {
      try {
        const next = new URL(res.location, `${origin}/robots.txt`);
        if (next.pathname === '/robots.txt') return this.loadRobots(`${next.protocol}//${next.host}`, hops + 1);
      } catch {
        /* fall through */
      }
      return { disallow: [], allow: [], delayMs: 0 };
    }
    if (res.status >= 400) return { disallow: [], allow: [], delayMs: 0 };
    return parseRobots(res.body ?? '');
  }


  private async wait(host: string, crawlDelay: number) {
    const gap = Math.max(MIN_GAP_MS, crawlDelay);
    const now = Date.now();
    const at = Math.max(now, this.nextFree.get(host) ?? 0);
    this.nextFree.set(host, at + gap);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  private serial<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(host) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // The chain keeps only "done", never the page: holding the resolved value
    // here kept every fetched page (up to 1.5 MB each) alive for the whole run
    // and ran the crawler out of memory after ~80 minutes. Idle hosts are
    // dropped from the map too.
    const tail: Promise<void> = next.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(host, tail);
    void tail.then(() => {
      if (this.chains.get(host) === tail) this.chains.delete(host);
    });
    return next;
  }

  stats() {
    return `${this.robots.size} robots, ${this.chains.size} chains, ${this.nextFree.size} hosts`;
  }

  /** Drops per-host state that is no longer needed. Called between batches. */
  prune() {
    const now = Date.now();
    for (const [host, at] of this.nextFree) if (at < now) this.nextFree.delete(host);
    // robots.txt rules are only reused while a company is being crawled (hosts
    // rarely repeat across companies), and some files are large, so start each
    // batch with an empty cache.
    this.robots.clear();
  }
}

interface RawResponse {
  status: number;
  location: string | null;
  body: string | null; // null when not wanted (wrong type) or not read
}

/**
 * One GET on its own connection (agent: false, so nothing is pooled), with a
 * hard deadline for the whole exchange, a size cap and gzip/deflate/br
 * support. Never throws: network failures resolve to null.
 */
function httpGet(
  url: string,
  ua: string,
  accept: string,
  maxBytes: number,
  wantBody: (headers: http.IncomingHttpHeaders) => boolean,
): Promise<RawResponse | null> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!lib) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (r: RawResponse | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req.destroy();
      resolve(r);
    };
    const req = lib.get(
      u,
      {
        agent: false,
        headers: {
          'user-agent': ua,
          accept,
          'accept-language': 'en-GB,en;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
          connection: 'close',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        if (status >= 300 || !wantBody(res.headers)) {
          res.resume(); // drain and let the socket close
          finish({ status, location, body: null });
          return;
        }
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        let stream: NodeJS.ReadableStream = res;
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            finish({ status, location, body: Buffer.concat(chunks).toString('utf8') });
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () => finish({ status, location, body: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', () => finish(null));
        res.on('error', () => finish(null));
      },
    );
    req.on('error', () => finish(null));
    const deadline = setTimeout(() => finish(null), TIMEOUT_MS);
  });
}

/** robots.txt groups for our token, falling back to "*". */
export function parseRobots(txt: string): Rules {
  const groups: { agents: string[]; disallow: string[]; allow: string[]; delay: number }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, k, v] = m as unknown as [string, string, string];
    const key = k.toLowerCase();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallow: [], allow: [], delay: 0 };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'disallow' && v) cur.disallow.push(v);
    else if (key === 'allow' && v) cur.allow.push(v);
    else if (key === 'crawl-delay') cur.delay = Math.min(10, Number.parseFloat(v) || 0);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && TOKEN.toLowerCase().includes(a)));
  const g = mine ?? groups.find((x) => x.agents.includes('*'));
  return g ? { disallow: g.disallow, allow: g.allow, delayMs: g.delay * 1000 } : { disallow: [], allow: [], delayMs: 0 };
}

/** Longest matching rule wins; Allow wins a tie. Supports * and $. */
export function allowed(rules: Rules, path: string): boolean {
  const score = (pats: string[]) =>
    Math.max(-1, ...pats.filter((p) => toRegex(p).test(path)).map((p) => p.length));
  const a = score(rules.allow);
  const d = score(rules.disallow);
  return d < 0 || a >= d;
}

function toRegex(p: string): RegExp {
  const end = p.endsWith('$');
  const body = (end ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${end ? '$' : ''}`);
}
