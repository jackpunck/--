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
const trimBeforeScale=process.env.QA_SOFTWARE_EARLY_TRIM==='1'?true:undefined;
const cases=[{name:'one-frame',rate:100,duration:.01},{name:'fractional-duration',rate:100,duration:2.01},{name:'low-frame-rate',rate:2,duration:.5},{name:'phone-mov',rate:30,duration:1.1,extension:'mov',preset:'medium'}];
for(const item of cases){
 item.path=join(dataDir,item.name+'.'+(item.extension||'mp4'));
 await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',`testsrc2=s=64x64:r=${item.rate}:d=${item.duration}`,'-c:v','libx264','-preset',item.preset||'ultrafast','-an',item.path],{windowsHide:true});
}
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tools/node_modules/playwright/index.mjs'))));
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const workerScript=`self.onmessage=async({data})=>{
 let source,count=0,active=0,maxActive=0;
 try{
  const {prepareMotionSource,decodePreparedMotion,readPreparedMotionFrames}=await import('/motion-software-decode.js');
  source=await prepareMotionSource(data.file);const metadata={...source.metadata};source.metadata.duration+=data.adjust||0;
  let preview=0;const times=[],hashes=[],previewTimes=[];
  const hash=canvas=>{let value=2166136261;for(const byte of canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)value=Math.imul(value^byte,16777619);return value>>>0;};
  const consume=(canvas,target)=>{count++;times.push(target.time);hashes.push(hash(canvas));};
  const onFrame=data.asyncInference?async(canvas,target)=>{
   active++;maxActive=Math.max(maxActive,active);
   try{const before=hash(canvas);await new Promise(resolve=>setTimeout(resolve,5));if(hash(canvas)!==before)throw new Error('Queued inference pixels changed before completion');if(data.fail&&count===3)throw new Error('Inference rejected at frame 3');consume(canvas,target);}finally{active--;}
  }:consume;
  if(data.native){
   const {prepareMp4}=await import('/motion-decode.js');
   const prepared=await prepareMp4(data.file,{...metadata,sampleFps:data.sampleFps,maxDimension:64});
   if(!prepared?.run)throw new Error('Native fixture decoder unavailable');
   await prepared.run(onFrame);
  }else await decodePreparedMotion(source,onFrame,{maxDimension:64,sampleFps:data.sampleFps,trimBeforeScale:data.trimBeforeScale,asyncInference:data.asyncInference,onPreview:frame=>{preview++;previewTimes.push(frame.time);}});
  let matchingStillPixels;
  if(data.sampleFps===7.5&&!data.native&&!data.adjust){
   const selected=[...new Set([times[0],times[Math.floor(times.length/2)],times.at(-1)])];
   const slow=readPreparedMotionFrames(source,selected,{maxDimension:64,sampleFps:7.5});
   const fast=readPreparedMotionFrames(source,selected,{maxDimension:64,sampleFps:15});
   matchingStillPixels=slow.every((frame,i)=>frame.bytes.length===fast[i].bytes.length&&frame.bytes.every((byte,j)=>byte===fast[i].bytes[j]));
  }
  self.postMessage({metadata,count,preview,times,hashes,previewTimes,matchingStillPixels,maxActive});
 }catch(error){self.postMessage({error:error.message,count,maxActive});}finally{source?.close();}
};`;
try{
 const page=await browser.newPage();
 await page.route('**/qa-source-boundaries-worker.js',route=>route.fulfill({contentType:'text/javascript',body:workerScript}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const results=[];
 const fixtures=[...cases,{...cases[1],name:'understated-duration',adjust:-.5},{...cases[1],name:'overstated-duration',adjust:.5}];
 const combinations=[15,7.5].flatMap(sampleFps=>fixtures.flatMap(item=>[false,true].flatMap(asyncInference=>(item.adjust?[false]:[false,true]).map(native=>({...item,asyncInference,native,sampleFps})))));
 combinations.push(...[false,true].map(native=>({...cases[1],name:'rejected-inference',asyncInference:true,native,fail:true,sampleFps:7.5})));
 for(const item of combinations){
  const bytes=Array.from(await readFile(item.path));
  const result=await page.evaluate(async({bytes,adjust,asyncInference,native,extension,fail,sampleFps,trimBeforeScale})=>{
   const worker=new Worker('/qa-source-boundaries-worker.js');
   try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Source boundary decode timed out')),30000);
    worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};
    worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};
    worker.postMessage({file:new File([new Uint8Array(bytes)],'fixture.'+(extension||'mp4'),{type:extension==='mov'?'video/quicktime':'video/mp4'}),adjust,asyncInference,native,fail,sampleFps,trimBeforeScale});
   });}finally{worker.terminate();}
  },{bytes,adjust:item.adjust,asyncInference:item.asyncInference,native:item.native,extension:item.extension,fail:item.fail,sampleFps:item.sampleFps,trimBeforeScale});
  if(item.fail){assert.equal(result.error,'Inference rejected at frame 3');assert.equal(result.count,3);assert.equal(result.maxActive,1);}
  else if(item.adjust)assert(result.error,`${item.name}: a mismatched source duration must be rejected`);
  else{
   assert.equal(result.error,undefined);
   assert.equal(result.count,Math.ceil(result.metadata.duration*item.sampleFps));
   assert.equal(result.preview,item.native?0:Math.ceil(result.count/3));
   assert.deepEqual(result.times,Array.from({length:result.count},(_,index)=>index/item.sampleFps));
   assert.deepEqual(result.previewTimes,Array.from({length:result.preview},(_,index)=>index*3/item.sampleFps));
   if(item.sampleFps===7.5&&!item.native)assert.equal(result.matchingStillPixels,true,'evidence must retain the original selected source picture');
   if(item.asyncInference){
    assert.equal(result.maxActive,1,'inference must be sequential');
    const baseline=results.find(value=>value.name===item.name&&value.native===item.native&&value.sampleFps===item.sampleFps&&!value.asyncInference);
    assert.deepEqual(result.hashes,baseline.hashes,`${item.name}: awaiting inference must preserve every selected pixel`);
   }
  }
  results.push({name:item.name,asyncInference:item.asyncInference,native:item.native,sampleFps:item.sampleFps,trimBeforeScale,...result});
 }
 await writeFile(join(dataDir,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({dataDir,results},null,2));
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
