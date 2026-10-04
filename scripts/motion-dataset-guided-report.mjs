import {access,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {datasetVideoPath,summarizeGuidedDatasetResults} from './motion-dataset-benchmark.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fraction=m=>m.total?`${m.correct}/${m.total} (${(100*m.rate).toFixed(1)}%)`:'无可评分样本';
export async function writeGuidedDatasetReport({output,partition,attempts,latest,reportContext={}}){
  const summary={generatedAt:new Date().toISOString(),partition,evaluationMode:'guided',recognitionAccuracyMeasured:false,
    current:summarizeGuidedDatasetResults(latest),allAttempts:summarizeGuidedDatasetResults(attempts),latest,attempts};
  summary.context=reportContext;
  summary.pendingReason=reportContext.pendingReason||'Planned but unexecuted clips remain pending in the full planned coverage denominator; they count as neither successes nor failures.';
  const related=[];
  for(const item of reportContext.relatedArtifacts||[]){
    const path=resolve(item.path);let exists=true;try{await access(path);}catch{exists=false;}
    const url=encodeURI(relative(output,path).split(sep).join('/'));
    related.push(`<li>${exists?`<a href="${esc(url)}">${esc(item.label)}</a>`:esc(item.label)+'（文件尚未生成）'}：${esc(item.scope)}</li>`);
  }
  summary.protocols=[...new Map(attempts.map(row=>[row.reportFile,{reportFile:row.reportFile,runAt:row.runAt,
    version:row.protocol.frozen?.version||'guided-v1',systemSha256:row.protocol.frozen?.systemSha256,
    frozenProtocolSha256:row.protocol.frozen?.sha256,model:row.protocol.provider?.model,
    thinking:row.protocol.frozen?.thinking,temperature:row.protocol.frozen?.temperature,maxTokens:row.protocol.frozen?.maxTokens,
    actualSampleRates:row.protocol.actualSampleRates}])).values()];
  const galleries=new Map();
  for(const row of latest){
    const images=[];
    for(const f of (row.keyframeFiles||[]).slice(0,6)){
      try{const path=await datasetVideoPath(dirname(row.reportFile),f.filename),url=encodeURI(relative(output,path).split(sep).join('/'));
        images.push(`<figure><a href="${esc(url)}"><img src="${esc(url)}" loading="lazy"></a><figcaption>${esc(f.time)} 秒</figcaption></figure>`);
      }catch{images.push('<figure>证据图片缺失</figure>');}
    }
    galleries.set(row.id,images.join('')||'没有可用证据图片');
  }
  const display=row=>`<tr><td>${esc(row.expected.exerciseNameZh||row.expected.exercise)}<br><small>${esc(row.id)}</small></td><td>${esc(row.expected.selectedExerciseId)}<br>${esc(row.score?.selectionCheck||row.status)}</td><td>${esc(row.expected.qualityLabel)}<br>${esc(row.expected.qualityLabel==='author_good'?'standard':row.expected.qualityLabel==='author_bad'?'needs-improvement':'无正误标注')}</td><td>${esc(row.score?.predictedVerdict||row.status)}<br>${esc(row.error||row.coach?.verdict?.summary)}</td><td>${row.status==='pending'?'— 未执行':!['author_good','author_bad'].includes(row.expected.qualityLabel)?'— 未标注':row.score?.qualityCorrect?'一致':'未一致'}</td></tr>`;
  const head='<tr><th>视频动作</th><th>用户选择／画面核对</th><th>作者参考</th><th>模型评价</th><th>作者正误一致</th></tr>';
  const s=summary.current;
  const classRows=Object.entries(s.byExercise).map(([exercise,stats])=>`<tr><td>${esc(latest.find(row=>row.expected.exercise===exercise)?.expected.exerciseNameZh||exercise)}</td><td>${stats.clips}</td><td>${stats.attempted}</td><td>${stats.publishedClips}</td><td>${fraction(stats.validSelectedEvaluation)}</td><td>${fraction(stats.quality)}</td></tr>`).join('');
  const seconds=value=>Number.isFinite(value)?(value/1000).toFixed(2)+' 秒':'无数据';
  const html=`<!doctype html><meta charset="utf-8"><title>用户选择动作后的真实视频评价</title><style>body{font:15px/1.6 system-ui;margin:28px;background:#eff4f6;color:#203740}main{max-width:1300px;margin:auto}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px;border-bottom:1px solid #dce3e8;text-align:left;vertical-align:top}small{overflow-wrap:anywhere}.card{background:white;padding:20px;margin:20px 0;border-radius:12px}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}figure{margin:0}img{width:100%;height:230px;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h1>用户选择动作后的真实视频评价</h1><p>分区：${esc(partition)}。输入动作类别由用户指定，<b>不计算动作识别准确率</b>；文件名、作者正误和具体缺陷标签不送入模型。旧开发视频可复用，本轮不是新的独立保留集。所有尝试及错误均保留。</p>
  <div class="card"><p>已测试动作：${s.coverage.testedClasses}/${s.coverage.requestedExercises} 类；有明确评价的动作覆盖：${s.coverage.evaluatedExercises}/${s.coverage.requestedExercises} 类。后者仅表示至少一条视频完成“选择一致＋给出明确结论”，不代表建议正确。</p><p>作者正误一致：${fraction(s.overall.quality)}；计划作者标注样本 ${s.formReferences.authorLabels.plannedAuthorLabeledClips} 条，无标签和未执行视频不计入准确率分母。已有证据引用的坏动作纠正：${fraction(s.overall.badClipWithCorrection)}，只验证存在性，纠正对应性仍须独立核对。</p><p>计划视频 ${latest.length} 条；已尝试 ${s.overall.attempted} 条；发布评价 ${s.overall.publishedClips} 条；未执行 ${s.overall.pending} 条；累计尝试 ${attempts.length} 次；错误 ${s.overall.failed} 条。动作识别率：不适用。未执行样本仍保留在计划动作覆盖分母，不记成功或失败。${esc(reportContext.rationaleZh||'')}</p></div>
  <h2>当前逐视频结果</h2><table>${head}${latest.map(display).join('')}</table><h2>正误混淆及选择核对</h2><pre>${esc(JSON.stringify({quality:s.overall.qualityConfusion,selection:s.overall.selectionCheckCounts,balancedAccuracy:s.overall.qualityBalancedAccuracy},null,2))}</pre>
  <h2>耗时与实际协议</h2><p>成功评价的 AI 阶段中位数 ${seconds(s.timingMs.coach.p50)}、P95 ${seconds(s.timingMs.coach.p95)}。真实姿态提取中位数 ${seconds(s.timingMs.pose.p50)}、P95 ${seconds(s.timingMs.pose.p95)}。本轮用缓存回放评价，二者不是一次连续界面操作耗时；不同解码器和采样频率分别保留在各视频记录中。</p><pre>${esc(JSON.stringify(summary.protocols,null,2))}</pre>
  <h2>建议与证据核对</h2>${latest.map(row=>`<article class="card"><h3>${esc(row.expected.exerciseNameZh||row.expected.exercise)}</h3><small>${esc(row.id)}</small><div class="images">${galleries.get(row.id)}</div><p>作者具体错误：${esc(row.expected.specificFault||(['author_good','author_bad'].includes(row.expected.qualityLabel)?'只有作者正误标签，无具体缺陷类别':'无正误标注'))}。纠正对应性：未自动评分。</p><p>所选动作与画面核对：${esc(row.coach?.selectionCheck?.evidence||row.error)}</p>${(row.coach?.feedback||[]).map(f=>`<p><b>${esc(f.title)}</b> (${esc(f.status)})<br>证据：${esc(f.evidence)}<br>建议：${esc(f.correction)}<br>实际时间：${esc((f.evidenceTimes||[]).join(', '))}</p>`).join('')}</article>`).join('')}
  <h2>各动作覆盖与作者正误结果</h2><table><tr><th>动作</th><th>计划</th><th>已尝试</th><th>已发布</th><th>有明确评价</th><th>作者正误一致</th></tr>${classRows}</table><p><a href="summary.json">完整数据与所有引用记录（JSON）</a> · <a href="protocol-audit.json">实际请求、源骨架及图像审计（JSON）</a></p><h2>全部尝试</h2><table>${head}${attempts.map(display).join('')}</table><h2>独立审阅与集成记录</h2><ul>${related.join('')||'<li>未提供额外审阅文件。</li>'}</ul><h2>范围限制</h2><ul>${s.limitations.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></main>`;
  await mkdir(output,{recursive:true});
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
  await writeFile(join(output,'index.html'),html,{flag:'wx'});
  return {output,clips:latest.length,attempts:attempts.length,coverage:s.coverage,authorQuality:s.overall.quality};
}
