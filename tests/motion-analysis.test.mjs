import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeMotion, MOTION_RULE_VERSION} from '../public/motion-analysis.js';

// Synthetic kinematic cases test rule invariants, NOT real-world accuracy.
// Physical points are uniformly fitted before normalization so aspect-ratio
// tests catch angles incorrectly calculated in normalized x/y coordinates.
function recording(kind = 'squat', options = {}) {
  const {fps = 15, period = 3.4, repetitions = 2, width = 1280, height = 720,
    mirror = false, depth = 45, pushDepth = 60, sag = 0, lean = 0, front = false, jitter = false} = options;
  const duration = period * repetitions;
  const frames = [];
  for (let n = 0; n <= duration * fps; n++) {
    const time = n / fps;
    const phase = Math.max(0, Math.min(1, ((time % period) - 0.3 * period / 3.4) / (period * 2.8 / 3.4)));
    const progress = (1 - Math.cos(phase * Math.PI * 2)) / 2;
    let shoulder, elbow, wrist, hip, knee, ankle;
    if (kind === 'pushup' || kind === 'plank') {
      const motion = kind === 'plank' ? 0 : progress;
      shoulder = {x: 240, y: 350 + pushDepth * motion};
      wrist = {x: 240, y: 550};
      const d = wrist.y - shoulder.y;
      elbow = {x: 240 + Math.sqrt(Math.max(0, 10000 - (d / 2) ** 2)), y: (wrist.y + shoulder.y) / 2};
      ankle = {x: 760, y: 550};
      hip = {x: 470, y: shoulder.y + (550 - shoulder.y) * 230 / 520 + sag * motion};
      knee = {x: 615, y: (hip.y + ankle.y) / 2};
    } else {
      const motion = kind === 'squat' ? progress : 0;
      const radians = ((jitter ? 2 * Math.sin(time * 14) : depth * motion)) * Math.PI / 180;
      ankle = {x: 360, y: 670};
      knee = {x: 360 + 180 * Math.sin(radians), y: 670 - 180 * Math.cos(radians)};
      hip = {x: 360, y: 670 - 360 * Math.cos(radians)};
      shoulder = {x: hip.x + lean * motion, y: hip.y - 190 + lean * motion * 0.3};
      elbow = {x: shoulder.x + 30, y: shoulder.y + 85};
      wrist = {x: shoulder.x + 15 + (kind === 'curl' ? 85 * progress : 0), y: shoulder.y + 165 - (kind === 'curl' ? 120 * progress : 0)};
    }
    const landmarks = Array.from({length: 33}, () => ({x: 0.5, y: 0.5, z: 0, visibility: 0.99, presence: 0.99}));
    const scale = Math.min(width / 1000, height / 800) * 0.9;
    const fit = p => ({x: ((mirror ? 1000 - p.x : p.x) * scale + (width - 1000 * scale) / 2) / width,
      y: (p.y * scale + (height - 800 * scale) / 2) / height, z: 0, visibility: 0.99, presence: 0.99});
    [shoulder, elbow, wrist, hip, knee, ankle].forEach((p, i) => {
      const index = [11, 13, 15, 23, 25, 27][i];
      const separation = front && (i === 0 || i === 3) ? 150 : 6;
      landmarks[index] = fit({...p, x: p.x - separation / 2});
      landmarks[index + 1] = fit({...p, x: p.x + separation / 2});
    });
    frames.push({time, landmarks});
  }
  return {frames, options: {width, height, duration}};
}

function run(kind, options) {
  const clip = recording(kind, options);
  return analyzeMotion(clip.frames, clip.options);
}

test('automatically recognizes full squats and push-ups and returns timed, transparent per-rep scores', () => {
  for (const exercise of ['squat', 'pushup']) {
    const result = run(exercise);
    assert.equal(result.version, MOTION_RULE_VERSION);
    assert.equal(result.exerciseId, exercise, JSON.stringify(result));
    assert.equal(result.status, 'complete', JSON.stringify(result));
    assert.equal(result.reps.length, 2);
    assert.ok(result.score >= 90);
    assert.equal(result.quality.view, 'side');
    for (const rep of result.reps) {
      assert.ok(rep.start < rep.bottom && rep.bottom < rep.end);
      assert.ok(rep.metrics.descentDuration > 0 && rep.metrics.ascentDuration > 0);
      assert.ok(Math.abs(Object.values(rep.metrics.components).reduce((s, c) => s + c.weight, 0) - 1) < 1e-9);
    }
  }
});

test('left/right mirroring and portrait/landscape dimensions preserve physical angles and scores', () => {
  for (const exercise of ['squat', 'pushup']) {
    const normal = run(exercise, {width: 1600, height: 900});
    for (const config of [{mirror: true}, {width: 900, height: 1600}, {width: 960, height: 960, mirror: true}]) {
      const result = run(exercise, config);
      assert.equal(result.status, 'complete');
      assert.equal(result.exerciseId, normal.exerciseId);
      assert.equal(result.reps.length, normal.reps.length);
      assert.ok(Math.abs(result.score - normal.score) <= 1);
      assert.ok(Math.abs(result.reps[0].metrics.bottomAngle - normal.reps[0].metrics.bottomAngle) < 0.1);
    }
  }
});

test('different sampling rates and real movement speeds preserve count and phase timing', () => {
  for (const exercise of ['squat', 'pushup']) {
    for (const period of [2.4, 3.4, 6.8]) {
      const low = run(exercise, {period, fps: 10});
      const high = run(exercise, {period, fps: 30});
      assert.equal(low.reps.length, 2, JSON.stringify(low));
      assert.equal(high.reps.length, 2);
      assert.ok(Math.abs(low.reps[0].bottom - period / 2) <= 0.2);
      assert.ok(Math.abs(low.reps[0].metrics.duration - high.reps[0].metrics.duration) < 0.3);
    }
  }
});

test('brief repositioning between repetitions does not turn supported movements into unknown exercises', () => {
  for (const exercise of ['squat', 'pushup']) {
    const clip = recording(exercise);
    const frames = clip.frames.map(f => ({...f, landmarks: f.landmarks.map(p => ({...p, x: p.x + (f.time >= 3.4 ? 0.16 : 0)}))}));
    const result = analyzeMotion(frames, clip.options);
    assert.equal(result.exerciseId, exercise, JSON.stringify(result));
    assert.equal(result.attemptCount, 2);
  }
});

test('long kneeling preparation does not outvote later push-ups or manufacture reps for a following plank', () => {
  const preparation = recording('plank', {repetitions: 3});
  const preparationFrames = preparation.frames.map(f => ({...f, landmarks: f.landmarks.map((p, i) => ({...p, y: p.y + ([25, 26].includes(i) ? 0.17 : 0), x: p.x - ([27, 28].includes(i) ? 0.12 : 0)}))}));
  for (const exercise of ['pushup', 'plank']) {
    const clip = recording(exercise);
    const shift = preparation.options.duration + 1 / 15;
    const frames = [...preparationFrames, ...clip.frames.map(f => ({...f, time: f.time + shift}))];
    const result = analyzeMotion(frames, {...clip.options, duration: frames.at(-1).time});
    if (exercise === 'pushup') {
      assert.equal(result.exerciseId, 'pushup', JSON.stringify(result));
      assert.equal(result.attemptCount, 2);
      assert.equal(result.incompleteAttemptCount, 0);
      assert.ok(result.observedActiveRange.start >= shift - 0.1);
      assert.ok(result.reps[0].start >= shift);
    } else {
      assert.equal(result.score, null);
      assert.equal(result.reps.length, 0);
    }
  }
});

test('stationary standing, plank, and small local jitter never generate repetitions', () => {
  for (const [kind, options] of [['standing', {}], ['plank', {}], ['squat', {jitter: true}]]) {
    const result = run(kind, options);
    assert.equal(result.score, null);
    assert.equal(result.reps.length, 0);
    assert.notEqual(result.status, 'complete');
  }
});

test('unknown arm curls are rejected rather than forced into a supported class', () => {
  const result = run('curl');
  assert.equal(result.status, 'unsupported');
  assert.equal(result.exerciseId, null);
  assert.equal(result.score, null);
});

test('clips missing their beginning or return to the top are unscored', () => {
  for (const exercise of ['squat', 'pushup']) {
    const clip = recording(exercise, {repetitions: 1});
    for (const frames of [clip.frames.filter(f => f.time <= 1.8), clip.frames.filter(f => f.time >= 1.5).map(f => ({...f, time: f.time - 1.5}))]) {
      const result = analyzeMotion(frames, {...clip.options, duration: frames.at(-1).time});
      assert.equal(result.reps.length, 0);
      assert.equal(result.score, null);
      assert.notEqual(result.status, 'complete');
    }
  }
});

test('shallow but complete attempts are recognized, counted, and scored as insufficient depth', () => {
  for (const [exercise, options] of [['squat', {depth: 15}], ['pushup', {pushDepth: 10}]]) {
    const result = run(exercise, options);
    assert.equal(result.exerciseId, exercise, JSON.stringify(result));
    assert.equal(result.status, 'complete');
    assert.equal(result.attemptCount, 2);
    assert.equal(result.qualifiedRepCount, 0);
    assert.ok(result.score < 70);
    assert.ok(result.issues.some(i => i.code === 'LIMITED_DEPTH'));
  }
});

test('the first observed top frame is sufficient evidence without requiring a starting pause', () => {
  const clip = recording('squat', {repetitions: 1});
  const frames = clip.frames.filter(f => f.time >= 0.53).map(f => ({...f, time: f.time - 8 / 15}));
  const result = analyzeMotion(frames, {...clip.options, duration: frames.at(-1).time});
  assert.equal(result.attemptCount, 1, JSON.stringify(result));
});

test('missing bottom frames and long landmark gaps cannot be bridged into a repetition', () => {
  for (const exercise of ['squat', 'pushup']) {
    const clip = recording(exercise, {repetitions: 1});
    for (const omit of [false, true]) {
      const frames = clip.frames.flatMap(f => f.time > 1.35 && f.time < 2.05 ? (omit ? [] : [{...f, landmarks: []}]) : [f]);
      const result = analyzeMotion(frames, clip.options);
      assert.equal(result.reps.length, 0);
      assert.equal(result.score, null);
    }
  }
});

test('complete repetitions survive a gap between repetitions without merging across it', () => {
  const clip = recording('squat', {repetitions: 3});
  const frames = clip.frames.map(f => f.time > 3.1 && f.time < 3.7 ? {...f, landmarks: []} : f);
  const result = analyzeMotion(frames, clip.options);
  assert.equal(result.status, 'complete');
  assert.ok(result.reps.length >= 1 && result.reps.length <= 3);
  assert.ok(result.reps.every(rep => !(rep.start < 3.1 && rep.end > 3.7)));
  assert.ok(result.issues.some(i => i.code === 'POSE_GAP'));
});

test('front views, extensive occlusion, absent confidence and insufficient sampling are rejected', () => {
  const front = run('squat', {front: true});
  assert.equal(front.score, null);
  assert.ok(front.quality.reasons.includes('SIDE_VIEW_REQUIRED'));
  const clip = recording('squat');
  for (const frames of [
    clip.frames.map((f, i) => i % 3 ? {...f, landmarks: []} : f),
    clip.frames.map(f => ({...f, landmarks: f.landmarks.map(({visibility, presence, ...p}) => p)})),
  ]) assert.equal(analyzeMotion(frames, clip.options).score, null);
  assert.equal(run('squat', {fps: 3}).score, null);
});

test('recognition remains available when view, coverage, or sampling prevents scoring', () => {
  const front = run('squat', {front: true});
  assert.equal(front.exerciseId, 'squat');
  assert.equal(front.score, null);
  assert.equal(run('squat', {fps: 3}).exerciseId, 'squat');
  const clip = recording('squat');
  const result = analyzeMotion(clip.frames.map((f, i) => i % 3 ? {...f, landmarks: []} : f), clip.options);
  assert.equal(result.exerciseId, 'squat');
  assert.equal(result.score, null);
});

test('resampling cannot disguise a low original video frame rate', () => {
  const clip = recording('squat', {fps: 15});
  const lowSource = analyzeMotion(clip.frames, {...clip.options, sourceFps: 3});
  assert.equal(lowSource.exerciseId, 'squat');
  assert.equal(lowSource.score, null);
  assert.equal(lowSource.status, 'insufficient');
  assert.ok(lowSource.quality.reasons.includes('LOW_SOURCE_FRAME_RATE'));
  assert.equal(analyzeMotion(clip.frames, {...clip.options, sourceFps: null}).status, 'complete');
});

test('observable shallow depth, trunk lean and hip sag reduce relevant scores with timestamped evidence', () => {
  const squat = run('squat');
  const shallow = run('squat', {depth: 33});
  assert.equal(shallow.status, 'complete', JSON.stringify(shallow));
  assert.ok(shallow.score < squat.score);
  assert.ok(shallow.issues.some(i => i.code === 'LIMITED_DEPTH'));
  const leaning = run('squat', {lean: 210});
  assert.equal(leaning.status, 'complete', JSON.stringify(leaning));
  assert.ok(leaning.score < squat.score);
  assert.ok(leaning.issues.some(i => i.code === 'TORSO_LEAN'));
  const sagging = run('pushup', {sag: 75});
  assert.equal(sagging.status, 'complete', JSON.stringify(sagging));
  assert.ok(sagging.score < run('pushup').score);
  assert.ok(sagging.issues.some(i => i.code === 'BODY_ALIGNMENT' && i.time > 0));
});

test('world landmarks do not override view/quality gates; inputs are not mutated', () => {
  const clip = recording('squat', {front: true});
  const frames = clip.frames.map(f => ({...f, worldLandmarks: f.landmarks.map((p, i) => ({...p, z: i / 33}))}));
  const before = JSON.stringify(frames);
  assert.equal(analyzeMotion(frames, clip.options).score, null);
  assert.equal(JSON.stringify(frames), before);
  assert.equal(analyzeMotion([], clip.options).score, null);
  assert.equal(analyzeMotion(clip.frames, {width: NaN, height: 720}).score, null);
});

test('duplicate timestamps and invalid coordinates cannot manufacture valid repetitions', () => {
  const clip = recording('squat');
  const frames = Array.from({length: 100}, () => clip.frames[0]);
  assert.equal(analyzeMotion(frames, clip.options).score, null);
  const invalid = clip.frames.map(f => ({...f, landmarks: f.landmarks.map(p => ({...p, x: NaN}))}));
  assert.equal(analyzeMotion(invalid, clip.options).score, null);
});

test('multiple people are rejected and absent presence can fall back to visibility', () => {
  const clip = recording('squat');
  const multiple = clip.frames.map(f => ({...f, personCount: 2}));
  assert.equal(analyzeMotion(multiple, clip.options).issues[0].code, 'MULTIPLE_PEOPLE');
  const noPresence = clip.frames.map(f => ({...f, landmarks: f.landmarks.map(p => ({...p, presence: null}))}));
  assert.equal(analyzeMotion(noPresence, clip.options).status, 'complete');
});

test('real extracted poses preserve squat and perspective push-up recognition without facial data', () => {
  for (const exercise of ['squat', 'pushup']) {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/motion-${exercise}-real.json`, import.meta.url)));
    const frames = fixture.frames.map(([time, points]) => {
      const landmarks = Array(33).fill(null);
      fixture.landmarkIndices.forEach((index, i) => {
        const [x, y, visibility] = points[i];
        landmarks[index] = {x, y, visibility};
      });
      return {time, landmarks};
    });
    const result = analyzeMotion(frames, fixture.options);
    assert.equal(result.status, 'complete', JSON.stringify(result));
    assert.equal(result.exerciseId, fixture.expectedExercise);
    assert.ok(result.reps.every(rep => rep.start < rep.bottom && rep.bottom < rep.end));
    if (exercise === 'squat') assert.equal(result.reps.length, 5); // independently reviewed count
    else assert.ok(result.reps.length >= 1); // no unverified on-screen counter as a golden label
  }
});
