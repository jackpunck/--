import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Import via data URL so this isolated suite also works before package.json exists.
const code = await readFile(new URL('../public/domain.js', import.meta.url), 'utf8');
const { exercises, foods, calculateNutrition, generatePlan, estimate1RM, sumFoods, suggestRecipe, substituteFood, convertFoodWeight, planVariants } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const profile = { age: 30, sex: 'male', height: 175, weight: 70, goal: 'maintain', activity: 1.4 };

test('nutrition formula matches an independently calculated example and energy accounting', () => {
  const result = calculateNutrition(profile);
  assert.equal(result.bmr, 1649);
  assert.equal(result.tdee, 2458);
  assert.equal(result.kcal, 2458);
  assert.equal(result.protein, 112);
  assert.ok(Math.abs(result.protein * 4 + result.carbs * 4 + result.fat * 9 - result.kcal) < 1);
  const rest = calculateNutrition(profile, 'rest');
  assert.equal(result.tdee - rest.tdee, 150);
  const female = calculateNutrition({ ...profile, sex: 'female' });
  assert.equal(female.bmr, 1483);
  assert.equal(female.tdee, 2176);
});

test('goals, day types, and profile updates recompute independently', () => {
  const maintain = calculateNutrition(profile);
  const lose = calculateNutrition({ ...profile, goal: 'lose' });
  const gain = calculateNutrition({ ...profile, goal: 'gain' });
  assert.ok(lose.kcal < maintain.kcal && maintain.kcal < gain.kcal);
  assert.equal(lose.kcal, Math.round((1648.75 * 1.4 + 150) * 0.85));
  assert.notEqual(calculateNutrition({ ...profile, weight: 75 }).bmr, maintain.bmr);
  assert.equal(calculateNutrition({ ...profile, weight: '70' }).kcal, maintain.kcal);
  assert.deepEqual(profile, { age: 30, sex: 'male', height: 175, weight: 70, goal: 'maintain', activity: 1.4 });
});

test('nutrition rejects missing, nonfinite, and inapplicable data', () => {
  for (const field of ['age', 'height', 'weight']) {
    for (const value of ['', ' ', null, undefined, NaN, Infinity, true, -1]) assert.throws(() => calculateNutrition({ ...profile, [field]: value }));
  }
  for (const age of [17, 101, 20.5]) assert.throws(() => calculateNutrition({ ...profile, age }));
  assert.throws(() => calculateNutrition({ ...profile, goal: 'lose', weight: 45 }), /18.5/);
  assert.throws(() => calculateNutrition({ ...profile, pregnant: true }));
  assert.throws(() => calculateNutrition(profile, 'holiday'));
  assert.throws(() => calculateNutrition({ ...profile, activity: 0 }));
});

test('all allowed plans have complete exercise references, rest days, and independent returned data', () => {
  const ids = new Set(exercises.map(e => e.id));
  for (const [split, variants] of Object.entries(planVariants)) {
    for (const variant of variants) {
      const plan = generatePlan({ split: Number(split), variant }, profile);
      assert.equal(plan.days.filter(d => !d.rest).length, Number(split));
      assert.ok(plan.days.some(d => d.rest));
      assert.equal(new Set(plan.days.map(d => d.id)).size, plan.days.length);
      for (const day of plan.days) {
        assert.equal(day.rest, day.exercises.length === 0);
        for (const e of day.exercises) assert.ok(ids.has(e.exerciseId) && e.sets > 0 && e.restSeconds >= 60);
      }
      plan.days[0].exercises[0].sets = 999;
      assert.equal(generatePlan({ split, variant }, profile).days[0].exercises[0].sets, 4);
    }
  }
  for (const options of [{ split: 2, variant: 'home' }, { split: 3, variant: 'arms' }, { split: 5, variant: 'shoulders' }, { split: 7 }, { split: 2.5 }]) assert.throws(() => generatePlan(options, profile));
});

test('catalog has unique IDs, truthful demo availability, and usable cues', () => {
  assert.ok(exercises.length >= 15);
  assert.equal(new Set(exercises.map(e => e.id)).size, exercises.length);
  assert.deepEqual(exercises.filter(e => e.demo).map(e => e.demo).sort(), ['curl', 'pushup', 'squat']);
  assert.ok(exercises.every(e => e.description && e.cues.length >= 3 && e.source));
  assert.equal(new Set(foods.map(e => e.id)).size, foods.length);
  assert.ok(foods.every(f => f.state && f.source.includes('估值')));
});

test('food totals handle scaled portions, custom label overrides, and zero correctly', () => {
  assert.deepEqual(sumFoods([]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(sumFoods([{ foodId: 'rice', grams: 200 }]), { kcal: 265.4, protein: 5, carbs: 60, fat: 0.6 });
  assert.deepEqual(sumFoods([{ foodId: 'rice', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0 }]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(sumFoods([{ name: '标签食品', grams: 50, kcal: 200, protein: 8, carbs: 30, fat: 5 }]), { kcal: 100, protein: 4, carbs: 15, fat: 2.5 });
  for (const bad of [{ foodId: 'missing', grams: 100 }, { foodId: 'rice', grams: -1 }, { foodId: 'rice', grams: NaN }, { foodId: 'rice', grams: 100, protein: -5 }, { foodId: 'rice', grams: ' ' }]) assert.throws(() => sumFoods([bad]));
});

test('1RM validates useful range and uses original Brzycki coefficient', () => {
  assert.deepEqual(estimate1RM(50, 1).range, [50, 50]);
  const estimate = estimate1RM(50, 10);
  assert.equal(estimate.epley, 66.7);
  assert.equal(estimate.brzycki, 66.7);
  assert.match(estimate1RM(50, 12).note, /超过10/);
  for (const reps of [0, 16, 36, NaN, 2.5]) assert.throws(() => estimate1RM(50, reps));
  assert.throws(() => estimate1RM(-50, 10));
});

test('substitution preserves the selected nutrient while disclosing other changes', () => {
  const change = substituteFood('rice', 200, 'potato', 'carbs');
  assert.equal(change.grams, 333.3);
  assert.ok(Math.abs(change.delta.carbs) < 0.1);
  assert.notEqual(change.delta.protein, 0);
  assert.throws(() => substituteFood('rice', 100, 'oil', 'protein'));
  assert.throws(() => substituteFood('missing', 100, 'rice'));
  assert.deepEqual(convertFoodWeight(100, 300, 750), { grams: 250, ratio: 2.5, note: '按本批实测重量比例换算，假设食物均匀。烹调加入的油、糖等另行记录。' });
  assert.equal(convertFoodWeight(250, 300, 750, 'cookedToRaw').grams, 100);
  assert.throws(() => convertFoodWeight(100, 0, 300));
});

test('multi-day recipes are deterministic, reconcile their totals, and honor supported restrictions', () => {
  const request = { profile, days: 7, preferences: '纯素', restrictions: '无麸质、花生过敏、牛奶过敏', trainingTime: '18:30' };
  const result = suggestRecipe(request);
  assert.deepEqual(result, suggestRecipe(request));
  assert.equal(result.days.length, 7);
  for (const day of result.days) {
    assert.equal(day.meals.length, 4);
    const items = day.meals.flatMap(m => m.items);
    assert.deepEqual(day.totals, sumFoods(items));
    assert.ok(Math.abs(day.totals.kcal - result.target.kcal) < 3);
    for (const item of items) {
      const food = foods.find(f => f.id === item.foodId);
      assert.ok(!food.allergens.some(a => ['肉类', '蛋', '奶', '麸质', '花生'].includes(a)));
      assert.ok(item.grams > 0 && item.state);
    }
  }
  assert.ok(result.notes.some(n => n.includes('18:30')));
  assert.equal(result.days[0].meals.find(m => m.key === 'dinner').energyShare, 0.4);
  assert.equal(result.days[0].meals.find(m => m.key === 'lunch').energyShare, 0.25);
});

test('single-meal recipes do not masquerade as a full day, and impossible restrictions fail clearly', () => {
  const result = suggestRecipe({ profile, days: 2, meal: 'lunch' });
  assert.equal(result.days[0].meals.length, 1);
  assert.equal(result.days[0].meals[0].name, '午餐');
  assert.ok(Math.abs(result.days[0].totals.kcal - result.target.kcal * 0.35) < 1);
  assert.throws(() => suggestRecipe({ profile, days: 8 }));
  assert.throws(() => suggestRecipe({ profile, meal: 'supper' }));
  assert.throws(() => suggestRecipe({ profile, preferences: '纯素', restrictions: '大豆过敏' }), /无法满足/);
  assert.throws(() => suggestRecipe({ profile, restrictions: '糖尿病' }), /个体营养方案/);
  const noOil = suggestRecipe({ profile, restrictions: '不吃植物油' });
  assert.ok(noOil.days[0].meals.flatMap(m => m.items).every(i => i.foodId !== 'oil'));
});
