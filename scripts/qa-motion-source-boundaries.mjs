// Small real-browser decoder checks; no pose model, AI, network media or user edits.
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','motion-source-boundaries-'));
const ffmpeg=process.env.QA_FFMPEG||join(root,'.qa/motion-fixtures/qa-codecs/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const run=promisify(execFile);
const cases=[{name:'one-frame',rate:100,duration:.01},{name:'fractional-duration',rate:100,duration:2.01},{name:'low-frame-rate',rate:2,duration:.5}];
for(const item of cases){
 item.path=join(dataDir,item.name+'.mp4');
 await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',`testsrc2=s=64x64:r=${item.rate}:d=${item.duration}`,'-c:v','libx264','-preset','ultrafast','-an',item.path],{windowsHide:true});
}
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tools/node_modules/playwright/index.mjs'))));
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const workerScript=`self.onmessage=async({data})=>{
 let source;
 try{
  const {prepareMotionSource,decodePreparedMotion}=await import('/motion-software-decode.js');
  source=await prepareMotionSource(data.file);const metadata={...source.metadata};source.metadata.duration+=data.adjust||0;
  let count=0,preview=0;const times=[];
  decodePreparedMotion(source,(_canvas,target)=>{count++;times.push(target.time);},{maxDimension:64,onPreview:()=>preview++});
  self.postMessage({metadata,count,preview,times});
 }catch(error){self.postMessage({error:error.message});}finally{source?.close();}
};`;
try{
 const page=await browser.newPage();
 await page.route('**/qa-source-boundaries-worker.js',route=>route.fulfill({contentType:'text/javascript',body:workerScript}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const results=[];
 for(const item of [...cases,{...cases[1],name:'understated-duration',adjust:-.5},{...cases[1],name:'overstated-duration',adjust:.5}]){
  const bytes=Array.from(await readFile(item.path));
  const result=await page.evaluate(async({bytes,adjust})=>{
   const worker=new Worker('/qa-source-boundaries-worker.js');
   try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Source boundary decode timed out')),30000);
    worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};
    worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};
    worker.postMessage({file:new File([new Uint8Array(bytes)],'fixture.mp4',{type:'video/mp4'}),adjust});
   });}finally{worker.terminate();}
  },{bytes,adjust:item.adjust});
  if(item.adjust)assert(result.error,`${item.name}: a mismatched source duration must be rejected`);
  else{
   assert.equal(result.error,undefined);
   assert.equal(result.count,Math.ceil(result.metadata.duration*15));
   assert.equal(result.preview,Math.ceil(result.count/3));
   assert.deepEqual(result.times,Array.from({length:result.count},(_,index)=>index/15));
  }
  results.push({name:item.name,...result});
 }
 await writeFile(join(dataDir,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({dataDir,results},null,2));
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
