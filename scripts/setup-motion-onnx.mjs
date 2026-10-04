import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const verifyOnly = process.argv.includes('--verify');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// Read a named ZIP member directly; never extract archive paths to disk.
function zipFile(zip, name) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Invalid ZIP archive');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = zip.readUInt16LE(offset + 10), size = zip.readUInt32LE(offset + 20), unpackedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42), member = zip.subarray(offset + 46, offset + 46 + nameLength).toString();
    if (member === name) {
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP member');
      const dataOffset = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      if (dataOffset + size > zip.length || unpackedSize > 300000000) throw new Error('Invalid ZIP member size');
      const compressed = zip.subarray(dataOffset, dataOffset + size);
      const bytes = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed, { maxOutputLength: unpackedSize }) : undefined;
      if (!bytes || bytes.length !== unpackedSize) throw new Error('Unsupported ZIP member');
      return bytes;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing archive member: ${name}`);
}

function tarFile(tar, name) {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const member = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid npm package archive');
    if (member === name && (header[156] === 48 || header[156] === 0)) return tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Missing archive member: ${name}`);
}

for (const directory of ['onnxruntime', 'rtmw']) {
  const root = new URL(`../public/vendor/${directory}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const archives = new Map();
  for (const item of manifest.files) {
    const path = item.path || item.file;
    if (!/^[\w.-]+$/.test(path)) throw new Error('Invalid asset path');
    const target = new URL(path, root), current = await readFile(target).catch(() => undefined);
    if (current && digest(current) === item.sha256) { console.log(`Verified ${directory}/${path}`); continue; }
    if (verifyOnly) throw new Error(`Missing or incorrect asset: ${directory}/${path}`);
    let bytes;
    if (item.url) bytes = await download(item.url);
    else {
      const definition = manifest.archives[item.archive];
      if (!definition) throw new Error('Unknown source archive');
      if (!archives.has(item.archive)) {
        const archive = await download(definition.url);
        if (digest(archive) !== definition.sha256) throw new Error('Upstream archive checksum mismatch');
        if (definition.integrity && `sha512-${createHash('sha512').update(archive).digest('base64')}` !== definition.integrity) throw new Error('npm integrity mismatch');
        archives.set(item.archive, definition.format === 'tgz' ? gunzipSync(archive) : archive);
      }
      const archive = archives.get(item.archive);
      bytes = definition.format === 'tgz' ? tarFile(archive, item.archivePath) : zipFile(archive, item.archivePath);
    }
    if (!bytes || digest(bytes) !== item.sha256 || bytes.length !== item.bytes) throw new Error(`Upstream checksum mismatch: ${path}`);
    await mkdir(root, { recursive: true }); await writeFile(target, bytes);
    console.log(`Restored ${directory}/${path}`);
  }
}
