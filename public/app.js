import {api, streamChat, RecordStore, setApiUser, createId} from './store.js?v=9';
import {renderMarkdown} from './chat-markdown.js?v=9';
import {AttachmentManager, filesFromTransfer} from './chat-attachments.js?v=9';
import {patchHTML, copyMessageText, copyImage} from './chat-view.js?v=9';
import {calendarTasks, validateCalendarTask, trainingDayType, addDays, weekDates} from './schedule.js?v=9';
import {parseMealEstimate, mealTypeAt, nutritionBalance, parseNutritionAdvice, formatMealNotes, mealAdviceTiming} from './meal-contract.js?v=9';
import {knowledgeCards, findKnowledge} from './knowledge.js?v=9';
import {formulaCards, foodPortions, calculateMetabolism, calculateMacroEnergy, calculateFoodPortion} from './knowledge-tools.js?v=9';
import {muscleCatalog, findVisuals, modelUrl} from './visuals.js?v=9';
import {ModelViewer} from './model-viewer.js?v=9';
import {providerPresets} from './provider-presets.js?v=9';
import {enabledModels, taskSelection, reconcileTasks} from './provider-ui.js?v=9';
import {exercises, foods, calculateNutrition, generatePlan, estimate1RM, sumFoods, suggestRecipe, planVariants, substituteFood, convertFoodWeight, validateProfile} from './domain.js?v=9';
import {coverUrl} from './exercise-covers.js?v=9';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = createId;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dateLabel = value => new Date(value+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
const numeric = value => Math.round(Number(value)||0);
const goalLabel = goal => ({lose:'减脂',gain:'增肌',maintain:'保持健康'}[goal] || goal);
const paths = {
 sunrise:'M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v3M4 9l2 2M20 9l-2 2',
 sun:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
 moon:'M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z',
 snack:'M4 9h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9ZM16 10h2a3 3 0 0 1 0 6h-2M7 3v3M12 2v4',
 egg:'M19 14c0 4-3 7-7 7s-7-3-7-7S9 3 12 3s7 7 7 11ZM8 14c0 2 1 3 3 3',
 bowl:'M3 11h18a9 9 0 0 1-18 0ZM8 21h8M8 3v4M12 2v5M16 3v4',
 protein:'M9 7c3-3 7-3 9-1s2 6-1 9-6 3-8 1l-3 3a2 2 0 1 1-3-3l3-3c-1-2 0-4 3-6ZM12 8l3 3',
 milk:'M8 3h8v4l3 4v10H5V11l3-4V3ZM8 7h8M5 12h14M9 16h6',
 fruit:'M12 7c-3-3-8-1-8 4s3 10 6 10l2-1 2 1c3 0 6-5 6-10s-5-7-8-4ZM12 7V4M12 4c1-3 4-3 5-2-1 3-3 3-5 2',
 chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5',
 food:'M6 3v6a3 3 0 0 0 6 0V3M9 3v18M19 3v18M19 3c-4 4-4 9 0 9',
 dumbbell:'m6 5 13 13M3 8l5-5M2 5l3-3M16 21l5-5M19 22l3-3M5 10l5-5M14 19l5-5',
 grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
 plus:'M12 5v14M5 12h14', arrow:'M7 17 17 7M7 7h10v10', send:'M12 19V5M5 12l7-7 7 7',
 clip:'m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5',
 image:'M3 3h18v18H3zM3 16l5-5 4 4 3-3 6 6M8 7h.01', close:'m6 6 12 12M6 18 18 6',
 leaf:'M20 3C7 2 2 9 6 15s15 4 14-12M5 21 16 9', check:'m5 12 4 4L19 6',
 history:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2', logout:'M9 3H4v18h5M10 12h11M17 8l4 4-4 4',
 menu:'M4 6h16M4 12h16M4 18h16', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
 spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3',
 calendar:'M3 5h18v16H3zM7 3v4M17 3v4M3 10h18', download:'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
 body:'M12 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4M5 8l7 2 7-2M12 10v6M12 16l-5 6M12 16l5 6'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
const button = (text,action,extra='',type='') => `<button type="button" class="button ${type}" data-action="${action}" ${extra}>${text}</button>`;
const empty = (text,name='leaf') => `<div class="empty">${icon(name)}${text}</div>`;
const state = {page:'chat',setting:'profile',date:today(),conversation:null,user:null,store:null,providers:[],tasks:{},taskModels:{},providerDraft:null,files:[],busy:false,filter:'',muscle:'',equipment:'',knowledgeTab:'nutrition',mealDraft:null,authMode:'register'};
try { state.sidebarCollapsed = localStorage.getItem('fitness:sidebar-collapsed') === 'true'; } catch { state.sidebarCollapsed = false; }
const knowledgeDrafts = {};
const modelViewer = new ModelViewer();
const chatDrafts = new Map();
const chatScroll = new Map();
let chatRun = null;
let composerObserver = null;
const attachmentOwner = (conversation=state.conversation,userId=state.user?.id) => `${userId}:${conversation||'new'}`;
const chatUploads = new AttachmentManager({
 upload:async(file,{signal,ownerKey,metadata})=>{
   if(!navigator.onLine)throw new Error('当前离线，联网后可重试上传。');
   const data=await new Promise((resolve,reject)=>{
     const reader=new FileReader(),abort=()=>{reader.abort();reject(new DOMException('已取消上传','AbortError'));};
     signal.addEventListener('abort',abort,{once:true});
     reader.onload=()=>{signal.removeEventListener('abort',abort);resolve(String(reader.result).split(',')[1]);};
     reader.onerror=()=>{signal.removeEventListener('abort',abort);reject(reader.error);};
     if(signal.aborted)abort();else reader.readAsDataURL(file);
   });
   return api('/attachments',{method:'POST',signal,headers:{'X-Fitness-User':ownerKey.split(':')[0]},body:{name:metadata.name,type:metadata.type,data}});
 },
 removeRemote:(attachment,{ownerKey})=>api('/attachments/'+attachment.id,{method:'DELETE',headers:{'X-Fitness-User':ownerKey.split(':')[0]},body:{}}),
 onChange:owner=>{if(state.user&&owner===attachmentOwner())renderChatFiles();}
});
const profile = () => state.store?.get('profile');
const records = kind => state.store?.list(kind) || [];
const plan = () => state.store?.get('active-plan');
const allCalendarTasks = () => calendarTasks(records('calendar-task'),records('schedule'),plan());
const scheduledRecord = date => allCalendarTasks().find(r=>r.data.date===date&&r.data.taskType==='training');
const scheduled = date => scheduledRecord(date)?.data;
const dayType = date => trainingDayType(date,allCalendarTasks());
const totals = date => records('meal').filter(r => r.data.date === date && r.data.confirmed).reduce((sum,r) => { const t = mealTotals(r.data.items); for (const k of Object.keys(sum)) sum[k] += t[k] || 0; return sum; },{kcal:0,protein:0,carbs:0,fat:0});
const mealTotals = items => sumFoods(items || []);
function nutrition(date = state.date) { try { return calculateNutrition(profile(),dayType(date)); } catch(error) { return {kcal:0,protein:0,carbs:0,fat:0,bmr:0,tdee:0,error:error.message}; } }
function toast(message,error=false) { const el=document.createElement('div'); el.className='toast'+(error?' error':''); el.textContent=message; $('#toasts').append(el); while($('#toasts').children.length>2)$('#toasts').firstElementChild.remove();setTimeout(()=>el.remove(),5000); }
function modal(title,html,wide=false,required=false) { const el=$('#modal'); el.className=wide?'modal-wide':''; el.innerHTML=`<div class="modal-head"><h2>${title}</h2>${required?'':`<button class="icon-button" aria-label="关闭" data-action="close-modal">${icon('close')}</button>`}</div><div class="modal-content">${html}</div>`; el.oncancel=required?e=>e.preventDefault():null; if(!el.open)el.showModal(); }
function clearProviderDraft() {if(state.providerDraft)state.providerDraft.apiKey='';state.providerDraft=null;const key=$('#provider-key');if(key)key.value='';}
function closeModal() {clearProviderDraft();$('#modal').close(); }
function formData(form) { return Object.fromEntries(new FormData(form)); }
function options(list,selected) { return list.map(([value,label])=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`).join(''); }

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{});
  try { const {user}=await api('/auth/me'); await enter(user); }
  catch(error) {
    const cached=JSON.parse(localStorage.getItem('fitness:last-user') || 'null');
    if(!error.status && cached) { await enter(cached,true); toast('当前离线，记录会先保存在这台设备'); }
    else renderAuth();
  }
}
async function enter(user,offline=false) {
  if(state.user?.id!==user.id){modelViewer.destroy();for(const key of Object.keys(knowledgeDrafts))delete knowledgeDrafts[key];await chatUploads.clearAll({removeUploaded:true});chatDrafts.clear();chatScroll.clear();state.conversation=null;state.chatScene='';state.files=[];}
  setApiUser(user.id);
  state.user=user; state.store=await new RecordStore(user).open(); localStorage.setItem('fitness:last-user',JSON.stringify(user));
  if(offline)state.store.status='offline';
  const store=state.store;state.scheduleFingerprint=scheduleFingerprint();state.scheduleRefreshPending=false;
  store.addEventListener('change',()=>{if(state.store!==store)return;updateSync();renderSidebarHistory();refreshScheduleViews();});
  if(!offline) { await state.store.sync().catch(e=>toast(e.message,true)); await loadProviders(); }
  render(); if(!profile()) showProfile(true);
}
async function loadProviders() { try { const result=await api('/providers'); state.providers=result.providers; state.tasks=result.tasks;state.taskModels=result.taskModels||{}; } catch {} }
function renderAuth() {
  const register=state.authMode==='register';
  $('#app').innerHTML=`<div class="auth-shell"><section class="auth-story"><div class="brand"><span class="brand-symbol">循</span><div>循序<small>YOUR EVERYDAY FITNESS</small></div></div><div><div class="eyebrow" style="color:#9db692">SMALL STEPS. REAL PROGRESS.</div><h1>让每一份努力，<br>都有迹可循。</h1><p>懂你的训练，记住你的饮食。<br>和 AI 一起，找到适合自己的健康节奏。</p></div><div class="auth-footer">训练 · 饮食 · 一点点进步</div><div class="orbit"></div></section><section class="auth-form-wrap"><div class="auth-form"><h2>${register?'开始你的新一程':'欢迎回来'}</h2><p>一个账号，连接电脑和手机上的每一次进步。</p><div class="auth-tabs"><button data-action="auth-mode" data-mode="register" class="${register?'active':''}">创建账号</button><button data-action="auth-mode" data-mode="login" class="${!register?'active':''}">登录账号</button></div><form id="auth-form">${register?'<div class="field"><label for="name">怎么称呼你</label><input id="name" name="name" autocomplete="name" placeholder="你的名字" required maxlength="40"></div>':''}<div class="field"><label for="email">邮箱</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div><div class="field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="${register?'new-password':'current-password'}" placeholder="至少 8 位密码" minlength="8" maxlength="128" required></div><div id="auth-error"></div><button class="button primary" type="submit">${register?'创建账号，开始使用':'登录我的空间'} ${icon('arrow')}</button></form><p class="auth-hint">数据保存在当前服务中。同一服务地址下，电脑与手机可登录同一账号同步记录。</p></div></section></div>`;
}
function render() {
  captureChatDraft();
  const labels={chat:'AI 对话',nutrition:'今日饮食',training:'训练计划',library:'知识大全',settings:'个人设置'};
  $('#app').innerHTML=`<div class="layout${state.sidebarCollapsed?' sidebar-collapsed':''}"><aside class="sidebar" id="sidebar"><div class="sidebar-header"><button type="button" class="sidebar-toggle icon-button" data-action="toggle-sidebar" aria-controls="sidebar" aria-expanded="${!state.sidebarCollapsed}" aria-label="${state.sidebarCollapsed?'展开侧边栏':'收起侧边栏'}" title="${state.sidebarCollapsed?'展开侧边栏':'收起侧边栏'}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM9 4v16m6-12-4 4 4 4"/></svg><span class="toggle-brand brand-symbol" aria-hidden="true">循</span></button><button class="mobile-close icon-button" data-action="menu" aria-label="关闭导航">${icon('close')}</button><a class="brand" aria-label="循序 · AI 对话" title="循序 · AI 对话" href="#chat" data-action="nav" data-page="chat"><span class="brand-symbol">循</span><div>循序<small>AI FITNESS COMPANION</small></div></a></div><nav class="nav" aria-label="主导航">${[['chat','chat','AI 对话'],['nutrition','food','今日饮食'],['training','dumbbell','训练计划'],['library','grid','知识大全'],['settings','settings','个人设置']].map(([id,i,label])=>`<button data-action="nav" data-page="${id}" aria-label="${label}" title="${label}" class="${state.page===id?'active':''}" ${state.page===id?'aria-current="page"':''}>${icon(i)}<span>${label}</span>${state.page===id?'<i class="nav-dot"></i>':''}</button>`).join('')}</nav><section class="history"><div class="section-label">最近对话<button class="link-button" data-action="new-chat" aria-label="新建对话">＋</button></div><div id="history-list"></div></section><div class="side-note"><strong>进步，发生在每一天。</strong>不必一下做到完美，<br>今天比昨天多一点就好。</div><div class="account"><span class="avatar">${esc(state.user.name?.slice(0,1)||'循')}</span><div class="account-info"><strong>${esc(state.user.name||'我的空间')}</strong><small>${profile()?goalLabel(profile().goal)+'进行中':'开启健康生活'}</small></div><button class="icon-button" data-action="logout" aria-label="退出登录">${icon('logout')}</button></div></aside><main class="main"><header class="topbar"><div class="row"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><div class="breadcrumb">我的健康空间<span>/</span><strong>${labels[state.page]}</strong></div></div><div class="top-right"><span class="date-label muted">${dateLabel(today())}</span><button id="sync-status" class="status" data-action="sync">已同步</button></div></header><div id="page" class="content"></div></main></div>`;
  renderSidebarHistory(); updateSync(); renderPage();
}
function updateSync() {
  const el=$('#sync-status'); if(!el||!state.store)return;
  const s=state.store; const labels={syncing:'正在同步',synced:s.pending.size?`${s.pending.size} 条待同步`:'已同步',offline:`离线 · ${s.pending.size} 条待同步`,expired:'登录已过期',conflict:`${s.conflicts.length} 项冲突`,idle:'本地已保存',error:'同步失败 · 点击重试'};
  el.textContent=labels[s.status]; el.classList.toggle('warn',['offline','expired','conflict','error'].includes(s.status));
}
function renderSidebarHistory() {
  const el=$('#history-list');if(!el)return;
  el.innerHTML=records('conversation').slice(0,30).map(r=>`<div class="history-item ${r.id===state.conversation?'current':''}"><button data-action="open-chat" data-id="${esc(r.id)}">${esc(r.data.title)}</button><button class="delete" aria-label="删除对话 ${esc(r.data.title)}" data-action="delete-chat" data-id="${esc(r.id)}">×</button></div>`).join('') || '<div style="padding:5px 12px"><small>新的对话，从这里开始</small></div>';
}
function renderPage() {
  ({chat:renderChat,nutrition:renderNutrition,training:renderTraining,library:renderLibrary,settings:renderSettings}[state.page])();
}
function title(name,desc,actions='') { return `<div class="page-title"><div><h1>${name}</h1><p>${desc}</p></div>${actions}</div>`; }
function macros(current,target,compact=false) {
  return `<div class="macro-row">${[['protein','蛋白质',''],['carbs','碳水','carbs'],['fat','脂肪','fat']].map(([key,label,c])=>`<div><strong>${numeric(current[key])}<small> / ${numeric(target[key])} g</small></strong><div class="bar ${c}"><i style="width:${Math.min(100,(current[key]/target[key]||0)*100)}%"></i></div><small>${label}</small></div>`).join('')}</div>`;
}
function contextCards() {
 const t=totals(today()),n=nutrition(today()),s=scheduled(today()),p=plan(),d=s?.daySnapshot||p?.days.find(x=>x.id===s?.dayId);
 return `<aside class="chat-aside"><section class="card"><div class="context-date">TODAY'S BALANCE</div><div class="today-title"><h3>今日营养</h3><span class="badge">${dayType(today())==='rest'?'休息日':'训练日'}</span></div><div class="ring" style="--percent:${Math.min(100,(t.kcal/n.kcal||0)*100)}"><div><strong>${numeric(t.kcal)}</strong><small>/ ${numeric(n.kcal)} kcal</small></div></div>${n.error?`<div class="error-box">${esc(n.error)}</div>`:macros(t,n)}</section><section class="card"><div class="card-head"><h3>今天怎么练</h3>${icon('dumbbell')}</div><div class="training-mini"><div class="mini-icon">${icon('dumbbell')}</div><div><strong>${esc(d?.name||'休息与恢复')}</strong><small>${s?.completed?'已完成今日训练':d?`${d.exercises.length} 个动作 · 按自己的节奏`:'当天没有训练安排'}</small></div></div><button class="link-button" data-action="nav" data-page="training">查看训练计划 ${icon('arrow')}</button></section><section class="tip-card"><strong>${icon('leaf')} 给今天的一点提醒</strong><p>先把动作做稳，再慢慢增加重量。每一组有质量的练习，都值得被记录。</p></section></aside>`;
}
function captureChatDraft() {
 const input=$('#chat-input');if(!input)return;
 const key=input.dataset.conversation||'';
 chatDrafts.set(key,{text:input.value,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,scrollTop:input.scrollTop,focused:document.activeElement===input});
 const body=$('.chat-body');if(body)chatScroll.set(key,{top:body.scrollTop,follow:body.dataset.follow!=='false'});
}
function selectConversation(id) {captureChatDraft();state.conversation=id;state.files=[];state.chatScene=state.store.get(id)?.scene||'';}
async function openMealChat() {
 selectConversation(null);state.chatScene='meal';
 await navigate('chat');
 if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
   $('#page')?.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:200,easing:'cubic-bezier(.2,.7,.3,1)'});
 }
 $('#chat-input')?.focus({preventScroll:true});
}
function updateChatScene() {
 const input=$('#chat-input');if(!input)return;
 const meal=state.chatScene==='meal';
 input.placeholder=meal?'描述这一餐吃了什么、吃了多少，或上传餐食照片，我会分析营养和热量并记录…':'聊聊训练、饮食，或粘贴图片和文件…';
 const scene=$('#chat-scene');
 if(scene){scene.hidden=!meal;scene.innerHTML=meal?`${icon('food')}<span>记录餐食 · 支持照片或文字</span><button type="button" class="icon-button" data-action="exit-meal-scene" aria-label="退出餐食记录模式">×</button>`:'';}
}
function resizeComposer(input=$('#chat-input')) {
 if(!input)return;input.style.height='auto';input.style.height=Math.min(168,Math.max(48,input.scrollHeight))+'px';input.style.overflowY=input.scrollHeight>168?'auto':'hidden';
}
function chatConversation() { return chatRun?.id===state.conversation?chatRun.conv:state.store.get(state.conversation); }
function chatGreeting() {
 return `<div class="greeting"><div class="greeting-icon">${icon('spark')}</div><div class="eyebrow">YOUR PERSONAL FITNESS COMPANION</div><h1>${esc(state.user.name||'你好')}，今天也为自己<br><span>做一点积极的改变。</span></h1><p>训练怎么安排，三餐怎么吃，动作怎么做？<br>直接告诉我你的想法，也可以让我调整日程中的训练，增删改今天的饮食记录。</p></div><div class="prompts">${[['dumbbell','帮我安排训练','从目标出发，找到适合的节奏','training'],['image','拍照记录这一餐','估算营养，让饮食心中有数','meal'],['body','看看动作怎么做','3D 拆解动作，找到正确发力','library'],['leaf','回顾最近的进步','结合体重、训练与饮食记录','review']].map(([i,t,s,a])=>`<button class="prompt-card" data-action="quick" data-target="${a}"><span>${icon(i)}</span><strong>${t}</strong><small>${s}</small><span class="arrow">↗</span></button>`).join('')}</div>`;
}
function updateChatScroll(body=$('.chat-body')) {
 if(!body)return;
 body.dataset.lastTop=String(body.scrollTop);
 const latest=$('[data-action="chat-latest"]');if(latest)latest.hidden=body.scrollHeight-body.scrollTop-body.clientHeight<=2;
 chatScroll.set(state.conversation||'',{top:body.scrollTop,follow:body.dataset.follow!=='false'});
}
function chatFollows(body) {
 if(body.dataset.follow==='false')return false;
 // Scroll events arrive later than the actual offset, including scrollbar drags.
 if(body.scrollTop<Number(body.dataset.lastTop??body.scrollTop)-2){body.dataset.follow='false';return false;}
 return true;
}
function followChat(body=$('.chat-body')) {if(body){body.dataset.follow='true';body.scrollTop=body.scrollHeight;updateChatScroll(body);}}
function renderChatBody() {
 const body=$('.chat-body');if(!body)return;
 const follow=chatFollows(body),oldScroll=body.scrollTop;
 const conversation=chatConversation(),messages=conversation?.messages||[];
 if(!messages.length){if(!$('.greeting',body))body.innerHTML=chatGreeting();return;}
 let list=$('.messages',body);
 if(!list){body.innerHTML=`<div class="row spread chat-history-head"><span class="muted chat-title"></span>${button('新对话','new-chat','','small')}</div><div class="messages" role="log" aria-live="off" aria-label="对话消息"></div>`;list=$('.messages',body);}
 $('.chat-title',body).textContent=conversation.title;
 const keep=new Set(messages.map(message=>message.id));
 for(const node of [...list.children])if(!keep.has(node.dataset.messageId))node.remove();
 for(const message of messages){
   let node=[...list.children].find(node=>node.dataset.messageId===message.id);
   if(!node){list.insertAdjacentHTML('beforeend',renderMessage(message));}
   else patchHTML($('.bubble',node),messageBubble(message));
 }
 body.scrollTop=follow?body.scrollHeight:oldScroll;updateChatScroll(body);
}
function updateChatControls() {
 const actions=$('#chat-send-actions');if(!actions)return;
 const entries=chatUploads.list(attachmentOwner()),blocked=entries.some(entry=>entry.status!=='ready'),hasContent=$('#chat-input')?.value.trim()||entries.length;
 patchHTML(actions,chatRun?`${chatRun.id!==state.conversation?'<small class="muted">另一段对话正在回复</small>':''}<button type="button" class="button small stop-generation" data-action="stop-chat" aria-label="停止生成">■ 停止生成</button>`:`<button type="submit" class="send" aria-label="发送消息" ${blocked||!hasContent?'disabled':''} title="${blocked?'请等待上传完成，或重试 / 移除失败附件':'发送消息'}">${icon('send')}</button>`);
 const feedback=$('#chat-upload-status');if(feedback)feedback.textContent=entries.some(entry=>entry.status==='uploading')?'附件正在上传，完成后即可发送。':blocked?'附件上传失败，请重试或移除后再发送。':'';
}
function addChatFiles(files,owner=attachmentOwner()) {
 if(!files.length||!state.user||!owner.startsWith(state.user.id+':'))return;
 const result=chatUploads.add(owner,files);for(const error of result.errors)toast(error,true);
}
function renderChatFiles() {
 const list=$('#chat-files');if(!list||!state.user)return;
 const entries=chatUploads.list(attachmentOwner());
 patchHTML(list,entries.map(entry=>{
   const image=entry.type.startsWith('image/'),url=entry.previewUrl||entry.attachment?.url;
   return `<div class="chat-file-card ${image?'image-file':''}" data-upload-id="${esc(entry.id)}" data-status="${entry.status}">${image&&url?`<button type="button" class="chat-file-thumb" data-action="preview-image" data-url="${esc(url)}" data-name="${esc(entry.name)}" aria-label="预览 ${esc(entry.name)}"><img src="${esc(url)}" alt="${esc(entry.name)}"></button>`:`<span class="chat-file-symbol">${icon('clip')}</span>`}<div class="chat-file-info"><strong title="${esc(entry.name)}">${esc(entry.name)}</strong><small>${formatFileSize(entry.size)} · ${entry.status==='uploading'?'上传中…':entry.status==='error'?'上传失败':'已就绪'}</small>${entry.error?`<span class="chat-file-error">${esc(entry.error)}</span>`:''}<div class="chat-file-actions">${entry.status==='error'?button('重试','retry-upload',`data-id="${esc(entry.id)}"`,'small'):''}${image&&url?button('复制图片','copy-image',`data-url="${esc(url)}"`,'small'):''}</div></div><button class="chat-file-remove" type="button" data-action="remove-file" data-id="${esc(entry.id)}" aria-label="移除 ${esc(entry.name)}">×</button></div>`;
 }).join(''));
 updateChatControls();
}
function bindChatInteractions() {
 const input=$('#chat-input'),main=$('.chat-main'),body=$('.chat-body'),form=$('#chat-form');
 composerObserver?.disconnect();composerObserver=new ResizeObserver(()=>{if(!main.isConnected)return;main.style.setProperty('--composer-height',form.offsetHeight+'px');if(chatFollows(body))followChat(body);});composerObserver.observe(form);
 input.addEventListener('paste',event=>{
   const files=filesFromTransfer(event.clipboardData);if(!files.length)return;
   event.preventDefault();addChatFiles(files);
   const text=event.clipboardData.getData('text/plain');
   if(text){const available=Math.max(0,input.maxLength-input.value.length+input.selectionEnd-input.selectionStart);input.setRangeText(text.slice(0,available),input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));if(text.length>available)toast('文字已达到 16000 字上限，超出的部分未粘贴。',true);}
 });
 let dragDepth=0;
 const hasFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
 main.addEventListener('dragenter',event=>{if(!hasFiles(event))return;event.preventDefault();dragDepth++;main.classList.add('is-dragging');});
 main.addEventListener('dragover',event=>{if(hasFiles(event)){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
 main.addEventListener('dragleave',event=>{if(!hasFiles(event))return;if(--dragDepth<=0){dragDepth=0;main.classList.remove('is-dragging');}});
 main.addEventListener('drop',event=>{if(!hasFiles(event))return;event.preventDefault();dragDepth=0;main.classList.remove('is-dragging');addChatFiles(filesFromTransfer(event.dataTransfer));});
 body.addEventListener('scroll',()=>{body.dataset.follow=String(body.scrollHeight-body.scrollTop-body.clientHeight<=2);updateChatScroll(body);},{passive:true});
 body.addEventListener('wheel',event=>{if(event.deltaY<0)body.dataset.follow='false';},{passive:true});
 body.addEventListener('keydown',event=>{if(['PageUp','Home','ArrowUp'].includes(event.key))body.dataset.follow='false';});
 body.addEventListener('touchmove',()=>{body.dataset.follow='false';},{passive:true});
 body.addEventListener('load',()=>{if(chatFollows(body))followChat(body);},true);
}
function renderChat() {
 const key=state.conversation||'';
 const existing=$('#chat-input');
 if(existing&&existing.dataset.conversation===key) {
   renderChatBody();renderChatFiles();updateChatScene();const aside=$('.chat-aside');if(aside)aside.outerHTML=contextCards();return;
 }
 captureChatDraft();
 $('#page').innerHTML=`<div class="chat-layout"><section class="chat-main"><div class="chat-body" tabindex="0" aria-label="对话记录"></div><button type="button" class="chat-latest" data-action="chat-latest" hidden>↓ 回到最新</button><div class="chat-drop-overlay" aria-hidden="true">${icon('clip')}松开以添加图片或文件</div><form id="chat-form" class="composer"><div class="composer-box"><div id="chat-scene" class="chat-scene" hidden></div><div class="attachments" id="chat-files"></div><label class="sr-only" for="chat-input">给健身助手发送消息</label><textarea id="chat-input" data-conversation="${esc(key)}" name="message" placeholder="聊聊训练、饮食，或粘贴图片和文件…" rows="2" maxlength="16000"></textarea><div class="composer-tools"><div class="row"><button class="icon-button" type="button" data-action="attach" aria-label="上传图片或文件">${icon('clip')}</button><button class="icon-button" type="button" data-action="camera" aria-label="拍照上传">${icon('image')}</button><span class="composer-model">${esc(currentModel('chat')||'在设置中连接 AI 模型')}</span></div><div id="chat-send-actions" class="row"></div></div><div id="chat-upload-status" class="chat-upload-status" role="status"></div></div><p class="composer-note">粘贴 / 拖入图片或文件 · 最多 6 个，每个 8 MB · Enter 发送，Shift + Enter 换行。AI 可调整训练日程与今日饮食。</p></form></section>${contextCards()}</div>`;
 const input=$('#chat-input'),draft=chatDrafts.get(key);input.value=draft?.text||'';resizeComposer(input);
 if(draft){input.setSelectionRange(draft.start,draft.end,draft.direction);input.scrollTop=draft.scrollTop;if(draft.focused&&!$('#modal').open)input.focus({preventScroll:true});}
 let composing=false;
 input.addEventListener('compositionstart',()=>{composing=true;});
 input.addEventListener('compositionend',()=>{composing=false;captureChatDraft();resizeComposer(input);updateChatControls();});
 input.addEventListener('input',()=>{captureChatDraft();resizeComposer(input);updateChatControls();});
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();if(!chatRun)$('#chat-form').requestSubmit();}});
 const body=$('.chat-body'),position=chatScroll.get(key);body.dataset.follow=String(position?.follow!==false);
 renderChatBody();if(position?.follow===false)body.scrollTop=position.top;
 bindChatInteractions();renderChatFiles();updateChatScroll();updateChatScene();
}
function currentModel(task) { return state.taskModels[task] ?? state.providers.find(p=>p.id===state.tasks[task])?.model; }
function formatFileSize(size) {return size>=1024*1024?`${(size/1024/1024).toFixed(1)} MB`:size>=1024?`${Math.ceil(size/1024)} KB`:`${size||0} B`;}
function renderAttachments(files,removable=false,scope='chat') {
 if(scope==='meal')return files.map((f,i)=>`<span class="attachment">${icon(f.type?.startsWith('image/')?'image':'clip')}${f.url?`<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>`:esc(f.name)}${removable?`<button data-action="remove-meal-file" data-index="${i}" type="button" aria-label="移除 ${esc(f.name)}">×</button>`:''}</span>`).join('');
 return files.map(f=>f.type?.startsWith('image/')&&f.url?`<div class="message-attachment-image"><button type="button" data-action="preview-image" data-url="${esc(f.url)}" data-name="${esc(f.name)}" aria-label="预览 ${esc(f.name)}"><img class="message-image" src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></button><div><small>${esc(f.name)}${f.size?' · '+formatFileSize(f.size):''}</small>${button('复制图片','copy-image',`data-url="${esc(f.url)}"`,'small')}</div></div>`:`<span class="attachment">${icon('clip')}${f.url?`<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>`:esc(f.name)}${f.size?`<small>${formatFileSize(f.size)}</small>`:''}</span>`).join('');
}
function messageVisuals(message) {
 const messages=chatConversation()?.messages||[],index=messages.findIndex(item=>item.id===message.id);
 const question=index<0?null:messages.slice(0,index).reverse().find(item=>item.role==='user');
 const matches=findVisuals(question?.content||'',{limit:2});
 // The question fixes the cards for the whole stream; answer-only matches wait
 // until completion so changing partial text cannot replace a live 3D iframe.
 return matches.length?matches:message.streaming?[]:findVisuals(message.content||'',{limit:2});
}
function renderVisualCard(visual,preview=true) {
 return `<article class="visual-card" data-visual-type="${esc(visual.type)}" data-visual-id="${esc(visual.id)}"><header><span>${icon('body')}${visual.type==='muscle'?'肌肉位置':'3D 动作'}</span><strong>${esc(visual.title)}</strong></header>${preview?`<iframe class="chat-model-frame" src="${esc(modelUrl(visual.type,visual.id,{compact:true}))}" title="${esc(visual.title)}3D 示意" loading="lazy" allow="fullscreen"></iframe>`:'<div class="visual-placeholder">'+icon('body')+'<span>打开 3D 查看位置与动作</span></div>'}<footer>${button('打开完整 3D ↗','open-visual',`data-type="${esc(visual.type)}" data-id="${esc(visual.id)}"`,'small')}</footer></article>`;
}
function messageBubble(m) {
 const text=String(m.content||''),assistant=m.role==='assistant',streaming=assistant&&m.streaming&&chatRun?.message.id===m.id;
 const visuals=assistant?messageVisuals(m):[],preview=assistant&&(chatConversation()?.messages||[]).filter(message=>message.role==='assistant').slice(-2).some(message=>message.id===m.id);
 const references=assistant&&!streaming?findKnowledge(text):[];
 const incomplete=assistant&&m.streaming&&!streaming,last=chatConversation()?.messages.at(-1)?.id===m.id;
 return `<div class="message-text ${assistant?'markdown-body':''}">${assistant?renderMarkdown(text):esc(text)}</div><div class="message-progress">${streaming?`<div class="stream-status" role="status">${text?'正在生成…':'正在思考你的问题…'}</div>`:''}</div><div class="message-attachments">${m.attachments?.length?renderAttachments(m.attachments):''}</div><div class="tool-results">${(m.toolResults||[]).map(result=>`<div class="tool-result ${result.ok?'success':'failed'}" role="status"><strong>${result.ok?'✓ 已执行':'操作未完成'}</strong><span>${esc(result.message||result.name||'训练计划操作')}</span></div>`).join('')}</div><div class="message-visuals">${visuals.map(visual=>renderVisualCard(visual,preview)).join('')}</div><div class="message-references">${references.length?`<div class="message-meta">${references.map(k=>button(icon('leaf')+' '+esc(k.title),'knowledge',`data-id="${k.id}"`,'small')).join('')}</div>`:''}</div><div class="message-errors">${m.error||m.stopped||incomplete?`<div class="${m.error?'error-box':'notice'} chat-message-status">${esc(m.error|| (m.stopped?'已停止生成，已保留收到的内容。':'上次回复未完成，已保留收到的内容。'))} ${last&&!chatRun?button('重试回答','retry-chat',`data-id="${esc(m.id)}"`,'small'):''}</div>`:''}</div><div class="message-footer"><small>${m.model?esc(m.model)+' · ':''}${new Date(m.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</small><div class="message-actions">${text?button('复制','copy-message',`data-id="${esc(m.id)}" aria-label="复制消息"`,'small'):''}${assistant&&last&&!chatRun&&!m.error&&!m.stopped&&!incomplete?button('重新生成','retry-chat',`data-id="${esc(m.id)}"`,'small'):''}</div></div>`;
}
function renderMessage(m) {return `<div class="message ${m.role==='user'?'user':'assistant'}" data-message-id="${esc(m.id)}"><div class="message-icon">${m.role==='user'?esc(state.user.name?.slice(0,1)||'我'):'✧'}</div><div class="bubble">${messageBubble(m)}</div></div>`;}
function paintChatRun(run) {
 if(state.store!==run.store||state.page!=='chat'||state.conversation!==run.id)return;
 const body=$('.chat-body'),node=$(`[data-message-id="${run.message.id}"] .bubble`);if(!body||!node)return;
 const follow=chatFollows(body),oldScroll=body.scrollTop;
 patchHTML(node,messageBubble(run.message));body.scrollTop=follow?body.scrollHeight:oldScroll;updateChatScroll(body);
}
function scheduleChatPaint(run) {
 if(run.paint)return;run.paint=setTimeout(()=>{run.paint=null;paintChatRun(run);},60);
}
async function saveChatRun(run) {
 if(run.store.closed||run.discard)return;
 // A deleted conversation must never be resurrected by a late network event.
 if(!run.store.get(run.id))return;
 await run.store.put('conversation',run.id,run.conv);
}
function queueChatSave(run) {
 if(run.saveTimer)return;run.saveTimer=setTimeout(()=>{run.saveTimer=null;saveChatRun(run).catch(()=>{});},800);
}
async function stopChat({discard=false}={}) {
 const run=chatRun;if(!run)return;run.discard=discard;run.message.stopped=true;run.controller.abort();await run.finished;
}
function mealChatInstruction(intent) {
 if(!intent)return '';
 return `【餐食记录场景】用户通过“记录餐食”入口提交下方文字或照片，意图是分析本次实际吃下的食物并保存饮食记录。默认餐次为按提交时间自动归类的${intent.type}。先读取 get_today_meals，识别食物、份量与营养后调用 create_meal 保存；若是在补充或更正同一餐，使用 update_meal 避免重复入账。数量或食物身份不清时先追问。仅在工具成功后说明已记录，并展示热量和营养估算；如果用户是在咨询、表示尚未吃或取消记录，则按其明确意思回答，不入账。\n用户描述：\n`;
}
async function sendChat(text,retryId=null) {
 if(chatRun)return;
 const store=state.store,user=state.user;
 const owner=attachmentOwner(),attachments=retryId?[]:chatUploads.ready(owner);
 const id=state.conversation||uid(),conv=structuredClone(store.get(id)||{title:text.slice(0,22)||'图片与文件提问',messages:[]});
 let message=retryId?conv.messages.find(m=>m.id===retryId):null;
 if(retryId&&(!message||message.role!=='assistant'))return;
 if(retryId&&conv.messages.at(-1)?.id!==retryId)throw new Error('只能重试最近一条回答，请在当前对话继续提问。');
 const outgoing=retryId?conv.messages.slice(0,conv.messages.indexOf(message)):[...conv.messages];
 if(!retryId&&state.chatScene==='meal')conv.scene='meal';
 if(!retryId){const userMessage={id:uid(),role:'user',content:text||'请帮我分析附件。',attachments,createdAt:new Date().toISOString()};if(state.chatScene==='meal')userMessage.mealIntent={type:mealTypeAt(userMessage.createdAt),createdAt:userMessage.createdAt};outgoing.push(userMessage);conv.messages.push(userMessage);}
 const requestId=message?.requestId||uid();
 message=message||{id:uid(),role:'assistant',content:'',createdAt:new Date().toISOString()};
 Object.assign(message,{content:'',requestId,streaming:true,error:null,stopped:false,toolResults:message.toolResults||[]});
 if(!retryId)conv.messages.push(message);
 const controller=new AbortController(),run={id,conv,message,store,userId:user.id,controller,discard:false};
 let finish;run.finished=new Promise(resolve=>{finish=resolve;});chatRun=run;state.busy=true;
 if(!retryId){captureChatDraft();chatDrafts.delete(state.conversation||'');chatUploads.takeReady(owner);state.files=[];const input=$('#chat-input');if(input){input.value='';input.dataset.conversation=id;resizeComposer(input);}state.conversation=id;}
 try {
   await store.put('conversation',id,conv);if(state.store!==store||controller.signal.aborted)return;
   if(state.page==='chat'&&state.conversation===id){renderChat();followChat();}
   await store.sync();controller.signal.throwIfAborted();
   const aiRelevant=record=>record&&(['plan','calendar-task','schedule','meal'].includes(record.kind)||record.id==='active-plan');
   if([...store.pending.values()].some(aiRelevant)||store.conflicts.some(c=>aiRelevant(store.records.get(c.id))||aiRelevant(c.server)||aiRelevant(c.local)))throw new Error('日程、训练计划或饮食还有待同步或冲突的本机修改。请先在「个人设置 → 数据与同步」处理后重试。');
   if(store.status==='offline')throw new Error('当前离线，消息已保存在本机。联网后可以重试。');
   const response=await streamChat({requestId,messages:outgoing.filter(m=>!m.error&&!m.stopped).slice(-80).map(({role,content,attachments,reasoningContent,toolResults,mealIntent})=>({role,content:mealChatInstruction(mealIntent)+content+(role==='assistant'&&toolResults?.length?'\n[已执行操作回执]\n'+toolResults.map(r=>r.message||r.name).join('\n'):''),attachments,reasoningContent})),context:aiContext()}, {
     userId:user.id,signal:controller.signal,onEvent:(type,data)=>{
       if(state.store!==store||run.discard||controller.signal.aborted)return;
       if(type==='meta'){message.model=data.model;message.provider=data.provider;}
       if(type==='delta')message.content+=data.text||'';
       if(type==='tool_result'){
         if(!message.toolResults.some(r=>JSON.stringify(r)===JSON.stringify(data)))message.toolResults.push(data);
         run.toolSync=(run.toolSync||Promise.resolve()).then(()=>store.sync()).then(()=>{
           if(state.store!==store)return;
           if(state.page==='training'&&!$('#modal').open)renderTraining();
           if(state.page==='nutrition'&&!$('#modal').open)renderNutrition();
           if(state.page==='chat'){const aside=$('.chat-aside');if(aside)aside.outerHTML=contextCards();}
         }).catch(error=>{run.syncError=error.message;});
       }
       scheduleChatPaint(run);queueChatSave(run);
     }
   });
   message.content=response.content??message.content;message.model=response.model||message.model;message.provider=response.provider||message.provider;
   if(response.reasoningContent)message.reasoningContent=response.reasoningContent;
   if(response.toolResults?.length)message.toolResults=response.toolResults;
   if(message.toolResults.length)await store.sync().catch(error=>{run.syncError=error.message;});
   await run.toolSync;
   if(run.syncError)message.error='回答已完成，但记录同步暂未完成：'+run.syncError+'。请点击顶部同步状态重试。';
 } catch(error) {
   if(controller.signal.aborted)message.stopped=true;else message.error=error.message;
 } finally {
   message.streaming=false;clearTimeout(run.saveTimer);clearTimeout(run.paint);
   await saveChatRun(run).catch(error=>{if(state.store===store)toast('回复暂未保存：'+error.message,true);});
   if(chatRun===run){chatRun=null;state.busy=false;}
   if(state.store===store){paintChatRun(run);updateChatControls();renderSidebarHistory();}
   finish();
 }
}

function aiContext() {
 const all=allCalendarTasks(),now=today(),end=addDays(now,28),visibleDates=new Set(weekDates(state.date));
 const relevant=date=>date>=now&&date<=end||visibleDates.has(date);
 const nearby=all.filter(r=>relevant(r.data.date));
 const calendar=nearby.slice(0,200).map(({id,version,data})=>({id,version,data:Object.fromEntries(['taskType','title','date','completed','dayId','planVersion'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]]))}));
 return {knowledge:knowledgeCards,profile:profile(),plan:plan(),nutrition:nutrition(now),date:state.date,localToday:now,timezoneOffset:new Date().getTimezoneOffset(),calendar,calendarTruncated:nearby.length>calendar.length,meals:records('meal').slice(0,35).map(r=>({...r.data,id:r.id,version:r.version})),training:all.filter(r=>r.data.date<=now).sort((a,b)=>b.data.date.localeCompare(a.data.date)).slice(0,20).map(({id,version,data})=>({id,version,...Object.fromEntries(['taskType','title','date','completed','dayId','daySnapshot','planVersion','actual','notes','completedAt'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]]))})),phases:records('phase').slice(0,10).map(r=>r.data),exerciseCatalog:exercises.map(({id,name,muscle,cues,source})=>({id,name,muscle,cues,source}))};
}

function nutritionStats(n,t) {return `${[['kcal','能量','kcal'],['protein','蛋白质','g'],['carbs','碳水化合物','g'],['fat','脂肪','g']].map(([k,l,u])=>`<div class="stat"><small>${l}</small><strong>${numeric(t[k])}<em>/ ${numeric(n[k])} ${u}</em></strong><div class="bar ${k}"><i style="width:${Math.min(100,t[k]/n[k]*100||0)}%"></i></div><p>${t[k]>n[k]?'已超出':'还可摄入'} ${numeric(Math.abs(n[k]-t[k]))} ${u}</p></div>`).join('')}`;}
const adviceCache = new Map();
let adviceMode = 'brief';
function adviceMealFingerprint(date,store=state.store) {
 return JSON.stringify(store.list('meal').filter(r=>r.data.date===date&&r.data.confirmed).sort((a,b)=>a.id.localeCompare(b.id)).map(r=>({id:r.id,...r.data})));
}
function adviceSnapshot() {
 const n=nutrition(),date=state.date;
 const meals=records('meal').filter(r=>r.data.date===date&&r.data.confirmed).map(r=>({id:r.id,type:r.data.type,items:r.data.items,notes:r.data.notes,createdAt:r.data.createdAt||null}));
 const context={date,dayType:dayType(date),profile:profile(),preferences:state.store.get('preferences')||{},meals,balance:nutritionBalance(n,totals(date)),mealTiming:mealAdviceTiming(date,meals)};
 const fingerprint=adviceMealFingerprint(date);
 return {context,fingerprint,recordId:'nutrition-advice:'+date,key:JSON.stringify({user:state.user.id,date,fingerprint}),error:n.error};
}
function savedNutritionAdvice(snapshot) {
 const cached=adviceCache.get(snapshot.key);if(cached)return cached;
 const saved=state.store.get(snapshot.recordId);
 if(saved?.fingerprint===snapshot.fingerprint&&['ready','error'].includes(saved.status))return saved;
 return null;
}
function nutritionAdvice(n) {
 const snapshot=adviceSnapshot(),entry=savedNutritionAdvice(snapshot);
 const configured=!!state.tasks.planning;
 return `<div class="card-head"><div><span class="eyebrow">DAILY BALANCE</span><h3>这一天的营养建议</h3></div>${icon('leaf')}</div><div class="nutrition-panel-scroll" tabindex="0" role="region" aria-label="营养建议，可上下滚动"><div class="advice-tabs" role="group" aria-label="营养建议版本">${[['brief','简略版'],['detailed','详细版']].map(([mode,label])=>`<button type="button" data-action="advice-mode" data-mode="${mode}" aria-pressed="${adviceMode===mode}" class="${adviceMode===mode?'active':''}">${label}</button>`).join('')}</div>${n.error?'':adviceBalanceCards(entry?.balance||snapshot.context.balance)}<div class="advice-result" aria-live="polite">${n.error?`<div class="error-box">${esc(n.error)}</div>`:!configured?`<p class="muted">连接规划建议模型后，即可生成营养建议。</p>${button('配置 AI 模型','advice-settings','','small')}`:entry?.status==='ready'?`${adviceContentCards(entry.data[adviceMode],adviceMode,entry.timing)}<small class="advice-estimate-label">根据当前饮食记录估算 · 未记录的食物不在统计内</small>`:entry?.status==='error'?`<div class="error-box">${esc(entry.error)}</div>`:`<p class="muted" role="status">${entry?.status==='loading'?'正在结合这一天的饮食生成建议…':'记录餐食后自动生成建议，也可点击“更新建议”主动生成。'}</p>`}</div>${configured&&!n.error?`<div class="form-footer">${button(entry?.status==='error'?'重新生成':'更新建议','advice-refresh',entry?.status==='loading'?'disabled':'','small subtle')}</div>`:''}<details class="advice-basis"><summary>查看营养目标依据</summary><p>基础代谢 ${numeric(n.bmr)} kcal · 预计每日总消耗 ${numeric(n.tdee)} kcal</p><small>${esc(n.explanation||'结合个人资料与当天训练估算。')}</small></details></div>`;
}
function paintNutritionAdvice() {
 const el=$('#nutrition-advice');if(el&&state.page==='nutrition')patchHTML(el,nutritionAdvice(nutrition()));
}
async function loadNutritionAdvice(force=false) {
 if(state.page!=='nutrition'||!state.tasks.planning)return;
 const snapshot=adviceSnapshot(),{key,context,error,fingerprint,recordId}=snapshot;if(error)return;
 const existing=savedNutritionAdvice(snapshot);if(existing?.status==='loading'||(!force&&existing))return;
 if(!force&&!context.meals.length&&!state.store.get(recordId))return;
 const store=state.store;
 const userId=state.user.id;
 adviceCache.set(key,{status:'loading'});paintNutritionAdvice();
 try {
   const prompt=`根据当天真实饮食记录，生成分工明确、内容互补的两个版本。
先读取mealTiming：localTime是生成建议时的用户本地时间，recordedTypes是已经记录的餐次，missingMainMeals仅表示缺少记录，并不代表未吃。餐食createdAt是记录创建时间，不能当作实际进餐时间；用户在notes明确的进餐时间、饥饿感和作息应纳入判断。不要推断用户刚吃完、即将入睡或刚训练完。
必须先决定后续是否需要进食，再考虑营养差额。按mealTiming.scenario执行：
- meal：仅围绕nextMeal安排一顿合适的正餐，结合已吃过的食物调整搭配，不能重做已经记录的早餐或午餐。漏记的早前餐次先提示核对，不把差额全部塞进下一顿。当前距离下一顿尚早时，summary应明确“到午餐/晚餐时”，不要求立即进食。
- optional_snack：已有晚餐/三餐，或已到夜间，也必须给出具体饮食建议，不能仅回答“不用吃了”或只复述已经吃完三餐。仍有能量余量时，根据最值得补充的营养提供一份可选的小加餐，foods给出1–2种具体食物及小份量，summary说明适合有饥饿感或确有恢复需求时选择，不要求必须吃或一次补齐差额。不能再安排米饭+肉+菜式完整正餐。若已达标或超出，foods可为空，但summary和tip必须给出针对今日记录的次日具体调整，例如哪一餐调整何种食物、怎样调整份量或烹调方法，不能以空泛提醒代替建议。已记录加餐时结合已吃的内容避免重复推荐。详细版nextStep必须同时说明今晚如何选择及明天优先改善哪一点；即使三餐齐全也要完成分析和行动建议。
- review：历史日期，只分析当天结构与以后可以改进之处，foods必须为空，不安排“现在补吃”或“今晚再吃”来填补过去差额。
- plan：未来日期，只作该日计划，不以当前时刻要求马上吃。
以上餐次与时段规则优先于后面的菜单数量默认值。热量和宏量差额是全天估算参考，不是必须完成的进食任务。summary要简短说明为何建议这顿正餐、可选加餐或不再追加；tip不要与summary重复。只返回以下 JSON，不添加 Markdown 围栏：
{"version":2,"brief":{"summary":"一句下一餐安排","foods":[{"name":"具体食物","portion":"日常单位 + 约克重 + 生熟状态"}],"tip":"一句烹调或替换提示"},"detailed":{"overview":"当天饮食结构的核心判断","findings":[{"title":"一个具体问题或优势","evidence":"来自今天哪些餐、哪些食物的依据","interpretation":"这意味着什么、为什么值得关注","action":"针对这一点的调整方法"}],"nextStep":"结合目标和当天训练状态，说明后续餐次安排与取舍","uncertainty":"本次记录中最影响判断的缺失信息及如何补充"}}
简略版只回答接下来吃什么、吃多少：给一套组合，通常2–4种食物，最多5种；不逐项解释营养学，不罗列多个替代餐；不需要追加摄入时允许foods为空并说明即可。summary最多60字，tip最多80字。组合应贴合剩余能量及三大营养素，考虑烹调油和已有过敏忌口；不能为分别补每种营养叠加几套完整餐。
详细版是分析，不是更长的菜单。overview控制在50–100字；findings选择1–3个最有价值的观察，每项必须给具体记录依据、谨慎解释和可执行调整。按重要程度排序，优先分析蛋白质来源和餐次分布、主食与蔬果结构、烹调油及能量密度中确实有记录支持的方面。指出已经做好的部分，不默认用户一定有问题。不要为了凑栏目编造。nextStep解释为什么这样安排后续饮食，可以讨论训练日/休息日的匹配；没有训练时间就不要编造训练前后时刻。uncertainty只指出本次记录的实际不确定性，例如外卖油量、生熟重、缺失餐次，不输出万能免责声明。
两个版本共用上方营养数字卡，不要再重复“目标/已摄入/剩余/未超出”四套数字，也不要把简略版的食物和份量清单复制到详细版。需要强调差额时只引用与判断直接相关的一项数值，使用balance已算好的值。营养差额只是全天参考，不要求立即吃完或精确补齐，已超出的项不继续强行补足。
区分事实、估算与推断：只能从meals中已有食物得出结论；单日记录不能诊断营养缺乏；没有纤维、钠、维生素数据时只能讨论食物来源和记录是否充分，不能编造摄入值、缺乏结论或医学依据。资料不足就明确说明证据不足并给出需补充的信息。遵守preferences与profile中明确的饮食限制，不要凭空写“未记录过敏”凑字数。
只提供建议，不执行账户修改。不要输出“需确认才可安排”“不改变固定计划”“不创建记录”等界面实现说明，不输出balance等字段名，不写重复的注意事项。所有字段用简洁的中文纯文本，不带序号或项目符号。`;
   const response=await api('/ai',{method:'POST',body:{task:'planning',messages:[{role:'user',content:prompt}],context}});
   if(state.store!==store||adviceMealFingerprint(context.date,store)!==fingerprint)return;
   const entry={status:'ready',data:parseNutritionAdvice(response.content,context.mealTiming),fingerprint,balance:context.balance,timing:context.mealTiming,generatedAt:new Date().toISOString()};
   await store.put('nutrition-advice',recordId,entry);
   adviceCache.set(key,entry);
 }catch(error){
   if(state.store===store&&adviceMealFingerprint(context.date,store)===fingerprint){
     const entry={status:'error',error:error.message,fingerprint};
     adviceCache.set(key,entry);
     await store.put('nutrition-advice',recordId,entry).catch(()=>{});
   }
 }
 finally{if(state.user?.id===userId)paintNutritionAdvice();}
}

function refreshNutritionSummary() {
 const badge=$('#day-type');if(!badge)return;
 const type=dayType(state.date),n=nutrition(),t=totals(state.date);
 badge.dataset.type=type;badge.classList.toggle('neutral',type==='rest');badge.textContent=type==='training'?'训练日':'休息日';
 const stats=$('.stats'),advice=$('#nutrition-advice');
 if(stats)patchHTML(stats,nutritionStats(n,t));
 if(advice)patchHTML(advice,nutritionAdvice(n));
 loadNutritionAdvice();
}
function scheduleFingerprint() {return JSON.stringify({tasks:allCalendarTasks().map(({id,data})=>({id,data})),plan:plan(),profile:profile(),meals:records('meal').map(({id,data})=>({id,data})),preferences:state.store?.get('preferences')});}
function refreshScheduleViews() {
 if(!$('#page'))return;
 const fingerprint=scheduleFingerprint();if(fingerprint===state.scheduleFingerprint)return;
 state.scheduleFingerprint=fingerprint;
 // Update only dependent nutrition panels, including while a meal form is open.
 if(state.page==='nutrition')refreshNutritionSummary();
 if(state.page==='training'){
   if($('#modal').open)state.scheduleRefreshPending=true;
   else renderTraining();
 }
 if(state.page==='chat'){const aside=$('.chat-aside');if(aside)aside.outerHTML=contextCards();}
}

function selectNutritionDate(date) {
 if(date===state.date)return;
 const oldDate=state.date;
 state.date=date;
 renderNutrition();
 const strip=$('.nutrition-date-strip'),buttons=[...strip.querySelectorAll('.nutrition-day')];
 const days=Math.round((new Date(date+'T12:00:00')-new Date(oldDate+'T12:00:00'))/86400000);
 const pitch=buttons[1].offsetLeft-buttons[0].offsetLeft;
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
   buttons.forEach(button=>button.animate([{transform:`translateX(${Math.max(-3,Math.min(3,days))*pitch}px)`},{transform:'translateX(0)'}],{duration:220,easing:'cubic-bezier(.22,.68,.3,1)'}));
 }
 strip.querySelector('.is-selected')?.focus({preventScroll:true});
}
function bindNutritionDateSwipe() {
 const strip=$('.nutrition-date-strip');
 let start=null,suppressClick=false;
 strip.addEventListener('pointerdown',event=>{
   if(!event.isPrimary||event.button!==0)return;
   start={x:event.clientX,y:event.clientY,id:event.pointerId};
   suppressClick=false;
 });
 strip.addEventListener('pointermove',event=>{
   if(!start||event.pointerId!==start.id)return;
   const dx=event.clientX-start.x,dy=event.clientY-start.y;
   if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){
     suppressClick=true;
     strip.classList.add('is-dragging');
     strip.setPointerCapture(event.pointerId);
   }
 });
 strip.addEventListener('pointerup',event=>{
   if(!start||event.pointerId!==start.id)return;
   const dx=event.clientX-start.x,dy=event.clientY-start.y;
   start=null;
   strip.classList.remove('is-dragging');
   if(Math.abs(dx)>=36&&Math.abs(dx)>Math.abs(dy)){
     suppressClick=true;
     selectNutritionDate(addDays(state.date,dx<0?1:-1));
   }
 });
 strip.addEventListener('pointercancel',()=>{start=null;strip.classList.remove('is-dragging');});
 strip.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopPropagation();suppressClick=false;}},true);
}
function nutritionDateStrip() {
 return `<nav class="nutrition-date-strip" aria-label="饮食日期快捷选择">${Array.from({length:9},(_,index)=>{
   const offset=index-4,date=addDays(state.date,offset),day=new Date(date+'T12:00:00');
   return `<button type="button" class="nutrition-day distance-${Math.abs(offset)} ${offset===0?'is-selected':''}" data-action="nutrition-day" data-date="${date}" aria-label="${dateLabel(date)}${date===today()?'，今天':''}" aria-pressed="${offset===0}"><small>${day.getMonth()+1}月</small><strong>${day.getDate()}</strong><span>${date===today()?'今天':['周日','周一','周二','周三','周四','周五','周六'][day.getDay()]}</span></button>`;
 }).join('')}</nav>`;
}
function renderNutrition() {
 const n=nutrition(),t=totals(state.date),meals=records('meal').filter(r=>r.data.date===state.date&&r.data.confirmed);
 $('#page').innerHTML=title('吃得明白，练得有底气。','认真吃好每一餐，比追求完美更重要。',button(icon('plus')+' 记录餐食','new-meal','','primary'))+`<div class="nutrition-date-toolbar"><div class="nutrition-date-meta"><input aria-label="饮食日期" id="nutrition-date" type="date" value="${state.date}"><div class="nutrition-day-type"><output id="day-type" class="badge ${dayType(state.date)==='rest'?'neutral':''}" data-type="${dayType(state.date)}" aria-label="日类型" aria-live="polite">${dayType(state.date)==='training'?'训练日':'休息日'}</output></div></div>${nutritionDateStrip()}</div><div class="stats">${nutritionStats(n,t)}</div><div class="grid-2 nutrition-layout"><section class="card nutrition-scroll-card"><div class="card-head"><div><span class="eyebrow">FOOD DIARY</span><h2>这一天的每一餐</h2></div><span class="badge neutral">${meals.length} 餐已记录</span></div><div class="meal-list nutrition-panel-scroll" tabindex="0" role="region" aria-label="饮食记录，可上下滚动">${meals.length?renderMealGroups(meals):empty('还没有记录餐食<br>拍张照，或用文字描述今天的第一餐。','food')}</div></section><div class="card nutrition-scroll-card" id="nutrition-advice">${nutritionAdvice(n)}</div></div>`;
 bindNutritionDateSwipe();
 $('#page').removeEventListener('wheel',handleNutritionBoundaryWheel);
 $('#page').addEventListener('wheel',handleNutritionBoundaryWheel,{passive:false});
 loadNutritionAdvice();
}
function renderMealGroups(meals) { return ['早餐','午餐','晚餐','加餐'].map(type=>{const group=meals.filter(r=>r.data.type===type);return group.length?`<section class="meal-group"><h3 class="meal-group-title">${mealTypeIcon(type)}${type==='加餐'?'额外饮食':type}</h3>${group.map(renderMeal).join('')}</section>`:'';}).join(''); }
function mealTypeIcon(type) { return icon({'早餐':'sunrise','午餐':'sun','晚餐':'moon','加餐':'snack','额外饮食':'snack'}[type]||'food'); }
function foodSymbol(name='') {
 if(/蛋/.test(name))return icon('egg');
 if(/米饭|面|粥|饭|云吞|馄饨|饺|燕麦|面包/.test(name))return icon('bowl');
 if(/鸡|鸭|肉|鱼|虾|牛|猪/.test(name))return icon('protein');
 if(/奶|酸奶/.test(name))return icon('milk');
 if(/果|橘|橙|蕉|莓|桃|梨|瓜/.test(name))return icon('fruit');
 if(/菜|笋|菇|西兰花|豆/.test(name))return icon('leaf');
 return icon('food');
}
// Empty panels use native scrolling. Only bridge a full panel's boundary,
// accumulating rapid wheel events so smooth scrolling keeps their full distance.
let nutritionPageScrollTarget=null,nutritionPageScrollTime=0;
function handleNutritionBoundaryWheel(event){
 if(event.ctrlKey||event.defaultPrevented||!event.deltaY)return;
 const panel=event.target instanceof Element?event.target.closest('.nutrition-panel-scroll'):null;
 if(!panel)return;
 const max=panel.scrollHeight-panel.clientHeight;
 if(max<=1)return;
 if(event.deltaY<0?panel.scrollTop>1:panel.scrollTop<max-1){nutritionPageScrollTarget=null;return;}
 const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?window.innerHeight:1);
 const now=performance.now(),limit=document.documentElement.scrollHeight-window.innerHeight;
 const previous=nutritionPageScrollTarget;
 if(previous===null||now-nutritionPageScrollTime>200||(previous-window.scrollY)*delta<0)nutritionPageScrollTarget=window.scrollY;
 nutritionPageScrollTarget=Math.max(0,Math.min(limit,nutritionPageScrollTarget+delta));
 nutritionPageScrollTime=now;
 event.preventDefault();
 window.scrollTo({top:nutritionPageScrollTarget,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function adviceBalanceCards(balance) {
 return `<div class="advice-balance">${[['kcal','热量','kcal'],['protein','蛋白质','g'],['carbs','碳水','g'],['fat','脂肪','g']].map(([key,label,unit])=>{const value=balance[key];return `<div class="balance-tile ${key} ${value.excess?'is-excess':''}"><span>${label}</span><strong>${value.excess||value.remaining}<small>${unit}</small></strong><em>${value.excess?'已超出目标':value.remaining?'还可摄入':'已达目标'}</em></div>`;}).join('')}</div>`;
}
function adviceContentCards(content,mode,timing) {
 if(content&&typeof content==='object'){
   if(mode==='brief')return `<div class="advice-brief-view markdown-body"><div class="advice-overview"><span>${icon('food')}</span><div><h4>${esc(timing?.title||'饮食安排')}</h4><p>${esc(content.summary)}</p></div></div><div class="advice-food-grid">${content.foods.map(food=>`<article class="advice-food-card"><span class="food-symbol">${foodSymbol(food.name)}</span><div><strong>${esc(food.name)}</strong><p class="advice-portion">${esc(food.portion)}</p></div></article>`).join('')}</div><div class="advice-practical-tip">${icon('leaf')}<p>${esc(content.tip)}</p></div></div>`;
   return `<div class="advice-detailed-view markdown-body"><div class="advice-overview"><span>${icon('grid')}</span><div><h4>今日饮食分析</h4><p>${esc(content.overview)}</p></div></div><div class="advice-findings">${content.findings.map(item=>`<article class="advice-finding"><h4>${esc(item.title)}</h4><dl><div><dt>记录依据</dt><dd>${esc(item.evidence)}</dd></div><div><dt>分析判断</dt><dd>${esc(item.interpretation)}</dd></div><div class="finding-action"><dt>调整方法</dt><dd>${esc(item.action)}</dd></div></dl></article>`).join('')}</div><section class="advice-next-step"><h4>${icon('calendar')} ${timing?.scenario==='review'?'可以改进的地方':'接下来怎么安排'}</h4><p>${esc(content.nextStep)}</p></section><section class="advice-uncertainty"><h4>还需核实的信息</h4><p>${esc(content.uncertainty)}</p></section></div>`;
 }
 // Saved advice stays readable until a meal changes or the user refreshes it.
 if(mode==='detailed')return `<div class="advice-legacy-detail markdown-body">${renderMarkdown(content)}</div>`;
 const html=renderMarkdown(content),template=document.createElement('template');template.innerHTML=html;
 const items=[...template.content.children].filter(el=>['UL','OL'].includes(el.tagName)).flatMap(el=>[...el.children]);
 if(items.length){
   return `<div class="advice-plan-heading"><span class="advice-plan-mark">${icon(mode==='brief'?'food':'leaf')}</span><div><h4>${mode==='brief'?'下一餐，可以这样搭配':'你的营养补充建议'}</h4><small>${mode==='brief'?'以下食物搭配为一套组合':'结合今日摄入，按需调整'}</small></div></div><div class="advice-food-grid markdown-body">${items.map((item,index)=>`<article class="advice-food-card"><span class="food-symbol" aria-hidden="true">${mode==='brief'?foodSymbol(item.textContent):icon('leaf')}</span><div><span class="food-card-index">${String(index+1).padStart(2,'0')}</span><div>${item.innerHTML}</div></div></article>`).join('')}</div>`;
 }
 return `<div class="advice-text-cards markdown-body">${[...template.content.children].map(el=>`<div class="advice-text-card">${el.outerHTML}</div>`).join('')||html}</div>`;
}
function renderMealNotes(note) {
 return `<div class="meal-notes-layout">${formatMealNotes(note).split(/\n\s*\n/).filter(part=>part && !/^假设与依据[：:]?$/.test(part.trim())).map(part=>{
   const match=part.match(/^(\d{1,2}[)）]|[一二三四五六七八九十]+、)\s*([\s\S]*)$/);
   if(match)return `<div class="meal-note-item"><span class="meal-note-number">${esc(match[1].replace(/[)）、]/g,''))}</span><p>${esc(match[2])}</p></div>`;
   return /^[^\n]{2,12}[：:]$/.test(part)?`<h4>${esc(part.replace(/[：:]$/,''))}</h4>`:`<p class="meal-note-paragraph">${esc(part)}</p>`;
 }).join('')}</div>`;
}
function renderMeal(r) {
 const m=r.data,t=mealTotals(m.items),note=m.estimateNote||m.notes;
 const photo=m.attachments?.find(file=>file.type?.startsWith('image/')&&file.url);
 return `<article class="meal-card meal-visual-card"><div class="meal-visual-head"><span class="meal-cover">${photo?`<img src="${esc(photo.url)}" alt="${esc(m.title||m.type)}照片" loading="lazy">`:`<span aria-hidden="true">${mealTypeIcon(m.type)}</span>`}</span><div class="meal-heading"><small>${esc(m.type==='加餐'?'额外饮食':m.type)} <span class="meal-recorded">已记录</span></small><h3>${esc(m.title||m.type)}</h3></div><button class="button small" data-action="edit-meal" data-id="${esc(r.id)}">修改</button></div><details class="meal-ingredients" open><summary><span>食物明细 <small>· ${m.items.length} 项</small></span><span class="ingredients-toggle"><span class="when-open">收起</span><span class="when-closed">展开</span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span></summary><div class="meal-ingredient-grid">${m.items.map(i=>{const name=i.name||foods.find(f=>f.id===i.foodId)?.name||'食物';return `<div class="meal-ingredient"><span class="food-symbol" aria-hidden="true">${foodSymbol(name)}</span><div><strong>${esc(name)}</strong><span>${numeric(i.grams)}<small> g</small></span></div></div>`;}).join('')}</div></details><div class="meal-macro-grid">${[['kcal','热量','kcal'],['protein','蛋白质','g'],['carbs','碳水','g'],['fat','脂肪','g']].map(([key,label,unit])=>`<div class="meal-macro ${key}"><small>${label}</small><strong>${numeric(t[key])}<em>${unit}</em></strong></div>`).join('')}</div>${note?`<details class="meal-estimate-details"><summary>${icon('spark')} 查看估算依据与说明</summary>${renderMealNotes(note)}</details>`:''}</article>`;
}

function openMeal(id=null) {
 const saved=id?state.store.get(id):null;
 const createdAt=new Date().toISOString();
 state.mealDraft=structuredClone(saved||{date:today(),createdAt,type:mealTypeAt(createdAt),title:'',items:[],notes:'',attachments:[],history:[]});
 state.mealDraft.attachments ||= [];
 state.mealDraft.notes ||= '';
 state.mealDraft._revision='';state.mealDraft._originalAttachmentCount=state.mealDraft.attachments.length;
 state.mealDraft._id=id||uid();state.mealDraft._editing=!!saved;renderMealEditor();
}
function renderMealEditor() {
 const m=state.mealDraft;
 const time=m.createdAt?new Date(m.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'';
 const originalPhotos=m.attachments.slice(0,m._originalAttachmentCount),newPhotos=m.attachments.slice(m._originalAttachmentCount);
 modal('修改这一餐',`<div class="meal-auto-meta"><span class="badge">${esc(m.type==='加餐'?'额外饮食':m.type)}</span><small>${esc(m.date)}${time?' · '+esc(time)+' 创建':''}</small></div><section class="meal-original"><div class="card-head"><h3>当前餐食说明</h3><span class="badge neutral">${m.items.length} 项食物</span></div>${originalPhotos.length?`<div class="meal-photo-preview">${originalPhotos.map(file=>`<div><img src="${esc(file.url)}" alt="${esc(file.name)}" loading="lazy"></div>`).join('')}</div>`:''}${renderMealNotes(m.estimateNote||m.notes||m.items.map(item=>`${item.name} ${item.grams}g`).join('\n\n'))}</section><form id="meal-form" class="meal-revision-form"><div class="row spread wrap"><div><h3>修改这一餐</h3><p class="description">补充实际份量、食材或餐后照片，AI 将更新这条记录。</p></div><div class="row">${button(icon('image')+' 添加照片','meal-photo','','small')}${button('拍照','meal-camera','','small')}</div></div>${newPhotos.length?`<div class="meal-photo-preview">${newPhotos.map((file,index)=>`<div><img src="${esc(file.url)}" alt="${esc(file.name)}"><button type="button" class="icon-button" data-action="remove-meal-file" data-index="${index+m._originalAttachmentCount}" aria-label="移除 ${esc(file.name)}">×</button></div>`).join('')}</div>`:''}<label for="meal-notes">本次修改说明</label><textarea id="meal-notes" name="revision" maxlength="4000" placeholder="例如：粥只吃了一半；红枣实际有 3 颗；这张是餐后剩余的照片。可以只上传图片，也可以只填写文字。">${esc(m._revision)}</textarea><div id="meal-ai-error" role="alert"></div><div class="form-footer">${button('删除此餐','delete-meal',`data-id="${m._id}"`,'danger')}<button type="button" class="button primary" data-action="meal-ai">${icon('spark')} AI 分析并更新</button></div></form>`,true);
}

function readMealForm() {
 const input=$('#meal-notes');if(input)state.mealDraft._revision=input.value;
}
async function saveMeal() {
 readMealForm();const m=state.mealDraft;
 if(!m.items.length)throw new Error('未识别到食物，请补充照片或说明后重试。');
 mealTotals(m.items);
 const {_id,_editing,_busy,_revision,_originalAttachmentCount,...data}=m;data.confirmed=true;data.updatedAt=new Date().toISOString();
 await state.store.put('meal',_editing?_id:'meal:'+_id,data);
 closeModal();state.date=m.date;state.page='nutrition';render();toast(_editing?'这一餐已更新':'这一餐已计入饮食记录');
}

function lockMealEditor(locked,message='') {
 const modalEl=$('#modal');
 modalEl.oncancel=locked?event=>event.preventDefault():null;
 modalEl.querySelectorAll('button,input,textarea,select').forEach(el=>{el.disabled=locked;});
 const action=$('[data-action="meal-ai"]');
 if(action)action.innerHTML=locked?esc(message):icon('spark')+(state.mealDraft?._editing?' AI 分析并更新':' AI 分析并记录');
}
async function estimateMeal() {
 if(state.mealDraft?._busy)return;
 readMealForm();const m=state.mealDraft;
 if(!m._revision.trim()&&m.attachments.length<=m._originalAttachmentCount)throw new Error('请填写本次修改说明，或添加新照片。');
 m._busy=true;lockMealEditor(true,'正在分析营养与热量…');$('#meal-ai-error').innerHTML='';
 const userId=state.user.id;
 try {
 const instruction='请估算这同一餐实际吃下的食物；区分餐前餐后及营养标签，结合原估算修订。只返回 JSON {"items":[{"name":"食物名称（注明生熟）","grams":实际克数,"kcal":每100克热量,"protein":每100克蛋白质,"carbs":每100克碳水,"fat":每100克脂肪}],"note":"依据和不确定性"}。所有数值非负。份量不明确时按常见份量估算并说明假设，无法识别食物时返回空 items。不要执行账户写入，由应用在校验成功后保存。';
 const response=await api('/ai',{method:'POST',body:{task:'meal',messages:[{role:'user',content:instruction+'\n原餐食说明：'+m.notes+'\n本次用户修改（以本次为准）：'+m._revision+'\n附件顺序：前'+m._originalAttachmentCount+'张是原照片，其余为本次补充照片，用于修订同一餐，不要重复累加。'+'\n已有估算：'+JSON.stringify(m.items)+'\n之前修订：'+JSON.stringify(m.history||[]),attachments:m.attachments}],context:aiContext()}});
 if(state.user?.id!==userId||state.mealDraft!==m)return;
 const parsed=parseMealEstimate(response.content);
 m.items=parsed.items;m.estimateNote=parsed.note;
 if(m._revision.trim())m.notes=m._revision.trim();
 m.history=[...(m.history||[]),{notes:m._revision,result:parsed.note,createdAt:new Date().toISOString()}].slice(-8);
 await saveMeal();
 }catch(error){if(state.mealDraft===m&&$('#meal-ai-error'))$('#meal-ai-error').innerHTML=`<div class="error-box">${esc(error.message)}<br>本次分析未保存，可保留照片和说明重试。</div>`;}
 finally{m._busy=false;if(state.mealDraft===m&&$('#meal-form'))lockMealEditor(false);}
}


function calendarTask(id) {return allCalendarTasks().find(r=>r.id===id);}
function taskDay(task) {return task?.data.daySnapshot||plan()?.days.find(day=>day.id===task?.data.dayId);}
function assertTaskCurrent(snapshot) {
 const current=calendarTask(snapshot?.id);
 if(!current||JSON.stringify(current.data)!==JSON.stringify(snapshot.data))throw new Error('这项任务已在其他位置更新，请关闭窗口后重新打开。');
 return current;
}
function renderCalendarCard(record) {
 const task=record.data;
 return `<article class="calendar-task training-task ${task.completed?'task-completed':''}" data-task-id="${esc(record.id)}" draggable="${!task.completed}"><div class="task-card-top"><span class="task-kind">${icon('dumbbell')}${task.completed?'已完成':'训练'}</span>${!task.completed?'<span class="task-drag-handle" aria-hidden="true">⠿</span>':icon('check')}</div><button type="button" class="task-open" data-action="calendar-detail" data-id="${esc(record.id)}" aria-label="查看 ${esc(task.title)}"><strong>${esc(task.title)}</strong></button>${task.notes?`<p class="task-note">${esc(task.notes)}</p>`:''}<div class="task-card-bottom"><small>${taskDay(record)?.exercises?.length||0} 个动作</small>${!task.completed?button('调整','calendar-edit',`data-id="${esc(record.id)}" aria-label="调整 ${esc(task.title)} 的日期"`,'small'):button('查看','calendar-detail',`data-id="${esc(record.id)}"`,'small')}</div></article>`;
}
function renderTraining() {
 const days=weekDates(state.date),p=plan(),draft=state.store.get('plan-draft'),weekTasks=allCalendarTasks().filter(r=>days.includes(r.data.date));
 $('#page').innerHTML=title('把训练，变成自己的节奏。','按天安排训练，记录每一次认真完成的练习。',button(icon('plus')+' 添加训练','calendar-add',`data-date="${state.date}"`,'primary'))+`<section class="timetable-shell"><div class="timetable-toolbar"><div class="week-navigation">${button('‹','calendar-week','data-offset="-7" aria-label="上一周"','small')}<div><strong>${dateLabel(days[0]).replace(/星期.*/,'')} — ${dateLabel(days[6]).replace(/星期.*/,'')}</strong><small>${days[0].slice(0,4)} · 本周 ${weekTasks.length} 项训练</small></div>${button('›','calendar-week','data-offset="7" aria-label="下一周"','small')}</div><div class="row wrap">${button('本周','calendar-today','','small')}<input type="date" id="training-date" value="${state.date}" aria-label="训练日期"></div></div><p class="timetable-hint">拖动训练卡片更换日期，也可点击「调整」。今日饮食会随当天训练安排自动切换训练日或休息日。</p><div class="timetable-scroll" tabindex="0" aria-label="每周训练表，可横向滚动"><div class="timetable" role="table" aria-label="本周训练计划"><div class="timetable-heading" role="row">${days.map((date,i)=>`<div class="timetable-date ${date===today()?'is-today':''} ${date===state.date?'is-selected':''}" role="columnheader"><button data-action="training-day" data-date="${date}" aria-label="${dateLabel(date)}"><span>${['周一','周二','周三','周四','周五','周六','周日'][i]}</span><strong>${Number(date.slice(-2))}</strong>${date===today()?'<em>今天</em>':''}</button></div>`).join('')}</div><div class="timetable-days" role="row">${days.map(date=>{const items=weekTasks.filter(r=>r.data.date===date);return `<div class="timetable-cell ${date===today()?'is-today':''}" data-date="${date}" role="cell" aria-label="${dateLabel(date)}训练">${items.length?items.map(renderCalendarCard).join(''):'<div class="calendar-rest"><span>休息日</span><small>放松一下，恢复体力</small></div>'}<button type="button" class="calendar-cell-add" data-action="calendar-add" data-date="${date}" aria-label="添加 ${dateLabel(date)}训练">＋<span> 添加训练</span></button></div>`;}).join('')}</div></div></div><div class="calendar-status" role="status" aria-live="polite">已完成的训练保留原日期与记录。</div></section>${draft?`<div class="draft-strip row spread"><div><strong>有一份尚未确认的训练草案</strong><p>确认后，可以把训练添加到日程表。</p></div>${button('查看草案','view-draft','','small')}</div>`:''}<details class="training-plan-panel"><summary><div>${icon('dumbbell')}<span><strong>${p?esc(p.name):'创建你的训练内容'}</strong><small>${p?`${p.days.length} 天循环 · 查看动作与组数`:'先创建训练内容，再安排训练日期'}</small></span></div><span class="plan-disclosure">展开⌄</span></summary><div class="training-plan-content"><div class="row spread wrap"><h2>我的训练内容</h2><div class="row wrap">${button(p?'修改计划':'创建计划','plan-builder','','primary small')}${button('最大力量估算','strength','','small')}</div></div>${p?`<div class="plan-days">${p.days.map((d,i)=>`<div class="plan-day"><div class="row spread"><h3><span class="step-badge">${i+1}</span>${esc(d.name)}</h3><small>${d.rest?'恢复':d.exercises.length+' 个动作'}</small></div>${d.exercises.map((e,j)=>exerciseLine(e,j)).join('')}</div>`).join('')}</div><p class="description">${esc(p.source)}</p>`:empty('在这里创建训练内容，或在 AI 对话中让我安排训练。','dumbbell')}</div></details>${p?'':`<div class="calendar-start"><span>还没有训练内容？从适合自己的计划开始。</span>${button('创建训练计划','plan-builder','','small')}</div>`}`;
 bindCalendarDrag();
}
function bindCalendarDrag() {
 const table=$('.timetable');if(!table)return;let dragRecord=null;
 table.addEventListener('dragstart',event=>{const card=event.target.closest('.calendar-task'),record=card&&calendarTask(card.dataset.taskId);if(!record||record.data.completed){event.preventDefault();return;}dragRecord=structuredClone(record);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-fitness-task',record.id);card.classList.add('dragging');});
 table.addEventListener('dragend',()=>{dragRecord=null;table.querySelectorAll('.drop-target,.dragging').forEach(node=>node.classList.remove('drop-target','dragging'));});
 table.addEventListener('dragover',event=>{const cell=event.target.closest('.timetable-cell');if(!cell||!dragRecord)return;event.preventDefault();event.dataTransfer.dropEffect='move';table.querySelectorAll('.drop-target').forEach(node=>node.classList.remove('drop-target'));cell.classList.add('drop-target');});
 table.addEventListener('dragleave',event=>{const cell=event.target.closest('.timetable-cell');if(cell&&!cell.contains(event.relatedTarget))cell.classList.remove('drop-target');});
 table.addEventListener('drop',async event=>{const cell=event.target.closest('.timetable-cell');if(!cell||!dragRecord)return;event.preventDefault();const snapshot=dragRecord;dragRecord=null;try{const record=assertTaskCurrent(snapshot);if(record.data.completed)throw new Error('已完成的训练保留原日期，不能移动。');const date=cell.dataset.date;if(date===record.data.date){table.querySelectorAll('.drop-target,.dragging').forEach(node=>node.classList.remove('drop-target','dragging'));return;}const data={...record.data,date};await state.store.put(record.kind,record.id,data);renderTraining();toast(`已移到 ${dateLabel(date)}`);}catch(error){table.querySelectorAll('.drop-target,.dragging').forEach(node=>node.classList.remove('drop-target','dragging'));toast(error.message,true);}});
}
function openCalendarTask(id=null,date=state.date) {
 const record=id?calendarTask(id):null;if(id&&!record)throw new Error('这项训练已被删除，请刷新训练表。');if(record?.data.completed){showCalendarTask(id);return;}
 const data=record?.data||{taskType:'training',title:'',date,notes:''};
 state.calendarEditor={record:record&&structuredClone(record)};
 modal(record?'调整训练':'添加训练',`<p class="description">选择训练内容与日期。同一天可以安排多项训练。</p><form id="calendar-task-form" data-id="${esc(id||'')}" data-version="${record?.version||0}"><input type="hidden" name="taskType" value="training"><div class="form-grid"><div class="full"><label for="task-date">训练日期</label><input id="task-date" name="date" type="date" value="${esc(data.date)}" required></div><div class="full"><label for="task-day">训练内容</label><select id="task-day" name="dayId" required>${options([['','选择已创建的训练内容'],...(plan()?.days.filter(d=>!d.rest)||[]).map(d=>[d.id,d.name]),...(data.dayId&&!plan()?.days.some(d=>d.id===data.dayId)?[[data.dayId,data.daySnapshot?.name||data.title+'（原计划）']]:[])],data.dayId||'')}</select>${!plan()?`<p class="description">先创建训练内容，再添加训练任务。${button('创建训练计划','plan-builder','','small')}</p>`:''}</div><div class="full"><label for="task-title">训练名称</label><input id="task-title" name="title" value="${esc(data.title)}" placeholder="例如：胸肩训练" maxlength="80" required></div><div class="full"><label for="task-notes">备注</label><textarea id="task-notes" name="notes" maxlength="2000" placeholder="地点、准备事项或其他提醒">${esc(data.notes||'')}</textarea></div></div><div id="calendar-task-error" role="alert"></div><div class="form-footer">${button('取消','close-modal')}<button type="submit" class="button primary">保存训练</button></div></form>`);
}
async function saveCalendarTask(values) {
 const original=state.calendarEditor?.record,record=original?assertTaskCurrent(original):null;
 if(record?.data.completed)throw new Error('已完成的训练不能修改日期或内容。');
 const data={...(record?.data||{}),...validateCalendarTask({...values,taskType:'training',completed:false}),completed:false};
 const selected=plan()?.days.find(day=>day.id===values.dayId&&!day.rest),preserved=record?.data.dayId===values.dayId&&record.data.daySnapshot;
 if(!selected&&!preserved)throw new Error('请先选择有效的训练内容。');
 Object.assign(data,{dayId:values.dayId,daySnapshot:structuredClone(preserved||selected),planVersion:preserved?record.data.planVersion:plan().planVersion,rest:false});
 await state.store.put(record?.kind||'calendar-task',record?.id||'task:'+uid(),data);state.date=data.date;closeModal();renderTraining();toast(record?'训练已更新':'已添加到训练表');
}
function showCalendarTask(id) {
 const record=calendarTask(id);if(!record)throw new Error('这项训练已被删除。');const data=record.data,day=taskDay(record);state.calendarDetail=structuredClone(record);
 modal(esc(data.title),`<div class="row wrap"><span class="badge">训练任务</span>${data.completed?'<span class="badge">已完成</span>':''}</div><p class="description">${dateLabel(data.date)}</p>${data.notes?`<div class="notice calendar-task-notes">${esc(data.notes)}</div>`:''}${day?`<h3>${esc(day.name)}</h3>${day.exercises.map((exercise,i)=>exerciseLine(exercise,i)).join('')}`:''}${data.completed&&data.actual?.length?`<div class="notice" style="margin-top:18px"><strong>实际完成</strong><br>${data.actual.map(a=>`${esc(exercises.find(e=>e.id===a.exerciseId)?.name||a.exerciseId)}：${a.sets} 组 × ${esc(a.reps)} 次，${a.weight} kg`).join('<br>')}</div>`:''}<div class="form-footer">${!data.completed?`${button('删除训练','calendar-delete',`data-id="${esc(id)}"`,'danger')}${button('调整日期','calendar-edit',`data-id="${esc(id)}"`)}`:''}${day?button(data.completed?'修改实际训练':'记录实际训练','log-training',`data-id="${esc(id)}"`,'primary'):''}</div>`);
}
function exerciseLine(e,i) {const x=exercises.find(x=>x.id===e.exerciseId);return `<div class="exercise-line"><span class="number">${String(i+1).padStart(2,'0')}</span><div class="grow"><button class="link-button" style="padding:0;text-align:left" data-action="exercise" data-id="${esc(e.exerciseId)}"><strong>${esc(x?.name||e.exerciseId)}</strong></button><small>${esc(x?.muscle||'')} · 休息 ${e.restSeconds}s</small></div><span class="rep">${e.sets} × ${esc(e.reps)}</span></div>`;}
function planBuilder() {
 modal(plan()?'生成修改草案':'找到适合你的训练循环',`<p class="description">选择分化方式，生成可编辑草案。确认后才会替换固定计划。</p><form id="plan-form"><div class="form-grid"><div><label for="split">训练分化</label><select id="split" name="split">${options([[2,'二分化 · 全身 A / B'],[3,'三分化 · 背 / 胸 / 腿'],[4,'四分化 · 细分肌群'],[5,'五分化 · 专项训练']],3)}</select></div><div><label for="variant">模板变式</label><select id="variant" name="variant">${variantOptions(3)}</select></div></div><div class="notice" style="margin-top:20px">三、四分化参考项目 Excel 模板；二、五分化为扩展模板。生成后可调整动作、组数、次数与休息时间。</div><div class="form-footer"><button class="button primary" type="submit">生成循环草案 ${icon('arrow')}</button></div></form>`);
}
function variantOptions(split) { return options((planVariants[split]||['standard']).map(x=>[x,{standard:'标准模板',home:'居家训练',shoulders:'肩部单练',arms:'手臂单练'}[x]]),'standard'); }
function viewDraft() {
 const d=state.store.get('plan-draft');if(!d)return;
 modal('调整并确认训练草案',`<div class="notice">${plan()?'现有计划仍在使用。确认此草案后，才会更新固定训练内容。':'按你的器械和能力调整，准备好后再固定计划。'}</div><form id="draft-form" style="margin-top:20px"><div class="field"><label for="plan-name">计划名称</label><input name="name" id="plan-name" value="${esc(d.name)}" maxlength="80" required></div><div class="plan-days">${d.days.map((day,i)=>`<section class="plan-day"><div class="row spread"><h3><span class="step-badge">${i+1}</span>${esc(day.name)}</h3><small>${day.rest?'休息与恢复':'可调整'}</small></div>${day.rest?'':`<div class="food-table-wrap"><table class="food-table"><thead><tr><th>动作</th><th>组数</th><th>次数 / 秒</th><th>休息 s</th></tr></thead><tbody>${day.exercises.map((e,j)=>`<tr><td><select name="e-${i}-${j}" aria-label="第${i+1}天动作${j+1}">${options(exercises.map(x=>[x.id,x.name]),e.exerciseId)}</select></td><td><input name="s-${i}-${j}" aria-label="组数" type="number" min="1" max="12" value="${e.sets}" required></td><td><input name="r-${i}-${j}" aria-label="次数" value="${esc(e.reps)}" maxlength="30" required></td><td><input name="t-${i}-${j}" aria-label="休息秒数" type="number" min="15" max="600" value="${e.restSeconds}" required></td></tr>`).join('')}</tbody></table></div>`}</section>`).join('')}</div><p class="description" style="margin-top:20px">${esc(Array.isArray(d.notes)?d.notes.join('；'):d.notes)}</p><div class="form-footer">${button('放弃草案','discard-plan')}<button class="button primary" type="submit">确认并固定计划</button></div></form>`,true);
}
function logTraining(id) {
 const record=id?calendarTask(id):scheduledRecord(state.date),s=record?.data,day=taskDay(record);if(!day)throw new Error('这项任务没有可记录的训练内容。');state.trainingLog=structuredClone(record);
 modal(s.completed?'修改实际训练':'记录实际训练',`<p class="description">${s.date} · ${esc(day.name)}。按实际完成情况填写。</p><form id="training-log" data-task-id="${esc(record.id)}"><div class="food-table-wrap"><table class="food-table"><thead><tr><th>动作</th><th>完成组数</th><th>每组次数 / 秒</th><th>重量 kg</th></tr></thead><tbody>${day.exercises.map((e,i)=>{const actual=s.actual?.[i]||e;return `<tr><td>${esc(exercises.find(x=>x.id===e.exerciseId)?.name)}</td><td><input name="sets-${i}" aria-label="完成组数" type="number" min="0" max="30" value="${actual.sets}" required></td><td><input name="reps-${i}" aria-label="实际次数" value="${esc(actual.reps)}" maxlength="40" required></td><td><input name="weight-${i}" aria-label="实际重量" type="number" min="0" max="1000" step="0.5" value="${actual.weight||0}" required></td></tr>`;}).join('')}</tbody></table></div><div class="field" style="margin-top:20px"><label for="training-notes">体感与备注</label><textarea name="notes" id="training-notes" maxlength="2000" placeholder="例如：最后两次比较吃力，下次保持重量。">${esc(s.notes||'')}</textarea></div><div class="form-footer"><button class="button primary" type="submit">保存完成记录</button></div></form>`,true);
}
function strengthTool() {modal('最大力量估算',`<p class="description">用最近完成的一组记录，查看 Epley 与 Brzycki 的参考估算。</p><form id="strength-form"><div class="form-grid"><div><label for="strength-weight">使用重量（kg）</label><input id="strength-weight" name="weight" type="number" min="0.5" max="1000" step="0.5" value="40" required></div><div><label for="strength-reps">完成次数</label><input id="strength-reps" name="reps" type="number" min="1" max="15" value="8" required></div></div><div class="form-footer"><button class="button primary">计算参考结果</button></div></form><div id="strength-result"></div>`);}

function sourceLink(name,url) {return url?`<a class="knowledge-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name||'查看来源')} ↗</a>`:`<small class="knowledge-source">${esc(name||'')}</small>`;}
function knowledgeSources() {return `<details class="knowledge-sources"><summary>知识来源与说明</summary><div class="source-grid">${knowledgeCards.map(card=>`<article><strong>${esc(card.title)}</strong><p>${esc(card.summary)}</p>${sourceLink(card.sourceName,card.sourceUrl)}</article>`).join('')}</div></details>`;}
function renderLibrary() {
 const tabs=[['nutrition','营养计算','营养公式与工具'],['portions','食物份量','日常份量换算'],['exercises','3D 动作','动作示意与要领'],['muscles','肌肉图谱','找到目标肌群']];
 $('#page').innerHTML=title('看懂原理，练得更有把握。','从营养计算到动作与肌肉，把知识用在每一天。')+`<nav class="knowledge-tabs" role="tablist" aria-label="知识类别">${tabs.map(([id,label,desc])=>`<button id="knowledge-tab-${id}" type="button" role="tab" tabindex="${state.knowledgeTab===id?0:-1}" aria-selected="${state.knowledgeTab===id}" aria-controls="knowledge-panel" data-action="knowledge-tab" data-tab="${id}" class="${state.knowledgeTab===id?'active':''}"><strong>${label}</strong><small>${desc}</small></button>`).join('')}</nav><section id="knowledge-panel" role="tabpanel" aria-labelledby="knowledge-tab-${state.knowledgeTab}"></section>${knowledgeSources()}`;
 const renderPanel={nutrition:renderNutritionTools,portions:renderPortionTools,exercises:renderExerciseLibrary,muscles:renderMuscleLibrary};
 (renderPanel[state.knowledgeTab]||renderNutritionTools)();
}
function toolField(id,label,name,value,attributes='') {return `<div><label for="${id}">${label}</label><input id="${id}" name="${name}" type="number" value="${esc(value)}" ${attributes} required></div>`;}
function renderNutritionTools() {
 const p=profile()||{},m=knowledgeDrafts.metabolism||{sex:p.sex||'male',age:p.age||28,height:p.height||175,weight:p.weight||70,activity:p.activity||1.375},macro=knowledgeDrafts.macro||{protein:120,carbs:250,fat:60};
 $('#knowledge-panel').innerHTML=`<div class="knowledge-tool-grid"><section class="card tool-card"><div class="card-head"><div><span class="eyebrow">ENERGY ESTIMATE</span><h2>基础代谢与每日消耗</h2></div>${icon('body')}</div><p class="tool-intro">输入身体数据与活动水平，查看静息能量消耗和全天消耗的估算。</p><form id="metabolism-form" novalidate><div class="form-grid"><div><label for="calc-sex">公式性别参数</label><select id="calc-sex" name="sex">${options([['male','男'],['female','女']],m.sex)}</select></div>${toolField('calc-age','年龄（岁）','age',m.age,'min="18" max="100" step="1"')}${toolField('calc-height','身高（cm）','height',m.height,'min="130" max="230" step="0.1"')}${toolField('calc-weight','体重（kg）','weight',m.weight,'min="35" max="300" step="0.1"')}<div class="full"><label for="calc-activity">活动系数</label><select id="calc-activity" name="activity">${options([[1.2,'1.2 · 久坐为主'],[1.375,'1.375 · 轻度活动'],[1.55,'1.55 · 中等活动'],[1.725,'1.725 · 较高活动'],[1.9,'1.9 · 很高活动']],m.activity)}</select></div></div><div id="metabolism-error" class="tool-error" role="alert"></div><div class="form-footer"><button class="button primary" type="submit">计算消耗</button></div></form><div id="metabolism-result" class="tool-result-panel" aria-live="polite"></div><small class="tool-footnote">在这里试算，不会更改个人资料或今日饮食目标。</small></section><section class="card tool-card"><div class="card-head"><div><span class="eyebrow">MACRO ENERGY</span><h2>三大营养素与热量</h2></div>${icon('food')}</div><p class="tool-intro">输入蛋白质、碳水与脂肪的克数，查看热量合计和能量占比。</p><form id="macro-energy-form" novalidate><div class="form-grid">${toolField('calc-protein','蛋白质（g）','protein',macro.protein,'min="0" max="1000" step="0.1"')}${toolField('calc-carbs','碳水化合物（g）','carbs',macro.carbs,'min="0" max="2000" step="0.1"')}${toolField('calc-fat','脂肪（g）','fat',macro.fat,'min="0" max="1000" step="0.1"')}</div><div id="macro-energy-error" class="tool-error" role="alert"></div><div class="form-footer"><button class="button primary" type="submit">计算热量</button></div></form><div id="macro-energy-result" class="tool-result-panel" aria-live="polite"></div></section></div><div class="knowledge-formulas">${formulaCards.map(card=>`<article class="formula-card"><span class="eyebrow">FORMULA</span><h3>${esc(card.title)}</h3><p class="formula-expression">${esc(card.formula)}</p><p>${esc(card.description)}</p>${sourceLink(card.sourceName,card.sourceUrl)}</article>`).join('')}</div>`;
 updateKnowledgeTool($('#metabolism-form'));updateKnowledgeTool($('#macro-energy-form'));
}
function renderPortionTools() {
 const d=knowledgeDrafts.portion||{foodId:foodPortions[0]?.id,count:1,grams:foodPortions[0]?.grams};
 $('#knowledge-panel').innerHTML=`<div class="portion-layout"><section class="card tool-card"><div class="card-head"><div><span class="eyebrow">EVERYDAY PORTIONS</span><h2>一份食物，含有多少营养？</h2></div>${icon('food')}</div><p class="tool-intro">盒、个、杯的大小各有不同。选择常见份量，也可以按实际可食重量调整。</p><form id="portion-form" novalidate><div class="form-grid"><div class="full"><label for="portion-food">选择食物份量</label><select id="portion-food" name="foodId">${options(foodPortions.map(item=>[item.id,item.label]),d.foodId)}</select></div>${toolField('portion-count','份数','count',d.count,'min="0.1" max="100" step="0.1"')}${toolField('portion-grams','每份可食重量（g）','grams',d.grams,'min="1" max="5000" step="1"')}</div><div id="portion-error" class="tool-error" role="alert"></div><div class="form-footer"><button class="button primary" type="submit">换算营养</button></div></form><div id="portion-result" class="tool-result-panel" aria-live="polite"></div></section><section class="portion-reference"><h3>常见份量参考</h3><div class="portion-grid">${foodPortions.map(item=>`<button class="portion-preset" type="button" data-action="portion-preset" data-id="${esc(item.id)}"><span>${icon('food')}</span><strong>${esc(item.label)}</strong><small>每份 ${item.grams} g 可食部分</small></button>`).join('')}</div><p>熟饭按熟重计算；鸡蛋按去壳后的重量计算。包装食品优先核对实际营养标签。</p></section></div>`;
 updateKnowledgeTool($('#portion-form'));
}
function updateKnowledgeTool(form) {
 if(!form)return;
 const values=formData(form),id=form.id,kind=id==='metabolism-form'?'metabolism':id==='macro-energy-form'?'macro':'portion',prefix=kind==='macro'?'macro-energy':kind;
 knowledgeDrafts[kind]=values;
 const output=$('#'+prefix+'-result'),errorBox=$('#'+prefix+'-error');if(!output||!errorBox)return;
 try {
   let html='';
   if(kind==='metabolism'){
     const result=calculateMetabolism(values);
     html=`<div class="tool-numbers"><div><small>静息能量消耗</small><strong>${numeric(result.ree)}<em> kcal / 天</em></strong></div><div><small>全天总消耗估算</small><strong>${numeric(result.tdee)}<em> kcal / 天</em></strong></div></div><p>${esc(result.note)}</p>`;
   }else if(kind==='macro'){
     const result=calculateMacroEnergy(values);
     html=`<div class="tool-total"><small>热量合计</small><strong>${numeric(result.kcal)}<em> kcal</em></strong></div><div class="macro-energy-breakdown">${[['protein','蛋白质'],['carbs','碳水'],['fat','脂肪']].map(([key,label])=>`<div><span>${label}</span><strong>${numeric(result[key+'Kcal'])} kcal</strong><small>${Math.round(result[key+'Share']*10)/10}% 能量占比</small></div>`).join('')}</div>`;
   }else{
     const result=calculateFoodPortion(values.foodId,{count:values.count,grams:values.grams});
     html=`<div class="row spread wrap"><strong>${esc(result.label)}</strong><span class="badge">共 ${result.grams} g</span></div><div class="portion-totals">${[['kcal','热量','kcal'],['protein','蛋白质','g'],['carbs','碳水','g'],['fat','脂肪','g']].map(([key,label,unit])=>`<div><small>${label}</small><strong>${Math.round(result[key]*10)/10}<em> ${unit}</em></strong></div>`).join('')}</div><p>${esc(result.note)}</p>${sourceLink(result.source)}`;
   }
   errorBox.innerHTML='';patchHTML(output,html);output.hidden=false;
 }catch(error){output.hidden=true;errorBox.innerHTML=`<div class="error-box">${esc(error.message)}</div>`;}
}
function choosePortion(id) {
 const item=foodPortions.find(item=>item.id===id);if(!item)return;
 $('#portion-food').value=id;$('#portion-grams').value=item.grams;updateKnowledgeTool($('#portion-form'));
}
function renderExerciseLibrary() {
 const filtered=exercises.filter(x=>(x.name+x.muscle+x.equipment).includes(state.filter)&&(!state.muscle||x.muscle.includes(state.muscle))&&(!state.equipment||x.equipment.includes(state.equipment)));
 // 只要目录里任何一个动作收录了真人封面，整个网格就统一按 3:2 排布，否则同一行里封面卡和矢量卡高低不齐。
 const hasCovers=exercises.some(x=>coverUrl(x.id));
 $('#knowledge-panel').innerHTML=`<div class="search-row"><input id="exercise-search" type="search" placeholder="搜索动作、肌肉或器械…" aria-label="搜索动作" value="${esc(state.filter)}"><select id="muscle-filter" aria-label="按肌肉筛选">${options([['','全部肌群'],['胸','胸部'],['背','背部'],['三角','肩部'],['二头','肱二头肌'],['三头','肱三头肌'],['股','腿部'],['臀','臀部'],['腹','核心']],state.muscle)}</select><select id="equipment-filter" aria-label="按器械筛选">${options([['','全部器械'],['徒手','徒手'],['哑铃','哑铃'],['器','固定器械']],state.equipment)}</select></div><div class="row spread wrap" style="margin-bottom:18px"><small>${filtered.length} 个动作</small><span class="badge neutral">3D 姿态 · 目标肌群 · 动作要领</span></div><div class="exercise-grid"${hasCovers?' data-covers="1"':''}>${filtered.map((x,i)=>{const cover=coverUrl(x.id);return `<button class="exercise-card" data-action="exercise" data-id="${x.id}"><div class="exercise-visual"${cover?' data-cover="1"':''}>${icon('body')}${cover?`<img class="exercise-cover" src="${cover}" alt="" loading="${i<3?'eager':'lazy'}" decoding="async">`:''}<span class="letter">${String(i+1).padStart(2,'0')}</span><span class="badge">${x.demo?'◉ 3D 动作演示':'◉ 3D 姿态示意'}</span></div><div class="exercise-info"><h3>${esc(x.name)} <span style="float:right;color:#9eab93">↗</span></h3><p>${esc(x.muscle)}</p><p style="margin-top:9px">${esc(x.equipment)} · ${esc(x.level)}</p></div></button>`}).join('')}</div>${!filtered.length?empty('没有找到相关动作，试试其他关键词。','grid'):''}`;
}
function renderMuscleLibrary() {
 $('#knowledge-panel').innerHTML=`<div class="atlas-intro"><div><span class="eyebrow">MUSCLE ATLAS</span><h2>找到你正在训练的肌肉。</h2><p>旋转模型查看位置。选择肌群，可以打开对应的高亮图谱。</p><div class="row wrap"><span class="badge">${muscleCatalog.length} 个肌群与肌肉</span><span class="badge neutral">可旋转 / 缩放</span></div></div><iframe class="knowledge-atlas-frame" src="${esc(modelUrl('muscle','chest',{compact:true}))}" title="胸部肌群3D图谱预览" loading="lazy" allow="fullscreen"></iframe></div><div class="muscle-grid">${muscleCatalog.map(muscle=>`<button class="muscle-card" type="button" data-action="muscle-model" data-id="${esc(muscle.id)}"><span class="muscle-icon">${icon('body')}</span><div><strong>${esc(muscle.name)}</strong><p>${esc(muscle.description)}</p><small>查看 3D 高亮 ↗</small></div></button>`).join('')}</div>`;
}
function showMuscle(id) {
 const muscle=muscleCatalog.find(item=>item.id===id);if(!muscle)return;
 modelViewer.open({type:muscle.structure?'structure':'muscle',id:muscle.structure||muscle.id,title:muscle.name,url:modelUrl('muscle',id),detailsHtml:`<p class="model-caption">${esc(muscle.description)}</p>`});
}
function showExercise(id) {
 const x=exercises.find(x=>x.id===id);if(!x)return;
 modelViewer.open({type:'exercise',id,title:x.name,url:modelUrl('exercise',id),detailsHtml:`<details class="model-guidance"><summary>动作要领与来源</summary><div class="model-details"><div class="row wrap"><span class="badge">${esc(x.muscle)}</span><span class="badge neutral">${esc(x.equipment)}</span></div><p class="description">${esc(x.description)}</p><ol>${x.cues.map(c=>`<li>${esc(c)}</li>`).join('')}</ol><small>${esc(x.source)}</small></div></details>`});
}

function renderSettings() {
 $('#page').innerHTML=title('你的身体，你的节奏。','资料、模型与数据，都由你自己管理。')+`<nav class="settings-nav" aria-label="设置类别">${[['profile','个人资料'],['ai','AI 服务'],['review','阶段复盘'],['data','数据与同步']].map(([id,label])=>`<button data-action="settings-tab" data-tab="${id}" class="${state.setting===id?'active':''}">${label}</button>`).join('')}</nav><div id="settings-content"></div>`;
 ({profile:renderProfile,ai:renderAISettings,review:renderReview,data:renderData}[state.setting])();
}
function renderProfile() {
 const p=profile(),history=records('phase');
 $('#settings-content').innerHTML=`<div class="grid-2"><div class="card"><div class="profile-head"><span class="avatar">${esc(state.user.name?.slice(0,1))}</span><div><h2>${esc(state.user.name)}</h2><small>${esc(state.user.email)}</small></div></div><div class="stats" style="grid-template-columns:1fr 1fr;margin-bottom:20px"><div class="stat"><small>当前体重</small><strong>${p?.weight||'—'}<em>kg</em></strong></div><div class="stat"><small>当前目标</small><strong style="font-size:23px">${goalLabel(p?.goal)||'待设置'}</strong></div></div><div class="row spread"><small>年龄 / 性别</small><span>${p?.age||'—'} 岁 · ${p?.sex==='female'?'女':'男'}</span></div><div class="divider"></div><div class="row spread"><small>身高</small><span>${p?.height||'—'} cm</span></div><div class="divider"></div>${button('更新阶段资料','profile','','primary')}<p class="description" style="font-size:11px;margin:18px 0 0">每次更新会保留带日期的历史，并重新估算营养建议。</p></div><div class="card"><div class="card-head"><h2>阶段记录</h2><span class="badge neutral">${history.length} 条</span></div>${history.length?`<table class="history-table"><thead><tr><th>日期</th><th>体重</th><th>目标</th><th></th></tr></thead><tbody>${history.map(r=>`<tr><td>${esc(r.data.date)}</td><td>${r.data.weight} kg</td><td>${goalLabel(r.data.goal)}</td><td><button class="link-button" data-action="delete-phase" data-id="${r.id}">删除</button></td></tr>`).join('')}</tbody></table>`:empty('更新资料后，会在这里留下一条记录。')}</div></div>`;
}
function showProfile(first=false) {
 const p=profile()||{age:28,sex:'male',height:175,weight:70,goal:'maintain'};
 modal(first?'先认识一下你':'更新阶段资料',`<p class="description">${first?'填写这五项，就可以开始使用。':'记录新的体重与目标，营养建议会重新计算。固定训练计划不会自动变化。'}</p><form id="profile-form" data-first="${first}"><div class="form-grid"><div><label for="profile-age">年龄</label><input name="age" id="profile-age" type="number" min="18" max="100" value="${p.age}" required></div><div><label for="profile-sex">性别（用于代谢公式）</label><select name="sex" id="profile-sex">${options([['male','男'],['female','女']],p.sex)}</select></div><div><label for="profile-height">身高 cm</label><input name="height" id="profile-height" type="number" min="130" max="230" step="0.1" value="${p.height}" required></div><div><label for="profile-weight">当前体重 kg</label><input name="weight" id="profile-weight" type="number" min="35" max="300" step="0.1" value="${p.weight}" required></div><div class="full"><label for="profile-goal">这一阶段的目标</label><select name="goal" id="profile-goal">${options([['lose','减脂 · 逐渐降低体脂'],['gain','增肌 · 提升力量与肌肉'],['maintain','保持 · 建立规律习惯']],p.goal)}</select></div>${first?'':`<div><label for="phase-date">记录日期</label><input name="date" id="phase-date" type="date" value="${today()}" max="${today()}" required></div><div><label for="activity">日常活动水平</label><select id="activity" name="activity">${options([[1.2,'久坐为主'],[1.375,'轻度活动'],[1.55,'中等活动'],[1.725,'较高活动']],p.activity||1.375)}</select></div>`}</div><p style="font-size:10px;color:#94a08d;margin-top:17px">首次按轻度日常活动估算，可在阶段资料中调整。自动营养估算适用于普通成年人；孕期、哺乳期与特殊医疗饮食请遵循专业建议。</p><div id="profile-error"></div><div class="form-footer"><button class="button primary" type="submit">${first?'建立档案，开始使用':'保存阶段资料'}</button></div></form>`,false,first);
}
function presetFor(id) { return providerPresets.find(p=>p.id===id)||providerPresets.find(p=>p.id==='custom'); }
function providerLogo(preset) { return `<span class="provider-logo" style="--provider-color:${esc(preset.color||'#527b68')}">${esc(preset.logo||preset.name.slice(0,1))}</span>`; }
function modelCapability(model) { return model.vision===true?'<span class="badge">支持图片</span>':model.vision===false?'<span class="badge neutral">文本</span>':'<span class="badge neutral">图片能力待确认</span>'; }
function renderAISettings() {
 const taskOptions=task=>'<option value="">选择供应商与模型</option>'+state.providers.filter(p=>enabledModels(p).length).map(p=>`<optgroup label="${esc(p.name)}">${options(enabledModels(p).map(m=>[JSON.stringify({providerId:p.id,modelId:m.id}),`${p.name} · ${m.name||m.id}${m.vision===true?' · 支持图片':''}`]),taskSelection(task,state.providers,state.tasks,state.taskModels))}</optgroup>`).join('');
 $('#settings-content').innerHTML=`<div class="provider-intro"><div><div class="eyebrow">CONNECT YOUR AI</div><h2>选择服务，填入密钥，就可以开始。</h2><p>地址已为你准备好。获取模型后，勾选常用模型，再分配给不同任务。</p></div><span class="badge">${providerPresets.filter(p=>p.id!=='custom').length} 种供应商预设</span></div><div class="provider-settings-grid"><section class="card"><div class="card-head"><h2>我的供应商</h2>${button('+ 添加供应商','provider','','small')}</div>${state.providers.length?state.providers.map(p=>{const preset=presetFor(p.presetId);return `<article class="provider-card"><div class="row">${providerLogo(preset)}<div class="grow"><strong>${esc(p.name)}</strong><small>${enabledModels(p).length} 个已启用模型</small></div><span class="badge ${p.hasKey?'':'neutral'}">${p.hasKey?'已配置':'无密钥'}</span></div><div class="provider-model-tags">${enabledModels(p).slice(0,4).map(m=>`<span title="${esc(m.id)}">${esc(m.name||m.id)}</span>`).join('')}${enabledModels(p).length>4?`<small>+${enabledModels(p).length-4}</small>`:''}</div><div class="row wrap">${button('管理模型','provider',`data-id="${esc(p.id)}"`,'small')}${button('测试连接','test-provider',`data-id="${esc(p.id)}" ${p.model?'':'disabled'}`,'small')}${button('删除','delete-provider',`data-id="${esc(p.id)}"`,'small')}</div></article>`;}).join(''):empty('还没有连接 AI 服务<br>从下面选择你使用的供应商。','spark')}<div class="divider"></div><div class="card-head"><h3>添加常用服务</h3><small>自动填写接口地址</small></div><div class="provider-presets">${providerPresets.map(p=>`<button class="preset-tile" data-action="provider-preset" data-preset="${p.id}">${providerLogo(p)}<span>${esc(p.name)}</span></button>`).join('')}</div><p class="provider-footnote">密钥在服务端加密保存，个人导出与浏览器缓存不包含密钥。</p></section><section class="card task-card"><div class="card-head"><h2>任务使用的模型</h2>${icon('settings')}</div><p class="description">同一份密钥下的多个模型，可以分别承担不同任务。</p><form id="tasks-form">${[['chat','日常对话','连续追问、知识问答与阶段分析','chat'],['meal','餐食识别','请选择支持图片输入的模型','image'],['planning','规划建议','训练安排、食谱与阶段规划','leaf']].map(([id,label,desc,i])=>`<div class="task-model-field"><label for="task-${id}">${icon(i)} ${label}</label><select id="task-${id}" name="${id}">${taskOptions(id)}</select><small>${desc}</small></div>`).join('')}<div class="form-footer"><button class="button primary">保存任务模型</button></div></form><div class="notice" style="margin-top:24px">有些服务的模型列表不提供图片能力信息；这类模型会标注“待确认”，可结合供应商说明选择。</div></section></div>`;
}
function providerEditor(id,presetId='deepseek') {
 const existing=state.providers.find(x=>x.id===id),preset=presetFor(existing?.presetId||presetId);
 state.providerDraft={id:existing?.id||uid(),presetId:preset.id,protocol:existing?.protocol||preset.protocol,name:existing?.name||preset.name,baseUrl:existing?.baseUrl||preset.baseUrl,apiKey:'',hasKey:existing?.hasKey||false,models:structuredClone(existing?enabledModels(existing):[]),model:existing?.model||'',availableModels:structuredClone(existing?enabledModels(existing):[]),search:'',fetched:false,fetching:false,existing:!!existing};
 renderProviderEditor();
}
function renderProviderEditor() {
 const d=state.providerDraft,preset=presetFor(d.presetId),custom=d.presetId==='custom';
 modal(d.existing?'管理供应商与模型':'连接 AI 供应商',`<form id="provider-form" data-id="${d.id}" autocomplete="off"><div class="provider-editor-top"><div><label for="provider-preset">选择供应商</label><select id="provider-preset" name="presetId">${options(providerPresets.map(p=>[p.id,p.name]),d.presetId)}</select></div>${providerLogo(preset)}</div><p class="description">${esc(preset.description)}</p><div class="field"><div class="row spread"><label for="provider-key">API Key ${d.hasKey?'<span class="badge">已保存</span>':''}</label>${preset.keyUrl?`<a class="link-button" href="${esc(preset.keyUrl)}" target="_blank" rel="noopener noreferrer">获取 API Key ↗</a>`:''}</div><input name="apiKey" id="provider-key" type="password" autocomplete="new-password" value="${esc(d.apiKey)}" placeholder="${d.hasKey?'留空继续使用已保存的密钥':'粘贴此供应商的 API Key'}" maxlength="4096"><small style="display:block;margin-top:8px">${custom?'无鉴权的本地服务可以留空。':'只需填写密钥，接口地址会自动设置。'}</small></div><details class="provider-advanced" ${custom?'open':''}><summary>高级设置 <small>显示名称、接口地址与协议</small></summary><div class="form-grid"><div><label for="provider-name">显示名称</label><input id="provider-name" name="name" value="${esc(d.name)}" required maxlength="100"></div><div><label for="provider-protocol">接口协议</label><select id="provider-protocol" name="protocol">${options([['openai','OpenAI 兼容'],['anthropic','Anthropic / Claude'],['gemini','Google Gemini']],d.protocol)}</select></div><div class="full"><label for="provider-url">接口地址</label><input id="provider-url" type="url" name="baseUrl" value="${esc(d.baseUrl)}" placeholder="https://你的服务地址/v1" required></div></div><p class="provider-footnote">修改接口地址或协议后，需要重新填写密钥。自定义本地服务可使用无密钥连接。</p>${d.existing?`<label class="row" style="margin-top:14px"><input id="provider-clear-key" name="clearKey" type="checkbox" ${d.clearKey?'checked':''}>清除已保存的密钥</label>`:''}</details><div class="divider"></div><div class="card-head"><div><h3 style="margin-bottom:6px">可用模型</h3><small id="provider-model-count">${d.availableModels.length} 个模型 · 已启用 ${d.models.length} 个</small></div>${button(icon('download')+' '+(d.fetched?'刷新模型':'获取模型'),'fetch-models','','subtle')}</div><div id="provider-feedback" role="status" aria-live="polite"></div><div class="model-list-tools"><input type="search" id="provider-model-search" placeholder="搜索模型名称或 ID…" aria-label="搜索供应商模型" value="${esc(d.search)}"><button type="button" class="link-button" data-action="select-visible-models">启用搜索结果</button></div><div class="provider-model-list" id="provider-model-list"></div><details class="manual-model"><summary>找不到模型？手动添加 ID</summary><div class="row"><input id="provider-manual-model" placeholder="供应商提供的完整模型 ID" aria-label="手动模型 ID" maxlength="200">${button('添加','manual-model','','small')}</div><small>用于未提供列表的私有部署或模型别名。</small></details><div class="field" style="margin-top:20px"><label for="provider-model">默认模型（用于测试连接）</label><select id="provider-model" name="model"></select></div><div class="provider-editor-footer"><small>勾选模型后，保存并在任务设置中选择。</small><button class="button primary" type="submit">保存供应商</button></div></form>`,true);
 renderProviderModels();updateProviderSelection();
}
function renderProviderModels() {
 const d=state.providerDraft,el=$('#provider-model-list');if(!d||!el)return;
 const query=d.search.trim().toLocaleLowerCase(),visible=d.availableModels.filter(m=>(m.id+' '+m.name).toLocaleLowerCase().includes(query));
 el.innerHTML=visible.length?visible.map(m=>`<label class="model-option"><input type="checkbox" name="enabled-model" value="${esc(m.id)}" ${d.models.some(x=>x.id===m.id)?'checked':''}><span class="grow"><strong>${esc(m.name||m.id)}</strong>${m.name&&m.name!==m.id?`<small>${esc(m.id)}</small>`:''}</span>${modelCapability(m)}</label>`).join(''):empty(d.availableModels.length?'没有找到匹配模型，试试其他关键词。':d.fetched?'此服务没有返回可用模型，可查看账户权限或手动添加。':'填入 API Key 后，点击“获取模型”。','grid');
}
function updateProviderSelection() {
 const d=state.providerDraft;if(!d||!$('#provider-model'))return;
 if(!d.models.some(m=>m.id===d.model))d.model=d.models[0]?.id||'';
 $('#provider-model').innerHTML=options(d.models.length?d.models.map(m=>[m.id,m.name||m.id]):[['','先勾选要启用的模型']],d.model);
 $('#provider-model-count').textContent=`${d.availableModels.length} 个模型 · 已启用 ${d.models.length} 个`;
}
function readProviderForm() {
 const form=$('#provider-form'),d=state.providerDraft;if(!form||!d)return;
 const values=formData(form);d.clearKey=values.clearKey==='on';for(const key of ['name','apiKey','baseUrl','protocol','model'])if(values[key]!==undefined)d[key]=values[key].trim();
}
function providerPayload(d) {return {id:d.id,presetId:d.presetId,name:d.name,baseUrl:d.baseUrl,protocol:d.protocol,apiKey:d.apiKey,clearKey:!!d.clearKey,models:d.models,model:d.model};}
async function fetchProviderModels() {
 readProviderForm();const d=state.providerDraft;if(!d||d.fetching)return;
 if(!d.baseUrl){$('.provider-advanced').open=true;$('#provider-url').focus();throw new Error('请填写自定义接口地址。');}
 if(!d.apiKey&&(!d.hasKey||d.clearKey)&&presetFor(d.presetId).requiresKey){$('#provider-key').focus();throw new Error('请先填写此供应商的 API Key。');}
 d.fetching=true;const requestId=uid();d.requestId=requestId;
 const connectionInputs=['#provider-preset','#provider-key','#provider-url','#provider-protocol','#provider-clear-key'].map(id=>$(id)).filter(Boolean);connectionInputs.forEach(input=>input.disabled=true);
 const target=$('[data-action="fetch-models"]');target.disabled=true;target.innerHTML='正在获取模型…';$('#provider-feedback').innerHTML='';
 try {
  const response=await api('/providers/models',{method:'POST',body:{provider:providerPayload(d)}});
  if(state.providerDraft!==d||d.requestId!==requestId||!$('#provider-form'))return;
  if(!Array.isArray(response.models))throw new Error('服务没有返回有效的模型列表。');
  const available=new Map(response.models.map(m=>[m.id,{id:m.id,name:m.name||m.id,vision:m.vision??null}]));
  for(const model of d.models)if(!available.has(model.id))available.set(model.id,model);
  d.availableModels=[...available.values()];d.models=d.models.map(m=>available.get(m.id));d.fetched=true;
  renderProviderModels();updateProviderSelection();
  $('#provider-feedback').innerHTML=`<div class="notice" style="margin-bottom:14px">已获取 ${response.models.length} 个模型，请勾选要使用的模型。${response.truncated?'模型列表较长，当前仅显示部分结果；其他模型可手动添加。':''}${response.warning?' '+esc(response.warning):''}</div>`;
 }catch(error){if(state.providerDraft===d&&$('#provider-feedback'))$('#provider-feedback').innerHTML=`<div class="error-box" style="margin-bottom:14px">${esc(error.message)}</div>`;}
 finally{d.fetching=false;connectionInputs.forEach(input=>input.disabled=false);if(state.providerDraft===d&&d.requestId===requestId&&$('[data-action="fetch-models"]')){const b=$('[data-action="fetch-models"]');b.disabled=false;b.innerHTML=icon('download')+' '+(d.fetched?'刷新模型':'获取模型');}}
}
async function saveProvider() {
 const d=state.providerDraft;if(!d)return;
 if(d.fetching)throw new Error('模型列表仍在获取，请稍后保存。');
 readProviderForm();
 if(!d.apiKey&&(!d.hasKey||d.clearKey)&&presetFor(d.presetId).requiresKey)throw new Error('请填写此供应商的 API Key。');
 const providers=state.providers.filter(p=>p.id!==d.id).map(p=>({...p}));providers.push(providerPayload(d));
 const selection=reconcileTasks(providers,state.tasks,state.taskModels,state.providers.some(p=>enabledModels(p).length)?undefined:d.id);
 await api('/providers',{method:'PUT',body:{providers,...selection}});
 $('#provider-form')?.reset();d.apiKey='';state.providerDraft=null;await loadProviders();closeModal();renderAISettings();toast('供应商与模型已保存');
}
function renderReview() {
 const phases=records('phase').map(r=>r.data).sort((a,b)=>a.date.localeCompare(b.date));const first=phases[0],last=phases.at(-1),delta=first&&last?Number((last.weight-first.weight).toFixed(1)):0;
 const done=allCalendarTasks().filter(r=>r.data.taskType==='training'&&r.data.completed),meals=records('meal').filter(r=>r.data.confirmed),dates=new Set(meals.map(r=>r.data.date));
 const mean=dates.size?[...dates].reduce((sum,date)=>sum+totals(date).kcal,0)/dates.size:0;
 $('#settings-content').innerHTML=`<div class="stats"><div class="stat"><small>已记录体重变化</small><strong>${delta>0?'+':''}${delta}<em>kg</em></strong><p>${first?`${first.date} 至 ${last.date}`:'等待至少两次体重记录'}</p></div><div class="stat"><small>完成训练</small><strong>${done.length}<em>次</em></strong><p>实际完成记录</p></div><div class="stat"><small>饮食记录天数</small><strong>${dates.size}<em>天</em></strong><p>${meals.length} 餐已确认</p></div><div class="stat"><small>有记录日平均摄入</small><strong>${numeric(mean)}<em>kcal</em></strong><p>缺少餐次会低估全天摄入</p></div></div><div class="grid-2"><section class="card"><h2>体重趋势</h2>${phases.length>1?`<div class="trend" role="img" aria-label="体重历史：${esc(phases.map(p=>p.date+' '+p.weight+'kg').join('，'))}">${phases.slice(-12).map(p=>`<div class="trend-column"><span>${p.weight}</span><i style="height:${Math.max(15,(p.weight-Math.min(...phases.map(x=>x.weight))+1)/(Math.max(...phases.map(x=>x.weight))-Math.min(...phases.map(x=>x.weight))+2)*75)}px"></i><span>${p.date.slice(5)}</span></div>`).join('')}</div>`:empty('连续记录几次体重，就能看到趋势。')}<p class="review-summary">${phases.length>1?`这段记录中，体重${delta>0?'上升':delta<0?'下降':'保持'} ${Math.abs(delta)} kg。`:'目前的体重记录还不足以判断趋势。'}体重会受饮水、食物和测量时间影响，建议在相近条件下观察多次记录。</p>${button('更新阶段参数','profile','','small')}</section><section class="card"><h2>把记录放在一起看</h2><p class="review-summary">你已记录 ${done.length} 次训练和 ${meals.length} 餐饮食。${dates.size<7?'继续积累完整记录，有助于判断计划是否适合当前生活节奏。':'复盘时可以结合体重变化、训练表现与饥饿感调整阶段目标。'}</p>${button(icon('spark')+' 请 AI 结合记录复盘','ai-review','','primary')}<p class="description" style="font-size:11px;margin-top:17px">更新阶段参数后会重新计算营养建议；训练计划须主动修改并再次确认。</p></section></div>`;
}
function renderData() {
 const s=state.store;
 $('#settings-content').innerHTML=`<div class="grid-2"><section class="card"><h2>数据与同步</h2><p class="description" style="font-size:12px">同一服务地址下登录同一账号，即可同步电脑与手机的资料、会话、计划、餐食和图片。离线更改保存在当前设备，联网后继续同步。</p><div class="row spread"><small>本地记录</small><span>${[...s.records.values()].filter(r=>!r.deleted).length} 条</span></div><div class="divider"></div><div class="row spread"><small>等待同步</small><span>${s.pending.size} 条</span></div><div class="form-footer">${button('立即同步','sync','','primary')}${button(icon('download')+' 导出我的数据','export')}</div>${s.conflicts.length?`<div class="divider"></div><h3>需要选择保留的版本</h3>${s.conflicts.map(c=>`<div class="notice" style="margin:12px 0"><strong>${esc(s.records.get(c.id)?.kind)} · ${esc(c.id)}</strong><details><summary>查看双方内容</summary><pre style="white-space:pre-wrap;max-height:200px;overflow:auto">本机：${esc(JSON.stringify(s.get(c.id),null,2))}\n服务端：${esc(JSON.stringify(c.server?.data,null,2))}</pre></details><div class="row wrap" style="margin-top:10px">${button('保留本机更改','resolve-conflict',`data-id="${esc(c.id)}" data-local="true"`,'small')}${button('使用服务端版本','resolve-conflict',`data-id="${esc(c.id)}" data-local="false"`,'small')}</div></div>`).join('')}`:''}</section><section class="card"><h2>管理自己的记录</h2><p class="description" style="font-size:12px">会话可在左侧逐条删除；餐食可在编辑页删除；阶段历史可在资料页管理。</p><div class="notice">个人导出包含档案、历史、会话、计划、餐食、图片与设置，不含 API 密钥。导出前会尝试同步本机修改。</div><div class="divider"></div><h3>删除账号及全部数据</h3><p class="description" style="font-size:12px">将删除当前账号的服务端记录、图片、模型密钥和当前设备缓存，其他已登录设备联网后会退出账号。</p>${button('删除全部个人数据','delete-account','','danger')}</section></div>`;
}

function recipeTool() {
 const pref=state.store.get('preferences')||{};
 modal('安排一份合适的食谱',`<p class="description">结合当前目标、训练时间和偏好生成草案。食谱不会自动记入饮食记录。</p><form id="recipe-form"><div class="form-grid"><div><label for="recipe-days">安排几天</label><select name="days" id="recipe-days">${options([[1,'1 天'],[3,'3 天'],[7,'7 天']],1)}</select></div><div><label for="recipe-meal">餐次范围</label><select name="meal" id="recipe-meal">${options([['day','全天'],['breakfast','早餐'],['lunch','午餐'],['dinner','晚餐'],['snack','加餐']],'day')}</select></div><div class="full"><label for="recipe-prefs">饮食偏好</label><input name="preferences" id="recipe-prefs" placeholder="例如：偏爱米饭、素食" value="${esc(pref.preferences||'')}"></div><div class="full"><label for="recipe-restrictions">饮食限制与忌口</label><input name="restrictions" id="recipe-restrictions" placeholder="例如：牛奶、坚果、鱼" value="${esc(pref.restrictions||'')}"></div><div class="full"><label for="recipe-time">训练时间</label><input name="trainingTime" id="recipe-time" type="time" value="${esc(pref.trainingTime||'18:00')}"></div></div><div class="form-footer"><button class="button primary">生成食谱草案</button></div></form><div id="recipe-result"></div>`,true);
}
function recipeResult(recipe) {
 return `<div class="divider"></div><div class="card-head"><h2>${esc(recipe.title)}</h2>${button('让规划模型进一步调整','recipe-ai','','small subtle')}</div>${recipe.days.map(day=>`<section class="plan-day" style="margin-bottom:15px"><h3>第 ${day.day} 天 <small style="float:right">${numeric(day.totals.kcal)} kcal</small></h3>${day.meals.map(meal=>`<div class="exercise-line"><div class="grow"><strong>${esc(meal.name)}</strong><small>${meal.items.map(i=>`${esc(i.name)} ${i.grams}g（${esc(i.state)}）`).join(' · ')}</small><small>${esc(meal.timing||'')}</small></div><span class="rep">${numeric(meal.totals.kcal)} kcal</span></div>`).join('')}</section>`).join('')}<div class="notice">${recipe.notes.map(esc).join('<br>')}</div>`;
}
function foodSwap() {
 modal('食物查询与替换',`<form id="food-swap-form"><div class="form-grid"><div class="full"><label for="food-from">查找食物</label><select id="food-from" name="from">${options(foods.map(f=>[f.id,`${f.name} · ${f.state}`]),foods[0].id)}</select></div><div><label for="food-grams">当前份量 g</label><input id="food-grams" name="grams" type="number" value="100" min="1" max="10000" required></div><div><label for="food-basis">按什么等量替换</label><select id="food-basis" name="basis">${options([['kcal','热量'],['protein','蛋白质'],['carbs','碳水'],['fat','脂肪']],'kcal')}</select></div><div class="full"><label for="food-to">换成</label><select id="food-to" name="to">${options(foods.map(f=>[f.id,`${f.name} · ${f.state}`]),foods[1].id)}</select></div></div><div class="form-footer"><button class="button primary">查看营养与替换结果</button></div></form><div id="swap-result"></div><div class="divider"></div><h3>按实测比例换算生熟重量</h3><form id="cooked-form"><div class="form-grid"><div><label for="batch-raw">整批生重 g</label><input name="raw" id="batch-raw" type="number" value="100" min="1" max="100000" required></div><div><label for="batch-cooked">整批烹调后重量 g</label><input name="cooked" id="batch-cooked" type="number" value="250" min="1" max="100000" required></div><div><label for="portion-raw">要换算的生重 g</label><input name="grams" id="portion-raw" type="number" value="50" min="1" max="100000" required></div></div><div class="form-footer"><button class="button">换算对应熟重</button></div></form><div id="cooked-result"></div>`,true);
}
async function chooseFiles({camera=false,meal=false}={}) {
 const owner=attachmentOwner();
 const draft=meal?state.mealDraft:null;
 if(draft?._busy)return;
 const input=document.createElement('input');input.type='file';input.accept=meal||camera?'image/jpeg,image/png,image/webp,image/gif':'.jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.md,.csv,.json';input.multiple=!camera;if(camera)input.setAttribute('capture','environment');
 input.onchange=async()=>{
   if(!input.files?.length)return;
   if(!meal){addChatFiles(Array.from(input.files),owner);return;}
   if(state.mealDraft!==draft||draft._busy||!$('#meal-form'))return;
   if(meal)readMealForm();
   const chosen=Array.from(input.files);const destination=meal?state.mealDraft.attachments:state.files;
   if(chosen.length+destination.length>6){toast('每次最多保留 6 个附件',true);return;}
   draft._busy=true;lockMealEditor(true,'正在上传照片…');
   for(const file of chosen){
     try{
       if(file.size>8*1024*1024)throw new Error('单个附件不能超过 8 MB');
       if(!navigator.onLine)throw new Error('上传附件需要联网；离线时仍可手动记录餐食。');
       const ext=file.name.split('.').at(-1).toLowerCase();const type=file.type||({md:'text/markdown',csv:'text/csv',json:'application/json',txt:'text/plain'}[ext]);
       const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
       const saved=await api('/attachments',{method:'POST',body:{name:file.name,type,data:base64}});destination.push(saved);toast(`${file.name} 已上传`);
     }catch(error){toast(error.message,true);}
   }
   draft._busy=false;
   if(state.mealDraft===draft&&$('#meal-form')){renderMealEditor();lockMealEditor(false);}
 };input.click();
}
async function exportData() {
 let data;
 if(navigator.onLine) {await state.store.sync();data=await api('/export');}
 else data={user:state.user,records:[...state.store.records.values()],offline:true,note:'离线导出只包含本机记录；图片原文件请联网后完整导出。'};
 if(state.store.pending.size)data.localPending=[...state.store.pending.values()].map(({token,...rest})=>rest);
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`循序健身-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast(data.offline?'已导出本机记录；图片需联网完整导出':'个人数据已导出');
}
function confirmDialog(title,message,action,id='') {modal(title,`<p class="description">${esc(message)}</p><div class="form-footer">${button('取消','close-modal')}${button('确认删除',action,`data-id="${esc(id)}"`,'danger')}</div>`);}
async function navigate(page) {state.page=page;if(page==='settings'&&state.setting==='ai')await loadProviders();render();window.scrollTo(0,0);}

// 真人封面加载失败（文件缺失、离线、清单过期）时移除图片并撤掉遮罩，露出底下的矢量图示。
// closest 必须在 remove 之前取：图片一旦脱离文档，closest 只会返回 null。
document.addEventListener('error',event=>{
 const image=event.target;
 if(!(image instanceof HTMLImageElement)||!image.classList.contains('exercise-cover'))return;
 const visual=image.closest('.exercise-visual');image.remove();visual?.removeAttribute('data-cover');
},true);

document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-action]');if(!target)return;
 const {action,id}=target.dataset;if(target.tagName==='A')event.preventDefault();
 try {
 switch(action){
 case 'auth-mode':state.authMode=target.dataset.mode;renderAuth();break;
 case 'nav':await navigate(target.dataset.page);break;
 case 'toggle-sidebar': {
   state.sidebarCollapsed = !state.sidebarCollapsed;
   $('.layout').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
   target.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
   const label = state.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
   target.setAttribute('aria-label', label); target.title = label;
   try { localStorage.setItem('fitness:sidebar-collapsed', String(state.sidebarCollapsed)); } catch {}
   break;
 }
 case 'menu':$('#sidebar').classList.toggle('open');break;
 case 'close-modal':closeModal();break;
 case 'new-chat':selectConversation(null);await navigate('chat');break;
 case 'open-chat':selectConversation(id);await navigate('chat');break;
 case 'delete-chat':confirmDialog('删除这段对话','删除后，这段会话及消息将从账号记录中移除。','confirm-delete-chat',id);break;
 case 'confirm-delete-chat':if(chatRun?.id===id)await stopChat({discard:true});await state.store.remove(id);chatUploads.clear(attachmentOwner(id),{removeUploaded:true});if(state.conversation===id)selectConversation(null);chatDrafts.delete(id);chatScroll.delete(id);closeModal();render();break;
 case 'attach':await chooseFiles();break;
 case 'camera':await chooseFiles({camera:true});break;
 case 'remove-file':await chatUploads.remove(attachmentOwner(),id);break;
 case 'retry-upload':chatUploads.retry(attachmentOwner(),id);break;
 case 'remove-meal-file':{readMealForm();const [f]=state.mealDraft.attachments.splice(Number(target.dataset.index),1);renderMealEditor();if(f?.id&&!state.store.get(state.mealDraft._id))await api('/attachments/'+f.id,{method:'DELETE',body:{}});break;}
 case 'retry-chat':await sendChat('',id);break;
 case 'stop-chat':await stopChat();break;
 case 'chat-latest':followChat();break;
 case 'preview-image':modal(esc(target.dataset.name||'图片预览'),`<div class="image-preview"><img src="${esc(target.dataset.url)}" alt="${esc(target.dataset.name||'图片')}"></div><div class="form-footer">${button('复制图片','copy-image',`data-url="${esc(target.dataset.url)}"`)}<a class="button" href="${esc(target.dataset.url)}" target="_blank" rel="noopener">打开原图</a></div>`,true);break;
 case 'copy-image':await copyImage(target.dataset.url);toast('图片已复制，可粘贴到输入框');break;
 case 'copy-message':{const message=chatConversation()?.messages.find(message=>message.id===id);if(message){await copyMessageText(message.content||'',message.role==='assistant'?renderMarkdown(message.content):`<p>${esc(message.content)}</p>`);toast('消息已复制');}break;}
 case 'copy-code':{const code=target.closest('.code-block')?.querySelector('code')?.textContent;if(code!==undefined){await navigator.clipboard.writeText(code);target.textContent='已复制';setTimeout(()=>{if(target.isConnected)target.textContent='复制代码';},1500);}break;}
 case 'quick':if(target.dataset.target==='meal')await openMealChat();else if(target.dataset.target==='review'){state.setting='review';await navigate('settings');}else {if(target.dataset.target==='library')state.knowledgeTab='exercises';await navigate(target.dataset.target);}break;
 case 'advice-mode':adviceMode=target.dataset.mode;paintNutritionAdvice();break;
 case 'advice-refresh':await loadNutritionAdvice(true);break;
 case 'advice-settings':state.setting='ai';await loadProviders();await navigate('settings');break;
 case 'nutrition-day':selectNutritionDate(target.dataset.date);break;
 case 'new-meal':await openMealChat();break;
 case 'exit-meal-scene':state.chatScene='';updateChatScene();break;
 case 'edit-meal':openMeal(id);break;
 case 'meal-photo':await chooseFiles({meal:true});break;
 case 'meal-camera':await chooseFiles({meal:true,camera:true});break;
 case 'meal-ai':await estimateMeal();break;
 case 'delete-meal':confirmDialog('删除这餐记录','删除后将从当天摄入总量中扣除。','confirm-delete-meal',id);break;
 case 'confirm-delete-meal':await state.store.remove(id);closeModal();renderNutrition();toast('已删除餐食记录');break;
 case 'plan-builder':planBuilder();break;
 case 'view-draft':viewDraft();break;
 case 'discard-plan':await state.store.remove('plan-draft');closeModal();renderTraining();break;
 case 'training-day':state.date=target.dataset.date;renderTraining();break;
 case 'log-training':logTraining(id);break;
 case 'calendar-week':state.date=addDays(state.date,Number(target.dataset.offset));renderTraining();break;
 case 'calendar-today':state.date=today();renderTraining();break;
 case 'calendar-add':openCalendarTask(null,target.dataset.date||state.date);break;
 case 'calendar-edit':openCalendarTask(id);break;
 case 'calendar-detail':showCalendarTask(id);break;
 case 'calendar-delete':{const record=calendarTask(id);if(!record||record.data.completed)throw new Error('已完成的任务不能删除。');state.calendarDelete=structuredClone(record);confirmDialog('删除训练',`将从训练表移除「${record.data.title}」。`,'calendar-delete-confirm',id);break;}
 case 'calendar-delete-confirm':{const record=assertTaskCurrent(state.calendarDelete);if(record.id!==id||record.data.completed)throw new Error('这项任务不能删除。');await state.store.remove(record.id);closeModal();renderTraining();toast('训练已删除');break;}
 case 'strength':strengthTool();break;
 case 'exercise':showExercise(id);break;
 case 'knowledge-tab':state.knowledgeTab=target.dataset.tab;renderLibrary();break;
 case 'portion-preset':choosePortion(id);break;
 case 'muscle-model':showMuscle(id);break;
 case 'open-visual':target.dataset.type==='muscle'?showMuscle(id):showExercise(id);break;
 case 'knowledge':{const k=knowledgeCards.find(x=>x.id===id);if(k)modal(esc(k.title),`<span class="badge neutral">${esc(k.review.note)}</span><p class="description" style="margin-top:18px">${esc(k.summary)}</p><a class="link-button" href="${esc(k.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(k.sourceName)} ↗</a><p style="font-size:10px;color:#8b9981;margin-top:15px">来源核对日期：${esc(k.review.date)}</p>`);break;}
 case 'profile':showProfile();break;
 case 'delete-phase':confirmDialog('删除阶段历史','只删除这条历史记录，当前个人资料保持不变。','confirm-delete-phase',id);break;
 case 'confirm-delete-phase':await state.store.remove(id);closeModal();renderProfile();break;
 case 'settings-tab':state.setting=target.dataset.tab;if(state.setting==='ai')await loadProviders();renderSettings();break;
 case 'provider':providerEditor(id);break;
 case 'provider-preset':providerEditor(null,target.dataset.preset);break;
 case 'fetch-models':await fetchProviderModels();break;
 case 'select-visible-models':{const d=state.providerDraft,q=d.search.trim().toLowerCase();const selected=new Map(d.models.map(m=>[m.id,m]));for(const m of d.availableModels)if((m.id+' '+m.name).toLowerCase().includes(q))selected.set(m.id,m);d.models=[...selected.values()];renderProviderModels();updateProviderSelection();break;}
 case 'manual-model':{const d=state.providerDraft,value=$('#provider-manual-model').value.trim();if(!value)throw new Error('请填写模型 ID。');if(!d.availableModels.some(m=>m.id===value))d.availableModels.push({id:value,name:value,vision:null});if(!d.models.some(m=>m.id===value))d.models.push(d.availableModels.find(m=>m.id===value));d.search='';$('#provider-model-search').value='';$('#provider-manual-model').value='';renderProviderModels();updateProviderSelection();break;}
 case 'test-provider':target.disabled=true;try{const r=await api('/providers/test',{method:'POST',body:{id}});toast(r.message||'连接成功');}finally{target.disabled=false;}break;
 case 'delete-provider':confirmDialog('删除 AI 服务','使用此服务的任务将需要重新选择模型。','confirm-delete-provider',id);break;
 case 'confirm-delete-provider':{const providers=state.providers.filter(p=>p.id!==id);const selection=reconcileTasks(providers,state.tasks,state.taskModels);await api('/providers',{method:'PUT',body:{providers,...selection}});await loadProviders();closeModal();renderAISettings();break;}
 case 'ai-review':state.conversation=null;closeModal();await navigate('chat');await sendChat('请结合我的阶段体重、饮食和实际训练记录复盘。指出记录不足和趋势的不确定性，并建议下一阶段可调整的参数。不要改写我的固定训练计划。');break;
 case 'recipe':recipeTool();break;
 case 'recipe-ai':{if(!state.recipe)return;target.disabled=true;try{const response=await api('/ai',{method:'POST',body:{task:'planning',messages:[{role:'user',content:'请结合我的训练时间、偏好与忌口，对以下食谱草案给出可操作的调整说明和单餐替换，避免忽略任何饮食限制。不要自动记账。'+JSON.stringify({recipe:state.recipe,preferences:state.store.get('preferences')})}],context:aiContext()}});$('#recipe-result').insertAdjacentHTML('beforeend',`<div class="notice" style="margin-top:18px;white-space:pre-wrap">${esc(response.content)}</div>`);}finally{target.disabled=false;}break;}
 case 'food-swap':foodSwap();break;
 case 'sync':if(state.store.status==='expired'){await logout();break;}await state.store.sync();if(state.store.conflicts.length){state.setting='data';await navigate('settings');}else{renderPage();toast('同步完成');}break;
 case 'resolve-conflict':await state.store.resolve(id,target.dataset.local==='true');renderData();break;
 case 'export':target.disabled=true;try{await exportData();}finally{target.disabled=false;}break;
 case 'delete-account':modal('删除全部个人数据',`<div class="error-box">此操作会删除账号与全部记录，无法恢复。可先导出个人数据。</div><form id="delete-account-form" style="margin-top:20px"><div class="field"><label for="delete-password">输入当前密码确认</label><input id="delete-password" name="password" type="password" autocomplete="current-password" required></div><div class="form-footer">${button('取消','close-modal')}<button class="button danger">删除账号及全部数据</button></div></form>`);break;
 case 'logout':await logout();break;
 }
 }catch(error){toast(error.message,true);}
});

document.addEventListener('submit',async event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();const values=formData(form);const submit=form.querySelector('button[type="submit"],button:not([type])');if(submit)submit.disabled=true;
 try {
 switch(form.id){
 case 'auth-form':{const {user}=await api('/auth/'+state.authMode,{method:'POST',body:values});await enter(user);break;}
 case 'profile-form':{const p=validateProfile({...profile(),...values,activity:values.activity?Number(values.activity):profile()?.activity||1.375});calculateNutrition(p);const date=values.date||today();delete p.date;await state.store.put('profile','profile',p);await state.store.put('phase',uid(),{...p,date});closeModal();render();toast('阶段资料已保存，营养建议已更新');break;}
 case 'chat-form':if(values.message.length>16000)throw new Error('单条消息请控制在 16000 字以内。');if(values.message.trim()||chatUploads.list(attachmentOwner()).length)await sendChat(values.message.trim());break;
 case 'meal-form':await estimateMeal();break;
 case 'metabolism-form':case 'macro-energy-form':case 'portion-form':updateKnowledgeTool(form);break;
 case 'plan-form':{const draft=generatePlan({split:Number(values.split),variant:values.variant},profile());await state.store.put('draft','plan-draft',draft);viewDraft();break;}
 case 'draft-form':{const draft=structuredClone(state.store.get('plan-draft'));draft.name=values.name;draft.days.forEach((day,i)=>day.exercises.forEach((e,j)=>{e.exerciseId=values[`e-${i}-${j}`];e.sets=Number(values[`s-${i}-${j}`]);e.reps=values[`r-${i}-${j}`];e.restSeconds=Number(values[`t-${i}-${j}`]);}));draft.confirmedAt=new Date().toISOString();draft.planVersion=uid();await state.store.put('plan','active-plan',draft);await state.store.remove('plan-draft');closeModal();renderTraining();toast('训练计划已确认固定');break;}
 case 'calendar-task-form':await saveCalendarTask(values);break;
 case 'training-log':{const record=assertTaskCurrent(state.trainingLog),s=record.data,day=taskDay(record);await state.store.put(record.kind,record.id,{...s,daySnapshot:structuredClone(day),completed:true,notes:values.notes,actual:day.exercises.map((e,i)=>({exerciseId:e.exerciseId,sets:Number(values['sets-'+i]),reps:values['reps-'+i],weight:Number(values['weight-'+i])})),completedAt:s.completedAt||new Date().toISOString()});closeModal();renderTraining();toast('训练已记录，辛苦了');break;}
 case 'strength-form':{const r=estimate1RM(Number(values.weight),Number(values.reps));$('#strength-result').innerHTML=`<div class="divider"></div><div class="grid-2"><div class="stat"><small>Epley 参考</small><strong>${r.epley}<em>kg</em></strong></div><div class="stat"><small>Brzycki 参考</small><strong>${r.brzycki}<em>kg</em></strong></div></div><p class="description" style="margin-top:18px">${esc(r.note)}</p>`;break;}
 case 'provider-form':await saveProvider();break;
 case 'tasks-form':{const tasks={},taskModels={};for(const task of ['chat','meal','planning']){const selected=values[task]?JSON.parse(values[task]):{};tasks[task]=selected.providerId||'';taskModels[task]=selected.modelId||'';}await api('/providers',{method:'PUT',body:{providers:state.providers,tasks,taskModels}});await loadProviders();toast('任务模型已保存');break;}
 case 'recipe-form':{const pref={preferences:values.preferences,restrictions:values.restrictions,trainingTime:values.trainingTime};const result=suggestRecipe({...values,days:Number(values.days),profile:profile()});await state.store.put('preferences','preferences',pref);state.recipe=result;$('#recipe-result').innerHTML=recipeResult(result);break;}
 case 'food-swap-form':{const r=substituteFood(values.from,Number(values.grams),values.to,values.basis),from=foods.find(f=>f.id===values.from),to=foods.find(f=>f.id===values.to);$('#swap-result').innerHTML=`<div class="divider"></div><h3>${esc(from.name)} ${values.grams}g → ${esc(to.name)} ${r.grams}g</h3><table class="history-table"><thead><tr><th>营养</th><th>替换前</th><th>替换后</th><th>变化</th></tr></thead><tbody>${[['kcal','能量 kcal'],['protein','蛋白质 g'],['carbs','碳水 g'],['fat','脂肪 g']].map(([k,n])=>`<tr><td>${n}</td><td>${r.before[k]}</td><td>${r.after[k]}</td><td>${r.delta[k]>0?'+':''}${r.delta[k]}</td></tr>`).join('')}</tbody></table><p class="description">${esc(r.note)}</p><small>${esc(from.source)}<br>${esc(to.source)}</small>`;break;}
 case 'cooked-form':{const r=convertFoodWeight(Number(values.grams),Number(values.raw),Number(values.cooked));$('#cooked-result').innerHTML=`<div class="notice">对应熟重约 <strong>${r.grams} g</strong><br>${esc(r.note)}</div>`;break;}
 case 'delete-account-form':await stopChat();await api('/account',{method:'DELETE',body:{password:values.password}});modelViewer.destroy();await chatUploads.clearAll();await state.store.clear();await state.store.close?.();localStorage.removeItem('fitness:last-user');setApiUser(null);state.user=null;state.store=null;state.providers=[];state.tasks={};state.taskModels={};state.providerDraft=null;state.files=[];state.conversation=null;chatDrafts.clear();chatScroll.clear();closeModal();renderAuth();toast('账号与个人数据已删除');break;
 }
 }catch(error){const errorBox=form.id==='auth-form'?$('#auth-error'):form.id==='profile-form'?$('#profile-error'):form.id==='calendar-task-form'?$('#calendar-task-error'):null;if(errorBox)errorBox.innerHTML=`<div class="error-box" style="margin:12px 0">${esc(error.message)}</div>`;else toast(error.message,true);}
 finally {if(submit)submit.disabled=false;if(form.id==='chat-form')updateChatControls();}
});

document.addEventListener('change',async event=>{
 const target=event.target;
 if(target.name==='enabled-model'&&state.providerDraft){const d=state.providerDraft;if(target.checked){const m=d.availableModels.find(m=>m.id===target.value);if(m&&!d.models.some(x=>x.id===m.id))d.models.push(m);}else d.models=d.models.filter(m=>m.id!==target.value);updateProviderSelection();return;}
 try {
 switch(target.id){
 case 'provider-preset':{const d=state.providerDraft,preset=presetFor(target.value);Object.assign(d,{presetId:preset.id,name:preset.name,protocol:preset.protocol,baseUrl:preset.baseUrl,apiKey:'',hasKey:false,models:[],availableModels:[],model:'',search:'',fetched:false,fetching:false,requestId:uid()});renderProviderEditor();break;}
 case 'provider-clear-key':if(state.providerDraft)state.providerDraft.clearKey=target.checked;break;
 case 'provider-model':if(state.providerDraft)state.providerDraft.model=target.value;break;
 case 'provider-url':case 'provider-protocol':{readProviderForm();const d=state.providerDraft,old=state.providers.find(p=>p.id===d?.id);if(old&&(d.baseUrl!==old.baseUrl||d.protocol!==old.protocol)){d.hasKey=false;$('#provider-key').placeholder='目标已改变，请重新填写 API Key';$('#provider-feedback').innerHTML='<div class="notice" style="margin-bottom:14px">接口地址或协议已改变，请重新填写密钥后获取模型。</div>';}break;}
 case 'nutrition-date':case 'training-date':if(target.value){state.date=target.value;renderPage();}break;
 case 'task-day':{const day=plan()?.days.find(d=>d.id===target.value);if(day)$('#task-title').value=day.name;break;}
 case 'portion-food':choosePortion(target.value);break;
 case 'calc-sex':case 'calc-activity':updateKnowledgeTool(target.closest('form'));break;
 case 'split':$('#variant').innerHTML=variantOptions(Number(target.value));break;

 case 'muscle-filter':state.muscle=target.value;renderLibrary();break;
 case 'equipment-filter':state.equipment=target.value;renderLibrary();break;
 }
 }catch(error){toast(error.message,true);}
});
$('#modal').addEventListener('close',()=>{if(state.scheduleRefreshPending){state.scheduleRefreshPending=false;if(state.user&&state.page==='training'&&$('#page'))renderTraining();}});

document.addEventListener('keydown',event=>{
 const tab=event.target.closest('.knowledge-tabs [role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 event.preventDefault();const tabs=['nutrition','portions','exercises','muscles'],index=tabs.indexOf(state.knowledgeTab);
 state.knowledgeTab=event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):tabs[(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
 renderLibrary();$('#knowledge-tab-'+state.knowledgeTab)?.focus();
});

document.addEventListener('input',event=>{
 if(event.target.closest('#metabolism-form,#macro-energy-form,#portion-form'))updateKnowledgeTool(event.target.closest('form'));
 if(event.target.id==='provider-model-search'&&state.providerDraft){state.providerDraft.search=event.target.value;renderProviderModels();}
 if(event.target.id==='exercise-search'){const start=event.target.selectionStart;state.filter=event.target.value;renderLibrary();$('#exercise-search').focus();$('#exercise-search').setSelectionRange(start,start);}
});
async function logout() {
 modelViewer.destroy();
 await chatUploads.clearAll({removeUploaded:true});await stopChat();
 if(state.store?.status!=='expired')try{await api('/auth/logout',{method:'POST',body:{}});}catch(error){if(![401,409].includes(error.status))throw error;}
 await state.store?.close?.();localStorage.removeItem('fitness:last-user');setApiUser(null);state.user=null;state.store=null;state.providers=[];state.tasks={};state.taskModels={};state.providerDraft=null;state.files=[];state.conversation=null;state.authMode='login';chatDrafts.clear();chatScroll.clear();renderAuth();
}
$('#modal').addEventListener('cancel',()=>{if($('#provider-form'))clearProviderDraft();});
window.addEventListener('online',()=>state.store?.sync().then(()=>{toast('已恢复网络，记录已同步');}).catch(e=>toast(e.message,true)));
window.addEventListener('offline',()=>{if(state.store){state.store.status='offline';updateSync();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.store&&navigator.onLine)state.store.sync().catch(()=>{});});
setInterval(()=>{if(state.store&&!document.hidden&&navigator.onLine)state.store.sync().catch(()=>{});},30000);
boot().catch(error=>{$('#app').innerHTML=`<div class="boot"><h2>暂时无法打开健身空间</h2><p>${esc(error.message)}</p><a class="button primary" href="/">重新加载</a></div>`;});
