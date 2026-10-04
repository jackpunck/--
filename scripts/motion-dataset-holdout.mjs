// Freeze an unseen-subject holdout before inference; never select by predictions.
// node scripts/motion-dataset-holdout.mjs [.qa/motion-main-five-holdout]
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {datasetVideoPath, hashFile} from './motion-dataset-benchmark.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const datasetRoot = join(projectRoot, '测试集'), output = resolve(process.argv[2] || join(projectRoot, '.qa/motion-main-five-holdout'));
const manifest = JSON.parse(await readFile(join(datasetRoot, 'manifest.json'), 'utf8'));
const required = new Set(['bodyweight-squat', 'pull-up', 'barbell-bench-press', 'barbell-deadlift', 'seated-cable-row']);
const variants = new Set(['barbell-squat', 'front-squat', 'smith-squat', 'dumbbell-bench-press', 'incline-bench-press', 'romanian-deadlift']);
const developmentIds = new Set(['commons-162440163', 'commons-162440167', 'wger-seated-row-1']);
const developmentSubjects = new Set(['mendeley-multiview/001', 'mydeadlift/01']);
const isDevelopment = item => developmentIds.has(item.id) || developmentSubjects.has(`${item.sourceGroup}/${item.subject}`);
const primary = manifest.items.filter(item => required.has(item.exercise) && !isDevelopment(item));
const secondary = manifest.items.filter(item => variants.has(item.exercise) && !isDevelopment(item));
const count = (items, key) => Object.fromEntries([...new Set(items.map(item => item[key] ?? 'unknown'))].sort().map(value => [value, items.filter(item => (item[key] ?? 'unknown') === value).length]));
const seal = async items => {
  const output = [];
  for (const item of items) {
    const path = await datasetVideoPath(datasetRoot, item.relativePath);
    output.push({...item, outputSha256: await hashFile(path), outputBytes: (await stat(path)).size});
  }
  return output;
};
const base = {version: 1, frozenAt: new Date().toISOString(), datasetRoot: '测试集', selection: 'Frozen before holdout inference. All specified primary exercises except every Mendeley subject 001 video, every MyDeadlift subject 01 video, and previously used Commons bench/pull-up demonstrations. No prediction-dependent selection. Variants are separate.',
  developmentSubjects: [...developmentSubjects], developmentIds: [...developmentIds],
  limitations: ['There is no unseen seated-row clip in the local dataset; the supplemental row was used in development and is excluded.',
    'Subject identifiers are scoped to their source dataset, not independently verified identities across datasets.',
    'Commons/wger demonstrations have no subject IDs or author form-quality labels; no unseen-person claim is made for them.',
    'MyDeadlift LLK labels are author-specific knee-class labels, not a universal rule that the exercise is unsafe or wrong. Report them separately from PB.',
    'Do not tune on these predictions and continue to call them held out. Retain all failures and abstentions.']};
await mkdir(output, {recursive: true});
await writeFile(join(output, 'manifest.json'), JSON.stringify({...base, description: '48-video primary holdout for the requested mainstream action scope; seated-row holdout unavailable.', items: await seal(primary)}, null, 2), {flag: 'wx'});
await writeFile(join(output, 'variants-manifest.json'), JSON.stringify({...base, description: 'Seven additional variants, reported separately from the primary set.', items: await seal(secondary)}, null, 2), {flag: 'wx'});
const sourceScopedSubjects = [...new Set(primary.filter(item => item.subject).map(item => `${item.sourceGroup}/${item.subject}`))].sort();
const report = {primaryClips: primary.length, variantsClips: secondary.length, primaryByExercise: count(primary, 'exercise'), primaryByQuality: count(primary, 'qualityLabel'),
  primaryBySourceLabel: count(primary, 'sourceLabel'), primaryByView: count(primary, 'view'), sourceScopedSubjects, knownSubjectIds: sourceScopedSubjects.length,
  subjectIdsBySource: Object.fromEntries([...new Set(primary.map(item => item.sourceGroup))].sort().map(source => [source, [...new Set(primary.filter(item => item.sourceGroup === source && item.subject).map(item => item.subject))].sort()])),
  unknownSubjectClips: primary.filter(item => !item.subject).length, variantsByExercise: count(secondary, 'exercise'),
  allPrimaryScopeCounts: count(manifest.items.filter(item => required.has(item.exercise)), 'exercise'), limitations: base.limitations};
await writeFile(join(output, 'profile.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({output, ...report}, null, 2));
