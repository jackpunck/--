import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {analyzeMotion} from '../public/motion-analysis.js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {startServer} from '../server.mjs';
import {compactMotionAnalysis, sanitizeMotionCoachResponse, mergeCoachAssessment} from '../public/motion-contract.js';
import {getMotionExercise} from '../public/motion-catalog.js';
import {reconcileTasks} from '../public/provider-ui.js';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
const frames=[{time:1,mimeType:'image/png',data:png},{time:2,mimeType:'image/png',data:png}];
const local=()=>({version:'test',exerciseId:'squat',exerciseFamily:'squat',exerciseFamilyName:'深蹲',status:'complete',score:95,observedScore:95,
  quality:{usableRatio:1,reasons:[]},checks:getMotionExercise('squat').checks.map(rule=>({...rule,status:rule.visual?'unobservable':'pass',score:rule.visual?null:100,severity:'info',source:'pose',scope:rule.visual?'unobservable':'whole-repetition',time:1,evidenceTimes:[1],evidence:{metric:'testAngle',value:90,unit:'degree'},message:'本地姿态测得的观察',correction:''})),
  reps:[{index:1,start:0,end:3,score:95,qualified:true,issues:[]}],issues:[],evidenceFrames:[{time:1,poseTime:1.04,imageTime:1,timePrecision:'source-pts'}]});
const output=()=>({score:100,action:{exerciseId:'squat',status:'identified',confidence:'high',evidenceTimes:[1,2]},candidates:[{exerciseId:'invented-action',confidence:'high',evidenceTimes:[1]}],overallEvaluation:'根据关键帧检查身体位置。综合得分为100分。',
  checks:[{code:'SPINE_NEUTRAL',status:'pass',severity:'info',time:1,evidenceTimes:[1,2],evidence:'关键帧中躯干外形未见明显弯曲。',correction:'保持自然呼吸。'},{code:'SQUAT_TORSO_LEAN',status:'fail',severity:'severe',time:2,evidenceTimes:[2],evidence:'起身关键帧中肩部明显落后于髋部上升。',correction:'缩小幅度，保持肩髋一起起身。'}],limitations:[]});

async function fixture(t,handler) {
  const dir=await mkdtemp(join(tmpdir(),'motion-coach-'));
  const calls=[];
  const server=await startServer({host:'127.0.0.1',port:0,dataDir:dir,fetchImpl:async(url,options)=>{
    const call={url,body:JSON.parse(options.body),headers:options.headers,signal:options.signal};calls.push(call);
    if(handler)return handler(call);
    return Response.json({choices:[{message:{content:JSON.stringify(output())}}]});
  }});
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const api=async(path,{body,cookie,method,headers={},signal}={})=>{
    const response=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const register=async name=>api('/api/auth/register',{body:{name,email:`${name}@example.test`,password:'motion-coach-password'}});
  const alice=await register('alice'),bob=await register('bob');
  const configure=async(vision=true)=>api('/api/providers',{cookie:alice.cookie,method:'PUT',body:{providers:[{id:'coach',name:'Coach test',protocol:'openai',baseUrl:'http://127.0.0.1:9/v1',apiKey:'private-test-key',models:[{id:'ordinary',vision:false},{id:'review-model',vision}],model:'ordinary'}],tasks:{motion:'coach'},taskModels:{motion:'review-model'}}});
  return {calls,api,alice,bob,configure,base};
}

test('motion route uses the dedicated account task, transient images and bounded evidence-linked output',async t=>{
  const f=await fixture(t);assert.equal((await f.configure()).status,200);
  const config=await f.api('/api/providers',{cookie:f.alice.cookie});assert.equal(config.body.taskModels.motion,'review-model');
  const analysis={...local(),frames:[{secret:'RAW-LANDMARK-SEQUENCE'}],dataUrl:'raw-user-video'};
  const result=await f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{duration:3,analysis,keyframes:frames}});
  assert.equal(result.status,200);assert.equal(result.body.mode,'visual');assert.equal(result.body.action.exerciseId,'squat');
  assert.equal(result.body.score,undefined);assert.equal(result.body.model,'review-model');assert(!result.body.overallEvaluation.includes('100分'));
  assert.equal(result.body.candidates.length,1);assert(result.body.assessment.score<=49);assert.equal(result.body.assessment.qualifiedRepCount,0);assert(result.body.assessment.reps[0].score<=49);
  const sent=f.calls[0].body;assert.equal(sent.model,'review-model');assert.equal(sent.messages[1].content.filter(part=>part.type==='image_url').length,2);
  const summary=JSON.parse(sent.messages[1].content[0].text);assert.deepEqual(summary.frames.map(frame=>frame.time),[1,2]);assert.equal(summary.analysis.exerciseFamily,'squat');assert.equal(summary.analysis.evidenceFrames[0].imageTime,1);
  assert(!JSON.stringify(sent).includes('RAW-LANDMARK-SEQUENCE'));assert(!JSON.stringify(result).includes('private-test-key'));
  const exported=await f.api('/api/export',{cookie:f.alice.cookie});assert.deepEqual(exported.body.attachments,[]);assert(!exported.body.records.some(record=>record.kind==='motion-assessment'));
  assert.equal((await f.api('/api/motion/coach',{cookie:f.bob.cookie,body:{duration:3,analysis:local(),keyframes:frames}})).status,400);
  assert.equal((await f.api('/api/motion/coach',{cookie:f.alice.cookie,headers:{'X-Fitness-User':f.bob.body.user.id},body:{duration:3,analysis:local(),keyframes:frames}})).status,409);
  assert.equal(f.calls.length,1,'Another account cannot borrow the configured provider or key');
});

test('saving an existing provider assigns an unconfigured motion task to its selected default',async t=>{
  const f=await fixture(t);
  const provider={id:'existing',name:'Existing AI',protocol:'openai',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'text-default',vision:false},{id:'vision-alternative',vision:true},{id:'next-default',vision:false}],model:'vision-alternative'};
  const tasks={chat:'existing',meal:'existing',planning:'existing'},taskModels={chat:'text-default',meal:'vision-alternative',planning:'text-default'};
  const initial=await f.api('/api/providers',{cookie:f.alice.cookie,method:'PUT',body:{providers:[provider],tasks,taskModels}});
  assert.equal(initial.status,200);
  let settings=(await f.api('/api/providers',{cookie:f.alice.cookie})).body;
  assert.equal(Object.hasOwn(settings.tasks,'motion'),false,'Reading old settings does not assign the new task');
  assert.equal(Object.hasOwn(settings.taskModels,'motion'),false);
  const editedProvider={...settings.providers[0],model:'text-default'};
  const selection=reconcileTasks([editedProvider],settings.tasks,settings.taskModels,editedProvider.id,{defaultTasks:['motion']});
  const saved=await f.api('/api/providers',{cookie:f.alice.cookie,method:'PUT',body:{providers:[editedProvider],...selection}});
  assert.equal(saved.status,200);
  settings=(await f.api('/api/providers',{cookie:f.alice.cookie})).body;
  assert.equal(settings.tasks.motion,'existing');
  assert.equal(settings.taskModels.motion,'text-default','The selected default takes priority over another vision model');
  for(const task of Object.keys(tasks)) {
    assert.equal(settings.tasks[task],tasks[task]);assert.equal(settings.taskModels[task],taskModels[task]);
  }
  const result=await f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{duration:3,analysis:local(),keyframes:frames}});
  assert.equal(result.status,200);assert.equal(result.body.model,'text-default');assert.equal(result.body.mode,'evidence-only');
  assert.equal(f.calls[0].body.model,'text-default');
  assert.equal(f.calls[0].body.messages[1].content.some(part=>part.type==='image_url'),false);

  const explicit=await f.api('/api/providers',{cookie:f.alice.cookie,method:'PUT',body:{providers:settings.providers,tasks:settings.tasks,taskModels:{...settings.taskModels,motion:'vision-alternative'}}});
  assert.equal(explicit.status,200);settings=explicit.body;
  const changedProvider={...settings.providers[0],model:'next-default'};
  const preserved=reconcileTasks([changedProvider],settings.tasks,settings.taskModels,changedProvider.id,{defaultTasks:['motion']});
  const changed=await f.api('/api/providers',{cookie:f.alice.cookie,method:'PUT',body:{providers:[changedProvider],...preserved}});
  assert.equal(changed.status,200);assert.equal(changed.body.providers[0].model,'next-default');assert.equal(changed.body.taskModels.motion,'vision-alternative');
});

test('text models receive no pixels and cannot claim visual recognition or spine observations',async t=>{
  const f=await fixture(t);await f.configure(false);
  const result=await f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{duration:3,analysis:local(),keyframes:frames}});
  assert.equal(result.status,200);assert.equal(result.body.mode,'evidence-only');assert.equal(result.body.action.status,'unknown');assert.deepEqual(result.body.candidates,[]);
  assert(!result.body.checks.some(check=>check.code==='SPINE_NEUTRAL'));
  assert.equal(result.body.checks.find(check=>check.code==='SQUAT_TORSO_LEAN').status,'pass','A text response cannot invent a failure over existing evidence');
  assert(!JSON.stringify(f.calls[0].body).includes('data:image'));assert.deepEqual(JSON.parse(f.calls[0].body.messages[1].content[0].text).frames,[]);
});

test('motion request limits validate timestamps, image signatures, account access and total bytes before provider calls',async t=>{
  const f=await fixture(t);await f.configure();const request={duration:3,analysis:local(),keyframes:frames};
  for(const patch of [{duration:121},{keyframes:Array(7).fill(frames[0])},{keyframes:[{...frames[0],time:4}]},{keyframes:[frames[0],frames[0]]},{keyframes:[{...frames[0],mimeType:'image/svg+xml'}]},{keyframes:[{...frames[0],data:Buffer.from('not png').toString('base64')}]},{keyframes:[{...frames[0],data:'%%%'}]}]) {
    assert.equal((await f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{...request,...patch}})).status,400);
  }
  const oversized=Buffer.alloc(420*1024);Buffer.from(png,'base64').copy(oversized);
  assert.equal((await f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{...request,keyframes:Array.from({length:5},(_,i)=>({time:i/2,mimeType:'image/png',data:oversized.toString('base64')}))}})).status,413);
  assert.equal((await f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{...request,analysis:{summary:'a'.repeat(129*1024)}}})).status,413);
  assert.equal((await f.api('/api/motion/coach',{body:request})).status,401);assert.equal(f.calls.length,0);
});

test('bad model JSON becomes a bounded error, and request cancellation aborts the provider',async t=>{
  await t.test('bad JSON',async t=>{const f=await fixture(t,()=>Response.json({choices:[{message:{content:'this is not JSON'}}]}));await f.configure();const result=await f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{duration:3,analysis:local(),keyframes:frames}});assert.equal(result.status,502);assert.match(result.body.error,/结构/);});
  await t.test('abort',async t=>{
    let started,aborted;const start=new Promise(resolve=>{started=resolve}),done=new Promise(resolve=>{aborted=resolve});
    const f=await fixture(t,call=>new Promise((resolve,reject)=>{started();call.signal.addEventListener('abort',()=>{aborted();reject(call.signal.reason);},{once:true});}));await f.configure();
    const controller=new AbortController(),pending=f.api('/api/motion/coach',{cookie:f.alice.cookie,body:{duration:3,analysis:local(),keyframes:frames},signal:controller.signal});
    await start;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
    await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Provider was not cancelled')),1000))]);
  });
});

test('sanitization drops unsupported checks and invalid times; deterministic merge retains local failures and quality vetoes',()=>{
  const analysis=local();analysis.checks.find(check=>check.code==='SQUAT_TORSO_LEAN').status='fail';analysis.checks.find(check=>check.code==='SQUAT_TORSO_LEAN').severity='severe';analysis.checks.find(check=>check.code==='SQUAT_TORSO_LEAN').score=5;
  const value=output();value.checks=[{code:'SQUAT_TORSO_LEAN',status:'pass',time:1,evidenceTimes:[1],evidence:'关键帧看起来平稳。'}, {code:'SPINE_NEUTRAL',status:'pass',time:99,evidenceTimes:[99],evidence:'假定脊柱始终中立。'}, {code:'MADE_UP',status:'pass',time:1,evidence:'不存在的检查。'}];
  const coach=sanitizeMotionCoachResponse(value,{mode:'visual',analysis,keyframes:frames});assert.equal(coach.checks.length,2);assert.equal(coach.checks[1].status,'uncertain');assert.equal(coach.checks[1].time,null);
  const merged=mergeCoachAssessment(analysis,coach);assert.equal(merged.checks.find(check=>check.code==='SQUAT_TORSO_LEAN').status,'fail');assert(merged.score<=49);assert.equal(merged.qualifiedRepCount,0);
  for(const code of ['LOW_POSE_COVERAGE','MULTIPLE_PEOPLE','LOW_SOURCE_FRAME_RATE'])assert.equal(mergeCoachAssessment({...analysis,status:'insufficient',quality:{reasons:[code]}},coach).score,null);
  const noImages=sanitizeMotionCoachResponse(output(),{mode:'visual',analysis,keyframes:[]});assert.equal(noImages.mode,'evidence-only');assert.equal(noImages.action.exerciseId,null);
  const concise=compactMotionAnalysis({...analysis,requiresVisualConfirmation:true,candidates:['squat'],landmarks:[1,2,3]});assert.equal(concise.requiresVisualConfirmation,true);assert.equal(concise.candidates[0].exerciseId,'squat');assert.equal(concise.landmarks,undefined);
});

test('family-only advice preserves a provisional score without claiming an exercise, and visual failures stay on their repetition',()=>{
  const recipe=getMotionExercise('row');
  const checks=recipe.checks.map(rule=>({...rule,status:rule.visual?'unobservable':'pass',score:rule.visual?null:100,scope:rule.visual?'unobservable':'whole-repetition',source:'pose',time:1,evidenceTimes:[1],message:'已有姿态观察'}));
  const base={exerciseId:null,exerciseFamily:'row',requiresVisualConfirmation:true,status:'complete',score:69,quality:{reasons:[]},checks,reps:[{start:0,end:3,score:69,checks},{start:3.01,end:6,score:69,checks}]};
  const explained=sanitizeMotionCoachResponse({checks:[{code:'ROW_ROM',status:'pass',correction:'保持可控制的拉回幅度。'}]},{analysis:base,mode:'evidence-only'});
  assert.equal(explained.checks.length,1);
  const merged=mergeCoachAssessment(base,explained);assert.equal(merged.exerciseId,null);assert.equal(merged.score,69);assert.equal(merged.scoreStatus,'provisional');assert.equal(merged.requiresVisualConfirmation,true);
  const visual=sanitizeMotionCoachResponse({action:{exerciseId:'row',status:'identified',confidence:'high',evidenceTimes:[1,2]},checks:[{code:'SPINE_NEUTRAL',status:'fail',severity:'severe',time:2,evidenceTimes:[2],evidence:'这一关键帧可见明显的躯干外形变化。'}]},{analysis:base,mode:'visual',keyframes:frames});
  const checked=mergeCoachAssessment(base,visual);assert.equal(checked.reps[0].checks.find(check=>check.code==='SPINE_NEUTRAL').status,'fail');assert(checked.reps[0].score<=49);
  assert.equal(checked.reps[1].checks.find(check=>check.code==='SPINE_NEUTRAL').status,'unobservable');assert.equal(checked.reps[1].score,69);assert.equal(checked.reps[1].scoreStatus,'provisional');assert.equal(checked.qualifiedRepCount,0);
  assert(checked.scoreCoverage<1,'Two pictures cannot establish full clip coverage');
  for(const code of ['EXERCISE_HINT_CONFLICT','INSUFFICIENT_CHECK_COVERAGE','TARGET_ID_CHANGED'])assert.equal(mergeCoachAssessment({...base,quality:{reasons:[code]}},visual).score,null);
});

test('the motion endpoint reaches a real HTTP mock provider without exposing credentials in responses',async t=>{
  let received;
  const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);received={headers:req.headers,body:JSON.parse(Buffer.concat(chunks))};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output())}}]}));});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const dir=await mkdtemp(join(tmpdir(),'motion-wire-')),server=await startServer({host:'127.0.0.1',port:0,dataDir:dir});
  t.after(async()=>{await Promise.all([server,upstream].map(item=>new Promise(resolve=>{item.close(resolve);item.closeAllConnections();})));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'wire',email:'wire@example.test',password:'motion-wire-password'})});
  const cookie=registration.headers.get('set-cookie').split(';')[0],headers={cookie,'Content-Type':'application/json'};
  const configured=await fetch(base+'/api/providers',{method:'PUT',headers,body:JSON.stringify({providers:[{id:'wire',name:'Wire',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,apiKey:'wire-secret',models:[{id:'vision-wire',vision:true}]}],tasks:{motion:'wire'},taskModels:{motion:'vision-wire'}})});assert.equal(configured.status,200);
  const response=await fetch(base+'/api/motion/coach',{method:'POST',headers,body:JSON.stringify({duration:3,analysis:local(),keyframes:frames})});assert.equal(response.status,200);const body=await response.json();assert.equal(body.mode,'visual');assert.equal(received.headers.authorization,'Bearer wire-secret');assert.equal(received.body.model,'vision-wire');assert(!JSON.stringify(body).includes('wire-secret'));
});


test('text-only merging preserves observed coverage across partially obscured real push-up repetitions',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/motion-pushup-real.json',import.meta.url)));
  const frames=fixture.frames.map(([time,points])=>{
    const landmarks=Array(33).fill(null);fixture.landmarkIndices.forEach((index,i)=>{const [x,y,visibility]=points[i];landmarks[index]={x,y,visibility};});return {time,landmarks};
  });
  const base=analyzeMotion(frames,fixture.options);
  assert.ok(base.reps.some(rep=>rep.scoreCoverage<0.7));
  assert.ok(base.reps.some(rep=>rep.scoreCoverage>=0.7));
  const merged=mergeCoachAssessment(base,{mode:'evidence-only',action:{status:'unknown'},checks:[]});
  assert.equal(merged.scoreCoverage,base.scoreCoverage);
  assert.equal(merged.observedScore,base.observedScore);
  assert.equal(merged.score,base.score);
  assert.deepEqual(merged.reps.map(rep=>rep.scoreCoverage),base.reps.map(rep=>rep.scoreCoverage));
});

test('one visual check with evidence in separate repetitions updates only those repetitions and their seek times',()=>{
  const recipe=getMotionExercise('pushup');
  const checks=recipe.checks.map(rule=>({...rule,status:rule.visual?'unobservable':'pass',score:rule.visual?null:100,scope:rule.visual?'unobservable':'whole-repetition',source:'pose',severity:'info',time:1,evidenceTimes:[1],message:'已有姿态观察'}));
  const base={exerciseId:'pushup',exerciseFamily:'pushup',score:69,quality:{reasons:[]},checks,reps:[{start:0,end:2,score:69,checks},{start:3,end:5,score:69,checks},{start:6,end:8,score:69,checks}]};
  const visual=sanitizeMotionCoachResponse({action:{exerciseId:'pushup',status:'identified',confidence:'high',evidenceTimes:[1,4]},checks:[{code:'BODY_ALIGNMENT',status:'fail',severity:'severe',time:1,evidenceTimes:[1,4],evidence:'两个提供的关键帧均可见髋部明显下沉。'}]},{analysis:base,mode:'visual',keyframes:[{time:1},{time:4}]});
  const merged=mergeCoachAssessment(base,visual);
  for(const [index,time] of [[0,1],[1,4]]){
    assert.ok(merged.reps[index].score<=49);
    const failure=merged.reps[index].checks.find(check=>check.code==='BODY_ALIGNMENT');
    assert.equal(failure.status,'fail');assert.equal(failure.time,time);assert.deepEqual(failure.evidenceTimes,[time]);
    assert.equal(merged.reps[index].issues.find(issue=>issue.code==='BODY_ALIGNMENT').time,time);
  }
  assert.equal(merged.reps[2].score,69);assert.equal(merged.reps[2].checks.find(check=>check.code==='BODY_ALIGNMENT').status,'pass');
});

test('sampled visual passes remain provisional and a warning is not promoted into a severe failure',()=>{
  const base=local();base.reps[0].checks=base.checks;base.score=69;base.reps[0].score=69;
  const value=output();value.checks=value.checks.filter(check=>check.code==='SPINE_NEUTRAL');
  const coach=sanitizeMotionCoachResponse(value,{analysis:base,mode:'visual',keyframes:frames});
  const passed=mergeCoachAssessment(base,coach);assert.equal(passed.scoreStatus,'provisional');assert.equal(passed.qualifiedRepCount,0);assert.ok(passed.score<=69);assert.equal(passed.checks.find(check=>check.code==='SPINE_NEUTRAL').scope,'sampled-frames');
  value.checks=[{code:'SQUAT_TORSO_LEAN',status:'fail',severity:'warning',time:1,evidenceTimes:[1],evidence:'该关键帧显示轻度前倾，需要结合动作变式复核。'}];
  const warning=sanitizeMotionCoachResponse(value,{analysis:base,mode:'visual',keyframes:frames});assert.equal(warning.checks[0].severity,'warning');
  const failed=mergeCoachAssessment(base,warning);assert.equal(failed.checks.find(check=>check.code==='SQUAT_TORSO_LEAN').severity,'warning');assert.equal(failed.score,59);
});

test('only bounded known target boxes and frame mappings survive analysis compaction',()=>{
  const bbox={xMin:0.2,yMin:0.1,xMax:0.7,yMax:0.9};
  const result=compactMotionAnalysis({evidenceFrames:[{time:1,subjectTracking:{status:'locked',trackId:'motion-target-1',confidence:0.9,bbox,unknown:Array(500).fill('not needed')},frameMappings:Array.from({length:20},(_,i)=>({requestedTime:i,poseTime:i+0.02,sourceTime:i+0.01,rawFrames:[1,2,3]}))}]});
  assert.deepEqual(result.evidenceFrames[0].subjectTracking.bbox,bbox);assert.equal(result.evidenceFrames[0].subjectTracking.unknown,undefined);
  assert.equal(result.evidenceFrames[0].frameMappings.length,6);assert.deepEqual(result.evidenceFrames[0].frameMappings[0],{requestedTime:0,poseTime:0.02,sourceTime:0.01});
  for(const code of ['LOW_TARGET_COVERAGE','TARGET_ID_CHANGED','EXERCISE_HINT_CONFLICT'])assert.equal(mergeCoachAssessment({...local(),quality:{reasons:[code]}},{mode:'visual',action:{status:'identified',exerciseId:'squat'},checks:[]}).score,null);
});


test('an exact hint that reverses the repetition phase cannot erase earlier observed family failures',()=>{
  const frames=[];
  for(let n=0;n<=120;n++){
    const time=n/15,p=(1-Math.cos(time%4*Math.PI/2))/2,landmarks=Array(33).fill(null);
    const angle=10*Math.PI/180,elbowAngle=(170-110*p)*Math.PI/180;
    const shoulder=[350,230],elbow=[350+110*Math.sin(angle),230+110*Math.cos(angle)],wrist=[elbow[0]+110*Math.sin(angle+Math.PI-elbowAngle),elbow[1]+110*Math.cos(angle+Math.PI-elbowAngle)];
    const twist=time<1.5?Math.sin(time/1.5*Math.PI)*Math.PI/3:0;
    for(const joint of [elbow,wrist]){const x=joint[0]-350,y=joint[1]-230;joint[0]=350+x*Math.cos(twist)-y*Math.sin(twist);joint[1]=230+x*Math.sin(twist)+y*Math.cos(twist);}
    [shoulder,elbow,wrist,[350,450],[350,625],[350,800]].forEach((joint,i)=>{const index=[11,13,15,23,25,27][i];for(const side of [0,1])landmarks[index+side]={x:(joint[0]+side*6)/1000,y:joint[1]/1000,visibility:0.99};});
    frames.push({time,landmarks});
  }
  const options={width:1000,height:1000,duration:8},base=analyzeMotion(frames,options),hinted=analyzeMotion(frames,{...options,exerciseHint:'triceps'});
  assert.equal(base.exerciseFamily,'elbow-isolation');assert.equal(base.checks.find(check=>check.code==='UPPER_ARM_STABILITY').status,'fail');assert.ok(base.score<=49);
  assert.equal(hinted.checks.find(check=>check.code==='UPPER_ARM_STABILITY').status,'pass');assert.ok(hinted.score>base.score);
  const coach={mode:'visual',action:{status:'identified',exerciseId:'triceps',confidence:'high',evidenceTimes:[2,4]},checks:[]};
  const merged=mergeCoachAssessment(hinted,coach,{originalAnalysis:base});
  assert.equal(merged.exerciseId,'triceps');assert.equal(merged.checks.find(check=>check.code==='UPPER_ARM_STABILITY').status,'fail');assert.ok(merged.score<=49);
  assert.ok(merged.issues.some(issue=>issue.code==='UPPER_ARM_STABILITY'&&issue.preservedFromFamily));
  assert.ok(merged.reps.every(rep=>rep.checks.find(check=>check.code==='UPPER_ARM_STABILITY').status==='pass'),'Earlier evidence outside the newly delimited repetitions stays a global observation');
  const quality=mergeCoachAssessment(hinted,coach,{originalAnalysis:{...base,quality:{reasons:['LOW_TARGET_COVERAGE']}}});assert.equal(quality.score,null);
});

test('keyframes cannot create a numeric evaluation when the local motion contains no complete attempt',()=>{
  const base={...local(),status:'insufficient',score:null,reps:[],quality:{reasons:['INCOMPLETE_REPETITION']}};
  const coach=sanitizeMotionCoachResponse(output(),{analysis:base,mode:'visual',keyframes:frames});
  const merged=mergeCoachAssessment(base,coach);assert.equal(merged.exerciseId,'squat');assert.equal(merged.status,'insufficient');assert.equal(merged.score,null);assert.equal(merged.qualifiedRepCount,0);
});
