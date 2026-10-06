// The same planar landmark contract as RTMW; depth is deliberately not used
// by the existing angle measurements or sent as measured 3D evidence.
export function mediaPipeLandmarks(result) {
  return (result.landmarks || []).map(points => points.map(({ x, y, visibility }) => ({ x, y, visibility })));
}

export async function createMediaPipe({ delegate = 'GPU' } = {}) {
  const { FilesetResolver, PoseLandmarker } = await import('./vendor/mediapipe/vision_bundle.mjs');
  const root = new URL('./vendor/mediapipe/', import.meta.url);
  const vision = await FilesetResolver.forVisionTasks(new URL('wasm', root).href);
  const pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: new URL('pose_landmarker_full.task', root).href, delegate },
    runningMode: 'VIDEO',
    numPoses: 4,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  return {
    delegate,
    detect(image, timestampMs) {
      return { landmarks: mediaPipeLandmarks(pose.detectForVideo(image, timestampMs)) };
    },
    close() { pose.close(); },
  };
}
