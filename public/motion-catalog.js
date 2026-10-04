/** Names and optional teaching links. Motion quality is evaluated by the AI;
 * this catalogue contains no posture thresholds, scoring or exercise rules. */
export const MOTION_CATALOG_VERSION = 'motion-catalog-3.2.0';
export const motionFamilies = Object.freeze({
  squat: '深蹲', pushup: '俯卧撑', 'elbow-isolation': '屈伸肘孤立动作',
  'horizontal-press': '水平推胸', 'vertical-pull': '垂直拉', row: '水平划船',
  'overhead-press': '头上推举', 'lateral-raise': '侧向抬臂', 'reverse-fly': '俯身飞鸟',
  'overhead-extension': '头上臂屈伸', hinge: '髋铰链', lunge: '箭步蹲',
  'knee-isolation': '屈伸膝孤立动作', 'knee-extension': '蹬伸膝动作', bridge: '臀桥', plank: '平板支撑', crunch: '卷腹', calf: '提踵', dip: '双杠臂屈伸', 'side-bend': '体侧屈',
});
const teachingEntries = [
  ['squat', '徒手深蹲', 'squat'], ['pushup', '俯卧撑', 'pushup'],
  ['curl', '哑铃弯举', 'elbow-isolation'], ['bench', '哑铃卧推', 'horizontal-press'],
  ['incline-bench', '上斜哑铃卧推', 'horizontal-press'], ['chest-press', '器械推胸', 'horizontal-press'],
  ['lat-pulldown', '高位下拉', 'vertical-pull'], ['row', '坐姿绳索划船', 'row'],
  ['dumbbell-row', '单臂哑铃划船', 'row'], ['pullup', '辅助引体向上', 'vertical-pull'],
  ['shoulder-press', '哑铃推举', 'overhead-press'], ['lateral-raise', '哑铃侧平举', 'lateral-raise'],
  ['reverse-fly', '哑铃俯身飞鸟', 'reverse-fly'], ['triceps', '绳索下压', 'elbow-isolation'],
  ['overhead-triceps', '哑铃颈后臂屈伸', 'overhead-extension'], ['hammer-curl', '哑铃锤式弯举', 'elbow-isolation'],
  ['goblet-squat', '高脚杯深蹲', 'squat'], ['rdl', '哑铃罗马尼亚硬拉', 'hinge'],
  ['lunge', '反向箭步蹲', 'lunge'], ['leg-curl', '器械腿弯举', 'knee-isolation'],
  ['leg-extension', '器械腿屈伸', 'knee-isolation'], ['glute-bridge', '臀桥', 'bridge'],
  ['plank', '平板支撑', 'plank'], ['crunch', '卷腹', 'crunch'], ['calf-raise', '站姿提踵', 'calf'],
];
const additionalEntries = [
  ['barbell-deadlift', '杠铃硬拉', 'hinge'], ['bodyweight-pullup', '引体向上', 'vertical-pull'],
  ['barbell-bench', '杠铃卧推', 'horizontal-press'], ['incline-barbell-bench', '上斜杠铃卧推', 'horizontal-press'],
  ['smith-bench', '史密斯卧推', 'horizontal-press'], ['incline-smith-bench', '上斜史密斯卧推', 'horizontal-press'],
  ['barbell-row', '杠铃俯身划船', 'row'], ['machine-row', '器械划船', 'row'], ['chest-supported-row', '胸托划船', 'row'],
  ['bilateral-dumbbell-row', '双臂俯身哑铃划船', 'row'], ['alternating-dumbbell-curl', '交替哑铃弯举', 'elbow-isolation'],
  ['dumbbell-side-bend', '站姿哑铃侧屈', 'side-bend'], ['barbell-curl', '杠铃弯举', 'elbow-isolation'],
  ['barbell-squat', '杠铃背蹲', 'squat'], ['front-squat', '杠铃前蹲', 'squat'], ['smith-squat', '史密斯深蹲', 'squat'],
  ['barbell-romanian-deadlift', '杠铃罗马尼亚硬拉', 'hinge'], ['barbell-shoulder-press', '站姿杠铃推举', 'overhead-press'],
  ['standing-dumbbell-press', '站姿哑铃推举', 'overhead-press'], ['barbell-lunge', '杠铃箭步蹲', 'lunge'],
  ['dumbbell-lunge', '哑铃箭步蹲', 'lunge'], ['walking-lunge', '哑铃行走箭步蹲', 'lunge'],
  ['lying-leg-curl', '俯卧腿弯举', 'knee-isolation'], ['seated-leg-curl', '坐姿腿弯举', 'knee-isolation'], ['leg-press', '器械腿举', 'knee-extension'],
  ['dumbbell-kickback', '俯身哑铃臂屈伸', 'elbow-isolation'], ['dumbbell-skullcrusher', '仰卧哑铃臂屈伸', 'elbow-isolation'],
  ['dip', '双杠臂屈伸', 'dip'], ['barbell-hip-thrust', '杠铃臀推', 'bridge'], ['face-pull', '绳索面拉', 'row'],
  ['hanging-knee-raise', '悬垂举膝', 'crunch'], ['hanging-leg-raise', '悬垂直腿举腿', 'crunch'], ['seated-calf-raise', '坐姿提踵', 'calf'],
];
const teachingIds = new Set(teachingEntries.map(([id]) => id));
export const motionExercises = Object.freeze([...teachingEntries, ...additionalEntries].map(([id, name, family]) => Object.freeze({id, name, family, hasTeaching: teachingIds.has(id)})));
export const getMotionExercise = id => motionExercises.find(exercise => exercise.id === id) || null;
export const getMotionFamily = family => motionExercises.filter(exercise => exercise.family === family);
