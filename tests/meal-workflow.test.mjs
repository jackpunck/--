import test from 'node:test';
import assert from 'node:assert/strict';
import {mealTypeAt,nutritionBalance,parseNutritionAdvice,mealAdviceTiming} from '../public/meal-contract.js';

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

test('advice chooses meals from local time and completed meal types',()=>{
 const date='2026-09-30',at=hour=>new Date(2026,8,30,hour,0),meals=(...types)=>types.map(type=>({type}));
 assert.equal(mealAdviceTiming(date,[],at(8)).nextMeal,'早餐');
 assert.equal(mealAdviceTiming(date,meals('早餐'),at(9)).nextMeal,'午餐');
 assert.equal(mealAdviceTiming(date,meals('早餐','午餐'),at(14)).nextMeal,'晚餐');
 assert.equal(mealAdviceTiming(date,[],at(18)).nextMeal,'晚餐');
 for(const completed of [meals('晚餐'),meals('早餐','午餐','晚餐'),meals('早餐','午餐','晚餐','加餐')]){
   const result=mealAdviceTiming(date,completed,at(20));
   assert.equal(result.scenario,'optional_snack');assert.equal(result.nextMeal,null);assert.equal(result.maxFoods,2);
 }
 assert.equal(mealAdviceTiming(date,meals('早餐'),at(23)).scenario,'optional_snack');
 assert.equal(mealAdviceTiming(date,[],at(2)).scenario,'optional_snack');
 assert.equal(mealAdviceTiming('2026-09-29',[],at(8)).maxFoods,0);
 assert.equal(mealAdviceTiming('2026-10-01',[],at(8)).scenario,'plan');
});

test('a past-day review cannot contain food to eat now',()=>{
 const advice={version:2,brief:{summary:'当天复盘',foods:[{name:'米饭',portion:'1碗'}],tip:'核对漏记餐次'},detailed:{overview:'当天记录',findings:[{title:'记录',evidence:'只有午餐',interpretation:'无法判断全天',action:'补齐记录'}],nextStep:'改进记录',uncertainty:'份量待核对'}};
 assert.throws(()=>parseNutritionAdvice(JSON.stringify(advice),{maxFoods:0}));
 advice.brief.foods=[];assert.equal(parseNutritionAdvice(JSON.stringify(advice),{maxFoods:0}).brief.foods.length,0);
});
