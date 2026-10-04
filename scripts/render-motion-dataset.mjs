// Render an offline catalogue after prepare-motion-dataset.mjs has finished.
// node scripts/render-motion-dataset.mjs --root 测试集
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/render-motion-dataset.mjs [--root 测试集] [--manifest /path/to/manifest.json]');
  process.exit(0);
}
const option = name => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`${name} 缺少路径参数。`);
  return args[at + 1];
};
for (let i = 0; i < args.length; i += 2) {
  if (!['--root', '--output', '--manifest'].includes(args[i])) throw new Error(`未知参数：${args[i]}`);
}
const root = resolve(option('--root') || option('--output') || '测试集');
const manifestPath = resolve(option('--manifest') || resolve(root, 'manifest.json'));
const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
if (!Array.isArray(manifest.items)) throw new Error('manifest.json 必须包含 items 数组。');
const maxBytes = Math.min(3_000_000_000, Number(manifest.maxTotalBytes) || 3_000_000_000);
const generatedFiles = ['index.html', 'README.md', 'manifest.csv'];
const sourceNames = { 'mendeley-multiview': 'Mendeley 多视角动作集', mydeadlift: 'MyDeadlift 硬拉数据集', wger: 'Wger 动作演示', commons: 'Wikimedia Commons' };
const qualityNames = {
  author_good: '作者标注正确', author_bad: '作者标注错误',
  demonstration_unverified: '动作演示（未标注正误）',
  mixed_tutorial: '正误混合教学', scene: '场景测试（未标注正误）',
};
const plain = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const safeHttpUrl = value => {
  try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
};
const localPath = value => {
  const path = String(value || '').replace(/\\/g, '/');
  if (!path || path.includes('\0') || path.includes(':') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`无效的视频相对路径：${value}`);
  const absolute = resolve(root, path);
  const inside = relative(root, absolute);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error(`视频路径越出测试集：${value}`);
  return path;
};
const entries = [];
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`测试集包含链接，无法可靠核验总大小：${path}`);
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile()) entries.push({ path: relative(root, path).replace(/\\/g, '/'), size: (await lstat(path)).size });
  }
}
await scan(root);
const fileSizes = new Map(entries.map(entry => [entry.path, entry.size]));
const currentBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
if (currentBytes > maxBytes) throw new Error(`测试集已超过容量上限：${currentBytes} > ${maxBytes} 字节。`);
const ids = new Set(), paths = new Set();
const items = manifest.items.map(item => {
  const path = localPath(item.relativePath);
  if (!fileSizes.has(path)) throw new Error(`清单中的视频不存在：${path}`);
  if (paths.has(path)) throw new Error(`重复的视频路径：${path}`);
  paths.add(path);
  const id = plain(item.id || path);
  if (ids.has(id)) throw new Error(`重复的视频 ID：${id}`);
  ids.add(id);
  const quality = Object.hasOwn(qualityNames, item.qualityLabel) ? item.qualityLabel : 'demonstration_unverified';
  const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  return {
    id, relativePath: path, url: './' + path.split('/').map(encodeURIComponent).join('/'),
    exercise: plain(item.exercise), exerciseNameZh: plain(item.exerciseNameZh || item.exercise || '未命名动作'),
    qualityLabel: quality, qualityName: qualityNames[quality],
    subject: plain(item.subject), view: plain(item.view), sourceLabel: plain(sourceNames[item.sourceGroup] || item.sourceGroup || item.dataset || '未注明来源'),
    sourceFormLabel: plain(item.sourceLabel),
    sourceGroup: plain(item.sourceGroup), dataset: plain(item.dataset), sourceUrl: safeHttpUrl(item.sourceUrl || item.url),
    specificFault: plain(item.specificFault), sourcePage: safeHttpUrl(item.sourcePage),
    license: plain(typeof item.license === 'object' ? item.license?.name : item.license), licenseUrl: safeHttpUrl(item.licenseUrl),
    author: plain(item.author), labelProvenance: plain(item.labelProvenance),
    notes: plain(Array.isArray(item.notes) ? item.notes.join(' ') : item.notes),
    sourceBytes: number(item.sourceBytes), sourceSha256: plain(item.sourceSha256),
    outputBytes: fileSizes.get(path), outputSha256: plain(item.outputSha256),
    duration: number(item.duration), width: number(item.width), height: number(item.height),
    transformation: plain(typeof item.transformation === 'object' ? JSON.stringify(item.transformation) : item.transformation),
  };
}).sort((a, b) => a.exerciseNameZh.localeCompare(b.exerciseNameZh, 'zh-CN') || a.qualityLabel.localeCompare(b.qualityLabel) || a.id.localeCompare(b.id));
const countBy = key => [...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) || 0) + 1), new Map())].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
const sources = countBy('sourceLabel'), exercises = countBy('exerciseNameZh'), qualities = countBy('qualityName');
const failed = Array.isArray(manifest.failures) ? manifest.failures.length : 0;
const mediaBytes = items.reduce((sum, item) => sum + item.outputBytes, 0);
const formatBytes = value => `${(value / 1e9).toFixed(3)} GB（${value.toLocaleString('en-US')} 字节）`;
const htmlEscape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const embeddedJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
const md = value => String(value).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
const table = rows => rows.map(([name, count]) => `| ${md(name)} | ${count} |`).join('\n');

function renderHtml(totalBytes) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>循序 · 动作视频测试集</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1e293b;background:#f4f6fb;font-synthesis:none}*{box-sizing:border-box}body{margin:0}main{max-width:1420px;margin:auto;padding:28px}header{margin-bottom:24px}h1{margin:8px 0;font-size:28px}h2{font-size:18px;margin:0 0 12px}p{line-height:1.65;margin:8px 0}a{color:#254fe3}small,.muted{color:#64748b}.eyebrow{font-size:12px;letter-spacing:.13em;color:#536485}.stats{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.stat{background:white;padding:14px 20px;border:1px solid #e0e6f0;border-radius:12px;min-width:150px}.stat strong{display:block;font-size:23px;margin-bottom:3px}.notice{background:#fff9eb;border:1px solid #f1dfb9;padding:12px 16px;border-radius:10px;font-size:13px}.layout{display:grid;grid-template-columns:minmax(320px,44%) minmax(0,1fr);gap:20px}.panel{background:white;border:1px solid #e0e6f0;border-radius:14px;padding:20px}.filters{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}.filters label{font-size:12px;color:#526278;display:grid;gap:6px}.filters label:first-child{grid-column:1/-1}select,input{width:100%;min-width:0;font:inherit;font-size:14px;padding:10px;border:1px solid #cdd6e3;border-radius:7px;background:white;color:#1e293b}.list{max-height:660px;overflow:auto;margin:10px -8px 0;padding:0 8px}.item{display:block;width:100%;background:white;border:1px solid #e1e7f0;border-radius:9px;margin-bottom:9px;padding:12px;text-align:left;cursor:pointer;color:inherit;font:inherit}.item:hover{border-color:#a7b8ec}.item[aria-pressed=true]{background:#eef3ff;border-color:#5278e6;box-shadow:inset 3px 0 #5278e6}.item-title{display:flex;justify-content:space-between;gap:10px;align-items:start;margin-bottom:7px;font-size:14px}.item-meta{display:block;color:#64748b;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.badge{font-size:11px;padding:3px 7px;border-radius:5px;white-space:nowrap;background:#eef1f6;color:#516174}.author_good{background:#e9f7ee;color:#276743}.author_bad{background:#fff0ec;color:#ab4931}.mixed_tutorial{background:#fff5dc;color:#8b6919}.scene{background:#edf0ff;color:#535bad}.player-panel{align-self:start;position:sticky;top:20px}video{display:block;width:100%;max-height:490px;background:#101827;border-radius:9px;margin:14px 0}video[hidden]{display:none}.empty{padding:60px 24px;text-align:center;border:1px dashed #cbd5e1;border-radius:10px;color:#64748b;margin:14px 0}.facts{display:grid;grid-template-columns:90px minmax(0,1fr);gap:9px 12px;font-size:13px;line-height:1.6;margin:16px 0}.facts dt{color:#64748b}.facts dd{margin:0;overflow-wrap:anywhere}.links{display:flex;gap:16px;flex-wrap:wrap;font-size:13px}code{font-size:11px;overflow-wrap:anywhere}.foot{font-size:12px;margin-top:22px;color:#64748b}@media(max-width:800px){main{padding:16px}.layout{grid-template-columns:1fr}.player-panel{position:static;grid-row:1}.panel{padding:16px}.list{max-height:430px}h1{font-size:23px}.stat{min-width:0;flex:1;padding:12px}.stat strong{font-size:18px;white-space:nowrap}.item-title{flex-wrap:wrap}}@media(prefers-reduced-motion:no-preference){.item{transition:border-color .15s}}
</style></head><body><main>
<header><div class="eyebrow">循序 / 本地测试资料</div><h1>动作视频测试集</h1><p class="muted">按动作、来源与标签筛选，选择一段视频后播放。可直接离线打开本页。</p>
<div class="stats"><div class="stat"><strong>${items.length}</strong><small>段已下载视频</small></div><div class="stat"><strong>${exercises.length}</strong><small>种动作 / 场景</small></div><div class="stat"><strong>${(totalBytes / 1e9).toFixed(3)} GB</strong><small>整个文件夹 · 上限 ${(maxBytes / 1e9).toFixed(0)} GB</small></div></div>
<div class="notice">“作者标注正确 / 错误”沿用数据源标签，不表示已由独立教练复核。动作演示未标注正误；正误混合教学需要按片段判断。本测试集用于功能与评估对照，不代表模型准确率。</div></header>
<div class="layout"><section class="panel"><h2>选择视频</h2><div class="filters"><label>搜索动作、受试者或文件名<input id="search" type="search" placeholder="例如：深蹲、卧推、subject_001" autocomplete="off"></label><label>动作<select id="exercise"><option value="">全部动作</option></select></label><label>标签<select id="quality"><option value="">全部标签</option></select></label><label>来源<select id="source"><option value="">全部来源</option></select></label></div><div id="result-count" class="muted" aria-live="polite"></div><div id="list" class="list"></div></section>
<section class="panel player-panel"><h2 id="video-title">选择一段视频</h2><p id="video-subtitle" class="muted">完整来源与标签信息会显示在这里。</p><div id="empty" class="empty">在视频列表中选择一个样本</div><video id="player" controls playsinline preload="none" hidden></video><dl id="facts" class="facts"></dl><div id="links" class="links"></div></section></div>
<p class="foot">文件夹总大小：${htmlEscape(formatBytes(totalBytes))}。视频大小：${htmlEscape(formatBytes(mediaBytes))}。失败记录：${failed}。详细元数据见 <a href="./manifest.json">manifest.json</a>、<a href="./manifest.csv">manifest.csv</a>；来源与使用说明见 <a href="./README.md">README.md</a>。</p>
</main><script id="dataset" type="application/json">${embeddedJson(items)}</script><script>
const items=JSON.parse(document.getElementById('dataset').textContent);
const byId=id=>document.getElementById(id),list=byId('list'),player=byId('player');
let selected='';
function populate(id,key){const values=[...new Set(items.map(item=>item[key]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=value;byId(id).append(option);}}
populate('exercise','exerciseNameZh');populate('quality','qualityName');populate('source','sourceLabel');
function time(seconds){if(seconds===null)return '时长未知';return seconds.toFixed(1)+' 秒';}
function labelRow(title,value){if(!value)return;const term=document.createElement('dt'),text=document.createElement('dd');term.textContent=title;text.textContent=value;byId('facts').append(term,text);}
function link(title,url){if(!url)return;const a=document.createElement('a');a.textContent=title;a.href=url;if(url.startsWith('http')){a.target='_blank';a.rel='noopener noreferrer';}byId('links').append(a);}
function choose(item){selected=item.id;player.pause();player.src=item.url;player.hidden=false;byId('empty').hidden=true;byId('video-title').textContent=item.exerciseNameZh;byId('video-subtitle').textContent=item.qualityName+' · '+item.sourceLabel;byId('facts').replaceChildren();byId('links').replaceChildren();labelRow('数据集',item.dataset);labelRow('受试者',item.subject);labelRow('视角',item.view);labelRow('视频信息',time(item.duration)+' · '+(item.width||'?')+' × '+(item.height||'?')+' · '+(item.outputBytes/1e6).toFixed(2)+' MB');labelRow('原始标签',item.sourceFormLabel);labelRow('作者错误标签',item.specificFault);labelRow('标签依据',item.labelProvenance);labelRow('来源备注',item.notes);labelRow('作者',item.author);labelRow('许可证',item.license);labelRow('视频处理',item.transformation);labelRow('文件路径',item.relativePath);labelRow('SHA-256',item.outputSha256);link('打开视频文件',item.url);link('原始来源',item.sourcePage);link('许可证说明',item.licenseUrl);render();}
function render(){const query=byId('search').value.trim().toLocaleLowerCase();const filtered=items.filter(item=>(!byId('exercise').value||item.exerciseNameZh===byId('exercise').value)&&(!byId('quality').value||item.qualityName===byId('quality').value)&&(!byId('source').value||item.sourceLabel===byId('source').value)&&(!query||[item.exercise,item.exerciseNameZh,item.subject,item.relativePath,item.specificFault].join(' ').toLocaleLowerCase().includes(query)));byId('result-count').textContent='显示 '+filtered.length+' / '+items.length+' 段视频';const fragment=document.createDocumentFragment();for(const item of filtered){const button=document.createElement('button');button.type='button';button.className='item';button.setAttribute('aria-pressed',String(item.id===selected));const title=document.createElement('span');title.className='item-title';const name=document.createElement('strong');name.textContent=item.exerciseNameZh;const badge=document.createElement('span');badge.className='badge '+item.qualityLabel;badge.textContent=item.qualityName;title.append(name,badge);const meta=document.createElement('span');meta.className='item-meta';meta.textContent=[item.subject,item.view,time(item.duration),item.sourceLabel].filter(Boolean).join(' · ');const file=document.createElement('span');file.className='item-meta';file.textContent=item.relativePath.split('/').pop();button.append(title,meta,file);button.addEventListener('click',()=>choose(item));fragment.append(button);}if(!filtered.length){const message=document.createElement('p');message.className='empty';message.textContent='没有匹配的视频，请调整筛选条件。';fragment.append(message);}list.replaceChildren(fragment);}
for(const id of ['search','exercise','quality','source'])byId(id).addEventListener(id==='search'?'input':'change',render);render();
</script></body></html>\n`;
}

function renderReadme(totalBytes) {
  return `# 动作视频测试集\n\n双击 [index.html](./index.html) 可离线筛选和播放视频。只会加载所选视频，无需启动服务器。\n\n## 文件与容量\n\n- 已下载视频：${items.length} 段。\n- 原有文件：${manifest.preservedFiles?.length || 0} 个，保持原样，不计入下载样本数，大小计入整个文件夹。\n- 动作 / 场景：${exercises.length} 种。\n- 视频合计：${formatBytes(mediaBytes)}。\n- 整个文件夹：${formatBytes(totalBytes)}，包含视频、清单、索引及其他现有文件。\n- 容量上限：${formatBytes(maxBytes)}；1 GB 按 1,000,000,000 字节计算。\n- 下载失败记录：${failed} 条，详见 manifest.json 的 failures。失败项目不计入以上视频数量。\n\n## 标签解释\n\n- **作者标注正确 / 错误**：沿用数据源作者的 good / bad 等标签，未经过本项目独立教练复核，不能直接当作临床或专业评判的最终标准。\n- **动作演示（未标注正误）**：演示动作身份，不推断整段动作正确。\n- **正误混合教学**：同一视频含错误和纠正示范，需要按时间片段判断，不能整段标成错误。\n- **场景测试（未标注正误）**：用于多人、遮挡、机位或剪辑等场景测试，不含动作正误结论。\n\n**MyDeadlift 的 LLK（作者的膝部位置类别）等具体标签仅按作者原意保留，不转化为适用于所有人、所有动作的统一判错规则。**\n\n这是功能与评估对照用的资料集。下载或通过媒体校验不代表 AI 识别准确，也不代表其中每个动作都已核验。\n\n### 标签分布\n\n| 标签 | 视频数 |\n| --- | ---: |\n${table(qualities)}\n\n### 动作分布\n\n| 动作 / 场景 | 视频数 |\n| --- | ---: |\n${table(exercises)}\n\n### 来源分布\n\n| 来源 | 视频数 |\n| --- | ---: |\n${table(sources)}\n\n## 来源、许可证与处理记录\n\n[manifest.json](./manifest.json) 保留每段视频的来源、原始标签、标签依据、作者、许可证、相对路径、SHA-256、媒体参数和转换说明。[manifest.csv](./manifest.csv) 提供同样信息的表格索引。\n\n各视频沿用各自来源许可证。使用或重新发布时，应保留相应作者署名、来源链接、许可证链接及转换说明；CC BY-SA 素材的改编还需遵循其相同方式共享要求。普通演示没有被改标为正确动作。\n\n| 来源 | 作者 | 许可证 | 许可证链接 |\n| --- | --- | --- | --- |\n${[...new Map(items.map(item => [[item.sourceLabel, item.author, item.license, item.licenseUrl].join('\0'), item])).values()].map(item => `| ${md(item.sourceLabel)} | ${md(item.author)} | ${md(item.license)} | ${item.licenseUrl ? `[查看](${item.licenseUrl})` : '详见来源页'} |`).join('\n')}\n\n${manifest.sourceAudit ? '## 来源核验记录\n\n完整记录保存在 manifest.json 的 sourceAudit 字段。以下是下载时保留的来源核验元数据：\n\n~~~~~~~~json\n' + JSON.stringify(manifest.sourceAudit, null, 2) + '\n~~~~~~~~\n\n' : ''}## 更新索引\n\n在项目根目录运行：\n\n\`\`\`powershell\nnode scripts/render-motion-dataset.mjs --root 测试集\n\`\`\`\n\n索引生成器会核对清单视频是否存在，并将索引和 CSV 也计入整个文件夹的容量限制；不会下载视频或改写视频。\n`;
}

const columns = [
  ['id', 'ID'], ['exerciseNameZh', '动作'], ['exercise', '动作原名'], ['qualityName', '标签'], ['qualityLabel', '标签代码'],
  ['subject', '受试者'], ['view', '视角'], ['specificFault', '作者错误标签'], ['relativePath', '视频路径'],
  ['sourceLabel', '来源'], ['sourceFormLabel', '作者原始标签'], ['sourceGroup', '来源分组'], ['dataset', '数据集'], ['sourcePage', '来源链接'], ['sourceUrl', '原始视频链接'], ['author', '作者'], ['license', '许可证'], ['licenseUrl', '许可证链接'],
  ['labelProvenance', '标签依据'], ['notes', '来源备注'], ['sourceBytes', '原始文件字节'], ['sourceSha256', '原始SHA256'],
  ['outputBytes', '视频字节'], ['outputSha256', '视频SHA256'], ['duration', '时长秒'], ['width', '宽'], ['height', '高'], ['transformation', '视频处理'],
];
const csvCell = value => {
  const text = String(value ?? '');
  return '"' + (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
};
const csv = '\uFEFF' + [columns.map(([, title]) => csvCell(title)).join(','), ...items.map(item => columns.map(([key]) => csvCell(item[key])).join(','))].join('\r\n') + '\r\n';
const baseBytes = currentBytes - generatedFiles.reduce((sum, name) => sum + (fileSizes.get(name) || 0), 0);
let totalBytes = baseBytes, outputs;
for (let iteration = 0; iteration < 30; iteration++) {
  outputs = new Map([['index.html', renderHtml(totalBytes)], ['README.md', renderReadme(totalBytes)], ['manifest.csv', csv]]);
  const next = baseBytes + [...outputs.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0);
  if (next === totalBytes) break;
  totalBytes = next;
  if (iteration === 29) throw new Error('无法计算包含索引文件的稳定总大小。');
}
if (totalBytes > maxBytes) throw new Error(`生成索引后将超过容量上限：${totalBytes} > ${maxBytes} 字节。`);
// Shrinking outputs first keeps the peak below the same hard folder budget.
let bytesOnDisk = currentBytes;
const ordered = [...outputs].sort(([a, av], [b, bv]) => (Buffer.byteLength(av) - (fileSizes.get(a) || 0)) - (Buffer.byteLength(bv) - (fileSizes.get(b) || 0)));
for (const [name, content] of ordered) {
  const nextBytes = bytesOnDisk - (fileSizes.get(name) || 0) + Buffer.byteLength(content);
  if (Math.max(bytesOnDisk, nextBytes) > maxBytes) throw new Error(`写入 ${name} 时会超过容量上限。`);
  await writeFile(resolve(root, name), content);
  bytesOnDisk = nextBytes;
}
console.log(JSON.stringify({ root, videos: items.length, exercises: exercises.length, failures: failed, videoBytes: mediaBytes, totalBytes: bytesOnDisk, maxTotalBytes: maxBytes, files: generatedFiles }, null, 2));
