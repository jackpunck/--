import {calculateNutrition,validateProfile} from './domain.js';
import {validateDate,addDays,trainingDayType} from './schedule.js';

// Application control settings, not clinically validated weight predictions.
// A fixed 7700 kcal/kg is used only as a short-window reference/conversion.
export const NUTRITION_FEEDBACK_POLICY = Object.freeze({
  cycleDays:14, maxWindowDays:21, kcalPerKg:7700, gain:.25,
  deadbandKg:.2, maxStepKcal:100, maxOffsetKcal:300, maxOffsetFraction:.15,
  maxWeightChangeFractionPer14Days:.03,
});
const daysBetween=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000;
const rounded=(value,digits=3)=>Number(value.toFixed(digits));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const settingsKey=profile=>JSON.stringify([profile.age,profile.sex,profile.height,profile.goal,Number(profile.activity??1/.7),!!profile.pregnant,!!profile.breastfeeding]);
const validDate=value=>{try{return validateDate(value);}catch{return null;}};

function phaseHistory(records,date) {
  const daily=new Map();
  // Multiple entries on one day are edits, not independent weight samples.
  for(const record of [...records].filter(record=>record&&!record.deleted).sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||''))||String(a.id||'').localeCompare(String(b.id||'')))) {
    const data=record.data;
    if(validDate(data?.date)&&data.date<=date)daily.set(data.date,data);
  }
  return [...daily.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function offsetBounds(profile) {
  const targets=['training','rest'].map(type=>calculateNutrition(profile,type));
  const allowance=Math.min(NUTRITION_FEEDBACK_POLICY.maxOffsetKcal,...targets.map(n=>Math.floor(n.baseKcal*NUTRITION_FEEDBACK_POLICY.maxOffsetFraction)));
  const lower=Math.max(-allowance,...targets.map(n=>1200-n.baseKcal),targets[0].bmi<18.5?0:-Infinity);
  return {lower,upper:allowance};
}

/** Replays non-overlapping cycles from dated profile snapshots. This is derived
 * state: refreshing, retrying and syncing cannot apply a cycle twice. Editing
 * or deleting a source measurement deterministically recomputes its effects.
 * The reference trajectory excludes prior corrections (otherwise a constant
 * estimation bias would be integrated repeatedly instead of converging).
 */
export function nutritionFeedback({profile,phases=[],tasks=[],date}) {
  validateDate(date);
  const policy=NUTRITION_FEEDBACK_POLICY, history=[];
  let anchor=null,offset=0,lastReason=null;
  let validated;
  try {validated=validateProfile(profile);calculateNutrition(validated,'rest');}
  catch(error){return {status:'unavailable',adjustmentKcal:0,history:[],message:error.message};}
  for(const phase of phaseHistory(phases,date)) {
    let point;
    try {point={...validateProfile(phase),date:phase.date};calculateNutrition(point,'rest');}
    catch {anchor=null;offset=0;lastReason='资料不适用，等待新的有效体重记录。';history.push({date:phase.date,status:'reset',reason:lastReason});continue;}
    if(!anchor||settingsKey(point)!==settingsKey(anchor)) {
      lastReason=anchor?'目标或活动等资料改变，重新积累两周数据。':null;
      if(anchor){offset=0;history.push({date:point.date,status:'reset',reason:lastReason});}
      anchor=point;continue;
    }
    const span=daysBetween(anchor.date,point.date);
    if(span<policy.cycleDays)continue;
    if(span>policy.maxWindowDays) {
      anchor=point;lastReason='两次周期体重记录相隔超过 21 天，保留现有修正并重新积累两周数据。';
      history.push({date:point.date,status:'reset',reason:lastReason});continue;
    }
    const actualChangeKg=point.weight-anchor.weight;
    if(Math.abs(actualChangeKg)/anchor.weight*14/span>policy.maxWeightChangeFractionPer14Days) {
      anchor=point;lastReason='体重变化较大，保留现有修正并暂停本次校准；请核对测量条件和记录。';
      history.push({date:point.date,status:'reset',reason:lastReason});continue;
    }
    const base=Object.fromEntries(['training','rest'].map(type=>[type,calculateNutrition(anchor,type)]));
    let referenceEnergy=0;
    for(let index=0;index<span;index++) {
      const target=base[trainingDayType(addDays(anchor.date,index),tasks)];
      referenceEnergy+=target.baseKcal-target.tdee;
    }
    const theoreticalChangeKg=referenceEnergy/policy.kcalPerKg;
    const errorKg=actualChangeKg-theoreticalChangeKg;
    const requestedStep=Math.abs(errorKg)<=policy.deadbandKg+1e-9?0:Math.round(clamp(-policy.gain*errorKg*policy.kcalPerKg/span,-policy.maxStepKcal,policy.maxStepKcal));
    const bounds=offsetBounds(point),previousOffset=offset;
    offset=Math.round(clamp(offset+requestedStep,bounds.lower,bounds.upper));
    history.push({date:point.date,startDate:anchor.date,days:span,status:'evaluated',startWeight:anchor.weight,endWeight:point.weight,
      actualChangeKg:rounded(actualChangeKg),theoreticalChangeKg:rounded(theoreticalChangeKg),errorKg:rounded(errorKg),
      previousOffsetKcal:previousOffset,stepKcal:offset-previousOffset,adjustmentKcal:offset,
      limited:offset-previousOffset!==requestedStep||Math.abs(requestedStep)===policy.maxStepKcal});
    anchor=point;lastReason=null;
  }
  if(anchor&&settingsKey(anchor)!==settingsKey(validated)) {
    anchor=null;offset=0;lastReason='当前资料与周期起点不同，请记录当前体重以启动新周期。';
  }
  const expired=anchor&&daysBetween(anchor.date,date)>policy.maxWindowDays;
  if(expired){lastReason='体重记录已超过 21 天，保留现有目标；请补记当前体重后重新积累两周数据。';}
  const bounds=offsetBounds(validated);offset=Math.round(clamp(offset,bounds.lower,bounds.upper));
  const nextDate=anchor?addDays(anchor.date,policy.cycleDays):null;
  return {status:!anchor?'waiting-baseline':expired?'stale':date>=nextDate?'due':history.at(-1)?.status==='evaluated'?'active':'collecting',
    adjustmentKcal:offset,anchorDate:anchor?.date??null,nextDate,history:history.slice(-12),cycleCount:history.filter(item=>item.status==='evaluated').length,
    message:lastReason||(!anchor?'记录当前体重后开始两周观察。':date>=nextDate?'已满两周，记录当前体重后自动校准下一周期。':`下一次校准参考日期：${nextDate}。`),
    basis:'理论变化按未校准的饮食目标与训练日历估算，假设按目标执行；偏差也可能来自水分、执行差异及活动变化，不等同于代谢误差。'};
}

export function validateNutritionFeedbackSettings(input) {
  validateDate(input?.date);
  if(typeof input.enabled!=='boolean')throw new Error('请选择是否应用自动校准。');
  const manualAdjustmentKcal=Number(input.manualAdjustmentKcal);
  if(!Number.isInteger(manualAdjustmentKcal)||Math.abs(manualAdjustmentKcal)>300)throw new Error('额外热量修正须为 -300 到 300 之间的整数。');
  return {date:input.date,enabled:input.enabled,manualAdjustmentKcal};
}

export function nutritionForDate({profile,phases=[],tasks=[],settings=[],date,today}) {
  validateDate(date);validateDate(today);
  const cutoff=date<today?date:today;
  // Use dated profiles when available; never apply a future calibration to an
  // earlier day. Legacy accounts without snapshots retain their base estimate.
  const effectiveProfile=date<today?(phaseHistory(phases,cutoff).at(-1)||profile):profile;
  const feedback=nutritionFeedback({profile:effectiveProfile,phases,tasks,date:cutoff});
  let preference={enabled:true,manualAdjustmentKcal:0};
  for(const entry of phaseHistory(settings,cutoff)) {
    try {preference=validateNutritionFeedbackSettings(entry);}catch {/* Ignore invalid imported settings. */}
  }
  feedback.automaticAdjustmentKcal=feedback.adjustmentKcal;
  feedback.enabled=preference.enabled;
  feedback.manualAdjustmentKcal=preference.manualAdjustmentKcal;
  const requested=(preference.enabled?feedback.automaticAdjustmentKcal:0)+preference.manualAdjustmentKcal;
  if(feedback.status!=='unavailable') {
    const bounds=offsetBounds(effectiveProfile);
    feedback.adjustmentKcal=Math.round(clamp(requested,bounds.lower,bounds.upper));
    feedback.limited=feedback.adjustmentKcal!==requested;
  }
  const nutrition={};
  for(const type of ['training','rest']) {
    try {nutrition[type]=calculateNutrition(effectiveProfile,type,feedback.adjustmentKcal);}
    catch(error){nutrition[type]={kcal:0,protein:0,carbs:0,fat:0,bmr:0,tdee:0,error:error.message};}
  }
  return {nutrition,feedback};
}
