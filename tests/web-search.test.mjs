import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server.mjs';
import {openStore} from '../server/storage.mjs';
import {initializeWebSearch,webSearchSettings,saveWebSearchSettings,createWebSession,webTools,publicWebUrl,parseExaSearch} from '../server/web-search.mjs';
import {streamChat} from '../server/chat-stream.mjs';
import {renderWebResult} from '../public/web-search.js';
const settings={provider:'tavily',enabled:true,apiKey:'search-secret-123'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const results={results:[{title:'Official source',url:'https://example.org/source',content:'Verified public snippet'}]};
const provider={baseUrl:'http://127.0.0.1:9998',name:'Mock',model:'mock',apiKey:'model-secret-123'};
const exaResponse={jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'Title: Official source\nURL: https://example.org/source\nPublished: 2026-10-01\nHighlights:\nVerified public snippet\n\n---\n\nTitle: Second source\nURL: https://example.org/second\nPublished: N/A\nText: More facts'}]}};

test('default free Exa searches work without keys and parse JSON and SSE responses',async()=>{
 for(const sse of [false,true]){
  const session=createWebSession({settings:{provider:'exa-mcp',enabled:true,apiKey:''},fetchImpl:async(url,options)=>{
   assert.equal(url,'https://mcp.exa.ai/mcp');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers['X-Subscription-Token'],undefined);
   const request=JSON.parse(options.body);assert.equal(request.method,'tools/call');assert.equal(request.params.name,'web_search_exa');assert.equal(request.params.arguments.numResults,5);assert.match(request.params.arguments.objective,/past week/);
   return sse?new Response(': ping\r\nevent: message\r\ndata: '+JSON.stringify(exaResponse)+'\r\n\r\n',{headers:{'Content-Type':'text/event-stream'}}):json(exaResponse);
  }});
  assert.equal(session.tools.length,2);const output=await session.execute('web_search',{query:'physical activity',timeRange:'week'});
  assert.equal(output.ok,true);assert.equal(output.sources.length,2);assert.equal(output.sources[0].publishedAt,'2026-10-01');assert.match(output.sources[0].snippet,/Verified public snippet/);assert.equal(output.sources[1].publishedAt,undefined);assert.match(output.limitation,/并非严格日期过滤/);
 }
});
test('Exa protocol failures are not passed off as empty successful searches',()=>{
 for(const response of [{jsonrpc:'2.0',id:1,error:{code:-1,message:'rate limited'}},{id:1,result:{isError:true,content:[{type:'text',text:'rate limit'}]}},{id:1,result:{content:[{type:'text',text:'unrecognized reply'}]}},{id:2,result:{}}])assert.throws(()=>parseExaSearch(JSON.stringify(response)));
 assert.deepEqual(parseExaSearch(JSON.stringify({id:1,result:{content:[{type:'text',text:'No results found'}]}})),[]);
});
test('free mode can read a page with an empty API key',async()=>{
 const session=createWebSession({settings:{provider:'exa-mcp',enabled:true,apiKey:''},validateTarget:async()=>({address:{}}),pageFetch:async()=>new Response('Public page',{headers:{'Content-Type':'text/plain'}})});
 assert.equal((await session.execute('read_web_page',{url:'https://example.org'})).ok,true);
});

test('search adapters send only requested query and separate search credentials',async()=>{
 for(const service of ['tavily','brave']){
  const session=createWebSession({settings:{...settings,provider:service},fetchImpl:async(url,options)=>{
   assert.equal(options.redirect,'error');assert.doesNotMatch(JSON.stringify(options),/model-secret/);
   if(service==='tavily'){assert.equal(url,'https://api.tavily.com/search');assert.equal(options.headers.Authorization,'Bearer '+settings.apiKey);const body=JSON.parse(options.body);assert.equal(body.query,'physical activity');assert.equal(body.time_range,'week');assert.equal(body.include_raw_content,false);return json(results);}
   const parsed=new URL(url);assert.equal(parsed.searchParams.get('freshness'),'pw');assert.equal(options.headers['X-Subscription-Token'],settings.apiKey);return json({web:{results:results.results.map(item=>({...item,description:item.content}))}});
  }});
  const result=await session.execute('web_search',{query:'physical activity',timeRange:'week'});
  assert.equal(result.ok,true);assert.equal(result.sources[0].snippet,'Verified public snippet');assert.equal(result.readOnly,true);assert.doesNotMatch(JSON.stringify(result),/search-secret/);
 }
});
test('disabled, invalid arguments, missing results, service errors and call bounds are explicit',async()=>{
 let requests=0;const session=createWebSession({settings,fetchImpl:async()=>{requests++;return json({results:[]});}});
 assert.equal((await session.execute('web_search',{query:''})).code,'INVALID_ARGUMENTS');
 assert.equal((await session.execute('web_search',{query:settings.apiKey})).code,'SENSITIVE_TOOL_ARGUMENT');
 const empty=await session.execute('web_search',{query:'test'});assert.equal(empty.ok,true);assert.deepEqual(empty.sources,[]);
 await session.execute('web_search',{query:'test'});assert.equal((await session.execute('web_search',{query:'test'})).code,'WEB_LIMIT');assert.equal(requests,2);
 const disabled=createWebSession({settings:{...settings,enabled:false},fetchImpl:()=>assert.fail()});assert.deepEqual(disabled.tools,[]);assert.equal((await disabled.execute('web_search',{query:'test'})).code,'WEB_DISABLED');
 for(const status of [401,429,500]){const failed=createWebSession({settings,fetchImpl:async()=>new Response(settings.apiKey,{status})});const output=await failed.execute('web_search',{query:'test'});assert.equal(output.ok,false);assert.doesNotMatch(JSON.stringify(output),/search-secret/);}
 const invalid=createWebSession({settings,fetchImpl:async()=>json({foo:'bar'})});assert.equal((await invalid.execute('web_search',{query:'test'})).ok,false);
});
test('HTML extraction strips scripts, bounds content, handles unsupported files and unsafe URL schemes',async()=>{
 const addresses=[];const session=createWebSession({settings,validateTarget:async(origin,allowPrivate)=>{addresses.push(origin);assert.equal(allowPrivate,false);return {address:{address:'93.184.216.34',family:4}};},pageFetch:async(url,options)=>{
  assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);
  return new Response('<html><title>Source &amp; facts</title><script>secret script</script><main>'+('Evidence '.repeat(2000))+'</main></html>',{headers:{'Content-Type':'text/html'}});
 }});
 const output=await session.execute('read_web_page',{url:'https://example.org/data?query=public#part'});assert.equal(output.ok,true);assert.equal(output.text.length,8000);assert.equal(output.truncated,true);assert.doesNotMatch(output.text,/secret script/);assert.equal(output.title,'Source & facts');assert.deepEqual(addresses,['https://example.org']);
 for(const url of ['file:///etc/passwd','http://user:pass@example.org','javascript:alert(1)','https://example.org:8443/'])assert.throws(()=>publicWebUrl(url));
 const pdf=createWebSession({settings,validateTarget:async()=>({address:{}}),pageFetch:async()=>new Response('pdf',{headers:{'Content-Type':'application/pdf'}})});assert.equal((await pdf.execute('read_web_page',{url:'https://example.org/a.pdf'})).code,'PAGE_TYPE_UNSUPPORTED');
});
test('private addresses and redirect targets are blocked even when local model endpoints are permitted',async()=>{
 let fetched=false;const session=createWebSession({settings,pageFetch:async()=>{fetched=true;assert.fail('must not fetch private URL');}});
 for(const url of ['http://127.0.0.1/','http://10.0.0.1/','http://169.254.169.254/latest/meta-data/','http://[::1]/'])assert.equal((await session.execute('read_web_page',{url})).ok,false);
 assert.equal(fetched,false);
 const checked=[];const redirect=createWebSession({settings,validateTarget:async(origin)=>{checked.push(origin);if(origin.includes('127.0.0.1'))throw new Error('private');return {address:{}};},pageFetch:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/secret'}})});
 assert.equal((await redirect.execute('read_web_page',{url:'https://example.org'})).ok,false);assert.deepEqual(checked,['https://example.org','http://127.0.0.1']);
});
test('response size, timeout and caller cancellation do not continue fetching',async()=>{
 const huge=createWebSession({settings,fetchImpl:async()=>new Response('x'.repeat(512001))});assert.equal((await huge.execute('web_search',{query:'test'})).ok,false);
 const delayed=createWebSession({settings,timeoutMs:10,fetchImpl:(_url,{signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason));})});
 const keepAlive=setTimeout(()=>{},100);try{assert.match((await delayed.execute('web_search',{query:'test'})).message,/超时/);}finally{clearTimeout(keepAlive);}
 const controller=new AbortController();controller.abort();await assert.rejects(()=>delayed.execute('web_search',{query:'test'},{signal:controller.signal}));
});
test('settings are encrypted, versioned, isolated and cleared on provider change or deletion',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fitness-web-settings-')),store=openStore(dir);initializeWebSearch(store.db);
 t.after(async()=>{store.db.close();await rm(dir,{recursive:true,force:true});});
 for(const id of ['alice','bob'])store.db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').run(id,id+'@test.invalid',id,'fixture','2026-10-06');
 assert.deepEqual(webSearchSettings(store,'bob'),{provider:'exa-mcp',enabled:true,hasKey:false,version:0});
 saveWebSearchSettings(store,'bob',{provider:'exa-mcp',enabled:false,version:0});assert.equal(webSearchSettings(store,'bob').enabled,false,'preserve explicit opt-out');
 const saved=saveWebSearchSettings(store,'alice',{...settings,version:0});assert.equal(saved.hasKey,true);assert.equal(saved.apiKey,undefined);
 assert.equal(webSearchSettings(store,'bob').hasKey,false);assert.equal(webSearchSettings(store,'alice',true).apiKey,settings.apiKey);
 assert.notEqual(store.db.prepare('SELECT api_key FROM web_search_settings').get().api_key,settings.apiKey);
 assert.throws(()=>saveWebSearchSettings(store,'alice',{...settings,version:0}),/其他页面/);
 assert.throws(()=>saveWebSearchSettings(store,'alice',{provider:'brave',enabled:true,version:1}),/填写/);
 saveWebSearchSettings(store,'alice',{provider:'brave',enabled:false,version:1});assert.equal(webSearchSettings(store,'alice').hasKey,false);
 saveWebSearchSettings(store,'alice',{provider:'exa-mcp',enabled:true,version:2});assert.equal(webSearchSettings(store,'alice').hasKey,false);assert.equal(webSearchSettings(store,'alice').enabled,true);
 store.db.prepare('DELETE FROM users WHERE id=?').run('alice');assert.equal(store.db.prepare('SELECT count(*) AS n FROM web_search_settings WHERE user_id=?').get('alice').n,0);
});
test('OpenAI, Anthropic and Gemini models can request search and receive snippets; UI retains only sources',async()=>{
 for(const protocol of ['openai','anthropic','gemini']){
  let calls=0;const session=createWebSession({settings,fetchImpl:async()=>json(results)}),events=[];
  const output=await streamChat({provider:{...provider,protocol},messages:[{role:'system',content:session.guide},{role:'user',content:'Search physical activity'}],tools:webTools,executeTool:(...args)=>session.execute(...args),onEvent:async(type,data)=>events.push({type,data}),fetchImpl:async(_url,options)=>{
   const body=JSON.parse(options.body);calls++;assert.doesNotMatch(options.body,/search-secret/);
   if(calls===2)assert.match(options.body,/Verified public snippet/);
   if(protocol==='openai')return json({choices:[{message:calls===1?{role:'assistant',tool_calls:[{id:'search1',type:'function',function:{name:'web_search',arguments:'{"query":"physical activity"}'}}]}:{role:'assistant',content:'Answer [source](https://example.org/source)'},finish_reason:calls===1?'tool_calls':'stop'}]});
   if(protocol==='anthropic')return json({content:calls===1?[{type:'tool_use',id:'search1',name:'web_search',input:{query:'physical activity'}}]:[{type:'text',text:'Answer [source](https://example.org/source)'}],stop_reason:calls===1?'tool_use':'end_turn'});
   assert.ok(body.tools[0].functionDeclarations.some(t=>t.name==='web_search'));return json({candidates:[{content:{role:'model',parts:calls===1?[{functionCall:{name:'web_search',args:{query:'physical activity'}}}]:[{text:'Answer [source](https://example.org/source)'}]},finishReason:'STOP'}]});
  }});
  assert.equal(calls,2);assert.equal(output.toolResults[0].sources[0].url,'https://example.org/source');assert.equal(output.toolResults[0].sources[0].snippet,undefined);assert.ok(events.some(e=>e.type==='tool_start'&&e.data.name==='web_search'));
 }
});
test('source rendering escapes HTML and excludes unsafe links',()=>{
 const html=renderWebResult({ok:true,message:'<img src=x>',sources:[{title:'<script>',url:'https://example.org'},{title:'attack',url:'javascript:alert(1)'}]});assert.doesNotMatch(html,/<img|<script|javascript:/);assert.match(html,/noopener noreferrer/);
});
test('search credentials echoed by an upstream service are removed from model and UI results',async()=>{
 const session=createWebSession({settings,fetchImpl:async()=>json({results:[{title:settings.apiKey,url:'https://example.org',content:'Echo '+settings.apiKey}]})});
 const output=await session.execute('web_search',{query:'test'});assert.equal(output.ok,true);assert.doesNotMatch(JSON.stringify(output),/search-secret/);
});
test('models that reject tools explicitly report that browsing did not run',async()=>{
 let calls=0;const output=await streamChat({provider,messages:[{role:'system',content:'Search if needed.'},{role:'user',content:'Search now.'}],tools:webTools,executeTool:()=>assert.fail(),onEvent:async()=>{},fetchImpl:async(_url,options)=>{
  calls++;if(calls===1)return Response.json({error:'tools not supported'},{status:400});
  assert.equal(JSON.parse(options.body).tools,undefined);assert.match(options.body,/未执行联网/);
  return json({choices:[{message:{content:'此模型不支持联网工具。'},finish_reason:'stop'}]});
 }});assert.equal(calls,2);assert.equal(output.toolResults[0].code,'TOOLS_UNSUPPORTED');assert.match(output.toolResults[0].message,/联网搜索/);
});
test('authenticated HTTP settings, search test, opt-out and nonstream planning work end-to-end',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fitness-web-http-'));let searches=0,hadTools=false;
 const server=await startServer({host:'127.0.0.1',port:0,dataDir:dir,webFetchImpl:async()=>{searches++;return json(results);},fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body);hadTools=!!body.tools?.some(t=>t.function.name==='web_search');
  const searched=body.messages.some(m=>m.role==='tool');
  return json({choices:[{message:hadTools&&!searched?{role:'assistant',content:'I will search.',tool_calls:[{id:'search1',type:'function',function:{name:'web_search',arguments:'{"query":"activity guidelines"}'}}]}:{role:'assistant',content:'{"answer":"verified"}'},finish_reason:hadTools&&!searched?'tool_calls':'stop'}]});
 }});t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/api/web-search')).status,401);
 const register=await request('/api/auth/register','POST',{name:'test',email:'web@example.test',password:'test-password-123'});cookie=register.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/web-search','PUT',{...settings,version:0})).status,200);
 assert.equal((await request('/api/web-search','PUT',{...settings,version:0})).status,409);
 assert.equal((await (await request('/api/web-search')).json()).apiKey,undefined);
 assert.equal((await (await request('/api/web-search/test','POST',{})).json()).ok,true);
 await request('/api/providers','PUT',{providers:[{...provider,id:'mock'}],tasks:{chat:'mock',planning:'mock'}});
 const input={task:'planning',messages:[{role:'user',content:'Search latest guidance. Return JSON.'}]};
 const reply=await (await request('/api/ai','POST',input)).json();assert.equal(reply.content,'{"answer":"verified"}');assert.equal(reply.toolResults[0].name,'web_search');assert.equal(searches,2);
 await request('/api/ai','POST',{...input,context:{webSearch:false}});assert.equal(hadTools,false);assert.equal(searches,2);
 const exported=await (await request('/api/export')).text();assert.doesNotMatch(exported,/search-secret/);
});
