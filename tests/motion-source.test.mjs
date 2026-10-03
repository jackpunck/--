import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectMotionSource, readMotionSourceFrames } from '../public/motion-source.js';

const file = () => new File(['original camera bytes'], 'phone.mov', { type: 'video/quicktime' });
const bytes = new Uint8Array([255, 216, 255, 217]);
const metadata = { duration: 2.01, width: 180, height: 320, sourceFps: 29.97 };

function installWorker(t, onPost = () => {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const workers = [];
  class Worker {
    constructor(url) { this.url = String(url); this.messages = []; this.terminated = 0; workers.push(this); }
    postMessage(message) { this.messages.push(message); onPost(this, message); }
    terminate() { this.terminated++; }
    emit(data) { this.onmessage?.({ data }); }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: Worker });
  t.after(() => previous ? Object.defineProperty(globalThis, 'Worker', previous) : delete globalThis.Worker);
  return workers;
}

test('source inspection sends the original File and releases the decoder after its poster', async t => {
  const original = file();
  const workers = installWorker(t, worker => queueMicrotask(() => worker.emit({ type: 'done', metadata, frames: [{ time: 0, width: 180, height: 320, bytes }] })));
  const result = await inspectMotionSource(original);
  assert.deepEqual(result.metadata, metadata);
  assert.equal(result.poster.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await result.poster.arrayBuffer()), bytes);
  assert.equal(workers[0].messages[0].file, original);
  assert.equal(workers[0].messages[0].type, 'inspect');
  assert.match(workers[0].url, /motion-source-worker\.js/);
  assert.equal(workers[0].terminated, 1);
});

test('selected images retain requested times, geometry and exact JPEG bytes', async t => {
  const original = file(), times = [0, 7 / 15, 29 / 15];
  const workers = installWorker(t, (worker, message) => queueMicrotask(() => worker.emit({ type: 'done', metadata, frames: message.times.map(time => ({ time, width: 180, height: 320, bytes })) })));
  const frames = await readMotionSourceFrames(original, times, { maxDimension: 640 });
  assert.deepEqual(frames.map(frame => frame.time), times);
  assert(frames.every(frame => frame.width === 180 && frame.height === 320 && frame.blob.type === 'image/jpeg' && frame.blob.size === bytes.length));
  assert.equal(workers[0].messages[0].file, original);
  assert.equal(workers[0].messages[0].maxDimension, 640);
  assert.equal(workers[0].terminated, 1);
});

test('cancelled or invalid inputs never allocate a decoder worker', async t => {
  const workers = installWorker(t), controller = new AbortController();
  controller.abort();
  await assert.rejects(inspectMotionSource(file(), { signal: controller.signal }), { name: 'AbortError' });
  for (const invalid of [null, { size: 0 }, { size: -1 }, { size: NaN }, { size: 200 * 1024 * 1024 + 1 }]) {
    await assert.rejects(inspectMotionSource(invalid), /200 MB/);
  }
  assert.equal(workers.length, 0);
});

test('cancellation during decoding terminates the worker and ignores late results', async t => {
  const workers = installWorker(t), controller = new AbortController(), progress = [];
  const pending = readMotionSourceFrames(file(), [0], { signal: controller.signal, onProgress: value => progress.push(value) });
  workers[0].emit({ type: 'progress', progress: .3, message: 'Reading source' });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const before = progress.length;
  workers[0].emit({ type: 'progress', progress: .9 });
  workers[0].emit({ type: 'done', metadata, frames: [{ time: 0, bytes }] });
  assert.equal(progress.length, before);
  assert.equal(workers[0].terminated, 1);
});

test('a progress callback can cancel before the original file is posted', async t => {
  const workers = installWorker(t), controller = new AbortController();
  await assert.rejects(inspectMotionSource(file(), { signal: controller.signal, onProgress: () => controller.abort() }), { name: 'AbortError' });
  assert.equal(workers[0].messages.length, 0);
  assert.equal(workers[0].terminated, 1);
});

test('worker and consumer failures release the decoder rather than leaving it busy', async t => {
  const workers = installWorker(t);
  const sourceFailure = inspectMotionSource(file());
  workers[0].emit({ type: 'error', message: '这个文件中没有视频画面。' });
  await assert.rejects(sourceFailure, /没有视频画面/);
  assert.equal(workers[0].terminated, 1);
  const callbackFailure = inspectMotionSource(file(), { onProgress: value => { if (value.progress > 0) throw new Error('Consumer stopped'); } });
  workers[1].emit({ type: 'progress', progress: .2 });
  await assert.rejects(callbackFailure, /Consumer stopped/);
  assert.equal(workers[1].terminated, 1);
  const runtimeFailure = inspectMotionSource(file());
  let prevented = false;
  workers[2].onerror({ preventDefault() { prevented = true; } });
  await assert.rejects(runtimeFailure, /无法运行/);
  assert(prevented);
  assert.equal(workers[2].terminated, 1);
});

test('an inspection without a readable image is rejected after cleanup', async t => {
  const workers = installWorker(t, worker => queueMicrotask(() => worker.emit({ type: 'done', metadata, frames: [] })));
  await assert.rejects(inspectMotionSource(file()), /没有可读取的画面/);
  assert.equal(workers[0].terminated, 1);
});

test('file transfer failure releases an allocated worker', async t => {
  const failure = new DOMException('Cannot clone selected file', 'DataCloneError');
  const workers = installWorker(t, () => { throw failure; });
  await assert.rejects(inspectMotionSource(file()), error => error === failure);
  assert.equal(workers[0].terminated, 1);
});

test('worker creation failure and initial progress failure reject immediately', async t => {
  const workers = installWorker(t);
  await assert.rejects(inspectMotionSource(file(), { onProgress() { throw new Error('Stopped before decode'); } }), /Stopped before decode/);
  assert.equal(workers[0].messages.length, 0);
  assert.equal(workers[0].terminated, 1);
  globalThis.Worker = class { constructor() { throw new Error('Workers disabled'); } };
  await assert.rejects(inspectMotionSource(file()), /Workers disabled/);
});

test('a stalled decoder times out and is terminated', async t => {
  const workers = installWorker(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = inspectMotionSource(file());
  t.mock.timers.tick(10 * 60 * 1000);
  await assert.rejects(pending, /解码超时/);
  assert.equal(workers[0].terminated, 1);
});

test('bundled FFmpeg decoder matches the recorded local asset hashes', async () => {
  const base = new URL('../public/vendor/ffmpeg/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
    const expected = manifest.files.find(item => item.path === name);
    assert(expected, `${name} must be listed in the asset manifest`);
    const data = await readFile(new URL(name, base));
    assert.equal(data.byteLength, expected.size, name);
    assert.equal(createHash('sha256').update(data).digest('hex'), expected.sha256, name);
  }
});
