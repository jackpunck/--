// Audit a final held-out evaluation without selecting by model predictions.
// node scripts/motion-dataset-final-audit.mjs MANIFEST PROTOCOL_PLAN OUTPUT REPORT...
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {datasetVideoPath, hashFile} from './motion-dataset-benchmark.mjs';
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function auditFinalMotionHoldout(manifest, protocol, runs) {
  const expectedIds = new Set(manifest.items.map(item => item.id)), seen = new Set(), calls = [];
  if (manifest.partition !== 'holdout' || expectedIds.size !== manifest.items.length) throw new Error('A unique, explicit final holdout manifest is required.');
  for (const {report, traces, inputImages} of runs) {
    if (report.mode !== 'coach' || report.partition !== 'holdout' || report.inference?.mock !== false || report.inference.visualReferences) throw new Error('Final audit accepts only real unreferenced holdout evaluations.');
    if (report.reviewMode !== protocol.reviewMode || report.codeHashes?.['server/motion-coach-visual.mjs'] !== protocol.visualCodeSha256) throw new Error('Frozen review mode or visual code changed.');
    for (const row of report.rows) {
      if (!expectedIds.has(row.id) || seen.has(row.id) || row.status === 'pending') throw new Error('Unexpected, repeated or pending holdout member.');
      seen.add(row.id);
      if (row.pose && row.pose.sampleFps !== protocol.sampleFps) throw new Error('Cached pose does not use the frozen sample rate.');
      if ((row.providerRequestFiles || []).length > 1) throw new Error('A holdout target received multiple provider attempts.');
      for (const filename of row.providerRequestFiles || []) {
        const trace = traces[filename], body = trace?.body;
        if (!body || body.model !== protocol.model || body.thinking?.type !== protocol.thinking || body.temperature !== protocol.temperature || body.max_tokens !== protocol.max_tokens || body.stream !== false || body.reasoning_effort !== undefined) throw new Error('Actual provider parameters differ from the frozen protocol.');
        if (sha256(body.messages?.[0]?.content || '') !== protocol.systemSha256) throw new Error('Actual system prompt differs between targets.');
        const images = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url');
        if (!images.length || images.length > 6 || images.some(part => !/^[a-f0-9]{64}$/.test(part.image?.sha256 || ''))) throw new Error('Missing image trace or unexpected reference images.');
        const expectedImages = inputImages?.[row.id];
        if (!expectedImages || expectedImages.length !== images.length || images.some((part, index) => part.image.sha256 !== expectedImages[index])) throw new Error('Actual provider images differ from the target request cache.');
        const serialized = JSON.stringify(body);
        if (serialized.includes(row.id) || row.expected.relativePath && serialized.includes(row.expected.relativePath)) throw new Error('Dataset identity leaked into the actual provider input.');
        calls.push({id: row.id, request: filename, images: images.length, systemSha256: protocol.systemSha256});
      }
    }
  }
  const missing = [...expectedIds].filter(id => !seen.has(id));
  if (missing.length) throw new Error('Final holdout is incomplete: ' + missing.join(', '));
  return {passed: true, clips: seen.size, providerCalls: calls.length, localOnlyOutcomes: seen.size - calls.length, uniqueAttempts: true,
    authorFormLabelDenominator: manifest.items.filter(item => ['author_good', 'author_bad'].includes(item.qualityLabel)).length,
    actionDenominator: seen.size, protocol, calls,
    limitation: 'This verifies complete membership, one attempt per target and unchanged provider inputs/settings. It does not establish action, form or correction accuracy.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , manifestPath, protocolPath, outputPath, ...reportPaths] = process.argv;
  if (!reportPaths.length) throw new Error('Usage: MANIFEST PROTOCOL_PLAN OUTPUT REPORT...');
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')), protocol = JSON.parse(await readFile(resolve(protocolPath), 'utf8'));
  if (protocol.manifestSha256 !== await hashFile(resolve(manifestPath))) throw new Error('The frozen manifest changed.');
  const runs = [];
  for (const reportPath of reportPaths) {
    const absolute = resolve(reportPath), directory = dirname(absolute), report = JSON.parse(await readFile(absolute, 'utf8')), traces = {}, inputImages = {};
    for (const filename of report.rows.flatMap(row => row.providerRequestFiles || [])) traces[filename] = JSON.parse(await readFile(await datasetVideoPath(directory, filename), 'utf8'));
    for (const row of report.rows.filter(row => row.providerRequestFiles?.length)) {
      const body = JSON.parse(await readFile(await datasetVideoPath(directory, row.requestFile), 'utf8'));
      inputImages[row.id] = [...body.keyframes].sort((a, b) => a.time - b.time).map(frame => sha256(Buffer.from(frame.data, 'base64')));
    }
    runs.push({report, traces, inputImages});
  }
  const result = auditFinalMotionHoldout(manifest, protocol, runs);
  await mkdir(dirname(resolve(outputPath)), {recursive: true});
  await writeFile(resolve(outputPath), JSON.stringify({...result, reportPaths: reportPaths.map(path => resolve(path)), auditedAt: new Date().toISOString()}, null, 2), {flag: 'wx'});
  console.log(JSON.stringify({output: resolve(outputPath), clips: result.clips, providerCalls: result.providerCalls, passed: result.passed}));
}
