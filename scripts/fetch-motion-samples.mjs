// Public, licensed real-person fixtures for local QA. No videos are distributed.
// List: node scripts/fetch-motion-samples.mjs
// Fetch/convert: QA_FFMPEG=/path/to/ffmpeg node scripts/fetch-motion-samples.mjs --download --convert --only seated-row,lateral-raise
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
const manifest = JSON.parse(await readFile(new URL('./motion-sample-sources.json', import.meta.url)));
const args = process.argv.slice(2), value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const only = value('--only')?.split(','), selected = manifest.samples.filter(sample => !only || only.includes(sample.id));
if (!selected.length || only?.some(id => !manifest.samples.some(sample => sample.id === id))) throw new Error('Unknown sample ID; run without arguments to list available samples.');
if (!args.includes('--download') && !args.includes('--verify') && !args.includes('--convert')) {
  console.table(selected.map(({ id, license, label }) => ({ id, license, exercise: label.exercise, fault: label.specificFault || 'not labelled' })));
} else {
  const output = resolve(value('--output') || '.qa/motion-fixtures'); await mkdir(output, { recursive: true });
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const ffmpeg = process.env.QA_FFMPEG || value('--ffmpeg') || 'ffmpeg';
  const ffmpegVersion = args.includes('--convert') ? execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0] : null;
  const converted = [];
  for (const sample of selected) {
    if (basename(sample.filename) !== sample.filename || basename(sample.playable) !== sample.playable) throw new Error('Invalid manifest filename.');
    const original = resolve(output, sample.filename), playable = resolve(output, sample.playable);
    let bytes = await readFile(original).catch(() => null);
    if (!bytes || sha(bytes) !== sample.sha256) {
      if (!args.includes('--download')) throw new Error(`Missing or changed source: ${sample.filename}`);
      const response = await fetch(sample.url); if (!response.ok) throw new Error(`Download failed: ${sample.id} HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (sha(bytes) !== sample.sha256) throw new Error(`Upstream SHA-256 changed: ${sample.id}; review the source instead of silently accepting it.`);
      await writeFile(original, bytes);
    }
    console.log(`Verified source: ${sample.id}`);
    if (args.includes('--convert')) {
      const existing = await readFile(playable).catch(() => null);
      if (!existing || sha(existing) !== sample.playableSha256) execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', original, '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', playable], { stdio: 'inherit' });
      const hash = sha(await readFile(playable));
      converted.push({ id: sample.id, filename: sample.playable, sha256: hash, matchesRecordedConversion: hash === sample.playableSha256 });
    }
  }
  if (converted.length) await writeFile(resolve(output, 'motion-sample-conversions.json'), JSON.stringify({ ffmpegVersion, note: 'Encoder builds may differ byte-for-byte; original downloaded SHA-256 must always match the source manifest.', converted }, null, 2));
}
