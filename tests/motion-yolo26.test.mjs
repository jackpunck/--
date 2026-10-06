import test from 'node:test';
import assert from 'node:assert/strict';
import { createYolo26, decodeYolo26Pose, mapYolo26Landmarks, yolo26Letterbox, yolo26RgbaToNchw, YOLO26_TO_BODY_LANDMARKS } from '../public/motion-yolo26.js';

function output(rows) {
  const data = new Float32Array(300 * 57);
  rows.forEach((row, index) => data.set(row, index * 57));
  return { dims: [1, 300, 57], data };
}

function person({ box = [160, 80, 480, 560], score = .9, label = 0, points } = {}) {
  return [...box, score, label, ...(points || Array.from({ length: 17 }, () => [320, 320, .8])).flat()];
}

function near(actual, expected, epsilon = 1e-6) { assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`); }

test('YOLO26 preprocessing preserves RGB channels and converts RGBA into normalized NCHW', () => {
  const input = new Uint8ClampedArray([255, 128, 0, 255, 0, 64, 255, 17]);
  const converted = yolo26RgbaToNchw(input, 2, 1);
  assert.deepEqual(converted, new Float32Array([1, 0, 128 / 255, 64 / 255, 0, 1]));
  assert.deepEqual(Array.from(input), [255, 128, 0, 255, 0, 64, 255, 17]);
  assert.throws(() => yolo26RgbaToNchw(input, 0, 1), /像素格式/);
  assert.throws(() => yolo26RgbaToNchw(input.subarray(1), 2, 1), /像素格式/);
});

test('YOLO26 centered letterboxing retains exact resize dimensions for portrait, landscape and odd padding', () => {
  assert.deepEqual(yolo26Letterbox(1920, 1080), { width: 1920, height: 1080, size: 640, resizedWidth: 640,
    resizedHeight: 360, left: 0, top: 140, scaleX: 1 / 3, scaleY: 1 / 3 });
  assert.deepEqual(yolo26Letterbox(720, 1280), { width: 720, height: 1280, size: 640, resizedWidth: 360,
    resizedHeight: 640, left: 140, top: 0, scaleX: .5, scaleY: .5 });
  const odd = yolo26Letterbox(1920, 1083);
  assert.equal(odd.resizedHeight, 361); assert.equal(odd.top, 139);
  // Both Python half-to-even cases must match the exported model's preprocessing.
  assert.equal(yolo26Letterbox(1280, 725).resizedHeight, 362);
  assert.equal(yolo26Letterbox(1280, 727).resizedHeight, 364);
  assert.throws(() => yolo26Letterbox(NaN, 100), /尺寸/);
  assert.throws(() => yolo26Letterbox(100, 0), /尺寸/);
});

test('YOLO26 restores body points and boxes to original normalized image coordinates', () => {
  const transform = yolo26Letterbox(1920, 1083);
  const x = .3, y = .7;
  const px = transform.left + x * transform.resizedWidth, py = transform.top + y * transform.resizedHeight;
  const box = [0, transform.top, 640, transform.top + transform.resizedHeight];
  const result = decodeYolo26Pose(output([person({ box, points: Array.from({ length: 17 }, () => [px, py, .8]) })]), transform);
  assert.deepEqual(result.detectionBoxes, [[0, 0, 1, 1]]);
  assert.equal(result.landmarks.length, 1); assert.equal(result.landmarks[0].length, 33);
  near(result.landmarks[0][11].x, x); near(result.landmarks[0][11].y, y);
  near(result.landmarks[0][11].visibility, .8);
  assert.equal(result.cocoLandmarks[0].length, 17);
  assert.ok(result.landmarks[0].filter(Boolean).every(point => !('z' in point) && !('presence' in point)));
});

test('YOLO26 maps all COCO points to matching anatomy without manufacturing fingers or feet', () => {
  const points = Array.from({ length: 17 }, (_, index) => ({ x: index / 20, y: index / 30, score: .8 }));
  const mapped = mapYolo26Landmarks(points);
  assert.equal(mapped.filter(Boolean).length, 17);
  assert.deepEqual(YOLO26_TO_BODY_LANDMARKS.slice(23), [11, 12, 13, 14, 15, 16, null, null, null, null]);
  assert.deepEqual(mapped[2], { x: .05, y: 1 / 30, visibility: .8 });
  assert.deepEqual(mapped[28], { x: .8, y: 16 / 30, visibility: .8 });
  for (const index of [1, 3, 4, 6, 9, 10, 17, 18, 19, 20, 21, 22, 29, 30, 31, 32]) assert.equal(mapped[index], null);
  assert.throws(() => mapYolo26Landmarks(points.slice(1)), /关键点格式/);
});

test('YOLO26 rejects low or invalid keypoint confidence but does not clamp offscreen joints into visible evidence', () => {
  const points = Array.from({ length: 17 }, () => [320, 320, .8]);
  points[5] = [100, 200, .1];
  points[6] = [NaN, 200, .9];
  points[7] = [-20, 200, .9];
  points[8] = [200, 200, 1.2];
  const result = decodeYolo26Pose(output([person({ points })]), yolo26Letterbox(640, 640));
  assert.equal(result.landmarks[0][11], null); assert.equal(result.landmarks[0][12], null);
  assert.equal(result.landmarks[0][14], null); near(result.landmarks[0][13].x, -20 / 640);
  near(result.cocoLandmarks[0][5].score, .1, 1e-7);
  assert.equal(result.cocoLandmarks[0][6], null);
  near(points[5][2], .1, 1e-7);
});

test('YOLO26 filters invalid/person confidence detections, sorts and limits people without a second NMS', () => {
  const rows = [person({ score: .31 }), person({ score: .99, label: 1 }), person({ score: .29 }),
    person({ score: NaN }), person({ score: .99, box: [500, 10, 100, 600] }),
    person({ score: .99, box: [NaN, 10, 500, 600] }), person({ score: 1.2 }),
    person({ score: .95 }), person({ score: .85 }), person({ score: .7 }), person({ score: .6 })];
  const result = decodeYolo26Pose(output(rows), yolo26Letterbox(640, 640), { maxPeople: 3 });
  assert.equal(result.landmarks.length, 3);
  assert.deepEqual(result.detectionScores, [.95, .85, .7].map(Math.fround));
  assert.deepEqual(result.detectionBoxes, Array.from({ length: 3 }, () => [.25, .125, .75, .875]),
    'overlapping end-to-end detections are retained, without another NMS');
});

test('YOLO26 clips detection rectangles and rejects rectangles wholly in letterbox padding', () => {
  const result = decodeYolo26Pose(output([person({ box: [-50, 0, 700, 640] }), person({ box: [50, 20, 550, 100] })]), yolo26Letterbox(1280, 720));
  assert.deepEqual(result.detectionBoxes, [[0, 0, 1, 1]]);
  assert.deepEqual(decodeYolo26Pose(output([]), yolo26Letterbox(640, 640)),
    { landmarks: [], cocoLandmarks: [], detectionBoxes: [], detectionScores: [] });
});

test('YOLO26 fails clearly for raw YOLO outputs, other models, corrupt buffers and invalid options', () => {
  const valid = output([]), transform = yolo26Letterbox(640, 640);
  for (const dims of [[1, 56, 8400], [1, 300, 6], [2, 300, 57], [300, 57], [1, 100, 57]]) {
    assert.throws(() => decodeYolo26Pose({ ...valid, dims }, transform), /输出格式/);
  }
  assert.throws(() => decodeYolo26Pose({ ...valid, data: valid.data.subarray(1) }, transform), /输出格式/);
  assert.throws(() => decodeYolo26Pose(valid, { ...transform, scaleX: 0 }), /图像变换/);
  assert.throws(() => decodeYolo26Pose(valid, transform, { minConfidence: NaN }), /置信度/);
  assert.throws(() => decodeYolo26Pose(valid, transform, { minKeypointConfidence: 2 }), /置信度/);
  assert.throws(() => decodeYolo26Pose(valid, transform, { maxPeople: 0 }), /人数限制/);
});

test('YOLO26 validates delegate before loading a model', async () => {
  await assert.rejects(createYolo26({ delegate: 'auto' }), /推理设备/);
  await assert.rejects(createYolo26({ delegate: 'GPU' }), /WebGPU/);
});
