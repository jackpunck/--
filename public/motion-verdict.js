/** A plain-language conclusion from evidence-checked AI feedback, never a score.
 * Call sanitizeMotionFeedback before this helper: timestamps here confirm the
 * shape of retained evidence, not its correspondence to the original video.
 */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const statuses = new Set(['standard', 'needs-improvement', 'uncertain']);
const sources = new Set(['pose', 'visual', 'combined', 'analysis']);
const missingDataReasons = new Set(['INVALID_DIMENSIONS', 'NO_POSE', 'TOO_FEW_FRAMES', 'MULTIPLE_PEOPLE', 'LOW_POSE_COVERAGE', 'LOW_TARGET_COVERAGE', 'LOW_SOURCE_FRAME_RATE', 'LOW_SOURCE_RATE', 'LOW_SAMPLE_RATE', 'TARGET_ID_CHANGED', 'NO_FRAMES', 'INVALID_FRAME_TIME', 'NON_MONOTONIC_FRAME_TIMES', 'UNRESOLVED_TARGET']);
const timeIsValid = value => finite(value) && value >= 0 && value <= 120;

function cleanText(value, limit = 320) {
  if (typeof value !== 'string') return '';
  const clean = value.slice(0, 10000)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/<[^>]*>/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*#~]/g, '').replace(/\r\n?/g, '\n').trim();
  const ratingOrInternal = /(?:\d+(?:\.\d+)?\s*分(?!钟)|\d+(?:\.\d+)?\s*\/\s*100\b|满分|参考分|规则|检查覆盖|(?:评分|得分|分数|标准率|标准度|准确率|准确度|合格率|置信度|\b(?:score|rating|accuracy|confidence)\b)[^。！？\n]{0,40}\d|\d+(?:\.\d+)?\s*[%％]\s*(?:准确|合格|标准|accurate|accuracy)|\b[A-Z]{2,}(?:_[A-Z]+)+\b)/i;
  return clean.split(/(?<=[。！？；;\n])|(?<=[.!?])\s+/).filter(sentence => !ratingOrInternal.test(sentence)).join('').replace(/_/g, '').trim().slice(0, limit);
}

function retainedFinding(item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    && sources.has(item.source) && ['good', 'improve', 'uncertain'].includes(item.status)
    && cleanText(item.evidence, 1200).replace(/\s/g, '').length >= 4
    && Array.isArray(item.evidenceTimes) && item.evidenceTimes.some(timeIsValid);
}

function incompleteObservation(coverage, quality) {
  if (coverage?.complete !== true) return true;
  if (finite(coverage.frameCount) && finite(coverage.reviewedFrameCount) && coverage.reviewedFrameCount < coverage.frameCount) return true;
  if (finite(quality?.targetCoverage) && quality.targetCoverage < 0.7 || finite(quality?.usableRatio) && quality.usableRatio < 0.7) return true;
  if (finite(quality?.validFrames) && quality.validFrames < 8 || finite(quality?.sourceFps) && quality.sourceFps < 5) return true;
  return (Array.isArray(quality?.reasons) ? quality.reasons : []).some(reason => missingDataReasons.has(reason));
}

/** Accept model conclusions only when retained evidence supports them.
 * Coverage means all supplied data was reviewed, not that every joint was seen.
 * A visible problem can still warrant a correction when the rest is unknown.
 * No directory action ID or local rule verdict is needed to assess an exercise.
 */
export function sanitizeMotionVerdict(value, {feedback = [], coverage, quality, action} = {}) {
  const requested = value && typeof value === 'object' && !Array.isArray(value) && statuses.has(value.status) ? value.status : null;
  const findings = (Array.isArray(feedback) ? feedback : []).filter(retainedFinding);
  const improvements = findings.filter(item => item.status === 'improve');
  const incomplete = incompleteObservation(coverage, quality);
  const unknownAction = action !== undefined && (!action || action.status !== 'identified' || typeof action.name !== 'string' || !action.name.trim());
  let status = 'uncertain';
  if (improvements.length) status = 'needs-improvement';
  else if (requested === 'standard' && !incomplete && !unknownAction && findings.some(item => item.status === 'good') && !findings.some(item => item.status === 'uncertain')) status = 'standard';
  const defaults = {
    standard: '已观察到的动作基本标准，继续保持当前动作控制。',
    'needs-improvement': incomplete || unknownAction ? '已看到需要纠正的动作问题，其他片段仍有看不清的地方。请先按下面的建议调整。' : '动作有需要调整的地方，请先按下面的建议纠正。',
    uncertain: '目前还不能确认动作是否标准，请补充清晰、完整的动作视频后再评估。',
  };
  // A rejected conclusion must not survive in its prose. For partial evidence,
  // use a scoped sentence even if the model claimed to assess the whole video.
  let summary = requested === status && !(status === 'needs-improvement' && (incomplete || unknownAction)) ? cleanText(value.summary) : '';
  if (status === 'standard' && /(?:不标准|不规范|需要(?:改进|纠正)|needs? improvement|not standard)/i.test(summary)) summary = '';
  if (status !== 'standard' && /(?:完全|全部|非常|十分)(?:标准|规范)|没有(?:任何)?问题|无需(?:纠正|调整)|no (?:issues|correction needed)/i.test(summary)) summary = '';
  return {status, summary: summary || defaults[status]};
}

function legacyVisualFeedback(coach) {
  return (Array.isArray(coach?.checks) ? coach.checks : []).flatMap(check => {
    const evidence = cleanText(check?.evidence) || cleanText(check?.message);
    if (check?.status !== 'fail' || check.source !== 'visual' || !evidence || !cleanText(check.correction)) return [];
    const times = [...(Array.isArray(check.evidenceTimes) ? check.evidenceTimes : []), check.time].filter(timeIsValid);
    if (!times.length) return [];
    return [{status: 'improve', source: 'visual', evidence, evidenceTimes: times, correction: check.correction}];
  });
}

/** Read saved reports from either report schema. Old local passes/scores never
 * imply that an AI assessed the movement as standard. A newer explicit feedback
 * array, including an empty one, takes precedence over old rule-based checks.
 */
export function readMotionVerdict(report = {}) {
  if (report?.recognitionConflict === true) return {status: 'uncertain', summary: '动作类型还未确认，请补充能看清身体和器械的完整动作视频。'};
  const coach = report?.coach || (report?.mode && typeof report.mode === 'string' ? report : null);
  const feedback = Array.isArray(coach?.feedback) ? coach.feedback : legacyVisualFeedback(coach);
  return sanitizeMotionVerdict(coach?.verdict, {feedback, coverage: coach?.coverage, quality: report?.quality, action: coach?.action});
}
