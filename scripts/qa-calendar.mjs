// Isolated Edge QA for date-only training cards and schedule-derived nutrition.
// Uses temporary SQLite and a deterministic model; never touches user data.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer } from '../server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','calendar-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=dateKey(new Date()),plusDays=(date,days)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+days);return dateKey(d);};
const monday=(()=>{const d=new Date(today+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);return dateKey(d);})();
const nextWeek=plusDays(monday,7),tomorrow=plusDays(today,1);
const resultByName=new Map(),toolCalls=[],finished=new Set();
let queue=[],modelRequests=0,scenario='',gate=null;
function streamed(payloads){const encoder=new TextEncoder();return new Response(new ReadableStream({start(controller){for(const payload of payloads)controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
async function until(predicate,message){for(let i=0;i<750;i++){if(await predicate())return;await sleep(20);}throw new Error(message);}
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async(_url,options)=>{
 modelRequests++;const body=JSON.parse(options.body),last=body.messages.at(-1);
 if(last?.role==='tool'){const call=body.messages.findLast(m=>m.tool_calls)?.tool_calls.find(call=>call.id===last.tool_call_id),name=call?.function?.name||last.name,result=JSON.parse(last.content);assert.equal(result.ok,true,`Fixture tool ${name} failed: ${JSON.stringify(result)}`);resultByName.set(name,result);}
 const next=queue.shift();if(!next){finished.add(scenario);return streamed([{choices:[{index:0,delta:{content:`**${scenario}已完成**。`},finish_reason:'stop'}]}]);}
 const name=next.name,args=typeof next.args==='function'?next.args(resultByName):next.args;
 assert(body.tools.some(t=>t.function.name===name),`Missing AI tool ${name}`);toolCalls.push({scenario,name,args});
 if(gate&&!gate.entered&&/^(create|update|delete)_/.test(name)){gate.entered=true;await gate.promise;}
 return streamed([{choices:[{index:0,delta:{tool_calls:[{index:0,id:`calendar-call-${modelRequests}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}]);
}});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[],failures=[],consoleErrors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/api/auth/me'))failures.push(`${r.status()} ${r.url()}`);});
const nav=async name=>{if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator(`.nav [data-page="${name}"]`).click();};
const submit=id=>page.locator(`#${id} button[type="submit"],#${id} button:not([type])`).last().click();
const shot=name=>page.screenshot({path:join(dataDir,`${name}.png`),fullPage:true,style:'#toasts{visibility:hidden}'});
const serverState=async(request=context.request)=>(await request.get(base+'/api/state')).json();
const activeRecords=async kind=>(await serverState()).records.filter(r=>r.kind===kind&&!r.deleted);
const flush=async()=>{await page.locator('#sync-status').click();await page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent==='已同步');};
const foregroundSync=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
const selectDate=async date=>{await page.locator('#training-date').fill(date);await page.locator('#training-date').dispatchEvent('change');};
const card=id=>page.locator(`.calendar-task[data-task-id="${id}"]`),cell=date=>page.locator(`.timetable-cell[data-date="${date}"]`);
async function push(records,request=context.request){const current=await serverState(request);const response=await request.post(base+'/api/sync',{data:{userId:current.userId,changes:records.map(r=>({...r,baseVersion:current.records.find(old=>old.id===r.id)?.version||0,deleted:r.deleted||false}))}});assert.equal(response.status(),200);assert.equal((await response.json()).conflicts.length,0);}
const samplePlan=name=>({name,days:[{id:'qa-day-1',name:'QA 全身训练',rest:false,exercises:[{exerciseId:'squat',sets:3,reps:'8–12',restSeconds:90}]},{id:'qa-day-2',name:'恢复日',rest:true,exercises:[]}],notes:['按日期安排训练。']});
const initialPlan={...samplePlan('QA 日期训练计划'),planVersion:'qa-initial-version',confirmedAt:new Date().toISOString()};
const trainingData=(date,title='QA 外部训练')=>({taskType:'training',title,date,notes:'由第二设备安排',completed:false,dayId:initialPlan.days[0].id,daySnapshot:structuredClone(initialPlan.days[0]),planVersion:initialPlan.planVersion});
async function addTask({title,date,notes=''}){await page.locator('[data-action="calendar-add"]').first().click();assert.equal(await page.locator('#task-type,#task-start,#task-end,#task-midnight').count(),0);await page.locator('#task-date').fill(date);await page.locator('#task-day').selectOption({index:1});await page.locator('#task-title').fill(title);await page.locator('#task-notes').fill(notes);await submit('calendar-task-form');await page.locator('#calendar-task-form').waitFor({state:'hidden'});await flush();const record=(await activeRecords('calendar-task')).find(r=>r.data.title===title);assert(record);assert.equal(record.data.taskType,'training');assert.equal(Object.hasOwn(record.data,'startTime'),false);assert.equal(Object.hasOwn(record.data,'endTime'),false);return record;}
async function drag(id,date){const transfer=await page.evaluateHandle(()=>new DataTransfer());await card(id).dispatchEvent('dragstart',{dataTransfer:transfer});await cell(date).dispatchEvent('dragover',{dataTransfer:transfer});await cell(date).dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();await flush();}
async function removeTask(id){await card(id).locator('[data-action="calendar-detail"]').first().click();await page.locator('[data-action="calendar-delete"]').click();await page.locator('[data-action="calendar-delete-confirm"]').click();await flush();assert.equal((await serverState()).records.find(r=>r.id===id).deleted,true);}
async function nutritionAt(date){await nav('nutrition');await page.locator('#nutrition-date').fill(date);await page.locator('#nutrition-date').dispatchEvent('change');}
async function diet(type){await page.waitForFunction(type=>document.querySelector('#day-type')?.dataset.type===type,type);assert.equal(await page.locator('#day-type').evaluate(el=>el.tagName),'OUTPUT');assert.equal(await page.locator('#day-type').getAttribute('aria-live'),'polite');const target=await page.locator('.stats .stat').first().locator('em').textContent();return Number(target.match(/\d+/)?.[0]);}
async function chatTools(label,actions,{during,after}={}){
 scenario=label;queue=[...actions];resultByName.clear();finished.delete(label);
 if(during){let release;gate={entered:false,promise:new Promise(resolve=>release=resolve),release:()=>release()};}
 await nav('chat');await page.locator('#chat-input').fill(label);await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
 if(during){await until(()=>gate.entered,'Model never reached gated mutation');await during();gate.release();await until(()=>finished.has(label),'Tool response never finished');await after?.();gate=null;await nav('chat');}
 await page.locator('.message.assistant').filter({hasText:`${label}已完成`}).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-action="stop-chat"]'));assert.equal(queue.length,0);
}
const calendarRead=()=>({name:'read_calendar',args:{startDate:today,endDate:plusDays(today,20)}});
let step='',otherContext;
try{
 step='register, profile, and ignored old day-type/daily records';console.log(step);
 const email=`qa-calendar-${Date.now()}@example.test`,password='qa-password-123';
 await page.goto(base);await page.locator('#name').fill('日期训练验证');await page.locator('#email').fill(email);await page.locator('#password').fill(password);await submit('auth-form');await page.locator('#profile-form').waitFor();await submit('profile-form');await page.locator('#profile-form').waitFor({state:'hidden'});await page.locator('#chat-input').waitFor();await flush();
 const provider=await context.request.put(base+'/api/providers',{data:{providers:[{id:'qa',name:'QA 本地模型',baseUrl:'http://127.0.0.1:9987/v1',model:'qa-calendar'}],tasks:{chat:'qa',meal:'qa',planning:'qa'}}});assert.equal(provider.status(),200);
 await push([{id:'active-plan',kind:'plan',data:initialPlan},{id:'day-type:'+nextWeek,kind:'day-type',data:{date:nextWeek,rest:false}},{id:'task:old-daily',kind:'calendar-task',data:{taskType:'daily',title:'旧版日常任务应隐藏',date:nextWeek,startTime:'06:00',endTime:'23:00',completed:false}},{id:'task:old-tombstone',kind:'calendar-task',data:null,deleted:true},{id:'schedule:old-rest',kind:'schedule',data:{date:nextWeek,rest:true}}]);await flush();
 await nav('training');await selectDate(nextWeek);assert.equal(await page.locator('.timetable-cell').count(),7);assert.equal(await page.locator('[data-period]').count(),0);assert.equal(await card('task:old-daily').count(),0);assert.equal(await page.locator('.sidebar').getByText('每日安排',{exact:true}).count(),0);
 await nutritionAt(nextWeek);const restKcal=await diet('rest');assert(restKcal>0);

 step='date-only training create, edit, drag, and nutrition mapping';console.log(step);
 await nav('training');await selectDate(nextWeek);const first=await addTask({title:'QA 可移动训练',date:nextWeek,notes:'拖动保留训练内容'});
 await nutritionAt(nextWeek);const trainingKcal=await diet('training');assert(trainingKcal>restKcal,'Training target must exceed rest-day target');
 await nav('training');await selectDate(nextWeek);await card(first.id).locator('[data-action="calendar-edit"]').click();await page.locator('#task-title').fill('QA 可移动训练已调整');await submit('calendar-task-form');await page.locator('#calendar-task-form').waitFor({state:'hidden'});await flush();await drag(first.id,plusDays(nextWeek,1));
 const moved=(await activeRecords('calendar-task')).find(r=>r.id===first.id);assert.equal(moved.data.date,plusDays(nextWeek,1));assert.deepEqual(moved.data.daySnapshot,first.data.daySnapshot);assert.equal(moved.data.notes,first.data.notes);
 await nutritionAt(nextWeek);assert.equal(await diet('rest'),restKcal);await nutritionAt(plusDays(nextWeek,1));assert.equal(await diet('training'),trainingKcal);
 await page.reload();await page.locator('#chat-input').waitFor();await nav('training');await selectDate(nextWeek);await cell(plusDays(nextWeek,1)).locator(`[data-task-id="${first.id}"]`).waitFor();
 const second=await addTask({title:'QA 同日第二次训练',date:plusDays(nextWeek,1)});await addTask({title:'QA 上肢训练',date:plusDays(nextWeek,2)});await addTask({title:'QA 下肢训练',date:plusDays(nextWeek,4)});await shot('desktop-date-training');
 await removeTask(first.id);await nutritionAt(plusDays(nextWeek,1));assert.equal(await diet('training'),trainingKcal);await nav('training');await selectDate(nextWeek);await removeTask(second.id);await nutritionAt(plusDays(nextWeek,1));assert.equal(await diet('rest'),restKcal);

 step='completed training remains a training day and retains actuals';console.log(step);
 await nav('training');await selectDate(nextWeek);const completion=await addTask({title:'QA 完成训练',date:plusDays(nextWeek,1)});await card(completion.id).locator('[data-action="calendar-detail"]').click();await page.locator('[data-action="log-training"]').click();await page.locator('[name="weight-0"]').fill('25');await page.locator('#training-notes').fill('QA 已完成记录必须保留');await submit('training-log');await page.locator('#training-log').waitFor({state:'hidden'});await flush();const completed=(await activeRecords('calendar-task')).find(r=>r.id===completion.id);assert.equal(completed.data.completed,true);assert.equal(await card(completed.id).getAttribute('draggable'),'false');await nutritionAt(completed.data.date);assert.equal(await diet('training'),trainingKcal);

 step='legacy schedule movement uses data.date and preserves snapshots';console.log(step);
 const legacyId='schedule:'+today,legacySnapshot={...samplePlan('QA 旧版计划').days[0],id:'qa-legacy-day',name:'QA 旧版动作快照'};
 await push([{id:legacyId,kind:'schedule',data:{date:today,dayId:legacySnapshot.id,rest:false,completed:false,planVersion:'qa-legacy-version',daySnapshot:legacySnapshot,startTime:'10:00',endTime:'11:00',actual:[],notes:'保留旧记录及动作快照'}}]);await flush();await nutritionAt(today);await diet('training');await nav('training');await selectDate(today);await card(legacyId).locator('[data-action="calendar-edit"]').click();await page.locator('#task-date').fill(tomorrow);await submit('calendar-task-form');await page.locator('#calendar-task-form').waitFor({state:'hidden'});await flush();const legacyMoved=(await serverState()).records.find(r=>r.id===legacyId);assert.equal(legacyMoved.kind,'schedule');assert.equal(legacyMoved.data.date,tomorrow);assert.deepEqual(legacyMoved.data.daySnapshot,legacySnapshot);assert.equal(legacyMoved.data.planVersion,'qa-legacy-version');await nutritionAt(today);await diet('rest');await nutritionAt(tomorrow);await diet('training');await nav('chat');assert.equal(await page.locator('.training-mini').getByText('QA 旧版动作快照',{exact:true}).count(),0);

 step='second device sync refreshes nutrition while preserving an open meal draft';console.log(step);
 otherContext=await browser.newContext();assert.equal((await otherContext.request.post(base+'/api/auth/login',{data:{email,password}})).status(),200);
 await nutritionAt(today);await diet('rest');await page.locator('[data-action="new-meal"]').click();await page.locator('#meal-title').fill('未保存餐食，不能被同步覆盖');await page.locator('#meal-notes').fill('QA 保留输入选区');await page.locator('#meal-notes').evaluate(el=>{window.qaMealInput=el;el.setSelectionRange(2,4);});
 await push([{id:'task:second-device',kind:'calendar-task',data:trainingData(today)}],otherContext.request);await foregroundSync();await diet('training');assert.equal(await page.locator('#meal-title').inputValue(),'未保存餐食，不能被同步覆盖');assert(await page.locator('#meal-notes').evaluate(el=>el===window.qaMealInput&&el.selectionStart===2&&el.selectionEnd===4));
 await push([{id:'task:second-device',kind:'calendar-task',data:null,deleted:true}],otherContext.request);await foregroundSync();await diet('rest');assert.equal(await page.locator('#meal-notes').inputValue(),'QA 保留输入选区');await shot('desktop-nutrition-synced-modal');await page.locator('[data-action="close-modal"]').first().click();

 step='AI plan changes update an already visible nutrition page';console.log(step);
 await push([{id:'active-plan',kind:'plan',data:null,deleted:true}]);await flush();
 await chatTools('QA 创建日期训练计划',[calendarRead(),{name:'get_training_plan',args:{}},{name:'create_training_plan',args:{plan:samplePlan('QA AI 日期计划'),schedule:{startDate:today,days:1}}}],{during:()=>nutritionAt(today),after:()=>diet('training')});
 let aiPlan=(await activeRecords('plan')).find(r=>r.id==='active-plan');assert(aiPlan);const aiPlanned=(await activeRecords('calendar-task')).find(r=>r.data.date===today&&r.data.planVersion===aiPlan.data.planVersion);assert(aiPlanned);assert.equal(Object.hasOwn(aiPlanned.data,'startTime'),false);
 const restFirst=samplePlan('QA 今日改为休息');restFirst.days.reverse();
 await chatTools('QA 修改计划使今日休息',[calendarRead(),{name:'get_training_plan',args:{}},{name:'update_training_plan',args:r=>({expectedVersion:r.get('get_training_plan').currentVersion,plan:restFirst,schedule:{startDate:today,days:2}})}],{during:()=>nutritionAt(today),after:()=>diet('rest')});
 assert.deepEqual((await activeRecords('calendar-task')).find(r=>r.id===completed.id).data,completed.data);

 step='AI individual date-only training create, move, delete and nutrition refresh';console.log(step);
 const aiTask={taskType:'training',title:'QA AI 单项训练',date:today,dayId:'qa-day-1',notes:'单项日期调整'};
 await chatTools('QA 新增今日训练',[calendarRead(),{name:'create_calendar_task',args:r=>({calendarVersion:r.get('read_calendar').calendarVersion,task:aiTask})}],{during:()=>nutritionAt(today),after:()=>diet('training')});
 let aiTaskRecord=(await activeRecords('calendar-task')).find(r=>r.data.title===aiTask.title);assert(aiTaskRecord);
 await chatTools('QA 将今日训练移到明日',[calendarRead(),{name:'update_calendar_task',args:r=>({id:aiTaskRecord.id,expectedVersion:r.get('read_calendar').records.find(x=>x.id===aiTaskRecord.id).version,calendarVersion:r.get('read_calendar').calendarVersion,task:{...aiTask,date:tomorrow}})}],{during:()=>nutritionAt(today),after:()=>diet('rest')});
 aiTaskRecord=(await activeRecords('calendar-task')).find(r=>r.id===aiTaskRecord.id);assert.equal(aiTaskRecord.data.date,tomorrow);
 await chatTools('QA 删除单项训练',[calendarRead(),{name:'delete_calendar_task',args:r=>({id:aiTaskRecord.id,expectedVersion:r.get('read_calendar').records.find(x=>x.id===aiTaskRecord.id).version})}]);assert.equal((await serverState()).records.find(r=>r.id===aiTaskRecord.id).deleted,true);
 await chatTools('QA 删除计划保留完成记录',[{name:'get_training_plan',args:{}},{name:'delete_training_plan',args:r=>({expectedVersion:r.get('get_training_plan').currentVersion})}]);assert.deepEqual((await activeRecords('calendar-task')).find(r=>r.id===completed.id).data,completed.data);
 await nav('training');await selectDate(completed.data.date);await card(completed.id).locator('[data-action="calendar-detail"]').first().click();await page.locator('[data-action="log-training"]').click();assert.equal(await page.locator('[name="weight-0"]').inputValue(),'25');await page.locator('[data-action="close-modal"]').first().click();

 step='AI today meal CRUD refreshes nutrition without navigating away';console.log(step);
 const meal=grams=>({type:'午餐',title:'QA 对话午餐',notes:'实际已吃的餐食',items:[{name:'米饭（熟）',grams,kcal:116,protein:2.6,carbs:25.9,fat:0.3}]});
 await chatTools('QA 新增今日午餐',[{name:'get_today_meals',args:{}},{name:'create_meal',args:{meal:meal(200)}}],{during:()=>nutritionAt(today),after:async()=>{await page.locator('.meal-card').filter({hasText:'QA 对话午餐'}).waitFor();assert.match(await page.locator('.meal-card').filter({hasText:'QA 对话午餐'}).textContent(),/232 kcal/);}});
 let savedMeal=(await activeRecords('meal')).find(r=>r.data.title==='QA 对话午餐');assert.equal(savedMeal.data.date,today);
 await chatTools('QA 修改今日午餐份量',[{name:'get_today_meals',args:{}},{name:'update_meal',args:r=>({id:savedMeal.id,expectedVersion:r.get('get_today_meals').records.find(x=>x.id===savedMeal.id).version,meal:meal(100)})}],{during:()=>nutritionAt(today),after:async()=>{await page.waitForFunction(()=>document.querySelector('.meal-list')?.textContent.includes('116 kcal'));await shot('desktop-ai-meal');}});
 await chatTools('QA 删除今日午餐',[{name:'get_today_meals',args:{}},{name:'delete_meal',args:r=>({id:savedMeal.id,expectedVersion:r.get('get_today_meals').records.find(x=>x.id===savedMeal.id).version})}],{during:()=>nutritionAt(today),after:()=>page.locator('.meal-card').filter({hasText:'QA 对话午餐'}).waitFor({state:'hidden'})});
 assert.equal((await serverState()).records.find(r=>r.id===savedMeal.id).deleted,true);

 step='390px training, date editor, nutrition and final error audit';console.log(step);
 await push([{id:'active-plan',kind:'plan',data:initialPlan}]);await flush();await nav('training');await selectDate(nextWeek);const mobileTask=await addTask({title:'QA 下一次全身训练',date:plusDays(nextWeek,2)});await addTask({title:'QA 核心与力量训练',date:plusDays(nextWeek,4)});await shot('desktop-final-training');await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page overflow');assert.equal(await page.locator('.timetable-cell').count(),7);await shot('mobile-date-training');
 await card(mobileTask.id).locator('[data-action="calendar-edit"]').click();assert.equal(await page.locator('#task-type,#task-start,#task-end').count(),0);assert(await page.locator('#modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Mobile modal overflow');await shot('mobile-date-editor');await page.locator('[data-action="close-modal"]').first().click();await nutritionAt(today);await diet('rest');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('mobile-nutrition-rest');
 step='logout from training and sign in before the training page exists';console.log(step);await nav('training');if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator('[data-action="logout"]').click();await page.locator('#auth-form').waitFor();await page.locator('#email').fill(email);await page.locator('#password').fill(password);await submit('auth-form');await page.locator('.timetable-cell').first().waitFor();assert.equal(await page.locator('.timetable-cell').count(),7);await nutritionAt(today);await diet('rest');
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.deepEqual(consoleErrors.filter(m=>!m.includes('401 (Unauthorized)')),[]);
 const result={passed:true,dataDir,modelRequests,toolCalls,checks:'7 date-only cells; no daily/time editor; ignore legacy daily/day-type/tombstones; create/edit/drag/reload training; multiple workouts per date; delete-last rest mapping; completed day remains training; legacy moved ID/snapshot; nutrition energy changes; AI plan/calendar/meal updates on visible nutrition; second-device foreground sync preserves meal draft and selection; 390px layout; logout/login from training',errors,failures,consoleErrors};await writeFile(join(dataDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,toolCalls:toolCalls.length}));
}catch(error){console.error('FAILED STEP:',step);await shot('failure').catch(()=>{});await writeFile(join(dataDir,'failure.json'),JSON.stringify({step,message:error.message,errors,failures,consoleErrors,toolCalls},null,2));throw error;}finally{gate?.release();await otherContext?.close();await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
