// Isolated browser check: fake model responses, temporary database, random port.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';
import {mealTypeAt} from '../public/meal-contract.js';
const root=process.cwd();await mkdir('.qa',{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||'精细模型与动作开发/node_modules/playwright/index.mjs')));
let badMeal=false,failAdvice=false,mealRequests=0,adviceRequests=0;
const adviceContexts=[],imageRequests=[];
const server=await startServer({host:'127.0.0.1',port:0,dataDir:await mkdtemp(join(root,'.qa','meal-workflow-')),fetchImpl:async(_url,options)=>{
 const body=JSON.parse(options.body),meal=body.messages[0].content.includes('当前任务是餐食估算');
 let content;
 if(body.stream){
   const last=body.messages.at(-1),userMessage=body.messages.findLast(m=>m.role==='user');
   const text=JSON.stringify(userMessage?.content);
   assert.ok(text.includes('餐食记录场景'));
   imageRequests.push(Array.isArray(userMessage.content)&&userMessage.content.some(p=>p.type==='image_url'));
   const toolName=last.role==='tool'?(last.name||body.messages.findLast(m=>m.tool_calls)?.tool_calls.at(-1).function.name):null;
   let delta,reason;
   if(toolName==='create_meal'){
     assert.equal(JSON.parse(last.content).ok,true);
     delta={content:'已记录这一餐：鸡蛋约100g，144 kcal，蛋白质13g。'};reason='stop';
   }else{
     const name=toolName==='get_today_meals'?'create_meal':'get_today_meals';
     const args=name==='create_meal'?{meal:{type:mealTypeAt(new Date()),title:'已记录鸡蛋',notes:'按100g估算',items:[{name:'鸡蛋（熟）',grams:100,kcal:144,protein:13,carbs:2,fat:9}]}}:{};
     delta={tool_calls:[{index:0,id:'call-'+Date.now(),type:'function',function:{name,arguments:JSON.stringify(args)}}]};reason='tool_calls';
   }
   const wire=`data: ${JSON.stringify({choices:[{index:0,delta}]})}

data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:reason}]})}

data: [DONE]

`;
   return new Response(wire,{headers:{'Content-Type':'text/event-stream'}});
 }

 if(meal){
   mealRequests++;imageRequests.push(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
   await new Promise(r=>setTimeout(r,200));
   content=badMeal?'invalid meal':JSON.stringify({items:[{name:'鸡蛋（熟）',grams:JSON.stringify(body.messages.at(-1)).includes('50g')?50:100,kcal:144,protein:13,carbs:2,fat:9}],note:'按两个鸡蛋、可食部约100g估算。'});
 }else{
   adviceRequests++;
   const context=JSON.parse(body.messages[0].content.split('用户当前上下文：')[1].split('\n当前任务')[0]);adviceContexts.push(context);
   content=failAdvice?'invalid advice':JSON.stringify({version:2,
     brief:{summary:context.mealTiming.scenario==='optional_snack'?'已有晚餐记录，不饿可以不再吃；如有饿意，可选少量加餐。':'按后续正餐安排合适的搭配。',foods:(context.mealTiming.scenario==='optional_snack'?[{name:'原味酸奶',portion:'小杯，约100g'},{name:'水果',portion:'小份，约50g'}]:[{name:'熟白米饭',portion:'1碗，约200g熟重'},{name:'水煮鸡蛋',portion:'2个，去壳约100g'},{name:'清炒青菜',portion:'1盘，约200g熟重'}]).slice(0,context.mealTiming.maxFoods),tip:'蔬菜少油烹调，实际用油一并记录。'},
     detailed:{overview:`目前记录了${context.meals.length}餐，主要食物为鸡蛋。记录中的食物种类有限，需要先核对其他餐次，再判断全天搭配。`,findings:[
       {title:'已有蛋白质来源，餐次分布仍需核对',evidence:'已记录餐食中包含鸡蛋，未见其他蛋白质食物。',interpretation:'当前记录能确认蛋白质来源，但无法据此判断每餐分布，也不能把未记录食物当作没有吃。',action:'补齐其他餐次，再把剩余蛋白质安排在后续正餐中。'},
       {title:'蔬菜与主食记录不完整',evidence:'现有餐食条目没有明确的主食和蔬菜份量。',interpretation:'暂不能判断全天膳食纤维或食物多样性是否足够，应先确认这是漏记还是实际未摄入。',action:'若确实未吃，后续正餐可补充主食和蔬菜，并记录实际份量。'}
     ],nextStep:'当天没有训练安排，可以按平常正餐节奏分配后续食物。先核对是否漏记餐次，再结合饥饿感安排，无需一次补齐所有差额。',uncertainty:'鸡蛋重量及烹调用油均为估计；补充可食部重量和用油量，有助于缩小热量估算误差。'}});
 }
 return new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}});
}});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1366,height:950}});
 const registered=await context.request.post(base+'/api/auth/register',{data:{name:'餐食验证',email:`meal-${Date.now()}@example.test`,password:'qa-password-123'}});
 const {user}=await registered.json();
 await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',data:{age:28,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375},baseVersion:0}]}});
 const provider=await context.request.put(base+'/api/providers',{data:{providers:[{id:'qa-provider',name:'QA',model:'qa-model',baseUrl:'http://127.0.0.1:9998/v1',apiKey:''}],tasks:{chat:'qa-provider',meal:'qa-provider',planning:'qa-provider'}}});assert.equal(provider.status(),200);
 await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'legacy-draft',kind:'mealDraft',data:{type:'午餐',notes:'烤鸭',items:[]},baseVersion:0}]}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);
 await page.locator('#chat-input').fill('保留这段未发送的草稿');
 await page.locator('[data-action="quick"][data-target="meal"]').click();
 assert.equal(await page.locator('#modal').evaluate(e=>e.open),false);
 assert.match(await page.locator('#chat-input').getAttribute('placeholder'),/描述这一餐/);
 assert.equal(await page.locator('#chat-input').inputValue(),'保留这段未发送的草稿');
 assert.equal(await page.locator('#chat-input').evaluate(e=>document.activeElement===e),true);
 await page.locator('#chat-input').fill('吃了两个鸡蛋，约100g');
 await page.locator('#chat-input').press('Enter');
 await page.waitForFunction(()=>document.querySelector('.message.assistant')?.textContent.includes('已记录这一餐'));
 await page.waitForFunction(()=>!document.querySelector('[data-action="stop-chat"]'));
 await page.locator('.nav [data-page="nutrition"]').click();
 await page.locator('.meal-card').waitFor();assert.equal(await page.locator('.meal-card').count(),1);
 assert.equal(await page.locator('[data-action="edit-meal-draft"]').count(),0);
 await page.locator('#nutrition-advice .markdown-body').first().waitFor();
 assert.equal(adviceContexts.at(-1).balance.protein.consumed,13);
 assert.equal(await page.locator('.advice-brief-view .advice-food-card').count(),Math.min(3,adviceContexts.at(-1).mealTiming.maxFoods));
 assert.ok(adviceContexts.at(-1).mealTiming.localTime);
 const count=adviceRequests;await page.locator('[data-action="advice-mode"][data-mode="detailed"]').click();assert.equal(adviceRequests,count);
 assert.equal(await page.locator('.advice-finding').count(),2);
 assert.equal(await page.locator('.advice-detailed-view .advice-food-card').count(),0);
 await page.screenshot({path:'.qa/advice-detailed-v2.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'.qa/advice-detailed-v2-mobile.png',fullPage:true});
 await page.setViewportSize({width:1366,height:950});
 // The nutrition entry leads to the main composer, including on mobile.
 await page.locator('[data-action="new-meal"]').click();
 assert.equal(await page.locator('#modal').evaluate(e=>e.open),false);
 assert.match(await page.locator('#chat-input').getAttribute('placeholder'),/描述这一餐/);
 await page.setViewportSize({width:390,height:844});
 const chooser=page.waitForEvent('filechooser');await page.locator('[data-action="camera"]').click();const camera=await chooser;
 assert.equal(await camera.element().getAttribute('capture'),'environment');
 await camera.setFiles({name:'meal.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQYQAAAAASUVORK5CYII=','base64')});
 await page.waitForFunction(()=>document.querySelector('#chat-files')?.textContent.includes('已就绪'));
 await page.screenshot({path:'.qa/meal-chat-mobile.png'});
 await page.locator('#chat-input').press('Enter');
 await page.waitForFunction(()=>document.querySelector('.message.assistant')?.textContent.includes('已记录这一餐'));
 await page.waitForFunction(()=>!document.querySelector('[data-action="stop-chat"]'));
 assert.ok(imageRequests.includes(true));
 await page.setViewportSize({width:1366,height:950});
 await page.locator('.nav [data-page="nutrition"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.meal-card').length===2);
 await page.locator('#nutrition-advice .markdown-body').first().waitFor();assert.equal(adviceContexts.at(-1).balance.protein.consumed,26);
 await page.locator('[data-action="edit-meal"]').first().click();
 assert.equal(await page.locator('#meal-date,#meal-food-library,[data-action="save-meal-draft"]').count(),0);
 assert.equal(await page.locator('#meal-notes').inputValue(),'');
 assert.ok(await page.locator('.meal-original .meal-notes-layout').isVisible());
 await page.locator('#meal-notes').fill('50g');
 const revisionChooser=page.waitForEvent('filechooser');await page.locator('[data-action="meal-photo"]').click();
 await (await revisionChooser).setFiles({name:'revision.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQYQAAAAASUVORK5CYII=','base64')});
 await page.locator('.meal-revision-form .meal-photo-preview img').waitFor();
 assert.equal(await page.locator('#meal-notes').inputValue(),'50g');
 await page.screenshot({path:'.qa/meal-revision-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.locator('#modal').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await page.screenshot({path:'.qa/meal-revision-mobile.png'});
 await page.setViewportSize({width:1366,height:950});
 await page.locator('[data-action="meal-ai"]').click();await page.locator('#meal-form').waitFor({state:'hidden'});
 await page.locator('#nutrition-advice .markdown-body').first().waitFor();assert.equal(adviceContexts.at(-1).balance.protein.consumed,20);
 assert.equal(await page.locator('.meal-card').count(),2);
 await page.locator('[data-action="new-meal"]').click();await page.screenshot({path:'.qa/meal-chat-desktop.png'});
 await page.locator('[data-action="exit-meal-scene"]').click();
 assert.match(await page.locator('#chat-input').getAttribute('placeholder'),/聊聊训练/);
 await page.locator('[data-action="quick"][data-target="meal"]').click();
 await page.locator('[data-action="new-chat"]').click();
 assert.match(await page.locator('#chat-input').getAttribute('placeholder'),/聊聊训练/);
 const beforeReload=adviceRequests;
 await page.reload();await page.locator('.nav [data-page="nutrition"]').click();assert.equal(await page.locator('.meal-card').count(),2);
 await page.locator('#nutrition-advice .markdown-body').first().waitFor();
 assert.equal(adviceRequests,beforeReload,'reload must reuse saved advice');
 await page.locator('.nav [data-page="chat"]').click();await page.locator('.nav [data-page="nutrition"]').click();
 assert.equal(adviceRequests,beforeReload,'navigation must reuse saved advice');
 await page.locator('[data-action="advice-refresh"]').click();await page.locator('#nutrition-advice .markdown-body').first().waitFor();
 assert.equal(adviceRequests,beforeReload+1,'explicit refresh generates once');
 const savedState=await (await context.request.get(base+'/api/state')).json();
 const storedProfile=savedState.records.find(r=>r.id==='profile');
 await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',data:{...storedProfile.data,weight:72},baseVersion:storedProfile.version}]}});
 await page.reload();await page.locator('.nav [data-page="nutrition"]').click();
 await page.locator('#nutrition-advice .markdown-body').first().waitFor();
 assert.equal(adviceRequests,beforeReload+1,'profile changes do not regenerate advice');
 failAdvice=true;await page.locator('[data-action="advice-refresh"]').click();await page.locator('#nutrition-advice .error-box').waitFor();
 const afterFailure=adviceRequests;
 await page.reload();await page.locator('.nav [data-page="nutrition"]').click();await page.locator('#nutrition-advice .error-box').waitFor();
 assert.equal(adviceRequests,afterFailure,'reload must not retry failed generation automatically');
 failAdvice=false;await page.locator('[data-action="advice-refresh"]').click();await page.locator('#nutrition-advice .markdown-body').first().waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: both entries open main chat, contextual placeholder/focus, drafts preserved, text/photo chat tools save meals, advice updates, mobile, scene exit and new chat reset.');

}finally{await browser.close();await new Promise(r=>server.close(r));}
