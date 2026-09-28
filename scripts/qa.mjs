// Optional browser smoke test. Requires local Playwright; no production dependency.
// Default module: 精细模型与动作开发/node_modules/playwright/index.mjs
// Override QA_PLAYWRIGHT (module path), QA_BROWSER (Chromium executable) if needed.
// Run --extended to check offline/reload, two devices, explicit conflicts,
// photo estimate revisions and plan-history snapshots without repeating smoke.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const qaRoot = join(root, '.qa'); await mkdir(qaRoot, { recursive: true });
const dataDir = await mkdtemp(join(qaRoot, 'browser-'));
const { chromium } = await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT || join(root, '精细模型与动作开发/node_modules/playwright/index.mjs'))).href);
let mealRequests = 0;
const server = await startServer({ host: '127.0.0.1', port: 0, dataDir, fetchImpl: async (_url, options) => {
  const body = JSON.parse(options.body);
  const text = JSON.stringify(body.messages);
  let content = 'QA 模拟回答：可以先查看徒手深蹲的要领，控制下蹲与站起。训练计划要循序安排。';
  if (text.includes('请估算这同一餐')) {
    mealRequests++;
    const grams = mealRequests === 1 ? 200 : mealRequests === 2 ? 150 : 120;
    content = JSON.stringify({ items: [{ name: 'QA 米饭（熟）', grams, kcal: 116, protein: 2.6, carbs: 25.9, fat: 0.3 }], note: 'QA 固定响应：营养值均为每 100 克，份量根据本次测试步骤调整。' });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });
} });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 950 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(12000);
const errors = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/api/auth/me')) failures.push(`${response.status()} ${response.url()}`); });
const nav = async (name, target = page) => { if (await target.locator('.mobile-menu').isVisible()) await target.locator('.mobile-menu').click(); await target.locator(`.nav [data-page="${name}"]`).click(); };
const submit = (id, target = page) => target.locator(`#${id} button[type="submit"],#${id} button:not([type])`).last().click();
const screenshot = (name, target = page) => target.screenshot({ path: join(dataDir, name + '.png'), fullPage: true, style: '#toasts{visibility:hidden}' });
const stateFromServer = async () => (await context.request.get(base + '/api/state')).json();
const flush = async (target = page) => { await target.locator('#sync-status').click(); await target.waitForFunction(() => document.querySelector('#sync-status')?.textContent === '已同步'); };
const localSnapshot = target => target.evaluate(async () => {
  const user = JSON.parse(localStorage.getItem('fitness:last-user'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fitness-assistant-v1', 1);
    req.onsuccess = () => { const db = req.result, read = db.transaction('accounts').objectStore('accounts').get(user.id); read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error); };
    req.onerror = () => reject(req.error);
  });
});
const openPlanBuilder = async () => {
  if (!await page.locator('.training-plan-panel').evaluate(element => element.open)) await page.locator('.training-plan-panel > summary').click();
  await page.locator('.training-plan-content [data-action="plan-builder"]').click();
};
const scheduleTraining = async () => {
  await page.locator('[data-action="calendar-add"]').first().click();
  await page.locator('#task-title').fill('QA 当日训练');
  await page.locator('#task-day').selectOption({ index: 1 });
  await submit('calendar-task-form'); await page.locator('#calendar-task-form').waitFor({ state: 'hidden' });
  await page.locator('.calendar-task.training-task [data-action="calendar-detail"]').first().click();
  await page.locator('[data-action="log-training"]').click();
};
let step = '';
async function extendedChecks() {
  const email = `qa-extended-${Date.now()}@example.test`, password = 'qa-password-123';
  const registration = await context.request.post(base + '/api/auth/register', { data: { name: '扩展验证', email, password } });
  assert.equal(registration.status(), 201);
  const { user } = await registration.json();
  const profile = { age: 28, sex: 'male', height: 175, weight: 70, goal: 'maintain', activity: 1.375 };
  const seed = await context.request.post(base + '/api/sync', { data: { userId: user.id, changes: [{ id: 'profile', kind: 'profile', data: profile, deleted: false, baseVersion: 0 }] } });
  assert.equal(seed.status(), 200);
  const provider = await context.request.put(base + '/api/providers', { data: { providers: [{ id: 'qa-provider', name: 'QA 固定响应', model: 'qa-model', baseUrl: 'http://127.0.0.1:9998/v1', apiKey: '' }], tasks: { chat: 'qa-provider', meal: 'qa-provider', planning: 'qa-provider' } } });
  assert.equal(provider.status(), 200);
  await page.goto(base); await page.locator('#chat-input').waitFor();

  step = 'real IndexedDB offline entry and service-worker reload'; console.log(step);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true); await nav('nutrition'); await page.locator('[data-action="new-meal"]').click();
  await page.locator('#meal-title').fill('QA 离线餐食'); await page.locator('[data-action="add-food"]').click();
  for (const [key, value] of Object.entries({ name: '离线鸡胸肉', grams: '100', kcal: '120', protein: '24', carbs: '0', fat: '3' })) await page.locator(`[data-food-row="0"] [data-prop="${key}"]`).fill(value);
  await submit('meal-form'); await page.locator('.meal-card').filter({ hasText: 'QA 离线餐食' }).waitFor();
  assert((await localSnapshot(page)).pending.length > 0);
  await page.reload(); await page.locator('#chat-input').waitFor(); await nav('nutrition');
  await page.locator('.meal-card').filter({ hasText: 'QA 离线餐食' }).waitFor();
  assert((await localSnapshot(page)).pending.length > 0);
  await screenshot('extended-offline-reloaded');
  await context.setOffline(false); await flush();
  assert((await stateFromServer()).records.some(r => r.kind === 'meal' && r.data?.title === 'QA 离线餐食'));

  step = 'second browser context sync and explicit conflicts'; console.log(step);
  const otherContext = await browser.newContext({ viewport: { width: 1100, height: 850 }, reducedMotion: 'reduce' });
  const login = await otherContext.request.post(base + '/api/auth/login', { data: { email, password } }); assert.equal(login.status(), 200);
  const other = await otherContext.newPage(); other.setDefaultTimeout(12000); other.on('pageerror', error => errors.push(error.message));
  await other.goto(base); await other.locator('#chat-input').waitFor(); await nav('nutrition', other);
  await other.locator('.meal-card').filter({ hasText: 'QA 离线餐食' }).waitFor();
  const updateWeight = async (target, weight) => {
    await nav('settings', target); await target.locator('[data-action="settings-tab"][data-tab="profile"]').click();
    await target.locator('#settings-content [data-action="profile"]').click(); await target.locator('#profile-weight').fill(String(weight));
    await submit('profile-form', target); await target.locator('#profile-form').waitFor({ state: 'hidden' });
  };
  await context.setOffline(true); await otherContext.setOffline(true);
  await updateWeight(page, 71); await updateWeight(other, 72);
  await context.setOffline(false); await flush();
  await otherContext.setOffline(false); await other.waitForFunction(() => document.querySelector('#sync-status')?.textContent.includes('冲突'));
  await other.locator('#sync-status').click(); await other.locator('[data-action="resolve-conflict"][data-id="profile"]').first().waitFor();
  assert.equal(new Map((await localSnapshot(other)).records).get('profile').data.weight, 72);
  assert.equal((await stateFromServer()).records.find(r => r.id === 'profile').data.weight, 71);
  await screenshot('extended-explicit-conflict', other);
  await other.locator('[data-action="resolve-conflict"][data-id="profile"][data-local="false"]').click(); await flush(other);
  assert.equal(new Map((await localSnapshot(other)).records).get('profile').data.weight, 71);
  await context.setOffline(true); await otherContext.setOffline(true);
  await updateWeight(page, 73); await updateWeight(other, 74);
  await context.setOffline(false); await flush();
  await otherContext.setOffline(false); await other.waitForFunction(() => document.querySelector('#sync-status')?.textContent.includes('冲突'));
  await other.locator('#sync-status').click(); await other.locator('[data-action="resolve-conflict"][data-id="profile"][data-local="true"]').click(); await flush(other);
  assert.equal((await stateFromServer()).records.find(r => r.id === 'profile').data.weight, 74);
  await otherContext.close(); await flush();

  step = 'meal photo estimates, revisions and one confirmed record'; console.log(step);
  const mealCount = (await stateFromServer()).records.filter(r => r.kind === 'meal' && !r.deleted).length;
  await nav('nutrition'); await page.locator('[data-action="new-meal"]').click(); await page.locator('#meal-title').fill('QA 餐前餐后修订');
  const upload = async name => {
    const chooser = page.waitForEvent('filechooser'); await page.locator('[data-action="meal-photo"]').click();
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG5kAAAAASUVORK5CYII=', 'base64') });
    await page.locator('#meal-form .attachment').filter({ hasText: name }).waitFor();
  };
  await page.locator('#meal-notes').fill('第一张餐前：米饭 200g。'); await upload('qa-before.png');
  await page.locator('[data-action="meal-ai"]').click(); await page.waitForFunction(() => document.querySelector('[data-prop="grams"]')?.value === '200');
  assert.equal(await page.locator('[data-prop="kcal"]').inputValue(), '116');
  assert.equal((await stateFromServer()).records.filter(r => r.kind === 'meal' && !r.deleted).length, mealCount);
  await page.locator('#meal-notes').fill('第二张餐后：剩下 50g，实际吃了 150g。'); await upload('qa-after.png');
  await page.locator('[data-action="meal-ai"]').click(); await page.waitForFunction(() => document.querySelector('[data-prop="grams"]')?.value === '150');
  assert.match(await page.locator('#meal-live-totals').textContent(), /174 kcal/);
  await screenshot('extended-photo-revision-unconfirmed');
  assert.equal((await stateFromServer()).records.filter(r => r.kind === 'meal' && !r.deleted).length, mealCount);
  await submit('meal-form'); await page.locator('.meal-card').filter({ hasText: 'QA 餐前餐后修订' }).waitFor(); await flush();
  let meals = (await stateFromServer()).records.filter(r => r.kind === 'meal' && !r.deleted);
  assert.equal(meals.length, mealCount + 1);
  const confirmed = meals.find(r => r.data.title === 'QA 餐前餐后修订');
  assert.equal(confirmed.data.attachments.length, 2); assert.equal(confirmed.data.history.length, 2);
  await page.locator('.meal-card').filter({ hasText: 'QA 餐前餐后修订' }).locator('[data-action="edit-meal"]').click();
  await page.locator('#meal-notes').fill('再次核对：实际吃了 120g。'); await page.locator('[data-action="meal-ai"]').click();
  await page.waitForFunction(() => document.querySelector('[data-prop="grams"]')?.value === '120'); await submit('meal-form');
  await page.locator('#meal-form').waitFor({ state: 'hidden' }); await flush();
  meals = (await stateFromServer()).records.filter(r => r.kind === 'meal' && !r.deleted);
  assert.equal(meals.length, mealCount + 1); assert.equal(meals.find(r => r.id === confirmed.id).data.items[0].grams, 120);

  step = 'confirmed plan replacement preserves completed daySnapshot'; console.log(step);
  const createPlan = async (name, exercise) => {
    await openPlanBuilder(); await submit('plan-form'); await page.locator('#draft-form').waitFor();
    await page.locator('#plan-name').fill(name); await page.locator('[name="e-0-0"]').selectOption(exercise); await submit('draft-form'); await page.locator('#draft-form').waitFor({ state: 'hidden' });
  };
  await nav('training'); await createPlan('QA 历史计划 A', 'squat');
  await scheduleTraining();
  await page.locator('#training-notes').fill('QA 历史记录应保留'); await page.locator('[name="weight-0"]').fill('25'); await submit('training-log');
  await page.locator('#training-log').waitFor({ state: 'hidden' }); await flush();
  const before = (await stateFromServer()).records.find(r => r.kind === 'calendar-task' && r.data.completed);
  assert.equal(before.data.daySnapshot.exercises[0].exerciseId, 'squat');
  await createPlan('QA 新计划 B', 'curl'); await flush();
  const after = (await stateFromServer()).records.find(r => r.id === before.id);
  assert.deepEqual(after.data, before.data);
  const active = (await stateFromServer()).records.find(r => r.id === 'active-plan');
  assert.equal(active.data.days[0].exercises[0].exerciseId, 'curl'); assert.notEqual(active.data.planVersion, after.data.planVersion);
  await page.locator(`.calendar-task[data-task-id="${before.id}"] [data-action="calendar-detail"]`).first().click();
  await page.locator('[data-action="log-training"]').click(); assert.match(await page.locator('#training-log').textContent(), /徒手深蹲/);
  assert.equal(await page.locator('[name="weight-0"]').inputValue(), '25');
  await screenshot('extended-training-history-preserved'); await page.locator('[data-action="close-modal"]').click();
  console.log(JSON.stringify({ extendedPassed: true, dataDir, checks: 'real IndexedDB offline + SW reload; two contexts; choose-server and choose-local conflicts; two photo uploads + per-100g fixture revisions + one meal; historical daySnapshot after plan replacement', mealRequests }));
}
try {
  if (process.argv.includes('--extended')) {
    await extendedChecks();
  } else {
  step = 'register and profile'; console.log(step);
  await page.goto(base);
  await page.locator('#name').fill('冒烟测试'); await page.locator('#email').fill(`qa-${Date.now()}@example.test`); await page.locator('#password').fill('qa-password-123');
  await submit('auth-form'); await page.locator('#profile-form').waitFor(); await submit('profile-form'); await page.locator('#profile-form').waitFor({ state: 'hidden' });
  await page.locator('#chat-input').waitFor();
  await page.screenshot({ path: join(dataDir, 'desktop-chat.png'), fullPage: true });

  step = 'manual meal confirmation'; console.log(step);
  await nav('nutrition'); await page.locator('[data-action="new-meal"]').click();
  await page.locator('#meal-title').fill('QA 手动午餐'); await page.locator('[data-action="add-food"]').click();
  for (const [key, value] of Object.entries({ name: '鸡胸肉', grams: '150', kcal: '120', protein: '24', carbs: '0', fat: '3' })) await page.locator(`[data-food-row="0"] [data-prop="${key}"]`).fill(value);
  await submit('meal-form'); await page.locator('.meal-card').filter({ hasText: 'QA 手动午餐' }).waitFor();
  assert.match(await page.locator('.meal-card').textContent(), /180 kcal/);

  step = 'plan draft, confirmation and completed training'; console.log(step);
  await nav('training'); await openPlanBuilder(); await submit('plan-form');
  await page.locator('#draft-form').waitFor(); await page.locator('#plan-name').fill('QA 固定训练计划'); await submit('draft-form');
  await page.locator('#draft-form').waitFor({ state: 'hidden' }); await scheduleTraining();
  await page.locator('#training-notes').fill('QA 实际训练记录'); await submit('training-log');
  await page.locator('#training-log').waitFor({ state: 'hidden' }); await page.locator('.calendar-task.task-completed').waitFor();

  step = 'provider configuration and test'; console.log(step);
  await nav('settings'); await page.locator('[data-action="settings-tab"][data-tab="ai"]').click(); await page.locator('[data-action="provider"]').click();
  await page.locator('#provider-preset').selectOption('custom');
  await page.locator('#provider-name').fill('QA 测试供应商'); await page.locator('#provider-url').fill('http://127.0.0.1:9998/v1');
  await page.locator('.manual-model summary').click(); await page.locator('#provider-manual-model').fill('qa-model'); await page.locator('[data-action="manual-model"]').click();
  await submit('provider-form'); await page.locator('.provider-card').waitFor();
  await page.locator('[data-action="test-provider"]').click(); await page.getByText('连接成功，模型已返回有效回复。', { exact: true }).waitFor();
  assert.notEqual(await page.locator('#task-chat').inputValue(), '');

  step = 'chat and linked model'; console.log(step);
  await nav('chat'); await page.locator('#chat-input').fill('QA：怎么做徒手深蹲？'); await submit('chat-form');
  await page.locator('.message.assistant .message-text').filter({ hasText: 'QA 模拟回答' }).waitFor();
  await page.locator('.message.assistant [data-action="open-visual"][data-type="exercise"]').first().click();
  const frame = page.frameLocator('.model-frame'); await frame.locator('#loading').waitFor({ state: 'hidden', timeout: 60000 });
  assert.equal(await frame.locator('#exercise-name').textContent(), '徒手深蹲');
  await page.locator('#model-dialog [data-model-close]').click();
  await page.locator('.message.assistant [data-action="knowledge"]').first().click();
  await page.getByText('来源已核对，尚未专业审核', { exact: true }).waitFor();
  assert.match(await page.locator('#modal a').getAttribute('href'), /^https:\/\//);
  await page.locator('[data-action="close-modal"]').click();

  step = 'sync and persisted server data'; console.log(step);
  await page.locator('#sync-status').click();
  const result = await page.evaluate(async () => (await fetch('/api/state')).json());
  assert(result.records.some(r => r.kind === 'meal' && r.data?.title === 'QA 手动午餐'));
  assert(result.records.some(r => r.id === 'active-plan' && r.data?.name === 'QA 固定训练计划'));
  assert(result.records.some(r => r.kind === 'calendar-task' && r.data?.completed));
  assert(result.records.some(r => r.kind === 'conversation' && r.data?.messages?.length === 2));

  step = 'mobile layouts'; console.log(step);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['chat', 'nutrition', 'training', 'library', 'settings']) {
    await nav(name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} overflows mobile width`);
    await page.screenshot({ path: join(dataDir, `mobile-${name}.png`), fullPage: true });
  }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, mode: process.argv.includes('--extended') ? 'extended' : 'smoke', dataDir, errors, failures }));
} catch (error) {
  await page.screenshot({ path: join(dataDir, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(dataDir, 'failure.html'), await page.content());
  console.error(JSON.stringify({ step, dataDir, errors, failures }));
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
