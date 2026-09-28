/** Browser/server shared, deterministic fitness calculations. Units: kg, cm, kcal, g. */
export const sources = Object.freeze({
  workbook: '健身Excel超级套表（B站好人松松，2026年4月）：训练表20–23、营养表19、力量表24',
  metabolism: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
  nutrition: 'https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/',
  training: 'https://acsm.org/resistance-training-guidelines-update-2026/',
  applicability: 'https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner',
  exercises: 'https://www.nasm.org/workout-exercise-guidance',
});

const round = (n, digits = 1) => Math.round((n + Number.EPSILON) * 10 ** digits) / 10 ** digits;
const nutrients = ['kcal', 'protein', 'carbs', 'fat'];
function number(value, label, min, max, integer = false) {
  if (value === '' || value === null || typeof value === 'boolean' || !['string', 'number'].includes(typeof value)) throw new Error(`${label}不能为空`);
  if (typeof value === 'string' && !value.trim()) throw new Error(`${label}不能为空`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${label}须为${min}–${max}${integer ? '之间的整数' : '之间的数字'}`);
  return n;
}
function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label}不支持：${String(value)}`);
  return value;
}
export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('请先填写个人资料');
  return {
    ...profile,
    age: number(profile.age, '年龄（此估算适用于成年人）', 18, 100, true),
    sex: oneOf(profile.sex, ['male', 'female'], '公式性别参数'),
    height: number(profile.height, '身高 cm', 130, 230),
    weight: number(profile.weight, '体重 kg', 35, 300),
    goal: oneOf(profile.goal, ['lose', 'gain', 'maintain'], '目标'),
  };
}

// These instructions are original concise coaching summaries. The demo field marks the three animated rigs; other entries have static 3D poses in the viewer.
const exerciseRows = [
  ['squat', '徒手深蹲', '股四头肌、臀大肌', '徒手', '入门', '通过髋膝屈伸训练下肢，同时保持躯干稳定。', ['双脚约肩宽，脚尖自然外展', '膝盖沿脚尖方向移动，脚掌稳定贴地', '下降到可控制且无痛的深度，起身时髋与肩同步'], 'squat'],
  ['pushup', '俯卧撑', '胸大肌、肱三头肌、三角肌前束', '徒手', '入门', '手掌支撑地面，通过推起身体训练上肢推力。', ['头、躯干和腿保持一线', '屈肘让胸部接近地面，避免塌腰', '向上推时呼气，困难时改为高位支撑'], 'pushup'],
  ['curl', '哑铃弯举', '肱二头肌、肱肌', '哑铃', '入门', '固定上臂，通过屈肘举起哑铃。', ['肩放松，上臂贴近身体', '手腕保持中立，不靠摆动起重量', '慢慢伸肘还原'], 'curl'],
  ['bench', '哑铃卧推', '胸大肌、肱三头肌、三角肌前束', '哑铃、训练凳', '基础', '仰卧在训练凳上，将哑铃从胸侧推起。', ['双脚踩稳，肩胛稳定贴凳', '前臂大致竖直，缓慢降至舒适深度', '向上推起，不用哑铃互相撞击'], null],
  ['incline-bench', '上斜哑铃卧推', '胸大肌锁骨部、三角肌前束、肱三头肌', '哑铃、可调凳', '基础', '在低角度上斜凳完成推举，改变胸部受力角度。', ['凳背约15–30度，脚掌踩稳', '手腕位于肘部上方', '动作范围以肩部无痛为准'], null],
  ['chest-press', '器械推胸', '胸大肌、肱三头肌', '固定器械', '入门', '沿器械轨迹将把手向前推。', ['调座椅使把手约在胸部高度', '背部贴垫，手腕稳定', '回程慢放，不让配重片撞击'], null],
  ['lat-pulldown', '高位下拉', '背阔肌、大圆肌、肱二头肌', '高位下拉器', '入门', '将上方拉杆拉向上胸，训练垂直拉力。', ['大腿固定，握距舒适', '肘向身体两侧下方移动', '拉向胸前，不绕到颈后，不大幅后仰'], null],
  ['row', '坐姿绳索划船', '背阔肌、菱形肌、斜方肌中束', '绳索器械', '入门', '坐姿将把手拉向腹部，训练水平拉力。', ['脊柱保持自然位置，躯干稳定', '肘向后移动，不耸肩', '回程允许肩胛自然前移，避免腰部甩动'], null],
  ['dumbbell-row', '单臂哑铃划船', '背阔肌、菱形肌、肱二头肌', '哑铃、训练凳', '基础', '单手支撑身体，将哑铃拉向髋部。', ['支撑面稳固，背部保持自然位置', '肘向髋部移动，肩不要耸起', '避免转动躯干借力，左右分别完成'], null],
  ['pullup', '辅助引体向上', '背阔肌、肱二头肌', '单杠、辅助器械', '基础', '借助辅助器械减重，完成向上拉起身体的动作。', ['先检查握杆与辅助设备稳定性', '保持躯干稳定，肘向下拉', '控制下降，不用摆腿借力'], null],
  ['shoulder-press', '哑铃推举', '三角肌前束、中束、肱三头肌', '哑铃', '基础', '将肩旁的哑铃推向头顶。', ['腹部收紧，肋骨保持稳定', '在舒适轨迹向上推，不向后折腰', '慢慢回落至肩附近，无痛范围内完成'], null],
  ['lateral-raise', '哑铃侧平举', '三角肌中束', '哑铃', '入门', '以肩关节外展将手臂抬向两侧。', ['选择轻重量，肘微屈', '手臂略在身体前方抬起', '抬至约肩高，避免耸肩和甩动'], null],
  ['reverse-fly', '哑铃俯身飞鸟', '三角肌后束、菱形肌', '哑铃', '基础', '髋部后移俯身，将手臂向两侧打开。', ['保持背部稳定，必要时胸部支撑凳面', '肘微屈，手臂向侧后方打开', '用可控轻重量，不通过甩腰完成'], null],
  ['triceps', '绳索下压', '肱三头肌', '绳索器械', '入门', '保持上臂位置，通过伸肘下压把手。', ['上臂贴近身体，肩保持放松', '只围绕肘关节伸展', '慢慢屈肘还原，不借身体下压'], null],
  ['overhead-triceps', '哑铃颈后臂屈伸', '肱三头肌', '哑铃', '基础', '双手持哑铃，通过屈伸肘关节训练三头肌。', ['先用轻重量，确认肩部可舒适举过头顶', '上臂稳定，腹部收紧', '缓慢下降，避免肘部疼痛或腰部过伸'], null],
  ['hammer-curl', '哑铃锤式弯举', '肱肌、肱桡肌、肱二头肌', '哑铃', '入门', '掌心相对完成屈肘动作。', ['手腕保持自然直线', '上臂稳定，不耸肩', '避免身体前后摆动'], null],
  ['goblet-squat', '高脚杯深蹲', '股四头肌、臀大肌', '哑铃', '基础', '在胸前抱住一只哑铃完成深蹲。', ['哑铃贴近胸前，腹部稳定', '膝盖沿脚尖方向移动', '脚掌贴地，在能控制的深度内蹲起'], null],
  ['rdl', '哑铃罗马尼亚硬拉', '腘绳肌、臀大肌', '哑铃', '基础', '通过髋部后移和伸展训练下肢后侧。', ['膝略屈，髋向后推', '哑铃贴近腿部下降，保持背部自然位置', '感觉大腿后侧拉伸即停止下降，不强求触地'], null],
  ['lunge', '反向箭步蹲', '股四头肌、臀大肌', '徒手或哑铃', '基础', '向后迈步下蹲，训练单腿稳定和下肢力量。', ['向后迈一步，保持左右适当间距', '前脚踩稳，前膝沿脚尖方向移动', '起身时前腿发力，必要时扶稳固支撑'], null],
  ['leg-curl', '器械腿弯举', '腘绳肌', '腿弯举器', '入门', '屈曲膝关节带动器械配重。', ['按器械说明调节转轴与膝关节对齐', '固定髋部，缓慢屈膝', '控制回程，避免配重反弹'], null],
  ['leg-extension', '器械腿屈伸', '股四头肌', '腿屈伸器', '入门', '坐姿伸展膝关节训练大腿前侧。', ['调整座椅，使膝与器械转轴对齐', '以无痛幅度伸膝，不猛踢', '缓慢回落，背部保持贴垫'], null],
  ['glute-bridge', '臀桥', '臀大肌、腘绳肌', '徒手', '入门', '仰卧屈膝，通过伸髋抬起骨盆。', ['双脚踩地，膝盖朝向脚尖', '腹部稳定，臀部发力抬髋', '肩髋膝大致成线即停止，不通过腰部过伸抬高'], null],
  ['plank', '平板支撑', '腹横肌、腹直肌', '徒手', '入门', '以前臂和脚尖支撑，保持躯干稳定。', ['肘部大致在肩下', '身体保持自然直线，正常呼吸', '一旦塌腰即结束此组，可改为膝支撑'], null],
  ['crunch', '卷腹', '腹直肌', '徒手', '入门', '仰卧屈膝，轻轻卷起上背部。', ['下巴保持自然距离，手不拉头', '呼气时让肋骨靠近骨盆', '缓慢回落，不追求坐起'], null],
  ['calf-raise', '站姿提踵', '腓肠肌、比目鱼肌', '徒手或哑铃', '入门', '抬起脚跟训练小腿跖屈力量。', ['扶稳固支撑保持平衡', '垂直抬起脚跟，避免脚踝外翻', '缓慢下降，不弹跳'], null],
];
export const exercises = Object.freeze(exerciseRows.map(([id, name, muscle, equipment, level, description, cues, demo]) => Object.freeze({ id, name, muscle, equipment, level, description, cues: Object.freeze(cues), demo, source: id === 'squat' ? 'https://www.acefitness.org/resources/everyone/exercise-library/135/bodyweight-squat/' : `${sources.workbook}；动作要领为应用整理，参考 ${sources.exercises}` })));

// All nutrient values are explicitly approximate seed data, not a laboratory or branded-food database.
const foodRows = [
  ['rice', '米饭', '熟重', 2.5, 30, 0.3, '主食', [], 'Excel 表19 C7:D7 碳水率；蛋白质/脂肪为近似值'],
  ['rice-raw', '大米', '生重', 7, 75, 0.7, '主食', [], 'Excel 表19 C5:D5 碳水率；蛋白质/脂肪为近似值'],
  ['oats', '燕麦片', '干重', 13, 60, 7, '主食', ['燕麦', '麸质'], 'Excel 表19 C36:D36 碳水率；其余为近似值'],
  ['bread', '全麦面包', '成品可食重', 9, 45, 4, '主食', ['小麦', '麸质'], '常见配方近似值，以包装标签为准'],
  ['potato', '土豆', '蒸煮熟重', 2, 18, 0.2, '主食', [], 'Excel 表19 C26:D26 碳水率；其余为近似值'],
  ['sweet-potato', '红薯', '蒸煮熟重', 1.5, 18, 0.2, '主食', [], 'Excel 表19 C24:D24 碳水率；其余为近似值'],
  ['corn', '甜玉米粒', '蒸煮可食重', 3.3, 20, 1.4, '主食', [], 'Excel 表19 C29:D29 碳水率；其余为近似值'],
  ['chicken', '去皮鸡胸肉', '熟重、不含烹调油', 30, 0, 4, '蛋白质', ['鸡肉', '肉类'], 'Excel 表19 C100:D100 熟肉蛋白质率，脂肪为近似值'],
  ['chicken-raw', '去皮鸡胸肉', '生重', 22, 0, 3, '蛋白质', ['鸡肉', '肉类'], '常见原料近似值，品种和修脂程度会改变结果'],
  ['beef', '瘦牛肉', '熟重、不含烹调油', 28, 0, 8, '蛋白质', ['牛肉', '肉类'], '常见原料近似值，肥瘦差异较大'],
  ['fish', '白肉鱼', '熟重、去骨不含油', 25, 0, 3, '蛋白质', ['鱼', '海鲜', '肉类'], 'Excel 表19 C99:D99 熟肉蛋白质率；脂肪为近似值'],
  ['salmon', '三文鱼', '熟重、不含烹调油', 22, 0, 12, '蛋白质', ['鱼', '海鲜', '肉类'], '常见原料近似值，养殖方式与部位影响脂肪'],
  ['egg', '鸡蛋', '煮熟去壳重', 12, 1, 10, '蛋白质', ['蛋'], 'Excel 表19 F108 每个约6g蛋白/5g脂肪，按可食重50g换算；碳水近似'],
  ['tofu', '豆腐', '沥水可食重', 7, 3, 5, '蛋白质', ['大豆', '豆制品'], 'Excel 表19 F114 三大营养素近似值'],
  ['edamame', '毛豆仁', '熟重、去荚', 13, 11, 5, '蛋白质', ['大豆', '豆制品'], 'Excel 表19 F112 三大营养素近似值'],
  ['milk', '纯牛奶', '饮用重量', 4, 4.8, 3.6, '乳品', ['奶', '乳糖'], 'Excel 表19 F109 按250ml约250g换算；以标签为准'],
  ['yogurt', '无糖原味酸奶', '成品重量', 4, 5, 3, '乳品', ['奶', '乳糖'], '常见配方近似值，不同品牌差异较大'],
  ['soy-milk', '无糖豆浆', '饮用重量', 3, 1, 2, '豆品', ['大豆', '豆制品'], 'Excel 表19 F115 三大营养素近似值'],
  ['banana', '香蕉', '去皮可食重', 1.1, 22, 0.3, '水果', [], 'Excel 表19 C66:D66 碳水率；其余为近似值'],
  ['apple', '苹果', '去核可食重', 0.3, 13, 0.2, '水果', [], 'Excel 表19 C71:D71 碳水率；其余为近似值'],
  ['broccoli', '西兰花', '熟重、不含烹调油', 3, 5, 0.4, '蔬菜', [], '常见原料近似值'],
  ['tomato', '番茄', '生鲜可食重', 0.9, 3, 0.2, '蔬菜', [], 'Excel 表19 C91:D91 碳水率；其余为近似值'],
  ['nuts', '原味混合坚果', '去壳可食重', 18, 20, 52, '油脂坚果', ['坚果', '花生'], '混合食物示例估值，实际必须核对配料与标签'],
  ['oil', '植物油', '食用重量', 0, 0, 100, '油脂坚果', [], '每克脂肪按9kcal近似换算'],
];
export const foods = Object.freeze(foodRows.map(([id, name, state, protein, carbs, fat, category, allergens, source]) => Object.freeze({ id, name, state, kcal: round(protein * 4 + carbs * 4 + fat * 9), protein, carbs, fat, category, allergens: Object.freeze(allergens), source: `${source}。每100g可食部分估值，热量按4/4/9计算，包装食品优先使用实际标签。` })));

export function calculateNutrition(input, dayType = 'training') {
  const profile = validateProfile(input);
  oneOf(dayType, ['training', 'rest'], '日类型');
  const { age, sex, height, weight, goal } = profile;
  if (profile.pregnant || profile.breastfeeding) throw new Error('孕期或哺乳期不使用此自动营养目标，请使用专业人员提供的个体方案');
  const bmi = weight / (height / 100) ** 2;
  if (goal === 'lose' && bmi < 18.5) throw new Error('当前 BMI 低于18.5，不生成减重热量目标，请选择维持并咨询专业人员');
  const activity = number(profile.activity ?? (1 / 0.7), '日常活动系数', 1.2, 2.2);
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161);
  if (bmr <= 0) throw new Error('资料组合无法得到合理代谢估算，请核对输入');
  const trainingEnergy = dayType === 'training' ? (sex === 'male' ? 150 : 100) : 0;
  const tdee = bmr * activity + trainingEnergy;
  const factor = { lose: 0.85, gain: 1.05, maintain: 1 }[goal];
  const unclamped = tdee * factor;
  const kcal = Math.round(Math.max(1200, unclamped));
  const protein = round(Math.min(weight * (goal === 'lose' ? 1.8 : 1.6), kcal * 0.3 / 4));
  const fat = round(kcal * 0.28 / 9);
  const carbs = round((kcal - protein * 4 - fat * 9) / 4);
  const explanation = `Mifflin–St Jeor 公式估算静息代谢（界面简称基础代谢）；日常消耗=静息代谢×${round(activity, 3)}，${dayType === 'training' ? `另计训练估值${trainingEnergy}kcal` : '休息日不加训练消耗'}。${goal === 'lose' ? '减脂采用15%能量缺口' : goal === 'gain' ? '增肌采用5%能量盈余' : '维持按估计消耗'}；蛋白质初值${goal === 'lose' ? '1.8' : '1.6'}g/kg，上限为能量的30%，脂肪占28%，其余为碳水。${unclamped < 1200 ? '结果已提高至应用的1200kcal保守下限，此下限不代表适合个人。' : ''}活动系数不应重复包含已单列的训练。此为健康成年人起始估算，可结合数周记录和专业意见调整。`;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, carbs, fat, bmi: round(bmi), dayType, explanation, source: `${sources.metabolism}；${sources.nutrition}；活动消耗结构参考 Excel，15%缺口和28%脂肪为应用默认值，未经临床验证。` };
}

export const planVariants = Object.freeze({ 2: ['standard'], 3: ['standard', 'home'], 4: ['standard', 'shoulders', 'arms'], 5: ['standard'] });
const compoundIds = new Set(['squat', 'pushup', 'bench', 'incline-bench', 'chest-press', 'lat-pulldown', 'row', 'dumbbell-row', 'pullup', 'shoulder-press', 'goblet-squat', 'rdl', 'lunge']);
const trainingTemplates = {
  pull: ['背、肩后束与二头', ['lat-pulldown', 'row', 'reverse-fly', 'curl']],
  push: ['胸、肩与三头', ['chest-press', 'bench', 'shoulder-press', 'lateral-raise', 'triceps']],
  legs: ['腿臀与核心', ['goblet-squat', 'rdl', 'leg-curl', 'calf-raise', 'plank']],
  back: ['背与二头', ['lat-pulldown', 'row', 'dumbbell-row', 'curl']],
  chest: ['胸与三头', ['bench', 'incline-bench', 'chest-press', 'triceps']],
  shoulders: ['肩部专练', ['shoulder-press', 'lateral-raise', 'reverse-fly']],
  arms: ['手臂与核心', ['curl', 'hammer-curl', 'triceps', 'overhead-triceps', 'plank']],
  backOnly: ['背与肩后束', ['lat-pulldown', 'row', 'dumbbell-row', 'reverse-fly']],
  chestShoulders: ['胸与肩前中束', ['bench', 'chest-press', 'shoulder-press', 'lateral-raise']],
  upperA: ['上肢 A', ['bench', 'lat-pulldown', 'row', 'lateral-raise', 'curl']],
  upperB: ['上肢 B', ['chest-press', 'dumbbell-row', 'shoulder-press', 'reverse-fly', 'triceps']],
  lowerB: ['下肢 B', ['lunge', 'glute-bridge', 'leg-extension', 'leg-curl', 'crunch']],
  fullA: ['全身 A', ['squat', 'pushup', 'row', 'rdl', 'plank']],
  fullB: ['全身 B', ['goblet-squat', 'chest-press', 'lat-pulldown', 'glute-bridge', 'curl']],
  homePull: ['居家拉：背与二头', ['dumbbell-row', 'reverse-fly', 'curl']],
  homePush: ['居家推：胸肩与三头', ['pushup', 'shoulder-press', 'lateral-raise', 'overhead-triceps']],
  homeLegs: ['居家腿臀与核心', ['goblet-squat', 'rdl', 'lunge', 'glute-bridge', 'plank']],
};

export function generatePlan({ split = 3, variant = 'standard' } = {}, input) {
  if (input) validateProfile(input);
  split = number(split, '分化数', 2, 5, true);
  if (!planVariants[split].includes(variant)) throw new Error('肩单练、手臂单练仅支持四分化；居家变式仅支持三分化');
  let schedule;
  if (variant === 'home') schedule = ['homePull', 'homePush', null, 'homeLegs', null];
  else if (variant === 'shoulders') schedule = ['back', 'chest', null, 'legs', 'shoulders', null];
  else if (variant === 'arms') schedule = ['backOnly', 'chestShoulders', null, 'legs', 'arms', null];
  else schedule = { 2: ['fullA', null, 'fullB', null], 3: ['pull', 'push', null, 'legs', null], 4: ['upperA', 'legs', null, 'upperB', 'lowerB', null], 5: ['chest', 'backOnly', null, 'legs', 'shoulders', 'arms', null] }[split];
  const names = { standard: '标准', shoulders: '肩单练', arms: '手臂单练', home: '居家' };
  const derived = split === 2 || split === 5 || (split === 4 && variant === 'standard');
  return {
    name: `${split}分化 · ${names[variant]}`, split, variant,
    days: schedule.map((key, index) => ({ id: `day-${index + 1}`, name: key ? trainingTemplates[key][0] : '休息与轻活动', rest: !key, exercises: key ? trainingTemplates[key][1].map(exerciseId => ({ exerciseId, sets: 3, reps: exerciseId === 'plank' ? '20–40秒' : compoundIds.has(exerciseId) ? '8–12' : '10–15', restSeconds: compoundIds.has(exerciseId) ? 150 : 75 })) : [] })),
    source: derived ? `应用扩展模板；动作类型参考${sources.workbook}，此分化不是原表原样计划。` : `${sources.workbook}；保留分组结构，动作和组数经应用简化。`,
    notes: ['这是循环草案，确认后再固定；分化数是训练内容分组数，不是每周必须训练次数。', '每个动作从可控重量开始，默认保留约2次余力。疼痛时停止该动作。可调整休息日以适应恢复和日程。', '已将原表较高的单次组数简化为每动作3组。新手可从1–2组开始。', ...(variant === 'home' ? ['居家方案需要哑铃及稳固支撑，使用前检查设备。'] : []), '身体各大肌群的训练频率应结合完整周历检查，模板不会自动判断恢复情况。'],
  };
}

export function estimate1RM(weight, reps) {
  weight = number(weight, '配重 kg', 0.1, 1000);
  reps = number(reps, '重复次数', 1, 15, true);
  const epley = round(reps === 1 ? weight : weight * (1 + reps / 30));
  const brzycki = round(reps === 1 ? weight : weight / (1.0278 - 0.0278 * reps));
  return { epley, brzycki, range: [Math.min(epley, brzycki), Math.max(epley, brzycki)], note: `${reps > 10 ? '超过10次时估算误差可能更大。' : ''}两公式之间的范围不是统计置信区间。只用于记录中动作标准、接近力竭组的参考，不据此直接尝试极限重量。单次输入按已完成重量显示。`, source: 'Brzycki：Excel 表24 F9；Epley：w×(1+r/30)，常用估算式。' };
}

export function sumFoods(items = []) {
  if (!Array.isArray(items)) throw new Error('食物列表格式错误');
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('食物条目格式错误');
    const grams = number(item.grams, '食物重量 g', 0, 10000);
    const food = foods.find(f => f.id === item.foodId);
    for (const key of nutrients) {
      const value = item[key] ?? food?.[key];
      total[key] += number(value, `${food?.name ?? item.name ?? '自定义食物'}每100g${key}`, 0, key === 'kcal' ? 1000 : 100) * grams / 100;
    }
  }
  return Object.fromEntries(nutrients.map(key => [key, round(total[key])]));
}

/** Match kcal/protein/carbs/fat while showing changes in every nutrient. */
export function substituteFood(foodId, grams, replacementId, basis = 'kcal') {
  oneOf(basis, nutrients, '替换基准');
  const source = foods.find(f => f.id === foodId);
  const replacement = foods.find(f => f.id === replacementId);
  if (!source || !replacement) throw new Error('找不到所选食物');
  grams = number(grams, '食物重量 g', 0.1, 10000);
  if (source[basis] <= 0 || replacement[basis] <= 0) throw new Error('所选营养素为零，无法按此基准等量替换');
  const replacementGrams = round(grams * source[basis] / replacement[basis]);
  if (replacementGrams > 10000) throw new Error('计算份量过大，请换用合适的替代食物');
  const before = sumFoods([{ foodId, grams }]);
  const after = sumFoods([{ foodId: replacementId, grams: replacementGrams }]);
  return { foodId: replacementId, grams: replacementGrams, basis, before, after, delta: Object.fromEntries(nutrients.map(key => [key, round(after[key] - before[key])])), note: '按单一营养素或热量近似等量替换，不表示营养完全相同；请使用对应生熟状态的重量。' };
}

/** For a weighed batch, cooked/raw is measured by the user; no universal yield ratio is assumed. */
export function convertFoodWeight(grams, rawBatchGrams, cookedBatchGrams, direction = 'rawToCooked') {
  grams = number(grams, '份量 g', 0, 10000);
  const raw = number(rawBatchGrams, '整批生重 g', 0.1, 100000);
  const cooked = number(cookedBatchGrams, '整批熟重 g', 0.1, 100000);
  oneOf(direction, ['rawToCooked', 'cookedToRaw'], '换算方向');
  return { grams: round(grams * (direction === 'rawToCooked' ? cooked / raw : raw / cooked)), ratio: round(cooked / raw, 3), note: '按本批实测重量比例换算，假设食物均匀。烹调加入的油、糖等另行记录。' };
}

const asText = value => Array.isArray(value) ? value.join('、') : String(value ?? '');
export function suggestRecipe({ profile, days = 1, meal = 'day', preferences = '', restrictions = '', trainingTime = '' } = {}) {
  days = number(days, '食谱天数', 1, 7, true);
  oneOf(meal, ['day', 'breakfast', 'lunch', 'dinner', 'snack'], '餐次');
  const target = calculateNutrition(profile);
  const preferenceText = asText(preferences);
  const restrictionText = asText(restrictions);
  if (/肾病|肾功能|糖尿病|进食障碍|厌食|孕|哺乳/.test(restrictionText)) throw new Error('这些饮食限制需要个体营养方案，请先由专业人员确定适用的食物与摄入目标');
  const vegetarian = /纯素|素食|不吃肉|vegan|vegetarian/i.test(`${preferenceText} ${restrictionText}`);
  const vegan = /纯素|vegan/i.test(`${preferenceText} ${restrictionText}`);
  const aliases = { 鸡肉: /鸡/, 牛肉: /牛/, 肉类: /肉类|不吃肉/, 鱼: /鱼/, 海鲜: /海鲜|鱼虾/, 蛋: /鸡蛋|蛋类|不吃蛋|蛋过敏/, 奶: /牛奶|乳制品|奶过敏|不吃奶|无乳|乳糖/, 乳糖: /乳糖/, 大豆: /大豆|黄豆|豆制品|豆腐|豆浆|豆过敏|不吃豆/, 豆制品: /豆制品/, 坚果: /坚果/, 花生: /花生/, 小麦: /小麦|面粉/, 麸质: /麸质|gluten/i, 燕麦: /燕麦/ };
  const eligible = food => {
    if (vegetarian && food.allergens.includes('肉类')) return false;
    if (vegan && food.allergens.some(a => ['蛋', '奶'].includes(a))) return false;
    if (restrictionText.includes(food.name)) return false;
    return !food.allergens.some(a => aliases[a]?.test(restrictionText));
  };
  const pick = (ids, offset) => {
    const choices = ids.map(id => foods.find(f => f.id === id)).filter(eligible);
    if (!choices.length) throw new Error('现有食物库无法满足这些限制，请调整条件或添加适合的食物');
    const preferred = choices.filter(f => preferenceText.includes(f.name) || f.allergens.some(a => preferenceText.includes(a)));
    const pool = preferred.length ? preferred : choices;
    return pool[offset % pool.length];
  };
  const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
  const fractions = { breakfast: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 };
  const timeText = asText(trainingTime);
  const clockMatch = timeText.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:$|\s)/);
  const hour = clockMatch ? Number(clockMatch[1]) : /早|上午/.test(timeText) ? 8 : /午|下午/.test(timeText) ? 13 : /晚|夜/.test(timeText) ? 18 : null;
  const nearbyMeal = hour === null ? null : hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : 'dinner';
  if (nearbyMeal) {
    // Redistribute an existing day's energy; training timing must not add another calorie allowance.
    fractions[nearbyMeal] += 0.10;
    fractions[nearbyMeal === 'lunch' ? 'dinner' : 'lunch'] -= 0.10;
  }
  const selectedMeals = meal === 'day' ? ['breakfast', 'lunch', 'dinner', 'snack'] : [meal];
  const menus = Array.from({ length: days }, (_, day) => {
    const meals = selectedMeals.map((key, index) => {
      const budget = target.kcal * fractions[key];
      const slot = day + index;
      let items;
      if (key === 'snack') {
        const fruit = pick(['apple', 'banana'], slot);
        const drink = pick(['yogurt', 'soy-milk', 'milk'], slot);
        items = [{ foodId: fruit.id, grams: round(budget * 0.45 / fruit.kcal * 100) }, { foodId: drink.id, grams: round(budget * 0.55 / drink.kcal * 100) }];
      } else {
        const starch = pick(key === 'breakfast' ? ['oats', 'bread', 'sweet-potato', 'corn'] : ['rice', 'potato', 'sweet-potato', 'corn'], slot);
        const protein = pick(key === 'breakfast' ? ['egg', 'tofu', 'edamame'] : ['chicken', 'fish', 'beef', 'tofu', 'edamame', 'salmon'], slot);
        const vegetable = pick(['broccoli', 'tomato'], slot);
        const desiredProtein = target.protein * fractions[key];
        const proteinGrams = Math.min(budget * 0.42 / protein.kcal * 100, desiredProtein / protein.protein * 100);
        const vegetableGrams = key === 'breakfast' ? 100 : 200;
        const oil = foods.find(f => f.id === 'oil');
        const oilGrams = eligible(oil) ? Math.min(12, budget * 0.10 / oil.kcal * 100) : 0;
        const starchBudget = Math.max(0, budget - protein.kcal * proteinGrams / 100 - vegetable.kcal * vegetableGrams / 100 - oil.kcal * oilGrams / 100);
        items = [{ foodId: starch.id, grams: round(starchBudget / starch.kcal * 100) }, { foodId: protein.id, grams: round(proteinGrams) }, { foodId: vegetable.id, grams: vegetableGrams }, { foodId: 'oil', grams: round(oilGrams) }];
      }
      items = items.filter(item => item.grams > 0).map(item => { const food = foods.find(f => f.id === item.foodId); return { ...item, name: food.name, state: food.state }; });
      return { key, name: mealNames[key], items, totals: sumFoods(items), energyShare: round(fractions[key], 2), timing: nearbyMeal === key ? '本餐临近训练，可按胃肠舒适度安排在训练前后。' : '', preparation: key === 'snack' ? '按可食重量准备；乳品与豆浆核对包装配料。' : '以清蒸、焯煮或少油烹调为主，所列植物油计入这餐烹调用量。' };
    });
    const totals = sumFoods(meals.flatMap(m => m.items));
    return { day: day + 1, meals, totals, difference: Object.fromEntries(nutrients.map(k => [k, round(totals[k] - target[k] * selectedMeals.reduce((s, m) => s + fractions[m], 0))])) };
  });
  return { title: `${days}日${meal === 'day' ? '食谱' : mealNames[meal]}草案`, days: menus, target, notes: ['份量与营养为估算，显示的总量以具体食物计算为准，三大营养素未必与目标完全吻合；确认实际食用后才记账。', ...(restrictionText ? [`已按可识别食物名称及常见过敏原筛选：${restrictionText}。这不是完整过敏原数据库，包装配料及交叉接触需另核对。`] : []), ...(preferenceText ? [`偏好：${preferenceText}；优先选择库中能匹配的食物。`] : []), ...(trainingTime ? [`训练时间：${timeText}。${nearbyMeal ? `已把全天10%的能量挪至就近的${mealNames[nearbyMeal]}，全天总量不变。` : '时间未能识别，保留默认餐次比例。'}按胃肠舒适度调整时间与份量。`] : []), '所有份量都附带生熟状态，烹调用油已单列。'], source: '本地规则配餐草案；食物为内置近似值，详细来源见每个食物的 source。' };
}
