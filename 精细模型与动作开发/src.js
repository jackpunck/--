import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAnatomyAtlas } from './atlas-model.js';
import { createModelBridge, isSupportedExercise, readModelOptions, animatedExercises } from './embed-interface.js';
import { exerciseDetails } from './exercise-catalog.js';
import { muscleGroups, muscleIds, isSupportedMuscle, isSupportedStructure, structureLabel, structureView } from './muscle-data.js';
import { staticPoseProfiles } from './static-poses.js';

const $ = (id) => document.getElementById(id);
const exercises = {
  squat: {
    title:'徒手深蹲', equipment:'无需器械', summary:'让腿和臀一起工作，练习稳定地下蹲与站起。',
    muscles:[['quads','股四头肌','股四头肌位于大腿前侧，帮助伸直膝关节，和臀部一起将身体推起。'],['glutes','臀大肌','臀大肌参与伸髋。站起时让髋和胸一起上升。'],['core','核心肌群','腹部保持张力，帮助躯干稳定。','secondary']],
    cues:['脚掌稳定贴地，膝盖沿脚尖方向移动。','髋部向后、向下，蹲到自己能控制的深度。','用脚推地，髋与胸同步上升，自然呼气。'],
    avoid:'不要为了蹲得更深而抬脚跟，也不要让膝盖向内塌。',
    phases:[['准备站稳','双脚略宽于髋，脚尖略向外，轻轻收紧腹部。','自然呼吸'],['控制下蹲','髋膝一起弯曲，脚掌保持贴地，慢慢降低身体。','下降时吸气'],['推地站起','大腿和臀部共同用力，髋与胸一起回到站姿。','站起时呼气']],
    source:'https://www.acefitness.org/resources/everyone/exercise-library/135/bodyweight-squat/'
  },
  pushup:{
    title:'俯卧撑', equipment:'无需器械', summary:'用胸部和手臂推开地面，身体保持一条线。',
    muscles:[['chest','胸大肌','胸大肌参与将身体推离地面，是这个动作的主要发力肌群之一。'],['triceps','肱三头肌','肱三头肌位于上臂后侧，帮助伸直肘关节，与胸部一起完成推起。'],['core','核心肌群','腹部保持张力，帮助避免腰部下塌。','secondary']],
    cues:['手掌略宽于肩，腹部与臀部收紧。','肘部向身体斜后方弯曲，不完全横向张开。','把地面推远，肩、髋和腿一起升降。'],
    avoid:'不要塌腰或只抬上半身；吃力时可改为稳定高台上的上斜俯卧撑。',
    phases:[['建立支撑','手掌和脚尖支撑，头、躯干与腿保持连贯。','自然呼吸'],['控制下降','弯曲手肘，让胸部靠近地面，保持腹部张力。','下降时吸气'],['推离地面','用胸部和上臂后侧发力，让整个身体一起升起。','推起时呼气']],
    source:'https://www.acefitness.org/resources/everyone/exercise-library/41/push-up/'
  },
  curl:{
    title:'哑铃弯举', equipment:'一对哑铃', summary:'让上臂保持安静，专注于弯曲和伸展手肘。',
    muscles:[['biceps','肱二头肌','肱二头肌位于上臂前侧，参与屈肘。保持上臂相对稳定，控制抬起与放下。'],['core','核心肌群','躯干保持稳定，减少身体前后摆动借力。','secondary']],
    cues:['站稳，掌心朝前，手腕保持自然对齐。','上臂贴近身体两侧，弯曲手肘举起哑铃。','慢慢放下，别让重量把手臂直接拉落。'],
    avoid:'不要后仰、耸肩或甩动身体；不能稳定完成时应减轻重量。',
    phases:[['站稳握持','双臂自然下垂，掌心向前，保持手腕稳定。','自然呼吸'],['弯肘举起','上臂位置保持稳定，用上臂前侧带动哑铃抬起。','举起时呼气'],['缓慢放下','控制哑铃下降，回到舒适的伸肘位置。','放下时吸气']],
    source:'https://www.acefitness.org/resources/pros/expert-articles/9033/building-better-biceps-evidence-based-exercises-for-strength-and-function/'
  }
};


for(const [id,data] of Object.entries(exerciseDetails))if(!exercises[id])exercises[id]={...data,
  muscles:data.muscleIds.map((key,index)=>[key,muscleGroups[key].name,muscleGroups[key].description,index?'secondary':'primary']),
  avoid:'当前为人工设置的静态姿态，用于辨认动作方向；器械仅为轮廓示意。请结合文字要领，在可控制且无痛的范围训练。',
  phases:[['静态姿态','拖动可查看不同角度，当前没有连续动作轨迹。','自然呼吸']]};
const options=readModelOptions(window.location.search);
document.documentElement.classList.toggle('is-embedded',options.embed);
document.documentElement.classList.toggle('is-compact',options.compact);
const state={exercise:options.exercise||'squat',progress:0,playing:false,speed:1,highlight:true,selected:null,structure:null,view:'angle',appearance:'neutral',focus:'full',mode:options.mode,unsupported:options.invalidExercise};
let controls,camera,renderer,atlas,webglReady=false,lastPhase=-1,visible=true,parentVisible=true,lastPoseKey=null;
let resumeRendering=()=>{},pauseRendering=()=>{},dirty=true,pendingRenderReport=true,renderRequestId=null;
function requestRender(){dirty=true;resumeRendering();}
function setParentVisibility(value,requestId=null){parentVisible=value;if(value){if(requestId!==null)renderRequestId=requestId;pendingRenderReport=true;requestRender();}else pauseRendering();}
const bridge=createModelBridge(window,(id,requestId)=>{renderRequestId=requestId;chooseExercise(id);},(id,requestId)=>{renderRequestId=requestId;setMode('atlas');selectMuscle(id,true,true);},(name,requestId)=>{renderRequestId=requestId;setMode('atlas');selectStructure(name,true);},setParentVisibility);
const isAnimated=()=>state.mode==='motion'&&!state.unsupported&&animatedExercises.includes(state.exercise);
const activeMuscles=()=>state.mode==='atlas'?(state.selected?[[state.selected,muscleGroups[state.selected].name,muscleGroups[state.selected].description]]:[]):exercises[state.exercise].muscles;
function datasets(){const d=document.documentElement.dataset;d.exercise=state.unsupported||state.mode==='atlas'?'':state.exercise;d.mode=state.mode;d.selectedMuscle=state.selected||'';d.selectedStructure=state.structure||'';$('viewport').dataset.pose=state.mode==='motion'&&!state.unsupported?state.exercise:'atlas';}
function movementAt(progress){const ease=x=>.5-.5*Math.cos(Math.PI*Math.max(0,Math.min(1,x)));return progress<.12?0:progress<.55?ease((progress-.12)/.43):progress<.95?1-ease((progress-.55)/.4):0;}
function showPhase(){if(!isAnimated())return;const index=state.progress<.12?0:state.progress<.55?1:2;if(lastPhase===index)return;lastPhase=index;const phase=exercises[state.exercise].phases[index];$('phase-number').textContent=`0${index+1} / 03`;$('phase-title').textContent=phase[0];$('phase-cue').textContent=phase[1];$('breath').textContent=phase[2];$('phase-caption').textContent=phase[0];}
function updatePlay(){$('play').textContent=state.playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',state.playing?'暂停动画':'播放动画');$('play').disabled=!isAnimated();$('progress').disabled=!isAnimated();}
function updateColors(){atlas?.setAppearance(state.appearance,state.structure?[]:activeMuscles(),state.structure?null:state.selected,state.highlight,state.mode==='atlas'&&!state.structure);requestRender();}
function enableHighlight(){state.highlight=true;$('highlight').textContent='隐藏高亮';$('highlight').setAttribute('aria-pressed','true');}
function updateChips(){const list=state.mode==='atlas'?muscleIds.map(id=>[id,muscleGroups[id].name]):exercises[state.exercise].muscles;$('muscle-chips').replaceChildren(...list.map(([id,label,,role])=>{const b=document.createElement('button');b.className=`muscle-chip ${role||''}`;b.textContent=label;b.dataset.muscle=id;b.onclick=()=>selectMuscle(id,true,state.mode==='atlas');return b;}));markChips();}
function markChips(){document.querySelectorAll('.muscle-chip').forEach(b=>{const on=!state.structure&&b.dataset.muscle===state.selected;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});}
function selectMuscle(id,reveal=false,orient=false,notify=true){if(!isSupportedMuscle(id))return;pendingRenderReport=true;if(reveal)enableHighlight();state.selected=id;state.structure=null;atlas?.selectStructure(null);$('pose-kind').textContent=state.mode==='atlas'?'肌群 · 透视高亮':isAnimated()?'连续动画':'静态姿态 · 单帧示意';const group=muscleGroups[id];$('muscle-description').textContent=group.description;$('picked-name').textContent=group.name;$('picked-source').textContent='点击高亮可查看对应结构；左右以模型自身为准';if(state.mode==='atlas'){$('exercise-name').textContent=group.name;$('viewer-title').textContent=group.name;$('exercise-summary').textContent=group.description;document.title=`${group.name} · 肌肉图谱 · 健身助手`;}markChips();updateColors();datasets();if(orient&&camera){if(options.compact){state.focus=['quads','hamstrings','glutes','calves'].includes(id)?'lower':'upper';$('focus').value=state.focus;}setView(group.view);}if(notify)bridge.muscleSelected(id,group.name,null,state.mode,renderRequestId);}
function selectStructure(name,orient=false){if(!isSupportedStructure(name))return;pendingRenderReport=true;const info=atlas?.selectStructure(name);if(!info){state.structure=name;return;}enableHighlight();state.structure=name;state.selected=info.muscle;const description=`${info.name}。透视高亮显示该真实结构，可能透过表层肌肉。结构英文名：${name}。`;$('pose-kind').textContent=(state.mode==='atlas'?'单结构':isAnimated()?'连续动画':'静态姿态')+' · 透视高亮';$('picked-name').textContent=info.name;$('picked-source').textContent=name;$('muscle-description').textContent=description;if(state.mode==='atlas'){$('exercise-name').textContent=info.name;$('viewer-title').textContent=info.name;$('exercise-summary').textContent='已透视高亮该真实解剖结构，深层肌肉可透过表层显示。';document.title=`${info.name} · 肌肉图谱 · 健身助手`;}markChips();updateColors();datasets();if(orient&&camera){if(options.compact){state.focus=/femoris|vastus|gluteus|tibialis|gastrocnemius|soleus|sartorius|gracilis|adductor (magnus|longus|brevis)/i.test(name)?'lower':'upper';$('focus').value=state.focus;}setView(structureView(name));}bridge.muscleSelected(info.muscle,info.name,name,state.mode,renderRequestId);}
function applyPose(){
  if(!atlas)return;
  const key=state.mode==='atlas'||state.unsupported?'atlas':isAnimated()?`${state.exercise}:${movementAt(state.progress)}`:state.exercise;
  if(key===lastPoseKey)return;
  if(key==='atlas')atlas.rig.reset();else if(isAnimated())atlas.rig.pose(movementAt(state.progress),state.exercise);else atlas.rig.staticPose(state.exercise);
  lastPoseKey=key;requestRender();
}
function showDetails(){const data=exercises[state.exercise],atlasMode=state.mode==='atlas';$('equipment').textContent=atlasMode?'真实解剖网格':data.equipment;$('guide-label').textContent=atlasMode?'肌肉图谱':'动作指南';$('muscle-heading').textContent=atlasMode?'观察肌群':'哪里在发力';$('cues-heading').textContent=atlasMode?'如何观察':'动作要领';$('exercise-name').textContent=state.unsupported?'暂不支持此动作':atlasMode?'肌肉解剖图谱':data.title;$('exercise-summary').textContent=state.unsupported?'此动作 ID 未收录。请选择列表中支持的动作；当前展示解剖模型。':atlasMode?'点击模型任意肌肉查看名称，或选择下方肌群高亮。':data.summary;$('avoid-text').textContent=atlasMode?'模型来自 Z-Anatomy / BodyParts3D。高亮表示解剖位置，不表示实测发力强度。':data.avoid;$('source-link').href=atlasMode?'https://github.com/Z-Anatomy/Models-of-human-anatomy':data.source;$('source-link').textContent=atlasMode?'解剖资产来源 ↗':'动作要领参考 ↗';$('cues').replaceChildren(...(atlasMode?['拖动模型旋转，点击肌肉查看具体名称。','使用正面、侧面与背面按钮观察不同区域。','左右以模型自身为准；透视高亮可穿过表层组织。']:data.cues).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));$('pose-kind').textContent=state.unsupported?'未收录动作':atlasMode?'肌肉解剖 · 点击识别':isAnimated()?'连续动画':'静态姿态 · 单帧示意';$('viewer-title').textContent=state.unsupported?'暂不支持此动作':atlasMode?'肌肉解剖':data.title;$('primary-label').textContent=atlasMode?'已选解剖部位':'主要发力部位';$('atlas-note').hidden=!atlasMode;$('playback').hidden=!isAnimated();$('phase-card').hidden=!isAnimated();$('exercise-select').value=state.unsupported?'':state.exercise;updateChips();showPhase();updatePlay();}
function chooseExercise(id){if(!isSupportedExercise(id))return;state.mode='motion';state.unsupported=false;markModes();state.exercise=id;state.progress=0;state.structure=null;state.selected=null;state.focus='full';$('focus').value='full';lastPhase=-1;state.playing=isAnimated()&&!options.compact&&!matchMedia('(prefers-reduced-motion: reduce)').matches;atlas?.selectStructure(null);showDetails();selectMuscle(exercises[id].muscles[0][0],false,false,false);document.querySelectorAll('[data-exercise]').forEach(b=>{const on=b.dataset.exercise===id;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});$('progress').value='0';applyPose();if(camera)setView('angle');datasets();document.title=`${exercises[id].title} · 3D演示 · 健身助手`;bridge.selected(id,exercises[id].title,renderRequestId);}
function markModes(){document.querySelectorAll('[data-mode]').forEach(b=>{const on=b.dataset.mode===state.mode;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});}
function setMode(mode){
  const next=mode==='atlas'?'atlas':'motion';if(next===state.mode)return;
  if(next==='motion'){chooseExercise(state.exercise);return;}
  state.mode=next;state.focus='full';$('focus').value='full';state.playing=false;state.structure=null;state.selected=null;atlas?.selectStructure(null);
  markModes();showDetails();applyPose();datasets();if(camera)setView('angle');
}
$('exercise-select').replaceChildren(...Object.entries(exercises).map(([id,data])=>{const option=document.createElement('option');option.value=id;option.textContent=`${data.title}${animatedExercises.includes(id)?' · 动画':' · 静态'}`;return option;}));
$('exercise-select').onchange=e=>chooseExercise(e.target.value);
document.querySelectorAll('[data-exercise]').forEach(b=>b.onclick=()=>chooseExercise(b.dataset.exercise));
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('play').onclick=()=>{if(isAnimated()){state.playing=!state.playing;updatePlay();requestRender();}};
$('progress').oninput=e=>{state.progress=Number(e.target.value)/1000;state.playing=false;updatePlay();showPhase();applyPose();};
$('speed').onclick=()=>{state.speed=state.speed===1?.5:state.speed===.5?.25:1;$('speed').textContent=`${state.speed}×`;};
$('highlight').onclick=()=>{state.highlight=!state.highlight;$('highlight').textContent=state.highlight?'隐藏高亮':'显示高亮';$('highlight').setAttribute('aria-pressed',String(state.highlight));if(state.structure)atlas?.selectStructure(state.highlight?state.structure:null);updateColors();};
function setView(view){if(!camera||!controls||!atlas)return;state.view=view;const low=state.mode==='motion'&&(state.exercise==='pushup'||staticPoseProfiles[state.exercise]?.camera==='low');const profile=state.mode==='motion'?staticPoseProfiles[state.exercise]:null;const target=new THREE.Vector3(0,profile?.targetY??(low?.7:profile?.hip?.[1]===.8?1.2:1.55),0);let scale=profile?.cameraScale??1;if(state.focus!=='full'){if(state.mode==='atlas'){target.set(0,state.focus==='upper'?2.45:.88,0);scale=state.focus==='upper'?.5:.57;}else{atlas.focus[state.focus].getWorldPosition(target);scale=.63;}}const positions={angle:[profile?.workingArmView?-3.6:3.6,1.65,5.1],front:[0,.3,6.1],side:[6.1,.5,0],back:[0,.3,-6.1]};if(low&&state.focus==='full')scale*=Math.max(1,1.2/camera.aspect);camera.position.copy(target).add(new THREE.Vector3(...positions[view]).multiplyScalar(scale));controls.target.copy(target);controls.update();document.querySelectorAll('[data-view]').forEach(b=>{const on=b.dataset.view===view;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));});}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
function zoom(factor){if(!camera||!controls)return;camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);controls.update();}
$('zoom-in').onclick=()=>zoom(.85);$('zoom-out').onclick=()=>zoom(1.15);
$('appearance').onclick=()=>{state.appearance=state.appearance==='anatomy'?'neutral':'anatomy';$('appearance').textContent=state.appearance==='anatomy'?'肌肉配色':'中性材质';$('appearance').setAttribute('aria-pressed',String(state.appearance==='anatomy'));updateColors();};
$('focus').onchange=e=>{state.focus=e.target.value;if(state.focus!=='full'){state.playing=false;updatePlay();}setView(state.view);};
showDetails();datasets();markModes();
if(options.mode==='atlas'){
  if(options.muscle)selectMuscle(options.muscle,false,false,false);
  if(options.structure){const name=structureLabel(options.structure);$('exercise-name').textContent=name;$('viewer-title').textContent=name;$('pose-kind').textContent='单结构 · 透视高亮';$('exercise-summary').textContent='正在准备该真实解剖结构…';}
}
function selectionMetadata(){return {mode:state.mode,muscle:state.selected,structure:state.structure,requestId:renderRequestId};}
function selectedExercise(){return state.mode==='motion'&&!state.unsupported?state.exercise:null;}
function reportReady(){bridge.ready(selectedExercise(),$('exercise-name').textContent,webglReady,selectionMetadata());}
function reportRendered(){bridge.rendered(selectedExercise(),$('exercise-name').textContent,selectionMetadata());}
try{
  const viewport=$('viewport'),scene=new THREE.Scene();scene.background=new THREE.Color('#eaf0e7');scene.fog=new THREE.Fog('#eaf0e7',10,24);
  camera=new THREE.PerspectiveCamera(34,1,.1,40);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,options.compact?1.25:2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=!options.compact;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  viewport.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=1.25;controls.maxDistance=10;controls.maxPolarAngle=Math.PI*.80;controls.minPolarAngle=.15;
  controls.addEventListener('change',requestRender);
  controls.addEventListener('start',()=>document.querySelectorAll('[data-view]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');}));
  scene.add(new THREE.HemisphereLight('#ffffff','#727d68',2.2));const key=new THREE.DirectionalLight('#fff5e7',3.4);key.position.set(-3,6,4);key.castShadow=!options.compact;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=4;key.shadow.camera.bottom=-3;key.shadow.normalBias=.009;key.shadow.bias=-.00015;scene.add(key);
  const fill=new THREE.DirectionalLight('#ecfff3',2);fill.position.set(3,4,4);scene.add(fill);const rim=new THREE.DirectionalLight('#fff5e7',.8);rim.position.set(1,4,-4);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#eaf0e7',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  atlas=createAnatomyAtlas({rigged:true});scene.add(atlas.body);
  if(state.unsupported){state.mode='atlas';applyPose();showDetails();datasets();}
  else if(state.mode==='motion')chooseExercise(state.exercise);
  else {lastPoseKey='atlas';setView('angle');}
  if(options.structure)selectStructure(options.structure,true);else if(options.muscle)selectMuscle(options.muscle,true,true);else if(state.mode==='atlas'){$('picked-name').textContent='点击肌肉查看名称';$('picked-source').textContent='支持拖动旋转、双指缩放';state.selected=null;updateColors();datasets();}
  function updateLabels(){if(options.compact)return;const items=state.structure?[]:activeMuscles().filter(m=>m[3]!=='secondary').slice(0,2);for(const [i,id] of ['label-a','label-b'].entries()){const el=$(id),item=items[i],anchor=item&&atlas.anchors[item[0]];el.hidden=!state.highlight||!anchor;if(!anchor)continue;el.textContent=item[1];const point=anchor.getWorldPosition(new THREE.Vector3()).project(camera);let x=(point.x*.5+.5)*viewport.clientWidth,y=(-point.y*.5+.5)*viewport.clientHeight;x+=i===0?15:-el.offsetWidth-20;y+=i===0?-10:8;x=Math.max(8,Math.min(viewport.clientWidth-el.offsetWidth-8,x));y=Math.max(12,Math.min(viewport.clientHeight-85,y));el.style.transform=`translate(${x}px,${y}px)`;}}
  const raycaster=new THREE.Raycaster();let pointerStart=null;renderer.domElement.addEventListener('pointerdown',e=>{pointerStart=[e.clientX,e.clientY];});renderer.domElement.addEventListener('pointercancel',()=>{pointerStart=null;});
  renderer.domElement.addEventListener('pointerup',e=>{if(!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>7){pointerStart=null;return;}pointerStart=null;const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const info=atlas.raycastStructure(raycaster,state.mode==='atlas');if(info?.kind==='muscle')selectStructure(info.structure);else if(info){$('picked-name').textContent=info.name;$('picked-source').textContent=info.structure;requestRender();}});
  const resize=()=>{const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();setView(state.view);requestRender();};new ResizeObserver(resize).observe(viewport);resize();updateColors();webglReady=true;
  let raf=0,previous=performance.now(),readySent=false;
  const canRender=()=>webglReady&&parentVisible&&visible&&!document.hidden;
  pauseRendering=()=>{if(raf)cancelAnimationFrame(raf);raf=0;previous=performance.now();};
  resumeRendering=()=>{if(!raf&&canRender())raf=requestAnimationFrame(frame);};
  function frame(now){
    raf=0;if(!canRender())return;
    const dt=Math.min((now-previous)/1000,.05);previous=now;dirty=false;
    if(isAnimated()&&state.playing){state.progress=(state.progress+dt*state.speed/6)%1;$('progress').value=String(Math.round(state.progress*1000));applyPose();showPhase();}
    controls.update();updateLabels();try{renderer.render(scene,camera);}catch(error){webglReady=false;pauseRendering();console.error('3D rendering failed',error);$('loading').hidden=false;$('loading').textContent='3D 显示暂不可用，请重试；文字说明仍可查看。';reportReady();return;}
    if(!readySent){readySent=true;$('loading').hidden=true;reportReady();}
    if(pendingRenderReport){pendingRenderReport=false;reportRendered();}
    if(dirty||(isAnimated()&&state.playing))resumeRendering();
  }
  new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;if(visible)requestRender();else pauseRendering();}).observe(viewport);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseRendering();else requestRender();});
  requestRender();
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();pauseRendering();webglReady=false;state.playing=false;updatePlay();$('loading').hidden=false;$('loading').textContent='3D 显示已中断，请刷新页面恢复；文字内容仍可查看。';reportReady();});
}catch(error){console.error('3D initialization failed',error);webglReady=false;state.playing=false;updatePlay();$('loading').hidden=false;$('loading').textContent='当前浏览器无法启动 3D，请使用支持 WebGL 的浏览器。文字说明仍可查看。';$('play').disabled=true;$('progress').disabled=true;reportReady();}
