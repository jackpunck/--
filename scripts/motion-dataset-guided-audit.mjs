// Offline audit of real guided model inputs. No provider or media inference.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {getMotionExercise} from '../public/motion-catalog.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const args=process.argv.slice(2);
if(args[0]!=='--output'||args.length<3)throw new Error('Usage: --output AUDIT_JSON GUIDED_RESULTS_JSON...');
const audit={generatedAt:new Date().toISOString(),offlineOnly:true,networkCallsMadeByAudit:0,sourceReports:[],rows:[],actualProviderCalls:0};
for(const filename of args.slice(2)){
  const file=resolve(filename),root=dirname(file),report=await read(file),protocol=report.inference.frozenProtocol;
  assert.equal(report.mode,'coach');assert.equal(report.reviewMode,'guided');assert.equal(report.inference.mock,false);assert(protocol?.systemSha256);
  audit.sourceReports.push({path:file,sha256:hash(await readFile(file)),protocolSha256:protocol.sha256});
  for(const row of report.rows){
    const record={id:row.id,status:row.status,error:row.error||null,providerCalls:(row.providerRequestFiles||[]).length,selectedExerciseId:row.expected.selectedExerciseId,checks:[]};
    assert(record.providerCalls<=1,'No hidden automatic model retries');
    if(!record.providerCalls){record.phase='local-before-provider';audit.rows.push(record);continue;}
    const input=await read(join(root,row.requestFile));assert.equal(hash(await readFile(join(root,row.requestFile))),row.requestSha256);
    assert.equal(input.reviewMode,'guided');assert.equal(input.selectedExerciseId,row.expected.selectedExerciseId);
    if(row.replayedPose){
      const sourceRoot=row.poseSource?.cacheRoot;assert(sourceRoot,'Replay must preserve its original real cache root');
      const sourceReport=await read(join(sourceRoot,'results.json')),sourceRow=sourceReport.rows.find(item=>item.id===row.id);
      assert.equal(sourceReport.inference.mock,false);assert.equal(sourceRow.sha256,row.sha256);
      const sourceInput=await read(join(sourceRoot,sourceRow.requestFile));
      assert.deepEqual(input.fullAnalysis.measurements,sourceInput.fullAnalysis.measurements);
      assert.deepEqual(input.keyframes,sourceInput.keyframes);
      if(row.framesFile&&sourceRow.framesFile){assert.deepEqual(await read(join(root,row.framesFile)),await read(join(sourceRoot,sourceRow.framesFile)));
        record.replayedPipelineSha256=hash(await readFile(join(root,row.framesFile)));record.sourcePipelineSha256=hash(await readFile(join(sourceRoot,sourceRow.framesFile)));}
      record.sourceVideoSha256=row.sha256;record.sourceRequestSha256=hash(await readFile(join(sourceRoot,sourceRow.requestFile)));
    }
    const trace=await read(join(root,row.providerRequestFiles[0])),body=trace.body,parts=body.messages[1].content,context=JSON.parse(parts[0].text),images=parts.filter(p=>p.type==='image_url').map(p=>p.image);
    assert.equal(hash(body.messages[0].content),protocol.systemSha256);assert.equal(body.model,protocol.model);
    assert.equal(body.thinking.type,protocol.thinking);assert.equal(body.temperature,protocol.temperature);assert.equal(body.max_tokens,protocol.maxTokens);
    const selected=getMotionExercise(input.selectedExerciseId);assert.deepEqual(context.selectedExercise,{id:selected.id,name:selected.name,family:selected.family});
    assert.equal(context.stage,'guided-evidence');assert.equal(context.evidence.sourceFrameCount,input.poseData.frameCount);
    assert.equal(context.evidence.summarizedMeasurementCount,input.fullAnalysis.measurements.length);
    assert.deepEqual(context.evidence.frames.map(f=>f.frameIndex),context.evidence.sourceFrameIndices);
    const schema=context.evidence.poseSchema;
    for(const key of ['width','height','sampleFps','modelVersion','coordinates','targetTracking'])assert.deepEqual(schema[key],input.poseData[key]);
    const bounded=value=>Number.isFinite(value)&&value>=0&&value<=1;
    const coordinate=value=>bounded(value)?Number(value.toFixed(schema.coordinateDecimals)):value;
    const visibility=value=>schema.visibilityPrecision==='floor-3-decimals-in-range'&&bounded(value)?Math.floor(value*1000)/1000:value;
    const angle=value=>Number.isFinite(value)&&schema.measurementPrecision==='approximate-rounded'?Number(value.toFixed(schema.measurementDecimals)):value;
    for(const frame of context.evidence.frames){
      const source=input.poseData.frames[frame.frameIndex];assert(source);assert.equal(frame.time,source.time);assert.equal(frame.sourceTime,source.sourceTime);
      const indices=context.evidence.poseSchema.landmarkIndices;
      const expectedPoints=indices.map(index=>{const point=source.landmarks?.[index];return Array.isArray(point)?point.slice(0,3).map((value,field)=>point[3]&(1<<field)?null:value):null;});
      assert.equal(frame.landmarks.length,indices.length);
      for(const [i,point]of frame.landmarks.entries()){
        const expected=expectedPoints[i];
        if(!expected){assert.equal(point,null);continue;}
        assert.equal(point.length,expected.length);
        for(const [field,value]of point.entries()){
          const original=expected[field];
          assert.equal(value,field<2?coordinate(original):visibility(original));
        }
      }
      const tracking=source.subjectTracking?structuredClone(source.subjectTracking):undefined;
      if(tracking&&schema.trackingConfidencePrecision==='floor-3-decimals-in-range'){
        if(bounded(tracking.confidence))tracking.confidence=Math.floor(tracking.confidence*1000)/1000;
        if(tracking.bbox){const box=Object.fromEntries(Object.entries(tracking.bbox).map(([key,value])=>[key,coordinate(value)]));
          if(box.xMin<box.xMax&&box.yMin<box.yMax)tracking.bbox=box;}
      }
      assert.deepEqual(frame.subjectTracking,tracking);
    }
    for(const measurement of context.evidence.measurements){
      const source=input.fullAnalysis.measurements[measurement[0]];assert.equal(measurement[1],source.time);
      for(let i=2;i<measurement.length;i++){
        const [side,key]=context.evidence.measurementColumns[i].split('.'),value=source[side]?.[key];
        assert.equal(measurement[i],Number.isFinite(value)?angle(value):null);
      }
    }
    let summarized=0;
    for(const [windowIndex,window]of context.evidence.windows.entries()){
      summarized+=window.sourceFrameCount;
      const sourceIndices=input.fullAnalysis.measurements.map((row,index)=>({row,index})).filter(({row})=>Math.min(context.evidence.windows.length-1,Math.floor(row.time/input.duration*context.evidence.windows.length))===windowIndex);
      assert.equal(window.sourceFrameCount,sourceIndices.length);
      for(const statistic of window.statistics){
        const [side,key]=statistic.path;
        const present=sourceIndices.filter(({row})=>Number.isFinite(row[side]?.[key]));
        assert.equal(statistic.values[0],present.length);
        assert.equal(statistic.values[1],present[0].index);assert.equal(statistic.values[3],present.at(-1).index);
        assert.equal(statistic.values[6],angle(Math.min(...present.map(({row})=>row[side][key]))));
        assert.equal(statistic.values[8],angle(Math.max(...present.map(({row})=>row[side][key]))));
        for(let i=1;i<statistic.values.length;i+=2){
          const value=input.fullAnalysis.measurements[statistic.values[i]]?.[side]?.[key];
          assert(Number.isFinite(value));assert.equal(statistic.values[i+1],angle(value));
        }
      }
    }
    assert.equal(summarized,input.fullAnalysis.measurements.length);
    for(const [index,time]of context.evidence.statisticSourceTimes)assert.equal(time,input.fullAnalysis.measurements[index].time);
    const keyframes=[...input.keyframes].sort((a,b)=>a.time-b.time);assert.equal(images.length,keyframes.length);assert.equal(context.frames.length,keyframes.length);
    for(const [i,frame]of keyframes.entries()){
      const bytes=Buffer.from(frame.data,'base64');assert.deepEqual(images[i],{mimeType:frame.mimeType,bytes:bytes.length,sha256:hash(bytes)});
      assert.equal(context.frames[i].time,frame.time);assert.equal(context.frames[i].imageIndex,i);
    }
    const serialized=JSON.stringify(body);for(const value of [row.id,row.expected.relativePath,'qualityLabel','sourceLabel','specificFault','labelProvenance'])if(value)assert(!serialized.includes(value));
    const responseFile=row.providerResponseFiles?.[0];if(responseFile){const raw=await read(join(root,responseFile));assert(raw.choices?.[0]?.message?.content);record.rawResponseSha256=hash(await readFile(join(root,responseFile)));}
    record.phase=row.status==='ok'?'published':'provider-response-validation';record.systemSha256=hash(body.messages[0].content);record.actualPoseFrames=context.evidence.frames.length;record.actualImages=images.length;
    if(row.coach){assert.equal(row.coach.mode,'guided');assert.equal(row.coach.action.status,'selected');assert.equal(row.coach.action.source,'user');assert.equal(row.coach.action.confidence,null);assert.equal(row.coach.action.exerciseId,selected.id);
      assert.equal(row.coach.coverage.reviewedImageCount,images.length);assert.equal(row.coach.coverage.reviewedFrameCount,context.evidence.frames.length);assert.equal(row.coach.coverage.modelCalls,1);}
    record.checks=['Frozen actual model configuration and system SHA match.','Selected action exactly matches explicit manifest catalog identity.','Actual sent pose frames match the complete cached input at original indices.','All actual image hashes and times match real cached images.','Ground-truth labels, filenames and video IDs are absent from provider text.'];
    audit.actualProviderCalls++;audit.rows.push(record);
  }
}
audit.passed=true;audit.clipAttempts=audit.rows.length;audit.localBeforeProvider=audit.rows.filter(r=>r.phase==='local-before-provider').length;
audit.limitations=['Audit verifies protocol and evidence lineage, not correctness of the model feedback.','A provided action label is not recognition accuracy.','Failures remain in the report; no retries were made by this audit.'];
await writeFile(resolve(args[1]),JSON.stringify(audit,null,2),{flag:'wx'});
console.log(JSON.stringify({output:resolve(args[1]),passed:true,clipAttempts:audit.clipAttempts,actualProviderCalls:audit.actualProviderCalls,localBeforeProvider:audit.localBeforeProvider}));
