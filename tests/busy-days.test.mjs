import test from 'node:test';
import assert from 'node:assert/strict';
import * as schedule from '../public/schedule.js';

const cycle={id:'busy-cycle',startDate:'2026-09-30',plan:{planVersion:'p1',days:[
 {id:'chest',name:'胸',exercises:[{exerciseId:'bench',sets:4,reps:'8'}]},
 {id:'rest',rest:true,exercises:[]},
 {id:'back',name:'背',exercises:[{exerciseId:'row',sets:4,reps:'8'}]}
]}};
const range=(dates=[])=>schedule.recurringCalendarTasks(cycle,'2026-09-30','2026-10-10',dates);

test('busy dates postpone a cycle in order, keep rest intervals and stable occurrence IDs',()=>{
 const regular=range(),busy=range(['2026-09-30','2026-10-01']);
 assert.deepEqual(busy.slice(0,4).map(r=>r.data.date),['2026-10-02','2026-10-04','2026-10-05','2026-10-07']);
 assert.deepEqual(busy.map(r=>r.id),regular.slice(0,busy.length).map(r=>r.id));
 assert.deepEqual(busy.slice(0,3).map(r=>r.data.dayId),['chest','back','chest']);
 assert.deepEqual(range(['2026-10-01']),regular,'Busy on a planned rest date does not add another rest');
 assert.deepEqual(schedule.recurringCalendarTasks(cycle,'2026-10-04','2026-10-07',['2026-09-30','2026-10-01']),busy.filter(r=>r.data.date>='2026-10-04'&&r.data.date<='2026-10-07'));
});

test('busy dates support cross-year cycles, validation and an entirely busy window',()=>{
 assert.equal(typeof schedule.normalizeBusyDates,'function');
 assert.deepEqual(schedule.normalizeBusyDates(['2027-01-01','2026-12-31','2027-01-01']),['2026-12-31','2027-01-01']);
 assert.throws(()=>schedule.normalizeBusyDates(['2026-02-30']));
 assert.throws(()=>schedule.normalizeBusyDates('2026-10-01'));
 const rule={...cycle,startDate:'2026-12-31'};
 assert.equal(schedule.recurringCalendarTasks(rule,'2026-12-31','2027-01-06',['2026-12-31','2027-01-01'])[0].data.date,'2027-01-02');
 const days=schedule.weekDates('2026-09-30');
 assert.deepEqual(schedule.recurringCalendarTasks(cycle,days[0],days[6],days),[]);
});

test('reflow preserves snapshots, completed history, tombstones and reverses when busy dates are cleared',()=>{
 assert.equal(typeof schedule.rescheduleBusyTasks,'function');
 const records=range(),original=structuredClone(records);
 records[1].data.daySnapshot.exercises[0].sets=7;records[1].data.notes='keep';
 records[2].deleted=true;
 records[3].data.daySnapshot.exercises.forEach(e=>e.completed=true);
 records[4].data.completed=true;records[4].data.actual=[{sets:3}];
 const changes=schedule.rescheduleBusyTasks(records,cycle,[],['2026-09-30'],'2026-09-30');
 assert.equal(changes.find(r=>r.id===records[0].id).data.date,'2026-10-01');
 assert.equal(changes.find(r=>r.id===records[1].id).data.daySnapshot.exercises[0].sets,7);
 assert.equal(changes.find(r=>r.id===records[1].id).data.notes,'keep');
 for(const r of records.slice(2,5))assert(!changes.some(change=>change.id===r.id));
 assert.equal(records[0].data.date,original[0].data.date);
 const shifted=records.map(r=>changes.find(c=>c.id===r.id)||r);
 const restored=schedule.rescheduleBusyTasks(shifted,cycle,['2026-09-30'],[],'2026-09-30');
 assert.equal(restored.find(r=>r.id===records[0].id).data.date,'2026-09-30');
 assert.deepEqual(schedule.rescheduleBusyTasks(records,cycle,[],['2026-09-30'],'2026-10-11'),[]);
});

test('standalone tasks shift in groups without piling up and can restore their original dates',()=>{
 assert.equal(typeof schedule.rescheduleBusyTasks,'function');
 const tasks=['2026-09-30','2026-09-30','2026-10-01','2026-10-03'].map((date,i)=>({id:`manual:${i}`,kind:'calendar-task',data:{taskType:'training',title:'训练',date,daySnapshot:cycle.plan.days[0]}}));
 const changed=schedule.rescheduleBusyTasks(tasks,null,[],['2026-09-30','2026-10-01'],'2026-09-30');
 assert.deepEqual(changed.map(r=>r.data.date),['2026-10-02','2026-10-02','2026-10-03','2026-10-05']);
 const restored=schedule.rescheduleBusyTasks(changed,null,['2026-09-30','2026-10-01'],[],'2026-09-30');
 assert.deepEqual(restored.map(r=>r.data.date),tasks.map(r=>r.data.date));
});

test('reset clears busy settings with calendar data while preserving templates',()=>{
 const changes=schedule.calendarResetChanges([{id:'calendar-busy-days',kind:'calendar-settings'},{id:'active-plan',kind:'plan'}]);
 assert.deepEqual(changes.map(r=>r.id),['calendar-busy-days']);
});

test('busy cycle projection matches a day-by-day reference with different rest patterns',()=>{
 for(let scenario=0;scenario<24;scenario++){
  const rule={...cycle,plan:{...cycle.plan,days:scenario%2?cycle.plan.days:[cycle.plan.days[0],cycle.plan.days[2]]}};
  const dates=Array.from({length:25},(_,i)=>schedule.addDays(rule.startDate,i));
  const busy=dates.filter((date,i)=>(i*7+scenario)%11<4),expected=[];let offset=0;
  for(const date of dates){const day=rule.plan.days[offset%rule.plan.days.length];if(!day.rest&&busy.includes(date))continue;if(!day.rest)expected.push({date,id:`task:cycle:${rule.id}:${offset}`});offset++;}
  assert.deepEqual(schedule.recurringCalendarTasks(rule,dates[0],dates.at(-1),busy).map(r=>({date:r.data.date,id:r.id})),expected);
 }
});

test('busy days at the supported upper date boundary do not break the visible window',()=>{
 const rule={...cycle,startDate:'2199-12-31'};
 assert.deepEqual(schedule.recurringCalendarTasks(rule,'2199-12-25','2199-12-31',['2199-12-31']),[]);
});
