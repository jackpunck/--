// Authored teaching trajectories. Directions are normalized by the rig, so
// interpolation changes joint angles without scaling bones or held equipment.
const lerp=(a,b,q)=>a+(b-a)*q;
const blend=(a,b,q)=>a.map((v,i)=>lerp(v,b[i],q));
const arm=(angle,z=.04)=>[Math.sin(angle),-Math.cos(angle),z];

export const extendedMotionInfo=Object.freeze({
  bench:{first:'eccentric',start:'伸臂准备',out:'控制下放',back:'向上推起',camera:'low',targetY:1.15},
  'incline-bench':{first:'eccentric',start:'斜凳准备',out:'控制下放',back:'向上推起',targetY:1.4},
  'chest-press':{first:'concentric',start:'坐稳握柄',out:'向前推开',back:'缓慢还原',targetY:1.3},
  'lat-pulldown':{first:'concentric',start:'伸臂握杆',out:'向胸前下拉',back:'控制上送',targetY:1.75,cameraScale:1.12},
  row:{first:'concentric',start:'坐稳伸臂',out:'拉向腹部',back:'控制伸臂',targetY:1.15},
  'dumbbell-row':{first:'concentric',start:'扶凳稳定',out:'单臂向后拉',back:'缓慢下放',targetY:1.55,workingArmView:true},
  pullup:{first:'concentric',start:'辅助悬垂',out:'向上拉起',back:'控制下降',targetY:2.25,cameraScale:1.3},
  'shoulder-press':{first:'concentric',start:'肩侧持铃',out:'向上推举',back:'控制下放',targetY:1.85,cameraScale:1.18},
  'lateral-raise':{first:'concentric',start:'身体站稳',out:'向两侧抬起',back:'控制下放'},
  'reverse-fly':{first:'concentric',start:'俯身稳定',out:'向两侧展开',back:'控制合拢',targetY:1.45},
  triceps:{first:'concentric',start:'上臂固定',out:'伸肘下压',back:'控制屈肘'},
  'overhead-triceps':{first:'concentric',start:'头后持铃',out:'伸肘举起',back:'控制下放',targetY:1.85,cameraScale:1.18},
  'hammer-curl':{first:'concentric',start:'中立握铃',out:'弯肘举起',back:'缓慢下放'},
  'goblet-squat':{first:'eccentric',start:'胸前持铃',out:'控制下蹲',back:'推地站起'},
  rdl:{first:'eccentric',start:'站稳持铃',out:'屈髋下放',back:'伸髋站起'},
  lunge:{first:'eccentric',start:'站稳准备',out:'右腿后撤下蹲',back:'前脚推地收回'},
  'leg-curl':{first:'concentric',start:'坐稳伸腿',out:'屈膝收回',back:'控制伸腿',targetY:1.1},
  'leg-extension':{first:'concentric',start:'坐稳屈膝',out:'伸膝抬起',back:'控制屈膝',targetY:1.1},
  'glute-bridge':{first:'concentric',start:'仰卧屈膝',out:'伸髋抬起',back:'缓慢回落',camera:'low',targetY:.7},
  plank:{first:'isometric',isometric:true,start:'建立支撑',out:'保持稳定',back:'保持呼吸',camera:'low',targetY:.65},
  crunch:{first:'concentric',start:'仰卧屈膝',out:'轻卷上背',back:'缓慢回落',camera:'low',targetY:.7},
  'calf-raise':{first:'concentric',start:'站稳扶杆',out:'抬起脚跟',back:'控制落下'},
});
export const extendedMotionIds=Object.freeze(Object.keys(extendedMotionInfo));

export function sampleExtendedPose(id,q,lengths){
  if(!extendedMotionInfo[id])return null;
  const {thigh,shin,upper,fore}=lengths;
  const groundHip=(a,b,z=0)=>[0,.155+thigh*Math.cos(a)+shin*Math.cos(b),z+thigh*Math.sin(a)+shin*Math.sin(b)];
  const standing={hip:groundHip(0,0),thigh:0,shin:0,armSpace:'world'};
  const seated={hip:[0,.155+shin,0],thigh:-Math.PI/2,shin:0,support:'seat',armSpace:'world'};
  switch(id){
    case 'bench':case 'incline-bench':return {...standing,hip:[0,.973,0],torso:id==='bench'?-Math.PI/2:-Math.PI/3,thigh:-1.35,shin:0,
      upper:blend([.12,.99,.03],[.84,-.1,.53],q),fore:blend([-.09,.99,.02],[0,1,0],q),weights:true,support:id==='bench'?'flat':'incline'};
    case 'chest-press':return {...seated,wristTargets:{x:lerp(.70,.49,q),y:lerp(1.50,1.52,q),z:lerp(.44,.94,q)},cable:true,handles:true};
    case 'lat-pulldown':return {...seated,bar:true,cable:true,handTargets:{x:.60,y:lerp(2.78,1.56,q),z:lerp(.26,.42,q)},handFacing:'bar'};
    case 'row':return {...seated,hip:groundHip(-1.35,-.70),thigh:-1.35,shin:-.70,torso:.08*(1-q),upper:blend([.08,-.15,1],[.1,-.98,-.16],q),fore:blend([0,.1,1],[-.1,.15,1],q),cable:true,handles:true};
    case 'dumbbell-row':return {...standing,hip:groundHip(-.13,.16),thigh:-.13,shin:.16,torso:1.05,upper:blend([.05,-1,0],[.05,-.5,-.865],q),fore:blend([0,-1,0],[0,-.9,.3],q),weights:'right',support:'side',supportPalm:[.70,1.40,.35]};
    case 'pullup':return {...standing,hip:[0,lerp(1.70,2.60,q),-.06],thigh:.10,shin:.6,bar:true,barFixed:[0,3.72,.10],handTargets:{x:.62,y:3.72,z:.10},handFacing:'bar',assisted:true};
    case 'shoulder-press':return {...standing,upper:blend([.8,-.1,.25],[.20,.98,.02],q),fore:blend([0,.95,.1],[-.13,.99,.02],q),weights:true};
    case 'lateral-raise':return {...standing,upper:arm(.08+1.42*q,.12),fore:arm(.08+1.27*q,.12),weights:true};
    case 'reverse-fly':return {...standing,hip:groundHip(-.30,.18),thigh:-.30,shin:.18,torso:.95,upper:blend([.10,-.98,.05],[1,-.10,-.05],q),fore:blend([-.1,-.98,.03],[1,-.12,.12],q),weights:true};
    case 'triceps':return {...standing,upper:[.10,-1,0],fore:[0,-Math.sin(.1+1.35*q),Math.cos(.1+1.35*q)],cable:true,handles:true};
    case 'overhead-triceps':return {...standing,weights:'single',gripProgress:q};
    case 'hammer-curl':return {base:'curl',q,weights:true,hammer:true};
    case 'goblet-squat':return {base:'squat',q,weights:'goblet'};
    case 'rdl':return {...standing,hinge:q,torso:q,upper:[.06,-.97,.36-.51*q],fore:[0,-.96,.36-.54*q],weights:true};
    case 'lunge':return {...standing,hip:[0,lerp(1.60,.98,q),-.30*q],torso:.06+.08*q,lunge:q,upper:[.1,-1,0],fore:[0,-1,0]};
    case 'leg-curl':return {...seated,shin:lerp(-1.45,.35,q),upper:[.2,-1,0],fore:[0,-1,.1],roller:true};
    case 'leg-extension':return {...seated,shin:lerp(0,-1.45,q),upper:[.2,-1,0],fore:[0,-1,.1],roller:true};
    case 'glute-bridge':return {...standing,bridge:q,torso:-Math.PI/2-.51*q,groundLegs:true,armSpace:'world'};
    case 'plank':return {base:'plank'};
    case 'crunch':return {...standing,hip:[0,.27,0],torso:-Math.PI/2+.33*q,groundLegs:true,upper:[.1,-.9,.25],fore:[-.15,-.7,.3],armSpace:'body'};
    case 'calf-raise':return {...standing,calf:q,upper:[.12,-.7,.6],fore:[0,-.6,.8],balanceRail:true};
  }
}
