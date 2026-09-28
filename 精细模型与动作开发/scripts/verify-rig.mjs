import * as THREE from 'three';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAnatomyAtlas} from '../atlas-model.js';
const a=createAnatomyAtlas({rigged:true}),meshes=a.body.children.filter(m=>m.isSkinnedMesh),v=new THREE.Vector3(),base=new THREE.Vector3();
let vertices=0,maxRestError=0;
for(const m of meshes){
  const g=m.geometry,p=g.attributes.position,w=g.attributes.skinWeight,b=g.attributes.skinIndex;vertices+=p.count;
  for(let i=0;i<p.count;i++){
    let sum=0;for(let j=0;j<4;j++){const value=w.array[i*4+j];assert(value>=0&&Number.isFinite(value));assert(b.array[i*4+j]<a.rig.bones.length);sum+=value;}
    assert(Math.abs(sum-1)<1e-6,'skin weights normalize');
    if(i%71===0){m.getVertexPosition(i,v);base.fromBufferAttribute(p,i);maxRestError=Math.max(maxRestError,v.distanceTo(base));}
  }
}
assert(maxRestError<1e-6,'binding must preserve imported anatomical shape');
let poses=0,maxLimbError=0;
for(const exercise of ['squat','curl','pushup'])for(let frame=0;frame<=100;frame++){
  a.rig.pose(frame/100,exercise);poses++;
  for(const b of a.rig.bones)assert(b.matrixWorld.elements.every(Number.isFinite));
  for(const side of ['l','r']){
    const r=a.rig.joints[side],j=a.rig.poseJoints[side];
    for(const [start,end] of [['shoulder','elbow'],['elbow','wrist'],['hip','knee'],['knee','ankle']]){
      const err=Math.abs(r[start].distanceTo(r[end])-j[start].distanceTo(j[end]));maxLimbError=Math.max(err,maxLimbError);assert(err<.002,`${exercise} ${start} ${end} length error ${err}`);
    }
  }
  for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i+=997){m.getVertexPosition(i,v);assert(v.toArray().every(Number.isFinite));assert(v.length()<5,'runaway deformation');}
}
// Check actual deformed vertices against the floor and stationary supports.
let minimumGroundClearance=Infinity;
for(const q of [0,.5,1]){
  a.rig.pose(q,'pushup');let minimum=Infinity;
  for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,v);minimum=Math.min(minimum,v.y);}
  assert(minimum>=-.002,'push-up penetrates ground');assert(minimum<.02,'push-up floats above ground');minimumGroundClearance=Math.min(minimumGroundClearance,minimum);
  for(const side of ['l','r']){assert(Math.abs(a.rig.poseJoints[side].wrist.y-.12)<1e-8);assert(Math.abs(a.rig.poseJoints[side].ankle.y-.327)<1e-8);}
}
// Static/animated mode switching must restore all bones and hide held weights.
a.rig.reset();for(const b of a.rig.bones){assert(b.position.distanceTo(a.rig.rest[b.name])<1e-8);assert(b.quaternion.angleTo(new THREE.Quaternion())<1e-8);}assert(a.rig.weights.every(w=>!w.visible));
console.log(JSON.stringify({bones:a.rig.bones.length,vertices,poses,maxRestError,maxLimbError,minimumGroundClearance}));

if(process.argv.includes('--export')){
  const dir='.qa/rig';fs.mkdirSync(dir,{recursive:true});const metadata=[];
  const views=[['curl',.90,'front'],['curl',.90,'side'],['squat',1,'angle'],['squat',1,'side'],['pushup',0,'angle'],['pushup',1,'side']];
  const active={curl:[['biceps'],['core','','','secondary']],squat:[['quads'],['glutes'],['core','','','secondary']],pushup:[['chest'],['triceps'],['core','','','secondary']]};
  for(const [id,q,view] of views){
    a.rig.pose(q,id);a.setAppearance('neutral',active[id],null,true);
    const camera=new THREE.PerspectiveCamera(34,900/1100,.1,40),target=new THREE.Vector3(0,id==='pushup'?.6:id==='curl'?2.16:1.43,id==='pushup'?.3:0);
    const offsets={front:[0,.2,6],side:[6,.5,0],angle:[3.8,1.7,5.1]};camera.position.copy(target).add(new THREE.Vector3(...offsets[view]).multiplyScalar(id==='pushup'?1.20/camera.aspect:id==='curl'?.6:1));camera.lookAt(target);camera.updateMatrixWorld();
    const visible=[];a.body.traverseVisible(o=>{if(o.isMesh)visible.push(o);});
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#eaf0e7'}));floor.rotation.x=-Math.PI/2;floor.updateMatrixWorld();visible.push(floor);
    const count=visible.reduce((n,m)=>n+m.geometry.index.count,0),data=new Float32Array(count*12);let offset=0;
    const normal=new THREE.Vector3(),n0=new THREE.Vector3(),tmp=new THREE.Vector3(),bm=new THREE.Matrix4();
    for(const m of visible){
      const g=m.geometry,p=g.attributes.position,n=g.attributes.normal,c=m.material.color,nmat=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
      const positions=new Float32Array(p.count*3),normals=new Float32Array(p.count*3);
      for(let i=0;i<p.count;i++){
        m.getVertexPosition(i,v);v.applyMatrix4(m.matrixWorld);positions.set(v.toArray(),i*3);n0.fromBufferAttribute(n,i);
        if(m.isSkinnedMesh){normal.set(0,0,0);for(let k=0;k<4;k++){const weight=g.attributes.skinWeight.array[i*4+k];if(!weight)continue;bm.fromArray(m.skeleton.boneMatrices,g.attributes.skinIndex.array[i*4+k]*16);tmp.copy(n0).transformDirection(bm);normal.addScaledVector(tmp,weight);}normal.normalize();}
        else normal.copy(n0);
        normal.applyMatrix3(nmat).normalize();normals.set(normal.toArray(),i*3);
      }
      for(const i of g.index.array){data.set([positions[i*3],positions[i*3+1],positions[i*3+2],normals[i*3],normals[i*3+1],normals[i*3+2],c.r,c.g,c.b,0,0,0],offset);offset+=12;}
    }
    const filename=`${id}-${q}-${view}`;fs.writeFileSync(`${dir}/${filename}.bin`,Buffer.from(data.buffer));metadata.push({filename,exercise:id,q,view,count,projection:camera.projectionMatrix.elements,viewMatrix:camera.matrixWorldInverse.elements,camera:camera.position.toArray()});
  }
  fs.writeFileSync(`${dir}/scenes.json`,JSON.stringify(metadata));
}
