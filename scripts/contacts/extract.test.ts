// Unit tests for the contact crawler's pure functions.
//   npm run test:scripts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  candidateHosts,
  extractContacts,
  interestingLinks,
  isOrgPhone,
  isRoleEmail,
  matchIdentity,
  nameTokens,
  normalisePhone,
  registrableDomain,
} from './extract.ts';
import { allowed, parseRobots } from './fetcher.ts';

test('name tokens drop legal suffixes from the end only', () => {
  assert.deepEqual(nameTokens('ACME ENGINEERING SERVICES (UK) LIMITED'), ['acme', 'engineering']);
  assert.deepEqual(nameTokens('The Company Shop Ltd'), ['company', 'shop']);
  assert.deepEqual(nameTokens('Pope & Meads Limited'), ['pope', 'and', 'meads']);
});

test('candidate hosts cover joined, hyphenated and short forms', () => {
  const h = candidateHosts('Kampf Machinery UK Limited');
  assert.ok(h.includes('kampfmachinery.co.uk'));
  assert.ok(h.includes('kampf-machinery.com'));
  assert.ok(h.length <= 8);
  assert.ok(!h.some((x) => x.endsWith('.uk') && !x.endsWith('.co.uk')));
  assert.deepEqual(candidateHosts('Ltd'), []);
});

test('identity: company number needs nearby context and tolerates dropped zeros', () => {
  const id = { chNumber: '00585852', postcodes: [] };
  assert.equal(matchIdentity('<body><footer>Registered in England No. 585852</footer></body>', id), 'company_number');
  assert.equal(matchIdentity('<body>Company number: 00585852</body>', id), 'company_number');
  assert.equal(matchIdentity('<body>Call 0158 585852 today</body>', id), null);
  assert.equal(matchIdentity('<body>Registered no. 1585852</body>', id), null);
  const sc = { chNumber: 'SC123456', postcodes: [] };
  assert.equal(matchIdentity('<body>Registered in Scotland, company SC123456</body>', sc), 'company_number');
});

test('identity: registered office postcode, with or without the space', () => {
  const id = { chNumber: null, postcodes: ['MK45 2HD'] };
  assert.equal(matchIdentity('<body>Reddings Wood, Ampthill MK452HD</body>', id), 'postcode');
  assert.equal(matchIdentity('<body>Ampthill, mk45 2hd</body>', id), 'postcode');
  assert.equal(matchIdentity('<body>MK45 2HE</body>', id), null);
});

test('role emails pass, named people fail', () => {
  for (const e of ['careers@acme.co.uk', 'early.careers@acme.com', 'info-uk@acme.com', 'hr@acme.com', 'apprenticeships2@acme.org'])
    assert.ok(isRoleEmail(e), e);
  for (const e of ['jane.smith@acme.co.uk', 'jsmith@acme.com', 'j.smith@acme.com', 'paul@acme.com', 'not-an-email'])
    assert.ok(!isRoleEmail(e), e);
});

test('phones: landlines and 03/08 kept, mobiles refused, formatted', () => {
  assert.equal(normalisePhone('+44 (0)1525 841000'), '01525 841000');
  assert.equal(normalisePhone('020 7946 0000'), '020 7946 0000');
  assert.equal(normalisePhone('03331234567'), '0333 123 4567');
  assert.equal(normalisePhone('07700 900123'), null);
  assert.equal(normalisePhone('+447700900123'), null);
  assert.equal(normalisePhone('12345'), null);
  assert.ok(isOrgPhone('01525 841000'));
  assert.ok(!isOrgPhone('+44 (0)7700 900123'));
});

test('registrable domain handles .co.uk', () => {
  assert.equal(registrableDomain('www.careers.acme.co.uk'), 'acme.co.uk');
  assert.equal(registrableDomain('jobs.acme.com'), 'acme.com');
});

const HOME = `<html><body>
  <nav><a href="/contact-us">Contact us</a> <a href="/careers">Careers</a> <a href="/privacy">Privacy</a>
  <a href="https://acme.myworkdayjobs.com/en-GB/Early">Apply now</a></nav>
  <p>Email <a href="mailto:info@acme.co.uk">info@acme.co.uk</a> or jane.smith@acme.co.uk.
  Our web designer: hello@webagency.com</p>
  <a href="tel:+441525841000">01525 841000</a> <a href="tel:07700900123">Mobile</a>
  <a href="/apprenticeships">Apprenticeships</a>
  <span class="__cf_email__" data-cfemail="4021303032252e3429232533282930330021232d256e232f6e352b">[email protected]</span>
  <a href="https://twitter.com/acme">Twitter</a>
</body></html>`;

test('extracts organisation contacts and nothing personal', () => {
  const found = extractContacts(HOME, 'https://www.acme.co.uk/');
  const by = (k: string) => found.filter((c) => c.kind === k).map((c) => c.value);
  assert.deepEqual(by('email').sort(), ['apprenticeships@acme.co.uk', 'info@acme.co.uk']);
  assert.deepEqual(by('phone'), ['01525 841000']);
  assert.deepEqual(by('apply_page'), ['https://acme.myworkdayjobs.com/en-GB/Early']);
  assert.deepEqual(by('careers_page').sort(), ['https://www.acme.co.uk/apprenticeships', 'https://www.acme.co.uk/careers']);
  assert.equal(found.find((c) => c.value.endsWith('/apprenticeships'))!.purpose, 'apprenticeships');
  assert.ok(found.every((c) => c.source_url === 'https://www.acme.co.uk/'));
});

test('contact page: form detected, text phone numbers read', () => {
  const html = `<body><h1>Get in touch</h1><p>Switchboard: 01234 567890</p>
    <form><input type="email" name="e"><textarea></textarea></form></body>`;
  const found = extractContacts(html, 'https://acme.co.uk/contact', { isContactPage: true });
  assert.ok(found.some((c) => c.kind === 'contact_form' && c.value === 'https://acme.co.uk/contact'));
  assert.ok(found.some((c) => c.kind === 'phone' && c.value === '01234 567890'));
});

test('interesting links stay on the same site', () => {
  const links = interestingLinks(HOME, 'https://www.acme.co.uk/');
  assert.deepEqual(links.contactPages, ['https://www.acme.co.uk/contact-us']);
  assert.ok(links.careersPages.includes('https://www.acme.co.uk/careers'));
  assert.deepEqual(links.legalPages, ['https://www.acme.co.uk/privacy']);
});

test('robots.txt: our group, wildcard fallback, longest match', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: TLevelPlacementFinderBot\nDisallow: /private\nAllow: /private/careers\nCrawl-delay: 3`);
  assert.equal(r.delayMs, 3000);
  assert.ok(allowed(r, '/careers'));
  assert.ok(!allowed(r, '/private/x'));
  assert.ok(allowed(r, '/private/careers'));
  const star = parseRobots(`User-agent: *\nDisallow: /admin\nDisallow: /*.pdf$`);
  assert.ok(!allowed(star, '/admin/login'));
  assert.ok(!allowed(star, '/files/a.pdf'));
  assert.ok(allowed(star, '/contact'));
});

test('careers paths: landing pages yes, single vacancies, news and files no', async () => {
  const { isCareersPath } = await import('./extract.ts');
  for (const p of ['/careers', '/about-us/careers/', '/en-us/careers/index.html', '/company/careers/early-careers/engineering-apprenticeships',
    '/work-for-us', '/careers/apprenticeships/', '/life-at-acme.html', '/vacancies/'])
    assert.ok(isCareersPath(p), p);
  for (const p of ['/', '/vacancies/data-analyst/', '/news/apprentice-of-the-year', '/wp-content/uploads/2018/05/apprentices.jpg',
    '/t-level-scholars-forge-full-time-futures-at-acme', '/about-acme', '/files/work-placements.pdf'])
    assert.ok(!isCareersPath(p), p);
});

test('phones: 10-digit fragments and premium numbers refused', () => {
  assert.equal(normalisePhone('01733 23140'), null);
  assert.equal(normalisePhone('0950 635 027'), null);
  assert.equal(normalisePhone('0871 123 4567'), null);
  assert.equal(normalisePhone('0800 059 0800'), '0800 059 0800');
});

test('phones: unused UK ranges refused', () => {
  for (const p of ['06506 567540', '04963 971176', '0389 353 7636', '0812 812 8070']) assert.equal(normalisePhone(p), null, p);
  assert.equal(normalisePhone('0843 123 4567'), '0843 123 4567');
});
