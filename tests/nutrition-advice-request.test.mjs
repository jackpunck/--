import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMessages, complete} from '../server/providers.mjs';
import {dailyMealAdvicePrompt} from '../public/meal-advice-prompt.js';
import {completeNutritionAdvice} from '../server/nutrition-advice.mjs';
import {parseNutritionAdvice} from '../public/meal-contract.js';
import {createServer} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const provider={model:'test',name:'Test',baseUrl:'http://127.0.0.1:9876/v1',protocol:'openai'};
const advice=()=>({version:3,brief:{summary:'按余量安排',foods:[],habitBasis:'参考记录',tip:'少油烹调',meals:['早餐','午餐','晚餐'].map((name,index)=>({name,status:index?'planned':'recorded',summary:'按记录安排',foods:[]}))},detailed:{overview:'当前搭配',findings:[{title:'主食',evidence:'有米饭',interpretation:'已有碳水来源',action:'搭配蔬菜'}],nextStep:'安排下一餐',uncertainty:'份量为估算'}});
const messages=[{role:'user',content:dailyMealAdvicePrompt}];

test('daily suggestions use low reasoning and JSON only on supported official DeepSeek models',async()=>{
  for(const scenario of [
    {purpose:'nutrition-advice',model:'deepseek-flash',host:'api.deepseek.com',low:true},
    {purpose:'nutrition-advice',model:'deepseek-v4-pro',host:'api.deepseek.com',low:true},
    {purpose:undefined,model:'deepseek-flash',host:'api.deepseek.com',low:false},
    {purpose:'training',model:'deepseek-flash',host:'api.deepseek.com',low:false},
    {purpose:'nutrition-advice',model:'deepseek-reasoner',host:'api.deepseek.com',low:false},
    {purpose:'nutrition-advice',model:'deepseek-flash',host:'127.0.0.1',low:false}
  ]){
    let sent;
    await complete({provider:{model:scenario.model,name:'Test',baseUrl:`https://${scenario.host}/v1`,protocol:'openai'},purpose:scenario.purpose,messages:[{role:'user',content:'test'}],fetchImpl:async(url,options)=>{
      sent=JSON.parse(options.body);
      return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
    }});
    assert.deepEqual(sent.thinking,scenario.low?{type:'enabled'}:undefined);
    assert.deepEqual(sent.response_format,scenario.low?{type:'json_object'}:undefined);
    assert.equal(sent.reasoning_effort,scenario.low?'low':undefined);
  }
});

test('nutrition advice omits unrelated visual and formula catalogs but preserves the supplied context',()=>{
  const messages=[{role:'user',content:dailyMealAdvicePrompt}];
  const context={purpose:'nutrition-advice',date:'2026-10-01',meals:[],recentWeek:{recordedDays:0}};
  const lean=buildMessages(null,'test',{task:'planning',messages,context});
  const generic=buildMessages(null,'test',{task:'planning',messages,context:{...context,purpose:'training'}});
  assert.ok(lean[0].content.length<generic[0].content.length/2);
  assert.ok(!lean[0].content.includes('肌肉目录'));
  assert.ok(lean[0].content.includes(JSON.stringify(context)));
  assert.ok(generic[0].content.includes('肌肉目录'));
});

test('completion reports preparation and upstream duration for latency diagnosis',async()=>{
  const result=await complete({provider:{model:'test',name:'Test',baseUrl:'http://127.0.0.1:9876/v1',protocol:'openai'},messages:[{role:'user',content:'test'}],fetchImpl:async()=>{
    await new Promise(resolve=>setTimeout(resolve,20));
    return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
  }});
  assert.equal(result.content,'ok');
  assert.ok(result.timing.providerMs>=15);
  assert.ok(result.timing.totalMs>=result.timing.providerMs);
});

test('a malformed advice response is regenerated once and checked against the original meal count',async()=>{
 const requests=[];
 const result=await completeNutritionAdvice({provider,messages,purpose:'nutrition-advice',mealTiming:{mainMealCount:1},fetchImpl:async(_url,options)=>{
   requests.push(JSON.parse(options.body));
   return Response.json({choices:[{message:{content:requests.length===1?'{"version":3,"brief":':JSON.stringify(advice())},finish_reason:'stop'}]});
 }});
 assert.equal(result.adviceAttempts,2);
 assert.equal(requests.length,2);
 assert.match(requests[1].messages.at(-1).content,/格式无法解析/);
 assert.deepEqual(parseNutritionAdvice(result.content,{mainMealCount:1}),advice());
 assert.deepEqual(messages,[{role:'user',content:dailyMealAdvicePrompt}]);
});

test('valid advice with a string version is normalized without an extra provider call',async()=>{
 let calls=0;
 const result=await completeNutritionAdvice({provider,messages,purpose:'nutrition-advice',mealTiming:{mainMealCount:1},fetchImpl:async()=>{
   calls++;
   return Response.json({choices:[{message:{content:JSON.stringify({...advice(),version:'3'})},finish_reason:'stop'}]});
 }});
 assert.equal(calls,1);assert.equal(result.adviceAttempts,1);
 assert.deepEqual(JSON.parse(result.content),advice());
});

test('an empty model answer is retried as a generation failure',async()=>{
 let calls=0;
 const result=await completeNutritionAdvice({provider,messages,purpose:'nutrition-advice',fetchImpl:async()=>{
   calls++;
   return Response.json({choices:[{message:{content:calls===1?'':JSON.stringify(advice())}}]});
 }});
 assert.equal(calls,2);assert.equal(result.adviceAttempts,2);
});

test('provider truncation triggers regeneration even when the text happens to parse',async()=>{
 for(const protocol of ['openai','anthropic','gemini']){
   let calls=0;
   const result=await completeNutritionAdvice({provider:{...provider,protocol},messages,purpose:'nutrition-advice',mealTiming:{mainMealCount:1},fetchImpl:async()=>{
     calls++;
     const text=JSON.stringify(advice());
     const payload=protocol==='anthropic'?{content:[{type:'text',text}],stop_reason:calls===1?'max_tokens':'end_turn'}:protocol==='gemini'?{candidates:[{content:{parts:[{text}]},finishReason:calls===1?'MAX_TOKENS':'STOP'}]}:{choices:[{message:{content:text},finish_reason:calls===1?'length':'stop'}]};
     return Response.json(payload);
   }});
   assert.equal(calls,2,protocol);assert.equal(result.adviceAttempts,2);
 }
});

test('persistent semantic errors stop after two attempts; authentication errors are not retried',async()=>{
 let calls=0;
 await assert.rejects(completeNutritionAdvice({provider,messages,purpose:'nutrition-advice',mealTiming:{mainMealCount:2},fetchImpl:async()=>{
   calls++;
   return Response.json({choices:[{message:{content:JSON.stringify(advice())}}]});
 }}),error=>error.status===502&&/连续两次/.test(error.message));
 assert.equal(calls,2);
 calls=0;
 await assert.rejects(completeNutritionAdvice({provider,messages,purpose:'nutrition-advice',fetchImpl:async()=>{
   calls++;return new Response('unauthorized',{status:401});
 }}),error=>error.status===502);
 assert.equal(calls,1);
});

test('repair shares the original timeout budget',async()=>{
 let calls=0;
 await assert.rejects(completeNutritionAdvice({provider,messages,timeoutMs:10,completeImpl:async()=>{
   calls++;await new Promise(resolve=>setTimeout(resolve,25));return {content:'invalid'};
 }}),error=>error.status===504);
 assert.equal(calls,1);
});

test('the HTTP advice route repairs before returning and preserves stored advice on failure',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fitness-advice-repair-'));
 let calls=0,fail=false;
 const server=createServer({dataDir:directory,aiTimeoutMs:5000,fetchImpl:async()=>{
   calls++;
   return Response.json({choices:[{message:{content:fail||calls===1?'invalid':JSON.stringify(advice())},finish_reason:'stop'}]});
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api`;
 let cookie='';
 const api=async(path,method,body)=>{
   const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
   return {status:response.status,body:await response.json()};
 };
 const registered=await api('/auth/register','POST',{email:'advice@example.test',name:'Advice test',password:'advice-test-password'});
 assert.equal(registered.status,201);
 assert.equal((await api('/providers','PUT',{providers:[{id:'test',...provider}],tasks:{planning:'test'}})).status,200);
 const request={task:'planning',messages,context:{purpose:'nutrition-advice',mealTiming:{mainMealCount:1}}};
 const first=await api('/ai','POST',request);
 assert.equal(first.status,200);assert.equal(first.body.adviceAttempts,2);assert.equal(calls,2);
 const data={status:'ready',data:JSON.parse(first.body.content)};
 assert.equal((await api('/sync','POST',{userId:registered.body.user.id,changes:[{id:'nutrition-advice:2026-10-01',kind:'nutrition-advice',data,baseVersion:0}]})).status,200);
 fail=true;
 const failed=await api('/ai','POST',request);
 assert.equal(failed.status,502);assert.match(failed.body.error,/连续两次/);assert.equal(calls,4);
 const saved=await api('/state','GET');
 assert.equal(saved.status,200);
 assert.deepEqual(saved.body.records.find(record=>record.id==='nutrition-advice:2026-10-01').data,data);
 // The count from the HTTP context must still be enforced during both attempts.
 fail=false;
 const mismatched=await api('/ai','POST',{...request,context:{...request.context,mealTiming:{mainMealCount:2}}});
 assert.equal(mismatched.status,502);assert.equal(calls,6);
 fail=true;
 const ordinary=await api('/ai','POST',{...request,context:{purpose:'training'}});
 assert.equal(ordinary.status,200);assert.equal(ordinary.body.content,'invalid');assert.equal(calls,7);
});
