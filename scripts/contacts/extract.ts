// Pure functions for the website and contact crawler. No network, no DB, so
// they are unit-tested in extract.test.ts.
//
// Rules (spec, "Contacts", decided 04/11/2026):
//   * Organisation routes only. Emails must be role mailboxes on the
//     company's own domain; phone numbers must not be mobiles.
//   * A guessed website only counts if the site itself names the company:
//     its Companies House number (UK companies must show it on their
//     website) or its registered office postcode.

// cheerio/slim: the full entry point loads the undici package and installs it as
// the global fetch dispatcher, which crashed long crawls on Node 26 (an
// internal assert when a server closed a TLS connection mid-response).
import * as cheerio from 'cheerio/slim';

export type ContactKind = 'website' | 'careers_page' | 'apply_page' | 'contact_page' | 'contact_form' | 'email' | 'phone';
export type ContactPurpose = 'general' | 'careers' | 'early_careers' | 'apprenticeships' | 'placements' | 'hr';

export interface FoundContact {
  kind: ContactKind;
  purpose: ContactPurpose;
  value: string;
  label: string | null;
  source_url: string;
}

// ---------------------------------------------------------------------------
// Website candidates from a company name
// ---------------------------------------------------------------------------

const SUFFIXES = new Set([
  'limited', 'ltd', 'plc', 'llp', 'lp', 'cic', 'company', 'co', 'uk', 'gb', 'the', 'and',
  'holdings', 'holding', 'international', 'intl', 'europe', 'services', 'trading',
]);

/** Name tokens with legal suffixes and filler removed. */
export function nameTokens(name: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ') // "(UK)", "(Bedford)"
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // Strip suffixes from the end only, so "Services" in "Engineering Services Ltd"
  // goes but "Company" in the middle of a name stays.
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1]!)) words.pop();
  if (words[0] === 'the' && words.length > 1) words.shift();
  return words;
}

/** Hostnames worth trying for a company with no known website. */
export function candidateHosts(name: string): string[] {
  const t = nameTokens(name);
  if (!t.length || t.every((w) => SUFFIXES.has(w))) return [];
  const stems = new Set<string>();
  stems.add(t.join(''));
  if (t.length > 1) stems.add(t.join('-'));
  if (t.length > 2) stems.add(t.slice(0, 2).join(''));
  // Drop trailing generic words ("engineering", "group") for a shorter brand.
  const generic = new Set(['engineering', 'group', 'systems', 'solutions', 'technology', 'technologies', 'manufacturing']);
  const core = t.filter((w, i) => i === 0 || !generic.has(w));
  if (core.length && core.length < t.length) stems.add(core.join(''));
  const hosts: string[] = [];
  for (const s of stems) {
    if (s.length < 3 || s.length > 63) continue;
    // .co.uk and .com only: in 725 confirmed guesses, bare .uk matched 6.
    for (const tld of ['co.uk', 'com']) hosts.push(`${s}.${tld}`);
  }
  // Hits came almost entirely from the first three stems.
  return [...new Set(hosts)].slice(0, 8);
}

// ---------------------------------------------------------------------------
// Does this site belong to this company?
// ---------------------------------------------------------------------------

export interface Identity {
  chNumber: string | null; // e.g. "00585852" or "SC123456"
  postcodes: string[]; // registered office and known sites
}

export type Match = 'company_number' | 'postcode' | null;

function flatText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  return $('body').text().replace(/\s+/g, ' ');
}

export function matchIdentity(html: string, id: Identity): Match {
  const text = flatText(html);
  if (id.chNumber) {
    // Leading zeros are often dropped ("No. 585852"). Must sit near words like
    // "company", "registered" or "number" so a phone number can't match.
    const prefix = id.chNumber.match(/^[A-Z]{2}/)?.[0] ?? '';
    const digits = id.chNumber.slice(prefix.length).replace(/^0+/, '');
    if (digits.length >= 4) {
      const num = new RegExp(`(?<![0-9])${prefix}0*${digits}(?![0-9])`, 'i');
      const ctx = /(compan(y|ies)|regist(ered|ration)|reg\.?|number|no\.?)/i;
      for (const m of text.matchAll(new RegExp(num.source, 'gi'))) {
        const around = text.slice(Math.max(0, m.index! - 80), m.index! + m[0].length + 20);
        if (ctx.test(around)) return 'company_number';
      }
    }
  }
  for (const pc of id.postcodes) {
    const compact = pc.replace(/\s+/g, '').toUpperCase();
    if (compact.length < 5) continue;
    const re = new RegExp(`\\b${compact.slice(0, -3)}\\s*${compact.slice(-3)}\\b`, 'i');
    if (re.test(text)) return 'postcode';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

// Mirrors public.is_role_email (migration 0015). The database is the final
// gate; this keeps the crawler from trying to write what would be refused.
const ROLE_LOCAL = new RegExp(
  '^(info|information|enquiries|enquiry|enquire|hello|contact|contactus|contact-us|contact_us' +
    '|office|admin|administration|reception|general|mail|email' +
    '|careers|career|jobs|job|recruitment|recruiting|recruit|vacancies|vacancy|talent|people|hr|humanresources' +
    '|apprenticeships|apprenticeship|apprentices|apprentice|earlycareers|early-careers|early\\.careers|early_careers' +
    '|graduates|graduate|emerging-talent|emergingtalent|futuretalent|future-talent' +
    '|placements|placement|workexperience|work-experience|work\\.experience|students|student' +
    '|education|schools|outreach|stem|skills|training|academy' +
    '|sales|customerservice|customer-services|customerservices|customer\\.services|service|services|support|team' +
    ')([._-]?(uk|gb|team|dept|enquiries|[0-9]{1,3}))?$',
  'i',
);

export function isRoleEmail(email: string): boolean {
  const m = email.toLowerCase().match(/^([^@\s]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
  return Boolean(m && ROLE_LOCAL.test(m[1]!));
}

/** Mirrors public.is_org_phone: UK landline, 03/08, not a mobile. */
export function isOrgPhone(phone: string): boolean {
  if (!/^\+?[0-9 ()-]{9,20}$/.test(phone)) return false;
  return !/^(07|\+447|\+4407|00447|004407|447)/.test(phone.replace(/[^0-9+]/g, ''));
}

/** "+44 (0)1525 841000" / "01525841000" -> "01525 841000" (UK), else trimmed. */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/[^0-9+]/g, '');
  if (d.startsWith('+44')) d = '0' + d.slice(3).replace(/^0/, '');
  else if (d.startsWith('0044')) d = '0' + d.slice(4).replace(/^0/, '');
  // UK numbers are 11 digits. 09 (premium rate) and 087x (charged) are not
  // something to send a 16-year-old to.
  // Only ranges in use for fixed lines and organisations: 01, 02, 03,
  // 055/056, 0800/0808 and 0843-0845. That also drops digit runs (order or
  // product numbers) that happen to start with 0.
  if (!/^0[1-9][0-9]{9}$/.test(d) || !/^0(1|2|3[03-7]|5[56]|80[08]|84[3-5])/.test(d)) return null;
  // UK display groups: 01xxx xxxxxx, 02x xxxx xxxx, 03/08 xxx xxx xxxx.
  let out: string;
  if (d.startsWith('02')) out = `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  else if (/^0[389]/.test(d)) out = `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  else out = `${d.slice(0, 5)} ${d.slice(5)}`;
  return isOrgPhone(out) ? out : null;
}

/** example.co.uk from www.careers.example.co.uk (good enough for UK/com sites). */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  const twoLevel = /^(co|org|ac|gov|ltd|plc|me|net|sch|nhs)\.uk$/;
  const n = twoLevel.test(parts.slice(-2).join('.')) ? 3 : 2;
  return parts.slice(-n).join('.');
}

const ATS = /(myworkdayjobs\.com|greenhouse\.io|lever\.co|smartrecruiters\.com|teamtailor\.com|workable\.com|recruitee\.com|ashbyhq\.com|icims\.com|successfactors\.(com|eu)|taleo\.net|oraclecloud\.com|tal\.net|hireroad\.com|eploy\.net|jobtrain\.co\.uk|networxrecruitment\.com|applytojob\.com|bamboohr\.com|personio\.(de|com)|pinpointhq\.com|occupop\.com)/i;

function purposeOf(text: string): ContactPurpose {
  const t = text.toLowerCase();
  if (/apprentic/.test(t)) return 'apprenticeships';
  if (/early[\s-]?careers?|graduate|student|school|emerging|future talent/.test(t)) return 'early_careers';
  if (/placement|work experience|t level|internship/.test(t)) return 'placements';
  if (/career|job|vacanc|recruit|work (for|with) us|join (us|our)|working (at|for)|talent/.test(t)) return 'careers';
  if (/\bhr\b|human resources|people team/.test(t)) return 'hr';
  return 'general';
}

const CONTACT_LINK = /contact|get[-\s]in[-\s]touch|enquir/i;

const CAREERS_WORD = /^(careers?|jobs?|vacanc(y|ies)|recruitment|apprenticeships?|apprentices|graduates?|students?|placements?|interns?|internships?|talent|t-?levels?)$/;
const CAREERS_PHRASE = /(work-(for|with)-us|join-(us|our-team|the-team)|working-(at|for|here|with-us)|life-at|early-?careers?|work-?experience|emerging-talent|future-talent)/;

/**
 * A careers landing page, judged by its URL: the last path segment (ignoring
 * index files) is a careers word or phrase. Rejects single vacancies
 * (/vacancies/data-analyst), news slugs, images and documents.
 */
export function isCareersPath(pathname: string): boolean {
  const segs = pathname.toLowerCase().split('/').filter(Boolean);
  if (segs.length && /^(index|default)\.(html?|aspx?|php)$/.test(segs[segs.length - 1]!)) segs.pop();
  const last = segs[segs.length - 1];
  if (!last || segs.length > 4) return false;
  if (/\.(jpe?g|png|gif|webp|svg|pdf|docx?|xlsx?|zip)$/.test(last)) return false;
  if (segs.some((s) => /^(news|blog|articles?|press|media|wp-content|uploads|tag|category|events?)$/.test(s))) return false;
  const stem = last.replace(/\.(html?|aspx?|php)$/, '');
  const words = stem.split(/[-_]/);
  if (words.length > 4) return false; // article slugs
  return CAREERS_PHRASE.test(stem) || words.some((w) => CAREERS_WORD.test(w));
}

function decodeCfEmail(hex: string): string | null {
  // Cloudflare email protection: first byte is the XOR key.
  if (!/^[0-9a-f]{4,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out.includes('@') ? out : null;
}

export interface PageLinks {
  contactPages: string[];
  careersPages: string[];
  legalPages: string[]; // privacy, terms, legal, imprint: where company numbers live
}

/** Same-site links worth following from a page. */
export function interestingLinks(html: string, pageUrl: string): PageLinks {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const site = registrableDomain(base.hostname);
  const out: PageLinks = { contactPages: [], careersPages: [], legalPages: [] };
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')!;
    const text = `${$(el).text()} ${href}`.replace(/\s+/g, ' ').trim();
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || registrableDomain(u.hostname) !== site) return;
    u.hash = '';
    const s = u.toString();
    if (CONTACT_LINK.test(text)) out.contactPages.push(s);
    else if (isCareersPath(u.pathname)) out.careersPages.push(s);
    else if (/privacy|terms|legal|imprint|cookie|about/i.test(text)) out.legalPages.push(s);
  });
  const uniq = (a: string[], n: number) => [...new Set(a)].slice(0, n);
  return { contactPages: uniq(out.contactPages, 2), careersPages: uniq(out.careersPages, 3), legalPages: uniq(out.legalPages, 3) };
}

/** Contacts on one page of the company's own site. */
export function extractContacts(html: string, pageUrl: string, opts: { isContactPage?: boolean } = {}): FoundContact[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const site = registrableDomain(base.hostname);
  const found: FoundContact[] = [];
  const add = (c: Omit<FoundContact, 'source_url'>) => found.push({ ...c, source_url: pageUrl });

  // Emails: mailto links, Cloudflare-protected addresses, then plain text.
  const emails = new Map<string, string>(); // email -> nearby text for purpose
  $('a[href^="mailto:"]').each((_, el) => {
    const e = decodeURIComponent($(el).attr('href')!.slice(7).split('?')[0]!).trim().toLowerCase();
    emails.set(e, `${$(el).text()} ${$(el).parent().text()}`.slice(0, 200));
  });
  $('[data-cfemail]').each((_, el) => {
    const e = decodeCfEmail($(el).attr('data-cfemail')!);
    if (e) emails.set(e.toLowerCase(), $(el).parent().text().slice(0, 200));
  });
  const bodyText = $('body').text();
  for (const m of bodyText.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const e = m[0].toLowerCase();
    if (!emails.has(e)) emails.set(e, bodyText.slice(Math.max(0, m.index! - 80), m.index! + 80));
  }
  for (const [email, ctx] of emails) {
    const domain = email.split('@')[1] ?? '';
    // Own domain only: no agency, web designer or webmail addresses.
    if (registrableDomain(domain) !== site || !isRoleEmail(email)) continue;
    const local = email.split('@')[0]!;
    const p = purposeOf(`${local} ${ctx}`);
    add({ kind: 'email', purpose: p === 'general' ? purposeOf(local) : p, value: email, label: null });
  }

  // Phones: tel: links anywhere; numbers in text only on the contact page.
  const phones = new Set<string>();
  $('a[href^="tel:"]').each((_, el) => {
    const p = normalisePhone(decodeURIComponent($(el).attr('href')!.slice(4)));
    if (p) phones.add(p);
  });
  if (opts.isContactPage) {
    for (const m of bodyText.matchAll(/(?:\+44\s?\(?0?\)?\s?|\(?0)\d(?:[\s-]?\(?\)?\d){8,9}/g)) {
      const p = normalisePhone(m[0]);
      if (p) phones.add(p);
    }
  }
  for (const p of [...phones].slice(0, 2)) add({ kind: 'phone', purpose: 'general', value: p, label: null });

  // Links to careers pages, applicant tracking systems and contact pages.
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')!;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol)) return;
    u.hash = '';
    const url = u.toString();
    const label = text && text.length <= 80 ? text : null;
    if (ATS.test(u.hostname)) {
      add({ kind: 'apply_page', purpose: purposeOf(`${text} ${href}`) === 'general' ? 'careers' : purposeOf(`${text} ${href}`), value: url, label });
    } else if (registrableDomain(u.hostname) === site && isCareersPath(u.pathname) && !CONTACT_LINK.test(text)) {
      const p = purposeOf(`${text} ${u.pathname}`);
      add({ kind: 'careers_page', purpose: p === 'general' ? 'careers' : p, value: url, label });
    }
  });

  // A contact page with a form is a contact_form; otherwise a contact_page.
  if (opts.isContactPage) {
    const hasForm = $('form').toArray().some((f) => $(f).find('textarea, input[type="email"]').length > 0);
    add({ kind: hasForm ? 'contact_form' : 'contact_page', purpose: 'general', value: pageUrl, label: null });
  }

  return dedupe(found);
}

export function dedupe(list: FoundContact[]): FoundContact[] {
  const seen = new Map<string, FoundContact>();
  for (const c of list) {
    const key = `${c.kind}|${c.kind === 'email' || c.kind === 'phone' ? c.value.toLowerCase() : c.value.replace(/\/$/, '')}`;
    const prev = seen.get(key);
    // Keep the most specific purpose seen for the same value.
    if (!prev || (prev.purpose === 'general' && c.purpose !== 'general')) seen.set(key, c);
  }
  // Cap per kind so a sitemap-style footer can't flood a company page.
  const caps: Record<ContactKind, number> = { website: 1, careers_page: 3, apply_page: 2, contact_page: 1, contact_form: 1, email: 4, phone: 2 };
  const count: Partial<Record<ContactKind, number>> = {};
  return [...seen.values()].filter((c) => (count[c.kind] = (count[c.kind] ?? 0) + 1) <= caps[c.kind]);
}

/**
 * Cheap pre-check before hunting through a guessed site's legal pages: does
 * the page mention the company's most distinctive name word at all? If not,
 * it's someone else's site (or a parked domain) and we move on.
 */
export function mentionsName(html: string, name: string): boolean {
  const words = nameTokens(name).filter((w) => w.length >= 4 && !/^(engineering|group|systems|solutions|services|technology|technologies|manufacturing|international)$/.test(w));
  const key = words[0] ?? nameTokens(name)[0];
  if (!key) return true;
  const $ = cheerio.load(html);
  const text = `${$('title').text()} ${$('body').text()}`.toLowerCase();
  return text.includes(key);
}
