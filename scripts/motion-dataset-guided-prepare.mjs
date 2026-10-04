// Freeze guided development representatives and audit existing exact-byte caches.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {hashFile,datasetVideoPath} from './motion-dataset-benchmark.mjs';
import {selectGuidedRepresentatives} from './motion-dataset-guided.mjs';
const root=resolve('.'),dataset=join(root,'测试集'),output=resolve(process.argv[2]||'.qa/motion-guided-v1-plan');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const source=await read(join(dataset,'manifest.json')),supplement=await read(join(dataset,'补充动作/坐姿划船/manifest.json'));
const pool=[...source.items,...supplement.items.map(item=>({...item,relativePath:'补充动作/坐姿划船/'+item.relativePath}))];
const selected=selectGuidedRepresentatives(pool);
const cacheRoot=join(root,'.qa/motion-main-five-final-evidence'),cache=await read(join(cacheRoot,'results.json'));
const base={version:1,partition:'guided-development',frozenAt:new Date().toISOString(),reviewMode:'guided',
  selection:'All 38 existing exercise classes plus the supplemental seated cable row. Author-labeled classes: subject001/01 side, good+bad; deadlift GB/PB/LLK. Unlabeled classes: Commons first, then lexicographic ID. Fixed without using model predictions.',
  limitations:['This is development coverage, not a new independent holdout. Prior development subjects and clips are deliberately reused.',
    'User-provided action category is input, never recognition ground truth for accuracy.',
    'Unverified demonstrations and mixed tutorials have no form-quality accuracy denominator.',
    'Author verdict agreement is separate from independently verified correction correspondence.'],
  datasetManifestSha256:await hashFile(join(dataset,'manifest.json')),supplementManifestSha256:await hashFile(join(dataset,'补充动作/坐姿划船/manifest.json'))};
const audit=[],items=[];
for(const item of selected){
  const path=await datasetVideoPath(dataset,item.relativePath),sha256=await hashFile(path);
  if(item.outputSha256&&item.outputSha256!==sha256)throw new Error(`Source checksum mismatch ${item.id}`);
  const existing=cache.rows.find(row=>row.id===item.id&&row.sha256===sha256&&row.status==='ok'&&row.requestFile&&row.framesFile);
  const cacheAudit=existing?{root:cacheRoot,requestFile:existing.requestFile,framesFile:existing.framesFile,
    requestSha256:await hashFile(join(cacheRoot,existing.requestFile)),framesSha256:await hashFile(join(cacheRoot,existing.framesFile)),
    sourceCodeHashes:cache.codeHashes,sourceGeneratedAt:cache.generatedAt,sourcePoseRate:(await read(join(cacheRoot,existing.framesFile))).sampleFps}:null;
  items.push({...item,outputSha256:sha256,outputBytes:(await stat(path)).size});
  audit.push({id:item.id,exercise:item.exercise,selectedExerciseId:item.selectedExerciseId,sourceSha256:sha256,cache:cacheAudit,needsExtraction:!existing});
}
await mkdir(output,{recursive:true});
await writeFile(join(output,'manifest.json'),JSON.stringify({...base,items},null,2),{flag:'wx'});
await writeFile(join(output,'extract-manifest.json'),JSON.stringify({...base,items:items.filter(item=>audit.find(a=>a.id===item.id).needsExtraction)},null,2),{flag:'wx'});
await writeFile(join(output,'cache-audit.json'),JSON.stringify({frozenAt:base.frozenAt,clips:items.length,exercises:new Set(items.map(x=>x.exercise)).size,reused:audit.filter(a=>a.cache).length,newExtractions:audit.filter(a=>a.needsExtraction).length,audit},null,2),{flag:'wx'});
console.log(JSON.stringify({output,clips:items.length,exercises:new Set(items.map(x=>x.exercise)).size,reused:audit.filter(a=>a.cache).length,newExtractions:audit.filter(a=>a.needsExtraction).length}));
