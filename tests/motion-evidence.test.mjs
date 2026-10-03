import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMotionEvidenceFrames, summarizeMotionAnalysis, buildMotionEvidence, evidenceCropRegion } from '../public/motion-evidence.js';

const frames = Array.from({ length: 151 }, (_, index) => ({ time: index / 15, sourceTime: index / 15, landmarks: [] }));

test('evidence includes trajectory context plus severe issues and preserves nearest-frame mappings', () => {
  const assessment = { observedActiveRange: { start: 1, end: 9 }, reps: [{ start: 1, bottom: 3, end: 5 }, { start: 5, bottom: 7, end: 9 }], issues: [
    { time: 2.023, code: 'SHRUG', severity: 'error' }, { time: 2.023, code: 'SHRUG', severity: 'error' },
    { time: 6, code: 'TRUNK', severity: 'warning' }, { time: 8, code: 'NECK', severity: 'warning' },
  ] };
  const chosen = selectMotionEvidenceFrames(frames, assessment);
  assert.equal(chosen.length, 6);
  assert.deepEqual(chosen.map(frame => frame.time), [1, 2, 6, 7, 8, 9]);
  assert.equal(chosen[1].requestedTime, 2.023);
  assert.equal(chosen[1].poseTime, 2);
  assert.equal(chosen[1].sourceTime, 2);
  assert(chosen[0].reasons.includes('动作区间起始'));
  assert(chosen[3].reasons.includes('代表动作顶点'));
  assert(chosen[5].reasons.includes('动作区间结束'));
});

test('evidence normalizes unsorted duplicate timestamps and bounds image count', () => {
  const chosen = selectMotionEvidenceFrames([frames[80], frames[0], frames[80], frames[150]], {}, { maxImages: 100 });
  assert.equal(chosen.length, 3);
  assert.deepEqual(chosen.map(frame => frame.time), [0, 80 / 15, 10]);
  assert.equal(selectMotionEvidenceFrames(frames, {}, { maxImages: 2 }).length, 2);
  assert.throws(() => selectMotionEvidenceFrames([]), /分析帧/);
});

test('v2 critical check evidence is selected alongside start, peak and end', () => {
  const chosen = selectMotionEvidenceFrames(frames, { checks: [
    { code: 'NECK', status: 'warning', severity: 'warning', critical: false, evidenceTimes: [2] },
    { code: 'CONTROL', status: 'fail', severity: 'warning', critical: true, score: 20, evidenceTimes: [6, 7] },
    { code: 'PASS', status: 'pass', evidenceTimes: [3] },
  ] }, { maxImages: 4 });
  assert.deepEqual(chosen.map(item => item.time), [0, 5, 6, 10]);
  assert(chosen.find(item => item.time === 6).reasons.includes('问题：CONTROL'));
});

test('visual review request anchors receive remaining evidence slots', () => {
  const chosen = selectMotionEvidenceFrames(frames, { visualReviewRequests: [{ code: 'SPINAL_NEUTRAL', evidenceTimes: [2, 8] }] }, { maxImages: 5 });
  assert.deepEqual(chosen.map(item => item.time), [0, 2, 5, 8, 10]);
  assert(chosen[1].reasons.includes('待画面核查：SPINAL_NEUTRAL'));
});

test('tracked evidence excludes lost people, keeps one identity and refuses legacy multiple people', () => {
  const tracking = { status: 'locked', trackId: 'motion-target-1', confidence: 0.9, bbox: { xMin: 0.2, yMin: 0.1, xMax: 0.5, yMax: 0.9 } };
  const tracked = frames.map(frame => ({ ...frame, personCount: 2, subjectTracking: { ...tracking, status: frame.time > 3 && frame.time < 7 ? 'lost' : 'locked' } }));
  const chosen = selectMotionEvidenceFrames(tracked, { checks: [{ code: 'NECK', status: 'fail', evidenceTimes: [5] }] });
  assert(chosen.every(item => item.poseTime <= 3 || item.poseTime >= 7));
  assert(chosen.every(item => item.subjectTracking.trackId === 'motion-target-1'));
  assert(!chosen.some(item => item.reasons.includes('问题：NECK')));
  assert.throws(() => selectMotionEvidenceFrames([{ time: 0, personCount: 2 }]), /多个人/);
  assert.throws(() => selectMotionEvidenceFrames([{ time: 0, subjectTracking: tracking }, { time: 1, subjectTracking: { ...tracking, trackId: 'someone-else' } }]), /身份发生变化/);
});

test('target crop includes context and maps normalized original-image coordinates', () => {
  const box = { xMin: 0.3, yMin: 0.1, xMax: 0.6, yMax: 0.9 }, crop = evidenceCropRegion(box);
  assert(crop.xMin < box.xMin && crop.xMax > box.xMax);
  assert(crop.yMin < box.yMin && crop.yMax > box.yMax);
  assert(crop.xMin >= 0 && crop.yMin >= 0 && crop.xMax <= 1 && crop.yMax <= 1);
  assert.deepEqual(evidenceCropRegion(null), { xMin: 0, yMin: 0, xMax: 1, yMax: 1 });
});

test('summary is bounded data and excludes video pixels and raw pose arrays', () => {
  const report = { status: 'complete', exerciseId: 'squat', quality: { validFrames: 100, frames: [1, 2] },
    reps: Array.from({ length: 100 }, (_, index) => ({ index, score: index, metrics: { knee: 80 }, landmarks: new Array(1000).fill(1) })),
    issues: new Array(50).fill({ time: 1, code: 'CONTROL', message: 'x'.repeat(500) }), file: 'private-name', dataUrl: 'data:image/jpeg;base64,ignored' };
  const result = summarizeMotionAnalysis(report, { duration: 10, sampleFps: 15, sourceFps: null });
  assert.equal(result.sourceFps, null);
  assert.equal(result.quality.validFrames, 100);
  assert.equal(result.quality.frames, undefined);
  assert(result.reps.length <= 15);
  assert(result.reps.some(rep => rep.index === 99));
  assert(result.reps.some(rep => rep.index === 0));
  assert(result.issues.length <= 24);
  assert(!JSON.stringify(result).includes('landmarks'));
  assert(!JSON.stringify(result).includes('private-name'));
  assert(!JSON.stringify(result).includes('data:image'));
});

test('pre-aborted evidence extraction never accesses video resources', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildMotionEvidence(null, null, null, { signal: controller.signal }), error => error.name === 'AbortError');
});

test('summary preserves v2 checks and visual-review limits instead of inventing full coverage', () => {
  const report = { exerciseFamily: 'horizontal_pull', exerciseFamilyName: '水平拉', candidates: [{ id: 'seated_row', confidence: 0.7 }], requiresVisualConfirmation: true,
    observedScore: 68, scoreStatus: 'partial', scoreCoverage: { observedWeight: 0.6, totalWeight: 1 },
    checks: [{ code: 'SHRUG', status: 'warning', severity: 'warning', message: '肩向耳靠近', evidence: { ratio: 0.2 }, evidenceTimes: [1.2, 3.4], critical: true, score: 60, weight: 0.2, requiredView: 'front', scope: 'whole-video' }],
    visualReviewRequests: ['确认是否为坐姿划船'] };
  const result = summarizeMotionAnalysis(report, { duration: 4 });
  for (const key of ['exerciseFamily', 'exerciseFamilyName', 'candidates', 'requiresVisualConfirmation', 'checks', 'scoreCoverage', 'observedScore', 'scoreStatus', 'visualReviewRequests']) assert.deepEqual(result[key], report[key], key);
});
