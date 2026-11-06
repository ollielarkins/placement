// Unit tests for university-wide T Level statements.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { policyLinks, readPolicy, sitemapLocs, universityPassages } from './policies.ts';

const page = (url: string, html: string, tlevelPage = true) => ({ url, text: html.replace(/<[^>]+>/g, '\n'), tlevelPage });

test('only universal wording changes a label', () => {
  const no = readPolicy([page('https://u.ac.uk/t-levels', '<p>We do not currently accept T Levels for any of our courses.</p>')]);
  assert.equal(no.status, 'not_accepted');
  const all = readPolicy([page('https://u.ac.uk/t-levels', '<p>T Levels are accepted for all of our undergraduate courses at Merit overall.</p>')]);
  assert.deepEqual([all.status, all.requirement], ['accepted', 'Merit']);
  // A welcome is quoted with its page, but the label stays unknown.
  const welcome = readPolicy([page('https://u.ac.uk/t-levels', '<p>At Brighton we welcome applications from students taking the T-level qualification.</p>')]);
  assert.deepEqual([welcome.status, welcome.url], ['unknown', 'https://u.ac.uk/t-levels']);
  assert.match(welcome.quote!, /welcome applications/);
});

test('course-specific, "some courses", news and table notes are not policies', () => {
  assert.deepEqual(universityPassages([
    'T-Level Not accepted for this course.',
    'T Levels are acceptable qualifications for admission to some of our courses.',
    'Will Turner, 18, from Accrington, achieved a Distinction in his T Level in Engineering and Manufacturing.',
    "Please note that where a T level is listed as 'Not acceptable' this is because the T level does not cover subject content.",
    'We accept T Levels in Engineering and Manufacturing at Merit.',
  ]), ['We accept T Levels in Engineering and Manufacturing at Merit.']);
});

test('links and sitemaps', () => {
  const l = policyLinks('<a href="/study/t-levels">T Levels at university</a><a href="/courses/t-level-engineering">Our T Levels</a><a href="/apply/entry-requirements">Entry requirements</a><a href="https://other.org/t-levels">x</a>', 'https://www.u.ac.uk/');
  assert.deepEqual(l, { tlevel: ['https://www.u.ac.uk/study/t-levels'], entry: ['https://www.u.ac.uk/apply/entry-requirements'] });
  assert.deepEqual(sitemapLocs('<sitemapindex><sitemap><loc>https://u.ac.uk/s1.xml</loc></sitemap></sitemapindex>'), { index: true, locs: ['https://u.ac.uk/s1.xml'] });
});

test("colleges' own T Level course pages are skipped", () => {
  const l = policyLinks('<a href="/study/school-leavers/t-levels/">T Levels</a><a href="/course-type/t-levels/">T Levels</a><a href="/employers/t-levels">T Levels</a><a href="/study/undergraduate/applying/entry-requirements/t-levels/">Applying with a T Level</a>', 'https://www.c.ac.uk/');
  // policyLinks keeps candidates; discover() drops the college ones by path.
  assert.ok(l.tlevel.includes('https://www.c.ac.uk/study/undergraduate/applying/entry-requirements/t-levels/'));
});

test('colleges need an admissions address; stories never count', async () => {
  const { policyPageAllowed } = await import('./policies.ts');
  assert.ok(policyPageAllowed('https://www.bristol.ac.uk/study/t-levels/', 'University of Bristol'));
  assert.ok(!policyPageAllowed('https://leicestercollege.ac.uk/t-levels', 'Leicester College'));
  assert.ok(policyPageAllowed('https://www.c.ac.uk/higher-education/entry-requirements/t-levels', 'Leicester College'));
  assert.ok(!policyPageAllowed('https://www.mdx.ac.uk/mdx-voices/why-i-chose-t-level-health-midwifery/', 'Middlesex University'));
});
