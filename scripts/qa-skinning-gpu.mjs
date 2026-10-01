import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {build} from '../精细模型与动作开发/node_modules/esbuild/lib/main.js';
const root=resolve(import.meta.dirname,'..');await mkdir(join(root,'.qa'),{recursive:true});
const dir=await mkdtemp(join(root,'.qa','gpu-skinning-'));
await build({entryPoints:[join(root,'精细模型与动作开发/scripts/skinning-gpu-fixture.js')],bundle:true,format:'iife',outfile:join(dir,'test.js')});
const script=await readFile(join(dir,'test.js'));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html');res.end(req.url==='/test.js'?script:'<!doctype html><body><script src="/test.js"></script></body>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tests/node_modules/playwright/index.mjs'))).href);
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.qaResult,{},{timeout:60000});
  const result=await page.evaluate(()=>window.qaResult);await writeFile(join(dir,'result.json'),JSON.stringify({result,errors},null,2));
  assert.deepEqual(errors,[]);assert(!result.error,result.error);console.log(JSON.stringify({dir,...result}));
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
