const aborted = () => new DOMException('已取消视频解码。', 'AbortError');

function requestSource(file, type, { signal, onProgress = () => {}, times, maxDimension = 1280, sampleFps = 15 } = {}) {
  if (signal?.aborted) return Promise.reject(aborted());
  if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > 200 * 1024 * 1024) return Promise.reject(new Error('请选择 200 MB 以内的视频。'));
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker?.terminate(); callback(value); };
    const cancel = () => finish(reject, aborted());
    try {
      worker = new Worker(new URL('./motion-source-worker.js?v=1', import.meta.url));
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'progress') {
          try { onProgress({ stage: 'decoding', progress: data.progress, message: data.message }); }
          catch (error) { finish(reject, error); }
        } else if (data.type === 'done') finish(resolve, data);
        else if (data.type === 'error') finish(reject, new Error(data.message || '视频解码失败。'));
      };
      worker.onerror = event => { event.preventDefault(); finish(reject, new Error('本地视频解码组件无法运行，请刷新页面后重试。')); };
      worker.onmessageerror = () => finish(reject, new Error('视频解码结果无法读取。'));
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => finish(reject, new Error('视频解码超时，请使用较短的视频后重试。')), 10 * 60 * 1000);
      if (signal?.aborted) { cancel(); return; }
      onProgress({ stage: 'decoding', progress: 0, message: '正在直接读取视频画面…' });
      if (!settled) worker.postMessage({ type, file, times, maxDimension, sampleFps });
    } catch (error) { finish(reject, error); }
  });
}

export async function inspectMotionSource(file, options = {}) {
  const result = await requestSource(file, 'inspect', options);
  if (!result.frames?.[0]?.bytes?.length) throw new Error('视频中没有可读取的画面。');
  return { metadata: result.metadata, poster: new Blob([result.frames[0].bytes], { type: 'image/jpeg' }) };
}

export async function readMotionSourceFrames(file, times, options = {}) {
  const result = await requestSource(file, 'frames', { ...options, times });
  return result.frames.map(({ bytes, ...frame }) => ({ ...frame, blob: new Blob([bytes], { type: 'image/jpeg' }) }));
}
