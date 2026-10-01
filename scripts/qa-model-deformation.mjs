// Multi-phase, multi-view review of actual WebGL deformation, with isolated data.
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {startServer} from '../server.mjs';
import {exercises} from '../public/domain.js';
const root=resolve(import.meta.dirname,'..'),ids=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',');
await mkdir(join(root,'.qa'),{recursive:true});const dataDir=await mkdtemp(join(root,'.qa','deformation-'));console.log(dataDir);
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
const server=await startServer({host:'127.0.0.1',port:0,dataDir}),browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const errors=[],checks=[];
try{
  const page=await browser.newPage({viewport:{width:900,height:840}}),sheet=await browser.newPage({viewport:{width:1800,height:1050}});page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
  for(const exercise of exercises.filter(e=>!ids||ids.includes(e.id))){
    await page.goto(`http://127.0.0.1:${server.address().port}/model/index.html?exercise=${exercise.id}&embed=1`);await page.locator('#loading').waitFor({state:'hidden',timeout:60000});
    const focus=['squat','goblet-squat','lunge','leg-curl','leg-extension','calf-raise'].includes(exercise.id)?'lower':['pushup','bench','plank','glute-bridge','crunch'].includes(exercise.id)?'full':'upper';
    await page.locator('#focus').selectOption(focus);await page.locator('#highlight').click();
    const images=[];
    for(const view of ['front','back','side'])for(const phase of [0,335,550]){
      await page.locator('#progress').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},phase);
      await page.locator(`[data-view=${view}]`).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const file=`${exercise.id}-${view}-${phase}.png`;await page.locator('#viewport').screenshot({path:join(dataDir,file)});images.push({file,view,phase});
    }
    await sheet.setContent(`<body style="margin:0;background:#eef2e8;font:18px sans-serif"><h2>${exercise.id} · ${exercise.name}</h2><main style="display:grid;grid-template-columns:repeat(3,1fr)">${(await Promise.all(images.map(async item=>`<div>${item.view} / ${item.phase}<img style="width:100%;height:310px;object-fit:contain" src="data:image/png;base64,${(await readFile(join(dataDir,item.file))).toString('base64')}"></div>`))).join('')}</main></body>`);
    await sheet.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await sheet.screenshot({path:join(dataDir,exercise.id+'-sheet.png'),fullPage:true});checks.push({id:exercise.id,images});console.log(exercise.id);
  }
  assert.deepEqual(errors,[]);await writeFile(join(dataDir,'result.json'),JSON.stringify({dataDir,checks,errors},null,2));
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
