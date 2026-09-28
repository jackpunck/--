import * as THREE from 'three';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAnatomyAtlas} from '../atlas-model.js';
import {muscleIds,structures} from '../muscle-data.js';
const atlas=createAnatomyAtlas();let triangles=0,drawCalls=0;
for(const m of atlas.body.children){
  if(!m.isMesh)continue;drawCalls++;
  const g=m.geometry,p=g.attributes.position;
  assert(p.array.every(Number.isFinite));assert(g.attributes.normal.array.every(Number.isFinite));
  assert(g.index.array.every(i=>i<p.count));triangles+=g.index.count/3;
  // Mirroring a source object must also reverse its triangle winding. Otherwise
  // double-sided WebGL materials invert the otherwise correct vertex normals.
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),tmp=new THREE.Vector3();
  let total=0,reversed=0;
  for(let i=0;i<g.index.count;i+=3){
    const i0=g.index.array[i],i1=g.index.array[i+1],i2=g.index.array[i+2];
    a.fromBufferAttribute(p,i0);b.fromBufferAttribute(p,i1).sub(a);c.fromBufferAttribute(p,i2).sub(a);b.cross(c);
    normal.fromBufferAttribute(g.attributes.normal,i0).add(tmp.fromBufferAttribute(g.attributes.normal,i1)).add(tmp.fromBufferAttribute(g.attributes.normal,i2));
    const dot=b.dot(normal);total+=Math.abs(dot);if(dot<0)reversed-=dot;
  }
  assert(reversed/total<.005,`${m.name}: mirrored triangle winding is incorrect`);
}
const bounds=new THREE.Box3().setFromObject(atlas.body),size=bounds.getSize(new THREE.Vector3());
assert(size.y>2.8&&size.y<3.6,'anatomical height');assert(size.x>.6&&size.x<2,'anatomical width');
for(const role of muscleIds){
  assert(atlas.anchors[role]);const mesh=atlas.muscleMeshes.find(m=>m.userData.muscle===role);assert(mesh);
  atlas.setAppearance('neutral',[[role]],role,true);assert.equal(mesh.material.color.getHexString(),'dc6347');
  atlas.setAppearance('neutral',[[role]],role,false);assert.equal(mesh.material.color.getHexString(),'807b71');
}
for(const name of structures){const info=atlas.structureInfo(name);assert(info&&info.name&&info.structure===name);}
let picked=0;
for(const mesh of atlas.pickableMeshes)for(const entry of mesh.userData.structures){
  assert.equal(atlas.pickStructure({object:mesh,faceIndex:entry.firstFace}).structure,entry.structure);
  assert.equal(atlas.pickStructure({object:mesh,faceIndex:entry.firstFace+entry.faceCount-1}).structure,entry.structure);picked++;
}
assert.equal(picked,atlas.structureCount);
const selected=atlas.selectStructure('Serratus anterior muscle.l');assert.equal(selected.structure,'Serratus anterior muscle.l');assert.match(selected.name,/前锯肌/);assert.equal(selected.muscle,null);
assert.equal(atlas.body.children.filter(mesh=>mesh.userData.selectionOverlay).length,1);
assert.equal(atlas.body.children.find(mesh=>mesh.userData.selectionOverlay).material.depthTest,false,'deep structures remain visible through overlying muscles');
const overlay=atlas.body.children.find(mesh=>mesh.userData.selectionOverlay),source=atlas.pickableMeshes.find(mesh=>mesh.userData.structures.some(item=>item.structure===selected.structure));
assert.equal(overlay.geometry.getAttribute('position'),source.geometry.getAttribute('position'),'highlights reuse existing vertex buffers');
assert.equal(overlay.geometry.index,source.geometry.index,'highlights reuse existing index buffers');
const structure=source.userData.structures.find(item=>item.structure===selected.structure);
assert.deepEqual(overlay.geometry.drawRange,{start:structure.firstFace*3,count:structure.faceCount*3},'only the selected real structure is drawn');
let disposed=false;overlay.geometry.addEventListener('dispose',()=>{disposed=true;});
atlas.selectStructure(null);assert.equal(atlas.body.children.filter(mesh=>mesh.userData.selectionOverlay).length,0);
atlas.selectStructure(selected.structure);assert.equal(atlas.body.children.find(mesh=>mesh.userData.selectionOverlay),overlay);assert.equal(disposed,false,'switching selection must not release shared GPU buffers');
atlas.selectStructure(null);
console.log(JSON.stringify({structures:atlas.structureCount,triangles,drawCalls,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}}));
if(process.argv.includes('--export')){
  fs.mkdirSync('.qa/atlas',{recursive:true});
  const views=[['front',[0,1.58,0],[0,.12,6.2],false],['angle',[0,1.58,0],[3,.7,5.5],false],['back',[0,1.58,0],[0,.2,-6.2],false],['upper',[0,2.48,.02],[.6,.05,2.85],false],['highlight',[0,2.12,.02],[1,.3,3.7],true],['legs',[0,.91,0],[1.8,.25,3.5],false]];
  const metadata=[];
  for(const [name,target,delta,highlight] of views){
    atlas.setAppearance('neutral',[['chest'],['biceps'],['core','','','secondary']],null,highlight);atlas.body.updateMatrixWorld(true);
    const camera=new THREE.PerspectiveCamera(34,900/1100,.1,40);camera.position.fromArray(target).add(new THREE.Vector3(...delta));camera.lookAt(new THREE.Vector3(...target));camera.updateMatrixWorld();
    const meshes=atlas.body.children.filter(m=>m.isMesh);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#eaf0e7'}));floor.rotation.x=-Math.PI/2;floor.updateMatrixWorld();meshes.push(floor);
    const count=meshes.reduce((n,m)=>n+m.geometry.index.count,0),data=new Float32Array(count*12);let offset=0;
    const v=new THREE.Vector3(),normal=new THREE.Vector3();
    for(const m of meshes){
      const g=m.geometry,p=g.attributes.position,n=g.attributes.normal,c=m.material.color,nmat=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
      for(const i of g.index.array){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);normal.fromBufferAttribute(n,i).applyMatrix3(nmat).normalize();data.set([v.x,v.y,v.z,normal.x,normal.y,normal.z,c.r,c.g,c.b,0,0,0],offset);offset+=12;}
    }
    fs.writeFileSync(`.qa/atlas/${name}.bin`,Buffer.from(data.buffer));metadata.push({filename:name,exercise:'Anatomy atlas',view:name,q:0,count,projection:camera.projectionMatrix.elements,viewMatrix:camera.matrixWorldInverse.elements,camera:camera.position.toArray()});
  }
  fs.writeFileSync('.qa/atlas/scenes.json',JSON.stringify(metadata));
}
