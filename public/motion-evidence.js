import { browserSeekTime, scaledVideoSize, validateVideoFile, validateVideoMetadata } from './motion-video.js';

export const MOTION_EVIDENCE_LIMITS = Object.freeze({ maxImages: 6, maxBytes: 1900000, maxDimension: 640 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('已取消关键帧提取。', 'AbortError'); };
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const clipped = (value, length = 300) => typeof value === 'string' ? value.slice(0, length) : undefined;

// Bound every field; a saved report must not accidentally send raw pose arrays,
// arbitrary attachment data or an unbounded history to the model.
function compact(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (finite(value)) return value;
  if (typeof value === 'string') return value.slice(0, 300);
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 24).map(item => compact(item, depth + 1));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(landmarks|worldLandmarks|frames|dataurl|base64|images?|video|file)$/i.test(key)).slice(0, 24).map(([key, item]) => [key.slice(0, 64), compact(item, depth + 1)]));
}

export function summarizeMotionAnalysis(assessment = {}, pipeline = {}) {
  const reps = Array.isArray(assessment.reps) ? assessment.reps : [];
  // Include representative and lowest-scoring repetitions, preserving chronology.
  const chosen = new Set([0, Math.floor(reps.length / 2), reps.length - 1]);
  reps.map((rep, index) => ({ index, score: finite(rep.score) ? rep.score : 101 })).sort((a, b) => a.score - b.score).slice(0, 12).forEach(item => chosen.add(item.index));
  return {
    version: clipped(assessment.version, 100), exerciseId: clipped(assessment.exerciseId, 100) ?? null,
    exerciseConfidence: finite(assessment.exerciseConfidence) ? assessment.exerciseConfidence : null,
    exerciseFamily: compact(assessment.exerciseFamily), exerciseFamilyName: compact(assessment.exerciseFamilyName),
    candidates: compact(assessment.candidates), requiresVisualConfirmation: assessment.requiresVisualConfirmation === true,
    status: clipped(assessment.status, 40), score: finite(assessment.score) ? assessment.score : null,
    duration: finite(pipeline.duration) ? pipeline.duration : null,
    sampleFps: finite(pipeline.sampleFps) ? pipeline.sampleFps : null,
    sourceFps: finite(pipeline.sourceFps) ? pipeline.sourceFps : null,
    quality: compact(assessment.quality), summary: clipped(assessment.summary, 800),
    attemptCount: finite(assessment.attemptCount) ? assessment.attemptCount : reps.length, qualifiedRepCount: finite(assessment.qualifiedRepCount) ? assessment.qualifiedRepCount : null,
    incompleteAttemptCount: finite(assessment.incompleteAttemptCount) ? assessment.incompleteAttemptCount : null,
    observedActiveRange: compact(assessment.observedActiveRange),
    limitations: compact(assessment.limitations),
    checks: compact(assessment.checks), scoreCoverage: compact(assessment.scoreCoverage),
    observedScore: finite(assessment.observedScore) ? assessment.observedScore : null,
    scoreStatus: clipped(assessment.scoreStatus, 100), visualReviewRequests: compact(assessment.visualReviewRequests),
    targetTracking: compact(pipeline.targetTracking),
    reps: [...chosen].filter(index => reps[index]).sort((a, b) => a - b).map(index => compact(reps[index])),
    issues: compact(assessment.issues || []),
    evidenceNote: '姿态规则是可见运动线索。肩髋连线不能证明腰椎中立；缺失或遮挡部位不可据此断言。',
  };
}

export function selectMotionEvidenceFrames(frames, assessment = {}, { maxImages = 6 } = {}) {
  const limit = Math.min(6, Math.max(1, Math.floor(maxImages) || 6));
  const input = Array.isArray(frames) ? frames : [];
  const tracking = input.some(frame => frame?.subjectTracking);
  if (!tracking && input.some(frame => frame?.personCount > 1)) throw new Error('旧分析包含多个人，无法保证 AI 点评同一位训练者，请重新分析。');
  const eligible = input.filter(frame => frame && finite(frame.time) && frame.time >= 0 && (!tracking || (frame.subjectTracking?.status === 'locked' && frame.subjectTracking.confidence >= 0.65 && typeof frame.subjectTracking.trackId === 'string' && frame.subjectTracking.trackId.length > 0 && validBox(frame.subjectTracking.bbox))));
  if (tracking && new Set(eligible.map(frame => frame.subjectTracking.trackId)).size > 1) throw new Error('分析中目标身份发生变化，无法生成同一人的关键帧。');
  const ordered = [...new Map(eligible.map(frame => [frame.time, frame])).values()].sort((a, b) => a.time - b.time);
  if (!ordered.length) throw new Error('没有可供提取证据的分析帧。');
  const nearest = time => ordered.reduce((best, frame) => Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best, ordered[0]);
  const selected = new Map();
  const add = (time, reason, maxDistance = Infinity) => {
    if (!finite(time)) return;
    const frame = nearest(time), existing = selected.get(frame.time);
    if (Math.abs(frame.time - time) > maxDistance) return;
    if (existing) { if (!existing.reasons.includes(reason)) existing.reasons.push(reason); return; }
    if (selected.size >= limit) return;
    selected.set(frame.time, { time: frame.time, requestedTime: time, poseTime: frame.time, sourceTime: finite(frame.sourceTime) ? frame.sourceTime : null, reasons: [reason], ...(tracking ? { subjectTracking: compact(frame.subjectTracking) } : {}) });
  };
  const start = finite(assessment.observedActiveRange?.start) ? assessment.observedActiveRange.start : ordered[0].time;
  const end = finite(assessment.observedActiveRange?.end) ? assessment.observedActiveRange.end : ordered.at(-1).time;
  const reps = Array.isArray(assessment.reps) ? assessment.reps : [];
  const middleRep = reps[Math.floor(reps.length / 2)];
  add(start, '动作区间起始');
  add(middleRep?.peak ?? middleRep?.bottom ?? middleRep?.time ?? (start + end) / 2, middleRep ? '代表动作顶点' : '动作区间中部');
  add(end, '动作区间结束');
  const severity = { error: 0, severe: 0, warning: 1, warn: 1, info: 3 };
  const checkIssues = (Array.isArray(assessment.checks) ? assessment.checks : []).filter(item => item && !['pass', 'passed', 'unobservable', 'not_applicable'].includes(item.status)).flatMap(item => (item.evidenceTimes || []).filter(finite).map(time => ({ ...item, time })));
  const issues = [...(assessment.issues || []), ...reps.flatMap(rep => rep.issues || []), ...checkIssues].filter(item => item && finite(item.time));
  const scoredIssues = issues.map(item => ({ ...item, score: finite(item.score) ? item.score : reps.find(rep => item.time >= rep.start && item.time <= rep.end)?.score ?? 101 }));
  scoredIssues.sort((a, b) => Number(b.critical === true) - Number(a.critical === true) || (severity[a.severity] ?? 2) - (severity[b.severity] ?? 2) || a.score - b.score || a.time - b.time);
  const codes = new Set();
  for (const item of scoredIssues) { if (codes.has(item.code)) continue; codes.add(item.code); add(item.time, '问题：' + (clipped(item.code, 80) || '可见动作'), 0.35); }
  for (const request of Array.isArray(assessment.visualReviewRequests) ? assessment.visualReviewRequests : []) {
    if (!request || typeof request !== 'object') continue;
    const times = Array.isArray(request.evidenceTimes) ? request.evidenceTimes : [request.time];
    for (const time of times) add(time, '待画面核查：' + (clipped(request.code, 80) || '细节'), 0.35);
  }
  add(middleRep?.start, '代表动作起始'); add(middleRep?.end, '代表动作结束');
  for (const fraction of [0.25, 0.75, 0.125, 0.875]) add(start + (end - start) * fraction, '动作过程');
  return [...selected.values()].sort((a, b) => a.time - b.time);
}

function validBox(box) {
  return box && ['xMin', 'yMin', 'xMax', 'yMax'].every(key => finite(box[key])) && box.xMin >= 0 && box.yMin >= 0 && box.xMax <= 1 && box.yMax <= 1 && box.xMax > box.xMin && box.yMax > box.yMin;
}

export function evidenceCropRegion(box) {
  if (!validBox(box)) return { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };
  const marginX = Math.max(0.06, (box.xMax - box.xMin) * 0.2), marginY = Math.max(0.04, (box.yMax - box.yMin) * 0.12);
  // A landmark box can begin at the ears/shoulders rather than the head outline.
  // Keep extra room above it for visible head/neck assessment and the label.
  const headroom = Math.max(0.08, (box.yMax - box.yMin) * 0.25);
  return { xMin: Math.max(0, box.xMin - marginX), yMin: Math.max(0, box.yMin - headroom), xMax: Math.min(1, box.xMax + marginX), yMax: Math.min(1, box.yMax + marginY) };
}

function waitForMedia(video, event, signal, trigger) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed); signal?.removeEventListener('abort', cancelled); };
    const finish = (handler, value) => { cleanup(); handler(value); };
    const done = () => finish(resolve);
    const failed = () => finish(reject, new Error('无法读取视频关键帧，请重新选择视频。'));
    const cancelled = () => finish(reject, new DOMException('已取消关键帧提取。', 'AbortError'));
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true }); signal?.addEventListener('abort', cancelled, { once: true });
    timer = setTimeout(failed, 15000);
    try { trigger?.(); } catch (error) { finish(reject, error); }
  });
}

function observePresentedFrame(video, signal) {
  let callback, timer, finish;
  const promise = new Promise(resolve => {
    finish = value => { clearTimeout(timer); if (callback !== undefined) video.cancelVideoFrameCallback?.(callback); signal?.removeEventListener('abort', cancel); resolve(value); };
    const cancel = () => finish(null);
    if (!video.requestVideoFrameCallback) { resolve(null); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    callback = video.requestVideoFrameCallback((_now, metadata) => finish(finite(metadata.mediaTime) ? metadata.mediaTime : null));
    timer = setTimeout(cancel, 200);
  });
  return { promise, cancel: () => finish?.(null) };
}

async function jpegDataUrl(canvas, budget, signal) {
  let quality = 0.76;
  for (let attempt = 0; attempt < 7; attempt++) {
    checkAbort(signal);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('浏览器无法生成 JPEG 关键帧。');
    checkAbort(signal);
    if (Math.ceil(blob.size / 3) * 4 + 32 <= budget) {
      const bytes = new Uint8Array(await blob.arrayBuffer()); checkAbort(signal);
      let binary = ''; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      return 'data:image/jpeg;base64,' + btoa(binary);
    }
    if (quality > 0.4) quality -= 0.18;
    else {
      const copy = document.createElement('canvas'); copy.width = Math.max(1, Math.round(canvas.width * 0.75)); copy.height = Math.max(1, Math.round(canvas.height * 0.75));
      copy.getContext('2d').drawImage(canvas, 0, 0, copy.width, copy.height);
      canvas.width = copy.width; canvas.height = copy.height; canvas.getContext('2d').drawImage(copy, 0, 0); copy.width = copy.height = 0;
    }
  }
  throw new Error('关键帧无法压缩到请求大小限制内。');
}

/** Local-only extraction. The caller decides whether and when to upload the result. */
export async function buildMotionEvidence(file, pipeline, assessment, { signal, onProgress = () => {}, maxImages = 6, maxBytes = 1900000 } = {}) {
  checkAbort(signal); validateVideoFile(file);
  const selected = selectMotionEvidenceFrames(pipeline?.frames, assessment, { maxImages });
  const summary = summarizeMotionAnalysis(assessment, pipeline);
  const budget = Math.min(MOTION_EVIDENCE_LIMITS.maxBytes, finite(maxBytes) ? Math.floor(maxBytes) : MOTION_EVIDENCE_LIMITS.maxBytes);
  if (budget < 50000) throw new Error('关键帧请求大小限制过小。');
  const video = document.createElement('video'), canvas = document.createElement('canvas');
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  const url = URL.createObjectURL(file);
  let observation, lastImageTime = null;
  try {
    await waitForMedia(video, 'loadedmetadata', signal, () => { video.src = url; video.load(); });
    const duration = video.duration, width = video.videoWidth, height = video.videoHeight;
    validateVideoMetadata({ duration, width, height });
    if (Math.abs(duration - pipeline.duration) > Math.max(0.1, duration * 0.001) || width !== pipeline.width || height !== pipeline.height) throw new Error('视频与分析结果不一致，请重新分析当前视频。');
    if (video.readyState < 2) await waitForMedia(video, 'loadeddata', signal);
    const result = { version: 'motion-evidence-v1', video: { width, height, duration, sampleFps: summary.sampleFps, sourceFps: summary.sourceFps }, summary, images: [], byteLength: 0 };
    const perImageBudget = Math.floor((budget - jsonBytes(result) - 20000) / selected.length);
    for (const [index, item] of selected.entries()) {
      checkAbort(signal);
      observation = observePresentedFrame(video, signal);
      // Prefer the pose's actual source PTS, when available; seek-time epsilon
      // compensates Chromium microsecond truncation without changing poseTime.
      const seek = browserSeekTime(item.sourceTime ?? item.poseTime, duration);
      const didSeek = Math.abs(video.currentTime - seek) > 0.000001;
      if (didSeek) await waitForMedia(video, 'seeked', signal, () => { video.currentTime = seek; });
      const presentedTime = await observation.promise; observation = undefined; checkAbort(signal);
      const imageTime = presentedTime ?? (didSeek ? null : lastImageTime); lastImageTime = imageTime;
      const time = imageTime ?? item.poseTime;
      const mapping = { requestedTime: item.requestedTime, poseTime: item.poseTime, sourceTime: item.sourceTime };
      const duplicate = result.images.find(image => Math.round(image.time * 1e6) === Math.round(time * 1e6));
      if (duplicate) {
        duplicate.reasons = [...new Set([...duplicate.reasons, ...item.reasons])];
        duplicate.frameMappings.push(mapping);
        onProgress({ stage: 'evidence', processedFrames: index + 1, totalFrames: selected.length, progress: (index + 1) / selected.length });
        continue;
      }
      const box = item.subjectTracking?.bbox, crop = evidenceCropRegion(box);
      const cropWidth = (crop.xMax - crop.xMin) * width, cropHeight = (crop.yMax - crop.yMin) * height;
      const size = scaledVideoSize(cropWidth, cropHeight, MOTION_EVIDENCE_LIMITS.maxDimension);
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法读取视频画面。');
      context.drawImage(video, crop.xMin * width, crop.yMin * height, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
      if (box) {
        const x = (box.xMin - crop.xMin) / (crop.xMax - crop.xMin) * canvas.width, y = (box.yMin - crop.yMin) / (crop.yMax - crop.yMin) * canvas.height;
        const boxWidth = (box.xMax - box.xMin) / (crop.xMax - crop.xMin) * canvas.width, boxHeight = (box.yMax - box.yMin) / (crop.yMax - crop.yMin) * canvas.height;
        context.strokeStyle = '#ffdf00'; context.lineWidth = 3; context.strokeRect(x, y, boxWidth, boxHeight);
        // Put the label in the crop margin, not over the target's head/neck.
        context.fillStyle = '#ffdf00'; context.fillRect(4, 4, 70, 22);
        context.fillStyle = '#111'; context.font = 'bold 14px sans-serif'; context.fillText('TARGET', 9, 20);
      }
      const dataUrl = await jpegDataUrl(canvas, perImageBudget, signal);
      result.images.push({ ...item, time, imageTime, timePrecision: imageTime === null ? 'seek-target' : 'source-pts', frameMappings: [mapping], crop, width: canvas.width, height: canvas.height, mimeType: 'image/jpeg', dataUrl });
      onProgress({ stage: 'evidence', processedFrames: index + 1, totalFrames: selected.length, progress: (index + 1) / selected.length });
    }
    summary.evidenceFrames = result.images.map(({ dataUrl, ...metadata }) => metadata);
    result.byteLength = jsonBytes(result); result.byteLength = jsonBytes(result);
    if (result.byteLength >= budget) throw new Error('关键帧请求超过大小限制。');
    checkAbort(signal); return result;
  } finally {
    observation?.cancel(); video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); canvas.width = canvas.height = 0;
  }
}
