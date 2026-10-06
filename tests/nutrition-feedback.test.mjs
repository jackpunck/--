import test from 'node:test';
import assert from 'node:assert/strict';
import {nutritionFeedback,nutritionForDate,validateNutritionFeedbackSettings} from '../public/nutrition-feedback.js';
import {calculateNutrition,suggestRecipe} from '../public/domain.js';
import {addDays} from '../public/schedule.js';
import {compute} from '../server/compute.mjs';
import {nutritionFeedbackView} from '../public/nutrition-feedback-view.js';
const profile={age:30,sex:'male',height:175,weight:70,goal:'maintain',activity:1.375};
const start='2026-01-01',end=addDays(start,14);
const phase=(date,weight=70,extra={})=>({id:date,kind:'phase',data:{...profile,date,weight,...extra}});
const setting=(date,manualAdjustmentKcal=0,enabled=true)=>({id:date,kind:'nutrition-feedback-settings',data:{date,manualAdjustmentKcal,enabled}});
const run=(phases,extra={})=>nutritionFeedback({profile:phases.at(-1)?.data||profile,phases,date:phases.at(-1)?.data.date||start,...extra});

test('waits for a full cycle and requires an endpoint measurement',()=>{
 assert.equal(run([]).status,'waiting-baseline');
 assert.equal(run([phase(start),phase(addDays(start,13),71)]).adjustmentKcal,0);
 const due=run([phase(start)],{date:end});assert.equal(due.status,'due');assert.equal(due.cycleCount,0);
});
test('negative feedback has correct sign for maintain, lose and gain',()=>{
 assert.equal(run([phase(start),phase(end,71)]).adjustmentKcal,-100);
 assert.equal(run([phase(start),phase(end,69)]).adjustmentKcal,100);
 assert.ok(run([phase(start,70,{goal:'lose'}),phase(end,70,{goal:'lose'})]).adjustmentKcal<0);
 assert.ok(run([phase(start,70,{goal:'gain'}),phase(end,70,{goal:'gain'})]).adjustmentKcal>0);
 assert.equal(run([phase(start),phase(end,70.1)]).adjustmentKcal,0);
 assert.equal(run([phase(start),phase(end,70.2)]).adjustmentKcal,0);
});
test('daily records form non-overlapping windows; duplicate dates, refresh and deletion are deterministic',()=>{
 const phases=Array.from({length:29},(_,i)=>phase(addDays(start,i),70+i/28));
 const result=run(phases);assert.equal(result.cycleCount,2);
 assert.deepEqual(run([...phases].reverse(),{profile:phases.at(-1).data,date:phases.at(-1).data.date}),result);
 const duplicate={...phase(end,70.5),id:'edit',updatedAt:'2026-02-01'};
 assert.deepEqual(run([...phases,duplicate],{profile:phases.at(-1).data,date:phases.at(-1).data.date}),result);
 assert.deepEqual(run(phases),result);
 const deleted=run([phase(start),{...phase(end,71),deleted:true}],{profile,date:end});assert.equal(deleted.cycleCount,0);
});
test('gaps and unusual weight jumps preserve existing correction but reset the observation window',()=>{
 const phases=[phase(start),phase(end,71)];
 const stale=run(phases,{date:addDays(end,22)});assert.equal(stale.status,'stale');assert.equal(stale.adjustmentKcal,-100);
 const gap=run([...phases,phase(addDays(end,22),71)]);assert.equal(gap.adjustmentKcal,-100);assert.equal(gap.cycleCount,1);
 const jump=run([...phases,phase(addDays(end,14),75)]);assert.equal(jump.adjustmentKcal,-100);assert.equal(jump.history.at(-1).status,'reset');
});
test('goal or activity changes restart learning; unsafe profiles do not calculate a target',()=>{
 const phases=[phase(start),phase(end,71),phase(addDays(end,1),71,{goal:'gain'})];
 assert.equal(run(phases).adjustmentKcal,0);
 assert.equal(run(phases).history.at(-1).status,'reset');
 assert.equal(run(phases).status,'collecting');
 assert.equal(run([phase(start),phase(end,71,{activity:1.55})]).adjustmentKcal,0);
 assert.equal(run([],{profile:{...profile,pregnant:true}}).status,'unavailable');
});
test('reference uses scheduled training days and does not include learned offsets',()=>{
 const phases=[phase(start,70,{goal:'lose'}),phase(end,70,{goal:'lose'}),phase(addDays(end,14),70,{goal:'lose'})];
 const tasks=Array.from({length:28},(_,i)=>({kind:'calendar-task',data:{date:addDays(start,i),taskType:'training'}}));
 const result=run(phases,{tasks}),base=calculateNutrition(phases[0].data,'training');
 assert.equal(result.history[0].theoreticalChangeKg,Number(((base.baseKcal-base.tdee)*14/7700).toFixed(3)));
 assert.equal(result.history[0].theoreticalChangeKg,result.history[1].theoreticalChangeKg);
});
test('constant calorie bias converges rather than accumulating indefinitely',()=>{
 const phases=[phase(start)];let offset=0,weight=70;
 for(let i=1;i<=12;i++){
   weight+=(150+offset)*14/7700;
   phases.push(phase(addDays(start,i*14),weight));offset=run(phases).adjustmentKcal;
 }
 assert.ok(offset<0&&offset>-180);assert.ok(Math.abs(150+offset)*14/7700<=.2);
 assert.equal(run(phases).history.at(-1).stepKcal,0);
});
test('cumulative correction, calorie floor and low BMI limits apply; macros follow final target',()=>{
 const phases=Array.from({length:8},(_,i)=>phase(addDays(start,i*14),70+i));
 assert.equal(run(phases).adjustmentKcal,-300);
 const low={...profile,sex:'female',age:70,height:150,weight:45,activity:1.2};
 const n=nutritionForDate({profile:low,settings:[setting(start,-300)],date:start,today:start}).nutrition.rest;
 assert.ok(n.kcal>=1200);assert.ok(Math.abs(n.kcal-n.protein*4-n.carbs*4-n.fat*9)<2);
 const thin={...profile,height:190,weight:60};
 assert.equal(nutritionForDate({profile:thin,settings:[setting(start,-300)],date:start,today:start}).feedback.adjustmentKcal,0);
});
test('dated user edits, disabled automatic corrections and bounds are respected',()=>{
 const phases=[phase(start),phase(end,71)],p=phases.at(-1).data;
 const args={profile:p,phases,settings:[setting(end,50)],date:end,today:end};
 assert.equal(nutritionForDate(args).feedback.adjustmentKcal,-50);
 assert.equal(nutritionForDate({...args,settings:[setting(end,50,false)]}).feedback.adjustmentKcal,50);
 assert.equal(nutritionForDate({...args,date:start}).feedback.adjustmentKcal,0);
 assert.equal(nutritionForDate({...args,settings:[setting(end,-300)]}).feedback.adjustmentKcal,-300);
 assert.equal(nutritionForDate({...args,settings:[setting(end,500)]}).feedback.manualAdjustmentKcal,0);
 assert.throws(()=>validateNutritionFeedbackSettings({date:end,enabled:true,manualAdjustmentKcal:301}),/300/);
 assert.throws(()=>validateNutritionFeedbackSettings({date:end,enabled:'false',manualAdjustmentKcal:0}),/是否/);
});
test('historical and future views never use measurements after their cutoff',()=>{
 const phases=[phase(start),phase(end,71),phase(addDays(end,14),72)];
 const args={profile:phases[1].data,phases,today:end};
 assert.equal(nutritionForDate({...args,date:start}).feedback.adjustmentKcal,0);
 assert.equal(nutritionForDate({...args,date:start}).nutrition.rest.baseKcal,calculateNutrition(profile,'rest').kcal);
 assert.equal(nutritionForDate({...args,date:addDays(end,30)}).feedback.adjustmentKcal,-100);
});
test('snapshot, daily advice balance and recipe use the same corrected target',()=>{
 const phases=[phase(start),phase(end,71)],settings=[setting(end,25)];
 const result=compute({operation:'snapshot',args:[{records:[{id:'profile',kind:'profile',data:phases.at(-1).data},...phases,...settings],today:end,dates:[start,end]}]});
 assert.equal(result.nutritionFeedback.adjustmentKcal,-75);
 assert.equal(result.nutrition.rest.kcal,result.advice[end].balance.kcal.target);
 assert.equal(result.nutritionByDate[start].rest.adjustmentKcal,0);
 assert.equal(result.advice[end].nutritionFeedback.adjustmentKcal,-75);
 const recipe=suggestRecipe({profile:phases.at(-1).data,adjustmentKcal:result.nutritionFeedback.adjustmentKcal});
 assert.equal(recipe.target.kcal,result.nutrition.training.kcal);
});
test('feedback view escapes imported content and shows editable settings only for current views',()=>{
 const feedback={history:[{date:start,status:'reset',reason:'<script>bad</script>'}],message:'<img>',adjustmentKcal:-50};
 const markup=nutritionFeedbackView(feedback,{kcal:2000,baseKcal:2050});
 assert.match(markup,/nutrition-feedback-form/);assert.doesNotMatch(markup,/<script>|<img>/);
 assert.doesNotMatch(nutritionFeedbackView(feedback,{},true),/nutrition-feedback-form/);
});
