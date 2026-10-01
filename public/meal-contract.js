import { sumFoods } from './domain.js?v=9';

export const mealDishInstruction = '食物条目按整道菜或独立食物划分，不按原料拆分。同一道菜中的肉、蔬菜、花生、酱汁和烹调油合并为一个 items 条目，例如宫保鸡丁只返回“宫保鸡丁（熟，含酱汁和用油）”。先合计该菜各原料的实际重量和营养总量，再用营养总量÷整道菜克数×100换算每100克营养，不能直接相加各原料的每100克数值。明确分开的米饭、菜、汤或饮品分别返回条目；例如一盘宫保鸡丁和一碗米饭返回两项。炒饭、混合面食等整体食用的菜肴默认一项；有明显分开的饭菜部分时可分开，优先遵循用户描述。无法判断是否独立时，不凭空拆出配料。修改旧记录时也应合并同一道菜的原料，避免重复计入酱汁和用油。';

export function formatMealNotes(value) {
  return String(value || '').replace(/\r\n?/g, '\n')
    .replace(/(^|[\s：:。；;])((?:\d{1,2}[)）]|[一二三四五六七八九十]+、))\s*/g, '$1\n\n$2 ')
    .replace(/(假设与依据|估算依据|注意事项|温馨提示)[：:]\s*/g, '\n\n$1：\n\n')
    .replace(/([。；;])\s*(综上|总体而言|总的来说)/g, '$1\n\n$2')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const mealCategoryInstruction = '每项食物必须返回 category，取值为正餐、加餐或零食。优先按用户明确说明和本次食用场景判断；一顿正餐里分开的米饭和菜都标为正餐。两顿正餐间补充的牛奶、水果等可标加餐，糖果、薯片等休闲食品可标零食。不要按记录时刻强行判断，用户手动设置的 category 优先保留。记录本身仍只保存时间，不分早中晚。';
export function foodCategory(item, description='') {
  if(['正餐','加餐','零食'].includes(item.category))return item.category;
  // Legacy records have no AI category; use a conservative, editable default.
  if(/零食/.test(description))return '零食';
  if(/加餐|夜宵|下午茶/.test(description))return '加餐';
  if(/正餐|早餐|午餐|晚餐|早饭|午饭|晚饭/.test(description))return '正餐';
  if(/薯片|糖果|巧克力|饼干|蛋糕|冰淇淋|雪糕|果冻|辣条|爆米花/.test(item.name))return '零食';
  if(/牛奶|酸奶|水果|香蕉|苹果|橙子|坚果/.test(item.name))return '加餐';
  return '正餐';
}
export function mealWeekContext(records,date) {
  const start=new Date(date+'T12:00:00');start.setDate(start.getDate()-6);
  const from=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
  const meals=records.filter(meal=>meal.confirmed&&meal.date>=from&&meal.date<=date).map(meal=>({date:meal.date,createdAt:meal.createdAt||null,description:meal.userPrompt??meal.notes??'',items:meal.items.map(item=>({...item,category:foodCategory(item,meal.userPrompt??meal.notes)}))}));
  const frequency=new Map();
  for(const meal of meals)for(const item of meal.items){
    const name=item.name.replace(/（[^（）]*）|\([^()]*\)/g,'').trim(),entry=frequency.get(name)||{name,count:0,totalGrams:0};
    entry.count++;entry.totalGrams+=item.grams;frequency.set(name,entry);
  }
  return {from,to:date,recordedDays:new Set(meals.map(meal=>meal.date)).size,meals,frequentFoods:[...frequency.values()].sort((a,b)=>b.count-a.count).slice(0,12).map(({name,count,totalGrams})=>({name,count,averageGrams:Math.round(totalGrams/count)}))};
}

export function mealTypeAt(value = new Date()) {
  const date = new Date(value), hour = date.getHours();
  if (!Number.isFinite(hour)) throw new Error('餐食创建时间无效。');
  if (hour >= 5 && hour < 11) return '早餐';
  if (hour >= 11 && hour < 15) return '午餐';
  if (hour >= 17 && hour < 21) return '晚餐';
  return '加餐';
}

export function adjustMealNutrient(items, key, value) {
  if (!['kcal','protein','carbs','fat'].includes(key) || !Number.isFinite(value) || value < 0) throw new Error('请填写有效的营养数值。');
  sumFoods(items);
  const grams=items.reduce((sum,item)=>sum+item.grams,0);
  if(!grams)throw new Error('餐食份量不能为空。');
  const exactTotal=items.reduce((sum,item)=>sum+item[key]*item.grams/100,0);
  const next=items.map(item=>{
    const updated={...item,[key]:exactTotal>0?item[key]*value/exactTotal:value*100/grams};
    if(key!=='kcal')updated.kcal=updated.protein*4+updated.carbs*4+updated.fat*9;
    return updated;
  });
  sumFoods(next);
  return next;
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
  const hour=now.getHours();
  const mainMealCount=meals.filter(meal=>(meal.items||[]).some(item=>foodCategory(item,meal.userPrompt??meal.notes)==='正餐')).length;
  const earliestMealIndex=date>localDate?0:date<localDate?3:hour<11?0:hour<16?1:hour<21?2:3;
  const timing={localDate,localTime:`${String(hour).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,timezoneOffset:now.getTimezoneOffset(),recordedTimes:meals.map(meal=>meal.createdAt||null),recordCount:meals.length,mainMealCount,remainingMainMeals:Math.max(0,3-mainMealCount),earliestMealIndex};
  if(date<localDate)return {...timing,scenario:'review',title:'这一天的饮食复盘',nextMeal:null,maxFoods:0,reason:'查看历史日期，只复盘当日搭配，不建议现在补吃历史差额。'};
  if(date>localDate)return {...timing,scenario:'plan',title:'这一天的饮食安排',nextMeal:null,maxFoods:5,reason:'查看未来日期，结合已有记录规划，不把未来记录当作今天已吃。'};
  return {...timing,scenario:'meal',title:'一日三餐建议',nextMeal:null,maxFoods:5,reason:'按已记录正餐调整剩余三餐，结合同日加餐、零食和近七天习惯分配营养；记录时刻不是实际进食时刻，不要求立即补吃。'};
}

export function remainingMealSuggestions(meals,timing) {
  if(timing?.scenario==='review')return [];
  const names=['早餐','午餐','晚餐'];
  const lastRecorded=Math.max(-1,...meals.filter(meal=>meal.status==='recorded').map(meal=>names.indexOf(meal.name)));
  return meals.filter(meal=>meal.status==='planned'&&names.indexOf(meal.name)>lastRecorded&&names.indexOf(meal.name)>=(timing?.earliestMealIndex??0));
}

export function parseNutritionAdvice(content, timing) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try { result = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
  catch { throw new Error('营养建议格式无法解析，请重新生成。'); }
  // Normalize representation mistakes only; missing content still fails validation.
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if (result.version === '2' || result.version === '3') result.version = Number(result.version);
    if (result.version == null && result.brief && typeof result.brief === 'object') {
      result.version = Array.isArray(result.brief.meals) ? 3 : 2;
    }
    if ([2, 3].includes(result.version) && result.detailed === undefined && result.brief?.detailed) {
      result.detailed = result.brief.detailed;
    }
  }
  if(result?.version===3){
    const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('三餐建议内容不完整，请重新生成。');return value.trim();};
    if(!Array.isArray(result.brief?.meals)||result.brief.meals.length!==3)throw new Error('请生成完整的三餐建议。');
    const meals=result.brief.meals.map((meal,index)=>{
      if(meal.name!==['早餐','午餐','晚餐'][index]||!['recorded','planned','skipped','review'].includes(meal.status)||!Array.isArray(meal.foods)||meal.foods.length>5)throw new Error('三餐建议结构不完整，请重新生成。');
      if(timing?.scenario==='review'&&meal.status!=='review')throw new Error('历史记录仅作饮食复盘。');
      if(timing?.scenario==='review'&&meal.foods.length)throw new Error('历史饮食复盘不安排补吃食物。');
      return {name:meal.name,status:meal.status,summary:text(meal.summary,250),foods:meal.foods.map(food=>({name:text(food.name,80),portion:text(food.portion,120)}))};
    });
    if(timing?.scenario!=='review'&&Number.isInteger(timing?.mainMealCount)&&meals.filter(meal=>meal.status==='recorded').length!==Math.min(3,timing.mainMealCount))throw new Error('三餐安排与已记录正餐数量不一致，请重新生成。');
    const base=parseNutritionAdvice(JSON.stringify({version:2,brief:{summary:result.brief.summary,foods:[],tip:result.brief.tip},detailed:result.detailed}));
    return {...base,version:3,brief:{...base.brief,meals,habitBasis:text(result.brief.habitBasis,300)}};
  }
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
  if (Array.isArray(parsed?.items) && !parsed.items.length) throw new Error('无法识别出食物，请换一张清晰的餐食照片，或补充文字描述。');
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length > 50) throw new Error('餐食分析结果不完整，请重试或补充食物描述。');
  const items = parsed.items.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) throw new Error('模型返回的食物缺少名称，请手动修订或重新估算。');
    const normalized = { name: item.name.trim().slice(0, 100) };
    if(item.category!==undefined){
      if(!['正餐','加餐','零食'].includes(item.category))throw new Error('食物标签须为正餐、加餐或零食。');
      normalized.category=item.category;
    }
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
  const mealType = ['早餐','午餐','晚餐','加餐'].includes(parsed.mealType) ? parsed.mealType : null;
  return { items, mealType, note: typeof parsed.note === 'string' ? parsed.note.slice(0, 4000) : '已生成每100克营养估算，请核对食物状态和实际份量后确认。' };
}
