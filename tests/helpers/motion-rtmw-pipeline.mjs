import {mapWholebodyLandmarks} from '../../public/motion-rtmw.js';

// Synthetic transport fixtures only. These are not model predictions or
// labelled motion data and must never be used to claim model accuracy.
export function makeRtmwWholebody(seed = 0) {
  const offset = Math.sin(seed / 17) * 0.02;
  return Array.from({length: 133}, (_, index) => ({
    x: 0.04 + index / 160 + offset + 0.000123456789,
    y: 0.04 + index / 160 - offset + 0.000987654321,
    score: 0.987654321 + (index % 7) / 10,
  }));
}

export function makeRtmwPipeline(count = 45) {
  return {
    width: 1920, height: 1080, duration: count / 15, sampleFps: 15, sourceFps: 30,
    modelVersion: 'RTMW-L synthetic test', delegate: 'CPU', decoder: 'webcodecs', codec: 'avc1.640028', elapsedMs: 12.345,
    timing: {initializationMs: 1.1, decodeMs: 2.2, inferenceMs: 3.3},
    targetTracking: {mode: 'center', point: null, trackId: 'motion-target-1', coverage: 1, lockedFrames: count, ambiguousFrames: 0, lostFrames: 0, totalFrames: count, maxPeople: 2, summary: '完整跟踪'},
    frames: Array.from({length: count}, (_, index) => {
      const wholebodyLandmarks = makeRtmwWholebody(index);
      return {time: index / 15, sourceTime: index / 15,
        landmarks: mapWholebodyLandmarks(wholebodyLandmarks), wholebodyLandmarks,
        personCount: 2, multiPersonCheck: true,
        subjectTracking: {status: 'locked', trackId: 'motion-target-1', confidence: 0.99, bbox: {xMin: 0, yMin: 0.1, xMax: 1, yMax: 0.9}},
      };
    }),
  };
}

// Adapt old test scaffolding to the new RTMW transport while retaining frame
// timing/tracking. Creates synthetic 133-point data, not inferred extra joints.
export function toRtmwPipeline(pipeline) {
  return {...pipeline, modelVersion: 'RTMW-L synthetic test', frames: pipeline.frames.map((frame, index) => {
    const {worldLandmarks, landmarks, ...rest} = frame;
    const wholebodyLandmarks = landmarks?.length ? makeRtmwWholebody(index) : [];
    return {...rest, landmarks: wholebodyLandmarks.length ? mapWholebodyLandmarks(wholebodyLandmarks) : landmarks, wholebodyLandmarks};
  })};
}
