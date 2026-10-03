export const MOTION_TRANSCODE_MAX_BYTES = 200 * 1024 * 1024;
export const MOTION_TRANSCODE_MAX_DURATION = 120;
const CONVERSION_TIMEOUT_MS = 10 * 60 * 1000;
const abortError = () => new DOMException('已取消视频转换。', 'AbortError');

// The original File stays on this device. A disposable worker owns the decoder
// and its memory; terminating it also stops synchronous WebAssembly immediately.
export function convertMotionVideo(file, { signal, onProgress } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return Promise.reject(new Error('请选择一个有效的视频文件。'));
  if (file.size > MOTION_TRANSCODE_MAX_BYTES) return Promise.reject(new Error('视频不能超过 200 MB。'));
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      worker?.terminate();
      error ? reject(error) : resolve(result);
    };
    const cancel = () => finish(abortError());
    try {
      worker = new Worker(new URL('./motion-transcode-worker.js?v=2', import.meta.url));
      worker.onmessage = ({ data }) => {
        if (settled) return;
        try {
          if (data?.type === 'progress') {
            onProgress?.({ stage: 'converting', progress: data.progress, message: data.message });
          } else if (data?.type === 'done') {
            const name = `${String(file.name || 'video').replace(/\.[^.]+$/, '')}.compatible.mp4`;
            finish(null, new File([data.bytes], name, { type: 'video/mp4', lastModified: file.lastModified || Date.now() }));
          } else if (data?.type === 'error') {
            finish(new Error(data.message || '视频转换失败，请尝试较短的视频。'));
          }
        } catch (error) { finish(error); }
      };
      worker.onerror = event => {
        event.preventDefault();
        finish(new Error('本地视频转换组件未能运行，请刷新页面后重试。'));
      };
      worker.onmessageerror = () => finish(new Error('读取本地视频转换结果失败，请重试。'));
      timer = setTimeout(() => finish(new Error('本地视频转换超时，请使用较短或较低分辨率的视频。')), CONVERSION_TIMEOUT_MS);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) return cancel();
      onProgress?.({ stage: 'converting', progress: 0, message: '正在准备本地视频兼容转换…' });
      if (!settled) worker.postMessage({ file });
    } catch (error) { finish(error); }
  });
}
