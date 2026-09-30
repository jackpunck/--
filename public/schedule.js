/** Shared training calendar rules. Dates are local wall-clock values. */
export function localDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error('日期无效。');
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期。');
  const d = new Date(value + 'T12:00:00');
  if (!Number.isFinite(d.getTime()) || localDate(d) !== value || Number(value.slice(0,4)) < 1900 || Number(value.slice(0,4)) > 2199) throw new Error('日期须在 1900–2199 年之间且实际存在。');
  return value;
}
export function addDays(date, amount) {
  validateDate(date);
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 36600) throw new Error('日期间隔无效。');
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + amount);
  return validateDate(localDate(d));
}
export function weekDates(date) {
  validateDate(date);
  const start = addDays(date, -((new Date(date+'T12:00:00').getDay()+6)%7));
  return Array.from({length:7}, (_, index) => addDays(start,index));
}
export function validateCalendarTask(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('训练任务格式无效。');
  if (value.taskType !== undefined && value.taskType !== 'training') throw new Error('日程表仅支持训练任务。');
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || title.length > 80 || /[\x00-\x1f\x7f]/.test(title)) throw new Error('任务名称须为 1–80 个字符。');
  const date = validateDate(value.date), notes = value.notes ?? '';
  if (typeof notes !== 'string' || notes.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(notes)) throw new Error('任务备注须为 2000 字以内的文本。');
  if (value.completed !== undefined && typeof value.completed !== 'boolean') throw new Error('任务完成状态无效。');
  return {taskType:'training',title,date,notes,completed:value.completed ?? false};
}

/** Place one complete cycle on the calendar, leaving recovery dates empty. */
export function planCalendarTasks(plan, startDate) {
  validateDate(startDate);
  if (!plan?.planVersion || !Array.isArray(plan.days) || !plan.days.some(day=>!day.rest)) throw new Error('请先确认训练计划。');
  return plan.days.flatMap((day,index)=>{
    const date=addDays(startDate,index);
    if(day.rest)return [];
    if(!day.id||!day.exercises?.length)throw new Error('每个训练日需要至少一个动作。');
    const data={...validateCalendarTask({title:day.name,date}),dayId:day.id,daySnapshot:structuredClone(day),planVersion:plan.planVersion,rest:false};
    return [{id:`task:plan:${plan.planVersion}:${startDate}:${index}`,kind:'calendar-task',data}];
  });
}

function isTrainingRecord(record) {
  if (!record || record.deleted || !record.data) return false;
  const data = record.data;
  if (data.daySnapshot?.rest === true) return false;
  if (record.kind === 'schedule') return data.taskType !== 'daily' && Boolean(data.dayId || data.daySnapshot);
  return record.kind === 'calendar-task' && data.taskType === 'training';
}

/** Old daily-task and manual day-type records stay stored, but do not participate
 * in the training calendar. Date and snapshot history are never rewritten here. */
export function calendarTasks(taskRecords = [], legacyScheduleRecords = [], activePlan = null) {
  const output = [];
  for (const record of [...taskRecords,...legacyScheduleRecords]) {
    if (!isTrainingRecord(record)) continue;
    const raw = record.data;
    try { validateDate(raw.date); } catch { continue; }
    const snapshot = raw.daySnapshot || activePlan?.days?.find(day => day.id === raw.dayId);
    if (snapshot?.rest) continue;
    output.push({...structuredClone(record),data:{...structuredClone(raw),taskType:'training',
      title:raw.title || snapshot?.name || '训练任务',notes:raw.notes || '',completed:Boolean(raw.completed),
      ...(snapshot?{daySnapshot:structuredClone(snapshot)}:{})}});
  }
  return output.sort((a,b)=>a.data.date.localeCompare(b.data.date) || String(a.id).localeCompare(String(b.id)));
}

/** A day's nutrition type depends only on its live training tasks. Completed
 * training still counts; moving/deleting the last task makes the old date rest. */
export function trainingDayType(date, records = []) {
  validateDate(date);
  return records.some(record=>isTrainingRecord(record) && record.data.date===date) ? 'training' : 'rest';
}
