import {extendedActivityProfiles} from './extended-activity-profiles.js';
// Authored teaching curves in arbitrary units, not measured force or EMG.
// q matches rig.pose(): start=0, far end=1. No archived force-table dependency.
export const activityProfiles=Object.freeze({
  ...extendedActivityProfiles,
  squat:{
    firstContraction:'eccentric',
    note:'示意重点：较深位置与起身初段更用力，接近站直时相对减轻。',
    phases:{hold:'站直时相对较轻，核心仍帮助稳定身体。',eccentric:'下降也在用力控制；示意颜色随下蹲加深。',turn:'底部转向时仍需支撑，不会因短暂停顿而熄灭。',concentric:'起身前半段示意较强，接近站直时逐渐减轻。'},
    muscles:{
      quads:{role:'primary',curve:[[0,.15],[.35,.42],[.75,.90],[1,1]],peak:'下蹲较深、起身初段',low:'接近站直'},
      glutes:{role:'primary',curve:[[0,.12],[.35,.32],[.75,.83],[1,1]],peak:'下蹲较深、开始伸髋',low:'接近站直'},
      core:{role:'stabilizer',curve:[[0,.45],[1,.45]],peak:'全程帮助稳定躯干',low:'保持张力'},
    },
  },
  pushup:{
    firstContraction:'eccentric',
    note:'示意重点：下降控制与推起都在用力；较低位置颜色更深。',
    phases:{hold:'高位支撑相对较轻，但手臂和核心仍在支撑身体。',eccentric:'控制身体下降，胸部和手臂逐渐进入示意较强区间。',turn:'最低处转向仍需支撑；停住不代表肌肉放松。',concentric:'从低位推起时示意较强，接近高位时相对减轻。'},
    muscles:{
      chest:{role:'primary',curve:[[0,.2],[.35,.55],[.8,1],[1,.95]],peak:'较低位置、推起初段',low:'接近高位支撑'},
      triceps:{role:'primary',curve:[[0,.22],[.4,.63],[.8,1],[1,.92]],peak:'低位到推起前半段',low:'接近高位支撑'},
      deltoids:{role:'secondary',curve:[[0,.25],[.4,.6],[.85,1],[1,.95]],peak:'较低位置辅助推起',low:'接近高位支撑'},
      core:{role:'stabilizer',curve:[[0,.45],[1,.45]],peak:'全程稳定身体',low:'避免塌腰，持续支撑'},
    },
  },
  curl:{
    firstContraction:'concentric',
    note:'示意重点：前臂接近水平的中后段颜色最深，举到最顶端不一定最用力。',
    phases:{hold:'手臂接近下垂时，屈肘负担示意较轻；仍保持握持。',concentric:'随前臂接近水平，示意逐渐增强；继续弯至顶端后略减轻。',turn:'顶部转向仍在握持负重，不会因暂停而清零。',eccentric:'慢放同样需要控制；经过前臂接近水平的位置仍显示较强。'},
    muscles:{
      biceps:{role:'primary',curve:[[0,.15],[.3,.60],[.72,1],[1,.80]],peak:'前臂接近水平',low:'手臂接近下垂'},
      forearms:{role:'stabilizer',curve:[[0,.45],[1,.45]],peak:'全程握持哑铃',low:'持续握持'},
      core:{role:'stabilizer',curve:[[0,.4],[1,.4]],peak:'全程辅助稳定躯干',low:'避免身体摆动'},
    },
  },
});
