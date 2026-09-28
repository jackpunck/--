import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {ModelViewer} from '../public/model-viewer.js';

const originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
before(()=>Object.defineProperty(globalThis,'location',{value:{origin:'https://fitness.test'},configurable:true}));
after(()=>{if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else delete globalThis.location;});
const muscle=id=>({type:'muscle',id,key:'muscle:'+id});
const exercise=id=>({type:'exercise',id,key:'exercise:'+id});
const structure=id=>({type:'structure',id,key:'structure:'+id});

function harness(target=muscle('chest')) {
  const viewer=new ModelViewer(),sent=[];
  viewer.dialog={open:true};viewer.frame={contentWindow:{postMessage:message=>sent.push(message)}};
  viewer.desired=target;viewer.revision=7;viewer.ready=true;viewer.state='ready';
  viewer.setState=(state,error='')=>{viewer.state=state;viewer.error=error;};
  viewer.startTimer=()=>{};
  const receive=(data,source=viewer.frame.contentWindow,origin=location.origin)=>viewer.onMessage({data,source,origin});
  return {viewer,sent,receive};
}

test('warm selection stays covered until its exact target was drawn in the child',()=>{
  const {viewer,sent,receive}=harness(structure('Soleus muscle.l'));
  viewer.currentKey='muscle:chest';viewer.selectLatest();
  assert.equal(viewer.state,'loading');
  assert.deepEqual(sent.at(-1),{type:'fitness:structure',structure:'Soleus muscle.l',requestId:7});
  receive({type:'fitness:muscle-selected',mode:'atlas',muscle:'calves',structure:'Soleus muscle.l',requestId:7});
  assert.equal(viewer.state,'loading','A DOM selection acknowledgement is not a rendered frame');
  assert.deepEqual(sent.at(-1),{type:'fitness:visibility',visible:true,requestId:7});
  receive({type:'fitness:rendered',mode:'atlas',muscle:'chest',structure:null,requestId:7});
  assert.equal(viewer.state,'loading','An old canvas target cannot uncover the frame');
  receive({type:'fitness:rendered',mode:'atlas',muscle:'calves',structure:'Soleus muscle.l',requestId:7});
  assert.equal(viewer.state,'ready');
});

test('reopening the same exercise preserves selection but requires a new drawn frame',()=>{
  const {viewer,sent,receive}=harness(exercise('squat'));
  viewer.currentKey=viewer.desired.key;viewer.renderedKey=viewer.desired.key;viewer.selectLatest();
  assert.equal(viewer.state,'loading');
  assert.deepEqual(sent,[{type:'fitness:visibility',visible:true,requestId:7}]);
  receive({type:'fitness:rendered',mode:'motion',exercise:'squat',requestId:6});
  assert.equal(viewer.state,'loading');
  receive({type:'fitness:rendered',mode:'motion',exercise:'squat',requestId:7});
  assert.equal(viewer.state,'ready');
});

test('rapid A to B to A cannot accept an earlier A rendered acknowledgement',()=>{
  const {viewer,sent,receive}=harness();
  viewer.currentKey='muscle:chest';viewer.renderedKey='muscle:chest';
  viewer.desired=muscle('lats');viewer.revision=8;viewer.selectLatest();
  viewer.desired=muscle('chest');viewer.revision=9;viewer.selectLatest();
  assert.deepEqual(sent.filter(message=>message.type==='fitness:muscle').map(message=>[message.muscle,message.requestId]),[['lats',8],['chest',9]]);
  receive({type:'fitness:rendered',mode:'atlas',muscle:'chest',requestId:7});
  receive({type:'fitness:muscle-selected',mode:'atlas',muscle:'lats',requestId:8});
  assert.equal(viewer.state,'loading');
  receive({type:'fitness:muscle-selected',mode:'atlas',muscle:'chest',requestId:9});
  assert.equal(viewer.state,'loading');
  receive({type:'fitness:rendered',mode:'atlas',muscle:'chest',requestId:9});
  assert.equal(viewer.state,'ready');
});

test('reopening during a delayed canvas pick restores the requested target',()=>{
  const {viewer,sent,receive}=harness();
  viewer.currentKey='muscle:chest';viewer.selectLatest();
  receive({type:'fitness:rendered',mode:'atlas',muscle:'lats',requestId:7});
  assert.equal(viewer.state,'loading');
  assert.deepEqual(sent.at(-1),{type:'fitness:muscle',muscle:'chest',requestId:7});
  receive({type:'fitness:muscle-selected',mode:'atlas',muscle:'chest',requestId:7});
  receive({type:'fitness:rendered',mode:'atlas',muscle:'chest',requestId:7});
  assert.equal(viewer.state,'ready');
  const count=sent.length;
  receive({type:'fitness:muscle-selected',mode:'atlas',muscle:'lats',requestId:7});
  receive({type:'fitness:rendered',mode:'atlas',muscle:'lats',requestId:7});
  assert.equal(sent.length,count,'An intentional pick while open remains visible');
});

test('initial ready uses the first real draw only when it matches the latest target',()=>{
  const matching=harness(exercise('bench'));matching.viewer.ready=false;matching.viewer.state='loading';
  matching.receive({type:'fitness:ready',webgl:true,mode:'motion',exercise:'bench',requestId:null});
  assert.equal(matching.viewer.state,'ready');
  assert.equal(matching.sent.some(message=>message.type==='fitness:exercise'),false);
  const changed=harness(muscle('lats'));changed.viewer.ready=false;changed.viewer.state='loading';
  changed.receive({type:'fitness:ready',webgl:true,mode:'atlas',muscle:'chest',requestId:null});
  assert.equal(changed.viewer.state,'loading');
  assert.deepEqual(changed.sent.at(-1),{type:'fitness:muscle',muscle:'lats',requestId:7});
});

test('a muscle highlighted within an exercise is not a confirmed atlas target',()=>{
  const {viewer,receive}=harness(muscle('chest'));viewer.state='loading';
  receive({type:'fitness:muscle-selected',mode:'motion',muscle:'chest',requestId:7});
  receive({type:'fitness:rendered',mode:'motion',exercise:'bench',muscle:'chest',requestId:7});
  assert.equal(viewer.state,'loading');assert.equal(viewer.currentKey,null);
  receive({type:'fitness:rendered',mode:'atlas',muscle:'chest',structure:null,requestId:7});
  assert.equal(viewer.state,'ready');
});

test('foreign acknowledgements and late messages after a failure cannot uncover the frame',()=>{
  const {viewer,receive}=harness();viewer.state='loading';
  const rendered={type:'fitness:rendered',mode:'atlas',muscle:'chest',requestId:7};
  receive(rendered,{},location.origin);receive(rendered,viewer.frame.contentWindow,'https://other.test');
  assert.equal(viewer.state,'loading');
  viewer.fail('3D 加载超时，请重新加载。');receive(rendered);
  receive({type:'fitness:ready',webgl:true,mode:'atlas',muscle:'chest'});
  assert.equal(viewer.state,'error');
});
