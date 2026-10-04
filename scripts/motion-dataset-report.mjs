// Combine all genuine coach attempts, retaining failures and using only the
// latest result per clip for the current acceptance gate.
// node scripts/motion-dataset-report.mjs --output .qa/motion-main-five-validation RESULTS_JSON...
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {datasetVideoPath, expectedVerdict, scoreMotionPrediction, summarizeDatasetResults} from './motion-dataset-benchmark.mjs';

const args = process.argv.slice(2);
if (args[0] !== '--output' || !args[1] || args.length < 3) throw new Error('Usage: --output DIRECTORY coach-results.json [coach-results.json ...]');
const output = resolve(args[1]), attempts = [];
const partition = args[2] === '--partition' ? args[3] : 'development';
if (!['development', 'calibration', 'holdout'].includes(partition)) throw new Error('Partition must be development, calibration or holdout.');
for (const filename of args.slice(args[2] === '--partition' ? 4 : 2)) {
  const path = resolve(filename), report = JSON.parse(await readFile(path, 'utf8'));
  if (report.mode !== 'coach' || report.inference?.mock !== false) throw new Error('Only real coach benchmark reports can be combined.');
  if ((report.partition || 'development') !== partition) throw new Error(`Refusing to mix ${report.partition || 'development'} results into the ${partition} report.`);
  for (const row of report.rows) {
    if (row.status === 'pending') continue;
    const score = row.coach ? scoreMotionPrediction(row.expected, row.coach) : undefined;
    attempts.push({...row, score, runAt: report.generatedAt, reportFile: path, referenceReview: report.referenceReview,
      protocol: {reviewMode: report.reviewMode, visualReferences: report.inference.visualReferences || null, actualSampleRates: report.inference.actualSampleRates, codeHashes: report.codeHashes}});
  }
}
attempts.sort((a, b) => a.runAt.localeCompare(b.runAt));
const latest = [...new Map(attempts.map(row => [row.id, row])).values()];
const requiredExercises = ['bodyweight-squat', 'pull-up', 'barbell-bench-press', 'barbell-deadlift', 'seated-cable-row'];
const limitations = {
  holdout: 'Held-out videos: report separately from development and calibration attempts. No unseen seated-row sample exists. Latest attempts, failures, and abstentions all remain counted. Author good/bad labels do not independently verify a specific correction.',
  calibration: 'Subject-03 calibration for choosing a fixed protocol, separate from development and final held-out evaluation. All attempts are retained, including reference-protocol rejections. These results cannot be claimed as final held-out accuracy.',
  development: 'A five-action development smoke test, not a general accuracy study. Latest attempt per clip determines acceptance; all earlier errors and retries are retained below. Independent assistant visual references are not professional ground truth. Some Commons videos contain exercise-name subtitles.',
};
const partitionLabels = {holdout: '隔人保留集（坐姿划船无独立样本）', calibration: '跨人校准集（用于选择方案，不属于最终验收）', development: '开发诊断集（不能据此推断大部分视频准确率）'};
const result = {generatedAt: new Date().toISOString(), partition, limitation: limitations[partition],
  requiredExercises, current: summarizeDatasetResults(latest, {acceptance: partition === 'development' ? 'each-exercise' : 'rate'}), allAttempts: summarizeDatasetResults(attempts), latest, attempts};
result.allRequestedExercisesHaveJointSuccess = requiredExercises.every(exercise => result.current.exerciseAcceptance.exercises[exercise]?.hasJointSuccess === true);
result.missingExercises = requiredExercises.filter(exercise => !result.current.exerciseAcceptance.exercises[exercise]);
result.missingExerciseInterpretation = 'Missing classes indicate missing evaluation samples, not a misclassified video. They limit claims about coverage of all five requested actions.';
await mkdir(output, {recursive: true});
await writeFile(join(output, 'summary.json'), JSON.stringify(result, null, 2));
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const names = {standard: '相对标准', 'needs-improvement': '需要调整', uncertain: '不确定'};
const fraction = metric => `${metric.correct}/${metric.total}${metric.total ? `（${(100 * metric.rate).toFixed(1)}%）` : '（无可评分样本）'}`;
const denominatorSummary = `严格动作 ID 匹配：${fraction(result.current.overall.action)}；姿势作者标注匹配：${fraction(result.current.formReferences.authorLabels.quality)}；家族匹配另列：${fraction(result.current.overall.family)}。家族匹配不能替代动作、姿势或建议正确。`;
const seconds = ms => Number.isFinite(ms) ? (ms / 1000).toFixed(2) + ' 秒' : '无数据';
const timingSummary = `AI 阶段耗时中位数 ${seconds(result.current.timingMs.coach.p50)}、P95 ${seconds(result.current.timingMs.coach.p95)}；累计处理耗时中位数 ${seconds(result.current.timingMs.total.p50)}、P95 ${seconds(result.current.timingMs.total.p95)}。${latest.some(row => row.replayedPose) ? '本次使用真实缓存回放，累计耗时为原提取耗时与本次评价耗时之和，不能视为一次连续界面操作的墙钟测量。' : ''}`;
const acceptanceText = partition === 'development'
  ? `当前每个动作至少一条动作与评价同时匹配参考：<b>${result.allRequestedExercisesHaveJointSuccess ? '已达到' : '尚未达到'}</b>。`
  : partition === 'holdout' ? '本集坐姿划船缺独立样本；这是覆盖证据不足，不记作某条视频的识别错误。原始失败和不确定均计入其对应分母。'
    : '此分区仅用于选择配置，不能据此宣称最终保留集正确率。';
const evidenceGalleries = new Map(await Promise.all(latest.map(async row => {
  const images = [];
  for (const [index, frame] of (row.keyframeFiles || []).slice(0, 6).entries()) {
    const label = `图片 ${index + 1} · ${Number.isFinite(frame.time) ? frame.time.toFixed(3) : '未知'} 秒`;
    try {
      const path = await datasetVideoPath(dirname(row.reportFile), frame.filename);
      const url = encodeURI(relative(output, path).split(sep).join('/'));
      images.push(`<figure><a href="${escape(url)}" target="_blank" rel="noopener"><img src="${escape(url)}" loading="lazy" alt="${escape(label)}"></a><figcaption>${escape(label)}</figcaption></figure>`);
    } catch { images.push(`<figure><p>对应图片文件缺失</p><figcaption>${escape(label)}</figcaption></figure>`); }
  }
  return [row.id, images.length ? `<div class="evidence">${images.join('')}</div>` : '<p>本次记录没有可用的证据截图。</p>'];
})));
const table = counts => `<pre>${escape(JSON.stringify(counts, null, 2))}</pre>`;
const confusions = `<h2>混淆表与平衡正确率</h2><p>按参考行、预测列；未标注、未确定和失败分别保留。平衡正确率为好动作与坏动作召回率的平均值，避免全部判“需要调整”得高分。</p><h3>正误结论</h3>${table(result.current.overall.qualityConfusion)}<p>平衡正确率：${result.current.overall.qualityBalancedAccuracy === null ? '无两类参考，无法计算' : (100 * result.current.overall.qualityBalancedAccuracy).toFixed(1) + '%'}</p><h3>严格动作名称</h3>${table(result.current.confusion.actionId)}<h3>动作家族</h3>${table(result.current.confusion.family)}<h2>纠正理由核对清单</h2><p>“需要调整”标签一致不等于建议指出了真实错误；下表必须由独立审阅者对照视频人工核对。没有具体错误标签的样本无法自动计算纠正准确率。</p><table><thead><tr><th>视频</th><th>作者具体错误</th><th>模型提出的问题</th><th>纠正准确率</th></tr></thead><tbody>${latest.filter(row => row.expected.qualityLabel === 'author_bad').map(row => `<tr><td>${escape(row.id)}</td><td>${escape(row.expected.specificFault || '只有作者正误标签，无具体错误类别')}</td><td>${escape((row.coach?.feedback || []).filter(item => item.status === 'improve').map(item => item.title + ': ' + item.evidence).join('；') || '无有效纠正')}</td><td>未自动评分，待人工核对</td></tr>`).join('')}</tbody></table>`;
const display = row => `<tr><td>${escape(row.expected.exerciseNameZh || row.expected.exercise)}<br><small>${escape(row.id)}</small></td><td>${escape(row.coach?.action?.name || '未完成')}<br>${row.score?.actionCorrect === true ? '✓ 动作匹配' : '✕ 未匹配'}</td><td>${escape(names[row.score?.expectedVerdict] || '无正误参考')}<br><small>${['author_good', 'author_bad'].includes(row.expected.qualityLabel) ? '作者标注' : row.expected.independentReview ? '事前助手视觉核对' : '仅动作名称'}</small></td><td>${escape(names[row.coach?.verdict?.status] || '未发布评价')}<br>${escape(row.error || row.coach?.verdict?.summary || '')}</td><td>${expectedVerdict(row.expected) === null ? '— 未评分' : row.score?.jointCorrect === true ? '✓' : '✕'}</td><td>${row.timing?.coach ? (row.timing.coach / 1000).toFixed(2) : '—'} s</td></tr>`;
await writeFile(join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>五个主流动作真实视频核验</title><style>body{margin:32px;font:15px/1.6 system-ui;color:#182c38;background:#edf3f6}main{max-width:1250px;margin:auto}table{border-collapse:collapse;width:100%;background:white}td,th{padding:14px;text-align:left;vertical-align:top;border-bottom:1px solid #dde6ea}small{font-size:11px;overflow-wrap:anywhere;color:#536874}h1{font-size:27px}p{max-width:1000px}.box{background:white;padding:20px;border-radius:12px;margin:20px 0}li{margin:10px 0}.evidence{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.evidence figure{margin:0;background:#f1f5f7;padding:6px}.evidence img{display:block;width:100%;height:240px;object-fit:contain}.evidence figcaption{font-size:12px;color:#526775}</style><main><h1>五个主流动作 · 真实视频核验</h1><p><b>分区：${partitionLabels[partition]}</b></p><p>这是固定视频的小规模验证。动作来源名称与作者正误标签只用于评分，未送入模型；未标注演示片只计动作识别；若另外提供事前助手视觉核对，会单列且不视为专业教练真值。部分 Commons 原片含动作名称字幕。所有重试、错误均保留。</p><div class="box">${acceptanceText}<p>${denominatorSummary}</p><p>${timingSummary}</p>当前 ${latest.length} 个视频；累计 ${attempts.length} 次尝试。</div><h2>当前结果（每个视频最近一次）</h2><table><thead><tr><th>视频</th><th>识别</th><th>参考结论</th><th>模型结论</th><th>联合匹配</th><th>AI耗时</th></tr></thead><tbody>${latest.map(display).join('')}</tbody></table><h2>模型给出的具体建议</h2>${latest.map(row => `<div class="box"><h3>${escape(row.expected.exerciseNameZh || row.expected.exercise)}</h3><small>${escape(row.id)}</small>${evidenceGalleries.get(row.id)}<p>${escape(row.coach?.verdict?.summary || row.error)}</p><ul>${(row.coach?.feedback || []).map(feedback => `<li><b>${escape(feedback.title)}</b>（${escape(feedback.status)}）<br>证据：${escape(feedback.evidence)}<br>建议：${escape(feedback.correction)}<br><small>时间 ${escape((feedback.evidenceTimes || []).join(', '))} 秒</small></li>`).join('')}</ul></div>`).join('')}${confusions}<h2>全部尝试（含失败，不作为当前正确率分母替换）</h2><table><thead><tr><th>视频</th><th>识别</th><th>参考结论</th><th>模型结论</th><th>联合匹配</th><th>AI耗时</th></tr></thead><tbody>${attempts.map(display).join('')}</tbody></table></main>`);
console.log(JSON.stringify({output, attempts: attempts.length, latestClips: latest.length, eachExercise: result.current.exerciseAcceptance}, null, 2));
