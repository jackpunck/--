import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMetabolism, calculateMacroEnergy, calculateFoodPortion, foodPortions, calculateRMConversion} from '../public/knowledge-tools.js';
import {estimate1RM} from '../public/domain.js';

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

test('a 12-rep set estimates 1RM first and supplies the full RM conversion table', () => {
  const input={weight:40,currentReps:12,targetReps:5,increment:2.5};
  const result=calculateRMConversion(input);
  assert.equal(result.estimatedMax,56);
  assert.deepEqual(result.estimates,{epley:56,brzycki:57.6});
  assert.deepEqual(result.target,{reps:5,label:'5RM',weight:48,percent:85.7,equipmentWeight:47.5});
  assert.equal(result.rows.find(row=>row.reps===1).weight,56);
  assert.equal(result.rows.find(row=>row.reps===12).weight,40);
  assert.equal(result.rows.find(row=>row.reps===8).weight,44.2);
  assert.equal(result.rows.find(row=>row.reps===15).weight,37.3);
  assert.deepEqual(result.rows.map(row=>row.reps),Array.from({length:15},(_,index)=>index+1));
  assert.equal(result.rows[0].percent,100);
  assert.match(result.note,/超过 10 次/);
  assert.deepEqual(input,{weight:40,currentReps:12,targetReps:5,increment:2.5});
  const custom=calculateRMConversion({weight:'60',currentReps:'8',targetReps:'10',increment:'1'});
  assert.equal(custom.target.weight,57);
  assert.equal(custom.target.equipmentWeight,57);
  assert.equal(calculateRMConversion({weight:40}).target.reps,1);
});

test('both formulas match the existing strength estimator and retain measured single-rep weight', () => {
  for (const method of ['epley','brzycki']) {
    for (let reps=1;reps<=15;reps++) {
      const result=calculateRMConversion({weight:60,currentReps:reps,targetReps:reps,method});
      assert.equal(result.estimatedMax,estimate1RM(60,reps)[method]);
      assert.equal(result.target.weight,60);
      assert.equal(result.rows[0].weight,result.estimatedMax);
      assert.equal(result.rows[0].percent,100);
      assert(result.rows.every((row,index,rows)=>!index||row.weight<rows[index-1].weight));
    }
    assert.deepEqual(calculateRMConversion({weight:80,currentReps:1,method}).estimates,{epley:80,brzycki:80});
    assert.equal(calculateRMConversion({weight:80,currentReps:1,method}).estimatedMax,80);
  }
  const brzycki=calculateRMConversion({weight:40,currentReps:12,targetReps:5,method:'brzycki'});
  assert.equal(brzycki.estimatedMax,57.6);
  assert.equal(brzycki.target.weight,51.2);
  assert.equal(calculateRMConversion({weight:80,currentReps:1,targetReps:5}).target.weight,68.6);
});

test('RM conversion avoids intermediate rounding and rounds equipment loads down', () => {
  // A rounded 1RM would change 0.4 kg to 0.5 kg on the round trip.
  for (const method of ['epley','brzycki']) {
    assert.equal(calculateRMConversion({weight:0.4,currentReps:8,targetReps:8,increment:0.1,method}).target.weight,0.4);
    assert.equal(calculateRMConversion({weight:0.4,currentReps:8,targetReps:8,increment:0.1,method}).target.equipmentWeight,0.4);
  }
  // Display rounding must not round a load up across the equipment boundary.
  assert.equal(calculateRMConversion({weight:39.99,currentReps:12,targetReps:12}).target.equipmentWeight,37.5);
  assert.equal(calculateRMConversion({weight:0.1}).target.equipmentWeight,null);
});

test('RM conversions reject invalid weights, rep counts, formulas and equipment steps', () => {
  for (const weight of ['',null,false,0,-1,Infinity,NaN,1001,'no']) assert.throws(()=>calculateRMConversion({weight}));
  for (const key of ['currentReps','targetReps']) {
    for (const value of ['',null,false,0,-1,1.5,Infinity,NaN,16]) assert.throws(()=>calculateRMConversion({weight:40,[key]:value}));
  }
  for (const increment of ['',null,false,0,-1,Infinity,NaN,21]) assert.throws(()=>calculateRMConversion({weight:40,increment}));
  for (const method of ['',null,false,'unknown']) assert.throws(()=>calculateRMConversion({weight:40,method}));
});
