import {validateDate} from '../public/schedule.js';

/** Keep the original requirements even if the live rule is edited or removed. */
export function rememberAchievementCycle(state,record) {
 if(record.kind!=='training-cycle'||record.deleted)return;
 const data=record.data,days=data?.plan?.days;
 if(typeof data?.id!=='string'||!data.id||typeof data.plan?.planVersion!=='string'||!data.plan.planVersion||!Array.isArray(days)||!days.length||days.length>366)return;
 if(days.some(day=>!day||typeof day!=='object'||Array.isArray(day)||(day.rest!==undefined&&typeof day.rest!=='boolean')||(!day.rest&&(!Array.isArray(day.exercises)||!day.exercises.length))))return;
 if(data.weekdays!==undefined&&(!Array.isArray(data.weekdays)||!data.weekdays.length||data.weekdays.some(day=>!Number.isInteger(day)||day<1||day>7)||new Set(data.weekdays).size!==data.weekdays.length))return;
 try{validateDate(data.startDate);}catch{return;}
 state.cycles??={};if(Object.hasOwn(state.cycles,data.id))return;
 const ordered=data.weekdays?days.filter(day=>!day.rest):days;
 const slots=ordered.flatMap((day,offset)=>day.rest?[]:[{offset,dayId:day.id}]);
 if(!slots.length||slots.some(slot=>typeof slot.dayId!=='string'||!slot.dayId)||new Set(slots.map(slot=>slot.dayId)).size!==slots.length)return;
 const definition={id:data.id,planVersion:data.plan.planVersion,name:String(data.plan.name||'训练方案').slice(0,80),span:ordered.length,slots};
 Object.defineProperty(state.cycles,data.id,{value:definition,enumerable:true,writable:true,configurable:true});
}
export function achievementCycleMembership(record) {
 const data=record.data,prefix=typeof data?.cycleId==='string'?'task:cycle:'+data.cycleId+':':null;
 const suffix=prefix&&record.id.startsWith(prefix)?record.id.slice(prefix.length):'';
 const offset=/^(0|[1-9]\d*)$/.test(suffix)?Number(suffix):NaN;
 if(!Number.isSafeInteger(offset)||offset<0||typeof data.dayId!=='string'||typeof data.planVersion!=='string'||(data.daySnapshot?.id&&data.daySnapshot.id!==data.dayId))return {cycleId:null,cycleOffset:null,cycleDayId:null,cyclePlanVersion:null};
 return {cycleId:data.cycleId,cycleOffset:offset,cycleDayId:data.dayId,cyclePlanVersion:data.planVersion};
}
export function completedAchievementCycles(state) {
 const rounds=new Map();
 for(const session of Object.values(state.sessions)){
  const rule=Object.hasOwn(state.cycles||{},session.cycleId)?state.cycles[session.cycleId]:null;
  if(!rule||session.cyclePlanVersion!==rule.planVersion||!Number.isSafeInteger(session.cycleOffset))continue;
  const round=Math.floor(session.cycleOffset/rule.span),slot=session.cycleOffset%rule.span;
  if(!rule.slots.some(item=>item.offset===slot&&item.dayId===session.cycleDayId))continue;
  const key=JSON.stringify([rule.id,round]);if(!rounds.has(key))rounds.set(key,{rule,round,sessions:new Map()});
  rounds.get(key).sessions.set(slot,session);
 }
 return [...rounds.values()].flatMap(({rule,round,sessions})=>{
  const members=rule.slots.map(slot=>sessions.get(slot.offset));
  if(members.some(session=>!session?.completed))return [];
  return [{id:rule.id+':'+round,cycleId:rule.id,planName:rule.name,round:round+1,members,earnedAt:members.map(session=>session.completedAt).sort().at(-1)}];
 }).sort((a,b)=>a.earnedAt.localeCompare(b.earnedAt)||a.id.localeCompare(b.id));
}
