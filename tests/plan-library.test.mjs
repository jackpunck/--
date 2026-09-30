import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePartPlan} from '../public/domain.js';
import {calendarResetChanges,planCalendarTasks} from '../public/schedule.js';
import {weekDates,addDays,recurringCalendarTasks} from '../public/schedule.js';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as lib from '../public/plan-library.js';
const draft=()=>generatePartPlan({parts:['chest','back','legs']});
const now='2026-10-01T08:00:00.000Z';
const merge=(records,changes)=>[...new Map([...records,...changes].map(r=>[r.id,r])).values()];

test('library saves independent drafts with sequential default names even after rename and deletion',()=>{
 assert.equal(typeof lib.createLibraryTemplate,'function');
 let records=lib.createLibraryTemplate([],draft(),'template:a',now);
 assert.equal(records[0].data.name,'方案一');
 records[0].data.name='我的增肌安排';
 records=merge(records,lib.createLibraryTemplate(records,draft(),'template:b',now));
 assert.equal(records.find(r=>r.id==='template:b').data.name,'方案二');
 records=merge(records,[{id:'template:b',kind:'training-template',deleted:true,data:null}]);
 const next=lib.createLibraryTemplate(records,draft(),'template:c',now);
 assert.equal(next[0].data.name,'方案三');assert.equal(next[0].data.libraryNumber,3);
 assert.equal(lib.createLibraryTemplate([{id:'plan-library-sequence',data:{value:10}}],draft(),'template:11',now)[0].data.name,'方案十一');
});

test('migration preserves existing plan and draft and is idempotent including deleted templates',()=>{
 assert.equal(typeof lib.libraryMigration,'function');
 const active={id:'active-plan',kind:'plan',data:{...draft(),name:'原来的五分化',planVersion:'old-v1'}},pending={id:'plan-draft',kind:'draft',data:{...draft(),name:'我的草案'}};
 const records=[active,pending],before=structuredClone(records),changes=lib.libraryMigration(records,now);
 assert.deepEqual(records,before);const templates=changes.filter(r=>r.kind==='training-template');assert.equal(templates.length,2);assert.deepEqual(templates.map(r=>r.data.name),['原来的五分化','我的草案']);
 const saved=merge(records,changes);assert.deepEqual(lib.libraryMigration(saved,now),[]);
 assert.equal(saved.find(r=>r.id==='plan-draft').deleted,true);assert.deepEqual(saved.find(r=>r.id==='active-plan'),active);
 const deleted=merge(saved,[{id:templates[0].id,kind:'training-template',deleted:true,data:null}]);assert.deepEqual(lib.libraryMigration(deleted,now),[]);
 const imported={...active,data:{...active.data,libraryTemplateId:'template:existing'}};assert.deepEqual(lib.libraryMigration([imported],now),[]);
});

test('import snapshots are isolated from templates and have no completed exercise state',()=>{
 assert.equal(typeof lib.libraryPlan,'function');
 const record=lib.createLibraryTemplate([],draft(),'template:a',now)[0];record.data.days[0].exercises[0].completed=true;record.data.scheduleDate='2026-09-30';
 const before=structuredClone(record),plan=lib.libraryPlan(record);
 assert.equal(plan.libraryTemplateId,record.id);assert.equal(plan.planVersion,record.data.libraryRevision);assert.equal(plan.days[0].exercises[0].completed,undefined);assert.equal(plan.scheduleDate,undefined);
 const scheduled=planCalendarTasks(plan,'2026-10-01');scheduled[0].data.daySnapshot.exercises[0].sets=10;
 assert.deepEqual(record,before);assert.equal(plan.days[0].exercises[0].sets,4);
 assert.equal(calendarResetChanges([record]).length,0);
});

test('import rejects deleted, empty and invalid templates without changing them',()=>{
 assert.equal(typeof lib.libraryPlan,'function');
 const record=lib.createLibraryTemplate([],draft(),'template:a',now)[0];
 for(const mutate of [r=>r.deleted=true,r=>r.data.name=' ',r=>r.data.days=[],r=>r.data.days[0].exercises=[],r=>r.data.days[0].exercises[0].sets=0,r=>r.data.days[0].exercises[0].reps='',r=>r.data.days[0].exercises[0].exerciseId='missing']){
  const copy=structuredClone(record);mutate(copy);const before=structuredClone(copy);assert.throws(()=>lib.libraryPlan(copy));assert.deepEqual(copy,before);
 }
});

test('import activates plan and schedule atomically, respects busy days and preserves completed previous sessions',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const records=new Map(),batches=[];let fail=false,counter=0;
 const store={records,get:id=>{const r=records.get(id);return r&&!r.deleted?structuredClone(r.data):null;},list:kind=>[...records.values()].filter(r=>r.kind===kind&&!r.deleted),putMany:async changes=>{if(fail)throw new Error('disk unavailable');batches.push(structuredClone(changes));for(const r of changes)records.set(r.id,structuredClone(r));}};
 const context={loadCalendarHolidayData:async()=>{},state:{store,date:'2026-10-01'},plan:()=>store.get('active-plan'),today:()=> '2026-10-01',uid:()=>`cycle-${++counter}`,structuredClone,weekDates,addDays,planCalendarTasks,recurringCalendarTasks,calendarResetChanges};
 runInNewContext(source.slice(source.indexOf('function cycleWindow('),source.indexOf('function openCalendarTask(')),context);
 const template=lib.createLibraryTemplate([],draft(),'template:a',now)[0],first=lib.libraryPlan(template);
 records.set(template.id,template);records.set('calendar-busy-days',{id:'calendar-busy-days',kind:'calendar-settings',data:{dates:['2026-10-01']}});
 fail=true;await assert.rejects(context.addPlanToCalendar(first,'2026-10-01',{activate:true}),/disk unavailable/);assert.equal(records.has('active-plan'),false);assert.equal(records.has('calendar-cycle'),false);
 fail=false;await context.addPlanToCalendar(first,'2026-10-01',{activate:true});
 assert(batches[0].some(r=>r.id==='active-plan'));assert(batches[0].some(r=>r.id==='calendar-cycle'));assert(batches[0].some(r=>r.kind==='calendar-task'));
 const original=store.list('calendar-task');assert(original.every(r=>r.data.date!=='2026-10-01'));assert(original.length>10);
 original[0].data.completed=true;original[1].data.daySnapshot.exercises.forEach(e=>e.completed=true);
 const completed=structuredClone(original.slice(0,2));
 const next=lib.libraryPlan(lib.createLibraryTemplate([...records.values()],generatePartPlan({parts:['shoulders']}),'template:b',now)[0]);
 await context.addPlanToCalendar(next,'2026-10-01',{activate:true});
 for(const r of completed)assert.deepEqual(records.get(r.id),r);
 assert(original.slice(2).every(r=>records.get(r.id).deleted));
 const cycle=store.get('calendar-cycle').id,size=store.list('calendar-task').length;
 await context.addPlanToCalendar(next,'2026-10-01',{activate:true});assert.equal(store.get('calendar-cycle').id,cycle);assert.equal(store.list('calendar-task').length,size);
 assert.deepEqual(records.get(template.id),template);
});

test('editing a saved template refuses stale snapshots instead of overwriting another device',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const record=lib.createLibraryTemplate([],draft(),'template:a',now)[0],records=new Map([[record.id,structuredClone(record)]]);
 let writes=0;const store={records,put:async(kind,id,data)=>{writes++;records.set(id,{kind,id,data:structuredClone(data)});}};
 const context={loadCalendarHolidayData:async()=>{},state:{store,libraryEditing:structuredClone(record)},structuredClone,uid:()=> 'revision-2'};
 runInNewContext(source.slice(source.indexOf('async function ensurePlanLibrary('),source.indexOf('function planBuilder(')),context);
 const edited=structuredClone(record.data);edited.days[0].exercises[0].sets=5;
 await context.saveLibraryDraft(edited);assert.equal(records.get(record.id).data.days[0].exercises[0].sets,5);assert.equal(records.get(record.id).data.libraryRevision,'revision-2');
 records.get(record.id).data.name='另一台设备的名称';
 await assert.rejects(context.saveLibraryDraft(edited),/已更新/);assert.equal(writes,1);assert.equal(records.get(record.id).data.name,'另一台设备的名称');
});
