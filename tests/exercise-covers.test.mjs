import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';
import { exercises } from '../public/domain.js';
import { exerciseCovers, coverUrl } from '../public/exercise-covers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coverDir = join(root, 'public', 'assets', 'exercises');
const extensions = ['.webp', '.avif', '.jpg', '.jpeg', '.png'];
const ids = new Set(exercises.map(exercise => exercise.id));
const extensionOf = name => extensions.find(extension => name.toLowerCase().endsWith(extension));

test('封面清单只引用真实动作，并且每个条目都对应磁盘上的文件', async () => {
  for (const [id, file] of Object.entries(exerciseCovers)) {
    assert.ok(ids.has(id), `封面清单里的 ${id} 不是 domain.js 中的动作 id`);
    assert.equal(file, file.split(/[\\/]/).pop(), `${id} 的封面值必须是文件名，不能带目录`);
    assert.ok(extensions.includes(extensionOf(file)), `${id} 的封面扩展名不受支持：${file}`);
    const info = await stat(join(coverDir, file)).catch(() => null);
    assert.ok(info?.isFile(), `${id} 的封面 ${file} 不在 public/assets/exercises/ 中，会导致卡片 404`);
  }
});

test('清单与封面目录保持一致，不会漏掉已放入的图片', async () => {
  const dirents = await readdir(coverDir, { withFileTypes: true }).catch(() => []);
  const onDisk = dirents
    .filter(dirent => dirent.isFile() && extensionOf(dirent.name))
    .map(dirent => dirent.name.slice(0, -extensionOf(dirent.name).length))
    .filter(id => ids.has(id));
  for (const id of onDisk) assert.ok(exerciseCovers[id], `${id} 已经有封面文件，请运行 npm run covers 重新生成清单`);
  for (const id of Object.keys(exerciseCovers)) assert.ok(onDisk.includes(id), `${id} 在清单里但目录中没有对应文件`);
});

test('没有收录封面的动作回退到空串，未知 id 也不会拼出路径', () => {
  for (const exercise of exercises) {
    const url = coverUrl(exercise.id);
    if (exerciseCovers[exercise.id]) assert.equal(url, `/assets/exercises/${exerciseCovers[exercise.id]}`);
    else assert.equal(url, '', `${exercise.id} 没有真人封面时应回退到矢量图示`);
  }
  for (const unknown of ['', 'not-a-move', '../../server.key', 'squat.webp']) assert.equal(coverUrl(unknown), '');
});

test('封面目录由静态服务按图片类型提供，缺失文件不会回退到其他资源', async t => {
  const work = await mkdtemp(join(tmpdir(), 'fitness-cover-test-'));
  const publicDir = join(work, 'public');
  const covers = join(publicDir, 'assets', 'exercises');
  await mkdir(covers, { recursive: true });
  await writeFile(join(covers, 'squat.webp'), Buffer.from('RIFF0000WEBPVP8 '));
  const server = createServer({ dataDir: join(work, 'data'), publicDir, modelDir: join(publicDir, 'model') });
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    await rm(work, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const hit = await fetch(`${base}/assets/exercises/squat.webp`);
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get('content-type'), 'image/webp');

  assert.equal((await fetch(`${base}/assets/exercises/missing.webp`)).status, 404);
});
