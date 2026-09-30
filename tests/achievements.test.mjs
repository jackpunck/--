import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarResetChanges} from '../public/schedule.js';
import * as achievements from '../public/achievements.js';
const today='2026-09-30',earnedAt='2026-09-30T10:00:00.000Z';
const task=(id,date=today,completed=false)=>({id,kind:'calendar-task',data:{taskType:'training',date,completed,daySnapshot:{exercises:[{exerciseId:'bench',sets:4,reps:'8',completed}]}}});

test('finishing the last workout creates a stable weekly award with its earned date',()=>{
 assert.equal(typeof achievements.weeklyAchievement,'function');
 const first=task('a','2026-09-28',true),last=task('b'),updated=structuredClone(last);updated.data.daySnapshot.exercises[0].completed=true;
 const award=achievements.weeklyAchievement([first,last],updated,today,earnedAt);
 assert.equal(award.id,'achievement:week:2026-09-28');assert.equal(award.kind,'achievement');
 assert.deepEqual(award.data,{type:'weekly-training',weekStart:'2026-09-28',weekEnd:'2026-10-04',earnedDate:today,earnedAt,trainingCount:2});
 assert.equal(last.data.daySnapshot.exercises[0].completed,false);
 const actual={...last,data:{...last.data,completed:true,actual:[{sets:3,reps:'8'}]}};
 assert.equal(achievements.weeklyAchievement([first,last],actual,today,earnedAt).id,award.id);
});

test('empty, incomplete, deleted, moved and already finished tasks do not grant awards',()=>{
 assert.equal(typeof achievements.weeklyAchievement,'function');
 const record=task('a'),done=task('a',today,true);
 for(const [before,after] of [[[],done],[[record,task('b')],done],[[record],{...done,deleted:true}],[[record],{...done,data:{...done.data,date:'2026-10-05'}}],[[done],done],[[record],record],[[task('a','2026-10-06')],task('a','2026-10-06',true)]]){
  assert.equal(achievements.weeklyAchievement(before,after,today,earnedAt),null);
 }
 const empty=task('empty');empty.data.daySnapshot.exercises=[];
 assert.equal(achievements.weeklyAchievement([empty],empty,today,earnedAt),null);
});

test('week boundaries use the local calendar and earned awards survive reset',()=>{
 assert.equal(typeof achievements.weeklyAchievement,'function');
 const before=task('cross-year','2027-01-01'),after=task('cross-year','2027-01-01',true);
 const award=achievements.weeklyAchievement([before],after,'2027-01-01','2026-12-31T16:00:01.000Z');
 assert.equal(award.data.weekStart,'2026-12-28');assert.equal(award.data.weekEnd,'2027-01-03');assert.equal(award.data.earnedDate,'2027-01-01');
 assert.equal(calendarResetChanges([after,award]).some(r=>r.id===award.id),false);
});

test('achievement wall sorts and deduplicates earned weeks and ignores deleted records',()=>{
 assert.equal(typeof achievements.earnedWeeklyAchievements,'function');
 const a={id:'a',kind:'achievement',data:{type:'weekly-training',weekStart:'2026-09-28',weekEnd:'2026-10-04',earnedDate:'2026-09-30',earnedAt}};
 const b={...a,id:'b',data:{...a.data,weekStart:'2026-10-05',weekEnd:'2026-10-11',earnedDate:'2026-10-10'}};
 assert.deepEqual(achievements.earnedWeeklyAchievements([a,b,{...a,id:'duplicate'},{...b,id:'deleted',deleted:true},{...a,kind:'meal'}]).map(r=>r.data.weekStart),['2026-10-05','2026-09-28']);
});
