import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { parseMealEstimate } from '../public/meal-contract.js';
import { sumFoods } from '../public/domain.js';

const food = { name: '自定义杂粮饭（熟重）', grams: 200, kcal: 130, protein: 2.5, carbs: 29, fat: 0 };

test('unrecognized food shows a helpful message without schema details', () => {
  assert.throws(() => parseMealEstimate(JSON.stringify({items:[],note:'照片中没有食物'})), /无法识别出食物/);
});

test('meal parser preserves recognized meal types and leaves missing or invalid types for time fallback', () => {
  for (const mealType of ['早餐', '午餐', '晚餐', '加餐']) {
    assert.equal(parseMealEstimate(JSON.stringify({items:[food],mealType})).mealType,mealType);
  }
  for (const mealType of [undefined,null,'unknown',12]) {
    assert.equal(parseMealEstimate(JSON.stringify({items:[food],mealType})).mealType,null);
  }
});

test('client meal parser accepts fenced JSON and custom food names without losing zero values', () => {
  const result = parseMealEstimate('```json\n' + JSON.stringify({ items: [food], note: '按剩余份量估算' }) + '\n```');
  assert.equal(result.items[0].name, food.name);
  assert.equal(result.items[0].fat, 0);
  assert.deepEqual(sumFoods(result.items), { kcal: 260, protein: 5, carbs: 58, fat: 0 });
  assert.equal(parseMealEstimate(JSON.stringify({ items: [{ ...food, grams: '100' }] })).items[0].grams, 100);
});

test('invalid meal JSON never reaches accounting as partial or coerced zero data', () => {
  for (const value of [null, '', 'not JSON', '{}', '{bad}', JSON.stringify({ foods: [{ ...food, calories: 130 }] }), JSON.stringify({ items: [] }), JSON.stringify({ items: Array.from({ length: 51 }, () => food) })]) assert.throws(() => parseMealEstimate(value));
  for (const patch of [{ name: '' }, { grams: 0 }, { grams: 10001 }, { kcal: -1 }, { kcal: 1001 }, { protein: 100.1 }, { carbs: null }, { fat: '' }, { fat: false }, { protein: undefined }, { grams: 'NaN' }]) assert.throws(() => parseMealEstimate(JSON.stringify({ items: [{ ...food, ...patch }] })));
});

test('HTTP meal request uses the same per-100g schema consumed by the real client parser', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fitness-meal-contract-'));
  let servedFood = { ...food };
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(request);
    const system = request.messages[0].content;
    // The fake model follows the system-level contract, exposing schema conflicts
    // even if a later user message asks for the client format.
    const understandsContract = system.includes('"items"') && system.includes('"kcal"') && /每\s*100/.test(system);
    const content = understandsContract
      ? JSON.stringify({ items: [servedFood], note: '份量为实际摄入；营养为每100g。' })
      : JSON.stringify({ foods: [{ ...servedFood, calories: servedFood.kcal }], note: '旧协议' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; };
  const upstreamUrl = await listen(upstream);
  const server = createServer({ dataDir: directory, aiTimeoutMs: 5000 });
  const base = await listen(server);
  const close = server => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  t.after(async () => { await close(server); await close(upstream); await rm(directory, { recursive: true, force: true }); });
  let cookie = '';
  const api = async (path, method, body) => {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const { user } = await api('/auth/register', 'POST', { email: 'meal-contract@example.test', name: 'Meal test', password: 'meal-contract-test-password' });
  await api('/providers', 'PUT', { providers: [{ id: 'meal-test', name: '餐识协议测试', baseUrl: upstreamUrl + '/v1', model: 'vision-test' }], tasks: { meal: 'meal-test' } });
  const picture = await api('/attachments', 'POST', { name: 'meal.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6H3kAAAAASUVORK5CYII=' });
  const body = { task: 'meal', messages: [{ role: 'user', content: '这餐实际吃下200克，返回items及每100克营养。', attachments: [{ id: picture.id }] }] };
  const response = await api('/ai', 'POST', body);
  const first = parseMealEstimate(response.content);
  assert.deepEqual(sumFoods(first.items), { kcal: 260, protein: 5, carbs: 58, fat: 0 });
  assert.equal(requests[0].model, 'vision-test');
  assert.equal(requests[0].messages[1].content[1].type, 'image_url');
  const saved = await api('/sync', 'POST', { userId: user.id, changes: [{ id: 'meal:contract', kind: 'meal', baseVersion: 0, data: { date: '2026-09-28', confirmed: true, items: first.items } }] });
  const original = saved.records.find(r => r.id === 'meal:contract');
  assert.equal(sumFoods(original.data.items).kcal, 260);
  servedFood = { ...food, grams: 100 };
  const revised = parseMealEstimate((await api('/ai', 'POST', { ...body, messages: [{ role: 'user', content: '同一餐刚才份量报错，实际只吃了一半。', attachments: [{ id: picture.id }] }] })).content);
  const updated = await api('/sync', 'POST', { userId: user.id, changes: [{ id: 'meal:contract', kind: 'meal', baseVersion: original.version, data: { ...original.data, items: revised.items } }] });
  const meals = updated.records.filter(r => r.kind === 'meal' && !r.deleted);
  assert.equal(meals.length, 1);
  assert.deepEqual(sumFoods(meals[0].data.items), { kcal: 130, protein: 2.5, carbs: 29, fat: 0 });
});
