import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAnatomyAtlas} from '../atlas-model.js';
import {animatedExercises} from '../exercise-catalog.js';
import {armRotations} from '../arm-frames.js';

test('bent arms share an elbow hinge instead of independently rolling the two limb segments',()=>{
  const atlas=createAnatomyAtlas({rigged:true});let checked=0;
  for(const id of animatedExercises)for(let frame=0;frame<=100;frame++){
    atlas.rig.pose(frame/100,id);
    for(const side of ['l','r']){
      const rest=atlas.rig.joints[side],pose=atlas.rig.poseJoints[side];
      const ru=rest.elbow.clone().sub(rest.shoulder).normalize(),rf=rest.wrist.clone().sub(rest.elbow).normalize();
      const u=pose.elbow.clone().sub(pose.shoulder).normalize(),f=pose.wrist.clone().sub(pose.elbow).normalize();
      const upper=atlas.rig.map['upper.'+side].quaternion,forearm=atlas.rig.map['forearm.'+side].quaternion;
      assert(ru.clone().applyQuaternion(upper).distanceTo(u)<1e-7,`${id}: upper-arm axis moved`);
      assert(rf.clone().applyQuaternion(forearm).distanceTo(f)<1e-7,`${id}: forearm axis moved`);
      if(u.clone().cross(f).length()<.25)continue;
      const normal=ru.clone().cross(rf).normalize();
      assert(normal.clone().applyQuaternion(upper).distanceTo(normal.clone().applyQuaternion(forearm))<1e-7,`${id}/${side}/${frame}: elbow has an axial twist`);
      const actual=upper.angleTo(forearm),bend=Math.abs(u.angleTo(f)-ru.angleTo(rf));
      assert(Math.abs(actual-bend)<1e-6,`${id}/${side}/${frame}: rotation exceeds elbow flexion`);checked++;
    }
  }
  assert(checked>2500);
});

test('all actions keep arm rotations and sampled muscle vertices continuous, including straight-arm transitions',()=>{
  const atlas=createAnatomyAtlas({rigged:true}),samples=[],v=new THREE.Vector3();
  for(const mesh of atlas.pickableMeshes){
    if(mesh.userData.kind!=='muscle')continue;
    const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i+=31)if(p.getY(i)>1.5&&p.getY(i)<2.7&&Math.abs(p.getX(i))>.225)samples.push({mesh,i,previous:new THREE.Vector3()});
  }
  assert(samples.length>500);
  for(const id of animatedExercises){
    const previous={};let saved;
    for(let frame=0;frame<=100;frame++){
      atlas.rig.pose(frame/100,id);
      for(const name of ['upper.l','upper.r','forearm.l','forearm.r']){
        const rotation=atlas.rig.map[name].quaternion;
        if(previous[name])assert(rotation.angleTo(previous[name])<.08,`${id}/${frame}/${name}: rotation flips`);
        previous[name]=rotation.clone();
      }
      for(const sample of samples){
        sample.mesh.getVertexPosition(sample.i,v);
        if(frame)assert(v.distanceTo(sample.previous)<.05,`${id}/${frame}: muscle surface jumps`);
        sample.previous.copy(v);
      }
      if(frame===37)saved=Object.fromEntries(Object.keys(previous).map(name=>[name,previous[name].clone()]));
    }
    atlas.rig.pose(.12,'curl');atlas.rig.pose(.37,id);
    for(const [name,rotation] of Object.entries(saved))assert(rotation.angleTo(atlas.rig.map[name].quaternion)<1e-7,`${id}: scrub depends on playback history`);
  }
});

test('an almost straight elbow does not choose a different roll from tiny bend-plane noise',()=>{
  const atlas=createAnatomyAtlas({rigged:true}),rest=atlas.rig.joints.l;
  const direction=new THREE.Vector3(.08,-1,.01).normalize(),shoulder=rest.shoulder.clone(),elbow=shoulder.clone().addScaledVector(direction,.54);
  let previous;
  for(const z of [-1e-7,-1e-9,0,1e-9,1e-7]){
    const wrist=elbow.clone().addScaledVector(direction,.44);wrist.z+=z;
    const result=armRotations(rest,{shoulder,elbow,wrist},new THREE.Quaternion());
    if(previous)for(const name of ['upper','forearm'])assert(result[name].angleTo(previous[name])<1e-5);
    previous=result;
  }
});
