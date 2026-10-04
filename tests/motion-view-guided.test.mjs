// UI lifecycle tests with a minimal DOM and explicit local-analysis doubles.
// They exercise asynchronous cancellation and caching, not rendering/model quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {motionExercises,getMotionExercise} from '../public/motion-catalog.js';

const mocks={
  'motion-video.js':`export const MOTION_VIDEO_LIMITS={maxDuration:120,maxBytes:104857600}; export const validateVideoFile=()=>{}; export const scaledVideoSize=(width,height)=>({width,height}); export const analyzeVideo=(...args)=>globalThis.__guidedView.analyze(...args);`,
  'motion-media.js':`export const MOTION_VIDEO_ACCEPT='video/mp4'; export const releasePreparedMotionVideo=()=>{}; export const validateVideoMetadata=()=>{}; export const prepareMotionVideo=async file=>({mode:'native',file});`,
  'motion-evidence.js':`export const buildMotionEvidence=(...args)=>globalThis.__guidedView.evidence(...args);`,
  'motion-pose-data.js':`export const buildMotionPoseData=p=>({frameCount:p.frames.length,frames:p.frames}); export const buildFullMotionAnalysis=a=>a;`,
  'motion-frame-player.js':`export const createMotionFramePlayer=()=>({ready:false,seeking:false,currentTime:0,pause(){},clear(){},destroy(){},setDisabled(){},setSource:async()=>true,setFrames:async()=>{}});`,
};
const hooks=registerHooks({load(url,context,next){
  const name=url.slice(url.lastIndexOf('/')+1),source=url.includes('/public/')&&mocks[name];
  return source?{format:'module',source,shortCircuit:true}:next(url,context);
}});
const {mountMotionView}=await import('../public/motion-view.js?guided-ui-tests');
hooks.deregister();

class Element {
  constructor(selector=''){this.selector=selector;this.children=new Map();this.handlers=new Map();this.hidden=false;this.disabled=false;this.checked=true;this.value='';this.style={};this.dataset={};this.textContent='';this.innerHTML='';this.readyState=2;this.duration=2;this.videoWidth=640;this.videoHeight=480;this.currentTime=0;this.paused=true;this.seeking=false;this.classList={add(){},remove(){}};}
  querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new Element(selector));return this.children.get(selector);}
  addEventListener(type,fn,options={}){const list=this.handlers.get(type)||[];list.push({fn,options});this.handlers.set(type,list);}
  fire(type,extra={}){for(const {fn,options} of this.handlers.get(type)||[])if(!options.signal?.aborted)fn({target:this,preventDefault(){},...extra});}
  setAttribute(name,value){this[name]=value;}
  removeAttribute(name){delete this[name];}
  getContext(){return null;}
  replaceChildren(){this.innerHTML='';}
  pause(){this.paused=true;}
  load(){if(this.src){this.fire('loadedmetadata');this.fire('loadeddata');}}
  focus(){}
  scrollIntoView(){this.scrollCount=(this.scrollCount||0)+1;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<30;i++){if(predicate())return;await flush();}assert.fail('UI operation did not settle');}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function pipeline(){return {width:640,height:480,duration:2,sampleFps:7.5,sourceFps:30,frames:[0,1].map(time=>({time,personCount:1,landmarks:Array.from({length:33},(_,i)=>({x:.2+(i%5)*.1,y:.2+Math.floor(i/5)*.06,visibility:1})),subjectTracking:{status:'locked',trackId:'target',confidence:.9,bbox:{xMin:.2,yMin:.2,xMax:.7,yMax:.8}}})),targetTracking:{coverage:1}};}
function coach(id){const exercise=getMotionExercise(id);return {mode:'guided',action:{exerciseId:id,name:exercise.name,family:exercise.family,status:'selected',confidence:null,source:'user'},selectionCheck:{status:'consistent',evidenceTimes:[0],evidence:'画面中的动作与用户所选动作一致。'},coverage:{complete:true,strategy:'guided-evidence'},verdict:{status:'needs-improvement',summary:'请控制动作。'},feedback:[{status:'improve',source:'combined',title:'动作节奏',evidence:'画面及骨架中可见动作节奏不稳定。',correction:'减慢动作并保持可控。',evidenceTimes:[0]}]};}
function setup(t){
  const previous={window:globalThis.window,cancelAnimationFrame:globalThis.cancelAnimationFrame,requestAnimationFrame:globalThis.requestAnimationFrame};
  globalThis.window=new Element();globalThis.cancelAnimationFrame=()=>{};globalThis.requestAnimationFrame=()=>0;
  const h={analysisCalls:[],evidenceCalls:[],reviewCalls:[],saved:[],analysisQueue:[],evidenceQueue:[],reviewQueue:[],messages:[],historyValues:[],historyQueue:[],historyCalls:0};
  h.analyze=async(file,options)=>{h.analysisCalls.push({file,options});return h.analysisQueue.shift()?.promise??pipeline();};
  h.evidence=async(file,p,base,options)=>{h.evidenceCalls.push({file,pipeline:p,options});return h.evidenceQueue.shift()?.promise??{summary:{quality:base.quality},images:[{time:0,imageTime:0,mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,AAAA'}]};};
  globalThis.__guidedView=h;
  const container=new Element(),root=container.querySelector('.motion-page');
  const view=mountMotionView(container,{getCoachConfiguration:()=>({configured:true,vision:true,provider:'mock',model:'mock'}),reviewAssessment:async(body,options)=>{h.reviewCalls.push({body,options});return h.reviewQueue.shift()?.promise??coach(body.selectedExerciseId);},saveAssessment:async report=>{h.saved.push(report);},listAssessments:async()=>{h.historyCalls++;return h.historyQueue.shift()?.promise??h.historyValues;},notify:message=>h.messages.push(message)});
  h.root=root;h.container=container;h.view=view;h.find=selector=>root.querySelector(selector);
  h.select=id=>{const input=h.find('[data-motion-exercise]');input.value=id;input.fire('change');};
  h.click=action=>{const button=h.find(`[data-motion-action="${action}"]`);button.dataset.motionAction=action;button.closest=()=>button;root.fire('click',{target:button});};
  h.file=async(name='clip.mp4')=>{const input=h.find('[data-motion-file]');input.files=[new File(['fixture'],name,{type:'video/mp4'})];input.fire('change');await flush();};
  h.finished=()=>!h.find('[data-motion-results]').hidden && h.find('[data-motion-results]').innerHTML.includes('motion-coach-evaluation');
  t.after(()=>{view.destroy();delete globalThis.__guidedView;Object.assign(globalThis,previous);});
  return h;
}

test('a catalog exercise is mandatory; selection changes reuse pose and extracted pictures',async t=>{
  const h=setup(t);
  assert.match(h.container.innerHTML,/<select[^>]*data-motion-exercise[^>]*required/);
  for(const exercise of motionExercises)assert(h.container.innerHTML.includes(`<option value="${exercise.id}">${exercise.name}</option>`),exercise.id);
  await h.file();assert.equal(h.find('[data-motion-action="analyze"]').disabled,true);
  h.click('analyze');await flush();assert.equal(h.analysisCalls.length,0);
  h.select('squat');assert.equal(h.find('[data-motion-action="analyze"]').disabled,false);
  h.click('analyze');await until(h.finished);
  assert.equal(h.reviewCalls[0].body.reviewMode,'guided');assert.equal(h.reviewCalls[0].body.selectedExerciseId,'squat');
  assert.equal(h.analysisCalls.length,1);assert.equal(h.evidenceCalls.length,1);
  h.select('pushup');assert.equal(h.find('[data-motion-results]').hidden,true);
  h.click('analyze');await until(()=>h.reviewCalls.length===2&&h.finished());
  assert.equal(h.reviewCalls[1].body.selectedExerciseId,'pushup');assert.equal(h.analysisCalls.length,1);assert.equal(h.evidenceCalls.length,1);
  assert.match(h.find('[data-motion-results]').innerHTML,/你选择的动作：俯卧撑/);
  h.click('save');await until(()=>h.saved.length===1);
  assert.equal(h.saved[0].recognitionSource,'user');assert.equal(h.saved[0].coach.action.exerciseId,'pushup');assert.equal(h.saved[0].coach.selectionCheck.status,'consistent');
});

test('changing the selected action aborts review and ignores a late response that disregards abort',async t=>{
  const h=setup(t),old=deferred();h.reviewQueue.push(old);
  h.select('squat');await h.file();h.click('analyze');await until(()=>h.reviewCalls.length===1);
  h.select('pushup');assert.equal(h.reviewCalls[0].options.signal.aborted,true);assert.equal(h.find('[data-motion-results]').hidden,true);
  h.click('analyze');await until(()=>h.reviewCalls.length===2&&h.finished());
  old.resolve(coach('squat'));await flush();
  assert.match(h.find('[data-motion-results]').innerHTML,/你选择的动作：俯卧撑/);
  assert.equal(h.analysisCalls.length,1);assert.equal(h.evidenceCalls.length,1);
});

test('changing the video invalidates the old review and the evidence cache',async t=>{
  const h=setup(t),old=deferred();h.reviewQueue.push(old);
  h.select('squat');await h.file('first.mp4');h.click('analyze');await until(()=>h.reviewCalls.length===1);
  await h.file('second.mp4');assert.equal(h.reviewCalls[0].options.signal.aborted,true);
  old.resolve(coach('squat'));await flush();assert.equal(h.find('[data-motion-results]').hidden,true);
  h.click('analyze');await until(()=>h.reviewCalls.length===2&&h.finished());
  assert.equal(h.analysisCalls.length,2);assert.equal(h.evidenceCalls.length,2);assert.equal(h.evidenceCalls[1].file.name,'second.mp4');
});

test('an exercise changed during pose extraction applies to that video without restarting pose',async t=>{
  const h=setup(t),pose=deferred();h.analysisQueue.push(pose);
  h.select('squat');await h.file();h.click('analyze');await until(()=>h.analysisCalls.length===1);
  h.select('pushup');assert.equal(h.analysisCalls[0].options.signal.aborted,false);
  pose.resolve(pipeline());await until(h.finished);
  assert.equal(h.reviewCalls[0].body.selectedExerciseId,'pushup');assert.equal(h.analysisCalls.length,1);
});

test('clearing an exercise cancels review and prevents publishing or saving stale advice',async t=>{
  const h=setup(t),old=deferred();h.reviewQueue.push(old);
  h.select('squat');await h.file();h.click('analyze');await until(()=>h.reviewCalls.length===1);
  h.select('');old.resolve(coach('squat'));await flush();
  assert.equal(h.find('[data-motion-results]').hidden,true);assert.equal(h.find('[data-motion-action="analyze"]').disabled,true);assert.equal(h.find('[data-motion-coach-retry]').disabled,true);
  h.click('save');await flush();assert.equal(h.saved.length,0);
});

test('a response for a different exercise is rejected even if the request remains current',async t=>{
  const h=setup(t),wrong=deferred();h.reviewQueue.push(wrong);
  h.select('squat');await h.file();h.click('analyze');await until(()=>h.reviewCalls.length===1);
  wrong.resolve(coach('pushup'));await until(()=>h.find('[data-motion-coach-error]').textContent.includes('与所选动作不一致'));
  assert.equal(h.find('[data-motion-results]').hidden,true);h.click('save');await flush();assert.equal(h.saved.length,0);
});

function savedReport(id,exerciseId='squat'){
  return {id,data:{exerciseId,recognitionSource:'user',createdAt:'2026-01-01T00:00:00Z',video:{duration:2},coach:coach(exerciseId)}};
}

test('openReport refreshes records, opens the exact saved ID and scrolls to it',async t=>{
  const h=setup(t);await flush();
  h.historyValues=[savedReport('other'),savedReport('requested','pushup')];
  assert.equal(await h.view.openReport('requested'),true);
  assert.equal(h.historyCalls,2,'Mount and open each read current history');
  assert.match(h.find('[data-motion-results]').innerHTML,/你选择的动作：俯卧撑/);
  assert.equal(h.find('[data-motion-results]').hidden,false);
  assert.equal(h.find('[data-motion-results]').scrollCount,1);
});

test('openReport never substitutes another saved report when its ID was deleted',async t=>{
  const h=setup(t);h.historyValues=[savedReport('old','pushup')];
  assert.equal(await h.view.openReport('old'),true);
  h.historyValues=[savedReport('different')];
  assert.equal(await h.view.openReport('old'),false);
  assert.equal(h.find('[data-motion-results]').hidden,true);assert.equal(h.find('[data-motion-results]').innerHTML,'');
  assert.match(h.messages.at(-1),/报告已删除或不存在/);
});

test('openReport reports a history read failure without presenting stale data',async t=>{
  const h=setup(t);await flush();const read=deferred();h.historyQueue.push(read);
  const opened=h.view.openReport('old');read.reject(new Error('offline'));
  assert.equal(await opened,false);assert.match(h.messages.at(-1),/读取动作评估报告失败/);
  assert.equal(h.find('[data-motion-results]').hidden,true);
});

test('only the latest requested report can publish after competing history reads',async t=>{
  const h=setup(t);await flush();const first=deferred(),second=deferred();h.historyQueue.push(first,second);
  const old=h.view.openReport('first'),latest=h.view.openReport('second');
  second.resolve([savedReport('second','pushup')]);assert.equal(await latest,true);
  first.resolve([savedReport('first')]);assert.equal(await old,false);
  assert.match(h.find('[data-motion-results]').innerHTML,/你选择的动作：俯卧撑/);assert.equal(h.messages.length,0);
  assert.equal(h.find('[data-motion-results]').scrollCount,1);
});

test('a background history refresh cannot cancel or misdirect the latest report jump',async t=>{
  const h=setup(t);await flush();const first=deferred(),sync=deferred();h.historyQueue.push(first,sync);
  const opened=h.view.openReport('requested'),refreshed=h.view.refreshHistory();
  first.resolve([savedReport('old')]);await flush();assert.equal(h.messages.length,0);
  sync.resolve([savedReport('other'),savedReport('requested','pushup')]);await refreshed;
  assert.equal(await opened,true);assert.match(h.find('[data-motion-results]').innerHTML,/你选择的动作：俯卧撑/);
  assert.equal(h.messages.length,0);
});

test('choosing another video or destroying the view invalidates a pending report jump',async t=>{
  const h=setup(t);await flush();const first=deferred();h.historyQueue.push(first);
  const opened=h.view.openReport('first');await h.file();first.resolve([savedReport('first')]);
  assert.equal(await opened,false);assert.equal(h.find('[data-motion-results]').hidden,true);
  const second=deferred();h.historyQueue.push(second);const destroyed=h.view.openReport('second');h.view.destroy();second.resolve([savedReport('second')]);
  assert.equal(await destroyed,false);assert.equal(await h.view.openReport('second'),false);
});
