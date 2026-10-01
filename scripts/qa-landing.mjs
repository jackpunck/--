// Public landing + real authentication, using an isolated database and browser.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';

const root=process.cwd();
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','landing-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||'精细模型与动作开发/node_modules/playwright/index.mjs')));
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(12000);
const errors=[],mutations=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')mutations.push(request.url());});
const screenshot=name=>page.screenshot({path:join(dataDir,name+'.png'),style:'#toasts{visibility:hidden}'});
let step='initial landing';
try {
  await page.goto(base);await page.locator('.landing-hero').waitFor();
  await page.locator('#landing-heading').waitFor();
  assert.equal(await page.locator('.landing canvas').count(),0);
  assert.equal(await page.locator('#auth-form').count(),1);
  assert.equal(await page.evaluate(()=>scrollY),0);
  await screenshot('desktop-hero');
  for(const width of [1440,1024,768,390,360]){
    await page.setViewportSize({width,height:width<700?844:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`);
    for(const id of ['landing-story','landing-training','landing-nutrition','landing-companion','start']){
      await page.locator('#'+id).scrollIntoViewIfNeeded();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${id} overflow at ${width}`);
    }
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await screenshot('mobile-hero');

  step='menu keyboard navigation and feature demos';
  await page.locator('.landing-menu-toggle').click();
  await page.locator('#landing-menu').waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#landing-menu').isVisible(),false);
  await page.locator('.landing-menu-toggle').click();
  await page.locator('#landing-menu a[href="#landing-features"]').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'landing-features-title');
  await page.locator('[data-demo=meal]').click();
  assert.equal(await page.locator('[data-meal-name]').innerText(),'轻盈早餐');
  await page.locator('[data-demo=chat]').click();
  assert.match(await page.locator('.demo-question').innerText(),/练腿/);
  await page.locator('[data-demo=exercise]').click();
  assert.match(await page.locator('[data-exercise-name]').innerText(),/PUSH UP/);

  step='demo completion does not write account data';
  for(const task of await page.locator('.landing-demo-task').all())await task.click();
  assert.match(await page.locator('.landing-demo-progress>span').innerText(),/完成！/);
  assert.equal(mutations.length,0);
  await page.locator('.landing-demo-task').first().click();
  assert.match(await page.locator('.landing-demo-progress>span').innerText(),/2 \/ 3/);
  await screenshot('mobile-training-demo');

  step='motion preferences and navigation';
  assert.equal(await page.locator('.reel-orbits i').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await page.locator('.reel-orbits i').first().evaluate(el=>getComputedStyle(el).animationName),'reel-orbit');
  await page.locator('.landing-motion').click();
  assert.equal(await page.locator('.reel-orbits i').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.locator('.landing-motion').click();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>window.ScrollTrigger.getAll().length===0);

  step='GSAP motion and pause cleanup';
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>window.ScrollTrigger.getAll().length>0);
  await page.evaluate(()=>scrollTo(0,0));
  await page.locator('.landing-motion').click();
  assert.equal(await page.evaluate(()=>window.ScrollTrigger.getAll().length),0);
  assert.equal(await page.locator('.landing-story-text span').first().evaluate(el=>getComputedStyle(el).opacity),'1');
  await page.locator('.landing-motion').click();
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.landing-login').click();
  const formTop=await page.locator('#auth-entry').evaluate(el=>el.getBoundingClientRect().top);
  assert(formTop>=70&&formTop<250,`Mobile auth entry should be visible, got ${formTop}`);
  assert.equal(await page.locator('#name').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'landing-auth-heading');

  step='real registration, profile, logout and login';
  const email=`landing-${Date.now()}@example.test`,password='landing-password-123';
  await page.locator('#email').fill(email);
  await page.locator('.auth-tabs [data-mode=register]').click();
  assert.equal(await page.locator('#email').inputValue(),email);
  assert.equal(await page.locator('.landing-hero').count(),1);
  await screenshot('mobile-auth');
  await page.locator('#name').fill('循序展示验证');
  await page.locator('#password').fill(password);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>window.ScrollTrigger.getAll().length>0);
  await page.locator('#auth-form button[type=submit]').click();
  await page.locator('#profile-form').waitFor();
  await page.locator('#profile-form button[type=submit]').click();
  await page.locator('#profile-form').waitFor({state:'hidden'});
  await page.locator('#chat-input').waitFor();
  assert.equal(await page.locator('.landing').count(),0);
  assert.equal(await page.evaluate(()=>window.ScrollTrigger.getAll().length),0);
  assert.equal(await page.evaluate(()=>scrollY),0);
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-action=logout]').click();await page.locator('.landing-hero').waitFor();
  await page.locator('.landing-login').click();
  await page.locator('#email').fill(email);await page.locator('#password').fill('wrong-password-123');
  await page.locator('#auth-form button[type=submit]').click();
  await page.locator('#auth-error .error-box').waitFor();
  assert.equal(await page.locator('#email').inputValue(),email);
  await page.locator('#password').fill(password);await page.locator('#auth-form button[type=submit]').click();
  await page.locator('#chat-input').waitFor();
  await page.locator('[data-action=logout]').click();await page.locator('.landing-hero').waitFor();

  step='scroll reveal and offline landing assets';
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#landing-training').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('#landing-training .project-visual').classList.contains('is-visible'));
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const [name,selector] of [['desktop-training','#landing-training'],['desktop-nutrition','#landing-nutrition'],['desktop-companion','#landing-companion'],['desktop-auth','#start']]){
    await page.locator(selector).scrollIntoViewIfNeeded();await screenshot(name);
  }
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);await page.reload();await page.locator('.landing-hero').waitFor();
  await page.locator('#landing-heading').waitFor();
  assert.equal(await page.locator('.landing canvas').count(),0);
  await page.locator('.landing-login').click();await page.locator('#auth-form').waitFor();
  assert.equal(errors.length,0,errors.join('\n'));
  const result={passed:true,dataDir,widths:[1440,1024,768,390,360],checks:'text hero without canvas, responsive story, menu keyboard navigation, feature demos, GSAP cleanup, motion toggle, reduced motion, direct auth entry, email preservation, real register/login/error/logout, profile, animation cleanup, scroll reveal, offline landing',errors};
  await writeFile(join(dataDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error('FAILED STEP:',step,errors);await screenshot('failure').catch(()=>{});throw error;}
finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
