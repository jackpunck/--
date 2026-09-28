import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays,weekDates,validateDate,validateCalendarTask,calendarTasks,trainingDayType} from '../public/schedule.js';
const date='2026-09-29', next='2026-09-30';
const task=(id,extra={})=>({id,kind:'calendar-task',version:1,data:{taskType:'training',title:'上肢训练',date,completed:false,...extra}});

test('calendar dates handle week/month/year boundaries and reject invalid local dates',()=>{
  assert.deepEqual(weekDates('2026-10-01'),['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']);
  assert.equal(addDays('2026-12-31',1),'2027-01-01');
  assert.equal(addDays('2024-02-28',1),'2024-02-29');
  for(const value of ['2026-02-29','2026-04-31','2026-9-01','2026-09-00','2026-09-29T00:00Z',null]) assert.throws(()=>validateDate(value));
});
test('date-only task validation requires no period/time and rejects retired daily task type',()=>{
  const input={...task('a').data,notes:'第一行\n第二行',userId:'untrusted',daySnapshot:{injected:true},startTime:'nonsense',endTime:'wrong'};
  const output=validateCalendarTask(input);
  assert.deepEqual(output,{taskType:'training',title:'上肢训练',date,notes:'第一行\n第二行',completed:false});
  assert.equal(validateCalendarTask({title:'腿部训练',date}).taskType,'training');
  for(const change of [{title:' '},{taskType:'daily'},{taskType:'admin'},{completed:'yes'},{notes:'\0'},{date:'2026-02-30'}]) assert.throws(()=>validateCalendarTask({...input,...change}));
});
test('training projection preserves moved legacy IDs and snapshots without mutating history',()=>{
  const legacy={id:'schedule:2026-09-28',kind:'schedule',version:7,data:{date,dayId:'old',completed:true,daySnapshot:{id:'old',name:'旧训练',exercises:[]},actual:[{sets:3}],planVersion:'old-version'}};
  const before=structuredClone(legacy),result=calendarTasks([], [legacy], {days:[{id:'old',name:'新训练'}]});
  assert.equal(result.length,1); assert.equal(result[0].id,legacy.id); assert.equal(result[0].data.date,date);
  assert.equal(result[0].data.title,'旧训练'); assert.equal(result[0].data.startTime,undefined);
  assert.equal(trainingDayType('2026-09-28',result),'rest'); assert.equal(trainingDayType(date,result),'training');
  result[0].data.actual[0].sets=10; assert.deepEqual(legacy,before);
});
test('daily tasks, manual day flags, rest-only records and tombstones never mark a training day',()=>{
  const records=[task('daily',{taskType:'daily'}),{id:'day-type:'+date,kind:'day-type',data:{date,rest:false}},
    {id:'schedule:'+date,kind:'schedule',data:{date,rest:true}}, {...task('deleted'),deleted:true},
    task('rest-snapshot',{daySnapshot:{rest:true,name:'恢复日',exercises:[]}})];
  const before=structuredClone(records);
  assert.equal(trainingDayType(date,records),'rest');
  assert.deepEqual(calendarTasks(records.filter(r=>r.kind==='calendar-task'),records.filter(r=>r.kind==='schedule')),[]);
  assert.deepEqual(records,before);
  assert.equal(trainingDayType(date,[task('real',{rest:true}),...records]),'training','obsolete rest override cannot hide a training card');
});
test('moving, adding and deleting tasks recompute both dates; completed tasks still count',()=>{
  const tasks=[task('a'),task('b')];
  assert.equal(trainingDayType(date,[]),'rest'); assert.equal(trainingDayType(date,tasks),'training'); assert.equal(trainingDayType(next,tasks),'rest');
  tasks[0].data.date=next;
  assert.equal(trainingDayType(date,tasks),'training'); assert.equal(trainingDayType(next,tasks),'training');
  tasks[1].deleted=true;
  assert.equal(trainingDayType(date,tasks),'rest'); assert.equal(trainingDayType(next,tasks),'training');
  tasks[0].data.completed=true; assert.equal(trainingDayType(next,tasks),'training');
  tasks[0].deleted=true; assert.equal(trainingDayType(next,tasks),'rest');
});
test('same-date training tasks coexist independently of old time fields and projection has deterministic ordering',()=>{
  const records=[task('z',{startTime:'18:00',endTime:'19:00'}),task('a',{startTime:'18:00',endTime:'19:00'}),task('next',{date:next})];
  const projected=calendarTasks(records);
  assert.deepEqual(projected.map(r=>r.id),['a','z','next']); assert.equal(projected.filter(r=>r.data.date===date).length,2);
  assert.equal(trainingDayType(date,projected),'training');
});
