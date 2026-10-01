import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingMealSuggestions,foodCategory,mealWeekContext,adjustMealNutrient,mealTypeAt,nutritionBalance,parseNutritionAdvice,mealAdviceTiming} from '../public/meal-contract.js';
import {sumFoods} from '../public/domain.js';

test('remaining menus never backfill breakfast after a recorded lunch, including cached advice',()=>{
 const meals=[{name:'早餐',status:'planned'},{name:'午餐',status:'recorded'},{name:'晚餐',status:'planned'}];
 assert.deepEqual(remainingMealSuggestions(meals,{}).map(meal=>meal.name),['晚餐']);
 meals[2].status='recorded';assert.deepEqual(remainingMealSuggestions(meals,{}),[]);
 const pending=meals.map(meal=>({...meal,status:'planned'}));
 assert.deepEqual(remainingMealSuggestions(pending,{earliestMealIndex:1}).map(meal=>meal.name),['午餐','晚餐']);
 assert.deepEqual(remainingMealSuggestions(pending,{scenario:'review'}),[]);
});

test('food categories count one main meal per record and leave snacks outside the three meals',()=>{
 const date='2026-10-01',now=new Date(2026,9,1,2);
 const main={items:[{name:'米饭',category:'正餐'},{name:'鸡肉',category:'正餐'}]};
 const snack={items:[{name:'牛奶',category:'加餐'},{name:'饼干',category:'零食'}]};
 const timing=mealAdviceTiming(date,[main,snack],now);
 assert.equal(timing.mainMealCount,1);assert.equal(timing.remainingMainMeals,2);
 assert.equal(timing.scenario,'meal');
 assert.equal(foodCategory({name:'饼干',category:'正餐'}),'正餐');
 assert.equal(foodCategory({name:'苹果'}),'加餐');
 assert.equal(mealAdviceTiming(date,[main,main,main,main],now).remainingMainMeals,0);
});

test('habit context includes exactly seven selected-date days and excludes drafts and future records',()=>{
 const record=date=>({date,confirmed:true,items:[{name:'米饭（熟）',grams:100,category:'正餐'}]});
 const history=mealWeekContext([record('2026-09-24'),record('2026-09-25'),record('2026-10-01'),record('2026-10-02'),{...record('2026-09-30'),confirmed:false}],'2026-10-01');
 assert.equal(history.from,'2026-09-25');assert.equal(history.recordedDays,2);
 assert.equal(history.meals.length,2);assert.deepEqual(history.frequentFoods,[{name:'米饭',count:2,averageGrams:100}]);
});

test('daily advice validates all three cards and the completed meal count',()=>{
 const result={version:3,brief:{summary:'已记录一次正餐',habitBasis:'近期记录较少',tip:'少油烹调',meals:['早餐','午餐','晚餐'].map((name,i)=>({name,status:i?'planned':'recorded',summary:'按当天记录安排',foods:[]}))},detailed:{overview:'当前饮食',findings:[{title:'搭配',evidence:'有主食',interpretation:'结合余量安排',action:'补充蔬菜'}],nextStep:'分配剩余营养',uncertainty:'记录时间不是进食时间'}};
 assert.equal(parseNutritionAdvice(JSON.stringify(result),{mainMealCount:1}).brief.meals.length,3);
 assert.throws(()=>parseNutritionAdvice(JSON.stringify(result),{mainMealCount:2}));
 result.brief.meals.pop();assert.throws(()=>parseNutritionAdvice(JSON.stringify(result)));
});

test('advice normalizes version notation and misplaced analysis without inventing missing fields',()=>{
 const advice={version:3,brief:{summary:'按余量搭配',foods:[],habitBasis:'参考已记录食物',tip:'少油烹调',meals:['早餐','午餐','晚餐'].map((name,index)=>({name,status:index?'planned':'recorded',summary:'按记录安排',foods:[]}))},detailed:{overview:'当前饮食结构',findings:[{title:'主食',evidence:'记录了米饭',interpretation:'已有碳水来源',action:'搭配蔬菜'}],nextStep:'合理安排下一餐',uncertainty:'份量为估计'}};
 for(const version of ['3',undefined,null]) {
   assert.deepEqual(parseNutritionAdvice(JSON.stringify({...advice,version}),{mainMealCount:1}),advice);
 }
 assert.deepEqual(parseNutritionAdvice(JSON.stringify({version:'3',brief:{...advice.brief,detailed:advice.detailed}}),{mainMealCount:1}),advice);
 const invalid=structuredClone(advice);delete invalid.detailed.nextStep;
 assert.throws(()=>parseNutritionAdvice(JSON.stringify(invalid)),/内容不完整/);
 assert.throws(()=>parseNutritionAdvice(JSON.stringify(advice).slice(0,-1)),/格式无法解析/);
 assert.throws(()=>parseNutritionAdvice(JSON.stringify({...advice,version:4})),/未完整生成/);
});

test('inline meal totals update constituent foods and calories without losing portions',()=>{
 const items=[{name:'A',grams:100,protein:10,carbs:0,fat:2,kcal:58},{name:'B',grams:200,protein:5,carbs:0,fat:1,kcal:29}];
 const changed=adjustMealNutrient(items,'protein',30);
 assert.equal(sumFoods(changed).protein,30);
 assert.equal(sumFoods(changed).kcal,156);
 assert.deepEqual(changed.map(item=>item.grams),[100,200]);
 assert.equal(items[0].protein,10);
 assert.equal(sumFoods(adjustMealNutrient(items,'carbs',9)).carbs,9);
 assert.equal(sumFoods(adjustMealNutrient(items,'kcal',200)).kcal,200);
 assert.throws(()=>adjustMealNutrient(items,'fat',-1));
 assert.throws(()=>adjustMealNutrient(items,'protein',10000));
});

test('meal classification follows local creation time at every boundary',()=>{
 for(const [hour,type] of [[0,'加餐'],[4,'加餐'],[5,'早餐'],[10,'早餐'],[11,'午餐'],[14,'午餐'],[15,'加餐'],[16,'加餐'],[17,'晚餐'],[20,'晚餐'],[21,'加餐'],[23,'加餐']]) {
   assert.equal(mealTypeAt(new Date(2026,8,30,hour,0)),type);
 }
 assert.throws(()=>mealTypeAt('invalid'));
});
test('advice balance distinguishes remaining intake from excess',()=>{
 const balance=nutritionBalance({kcal:2000,protein:100,carbs:250,fat:60},{kcal:2200,protein:70,carbs:280,fat:60});
 assert.deepEqual(balance.kcal,{target:2000,consumed:2200,remaining:0,excess:200});
 assert.deepEqual(balance.protein,{target:100,consumed:70,remaining:30,excess:0});
 assert.equal(balance.fat.remaining,0);
});
test('both advice versions must be present; malformed responses remain retryable',()=>{
 assert.deepEqual(parseNutritionAdvice('```json\n{"detailed":" 蛋白质还差30g ","brief":"两个鸡蛋配豆腐"}\n```'),{detailed:'蛋白质还差30g',brief:'两个鸡蛋配豆腐'});
 for(const content of ['', 'not json','{"brief":"鸡蛋"}','{"brief":" ","detailed":"30g"}'])assert.throws(()=>parseNutritionAdvice(content));
});

test('structured advice separates the menu from evidence and reasoning',()=>{
 const advice={version:2,brief:{summary:'下一餐搭配主食和蔬菜',foods:[{name:'米饭',portion:'1碗，约200g熟重'}],tip:'烹调用油按实际份量记录'},detailed:{overview:'现有记录只有一餐，暂不能判断全天餐次分布',findings:[{title:'餐次信息不完整',evidence:'当天仅记录午餐',interpretation:'不能将未记录等同于未摄入',action:'补充其他餐次后再判断是否需要加餐'}],nextStep:'先核对当天剩余餐次',uncertainty:'外卖用油量不明确'}};
 assert.deepEqual(parseNutritionAdvice(JSON.stringify(advice)),advice);
 const invalid=structuredClone(advice);delete invalid.detailed.findings[0].evidence;
 assert.throws(()=>parseNutritionAdvice(JSON.stringify(invalid)));
 assert.throws(()=>parseNutritionAdvice(JSON.stringify({...advice,detailed:{...advice.detailed,findings:[]}})));
});

test('advice uses timestamps without assigning meal categories',()=>{
 const date='2026-09-30',at=hour=>new Date(2026,8,30,hour,0);
 const meals=[{createdAt:at(8).toISOString(),type:'legacy'}];
 const result=mealAdviceTiming(date,meals,at(20));
 assert.equal(result.scenario,'meal');
 assert.equal(result.nextMeal,null);
 assert.equal(result.recordCount,1);
 assert.deepEqual(result.recordedTimes,[meals[0].createdAt]);
 assert.equal(result.recordedTypes,undefined);
 assert.equal(mealAdviceTiming(date,meals,at(23)).scenario,'meal');
 assert.equal(mealAdviceTiming('2026-09-29',[],at(8)).maxFoods,0);
 assert.equal(mealAdviceTiming('2026-10-01',[],at(8)).scenario,'plan');
});

test('a past-day review cannot contain food to eat now',()=>{
 const advice={version:2,brief:{summary:'当天复盘',foods:[{name:'米饭',portion:'1碗'}],tip:'核对漏记餐次'},detailed:{overview:'当天记录',findings:[{title:'记录',evidence:'只有午餐',interpretation:'无法判断全天',action:'补齐记录'}],nextStep:'改进记录',uncertainty:'份量待核对'}};
 assert.throws(()=>parseNutritionAdvice(JSON.stringify(advice),{maxFoods:0}));
 advice.brief.foods=[];assert.equal(parseNutritionAdvice(JSON.stringify(advice),{maxFoods:0}).brief.foods.length,0);
});
