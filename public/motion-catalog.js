/** Names and optional teaching links. Motion quality is evaluated by the AI;
 * this catalogue contains no posture thresholds, scoring or exercise rules. */
export const MOTION_CATALOG_VERSION = 'motion-catalog-3.1.0';
export const motionFamilies = Object.freeze({
  squat: '深蹲', pushup: '俯卧撑', 'elbow-isolation': '屈伸肘孤立动作',
  'horizontal-press': '水平推胸', 'vertical-pull': '垂直拉', row: '水平划船',
  'overhead-press': '头上推举', 'lateral-raise': '侧向抬臂', 'reverse-fly': '俯身飞鸟',
  'overhead-extension': '头上臂屈伸', hinge: '髋铰链', lunge: '箭步蹲',
  'knee-isolation': '屈伸膝孤立动作', bridge: '臀桥', plank: '平板支撑', crunch: '卷腹', calf: '提踵',
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
];
const teachingIds = new Set(teachingEntries.map(([id]) => id));
export const motionExercises = Object.freeze([...teachingEntries, ...additionalEntries].map(([id, name, family]) => Object.freeze({id, name, family, hasTeaching: teachingIds.has(id)})));
export const getMotionExercise = id => motionExercises.find(exercise => exercise.id === id) || null;
export const getMotionFamily = family => motionExercises.filter(exercise => exercise.family === family);
