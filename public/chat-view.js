// Keep existing text and scroll containers alive while streamed Markdown grows.
function sameNode(left, right) {
  return left.nodeType === right.nodeType && left.nodeName === right.nodeName;
}

function patchNode(current, next) {
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.data === next.data) return;
    let prefix = 0, suffix = 0;
    while (prefix < current.length && prefix < next.length && current.data[prefix] === next.data[prefix]) prefix++;
    while (suffix < current.length - prefix && suffix < next.length - prefix && current.data[current.length - 1 - suffix] === next.data[next.length - 1 - suffix]) suffix++;
    current.replaceData(prefix, current.length - prefix - suffix, next.data.slice(prefix, next.length - suffix));
    return;
  }
  if (current.nodeType !== Node.ELEMENT_NODE) return;
  for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  for (const attribute of next.attributes) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  patchChildren(current, next);
}

function patchChildren(current, next) {
  const children = [...next.childNodes];
  for (let index = 0; index < children.length; index++) {
    const child = current.childNodes[index], incoming = children[index];
    if (!child) current.append(incoming.cloneNode(true));
    else if (sameNode(child, incoming)) patchNode(child, incoming);
    else child.replaceWith(incoming.cloneNode(true));
  }
  while (current.childNodes.length > children.length) current.lastChild.remove();
}

export function patchHTML(element, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(element, template.content);
}

export async function copyMessageText(text, html) {
  if (navigator.clipboard?.write && globalThis.ClipboardItem && html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('button,input').forEach(node => node.remove());
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], {type:'text/plain'}),
        'text/html': new Blob([template.innerHTML], {type:'text/html'})
      })]);
      return;
    } catch {}
  }
  if (!navigator.clipboard?.writeText) throw new Error('当前浏览器无法直接复制，请选中文字后按 Ctrl + C。');
  await navigator.clipboard.writeText(text);
}

export async function copyImage(url) {
  if (!navigator.clipboard?.write || !globalThis.ClipboardItem) throw new Error('当前浏览器不支持复制图片，请打开预览后保存图片。');
  const png = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        canvas.getContext('2d').drawImage(image,0,0);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('这张图片暂时无法复制，请保存后添加。')),'image/png');
      } catch {reject(new Error('这张图片暂时无法复制，请保存后添加。'));}
    };
    image.onerror = () => reject(new Error('图片加载失败，请稍后重试。'));
    image.src = url;
  });
  // A promise-backed item keeps the clipboard write inside the click gesture.
  await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
}
