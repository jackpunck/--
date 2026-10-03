import test from 'node:test';
import assert from 'node:assert/strict';
import {newAchievementState, applyTrainingEvent, settleAchievementWeeks, achievementRecords} from '../server/achievement-rules.mjs';
import {beijingDate, validTrainingCompletion} from '../public/achievements.js';

const task=(id,date,done=false)=>({id,kind:'calendar-task',data:{date,title:'肩背训练',daySnapshot:{exercises:[{exerciseId:'bench',sets:4,reps:'8',completed:done},{exerciseId:'row',sets:4,reps:'8',completed:done}]}}});
const week='2026-09-28',fri='2026-10-02T10:00:00Z',mon='2026-10-04T16:00:00Z';
const awards=s=>achievementRecords(s).filter(r=>r.kind==='achievement');
const weekly=s=>awards(s).filter(r=>r.data.type==='weekly-training');

test('Beijing week settles only after Sunday, never immediately on last checkoff',()=>{
 const s=newAchievementState();applyTrainingEvent(s,task('one',week,true),fri);
 assert.equal(weekly(s).length,0);assert.equal(awards(s)[0].data.type,'first-training');
 settleAchievementWeeks(s,'2026-10-04T15:59:59Z');assert.equal(weekly(s).length,0);
 settleAchievementWeeks(s,mon);assert.equal(weekly(s).length,1);assert.equal(weekly(s)[0].data.earnedDate,'2026-10-05');
 assert.equal(beijingDate('2026-10-04T16:00:00Z'),'2026-10-05');
});
test('empty, partial, zero-set actual and future sessions do not count',()=>{
 const s=newAchievementState();settleAchievementWeeks(s,mon);assert.equal(awards(s).length,0);
 const empty=task('empty',week,true);empty.data.daySnapshot.exercises=[];
 const partial=task('partial',week,true);partial.data.daySnapshot.exercises[1].completed=false;
 const actual=task('actual',week,true);actual.data.completed=true;actual.data.actual=[{exerciseId:'bench',sets:0,reps:'8'},{exerciseId:'row',sets:4,reps:'8'}];
 for(const r of [empty,partial,actual,task('future','2026-10-05',true)])applyTrainingEvent(s,r,fri);
 assert.equal(awards(s).length,0);assert.equal(validTrainingCompletion(actual),false);
 settleAchievementWeeks(s,'2026-10-12T00:00:00Z');assert.equal(awards(s).length,0);
});
test('same card never counts twice; undo revokes dependencies and recheck restores them',()=>{
 const s=newAchievementState(),done=task('one',week,true);
 applyTrainingEvent(s,done,fri);applyTrainingEvent(s,done,fri);settleAchievementWeeks(s,mon);
 assert.equal(weekly(s)[0].data.trainingCount,1);
 applyTrainingEvent(s,task('one',week,false),'2026-10-05T01:00:00Z');assert.equal(awards(s).length,0);
 applyTrainingEvent(s,done,'2026-10-05T02:00:00Z');assert.equal(weekly(s).length,1);
 assert.equal(weekly(s)[0].id,'achievement:week:2026-09-28');
});
test('new work before week end prevents award; deleting it or finishing it after close cannot manufacture a week',()=>{
 for(const finish of [false,true]){
  const s=newAchievementState();applyTrainingEvent(s,task('one',week,true),fri);applyTrainingEvent(s,task('two','2026-10-04'),fri);
  const change=task('two','2026-10-04',finish);if(!finish)change.deleted=true;
  applyTrainingEvent(s,change,mon);assert.equal(weekly(s).length,0);
 }
});
test('deletion and reset archive confirmed sessions; moving pending sessions follows their actual week',()=>{
 const s=newAchievementState();applyTrainingEvent(s,task('one',week,true),fri);applyTrainingEvent(s,task('two','2026-10-03'),fri);
 applyTrainingEvent(s,task('two','2026-10-05'),fri);applyTrainingEvent(s,{...task('one',week,true),deleted:true},fri);
 settleAchievementWeeks(s,mon);assert.equal(weekly(s).length,1);assert.equal(awards(s).filter(r=>r.data.type==='first-training').length,1);
});
test('week/year boundary and cumulative milestones count distinct weeks and tasks',()=>{
 const s=newAchievementState();
 for(let i=0;i<24;i++){
  const date=new Date(Date.UTC(2026,0,5+i*7)).toISOString().slice(0,10);
  applyTrainingEvent(s,task('w'+i,date,true),date+'T10:00:00Z');
 }
 settleAchievementWeeks(s,'2026-07-01T00:00:00Z');assert.equal(weekly(s).length,24);
 for(const type of ['weeks-4','weeks-12','weeks-24'])assert.equal(awards(s).filter(r=>r.data.type===type).length,1);
 for(let i=24;i<50;i++)applyTrainingEvent(s,task('w'+i,'2026-07-01',true),'2026-07-01T10:00:00Z');
 assert.equal(awards(s).filter(r=>r.data.type==='sessions-50').length,1);
 applyTrainingEvent(s,task('w49','2026-07-01',false),'2026-07-01T11:00:00Z');assert.equal(awards(s).filter(r=>r.data.type==='sessions-50').length,0);
 const cross=newAchievementState();applyTrainingEvent(cross,task('x','2027-01-01',true),'2027-01-01T10:00:00Z');settleAchievementWeeks(cross,'2027-01-03T16:00:00Z');assert.equal(weekly(cross)[0].data.weekStart,'2026-12-28');
});

test('reserved object property task IDs stay isolated and survive state serialization',()=>{
 let s=newAchievementState();
 for(const id of ['__proto__','constructor','toString'])applyTrainingEvent(s,task(id,week,true),fri);
 s=JSON.parse(JSON.stringify(s));settleAchievementWeeks(s,mon);
 assert.equal(weekly(s)[0].data.trainingCount,3);
 assert.equal(achievementRecords(s).find(r=>r.id==='achievement-summary').data.sessions,3);
 applyTrainingEvent(s,task('__proto__',week,false),'2026-10-05T02:00:00Z');assert.equal(weekly(s).length,0);
});
