import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSubjectTracker, validateTargetPoint, summarizeTargetTracking, mapCropLandmarks, mergePoseCandidates, targetDetectionCrop, knownPersonRegions} from '../public/motion-tracking.js';
import {analyzeVideo} from '../public/motion-video.js';

function person(x=.5,y=.5,scale=1) {
  const points=Array.from({length:33},()=>({x,y:y-.25*scale,z:0,visibility:.95,presence:.95}));
  const set=(i,dx,dy)=>Object.assign(points[i],{x:x+dx*scale,y:y+dy*scale});
  set(11,-.065,-.1);set(12,.065,-.1);set(23,-.05,.1);set(24,.05,.1);
  set(13,-.1,.025);set(14,.1,.025);set(15,-.11,.16);set(16,.11,.16);
  set(25,-.05,.25);set(26,.05,.25);set(27,-.05,.4);set(28,.05,.4);
  for(let i=29;i<=32;i++)set(i,i%2?-.06:.06,.41);
  return points;
}
test('point validation rejects malformed coordinates before opening resources',async()=>{
  assert.equal(validateTargetPoint(null),null);
  assert.deepEqual(validateTargetPoint({x:0,y:1}),{x:0,y:1});
  for(const targetPoint of [{x:NaN,y:0},{x:.5,y:Infinity},{x:-.01,y:.5},{x:1.01,y:.5},{x:'0.5',y:.5},{}]) {
    assert.throws(()=>validateTargetPoint(targetPoint),/位置/);
    await assert.rejects(analyzeVideo({name:'clip.mp4',size:20},{targetPoint}),/位置/);
  }
});
test('initial selection uses center or explicit point, never candidate ordering',()=>{
  for(const poses of [[person(.18),person(.52)],[person(.52),person(.18)]]) {
    const selected=createSubjectTracker().update(poses,0);
    assert.equal(poses[selected.index][11].x,.52-.065);
    assert.equal(selected.subjectTracking.status,'locked');
    const clicked=createSubjectTracker({targetPoint:{x:.18,y:.4}}).update(poses,0);
    assert.equal(poses[clicked.index][11].x,.18-.065);
  }
  assert.equal(createSubjectTracker().update([person(.09)],0).subjectTracking.status,'locked');
  assert.equal(createSubjectTracker().update([person(.46),person(.54)],0).subjectTracking.status,'ambiguous');
  assert.equal(createSubjectTracker({targetPoint:{x:.95,y:.9}}).update([person(.2)],0).index,null);
});
test('locked identity moves off center while another person becomes central',()=>{
  const tracker=createSubjectTracker();
  tracker.update([person(.5),person(.1)],0);
  for(let i=1;i<=20;i++) {
    const target=person(.5+i*.014),other=person(.1+i*.012);
    const candidates=i%2?[other,target]:[target,other];
    const result=tracker.update(candidates,i/15);
    assert.equal(result.subjectTracking.status,'locked',`frame ${i}`);
    assert.equal(candidates[result.index],target);
    assert.equal(result.subjectTracking.trackId,'motion-target-1');
    assert(result.subjectTracking.confidence>=.65);
  }
});
test('manual target only ranks people whose visible box contains the point',()=>{
  const contained=person(.6,.6),nearAnchor=person(.43,.45,.3);
  const result=createSubjectTracker({targetPoint:{x:.58,y:.4}}).update([nearAnchor,contained],0);
  assert.equal(result.index,1);
  assert.equal(createSubjectTracker({targetPoint:{x:.52,y:.5}}).update([person(.5),person(.54)],0).subjectTracking.status,'ambiguous');
});
test('blank lead-in can initialize once a reliable first target appears',()=>{
  const tracker=createSubjectTracker();
  assert.equal(tracker.update([],0).index,null);
  assert.equal(tracker.update([],1).index,null);
  assert.equal(tracker.update([person(.5)],1.1).subjectTracking.status,'locked');
});
test('crossing ambiguity does not silently resume on the other person',()=>{
  const tracker=createSubjectTracker();
  tracker.update([person(.5),person(.8)],0);
  const crossing=tracker.update([person(.53),person(.57)],1/15);
  assert.equal(crossing.subjectTracking.status,'ambiguous');
  assert.equal(crossing.index,null);assert.equal(crossing.subjectTracking.bbox,undefined);
  const after=tracker.update([person(.46),person(.64)],2/15);
  assert.equal(after.subjectTracking.status,'ambiguous');assert.equal(after.index,null);
});
test('short missing target can return, long loss cannot switch to bystander',()=>{
  const short=createSubjectTracker();short.update([person(.5)],0);
  assert.equal(short.update([],1/15).subjectTracking.status,'lost');
  assert.equal(short.update([person(.51)],2/15).subjectTracking.status,'locked');
  const long=createSubjectTracker();long.update([person(.5)],0);
  assert.equal(long.update([person(.9)],.1).subjectTracking.status,'lost');
  assert.equal(long.update([],1).subjectTracking.status,'lost');
  assert.equal(long.update([person(.5)],1.1).index,null);
});
test('scale discontinuity and weak partial bodies cannot take over the track',()=>{
  const tracker=createSubjectTracker();tracker.update([person(.5)],0);
  assert.equal(tracker.update([person(.5,.5,.35)],1/15).index,null);
  const hidden=person(.5);for(let i=11;i<33;i++)hidden[i].visibility=.1;
  assert.equal(tracker.update([hidden],2/15).index,null);
});
test('bbox is bounded and summary covers all input frames',()=>{
  const tracker=createSubjectTracker();const first=tracker.update([person(.08,.5)],0);
  for(const value of Object.values(first.subjectTracking.bbox))assert(value>=0&&value<=1);
  const frames=[{personCount:3,...first},{personCount:2,...tracker.update([],1/15)},{personCount:4,...tracker.update([],1)}];
  const summary=summarizeTargetTracking(frames,{targetPoint:{x:.1,y:.4}});
  assert.equal(summary.lockedFrames,1);assert.equal(summary.lostFrames,2);assert.equal(summary.coverage,1/3);assert.equal(summary.maxPeople,4);assert.equal(summary.mode,'point');
  const horizontal=person(.5);horizontal[0].x=.2;
  assert.equal(createSubjectTracker().update([horizontal],0).subjectTracking.bbox.xMin,.2,'target crop includes a horizontal body’s head');
});
test('crop coordinate mapping and cross-pass dedup preserve actual close people',()=>{
  const first=person(.5),second=person(.53);
  const crop={xMin:.3,yMin:0,xMax:.9,yMax:1};
  const cropPoints=first.map(p=>({...p,x:(p.x-.3)/.6,z:p.z/.6}));
  const mapped=mapCropLandmarks(cropPoints,crop);
  assert(Math.abs(mapped[11].x-first[11].x)<1e-10);
  const one=mergePoseCandidates([{landmarks:[first]},{landmarks:[mapped]}]);
  assert.equal(one.landmarks.length,1);
  const tracker=createSubjectTracker();tracker.update(one.landmarks,0);
  assert.equal(tracker.update(one.landmarks,1/15).subjectTracking.status,'locked');
  const two=mergePoseCandidates([{landmarks:[first,second]},{landmarks:[mapped,second]}]);
  assert.equal(two.landmarks.length,2);
  assert.equal(tracker.update(two.landmarks,2/15).subjectTracking.status,'ambiguous');
  for(const n of Object.values(targetDetectionCrop({point:{x:.99,y:.02}})))assert(n>=0&&n<=1);
});
test('real partial full-frame and crop observations of the same body do not become two people',()=>{
  const {poses}=JSON.parse(readFileSync(new URL('./fixtures/motion-tracking-partial-poses.json',import.meta.url)));
  const merged=mergePoseCandidates(poses.map(pose=>({landmarks:[pose]})));
  assert.equal(merged.landmarks.length,1);
  assert.equal(merged.landmarks[0],poses[1],'prefer the crop with more visible limbs');
  // A single detector returning two people must never be erased by cross-pass dedup.
  assert.equal(mergePoseCandidates([{landmarks:poses}]).landmarks.length,2);
});
test('a discovery tile cannot turn its guessed off-screen legs into a second person',()=>{
  const {groups}=JSON.parse(readFileSync(new URL('./fixtures/motion-tracking-cropped-poses.json',import.meta.url)));
  assert.equal(mergePoseCandidates(groups).landmarks.length,1);
  const out=mapCropLandmarks([{x:1.2,y:.5,visibility:.99,presence:.99}],{xMin:0,yMin:0,xMax:.6,yMax:1})[0];
  assert.equal(out.x,.72);assert.equal(out.visibility,0);assert.equal(out.presence,0);
});
test('a nearby standing background pose cannot compete with a continuous horizontal target',()=>{
  const horizontal=person(.5).map(p=>({...p,x:.5+(p.y-.5),y:.5-(p.x-.5)}));
  const tracker=createSubjectTracker();tracker.update([horizontal],0);
  const selected=tracker.update([person(.51,.44),horizontal],1/15);
  assert.equal(selected.index,1);assert.equal(selected.subjectTracking.status,'locked');
});
test('a high-confidence partial tile cannot replace a complete body whose legs are outside the tile',()=>{
  const full=person(.5),partial=person(.5);full[27].x=.8;
  for(const i of [13,14,15,16])full[i].visibility=.4;
  const merged=mergePoseCandidates([{landmarks:[full]},{landmarks:[partial],crop:{xMin:0,yMin:0,xMax:.6,yMax:1}}]);
  assert.equal(merged.landmarks.length,1);assert.equal(merged.landmarks[0],full);
});
test('discovery masks cover reliable full-frame bodies but do not promote sparse detections',()=>{
  const full=person(.5),sparse=person(.2);for(let i=13;i<23;i++)sparse[i].visibility=.1;for(let i=25;i<33;i++)sparse[i].visibility=.1;
  const regions=knownPersonRegions([full,sparse]);assert.equal(regions.length,1);
  for(const point of full)assert(point.x>=regions[0].xMin&&point.x<=regions[0].xMax&&point.y>=regions[0].yMin&&point.y<=regions[0].yMax);
});
