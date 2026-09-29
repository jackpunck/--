import {extendedMotionInfo} from './motion-poses.js';

// Illustrative trend families; shared evaluation still normalizes each muscle
// over its own full movement. None of these values represents measured force.
const rising=[[0,.18],[.35,.45],[.8,.92],[1,1]];
const middle=[[0,.3],[.55,1],[1,.65]];
const lowPosition=[[0,.2],[.4,.6],[.8,1],[1,.92]];
const curl=[[0,.15],[.3,.6],[.72,1],[1,.8]];
const muscle=(curve,peak,low,role='primary')=>({role,curve,peak,low});
const stable=(peak='全程帮助稳定躯干',role='stabilizer')=>muscle([[0,1],[1,1]],peak,'持续支撑',role);
function profile(id,note,muscles){
  const info=extendedMotionInfo[id];
  const moving={concentric:info.first==='concentric'?info.out:info.back,eccentric:info.first==='eccentric'?info.out:info.back};
  return {firstContraction:info.first,isometric:!!info.isometric,note,muscles,phases:{
    hold:`${info.start}，先稳定姿势。`,
    concentric:`${moving.concentric}。${note}`,
    eccentric:`${moving.eccentric}，还原时也要控制。${note}`,
    turn:'行程转向仍需控制，不因短暂停顿而完全放松。',
    isometric:'持续支撑并自然呼吸。等长动作保持稳定发力，不随进度反复增强或减弱。',
  }};
}
export const extendedActivityProfiles=Object.freeze({
  bench:profile('bench','较低位置与开始推起的区间示意较强，伸臂后相对减轻。',{
    chest:muscle(lowPosition,'较低位置、推起初段','接近伸臂'),triceps:muscle(lowPosition,'推起的前半段','接近伸臂','secondary'),deltoids:muscle(lowPosition,'低位辅助推起','接近伸臂','secondary'),core:stable(),
  }),
  'incline-bench':profile('incline-bench','胸部与肩部协同推举，低位和推起前半段颜色较深。',{
    chest:muscle(lowPosition,'低位、推起前半段','接近伸臂'),deltoids:muscle(lowPosition,'辅助向上推举','接近伸臂','secondary'),triceps:muscle(lowPosition,'推举中段','接近伸臂','secondary'),core:stable(),
  }),
  'chest-press':profile('chest-press','以中段加深强调胸部推力；实际阻力变化取决于器械。',{
    chest:muscle(middle,'推开中段','开始与接近末端'),triceps:muscle(middle,'伸肘中段','行程两端','secondary'),core:stable(),
  }),
  'lat-pulldown':profile('lat-pulldown','用中段加深强调背部下拉；上送阶段继续控制。',{
    lats:muscle(middle,'下拉中段','接近伸臂'),biceps:muscle(middle,'屈肘下拉中段','接近伸臂','secondary'),forearms:stable('全程握杆'),core:stable(),
  }),
  row:profile('row','背部向后拉动并控制送回，靠近收回位置示意较强。',{
    lats:muscle(rising,'收回前后','接近伸臂'),traps:muscle(rising,'肩胛向后控制时','接近伸臂','secondary'),biceps:muscle(middle,'屈肘中段','行程两端','secondary'),core:stable(),
  }),
  'dumbbell-row':profile('dumbbell-row','右臂划船，左手扶凳。肌群颜色用于左右对照，动作以右臂示范。',{
    lats:{...muscle(rising,'右臂向后拉起','右臂下垂')},biceps:{...muscle(middle,'右臂屈肘中段','行程两端','secondary')},core:stable(),
  }),
  pullup:profile('pullup','背部和手臂共同拉起，辅助托板随身体升降；颜色不表示辅助重量。',{
    lats:muscle(middle,'拉起中段','行程两端'),biceps:muscle(middle,'屈肘中段','接近伸臂','secondary'),forearms:stable('全程握紧单杠'),core:stable(),
  }),
  'shoulder-press':profile('shoulder-press','肩部推起的前中段示意较强，接近顶部时相对减轻。',{
    deltoids:muscle([[0,.65],[.4,1],[1,.3]],'推起前中段','接近顶部'),triceps:muscle(middle,'伸肘推举中段','行程两端','secondary'),core:stable(),
  }),
  'lateral-raise':profile('lateral-raise','手臂接近肩高时示意较强，下放时继续控制。',{
    deltoids:muscle(rising,'接近肩高','手臂接近身体两侧'),traps:muscle(rising,'手臂抬高时辅助稳定','接近下垂','secondary'),core:stable(),
  }),
  'reverse-fly':profile('reverse-fly','手臂展开、接近身体两侧时示意较强，躯干保持稳定。',{
    deltoids:muscle(rising,'手臂展开时','双臂下垂'),traps:muscle(rising,'控制肩胛时','双臂下垂','secondary'),core:stable(),
  }),
  triceps:profile('triceps','保持上臂位置，以中段加深强调伸肘；器械阻力会影响实际变化。',{
    triceps:muscle(middle,'伸肘下压中段','行程两端'),forearms:stable('持续握持手柄'),core:stable(),
  }),
  'overhead-triceps':profile('overhead-triceps','前臂从头后举起，中段示意较强；顶部仍保持握持。',{
    triceps:muscle(middle,'伸肘中段','接近伸直'),forearms:stable('双手共同握持哑铃'),core:stable(),
  }),
  'hammer-curl':profile('hammer-curl','中立握持，前臂接近水平时示意较强。',{
    biceps:muscle(curl,'前臂接近水平','接近下垂'),forearms:muscle(curl,'前臂接近水平','接近下垂','secondary'),core:stable(),
  }),
  'goblet-squat':profile('goblet-squat','下蹲较深及起身初段示意较强；双手持续在胸前持铃。',{
    quads:muscle(rising,'下蹲较深、起身初段','接近站直'),glutes:muscle(rising,'较深位置、开始伸髋','接近站直'),forearms:stable('双手持续持铃'),core:stable(),
  }),
  rdl:profile('rdl','髋部后移、躯干前倾时示意逐渐增强，站直后相对减轻。',{
    hamstrings:muscle(rising,'髋部后移、下放较深','接近站直'),glutes:muscle(rising,'开始伸髋站起','接近站直'),forearms:stable('全程握铃'),core:stable(),
  }),
  lunge:profile('lunge','示范右腿后撤、左腿主导推地；下蹲较深及起身初段示意较强。',{
    quads:muscle(rising,'较深位置、前腿推地','回到站姿'),glutes:muscle(rising,'前腿伸髋站起','回到站姿'),core:stable(),
  }),
  'leg-curl':profile('leg-curl','以中段加深强调腘绳肌屈膝，实际阻力曲线随器械而异。',{
    hamstrings:muscle(middle,'屈膝中段','行程两端'),calves:muscle(middle,'辅助屈膝','行程两端','secondary'),core:stable(),
  }),
  'leg-extension':profile('leg-extension','以中后段加深强调股四头肌伸膝，实际阻力曲线随器械而异。',{
    quads:muscle([[0,.3],[.65,1],[1,.85]],'伸膝中后段','屈膝起点'),core:stable(),
  }),
  'glute-bridge':profile('glute-bridge','用上抬时的颜色加深强调臀部伸髋，回落阶段继续控制。',{
    glutes:muscle(rising,'抬髋后半段','接近低位'),hamstrings:muscle(rising,'辅助伸髋','接近低位','secondary'),core:stable(),
  }),
  plank:profile('plank','持续支撑演示：腹部保持稳定张力，正常呼吸，不随时间伪造发力峰值。',{
    core:stable('持续稳定躯干','primary'),glutes:stable('帮助身体保持直线'),deltoids:stable('持续支撑肩部'),
  }),
  crunch:profile('crunch','轻卷上背时强调腹部收缩，回落时仍控制，不抬成仰卧起坐。',{
    core:muscle(rising,'卷起上背时','接近回落位置'),
  }),
  'calf-raise':profile('calf-raise','脚跟抬起时强调小腿用力，前脚掌位置固定；下降时继续控制。',{
    calves:muscle(rising,'抬起脚跟时','脚跟接近落下'),core:stable('扶杆并稳定身体'),
  }),
});
