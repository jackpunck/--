import test from 'node:test';
import assert from 'node:assert/strict';
import {enabledModels, taskSelection, reconcileTasks} from '../public/provider-ui.js';

const provider = {id:'one',model:'chat-model',models:[{id:'chat-model',name:'Chat',vision:null},{id:'vision-model',name:'Vision',vision:true},{id:'plan-model',name:'Plan',vision:false}]};
test('one provider keeps independent chat, meal, planning and motion models when its default changes',()=>{
  const tasks={chat:'one',meal:'one',planning:'one',motion:'one'},taskModels={chat:'chat-model',meal:'vision-model',planning:'plan-model',motion:'vision-model'};
  const changed={...provider,model:'vision-model'};
  const result=reconcileTasks([changed],tasks,taskModels);
  assert.deepEqual(result,{tasks,taskModels});
  assert.deepEqual(JSON.parse(taskSelection('planning',[changed],tasks,taskModels)),{providerId:'one',modelId:'plan-model'});
});
test('removing a selected model or supplier clears that task without routing it elsewhere',()=>{
  const result=reconcileTasks([{...provider,models:provider.models.slice(0,1)}],{chat:'one',meal:'one',planning:'removed'},{chat:'chat-model',meal:'vision-model',planning:'plan-model'});
  assert.deepEqual(result,{tasks:{chat:'one',meal:'',planning:'',motion:''},taskModels:{chat:'chat-model',meal:'',planning:'',motion:''}});
});
test('first connection defaults use only reported vision capability and preserve explicit empty choices later',()=>{
  const unknown={...provider,models:[provider.models[0]]};
  const initial=reconcileTasks([unknown],{},{},'one');
  assert.deepEqual(initial.tasks,{chat:'one',meal:'',planning:'one',motion:'one'});
  const withVision=reconcileTasks([provider],{},{},'one');
  assert.equal(withVision.taskModels.meal,'vision-model');
  assert.equal(withVision.taskModels.motion,'chat-model','Motion uses the selected default even when a separate vision model is enabled');
  assert.equal(initial.taskModels.motion,'chat-model','Text-only motion coaching remains selectable without claiming vision');
  assert.equal(reconcileTasks([provider],initial.tasks,initial.taskModels).tasks.meal,'');
});
test('adding the motion task to an existing account does not silently route its evidence to a provider',()=>{
  const existing=reconcileTasks([provider],{chat:'one',meal:'one',planning:'one'},{chat:'chat-model',meal:'vision-model',planning:'plan-model'});
  assert.equal(existing.tasks.motion,'');
  assert.equal(existing.taskModels.motion,'');
});
test('saving a provider assigns its default to an unconfigured motion task in an existing account',()=>{
  const tasks={chat:'one',meal:'',planning:'one'},taskModels={chat:'chat-model',meal:'',planning:'plan-model'};
  const changed={...provider,model:'plan-model'};
  for(const motion of [undefined,'']) {
    const beforeTasks=motion===undefined?tasks:{...tasks,motion};
    const beforeModels=motion===undefined?taskModels:{...taskModels,motion};
    const result=reconcileTasks([changed],beforeTasks,beforeModels,'one',{defaultTasks:['motion']});
    assert.deepEqual(result,{tasks:{...tasks,motion:'one'},taskModels:{...taskModels,motion:'plan-model'}});
    assert.deepEqual(JSON.parse(taskSelection('motion',[changed],result.tasks,result.taskModels)),{providerId:'one',modelId:'plan-model'});
  }
});
test('saving a provider preserves independently selected motion models and suppliers',()=>{
  const other={id:'other',model:'other-model',models:[{id:'other-model',vision:false}]};
  for(const [motion,motionModel] of [['one','vision-model'],['other','other-model']]) {
    const tasks={chat:'one',meal:'',planning:'one',motion},taskModels={chat:'chat-model',meal:'',planning:'plan-model',motion:motionModel};
    const changed={...provider,model:'plan-model'};
    assert.deepEqual(reconcileTasks([changed,other],tasks,taskModels,'one',{defaultTasks:['motion']}),{tasks,taskModels});
  }
});
test('saving a provider replaces an unavailable motion selection with its enabled default',()=>{
  const changed={...provider,model:'plan-model',models:[provider.models[0],provider.models[2]]};
  const tasks={chat:'one',meal:'',planning:'one',motion:'one'},taskModels={chat:'chat-model',meal:'',planning:'plan-model',motion:'vision-model'};
  const result=reconcileTasks([changed],tasks,taskModels,'one',{defaultTasks:['motion']});
  assert.deepEqual(result,{tasks,taskModels:{...taskModels,motion:'plan-model'}});
  const empty=reconcileTasks([{...changed,model:'',models:[]}],tasks,taskModels,'one',{defaultTasks:['motion']});
  assert.equal(empty.tasks.motion,'');
  assert.equal(empty.taskModels.motion,'');
});
test('legacy providers remain selectable and model IDs with slashes round trip safely',()=>{
  const legacy={id:'legacy',model:'org/model:v1'};
  assert.deepEqual(enabledModels(legacy),[{id:'org/model:v1',name:'org/model:v1',vision:null}]);
  assert.deepEqual(JSON.parse(taskSelection('chat',[legacy],{chat:'legacy'},{})),{providerId:'legacy',modelId:'org/model:v1'});
});
