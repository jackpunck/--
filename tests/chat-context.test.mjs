import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, getRecords } from '../server/storage.mjs';
import { writeRecord } from '../server/calendar-data.mjs';
import { buildMessages } from '../server/providers.mjs';
import { executeAssistantTool } from '../server/assistant-tools.mjs';
import { contextSections } from '../server/chat-context.mjs';
import { calculateNutrition } from '../public/domain.js';

const today = '2026-10-01';
const profile = { age: 30, sex: 'male', height: 175, weight: 70, goal: 'maintain' };
test('chat nutrition includes automatic and dated user calorie corrections',t=>{
 const {put,read}=fixture(t);
 put('profile','profile',{...profile,weight:71});
 put('phase:start','phase',{...profile,date:'2026-09-17'});
 put('phase:end','phase',{...profile,weight:71,date:today});
 put('feedback','nutrition-feedback-settings',{date:today,enabled:true,manualAdjustmentKcal:25});
 const current=read({sections:['nutrition']}).data.nutrition;
 assert.equal(current.feedback.adjustmentKcal,-75);
 assert.equal(current.target.kcal,calculateNutrition({...profile,weight:71},'rest',-75).kcal);
 const previous=read({sections:['nutrition'],date:'2026-09-17'}).data.nutrition;
 assert.equal(previous.feedback.adjustmentKcal,0);
 assert.equal(previous.target.kcal,calculateNutrition(profile,'rest').kcal);
});
function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'fitness-chat-context-')), { db } = openStore(path);
  for (const id of ['alice', 'bob']) db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').run(id, `${id}@context.test`, id, 'fixture', new Date().toISOString());
  t.after(() => { db.close(); rmSync(path, { recursive: true, force: true }); });
  return { db, put: (id, kind, data, userId = 'alice') => writeRecord(db, userId, { id, kind, data }),
    read: (args, userId = 'alice') => executeAssistantTool({ db, userId, name: 'read_chat_context', localToday: today, args }) };
}

test('chat initial prompt excludes complete legacy context and reference payloads; other tasks retain them', () => {
  const context = { localToday: today, date: today, timezoneOffset: -480, profile: { name: 'PRIVATE_PROFILE_MARKER' }, meals: ['PRIVATE_MEAL_MARKER'] };
  const body = { task: 'chat', stream: true, context, messages: [{ role: 'user', content: '你好' }] };
  const prompt = buildMessages(null, 'alice', body)[0].content;
  assert.doesNotMatch(prompt, /PRIVATE_|支持的动作：|知识大全的计算公式：|常见食物份量：/);
  assert.match(prompt, /read_chat_context/);
  assert.match(prompt, /未加载不等于没有记录/);
  assert.match(prompt, /2026-10-01/);
  for (const task of ['meal', 'planning', 'chat']) {
    const legacy = buildMessages(null, 'alice', { ...body, task, stream: false })[0].content;
    assert.match(legacy, /PRIVATE_PROFILE_MARKER/);
    assert.match(legacy, /知识大全的计算公式：/);
  }
});

test('context reads only requested sections, isolates accounts, and never writes records', t => {
  const { db, put, read } = fixture(t);
  put('profile', 'profile', profile);
  put('profile', 'profile', { ...profile, weight: 90 }, 'bob');
  put('preferences', 'preferences', { restrictions: '牛奶' });
  const before = getRecords(db, 'alice');
  const result = read({ sections: ['profile'] });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data), ['profile']);
  assert.equal(result.data.profile.profile.weight, 70);
  assert.equal(result.data.profile.preferences.restrictions, '牛奶');
  assert.equal(read({ sections: ['profile'] }, 'bob').data.profile.profile.weight, 90);
  assert.equal(read({ sections: ['profile'] }, 'missing').code, 'USER_NOT_FOUND');
  assert.deepEqual(getRecords(db, 'alice'), before);
  assert.deepEqual(getRecords(db, 'alice').filter(r => r.kind === 'plan'), []);
});

test('nutrition reads fresh records, uses shared calculation and ignores deleted or unconfirmed meals', t => {
  const { db, put, read } = fixture(t);
  put('profile', 'profile', profile);
  const meal = { date: today, confirmed: true, items: [{ name: '米饭', grams: 200, kcal: 120, protein: 2, carbs: 25, fat: 1 }] };
  put('meal:1', 'meal', meal);
  put('meal:draft', 'meal', { ...meal, confirmed: false });
  put('meal:other', 'meal', meal, 'bob');
  let nutrition = read({ sections: ['nutrition'] }).data.nutrition;
  assert.deepEqual(nutrition.target, calculateNutrition(profile, 'rest'));
  assert.equal(nutrition.totals.kcal, 240);
  assert.equal(nutrition.remaining.kcal, nutrition.target.kcal - 240);
  put('task:1', 'calendar-task', { taskType: 'training', date: today, title: '训练', completed: false });
  assert.deepEqual(read({ sections: ['nutrition'] }).data.nutrition.target, calculateNutrition(profile, 'training'));
  writeRecord(db, 'alice', { id: 'meal:1', kind: 'meal', deleted: true, version: 1 });
  assert.equal(read({ sections: ['nutrition'] }).data.nutrition.totals.kcal, 0);
  assert.equal(read({ sections: ['nutrition'], date: '2026-09-30' }).data.nutrition.dayType, 'rest');
  assert.ok(read({ sections: ['nutrition'] }, 'bob').data.nutrition.target.error);
});

test('history queries respect dates, limits and account boundaries', t => {
  const { put, read } = fixture(t);
  for (const [i, date] of ['2026-09-28', '2026-09-29', '2026-09-30', today, '2026-10-02'].entries()) {
    put(`meal:${i}`, 'meal', { date, title: `记录${i}` });
    put(`phase:${i}`, 'phase', { date, weight: 70 - i });
    put(`task:${i}`, 'calendar-task', { date, title: `训练${i}`, taskType: 'training', completed: false });
  }
  const result = read({ sections: ['meals', 'training', 'phases'], startDate: '2026-09-29', endDate: today, limit: 2 });
  for (const section of ['meals', 'training', 'phases']) {
    assert.equal(result.data[section].truncated, true);
    assert.equal(result.data[section].total, 3);
    assert.deepEqual(result.data[section].records.map(r => r.data.date), [today, '2026-09-30']);
    assert.deepEqual(read({ sections: [section] }, 'bob').data[section].records, []);
  }
  assert.equal(read({ sections: ['meals'], endDate: '2026-09-28' }).data.meals.total, 1);
});

test('reference sections remain available individually; malformed requests are rejected', t => {
  const { read } = fixture(t);
  for (const section of contextSections) {
    const result = read({ sections: [section] });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.data), [section]);
  }
  assert.match(read({ sections: ['visuals'] }).data.visuals.guide, /持续等长支撑/);
  assert.ok(read({ sections: ['exercises'] }).data.exercises.some(e => e.id === 'squat'));
  for (const args of [null, [], {}, { sections: [] }, { sections: ['secret'] }, { sections: ['profile'], userId: 'bob' }, { sections: ['meals'], limit: 101 }, { sections: ['nutrition'], date: '2026-02-30' }, { sections: ['training'], startDate: '2026-10-03' }]) {
    assert.equal(read(args).code, 'INVALID_ARGUMENTS');
  }
});

test('oversized history can be narrowed instead of overflowing model context', t => {
  const { put, read } = fixture(t);
  for (let i = 0; i < 4; i++) put(`meal:${i}`, 'meal', { date: today, notes: '资料'.repeat(16000) });
  assert.equal(read({ sections: ['meals'] }).code, 'CONTEXT_TOO_LARGE');
  const narrowed = read({ sections: ['meals'], limit: 1 });
  assert.equal(narrowed.ok, true);
  assert.equal(narrowed.data.meals.truncated, true);
});
