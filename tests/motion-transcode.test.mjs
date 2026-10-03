import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { convertMotionVideo, MOTION_TRANSCODE_MAX_BYTES } from '../public/motion-transcode.js';

function mockWorkers(t, { constructorError, postError } = {}) {
  const instances = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  class Worker {
    constructor(url) {
      if (constructorError) throw constructorError;
      this.url = url;
      this.messages = [];
      this.terminations = 0;
      instances.push(this);
    }
    postMessage(message) {
      if (postError) throw postError;
      this.messages.push(message);
    }
    terminate() { this.terminations++; }
    emit(data) { this.onmessage?.({ data }); }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: Worker });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);
    else delete globalThis.Worker;
  });
  return instances;
}

const cameraFile = () => new File(['original video'], 'phone.MOV', { type: 'video/quicktime', lastModified: 1700000000000 });

test('conversion rejects cancelled, empty or oversize input before starting a worker', async t => {
  const workers = mockWorkers(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(convertMotionVideo(cameraFile(), { signal: controller.signal }), { name: 'AbortError' });
  for (const file of [null, { size: 0 }, { size: NaN }, { size: Infinity }, { size: MOTION_TRANSCODE_MAX_BYTES + 1 }]) {
    await assert.rejects(convertMotionVideo(file));
  }
  assert.equal(workers.length, 0);
});

test('successful conversion returns a playable-copy File and closes its worker', async t => {
  const workers = mockWorkers(t), source = cameraFile(), progress = [];
  const pending = convertMotionVideo(source, { onProgress: value => progress.push(value) });
  assert.equal(workers.length, 1);
  const worker = workers[0];
  assert.equal(worker.messages[0].file, source, 'conversion must receive the chosen original File');
  worker.emit({ type: 'progress', progress: 0.6, message: '正在转换视频…' });
  const bytes = Uint8Array.from([0, 1, 2, 3, 255]);
  worker.emit({ type: 'done', bytes: bytes.buffer });
  const converted = await pending;
  assert(converted instanceof File);
  assert.notEqual(converted, source);
  assert.equal(converted.type, 'video/mp4');
  assert.equal(converted.name, 'phone.compatible.mp4');
  assert.equal(converted.lastModified, source.lastModified);
  assert.deepEqual(new Uint8Array(await converted.arrayBuffer()), bytes);
  assert.equal(await source.text(), 'original video', 'conversion must preserve the original');
  assert.deepEqual(progress.at(-1), { stage: 'converting', progress: 0.6, message: '正在转换视频…' });
  assert.equal(worker.terminations, 1);
  const progressCount = progress.length;
  worker.emit({ type: 'progress', progress: 1, message: 'late event' });
  worker.emit({ type: 'error', message: 'late error' });
  assert.equal(progress.length, progressCount, 'finished workers cannot update UI progress');
  assert.equal(worker.terminations, 1);
});

test('worker-reported conversion failures preserve the useful error and terminate', async t => {
  const workers = mockWorkers(t);
  const pending = convertMotionVideo(cameraFile());
  workers[0].emit({ type: 'error', message: '视频没有可解码的画面。' });
  await assert.rejects(pending, /没有可解码的画面/);
  assert.equal(workers[0].terminations, 1);
});

test('worker runtime and unreadable-message errors reject and terminate', async t => {
  const workers = mockWorkers(t);
  const runtimeFailure = convertMotionVideo(cameraFile());
  let prevented = false;
  workers[0].onerror({ preventDefault() { prevented = true; } });
  await assert.rejects(runtimeFailure, /本地视频转换组件/);
  assert.equal(prevented, true);
  assert.equal(workers[0].terminations, 1);
  const messageFailure = convertMotionVideo(cameraFile());
  workers[1].onmessageerror();
  await assert.rejects(messageFailure, /读取本地视频转换结果失败/);
  assert.equal(workers[1].terminations, 1);
});

test('cancelling active conversion terminates the worker and ignores late results', async t => {
  const workers = mockWorkers(t), controller = new AbortController();
  const pending = convertMotionVideo(cameraFile(), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(workers[0].terminations, 1);
  workers[0].emit({ type: 'done', bytes: new ArrayBuffer(1) });
  assert.equal(workers[0].terminations, 1);
});

test('a progress callback exception during startup terminates and rejects', async t => {
  const workers = mockWorkers(t), error = new Error('progress consumer failed');
  await assert.rejects(convertMotionVideo(cameraFile(), { onProgress() { throw error; } }), cause => cause === error);
  assert.equal(workers[0].terminations, 1);
  assert.equal(workers[0].messages.length, 0, 'do not start conversion after setup failed');
});

test('a progress callback exception from a worker update terminates and rejects', async t => {
  const workers = mockWorkers(t), error = new Error('progress consumer failed');
  const pending = convertMotionVideo(cameraFile(), { onProgress(value) { if (value.progress > 0) throw error; } });
  workers[0].emit({ type: 'progress', progress: 0.5 });
  await assert.rejects(pending, cause => cause === error);
  assert.equal(workers[0].terminations, 1);
});

test('failure to send a file terminates the allocated worker', async t => {
  const error = new DOMException('Cannot clone selected file', 'DataCloneError');
  const workers = mockWorkers(t, { postError: error });
  await assert.rejects(convertMotionVideo(cameraFile()), cause => cause === error);
  assert.equal(workers[0].terminations, 1);
});

test('failure to construct a worker rejects without leaking an active operation', async t => {
  const error = new Error('Workers are disabled');
  const workers = mockWorkers(t, { constructorError: error });
  await assert.rejects(convertMotionVideo(cameraFile()), cause => cause === error);
  assert.equal(workers.length, 0);
});

test('conversion timeout terminates a stalled worker', async t => {
  const workers = mockWorkers(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = convertMotionVideo(cameraFile());
  t.mock.timers.tick(10 * 60 * 1000);
  await assert.rejects(pending, /转换超时/);
  assert.equal(workers[0].terminations, 1);
});

test('bundled FFmpeg runtime and decoder match the recorded asset hashes', async () => {
  const base = new URL('../public/vendor/ffmpeg/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
    const expected = manifest.files.find(item => item.path === name);
    assert(expected, `${name} must be listed in the asset manifest`);
    const bytes = await readFile(new URL(name, base));
    assert.equal(bytes.byteLength, expected.size, name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
  }
});
