// Browser regression for the 2-core/4-GB deployment: server business math,
// client video analysis. Uses a temporary account/database and no real AI.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';
import {generateGroupedPlan} from '../public/domain.js';
import {localDate,addDays,recurringCalendarTasks} from '../public/schedule.js';
const root=process.cwd(),output=await mkdtemp(join(root,'.qa/server-compute-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||'.qa/browser-tools/node_modules/playwright/index.mjs')));
const server=await startServer({dataDir:output,host:'127.0.0.1',port:0,holidayFetchImpl:async()=>new Response('{}',{status:404}),fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items:[{name:'测试餐食',grams:100,protein:10,carbs:20,fat:5,kcal:165}],note:'测试餐食估算'})}}]}),{headers:{'Content-Type':'application/json'}})});
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const base=`http://127.0.0.1:${server.address().port}`,errors=[],operations=[];
let page;
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const response=await context.request.post(base+'/api/auth/register',{data:{name:'服务端计算验证',email:'compute-ui@example.test',password:'test-password-123'}});assert.equal(response.status(),201);
 const {user}=await response.json(),today=localDate(),profile={age:30,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375};
 const plan={...generateGroupedPlan({split:2,groups:[['chest'],['back']]},profile),planVersion:'qa-plan-v1'},cycle={id:'qa-cycle',startDate:today,plan};
 const items=[{name:'牛奶',grams:200,kcal:60,protein:3,carbs:5,fat:3}];
 const entries=[{id:'profile',kind:'profile',data:profile},{id:'active-plan',kind:'plan',data:plan},{id:'calendar-cycle',kind:'training-cycle',data:cycle},...recurringCalendarTasks(cycle,today,addDays(today,83)),{id:'meal:qa',kind:'meal',data:{date:today,confirmed:true,items,createdAt:new Date().toISOString()}}];
 assert.equal((await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:entries.map(r=>({...r,baseVersion:0}))}})).status(),200);
 assert.equal((await context.request.put(base+'/api/providers',{data:{providers:[{id:'qa',name:'QA',model:'qa-model',baseUrl:'http://127.0.0.1:9998/v1',apiKey:''}],tasks:{meal:'qa'}}})).status(),200);
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().endsWith('/api/compute'))operations.push(request.postDataJSON().operation);});
 await page.goto(base);await page.locator('#chat-input').waitFor();
 const nav=async value=>{await page.locator(`.nav [data-page="${value}"]`).click();};
 await nav('nutrition');await page.locator('.meal-card').waitFor();
 assert.equal(await page.locator('#day-type').textContent(),'训练日');
 const nutrient=page.locator('[data-meal-nutrient="protein"]').first();assert.equal(await nutrient.inputValue(),'6');
 await nutrient.fill('20');await nutrient.press('Tab');
 await page.waitForFunction(()=>document.querySelector('[data-meal-nutrient="kcal"]')?.value==='174');
 assert(operations.includes('adjustMealNutrient'));assert(operations.includes('sumFoods'));
 await page.locator('[data-action="new-meal"]').click();await page.locator('#meal-notes').fill('测试餐食');await page.locator('[data-action="meal-ai"]').click();await page.locator('#meal-confirm-form').waitFor();
 await page.route('**/api/compute',async route=>{if(route.request().postDataJSON()?.operation==='updateMealPortion')await new Promise(resolve=>setTimeout(resolve,80));await route.continue();});
 await page.locator('#meal-confirm-form [data-field="grams"]').fill('200');
 await page.locator('#meal-confirm-form [data-field="protein"]').fill('30');
 await page.waitForFunction(()=>document.querySelector('#meal-confirm-form [data-field="kcal"]')?.value==='370');
 assert.equal(await page.locator('#meal-confirm-form [data-field="carbs"]').inputValue(),'40');
 await page.locator('#meal-confirm-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
 await page.unroute('**/api/compute');
 await nav('training');await page.locator('.calendar-task').first().waitFor();
 await page.locator('[data-action="busy-days"]').click();await page.locator('.busy-days-modal').waitFor();
 await page.locator('[data-action="busy-toggle"][data-date="'+today+'"]').click();
 await page.waitForFunction(date=>document.querySelector(`[data-action="busy-toggle"][data-date="${date}"]`)?.getAttribute('aria-pressed')==='true',today);
 await page.locator('[data-action="busy-save"]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
 assert(operations.includes('rescheduleBusyTasks'));
 await nav('nutrition');await page.waitForFunction(()=>document.querySelector('#day-type')?.textContent==='休息日');
 await nav('library');await page.locator('#knowledge-tab-weights').click();await page.locator('#weight-known').fill('40');await page.locator('[data-rm-max]').waitFor();
 // A disconnected service must show an error, never recalculate in the browser.
 await page.route('**/api/compute',route=>route.abort('internetdisconnected'));
 await page.locator('#weight-known').fill('80');
 await page.waitForFunction(()=>document.querySelector('#weights-error')?.textContent.includes('无法连接'));
 assert.equal(await page.locator('#weights-result').isVisible(),false);
 await page.unroute('**/api/compute');await page.locator('#weight-known').fill('60');await page.waitForFunction(()=>document.querySelector('#weight-conversion-form')?.dataset.computing==='false');
 for(let i=0;i<3;i++){await nav('nutrition');await nav('training');await nav('library');}
 await page.locator('#knowledge-tab-weights').click();await page.locator('[data-rm-max]').waitFor();
 await page.screenshot({path:join(output,'server-calculations.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 assert.equal((await context.request.post(base+'/api/motion/source',{data:'unused'})).status(),404);
 await writeFile(join(output,'report.json'),JSON.stringify({ok:true,operations:[...new Set(operations)],errors},null,2));
 console.log('Server calculation browser QA passed:',output);
}catch(error){console.log('QA diagnostics',JSON.stringify({errors,operations:operations.slice(-15),text:await page?.locator('#page').innerText(),toasts:await page?.locator('#toasts').innerText()}));await page?.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
