import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {exercises,exerciseUsesSeconds,defaultTrainingExercise} from '../public/domain.js';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const content=source.slice(source.indexOf('function trainingExerciseSummary('),source.indexOf('function exerciseLine('));
const conflictCheck=source.slice(source.indexOf('function assertTaskCurrent('),source.indexOf('function renderCalendarCard('));
const cardRenderer=source.slice(source.indexOf('function renderCalendarCard('),source.indexOf('function renderTraining('));
function setup(extra={}) {
  const context={structuredClone,exercises,exerciseUsesSeconds,defaultTrainingExercise,...extra};
  runInNewContext(conflictCheck+content,context);
  return context;
}
function task() {
  return {id:'task:one',kind:'calendar-task',data:{taskType:'training',title:'胸部训练',date:'2026-09-30',notes:'自定义备注',completed:false,dayId:'chest',planVersion:'original',daySnapshot:{id:'chest',name:'胸部训练',rest:false,exercises:[defaultTrainingExercise('bench'),defaultTrainingExercise('pushup')]}}};
}

test('training content formats repetitions and seconds without duplicate units',()=>{
  const context=setup();
  assert.equal(context.trainingExerciseSummary({exerciseId:'bench',sets:4,reps:'8'}),'4 组 × 8 次');
  assert.equal(context.trainingExerciseSummary({exerciseId:'plank',sets:4,reps:'30秒'}),'4 组 × 30 秒');
  assert.equal(context.trainingExerciseSummary({exerciseId:'plank',sets:3,reps:'20–40'}),'3 组 × 20–40 秒');
});

test('saving edited content writes only the selected session and preserves schedule metadata',async()=>{
  const record=task(),plan={days:[structuredClone(record.data.daySnapshot)]},before=structuredClone(plan);
  const edited=structuredClone(record.data.daySnapshot);
  edited.exercises.splice(0,1);edited.exercises[0].sets=5;edited.exercises[0].reps='10';edited.exercises.push(defaultTrainingExercise('plank'));
  const writes=[],shown=[];
  const context=setup({state:{trainingContentEditor:{record:structuredClone(record)},store:{put:async(kind,id,data)=>writes.push({kind,id,data})}},calendarTask:()=>record,renderTraining:()=>{},toast:()=>{}});
  context.readTrainingContentForm=()=>edited;context.showCalendarTask=id=>shown.push(id);
  await context.saveTrainingContent();
  assert.equal(writes.length,1);assert.equal(writes[0].id,record.id);assert.equal(writes[0].kind,'calendar-task');
  assert.equal(writes[0].data.date,record.data.date);assert.equal(writes[0].data.notes,record.data.notes);
  assert.equal(writes[0].data.planVersion,'original');assert.equal(writes[0].data.dayId,'chest');
  assert.deepEqual(writes[0].data.daySnapshot,edited);assert.deepEqual(plan,before);
  assert.equal(record.data.daySnapshot.exercises[0].exerciseId,'bench');assert.equal(record.data.daySnapshot.exercises[0].sets,4);
  edited.exercises[0].sets=12;assert.equal(writes[0].data.daySnapshot.exercises[0].sets,5);
  assert.deepEqual(shown,[record.id]);
});

test('stale or completed sessions and invalid edits cannot overwrite training content',async()=>{
  const record=task(),snapshot=structuredClone(record);let writes=0;
  const context=setup({state:{trainingContentEditor:{record:snapshot},store:{put:async()=>{writes++;}}},calendarTask:()=>record});
  context.readTrainingContentForm=()=>snapshot.data.daySnapshot;
  record.data.notes='changed elsewhere';
  await assert.rejects(context.saveTrainingContent(),/其他位置更新/);assert.equal(writes,0);
  record.data.completed=true;
  assert.throws(()=>context.trainingContentData(record,snapshot.data.daySnapshot),/实际记录/);
  record.data.completed=false;
  for(const changes of [{sets:0},{sets:1.5},{sets:13},{reps:' '},{exerciseId:'unknown'}]){
    const day=structuredClone(snapshot.data.daySnapshot);Object.assign(day.exercises[0],changes);
    assert.throws(()=>context.trainingContentData(record,day),/检查/);
  }
  assert.throws(()=>context.trainingContentData(record,{...snapshot.data.daySnapshot,exercises:[]}),/1–16/);
});

test('completed content shows actual records and no planned or delete controls',()=>{
  const record=task();record.data.completed=true;record.data.actual=[{exerciseId:'plank',sets:2,reps:'30秒',weight:0}];
  let html='';
  const context=setup({state:{},calendarTask:()=>record,taskDay:()=>record.data.daySnapshot,esc:value=>String(value??''),modal:(title,body)=>{html=body;}});
  context.trainingContentHeader=()=>{};context.showCalendarTask(record.id);
  assert.ok(html.includes('2 组 × 30 秒'));assert.ok(!html.includes('4 组 × 8 次'));
  assert.ok(!html.includes('calendar-delete'));assert.ok(!html.includes('calendar-edit'));
  assert.ok(!html.includes('休息'));assert.ok(!html.includes('秒 次'));
});

test('exercise checkoff toggles only the selected session snapshot and preserves other data',async()=>{
  const record=task(),before=structuredClone(record),writes=[];
  const context=setup({state:{calendarDetail:structuredClone(record),store:{put:async(kind,id,data)=>{writes.push({kind,id,data});record.data=data;}}},calendarTask:()=>record,taskDay:r=>r.data.daySnapshot});
  assert.equal(typeof context.toggleTrainingExercise,'function');
  await context.toggleTrainingExercise(record.id,0);
  assert.equal(writes[0].data.daySnapshot.exercises[0].completed,true);
  assert.equal(writes[0].data.daySnapshot.exercises[1].completed,undefined);
  assert.equal(record.data.completed,false);
  assert.equal(record.data.notes,before.data.notes);
  assert.equal(record.data.date,before.data.date);
  assert.equal(record.data.planVersion,before.data.planVersion);
  assert.deepEqual(before.data.daySnapshot.exercises[0],defaultTrainingExercise('bench'));
  context.state.calendarDetail=structuredClone(record);
  await context.toggleTrainingExercise(record.id,0);
  assert.equal(record.data.daySnapshot.exercises[0].completed,false);
  assert.equal(writes.length,2);
});

test('exercise checkoff rejects stale, mismatched, completed and invalid sessions',async()=>{
  const record=task();let writes=0;
  const context=setup({state:{calendarDetail:structuredClone(record),store:{put:async()=>writes++}},calendarTask:()=>record,taskDay:r=>r.data.daySnapshot});
  assert.equal(typeof context.toggleTrainingExercise,'function');
  await assert.rejects(context.toggleTrainingExercise('task:other',0));
  for(const index of [-1,0.5,2,NaN])await assert.rejects(context.toggleTrainingExercise(record.id,index));
  record.data.notes='changed';await assert.rejects(context.toggleTrainingExercise(record.id,0),/其他位置更新/);
  record.data.completed=true;context.state.calendarDetail=structuredClone(record);
  await assert.rejects(context.toggleTrainingExercise(record.id,0),/实际记录/);
  assert.equal(writes,0);
});

test('exercise details expose checkoff state per row',()=>{
  const record=task();record.data.daySnapshot.exercises[0].completed=true;let html='';
  const context=setup({state:{},calendarTask:()=>record,taskDay:()=>record.data.daySnapshot,esc:value=>String(value??''),button:()=>'',modal:(title,body)=>{html=body;}});
  context.trainingContentHeader=()=>{};context.showCalendarTask(record.id);
  assert.match(html,/training-exercise-toggle/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/aria-pressed="false"/);
  assert.match(html,/training-content-exercise is-completed/);
});

test('editing an exercise clears its checkoff while unchanged and removed rows keep their own state',()=>{
  const day=task().data.daySnapshot;day.exercises.forEach(e=>e.completed=true);
  const values={'exercise-0':'plank','sets-0':'4','reps-0':'30','exercise-1':'pushup','sets-1':'4','reps-1':'8'};
  const context=setup({state:{trainingContentEditor:{day}},$:()=>({}),formData:()=>values});
  context.readTrainingContentForm();
  assert.equal(day.exercises[0].completed,undefined);
  assert.equal(day.exercises[1].completed,true);
  day.exercises.splice(0,1);
  assert.equal(day.exercises[0].exerciseId,'pushup');assert.equal(day.exercises[0].completed,true);
});

test('calendar card follows all exercise checkoffs and reverts when one is unchecked',async()=>{
  const record=task();
  const context=setup({state:{calendarDetail:structuredClone(record),store:{put:async(kind,id,data)=>{record.data=data;}}},calendarTask:()=>record,taskDay:r=>r.data.daySnapshot,esc:String,icon:()=>'',button:(text,action)=>`<button data-action="${action}">${text}</button>`});
  runInNewContext(cardRenderer,context);
  for(let index=0;index<2;index++){
    context.state.calendarDetail=structuredClone(record);await context.toggleTrainingExercise(record.id,index);
    assert.match(context.renderCalendarCard(record),index===0?/待完成/:/已完成/);
  }
  assert.match(context.renderCalendarCard(record),/task-completed/);
  assert.doesNotMatch(context.renderCalendarCard(record),/calendar-edit|调整日期/);
  context.state.calendarDetail=structuredClone(record);await context.toggleTrainingExercise(record.id,0);
  assert.match(context.renderCalendarCard(record),/待完成/);
  assert.doesNotMatch(context.renderCalendarCard(record),/task-completed/);
  assert.equal(record.data.actual,undefined);
});

test('completion summary keeps saved training complete and does not complete empty sessions',()=>{
  const context=setup({taskDay:r=>r.data.daySnapshot});
  assert.equal(typeof context.trainingTaskCompleted,'function');
  const record=task();record.data.daySnapshot.exercises=[];
  assert.equal(context.trainingTaskCompleted(record),false);
  record.data.completed=true;assert.equal(context.trainingTaskCompleted(record),true);
});
