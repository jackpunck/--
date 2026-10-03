// Evaluate saved real-model outputs without rerunning the GPU or redistributing videos.
// Usage: node scripts/qa-motion-benchmark.mjs [.qa/motion-fixtures]
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {analyzeMotion} from '../public/motion-analysis.js';

const folder=resolve(process.argv[2]||'.qa/motion-fixtures');
const source=await readFile(join(folder,'mendeley-sources.json'),'utf8').catch(()=>readFile(new URL('../tests/fixtures/motion-video-sources.json',import.meta.url),'utf8')).then(JSON.parse);
const additional=JSON.parse(await readFile(new URL('./motion-sample-sources.json',import.meta.url),'utf8'));
const rows=[];
for(const filename of (await readdir(folder)).filter(name=>/\.mp4(?:\.(?:webcodecs|html-video))?\.frames\.json$/.test(name)).sort()){
 const clip=JSON.parse(await readFile(join(folder,filename),'utf8'));
 if(!Array.isArray(clip.frames))throw new Error(`Invalid frames: ${filename}`);
 const media=filename.replace(/(?:\.(?:webcodecs|html-video))?\.frames\.json$/,'');
 const baseline=source.samples.find(item=>item.localPlayableCopy===media);
 const metadata=baseline||additional.samples.find(item=>item.playable===media);
 const expected=baseline?.label.exercise?.replace('push_up','pushup')||({
  'squat.mp4':'squat','pushup.mp4':'pushup','squat-alt.mp4':'squat','jacks.mp4':'unsupported',
 })[media]||null;
 const report=analyzeMotion(clip.frames,clip);
 rows.push({file:media,frameFile:filename,source:metadata?.sourcePage||null,subject:metadata?.label.subject||null,
  authorQuality:metadata?.label.quality||null,authorExercise:metadata?.label.exercise||null,expectedExercise:expected,recognizedExercise:report.exerciseId,recognizedFamily:report.exerciseFamily,
  recognitionMatches:expected===null?null:expected==='unsupported'?report.status==='unsupported':report.exerciseId===expected,
  status:report.status,score:report.score,observedScore:report.observedScore,scoreStatus:report.scoreStatus,scoreCoverage:report.scoreCoverage,repetitions:report.reps.length,qualifiedRepetitions:report.qualifiedRepCount,
  targetTracking:clip.targetTracking,
  reasons:report.quality.reasons,issues:[...new Set(report.issues.map(issue=>issue.code))],
  duration:clip.duration,elapsedMs:clip.elapsedMs,speedRatio:clip.elapsedMs/(clip.duration*1000),
  delegate:clip.delegate,decoder:clip.decoder||'video-seek',frames:clip.frames.length,timing:clip.timing,
  ruleVersion:report.version,report});
}
const output={generatedAt:new Date().toISOString(),
 caveat:'Small convenience sample; author good/bad labels do not identify specific errors. Multiple-person and unsuitable-view clips may be rejected. Scores cover only the implemented checks. This is not a calibrated accuracy benchmark.',rows};
await writeFile(join(folder,'benchmark-results.json'),JSON.stringify(output,null,2));
console.table(rows.map(({file,status,recognizedExercise,score,repetitions,elapsedMs,reasons})=>({file,status,exercise:recognizedExercise,score,reps:repetitions,seconds:Math.round(elapsedMs/100)/10,reasons:reasons.join(',')})));
console.log(`Saved ${join(folder,'benchmark-results.json')}`);
