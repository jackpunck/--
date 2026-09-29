#!/usr/bin/env node
// 扫描 public/assets/exercises/ 下的真人动作封面图，生成 public/exercise-covers.js。
//
// 用法：
//   node scripts/build-exercise-covers.mjs           写入清单（npm run covers）
//   node scripts/build-exercise-covers.mjs --check   只校验清单是否与目录一致，不一致时退出码 1
//
// 命名规则：<动作 id>.<扩展名>，id 取自 public/domain.js 的 exercises；扩展名按
// .webp > .avif > .jpg > .jpeg > .png 取第一个命中项，同一 id 多份时以高优先者为准。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { exercises } from '../public/domain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coverDir = join(root, 'public', 'assets', 'exercises');
const target = join(root, 'public', 'exercise-covers.js');
const extensions = ['.webp', '.avif', '.jpg', '.jpeg', '.png'];
const checkOnly = process.argv.includes('--check');

let dirents = [];
try {
  dirents = await readdir(coverDir, { withFileTypes: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// 同一动作如果放了多种格式，按 extensions 的顺序决定用哪一份，其余只提示不报错。
const picked = new Map();
const unknown = [];
for (const dirent of dirents) {
  if (!dirent.isFile()) continue;
  const ext = extensions.find(candidate => dirent.name.toLowerCase().endsWith(candidate));
  if (!ext) continue;
  const id = dirent.name.slice(0, -ext.length);
  const exercise = exercises.find(item => item.id === id);
  if (!exercise) { unknown.push(dirent.name); continue; }
  const previous = picked.get(id);
  if (previous && extensions.indexOf(previous.ext) <= extensions.indexOf(ext)) {
    console.warn(`提示：${id} 同时存在 ${previous.name} 与 ${dirent.name}，清单使用 ${previous.name}。`);
    continue;
  }
  if (previous) console.warn(`提示：${id} 同时存在 ${previous.name} 与 ${dirent.name}，清单使用 ${dirent.name}。`);
  picked.set(id, { ext, name: dirent.name });
}

const missing = exercises.filter(item => !picked.has(item.id));
// 按 domain.js 的动作顺序输出，便于人工核对缺项。
const lines = exercises
  .map(item => item.id)
  .filter(id => picked.has(id))
  .map(id => `  '${id}': '${picked.get(id).name}',`);

const header = [
  '/**',
  ' * 动作卡片封面（真人图片）清单。',
  ' * 由 `npm run covers`（scripts/build-exercise-covers.mjs）扫描 public/assets/exercises/ 生成，',
  ' * 请不要手工编辑。命名规则：<动作 id>.webp，也接受 .avif/.jpg/.jpeg/.png。',
  ` * 已收录 ${picked.size}/${exercises.length}。`,
  missing.length
    ? ` * 待补 ${missing.length} 个：${missing.map(item => `${item.id} ${item.name}`).join('、')}。`
    : ' * 25 个动作封面已齐全。',
  ' *',
  ' * 图片规格、拍摄要求与来源授权记录见 public/assets/exercises/README.md 与 docs/封面素材.md。',
  ' * 没有收录封面的动作会在卡片上回退到原来的矢量图示，因此清单缺项不会造成 404。',
  ' */',
  'export const exerciseCovers = Object.freeze({',
].join('\n');

const source = `${header}\n${lines.join('\n')}${lines.length ? '\n' : ''}});\n\n`
  + '/** 封面地址；该动作没有收录真人封面时返回空串，调用方回退到矢量图示。 */\n'
  + 'export function coverUrl(id) {\n'
  + '  const file = exerciseCovers[id];\n'
  + "  return file ? `/assets/exercises/${file}` : '';\n"
  + '}\n';

if (checkOnly) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== source) {
    console.error('封面清单与 public/assets/exercises/ 不一致，请运行 npm run covers 重新生成。');
    process.exitCode = 1;
  } else {
    console.log(`封面清单已是最新：${picked.size}/${exercises.length} 个动作有真人封面。`);
  }
} else {
  await writeFile(target, source);
  console.log(`已写入 public/exercise-covers.js：${picked.size}/${exercises.length} 个动作有真人封面。`);
  if (missing.length) console.log(`待补：${missing.map(item => `${item.id} ${item.name}`).join('、')}`);
}

if (unknown.length) console.warn(`提示：以下文件不属于任何动作 id，已被忽略：${unknown.join('、')}`);
