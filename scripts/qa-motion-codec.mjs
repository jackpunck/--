// Real browser regression for direct source decoding. Visual AI is a local mock;
// source videos are not edited or uploaded, and no paid provider is called.
// QA_PLAYWRIGHT, QA_BROWSER and QA_FFMPEG can override the existing local tools.
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mov=resolve(process.argv[2]||join(root,'测试集/动作视频/罗马尼亚硬拉/演示待核验/wger-video-2.mov'));
const h264=resolve(process.argv[3]||join(root,'.qa/motion-fixtures/squat.mp4'));
const ffmpeg=process.env.QA_FFMPEG||join(root,'.qa/motion-fixtures/qa-codecs/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const formatsOnly=process.env.QA_CODEC_FORMATS_ONLY==='1';
for(const file of [mov,h264,ffmpeg])await access(file);
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','motion-codec-'));
const native=promisify(execFile);
const ff=async args=>native(ffmpeg,['-hide_banner','-loglevel','error','-nostdin',...args],{windowsHide:true,maxBuffer:4*1024*1024});
const fixture=async(name,args)=>{const path=join(dataDir,name);await ff([...args,path]);return path;};
const source=['-f','lavfi','-i','color=red:s=320x180:d=2:r=15,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill','-an'];
const common=['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p'];
const base=await fixture('landscape.mp4',[...source,...common]);
const hevc=await fixture('hevc.mp4',[...source,'-c:v','libx265','-preset','ultrafast','-x265-params','log-level=error:pools=2','-pix_fmt','yuv420p10le','-tag:v','hvc1']);
const rotated=await fixture('phone-portrait.mov',['-display_rotation','90','-i',hevc,'-c','copy']);
const fixtures=[
 {name:'H.264 MP4',path:base,width:320,height:180,direct:true},
 {name:'HEVC portrait MOV',path:rotated,width:180,height:320,rotation:true},
 {name:'4K HEVC',path:await fixture('phone-4k.mp4',['-f','lavfi','-i','color=green:s=3840x2160:d=2:r=6','-an','-c:v','libx265','-preset','ultrafast','-x265-params','log-level=error:pools=2','-pix_fmt','yuv420p','-tag:v','hvc1']),ratio:16/9},
 {name:'3GP MPEG4',path:await fixture('legacy-phone.3gp',[...source,'-c:v','mpeg4','-q:v','4','-pix_fmt','yuv420p']),width:320,height:180},
 {name:'MKV HEVC',path:await fixture('hevc.mkv',['-i',hevc,'-c','copy']),width:320,height:180},
 {name:'AVI MPEG4',path:await fixture('camera.avi',[...source,'-c:v','mpeg4','-q:v','4','-pix_fmt','yuv420p']),width:320,height:180},
 {name:'M4V H264',path:await fixture('phone.m4v',['-i',base,'-c','copy']),width:320,height:180},
 {name:'WebM VP9',path:await fixture('web-video.webm',[...source,'-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8']),width:320,height:180},
 {name:'3G2 MPEG4',path:await fixture('legacy-phone.3g2',[...source,'-c:v','mpeg4','-q:v','4','-pix_fmt','yuv420p']),width:320,height:180},
 {name:'MPG MPEG2',path:await fixture('camera.mpg',[...source,'-c:v','mpeg2video','-r','25']),width:320,height:180},
 {name:'MPEG MPEG1',path:await fixture('camera.mpeg',[...source,'-c:v','mpeg1video','-r','25']),width:320,height:180},
 {name:'TS H264',path:await fixture('camera.ts',['-i',base,'-c','copy']),width:320,height:180},
 {name:'M2TS H264',path:await fixture('camera.m2ts',['-i',base,'-c','copy','-f','mpegts','-mpegts_m2ts_mode','1']),width:320,height:180},
 {name:'MTS H264',path:await fixture('camera.mts',['-i',base,'-c','copy','-f','mpegts']),width:320,height:180},
 {name:'OGV Theora',path:await fixture('web-video.ogv',['-f','lavfi','-i','testsrc2=s=320x180:d=2:r=15','-an','-c:v','libtheora','-q:v','5']),width:320,height:180},
 {name:'WMV WMV2',path:await fixture('camera.wmv',[...source,'-c:v','wmv2']),width:320,height:180},
 {name:'FLV FLV1',path:await fixture('web-video.flv',[...source,'-c:v','flv1']),width:320,height:180},
 {name:'Phone variable frame rate',path:await fixture('phone-vfr.mp4',['-f','lavfi','-i','testsrc2=s=320x180:d=2:r=30','-vf',"select='if(lt(t,1),1,not(mod(n,3)))'",'-fps_mode','vfr',...common]),width:320,height:180},
 {name:'HEVC 10-bit PQ HDR',path:await fixture('phone-pq-hdr.mp4',[...source,'-c:v','libx265','-preset','ultrafast','-x265-params','log-level=error:pools=2','-pix_fmt','yuv420p10le','-tag:v','hvc1','-color_primaries','bt2020','-color_trc','smpte2084','-colorspace','bt2020nc','-color_range','tv']),width:320,height:180},
];
const audioOnly=await fixture('audio-only.mp4',['-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','1','-c:a','aac','-vn']);
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tools/node_modules/playwright/index.mjs'))));
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({action:{name:'',exerciseId:null,status:'unknown',confidence:'low',evidenceTimes:[],evidence:''},verdict:{status:'uncertain',summary:'此模拟响应只验证视频解码与完整数据流程。'},feedback:[],limitations:['QA 模拟 AI，不评价真实动作。']})}}]}),{headers:{'Content-Type':'application/json'}})});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.addInitScript(()=>{
 window.__qaMediaCalls=[];window.__qaWorkerEvents=[];window.__qaHeld=[];window.__qaPreparedFiles=new Map();
 const Original=window.Worker;
 window.Worker=class extends Original{
  constructor(url,options){super(url,options);this.__qaUrl=String(url);window.__qaWorkerEvents.push({action:'created',url:this.__qaUrl});}
  terminate(){window.__qaWorkerEvents.push({action:'terminated',url:this.__qaUrl});return super.terminate();}
 };
});
const media=await readFile(join(root,'public/motion-media.js'),'utf8');
assert(media.includes('export async function prepareMotionVideo('));
await context.route(/\/motion-media\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:media.replace('export async function prepareMotionVideo(','async function actualPrepareMotionVideo(')+`
export async function prepareMotionVideo(file,options={}){
 const record={name:file.name,size:file.size,status:'pending'};window.__qaMediaCalls.push(record);
 if(file.name===${JSON.stringify(basename(mov))})window.__qaOriginalMov=file;
 try{
  if(window.__qaHoldPreparation){
   options.onProgress?.({stage:'decoding',progress:0,message:'QA controlled preparation delay'});
   await new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('QA preparation cancelled','AbortError'));options.signal?.addEventListener('abort',abort,{once:true});window.__qaHeld.push(()=>{options.signal?.removeEventListener('abort',abort);resolve();});if(options.signal?.aborted)abort();});
  }
  const result=await actualPrepareMotionVideo(file,options);record.status='fulfilled';record.mode=result.mode;record.sameFile=result.file===file;record.metadata=result.metadata;record.outputName=result.file.name;record.poster=result.poster?{type:result.poster.type,size:result.poster.size}:null;window.__qaPreparedFiles.set(file.name,{input:file,result});return result;
 }catch(error){record.status='rejected';record.error={name:error.name,message:error.message};throw error;}
}`}));
const video=await readFile(join(root,'public/motion-video.js'),'utf8');
await context.route(/\/motion-video\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:video.replace('export async function analyzeVideo(','async function actualAnalyzeVideo(')+'\nexport async function analyzeVideo(...args){window.__qaAnalysisInput=args[0].name;const result=await actualAnalyzeVideo(...args);window.__qaPipeline=result;return result;}'}));
const analysis=await readFile(join(root,'public/motion-analysis.js'),'utf8');
await context.route(/\/motion-analysis\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:analysis.replace('export function analyzeMotion(','function actualAnalyzeMotion(')+'\nexport function analyzeMotion(...args){const result=actualAnalyzeMotion(...args);window.__qaObservations=result;return result;}'}));
const core=await readFile(join(root,'public/vendor/ffmpeg/ffmpeg-core.js'),'utf8');
assert(core.includes('function exec(..._args){'));
await context.route(/\/vendor\/ffmpeg\/ffmpeg-core\.js(?:\?.*)?$/,route=>route.fulfill({contentType:'text/javascript',body:core.replace('function exec(..._args){','function exec(..._args){console.info("QA_FFMPEG_EXEC "+JSON.stringify(_args));')}));
const page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[],requests=[],external=[],checks=[],formatResults=[],ffmpegCommands=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{const url=request.url();requests.push({method:request.method(),url});if(/^https?:/.test(url)&&!url.startsWith(origin))external.push(url);});
page.on('console',message=>{const text=message.text();if(text.startsWith('QA_FFMPEG_EXEC ')){const args=JSON.parse(text.slice(15));ffmpegCommands.push(args);console.log('Source decoder command:',JSON.stringify(args));return;}if(['error','warning'].includes(message.type()))console.log('Browser:',text.slice(0,6000));});
const nav=async name=>{await page.locator(`.nav [data-page="${name}"]`).click();};
const ready=async()=>{
 await page.waitForFunction(()=>{const error=document.querySelector('[data-motion-error]'),name=document.querySelector('[data-motion-metadata] strong')?.textContent;return (error&&!error.hidden)||(window.__qaPreparedFiles.has(name)&&!document.querySelector('[data-motion-action="analyze"]')?.disabled);},{},{timeout:60000});
 assert.equal(await page.locator('[data-motion-error]').isVisible(),false,await page.locator('[data-motion-error]').textContent());
 return page.evaluate(()=>{const name=document.querySelector('[data-motion-metadata] strong').textContent;const prepared=window.__qaPreparedFiles.get(name).result;return {...prepared.metadata,mode:prepared.mode};});
};
const releaseHeld=async()=>page.evaluate(()=>{window.__qaHoldPreparation=false;for(const release of window.__qaHeld.splice(0))release();});
let report,motion=null,cancellation=null,analysisCancellation=null;
const progressTimer=setInterval(()=>page.evaluate(()=>({stage:document.querySelector('[data-motion-progress-title]')?.textContent,message:document.querySelector('[data-motion-progress-message]')?.textContent,progress:document.querySelector('[data-motion-percent]')?.textContent,error:document.querySelector('[data-motion-error]')?.textContent})).then(value=>console.log('Browser progress:',JSON.stringify(value))).catch(()=>{}),30000);
try{
 const registration=await context.request.post(origin+'/api/auth/register',{data:{name:'视频兼容回归',email:`codec-${Date.now()}@example.test`,password:'codec-qa-password-123'}});assert.equal(registration.status(),201);
 const {user}=await registration.json();
 assert.equal((await context.request.post(origin+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',baseVersion:0,data:{age:28,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375}}]}})).status(),200);
 const provider={id:'codec-qa',presetId:'openai',apiKey:'QA-placeholder-no-external-request',models:[{id:'qa-vision',vision:true}]};
 assert.equal((await context.request.put(origin+'/api/providers',{data:{providers:[provider],tasks:{motion:provider.id},taskModels:{motion:'qa-vision'}}})).status(),200);
 await page.goto(origin);await page.locator('#chat-input').waitFor();await nav('motion');
 if(!formatsOnly){
 console.log('Real phone MOV: prepare, complete pose analysis, and evidence');
 const started=Date.now();await page.locator('[data-motion-file]').setInputFiles(mov);const preview=await ready();
 const preparationMs=Date.now()-started;
 assert.equal(preview.mode,'software');assert(preview.width>0&&preview.height>0);assert(Math.abs(preview.duration-13.003333)<.01);
 assert.equal(await page.locator('[data-motion-metadata] strong').textContent(),basename(mov));
 assert(await page.locator('[data-motion-frame-surface]').isVisible());assert.equal(await page.locator('[data-motion-video]').getAttribute('src'),null);
 await page.screenshot({path:join(dataDir,'phone-mov-poster.png'),fullPage:true});
 const analysisStarted=Date.now();
 await page.locator('[data-motion-action="analyze"]').click();
 await page.waitForFunction(()=>{const error=document.querySelector('[data-motion-error]'),results=document.querySelector('[data-motion-results]');return (error&&!error.hidden)||(results&&!results.hidden);},{},{timeout:180000});
 const analysisMs=Date.now()-analysisStarted,evidenceStarted=Date.now();
 assert.equal(await page.locator('[data-motion-error]').isVisible(),false,await page.locator('[data-motion-error]').textContent());
 motion=await page.evaluate(async()=>{
  const pipeline=window.__qaPipeline,observations=window.__qaObservations;
  const {buildMotionEvidence}=await import('/motion-evidence.js');
  const evidence=await buildMotionEvidence(window.__qaOriginalMov,pipeline,observations);
  return {inputName:window.__qaAnalysisInput,width:pipeline.width,height:pipeline.height,duration:pipeline.duration,sampleFps:pipeline.sampleFps,frames:pipeline.frames.length,measurements:observations.measurements.length,validMeasurements:observations.quality.validFrames,decoder:pipeline.decoder,previewFrames:pipeline.previewFrames?.map(frame=>({time:frame.time,width:frame.width,height:frame.height,blobType:frame.blob?.type,blobBytes:frame.blob?.size})),matchingTimes:observations.measurements.every((row,index)=>row.frameIndex===index&&row.time===pipeline.frames[index].time),evidence:{video:evidence.video,images:evidence.images.map(image=>({time:image.time,width:image.width,height:image.height,mime:image.mimeType,jpeg:image.dataUrl.startsWith('data:image/jpeg;base64,/9j/')})),bytes:evidence.byteLength},mediaCalls:window.__qaMediaCalls};
 });
 motion.timing={preparationMs,analysisMs,evidenceMs:Date.now()-evidenceStarted,completeMs:Date.now()-started,previousTranscodeCompleteMs:147853};
 assert.equal(motion.decoder,'ffmpeg-direct');assert(motion.previewFrames.length>=50);assert(motion.previewFrames.every(frame=>frame.blobBytes>0&&frame.blobType.startsWith('image/')&&frame.width>0&&frame.height>0));
 assert.equal(motion.inputName,basename(mov));assert.equal(motion.frames,Math.ceil(motion.duration*motion.sampleFps));assert(motion.frames>=190&&motion.frames<=200);assert.equal(motion.frames,motion.measurements);assert(motion.validMeasurements>0);assert(motion.matchingTimes);
 assert.equal(motion.width,preview.width);assert.equal(motion.height,preview.height);assert.equal(motion.evidence.video.width,motion.width);assert.equal(motion.evidence.video.height,motion.height);assert(Math.abs(motion.evidence.video.duration-motion.duration)<.001);
 assert.equal(motion.evidence.images.length,6);assert(motion.evidence.images.every(image=>image.jpeg&&image.mime==='image/jpeg'&&image.width>0&&image.height>0));
 assert(motion.mediaCalls.every(call=>call.sameFile&&call.outputName===call.name),'preparation retains the original File');
 // The software view presents sampled analysis images, without creating a second video.
 await page.locator('[data-motion-frame-seek]').evaluate(input=>{input.value=String(Number(input.max)*.6);input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>Number(document.querySelector('[data-motion-frame-seek]')?.value)>7);
 assert(await page.locator('[data-motion-frame-surface]').evaluate(canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0)));
 const beforePlaying=await page.locator('[data-motion-frame-seek]').inputValue();
 await page.locator('[data-motion-frame-play]').click();await page.waitForFunction(time=>Number(document.querySelector('[data-motion-frame-seek]')?.value)>Number(time)+.2,beforePlaying);await page.locator('[data-motion-frame-play]').click();
 await page.screenshot({path:join(dataDir,'phone-mov-analysis.png'),fullPage:true});checks.push('real-phone-hevc-complete-pose-and-six-jpeg-evidence');
 console.log(JSON.stringify({phoneMov:{...preview,frames:motion.frames,measurements:motion.measurements,evidenceImages:motion.evidence.images.length,timing:motion.timing}}));
 }
 for(const test of fixtures){
  console.log('Compatibility fixture:',test.name);await page.locator('[data-motion-file]').setInputFiles(test.path);const metadata=await ready();
  assert(Math.abs(metadata.duration-2)<.16,test.name+' full duration');
  if(test.width){assert.equal(metadata.width,test.width);assert.equal(metadata.height,test.height);}
  if(test.ratio)assert(Math.abs(metadata.width/metadata.height-test.ratio)<.01);
  const prepared=await page.evaluate(name=>window.__qaMediaCalls.filter(item=>item.name===name&&item.status==='fulfilled').at(-1),basename(test.path));
  assert.equal(prepared.sameFile,true);assert.equal(prepared.outputName,basename(test.path));
  if(test.direct)assert.equal(prepared.mode,'native');
  if(test.rotation){
   const colors=await page.evaluate(async()=>{const name=document.querySelector('[data-motion-metadata] strong').textContent,prepared=window.__qaPreparedFiles.get(name).result,bitmap=prepared.mode==='software'?await createImageBitmap(prepared.poster):null;const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const context=canvas.getContext('2d');context.drawImage(bitmap||document.querySelector('[data-motion-video]'),0,0,2,2);bitmap?.close();const rgba=Array.from(context.getImageData(0,0,2,2).data);return rgba.filter((_,index)=>index%4!==3);});
   assert(colors[2]>colors[0]+100&&colors[6]>colors[8]+100,'Rotation preserves blue top/red bottom');
  }
  const tail=await page.evaluate(async()=>{
   const name=document.querySelector('[data-motion-metadata] strong').textContent,{input,result}=window.__qaPreparedFiles.get(name),duration=result.metadata.duration;
   const time=Math.max(0,(Math.ceil(duration*15)-2)/15);
   if(result.mode==='software'){
    const {readMotionSourceFrames}=await import('/motion-source.js');
    const frames=await readMotionSourceFrames(input,[0,time],{maxDimension:1280});
    const observed=[];for(const frame of frames){const bitmap=await createImageBitmap(frame.blob);observed.push({time:frame.time,width:bitmap.width,height:bitmap.height});bitmap.close();}
    if(observed.length!==2||observed[0].time!==0)throw new Error('Direct source frame selection incomplete');
    return {...observed[1],expectedTime:time};
   }
   const video=document.querySelector('[data-motion-video]');
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Tail seek timed out')),5000);video.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});video.currentTime=time;});
   const bitmap=await createImageBitmap(video);const frame={time:video.currentTime,width:bitmap.width,height:bitmap.height,expectedTime:time};bitmap.close();return frame;
  });
  assert(Math.abs(tail.time-tail.expectedTime)<.001);assert(tail.width>0&&tail.height>0);
  formatResults.push({name:test.name,...metadata,mode:prepared.mode,tail});
 }
 checks.push('mp4-direct','hevc-portrait-rotation','4k-phone','all-sixteen-file-extensions','vfr-and-pq-hdr-tail-frames');
 if(!formatsOnly){
 await page.locator('[data-motion-file]').setInputFiles(h264);await ready();
 const ordinary=await page.evaluate(name=>window.__qaMediaCalls.filter(item=>item.name===name&&item.status==='fulfilled').at(-1),basename(h264));assert.equal(ordinary.mode,'native');assert.equal(ordinary.sameFile,true);
 for(const input of [audioOnly,{name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')}]){
  console.log('Reject invalid video:',typeof input==='string'?basename(input):input.name);
  await page.locator('[data-motion-file]').setInputFiles(input);await page.locator('[data-motion-error]').waitFor({state:'visible',timeout:120000});assert(await page.locator('[data-motion-action="analyze"]').isDisabled());assert.equal(await page.locator('[data-motion-results]').isVisible(),false);
 }
 checks.push('audio-only-and-corrupt-input-rejected');
 // Cancel a real software decoder after creation, with a fresh original File.
 cancellation=await page.evaluate(async()=>{
  const {prepareMotionVideo}=await import('/motion-media.js');const source=window.__qaOriginalMov;
  const fresh=new File([source],'cancel-real.mov',{type:source.type});const controller=new AbortController();
  const before=window.__qaWorkerEvents.length;let timer;
  const interval=setInterval(()=>{if(window.__qaWorkerEvents.slice(before).some(item=>item.action==='created'&&item.url.includes('motion-source-worker'))){clearInterval(interval);controller.abort();}},5);
  timer=setTimeout(()=>controller.abort(),15000);
  try{await prepareMotionVideo(fresh,{signal:controller.signal});return {unexpectedSuccess:true};}catch(error){return {name:error.name,workers:window.__qaWorkerEvents.slice(before)};}finally{clearInterval(interval);clearTimeout(timer);}
 });
 assert.equal(cancellation.name,'AbortError');assert(cancellation.workers.some(item=>item.action==='created'&&item.url.includes('motion-source-worker')));assert(cancellation.workers.some(item=>item.action==='terminated'&&item.url.includes('motion-source-worker')));checks.push('real-source-worker-aborted-and-terminated');
 analysisCancellation=await page.evaluate(async()=>{
  const {analyzeVideo}=await import('/motion-video.js');
  const {prepareMotionVideo}=await import('/motion-media.js');
  const source=window.__qaPreparedFiles.get('phone-portrait.mov').input;
  const fresh=new File([source],'cancel-inference.mov',{type:source.type}),controller=new AbortController(),before=window.__qaWorkerEvents.length;
  let processed=0,outcome;
  try{await analyzeVideo(fresh,{signal:controller.signal,onProgress:value=>{processed=value.processedFrames??processed;if(processed>=2)controller.abort();}});outcome={unexpectedSuccess:true};}
  catch(error){outcome={name:error.name,message:error.message};}
  const next=window.__qaPreparedFiles.get('landscape.mp4').input;
  const prepared=await prepareMotionVideo(new File([next],'after-cancel.mp4',{type:next.type}));
  return {...outcome,processed,workers:window.__qaWorkerEvents.slice(before),next:{mode:prepared.mode,...prepared.metadata}};
 });
 assert.equal(analysisCancellation.name,'AbortError');assert(analysisCancellation.processed>=2);assert.equal(analysisCancellation.next.mode,'native');
 assert(analysisCancellation.workers.some(item=>item.action==='created'&&item.url.includes('/motion-worker.js')));assert(analysisCancellation.workers.some(item=>item.action==='terminated'&&item.url.includes('/motion-worker.js')));checks.push('abort-during-real-software-pose-inference-and-read-next-file');
 // Hold only these three preparations so UI lifecycle races are deterministic.
 for(const action of ['cancel','replace','navigate']){
  console.log('Preparation lifecycle:',action);await page.evaluate(()=>{window.__qaHoldPreparation=true;});await page.locator('[data-motion-file]').setInputFiles(mov);
  await page.locator('[data-motion-progress]').waitFor({state:'visible'});assert(await page.locator('[data-motion-action="analyze"]').isDisabled());
  if(action==='cancel'){
   await page.locator('[data-motion-action="cancel"]').click();await releaseHeld();await page.locator('[data-motion-progress]').waitFor({state:'hidden'});assert(await page.locator('[data-motion-action="analyze"]').isDisabled());
  }else if(action==='replace'){
   await page.evaluate(()=>{window.__qaHoldPreparation=false;});await page.locator('[data-motion-file]').setInputFiles(h264);await ready();await releaseHeld();assert.equal(await page.locator('[data-motion-metadata] strong').textContent(),basename(h264));
  }else{
   await nav('library');await releaseHeld();assert.equal(await page.locator('.motion-page').count(),0);await nav('motion');assert(await page.locator('[data-motion-action="analyze"]').isDisabled());
  }
  assert.equal(await page.locator('[data-motion-results]').isVisible(),false);
 }
 checks.push('preparation-cancel-replace-navigation-no-stale-result');
 }
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 assert.equal(requests.filter(item=>item.method==='POST'&&/\/api\/attachments/.test(item.url)).length,0);
 assert(requests.some(item=>item.url.includes('motion-source-worker')));assert(!requests.some(item=>item.url.includes('motion-transcode')));
 assert(ffmpegCommands.length>0);assert(ffmpegCommands.every(args=>!args.some(value=>/libx264|compatible\.mp4|h264_nvenc/.test(String(value)))),'direct source decoding must not encode an H.264 copy');
 checks.push('local-source-decoding-no-video-encoding-no-upload-no-ai');
 report={dataDir,checks,motion,formats:formatResults,cancellation,analysisCancellation,errors,external,ffmpegCommands,resources:requests.filter(item=>/motion-source|ffmpeg/.test(item.url)).map(item=>item.url.replace(origin,''))};
 await writeFile(join(dataDir,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({dataDir,checks,formats:formatResults,errors,external},null,2));
}catch(error){await page.screenshot({path:join(dataDir,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(dataDir,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,errors,external,formatResults,ffmpegCommands,motion,browser:await page.evaluate(()=>({mediaCalls:window.__qaMediaCalls,workers:window.__qaWorkerEvents,error:document.querySelector('[data-motion-error]')?.textContent,progress:document.querySelector('[data-motion-progress-message]')?.textContent})).catch(()=>null)},null,2));console.error('Codec QA artifacts:',dataDir);throw error;}
finally{clearInterval(progressTimer);await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
