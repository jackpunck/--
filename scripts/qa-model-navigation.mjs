import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import * as T from '../精细模型与动作开发/node_modules/three/build/three.module.js';
import {startServer} from '../server.mjs';
const root=process.cwd();await mkdir(join(root,'.qa'),{recursive:true});const output=await mkdtemp(join(root,'.qa/zoom-'));
const {chromium}=await import(pathToFileURL(process.env.QA_PLAYWRIGHT||'C:/Users/link/Desktop/健身助手1/精细模型与动作开发/node_modules/playwright/index.mjs'));
const server=await startServer({host:'127.0.0.1',port:0,dataDir:output}),base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
const errors=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.qaMatrices={};
  for(const type of [WebGLRenderingContext,WebGL2RenderingContext]){
   const locations=new WeakMap(),programs=new WeakMap(),get=type.prototype.getUniformLocation,put=type.prototype.uniformMatrix4fv;
   type.prototype.getUniformLocation=function(program,name){const location=get.call(this,program,name);if(location)locations.set(location,{program,name});return location;};
   type.prototype.uniformMatrix4fv=function(location,transpose,value){
    const info=locations.get(location);
    if(info){const state=programs.get(info.program)||{};programs.set(info.program,state);
     if(info.name==='projectionMatrix')state.projection=Array.from(value);
     if(info.name==='modelViewMatrix')state.modelView=Array.from(value);
     if(info.name==='viewMatrix')state.view=Array.from(value);
     if(info.name==='bindMatrix')state.skinned=true;
     // The anatomy batches have identity model matrices. This also covers
     // compact shaders where the redundant viewMatrix uniform is optimized out.
     if(state.projection?.[15]===0){window.qaMatrices.projectionMatrix=state.projection;if(state.view||state.skinned&&state.modelView)window.qaMatrices.viewMatrix=state.view||state.modelView;}
    }
    return put.call(this,location,transpose,value);
   };
  }
 });
 const settle=async()=>{await page.evaluate(()=>{window.qaStable=0;window.qaPrevious=null;});await page.waitForFunction(()=>{const m=window.qaMatrices.viewMatrix;if(!m)return false;const same=window.qaPrevious&&m.every((x,i)=>Math.abs(x-window.qaPrevious[i])<.00001);window.qaPrevious=[...m];window.qaStable=same?window.qaStable+1:0;return window.qaStable>=4;},{},{polling:100});};
 const matrix=async()=>{const m=await page.evaluate(()=>window.qaMatrices);return {view:new T.Matrix4().fromArray(m.viewMatrix),projection:new T.Matrix4().fromArray(m.projectionMatrix)};};
 const cam=m=>new T.Vector3().setFromMatrixPosition(m.view.clone().invert());
 const project=(p,m)=>p.clone().applyMatrix4(m.view).applyMatrix4(m.projection);
 for(const [name,url] of [['motion','?exercise=chest-press&embed=1'],['atlas','?mode=atlas&embed=1'],['compact','?exercise=curl&embed=1&compact=1']]){
  await page.goto(base+'/model/index.html'+url);await page.locator('#loading').waitFor({state:'hidden'});await page.waitForFunction(()=>!!window.qaMatrices.viewMatrix&&!!window.qaMatrices.projectionMatrix);await page.locator('[data-view="front"]').click();await page.waitForTimeout(120);
  const box=await page.locator('canvas').boundingBox();
  for(const [x,y] of [[.69,.42],[.34,.65]]){
   await page.locator('[data-view="front"]').click();await page.waitForTimeout(100);
   const before=await matrix(),origin=cam(before),ray=new T.Vector3(x*2-1,1-y*2,.5).applyMatrix4(before.projection.clone().invert()).applyMatrix4(before.view.clone().invert()).sub(origin).normalize(),point=origin.clone().addScaledVector(ray,5);
   await page.mouse.move(box.x+box.width*x,box.y+box.height*y);await page.mouse.wheel(0,-450);await page.waitForTimeout(180);
   const after=await matrix(),projected=project(point,after),delta=cam(after).sub(origin);
   assert(delta.length()>.1,'Wheel actually moves camera');assert(Math.abs(projected.x-(x*2-1))<.004&&Math.abs(projected.y-(1-y*2))<.004,'Pointer ray stays under the cursor');assert(delta.normalize().dot(ray)>.9999,'Dolly moves along pointer ray, not global center');
   const zoomed=cam(after);await page.mouse.wheel(0,200);await page.waitForTimeout(120);assert(cam(await matrix()).distanceTo(origin)<zoomed.distanceTo(origin),'Wheel out reverses zoom');
  }
  await page.screenshot({path:join(output,name+'-cursor.png')});
  const beforePan=await matrix();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down({button:'right'});await page.mouse.move(box.x+box.width*.65,box.y+box.height*.52,{steps:8});await page.mouse.up({button:'right'});await settle();assert(cam(await matrix()).distanceTo(cam(beforePan))>.05,'Right drag pans');assert.equal(await page.locator('html').getAttribute('data-selected-structure'),'','Panning does not select anatomy');
  const preserved=await matrix();await page.setViewportSize({width:1050,height:980});await page.waitForTimeout(150);assert(cam(await matrix()).distanceTo(cam(preserved))<.01,'Resize preserves inspected detail');await page.setViewportSize({width:1100,height:1000});
  await page.locator('[data-view="front"]').click();await page.waitForTimeout(100);const reset=await matrix();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5,{steps:8});await page.mouse.up();await settle();assert(cam(await matrix()).distanceTo(cam(reset))>.05,'Left drag still rotates');
  await page.locator('[data-view="front"]').click();await settle();assert(cam(await matrix()).distanceTo(cam(reset))<.001,'View button restores framing');checks.push(name+': cursor anchor, zoom out, pan, resize, orbit and reset');
 }
 assert.deepEqual(errors,[]);await writeFile(join(output,'result.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,output}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
