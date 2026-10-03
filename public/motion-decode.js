// Runs only inside the pose worker. MP4Box parses samples; WebCodecs decodes
// sequentially. Output is consumed synchronously, so VideoFrames never queue up.
import { createFile, DataStream, Endianness } from './vendor/mp4box/mp4box.all.mjs';

export function selectSampleTargets(samples, { duration, fps, offset = 0 }) {
  const ordered = samples.map(sample => ({ timestamp: Math.round((sample.cts - offset) * 1e6 / sample.timescale) })).sort((a, b) => a.timestamp - b.timestamp);
  if (!ordered.length) throw new Error('MP4 没有可解码的视频帧。');
  const targets = new Map();
  let sampleIndex = 0;
  for (let index = 0; index < Math.ceil(duration * fps); index++) {
    const time = index / fps, timestamp = Math.round(time * 1e6);
    while (sampleIndex + 1 < ordered.length && ordered[sampleIndex + 1].timestamp <= timestamp + 1) sampleIndex++;
    const key = ordered[sampleIndex].timestamp;
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push({ index, time });
  }
  return targets;
}

export function sourceFrameRate(samples, { duration, offset = 0 }) {
  if (!(duration > 0) || !Number.isFinite(duration)) return null;
  const count = new Set(samples.map(sample => Math.round((sample.cts - offset) * 1e6 / sample.timescale)).filter(timestamp => Number.isFinite(timestamp) && timestamp >= 0 && timestamp < duration * 1e6)).size;
  return count > 0 ? count / duration : null;
}

export async function prepareMp4(file, { width, height, duration, sampleFps, maxDimension }) {
  if (!/\.(mp4|m4v|mov)$/i.test(file.name)) return null;
  let mp4 = createFile();
  const samples = [];
  try {
  let info, parseError;
  mp4.onError = error => { parseError = new Error(String(error)); };
  // Register extraction while onReady is firing. Appending the complete file
  // before setting these callbacks lets MP4Box release its mdat buffers.
  mp4.onSamples = (_id, _user, chunk) => samples.push(...chunk);
  mp4.onReady = value => {
    info = value;
    if (value.videoTracks.length === 1) {
      mp4.setExtractionOptions(value.videoTracks[0].id, null, { nbSamples: 100 });
      mp4.start();
    }
  };
  // Read bounded chunks instead of retaining another whole-file ArrayBuffer.
  for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
    const buffer = await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer();
    buffer.fileStart = offset; mp4.appendBuffer(buffer);
    if (parseError) return null;
  }
  mp4.flush();
  if (parseError || !info || info.videoTracks.length !== 1) return null;
  const track = info.videoTracks[0], trak = mp4.getTrackById(track.id);
  const edits = trak.edts?.elst?.entries || [];
  const simpleTimeline = edits.length <= 1 && !edits.some(edit => edit.media_time < 0 || edit.media_rate_integer !== 1 || edit.media_rate_fraction !== 0);
  const offset = simpleTimeline ? edits[0]?.media_time || 0 : 0;
  const sourceFps = simpleTimeline ? sourceFrameRate(samples, { duration, offset }) : null;
  const unsupported = () => ({ sourceFps });
  // Metadata remains useful even when the optimized decoder is unavailable.
  if (typeof VideoDecoder === 'undefined') return unsupported();
  // Let HTMLVideo handle rotation, complex timelines and changing codecs.
  const matrix = trak.tkhd?.matrix;
  if (matrix && (matrix[0] !== 65536 || matrix[1] !== 0 || matrix[3] !== 0 || matrix[4] !== 65536)) return unsupported();
  if (!simpleTimeline) return unsupported();
  const entries = trak.mdia.minf.stbl.stsd.entries;
  if (entries.length !== 1) return unsupported();
  const box = entries[0].avcC || entries[0].hvcC || entries[0].vpcC || entries[0].av1C;
  if (!box) return unsupported();
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  const config = {
    codec: track.codec.startsWith('vp08') ? 'vp8' : track.codec,
    codedWidth: track.video.width, codedHeight: track.video.height,
    description: new Uint8Array(stream.buffer, 8),
  };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) return unsupported();
  if (parseError || !samples.length || samples.some(sample => sample.description_index !== samples[0].description_index)) return unsupported();
  const targets = selectSampleTargets(samples, { duration, fps: sampleFps, offset });
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const context = canvas.getContext('2d');
  if (!context) return unsupported();
  return {
    codec: config.codec,
    sourceFps,
    async run(onFrame) {
      let failure, completed = 0, decoder, processingMs = 0;
      const waiters = new Set(), wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
      const started = performance.now();
      decoder = new VideoDecoder({
        output(frame) {
          let closed = false;
          try {
            if (failure) return;
            const timestamp = frame.timestamp;
            const selected = targets.get(timestamp);
            if (!selected) return;
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
            frame.close(); closed = true;
            const processingStarted = performance.now();
            for (const target of selected) { onFrame(canvas, { ...target, sourceTime: timestamp / 1e6 }); completed++; }
            processingMs += performance.now() - processingStarted;
            targets.delete(timestamp);
          } catch (error) { failure = error; wake(); }
          finally { if (!closed) frame.close(); }
        },
        error(error) { failure = error; wake(); },
      });
      decoder.ondequeue = wake;
      try {
        decoder.configure(config);
        for (let index = 0; index < samples.length; index++) {
          while (!failure && decoder.decodeQueueSize >= 2) await new Promise(resolve => waiters.add(resolve));
          if (failure) throw failure;
          const sample = samples[index];
          decoder.decode(new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: Math.round((sample.cts - offset) * 1e6 / sample.timescale),
            duration: Math.round(sample.duration * 1e6 / sample.timescale), data: sample.data,
          }));
          // EncodedVideoChunk copies its bytes; release each compressed sample
          // immediately after submitting it, without retaining the parser.
          sample.data = undefined;
        }
        await decoder.flush();
        if (failure) throw failure;
        if (targets.size || completed !== Math.ceil(duration * sampleFps)) throw new Error('顺序解码未覆盖所有采样点。');
        return { decodeMs: Math.max(0, performance.now() - started - processingMs), codec: config.codec };
      } finally { if (decoder.state !== 'closed') decoder.close(); samples.length = 0; }
    },
  };
  } finally {
    // All required sample bytes have been copied by the pinned MP4Box API.
    // Drop parsing buffers on success, unsupported files and thrown errors alike.
    mp4.stop(); mp4.onSamples = mp4.onReady = undefined; mp4.stream = undefined; mp4 = undefined;
  }
}
