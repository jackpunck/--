// YOLO26 is shipped locally. Verify bytes before deployment; rebuilding uses
// the explicitly pinned development-only Python exporter, never runtime pip.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = new URL('../public/vendor/yolo26/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
for (const file of manifest.files) {
  if (!/^[\w.-]+$/.test(file.path)) throw new Error('Invalid YOLO26 asset path');
  const bytes = await readFile(new URL(file.path, root)).catch(() => {
    throw new Error(`Missing ${file.path}; restore the shipped file or run scripts/export-motion-yolo26.py in the documented development environment.`);
  });
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`YOLO26 checksum mismatch: ${file.path}`);
  console.log(`Verified yolo26/${file.path}`);
}
