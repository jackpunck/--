/* Classic worker: MediaPipe 0.10.32's WASM loader uses importScripts().
 * Import the unmodified ESM API here, rather than running inference in the UI.
 */
let pose;
let regionPose;
let tracker;
let targetPoint, targetBox, lastDiscovery=-Infinity, trackingHelpers;
let busy = false;
let sequential;
const assetBase = new URL('./vendor/mediapipe/', self.location.href);

function analyzeFrame(image, timestampMs) {
  const started = performance.now();
  const groups = [pose.detectForVideo(image, timestampMs)];
  const knownRegions=trackingHelpers.knownPersonRegions(groups[0].landmarks);
  const crops=[];
  const selectedCrop=trackingHelpers.targetDetectionCrop({bbox:targetBox,point:targetPoint});
  if(selectedCrop)crops.push(selectedCrop);
  // Global detection can miss smaller people. Discover both sides regularly;
  // the selected region is checked every frame, including during brief loss.
  if(timestampMs-lastDiscovery>=500){crops.push({xMin:0,yMin:0,xMax:.6,yMax:1,discovery:true},{xMin:.4,yMin:0,xMax:1,yMax:1,discovery:true});lastDiscovery=timestampMs;}
  for(const crop of crops) {
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(image.width*(crop.xMax-crop.xMin))),Math.max(1,Math.round(image.height*(crop.yMax-crop.yMin))));
    const ctx=canvas.getContext('2d');
    ctx.drawImage(image,crop.xMin*image.width,crop.yMin*image.height,image.width*(crop.xMax-crop.xMin),image.height*(crop.yMax-crop.yMin),0,0,canvas.width,canvas.height);
    if(crop.discovery){
      ctx.fillStyle='#777777';
      for(const region of knownRegions)ctx.fillRect((region.xMin-crop.xMin)/(crop.xMax-crop.xMin)*canvas.width,(region.yMin-crop.yMin)/(crop.yMax-crop.yMin)*canvas.height,(region.xMax-region.xMin)/(crop.xMax-crop.xMin)*canvas.width,(region.yMax-region.yMin)/(crop.yMax-crop.yMin)*canvas.height);
    }
    const result=regionPose.detect(canvas);
    groups.push({landmarks:result.landmarks.map(points=>trackingHelpers.mapCropLandmarks(points,crop)),worldLandmarks:result.worldLandmarks,crop});
    canvas.width=canvas.height=1;
  }
  const result=trackingHelpers.mergePoseCandidates(groups);
  const selected = tracker.update(result.landmarks, timestampMs / 1000);
  if(selected.subjectTracking.status==='locked')targetBox=selected.subjectTracking.bbox;
  const copy = points => (points || []).map(({ x, y, z, visibility, presence }) => ({ x, y, z, visibility: visibility ?? 0, presence: presence ?? null }));
  return { personCount: result.landmarks.length, multiPersonCheck: true, subjectTracking: selected.subjectTracking, landmarks: selected.index === null ? [] : copy(result.landmarks[selected.index]), worldLandmarks: selected.index === null ? [] : copy(result.worldLandmarks[selected.index]), inferenceMs: performance.now() - started };
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
      trackingHelpers = await import('./motion-tracking.js');
      targetPoint=trackingHelpers.validateTargetPoint(data.targetPoint);targetBox=undefined;lastDiscovery=-Infinity;
      tracker = trackingHelpers.createSubjectTracker({ targetPoint });
      const { PoseLandmarker, FilesetResolver } = await import(new URL('vision_bundle.mjs', assetBase).href);
      const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', assetBase).href);
      const options = {
        baseOptions: {
          modelAssetPath: new URL('pose_landmarker_full.task', assetBase).href,
          delegate: data.delegate,
        },
        runningMode: 'VIDEO', numPoses: 4,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      };
      pose = await PoseLandmarker.createFromOptions(fileset, options);
      // A region seeks one local target. IMAGE with multiple poses may emit
      // duplicate estimates for that same person; the global pass retains up
      // to four independent candidates for actual crowd/overlap competition.
      regionPose = await PoseLandmarker.createFromOptions(fileset, {...options,runningMode:'IMAGE',numPoses:1});
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
      pose?.close(); regionPose?.close(); pose = regionPose = tracker = undefined;
      self.postMessage({ id });
    } else throw new Error('未知的姿态分析请求。');
  } catch (error) {
    // Also cover rejected frames sent before initialization (close is idempotent).
    data.bitmap?.close();
    self.postMessage({ id, error: error?.message || '姿态分析失败。' });
  } finally { busy = false; }
};
