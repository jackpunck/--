import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unzlibSync} from 'three/addons/libs/fflate.module.js';
import asset from '../assets/anatomy-atlas.json' with {type:'json'};
import {decodeAtlasData} from '../atlas-decode.js';

test('external atlas and worker decoding preserve every original coordinate, normal and triangle',()=>{
  const compressed=readFileSync(new URL('../assets/anatomy-data.bin',import.meta.url));
  assert.deepEqual(compressed,Buffer.from(asset.data,'base64'));
  const decoded=decodeAtlasData(asset,compressed),raw=unzlibSync(compressed);
  assert.equal(decoded.length,700);
  for(const [i,item]of asset.meshes.entries()){
    const start=item.offset,n=item.vertices;
    // Original implementation copied each typed-array range before decoding.
    const packed=new Int16Array(raw.slice(start,start+n*6).buffer);
    const position=Float32Array.from(packed,v=>v*asset.positionScale*asset.scale);
    const normal=Float32Array.from(new Int8Array(raw.slice(start+n*6,start+n*9).buffer),v=>v/127);
    const index=new Uint16Array(raw.slice(start+n*9,start+n*9+item.indices*2).buffer);
    assert.deepEqual(decoded[i],{position,normal,index},item.name);
  }
});
