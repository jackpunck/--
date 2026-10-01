import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createDualQuaternionSkinning} from '../dual-quaternion-skinning.js';
import {createAnatomyAtlas} from '../atlas-model.js';
import {animatedExercises} from '../exercise-catalog.js';

test('blended joints retain cross-section radius through bending and twisting',()=>{
  const bones=[new THREE.Bone(),new THREE.Bone()],skeleton=new THREE.Skeleton(bones);
  const skin=createDualQuaternionSkinning(skeleton),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([1,0,0,0,0,1,-1,0,0,0,0,-1],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(Array(4).fill([0,1,0,0]).flat(),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(Array(4).fill([.5,.5,0,0]).flat(),4));
  const mesh=skin(new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial()));mesh.bind(skeleton,new THREE.Matrix4());
  const p=new THREE.Vector3(),expected=new THREE.Vector3();
  for(const degrees of [0,45,90,150,179,181,270,360]){
    bones[1].quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(degrees));
    bones.forEach(b=>b.updateMatrixWorld());skeleton.update();
    const angle=THREE.MathUtils.degToRad(degrees>180?degrees-360:degrees)/2;
    for(let i=0;i<4;i++){
      mesh.getVertexPosition(i,p);expected.fromBufferAttribute(geometry.attributes.position,i).applyAxisAngle(new THREE.Vector3(0,1,0),angle);
      assert(p.distanceTo(expected)<1e-6);assert(Math.abs(Math.hypot(p.x,p.z)-1)<1e-6,'joint must not collapse inward');
      p.fromBufferAttribute(geometry.attributes.position,i);mesh.applyBoneNormal(i,p);assert(p.distanceTo(expected)<1e-6,'offline normal matches rotation');
    }
  }
  bones[0].position.set(1,2,3);bones[1].position.set(3,4,5);bones.forEach(b=>{b.quaternion.identity();b.updateMatrixWorld();});skeleton.update();
  mesh.getVertexPosition(0,p);assert(p.distanceTo(new THREE.Vector3(3,3,4))<1e-6,'translation uses the same normalized blend');
  mesh.applyBoneNormal(0,p.set(1,0,0));assert(p.distanceTo(new THREE.Vector3(1,0,0))<1e-6,'translation must not change a normal');
});

test('zero-weight slots cannot select the wrong quaternion hemisphere',()=>{
  const bones=[new THREE.Bone(),new THREE.Bone(),new THREE.Bone()],skeleton=new THREE.Skeleton(bones),skin=createDualQuaternionSkinning(skeleton);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([1,0,0],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,1,2,0],4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([0,.5,.5,0],4));
  const mesh=skin(new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial()));mesh.bind(skeleton,new THREE.Matrix4());
  bones[1].rotation.y=THREE.MathUtils.degToRad(170);bones[2].rotation.y=THREE.MathUtils.degToRad(190);
  bones.forEach(b=>b.updateMatrixWorld());skeleton.update();
  assert(mesh.getVertexPosition(0,new THREE.Vector3()).distanceTo(new THREE.Vector3(-1,0,0))<1e-6);
});

test('surface normals follow weight-induced slope and rotational deformation',()=>{
  const bones=[new THREE.Bone(),new THREE.Bone()],skeleton=new THREE.Skeleton(bones),skin=createDualQuaternionSkinning(skeleton);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([.2,.3,0],3));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,1,0,0],4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute([.6,.4,0,0],4));
  for(let k=0;k<4;k++)g.setAttribute('skinGradient'+k,new THREE.Float32BufferAttribute([k===0?-.5:k===1?.5:0,0,0],3));
  const mesh=skin(new THREE.SkinnedMesh(g,new THREE.MeshStandardMaterial()));mesh.bind(skeleton,new THREE.Matrix4());
  bones[1].position.z=1;bones.forEach(b=>b.updateMatrixWorld());skeleton.update();
  let n=mesh.applyBoneNormal(0,new THREE.Vector3(0,0,1));
  assert(n.distanceTo(new THREE.Vector3(-.5,0,1).normalize())<1e-7,'translation with varying weights tilts the surface normal');
  const position=new THREE.Vector3(.2,.3,0),step=1e-4;
  for(const angle of [0,.3,1,2,2.9]){
    bones[1].quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),angle);bones[1].updateMatrixWorld();skeleton.update();
    function evaluate(dx,dy){
      const w=.4+.5*dx;g.attributes.skinWeight.setXYZW(0,1-w,w,0,0);
      return mesh.applyBoneTransform(0,position.clone().add(new THREE.Vector3(dx,dy,0)));
    }
    const u=evaluate(step,0).sub(evaluate(-step,0)),v=evaluate(0,step).sub(evaluate(0,-step));
    g.attributes.skinWeight.setXYZW(0,.6,.4,0,0);
    n=mesh.applyBoneNormal(0,new THREE.Vector3(0,0,1));
    assert(n.distanceTo(u.cross(v).normalize())<.001,`normal disagrees with deformed tangent plane: ${angle}`);
  }
});

test('surface weight gradients remain finite and preserve a constant weight sum',()=>{
  const atlas=createAnatomyAtlas({rigged:true});
  for(const mesh of atlas.pickableMeshes){
    const g=mesh.geometry;
    for(let i=0;i<g.attributes.position.count;i++)for(let axis=0;axis<3;axis++){
      let sum=0;
      for(let k=0;k<4;k++){
        const value=g.attributes['skinGradient'+k].array[i*3+axis];assert(Number.isFinite(value));sum+=value;
      }
      assert(Math.abs(sum)<.002,`${mesh.name}: weight derivative does not sum to zero`);
    }
  }
});

test('all atlas vertices preserve rest geometry and rigid bones remain rigid in every action',()=>{
  const atlas=createAnatomyAtlas({rigged:true}),p=new THREE.Vector3(),base=new THREE.Vector3(),matrix=new THREE.Matrix4();
  for(const mesh of atlas.pickableMeshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    mesh.getVertexPosition(i,p);base.fromBufferAttribute(mesh.geometry.attributes.position,i);assert(p.distanceTo(base)<1e-6);
  }
  const boneMesh=atlas.pickableMeshes.find(m=>m.userData.kind==='bone'),g=boneMesh.geometry;
  for(const id of animatedExercises)for(const q of [0,.25,.5,.75,1]){
    atlas.rig.pose(q,id);
    for(let i=0;i<g.attributes.position.count;i+=97){
      boneMesh.getVertexPosition(i,p);base.fromBufferAttribute(g.attributes.position,i);
      const joint=g.attributes.skinIndex.getX(i);matrix.fromArray(atlas.rig.skeleton.boneMatrices,joint*16);base.applyMatrix4(matrix);
      assert(p.distanceTo(base)<2e-6,`${id}: rigid anatomical bone changed shape`);
    }
  }
});

test('scapular muscle origins stay attached to the chest through the full overhead range on both sides',()=>{
  const atlas=createAnatomyAtlas({rigged:true}),chest=atlas.rig.map.chest.userData.index,p=new THREE.Vector3(),base=new THREE.Vector3(),matrix=new THREE.Matrix4(),origins=[];
  for(const mesh of atlas.pickableMeshes)for(const structure of mesh.userData.structures){
    if(!/Teres (major|minor)|Subscapularis|Infraspinatus|Supraspinatus/.test(structure.structure))continue;
    const g=mesh.geometry,indices=new Set();
    for(let i=structure.firstFace*3;i<(structure.firstFace+structure.faceCount)*3;i++)indices.add(g.index.getX(i));
    let checked=0;
    for(const i of indices){
      base.fromBufferAttribute(g.attributes.position,i);if(Math.abs(base.x)>.235)continue;
      let chestWeight=0;for(let k=0;k<4;k++)if(g.attributes.skinIndex.array[i*4+k]===chest)chestWeight+=g.attributes.skinWeight.array[i*4+k];
      assert.equal(chestWeight,1,`${structure.structure}: scapular origin dragged by the humerus`);checked++;
      if(checked%11===1)origins.push({mesh,i});
    }
    assert(checked>0,structure.structure);
  }
  for(const id of ['lat-pulldown','pullup','overhead-triceps','shoulder-press','lateral-raise'])for(let frame=0;frame<=100;frame++){
    atlas.rig.pose(frame/100,id);matrix.fromArray(atlas.rig.skeleton.boneMatrices,chest*16);
    for(const {mesh,i} of origins){
      mesh.getVertexPosition(i,p);base.fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(matrix);
      assert(p.distanceTo(base)<2e-6,`${id}: detached scapular origin`);
    }
  }
});
