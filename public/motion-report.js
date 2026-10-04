// Shared by browser and server. No DOM, media, model, or network dependencies.
export const MAX_MOTION_ASSESSMENT_BYTES = 1024 * 1024;

export function validateMotionAssessmentSize(report) {
  if(new TextEncoder().encode(JSON.stringify(report)).byteLength>MAX_MOTION_ASSESSMENT_BYTES)throw new Error('单份动作评估报告超过 1 MB，尚未保存。请缩短视频后重新分析。');
}

const pickFields=(value,keys)=>value&&typeof value==='object'?Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])):{};
const qualityFields=['totalFrames','validFrames','usableRatio','sourceFps','targetCoverage','reasons'];
const actionFields=['exerciseId','name','family','status','confidence','source','evidenceTimes','evidence'];
function savedAction(value){const action=pickFields(value,actionFields);if(value?.observations)action.observations=pickFields(value.observations,['equipment','support','movement','laterality','assistance','evidence','evidenceTimes']);return action;}

/** Persist only the AI conclusion and its evidence references. Raw observations
 * are request data, not a second local judgement or a permanent video record. */
export function buildMotionAssessmentReport(result,{file,pipeline,createdAt=new Date().toISOString()}) {
  const report={version:'motion-report-v1',...pickFields(result,['exerciseId','exerciseName','exerciseFamily','recognitionSource']),quality:pickFields(result.quality,qualityFields),createdAt,
    video:{name:file.name,size:file.size,width:pipeline.width,height:pipeline.height,duration:pipeline.duration},
    analysis:pickFields(pipeline,['modelVersion','sampleFps','sourceFps','decoder','elapsedMs'])};
  if(result.coach){
    const source=result.coach,coach=pickFields(source,['version','mode','model','provider','limitations']);
    coach.action=savedAction(source.action);
    if(source.selectionCheck)coach.selectionCheck=pickFields(source.selectionCheck,['status','evidenceTimes','evidence']);
    if(Array.isArray(source.candidates))coach.candidates=source.candidates.map(savedAction);
    if(source.verdict)coach.verdict=pickFields(source.verdict,['status','summary']);
    if(Array.isArray(source.feedback))coach.feedback=source.feedback.map(item=>pickFields(item,['title','status','source','frameIndices','evidenceTimes','analysisPaths','time','evidence','correction','priority']));
    if(source.coverage)coach.coverage=pickFields(source.coverage,['complete','strategy','sourceFrameCount','frameCount','reviewedFrameCount','imageCount','reviewedImageCount','temporalChecks','measurementCount','reviewedMeasurementCount','summarizedMeasurementCount','dataBatches','modelCalls']);
    if(source.timing)coach.timing=pickFields(source.timing,['providerMs','totalMs']);
    report.coach=coach;
  }
  return structuredClone(report);
}
