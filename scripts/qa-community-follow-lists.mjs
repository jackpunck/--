// Real local Edge acceptance. Uses fresh accounts/SQLite; never opens production data.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const candidates=[process.env.QA_PLAYWRIGHT,join(root,'.qa/community-tools/node_modules/playwright/index.mjs'),join(root,'精细模型与动作开发/node_modules/playwright/index.mjs')].filter(Boolean);
const playwrightPath=candidates.find(path=>existsSync(path));
if(!playwrightPath)throw new Error('请设置 QA_PLAYWRIGHT 为已有 Playwright/index.mjs 的路径。');
const {chromium}=await import(pathToFileURL(resolve(playwrightPath)).href);
await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','community-follow-lists-'));
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const base=`http://127.0.0.1:${server.address().port}`;
const contexts=[],checks=[],errors=[],geometry=[],writes=[],held=[];
let browser,page,step='setup';
const json=(name,value)=>writeFile(join(dataDir,name+'.json'),JSON.stringify(value,null,2));
const mark=label=>{step=label;console.log(label);};
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};
const normalize=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const api=async(context,path,method='GET',body)=>{
 const response=await context.request.fetch(base+'/api'+path,{method,...(body===undefined?{}:{data:body})});
 const value=await response.json();assert(response.ok(),`${method} ${path}: ${response.status()} ${JSON.stringify(value)}`);return value;
};
const community=(context,path,method='GET',body)=>api(context,'/community'+path,method,body);
const newContext=async()=>{const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}});contexts.push(context);return context;};
const register=async(context,slug,nickname)=>{
 const {user}=await api(context,'/auth/register','POST',{email:`follow-lists-${slug}@example.test`,password:'isolated-follow-list-qa-password',name:nickname});
 await api(context,'/sync','POST',{userId:user.id,changes:[{id:'profile',kind:'profile',baseVersion:0,data:{age:25,height:172,weight:68,sex:'male',goal:'maintain',activity:1.375}}]});
 const {profile}=await community(context,'/me/profile','PATCH',{nickname});return{...user,...profile};
};
const seedPagination=owner=>{
 // Only this generated directory is opened. Seeded users cannot sign in; the
 // three interactive users and their relationship mutations use the HTTP API.
 const db=new DatabaseSync(join(dataDir,'fitness.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  const insertUser=db.prepare('INSERT INTO users(id,name,email,password,created_at) VALUES(?,?,?,?,?)');
  const insertProfile=db.prepare('INSERT INTO community_profiles(user_id,nickname,bio,updated_at) VALUES(?,?,?,?)');
  const insertAccount=db.prepare('INSERT INTO community_accounts(user_id,account_number) VALUES(?,?)');
  const insertFollow=db.prepare('INSERT INTO community_follows(user_id,target_user_id,created_at) VALUES(?,?,?)');
  const seeded=[];
  for(let index=0;index<24;index++){
   const id=`qa-follow-page-${String(index).padStart(2,'0')}`,nickname=`分页成员${String(index).padStart(2,'0')}`+(index===23?'长'.repeat(14):''),at=new Date(Date.UTC(2020,0,1,0,0,index)).toISOString();
   insertUser.run(id,nickname,`follow-page-${index}@example.test`,'QA seeded account: no usable password',at);
   insertProfile.run(id,nickname,index===23?'验证简介文本'.repeat(20):'隔离分页种子',at);
   insertAccount.run(id,String(8800000000+index));
   insertFollow.run(owner.id,id,at);insertFollow.run(id,owner.id,at);seeded.push({id,nickname,accountNumber:String(8800000000+index)});
  }
  db.exec('COMMIT');return seeded;
 }catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
};
const route=hash=>page.evaluate(hash=>{location.hash=hash;},hash);
const shot=name=>page.screenshot({path:join(dataDir,name+'.png'),fullPage:true,style:'#toasts{visibility:hidden}'});
const responseFor=(path,method='GET')=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/community'+path&&response.request().method()===method);
const successful=async promise=>{const response=await promise,body=await response.json();assert(response.ok(),JSON.stringify(body));return body;};

const dialog=()=>page.locator('.cm-follow-dialog[open]');
const rows=()=>dialog().locator('.cm-follow-row');
const row=id=>dialog().locator(`.cm-follow-row[data-user-id="${id}"]`);
const action=name=>dialog().locator(`[data-cm="${name}"]`);
const search=()=>dialog().locator('#cm-follow-list-search');
const stat=(tab,id)=>page.locator(`[data-cm="profile-follow-list"][data-tab="${tab}"][data-id="${id}"]`);
const listResponse=(id,tab,q='')=>page.waitForResponse(response=>{
 const url=new URL(response.url());return url.pathname===`/api/community/users/${id}/${tab}`&&response.request().method()==='GET'&&(url.searchParams.get('q')||'')===normalize(q);
});
const expectIds=async wanted=>{
 await page.waitForFunction(({ids})=>{
  const actual=[...document.querySelectorAll('.cm-follow-dialog[open] .cm-follow-row')].map(node=>node.dataset.userId).sort();
  return JSON.stringify(actual)===JSON.stringify([...ids].sort());
 },{ids:wanted});
 assert.deepEqual((await rows().evaluateAll(nodes=>nodes.map(node=>node.dataset.userId))).sort(),[...wanted].sort());
};
const expectCount=async count=>{
 await page.waitForFunction(count=>document.querySelectorAll('.cm-follow-dialog[open] .cm-follow-row').length===count,count);
};
const close=async(keyboard=false)=>{
 if(await dialog().count()) {if(keyboard)await page.keyboard.press('Escape');else await action('aux-close').click();}
 await dialog().waitFor({state:'hidden'});
};
const profile=async user=>{
 await close();await route('#community/user/'+user.id);
 await page.locator('.cm-profile-copy h1').filter({hasText:user.nickname}).waitFor();
 await stat('following',user.id).waitFor();
};
const ownProfile=async owner=>{
 await close();await route('#settings');await page.locator('.cm-profile-copy h1').filter({hasText:owner.nickname}).waitFor();
 await stat('following',owner.id).waitFor();
};
const open=async(user,tab='following',keyboard=false)=>{
 await close();const pending=listResponse(user.id,tab),button=stat(tab,user.id);
 if(keyboard){await button.focus();await page.keyboard.press('Enter');}else await button.click();
 const result=await successful(pending);await dialog().waitFor();await expectCount(result.items.length);
 assert.equal(await dialog().getAttribute('data-user-id'),user.id);assert.equal(await dialog().getAttribute('data-tab'),tab);
 return result;
};
const switchTab=async(user,tab)=>{
 const pending=listResponse(user.id,tab,await dialog().getAttribute('data-query'));await dialog().locator(`[data-cm="follow-list-tab"][data-tab="${tab}"]`).click();
 const result=await successful(pending);await expectCount(result.items.length);return result;
};
const filter=async(user,tab,q,ids,submit=true)=>{
 if(await dialog().getAttribute('data-query')===normalize(q)&&await dialog().locator('.cm-follow-panel').getAttribute('aria-busy')==='false'&&!await dialog().locator('[role="alert"]').count()){
  await search().fill(q);if(submit)await search().press('Enter');if(ids)await expectIds(ids);return;
 }
 const pending=listResponse(user.id,tab,q);await search().fill(q);if(submit)await search().press('Enter');
 const result=await successful(pending);await expectIds(ids||result.items.map(item=>item.id));assert.equal(await dialog().getAttribute('data-query'),normalize(q));
 return result;
};
const follow=async(user,active)=>{
 const pending=responseFor(`/users/${user.id}/follow`,'PUT');await row(user.id).locator('[data-cm="follow"]').click();
 const result=await successful(pending);assert.equal(result.followed,active);return result;
};
const expectRelationship=async(user,active,label)=>{
 const button=row(user.id).locator('[data-cm="follow"]');await button.waitFor();
 await page.waitForFunction(({id,active})=>document.querySelector(`.cm-follow-dialog[open] .cm-follow-row[data-user-id="${id}"] [data-cm="follow"]`)?.getAttribute('data-active')===String(!active),{id:user.id,active});
 assert.equal(await button.getAttribute('aria-pressed'),String(active));assert((await button.textContent()).includes(label),`Expected ${label} for ${user.nickname}`);
};
const expectFollowingCount=async count=>{
 await page.waitForFunction(count=>document.querySelector('[data-profile-stat="followingCount"]')?.textContent===String(count),count);
};
const holdResponse=async(path,q='')=>{
 const seen=deferred(),gate=deferred(),finished=deferred(),pattern=`**/api/community${path}*`;
 let intercepted=false,released=false,routeError;
 const handler=async interceptedRoute=>{
  const url=new URL(interceptedRoute.request().url());
  if(intercepted||url.pathname!=='/api/community'+path||(url.searchParams.get('q')||'')!==normalize(q)){await interceptedRoute.continue();return;}
  intercepted=true;
  try {
   const response=await interceptedRoute.fetch(),body=await response.json();seen.resolve(body);await gate.promise;
   try{await interceptedRoute.fulfill({response,body:JSON.stringify(body)});}catch(error){
    if(!/Target page, context or browser has been closed|Request.*(?:aborted|cancelled|canceled)|Invalid InterceptionId|already handled/i.test(error.message))throw error;
   }
  }catch(error){routeError=error;seen.reject(error);}finally{finished.resolve();}
 };
 await page.route(pattern,handler);
 const release=async()=>{if(released)return;released=true;gate.resolve();if(intercepted)await finished.promise;await page.unroute(pattern,handler);if(routeError)throw routeError;};
 held.push(release);return{seen:seen.promise,release};
};
const holdList=(user,tab,q='')=>holdResponse(`/users/${user.id}/${tab}`,q);
const measureDialog=async label=>{
 const value=await page.evaluate(()=>{
  const dlg=document.querySelector('.cm-follow-dialog[open]'),rect=node=>node?.getBoundingClientRect().toJSON(),input=dlg?.querySelector('#cm-follow-list-search');
  const targets=[...(dlg?.querySelectorAll('button,a[data-cm="follow-list-user"]')||[])].filter(node=>!node.disabled&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
  return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,dialog:rect(dlg),input:rect(input),content:dlg&&{client:dlg.clientWidth,scroll:dlg.scrollWidth},targets:targets.map(node=>({...rect(node),action:node.dataset.cm||node.textContent.trim().slice(0,20)}))};
 });
 assert(value.documentWidth<=value.width+1,`${label}: document fits`);
 assert(value.dialog&&value.dialog.left>=-1&&value.dialog.right<=value.width+1&&value.dialog.top>=-1&&value.dialog.bottom<=value.height+1,`${label}: dialog fits`);
 assert(value.content.scroll<=value.content.client+1,`${label}: dialog content fits`);
 assert(value.input.width>=44&&value.input.height>=43.5,`${label}: search usable`);
 for(const target of value.targets)assert(target.width>=43.5&&target.height>=43.5,`${label}: ${target.action} has 44px hit area`);
 geometry.push({label,...value});return value;
};
const measureCategories=async label=>{
 await close();await route('#community');await page.locator('.cm-channels').waitFor();
 const value=await page.evaluate(()=>{
  const nav=document.querySelector('.cm-channels'),rect=nav.getBoundingClientRect(),items=[...nav.querySelectorAll('a')].map(node=>node.getBoundingClientRect()),left=Math.min(...items.map(item=>item.left)),right=Math.max(...items.map(item=>item.right));
  return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,nav:rect.toJSON(),client:nav.clientWidth,scroll:nav.scrollWidth,group:{left,right,width:right-left,center:(left+right)/2},targets:items.map(item=>item.toJSON())};
 });
 assert(value.documentWidth<=value.width+1,`${label}: categories do not overflow page`);
 if(value.group.width<=value.client)assert(Math.abs(value.group.center-(value.nav.left+value.nav.right)/2)<=2,`${label}: categories centered`);
 for(const target of value.targets)assert(target.width>=43.5&&target.height>=43.5,`${label}: category hit area`);
 geometry.push({label,...value});return value;
};
const visitCategoryEnds=async()=>{
 const nav=page.locator('.cm-channels');await nav.evaluate(node=>{node.scrollLeft=node.scrollWidth;});
 await nav.getByText('提问',{exact:true}).click();
 await page.waitForFunction(()=>{
  const nav=document.querySelector('.cm-channels'),active=nav?.querySelector('a.active');if(active?.textContent!=='提问')return false;
  const bounds=nav.getBoundingClientRect(),item=active.getBoundingClientRect();return item.left>=bounds.left-1&&item.right<=bounds.right+1;
 });
 await shot('categories-question-'+page.viewportSize().width);
 await nav.evaluate(node=>{node.scrollLeft=0;});await nav.getByText('全部',{exact:true}).click();
 await page.waitForFunction(()=>{
  const nav=document.querySelector('.cm-channels'),active=nav?.querySelector('a.active');if(active?.textContent!=='全部')return false;
  const bounds=nav.getBoundingClientRect(),item=active.getBoundingClientRect();return item.left>=bounds.left-1&&item.right<=bounds.right+1;
 });
};

try {
 mark('isolated-account-and-pagination-setup');
 browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const ownerContext=await newContext(),bobContext=await newContext(),carolContext=await newContext();
 const owner=await register(ownerContext,'owner','关系验收本人'),bob=await register(bobContext,'bob','Bob互关对象'),carol=await register(carolContext,'carol','Carol回关对象');
 await community(ownerContext,`/users/${bob.id}/follow`,'PUT',{active:true});
 await community(bobContext,`/users/${owner.id}/follow`,'PUT',{active:true});
 await community(bobContext,`/users/${carol.id}/follow`,'PUT',{active:true});
 await community(carolContext,`/users/${owner.id}/follow`,'PUT',{active:true});
 const seeded=seedPagination(owner),followingIds=[bob.id,...seeded.map(user=>user.id)],followerIds=[bob.id,carol.id,...seeded.map(user=>user.id)];
 assert.equal((await community(ownerContext,`/users/${owner.id}/following?limit=50`)).items.length,25);
 assert.equal((await community(ownerContext,`/users/${owner.id}/followers?limit=50`)).items.length,26);
 page=await ownerContext.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(/\/api\/community\/users\/[^/]+\/follow$/.test(path)&&request.method()!=='GET')writes.push({path,method:request.method(),body:request.postDataJSON()});});
 await page.goto(base+'/#settings');await ownProfile(owner);

 mark('keyboard-stats-dialog-focus-and-pagination');
 await expectFollowingCount(25);const first=await open(owner,'following',true);
 assert.equal(first.items.length,20);assert.equal(first.hasMore,true);await expectRelationship(bob,true,'互');
 let pending=listResponse(owner.id,'followers');await dialog().locator('[data-cm="follow-list-tab"][data-tab="following"]').focus();await page.keyboard.press('End');await successful(pending);await expectCount(20);
 assert.equal(await dialog().locator('[data-cm="follow-list-tab"][aria-selected="true"]').getAttribute('data-tab'),'followers');
 pending=listResponse(owner.id,'following');await page.keyboard.press('Home');await successful(pending);await expectCount(20);
 assert(await dialog().locator('[data-cm="follow-list-tab"][data-tab="following"]').evaluate(node=>document.activeElement===node),'Keyboard tab selection retains focus');
 await measureDialog('desktop-following');await shot('desktop-following');
 const snapshotDb=new DatabaseSync(join(dataDir,'fitness.sqlite'));
 try{assert(snapshotDb.prepare('UPDATE community_snapshots SET expires_at=0 WHERE user_id=?').run(owner.id).changes>0,'Only isolated QA snapshots expire');}finally{snapshotDb.close();}
 pending=listResponse(owner.id,'following');await action('follow-list-more').click();assert.equal((await pending).status(),409);await action('follow-list-retry').waitFor();
 pending=listResponse(owner.id,'following');await action('follow-list-retry').click();const restarted=await pending;assert(!new URL(restarted.url()).searchParams.get('cursor'),'Expired cursor retry restarts from first page');assert(restarted.ok());await expectCount(20);
 pending=listResponse(owner.id,'following');await action('follow-list-more').click();await successful(pending);await expectIds(followingIds);
 assert.equal(await rows().count(),25);assert.equal(await action('follow-list-more').count(),0);
 await close(true);assert(await stat('following',owner.id).evaluate(node=>document.activeElement===node),'Escape returns focus to opening stat');
 checks.push('Keyboard Enter opens following; Home/End switch tabs and focus; Escape closes and restores focus; 20+5 following rows paginate without duplicates.');
 checks.push('Real isolated snapshot expiry yields 409; retry drops expired cursor, restarts first 20 and paginates successfully.');

 mark('followers-search-real-follow-back-unfollow-and-counts');
 await open(owner,'followers');await expectRelationship(carol,false,'回关');await expectRelationship(bob,true,'互');
 pending=listResponse(owner.id,'followers');await action('follow-list-more').click();await successful(pending);await expectIds(followerIds);assert.equal(await rows().count(),26);
 await filter(owner,'followers','Carol',[carol.id],false);
 let changed=await follow(carol,true);assert.equal(changed.viewerFollowingCount,26);await expectRelationship(carol,true,'互');await expectFollowingCount(26);
 changed=await follow(carol,false);assert.equal(changed.viewerFollowingCount,25);await expectRelationship(carol,false,'回关');await expectFollowingCount(25);
 await filter(owner,'followers','ＢＯＢ',[bob.id]);await filter(owner,'followers',seeded[0].accountNumber,[seeded[0].id]);
 await filter(owner,'followers','找不到这位成员',[]);assert.equal(await rows().count(),0);
 await filter(owner,'followers','');
 checks.push('20+6 followers paginate; search supports debounce, NFKC nickname, account number and empty results; Carol follow-back/mutual/unfollow uses real PUT and absolute own following counts.');

 mark('following-unfollow-membership-and-other-profile-navigation');
 await switchTab(owner,'following');await filter(owner,'following','Bob',[bob.id]);
 await follow(bob,false);await expectIds([]);await expectFollowingCount(24);
 await switchTab(owner,'followers');await filter(owner,'followers','Bob',[bob.id]);await expectRelationship(bob,false,'回关');
 await follow(bob,true);await expectRelationship(bob,true,'互');await expectFollowingCount(25);
 await row(bob.id).locator('[data-cm="follow-list-user"]').first().click();await dialog().waitFor({state:'hidden'});
 await page.locator('.cm-profile-copy h1').filter({hasText:bob.nickname}).waitFor();assert.equal(await page.evaluate(()=>location.hash),'#community/user/'+bob.id);
 await open(bob,'following');await expectIds([owner.id,carol.id]);assert.equal(await row(owner.id).locator('[data-cm="follow"]').count(),0,'Self item has no follow-self button');
 await expectRelationship(carol,false,'回关');await follow(carol,true);await expectRelationship(carol,true,'互');await expectIds([owner.id,carol.id]);
 await follow(carol,false);await expectRelationship(carol,false,'回关');await expectIds([owner.id,carol.id]);
 assert.equal(await stat('following',bob.id).locator('b').textContent(),'2','Changing viewer relation preserves other profile following count');
 await switchTab(bob,'followers');await expectIds([owner.id]);
 await row(owner.id).locator('[data-cm="follow-list-user"]').first().click();await dialog().waitFor({state:'hidden'});await page.locator('.cm-profile-copy h1').filter({hasText:owner.nickname}).waitFor();
 await ownProfile(owner);checks.push('Unfollowing removes the outgoing relationship; follow-back restores it; list links visit correct profiles and own row omits follow-self.');

 mark('list-failure-retry-and-follow-failure-preserves-state');
 const failPattern=`**/api/community/users/${owner.id}/followers*`;let fail=true;
 const failHandler=async intercepted=>{if(fail){fail=false;await intercepted.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'验收临时读取失败'})});}else await intercepted.continue();};
 await page.route(failPattern,failHandler);await stat('followers',owner.id).click();await action('follow-list-retry').waitFor();
 assert(await dialog().locator('[role="alert"]').count(),'Read failure exposes alert');pending=listResponse(owner.id,'followers');await action('follow-list-retry').click();await successful(pending);await expectCount(20);await page.unroute(failPattern,failHandler);
 await filter(owner,'followers','Carol',[carol.id]);
 const failFollowPattern=`**/api/community/users/${carol.id}/follow`;let failWrite=true;
 const failFollowHandler=async intercepted=>{if(failWrite){failWrite=false;await intercepted.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'验收临时关注失败'})});}else await intercepted.continue();};
 await page.route(failFollowPattern,failFollowHandler);pending=responseFor(`/users/${carol.id}/follow`,'PUT');await row(carol.id).locator('[data-cm="follow"]').click();assert.equal((await pending).status(),503);
 await expectRelationship(carol,false,'回关');await expectFollowingCount(25);await follow(carol,true);await expectRelationship(carol,true,'互');await expectFollowingCount(26);await follow(carol,false);await expectFollowingCount(25);await page.unroute(failFollowPattern,failFollowHandler);
 checks.push('503 list load exposes retry and recovers; failed follow preserves real relation/count and can be retried.');

 mark('rapid-follow-writes-wait-for-authoritative-previous-response');
 await close();await open(owner,'followers');
 const bobPath=`/api/community/users/${bob.id}/follow`,bobWritesBefore=writes.filter(write=>write.path===bobPath).length;
 const writeHold=await holdResponse(`/users/${carol.id}/follow`),carolPending=responseFor(`/users/${carol.id}/follow`,'PUT'),bobPending=responseFor(`/users/${bob.id}/follow`,'PUT');
 await row(carol.id).locator('[data-cm="follow"]').click();const acceptedCarol=await writeHold.seen;assert.equal(acceptedCarol.viewerFollowingCount,26);
 await row(bob.id).locator('[data-cm="follow"]').click();await page.waitForFunction(id=>document.querySelector(`.cm-follow-dialog[open] .cm-follow-row[data-user-id="${id}"] [data-cm="follow"]`)?.disabled,bob.id);
 assert.equal(writes.filter(write=>write.path===bobPath).length,bobWritesBefore,'Second mutation stays queued while first response is delayed');
 await writeHold.release();assert.equal((await successful(carolPending)).viewerFollowingCount,26);assert.equal((await successful(bobPending)).viewerFollowingCount,25);
 await expectRelationship(carol,true,'互');await expectRelationship(bob,false,'回关');await expectFollowingCount(25);
 await follow(bob,true);await expectFollowingCount(26);await follow(carol,false);await expectFollowingCount(25);
 checks.push('Rapid Carol follow and Bob unfollow serialize actual HTTP writes; a delayed first response cannot restore an older own following count.');

 mark('late-tab-response-cannot-overwrite-active-followers');
 await close();const tabHold=await holdList(owner,'following');await stat('following',owner.id).click();await tabHold.seen;
 await switchTab(owner,'followers');await row(carol.id).waitFor();await tabHold.release();
 assert.equal(await dialog().getAttribute('data-tab'),'followers');assert.equal(await dialog().locator('[data-cm="follow-list-tab"][aria-selected="true"]').getAttribute('data-tab'),'followers');await row(carol.id).waitFor();
 checks.push('A late following response cannot overwrite the selected followers tab.');

 mark('late-search-response-cannot-overwrite-current-query');
 const searchHold=await holdList(owner,'followers','Bob');await search().fill('Bob');await search().press('Enter');await searchHold.seen;
 await filter(owner,'followers','Carol',[carol.id]);await searchHold.release();await expectIds([carol.id]);assert.equal(await dialog().getAttribute('data-query'),'carol');
 checks.push('A late Bob search cannot replace current Carol results.');

 mark('closing-dialog-cancels-late-request');
 await close();const closeHold=await holdList(owner,'following');await stat('following',owner.id).click();await closeHold.seen;await close(true);await closeHold.release();assert.equal(await dialog().count(),0);
 await open(owner,'followers');await row(carol.id).waitFor();await page.mouse.click(4,4);await dialog().waitFor({state:'hidden'});checks.push('Closing during a request keeps the dialog closed; reopening starts a fresh list; backdrop closes.');

 mark('desktop-centered-categories-and-narrow-dialog-layout');
 for(const width of [1440,1024]){await page.setViewportSize({width,height:1000});await measureCategories('categories-'+width);await shot('categories-'+width);}
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await measureCategories('categories-'+width);await visitCategoryEnds();await shot('categories-'+width);
  await ownProfile(owner);await open(owner,'followers');await measureDialog('followers-'+width);await shot('followers-list-'+width);await filter(owner,'followers','Carol',[carol.id]);await measureDialog('followers-search-'+width);await shot('followers-'+width);
  await close(true);assert(await stat('followers',owner.id).evaluate(node=>document.activeElement===node),'Narrow Escape restores focus');
 }
 checks.push('1440/1024 categories center; 390/320 end categories are reachable/visible; lists fit without page overflow and keep 44px controls.');
 assert.deepEqual(errors,[],'No browser page errors');
 assert(writes.some(write=>write.body?.active===true)&&writes.some(write=>write.body?.active===false),'Actual browser follow/unfollow writes captured');
 await json('result',{ok:true,base,dataDir,checks,geometry,writes,pageErrors:errors});console.log(JSON.stringify({ok:true,dataDir,checks},null,2));
}catch(error){
 await json('failure',{step,message:error.message,stack:error.stack,pageErrors:errors,checks,geometry,writes});if(page)await shot('failure').catch(()=>{});throw error;
}finally{
 for(const release of held)await release().catch(()=>{});
 for(const context of contexts)await context.close().catch(()=>{});
 if(browser)await browser.close();await new Promise(done=>{server.close(done);server.closeAllConnections();});
}
