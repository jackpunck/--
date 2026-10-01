import {unzlibSync} from 'three/addons/libs/fflate.module.js';
export function decodeAtlasData(asset,compressed) {
  const raw=unzlibSync(compressed||Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)));
  const words=(offset,length)=>{const start=raw.byteOffset+offset;return start%2?new Int16Array(raw.slice(offset,offset+length*2).buffer):new Int16Array(raw.buffer,start,length);};
  return asset.meshes.map(item=>{
    const start=item.offset,n=item.vertices;
    const packed=words(start,n*3);
    const position=Float32Array.from(packed,v=>v*asset.positionScale*asset.scale);
    const normal=Float32Array.from(new Int8Array(raw.buffer,raw.byteOffset+start+n*6,n*3),v=>v/127);
    const indexStart=raw.byteOffset+start+n*9;
    const index=indexStart%2?new Uint16Array(raw.slice(start+n*9,start+n*9+item.indices*2).buffer):new Uint16Array(raw.buffer,indexStart,item.indices);
    return {position,normal,index};
  });
}
