import {normalizeBusySettings} from '../public/busy-rules.js';
import { createHash, randomUUID } from 'node:crypto';
import { recordFromRow } from './storage.mjs';
import { addDays, calendarTasks, recurringCalendarTasks } from '../public/schedule.js';

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

// The browser supplies its local date, never the model. UTC±14 means it can
// differ by at most one calendar day from the server's UTC date.
export function resolveLocalToday(value, now = new Date()) {
  const utc = now.toISOString().slice(0, 10);
  if (value === undefined) return utc;
  if (!validDate(value) || Math.abs(Date.parse(value) - Date.parse(utc)) > 86400000) throw new Error('客户端今日日期无效，请检查设备日期并刷新。');
  return value;
}

export function resolveLocalTime(today, timezoneOffset, now = new Date()) {
  const offset = timezoneOffset ?? now.getTimezoneOffset();
  if (!Number.isInteger(offset) || offset < -840 || offset > 720) throw new Error('客户端时区无效，请刷新后重试。');
  const local = new Date(now.getTime() - offset * 60000);
  if (local.toISOString().slice(0, 10) !== today) {
    if (timezoneOffset !== undefined) throw new Error('客户端日期与时区不一致，请检查设备时间并刷新。');
    return '24:00'; // Date-only schedules do not use this clock value.
  }
  const minutes = Math.min(1440, local.getUTCHours() * 60 + local.getUTCMinutes() + 1);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function recordById(db, userId, id) {
  return recordFromRow(db.prepare('SELECT * FROM records WHERE user_id = ? AND id = ?').get(userId, id)) ?? null;
}

export function calendarState(db, userId, activePlanOverride) {
  const stored = db.prepare("SELECT * FROM records WHERE user_id = ? AND kind IN ('calendar-task','schedule') AND deleted = 0 ORDER BY id").all(userId).map(recordFromRow);
  const busyRecord=recordById(db,userId,'calendar-busy-days');
  const busySettings=normalizeBusySettings(busyRecord&&!busyRecord.deleted?busyRecord.data||{}:{});
  const active = recordById(db, userId, 'active-plan');
  const records = calendarTasks(stored.filter(item => item.kind === 'calendar-task'), stored.filter(item => item.kind === 'schedule'), activePlanOverride ?? (active && !active.deleted ? active.data : null));
  // Removed daily tasks and manual nutrition day choices are kept in storage for
  // old data compatibility; they have no effect on today's training calendar.
  const trainingIds = new Set(records.map(record => record.id));
  const raw = stored.filter(record => trainingIds.has(record.id));
  const calendarVersion = createHash('sha256').update(JSON.stringify({ busySettings, tasks: raw.map(item => [item.id, item.version, item.deleted, item.data]), plan: active ? [active.id, active.version, active.deleted, active.data] : null })).digest('hex');
  return { records, calendarVersion, raw, busySettings };
}

export function writeRecord(db, userId, { id, kind, data, version = 0, deleted = false }, updatedAt = new Date().toISOString()) {
  const record = { id, kind, data: deleted ? null : data, version: version + 1, deleted, updatedAt };
  db.prepare(`INSERT INTO records(user_id,id,kind,data,version,deleted,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data,version=excluded.version,deleted=excluded.deleted,updated_at=excluded.updated_at`)
    .run(userId, id, kind, JSON.stringify(record.data), record.version, deleted ? 1 : 0, updatedAt);
  return record;
}

export function validateSchedule(value, today) {
  const input = value ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('排期参数必须是对象。');
  const startDate = input.startDate ?? today, days = input.days ?? 7;
  if (!validDate(startDate) || startDate < today || startDate > addDays(today, 365)) throw new Error('排期开始日期必须在今天至未来一年内。');
  if (!Number.isSafeInteger(days) || days < 1 || days > 28) throw new Error('排期范围必须为 1–28 天。');
  return { startDate, days };
}

// Called inside the same transaction as the plan write. Training is distributed
// by date in the plan's cycle; unrelated sessions and completed history remain.
export function arrangePlan(db, userId, previousPlan, planRecord, schedule, today, updatedAt) {
  const current = calendarState(db, userId, previousPlan), records = [], unscheduled = [];
  const endDate = addDays(schedule.startDate, schedule.days - 1);
  const belongs = task => task.data?.taskType === 'training' && previousPlan && (Boolean(task.data.planVersion) || previousPlan.days?.some(day => day.id === task.data.dayId));
  const removedIds = new Set();
  for (const task of current.records) {
    const date = task.data.date;
    if (date < today || task.data.completed || task.data.daySnapshot?.rest || !belongs(task)) continue;
    if (!planRecord.deleted && (date < schedule.startDate || date > endDate)) continue;
    const raw = current.raw.find(item => item.id === task.id);
    if (!raw) continue;
    records.push(writeRecord(db, userId, { ...raw, deleted: true }, updatedAt)); removedIds.add(task.id);
  }
  if (planRecord.deleted) return { records, scheduled: [], unscheduled, startDate: today, endDate: null };
  const retained = current.records.filter(task => !removedIds.has(task.id));
  const plan = planRecord.data;
  const rule={id:plan.planVersion,startDate:schedule.startDate,plan};
  for (const occurrence of recurringCalendarTasks(rule,schedule.startDate,endDate,current.busySettings)) {
    const date=occurrence.data.date,day=occurrence.data.daySnapshot;
    if (retained.some(task => task.data.date === date)) continue;
    const data = { taskType: 'training', title: day.name, date, notes: '', completed: false, dayId: day.id, daySnapshot: structuredClone(day), planVersion: plan.planVersion, source: 'ai-plan' };
    const record = writeRecord(db, userId, { id: `task:${randomUUID()}`, kind: 'calendar-task', data }, updatedAt);
    records.push(record); retained.push(record);
  }
  return { records, scheduled: records.filter(record => !record.deleted).map(record => ({ id: record.id, date: record.data.date, title: record.data.title })), unscheduled, startDate: schedule.startDate, endDate };
}
