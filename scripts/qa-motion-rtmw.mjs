// Real ONNX execution and optional OpenCV/native-ORT numerical comparison.
// QA_PYTHON may name a development Python with numpy, cv2 and onnxruntime.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../server.mjs';

const root = process.cwd(), output = await mkdtemp(join(root, '.qa/motion-rtmw-'));
const { chromium } = await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT || '.qa/browser-tools/node_modules/playwright/index.mjs')));
const fixture = await readFile(resolve(process.argv[2] || '.qa/motion-fixtures/squat.mp4'));
const server = await startServer({ host: '127.0.0.1', port: 0, dataDir: output });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [], errors = [], external = [];
try {
  for (const testCase of [{ delegate: 'CPU', reference: true }, { delegate: 'GPU' }, { delegate: 'CPU', worker: true }]) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    context.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) external.push(request.url()); });
    await context.route('**/rtmw-fixture.mp4', route => route.fulfill({ contentType: 'video/mp4', body: fixture }));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    // A plain-text project resource retains the real server CSP and does not
    // initialize the app or need an account for this model execution check.
    await page.goto(origin + '/vendor/rtmw/README.md');
    if (testCase.delegate === 'GPU' && !await page.evaluate(() => !!navigator.gpu)) {
      results.push({ delegate: 'GPU', skipped: 'WebGPU unavailable' }); await context.close(); continue;
    }
    const result = await page.evaluate(async config => {
      const video = document.createElement('video'); video.src = '/rtmw-fixture.mp4';
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      video.currentTime = Math.min(2, video.duration / 2); await new Promise(resolve => { video.onseeked = resolve; });
      const bitmap = await createImageBitmap(video), started = performance.now();
      if (config.worker) {
        const worker = new Worker('/motion-worker.js'); let id = 0;
        const request = (type, data = {}, transfer = []) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker timeout')), 120000);
          worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
          worker.onmessage = ({ data }) => { clearTimeout(timer); data.error ? reject(new Error(data.error)) : resolve(data); };
          worker.postMessage({ id: ++id, type, ...data }, transfer);
        });
        try {
          await request('init', { model: 'rtmw', delegate: config.delegate }); const ready = performance.now();
          const frame = await request('frame', { bitmap, timestampMs: 2000 }, [bitmap]);
          await request('close');
          return { ...config, loadedMs: ready - started, inferenceMs: frame.inferenceMs, points: frame.wholebodyLandmarks,
            mapped: frame.landmarks, people: frame.personCount, tracking: frame.subjectTracking.status };
        } finally { worker.terminate(); }
      }
      const ort = await import('/vendor/onnxruntime/ort.all.min.mjs');
      const { createRtmw } = await import('/motion-rtmw.js');
      const base64 = buffer => { const bytes = new Uint8Array(buffer); let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
      const calls = [], originalRun = ort.InferenceSession.prototype.run;
      let batchSample;
      if (config.reference || config.delegate === 'GPU') ort.InferenceSession.prototype.run = async function (inputs, ...rest) {
        const outputs = await originalRun.call(this, inputs, ...rest);
        if (config.reference) calls.push({ data: base64(inputs[this.inputNames[0]].data.buffer), outputs: Object.fromEntries(Object.entries(outputs).map(([key, tensor]) => [key, {
          dims: tensor.dims, data: tensor.type === 'int64' ? Array.from(tensor.data, Number) : base64(tensor.data.buffer),
        }])) });
        if (config.delegate === 'GPU' && inputs[this.inputNames[0]].dims[0] === 2) {
          batchSample = { session: this, data: new Float32Array(inputs[this.inputNames[0]].data) };
        }
        return outputs;
      };
      const model = await createRtmw({ delegate: config.delegate }), ready = performance.now(); calls.length = 0; batchSample = undefined;
      try {
        const inferenceStart = performance.now(), detected = await model.detect(bitmap, 2000), inferenceMs = performance.now() - inferenceStart;
        let batchComparison;
        if (config.delegate === 'GPU') {
          if (!batchSample) throw new Error('GPU flip-test did not use the dynamic two-image batch');
          const {session, data} = batchSample, count = data.length / 2;
          const first = new ort.Tensor('float32', data.subarray(0, count), [1, 3, 384, 288]);
          const second = new ort.Tensor('float32', data.subarray(count), [1, 3, 384, 288]);
          const both = new ort.Tensor('float32', data, [2, 3, 384, 288]);
          const sequentialMs = [], batchedMs = []; let maxLogitDifference = 0;
          const run = async tensor => {
            const outputs = await originalRun.call(session, { [session.inputNames[0]]: tensor });
            try { return { x: new Float32Array(outputs.simcc_x.data), y: new Float32Array(outputs.simcc_y.data) }; }
            finally { Object.values(outputs).forEach(value => value.dispose()); }
          };
          try {
            for (let repeat = 0; repeat < 5; repeat++) {
              const sequentialStart = performance.now(), a = await run(first), b = await run(second);
              sequentialMs.push(performance.now() - sequentialStart);
              const batchStart = performance.now(), combined = await run(both); batchedMs.push(performance.now() - batchStart);
              for (const axis of ['x', 'y']) for (let i = 0; i < a[axis].length; i++) {
                maxLogitDifference = Math.max(maxLogitDifference, Math.abs(a[axis][i] - combined[axis][i]), Math.abs(b[axis][i] - combined[axis][i + a[axis].length]));
              }
            }
          } finally { first.dispose(); second.dispose(); both.dispose(); }
          const median = values => values.slice(1).sort((a, b) => a - b).slice(1, 3).reduce((sum, value) => sum + value, 0) / 2;
          batchComparison = { maxLogitDifference, sequentialMs, batchedMs, sequentialMedianMs: median(sequentialMs), batchedMedianMs: median(batchedMs) };
        }
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return { ...config, loadedMs: ready - started, inferenceMs, people: detected.landmarks.length, points: detected.wholebodyLandmarks[0],
          mapped: detected.landmarks[0], calls, batchComparison, width: bitmap.width, height: bitmap.height,
          png: config.reference ? base64(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()) : undefined };
      } finally { bitmap.close(); await model.close(); }
    }, testCase);
    assert(result.people > 0); assert.equal(result.points.length, 133); assert.equal(result.mapped.length, 33);
    assert(result.points.every(point => [point.x, point.y, point.score].every(Number.isFinite)));
    assert(result.mapped.filter(Boolean).every(point => !('z' in point) && !('presence' in point)));
    if (testCase.worker) assert.equal(result.tracking, 'locked');
    if (testCase.delegate === 'GPU') assert(result.batchComparison.maxLogitDifference < .001, 'batched and separate flip-test must retain equivalent raw predictions');
    if (testCase.reference) {
      await writeFile(join(output, 'reference-frame.png'), Buffer.from(result.png, 'base64')); delete result.png;
      for (let i = 0; i < result.calls.length; i++) {
        await writeFile(join(output, `browser-input-${i}.f32`), Buffer.from(result.calls[i].data, 'base64')); delete result.calls[i].data;
        for (const [key, tensor] of Object.entries(result.calls[i].outputs)) if (typeof tensor.data === 'string') {
          await writeFile(join(output, `browser-output-${i}-${key}.f32`), Buffer.from(tensor.data, 'base64')); delete tensor.data;
        }
      }
      await writeFile(join(output, 'browser-reference.json'), JSON.stringify(result, null, 2));
    }
    results.push({ delegate: result.delegate, worker: !!testCase.worker, loadedMs: result.loadedMs, inferenceMs: result.inferenceMs, people: result.people, batchComparison: result.batchComparison });
    console.log(JSON.stringify(results.at(-1))); await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  if (process.env.QA_PYTHON) {
    const comparison = await promisify(execFile)(process.env.QA_PYTHON, ['scripts/qa-motion-rtmw-reference.py', output], { cwd: root, windowsHide: true });
    console.log(comparison.stdout.trim());
  }
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, errors, external }, null, 2));
  console.log('QA artifacts:', output);
} finally { await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
