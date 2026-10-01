// Verify the offline bundle and browsers that cannot create a Worker.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';
const root=resolve(import.meta.dirname,'..');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','model-loading-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const checks=[],errors=[];
try{
  for(const offline of [true,false]){
    const context=await browser.newContext();
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    if(!offline)await page.addInitScript(()=>{window.Worker=class{constructor(){throw new Error('Test browser without workers');}};});
    const url=offline?pathToFileURL(join(root,'精细模型与动作开发/index.html')).href:`http://127.0.0.1:${server.address().port}/model/index.html`;
    await page.goto(url+'?exercise=bench');
    await page.locator('#loading').waitFor({state:'hidden',timeout:60000});
    assert.equal(await page.locator('html').getAttribute('data-exercise'),'bench');
    assert.equal(await page.locator('canvas').count(),1);
    await page.screenshot({path:join(dataDir,offline?'offline.png':'worker-fallback.png')});
    checks.push(offline?'file:// self-contained bundle':'HTTP main-thread fallback after Worker refusal');
    await context.close();
  }
  assert.deepEqual(errors,[]);
  const result={passed:true,dataDir,checks,errors};await writeFile(join(dataDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
