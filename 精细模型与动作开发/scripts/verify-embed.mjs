import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelBridge, readModelOptions, supportedExercises, animatedExercises } from '../embed-interface.js';
import { muscleIds, structures } from '../muscle-data.js';

test('deep links select all 25 actual poses, distinguish unsupported IDs and opt into embedding explicitly', () => {
  assert.equal(supportedExercises.length,25);
  assert.deepEqual(animatedExercises,['squat','pushup','curl']);
  for (const exercise of supportedExercises) {
    const url = new URL(`https://fitness.example/model/index.html?exercise=${exercise}&embed=1`);
    assert.deepEqual(readModelOptions(url.search), { exercise, embed: true,compact:false,invalidExercise:false,mode:'motion',muscle:null,structure:null });
  }
  for (const exercise of ['unknown', '__proto__', 'constructor', '<script>', '']) {
    assert.equal(readModelOptions(`?exercise=${encodeURIComponent(exercise)}`).exercise, null);
    assert.equal(readModelOptions(`?exercise=${encodeURIComponent(exercise)}`).invalidExercise,true);
  }
  assert.equal(readModelOptions('').exercise,'squat');
  assert.equal(readModelOptions('').embed,false);
  assert.equal(readModelOptions('?exercise=curl&embed=true').embed, false);
});

test('muscle and exact-structure deep links accept only names backed by the real atlas',()=>{
  for(const muscle of muscleIds){const options=readModelOptions(`?mode=atlas&muscle=${muscle}&compact=1`);assert.equal(options.mode,'atlas');assert.equal(options.muscle,muscle);assert.equal(options.compact,true);}
  for(const name of structures)assert.equal(readModelOptions(`?structure=${encodeURIComponent(name)}`).structure,name);
  assert.equal(readModelOptions('?muscle=constructor').muscle,null);
  assert.equal(readModelOptions('?structure=Invented%20muscle').structure,null);
});

function fakeWindow(origin = 'https://fitness.example') {
  const host = new EventTarget();
  const messages = [];
  host.location = { origin };
  host.parent = { postMessage: (data, targetOrigin) => messages.push({ data, targetOrigin }) };
  return { host, messages };
}

function receive(host, data, { origin = host.location.origin, source = host.parent } = {}) {
  const event = new Event('message');
  Object.assign(event, { data, origin, source });
  host.dispatchEvent(event);
}

test('only the same-origin parent can switch animations; invalid messages are ignored', () => {
  const { host } = fakeWindow();
  const selected = [];
  const bridge = createModelBridge(host, exercise => selected.push(exercise));
  const command = { type: 'fitness:exercise', exercise: 'pushup' };
  receive(host, command, { origin: 'https://untrusted.example' });
  receive(host, command, { source: {} });
  receive(host, { ...command, exercise: 'constructor' });
  receive(host, { ...command, exercise: 'unknown' });
  receive(host, { ...command, type: 'other' });
  receive(host, null);
  receive(host, JSON.stringify(command));
  assert.deepEqual(selected, []);
  receive(host, command);
  receive(host, { type: 'fitness:exercise', exercise: 'curl' });
  assert.deepEqual(selected, ['pushup', 'curl']);
  bridge.destroy();
  receive(host, command);
  assert.deepEqual(selected, ['pushup', 'curl']);
});

test('muscle and structure commands retain the exact-origin parent boundary',()=>{
  const {host,messages}=fakeWindow(),selected=[];
  const bridge=createModelBridge(host,()=>{},id=>selected.push(id),name=>selected.push(name));
  const structure='Serratus anterior muscle.l';
  receive(host,{type:'fitness:muscle',muscle:'chest'},{origin:'https://untrusted.example'});
  receive(host,{type:'fitness:structure',structure},{source:{}});
  receive(host,{type:'fitness:muscle',muscle:'constructor'});
  assert.deepEqual(selected,[]);
  receive(host,{type:'fitness:muscle',muscle:'obliques'});receive(host,{type:'fitness:structure',structure});
  assert.deepEqual(selected,['obliques',structure]);
  bridge.muscleSelected(null,'左侧 · 前锯肌',structure);
  assert.deepEqual(messages[0],{data:{type:'fitness:muscle-selected',muscle:null,name:'左侧 · 前锯肌',structure,mode:'atlas'},targetOrigin:'https://fitness.example'});
});

test('readiness and selection events name the animation and target the exact parent origin', () => {
  const { host, messages } = fakeWindow();
  const bridge = createModelBridge(host, () => {});
  bridge.ready('curl', '哑铃弯举', true);
  bridge.selected('pushup', '俯卧撑');
  assert.deepEqual(messages, [
    { data: { type: 'fitness:ready', exercise: 'curl', title: '哑铃弯举', webgl: true }, targetOrigin: 'https://fitness.example' },
    { data: { type: 'fitness:selected', exercise: 'pushup', title: '俯卧撑', mode:'motion' }, targetOrigin: 'https://fitness.example' },
  ]);
});

test('parent visibility accepts only booleans from the actual same-origin parent', () => {
  const {host}=fakeWindow(),visibility=[];
  const bridge=createModelBridge(host,()=>{},()=>{},()=>{},visible=>visibility.push(visible));
  for(const visible of [undefined,null,0,1,'false',{},[]])receive(host,{type:'fitness:visibility',visible});
  receive(host,{type:'fitness:visibility',visible:false},{origin:'https://untrusted.example'});
  receive(host,{type:'fitness:visibility',visible:false},{source:{}});
  assert.deepEqual(visibility,[]);
  receive(host,{type:'fitness:visibility',visible:false});receive(host,{type:'fitness:visibility',visible:true});
  assert.deepEqual(visibility,[false,true]);
  bridge.destroy();receive(host,{type:'fitness:visibility',visible:false});assert.equal(visibility.length,2);
});

test('ready can identify the selected atlas structure and report initialization failure', () => {
  const {host,messages}=fakeWindow(),bridge=createModelBridge(host,()=>{});
  bridge.ready(null,'左侧 · 腹横肌',true,{mode:'atlas',muscle:'core',structure:'Transversus abdominis muscle.l'});
  assert.deepEqual(messages[0].data,{type:'fitness:ready',exercise:null,title:'左侧 · 腹横肌',webgl:true,mode:'atlas',muscle:'core',structure:'Transversus abdominis muscle.l'});
  bridge.ready(null,'肌肉图谱',false,{mode:'atlas',muscle:null,structure:null});
  assert.equal(messages[1].data.webgl,false);assert.equal(messages[1].targetOrigin,host.location.origin);
});

test('selection request identifiers survive acknowledgements without accepting untrusted values',()=>{
  const {host,messages}=fakeWindow(),requests=[];
  const bridge=createModelBridge(host,(value,id)=>requests.push([value,id]),()=>{},()=>{},(visible,id)=>requests.push([visible,id]));
  receive(host,{type:'fitness:exercise',exercise:'bench',requestId:7});
  receive(host,{type:'fitness:visibility',visible:true,requestId:8});
  for(const requestId of [-1,1.5,Infinity,'8',{},Number.MAX_SAFE_INTEGER+1])receive(host,{type:'fitness:exercise',exercise:'curl',requestId});
  assert.deepEqual(requests.slice(0,2),[['bench',7],[true,8]]);assert(requests.slice(2).every(([,id])=>id===null));
  bridge.selected('bench','哑铃卧推',7);
  bridge.rendered(null,'左侧 · 比目鱼肌',{mode:'atlas',muscle:'calves',structure:'Soleus muscle.l',requestId:8});
  assert.equal(messages[0].data.requestId,7);
  assert.deepEqual(messages[1],{targetOrigin:host.location.origin,data:{type:'fitness:rendered',exercise:null,title:'左侧 · 比目鱼肌',mode:'atlas',muscle:'calves',structure:'Soleus muscle.l',requestId:8}});
});

test('standalone and opaque-origin files do not expose a message bridge', () => {
  for (const standalone of [true, false]) {
    const { host, messages } = fakeWindow(standalone ? 'https://fitness.example' : 'null');
    if (standalone) host.parent = host;
    let changes = 0;
    const bridge = createModelBridge(host, () => changes++);
    receive(host, { type: 'fitness:exercise', exercise: 'curl' });
    bridge.ready('squat', '徒手深蹲', false);
    assert.equal(changes, 0);
    assert.deepEqual(messages, []);
  }
});
