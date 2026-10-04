import {exercises} from './compute-catalog.js';

// IDs are shared with the local anatomy viewer. Aliases select an available
// structure or muscle group; unknown exercises never fall back to a squat.
const groups = [
  ['chest','胸肌（胸大肌、胸小肌）',['胸肌','胸大肌','胸小肌','胸部肌肉','pectoralis','pecs'],'胸部前方的胸大肌与胸小肌；高亮为整个肌群，点击模型可看具体结构。'],
  ['biceps','肱二头肌',['二头肌','二头','biceps'],'上臂前侧的肱二头肌。'],
  ['triceps','肱三头肌',['三头肌','三头','triceps'],'上臂后侧的肱三头肌。'],
  ['deltoids','三角肌',['肩部肌肉','肩肌','三角肌前束','三角肌中束','三角肌后束','deltoid','deltoids'],'肩部三角肌；模型高亮整个肌群。'],
  ['lats','背阔肌',['背部肌肉','latissimus','lats'],'背部两侧的背阔肌。'],
  ['traps','斜方肌',['trapezius','traps'],'颈部至上背部的斜方肌；模型高亮整个肌群，上、中、下部可单独选择。'],
  ['core','腹部核心（腹直肌、腹横肌）',['腹肌','腹直肌','腹横肌','核心肌群','核心肌肉','腹部肌肉','abdominals','abs'],'腹部核心示意，高亮腹直肌与腹横肌。'],
  ['obliques','腹斜肌',['腹内斜肌','腹外斜肌','obliques'],'腹部两侧的腹内斜肌和腹外斜肌。'],
  ['quads','股四头肌',['股四头','大腿前侧','股直肌','股外侧肌','股内侧肌','股中间肌','quadriceps','quads'],'大腿前侧的股四头肌群。'],
  ['hamstrings','腘绳肌',['腘绳肌群','腘绳','大腿后侧','股二头肌','半腱肌','半膜肌','hamstrings'],'大腿后侧肌群，包括股二头肌、半腱肌与半膜肌。'],
  ['glutes','臀部肌群',['臀肌','臀大肌','臀中肌','臀小肌','glutes','gluteus'],'高亮臀大肌、臀中肌与臀小肌，点击模型可看具体结构。'],
  ['calves','小腿后侧肌群',['小腿肌肉','小腿肌','腓肠肌','比目鱼肌','calves','gastrocnemius','soleus'],'小腿后侧的腓肠肌、比目鱼肌和跖肌。'],
  ['forearms','前臂肌群',['前臂肌肉','前臂','小臂肌肉','小臂','forearm','forearms'],'前臂屈伸肌群；高亮用于识别位置。'],
];
const structures = [
  ['traps-upper','斜方肌上部',['斜方肌上部','斜方肌上束','上斜方肌','upper trapezius','upper traps'],'Descending part of trapezius muscle.l'],
  ['traps-middle','斜方肌中部',['斜方肌中部','斜方肌中束','中斜方肌','middle trapezius','middle traps'],'Transverse part of trapezius muscle.l'],
  ['traps-lower','斜方肌下部',['斜方肌下部','斜方肌下束','下斜方肌','lower trapezius','lower traps'],'Ascending part of trapezius muscle.l'],
  ['serratus-anterior','前锯肌',['前锯肌','serratus anterior'],'Serratus anterior muscle.l'],
  ['rhomboid-major','大菱形肌',['菱形肌','大菱形肌','rhomboid major'],'Rhomboid major muscle.l'],
  ['rhomboid-minor','小菱形肌',['小菱形肌','rhomboid minor'],'Rhomboid minor muscle.l'],
  ['tibialis-anterior','胫骨前肌',['胫骨前肌','胫前肌','tibialis anterior'],'Tibialis anterior muscle.l'],
  ['adductor-longus','长收肌',['长收肌','内收长肌','adductor longus'],'Adductor longus.l'],
  ['adductor-magnus','大收肌',['大收肌','内收大肌','adductor magnus'],'Adductor magnus.l'],
  ['adductor-brevis','短收肌',['短收肌','内收短肌','adductor brevis'],'Adductor brevis.l'],
  ['longissimus','胸最长肌',['胸最长肌','longissimus thoracis'],'Longissimus thoracis muscle.l'],
  ['iliocostalis','腰髂肋肌',['腰髂肋肌','髂肋肌','iliocostalis lumborum'],'Iliocostalis lumborum muscle.l'],
  ['brachialis','肱肌',['肱肌','brachialis'],'Brachialis muscle.l'],
  ['rectus-abdominis','腹直肌',['腹直肌','rectus abdominis'],'Rectus abdominis muscle.l'],
  ['transversus-abdominis','腹横肌',['腹横肌','transversus abdominis'],'Transversus abdominis muscle.l'],
  ['deltoid-anterior','三角肌前束',['三角肌前束','三角肌锁骨部','anterior deltoid'],'Clavicular part of deltoid muscle.l'],
  ['deltoid-middle','三角肌中束',['三角肌中束','三角肌肩峰部','middle deltoid'],'Acromial part of deltoid muscle.l'],
  ['deltoid-posterior','三角肌后束',['三角肌后束','三角肌肩胛冈部','posterior deltoid'],'Scapular spinal part of deltoid muscle.l'],
  ['gluteus-maximus','臀大肌',['臀大肌','gluteus maximus'],'Gluteus maximus muscle.l'],
  ['gluteus-medius','臀中肌',['臀中肌','gluteus medius'],'Gluteus medius muscle.l'],
  ['gluteus-minimus','臀小肌',['臀小肌','gluteus minimus'],'Gluteus minimus muscle.l'],
  ['soleus','比目鱼肌',['比目鱼肌','soleus'],'Soleus muscle.l'],
  ['rectus-femoris','股直肌',['股直肌','rectus femoris'],'Rectus femoris muscle.l'],
  ['vastus-lateralis','股外侧肌',['股外侧肌','vastus lateralis'],'Vastus lateralis muscle.l'],
  ['vastus-medialis','股内侧肌',['股内侧肌','vastus medialis'],'Vastus medialis muscle.l'],
  ['vastus-intermedius','股中间肌',['股中间肌','vastus intermedius'],'Vastus intermedius muscle.l'],
  ['supraspinatus','冈上肌',['冈上肌','supraspinatus'],'Supraspinatus muscle.l'],
  ['infraspinatus','冈下肌',['冈下肌','infraspinatus'],'Infraspinatus muscle.l'],
  ['teres-major','大圆肌',['大圆肌','teres major'],'Teres major muscle.l'],
  ['teres-minor','小圆肌',['小圆肌','teres minor'],'Teres minor muscle.l'],
  ['subscapularis','肩胛下肌',['肩胛下肌','subscapularis'],'Subscapularis muscle.l'],
];
export const muscleCatalog = Object.freeze([
  ...groups.map(([id,name,aliases,description]) => ({id,name,aliases,description})),
  ...structures.map(([id,name,aliases,structure]) => ({id,name:`${name}（左侧）`, aliases,structure,description:`展示左侧${name}的独立解剖结构，可旋转模型查看。` })),
].map(m => Object.freeze({...m,aliases:Object.freeze(m.aliases)})));

const exerciseAliases = {
  squat:['深蹲','徒手蹲','bodyweight squat','squat'],pushup:['俯卧撑','push-up','push up','pushup'],curl:['弯举','二头弯举','biceps curl','dumbbell curl'],
  bench:['卧推','平板卧推','dumbbell bench press','bench press'], 'incline-bench':['上斜卧推','上斜推胸','incline bench press'],
  'chest-press':['器械卧推','器械推胸','chest press'], 'lat-pulldown':['下拉','高位下拉','lat pulldown'],
  row:['坐姿划船','绳索划船','seated row'], 'dumbbell-row':['哑铃划船','单臂划船','dumbbell row'],pullup:['引体向上','辅助引体','pull-up','pull up','pullup'],
  'shoulder-press':['肩推','哑铃肩推','推举','shoulder press'], 'lateral-raise':['侧平举','lateral raise'], 'reverse-fly':['俯身飞鸟','反向飞鸟','reverse fly'],
  triceps:['绳索下压','三头下压','triceps pushdown'], 'overhead-triceps':['颈后臂屈伸','颈后屈伸','overhead triceps extension'],
  'hammer-curl':['锤式弯举','锤式','hammer curl'], 'goblet-squat':['高脚杯深蹲','高脚杯蹲','goblet squat'],rdl:['罗马尼亚硬拉','罗马尼亚式硬拉','rdl','romanian deadlift'],
  lunge:['箭步蹲','弓步蹲','反向箭步蹲','reverse lunge'], 'leg-curl':['腿弯举','leg curl'], 'leg-extension':['腿屈伸','leg extension'],
  'glute-bridge':['臀桥','glute bridge'],plank:['平板支撑','plank'],crunch:['卷腹','crunch'], 'calf-raise':['提踵','踮脚','calf raise'],
};

export function modelUrl(type, id, {compact = false} = {}) {
  const params = new URLSearchParams();
  if (type === 'exercise' && exercises.some(e => e.id === id)) params.set('exercise',id);
  else if (type === 'muscle') {
    const muscle = muscleCatalog.find(m => m.id === id);
    if (!muscle) return null;
    params.set('mode','atlas');
    params.set(muscle.structure ? 'structure' : 'muscle', muscle.structure || muscle.id);
  } else return null;
  params.set('embed','1');
  if (compact) params.set('compact','1');
  return `/model/index.html?${params}`;
}

const normalize = value => value.normalize('NFKC').toLowerCase();
const entries = [
  ...exercises.map(e => ({type:'exercise',id:e.id,title:e.name,aliases:[e.name,...exerciseAliases[e.id] || []]})),
  ...muscleCatalog.map(m => ({type:'muscle',id:m.id,title:m.name,structure:m.structure,aliases:[m.name,...m.aliases]})),
];

/** Deterministic local retrieval, bounded to two real viewers per message. */
export function findVisuals(text, {limit = 2} = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const query = normalize(text.slice(0,32000)), candidates = [];
  for (const entry of entries) for (const alias of new Set(entry.aliases.map(normalize))) {
    let offset = 0, start;
    while ((start = query.indexOf(alias,offset)) !== -1) {
      const end = start + alias.length; offset = end;
      if (/^[a-z]/.test(alias) && /[a-z]/.test(query[start-1] || '')) continue;
      if (/[a-z]$/.test(alias) && /[a-z]/.test(query[end] || '')) continue;
      const negated = /(?:不要|不用|不看|不需要|别)(?:给我|展示|显示|看|讲|介绍|高亮)*\s*$/.test(query.slice(Math.max(0,start-12),start));
      candidates.push({entry,start,end,length:alias.length,negated});
    }
  }
  // Specific full exercise names win over contained generic aliases (e.g.
  // hammer curl vs curl, or a muscle name inside the exercise's name).
  const priority = entry => entry.type === 'exercise' ? 2 : entry.structure ? 1 : 0;
  candidates.sort((a,b) => a.start - b.start || b.length - a.length || priority(b.entry) - priority(a.entry));
  const result = [], seen = new Set();
  const max = Number.isFinite(limit) ? Math.min(2,Math.max(0,Math.floor(limit))) : 2;
  let coveredUntil = -1;
  for (const {entry,start,end,negated} of candidates) {
    if (start < coveredUntil) continue;
    coveredUntil = end;
    if (negated) continue;
    const key = `${entry.type}:${entry.id}`;
    if (seen.has(key)) continue;
    if (result.length >= max) break;
    seen.add(key);result.push({type:entry.type,id:entry.id,title:entry.title,url:modelUrl(entry.type,entry.id,{compact:true})});
  }
  return result;
}

// Validate a model decision; never infer a decision from conversation text.
export function resolveVisualSelection(selection) {
  if(!Array.isArray(selection)||selection.length>2)throw new Error('每条回答最多展示两个模型。');
  const result=[],seen=new Set();
  for(const item of selection){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['type','id'].includes(key)))throw new Error('请只提供模型 type 和 id。');
    const entry=entries.find(entry=>entry.type===item.type&&entry.id===item.id);
    if(!entry)throw new Error('未收录此模型，请读取 visuals 目录选择真实 ID。');
    const key=entry.type+':'+entry.id;if(seen.has(key))continue;seen.add(key);
    result.push({type:entry.type,id:entry.id,title:entry.title,url:modelUrl(entry.type,entry.id,{compact:true})});
  }
  return result;
}
export function chatVisuals(message) {
  const decision=message?.toolResults?.findLast(result=>result.name==='set_chat_visuals'&&result.ok);
  if(!decision)return [];
  try{return resolveVisualSelection(decision.visuals.map(({type,id})=>({type,id})));}catch{return [];}
}
