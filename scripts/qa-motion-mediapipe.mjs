// Real MediaPipe Full pixels and all three decoder paths; local mock visual AI.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../server.mjs';
import {validateMotionCoachRequest} from '../server/motion-coach.mjs';
const root=resolve(import.meta.dirname,'..');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa/motion-mediapipe-'));
const clip=join(dataDir,'squat.mp4');
await promisify(execFile)(process.env.QA_FFMPEG||join(root,'.qa/motion-fixtures/qa-codecs/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'),['-hide_banner','-loglevel','error','-nostdin','-i',join(root,'.qa/motion-fixtures/squat.mp4'),'-t','1','-an','-vf','scale=480:-2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',clip],{windowsHide:true});
const {chromium}=await import(pathToFileURL(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tools/node_modules/playwright/index.mjs')));
const calls=[];
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async(url,options)=>{
 const request=JSON.parse(options.body),content=request.messages.find(item=>item.role==='user').content;
 const input=JSON.parse(content[0].text);calls.push(input);
 const output={selectionCheck:{status:'consistent',imageIndices:[0],evidence:'QA 模拟：图片与选择一致。'},verdict:{status:'needs-improvement',summary:'QA 模拟动作评价'},feedback:[{title:'控制动作',status:'improve',source:'visual',imageIndices:[0],evidenceTimes:[input.frames[0].time],evidence:'QA 模拟画面观察。',correction:'QA 模拟建议。'}],limitations:['仅测试流程，不评价真实动作。']};
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
  // Force CPU fallback, retaining real MediaPipe inference. Force only the
  // decoder boundary so the same source pixels exercise each production path.
  await context.route('**/motion-worker.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nconst actual=self.onmessage;self.onmessage=event=>{if(${!automatic}&&event.data.type==='init'&&event.data.delegate==='GPU'||${JSON.stringify(decoder)}==='html-video'&&event.data.type==='prepare-mp4')self.postMessage({id:event.data.id,error:'QA forced fallback'});else actual(event);};`});});
  if(decoder==='ffmpeg-direct')await context.route('**/motion-media.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('metadata = await readPlayableMetadata(file, signal);','throw Object.assign(new Error("QA software codec"),{code:"MOTION_VIDEO_DECODE"});')});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const registration=await context.request.post(origin+'/api/auth/register',{data:{name:'模型测试',email:`${scenario}@example.test`,password:'mediapipe-qa-password'}});assert.equal(registration.status(),201);
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
   const pipeline=await analyzeVideo(file,{model:'mediapipe-full',sampleFps:7.5});
   const observations=analyzeMotion(pipeline.frames,pipeline),evidence=await buildMotionEvidence(file,pipeline,observations);
   const body={duration:pipeline.duration,selectedExerciseId:'squat',reviewMode:'guided',analysis:evidence.summary,poseData:buildMotionPoseData(pipeline,{bodyOnly:true}),fullAnalysis:buildFullMotionAnalysis(observations,pipeline),keyframes:evidence.images.map(({time,mimeType,dataUrl,imageTime})=>({time,mimeType,data:dataUrl.split(',')[1],imageTime}))};
   const response=await fetch('/api/motion/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!response.ok)throw Error(await response.text());
   return {decoder:pipeline.decoder,delegate:pipeline.delegate,frames:pipeline.frames.length,observed:pipeline.frames.filter(frame=>frame.landmarks.length===33).length,body,coach:await response.json()};
  });
  assert.equal(output.decoder,decoder);if(!automatic)assert.equal(output.delegate,'CPU');assert.equal(output.frames,8);assert(output.observed>0);
  assert.equal(output.body.poseData.format,'mediapipe-body17-full');validateMotionCoachRequest(output.body);assert.equal(output.coach.mode,'guided');
  assert(!requests.some(url=>/\.onnx(?:\?|$)/.test(url)));assert(requests.some(url=>url.endsWith('/pose_landmarker_full.task')));assert(requests.every(url=>new URL(url).origin===origin));assert.deepEqual(errors,[]);
  if(scenario==='webcodecs'){
   await page.evaluate(async()=>{
    const {mountMotionView}=await import('/motion-view.js');
    window.qaReviews=[];window.qaSaved=[];
    mountMotionView(document.querySelector('#motion'),{getCoachConfiguration:()=>({configured:true,vision:true}),listAssessments:async()=>[],saveAssessment:async report=>{window.qaSaved.push(report);return report;},reviewAssessment:async body=>{window.qaReviews.push(body);const response=await fetch('/api/motion/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());return response.json();}});
   });
   assert.equal(await page.locator('[data-motion-pose-model]').inputValue(),'mediapipe-full');
   await page.locator('[data-motion-exercise]').selectOption('squat');await page.locator('[data-motion-file]').setInputFiles(clip);
   await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]').disabled);
   await page.locator('[data-motion-action="analyze"]').click();await page.locator('.motion-coach-evaluation').waitFor({timeout:120000});
   assert.equal(await page.evaluate(()=>window.qaReviews[0].poseData.format),'mediapipe-body17-full');
   await page.locator('[data-motion-action="save"]').click();await page.waitForFunction(()=>window.qaSaved.length===1);
   assert.match(await page.evaluate(()=>window.qaSaved[0].analysis.modelVersion),/MediaPipe/);
   await page.addStyleTag({url:origin+'/motion.css'});await page.screenshot({path:join(dataDir,'standard-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(dataDir,'standard-mobile.png'),fullPage:true});
   await page.locator('[data-motion-pose-model]').selectOption('rtmw');assert(await page.locator('[data-motion-results]').isHidden());assert.equal(await page.locator('[data-motion-action="analyze"]').textContent(),'开始评估');
  }
  assert.deepEqual(errors,[]);
  results.push({scenario,decoder,delegate:output.delegate,frames:output.frames,observed:output.observed,format:output.body.poseData.format});console.log(results.at(-1));
  await context.close();
 }
 await writeFile(join(dataDir,'results.json'),JSON.stringify({results,calls:calls.length},null,2));console.log(dataDir);
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
