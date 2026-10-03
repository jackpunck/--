/**
 * Observable, side-view movement rules; this is not a validated coach model.
 * Image points use x * width and y * height. Inferred monocular z/world points
 * are deliberately not treated as measured 3D anatomy or as a view guarantee.
 * Thresholds need calibration against independently labelled real recordings.
 */
export const MOTION_RULE_VERSION = 'motion-rules-1.0.0';

const SIDES = [[11, 13, 15, 23, 25, 27], [12, 14, 16, 24, 26, 28]];
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const round = (v, digits = 2) => Number(v.toFixed(digits));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const quantile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p = (sorted.length - 1) * q;
  return sorted[Math.floor(p)] + (sorted[Math.ceil(p)] - sorted[Math.floor(p)]) * (p % 1);
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a, b, c) => {
  const ab = distance(a, b), cb = distance(c, b);
  if (ab < 1e-6 || cb < 1e-6) return NaN;
  return Math.acos(clamp(((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (ab * cb), -1, 1)) * 180 / Math.PI;
};
const confidence = p => p && Number.isFinite(p.visibility) ? Math.min(p.visibility, Number.isFinite(p.presence) ? p.presence : 1) : 0;
const issue = (time, code, message, severity = 'warning') => ({time: round(time), code, message, severity});
const range = values => quantile(values, 0.95) - quantile(values, 0.05);

function point(p, width, height) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || confidence(p) < 0.55 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  return {x: p.x * width, y: p.y * height};
}

function frameFeatures(frame, side, width, height) {
  const landmarks = frame.landmarks;
  if (!Array.isArray(landmarks) || landmarks.length !== 33) return null;
  const joints = SIDES[side].map(i => point(landmarks[i], width, height));
  if (joints.some(p => !p)) return null;
  const [shoulder, elbow, wrist, hip, knee, ankle] = joints;
  const torso = distance(shoulder, hip), leg = distance(hip, knee) + distance(knee, ankle);
  const arm = distance(shoulder, elbow) + distance(elbow, wrist);
  if (Math.min(torso, arm, leg) < Math.min(width, height) * 0.06) return null;
  const kneeAngle = angle(hip, knee, ankle), elbowAngle = angle(shoulder, elbow, wrist);
  const bodyAngle = angle(shoulder, hip, ankle);
  if (![kneeAngle, elbowAngle, bodyAngle].every(Number.isFinite)) return null;
  // Bilateral projected width is a conservative view screen, not camera calibration.
  const bilateral = [11, 12, 23, 24].map(i => point(landmarks[i], width, height));
  const viewRatio = bilateral.every(Boolean) ? Math.max(distance(bilateral[0], bilateral[1]), distance(bilateral[2], bilateral[3])) / torso : null;
  const bodyLength = distance(shoulder, ankle);
  return {
    time: frame.time, shoulder, elbow, wrist, hip, knee, ankle, torso, leg, arm,
    kneeAngle, elbowAngle, bodyAngle, viewRatio,
    torsoLean: Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180 / Math.PI,
    upright: shoulder.y < hip.y - torso * 0.25 && ankle.y > hip.y + leg * 0.2 && Math.abs(shoulder.x - ankle.x) / bodyLength < 0.55,
    // The floor recedes in perspective: wrist and ankle need NOT have equal y.
    horizontal: Math.abs(shoulder.x - ankle.x) / bodyLength > 0.75 && wrist.y > shoulder.y + arm * 0.12 && Math.abs(wrist.x - shoulder.x) < arm * 0.9,
  };
}

function splitAndSmooth(features, maxGap) {
  const segments = [];
  for (const f of features) {
    let segment = segments.at(-1);
    if (!segment || f.time - segment.at(-1).time > maxGap) { segment = []; segments.push(segment); }
    segment.push(f);
  }
  // A short symmetric time window avoids changing behaviour with input FPS.
  return segments.map(segment => segment.map((f, i) => {
    const neighbours = segment.slice(Math.max(0, i - 3), i + 4).filter(other => Math.abs(other.time - f.time) <= 0.11);
    return {...f, kneeSmooth: quantile(neighbours.map(x => x.kneeAngle), 0.5), elbowSmooth: quantile(neighbours.map(x => x.elbowAngle), 0.5)};
  }));
}

function classifyWindow(features) {
  if (features.length < 8) return {id: null, confidence: 0, static: false};
  const upright = mean(features.map(f => Number(f.upright)));
  const horizontal = mean(features.map(f => Number(f.horizontal)));
  const kneeRange = range(features.map(f => f.kneeAngle));
  const elbowRange = range(features.map(f => f.elbowAngle));
  const leg = quantile(features.map(f => f.leg), 0.5);
  const arm = quantile(features.map(f => f.arm), 0.5);
  const scale = quantile(features.map(f => f.torso + f.leg), 0.5);
  const hipTravel = range(features.map(f => f.hip.y)) / leg;
  const shoulderTravel = range(features.map(f => f.shoulder.y)) / arm;
  // Preparation and repositioning can move a support point a long way once.
  // Identify its usual behaviour, rather than requiring the entire clip to
  // occupy a single location. Sustained hopping/moving supports still fail.
  const supportStability = joint => mean(features.slice(1).map((f, i) => {
    const dt = f.time - features[i].time;
    return Number(distance(f[joint], features[i][joint]) / Math.max(dt * scale, 1e-6) <= 0.35);
  }));
  const ankleStability = supportStability('ankle');
  const wristStability = supportStability('wrist');
  // Recognition must include shallow, incorrect attempts. Depth belongs to
  // scoring; only enough coordinated movement to exceed jitter is required here.
  const squat = upright >= 0.75 && kneeRange >= 20 && hipTravel >= 0.025 && ankleStability >= 0.75;
  const pushup = horizontal >= 0.75 && elbowRange >= 20 && shoulderTravel >= 0.035 && quantile(features.map(f => f.kneeAngle), 0.25) >= 145 && ankleStability >= 0.75 && wristStability >= 0.75;
  if (squat === pushup) return {id: null, confidence: 0, static: kneeRange < 15 && elbowRange < 15};
  // This number is rule evidence strength, not a calibrated ML probability.
  return {id: squat ? 'squat' : 'pushup', confidence: round(clamp(0.65 + 0.2 * (squat ? upright : horizontal) + 0.1 * clamp((squat ? kneeRange : elbowRange) / 90), 0, 0.95)), static: false};
}

function classify(features) {
  const whole = classifyWindow(features);
  if (whole.id || features.length < 8) return whole;
  // A preparation pose must not outvote the exercise. Windows only identify
  // the movement; repetition detection still receives its entire time range.
  const candidates = [];
  for (let start = features[0].time; start < features.at(-1).time - 1; start += 1.5) {
    const window = features.filter(f => f.time >= start && f.time <= start + 4);
    const candidate = classifyWindow(window);
    if (candidate.id) candidates.push(candidate);
  }
  const identities = new Set(candidates.map(c => c.id));
  if (identities.size !== 1) return whole;
  return {id: candidates[0].id, confidence: Math.min(0.9, Math.max(...candidates.map(c => c.confidence))), static: false};
}

function activeRangeFor(features, exercise) {
  const supports = f => exercise === 'squat' ? f.upright : f.horizontal && f.kneeAngle >= 145;
  const runs = [];
  let run = null;
  for (const f of features) {
    if (!supports(f)) { run = null; continue; }
    if (!run || f.time - run.end > 0.35) { run = {start: f.time, end: f.time}; runs.push(run); }
    else run.end = f.time;
  }
  const sustained = runs.filter(r => r.end - r.start >= 0.4);
  if (!sustained.length) return null;
  // Keep every interval between the first and last supported pose, including
  // incorrect phases. This does not crop each repetition to a good-looking pose.
  return {start: sustained[0].start, end: sustained.at(-1).end};
}

function detectReps(segments, exercise) {
  const key = exercise === 'squat' ? 'kneeSmooth' : 'elbowSmooth';
  const reps = [];
  let partial = false;
  let incompleteAttempts = 0;
  for (const segment of segments) {
    const topThreshold = Math.max(155, quantile(segment.map(f => f[key]), 0.9) - 8);
    const descentThreshold = topThreshold - 10;
    let armed = false, active = null, lastTop = null, leadingPartial = false;
    for (let i = 0; i < segment.length; i++) {
      const f = segment[i], a = f[key];
      if (!active) {
        if (a >= topThreshold) {
          // Observing the top is enough; normal repetitions need no pause.
          armed = true;
          lastTop = i;
        } else {
          if (armed && a <= descentThreshold && lastTop !== null) {
            active = {start: lastTop, bottom: i};
          } else if (!armed && a < 125) { partial = true; leadingPartial = true; }
        }
        continue;
      }
      if (a < segment[active.bottom][key]) active.bottom = i;
      if (a >= topThreshold) {
        const slice = segment.slice(active.start, i + 1);
        const bottom = segment[active.bottom];
        const duration = f.time - segment[active.start].time;
        const descent = bottom.time - slice[0].time, ascent = slice.at(-1).time - bottom.time;
        // Require observed bending and both phases. No lowest-frame fallback.
        const excursion = Math.max(slice[0][key], slice.at(-1)[key]) - bottom[key];
        if (excursion >= 18 && duration >= 0.65 && duration <= 15 && descent >= 0.22 && ascent >= 0.22 && slice.length >= 7) reps.push({frames: slice, bottom});
        else partial = true;
        active = null; armed = true; lastTop = i;
      }
    }
    if (active) { partial = true; incompleteAttempts++; }
    if (leadingPartial) incompleteAttempts++;
  }
  // Missing intervals can split the same attempt: do not claim a precise count.
  return {reps, partial, incompleteAttempts: segments.length > 1 ? null : incompleteAttempts};
}

function scoreRep(rep, exercise, index) {
  const {frames, bottom} = rep, start = frames[0].time, end = frames.at(-1).time;
  const bottomFrames = frames.filter(f => Math.abs(f.time - bottom.time) <= 0.2);
  const key = exercise === 'squat' ? 'kneeSmooth' : 'elbowSmooth';
  const bottomAngle = quantile(bottomFrames.map(f => f[key]), 0.25);
  const excursion = Math.max(frames[0][key], frames.at(-1)[key]) - bottomAngle;
  const travel = frames.slice(1).reduce((sum, f, i) => sum + Math.abs(f[key] - frames[i][key]), 0);
  const excessTravel = Math.max(0, travel / Math.max(excursion * 2, 1) - 1);
  const control = Math.round(100 * (1 - clamp(excessTravel / 0.5)));
  const depth = Math.round(100 * (1 - clamp((bottomAngle - (exercise === 'squat' ? 105 : 100)) / 35)));
  const issues = [];
  const components = {rangeOfMotion: {score: depth, weight: exercise === 'squat' ? 0.45 : 0.4, observed: round(bottomAngle), unit: 'degree', target: exercise === 'squat' ? '可见膝角≤105°' : '可见肘角≤100°'}};
  const metrics = {duration: round(end - start), descentDuration: round(bottom.time - start), ascentDuration: round(end - bottom.time), bottomAngle: round(bottomAngle), angleRange: round(excursion), excessAngleTravel: round(excessTravel), components};
  if (depth < 85) issues.push(issue(bottom.time, 'LIMITED_DEPTH', exercise === 'squat' ? '侧面可见屈膝幅度偏小，可检查本次下蹲深度。' : '侧面可见屈肘幅度偏小，可检查本次下降幅度。'));
  if (exercise === 'squat') {
    const lean = quantile(frames.map(f => f.torsoLean), 0.9);
    const trunk = Math.round(100 * (1 - clamp((lean - 50) / 30)));
    metrics.maxTorsoLean = round(lean);
    components.trunk = {score: trunk, weight: 0.35, observed: round(lean), unit: 'degree', target: '肩髋连线相对画面竖直方向≤50°'};
    if (trunk < 80) issues.push(issue(frames.reduce((a, b) => b.torsoLean > a.torsoLean ? b : a).time, 'TORSO_LEAN', '肩髋连线前倾较大，请结合动作类型检查躯干控制；视频不能判断腰椎是否弯曲。'));
  } else {
    const alignment = quantile(frames.map(f => f.bodyAngle), 0.1);
    const body = Math.round(100 * (1 - clamp((165 - alignment) / 35)));
    metrics.bodyAlignmentAngle = round(alignment);
    components.alignment = {score: body, weight: 0.4, observed: round(alignment), unit: 'degree', target: '肩髋踝夹角≥165°'};
    if (body < 85) issues.push(issue(frames.reduce((a, b) => b.bodyAngle < a.bodyAngle ? b : a).time, 'BODY_ALIGNMENT', '本次过程中肩、髋、踝的连线偏离较大，请检查是否塌腰或抬臀。'));
  }
  components.control = {score: control, weight: 0.2, observed: round(excessTravel), unit: 'ratio', target: '下降及上升阶段保持连续，额外往返幅度接近0'};
  if (control < 80) issues.push(issue(bottom.time, 'UNSTEADY_MOVEMENT', '本次可见关节轨迹出现多次往返，请检查动作控制或拍摄稳定性。'));
  const score = Math.round(Object.values(components).reduce((sum, c) => sum + c.score * c.weight, 0));
  const qualified = Object.values(components).every(component => component.score >= 80);
  return {index, start: round(start), end: round(end), bottom: round(bottom.time), time: round(bottom.time), score, qualified, metrics, issues};
}

/**
 * @param {Array<{time:number,landmarks:Array,worldLandmarks?:Array}>} frames Seconds, monotonic samples (missing poses may have an empty array).
 * @param {{width:number,height:number,duration?:number,sourceFps?:number|null}} options Original display dimensions after rotation; sourceFps is original video FPS when known, not sampling FPS.
 * @returns {object} score:null is intentional whenever the clip cannot be evaluated.
 */
export function analyzeMotion(frames, {width, height, duration, sourceFps} = {}) {
  const result = {
    version: MOTION_RULE_VERSION, exerciseId: null, exerciseConfidence: 0, status: 'insufficient', score: null,
    quality: {usableRatio: 0, view: 'uncertain', reasons: [], validFrames: 0, totalFrames: 0, sourceFps: Number.isFinite(sourceFps) ? sourceFps : null},
    reps: [], attemptCount: 0, qualifiedRepCount: 0, incompleteAttemptCount: 0, observedActiveRange: null, issues: [], summary: '',
  };
  const reject = (code, message, status = 'insufficient') => {
    result.status = status; result.summary = message; result.quality.reasons.push(code);
    result.issues.push(issue(0, code, message)); return result;
  };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return reject('INVALID_DIMENSIONS', '缺少有效的视频尺寸，无法计算动作角度。');
  if (!Array.isArray(frames)) return reject('NO_POSE', '没有可供分析的人体关键点。');
  // Duplicate timestamps never create extra samples or artificial holds.
  const ordered = [...new Map(frames.filter(f => f && Number.isFinite(f.time) && f.time >= 0).map(f => [f.time, f])).values()].sort((a, b) => a.time - b.time);
  result.quality.totalFrames = ordered.length;
  if (ordered.length < 8) return reject('TOO_FEW_FRAMES', '有效采样太少，请上传包含完整动作的视频。');
  if (ordered.some(f => Number.isFinite(f.personCount) && f.personCount > 1)) return reject('MULTIPLE_PEOPLE', '视频中检测到多个人，无法确定要评估的对象，请上传单人运动视频。', 'unsupported');
  const intervals = ordered.slice(1).map((f, i) => f.time - ordered[i].time);
  const medianInterval = quantile(intervals, 0.5);
  const maxGap = Math.min(0.35, Math.max(0.18, medianInterval * 2.1));
  const side = mean(ordered.map(f => mean(SIDES[0].map(i => confidence(f.landmarks?.[i]))))) >= mean(ordered.map(f => mean(SIDES[1].map(i => confidence(f.landmarks?.[i]))))) ? 0 : 1;
  const allFeatures = ordered.map(f => frameFeatures(f, side, width, height)).filter(Boolean);
  // Recognition and evaluation are different questions. Preserve a supported
  // identity even if sampling, visibility or perspective prevents a fair score.
  const identified = classify(allFeatures);
  result.exerciseId = identified.id; result.exerciseConfidence = identified.confidence;
  const activeRange = identified.id ? activeRangeFor(allFeatures, identified.id) : null;
  result.observedActiveRange = activeRange ? {start: round(activeRange.start), end: round(activeRange.end)} : null;
  const features = activeRange ? allFeatures.filter(f => f.time >= activeRange.start && f.time <= activeRange.end) : allFeatures;
  const assessedFrames = activeRange ? ordered.filter(f => f.time >= activeRange.start && f.time <= activeRange.end).length : ordered.length;
  const span = activeRange ? activeRange.end - activeRange.start : Number.isFinite(duration) && duration > 0 ? Math.max(duration, ordered.at(-1).time) : ordered.at(-1).time - ordered[0].time;
  const coveredTime = features.slice(1).reduce((sum, f, i) => sum + (f.time - features[i].time <= maxGap ? f.time - features[i].time : 0), 0);
  result.quality.validFrames = features.length;
  result.quality.assessedFrames = assessedFrames;
  result.quality.usableRatio = round(Math.min(features.length / Math.max(assessedFrames, 1), coveredTime / Math.max(span, medianInterval)));
  if (Number.isFinite(sourceFps) && sourceFps < 5) return reject('LOW_SOURCE_FRAME_RATE', '原视频帧率低于每秒5帧，动作过程信息不足，无法可靠评分。');
  if (medianInterval > 0.21) return reject('LOW_SAMPLE_RATE', '视频采样频率不足，无法可靠检查完整动作，请重新分析。');
  if (features.length < 8 || result.quality.usableRatio < 0.7) return reject('LOW_POSE_COVERAGE', '身体关键点被遮挡或缺失较多，请保持全身入镜、单人拍摄后重试。');
  if (!identified.id) return reject(identified.static ? 'NO_MOVEMENT' : 'UNSUPPORTED_MOVEMENT', identified.static ? '未观察到足够的完整动作变化，静止姿势不评分。' : '未可靠识别到支持的完整动作。目前支持侧面徒手深蹲和标准俯卧撑。', identified.static ? 'insufficient' : 'unsupported');
  const visibleViews = features.map(f => f.viewRatio).filter(Number.isFinite);
  const sideRatio = mean(visibleViews.map(r => Number(r <= 0.38)));
  if (visibleViews.length / features.length < 0.7 || sideRatio < 0.8) return reject('SIDE_VIEW_REQUIRED', '当前拍摄角度无法可靠评估，请固定相机，从身体侧面拍摄完整动作。');
  result.quality.view = 'side';
  const segments = splitAndSmooth(features, maxGap);
  const detected = detectReps(segments, identified.id);
  result.incompleteAttemptCount = detected.incompleteAttempts;
  if (!detected.reps.length) return reject('INCOMPLETE_REPETITION', '已识别到动作趋势，但没有观察到完整的起始、下降和回到起始位置，请补拍完整动作。');
  result.reps = detected.reps.map((rep, i) => scoreRep(rep, identified.id, i + 1));
  result.attemptCount = result.reps.length;
  result.qualifiedRepCount = result.reps.filter(rep => rep.qualified).length;
  result.issues = result.reps.flatMap(rep => rep.issues);
  if (activeRange && (activeRange.start - ordered[0].time > 0.5 || ordered.at(-1).time - activeRange.end > 0.5)) result.issues.push(issue(activeRange.start, 'ACTIVE_RANGE', `分析区间为${round(activeRange.start)}至${round(activeRange.end)}秒，区间外片段未计分。`, 'info'));
  if (detected.partial) result.issues.push(issue(ordered.at(-1).time, 'PARTIAL_REPETITION_EXCLUDED', '视频中的不完整动作未计数、未评分。', 'info'));
  if (segments.length > 1) result.issues.push(issue(segments[1][0].time, 'POSE_GAP', '关键点缺失的片段已跳过，只评估连续可见的完整动作。', 'info'));
  result.score = Math.round(mean(result.reps.map(rep => rep.score)));
  result.status = 'complete';
  const name = identified.id === 'squat' ? '深蹲' : '俯卧撑';
  const partialText = result.incompleteAttemptCount ? `另有${result.incompleteAttemptCount}次缺少完整起止，未计分。` : '';
  result.summary = `识别到${result.attemptCount}次起止完整的${name}，其中${result.qualifiedRepCount}次达到当前可见动作规则，可见动作参考分${result.score}分。${partialText}评分依据侧面角度、动作幅度与轨迹控制，仍需用更多真实视频校准。`;
  return result;
}

export default analyzeMotion;
