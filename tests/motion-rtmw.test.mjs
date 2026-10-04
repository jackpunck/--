import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFlipNchw, decodeSimcc, detectorBoxes, fuseBatchedFlipSimcc, fuseFlipSimcc, mapWholebodyLandmarks, poseCrop, RTMW_TO_BODY_LANDMARKS } from '../public/motion-rtmw.js';

test('RTMW maps supported anatomy without inventing 3D or eye/mouth points', () => {
  const points = Array.from({ length: 133 }, (_, i) => ({ x: i / 200, y: i / 300, score: i === 5 ? 6.7 : .7 }));
  const mapped = mapWholebodyLandmarks(points);
  assert.equal(mapped.length, 33);
  assert.deepEqual(RTMW_TO_BODY_LANDMARKS.slice(23, 33), [11, 12, 13, 14, 15, 16, 19, 22, 17, 20]);
  assert.equal(mapped[1], null); assert.equal(mapped[9], null);
  assert.deepEqual(mapped[11], { x: .025, y: 5 / 300, visibility: 1 });
  assert.equal(points[5].score, 6.7, 'raw response remains unmodified');
  assert.ok(mapped.filter(Boolean).every(point => !('z' in point) && !('presence' in point)));
});

test('RTMW SimCC uses split ratio 2 and minimum raw axis response, preserving scores above one', () => {
  const x = new Float32Array(133 * 576), y = new Float32Array(133 * 768);
  for (let i = 0; i < 133; i++) { x[i * 576 + 288] = 6.5; y[i * 768 + 384] = 7; }
  const points = decodeSimcc(x, y, { x: 100, y: 50, width: 200, height: 400 }, 800, 1000);
  assert.equal(points.length, 133);
  assert.deepEqual(points[0], { x: .25, y: .25, score: 6.5 });
  assert.throws(() => decodeSimcc([], y, {}, 800, 1000), /输出格式/);
});

test('RTMW person crops include the official padding and model aspect ratio', () => {
  assert.deepEqual(poseCrop([100, 100, 200, 300]), { x: 56.25, y: 75, width: 187.5, height: 250 });
  assert.deepEqual(poseCrop([100, 100, 300, 200]), { x: 75, y: -16.666666666666657, width: 250, height: 333.3333333333333 });
  assert.throws(() => poseCrop([20, 10, 5, 10]), /检测框/);
});

test('YOLOX accepts person detections, restores image coordinates, ignores padding and caps people', () => {
  const data = new Float32Array([10, 20, 60, 100, .9, 20, 10, 40, 60, .1, 0, 0, 40, 40, .99, 45, 40, 20, 50, .8]);
  assert.deepEqual(detectorBoxes(data, new BigInt64Array([0n, 0n, 1n, 0n]), .5, 100, 180), [[20, 40, 100, 180]]);
  assert.deepEqual(detectorBoxes(data, undefined, .5, 100, 180, 1), [[0, 0, 80, 80]]);
  assert.deepEqual(detectorBoxes(new Float32Array(0), undefined, 1, 100, 100), []);
});

test('GPU batch keeps original pixels first and flips each channel horizontally without resampling', () => {
  const data = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40, 100, 200, 300, 400]);
  const original = data.slice(), batch = batchFlipNchw(data, 2, 2);
  assert.deepEqual(batch.slice(0, data.length), data);
  assert.deepEqual(batch.slice(data.length), new Float32Array([2, 1, 4, 3, 20, 10, 40, 30, 200, 100, 400, 300]));
  assert.deepEqual(data, original);
  assert.throws(() => batchFlipNchw(data, 0, 2), /输入格式/);
});

test('batched flip fusion and separate original/flip fusion produce exactly the same decoded points', () => {
  const x = Float32Array.from({length: 2 * 133 * 576}, (_, i) => Math.sin(i * .91) * 7);
  const y = Float32Array.from({length: 2 * 133 * 768}, (_, i) => Math.cos(i * .87) * 6);
  const separate = fuseFlipSimcc(x.slice(0, x.length / 2), y.slice(0, y.length / 2), x.slice(x.length / 2), y.slice(y.length / 2));
  const batched = fuseBatchedFlipSimcc(x, y);
  assert.deepEqual(batched, separate);
  const crop = poseCrop([10, 20, 500, 900]);
  assert.deepEqual(decodeSimcc(batched.x, batched.y, crop, 1080, 1920), decodeSimcc(separate.x, separate.y, crop, 1080, 1920));
  assert.throws(() => fuseBatchedFlipSimcc(x.subarray(1), y), /输出格式/);
});
