import {foods, sumFoods, validateProfile} from './domain.js?v=9';

const metabolismSource = 'https://pubmed.ncbi.nlm.nih.gov/2305711/';
const energySource = 'https://www.fda.gov/files/food/published/Food-Labeling-Guide-(PDF).pdf';
const portionSource = 'https://fdc.nal.usda.gov/Foundation_Foods_Documentation/';
const round = n => Math.round((n + Number.EPSILON) * 10) / 10;
function finite(value, label, min, max) {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') throw new Error(`请填写${label}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}须在 ${min}–${max} 之间`);
  return n;
}

export const formulaCards = Object.freeze([
  {id:'metabolism', title:'静息代谢 · Mifflin–St Jeor', formula:'男：10 × 体重 + 6.25 × 身高 − 5 × 年龄 + 5；女：末项改为 −161', description:'体重用 kg，身高用 cm，年龄用岁；结果为 kcal/天。此方程预测静息能量消耗（REE），常用作基础代谢估算，不能代替实测。', sourceName:'Mifflin 等，1990 · 原始研究', sourceUrl:metabolismSource},
  {id:'daily-energy', title:'一天的总消耗 · TDEE 估算', formula:'每日总消耗 ≈ 静息代谢 × 活动系数', description:'活动系数是你对全天活动的假设，工具允许 1.2–2.2。这里不额外叠加训练消耗，也不生成减脂或增肌摄入目标；可结合体重与活动记录调整估算。', sourceName:'静息代谢方程来源；活动系数为工具输入假设', sourceUrl:metabolismSource},
  {id:'macro-energy', title:'三大营养素的热量换算', formula:'热量 kcal ≈ 蛋白质 g × 4 + 碳水 g × 4 + 脂肪 g × 9', description:'蛋白质、碳水每克约 4 kcal，脂肪每克约 9 kcal。反算克数时分别除以 4、4、9。食物标签还可能考虑膳食纤维、糖醇等差异，优先使用实际标签。', sourceName:'FDA · 食品标签指南', sourceUrl:energySource},
  {id:'food-portion', title:'一份食物含多少营养', formula:'本次营养 = 每 100 克的营养 × 实际可食克数 ÷ 100', description:'使用去壳、去骨等实际吃下的重量，并匹配生熟状态。“一盒”“一个”的大小不同，可在食物份量中调整每份克数。', sourceName:'USDA · 可食部分与份量换算说明', sourceUrl:portionSource},
].map(Object.freeze));

/** This calculator does not change saved profiles or nutrition targets. */
export function calculateMetabolism(input) {
  const profile = validateProfile({...input, goal:'maintain'});
  if (input.pregnant || input.breastfeeding) throw new Error('孕期或哺乳期不使用此成人估算工具');
  const activity = finite(input.activity ?? 1.375, '活动系数', 1.2, 2.2);
  const ree = 10 * profile.weight + 6.25 * profile.height - 5 * profile.age + (profile.sex === 'male' ? 5 : -161);
  return {ree:Math.round(ree), bmr:Math.round(ree), tdee:Math.round(ree * activity), activity, formula:formulaCards[0].formula, note:'成人静息代谢与全天消耗的估算；活动系数由你选择，未额外叠加训练热量。'};
}

export function calculateMacroEnergy(input) {
  const protein = finite(input?.protein, '蛋白质克数', 0, 1000);
  const carbs = finite(input?.carbs, '碳水克数', 0, 2000);
  const fat = finite(input?.fat, '脂肪克数', 0, 1000);
  const p = protein * 4, c = carbs * 4, f = fat * 9, total = p + c + f;
  return {kcal:round(total), proteinKcal:round(p), carbsKcal:round(c), fatKcal:round(f), proteinShare:total ? round(p / total * 100) : 0, carbsShare:total ? round(c / total * 100) : 0, fatShare:total ? round(f / total * 100) : 0};
}

// Portion sizes are editable examples, not standardized container sizes.
const portions = [
  ['rice-box','外卖米饭（一盒）','rice',250,'盒','仅指白米饭，暂按一盒 250 g 熟饭；配菜、酱汁与额外用油需另计。'],
  ['egg','水煮鸡蛋（一个）','egg',50,'个','暂按去壳后的可食部分 50 g；大小不同请修改克数，煎蛋用油另计。'],
  ['milk-carton','纯牛奶（一盒）','milk',250,'盒','暂按 250 mL 约等于 250 g，实际营养以品牌包装标签为准。'],
  ['banana','香蕉（一根）','banana',100,'根','暂按去皮后的可食部分 100 g。'],
  ['oats-bowl','燕麦片（一份）','oats',40,'份','按干燕麦片 40 g，不包括加入的牛奶或糖。'],
  ['chicken-serving','鸡胸肉（一份）','chicken',100,'份','按熟的去皮鸡胸肉 100 g，不包括烹调油与酱汁。'],
  ['bread-slice','全麦面包（一片）','bread',30,'片','暂按一片 30 g，不同品牌和厚度不同，请优先看标签。'],
  ['tofu-serving','豆腐（一份）','tofu',100,'份','按沥水后的可食部分 100 g；含水量和品种会影响营养。'],
  ['yogurt-cup','无糖酸奶（一杯）','yogurt',150,'杯','暂按一杯 150 g；以实际包装重量和标签为准。'],
  ['apple','苹果（一个）','apple',180,'个','暂按去核后的可食部分 180 g。'],
  ['nuts-handful','原味坚果（一小把）','nuts',20,'把','暂按去壳后的混合坚果 20 g，配比与大小会改变结果。'],
  ['oil-spoon','植物油（一份）','oil',10,'份','按实际食用油 10 g；勺子大小不一，优先称重。'],
];
export const foodPortions = Object.freeze(portions.map(([id,label,foodId,grams,unit,note]) => Object.freeze({id,label,foodId,grams,unit,note,source:foods.find(f => f.id === foodId).source})));

export function calculateFoodPortion(id, options = {}) {
  const portion = foodPortions.find(p => p.id === id);
  if (!portion) throw new Error('请选择已有食物份量');
  const count = finite(options.count ?? 1, '份数', 0.1, 100);
  const portionGrams = finite(options.grams ?? portion.grams, '每份可食重量（g）', 1, 5000);
  const grams = round(portionGrams * count);
  if (grams > 10000) throw new Error('总可食重量不能超过 10000 g');
  const result = sumFoods([{foodId:portion.foodId, grams}]);
  return {label:portion.label, count, grams, portionGrams, ...result, note:`本次按每份 ${portionGrams} g × ${count} 份计算。默认份量参考：${portion.note} 营养使用应用食物库近似值，热量按 4/4/9 换算。`, source:portion.source};
}
