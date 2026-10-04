#!/usr/bin/env node
/** Reproducible, byte-bounded exercise-video download and transcoding.
 * Source labels are copied verbatim: this tool never labels technique itself. */
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, writeFile, open, rename, unlink, readdir, lstat, realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve, relative, dirname, join, isAbsolute, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARD_LIMIT = 3_000_000_000, OUTPUT_LIMIT = 40_000_000;
const MANIFEST_LIMIT = 8 * 1024 * 1024, MANIFEST_RESERVE = MANIFEST_LIMIT * 2;
const auxiliaryFiles = new Set(['manifest.json', 'manifest.csv', 'README.md', 'index.html', 'source-audit.json']);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
if (args.includes('--help')) {
  console.log(`Usage: node scripts/prepare-motion-dataset.mjs [options]
  --manifest PATH   Source manifest (default scripts/motion-test-dataset.json)
  --output PATH     Dataset directory (default 测试集)
  --only ID,ID      Prepare only these IDs; retain verified completed items
  --verify          Rehash saved files, check sizes, budget and unexpected files
  --decode          With --verify, fully decode every video as well
  --help            Show help

Preparation uses four workers, serial Commons downloads, and at most two retries.
Set QA_FFMPEG to an ffmpeg executable. Entire videos are retained, max 120 seconds.
Unknown existing files are never replaced. Total directory size includes work files.
Verification permits manifest.json, manifest.csv, README.md, index.html and source-audit.json.`);
  process.exit(0);
}

const knownArgs = new Set(['--manifest', '--output', '--only', '--verify', '--decode']);
for (let index = 0; index < args.length; index++) {
  if (!knownArgs.has(args[index])) throw new Error(`Unknown argument: ${args[index]}`);
  if (['--manifest', '--output', '--only'].includes(args[index])) index++;
}
const destination = resolve(option('--output', join(project, '测试集')));
const sourceManifest = resolve(option('--manifest', join(project, 'scripts', 'motion-test-dataset.json')));
const only = option('--only', '').split(',').map(value => value.trim()).filter(Boolean);
const ffmpeg = resolve(process.env.QA_FFMPEG || join(project, '.qa', 'motion-fixtures', 'qa-codecs', 'imageio_ffmpeg', 'binaries', 'ffmpeg-win-x86_64-v7.1.exe'));
const controller = new AbortController();
process.once('SIGINT', () => controller.abort(new Error('Interrupted by user')));
process.once('SIGTERM', () => controller.abort(new Error('Interrupted by process signal')));
const signal = controller.signal;
const cleanRelative = value => {
  if (typeof value !== 'string' || !value || isAbsolute(value) || /^[a-z]:/i.test(value) || /[\x00-\x1f<>:"|?*]/.test(value)) throw new Error(`Unsafe relativePath: ${value}`);
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error(`Unsafe relativePath: ${value}`);
  if (parts[0] === '.work' || ['manifest.json', 'manifest.csv', 'README.md', 'index.html', 'source-audit.json'].includes(parts[0])) throw new Error(`Reserved relativePath: ${value}`);
  return parts.join('/');
};
function inside(path) {
  const absolute = resolve(path), local = relative(destination, absolute);
  if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error(`Path escapes dataset directory: ${absolute}`);
  return absolute;
}
async function info(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function safeParents(path) {
  inside(path);
  let current = destination;
  for (const part of relative(destination, dirname(path)).split(sep).filter(Boolean)) {
    current = join(current, part);
    const entry = await info(current);
    if (entry?.isSymbolicLink() || entry && !entry.isDirectory()) throw new Error(`Unsafe parent directory: ${current}`);
    if (!entry) {
      try { await mkdir(current); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const competing = await info(current);
        if (!competing?.isDirectory() || competing.isSymbolicLink()) throw new Error(`Unsafe concurrently created parent: ${current}`);
      }
    }
  }
}
async function removeOwned(path) {
  const absolute = inside(path), entry = await info(absolute);
  if (!entry) return;
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Refusing to delete a non-file: ${absolute}`);
  await unlink(absolute);
}
async function scan() {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = inside(join(directory, entry.name));
      if (entry.isSymbolicLink()) throw new Error(`Dataset contains a link; cannot bound storage safely: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push({path, relativePath: relative(destination, path).split(sep).join('/'), bytes: (await lstat(path)).size});
      else throw new Error(`Unsupported filesystem entry: ${path}`);
    }
  }
  await visit(destination);
  return {files, bytes: files.reduce((sum, file) => sum + file.bytes, 0)};
}
async function hashFile(path) {
  const entry = await info(path);
  if (!entry?.isFile() || entry.isSymbolicLink()) throw new Error(`Missing or unsafe file: ${path}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) { signal.throwIfAborted(); hash.update(chunk); }
  return hash.digest('hex');
}
async function readJson(path, optional = false) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
function runFfmpeg(arguments_, {acceptProbeExit = false} = {}) {
  signal.throwIfAborted();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpeg, ['-nostdin', ...arguments_], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal});
    let diagnostic = '', settled = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2 * 1024 * 1024); });
    child.on('error', error => { settled = true; reject(error); });
    child.on('close', code => {
      if (settled) return;
      if (code === 0 || acceptProbeExit && code === 1) resolvePromise(diagnostic);
      else reject(new Error(`ffmpeg exited ${code}: ${diagnostic.slice(-3000)}`));
    });
  });
}
async function probe(path) {
  const metadata = await runFfmpeg(['-hide_banner', '-i', path], {acceptProbeExit: true});
  const time = metadata.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = metadata.split(/\r?\n/).find(line => /Stream #.*Video:/.test(line));
  const dimensions = video?.match(/\b(\d{2,5})x(\d{2,5})(?=\s|,|\[)/);
  const fps = video?.match(/\b(\d+(?:\.\d+)?) fps\b/);
  if (!time || !video || !dimensions) throw new Error(`Cannot read video duration/dimensions: ${path}`);
  return {duration: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]), width: Number(dimensions[1]), height: Number(dimensions[2]),
    fps: fps ? Number(fps[1]) : null, codec: video.match(/Video:\s*([^,\s]+)/)?.[1] || 'unknown',
    pixelFormat: video.match(/\b((?:yuv|yuva|gbr|rgb|bgr|gray)[a-z0-9]+)\b/i)?.[1] || null};
}
async function decode(path) {
  await runFfmpeg(['-hide_banner', '-v', 'error', '-xerror', '-threads', '2', '-i', path, '-map', '0:v:0', '-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
}
const pause = ms => new Promise((resolvePromise, reject) => {
  signal.throwIfAborted();
  const done = () => { signal.removeEventListener('abort', abort); resolvePromise(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener('abort', abort, {once: true});
});
let commonsTail = Promise.resolve();
async function commonsSerial(task) {
  const preceding = commonsTail;
  let release; commonsTail = new Promise(resolvePromise => { release = resolvePromise; });
  await preceding;
  try { return await task(); } finally { release(); }
}
async function download(item, target) {
  const perform = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      let file;
      try {
        const response = await fetch(item.url, {signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
          headers: {'User-Agent': 'MotionEvaluationDataset/1.0 (local research video preparation)', 'Accept-Encoding': 'identity'}});
        if (!response.ok) {
          await response.body?.cancel();
          const error = new Error(`HTTP ${response.status}: ${item.url}`);
          error.retryable = response.status === 429 || response.status >= 500;
          const retry = response.headers.get('retry-after');
          const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 0;
          error.retryMs = Number.isFinite(retryMs) ? Math.min(120_000, retryMs) : 0;
          throw error;
        }
        const declared = response.headers.get('content-length');
        if (declared && Number(declared) !== item.sourceBytes) { await response.body?.cancel(); throw new Error(`Source length changed: expected ${item.sourceBytes}, server declared ${declared}`); }
        if (!response.body) throw new Error('Download returned no body');
        // prepare() exclusively created this job's file before network access.
        file = await open(target, 'w');
        const hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          if (bytes + chunk.length > item.sourceBytes) throw new Error(`Source exceeds declared byte budget (${item.sourceBytes})`);
          hash.update(chunk);
          for (let offset = 0; offset < chunk.length;) {
            const wrote = await file.write(chunk, offset, chunk.length - offset);
            if (!wrote.bytesWritten) throw new Error('Source write stopped before completion');
            offset += wrote.bytesWritten;
          }
          bytes += chunk.length;
        }
        await file.close(); file = null;
        const sha256 = hash.digest('hex');
        if (bytes !== item.sourceBytes) throw new Error(`Incomplete source: expected ${item.sourceBytes}, received ${bytes}`);
        if (item.sourceSha256 && sha256 !== item.sourceSha256.toLowerCase()) throw new Error('Source SHA-256 differs from the source manifest');
        return {bytes, sha256};
      } catch (error) {
        await file?.close().catch(() => {});
        if (signal.aborted || attempt === 2 || error.retryable === false) throw error;
        const delay = Math.max(error.retryMs || 0, 1000 * 2 ** attempt);
        console.warn(`[retry ${attempt + 1}/2] ${item.id}: ${error.message}; waiting ${delay} ms`);
        await pause(delay);
      }
    }
  };
  return /(^|\.)wikimedia\.org$/i.test(new URL(item.url).hostname) ? commonsSerial(perform) : perform();
}

async function main() {
  const existingRoot = await info(destination);
  if (existingRoot?.isSymbolicLink() || existingRoot && !existingRoot.isDirectory()) throw new Error('Output must be a real directory, not a link or file');
  await mkdir(destination, {recursive: true});
  if (resolve(await realpath(destination)) !== destination) throw new Error('Output or its parents resolve through a link; use its real path explicitly');
  const statePath = inside(join(destination, 'manifest.json'));
  const oldState = await readJson(statePath, true);
  if (oldState && (oldState.version !== 1 || !Array.isArray(oldState.items) || !Array.isArray(oldState.failures))) throw new Error('Existing manifest.json is not a dataset checkpoint; refusing to replace it');
  const initial = await scan();
  if (initial.bytes > HARD_LIMIT) throw new Error(`Dataset already exceeds ${HARD_LIMIT} bytes: ${initial.bytes}`);
  if (args.includes('--verify')) {
    if (!oldState || !Array.isArray(oldState.items)) throw new Error('No completed dataset manifest to verify');
    const allowed = new Set(auxiliaryFiles);
    const errors = [];
    for (const item of oldState.items) {
      try {
        const path = cleanRelative(item.relativePath); allowed.add(path);
        const file = inside(join(destination, path)), entry = await info(file);
        if (entry?.size !== item.outputBytes || !/^[a-f0-9]{64}$/i.test(item.outputSha256 || '') || await hashFile(file) !== item.outputSha256.toLowerCase()) throw new Error('Output size/hash mismatch');
        if (args.includes('--decode')) { await probe(file); await decode(file); }
        console.log(`[verified] ${item.id}`);
      } catch (error) { errors.push(`${item.id}: ${error.message}`); }
    }
    for (const preserved of oldState.preservedFiles || []) {
      try {
        const path = cleanRelative(preserved.relativePath); allowed.add(path);
        const file = inside(join(destination, path)), entry = await info(file);
        if (entry?.size !== preserved.bytes || !/^[a-f0-9]{64}$/i.test(preserved.sha256 || '') || await hashFile(file) !== preserved.sha256.toLowerCase()) throw new Error('Preserved file size/hash mismatch');
        console.log(`[preserved verified] ${path}`);
      } catch (error) { errors.push(`${preserved.relativePath}: ${error.message}`); }
    }
    for (const file of initial.files) if (!allowed.has(file.relativePath)) errors.push(`Unexpected file: ${file.relativePath}`);
    const limit = Math.min(HARD_LIMIT, Number(oldState.maxTotalBytes) || HARD_LIMIT);
    if (initial.bytes > limit) errors.push(`Total ${initial.bytes} exceeds ${limit}`);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Verified ${oldState.items.length} clips; total ${initial.bytes} / ${limit} bytes${args.includes('--decode') ? '; full video decode passed' : ''}.`);
    return;
  }

  const manifest = await readJson(sourceManifest);
  if (manifest.version !== 1 || !Array.isArray(manifest.items) || !Number.isSafeInteger(manifest.maxTotalBytes) || manifest.maxTotalBytes <= 0) throw new Error('Source manifest must contain version:1, maxTotalBytes and items');
  const maxTotalBytes = Math.min(HARD_LIMIT, manifest.maxTotalBytes), ids = new Set(), paths = new Set();
  for (const item of manifest.items) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(item.id || '') || ids.has(item.id)) throw new Error(`Invalid or repeated ID: ${item.id}`);
    ids.add(item.id); item.relativePath = cleanRelative(item.relativePath);
    const key = item.relativePath.toLowerCase();
    if (paths.has(key) || extname(item.relativePath).toLowerCase() !== '.mp4') throw new Error(`Duplicate path or non-MP4 output: ${item.relativePath}`);
    paths.add(key);
    if (!['http:', 'https:'].includes(new URL(item.url).protocol)) throw new Error(`Unsupported source URL: ${item.id}`);
    if (!Number.isSafeInteger(item.sourceBytes) || item.sourceBytes <= 0 || item.sourceBytes > maxTotalBytes - OUTPUT_LIMIT) throw new Error(`Invalid sourceBytes: ${item.id}`);
    if (item.sourceSha256 != null && !/^[a-f0-9]{64}$/i.test(item.sourceSha256)) throw new Error(`Invalid sourceSha256: ${item.id}`);
  }
  for (const id of only) if (!ids.has(id)) throw new Error(`--only ID does not exist: ${id}`);
  if (!(await info(ffmpeg))?.isFile()) throw new Error(`ffmpeg not found. Set QA_FFMPEG: ${ffmpeg}`);
  const work = inside(join(destination, '.work')); await safeParents(join(work, 'placeholder'));
  const items = new Map(), failures = new Map((oldState?.failures || []).map(item => [item.id, item]));
  // User files present before preparation are inventoried, never downloaded,
  // transcoded, renamed or removed. Keep their prior hashes on later runs.
  const preservedFiles = [];
  const previousPreserved = new Map((oldState?.preservedFiles || []).map(item => [item.relativePath, item]));
  const previouslyManaged = new Set((oldState?.items || []).map(item => item.relativePath));
  for (const file of initial.files) {
    if (auxiliaryFiles.has(file.relativePath) || previouslyManaged.has(file.relativePath) || file.relativePath.startsWith('.work/') || /^\.manifest-.*\.tmp$/.test(file.relativePath)) continue;
    cleanRelative(file.relativePath);
    const sha256 = await hashFile(file.path), previous = previousPreserved.get(file.relativePath);
    if (previous && (previous.bytes !== file.bytes || previous.sha256?.toLowerCase() !== sha256)) throw new Error(`Previously preserved user file changed: ${file.relativePath}; refusing to rewrite its recorded provenance`);
    preservedFiles.push({relativePath: file.relativePath, bytes: file.bytes, sha256});
    previousPreserved.delete(file.relativePath);
  }
  if (previousPreserved.size) throw new Error(`Previously preserved file is missing: ${[...previousPreserved.keys()].join(', ')}`);
  let used = initial.bytes, reserved = MANIFEST_RESERVE, next = 0, checkpointTail = Promise.resolve();
  if (used + reserved > maxTotalBytes) throw new Error('Insufficient space in the dataset byte budget for atomic metadata checkpoints');
  for (const item of oldState?.items || []) {
    try {
      const path = inside(join(destination, cleanRelative(item.relativePath))), entry = await info(path);
      if (entry?.size !== item.outputBytes || !/^[a-f0-9]{64}$/i.test(item.outputSha256 || '') || await hashFile(path) !== item.outputSha256.toLowerCase()) throw new Error('Previously completed output no longer matches its recorded hash/size');
      items.set(item.id, item);
    } catch (error) { failures.set(item.id, {id: item.id, error: error.message, at: new Date().toISOString()}); }
  }
  const checkpoint = () => {
    const pending = checkpointTail.then(async () => {
      const sourceMetadata = Object.fromEntries(['sourceAudit', 'description', 'createdOn'].filter(key => Object.hasOwn(manifest, key)).map(key => [key, manifest[key]]));
      const value = {version: 1, maxTotalBytes, sourceManifest: relative(project, sourceManifest).split(sep).join('/'), ...sourceMetadata, updatedAt: new Date().toISOString(),
        items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)), failures: [...failures.values()].sort((a, b) => a.id.localeCompare(b.id)), preservedFiles};
      const data = JSON.stringify(value, null, 2) + '\n', size = Buffer.byteLength(data);
      if (size > MANIFEST_LIMIT) throw new Error('Dataset metadata exceeds its reserved atomic-write budget');
      const previous = (await info(statePath))?.size || 0, temp = inside(join(destination, `.manifest-${randomUUID()}.tmp`));
      try { await writeFile(temp, data, {flag: 'wx'}); await rename(temp, statePath); used += size - previous; }
      finally { await removeOwned(temp); }
    });
    checkpointTail = pending.catch(() => {}); return pending;
  };
  const selected = manifest.items.filter(item => !only.length || only.includes(item.id));
  let failuresThisRun = 0;
  async function prepare(item) {
    signal.throwIfAborted();
    const output = inside(join(destination, item.relativePath));
    await safeParents(output);
    const previous = items.get(item.id), existing = await info(output);
    if (existing) {
      if (!previous || previous.relativePath !== item.relativePath || previous.url !== item.url || previous.sourceBytes !== item.sourceBytes
          || item.sourceSha256 && previous.sourceSha256?.toLowerCase() !== item.sourceSha256.toLowerCase()) throw new Error('Output already exists without matching verified provenance; refusing to overwrite');
      failures.delete(item.id); console.log(`[reuse] ${item.id}`); return;
    }
    const reservation = item.sourceBytes + OUTPUT_LIMIT;
    // Synchronous accounting happens before the next await: workers cannot all
    // reserve the same remaining bytes. Original and encoded files coexist here.
    if (used + reserved + reservation > maxTotalBytes) throw new Error(`Insufficient byte budget for source + output (${reservation} bytes required)`);
    reserved += reservation;
    const source = inside(join(work, `${item.id}.source`)), encoded = inside(join(work, `${item.id}.encoded.mp4`));
    let ownsSource = false, ownsEncoded = false;
    try {
      const sourceReservation = await open(source, 'wx'); ownsSource = true; await sourceReservation.close();
      const outputReservation = await open(encoded, 'wx'); ownsEncoded = true; await outputReservation.close();
      console.log(`[download] ${item.id} (${item.sourceBytes} source bytes)`);
      const downloaded = await download(item, source), sourceInfo = await probe(source);
      if (!(sourceInfo.duration > 0) || sourceInfo.duration > 120.05) throw new Error(`Source duration ${sourceInfo.duration}s is outside 0–120s; no trimming is performed`);
      const fps = Math.min(30, sourceInfo.fps || 30);
      // Full-range phone HEVC may otherwise retain pc range despite -pix_fmt
      // yuv420p, causing H.264 decoders to expose it as deprecated yuvj420p.
      // Convert samples and label the output consistently as limited-range YUV.
      const filter = `scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:in_range=auto:out_range=tv,fps=${fps}`;
      await runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-i', source, '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1',
        '-vf', filter, '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-threads', '2',
        '-fs', String(OUTPUT_LIMIT - 4_000_000), '-movflags', '+faststart', '-f', 'mp4', encoded]);
      const encodedInfo = await probe(encoded), outputBytes = (await lstat(encoded)).size;
      if (outputBytes > OUTPUT_LIMIT) throw new Error(`Encoded file exceeds ${OUTPUT_LIMIT} bytes`);
      if (Math.abs(encodedInfo.duration - sourceInfo.duration) > Math.max(0.35, 2 / fps)) throw new Error(`Encoding shortened/changed duration (${sourceInfo.duration}s → ${encodedInfo.duration}s); size-limited truncation is rejected`);
      if (encodedInfo.codec !== 'h264' || encodedInfo.pixelFormat !== 'yuv420p' || Math.max(encodedInfo.width, encodedInfo.height) > 1280
          || encodedInfo.width % 2 || encodedInfo.height % 2 || encodedInfo.fps > 30.01) throw new Error(`Encoded video does not meet H.264/yuv420p/dimension/frame-rate constraints: ${JSON.stringify({sourceInfo, encodedInfo, outputBytes})}`);
      await decode(encoded);
      const outputSha256 = await hashFile(encoded);
      if (await info(output)) throw new Error('Output appeared while preparing; refusing to overwrite');
      await rename(encoded, output);
      used += outputBytes;
      items.set(item.id, {...item, sourceBytes: downloaded.bytes, sourceSha256: downloaded.sha256, sourceDuration: sourceInfo.duration,
        outputBytes, outputSha256, duration: encodedInfo.duration, width: encodedInfo.width, height: encodedInfo.height, fps: encodedInfo.fps, codec: encodedInfo.codec,
        transformation: {container: 'mp4', codec: 'libx264', pixelFormat: 'yuv420p', colorRange: 'tv', crf: 22, maxLongEdge: 1280, upscale: false, maxFps: 30, audio: 'removed', faststart: true, trimming: 'none'},
        preparedAt: new Date().toISOString()});
      failures.delete(item.id);
      console.log(`[ready] ${item.id}: ${outputBytes} bytes, ${encodedInfo.duration}s, ${encodedInfo.width}x${encodedInfo.height}`);
    } finally {
      // These exact temporary filenames were created exclusively by this job.
      // No recursive removal, directory sweep or user-file cleanup is performed.
      if (ownsSource) await removeOwned(source);
      if (ownsEncoded) await removeOwned(encoded);
      reserved -= reservation;
    }
  }
  async function worker() {
    while (next < selected.length && !signal.aborted) {
      const item = selected[next++];
      try { await prepare(item); }
      catch (error) { failuresThisRun++; failures.set(item.id, {id: item.id, relativePath: item.relativePath, error: error.message, at: new Date().toISOString()}); console.error(`[failed] ${item.id}: ${error.message}`); }
      await checkpoint();
    }
  }
  await Promise.all(Array.from({length: Math.min(4, selected.length)}, worker));
  await checkpoint();
  const final = await scan();
  if (final.bytes > maxTotalBytes) throw new Error(`Dataset exceeded its hard byte cap: ${final.bytes} > ${maxTotalBytes}`);
  signal.throwIfAborted();
  console.log(`Completed ${items.size} clips; ${failuresThisRun} failures this run; total ${final.bytes} / ${maxTotalBytes} bytes.`);
  if (failuresThisRun) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = controller.signal.aborted ? 130 : 1; });
