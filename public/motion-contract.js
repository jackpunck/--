import {motionExercises, motionFamilies, motionCheckDefinitions, getMotionExercise, getMotionFamily} from './motion-catalog.js';

export const MOTION_COACH_VERSION = 'motion-coach-v3';
export const MOTION_COACH_LIMITS = Object.freeze({maxFrames:6, maxFrameBytes:512*1024, maxImageBytes:2*1024*1024, maxAnalysisBytes:128*1024});
export const MOTION_HARD_QUALITY_FAILURES = Object.freeze(['INVALID_DIMENSIONS','NO_POSE','TOO_FEW_FRAMES','MULTIPLE_PEOPLE','LOW_POSE_COVERAGE','LOW_TARGET_COVERAGE','LOW_SOURCE_FRAME_RATE','LOW_SOURCE_RATE','LOW_SAMPLE_RATE','SIDE_VIEW_REQUIRED','EXERCISE_HINT_CONFLICT','INSUFFICIENT_CHECK_COVERAGE','TARGET_ID_CHANGED']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = value => Math.max(0, Math.min(100, value));
const text = (value, limit=500) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0,limit) : '';
const statuses = new Set(['pass','fail','unobservable']);
const severities = new Set(['info','warning','severe']);
const confidences = new Set(['high','medium','low']);
const exercise = id => typeof id === 'string' ? getMotionExercise(id) : null;
const familyTemplate = name => typeof name === 'string' ? getMotionFamily(name)[0]||null : null;
const definition = code => typeof code === 'string' && Object.hasOwn(motionCheckDefinitions,code) ? motionCheckDefinitions[code] : null;
const evidenceObject = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key,v])=>/^[a-zA-Z][\w]{0,39}$/.test(key)&&(finite(v)||typeof v==='string'||typeof v==='boolean')).slice(0,16).map(([key,v])=>[key,typeof v==='string'?text(v,200):v])) : {};
const compactBox = value => {
  const keys=['xMin','yMin','xMax','yMax'];
  if(!value||!keys.every(key=>finite(value[key])&&value[key]>=0&&value[key]<=1)||value.xMin>=value.xMax||value.yMin>=value.yMax)return undefined;
  return Object.fromEntries(keys.map(key=>[key,value[key]]));
};
const compactSubject = value => {
  const result={};
  if(['locked','ambiguous','lost'].includes(value?.status))result.status=value.status;
  if(typeof value?.trackId==='string')result.trackId=text(value.trackId,80);
  if(finite(value?.confidence)&&value.confidence>=0&&value.confidence<=1)result.confidence=value.confidence;
  const bbox=compactBox(value?.bbox);if(bbox)result.bbox=bbox;
  return result;
};
const boundedTimes = value => [...new Set((Array.isArray(value)?value:[]).filter(time=>finite(time)&&time>=0&&time<=120))].slice(0,12);
function compactCheck(value) {
  const rule=definition(value?.code);
  if(!rule)return null;
  const status=statuses.has(value.status)?value.status:'unobservable';
  return {code:rule.code,status,severity:severities.has(value.severity)?value.severity:'info',time:finite(value.time)?value.time:null,
    evidence:evidenceObject(value.evidence),message:text(value.message),correction:text(value.correction),
    weight:rule.weight,critical:rule.critical,score:finite(value.score)?clamp(value.score):null,source:'pose',
    scope:['whole-repetition','sampled-frames','unobservable'].includes(value.scope)?value.scope:'unobservable',evidenceTimes:boundedTimes(value.evidenceTimes)};
}

/** Whitelist an analysis summary; pixel data and landmark sequences never enter it. */
export function compactMotionAnalysis(value={}) {
  const result={};
  for(const key of ['version','status','scoreStatus','summary','family','exerciseFamily','exerciseFamilyName','exerciseName','recognitionSource'])if(typeof value[key]==='string')result[key]=text(value[key],key==='summary'?2000:80);
  result.exerciseId=exercise(value.exerciseId)?.id||null;
  result.requiresVisualConfirmation=value.requiresVisualConfirmation===true;
  result.candidates=(Array.isArray(value.candidates)?value.candidates:[]).slice(0,motionExercises.length).map(item=>typeof item==='string'?{exerciseId:exercise(item)?.id}:typeof item==='object'&&item?{...evidenceObject(item),exerciseId:exercise(item.exerciseId||item.id)?.id}:null).filter(item=>item?.exerciseId);
  for(const key of ['score','observedScore','scoreCoverage','exerciseConfidence','attemptCount','qualifiedRepCount','incompleteAttemptCount'])if(finite(value[key]))result[key]=value[key];
  result.quality=evidenceObject(value.quality);
  if(Array.isArray(value.quality?.reasons))result.quality.reasons=value.quality.reasons.slice(0,20).map(v=>text(v,100));
  result.checks=(Array.isArray(value.checks)?value.checks:[]).slice(0,80).map(compactCheck).filter(Boolean);
  result.issues=(Array.isArray(value.issues)?value.issues:[]).filter(item=>item&&typeof item==='object').slice(0,40).map(item=>({code:text(item.code,80),time:finite(item.time)?item.time:null,message:text(item.message),severity:severities.has(item.severity)?item.severity:'info'}));
  result.reps=(Array.isArray(value.reps)?value.reps:[]).filter(rep=>rep&&typeof rep==='object').slice(0,40).map(rep=>({
    index:finite(rep.index)?rep.index:null,start:finite(rep.start)?rep.start:null,end:finite(rep.end)?rep.end:null,bottom:finite(rep.bottom)?rep.bottom:null,time:finite(rep.time)?rep.time:null,score:finite(rep.score)?clamp(rep.score):null,qualified:rep.qualified===true,
    metrics:evidenceObject(rep.metrics),checks:(Array.isArray(rep.checks)?rep.checks:[]).slice(0,33).map(compactCheck).filter(Boolean),issues:(Array.isArray(rep.issues)?rep.issues:[]).filter(item=>item&&typeof item==='object').slice(0,8).map(item=>({code:text(item.code,80),time:finite(item.time)?item.time:null,message:text(item.message)})),
  }));
  result.visualReviewRequests=(Array.isArray(value.visualReviewRequests)?value.visualReviewRequests:[]).filter(item=>definition(item?.code)).slice(0,33).map(item=>({code:item.code,reason:text(item.reason),evidenceTimes:boundedTimes(item.evidenceTimes)}));
  if(value.observedActiveRange)result.observedActiveRange=evidenceObject(value.observedActiveRange);
  result.evidenceFrames=(Array.isArray(value.evidenceFrames)?value.evidenceFrames:[]).slice(0,6).map(frame=>{
    const result=evidenceObject(frame);
    for(const key of ['crop','bbox','targetBox'])if(frame?.[key])result[key]=evidenceObject(frame[key]);
    if(frame?.subjectTracking)result.subjectTracking=compactSubject(frame.subjectTracking);
    if(Array.isArray(frame?.frameMappings))result.frameMappings=frame.frameMappings.slice(0,6).map(mapping=>Object.fromEntries(['requestedTime','poseTime','sourceTime'].filter(key=>finite(mapping?.[key])&&mapping[key]>=0&&mapping[key]<=120).map(key=>[key,mapping[key]])));
    return result;
  });
  if(value.targetTracking){result.targetTracking=evidenceObject(value.targetTracking);if(value.targetTracking.point)result.targetTracking.point=evidenceObject(value.targetTracking.point);}
  return result;
}

// Model prose must not bypass the deterministic score with an invented rating.
function narrative(value, fallback='') {
  const clean=text(value,1200);
  return clean.split(/(?<=[。！？\n])/).filter(sentence=>!/(?:\d+(?:\.\d+)?\s*(?:分|%|％)|\d+\s*\/\s*100|满分|准确率|标准率|合格率)/i.test(sentence)).join('').trim()||fallback;
}
const alignTime = (value, available) => finite(value) ? available.find(time=>Math.abs(time-value)<=0.05) : undefined;
const matchTimes = (values, available) => [...new Set((Array.isArray(values)?values:[]).map(time=>alignTime(time,available)).filter(finite))].slice(0,6);
const supportedFamily = value => typeof value==='string'&&Object.hasOwn(motionFamilies,value)?value:null;
const actionName = value => text(value,80).replace(/\s+/g,' ');
const assistanceValues = new Set(['none','machine','band','partner','unknown']);
const generalVisualCodes = new Set(['MOTION_CONTROL','SPINE_NEUTRAL','EQUIPMENT_SETUP']);
function compactObservations(value, available) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const evidence=narrative(value.evidence),evidenceTimes=matchTimes(value.evidenceTimes,available);
  if(evidence.replace(/\s/g,'').length<4||!evidenceTimes.length)return null;
  return {equipment:text(value.equipment,60)||null,support:text(value.support,60)||null,movement:supportedFamily(value.movement),laterality:['unilateral','bilateral'].includes(value.laterality)?value.laterality:null,
    ...(assistanceValues.has(value.assistance)?{assistance:value.assistance}:{}),evidence,evidenceTimes};
}
function matchesRecognition(exercise, observations, actionTimes) {
  const rules=exercise?.recognitionRules;
  return !rules||!!observations&&['equipment','support','laterality',...(rules.assistance?['assistance']:[])].every(key=>rules[key].includes(observations[key]))&&rules.movement===observations.movement&&observations.evidenceTimes.filter(time=>actionTimes.includes(time)).length>=2;
}
function resolveAction(value) {
  const hasName=typeof value?.name==='string', name=hasName?actionName(value.name):'';
  const catalog=hasName?motionExercises.find(item=>item.name===name)||null:exercise(value?.exerciseId);
  return {catalog,name:hasName?name:catalog?.name||'',family:catalog?.family||supportedFamily(value?.family)};
}
function matchesPullup(name,family,observations,actionTimes) {
  if(!/(?:引体|pull[ -]?up|chin[ -]?up)/i.test(name))return true;
  if(family!=='vertical-pull')return false;
  const generic=name==='引体向上（辅助情况待确认）';
  const assisted=/(?:辅助|助力|弹力带|assisted|band|machine)/i.test(name);
  return !!observations&&['pullup-bar','assisted-pullup-machine'].includes(observations.equipment)&&observations.support==='hanging'&&observations.movement==='vertical-pull'&&observations.laterality==='bilateral'
    &&(generic?observations.assistance==='unknown':assisted?['machine','band','partner'].includes(observations.assistance):observations.assistance==='none')&&observations.evidenceTimes.filter(time=>actionTimes.includes(time)).length>=2;
}
function matchesOpenPressOrRow(name,family,observations,actionTimes) {
  const movement=/(?:卧推|\bbench[ -]?press\b)/i.test(name)?'horizontal-press':/(?:划船|\brows?\b|\browing\b)/i.test(name)?'row':['horizontal-press','row'].includes(family)?family:null;
  if(!movement)return true;
  return (!family||family===movement)&&!!observations&&!!observations.equipment&&observations.equipment!=='unknown'&&!!observations.support&&observations.support!=='unknown'&&observations.movement===movement
    &&['unilateral','bilateral'].includes(observations.laterality)&&observations.evidenceTimes.filter(time=>actionTimes.includes(time)).length>=2;
}
function actionConfirmation(value,available) {
  const resolved=resolveAction(value),evidenceTimes=matchTimes(value?.evidenceTimes,available),observations=compactObservations(value?.observations,available);
  const evidence=narrative(value?.evidence||(resolved.catalog?observations?.evidence:''));
  if(value?.status!=='identified'||value?.confidence!=='high'||evidenceTimes.length<2||!resolved.name)return null;
  const rawFamily=supportedFamily(value.family);
  if(resolved.catalog&&rawFamily&&rawFamily!==resolved.catalog.family||resolved.family&&observations?.movement&&resolved.family!==observations.movement)return null;
  if(!resolved.catalog&&evidence.replace(/\s/g,'').length<4)return null;
  if(!matchesRecognition(resolved.catalog,observations,evidenceTimes)||!matchesPullup(resolved.name,resolved.family,observations,evidenceTimes)||!matchesOpenPressOrRow(resolved.name,resolved.family,observations,evidenceTimes))return null;
  return {exerciseId:resolved.catalog?.id||null,name:resolved.name,family:resolved.family,status:'identified',confidence:'high',evidenceTimes,evidence,...(observations?{observations}:{})};
}

/** Share the same name, assistance and equipment gates between merging and UI. */
export function confirmedMotionAction(coach) {
  if(coach?.mode!=='visual')return null;
  return actionConfirmation(coach.action,boundedTimes(coach.action?.evidenceTimes));
}

/** Sanitize untrusted model output against the evidence actually sent upstream. */
export function sanitizeMotionCoachResponse(value,{mode='evidence-only',analysis={},keyframes=[]}={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.checks))throw new Error('动作点评结构无效，请重试。');
  const visual=mode==='visual'&&keyframes.length>0, frameTimes=boundedTimes(keyframes.map(frame=>frame.time));
  const local=compactMotionAnalysis(analysis);
  const identified=visual?actionConfirmation(value.action,frameTimes):null;
  const action=identified||{exerciseId:null,name:'',family:null,status:'unknown',confidence:'low',evidenceTimes:[],evidence:''};
  const candidates=[];
  if(visual)for(const item of [value.action,...(Array.isArray(value.candidates)?value.candidates:[])]){
    const resolved=resolveAction(item),times=matchTimes(item?.evidenceTimes,frameTimes);
    if(!resolved.name||!times.length||candidates.some(candidate=>candidate.name===resolved.name))continue;
    const observed=compactObservations(item.observations,frameTimes),supported=matchesRecognition(resolved.catalog,observed,times)&&matchesPullup(resolved.name,resolved.family,observed,times);
    candidates.push({exerciseId:resolved.catalog?.id||null,name:resolved.name,family:resolved.family,confidence:supported&&confidences.has(item.confidence)?item.confidence:'low',evidenceTimes:times,...(observed?{observations:observed}:{})});
    if(candidates.length===3)break;
  }
  const target=identified?(exercise(identified.exerciseId)||familyTemplate(identified.family)):exercise(local.exerciseId)||familyTemplate(local.exerciseFamily);
  const allowed=identified&&!target?generalVisualCodes:new Set(target?.checks.map(check=>check.code)||[]),checks=[];
  for(const item of value.checks.slice(0,66)){
    const rule=definition(item?.code);if(!rule||!allowed.has(rule.code))continue;
    const base=local.checks.find(check=>check.code===rule.code);
    if(!visual){
      // A text model can phrase existing observations; it cannot add visual facts.
      if(!base||base.status==='unobservable')continue;
      checks.push({code:rule.code,status:base.status,severity:base.severity,time:base.time,evidence:text(base.message)||JSON.stringify(base.evidence),correction:narrative(item.correction),
        source:'pose-explanation',scope:base.scope,evidenceTimes:base.evidenceTimes});
      continue;
    }
    const times=matchTimes([...(Array.isArray(item.evidenceTimes)?item.evidenceTimes:[]),item.time],frameTimes);
    const evidence=narrative(item.evidence),valid=times.length>0&&evidence.length>=4;
    const status=valid&&['pass','fail','uncertain'].includes(item.status)?item.status:'uncertain';
    checks.push({code:rule.code,status,severity:status==='fail'?(item.severity==='severe'?'severe':'warning'):'info',
      time:times[0]??null,evidence:valid?(rule.code==='SPINE_NEUTRAL'?'仅关键帧可见外形：':'')+evidence:'现有关键帧不足以确认这一项。',correction:narrative(item.correction),source:'visual',scope:'sampled-frames',evidenceTimes:times});
    if(identified&&!target&&checks.length===3)break;
  }
  const limitations=(Array.isArray(value.limitations)?value.limitations:[]).map(item=>narrative(item)).filter(Boolean).slice(0,5);
  limitations.unshift(visual?'视觉点评只覆盖所提供的关键帧，无法确认关键帧之间的完整动作过程。':'当前模型仅解释本地分析证据，没有进行视觉动作确认。');
  if(!identified)limitations.push('AI 未可靠确认动作名称；候选动作不能作为已确认结果。');
  else if(!identified.exerciseId)limitations.push(identified.family?'该动作不在教学目录中；评估只使用对应动作类别的检查规则，不能作为专属动作标准。':'已识别动作名称，但暂无对应的本地检查规则；仅提供关键画面反馈，不计算分数或次数。');
  if(checks.some(check=>check.code==='SPINE_NEUTRAL'))limitations.push('可见身体外形不能证明真实腰椎三维中立位。');
  return {version:MOTION_COACH_VERSION,mode:visual?'visual':'evidence-only',action,candidates,
    overallEvaluation:narrative(value.overallEvaluation,'请结合下方有时间依据的检查与纠正建议查看本次动作。'),checks,limitations:[...new Set(limitations)]};
}

function combineChecks(rules,localChecks,coachChecks) {
  return rules.map(rule=>{
    const local=(Array.isArray(localChecks)?localChecks:[]).find(check=>check.code===rule.code);
    const offered=coachChecks.filter(check=>check.code===rule.code&&check.source==='visual'&&boundedTimes(check.evidenceTimes).length&&text(check.evidence).length>=4);
    const failed=offered.find(check=>check.status==='fail'&&check.severity==='severe')||offered.find(check=>check.status==='fail');
    let selected;
    if(local?.status==='fail')selected=failed?{...local,severity:local.severity==='severe'||failed.severity==='severe'?'severe':local.severity,score:Math.min(finite(local.score)?local.score:40,failed.severity==='severe'?0:40),visualEvidence:{time:failed.time,message:failed.evidence,correction:failed.correction}}:local;
    else if(failed)selected={...failed,status:'fail',message:failed.evidence,evidence:{description:failed.evidence},score:failed.severity==='severe'?0:40};
    else if(local?.status==='pass')selected=local;
    else {const passed=offered.find(check=>check.status==='pass');selected=passed?{...passed,message:passed.evidence,evidence:{description:passed.evidence},score:100}:local;}
    return {...(selected||{status:'unobservable',score:null,severity:'info',time:null,message:'现有证据不足以核验。',scope:'unobservable',evidenceTimes:[]}),code:rule.code,weight:rule.weight,critical:rule.critical,label:rule.label};
  });
}

function checkScores(checks,baseline,{familyOnly=false}={}) {
  const total=checks.reduce((sum,check)=>sum+check.weight,0),observed=checks.filter(check=>['pass','fail'].includes(check.status));
  const weight=observed.reduce((sum,check)=>sum+check.weight,0);
  const observedScore=weight?Math.round(observed.reduce((sum,check)=>sum+check.weight*(finite(check.score)?clamp(check.score):check.status==='pass'?100:40),0)/weight):null;
  let score=observedScore;
  const unknown=checks.filter(check=>!['pass','fail'].includes(check.status)||check.scope==='sampled-frames');
  const failures=checks.filter(check=>check.status==='fail');
  const ceilings=[];
  if(failures.some(check=>check.severity==='severe'))ceilings.push(49);
  if(failures.some(check=>check.critical))ceilings.push(59);
  if(failures.length)ceilings.push(79);
  if(unknown.some(check=>check.critical))ceilings.push(69);else if(unknown.length)ceilings.push(84);
  if(familyOnly)ceilings.push(84);
  if(finite(baseline))ceilings.push(baseline);
  if(score!==null&&ceilings.length)score=Math.round(Math.min(score,...ceilings));
  const scoreStatus=score===null?'unavailable':unknown.length||familyOnly?'provisional':'assessed';
  const verifiedWeight=observed.filter(check=>check.scope==='whole-repetition').reduce((sum,check)=>sum+check.weight,0);
  return {score,observedScore,scoreCap:ceilings.length?Math.min(100,...ceilings):100,scoreCoverage:total?Math.round(verifiedWeight/total*1000)/1000:0,scoreStatus,qualified:scoreStatus==='assessed'&&!failures.length&&score>=80};
}
function issuesFromChecks(checks) {return checks.filter(check=>check.status==='fail'&&(check.source==='visual'||check.visualEvidence)).map(check=>({code:check.code,time:check.visualEvidence?.time??check.time,message:check.visualEvidence?.message??check.message,severity:check.severity,source:'visual'}));}
const unscoredRep = rep => ({...rep,score:null,observedScore:null,scoreStatus:'unavailable',scoreCoverage:0,qualified:false});
const unreliablePoseClassifications = new Set(['INVALID_DIMENSIONS','NO_POSE','TOO_FEW_FRAMES','MULTIPLE_PEOPLE','LOW_POSE_COVERAGE','LOW_TARGET_COVERAGE','LOW_SOURCE_FRAME_RATE','LOW_SOURCE_RATE','LOW_SAMPLE_RATE','TARGET_ID_CHANGED']);
function measuredPoseFailures(analysis) {
  const quality=analysis?.quality,failures=[];
  if(finite(quality?.usableRatio)&&quality.usableRatio<0.7||finite(quality?.validFrames)&&quality.validFrames<8)failures.push('LOW_POSE_COVERAGE');
  if(finite(quality?.targetCoverage)&&quality.targetCoverage<0.7)failures.push('LOW_TARGET_COVERAGE');
  if(finite(quality?.sourceFps)&&quality.sourceFps<5)failures.push('LOW_SOURCE_FRAME_RATE');
  return failures;
}
function poseClassificationTrustworthy(analysis) {
  if(!analysis||typeof analysis!=='object')return false;
  return !measuredPoseFailures(analysis).length&&!(Array.isArray(analysis.quality?.reasons)?analysis.quality.reasons:[]).some(code=>unreliablePoseClassifications.has(code));
}

/** Keep local failures; a family recipe never becomes an exact exercise label. */
export function mergeCoachAssessment(analysis,coach,{originalAnalysis}={}) {
  let base=analysis&&typeof analysis==='object'?analysis:{};
  const original=originalAnalysis&&typeof originalAnalysis==='object'?originalAnalysis:null;
  const originalHard=[...(Array.isArray(original?.quality?.reasons)?original.quality.reasons:[]),...measuredPoseFailures(original)].filter(code=>MOTION_HARD_QUALITY_FAILURES.includes(code));
  const measuredFailures=measuredPoseFailures(base);
  if(originalHard.length||measuredFailures.length)base={...base,quality:{...base.quality,reasons:[...new Set([...(base.quality?.reasons||[]),...originalHard,...measuredFailures])]}};
  const localExercise=exercise(base.exerciseId),localFamily=localExercise||familyTemplate(base.exerciseFamily);
  const identified=confirmedMotionAction(coach),identifiedExercise=exercise(identified?.exerciseId),identifiedFamily=identifiedExercise||familyTemplate(identified?.family);
  const originalFamily=exercise(original?.exerciseId)?.family||supportedFamily(original?.exerciseFamily);
  const hintConflict=(Array.isArray(base.quality?.reasons)?base.quality.reasons:[]).includes('EXERCISE_HINT_CONFLICT')&&poseClassificationTrustworthy(original||base)&&poseClassificationTrustworthy(base);
  const reliableFamilies=[poseClassificationTrustworthy(base)?localFamily?.family:null,poseClassificationTrustworthy(original)?originalFamily:null];
  const conflict=!!identified&&(hintConflict||!!identified.family&&reliableFamilies.some(family=>family&&family!==identified.family));
  const identity=identified?{exerciseId:conflict?null:identified.exerciseId,exerciseName:identified.name,exerciseFamily:identified.family,familyName:motionFamilies[identified.family]||null,exerciseFamilyName:motionFamilies[identified.family]||null,requiresVisualConfirmation:conflict,recognitionSource:'visual',recognitionConflict:conflict}:{};
  if(identified&&!identifiedFamily)return {...base,...identity,status:'unsupported',score:null,observedScore:null,scoreStatus:'unavailable',scoreCoverage:0,qualified:false,qualifiedRepCount:0,attemptCount:0,incompleteAttemptCount:0,reps:[],checks:(Array.isArray(coach.checks)?coach.checks:[]).filter(check=>check.source==='visual'&&generalVisualCodes.has(check.code)).slice(0,3),issues:[],visualReviewRequests:[],coach,summary:`已识别${identified.name}；暂无对应的本地检查规则，仅提供关键画面反馈，不计算分数或次数。`};
  if((Array.isArray(base.quality?.reasons)?base.quality.reasons:[]).some(code=>MOTION_HARD_QUALITY_FAILURES.includes(code)))return {...base,...identity,status:base.status==='unsupported'?'unsupported':'insufficient',score:null,observedScore:null,scoreStatus:'unavailable',scoreCoverage:0,qualified:false,qualifiedRepCount:0,reps:(Array.isArray(base.reps)?base.reps:[]).map(unscoredRep),coach,...(conflict?{summary:'本地分析与视觉识别的动作类别不一致，请补充更清晰的完整动作视频。'}:{})};
  let target=conflict?null:identifiedFamily||localExercise||localFamily;
  const familyOnly=!!target&&(identified?!identifiedExercise:!localExercise||base.requiresVisualConfirmation===true);
  if(familyOnly)target={...target,id:null,name:identified?.name||target.familyName};
  if(!target)return {...base,...identity,score:null,observedScore:null,scoreCoverage:0,scoreStatus:'unavailable',status:'insufficient',qualified:false,qualifiedRepCount:0,reps:(Array.isArray(base.reps)?base.reps:[]).map(unscoredRep),coach,
    summary:conflict?'本地分析与视觉识别的动作类别不一致，请补充更清晰的完整动作视频。':'尚未可靠确认动作，暂不合并评分。'};
  if(!Array.isArray(base.reps)||!base.reps.length)return {...base,...identity,exerciseId:target.id,exerciseFamily:target.family,exerciseFamilyName:target.familyName,requiresVisualConfirmation:!identified&&familyOnly,status:'insufficient',score:null,observedScore:null,scoreStatus:'unavailable',scoreCoverage:0,qualified:false,qualifiedRepCount:0,coach,summary:'动作名称可以由画面补充确认，但缺少完整动作过程，暂不评分。'};
  const coachChecks=coach?.mode==='visual'&&Array.isArray(coach.checks)?coach.checks:[];
  const originalFailures=originalFamily===target.family?(Array.isArray(original?.checks)?original.checks:[]).filter(check=>check.status==='fail'&&(!check.source||check.source==='pose')&&target.requiredChecks.includes(check.code)):[];
  const localChecks=target.checks.map(rule=>{
    const current=(Array.isArray(base.checks)?base.checks:[]).find(check=>check.code===rule.code);
    const prior=originalFailures.find(check=>check.code===rule.code);
    if(!prior||current?.status==='fail'&&(current.severity==='severe'||prior.severity!=='severe')&&(current.score??0)<=(prior.score??0))return current;
    return {...prior,preservedFromFamily:true};
  }).filter(Boolean);
  const preserved=localChecks.filter(check=>check.preservedFromFamily);
  const checks=combineChecks(target.checks,localChecks,coachChecks);
  let scores=checkScores(checks,base.score,{familyOnly});
  const visualIssues=issuesFromChecks(checks);
  const preservedIssues=preserved.map(check=>({code:check.code,time:check.time,message:check.message,severity:check.severity,source:'pose',preservedFromFamily:true}));
  const reps=(Array.isArray(base.reps)?base.reps:[]).map(rep=>{
    const relevant=coachChecks.flatMap(check=>{
      if(!finite(rep.start)||!finite(rep.end))return [];
      const times=boundedTimes([...(Array.isArray(check.evidenceTimes)?check.evidenceTimes:[]),check.time]).filter(time=>time>=rep.start&&time<=rep.end);
      return times.length?[{...check,time:times[0],evidenceTimes:times}]:[];
    });
    const repChecks=combineChecks(target.checks,rep.checks,relevant);
    return {...rep,checks:repChecks,...checkScores(repChecks,rep.score,{familyOnly}),issues:[...(rep.issues||[]),...issuesFromChecks(repChecks)]};
  });
  // A global check may be unobservable because one repetition was obscured.
  // Preserve the measured weight of all other repetitions. Global failures
  // still impose their strict cap, including evidence outside counted reps.
  if(reps.length&&(Array.isArray(base.reps)?base.reps:[]).every(rep=>Array.isArray(rep.checks)&&rep.checks.length)){
    const measured=checkScores(reps.flatMap(rep=>rep.checks),base.score,{familyOnly});
    scores={...measured,observedScore:preserved.length&&finite(scores.observedScore)&&finite(measured.observedScore)?Math.min(measured.observedScore,scores.observedScore):measured.observedScore,score:measured.score===null?null:Math.min(measured.score,scores.scoreCap),scoreCap:Math.min(measured.scoreCap,scores.scoreCap),scoreStatus:measured.score===null?'unavailable':measured.scoreStatus==='provisional'||scores.scoreStatus==='provisional'?'provisional':'assessed',qualified:measured.qualified&&scores.qualified};
  }
  return {...base,...identity,exerciseId:target.id,exerciseFamily:target.family,exerciseFamilyName:target.familyName,requiresVisualConfirmation:!identified&&familyOnly,status:scores.score===null?'insufficient':'complete',checks,...scores,reps,qualifiedRepCount:reps.filter(rep=>rep.qualified).length,issues:[...(base.issues||[]),...preservedIssues,...visualIssues],coach,
    summary:scores.score===null?'证据不足，暂不评分。':`${target.name}：${scores.scoreStatus==='provisional'?'当前为部分证据参考分，尚有未完整核验的项目。':checks.some(check=>check.status==='fail')?'检测到需要纠正的动作问题。':'已检查项目未发现明显问题。'}`};
}

export const motionCoachActionCatalog = () => motionExercises.map(({id,name,family,recognitionRules,checks})=>({id,name,family,...(recognitionRules?{recognitionRules}:{}),checks:checks.map(({code,label,critical,requiredView,visual})=>({code,label,critical,requiredView,visual}))}));
