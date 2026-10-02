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
 assert.deepEqual(getRecords(db,'alice').find(r=>r.id==='achievement-summary').data,{ruleVersion:2,sessions:0,weeks:1});
});

test('first upgrade keeps pre-existing completion when the first new event is deletion after week close',async t=>{
 const {db,write,awards}=await fixture(t);
 write('old',data(true));db.exec('DELETE FROM achievement_events');
 write('old',null,mon);reconcileAchievements(db,'alice',mon);
 assert.equal(awards().filter(r=>r.data.type==='weekly-training').length,1);
 assert.equal(awards().find(r=>r.data.type==='first-training').data.earnedDate,'2026-10-02');
});
