import test from 'node:test';
import assert from 'node:assert/strict';
import {exercises, trainingParts, generatePartPlan, generateGroupedPlan, partPlanVariants, defaultTrainingExercise, exerciseUsesSeconds} from '../public/domain.js';
import {validatePlan} from '../server/plan-tools.mjs';
import {libraryPlan, createLibraryTemplate} from '../public/plan-library.js';
import {planCalendarTasks, recurringCalendarTasks} from '../public/schedule.js';

test('split count creates grouped sessions with four actions per muscle and existing rest rhythm', () => {
  const groups=[['back','shoulders'],['chest','arms'],['legs']];
  const original=structuredClone(groups);
  const draft=generateGroupedPlan({split:3,groups});
  assert.equal(draft.split,3);
  assert.deepEqual(draft.days.map(day=>day.rest),[false,false,true,false,true]);
  assert.deepEqual(draft.days.filter(day=>!day.rest).map(day=>day.parts),groups);
  assert.equal(draft.days[0].name,'背与肩训练');
  assert.deepEqual(draft.days[0].exercises.map(e=>e.part),['back','back','back','back','shoulders','shoulders','shoulders','shoulders']);
  assert.ok(draft.days[0].exercises.every(e=>e.sets===4&&e.reps==='8'));
  assert.deepEqual(groups,original);
  draft.days[0].parts.pop();draft.days[0].exercises[0].sets=9;
  assert.equal(generateGroupedPlan({split:3,groups}).days[0].exercises[0].sets,4);
});

test('same muscle can repeat across training days, with home equipment respected', () => {
  const draft=generateGroupedPlan({split:2,groups:[['back','shoulders'],['legs','shoulders']],variant:'home'});
  assert.deepEqual(draft.days[1].parts,['legs','shoulders']);
  for(const day of draft.days)for(const e of day.exercises)assert.ok(!exercises.find(x=>x.id===e.exerciseId).equipment.includes('器'));
});

test('grouped sessions reject empty days, duplicate parts within a day and invalid split or template', () => {
  for(const input of [
    {},{split:0,groups:[]},{split:6,groups:Array(6).fill(['chest'])},{split:1.5,groups:[['chest']]},
    {split:2,groups:[['chest']]},{split:1,groups:[[]]},{split:1,groups:[['chest','chest']]},
    {split:1,groups:[['unknown']]},{split:1,groups:['chest']},{split:1,groups:[['chest']],variant:'shoulders'},
  ])assert.throws(()=>generateGroupedPlan(input));
});

test('all five muscles fit in one saved and scheduled session with independent snapshots', () => {
  const draft=generateGroupedPlan({split:1,groups:[trainingParts.map(p=>p.id)]});
  assert.equal(draft.days[0].exercises.length,20);
  assert.equal(validatePlan(draft).days[0].exercises.length,20);
  const [record]=createLibraryTemplate([],draft,'template:test','2026-10-01T00:00:00Z');
  const plan=libraryPlan(record);
  const tasks=planCalendarTasks(plan,'2026-10-01');
  assert.equal(tasks[0].data.daySnapshot.exercises.length,20);
  assert.deepEqual(tasks[0].data.daySnapshot.parts,trainingParts.map(p=>p.id));
  plan.days[0].exercises[0].sets=9;
  assert.equal(tasks[0].data.daySnapshot.exercises[0].sets,4);
  assert.equal(record.data.days[0].exercises[0].sets,4);
});

test('busy dates postpone the entire combined session while preserving the next training day', () => {
  const [record]=createLibraryTemplate([],generateGroupedPlan({split:2,groups:[['back','shoulders'],['chest','arms']]}),'template:busy','2026-10-01T00:00:00Z');
  const cycle={id:'grouped-cycle',startDate:'2026-10-01',plan:libraryPlan(record)};
  const tasks=recurringCalendarTasks(cycle,'2026-10-01','2026-10-07',['2026-10-01']);
  assert.equal(tasks[0].data.date,'2026-10-02');
  assert.deepEqual(tasks[0].data.daySnapshot.parts,['back','shoulders']);
  assert.equal(tasks[0].data.daySnapshot.exercises.length,8);
  assert.equal(tasks[1].data.date,'2026-10-03');
  assert.deepEqual(tasks[1].data.daySnapshot.parts,['chest','arms']);
});

test('library and server agree on the custom exercise limit after combining muscles', () => {
  const draft=generateGroupedPlan({split:1,groups:[['back','shoulders']]});
  draft.days[0].exercises=Array.from({length:32},()=>defaultTrainingExercise('bench'));
  const record={id:'template:limit',kind:'training-template',data:draft};
  assert.equal(libraryPlan(record).days[0].exercises.length,32);
  assert.equal(validatePlan(draft).days[0].exercises.length,32);
  draft.days[0].exercises.push(defaultTrainingExercise('bench'));
  assert.throws(()=>libraryPlan(record),/1–32/);
  assert.throws(()=>validatePlan(draft),/1–32/);
});

// Every non-empty selection must remain usable by the existing persistence schema.
test('all part selections and templates produce four distinct catalog actions per training day', () => {
  for(let mask=1;mask<2**trainingParts.length;mask++) {
    const parts=trainingParts.filter((_,index)=>mask&(1<<index)).map(part=>part.id);
    for(const variant of partPlanVariants(parts)) {
      const draft=generatePartPlan({parts,variant});
      const training=draft.days.filter(day=>!day.rest);
      assert.equal(draft.split,parts.length);
      assert.equal(training.length,parts.length);
      assert.deepEqual(new Set(training.map(day=>day.part)),new Set(parts));
      assert.ok(draft.days.some(day=>day.rest));
      assert.equal(new Set(draft.days.map(day=>day.id)).size,draft.days.length);
      for(const day of training) {
        assert.equal(day.exercises.length,4);
        assert.ok(day.exercises.every(exercise=>exercise.sets===4&&exercise.reps==='8'));
        assert.equal(new Set(day.exercises.map(exercise=>exercise.exerciseId)).size,4);
        assert.ok(day.exercises.every(exercise=>exercises.some(item=>item.id===exercise.exerciseId)));
        if(variant==='home') assert.ok(day.exercises.every(exercise=>!exercises.find(item=>item.id===exercise.exerciseId).equipment.includes('器')));
      }
      assert.equal(validatePlan(draft).split,parts.length);
    }
  }
});

test('selection order, specialty order and edits do not mutate input or future drafts', () => {
  const parts=['arms','chest','shoulders','back'];
  const initial=[...parts];
  assert.deepEqual(generatePartPlan({parts}).parts,parts);
  const shoulder=generatePartPlan({parts,variant:'shoulders'});
  assert.deepEqual(shoulder.parts,['arms','chest','back','shoulders']);
  assert.equal(generatePartPlan({parts,variant:'arms'}).parts.at(-1),'arms');
  shoulder.days[0].exercises[0].sets=12;
  shoulder.days[0].exercises.splice(1,2);
  shoulder.parts.pop();
  const next=generatePartPlan({parts,variant:'shoulders'});
  assert.equal(next.days[0].exercises.length,4);
  assert.equal(next.days[0].exercises[0].sets,4);
  assert.deepEqual(parts,initial);
});

test('invalid selections and incompatible variants are rejected', () => {
  for(const parts of [undefined,null,[],['chest','chest'],['unknown'],'chest']) assert.throws(()=>generatePartPlan({parts}));
  assert.throws(()=>generatePartPlan({parts:['chest'],variant:'shoulders'}));
  assert.throws(()=>generatePartPlan({parts:['chest','back','legs','arms'],variant:'shoulders'}));
  assert.throws(()=>generatePartPlan({parts:['chest'],variant:'unknown'}));
  assert.equal(generatePartPlan({parts:['chest']}).split,1);
});

// Exercise the real editor serialization without a browser dependency.
test('draft edits preserve date, recovery days and internal rest settings', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('function readDraftForm() {');
  const end=source.indexOf('function viewDraft(',start);
  const original=generatePartPlan({parts:['chest','back']});
  original.scheduleDate='2026-10-01';
  const values={name:'My edited cycle'};
  original.days.forEach((day,i)=>day.exercises.forEach((exercise,j)=>{
    values[`e-${i}-${j}`]=exercise.exerciseId;
    values[`s-${i}-${j}`]=String(exercise.sets);
    values[`r-${i}-${j}`]=exercise.reps;
  }));
  values['e-0-0']='pushup';values['s-0-0']='5';values['r-0-0']='12';
  const edited=runInNewContext(source.slice(start,end)+';readDraftForm()',{
    state:{draftEditor:original},structuredClone,exerciseUsesSeconds,$:()=>({}),formData:()=>values,
  });
  assert.equal(edited.name,'My edited cycle');
  assert.equal(edited.scheduleDate,original.scheduleDate);
  assert.deepEqual(edited.days[0].exercises[0],{exerciseId:'pushup',sets:5,reps:'12',restSeconds:150});
  assert.deepEqual(edited.days.at(-1),original.days.at(-1));
  assert.equal(original.days[0].exercises[0].sets,4);
  assert.equal(validatePlan(edited).days[0].exercises[0].sets,5);
});

test('switching between repetition and timed actions updates the unit and saves seconds once', async () => {
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('function updateDraftExerciseUnit(target) {');
  const end=source.indexOf('function viewDraft(',start);
  const original=generatePartPlan({parts:['chest']});
  const values={name:original.name};
  original.days.forEach((day,i)=>day.exercises.forEach((exercise,j)=>{
    values[`e-${i}-${j}`]=exercise.exerciseId;
    values[`s-${i}-${j}`]=String(exercise.sets);
    values[`r-${i}-${j}`]=exercise.reps;
  }));
  const input={value:'12'},label={textContent:'次数'};
  const context={state:{draftEditor:original},target:{name:'e-0-0',value:'plank'},structuredClone,defaultTrainingExercise,exerciseUsesSeconds,
    $:selector=>selector==='#draft-r-0-0'?input:selector.startsWith('label')?label:{},
    formData:()=>({...values,'e-0-0':context.target.value,'r-0-0':input.value}),
  };
  const invoke=code=>runInNewContext(source.slice(start,end)+code,context);
  invoke('updateDraftExerciseUnit(target)');
  assert.equal(label.textContent,'秒');assert.equal(input.value,'20–40');
  input.value='35';
  const edited=invoke('readDraftForm()');
  assert.equal(edited.days[0].exercises[0].reps,'35秒');
  assert.equal(edited.days[0].exercises[0].sets,4);
  context.state.draftEditor=edited;context.target.value='pushup';
  invoke('updateDraftExerciseUnit(target)');
  assert.equal(label.textContent,'次数');assert.equal(input.value,'8');
  context.state.draftEditor=invoke('readDraftForm()');context.target.value='bench';input.value='15';
  invoke('updateDraftExerciseUnit(target)');
  assert.equal(input.value,'15','switching between counted actions keeps user repetitions');
});
