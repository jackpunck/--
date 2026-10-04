// Compose real extraction caches without running inference. The last supplied
// attempt for an ID wins, including failures; never select the best result.
// node scripts/motion-dataset-merge-cache.mjs --output DIR CACHE_DIR...
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {datasetVideoPath, summarizeDatasetResults} from './motion-dataset-benchmark.mjs';

const args = process.argv.slice(2);
if (args[0] !== '--output' || !args[1] || args.length < 3) throw new Error('Usage: --output DIRECTORY CACHE_DIRECTORY...');
const output = resolve(args[1]), chosen = new Map(), sources = [];
if (await access(join(output, 'results.json')).then(() => true, () => false)) throw new Error('Cache composition output already exists. Preserve it and choose a new directory.');
for (const directory of args.slice(2)) {
  const root = resolve(directory), report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
  if (report.mode !== 'extract' || report.inference?.mock !== false) throw new Error('Only real extracted caches are supported.');
  sources.push({root, generatedAt: report.generatedAt, clips: report.rows.length, codeHashes: report.codeHashes, runtime: report.runtime, instrumentation: report.inference.instrumentation || null});
  for (const row of report.rows) chosen.set(row.id, {row, root, report});
}
await mkdir(output, {recursive: true});
const rows = [];
for (const {row: original, root, report} of chosen.values()) {
  const row = {...original, sourceCache: root, poseSource: original.poseSource || {cacheRoot: root, generatedAt: report.generatedAt,
    codeHashes: report.codeHashes, runtime: report.runtime, instrumentation: report.inference.instrumentation || null}}, id = String(rows.length + 1).padStart(3, '0');
  for (const [key, suffix] of [['framesFile', 'frames.json'], ['requestFile', 'request.json']]) {
    if (!original[key]) continue;
    const bytes = await readFile(await datasetVideoPath(root, original[key]));
    row[key] = `${id}-${suffix}`;
    await writeFile(join(output, row[key]), bytes);
  }
  delete row.keyframeFiles;
  rows.push(row);
}
const result = {version: 'motion-dataset-benchmark-v1', generatedAt: new Date().toISOString(), mode: 'extract', cacheComposition: sources,
  inference: {mock: false, metadataLabelsExcluded: true, neutralFilename: true, actualSampleRates: [...new Set(rows.map(row => row.pose?.sampleFps).filter(Number.isFinite))], sampleStrategy: 'Composed genuine production extraction caches; each row retains sourceCache and poseSource. Last provided attempt wins.'}, rows,
  summary: summarizeDatasetResults(rows, {mode: 'extract'})};
await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({output, clips: rows.length, completed: result.summary.overall.completed, failed: result.summary.overall.failed}, null, 2));
