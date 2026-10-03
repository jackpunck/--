import test from 'node:test';
import assert from 'node:assert/strict';
import {motionExercises, getMotionExercise} from '../public/motion-catalog.js';
import {compactMotionAnalysis, motionCoachActionCatalog, sanitizeMotionCoachResponse, mergeCoachAssessment} from '../public/motion-contract.js';

const legacyIds = ['squat','pushup','curl','bench','incline-bench','chest-press','lat-pulldown','row','dumbbell-row','pullup','shoulder-press','lateral-raise','reverse-fly','triceps','overhead-triceps','hammer-curl','goblet-squat','rdl','lunge','leg-curl','leg-extension','glute-bridge','plank','crunch','calf-raise'];
const newIds = ['barbell-bench','incline-barbell-bench','smith-bench','incline-smith-bench','barbell-row','machine-row','chest-supported-row'];
const frames = [{time:1},{time:2},{time:3}];
const examples = [
  ['bench','dumbbell','flat-bench','horizontal-press','bilateral'],
  ['incline-bench','dumbbell','incline-bench','horizontal-press','bilateral'],
  ['chest-press','machine','seated','horizontal-press','bilateral'],
  ['row','cable','seated','row','bilateral'],
  ['dumbbell-row','dumbbell','single-arm-supported','row','unilateral'],
  ['barbell-bench','barbell','flat-bench','horizontal-press','bilateral'],
  ['incline-barbell-bench','barbell','incline-bench','horizontal-press','bilateral'],
  ['smith-bench','smith-machine','flat-bench','horizontal-press','bilateral'],
  ['incline-smith-bench','smith-machine','incline-bench','horizontal-press','bilateral'],
  ['barbell-row','barbell','bent-over','row','bilateral'],
  ['machine-row','machine','seated','row','bilateral'],
  ['chest-supported-row','dumbbell','chest-supported','row','bilateral'],
];
const observation = ([,equipment,support,movement,laterality], evidenceTimes=[1,2]) => ({equipment,support,movement,laterality,evidence:'画面中负重器械、身体支撑与推拉方向持续清楚可见。',evidenceTimes});
const output = (example=examples[5], overrides={}) => ({action:{exerciseId:example[0],status:'identified',confidence:'high',evidenceTimes:[1,2],observations:observation(example),...overrides},checks:[]});
const sanitize = (value, options={}) => sanitizeMotionCoachResponse(value,{mode:'visual',keyframes:frames,...options});

test('equipment actions extend the motion catalogue while preserving legacy teaching IDs and recipes', () => {
  assert.equal(motionExercises.length,32);
  assert.equal(new Set(motionExercises.map(item=>item.id)).size,32);
  assert.equal(getMotionExercise('bench').name,'哑铃卧推');
  assert.equal(getMotionExercise('row').name,'坐姿绳索划船');
  assert.deepEqual(motionExercises.filter(item=>item.hasTeaching).map(item=>item.id),legacyIds);
  assert.deepEqual(motionExercises.filter(item=>!item.hasTeaching).map(item=>item.id),newIds);
  for(const id of newIds){
    const exercise=getMotionExercise(id);
    assert.equal(exercise.checks.reduce((total,check)=>total+check.weight,0),100);
    assert.deepEqual(exercise.requiredChecks,getMotionExercise(exercise.family==='row'?'row':'bench').requiredChecks);
  }
});

test('the model catalogue supplies concrete visual recognition rules for every press and row', () => {
  const catalog=motionCoachActionCatalog();
  for(const [id,equipment,support,movement,laterality] of examples){
    const rules=catalog.find(item=>item.id===id)?.recognitionRules;
    assert.ok(rules,`${id} must require equipment and support observations`);
    assert.ok(rules.equipment.includes(equipment),id);
    assert.ok(rules.support.includes(support),id);
    assert.equal(rules.movement,movement);
    assert.ok(rules.laterality.includes(laterality),id);
  }
  assert.deepEqual(getMotionExercise('machine-row').recognitionRules.support,['seated','chest-supported']);
  assert.deepEqual(getMotionExercise('chest-supported-row').recognitionRules.equipment,['dumbbell','barbell']);
});

test('two matching visual observations identify the correct equipment action and survive sanitization', () => {
  for(const example of examples){
    const result=sanitize(output(example));
    assert.equal(result.action.exerciseId,example[0],example[0]);
    assert.equal(result.action.status,'identified');
    assert.deepEqual(result.action.observations,observation(example));
  }
  const example=examples[11], alternate=observation(example);
  alternate.equipment='barbell';
  assert.equal(sanitize(output(example,{observations:alternate})).action.exerciseId,'chest-supported-row');
});

test('equipment labels abstain without matching visible equipment, support, movement and laterality', () => {
  const example=examples[5], original=observation(example);
  const invalid=[
    undefined,
    {...original,equipment:'dumbbell'},
    {...original,equipment:'smith-machine'},
    {...original,equipment:'invented-machine'},
    {...original,support:'incline-bench'},
    {...original,movement:'row'},
    {...original,laterality:'unilateral'},
    {...original,evidence:'  '},
    {...original,evidence:'abc'},
    {...original,evidenceTimes:[1]},
    {...original,evidenceTimes:[2,3]},
    {...original,evidenceTimes:[1,99]},
  ];
  for(const observations of invalid){
    const result=sanitize(output(example,{observations}));
    assert.equal(result.action.status,'unknown',JSON.stringify(observations));
    assert.equal(result.action.exerciseId,null);
    assert.ok(result.candidates.some(item=>item.exerciseId==='barbell-bench'));
    assert.equal(result.candidates.find(item=>item.exerciseId==='barbell-bench').confidence,'low');
  }
  for(const example of examples)assert.equal(sanitize(output(example,{observations:undefined})).action.status,'unknown',example[0]);
});

test('equipment evidence uses two distinct shared actual keyframe times and drops arbitrary data', () => {
  const example=examples[5], original=observation(example);
  assert.equal(sanitize(output(example,{observations:{...original,evidenceTimes:[1,1,99]}})).action.status,'unknown');
  const result=sanitize(output(example,{evidenceTimes:[1.02,2.02],observations:{...original,evidence:'\u0000  清楚可见杠铃与平凳支撑。  ',evidenceTimes:[1.01,2.01,99],rawLandmarks:Array(33).fill(1)}}));
  assert.deepEqual(result.action.observations,{...original,evidence:'清楚可见杠铃与平凳支撑。',evidenceTimes:[1,2]});
  assert.deepEqual(result.action.evidenceTimes,[1,2]);
});

test('bodyweight recognition stays compatible while text or missing frames cannot identify equipment', () => {
  const simple={action:{exerciseId:'pushup',status:'identified',confidence:'high',evidenceTimes:[1,2]},checks:[]};
  assert.equal(sanitize(simple).action.exerciseId,'pushup');
  for(const options of [{mode:'evidence-only'},{keyframes:[]},{keyframes:[{time:1}]}]){
    assert.equal(sanitize(output(),options).action.exerciseId,null);
  }
});

test('analysis compaction retains all supported candidate actions without accepting unknown IDs', () => {
  const result=compactMotionAnalysis({candidates:[...legacyIds,...newIds,'invented-action'].map(exerciseId=>({exerciseId}))});
  assert.equal(result.candidates.length,32);
  assert.deepEqual(result.candidates.map(item=>item.exerciseId),[...legacyIds,...newIds]);
});

test('a hard quality failure retains a confirmed equipment name without permitting any scoring', () => {
  const coach=sanitize(output());
  const rep={index:1,start:0,end:3,bottom:1.5,time:1.5,qualified:true,score:90,observedScore:90,scoreStatus:'assessed',scoreCoverage:1,metrics:{angleRange:90},checks:[{code:'PRESS_TRUNK',status:'pass',evidenceTimes:[1],evidence:{samples:30}}],issues:[{code:'POSE_GAP',time:2,message:'原始检查证据'}]};
  const base={exerciseId:null,exerciseFamily:'horizontal-press',requiresVisualConfirmation:true,status:'unsupported',score:90,observedScore:90,scoreCoverage:1,scoreStatus:'assessed',qualified:true,qualifiedRepCount:1,quality:{reasons:['LOW_TARGET_COVERAGE']},reps:[rep]};
  const result=mergeCoachAssessment(base,coach);
  assert.equal(result.exerciseId,'barbell-bench');
  assert.equal(result.exerciseFamily,'horizontal-press');
  assert.equal(result.requiresVisualConfirmation,false);
  assert.equal(result.score,null);
  assert.equal(result.observedScore,null);
  assert.equal(result.scoreStatus,'unavailable');
  assert.equal(result.scoreCoverage,0);
  assert.equal(result.qualified,false);
  assert.equal(result.qualifiedRepCount,0);
  assert.deepEqual(result.reps,[{...rep,score:null,observedScore:null,scoreStatus:'unavailable',scoreCoverage:0,qualified:false}]);
  const conflict=mergeCoachAssessment({...base,exerciseFamily:'row'},coach);
  assert.equal(conflict.exerciseId,'barbell-bench','Sparse target tracking cannot establish a conflicting pose family');
  assert.equal(conflict.recognitionConflict,false);
  assert.equal(conflict.requiresVisualConfirmation,false);
  assert.equal(conflict.score,null);
  assert.ok(conflict.reps.every(rep=>rep.score===null&&rep.qualified===false));
  const reliableConflict=mergeCoachAssessment({...base,exerciseFamily:'row',quality:{reasons:[]}},coach);
  assert.equal(reliableConflict.exerciseId,null);
  assert.equal(reliableConflict.recognitionConflict,true);
  assert.equal(reliableConflict.requiresVisualConfirmation,true);
  assert.equal(reliableConflict.score,null);
});

test('a family conflict removes each repetition score while preserving its measured evidence and times', () => {
  const coach=sanitize(output());
  const rep={index:1,start:0,end:3,bottom:1.5,time:1.5,qualified:true,score:90,observedScore:90,scoreStatus:'assessed',scoreCoverage:1,metrics:{angleRange:90},checks:[{code:'ROW_ROM',status:'pass',evidenceTimes:[1],evidence:{samples:30}}],issues:[{code:'POSE_GAP',time:2,message:'原始检查证据'}]};
  const base={exerciseId:'row',exerciseFamily:'row',requiresVisualConfirmation:false,status:'complete',score:90,observedScore:90,scoreCoverage:1,scoreStatus:'assessed',qualified:true,qualifiedRepCount:1,quality:{reasons:[]},reps:[rep]};
  const result=mergeCoachAssessment(base,coach);
  assert.equal(result.score,null);
  assert.equal(result.observedScore,null);
  assert.equal(result.scoreStatus,'unavailable');
  assert.equal(result.scoreCoverage,0);
  assert.equal(result.qualified,false);
  assert.equal(result.qualifiedRepCount,0);
  assert.match(result.summary,/动作类别不一致/);
  assert.deepEqual(result.reps,[{...rep,score:null,observedScore:null,scoreStatus:'unavailable',scoreCoverage:0,qualified:false}]);
});

test('equipment confirmation cannot manufacture a complete attempt or clear a prior pose failure', () => {
  const coach=sanitize(output()), exercise=getMotionExercise('bench');
  const base={exerciseId:null,exerciseFamily:'horizontal-press',requiresVisualConfirmation:true,status:'insufficient',score:null,quality:{reasons:['INCOMPLETE_REPETITION']},reps:[]};
  const incomplete=mergeCoachAssessment(base,coach);
  assert.equal(incomplete.exerciseId,'barbell-bench');
  assert.equal(incomplete.score,null);
  assert.equal(incomplete.qualifiedRepCount,0);
  const checks=exercise.checks.map(rule=>({...rule,status:rule.code==='PRESS_TRUNK'?'fail':rule.visual?'unobservable':'pass',severity:rule.code==='PRESS_TRUNK'?'severe':'info',source:'pose',score:rule.code==='PRESS_TRUNK'?0:rule.visual?null:100,scope:rule.visual?'unobservable':'whole-repetition',time:1,evidenceTimes:[1],message:'连续姿态证据'}));
  const merged=mergeCoachAssessment({...base,status:'complete',score:49,checks,quality:{reasons:[]},reps:[{start:0,end:3,score:49,checks}]},coach);
  assert.equal(merged.exerciseId,'barbell-bench');
  assert.equal(merged.checks.find(check=>check.code==='PRESS_TRUNK').status,'fail');
  assert.ok(merged.score<=49);
});

test('assessment merging cannot turn a missing or mismatched equipment observation into an exact action', () => {
  const base={exerciseId:null,exerciseFamily:'horizontal-press',requiresVisualConfirmation:true,status:'insufficient',score:null,quality:{reasons:[]},reps:[]};
  const original=observation(examples[5]);
  for(const overrides of [{observations:undefined},{observations:{...original,equipment:'dumbbell'}},{confidence:'low'},{evidenceTimes:[1,1]},{observations:{...original,evidence:' abc '}}]){
    const coach={mode:'visual',...output(examples[5],overrides)};
    const result=mergeCoachAssessment(base,coach);
    assert.equal(result.exerciseId,null,JSON.stringify(overrides));
    assert.equal(result.requiresVisualConfirmation,true);
    assert.equal(result.score,null);
  }
});
