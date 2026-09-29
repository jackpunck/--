import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createAnatomyAtlas} from '../atlas-model.js';
import {gymEquipmentNames} from '../gym-equipment.js';
import {exerciseDetails} from '../exercise-catalog.js';

test('gym machines switch without leaving equipment in unrelated exercises or allocating frame geometry',()=>{
  const {rig}=createAnatomyAtlas({rigged:true}),assets=[];
  rig.staticProps.traverse(o=>{if(o.isMesh)assets.push([o,o.geometry,o.material]);});
  for(const id of Object.keys(gymEquipmentNames)){
    assert.equal(exerciseDetails[id].equipment,gymEquipmentNames[id]);
    for(let i=0;i<=40;i++){
      rig.pose(i/40,id);
      assert(rig.staticProps.visible);
      assert.deepEqual(Object.entries(rig.gymEquipment.variants).filter(([,v])=>v.group.visible).map(([key])=>key),[id]);
      rig.staticProps.traverseVisible(o=>{assert(o.matrixWorld.elements.every(Number.isFinite));});
      const moving=rig.gymEquipment.variants[id].dynamic;
      if(moving.cable){
        const [a,b]=moving.cable.userData.ends.map(p=>new T.Vector3(...p));
        assert(a.distanceTo(moving.outlet)<1e-8,'Cable stays attached to its pulley');
        assert(a.distanceTo(b)>.1,'Working cable stays taut');
        if(id==='lat-pulldown')assert(b.distanceTo(rig.equipmentAnchors.barCenter)<1e-8,'Lat cable remains attached to the bar');
      }
      if(moving.links&&id==='row')for(const [n,side] of ['r','l'].entries()){
        assert(new T.Vector3(...moving.links[n].userData.ends[1]).distanceTo(rig.equipmentAnchors.palms[side])<1e-8,'Row attachment stays in both hands');
      }
      if(moving.arms)for(const [n,side] of ['r','l'].entries()){
        const armEnd=new T.Vector3(...moving.arms[n].userData.ends[1]),stem=moving.links[n].userData.ends;
        assert(armEnd.distanceTo(new T.Vector3(...stem[0]))<1e-8,'Press arm connects to handle stem');
        assert(new T.Vector3(...stem[1]).distanceTo(rig.equipmentAnchors.palms[side])<1e-8,'Press handle remains in hand');
      }
    }
    rig.pose(.5,'bench');assert(Object.values(rig.gymEquipment.variants).every(v=>!v.group.visible));
    rig.pose(.5,'squat');assert(!rig.staticProps.visible);
    rig.pose(.5,id);rig.reset();assert(!rig.staticProps.visible);
  }
  for(const [mesh,geometry,material] of assets){assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);}
});

test('leg machine lever pivots at the knee and its pad stays on the correct side of the lower shin',()=>{
  const {rig}=createAnatomyAtlas({rigged:true});
  for(const id of ['leg-extension','leg-curl'])for(let i=0;i<=100;i++){
    rig.pose(i/100,id);
    const d=rig.gymEquipment.variants[id].dynamic,knee=rig.poseJoints.l.knee.clone().add(rig.poseJoints.r.knee).multiplyScalar(.5),ankle=rig.poseJoints.l.ankle.clone().add(rig.poseJoints.r.ankle).multiplyScalar(.5);
    const [pivot,tip]=d.arm.userData.ends.map(p=>new T.Vector3(...p)),lower=ankle.clone().sub(knee).normalize();
    assert(Math.abs(pivot.y-knee.y)<1e-8&&Math.abs(pivot.z-knee.z)<1e-8,'Lever rotates at knee height and depth');
    const front=new T.Vector3().crossVectors(new T.Vector3(1,0,0),lower).negate(),offset=tip.clone().sub(ankle);
    assert(Math.abs(offset.dot(front)-(id==='leg-curl'?-.15:.15))<1e-8,'Pad remains behind the shin for curl and in front for extension');
    assert(Math.abs(offset.dot(lower)+.09)<1e-8,'Pad stays above the ankle');
    const [a,b]=d.axle.userData.ends.map(p=>new T.Vector3(...p));assert(tip.distanceTo(b)<1e-8);assert(Math.abs(a.y-tip.y)<1e-8);
  }
});
