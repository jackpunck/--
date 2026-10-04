import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../public/motion-worker.js', import.meta.url), 'utf8');
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
