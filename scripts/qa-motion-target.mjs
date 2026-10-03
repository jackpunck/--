// Real MediaPipe target-selection QA; requires local videos from the fixture scripts.
// QA_PLAYWRIGHT=/path/to/playwright/index.mjs QA_BROWSER=/path/to/browser node scripts/qa-motion-target.mjs
// Coordinate GPU use with other browser QA jobs. Images/frames stay under .qa.
// QA_TARGET_REPLAY=/path/to/prior/output reruns semantic checks without browser/GPU inference.
// QA_TARGET_SCENARIOS=baseline-squat,baseline-pushup selects scenario IDs; default runs all six.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../server.mjs';
import { analyzeMotion } from '../public/motion-analysis.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), fixtureRoot = resolve(process.env.QA_MOTION_FIXTURES || join(root, '.qa/motion-fixtures'));
await mkdir(join(root, '.qa'), { recursive: true });
const output = await mkdtemp(join(root, '.qa/motion-target-'));
// Print before imports/startup/assertions, including when browser setup fails.
console.log(`Target QA artifacts: ${output}`);
const replayRoot = process.env.QA_TARGET_REPLAY ? resolve(process.env.QA_TARGET_REPLAY) : null;
const errors = [], external = [], results = [];
let browser, server, page;
const scenarios = [
  { id: 'baseline-squat', filename: 'squat.mp4', kind: 'single-person-baseline', expectedFamily: 'squat', expectedExerciseId: 'squat', expectedAutomaticAttempts: 5, exerciseHint: 'squat' },
  { id: 'baseline-pushup', filename: 'pushup.mp4', kind: 'single-person-baseline', expectedFamily: 'pushup', expectedExerciseId: 'pushup', expectedAutomaticAttempts: 11, exerciseHint: 'pushup' },
  { id: 'composite-center-row', filename: 'composite-row-and-curl.mp4', kind: 'synthetic-composite', expectedPanel: 'left', expectedFamily: 'row', exerciseHint: 'row' },
  { id: 'composite-point-curl', filename: 'composite-row-and-curl.mp4', kind: 'synthetic-composite', point: { x: 0.88, y: 0.52 }, expectedPanel: 'right', expectedFamily: 'elbow-isolation', exerciseHint: 'curl' },
  { id: 'composite-target-disappears', filename: 'composite-row-target-disappears.mp4', kind: 'synthetic-composite', expectedPanel: 'left', expectedFamily: 'row', exerciseHint: 'row', disappears: true },
  { id: 'natural-gym-pushup', filename: 'subject_002_push_up_good_side-h264.mp4', kind: 'naturally-recorded-gym', expectedFamily: 'pushup', exerciseHint: 'pushup', visualReviewRequired: true },
];
try {
  const requested = process.env.QA_TARGET_SCENARIOS?.split(',').map(id => id.trim()).filter(Boolean);
  if (requested) assert(requested.length && requested.every(id => scenarios.some(scenario => scenario.id === id)), `Unknown QA_TARGET_SCENARIOS; choose from: ${scenarios.map(scenario => scenario.id).join(',')}`);
  const selectedScenarios = requested ? scenarios.filter(scenario => requested.includes(scenario.id)) : scenarios;
  if (!replayRoot) {
    const { chromium } = process.env.QA_PLAYWRIGHT ? await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT)).href) : await import('playwright');
    server = await startServer({ host: '127.0.0.1', port: 0, dataDir: join(output, 'data') });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}), args: ['--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    page = await context.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(base)) external.push(request.url()); });
    await page.goto(base);
    await page.evaluate(() => { document.body.innerHTML = '<input id="target-fixture" type="file"><div id="target-contact" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:white;color:black;font:14px sans-serif"></div>'; });
  }
  for (const scenario of selectedScenarios) {
    let pipeline;
    const framesFile = join(replayRoot || output, scenario.id + '.frames.json');
    if (replayRoot) pipeline = JSON.parse(await readFile(framesFile, 'utf8'));
    else {
      await page.locator('#target-fixture').setInputFiles(join(fixtureRoot, scenario.filename));
      pipeline = await page.evaluate(async ({ point }) => {
        const { analyzeVideo } = await import('/motion-video.js');
        return analyzeVideo(document.querySelector('#target-fixture').files[0], point ? { targetPoint: point } : {});
      }, scenario);
      await writeFile(framesFile, JSON.stringify(pipeline));
    }
    // Hints represent independently inspected movement families. They do not
    // certify equipment/variant identity (the left person is a seated cable row).
    const run = { pipeline, analysis: analyzeMotion(pipeline.frames, pipeline), hintedAnalysis: analyzeMotion(pipeline.frames, { ...pipeline, exerciseHint: scenario.exerciseHint }) };
    await writeFile(join(output, scenario.id + '.analysis.json'), JSON.stringify({ automatic: run.analysis, visuallyConfirmedFamily: run.hintedAnalysis }, null, 2));
    const frames = run.pipeline.frames, locked = frames.filter(frame => frame.subjectTracking?.status === 'locked');
    const ids = [...new Set(locked.map(frame => frame.subjectTracking.trackId))];
    const multipleFrames = frames.filter(frame => frame.personCount > 1).length;
    const panelMismatchFrames = scenario.expectedPanel ? locked.filter(frame => {
      const box = frame.subjectTracking.bbox; if (!box) return true;
      const center = (box.xMin + box.xMax) / 2;
      return scenario.expectedPanel === 'left' ? center >= 0.75 : center <= 0.75;
    }).length : null;
    const violations = [];
    if (!locked.length) violations.push('No locked training subject');
    if (ids.length !== 1) violations.push('Track identity changed');
    if (panelMismatchFrames) violations.push(`Selected the wrong panel in ${panelMismatchFrames} frames`);
    if (run.analysis.exerciseFamily && run.analysis.exerciseFamily !== 'ambiguous' && run.analysis.exerciseFamily !== scenario.expectedFamily) violations.push(`Automatic family contradicts the visible target: expected ${scenario.expectedFamily}, observed ${run.analysis.exerciseFamily}`);
    if (scenario.expectedAutomaticAttempts !== undefined) {
      if (run.analysis.status !== 'complete' || run.analysis.exerciseFamily !== scenario.expectedFamily || run.analysis.exerciseId !== scenario.expectedExerciseId) violations.push(`Automatic baseline recognition failed: expected complete ${scenario.expectedExerciseId}/${scenario.expectedFamily}, observed ${run.analysis.status} ${run.analysis.exerciseId}/${run.analysis.exerciseFamily}`);
      if (run.analysis.attemptCount !== scenario.expectedAutomaticAttempts || run.analysis.reps.length !== scenario.expectedAutomaticAttempts) violations.push(`Automatic baseline count changed: expected ${scenario.expectedAutomaticAttempts}, observed ${run.analysis.attemptCount} attempts/${run.analysis.reps.length} repetitions`);
    }
    if (run.hintedAnalysis.exerciseFamily !== scenario.expectedFamily) violations.push(`Visual family hint expected ${scenario.expectedFamily}, observed ${run.hintedAnalysis.exerciseFamily || 'unknown'}`);
    if (scenario.kind !== 'single-person-baseline' && multipleFrames === 0) violations.push('Detector never observed the visibly present second person; multi-person selection test is inconclusive');
    if (scenario.disappears && frames.filter(frame => frame.time >= 5).some(frame => frame.subjectTracking?.status === 'locked' || frame.landmarks.length)) violations.push('Target was reported after disappearance; possible identity switch');
    if (!scenario.disappears && locked.length / frames.length < 0.7) violations.push('Less than 70% target lock coverage');
    const completeReps = run.hintedAnalysis.reps.filter(rep => [rep.start, rep.bottom, rep.end].every(Number.isFinite) && rep.start >= 0 && rep.start < rep.bottom && rep.bottom < rep.end && rep.end <= pipeline.duration + 0.01);
    if (scenario.disappears) {
      const presentFrames = frames.filter(frame => frame.time < 4);
      if (presentFrames.filter(frame => frame.subjectTracking?.status === 'locked').length / presentFrames.length < 0.7) violations.push('Less than 70% target lock coverage before the target disappears');
      for (const [label, analysis] of [['automatic', run.analysis], ['hinted', run.hintedAnalysis]]) {
        if (analysis.status === 'complete' || analysis.score !== null || !analysis.quality.reasons.includes('LOW_TARGET_COVERAGE')) violations.push(`${label} analysis did not reject the full disappearing-target clip for low target coverage`);
      }
    } else {
      if (run.hintedAnalysis.attemptCount < 1 || completeReps.length < 1) violations.push('Visual family hint produced no complete movement attempt with valid start/peak/end');
      if (completeReps.length !== run.hintedAnalysis.attemptCount) violations.push('Reported attempt count differs from complete timed repetitions');
      for (const rep of completeReps) {
        const samples = frames.filter(frame => frame.time >= rep.start - 0.0051 && frame.time <= rep.end + 0.0051);
        if (!samples.length || samples.some(frame => frame.subjectTracking?.status !== 'locked' || frame.subjectTracking.confidence < 0.65 || !frame.landmarks.length)) violations.push(`Repetition at ${rep.bottom}s contains unlocked or missing target samples`);
      }
    }
    // Save six independent whole-scene views with the selected person's box.
    // These expose wrong locks, missing bystanders and target-loss behavior.
    if (page) await page.evaluate(async ({ frames, duration }) => {
      const { browserSeekTime } = await import('/motion-video.js');
      const container = document.querySelector('#target-contact'); container.innerHTML = '';
      const video = document.createElement('video'), src = URL.createObjectURL(document.querySelector('#target-fixture').files[0]); video.muted = true;
      try {
        await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; video.src = src; });
        for (const fraction of [0, 0.2, 0.4, 0.6, 0.8, 0.98]) {
          const time = duration * fraction, frame = frames.reduce((best, item) => Math.abs(item.time - time) < Math.abs(best.time - time) ? item : best, frames[0]);
          await new Promise(resolve => { video.onseeked = resolve; video.currentTime = browserSeekTime(frame.time, duration); });
          const canvas = document.createElement('canvas'); canvas.width = 380; canvas.height = Math.round(380 * video.videoHeight / video.videoWidth);
          const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const box = frame.subjectTracking?.bbox;
          if (box) { ctx.strokeStyle = '#ffdf00'; ctx.lineWidth = 3; ctx.strokeRect(box.xMin * canvas.width, box.yMin * canvas.height, (box.xMax - box.xMin) * canvas.width, (box.yMax - box.yMin) * canvas.height); }
          const tile = document.createElement('div'); tile.append(canvas, `${frame.time.toFixed(2)}s / ${frame.subjectTracking?.status || 'no tracking'} / detected ${frame.personCount ?? '?'} people`); container.append(tile);
        }
      } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(src); }
    }, run.pipeline);
    if (page) await page.locator('#target-contact').screenshot({ path: join(output, scenario.id + '.png') });
    const summarize = analysis => ({ version: analysis.version, exerciseFamily: analysis.exerciseFamily, exerciseId: analysis.exerciseId, classificationSource: analysis.classificationSource, requiresVisualConfirmation: analysis.requiresVisualConfirmation, status: analysis.status, attemptCount: analysis.attemptCount, incompleteAttemptCount: analysis.incompleteAttemptCount, score: analysis.score, scoreStatus: analysis.scoreStatus, quality: analysis.quality, repTimes: analysis.reps.map(({ start, bottom, end }) => ({ start, bottom, end })) });
    const result = { ...scenario, replay: !!replayRoot, framesFile, duration: run.pipeline.duration, elapsedMs: run.pipeline.elapsedMs, decoder: run.pipeline.decoder, frames: frames.length, lockedFrames: locked.length, multipleFrames, trackIds: ids, panelMismatchFrames, targetTracking: run.pipeline.targetTracking, exerciseFamily: run.analysis.exerciseFamily, exerciseId: run.analysis.exerciseId, automatic: summarize(run.analysis), visuallyConfirmedFamily: summarize(run.hintedAnalysis), violations,
      limitation: scenario.kind === 'single-person-baseline' ? 'Fixed real-video regression with automatic recognition/count checks; not a multi-person accuracy estimate.' : scenario.kind === 'synthetic-composite' ? 'Explicit composite functional test, not a natural interaction.' : 'Natural scene needs visual inspection. A constant track ID does not prove identity correctness. Missing bystanders do not count as successful multi-person detection.' };
    results.push(result); console.log(JSON.stringify(result));
    await writeFile(join(output, 'results.json'), JSON.stringify({ output, results, errors, external }, null, 2));
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert(results.every(result => result.violations.length === 0), 'Target QA has failures; inspect results.json and contact images.');
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ output, replayRoot, error: error?.stack || String(error), results, errors, external }, null, 2));
  throw error;
} finally {
  console.log(`Target QA artifacts: ${output}`);
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
