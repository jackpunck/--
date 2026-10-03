import test from 'node:test';
import assert from 'node:assert/strict';
import {newAchievementState,applyTrainingEvent,settleAchievementWeeks,achievementRecords} from '../server/achievement-rules.mjs';
import {addDays,recurringCalendarTasks} from '../public/schedule.js';
const action={exerciseId:'bench',sets:4,reps:'8'};
const task=(id,date,done=true)=>({id,kind:'calendar-task',data:{date,title:'肩背训练',daySnapshot:{exercises:[{...action,completed:done}]}}});
const award=(s,id)=>achievementRecords(s).find(r=>r.kind==='achievement'&&r.data.type===id);
const at=date=>date+'T10:00:00.000Z';
const cycle=(id='one',weekdays)=>({id:'calendar-cycle',kind:'training-cycle',data:{id,startDate:'2026-09-28',plan:{name:'肩背方案',planVersion:'v1',days:[{id:'shoulder-back',name:'肩背训练',exercises:[action]},{id:'rest',name:'休息',rest:true,exercises:[]},{id:'chest',name:'胸部训练',exercises:[action]}]},...(weekdays?{weekdays}:{})}});
const done=r=>({...r,data:{...r.data,daySnapshot:{...r.data.daySnapshot,exercises:r.data.daySnapshot.exercises.map(e=>({...e,completed:true}))}}});
test('10,25,100 sessions award once at the threshold and undo retracts the dependent milestone',()=>{
 const s=newAchievementState();
 for(let i=0;i<100;i++){
  applyTrainingEvent(s,task('s'+i,'2026-10-02'),at('2026-10-02'));
  for(const count of [10,25,100])assert.equal(!!award(s,'sessions-'+count),i+1>=count);
 }
 const stable=award(s,'sessions-100').id;applyTrainingEvent(s,task('s99','2026-10-02',false),at('2026-10-02'));assert.equal(award(s,'sessions-100'),undefined);
 applyTrainingEvent(s,task('s99','2026-10-02'),at('2026-10-02'));assert.equal(award(s,'sessions-100').id,stable);
});
test('52 distinct settled weeks award Four Seasons, without requiring consecutive weeks',()=>{
 const s=newAchievementState();
 for(let i=0;i<52;i++){
  const date=addDays('2024-01-01',i*14);applyTrainingEvent(s,task('w'+i,date),at(date));settleAchievementWeeks(s,at(addDays(date,7)));
  assert.equal(!!award(s,'weeks-52'),i===51);
 }
 applyTrainingEvent(s,task('w51',addDays('2024-01-01',51*14),false),at('2026-01-01'));assert.equal(award(s,'weeks-52'),undefined);
});
test('return uses a real 14-day gap, awards once, retracts on undo, and never treats first training as return',()=>{
 const s=newAchievementState();applyTrainingEvent(s,task('first','2026-09-01'),at('2026-09-01'));assert.equal(award(s,'training-return'),undefined);
 applyTrainingEvent(s,task('second','2026-09-15'),'2026-09-15T09:59:59.999Z');assert.equal(award(s,'training-return'),undefined);
 applyTrainingEvent(s,task('third','2026-09-29'),'2026-09-29T09:59:59.999Z');assert.ok(award(s,'training-return'));
 applyTrainingEvent(s,task('third','2026-09-29',false),at('2026-09-29'));assert.equal(award(s,'training-return'),undefined);
 applyTrainingEvent(s,task('third','2026-09-29'),at('2026-10-01'));assert.ok(award(s,'training-return'));
 assert.equal(achievementRecords(s).filter(r=>r.data.type==='training-return').length,1);
});
test('undoing intervening work or rechecking an old card cannot manufacture a return achievement',()=>{
 const s=newAchievementState();applyTrainingEvent(s,task('first','2026-09-01'),at('2026-09-01'));
 applyTrainingEvent(s,task('middle','2026-09-08'),at('2026-09-08'));applyTrainingEvent(s,task('last','2026-09-15'),at('2026-09-15'));
 applyTrainingEvent(s,task('middle','2026-09-08',false),at('2026-09-16'));assert.equal(award(s,'training-return'),undefined);
 applyTrainingEvent(s,task('last','2026-09-15',false),at('2026-10-01'));applyTrainingEvent(s,task('last','2026-09-15'),at('2026-10-01'));assert.equal(award(s,'training-return'),undefined);
});
test('full cycle requires every original training slot; rest and busy postponement are allowed',()=>{
 const s=newAchievementState(),rule=cycle();applyTrainingEvent(s,rule,at('2026-09-28'));
 const tasks=recurringCalendarTasks(rule.data,'2026-09-28','2026-10-04',['2026-09-28']);
 applyTrainingEvent(s,done(tasks[0]),at(tasks[0].data.date));assert.equal(award(s,'cycle-complete'),undefined);
 applyTrainingEvent(s,done(tasks[1]),at(tasks[1].data.date));assert.ok(award(s,'cycle-complete'));assert.equal(award(s,'cycle-complete').data.evidenceIds.length,2);
 applyTrainingEvent(s,{...tasks[1],deleted:true},at('2026-10-04'));assert.ok(award(s,'cycle-complete'));
 applyTrainingEvent(s,tasks[1],at('2026-10-04'));assert.equal(award(s,'cycle-complete'),undefined);
});
test('cycle slots cannot be removed, mixed across rounds or forged using a different plan day',()=>{
 for(const mode of ['delete','next-round','wrong-day','shrink','other-cycle']){
  const s=newAchievementState(),rule=cycle();applyTrainingEvent(s,rule,at('2026-09-28'));
  const tasks=recurringCalendarTasks(rule.data,'2026-09-28','2026-10-04');
  applyTrainingEvent(s,done(tasks[0]),at('2026-10-02'));
  if(mode==='delete')applyTrainingEvent(s,{...tasks[1],deleted:true},at('2026-10-02'));
  if(mode==='next-round')applyTrainingEvent(s,done(tasks[2]),at('2026-10-02'));
  if(mode==='wrong-day')applyTrainingEvent(s,{...done(tasks[1]),data:{...done(tasks[1]).data,dayId:'shoulder-back'}},at('2026-10-02'));
  if(mode==='shrink'){rule.data.plan.days.pop();applyTrainingEvent(s,rule,at('2026-10-02'));}
  if(mode==='other-cycle'){const other=cycle('two');applyTrainingEvent(s,other,at('2026-09-28'));applyTrainingEvent(s,done(recurringCalendarTasks(other.data,'2026-09-28','2026-10-04')[1]),at('2026-10-02'));}
  assert.equal(award(s,'cycle-complete'),undefined,mode);
 }
});
test('weekday scheduling uses training slots only and late cycle events retain task identities',()=>{
 const s=newAchievementState(),rule=cycle('weekly',[1,3,5]);const tasks=recurringCalendarTasks(rule.data,'2026-09-28','2026-10-02');
 for(const r of tasks.slice(0,2))applyTrainingEvent(s,done(r),at('2026-10-02'));
 assert.equal(award(s,'cycle-complete'),undefined);applyTrainingEvent(s,rule,at('2026-10-02'));assert.ok(award(s,'cycle-complete'));
 assert.equal(award(s,'cycle-complete').data.training.length,2);
});

test('malformed cycle rules are ignored without breaking achievement synchronization',()=>{
 for(const changes of [{days:[null]},{days:[{rest:false}]},{days:[{id:'x',exercises:[]}]},{weekdays:{}},{weekdays:[]},{weekdays:[9]}]){
  const s=newAchievementState(),rule=cycle();if(changes.days)rule.data.plan.days=changes.days;else rule.data.weekdays=changes.weekdays;
  assert.doesNotThrow(()=>applyTrainingEvent(s,rule,at('2026-10-02')));assert.equal(Object.keys(s.cycles).length,0);
 }
});

test('undo before a new completion still preserves intervening confirmation when measuring the return gap',()=>{
 const s=newAchievementState();applyTrainingEvent(s,task('first','2026-09-01'),at('2026-09-01'));
 applyTrainingEvent(s,task('middle','2026-09-08'),at('2026-09-08'));applyTrainingEvent(s,task('middle','2026-09-08',false),at('2026-09-09'));
 applyTrainingEvent(s,task('last','2026-09-15'),at('2026-09-15'));assert.equal(award(s,'training-return'),undefined);
});
