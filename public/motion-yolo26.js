// One YOLO26s-Pose graph detects people and estimates their COCO 17-point
// skeletons. No separate detector or pose model participates in this mode.
export const YOLO26_VERSION = 'YOLO26s-Pose 640 / COCO17 / end-to-end';
export const YOLO26_INPUT_SIZE = 640;
const OUTPUT_ROWS = 300, OUTPUT_COLUMNS = 6 + 17 * 3;

// COCO eye/ear points have direct equivalents. Eye corners, mouth, fingers,
// heels and forefeet do not; leave them absent instead of inventing anatomy.
export const YOLO26_TO_BODY_LANDMARKS = Object.freeze([
  0, null, 1, null, null, 2, null, 3, 4, null, null,
  5, 6, 7, 8, 9, 10, null, null, null, null, null, null,
  11, 12, 13, 14, 15, 16, null, null, null, null,
]);

// Python's round uses ties-to-even, as used by Ultralytics LetterBox. Retain
// the actual integer resize dimensions so the inverse undoes Canvas exactly.
function roundEven(value) {
  const lower = Math.floor(value);
  return value - lower === .5 ? lower + (lower % 2) : Math.round(value);
}

export function yolo26Letterbox(width, height, size = YOLO26_INPUT_SIZE) {
  if (![width, height, size].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('YOLO26 图像尺寸无效。');
  }
  const ratio = Math.min(size / width, size / height);
  const resizedWidth = Math.max(1, roundEven(width * ratio));
  const resizedHeight = Math.max(1, roundEven(height * ratio));
  return { width, height, size, resizedWidth, resizedHeight,
    left: Math.floor((size - resizedWidth) / 2), top: Math.floor((size - resizedHeight) / 2),
    scaleX: resizedWidth / width, scaleY: resizedHeight / height };
}

export function yolo26RgbaToNchw(rgba, width, height) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0) ||
      !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) {
    throw new Error('YOLO26 图像像素格式无效。');
  }
  const pixels = width * height, data = new Float32Array(3 * pixels);
  for (let pixel = 0; pixel < pixels; pixel++) {
    // Canvas is RGBA; the ONNX input is RGB float32 NCHW in [0, 1].
    data[pixel] = rgba[pixel * 4] / 255;
    data[pixels + pixel] = rgba[pixel * 4 + 1] / 255;
    data[2 * pixels + pixel] = rgba[pixel * 4 + 2] / 255;
  }
  return data;
}

export function mapYolo26Landmarks(points, minConfidence = .25) {
  if (!Array.isArray(points) || points.length !== 17 || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new Error('YOLO26 关键点格式无效。');
  }
  return YOLO26_TO_BODY_LANDMARKS.map(index => {
    const point = index === null ? null : points[index];
    if (!point || ![point.x, point.y, point.score].every(Number.isFinite) || point.score < minConfidence || point.score > 1) return null;
    // Keep coordinates outside the frame outside it: clipping would turn a
    // missing/off-screen joint into misleading evidence on the image border.
    return { x: point.x, y: point.y, visibility: point.score };
  });
}

function validateOutput(output) {
  if (output?.dims?.length !== 3 || output.dims[0] !== 1 || output.dims[1] !== OUTPUT_ROWS ||
      output.dims[2] !== OUTPUT_COLUMNS || !(output.data instanceof Float32Array) ||
      output.data.length !== OUTPUT_ROWS * OUTPUT_COLUMNS) {
    throw new Error('YOLO26 模型输出格式无效，需要 640 输入的端到端 COCO17 模型。');
  }
}

export function decodeYolo26Pose(output, transform, { minConfidence = .3, minKeypointConfidence = .25, maxPeople = 4 } = {}) {
  validateOutput(output);
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1 ||
      !Number.isFinite(minKeypointConfidence) || minKeypointConfidence < 0 || minKeypointConfidence > 1 ||
      !Number.isInteger(maxPeople) || maxPeople < 1 || maxPeople > OUTPUT_ROWS) {
    throw new Error('YOLO26 置信度或人数限制无效。');
  }
  const { width, height, left, top, scaleX, scaleY } = transform || {};
  if (![width, height, scaleX, scaleY].every(value => Number.isFinite(value) && value > 0) ||
      ![left, top].every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('YOLO26 图像变换无效。');
  }
  const data = output.data, detections = [];
  // The exported one-to-one head already returns xyxy, score, class, then
  // decoded (x,y,confidence) triples. Do not apply sigmoid or NMS a second time.
  // https://github.com/ultralytics/ultralytics/blob/main/ultralytics/nn/modules/head.py
  for (let row = 0; row < OUTPUT_ROWS; row++) {
    const offset = row * OUTPUT_COLUMNS, score = data[offset + 4];
    if (!Number.isFinite(score) || score < minConfidence || score > 1 || data[offset + 5] !== 0) continue;
    const box = [
      Math.max(0, (data[offset] - left) / scaleX / width),
      Math.max(0, (data[offset + 1] - top) / scaleY / height),
      Math.min(1, (data[offset + 2] - left) / scaleX / width),
      Math.min(1, (data[offset + 3] - top) / scaleY / height),
    ];
    if (!box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) continue;
    const points = Array.from({ length: 17 }, (_, index) => {
      const k = offset + 6 + index * 3;
      const x = (data[k] - left) / scaleX / width, y = (data[k + 1] - top) / scaleY / height;
      const confidence = data[k + 2];
      return [x, y, confidence].every(Number.isFinite) && confidence >= 0 && confidence <= 1 ? { x, y, score: confidence } : null;
    });
    detections.push({ box, score, points });
  }
  const selected = detections.sort((a, b) => b.score - a.score).slice(0, maxPeople);
  return {
    landmarks: selected.map(({ points }) => mapYolo26Landmarks(points, minKeypointConfidence)),
    cocoLandmarks: selected.map(({ points }) => points),
    detectionBoxes: selected.map(({ box }) => box),
    detectionScores: selected.map(({ score }) => score),
  };
}

function disposeOutputs(outputs) {
  for (const tensor of Object.values(outputs || {})) tensor.dispose();
}

export async function createYolo26({ delegate = 'CPU' } = {}) {
  if (!['GPU', 'CPU'].includes(delegate)) throw new Error('YOLO26 推理设备无效。');
  if (delegate === 'GPU' && !globalThis.navigator?.gpu) throw new Error('当前浏览器无法使用 WebGPU。');
  const ort = await import('./vendor/onnxruntime/ort.all.min.mjs');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL('./vendor/onnxruntime/', import.meta.url).href;
  const size = YOLO26_INPUT_SIZE, providers = delegate === 'GPU' ? ['webgpu', 'wasm'] : ['wasm'];
  let session, canvas, context, closed = false;
  try {
    canvas = new OffscreenCanvas(size, size);
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法创建 YOLO26 图像画布。');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'low';
    session = await ort.InferenceSession.create(new URL('./vendor/yolo26/yolo26s-pose.onnx', import.meta.url).href, { executionProviders: providers });
    // Compile the graph and check its contract before reporting readiness.
    // GPU initialization errors therefore reach the worker's CPU retry path.
    const input = new ort.Tensor('float32', new Float32Array(3 * size * size), [1, 3, size, size]);
    let outputs;
    try {
      outputs = await session.run({ [session.inputNames[0]]: input });
      validateOutput(outputs[session.outputNames[0]]);
    } finally { input.dispose(); disposeOutputs(outputs); }
  } catch (error) {
    await session?.release();
    if (canvas) canvas.width = canvas.height = 1;
    throw error;
  }
  return {
    delegate, backend: delegate === 'GPU' ? 'ONNX Runtime WebGPU + WASM fallback' : 'ONNX Runtime WASM', version: YOLO26_VERSION,
    async detect(image) {
      if (closed) throw new Error('YOLO26 分析器已关闭。');
      const transform = yolo26Letterbox(image.width, image.height);
      context.fillStyle = 'rgb(114,114,114)';
      context.fillRect(0, 0, size, size);
      context.drawImage(image, 0, 0, transform.width, transform.height,
        transform.left, transform.top, transform.resizedWidth, transform.resizedHeight);
      const data = yolo26RgbaToNchw(context.getImageData(0, 0, size, size).data, size, size);
      const input = new ort.Tensor('float32', data, [1, 3, size, size]);
      let outputs;
      try {
        outputs = await session.run({ [session.inputNames[0]]: input });
        return decodeYolo26Pose(outputs[session.outputNames[0]], transform);
      } finally { input.dispose(); disposeOutputs(outputs); }
    },
    async close() {
      if (closed) return;
      closed = true;
      canvas.width = canvas.height = 1;
      await session.release();
    },
  };
}
