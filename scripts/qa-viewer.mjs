// Isolated viewer regression and same-device before/after measurements.
// Example: node scripts/qa-viewer.mjs --phase before --snapshot .qa/viewer-baseline-...
//          node scripts/qa-viewer.mjs --phase after --baseline .qa/viewer-before-.../result.json
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {startServer} from '../server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?null:process.argv[i+1];};
const phase=option('phase')||'after',before=phase==='before';
const measurements=option('measurements');
let savedMeasurements=null;
if(measurements){
 assert(!before,'Saved measurements are only supported for after-phase functional reruns');
 savedMeasurements=JSON.parse(await readFile(resolve(measurements),'utf8'));
 assert.equal(savedMeasurements.measurementVersion,'rendered-ack-v2','Old DOM-ready timings cannot be reused; run three fresh render-aware iterations.');
 assert(savedMeasurements.passed&&savedMeasurements.runs?.length===3,'Saved render-aware measurements must come from a passing three-iteration run');
 for(const run of savedMeasurements.runs)for(const sample of run.samples)assert(sample.rendered?.documentToken===sample.token&&sample.rendered.drawCalls>sample.drawCallsBefore,'Saved sample is missing evidence of a new canvas render');
}
const snapshot=option('snapshot')&&resolve(option('snapshot'));
if(before)assert(snapshot,'Before measurement requires a frozen --snapshot directory');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa',`viewer-${phase}-`));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
const server=await startServer({host:'127.0.0.1',port:0,dataDir,...snapshot?{publicDir:join(snapshot,'public'),modelDir:join(snapshot,'model')}:{}});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[],failures=[],runs=[],contexts=[];
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const now=()=>performance.now();
let step='',page,context;
const targets=[{type:'muscle',id:'chest',muscle:'chest'},{type:'muscle',id:'lats',muscle:'lats'},{type:'exercise',id:'bench',exercise:'bench'},{type:'muscle',id:'soleus',structure:'Soleus muscle.l'}];
const selector=target=>`[data-action="open-visual"][data-type="${target.type}"][data-id="${target.id}"]`;
const frameLocator=()=>page.locator(before?'#modal iframe.model-frame':'#model-detail-frame');
const dialogLocator=()=>page.locator(before?'#modal':'#model-dialog');
const close=async()=>{await page.locator(before?'#modal [data-action="close-modal"]':'#model-dialog [data-model-close]').click();await dialogLocator().waitFor({state:'hidden'});};
const nav=async name=>{if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator(`.nav [data-page="${name}"]`).click();};
const shot=name=>page.screenshot({path:join(dataDir,`${name}.png`),fullPage:false,style:'#toasts{visibility:hidden}'});

async function prepare(iteration){
 context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});contexts.push(context);
 await context.addInitScript(()=>{
  window.qaDocumentToken=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;window.qaDrawCalls=0;window.qaRafCalls=0;window.qaContexts=0;window.qaPickEvents=[];window.qaRenderedEvents=[];window.qaLastRenderRequestId=null;
  const seen=new WeakSet(),original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(...args){const value=original.apply(this,args);if(value&&/webgl/.test(args[0])&&!seen.has(value)){seen.add(value);window.qaContexts++;}return value;};
  for(const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext])if(type)for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const original=type.prototype[method];if(original)type.prototype[method]=function(...args){window.qaDrawCalls++;return original.apply(this,args);};}
  const originalRaf=window.requestAnimationFrame;window.requestAnimationFrame=function(callback){return originalRaf.call(window,time=>{window.qaRafCalls++;callback(time);});};
  addEventListener('pointerup',()=>window.qaPointerTime=performance.timeOrigin+performance.now(),true);
  addEventListener('message',event=>{
   if(event.origin!==location.origin)return;
   if(event.source===parent&&['fitness:exercise','fitness:muscle','fitness:structure','fitness:visibility'].includes(event.data?.type)&&Object.hasOwn(event.data,'requestId'))window.qaLastRenderRequestId=event.data.requestId;
   if(event.data?.type==='fitness:muscle-selected'){let pointerTime;try{pointerTime=event.source.qaPointerTime;}catch{}window.qaPickEvents.push({...event.data,latencyMs:pointerTime?performance.timeOrigin+performance.now()-pointerTime:null});}
   if(event.data?.type==='fitness:rendered'&&event.source===document.querySelector('#model-detail-frame')?.contentWindow){
    window.qaRenderedEvents.push({...event.data,documentToken:event.source.qaDocumentToken,drawCalls:event.source.qaDrawCalls,receivedAt:performance.timeOrigin+performance.now()});
   }
  });
 });
 page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',error=>errors.push(error.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/api/auth/me'))failures.push(`${r.status()} ${r.url()}`);});
 const bundleRequests=[];page.on('request',request=>{if(request.url().includes('/model/demo.bundle.js'))bundleRequests.push(request.url());});
 const response=await context.request.post(base+'/api/auth/register',{data:{name:'查看器验证',email:`qa-viewer-${phase}-${Date.now()}-${iteration}@example.test`,password:'qa-password-123'}});assert.equal(response.status(),201);const {user}=await response.json();
 const createdAt=new Date().toISOString(),messages=[];
 for(const [i,text]of ['胸肌在哪里','背阔肌在哪里','哑铃卧推怎么做','比目鱼肌在哪里','你好','谢谢'].entries()){messages.push({id:`q${i}`,role:'user',content:text,createdAt},{id:`a${i}`,role:'assistant',content:i<4?'可以打开对应的三维示意。':'你好，祝你今天愉快。',createdAt});}
 assert.equal((await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',data:{age:30,sex:'male',height:175,weight:70,goal:'maintain',activity:1.55},baseVersion:0},{id:'qa-viewer-chat',kind:'conversation',data:{title:'3D 查看器验证',messages},baseVersion:0}]}})).status(),200);
 await page.goto(base);await page.locator('[data-action="open-chat"][data-id="qa-viewer-chat"]').click();await page.locator(selector(targets[0])).waitFor({state:'attached'});
 assert.equal(await page.locator('iframe').count(),0,'Cold measurement must start without a preview viewer');
 return bundleRequests;
}

async function renderCheckpoint(){
 if(before)return null;
 return page.evaluate(()=>{let documentToken=null,drawCalls=0;try{const child=document.querySelector('#model-detail-frame')?.contentWindow;documentToken=child?.qaDocumentToken||null;drawCalls=child?.qaDrawCalls||0;}catch{}return {documentToken,drawCalls,eventCount:qaRenderedEvents.length};});
}

async function ready(target,checkpoint=null){
 await frameLocator().waitFor();const frame=frameLocator().contentFrame();
 await frame.locator('#loading').waitFor({state:'hidden',timeout:60000});
 await frame.locator('html').evaluate(async(el,target)=>{
  const correct=()=>target.exercise?el.dataset.exercise===target.exercise&&el.dataset.mode==='motion':el.dataset.mode==='atlas';
  const selected=()=>!target.muscle||el.dataset.selectedMuscle===target.muscle;
  const structure=()=>!target.structure||el.dataset.selectedStructure===target.structure;
  const start=performance.now();while(!correct()||!selected()||!structure()||!window.qaDrawCalls){if(performance.now()-start>20000)throw new Error(`Viewer target did not settle: ${JSON.stringify(el.dataset)}`);await new Promise(resolve=>setTimeout(resolve,20));}
 },target);
 if(before)await frame.locator('html').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 if(!before){
  await page.waitForFunction(({target,checkpoint})=>{
   const child=document.querySelector('#model-detail-frame')?.contentWindow,last=qaRenderedEvents.at(-1);
   if(!child||!last||last.documentToken!==child.qaDocumentToken||!last.drawCalls)return false;
   if(child.qaLastRenderRequestId!==null&&last.requestId!==child.qaLastRenderRequestId)return false;
   const matches=target.exercise?last.mode==='motion'&&last.exercise===target.exercise:
    last.mode==='atlas'&&(target.structure?last.structure===target.structure:last.muscle===target.muscle&&!last.structure);
   if(!matches)return false;
   if(checkpoint&&(qaRenderedEvents.length<=checkpoint.eventCount||last.drawCalls<=(last.documentToken===checkpoint.documentToken?checkpoint.drawCalls:0)))return false;
   return document.querySelector('#model-dialog')?.dataset.state==='ready';
  },{target,checkpoint},{timeout:20000});
 }
 return frame;
}

async function measure(target){
 const trigger=page.locator(selector(target));await trigger.scrollIntoViewIfNeeded();const checkpoint=await renderCheckpoint(),start=now();await trigger.click();const frame=await ready(target,checkpoint),elapsedMs=now()-start;
 const info=await frame.locator('html').evaluate(()=>({token:window.qaDocumentToken,contexts:window.qaContexts,drawCalls:window.qaDrawCalls,mode:document.documentElement.dataset.mode,exercise:document.documentElement.dataset.exercise,muscle:document.documentElement.dataset.selectedMuscle,structure:document.documentElement.dataset.selectedStructure}));
 const rendered=before?null:await page.evaluate(()=>qaRenderedEvents.at(-1));
 return {target:target.id,elapsedMs,...info,rendered,drawCallsBefore:checkpoint?.drawCalls??0};
}

async function surfacePicks(){
 const frame=await ready(targets[0]),canvas=frame.locator('canvas'),box=await canvas.boundingBox();assert(box);const events=[];
 for(const [x,y]of [[.5,.36],[.46,.36],[.54,.36],[.5,.43],[.46,.49],[.54,.49],[.43,.31],[.57,.31],[.48,.6],[.52,.6]]){
  const count=await page.evaluate(()=>qaPickEvents.length);await canvas.click({position:{x:box.width*x,y:box.height*y}});
  const hit=await page.evaluate(n=>qaPickEvents.length>n?qaPickEvents.at(-1):null,count);if(hit?.latencyMs!==null&&hit?.structure)events.push(hit);if(events.length>=3)break;
 }
 assert(events.length,'Real canvas ray picking returned no anatomy structure');assert(events.every(e=>e.name&&Number.isFinite(e.latencyMs)));return events;
}

async function waitForDraw(frame,previous,message){
 const start=now();while(now()-start<5000){if(await frame.locator('html').evaluate((_el,n)=>qaDrawCalls>n,previous))return;await sleep(50);}const counters=await frame.locator('html').evaluate(()=>({draws:qaDrawCalls,raf:qaRafCalls,play:document.querySelector('#play').getAttribute('aria-label'),progress:document.querySelector('#progress').value,visibility:document.visibilityState,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON()}));assert.fail(message+': '+JSON.stringify({previous,...counters}));
}

try{
 if(savedMeasurements){runs.push(...savedMeasurements.runs);await prepare(2);}
 for(let i=0;!savedMeasurements&&i<3;i++){
  step=`${phase}: measurement ${i+1}/3`;console.log(step);const bundleRequests=await prepare(i),samples=[];
  for(const target of targets){samples.push(await measure(target));await close();}
  const tokens=new Set(samples.map(s=>s.token));if(!before){assert.equal(tokens.size,1,'Warm opens recreated iframe document');assert(samples.every(s=>s.contexts===1),'Viewer recreated its WebGL context');assert.equal(bundleRequests.length,1,'Warm opens requested model bundle again');}
  await measure(targets[0]);const picks=await surfacePicks();await close();runs.push({iteration:i+1,samples,bundleRequests:bundleRequests.length,documentCount:tokens.size,picks});
  if(before||i<2)await context.close();
 }
 if(!before){
  step='persistent frame, rapid target switches, visibility and focus';console.log(step);
  await measure(targets[0]);await sleep(500);const idleFrame=frameLocator().contentFrame();const idleCounters=await idleFrame.locator('html').evaluate(()=>({draws:qaDrawCalls,raf:qaRafCalls}));await sleep(250);assert.deepEqual(await idleFrame.locator('html').evaluate(()=>({draws:qaDrawCalls,raf:qaRafCalls})),idleCounters,'Idle anatomy viewer kept rendering');await page.evaluate(()=>{window.qaDetailNode=document.querySelector('#model-detail-frame');window.qaDetailDocument=qaDetailNode.contentDocument;window.qaDetailCanvas=qaDetailDocument.querySelector('canvas');});await close();
  assert(await page.locator(selector(targets[0])).evaluate(el=>document.activeElement===el),'Closing viewer did not restore focus');
  await measure(targets[2]);await frameLocator().contentFrame().locator('#muscle-chips [data-muscle="chest"]').click();await close();await measure(targets[0]);assert.equal(await frameLocator().contentFrame().locator('html').getAttribute('data-mode'),'atlas','Exercise muscle chip polluted cached atlas selection');await close();
  // Synchronous real app click handlers exercise last-request-wins while the dialog is open.
  const rapidAbaCheckpoint=await renderCheckpoint();await page.evaluate(selectors=>selectors.forEach(selector=>document.querySelector(selector).click()),[targets[0],targets[1],targets[0]].map(selector));await ready(targets[0],rapidAbaCheckpoint);await writeFile(join(dataDir,'rapid-aba-rendered.json'),JSON.stringify({checkpoint:rapidAbaCheckpoint,rendered:await page.evaluate(()=>qaRenderedEvents.at(-1))},null,2));
  const rapidWarmCheckpoint=await renderCheckpoint();await page.evaluate(selectors=>selectors.forEach(selector=>document.querySelector(selector).click()),targets.map(selector));await ready(targets[3],rapidWarmCheckpoint);
  assert(await page.evaluate(()=>qaDetailNode===document.querySelector('#model-detail-frame')&&qaDetailDocument===qaDetailNode.contentDocument&&qaDetailCanvas===qaDetailDocument.querySelector('canvas')),'Target switches replaced iframe/document/canvas');
  assert.equal(await frameLocator().contentFrame().locator('.exercise-tabs').isVisible(),false);assert.equal(await frameLocator().contentFrame().locator('.exercise-picker').isVisible(),false);assert.equal(await frameLocator().contentFrame().locator('.model-tabs').isVisible(),false);
  assert.equal(await frameLocator().contentFrame().locator('[data-view="back"]').getAttribute('aria-pressed'),'true','Soleus selection retained the earlier front camera');const settledStructure=await page.evaluate(()=>({rendered:qaRenderedEvents.at(-1),dataset:{...document.querySelector('#model-detail-frame').contentDocument.documentElement.dataset}}));await writeFile(join(dataDir,'rapid-warm-rendered.json'),JSON.stringify({checkpoint:rapidWarmCheckpoint,...settledStructure},null,2));await shot('desktop-structure-viewer');await ready(targets[3],rapidWarmCheckpoint);await page.keyboard.press('Escape');await dialogLocator().waitFor({state:'hidden'});
  assert(await page.locator(selector(targets[0])).evaluate(el=>document.activeElement===el),'Escape did not restore the opener focus');
  const frame=frameLocator().contentFrame();await sleep(150);const stopped=await frame.locator('html').evaluate(()=>({draws:qaDrawCalls,raf:qaRafCalls}));await sleep(350);assert.deepEqual(await frame.locator('html').evaluate(()=>({draws:qaDrawCalls,raf:qaRafCalls})),stopped,'Closed viewer kept rendering');

  step='closing a playing animation suspends drawing and reopening resumes';console.log(step);
  const animationCheckpoint=await renderCheckpoint();await page.evaluate(()=>{const trigger=document.createElement('button');trigger.dataset.action='exercise';trigger.dataset.id='squat';trigger.id='qa-animation-trigger';document.body.append(trigger);trigger.click();});await ready({exercise:'squat'},animationCheckpoint);await frame.locator('#play').click();const playingStart=await frame.locator('html').evaluate(()=>qaDrawCalls);await waitForDraw(frame,playingStart,'Animation did not render while playing');await close();await sleep(100);const paused=await frame.locator('html').evaluate(()=>({draws:qaDrawCalls,raf:qaRafCalls}));await sleep(300);assert.deepEqual(await frame.locator('html').evaluate(()=>({draws:qaDrawCalls,raf:qaRafCalls})),paused,'Closed animation kept rendering');
  const resumeCheckpoint=await renderCheckpoint();await page.locator('#qa-animation-trigger').evaluate(el=>el.click());await ready({exercise:'squat'},resumeCheckpoint);const resumed=await frame.locator('html').evaluate(()=>qaDrawCalls);await waitForDraw(frame,resumed,'Retained animation did not resume');await close();

  step='ordinary meal modal survives opening and closing the dedicated viewer';console.log(step);
  await nav('nutrition');await page.locator('[data-action="new-meal"]').first().click();await page.locator('#modal[open]').waitFor();const fields=page.locator('#meal-notes');await fields.fill('QA 保留餐食草稿');const draft=await fields.inputValue();
  // The dedicated dialog is opened by the same application action, while the ordinary form is open.
  const formViewerCheckpoint=await renderCheckpoint();await page.evaluate(()=>{const trigger=document.createElement('button');trigger.type='button';trigger.dataset.action='open-visual';trigger.dataset.type='muscle';trigger.dataset.id='chest';trigger.id='qa-form-viewer-trigger';document.querySelector('#modal').append(trigger);trigger.click();});await ready(targets[0],formViewerCheckpoint);await close();assert.equal(await fields.first().inputValue(),draft);assert(await page.locator('#modal').evaluate(el=>el.open));await page.locator('#qa-form-viewer-trigger').evaluate(el=>el.remove());await page.locator('#modal [data-action="close-modal"]').first().click();

  step='mobile embedded navigation and retained model';console.log(step);
  await nav('chat');await page.locator('[data-action="open-chat"][data-id="qa-viewer-chat"]').click();await page.setViewportSize({width:390,height:844});await measure(targets[0]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await dialogLocator().evaluate(el=>el.scrollWidth<=el.clientWidth+1));await shot('mobile-muscle-viewer');await close();await measure(targets[2]);await shot('mobile-exercise-viewer');await close();

  step='standalone navigation stays available and logout releases the persistent frame';console.log(step);
  const earlyContext=await browser.newContext({viewport:{width:1050,height:850},serviceWorkers:'block'});contexts.push(earlyContext);let releaseBundle,bundleBlocked;const requested=new Promise(resolve=>bundleBlocked=resolve),gate=new Promise(resolve=>releaseBundle=resolve);await earlyContext.route('**/model/demo.bundle.js*',async route=>{bundleBlocked();await gate;await route.continue();});const earlyPage=await earlyContext.newPage();await earlyPage.goto(base+'/model/index.html?mode=atlas&muscle=chest&embed=1',{waitUntil:'commit'});await requested;await earlyPage.locator('.exercise-tabs').waitFor({state:'attached'});assert.equal(await earlyPage.locator('.exercise-tabs').isVisible(),false,'Embedded navigation flashed before bundle loaded');assert.equal(await earlyPage.locator('.exercise-picker').isVisible(),false);assert.equal(await earlyPage.locator('.model-tabs').isVisible(),false);await earlyPage.screenshot({path:join(dataDir,'embedded-before-bundle.png')});releaseBundle();await earlyPage.locator('#loading').waitFor({state:'hidden',timeout:60000});await earlyContext.close();
  const standalone=await context.newPage();await standalone.goto(base+'/model/index.html?exercise=bench');await standalone.locator('#loading').waitFor({state:'hidden',timeout:60000});assert(await standalone.locator('.exercise-tabs').isVisible());assert(await standalone.locator('.exercise-picker').isVisible());assert(await standalone.locator('.model-tabs').isVisible());await standalone.screenshot({path:join(dataDir,'standalone-navigation.png')});await standalone.close();
  if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator('[data-action="logout"]').click();await page.locator('#auth-form').waitFor();assert.equal(await page.locator('#model-dialog,#model-detail-frame').count(),0);assert.equal(await page.locator('iframe').count(),0);

  step='rapid cold selections while the first document is still loading';console.log(step);
  const coldRequests=await prepare(3),rapidColdCheckpoint=await renderCheckpoint();await page.evaluate(selectors=>selectors.forEach(selector=>document.querySelector(selector).click()),targets.map(selector));await ready(targets[3],rapidColdCheckpoint);assert.equal(await dialogLocator().getAttribute('data-target-key'),'structure:Soleus muscle.l');assert.equal(coldRequests.length,1);assert.equal(await frameLocator().contentFrame().locator('html').evaluate(()=>qaContexts),1);await close();

  step='failed model document exposes retry and a fresh document can recover';console.log(step);
  await prepare(4);const modelDocument=url=>url.pathname==='/model/index.html';await context.route(modelDocument,route=>route.abort('failed'));await page.locator(selector(targets[0])).click();await page.locator('#model-dialog[data-state="error"]').waitFor();assert(await page.locator('[data-model-retry]').isVisible());await context.unroute(modelDocument);const retryCheckpoint=await renderCheckpoint();await page.locator('[data-model-retry]').click();await ready(targets[0],retryCheckpoint);await close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
 const medians={};for(let i=0;i<targets.length;i++)medians[targets[i].id]=median(runs.map(r=>r.samples[i].elapsedMs));medians.surfacePick=median(runs.flatMap(r=>r.picks.map(p=>p.latencyMs)));
 const result={passed:true,phase,snapshot,dataDir,measurementVersion:before?'fresh-document-v1':'rendered-ack-v2',measurementsFrom:measurements?resolve(measurements):null,environment:{browser:browser.version(),viewport:'1440×1000',headless:true,renderer:'Edge with --enable-unsafe-swiftshader',iterations:3},method:'Fresh browser context per iteration; seeded historical chat has no preview iframes. Before: new canvas, matching dataset, #loading hidden, actual WebGL draw and two frames. After: matching fitness:rendered metadata from the current iframe document, current requestId, a newer per-open render event and increased WebGL draw count, plus visible ready dialog. Warm samples close and reopen another target. No network throttling. Surface-pick latency is captured pointerup through actual raycast to parent message, excluding automation transport.',medians,runs,errors,failures};
 if(option('baseline')){const baseline=JSON.parse(await readFile(resolve(option('baseline')),'utf8'));result.comparison={before:baseline.medians,after:medians};}
 await writeFile(join(dataDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,dataDir,medians,comparison:result.comparison}));
}catch(error){console.error('FAILED STEP:',step);await page?.screenshot({path:join(dataDir,'failure.png'),fullPage:false}).catch(()=>{});await writeFile(join(dataDir,'failure.json'),JSON.stringify({step,error:error.stack,runs,errors,failures},null,2));throw error;
}finally{for(const context of contexts)await context.close().catch(()=>{});await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
