import test from 'node:test';
import assert from 'node:assert/strict';
import {getMotionExercise} from '../public/motion-catalog.js';
import {DATASET_GUIDED_EXERCISES,guidedRequestFields,requireGuidedSelection,selectGuidedRepresentatives} from '../scripts/motion-dataset-guided.mjs';
import {scoreMotionPrediction,summarizeDatasetResults} from '../scripts/motion-dataset-benchmark.mjs';

const expected={id:'test',exercise:'dumbbell-row',selectedExerciseId:'bilateral-dumbbell-row',qualityLabel:'author_bad',specificFault:null};
const coach=extra=>({mode:'guided',action:{...getMotionExercise(expected.selectedExerciseId),exerciseId:expected.selectedExerciseId,status:'selected',source:'user',confidence:null},selectionCheck:{status:'consistent'},verdict:{status:'needs-improvement'},feedback:[{status:'improve',evidence:'下放时躯干晃动',correction:'保持躯干位置',evidenceTimes:[1,2]}],...extra});
test('guided representatives preserve both author labels and fixed subjects/views without reading predictions',()=>{
  const items=['001','022'].flatMap(subject=>['good','bad'].flatMap(sourceLabel=>['front','side'].map(view=>({id:`${subject}-${sourceLabel}-${view}`,subject,sourceLabel,view,
    exercise:'dumbbell-row',qualityLabel:sourceLabel==='good'?'author_good':'author_bad',modelScore:subject==='022'?1:0}))));
  items.push({id:'wger-bench',exercise:'barbell-bench-press',sourceGroup:'wger',qualityLabel:'demonstration_unverified'},
    {id:'commons-bench',exercise:'barbell-bench-press',sourceGroup:'commons',qualityLabel:'demonstration_unverified'});
  const selected=selectGuidedRepresentatives(items);
  assert.equal(selected.length,3);assert.deepEqual(selected.filter(i=>i.subject).map(i=>i.id),['001-good-side','001-bad-side']);
  assert.equal(selected.find(i=>i.exercise==='barbell-bench-press').id,'commons-bench');
  assert.deepEqual(selected,selectGuidedRepresentatives(items.toReversed()));
  assert.equal(Object.keys(DATASET_GUIDED_EXERCISES).length,39);
  assert.notEqual(DATASET_GUIDED_EXERCISES['dumbbell-row'],'dumbbell-row');
  assert.notEqual(DATASET_GUIDED_EXERCISES['romanian-deadlift'],'rdl');
  assert.notEqual(DATASET_GUIDED_EXERCISES['pull-up'],'pullup');
  for(const [exercise,selectedExerciseId]of Object.entries(DATASET_GUIDED_EXERCISES))assert(getMotionExercise(requireGuidedSelection({id:exercise,exercise,selectedExerciseId})));
});
test('guided request fields require an explicit precise catalog id and omit truth',()=>{
  assert.deepEqual(guidedRequestFields(expected),{reviewMode:'guided',selectedExerciseId:'bilateral-dumbbell-row'});
  assert.throws(()=>guidedRequestFields({...expected,selectedExerciseId:'dumbbell-row'}),/mapping/);
  assert.throws(()=>guidedRequestFields({...expected,selectedExerciseId:undefined}),/explicit/);
});
test('a user-selected category never produces recognition or joint accuracy',()=>{
  const response=coach(),score=scoreMotionPrediction(expected,response);
  assert.equal(score.actionCorrect,null);assert.equal(score.jointCorrect,null);assert.equal(score.qualityCorrect,true);
  assert.equal(score.correctionAccuracy,null);
  const summary=summarizeDatasetResults([{id:'one',expected,coach:response,score,status:'ok'}],{reviewMode:'guided'});
  assert.equal(summary.recognitionAccuracyMeasured,false);assert.equal(summary.overall.action,undefined);
  assert.equal(summary.coverage.evaluatedExercises,1);assert.equal(summary.correctionReview.automaticallyScored,false);
});
test('guided failures and mismatch stay in author denominator, unknown labels stay out',()=>{
  const rows=[{expected,status:'ok',score:scoreMotionPrediction(expected,coach())},
    {expected,status:'error'},
    {expected,status:'ok',score:scoreMotionPrediction(expected,coach({selectionCheck:{status:'mismatch'}}))},
    {expected:{...expected,qualityLabel:'demonstration_unverified',independentReview:{verdict:'standard'}},status:'ok',score:scoreMotionPrediction({...expected,qualityLabel:'demonstration_unverified'},coach())}];
  const s=summarizeDatasetResults(rows,{reviewMode:'guided'});
  assert.deepEqual(s.overall.quality,{correct:1,total:3,rate:1/3});
  assert.equal(s.overall.failed,1);assert.equal(s.gate.passed,null);assert.equal(s.gate.legacyInformational.passed,false);
  assert.equal(s.overall.qualityConfusion.__unlabeled__['needs-improvement'],1);
});

test('planned unexecuted guided samples remain coverage gaps without fabricated errors or quality scores',()=>{
  const s=summarizeDatasetResults([{expected,status:'ok',score:scoreMotionPrediction(expected,coach())},
    {expected:{...expected,exercise:'bodyweight-squat'},status:'pending'}],{reviewMode:'guided'});
  assert.equal(s.overall.pending,1);assert.equal(s.overall.failed,0);assert.equal(s.overall.attempted,1);
  assert.deepEqual(s.overall.quality,{correct:1,total:1,rate:1});
  assert.equal(s.coverage.requestedExercises,2);assert.equal(s.coverage.evaluatedExercises,1);
  assert.equal(s.coverage.majorityOfPlannedClasses,false);assert.equal(s.gate.passed,null);
});
