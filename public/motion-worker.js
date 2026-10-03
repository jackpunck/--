/* Classic worker: MediaPipe 0.10.32's WASM loader uses importScripts().
 * Import the unmodified ESM API here, rather than running inference in the UI.
 */
let pose;
let crowdPose;
let lastCrowdCheck = -Infinity;
let busy = false;
let sequential;
const assetBase = new URL('./vendor/mediapipe/', self.location.href);

function analyzeFrame(image, timestampMs) {
  const started = performance.now();
  let crowdCount = 0;
  const multiPersonCheck = timestampMs - lastCrowdCheck >= 500;
  if (multiPersonCheck) { crowdCount = crowdPose.detect(image).landmarks.length; lastCrowdCheck = timestampMs; }
  const result = pose.detectForVideo(image, timestampMs);
  const copy = points => (points || []).map(({ x, y, z, visibility, presence }) => ({ x, y, z, visibility: visibility ?? 0, presence: presence ?? null }));
  const personCount = Math.max(crowdCount, result.landmarks.length);
  return { personCount, multiPersonCheck, landmarks: personCount === 1 ? copy(result.landmarks[0]) : [], worldLandmarks: personCount === 1 ? copy(result.worldLandmarks[0]) : [], inferenceMs: performance.now() - started };
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  if (busy) {
    data.bitmap?.close();
    self.postMessage({ id, error: '姿态分析任务仍在运行。' });
    return;
  }
  busy = true;
  try {
    if (type === 'init') {
      if (typeof OffscreenCanvas === 'undefined') throw new Error('浏览器不支持后台画布，请使用新版 Chrome 或 Edge。');
      const { PoseLandmarker, FilesetResolver } = await import(new URL('vision_bundle.mjs', assetBase).href);
      const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', assetBase).href);
      const options = {
        baseOptions: {
          modelAssetPath: new URL('pose_landmarker_full.task', assetBase).href,
          delegate: data.delegate,
        },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      };
      pose = await PoseLandmarker.createFromOptions(fileset, options);
      // A second pass twice per second avoids forcing the expensive
      // detector on every frame when only one person is actually present.
      crowdPose = await PoseLandmarker.createFromOptions(fileset, { ...options, numPoses: 2, runningMode: 'IMAGE' });
      self.postMessage({ id, delegate: data.delegate });
    } else if (type === 'prepare-mp4') {
      const { prepareMp4 } = await import('./motion-decode.js');
      const prepared = await prepareMp4(data.file, data.options);
      sequential = prepared?.run ? prepared : undefined;
      self.postMessage({ id, supported: !!sequential, sourceFps: prepared?.sourceFps ?? null });
    } else if (type === 'decode-mp4') {
      if (!pose || !sequential) throw new Error('顺序解码尚未初始化。');
      const timing = await sequential.run((canvas, target) => {
        const result = analyzeFrame(canvas, target.time * 1000);
        self.postMessage({ id, type: 'frame-result', frame: { time: target.time, sourceTime: target.sourceTime, ...result } });
      });
      sequential = undefined;
      self.postMessage({ id, timing });
    } else if (type === 'frame') {
      if (!pose) throw new Error('姿态模型尚未加载完成。');
      try {
        self.postMessage({ id, ...analyzeFrame(data.bitmap, data.timestampMs) });
      } finally { data.bitmap.close(); }
    } else if (type === 'close') {
      pose?.close(); crowdPose?.close(); pose = crowdPose = undefined;
      self.postMessage({ id });
    } else throw new Error('未知的姿态分析请求。');
  } catch (error) {
    // Also cover rejected frames sent before initialization (close is idempotent).
    data.bitmap?.close();
    self.postMessage({ id, error: error?.message || '姿态分析失败。' });
  } finally { busy = false; }
};
