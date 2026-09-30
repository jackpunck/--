import {weekDates, validateDate} from './schedule.js?v=10';

const training = record => !record.deleted && ['calendar-task','schedule'].includes(record.kind) && !record.data?.rest && !record.data?.daySnapshot?.rest && (!record.data?.taskType || record.data.taskType === 'training');
const completed = record => {
  const items = record.data?.daySnapshot?.exercises || [];
  return record.data?.completed === true || (items.length > 0 && items.every(item => item.completed === true));
};

/** Called only when the user saves training progress, never when projecting a calendar. */
export function weeklyAchievement(beforeTasks, updated, today, earnedAt) {
  const days = weekDates(today), previous = beforeTasks.find(record => record.id === updated.id);
  if (!previous || !training(previous) || !training(updated) || previous.data.date !== updated.data.date || !days.includes(updated.data.date) || completed(previous) || !completed(updated)) return null;
  const tasks = beforeTasks.filter(record => training(record) && days.includes(record.data.date));
  if (!tasks.length || !tasks.every(record => completed(record.id === updated.id ? updated : record))) return null;
  return {id:`achievement:week:${days[0]}`,kind:'achievement',data:{type:'weekly-training',weekStart:days[0],weekEnd:days[6],earnedDate:today,earnedAt,trainingCount:tasks.length}};
}

export function earnedWeeklyAchievements(records) {
  const weeks = new Map();
  for (const record of records) {
    if (record.deleted || record.kind !== 'achievement' || record.data?.type !== 'weekly-training') continue;
    try { for (const field of ['weekStart','weekEnd','earnedDate']) validateDate(record.data[field]); } catch { continue; }
    const existing = weeks.get(record.data.weekStart);
    if (!existing || record.data.earnedAt < existing.data.earnedAt) weeks.set(record.data.weekStart,record);
  }
  return [...weeks.values()].sort((a,b) => b.data.weekStart.localeCompare(a.data.weekStart));
}
