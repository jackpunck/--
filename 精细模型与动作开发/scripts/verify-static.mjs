import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAnatomyAtlas} from '../atlas-model.js';
import {extendedMotionIds} from '../motion-poses.js';
import {supportedExercises,animatedExercises} from '../exercise-catalog.js';
const atlas=createAnatomyAtlas({rigged:true}),v=new THREE.Vector3();
assert.equal(extendedMotionIds.length,22);
assert.deepEqual([...animatedExercises].sort(),[...supportedExercises].sort());
const signature=()=>atlas.rig.bones.flatMap(b=>[...b.position.toArray(),...b.quaternion.toArray()]);
let poses=0,maxLimbError=0,minGround=Infinity;
const resources=[];atlas.body.traverse(o=>{if(o.isMesh||o.isLine)resources.push([o,o.geometry,o.material]);});
for(const id of extendedMotionIds){
  let initial,far,previous;
  for(let frame=0;frame<=100;frame++){
    const q=frame/100;assert.equal(atlas.rig.staticPose(id,q),true);poses++;
    const current=signature();if(frame===0)initial=current;if(frame===100)far=current;
    for(const b of atlas.rig.bones)assert(b.matrixWorld.elements.every(Number.isFinite),`${id}: finite transform`);
    for(const side of ['l','r']){
      const rest=atlas.rig.joints[side],j=atlas.rig.poseJoints[side];
      for(const [a,b] of [['hip','knee'],['knee','ankle'],['shoulder','elbow'],['elbow','wrist']]){
        const error=Math.abs(rest[a].distanceTo(rest[b])-j[a].distanceTo(j[b]));maxLimbError=Math.max(maxLimbError,error);assert(error<.002,`${id}: ${a}/${b} length ${error}`);
      }
      if(previous)for(const key of Object.keys(j))assert(j[key].distanceTo(previous[side][key])<.09,`${id}: joint jump ${key}`);
    }
    previous=Object.fromEntries(['l','r'].map(side=>[side,Object.fromEntries(Object.entries(atlas.rig.poseJoints[side]).map(([k,p])=>[k,p.clone()]))]));
    if(['goblet-squat','overhead-triceps'].includes(id))for(const sign of [-1,1]){
      const hand=atlas.rig.map['hand.'+(sign===1?'l':'r')],palm=new THREE.Vector3(-sign*.015,-.165,.17).applyQuaternion(hand.quaternion).add(hand.position);
      assert(palm.distanceTo(new THREE.Vector3(.155,0,0).applyQuaternion(atlas.rig.weights[0].quaternion).add(atlas.rig.weights[0].position).add(new THREE.Vector3(sign*.11,0,0)))<1e-7,`${id}: shared grip`);
    }
    if(id==='dumbbell-row')assert(atlas.rig.equipmentAnchors.palms.l.distanceTo(new THREE.Vector3(.70,1.40,.35))<1e-7);
    if(id==='pullup')for(const [side,sign] of [['l',1],['r',-1]])assert(atlas.rig.equipmentAnchors.palms[side].distanceTo(new THREE.Vector3(sign*.62,3.72,.10))<1e-7);
    if(id==='lat-pulldown')assert(Math.abs(atlas.rig.equipmentAnchors.palms.l.distanceTo(atlas.rig.equipmentAnchors.palms.r)-1.2)<1e-7);
    if(id==='lunge')assert(atlas.rig.poseJoints.l.ankle.distanceTo(new THREE.Vector3(.168,.155,0))<1e-7);
    if(['row','chest-press','lat-pulldown','leg-curl','leg-extension'].includes(id)){
      const pad=atlas.rig.staticProps.getObjectByName('support-pad'),hip=atlas.rig.map.pelvis.position;
      assert(Math.abs(hip.z-pad.position.z)<.45,`${id}: pelvis stays above seat`);
      assert(hip.y-pad.position.y>.1&&hip.y-pad.position.y<.3,`${id}: seat supports pelvis`);
    }
    if([0,50,100].includes(frame))for(const mesh of atlas.pickableMeshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      mesh.getVertexPosition(i,v);assert(v.toArray().every(Number.isFinite));assert(v.length()<5,`${id}: runaway deformation`);minGround=Math.min(minGround,v.y);assert(v.y>-.015,`${id}: below floor ${v.y}`);
    }
  }
  const difference=Math.max(...initial.map((v,i)=>Math.abs(v-far[i])));
  assert(id==='plank'?difference<1e-9:difference>.05,`${id}: motion range`);
  atlas.rig.staticPose(id,0);assert.deepEqual(signature(),initial,`${id}: deterministic cycle restart`);
}
for(const [object,geometry,material] of resources){assert.equal(object.geometry,geometry);assert.equal(object.material,material);}
assert.equal(atlas.rig.staticPose('unknown-exercise'),false);
for(const bone of atlas.rig.bones)assert(bone.position.distanceTo(atlas.rig.rest[bone.name])<1e-8);
assert(atlas.rig.weights.every(w=>!w.visible));assert.equal(atlas.rig.staticProps.visible,false);
for(const origin of [[.1,2.4,6],[.1,2,6],[.1,2.4,-6]]){
  const point=new THREE.Vector3(...origin),ray=new THREE.Raycaster(point,new THREE.Vector3(0,0,-Math.sign(point.z)));
  const skinned=atlas.raycastStructure(ray,false);assert(skinned);assert.deepEqual(atlas.raycastStructure(ray,true),skinned);
}
console.log(JSON.stringify({extendedMotions:22,animations:25,poses,maxLimbError,minGround}));
