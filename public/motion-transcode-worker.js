// Classic worker: the pinned single-thread core does not need cross-origin
// isolation. All dependencies and file operations remain local to this origin.
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_DURATION = 120;
const progress = (value, message) => self.postMessage({ type: 'progress', progress: value, message });

function probe(core, path, output, options = ['-show_streams', '-show_format']) {
  core.setTimeout(30000);
  // Core 0.12.10's wrapper discards _ffprobe's normal C return value and leaves
  // ret at -1. Capture that value; fatal exits still use the wrapper's ret.
  const nativeProbe = core._ffprobe;
  let nativeCode, wrapperCode;
  core._ffprobe = (...args) => { nativeCode = nativeProbe(...args); return nativeCode; };
  try { wrapperCode = core.ffprobe('-v', 'error', ...options, '-of', 'json', path, '-o', output); }
  finally { core._ffprobe = nativeProbe; core.reset(); }
  const code = wrapperCode === -1 && Number.isInteger(nativeCode) ? nativeCode : wrapperCode;
  if (code !== 0) {
    throw new Error('无法读取这个视频的媒体信息，文件可能不完整或使用了暂不支持的编码。');
  }
  const result = JSON.parse(core.FS.readFile(output, { encoding: 'utf8' }));
  core.FS.unlink(output);
  return result;
}

function videoInfo(metadata) {
  const stream = metadata.streams?.find(item => item.codec_type === 'video' && !item.disposition?.attached_pic);
  if (!stream || !(stream.width > 0 && stream.height > 0)) throw new Error('这个文件中没有可分析的视频画面。');
  const duration = [stream.duration, metadata.format?.duration].map(Number).find(value => Number.isFinite(value) && value > 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法确定视频的完整时长，请换一个视频文件。');
  return { stream, duration };
}

function sourceDuration(core, metadata, stream, estimated) {
  // MPEG program/transport streams often expose a bitrate-based estimate (for
  // example 1.62 s for 50 frames at 25 fps). Read packet timestamps without
  // decoding frames to preserve and verify their actual presentation timeline.
  if (!/^(mpeg|mpegts)$/.test(metadata.format?.format_name || '')) return estimated;
  const data = probe(core, '/input/source', '/packets.json', ['-select_streams', String(stream.index), '-show_packets', '-show_entries', 'packet=pts_time,duration_time,flags']);
  const rate = String(stream.avg_frame_rate || stream.r_frame_rate || '').split('/').map(Number);
  const frameDuration = rate[0] > 0 && rate[1] > 0 ? rate[1] / rate[0] : 0;
  let first = Infinity, last = -Infinity, count = 0;
  for (const packet of data.packets || []) {
    if (String(packet.flags || '').includes('D')) continue;
    const time = Number(packet.pts_time), length = Number(packet.duration_time);
    if (!Number.isFinite(time)) continue;
    first = Math.min(first, time);
    last = Math.max(last, time + (length > 0 ? length : frameDuration));
    count++;
  }
  return count && Number.isFinite(last - first) && last > first ? last - first : estimated;
}

function videoFilters(stream) {
  // Apply rotation before these filters (FFmpeg autorotate is enabled). Convert
  // sample aspect ratio to square pixels while preserving the displayed shape.
  const scale = "scale=w='max(2,trunc(iw*sar*min(1,min(1280/(iw*sar),1280/ih))/2)*2)':h='max(2,trunc(ih*min(1,min(1280/(iw*sar),1280/ih))/2)*2)'";
  const frameRate = value => {
    const [numerator, denominator = 1] = String(value || '').split('/').map(Number);
    return numerator > 0 && denominator > 0 ? numerator / denominator : 0;
  };
  const fps = frameRate(stream.avg_frame_rate) || frameRate(stream.r_frame_rate);
  // Drop redundant high-frame-rate pictures before expensive HDR tone mapping.
  // Lower/unknown rates keep their native timestamps through the filter chain.
  const filters = fps > 30 ? ['fps=30', scale, 'setsar=1'] : [scale, 'setsar=1'];
  const hdr = ['smpte2084', 'arib-std-b67'].includes(stream.color_transfer);
  if (hdr) {
    // Phone HDR10/HLG (including Dolby Vision profiles with an HDR base layer):
    // linear light -> tone map -> BT.709 SDR, so 10-bit input is not washed out.
    filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=limited');
  }
  filters.push('format=yuv420p');
  return { filter: filters.join(','), hdr };
}

let started = false;
self.onmessage = async ({ data: { file } }) => {
  if (started) return;
  started = true;
  let core, mounted = false;
  const recentLogs = [];
  try {
    if (!file || !(file.size > 0) || file.size > MAX_BYTES) throw new Error('请选择 200 MB 以内的视频。');
    progress(0, '正在加载本地视频兼容组件…');
    const coreURL = new URL('./vendor/ffmpeg/ffmpeg-core.js', self.location.href).href;
    const wasmURL = new URL('./vendor/ffmpeg/ffmpeg-core.wasm', self.location.href).href;
    importScripts(coreURL);
    core = await self.createFFmpegCore({ mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}` });
    core.setLogger(({ message }) => { recentLogs.push(message); if (recentLogs.length > 12) recentLogs.shift(); });
    core.FS.mkdir('/input');
    // WORKERFS reads slices of the File on demand instead of copying a 200 MB
    // upload into the WebAssembly filesystem. The fixed name ignores user paths.
    core.FS.mount(core.FS.filesystems.WORKERFS, { blobs: [{ name: 'source', data: file }] }, '/input');
    mounted = true;
    progress(0.01, '正在读取视频格式和完整时长…');
    const metadata = probe(core, '/input/source', '/source.json');
    const { stream, duration: estimatedDuration } = videoInfo(metadata);
    const duration = sourceDuration(core, metadata, stream, estimatedDuration);
    if (duration > MAX_DURATION) throw new Error('请将视频裁剪到 120 秒以内再分析。');
    const { filter, hdr } = videoFilters(stream);
    const description = hdr ? '正在本地转换视频并适配 HDR 色彩…' : '正在本地转换为兼容的视频格式…';
    progress(0.02, description);
    let lastProgress = -1;
    core.setProgress(({ time }) => {
      const value = Math.min(0.98, Math.max(0.02, Number(time) / (duration * 1e6)));
      if (value - lastProgress >= 0.005) { lastProgress = value; progress(value, description); }
    });
    core.setTimeout(9 * 60 * 1000);
    // fpsmax retains lower/native frame rates and only caps videos above 30 fps.
    // No -t/-ss/-fs is used: the source timeline is never silently shortened.
    const args = ['-hide_banner', '-xerror', '-i', '/input/source', '-map', `0:${stream.index}`, '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filter,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21', '-maxrate', '6M', '-bufsize', '12M', '-pix_fmt', 'yuv420p', '-fpsmax', '30', '-threads', '1', '-movflags', '+faststart'];
    if (hdr) args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv');
    args.push('/compatible.mp4');
    const code = core.exec(...args);
    core.reset();
    if (code !== 0) {
      if (recentLogs.some(line => /out of memory|memory access|Cannot enlarge memory|allocation failed/i.test(line))) throw new Error('这个视频需要更多内存，请使用较短或较低分辨率的视频。');
      throw new Error('本地视频转换未完成，请尝试较短的视频或其他编码格式。');
    }
    progress(0.99, '正在准备兼容视频…');
    const converted = videoInfo(probe(core, '/compatible.mp4', '/converted.json'));
    if (converted.duration > MAX_DURATION) throw new Error('请将视频裁剪到 120 秒以内再分析。');
    if (duration - converted.duration > 0.15) throw new Error('视频转换后的时长短于原片，请换一个视频文件。');
    if (converted.stream.codec_name !== 'h264' || Math.max(converted.stream.width, converted.stream.height) > 1280) throw new Error('视频转换结果不符合分析要求，请重试。');
    if (core.FS.stat('/compatible.mp4').size > MAX_BYTES) throw new Error('转换后的视频超过 200 MB，请使用较短的视频。');
    const bytes = core.FS.readFile('/compatible.mp4');
    core.FS.unlink('/compatible.mp4');
    core.FS.unmount('/input'); mounted = false;
    self.postMessage({ type: 'done', bytes }, [bytes.buffer]);
  } catch (error) {
    const message = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '本地视频兼容转换失败，请刷新页面后重试。';
    self.postMessage({ type: 'error', message });
  } finally {
    if (mounted) { try { core.FS.unmount('/input'); } catch {} }
    self.close();
  }
};
