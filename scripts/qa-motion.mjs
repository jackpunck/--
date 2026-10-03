// Real local-video inference through the application, isolated account/database.
// Usage: QA_PLAYWRIGHT=... node scripts/qa-motion.mjs [squat.mp4] [pushup.mp4]
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
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
const page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[],external=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{requests.push({url:r.url(),method:r.method()});if(/^https?:/.test(r.url())&&!r.url().startsWith(base))external.push(r.url());});
const nav=async name=>{if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator(`.nav [data-page="${name}"]`).click();};
const snapshot=async name=>{await page.screenshot({path:join(dataDir,name+'.png'),fullPage:true});};
const getReports=async()=>{const r=await context.request.get(base+'/api/state');assert.equal(r.status(),200);return(await r.json()).records.filter(r=>r.kind==='motion-assessment'&&!r.deleted);};
const analyze=async path=>{
 await page.locator('[data-motion-file]').setInputFiles(path);
 await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]')?.disabled);
 await page.locator('[data-motion-action="analyze"]').click();
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
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile empty page overflow');await snapshot('mobile-empty');
 await page.setViewportSize({width:1440,height:1000});
 for(const [exercise,path]of clips){
  console.log('Analyze real clip:',exercise);const started=Date.now();await analyze(path);
  await page.locator('[data-motion-action="save"]').waitFor();await page.locator('[data-motion-action="save"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-motion-action="save"]')?.textContent==='已保存报告');
  await page.locator('#sync-status').click();
  const reports=await getReports(),latest=reports.find(r=>r.data.exerciseId===exercise);assert(latest,`Expected automatic ${exercise} recognition`);
  assert.equal(latest.data.status,'complete');assert(latest.data.reps.length>0);assert(latest.data.score>=0&&latest.data.score<=100);
  assert(!('frames'in latest.data));assert(!JSON.stringify(latest.data).includes('blob:'));
  assert(latest.data.reps.every(r=>r.start<r.bottom&&r.bottom<r.end));
  measured.push({exercise,wallMs:Date.now()-started,...latest.data});
  const target=page.locator('[data-motion-action="seek"]').first(),expected=Number(await target.getAttribute('data-time'));
  await target.click();await page.waitForFunction(()=>{const v=document.querySelector('[data-motion-video]');return !v.seeking&&v.readyState>=2;});assert(Math.abs(await page.locator('[data-motion-video]').evaluate(v=>v.currentTime)-expected)<0.15);
  await snapshot('desktop-'+exercise);
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile result overflow');await snapshot('mobile-'+exercise);
  await page.setViewportSize({width:1440,height:1000});
 }
 assert.equal((await getReports()).length,2);
 await page.locator('[data-motion-action="exercise"]').click();
 await page.locator('#model-dialog[open][data-target-key="exercise:pushup"]').waitFor();
 await page.waitForFunction(()=>document.querySelector('#model-dialog .model-viewer-stage')?.getAttribute('aria-busy')==='false',{},{timeout:60000});
 await page.locator('[data-model-close]').click();
 assert.equal(requests.filter(r=>r.method==='POST'&&r.url.includes('/api/attachments')).length,0,'Original video must not enter attachment uploads');
 // Actual report persistence, with no fake replay of a lost local file.
 await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');
 assert.equal(await page.locator('.motion-history-item').count(),2);
 await page.locator('[data-motion-action="history"]').first().click();
 assert.equal(await page.locator('[data-motion-video]').getAttribute('src'),null);
 assert.equal(await page.locator('[data-motion-action="seek"]').count(),0);
 await snapshot('saved-report');
 // Cancellation and page departure must leave no late result or unhandled error.
 await page.locator('[data-motion-file]').setInputFiles(clips[0][1]);
 await page.waitForFunction(()=>!document.querySelector('[data-motion-action="analyze"]')?.disabled);
 await page.locator('[data-motion-action="analyze"]').click();await page.locator('[data-motion-action="cancel"]').click();
 assert.equal(await page.locator('[data-motion-progress]').isVisible(),false);
 await page.locator('[data-motion-action="analyze"]').click();await nav('library');await page.waitForTimeout(300);
 assert.equal(await page.locator('.motion-page').count(),0);
 await nav('motion');await page.locator('[data-motion-action="delete"]').first().click();
 await page.waitForFunction(()=>document.querySelectorAll('.motion-history-item').length===1);
 await page.locator('#sync-status').click();assert.equal((await getReports()).length,1);
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
  await analyze(clips[0][1]);await page.locator('[data-motion-action="save"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-motion-action="save"]')?.textContent==='已保存报告');
  await page.reload();await page.locator('#chat-input').waitFor();await nav('motion');
  assert.equal(await page.locator('.motion-history-item').count(),2,'Offline report persists in IndexedDB');
  await context.setOffline(false);await page.locator('#sync-status').click();
  const synced=await getReports();assert.equal(synced.length,2,'Offline report syncs after reconnecting');
  const offlineReport=synced.sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt))[0];
  assert.equal(offlineReport.data.analysis.decoder,measured[0].analysis.decoder,'Offline cache preserves the same decoder path');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(dataDir,'results.json'),JSON.stringify({measured,errors,external,checks:['auto-recognition','complete-repetitions','local-only-media','save-sync-reload-delete','timestamp-replay','cancel-navigate','invalid-codec','desktop-mobile-layout','training-knowledge-entries','3d-teaching','failed-logout-recovery',...(process.env.QA_MOTION_OFFLINE==='1'?['offline-analysis-save-reload-sync']:[])]},null,2));
 console.log(JSON.stringify({dataDir,measured:measured.map(x=>({exercise:x.exercise,score:x.score,reps:x.reps.length,analysisMs:x.analysis.elapsedMs,duration:x.video.duration})),errors,external},null,2));
}catch(error){await snapshot('failure').catch(()=>{});console.error('QA artifacts:',dataDir);throw error;}
finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
