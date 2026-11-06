import assert from 'node:assert/strict';
import { test } from 'node:test';
import { competitionRank, computeRankings, satisfaction, tefRating, type CourseInput } from './rankings.ts';

test('competitionRank shares equal scores and skips the next place', () => {
  const r = competitionRank(new Map([['a', 2], ['b', 1], ['c', 1], ['d', 0]]));
  assert.deepEqual([...r].map(([k, v]) => [k, v.rank, v.tied, v.of]), [
    ['a', 1, false, 4],
    ['b', 2, true, 4],
    ['c', 2, true, 4],
    ['d', 4, false, 4],
  ]);
});

test('satisfaction is the mean of at least four NSS themes', () => {
  assert.equal(satisfaction({ T1: '90', T2: '80', T3: '70', T4: '60', T5: '', T6: '', T7: '' }), 75);
  assert.equal(satisfaction({ T1: '90', T2: '80', T3: '70' }), null);
});

test('tefRating keeps the four official ratings only', () => {
  assert.equal(tefRating('Requires Improvement'), 'Requires improvement');
  assert.equal(tefRating('Gold'), 'Gold');
  assert.equal(tefRating('Platinum'), null);
});

const course = (ukprn: string, cah: string, v: number, pop = 100): CourseInput => ({
  ukprn,
  subjects: [cah],
  m: { satisfaction: 70 + v, continuation: 85 + v, workStudy: 80 + v, salary: 25000 + v * 500, pop: { satisfaction: pop, continuation: pop, workStudy: pop, salary: pop } },
});

test('ranks providers within a subject and overall, best first', () => {
  const subjects = ['CAH10-01-08', 'CAH10-01-02', 'CAH11-01-01', 'CAH09-01-01', 'CAH07-01-01'];
  const ukprns = ['1', '2', '3', '4', '5', '6'];
  const courses = subjects.flatMap((s) => ukprns.map((u, i) => course(u, s, 10 - i * 2)));
  const { subject, overall } = computeRankings(courses);
  assert.equal(subject.get('1|CAH10-01-08')?.rank, 1);
  assert.equal(subject.get('6|CAH10-01-08')?.rank, 6);
  assert.equal(subject.get('6|CAH10-01-08')?.of, 6);
  assert.equal(overall.get('1')?.rank, 1);
  assert.equal(overall.size, 6);
});

test('no subject rank when fewer than five providers teach it', () => {
  const courses = ['1', '2', '3', '4'].map((u, i) => course(u, 'CAH10-01-05', i));
  assert.equal(computeRankings(courses).subject.size, 0);
});

test('a tiny group is pulled toward the subject average', () => {
  const big = ['1', '2', '3', '4', '5'].map((u, i) => course(u, 'CAH10-01-08', i, 200));
  const tiny = course('9', 'CAH10-01-08', 20, 3); // best raw scores, 3 students
  const huge = course('8', 'CAH10-01-08', 8, 500);
  const { subject } = computeRankings([...big, tiny, huge]);
  assert.ok(subject.get('8|CAH10-01-08')!.rank < subject.get('9|CAH10-01-08')!.rank);
});
