import {consumeChatEvents} from './chat-stream.js?v=9';

export function createId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

let apiUserId = null;
export function setApiUser(userId) { apiUserId = userId || null; }
export async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...(apiUserId && !['/auth/me','/auth/login','/auth/register'].includes(path) ? {'X-Fitness-User':apiUserId} : {}), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || data.message || `请求失败（${response.status}）`); error.status = response.status; throw error; }
  return data;
}

export async function streamChat(body, {userId = apiUserId, signal, onEvent} = {}) {
  const response = await fetch('/api/ai', {
    method:'POST', credentials:'same-origin', signal,
    headers:{'Content-Type':'application/json', 'Accept':'text/event-stream', ...(userId ? {'X-Fitness-User':userId} : {})},
    body:JSON.stringify({...body, task:'chat', stream:true})
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `请求失败（${response.status}）`); error.status = response.status; throw error;
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('服务未启用流式对话，请刷新页面后重试。');
  return consumeChatEvents(response.body, onEvent, signal);
}

export class RecordStore extends EventTarget {
  constructor(user) {
    super(); this.user = { ...user }; this.records = new Map(); this.pending = new Map();
    this.conflicts = []; this.status = 'idle'; this.serial = Promise.resolve();
    this.generation = 0; this.closed = false; this.again = false; this.blocked = new Map();
    this.persistedRecords=new Map();this.cursor=null;
  }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fitness-assistant-v1', 2);
      request.onupgradeneeded = event => {
        if(event.oldVersion<1)request.result.createObjectStore('accounts');
        if(event.oldVersion<2)request.result.createObjectStore('record-cache');
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const saved = await new Promise((resolve, reject) => { const r = this.db.transaction('accounts').objectStore('accounts').get(this.user.id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    if (saved) {
      if(saved.recordIds){
        const tx=this.db.transaction('record-cache');
        const rows=await Promise.all(saved.recordIds.map(id=>new Promise((resolve,reject)=>{const r=tx.objectStore('record-cache').get([this.user.id,id]);r.onsuccess=()=>resolve([id,r.result]);r.onerror=()=>reject(r.error);})));
        this.records=new Map(rows.filter(([,record])=>record));
        this.persistedRecords=new Map(this.records);
      }else this.records=new Map(saved.records||[]);
      this.pending = new Map(saved.pending); this.conflicts = saved.conflicts || [];this.cursor=saved.cursor??null;
      if(!saved.recordIds)await this.persist(); // Atomic v1 migration; no remote writes.
    }
    return this;
  }
  persist() {
    const generation = this.generation;
    const records=new Map(this.records);
    const snapshot = structuredClone({ recordIds: [...records.keys()], pending: [...this.pending], conflicts: this.conflicts, cursor:this.cursor });
    this.serial = this.serial.catch(() => {}).then(() => {
      // A clear() invalidates queued snapshots before its own delete transaction.
      if (generation !== this.generation) return;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['accounts','record-cache'], 'readwrite');
        const cache=tx.objectStore('record-cache');
        for(const [id,record]of records)if(this.persistedRecords.get(id)!==record)cache.put(record,[this.user.id,id]);
        for(const id of this.persistedRecords.keys())if(!records.has(id))cache.delete([this.user.id,id]);
        tx.objectStore('accounts').put(snapshot, this.user.id);
        tx.oncomplete = ()=>{this.persistedRecords=records;resolve();}; tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地记录保存失败。'));
      });
    });
    return this.serial;
  }
  emit() { this.dispatchEvent(new Event('change')); }
  list(kind) { return structuredClone([...this.records.values()].filter(r => r.kind === kind && !r.deleted).sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))); }
  conversationHeaders() {return [...this.records.values()].filter(r=>r.kind==='conversation'&&!r.deleted).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).map(r=>({id:r.id,data:{title:r.data.title}}));}
  get(id) { const record = this.records.get(id); return record && !record.deleted ? structuredClone(record.data) : null; }
  async put(kind, id, data, deleted = false, options = {}) {
    await this.putMany([{kind,id,data,deleted}],options); return id;
  }
  async putMany(entries,{sync=true}={}) {
    if (this.closed) throw new Error('当前账号已退出，请重新登录。');
    if (!entries.length) return [];
    const updatedAt = new Date().toISOString();
    // Prepare all snapshots before changing memory; persist the whole batch once.
    const prepared = entries.map(({kind,id,data,deleted=false})=>{
      const previous=this.records.get(id),queued=this.pending.get(id),value=deleted?null:structuredClone(data);
      return {record:{id,kind,data:value,deleted,version:previous?.version||0,updatedAt},change:{id,kind,data:value,deleted,baseVersion:queued?.baseVersion??previous?.version??0,token:createId()}};
    });
    for(const {record,change} of prepared){this.records.set(record.id,record);this.pending.set(record.id,change);this.blocked.delete(record.id);}
    await this.persist(); this.emit(); if(sync)this.sync().catch(() => {}); return prepared.map(({record})=>record.id);
  }
  remove(id) { const record = this.records.get(id); return record ? this.put(record.kind, id, record.data, true) : Promise.resolve(); }
  hasChanges() { return [...this.pending.keys()].some(id => !this.blocked.has(id) && !this.conflicts.some(x => x.id === id)); }
  async sync() {
    if (this.closed) return;
    if (this.syncing) { this.again = true; return this.syncing; }
    if (!navigator.onLine) { this.status = 'offline'; this.emit(); return; }
    const generation = this.generation;
    // Assign the promise before change listeners can request another sync.
    const task = Promise.resolve().then(async () => {
      do {
        this.again = false;
        if (!await this.runSync(generation)) return;
      } while (!this.closed && generation === this.generation && navigator.onLine && (this.again || this.hasChanges()));
    });
    this.syncing = task;
    try { await task; }
    finally {
      if (this.syncing === task) this.syncing = null;
      // Only newly-created records after clear() need a fresh generation.
      if (!this.closed && generation !== this.generation && this.again && this.hasChanges()) this.sync().catch(() => {});
    }
  }
  async runSync(generation = this.generation) {
    if (this.closed || generation !== this.generation) return false;
    this.status = 'syncing'; this.emit();
    const batch = []; let bytes = 0;
    const controller = new AbortController(); this.abortController = controller;
    try {
      for (const change of this.pending.values()) {
        if (this.conflicts.some(x => x.id === change.id)) continue;
        const limit = change.kind === 'conversation' ? 2 * 1024 * 1024 : 256 * 1024;
        if (new TextEncoder().encode(JSON.stringify(change.data)).byteLength > limit) {
          const error = new Error(change.kind === 'conversation' ? '单个会话已超过 2 MB，请导出保留本机内容并新建会话；此会话尚未同步。' : '单条记录已超过 256 KB，请缩短内容后重试；更改仍保留在本机。');
          error.status = 413; this.blocked.set(change.id, error); continue;
        }
        const size = new TextEncoder().encode(JSON.stringify(change)).byteLength;
        if (batch.length && (batch.length >= 500 || bytes + size > 1500000)) break;
        batch.push(structuredClone(change)); bytes += size;
      }
      if (!batch.length && this.blocked.size) throw this.blocked.values().next().value;
      const result = await api('/sync', {method:'POST', signal:controller.signal, body:{userId:this.user.id, cursor:this.cursor, changes:batch.map(({token,...c}) => c)}});
      if (this.closed || generation !== this.generation) return false;
      if (result.userId !== undefined && result.userId !== this.user.id) {
        const error = new Error('登录账号已改变，请重新登录后同步。'); error.status = 401; throw error;
      }
      if (!Array.isArray(result.records) || !Array.isArray(result.conflicts || [])) throw new Error('服务器返回的同步结果无效，记录仍保留在本机。');
      const remote = new Map(result.records.map(record => [record.id, record]));
      const conflicting = new Set((result.conflicts || []).map(conflict => conflict.id));
      // Missing acknowledgements must never silently delete the offline queue.
      for (const sent of batch) {
        const record = remote.get(sent.id);
        if (!conflicting.has(sent.id) && (!record || !Number.isSafeInteger(record.version) || record.version <= sent.baseVersion)) throw new Error('服务器未确认所有记录，待同步内容仍保留在本机。');
      }
      for (const conflict of result.conflicts || []) {
        if (!this.pending.has(conflict.id)) continue;
        this.conflicts = this.conflicts.filter(x => x.id !== conflict.id); this.conflicts.push(conflict);
      }
      for (const conflict of this.conflicts) if (remote.has(conflict.id)) conflict.server = remote.get(conflict.id);
      for (const sent of batch) {
        if (conflicting.has(sent.id)) continue;
        const latest = this.pending.get(sent.id), server = remote.get(sent.id);
        if (latest?.token === sent.token) this.pending.delete(sent.id);
        else if (latest) {
          latest.baseVersion = server.version;
          const local = this.records.get(sent.id);
          if (local) this.records.set(sent.id,{...local,version:server.version});
        }
      }
      for (const record of result.records) if (!this.pending.has(record.id)) {
        const old=this.records.get(record.id);
        if(!old||old.version!==record.version||old.deleted!==record.deleted)this.records.set(record.id, structuredClone(record));
      }
      if(Number.isSafeInteger(result.cursor)&&result.cursor>=0)this.cursor=result.cursor;
      await this.persist();
      if (this.closed || generation !== this.generation) return false;
      this.lastError = this.blocked.values().next().value?.message || ''; this.status = this.conflicts.length ? 'conflict' : this.blocked.size ? 'error' : 'synced';
      return true;
    } catch (error) {
      if (this.closed || generation !== this.generation) return false;
      this.status = [401, 409].includes(error.status) ? 'expired' : error.status ? 'error' : 'offline'; this.lastError = error.message; throw error;
    } finally {
      if (this.abortController === controller) this.abortController = null;
      if (!this.closed && generation === this.generation) this.emit();
    }
  }
  async resolve(id, useLocal) {
    if (this.closed) return;
    const conflict = this.conflicts.find(c => c.id === id); if (!conflict) return;
    if (useLocal) { const local = this.pending.get(id); if (local) { local.baseVersion = conflict.server?.version ?? 0; local.token = createId(); } }
    else { this.pending.delete(id); if (conflict.server) this.records.set(id, structuredClone(conflict.server)); else this.records.delete(id); }
    this.conflicts = this.conflicts.filter(c => c.id !== id); this.blocked.delete(id); await this.persist(); this.emit(); await this.sync();
  }
  async clear() {
    this.generation++; this.again = false; this.abortController?.abort();
    const ids=new Set([...this.records.keys(),...this.persistedRecords.keys()]);
    this.records.clear(); this.pending.clear(); this.conflicts = []; this.blocked.clear(); this.status = 'idle'; this.lastError = '';this.cursor=null;
    this.serial = this.serial.catch(() => {}).then(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction(['accounts','record-cache'],'readwrite'); tx.objectStore('accounts').delete(this.user.id);
      for(const id of ids)tx.objectStore('record-cache').delete([this.user.id,id]);
      tx.oncomplete = ()=>{this.persistedRecords.clear();resolve();}; tx.onerror = tx.onabort = () => reject(tx.error || new Error('清除本地记录失败。'));
    }));
    await this.serial; this.emit();
  }
  async close() {
    this.closed = true; this.again = false; this.abortController?.abort();
    // Keep already-enqueued writes so logging out does not discard offline work.
    await this.serial; this.db?.close();
  }
}
