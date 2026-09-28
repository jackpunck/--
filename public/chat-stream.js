// SSE is a byte stream: neither UTF-8 characters nor events align with reads.
export async function consumeChatEvents(body, onEvent, signal) {
  if (!body) throw new Error('服务没有返回可读取的流式内容。');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', eventName = 'message', data = [], result, done = false;
  const dispatch = async () => {
    if (!data.length) { eventName = 'message'; return; }
    let payload;
    try { payload = JSON.parse(data.join('\n')); }
    catch { throw new Error('AI 返回了无效的流式数据，请重试。'); }
    const type = eventName; eventName = 'message'; data = [];
    if (type === 'error') throw new Error(payload.error || 'AI 请求失败，请重试。');
    await onEvent?.(type, payload);
    if (type === 'done') { result = payload; done = true; }
  };
  const line = async value => {
    if (value === '') { await dispatch(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'event') eventName = content;
    if (field === 'data') data.push(content);
  };
  const drain = async final => {
    let index;
    while ((index = buffer.search(/[\r\n]/)) >= 0) {
      // Hold a trailing CR until we know whether it is part of CRLF.
      if (!final && buffer[index] === '\r' && index === buffer.length - 1) break;
      const value = buffer.slice(0, index);
      const count = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(index + count); await line(value);
      if (done) return;
    }
    if (buffer.length > 4 * 1024 * 1024) throw new Error('AI 返回的单条流式数据过大。');
    if (final && !done) { if (buffer) await line(buffer); buffer = ''; await dispatch(); }
  };
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abort, {once:true});
  try {
    while (!done) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(chunk.value || new Uint8Array(), {stream:!chunk.done});
      await drain(chunk.done);
      if (chunk.done) break;
    }
    if (!done) throw new Error('连接中断，已保留收到的内容。可以重试继续获取回答。');
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
