import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from '../server.mjs';
const root=resolve(import.meta.dirname,'..');await mkdir(join(root,'.qa'),{recursive:true});
const dataDir=await mkdtemp(join(root,'.qa','chat-rendering-'));
const {chromium}=await import(pathToFileURL(process.env.QA_PLAYWRIGHT||join(root,'.qa/browser-tests/node_modules/playwright/index.mjs')));
const server=await startServer({host:'127.0.0.1',port:0,dataDir});
const browser=await chromium.launch({executablePath:process.env.QA_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async()=>{
  const {renderMarkdown,renderMarkdownInto}=await import('/chat-markdown.js');const {patchHTML}=await import('/chat-view.js');
  const host=document.createElement('div');host.style.width='720px';document.body.append(host);
  const cases=['# 标题\n\n段落\n\n| A | B |\n|---|---|\n|1|2|\n','前段\n\n标题\n---\n\n- a\n  - b\n\n```js\nconst x = 1;\n```\n','链接 [引用][id]\n\n[id]: https://example.com "标题"\n','- [x] 已完成\n\n> 引用\n> **粗体**\n\n![图片](https://example.com/a.png)\n','<script>alert(1)</script>\n\n[链接](javascript:alert(1))\n','段落\n\n<div onclick="alert(1)">原始 HTML</div>\n'];
  for(const source of cases)for(let n=1;n<=source.length;n++){
    const part=source.slice(0,n);renderMarkdownInto(host,part);
    const actual=[...host.children].map(node=>node.innerHTML).join('');
    if(actual!==renderMarkdown(part))throw new Error('Markdown mismatch at '+JSON.stringify(part)+'\n'+actual+'\n'+renderMarkdown(part));
  }
  renderMarkdownInto(host,'稳定段落\n\n下一段');const stable=host.firstElementChild.firstChild;
  renderMarkdownInto(host,'稳定段落\n\n下一段继续');if(host.firstElementChild.firstChild!==stable)throw new Error('Stable block was replaced');
  host.innerHTML=renderMarkdown('重新挂载');renderMarkdownInto(host,'重新挂载后继续');if(host.textContent.trim()!=='重新挂载后继续')throw new Error('External DOM patch was not recovered');
  const sample='# 训练建议\n\n先热身，然后根据当前计划完成训练。\n\n| 动作 | 组数 | 次数 |\n| --- | --- | --- |\n| 深蹲 | 3 | 8–12 |\n| 划船 | 3 | 8–12 |\n\n- 保持动作稳定\n- 记录训练感受\n\n';
  const metrics=[];
  for(const length of [2000,8000,30000]){
    const text=sample.repeat(Math.ceil(length/sample.length)).slice(0,length),row={characters:length};
    for(const mode of ['full','incremental']){
      const times=[];
      for(let i=0;i<16;i++){const start=performance.now(),source=text+'\n'+i;if(mode==='full')patchHTML(host,renderMarkdown(source));else renderMarkdownInto(host,source);void host.offsetHeight;if(i)times.push(performance.now()-start);}
      times.sort((a,b)=>a-b);row[mode+'MedianMs']=times[7];
    }
    metrics.push(row);
  }
  return {cases:cases.length,metrics};
 });
 assert.equal(result.cases,6);await writeFile(join(dataDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,dataDir,...result}));
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
