// Real browser/runtime check. Supply local, consented video fixtures as arguments.
// Example: node scripts/qa-motion-pipeline.mjs .qa/motion-fixtures/squat.mp4
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../server.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length < 3) throw new Error('Supply at least one local video fixture; set QA_PLAYWRIGHT / QA_BROWSER if Playwright is not installed locally.');
const qaRoot = join(root, '.qa', 'motion-fixtures');
await mkdir(qaRoot, { recursive: true });
const dataDir = await mkdtemp(join(qaRoot, 'server-'));
const { chromium } = process.env.QA_PLAYWRIGHT
  ? await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT)).href)
  : await import('playwright');
const server = await startServer({ host: '127.0.0.1', port: 0, dataDir });
const waitForWorkersToClose = async page => {
  // Worker.terminate() is immediate at the API, but Chromium reports closure
  // asynchronously while its native video decoder releases resources.
  for (let attempt = 0; attempt < 100 && page.workers().length; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(page.workers().length, 0, 'Analysis releases its native worker');
};
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}), args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const failures = [], externalRequests = [];
  const base = `http://127.0.0.1:${server.address().port}`;
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(base)) externalRequests.push(request.url()); });
  page.on('console', event => { if (event.type() === 'error' || (event.type() === 'warning' && /Sequential video|MP4 sequential/.test(event.text()))) console.log('[browser]', event.text()); });
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(base);
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'qa-motion-input'; input.type = 'file'; document.body.append(input); });
  for (const videoPath of process.argv.slice(2)) {
    await page.locator('#qa-motion-input').setInputFiles(resolve(videoPath));
    const result = await page.evaluate(async () => {
      const { analyzeVideo } = await import('/motion-video.js');
      const progress = [];
      let uiTicks = 0;
      const heartbeat = setInterval(() => uiTicks++, 50);
      try {
        const result = await analyzeVideo(document.querySelector('#qa-motion-input').files[0], { onProgress: update => progress.push({ stage: update.stage, processedFrames: update.processedFrames, delegate: update.delegate }) });
        return { ...result, uiTicks, progress };
      } finally { clearInterval(heartbeat); }
    });
    assert(result.frames.length > 0);
    assert(result.frames.some(frame => frame.landmarks.length === 33), 'Real model must detect a person');
    assert(result.frames.every((frame, index) => frame.time === index / 15));
    assert(result.frames.length === Math.ceil(result.duration * 15), 'All sampled positions must be processed');
    assert(result.uiTicks > 2, 'Main thread remains available');
    await waitForWorkersToClose(page);
    await writeFile(join(qaRoot, basename(videoPath) + '.' + result.decoder + '.frames.json'), JSON.stringify(result));
    console.log(JSON.stringify({ video: basename(videoPath), frames: result.frames.length, detected: result.frames.filter(frame => frame.landmarks.length === 33).length, duration: result.duration, elapsedMs: result.elapsedMs, delegate: result.delegate, decoder: result.decoder, codec: result.codec, uiTicks: result.uiTicks, timing: result.timing }));
    if (!process.env.QA_EXTRACT_ONLY) {
     const cancelled = await page.evaluate(async () => {
      const { analyzeVideo } = await import('/motion-video.js');
      const controller = new AbortController();
      try {
        await analyzeVideo(document.querySelector('#qa-motion-input').files[0], { signal: controller.signal, onProgress: update => { if (update.processedFrames >= 2) controller.abort(); } });
        return 'unexpected success';
      } catch (error) { return error.name; }
    });
     assert.equal(cancelled, 'AbortError');
     await waitForWorkersToClose(page);
    }
  }
  if (process.argv.length > 2 && !process.env.QA_EXTRACT_ONLY) {
    const workerChecks = await page.evaluate(async () => {
      const video = document.createElement('video'), src = URL.createObjectURL(document.querySelector('#qa-motion-input').files[0]);
      let worker;
      try {
        video.muted = true; video.preload = 'auto';
        await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; video.src = src; });
        const bitmap = await createImageBitmap(video);
        const pairCanvas = new OffscreenCanvas(bitmap.width * 2, bitmap.height), pairContext = pairCanvas.getContext('2d');
        pairContext.drawImage(bitmap, 0, 0); pairContext.drawImage(bitmap, bitmap.width, 0);
        const scale = Math.min(1, 960 / Math.max(pairCanvas.width, pairCanvas.height));
        const pair = await createImageBitmap(pairCanvas, { resizeWidth: Math.round(pairCanvas.width * scale), resizeHeight: Math.round(pairCanvas.height * scale) });
        worker = new Worker('/motion-worker.js');
        let id = 0;
        const request = (message, transfer = []) => new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
          worker.onerror = event => reject(new Error(event.message));
          worker.postMessage({ id: ++id, ...message }, transfer);
        });
        await request({ type: 'init', delegate: 'CPU' });
        const person = await request({ type: 'frame', timestampMs: 0, bitmap }, [bitmap]);
        // Large time gap forces detection instead of trusting an old tracking ROI.
        const canvas = new OffscreenCanvas(640, 480), ctx = canvas.getContext('2d');
        ctx.fillStyle = '#333'; ctx.fillRect(0, 0, 640, 480);
        const black = await createImageBitmap(canvas);
        const empty = await request({ type: 'frame', timestampMs: 10000, bitmap: black }, [black]);
        const multiple = await request({ type: 'frame', timestampMs: 20000, bitmap: pair }, [pair]);
        await request({ type: 'close' });
        return { cpuLandmarks: person.landmarks.length, emptyLandmarks: empty.landmarks.length, emptyPersonCount: empty.personCount, multiplePersonCount: multiple.personCount, multipleLandmarks: multiple.landmarks.length };
      } finally { worker?.terminate(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(src); }
    });
    assert.equal(workerChecks.cpuLandmarks, 33, 'Native CPU inference detects a real person');
    assert.equal(workerChecks.emptyLandmarks, 0, 'Empty frame is not assigned a person');
    assert.equal(workerChecks.emptyPersonCount, 0);
    assert.equal(workerChecks.multiplePersonCount, 2, 'Two visible bodies are detected');
    assert.equal(workerChecks.multipleLandmarks, 0, 'Ambiguous people are not selected silently');
    console.log(JSON.stringify(workerChecks));
    // Fault injection is confined to QA: GPU initialization fails, then the
    // unmodified worker must initialize and process real frames with CPU.
    const workerSource = await readFile(join(root, 'public', 'motion-worker.js'), 'utf8');
    await context.route('**/motion-worker.js', route => route.fulfill({ contentType: 'text/javascript', body: workerSource + '\nconst actualHandler = self.onmessage; self.onmessage = event => { if (event.data.type === "init" && event.data.delegate === "GPU") self.postMessage({id:event.data.id,error:"QA GPU unavailable"}); else actualHandler(event); };' }));
    const fallback = await page.evaluate(async () => {
      const { analyzeVideo } = await import('/motion-video.js');
      const controller = new AbortController();
      let usedCpu = false;
      try {
        await analyzeVideo(document.querySelector('#qa-motion-input').files[0], { signal: controller.signal, onProgress: update => { if (update.processedFrames >= 2) { usedCpu = update.delegate === 'CPU'; controller.abort(); } } });
      } catch (error) { return { usedCpu, error: error.name }; }
    });
    assert.deepEqual(fallback, { usedCpu: true, error: 'AbortError' });
    console.log(JSON.stringify({ fallback }));
  }
  assert.deepEqual(externalRequests, [], 'No external network requests');
  assert.deepEqual(failures, [], 'No unhandled browser errors');
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
