import {readFileSync} from 'node:fs';
import {analyzeMotion} from '../../public/motion-analysis.js';
import {sanitizeMotionCoachResponse,mergeCoachAssessment} from '../../public/motion-contract.js';
import {buildMotionAssessmentReport} from '../../public/motion-view.js';

// A storage regression, not 119 seconds of independently labelled exercise:
// repeat the existing real-pose fixture and let the actual engine count it.
export function longMotionReport() {
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/motion-pushup-real.json',import.meta.url)));
  const source=fixture.frames.map(([time,points])=>{
    const landmarks=Array(33).fill(null);
    fixture.landmarkIndices.forEach((index,i)=>{const [x,y,visibility]=points[i];landmarks[index]={x,y,visibility};});
    return {time,landmarks};
  });
  const frames=[],duration=119;
  for(let cycle=0;cycle<8;cycle++)for(const frame of source){const time=frame.time+cycle*(source.at(-1).time+1/15);if(time<=duration)frames.push({...frame,time});}
  const base=analyzeMotion(frames,{...fixture.options,duration});
  const times=[0,14,28,42,56,base.reps.length-1].map(index=>base.reps[index].time);
  // Verbose but schema-valid feedback exercises the upper end of model prose.
  // These statements are fabricated transport data, not ground-truth labels.
  const evidence='此段仅为报告容量测试的模拟观察，需要结合完整动作回看确认相关部位在发力和还原期间的位置变化，不能据此推断真实动作质量。'.repeat(12);
  const correction='这段文字是保存回归测试中的模拟建议，要求完整保留每条检查与证据时间，不可通过删去动作次数、截短反馈或省略关键时间来规避保存限制。'.repeat(12);
  const coach=sanitizeMotionCoachResponse({action:{exerciseId:'pushup',status:'identified',confidence:'high',evidenceTimes:times},checks:base.checks.map(check=>({code:check.code,status:'fail',severity:'warning',time:times[0],evidenceTimes:times,evidence,correction})),overallEvaluation:'用于验证完整报告保存的模拟 AI 回应。'},{mode:'visual',analysis:base,keyframes:times.map(time=>({time}))});
  const analysis=mergeCoachAssessment(base,coach,{originalAnalysis:base});
  const report=buildMotionAssessmentReport(analysis,{file:{name:'long-report-regression.mp4',size:123456},pipeline:{...fixture.options,duration,sourceFps:30,sampleFps:15,modelVersion:'fixture / MediaPipe Full',decoder:'test-repeated-real-poses',elapsedMs:1},createdAt:'2026-10-03T00:00:00.000Z'});
  return {analysis,report};
}
