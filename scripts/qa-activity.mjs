// Uses an isolated database/browser profile; QA_PLAYWRIGHT can point to an existing install.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {startServer} from '../server.mjs';
import {extendedMotionIds} from '../精细模型与动作开发/motion-poses.js';
import {activityProfiles} from '../精细模型与动作开发/activity-profiles.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'.qa'),{recursive:true});
const output=await mkdtemp(join(root,'.qa','activity-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
const server=await startServer({host:'127.0.0.1',port:0,dataDir:output});
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const errors=[],checks=[];
try{
  browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1100,height:1050},reducedMotion:'reduce'});
  await context.addInitScript(()=>{
    window.qaDraws=0;window.qaColors=[];
    for(const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext])if(type){
      const names=new WeakMap(),lookup=type.prototype.getUniformLocation;
      type.prototype.getUniformLocation=function(program,name){const loc=lookup.call(this,program,name);if(loc)names.set(loc,name);return loc;};
      for(const method of ['uniform3f','uniform3fv']){
        const original=type.prototype[method];
        type.prototype[method]=function(loc,...args){
          if(names.get(loc)==='diffuse'){
            window.qaColors.push((method==='uniform3f'?args:Array.from(args[0])).map(n=>Number(n.toFixed(5))));
            if(window.qaColors.length>300)window.qaColors.shift();
          }
          return original.call(this,loc,...args);
        };
      }
      for(const method of ['drawElements','drawArrays']){
        const original=type.prototype[method];
        type.prototype[method]=function(...args){window.qaDraws++;return original.apply(this,args);};
      }
    }
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(base+'/qa-host',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><iframe id="model" title="模型" style="width:100%;height:1000px;border:0" src="/model/index.html?exercise=squat&embed=1"></iframe>'}));
  await page.goto(base+'/qa-host');
  const frame=await (await page.locator('#model').elementHandle()).contentFrame();
  await frame.locator('#loading').waitFor({state:'hidden'});
  assert.equal(await frame.locator('#play').getAttribute('aria-label'),'播放动画','Reduced motion starts paused');
  const colors=()=>frame.evaluate(()=>[...new Set(window.qaColors.map(c=>c.join(',')))].sort());
  async function scrub(value){
    // Reset the draw counter and dispatch in one JS task, so a pending load or
    // camera render cannot satisfy the wait before the requested pose renders.
    const before=await frame.locator('#progress').evaluate((el,value)=>{window.qaColors=[];const before=window.qaDraws;el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));return before;},value);
    await frame.waitForFunction(before=>window.qaDraws>before,before);
    return colors();
  }
  async function send(data){
    await page.evaluate(data=>document.querySelector('iframe').contentWindow.postMessage(data,location.origin),data);
  }
  for(const exercise of ['squat','pushup','curl']){
    await send({type:'fitness:exercise',exercise});
    await frame.waitForFunction(id=>document.documentElement.dataset.exercise===id,exercise);
    const rest=await scrub(0),returnColors=await scrub(335);
    assert.match(await frame.locator('#contraction-state').textContent(),exercise==='curl'?/向心阶段/:/离心阶段/);
    const contractColors=await scrub(750);
    assert.match(await frame.locator('#contraction-state').textContent(),exercise==='curl'?/离心阶段/:/向心阶段/);
    assert(rest.length>0,'Capture real WebGL material colors');
    assert.notDeepEqual(rest,contractColors);
    assert.deepEqual(returnColors,contractColors,'Equal poses in the teaching profile stay synchronized in both directions');
    assert.equal(await frame.evaluate(()=>document.documentElement.dataset.activityValid),'true');
    assert.equal(await frame.locator('#force-load').count(),0,'Teaching view no longer asks for force simulation loads');
    assert.match(await frame.locator('#pose-kind').textContent(),/发力示意/);
    assert(!/\d+ N|牛顿|无解/.test(await frame.locator('#activity-panel').textContent()));
    const core=frame.locator('[data-activity-muscle="core"] strong');
    for(const progress of [0,100,200,300,400,450,500,550,600,650,700,800,900,1000]){
      await scrub(progress);
      assert.equal(await frame.evaluate(()=>document.documentElement.dataset.activityValid),'true',`${exercise}: valid throughout movement`);
      assert.equal(await core.textContent(),'持续稳定');
    }
    await scrub(750);await page.screenshot({path:join(output,`${exercise}-dynamic.png`)});
    await scrub(550);assert.match(await frame.locator('#contraction-state').textContent(),/方向转换/);
    await page.screenshot({path:join(output,`${exercise}-turn.png`)});
    if(exercise==='pushup'){
      await frame.locator('[data-view="side"]').click();
      await page.screenshot({path:join(output,'pushup-turn-side.png')});
      await frame.locator('[data-view="angle"]').click();
    }
    if(exercise==='curl'){
      const biceps=frame.locator('[data-activity-muscle="biceps"] strong');
      assert.match(await biceps.textContent(),/76%/,'Far end need not be the maximum');
      await scrub(397);assert.match(await biceps.textContent(),/100%/,'Near-horizontal forearm is the authored teaching peak');
      await page.screenshot({path:join(output,'curl-peak.png')});
    }
    assert.deepEqual(await scrub(960),rest,'Finishing the rep restores its starting posture colors');
    assert.match(await frame.locator('#contraction-state').textContent(),/保持/);
    assert.equal(await frame.locator('#phase-number').textContent(),'01 / 03');
    for(const speed of ['0.5×','0.25×','1×']){
      await frame.locator('#speed').click();
      assert.equal(await frame.locator('#speed').textContent(),speed);
      assert.deepEqual(await scrub(750),contractColors,'Playback speed must not change relative colors at the same pose');
    }
    await frame.locator('#dynamic-colors').click();
    assert.equal(await frame.locator('#dynamic-colors').getAttribute('aria-pressed'),'false');
    assert.deepEqual(await scrub(335),await scrub(750),'Fixed colors stay the same across animation phases');
    await frame.locator('#dynamic-colors').click();
    await frame.locator('#play').click();
    const start=Number(await frame.locator('#progress').inputValue());
    await frame.waitForFunction(start=>Number(document.querySelector('#progress').value)!==start,start);
    await frame.locator('#play').click();
    const paused=await frame.locator('#progress').inputValue();
    await sleep(100);
    const pausedColors=await colors(),pausedDraws=await frame.evaluate(()=>window.qaDraws);
    await sleep(300);
    assert.equal(await frame.locator('#progress').inputValue(),paused);
    assert.deepEqual(await colors(),pausedColors);
    assert.equal(await frame.evaluate(()=>window.qaDraws),pausedDraws,'Pausing also stops color renders');
    await frame.locator('#highlight').click();
    assert(await frame.locator('#dynamic-colors').isDisabled());
    assert.deepEqual(await scrub(335),await scrub(750),'Hidden muscles do not animate colors');
    await frame.locator('#highlight').click();
    checks.push(`${exercise}: relative shader colors, stable support muscles, full-cycle validity, illustrative labels, phase labels, all playback speeds, pause freeze, scrub, hidden highlights`);
  }
  for(const exercise of extendedMotionIds){
    await send({type:'fitness:exercise',exercise});
    await frame.waitForFunction(id=>document.documentElement.dataset.exercise===id,exercise);
    assert(await frame.locator('#playback').isVisible());
    assert(await frame.locator('#activity-controls').isVisible());
    const start=await scrub(0),middle=await scrub(335),end=await scrub(550);
    assert.equal(await frame.evaluate(()=>document.documentElement.dataset.activityValid),'true');
    if(exercise==='plank'){
      assert.deepEqual(start,middle);assert.deepEqual(start,end);
      assert.equal(await frame.locator('#contraction-state').textContent(),'等长支撑');
      assert.equal(await frame.locator('[data-activity-muscle="core"] strong').textContent(),'持续用力');
    }else{
      assert.notDeepEqual(start,middle,exercise+': colors vary with pose');
      assert.deepEqual(await scrub(750),middle,exercise+': returning colors match');
      assert.match(await frame.locator('#contraction-state').textContent(),activityProfiles[exercise].firstContraction==='concentric'?/离心/:/向心/);
      assert.deepEqual(await scrub(1000),start,exercise+': cycle closes');
    }
    for(const [label,value] of [['start',0],['middle',335],['end',550]]){
      await scrub(value);
      await frame.locator('#viewport').screenshot({path:join(output,exercise+'-'+label+'.png')});
    }
    await frame.locator('[data-view="side"]').click();await scrub(550);
    await frame.locator('#viewport').screenshot({path:join(output,exercise+'-side.png')});
    checks.push(exercise+': playback, relative colors, cycle closure, start/middle/end/side previews');
  }
  // Click the visible torso in the actual canvas, then restore via muscle chip.
  await send({type:'fitness:exercise',exercise:'squat'});
  await frame.waitForFunction(()=>document.documentElement.dataset.exercise==='squat');
  await scrub(0);await frame.locator('[data-view="front"]').click();
  const canvas=frame.locator('canvas');const box=await canvas.boundingBox();
  let selected=false;
  for(const y of [.37,.42,.48,.55]){
    await canvas.click({position:{x:box.width*.5,y:box.height*y}});
    selected=await frame.evaluate(()=>!!document.documentElement.dataset.selectedStructure);
    if(selected)break;
  }
  assert(selected,'Picking the actual body selects an exact muscle');
  assert(await frame.locator('#dynamic-colors').isDisabled());
  await frame.locator('[data-muscle="quads"]').click();
  assert(await frame.locator('#dynamic-colors').isEnabled());
  checks.push('Exact structure picking remains fixed; selecting a muscle group restores dynamic colors');
  await send({type:'fitness:exercise',exercise:'bench'});
  await frame.waitForFunction(()=>document.documentElement.dataset.exercise==='bench');
  assert(await frame.locator('#activity-controls').isVisible());
  await send({type:'fitness:muscle',muscle:'traps'});
  await frame.waitForFunction(()=>document.documentElement.dataset.mode==='atlas');
  assert(await frame.locator('#activity-controls').isHidden());
  await sleep(1000);const stopped=await frame.evaluate(()=>window.qaDraws);await sleep(300);
  assert.equal(await frame.evaluate(()=>window.qaDraws),stopped,'Atlas has no permanent color render loop');
  checks.push('Anatomy keeps fixed colors and settles rendering');
  await send({type:'fitness:exercise',exercise:'curl'});
  await frame.waitForFunction(()=>document.documentElement.dataset.exercise==='curl');
  await frame.locator('#play').click();
  await send({type:'fitness:visibility',visible:false});await sleep(200);
  const hidden=await frame.evaluate(()=>({draws:window.qaDraws,progress:document.querySelector('#progress').value}));
  await sleep(300);
  assert.deepEqual(await frame.evaluate(()=>({draws:window.qaDraws,progress:document.querySelector('#progress').value})),hidden);
  await send({type:'fitness:visibility',visible:true});
  await frame.waitForFunction(draws=>window.qaDraws>draws,hidden.draws);
  await frame.locator('#play').click();
  checks.push('Closing the viewer stops drawing and advancing; reopening resumes');
  await page.setViewportSize({width:390,height:1000});
  await frame.locator('#dynamic-colors').scrollIntoViewIfNeeded();
  assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile horizontal overflow');
  await page.screenshot({path:join(output,'mobile.png')});
  const compact=await context.newPage();compact.on('pageerror',error=>errors.push(error.message));
  await compact.goto(base+'/model/index.html?exercise=curl&embed=1&compact=1');
  await compact.locator('#loading').waitFor({state:'hidden'});
  assert.match(await compact.locator('#pose-kind').textContent(),/发力示意/,'Compact chat cards retain the teaching label');
  await compact.close();
  checks.push('Compact chat view keeps the illustration label');
  assert.deepEqual(errors,[]);
  await writeFile(join(output,'result.json'),JSON.stringify({passed:true,checks,errors},null,2));
  console.log(JSON.stringify({passed:true,checks,output}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
