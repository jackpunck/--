import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAnatomyAtlas} from '../atlas-model.js';
import {staticPoseProfiles} from '../static-poses.js';
import {supportedExercises,animatedExercises} from '../exercise-catalog.js';
const atlas=createAnatomyAtlas({rigged:true}),v=new THREE.Vector3(),signatures=new Set();
assert.deepEqual(Object.keys(staticPoseProfiles).sort(),supportedExercises.filter(id=>!animatedExercises.includes(id)).sort());
for(const id of Object.keys(staticPoseProfiles)){
  assert.equal(atlas.rig.staticPose(id),true);
  for(const bone of atlas.rig.bones)assert(bone.matrixWorld.elements.every(Number.isFinite),`${id}: finite bone transform`);
  const signature=JSON.stringify(atlas.rig.bones.map(bone=>[...bone.position.toArray(),...bone.quaternion.toArray()].map(x=>Math.round(x*1000))));
  assert(!signatures.has(signature),`${id}: must have its own pose`);signatures.add(signature);
  for(const mesh of atlas.pickableMeshes)for(let i=0;i<mesh.geometry.attributes.position.count;i+=97){mesh.getVertexPosition(i,v);assert(v.toArray().every(Number.isFinite));assert(v.length()<5,`${id}: runaway deformation`);assert(v.y>-.04,`${id}: geometry below ground: ${v.y}`);}
  for(const side of ['l','r'])for(const key of ['hip','knee','ankle','shoulder','elbow','wrist'])assert(atlas.rig.poseJoints[side][key].toArray().every(Number.isFinite));
  if(['goblet-squat','overhead-triceps'].includes(id))for(const sign of [-1,1]){
    const side=sign===1?'l':'r',hand=atlas.rig.map['hand.'+side];
    const palm=new THREE.Vector3(-sign*.015,-.165,.12).applyQuaternion(hand.quaternion).add(hand.position);
    const target=atlas.rig.weights[0].position.clone().add(new THREE.Vector3(sign*.11,.12,0));
    assert(palm.distanceTo(target)<1e-7,`${id}: both palms hold the same dumbbell`);
  }
  if(id==='dumbbell-row'){
    const hand=atlas.rig.map['hand.l'],palm=new THREE.Vector3(-.015,-.165,.12).applyQuaternion(hand.quaternion).add(hand.position);
    assert(palm.distanceTo(new THREE.Vector3(.5,1.40,.3))<1e-7,'support palm rests above bench surface');
  }
}
assert.equal(atlas.rig.staticPose('unknown-exercise'),false);
for(const bone of atlas.rig.bones)assert(bone.position.distanceTo(atlas.rig.rest[bone.name])<1e-8,'unknown pose resets to anatomical rest, never squat');
assert(atlas.rig.weights.every(weight=>!weight.visible));assert.equal(atlas.rig.staticProps.visible,false);
for(const origin of [[.1,2.4,6],[.1,2,6],[.1,2.4,-6]]){
  const point=new THREE.Vector3(...origin),raycaster=new THREE.Raycaster(point,new THREE.Vector3(0,0,-Math.sign(point.z)));
  const skinned=atlas.raycastStructure(raycaster,false),rest=atlas.raycastStructure(raycaster,true);
  assert(skinned,'ray intersects actual anatomy');assert.deepEqual(rest,skinned,'faster rest picking resolves the same real surface as skinning');
}
console.log(JSON.stringify({staticPoses:signatures.size,animations:3,unknownPose:'anatomical rest'}));
