import test from 'node:test';
import assert from 'node:assert/strict';
import * as contract from '../public/motion-contract.js';
import {getMotionExercise} from '../public/motion-catalog.js';

const frames=[{time:1},{time:2},{time:3}];
const evidence='双手握住固定单杠，身体从悬垂位置上升，脚和膝没有接触助力平台。';
const observations=(assistance='none')=>({equipment:'pullup-bar',support:'hanging',movement:'vertical-pull',laterality:'bilateral',assistance,evidence,evidenceTimes:[1,2]});
const open=(patch={})=>({exerciseId:null,name:'引体向上',family:'vertical-pull',status:'identified',confidence:'high',evidence,evidenceTimes:[1,2],observations:observations(),...patch});
const sanitize=(action,options={})=>contract.sanitizeMotionCoachResponse({action,checks:[],...options.output},{mode:'visual',keyframes:frames,...options});
const base=(family='vertical-pull')=>{
  const checks=getMotionExercise(family==='row'?'row':'pullup').checks.map(rule=>({...rule,status:rule.visual?'unobservable':'pass',severity:'info',score:rule.visual?null:100,source:'pose',scope:rule.visual?'unobservable':'whole-repetition',time:1,evidenceTimes:[1],message:'连续姿态测得的屈肘幅度。'}));
  return {exerciseId:null,exerciseFamily:family,status:'complete',requiresVisualConfirmation:true,score:69,quality:{reasons:[]},checks,reps:[{start:0,end:3,score:69,checks,qualified:false}],attemptCount:1,qualifiedRepCount:0,issues:[]};
};

test('normal pull-ups outside the teaching catalogue keep their independent visual name',()=>{
  const coach=sanitize(open());
  assert.equal(coach.action.status,'identified');
  assert.equal(coach.action.exerciseId,null);
  assert.equal(coach.action.name,'引体向上');
  assert.equal(coach.action.family,'vertical-pull');
  assert.equal(coach.action.evidence,evidence);
  assert.deepEqual(coach.action.observations,observations());
  assert.equal(typeof contract.confirmedMotionAction,'function');
  assert.deepEqual(contract.confirmedMotionAction(coach),coach.action);
});

test('an incorrect catalogue ID cannot replace the visually named normal pull-up',()=>{
  const coach=sanitize(open({exerciseId:'pullup'}));
  assert.equal(coach.action.status,'identified');
  assert.equal(coach.action.name,'引体向上');
  assert.equal(coach.action.exerciseId,null);
  const merged=contract.mergeCoachAssessment(base(),coach);
  assert.equal(merged.exerciseName,'引体向上');
  assert.equal(merged.exerciseId,null);
  assert.equal(merged.recognitionSource,'visual');
  assert.equal(merged.requiresVisualConfirmation,false);
  assert.equal(merged.scoreStatus,'provisional');
  assert.equal(merged.qualifiedRepCount,0);
});

test('a supported open action retains family failures and never becomes an exact assessed recipe',()=>{
  const local=base();local.checks.find(check=>check.code==='PULL_SWING').status='fail';local.checks.find(check=>check.code==='PULL_SWING').severity='severe';local.checks.find(check=>check.code==='PULL_SWING').score=0;local.score=49;
  const merged=contract.mergeCoachAssessment(local,sanitize(open()));
  assert.equal(merged.exerciseFamily,'vertical-pull');
  assert.equal(merged.exerciseName,'引体向上');
  assert.equal(merged.exerciseId,null);
  assert.equal(merged.checks.find(check=>check.code==='PULL_SWING').status,'fail');
  assert.ok(merged.score<=49);
  assert.equal(merged.scoreStatus,'provisional');
  assert.equal(merged.reps[0].qualified,false);
});

test('auxiliary pull-ups need positive assistance proof in two actual shared frames',()=>{
  assert.equal(getMotionExercise('pullup').name,'辅助引体向上');
  for(const assistance of ['band','machine','partner']){
    const coach=sanitize(open({name:'辅助引体向上',exerciseId:'pullup',observations:observations(assistance)}));
    assert.equal(coach.action.exerciseId,'pullup',assistance);
    assert.equal(coach.action.status,'identified');
  }
  for(const observed of [undefined,observations('none'),observations('unknown'),{...observations('band'),evidenceTimes:[1]}]){
    const coach=sanitize(open({name:'辅助引体向上',exerciseId:'pullup',observations:observed}));
    assert.equal(coach.action.status,'unknown',JSON.stringify(observed));
    assert.equal(coach.action.exerciseId,null);
  }
});

test('known auxiliary names cannot bypass assistance rules through a null or incorrect ID',()=>{
  for(const exerciseId of [null,'lat-pulldown','invented-action']){
    assert.equal(sanitize(open({name:'辅助引体向上',exerciseId,observations:observations('none')})).action.status,'unknown');
    assert.equal(sanitize(open({name:'辅助引体向上',exerciseId,observations:observations('band')})).action.exerciseId,'pullup');
  }
});

test('specific ordinary or weighted pull-up names abstain if assistance is unseen or contradicts the name',()=>{
  for(const name of ['引体向上','负重引体向上','pull-up','weighted chin-up']){
    for(const observed of [undefined,observations('unknown'),observations('band')])assert.equal(sanitize(open({name,observations:observed})).action.status,'unknown',name);
  }
  const coach=sanitize(open({name:'引体向上（辅助情况待确认）',observations:observations('unknown')}));
  assert.equal(coach.action.status,'identified');
  assert.equal(coach.action.exerciseId,null);
});

test('unknown movement families can identify a name and offer visual checks without borrowing local scores or repetitions',()=>{
  const coach=sanitize(open({name:'波比跳',family:'burpee',observations:undefined,evidence:'关键帧显示从站立转为地面支撑，再回到站立跳跃。'}),{output:{checks:[{code:'MOTION_CONTROL',status:'fail',severity:'warning',time:1,evidenceTimes:[1,2],evidence:'落地关键帧显示明显失去平衡。',correction:'降低速度并稳定落地。'},{code:'SQUAT_DEPTH',status:'pass',time:1,evidenceTimes:[1],evidence:'不能套用深蹲专属幅度。'}]}});
  assert.equal(coach.action.status,'identified');
  assert.equal(coach.action.family,null);
  assert.deepEqual(coach.checks.map(check=>check.code),['MOTION_CONTROL']);
  const merged=contract.mergeCoachAssessment(base(),coach);
  assert.equal(merged.exerciseName,'波比跳');
  assert.equal(merged.exerciseFamily,null);
  assert.equal(merged.exerciseId,null);
  assert.equal(merged.score,null);
  assert.equal(merged.observedScore,null);
  assert.equal(merged.attemptCount,0);
  assert.deepEqual(merged.reps,[]);
  assert.deepEqual(merged.checks.map(check=>check.code),['MOTION_CONTROL']);
});

test('a conflicting open visual family preserves its identity while refusing numerical evaluation',()=>{
  const merged=contract.mergeCoachAssessment(base('row'),sanitize(open()));
  assert.equal(merged.exerciseName,'引体向上');
  assert.equal(merged.exerciseId,null);
  assert.equal(merged.recognitionSource,'visual');
  assert.equal(merged.score,null);
  assert.equal(merged.qualifiedRepCount,0);
  assert.match(merged.summary,/动作类别不一致/);
});

test('hard local quality failures keep a visually verified open name without granting a score',()=>{
  for(const code of ['LOW_TARGET_COVERAGE','TARGET_ID_CHANGED','EXERCISE_HINT_CONFLICT']){
    const merged=contract.mergeCoachAssessment({...base(),quality:{reasons:[code]}},sanitize(open()));
    assert.equal(merged.exerciseName,'引体向上');
    assert.equal(merged.score,null);
    assert.equal(merged.qualifiedRepCount,0);
  }
});

test('open names require high confidence, two actual frames and concrete evidence',()=>{
  const general=open({name:'杠铃早安式',family:'hinge',observations:undefined});
  for(const patch of [{confidence:'medium'},{evidenceTimes:[1]},{evidenceTimes:[1,99]},{evidenceTimes:[1,1]},{evidence:''},{evidence:'abc'},{name:''},{status:'unknown'}])assert.equal(sanitize({...general,...patch}).action.status,'unknown',JSON.stringify(patch));
  for(const options of [{mode:'evidence-only'},{keyframes:[]},{keyframes:[{time:1}]}])assert.equal(sanitize(general,options).action.status,'unknown');
});

test('known names still require apparatus evidence after catalogue-name lookup',()=>{
  assert.equal(sanitize(open({name:'杠铃卧推',family:'horizontal-press',observations:undefined})).action.status,'unknown');
  const observed={equipment:'barbell',support:'flat-bench',movement:'horizontal-press',laterality:'bilateral',evidence:'杠铃自由移动，训练者仰卧平凳，双手同步推起。',evidenceTimes:[1,2]};
  const coach=sanitize(open({name:'杠铃卧推',family:'horizontal-press',exerciseId:'pullup',observations:observed}));
  assert.equal(coach.action.exerciseId,'barbell-bench');
  assert.equal(coach.action.family,'horizontal-press');
  assert.equal(coach.action.name,'杠铃卧推');
});

test('new observation values and action text stay bounded and discard arbitrary nested data',()=>{
  const coach=sanitize(open({name:'\u0000绳索面拉',family:'row',evidence:'\u0000 双手把绳索拉向面部，站姿稳定。 ',observations:{equipment:'rope-cable',support:'standing',movement:'row',laterality:'bilateral',evidence:'双手握绳索手柄，站姿拉向面部。',evidenceTimes:[1.01,2.01,99],raw:Array(100).fill('private')}}));
  assert.equal(coach.action.name,'绳索面拉');
  assert.equal(coach.action.observations.equipment,'rope-cable');
  assert.equal(coach.action.observations.support,'standing');
  assert.equal(coach.action.observations.raw,undefined);
  assert.deepEqual(coach.action.observations.evidenceTimes,[1,2]);
  assert.equal(sanitize(open({name:'X'.repeat(200),observations:undefined})).action.name.length,80);
});

test('confirmed action validation rejects fabricated open confirmations passed directly to merge',()=>{
  for(const patch of [{confidence:'medium'},{evidenceTimes:[1]},{evidence:''},{observations:observations('band')}]){
    const coach={mode:'visual',action:open(patch),checks:[]};
    assert.equal(contract.confirmedMotionAction?.(coach),null);
    assert.equal(contract.mergeCoachAssessment(base(),coach).exerciseName,undefined);
  }
});

test('names and family information survive compaction without introducing a fabricated catalogue ID',()=>{
  const compact=contract.compactMotionAnalysis({exerciseId:null,exerciseName:'绳索面拉',exerciseFamily:'row',recognitionSource:'visual'});
  assert.equal(compact.exerciseName,'绳索面拉');
  assert.equal(compact.exerciseFamily,'row');
  assert.equal(compact.recognitionSource,'visual');
  assert.equal(compact.exerciseId,null);
});

test('unconfirmed open candidates retain names without being presented as visual confirmations',()=>{
  const coach=sanitize(open({confidence:'medium'}));
  assert.equal(coach.action.status,'unknown');
  assert.equal(coach.candidates[0].name,'引体向上');
  assert.equal(coach.candidates[0].exerciseId,null);
  assert.equal(contract.confirmedMotionAction(coach),null);
  assert.equal(contract.confirmedMotionAction({...coach,mode:'evidence-only',action:open()}),null);
});

test('legacy auxiliary IDs without a name still need assistance proof',()=>{
  for(const observed of [undefined,{...observations(),assistance:'none'}]){
    const coach=sanitize({exerciseId:'pullup',status:'identified',confidence:'high',evidenceTimes:[1,2],observations:observed});
    assert.equal(coach.action.status,'unknown');
  }
});

test('open confirmations without complete attempts cannot manufacture counts or numerical scores',()=>{
  const merged=contract.mergeCoachAssessment({...base(),status:'insufficient',score:null,reps:[]},sanitize(open()));
  assert.equal(merged.exerciseName,'引体向上');
  assert.equal(merged.exerciseId,null);
  assert.equal(merged.score,null);
  assert.equal(merged.qualifiedRepCount,0);
});

test('unsupported families have at most three visual checks in both response and merged report',()=>{
  const check={code:'MOTION_CONTROL',status:'uncertain',time:1,evidenceTimes:[1],evidence:'画面仅能观察离散阶段，无法完整确认控制。'};
  const coach=sanitize(open({name:'波比跳',family:null,observations:undefined}),{output:{checks:Array.from({length:7},()=>({...check}))}});
  assert.equal(coach.checks.length,3);
  assert.equal(contract.mergeCoachAssessment(base(),coach).checks.length,3);
});

test('a generic pull-up name still needs hanging bar context and unknown assistance in two shared frames',()=>{
  const name='引体向上（辅助情况待确认）',unknown=observations('unknown');
  for(const observed of [undefined,{...unknown,equipment:'cable'},{...unknown,support:'seated'},{...unknown,movement:'row'},{...unknown,evidenceTimes:[1]},{...unknown,assistance:'band'}]){
    assert.equal(sanitize(open({name,observations:observed})).action.status,'unknown',JSON.stringify(observed));
  }
  assert.equal(sanitize(open({name:'辅助引体向上（辅助情况待确认）',observations:unknown})).action.status,'unknown');
  assert.equal(sanitize(open({name,observations:unknown})).action.status,'identified');
});

test('a known action name and a different supported raw family cannot silently override each other',()=>{
  const observed={equipment:'barbell',support:'flat-bench',movement:'horizontal-press',laterality:'bilateral',evidence:'杠铃自由移动，训练者仰卧平凳，双手同步推起。',evidenceTimes:[1,2]};
  assert.equal(sanitize(open({exerciseId:'barbell-bench',name:'杠铃卧推',family:'row',observations:observed})).action.status,'unknown');
  assert.equal(sanitize(open({name:'绳索面拉',family:'row',observations:{...observed,equipment:'rope-cable'}})).action.status,'unknown');
});

test('visual and local family conflicts retain the proposed name as unconfirmed and prohibit all scoring',()=>{
  const observed={equipment:'barbell',support:'flat-bench',movement:'horizontal-press',laterality:'bilateral',evidence:'杠铃自由移动，训练者仰卧平凳，双手同步推起。',evidenceTimes:[1,2]};
  const coach=sanitize(open({exerciseId:'barbell-bench',name:'杠铃卧推',family:'horizontal-press',observations:observed}));
  for(const [assessed,originalAnalysis] of [[base('row'),undefined],[{...base('row'),exerciseFamily:null,quality:{reasons:['EXERCISE_HINT_CONFLICT']}},base('row')]]){
    const merged=contract.mergeCoachAssessment(assessed,coach,{originalAnalysis});
    assert.equal(merged.exerciseName,'杠铃卧推');
    assert.equal(merged.recognitionConflict,true);
    assert.equal(merged.requiresVisualConfirmation,true);
    assert.equal(merged.exerciseId,null);
    assert.equal(merged.score,null);
    assert.equal(merged.qualifiedRepCount,0);
    assert.ok(merged.reps.every(rep=>rep.score===null&&rep.qualified===false));
  }
});

test('an unknown visual family has no numerical recipe but is not a contradiction with a local family',()=>{
  const merged=contract.mergeCoachAssessment(base('row'),sanitize(open({name:'双杠臂屈伸',family:null,observations:undefined})));
  assert.equal(merged.exerciseName,'双杠臂屈伸');
  assert.equal(merged.recognitionConflict,false);
  assert.equal(merged.requiresVisualConfirmation,false);
  assert.equal(merged.score,null);
  assert.deepEqual(merged.reps,[]);
});

test('open bench and row aliases cannot evade apparatus and support evidence rules',()=>{
  for(const [name,family] of [['杠铃平板卧推','horizontal-press'],['坦克机划船','row'],['barbell flat bench press','horizontal-press'],['incline rows','row'],['卧推',null],['划船',null]]){
    assert.equal(sanitize(open({name,family,observations:undefined})).action.status,'unknown',name);
    assert.equal(sanitize(open({name,family,observations:{equipment:'unknown',support:null,movement:family,laterality:'bilateral',evidence:'两帧有相同动作，肘部运动可见。',evidenceTimes:[1,2]}})).action.status,'unknown',name);
  }
});

test('open presses and rows accept new apparatus or support values when consistent visual evidence is supplied',()=>{
  for(const [name,family,equipment,support] of [['哑铃地板卧推','horizontal-press','dumbbell','floor'],['倒立划船','row','pullup-bar','supine-hanging']]){
    const observed={equipment,support,movement:family,laterality:'bilateral',evidence:'清楚可见目标与器械接触、支撑方式和推拉轨迹。',evidenceTimes:[1,2]};
    const coach=sanitize(open({name,family,observations:observed}));
    assert.equal(coach.action.status,'identified',name);
    assert.equal(coach.action.exerciseId,null);
    for(const patch of [{movement:family==='row'?'horizontal-press':'row'},{laterality:null},{evidenceTimes:[1]}])assert.equal(sanitize(open({name,family,observations:{...observed,...patch}})).action.status,'unknown',name);
  }
});
