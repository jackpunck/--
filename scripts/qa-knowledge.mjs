// Isolated Edge QA for knowledge tools, anatomy picking, and inline chat models.
// Temporary database + fixed local model responses; no real account, API key, or clipboard.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {startServer} from '../server.mjs';
import {exercises} from '../public/domain.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','knowledge-'));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
let releaseStream,appendStream,modelRequests=0,omitVisualOnce=false;
const delta=content=>({choices:[{index:0,delta:{content}}]});
function stream(text,signal,hold=false){const encoder=new TextEncoder();let closed=false;return new Response(new ReadableStream({async start(controller){const send=payload=>{if(!closed)controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));};const abort=()=>{closed=true;releaseStream?.();try{controller.error(new DOMException('Aborted','AbortError'));}catch{}};signal?.addEventListener('abort',abort,{once:true});try{send(delta(text));if(hold)await new Promise(resolve=>{releaseStream=resolve;appendStream=next=>send(delta(next));});if(!closed){send({choices:[{index:0,delta:{},finish_reason:'stop'}]});controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();closed=true;}}finally{signal?.removeEventListener('abort',abort);}}}),{headers:{'Content-Type':'text/event-stream'}});}
const server=await startServer({host:'127.0.0.1',port:0,dataDir,fetchImpl:async(_url,options)=>{
 modelRequests++;const body=JSON.parse(options.body),last=body.messages.findLast(m=>m.role==='user'),text=typeof last?.content==='string'?last.content:JSON.stringify(last?.content);
 if(omitVisualOnce){omitVisualOnce=false;return stream('已改用文字说明胸大肌。',options.signal);}
 const followup=text.includes('QA追问'),muscle=text.includes('QA肌肉')||followup,exercise=text.includes('QA动作');
 if((muscle||exercise)&&body.messages.at(-1)?.role!=='tool'){
   assert(body.tools.some(tool=>tool.function.name==='set_chat_visuals'));
   if(followup)assert(JSON.stringify(body.messages).includes('chest'),'Prior model selection missing from follow-up context');
   const visuals=muscle?[{type:'muscle',id:'chest'}]:[{type:'exercise',id:'bench'},{type:'exercise',id:'row'}];
   return Response.json({choices:[{message:{role:'assistant',content:'',tool_calls:[{id:'visual-'+modelRequests,type:'function',function:{name:'set_chat_visuals',arguments:JSON.stringify({visuals})}}]},finish_reason:'tool_calls'}]});
 }
 if(muscle)return stream('胸大肌位于胸部前侧。下面的模型可以旋转，并点击肌肉查看名称。',options.signal,true);
 if(exercise)return stream('哑铃卧推训练胸大肌。坐姿绳索划船训练背阔肌。哑铃侧平举主要训练三角肌中束。',options.signal,true);
 if(text.includes('QA不展示'))return stream('哑铃卧推的说明可以先用文字给出。',options.signal);
 return stream('这是一条普通问候，没有动作或肌肉示范。',options.signal);
}});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await context.addInitScript(()=>{window.qaMuscleEvents=[];window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='fitness:muscle-selected')window.qaMuscleEvents.push(event.data);});});
const page=await context.newPage();page.setDefaultTimeout(20000);
const errors=[],failures=[],modelChecks=[];
const watch=target=>{target.on('pageerror',e=>errors.push(e.message));target.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/api/auth/me'))failures.push(`${r.status()} ${r.url()}`);});};watch(page);
const nav=async name=>{if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator(`.nav [data-page="${name}"]`).click();};
const tab=id=>page.locator(`[data-action="knowledge-tab"][data-tab="${id}"]`).click();
const submit=id=>page.locator(`#${id}`).evaluate(form=>form.requestSubmit());
const shot=(name,options={})=>page.screenshot({path:join(dataDir,`${name}.png`),fullPage:true,...options,style:'#toasts{visibility:hidden}'});
const close=async()=>{if(await page.locator('#model-dialog[open]').count())await page.locator('#model-dialog [data-model-close]').click();else await page.locator('#modal [data-action="close-modal"]').first().click();};
const idle=()=>page.waitForFunction(()=>!document.querySelector('[data-action="stop-chat"]'));
const nums=text=>[...text.replaceAll(',','').matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0]));
async function includesNumber(selector,value,tolerance=.6){const text=await page.locator(selector).textContent();assert(nums(text).some(n=>Math.abs(n-value)<=tolerance),`Expected ${value} in ${selector}: ${text}`);}
const state=async()=>(await context.request.get(base+'/api/state')).json();
const send=async text=>{await page.locator('#chat-input').fill(text);await page.locator('#chat-form').evaluate(form=>form.requestSubmit());};
async function stableFrames(){for(let i=0;!releaseStream&&i<250;i++)await sleep(20);assert(releaseStream,'Expected held model stream');await page.locator('.message.assistant .chat-model-frame').first().waitFor();await page.evaluate(()=>{window.qaInlineFrames=[...document.querySelectorAll('.message.assistant .chat-model-frame')];});appendStream('\n\n请保持稳定呼吸，并在自己可控制的范围内活动。');await page.locator('.message.assistant').last().getByText('请保持稳定呼吸，并在自己可控制的范围内活动。',{exact:true}).waitFor({state:'attached'});assert(await page.evaluate(()=>window.qaInlineFrames.every(el=>el.isConnected&&[...document.querySelectorAll('.message.assistant .chat-model-frame')].includes(el))),'Streaming replaced a mounted model iframe');releaseStream();await idle();releaseStream=null;}
async function readyFrame(locator,{exercise,muscle}={}){await locator.scrollIntoViewIfNeeded();if(await locator.getAttribute('id')==='model-detail-frame')await page.locator('#model-dialog[data-state=ready]').waitFor();const frame=locator.contentFrame();await frame.locator('#loading').waitFor({state:'hidden',timeout:60000});if(exercise)assert.equal(await frame.locator('html').getAttribute('data-exercise'),exercise);if(muscle)assert.equal(await frame.locator('html').getAttribute('data-selected-muscle'),muscle);assert.equal(await frame.locator('canvas').count(),1);return frame;}
let step='',modelPage;
try{
 step='register isolated account and open five knowledge panels';console.log(step);
 const registration=await context.request.post(base+'/api/auth/register',{data:{name:'知识验证',email:`qa-knowledge-${Date.now()}@example.test`,password:'qa-password-123'}});assert.equal(registration.status(),201);const {user}=await registration.json();
 const profile={age:30,sex:'male',height:175,weight:70,goal:'maintain',activity:1.55};
 assert.equal((await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',data:profile,baseVersion:0}]}})).status(),200);
 assert.equal((await context.request.put(base+'/api/providers',{data:{providers:[{id:'qa',name:'QA 本地模型',baseUrl:'http://127.0.0.1:9987/v1',model:'qa-knowledge'}],tasks:{chat:'qa',meal:'qa',planning:'qa'}}})).status(),200);
 await page.goto(base);await page.locator('#chat-input').waitFor();await nav('library');assert.match(await page.locator('.nav [data-page="library"]').textContent(),/知识大全/);assert.equal(await page.locator('[data-action="knowledge-tab"]').count(),5);

 step='metabolism and macronutrient energy calculators';console.log(step);
 await tab('nutrition');for(const [field,value]of Object.entries({sex:'male',age:'30',height:'175',weight:'70',activity:'1.55'})){const input=page.locator('#calc-'+field);if(await input.evaluate(el=>el.tagName==='SELECT'))await input.selectOption(value);else await input.fill(value);}await submit('metabolism-form');await includesNumber('#metabolism-result',1648.75);await includesNumber('#metabolism-result',2555.56);assert((await page.locator('.knowledge-source a[href^="https://"],a.knowledge-source[href^="https://"]').count())>=1,'Formula sources are missing');await page.locator('#calc-weight').fill('0');await submit('metabolism-form');assert((await page.locator('#metabolism-error').textContent()).trim());await page.locator('#calc-weight').fill('70');await submit('metabolism-form');
 for(const [field,value]of Object.entries({protein:'100',carbs:'200',fat:'50'}))await page.locator('#calc-'+field).fill(value);await submit('macro-energy-form');await includesNumber('#macro-energy-result',1650);await shot('desktop-nutrition-knowledge');
 await page.locator('#calc-fat').fill('100');await submit('macro-energy-form');await includesNumber('#macro-energy-result',2100);
 assert.deepEqual((await state()).records.find(r=>r.id==='profile').data,profile,'Exploring a calculator changed the saved profile');

 step='common food portions scale grams and nutrition without logging a meal';console.log(step);
 await tab('portions');await page.locator('#portion-food').selectOption('rice-box');await page.locator('#portion-count').fill('2');await page.locator('#portion-grams').fill('150');await submit('portion-form');await includesNumber('#portion-result',300,.1);await includesNumber('#portion-result',398.1,.6);await includesNumber('#portion-result',90,.1);await shot('desktop-rice-portion');
 await page.locator('#portion-food').selectOption('egg');await page.locator('#portion-count').fill('1');await page.locator('#portion-grams').fill('50');await submit('portion-form');await includesNumber('#portion-result',71,.1);await includesNumber('#portion-result',6,.1);assert.equal((await state()).records.filter(r=>r.kind==='meal'&&!r.deleted).length,0,'Portion preview must not log meals');

 step='exercise directory retains 25 entries and routes each sampled exercise';console.log(step);
 await tab('exercises');assert.equal(await page.locator('.exercise-card').count(),exercises.length);assert(exercises.length>=25);await page.locator('#exercise-search').fill('卧推');assert((await page.locator('.exercise-card').count())>=1);await page.locator('.exercise-card[data-id="bench"]').click();let frame=await readyFrame(page.locator('.model-frame'),{exercise:'bench'});assert.match(await frame.locator('#exercise-name').textContent(),/卧推/);assert.equal(new URL(await page.locator('.model-frame').getAttribute('src'),base).searchParams.get('exercise'),'bench');await shot('desktop-bench-dialog',{fullPage:false});await close();await page.locator('#exercise-search').fill('');

 step='muscle URL selects chest and real canvas picking reports anatomy names';console.log(step);
 await tab('muscles');assert((await page.locator('[data-action="muscle-model"]').count())>=13);await page.locator('[data-action="muscle-model"][data-id="chest"]').first().click();frame=await readyFrame(page.locator('.model-frame'),{muscle:'chest'});assert.match(await frame.locator('#exercise-name').textContent(),/胸/);
 const beforePicks=await page.evaluate(()=>window.qaMuscleEvents.length),canvas=frame.locator('canvas'),bounds=await canvas.boundingBox();assert(bounds);let picked=false;
 for(const [x,y]of [[.5,.36],[.46,.36],[.54,.36],[.5,.43],[.46,.49],[.54,.49],[.43,.31],[.57,.31],[.48,.6],[.52,.6]]){await canvas.click({position:{x:bounds.width*x,y:bounds.height*y}});if(await page.evaluate(n=>window.qaMuscleEvents.length>n&&Boolean(window.qaMuscleEvents.at(-1)?.muscle),beforePicks)){picked=true;break;}}
 assert(picked,'Clicking the model did not report an actual muscle hit');const event=await page.evaluate(()=>window.qaMuscleEvents.at(-1));assert(event.muscle&&event.name);assert.match(await frame.locator('#picked-name').textContent(),/[\u3400-\u9fff]/);await shot('desktop-muscle-picked',{fullPage:false});await close();

 step='all six sampled actions animate with their correct muscle groups';console.log(step);
 modelPage=await context.newPage();watch(modelPage);await modelPage.setViewportSize({width:1050,height:850});const canvasHashes=[];
 for(const id of ['squat','pushup','curl','bench','row','lateral-raise']){await modelPage.goto(`${base}/model/index.html?exercise=${id}&embed=1`);await modelPage.locator('#loading').waitFor({state:'hidden',timeout:60000});assert.equal(await modelPage.locator('html').getAttribute('data-exercise'),id);assert.equal(await modelPage.locator('#exercise-name').textContent(),exercises.find(e=>e.id===id).name);const poseKind=await modelPage.locator('#pose-kind').textContent();const chips=await modelPage.locator('#muscle-chips').textContent();assert(chips.trim(),'Exercise has no named primary muscles');const muscleButtons=modelPage.locator('#muscle-chips [data-muscle]'),lastMuscle=await muscleButtons.last().getAttribute('data-muscle');await muscleButtons.last().click();assert.equal(await modelPage.locator('html').getAttribute('data-selected-muscle'),lastMuscle);await muscleButtons.first().click();if(exercises.find(e=>e.id===id).demo){assert.match(poseKind,/动画/);const control=modelPage.locator('#progress');await control.evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});await modelPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const first=await modelPage.locator('canvas').screenshot();await control.evaluate(el=>{el.value='500';el.dispatchEvent(new Event('input',{bubbles:true}));});await modelPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const second=await modelPage.locator('canvas').screenshot();assert.notEqual(createHash('sha256').update(first).digest('hex'),createHash('sha256').update(second).digest('hex'),`${id} progress changed no rendered pose`);}else assert.match(poseKind,/姿态|示意/);
 const image=await modelPage.locator('#viewport').screenshot({path:join(dataDir,`model-${id}.png`)});canvasHashes.push(createHash('sha256').update(image).digest('hex'));modelChecks.push({id,poseKind,chips});}
 assert.equal(new Set(canvasHashes).size,6,'Sampled exercise renderings collapsed to a generic pose');await modelPage.close();modelPage=null;await page.bringToFront();

 step='chat muscle iframe matches the question and survives incremental rendering';console.log(step);
 await nav('chat');await send('QA肌肉：胸大肌在哪里，给我看对应的 3D 肌肉模型');await page.locator('.message.assistant .visual-card[data-visual-type="muscle"][data-visual-id="chest"]').waitFor();await stableFrames();let inline=page.locator('.message.assistant .visual-card[data-visual-id="chest"] iframe.chat-model-frame');frame=await readyFrame(inline,{muscle:'chest'});await shot('desktop-chat-muscle');

 await send('QA追问：还是没看明白，给我看看它');await page.locator('.message.assistant').last().locator('.visual-card[data-visual-id="chest"]').waitFor();await stableFrames();
 omitVisualOnce=true;await page.locator('.message.assistant').last().locator('[data-action="retry-chat"]').click();await page.locator('.message.assistant').last().getByText('已改用文字说明胸大肌。',{exact:true}).waitFor();await idle();assert.equal(await page.locator('.message.assistant').last().locator('.visual-card').count(),0,'Regeneration retained an obsolete model decision');
 await send('QA追问：再看看它');await page.locator('.message.assistant').last().locator('.visual-card[data-visual-id="chest"]').waitFor();await stableFrames();
 await send('QA不展示：卧推怎么做，请给我3D示范');await idle();assert.equal(await page.locator('.message.assistant').last().locator('.visual-card').count(),0,'Text keywords overrode the model decision');
 await page.reload();await page.locator('#chat-input').waitFor();await page.locator('#history-list [data-action="open-chat"]').first().click();await page.locator('.visual-card[data-visual-id="chest"]').first().waitFor();assert.equal(await page.locator('.visual-card[data-visual-id="chest"]').count(),2,'Saved model decisions were lost on reload');

 step='chat exercise cards embed the matching models with a two-model limit';console.log(step);
 await page.locator('[data-action="new-chat"]').first().click();await send('QA动作：哑铃卧推、坐姿绳索划船和哑铃侧平举怎么做？');await page.locator('.message.assistant .chat-model-frame').first().waitFor();assert.equal(await page.locator('.message.assistant .chat-model-frame').count(),2);const visualIds=await page.locator('.message.assistant .visual-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.visualId));assert.equal(new Set(visualIds).size,2);assert(visualIds.every(id=>['bench','row','lateral-raise'].includes(id)),`Unrelated exercise card: ${visualIds}`);await stableFrames();for(const id of visualIds){const locator=page.locator(`.message.assistant .visual-card[data-visual-id="${id}"] iframe`);frame=await readyFrame(locator,{exercise:id});assert.equal(await frame.locator('#exercise-name').textContent(),exercises.find(e=>e.id===id).name);}await shot('desktop-chat-exercises');
 await send('QA肌肉：再看看胸大肌在哪里');await page.locator('.message.assistant').last().locator('.visual-card[data-visual-id="chest"]').waitFor();await stableFrames();assert((await page.locator('.message.assistant iframe.chat-model-frame').count())<=4);await send('普通问候：你好');await idle();await page.locator('.message.assistant').last().getByText('这是一条普通问候，没有动作或肌肉示范。',{exact:true}).waitFor();assert.equal(await page.locator('.message.assistant').first().locator('iframe.chat-model-frame').count(),0,'Old answer retained WebGL viewers');assert.equal(await page.locator('.message.assistant').first().locator('.visual-placeholder').count(),2);assert.equal(await page.locator('.message.assistant').last().locator('.visual-card').count(),0,'Unrelated answer acquired a model');await page.locator('.message.assistant').first().locator('[data-action="open-visual"]').first().click();await readyFrame(page.locator('.model-frame'),{exercise:visualIds[0]});await close();

 step='390px knowledge tools, muscle picker and inline model layout';console.log(step);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile chat page overflow');await shot('mobile-chat-models');await nav('library');await tab('nutrition');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('mobile-nutrition-knowledge');await tab('portions');await page.locator('#portion-food').selectOption('egg');await page.locator('#portion-count').fill('2');await page.locator('#portion-grams').fill('50');await submit('portion-form');await includesNumber('#portion-result',142,.1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('mobile-food-portions');await tab('muscles');await page.locator('[data-action="muscle-model"][data-id="chest"]').first().click();await readyFrame(page.locator('.model-frame'),{muscle:'chest'});assert(await page.locator('#modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await shot('mobile-muscle-model',{fullPage:false});await close();
 assert.deepEqual(errors,[],errors.join('\n'));assert.deepEqual(failures,[],failures.join('\n'));const result={passed:true,dataDir,modelRequests,modelChecks,checks:'four knowledge panels; independent BMR/TDEE and 4/4/9 inputs; rice/egg portion changes without logging; 25 exercise directory; chest URL selects named muscle; real canvas pick event; six sampled animations including bench/row/lateral-raise; model-selected cards; contextual follow-up without target keywords; no tool means no cards despite keywords; regeneration clears prior selection; persisted selections survive reload; max2 matching chat iframes stable during streaming; only latest2 assistant answers mount models; desktop and 390px layout',errors,failures};await writeFile(join(dataDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error('FAILED STEP:',step);await shot('failure').catch(()=>{});await writeFile(join(dataDir,'failure.json'),JSON.stringify({step,message:error.message,errors,failures,modelChecks},null,2));throw error;}finally{releaseStream?.();await modelPage?.close();await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
