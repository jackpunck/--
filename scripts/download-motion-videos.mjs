// Download the remaining source videos without conversion or media inspection.
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('测试集');
const config = JSON.parse(await fs.readFile('scripts/motion-test-dataset.json', 'utf8'));
const manifestPath = path.join(root, 'manifest.json');
const state = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const items = new Map(state.items.map(item => [item.id, item]));
const failures = new Map();
async function folderBytes(folder) {
 let total=0;
 for (const entry of await fs.readdir(folder,{withFileTypes:true})) {
  const file=path.join(folder,entry.name);
  if (entry.isSymbolicLink()) throw new Error('Dataset contains a filesystem link');
  total+=entry.isDirectory()?await folderBytes(file):(await fs.stat(file)).size;
 }
 return total;
}
let used=await folderBytes(root), reserved=2_000_000, cursor=0, checkpointTail=Promise.resolve();
function local(relativePath) {
 const file=path.resolve(root,relativePath);
 if (!file.startsWith(root+path.sep)) throw new Error('Path outside dataset');
 return file;
}
async function checkpoint() {
 const pending=checkpointTail.then(async()=>{
  const prior=(await fs.stat(manifestPath)).size;
  const data=JSON.stringify({...state,updatedAt:new Date().toISOString(),
   preparationMode:'Remaining files downloaded directly; no media conversion or inspection.',
   items:[...items.values()].sort((a,b)=>a.id.localeCompare(b.id)),failures:[...failures.values()]},null,2)+'\n';
  if(Buffer.byteLength(data)>1_000_000) throw new Error('Metadata capacity exceeded');
  await fs.writeFile(manifestPath,data); used+=Buffer.byteLength(data)-prior;
 });
 checkpointTail=pending.catch(()=>{}); return pending;
}
const pending=config.items.filter(item=>!items.has(item.id));
let commonsTail=Promise.resolve();
async function download(item) {
 const isCommons=item.sourceGroup==='commons';
 let release;
 if(isCommons){const prior=commonsTail;commonsTail=new Promise(done=>release=done);await prior;}
 try {
  const originalExt=path.extname(new URL(item.url).pathname).toLowerCase();
  const extension=['.mp4','.mov','.webm'].includes(originalExt)?originalExt:'.mp4';
  const relativePath=item.relativePath.replace(/\.mp4$/i,extension);
  const file=local(relativePath), temp=local(`.work/${item.id}.download`);
  await fs.mkdir(path.dirname(file),{recursive:true});
  let existing;
  try{existing=await fs.stat(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing){
   items.set(item.id,{...item,relativePath,outputBytes:existing.size,outputSha256:null,transformation:'Existing file retained without inspection.'});
   console.log(`[retained] ${item.id}`);return;
  }
  if(used+reserved+item.sourceBytes>3_000_000_000)throw new Error('3 GB folder limit reached');
  reserved+=item.sourceBytes;
  try{
   for(let attempt=0;attempt<3;attempt++){
    let handle,owned=false;
    try{
     const response=await fetch(item.url,{signal:AbortSignal.timeout(180000),headers:{'User-Agent':'MotionEvaluationDataset/1.0 (local video download)','Accept-Encoding':'identity'}});
     if(!response.ok){await response.body?.cancel();throw new Error(`HTTP ${response.status}`);}
     handle=await fs.open(temp,'wx');owned=true;let bytes=0;
     for await(const chunk of response.body){
      if(bytes+chunk.length>item.sourceBytes)throw new Error('Download exceeds reserved folder capacity');
      for(let offset=0;offset<chunk.length;){const wrote=await handle.write(chunk,offset,chunk.length-offset);offset+=wrote.bytesWritten;}
      bytes+=chunk.length;
     }
     await handle.close();handle=null;
     if(bytes!==item.sourceBytes)throw new Error('Download was incomplete');
     await fs.rename(temp,file);owned=false;used+=bytes;
     items.set(item.id,{...item,relativePath,outputBytes:bytes,outputSha256:null,
      duration:item.sourceDurationSeconds??null,width:null,height:null,
      transformation:'Original source file downloaded unchanged; no media inspection.',preparedAt:new Date().toISOString()});
     console.log(`[downloaded ${items.size}/${config.items.length}] ${item.id} ${bytes} bytes`);return;
    }catch(error){
     await handle?.close();if(owned)await fs.unlink(temp);
     if(attempt===2)throw error;
     console.log(`[retry] ${item.id}: ${error.message}`);
     await new Promise(done=>setTimeout(done,isCommons?15000:2000));
    }
   }
  }finally{reserved-=item.sourceBytes;}
 }finally{release?.();}
}
await Promise.all(Array.from({length:6},async()=>{
 while(cursor<pending.length){
  const item=pending[cursor++];
  try{await download(item);}catch(error){failures.set(item.id,{id:item.id,error:error.message});console.error(`[failed] ${item.id}: ${error.message}`);}
  await checkpoint();
 }
}));
await checkpoint();
console.log(JSON.stringify({downloaded:items.size,failed:failures.size,totalFolderBytes:await folderBytes(root),maxTotalBytes:3_000_000_000}));
if(failures.size)process.exitCode=1;
