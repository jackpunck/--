// Compare the production browser adapter with native ONNX Runtime and the
// official Ultralytics LetterBox/coordinate scaling on the same video frame.
// Requires an existing QA_PYTHON with numpy, cv2, onnxruntime and ultralytics.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../server.mjs';

const root = resolve(import.meta.dirname, '..');
await mkdir(join(root, '.qa'), { recursive: true });
const output = await mkdtemp(join(root, '.qa/motion-yolo26-reference-'));
const { chromium } = await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT || '.qa/browser-tools/node_modules/playwright/index.mjs')));
const fixture = await readFile(resolve(process.argv[2] || '.qa/motion-fixtures/squat.mp4'));
const server = await startServer({ host: '127.0.0.1', port: 0, dataDir: output });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [], errors = [], external = [];
try {
  for (const delegate of ['CPU', 'GPU']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    context.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) external.push(request.url()); });
    await context.route('**/yolo26-fixture.mp4', route => route.fulfill({ contentType: 'video/mp4', body: fixture }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/vendor/yolo26/manifest.json');
    if (delegate === 'GPU' && !await page.evaluate(() => !!navigator.gpu)) {
      results.push({ delegate, skipped: 'WebGPU unavailable' });
      await context.close();
      continue;
    }
    const result = await page.evaluate(async delegate => {
      const video = document.createElement('video');
      video.src = '/yolo26-fixture.mp4';
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      const seeked = new Promise(resolve => { video.onseeked = resolve; });
      video.currentTime = Math.min(2, video.duration / 2);
      await seeked;
      const bitmap = await createImageBitmap(video);
      const ort = await import('/vendor/onnxruntime/ort.all.min.mjs');
      const { createYolo26, yolo26Letterbox } = await import('/motion-yolo26.js');
      const base64 = buffer => {
        const bytes = new Uint8Array(buffer); let text = '';
        for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(text);
      };
      const calls = [], originalRun = ort.InferenceSession.prototype.run;
      ort.InferenceSession.prototype.run = async function (inputs, ...rest) {
        const result = await originalRun.call(this, inputs, ...rest);
        const input = inputs[this.inputNames[0]], output = result[this.outputNames[0]];
        calls.push({ input: base64(input.data.buffer), output: base64(output.data.buffer), dims: output.dims });
        return result;
      };
      let model;
      try {
        model = await createYolo26({ delegate });
        calls.length = 0;
        const start = performance.now(), detected = await model.detect(bitmap), inferenceMs = performance.now() - start;
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return { delegate, inferenceMs, width: bitmap.width, height: bitmap.height, transform: yolo26Letterbox(bitmap.width, bitmap.height),
          detected, calls, png: base64(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()) };
      } finally {
        ort.InferenceSession.prototype.run = originalRun;
        bitmap.close();
        await model?.close();
      }
    }, delegate);
    assert.equal(result.calls.length, 1, 'exactly one YOLO graph invocation for the frame');
    assert(result.detected.landmarks.length > 0);
    assert.deepEqual(result.calls[0].dims, [1, 300, 57]);
    await writeFile(join(output, `${delegate}-frame.png`), Buffer.from(result.png, 'base64'));
    await writeFile(join(output, `${delegate}-input.f32`), Buffer.from(result.calls[0].input, 'base64'));
    await writeFile(join(output, `${delegate}-output.f32`), Buffer.from(result.calls[0].output, 'base64'));
    delete result.png; delete result.calls;
    results.push(result);
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(join(output, 'browser-reference.json'), JSON.stringify({ results, errors, external }, null, 2));
  const python = process.env.QA_PYTHON || join(root, '.qa/yolo26-export/Scripts/python.exe');
  const comparison = await promisify(execFile)(python, ['scripts/qa-motion-yolo26-reference.py', output], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 });
  console.log(comparison.stdout.trim());
  console.log('QA artifacts:', output);
} finally {
  await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
