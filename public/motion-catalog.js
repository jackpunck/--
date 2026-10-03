/** Versioned evaluation catalogue. Thresholds are application screening rules,
 * not clinical cut-offs. Equipment and grip cannot be inferred from 33 points. */
export const MOTION_CATALOG_VERSION = 'motion-catalog-2.2.0';
const definitions = [
  ['SQUAT_DEPTH', '下蹲幅度', false, true, 'side'],
  ['SQUAT_TORSO_LEAN', '下降与起身过程的躯干前倾', false, true, 'side'],
  ['SQUAT_HIP_SHOULDER_SYNC', '起身时肩髋同步', false, true, 'side'],
  ['SPINE_NEUTRAL', '脊柱自然位置', true, true, 'visual'],
  ['PUSHUP_DEPTH', '俯卧撑下降幅度', false, true, 'side'],
  ['BODY_ALIGNMENT', '肩髋踝连线', false, true, 'side'],
  ['ROW_ROM', '划船拉回与还原幅度', false, false, 'side'],
  ['ROW_SHRUG', '拉回时肩部向耳部抬升', false, true, 'front-or-side'],
  ['ROW_TORSO_SWING', '划船时躯干借力摆动', false, true, 'side'],
  ['HINGE_ROM', '髋铰链活动幅度', false, false, 'side'],
  ['HINGE_KNEE_CONTROL', '髋铰链中的屈膝变化', false, false, 'side'],
  ['WEIGHT_PATH', '负重与身体的相对轨迹', true, true, 'visual'],
  ['LUNGE_DEPTH', '箭步蹲屈膝幅度', false, false, 'side'],
  ['LUNGE_BALANCE', '箭步蹲躯干投影控制', false, true, 'front-or-side'],
  ['PRESS_ROM', '推举伸展与还原幅度', false, false, 'side'],
  ['PRESS_TRUNK', '躯干位置变化', false, true, 'side'],
  ['PULL_ROM', '垂直拉的屈肘幅度', false, false, 'front-or-side'],
  ['PULL_SWING', '拉动过程的躯干摆动', false, true, 'side'],
  ['ARM_ROM', '屈伸肘活动幅度', false, false, 'side'],
  ['UPPER_ARM_STABILITY', '上臂与躯干相对稳定', false, false, 'side'],
  ['RAISE_HEIGHT', '抬臂幅度与高度', false, false, 'front-or-side'],
  ['RAISE_SHRUG', '抬臂时肩部抬升', true, true, 'visual'],
  ['BRIDGE_EXTENSION', '臀桥肩髋膝连线', false, false, 'side'],
  ['CALF_ROM', '提踵脚跟升降幅度', false, false, 'side'],
  ['CALF_BALANCE', '提踵身体稳定', false, false, 'front-or-side'],
  ['PLANK_ALIGNMENT', '支撑中的身体连线', false, true, 'side'],
  ['PLANK_HOLD', '连续可观察保持时间', false, false, 'any'],
  ['CRUNCH_ROM', '卷腹躯干变化幅度', false, false, 'side'],
  ['NECK_PULLING', '颈部牵拉与手部辅助', true, true, 'visual'],
  ['LEG_ROM', '屈伸膝活动幅度', false, false, 'side'],
  ['HIP_STABILITY', '髋部横向滑动', false, false, 'side'],
  ['EQUIPMENT_SETUP', '器械、支撑面与握持设置', true, false, 'visual'],
  ['MOTION_CONTROL', '全过程轨迹控制', false, false, 'any'],
];
export const motionCheckDefinitions = Object.freeze(Object.fromEntries(definitions.map(([code, label, visual, critical, requiredView]) => [code, Object.freeze({code, label, visual, source: visual ? 'visual' : 'pose', critical, severity: critical ? 'severe' : 'warning', weight: 20, requiredView})])));
export const motionCheckCodes = Object.freeze(Object.keys(motionCheckDefinitions));

export const motionFamilies = Object.freeze({
  squat: '深蹲', pushup: '俯卧撑', 'elbow-isolation': '屈伸肘孤立动作',
  'horizontal-press': '水平推胸', 'vertical-pull': '垂直拉', row: '水平划船',
  'overhead-press': '头上推举', 'lateral-raise': '侧向抬臂', 'reverse-fly': '俯身飞鸟',
  'overhead-extension': '头上臂屈伸', hinge: '髋铰链', lunge: '箭步蹲',
  'knee-isolation': '屈伸膝孤立动作', bridge: '臀桥', plank: '平板支撑', crunch: '卷腹', calf: '提踵',
});
const recipes = {
  squat: [['SQUAT_DEPTH', 20], ['SQUAT_TORSO_LEAN', 25], ['SQUAT_HIP_SHOULDER_SYNC', 20], ['SPINE_NEUTRAL', 25], ['MOTION_CONTROL', 10]],
  pushup: [['PUSHUP_DEPTH', 30], ['BODY_ALIGNMENT', 30], ['SPINE_NEUTRAL', 25], ['MOTION_CONTROL', 15]],
  'elbow-isolation': [['ARM_ROM', 30], ['UPPER_ARM_STABILITY', 30], ['SPINE_NEUTRAL', 15], ['EQUIPMENT_SETUP', 15], ['MOTION_CONTROL', 10]],
  'horizontal-press': [['PRESS_ROM', 25], ['PRESS_TRUNK', 25], ['SPINE_NEUTRAL', 20], ['EQUIPMENT_SETUP', 20], ['MOTION_CONTROL', 10]],
  'vertical-pull': [['PULL_ROM', 25], ['PULL_SWING', 25], ['SPINE_NEUTRAL', 20], ['EQUIPMENT_SETUP', 20], ['MOTION_CONTROL', 10]],
  row: [['ROW_ROM', 20], ['ROW_SHRUG', 25], ['ROW_TORSO_SWING', 20], ['SPINE_NEUTRAL', 25], ['MOTION_CONTROL', 10]],
  'overhead-press': [['PRESS_ROM', 25], ['PRESS_TRUNK', 25], ['SPINE_NEUTRAL', 25], ['EQUIPMENT_SETUP', 15], ['MOTION_CONTROL', 10]],
  'lateral-raise': [['RAISE_HEIGHT', 30], ['RAISE_SHRUG', 25], ['PRESS_TRUNK', 15], ['EQUIPMENT_SETUP', 15], ['MOTION_CONTROL', 15]],
  'reverse-fly': [['RAISE_HEIGHT', 25], ['RAISE_SHRUG', 20], ['SPINE_NEUTRAL', 30], ['EQUIPMENT_SETUP', 15], ['MOTION_CONTROL', 10]],
  'overhead-extension': [['ARM_ROM', 25], ['UPPER_ARM_STABILITY', 25], ['SPINE_NEUTRAL', 25], ['EQUIPMENT_SETUP', 15], ['MOTION_CONTROL', 10]],
  hinge: [['HINGE_ROM', 20], ['HINGE_KNEE_CONTROL', 20], ['SPINE_NEUTRAL', 30], ['WEIGHT_PATH', 20], ['MOTION_CONTROL', 10]],
  lunge: [['LUNGE_DEPTH', 25], ['LUNGE_BALANCE', 25], ['SPINE_NEUTRAL', 25], ['EQUIPMENT_SETUP', 15], ['MOTION_CONTROL', 10]],
  'knee-isolation': [['LEG_ROM', 35], ['HIP_STABILITY', 25], ['EQUIPMENT_SETUP', 25], ['MOTION_CONTROL', 15]],
  bridge: [['BRIDGE_EXTENSION', 35], ['SPINE_NEUTRAL', 35], ['HIP_STABILITY', 15], ['MOTION_CONTROL', 15]],
  plank: [['PLANK_ALIGNMENT', 40], ['SPINE_NEUTRAL', 40], ['PLANK_HOLD', 20]],
  crunch: [['CRUNCH_ROM', 30], ['NECK_PULLING', 30], ['SPINE_NEUTRAL', 25], ['MOTION_CONTROL', 15]],
  calf: [['CALF_ROM', 35], ['CALF_BALANCE', 30], ['EQUIPMENT_SETUP', 20], ['MOTION_CONTROL', 15]],
};
const entries = [
  ['squat', '徒手深蹲', 'squat', 'family'], ['pushup', '俯卧撑', 'pushup', 'direct'],
  ['curl', '哑铃弯举', 'elbow-isolation', 'family'], ['bench', '哑铃卧推', 'horizontal-press', 'family'],
  ['incline-bench', '上斜哑铃卧推', 'horizontal-press', 'family'], ['chest-press', '器械推胸', 'horizontal-press', 'family'],
  ['lat-pulldown', '高位下拉', 'vertical-pull', 'family'], ['row', '坐姿绳索划船', 'row', 'family'],
  ['dumbbell-row', '单臂哑铃划船', 'row', 'family'], ['pullup', '辅助引体向上', 'vertical-pull', 'family'],
  ['shoulder-press', '哑铃推举', 'overhead-press', 'family'], ['lateral-raise', '哑铃侧平举', 'lateral-raise', 'family'],
  ['reverse-fly', '哑铃俯身飞鸟', 'reverse-fly', 'family'], ['triceps', '绳索下压', 'elbow-isolation', 'family'],
  ['overhead-triceps', '哑铃颈后臂屈伸', 'overhead-extension', 'family'], ['hammer-curl', '哑铃锤式弯举', 'elbow-isolation', 'family'],
  ['goblet-squat', '高脚杯深蹲', 'squat', 'family'], ['rdl', '哑铃罗马尼亚硬拉', 'hinge', 'family'],
  ['lunge', '反向箭步蹲', 'lunge', 'family'], ['leg-curl', '器械腿弯举', 'knee-isolation', 'family'],
  ['leg-extension', '器械腿屈伸', 'knee-isolation', 'family'], ['glute-bridge', '臀桥', 'bridge', 'direct'],
  ['plank', '平板支撑', 'plank', 'direct'], ['crunch', '卷腹', 'crunch', 'direct'],
  ['calf-raise', '站姿提踵', 'calf', 'direct'],
];
const recognitionEntries = [
  ['barbell-bench', '杠铃卧推', 'horizontal-press', 'family'],
  ['incline-barbell-bench', '上斜杠铃卧推', 'horizontal-press', 'family'],
  ['smith-bench', '史密斯卧推', 'horizontal-press', 'family'],
  ['incline-smith-bench', '上斜史密斯卧推', 'horizontal-press', 'family'],
  ['barbell-row', '杠铃俯身划船', 'row', 'family'],
  ['machine-row', '器械划船', 'row', 'family'],
  ['chest-supported-row', '胸托划船', 'row', 'family'],
];
const teachingIds = new Set(entries.map(([id]) => id));
// These describe required image observations, never facts inferred from poses.
const recognitionDefinitions = {
  pullup: [['pullup-bar', 'assisted-pullup-machine'], ['hanging'], ['bilateral'], ['machine', 'band', 'partner']],
  bench: [['dumbbell'], ['flat-bench'], ['bilateral']],
  'incline-bench': [['dumbbell'], ['incline-bench'], ['bilateral']],
  'chest-press': [['machine'], ['seated'], ['bilateral']],
  row: [['cable'], ['seated'], ['bilateral']],
  'dumbbell-row': [['dumbbell'], ['single-arm-supported'], ['unilateral']],
  'barbell-bench': [['barbell'], ['flat-bench'], ['bilateral']],
  'incline-barbell-bench': [['barbell'], ['incline-bench'], ['bilateral']],
  'smith-bench': [['smith-machine'], ['flat-bench'], ['bilateral']],
  'incline-smith-bench': [['smith-machine'], ['incline-bench'], ['bilateral']],
  'barbell-row': [['barbell'], ['bent-over'], ['bilateral']],
  'machine-row': [['machine'], ['seated', 'chest-supported'], ['unilateral', 'bilateral']],
  'chest-supported-row': [['dumbbell', 'barbell'], ['chest-supported'], ['unilateral', 'bilateral']],
};
export const motionExercises = Object.freeze([...entries, ...recognitionEntries].map(([id, name, family, localRecognition]) => {
  const checks = Object.freeze(recipes[family].map(([code, weight]) => Object.freeze({...motionCheckDefinitions[code], weight})));
  const description = recognitionDefinitions[id];
  const recognitionRules = description ? Object.freeze({equipment: Object.freeze(description[0]), support: Object.freeze(description[1]), movement: family, laterality: Object.freeze(description[2]), ...(description[3] ? {assistance: Object.freeze(description[3])} : {})}) : undefined;
  return Object.freeze({id, name, family, familyName: motionFamilies[family], localRecognition, hasTeaching: teachingIds.has(id), ...(recognitionRules ? {recognitionRules} : {}), requiredView: 'per-check', checks, requiredChecks: Object.freeze(checks.map(check => check.code))});
}));
export const getMotionExercise = id => motionExercises.find(exercise => exercise.id === id) || null;
export const getMotionFamily = family => motionExercises.filter(exercise => exercise.family === family);
