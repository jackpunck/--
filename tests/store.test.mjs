import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createId, RecordStore } from '../public/store.js';
import {longMotionReport} from './helpers/motion-long-report.mjs';

// Minimal asynchronous IndexedDB adapter: exercises the store's account keys,
// serialized transactions and queue lifecycle without browser dependencies.
function memoryIndexedDB() {
  const tables=new Map();let version=0;
  const database={
    createObjectStore(name){tables.set(name,new Map());},close(){},
    transaction(){
      const tx={error:null};let scheduled=false;
      const done=()=>{if(!scheduled){scheduled=true;queueMicrotask(()=>tx.oncomplete?.());}};
      tx.objectStore=name=>({
        get(key){const request={};queueMicrotask(()=>{request.result=structuredClone(tables.get(name)?.get(JSON.stringify(key)));request.onsuccess?.();});return request;},
        put(value,key){tables.get(name).set(JSON.stringify(key),structuredClone(value));done();},
        delete(key){tables.get(name).delete(JSON.stringify(key));done();}
      });return tx;
    }
  };
  return {open(name,next){const request={};queueMicrotask(()=>{request.result=database;if(next>version){const oldVersion=version;version=next;request.onupgradeneeded?.({oldVersion});}request.onsuccess?.();});return request;}};
}

const originalFetch = globalThis.fetch;
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const indexedDBDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
let online;
beforeEach(() => {
  online = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return online; } } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: memoryIndexedDB() });
  globalThis.fetch = async () => { throw new Error('unexpected network call'); };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
  if (indexedDBDescriptor) Object.defineProperty(globalThis, 'indexedDB', indexedDBDescriptor); else delete globalThis.indexedDB;
});
const open = (id = 'account-a') => new RecordStore({ id }).open();
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const record = (id, data, version, deleted = false, kind = 'note') => ({ id, kind, data, version, deleted, updatedAt: new Date().toISOString() });
function fakeServer(initial = [], userId = 'account-a') {
  const remote = new Map(initial.map(r => [r.id, structuredClone(r)])), calls = [];
  const fetch = async (url, options) => {
    assert.equal(url, '/api/sync');
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(body.userId, userId);
    const conflicts = [];
    for (const change of body.changes) {
      const previous = remote.get(change.id);
      if ((previous?.version ?? 0) !== change.baseVersion) conflicts.push({ id: change.id, server: previous || null });
      else remote.set(change.id, record(change.id, change.deleted ? null : change.data, (previous?.version || 0) + 1, change.deleted, change.kind));
    }
    return json({ userId, records: [...remote.values()], conflicts });
  };
  return { fetch, remote, calls };
}

test('offline data and queues persist separately for each account, with immutable caller snapshots', async () => {
  const a = await open(), b = await open('account-b');
  const data = { count: 1 };
  await a.put('note', 'same-id', data); data.count = 99;
  await b.put('note', 'same-id', { count: 2 });
  a.get('same-id').count = 88;
  a.list('note')[0].data.count = 77;
  const restored = await open();
  assert.deepEqual(restored.get('same-id'), { count: 1 });
  assert.equal(restored.pending.size, 1);
  assert.equal(restored.status, 'idle');
  await a.clear();
  assert.equal((await open()).get('same-id'), null);
  assert.deepEqual((await open('account-b')).get('same-id'), { count: 2 });
});

test('version-one account snapshots migrate atomically without syncing or losing offline changes',async()=>{
  const old=await new Promise(resolve=>{const r=indexedDB.open('fitness-assistant-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts');r.onsuccess=()=>resolve(r.result);});
  const value=record('old',{text:'保留原文'},3);
  await new Promise(resolve=>{const tx=old.transaction('accounts','readwrite');tx.objectStore('accounts').put({records:[['old',value]],pending:[['old',{id:'old',kind:'note',data:value.data,baseVersion:2,token:'old'}]],conflicts:[]},'account-a');tx.oncomplete=resolve;});
  const migrated=await open();assert.equal(migrated.get('old').text,'保留原文');assert.equal(migrated.pending.get('old').baseVersion,2);
  await migrated.close();const reopened=await open();assert.deepEqual(reopened.get('old'),value.data);assert.equal(reopened.records.get('old').version,3);
});

test('streaming drafts persist locally without automatically uploading each partial response',async()=>{
  const store=await open();online=true;const server=fakeServer();globalThis.fetch=server.fetch;
  await store.put('conversation','draft',{messages:[{content:'部分回复'}]},false,{sync:false});
  await Promise.resolve();assert.equal(server.calls.length,0);
  assert.equal((await open()).get('draft').messages[0].content,'部分回复');
  await store.sync();assert.equal(server.calls.length,1);
});

test('one sync promise drains edits made to the same record while its prior request is in flight', async () => {
  const store = await open(); await store.put('note', 'item', { count: 1 });
  const server = fakeServer(), first = deferred(), started = deferred();
  globalThis.fetch = async (url, options) => {
    const response = await server.fetch(url, options);
    if (server.calls.length === 1) { started.resolve(); await first.promise; }
    return response;
  };
  online = true; const syncing = store.sync(); await started.promise;
  await store.put('note', 'item', { count: 2 });
  await store.put('note', 'item', { count: 3 });
  first.resolve(); await syncing;
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[0].changes[0].data.count, 1);
  assert.equal(server.calls[1].changes[0].data.count, 3);
  assert.equal(server.calls[1].changes[0].baseVersion, 1);
  assert.deepEqual(store.get('item'), { count: 3 });
  assert.equal(store.records.get('item').version, 2);
  assert.equal(store.pending.size, 0);
  assert.equal((await open()).pending.size, 0);
});

test('network failures retain pending changes and persisted data; successful retry clears the error', async () => {
  const store = await open(); await store.put('note', 'item', { text: '离线记录' });
  online = true; globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
  await assert.rejects(store.sync(), /network unavailable/);
  assert.equal(store.status, 'offline');
  assert.equal((await open()).pending.size, 1);
  const server = fakeServer(); globalThis.fetch = server.fetch;
  await store.sync();
  assert.equal(store.pending.size, 0); assert.equal(store.status, 'synced'); assert.equal(store.lastError, '');
});

test('conflicts preserve the latest local edit, refresh remote versions, and explicitly keep local', async () => {
  const store = await open();
  store.records.set('item', record('item', { count: 0 }, 1));
  await store.put('note', 'item', { count: 2 });
  const server = fakeServer([record('item', { count: 10 }, 2)]); globalThis.fetch = server.fetch; online = true;
  await store.sync();
  assert.equal(store.status, 'conflict'); assert.deepEqual(store.get('item'), { count: 2 });
  assert.equal(store.pending.size, 1);
  online = false; await store.put('note', 'item', { count: 3 });
  server.remote.set('item', record('item', { count: 11 }, 3));
  online = true; await store.sync();
  assert.equal(store.conflicts[0].server.version, 3);
  await store.resolve('item', true);
  assert.equal(store.conflicts.length, 0); assert.equal(store.pending.size, 0);
  assert.deepEqual(server.remote.get('item').data, { count: 3 });
  assert.equal(server.remote.get('item').version, 4);
});

test('choosing the server discards local conflicts, including remote deletion and nonexistence', async () => {
  const store = await open();
  store.records.set('item', record('item', { count: 0 }, 1));
  await store.put('note', 'item', { count: 2 });
  const server = fakeServer([record('item', null, 2, true)]); globalThis.fetch = server.fetch; online = true;
  await store.sync(); await store.resolve('item', false);
  assert.equal(store.get('item'), null); assert.equal(store.pending.size, 0); assert.equal(store.records.get('item').version, 2);
  online = false; await store.put('note', 'ghost', { count: 1 });
  store.conflicts.push({ id: 'ghost', server: null });
  await store.resolve('ghost', false);
  assert.equal(store.records.has('ghost'), false); assert.equal(store.pending.has('ghost'), false);
});

test('recreating a record during its deletion sync retains the new data and advances the tombstone version', async () => {
  const store = await open(), initial = record('item', { count: 1 }, 1);
  store.records.set('item', initial); await store.remove('item');
  assert.equal(store.get('item'), null);
  const server = fakeServer([initial]), first = deferred(), started = deferred();
  globalThis.fetch = async (url, options) => { const response = await server.fetch(url, options); if (server.calls.length === 1) { started.resolve(); await first.promise; } return response; };
  online = true; const syncing = store.sync(); await started.promise;
  await store.put('note', 'item', { count: 20 });
  first.resolve(); await syncing;
  assert.equal(server.calls[0].changes[0].deleted, true);
  assert.equal(server.calls[1].changes[0].deleted, false);
  assert.equal(server.calls[1].changes[0].baseVersion, 2);
  assert.deepEqual(store.get('item'), { count: 20 }); assert.equal(store.records.get('item').version, 3);
  assert.equal(store.pending.size, 0);
});

test('clear cannot be undone by a late network response and clears only its own account', async () => {
  const store = await open(), other = await open('account-b');
  await store.put('note', 'item', { count: 1 }); await other.put('note', 'item', { count: 2 });
  const reply = deferred(), started = deferred();
  globalThis.fetch = async () => { started.resolve(); return reply.promise; };
  online = true; const syncing = store.sync(); await started.promise;
  await store.clear();
  // Even a transport that ignores AbortSignal must not restore cleared data.
  reply.resolve(json({ userId: 'account-a', records: [record('item', { count: 1 }, 1)], conflicts: [] }));
  await syncing;
  assert.equal(store.records.size, 0); assert.equal(store.pending.size, 0);
  assert.equal((await open()).records.size, 0);
  assert.deepEqual((await open('account-b')).get('item'), { count: 2 });
});

test('closing an account flushes offline work and prevents future uploads or edits', async () => {
  const store = await open();
  const saving = store.put('note', 'item', { count: 1 });
  await store.close(); await saving;
  online = true; await store.sync();
  assert.deepEqual((await open()).get('item'), { count: 1 });
  assert.equal((await open()).pending.size, 1);
  await assert.rejects(store.put('note', 'item', { count: 2 }), /重新登录/);
});

test('a response belonging to another signed-in account never enters the local cache', async () => {
  const store = await open(); await store.put('note', 'item', { count: 1 });
  globalThis.fetch = async (url, options) => {
    assert.equal(JSON.parse(options.body).userId, 'account-a');
    return json({ userId: 'account-b', records: [record('private-b', { private: true }, 1)], conflicts: [] });
  };
  online = true; await assert.rejects(store.sync(), /登录账号已改变/);
  assert.equal(store.status, 'expired'); assert.equal(store.records.has('private-b'), false); assert.equal(store.pending.size, 1);
});

test('a missing acknowledgement retains the offline queue instead of dropping a record', async () => {
  const store = await open(); await store.put('note', 'item', { count: 1 });
  globalThis.fetch = async () => json({ userId: 'account-a', records: [], conflicts: [] });
  online = true; await assert.rejects(store.sync(), /未确认/);
  assert.equal(store.pending.size, 1); assert.equal((await open()).pending.size, 1);
});

test('large offline queues are split into supported batches and fully drained before sync resolves', async () => {
  const store = await open();
  for (let i = 0; i < 501; i++) {
    const id = `item-${i}`, data = { count: i };
    store.records.set(id, record(id, data, 0));
    store.pending.set(id, { id, kind: 'note', data, deleted: false, baseVersion: 0, token: crypto.randomUUID() });
  }
  await store.persist();
  const server = fakeServer(); globalThis.fetch = server.fetch; online = true;
  await store.sync();
  assert.deepEqual(server.calls.map(c => c.changes.length), [500, 1]);
  assert.equal(store.pending.size, 0); assert.equal(server.remote.size, 501);
});

test('LAN HTTP can generate UUIDs using getRandomValues when randomUUID is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
    const first = createId(), second = createId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('oversized conversations remain saved locally and report a size error without claiming offline', async () => {
  const store = await open();
  await store.put('conversation', 'large', { messages: [{ content: '字'.repeat(710000) }] });
  online = true;
  await assert.rejects(store.sync(), /2 MB/);
  assert.equal(store.status, 'error'); assert.equal(store.pending.size, 1);
  assert.equal((await open()).get('large').messages[0].content.length, 710000);
});

test('an oversized conversation does not block other records and can be deleted without sending its old body', async () => {
  const store = await open();
  await store.put('conversation', 'large', { messages: [{ content: '字'.repeat(710000) }] });
  await store.put('note', 'normal', { text: '仍可同步' });
  const server = fakeServer(); globalThis.fetch = server.fetch; online = true;
  await store.sync();
  assert.deepEqual(server.calls[0].changes.map(c => c.id), ['normal']);
  assert.equal(store.status, 'error'); assert.equal(store.pending.size, 1);
  online = false; await store.remove('large'); online = true; await store.sync();
  assert.equal(server.remote.get('large').deleted, true);
  assert.equal(server.calls[1].changes[0].data, null);
  assert.equal(store.pending.size, 0); assert.equal(store.status, 'synced');
});

test('UTF-8 byte limits split multibyte conversations even when the record count is small', async () => {
  const store = await open();
  for (let i = 0; i < 3; i++) await store.put('conversation', `item-${i}`, { content: '字'.repeat(200000) });
  const server = fakeServer(); globalThis.fetch = server.fetch; online = true;
  await store.sync();
  assert.deepEqual(server.calls.map(c => c.changes.length), [2, 1]);
  assert.equal(store.pending.size, 0);
});

test('batch calendar updates persist and sync cycle rules together with task tombstones',async()=>{
  const store=await open();
  await store.putMany([{id:'cycle',kind:'training-cycle',data:{startDate:'2026-09-30'}},{id:'task',kind:'calendar-task',data:{completed:false}},{id:'plan',kind:'plan',data:{name:'saved plan'}}]);
  const restored=await open();assert.ok(restored.get('cycle'));assert.ok(restored.get('task'));assert.equal(restored.pending.size,3);
  await restored.putMany([{id:'cycle',kind:'training-cycle',deleted:true},{id:'task',kind:'calendar-task',deleted:true}]);
  const afterReset=await open();assert.equal(afterReset.get('cycle'),null);assert.equal(afterReset.get('task'),null);assert.equal(afterReset.get('plan').name,'saved plan');
  assert.equal(afterReset.records.get('task').deleted,true);
  const server=fakeServer();globalThis.fetch=server.fetch;online=true;await afterReset.sync();
  assert.equal(server.remote.get('cycle').deleted,true);assert.equal(server.remote.get('task').deleted,true);assert.equal(server.remote.get('plan').data.name,'saved plan');
});


test('large motion assessments sync intact while reports over 1 MiB remain locally available with an explicit error',async()=>{
 const {report}=longMotionReport();assert.ok(new TextEncoder().encode(JSON.stringify(report)).byteLength>256*1024);
 const store=await open();await store.put('motion-assessment','motion:long',report);
 const server=fakeServer();globalThis.fetch=server.fetch;online=true;await store.sync();
 assert.equal(store.pending.size,0);assert.equal(store.status,'synced');assert.deepEqual(server.remote.get('motion:long').data,report);
 assert.deepEqual((await open()).get('motion:long'),report);
 online=false;const oversized={...report,extra:'a'.repeat(1024*1024)};await store.put('motion-assessment','motion:too-big',oversized);
 online=true;await assert.rejects(store.sync(),/1 MB/);assert.equal(store.status,'error');assert.equal(store.pending.size,1);assert.deepEqual((await open()).get('motion:too-big'),oversized);assert.ok(!server.remote.has('motion:too-big'));
});
