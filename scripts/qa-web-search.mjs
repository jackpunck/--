import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';
await mkdir('.qa',{recursive:true});
const {chromium}=await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT||'.qa/browser-tools/node_modules/playwright/index.mjs')));
let searches=0,failSearch=false;
const server=await startServer({host:'127.0.0.1',port:0,dataDir:await mkdtemp(join(process.cwd(),'.qa','web-search-')),
 webFetchImpl:async(url,options)=>{searches++;assert.equal(options.headers.Authorization,undefined);assert.equal(url,'https://mcp.exa.ai/mcp');return failSearch?new Response('',{status:429}):Response.json({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'Title: WHO · Physical activity\nURL: https://www.who.int/news-room/fact-sheets/detail/physical-activity\nHighlights:\nA mock official source for browser testing.'}]}});},
 fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body),searched=body.messages.some(m=>m.role==='tool'&&JSON.parse(m.content).name==='web_search'),enabled=body.tools?.some(t=>t.function.name==='web_search');
  const message=enabled&&!searched?{role:'assistant',tool_calls:[{id:'search-call',type:'function',function:{name:'web_search',arguments:JSON.stringify({query:'WHO physical activity guidelines'})}}]}:{role:'assistant',content:enabled?(failSearch?'搜索服务受限，未能核实最新资料。':'已查阅搜索结果：[WHO 活动指南](https://www.who.int/news-room/fact-sheets/detail/physical-activity)。'):'当前联网功能未开启。'};
  return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]});
 }});
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const base=`http://127.0.0.1:${server.address().port}`;
try{
 const context=await browser.newContext({viewport:{width:1366,height:950}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const registration=await context.request.post(base+'/api/auth/register',{data:{name:'联网验证',email:`web-${Date.now()}@example.test`,password:'test-password-123'}}),{user}=await registration.json();
 await context.request.post(base+'/api/sync',{data:{userId:user.id,changes:[{id:'profile',kind:'profile',baseVersion:0,data:{age:30,sex:'male',height:175,weight:70,goal:'maintain'}}]}});
 await context.request.put(base+'/api/providers',{data:{providers:[{id:'qa',name:'QA model',model:'qa-model',baseUrl:'http://127.0.0.1:9998',apiKey:'model-key'}],tasks:{chat:'qa'}}});
 await page.goto(base);await page.locator('.nav [data-page="settings"]').click();await page.locator('[data-action="settings-tab"][data-tab="ai"]').click();
 await page.locator('#web-search-provider').waitFor();assert.equal(await page.locator('#web-search-provider').inputValue(),'exa-mcp');assert.equal(await page.locator('#web-search-key').isVisible(),false);assert.equal(await page.locator('[data-web-clear]').isVisible(),false);assert.equal(await page.locator('#web-search-form input[name="enabled"]').isChecked(),true);
 await page.locator('[data-action="test-web-search"]').click();await page.locator('#web-search-status a').waitFor();assert.equal(searches,1,'fresh account searches before saving any configuration');
 await page.locator('#web-search-provider').selectOption('tavily');assert.equal(await page.locator('#web-search-key').isVisible(),true);await page.locator('#web-search-provider').selectOption('exa-mcp');assert.equal(await page.locator('#web-search-key').isVisible(),false);
 await page.locator('#web-search-form button[type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('#web-search-form')?.dataset.version==='1');
 assert.equal(await page.locator('#web-search-key').inputValue(),'');
 assert.equal(searches,1);
 await page.locator('#web-search-settings').scrollIntoViewIfNeeded();await page.screenshot({path:'.qa/web-search-settings.png',fullPage:true});
 await page.locator('.nav [data-page="chat"]').click();await page.locator('#chat-input').fill('请联网搜索 WHO 最新运动指南');await page.locator('#chat-input').press('Enter');
 await page.locator('.message .web-search-result a').waitFor();await page.waitForFunction(()=>!document.querySelector('.stream-status'));
 assert.equal(searches,2);assert.equal(await page.locator('.message .web-search-result a').getAttribute('rel'),'noopener noreferrer');
 await page.reload();await page.locator('#history-list [data-action="open-chat"]').first().click();await page.locator('.message .web-search-result a').waitFor();assert.equal(searches,2,'reload retains source cards without searching again');
 await page.screenshot({path:'.qa/web-search-chat.png',fullPage:true});
 failSearch=true;await page.locator('#chat-input').fill('再联网核实一次');await page.locator('#chat-input').press('Enter');await page.waitForFunction(()=>[...document.querySelectorAll('.web-search-result')].some(e=>e.textContent.includes('频率受限')));await page.waitForFunction(()=>!document.querySelector('.stream-status'));
 const before=searches;await page.locator('.nav [data-page="settings"]').click();await page.locator('[data-action="settings-tab"][data-tab="ai"]').click();await page.locator('#web-search-form input[name="enabled"]').uncheck();await page.locator('#web-search-form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#web-search-form')?.dataset.version==='2');
 await page.locator('.nav [data-page="chat"]').click();await page.locator('#chat-input').fill('请联网搜索');await page.locator('#chat-input').press('Enter');await page.waitForFunction(()=>document.body.textContent.includes('当前联网功能未开启。'));await page.waitForFunction(()=>!document.querySelector('.stream-status'));assert.equal(searches,before);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.qa/web-search-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.deepEqual(errors,[]);await writeFile('.qa/web-search-browser.json',JSON.stringify({searches,errors,passed:true},null,2));
 console.log('PASS: settings save/test; model search; clickable sources persist; failures are honest; disabling blocks search; mobile layout.',{searches,errors});
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
