import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {getMotionPoseModel, MOTION_POSE_MODEL} from '../public/motion-models.js';

const workerSource = await readFile(new URL('../public/motion-worker.js', import.meta.url), 'utf8');
function initializingWorker({failYolo = false} = {}) {
  const messages = [], starts = [], imports = [];
  const start = model => async options => {
    starts.push({model, delegate: options.delegate});
    if (model === 'yolo26' && failYolo) throw new Error('YOLO fixture initialization failed');
    return {delegate: 'CPU'};
  };
  const modules = {
    './motion-models.js': {getMotionPoseModel},
    './motion-tracking.js': {validateTargetPoint: point => point, createSubjectTracker: () => ({})},
    './motion-mediapipe.js': {createMediaPipe: start('mediapipe-full')},
    './motion-rtmw.js': {createRtmw: start('rtmw')},
    './motion-yolo26.js': {createYolo26: start('yolo26')},
  };
  const context = vm.createContext({self: {postMessage: value => messages.push(value)}, performance,
    OffscreenCanvas: class {}, runtime: {async importModule(specifier) {
      imports.push(specifier);
      assert(modules[specifier], `Unexpected worker import: ${specifier}`);
      return modules[specifier];
    }},
  });
  // Keep the actual worker routing and error handling; substitute only module
  // loading so Node does not start browser GPU/MediaPipe sessions in this test.
  vm.runInContext(workerSource.replaceAll('import(', 'runtime.importModule('), context);
  return {messages, starts, imports, init: model => context.self.onmessage({data: {id: 1, type: 'init', model, delegate: 'CPU'}})};
}

test('worker starts only the selected pose model and preserves the standard default', async () => {
  assert.equal(MOTION_POSE_MODEL.id, 'mediapipe-full');
  for (const selected of [undefined, 'rtmw', 'mediapipe-full', 'yolo26']) {
    const h = initializingWorker(), expected = selected ?? 'mediapipe-full';
    await h.init(selected);
    assert.deepEqual(h.starts, [{model: expected, delegate: 'CPU'}]);
    assert.equal(h.messages.at(-1).modelVersion, getMotionPoseModel(expected).version);
    if (expected === 'yolo26') {
      assert(!h.imports.includes('./motion-rtmw.js'));
      assert(!h.imports.includes('./motion-mediapipe.js'));
    }
  }
});

test('YOLO initialization failure is reported without loading a different skeleton model', async () => {
  const h = initializingWorker({failYolo: true});
  await h.init('yolo26');
  assert.deepEqual(h.starts, [{model: 'yolo26', delegate: 'CPU'}]);
  assert.match(h.messages.at(-1).error, /YOLO fixture initialization failed/);
  assert(!h.imports.includes('./motion-rtmw.js'));
  assert(!h.imports.includes('./motion-mediapipe.js'));
});
function worker() {
  const inferences = [], trackingTimes = [];
  const context = vm.createContext({self: {}, performance, runtime: {
    pose: {async detect(image) { inferences.push(image); return {landmarks: [[{x: image.x}]], wholebodyLandmarks: [[{x: image.x, score: 2}]]}; }},
    tracker: {update(_poses, time) { trackingTimes.push(time); return {index: 0, subjectTracking: {status: 'locked'}}; }},
  }});
  vm.runInContext(workerSource, context);
  vm.runInContext('pose = runtime.pose; tracker = runtime.tracker;', context);
  return {context, analyze: vm.runInContext('analyzeFrame', context), inferences, trackingTimes};
}

test('low-FPS repeated decoded pixels need one inference and retain every sampling timestamp', async () => {
  const {analyze, inferences, trackingTimes} = worker(), image = {x: .4};
  const first = await analyze(image, 0, 0);
  const second = await analyze(image, 1000 / 15, 0);
  const third = await analyze(image, 2000 / 15, 0);
  assert.equal(inferences.length, 1);
  assert.deepEqual(trackingTimes, [0, 1 / 15, 2 / 15]);
  assert.deepEqual(second.wholebodyLandmarks, first.wholebodyLandmarks);
  assert.deepEqual(third.landmarks, first.landmarks);
  assert.equal(third.personCount, 1);
  assert.equal(third.multiPersonCheck, true);
});

test('new source timestamp, new image or missing timestamp cannot reuse an old prediction', async () => {
  const {analyze, inferences} = worker(), image = {x: .4};
  await analyze(image, 0, 0);
  image.x = .7;
  assert.equal((await analyze(image, 100, .1)).wholebodyLandmarks[0].x, .7, 'decoder repainted the same canvas');
  await analyze({x: .8}, 200, .1);
  await analyze(image, 300);
  await analyze(image, 400);
  await analyze(image, 500, .1);
  assert.equal(inferences.length, 6);
});

test('software worker forwards its sample rate and retains real frame and preview times', async () => {
  const {context, trackingTimes} = worker(), messages = [];
  context.self.postMessage = value => messages.push(value);
  context.runtime.source = {close() {}};
  context.runtime.decoder = {async decodePreparedMotion(_source, onFrame, options) {
    assert.equal(options.sampleFps, 7.5);
    assert.equal(options.asyncInference, true);
    await onFrame({x: .4}, {time: 1 / 7.5});
    options.onPreview({time: .4, bytes: new Uint8Array(4), index: 1});
    return {previewFps: 2.5};
  }};
  vm.runInContext('source = runtime.source; sourceDecoder = runtime.decoder;', context);
  await context.self.onmessage({data: {id: 1, type: 'decode-source', options: {sampleFps: 7.5}}});
  assert.deepEqual(trackingTimes, [1 / 7.5]);
  assert.equal(messages.find(value => value.type === 'frame-result').frame.time, 1 / 7.5);
  assert.equal(messages.find(value => value.type === 'preview-frame').frame.time, .4);
  assert.equal(messages.at(-1).timing.previewFps, 2.5);
});
