import assert from 'node:assert/strict';
import test from 'node:test';
import {buildMotionOverlay,drawMotionOverlay,MOTION_FITNESS_BODY_INDICES} from '../public/motion-overlay.js';
import {RTMW_TO_BODY_LANDMARKS} from '../public/motion-rtmw.js';

const wholebody=()=>Array.from({length:133},(_,index)=>({x:.1+(index%15)*.05,y:.1+Math.floor(index/15)*.08,score:4}));

test('overlay uses every raw body, face and hand index without the mapped 33 slots',()=>{
  const points=wholebody(),geometry=buildMotionOverlay(points,960,1280,{detail:'wholebody'});
  assert.deepEqual(geometry.points.map(point=>point.index),Array.from({length:133},(_,index)=>index));
  assert.deepEqual(Object.fromEntries(['body','face','leftHand','rightHand'].map(group=>[group,geometry.points.filter(point=>point.group===group).length])),{body:23,face:68,leftHand:21,rightHand:21});
  assert(geometry.points.find(point=>point.group==='face').radius<geometry.points.find(point=>point.group==='leftHand').radius);
  assert(geometry.points.find(point=>point.group==='leftHand').radius<geometry.points.find(point=>point.group==='body').radius);
  for(const point of geometry.points){assert.equal(point.x,points[point.index].x*960);assert.equal(point.y,points[point.index].y*1280);}
  for(const root of [91,112]){
    const hand=geometry.lines.filter(line=>line.a.index>=root&&line.b.index<=root+20);
    assert.equal(hand.length,20);
    for(const finger of [1,5,9,13,17])assert(hand.some(line=>line.a.index===root&&line.b.index===root+finger));
  }
  assert(!geometry.lines.some(line=>line.a.group==='face'||line.b.group==='face'));
});

test('default fitness-body17 matches coaching joints and removes face, eyes, ears and fingers',()=>{
  const points=wholebody(),before=structuredClone(points),geometry=buildMotionOverlay(points,960,1280);
  const coachIndices=[0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32];
  assert.deepEqual(MOTION_FITNESS_BODY_INDICES,coachIndices.map(index=>RTMW_TO_BODY_LANDMARKS[index]));
  assert.deepEqual(geometry.points.map(point=>point.index),[...MOTION_FITNESS_BODY_INDICES]);
  assert.equal(geometry.points.length,17);
  assert(geometry.points.every(point=>point.group==='body'));
  for(const point of geometry.points){assert.equal(point.x,points[point.index].x*960);assert.equal(point.y,points[point.index].y*1280);}
  assert(geometry.lines.every(line=>MOTION_FITNESS_BODY_INDICES.includes(line.a.index)&&MOTION_FITNESS_BODY_INDICES.includes(line.b.index)));
  for(const [a,b]of [[5,7],[7,9],[11,13],[13,15],[15,17],[15,19],[17,19],[20,22]])assert(geometry.lines.some(line=>line.a.index===a&&line.b.index===b));
  assert.deepEqual(points,before,'simplifying the display must not change stored raw predictions');
});

test('overlay excludes missing, nonfinite, outside-image and nonpositive responses, accepting scores above one',()=>{
  const points=wholebody();points[0]=null;points[1].x=NaN;points[2].y=1.01;points[3].x=-.01;points[4].score=0;points[5].score=-2;points[6].score=Infinity;points[7].score=.001;
  const geometry=buildMotionOverlay(points,640,480,{detail:'wholebody'});
  assert.equal(geometry.points.length,126);assert(geometry.points.some(point=>point.index===7));assert(geometry.points.some(point=>point.index===8));
  assert(geometry.lines.every(line=>line.a.index>=7&&line.b.index>=7));
  assert.deepEqual(buildMotionOverlay(wholebody().slice(0,33),640,480),{points:[],lines:[]});
});

test('canvas receives every valid 133-point position and restores rendering state',()=>{
  const arcs=[],calls=[];
  const context={save(){calls.push('save');},restore(){calls.push('restore');},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(...args){arcs.push(args);}};
  drawMotionOverlay(context,wholebody(),640,480,{detail:'wholebody'});
  assert.equal(arcs.length,133);assert.deepEqual(calls,['save','restore']);
});

test('default canvas renders only the seventeen valid fitness joints',()=>{
  const arcs=[],context={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(...args){arcs.push(args);}};
  drawMotionOverlay(context,wholebody(),640,480);
  assert.equal(arcs.length,17);
  const points=wholebody();points[0]=null;points[5].score=0;points[9].x=NaN;
  const geometry=buildMotionOverlay(points,640,480);
  assert.equal(geometry.points.length,14);
  assert(geometry.lines.every(line=>![0,5,9].includes(line.a.index)&&![0,5,9].includes(line.b.index)));
});
