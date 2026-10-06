import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMotionVerdict, readMotionVerdict} from '../public/motion-verdict.js';

const finding = extra => ({status: 'good', source: 'pose', evidence: '肩部和髋部在起身过程中保持同步。', evidenceTimes: [0.2, 0.8], frameIndices: [3, 12], ...extra});
const complete = extra => ({feedback: [finding()], coverage: {complete: true, frameCount: 30, reviewedFrameCount: 30}, quality: {targetCoverage: 1, usableRatio: 1, validFrames: 30}, action: {status: 'identified', name: '弹力带俯卧撑', exerciseId: null}, ...extra});
const standard = {status: 'standard', summary: '动作基本标准，保持肩髋同步起身。'};
const relativeStandard = {status: 'standard', summary: '暂时找不出问题。'};
const improvement = extra => finding({status: 'improve', evidence: '起身时髋部先于肩部明显抬起。', correction: '减轻负荷，让肩髋同时起身。', ...extra});

test('standard requires explicit positive evidence; uncertainty is never promoted to standard', () => {
  for (const feedback of [[finding()], [finding(), finding({status: 'uncertain'})]]) {
    assert.deepEqual(sanitizeMotionVerdict(standard, complete({feedback})), relativeStandard);
    assert.equal(sanitizeMotionVerdict({status: 'uncertain'}, complete({feedback})).status, 'uncertain');
  }
  for (const feedback of [[], [finding({status: 'uncertain'})]]) {
    assert.equal(sanitizeMotionVerdict(standard, complete({feedback})).status, 'uncertain');
  }
});

test('a missing or invalid AI verdict and an unsupported problem claim remain unevaluated', () => {
  for (const verdict of [undefined, null, [], {}, {status: 'pass'}, {status: 'needs-improvement'}]) {
    assert.equal(sanitizeMotionVerdict(verdict, complete()).status, 'uncertain');
  }
});

test('retained problems override a model claim of standard and cannot be hidden by positive prose', () => {
  const result = sanitizeMotionVerdict({status: 'standard', summary: '全部标准，没有任何问题。'}, complete({feedback: [finding(), improvement()]}));
  assert.equal(result.status, 'needs-improvement');
  assert.match(result.summary, /调整|纠正/);
  assert.doesNotMatch(result.summary, /全部标准|没有任何问题/);
});

test('partial observations permit only an explicitly supported scoped positive conclusion', () => {
  for (const extra of [
    {quality: {targetCoverage: 0.45}}, {quality: {usableRatio: 0.1}}, {quality: {validFrames: 1}}, {quality: {sourceFps: 4}},
  ]) {
    assert.equal(sanitizeMotionVerdict(standard, complete({...extra, feedback: []})).status, 'uncertain');
    assert.deepEqual(sanitizeMotionVerdict(standard, complete(extra)), relativeStandard);
    assert.equal(sanitizeMotionVerdict({status: 'uncertain'}, complete(extra)).status, 'uncertain');
  }
});

test('unknown actions and changing targets cannot receive a standard verdict', () => {
  for (const extra of [{action: undefined}, {action: {status: 'unknown'}}, {action: {status: 'candidate', name: '深蹲'}}, {action: {status: 'identified', name: ''}}, {quality: {reasons: ['TARGET_ID_CHANGED']}}]) {
    assert.equal(sanitizeMotionVerdict(standard, complete(extra)).status, 'uncertain');
  }
});

test('saved reports with explicit unknown placeholder names cannot display standard', () => {
  for (const name of ['未知动作', '无法识别', ' Unknown  Action ', 'UNIDENTIFIED']) {
    const options = complete({action: {status: 'identified', name, exerciseId: null}});
    assert.equal(readMotionVerdict({quality: options.quality, coach: {...options, verdict: standard}}).status, 'uncertain', name);
  }
  assert.equal(readMotionVerdict({coach: {...complete({action: {status: 'identified', name: '反手窄距坐姿划船'}}), verdict: standard}}).status, 'standard');
});

test('incomplete reviews and wholly empty observations cannot produce a standard conclusion', () => {
  for (const extra of [
    {coverage: undefined}, {coverage: {complete: false}}, {coverage: {complete: true, frameCount: 100, reviewedFrameCount: 99}},
    ...['totalFrames', 'validFrames', 'usableRatio', 'targetCoverage'].map(key => ({quality: {[key]: 0}})),
    ...['NO_POSE', 'NO_FRAMES', 'INVALID_DIMENSIONS'].map(reason => ({quality: {reasons: [reason]}})),
  ]) {
    assert.equal(sanitizeMotionVerdict(standard, complete(extra)).status, 'uncertain');
    assert.equal(sanitizeMotionVerdict({status: 'uncertain'}, complete(extra)).status, 'uncertain');
  }
});

test('retained concrete problems remain visible even when the overall review is incomplete', () => {
  for (const extra of [{coverage: undefined}, {coverage: {complete: false}}, {quality: {targetCoverage: 0.45}}, {action: {status: 'unknown'}}]) {
    const issue = sanitizeMotionVerdict(standard, complete({...extra, feedback: [improvement()]}));
    assert.equal(issue.status, 'needs-improvement');
    assert.match(issue.summary, /具体的动作问题/);
  }
});

test('old scoring flags do not override complete evidence or dictate the new conclusion', () => {
  const result = sanitizeMotionVerdict(standard, complete({quality: {score: 69, reasons: ['INSUFFICIENT_CHECK_COVERAGE', 'SIDE_VIEW_REQUIRED']}}));
  assert.deepEqual(result, relativeStandard);
});

test('unsupported evidence or absent corrections cannot create a concrete problem', () => {
  for (const invalid of [null, {}, improvement({evidence: ''}), improvement({evidence: '好'}), improvement({source: 'invented'}), improvement({evidenceTimes: []}), improvement({evidenceTimes: [NaN, Infinity, -1, 121, '1']}), improvement({evidence: '评分为100分。'}), improvement({correction: ''}), improvement({correction: undefined}), improvement({correction: '评分为100分。'})]) {
    assert.equal(sanitizeMotionVerdict(standard, complete({feedback: [invalid]})).status, 'uncertain');
    assert.equal(sanitizeMotionVerdict({status: 'needs-improvement'}, complete({feedback: [invalid]})).status, 'uncertain');
  }
});

test('standard summaries describe no finding instead of declaring correctness', () => {
  for (const summary of ['全部标准，没有任何问题。', '动作不标准，需要纠正。', '仅有二维骨架，不能判断肌肉发力。', '动作标准。'.repeat(1000)]) {
    assert.deepEqual(sanitizeMotionVerdict({...standard, summary}, complete()), relativeStandard);
  }
});

test('problem summaries retain measurements but exclude invented ratings, markup and internal rule details', () => {
  const options = complete({feedback: [improvement()]});
  const result = sanitizeMotionVerdict({status: 'needs-improvement', summary: '<b>起身时肩髋不同步。</b>评分为100分。保持2分钟。LOW_TARGET_COVERAGE。规则全部通过。肘部接近90°。'}, options);
  assert.equal(result.summary, '起身时肩髋不同步。保持2分钟。肘部接近90°。');
  assert.deepEqual(Object.keys(result).sort(), ['status', 'summary']);
  assert.ok(sanitizeMotionVerdict({status: 'needs-improvement', summary: '需要调整肩髋同步。'.repeat(1000)}, options).summary.length <= 320);
});

test('legacy report reads never infer standard from scores, passes or qualified repetitions', () => {
  assert.equal(readMotionVerdict({score: 100, qualified: true, checks: [{status: 'pass'}]}).status, 'uncertain');
  assert.equal(readMotionVerdict({coach: {mode: 'visual', checks: [{status: 'pass', source: 'visual', evidence: '身体保持稳定。', evidenceTimes: [1]}]}}).status, 'uncertain');
  assert.deepEqual(readMotionVerdict(null), {status: 'uncertain', summary: '暂时找不出问题。'});
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
  assert.deepEqual(readMotionVerdict({coach, quality: options.quality}), relativeStandard);
  assert.deepEqual(readMotionVerdict(coach), relativeStandard);
  assert.equal(readMotionVerdict({coach, recognitionConflict: true}).status, 'uncertain');
  const before = structuredClone(coach);
  readMotionVerdict({coach});
  assert.deepEqual(coach, before);
});

test('all no-finding outcomes share the same summary while uncertainty remains recorded', () => {
  for (const extra of [
    {feedback: []}, {quality: {validFrames: 0, reasons: ['NO_POSE']}}, {coverage: {complete: false}},
    {action: {status: 'unknown'}},
    ...['uncertain','mismatch'].map(status => ({action: {status: 'selected', source: 'user', name: '深蹲'},
      selectionCheck: {status, evidence: '画面中的支撑位置不能确认。', evidenceTimes: [1]}})),
  ]) {
    for (const summary of ['无法评估动作。', '拍摄角度不足，无法识别。', '动作标准，没有问题。']) {
      assert.deepEqual(sanitizeMotionVerdict({status: 'uncertain', summary}, complete(extra)),
        {status: 'uncertain', summary: '暂时找不出问题。'});
    }
  }
  assert.deepEqual(readMotionVerdict({recognitionConflict: true}), {status: 'uncertain', summary: '暂时找不出问题。'});
});
