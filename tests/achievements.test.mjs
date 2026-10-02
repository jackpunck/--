import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarResetChanges} from '../public/schedule.js';
import {achievementWall,achievementDefinitions,validTrainingCompletion,earnedWeeklyAchievements} from '../public/achievements.js';
import {renderAchievementWall,renderAchievementDetails} from '../public/achievement-view.js';
const award=(type,date='2026-10-05',extra={})=>({id:'achievement:'+type+date,kind:'achievement',data:{type,ruleVersion:2,earnedDate:date,earnedAt:date+'T00:00:00Z',...extra}});
const week=award('weekly-training','2026-10-05',{weekStart:'2026-09-28',weekEnd:'2026-10-04'});
test('wall displays each earned week separately and filters milestones without losing totals',()=>{
 const rows=[week,award('weekly-training','2026-10-12',{weekStart:'2026-10-05',weekEnd:'2026-10-11'}),award('first-training'),{id:'achievement-summary',kind:'achievement-summary',data:{sessions:8,weeks:2}}];
 assert.equal(achievementWall(rows).cards.length,3);
 assert.deepEqual(achievementWall(rows,'weekly').cards.map(card=>card.weekStart),['2026-10-05','2026-09-28']);
 assert.equal(achievementWall(rows,'weekly').cards[1].id,week.id);
 assert.equal(achievementWall(rows,'weekly').cards.length,2);assert.equal(achievementWall(rows,'milestone').cards[0].id,'first-training');
 assert.equal(achievementWall(rows).next.id,'sessions-10');assert.equal(achievementWall(rows).summary.sessions,8);
 assert.equal(calendarResetChanges(rows).some(r=>r.kind==='achievement'),false);
});
test('empty or invalid completion is never valid and real actuals require every planned exercise',()=>{
 const row={id:'a',kind:'calendar-task',data:{date:'2026-10-01',completed:true,daySnapshot:{exercises:[{exerciseId:'bench',sets:4,reps:'8'}]}}};
 assert.equal(validTrainingCompletion(row),false);row.data.actual=[{exerciseId:'bench',sets:4,reps:'8'}];assert.equal(validTrainingCompletion(row),true);
 row.data.actual[0].sets=0;assert.equal(validTrainingCompletion(row),false);
 row.data.actual[0].sets=4;row.deleted=true;assert.equal(validTrainingCompletion(row),false);
});
test('weekly history ignores deleted, duplicate and unverified records',()=>{
 assert.equal(earnedWeeklyAchievements([week,{...week,id:'duplicate'},{...week,deleted:true},{...week,data:{...week.data,ruleVersion:1}}]).length,1);
});
test('wall renders four cards, dots without fraction labels, empty and next goal states',()=>{
 const rows=['first-training','weeks-4','weeks-12','weeks-24','sessions-50'].map(type=>award(type));rows.push(week);
 const html=renderAchievementWall(rows);
 assert.equal((html.match(/class="achievement-stamp(?: [^"]*)?"/g)||[]).length,4);assert.match(html,/achievement-pagination/);assert.doesNotMatch(html,/1 \/ 3|年度足迹|月份/);
 assert.equal((renderAchievementWall(rows,{page:1}).match(/class="achievement-stamp(?: [^"]*)?"/g)||[]).length,2);
 assert.match(renderAchievementWall([]),/first-pending.svg/);
 const detail=renderAchievementDetails([{...week,data:{...week.data,training:[{id:'<bad>',date:'2026-10-01',title:'<script>alert(1)</script>'}]}}],week.id);
 assert.doesNotMatch(detail,/<script>/);assert.match(detail,/已归档/);
});

test('timed exercise values use the exercise unit even without an explicit suffix',()=>{
 const record={id:'timed',kind:'calendar-task',data:{date:'2026-10-01',daySnapshot:{exercises:[{exerciseId:'plank',sets:4,reps:'120',completed:true}]}}};
 assert.equal(validTrainingCompletion(record),true);
 record.data.daySnapshot.exercises[0].reps='601';assert.equal(validTrainingCompletion(record),false);
 record.data.daySnapshot.exercises[0]={exerciseId:'bench',sets:4,reps:'120',completed:true};assert.equal(validTrainingCompletion(record),false);
});

test('weekly cards show their own week range, omit repeat counts and open only that week',()=>{
 const earlier={...week,data:{...week.data,training:[{id:'old',date:'2026-09-30',title:'早期训练'}]}};
 const later=award('weekly-training','2026-10-12',{weekStart:'2026-10-05',weekEnd:'2026-10-11',training:[{id:'new',date:'2026-10-06',title:'后期训练'}]});
 const rows=[earlier,later,{...earlier,id:'duplicate'},{...later,deleted:true}];
 const html=renderAchievementWall(rows,{category:'weekly'});
 assert.equal((html.match(/class="achievement-stamp(?: [^"]*)?"/g)||[]).length,2);
 assert.match(html,/2026\.09\.28/);assert.match(html,/2026\.10\.04/);assert.match(html,/2026\.10\.05/);assert.match(html,/2026\.10\.11/);
 assert.doesNotMatch(html,/累计获得|最近获得于/);
 const detail=renderAchievementDetails(rows,earlier.id);
 assert.equal((detail.match(/<article>/g)||[]).length,1);assert.match(detail,/早期训练/);assert.doesNotMatch(detail,/后期训练/);
 assert.equal(achievementWall(rows,'weekly').cards.length,2);
});

test('all six new milestones render as individual cards, with cycle and return evidence in details',()=>{
 const types=['sessions-10','sessions-25','sessions-100','cycle-complete','training-return','weeks-52'];
 const rows=types.map(type=>award(type,'2026-10-02',{planName:type==='cycle-complete'?'肩背方案':undefined,round:1,gapDays:type==='training-return'?14:undefined}));
 assert.equal(achievementWall(rows,'milestone').cards.length,11);assert.equal(achievementWall(rows,'milestone').cards.filter(card=>card.earned).length,6);
 const html=[0,1,2].map(page=>renderAchievementWall(rows,{category:'milestone',page})).join('');
 for(const type of types){const definition=achievementDefinitions.find(item=>item.id===type);assert.match(html,new RegExp(definition.name));}
 assert.match(renderAchievementDetails(rows,'cycle-complete'),/肩背方案 · 第 1 轮/);
 assert.match(renderAchievementDetails(rows,'training-return'),/间隔 14 天/);
 const next=renderAchievementWall([{id:'achievement-summary',data:{sessions:100,weeks:52,cycles:0}}]);assert.match(next,/cycle-pending.svg/);assert.match(next,/0 \/ 1 轮/);
});

test('milestone catalog shows every badge, with official awards as the only source of earned state',()=>{
 const catalog=achievementDefinitions.filter(definition=>definition.category==='milestone');
 const summary={id:'achievement-summary',data:{sessions:100,weeks:52,cycles:1}};
 const pending=achievementWall([summary],'milestone').cards;
 assert.deepEqual(pending.map(card=>card.id),catalog.map(definition=>definition.id));
 assert(pending.every(card=>card.earned===false&&card.latest===null&&card.history.length===0));
 assert.equal(achievementWall([summary]).cards.length,0);
 assert.equal(achievementWall([summary],'weekly').cards.length,0);
 const rows=[summary,award('first-training')];
 const mixed=achievementWall(rows,'milestone').cards;
 assert.equal(mixed.filter(card=>card.earned).length,1);
 assert.equal(mixed[0].latest,'2026-10-05');
 assert.deepEqual(mixed.map(card=>card.id),pending.map(card=>card.id));
 assert(achievementWall([summary,{...rows[1],deleted:true}],'milestone').cards.every(card=>!card.earned));
});

test('unearned milestones use pending artwork and conditions without invented earned dates',()=>{
 const empty=renderAchievementWall([],{category:'milestone'});
 assert.equal((empty.match(/achievement-stamp is-unearned/g)||[]).length,4);
 assert.doesNotMatch(empty,/<time|is-earned|undefined|null/);
 assert.match(empty,/first-pending.svg/);
 const mixed=renderAchievementWall([award('first-training')],{category:'milestone'});
 assert.equal((mixed.match(/achievement-stamp is-earned/g)||[]).length,1);
 assert.equal((mixed.match(/achievement-stamp is-unearned/g)||[]).length,3);
 assert.match(mixed,/first.svg/);assert.match(mixed,/2026\.10\.05 获得/);
 const pending=renderAchievementDetails([],'weeks-52');
 assert.match(pending,/seasons-pending.svg/);assert.match(pending,/累计达成 52 周/);
 assert.match(pending,/未获得/);assert.doesNotMatch(pending,/<article>|<time|获得记录/);
 const undone=renderAchievementDetails([{...award('first-training'),deleted:true}],'first-training');
 assert.match(undone,/first-pending.svg/);assert.doesNotMatch(undone,/<article>|<time/);
});
