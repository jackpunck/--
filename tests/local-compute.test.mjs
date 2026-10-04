import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server.mjs';
import {compute} from '../server/compute.mjs';
import {createComputedState} from '../public/compute.js';
import {calculateNutrition,estimate1RM} from '../public/domain.js';

test('local calculation endpoint authenticates, limits operations and returns the established formulas',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fitness-compute-')),server=await startServer({dataDir:dir,host:'127.0.0.1',port:0});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,cookie='',headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(body)});
 assert.equal((await post('/api/compute',{operation:'estimate1RM',args:[40,8]})).status,401);
 const register=await post('/api/auth/register',{name:'本地计算',email:'compute@example.test',password:'password-123'}),user=(await register.json()).user,cookie=register.headers.get('set-cookie').split(';')[0];
 assert.equal((await post('/api/compute',{operation:'constructor',args:[]},cookie)).status,400);
 assert.equal((await post('/api/compute',{operation:'estimate1RM',args:[40,8]},cookie,{'X-Fitness-User':'other'})).status,409);
 assert.equal((await post('/api/compute',{operation:'estimate1RM',args:[40,8]},cookie,{Origin:'https://other.example'})).status,403);
 const result=await post('/api/compute',{operation:'estimate1RM',args:[40,8]},cookie,{'X-Fitness-User':user.id});
 assert.deepEqual((await result.json()).result,estimate1RM(40,8));
});

test('snapshot computes unsynced nutrition, totals, day types and historical meals on the service',()=>{
 const profile={age:30,sex:'male',height:175,weight:70,goal:'maintain',activity:1.55};
 const meal={date:'2026-10-04',confirmed:true,items:[{name:'牛奶',grams:200,kcal:60,protein:3,carbs:5,fat:3}]};
 const records=[{id:'profile',kind:'profile',data:profile},{id:'meal:a',kind:'meal',data:meal},{id:'task:a',kind:'calendar-task',data:{date:meal.date,taskType:'training',title:'训练'}}];
 const result=compute({operation:'snapshot',args:[{records,today:meal.date,dates:[meal.date],now:'2026-10-04T04:00:00Z'}]});
 assert.equal(result.dayTypes[meal.date],'training');assert.deepEqual(result.nutrition.training,calculateNutrition(profile,'training'));
 assert.deepEqual(result.totals[meal.date],{kcal:120,protein:6,carbs:10,fat:6});
 assert.equal(result.advice[meal.date].meals[0].items[0].category,'加餐');
 records[2].data.date='2026-10-05';
 assert.equal(compute({operation:'snapshot',args:[{records,today:meal.date,dates:[meal.date]}]}).dayTypes[meal.date],'rest');
});

test('meal portions, manual macro energy and reverse conversion execute on the service',()=>{
 const item={name:'食物',grams:200,protein:10,carbs:20,fat:5,kcal:165};
 const call=(operation,...args)=>compute({operation,args});
 const [portion]=call('mealPortions',[item]);assert.equal(portion.kcal,330);
 const resized=call('updateMealPortion',{...portion,grams:300},'grams',200);assert.equal(resized.protein,30);assert.equal(resized.kcal,495);
 const changed=call('updateMealPortion',{...resized,protein:40},'protein',300);assert.equal(changed.kcal,535);
 assert.equal(call('mealItems',[changed])[0].grams,300);
 assert.throws(()=>call('mealItems',[{...changed,grams:0}]),/份量/);
});

test('late and duplicate snapshot responses cannot overwrite the latest input',async()=>{
 let input={date:'first'},calls=0;const pending=new Map();
 const state=createComputedState(()=>input,(_name,value)=>{calls++;return new Promise(resolve=>pending.set(value.date,resolve));});
 const first=state.refresh(),duplicate=state.refresh();assert.equal(calls,1);
 input={date:'second'};const second=state.refresh();pending.get('second')({date:'second'});assert.equal((await second).date,'second');
 pending.get('first')({date:'first'});assert.equal((await first).date,'second');assert.equal((await duplicate).date,'second');assert.equal(calls,2);
});

test('server nutrition advice uses the visiting user timezone',()=>{
 const request={records:[],today:'2026-10-05',dates:['2026-10-05'],now:'2026-10-04T20:30:00Z',timezoneOffset:-480};
 const local=compute({operation:'snapshot',args:[request]}).advice['2026-10-05'].mealTiming;
 assert.equal(local.localDate,'2026-10-05');assert.equal(local.localTime,'04:30');assert.equal(local.scenario,'meal');
 const utc=compute({operation:'snapshot',args:[{...request,timezoneOffset:0}]}).advice['2026-10-05'].mealTiming;
 assert.equal(utc.localDate,'2026-10-04');assert.equal(utc.scenario,'plan');
});

test('saved meal advice is filtered on the server without rewriting the saved entry',()=>{
 const record={id:'nutrition-advice:2026-10-04',kind:'nutrition-advice',data:{status:'ready',timing:{earliestMealIndex:1},data:{brief:{meals:[{name:'早餐',status:'planned'},{name:'午餐',status:'recorded'},{name:'晚餐',status:'planned'}]}}}};
 const snapshot=compute({operation:'snapshot',args:[{records:[record],dates:[],today:'2026-10-04'}]});
 assert.deepEqual(snapshot.savedAdvice[record.id].data.brief.displayMeals.map(item=>item.name),['晚餐']);
 assert.equal(record.data.data.brief.meals.length,3);assert.equal(record.data.data.brief.displayMeals,undefined);
});
