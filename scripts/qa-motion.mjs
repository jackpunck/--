// Real local-video inference through the application, isolated account/database.
// Usage: QA_PLAYWRIGHT=... node scripts/qa-motion.mjs [squat.mp4] [pushup.mp4]
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const clips=[['squat',resolve(process.argv[2]||join(root,'.qa/motion-fixtures/squat.mp4'))],['pushup',resolve(process.argv[3]||join(root,'.qa/motion-fixtures/pushup.mp4'))]];
for(const [,path]of clips)await access(path);
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','motion-ui-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))));
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
// Instrument real functions; inference and measurement implementations are unchanged.
const videoSource=await readFile(join(root,'public/motion-video.js'),'utf8');
const measuredVideo=videoSource.replace('export async function analyzeVideo(', 'async function actualAnalyzeVideo(')+'\nexport async function analyzeVideo(...args){const result=await actualAnalyzeVideo(...args);window.__qaMotionOutput=result;return result;}';
const analysisSource=await readFile(join(root,'public/motion-analysis.js'),'utf8');
const measuredAnalysis=analysisSource.replace('export function analyzeMotion(', 'function actualAnalyzeMotion(')+'\nexport function analyzeMotion(...args){const result=actualAnalyzeMotion(...args);window.__qaMotionObservations=result;return result;}';
await context.route('**/motion-video.js',route=>route.fulfill({contentType:'text/javascript',body:measuredVideo}));
await context.route('**/motion-analysis.js',route=>route.fulfill({contentType:'text/javascript',body:measuredAnalysis}));
const page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[],external=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{requests.push({url:r.url(),method:r.method()});if(/^https?:/.test(r.url())&&!r.url().startsWith(base))external.push(r.url());});
const nav=async name=>{if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator(`.nav [data-page="${name}"]`).click();};
const snapshot=async name=>{await page.screenshot({path:join(dataDir,name+'.png'),fullPage:true});};
const getReports=async()=>{const r=await context.request.get(base+'/api/state');assert.equal(r.status(),200);return(await r.json()).records.filter(r=>r.kind==='motion-assessment'&&!r.deleted);};
const analyze=async(path,model)=>{
 await page.locator('[data-motion-quality]').selectOption(model);
 assert.equal(await page.locator('[data-motion-results]').isVisible(),false,'Changing models clears the previous result');
 await page.locator('[data-motion-file]').setInputFiles(path);
 await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]')?.disabled);
 await page.locator('[data-motion-action="analyze"]').click();
 assert(await page.locator('[data-motion-quality]').isDisabled(),'Model cannot change during inference');
 await page.locator('[data-motion-results]').waitFor({state:'visible',timeout:180000});
 assert.equal(await page.locator('[data-motion-error]').isVisible(),false);
};
const measured=[];
try{
 const registered=await context.request.post(base+'/api/auth/register',{data:{name:'动作评估验证',email:`motion-${Date.now()}@example.test`,password:'motion-qa-password-123'}});
 assert.equal(registered.status(),201);const {user}=await registered.json();
 const seed=await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',baseVersion:0,data:{age:28,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375}}]}});assert.equal(seed.status(),200);
 await page.goto(base);await page.locator('#chat-input').waitFor();
 for(const entry of ['training','library']){
  await nav(entry);await page.locator('[data-action="motion-open"]').click();
  await page.locator('.motion-page').waitFor();
 }
 await snapshot('desktop-empty');
 assert.equal(await page.locator('[data-motion-quality]').inputValue(),'heavy');
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile empty page overflow');await snapshot('mobile-empty');
 await page.setViewportSize({width:1440,height:1000});
 for(const [exercise,path,model]of clips.flatMap(([exercise,path])=>['heavy','full'].map(model=>[exercise,path,model]))){
  console.log('Analyze real clip:',exercise,model);const started=Date.now();await analyze(path,model);
  assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'pending');
  assert.match(await page.locator('[data-motion-verdict]').textContent(),/AI 尚未评价/);
  assert.equal(await page.locator('[data-motion-action="save"]').count(),0);
  assert.equal(await page.locator('.motion-score,.motion-checks,.motion-reps,.motion-metric-section').count(),0);
  const observed=await page.evaluate(()=>{
   const output=window.__qaMotionOutput,observations=window.__qaMotionObservations;
   return {duration:output.duration,frameCount:output.frames.length,measurementCount:observations.measurements.length,quality:observations.quality,analysis:{modelVersion:output.modelVersion,decoder:output.decoder,elapsedMs:output.elapsedMs,delegate:output.delegate,sampleFps:output.sampleFps,sourceFps:output.sourceFps},
    matchingTimes:observations.measurements.every((row,index)=>row.frameIndex===index&&row.time===output.frames[index].time),
    validMeasurements:observations.measurements.every(row=>['left','right'].every(side=>Object.values(row[side]).length===6&&Object.values(row[side]).every(value=>value===null||Number.isFinite(value)))),fields:Object.keys(observations)};
  });
  assert(observed.frameCount>30);assert.equal(observed.measurementCount,observed.frameCount);
  assert(observed.quality.validFrames>0);assert(observed.matchingTimes);assert(observed.validMeasurements);
  assert.match(observed.analysis.modelVersion,model==='heavy'?/Heavy float16/:/Full float16/);
  assert.equal(observed.analysis.sampleFps,15);
  assert.equal(await page.locator('[data-motion-quality]').isDisabled(),false);
  assert.deepEqual(observed.fields.filter(key=>key!=='targetTracking').sort(),['measurements','quality','version']);
  measured.push({fixture:exercise,model,wallMs:Date.now()-started,...observed});
  const expected=observed.duration/2;
  await page.locator('[data-motion-video]').evaluate((video,time)=>{video.currentTime=time;},expected);
  await page.waitForFunction(()=>{const video=document.querySelector('[data-motion-video]');return !video.seeking&&video.readyState>=2;});
  assert(Math.abs(await page.locator('[data-motion-video]').evaluate(video=>video.currentTime)-expected)<.15);
  assert(await page.locator('[data-motion-canvas]').evaluate(canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0)),'Real playback draws observed skeleton');
  await snapshot('desktop-'+exercise+'-'+model);
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile result overflow');await snapshot('mobile-'+exercise+'-'+model);
  await page.setViewportSize({width:1440,height:1000});
 }
 assert.equal((await getReports()).length,0,'Unreviewed observations never become a saved AI report');
 assert.equal(requests.filter(r=>r.method==='POST'&&r.url.includes('/api/attachments')).length,0,'Original video must not enter attachment uploads');
 assert.equal(requests.filter(r=>r.method==='POST'&&r.url.includes('/api/motion/coach')).length,0,'Local validation makes no paid AI call');
 await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');
 assert.equal(await page.locator('.motion-history-item').count(),0);
 assert.equal(await page.locator('[data-motion-video]').getAttribute('src'),null);
 assert.equal(await page.locator('[data-motion-action="seek"]').count(),0);
 await snapshot('unreviewed-after-reload');
 // Cancellation and page departure must leave no late result or unhandled error.
 await page.locator('[data-motion-file]').setInputFiles(clips[0][1]);
 await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]')?.disabled);
 await page.locator('[data-motion-action="analyze"]').click();await page.locator('[data-motion-action="cancel"]').click();
 assert.equal(await page.locator('[data-motion-progress]').isVisible(),false);
 await page.locator('[data-motion-action="analyze"]').click();await nav('library');await page.waitForTimeout(300);
 assert.equal(await page.locator('.motion-page').count(),0);
 await nav('motion');
 await page.locator('[data-motion-file]').setInputFiles({name:'corrupt.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});
 await page.locator('[data-motion-error]').waitFor({state:'visible'});assert(await page.locator('[data-motion-action="analyze"]').isDisabled());
 // A failed logout keeps the account open; its remaining page must be usable.
 await page.route('**/api/auth/logout',route=>route.abort('failed'));
 await page.locator('[data-action="logout"]').click();
 await page.locator('[data-motion-metadata]').waitFor({state:'hidden'});
 await page.locator('[data-motion-action="choose"]').first().waitFor();
 const chooser=page.waitForEvent('filechooser');await page.locator('[data-motion-action="choose"]').first().click();
 await chooser;await page.unroute('**/api/auth/logout');
 if(process.env.QA_MOTION_OFFLINE==='1'){
  // Warmed model and application must work after a real offline reload.
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');
  await analyze(clips[0][1],'heavy');assert.equal(await page.locator('[data-motion-verdict]').getAttribute('data-motion-verdict'),'pending');
  assert.equal(await page.locator('[data-motion-action="save"]').count(),0);
  const offline=await page.evaluate(()=>({count:window.__qaMotionObservations.measurements.length,decoder:window.__qaMotionOutput.decoder}));
  assert.equal(offline.count,measured[0].measurementCount);assert.equal(offline.decoder,measured[0].analysis.decoder);
  await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');
  assert.equal(await page.locator('.motion-history-item').count(),0,'Local observations do not become offline AI reports');
  await context.setOffline(false);await page.locator('#sync-status').click();assert.equal((await getReports()).length,0);

 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(dataDir,'results.json'),JSON.stringify({measured,errors,external,checks:['real-pose-inference','complete-objective-measurements','local-only-media','no-local-verdict-or-save','video-seek-and-skeleton-overlay','cancel-navigate','invalid-codec','desktop-mobile-layout','training-knowledge-entries','failed-logout-recovery',...(process.env.QA_MOTION_OFFLINE==='1'?['offline-objective-analysis']:[])]},null,2));
 console.log(JSON.stringify({dataDir,measured:measured.map(x=>({fixture:x.fixture,model:x.model,frames:x.frameCount,measurements:x.measurementCount,usableRatio:x.quality.usableRatio,analysisMs:x.analysis.elapsedMs,duration:x.duration,delegate:x.analysis.delegate})),errors,external},null,2));
}catch(error){await snapshot('failure').catch(()=>{});console.error('QA artifacts:',dataDir);throw error;}
finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
