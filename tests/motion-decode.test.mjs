import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectSampleTargets, sourceFrameRate } from '../public/motion-decode.js';
const sample = cts => ({ cts, timescale: 1000 });
const flatten = targets => [...targets].flatMap(([source, list]) => list.map(target => ({ ...target, source }))).sort((a, b) => a.index - b.index);

test('B-frame decode order is mapped using presentation timestamps, not input order', () => {
  const result = flatten(selectSampleTargets([sample(0), sample(200), sample(100), sample(300)], { duration: 0.4, fps: 10 }));
  assert.deepEqual(result.map(item => item.source), [0, 100000, 200000, 300000]);
});
test('edit-list media offset aligns first displayed source frame with time zero', () => {
  const result = flatten(selectSampleTargets([sample(100), sample(300), sample(200)], { duration: 0.3, fps: 10, offset: 100 }));
  assert.deepEqual(result.map(item => item.source), [0, 100000, 200000]);
  assert.deepEqual(result.map(item => item.time), [0, 0.1, 0.2]);
});
test('low-rate sources repeat only the covering source frame, while preserving all target times', () => {
  const result = flatten(selectSampleTargets([sample(0), sample(500)], { duration: 1, fps: 4 }));
  assert.deepEqual(result.map(item => item.source), [0, 0, 500000, 500000]);
  assert.deepEqual(result.map(item => item.time), [0, 0.25, 0.5, 0.75]);
});
test('fractional frame boundaries select the right presentation frame without losing the tail', () => {
  const result = flatten(selectSampleTargets([0, 1000 / 30, 2000 / 30, 100].map(sample), { duration: 0.137, fps: 15 }));
  assert.deepEqual(result.map(item => item.source), [0, 66667, 100000]);
  assert.equal(result.at(-1).time, 2 / 15);
  assert(result.at(-1).time < 0.137);
});
test('source FPS counts unique original presentation frames, not repeated 15 Hz targets', () => {
  const samples = [sample(0), sample(500), sample(500)];
  assert.equal(sourceFrameRate(samples, { duration: 1 }), 2);
  assert.equal(flatten(selectSampleTargets(samples, { duration: 1, fps: 15 })).length, 15);
  assert.equal(sourceFrameRate([sample(100), sample(600)], { duration: 1, offset: 100 }), 2);
  assert.equal(sourceFrameRate([], { duration: 1 }), null);
});
test('all local MP4Box modules and license match the pinned upstream asset manifest', async () => {
  const base = new URL('../public/vendor/mp4box/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base)));
  for (const item of manifest.files) assert.equal(createHash('sha256').update(await readFile(new URL(item.path, base))).digest('hex'), item.sha256, item.path);
});
