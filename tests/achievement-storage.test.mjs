import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,getRecords} from '../server/storage.mjs';
import {reconcileAchievements} from '../server/achievements.mjs';

const fri='2026-10-02T10:00:00.000Z',mon='2026-10-04T16:00:00.000Z';
const data=(done=false)=>({date:'2026-10-02',title:'肩背训练',daySnapshot:{exercises:[{exerciseId:'bench',sets:4,reps:'8',completed:done}]}});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'fitness-achievements-')),store=openStore(dir),{db}=store;
 for(const user of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user,user+'@example.test',user,'test',fri);
 t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
 const write=(id,value,at=fri,user='alice',kind='calendar-task')=>db.prepare('INSERT INTO records VALUES(?,?,?,?,1,?,?) ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data,deleted=excluded.deleted,version=records.version+1,updated_at=excluded.updated_at').run(user,id,kind,JSON.stringify(value),value===null?1:0,at);
 const awards=(user='alice')=>getRecords(db,user).filter(r=>r.kind==='achievement'&&!r.deleted);
 return {db,write,awards};
}
test('journal retains completion through deletion before reconciliation, isolates users, and is idempotent',async t=>{
 const {db,write,awards}=await fixture(t);
 write('a',data());write('a',data(true));write('a',null);
 reconcileAchievements(db,'alice',fri);assert.equal(awards().length,1);
 reconcileAchievements(db,'alice',mon);assert.equal(awards().length,2);
 const before=getRecords(db,'alice');reconcileAchievements(db,'alice',mon);assert.deepEqual(getRecords(db,'alice'),before);
 reconcileAchievements(db,'bob',mon);assert.equal(awards('bob').length,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM achievement_events').get().n,0);
});
test('state, history and awards roll back with the surrounding transaction',async t=>{
 const {db,write,awards}=await fixture(t);
 reconcileAchievements(db,'alice',fri);
 db.exec('BEGIN');write('a',data(true));reconcileAchievements(db,'alice',mon);assert.equal(awards().length,2);db.exec('ROLLBACK');
 assert.equal(awards().length,0);assert.equal(db.prepare('SELECT count(*) AS n FROM achievement_events').get().n,0);
});
test('post-close removal of pending work does not award a week, and undo retracts a previously earned week',async t=>{
 const {db,write,awards}=await fixture(t);write('a',data(true));write('b',data());reconcileAchievements(db,'alice',fri);
 write('b',null,mon);reconcileAchievements(db,'alice',mon);assert.equal(awards().some(r=>r.data.type==='weekly-training'),false);
 write('c',{...data(true),date:'2026-10-05'},'2026-10-05T10:00:00.000Z');reconcileAchievements(db,'alice','2026-10-11T16:00:00.000Z');
 assert.equal(awards().filter(r=>r.data.type==='weekly-training').length,1);
 write('c',{...data(),date:'2026-10-05'},'2026-10-12T10:00:00.000Z');reconcileAchievements(db,'alice','2026-10-12T10:00:00.000Z');
 assert.equal(awards().filter(r=>r.data.type==='weekly-training').length,0);
});
test('legacy award without detail preserves weeks but never invents session counts',async t=>{
 const {db,write,awards}=await fixture(t);
 write('achievement:week:2026-09-21',{type:'weekly-training',weekStart:'2026-09-21',weekEnd:'2026-09-27',earnedDate:'2026-09-27',trainingCount:3},fri,'alice','achievement');
 reconcileAchievements(db,'alice',fri);
 assert.equal(awards()[0].data.source,'legacy');
 assert.deepEqual(getRecords(db,'alice').find(r=>r.id==='achievement-summary').data,{ruleVersion:2,sessions:0,weeks:1,cycles:0});
});

test('first upgrade keeps pre-existing completion when the first new event is deletion after week close',async t=>{
 const {db,write,awards}=await fixture(t);
 write('old',data(true));db.exec('DELETE FROM achievement_events');
 write('old',null,mon);reconcileAchievements(db,'alice',mon);
 assert.equal(awards().filter(r=>r.data.type==='weekly-training').length,1);
 assert.equal(awards().find(r=>r.data.type==='first-training').data.earnedDate,'2026-10-02');
});

const cycleRule={id:'original',startDate:'2026-10-02',plan:{name:'肩背方案',planVersion:'v1',days:[{id:'one',name:'肩背训练',exercises:[{exerciseId:'bench',sets:4,reps:'8'}]},{id:'rest',rest:true,exercises:[]},{id:'two',name:'胸部训练',exercises:[{exerciseId:'bench',sets:4,reps:'8'}]}]}};
const cycleTask=(offset,done)=>({...data(done),cycleId:'original',dayId:offset===0?'one':'two',planVersion:'v1'});
test('cycle journal survives reset, isolates accounts, and retracts on undo',async t=>{
 const {db,write,awards}=await fixture(t);
 write('calendar-cycle',cycleRule,fri,'alice','training-cycle');
 for(const offset of [0,2])write('task:cycle:original:'+offset,cycleTask(offset,true));
 write('calendar-cycle',null,mon,'alice','training-cycle');for(const offset of [0,2])write('task:cycle:original:'+offset,null,mon);
 reconcileAchievements(db,'alice',mon);assert.ok(awards().find(r=>r.data.type==='cycle-complete'));
 reconcileAchievements(db,'bob',mon);assert.equal(awards('bob').length,0);
 const initial=db.prepare('SELECT data FROM achievement_state WHERE user_id=?').get('alice').data;
 db.exec('BEGIN');write('task:cycle:original:2',cycleTask(2,false),mon);reconcileAchievements(db,'alice',mon);assert.equal(awards().some(r=>r.data.type==='cycle-complete'),false);db.exec('ROLLBACK');
 assert.equal(db.prepare('SELECT data FROM achievement_state WHERE user_id=?').get('alice').data,initial);
});
test('older stored ledger is enriched from surviving cycle records without changing completion time',async t=>{
 const {db,write,awards}=await fixture(t);
 write('calendar-cycle',cycleRule,fri,'alice','training-cycle');
 const sessions={};
 for(const offset of [0,2]){
  const id='task:cycle:original:'+offset;write(id,cycleTask(offset,true),mon);
  sessions[id]={id,date:'2026-10-02',title:'肩背训练',archived:false,completed:true,completedAt:fri,blockedFuture:false};
 }
 db.exec('DELETE FROM achievement_events');
 db.prepare('INSERT INTO achievement_state VALUES(?,?)').run('alice',JSON.stringify({version:2,sessions,weeks:{},legacy:{}}));
 reconcileAchievements(db,'alice',mon);assert.ok(awards().find(r=>r.data.type==='cycle-complete'));
 assert.equal(awards().find(r=>r.data.type==='cycle-complete').data.earnedAt,fri);
 assert.equal(awards().some(r=>r.data.type==='training-return'),false);
 const before=getRecords(db,'alice');reconcileAchievements(db,'alice',mon);assert.deepEqual(getRecords(db,'alice'),before);
});

test('ambiguous v2 undone history cannot earn return via an old recheck or a new card across missing history',async t=>{
 const {db,write,awards}=await fixture(t),migration='2026-09-09T10:00:00.000Z';
 for(const user of ['alice','bob']){
  const first={id:'first',date:'2026-09-01',title:'训练',archived:false,completed:true,completedAt:'2026-09-01T10:00:00.000Z',blockedFuture:false};
  const old={id:'old',date:'2026-09-08',title:'训练',archived:false,completed:false,completedAt:null,blockedFuture:false};
  write('first',{...data(true),date:first.date},first.completedAt,user);write('old',{...data(),date:old.date},migration,user);
  db.prepare('INSERT INTO achievement_state VALUES(?,?)').run(user,JSON.stringify({version:2,sessions:{first,old},weeks:{},legacy:{}}));
 }
 db.exec('DELETE FROM achievement_events');
 for(const user of ['alice','bob']){
  reconcileAchievements(db,user,migration);
  write(user==='alice'?'old':'new',{...data(true),date:'2026-09-15'},'2026-09-15T10:00:00.000Z',user);
  reconcileAchievements(db,user,'2026-09-15T10:00:00.000Z');assert.equal(awards(user).some(r=>r.data.type==='training-return'),false,user);
  write('return',{...data(true),date:'2026-09-29'},'2026-09-29T10:00:00.000Z',user);
  reconcileAchievements(db,user,'2026-09-29T10:00:00.000Z');assert.equal(awards(user).some(r=>r.data.type==='training-return'),true,user);
 }
});

test('first-time baseline import treats incomplete old cards as ambiguous return evidence',async t=>{
 const {db,write,awards}=await fixture(t),migration='2026-09-09T10:00:00.000Z';
 for(const user of ['alice','bob']){
  write('first',{...data(true),date:'2026-09-01'},'2026-09-01T10:00:00.000Z',user);
  write('old',{...data(),date:'2026-09-08'},'2026-09-08T10:00:00.000Z',user);
 }
 db.exec('DELETE FROM achievement_events');
 for(const user of ['alice','bob']){
  reconcileAchievements(db,user,migration);
  write(user==='alice'?'old':'new',{...data(true),date:'2026-09-15'},'2026-09-15T10:00:00.000Z',user);
  reconcileAchievements(db,user,'2026-09-15T10:00:00.000Z');assert.equal(awards(user).some(r=>r.data.type==='training-return'),false,user);
  write('return',{...data(true),date:'2026-09-29'},'2026-09-29T10:00:00.000Z',user);
  reconcileAchievements(db,user,'2026-09-29T10:00:00.000Z');assert.equal(awards(user).some(r=>r.data.type==='training-return'),true,user);
 }
});
