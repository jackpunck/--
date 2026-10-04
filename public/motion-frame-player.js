const finite = value => typeof value === 'number' && Number.isFinite(value);
const clock = value => {
  const tenths = Math.round(Math.max(0, value || 0) * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

/** Replay the sampled analysis pictures. No video encoding or audio is involved. */
export function createMotionFramePlayer({ canvas, button, range, time, onFrame = () => {}, onError = () => {} }) {
  const context = canvas.getContext('2d');
  let frames = [], duration = 0, renderedTime = 0, requestedTime = 0;
  let ready = false, destroyed = false, playing = false, seeking = false, disabled = false;
  let animation = 0, renderRevision = 0, sourceRevision = 0, renderedBlob = null;
  let clockStart = 0, mediaStart = 0;
  const listeners = new AbortController();

  function controls() {
    button.textContent = playing ? '暂停回放' : '播放回放';
    button.setAttribute('aria-pressed', String(playing));
    button.disabled = disabled || !ready || frames.length < 2;
    range.disabled = disabled || !ready || frames.length < 2;
    range.max = String(duration);
    range.value = String(Math.min(duration, requestedTime));
    range.setAttribute('aria-valuetext', `${clock(renderedTime)}，共 ${clock(duration)}`);
    time.textContent = `${clock(renderedTime)} / ${clock(duration)}`;
  }
  function pause() {
    playing = false;
    // A bitmap requested during playback must not replace the paused picture.
    renderRevision++;
    seeking = false;
    requestedTime = renderedTime;
    cancelAnimationFrame(animation);
    animation = 0;
    controls();
  }
  function nearestFrame(value) {
    let low = 0, high = frames.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle].time < value) low = middle + 1;
      else high = middle;
    }
    const after = frames[low], before = frames[Math.max(0, low - 1)];
    return after && before && Math.abs(after.time - value) < Math.abs(before.time - value) ? after : before;
  }
  async function paint(value) {
    if (destroyed || !frames.length) return;
    requestedTime = Math.max(0, Math.min(duration, Number(value) || 0));
    const frame = nearestFrame(requestedTime);
    const revision = ++renderRevision;
    controls();
    if (frame.blob === renderedBlob) {
      seeking = false;
      onFrame(renderedTime);
      return;
    }
    seeking = true;
    let bitmap;
    try {
      bitmap = await createImageBitmap(frame.blob);
      if (destroyed || revision !== renderRevision) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.drawImage(bitmap, 0, 0);
      renderedBlob = frame.blob;
      renderedTime = frame.time;
      ready = true;
      seeking = false;
      controls();
      onFrame(renderedTime);
    } catch (cause) {
      if (destroyed || revision !== renderRevision) return;
      seeking = false;
      pause();
      onError(cause);
      throw cause;
    } finally {
      bitmap?.close();
    }
  }
  async function seek(value) {
    pause();
    await paint(value);
  }
  function tick(now) {
    if (!playing || destroyed) return;
    const value = Math.min(duration, mediaStart + (now - clockStart) / 1000);
    if (value >= duration) {
      pause();
      void paint(duration).catch(() => {});
      return;
    }
    // A new bitmap is needed only when the closest sample changes.
    const frame = nearestFrame(value);
    if (!seeking && frame?.blob !== renderedBlob) void paint(value).catch(() => {});
    else { requestedTime = value; controls(); }
    animation = requestAnimationFrame(tick);
  }
  function play() {
    if (destroyed || disabled || !ready || frames.length < 2 || playing) return;
    mediaStart = requestedTime >= duration ? 0 : requestedTime;
    clockStart = performance.now();
    playing = true;
    controls();
    animation = requestAnimationFrame(tick);
  }
  function clear() {
    sourceRevision++;
    renderRevision++;
    pause();
    frames = [];
    renderedBlob = null;
    renderedTime = requestedTime = duration = 0;
    ready = seeking = false;
    context?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 1;
    controls();
  }
  async function setSource({ poster, metadata }) {
    clear();
    const revision = sourceRevision;
    duration = metadata.duration;
    frames = [{ time: 0, blob: poster, width: metadata.width, height: metadata.height }];
    await paint(0);
    return !destroyed && revision === sourceRevision && ready;
  }
  async function setFrames(values) {
    pause();
    const valid = (Array.isArray(values) ? values : []).filter(frame =>
      finite(frame?.time) && frame.time >= 0 && frame.time <= duration && frame.blob instanceof Blob && frame.blob.size > 0
    ).sort((a, b) => a.time - b.time);
    if (!valid.length) throw new Error('分析画面尚未生成，请重新评估视频。');
    frames = valid;
    await paint(0);
  }
  button.addEventListener('click', () => playing ? pause() : play(), { signal: listeners.signal });
  range.addEventListener('pointerdown', pause, { signal: listeners.signal });
  range.addEventListener('input', () => { void seek(Number(range.value)).catch(() => {}); }, { signal: listeners.signal });
  canvas.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      playing ? pause() : play();
    }
  }, { signal: listeners.signal });
  controls();
  return {
    setSource, setFrames, seek, pause, clear,
    get ready() { return ready; },
    get seeking() { return seeking; },
    get currentTime() { return renderedTime; },
    setDisabled(value) { disabled = !!value; if (disabled) pause(); controls(); },
    destroy() { if (destroyed) return; clear(); destroyed = true; listeners.abort(); }
  };
}
