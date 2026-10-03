/**
 * Observable, side-view movement rules; this is not a validated coach model.
 * Image points use x * width and y * height. Inferred monocular z/world points
 * are deliberately not treated as measured 3D anatomy or as a view guarantee.
 * Thresholds need calibration against independently labelled real recordings.
 */
import {motionFamilies, getMotionExercise, getMotionFamily} from './motion-catalog.js';
export const MOTION_RULE_VERSION = 'motion-rules-2.2.0';

const SIDES = [[11, 13, 15, 23, 25, 27], [12, 14, 16, 24, 26, 28]];
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const round = (v, digits = 2) => Number(v.toFixed(digits));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const quantile = (values, q) => {
  values = values.filter(Number.isFinite);
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p = (sorted.length - 1) * q;
  return sorted[Math.floor(p)] + (sorted[Math.ceil(p)] - sorted[Math.floor(p)]) * (p % 1);
};
const distance = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN;
const angle = (a, b, c) => {
  const ab = distance(a, b), cb = distance(c, b);
  if (!Number.isFinite(ab) || !Number.isFinite(cb) || ab < 1e-6 || cb < 1e-6) return null;
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
  const [shoulder, elbow, wrist, hip, knee, ankle] = joints;
  if (!shoulder || !hip) return null;
  const torso = distance(shoulder, hip), leg = distance(hip, knee) + distance(knee, ankle);
  const arm = distance(shoulder, elbow) + distance(elbow, wrist);
  if (torso < Math.min(width, height) * 0.06) return null;
  const kneeAngle = angle(hip, knee, ankle), elbowAngle = angle(shoulder, elbow, wrist);
  const bodyAngle = angle(shoulder, hip, ankle);
  // Bilateral projected width is a conservative view screen, not camera calibration.
  const bilateral = [11, 12, 23, 24].map(i => point(landmarks[i], width, height));
  const viewRatio = bilateral.every(Boolean) ? Math.max(distance(bilateral[0], bilateral[1]), distance(bilateral[2], bilateral[3])) / torso : null;
  const bodyLength = distance(shoulder, ankle);
  const other = SIDES[1 - side].map(i => point(landmarks[i], width, height));
  const ear = point(landmarks[side === 0 ? 7 : 8], width, height);
  const nose = point(landmarks[0], width, height);
  const heel = point(landmarks[side === 0 ? 29 : 30], width, height);
  const toe = point(landmarks[side === 0 ? 31 : 32], width, height);
  return {
    time: frame.time, shoulder, elbow, wrist, hip, knee, ankle, torso, leg, arm, ear, nose, heel, toe,
    kneeAngle, elbowAngle, bodyAngle, viewRatio,
    hipAngle: angle(shoulder, hip, knee), armElevation: angle(hip, shoulder, elbow),
    otherKneeAngle: angle(other[3], other[4], other[5]),
    ankleSeparation: ankle && other[5] && Number.isFinite(leg) ? distance(ankle, other[5]) / leg : null,
    heelLift: heel && toe ? (toe.y - heel.y) / torso : null,
    neckGap: ear ? (shoulder.y - ear.y) / torso : null,
    torsoLean: Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180 / Math.PI,
    upright: !!ankle && shoulder.y < hip.y - torso * 0.25 && ankle.y > hip.y + leg * 0.2 && Math.abs(shoulder.x - ankle.x) / bodyLength < 0.55,
    // The floor recedes in perspective: wrist and ankle need NOT have equal y.
    horizontal: !!ankle && !!wrist && Math.abs(shoulder.x - ankle.x) / bodyLength > 0.75 && wrist.y > shoulder.y + arm * 0.12 && Math.abs(wrist.x - shoulder.x) < arm * 0.9,
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
    return {...f, kneeSmooth: Number.isFinite(f.kneeAngle) ? quantile(neighbours.map(x => x.kneeAngle), 0.5) : null, elbowSmooth: Number.isFinite(f.elbowAngle) ? quantile(neighbours.map(x => x.elbowAngle), 0.5) : null};
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

const finiteRatio = (frames, key) => mean(frames.map(f => Number(Number.isFinite(f[key]))));
const fieldRange = (frames, key) => range(frames.map(f => f[key]));
const jointRange = (frames, joint, axis) => range(frames.map(f => f[joint]?.[axis]));
const ratio = (frames, predicate) => mean(frames.map(f => Number(Boolean(predicate(f)))));
const qField = (frames, key, q = 0.5) => quantile(frames.map(f => f[key]), q);

function identifyPatterns(features) {
  if (features.length < 8) return [];
  const torso = qField(features, 'torso'), k = fieldRange(features, 'kneeAngle'), e = fieldRange(features, 'elbowAngle');
  const a = fieldRange(features, 'armElevation'), h = fieldRange(features, 'hipAngle');
  const hipMove = jointRange(features, 'hip', 'y') / torso, shoulderMove = jointRange(features, 'shoulder', 'y') / torso;
  const vertical = ratio(features, f => f.torsoLean < 40);
  const bent = qField(features, 'torsoLean') > 40;
  const seated = ratio(features, f => f.knee && f.kneeAngle < 135 && Math.abs(f.knee.y - f.hip.y) < torso * 0.6) > 0.6;
  const wristUp = ratio(features, f => f.wrist && f.wrist.y < f.shoulder.y - torso * 0.15);
  const wristLow = ratio(features, f => f.wrist && f.wrist.y > f.shoulder.y + torso * 0.35);
  const elbowShift = range(features.map(f => f.elbow ? (f.elbow.x - f.shoulder.x) / torso : null));
  // A crop can hide the seated legs while preserving the entire pulling arm.
  // Require the elbow to move back against the extended wrist's projected
  // direction. Wrist-to-shoulder shortening alone also occurs in a curl.
  const extendedAngle = qField(features, 'elbowAngle', 0.75), flexedAngle = qField(features, 'elbowAngle', 0.25);
  const extendedArm = features.filter(f => Number.isFinite(f.elbowAngle) && f.elbowAngle >= extendedAngle);
  const flexedArm = features.filter(f => Number.isFinite(f.elbowAngle) && f.elbowAngle <= flexedAngle);
  const wristRetraction = quantile(extendedArm.map(f => distance(f.wrist, f.shoulder) / torso), 0.5) - quantile(flexedArm.map(f => distance(f.wrist, f.shoulder) / torso), 0.5);
  const wristForward = quantile(extendedArm.map(f => f.wrist ? (f.wrist.x - f.shoulder.x) / torso : null), 0.5);
  const elbowRetraction = (quantile(extendedArm.map(f => f.elbow ? (f.elbow.x - f.shoulder.x) / torso : null), 0.5) - quantile(flexedArm.map(f => f.elbow ? (f.elbow.x - f.shoulder.x) / torso : null), 0.5)) * Math.sign(wristForward);
  const croppedPull = finiteRatio(features, 'kneeAngle') < 0.5 && Math.abs(wristForward) > 0.25 && elbowRetraction > 0.18 && wristRetraction > 0.18 && shoulderMove < 0.25;
  // A tilted, supported torso with extended hips can be a lying press or a
  // supported row. Camera projection can put a pressing wrist below the
  // shoulder; unseen legs cannot establish the bent-over pulling stance.
  const supportedPressOverlap = bent && shoulderMove < 0.25 && (finiteRatio(features, 'hipAngle') < 0.5 || qField(features, 'hipAngle') > 140);
  const patterns = [];
  const add = (family, evidence, confidence = 0.82) => patterns.push({family, confidence, evidence});
  const legacy = classifyWindow(features);
  const splitLegs = qField(features, 'ankleSeparation') > 0.35 && quantile(features.map(f => Number.isFinite(f.otherKneeAngle) && Number.isFinite(f.kneeAngle) ? Math.abs(f.otherKneeAngle - f.kneeAngle) : null), 0.6) > 18;
  if (splitLegs && k > 20 && hipMove > 0.08) add('lunge', '分腿支撑、左右屈膝不同步并伴随髋部升降');
  else if (h > 25 && k < 35 && qField(features, 'kneeAngle') > 130 && fieldRange(features, 'torsoLean') > 18 && hipMove > 0.06) add('hinge', '以髋部屈伸和躯干俯仰为主，屈膝变化较小');
  else if (legacy.id === 'squat') {
    add('squat', '站姿下屈膝与髋部升降共同变化', legacy.confidence);
    if (h > k * 1.35 && fieldRange(features, 'torsoLean') > 30) add('hinge', '屈膝与髋铰链均有变化，需结合负重轨迹区分蹲起与硬拉');
  }
  if (legacy.id === 'pushup') add('pushup', '水平身体、手脚支撑、肩部升降与屈肘共同变化', legacy.confidence);
  if (!patterns.length && e >= 18 && finiteRatio(features, 'elbowAngle') >= 0.65) {
    if (ratio(features, f => f.horizontal) < 0.3 && (seated || bent || croppedPull) && wristLow > 0.6 && elbowShift > 0.18 && hipMove < 0.3 && wristUp < 0.2) {
      add('row', '屈肘拉回，肘部相对躯干前后移动');
      if (supportedPressOverlap) add('horizontal-press', '倾斜躯干与屈伸肘的投影也符合支撑卧推动作，需确认器械、支撑面与受力方向');
    }
    else if (qField(features, 'armElevation', 0.25) > 120 && a < 25) add('overhead-extension', '上臂保持过顶，肘部反复屈伸');
    else if (wristUp > 0.35 && vertical > 0.6) {
      add('overhead-press', '手臂在头上屈伸，单靠骨架无法确定推或拉');
      add('vertical-pull', '手臂在头上屈伸，需看到器械与支撑关系');
    } else if ((bent && wristUp > 0.55 && shoulderMove < 0.25) || (vertical > 0.7 && seated && wristLow < 0.4 && elbowShift > 0.15)) add('horizontal-press', '手臂在胸部附近伸展，需确认凳面或器械');
    else if (vertical > 0.7 && qField(features, 'armElevation') < 65 && a < 35 && hipMove < 0.25) add('elbow-isolation', '上臂相对稳定、肘关节反复屈伸；握法和受力方向未知');
  }
  if (patterns.some(p => p.family === 'elbow-isolation') && qField(features, 'viewRatio') > 0.38 && elbowShift > 0.18) add('row', '斜前方视角下屈肘与拉回投影相近，需要器械与支撑证据');
  if (!patterns.length && a >= 25 && (e < 25 || a > e * 0.8) && finiteRatio(features, 'armElevation') >= 0.65) add(bent ? 'reverse-fly' : 'lateral-raise', '肘部变化较小，手臂相对躯干抬起');
  if (!patterns.length && k >= 25 && hipMove < 0.12 && shoulderMove < 0.12) add('knee-isolation', '髋部稳定、膝部反复屈伸，需确认器械与受力方向');
  if (!patterns.length && qField(features, 'kneeAngle') < 135 && bent) {
    if (hipMove > 0.12 && hipMove > shoulderMove * 1.6 && h > 15) add('bridge', '屈膝支撑、肩部相对固定而髋部升降');
    else if (shoulderMove > 0.1 && shoulderMove > hipMove * 1.5 && h > 15) add('crunch', '髋部相对稳定，上躯干反复卷起');
  }
  if (!patterns.length && vertical > 0.75 && k < 15 && fieldRange(features, 'heelLift') >= 0.045 && hipMove > 0.02) add('calf', '膝部变化较小，脚跟相对前脚掌升降');
  const stableSupport = ratio(features, f => f.horizontal) > 0.8 && e < 12 && k < 15 && fieldRange(features, 'bodyAngle') < 15;
  if (!patterns.length && stableSupport && features.at(-1).time - features[0].time >= 3 && qField(features, 'elbowAngle') < 125) add('plank', '持续的前臂支撑姿态，未观察到重复屈伸');
  return patterns;
}

function familyMotionTemplate(family) {
  if (typeof family !== 'string' || !Object.hasOwn(motionFamilies, family)) return null;
  const template = getMotionFamily(family)[0];
  // Reuse the family's checks without claiming its first catalogue exercise or
  // selecting that exercise's specific repetition direction.
  return template ? {...template, id: null, name: motionFamilies[family]} : null;
}

function resolveMotionHint(hint) {
  const exact = getMotionExercise(typeof hint === 'string' ? hint : hint?.exerciseId);
  if (exact) return exact;
  return hint && typeof hint === 'object' && !Array.isArray(hint) ? familyMotionTemplate(hint.family) : null;
}

function recognizeMotion(features, exerciseHint) {
  let patterns = identifyPatterns(features);
  // Compare recurring short-window evidence. A one-off transition between a
  // preparation pose and the exercise must not define the movement family.
  if (features.length >= 8) {
    const votes = new Map();
    for (let start = features[0].time; start < features.at(-1).time - 1; start += 1.5) {
      for (const pattern of identifyPatterns(features.filter(f => f.time >= start && f.time <= start + 4))) {
        const previous = votes.get(pattern.family);
        votes.set(pattern.family, {...pattern, windows: (previous?.windows || 0) + 1});
      }
    }
    const strongest = Math.max(0, ...[...votes.values()].map(p => p.windows));
    if (strongest >= 2 || !patterns.length) patterns = [...votes.values()].filter(p => p.windows >= Math.max(1, strongest * 0.75));
  }
  const hinted = resolveMotionHint(exerciseHint);
  const families = [...new Set(patterns.map(p => p.family))];
  const hintCompatible = hinted && (families.includes(hinted.family) || (!families.length && postureMatches(features, hinted.family)));
  if (hinted && !hintCompatible) return {exerciseId: null, family: null, confidence: 0, candidates: candidatesFor(patterns, features), requiresVisualConfirmation: true, conflict: true};
  if (hintCompatible) return {exerciseId: hinted.id, family: hinted.family, confidence: Math.max(0.8, patterns.find(p => p.family === hinted.family)?.confidence || 0), candidates: candidatesFor(patterns, features), requiresVisualConfirmation: hinted.id === null, hintUsed: true};
  const candidates = candidatesFor(patterns, features);
  if (families.length !== 1) return {exerciseId: null, family: families.length > 1 ? 'ambiguous' : null, confidence: 0, candidates, requiresVisualConfirmation: families.length > 1};
  const family = families[0], entries = getMotionFamily(family);
  // Preserve the existing basic deep-link/API: squat here denotes its movement
  // family, not evidence that no external weight is present.
  const exerciseId = family === 'squat' ? 'squat' : entries.length === 1 && entries[0].localRecognition === 'direct' ? entries[0].id : null;
  return {exerciseId, family, confidence: patterns[0].confidence, candidates, requiresVisualConfirmation: entries.length > 1 || entries[0]?.localRecognition !== 'direct'};
}

function candidatesFor(patterns, features) {
  const times = features.length ? [round(features[0].time), round(features[Math.floor(features.length / 2)].time), round(features.at(-1).time)] : [];
  return patterns.flatMap(pattern => getMotionFamily(pattern.family).map(exercise => ({exerciseId: exercise.id, confidence: pattern.confidence, evidenceTimes: times, reason: pattern.evidence})));
}

function postureMatches(features, family) {
  if (features.length < 8) return false;
  if (family === 'squat' || family === 'lunge' || family === 'hinge' || family === 'calf') return ratio(features, f => f.upright) > 0.5;
  if (family === 'pushup' || family === 'plank') return ratio(features, f => f.horizontal && f.kneeAngle > 135) > 0.5;
  if (family === 'bridge' || family === 'crunch') return ratio(features, f => f.kneeAngle < 140 && f.torsoLean > 35) > 0.5;
  return finiteRatio(features, family === 'knee-isolation' ? 'kneeAngle' : 'elbowAngle') > 0.5;
}

function signalSpec(family, exerciseId) {
  const specs = {
    squat: ['kneeAngle', -1, 18], pushup: ['elbowAngle', -1, 18], lunge: ['kneeAngle', -1, 18],
    hinge: ['hipAngle', -1, 15], row: ['elbowAngle', -1, 18], 'elbow-isolation': ['elbowAngle', exerciseId === 'triceps' ? 1 : -1, 18],
    'horizontal-press': ['elbowAngle', 1, 18], 'overhead-press': ['elbowAngle', 1, 18], 'vertical-pull': ['elbowAngle', -1, 18],
    'overhead-extension': ['elbowAngle', -1, 18], 'lateral-raise': ['armElevation', 1, 18], 'reverse-fly': ['armElevation', 1, 18],
    'knee-isolation': ['kneeAngle', exerciseId === 'leg-extension' ? 1 : -1, 18], bridge: ['hipAngle', 1, 12],
    crunch: ['hipAngle', -1, 12], calf: ['heelLift', 1, 0.025],
  };
  return specs[family] || null;
}

function detectPatternReps(segments, family, exerciseId) {
  if (family === 'squat' || family === 'pushup') return detectReps(segments, family);
  if (family === 'plank') {
    const reps = segments.filter(s => s.at(-1).time - s[0].time >= 3).map(frames => ({frames, bottom: frames[Math.floor(frames.length / 2)], isometric: true}));
    return {reps, partial: false, incompleteAttempts: 0};
  }
  const spec = signalSpec(family, exerciseId);
  if (!spec) return {reps: [], partial: false, incompleteAttempts: 0};
  const [key, direction, minimum] = spec;
  const reps = []; let partial = 0;
  for (const segment of segments) {
    let signal = segment.map((f, i) => Number.isFinite(f[key]) ? quantile(segment.slice(Math.max(0, i - 1), i + 2).filter(g => Math.abs(g.time - f.time) <= 0.12).map(g => g[key]), 0.5) * direction : null);
    let lo = quantile(signal, 0.08), hi = quantile(signal, 0.92);
    const span = hi - lo;
    if (span < minimum) continue;
    // A press may begin at either endpoint. Pick one baseline per continuous
    // segment; running both directions would count overlapping half cycles.
    const firstEndpoint = signal.find(value => Number.isFinite(value) && (value <= lo + span * 0.12 || value >= hi - span * 0.12));
    if (family === 'horizontal-press' && firstEndpoint >= hi - span * 0.12) {
      signal = signal.map(value => Number.isFinite(value) ? -value : null);
      [lo, hi] = [-hi, -lo];
    }
    const base = lo + span * 0.12, departure = lo + span * 0.3;
    let anchor = null, active = null;
    for (let i = 0; i < segment.length; i++) {
      const v = signal[i];
      if (!Number.isFinite(v)) { if (active) partial++; active = null; anchor = null; continue; }
      if (!active) {
        if (v <= base) anchor = i;
        else if (anchor !== null && v >= departure) active = {start: anchor, peak: i};
      } else {
        if (v > signal[active.peak]) active.peak = i;
        if (v <= base) {
          const frames = segment.slice(active.start, i + 1), bottom = segment[active.peak];
          if (signal[active.peak] - signal[active.start] >= minimum && frames.length >= 7 && bottom.time - frames[0].time >= 0.2 && frames.at(-1).time - bottom.time >= 0.2 && frames.at(-1).time - frames[0].time <= 20) reps.push({frames, bottom});
          else partial++;
          active = null; anchor = i;
        }
      }
    }
    if (active) partial++;
  }
  return {reps, partial: partial > 0, incompleteAttempts: segments.length > 1 ? null : partial};
}

const checkNeeds = {
  SQUAT_DEPTH: ['kneeAngle'], SQUAT_TORSO_LEAN: ['torsoLean'], SQUAT_HIP_SHOULDER_SYNC: ['torsoLean'],
  PUSHUP_DEPTH: ['elbowAngle'], BODY_ALIGNMENT: ['bodyAngle'], ROW_ROM: ['elbowAngle'],
  ROW_SHRUG: ['neckGap', 'elbowAngle'], ROW_TORSO_SWING: ['torsoLean'], HINGE_ROM: ['hipAngle'], HINGE_KNEE_CONTROL: ['kneeAngle'],
  LUNGE_DEPTH: ['kneeAngle'], LUNGE_BALANCE: ['torsoLean'], PRESS_ROM: ['elbowAngle'], PRESS_TRUNK: ['torsoLean'],
  PULL_ROM: ['elbowAngle'], PULL_SWING: ['torsoLean'], ARM_ROM: ['elbowAngle'], UPPER_ARM_STABILITY: ['armElevation'],
  RAISE_HEIGHT: ['armElevation'], RAISE_SHRUG: ['neckGap'], BRIDGE_EXTENSION: ['hipAngle'], CALF_ROM: ['heelLift'],
  CALF_BALANCE: ['torsoLean'], PLANK_ALIGNMENT: ['bodyAngle'], PLANK_HOLD: ['bodyAngle'], CRUNCH_ROM: ['hipAngle'],
  LEG_ROM: ['kneeAngle'], HIP_STABILITY: ['torsoLean'],
};

function durationWhere(frames, predicate) {
  return frames.slice(1).reduce((sum, f, i) => sum + (f.time - frames[i].time <= 0.35 && predicate(f) && predicate(frames[i]) ? f.time - frames[i].time : 0), 0);
}

function evaluateCheck(definition, rep, family) {
  const {frames, bottom} = rep, {code} = definition;
  const base = {...definition, status: 'unobservable', severity: 'info', time: round(bottom.time), score: null, source: 'pose', scope: 'unobservable', evidenceTimes: [round(bottom.time)], evidence: {metric: code, value: null, unit: null, samples: 0}, message: '', correction: ''};
  const unknown = message => ({...base, message, correction: code === 'SPINE_NEUTRAL' ? '需要清晰关键帧或其他机位补充核验，不能依据肩髋直线认定脊柱中立。' : definition.visual ? '使用清晰的完整动作画面补充核验；骨架信息不足以确认这一项。' : '补拍能清楚看到相关关节的机位后再评估。'});
  if (code === 'RAISE_SHRUG') return unknown('抬臂时肩部位置变化不能单凭肩耳间距认定为代偿；33点缺少肩胛运动信息，需要画面补充核验。');
  if (definition.visual) return unknown(code === 'SPINE_NEUTRAL' ? '33个人体关键点没有胸腰椎和骨盆朝向信息，无法确认脊柱是否保持自然位置。' : `${definition.label}需要视频画面补充，骨架数据无法直接确认。`);
  const needs = checkNeeds[code] || [];
  const valid = frames.filter(f => needs.every(key => Number.isFinite(f[key])));
  if (valid.length < 5 || valid.length / frames.length < 0.75) return unknown(`${definition.label}所需关键点缺失或被遮挡。`);
  if (definition.requiredView === 'side' && ratio(valid, f => Number.isFinite(f.viewRatio) && f.viewRatio <= 0.38) < 0.7) return unknown(`${definition.label}需要接近侧面的观察角度，当前投影不能可靠量化。`);
  const make = (metric, value, unit, warning, severe, higherIsWorse, message, correction, extra = {}) => {
    const failing = higherIsWorse ? value > warning : value < warning;
    const isSevere = higherIsWorse ? value > severe : value < severe;
    const peak = extra.frame || bottom;
    const score = failing ? Math.round(clamp(1 - Math.abs(value - warning) / Math.max(Math.abs(severe - warning), 1e-6) * 0.8) * 100) : 100;
    return {...base, status: failing ? 'fail' : 'pass', severity: failing ? isSevere ? 'severe' : 'warning' : 'info', score, scope: 'whole-repetition', time: round(peak.time), evidenceTimes: [round(peak.time)], evidence: {metric, value: round(value, 3), unit, threshold: {warning, severe, direction: higherIsWorse ? 'maximum' : 'minimum', kind: 'application-screening-rule'}, samples: valid.length, ...extra.evidence}, message: failing ? message : `${definition.label}在本次可观察范围内未触发异常规则。`, correction: failing ? correction : '', source: 'pose'};
  };
  const worst = (key, direction = 1) => valid.reduce((a, b) => b[key] * direction > a[key] * direction ? b : a);
  if (code === 'SQUAT_DEPTH' || code === 'PUSHUP_DEPTH' || code === 'LUNGE_DEPTH') {
    const key = code === 'PUSHUP_DEPTH' ? 'elbowAngle' : 'kneeAngle';
    const value = quantile(valid.filter(f => Math.abs(f.time - bottom.time) <= 0.2).map(f => f[key]), 0.25);
    return make('bottomJointAngle', value, 'degree', code === 'SQUAT_DEPTH' ? 110 : 105, 140, true, '本次可见屈曲幅度不足。', '在可控且无痛的范围增加下降幅度，并用侧面画面复核。');
  }
  if (code === 'SQUAT_TORSO_LEAN') {
    const value = qField(valid, 'torsoLean', 0.9), baseline = quantile(valid.slice(0, Math.max(2, Math.floor(valid.length * 0.15))).map(f => f.torsoLean), 0.5);
    const sustained = durationWhere(valid, f => f.torsoLean > 50);
    if (sustained < 0.2) return make('torsoLean', Math.min(value, 50), 'degree', 50, 65, true, '', '', {frame: worst('torsoLean'), evidence: {baseline: round(baseline), duration: round(sustained)}});
    return make('torsoLean', value, 'degree', 50, 65, true, '下降或起身阶段出现持续明显前倾；这不是腰椎中立位的判断。', '减轻负重或缩小幅度，复核肩髋同步与支撑；身体比例和动作变式需结合画面判断。', {frame: worst('torsoLean'), evidence: {baseline: round(baseline), duration: round(sustained), changeFromStart: round(value - baseline)}});
  }
  if (code === 'SQUAT_HIP_SHOULDER_SYNC') {
    const ascending = valid.filter(f => f.time > bottom.time);
    const baseline = bottom.torso;
    const leads = ascending.map(f => ({...f, lead: ((bottom.hip.y - f.hip.y) - (bottom.shoulder.y - f.shoulder.y)) / baseline}));
    if (leads.length < 3) return unknown('起身阶段可见采样不足，无法检查肩髋同步。');
    const peak = leads.reduce((a, b) => b.lead > a.lead ? b : a);
    const duration = durationWhere(leads, f => f.lead > 0.1);
    return make('hipRiseAheadOfShoulder', duration >= 0.2 ? quantile(leads.map(f => f.lead), 0.9) : 0, 'torso-length-ratio', 0.1, 0.22, true, '起身时髋部明显先于肩部上升。', '先减轻负重，练习髋与肩一同上升，避免起身时躯干进一步前倒。', {frame: peak, evidence: {duration: round(duration), baseline: round(baseline)}});
  }
  if (code === 'ROW_SHRUG') {
    const withHead = valid.filter(f => f.ear && f.neckGap > 0.025 && f.neckGap < 0.7);
    if (withHead.length / frames.length < 0.75) return unknown('耳部或肩部不清晰，无法检查肩耳间距随时间的变化。');
    const resting = withHead.filter(f => f.elbowAngle >= qField(withHead, 'elbowAngle', 0.75));
    if (resting.length < 2) return unknown('缺少清晰还原姿态，无法建立肩部自然位置基线。');
    const scale = qField(resting, 'torso');
    const baseline = quantile(resting.map(f => (f.shoulder.y - f.ear.y) / scale), 0.5);
    const earHip = range(withHead.map(f => (f.ear.y - f.hip.y) / scale));
    if (earHip > 0.22) return unknown('头部或躯干移动较大，肩耳间距变化不能单独归因为耸肩。');
    const series = withHead.map(f => ({...f, elevation: baseline - (f.shoulder.y - f.ear.y) / scale}));
    const duration = durationWhere(series, f => f.elevation > 0.08);
    const peak = series.reduce((a, b) => b.elevation > a.elevation ? b : a);
    const value = duration >= 0.2 ? quantile(series.map(f => f.elevation), 0.9) : 0;
    return make('shoulderEarGapReduction', value, 'torso-length-ratio', 0.08, 0.14, true, '发力阶段肩部持续向耳部靠近，出现动态耸肩迹象。', '减轻阻力，保持头部稳定，让肩部远离耳朵；划船时以肘向后移动，不用抬肩完成拉动。', {frame: peak, evidence: {baseline: round(baseline, 3), duration: round(duration), headMotion: round(earHip, 3)}});
  }
  if (['ROW_TORSO_SWING', 'PRESS_TRUNK', 'PULL_SWING', 'CALF_BALANCE', 'LUNGE_BALANCE'].includes(code)) {
    const value = code === 'LUNGE_BALANCE' ? qField(valid, 'torsoLean', 0.9) : fieldRange(valid, 'torsoLean');
    return make('torsoAngleChange', value, 'degree', code === 'LUNGE_BALANCE' ? 35 : 12, code === 'LUNGE_BALANCE' ? 55 : 25, true, '本次躯干角度变化或偏斜较大。', '降低阻力或速度，保持支撑稳定，减少以躯干前后摆动带动动作。', {frame: worst('torsoLean')});
  }
  if (['BODY_ALIGNMENT', 'PLANK_ALIGNMENT', 'BRIDGE_EXTENSION'].includes(code)) {
    const key = code === 'BRIDGE_EXTENSION' ? 'hipAngle' : 'bodyAngle';
    const value = qField(valid, key, code === 'BRIDGE_EXTENSION' ? 0.9 : 0.1);
    return make('bodyAlignmentAngle', value, 'degree', 165, 145, false, '本次肩、髋与下肢连线明显偏离目标位置。', code === 'BRIDGE_EXTENSION' ? '用臀部发力抬髋至肩髋膝接近一线，避免用腰部过伸补偿。' : '收紧躯干、调整髋部位置；保持不住连线时降低动作难度。', {frame: worst(key, -1)});
  }
  if (code === 'HINGE_KNEE_CONTROL') return make('kneeAngleRange', fieldRange(valid, 'kneeAngle'), 'degree', 30, 50, true, '髋铰链过程中屈膝变化较大，动作更接近蹲起。', '保持适度屈膝，以髋部向后移动为主；需结合具体硬拉变式确认。');
  if (code === 'UPPER_ARM_STABILITY') {
    const baseline = qField(valid, 'armElevation');
    const peak = valid.reduce((a, b) => Math.abs(b.armElevation - baseline) > Math.abs(a.armElevation - baseline) ? b : a);
    return make('upperArmAngleRange', fieldRange(valid, 'armElevation'), 'degree', 18, 35, true, '屈伸肘时上臂位置明显变化，可能存在借力。', '降低重量，固定上臂的可控位置，主要围绕肘关节运动。', {frame: peak, evidence: {baseline: round(baseline), changeFromBaseline: round(peak.armElevation - baseline)}});
  }
  if (code === 'HIP_STABILITY') return make('hipTravel', jointRange(valid, 'hip', 'x') / qField(valid, 'torso'), 'torso-length-ratio', 0.1, 0.25, true, '髋部位置移动较大。', '稳定支撑面与髋部，避免靠身体滑动或甩动完成动作。');
  if (code === 'PLANK_HOLD') return make('continuousHold', valid.at(-1).time - valid[0].time, 'second', 3, 1, false, '连续可观察保持时间不足。', '保持全身入镜，记录一段连续稳定的支撑姿态。');
  if (code === 'RAISE_HEIGHT') {
    const value = qField(valid, 'armElevation', 0.9);
    if (value > 120) return make('peakArmElevation', value, 'degree', 120, 145, true, '手臂抬升明显超过当前动作参考范围。', '使用轻重量，把抬升范围控制在舒适、可控的肩部高度附近。');
    return make('peakArmElevation', value, 'degree', 65, 35, false, '本次手臂抬升幅度偏小。', '在无痛且不耸肩的条件下逐步增加可控抬升幅度。');
  }
  if (code === 'MOTION_CONTROL') {
    const spec = signalSpec(family, null);
    if (!spec || finiteRatio(frames, spec[0]) < 0.75) return unknown('连续轨迹采样不足，无法评估动作控制。');
    const values = valid.map(f => f[spec[0]]).filter(Number.isFinite);
    const travel = values.slice(1).reduce((sum, value, i) => sum + Math.abs(value - values[i]), 0);
    const excess = Math.max(0, travel / Math.max((Math.max(...values) - Math.min(...values)) * 2, 0.001) - 1);
    return make('excessAngleTravel', excess, 'ratio', 0.18, 0.45, true, '动作轨迹出现明显额外往返。', '减慢动作并稳定相机，减少反弹或突然反向。');
  }
  const key = {ROW_ROM: 'elbowAngle', HINGE_ROM: 'hipAngle', PRESS_ROM: 'elbowAngle', PULL_ROM: 'elbowAngle', ARM_ROM: 'elbowAngle', CALF_ROM: 'heelLift', CRUNCH_ROM: 'hipAngle', LEG_ROM: 'kneeAngle'}[code];
  if (key) return make('jointRangeOfMotion', fieldRange(valid, key), code === 'CALF_ROM' ? 'torso-length-ratio' : 'degree', code === 'CALF_ROM' ? 0.06 : code === 'CRUNCH_ROM' ? 18 : code === 'HINGE_ROM' ? 35 : 65, code === 'CALF_ROM' ? 0.025 : code === 'CRUNCH_ROM' ? 8 : 25, false, '本次可观察活动幅度不足。', '降低阻力，在无痛且可控制的范围完成更充分的屈伸与还原。');
  return unknown('当前检查项缺少可可靠量化的证据。');
}

function strictScore(checks, unresolved = false) {
  const measured = checks.filter(c => c.status !== 'unobservable' && Number.isFinite(c.score));
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const observedWeight = measured.reduce((s, c) => s + c.weight, 0);
  const observedScore = observedWeight ? Math.round(measured.reduce((s, c) => s + c.score * c.weight, 0) / observedWeight) : null;
  const unknown = checks.some(c => c.status === 'unobservable');
  let cap = 100;
  if (unknown || unresolved) cap = Math.min(cap, 84);
  if (checks.some(c => c.critical && c.status === 'unobservable')) cap = Math.min(cap, 69);
  if (checks.some(c => c.status === 'fail')) cap = Math.min(cap, 79);
  if (checks.some(c => c.critical && c.status === 'fail')) cap = Math.min(cap, 59);
  if (checks.some(c => c.status === 'fail' && c.severity === 'severe')) cap = Math.min(cap, 49);
  return {observedScore, score: observedScore === null ? null : Math.min(observedScore, cap), scoreCoverage: totalWeight ? round(observedWeight / totalWeight, 3) : 0, scoreStatus: observedScore === null ? 'unavailable' : unknown || unresolved ? 'provisional' : 'assessed', qualified: observedScore !== null && !unresolved && checks.every(c => c.status === 'pass'), scoreCap: cap};
}

function strictRep(rep, exercise, index, unresolved) {
  const checks = exercise.checks.map(definition => evaluateCheck(definition, rep, exercise.family));
  const scored = strictScore(checks, unresolved);
  const metrics = {duration: round(rep.frames.at(-1).time - rep.frames[0].time), descentDuration: round(rep.bottom.time - rep.frames[0].time), ascentDuration: round(rep.frames.at(-1).time - rep.bottom.time), components: Object.fromEntries(checks.map(c => [c.code, {score: c.score, weight: c.weight / 100, observed: c.evidence.value, unit: c.evidence.unit, target: c.label, status: c.status}]))};
  const primary = signalSpec(exercise.family, exercise.id);
  if (primary && exercise.family === 'calf') { metrics.peakHeelLift = round(rep.bottom.heelLift, 3); metrics.heelLiftRange = round(fieldRange(rep.frames, 'heelLift'), 3); }
  else if (primary) { metrics.bottomAngle = round(rep.bottom[primary[0]]); metrics.angleRange = round(fieldRange(rep.frames, primary[0])); metrics.primaryAngleJoint = {kneeAngle: 'knee', elbowAngle: 'elbow', hipAngle: 'hip', armElevation: 'shoulder'}[primary[0]]; }
  if (exercise.family === 'squat') metrics.maxTorsoLean = round(qField(rep.frames, 'torsoLean', 0.9));
  if (exercise.family === 'pushup' || exercise.family === 'plank') metrics.bodyAlignmentAngle = round(qField(rep.frames, 'bodyAngle', 0.1));
  return {index, start: round(rep.frames[0].time), end: round(rep.frames.at(-1).time), bottom: round(rep.bottom.time), time: round(rep.bottom.time), ...scored, metrics, checks, issues: checks.filter(c => c.status === 'fail').map(c => ({time: c.time, code: c.code, message: c.message, severity: c.severity, evidence: c.evidence, correction: c.correction}))};
}

function aggregateChecks(reps, definitions) {
  return definitions.map(definition => {
    const checks = reps.map(rep => rep.checks.find(c => c.code === definition.code)).filter(Boolean);
    const failure = checks.filter(c => c.status === 'fail').sort((a, b) => (a.severity === 'severe' ? 0 : 1) - (b.severity === 'severe' ? 0 : 1) || a.score - b.score)[0];
    const chosen = failure || checks.find(c => c.status === 'unobservable') || checks[0];
    return {...chosen, evidenceTimes: [...new Set(checks.filter(c => c.status === chosen.status).map(c => c.time))].slice(0, 12), assessedRepetitions: checks.filter(c => c.status !== 'unobservable').length, totalRepetitions: reps.length};
  });
}

/**
 * @param {Array<{time:number,landmarks:Array,worldLandmarks?:Array}>} frames Seconds, monotonic samples (missing poses may have an empty array).
 * @param {{width:number,height:number,duration?:number,sourceFps?:number|null,exerciseHint?:(string|{exerciseId?:string,family?:string})}} options Original display dimensions after rotation; sourceFps is original video FPS when known, not sampling FPS.
 * @returns {object} score:null is intentional whenever the clip cannot be evaluated.
 */
export function analyzeMotion(frames, {width, height, duration, sourceFps, exerciseHint} = {}) {
  const result = {
    version: MOTION_RULE_VERSION, exerciseId: null, exerciseFamily: null, familyName: null, exerciseFamilyName: null, exerciseConfidence: 0,
    candidates: [], requiresVisualConfirmation: false, classificationSource: 'pose', status: 'insufficient',
    score: null, observedScore: null, scoreStatus: 'unavailable', scoreCoverage: 0, checks: [], visualReviewRequests: [],
    quality: {usableRatio: 0, view: 'uncertain', reasons: [], validFrames: 0, totalFrames: 0, sourceFps: Number.isFinite(sourceFps) ? sourceFps : null},
    reps: [], attemptCount: 0, qualifiedRepCount: 0, incompleteAttemptCount: 0, observedActiveRange: null, issues: [], summary: '',
  };
  const reject = (code, message, status = 'insufficient') => {
    result.status = status; result.summary = message; result.quality.reasons.push(code);
    result.issues.push(issue(0, code, message)); return result;
  };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return reject('INVALID_DIMENSIONS', '缺少有效的视频尺寸，无法计算动作角度。');
  if (!Array.isArray(frames)) return reject('NO_POSE', '没有可供分析的人体关键点。');
  const ordered = [...new Map(frames.filter(f => f && Number.isFinite(f.time) && f.time >= 0).map(f => [f.time, f])).values()].sort((a, b) => a.time - b.time);
  result.quality.totalFrames = ordered.length;
  if (ordered.length < 8) return reject('TOO_FEW_FRAMES', '有效采样太少，请上传包含完整动作的视频。');
  if (ordered.some(f => Number.isFinite(f.personCount) && f.personCount > 1 && !f.subjectTracking)) return reject('MULTIPLE_PEOPLE', '视频中检测到多个人，无法确定要评估的对象，请上传单人运动视频。', 'unsupported');
  const trackIds = new Set(ordered.filter(f => f.subjectTracking?.status === 'locked' && f.subjectTracking.confidence >= 0.65).map(f => f.subjectTracking.trackId).filter(Boolean));
  if (trackIds.size > 1) return reject('TARGET_ID_CHANGED', '片段中目标身份发生变化，不能把不同人的动作合并评分。', 'unsupported');
  const intervals = ordered.slice(1).map((f, i) => f.time - ordered[i].time);
  const medianInterval = quantile(intervals, 0.5);
  const maxGap = Math.min(0.35, Math.max(0.18, medianInterval * 2.1));
  const sideFeatures = [0, 1].map(candidate => ordered.map(f => {
    const tracking = f.subjectTracking;
    const locked = !tracking || (tracking.status === 'locked' && tracking.confidence >= 0.65 && typeof tracking.trackId === 'string' && tracking.trackId.length > 0);
    return locked ? frameFeatures(f, candidate, width, height) : null;
  }));
  let side = mean(ordered.map(f => mean(SIDES[0].map(i => confidence(f.landmarks?.[i]))))) >= mean(ordered.map(f => mean(SIDES[1].map(i => confidence(f.landmarks?.[i]))))) ? 0 : 1;
  const sideCoverage = sideFeatures.map(features => features.filter(Boolean).length / ordered.length);
  // Confidence averaged over visible limbs must not favour a side whose torso
  // cannot be observed. Both sides still obey the original coverage threshold.
  if (sideCoverage[side] < 0.7 && sideCoverage[1 - side] >= 0.7) side = 1 - side;
  if (resolveMotionHint(exerciseHint)?.family === 'row') {
    // A single-arm row's support arm can be clearer yet stationary. Select one
    // sufficiently observed moving arm for the whole clip, never per frame.
    const activeSides = [0, 1].filter(candidate => {
      const observed = sideFeatures[candidate].filter(f => f && Number.isFinite(f.elbowAngle));
      return observed.length / ordered.length >= 0.7 && fieldRange(observed, 'elbowAngle') >= 18;
    });
    if (activeSides.length === 1) side = activeSides[0];
  }
  const timeline = ordered.map((f, i) => ({time: f.time, feature: sideFeatures[side][i]}));
  const allFeatures = timeline.map(f => f.feature).filter(Boolean);
  const hasTracking = ordered.some(f => f.subjectTracking);
  const targetCoverage = hasTracking ? ratio(ordered, f => f.subjectTracking?.status === 'locked' && f.subjectTracking.confidence >= 0.65 && typeof f.subjectTracking.trackId === 'string' && f.subjectTracking.trackId.length > 0) : null;
  if (hasTracking) result.quality.targetCoverage = round(targetCoverage, 3);
  const identified = recognizeMotion(allFeatures, exerciseHint);
  Object.assign(result, {exerciseId: identified.exerciseId, exerciseFamily: identified.family, familyName: motionFamilies[identified.family] || null, exerciseConfidence: identified.confidence, candidates: identified.candidates, requiresVisualConfirmation: identified.requiresVisualConfirmation, classificationSource: identified.hintUsed ? 'visual-hint+pose' : 'pose'});
  result.exerciseFamilyName = result.familyName;
  const activeRange = ['squat', 'pushup'].includes(identified.family) ? activeRangeFor(allFeatures, identified.family) : null;
  result.observedActiveRange = activeRange ? {start: round(activeRange.start), end: round(activeRange.end)} : null;
  const activeTimeline = activeRange ? timeline.filter(f => f.time >= activeRange.start && f.time <= activeRange.end) : timeline;
  const features = activeTimeline.map(f => f.feature).filter(Boolean);
  const span = activeRange ? activeRange.end - activeRange.start : Number.isFinite(duration) && duration > 0 ? Math.max(duration, ordered.at(-1).time) - ordered[0].time : ordered.at(-1).time - ordered[0].time;
  const coveredTime = features.slice(1).reduce((sum, f, i) => sum + (f.time - features[i].time <= maxGap ? f.time - features[i].time : 0), 0);
  Object.assign(result.quality, {validFrames: features.length, assessedFrames: activeTimeline.length, usableRatio: round(Math.min(features.length / Math.max(activeTimeline.length, 1), coveredTime / Math.max(span, medianInterval)))});
  if (Number.isFinite(sourceFps) && sourceFps < 5) return reject('LOW_SOURCE_FRAME_RATE', '原视频帧率低于每秒5帧，动作过程信息不足，无法可靠评分。');
  if (medianInterval > 0.21) return reject('LOW_SAMPLE_RATE', '视频采样频率不足，无法可靠检查完整动作，请重新分析。');
  if (hasTracking && targetCoverage < 0.7) return reject('LOW_TARGET_COVERAGE', '目标人物在超过三成片段中未被可靠跟踪，不能只截取局部跟到的片段作为整段评价。');
  if (features.length < 8 || result.quality.usableRatio < 0.7) return reject('LOW_POSE_COVERAGE', '身体关键点被遮挡或缺失较多，请保持训练者身体入镜后重试。');
  if (identified.conflict) return reject('EXERCISE_HINT_CONFLICT', '画面确认的动作与连续骨架运动模式冲突，暂不按该动作评分。', 'unsupported');
  if (!identified.family) {
    const staticPose = fieldRange(features, 'kneeAngle') < 15 && fieldRange(features, 'elbowAngle') < 15 && fieldRange(features, 'hipAngle') < 15 && fieldRange(features, 'armElevation') < 15;
    return reject(staticPose ? 'NO_MOVEMENT' : 'UNSUPPORTED_MOVEMENT', staticPose ? '未观察到足够的动作变化或可确认的支撑姿态。' : '尚不能可靠确定动作模式，需要关键帧补充识别。', staticPose ? 'insufficient' : 'unsupported');
  }
  if (identified.family === 'ambiguous') return reject('AMBIGUOUS_MOVEMENT', '存在多个合理动作候选，需要看到器械与支撑关系后再选择专属规则。', 'unsupported');
  const exercise = getMotionExercise(identified.exerciseId) || familyMotionTemplate(identified.family);
  if (!exercise) return reject('UNSUPPORTED_MOVEMENT', '当前动作没有对应的评估规则。', 'unsupported');
  result.quality.view = ratio(features, f => Number.isFinite(f.viewRatio) && f.viewRatio <= 0.38) >= 0.7 ? 'side' : 'front-or-oblique';
  // Missing required samples split a repetition even when timestamps are close.
  // Optional joints remain available for checks that can still be observed.
  const primary = signalSpec(exercise.family, exercise.id)?.[0] || 'bodyAngle';
  const runs = []; let current = null;
  for (const item of activeTimeline) {
    const f = item.feature;
    if (!f || !Number.isFinite(f[primary])) { current = null; continue; }
    if (!current || f.time - current.at(-1).time > maxGap) { current = []; runs.push(current); }
    current.push(f);
  }
  const segments = runs.flatMap(run => splitAndSmooth(run, maxGap));
  const detected = detectPatternReps(segments, exercise.family, exercise.id);
  result.incompleteAttemptCount = detected.incompleteAttempts;
  if (!detected.reps.length) return reject('INCOMPLETE_REPETITION', '已识别到动作趋势，但没有观察到完整的发力与还原过程，请补拍完整动作。');
  result.reps = detected.reps.map((rep, i) => strictRep(rep, exercise, i + 1, identified.requiresVisualConfirmation));
  result.attemptCount = result.reps.length;
  if (exercise.family === 'plank') {
    result.holdDuration = round(result.reps.reduce((total, rep) => total + rep.metrics.duration, 0));
    for (const rep of result.reps) rep.metrics.holdDuration = rep.metrics.duration;
  }
  result.qualifiedRepCount = result.reps.filter(rep => rep.qualified).length;
  result.checks = aggregateChecks(result.reps, exercise.checks);
  const aggregate = strictScore(result.reps.flatMap(rep => rep.checks), identified.requiresVisualConfirmation);
  Object.assign(result, aggregate);
  result.visualReviewRequests = result.checks.filter(c => c.status === 'unobservable').map(c => ({code: c.code, reason: c.message, evidenceTimes: c.evidenceTimes, critical: c.critical}));
  result.issues = result.reps.flatMap(rep => rep.issues);
  if (activeRange && (activeRange.start - ordered[0].time > 0.5 || ordered.at(-1).time - activeRange.end > 0.5)) result.issues.push(issue(activeRange.start, 'ACTIVE_RANGE', `分析区间为${round(activeRange.start)}至${round(activeRange.end)}秒，区间外片段未计分。`, 'info'));
  if (detected.partial) result.issues.push(issue(ordered.at(-1).time, 'PARTIAL_REPETITION_EXCLUDED', '视频中的不完整动作未计数、未评分。', 'info'));
  if (segments.length > 1) result.issues.push(issue(segments[1][0].time, 'POSE_GAP', '关键点缺失处已分段，只评估连续可见的完整动作。', 'info'));
  const observable = result.reps.some(rep => rep.checks.some(c => c.code !== 'MOTION_CONTROL' && c.status !== 'unobservable'));
  if (!observable) {
    result.score = null; result.scoreStatus = 'unavailable';
    for (const rep of result.reps) { rep.score = null; rep.scoreStatus = 'unavailable'; }
    return reject('INSUFFICIENT_CHECK_COVERAGE', '已识别动作与完整尝试，但专属姿态检查项不可观察；请补拍对应机位。');
  }
  result.status = 'complete';
  const partialText = result.incompleteAttemptCount ? `另有${result.incompleteAttemptCount}次缺少完整起止，未计分。` : '';
  const pending = result.scoreStatus === 'provisional' ? `可观察项${result.observedScore}分；必要检查或动作变式仍待核验，暂定参考分${result.score}分。未知项不代表动作错误，暂不计入已确认合格次数。` : `参考分${result.score}分，${result.qualifiedRepCount}次通过全部检查。`;
  result.summary = `识别到${result.attemptCount}${exercise.family === 'plank' ? '段连续' : '次起止完整的'}${result.familyName}。${pending}${partialText}`;
  return result;
}

export default analyzeMotion;
