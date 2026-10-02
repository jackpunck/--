import {rememberAchievementCycle,achievementCycleMembership,completedAchievementCycles} from './achievement-cycles.mjs';
import {weekDates,addDays} from '../public/schedule.js';
import {beijingDate,trainingRecord,validTrainingCompletion,achievementDefinitions} from '../public/achievements.js';

export const newAchievementState=()=>({version:3,sessions:{},weeks:{},legacy:{},cycles:{}});
const midnight=date=>new Date(date+'T00:00:00+08:00').toISOString();
export function settleAchievementWeeks(state,now) {
 const today=beijingDate(now),starts=new Set([...Object.values(state.sessions).map(s=>weekDates(s.date)[0]),...Object.keys(state.legacy)]);
 for(const start of starts){
  if(state.weeks[start])continue;
  const end=addDays(start,6);if(end>=today)continue;
  const sessions=Object.values(state.sessions).filter(s=>s.date>=start&&s.date<=end);
  const members=sessions.filter(s=>!s.archived||s.completed).map(s=>({id:s.id,date:s.date,completed:s.completed&&s.completedAt<midnight(addDays(end,1))}));
  // A legacy stamp with surviving detail must pass the same checks as any other week.
  state.weeks[start]={start,end,members,legacy:!sessions.length?state.legacy[start]||null:null};
 }
}
export function applyTrainingEvent(state,record,at) {
 settleAchievementWeeks(state,at);
 if(record.kind==='training-cycle'){rememberAchievementCycle(state,record);return;}
 const previous=Object.hasOwn(state.sessions,record.id)?state.sessions[record.id]:null;
 if(!trainingRecord(record)){
  if(previous)previous.archived=true;
  return;
 }
 const data=record.data,valid=validTrainingCompletion(record)&&data.date<=beijingDate(at);
 // A prematurely completed future record stays ineligible until the user changes it.
 const blockedFuture=!!previous?.blockedFuture&&validTrainingCompletion(record);
 const completed=valid&&!blockedFuture;
 const completedOnce=!!(previous?.completedOnce||previous?.completedAt),prior=completed&&!completedOnce?Object.values(state.sessions).filter(session=>(session.lastConfirmedAt||session.completedAt)&&session.id!==record.id).sort((a,b)=>(b.lastConfirmedAt||b.completedAt).localeCompare(a.lastConfirmedAt||a.completedAt))[0]:null;
 const gap=prior&&(!state.returnHistorySince||Date.parse(prior.lastConfirmedAt||prior.completedAt)>=Date.parse(state.returnHistorySince))?Date.parse(at)-Date.parse(prior.lastConfirmedAt||prior.completedAt):0;
 const returnEvidence=previous?.returnEvidence||(gap>=14*86400000?{previousId:prior.id,previousConfirmedAt:prior.lastConfirmedAt||prior.completedAt,earnedAt:at,gapDays:Math.floor(gap/86400000)}:null);
 Object.defineProperty(state.sessions,record.id,{enumerable:true,configurable:true,writable:true,value:{...achievementCycleMembership(record),lastConfirmedAt:completed&&!previous?.completed?at:previous?.lastConfirmedAt||previous?.completedAt||null,completedOnce:completedOnce||completed,returnEvidence,id:record.id,date:data.date,title:String(data.title||data.daySnapshot?.name||'训练').slice(0,80),archived:false,completed,blockedFuture:(validTrainingCompletion(record)&&data.date>beijingDate(at))||blockedFuture,completedAt:completed?(previous?.completed?previous.completedAt:at):null}});
}
export function achievementRecords(state) {
 const completed=Object.values(state.sessions).filter(s=>s.completed).sort((a,b)=>a.completedAt.localeCompare(b.completedAt)||a.id.localeCompare(b.id));
 const weeks=Object.values(state.weeks).filter(w=>w.legacy||(w.members.length&&w.members.every(m=>m.completed&&state.sessions[m.id]?.completed&&state.sessions[m.id].date===m.date))).sort((a,b)=>a.start.localeCompare(b.start));
 const records=weeks.map(w=>({id:'achievement:week:'+w.start,kind:'achievement',data:{type:'weekly-training',ruleVersion:2,weekStart:w.start,weekEnd:w.end,earnedDate:addDays(w.end,1),earnedAt:midnight(addDays(w.end,1)),trainingCount:w.legacy?.trainingCount||w.members.length,source:w.legacy?'legacy':'confirmed-history',taskIds:w.members.map(m=>m.id),training:w.members.map(m=>({id:m.id,date:m.date,title:state.sessions[m.id]?.title||'训练'}))}}));
 const cycles=completedAchievementCycles(state);
 for(const def of achievementDefinitions.filter(d=>d.target)){
  const evidence=def.metric==='weeks'?records.filter(r=>r.data.type==='weekly-training'):def.metric==='cycles'?cycles:completed;
  if(evidence.length<def.target)continue;
  const target=evidence[def.target-1],earnedAt=def.metric==='weeks'?target.data.earnedAt:def.metric==='cycles'?target.earnedAt:target.completedAt;
  const detail=def.metric==='cycles'?{cycleId:target.cycleId,planName:target.planName,round:target.round,training:target.members.map(session=>({id:session.id,date:session.date,title:session.title}))}:{};
  records.push({id:'achievement:milestone:'+def.id,kind:'achievement',data:{type:def.id,ruleVersion:2,earnedAt,earnedDate:beijingDate(earnedAt),metric:def.metric,target:def.target,evidenceIds:def.metric==='cycles'?target.members.map(session=>session.id):evidence.slice(0,def.target).map(r=>r.id),...detail}});
 }
 const returned=completed.filter(session=>session.returnEvidence&&(!state.returnHistorySince||Date.parse(session.returnEvidence.previousConfirmedAt)>=Date.parse(state.returnHistorySince))&&Object.hasOwn(state.sessions,session.returnEvidence.previousId)&&state.sessions[session.returnEvidence.previousId].completed).sort((a,b)=>a.returnEvidence.earnedAt.localeCompare(b.returnEvidence.earnedAt)||a.id.localeCompare(b.id))[0];
 if(returned){
  const evidence=returned.returnEvidence,previous=state.sessions[evidence.previousId];
  records.push({id:'achievement:milestone:training-return',kind:'achievement',data:{type:'training-return',ruleVersion:2,earnedAt:evidence.earnedAt,earnedDate:beijingDate(evidence.earnedAt),gapDays:evidence.gapDays,previousConfirmedAt:evidence.previousConfirmedAt,evidenceIds:[previous.id,returned.id],training:[previous,returned].map(session=>({id:session.id,date:session.date,title:session.title}))}});
 }
 records.push({id:'achievement-summary',kind:'achievement-summary',data:{ruleVersion:2,sessions:completed.length,weeks:weeks.length,cycles:cycles.length}});
 return records;
}
