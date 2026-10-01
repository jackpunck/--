import {decodeAtlasData} from './atlas-decode.js';
self.onmessage=async({data})=>{
  try{
    const response=await fetch(data.url);if(!response.ok)throw new Error('模型数据加载失败');
    const decoded=decodeAtlasData(data.asset,new Uint8Array(await response.arrayBuffer()));
    const buffers=[...new Set(decoded.flatMap(mesh=>[mesh.position.buffer,mesh.normal.buffer,mesh.index.buffer]))];
    self.postMessage({decoded},buffers);
  }catch(error){self.postMessage({error:error.message});}
};
