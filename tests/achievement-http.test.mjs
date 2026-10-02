import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server.mjs';
import {beijingDate} from '../public/achievements.js';
import {addDays} from '../public/schedule.js';

test('HTTP awards are authoritative, scoped, deduplicated and reversible across sync conflicts and reset',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'fitness-award-http-'));
 const server=await startServer({host:'127.0.0.1',port:0,dataDir});
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});await rm(dataDir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 async function api(path,body,cookie){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const alice=await api('/api/auth/register',{name:'Alice',email:'alice@example.test',password:'password-testing-123'});
 const bob=await api('/api/auth/register',{name:'Bob',email:'bob@example.test',password:'password-testing-123'});
 const sync=changes=>api('/api/sync',{userId:alice.body.user.id,changes},alice.cookie);
 const summary=response=>response.body.records.find(r=>r.id==='achievement-summary').data;
 const awards=response=>response.body.records.filter(r=>r.kind==='achievement'&&!r.deleted);
 const data={taskType:'training',date:beijingDate(),title:'肩背训练',daySnapshot:{exercises:[{exerciseId:'bench',sets:4,reps:'8'},{exerciseId:'row',sets:4,reps:'8'}]}};
 const change={id:'combined-session',kind:'calendar-task',data,baseVersion:0};
 assert.equal((await sync([change])).status,200);
 const done=structuredClone(data);done.daySnapshot.exercises.forEach(e=>e.completed=true);done.completedAt='2000-01-01T00:00:00Z';
 let response=await sync([{...change,data:done,baseVersion:1}]);assert.equal(response.status,200);assert.equal(summary(response).sessions,1);assert.equal(awards(response).length,1);assert.equal(awards(response)[0].data.earnedDate,beijingDate());
 // Repeated stale writes produce a conflict, never a second award or an undo.
 response=await sync([{...change,baseVersion:1}]);assert.equal(response.body.conflicts.length,1);assert.equal(summary(response).sessions,1);
 response=await sync([]);assert.equal(summary(response).sessions,1);assert.equal(awards(response).length,1);
 const empty=await api('/api/state',null,bob.cookie);assert.equal(summary(empty).sessions,0);assert.equal(awards(empty).length,0);
 assert.equal((await sync([{id:'forged',kind:'achievement',baseVersion:0,data:{type:'weeks-24'}}])).status,400);
 assert.equal((await sync([{id:'achievement:forged',kind:'calendar-task',baseVersion:0,data}])).status,400);
 assert.equal((await sync([{...change,id:'future',baseVersion:0,data:{...done,date:addDays(beijingDate(),1)}}])).status,400);
 // Undo retracts, then recheck restores a stable award ID.
 response=await sync([{...change,baseVersion:2}]);assert.equal(summary(response).sessions,0);assert.equal(awards(response).length,0);
 response=await sync([{...change,data:done,baseVersion:3}]);assert.equal(summary(response).sessions,1);const awardId=awards(response)[0].id;
 response=await sync([{...change,data:null,deleted:true,baseVersion:4}]);assert.equal(summary(response).sessions,1);assert.equal(awards(response)[0].id,awardId);
 const exported=await api('/api/export',null,alice.cookie);assert.equal(summary(exported).sessions,1);
 // Real sync captures cycle rules and positions, including undo and stale writes.
 const rule={id:'http-round',startDate:beijingDate(),plan:{name:'肩背循环',planVersion:'http-v1',days:[{id:'a',name:'肩背训练',exercises:[{exerciseId:'bench',sets:4,reps:'8'}]},{id:'rest',rest:true,exercises:[]},{id:'b',name:'胸部训练',exercises:[{exerciseId:'bench',sets:4,reps:'8'}]}]}};
 const cycleChanges=[{id:'calendar-cycle',kind:'training-cycle',data:rule,baseVersion:0},...[0,2].map(offset=>({id:'task:cycle:http-round:'+offset,kind:'calendar-task',baseVersion:0,data:{...done,cycleId:rule.id,planVersion:rule.plan.planVersion,dayId:offset===0?'a':'b'}}))];
 response=await sync(cycleChanges);assert.equal(response.status,200);assert.equal(summary(response).cycles,1);assert.equal(awards(response).filter(r=>r.data.type==='cycle-complete').length,1);
 response=await sync([{...cycleChanges[2],data:{...cycleChanges[2].data,daySnapshot:data.daySnapshot},baseVersion:1}]);assert.equal(summary(response).cycles,0);assert.equal(awards(response).some(r=>r.data.type==='cycle-complete'),false);
 response=await sync([{...cycleChanges[2],baseVersion:1}]);assert.equal(response.body.conflicts.length,1);assert.equal(summary(response).cycles,0);
 response=await sync([{...cycleChanges[2],baseVersion:2}]);assert.equal(summary(response).cycles,1);

});
