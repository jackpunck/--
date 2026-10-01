import * as THREE from 'three';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createAnatomyAtlas} from '../atlas-model.js';
import {animatedExercises} from '../exercise-catalog.js';

// Diagnostic only: rank local edge extension to find attachment seams. These
// values do not prove absence of intersections or physiological correctness.
const atlas=createAnatomyAtlas({rigged:true}),v=new THREE.Vector3(),rank=new Map();
const meshes=atlas.pickableMeshes.filter(m=>m.userData.kind==='muscle').map(mesh=>{
  const g=mesh.geometry,base=g.attributes.position.array,edges=[];
  for(const structure of mesh.userData.structures){
    const seen=new Set();
    for(let i=structure.firstFace*3;i<(structure.firstFace+structure.faceCount)*3;i+=3){
      const triangle=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];
      for(let k=0;k<3;k++){
        let a=triangle[k],b=triangle[(k+1)%3];if(a>b)[a,b]=[b,a];const key=a+':'+b;if(seen.has(key))continue;seen.add(key);
        const length=Math.hypot(base[a*3]-base[b*3],base[a*3+1]-base[b*3+1],base[a*3+2]-base[b*3+2]);
        if(length>.0001)edges.push({a:a*3,b:b*3,length,structure:structure.structure});
      }
    }
  }
  return {mesh,base,edges,posed:new Float32Array(base.length)};
});
for(const id of animatedExercises)for(const q of [0,.5,1]){
  atlas.rig.pose(q,id);
  for(const {mesh,base,edges,posed} of meshes){
    for(let i=0;i<base.length/3;i++){mesh.getVertexPosition(i,v);posed[i*3]=v.x;posed[i*3+1]=v.y;posed[i*3+2]=v.z;}
    for(const edge of edges){
      const {a,b,length,structure}=edge,current=Math.hypot(posed[a]-posed[b],posed[a+1]-posed[b+1],posed[a+2]-posed[b+2]),extension=current-length;
      if(extension>(rank.get(structure)?.extension??0))rank.set(structure,{structure,id,q,extension,ratio:current/length,restLength:length,point:Array.from(base.slice(a,a+3))});
    }
  }
}
const rows=[...rank.values()].sort((a,b)=>b.extension-a.extension),root=resolve(import.meta.dirname,'../../.qa');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'mesh-audit-'));
await writeFile(join(dir,'edges.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify({dir,worst:rows.slice(0,24)},null,2));
