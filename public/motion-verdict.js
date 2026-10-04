/** A plain-language conclusion from evidence-checked AI feedback, never a score.
 * Call sanitizeMotionFeedback before this helper: timestamps here confirm the
 * shape of retained evidence, not its correspondence to the original video.
 */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const statuses = new Set(['standard', 'needs-improvement', 'uncertain']);
const sources = new Set(['pose', 'visual', 'combined', 'analysis']);
const unusableDataReasons = new Set(['INVALID_DIMENSIONS', 'NO_POSE', 'NO_FRAMES']);
const timeIsValid = value => finite(value) && value >= 0 && value <= 120;
// Whole-name placeholders are shared by incoming identity validation and old
// saved-report display; this does not reject legitimate uncatalogued variants.
const unknownActionNames = new Set(['未知动作', '未知', '无法识别', '无法识别动作', '未识别', '动作未识别', 'unknown', 'unknown action', 'unidentified']);
export function isUnknownMotionActionName(value) {
  return typeof value === 'string' && unknownActionNames.has(value.trim().replace(/\s+/g, ' ').toLowerCase());
}

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

function incompleteReview(coverage) {
  if (coverage?.complete !== true) return true;
  if (coverage.strategy === 'visual-keyframes' && (!Number.isInteger(coverage.reviewedImageCount) || coverage.reviewedImageCount < 1
      || finite(coverage.imageCount) && coverage.reviewedImageCount < coverage.imageCount)) return true;
  if (finite(coverage.frameCount) && finite(coverage.reviewedFrameCount) && coverage.reviewedFrameCount < coverage.frameCount) return true;
  return false;
}
function noObservations(quality) {
  return ['totalFrames','validFrames','usableRatio','targetCoverage'].some(key=>quality?.[key]===0)
    || (Array.isArray(quality?.reasons)?quality.reasons:[]).some(reason=>unusableDataReasons.has(reason));
}

/** A standard conclusion requires an explicit, supported AI assessment.
 * Absence of detected problems is not evidence of correct form. Preserve an
 * uncertain verdict, including when the model could not identify the action.
 * A visible concrete problem can still be reported from a partial review.
 */
export function sanitizeMotionVerdict(value, {feedback = [], coverage, quality, action} = {}) {
  const requested = value && typeof value === 'object' && !Array.isArray(value) && statuses.has(value.status) ? value.status : null;
  const findings = (Array.isArray(feedback) ? feedback : []).filter(retainedFinding);
  const improvements = findings.filter(item => item.status === 'improve' && cleanText(item.correction));
  const positives = findings.filter(item => item.status === 'good');
  const identified = action?.status === 'identified' && !isUnknownMotionActionName(action.name) && (cleanText(action.name) || cleanText(action.exerciseId));
  const identityChanged = quality?.reasons?.includes('TARGET_ID_CHANGED');
  const incomplete = incompleteReview(coverage);
  const visualEvidence = coverage?.strategy === 'visual-keyframes' && coverage.reviewedImageCount > 0
    && positives.some(item => ['visual','combined'].includes(item.source));
  let status = 'uncertain';
  if (improvements.length) status = 'needs-improvement';
  else if (requested === 'standard' && identified && positives.length && !incomplete && (visualEvidence || !noObservations(quality)) && !identityChanged) status = 'standard';
  const defaults = {
    standard: coverage?.strategy === 'visual-keyframes' ? '动作相对标准，当前可见画面中未发现明确需要纠正的问题。' : '动作相对标准，当前可见画面和骨架数据中未发现明确需要纠正的问题。',
    'needs-improvement': '发现了具体的动作问题，请按下面的建议调整。',
    uncertain: '目前还不能确认动作是否标准，请补充清晰、完整的动作视频后再评估。',
  };
  // Use the requested relative wording consistently, including old AI responses
  // that overstate certainty or only repeat general limitations of 2D poses.
  let summary = status!=='standard' && requested === status ? cleanText(value.summary) : '';
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
