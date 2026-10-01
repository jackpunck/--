import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {createServer} from '../server.mjs';

test('static gzip preserves bytes, validators, HEAD and clients refusing gzip',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'fitness-gzip-')),source='const 中文 = "unchanged";\n'.repeat(200);
  await writeFile(join(dir,'app.js'),source);
  const server=createServer({dataDir:join(dir,'data'),publicDir:dir});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
  const request=(headers={},method='GET')=>new Promise((resolve,reject)=>{
    http.request({hostname:'127.0.0.1',port:server.address().port,path:'/app.js',method,headers},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({headers:response.headers,status:response.statusCode,bytes:Buffer.concat(chunks)}));
    }).on('error',reject).end();
  });
  const zipped=await request({'Accept-Encoding':'br, gzip'});
  assert.equal(zipped.headers['content-encoding'],'gzip');assert.equal(zipped.headers.vary,'Accept-Encoding');
  assert.equal(gunzipSync(zipped.bytes).toString(),source);assert(zipped.bytes.length<Buffer.byteLength(source));
  for(const accept of ['identity','gzip;q=0','gzip;q=0.0, br']){
    const plain=await request({'Accept-Encoding':accept});assert.equal(plain.headers['content-encoding'],undefined);assert.equal(plain.bytes.toString(),source);
  }
  const head=await request({'Accept-Encoding':'gzip'},'HEAD');assert.equal(head.bytes.length,0);assert.equal(head.headers['content-encoding'],'gzip');
  const cached=await request({'Accept-Encoding':'gzip','If-None-Match':zipped.headers.etag});assert.equal(cached.status,304);assert.equal(cached.bytes.length,0);
});
