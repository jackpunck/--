// Full browser + HTTP integration. Synthetic RTMW-format observations drive UI
// tests; JPEG extraction, provider routing, sanitization, UI and storage are real.
// The upstream model is explicitly mocked: this does not measure model accuracy.
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';
import {motionExercises} from '../public/motion-catalog.js';
import {mergeCoachAssessment} from '../public/motion-contract.js';
import {analyzeMotion} from '../public/motion-analysis.js';
import {buildMotionPoseData,buildFullMotionAnalysis} from '../public/motion-pose-data.js';
import {mapWholebodyLandmarks,RTMW_TO_BODY_LANDMARKS} from '../public/motion-rtmw.js';
import {MOTION_POSE_MODEL} from '../public/motion-models.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const reportsOnly=process.argv.includes('--reports-only');
const clip=resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||join(root,'.qa/motion-fixtures/squat.mp4'));
if(!reportsOnly)await access(clip);await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','motion-coach-ui-'));
const fixture=JSON.parse(await readFile(join(root,'tests/fixtures/motion-squat-real.json'),'utf8'));
// Body positions derive from an old numerical fixture; remaining points are
// synthetic placeholders. This does not assert RTMW inference or accuracy.
const pipeline={...fixture.options,sourceFps:30,sampleFps:15,modelVersion:MOTION_POSE_MODEL.version,elapsedMs:1,decoder:'QA synthetic RTMW-format observations',frames:fixture.frames.map(([time,points])=>{
 const wholebodyLandmarks=Array.from({length:133},()=>({x:0,y:0,score:0}));
 fixture.landmarkIndices.forEach((index,i)=>{const target=RTMW_TO_BODY_LANDMARKS[index];if(Number.isInteger(target)){const [x,y,score]=points[i];wholebodyLandmarks[target]={x,y,score};}});
 return {time,wholebodyLandmarks,landmarks:mapWholebodyLandmarks(wholebodyLandmarks),personCount:1};
})};
const source=await readFile(join(root,'public/motion-video.js'),'utf8');
const replay=source.replace('export async function analyzeVideo(', 'async function unusedAnalyzeVideo(')+`\nexport async function analyzeVideo(file,{signal,onProgress,targetPoint}={}){window.__qaMotionTarget=targetPoint;if(window.__qaHoldPose)await new Promise(resolve=>{window.__qaReleasePose=resolve;});if(signal?.aborted)throw new DOMException('Aborted','AbortError');onProgress?.({progress:1});return ${JSON.stringify(pipeline)};}`;
const evidenceSource=await readFile(join(root,'public/motion-evidence.js'),'utf8');
const heldEvidence=evidenceSource.replace('export async function buildMotionEvidence(', 'async function actualBuildMotionEvidence(')+`\nexport async function buildMotionEvidence(...args){if(window.__qaHoldEvidence)await new Promise(resolve=>{window.__qaReleaseEvidence=resolve;});return actualBuildMotionEvidence(...args);}`;
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tools/node_modules/playwright/index.mjs'))));
const calls=[],errors=[],external=[],browserRequests=[],motionRequests=[];let upstreamMode='success',pendingRelease=null,equipmentAction=null;
const pendingResolves=new Set();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async(url,options)=>{
 assert(new URL(url).pathname.endsWith('/chat/completions'));
 const body=JSON.parse(options.body),content=body.messages.find(item=>item.role==='user').content;
 const input=JSON.parse(typeof content==='string'?content:content[0].text);
 const images=Array.isArray(content)?content.filter(part=>part.type==='image_url'):[];
 calls.push({model:body.model,input,imageCount:images.length,imageBytes:images.reduce((n,p)=>n+Buffer.from(p.image_url.url.split(',')[1],'base64').length,0)});
 if(upstreamMode==='pending')await new Promise((resolve,reject)=>{
  pendingResolves.add(resolve);pendingRelease=()=>{for(const release of pendingResolves)release();pendingResolves.clear();};
  options.signal?.addEventListener('abort',()=>{pendingResolves.delete(resolve);reject(options.signal.reason);},{once:true});
 });
 if(upstreamMode==='error')return json({error:{message:'QA upstream temporarily unavailable'}},503);
 if(['full-data','synthesis','temporal-evidence','visual-keyframes'].includes(input.stage))await new Promise(resolve=>setTimeout(resolve,40));
 const times=input.frames.map(frame=>frame.time),visual=times.length>0;
 const output={action:{name:'徒手深蹲',status:'identified',confidence:'high',imageIndices:input.frames.slice(0,2).map(frame=>frame.imageIndex),evidenceTimes:[],evidence:'两张画面中可见同一训练者屈膝下蹲并起身。'},verdict:{status:'needs-improvement',summary:'这组动作需要调整，请先改善躯干控制。'},feedback:[],limitations:['此响应来自 QA 模拟模型，仅验证功能链路。']};
 if(equipmentAction)output.action=equipmentAction;
 if(input.stage==='visual-keyframes'){
  output.feedback=['最低点的躯干控制','可见支撑位置','起身姿态控制'].map((title,index)=>({title,status:'improve',source:'visual',imageIndices:[Math.min(index,input.frames.length-1)],
   evidence:'测试截图中可见姿态需要改善，此为界面模拟反馈。<img src=x onerror=alert(1)>',correction:'下一组保持稳定支撑，控制动作过程。',priority:index+1}));
 }else if(input.stage==='full-data'||input.stage==='temporal-evidence'){
  const indices=input.stage==='temporal-evidence'?input.evidence.sourceFrameIndices:input.data.frameIndices;
  if(visual)output.feedback.push({title:'最低点的躯干控制',status:'improve',source:'visual',frameIndices:[],imageIndices:[input.frames[1]?.imageIndex??input.frames[0].imageIndex],evidenceTimes:[],evidence:'测试画面中最低点出现明显躯干弯曲。<img src=x onerror=alert(1)>',correction:'下一组先降低负重，收紧腹部，保持可控制的深度。',priority:1});
  if(indices.length)output.feedback.push({title:'动作过程与下一组调整',status:'improve',source:'pose',frameIndices:indices.slice(0,2),evidenceTimes:[],evidence:'骨架采样显示起身时肩髋没有同步移动。',correction:'下一组收紧腹部，让肩髋一起起身。',priority:1});
  const row=input.stage==='temporal-evidence'
   ?input.evidence.measurements.find(row=>Number.isFinite(row[input.evidence.measurementColumns.indexOf('right.elbowAngle')]))
   :input.data.blocks.find(block=>block.path[0]==='fullAnalysis'&&block.path[1]==='measurements'&&Number.isInteger(block.path[2])&&Number.isFinite(block.value?.right?.elbowAngle));
  if(row)output.feedback.push({title:'关节运动过程',status:'improve',source:'analysis',analysisPaths:[['measurements',input.stage==='temporal-evidence'?row[0]:row.path[2],'right','elbowAngle']],evidence:'该帧测量显示手肘屈伸需要结合完整过程保持控制。',correction:'下一组保持平稳的屈伸节奏。',priority:2});
 }else if(input.stage==='synthesis'){
  const previous=input.data.reviewedParts.flatMap(part=>part.report.feedback||[]);
  output.feedback=['visual','pose','analysis'].map(source=>previous.find(item=>item.source===source)).filter(Boolean);
 }
 if(upstreamMode==='no-issues'){
  output.verdict={status:'uncertain',summary:'二维骨架和有限画面未能确认所有细节。'};
  output.feedback=[];
  output.limitations=['测试覆盖率为 45%；未发现可具体指出的动作问题。'];
 }

 return json({choices:[{message:{content:JSON.stringify(output)}}]});
}});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
await context.route('**/motion-video.js',route=>route.fulfill({contentType:'text/javascript',body:replay}));
await context.route('**/motion-evidence.js',route=>route.fulfill({contentType:'text/javascript',body:heldEvidence}));
await context.addInitScript(()=>{
 window.__qaMotionMessages=[];let previous='';
 new MutationObserver(()=>{const value=document.querySelector('[data-motion-coach-status]')?.textContent;if(value&&value!==previous){window.__qaMotionMessages.push(value);previous=value;}}).observe(document,{subtree:true,childList:true,characterData:true});
});
const page=await context.newPage();page.setDefaultTimeout(15000);
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{
 browserRequests.push({url:r.url(),method:r.method()});if(/^https?:/.test(r.url())&&!r.url().startsWith(base))external.push(r.url());
 if(r.method()==='POST'&&r.url()===base+'/api/motion/coach'){
  const body=r.postDataJSON();motionRequests.push({reviewMode:body.reviewMode,schemaVersion:body.poseData.schemaVersion,format:body.poseData.format,
   frameCount:body.poseData.frameCount,hasRawWholebody:body.poseData.frames.some(frame=>Object.hasOwn(frame,'wholebodyLandmarks')),
   retainedLandmarkIndices:body.poseData.retainedLandmarkIndices});
 }
});
const nav=async name=>{if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator(`.nav [data-page="${name}"]`).click();};
const shot=name=>page.screenshot({path:join(dataDir,`${name}.png`),fullPage:true});
const reports=async()=>{const r=await context.request.get(base+'/api/state');assert.equal(r.status(),200);return(await r.json()).records.filter(r=>r.kind==='motion-assessment'&&!r.deleted);};
const analyze=async({selectTarget=false,waitForCoach=true}={})=>{
 await page.locator('[data-motion-file]').setInputFiles(clip);await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]')?.disabled);
 if(selectTarget){
  await page.locator('[data-motion-video]').evaluate(v=>{v.currentTime=3;});await page.waitForFunction(()=>!document.querySelector('[data-motion-video]').seeking);
  await page.locator('[data-motion-action="pick-target"]').click();await page.waitForFunction(()=>!document.querySelector('[data-motion-video]').seeking);
  assert.equal(await page.locator('[data-motion-video]').evaluate(v=>v.currentTime),0);
  assert.equal(await page.locator('[data-motion-action="analyze"]').isDisabled(),true);
  const box=await page.locator('[data-motion-target-picker]').boundingBox();assert(box);
  await page.mouse.click(box.x+box.width*.6,box.y+box.height*.3);
  await page.locator('[data-motion-target-picker]').waitFor({state:'hidden'});assert.match(await page.locator('[data-motion-target-label]').textContent(),/已指定/);
 }
 await page.locator('[data-motion-action="analyze"]').click();
 if(!waitForCoach)return;
 await page.locator('.motion-coach-evaluation').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('[data-motion-action="save"]')?.disabled);
 if(selectTarget){const point=await page.evaluate(()=>window.__qaMotionTarget);assert(Math.abs(point.x-.6)<.01&&Math.abs(point.y-.3)<.01);}
};
const save=async()=>{await page.locator('[data-motion-action="save"]').click();await page.waitForFunction(()=>document.querySelector('[data-motion-action="save"]')?.textContent==='已保存报告');await page.locator('#sync-status').click();};
const unpublished=async()=>{
 assert.equal(await page.locator('[data-motion-results]').isVisible(),false,'Results wait for AI review');
 assert.equal(await page.locator('[data-motion-results] .motion-score').count(),0,'No provisional scores are published');
 assert.equal(await page.locator('[data-motion-action="save"]').count(),0,'Unreviewed results cannot be saved');
};
const waitPending=async()=>{
 await page.waitForFunction(()=>/AI 正在|AI 已/.test(document.querySelector('[data-motion-coach-status]')?.textContent||''),{},{timeout:60000});
 for(let i=0;i<300&&!pendingRelease;i++)await new Promise(r=>setTimeout(r,20));assert(pendingRelease);
};
const releasePending=()=>{upstreamMode='success';pendingRelease();pendingRelease=null;};
const noRuleUi=async()=>{
 assert.equal(await page.locator('.motion-score,.motion-score-note,.motion-checks,.motion-check-grid,.motion-reps,.motion-metric-section,.motion-history-score,.motion-result-facts').count(),0,'Scores, rules and measurement panels are removed');
 const text=await page.locator('[data-motion-results]').textContent();assert(!/严格检查|参考分|逐项检查|分数上限|\/ 100/.test(text));
};
const checks=[];
try{
 const reg=await context.request.post(base+'/api/auth/register',{data:{name:'动作AI验证',email:`motion-coach-${Date.now()}@example.test`,password:'motion-qa-password-123'}});assert.equal(reg.status(),201);const {user}=await reg.json();
 assert.equal((await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',baseVersion:0,data:{age:28,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375}}]}})).status(),200);
 const provider={id:'motion-qa',presetId:'openai',apiKey:'QA-fixture-key-no-external-request',models:[{id:'qa-motion-vision',vision:true},{id:'qa-motion-text',vision:false}]};
 assert.equal((await context.request.put(base+'/api/providers',{data:{providers:[provider],tasks:{motion:provider.id},taskModels:{motion:'qa-motion-vision'}}})).status(),200);
 await page.goto(base);await page.locator('#chat-input').waitFor();await nav('motion');
 assert.equal(await page.locator('.motion-guide ol li').count(),3);await noRuleUi();
 assert.equal(await page.locator('[data-motion-ai-mode],[data-motion-quality]').count(),0);
 if(!reportsOnly){
 upstreamMode='pending';await page.evaluate(()=>{window.__qaHoldEvidence=true;});
 await analyze({waitForCoach:false});await page.waitForFunction(()=>typeof window.__qaReleaseEvidence==='function');
 await unpublished();assert.equal(calls.length,0);assert.equal(await page.locator('[data-motion-action="cancel-coach"]').isVisible(),true);
 await page.evaluate(()=>{window.__qaHoldEvidence=false;window.__qaReleaseEvidence();window.__qaReleaseEvidence=null;});
 await page.waitForFunction(()=>/AI 正在|AI 已/.test(document.querySelector('[data-motion-coach-status]')?.textContent||''),{},{timeout:60000});
 for(let i=0;i<300&&!pendingRelease;i++)await new Promise(r=>setTimeout(r,20));assert(pendingRelease);
 await unpublished();assert.equal(await page.locator('[data-motion-action="analyze"]').isDisabled(),true);await page.waitForFunction(()=>/观察.*关键画面/.test(document.querySelector('[data-motion-coach-status]')?.textContent||''));await shot('waiting-for-ai');
 pendingRelease();pendingRelease=null;upstreamMode='success';
 await page.locator('.motion-coach-evaluation').waitFor();await noRuleUi();assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'needs-improvement');await shot('desktop-visual');
 checks.push('no-result-during-evidence-preparation','no-result-before-ai-review','unreviewed-report-not-saveable');
 assert(calls.length>=1);assert.equal(calls[0].model,'qa-motion-vision');assert(calls[0].imageCount>=2&&calls[0].imageCount<=6);assert(calls[0].imageBytes<=2*1024*1024);
 const visualCalls=calls.filter(call=>call.input.stage==='visual-keyframes');
 assert.equal(visualCalls.length,1);assert.equal(calls.length,1,'The default UI needs one mocked provider call');
 const sentContext=visualCalls[0].input;
 assert.equal(sentContext.source.sourceFrameCount,pipeline.frames.length);
 assert.equal(sentContext.source.bodyProfile,'fitness-body17');assert(JSON.stringify(sentContext).length<6000);
 assert(!/measurements|landmarks|statistics|elbowAngle/.test(JSON.stringify(sentContext)));
 assert.deepEqual(motionRequests[0],{reviewMode:'efficient',schemaVersion:3,format:'rtmw-body17-full',frameCount:pipeline.frames.length,
  hasRawWholebody:false,retainedLandmarkIndices:[0,11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32]});
 assert.equal(await page.locator('.motion-ai-feedback').count(),1);assert(visualCalls[0].imageCount>0);assert.equal(calls.filter(call=>['context','synthesis','full-data','temporal-evidence'].includes(call.input.stage)).length,0);
 assert.match(await page.locator('.motion-ai-feedback').textContent(),/可见支撑位置/);
 checks.push('default-efficient-body17-request','visual-first-small-context','honest-picture-coverage');
 const progressMessages=await page.evaluate(()=>window.__qaMotionMessages);assert(progressMessages.some(text=>/观察.*关键画面/.test(text)));
 assert(!/"(?:checks|reps|qualified|threshold)":/.test(JSON.stringify(visualCalls.map(call=>call.input))));

 checks.push('visible-feedback-display','stable-picture-indices-resolve-to-times','single-visual-model-call','no-raw-angles-or-points-in-default-ai-request','no-local-judgements-in-ai-request','streamed-phase-progress');
 assert(calls[0].input.stage==='visual-keyframes');
 const evidenceFrames=calls[0].input.frames,contextFrames=[evidenceFrames[0],evidenceFrames.at(-1)];
 assert.equal(contextFrames.length,2);assert(contextFrames.every(frame=>frame.crop.xMin===0&&frame.crop.yMin===0&&frame.crop.xMax===1&&frame.crop.yMax===1));
 assert.match(await page.locator('.motion-coach').textContent(),/动作需要调整/);assert.equal(await page.locator('.motion-feedback-item').count(),3);
 assert.equal(await page.locator('.motion-coach img').count(),0);assert(!(await page.locator('.motion-results').textContent()).includes('[object Object]'));
 const target=page.locator('.motion-coach [data-motion-action="seek"]').first(),time=Number(await target.getAttribute('data-time'));await target.click();
 await page.waitForFunction(()=>!document.querySelector('[data-motion-video]').seeking);assert(Math.abs(await page.locator('[data-motion-video]').evaluate(v=>v.currentTime)-time)<.15);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');await shot('mobile-visual');await page.setViewportSize({width:1440,height:1000});
 await save();let stored=(await reports())[0];assert.equal(stored.data.coach.verdict.status,'needs-improvement');assert.equal(stored.data.coach.mode,'visual');assert.equal(stored.data.coach.action.exerciseId,'squat');assert.equal(stored.data.coach.coverage.reviewedFrameCount,0);assert.equal(stored.data.coach.coverage.sourceFrameCount,pipeline.frames.length);assert.equal(stored.data.coach.coverage.strategy,'visual-keyframes');assert.equal(stored.data.coach.coverage.reviewedImageCount,evidenceFrames.length);assert.equal(stored.data.coach.coverage.summarizedMeasurementCount,0);assert.equal(stored.data.coach.checks,undefined);assert.equal(stored.data.coach.coverage.measurementCount,pipeline.frames.length);
 const serialized=JSON.stringify(stored.data);assert(!/data:image|base64|blob:|landmarks|"score":|"checks":|"measurements":|"reps":/.test(serialized));assert(serialized.length<200*1024);checks.push('real-keyframe-extraction','dedicated-vision-route','plain-language-verdict-and-corrections','escaped-model-prose','timestamp-replay','mobile-layout','save-without-images');
 // A pending response must not steal focus from a saved report.
 upstreamMode='pending';await page.locator('[data-motion-action="coach"]').click();await waitPending();await unpublished();
 await page.locator('[data-motion-action="history"]').first().click();await page.locator('.motion-history-notice').waitFor();
 await page.locator('[data-motion-action="live-result"]').click();await unpublished();
 await page.locator('[data-motion-action="history"]').first().click();releasePending();
 await page.locator('[data-motion-coach-status]').waitFor({state:'hidden'});assert.equal(await page.locator('.motion-history-notice').isVisible(),true);await page.locator('[data-motion-action="live-result"]').click();checks.push('history-keeps-focus-during-response');
 // Failures keep results private until a successful retry.
 upstreamMode='error';await page.locator('[data-motion-action="coach"]').click();await page.locator('.motion-coach-error').waitFor({timeout:60000});await unpublished();assert.equal(await page.locator('[data-motion-coach-retry]').isVisible(),true);
 // Even a stale save event cannot persist an unreviewed candidate.
 await page.locator('.motion-page').evaluate(root=>{const button=document.createElement('button');button.dataset.motionAction='save';button.dataset.qaStaleSave='';root.append(button);button.click();button.remove();});assert.equal((await reports()).length,1);
 upstreamMode='success';await page.locator('[data-motion-coach-retry]').click();await page.locator('.motion-coach-evaluation').waitFor({timeout:60000});checks.push('failure-does-not-publish','upstream-error-retry','save-handler-blocks-unreviewed-report');
 // Cancellation aborts the browser request and ignores a late model response.
 upstreamMode='pending';await page.locator('[data-motion-action="coach"]').click();await waitPending();
 await page.locator('[data-motion-action="cancel-coach"]').click();assert.match(await page.locator('.motion-coach-error').textContent(),/取消/);await unpublished();releasePending();
 checks.push('cancel-ignores-late-result','cancelled-review-is-not-published');
 upstreamMode='success';await page.locator('[data-motion-coach-retry]').click();await page.locator('.motion-coach-evaluation').waitFor();
 // A history selected during pose analysis remains selected throughout AI review.
 upstreamMode='pending';await page.evaluate(()=>{window.__qaHoldPose=true;});await analyze({waitForCoach:false});await page.waitForFunction(()=>typeof window.__qaReleasePose==='function');await page.locator('[data-motion-action="history"]').first().click();
 await page.evaluate(()=>{window.__qaHoldPose=false;window.__qaReleasePose();window.__qaReleasePose=null;});await waitPending();assert.equal(await page.locator('.motion-history-notice').isVisible(),true);releasePending();await page.locator('[data-motion-coach-status]').waitFor({state:'hidden'});assert.equal(await page.locator('.motion-history-notice').isVisible(),true);await page.locator('[data-motion-action="live-result"]').click();checks.push('history-selected-during-pose-keeps-focus');
 // A replacement file invalidates the old review, including its late response.
 upstreamMode='pending';await page.locator('[data-motion-action="coach"]').click();await waitPending();await page.locator('[data-motion-file]').setInputFiles(clip);releasePending();await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]')?.disabled);await unpublished();assert.equal(await page.locator('[data-motion-review-wait]').isVisible(),false);checks.push('replacement-file-ignores-old-review');
 // Leaving the view destroys the pending review without publishing into the next page.
 upstreamMode='pending';await analyze({waitForCoach:false});await waitPending();await nav('settings');releasePending();await page.locator('[data-action="settings-tab"][data-tab="ai"]').click();await page.locator('#task-motion').waitFor();assert.equal(await page.locator('[data-motion-results]').count(),0);checks.push('destroy-ignores-late-review');
 // Actual settings UI switches the dedicated task to text-only, leaving other tasks alone.
 assert.equal(await page.locator('#tasks-form select').count(),4);
 await page.locator('#task-motion').selectOption(JSON.stringify({providerId:provider.id,modelId:'qa-motion-text'}));await page.locator('#tasks-form button').click();
 await page.waitForTimeout(150);await nav('motion');assert.match(await page.locator('.motion-coach-mode').textContent(),/图片|视觉/);
 const beforeText=calls.length;await page.locator('[data-motion-file]').setInputFiles(clip);await page.waitForFunction(()=>document.querySelector('[data-motion-metadata]')?.textContent.includes('squat.mp4'));assert.equal(await page.locator('[data-motion-action="analyze"]').isDisabled(),true);assert.equal(calls.length,beforeText);checks.push('settings-four-task-routing','text-only-blocks-analysis');
 assert.equal((await context.request.put(base+'/api/providers',{data:{providers:[provider],tasks:{motion:provider.id},taskModels:{motion:'qa-motion-vision'}}})).status(),200);
 await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');await analyze({selectTarget:true});checks.push('manual-target-first-frame-letterbox-coordinates');
 await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');await page.locator('[data-motion-action="history"]').first().click();await page.locator('.motion-coach-evaluation').waitFor();assert.equal(await page.locator('[data-motion-action="seek"]').count(),0);checks.push('coach-report-reloads');
 }
 // Mock equipment responses pass through the real HTTP contract and report storage.
 // They are fixtures, not recognition-accuracy measurements.
 assert.equal((await context.request.put(base+'/api/providers',{data:{providers:[provider],tasks:{motion:provider.id},taskModels:{motion:'qa-motion-vision'}}})).status(),200);
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
 const shortPipeline={...pipeline,duration:3,frames:pipeline.frames.filter(frame=>frame.time<=3)};
 const reportInput={reviewMode:'efficient',duration:3,poseData:buildMotionPoseData(shortPipeline,{bodyOnly:true}),fullAnalysis:buildFullMotionAnalysis(analyzeMotion(shortPipeline.frames,shortPipeline),shortPipeline)};
 const changes=[];
 for(const [id,equipment,support]of [['bench','dumbbell','flat-bench'],['barbell-bench','barbell','flat-bench'],['smith-bench','smith-machine','flat-bench'],['machine-row','machine','seated']]){
  equipmentAction={exerciseId:id,name:motionExercises.find(item=>item.id===id).name,status:'identified',confidence:'high',evidenceTimes:[1,2],observations:{equipment,support,movement:id==='machine-row'?'row':'horizontal-press',laterality:'bilateral',evidence:'两个提供画面中可见同一训练者的负重、支撑面与推拉变化。',evidenceTimes:[1,2]}};
  const response=await context.request.post(base+'/api/motion/coach',{data:{...reportInput,analysis:{quality:{totalFrames:0,validFrames:0,usableRatio:0,sourceFps:null,targetCoverage:null,reasons:['NO_FRAMES']}},keyframes:[1,2].map(time=>({time,mimeType:'image/png',data:png}))}});
  assert.equal(response.status(),200,await response.text());const review=await response.json(),assessment=mergeCoachAssessment(reportInput.fullAnalysis,review);assert.equal(review.action.exerciseId,id);assert.equal(assessment.exerciseId,id);assert.equal(assessment.score,undefined);
  changes.push({id:`motion:equipment-qa-${id}`,kind:'motion-assessment',baseVersion:0,data:{...assessment,createdAt:new Date().toISOString(),video:{duration:3}}});
 }
 const openCases=[
  {name:'引体向上',exerciseId:null,family:'vertical-pull',equipment:'pullup-bar',support:'hanging',assistance:'none',expectedId:'bodyweight-pullup',evidence:'两帧可见训练者握单杠悬垂并拉起身体，双脚悬空，未接触助力垫、弹力带或他人。'},
  {name:'辅助引体向上',exerciseId:'pullup',family:'vertical-pull',equipment:'pullup-bar',support:'hanging',assistance:'band',expectedId:'pullup',evidence:'两帧可见训练者握单杠拉起身体，脚部持续踩住连接杆上的绷紧弹力带。'},
  {name:'壶铃摆荡',exerciseId:null,family:'hinge',equipment:'kettlebell',support:'standing',assistance:'none',expectedId:null,evidence:'两帧可见训练者双手握壶铃，以髋部往返带动负重在身前摆动。'},
  {name:'双杠臂屈伸',exerciseId:null,family:null,equipment:'parallel-bars',support:'suspended',assistance:'none',expectedId:null,evidence:'两帧可见训练者双手支撑双杠，通过屈伸肘让悬空身体上下移动。'},
 ];
 for(const item of openCases){
  equipmentAction={exerciseId:item.exerciseId,name:item.name,family:item.family,evidence:item.evidence,status:'identified',confidence:'high',evidenceTimes:[1,2],observations:{equipment:item.equipment,support:item.support,movement:item.family,laterality:'bilateral',assistance:item.assistance,evidence:item.evidence,evidenceTimes:[1,2]}};
  const response=await context.request.post(base+'/api/motion/coach',{data:{...reportInput,analysis:{quality:{totalFrames:0,validFrames:0,usableRatio:0,sourceFps:null,targetCoverage:null,reasons:['NO_FRAMES']}},keyframes:[1,2].map(time=>({time,mimeType:'image/png',data:png}))}});
  assert.equal(response.status(),200);const review=await response.json(),assessment=mergeCoachAssessment(reportInput.fullAnalysis,review);
  assert.equal(review.action.status,'identified');assert.equal(review.action.name,item.name);assert.equal(review.action.exerciseId,item.expectedId);
  assert.equal(assessment.exerciseName,item.name);assert.equal(assessment.exerciseId,item.expectedId);assert.equal(assessment.score,undefined);
  changes.push({id:`motion:open-qa-${changes.length}`,kind:'motion-assessment',baseVersion:0,data:{...assessment,createdAt:new Date().toISOString(),video:{duration:3}}});
 }
 equipmentAction={exerciseId:null,name:'单臂哑铃卧推',family:'horizontal-press',evidence:'两帧可见训练者仰卧并单手握哑铃推举。',status:'identified',confidence:'high',evidenceTimes:[1,2]};
 const independent=await context.request.post(base+'/api/motion/coach',{data:{...reportInput,analysis:{exerciseFamily:'row',score:90,checks:[{status:'fail'}],quality:{reasons:[]}},keyframes:[1,2].map(time=>({time,mimeType:'image/png',data:png}))}});
 assert.equal(independent.status(),200);const independentReport=mergeCoachAssessment(reportInput.fullAnalysis,await independent.json());
 assert.equal(independentReport.exerciseName,'单臂哑铃卧推');assert.equal(independentReport.score,undefined);assert.equal(independentReport.recognitionConflict,undefined);
 changes.push({id:'motion:ai-independent-qa',kind:'motion-assessment',baseVersion:0,data:{...independentReport,createdAt:new Date().toISOString(),video:{duration:3}}});
 equipmentAction=null;
 // A cautious model verdict without positive evidence remains uncertain,
 // including after HTTP response, persistence and a history reload.
 upstreamMode='no-issues';
 equipmentAction={exerciseId:null,name:'单腿站立平衡',family:null,status:'identified',confidence:'high',evidenceTimes:[1,2],evidence:'两张测试画面可见同一训练者单腿站立并保持身体位置。'};
 const limitedAnalysis=structuredClone(reportInput.fullAnalysis);
 limitedAnalysis.quality.targetCoverage=.45;
 limitedAnalysis.quality.validFrames=Math.round(limitedAnalysis.quality.totalFrames*.45);
 limitedAnalysis.quality.usableRatio=limitedAnalysis.quality.validFrames/limitedAnalysis.quality.totalFrames;
 limitedAnalysis.quality.reasons=['TARGET_NOT_LOCKED'];
 const relativeResponse=await context.request.post(base+'/api/motion/coach',{data:{...reportInput,fullAnalysis:limitedAnalysis,keyframes:[1,2].map(time=>({time,mimeType:'image/png',data:png}))}});
 assert.equal(relativeResponse.status(),200,await relativeResponse.text());
 const relativeReview=await relativeResponse.json(),relativeReport=mergeCoachAssessment(limitedAnalysis,relativeReview);
 assert.equal(relativeReview.verdict.status,'uncertain');assert.equal(relativeReport.coach.verdict.status,'uncertain');assert.doesNotMatch(relativeReview.verdict.summary,/动作相对标准/);assert.deepEqual(relativeReport.coach.feedback,[]);
 changes.push({id:'motion:uncertain-no-issues',kind:'motion-assessment',baseVersion:0,data:{...relativeReport,createdAt:new Date().toISOString(),video:{duration:3}}});
 upstreamMode='success';equipmentAction=null;
 changes.push({id:'motion:legacy-local-score',kind:'motion-assessment',baseVersion:0,data:{exerciseId:'lunge',score:100,status:'complete',checks:[{status:'pass'}],reps:[{score:100}],createdAt:new Date().toISOString(),video:{duration:3}}});
 changes.push({id:'motion:standard-verdict',kind:'motion-assessment',baseVersion:0,data:{exerciseId:'pushup',score:49,status:'complete',quality:{usableRatio:1},coach:{mode:'visual',action:{name:'俯卧撑',status:'identified'},coverage:{complete:true,frameCount:2,reviewedFrameCount:2},verdict:{status:'standard',summary:'动作相对标准，继续保持当前控制。'},feedback:[{title:'保持肩髋同步',status:'good',source:'visual',evidence:'两张画面中肩髋保持同步，身体位置稳定。',correction:'下一组继续保持平稳的动作节奏。',evidenceTimes:[1,2]}]},createdAt:new Date().toISOString(),video:{duration:3}}});
 assert.equal((await context.request.post(base+'/api/sync',{data:{userId:user.id,changes}})).status(),200);
 await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');await page.waitForFunction(count=>document.querySelectorAll('.motion-history-item').length>=count,changes.length);
 for(const {id,data}of changes){
  const exercise=motionExercises.find(item=>item.id===data.exerciseId),name=data.recognitionConflict?'动作名称待确认':data.exerciseName||exercise?.name;
  const item=page.locator('.motion-history-item').filter({has:page.getByText(name,{exact:true})});
  assert.equal(await item.locator('.motion-history-score').count(),0);
  await item.locator('[data-motion-action="history"]').click();
  assert.equal(await page.locator('#motion-result-title').textContent(),name);
  await noRuleUi();
  if(data.recognitionConflict)assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'uncertain');
  if(id==='motion:legacy-local-score')assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'pending');
  if(id==='motion:standard-verdict'){
   assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'standard');
   assert.equal(await page.locator('[data-motion-verdict] h3').textContent(),'动作相对标准');
   assert.equal(await item.locator('.motion-history-verdict').textContent(),'动作相对标准');
   assert.match(await page.locator('.motion-ai-feedback').textContent(),/继续保持/);
  }
  if(id==='motion:uncertain-no-issues'){
   assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'uncertain');
   assert.equal(await page.locator('.motion-ai-feedback').count(),0);await shot('uncertain-no-issues');
  }
  assert.equal(await page.locator('[data-motion-action="exercise"]').count(),data.coach&&exercise?.hasTeaching?1:0);
  assert.equal(await page.locator('.motion-coach [data-motion-action="seek"]').count(),0);
 }
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('mobile-equipment-report');
 checks.push('equipment-contract-http','identified-name-without-pose-score','action-evidence-persists','equipment-history-display','no-missing-3d-link');
 checks.push('ordinary-pullup-no-assisted-mapping','assisted-pullup-name-preserved','unlisted-motion-http','unlisted-name-history-reload');
 checks.push('old-local-label-does-not-veto-ai-action','scores-and-rule-panels-removed','legacy-local-score-never-becomes-ai-verdict','explicit-standard-report-displays-maintenance-advice','no-issues-at-45-percent-coverage-remains-uncertain','report-and-history-preserve-evidence-verdict');
 assert.equal(browserRequests.filter(r=>r.method==='POST'&&r.url.includes('/api/attachments')).length,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(dataDir,'results.json'),JSON.stringify({checks,calls:calls.map(({input,...call})=>({...call,frameTimes:input.frames.map(f=>f.time),stage:input.stage||'legacy',checkCount:input.analysis?.checks?.length||0})),errors,external},null,2));console.log(JSON.stringify({dataDir,checks,errors,external},null,2));
}catch(error){await shot('failure').catch(()=>{});console.error('QA artifacts:',dataDir);throw error;}
finally{pendingRelease?.();await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
