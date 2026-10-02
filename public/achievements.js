import {validateDate} from './schedule.js?v=12';
import {exercises,exerciseUsesSeconds} from './domain.js?v=11';

const exerciseIds=new Set(exercises.map(exercise=>exercise.id));
export function beijingDate(value=new Date()) {
 const time=new Date(value).getTime();if(!Number.isFinite(time))throw new Error('成就核算时间无效。');
 return new Date(time+8*3600000).toISOString().slice(0,10);
}
export function trainingRecord(record) {
 if(!record||record.deleted||!['calendar-task','schedule'].includes(record.kind)||record.data?.rest||record.data?.daySnapshot?.rest||(record.data?.taskType&&record.data.taskType!=='training'))return false;
 try{validateDate(record.data.date);}catch{return false;}return true;
}
function validAction(action,maxSets) {
 if(!exerciseIds.has(action?.exerciseId)||!Number.isInteger(action.sets)||action.sets<1||action.sets>maxSets)return false;
 const match=/^(\d+)(?:\s*[-–—~～至]\s*(\d+))?\s*(次|秒|s|sec|seconds)?(?:\s*\/\s*(?:侧|边))?$/i.exec(String(action.reps??'').trim());
 if(!match)return false;const low=Number(match[1]),high=Number(match[2]||match[1]),max=exerciseUsesSeconds(action.exerciseId)?600:100;
 return low>=1&&high>=low&&high<=max;
}
export function validTrainingCompletion(record) {
 if(!trainingRecord(record))return false;
 const data=record.data,items=data.daySnapshot?.exercises;
 if(!Array.isArray(items)||!items.length||!items.every(item=>validAction(item,12)))return false;
 if(data.completed===true)return Array.isArray(data.actual)&&data.actual.length===items.length&&data.actual.every((item,i)=>item.exerciseId===items[i].exerciseId&&validAction(item,30));
 return items.every(item=>item.completed===true);
}
export const achievementDefinitions=Object.freeze([
 {id:'first-training',name:'初次完成',condition:'完成第 1 次训练',metric:'sessions',target:1,icon:'first',category:'milestone'},
 {id:'weekly-training',name:'一周达成',condition:'完成当周全部训练，周结束后结算',icon:'week',category:'weekly'},
 {id:'weeks-4',name:'四周积累',condition:'累计达成 4 周',metric:'weeks',target:4,icon:'sprout',category:'milestone'},
 {id:'weeks-12',name:'自成节奏',condition:'累计达成 12 周',metric:'weeks',target:12,icon:'rhythm',category:'milestone'},
 {id:'weeks-24',name:'长久同行',condition:'累计达成 24 周',metric:'weeks',target:24,icon:'tree',category:'milestone'},
 {id:'sessions-50',name:'五十次抵达',condition:'累计完成 50 次训练',metric:'sessions',target:50,icon:'mountain',category:'milestone'},
].map(Object.freeze));
export function earnedWeeklyAchievements(records) {
 const weeks=new Map();
 for(const record of records){
  if(record.deleted||record.kind!=='achievement'||record.data?.type!=='weekly-training'||record.data.ruleVersion!==2)continue;
  try{for(const field of ['weekStart','weekEnd','earnedDate'])validateDate(record.data[field]);}catch{continue;}
  if(!weeks.has(record.data.weekStart))weeks.set(record.data.weekStart,record);
 }
 return [...weeks.values()].sort((a,b)=>b.data.weekStart.localeCompare(a.data.weekStart));
}
export function achievementWall(records,category='all') {
 const summary=records.find(record=>record.id==='achievement-summary'&&!record.deleted)?.data||{sessions:0,weeks:0};
 const cards=achievementDefinitions.flatMap(definition=>{
  if(category!=='all'&&category!==definition.category)return [];
  if(definition.id==='weekly-training')return earnedWeeklyAchievements(records).map(record=>({...definition,id:record.id,type:definition.id,history:[record],latest:record.data.earnedDate,weekStart:record.data.weekStart,weekEnd:record.data.weekEnd}));
  const history=records.filter(record=>!record.deleted&&record.kind==='achievement'&&record.data?.ruleVersion===2&&record.data.type===definition.id).sort((a,b)=>b.data.earnedAt.localeCompare(a.data.earnedAt));
  return history.length?[{...definition,type:definition.id,history,latest:history[0].data.earnedDate}]:[];
 }).sort((a,b)=>b.latest.localeCompare(a.latest)||achievementDefinitions.findIndex(d=>d.id===a.type)-achievementDefinitions.findIndex(d=>d.id===b.type));
 const goals=achievementDefinitions.filter(d=>d.target&&Number(summary[d.metric]||0)<d.target);
 goals.sort((a,b)=>(Number(summary[b.metric]||0)/b.target)-(Number(summary[a.metric]||0)/a.target));
 return {cards,summary,next:goals[0]?{...goals[0],value:Number(summary[goals[0].metric]||0)}:null};
}
