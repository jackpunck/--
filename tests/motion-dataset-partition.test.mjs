import test from 'node:test';
import assert from 'node:assert/strict';
import {CALIBRATION_IDS, partitionFrozenDataset} from '../scripts/motion-dataset-partition.mjs';

const fixture = () => ({frozenAt: '2026-10-03T00:00:00Z', items: [
  ...CALIBRATION_IDS.map((id, index) => ({id, sourceGroup: 'mydeadlift', subject: '03', qualityLabel: index ? 'author_bad' : 'author_good', exercise: 'barbell-deadlift', outputSha256: String(index).repeat(64)})),
  ...Array.from({length: 45}, (_, index) => ({id: `heldout-${index}`, sourceGroup: 'other', subject: String(index), qualityLabel: index < 42 ? 'author_good' : 'demonstration_unverified', exercise: 'bodyweight-squat', outputSha256: 'a'.repeat(64)})),
]});

test('frozen split keeps every source item and seal exactly once without selecting predictions', () => {
  const source = fixture(), before = structuredClone(source), split = partitionFrozenDataset(source, 'b'.repeat(64), 'fixed');
  assert.deepEqual(source, before);
  assert.equal(split.holdout.items.length, 45);
  assert.equal(split.calibration.items.length, 3);
  assert.deepEqual(split.calibration.items.map(item => item.id), CALIBRATION_IDS);
  assert.deepEqual(new Set([...split.holdout.items, ...split.calibration.items].map(item => item.id)), new Set(source.items.map(item => item.id)));
  for (const item of [...split.holdout.items, ...split.calibration.items]) assert.deepEqual(item, source.items.find(row => row.id === item.id));
  assert.equal(split.holdout.partition, 'holdout');
  assert.equal(split.calibration.partition, 'calibration');
  assert.equal(split.holdout.sourceManifestSha256, 'b'.repeat(64));
});

test('incorrect source, missing named calibration clip and subject leakage are rejected', () => {
  const missing = fixture(); missing.items[0].id = 'replacement';
  assert.throws(() => partitionFrozenDataset(missing), /predeclared/);
  const duplicate = fixture(); duplicate.items[3].id = duplicate.items[4].id;
  assert.throws(() => partitionFrozenDataset(duplicate), /unique original/);
  for (const subject of ['01', '03']) {
    const contaminated = fixture(); Object.assign(contaminated.items[3], {sourceGroup: 'mydeadlift', subject});
    assert.throws(() => partitionFrozenDataset(contaminated), /leaked/);
  }
});
