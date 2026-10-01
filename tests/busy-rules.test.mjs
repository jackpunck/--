import test from 'node:test';
import assert from 'node:assert/strict';
import {recurringCalendarTasks,rescheduleBusyTasks} from '../public/schedule.js';
import * as rules from '../public/busy-rules.js';
const defaults={weeklyRules:[{from:'2026-10-01',weekdays:[1,3,5]}],overrides:{}};
const cycle={id:'weekly',startDate:'2026-10-01',plan:{planVersion:'p',days:[{id:'a',name:'胸',exercises:[{exerciseId:'bench',sets:4,reps:'8'}]},{id:'rest',rest:true,exercises:[]}]}};
test('weekly defaults respect holidays while explicit date choices always win',()=>{
 assert.equal(typeof rules.isBusyDate,'function');
 assert.equal(rules.isBusyDate('2026-10-02',defaults),false);assert.equal(rules.isBusyDate('2026-10-09',defaults),true);
 assert.equal(rules.isBusyDate('2026-10-05',{...defaults,overrides:{'2026-10-05':true}}),true);
 assert.equal(rules.isBusyDate('2026-10-09',{...defaults,overrides:{'2026-10-09':false}}),false);
 assert.equal(rules.isBusyDate('2026-10-10',{weeklyRules:[{from:'2026-10-01',weekdays:[6]}]}),true);
 assert.equal(rules.isBusyDate('2026-09-30',defaults),false);
});
test('legacy manual dates remain busy on holidays and invalid rules are rejected',()=>{
 assert.equal(typeof rules.normalizeBusySettings,'function');
 assert.equal(rules.isBusyDate('2026-10-01',{dates:['2026-10-01']}),true);
 assert.equal(rules.isBusyDate('2026-10-01',rules.normalizeBusySettings({dates:['2026-10-01']})),true);
 for(const value of [{weeklyRules:[{from:'2026-10-01',weekdays:[8]}]},{overrides:{'2026-02-30':true}},{overrides:{'2026-10-01':'true'}}])assert.throws(()=>rules.normalizeBusySettings(value));
});
test('changing weekly defaults keeps past rules and manual overrides',()=>{
 assert.equal(typeof rules.setDefaultWeekdays,'function');
 const before={...defaults,overrides:{'2026-10-20':false}},after=rules.setDefaultWeekdays(before,[2,4],'2026-10-15');
 assert.equal(rules.isBusyDate('2026-10-09',after),true);assert.equal(rules.isBusyDate('2026-10-16',after),false);assert.equal(rules.isBusyDate('2026-10-22',after),true);assert.equal(rules.isBusyDate('2026-10-20',after),false);
 assert.deepEqual(before.weeklyRules,defaults.weeklyRules);
});
test('cycles and pending reflow avoid recurring busy dates and keep completed sessions',()=>{
 assert.equal(typeof rules.isBusyDate,'function');
 const original=recurringCalendarTasks(cycle,'2026-10-01','2026-10-31'),projected=recurringCalendarTasks(cycle,'2026-10-01','2026-10-31',defaults);
 assert(projected.every(r=>!rules.isBusyDate(r.data.date,defaults)));assert(projected.some(r=>r.data.date==='2026-10-01'));
 original[0].data.completed=true;
 const changes=rescheduleBusyTasks(original,cycle,[],defaults,'2026-10-01');assert(!changes.some(r=>r.id===original[0].id));assert(changes.every(r=>!rules.isBusyDate(r.data.date,defaults)));
 assert.deepEqual(recurringCalendarTasks(cycle,'2026-10-08','2026-10-31',{weeklyRules:[{from:'2026-10-01',weekdays:[1,2,3,4,5,6,7]}]}),[]);
});


test('an entirely busy year fails reflow without mutating pending records',()=>{
 const pending={id:'manual:a',kind:'calendar-task',data:{taskType:'training',date:'2027-01-01',daySnapshot:cycle.plan.days[0]}};
 const before=structuredClone(pending),settings={weeklyRules:[{from:'2027-01-01',weekdays:[1,2,3,4,5,6,7]}]};
 assert.throws(()=>rescheduleBusyTasks([pending],null,[],settings,'2027-01-01'),/空闲日期/);assert.deepEqual(pending,before);
});
