import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMotionCoachResponse, confirmedMotionAction, mergeCoachAssessment} from '../public/motion-contract.js';

const frames = [{time: 1}, {time: 2}, {time: 3}];
const action = extra => ({exerciseId: null, name: '引体向上', family: 'vertical-pull', status: 'identified', confidence: 'high', evidence: '双手握住单杠，身体从悬垂位置上升，随后还原。', evidenceTimes: [1, 2], ...extra});
const sanitize = (value, options = {}) => sanitizeMotionCoachResponse(value, {mode: 'visual', keyframes: frames, ...options});

test('open action names keep their visual identity independently of the teaching catalogue', () => {
  for (const name of ['引体向上', '负重引体向上', '弹力带面拉', '双杠臂屈伸']) {
    const coach = sanitize({action: action({name})});
    assert.equal(coach.action.status, 'identified');
    assert.equal(coach.action.exerciseId, name==='引体向上'?'bodyweight-pullup':null);
    assert.equal(coach.action.name, name);
    const report = mergeCoachAssessment({quality: {usableRatio: 1}}, coach);
    assert.equal(report.exerciseName, name);
    assert.equal(report.exerciseId, name==='引体向上'?'bodyweight-pullup':null);
    assert.deepEqual(confirmedMotionAction(coach), coach.action);
  }
});

test('an unknown movement family does not prohibit a visually evidenced open action', () => {
  const coach = sanitize({action: action({name: '波比跳', family: 'burpee'})});
  assert.equal(coach.action.status, 'identified');
  assert.equal(coach.action.family, null);
  assert.equal(coach.action.name, '波比跳');
  assert.equal(mergeCoachAssessment({}, coach).exerciseFamily, null);
});

test('explicit unknown names cannot become identified or standard despite high confidence and positive evidence', () => {
  for (const name of ['未知动作', '未知', '无法识别', '无法识别动作', '未识别', '动作未识别', 'unknown', ' Unknown   Action ', 'UNIDENTIFIED']) {
    const raw = {mode: 'visual', action: action({name}), verdict: {status: 'standard'},
      coverage: {complete: true, strategy: 'visual-keyframes', imageCount: 2, reviewedImageCount: 2},
      feedback: [{title: '支撑稳定', status: 'good', source: 'visual', evidenceTimes: [1,2], evidence: '两张图中支撑位置保持稳定。', correction: '保持稳定支撑。'}]};
    const coach = sanitize(raw);
    assert.equal(coach.action.status, 'unknown', name);
    assert.deepEqual(coach.candidates, [], name);
    const report = mergeCoachAssessment({}, raw);
    assert.equal(report.exerciseName, '', name);
    assert.equal(report.coach.verdict.status, 'uncertain', name);
  }
  const open = sanitize({action: action({name: '反手窄距坐姿划船', family: 'row'})});
  assert.equal(open.action.status, 'identified');
  assert.equal(open.action.exerciseId, null);
});

test('an inconsistent known teaching ID cannot relabel an open action', () => {
  const coach = sanitize({action: action({exerciseId: 'pullup'})});
  assert.equal(coach.action.status, 'unknown');
  assert.equal(coach.candidates.length, 0);
  assert.equal(mergeCoachAssessment({}, coach).exerciseName, '');
});

test('known assistance and equipment names require evidence but no hardcoded equipment fields', () => {
  for (const [exerciseId, name, family] of [
    ['pullup', '辅助引体向上', 'vertical-pull'],
    ['barbell-bench', '杠铃卧推', 'horizontal-press'],
    ['machine-row', '器械划船', 'row'],
  ]) {
    const coach = sanitize({action: action({exerciseId, name, family, observations: undefined})});
    assert.equal(coach.action.status, 'identified');
    assert.equal(coach.action.exerciseId, exerciseId);
    assert.equal(coach.action.observations, undefined);
    assert.equal(coach.action.recognitionRules, undefined);
  }
});

test('candidates are bounded, deduplicated and cannot borrow nonexistent picture references', () => {
  const coach = sanitize({action: action({confidence: 'medium'}), candidates: [
    action({name: '引体向上', confidence: 'medium'}),
    action({name: '负重引体向上', confidence: 'medium', evidenceTimes: [2]}),
    action({name: '候选三', family: null, confidence: 'high', evidenceTimes: [3, 99]}),
    action({name: '候选四', family: null}), action({name: '无图候选', family: null, evidenceTimes: [99]}),
  ]});
  assert.equal(coach.action.status, 'unknown');
  assert.deepEqual(coach.candidates.map(item => item.name), ['引体向上', '负重引体向上', '候选三']);
  assert.deepEqual(coach.candidates.map(item => item.confidence), ['medium', 'medium', 'low']);
  assert.deepEqual(coach.candidates[2].evidenceTimes, [3]);
  assert.equal(confirmedMotionAction(coach), null);
  const saved = mergeCoachAssessment({}, coach);
  assert.equal(saved.coach.mode, 'visual');
  assert.deepEqual(saved.coach.candidates, coach.candidates);
});

test('text-only replies never invent visual confirmation from raw bone coordinates', () => {
  const coach = sanitize({action: action()}, {mode: 'evidence-only'});
  assert.equal(coach.mode, 'evidence-only');
  assert.equal(coach.action.status, 'unknown');
  assert.deepEqual(coach.candidates, []);
});

test('the identity contract ignores old checks and excludes ratings from narrative', () => {
  const coach = sanitize({action: action(), checks: [{code: 'PULL_SWING', status: 'fail', score: 49}], score: 99,
    overallEvaluation: '得分99分。身体上升过程可见肩髋同步。', limitations: ['参考分69分。', '下半身有遮挡。']});
  assert.equal(coach.checks, undefined);
  assert.equal(coach.score, undefined);
  assert.equal(coach.overallEvaluation, '身体上升过程可见肩髋同步。');
  assert.deepEqual(coach.limitations, ['下半身有遮挡。']);
  assert.equal(sanitize({action: action()}).action.status, 'identified', 'checks is not required');
  for (const value of [null, [], 'not JSON', 42]) assert.throws(() => sanitize(value), /结构无效/);
});
