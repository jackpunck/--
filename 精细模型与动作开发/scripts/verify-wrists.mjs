import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAnatomyAtlas} from '../atlas-model.js';
import {animatedExercises} from '../exercise-catalog.js';

const point=(rig,p,name)=>p.clone().sub(rig.rest[name]).applyQuaternion(rig.map[name].quaternion).add(rig.map[name].position);

test('forearm roll meets the hand without an axial wrist twist in all actions',()=>{
  const {rig}=createAnatomyAtlas({rigged:true});
  for(const id of animatedExercises)for(let frame=0;frame<=100;frame++){
    rig.pose(frame/100,id);
    for(const side of ['l','r']){
      const rest=rig.joints[side],posed=rig.poseJoints[side],original=rest.wrist.clone().sub(rest.elbow).normalize(),axis=posed.wrist.clone().sub(posed.elbow).normalize();
      const roll=rig.map['forearmRoll.'+side],middle=rig.map['forearmMid.'+side],hand=rig.map['hand.'+side];
      const wristX=new THREE.Vector3(1,0,0).applyQuaternion(hand.quaternion);wristX.addScaledVector(axis,-wristX.dot(axis)).normalize();
      const forearmX=new THREE.Vector3(1,0,0);forearmX.addScaledVector(original,-forearmX.dot(original)).normalize().applyQuaternion(roll.quaternion);
      assert(forearmX.distanceTo(wristX)<1e-7,`${id}/${side}: wrist concentrates axial rotation`);
      for(const bone of [roll,middle])assert(original.clone().applyQuaternion(bone.quaternion).distanceTo(axis)<1e-7,`${id}: roll bends forearm`);
      assert(roll.position.distanceTo(posed.wrist)<1e-8);
      assert(middle.position.distanceTo(posed.elbow.clone().lerp(posed.wrist,.5))<1e-8);
    }
  }
});

test('rigid forearm bones stay attached to the wrist and close to their elbow landmarks',()=>{
  const {rig}=createAnatomyAtlas({rigged:true});let maximumGap=0;
  for(const id of animatedExercises){
    const previous={};
    for(let frame=0;frame<=100;frame++){
      rig.pose(frame/100,id);
      for(const side of ['l','r']){
        for(const landmark of rig.forearmAttachments[side]){
          const distal=point(rig,landmark.distal,landmark.name),expected=point(rig,landmark.distal,'forearmRoll.'+side);
          assert(distal.distanceTo(expected)<1e-8,`${id}: ${landmark.name} detaches at wrist`);
          const proximal=point(rig,landmark.proximal,landmark.name),target=point(rig,landmark.proximal,'forearm.'+side);
          maximumGap=Math.max(maximumGap,proximal.distanceTo(target));
          assert(proximal.distanceTo(target)<.005,`${id}: elbow attachment drift`);
          assert(Math.abs(distal.distanceTo(proximal)-landmark.distal.distanceTo(landmark.proximal))<1e-8,'long bones must not stretch');
        }
        for(const prefix of ['forearmMid','forearmRoll','ulna','radius']){
          const name=prefix+'.'+side,rotation=rig.map[name].quaternion;
          if(previous[name])assert(rotation.angleTo(previous[name])<.08,`${id}: ${name} jumps`);
          previous[name]=rotation.clone();
        }
      }
    }
  }
  assert(maximumGap>0,'the rigid endpoint fit has an explicit, bounded residual');
});

test('wrist bands retain their source shape and every anatomical bone has one rigid control',()=>{
  const atlas=createAnatomyAtlas({rigged:true});let bands=0,bones=0;
  for(const mesh of atlas.pickableMeshes)for(const structure of mesh.userData.structures){
    const wristBand=structure.structure.includes('retinaculum of wrist');
    if(!wristBand&&structure.kind!=='bone')continue;
    const controls=new Set(),g=mesh.geometry;
    for(let i=structure.firstFace*3;i<(structure.firstFace+structure.faceCount)*3;i++){
      const vertex=g.index.getX(i);
      for(let k=0;k<4;k++){
        const weight=g.attributes.skinWeight.array[vertex*4+k];if(!weight)continue;
        assert.equal(weight,1,structure.structure+' must remain rigid');
        controls.add(atlas.rig.bones[g.attributes.skinIndex.array[vertex*4+k]].name);
      }
    }
    assert.equal(controls.size,1,structure.structure+' is split across controllers');
    if(wristBand){assert.deepEqual([...controls],['hand.'+structure.structure.at(-1)]);bands++;}else bones++;
  }
  assert.equal(bands,4);assert(bones>150);
});
