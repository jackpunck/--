import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, getRecords } from '../server/storage.mjs';
import { executePlanTool, getPlanToolReceipt, planTools } from '../server/plan-tools.mjs';

function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'fitness-plan-tools-'));
  const { db } = openStore(path);
  const now = new Date().toISOString();
  for (const id of ['alice', 'bob']) db.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)').run(id, `${id}@example.test`, id, 'test-only', now);
  t.after(() => { db.close(); rmSync(path, { recursive: true, force: true }); });
  let requests = 0;
  return { db, call: (name, args = {}, options = {}) => executePlanTool({ db, userId: 'alice', name, args, requestId: `request-${++requests}`, ...options }) };
}
function plan(name = '居家循环') {
  return {
    name, split: 2, variant: 'home', notes: ['按自身恢复安排训练。'],
    days: [
      { id: 'upper', name: '上肢', rest: false, exercises: [{ exerciseId: 'pushup', sets: 3, reps: '8–12', restSeconds: 90 }] },
      { id: 'lower', name: '下肢', rest: false, exercises: [{ exerciseId: 'squat', sets: 3, reps: '8–12次/侧', restSeconds: 90 }, { exerciseId: 'plank', sets: 2, reps: '20–40秒', restSeconds: 60 }] },
      { id: 'recovery', name: '恢复', rest: true, exercises: [] },
    ],
  };
}

test('AI plan tools publish bounded schemas and create, read, update, delete sync records', t => {
  const { db, call } = fixture(t);
  assert.deepEqual(planTools.map(tool => tool.function.name), ['get_training_plan', 'create_training_plan', 'update_training_plan', 'delete_training_plan']);
  const empty = call('get_training_plan');
  assert.equal(empty.exists, false);
  assert.equal(empty.currentVersion, 0);
  assert.equal(empty.record, null);
  assert.ok(empty.availableExercises.some(exercise => exercise.id === 'squat'));
  const created = call('create_training_plan', { plan: plan() });
  assert.equal(created.ok, true);
  assert.equal(created.record.id, 'active-plan');
  assert.equal(created.record.kind, 'plan');
  assert.equal(created.currentVersion, 1);
  assert.match(created.record.data.planVersion, /^[\da-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(created.record.data.confirmedAt)));
  assert.deepEqual(call('get_training_plan').record, created.record);
  const updated = call('update_training_plan', { expectedVersion: 1, plan: plan('新版训练') });
  assert.equal(updated.ok, true);
  assert.equal(updated.currentVersion, 2);
  assert.notEqual(updated.record.data.planVersion, created.record.data.planVersion);
  const deleted = call('delete_training_plan', { expectedVersion: 2 });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.record.deleted, true);
  assert.equal(deleted.record.data, null);
  assert.equal(deleted.currentVersion, 3);
  assert.equal(call('get_training_plan').exists, false);
  const revived = call('create_training_plan', { plan: plan('重新开始') });
  assert.equal(revived.currentVersion, 4);
  assert.equal(revived.record.deleted, false);
  assert.deepEqual(getRecords(db, 'alice'), [revived.record]);
});

test('AI plan validation rejects malformed plan fields without consuming the request', t => {
  const { db, call } = fixture(t);
  const invalidPlans = [
    null, [], {}, { ...plan(), name: '' }, { ...plan(), split: 0 }, { ...plan(), split: '2' }, { ...plan(), days: [] },
    { ...plan(), days: Array.from({ length: 15 }, (_, index) => ({ id: `day-${index}`, name: '过长循环', rest: true, exercises: [] })) },
    { ...plan(), days: [{ id: 'rest', name: '只有休息', rest: true, exercises: [] }] },
    { ...plan(), notes: '错误备注' }, { ...plan(), notes: ['过长'.repeat(251)] },
  ];
  for (const [field, value] of [['exerciseId', 'invented-move'], ['sets', 13], ['sets', 1.5], ['reps', '12<script>'], ['reps', '12–8'], ['reps', '101'], ['reps', '601秒'], ['restSeconds', 14], ['restSeconds', 601]]) {
    const invalidPlan = plan(); invalidPlan.days[0].exercises[0][field] = value; invalidPlans.push(invalidPlan);
  }
  for (const mutate of [
    value => value.days[0].rest = 'false',
    value => value.days[0].rest = true,
    value => value.days[0].exercises = [],
    value => value.days[1].id = value.days[0].id,
    value => value.days[0].id = '../bad',
    value => value.days[0].name = 'bad\nname',
  ]) { const invalidPlan = plan(); mutate(invalidPlan); invalidPlans.push(invalidPlan); }
  for (const invalidPlan of invalidPlans) {
    const result = call('create_training_plan', { plan: invalidPlan }, { requestId: 'retry-validatable' });
    assert.equal(result.code, 'INVALID_ARGUMENTS', JSON.stringify(invalidPlan));
    assert.equal(result.ok, false);
  }
  assert.deepEqual(getRecords(db, 'alice'), []);
  assert.equal(call('create_training_plan', { plan: plan() }, { requestId: 'retry-validatable' }).ok, true);
});

test('AI plan writes strip untrusted storage and history fields at every level', t => {
  const { call } = fixture(t);
  const supplied = plan();
  Object.assign(supplied, { userId: 'bob', id: 'schedule:today', source: 'fake', planVersion: 'injected', confirmedAt: '2000-01-01', completed: true });
  Object.assign(supplied.days[0], { actual: ['fake'], completed: true });
  Object.assign(supplied.days[0].exercises[0], { weight: 999, unsafeHtml: '<script>' });
  const result = call('create_training_plan', { plan: supplied, userId: 'bob' });
  assert.equal(result.ok, true);
  for (const key of ['userId', 'id', 'completed']) assert.equal(Object.hasOwn(result.record.data, key), false);
  assert.notEqual(result.record.data.source, supplied.source);
  assert.notEqual(result.record.data.planVersion, supplied.planVersion);
  assert.notEqual(result.record.data.confirmedAt, supplied.confirmedAt);
  assert.deepEqual(Object.keys(result.record.data.days[0]).sort(), ['exercises', 'id', 'name', 'rest']);
  assert.deepEqual(Object.keys(result.record.data.days[0].exercises[0]).sort(), ['exerciseId', 'reps', 'restSeconds', 'sets']);
});

test('AI plan writes are account scoped, including replay IDs and unknown accounts', t => {
  const { db, call } = fixture(t);
  const first = call('create_training_plan', { plan: plan('Alice') }, { requestId: 'same-request' });
  assert.equal(call('get_training_plan', {}, { userId: 'bob' }).exists, false);
  const second = call('create_training_plan', { plan: plan('Bob') }, { userId: 'bob', requestId: 'same-request' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(call('delete_training_plan', { expectedVersion: 1, userId: 'bob' }).ok, true);
  assert.equal(getRecords(db, 'bob')[0].data.name, 'Bob');
  assert.equal(call('get_training_plan', {}, { userId: 'unknown' }).code, 'USER_NOT_FOUND');
  assert.equal(call('create_training_plan', { plan: plan() }, { userId: 'unknown' }).code, 'USER_NOT_FOUND');
  db.prepare('DELETE FROM users WHERE id = ?').run('alice');
  assert.equal(db.prepare('SELECT count(*) AS count FROM ai_plan_operations WHERE user_id = ?').get('alice').count, 0);
});

test('AI plan tools detect current version conflicts and do not overwrite newer edits', t => {
  const { call } = fixture(t);
  assert.equal(call('update_training_plan', { expectedVersion: 1, plan: plan() }).code, 'PLAN_NOT_FOUND');
  const created = call('create_training_plan', { plan: plan() });
  assert.equal(call('create_training_plan', { plan: plan('Overwrite') }).code, 'PLAN_EXISTS');
  const userEdit = call('update_training_plan', { expectedVersion: 1, plan: plan('更新页面内容') });
  const collision = call('update_training_plan', { expectedVersion: created.currentVersion, plan: plan('过期 AI 内容') }, { requestId: 'retry-conflict' });
  assert.equal(collision.code, 'VERSION_CONFLICT');
  assert.deepEqual(collision.record, userEdit.record);
  assert.equal(call('delete_training_plan', { expectedVersion: 1 }).code, 'VERSION_CONFLICT');
  assert.equal(call('update_training_plan', { plan: plan() }).code, 'INVALID_ARGUMENTS');
  assert.equal(call('get_training_plan').record.data.name, '更新页面内容');
  assert.equal(call('update_training_plan', { expectedVersion: 2, plan: plan('冲突后合并') }, { requestId: 'retry-conflict' }).ok, true);
});

test('AI request retries cannot duplicate, reapply, or add a second mutation', t => {
  const { call } = fixture(t);
  const args = { plan: plan() };
  const created = call('create_training_plan', args, { requestId: 'stable-request' });
  const replay = call('create_training_plan', args, { requestId: 'stable-request' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.originalVersion, 1);
  assert.deepEqual(replay.record, created.record);
  assert.equal(call('create_training_plan', { plan: plan('修改重试内容') }, { requestId: 'stable-request' }).code, 'REQUEST_ALREADY_MUTATED');
  assert.equal(call('delete_training_plan', { expectedVersion: 1 }, { requestId: 'stable-request' }).code, 'REQUEST_ALREADY_MUTATED');
  assert.equal(call('get_training_plan').currentVersion, 1);
  const removed = call('delete_training_plan', { expectedVersion: 1 }, { requestId: 'delete-request' });
  const afterRemoval = call('create_training_plan', args, { requestId: 'stable-request' });
  assert.equal(afterRemoval.replayed, true);
  assert.deepEqual(afterRemoval.record, removed.record);
  assert.equal(afterRemoval.exists, false);
  assert.equal(afterRemoval.originalVersion, 1);
  const deleteReplay = call('delete_training_plan', { expectedVersion: 1 }, { requestId: 'delete-request' });
  assert.equal(deleteReplay.replayed, true);
  assert.equal(deleteReplay.currentVersion, 2);
  assert.equal(call('create_training_plan', args, { requestId: '' }).code, 'INVALID_ARGUMENTS');
});

test('AI stream retries can recover account scoped receipts without retaining old plan contents', t => {
  const { db, call } = fixture(t);
  const getReceipt = (options = {}) => getPlanToolReceipt({ db, userId: 'alice', requestId: 'interrupted-stream', ...options });
  assert.equal(getReceipt(), null);
  const created = call('create_training_plan', { plan: plan('不能残留在回执表中的私密计划') }, { requestId: 'interrupted-stream' });
  const receipt = getReceipt();
  assert.equal(receipt.name, 'create_training_plan');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.replayed, true);
  assert.equal(receipt.originalVersion, 1);
  assert.deepEqual(receipt.record, created.record);
  assert.equal(getReceipt({ userId: 'bob' }), null);
  assert.equal(getReceipt({ requestId: 'different-request' }), null);
  call('delete_training_plan', { expectedVersion: 1 });
  assert.equal(getReceipt().record.deleted, true);
  assert.equal(getReceipt().currentVersion, 2);
  assert.equal(getReceipt().originalVersion, 1);
  for (const row of db.prepare('SELECT * FROM ai_plan_operations').all()) assert.equal(JSON.stringify(row).includes('不能残留'), false);
});

test('AI plan updates and tombstones preserve schedules, completed history and drafts byte for byte', t => {
  const { db, call } = fixture(t);
  const created = call('create_training_plan', { plan: plan() });
  const preserved = [
    ['schedule:2026-09-01', 'schedule', { date: '2026-09-01', completed: true, daySnapshot: created.record.data.days[0], planVersion: created.record.data.planVersion, actual: [{ exerciseId: 'pushup', sets: 3, reps: '10', weight: 0 }] }],
    ['schedule:2026-10-01', 'schedule', { date: '2026-10-01', completed: false, daySnapshot: created.record.data.days[1], planVersion: created.record.data.planVersion }],
    ['plan-draft', 'plan', plan('未确认草案')],
    ['profile', 'profile', { name: '个人资料' }],
  ];
  for (const [id, kind, data] of preserved) db.prepare('INSERT INTO records(user_id,id,kind,data,version,deleted,updated_at) VALUES(?,?,?,?,?,?,?)').run('alice', id, kind, JSON.stringify(data), 7, 0, '2026-09-01T00:00:00Z');
  const select = () => db.prepare("SELECT * FROM records WHERE user_id = 'alice' AND id <> 'active-plan' ORDER BY id").all();
  const before = select();
  assert.equal(call('update_training_plan', { expectedVersion: 1, plan: plan('调整') }).ok, true);
  assert.deepEqual(select(), before);
  assert.equal(call('delete_training_plan', { expectedVersion: 2 }).ok, true);
  assert.deepEqual(select(), before);
  assert.equal(db.prepare("SELECT data FROM records WHERE user_id = 'alice' AND id = 'active-plan'").get().data, 'null');
});

test('AI plan mutation and its retry receipt commit or roll back together', t => {
  const { db, call } = fixture(t);
  call('create_training_plan', { plan: plan() });
  db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON ai_plan_operations BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  assert.throws(() => call('update_training_plan', { expectedVersion: 1, plan: plan('不能保存') }), /fixture failure/);
  assert.equal(call('get_training_plan').currentVersion, 1);
  assert.equal(call('get_training_plan').record.data.name, '居家循环');
  assert.equal(db.prepare('SELECT count(*) AS count FROM ai_plan_operations').get().count, 1);
});
