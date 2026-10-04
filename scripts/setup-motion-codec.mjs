import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const root = new URL('../public/vendor/ffmpeg/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const verifyOnly = process.argv.includes('--verify');
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Codec download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
function tarFiles(archive) {
  const tar = gunzipSync(archive), files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid codec archive');
    if (header[156] === 48 || header[156] === 0) files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
let packageContent;
for (const item of manifest.files) {
  // Only manifest-named flat assets are written. Archive names never become paths.
  if (!/^[\w.-]+$/.test(item.path)) throw new Error('Invalid codec asset path');
  const target = new URL(item.path, root);
  const current = await readFile(target).catch(() => undefined);
  if (current && digest(current) === item.sha256) { console.log(`Verified codec ${item.path}`); continue; }
  if (verifyOnly) throw new Error(`Missing or incorrect codec asset: ${item.path}`);
  let bytes;
  if (item.url) bytes = await download(item.url);
  else {
    if (!packageContent) {
      const archive = await download(manifest.tarball);
      if (`sha512-${digest(archive, 'sha512', 'base64')}` !== manifest.integrity) throw new Error('Codec npm integrity mismatch');
      packageContent = tarFiles(archive);
    }
    bytes = packageContent.get(`package/${item.packagePath}`);
  }
  if (!bytes || digest(bytes) !== item.sha256) throw new Error(`Codec source checksum mismatch: ${item.path}`);
  await mkdir(root, { recursive: true });
  await writeFile(target, bytes);
  console.log(`Restored codec ${item.path}`);
}
