import { sumFoods } from './domain.js?v=9';

export function formatMealNotes(value) {
  return String(value || '').replace(/\r\n?/g, '\n')
    .replace(/(^|[\s：:。；;])((?:\d{1,2}[)）]|[一二三四五六七八九十]+、))\s*/g, '$1\n\n$2 ')
    .replace(/(假设与依据|估算依据|注意事项|温馨提示)[：:]\s*/g, '\n\n$1：\n\n')
    .replace(/([。；;])\s*(综上|总体而言|总的来说)/g, '$1\n\n$2')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function mealTypeAt(value = new Date()) {
  const date = new Date(value), hour = date.getHours();
  if (!Number.isFinite(hour)) throw new Error('餐食创建时间无效。');
  if (hour >= 5 && hour < 11) return '早餐';
  if (hour >= 11 && hour < 15) return '午餐';
  if (hour >= 17 && hour < 21) return '晚餐';
  return '加餐';
}

export function nutritionBalance(target, consumed) {
  return Object.fromEntries(['kcal','protein','carbs','fat'].map(key => [key, {
    target: Math.round(target[key] || 0), consumed: Math.round(consumed[key] || 0),
    remaining: Math.round(Math.max(0, (target[key] || 0) - (consumed[key] || 0))),
    excess: Math.round(Math.max(0, (consumed[key] || 0) - (target[key] || 0)))
  }]));
}

export function mealAdviceTiming(date, meals, value = new Date()) {
  const now = new Date(value);
  if(!Number.isFinite(now.getTime()))throw new Error('建议生成时间无效。');
  const localDate=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const hour=now.getHours(),recordedTypes=['早餐','午餐','晚餐','加餐'].filter(type=>meals.some(meal=>meal.type===type));
  const missingMainMeals=['早餐','午餐','晚餐'].filter(type=>!recordedTypes.includes(type));
  const timing={localDate,localTime:`${String(hour).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,timezoneOffset:now.getTimezoneOffset(),recordedTypes,missingMainMeals,allMainMealsRecorded:missingMainMeals.length===0};
  if(date<localDate)return {...timing,scenario:'review',title:'这一天的饮食复盘',nextMeal:null,maxFoods:0,reason:'查看历史日期，只复盘当日搭配，不建议现在补吃历史差额。'};
  if(date>localDate)return {...timing,scenario:'plan',title:'这一天的饮食安排',nextMeal:null,maxFoods:5,reason:'查看未来日期，结合已有记录规划，不把未来记录当作今天已吃。'};
  if(recordedTypes.includes('晚餐')||timing.allMainMealsRecorded||hour>=21||hour<5){
    return {...timing,scenario:'optional_snack',title:'餐后饮食建议',nextMeal:null,maxFoods:2,reason:recordedTypes.includes('晚餐')?'已有晚餐记录，仍需提供可选小加餐或次日调整建议，不默认安排另一顿正餐。':'当前是夜间，仍需提供具体的餐后建议，不因营养差额自动追加完整正餐。'};
  }
  const nextMeal=hour<11&&!recordedTypes.includes('早餐')?'早餐':hour<15&&!recordedTypes.includes('午餐')?'午餐':'晚餐';
  return {...timing,scenario:'meal',title:`${nextMeal}怎么安排`,nextMeal,maxFoods:5,reason:`按当前时段和已记录餐次，优先考虑${nextMeal}；未记录不代表没吃，应结合用户说明核实。`};
}

export function parseNutritionAdvice(content, timing) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try { result = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch {}
  if(result?.version===2){
    const text=(value,max=600)=>{
      if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('营养建议内容不完整，请重新生成。');
      return value.trim();
    };
    const list=(value,min,max)=>{
      if(!Array.isArray(value)||value.length<min||value.length>max)throw new Error('营养建议结构不完整，请重新生成。');
      return value;
    };
    const brief=result.brief,detailed=result.detailed;
    if(!brief||!detailed)throw new Error('营养建议缺少一个版本，请重新生成。');
    return {version:2,brief:{
      summary:text(brief.summary,120),
      foods:list(brief.foods,0,timing?.maxFoods??5).map(food=>({name:text(food.name,80),portion:text(food.portion,120)})),
      tip:text(brief.tip,200)
    },detailed:{
      overview:text(detailed.overview,240),
      findings:list(detailed.findings,1,3).map(item=>({title:text(item.title,60),evidence:text(item.evidence,300),interpretation:text(item.interpretation,400),action:text(item.action,250)})),
      nextStep:text(detailed.nextStep,400),
      uncertainty:text(detailed.uncertainty,300)
    }};
  }
  if (!result || ['detailed','brief'].some(key => typeof result[key] !== 'string' || !result[key].trim() || result[key].length > 12000)) {
    throw new Error('营养建议未完整生成，请重试。');
  }
  return { detailed: result.detailed.trim(), brief: result.brief.trim() };
}

/** Parse the shared meal JSON contract. All four nutrient fields are per 100 g. */
export function parseMealEstimate(content) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回餐食估算，请补充说明后重试。');
  const raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('模型没有返回有效的餐食 JSON，请重试。');
  let parsed;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); }
  catch { throw new Error('模型返回的餐食 JSON 无法解析，请重试或手动填写。'); }
  if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length || parsed.items.length > 50) throw new Error('模型须返回1–50项食物，且使用 items 列表与每100克营养值。');
  const items = parsed.items.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) throw new Error('模型返回的食物缺少名称，请手动修订或重新估算。');
    const normalized = { name: item.name.trim().slice(0, 100) };
    for (const key of ['grams', 'kcal', 'protein', 'carbs', 'fat']) {
      const value = item[key];
      if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) throw new Error('模型返回的份量或每100克营养值不完整，请手动修订或重新估算。');
      normalized[key] = Number(value);
    }
    if (normalized.grams <= 0) throw new Error('实际吃掉的食物份量必须大于0克。');
    // Uses the same domain validation as manual entries and actual accounting.
    sumFoods([normalized]);
    return normalized;
  });
  return { items, note: typeof parsed.note === 'string' ? parsed.note.slice(0, 4000) : '已生成每100克营养估算，请核对食物状态和实际份量后确认。' };
}
