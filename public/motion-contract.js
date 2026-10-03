import {motionExercises, motionFamilies, getMotionExercise} from './motion-catalog.js';
import {sanitizeMotionVerdict} from './motion-verdict.js';

export const MOTION_COACH_VERSION = 'motion-coach-v4';
export const MOTION_REPORT_VERSION = 'motion-report-v1';
export const MOTION_COACH_LIMITS = Object.freeze({maxFrames: 6, maxFrameBytes: 512 * 1024, maxImageBytes: 2 * 1024 * 1024, maxAnalysisBytes: 128 * 1024});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, limit) : '';
const narrative = value => text(value, 1200).split(/(?<=[。！？；;\n])|(?<=[.!?])\s+/).filter(sentence => !/(?:\d+(?:\.\d+)?\s*分(?!钟)|\d+\s*\/\s*100|满分|参考分|(?:评分|得分|分数|标准率|合格率)[^。！？\n]{0,40}\d)/i.test(sentence)).join('').trim();
const validTime = value => finite(value) && value >= 0 && value <= 120;
const times = (value, limit = 12) => [...new Set((Array.isArray(value) ? value : []).filter(validTime))].slice(0, limit);
const supportedFamily = value => typeof value === 'string' && Object.hasOwn(motionFamilies, value) ? value : null;
const confidences = new Set(['high', 'medium', 'low']);
const qualityReasons = new Set(['NO_FRAMES', 'INVALID_DIMENSIONS', 'TARGET_ID_CHANGED', 'INVALID_FRAME_TIME', 'NON_MONOTONIC_FRAME_TIMES', 'TARGET_NOT_LOCKED', 'UNRESOLVED_TARGET', 'NO_VISIBLE_PERSON', 'MISSING_OR_UNCERTAIN_LANDMARKS']);

function compactQuality(value) {
  const quality = {};
  for (const key of ['totalFrames', 'validFrames']) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0 && value[key] <= 1800) quality[key] = value[key];
  for (const key of ['usableRatio', 'targetCoverage']) if (value?.[key] === null || finite(value?.[key]) && value[key] >= 0 && value[key] <= 1) quality[key] = value[key];
  if (value?.sourceFps === null || finite(value?.sourceFps) && value.sourceFps > 0 && value.sourceFps <= 1000) quality.sourceFps = value.sourceFps;
  quality.reasons = [...new Set((Array.isArray(value?.reasons) ? value.reasons : []).filter(reason => qualityReasons.has(reason)))];
  return quality;
}

function compactBox(value) {
  const keys = ['xMin', 'yMin', 'xMax', 'yMax'];
  if (!value || !keys.every(key => finite(value[key]) && value[key] >= 0 && value[key] <= 1) || value.xMin >= value.xMax || value.yMin >= value.yMax) return undefined;
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function compactEvidenceFrame(frame) {
  const result = {};
  for (const key of ['time', 'imageTime', 'requestedTime', 'poseTime', 'sourceTime']) if (validTime(frame?.[key])) result[key] = frame[key];
  if (['equipment-context', 'target-detail'].includes(frame?.framing)) result.framing = frame.framing;
  if (['seek-target', 'source-pts'].includes(frame?.timePrecision)) result.timePrecision = frame.timePrecision;
  for (const key of ['crop', 'bbox', 'targetBox']) { const box = compactBox(frame?.[key]); if (box) result[key] = box; }
  for (const key of ['width', 'height']) if (Number.isSafeInteger(frame?.[key]) && frame[key] > 0 && frame[key] <= 16384) result[key] = frame[key];
  const tracking = frame?.subjectTracking;
  if (object(tracking)) {
    const subject = {};
    if (['locked', 'ambiguous', 'lost'].includes(tracking.status)) subject.status = tracking.status;
    if (typeof tracking.trackId === 'string') subject.trackId = text(tracking.trackId, 80);
    if (finite(tracking.confidence) && tracking.confidence >= 0 && tracking.confidence <= 1) subject.confidence = tracking.confidence;
    const bbox = compactBox(tracking.bbox); if (bbox) subject.bbox = bbox;
    result.subjectTracking = subject;
  }
  if (Array.isArray(frame?.frameMappings)) result.frameMappings = frame.frameMappings.slice(0, 6).map(mapping => Object.fromEntries(['requestedTime', 'poseTime', 'sourceTime'].filter(key => validTime(mapping?.[key])).map(key => [key, mapping[key]])));
  return result;
}

/** Only quality and supplied-picture metadata belong in the navigation summary.
 * Complete pose samples and measurements travel separately, without scoring. */
export function compactMotionAnalysis(value = {}) {
  return {quality: compactQuality(value?.quality), evidenceFrames: (Array.isArray(value?.evidenceFrames) ? value.evidenceFrames : []).slice(0, 6).filter(object).map(compactEvidenceFrame)};
}

function identity(value) {
  if (!object(value)) return null;
  const name = text(value.name, 80).replace(/\s+/g, ' ');
  const suppliedId = value.exerciseId;
  if (suppliedId !== undefined && suppliedId !== null && (typeof suppliedId !== 'string' || !getMotionExercise(suppliedId))) return null;
  const byId = getMotionExercise(suppliedId);
  const byName = motionExercises.find(item => item.name === name);
  if (byId && name && name !== byId.name) return null;
  const catalog = byId || byName;
  if (catalog && value.family !== undefined && value.family !== null && value.family !== catalog.family) return null;
  const resolvedName = name || catalog?.name;
  if (!resolvedName) return null;
  return {exerciseId: catalog?.id || null, name: resolvedName, family: catalog?.family || supportedFamily(value.family)};
}

function actionWithEvidence(value, available) {
  const resolved = identity(value);
  if (!resolved) return null;
  const evidenceTimes = times(value.evidenceTimes).filter(time => available.has(time));
  const evidence = narrative(value.evidence || value.observations?.evidence);
  if (evidence.replace(/\s/g, '').length < 4 || !evidenceTimes.length) return null;
  return {...resolved, evidenceTimes, evidence};
}

function confirmedAction(value, available) {
  if (value?.status !== 'identified' || value?.confidence !== 'high') return null;
  const action = actionWithEvidence(value, available);
  return action && action.evidenceTimes.length >= 2 ? {...action, status: 'identified', confidence: 'high'} : null;
}

const unknownAction = () => ({exerciseId: null, name: '', family: null, status: 'unknown', confidence: 'low', evidenceTimes: [], evidence: ''});

/** Only call with a coach whose image references have already been validated. */
export function confirmedMotionAction(coach) {
  return coach?.mode === 'visual' ? confirmedAction(coach.action, new Set(times(coach.action?.evidenceTimes))) : null;
}

/** Validate identity against the pictures actually sent. No action-specific
 * posture or equipment rules decide the answer, and no checks are generated. */
export function sanitizeMotionCoachResponse(value, {mode = 'evidence-only', keyframes = []} = {}) {
  if (!object(value)) throw new Error('动作评价结构无效，请重试。');
  const available = new Set(times((Array.isArray(keyframes) ? keyframes : []).map(frame => frame?.time)));
  const visual = mode === 'visual' && available.size > 0;
  const action = visual ? confirmedAction(value.action, available) || unknownAction() : unknownAction();
  const candidates = [];
  if (visual) for (const raw of [value.action, ...(Array.isArray(value.candidates) ? value.candidates : [])].slice(0, 24)) {
    const candidate = actionWithEvidence(raw, available);
    if (!candidate || candidates.some(item => item.name === candidate.name)) continue;
    candidates.push({...candidate, confidence: confirmedAction(raw, available) ? 'high' : confidences.has(raw.confidence) && raw.confidence !== 'high' ? raw.confidence : 'low'});
    if (candidates.length >= 3) break;
  }
  return {version: MOTION_COACH_VERSION, mode: visual ? 'visual' : 'evidence-only', action, candidates,
    overallEvaluation: narrative(value.overallEvaluation), limitations: (Array.isArray(value.limitations) ? value.limitations : []).map(narrative).filter(Boolean).slice(0, 3)};
}

function compactFeedback(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).filter(item => object(item) && ['good', 'improve', 'uncertain'].includes(item.status) && ['pose', 'visual', 'combined', 'analysis'].includes(item.source)).map(item => {
    const evidenceTimes = times(item.evidenceTimes, 1806);
    const frameIndices = [...new Set((Array.isArray(item.frameIndices) ? item.frameIndices : []).filter(index => Number.isInteger(index) && index >= 0 && index < 1800))];
    const paths = (Array.isArray(item.analysisPaths) ? item.analysisPaths : []).filter(path => Array.isArray(path) && path.length >= 2 && path.length <= 12 && path[0] === 'measurements' && path.every(part => Number.isInteger(part) && part >= 0 || typeof part === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(part) && !['__proto__', 'constructor', 'prototype'].includes(part))).slice(0, 12);
    return {title: text(item.title, 80), status: item.status, source: item.source, frameIndices, evidenceTimes, time: evidenceTimes[0] ?? null,
      ...(paths.length ? {analysisPaths: paths.map(path => [...path])} : {}), evidence: narrative(item.evidence), correction: narrative(item.correction), priority: [1, 2, 3].includes(item.priority) ? item.priority : 2};
  }).filter(item => item.title && item.evidence.replace(/\s/g, '').length >= 4 && item.evidenceTimes.length);
}

function compactCoach(value, quality) {
  if (!object(value)) return null;
  const references = [...times(value.action?.evidenceTimes), ...(Array.isArray(value.candidates) ? value.candidates : []).flatMap(candidate => times(candidate?.evidenceTimes))];
  const clean = sanitizeMotionCoachResponse(value, {mode: value.mode, keyframes: times(references).map(time => ({time}))});
  const result = {version: clean.version, mode: value.mode === 'visual' ? 'visual' : 'evidence-only', action: clean.action, candidates: clean.candidates, feedback: compactFeedback(value.feedback), limitations: clean.limitations};
  for (const key of ['model', 'provider']) if (typeof value[key] === 'string') result[key] = text(value[key], 160);
  if (object(value.coverage)) {
    result.coverage = {complete: value.coverage.complete === true};
    for (const key of ['frameCount', 'reviewedFrameCount', 'measurementCount', 'reviewedMeasurementCount', 'dataBatches', 'modelCalls']) if (Number.isSafeInteger(value.coverage[key]) && value.coverage[key] >= 0) result.coverage[key] = value.coverage[key];
  }
  if (object(value.timing)) result.timing = Object.fromEntries(['providerMs', 'totalMs'].filter(key => finite(value.timing[key]) && value.timing[key] >= 0).map(key => [key, value.timing[key]]));
  result.verdict = sanitizeMotionVerdict(value.verdict, {feedback: result.feedback, coverage: result.coverage, quality, action: result.action});
  return result;
}

/** Build the saved report from an allowlist. Local measurements are request
 * evidence only; no raw sequences, repetition engine or rule results persist. */
export function mergeCoachAssessment(analysis, coach) {
  const quality = compactQuality(analysis?.quality);
  const cleanedCoach = compactCoach(coach, quality);
  const action = confirmedMotionAction(cleanedCoach);
  return {version: MOTION_REPORT_VERSION, quality, exerciseId: action?.exerciseId || null, exerciseName: action?.name || '', exerciseFamily: action?.family || null,
    recognitionSource: action ? 'visual' : 'unknown', coach: cleanedCoach};
}

/** Identity hints for known teaching names, never an evaluation rubric. */
export const motionCoachActionCatalog = () => motionExercises.map(({id, name, family}) => ({id, name, family}));
