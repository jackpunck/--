import * as domain from '../public/domain.js';
import * as knowledge from '../public/knowledge-tools.js';
import * as meals from '../public/meal-contract.js';
import * as schedule from '../public/schedule.js';
import * as busy from '../public/busy-rules.js';
import * as library from '../public/plan-library.js';
import {achievementWall, validTrainingCompletion, beijingDate} from '../public/achievements.js';
import {renderAchievementWall, renderAchievementDetails} from '../public/achievement-view.js';
import {HttpError} from './providers.mjs';

const zero = () => ({kcal:0,protein:0,carbs:0,fat:0});
const operations = Object.create(null);
for (const [module, names] of [
  [domain, ['validateProfile','calculateNutrition','generateGroupedPlan','estimate1RM','sumFoods','suggestRecipe','substituteFood','convertFoodWeight']],
  [knowledge, ['calculateRMConversion','calculateMetabolism','calculateMacroEnergy','calculateFoodPortion']],
  [meals, ['adjustMealNutrient','parseMealEstimate','parseNutritionAdvice','remainingMealSuggestions']],
  [schedule, ['validateCalendarTask','planCalendarTasks','recurringCalendarTasks','calendarResetChanges','rescheduleBusyTasks']],
  [busy, ['normalizeBusySettings','defaultWeekdays','setDefaultWeekdays','isBusyDate','busyDatesInRange']],
  [library, ['createLibraryTemplate','libraryMigration','libraryPlan']],
]) for (const name of names) operations[name] = module[name];
Object.assign(operations, {renderAchievementWall, renderAchievementDetails});
function adviceDisplay(data,timing) {
  if(!Array.isArray(data?.brief?.meals))return data;
  return {...data,brief:{...data.brief,displayMeals:meals.remainingMealSuggestions(data.brief.meals,timing)}};
}
operations.parseNutritionAdvice=(content,timing)=>adviceDisplay(meals.parseNutritionAdvice(content,timing),timing);
operations.trainingProgress=(updated,all)=>{
  const {data}=updated,valid=validTrainingCompletion(updated),days=schedule.weekDates(beijingDate());
  if(data.date>beijingDate()&&valid)throw new Error('未来日期的训练不能提前记录完成。');
  if((data.completed||data.daySnapshot?.exercises?.length&&data.daySnapshot.exercises.every(e=>e.completed))&&!valid)throw new Error('请为每个动作填写有效的完成组数和次数。');
  const tasks=all.filter(task=>days.includes(task.data.date));
  return {days,finished:!!(valid&&tasks.length&&tasks.every(task=>task.id===updated.id||validTrainingCompletion(task)))};
};
operations.mealPortions=(items,description='')=>items.map(item=>{
  const portion={...item,category:meals.foodCategory(item,description)};
  for(const key of ['protein','carbs','fat','kcal'])portion[key]=Number((item[key]*item.grams/100).toFixed(2));
  return portion;
});
operations.mealItems=portions=>meals.parseMealEstimate(JSON.stringify({items:portions.map(item=>{
  const value={...item};for(const key of ['protein','carbs','fat','kcal'])if(value[key]!==null&&value.grams>0)value[key]=value[key]*100/value.grams;return value;
})})).items;
operations.updateMealPortion=(item,field,previous)=>{
  const value={...item};
  if(field==='grams'){
    if(!Number.isFinite(previous)||previous<=0||!Number.isFinite(value.grams)||value.grams<=0)throw new Error('请输入有效份量。');
    for(const key of ['protein','carbs','fat','kcal'])if(value[key]!==null&&Number.isFinite(value[key]))value[key]=Number((value[key]*value.grams/previous).toFixed(2));
  }
  if(['protein','carbs','fat'].includes(field)&&['protein','carbs','fat'].every(key=>value[key]!==null&&Number.isFinite(value[key])))value.kcal=Number((value.protein*4+value.carbs*4+value.fat*9).toFixed(2));
  return value;
};

function snapshot({records, dates = [], today, now, timezoneOffset} = {}) {
  if (!Array.isArray(records) || records.length > 20000 || !Array.isArray(dates) || dates.length > 400) throw new Error('计算数据过多或格式无效。');
  schedule.validateDate(today);
  const active=records.filter(r=>r && !r.deleted), list=kind=>active.filter(r=>r.kind===kind);
  const get=id=>active.find(r=>r.id===id)?.data;
  const profile=get('profile'), tasks=schedule.calendarTasks(list('calendar-task'),list('schedule'),get('active-plan'));
  const nutrition={};
  for (const type of ['training','rest']) {
    try { nutrition[type]=domain.calculateNutrition(profile,type); }
    catch(error) { nutrition[type]={...zero(),bmr:0,tdee:0,error:error.message}; }
  }
  const totals={}, mealTotals={},mealCategories={};
  for (const record of list('meal')) {
    const meal=record.data, value=domain.sumFoods(meal.items||[]);
    mealTotals[JSON.stringify(meal.items||[])]=value;
    for(const item of meal.items||[])mealCategories[JSON.stringify([item,meal.userPrompt??meal.notes??''])]=meals.foodCategory(item,meal.userPrompt??meal.notes);
    if(meal.confirmed) { const total=totals[meal.date]??=zero();for(const k of Object.keys(total))total[k]+=value[k]||0; }
  }
  const requested=[...new Set([today,...dates])];requested.forEach(schedule.validateDate);
  const dayTypes={}, advice={};
  for(const date of requested) {
    const type=dayTypes[date]=schedule.trainingDayType(date,tasks);
    const dayMeals=list('meal').filter(r=>r.data.date===date&&r.data.confirmed).map(r=>({id:r.id,items:r.data.items.map(item=>({...item,category:meals.foodCategory(item,r.data.userPrompt??r.data.notes)})),notes:r.data.userPrompt??r.data.notes,createdAt:r.data.createdAt||null}));
    const week=meals.mealWeekContext(list('meal').map(r=>r.data),date);
    advice[date]={purpose:'nutrition-advice',date,dayType:type,profile,preferences:get('preferences')||{},meals:dayMeals,
      recentWeek:{...week,meals:week.meals.map(meal=>({date:meal.date,description:meal.description.slice(0,300),items:meal.items.map(({name,grams,category})=>({name,grams,category}))}))},
      balance:meals.nutritionBalance(nutrition[type],totals[date]||zero()),mealTiming:meals.mealAdviceTiming(date,dayMeals,new Date(now||Date.now()),timezoneOffset)};
  }
  const busyDates=[...new Set(requested.flatMap(date=>busy.busyDatesInRange(get('calendar-busy-days')||{},schedule.weekDates(date)[0],schedule.addDays(date,28))))];
  const completed=tasks.filter(record=>record.data.date<=beijingDate()&&validTrainingCompletion({...record,data:{...record.data,daySnapshot:record.data.daySnapshot||get('active-plan')?.days.find(day=>day.id===record.data.dayId)}})).map(r=>r.id);
  const mealDates=Object.keys(totals), mean=mealDates.length?mealDates.reduce((sum,date)=>sum+totals[date].kcal,0)/mealDates.length:0;
  const phases=list('phase').sort((a,b)=>a.data.date.localeCompare(b.data.date));
  const savedAdvice=Object.fromEntries(list('nutrition-advice').map(record=>[record.id,{...record.data,data:adviceDisplay(record.data.data,record.data.timing)}]));
  return {beijingDate:beijingDate(),tasks,nutrition,totals,mealTotals,mealCategories,dayTypes,advice,savedAdvice,busyDates,completed,meanKcal:mean,phaseWeightChange:phases.length>1?Number(phases.at(-1).data.weight)-Number(phases[0].data.weight):0,
    achievements:Object.fromEntries(['all','weekly','milestone'].map(category=>[category,achievementWall(records,category)]))};
}
operations.snapshot=snapshot;

export function compute({operation,args}={}) {
  if(typeof operation!=='string'||!Object.hasOwn(operations,operation))throw new HttpError(400,'未知的业务计算。');
  if(!Array.isArray(args)||args.length>8)throw new HttpError(400,'计算参数无效。');
  try {return operations[operation](...args);}
  catch(error){if(error.status)throw error;throw new HttpError(400,error.message||'计算参数无效。');}
}
