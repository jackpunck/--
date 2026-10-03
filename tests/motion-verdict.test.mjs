import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMotionVerdict, readMotionVerdict} from '../public/motion-verdict.js';

const finding = extra => ({status: 'good', source: 'pose', evidence: '肩部和髋部在起身过程中保持同步。', evidenceTimes: [0.2, 0.8], frameIndices: [3, 12], ...extra});
const complete = extra => ({feedback: [finding()], coverage: {complete: true, frameCount: 30, reviewedFrameCount: 30}, quality: {targetCoverage: 1, usableRatio: 1, validFrames: 30}, action: {status: 'identified', name: '弹力带俯卧撑', exerciseId: null}, ...extra});
const standard = {status: 'standard', summary: '动作基本标准，保持肩髋同步起身。'};

test('an explicit standard verdict requires actual positive evidence and complete observation, without a catalogue ID', () => {
  assert.deepEqual(sanitizeMotionVerdict(standard, complete()), standard);
  assert.equal(sanitizeMotionVerdict(standard, complete({feedback: []})).status, 'uncertain');
  assert.equal(sanitizeMotionVerdict(undefined, complete()).status, 'uncertain');
  assert.equal(sanitizeMotionVerdict({status: 'pass'}, complete()).status, 'uncertain');
  assert.equal(sanitizeMotionVerdict({status: 'needs-improvement'}, complete()).status, 'uncertain');
});

test('retained problems override a model claim of standard and cannot be hidden by positive prose', () => {
  const result = sanitizeMotionVerdict({status: 'standard', summary: '全部标准，没有任何问题。'}, complete({feedback: [finding(), finding({status: 'improve', evidence: '起身时髋部先于肩部明显抬起。', correction: '减轻负荷，让肩髋同时起身。'})]}));
  assert.equal(result.status, 'needs-improvement');
  assert.match(result.summary, /调整|纠正/);
  assert.doesNotMatch(result.summary, /全部标准|没有任何问题/);
});

test('partial data can identify a visible problem but never declare the entire motion standard', () => {
  for (const extra of [
    {coverage: undefined}, {coverage: {complete: false}}, {coverage: {complete: true, frameCount: 100, reviewedFrameCount: 99}},
    {quality: {targetCoverage: 0.69}}, {quality: {usableRatio: 0.69}}, {quality: {validFrames: 7}}, {quality: {sourceFps: 4}},
    {quality: {reasons: ['NO_POSE']}}, {quality: {reasons: ['TARGET_ID_CHANGED']}}, {action: {status: 'unknown', name: ''}},
  ]) {
    assert.equal(sanitizeMotionVerdict(standard, complete(extra)).status, 'uncertain');
    const issue = sanitizeMotionVerdict({status: 'needs-improvement', summary: '整个视频动作不标准。'}, complete({...extra, feedback: [finding({status: 'improve'})]}));
    assert.equal(issue.status, 'needs-improvement');
    assert.match(issue.summary, /其他片段仍有看不清/);
  }
});

test('old scoring flags do not override complete evidence or dictate the new conclusion', () => {
  const result = sanitizeMotionVerdict(standard, complete({quality: {score: 69, reasons: ['INSUFFICIENT_CHECK_COVERAGE', 'SIDE_VIEW_REQUIRED']}}));
  assert.equal(result.status, 'standard');
  assert.equal(sanitizeMotionVerdict(standard, complete({feedback: [finding(), finding({status: 'uncertain'})]})).status, 'uncertain');
});

test('unsupported or empty evidence cannot turn a declaration into an observed fact', () => {
  for (const invalid of [null, {}, finding({evidence: ''}), finding({evidence: '好'}), finding({source: 'invented'}), finding({evidenceTimes: []}), finding({evidenceTimes: [NaN, Infinity, -1, 121, '1']}), finding({evidence: '评分为100分。'})]) {
    assert.equal(sanitizeMotionVerdict(standard, complete({feedback: [invalid]})).status, 'uncertain');
    assert.equal(sanitizeMotionVerdict({status: 'needs-improvement'}, complete({feedback: [{...invalid, status: 'improve'}]})).status, 'uncertain');
  }
});

test('summaries retain measurements but exclude invented ratings, markup and internal rule details', () => {
  const result = sanitizeMotionVerdict({...standard, summary: '<b>动作基本标准。</b>评分为100分。保持2分钟。LOW_TARGET_COVERAGE。规则全部通过。肘部接近90°。'}, complete());
  assert.equal(result.summary, '动作基本标准。保持2分钟。肘部接近90°。');
  assert.deepEqual(Object.keys(result).sort(), ['status', 'summary']);
  assert.equal(sanitizeMotionVerdict({...standard, summary: '动作不标准，需要纠正。'}, complete()).summary, '已观察到的动作基本标准，继续保持当前动作控制。');
  assert.ok(sanitizeMotionVerdict({...standard, summary: '动作标准。'.repeat(1000)}, complete()).summary.length <= 320);
});

test('legacy report reads never infer standard from scores, passes or qualified repetitions', () => {
  assert.equal(readMotionVerdict({score: 100, qualified: true, checks: [{status: 'pass'}]}).status, 'uncertain');
  assert.equal(readMotionVerdict({coach: {mode: 'visual', checks: [{status: 'pass', source: 'visual', evidence: '身体保持稳定。', evidenceTimes: [1]}]}}).status, 'uncertain');
  assert.deepEqual(readMotionVerdict(null), {status: 'uncertain', summary: '目前还不能确认动作是否标准，请补充清晰、完整的动作视频后再评估。'});
});

test('legacy saved visual problems survive only with concrete timed evidence and correction', () => {
  const check = {status: 'fail', source: 'visual', evidence: '起身时髋部先抬起，肩部滞后。', evidenceTimes: [1], correction: '肩髋同时起身。'};
  assert.equal(readMotionVerdict({coach: {checks: [check]}}).status, 'needs-improvement');
  for (const extra of [{evidence: ''}, {evidenceTimes: []}, {correction: ''}, {source: 'pose'}]) {
    assert.equal(readMotionVerdict({coach: {checks: [{...check, ...extra}]}}).status, 'uncertain');
  }
  assert.equal(readMotionVerdict({coach: {feedback: [], checks: [check]}}).status, 'uncertain', 'Current AI feedback takes precedence over legacy rule checks');
  assert.equal(readMotionVerdict({coach: {checks: [{...check, evidence: undefined, evidenceTimes: undefined, message: check.evidence, time: 1}]}}).status, 'needs-improvement');
});

test('new saved reports and standalone coach objects share the same conclusion', () => {
  const options = complete(), coach = {mode: 'visual', verdict: standard, feedback: options.feedback, coverage: options.coverage, action: options.action};
  assert.deepEqual(readMotionVerdict({coach, quality: options.quality}), standard);
  assert.deepEqual(readMotionVerdict(coach), standard);
  assert.equal(readMotionVerdict({coach, recognitionConflict: true}).status, 'uncertain');
  const before = structuredClone(coach);
  readMotionVerdict({coach});
  assert.deepEqual(coach, before);
});
