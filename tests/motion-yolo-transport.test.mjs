import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMotion} from '../public/motion-analysis.js';
import {buildMotionPoseData, validateMotionPoseData, buildFullMotionAnalysis, MOTION_YOLO_BODY_LANDMARK_INDICES} from '../public/motion-pose-data.js';
import {validateMotionCoachRequest} from '../server/motion-coach.mjs';
import {buildGuidedMotionContext, MOTION_GUIDED_PROMPT, MOTION_GUIDED_LIMITS} from '../server/motion-coach-guided.mjs';
import {planMotionCoachBatches, decodeMotionCoachBlock} from '../server/motion-coach-batches.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
// Synthetic transport observations only, not model predictions or accuracy data.
const cocoSlots = [0,2,5,7,8,11,12,13,14,15,16,23,24,25,26,27,28];
function pipeline(count = 45) {
  return {width: 640, height: 480, duration: count / 15, sampleFps: 15,
    modelVersion: 'YOLO26s-Pose 640 / COCO17 / end-to-end',
    frames: Array.from({length: count}, (_, frameIndex) => {
      const landmarks = Array(33).fill(null);
      for (const [index, slot] of cocoSlots.entries()) landmarks[slot] = {
        x: .3 + index % 2 * .2 + Math.sin(frameIndex / 9) * .01,
        y: .1 + index * .045, visibility: .987654321,
      };
      return {time: frameIndex / 15, sourceTime: frameIndex / 15, landmarks};
    })};
}
function request(source = pipeline()) {
  return {duration: source.duration, reviewMode: 'guided', selectedExerciseId: 'barbell-deadlift',
    poseData: buildMotionPoseData(source), fullAnalysis: buildFullMotionAnalysis(analyzeMotion(source.frames, source), source),
    keyframes: [{time: 0, mimeType: 'image/png', data: png}, {time: source.frames.at(-1).time, mimeType: 'image/png', data: png}]};
}

test('YOLO transport retains every actual body observation with its own 2D confidence provenance', () => {
  const source = pipeline(), before = JSON.stringify(source), data = buildMotionPoseData(source);
  assert.equal(data.schemaVersion, 5);
  assert.equal(data.format, 'yolo26-body13-full');
  assert.deepEqual(data.retainedLandmarkIndices, MOTION_YOLO_BODY_LANDMARK_INDICES);
  assert.equal(data.retainedLandmarkIndices.length, 13);
  assert.match(data.coordinates.image, /YOLO26-Pose is 2D/);
  assert.match(data.coordinates.confidence, /YOLO26-Pose keypoint confidence/);
  assert.match(data.coordinates.wholebody, /no finger, heel or foot_index/);
  assert.doesNotMatch(JSON.stringify(data.coordinates), /RTMW|MediaPipe/);
  for (const [index, frame] of data.frames.entries()) {
    assert.equal(frame.time, source.frames[index].time);
    assert.equal(frame.sourceTime, source.frames[index].sourceTime);
    assert.equal(frame.landmarks.length, 33);
    assert.equal(frame.landmarks.filter(Boolean).length, 13);
    for (const [slot, point] of frame.landmarks.entries()) {
      assert.deepEqual(point, data.retainedLandmarkIndices.includes(slot) ? Object.values(source.frames[index].landmarks[slot]) : null);
    }
    assert(!Object.hasOwn(frame, 'wholebodyLandmarks'));
  }
  assert.deepEqual(buildMotionPoseData(source, {bodyOnly: true}), data);
  assert.deepEqual(validateMotionPoseData(JSON.parse(JSON.stringify(data))), data);
  assert.equal(JSON.stringify(source), before);
});

test('YOLO transport rejects fabricated foot points, mismatched definitions and extra depth', () => {
  const source = request();
  for (const mutate of [
    value => value.frames[0].landmarks[29] = [.4, .8, .9],
    value => value.frames[0].landmarks[31] = [.4, .8, .9],
    value => value.frames[0].landmarks[2] = [.4, .1, .9],
    value => value.retainedLandmarkIndices.push(29),
    value => value.coordinates.confidence = 'MediaPipe visibility',
    value => value.frames[0].wholebodyLandmarks = [],
    value => value.schemaVersion = 4,
  ]) {
    const invalid = structuredClone(source.poseData); mutate(invalid);
    assert.throws(() => validateMotionPoseData(invalid));
  }
  const depth = pipeline(); depth.frames[0].landmarks[11].z = .5;
  assert.throws(() => buildMotionPoseData(depth), /不支持的字段/);
  const invalid = structuredClone(source); invalid.poseData.frames[0].landmarks[30] = [.4, .8, .9];
  assert.throws(() => validateMotionCoachRequest(invalid), error => error.status === 400);
});

test('YOLO request and lossless packets round-trip unknown points and missing detections', () => {
  const source = pipeline();
  source.frames[1].landmarks[11] = null;
  source.frames[2].landmarks[12] = {x: .4, y: .2};
  source.frames[3].landmarks = [];
  source.frames[4].landmarks = null;
  const input = validateMotionCoachRequest(request(source));
  const restored = {};
  for (const packet of JSON.parse(JSON.stringify(planMotionCoachBatches(input, {compactPose: true})))) {
    for (const block of packet.blocks) {
      const {path, value} = decodeMotionCoachBlock(block);
      let target = restored;
      for (let index = 0; index < path.length - 1; index++) {
        target[path[index]] ??= typeof path[index + 1] === 'number' ? [] : {};
        target = target[path[index]];
      }
      assert(!Object.hasOwn(target, path.at(-1)));
      target[path.at(-1)] = value;
    }
  }
  assert.deepEqual(restored, {poseData: input.poseData, fullAnalysis: input.fullAnalysis});
  assert.equal(restored.poseData.frames[1].landmarks[11], null);
  assert.deepEqual(restored.poseData.frames[2].landmarks[12], [.4, .2, null, 4]);
  assert.deepEqual(restored.poseData.frames[3].landmarks, []);
  assert.equal(restored.poseData.frames[4].landmarks, null);
});

test('guided YOLO context honestly distinguishes 13 available body joints from 17 compatible slots', () => {
  const input = validateMotionCoachRequest(request(pipeline(450)));
  const {context} = buildGuidedMotionContext(input), {evidence} = context, {poseSchema} = evidence;
  assert.equal(poseSchema.sourceFormat, 'yolo26-body13-full');
  assert.deepEqual(poseSchema.supportedLandmarkIndices, MOTION_YOLO_BODY_LANDMARK_INDICES);
  assert.deepEqual(poseSchema.unsupportedLandmarkNames, ['left_heel', 'right_heel', 'left_foot_index', 'right_foot_index']);
  assert.match(poseSchema.modelVersion, /^YOLO26s-Pose/);
  assert.equal(poseSchema.landmarkIndices.length, 17);
  for (const frame of evidence.frames) {
    assert.equal(frame.landmarks.length, 17);
    assert.deepEqual(frame.landmarks.slice(13), [null, null, null, null]);
    for (let index = 0; index < 13; index++) assert.equal(frame.landmarks[index][2], .987);
  }
  assert.equal(evidence.sourceFrameCount, 450);
  assert.equal(evidence.summarizedMeasurementCount, 450);
  assert.equal(evidence.windows.reduce((sum, window) => sum + window.sourceFrameCount, 0), 450);
  assert.equal(evidence.sourceFrameIndices[0], 0);
  assert.equal(evidence.sourceFrameIndices.at(-1), 449);
  assert(JSON.stringify(evidence).length <= MOTION_GUIDED_LIMITS.evidenceChars);
  assert.match(MOTION_GUIDED_PROMPT, /17个兼容槽位/);
  assert.match(MOTION_GUIDED_PROMPT, /不能用脚踝代替/);
});
