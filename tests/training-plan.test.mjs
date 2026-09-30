import test from 'node:test';
import assert from 'node:assert/strict';
import {exercises, trainingParts, generatePartPlan, partPlanVariants, defaultTrainingExercise, exerciseUsesSeconds} from '../public/domain.js';
import {validatePlan} from '../server/plan-tools.mjs';

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
  const end=source.indexOf('function viewDraft()',start);
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
  const end=source.indexOf('function viewDraft()',start);
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
