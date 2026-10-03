// Classic worker is required by the pinned single-thread FFmpeg loader.
let started = false;
self.onmessage = async ({ data }) => {
  if (started) return;
  started = true;
  let source;
  try {
    const { prepareMotionSource, readPreparedMotionFrames } = await import('./motion-software-decode.js');
    const onProgress = value => self.postMessage({ type: 'progress', ...value });
    source = await prepareMotionSource(data.file, { onProgress });
    const frames = readPreparedMotionFrames(source, data.type === 'inspect' ? [0] : data.times, { maxDimension: data.maxDimension || 1280, onProgress, poster: data.type === 'inspect' });
    self.postMessage({ type: 'done', metadata: source.metadata, frames }, [...new Set(frames.map(frame => frame.bytes.buffer))]);
  } catch (error) {
    const message = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '本地视频解码失败，请刷新页面后重试。';
    self.postMessage({ type: 'error', message });
  } finally { source?.close(); self.close(); }
};
