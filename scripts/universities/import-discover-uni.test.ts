// Unit tests for the Discover Uni importer's pure functions.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { displayUniName, matchProvider, parseDfeList, subjectGroup } from './import-discover-uni.ts';

test('subject groups from CAH codes, engineering first', () => {
  assert.equal(subjectGroup(['CAH11-01-01', 'CAH10-01-08']), 'engineering');
  assert.equal(subjectGroup(['CAH11-01-01']), 'computing');
  assert.equal(subjectGroup(['CAH07-02-01']), null); // chemistry is out of scope
});

test('display names', () => {
  assert.equal(displayUniName(['UNIVERSITY OF NOTTINGHAM, THE', 'UNIVERSITY OF NOTTINGHAM, THE']), 'University of Nottingham');
  assert.equal(displayUniName(['', 'The University of Leeds']), 'University of Leeds');
  assert.equal(displayUniName(['University of Kent (Part of London and South East University Group)']), 'University of Kent');
  assert.equal(displayUniName(['University of East London Higher Education Corporation']), 'University of East London');
});

test('DfE list names match one provider or none', () => {
  const providers = [
    { ukprn: '1', names: ['University of Northumbria at Newcastle'] },
    { ukprn: '2', names: ["King's College London"] },
    { ukprn: '3', names: ['Barnsley College'] },
    { ukprn: '4', names: ['Leeds City College'] },
    { ukprn: '5', names: ['Leeds Beckett University'] },
  ];
  assert.equal(matchProvider('Northumbria University', providers), '1');
  assert.equal(matchProvider('King’s College London, University of London', providers), '2');
  assert.equal(matchProvider('Barnsley College University Centre', providers), '3');
  assert.equal(matchProvider('Leeds University', providers), null); // two providers fit "leeds"
  assert.equal(matchProvider('Royal Academy of Music', providers), null);
});

test('DfE list parsing', () => {
  assert.deepEqual(parseDfeList('<div class="govspeak"><ul><li>Aston University</li><li>Bath Spa &amp; Co</li></ul></div>'), ['Aston University', 'Bath Spa & Co']);
});
