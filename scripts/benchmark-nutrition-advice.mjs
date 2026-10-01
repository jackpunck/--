// Browser-to-model latency benchmark. Original account/database are read-only.
// Normal scenarios call the configured provider; explicitly named simulations do not.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from '../server.mjs';
import { providerFromRow } from '../server/storage.mjs';
import { addDays } from '../public/schedule.js';

const playwrightPath = process.env.QA_PLAYWRIGHT || 'C:/Users/eeeee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)));
const db = new DatabaseSync('.data/fitness.sqlite', { readOnly: true });
let provider, apiKey, profile;
try {
  const owners = db.prepare('SELECT * FROM preferences').all().filter(row => JSON.parse(row.tasks).planning);
  assert.equal(owners.length, 1, '需要唯一的规划模型配置');
  const owner = owners[0];
  const row = db.prepare('SELECT * FROM providers WHERE user_id=? AND id=?').get(owner.user_id, JSON.parse(owner.tasks).planning);
  provider = providerFromRow(row);
  provider.model = JSON.parse(owner.task_models).planning || provider.model;
  const storedProfile = db.prepare("SELECT data FROM records WHERE user_id=? AND id='profile' AND deleted=0").get(owner.user_id);
  assert.ok(storedProfile, '需要个人资料以生成营养目标');
  profile = JSON.parse(storedProfile.data);
  apiKey = '';
  if (row.api_key) {
    const bytes = Buffer.from(row.api_key, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', readFileSync('.data/server.key'), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    apiKey = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
} finally { db.close(); }

const qaRoot = resolve('.qa');
await mkdir(qaRoot, { recursive: true });
const dataDir = await mkdtemp(join(qaRoot, 'advice-latency-cases-'));
const report = process.argv.includes('--resume') ? JSON.parse(readFileSync(join(qaRoot, 'advice-response-cases.json'), 'utf8')) : {
  measuredAt: new Date().toISOString(), timezone: 'Asia/Shanghai', model: provider.model,
  timeoutMs: 60000, samplesPerNormalScenario: 2, runs: [], cache: null, errors: [] };
let browser, server, activeRun, providerCallCount = 0;
const fixture = timing => ({ version: 3,
  brief: { summary: '按剩余餐次安排', habitBasis: '参考已有记录', tip: '按饥饿感调整份量',
    meals: ['早餐', '午餐', '晚餐'].map((name, index) => ({ name,
      status: timing.scenario === 'review' ? 'review' : index < Math.min(3, timing.mainMealCount) ? 'recorded' : index < timing.earliestMealIndex ? 'skipped' : 'planned',
      summary: '结合当天安排', foods: [] })) },
  detailed: { overview: '结合记录判断搭配', findings: [{ title: '饮食搭配', evidence: '无明确依据', interpretation: '需要结合实际摄入', action: '核对未记录的餐次' }],
    nextStep: '按正常节奏安排后续饮食', uncertainty: '记录与实际摄入可能存在差异' } });
const simulatedDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  server = await startServer({ host: '127.0.0.1', port: 0, dataDir, fetchImpl: async (url, options) => {
    providerCallCount++;
    assert.ok(activeRun, '模型请求必须属于当前样本');
    const attempt = { index: activeRun.attempts.length + 1, realProvider: !activeRun.mode.startsWith('simulate_') };
    activeRun.attempts.push(attempt);
    const started = performance.now();
    const body = JSON.parse(options.body);
    attempt.requestBytes = Buffer.byteLength(options.body);
    const context = JSON.parse(body.messages[0].content.split('用户当前上下文：')[1]);
    let response;
    if (activeRun.mode === 'simulate_timeout') {
      await new Promise((_, reject) => {
        if (options.signal.aborted) return reject(options.signal.reason);
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    } else if (activeRun.mode === 'simulate_auth_failure') {
      await simulatedDelay(100);
      response = new Response('simulated authentication failure', { status: 401 });
    } else if (activeRun.mode.startsWith('simulate_')) {
      await simulatedDelay(100);
      const invalid = activeRun.mode === 'simulate_both_invalid' || (activeRun.mode === 'simulate_first_invalid' && attempt.index === 1);
      response = Response.json({ choices: [{ message: { content: invalid ? '{"version":3,"brief":' : JSON.stringify(fixture(context.mealTiming)) }, finish_reason: 'stop' }] });
    } else {
      response = await fetch(url, options);
    }
    attempt.headersMs = Math.round(performance.now() - started);
    attempt.httpStatus = response.status;
    if (!response.ok) { attempt.totalMs = Math.round(performance.now() - started); return response; }
    const payload = await response.json();
    attempt.totalMs = Math.round(performance.now() - started);
    attempt.finishReason = payload.choices?.[0]?.finish_reason;
    attempt.usage = payload.usage;
    const message = payload.choices?.[0]?.message;
    attempt.outputCharacters = message?.content?.length || 0;
    if (activeRun.mode === 'live_string_version' && message) {
      try { const parsed = JSON.parse(message.content); parsed.version = '3'; message.content = JSON.stringify(parsed); attempt.injected = 'version as string'; } catch {}
    }
    if (activeRun.mode === 'live_force_retry' && attempt.index === 1 && message) {
      message.content = '{"version":3,"brief":';
      attempt.injected = 'replace completed first response with incomplete JSON';
    }
    return Response.json(payload);
  } });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const browserContext = await browser.newContext({ viewport: { width: 1366, height: 950 }, timezoneId: 'Asia/Shanghai' });
  const registered = await browserContext.request.post(base + '/api/auth/register', { data: { name: '测速临时账号', email: `latency-${Date.now()}@example.test`, password: 'isolated-latency-password' } });
  assert.equal(registered.status(), 201);
  const { user } = await registered.json();
  const configured = await browserContext.request.put(base + '/api/providers', { data: { providers: [{ ...provider, apiKey }], tasks: { planning: provider.id }, taskModels: { planning: provider.model } } });
  apiKey = ''; assert.equal(configured.status(), 200);
  const sync = async changes => {
    const response = await browserContext.request.post(base + '/api/sync', { data: { userId: user.id, changes } });
    assert.equal(response.status(), 200); const result = await response.json(); assert.equal(result.conflicts.length, 0); return result;
  };
  await sync([{ id: 'profile', kind: 'profile', data: profile, baseVersion: 0 }]);
  const page = await browserContext.newPage();
  page.on('pageerror', error => report.errors.push(error.name + ': ' + error.message));
  await page.goto(base);
  await page.locator('.nav [data-page="nutrition"]').click();
  const date = await page.locator('#nutrition-date').inputValue();
  report.selectedDate = date;
  const createMeal = mealDate => ({ date: mealDate, confirmed: true, notes: '午餐：米饭、鸡肉和青菜，常见份量估算。', userPrompt: '午餐：米饭、鸡肉和青菜', createdAt: mealDate + 'T04:00:00.000Z',
    items: [{ name: '米饭（熟）', category: '正餐', grams: 200, kcal: 130, protein: 2.5, carbs: 29, fat: 0 },
      { name: '鸡肉（熟）', category: '正餐', grams: 100, kcal: 165, protein: 31, carbs: 0, fat: 4.6 },
      { name: '青菜（熟）', category: '正餐', grams: 150, kcal: 40, protein: 2, carbs: 4, fat: 2 }] });
  let meals = [], seed = 0;
  const prepare = async (targetDate, historyDays) => {
    const before = await (await browserContext.request.get(base + '/api/state')).json();
    const deletions = before.records.filter(r => !r.deleted && r.kind === 'meal').map(r => ({ id: r.id, kind: r.kind, data: {}, baseVersion: r.version, deleted: true }));
    seed++;
    meals = Array.from({ length: historyDays }, (_, index) => ({ id: `sample-meal-${seed}-${targetDate}-${index}`, kind: 'meal', data: createMeal(addDays(targetDate, -index)), baseVersion: 0 }));
    await sync([...deletions, ...meals]);
    await page.reload(); await page.locator('.nav [data-page="nutrition"]').click();
    await page.locator('#nutrition-date').fill(targetDate); await page.locator('#nutrition-date').dispatchEvent('change');
  };
  const run = async (scenario, mode, sample) => {
    if (report.runs.some(result => result.scenario === scenario && result.mode === mode && result.sample === sample)) return;
    activeRun = { scenario, mode, sample, attempts: [] };
    const result = activeRun;
    const stateBefore = await (await browserContext.request.get(base + '/api/state')).json();
    const recordId = 'nutrition-advice:' + await page.locator('#nutrition-date').inputValue();
    const oldAdvice = stateBefore.records.find(r => r.id === recordId && !r.deleted)?.data;
    let requestAt;
    const trackRequest = request => { if (request.url() === base + '/api/ai') requestAt = performance.now(); };
    page.on('request', trackRequest);
    const responsePromise = page.waitForResponse(response => response.url() === base + '/api/ai', { timeout: 75000 });
    const started = performance.now();
    try {
      await page.locator('[data-action="advice-refresh"]').click();
      const response = await responsePromise;
      const payload = await response.json();
      const responseAt = performance.now();
      await page.waitForFunction(() => !document.querySelector('[data-action="advice-refresh"]').disabled, {}, { timeout: 10000 });
      result.clickToDisplayMs = Math.round(performance.now() - started);
      result.clickToRequestMs = Math.round(requestAt - started);
      result.apiRoundTripMs = Math.round(responseAt - requestAt);
      result.responseToDisplayMs = Math.round(performance.now() - responseAt);
      result.apiStatus = response.status();
      result.adviceAttempts = payload.adviceAttempts || result.attempts.length;
      result.serverTiming = payload.timing;
      result.error = payload.error || null;
      result.visibleError = await page.locator('#nutrition-advice .error-box').allTextContents();
      if (result.apiStatus !== 200 && oldAdvice?.data) {
        const after = await (await browserContext.request.get(base + '/api/state')).json();
        result.oldAdvicePreserved = JSON.stringify(after.records.find(r => r.id === recordId)?.data) === JSON.stringify(oldAdvice);
        assert.equal(result.oldAdvicePreserved, true);
      }
      report.runs.push(result);
      await writeFile(join(qaRoot, 'advice-response-cases.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ scenario, mode, sample, seconds: result.clickToDisplayMs / 1000, attempts: result.adviceAttempts, status: result.apiStatus, error: result.error }));
    } finally { page.off('request', trackRequest); activeRun = null; }
  };
  // Each case uses current frontend snapshot logic, the actual HTTP route and UI persistence.
  for (const scenario of [
    { name: '今日无饮食记录', date, days: 0 },
    { name: '今日已记录一餐', date, days: 1 },
    { name: '今日带近七天记录', date, days: 7 },
    { name: '历史日期复盘', date: addDays(date, -1), days: 1 },
    { name: '未来日期计划', date: addDays(date, 1), days: 0 }
  ]) {
    await prepare(scenario.date, scenario.days);
    for (let sample = 1; sample <= 2; sample++) await run(scenario.name, 'live', sample);
  }
  await prepare(date, 0);
  await run('版本号写成字符串（人为修改真实返回）', 'live_string_version', 1);
  await run('首次格式错误后重试（两次真实模型等待）', 'live_force_retry', 1);
  for (const [scenario, mode, samples] of [
    ['首次格式错误后成功（模拟，每次等待100ms）', 'simulate_first_invalid', 3],
    ['连续两次格式错误（模拟，每次等待100ms）', 'simulate_both_invalid', 3],
    ['认证失败（模拟，等待100ms）', 'simulate_auth_failure', 1]
  ]) for (let sample = 1; sample <= samples; sample++) await run(scenario, mode, sample);
  // One hung upstream verifies the real 60-second request budget without provider billing.
  await run('模型超时（人为挂起，实际60秒预算）', 'simulate_timeout', 1);
  const callsBefore = providerCallCount;
  const cacheStarted = performance.now();
  await page.reload(); await page.locator('.nav [data-page="nutrition"]').click();
  await page.locator('#nutrition-advice .advice-estimate-label').waitFor();
  const reloadToAdviceMs = Math.round(performance.now() - cacheStarted);
  const tabStarted = performance.now();
  await page.locator('[data-action="advice-mode"][data-mode="detailed"]').click();
  await page.locator('[data-action="advice-mode"][data-mode="detailed"][aria-pressed="true"]').waitFor();
  report.cache = { reloadToAdviceMs, tabSwitchMs: Math.round(performance.now() - tabStarted), extraProviderCalls: providerCallCount - callsBefore };
  report.realProviderCalls = report.runs.flatMap(sample => sample.attempts).filter(attempt => attempt.realProvider).length;
  report.summary = [...new Set(report.runs.map(sample => sample.scenario))].map(scenario => {
    const samples = report.runs.filter(sample => sample.scenario === scenario);
    const times = samples.map(sample => sample.clickToDisplayMs);
    return { scenario, samples: samples.length, meanMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length), minMs: Math.min(...times), maxMs: Math.max(...times), successes: samples.filter(sample => sample.apiStatus === 200).length,
      attempts: samples.map(sample => sample.adviceAttempts) };
  });
  await writeFile(join(qaRoot, 'advice-response-cases.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary: report.summary, cache: report.cache, realProviderCalls: report.realProviderCalls, browserErrors: report.errors }));
} finally {
  apiKey = '';
  if (browser) await browser.close();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
  const cleanupTarget = resolve(dataDir), withinQa = relative(qaRoot, cleanupTarget);
  assert.ok(withinQa && !withinQa.startsWith('..') && !isAbsolute(withinQa), '临时目录必须位于 .qa 内');
  await rm(cleanupTarget, { recursive: true, force: true });
}
