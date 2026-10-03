import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMotionEvidenceFrames, summarizeMotionAnalysis, buildMotionEvidence, evidenceCropRegion } from '../public/motion-evidence.js';

const frames = Array.from({ length: 151 }, (_, index) => ({ time: index / 15, sourceTime: index / 15, landmarks: [] }));

test('evidence covers video time and observed angle extrema without judging posture',()=>{
 const observations={measurements:[{time:1,left:{elbowAngle:60}},{time:2.023,left:{elbowAngle:10}},{time:8,left:{elbowAngle:170}}]};
 const chosen=selectMotionEvidenceFrames(frames,observations);
 assert.equal(chosen.length,6);assert.equal(chosen[0].time,0);assert.equal(chosen.at(-1).time,10);assert(chosen.some(item=>item.time===5));
 const low=chosen.find(item=>item.time===2),high=chosen.find(item=>item.time===8);
 assert.equal(low.requestedTime,2.023);assert.equal(low.poseTime,2);assert.equal(low.sourceTime,2);
 assert(low.reasons.includes('left.elbowAngle 最小观测'));assert(high.reasons.includes('left.elbowAngle 最大观测'));
});

test('evidence normalizes unsorted duplicate timestamps and bounds image count', () => {
  const chosen = selectMotionEvidenceFrames([frames[80], frames[0], frames[80], frames[150]], {}, { maxImages: 100 });
  assert.equal(chosen.length, 3);
  assert.deepEqual(chosen.map(frame => frame.time), [0, 80 / 15, 10]);
  assert.equal(selectMotionEvidenceFrames(frames, {}, { maxImages: 2 }).length, 2);
  assert.throws(() => selectMotionEvidenceFrames([]), /分析帧/);
});

test('old scores and rule failures cannot bias picture selection',()=>{
 const baseline=selectMotionEvidenceFrames(frames,{});
 const polluted=selectMotionEvidenceFrames(frames,{score:1,reps:[{start:2,end:4,bottom:3,score:0}],checks:[{status:'fail',critical:true,evidenceTimes:[2]}],issues:[{time:7,code:'OLD_RULE',severity:'severe'}],visualReviewRequests:[{evidenceTimes:[8]}]});
 assert.deepEqual(polluted,baseline);
});

test('tracked evidence excludes lost people, keeps one identity and refuses legacy multiple people', () => {
  const tracking = { status: 'locked', trackId: 'motion-target-1', confidence: 0.9, bbox: { xMin: 0.2, yMin: 0.1, xMax: 0.5, yMax: 0.9 } };
  const tracked = frames.map(frame => ({ ...frame, personCount: 2, subjectTracking: { ...tracking, status: frame.time > 3 && frame.time < 7 ? 'lost' : 'locked' } }));
  const chosen = selectMotionEvidenceFrames(tracked, { checks: [{ code: 'NECK', status: 'fail', evidenceTimes: [5] }] });
  assert(chosen.every(item => item.poseTime <= 3 || item.poseTime >= 7));
  assert(chosen.every(item => item.subjectTracking.trackId === 'motion-target-1'));
  assert(!chosen.some(item => item.reasons.includes('问题：NECK')));
  assert.throws(() => selectMotionEvidenceFrames([{ time: 0, personCount: 2 }]), /多个人/);
  assert.throws(() => selectMotionEvidenceFrames([{ time: 0, subjectTracking: tracking }, { time: 1, subjectTracking: { ...tracking, trackId: 'someone-else' } }]), /身份发生变化/);
});

test('target crop includes context and maps normalized original-image coordinates', () => {
  const box = { xMin: 0.3, yMin: 0.1, xMax: 0.6, yMax: 0.9 }, crop = evidenceCropRegion(box);
  assert(crop.xMin < box.xMin && crop.xMax > box.xMax);
  assert(crop.yMin < box.yMin && crop.yMax > box.yMax);
  assert(crop.xMin >= 0 && crop.yMin >= 0 && crop.xMax <= 1 && crop.yMax <= 1);
  assert.deepEqual(evidenceCropRegion(null), { xMin: 0, yMin: 0, xMax: 1, yMax: 1 });
});

test('extracted evidence retains two complete scenes for equipment and keeps the tracked target', async () => {
  const previousDocument = globalThis.document, draws = [];
  class Video extends EventTarget {
    duration = 10; videoWidth = 1000; videoHeight = 1000; readyState = 4; time = 0;
    get currentTime() { return this.time; }
    set currentTime(value) { this.time = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
    pause() {}
    removeAttribute() { this.src = ''; }
  }
  const box = { xMin: .45, yMin: .32, xMax: .65, yMax: .7 };
  const tracked = frames.map(frame => ({ ...frame, subjectTracking: { status: 'locked', trackId: 'target', confidence: .95, bbox: box } }));
  globalThis.document = { createElement(tag) {
    if (tag === 'video') return new Video();
    const context = { drawImage(...args) { draws.push(args.slice(1, 5)); }, strokeRect() {}, fillRect() {}, fillText() {} };
    return { width: 0, height: 0, getContext: () => context, toBlob: callback => callback(new Blob(['image'], { type: 'image/jpeg' })) };
  } };
  try {
    const result = await buildMotionEvidence(new File(['video'], 'row.mp4', { type: 'video/mp4' }), { duration: 10, width: 1000, height: 1000, frames: tracked }, {});
    const scenes = result.images.filter(image => image.crop.xMin === 0 && image.crop.yMin === 0 && image.crop.xMax === 1 && image.crop.yMax === 1);
    assert.equal(scenes.length, 2, 'two different instants must retain apparatus outside the body box');
    assert(scenes[0].time < scenes[1].time);
    assert(result.images.length <= 6);
    assert(result.images.every(image => image.subjectTracking.trackId === 'target'));
    assert(result.images.some(image => image.crop.xMin > 0), 'other frames retain detail crops');
    assert.equal(draws.filter(([x, y, width, height]) => x === 0 && y === 0 && width === 1000 && height === 1000).length, 2);
    assert.equal(result.summary.evidenceFrames.filter(frame => frame.framing === 'equipment-context').length, 2);
  } finally { globalThis.document = previousDocument; }
});

test('summary contains only observation metadata without duplicated measurements or old judgements',()=>{
 const report={version:'motion-observations-v1',quality:{totalFrames:150,validFrames:100,usableRatio:2/3,sourceFps:null,targetCoverage:null,reasons:[],frames:[1,2],score:100},measurements:Array.from({length:150},(_,frameIndex)=>({frameIndex,time:frameIndex/15})),score:100,reps:[{score:99}],checks:[{status:'fail'}],issues:[{message:'old rule'}],exerciseId:'squat',file:'private-name',dataUrl:'data:image/jpeg;base64,ignored'};
 const result=summarizeMotionAnalysis(report,{duration:10,sampleFps:15,sourceFps:null});
 assert.equal(result.quality.validFrames,100);assert.equal(result.sourceFps,null);
 assert.deepEqual(Object.keys(result.quality).sort(),['reasons','sourceFps','targetCoverage','totalFrames','usableRatio','validFrames'].sort());
 for(const key of ['score','reps','checks','issues','exerciseId','measurements'])assert.equal(result[key],undefined,key);
 assert(!/landmarks|private-name|data:image|old rule/.test(JSON.stringify(result)));
});

test('pre-aborted evidence extraction never accesses video resources', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(buildMotionEvidence(null, null, null, { signal: controller.signal }), error => error.name === 'AbortError');
});
