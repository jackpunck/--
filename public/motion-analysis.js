/**
 * Objective measurements of the selected person's image-plane pose.
 * These angles describe a 2D projection; they do not judge exercise technique
 * or infer anatomical 3D angles from the model's estimated depth coordinates.
 */
export const MOTION_OBSERVATION_VERSION = 'motion-observations-v1';

const SIDES = [[11, 13, 15, 23, 25, 27], [12, 14, 16, 24, 26, 28]];
const MEASUREMENTS = ['elbowAngle', 'shoulderAngle', 'hipAngle', 'kneeAngle', 'bodyAlignmentAngle', 'torsoLean'];
const emptyMeasurements = () => Object.fromEntries(MEASUREMENTS.map(name => [name, null]));
const validTime = value => Number.isFinite(value) && value >= 0;
const lockedTarget = tracking => tracking?.status === 'locked'
  && Number.isFinite(tracking.confidence) && tracking.confidence >= 0.65 && tracking.confidence <= 1
  && typeof tracking.trackId === 'string' && tracking.trackId.trim().length > 0;

function imagePoint(value, width, height) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)
    || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1
    || !Number.isFinite(value.visibility) || value.visibility < 0.55 || value.visibility > 1) return null;
  return {x: value.x * width, y: value.y * height};
}

function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const ax = a.x - b.x, ay = a.y - b.y, cx = c.x - b.x, cy = c.y - b.y;
  const firstLength = Math.hypot(ax, ay), secondLength = Math.hypot(cx, cy);
  if (!(firstLength > 0) || !(secondLength > 0) || !Number.isFinite(firstLength) || !Number.isFinite(secondLength)) return null;
  const cosine = (ax / firstLength) * (cx / secondLength) + (ay / firstLength) * (cy / secondLength);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

function measureSide(landmarks, side, width, height) {
  const [shoulder, elbow, wrist, hip, knee, ankle] = SIDES[side].map(index => imagePoint(landmarks?.[index], width, height));
  const torsoLength = shoulder && hip ? Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) : 0;
  return {
    elbowAngle: angleAt(shoulder, elbow, wrist),
    shoulderAngle: angleAt(hip, shoulder, elbow),
    hipAngle: angleAt(shoulder, hip, knee),
    kneeAngle: angleAt(hip, knee, ankle),
    bodyAlignmentAngle: angleAt(shoulder, hip, ankle),
    // The unsigned angle to the image's vertical axis, in degrees (0–90).
    torsoLean: torsoLength > 0 && Number.isFinite(torsoLength)
      ? Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180 / Math.PI : null,
  };
}

/**
 * Retains one measurement row per input frame, including missing poses.
 * frameIndex refers to the original array index; timestamps are never sorted,
 * deduplicated or used to cut away a preparation, pause or incomplete movement.
 * A valid frame has at least one measurable angle, not necessarily every joint.
 * Visibility and target-confidence gates only decide whether data can be used.
 *
 * @param {Array<{time:number,landmarks:Array,subjectTracking?:object,personCount?:number}>} frames
 * @param {{width:number,height:number,duration?:number,sourceFps?:number|null}} options Original display dimensions after rotation.
 */
export function analyzeMotion(frames, {width, height, sourceFps} = {}) {
  const samples = Array.isArray(frames) ? frames : [];
  const reasons = new Set();
  const dimensionsValid = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const hasTracking = samples.some(frame => frame?.subjectTracking != null);
  const trackIds = new Set(samples.filter(frame => lockedTarget(frame?.subjectTracking)).map(frame => frame.subjectTracking.trackId));
  const targetChanged = trackIds.size > 1;
  if (!samples.length) reasons.add('NO_FRAMES');
  if (!dimensionsValid) reasons.add('INVALID_DIMENSIONS');
  if (targetChanged) reasons.add('TARGET_ID_CHANGED');

  let validFrames = 0, targetFrames = 0, previousTime = null;
  const measurements = Array.from(samples, (frame, frameIndex) => {
    const time = validTime(frame?.time) ? frame.time : null;
    if (time === null) reasons.add('INVALID_FRAME_TIME');
    if (time !== null && previousTime !== null && time <= previousTime) reasons.add('NON_MONOTONIC_FRAME_TIMES');

    if (time !== null) previousTime = time;
    let targetUsable = !targetChanged;
    if (hasTracking && !lockedTarget(frame?.subjectTracking)) {
      targetUsable = false;
      reasons.add('TARGET_NOT_LOCKED');
    } else if (!hasTracking && Number.isFinite(frame?.personCount) && frame.personCount > 1) {
      targetUsable = false;
      reasons.add('UNRESOLVED_TARGET');
    }
    if (frame?.personCount === 0) {
      targetUsable = false;
      reasons.add('NO_VISIBLE_PERSON');
    }
    if (hasTracking && targetUsable) targetFrames++;

    const canMeasure = dimensionsValid && time !== null && targetUsable;
    const left = canMeasure ? measureSide(frame?.landmarks, 0, width, height) : emptyMeasurements();
    const right = canMeasure ? measureSide(frame?.landmarks, 1, width, height) : emptyMeasurements();
    const values = [...Object.values(left), ...Object.values(right)];
    if (values.some(Number.isFinite)) validFrames++;
    if (canMeasure && values.some(value => value === null)) reasons.add('MISSING_OR_UNCERTAIN_LANDMARKS');
    return {frameIndex, time, left, right};
  });

  return {
    version: MOTION_OBSERVATION_VERSION,
    quality: {
      totalFrames: samples.length,
      validFrames,
      usableRatio: samples.length ? validFrames / samples.length : 0,
      sourceFps: Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : null,
      targetCoverage: hasTracking ? (samples.length ? targetFrames / samples.length : 0) : null,
      reasons: [...reasons],
    },
    measurements,
  };
}

export default analyzeMotion;
