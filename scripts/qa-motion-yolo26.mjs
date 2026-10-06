// Real YOLO26s-Pose pixels and all three decoder paths; local mock visual AI.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../server.mjs';
import {validateMotionCoachRequest} from '../server/motion-coach.mjs';
import {MOTION_YOLO_BODY_LANDMARK_INDICES} from '../public/motion-pose-data.js';
import {getMotionPoseModel} from '../public/motion-models.js';
const root=resolve(import.meta.dirname,'..');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa/motion-yolo26-'));
const clip=join(dataDir,'squat.mp4');
await promisify(execFile)(process.env.QA_FFMPEG||join(root,'.qa/motion-fixtures/qa-codecs/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'),['-hide_banner','-loglevel','error','-nostdin','-i',join(root,'.qa/motion-fixtures/squat.mp4'),'-t','1','-an','-vf','scale=480:-2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',clip],{windowsHide:true});
const {chromium}=await import(pathToFileURL(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tools/node_modules/playwright/index.mjs')));
const calls=[];
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async(url,options)=>{
 const request=JSON.parse(options.body),content=request.messages.find(item=>item.role==='user').content;
 const input=JSON.parse(content[0].text);calls.push(input);
 const output=input.stage==='recognize-action'?{action:{exerciseId:'squat',name:'徒手深蹲',status:'identified',confidence:'high',imageIndices:[0],evidence:'QA 模拟：双脚支撑，屈髋屈膝后起身。'}}:{selectionCheck:{status:'consistent',imageIndices:[0],evidence:'QA 模拟：图片与选择一致。'},verdict:{status:'needs-improvement',summary:'QA 模拟动作评价'},feedback:[{title:'控制动作',status:'improve',source:'visual',imageIndices:[0],evidenceTimes:[input.frames[0].time],evidence:'QA 模拟画面观察。',correction:'QA 模拟建议。'}],limitations:['仅测试流程，不评价真实动作。']};
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}),{headers:{'Content-Type':'application/json'}});
}});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results=[];
try{
 for(const scenario of ['webcodecs','html-video','ffmpeg-direct','webcodecs-auto']){
  const decoder=scenario==='webcodecs-auto'?'webcodecs':scenario, automatic=scenario==='webcodecs-auto';
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}});
  const requests=[],errors=[];context.on('request',r=>requests.push(r.url()));
  // Force CPU fallback, retaining real YOLO26 inference. Force only the
  // decoder boundary so the same source pixels exercise each production path.
  await context.route('**/motion-worker.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nconst actual=self.onmessage;self.onmessage=event=>{if(${!automatic}&&event.data.type==='init'&&event.data.delegate==='GPU'||${JSON.stringify(decoder)}==='html-video'&&event.data.type==='prepare-mp4')self.postMessage({id:event.data.id,error:'QA forced fallback'});else actual(event);};`});});
  if(decoder==='ffmpeg-direct')await context.route('**/motion-media.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('metadata = await readPlayableMetadata(file, signal);','throw Object.assign(new Error("QA software codec"),{code:"MOTION_VIDEO_DECODE"});')});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const registration=await context.request.post(origin+'/api/auth/register',{data:{name:'模型测试',email:`${scenario}@example.test`,password:'yolo26-qa-password'}});assert.equal(registration.status(),201);
  const current=await (await context.request.get(origin+'/api/providers')).json();
  assert.equal((await context.request.put(origin+'/api/providers',{data:{version:current.version,providers:[{id:'qa',presetId:'openai',apiKey:'local-mock',models:[{id:'qa-vision',vision:true}]}],tasks:{motion:'qa'},taskModels:{motion:'qa-vision'}}})).status(),200);
  await page.route(origin+'/qa-motion',async route=>{const response=await context.request.get(origin);await route.fulfill({response,body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/motion.css"></head><body><input id="fixture" type="file" hidden><div id="motion"></div></body></html>'});});
  await page.goto(origin+'/qa-motion');
  await page.locator('#fixture').setInputFiles(clip);
  const output=await page.evaluate(async()=>{
   const {analyzeVideo}=await import('/motion-video.js');
   const {analyzeMotion}=await import('/motion-analysis.js');
   const {buildMotionPoseData,buildFullMotionAnalysis}=await import('/motion-pose-data.js');
   const {buildMotionEvidence}=await import('/motion-evidence.js');
   const file=document.querySelector('#fixture').files[0];
   const pipeline=await analyzeVideo(file,{model:'yolo26',sampleFps:7.5});
   const observations=analyzeMotion(pipeline.frames,pipeline),evidence=await buildMotionEvidence(file,pipeline,observations);
   const body={duration:pipeline.duration,selectedExerciseId:'squat',reviewMode:'guided',analysis:evidence.summary,poseData:buildMotionPoseData(pipeline,{bodyOnly:true}),fullAnalysis:buildFullMotionAnalysis(observations,pipeline),keyframes:evidence.images.map(({time,mimeType,dataUrl,imageTime})=>({time,mimeType,data:dataUrl.split(',')[1],imageTime}))};
   const response=await fetch('/api/motion/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!response.ok)throw Error(await response.text());
   return {decoder:pipeline.decoder,delegate:pipeline.delegate,modelVersion:pipeline.modelVersion,timing:pipeline.timing,frames:pipeline.frames.length,
     observations:pipeline.frames.map(({time,personCount,landmarks})=>({time,personCount,landmarks})),
     observed:pipeline.frames.filter(frame=>frame.landmarks.filter(Boolean).length>=8).length,body,coach:await response.json()};
  });
  assert.equal(output.decoder,decoder);if(!automatic)assert.equal(output.delegate,'CPU');assert.equal(output.frames,8);assert(output.observed>0);
  assert.equal(output.modelVersion,getMotionPoseModel('yolo26').version);
  assert.equal(output.body.poseData.schemaVersion,5);assert.equal(output.body.poseData.format,'yolo26-body13-full');
  assert.deepEqual(output.body.poseData.retainedLandmarkIndices,MOTION_YOLO_BODY_LANDMARK_INDICES);
  validateMotionCoachRequest(output.body);assert.equal(output.coach.mode,'guided');
  for(const [index,frame] of output.observations.entries()){
   assert.equal(frame.time,index/7.5);assert([0,33].includes(frame.landmarks.length));
   if(frame.landmarks.length){
    assert(frame.personCount>=1);
    for(const missing of [17,18,19,20,21,22,29,30,31,32])assert.equal(frame.landmarks[missing],null,'YOLO cannot supply fingers, heels or toes');
    for(const point of frame.landmarks.filter(Boolean)){
     assert(Number.isFinite(point.x)&&Number.isFinite(point.y));
     assert(point.visibility>=.25&&point.visibility<=1,'Real keypoint confidences remain bounded');
     assert.equal(point.z,undefined,'YOLO is an image-plane model');
    }
   }
  }
  for(const frame of output.body.poseData.frames)for(const [index,point] of frame.landmarks.entries())
   if(!MOTION_YOLO_BODY_LANDMARK_INDICES.includes(index))assert.equal(point,null);
  const assertOnlyYolo=()=>{
   const graphs=[...new Set(requests.filter(url=>/\.(?:onnx|task)(?:\?|$)/.test(url)).map(url=>new URL(url).pathname))];
   assert.deepEqual(graphs,['/vendor/yolo26/yolo26s-pose.onnx']);
   assert(!requests.some(url=>/\/vendor\/(?:rtmw|mediapipe)\//.test(url)));
   assert(requests.every(url=>new URL(url).origin===origin));
  };
  assertOnlyYolo();assert.deepEqual(errors,[]);
  if(scenario==='webcodecs'){
   await page.evaluate(async()=>{
    const {mountMotionView}=await import('/motion-view.js');
    window.qaReviews=[];window.qaSaved=[];
    mountMotionView(document.querySelector('#motion'),{getCoachConfiguration:()=>({configured:true,vision:true}),listAssessments:async()=>[],saveAssessment:async report=>{window.qaSaved.push(report);return report;},reviewAssessment:async body=>{window.qaReviews.push(body);const response=await fetch('/api/motion/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());return response.json();}});
   });
   assert.equal(await page.locator('[data-motion-pose-model]').inputValue(),'mediapipe-full');
   await page.locator('[data-motion-pose-model]').selectOption('yolo26');
   await page.locator('[data-motion-file]').setInputFiles(clip);
   await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]').disabled);
   await page.locator('[data-motion-action="analyze"]').click();await page.locator('[data-motion-confirmation]').waitFor({timeout:120000});
   assert.equal(await page.locator('[data-motion-exercise]').inputValue(),'squat');
   assert.equal(await page.evaluate(()=>window.qaReviews.length),1);assert.equal(await page.evaluate(()=>window.qaReviews[0].reviewMode),'recognize');
   assert.equal(await page.locator('[data-motion-action="save"]').count(),0);
   await page.locator('[data-motion-action="confirm-exercise"]').click();await page.locator('.motion-coach-evaluation').waitFor({timeout:120000});
   assert.equal(await page.evaluate(()=>window.qaReviews.length),2);assert.equal(await page.evaluate(()=>window.qaReviews[1].reviewMode),'guided');
   assert.equal(await page.evaluate(()=>window.qaReviews[0].poseData.format),'yolo26-body13-full');
   assert.equal(await page.evaluate(()=>window.qaReviews[0].poseData.schemaVersion),5);
   await page.locator('[data-motion-action="save"]').click();await page.waitForFunction(()=>window.qaSaved.length===1);
   assert.match(await page.evaluate(()=>window.qaSaved[0].analysis.modelVersion),/YOLO26s-Pose/);
   await page.addStyleTag({url:origin+'/motion.css'});await page.screenshot({path:join(dataDir,'yolo26-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(dataDir,'yolo26-mobile.png'),fullPage:true});
   await page.locator('[data-motion-pose-model]').selectOption('rtmw');assert(await page.locator('[data-motion-results]').isHidden());assert.equal(await page.locator('[data-motion-action="analyze"]').textContent(),'分析视频并识别动作');
   const callCount=calls.length;
   const cancellation=await page.evaluate(async()=>{
    const {analyzeVideo}=await import('/motion-video.js'),NativeWorker=window.Worker,active=new Set();
    let processed=0,terminated=0;
    window.Worker=class extends NativeWorker{
     constructor(url,options){super(url,options);if(String(url).endsWith('/motion-worker.js'))active.add(this);}
     terminate(){if(active.delete(this))terminated++;return super.terminate();}
    };
    const abort=new AbortController();
    try{
     await analyzeVideo(document.querySelector('#fixture').files[0],{model:'yolo26',sampleFps:3,signal:abort.signal,
      onProgress:progress=>{if(progress.stage==='analyzing'){processed++;abort.abort();}}});
     throw Error('Cancelled inference unexpectedly completed');
    }catch(error){return {name:error.name,processed,terminated,activeWorkers:active.size};}
    finally{window.Worker=NativeWorker;}
   });
   assert.equal(cancellation.name,'AbortError');assert.equal(cancellation.processed,1);
   assert(cancellation.terminated>=1);assert.equal(cancellation.activeWorkers,0);assert.equal(calls.length,callCount);
   output.cancellation=cancellation;
  }
  assertOnlyYolo();assert.deepEqual(errors,[]);
  results.push({scenario,decoder,delegate:output.delegate,frames:output.frames,observed:output.observed,format:output.body.poseData.format,timing:output.timing,cancellation:output.cancellation});console.log(results.at(-1));
  await context.close();
 }
 assert.equal(calls.length,6);
 await writeFile(join(dataDir,'results.json'),JSON.stringify({passed:true,scope:'Real YOLO26s-Pose graph, video pixels, decoder paths, UI selection/save and cancellation. Vision AI is a local fixture; this does not measure form-assessment accuracy.',results,calls:calls.length},null,2));console.log(dataDir);
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
