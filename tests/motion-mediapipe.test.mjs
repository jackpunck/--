import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaPipeLandmarks} from '../public/motion-mediapipe.js';
import {getMotionPoseModel} from '../public/motion-models.js';
import {buildMotionPoseData,validateMotionPoseData,MOTION_BODY_LANDMARK_INDICES} from '../public/motion-pose-data.js';
import {buildMotionOverlay} from '../public/motion-overlay.js';
import {analyzeVideo} from '../public/motion-video.js';

test('standard landmarks keep planar observations, omit depth and render 17 body nodes',()=>{
  const input=Array.from({length:33},(_,i)=>({x:.2+i*.01,y:.3+i*.01,z:.2,visibility:.9,presence:.99}));
  const [landmarks]=mediaPipeLandmarks({landmarks:[input]});
  assert.deepEqual(landmarks[0],{x:.2,y:.3,visibility:.9});
  assert.equal(buildMotionOverlay(landmarks,640,480).points.length,17);
  assert.deepEqual(mediaPipeLandmarks({landmarks:[]}),[]);
  const pipeline={modelVersion:getMotionPoseModel('mediapipe-full').version,duration:1,width:640,height:480,sampleFps:2,frames:[{time:0,landmarks},{time:.5,landmarks:[]}]};
  const body=buildMotionPoseData(pipeline,{bodyOnly:true});
  assert.equal(body.format,'mediapipe-body17-full');
  assert.equal(body.schemaVersion,4);
  assert.match(body.coordinates.confidence,/MediaPipe/);
  assert(!body.coordinates.image.includes('RTMW'));
  assert(!Object.hasOwn(body.frames[0],'wholebodyLandmarks'));
  for(let index=0;index<33;index++)assert.deepEqual(body.frames[0].landmarks[index],MOTION_BODY_LANDMARK_INDICES.includes(index)?[landmarks[index].x,landmarks[index].y,.9]:null);
  assert.deepEqual(body.frames[1].landmarks,[]);
  assert.deepEqual(buildMotionPoseData(pipeline),body);
  const invalid=structuredClone(body);invalid.frames[0].landmarks[1]=[.2,.3,.9];
  assert.throws(()=>validateMotionPoseData(invalid),/17 个身体节点/);
  assert.equal(input[0].z,.2);
});

test('unknown model is rejected before opening browser resources',async()=>{
  assert.equal(getMotionPoseModel().id,'mediapipe-full');
  await assert.rejects(analyzeVideo({name:'clip.mp4',size:20},{model:'full'}),/骨架分析模型/);
});
