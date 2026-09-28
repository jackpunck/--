import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMetabolism, calculateMacroEnergy, calculateFoodPortion, foodPortions} from '../public/knowledge-tools.js';

test('REE formula uses kg/cm and both sex constants, with activity applied once', () => {
  const profile = {sex:'male',age:30,height:180,weight:80,activity:1.5};
  const male = calculateMetabolism(profile), female = calculateMetabolism({...profile,sex:'female'});
  assert.equal(male.ree,1780);assert.equal(male.tdee,2670);
  assert.equal(female.ree,1614);assert.equal(female.tdee,2421);
  assert.deepEqual(profile,{sex:'male',age:30,height:180,weight:80,activity:1.5});
  for (const override of [{sex:'unknown'},{age:15},{weight:''},{activity:Infinity},{activity:0},{pregnant:true}]) assert.throws(()=>calculateMetabolism({...profile,...override}));
});

test('macro calculator handles zero, fractions and rejects invalid numeric input', () => {
  assert.deepEqual(calculateMacroEnergy({protein:10,carbs:20,fat:10}),{kcal:210,proteinKcal:40,carbsKcal:80,fatKcal:90,proteinShare:19,carbsShare:38.1,fatShare:42.9});
  assert.equal(calculateMacroEnergy({protein:0,carbs:0,fat:0}).fatShare,0);
  assert.equal(calculateMacroEnergy({protein:0.5,carbs:0.25,fat:0.1}).kcal,3.9);
  for (const protein of ['',null,false,-1,Infinity,'no',1001]) assert.throws(()=>calculateMacroEnergy({protein,carbs:0,fat:0}));
});

test('portion examples expose assumptions and scale edible grams and fractions consistently', () => {
  const egg = calculateFoodPortion('egg');
  assert.equal(egg.grams,50);assert.equal(egg.protein,6);assert.equal(egg.carbs,0.5);assert.equal(egg.fat,5);assert.equal(egg.kcal,71);
  const rice = calculateFoodPortion('rice-box',{count:2,grams:200});
  assert.equal(rice.grams,400);assert.equal(rice.carbs,120);assert.equal(rice.protein,10);assert.equal(rice.kcal,530.8);
  assert.equal(calculateFoodPortion('egg',{count:0.5}).protein,3);
  assert.match(rice.note,/配菜/);assert.match(rice.note,/近似/);assert.match(egg.note,/去壳/);
  assert.match(rice.note,/本次按每份 200 g × 2 份计算/);
  for (const p of foodPortions) assert.ok(calculateFoodPortion(p.id).kcal >= 0);
  assert.throws(()=>calculateFoodPortion('unknown'));
  for (const options of [{count:0},{count:NaN},{grams:-1},{grams:''},{grams:5000,count:100}]) assert.throws(()=>calculateFoodPortion('egg',options));
});
