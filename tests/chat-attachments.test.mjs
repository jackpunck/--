import test from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentManager, filesFromTransfer, normalizeChatFile } from '../public/chat-attachments.js';

const file = (name = '训练记录.txt', type = 'text/plain', text = '训练记录', lastModified = 1) => new File([text], name, {type,lastModified});
const deferred = () => { let resolve,reject; const promise = new Promise((yes,no) => { resolve=yes;reject=no; }); return {promise,resolve,reject}; };
const saved = name => ({id:'remote-'+name,name,type:'text/plain',size:12,url:'/api/attachments/remote-'+name});

test('paste reads actual event files once, keeps text-only paste native, and never reads clipboard HTML or paths', () => {
  const png = file('截图.png','image/png');
  const transfer = {items:[{kind:'string',getAsFile:()=>null},{kind:'file',getAsFile:()=>png}],files:[png],getData(){throw new Error('unrelated clipboard data accessed');}};
  assert.deepEqual(filesFromTransfer(transfer),[png]);
  assert.deepEqual(filesFromTransfer({files:[png]}),[png]);
  assert.deepEqual(filesFromTransfer({items:[{kind:'string'}],files:[]}),[]);
  assert.deepEqual(filesFromTransfer({items:[{kind:'file',webkitGetAsEntry:()=>({isDirectory:true}),getAsFile:()=>png}]}),[]);
  assert.deepEqual(filesFromTransfer({items:[{kind:'file',webkitGetAsEntry:()=>({isDirectory:true}),getAsFile:()=>png}],files:[png]}),[]);
});

test('attachment normalization infers supported MIME but rejects executable markup, empty and oversized input', () => {
  assert.equal(normalizeChatFile(file('说明.md','')).type,'text/markdown');
  assert.equal(normalizeChatFile(file('报告.pdf','application/octet-stream')).type,'application/pdf');
  assert.equal(normalizeChatFile(file('folder/截图.png','image/png')).name,'截图.png');
  assert.equal(normalizeChatFile(file('','image/png')).name,'粘贴图片.png');
  for (const f of [file('x.svg','image/svg+xml'),file('x.html','text/html'),file('empty.txt','text/plain',''),file('x.txt','text/plain','a'.repeat(8*1024*1024+1))]) assert.throws(()=>normalizeChatFile(f));
  assert.throws(()=>normalizeChatFile('C:\\private\\file.txt'));
});

test('uploads are scoped to drafts, deduplicated, bounded and cannot send before completion', async () => {
  const pending = [], changed=[];
  const manager = new AttachmentManager({upload:(f,options)=>{const request=deferred();pending.push({...request,f,options});return request.promise;},onChange:key=>changed.push(key)});
  const a=file('a.txt'),b=file('b.txt');
  assert.equal(manager.add('user-a:draft-a',[a,a,b]).added.length,2);
  assert.equal(manager.add('user-a:draft-b',[a]).added.length,1);
  assert.throws(()=>manager.ready('user-a:draft-a'),/正在上传/);
  const extras=manager.add('user-a:draft-a',Array.from({length:6},(_,i)=>file(`file-${i}.txt`)));
  assert.equal(manager.list('user-a:draft-a').length,6);assert.equal(extras.errors.length,1);
  await Promise.resolve();
  for(const [i,request] of pending.entries()) request.resolve(saved(String(i)));
  await manager.whenIdle();
  assert.equal(manager.ready('user-a:draft-a').length,6);
  assert.equal(manager.ready('user-a:draft-b').length,1);
  assert.equal(manager.takeReady('user-a:draft-a').length,6);
  assert.equal(manager.list('user-a:draft-a').length,0);
  assert.equal(manager.list('user-a:draft-b').length,1);
  assert(changed.includes('user-a:draft-b'));
  await manager.clearAll();
});

test('failed uploads retain the file for retry and never enter sent attachments', async () => {
  let attempts=0;
  const manager = new AttachmentManager({upload:async f=>{if(++attempts===1)throw new Error('网络失败');return saved(f.name);}});
  const {added:[entry]}=manager.add('user:one',[file()]);
  await manager.whenIdle();
  assert.equal(manager.list('user:one')[0].status,'error');assert.throws(()=>manager.takeReady('user:one'),/重试或移除/);
  assert.equal(manager.retry('user:other',entry.id),false);
  assert.equal(manager.retry('user:one',entry.id),true);
  await manager.whenIdle();
  assert.equal(manager.list('user:one')[0].status,'ready');assert.equal(manager.takeReady('user:one').length,1);
});

test('remove/logout aborts in-flight uploads and cleans late server results using the original owner', async () => {
  const waits=[],removed=[];
  const manager=new AttachmentManager({upload:(f,{signal,ownerKey})=>{const wait=deferred();waits.push({...wait,signal,ownerKey});return wait.promise;},removeRemote:async (attachment,{ownerKey})=>{removed.push({attachment,ownerKey});}});
  const {added:[first]}=manager.add('alice:one',[file('a.txt')]);
  manager.add('bob:two',[file('b.txt')]);await Promise.resolve();
  await manager.remove('alice:one',first.id);
  assert.equal(waits[0].signal.aborted,true);assert.equal(waits[1].signal.aborted,false);
  waits[0].resolve(saved('late-alice'));waits[1].resolve(saved('bob'));await manager.whenIdle();
  assert.deepEqual(manager.list('alice:one'),[]);assert.equal(manager.ready('bob:two')[0].name,'bob');
  assert.equal(removed[0].ownerKey,'alice:one');assert.equal(removed[0].attachment.name,'late-alice');
  await manager.clearAll({removeUploaded:true});assert.equal(removed[1].ownerKey,'bob:two');
});

test('object URLs are revoked on removal/commit and restored references survive draft removal', async () => {
  const previousCreate=URL.createObjectURL,previousRevoke=URL.revokeObjectURL,revoked=[],removed=[];
  URL.createObjectURL=()=> 'blob:qa-preview';URL.revokeObjectURL=url=>revoked.push(url);
  try {
    const manager=new AttachmentManager({upload:async f=>({...saved(f.name),type:f.type}),removeRemote:async attachment=>removed.push(attachment.id)});
    const {added:[entry]}=manager.add('u:d',[file('image.png','image/png')]);
    assert.equal(entry.previewUrl,'blob:qa-preview');await manager.whenIdle();
    const attachments=manager.takeReady('u:d');assert.deepEqual(revoked,['blob:qa-preview']);assert.deepEqual(removed,[]);
    manager.seed('u:new',attachments);await manager.remove('u:new',manager.list('u:new')[0].id);assert.deepEqual(removed,[]);
  } finally { URL.createObjectURL=previousCreate;URL.revokeObjectURL=previousRevoke; }
});
