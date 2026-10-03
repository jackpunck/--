import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMotion} from '../public/motion-analysis.js';
import {motionExercises, motionCheckCodes, motionFamilies, getMotionExercise} from '../public/motion-catalog.js';

// Kinematic fixtures assert geometry, temporal boundaries and abstention. They
// are deliberately not labelled real people or an accuracy benchmark.
function clip(kind, {cycles = 2, fps = 15, amplitude = 1, shrug = 0, headMove = 0, hideHead = false, mirror = false, phaseOffset = 0} = {}) {
  const frames = [], duration = cycles * 4;
  for (let n = 0; n <= duration * fps; n++) {
    const time = n / fps, p = (1 - Math.cos(((time + phaseOffset) % 4) * Math.PI / 2)) / 2 * amplitude;
    let s = [350, 230], h = [350, 450], k = [350, 625], a = [350, 800], e, w, ear = [350, 170];
    let armElevation = 10, elbowAngle = 170;
    if (kind === 'curl') elbowAngle = 170 - 110 * p;
    if (kind === 'drifting-curl') {elbowAngle = 175 - 95 * p; armElevation = 30 * p;}
    if (kind === 'overhead') { armElevation = 95 + 65 * p; elbowAngle = 70 + 100 * p; }
    if (kind === 'overhead-extension') {armElevation = 165; elbowAngle = 175 - 95 * p;}
    if (kind === 'lateral') {armElevation = 5 + 85 * p; elbowAngle = 175;}
    if (kind === 'reverse') {h = [350, 450]; s = [540, 350]; ear = [590, 320]; armElevation = 15 + 80 * p; elbowAngle = 175;}
    if (kind === 'horizontal') {s=[350,500];h=[570,500];k=[700,550];a=[800,700];ear=[300,500];armElevation=40+45*p;elbowAngle=65+105*p;}
    if (kind === 'row') {
      s = [350, 230 - shrug * p]; h = [350, 450]; k = [530, 450]; a = [530, 650];
      e = [485 - 165 * p, 325 - shrug * p]; w = [620 - 245 * p, 350 - shrug * p];
      ear = [350, 170 + headMove * p];
    }
    if (kind === 'knee') {k = [530, 450];a = [530 + 160 * Math.sin(p * 1.5), 450 + 160 * Math.cos(p * 1.5)];}
    if (kind === 'hinge') {s = [350 + 220 * Math.sin(p * 1.15), 450 - 220 * Math.cos(p * 1.15)]; h = [350 - 30*p,450+20*p]; ear = [s[0],s[1]-60];}
    if (kind === 'plank') {s=[300,400];h=[500,440];k=[650,470];a=[800,500];e=[310,520];w=[400,530];ear=[255,380];}
    if (kind === 'bridge' || kind === 'crunch') {
      s=[250,600-(kind==='crunch'?100*p:0)];h=[450,620-(kind==='bridge'?125*p:0)];k=[560,490];a=[650,650];ear=[210,s[1]-15];
    }
    if (kind === 'lunge') {const radians=0.8*p; a=[350,800];k=[350+175*Math.sin(radians),800-175*Math.cos(radians)];h=[350,800-350*Math.cos(radians)];s=[350,h[1]-220];ear=[350,s[1]-60];}
    if (kind === 'calf') {s[1]-=35*p;h[1]-=35*p;k[1]-=35*p;a[1]-=35*p;ear[1]-=35*p;}
    if (!e) {
      const torsoDirection = Math.atan2(h[0]-s[0],h[1]-s[1]);
      const theta = torsoDirection + armElevation*Math.PI/180;
      e=[s[0]+110*Math.sin(theta),s[1]+110*Math.cos(theta)];
      const theta2=theta+(180-elbowAngle)*Math.PI/180;
      w=[e[0]+110*Math.sin(theta2),e[1]+110*Math.cos(theta2)];
    }
    const landmarks=Array(33).fill(null);
    const point=(p,shift=0)=>({x:(mirror?1000-p[0]-shift:p[0]+shift)/1000,y:p[1]/1000,visibility:0.99,presence:null});
    [s,e,w,h,k,a].forEach((joint,i)=>{const index=[11,13,15,23,25,27][i];landmarks[index]=point(joint,-3);landmarks[index+1]=point(joint,3);});
    if (kind === 'lunge') {landmarks[26]=point([535,665]);landmarks[28]=point([560,800]);}
    if (!hideHead) {landmarks[7]=point(ear,-3);landmarks[8]=point(ear,3);}
    for(const side of [0,1]) {landmarks[29+side]=point([a[0]-15,a[1]+10]);landmarks[31+side]=point([a[0]+65,810]);}
    frames.push({time,landmarks});
  }
  return {frames, options:{width:1000,height:1000,duration}};
}
const run=(kind, options={}, hint)=>{const c=clip(kind,options);return analyzeMotion(c.frames,{...c.options,exerciseHint:hint});};
const check=(r,code)=>r.checks.find(c=>c.code===code);

test('catalogue preserves 25 teaching IDs and includes 32 assessment IDs with 17 families',()=>{
  assert.equal(motionExercises.length,32);assert.equal(Object.keys(motionFamilies).length,17);
  assert.equal(new Set(motionExercises.map(x=>x.id)).size,32);
  assert.equal(motionExercises.filter(e=>e.hasTeaching).length,25);
  for(const e of motionExercises){assert.equal(e.checks.reduce((s,c)=>s+c.weight,0),100);assert.ok(e.checks.every(c=>motionCheckCodes.includes(c.code)));}
  assert.ok(!getMotionExercise('lateral-raise').requiredChecks.includes('UPPER_ARM_STABILITY'));
});

test('curl variants remain candidates and a compatible visual hint selects the recipe',()=>{
  const r=run('curl');assert.equal(r.exerciseFamily,'elbow-isolation');assert.equal(r.exerciseId,null);assert.equal(r.attemptCount,2);
  assert.deepEqual(new Set(r.candidates.map(c=>c.exerciseId)),new Set(['curl','triceps','hammer-curl']));
  const hinted=run('curl',{},'hammer-curl');assert.equal(hinted.exerciseId,'hammer-curl');assert.equal(hinted.attemptCount,2);
  assert.equal(hinted.scoreStatus,'provisional');assert.equal(hinted.qualifiedRepCount,0);assert.equal(check(hinted,'SPINE_NEUTRAL').status,'unobservable');
});

test('overhead push and pull remain ambiguous without equipment evidence',()=>{
  const r=run('overhead');assert.equal(r.exerciseFamily,'ambiguous');assert.equal(r.score,null);
  assert.ok(r.candidates.some(c=>c.exerciseId==='shoulder-press'));assert.ok(r.candidates.some(c=>c.exerciseId==='lat-pulldown'));
  const confirmed=run('overhead',{},'shoulder-press');assert.equal(confirmed.exerciseFamily,'overhead-press');assert.equal(confirmed.attemptCount,2);
});

test('an incompatible visual hint cannot relabel a clearly observed movement',()=>{
  const r=run('curl',{},'squat');assert.equal(r.score,null);assert.ok(r.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
});

test('a compatible family hint resolves push-pull ambiguity without borrowing a catalogue identity',()=>{
  for(const family of ['vertical-pull','overhead-press']){
    // Pulling starts with extended elbows; pressing starts with flexed elbows.
    const r=run('overhead',{phaseOffset:family==='vertical-pull'?2:0}, {family});
    assert.equal(r.exerciseFamily,family);assert.equal(r.exerciseId,null);
    assert.equal(r.attemptCount,2);assert.equal(r.classificationSource,'visual-hint+pose');
    assert.equal(r.requiresVisualConfirmation,true);assert.equal(r.scoreStatus,'provisional');
    assert.equal(r.qualifiedRepCount,0);assert.ok(r.reps.every(rep=>rep.qualified===false));
  }
  const r=run('row',{}, {family:'row'});
  assert.equal(r.exerciseFamily,'row');assert.equal(r.exerciseId,null);assert.equal(r.attemptCount,2);
  assert.equal(r.scoreStatus,'provisional');assert.equal(r.requiresVisualConfirmation,true);
});

test('an incompatible family hint retains the same pose conflict veto as an exact exercise hint',()=>{
  const r=run('curl',{}, {family:'squat'});
  assert.equal(r.exerciseId,null);assert.equal(r.score,null);assert.equal(r.attemptCount,0);
  assert.ok(r.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
});

test('family hints only accept canonical own family names and a known exercise ID takes priority',()=>{
  for(const family of ['invented-family','constructor','__proto__','toString']){
    const r=run('overhead',{}, {family});
    assert.equal(r.exerciseFamily,'ambiguous');assert.equal(r.exerciseId,null);
    assert.equal(r.classificationSource,'pose');assert.equal(r.score,null);
  }
  const exact=run('curl',{}, {exerciseId:'hammer-curl',family:'squat'});
  assert.equal(exact.exerciseId,'hammer-curl');assert.equal(exact.exerciseFamily,'elbow-isolation');
  assert.equal(exact.requiresVisualConfirmation,false);
  const family=run('overhead',{}, {exerciseId:'outside-catalogue',family:'vertical-pull'});
  assert.equal(family.exerciseId,null);assert.equal(family.exerciseFamily,'vertical-pull');
});

test('a family hint cannot erase target coverage or pose gap scoring restrictions',()=>{
  const c=clip('overhead');
  const frames=c.frames.map((frame,i)=>({...frame,subjectTracking:{status:i<30?'locked':'lost',trackId:'subject-1',confidence:i<30?0.99:0.1}}));
  const r=analyzeMotion(frames,{...c.options,exerciseHint:{family:'vertical-pull'}});
  assert.equal(r.exerciseId,null);assert.equal(r.score,null);assert.equal(r.qualifiedRepCount,0);
  assert.ok(r.quality.reasons.includes('LOW_TARGET_COVERAGE'));
});

test('row shoulder elevation is a temporal measured failure distinct from unknown spinal shape',()=>{
  const neutral=run('row',{},'row'), bad=run('row',{shrug:50},'row');
  assert.equal(neutral.attemptCount,2,JSON.stringify(neutral));assert.equal(bad.attemptCount,2);
  assert.equal(check(neutral,'ROW_SHRUG').status,'pass');
  const shrug=check(bad,'ROW_SHRUG');assert.equal(shrug.status,'fail');assert.equal(shrug.severity,'severe');
  assert.ok(shrug.evidence.value>0.14);assert.ok(shrug.evidence.duration>=0.2);assert.ok(shrug.time>0);
  assert.equal(check(bad,'SPINE_NEUTRAL').status,'unobservable');assert.ok(bad.score<=49);
  assert.equal(check(run('row',{shrug:50,mirror:true},'row'),'ROW_SHRUG').status,'fail');
});

test('a cropped seated row retains continuous pull evidence without inventing visible legs',()=>{
  for(const mirror of [false,true]){
    const c=clip('row',{mirror});
    for(const frame of c.frames)for(const index of [25,26,27,28,29,30,31,32])frame.landmarks[index]=null;
    const r=analyzeMotion(c.frames,{...c.options,exerciseHint:'row'});
    assert.equal(r.exerciseFamily,'row',JSON.stringify(r));assert.equal(r.exerciseId,'row');assert.equal(r.attemptCount,2);
    assert.ok(!r.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
  }
});

test('cropping a curl with forward upper-arm drift does not turn elbow flexion into a row',()=>{
  for(const mirror of [false,true])for(const cropped of [false,true]){
    const c=clip('drifting-curl',{mirror});
    if(cropped)for(const frame of c.frames)for(const index of [25,26,27,28,29,30,31,32])frame.landmarks[index]=null;
    const base=analyzeMotion(c.frames,c.options),hinted=analyzeMotion(c.frames,{...c.options,exerciseHint:'curl'});
    assert.equal(base.exerciseFamily,'elbow-isolation',JSON.stringify({mirror,cropped,...base}));
    assert.equal(hinted.exerciseId,'curl');assert.equal(hinted.attemptCount,2);
    assert.ok(!hinted.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
    const wrong=analyzeMotion(c.frames,{...c.options,exerciseHint:'row'});
    assert.equal(wrong.attemptCount,0);assert.ok(wrong.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
  }
});

test('cropping legs does not turn a lateral raise into a hinted row or bypass missing hips',()=>{
  const c=clip('lateral');
  for(const frame of c.frames)for(const index of [25,26,27,28,29,30,31,32])frame.landmarks[index]=null;
  const r=analyzeMotion(c.frames,{...c.options,exerciseHint:'row'});
  assert.equal(r.attemptCount,0);assert.ok(r.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
  const row=clip('row');
  for(const frame of row.frames)for(const index of [23,24])frame.landmarks[index]=null;
  const hidden=analyzeMotion(row.frames,{...row.options,exerciseHint:'row'});
  assert.equal(hidden.attemptCount,0);assert.ok(hidden.quality.reasons.includes('LOW_POSE_COVERAGE'));
});

function singleArmRow({activeSide=0,hiddenStart=Infinity,hiddenEnd=-Infinity,mirror=false}={}) {
  const c=clip('row',{mirror}),moving=[11+activeSide,13+activeSide,15+activeSide,23+activeSide,25+activeSide,27+activeSide];
  for(const frame of c.frames){
    for(const index of moving)frame.landmarks[index].visibility=0.95;
    for(const index of [13+(1-activeSide),15+(1-activeSide)])frame.landmarks[index]={...c.frames[0].landmarks[index]};
    if(frame.time>hiddenStart&&frame.time<hiddenEnd)for(const index of [13+activeSide,15+activeSide])frame.landmarks[index].visibility=0.2;
  }
  return c;
}

test('a visible active row arm is selected over a slightly clearer stationary support arm',()=>{
  for(const activeSide of [0,1])for(const mirror of [false,true]){
    const c=singleArmRow({activeSide,mirror}),r=analyzeMotion(c.frames,{...c.options,exerciseHint:'dumbbell-row'});
    assert.equal(r.exerciseId,'dumbbell-row');assert.equal(r.attemptCount,2,JSON.stringify({activeSide,mirror,...r}));
  }
});

test('an open row family hint selects the active arm and preserves gaps without naming a dumbbell exercise',()=>{
  for(const activeSide of [0,1])for(const mirror of [false,true]){
    const c=singleArmRow({activeSide,mirror}),r=analyzeMotion(c.frames,{...c.options,exerciseHint:{family:'row'}});
    assert.equal(r.exerciseId,null);assert.equal(r.exerciseFamily,'row');
    assert.equal(r.attemptCount,2,JSON.stringify({activeSide,mirror,...r}));
    assert.equal(r.classificationSource,'visual-hint+pose');assert.equal(r.qualifiedRepCount,0);
  }
  const c=singleArmRow({hiddenStart:1.4,hiddenEnd:2.6}),r=analyzeMotion(c.frames,{...c.options,exerciseHint:{family:'row'}});
  assert.equal(r.exerciseId,null);assert.equal(r.attemptCount,1,JSON.stringify(r));
  assert.ok(r.reps.every(rep=>!(rep.start<1.4&&rep.end>2.6)));
  const hidden=singleArmRow({hiddenStart:-1,hiddenEnd:9}),missing=analyzeMotion(hidden.frames,{...hidden.options,exerciseHint:{family:'row'}});
  assert.equal(missing.attemptCount,0);assert.equal(missing.score,null);
});

test('a more confident support side without a visible hip cannot block the observable row side',()=>{
  const c=singleArmRow();
  for(const frame of c.frames){
    for(const index of [11,13,15,23,25,27])frame.landmarks[index].visibility=0.75;
    frame.landmarks[24]=null;
  }
  const base=analyzeMotion(c.frames,c.options),hinted=analyzeMotion(c.frames,{...c.options,exerciseHint:'dumbbell-row'});
  assert.ok(!base.quality.reasons.includes('LOW_POSE_COVERAGE'),JSON.stringify(base));assert.equal(base.attemptCount,2);
  assert.equal(hinted.exerciseId,'dumbbell-row');assert.equal(hinted.attemptCount,2);
  assert.equal(base.quality.usableRatio,1);assert.equal(hinted.quality.usableRatio,1);
});

test('an invisible active arm cannot borrow the support arm or join repetitions across a gap',()=>{
  const hidden=singleArmRow({hiddenStart:-1,hiddenEnd:9}),missing=analyzeMotion(hidden.frames,{...hidden.options,exerciseHint:'dumbbell-row'});
  assert.equal(missing.attemptCount,0);
  const c=singleArmRow({hiddenStart:1.4,hiddenEnd:2.6}),r=analyzeMotion(c.frames,{...c.options,exerciseHint:'dumbbell-row'});
  assert.equal(r.attemptCount,1,JSON.stringify(r));assert.ok(r.reps.every(rep=>!(rep.start<1.4&&rep.end>2.6)));
});

test('head movement and hidden head abstain from shrug judgement rather than awarding pass',()=>{
  for(const options of [{headMove:70},{hideHead:true}]){
    const r=run('row',options,'row');assert.equal(check(r,'ROW_SHRUG').status,'unobservable');assert.equal(r.qualifiedRepCount,0);assert.ok(r.score<=69);
  }
});

test('small complete elbow movements still count as attempts and fail range rather than becoming unknown',()=>{
  const r=run('curl',{amplitude:0.3},'curl');assert.equal(r.attemptCount,2);assert.equal(check(r,'ARM_ROM').status,'fail');assert.ok(r.score<80);
});

test('lateral raises do not fail merely because the upper arm moves as intended',()=>{
  const r=run('lateral',{},'lateral-raise');assert.equal(r.attemptCount,2,JSON.stringify(r));
  assert.equal(check(r,'RAISE_HEIGHT').status,'pass');assert.equal(check(r,'PRESS_TRUNK').status,'pass');
  assert.ok(!check(r,'UPPER_ARM_STABILITY'));
  assert.equal(check(r,'RAISE_SHRUG').status,'unobservable');
  assert.equal(check(r,'RAISE_SHRUG').score,null);
});

test('knee isolation, hinge, overhead extension and forearm plank have distinct recipes',()=>{
  for(const [kind,id,family] of [['knee','leg-extension','knee-isolation'],['hinge','rdl','hinge'],['overhead-extension','overhead-triceps','overhead-extension'],['plank','plank','plank']]){
    const r=run(kind,{},id);assert.equal(r.exerciseFamily,family,JSON.stringify({kind,...r}));assert.ok(r.attemptCount>=1,JSON.stringify(r));assert.equal(r.scoreStatus,'provisional');
  }
});

test('calf measurements use distance ratios and do not label a heel displacement as degrees',()=>{
  const r=run('calf',{},'calf-raise');assert.equal(r.attemptCount,2,JSON.stringify(r));
  assert.ok(r.reps[0].metrics.heelLiftRange>0);assert.equal(r.reps[0].metrics.bottomAngle,undefined);
});

test('tracked multi-person frames are accepted only for one continuous reliable identity',()=>{
  const c=clip('curl');const tracked=c.frames.map(f=>({...f,personCount:3,subjectTracking:{status:'locked',trackId:'subject-1',confidence:0.9}}));
  assert.equal(analyzeMotion(tracked,c.options).attemptCount,2);
  const changed=tracked.map(f=>({...f,subjectTracking:{...f.subjectTracking,trackId:f.time>4?'subject-2':'subject-1'}}));
  assert.ok(analyzeMotion(changed,c.options).quality.reasons.includes('TARGET_ID_CHANGED'));
  const lost=tracked.map(f=>f.time>1.4&&f.time<2.6?{...f,subjectTracking:{status:'lost',trackId:'subject-1',confidence:0}}:f);
  const r=analyzeMotion(lost,c.options);assert.ok(r.reps.every(rep=>!(rep.start<1.4&&rep.end>2.6)));assert.equal(r.attemptCount,1);
  const allLost=tracked.map(f=>({...f,subjectTracking:{status:'ambiguous',trackId:'subject-1',confidence:0.2}}));assert.equal(analyzeMotion(allLost,c.options).score,null);
});


test('horizontal press, reverse fly, bridge and crunch retain their movement families',()=>{
  for(const [kind,id,family] of [['horizontal','bench','horizontal-press'],['reverse','reverse-fly','reverse-fly'],['bridge','glute-bridge','bridge'],['crunch','crunch','crunch']]){
    const r=run(kind,{},id);assert.equal(r.exerciseFamily,family,JSON.stringify({kind,...r}));assert.ok(r.attemptCount>=1,JSON.stringify(r));
    assert.ok(r.score===null||r.score<100);assert.equal(r.qualifiedRepCount,0);
  }
});

function rotatedHorizontalClip(degrees,{hideLegs=false,mirror=false}={}) {
  const c=clip('horizontal'),radians=degrees*Math.PI/180;
  c.frames=c.frames.map(frame=>({...frame,landmarks:frame.landmarks.map((point,index)=>{
    if(!point||hideLegs&&[25,26,27,28,29,30,31,32].includes(index))return null;
    const x=point.x-0.5,y=point.y-0.5;
    const projectedX=0.5+x*Math.cos(radians)-y*Math.sin(radians);
    return {...point,x:mirror?1-projectedX:projectedX,y:0.5+x*Math.sin(radians)+y*Math.cos(radians)};
  })}));
  return c;
}

test('rotated lying press projections stay ambiguous with row rather than rejecting a supported press hint',()=>{
  for(const [degrees,hideLegs] of [[180,true],[-150,false]])for(const mirror of [false,true]){
    const c=rotatedHorizontalClip(degrees,{hideLegs,mirror}),base=analyzeMotion(c.frames,c.options);
    assert.equal(base.exerciseFamily,'ambiguous',JSON.stringify({degrees,hideLegs,mirror,family:base.exerciseFamily,reasons:base.quality.reasons}));
    assert.equal(base.score,null);assert.equal(base.exerciseId,null);
    assert.ok(base.candidates.some(candidate=>candidate.exerciseId==='bench'));
    assert.ok(base.candidates.some(candidate=>candidate.exerciseId==='row'));
    const hinted=analyzeMotion(c.frames,{...c.options,exerciseHint:'bench'});
    assert.equal(hinted.exerciseId,'bench');assert.equal(hinted.exerciseFamily,'horizontal-press');
    assert.equal(hinted.attemptCount,2);assert.ok(!hinted.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
    const family=analyzeMotion(c.frames,{...c.options,exerciseHint:{family:'horizontal-press'}});
    assert.equal(family.exerciseId,null);assert.equal(family.exerciseFamily,'horizontal-press');
    assert.equal(family.attemptCount,2);assert.equal(family.scoreStatus,'provisional');
  }
});

test('upright row and curl evidence cannot borrow the lying press projection exception',()=>{
  for(const kind of ['row','curl'])for(const hideLegs of [false,true]){
    const c=clip(kind);
    if(hideLegs)for(const frame of c.frames)for(const index of [25,26,27,28,29,30,31,32])frame.landmarks[index]=null;
    const base=analyzeMotion(c.frames,c.options),hinted=analyzeMotion(c.frames,{...c.options,exerciseHint:'bench'});
    assert.equal(base.exerciseFamily,kind==='row'?'row':'elbow-isolation');
    assert.ok(!base.candidates.some(candidate=>candidate.exerciseId==='bench'));
    assert.equal(hinted.score,null);assert.ok(hinted.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
  }
  // A visible folded hip and standing legs still provide a pulling stance even
  // when the torso is horizontal. This is geometry, not labelled video data.
  const bent=clip('row');
  for(const frame of bent.frames){
    for(const index of [7,8,11,12,13,14,15,16])frame.landmarks[index]={...frame.landmarks[index],x:frame.landmarks[index].x+0.22,y:frame.landmarks[index].y+0.22};
    for(const side of [0,1]){
      frame.landmarks[25+side]={...frame.landmarks[25+side],x:0.35+(side?0.003:-0.003),y:0.625};
      frame.landmarks[27+side]={...frame.landmarks[27+side],x:0.35+(side?0.003:-0.003),y:0.8};
    }
  }
  const base=analyzeMotion(bent.frames,bent.options),hinted=analyzeMotion(bent.frames,{...bent.options,exerciseHint:'bench'});
  assert.equal(base.exerciseFamily,'row');assert.equal(base.attemptCount,2);
  assert.ok(!base.candidates.some(candidate=>candidate.exerciseId==='bench'));
  assert.equal(hinted.score,null);assert.ok(hinted.quality.reasons.includes('EXERCISE_HINT_CONFLICT'));
});

test('horizontal presses count each complete cycle from either extended or flexed starting position',()=>{
  for(const id of ['bench','incline-bench','chest-press'])for(const phaseOffset of [0,2])for(const cycles of [1,2]){
    const r=run('horizontal',{phaseOffset,cycles},id);
    assert.equal(r.attemptCount,cycles,JSON.stringify({id,phaseOffset,cycles,...r}));
    assert.ok(r.reps.every(rep=>rep.start<rep.bottom&&rep.bottom<rep.end));
    assert.ok(r.reps.every((rep,index)=>!index||rep.start>=r.reps[index-1].end));
  }
});

test('horizontal press half cycles and hidden phases never become complete repetitions',()=>{
  for(const phaseOffset of [0,2]){
    const c=clip('horizontal',{cycles:1,phaseOffset}),half=c.frames.filter(frame=>frame.time<=2);
    assert.equal(analyzeMotion(half,{...c.options,duration:2,exerciseHint:'bench'}).attemptCount,0);
    const gapped=clip('horizontal',{phaseOffset});
    for(const frame of gapped.frames.filter(frame=>frame.time>1.4&&frame.time<2.6))for(const index of [13,14,15,16])frame.landmarks[index]=null;
    const r=analyzeMotion(gapped.frames,{...gapped.options,exerciseHint:'bench'});
    assert.equal(r.attemptCount,1,JSON.stringify({phaseOffset,...r}));assert.ok(r.reps.every(rep=>!(rep.start<1.4&&rep.end>2.6)));
  }
  assert.equal(run('horizontal',{phaseOffset:1},'bench').attemptCount,1);
});


test('all 32 assessment IDs have a reachable synthetic compatible-hint recipe with complete attempts',()=>{
  const familyKinds={'elbow-isolation':'curl','horizontal-press':'horizontal','vertical-pull':'overhead',row:'row','overhead-press':'overhead','lateral-raise':'lateral','reverse-fly':'reverse','overhead-extension':'overhead-extension',hinge:'hinge',lunge:'lunge','knee-isolation':'knee',bridge:'bridge',plank:'plank',crunch:'crunch',calf:'calf'};
  // Squat/push-up use independent linked-segment cases in the existing suite.
  for(const exercise of motionExercises.filter(e=>!['squat','pushup'].includes(e.family))){
    const r=run(familyKinds[exercise.family],{},exercise.id);
    assert.equal(r.exerciseId,exercise.id,JSON.stringify({id:exercise.id,family:r.exerciseFamily,reasons:r.quality.reasons}));
    assert.ok(r.attemptCount>=1,JSON.stringify({id:exercise.id,family:r.exerciseFamily,reasons:r.quality.reasons}));
    assert.deepEqual(r.checks.map(c=>c.code),exercise.requiredChecks);
    assert.ok(r.reps.every(rep=>rep.checks.length===exercise.requiredChecks.length));
  }
});


test('tracking coverage is measured over the entire clip instead of hiding lost targets in preparation',()=>{
  const c=clip('curl',{cycles:3});
  const frames=c.frames.map(f=>({...f,subjectTracking:{trackId:'subject-1',status:f.time<8?'lost':'locked',confidence:f.time<8?0:0.9}}));
  const r=analyzeMotion(frames,c.options);assert.equal(r.score,null);assert.ok(r.quality.reasons.includes('LOW_TARGET_COVERAGE'));assert.ok(r.quality.targetCoverage<0.4);
});


test('an upper-arm drift check points to the displaced arm rather than the elbow-flexion peak',()=>{
  const c=clip('curl');
  for(const frame of c.frames){
    const rotation=frame.time<1.5?Math.sin(frame.time/1.5*Math.PI)*Math.PI/3:0;
    for(const shoulderIndex of [11,12]){
      const shoulder=frame.landmarks[shoulderIndex];
      for(const index of [shoulderIndex+2,shoulderIndex+4]){const point=frame.landmarks[index],x=point.x-shoulder.x,y=point.y-shoulder.y;point.x=shoulder.x+x*Math.cos(rotation)-y*Math.sin(rotation);point.y=shoulder.y+x*Math.sin(rotation)+y*Math.cos(rotation);}
    }
  }
  const result=analyzeMotion(c.frames,c.options),drift=check(result,'UPPER_ARM_STABILITY');
  assert.equal(drift.status,'fail');assert.ok(drift.time>0.6&&drift.time<0.9);
  assert.ok(Math.abs(drift.time-result.reps[0].bottom)>0.5);
  assert.ok(Math.abs(drift.evidence.changeFromBaseline)>35);
});
