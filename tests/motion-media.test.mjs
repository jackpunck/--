import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_VIDEO_LIMITS,
  validateVideoFile,
  validateVideoMetadata,
  prepareMotionVideo,
  releasePreparedMotionVideo,
} from '../public/motion-media.js';

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

function installNativeMedia(t, { metadata = { duration: 8, width: 1080, height: 1920 }, holdLoad = false } = {}) {
  const videos = [], createdUrls = [], revokedUrls = [], workers = [];
  class Video extends EventTarget {
    constructor() {
      super();
      this.duration = metadata.duration;
      this.videoWidth = metadata.width;
      this.videoHeight = metadata.height;
      this.readyState = 0;
      this.src = '';
      this.time = 0;
      this.paused = true;
      this.listeners = new Map();
    }
    addEventListener(type, callback, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
      super.addEventListener(type, callback, options);
    }
    removeEventListener(type, callback, options) {
      this.listeners.get(type)?.delete(callback);
      super.removeEventListener(type, callback, options);
    }
    get currentTime() { return this.time; }
    set currentTime(value) {
      this.time = value;
      queueMicrotask(() => { this.readyState = 2; this.dispatchEvent(new Event('seeked')); });
    }
    load() {
      if (!this.src || holdLoad) return;
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('loadedmetadata'));
        queueMicrotask(() => {
          this.readyState = 2;
          this.dispatchEvent(new Event('loadeddata'));
          this.dispatchEvent(new Event('canplay'));
        });
      });
    }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  replaceGlobal(t, 'document', { createElement(tag) {
    assert.equal(tag, 'video');
    const video = new Video();
    videos.push(video);
    return video;
  } });
  replaceGlobal(t, 'Worker', class { constructor() { workers.push(true); throw new Error('A natively decoded clip must not start a software decoder'); } });
  t.mock.method(URL, 'createObjectURL', () => {
    const url = `blob:motion-test-${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', url => revokedUrls.push(url));
  return { videos, workers, createdUrls, revokedUrls, assertReleased() {
    assert.deepEqual([...revokedUrls].sort(), [...createdUrls].sort(), 'temporary video URLs must be released');
    for (const video of videos) {
      assert.equal(video.src, '', 'the decoder must not retain the selected video');
      assert.equal(video.paused, true);
      assert.equal([...video.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0), 0, 'media event listeners must be removed');
    }
  } };
}

test('intake accepts mainstream camera and downloaded video containers', () => {
  for (const extension of ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', '3gp', '3g2', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts', 'ogv', 'wmv', 'flv']) {
    assert.doesNotThrow(() => validateVideoFile({ name: `camera.${extension.toUpperCase()}`, type: '', size: 1024 }), extension);
    assert.doesNotThrow(() => validateVideoFile({ name: `camera.${extension}`, type: 'application/octet-stream', size: 1024 }), extension);
  }
  for (const type of ['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo', 'video/3gpp', 'video/3gpp2', 'video/mpeg', 'video/mp2t', 'video/vnd.dlna.mpeg-tts', 'video/ogg', 'video/x-ms-wmv', 'video/x-flv']) {
    assert.doesNotThrow(() => validateVideoFile({ name: 'camera-recording', type, size: 1024 }), type);
  }
});

test('renaming an image or unsupported document does not make it an accepted video', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/heic', 'application/pdf']) {
    assert.throws(() => validateVideoFile({ name: 'camera.mp4', type, size: 1024 }), type);
  }
  assert.throws(() => validateVideoFile({ name: 'document.txt', type: 'text/plain', size: 1024 }));
  assert.throws(() => validateVideoFile({ name: 'camera.jpg', type: '', size: 1024 }));
});

test('new formats preserve upload limits and reject invalid sizes', () => {
  assert.equal(MOTION_VIDEO_LIMITS.maxBytes, 200 * 1024 * 1024);
  assert.equal(MOTION_VIDEO_LIMITS.maxDuration, 120);
  assert.doesNotThrow(() => validateVideoFile({ name: 'camera.mov', size: MOTION_VIDEO_LIMITS.maxBytes }));
  for (const size of [0, -1, NaN, Infinity, MOTION_VIDEO_LIMITS.maxBytes + 1]) {
    assert.throws(() => validateVideoFile({ name: 'camera.mov', size }), String(size));
  }
  assert.throws(() => validateVideoFile(null));
});

test('metadata accepts portrait phone video and rejects unreadable or excessive footage', () => {
  assert.doesNotThrow(() => validateVideoMetadata({ duration: 120, width: 1080, height: 1920 }));
  for (const metadata of [
    { duration: 120.001, width: 1920, height: 1080 },
    { duration: Infinity, width: 1920, height: 1080 },
    { duration: 0, width: 1920, height: 1080 },
    { duration: 12, width: 0, height: 1080 },
    { duration: 12, width: 1920, height: 0 },
    { duration: 12, width: NaN, height: 1080 },
  ]) {
    assert.throws(() => validateVideoMetadata(metadata));
  }
});

test('pre-cancelled preparation opens no video, URL or worker', async t => {
  const controller = new AbortController();
  controller.abort();
  const calls = [];
  t.mock.method(URL, 'createObjectURL', () => { calls.push('object URL'); throw new Error('Unexpected object URL'); });
  replaceGlobal(t, 'document', { createElement() { calls.push('video'); throw new Error('Unexpected video'); } });
  replaceGlobal(t, 'Worker', class { constructor() { calls.push('worker'); throw new Error('Unexpected worker'); } });
  await assert.rejects(prepareMotionVideo({ name: 'camera.mov', size: 1024 }, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(calls, []);
});

test('natively supported phone video stays intact and can be prepared again after release', async t => {
  const media = installNativeMedia(t);
  const file = new File(['video fixture'], 'phone.MOV', { type: 'video/quicktime' });
  t.after(() => releasePreparedMotionVideo(file));
  const result = await prepareMotionVideo(file);
  assert.equal(result.file, file);
  assert.equal(result.originalFile, file);
  assert.equal(result.mode, 'native');
  assert.deepEqual(result.metadata, { duration: 8, width: 1080, height: 1920 });
  media.assertReleased();
  const opened = media.videos.length;
  const repeated = await prepareMotionVideo(file);
  assert.equal(repeated.file, file);
  assert.equal(media.videos.length, opened, 'repeat preparation should reuse a completed result');
  releasePreparedMotionVideo(file);
  const preparedAgain = await prepareMotionVideo(file);
  assert.equal(preparedAgain.file, file);
  assert(media.videos.length > opened, 'release must evict the cached result');
  assert.deepEqual(media.workers, []);
  media.assertReleased();
});

test('audio-track-only browser success falls back to source images without creating another video', async t => {
  const media = installNativeMedia(t, { metadata: { duration: 13.003333, width: 0, height: 0 } });
  const workers = [];
  globalThis.Worker = class {
    constructor(url) { this.url = String(url); this.terminated = 0; workers.push(this); }
    postMessage(message) {
      this.message = message;
      queueMicrotask(() => this.onmessage({ data: { type: 'done', metadata: { duration: 13.005, width: 1920, height: 1080, sourceFps: 59.98 }, frames: [{ time: 0, width: 1280, height: 720, bytes: new Uint8Array([255, 216, 255, 217]) }] } }));
    }
    terminate() { this.terminated++; }
  };
  const original = new File(['hevc video fixture'], 'phone.mov', { type: 'video/quicktime' });
  t.after(() => releasePreparedMotionVideo(original));
  const prepared = await prepareMotionVideo(original);
  assert.equal(prepared.mode, 'software');
  assert.equal(prepared.file, original);
  assert.equal(prepared.originalFile, original);
  assert.equal(prepared.poster.type, 'image/jpeg');
  assert.deepEqual(prepared.metadata, { duration: 13.005, width: 1920, height: 1080, sourceFps: 59.98 });
  assert.equal(workers.length, 1);
  assert.equal(workers[0].message.file, original);
  assert.equal(workers[0].terminated, 1);
  assert.equal((await prepareMotionVideo(original)), prepared, 'analysis and evidence must share source metadata');
  assert.equal(workers.length, 1);
  assert.equal(media.createdUrls.length, 1, 'only the native capability probe opens a temporary media URL');
  media.assertReleased();
});

test('cancelling a pending browser read releases its video and object URL', async t => {
  const media = installNativeMedia(t, { holdLoad: true });
  const controller = new AbortController();
  const file = new File(['video fixture'], 'phone.mov', { type: 'video/quicktime' });
  t.after(() => releasePreparedMotionVideo(file));
  const pending = prepareMotionVideo(file, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(media.videos.length, 1);
  assert.deepEqual(media.workers, [], 'cancellation must not trigger a fallback software decoder');
  media.assertReleased();
});

test('known excessive duration stops preparation before fallback decoding and releases browser resources', async t => {
  const media = installNativeMedia(t, { metadata: { duration: 121, width: 1080, height: 1920 } });
  const file = new File(['video fixture'], 'phone.mov', { type: 'video/quicktime' });
  t.after(() => releasePreparedMotionVideo(file));
  await assert.rejects(prepareMotionVideo(file), /120/);
  assert.deepEqual(media.workers, [], 'software decoding cannot make an overlong clip eligible');
  media.assertReleased();
});
