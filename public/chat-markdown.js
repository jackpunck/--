import {Marked} from './vendor/marked.esm.js?v=9';
import DOMPurify from './vendor/purify.es.js?v=9';
import {patchHTML} from './chat-view.js?v=10';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const markdown = new Marked({gfm:true, breaks:true, renderer:{
  // Model output is Markdown, never executable HTML. Escape raw HTML even
  // before sanitizing so malicious markup remains visible as quoted text.
  html({text}) { return escape(text); },
  // Do not make remote image requests from AI-generated URLs.
  image({text}) { return `<span class="markdown-image-note">[图片：${escape(text || '未加载外部图片')}]</span>`; },
  code({text, lang}) {
    const language = (lang || '').split(/\s/)[0];
    return `<div class="code-block"><div class="code-header"><span>${escape(language || '代码')}</span><button type="button" data-action="copy-code" aria-label="复制代码">复制代码</button></div><pre><code>${escape(text)}</code></pre></div>`;
  }
}});

const allowedTags = ['p','br','strong','em','del','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','hr','pre','code','a','table','thead','tbody','tr','th','td','div','span','button','input'];
const allowedAttributes = ['href','title','class','type','disabled','checked','start','align','data-action','aria-label'];

export function renderMarkdown(source) {
  const parsed = markdown.parse(String(source ?? ''));
  return sanitizeMarkdown(parsed);
}

function sanitizeMarkdown(parsed) {
  const fragment = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS:allowedTags, ALLOWED_ATTR:allowedAttributes,
    ALLOW_DATA_ATTR:false, RETURN_DOM_FRAGMENT:true,
    FORBID_TAGS:['style','script','iframe','svg','math','img','video','audio','form'],
    FORBID_ATTR:['style','id','name']
  });
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    const relative = /^\/(?!\/)/.test(href) && !/[\\\u0000-\u0020]/.test(href);
    if (!/^(https?:\/\/|mailto:)/i.test(href) && !relative) link.removeAttribute('href');
    else { link.setAttribute('target','_blank'); link.setAttribute('rel','noopener noreferrer'); link.setAttribute('referrerpolicy','no-referrer'); }
  }
  for (const input of fragment.querySelectorAll('input')) { input.type='checkbox'; input.disabled=true; }
  for (const table of fragment.querySelectorAll('table')) {
    const wrap=document.createElement('div'); wrap.className='markdown-table'; table.replaceWith(wrap); wrap.append(table);
  }
  const holder=document.createElement('div'); holder.append(fragment); return holder.innerHTML;
}

const renderedBlocks=new WeakMap();
// Lex the complete source so late reference definitions, unfinished fences,
// setext headings and tables retain exactly the same Markdown semantics.
// Only changed top-level blocks are parsed, sanitized and patched into the DOM.
export function renderMarkdownInto(element,source) {
  source=String(source??'');
  let previous=renderedBlocks.get(element);
  if(previous&&(element.childElementCount!==previous.blocks.length||previous.blocks.some(block=>block.node.parentNode!==element)))previous=null;
  if(previous?.source===source)return;
  const tokens=markdown.lexer(source),links=JSON.stringify(tokens.links),blocks=[];
  if(!previous)element.replaceChildren();
  let index=0;
  for(const token of tokens){
    if(token.type==='space')continue;
    const old=previous?.blocks[index];
    const node=old?.node||document.createElement('div');
    if(!old){node.className='markdown-block';element.append(node);}
    if(!old||old.raw!==token.raw||previous.links!==links){
      const list=[token];list.links=tokens.links;
      patchHTML(node,sanitizeMarkdown(markdown.parser(list)));
    }
    blocks.push({raw:token.raw,node});index++;
  }
  for(const old of previous?.blocks.slice(index)||[])old.node.remove();
  renderedBlocks.set(element,{source,links,blocks});
}
