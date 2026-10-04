// Real RTMW-L, decoder pixels, complete data, image extraction and app UI.
// The visual AI is a local mock: this checks integration, never coaching accuracy.
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../server.mjs';
import {validateMotionCoachRequest} from '../server/motion-coach.mjs';
import {decodeMotionCoachBlock} from '../server/motion-coach-batches.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','motion-onnx-'));
const ffmpeg=process.env.QA_FFMPEG||join(root,'.qa/motion-fixtures/qa-codecs/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
await access(ffmpeg);
const clip=join(dataDir,'squat-one-second.mp4');
await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',resolve(process.argv[2]||join(root,'.qa/motion-fixtures/squat.mp4')),'-t','1','-an','-vf','scale=480:-2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',clip],{windowsHide:true});
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tools/node_modules/playwright/index.mjs'))));
const workerSource=await readFile(join(root,'public/motion-worker.js'),'utf8');
const mediaSource=await readFile(join(root,'public/motion-media.js'),'utf8');
const videoSource=await readFile(join(root,'public/motion-video.js'),'utf8');
const aiCalls=[];
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async(url,options)=>{
 assert(new URL(url).pathname.endsWith('/chat/completions'));
 const request=JSON.parse(options.body),content=request.messages.find(message=>message.role==='user').content;
 const input=JSON.parse(typeof content==='string'?content:content[0].text);
 const images=Array.isArray(content)?content.filter(part=>part.type==='image_url'):[];
 aiCalls.push({input,imageCount:images.length,imageBytes:images.reduce((sum,item)=>sum+Buffer.from(item.image_url.url.split(',')[1],'base64').length,0)});
 const times=input.frames.map(frame=>frame.time);
 const output={action:{exerciseId:'squat',name:'徒手深蹲',family:'squat',status:'identified',confidence:'high',evidenceTimes:times.slice(0,2),evidence:'两帧可见同一训练者屈膝下蹲并起身。'},verdict:{status:'needs-improvement',summary:'这组动作需要调整，请先改善躯干控制。'},feedback:[],limitations:['这是本地 QA 模拟视觉响应，不是对真实动作的评价。']};
 if(input.stage==='full-data'||input.stage==='temporal-evidence'||input.stage==='visual-keyframes'){
  if(times.length)output.feedback.push({title:'下一组保持躯干控制',status:'improve',source:'visual',evidenceTimes:[times[0]],evidence:'测试画面中可见躯干位置变化。',correction:'下一组降低负重，收紧腹部并缓慢完成动作。',priority:1});
  const indices=input.evidence?.sourceFrameIndices||input.data?.frameIndices||[];
  if(indices.length)output.feedback.push({title:'保持肩髋同步',status:'improve',source:'pose',frameIndices:indices.slice(0,2),evidence:'骨架记录了肩髋位置随时间变化。',correction:'下一组让肩髋平稳同步移动。',priority:2});
 }else if(input.stage==='synthesis')output.feedback=input.data.reviewedParts.flatMap(part=>part.report.feedback||[]).slice(0,3);
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}),{headers:{'Content-Type':'application/json'}});
}});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
let cases=[
 {name:'webcodecs-cpu-fallback',decoder:'webcodecs'},
 {name:'html-video-cpu-fallback',decoder:'html-video',fail:'prepare-mp4'},
 {name:'software-cpu-fallback',decoder:'ffmpeg-direct',software:true},
 {name:'ui-cpu',decoder:'webcodecs',ui:true},
 {name:'webcodecs-auto-backend',decoder:'webcodecs',automatic:true},
];
if(process.env.QA_ONNX_CASE)cases=cases.filter(config=>config.name===process.env.QA_ONNX_CASE);
assert(cases.length,'QA_ONNX_CASE must name an existing case');
const results=[];
try{
 for(const config of cases){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[],external=[],assets=[],requests=[];let uiBody;
  const callStart=aiCalls.length;
  context.on('request',request=>{
   const url=request.url();requests.push({url,method:request.method()});
   if(/^https?:/.test(url)&&new URL(url).origin!==origin)external.push(url);
   if(/\.onnx(?:\?|$)/.test(url))assets.push(url);
   if(request.method()==='POST'&&/\/api\/motion\/coach/.test(url))uiBody=request.postDataJSON();
  });
  await context.addInitScript(()=>{
   const canvasPrototype=CanvasRenderingContext2D.prototype,clearRect=canvasPrototype.clearRect,arc=canvasPrototype.arc;
   canvasPrototype.clearRect=function(...args){if(this.canvas.matches('[data-motion-canvas]'))window.__qaMotionOverlayArcs=[];return clearRect.apply(this,args);};
   canvasPrototype.arc=function(...args){if(this.canvas.matches('[data-motion-canvas]'))(window.__qaMotionOverlayArcs??=[]).push(args.slice(0,3));return arc.apply(this,args);};
   const Native=window.Worker;window.__qaWorkers=[];
   window.Worker=class extends Native{
    constructor(url,options){super(url,options);this.qa={url:String(url),terminated:0,messages:[],responses:[]};window.__qaWorkers.push(this.qa);this.addEventListener('message',({data})=>{if(!data.type||data.error)this.qa.responses.push({id:data.id,error:data.error,delegate:data.delegate});});}
    postMessage(message,...args){this.qa.messages.push({type:message.type,delegate:message.delegate,model:message.model});return super.postMessage(message,...args);}
    terminate(){this.qa.terminated++;return super.terminate();}
   };
  });
  await context.route('**/motion-worker.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:workerSource+`\nconst qaActualHandler=self.onmessage;self.onmessage=event=>{if((${!config.automatic}&&event.data.type==='init'&&event.data.delegate==='GPU')||event.data.type===${JSON.stringify(config.fail||'none')})self.postMessage({id:event.data.id,error:'QA: forced GPU/parser unavailability'});else qaActualHandler(event);};`});});
  if(config.software)await context.route('**/motion-media.js',async route=>{const response=await route.fetch();const original='metadata = await readPlayableMetadata(file, signal);';assert(mediaSource.includes(original));await route.fulfill({response,body:mediaSource.replace(original,'throw Object.assign(new Error("QA: forced software codec"), {code:"MOTION_VIDEO_DECODE"});')});});
  if(config.ui)await context.route('**/motion-video.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:videoSource.replace('export async function analyzeVideo(','async function qaActualAnalyzeVideo(')+'\nexport async function analyzeVideo(...args){const output=await qaActualAnalyzeVideo(...args);window.__qaMotionOutput=output;return output;}'});});
  try{
   const registration=await context.request.post(origin+'/api/auth/register',{data:{name:'RTMW视觉流程验证',email:`rtmw-${config.name}-${Date.now()}@example.test`,password:'rtmw-qa-password-123'}});
   assert.equal(registration.status(),201);const {user}=await registration.json();
   assert.equal((await context.request.post(origin+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',baseVersion:0,data:{age:28,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375}}]}})).status(),200);
   const provider={id:'rtmw-qa',presetId:'openai',apiKey:'QA-placeholder-never-sent-externally',models:[{id:'qa-vision',vision:true},{id:'qa-text',vision:false}]};
   const configure=async model=>assert.equal((await context.request.put(origin+'/api/providers',{data:{providers:[provider],tasks:{motion:provider.id},taskModels:{motion:model}}})).status(),200);
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   const response=await page.goto(origin),csp=response.headers()['content-security-policy'];assert(csp?.includes("default-src 'self'"));assert(csp.includes("worker-src 'self'"));
   if(config.ui){
    await page.locator('#chat-input').waitFor();await page.locator('.nav [data-page="motion"]').click();
    await page.locator('[data-motion-file]').setInputFiles(clip);await page.waitForFunction(()=>document.querySelector('[data-motion-metadata]')?.textContent.includes('squat-one-second.mp4'));
    assert.equal(await page.locator('[data-motion-action="analyze"]').isDisabled(),true,'Unconfigured visual AI blocks analysis');
    await configure('qa-text');await page.reload();await page.locator('#chat-input').waitFor();await page.locator('.nav [data-page="motion"]').click();
    await page.locator('[data-motion-file]').setInputFiles(clip);await page.waitForFunction(()=>document.querySelector('[data-motion-metadata]')?.textContent.includes('squat-one-second.mp4'));
    assert.equal(await page.locator('[data-motion-action="analyze"]').isDisabled(),true,'Text-only AI blocks analysis');
   }
   await configure('qa-vision');await page.reload();await page.locator('#chat-input').waitFor();
   await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='qa-rtmw-file';input.hidden=true;document.body.append(input);});
   await page.locator('#qa-rtmw-file').setInputFiles(clip);
   console.log(`Analyze ${config.name}: real RTMW-L and local mock visual AI`);const started=Date.now();
   if(config.ui){
    await page.locator('.nav [data-page="motion"]').click();
    assert.equal(await page.locator('[data-motion-quality],[data-motion-ai-mode],[data-motion-recognition]').count(),0);
    await page.locator('[data-motion-file]').setInputFiles(clip);await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]')?.disabled);
    await page.screenshot({path:join(dataDir,'ui-desktop-before.png'),fullPage:true});
    await page.locator('[data-motion-action="analyze"]').click();
    await page.locator('.motion-coach-evaluation').waitFor({timeout:300000});
    assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'needs-improvement');
    assert.match(await page.locator('.motion-ai-feedback').textContent(),/降低负重|肩髋/);
    assert.equal(await page.locator('.motion-score,.motion-checks,.motion-reps,.motion-metric-section').count(),0);
    await page.locator('[data-motion-video]').evaluate(video=>{video.currentTime=.3;});
    await page.waitForFunction(()=>!document.querySelector('[data-motion-video]').seeking);
    const overlay=await page.evaluate(async()=>{
     const {buildMotionOverlay}=await import('/motion-overlay.js');
     const {buildSmoothedMotionFrames}=await import('/motion-smoothing.js');
     const video=document.querySelector('[data-motion-video]'),canvas=document.querySelector('[data-motion-canvas]');
     video.dispatchEvent(new Event('timeupdate'));
     const frames=buildSmoothedMotionFrames(window.__qaMotionOutput.frames,window.__qaMotionOutput);
     const frame=frames.toSorted((a,b)=>Math.abs(a.time-video.currentTime)-Math.abs(b.time-video.currentTime))[0];
     const expected=buildMotionOverlay(frame.wholebodyLandmarks,canvas.width,canvas.height);
     return {groups:Object.fromEntries(['body','face','leftHand','rightHand'].map(group=>[group,expected.points.filter(point=>point.group===group).length])),actual:window.__qaMotionOverlayArcs,expected:expected.points.map(point=>[point.x,point.y,point.radius])};
    });
    assert.deepEqual(overlay.groups,{body:17,face:0,leftHand:0,rightHand:0},'Default playback uses only 17 useful body joints');
    assert.deepEqual(overlay.actual,overlay.expected,'Playback draws 17 smoothed body joints aligned with the displayed frame');
    await page.locator('[data-motion-player]').screenshot({path:join(dataDir,'ui-body17-overlay.png')});
    await page.screenshot({path:join(dataDir,'ui-desktop-result.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:join(dataDir,'ui-mobile-result.png'),fullPage:true});
    await page.locator('[data-motion-action="save"]').click();await page.waitForFunction(()=>document.querySelector('[data-motion-action="save"]')?.textContent==='已保存报告');
    await page.locator('#sync-status').click();
   }
   const output=await page.evaluate(async({reuseUI})=>{
    const {analyzeVideo}=await import('/motion-video.js');const {analyzeMotion}=await import('/motion-analysis.js');
    const {buildMotionPoseData,buildFullMotionAnalysis}=await import('/motion-pose-data.js');const {buildMotionEvidence}=await import('/motion-evidence.js');
    const {buildMotionAssessmentReport,validateMotionAssessmentSize}=await import('/motion-view.js');const {mergeCoachAssessment}=await import('/motion-contract.js');
    const file=document.querySelector('#qa-rtmw-file').files[0],pipeline=reuseUI?window.__qaMotionOutput:await analyzeVideo(file);
    const observations=analyzeMotion(pipeline.frames,pipeline);
    let body,report;
    if(!reuseUI){
     const evidence=await buildMotionEvidence(file,pipeline,observations);
     body={duration:pipeline.duration,analysis:evidence.summary,poseData:buildMotionPoseData(pipeline),fullAnalysis:buildFullMotionAnalysis(observations,pipeline),keyframes:evidence.images.map(({time,mimeType,dataUrl,imageTime})=>({time,mimeType,data:dataUrl.slice(dataUrl.indexOf(',')+1),imageTime}))};
     const response=await fetch('/api/motion/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
     if(!response.ok)throw new Error(`Coach HTTP ${response.status}: ${await response.text()}`);
     report=buildMotionAssessmentReport(mergeCoachAssessment(observations,await response.json()),{file,pipeline});validateMotionAssessmentSize(report);
    }
    const observed=pipeline.frames.filter(frame=>frame.wholebodyLandmarks.length===133);
    return{body,report,stats:{decoder:pipeline.decoder,delegate:pipeline.delegate,modelVersion:pipeline.modelVersion,sampleFps:pipeline.sampleFps,frames:pipeline.frames.length,expectedFrames:Math.ceil(pipeline.duration*pipeline.sampleFps),observedFrames:observed.length,
     pointsIntact:observed.every(frame=>frame.landmarks.length===33&&frame.landmarks.some(point=>point===null)&&frame.landmarks.every(point=>point===null||!Object.hasOwn(point,'z')&&!Object.hasOwn(point,'presence'))&&(!frame.worldLandmarks||frame.worldLandmarks.length===0)&&frame.wholebodyLandmarks.every(point=>['x','y','score'].every(field=>Number.isFinite(point[field])))),hasRecognition:Object.hasOwn(pipeline,'actionRecognition'),workers:window.__qaWorkers}};
   },{reuseUI:!!config.ui});
   if(config.ui){output.body=uiBody;const state=await context.request.get(origin+'/api/state');assert.equal(state.status(),200);output.report=(await state.json()).records.find(record=>record.kind==='motion-assessment')?.data;assert(output.report);}
   assert.equal(output.stats.decoder,config.decoder);assert(['CPU','GPU'].includes(output.stats.delegate));if(!config.automatic)assert.equal(output.stats.delegate,'CPU');
   assert.match(output.stats.modelVersion,/RTMW-L/);assert.equal(output.stats.frames,output.stats.expectedFrames);assert(output.stats.observedFrames>=8);assert(output.stats.pointsIntact);assert.equal(output.stats.hasRecognition,false);
   assert.equal(output.body.poseData.schemaVersion,config.ui?3:2);assert.equal(output.body.poseData.frames.length,output.stats.frames);assert(output.body.fullAnalysis.quality.validFrames>0);assert(output.body.keyframes.length>=2&&output.body.keyframes.length<=6);
   validateMotionCoachRequest(JSON.parse(JSON.stringify(output.body)));
   assert.equal(output.report.coach.verdict.status,'needs-improvement');assert.equal(output.report.coach.mode,'visual');assert.equal(output.report.coach.coverage.reviewedFrameCount,config.ui?0:output.stats.frames);
   assert(!JSON.stringify(output.report).includes('wholebodyLandmarks'));assert(!Object.hasOwn(output.report.analysis,'actionRecognition'));
   const calls=aiCalls.slice(callStart),full=calls.filter(call=>call.input.stage==='full-data');
   if(config.ui){
    assert.equal(output.stats.sampleFps,7.5);
    assert.equal(output.body.reviewMode,'efficient');assert.equal(output.body.poseData.format,'rtmw-body17-full');
    assert.equal(calls.length,1);assert.equal(calls[0].input.stage,'visual-keyframes');
    assert.equal(calls[0].imageCount,output.body.keyframes.length);
    assert.equal(output.report.coach.coverage.sourceFrameCount,output.stats.frames);
    assert.equal(output.report.coach.coverage.strategy,'visual-keyframes');
    assert(!JSON.stringify(calls[0].input).includes('measurements'),'visual-first review does not let projection angles bias visual findings');
   }else{
   assert.equal(new Set(full.flatMap(call=>call.input.data.frameIndices)).size,output.stats.frames,'Every sampled pose frame reaches AI');
   assert.equal(full[0].imageCount,output.body.keyframes.length,'All extracted images reach AI');assert(full.slice(1).every(call=>call.imageCount===0));
   assert(JSON.stringify(full.map(call=>call.input)).includes('wholebodyLandmarks'),'AI receives all 133-point data');
   const poseBlocks=full.flatMap(call=>call.input.data.blocks).filter(block=>block.path[0]==='poseData'&&block.path[1]==='frames'&&Number.isInteger(block.path[2])).map(decodeMotionCoachBlock);
   assert.equal(poseBlocks.length,output.stats.frames);
   for(const block of poseBlocks)assert.deepEqual(block.value,output.body.poseData.frames[block.path[2]],'Each complete 133-point frame reaches AI without value loss');
   }
   if(!config.ui){const id=`motion:rtmw-qa-${config.name}`;assert.equal((await context.request.post(origin+'/api/sync',{data:{userId:user.id,changes:[{id,kind:'motion-assessment',baseVersion:0,data:output.report}]}})).status(),200);const state=await context.request.get(origin+'/api/state');assert.deepEqual((await state.json()).records.find(record=>record.id===id)?.data,output.report);}
   const workers=output.stats.workers.filter(item=>item.url.includes('motion-worker.js'));assert(workers.length>=(config.automatic?1:2));assert(workers.every(item=>item.terminated>=1));
   for(const asset of ['rtmw-l-384x288.onnx','yolox-tiny-humanart.onnx'])assert(assets.some(url=>url.endsWith(asset)),asset);
   assert(!requests.some(request=>/mediapipe|stgcn|\.task(?:\?|$)/i.test(request.url)),'Only required RTMW assets are requested');
   assert(!workers.some(worker=>worker.messages.some(message=>message.type==='classify')));
   if(config.name==='webcodecs-cpu-fallback'){
    const cancelled=await page.evaluate(async()=>{const {analyzeVideo}=await import('/motion-video.js');const controller=new AbortController(),before=window.__qaWorkers.length;let status='resolved',frames=0;try{await analyzeVideo(document.querySelector('#qa-rtmw-file').files[0],{signal:controller.signal,onProgress(event){if(event.stage==='analyzing'){frames++;controller.abort();}}});}catch(error){status=error.name;}return{status,frames,workers:window.__qaWorkers.slice(before)};});
    assert.equal(cancelled.status,'AbortError');assert.equal(cancelled.frames,1);assert(cancelled.workers.every(worker=>worker.terminated>=1));output.stats.cancelled=cancelled;
   }
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(!requests.some(request=>request.method==='POST'&&/\/api\/attachments/.test(request.url)));
   results.push({case:config.name,wallMs:Date.now()-started,...output.stats,imageCount:output.body.keyframes.length,aiCalls:calls.length,assets:[...new Set(assets)],csp});
   await writeFile(join(dataDir,config.name+'-request.json'),JSON.stringify(output.body));await writeFile(join(dataDir,'results.json'),JSON.stringify({results},null,2));
   console.log(JSON.stringify({case:config.name,frames:output.stats.frames,delegate:output.stats.delegate,images:output.body.keyframes.length,wallMs:results.at(-1).wallMs}));
  }finally{await context.close();}
 }
 console.log('RTMW QA artifacts:',dataDir);
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
