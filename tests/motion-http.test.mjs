import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../server.mjs';

test('pose resources use executable MIME and constrained worker/WASM policy; reports stay account-scoped',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'fitness-motion-'));
 const server=await startServer({host:'127.0.0.1',port:0,dataDir});
 t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});await rm(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const [path,type]of [['/vendor/mediapipe/wasm/vision_wasm_internal.wasm','application/wasm'],['/vendor/mediapipe/pose_landmarker_full.task','application/octet-stream'],['/motion-worker.js','text/javascript; charset=utf-8'],['/motion-decode.js','text/javascript; charset=utf-8'],['/vendor/mp4box/mp4box.all.mjs','text/javascript; charset=utf-8']]){
  const response=await fetch(base+path,{method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type);
  const policy=response.headers.get('content-security-policy');assert(policy.includes("'wasm-unsafe-eval'"));assert(!policy.includes("'unsafe-eval'"));assert(policy.includes("worker-src 'self'"));assert(policy.includes("media-src 'self' blob:"));
 }
 const api=async(path,data,cookie)=>{const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});return{status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 const alice=await api('/api/auth/register',{name:'Alice',email:'motion-alice@example.test',password:'motion-test-password'});
 const bob=await api('/api/auth/register',{name:'Bob',email:'motion-bob@example.test',password:'motion-test-password'});
 const report={version:'motion-rules-1.0.0',createdAt:new Date().toISOString(),exerciseId:'squat',status:'complete',score:78,reps:[{index:1,start:0,bottom:1,end:2,score:78}],summary:'本机姿态规则评估'};
 const change={id:'motion:sample',kind:'motion-assessment',baseVersion:0,data:report};
 const saved=await api('/api/sync',{userId:alice.body.user.id,changes:[change]},alice.cookie);assert.equal(saved.status,200);assert.deepEqual(saved.body.records.find(r=>r.id===change.id).data,report);
 const other=await api('/api/state',null,bob.cookie);assert(!other.body.records.some(r=>r.kind==='motion-assessment'));
 assert(!saved.body.records.some(r=>['calendar-task','schedule'].includes(r.kind)),'Saving an assessment cannot complete a training');
 const deleted=await api('/api/sync',{userId:alice.body.user.id,changes:[{...change,baseVersion:1,deleted:true,data:null}]},alice.cookie);assert.equal(deleted.status,200);assert.equal(deleted.body.records.find(r=>r.id===change.id).data,null);
});
