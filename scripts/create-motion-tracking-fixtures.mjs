// Explicitly synthetic layouts made from licensed, real-person demonstrations.
// These test target selection/loss; they do not establish natural-scene accuracy.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const folder = resolve(process.argv[2] || '.qa/motion-fixtures'), ffmpeg = process.env.QA_FFMPEG || 'ffmpeg';
const sourceNames = ['wger-seated-row-h264.mp4', 'subject_001_bicep_curl_good_side-h264.mp4'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = await Promise.all(sourceNames.map(async filename => ({ filename, sha256: sha(await readFile(resolve(folder, filename))) })));
const cases = [];
for (const disappears of [false, true]) {
  const filename = disappears ? 'composite-row-target-disappears.mp4' : 'composite-row-and-curl.mp4';
  const filter = '[0:v]scale=960:540,pad=960:720:0:90:color=black,setsar=1[a];[1:v]scale=320:568,pad=320:720:0:76:color=black,setsar=1[b];[a][b]hstack=inputs=2' + (disappears ? ",drawbox=x=0:y=0:w=960:h=720:color=black:t=fill:enable='gte(t,4)'" : '');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(folder, sourceNames[0]), '-i', resolve(folder, sourceNames[1]), '-filter_complex', filter, '-t', '8', '-r', '15', '-an', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', resolve(folder, filename)], { stdio: 'inherit' });
  cases.push({ filename, sha256: sha(await readFile(resolve(folder, filename))), kind: 'synthetic-composite-from-real-videos', defaultTarget: 'seated row in the larger left panel, closer to image center', pointTarget: { x: 0.88, y: 0.52, exercise: 'bicep curl in right panel' }, targetHiddenAfter: disappears ? 4 : null, expected: disappears ? 'Center target becomes lost; never switch to the remaining right-panel person.' : 'Center locks row; explicit right-panel point locks curl.', filter });
}
await writeFile(resolve(folder, 'motion-tracking-composite-sources.json'), JSON.stringify({ license: 'CC BY-SA 4.0', authors: 'Goulart (wger); S Ashlesh Pai, Pratham PN, Advith P, Abhishek Mashetty (Mendeley)', licenseSourceManifest: 'scripts/motion-sample-sources.json', note: 'Locally constructed side-by-side panels. Synthetic functional cases; not naturally recorded interactions or certified movement-quality examples.', ffmpegVersion: execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0], sources, cases }, null, 2));
console.log(cases.map(item => item.filename).join('\n'));
