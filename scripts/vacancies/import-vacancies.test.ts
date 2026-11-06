// Unit tests for the advert-detail helpers in import-vacancies.ts.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { advertDetails, plainText, relevantAdvert, tLevelMention, wageText } from './import-vacancies.ts';

test('T Level mention: the sentence around it, from HTML', () => {
  assert.equal(
    tLevelMention(['<p>We offer great training.</p><p>Applicants with a T Level in Engineering are welcome. Apply now.</p>']),
    'Applicants with a T Level in Engineering are welcome.',
  );
  assert.equal(tLevelMention(['Requirements: T-levels considered']), 'Requirements: T-levels considered');
  assert.equal(tLevelMention(['No mention of it here.', null, undefined]), null);
  assert.equal(tLevelMention(['Total level of effort']), null);
});

test('wage text', () => {
  assert.equal(wageText({ wageType: 'Custom', wageAmount: 24000, wageUnit: 'Annually' }), '£24,000 a year');
  assert.equal(wageText({ wageType: 'Custom', wageAmount: 312.5, wageUnit: 'Weekly' }), '£312.50 a week');
  assert.equal(wageText({ wageType: 'ApprenticeshipMinimum' }), 'National Minimum Wage for apprentices');
  assert.equal(wageText(undefined), null);
});

test('advert details never include named contacts', () => {
  const d = advertDetails({
    vacancyReference: '1', title: 't', employerName: 'e', addresses: [],
    employerContactName: 'Jane Smith', employerContactEmail: 'jane@acme.co.uk',
    qualifications: [{ qualificationType: 'GCSE', subject: 'Maths', grade: '4', weighting: 'Essential' }],
  } as never);
  assert.ok(!JSON.stringify(d).includes('Jane'));
  assert.deepEqual(d.qualifications, [{ type: 'GCSE', subject: 'Maths', grade: '4', essential: true }]);
  assert.equal(plainText('a&amp;b<br>c'), 'a&b\nc');
});

test('other routes keep only engineering-type adverts', () => {
  const c = 'Construction and the built environment';
  assert.equal(relevantAdvert('Engineering and manufacturing', 'Apprentice Baker', null), true);
  assert.equal(relevantAdvert(c, 'Apprentice Electrician', 'Installation and maintenance electrician (level 3)'), true);
  assert.equal(relevantAdvert(c, 'Trainee', 'Building services engineering technician (level 3)'), true);
  assert.equal(relevantAdvert(c, 'Apprentice Bricklayer', 'Bricklayer (level 2)'), false);
  assert.equal(relevantAdvert(c, 'Apprentice Plasterer', 'Plasterer (level 2)'), false);
  assert.equal(relevantAdvert('Construction and building', 'Electrical apprentice', null), true);
  assert.equal(relevantAdvert('Digital', 'Junior Software Developer', 'Software developer (level 4)'), true);
  assert.equal(relevantAdvert('Digital', 'Network Technician', 'Network engineer (level 4)'), true);
  assert.equal(relevantAdvert('Digital', 'Digital Marketing Apprentice', 'Digital marketer (level 3)'), false);
});
