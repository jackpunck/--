import {exercises, MAX_TRAINING_EXERCISES} from './domain.js?v=11';

function chineseNumber(value) {
  const digits='零一二三四五六七八九';
  if(value<10)return digits[value];
  if(value<100)return (value<20?'':digits[Math.floor(value/10)])+'十'+(value%10?digits[value%10]:'');
  if(value<1000)return digits[Math.floor(value/100)]+'百'+(value%100?(value%100<10?'零':'')+(value%100>=10&&value%100<20?'一':'')+chineseNumber(value%100):'');
  return String(value);
}

export function createLibraryTemplate(records,draft,id,createdAt) {
  const sequence=Math.max(0,...records.filter(r=>!r.deleted).map(r=>Number(r.id==='plan-library-sequence'?r.data?.value:r.kind==='training-template'?r.data?.libraryNumber:0)||0))+1;
  const data={...structuredClone(draft),name:'方案'+chineseNumber(sequence),libraryNumber:sequence,libraryRevision:id,createdAt};
  delete data.planVersion;delete data.confirmationVersion;delete data.confirmedAt;delete data.libraryTemplateId;
  return [{id,kind:'training-template',data},{id:'plan-library-sequence',kind:'library-settings',data:{value:sequence}}];
}

/** Stable migration IDs include tombstones so deleted templates never reappear. */
export function libraryMigration(records,createdAt) {
  const working=new Map(records.map(r=>[r.id,r])),changes=new Map();
  for(const sourceId of ['active-plan','plan-draft']){
    const source=working.get(sourceId);
    if(!source||source.deleted||!source.data?.days?.length||source.data.libraryTemplateId)continue;
    const id=sourceId==='plan-draft'?'template:legacy-draft':`template:legacy-active:${encodeURIComponent(source.data.planVersion||'original')}`;
    if(!working.has(id)){
      const entries=createLibraryTemplate([...working.values()],source.data,id,createdAt);
      entries[0].data.name=source.data.name?.trim()||entries[0].data.name;
      for(const entry of entries){working.set(entry.id,entry);changes.set(entry.id,entry);}
    }
    if(sourceId==='plan-draft')changes.set(sourceId,{id:sourceId,kind:source.kind,deleted:true});
  }
  return [...changes.values()];
}

/** Validate a saved template, then make the independently editable schedule snapshot. */
export function libraryPlan(record) {
  if(!record||record.deleted||record.kind!=='training-template')throw new Error('这份方案已被删除，请重新打开方案库。');
  const data=structuredClone(record.data);
  data.name=String(data.name||'').trim();
  if(!data.name||data.name.length>80)throw new Error('方案名称需为 1–80 个字。');
  if(!Array.isArray(data.days)||!data.days.length||!data.days.some(day=>!day.rest))throw new Error('方案至少需要一个训练日。');
  const ids=new Set();
  for(const day of data.days){
    if(!day.id||ids.has(day.id)||!day.name?.trim())throw new Error('训练日信息不完整，请编辑方案。');
    ids.add(day.id);
    if(day.rest)continue;
    if(!Array.isArray(day.exercises)||!day.exercises.length||day.exercises.length>MAX_TRAINING_EXERCISES)throw new Error(`${day.name}需要 1–${MAX_TRAINING_EXERCISES} 个动作，请先编辑方案。`);
    for(const exercise of day.exercises){
      exercise.reps=String(exercise.reps??'').trim();
      if(!exercises.some(item=>item.id===exercise.exerciseId)||!Number.isInteger(exercise.sets)||exercise.sets<1||exercise.sets>12||!exercise.reps||exercise.reps.length>30)throw new Error('请检查方案中的动作、组数和次数。');
      delete exercise.completed;
    }
  }
  for(const key of ['scheduleDate','libraryNumber','createdAt','confirmationVersion','confirmedAt'])delete data[key];
  data.planVersion=data.libraryRevision||record.id;delete data.libraryRevision;
  data.libraryTemplateId=record.id;
  return data;
}
