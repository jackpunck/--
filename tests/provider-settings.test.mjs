import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderSettings, verifyTaskModels} from '../public/provider-settings.js';

const body = {
  providers: [{id:'one', name:'Fixture', model:'chat-model', models:[
    {id:'chat-model'}, {id:'meal-model',vision:true}, {id:'plan-model'}, {id:'review-model'}
  ]}],
  tasks: {chat:'one', meal:'one', planning:'one', motion:'one'},
  taskModels: {chat:'chat-model', meal:'meal-model', planning:'plan-model', motion:'review-model'}
};

function settings() { return structuredClone(body); }
function withoutMotion() {
  const result = settings();
  delete result.tasks.motion;
  delete result.taskModels.motion;
  return result;
}
function unconfiguredMotion() {
  const result = settings();
  result.tasks.motion = '';
  result.taskModels.motion = '';
  return result;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return {promise,resolve,reject};
}
function requests() {
  const calls = [], waiting = new Map();
  return {
    calls,
    request(path, options = {}) {
      const reply = deferred(), call = {path,options,reply};
      calls.push(call);
      waiting.get(calls.length - 1)?.resolve(call);
      return reply.promise;
    },
    next(index) {
      if (calls[index]) return Promise.resolve(calls[index]);
      const ready = deferred();
      waiting.set(index, ready);
      return ready.promise;
    }
  };
}

test('task save verification rejects a successful response that omitted motion', () => {
  assert.throws(() => verifyTaskModels(withoutMotion(), body), /动作点评模型未保存/);
});

test('task save verification rejects a changed motion model', () => {
  const result = settings();
  result.taskModels.motion = 'chat-model';
  assert.throws(() => verifyTaskModels(result, body), /动作点评模型未保存/);
});

test('task save verification returns the confirmed four-task settings', () => {
  const result = settings();
  assert.equal(verifyTaskModels(result, body), result);
});

test('saving four task models publishes the PUT result and confirms persisted settings', async () => {
  const io = requests(), updates = [];
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value)});
  const saving = client.save(body);
  const put = await io.next(0);
  assert.equal(put.path, '/providers');
  assert.equal(put.options.method, 'PUT');
  assert.deepEqual(put.options.body, body);
  const saved = settings();
  put.reply.resolve(saved);
  const get = await io.next(1);
  assert.equal(get.path, '/providers');
  assert.equal(get.options.method ?? 'GET', 'GET');
  assert.deepEqual(updates, [saved], 'The confirmed PUT must be visible before the extra read finishes');
  const confirmed = settings();
  get.reply.resolve(confirmed);
  await saving;
  assert.deepEqual(updates, [saved,confirmed]);
});

test('a PUT response that lost motion rejects without updating state or confirming success', async () => {
  const io = requests(), updates = [];
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value)});
  const saving = client.save(body);
  const rejected = assert.rejects(saving, /动作点评模型未保存/);
  (await io.next(0)).reply.resolve(withoutMotion());
  await rejected;
  assert.deepEqual(updates, []);
  assert.equal(io.calls.length, 1);
});

test('a failed confirmation read retains the confirmed PUT snapshot instead of old empty motion', async () => {
  const io = requests();
  let state = unconfiguredMotion();
  const client = createProviderSettings({request:io.request,onUpdate:value=>{state=value;}});
  const saving = client.save(body);
  const rejected = assert.rejects(saving, /confirmation read failed/);
  const saved = settings();
  (await io.next(0)).reply.resolve(saved);
  const get = await io.next(1);
  assert.equal(state, saved);
  get.reply.reject(new Error('confirmation read failed'));
  await rejected;
  assert.equal(state.tasks.motion, 'one');
  assert.equal(state.taskModels.motion, 'review-model');
});

test('a confirmation response that lost motion rejects and keeps the PUT snapshot', async () => {
  const io = requests(), updates = [];
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value)});
  const saving = client.save(body);
  const rejected = assert.rejects(saving, /动作点评模型未保存/);
  const saved = settings();
  (await io.next(0)).reply.resolve(saved);
  (await io.next(1)).reply.resolve(withoutMotion());
  await rejected;
  assert.deepEqual(updates, [saved]);
});

test('a delayed pre-save load cannot replace newly saved motion settings', async () => {
  const io = requests(), updates = [];
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value)});
  const loading = client.load();
  const oldGet = await io.next(0);
  const saving = client.save(body);
  (await io.next(1)).reply.resolve(settings());
  (await io.next(2)).reply.resolve(settings());
  await saving;
  oldGet.reply.resolve(unconfiguredMotion());
  await loading;
  assert.equal(updates.length, 2);
  assert.equal(updates.at(-1).taskModels.motion, 'review-model');
});

test('a delayed older load cannot replace a newer load result', async () => {
  const io = requests(), updates = [];
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value)});
  const first = client.load(), second = client.load();
  const fresh = settings();
  (await io.next(1)).reply.resolve(fresh);
  await second;
  (await io.next(0)).reply.resolve(unconfiguredMotion());
  await first;
  assert.deepEqual(updates, [fresh]);
});

test('a load issued by the previous account cannot update the current account', async () => {
  const io = requests(), updates = [];
  let userId = 'alice';
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value),getUserId:()=>userId});
  const loading = client.load();
  userId = 'bob';
  (await io.next(0)).reply.resolve(settings());
  await loading.catch(() => {});
  assert.deepEqual(updates, []);
});

test('switching accounts while a PUT is pending rejects without publishing the other account settings', async () => {
  const io = requests(), updates = [];
  let userId = 'alice';
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value),getUserId:()=>userId});
  const saving = client.save(body);
  const rejected = assert.rejects(saving);
  const put = await io.next(0);
  userId = 'bob';
  put.reply.resolve(settings());
  await rejected;
  assert.deepEqual(updates, []);
});

test('concurrent saves write and confirm in call order so the server and state retain the newer selection', async () => {
  const io = requests();
  let persisted = unconfiguredMotion(), state = persisted;
  const client = createProviderSettings({request:io.request,onUpdate:value=>{state=value;}});
  const next = settings();
  next.taskModels.motion = 'chat-model';
  const first = client.save(body), second = client.save(next);
  const firstPut = await io.next(0);
  assert.equal(io.calls.length, 1, 'The next write must wait for the current write and its confirmation');
  persisted = structuredClone(firstPut.options.body);
  firstPut.reply.resolve(structuredClone(persisted));
  const firstGet = await io.next(1);
  assert.equal(firstGet.options.method ?? 'GET', 'GET');
  assert.equal(io.calls.length, 2);
  firstGet.reply.resolve(structuredClone(persisted));
  await first;
  const secondPut = await io.next(2);
  assert.equal(secondPut.options.method, 'PUT');
  assert.equal(secondPut.options.body.taskModels.motion, 'chat-model');
  persisted = structuredClone(secondPut.options.body);
  secondPut.reply.resolve(structuredClone(persisted));
  (await io.next(3)).reply.resolve(structuredClone(persisted));
  await second;
  assert.equal(persisted.taskModels.motion, 'chat-model');
  assert.equal(state.taskModels.motion, persisted.taskModels.motion);
});

test('a rejected queued write does not block a later save', async () => {
  const io = requests(), updates = [];
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value)});
  const first = client.save(body);
  const rejected = assert.rejects(first, /write failed/);
  const second = client.save(body);
  const firstPut = await io.next(0);
  assert.equal(io.calls.length, 1);
  firstPut.reply.reject(new Error('write failed'));
  await rejected;
  const secondPut = await io.next(1);
  assert.equal(secondPut.options.method, 'PUT');
  secondPut.reply.resolve(settings());
  (await io.next(2)).reply.resolve(settings());
  await second;
  assert.equal(updates.at(-1).taskModels.motion, 'review-model');
});

test('a rejected confirmation does not block a later queued save', async () => {
  const io = requests(), updates = [];
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value)});
  const first = client.save(body);
  const rejected = assert.rejects(first, /read failed/);
  const second = client.save(body);
  (await io.next(0)).reply.resolve(settings());
  const firstGet = await io.next(1);
  assert.equal(firstGet.options.method ?? 'GET', 'GET');
  assert.equal(io.calls.length, 2);
  firstGet.reply.reject(new Error('read failed'));
  await rejected;
  const secondPut = await io.next(2);
  assert.equal(secondPut.options.method, 'PUT');
  secondPut.reply.resolve(settings());
  (await io.next(3)).reply.resolve(settings());
  await second;
  assert.equal(updates.at(-1).taskModels.motion, 'review-model');
});

test('queued writes from the previous account are cancelled before IO and do not block the new account', async () => {
  const io = requests(), updates = [];
  let userId = 'alice';
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value),getUserId:()=>userId});
  const first = client.save(body);
  const firstRejected = assert.rejects(first, /账号已切换/);
  const firstPut = await io.next(0);
  const queued = client.save(body);
  const queuedRejected = assert.rejects(queued, /账号已切换/);
  assert.equal(io.calls.length, 1);
  userId = 'bob';
  firstPut.reply.resolve(settings());
  await Promise.all([firstRejected,queuedRejected]);
  assert.equal(io.calls.length, 1, 'Alice\'s queued write must not be sent with Bob\'s session');
  assert.deepEqual(updates, []);
  const current = client.save(body);
  (await io.next(1)).reply.resolve(settings());
  (await io.next(2)).reply.resolve(settings());
  await current;
  assert.equal(updates.at(-1).taskModels.motion, 'review-model');
});

test('switching accounts during confirmation rejects without updating the new account', async () => {
  const io = requests(), updates = [];
  let userId = 'alice';
  const client = createProviderSettings({request:io.request,onUpdate:value=>updates.push(value),getUserId:()=>userId});
  const saving = client.save(body);
  const rejected = assert.rejects(saving);
  const saved = settings();
  (await io.next(0)).reply.resolve(saved);
  const get = await io.next(1);
  assert.deepEqual(updates, [saved]);
  updates.length = 0;
  userId = 'bob';
  get.reply.resolve(settings());
  await rejected;
  assert.deepEqual(updates, []);
});
