// Split the frozen 48 clips before any held-out AI inference. Never select by results.
// node scripts/motion-dataset-partition.mjs FROZEN_MANIFEST OUTPUT_DIRECTORY
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hashFile} from './motion-dataset-benchmark.mjs';

export const CALIBRATION_IDS = Object.freeze(['deadlift-GB_S03_R36', 'deadlift-LLK_S03_R11', 'deadlift-PB_S03_R11']);

export function partitionFrozenDataset(manifest, sourceManifestSha256, frozenAt = new Date().toISOString()) {
  if (manifest.items?.length !== 48 || new Set(manifest.items.map(item => item.id)).size !== 48) throw new Error('Expected the unique original 48-video frozen manifest.');
  const ids = new Set(CALIBRATION_IDS);
  const calibration = manifest.items.filter(item => ids.has(item.id));
  if (calibration.length !== 3 || calibration.some(item => item.sourceGroup !== 'mydeadlift' || item.subject !== '03')) throw new Error('The three predeclared subject-03 calibration videos are required.');
  const holdout = manifest.items.filter(item => !ids.has(item.id));
  if (holdout.some(item => item.sourceGroup === 'mydeadlift' && ['01', '03'].includes(item.subject))) throw new Error('Reference or calibration subject leaked into the final holdout.');
  const common = {...manifest, frozenAt, sourceManifestSha256, originalFrozenAt: manifest.frozenAt,
    partitionPolicy: 'Subject 03 was moved to calibration before model inference to compare baseline and two fixed subject-01 visual references. All other frozen clips remain the final holdout. No prediction-dependent selection.',
    calibrationIds: CALIBRATION_IDS, inferencePolicy: 'Choose one protocol using development/calibration only, then evaluate the final holdout once. Retain every error and abstention; do not inspect holdout predictions to tune the evaluated protocol.'};
  const count = (items, key) => Object.fromEntries([...new Set(items.map(item => item[key] ?? 'unknown'))].sort().map(value => [value, items.filter(item => (item[key] ?? 'unknown') === value).length]));
  return {
    calibration: {...common, partition: 'calibration', description: 'Three subject-03 MyDeadlift videos for a fixed baseline/reference calibration comparison; these are not held-out validation.', items: calibration},
    holdout: {...common, partition: 'holdout', description: 'Final 45-video holdout: 42 author-labeled clips and three action demonstrations. No independent seated-row video is available.', items: holdout},
    profile: {frozenAt, sourceManifestSha256, calibrationClips: calibration.length, holdoutClips: holdout.length,
      calibrationIds: calibration.map(item => item.id), holdoutIds: holdout.map(item => item.id),
      calibrationByQuality: count(calibration, 'qualityLabel'), holdoutByQuality: count(holdout, 'qualityLabel'), holdoutByExercise: count(holdout, 'exercise'),
      holdoutBySpecificFault: count(holdout, 'specificFault'), sourceScopedSubjects: [...new Set(holdout.filter(item => item.subject).map(item => `${item.sourceGroup}/${item.subject}`))].sort(),
      limitations: common.limitations, inferencePolicy: common.inferencePolicy},
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/motion-dataset-partition.mjs FROZEN_MANIFEST OUTPUT_DIRECTORY');
  const source = resolve(process.argv[2]), output = resolve(process.argv[3]);
  const manifest = JSON.parse(await readFile(source, 'utf8'));
  const split = partitionFrozenDataset(manifest, await hashFile(source));
  await mkdir(output, {recursive: true});
  for (const [name, value] of Object.entries(split)) await writeFile(join(output, `${name === 'profile' ? name : name + '-manifest'}.json`), JSON.stringify(value, null, 2), {flag: 'wx'});
  console.log(JSON.stringify({output, ...split.profile}, null, 2));
}
