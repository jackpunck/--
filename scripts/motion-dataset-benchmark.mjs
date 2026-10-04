// Ground-truth handling lives only in QA; none of these labels enter inference.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import {extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {getMotionExercise} from '../public/motion-catalog.js';

export const BENCHMARK_VERSION = 'motion-dataset-benchmark-v1';
const definitions = [
  ['bodyweight-squat', 'squat', ['squat', '徒手深蹲', '自重深蹲', 'bodyweight squat']],
  ['push-up', 'pushup', ['pushup', '俯卧撑', 'push up', 'push-up']],
  ['dumbbell-curl', 'elbow-isolation', ['curl', '哑铃弯举', '交替哑铃弯举', '站姿哑铃弯举', 'dumbbell curl', 'biceps curl']],
  ['dumbbell-side-bend', 'side-bend', ['站姿哑铃侧屈', '哑铃侧屈', '哑铃体侧屈', '负重体侧屈', 'dumbbell side bend']],
  ['dumbbell-row', 'row', ['dumbbell-row', '俯身哑铃划船', '哑铃俯身划船', '哑铃划船', 'bent over dumbbell row']],
  ['dumbbell-shoulder-press', 'overhead-press', ['shoulder-press', '站姿哑铃推举', '哑铃推举', '哑铃肩上推举', 'dumbbell shoulder press']],
  ['overhead-triceps-extension', 'overhead-extension', ['overhead-triceps', '哑铃颈后臂屈伸', '哑铃过顶臂屈伸', '哑铃头上臂屈伸', 'overhead triceps extension']],
  ['barbell-deadlift', 'hinge', ['杠铃硬拉', '传统硬拉', '传统杠铃硬拉', '杠铃传统硬拉', 'barbell deadlift', 'conventional deadlift']],
  ['barbell-squat', 'squat', ['杠铃深蹲', '杠铃背蹲', 'barbell squat', 'back squat']],
  ['barbell-row', 'row', ['barbell-row', '杠铃俯身划船', '杠铃划船', 'barbell row']],
  ['barbell-shoulder-press', 'overhead-press', ['杠铃推举', '站姿杠铃推举', '杠铃肩上推举', 'barbell shoulder press']],
  ['barbell-bench-press', 'horizontal-press', ['barbell-bench', '杠铃卧推', '平板杠铃卧推', '杠铃平板卧推', 'barbell bench press']],
  ['incline-bench-press', 'horizontal-press', ['incline-barbell-bench', '上斜杠铃卧推', '杠铃上斜卧推', 'incline barbell bench press']],
  ['dumbbell-bench-press', 'horizontal-press', ['bench', '哑铃卧推', '平板哑铃卧推', 'dumbbell bench press']],
  ['lat-pulldown', 'vertical-pull', ['lat-pulldown', '高位下拉', 'lat pulldown']],
  ['pull-up', 'vertical-pull', ['引体向上', '普通引体向上', '自重引体向上', 'pull-up', 'pull up']],
  ['hanging-knee-raise', 'crunch', ['悬垂屈膝收腹', '悬垂举膝', '悬垂提膝', 'hanging knee raise']],
  ['hanging-leg-raise', 'crunch', ['悬垂举腿', '悬垂直腿举腿', 'hanging leg raise']],
  ['seated-calf-raise', 'calf', ['坐姿提踵', 'seated calf raise']],
  ['standing-calf-raise', 'calf', ['calf-raise', '站姿提踵', 'standing calf raise']],
  ['romanian-deadlift', 'hinge', ['罗马尼亚硬拉', '杠铃罗马尼亚硬拉', 'romanian deadlift']],
  ['front-squat', 'squat', ['前蹲', '杠铃前蹲', '颈前深蹲', 'front squat']],
  ['barbell-lunge', 'lunge', ['杠铃弓步', '杠铃箭步蹲', 'barbell lunge']],
  ['dumbbell-lunge', 'lunge', ['哑铃弓步', '哑铃箭步蹲', 'dumbbell lunge']],
  ['walking-lunge', 'lunge', ['哑铃行走弓步', '行走弓步', '行走箭步蹲', 'walking lunge']],
  ['lying-leg-curl', 'knee-isolation', ['俯卧腿弯举', '俯卧腿屈伸', 'lying leg curl']],
  ['seated-leg-curl', 'knee-isolation', ['坐姿腿弯举', 'seated leg curl']],
  ['smith-squat', 'squat', ['史密斯深蹲', '史密斯机深蹲', 'smith squat']],
  ['leg-press', 'knee-extension', ['腿举', '器械腿举', 'leg press']],
  ['barbell-curl', 'elbow-isolation', ['杠铃弯举', 'barbell curl']],
  ['hammer-curl', 'elbow-isolation', ['hammer-curl', '锤式弯举', '哑铃锤式弯举', 'hammer curl']],
  ['cable-triceps-extension', 'elbow-isolation', ['triceps', '绳索臂屈伸', '绳索下压', '高位绳索下压', 'cable triceps extension']],
  ['dumbbell-triceps-extension', 'elbow-isolation', ['哑铃臂屈伸', '俯身哑铃臂屈伸', '哑铃后踢', 'dumbbell kickback']],
  ['lateral-raise', 'lateral-raise', ['lateral-raise', '哑铃侧平举', '侧平举', 'lateral raise']],
  ['dumbbell-skullcrusher', 'elbow-isolation', ['仰卧哑铃臂屈伸', '哑铃仰卧臂屈伸', 'dumbbell skullcrusher']],
  ['dip', 'dip', ['双杠臂屈伸', '双杠屈臂撑', 'dips', 'dip']],
  ['hip-thrust', 'bridge', ['臀推', '杠铃臀推', 'hip thrust']],
  ['face-pull', 'row', ['面拉', '绳索面拉', 'face pull']],
  ['seated-cable-row', 'row', ['row', '坐姿绳索划船', '坐姿划船', '窄握坐姿划船', '坐姿窄握绳索划船', '绳索坐姿划船', 'seated cable row']],
];
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_\-()（）]/g, '');
const aliases = new Map(definitions.flatMap(([id, , names]) => [id, ...names].map(name => [normalize(name), id])));
const familyById = new Map(definitions.map(([id, family]) => [id, family]));

export function expectedVerdict(item) {
  if (item.qualityLabel === 'author_good') return 'standard';
  if (item.qualityLabel === 'author_bad') return 'needs-improvement';
  return ['standard', 'needs-improvement'].includes(item.independentReview?.verdict) ? item.independentReview.verdict : null;
}

export function resolvePredictedExercise(action) {
  if (action?.status !== 'identified') return null;
  // A conflicting supplied name must not be rescued by a convenient catalogue ID.
  const byName = aliases.get(normalize(action.name));
  const byId = aliases.get(normalize(action.exerciseId));
  if (byName && byId && byName !== byId) return null;
  return byName || (!action.name ? byId : null) || null;
}

export function scoreMotionPrediction(item, coach) {
  if(coach?.mode==='guided'||coach?.action?.status==='selected')return scoreGuidedPrediction(item,coach);
  const predictedExercise = resolvePredictedExercise(coach?.action);
  const expectedQuality = expectedVerdict(item);
  const actionCorrect = predictedExercise === item.exercise;
  const qualityCorrect = expectedQuality === null ? null : coach?.verdict?.status === expectedQuality;
  const family = familyById.get(item.exercise);
  const predictedFamily = predictedExercise ? familyById.get(predictedExercise) : coach?.action?.family;
  const actionable = (coach?.feedback || []).some(feedback => feedback.status === 'improve'
    && typeof feedback.correction === 'string' && feedback.correction.trim().length > 0
    && typeof feedback.evidence === 'string' && feedback.evidence.trim().length > 0
    && Array.isArray(feedback.evidenceTimes) && feedback.evidenceTimes.some(Number.isFinite));
  return {
    expectedExercise: item.exercise, predictedExercise, actionCorrect,
    expectedFamily: family || null, predictedFamily: predictedFamily || null, familyCorrect: !!family && family === predictedFamily,
    expectedVerdict: expectedQuality, predictedVerdict: coach?.verdict?.status || null, qualityCorrect,
    jointCorrect: expectedQuality === null ? null : actionCorrect && qualityCorrect,
    correctionPresent: actionable,
    // This is structure/coverage, not a human-verified measure of coaching accuracy.
    badClipWithCorrection: expectedQuality === 'needs-improvement' ? actionCorrect && qualityCorrect && actionable : null,
    specificFault: item.specificFault || null,
    correctionAccuracy: null,
    correctionReviewStatus: expectedQuality === 'needs-improvement' ? 'requires-independent-review' : 'not-scored',
  };
}

export function scoreGuidedPrediction(item,coach) {
  const selected=getMotionExercise(item.selectedExerciseId),action=coach?.action;
  const selectionHonored=!!selected&&action?.status==='selected'&&action.source==='user'&&action.confidence===null
    &&action.exerciseId===selected.id&&action.name===selected.name&&action.family===selected.family;
  const selectionCheck=['consistent','mismatch','uncertain'].includes(coach?.selectionCheck?.status)?coach.selectionCheck.status:'__missing__';
  const expectedQuality=item.qualityLabel==='author_good'?'standard':item.qualityLabel==='author_bad'?'needs-improvement':null;
  const predictedVerdict=coach?.verdict?.status||null;
  const validEvaluation=selectionHonored&&selectionCheck==='consistent'&&['standard','needs-improvement'].includes(predictedVerdict);
  const actionable=(coach?.feedback||[]).some(f=>f.status==='improve'&&f.correction?.trim()&&f.evidence?.trim()&&f.evidenceTimes?.some(Number.isFinite));
  return {evaluationMode:'guided',selectedExerciseId:item.selectedExerciseId||null,selectionHonored,selectionCheck,validEvaluation,
    expectedExercise:item.exercise,predictedExercise:null,actionCorrect:null,familyCorrect:null,jointCorrect:null,
    expectedVerdict:expectedQuality,predictedVerdict,qualityCorrect:expectedQuality===null?null:validEvaluation&&predictedVerdict===expectedQuality,
    correctionPresent:actionable,badClipWithCorrection:expectedQuality==='needs-improvement'?validEvaluation&&predictedVerdict===expectedQuality&&actionable:null,
    specificFault:item.specificFault||null,correctionAccuracy:null,correctionReviewStatus:expectedQuality==='needs-improvement'?'requires-independent-review':'not-scored'};
}

function confusion(rows, expected, predicted) {
  const result = {};
  for (const row of rows) {
    const truth = expected(row), prediction = row.status === 'error' ? '__error__' : row.status === 'pending' ? '__pending__' : predicted(row);
    result[truth] ||= {};
    result[truth][prediction] = (result[truth][prediction] || 0) + 1;
  }
  return result;
}

export function selectDatasetItems(items, {limit = Infinity, seed = 'motion-benchmark-1', exercises = [], subjects = [], ids = []} = {}) {
  const selected = items.filter(item => (!exercises.length || exercises.includes(item.exercise))
    && (!subjects.length || subjects.includes(String(item.subject))) && (!ids.length || ids.includes(item.id)));
  const key = item => createHash('sha256').update(`${seed}:${item.id}`).digest('hex');
  const groups = new Map();
  for (const item of selected.toSorted((a, b) => key(a).localeCompare(key(b)))) {
    const group = [item.exercise, item.qualityLabel, item.view].join('/');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  const queues = [...groups.values()], result = [];
  for (let round = 0; result.length < Math.min(limit, selected.length); round++) {
    for (const queue of queues) if (queue[round] && result.length < limit) result.push(queue[round]);
  }
  return result;
}

function rates(rows) {
  const metric = (key, eligible = rows) => ({correct: eligible.filter(row => row.score?.[key] === true).length,
    total: eligible.length, rate: eligible.length ? eligible.filter(row => row.score?.[key] === true).length / eligible.length : null});
  const labeled = rows.filter(row => expectedVerdict(row.expected) !== null);
  const bad = labeled.filter(row => expectedVerdict(row.expected) === 'needs-improvement');
  const good = labeled.filter(row => expectedVerdict(row.expected) === 'standard');
  const finished = rows.filter(row => row.status === 'ok');
  return {clips: rows.length, completed: finished.length, failed: rows.filter(row => row.status === 'error').length,
    pending: rows.filter(row => row.status === 'pending').length,
    action: metric('actionCorrect'), family: metric('familyCorrect'), quality: metric('qualityCorrect', labeled),
    joint: metric('jointCorrect', labeled), badClipWithCorrection: metric('badClipWithCorrection', bad),
    qualityBalancedAccuracy: good.length && bad.length ? (metric('qualityCorrect', good).rate + metric('qualityCorrect', bad).rate) / 2 : null,
    qualityConfusion: confusion(rows, row => expectedVerdict(row.expected) || '__unlabeled__', row => row.score?.predictedVerdict || '__unknown__'),
    qualityCoverage: {decided: labeled.filter(row => ['standard', 'needs-improvement'].includes(row.score?.predictedVerdict)).length, total: labeled.length}};
}
function percentiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = percentile => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] : null;
  return {count: sorted.length, p50: at(.5), p95: at(.95), max: sorted.at(-1) ?? null};
}
export function summarizeDatasetResults(rows, {minimumAccuracy = .85, mode = 'coach', acceptance = 'rate', reviewMode} = {}) {
  if(mode==='coach'&&(reviewMode==='guided'||rows.some(row=>row.score?.evaluationMode==='guided'||row.coach?.mode==='guided')))return summarizeGuidedDatasetResults(rows,{minimumAccuracy,acceptance});
  const groups = key => Object.fromEntries([...new Set(rows.map(row => row.expected[key] ?? 'unknown'))].sort()
    .map(value => [value, rates(rows.filter(row => (row.expected[key] ?? 'unknown') === value))]));
  const overall = rates(rows);
  const accuracyMeasured = mode === 'coach';
  const exerciseAcceptance = Object.fromEntries([...new Set(rows.map(row => row.expected.exercise))].sort().map(exercise => {
    const attempts = rows.filter(row => row.expected.exercise === exercise);
    return [exercise, {attempts: attempts.length, successIds: attempts.filter(row => row.score?.jointCorrect === true).map(row => row.id),
      actionOnlyIds: attempts.filter(row => row.score?.actionCorrect === true && row.score?.qualityCorrect === null).map(row => row.id),
      hasJointSuccess: attempts.some(row => row.score?.jointCorrect === true)}];
  }));
  const everyExerciseHasJointSuccess = Object.keys(exerciseAcceptance).length > 0 && Object.values(exerciseAcceptance).every(item => item.hasJointSuccess);
  const complete = overall.completed + overall.failed === rows.length;
  const ratePassed = rows.length > 0 && complete && overall.action.rate >= minimumAccuracy && overall.quality.rate !== null && overall.quality.rate >= minimumAccuracy && overall.joint.rate >= minimumAccuracy;
  return {accuracyMeasured, overall: accuracyMeasured ? overall : {clips: overall.clips, completed: overall.completed, failed: overall.failed, pending: overall.pending},
    ...(accuracyMeasured ? {byExercise: groups('exercise'), byView: groups('view'), bySource: groups('sourceGroup'),
      bySubject: groups('subject'), byQuality: groups('qualityLabel'),
      bySpecificFault: groups('specificFault'),
      confusion: {actionId: confusion(rows, row => row.expected.exercise, row => row.score?.predictedExercise || '__unknown__'),
        family: confusion(rows, row => familyById.get(row.expected.exercise) || '__unknown__', row => row.score?.predictedFamily || '__unknown__')},
      correctionReview: {automaticallyScored: false, specificAuthorFaultClips: rows.filter(row => row.expected.specificFault).length,
        authorBadWithoutSpecificFault: rows.filter(row => row.expected.qualityLabel === 'author_bad' && !row.expected.specificFault).length,
        note: 'Verdict agreement and the presence of an evidence-linked correction do not establish that the correction identifies the actual fault. Independent review is required; unknown faults remain unscored.'},
      formReferences: {authorLabels: rates(rows.filter(row => ['author_good', 'author_bad'].includes(row.expected.qualityLabel))),
        independentVisualReview: rates(rows.filter(row => !['author_good', 'author_bad'].includes(row.expected.qualityLabel) && expectedVerdict(row.expected) !== null))},
      exerciseAcceptance: {exercises: exerciseAcceptance, everyExerciseHasJointSuccess},
      gate: {acceptance, minimumAccuracy, complete, ratePassed,
        passed: acceptance === 'each-exercise' ? complete && everyExerciseHasJointSuccess : ratePassed}}
      : {gate: {passed: null, reason: 'Pose extraction alone does not measure action or form accuracy.'}}),
    timingMs: Object.fromEntries(['pose', 'evidence', 'coach', 'total'].map(stage => [stage, percentiles(rows.map(row => row.timing?.[stage]))])),
    realTimeFactor: percentiles(rows.filter(row => row.duration > 0).map(row => row.timing?.total / (row.duration * 1000))),
    limitations: ['Author good/bad labels measure agreement with dataset authors, not clinical safety.',
      'Demonstrations without an independent reference and mixed tutorials have no clip-level form-accuracy denominator; independent reviews are reported separately from author labels.',
      'Missing, failed and uncertain results remain in eligible accuracy denominators.',
      'Specific correction accuracy needs independent human review; this benchmark measures only evidence-linked correction presence.',
      ...(rows.some(row => row.replayedPose) ? ['Replay timing totals combine the original genuine extraction timings with the fresh coaching run. They are not a single uninterrupted UI wall-clock measurement.'] : []),
      'A selected subset cannot establish full-dataset accuracy; same-subject views are correlated.']};
}

export function summarizeGuidedDatasetResults(rows,{minimumAccuracy=.85,acceptance='rate'}={}){
  const metric=(items,key)=>({correct:items.filter(r=>r.score?.[key]===true).length,total:items.length,
    rate:items.length?items.filter(r=>r.score?.[key]===true).length/items.length:null});
  const author=rows.filter(r=>['author_good','author_bad'].includes(r.expected.qualityLabel));
  const rates=items=>{
    const attempted=items.filter(r=>r.status!=='pending');
    const labeled=attempted.filter(r=>['author_good','author_bad'].includes(r.expected.qualityLabel));
    const good=labeled.filter(r=>r.expected.qualityLabel==='author_good'),bad=labeled.filter(r=>r.expected.qualityLabel==='author_bad');
    return {clips:items.length,completed:items.filter(r=>r.status==='ok').length,publishedClips:items.filter(r=>r.status==='ok').length,failed:items.filter(r=>r.status==='error').length,pending:items.filter(r=>r.status==='pending').length,
      attempted:attempted.length,selectedActionHonored:metric(attempted,'selectionHonored'),validSelectedEvaluation:metric(attempted,'validEvaluation'),quality:metric(labeled,'qualityCorrect'),
      badClipWithCorrection:metric(bad,'badClipWithCorrection'),
      qualityBalancedAccuracy:good.length&&bad.length?(metric(good,'qualityCorrect').rate+metric(bad,'qualityCorrect').rate)/2:null,
      qualityConfusion:confusion(attempted,r=>r.expected.qualityLabel==='author_good'?'standard':r.expected.qualityLabel==='author_bad'?'needs-improvement':'__unlabeled__',r=>r.score?.predictedVerdict||'__unknown__'),
      selectionCheckCounts:confusion(attempted,()=> 'selected',r=>r.score?.selectionCheck||'__missing__')};
  };
  const overall=rates(rows),exercises=[...new Set(rows.map(r=>r.expected.exercise))].sort(),byExercise=Object.fromEntries(exercises.map(e=>[e,rates(rows.filter(r=>r.expected.exercise===e))]));
  const covered=exercises.filter(e=>rows.some(r=>r.expected.exercise===e&&r.status==='ok'&&r.score?.validEvaluation));
  const tested=exercises.filter(e=>rows.some(r=>r.expected.exercise===e&&r.status!=='pending'));
  const complete=rows.length>0&&overall.pending===0;
  return {evaluationMode:'guided',accuracyMeasured:true,recognitionAccuracyMeasured:false,overall,byExercise,
    byQuality:Object.fromEntries([...new Set(rows.map(r=>r.expected.qualityLabel))].sort().map(q=>[q,rates(rows.filter(r=>r.expected.qualityLabel===q))])),
    formReferences:{authorLabels:{...rates(author),plannedAuthorLabeledClips:author.length}},coverage:{requestedExercises:exercises.length,testedClasses:tested.length,testedExerciseIds:tested,evaluatedClasses:covered.length,evaluatedExercises:covered.length,evaluatedExerciseIds:covered,
      missingEvaluationExerciseIds:exercises.filter(e=>!covered.includes(e)),majorityOfPlannedClasses:covered.length>exercises.length/2,meaning:'At least one completed, consistent, decided evaluation per user-selected action; not recognition or verified correction accuracy.'},
    correctionReview:{automaticallyScored:false,specificAuthorFaultClips:rows.filter(r=>r.expected.specificFault).length,authorBadWithoutSpecificFault:author.filter(r=>r.expected.qualityLabel==='author_bad'&&!r.expected.specificFault).length,
      note:'Author verdict agreement and correction presence do not establish correct fault identification. Correction correspondence remains unscored pending independent review.'},
    gate:{acceptance:'informational',complete,passed:null,
      legacyInformational:{acceptance,minimumAccuracy,passed:complete&&covered.length===exercises.length&&overall.quality.rate!==null&&overall.quality.rate>=minimumAccuracy},
      meaning:'No numeric accuracy threshold represents user acceptance. Majority coverage is reported as a coverage fact only; quality and correction correctness remain separate.'},
    timingMs:Object.fromEntries(['pose','evidence','coach','total'].map(stage=>[stage,percentiles(rows.map(r=>r.timing?.[stage]))])),
    limitations:['Action type is supplied by the user and is not scored as recognition.','Unlabeled demonstrations and mixed tutorials are excluded from form accuracy, including unverified assistant references.',
      'Errors, uncertainty, and rejected selections remain in the relevant denominators.','Prior clips and subjects may be reused: this development run is separate from the historical frozen holdout.',
      'Planned but unexecuted clips remain pending in planned coverage; they count as neither successes nor failures and are excluded from observed quality accuracy.',
      'A correction matching the author specific fault requires independent review; label agreement alone is insufficient.',
      ...(rows.some(r=>r.replayedPose)?['Replay totals combine original extraction and fresh coaching; they are not continuous UI timings.']:[])]};
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function datasetVideoPath(root, value) {
  const local = String(value || '').replace(/\\/g, '/');
  if (!local || local.includes(':') || local.includes('\0') || local.startsWith('/') || local.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid dataset relative path.');
  const canonicalRoot = await realpath(root), path = await realpath(resolve(canonicalRoot, local));
  const inside = relative(canonicalRoot, path);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('Dataset video is outside the dataset root.');
  return path;
}
export async function inspectDataset(root, {verifyHashes = false, manifestPath} = {}) {
  const manifest = JSON.parse((await readFile(manifestPath ? resolve(manifestPath) : resolve(root, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(manifest.items)) throw new Error('Dataset manifest must contain items.');
  const ids = new Set(), audit = [], hashes = new Map();
  for (const item of manifest.items) {
    if (!item.id || ids.has(item.id)) throw new Error(`Missing/duplicate dataset ID: ${item.id}`);
    ids.add(item.id);
    try {
      const path = await datasetVideoPath(root, item.relativePath), info = await stat(path);
      const sha256 = verifyHashes ? await hashFile(path) : null;
      const expectedHash = item.outputSha256 || (typeof item.transformation === 'string' && /unchanged/.test(item.transformation) ? item.sourceSha256 : null);
      const errors = [];
      if (!info.isFile()) errors.push('NOT_FILE');
      if (item.outputBytes && info.size !== item.outputBytes) errors.push('SIZE_MISMATCH');
      if (sha256 && expectedHash && sha256 !== expectedHash) errors.push('HASH_MISMATCH');
      if (sha256) { if (!hashes.has(sha256)) hashes.set(sha256, []); hashes.get(sha256).push(item); }
      audit.push({id: item.id, bytes: info.size, sha256, errors});
    } catch (error) { audit.push({id: item.id, errors: [error.code || error.message]}); }
  }
  const declared = new Set(manifest.items.map(item => item.relativePath.replace(/\\/g, '/'))), unlistedVideos = [];
  const walk = async (dir, prefix = '') => {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      if (entry.name.startsWith('.')) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) await walk(resolve(dir, entry.name), path + '/');
      else if (/\.(mp4|mov|webm|mkv|avi)$/i.test(entry.name) && !declared.has(path)) unlistedVideos.push(path);
    }
  };
  await walk(root);
  const count = key => Object.fromEntries([...new Set(manifest.items.map(item => item[key] ?? 'unknown'))].sort()
    .map(value => [value, manifest.items.filter(item => (item[key] ?? 'unknown') === value).length]));
  return {manifest, audit, inventory: {clips: manifest.items.length, exercises: count('exercise'), qualityLabels: count('qualityLabel'),
    sources: count('sourceGroup'), views: count('view'), labeledClips: manifest.items.filter(item => expectedVerdict(item)).length,
    errors: audit.filter(item => item.errors.length), totalBytes: audit.reduce((sum, item) => sum + (item.bytes || 0), 0),
    hashesVerified: verifyHashes, duplicateGroups: [...hashes].filter(([, items]) => items.length > 1).map(([sha256, items]) => ({sha256, ids: items.map(item => item.id), labelConflict: new Set(items.map(item => `${item.exercise}/${item.qualityLabel}`)).size > 1})), unlistedVideos}};
}

export function blindedVideoName(path) {
  const extension = extname(path).toLowerCase();
  return 'clip' + (/^\.(mp4|mov|webm|mkv|avi)$/.test(extension) ? extension : '.mp4');
}
