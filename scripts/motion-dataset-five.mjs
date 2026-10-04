// Freeze the explicitly requested five-action smoke set before seeing predictions.
// No ground-truth labels enter the model; copies preserve original video bytes.
import {copyFile, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {datasetVideoPath, hashFile} from './motion-dataset-benchmark.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, '.qa/motion-main-five-dataset'));
await mkdir(output, {recursive: true});
const sourceRoot = join(root, '测试集'), original = JSON.parse(await readFile(join(sourceRoot, 'manifest.json'), 'utf8'));
const ids = ['core-subject_001_squat_good_side', 'core-subject_001_squat_bad_side', 'commons-162440167', 'commons-162440163', 'deadlift-GB_S01_R01', 'deadlift-PB_S01_R01'];
const items = [];
for (const id of ids) {
  const item = original.items.find(item => item.id === id);
  if (!item) throw new Error(`Required frozen sample missing: ${id}`);
  const source = await datasetVideoPath(sourceRoot, item.relativePath);
  const relativePath = `${String(items.length + 1).padStart(2, '0')}${extname(source).toLowerCase()}`;
  await copyFile(source, join(output, relativePath));
  items.push({...item, originalRelativePath: item.relativePath, relativePath, outputSha256: await hashFile(source), outputBytes: (await stat(source)).size});
}
const wger = JSON.parse(await readFile(join(root, '.qa/motion-fixtures/wger-motion-sources.json'), 'utf8'));
const row = wger.samples.find(item => item.videoId === 1);
if (!row) throw new Error('Seated-row source metadata is missing.');
const source = join(root, '.qa/motion-fixtures', row.playable), sha256 = await hashFile(source);
if (sha256 !== row.playableSha256) throw new Error('Seated-row playable SHA256 differs from the source record.');
const supplement = join(sourceRoot, '补充动作/坐姿划船');
await mkdir(supplement, {recursive: true});
await copyFile(source, join(supplement, row.playable));
await copyFile(source, join(output, '07.mp4'));
items.push({id: 'wger-seated-row-1', exercise: 'seated-cable-row', exerciseNameZh: '坐姿绳索划船', qualityLabel: 'demonstration_unverified', sourceGroup: 'wger', sourcePage: row.sourcePage,
  labelProvenance: 'Official wger exercise identity only. No verified form-quality label; requires independent clip review.',
  sourceBytes: row.sourceMetadata.size, sourceSha256: row.sha256, transformation: row.conversion, originalRelativePath: '.qa/motion-fixtures/' + row.playable,
  relativePath: '07.mp4', outputSha256: sha256, outputBytes: (await stat(source)).size, duration: Number(row.sourceMetadata.duration), license: wger.license, licenseUrl: wger.licenseUrl});
await writeFile(join(supplement, 'manifest.json'), JSON.stringify({version: 1, description: '补充坐姿划船动作演示：仅有来源动作名称，无动作正误标注。保留原268条清单。',
  items: [{...items.at(-1), relativePath: row.playable, sourceUrl: row.url, author: row.author}]}, null, 2));
await writeFile(join(output, 'manifest.json'), JSON.stringify({version: 1, createdAt: new Date().toISOString(), description: 'Frozen seven-video smoke set for the five requested exercises. Squat and deadlift have author good/bad pairs; pull-up, bench press and seated row have identity labels only. All attempts must be retained.',
  selection: 'Before inference: subject 001 side good/bad squat; subject 01 repetition 01 GB/PB deadlift; Commons short full-repetition pull-up and bench demonstration; pre-existing verified-hash wger seated-row conversion. No selection based on model outcomes.', items}, null, 2));
console.log(JSON.stringify({output, clips: items.length, items: items.map(({id, exercise, qualityLabel, relativePath, sourcePage}) => ({id, exercise, qualityLabel, relativePath, sourcePage}))}, null, 2));
