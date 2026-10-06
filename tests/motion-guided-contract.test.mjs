import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMotionCoachResponse, mergeCoachAssessment, selectedMotionAction, confirmedMotionAction} from '../public/motion-contract.js';
import {sanitizeMotionVerdict, readMotionVerdict} from '../public/motion-verdict.js';

const keyframes = [{time: 0.25}, {time: 1.75}];
const check = {status: 'consistent', imageIndices: [0, 1], evidence: '画面中的训练者正在屈髋屈膝下蹲并站起。'};
const options = {mode: 'guided', keyframes, selectedExerciseId: 'squat'};
const quality = {validFrames: 16, totalFrames: 16, usableRatio: 1, targetCoverage: 1};
const feedback = [{title: '起身协调', source: 'combined', status: 'good', frameIndices: [0, 8], evidenceTimes: [0.25, 1.75], evidence: '起身阶段肩髋同步抬升，足部保持支撑。', correction: '', priority: 1}];
const coverage = {complete: true, strategy: 'guided-evidence', sourceFrameCount: 16, frameCount: 10, reviewedFrameCount: 10, imageCount: 2, reviewedImageCount: 2, measurementCount: 16, reviewedMeasurementCount: 10, summarizedMeasurementCount: 16, dataBatches: 1, modelCalls: 1};
const makeCoach = (selectionCheck = check) => ({...sanitizeMotionCoachResponse({selectionCheck}, options), verdict: {status: 'standard'}, feedback, coverage});

test('guided identity comes only from the validated user selection, never a model prediction', () => {
  const coach = sanitizeMotionCoachResponse({action: {exerciseId: 'pushup', name: '俯卧撑', status: 'identified', confidence: 'high'}, candidates: [{name: '俯卧撑'}], selectionCheck: check}, options);
  assert.equal(coach.mode, 'guided');
  assert.deepEqual(coach.action, {exerciseId: 'squat', name: '徒手深蹲', family: 'squat', status: 'selected', confidence: null, source: 'user', evidenceTimes: [], evidence: ''});
  assert.deepEqual(coach.candidates, []);
  assert.deepEqual(selectedMotionAction(coach), coach.action);
  assert.equal(confirmedMotionAction(coach), null, 'a user selection is not an automatic identification');
  for (const selectedExerciseId of [undefined, 'unknown', {}, '__proto__']) assert.throws(() => sanitizeMotionCoachResponse({}, {...options, selectedExerciseId}), /动作类型/);
});

test('selection checks require actual pictures and a concrete observation', () => {
  assert.deepEqual(makeCoach().selectionCheck.evidenceTimes, [0.25, 1.75]);
  assert.equal(makeCoach({...check, imageIndices: [0]}).selectionCheck.status, 'consistent');
  for (const invalid of [{...check, imageIndices: [99]}, {...check, imageIndices: [], evidenceTimes: [1.74]}, {...check, evidence: '是'}, {...check, status: 'identified'}, null]) {
    assert.equal(makeCoach(invalid).selectionCheck.status, 'uncertain');
  }
  assert.equal(makeCoach({...check, imageIndices: [99]}).selectionCheck.evidence, '', 'an unsupported confirmation must not appear in the selection notice');
});

test('selected action with an evidenced consistency check can receive a standard review', () => {
  const coach = makeCoach();
  assert.equal(sanitizeMotionVerdict(coach.verdict, {...coach, quality}).status, 'standard');
  for (const extra of [{feedback: []}, {coverage: {...coverage, reviewedImageCount: 1}}, {coverage: {...coverage, reviewedFrameCount: 9}}, {quality: {...quality, validFrames: 0}}]) {
    assert.equal(sanitizeMotionVerdict(coach.verdict, {...coach, quality, ...extra}).status, 'uncertain');
  }
});

test('a wrong or unresolved selection prevents good or bad form conclusions for the wrong movement', () => {
  for (const status of ['mismatch', 'uncertain']) {
    const coach = makeCoach({...check, status});
    for (const item of [feedback[0], {...feedback[0], status: 'improve', correction: '肩髋同步起身。'}]) {
      const result = sanitizeMotionVerdict({status: 'standard'}, {...coach, quality, feedback: [item]});
      assert.equal(result.status, 'uncertain');
      assert.equal(result.summary, '暂时找不出问题。');
    }
  }
});

test('saved guided reports retain the user source, checked selection, and actual evidence coverage', () => {
  const saved = mergeCoachAssessment({quality}, makeCoach());
  assert.equal(saved.recognitionSource, 'user');
  assert.equal(saved.exerciseId, 'squat');
  assert.equal(saved.exerciseName, '徒手深蹲');
  assert.equal(saved.coach.mode, 'guided');
  assert.equal(saved.coach.action.confidence, null);
  assert.deepEqual(saved.coach.selectionCheck.evidenceTimes, [0.25, 1.75]);
  assert.deepEqual(saved.coach.coverage, coverage);
  assert.equal(readMotionVerdict(saved).status, 'standard');
  assert.equal(readMotionVerdict(saved.coach).status, 'standard');
  const mismatch = mergeCoachAssessment({quality}, makeCoach({...check, status: 'mismatch'}));
  assert.equal(mismatch.exerciseId, 'squat', 'the selected type is preserved so the user can correct it');
  assert.equal(readMotionVerdict(mismatch).status, 'uncertain');
  assert.deepEqual(mismatch.coach.feedback, [], 'technical feedback for an unverified selection must not be saved');
  const unresolved = mergeCoachAssessment({quality}, {...makeCoach({...check, status: 'uncertain'}), feedback: [{...feedback[0], status: 'uncertain', correction: '下一组增加下蹲深度。'}]});
  assert.deepEqual(unresolved.coach.feedback, []);
});

test('invalid saved selected identities cannot silently become a visual recognition', () => {
  for (const action of [{...makeCoach().action, name: '俯卧撑'}, {...makeCoach().action, source: 'model'}, {...makeCoach().action, exerciseId: 'missing'}]) {
    const saved = mergeCoachAssessment({quality}, {...makeCoach(), action});
    assert.equal(saved.recognitionSource, 'unknown');
    assert.equal(saved.coach, null);
    assert.equal(readMotionVerdict(saved).status, 'uncertain');
  }
});
