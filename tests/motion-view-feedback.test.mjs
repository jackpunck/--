import test from 'node:test';
import assert from 'node:assert/strict';
import {motionVerdict, motionFeedback, motionCoachProgress, motionSelectionNotice, buildMotionAssessmentReport} from '../public/motion-view.js';

const finding=(status,extra={})=>({status,source:'combined',title:'肩髋同步',evidence:'起身时肩部先于髋部移动。',correction:'收紧腹部，让肩髋一起起身。',evidenceTimes:[1.2],...extra});

test('local results remain pending regardless of old local scores and checks',()=>{
  const report={score:100,checks:[{status:'pass'}],reps:[{score:100}]};
  assert.equal(motionVerdict(report).status,'pending');
  assert.match(motionVerdict(report).label,/尚未评价/);
  assert.deepEqual(motionFeedback(report),[]);
});

test('corrective UI prioritizes actual problems and excludes distracting praise',()=>{
  const coach={coverage:{complete:true},verdict:{status:'needs-improvement',summary:'起身需要调整。'},feedback:[finding('good',{title:'手肘位置'}),finding('improve')]};
  assert.equal(motionVerdict({coach}).status,'needs-improvement');
  assert.deepEqual(motionFeedback({coach}).map(item=>item.title),['肩髋同步']);
});

test('standard verdict displays only maintenance suggestions',()=>{
  const coach={action:{status:'identified',name:'俯卧撑'},coverage:{complete:true},verdict:{status:'standard',summary:'已看到的动作基本标准。'},feedback:[finding('good',{evidence:'肩髋保持同步，动作节奏稳定。'})]};
  assert.equal(motionVerdict({coach}).status,'standard');
  assert.equal(motionFeedback({coach})[0].status,'good');
});

test('uncertain identity retains visible corrections without claiming standard',()=>{
  const report={recognitionConflict:true,coach:{coverage:{complete:true},verdict:{status:'standard'},feedback:[finding('improve'),finding('uncertain',{title:'器械不清楚'})]}};
  assert.equal(motionVerdict(report).status,'uncertain');
  assert.deepEqual(motionFeedback(report).map(item=>item.status),['improve','uncertain']);
});

test('long feedback reports show at most three corrections ahead of uncertain details',()=>{
  const report={recognitionConflict:true,coach:{feedback:[
    finding('uncertain',{title:'器械不清楚'}),
    finding('improve',{title:'保持肩髋同步'}),
    finding('good',{title:'手肘位置保持稳定'}),
    finding('uncertain',{title:'脚部被遮挡'}),
    finding('improve',{title:'减少躯干摆动'}),
    finding('improve',{title:'控制下降节奏'}),
    finding('improve',{title:'保持动作幅度'}),
  ]}};
  assert.equal(motionVerdict(report).status,'uncertain');
  assert.deepEqual(motionFeedback(report).map(item=>item.title),['保持肩髋同步','减少躯干摆动','控制下降节奏']);
  assert.equal(report.coach.feedback.length,7,'The saved evidence remains intact');
});

test('legacy AI corrections are readable but local checks never become AI advice',()=>{
  const check={status:'fail',source:'visual',label:'髋部下沉',message:'画面中髋部低于身体连线。',correction:'收紧腹部，保持肩髋踝连线。',time:2};
  const legacy={coach:{checks:[check]}};
  assert.equal(motionVerdict(legacy).status,'needs-improvement');
  assert.deepEqual(motionFeedback(legacy)[0],{status:'improve',title:check.label,evidence:check.message,correction:check.correction,evidenceTimes:[2]});
  assert.deepEqual(motionFeedback({coach:{checks:[{...check,source:'pose'}]}}),[]);
  assert.deepEqual(motionFeedback({coach:{checks:[check],feedback:[]}}),[]);
});

test('stream progress exposes meaningful phases and elapsed time',()=>{
  assert.match(motionCoachProgress({stage:'processing',completed:2,total:5,elapsedMs:12500}),/2 \/ 5.*12 秒/);
  assert.match(motionCoachProgress({stage:'synthesis'}),/汇总/);
  assert.match(motionCoachProgress({stage:'retry'}),/重试/);
  assert.match(motionCoachProgress({stage:'heartbeat',elapsedMs:60000}),/60 秒/);
  assert.equal(motionCoachProgress({message:'正在核对最后一段。'}),'正在核对最后一段。');
});

test('new saved reports retain AI advice and exclude all local judgments and raw observations',()=>{
 const feedback=finding('improve');
 const source={score:100,checks:[{status:'pass'}],reps:[{score:100}],measurements:[{frameIndex:0}],poseData:{frames:[1]},quality:{totalFrames:1,validFrames:1,usableRatio:1,sourceFps:30,targetCoverage:null,reasons:[],score:99},exerciseId:'pushup',coach:{score:99,checks:[{status:'pass'}],verdict:{status:'needs-improvement',summary:'需要调整。',score:22},feedback:[{...feedback,score:3,checks:[]}],coverage:{complete:true,frameCount:1,reviewedFrameCount:1,measurementCount:1,repetitionCount:4}}};
 const report=buildMotionAssessmentReport(source,{file:{name:'clip.mp4',size:100},pipeline:{width:100,height:100,duration:2,sampleFps:15,sourceFps:30}});
 assert.equal(report.version,'motion-report-v1');assert.deepEqual(report.coach.feedback,[feedback]);
 assert.deepEqual(report.coach.verdict,{status:'needs-improvement',summary:'需要调整。'});
 assert.equal(report.coach.coverage.measurementCount,1);
 assert(!/"(?:score|checks|reps|measurements|poseData|repetitionCount)":/.test(JSON.stringify(report)));
 report.coach.feedback[0].evidenceTimes[0]=1.5;assert.equal(source.coach.feedback[0].evidenceTimes[0],1.2);
});

test('guided reports preserve user selection and its visual check without raw data',()=>{
 const action={exerciseId:'barbell-deadlift',name:'杠铃硬拉',family:'hinge',status:'selected',confidence:null,source:'user',secret:'omit'};
 const selectionCheck={status:'mismatch',evidenceTimes:[.5],evidence:'画面中训练者躺在长凳上。',rawFrames:[1],confidence:'high'};
 const report=buildMotionAssessmentReport({exerciseId:action.exerciseId,exerciseName:action.name,recognitionSource:'user',coach:{mode:'guided',action,selectionCheck}},{file:{name:'clip.mp4',size:20},pipeline:{width:100,height:100,duration:1}});
 assert.equal(report.recognitionSource,'user');assert.equal(report.coach.mode,'guided');
 assert.deepEqual(report.coach.action,{exerciseId:action.exerciseId,name:action.name,family:'hinge',status:'selected',confidence:null,source:'user'});
 assert.deepEqual(report.coach.selectionCheck,{status:'mismatch',evidenceTimes:[.5],evidence:selectionCheck.evidence});
 report.coach.selectionCheck.evidenceTimes.push(.7);assert.deepEqual(selectionCheck.evidenceTimes,[.5]);
});

test('mismatched guided action keeps the selected name and asks for correction',()=>{
 const report={recognitionSource:'user',exerciseId:'barbell-deadlift',recognitionConflict:true,coach:{action:{source:'user',exerciseId:'barbell-deadlift'},selectionCheck:{status:'mismatch',evidenceTimes:[1,-1,NaN],evidence:'画面中可见推胸动作。'}}};
 const notice=motionSelectionNotice(report);
 assert.equal(notice.name,'杠铃硬拉');assert.equal(notice.status,'mismatch');assert.match(notice.message,/核对动作类型/);assert.deepEqual(notice.evidenceTimes,[1]);
 assert.equal(motionSelectionNotice({recognitionSource:'visual',coach:{action:{status:'identified'}}}),null);
 assert.equal(motionSelectionNotice({...report,coach:{action:{source:'user'}}}).status,'uncertain');
});

test('guided mismatch or unknown selection never presents corrections for that exercise',()=>{
 for(const status of ['mismatch','uncertain',undefined]) {
  const report={coach:{mode:'guided',selectionCheck:{status},feedback:[finding('good'),finding('improve'),finding('uncertain',{title:'器械被遮挡'})]}};
  assert.deepEqual(motionFeedback(report),[],'Even uncertain feedback may contain a correction for the wrong exercise');
 }
 const report={coach:{mode:'guided',selectionCheck:{status:'consistent'},coverage:{complete:true},verdict:{status:'needs-improvement',summary:'需要控制动作。'},feedback:[finding('improve')]}};
 assert.equal(motionFeedback(report)[0].status,'improve');
});
