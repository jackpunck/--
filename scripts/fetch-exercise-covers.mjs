#!/usr/bin/env node
// 从 free-exercise-db（公共领域 / Unlicense）下载真人动作封面，落成 public/assets/exercises/<动作 id>.jpg。
//
// 用法：
//   node scripts/fetch-exercise-covers.mjs            下载缺失的封面（已存在的不覆盖）
//   node scripts/fetch-exercise-covers.mjs --force    重新下载全部
//   node scripts/fetch-exercise-covers.mjs --dry-run  只打印来源对照表，不下载
//
// 数据集：https://github.com/yuhonas/free-exercise-db （LICENSE.md 为 Unlicense）
// 图片地址：https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<条目>/1.jpg
// 每个动作有两帧：0.jpg 起始、1.jpg 发力/结束，封面取 1.jpg。
// 原始尺寸 850×567（正好 3:2），35–70 KB，与 public/assets/exercises/README.md 的规格一致，无需再压缩。
//
// 下载后请运行 `npm run covers` 生成清单，并把来源登记到 docs/封面素材.md。
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exercises } from '../public/domain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coverDir = join(root, 'public', 'assets', 'exercises');
const remote = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

// 动作 id → free-exercise-db 条目名。条目名必须真实存在，否则脚本直接报错，不会静默跳过。
const catalog = {
  squat: 'Bodyweight_Squat',
  pushup: 'Pushups',
  curl: 'Dumbbell_Bicep_Curl',
  bench: 'Dumbbell_Bench_Press',
  'incline-bench': 'Incline_Dumbbell_Press',
  'chest-press': 'Leverage_Chest_Press',
  'lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  row: 'Seated_Cable_Rows',
  'dumbbell-row': 'One-Arm_Dumbbell_Row',
  pullup: 'Band_Assisted_Pull-Up',
  'shoulder-press': 'Dumbbell_Shoulder_Press',
  'lateral-raise': 'Side_Lateral_Raise',
  'reverse-fly': 'Reverse_Flyes',
  triceps: 'Triceps_Pushdown_-_Rope_Attachment',
  'overhead-triceps': 'Standing_Dumbbell_Triceps_Extension',
  'hammer-curl': 'Hammer_Curls',
  'goblet-squat': 'Goblet_Squat',
  rdl: 'Stiff-Legged_Dumbbell_Deadlift',
  lunge: 'Dumbbell_Rear_Lunge',
  'leg-curl': 'Lying_Leg_Curls',
  'leg-extension': 'Leg_Extensions',
  'glute-bridge': 'Butt_Lift_Bridge',
  plank: 'Plank',
  crunch: 'Crunches',
  'calf-raise': 'Standing_Dumbbell_Calf_Raise',
};

const datasetPath = process.env.FED_JSON || join(root, '.qa', 'fed.json');
const dataset = await readFile(datasetPath, 'utf8')
  .then(text => JSON.parse(text))
  .catch(async () => {
    // 本地没有就现取一份索引，用来校验下面的映射，避免把不存在的条目写成 404。
    const response = await fetch(`${remote}/../dist/exercises.json`);
    if (!response.ok) { console.error(`无法获取数据集索引：HTTP ${response.status}`); process.exit(1); }
    const text = await response.text();
    await mkdir(dirname(datasetPath), { recursive: true }).catch(() => {});
    await writeFile(datasetPath, text).catch(() => {});
    return JSON.parse(text);
  });

const rows = [];
const problems = [];
for (const exercise of exercises) {
  const entry = catalog[exercise.id];
  if (!entry) { problems.push(`${exercise.id} ${exercise.name} 没有配置数据集条目`); continue; }
  const match = dataset.find(item => item.id === entry || item.name === entry);
  if (!match) { problems.push(`${exercise.id} 的条目 ${entry} 在数据集中不存在`); continue; }
  if (!match.images?.some(image => image.endsWith('/1.jpg'))) { problems.push(`${exercise.id} 的条目 ${entry} 没有第二帧图片`); continue; }
  rows.push({ id: exercise.id, name: exercise.name, entry, file: `${exercise.id}.jpg`, url: `${remote}/${entry}/1.jpg`, equipment: match.equipment ?? '?' });
}

if (problems.length) {
  console.error(`映射有问题，未做任何下载：\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const table = rows.map(row => `| ${row.id} | ${row.name} | ${row.entry} | ${row.equipment} |`).join('\n');
console.log(`动作 → free-exercise-db 条目（${rows.length} 条）：\n| id | 动作 | 数据集条目 | 器械 |\n| --- | --- | --- | --- |\n${table}\n`);
if (dryRun) {
  console.log('（--dry-run，未下载）');
  process.exit(0);
}

await mkdir(coverDir, { recursive: true });
const exists = path => access(path).then(() => true, () => false);
const wait = ms => new Promise(done => setTimeout(done, ms));
// raw.githubusercontent.com 偶发 ECONNRESET，重试三次并放慢节奏，避免中途整批失败。
async function download(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'fitness-assistant-cover-fetch' } });
      if (!response.ok) { console.error(`下载失败 ${url} → HTTP ${response.status}`); return null; }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === attempts) { console.error(`下载失败 ${url} → ${error.message}`); return null; }
      console.warn(`重试 ${attempt}/${attempts - 1} ${url} → ${error.message}`);
      await wait(attempt * 800);
    }
  }
  return null;
}

let downloaded = 0, skipped = 0, bytes = 0;
for (const row of rows) {
  const target = join(coverDir, row.file);
  if (!force && await exists(target)) { skipped++; continue; }
  const body = await download(row.url);
  if (!body) { process.exitCode = 1; continue; }
  await writeFile(target, body);
  downloaded++; bytes += body.length;
  console.log(`已保存 ${row.file}  ←  ${row.entry}/1.jpg  ${(body.length / 1024).toFixed(1)} KB`);
  await wait(120);
}
console.log(`\n完成：新下载 ${downloaded} 张，跳过已有 ${skipped} 张，共 ${(bytes / 1024 / 1024).toFixed(2)} MB。`);
console.log('下一步：npm run covers，并把来源登记到 docs/封面素材.md。');
