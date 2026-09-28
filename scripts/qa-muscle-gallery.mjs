// Capture every public muscle atlas entry for review against anatomical references.
// Screenshots and mesh-name checks do not independently certify the source anatomy.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';
import {muscleCatalog,modelUrl} from '../public/visuals.js';
import {structureLabel,muscleGroups} from '../精细模型与动作开发/muscle-data.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const requested=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',');
const trapezius=process.argv.includes('--trapezius');
const selected=trapezius?['l','r'].flatMap(side=>[
  ['upper','Descending'],['middle','Transverse'],['lower','Ascending'],
].map(([part,term])=>({id:`traps-${part}-${side}`,structure:`${term} part of trapezius muscle.${side}`,name:`斜方肌${{upper:'上部',middle:'中部',lower:'下部'}[part]}（${side==='l'?'左':'右'}侧）`}))):muscleCatalog.filter(m=>!requested||requested.includes(m.id));
assert(selected.length,'No matching muscle IDs');
if(requested)assert(requested.every(id=>muscleCatalog.some(m=>m.id===id)),'Unknown muscle ID');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','muscle-gallery-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const checks=[],errors=[],failures=[];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try{
  browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1050,height:850},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failures.push(`${response.status()} ${response.url()}`);});
  for(const muscle of selected){
    console.log(`Capture ${muscle.id} · ${muscle.name}`);
    const url=muscle.structure?'/model/index.html?'+new URLSearchParams({mode:'atlas',structure:muscle.structure,embed:'1',compact:'1'}):modelUrl('muscle',muscle.id,{compact:true});
    await page.goto(base+url);
    await page.locator('#loading').waitFor({state:'hidden',timeout:60000});
    assert.equal(await page.locator('html').getAttribute('data-mode'),'atlas');
    assert.equal(await page.locator('html').getAttribute(muscle.structure?'data-selected-structure':'data-selected-muscle'),muscle.structure||muscle.id);
    const actualName=await page.locator('#picked-name').textContent();
    assert.equal(actualName,muscle.structure?structureLabel(muscle.structure):muscleGroups[muscle.id].name);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('#viewport').screenshot({path:join(dataDir,muscle.id+'.png')});
    checks.push({id:muscle.id,name:muscle.name,poseKind:actualName,muscles:muscle.structure||muscle.id,file:muscle.id+'.png'});
  }
  await page.goto('about:blank');
  const css='body{margin:0;padding:20px;background:#e9eddf;color:#263e31;font:14px system-ui,"Microsoft YaHei",sans-serif}h1{font-size:21px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat('+ (trapezius?3:5) +',1fr);gap:10px}.card{border:1px solid #b5c5a5;background:white;border-radius:8px;overflow:hidden}.card>div{padding:10px;height:55px;box-sizing:border-box}.card strong{display:block;font-size:13px}.card small{color:#69805d;font-size:10px}.card img{width:100%;height:285px;object-fit:contain;background:#f0f2e9;display:block}';
  const galleryPage=await context.newPage();await galleryPage.setViewportSize({width:1850,height:770});
  for(let offset=0;offset<checks.length;offset+=10){
    const slice=checks.slice(offset,offset+10),index=Math.floor(offset/10)+1;
    await galleryPage.setViewportSize({width:1850,height:slice.length>5?790:435});
    const cards=await Promise.all(slice.map(async item=>`<article class="card"><div><strong>${escape(item.name)}</strong><small>${escape(item.id)} · ${escape(item.poseKind)}</small></div><img src="data:image/png;base64,${(await readFile(join(dataDir,item.file))).toString('base64')}" alt="${escape(item.name)}"></article>`));
    await galleryPage.setContent(`<html><head><meta charset="utf-8"><style>${css}</style></head><body><h1>肌肉名称与位置核对 · ${index}</h1><div class="grid">${cards.join('')}</div></body></html>`);
    await galleryPage.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
    await galleryPage.screenshot({path:join(dataDir,`contact-${index}.png`),fullPage:true});
  }
  await writeFile(join(dataDir,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}</style><title>肌肉图谱核对</title><h1>肌肉图谱核对 · ${checks.length} 项</h1><div class="grid">${checks.map(item=>`<article class="card"><div><strong>${escape(item.name)}</strong><small>${escape(item.id)} · ${escape(item.poseKind)}</small></div><a href="${item.file}"><img src="${item.file}" alt="${escape(item.name)}"></a></article>`).join('')}</div></html>`);
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  const result={dataDir,count:checks.length,checks,errors,failures,visualReview:'Pending visual inspection of each highlight against anatomical references.'};
  await writeFile(join(dataDir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({dataDir,count:checks.length,errors,failures}));
}catch(error){await writeFile(join(dataDir,'failure.json'),JSON.stringify({message:error.message,checks,errors,failures},null,2));throw error;}
finally{await browser?.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
