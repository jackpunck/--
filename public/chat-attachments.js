// Clipboard access is driven only by the user's paste/drop event. Never read
// arbitrary clipboard data or treat copied local paths/HTML images as files.
export function filesFromTransfer(transfer) {
  if (!transfer) return [];
  const items = Array.from(transfer.items || []);
  const fileItems = items.filter(item => item.kind === 'file');
  const fromItems = fileItems.map(item => {
    try {
      if (item.webkitGetAsEntry?.()?.isDirectory) return null;
      return item.getAsFile?.();
    } catch { return null; }
  }).filter(Boolean);
  return [...new Set(fileItems.length ? fromItems : Array.from(transfer.files || []))];
}

const maxSize = 8 * 1024 * 1024;
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json']);
const extensions = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', pdf:'application/pdf', txt:'text/plain', md:'text/markdown', markdown:'text/markdown', csv:'text/csv', json:'application/json' };
const imageExtensions = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif' };

export function normalizeChatFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size)) throw new Error('请粘贴或选择实际文件，文件路径不能直接作为附件。');
  if (!file.size) throw new Error('不能上传空文件。');
  if (file.size > maxSize) throw new Error('单个附件不能超过 8 MB。');
  const originalName = typeof file.name === 'string' ? file.name.replace(/^.*[\\/]/, '').trim() : '';
  const ext = originalName.split('.').at(-1)?.toLowerCase();
  let type = String(file.type || '').toLowerCase().split(';')[0].trim();
  if (!type || type === 'application/octet-stream') type = extensions[ext] || '';
  if (type === 'image/pjpeg') type = 'image/jpeg';
  if (!types.has(type)) throw new Error('支持 JPG、PNG、WebP、GIF、PDF、TXT、Markdown、CSV 和 JSON 文件。');
  const name = originalName || (type.startsWith('image/') ? `粘贴图片.${imageExtensions[type]}` : `附件.${ext || 'txt'}`);
  if (name.length > 200 || /[\r\n\0]/.test(name)) throw new Error('文件名应为 1–200 个字符，不能包含换行。');
  return { name, type, size:file.size };
}

function fileKey(file, metadata) { return JSON.stringify([metadata.name, metadata.type, metadata.size, file.lastModified ?? 0]); }
let nextEntry = 0;

/** Per-account, per-draft uploads. File bytes and object URLs stay in memory;
 * only successful server attachment references may enter a conversation. */
export class AttachmentManager {
  constructor({ upload, removeRemote = async () => {}, onChange = () => {} }) {
    if (typeof upload !== 'function') throw new TypeError('An upload callback is required');
    this.upload = upload; this.removeRemote = removeRemote; this.onChange = onChange;
    this.owners = new Map(); this.jobs = new Set();
  }
  list(ownerKey) { return (this.owners.get(ownerKey) || []).map(entry => this.publicEntry(entry)); }
  publicEntry({ id, name, type, size, status, attachment, previewUrl, error }) {
    return { id, name, type, size, status, ...(attachment ? {attachment:{...attachment}} : {}), ...(previewUrl ? {previewUrl} : {}), ...(error ? {error} : {}) };
  }
  notify(ownerKey) { this.onChange(ownerKey); }
  add(ownerKey, files) {
    if (typeof ownerKey !== 'string' || !ownerKey) throw new Error('附件缺少所属会话。');
    const entries = this.owners.get(ownerKey) || [];
    const added = [], errors = [];
    this.owners.set(ownerKey, entries);
    for (const file of Array.from(files || [])) {
      let metadata;
      try { metadata = normalizeChatFile(file); } catch (error) { errors.push(`${file?.name || '附件'}：${error.message}`); continue; }
      const key = fileKey(file, metadata);
      if (entries.some(entry => entry.key === key)) continue;
      if (entries.length >= 6) { errors.push('每条消息最多保留 6 个附件，请先移除不需要的附件。'); break; }
      const entry = { id:`attachment-${++nextEntry}`, ...metadata, file, key, status:'uploading', error:'', removed:false, attempt:0 };
      if (metadata.type.startsWith('image/')) entry.previewUrl = URL.createObjectURL(file);
      entries.push(entry); added.push(this.publicEntry(entry));
      this.start(ownerKey, entry);
    }
    this.notify(ownerKey);
    return { added, errors };
  }
  seed(ownerKey, attachments) {
    const entries = this.owners.get(ownerKey) || [];
    this.owners.set(ownerKey, entries);
    for (const attachment of attachments || []) {
      if (!attachment?.id || entries.some(entry => entry.attachment?.id === attachment.id)) continue;
      if (entries.length >= 6) break;
      entries.push({ id:`attachment-${++nextEntry}`, name:attachment.name, type:attachment.type, size:attachment.size || 0, status:'ready', attachment:{...attachment}, removed:false, attempt:0, restored:true });
    }
    this.notify(ownerKey);
  }
  start(ownerKey, entry) {
    const attempt = ++entry.attempt;
    const controller = new AbortController();
    entry.controller = controller; entry.status = 'uploading'; entry.error = '';
    const job = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.upload(entry.file, {signal:controller.signal, ownerKey, metadata:{name:entry.name,type:entry.type,size:entry.size}});
    }).then(async attachment => {
      if (!attachment || typeof attachment.id !== 'string' || !attachment.id) throw new Error('上传未返回有效的附件，请重试。');
      if (entry.removed || entry.attempt !== attempt || controller.signal.aborted) {
        await this.removeRemote(attachment, {ownerKey}).catch(() => {});
        return;
      }
      entry.attachment = {...attachment}; entry.status = 'ready';
    }).catch(error => {
      if (!entry.removed && entry.attempt === attempt) { entry.status = 'error'; entry.error = error.name === 'AbortError' ? '上传已取消，请重试。' : error.message || '上传失败，请重试。'; }
    }).finally(() => { this.jobs.delete(job); if (!entry.removed && entry.attempt === attempt) this.notify(ownerKey); });
    this.jobs.add(job);
  }
  retry(ownerKey, id) {
    const entry = (this.owners.get(ownerKey) || []).find(entry => entry.id === id);
    if (!entry || entry.status !== 'error' || !entry.file) return false;
    this.start(ownerKey, entry); this.notify(ownerKey); return true;
  }
  release(entry) {
    entry.removed = true; entry.controller?.abort();
    if (entry.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(entry.previewUrl);
  }
  async remove(ownerKey, id) {
    const entries = this.owners.get(ownerKey) || [];
    const index = entries.findIndex(entry => entry.id === id);
    if (index === -1) return;
    const [entry] = entries.splice(index, 1); this.release(entry); this.notify(ownerKey);
    // A restored attachment may still belong to a saved message. Its owner is
    // that record; removing its draft reference must not delete the original.
    if (entry.attachment && !entry.restored) await this.removeRemote(entry.attachment, {ownerKey});
  }
  ready(ownerKey) {
    const entries = this.owners.get(ownerKey) || [];
    if (entries.some(entry => entry.status === 'uploading')) throw new Error('附件正在上传，完成后再发送。');
    if (entries.some(entry => entry.status === 'error')) throw new Error('有附件上传失败，请重试或移除后再发送。');
    return entries.map(entry => ({...entry.attachment}));
  }
  takeReady(ownerKey) { const attachments = this.ready(ownerKey); this.clear(ownerKey); return attachments; }
  clear(ownerKey, {removeUploaded = false} = {}) {
    const entries = this.owners.get(ownerKey) || [];
    this.owners.delete(ownerKey);
    const removals = [];
    for (const entry of entries) {
      this.release(entry);
      if (removeUploaded && entry.attachment && !entry.restored) removals.push(this.removeRemote(entry.attachment, {ownerKey}).catch(() => {}));
    }
    this.notify(ownerKey);
    return Promise.all(removals);
  }
  clearAll(options) { return Promise.all([...this.owners.keys()].map(ownerKey => this.clear(ownerKey, options))); }
  async whenIdle() { while (this.jobs.size) await Promise.all([...this.jobs]); }
}
