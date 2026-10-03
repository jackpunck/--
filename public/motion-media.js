// A shared, local playable copy keeps preview, pose sampling and AI stills on
// the same timeline. Cache only successful preparations; Files are immutable.
export const MOTION_VIDEO_LIMITS = Object.freeze({ maxBytes: 200 * 1024 * 1024, maxDuration: 120, sampleFps: 15, maxDimension: 960 });
export const MOTION_VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/3gpp,video/3gpp2,video/mpeg,video/mp2t,video/ogg,video/x-ms-wmv,video/x-flv,video/vnd.dlna.mpeg-tts,.mp4,.m4v,.mov,.webm,.mkv,.avi,.3gp,.3g2,.mpg,.mpeg,.ts,.m2ts,.mts,.ogv,.wmv,.flv';
const preparedVideos = new WeakMap();
const aborted = () => new DOMException('已取消视频准备。', 'AbortError');
const checkAbort = signal => { if (signal?.aborted) throw aborted(); };

export function validateVideoFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error('请选择一个有效的视频文件。');
  if (file.size > MOTION_VIDEO_LIMITS.maxBytes) throw new Error('视频不能超过 200 MB。');
  if (file.type && !/^video\//i.test(file.type) && !/^application\/(octet-stream|mp4|ogg)$/i.test(file.type)) throw new Error('请选择视频文件，图片、音频或文档不能进行动作分析。');
  if (!/\.(mp4|m4v|mov|webm|mkv|avi|3gp|3g2|mpg|mpeg|ts|m2ts|mts|ogv|wmv|flv)$/i.test(file.name || '') &&
      !/^video\/(mp4|x-m4v|webm|quicktime|x-matroska|x-msvideo|avi|3gpp|3gpp2|mpeg|mp2t|ogg|x-ms-wmv|x-flv|vnd\.dlna\.mpeg-tts)$/i.test(file.type || '')) {
    throw new Error('请选择 MP4、MOV、WebM、MKV、AVI、3GP 等视频文件。');
  }
}

export function validateVideoMetadata({ duration, width, height }) {
  if (Number.isFinite(duration) && duration > MOTION_VIDEO_LIMITS.maxDuration) {
    const error = new Error('请将视频裁剪到 120 秒以内再分析。'); error.code = 'MOTION_VIDEO_LIMIT'; throw error;
  }
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    const error = new Error('无法读取视频时长或画面。'); error.code = 'MOTION_VIDEO_DECODE'; throw error;
  }
}

async function readPlayableMetadata(file, signal) {
  checkAbort(signal);
  const video = document.createElement('video'), url = URL.createObjectURL(file);
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  try {
    return await new Promise((resolve, reject) => {
      let timer, settled = false;
      const finish = (callback, value) => {
        if (settled) return; settled = true;
        clearTimeout(timer); video.removeEventListener('loadedmetadata', inspect); video.removeEventListener('loadeddata', inspect);
        video.removeEventListener('error', failed); signal?.removeEventListener('abort', cancel); callback(value);
      };
      const failed = () => {
        const error = new Error('浏览器不能直接读取这个视频画面。'); error.code = 'MOTION_VIDEO_DECODE';
        error.duration = Number.isFinite(video.duration) ? video.duration : null;
        finish(reject, error);
      };
      const inspect = () => {
        const metadata = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
        // An unsupported HEVC track can still fire loadeddata for its AAC
        // audio. A successful media event alone is not a decodable picture.
        try { validateVideoMetadata(metadata); }
        catch (error) { error.duration = Number.isFinite(video.duration) ? video.duration : null; finish(reject, error); return; }
        if (video.readyState >= 2) finish(resolve, metadata);
      };
      const cancel = () => finish(reject, aborted());
      video.addEventListener('loadedmetadata', inspect); video.addEventListener('loadeddata', inspect);
      video.addEventListener('error', failed); signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(failed, 12000);
      try { checkAbort(signal); video.src = url; video.load(); } catch (error) { finish(reject, error); }
    });
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

export async function prepareMotionVideo(file, { signal, onProgress = () => {} } = {}) {
  validateVideoFile(file); checkAbort(signal);
  const cached = preparedVideos.get(file);
  if (cached) return cached;
  let metadata, compatible = file, converted = false;
  try { metadata = await readPlayableMetadata(file, signal); }
  catch (error) {
    checkAbort(signal);
    if (error.code !== 'MOTION_VIDEO_DECODE') throw error;
    const { convertMotionVideo } = await import('./motion-transcode.js');
    checkAbort(signal);
    compatible = await convertMotionVideo(file, { signal, onProgress });
    metadata = await readPlayableMetadata(compatible, signal);
    // Unsupported video can expose only its audio track's duration here. The
    // conversion worker checks the actual video timeline before returning.
    converted = true;
  }
  checkAbort(signal);
  const result = { file: compatible, originalFile: file, metadata, converted };
  preparedVideos.set(file, result);
  if (compatible !== file) preparedVideos.set(compatible, result);
  return result;
}

export function releasePreparedMotionVideo(file) {
  if (!file) return;
  const prepared = preparedVideos.get(file);
  if (prepared) { preparedVideos.delete(prepared.originalFile); preparedVideos.delete(prepared.file); }
  preparedVideos.delete(file);
}
