import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzlibSync} from 'three/addons/libs/fflate.module.js';
import asset from '../assets/anatomy-atlas.json' with {type:'json'};
import provenance from '../assets/muscle-surface-source.json' with {type:'json'};
import {decodeAtlasData} from '../atlas-decode.js';

test('all muscle surfaces retain source provenance and bones remain byte-identical',()=>{
  const records=new Map(provenance.structures.map(s=>[s.name,s]));
  const raw=unzlibSync(Buffer.from(asset.data,'base64')),hash=createHash('sha256');
  let muscles=0;
  for(const item of asset.meshes){
    if(item.kind==='muscle'){
      const source=records.get(item.name);assert(source,item.name);muscles++;
      assert.equal(source.triangles,item.indices/3);
      assert(source.triangles<=6000&&source.triangles>0);
      if(source.sourceTriangles<=6000)assert.equal(source.triangles,source.sourceTriangles,'small muscles retain source detail');
    }else hash.update(raw.subarray(item.offset,item.offset+item.vertices*9+item.indices*2));
  }
  assert.equal(muscles,433);assert.equal(records.size,muscles);
  assert.equal(hash.digest('hex'),provenance.preservedBoneSha256);
});

test('wrist retinacula retain source thickness with closed manifold surfaces',()=>{
  const decoded=decodeAtlasData(asset);let bands=0;
  for(const [i,item]of asset.meshes.entries()){
    if(!item.name.includes('retinaculum of wrist'))continue;
    assert(provenance.structures.find(s=>s.name===item.name).preservedModifiers.includes('SOLIDIFY'));
    const edges=new Map(),index=decoded[i].index;
    for(let t=0;t<index.length;t+=3)for(let k=0;k<3;k++){
      const a=index[t+k],b=index[t+(k+1)%3],key=a<b?a+':'+b:b+':'+a;
      edges.set(key,(edges.get(key)||0)+1);
    }
    for(const uses of edges.values())assert.equal(uses,2,item.name+' has an open or non-manifold edge');
    bands++;
  }
  assert.equal(bands,4);
});
