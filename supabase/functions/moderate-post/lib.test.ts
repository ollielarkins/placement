import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CHECKS, buildPrompt, localChecks, normalise, reviewStatus, unscreened } from './lib.ts';

const clean = Object.fromEntries(CHECKS.map((c) => [c, false]));

test('contact details are caught without the model', () => {
  assert.equal(localChecks('email me at sam.smith@example.com').personal_data, true);
  assert.equal(localChecks('ring 07700 900123 for the manager').personal_data, true);
  assert.equal(localChecks('follow @sam_builds').personal_data, true);
  assert.equal(localChecks('Great placement, learned PLC programming in 2025.').personal_data, undefined);
});

test('only a clean, confident verdict publishes', () => {
  const ok = normalise({ verdict: 'publish', uncertain: false, checks: clean, reasons: [] }, { reasons: [] });
  assert.equal(reviewStatus(ok), 'published');
  assert.equal(reviewStatus(normalise({ verdict: 'publish', uncertain: true, checks: clean, reasons: [] }, { reasons: [] })), 'held');
  assert.equal(reviewStatus(normalise({ verdict: 'publish', uncertain: false, checks: { ...clean, names_individual: true }, reasons: [] }, { reasons: [] })), 'held');
  assert.equal(reviewStatus(unscreened('No model')), 'held');
});

test('missing or malformed answers count as flagged', () => {
  const v = normalise({ verdict: 'publish', uncertain: false, checks: { personal_data: false } }, { reasons: [] });
  assert.equal(v.checks.abuse, true);
  assert.equal(reviewStatus(v), 'held');
  assert.equal(reviewStatus(normalise(null, { reasons: [] })), 'held');
});

test('a local contact-detail hit overrides a clean model answer', () => {
  const v = normalise({ verdict: 'publish', uncertain: false, checks: clean, reasons: [] }, localChecks('call 07700 900123'));
  assert.equal(v.checks.personal_data, true);
  assert.equal(reviewStatus(v), 'held');
});

test('safeguarding always wins', () => {
  const v = normalise({ verdict: 'publish', uncertain: false, checks: { ...clean, safeguarding: true }, reasons: ['worrying'] }, { reasons: [] });
  assert.equal(v.verdict, 'safeguarding');
  assert.equal(reviewStatus(v), 'held');
});

test('the prompt wraps the post as data', () => {
  const p = buildPrompt('review', 'Acme Ltd', { review: 'Good', tips: '' });
  assert.match(p, /<review>\nGood\n<\/review>/);
  assert.doesNotMatch(p, /<tips>/);
});
