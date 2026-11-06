// Unit tests for the course-page T Level reader.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { aLevelRequirement, gradeIn, pageText, readTLevels, tLevelPassages } from './tlevel.ts';

const read = (html: string) => readTLevels(tLevelPassages(pageText(html)));

test('accepted: grade stated for the T Level', () => {
  const r = read('<h3>Entry requirements</h3><p>A levels: ABB including Maths</p><p>T Levels: Distinction in Engineering and Manufacturing.</p>');
  assert.equal(r.status, 'accepted');
  assert.equal(r.requirement, 'Distinction');
  assert.match(r.quote!, /T Levels: Distinction/);
});

test('accepted: heading then the requirement on the next line', () => {
  const r = read('<dt>T Level</dt><dd>D* overall in a relevant T Level (Engineering)</dd>');
  assert.equal(r.status, 'accepted');
  assert.equal(r.requirement, 'Distinction*');
});

test('accepted with maths', () => {
  const r = read('<p>We accept the T Level in Design and Development for Engineering and Manufacturing at Distinction, plus A level Mathematics at grade B.</p>');
  assert.equal(r.status, 'accepted_with_maths');
  assert.equal(r.requirement, 'Distinction');
});

test('case by case', () => {
  assert.equal(read('<p>T Levels will be considered on a case-by-case basis. Please contact our admissions team.</p>').status, 'case_by_case');
  assert.equal(read('<p>Applicants with T Levels are considered on an individual basis.</p>').status, 'case_by_case');
});

test('not accepted', () => {
  assert.equal(read('<p>Unfortunately we do not currently accept T Levels for this course.</p>').status, 'not_accepted');
  assert.equal(read('<p>T Levels are not accepted for entry to this programme.</p>').status, 'not_accepted');
});

test('unknown: no mention, other routes only, or mixed messages', () => {
  assert.deepEqual(read('<p>A levels: AAA</p>'), { status: 'unknown', requirement: null, quote: null, ambiguous: false });
  assert.equal(read('<p>We accept the T Level in Health at Distinction.</p>').status, 'unknown');
  const mixed = read('<p>T Levels: Distinction.</p><p>T Levels are not accepted for the foundation year.</p>');
  assert.equal(mixed.status, 'unknown');
  assert.equal(mixed.ambiguous, true);
  assert.ok(mixed.quote);
});

test('grades and A level requirements', () => {
  assert.equal(gradeIn('Merit (C) overall'), 'Merit (C)');
  assert.equal(gradeIn('no grade here'), null);
  assert.equal(aLevelRequirement('A levels: AAB including Mathematics and Physics.'), 'AAB including Mathematics and Physics');
  assert.equal(aLevelRequirement('A-level A*AA'), 'A*AA');
  assert.equal(aLevelRequirement('Typical offer 120 UCAS points'), null);
});

test('Claude answers are kept only if the quote is on the page', async () => {
  const { validateAnswer } = await import('./classify-claude.ts');
  const passages = ['T Levels: we consider the T Level in Engineering at Distinction with A level Maths at C.'];
  assert.deepEqual(
    validateAnswer({ status: 'accepted_with_maths', requirement: 'Distinction', quote: 'T Level in Engineering at Distinction with A level Maths at C' }, passages),
    { status: 'accepted_with_maths', requirement: 'Distinction', quote: 'T Level in Engineering at Distinction with A level Maths at C', ambiguous: false },
  );
  assert.equal(validateAnswer({ status: 'accepted', requirement: 'D*', quote: 'We accept all T Levels at D*' }, passages), null);
  assert.equal(validateAnswer({ status: 'maybe', requirement: '', quote: '' }, passages), null);
  assert.deepEqual(validateAnswer({ status: 'unknown', requirement: '', quote: '' }, passages), { status: 'unknown', requirement: null, quote: null, ambiguous: false });
});

test('entry requirement links stay on the same site', async () => {
  const { entryRequirementLinks } = await import('./assess-courses.ts');
  assert.deepEqual(
    entryRequirementLinks('<a href="/eee/entry-requirements">Entry requirements</a><a href="https://other.ac.uk/requirements">x</a>', 'https://uni.ac.uk/eee'),
    ['https://uni.ac.uk/eee/entry-requirements'],
  );
});

test('real-page shapes: tabbed lists and boilerplate', () => {
  assert.equal(read('<li>T Levels</li><li>GCSEs</li><li>Extended Diploma and National Extended Diploma: Merit Merit Merit</li>').status, 'unknown');
  const sw = read('<h4>T Levels</h4><p>Distinction with Grade B in A Level Maths</p><p>Mixed Qualifications</p><p>T Level applicants: please contact our admissions team.</p>');
  assert.equal(sw.status, 'accepted_with_maths');
  assert.equal(read('<p>T Levels: Merit</p><p>Access to HE: 45 credits</p>').status, 'accepted');
});

test('real-page shapes, second sample', () => {
  const r = (h: string) => read(h);
  assert.equal(r('<p>T Levels: Grade C in A-Level Mathematics, in addition to your T Level qualification.</p>').status, 'accepted_with_maths');
  assert.equal(r('<p>T levels</p><p>We are currently not accepting T Levels for this course unless an additional A Level (or equivalent qualification) in Mathematics has been taken.</p>').status, 'accepted_with_maths');
  assert.equal(r('<p>T levels</p><p>For subjects accepted please contact the admissions office. Please note, A-level Maths will be needed alongside T levels in order to be considered for entry.</p>').status, 'accepted_with_maths');
  const salford = r('<dt>T-level</dt><dd>Grade M in one of the following subjects: Design and Development for Engineering and Manufacturing</dd>');
  assert.deepEqual([salford.status, salford.requirement], ['accepted', 'Merit']);
  assert.equal(r('<td>T Level</td><td>Access to HE Diploma</td><td>Not accepted for this course.</td>').status, 'unknown');
  assert.equal(r('<p>T Levels are not accepted for this course.</p>').status, 'not_accepted');
  assert.equal(r('<p>We do not accept T Levels as entry onto this course.</p>').status, 'not_accepted');
});

test('A level offers with a cut-off subject list', () => {
  assert.equal(aLevelRequirement('A levels: ABB including Maths and one of the following subjects.'), 'ABB including Maths and one of the following subjects (list on the course page)');
  assert.equal(aLevelRequirement('A levels: ABB including Maths and one of the following subjects: Physics, Chemistry'), 'ABB including Maths and one of the following subjects: Physics, Chemistry');
});

test('spot-check misses (06/11/2026)', () => {
  const r = (h: string) => read(h);
  assert.equal(r('<p>T Level Distinction in Engineering, Manufacturing, Processing & Control T Level, including grade A in the core component + A in A Level Maths</p>').status, 'accepted_with_maths');
  const merit = r('<p>T-level</p><p>Merit in one of these T-levels. Other T-level subjects are not accepted. Design, Surveying and Planning</p>');
  assert.deepEqual([merit.status, merit.requirement], ['accepted', 'Merit']);
  assert.equal(r('<p>T level Merit overall in Digital Production OR Design and development for engineering and manufacturing. Other subjects may be considered.</p>').status, 'accepted');
  assert.equal(r('<p>T Levels International Baccalaureate – 24 points. We also welcome applications from students taking Level 3 qualifications, which may be considered.</p>').status, 'unknown');
  assert.equal(r('<p>Other relevant T Level subjects may be considered on a case-by-case basis.</p>').status, 'case_by_case');
});

test('maths "still required" after the T Level line; letter grades named', () => {
  assert.equal(read('<p>T-Level</p><p>Distinction T-Level in Design and Development for Engineering and Manufacturing only. GCE A-Level Maths is still required.</p>').status, 'accepted_with_maths');
  assert.equal(read('<p>D overall with grade A* in the core in a Design and Development for Engineering and Manufacturing T Level plus grade A in A level Mathematics.</p>').requirement, 'Distinction');
});

test('requirement hidden behind a qualification drop-down (Imperial)', () => {
  const html = '<select><option value="111">A levels</option><option value="1781370">T Levels</option></select>' +
    '<div class="js-qualification" data-code="111"><p>A*A*A</p></div>' +
    '<div class="js-qualification" data-code="1781370"> <p>This qualification is not accepted for entry to this programme.</p> </div>';
  const r = read(html);
  assert.equal(r.status, 'not_accepted');
  assert.equal(r.quote, 'T Levels: This qualification is not accepted for entry to this programme.');
});

test('saved readings file parses quoted CSV', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { loadReadings } = await import('./assess-courses.ts');
  const f = join(mkdtempSync(join(tmpdir(), 'rd-')), 'r.csv');
  writeFileSync(f, 'ukprn,kis_course_id,kis_mode,status,requirement,quote\n10007783,EEE1,01,accepted,"96–112 UCAS points, incl. maths","T Levels: ""No"" specific subjects, required."\n');
  const r = loadReadings(f).get('10007783|EEE1|1')!;
  assert.deepEqual(r, { status: 'accepted', requirement: '96–112 UCAS points, incl. maths', quote: 'T Levels: "No" specific subjects, required.' });
});

test('top-university shapes (06/11/2026)', () => {
  const surrey = '<summary>T Level</summary><button>More info</button><button>Close</button><p>BEng (Hons) with foundation year:</p><p>T – Level with an overall grade of Pass and a grade of D in the Core Component</p>';
  const r1 = readTLevels(tLevelPassages(pageText(surrey)), { courseTitle: 'Aerospace Engineering' });
  assert.equal(r1.status, 'not_accepted'); // direct entry: T Levels only via the foundation year
  const r2 = readTLevels(tLevelPassages(pageText(surrey)), { courseTitle: 'Aerospace Engineering with Foundation Year' });
  assert.deepEqual([r2.status, r2.requirement], ['accepted', 'Pass']);
  const uel = '<p>T Levels - we do not accept for this course, except for the Foundation Year</p>';
  assert.equal(readTLevels(tLevelPassages(pageText(uel)), { courseTitle: 'Aeronautical Engineering' }).status, 'not_accepted');
  assert.equal(readTLevels(tLevelPassages(pageText(uel)), { courseTitle: 'Aeronautical Engineering with Foundation Year' }).status, 'accepted');
  assert.equal(read('<dt>T levels</dt><dd>Acceptable on its own and combined with other qualifications.</dd>').status, 'accepted');
  assert.equal(read('<p>T levels are not acceptable on its own.</p>').status, 'not_accepted');
  // Content embedded as JSON with < escapes.
  assert.equal(read('<script>{"html":"\\u003cdt\\u003eT Levels\\u003c/dt\\u003e\\u003cdd\\u003eMerit overall\\u003c/dd\\u003e"}</script><div>x</div>').status, 'unknown'); // scripts are still dropped
  assert.equal(read('<div data-x="\\u003cp\\u003eT Levels: Merit\\u003c/p\\u003e"></div>').status, 'accepted');
});

test('Surrey live layout: buttons inline, label line ending in a colon', () => {
  const html = '<div><span>T Level</span> <span>More info</span> <span>Close</span> <span>BEng (Hons) with foundation year:</span></div><p>T – Level with an overall grade of Pass and a grade of D in the Core Component</p>';
  assert.equal(readTLevels(tLevelPassages(pageText(html)), { courseTitle: 'Aerospace Engineering with Foundation Year' }).status, 'accepted');
  assert.equal(readTLevels(tLevelPassages(pageText(html)), { courseTitle: 'Aerospace Engineering' }).status, 'not_accepted');
});

test('A level Maths named in the T Level requirement, even after a full stop', () => {
  const read = (q: string) => readTLevels([q]).status;
  assert.equal(read('T levels Merit Overall in Digital Support Services or Digital Software Development. Alongside A level Maths grade C.'), 'accepted_with_maths');
  assert.equal(read('T Level in Design and Development for Engineering and Manufacturing is considered. Merit overall with B in core component and B in A level Maths.'), 'accepted_with_maths');
  assert.equal(read('Merit at T Level including grade B in A Level Maths.'), 'accepted_with_maths');
  assert.equal(read('T-Level Distinction overall, with grade B in Core and Distinction in the Specialism. plus a grade A in A-level Mathematics.'), 'accepted_with_maths');
  assert.equal(read('T Level: M and A2 Maths and Physics at grade BB'), 'accepted_with_maths');
});

test('not when A level Maths is only an alternative, a choice, or GCSE', () => {
  const read = (q: string) => readTLevels([q]).status;
  assert.equal(read('T level Merit T Level must be completed in a Maths subject or A Level Maths will be required.'), 'accepted');
  assert.equal(read('T level Merit T Level must be completed in a subject that includes Maths components. Alternatively, A Level Maths would be required.'), 'accepted');
  assert.equal(read('T Level Engineering is considered. Merit overall with B in core component and B in A level Maths or Physics.'), 'accepted');
  assert.equal(read('T Levels Merit GCSE grade C/4 in Maths.'), 'accepted');
  assert.equal(read('T Level: Merit. BTEC: DMM. A levels: BBB including A level Maths.'), 'accepted');
});
