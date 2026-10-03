// Full browser + HTTP integration. Pose inference is replayed from a real recorded
// fixture; JPEG extraction, provider routing, sanitization, UI and storage are real.
// The upstream model is explicitly mocked: this does not measure model accuracy.
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const clip=resolve(process.argv[2]||join(root,'.qa/motion-fixtures/squat.mp4'));
await access(clip);await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','motion-coach-ui-'));
const fixture=JSON.parse(await readFile(join(root,'tests/fixtures/motion-squat-real.json'),'utf8'));
const pipeline={...fixture.options,sourceFps:30,sampleFps:15,modelVersion:fixture.modelVersion,elapsedMs:1,decoder:'QA replay of real pose observations',frames:fixture.frames.map(([time,points])=>{
 const landmarks=Array.from({length:33},()=>({x:0,y:0,visibility:0,presence:0}));
 fixture.landmarkIndices.forEach((index,i)=>{const [x,y,visibility]=points[i];landmarks[index]={x,y,visibility,presence:visibility};});
 return {time,landmarks,personCount:1};
})};
const source=await readFile(join(root,'public/motion-video.js'),'utf8');
const replay=source.replace('export async function analyzeVideo(', 'async function unusedAnalyzeVideo(')+`\nexport async function analyzeVideo(file,{signal,onProgress,targetPoint}={}){window.__qaMotionTarget=targetPoint;if(signal?.aborted)throw new DOMException('Aborted','AbortError');onProgress?.({progress:1});return ${JSON.stringify(pipeline)};}`;
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))));
const calls=[],errors=[],external=[],browserRequests=[];let upstreamMode='success',pendingRelease=null;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async(url,options)=>{
 assert(new URL(url).pathname.endsWith('/chat/completions'));
 const body=JSON.parse(options.body),content=body.messages.find(item=>item.role==='user').content;
 const input=JSON.parse(typeof content==='string'?content:content[0].text);
 const images=Array.isArray(content)?content.filter(part=>part.type==='image_url'):[];
 calls.push({model:body.model,input,imageCount:images.length,imageBytes:images.reduce((n,p)=>n+Buffer.from(p.image_url.url.split(',')[1],'base64').length,0)});
 if(upstreamMode==='pending')await new Promise(resolve=>{pendingRelease=resolve;});
 if(upstreamMode==='error')return json({error:{message:'QA upstream temporarily unavailable'}},503);
 const times=input.frames.map(frame=>frame.time),visual=times.length>0;
 const local=input.analysis.checks?.find(check=>check.status!=='unobservable');
 const output={action:{exerciseId:'squat',status:'identified',confidence:'high',evidenceTimes:times.slice(0,2)},overallEvaluation:'先减轻负重，保持躯干稳定，再逐步增加动作深度。<img src=x onerror=alert(1)>',checks:visual?[{code:'SPINE_NEUTRAL',status:'fail',severity:'severe',time:times[1],evidenceTimes:[times[1]],evidence:'测试画面证据：最低点出现明显腰背弯曲。',correction:'下一组先降低负重，收紧腹部，保持可控制的深度。'}]:[{code:local?.code||'SQUAT_DEPTH',status:'fail',evidence:'文本模型不应新增视觉事实。',correction:'依据已检测的幅度，放慢下降并保持控制。'},{code:'SPINE_NEUTRAL',status:'pass',evidence:'无图假设必须被拒绝。'}],limitations:['此响应来自 QA 模拟模型，仅验证功能链路。']};
 return json({choices:[{message:{content:JSON.stringify(output)}}]});
}});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
await context.route('**/motion-video.js',route=>route.fulfill({contentType:'text/javascript',body:replay}));
const page=await context.newPage();page.setDefaultTimeout(15000);
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{browserRequests.push({url:r.url(),method:r.method()});if(/^https?:/.test(r.url())&&!r.url().startsWith(base))external.push(r.url());});
const nav=async name=>{if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator(`.nav [data-page="${name}"]`).click();};
const shot=name=>page.screenshot({path:join(dataDir,`${name}.png`),fullPage:true});
const reports=async()=>{const r=await context.request.get(base+'/api/state');assert.equal(r.status(),200);return(await r.json()).records.filter(r=>r.kind==='motion-assessment'&&!r.deleted);};
const analyze=async({selectTarget=false}={})=>{
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
 await page.locator('[data-motion-action="analyze"]').click();await page.locator('.motion-coach-evaluation').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('[data-motion-action="save"]')?.disabled);
 if(selectTarget){const point=await page.evaluate(()=>window.__qaMotionTarget);assert(Math.abs(point.x-.6)<.01&&Math.abs(point.y-.3)<.01);}
};
const save=async()=>{await page.locator('[data-motion-action="save"]').click();await page.waitForFunction(()=>document.querySelector('[data-motion-action="save"]')?.textContent==='已保存报告');await page.locator('#sync-status').click();};
const checks=[];
try{
 const reg=await context.request.post(base+'/api/auth/register',{data:{name:'动作AI验证',email:`motion-coach-${Date.now()}@example.test`,password:'motion-qa-password-123'}});assert.equal(reg.status(),201);const {user}=await reg.json();
 assert.equal((await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',baseVersion:0,data:{age:28,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375}}]}})).status(),200);
 const provider={id:'motion-qa',presetId:'openai',apiKey:'QA-fixture-key-no-external-request',models:[{id:'qa-motion-vision',vision:true},{id:'qa-motion-text',vision:false}]};
 assert.equal((await context.request.put(base+'/api/providers',{data:{providers:[provider],tasks:{motion:provider.id},taskModels:{motion:'qa-motion-vision'}}})).status(),200);
 await page.goto(base);await page.locator('#chat-input').waitFor();await nav('motion');
 assert.equal(await page.locator('.motion-catalog li').count(),25);
 assert.equal(await page.locator('[data-motion-ai-mode]').isChecked(),true);
 await analyze();await shot('desktop-visual');
 assert.equal(calls.length,1);assert.equal(calls[0].model,'qa-motion-vision');assert(calls[0].imageCount>=2&&calls[0].imageCount<=6);assert(calls[0].imageBytes<=2*1024*1024);
 assert(calls[0].input.analysis.checks.length>0);assert(!JSON.stringify(calls[0].input.analysis).includes('landmarks'));
 assert.match(await page.locator('.motion-coach').textContent(),/关键画面 \+ 检测证据/);
 assert.equal(await page.locator('.motion-coach img').count(),0);assert(!(await page.locator('.motion-results').textContent()).includes('[object Object]'));
 const target=page.locator('.motion-coach [data-motion-action="seek"]').first(),time=Number(await target.getAttribute('data-time'));await target.click();
 await page.waitForFunction(()=>!document.querySelector('[data-motion-video]').seeking);assert(Math.abs(await page.locator('[data-motion-video]').evaluate(v=>v.currentTime)-time)<.15);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');await shot('mobile-visual');await page.setViewportSize({width:1440,height:1000});
 await save();let stored=(await reports())[0];assert(stored.data.score<=49);assert.equal(stored.data.coach.mode,'visual');assert.equal(stored.data.coach.action.exerciseId,'squat');assert(stored.data.checks.some(c=>c.code==='SPINE_NEUTRAL'&&c.status==='fail'));
 const serialized=JSON.stringify(stored.data);assert(!/data:image|base64|blob:|landmarks/.test(serialized));assert(serialized.length<200*1024);checks.push('real-keyframe-extraction','dedicated-vision-route','strict-ai-failure-cap','escaped-model-prose','timestamp-replay','mobile-layout','save-without-images');
 // A pending response must not steal focus from a saved report.
 upstreamMode='pending';await page.locator('[data-motion-action="coach"]').click();await page.waitForFunction(()=>document.querySelector('[data-motion-coach-status]')?.textContent.includes('AI 正在核对'),{},{timeout:60000});
 await page.locator('[data-motion-action="history"]').first().click();await page.locator('.motion-history-notice').waitFor();
 for(let i=0;i<100&&!pendingRelease;i++)await new Promise(r=>setTimeout(r,20));assert(pendingRelease);pendingRelease();pendingRelease=null;upstreamMode='success';
 await page.locator('[data-motion-coach-status]').waitFor({state:'hidden'});assert.equal(await page.locator('.motion-history-notice').isVisible(),true);await page.locator('[data-motion-action="live-result"]').click();checks.push('history-keeps-focus-during-response');
 // Failed retries preserve local results and allow another attempt.
 upstreamMode='error';await page.locator('[data-motion-action="coach"]').click();await page.locator('.motion-coach-error').waitFor({timeout:60000});assert.equal(await page.locator('[data-motion-action="save"]').isDisabled(),false);upstreamMode='success';checks.push('upstream-error-recovery');
 // Cancellation aborts the browser request and ignores a late model response.
 upstreamMode='pending';await page.locator('[data-motion-action="coach"]').click();for(let i=0;i<600&&!pendingRelease;i++)await new Promise(r=>setTimeout(r,20));assert(pendingRelease);
 await page.locator('[data-motion-action="cancel-coach"]').click();pendingRelease();pendingRelease=null;upstreamMode='success';assert.match(await page.locator('.motion-coach-error').textContent(),/取消/);checks.push('cancel-ignores-late-result');
 // Actual settings UI switches the dedicated task to text-only, leaving other tasks alone.
 await nav('settings');await page.locator('[data-action="settings-tab"][data-tab="ai"]').click();await page.locator('#task-motion').waitFor();assert.equal(await page.locator('#tasks-form select').count(),4);
 await page.locator('#task-motion').selectOption(JSON.stringify({providerId:provider.id,modelId:'qa-motion-text'}));await page.locator('#tasks-form button').click();
 await page.waitForTimeout(150);await nav('motion');assert.match(await page.locator('.motion-coach-mode').textContent(),/只接收检测摘要/);
 await analyze({selectTarget:true});assert.equal(calls.at(-1).model,'qa-motion-text');assert.equal(calls.at(-1).imageCount,0);await save();checks.push('manual-target-first-frame-letterbox-coordinates');
 stored=(await reports()).find(r=>r.data.coach?.mode==='evidence-only');assert(stored);assert(!stored.data.coach.checks.some(c=>c.code==='SPINE_NEUTRAL'&&c.status==='pass'));checks.push('settings-four-task-routing','text-only-sends-no-images','text-cannot-confirm-neutral');
 await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');await page.locator('[data-motion-action="history"]').first().click();await page.locator('.motion-coach-evaluation').waitFor();assert.equal(await page.locator('[data-motion-action="seek"]').count(),0);checks.push('coach-report-reloads');
 assert.equal(browserRequests.filter(r=>r.method==='POST'&&r.url.includes('/api/attachments')).length,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(dataDir,'results.json'),JSON.stringify({checks,calls:calls.map(({input,...call})=>({...call,frameTimes:input.frames.map(f=>f.time),checkCount:input.analysis.checks.length})),errors,external},null,2));console.log(JSON.stringify({dataDir,checks,errors,external},null,2));
}catch(error){await shot('failure').catch(()=>{});console.error('QA artifacts:',dataDir);throw error;}
finally{pendingRelease?.();await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
