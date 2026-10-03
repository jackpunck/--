import { analyzeVideo, validateVideoFile, scaledVideoSize, MOTION_VIDEO_LIMITS } from './motion-video.js';
import { analyzeMotion } from './motion-analysis.js';
import { motionExercises, motionFamilies, getMotionExercise } from './motion-catalog.js';
import { buildMotionEvidence, summarizeMotionAnalysis } from './motion-evidence.js';
import { mergeCoachAssessment, confirmedMotionAction, MOTION_HARD_QUALITY_FAILURES } from './motion-contract.js';

const exerciseNames = Object.fromEntries(motionExercises.map(item=>[item.id,item.name]));
const checkLabels = Object.fromEntries(motionExercises.flatMap(item=>(item.checks||[]).map(check=>[check.code,check.label])));
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
  heelLiftRange:['脚跟升降 / 躯干长度',''], peakHeelLift:['最大抬跟 / 躯干长度',''],
  holdDuration:['连续保持时间','秒'],
};
const componentLabels={rangeOfMotion:'动作幅度',trunk:'躯干倾斜',alignment:'身体连线',control:'轨迹控制'};
const checkStatus={pass:'通过',fail:'需要纠正',unobservable:'未能判断',uncertain:'未能判断'};
const viewNames={side:'侧面',front:'正面',oblique:'斜侧面','front-or-oblique':'正面或斜侧面',uncertain:'待确认',mixed:'多个视角'};
const equipmentNames={dumbbell:'哑铃',barbell:'杠铃','smith-machine':'史密斯机',machine:'固定器械',cable:'绳索','pullup-bar':'单杠','assisted-pullup-machine':'辅助引体器械',kettlebell:'壶铃','parallel-bars':'双杠'};
const supportNames={'flat-bench':'平凳','incline-bench':'上斜凳',seated:'坐姿','bent-over':'俯身','single-arm-supported':'单臂支撑','chest-supported':'胸部支撑',hanging:'悬垂',standing:'站姿',suspended:'悬空支撑'};
const assistanceNames={none:'无辅助',machine:'器械助力',band:'弹力带助力',partner:'他人助力',unknown:'辅助情况待确认'};
const observedLabel = (labels,key) => Object.hasOwn(labels,key)?labels[key]:null;
function metricsHtml(metrics,exerciseId,familyHint) {
  const family=getMotionExercise(exerciseId)?.family||familyHint;
  const joint=['squat','lunge','knee-isolation'].includes(family)?'膝':(['hinge','bridge','crunch'].includes(family)?'髋':(['lateral-raise','reverse-fly'].includes(family)?'抬臂':'肘'));
  return Object.entries(metrics || {}).flatMap(([key,value])=>{
    if(!metricLabels[key]||!finite(value))return [];
    if(family==='calf'&&['bottomAngle','angleRange'].includes(key))return [];
    if(family==='plank'&&['descentDuration','ascentDuration','bottomAngle','angleRange',...(finite(metrics.holdDuration)?['duration']:[])].includes(key))return [];
    const [baseLabel,unit]=metricLabels[key],label=key==='bottomAngle'?`${['squat','pushup'].includes(family)?'最低点':'转折点'}${joint}角`:baseLabel;
    return [`<div><dt>${label}</dt><dd>${number(unit==='%'?value*100:value,unit==='秒'?1:unit===''?2:0)}<small>${unit}</small></dd></div>`];
  }).join('');
}
function dateLabel(value) { const date=new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '已保存'; }
function normalizedReport(value) { return value?.data && typeof value.data==='object' ? {...value.data,id:value.id} : value; }
function reportName(report) {
  if(report.recognitionConflict)return '动作名称待确认';
  if(report.recognitionSource==='visual'&&typeof report.exerciseName==='string'&&report.exerciseName.trim())return report.exerciseName;
  const family=motionFamilies[report.exerciseFamily];
  return report.requiresVisualConfirmation&&family?`${family}（变式待确认）`:exerciseNames[report.exerciseId]||report.exerciseFamilyName||family||'动作评估';
}
const isHold = report => report.exerciseId==='plank'||report.exerciseFamily==='plank';
const hasCount = report => !report.recognitionConflict&&!(report.recognitionSource==='visual'&&report.exerciseName&&!report.exerciseId&&!Object.hasOwn(motionFamilies,report.exerciseFamily))
  &&!(!report.reps?.length&&report.quality?.reasons?.some(reason=>MOTION_HARD_QUALITY_FAILURES.includes(reason)));
function repetitionUnit(report) {return report.recognitionConflict||isHold(report)?'段':'次';}

export const MAX_MOTION_ASSESSMENT_BYTES = 1024 * 1024;
export function validateMotionAssessmentSize(report) {
  if(new TextEncoder().encode(JSON.stringify(report)).byteLength>MAX_MOTION_ASSESSMENT_BYTES)throw new Error('单份动作评估报告超过 1 MB，尚未保存。请缩短视频后重新分析。');
}

/** Keep every repetition, check and evidence time. Components repeat the same
 * v2 checks and are not used by the v2 report renderer. */
export function buildMotionAssessmentReport(result,{file,pipeline,createdAt=new Date().toISOString()}) {
  const reps=(result.reps||[]).map(rep=>{
    if(!rep.metrics||typeof rep.metrics!=='object')return {...rep};
    const {components,...metrics}=rep.metrics;
    return {...rep,metrics};
  });
  return {...result,reps,createdAt,video:{name:file.name,size:file.size,width:pipeline.width,height:pipeline.height,duration:pipeline.duration},analysis:{modelVersion:pipeline.modelVersion,sampleFps:pipeline.sampleFps,sourceFps:pipeline.sourceFps??null,decoder:pipeline.decoder,elapsedMs:pipeline.elapsedMs}};
}

/** Local video analysis owns its media, abort controller and render loop. */
export function mountMotionView(container,{saveAssessment,listAssessments,deleteAssessment,openExercise,getCoachConfiguration=()=>({configured:false,vision:false}),reviewAssessment,openCoachSettings,notify=()=>{}}={}) {
  let destroyed=false, file=null, objectUrl=null, pipeline=null, result=null, controller=null;
  let running=false, saved=false, saving=false, selectedHistory=null, history=[], historyRevision=0, animationId=0, analysisRevision=0;
  let metadata=null, lastAnnouncement=0, deletionId=null;
  let coachController=null, coachRunning=false, awaitingCoach=false, coachMessage='', coachError='', coachRevision=0;
  let targetPoint=null, selectingTarget=false, selectionCursor={x:.5,y:.4};
  const coachConfig=getCoachConfiguration();
  let useCoach=!!coachConfig.configured;
  const listeners=new AbortController();
  container.innerHTML=`<section class="motion-page" aria-label="视频动作评估">
    <header class="motion-heading"><div><span class="eyebrow">MOVEMENT CHECK</span><h1>看清动作，练得更稳。</h1><p>选择一段训练视频，查看每一次动作的幅度、节奏与姿态。</p></div><span class="motion-local-badge"><span aria-hidden="true">●</span> 原视频留在本机</span></header>
    <div class="motion-workspace">
      <section class="motion-input card" aria-labelledby="motion-upload-title">
        <div class="motion-section-head"><div><span class="motion-step">01 / 选择视频</span><h2 id="motion-upload-title">从一组动作开始</h2></div><span class="badge neutral">自动识别</span></div>
        <input type="file" data-motion-file accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm" hidden aria-label="选择训练视频">
        <button type="button" class="motion-dropzone" data-motion-action="choose"><span class="motion-upload-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="6" y="10" width="36" height="28" rx="8" stroke="currentColor" stroke-width="1.8"/><path d="m21 18 10 6-10 6V18Z" fill="currentColor"/><path d="M12 5v5m24-5v5M12 38v5m24-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><strong>选择或拖入训练视频</strong><span>MP4、MOV、WebM · 需浏览器支持视频编码</span><small>最长 ${MOTION_VIDEO_LIMITS.maxDuration/60} 分钟 · 最大 ${MOTION_VIDEO_LIMITS.maxBytes/1024/1024} MB</small><span class="motion-choose-label">选择视频 <span aria-hidden="true">↗</span></span></button>
        <div class="motion-file-details" data-motion-metadata hidden></div>
        <div class="motion-player" data-motion-player hidden><video data-motion-video controls playsinline preload="metadata" aria-label="训练视频回放"></video><canvas data-motion-canvas aria-hidden="true"></canvas><div class="motion-target-picker" data-motion-target-picker role="button" tabindex="0" aria-label="点选第一帧中的训练者上半身，或用方向键移动标记并按回车确认" hidden><span data-motion-target-marker aria-hidden="true">＋</span></div></div>
        <div class="motion-target-controls" data-motion-target-controls hidden><div><strong data-motion-target-label>默认跟踪画面中央的训练者</strong><small data-motion-target-help>多人入镜时，可点选第一帧中的自己。分析后查看回放中的目标框。</small></div><button type="button" class="button small" data-motion-action="pick-target">点选训练者</button><button type="button" class="link-button" data-motion-action="reset-target" hidden>恢复默认</button></div>
        <div class="motion-playback-note" data-motion-playback hidden><label><input type="checkbox" data-motion-overlay checked> 显示目标与骨架</label><span>目标与骨架随回放显示</span></div>
        <section class="motion-coach-mode" aria-label="评估方式"><label><input type="checkbox" data-motion-ai-mode ${useCoach?'checked':''} ${coachConfig.configured?'':'disabled'}> 启用 AI 识别与点评</label><p>${coachConfig.configured?`${escapeHtml(coachConfig.provider)} · ${escapeHtml(coachConfig.model)}。${coachConfig.vision?'启用后，会将最多 6 张关键画面和检测摘要发送给该 AI 服务，用于识别动作变式、复核姿态并给出建议。':'当前模型只接收检测摘要，提供纠正建议；识别器械、握法与中立位需要视觉模型。'}`:'配置动作点评模型后，可结合关键画面识别动作变式、复核姿态并获取纠正建议。'}</p>${typeof openCoachSettings==='function'?'<button type="button" class="link-button" data-motion-action="coach-settings">配置 AI 模型</button>':''}</section>
        <div class="motion-run-controls" data-motion-controls hidden><button type="button" class="button primary" data-motion-action="analyze" disabled>开始评估</button><button type="button" class="button" data-motion-action="choose">换一段视频</button></div>
        <section class="motion-progress" data-motion-progress hidden aria-label="分析进度"><div><strong data-motion-progress-title>正在准备</strong><span data-motion-percent>0%</span></div><progress max="1" value="0" aria-label="视频分析进度"></progress><p data-motion-progress-message role="status" aria-live="polite">正在载入姿态模型…</p><button type="button" class="button small" data-motion-action="cancel">取消分析</button></section>
        <section class="motion-review-wait" data-motion-review-wait aria-label="AI 核对进度" hidden><p class="motion-coach-status" data-motion-coach-status role="status" aria-live="polite" hidden></p><p class="motion-coach-error" data-motion-coach-error role="alert" hidden></p><div class="motion-coach-actions"><button type="button" class="button small" data-motion-action="cancel-coach" hidden>取消 AI 核对</button><button type="button" class="button" data-motion-action="retry-coach" data-motion-coach-retry hidden>重试 AI 识别与点评</button><button type="button" class="button" data-motion-action="local-result" hidden>仅查看本机分析</button></div></section>
        <div class="motion-error" data-motion-error role="alert" hidden></div>
        <p class="motion-privacy">本机姿态分析不上传视频、无需 API Key。AI 点评按上方说明发送检测摘要与关键画面，原视频不上传；保存报告也不保存画面。</p>
      </section>
      <aside class="motion-guide" aria-labelledby="motion-guide-title"><span class="motion-step">动作与拍摄</span><h2 id="motion-guide-title">看具体问题，<br>再给动作评价。</h2><div class="motion-supported"><span>蹲与髋铰链</span><span>上肢推拉</span><span>肩臂训练</span><span>腿部与核心</span></div><details class="motion-catalog"><summary>查看 ${motionExercises.length} 个已有检查规则的动作</summary><ul>${motionExercises.map(item=>`<li><strong>${escapeHtml(item.name)}</strong><span>${item.localRecognition==='visual'?'结合关键画面识别':'姿态轨迹识别，变式由 AI 复核'}</span></li>`).join('')}</ul></details><ol><li><span>01</span><div><strong>根据检查项选择视角</strong><p>前倾、身体连线优先侧面；耸肩与左右对称需肩颈清楚可见。器械也应入镜。</p></div></li><li><span>02</span><div><strong>全身与训练者都清楚</strong><p>固定手机，让训练者清楚入镜。多人时默认跟踪中央人物，也可先点选自己；尽量避免相互遮挡和镜面。</p></div></li><li><span>03</span><div><strong>保留起始与完整回程</strong><p>建议录下 3–8 次，先保留自然起始姿态，便于比较肩部上提和躯干摆动。</p></div></li></ol><p class="motion-guide-foot">视觉识别也支持动作大全之外的名称。是否计次和评分取决于完整动作是否有适用检查；看不清的细节保留待确认。</p></aside>
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
  function updateCoachStatus() {
    const waiting=awaitingCoach&&!!pipeline;
    find('[data-motion-review-wait]').hidden=!waiting;
    find('[data-motion-coach-status]').hidden=!waiting;
    find('[data-motion-coach-status]').textContent=coachRunning?coachMessage:coachError?'AI 核对尚未完成，本次评估结果尚未生成。':'正在准备 AI 核对…';
    find('[data-motion-coach-error]').hidden=!waiting||!coachError;
    find('[data-motion-coach-error]').textContent=coachError;
    find('[data-motion-action="cancel-coach"]').hidden=!coachRunning;
    find('[data-motion-coach-retry]').hidden=!waiting||coachRunning;
    find('[data-motion-action="local-result"]').hidden=!waiting||coachRunning;
  }
  function renderLiveResult() {updateCoachStatus();if(!selectedHistory&&result)renderResult(result);}
  function cancelCoach() {coachRevision++;coachController?.abort();coachController=null;coachRunning=false;coachMessage='';updateCoachStatus();}
  function cancel() { analysisRevision++; controller?.abort(); controller=null; running=false;awaitingCoach=false;cancelCoach(); }
  function controls() {
    find('[data-motion-controls]').hidden=!file||running;
    find('[data-motion-progress]').hidden=!running;
    const start=find('[data-motion-action="analyze"]');
    start.disabled=!metadata||running||coachRunning||selectingTarget;
    start.textContent=result?'重新评估':'开始评估';
    find('[data-motion-ai-mode]').disabled=running||coachRunning||!coachConfig.configured;
    find('.motion-input').setAttribute('aria-busy',String(running||coachRunning));
    find('[data-motion-playback]').hidden=!pipeline;
    find('[data-motion-target-controls]').hidden=!metadata;
    find('[data-motion-action="pick-target"]').disabled=running||coachRunning||video.readyState<2;
    find('[data-motion-action="reset-target"]').disabled=running||coachRunning;
    find('[data-motion-action="reset-target"]').hidden=!targetPoint||selectingTarget;
    find('[data-motion-action="pick-target"]').textContent=selectingTarget?'取消点选':'点选训练者';
    find('[data-motion-target-label]').textContent=selectingTarget?'在第一帧中点选训练者上半身':targetPoint?'已指定训练者位置，将持续跟踪该目标':'默认跟踪画面中央的训练者';
    find('[data-motion-target-help]').textContent=selectingTarget?'点击画面确认；也可用方向键移动标记，按回车确认。':'多人入镜时，可点选第一帧中的自己。分析后查看回放中的目标框。';
    updateCoachStatus();
  }
  function pickerGeometry() {
    if(!metadata)return null;
    const rect=video.getBoundingClientRect(),scale=Math.min(rect.width/metadata.width,rect.height/metadata.height);
    const width=metadata.width*scale,height=metadata.height*scale;
    return {left:(rect.width-width)/2,top:(rect.height-height)/2,width,height,screenLeft:rect.left+(rect.width-width)/2,screenTop:rect.top+(rect.height-height)/2};
  }
  function positionPicker() {
    const box=pickerGeometry();if(!box)return;
    Object.assign(find('[data-motion-target-picker]').style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
    Object.assign(find('[data-motion-target-marker]').style,{left:(selectionCursor.x*100)+'%',top:(selectionCursor.y*100)+'%'});
  }
  function stopTargetSelection() {selectingTarget=false;video.controls=true;find('[data-motion-target-picker]').hidden=true;controls();}
  function beginTargetSelection() {
    if(!metadata||running||coachRunning)return;
    if(selectingTarget){stopTargetSelection();drawOverlay();return;}
    selectingTarget=true;selectionCursor=targetPoint?{...targetPoint}:{x:.5,y:.4};video.pause();video.currentTime=0;video.controls=false;
    find('[data-motion-target-picker]').hidden=false;positionPicker();controls();find('[data-motion-target-picker]').focus({preventScroll:true});
  }
  function chooseTarget(point) {
    if(!metadata||running||coachRunning||video.seeking)return;
    cancel();targetPoint=point?{x:Math.max(0,Math.min(1,point.x)),y:Math.max(0,Math.min(1,point.y))}:null;
    pipeline=null;result=null;saved=false;saving=false;selectedHistory=null;coachError='';
    find('[data-motion-results]').hidden=true;stopTargetSelection();drawOverlay();error('');
  }
  function selectFile(chosen) {
    if(destroyed||!chosen)return;
    try {validateVideoFile(chosen);} catch(cause) {error(cause.message);return;}
    cancel();selectingTarget=false;targetPoint=null;find('[data-motion-target-picker]').hidden=true;video.controls=true;releaseMedia();file=chosen;result=null;saved=false;selectedHistory=null;saving=false;coachError='';error('');
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
    controls();drawOverlay();
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
    if(!file||!metadata||running||selectingTarget||destroyed)return;
    cancel();const revision=analysisRevision, activeFile=file;
    controller=new AbortController();const signal=controller.signal;
    running=true;awaitingCoach=useCoach&&coachConfig.configured;result=null;pipeline=null;saved=false;saving=false;selectedHistory=null;coachError='';
    video.pause();context?.clearRect(0,0,canvas.width,canvas.height);
    error('');find('[data-motion-results]').hidden=true;controls();updateProgress({stage:'loading',progress:0,message:'首次使用需要下载姿态模型，请保持当前页面打开。'});
    try {
      const output=await analyzeVideo(activeFile,{signal,targetPoint:targetPoint?{...targetPoint}:null,onProgress:value=>{if(!destroyed&&revision===analysisRevision)updateProgress(value);}});
      if(destroyed||signal.aborted||revision!==analysisRevision)return;
      const assessment=analyzeMotion(output.frames,{width:output.width,height:output.height,duration:output.duration,sourceFps:output.sourceFps});
      pipeline=output;result=assessment;
      result.targetTracking=output.targetTracking;
      const activeHistory=selectedHistory&&history.find(report=>report.id===selectedHistory);
      if(activeHistory)renderResult(activeHistory,true);
      running=false;controller=null;controls();renderLiveResult();drawOverlay();
      if(awaitingCoach)await runCoach();
      else notify(assessment.status==='complete'?'动作评估完成。':'视频分析完成，请查看说明。');
    } catch(cause) {
      if(destroyed||revision!==analysisRevision)return;
      running=false;controller=null;controls();
      if(cause?.name==='AbortError')error('分析已取消，可以重新开始。');
      else error(cause?.message||'视频分析失败，请检查视频格式后重试。');
    }
  }
  async function runCoach() {
    if(destroyed||!file||!pipeline||!result||coachRunning)return;
    if(!coachConfig.configured||typeof reviewAssessment!=='function'){
      awaitingCoach=true;coachError=coachConfig.configured?'AI 点评暂不可用，请重试或重新配置模型。':'请先配置动作点评使用的 AI 模型。';
      controls();renderLiveResult();return;
    }
    cancelCoach();const revision=coachRevision,analysisToken=analysisRevision,activeFile=file;
    const abort=new AbortController();coachController=abort;coachRunning=true;awaitingCoach=true;coachError='';
    coachMessage=coachConfig.vision?'正在选择动作关键画面…':'正在整理动作检测证据…';controls();renderLiveResult();
    const current=()=>!destroyed&&!abort.signal.aborted&&revision===coachRevision&&analysisToken===analysisRevision&&activeFile===file;
    try{
      const base=analyzeMotion(pipeline.frames,{width:pipeline.width,height:pipeline.height,duration:pipeline.duration,sourceFps:pipeline.sourceFps});
      let evidence;
      if(coachConfig.vision)evidence=await buildMotionEvidence(activeFile,pipeline,base,{signal:abort.signal,onProgress:value=>{if(current()){coachMessage=value.message||'正在提取动作关键画面…';renderLiveResult();}}});
      if(!current())return;
      const analysis=evidence?.summary||summarizeMotionAnalysis(base,pipeline);
      const keyframes=(evidence?.images||[]).map(({time,mimeType,dataUrl,imageTime})=>({time,mimeType,data:dataUrl.slice(dataUrl.indexOf(',')+1),imageTime}));
      coachMessage=coachConfig.vision?'AI 正在核对动作、姿态与纠正重点…':'AI 正在根据检测证据整理纠正建议…';renderLiveResult();
      const response=await reviewAssessment({duration:pipeline.duration,analysis,keyframes},{signal:abort.signal});
      if(!current())return;
      // Recompute with the original local observations. Do not persist the
      // server's duplicate assessment inside the saved coach response.
      const {assessment:serverAssessment,...coach}=response;
      const action=confirmedMotionAction(coach);
      const hint=action?.exerciseId||(action?.family?{family:action.family}:null);
      const assessed=hint?analyzeMotion(pipeline.frames,{width:pipeline.width,height:pipeline.height,duration:pipeline.duration,sourceFps:pipeline.sourceFps,exerciseHint:hint}):base;
      result=mergeCoachAssessment(assessed,coach,{originalAnalysis:base});
      result.targetTracking=pipeline.targetTracking;
      result.coachEvidence={frameTimes:keyframes.map(({time})=>time),includesImages:keyframes.length>0};
      saved=false;saving=false;awaitingCoach=false;coachMessage='';coachRunning=false;coachController=null;
      controls();renderLiveResult();notify('AI 动作点评已完成。');
    }catch(cause){
      if(!current())return;
      coachRunning=false;coachController=null;coachMessage='';coachError=cause?.message||'AI 核对失败，请重试或选择仅查看本机分析。';
      controls();renderLiveResult();notify(coachError,true);
    }
  }
  function showLocalResult() {
    if(destroyed||!pipeline||!result||running)return;
    cancelCoach();awaitingCoach=false;coachError='';useCoach=false;find('[data-motion-ai-mode]').checked=false;
    result=analyzeMotion(pipeline.frames,{width:pipeline.width,height:pipeline.height,duration:pipeline.duration,sourceFps:pipeline.sourceFps});
    result.targetTracking=pipeline.targetTracking;saved=false;saving=false;selectedHistory=null;
    controls();renderLiveResult();notify('已切换为本机分析，本次结果未经过 AI 核对。');
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
    const frame=nearestFrame(video.currentTime),box=frame?.subjectTracking?.status==='locked'?frame.subjectTracking.bbox:null;
    if(box&&[box.xMin,box.yMin,box.xMax,box.yMax].every(finite)) {
      context.strokeStyle='#bfccff';context.fillStyle='#bfccff';context.lineWidth=2;
      context.strokeRect(box.xMin*canvas.width,box.yMin*canvas.height,(box.xMax-box.xMin)*canvas.width,(box.yMax-box.yMin)*canvas.height);
      context.font=`${Math.max(12,Math.round(canvas.width/45))}px sans-serif`;context.fillText('评估对象',Math.max(3,box.xMin*canvas.width),Math.max(18,box.yMin*canvas.height-6));
    } else if(!pipeline&&targetPoint&&!selectingTarget) {
      context.strokeStyle='#c4ceff';context.lineWidth=3;context.beginPath();context.arc(targetPoint.x*canvas.width,targetPoint.y*canvas.height,12,0,Math.PI*2);context.stroke();
    }
    const points=frame?.landmarks;
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
  function checksHtml(checks,canSeek){
    return `<div class="motion-check-grid">${checks.map(check=>{
      const status=checkStatus[check.status]?check.status:'unobservable';
      const time=finite(check.time)?check.time:(check.evidenceTimes||[]).find(finite);
      const label=check.label||checkLabels[check.code]||check.code;
      const evidence=(typeof check.evidence==='string'?check.evidence:'')||check.message||check.reason||'';
      const statusLabel=status==='pass'&&check.scope==='sampled-frames'?'关键画面通过':checkStatus[status];
      const observedValue=finite(check.observed)?check.observed:check.evidence?.value;
      const unit=check.unit||check.evidence?.unit;
      const unitLabel={degree:'°',second:' 秒',ratio:'','torso-length-ratio':' × 躯干长度'}[unit]??unit??'';
      const observed=finite(observedValue)?`${number(observedValue,unit==='ratio'||unit==='torso-length-ratio'?3:1)}${unitLabel}`:'';
      return `<article class="motion-check is-${status}"><header><strong>${escapeHtml(label)}</strong><span>${statusLabel}</span></header>${evidence?`<p>${escapeHtml(Array.isArray(evidence)?evidence.join('；'):evidence)}</p>`:''}${observed?`<small>观测值 ${escapeHtml(observed)}</small>`:''}${finite(time)?timestampButton(time,'这项检查',canSeek):''}${check.scope==='sampled-frames'?'<small>仅覆盖所提供的关键画面</small>':''}${check.correction?`<p class="motion-check-correction">${escapeHtml(Array.isArray(check.correction)?check.correction.join('；'):check.correction)}</p>`:''}</article>`;
    }).join('')}</div>`;
  }
  function coachHtml(report,fromHistory,canSeek){
    const coach=report.coach;
    if(fromHistory&&!coach)return '';
    const available=!fromHistory&&!!pipeline;
    return `<section class="motion-coach" aria-label="AI 动作评价"><div class="motion-section-head"><div><span class="motion-step">AI / 识别与纠正</span><h3>动作评价与下一组建议</h3></div>${coach?`<span class="badge neutral">${coach.mode==='visual'?'关键画面 + 检测证据':'检测证据点评'}</span>`:''}</div>
      ${coach?`${identificationHtml(coach,canSeek,report.recognitionConflict)}<p class="motion-coach-evaluation">${escapeHtml(coach.overallEvaluation)}</p>${Array.isArray(coach.checks)&&coach.checks.length?checksHtml(coach.checks,canSeek):''}${coach.limitations?.length?`<ul class="motion-coach-limitations">${coach.limitations.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:''}<small class="motion-coach-source">${escapeHtml(coach.provider||'')} · ${escapeHtml(coach.model||'')}。AI 只针对已提供的证据点评，未观察到的阶段不算通过。</small>`:!coachRunning?'<p>AI 可核对器械、动作变式与可见姿态，按问题时间点给出纠正建议。关键画面之外的动作细节仍可能无法判断。</p>':''}
      ${available&&!coachRunning?`<div class="motion-coach-actions">${coachConfig.configured?`<button type="button" class="button" data-motion-action="coach">${coach? '重新获取 AI 点评':coachConfig.vision?'AI 识别与点评（含关键画面）':'AI 根据检测证据点评'}</button>`:typeof openCoachSettings==='function'?'<button type="button" class="button" data-motion-action="coach-settings">配置动作点评模型</button>':''}<small>${coachConfig.vision?'会发送最多 6 张缩小的关键画面和检测摘要，原视频不上传。':'当前只发送检测摘要，不发送画面。'}</small></div>`:''}
    </section>`;
  }
  function identificationHtml(coach,canSeek,recognitionConflict=false){
    if(coach.mode!=='visual')return '';
    const identified=confirmedMotionAction(coach);
    if(recognitionConflict)return `<p class="motion-coach-identification"><strong>动作识别：尚待确认</strong>${identified?`<span>视觉候选：${escapeHtml(identified.name)}</span>`:''}<span>画面识别与连续动作轨迹不一致，暂不确认名称和评分。请补充清楚的完整动作画面。</span></p>`;
    if(!identified){
      const candidates=(coach.candidates||[]).map(item=>typeof item.name==='string'?item.name:getMotionExercise(item.exerciseId)?.name).filter(Boolean);
      return `<p class="motion-coach-identification"><strong>动作识别：尚待确认</strong>${candidates.length?`<span>候选：${candidates.map(escapeHtml).join('、')}。器械或动作证据仍不足。</span>`:''}</p>`;
    }
    const observed=identified.observations;
    const details=observed?[observedLabel(equipmentNames,observed.equipment),observedLabel(supportNames,observed.support),observed.laterality==='unilateral'?'单侧动作':observed.laterality==='bilateral'?'双侧动作':null].filter(Boolean):[];
    const assistance=observedLabel(assistanceNames,observed?.assistance);
    if(observed?.support==='hanging'&&assistance)details.push(assistance);
    const evidence=identified.evidence||observed?.evidence;
    return `<p class="motion-coach-identification"><strong>动作识别：${escapeHtml(identified.name)}</strong>${details.length?`<span>${details.map(escapeHtml).join(' · ')}</span>`:''}${typeof evidence==='string'&&evidence?`<span>依据：${escapeHtml(evidence)}</span>`:''}${(identified.evidenceTimes||[]).filter(finite).map(time=>timestampButton(time,'动作识别依据',canSeek)).join(' ')}</p>`;
  }
  function trackingHtml(report) {
    const tracking=report.targetTracking;if(!tracking)return '';
    if(tracking.lockedFrames===0)return '<p class="motion-tracking-note">未能可靠锁定训练者。请在第一帧点选上半身，保持目标清楚入镜后重新分析。</p>';
    const method=['point','manual'].includes(tracking.mode)?'第一帧点选的训练者':'画面中央初始化的训练者';
    return `<p class="motion-tracking-note">评估对象：${method}。${finite(tracking.coverage)?`稳定跟踪覆盖 ${percent(tracking.coverage)}% 的采样画面。`:''}${finite(tracking.maxPeople)&&tracking.maxPeople>1?`检测到最多 ${Math.floor(tracking.maxPeople)} 人同时入镜。`:''}${(tracking.lostFrames||0)+(tracking.ambiguousFrames||0)>0?'失锁或目标不明确的画面不计分，动作不会跨这些片段拼接。':''}</p>`;
  }
  function renderResult(report,fromHistory=false) {
    updateCoachStatus();
    const section=find('[data-motion-results]');
    if(!fromHistory&&awaitingCoach){section.hidden=true;section.replaceChildren();return;}
    section.hidden=false;
    const complete=report.status==='complete',canSeek=!fromHistory&&!!pipeline;
    const repSectionLabel=report.recognitionConflict?'轨迹片段':isHold(report)?'分段查看':'逐次查看';
    const reps=Array.isArray(report.reps)?report.reps:[],issues=Array.isArray(report.issues)?report.issues:[];
    const quality=report.quality||{},name=reportName(report);
    const title=report.exerciseName||report.exerciseId||report.exerciseFamily?name:report.status==='unsupported'?'这段动作需要进一步确认':'这段视频还不足以评分';
    const openAction=report.recognitionSource==='visual'&&!!report.exerciseName&&!report.exerciseId;
    const countKnown=hasCount(report);
    const countValue=!countKnown?'未计次':isHold(report)?number(report.holdDuration??report.duration,1):reps.length;
    const reasons=(Array.isArray(quality.reasons)?quality.reasons:[]).map(reason=>issues.find(issue=>issue.code===reason)?.message||(/^[A-Z_]+$/.test(reason)?report.summary:reason)).filter(Boolean);
    if(complete&&!finite(quality.sourceFps))reasons.push('未能确认原视频帧率，低帧率视频的计次可靠性有限。');
    const overallMetrics={};
    for(const key of Object.keys(metricLabels)){const values=reps.map(rep=>rep.metrics?.[key]).filter(finite);if(values.length)overallMetrics[key]=values.reduce((sum,value)=>sum+value,0)/values.length;}
    const components=Object.entries(componentLabels).flatMap(([key,label])=>{const values=reps.map(rep=>rep.metrics?.components?.[key]).filter(value=>finite(value?.score));return values.length?[{label,score:values.reduce((sum,value)=>sum+value.score,0)/values.length,target:values[0].target}]:[];});
    section.innerHTML=`<div class="motion-section-head"><div><span class="motion-step">${fromHistory?'已保存的分析摘要':'02 / 评估结果'}</span><h2 id="motion-result-title">${escapeHtml(title)}</h2></div>${fromHistory&&result?'<button type="button" class="button small" data-motion-action="live-result">返回本次结果</button>':''}</div>
      ${fromHistory?'<p class="motion-history-notice">这是已保存的摘要，未保存原视频或骨架轨迹。重新选择视频并分析后可查看回放。</p>':''}
      ${trackingHtml(report)}
      <div class="motion-result-overview${complete?'':' is-unscored'}"><div class="motion-score"><span>严格检查参考分</span><strong>${scoreText(report.score)}${finite(report.score)?'<small>/ 100</small>':''}</strong><p>${report.scoreStatus==='provisional'||report.checks?.some(check=>['unobservable','uncertain'].includes(check.status))?'含待核验项目':'按已观察证据评估'}</p></div><div class="motion-result-summary"><p>${escapeHtml(report.summary||'请查看下方逐次反馈。')}</p><div class="motion-result-facts"><div><span>${isHold(report)?'有效支撑':'完整次数'}</span><strong>${countValue}${countKnown?`<small> ${isHold(report)?'秒':'次'}</small>`:''}</strong></div><div><span>${finite(report.scoreCoverage)?'检查覆盖':'可用画面'}</span><strong>${percent(finite(report.scoreCoverage)?report.scoreCoverage:quality.usableRatio)}<small>%</small></strong></div><div><span>拍摄视角</span><strong>${viewNames[quality.view]||'待确认'}</strong></div></div></div></div>
      ${openAction&&!report.recognitionConflict?`<p class="motion-quality-notes">${countKnown?`动作名称已由画面确认，使用「${escapeHtml(motionFamilies[report.exerciseFamily])}」通用检查评估；具体变式仍有未核验细节。`:'已识别动作名称，暂未提供适用的连续计次和评分检查。请查看下方关键画面评价。'}</p>`:''}
      ${reasons.length?`<ul class="motion-quality-notes">${reasons.map(reason=>`<li>${escapeHtml(reason)}</li>`).join('')}</ul>`:''}
      ${report.requiresVisualConfirmation?`<p class="motion-quality-notes">动作变式或器械尚待确认${report.candidates?.length?'：'+report.candidates.map(item=>escapeHtml(exerciseNames[item.exerciseId]||item.exerciseId)).join('、'):''}。可通过 AI 关键画面识别进一步区分。</p>`:''}
      <p class="motion-score-note">重要问题会限制分数上限；看不清的项目不会算作通过。前倾、躯干稳定、头颈位置与脊柱中立分别检查，评分仍需真实视频持续校准。</p>
      ${report.checks?.length?`<section class="motion-checks"><h3>逐项检查 <small>通过 / 需要纠正 / 未能判断</small></h3>${checksHtml(report.checks,canSeek)}</section>`:''}
      ${components.length?`<section class="motion-metric-section"><h3>分项反馈 <small>已分析片段的均值</small></h3><div class="motion-components">${components.map(component=>`<article><span>${component.label}</span><strong>${scoreText(component.score)}<small> / 100</small></strong><p>${escapeHtml(component.target)}</p></article>`).join('')}</div></section>`:''}
      ${Object.keys(overallMetrics).length?`<details class="motion-metric-section motion-measurements"><summary>查看测得的动作指标 <small>已分析片段的均值</small></summary><dl class="motion-metrics">${metricsHtml(overallMetrics,report.exerciseId,report.exerciseFamily)}</dl></details>`:''}
      ${issues.length?`<section class="motion-findings"><h3>值得留意的片段</h3><ul>${issues.slice(0,20).map(issue=>`<li>${timestampButton(issue.time,'这个问题',canSeek)}<p>${escapeHtml(issue.message)}</p></li>`).join('')}</ul></section>`:''}
      ${coachHtml(report,fromHistory,canSeek)}
      ${reps.length?`<section class="motion-reps"><h3>${repSectionLabel} <span>${reps.length} ${repetitionUnit(report)}</span></h3><div class="motion-rep-grid">${reps.map((rep,index)=>`<article class="motion-rep"><header><strong>第 ${Number.isInteger(rep.index)?rep.index:index+1} ${repetitionUnit(report)}</strong>${timestampButton(rep.time??rep.bottom??rep.start,'这次动作',canSeek)}<span>${scoreText(rep.score)}<small> 分</small></span></header><p class="motion-rep-range">${clock(rep.start)} — ${clock(rep.end)}${rep.qualified===false?(rep.issues?.length?' · 需查看问题':' · 含待核验项目'):''}</p><dl class="motion-rep-metrics">${metricsHtml(rep.metrics,report.exerciseId,report.exerciseFamily)}</dl>${rep.issues?.length?`<ul>${rep.issues.map(issue=>`<li>${escapeHtml(issue.message)}</li>`).join('')}</ul>`:'<p class="motion-rep-ok">本次未触发已检查的动作问题。</p>'}${rep.checks?.length?`<details class="motion-rep-checks"><summary>查看本次检查项目</summary>${checksHtml(rep.checks,canSeek)}</details>`:''}</article>`).join('')}</div></section>`:''}
      <div class="motion-result-actions">${pipeline&&!fromHistory&&typeof saveAssessment==='function'?`<button type="button" class="button primary" data-motion-action="save" ${saved||saving||coachRunning?'disabled':''}>${saved?'已保存报告':saving?'正在保存…':'保存报告'}</button>`:''}${getMotionExercise(report.exerciseId)?.hasTeaching&&typeof openExercise==='function'?`<button type="button" class="button" data-motion-action="exercise" data-exercise="${escapeHtml(report.exerciseId)}">查看 ${escapeHtml(exerciseNames[report.exerciseId])} 3D 教学 <span aria-hidden="true">↗</span></button>`:''}<small>报告单独保存，不会自动标记训练完成。</small></div>`;
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
    find('[data-motion-history]').innerHTML=history.length?`<div class="motion-history-list">${history.map((report,index)=>`<article class="motion-history-item"><span class="motion-history-score">${scoreText(report.score)}<small>分</small></span><div><strong>${escapeHtml(reportName(report))}</strong><p>${escapeHtml(dateLabel(report.createdAt))} · ${hasCount(report)?`${Array.isArray(report.reps)?report.reps.length:0} ${repetitionUnit(report)}`:'未计次'} · ${clock(report.video?.duration)}</p></div><button type="button" class="button small" data-motion-action="history" data-history="${index}">查看报告</button>${typeof deleteAssessment==='function'?`<button type="button" class="motion-delete" data-motion-action="delete" data-history="${index}" ${deletionId===report.id?'disabled':''} aria-label="删除 ${escapeHtml(dateLabel(report.createdAt))} 的${escapeHtml(reportName(report))}报告">${deletionId===report.id?'删除中…':'删除'}</button>`:''}</article>`).join('')}</div>`:'<p class="motion-empty">还没有保存的报告。完成一次评估后，可以在这里回看。</p>';
  }
  async function save() {
    if(!result||!pipeline||awaitingCoach||coachRunning||saved||saving||typeof saveAssessment!=='function')return;
    error('');saving=true;renderResult(result);
    const currentResult=result;
    const summary=buildMotionAssessmentReport(result,{file,pipeline});
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
    else if(action==='coach'||action==='retry-coach')void runCoach();
    else if(action==='cancel-coach'){cancelCoach();coachError='AI 核对已取消，可以重试或选择仅查看本机分析。';controls();renderLiveResult();}
    else if(action==='local-result')showLocalResult();
    else if(action==='coach-settings')openCoachSettings?.();
    else if(action==='pick-target')beginTargetSelection();
    else if(action==='reset-target')chooseTarget(null);
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
  listen(video,'loadeddata',()=>{controls();drawOverlay();});
  listen(video,'error',()=>{if(file&&objectUrl){metadata=null;controls();error('浏览器无法播放这个视频，请换用 MP4（H.264）或 WebM 视频。');}});
  listen(video,'play',()=>{cancelAnimationFrame(animationId);playbackLoop();});
  listen(video,'pause',()=>{cancelAnimationFrame(animationId);drawOverlay();});
  listen(video,'seeking',()=>context?.clearRect(0,0,canvas.width,canvas.height));
  listen(video,'seeked',drawOverlay);listen(video,'timeupdate',drawOverlay);
  listen(find('[data-motion-overlay]'),'change',drawOverlay);
  listen(find('[data-motion-ai-mode]'),'change',event=>{
    useCoach=event.target.checked;
    if(!useCoach&&awaitingCoach&&pipeline)showLocalResult();
    else if(useCoach&&pipeline&&result&&!result.coach)void runCoach();
  });
  listen(find('[data-motion-target-picker]'),'click',event=>{const box=pickerGeometry();if(selectingTarget&&box&&box.width>0&&box.height>0)chooseTarget({x:(event.clientX-box.screenLeft)/box.width,y:(event.clientY-box.screenTop)/box.height});});
  listen(find('[data-motion-target-picker]'),'keydown',event=>{
    if(!selectingTarget)return;
    if(event.key==='Escape'){event.preventDefault();stopTargetSelection();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseTarget(selectionCursor);return;}
    const delta={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]}[event.key];
    if(delta){event.preventDefault();selectionCursor={x:Math.max(0,Math.min(1,selectionCursor.x+delta[0])),y:Math.max(0,Math.min(1,selectionCursor.y+delta[1]))};positionPicker();}
  });
  listen(window,'resize',()=>{if(selectingTarget)positionPicker();});
  void refreshHistory();
  return {refreshHistory,destroy(){if(destroyed)return;destroyed=true;cancel();listeners.abort();cancelAnimationFrame(animationId);releaseMedia();file=null;result=null;history=[];}};
}
