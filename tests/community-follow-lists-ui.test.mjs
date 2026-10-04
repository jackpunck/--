import test from 'node:test';
import assert from 'node:assert/strict';
import {CommunityController} from '../public/community.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function globals(t) {
  for(const [name,value]of Object.entries({document:{querySelectorAll:()=>[]},CSS:{escape:String}})){
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  }
}
function harness() {
  let user={id:'self'};const controller=new CommunityController({getUser:()=>user,api:()=>{},toast:()=>{}}),renders=[];
  controller.error=()=>{};controller.renderFollowList=state=>renders.push({tab:state.tab,query:state.query,ids:state.items.map(user=>user.id)});
  function open({targetUserId='self',tab='following',items=[],loaded=false,nextCursor=null,hasMore=true}={}){
    const dialog={open:true,isConnected:true},state={dialog,targetUserId,tab,query:'',items,loaded,nextCursor,hasMore,loading:false,error:null,revision:0,generation:controller.generation};
    controller.aux=dialog;controller.followList=state;return state;
  }
  return {controller,open,renders,switchAccount:()=>{user={id:'different-account'};}};
}

test('own and public profile statistics expose accessible real-list buttons while engagement stays a statistic',()=>{
  const {controller}=harness();for(const id of ['self','public&profile']){
    const markup=controller.profileStats({id,stats:{followingCount:25,followerCount:26,receivedEngagementCount:9}});
    assert.equal((markup.match(/data-cm="profile-follow-list"/g)||[]).length,2);assert.equal((markup.match(/aria-haspopup="dialog"/g)||[]).length,2);
    assert.match(markup,/data-tab="following"[^>]*aria-label="查看关注列表，25人"/);assert.match(markup,/data-tab="followers"[^>]*aria-label="查看粉丝列表，26人"/);
    assert.match(markup,/<span><b data-profile-stat="receivedEngagementCount">9<\/b>/);if(id.includes('&'))assert.match(markup,/data-id="public&amp;profile"/);
  }
});

test('relationship search and pagination use the profile owner and server query for every page',async()=>{
  const {controller,open}=harness(),state=open({targetUserId:'other/user',tab:'followers'}),queries=[];
  state.query='runner';controller.api.get=async(path,params)=>{queries.push({path,params});return queries.length===1?{items:[{id:'first',followed:false,followedBy:true}],nextCursor:'page-two',hasMore:true}:{items:[{id:'first',followed:true,followedBy:true},{id:'second'}],hasMore:false};};
  await controller.loadFollowList(true);await controller.loadFollowList();
  assert.deepEqual(queries,[{path:'/users/other%2Fuser/followers',params:{q:'runner',cursor:null,limit:20}},{path:'/users/other%2Fuser/followers',params:{q:'runner',cursor:'page-two',limit:20}}]);
  assert.deepEqual(state.items.map(user=>user.id),['first','second']);assert.equal(state.items[0].followed,true);assert.equal(state.hasMore,false);
});

test('switching tabs aborts the old request and ignores a late response even when transport does not honor abort',async()=>{
  const {controller,open}=harness(),state=open(),old=deferred(),requests=[];
  controller.api.get=(path,params,signal)=>{requests.push({path,params,signal});return requests.length===1?old.promise:Promise.resolve({items:[{id:'follower'}],hasMore:false});};
  const loading=controller.loadFollowList(true);controller.setFollowListTab('followers');await tick();old.resolve({items:[{id:'stale-following'}],nextCursor:'stale',hasMore:true});await loading;
  assert.equal(requests[0].signal.aborted,true);assert.deepEqual(requests.map(request=>request.path),['/users/self/following','/users/self/followers']);assert.deepEqual(state.items.map(user=>user.id),['follower']);assert.equal(state.tab,'followers');assert.equal(state.loading,false);
});

test('search resets the cursor and rejects results for earlier query conditions',async()=>{
  const {controller,open}=harness(),state=open({loaded:true,items:[{id:'old'}],nextCursor:'old-cursor'}),old=deferred(),requests=[];
  controller.api.get=(path,params,signal)=>{requests.push({params,signal});return requests.length===1?old.promise:Promise.resolve({items:[{id:'matching'}],hasMore:false});};
  const loading=controller.loadFollowList();controller.searchFollowList('  ＲＵＮＮＥＲ   Friend ',true);await tick();old.resolve({items:[{id:'stale-page'}],hasMore:false});await loading;
  assert.equal(requests[0].signal.aborted,true);assert.equal(requests[1].params.q,'runner friend');assert.equal(requests[1].params.cursor,null);assert.deepEqual(state.items.map(user=>user.id),['matching']);
});

test('closing and reopening cancels the retired dialog without mixing its result into the new owner',async()=>{
  const {controller,open}=harness(),oldState=open(),old=deferred();let signal;
  controller.api.get=(path,params,value)=>{signal=value;return old.promise;};const loading=controller.loadFollowList(true);controller.stopFollowList();oldState.dialog.open=false;
  const current=open({targetUserId:'different-owner',items:[{id:'fresh'}],loaded:true});old.resolve({items:[{id:'retired'}],hasMore:false});await loading;
  assert.equal(signal.aborted,true);assert.equal(controller.followList,current);assert.deepEqual(current.items.map(user=>user.id),['fresh']);assert.equal(oldState.items.length,0);assert.equal(controller.controllers.size,0);
});

test('changing account prevents a pending list response from being displayed',async()=>{
  const {controller,open,switchAccount}=harness(),state=open(),response=deferred();controller.api.get=()=>response.promise;
  const loading=controller.loadFollowList(true);switchAccount();response.resolve({items:[{id:'previous-account-data'}],hasMore:false});await loading;
  assert.equal(state.items.length,0);assert.equal(state.loaded,false);assert.equal(controller.followListAlive(state),false);
});

test('a failed page retains rows and cursor so retry requests the failed page',async()=>{
  const {controller,open}=harness(),state=open({loaded:true,items:[{id:'first'}],nextCursor:'next'}),queries=[];
  controller.api.get=async(path,params)=>{queries.push(params);if(queries.length===1)throw new Error('network failed');return {items:[{id:'second'}],hasMore:false};};
  await controller.loadFollowList();assert.equal(state.error,'network failed');assert.equal(state.loading,false);assert.equal(state.nextCursor,'next');assert.deepEqual(state.items.map(user=>user.id),['first']);
  await controller.loadFollowList(!state.loaded);assert.deepEqual(queries.map(query=>query.cursor),['next','next']);assert.equal(state.error,null);assert.deepEqual(state.items.map(user=>user.id),['first','second']);
});

test('a follow acknowledgement rejects an older next page and retries its cursor with real relationship states',async t=>{
  globals(t);const {controller,open}=harness(),state=open({tab:'followers',loaded:true,items:[{id:'peer',followed:false,followedBy:true}],nextCursor:'page-two'}),old=deferred(),queries=[];
  controller.api.get=async(path,params)=>{queries.push(params);return queries.length===1?old.promise:{items:[{id:'peer',followed:true,followedBy:true},{id:'next-person'}],hasMore:false};};controller.api.write=async()=>({followed:true,followedBy:true,viewerFollowingCount:8});
  const loading=controller.loadFollowList();await controller.toggleFollow('peer',true);old.resolve({items:[{id:'peer',followed:false,followedBy:true}],hasMore:false});await loading;
  assert.deepEqual(queries.map(query=>query.cursor),['page-two','page-two']);assert.equal(state.items[0].followed,true);assert.deepEqual(state.items.map(user=>user.id),['peer','next-person']);
});

test('following from own followers uses the authoritative viewer count and keeps the reciprocal follower row',async t=>{
  globals(t);const {controller,open}=harness(),state=open({tab:'followers',loaded:true,items:[{id:'peer',followed:false,followedBy:true}]});
  controller.currentProfile=controller.ownProfile={id:'self',stats:{followingCount:50,followerCount:26}};controller.api.write=async()=>({followed:true,followedBy:true,followingCount:999,followerCount:123,viewerFollowingCount:4});
  await controller.toggleFollow('peer',true);assert.equal(controller.currentProfile.stats.followingCount,4);assert.equal(controller.currentProfile.stats.followerCount,26);assert.equal(state.items.length,1);assert.equal(state.items[0].followed,true);assert.equal(state.items[0].followedBy,true);assert.equal(state.items[0].followingCount,999);
});

test('own following removes an unfollowed peer, while another profile following keeps its member',async t=>{
  globals(t);for(const targetUserId of ['self','other-owner']){
    const {controller,open}=harness(),state=open({targetUserId,loaded:true,items:[{id:'peer',followed:true,followedBy:true}]}),refreshes=[];
    controller.currentProfile={id:targetUserId,stats:{followingCount:25,followerCount:26}};controller.ownProfile={id:'self',stats:{followingCount:25,followerCount:2}};controller.api.write=async()=>({followed:false,followedBy:true,followingCount:500,followerCount:100,viewerFollowingCount:24});controller.loadFollowList=async first=>refreshes.push(first);
    await controller.toggleFollow('peer',false);assert.equal(controller.ownProfile.stats.followingCount,24);
    if(targetUserId==='self'){assert.equal(state.items.length,0);assert.deepEqual(refreshes,[true]);assert.equal(controller.currentProfile.stats.followingCount,24);}else{assert.equal(state.items.length,1);assert.equal(state.items[0].followed,false);assert.equal(controller.currentProfile.stats.followingCount,25);assert.deepEqual(refreshes,[]);}
  }
});

test('legacy delta fallback updates separate own profile objects once each and self rows cannot write',async t=>{
  globals(t);const {controller,open}=harness();open({tab:'followers',loaded:true,items:[{id:'peer',followed:false}]});controller.currentProfile={id:'self',followingCount:2};controller.ownProfile={id:'self',stats:{followingCount:2}};let writes=0;
  controller.api.write=async()=>{writes++;return {followed:true,followingCount:800};};await controller.toggleFollow('self',true);assert.equal(writes,0);
  await controller.toggleFollow('peer',true);assert.equal(controller.currentProfile.followingCount,3);assert.equal(controller.ownProfile.stats.followingCount,3);assert.equal(writes,1);
});

test('a write acknowledged after account switch cannot change profile counts or list rows',async t=>{
  globals(t);const {controller,open,switchAccount}=harness(),state=open({tab:'followers',loaded:true,items:[{id:'peer',followed:false}]}),response=deferred();controller.currentProfile={id:'self',stats:{followingCount:7}};controller.api.write=()=>response.promise;
  const writing=controller.toggleFollow('peer',true);switchAccount();response.resolve({followed:true,viewerFollowingCount:8});await writing;
  assert.equal(controller.currentProfile.stats.followingCount,7);assert.equal(state.items[0].followed,false);assert.equal(controller.pending.size,0);
});

test('different-user follow writes wait for the previous acknowledgement so delayed counts cannot arrive out of order',async t=>{
  globals(t);const {controller,open}=harness(),first=deferred(),requests=[];
  open({tab:'followers',loaded:true,items:[{id:'alice',followed:false},{id:'bob',followed:false}]});controller.currentProfile=controller.ownProfile={id:'self',stats:{followingCount:0}};
  controller.api.write=(path,method,body)=>{requests.push({path,body});return requests.length===1?first.promise:Promise.resolve({followed:true,viewerFollowingCount:2});};
  const alice=controller.toggleFollow('alice',true),bob=controller.toggleFollow('bob',true);await tick();
  assert.deepEqual(requests.map(request=>request.path),['/users/alice/follow']);assert(controller.pending.has('followalice'));assert(controller.pending.has('followbob'));assert.equal(controller.currentProfile.stats.followingCount,0);
  first.resolve({followed:true,viewerFollowingCount:1});await Promise.all([alice,bob]);
  assert.deepEqual(requests.map(request=>request.path),['/users/alice/follow','/users/bob/follow']);assert.equal(controller.currentProfile.stats.followingCount,2);assert.equal(controller.pending.size,0);assert.equal(controller.followWriteQueue,null);
});

test('logout while another follow is queued prevents the queued write from reaching the server',async t=>{
  globals(t);const {controller,open,switchAccount}=harness(),first=deferred(),requests=[];
  open({tab:'followers',loaded:true,items:[{id:'alice',followed:false},{id:'bob',followed:false}]});controller.currentProfile={id:'self',stats:{followingCount:0}};controller.api.write=path=>{requests.push(path);return first.promise;};
  const alice=controller.toggleFollow('alice',true),bob=controller.toggleFollow('bob',true);await tick();switchAccount();first.resolve({followed:true,viewerFollowingCount:1});await Promise.all([alice,bob]);
  assert.deepEqual(requests,['/users/alice/follow']);assert.equal(controller.currentProfile.stats.followingCount,0);assert.equal(controller.pending.size,0);
});

test('a failed follow releases the write queue so another user can still be followed',async t=>{
  globals(t);const {controller,open}=harness(),first=deferred(),requests=[];open({tab:'followers',loaded:true,items:[{id:'alice'},{id:'bob'}]});controller.currentProfile={id:'self',stats:{followingCount:0}};
  controller.api.write=path=>{requests.push(path);return requests.length===1?first.promise:Promise.resolve({followed:true,viewerFollowingCount:1});};
  const alice=controller.toggleFollow('alice',true),bob=controller.toggleFollow('bob',true);await tick();first.reject(new Error('offline'));await Promise.all([alice,bob]);
  assert.equal(requests.length,2);assert.equal(controller.currentProfile.stats.followingCount,1);assert.equal(controller.pending.size,0);
});

test('expired pagination retries a fresh first page while retaining old rows until the response arrives',async()=>{
  const {controller,open}=harness(),state=open({loaded:true,items:[{id:'old-first'}],nextCursor:'expired-cursor'}),queries=[];
  controller.api.get=async(path,params)=>{queries.push(params);if(queries.length===1)throw Object.assign(new Error('本轮列表已过期，请刷新后继续浏览。'),{status:409});return {items:[{id:'fresh-first'}],nextCursor:'fresh-cursor',hasMore:true};};
  await controller.loadFollowList();assert.equal(state.loaded,false);assert.equal(state.nextCursor,null);assert.deepEqual(state.items.map(user=>user.id),['old-first']);
  await controller.loadFollowList(!state.loaded);assert.deepEqual(queries.map(query=>query.cursor),['expired-cursor',null]);assert.deepEqual(state.items.map(user=>user.id),['fresh-first']);assert.equal(state.nextCursor,'fresh-cursor');assert.equal(state.error,null);
});

test('Escape in a nonempty native search input closes the dialog instead of clearing only the search value',()=>{
  const {controller,open}=harness(),state=open(),input={value:'Carol',closest:selector=>selector==='.cm-follow-dialog'?state.dialog:null},events=[];
  controller.closeAux=()=>{events.push('close');controller.stopFollowList();state.dialog.open=false;};
  assert.equal(controller.followListKeys({key:'Escape',target:input,preventDefault:()=>events.push('prevent'),stopPropagation:()=>events.push('stop')}),true);
  assert.deepEqual(events,['prevent','stop','close']);assert.equal(input.value,'Carol');assert.equal(controller.followList,null);
});

test('updating profile statistics also updates the buttons accessible count labels',()=>{
  const {controller}=harness(),labels={},elements=['followingCount','followerCount'].map(key=>({dataset:{profileStat:key},textContent:'old',closest:()=>({setAttribute:(name,value)=>{labels[key]={name,value};}})}));
  controller.currentProfile={id:'self',stats:{followingCount:4,followerCount:26}};controller.page=()=>({querySelectorAll:()=>elements});controller.updateProfileStats();
  assert.deepEqual(elements.map(element=>element.textContent),['4','26']);assert.deepEqual(labels,{followingCount:{name:'aria-label',value:'查看关注列表，4人'},followerCount:{name:'aria-label',value:'查看粉丝列表，26人'}});
});

test('a reused profile heading read overtaken by a follow acknowledgement refetches before applying counts and flags',async t=>{
  globals(t);const {controller,open}=harness(),state=open({tab:'followers',loaded:true,items:[{id:'peer',followed:false}]}),old=deferred(),applied=[];let reads=0;
  controller.currentProfile=controller.ownProfile={id:'self',stats:{followingCount:0}};controller.api.get=()=>++reads===1?old.promise:Promise.resolve({profile:{id:'self',stats:{followingCount:1}}});controller.api.write=async()=>({followed:true,viewerFollowingCount:1});
  const reading=controller.readFollowAwareProfile('/me/profile',()=>controller.alive(),profile=>{applied.push(profile.stats.followingCount);controller.currentProfile=controller.ownProfile=profile;});
  await controller.toggleFollow('peer',true);old.resolve({profile:{id:'self',stats:{followingCount:0}}});await reading;
  assert.equal(reads,2);assert.deepEqual(applied,[1]);assert.equal(controller.currentProfile.stats.followingCount,1);assert.equal(state.items[0].followed,true);
});

test('moderator profile refresh cannot overwrite own cached following count with a pre-acknowledgement response',async t=>{
  globals(t);const {controller}=harness(),old=deferred(),link={hidden:true,closest:()=>({classList:{toggle(){}}})};let reads=0;
  controller.container={querySelector:()=>link};controller.ownProfile={id:'self',stats:{followingCount:0}};controller.api.get=()=>++reads===1?old.promise:Promise.resolve({profile:{id:'self',isModerator:true,stats:{followingCount:1}}});controller.api.write=async()=>({followed:true,viewerFollowingCount:1});
  const reading=controller.refreshModeratorEntry();await controller.toggleFollow('peer',true);old.resolve({profile:{id:'self',isModerator:false,stats:{followingCount:0}}});await reading;
  assert.equal(reads,2);assert.equal(controller.ownProfile.stats.followingCount,1);assert.equal(link.hidden,false);
});
