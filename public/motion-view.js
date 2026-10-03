import { analyzeVideo, validateVideoFile, scaledVideoSize, MOTION_VIDEO_LIMITS } from './motion-video.js';
import { analyzeMotion } from './motion-analysis.js';

const exerciseNames = { squat: '徒手深蹲', pushup: '俯卧撑' };
const connections = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32]];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const percent = value => finite(value) ? Math.round(Math.max(0,Math.min(1,value))*100) : 0;
const number = (value, digits=0) => finite(value) ? value.toFixed(digits) : '—';
const clock = value => { const seconds=Math.max(0,Math.floor(Number(value)||0)); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; };
const preciseClock = value => {const ticks=Math.round(Math.max(0,Number(value)||0)*10);return `${Math.floor(ticks/600)}:${((ticks%600)/10).toFixed(1).padStart(4,'0')}`;};
const scoreText = value => finite(value) ? String(Math.round(value)) : '—';
const metricLabels = {
  duration:['单次时长','秒'], descentDuration:['下降用时','秒'], ascentDuration:['上升用时','秒'],
  bottomAngle:['最低点关节角','°'], angleRange:['关节活动幅度','°'], maxTorsoLean:['肩髋连线前倾角','°'],
  bodyAlignmentAngle:['肩髋踝夹角','°'], excessAngleTravel:['额外往返幅度','%'],
};
const componentLabels={rangeOfMotion:'动作幅度',trunk:'躯干倾斜',alignment:'身体连线',control:'轨迹控制'};
function metricsHtml(metrics,exerciseId) {
  return Object.entries(metrics || {}).flatMap(([key,value])=>{
    if(!metricLabels[key]||!finite(value))return [];
    const [baseLabel,unit]=metricLabels[key],label=key==='bottomAngle'?(exerciseId==='squat'?'最低点膝角':'最低点肘角'):baseLabel;
    return [`<div><dt>${label}</dt><dd>${number(unit==='%'?value*100:value,unit==='秒'?1:0)}<small>${unit}</small></dd></div>`];
  }).join('');
}
function dateLabel(value) { const date=new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '已保存'; }
function normalizedReport(value) { return value?.data && typeof value.data==='object' ? {...value.data,id:value.id} : value; }

/** Local video analysis owns its media, abort controller and render loop. */
export function mountMotionView(container,{saveAssessment,listAssessments,deleteAssessment,openExercise,notify=()=>{}}={}) {
  let destroyed=false, file=null, objectUrl=null, pipeline=null, result=null, controller=null;
  let running=false, saved=false, saving=false, selectedHistory=null, history=[], historyRevision=0, animationId=0, analysisRevision=0;
  let metadata=null, lastAnnouncement=0, deletionId=null;
  const listeners=new AbortController();
  container.innerHTML=`<section class="motion-page" aria-label="视频动作评估">
    <header class="motion-heading"><div><span class="eyebrow">MOVEMENT CHECK</span><h1>看清动作，练得更稳。</h1><p>选择一段训练视频，查看每一次动作的幅度、节奏与姿态。</p></div><span class="motion-local-badge"><span aria-hidden="true">●</span> 本机分析</span></header>
    <div class="motion-workspace">
      <section class="motion-input card" aria-labelledby="motion-upload-title">
        <div class="motion-section-head"><div><span class="motion-step">01 / 选择视频</span><h2 id="motion-upload-title">从一组动作开始</h2></div><span class="badge neutral">自动识别</span></div>
        <input type="file" data-motion-file accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm" hidden aria-label="选择训练视频">
        <button type="button" class="motion-dropzone" data-motion-action="choose"><span class="motion-upload-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="6" y="10" width="36" height="28" rx="8" stroke="currentColor" stroke-width="1.8"/><path d="m21 18 10 6-10 6V18Z" fill="currentColor"/><path d="M12 5v5m24-5v5M12 38v5m24-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><strong>选择或拖入训练视频</strong><span>MP4、MOV、WebM · 需浏览器支持视频编码</span><small>最长 ${MOTION_VIDEO_LIMITS.maxDuration/60} 分钟 · 最大 ${MOTION_VIDEO_LIMITS.maxBytes/1024/1024} MB</small><span class="motion-choose-label">选择视频 <span aria-hidden="true">↗</span></span></button>
        <div class="motion-file-details" data-motion-metadata hidden></div>
        <div class="motion-player" data-motion-player hidden><video data-motion-video controls playsinline preload="metadata" aria-label="训练视频回放"></video><canvas data-motion-canvas aria-hidden="true"></canvas></div>
        <div class="motion-playback-note" data-motion-playback hidden><label><input type="checkbox" data-motion-overlay checked> 显示识别骨架</label><span>骨架随回放时间显示</span></div>
        <div class="motion-run-controls" data-motion-controls hidden><button type="button" class="button primary" data-motion-action="analyze" disabled>开始评估</button><button type="button" class="button" data-motion-action="choose">换一段视频</button></div>
        <section class="motion-progress" data-motion-progress hidden aria-label="分析进度"><div><strong data-motion-progress-title>正在准备</strong><span data-motion-percent>0%</span></div><progress max="1" value="0" aria-label="视频分析进度"></progress><p data-motion-progress-message role="status" aria-live="polite">正在载入姿态模型…</p><button type="button" class="button small" data-motion-action="cancel">取消分析</button></section>
        <div class="motion-error" data-motion-error role="alert" hidden></div>
        <p class="motion-privacy">视频仅在当前设备处理，不上传原视频，不需要 API Key。首次使用会下载姿态模型；保存报告仅同步分析摘要。</p>
      </section>
      <aside class="motion-guide" aria-labelledby="motion-guide-title"><span class="motion-step">拍摄小提示</span><h2 id="motion-guide-title">清楚的画面，<br>才有可靠的反馈。</h2><div class="motion-supported"><span>徒手深蹲</span><span>俯卧撑</span></div><ol><li><span>01</span><div><strong>从身体侧面拍摄</strong><p>手机固定，镜头与身体大致垂直，尽量避开斜前方。</p></div></li><li><span>02</span><div><strong>全身保持在画面里</strong><p>从头到脚都可见，画面中只保留一位训练者。</p></div></li><li><span>03</span><div><strong>录下连续的完整动作</strong><p>建议拍摄 3–8 次，包含站直或撑起的起点与终点。</p></div></li></ol><p class="motion-guide-foot">当前为动作评估试验版。评分来自可观察的姿态规则；看不清或不支持的动作会说明原因。</p></aside>
    </div>
    <section class="motion-results" data-motion-results aria-labelledby="motion-result-title" hidden></section>
    <section class="motion-history" aria-labelledby="motion-history-title"><div class="motion-section-head"><div><span class="motion-step">你的记录</span><h2 id="motion-history-title">动作评估记录</h2></div><span data-motion-history-count></span></div><div data-motion-history><p class="motion-empty">正在读取已保存的报告…</p></div></section>
  </section>`;
  const root=container.querySelector('.motion-page');
  const find=selector=>root.querySelector(selector);
  const video=find('[data-motion-video]'), canvas=find('[data-motion-canvas]'), fileInput=find('[data-motion-file]');
  const context=canvas.getContext('2d');
  const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...options,signal:listeners.signal});
  function error(message) { const element=find('[data-motion-error]'); element.hidden=!message; element.textContent=message||''; }
  function releaseMedia() {
    video.pause(); video.removeAttribute('src'); video.load();
    if(objectUrl)URL.revokeObjectURL(objectUrl);
    objectUrl=null; pipeline=null; metadata=null;
    context?.clearRect(0,0,canvas.width,canvas.height);
  }
  function cancel() { analysisRevision++; controller?.abort(); controller=null; running=false; }
  function controls() {
    find('[data-motion-controls]').hidden=!file||running;
    find('[data-motion-progress]').hidden=!running;
    const start=find('[data-motion-action="analyze"]');
    start.disabled=!metadata||running;
    start.textContent=result?'重新评估':'开始评估';
    find('.motion-input').setAttribute('aria-busy',String(running));
    find('[data-motion-playback]').hidden=!pipeline;
  }
  function selectFile(chosen) {
    if(destroyed||!chosen)return;
    try {validateVideoFile(chosen);} catch(cause) {error(cause.message);return;}
    cancel();releaseMedia();file=chosen;result=null;saved=false;selectedHistory=null;saving=false;error('');
    find('[data-motion-results]').hidden=true;
    find('.motion-dropzone').hidden=true;
    find('[data-motion-player]').hidden=false;
    const details=find('[data-motion-metadata]');details.hidden=false;details.innerHTML=`<div><strong>${escapeHtml(file.name)}</strong><small>正在读取视频信息…</small></div><span>${number(file.size/1024/1024,1)} MB</span>`;
    objectUrl=URL.createObjectURL(file);video.src=objectUrl;controls();
  }
  function metadataReady() {
    if(!file||!finite(video.duration)||video.duration<=0)return;
    if(video.duration>MOTION_VIDEO_LIMITS.maxDuration) {metadata=null;error(`视频超过 ${MOTION_VIDEO_LIMITS.maxDuration/60} 分钟，请裁剪为一组完整动作后重新选择。`);controls();return;}
    metadata={width:video.videoWidth,height:video.videoHeight,duration:video.duration};
    const details=find('[data-motion-metadata]');
    details.innerHTML=`<div><strong>${escapeHtml(file.name)}</strong><small>${clock(metadata.duration)} · ${metadata.width} × ${metadata.height}</small></div><span>${number(file.size/1024/1024,1)} MB</span>`;
    const overlaySize=scaledVideoSize(metadata.width,metadata.height);
    canvas.width=overlaySize.width;canvas.height=overlaySize.height;
    controls();
  }
  function updateProgress(value={}) {
    const progress=Math.max(0,Math.min(1,Number(value.progress)||0));
    const stage=value.stage||value.phase;
    find('progress').value=progress;find('[data-motion-percent]').textContent=`${Math.round(progress*100)}%`;
    find('[data-motion-progress-title]').textContent=stage==='loading'?'正在载入姿态模型':stage==='decoding'?'正在准备视频':'正在识别动作轨迹';
    const now=performance.now();
    if(now-lastAnnouncement>900||progress===1) {
      lastAnnouncement=now;
      const processed=value.processedFrames??value.processed,total=value.totalFrames??value.total;
      find('[data-motion-progress-message]').textContent=value.message||(total?`已分析 ${processed||0} / ${total} 帧，请保持当前页面打开。`:'正在准备本机分析，请稍候。');
    }
  }
  async function run() {
    if(!file||!metadata||running||destroyed)return;
    cancel();const revision=analysisRevision, activeFile=file;
    controller=new AbortController();const signal=controller.signal;
    running=true;result=null;pipeline=null;saved=false;saving=false;selectedHistory=null;
    video.pause();context?.clearRect(0,0,canvas.width,canvas.height);
    error('');find('[data-motion-results]').hidden=true;controls();updateProgress({stage:'loading',progress:0,message:'首次使用需要下载姿态模型，请保持当前页面打开。'});
    try {
      const output=await analyzeVideo(activeFile,{signal,onProgress:value=>{if(!destroyed&&revision===analysisRevision)updateProgress(value);}});
      if(destroyed||signal.aborted||revision!==analysisRevision)return;
      const assessment=analyzeMotion(output.frames,{width:output.width,height:output.height,duration:output.duration,sourceFps:output.sourceFps});
      pipeline=output;result=assessment;
      running=false;controller=null;controls();renderResult(result);drawOverlay();
      notify(assessment.status==='complete'?'动作评估完成。':'视频分析完成，请查看说明。');
    } catch(cause) {
      if(destroyed||revision!==analysisRevision)return;
      running=false;controller=null;controls();
      if(cause?.name==='AbortError')error('分析已取消，可以重新开始。');
      else error(cause?.message||'视频分析失败，请检查视频格式后重试。');
    }
  }
  function nearestFrame(time) {
    const frames=pipeline?.frames;if(!frames?.length)return null;
    let low=0,high=frames.length-1;
    while(low<high){const middle=Math.floor((low+high)/2);if(frames[middle].time<time)low=middle+1;else high=middle;}
    const after=frames[low],before=frames[Math.max(0,low-1)],frame=Math.abs(after.time-time)<Math.abs(before.time-time)?after:before;
    return Math.abs(frame.time-time)<=Math.max(.18,1.5/(pipeline.sampleFps||15))?frame:null;
  }
  function drawOverlay() {
    if(!context||destroyed)return;
    context.clearRect(0,0,canvas.width,canvas.height);
    if(video.seeking)return;
    if(!find('[data-motion-overlay]').checked)return;
    const points=nearestFrame(video.currentTime)?.landmarks;
    if(!points?.length)return;
    const visible=point=>point&&finite(point.x)&&finite(point.y)&&(point.visibility??1)>=.5&&(point.presence??1)>=.5;
    const scale=Math.max(1,Math.min(canvas.width,canvas.height)/450);
    context.lineWidth=2.4*scale;context.lineCap='round';context.strokeStyle='#91ffcd';context.shadowColor='#111827';context.shadowBlur=2*scale;
    for(const [a,b] of connections)if(visible(points[a])&&visible(points[b])) {context.beginPath();context.moveTo(points[a].x*canvas.width,points[a].y*canvas.height);context.lineTo(points[b].x*canvas.width,points[b].y*canvas.height);context.stroke();}
    context.fillStyle='#ffffff';
    for(const index of new Set(connections.flat()))if(visible(points[index])) {context.beginPath();context.arc(points[index].x*canvas.width,points[index].y*canvas.height,3.3*scale,0,Math.PI*2);context.fill();}
    context.shadowBlur=0;
  }
  function playbackLoop() { if(destroyed)return;drawOverlay();if(!video.paused&&!video.ended)animationId=requestAnimationFrame(playbackLoop); }
  function timestampButton(time,label,canSeek) {return canSeek&&finite(time)?`<button type="button" class="motion-time" data-motion-action="seek" data-time="${time}" aria-label="跳转到 ${escapeHtml(preciseClock(time))} 查看${escapeHtml(label)}">${preciseClock(time)} <span aria-hidden="true">↗</span></button>`:`<span class="motion-time">${preciseClock(time)}</span>`;}
  function renderResult(report,fromHistory=false) {
    const section=find('[data-motion-results]');section.hidden=false;
    const complete=report.status==='complete',canSeek=!fromHistory&&!!pipeline;
    const reps=Array.isArray(report.reps)?report.reps:[],issues=Array.isArray(report.issues)?report.issues:[];
    const quality=report.quality||{},name=exerciseNames[report.exerciseId]||'未识别出支持的动作';
    const title=complete?name:report.status==='unsupported'?'暂不支持这段动作':'这段视频还不足以评分';
    const reasons=(Array.isArray(quality.reasons)?quality.reasons:[]).map(reason=>issues.find(issue=>issue.code===reason)?.message||(/^[A-Z_]+$/.test(reason)?report.summary:reason)).filter(Boolean);
    if(complete&&!finite(quality.sourceFps))reasons.push('未能确认原视频帧率，低帧率视频的计次可靠性有限。');
    const overallMetrics={};
    for(const key of Object.keys(metricLabels)){const values=reps.map(rep=>rep.metrics?.[key]).filter(finite);if(values.length)overallMetrics[key]=values.reduce((sum,value)=>sum+value,0)/values.length;}
    const components=Object.entries(componentLabels).flatMap(([key,label])=>{const values=reps.map(rep=>rep.metrics?.components?.[key]).filter(value=>finite(value?.score));return values.length?[{label,score:values.reduce((sum,value)=>sum+value.score,0)/values.length,target:values[0].target}]:[];});
    section.innerHTML=`<div class="motion-section-head"><div><span class="motion-step">${fromHistory?'已保存的分析摘要':'02 / 评估结果'}</span><h2 id="motion-result-title">${escapeHtml(title)}</h2></div>${fromHistory&&result?'<button type="button" class="button small" data-motion-action="live-result">返回本次结果</button>':''}</div>
      ${fromHistory?'<p class="motion-history-notice">这是已保存的摘要，未保存原视频或骨架轨迹。重新选择视频并分析后可查看回放。</p>':''}
      <div class="motion-result-overview${complete?'':' is-unscored'}"><div class="motion-score"><span>${complete?'动作参考分':'本次评分'}</span><strong>${scoreText(report.score)}${finite(report.score)?'<small>/ 100</small>':''}</strong><p>${complete?'规则评估 · 试验版':'需要更合适的视频'}</p></div><div class="motion-result-summary"><p>${escapeHtml(report.summary||'请查看下方逐次反馈。')}</p><div class="motion-result-facts"><div><span>已分析次数</span><strong>${reps.length}<small> 次</small></strong></div><div><span>可用画面</span><strong>${percent(quality.usableRatio)}<small>%</small></strong></div><div><span>拍摄视角</span><strong>${quality.view==='side'?'侧面':quality.view==='oblique'?'略微倾斜':'待确认'}</strong></div></div></div></div>
      ${reasons.length?`<ul class="motion-quality-notes">${reasons.map(reason=>`<li>${escapeHtml(reason)}</li>`).join('')}</ul>`:''}
      ${complete?`<p class="motion-score-note">识别依据：${report.exerciseConfidence>=.8?'充分':'有限'}。参考分检查${report.exerciseId==='squat'?'侧面可见膝角、肩髋连线倾斜和关节轨迹连续性':'侧面可见肘角、肩髋踝连线和关节轨迹连续性'}；不涵盖全部动作细节，评分规则仍需真实视频校准。</p>`:''}
      ${components.length?`<section class="motion-metric-section"><h3>分项反馈 <small>已分析次数的均值</small></h3><div class="motion-components">${components.map(component=>`<article><span>${component.label}</span><strong>${scoreText(component.score)}<small> / 100</small></strong><p>${escapeHtml(component.target)}</p></article>`).join('')}</div></section>`:''}
      ${Object.keys(overallMetrics).length?`<details class="motion-metric-section motion-measurements"><summary>查看测得的动作指标 <small>已分析次数的均值</small></summary><dl class="motion-metrics">${metricsHtml(overallMetrics,report.exerciseId)}</dl></details>`:''}
      ${issues.length?`<section class="motion-findings"><h3>值得留意的片段</h3><ul>${issues.slice(0,20).map(issue=>`<li>${timestampButton(issue.time,'这个问题',canSeek)}<p>${escapeHtml(issue.message)}</p></li>`).join('')}</ul></section>`:''}
      ${reps.length?`<section class="motion-reps"><h3>逐次查看 <span>${reps.length} 次</span></h3><div class="motion-rep-grid">${reps.map((rep,index)=>`<article class="motion-rep"><header><strong>第 ${Number.isInteger(rep.index)?rep.index:index+1} 次</strong>${timestampButton(rep.time??rep.bottom??rep.start,'这次动作',canSeek)}<span>${scoreText(rep.score)}<small> 分</small></span></header><p class="motion-rep-range">${clock(rep.start)} — ${clock(rep.end)}${rep.qualified===false?' · 有待改进':''}</p><dl class="motion-rep-metrics">${metricsHtml(rep.metrics,report.exerciseId)}</dl>${rep.issues?.length?`<ul>${rep.issues.map(issue=>`<li>${escapeHtml(issue.message)}</li>`).join('')}</ul>`:'<p class="motion-rep-ok">本次未触发已检查的动作问题。</p>'}</article>`).join('')}</div></section>`:''}
      <div class="motion-result-actions">${complete&&!fromHistory&&typeof saveAssessment==='function'?`<button type="button" class="button primary" data-motion-action="save" ${saved||saving?'disabled':''}>${saved?'已保存报告':saving?'正在保存…':'保存报告'}</button>`:''}${exerciseNames[report.exerciseId]&&typeof openExercise==='function'?`<button type="button" class="button" data-motion-action="exercise" data-exercise="${escapeHtml(report.exerciseId)}">查看 ${escapeHtml(name)} 3D 教学 <span aria-hidden="true">↗</span></button>`:''}<small>报告单独保存，不会自动标记训练完成。</small></div>`;
  }
  async function refreshHistory() {
    const revision=++historyRevision;
    try {
      const values=typeof listAssessments==='function'?await listAssessments():[];
      if(destroyed||revision!==historyRevision)return;
      history=(Array.isArray(values)?values:[]).map(normalizedReport).filter(item=>item&&typeof item.id==='string').sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
      renderHistory();
    } catch(cause) {if(!destroyed&&revision===historyRevision)find('[data-motion-history]').innerHTML='<p class="motion-empty">读取记录失败，可刷新页面重试。</p>';}
  }
  function renderHistory() {
    find('[data-motion-history-count]').textContent=history.length?`${history.length} 份报告`:'';
    find('[data-motion-history]').innerHTML=history.length?`<div class="motion-history-list">${history.map((report,index)=>`<article class="motion-history-item"><span class="motion-history-score">${scoreText(report.score)}<small>分</small></span><div><strong>${escapeHtml(exerciseNames[report.exerciseId]||'动作评估')}</strong><p>${escapeHtml(dateLabel(report.createdAt))} · ${Array.isArray(report.reps)?report.reps.length:0} 次 · ${clock(report.video?.duration)}</p></div><button type="button" class="button small" data-motion-action="history" data-history="${index}">查看报告</button>${typeof deleteAssessment==='function'?`<button type="button" class="motion-delete" data-motion-action="delete" data-history="${index}" ${deletionId===report.id?'disabled':''} aria-label="删除 ${escapeHtml(dateLabel(report.createdAt))} 的${escapeHtml(exerciseNames[report.exerciseId]||'动作评估')}报告">${deletionId===report.id?'删除中…':'删除'}</button>`:''}</article>`).join('')}</div>`:'<p class="motion-empty">还没有保存的报告。完成一次评估后，可以在这里回看。</p>';
  }
  async function save() {
    if(!result||result.status!=='complete'||saved||saving||typeof saveAssessment!=='function')return;
    error('');saving=true;renderResult(result);
    const currentResult=result;
    const summary={...result,createdAt:new Date().toISOString(),video:{name:file.name,size:file.size,width:pipeline.width,height:pipeline.height,duration:pipeline.duration},analysis:{modelVersion:pipeline.modelVersion,sampleFps:pipeline.sampleFps,sourceFps:pipeline.sourceFps??null,decoder:pipeline.decoder,elapsedMs:pipeline.elapsedMs}};
    try {
      await saveAssessment(summary);
      if(destroyed)return;
      if(currentResult===result){saved=true;saving=false;if(!selectedHistory)renderResult(result);}
      notify('报告已保存，原视频未上传。');await refreshHistory();
    } catch(cause) {if(!destroyed&&currentResult===result){saving=false;if(!selectedHistory)renderResult(result);const message=cause?.message||'报告保存失败，请重试。';error(message);notify(message,true);}}
  }
  async function removeReport(index) {
    const report=history[index];if(!report||deletionId||typeof deleteAssessment!=='function')return;
    deletionId=report.id;renderHistory();
    try {await deleteAssessment(report.id);if(destroyed)return;if(selectedHistory===report.id){selectedHistory=null;if(result)renderResult(result);else find('[data-motion-results]').hidden=true;}notify('报告已删除。');await refreshHistory();}
    catch(cause){if(!destroyed){const message=cause?.message||'删除报告失败，请重试。';error(message);notify(message,true);}}
    finally{deletionId=null;if(!destroyed)renderHistory();}
  }
  listen(root,'click',event=>{
    const button=event.target.closest('[data-motion-action]');if(!button||button.disabled)return;
    const action=button.dataset.motionAction;
    if(action==='choose')fileInput.click();
    else if(action==='analyze')void run();
    else if(action==='cancel'){cancel();controls();error('分析已取消，可以重新开始。');}
    else if(action==='save')void save();
    else if(action==='exercise')openExercise?.(button.dataset.exercise);
    else if(action==='history'){const report=history[Number(button.dataset.history)];if(report){selectedHistory=report.id;renderResult(report,true);find('[data-motion-results]').scrollIntoView({behavior:'smooth',block:'start'});}}
    else if(action==='live-result'){selectedHistory=null;if(result)renderResult(result);}
    else if(action==='delete')void removeReport(Number(button.dataset.history));
    else if(action==='seek'&&pipeline){video.pause();context?.clearRect(0,0,canvas.width,canvas.height);video.currentTime=Math.max(0,Math.min(video.duration,Number(button.dataset.time)||0));video.focus({preventScroll:true});find('[data-motion-player]').scrollIntoView({behavior:'smooth',block:'center'});}
  });
  listen(fileInput,'change',()=>{selectFile(fileInput.files?.[0]);fileInput.value='';});
  listen(find('.motion-input'),'dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';find('.motion-input').classList.add('is-dragover');}});
  listen(find('.motion-input'),'dragleave',event=>{if(!find('.motion-input').contains(event.relatedTarget))find('.motion-input').classList.remove('is-dragover');});
  listen(find('.motion-input'),'drop',event=>{event.preventDefault();find('.motion-input').classList.remove('is-dragover');const files=event.dataTransfer?.files;if(files?.length>1)notify('一次评估一段视频，已选择第一个文件。');selectFile(files?.[0]);});
  listen(video,'loadedmetadata',metadataReady);
  listen(video,'error',()=>{if(file&&objectUrl){metadata=null;controls();error('浏览器无法播放这个视频，请换用 MP4（H.264）或 WebM 视频。');}});
  listen(video,'play',()=>{cancelAnimationFrame(animationId);playbackLoop();});
  listen(video,'pause',()=>{cancelAnimationFrame(animationId);drawOverlay();});
  listen(video,'seeking',()=>context?.clearRect(0,0,canvas.width,canvas.height));
  listen(video,'seeked',drawOverlay);listen(video,'timeupdate',drawOverlay);
  listen(find('[data-motion-overlay]'),'change',drawOverlay);
  void refreshHistory();
  return {refreshHistory,destroy(){if(destroyed)return;destroyed=true;cancel();listeners.abort();cancelAnimationFrame(animationId);releaseMedia();file=null;result=null;history=[];}};
}
