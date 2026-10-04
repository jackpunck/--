import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMotionPoseData,validateMotionPoseData,buildFullMotionAnalysis,MOTION_POSE_DATA_LIMITS} from '../public/motion-pose-data.js';
import {analyzeMotion} from '../public/motion-analysis.js';
import {validateMotionCoachRequest,MOTION_COACH_REQUEST_BYTES} from '../server/motion-coach.mjs';
import {planMotionCoachBatches,decodeMotionCoachBlock} from '../server/motion-coach-batches.mjs';
import {makeRtmwPipeline} from './helpers/motion-rtmw-pipeline.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';

test('body-only requests retain every measured frame and 17 useful joints without face and fingers',()=>{
  const pipeline=makeRtmwPipeline(150),full=buildMotionPoseData(pipeline),body=buildMotionPoseData(pipeline,{bodyOnly:true});
  assert.equal(body.schemaVersion,3);assert.equal(body.format,'rtmw-body17-full');
  assert.equal(body.retainedLandmarkIndices.length,17);assert.equal(body.frames.length,150);
  for(let i=0;i<body.frames.length;i++){
    assert.equal(body.frames[i].time,full.frames[i].time);
    assert(!Object.hasOwn(body.frames[i],'wholebodyLandmarks'));
    for(let joint=0;joint<33;joint++)assert.deepEqual(body.frames[i].landmarks[joint],body.retainedLandmarkIndices.includes(joint)?full.frames[i].landmarks[joint]:null);
  }
  assert(Buffer.byteLength(JSON.stringify(body))<Buffer.byteLength(JSON.stringify(full))*.25);
  const input={...request(150),poseData:body,reviewMode:'efficient'};
  assert.equal(validateMotionCoachRequest(input).poseData.format,'rtmw-body17-full');
  const invalid=structuredClone(body);invalid.frames[0].landmarks[2]=[.5,.5,.9];
  assert.throws(()=>validateMotionPoseData(invalid),/17 个身体节点/);
  invalid.frames[0].landmarks[2]=null;invalid.frames[0].wholebodyLandmarks=[];
  assert.throws(()=>validateMotionPoseData(invalid),/不支持的字段/);
});
function request(count = 15) {
  const pipeline = makeRtmwPipeline(count);
  return {duration:pipeline.duration,poseData:buildMotionPoseData(pipeline),
    fullAnalysis:buildFullMotionAnalysis(analyzeMotion(pipeline.frames,pipeline),pipeline),
    keyframes:[{time:0,mimeType:'image/png',data:png},{time:(count-1)/15,mimeType:'image/png',data:png}]};
}
function restore(packets) {
  const output = {};
  for (const packet of packets) for (const block of packet.blocks) {
    const {path,value} = decodeMotionCoachBlock(block);
    let target = output;
    for (let index = 0; index < path.length - 1; index++) {
      target[path[index]] ??= typeof path[index+1] === 'number' ? [] : {};
      target = target[path[index]];
    }
    assert(!Object.hasOwn(target,path.at(-1)), 'A datum is sent only once');
    target[path.at(-1)] = value;
  }
  return output;
}

test('RTMW transport keeps all raw scores and mapped anatomy without fabricated depth',()=>{
  const pipeline=makeRtmwPipeline(15),data=buildMotionPoseData(pipeline);
  assert.equal(data.schemaVersion,2);assert.equal(data.format,'rtmw-wholebody-133-full');
  assert.equal(data.wholebodyLandmarkNames.length,133);
  assert.deepEqual(data.pointFields,['x','y','visibility']);
  assert.equal(data.frames.length,15);
  assert.equal(data.frames[0].landmarks[1],null);
  assert.deepEqual(data.frames[0].landmarks[0],Object.values(pipeline.frames[0].landmarks[0]));
  assert.deepEqual(data.frames[0].wholebodyLandmarks[132],Object.values(pipeline.frames[0].wholebodyLandmarks[132]));
  assert(data.frames[0].wholebodyLandmarks.some(point=>point[2]>1),'Raw scores are not clamped');
  assert(!Object.hasOwn(data.frames[0],'worldLandmarks'));
  assert.match(data.coordinates.confidence,/not a calibrated visibility probability/);
  assert.strictEqual(validateMotionPoseData(data),data);
  data.frames[0].wholebodyLandmarks[132][0]=0;assert.notEqual(pipeline.frames[0].wholebodyLandmarks[132].x,0);
});

test('RTMW transport rejects incomplete raw data, unsupported old schemas and classifier metadata',()=>{
  const data=buildMotionPoseData(makeRtmwPipeline(15));
  for(const mutate of [
    value=>value.frames[0].wholebodyLandmarks.pop(),
    value=>delete value.frames[0].wholebodyLandmarks,
    value=>value.frames[0].wholebodyLandmarks[0].push(1),
    value=>value.frames[0].wholebodyLandmarks[0][2]=NaN,
    value=>delete value.frames[0].wholebodyLandmarks[0][2],
    value=>value.frames[0].landmarks[0]=[.1,.2,.3,.9,null],
    value=>value.frames[0].worldLandmarks=[],
    value=>value.wholebodyLandmarkNames.reverse(),
    value=>value.schemaVersion=1,
    value=>value.format='mediapipe-pose-33-full',
    value=>value.actionRecognition={status:'ok'},
  ]) {const invalid=structuredClone(data);mutate(invalid);assert.throws(()=>validateMotionPoseData(invalid));}
  const missing=makeRtmwPipeline(15);delete missing.frames[0].wholebodyLandmarks;
  assert.throws(()=>buildMotionPoseData(missing),/完整 133 点/);
  const injected=makeRtmwPipeline(15);injected.frames[0].landmarks[0].z=.1;
  assert.throws(()=>buildMotionPoseData(injected),/不支持的字段/);
});

test('AI request and bounded lossless packets preserve every raw joint and measured frame',()=>{
  const input=validateMotionCoachRequest(request(168));
  const packets=planMotionCoachBatches(input,{compactPose:true});
  const restored=restore(JSON.parse(JSON.stringify(packets)));
  assert.deepEqual(restored,{poseData:input.poseData,fullAnalysis:input.fullAnalysis});
  assert.equal(restored.poseData.frames.at(-1).wholebodyLandmarks.length,133);
  assert(input.fullAnalysis.measurements.some(row=>Object.values(row.left).some(Number.isFinite)));
  assert.equal(input.keyframes.length,2);
  assert(packets.every(packet=>JSON.stringify(packet).length<=64000));
  assert(!Object.hasOwn(restored.poseData,'actionRecognition'));
});

test('maximum duration RTMW request fits the explicit 32 MiB pose and 40 MiB HTTP budgets',()=>{
  const body=request(1800);
  assert.equal(MOTION_POSE_DATA_LIMITS.maxBytes,32*1024*1024);
  assert.equal(MOTION_COACH_REQUEST_BYTES,40*1024*1024);
  assert(Buffer.byteLength(JSON.stringify(body.poseData))<MOTION_POSE_DATA_LIMITS.maxBytes);
  assert(Buffer.byteLength(JSON.stringify(body))<MOTION_COACH_REQUEST_BYTES);
  assert.equal(validateMotionCoachRequest(body).poseData.frameCount,1800);
  assert.equal(body.poseData.frames.at(-1).wholebodyLandmarks.length,133);
});
