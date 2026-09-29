import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createAnatomyAtlas} from '../atlas-model.js';
import {gripOffset} from '../grip-poses.js';
const ids=['curl','chest-press','bench','incline-bench','lat-pulldown','pullup','row','dumbbell-row','shoulder-press','lateral-raise','reverse-fly','triceps','hammer-curl','overhead-triceps','goblet-squat','rdl'];
test('loaded hands keep straight wrists, continuous rotations and closed fingers throughout the action',()=>{
 const a=createAnatomyAtlas({rigged:true});
 for(const id of ids){let previous={};for(let i=0;i<=100;i++){
  a.rig.pose(i/100,id);
  for(const [side,sign] of [['l',1],['r',-1]]){
   if(id==='dumbbell-row'&&side==='l')continue;
   const h=a.rig.map['hand.'+side],j=a.rig.poseJoints[side],fore=j.wrist.clone().sub(j.elbow).normalize();
   assert(new T.Vector3(0,-1,0).applyQuaternion(h.quaternion).dot(fore)>.999999,`${id}/${side}: bent wrist`);
   if(previous[side])assert(h.quaternion.angleTo(previous[side])<.12,`${id}: sudden grip twist`);previous[side]=h.quaternion.clone();
   const contact=gripOffset(sign).applyQuaternion(h.quaternion).add(h.position);
   if(['pullup','lat-pulldown'].includes(id)){
    assert(Math.abs(new T.Vector3(1,0,0).applyQuaternion(h.quaternion).x)>.999999,'Grip follows the straight bar');
    assert(contact.distanceTo(a.rig.equipmentAnchors.palms[side])<1e-8);
    assert(Math.abs(contact.y-a.rig.equipmentAnchors.barCenter.y)<1e-8);
   }
   if(!['overhead-triceps','goblet-squat'].includes(id))for(const chain of a.rig.fingerChains[side]){
    const seg=chain.at(-1),b=a.rig.map[seg.bone];
    const tip=seg.bottom.clone().sub(a.rig.rest[seg.bone]).applyQuaternion(b.quaternion).add(b.position).sub(h.position).applyQuaternion(h.quaternion.clone().invert());
    const radius=Math.hypot(tip.y+.165,tip.z-.17);
    assert(radius>.028&&radius<.06,`${id}/${seg.bone}: fingertips fail to wrap around handle (${radius})`);
   }
   if(id==='chest-press'){
    const flex=T.MathUtils.radToDeg(j.elbow.clone().sub(j.shoulder).angleTo(fore));
    assert(flex>10&&flex<110,'Press stays short of locking and excessive depth');
    assert(j.elbow.y<j.shoulder.y,'Press elbows remain below shoulders');
    const normal=new T.Vector3(0,0,1).applyQuaternion(h.quaternion);assert(normal.x*sign<-.85,'Neutral grip faces inward');
    assert(contact.y>1.4&&contact.y<1.7,'Handles remain at mid-chest height');
   }
  }
 }}
});
test('the supporting hand stays open and returns cleanly from closed grip',()=>{
 const a=createAnatomyAtlas({rigged:true});a.rig.pose(.5,'chest-press');const closed=a.rig.map['finger2-0.l'].quaternion.clone();
 a.rig.pose(.5,'dumbbell-row');const hand=a.rig.map['hand.l'];
 const relative=hand.quaternion.clone().invert().multiply(a.rig.map['finger2-0.l'].quaternion);
 assert(relative.angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),.4))<1e-7);
 assert(closed.angleTo(a.rig.map['finger2-0.l'].quaternion)>.1);
 a.rig.reset();for(const b of a.rig.bones)assert(b.quaternion.angleTo(new T.Quaternion())<1e-7);
});

test('closed phalanx surfaces clear the handle and fingers close in parallel planes',()=>{
 const a=createAnatomyAtlas({rigged:true});a.rig.pose(.5,'chest-press');let checked=0;
 for(const side of ['l','r']){
  const h=a.rig.map['hand.'+side],inverse=h.quaternion.clone().invert(),offset=gripOffset(side==='l'?1:-1);
  for(const [finger,chain] of a.rig.fingerChains[side].entries())for(const seg of chain){
   const mesh=a.pickableMeshes.find(m=>m.userData.structures.some(s=>s.structure===seg.source));
   const info=mesh.userData.structures.find(s=>s.structure===seg.source),g=mesh.geometry,indices=new Set();
   for(let i=info.firstFace*3;i<(info.firstFace+info.faceCount)*3;i++)indices.add(g.index.getX(i));
   for(const index of indices){const v=mesh.getVertexPosition(index,new T.Vector3()).sub(h.position).applyQuaternion(inverse);if(Math.abs(v.x-offset.x)>.14)continue;assert(Math.hypot(v.y-offset.y,v.z-offset.z)>.028,`${seg.bone}: bone penetrates handle`);checked++;}
   if(finger>0){const local=a.rig.map[seg.bone].position.clone().sub(h.position).applyQuaternion(inverse);assert(Math.abs(local.x-(chain[0].top.x-a.rig.rest['hand.'+side].x))<1e-7,'Closed digits adduct instead of splaying');}
  }
 }
 assert(checked>1000);
 const closed=a.rig.map['hand.l'].quaternion.clone().invert().multiply(a.rig.map['finger2-1.l'].quaternion);
 a.rig.pose(.5,'goblet-squat');const cupped=a.rig.map['hand.l'].quaternion.clone().invert().multiply(a.rig.map['finger2-1.l'].quaternion);
 assert(closed.angleTo(cupped)>.05,'Supporting a dumbbell end uses a distinct cupped pose');
});
