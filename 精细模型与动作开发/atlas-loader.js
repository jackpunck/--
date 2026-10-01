import asset from './assets/anatomy-atlas.json' with {type:'json'};
import {decodeAtlasData} from './atlas-decode.js';
const scriptUrl=globalThis.document?.currentScript?.src||globalThis.location?.href;
export async function loadBrowserAtlas() {
  if(asset.data)return null; // Self-contained file:// build keeps its original behavior.
  const url=new URL(`assets/anatomy-data.bin?v=${asset.dataHash}`,scriptUrl).href;
  if(typeof Worker==='function'){
    try{return await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL(`atlas.worker.js?v=${asset.dataHash}`,scriptUrl));
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('模型解码超时'));},30000);
      const finish=()=>{clearTimeout(timer);worker.terminate();};
      worker.onmessage=({data})=>{finish();data.error?reject(new Error(data.error)):resolve(data.decoded);};
      worker.onerror=()=>{finish();reject(new Error('后台解码不可用'));};
      worker.postMessage({asset,url});
    });}catch{/* Restricted browsers retain the same data and main-thread fallback. */}
  }
  const response=await fetch(url);if(!response.ok)throw new Error('模型数据加载失败');
  return decodeAtlasData(asset,new Uint8Array(await response.arrayBuffer()));
}
