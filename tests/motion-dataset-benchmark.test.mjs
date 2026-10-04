import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {blindedVideoName, datasetVideoPath, expectedVerdict, inspectDataset, resolvePredictedExercise, scoreMotionPrediction, selectDatasetItems, summarizeDatasetResults} from '../scripts/motion-dataset-benchmark.mjs';

test('labels exclude unverified demonstrations and mixed tutorials from form accuracy', () => {
  for (const qualityLabel of ['demonstration_unverified', 'mixed_tutorial', 'scene', undefined]) assert.equal(expectedVerdict({qualityLabel}), null);
  assert.equal(expectedVerdict({qualityLabel: 'author_good'}), 'standard');
  assert.equal(expectedVerdict({qualityLabel: 'author_bad'}), 'needs-improvement');
});

test('strict recognition keeps equipment differences and rejects ambiguous/contradictory IDs', () => {
  const action = (name, exerciseId) => ({status: 'identified', name, exerciseId});
  assert.equal(resolvePredictedExercise(action('杠铃卧推', 'barbell-bench')), 'barbell-bench-press');
  assert.equal(resolvePredictedExercise(action('哑铃卧推', 'bench')), 'dumbbell-bench-press');
  assert.equal(resolvePredictedExercise(action('杠铃卧推', 'bench')), null);
  assert.equal(resolvePredictedExercise(action('卧推', 'bench')), null);
  assert.equal(resolvePredictedExercise({status: 'unknown', name: '俯卧撑'}), null);
  assert.equal(resolvePredictedExercise(action('徒手深蹲')), 'bodyweight-squat');
});

test('failures and abstentions lower eligible accuracy; unlabeled clips never pass quality by default', () => {
  const expected = {exercise: 'push-up', qualityLabel: 'author_bad', sourceGroup: 'real', view: 'side'};
  const coach = {action: {status: 'identified', name: '俯卧撑'}, verdict: {status: 'needs-improvement'}, feedback: [{status: 'improve', evidence: '底部塌腰', evidenceTimes: [1], correction: '收紧腹部'}]};
  const rows = [{status: 'ok', expected, score: scoreMotionPrediction(expected, coach), timing: {total: 3000}, duration: 10},
    {status: 'error', expected}, {status: 'ok', expected, score: scoreMotionPrediction(expected, {...coach, verdict: {status: 'uncertain'}})},
    {status: 'ok', expected: {...expected, qualityLabel: 'demonstration_unverified'}, score: scoreMotionPrediction({...expected, qualityLabel: 'demonstration_unverified'}, coach)}];
  const summary = summarizeDatasetResults(rows);
  assert.deepEqual(summary.overall.action, {correct: 3, total: 4, rate: .75});
  assert.deepEqual(summary.overall.quality, {correct: 1, total: 3, rate: 1 / 3});
  assert.equal(summary.overall.joint.total, 3);
  assert.equal(summary.gate.passed, false);
  assert.equal(summary.timingMs.total.p95, 3000);
  assert.equal(rows[3].score.qualityCorrect, null);
});

test('sparse extraction never reports action/form accuracy or a passing accuracy gate', () => {
  const result = summarizeDatasetResults([{status: 'ok', expected: {exercise: 'push-up', qualityLabel: 'author_good'}}], {mode: 'sparse'});
  assert.equal(result.accuracyMeasured, false);
  assert.equal(result.overall.action, undefined);
  assert.equal(result.gate.passed, null);
});

test('independent visual references are explicit, separate, and cannot replace author labels', () => {
  const independentReview = {verdict: 'needs-improvement', reviewer: 'Reviewer', basis: 'six frames'};
  assert.equal(expectedVerdict({qualityLabel: 'author_good', independentReview}), 'standard');
  const expected = {exercise: 'push-up', qualityLabel: 'demonstration_unverified', independentReview};
  assert.equal(expectedVerdict(expected), 'needs-improvement');
  const coach = {action: {status: 'identified', name: '俯卧撑'}, verdict: {status: 'needs-improvement'}};
  const summary = summarizeDatasetResults([{id: 'a', status: 'ok', expected, score: scoreMotionPrediction(expected, coach)}]);
  assert.equal(summary.formReferences.authorLabels.clips, 0);
  assert.equal(summary.formReferences.independentVisualReview.clips, 1);
  assert.deepEqual(summary.exerciseAcceptance.exercises['push-up'].successIds, ['a']);
  assert.equal(summary.exerciseAcceptance.everyExerciseHasJointSuccess, true);
});

test('each-exercise acceptance preserves failed attempts instead of hiding them', () => {
  const expected = {exercise: 'push-up', qualityLabel: 'author_good'};
  const score = scoreMotionPrediction(expected, {action: {status: 'identified', name: '俯卧撑'}, verdict: {status: 'standard'}});
  const rows = [{id: 'success', status: 'ok', expected, score}, {id: 'failure', status: 'error', expected}];
  const summary = summarizeDatasetResults(rows, {acceptance: 'each-exercise'});
  assert.equal(summary.gate.passed, true);
  assert.equal(summary.gate.ratePassed, false);
  assert.equal(summary.overall.joint.rate, .5);
  assert.equal(summary.overall.failed, 1);
});

test('always-bad predictions are visible in confusion and do not verify a correction', () => {
  const coach = {action: {status: 'identified', name: '俯卧撑'}, verdict: {status: 'needs-improvement'}, feedback: [{status: 'improve', evidence: '画面中可见问题', evidenceTimes: [1], correction: '需要调整'}]};
  const rows = ['author_good', 'author_bad'].map((qualityLabel, index) => {
    const expected = {exercise: 'push-up', qualityLabel, specificFault: index ? 'rounded_back' : null};
    return {id: String(index), status: 'ok', expected, score: scoreMotionPrediction(expected, coach)};
  });
  const summary = summarizeDatasetResults(rows);
  assert.equal(summary.overall.qualityBalancedAccuracy, .5);
  assert.equal(summary.overall.qualityConfusion.standard['needs-improvement'], 1);
  assert.equal(summary.overall.qualityConfusion['needs-improvement']['needs-improvement'], 1);
  assert.equal(summary.confusion.actionId['push-up']['push-up'], 2);
  assert.equal(rows[1].score.badClipWithCorrection, true);
  assert.equal(rows[1].score.correctionAccuracy, null);
  assert.equal(summary.correctionReview.automaticallyScored, false);
});

test('incomplete run cannot pass and corrections need concrete evidence and timestamps', () => {
  const expected = {exercise: 'push-up', qualityLabel: 'author_bad'};
  const coach = {action: {status: 'identified', name: '俯卧撑'}, verdict: {status: 'needs-improvement'}, feedback: [{status: 'improve', correction: '控制动作'}]};
  const score = scoreMotionPrediction(expected, coach);
  assert.equal(score.qualityCorrect, true);
  assert.equal(score.badClipWithCorrection, false);
  assert.equal(summarizeDatasetResults([{status: 'ok', expected, score}, {status: 'pending', expected}]).gate.passed, false);
});

test('seeded stratified selection is repeatable and can hold out subjects', () => {
  const items = Array.from({length: 20}, (_, i) => ({id: `clip${i}`, exercise: i % 2 ? 'push-up' : 'bodyweight-squat', qualityLabel: i % 3 ? 'author_good' : 'author_bad', view: 'side', subject: i < 10 ? '001' : '022'}));
  const first = selectDatasetItems(items, {limit: 6, subjects: ['022']});
  assert.deepEqual(first, selectDatasetItems(items.toReversed(), {limit: 6, subjects: ['022']}));
  assert(first.every(item => item.subject === '022'));
  assert.equal(new Set(first.map(item => item.exercise)).size, 2);
});

test('inventory validates real files, excludes traversal, and finds unlabeled videos', async () => {
  const root = await mkdtemp(join(tmpdir(), 'motion-dataset-test-'));
  await mkdir(join(root, 'clips'));
  await writeFile(join(root, 'clips', 'squat_bad.mp4'), 'real-file-placeholder');
  await writeFile(join(root, 'unlabeled.mov'), 'unlabeled-placeholder');
  await writeFile(join(root, 'manifest.json'), JSON.stringify({items: [{id: '1', relativePath: 'clips/squat_bad.mp4', exercise: 'bodyweight-squat', qualityLabel: 'author_bad', outputBytes: 21}]}));
  const inventory = await inspectDataset(root, {verifyHashes: true});
  assert.equal(inventory.inventory.clips, 1);
  assert.equal(inventory.inventory.labeledClips, 1);
  assert.deepEqual(inventory.inventory.errors, []);
  assert.deepEqual(inventory.inventory.unlistedVideos, ['unlabeled.mov']);
  assert.match(inventory.audit[0].sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(datasetVideoPath(root, '../outside.mp4'), /Invalid/);
  assert.equal(blindedVideoName('clips/squat_bad.mp4'), 'clip.mp4');
});
