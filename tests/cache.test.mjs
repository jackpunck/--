import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

test('应用静态资源每次验证版本，未修改资源仍可返回 304', async t => {
  const work = await mkdtemp(join(tmpdir(), 'fitness-cache-test-'));
  const publicDir = join(work, 'public');
  await mkdir(publicDir);
  const modelDir = join(publicDir, 'model');
  await mkdir(modelDir);
  const files = {
    'index.html': '<!doctype html><h1>cache test</h1>',
    'app.js': 'export const version = 1;',
    'app.css': 'body { color: green; }',
    'providers.css': '.provider { display: grid; }',
    'provider-ui.js': 'export const models = [];',
    'sw.js': 'self.addEventListener("fetch", () => {});',
    'model/demo.bundle.js': 'globalThis.modelVersion = 1;',
    'model/style.css': '.viewer { color: green; }',
  };
  await Promise.all(Object.entries(files).map(([name, body]) => writeFile(join(publicDir, name), body)));
  const server = createServer({ dataDir: join(work, 'data'), publicDir, modelDir });
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    await rm(work, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [name, body] of Object.entries(files)) {
    const response = await fetch(`${base}/${name}?v=3`);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('cache-control'), 'no-cache', name);
    assert.equal(await response.text(), body, name);
    const etag = response.headers.get('etag');
    assert(etag, `${name} should allow conditional requests`);
    const unchanged = await fetch(`${base}/${name}?v=3`, { headers: { 'If-None-Match': etag } });
    assert.equal(unchanged.status, 304, name);
    assert.equal(unchanged.headers.get('cache-control'), 'no-cache', name);
    assert.equal(await unchanged.text(), '', name);
    await writeFile(join(publicDir, name), `${body}\n/* new deployed version */`);
    const updated = await fetch(`${base}/${name}?v=3`, { headers: { 'If-None-Match': etag } });
    assert.equal(updated.status, 200, name);
    assert.notEqual(updated.headers.get('etag'), etag, name);
    assert.match(await updated.text(), /new deployed version/, name);
  }
});
