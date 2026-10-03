import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateVideoFile, validateVideoMetadata, sampleVideoTimes, browserSeekTime, scaledVideoSize, analyzeVideo } from '../public/motion-video.js';

test('video intake rejects empty, oversize, unsupported and excessive-duration files', () => {
  assert.throws(() => validateVideoFile({ name: 'clip.mp4', size: 0 }));
  assert.throws(() => validateVideoFile({ name: 'clip.mp4', size: 200 * 1024 * 1024 + 1 }), /200 MB/);
  assert.throws(() => validateVideoFile({ name: 'photo.jpg', size: 2000 }), /MP4/);
  assert.doesNotThrow(() => validateVideoFile({ name: 'clip.MOV', size: 2000, type: '' }));
  assert.throws(() => validateVideoMetadata({ duration: Infinity, width: 1920, height: 1080 }));
  assert.throws(() => validateVideoMetadata({ duration: 120.01, width: 1920, height: 1080 }), /120/);
  assert.throws(() => validateVideoMetadata({ duration: 12, width: 0, height: 1080 }));
});

test('sampling covers the entire clip with strictly increasing real timestamps', () => {
  for (const duration of [0.02, 1, 1.037, 119.99, 120]) {
    const times = sampleVideoTimes(duration);
    assert.equal(times[0], 0);
    assert(times.at(-1) < duration);
    assert(duration - times.at(-1) <= 1 / 15 + 1e-10);
    for (let i = 1; i < times.length; i++) assert(Math.abs(times[i] - times[i - 1] - 1 / 15) < 1e-10);
  }
});

test('frame resize preserves landscape and portrait proportions without enlarging', () => {
  assert.deepEqual(scaledVideoSize(1920, 1080), { width: 960, height: 540 });
  assert.deepEqual(scaledVideoSize(1080, 1920), { width: 540, height: 960 });
  assert.deepEqual(scaledVideoSize(640, 480), { width: 640, height: 480 });
});

test('browser seek survives microsecond truncation at frame boundaries and stays inside the clip', () => {
  for (const time of [1 / 15, 4 / 15]) {
    const truncated = Math.floor(browserSeekTime(time, 1) * 1e6) / 1e6;
    assert(truncated >= Math.round(time * 1e6) / 1e6);
    assert(truncated - time < 0.000002);
  }
  assert(browserSeekTime(0, 1) >= 0);
  assert(browserSeekTime(1 - 1e-8, 1) < 1);
  assert(browserSeekTime(1, 1) < 1);
  assert.equal(browserSeekTime(0, 1e-8), 0);
  assert.deepEqual(sampleVideoTimes(0.15), [0, 1 / 15, 2 / 15]);
});

test('pre-cancelled analysis never opens browser resources', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeVideo({ name: 'clip.mp4', size: 20 }, { signal: controller.signal }), error => error.name === 'AbortError');
});

test('shipped MediaPipe runtime, model and notices match the pinned manifest', async () => {
  const base = new URL('../public/vendor/mediapipe/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base)));
  for (const item of manifest.files) {
    const bytes = await readFile(new URL(item.path, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.path);
  }
});
