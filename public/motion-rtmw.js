// RTMW-L and YOLOX-tiny run entirely on the user's device. Pre/postprocessing
// follows the OpenMMLab exports in vendor/rtmw; no server inference is involved.
export const RTMW_VERSION = 'RTMW-L 384x288 / COCO WholeBody 133 / flip-test';
const POSE_WIDTH = 288, POSE_HEIGHT = 384, DET_SIZE = 416;
const MEAN = [123.675, 116.28, 103.53], STD = [58.395, 57.12, 57.375];

// MMPose configs/_base_/datasets/coco_wholebody.py: each keypoint's `swap`.
// https://github.com/open-mmlab/mmpose/blob/main/configs/_base_/datasets/coco_wholebody.py
export const RTMW_FLIP_INDICES = Object.freeze([
  0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 20, 21, 22, 17, 18, 19,
  39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23,
  49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 50, 51, 52, 53, 58, 57, 56, 55, 54,
  68, 67, 66, 65, 70, 69, 62, 61, 60, 59, 64, 63,
  77, 76, 75, 74, 73, 72, 71, 82, 81, 80, 79, 78, 87, 86, 85, 84, 83, 90, 89, 88,
  112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132,
  91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111,
]);

// Match TopdownPoseEstimator's inputs.flip(-1) after normalization. Reversing
// tensor rows avoids another Canvas resampling or a pixel-center displacement.
export function flipNchw(data, width = POSE_WIDTH, height = POSE_HEIGHT) {
  if (!(data instanceof Float32Array) || !Number.isInteger(width) || width <= 0 ||
      !Number.isInteger(height) || height <= 0 || !data.length || data.length % (width * height)) {
    throw new Error('RTMW 翻转输入格式无效。');
  }
  const flipped = new Float32Array(data.length);
  for (let row = 0; row < data.length; row += width) {
    for (let x = 0; x < width; x++) flipped[row + x] = data[row + width - 1 - x];
  }
  return flipped;
}

// The official export has a dynamic batch dimension. On WebGPU, one batch of
// original + flipped crops avoids a second GPU dispatch/readback for every
// person while retaining both complete predictions. CPU keeps sequential runs
// because batching increases activation memory without a measured speed gain.
export function batchFlipNchw(data, width = POSE_WIDTH, height = POSE_HEIGHT) {
  const flipped = flipNchw(data, width, height);
  const batch = new Float32Array(data.length * 2);
  batch.set(data); batch.set(flipped, data.length);
  return batch;
}

// Official RTMWHead.predict + flip_vectors: swap anatomy, reverse only X,
// then average raw logits BEFORE decoding. SimCC has no heatmap-style shift.
// https://github.com/open-mmlab/mmpose/blob/main/mmpose/models/heads/coord_cls_heads/rtmw_head.py
// https://github.com/open-mmlab/mmpose/blob/main/mmpose/models/utils/tta.py
export function fuseFlipSimcc(originalX, originalY, flippedX, flippedY) {
  if (originalX.length !== 133 * 576 || flippedX.length !== 133 * 576 ||
      originalY.length !== 133 * 768 || flippedY.length !== 133 * 768) {
    throw new Error('RTMW 模型输出格式无效。');
  }
  const x = new Float32Array(originalX.length), y = new Float32Array(originalY.length);
  for (let keypoint = 0; keypoint < 133; keypoint++) {
    const source = RTMW_FLIP_INDICES[keypoint];
    for (let i = 0; i < 576; i++) {
      x[keypoint * 576 + i] = Math.fround(originalX[keypoint * 576 + i] + flippedX[source * 576 + 575 - i]) * .5;
    }
    for (let i = 0; i < 768; i++) {
      y[keypoint * 768 + i] = Math.fround(originalY[keypoint * 768 + i] + flippedY[source * 768 + i]) * .5;
    }
  }
  return { x, y };
}

export function fuseBatchedFlipSimcc(x, y) {
  const xLength = 133 * 576, yLength = 133 * 768;
  if (!(x instanceof Float32Array) || !(y instanceof Float32Array) || x.length !== xLength * 2 || y.length !== yLength * 2) {
    throw new Error('RTMW 模型输出格式无效。');
  }
  return fuseFlipSimcc(x.subarray(0, xLength), y.subarray(0, yLength), x.subarray(xLength), y.subarray(yLength));
}

// Only anatomically matching points are mapped. Missing eye/mouth landmarks
// remain null; the complete 133-point output is returned separately.
export const RTMW_TO_BODY_LANDMARKS = Object.freeze([
  0, null, 1, null, null, 2, null, 3, 4, null, null,
  5, 6, 7, 8, 9, 10, 111, 132, 99, 120, 95, 116,
  11, 12, 13, 14, 15, 16, 19, 22, 17, 20,
]);

export function mapWholebodyLandmarks(points) {
  if (!Array.isArray(points) || points.length !== 133) throw new Error('RTMW 关键点数量无效。');
  return RTMW_TO_BODY_LANDMARKS.map(index => index === null ? null : {
    x: points[index].x, y: points[index].y,
    // The tracker uses a bounded score. The unmodified SimCC responses remain
    // in wholebodyLandmarks; depth and presence are unavailable.
    visibility: Math.max(0, Math.min(1, points[index].score)),
  });
}

export function poseCrop(box) {
  const [left, top, right, bottom] = box;
  let width = (right - left) * 1.25, height = (bottom - top) * 1.25;
  if (![left, top, right, bottom].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('人体检测框无效。');
  if (width > height * POSE_WIDTH / POSE_HEIGHT) height = width * POSE_HEIGHT / POSE_WIDTH;
  else width = height * POSE_WIDTH / POSE_HEIGHT;
  return { x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height };
}

export function decodeSimcc(x, y, crop, imageWidth, imageHeight) {
  if (x.length !== 133 * 576 || y.length !== 133 * 768) throw new Error('RTMW 模型输出格式无效。');
  const points = [];
  for (let keypoint = 0; keypoint < 133; keypoint++) {
    let ix = 0, iy = 0, sx = -Infinity, sy = -Infinity;
    for (let i = 0; i < 576; i++) if (x[keypoint * 576 + i] > sx) { sx = x[keypoint * 576 + i]; ix = i; }
    for (let i = 0; i < 768; i++) if (y[keypoint * 768 + i] > sy) { sy = y[keypoint * 768 + i]; iy = i; }
    // Use the export's original response scale, not softmax: these scores are
    // keypoint responses and are not calibrated probabilities.
    const score = Math.min(sx, sy);
    if (!Number.isFinite(score)) throw new Error('RTMW 输出了无效置信度。');
    points.push({ x: ((score > 0 ? ix / 2 : -.5) / POSE_WIDTH * crop.width + crop.x) / imageWidth,
      y: ((score > 0 ? iy / 2 : -.5) / POSE_HEIGHT * crop.height + crop.y) / imageHeight, score });
  }
  return points;
}

export function detectorBoxes(detections, labels, ratio, width, height, maxPeople = 4) {
  if (detections.length % 5 || !(ratio > 0)) throw new Error('人体检测模型输出格式无效。');
  const result = [];
  for (let i = 0; i < detections.length / 5; i++) {
    const offset = i * 5, score = detections[offset + 4];
    if (score < .3 || (labels && Number(labels[i]) !== 0)) continue;
    const box = [Math.max(0, detections[offset] / ratio), Math.max(0, detections[offset + 1] / ratio),
      Math.min(width, detections[offset + 2] / ratio), Math.min(height, detections[offset + 3] / ratio)];
    if (![...box, score].every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) continue;
    result.push({ box, score });
  }
  return result.sort((a, b) => b.score - a.score).slice(0, maxPeople).map(item => item.box);
}

function imageTensor(ort, context, width, height, normalize, bgr = false) {
  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = width * height, data = new Float32Array(3 * pixels);
  for (let channel = 0; channel < 3; channel++) {
    const sourceChannel = bgr ? 2 - channel : channel;
    for (let pixel = 0; pixel < pixels; pixel++) {
      const value = rgba[pixel * 4 + sourceChannel];
      data[channel * pixels + pixel] = normalize ? (value - MEAN[channel]) / STD[channel] : value;
    }
  }
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

function disposeOutputs(outputs) { for (const tensor of Object.values(outputs || {})) tensor.dispose(); }

export async function createRtmw({ delegate = 'CPU' } = {}) {
  if (!['GPU', 'CPU'].includes(delegate)) throw new Error('RTMW 推理设备无效。');
  if (delegate === 'GPU' && !globalThis.navigator?.gpu) throw new Error('当前浏览器无法使用 WebGPU。');
  const ort = await import('./vendor/onnxruntime/ort.all.min.mjs');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL('./vendor/onnxruntime/', import.meta.url).href;
  const providers = delegate === 'GPU' ? ['webgpu', 'wasm'] : ['wasm'];
  let detector, pose, closed = false;
  try {
    // Sequential loading bounds peak memory during model initialization.
    detector = await ort.InferenceSession.create(new URL('./vendor/rtmw/yolox-tiny-humanart.onnx', import.meta.url).href, { executionProviders: providers });
    pose = await ort.InferenceSession.create(new URL('./vendor/rtmw/rtmw-l-384x288.onnx', import.meta.url).href, { executionProviders: providers });
    // Compile both graphs before reporting readiness, so a GPU kernel failure
    // reaches the caller's fresh-worker CPU fallback during initialization.
    for (const [session, height, width, batch] of [[detector, DET_SIZE, DET_SIZE, 1], [pose, POSE_HEIGHT, POSE_WIDTH, delegate === 'GPU' ? 2 : 1]]) {
      const input = new ort.Tensor('float32', new Float32Array(batch * 3 * height * width), [batch, 3, height, width]);
      try { disposeOutputs(await session.run({ [session.inputNames[0]]: input })); } finally { input.dispose(); }
    }
  } catch (error) {
    await detector?.release(); await pose?.release(); throw error;
  }
  const detCanvas = new OffscreenCanvas(DET_SIZE, DET_SIZE), poseCanvas = new OffscreenCanvas(POSE_WIDTH, POSE_HEIGHT);
  const detContext = detCanvas.getContext('2d', { willReadFrequently: true });
  const poseContext = poseCanvas.getContext('2d', { willReadFrequently: true });
  return {
    delegate, backend: delegate === 'GPU' ? 'ONNX Runtime WebGPU + WASM fallback' : 'ONNX Runtime WASM', version: RTMW_VERSION,
    async detect(image) {
      if (closed) throw new Error('RTMW 分析器已关闭。');
      const width = image.width, height = image.height, ratio = Math.min(DET_SIZE / width, DET_SIZE / height);
      detContext.fillStyle = 'rgb(114,114,114)'; detContext.fillRect(0, 0, DET_SIZE, DET_SIZE);
      detContext.drawImage(image, 0, 0, width, height, 0, 0, Math.floor(width * ratio), Math.floor(height * ratio));
      let input = imageTensor(ort, detContext, DET_SIZE, DET_SIZE, false, true), outputs, boxes;
      try {
        outputs = await detector.run({ [detector.inputNames[0]]: input });
        boxes = detectorBoxes(outputs.dets.data, outputs.labels?.data, ratio, width, height);
      } finally { input.dispose(); disposeOutputs(outputs); }
      const wholebodyLandmarks = [];
      for (const box of boxes) {
        const crop = poseCrop(box);
        poseContext.fillStyle = '#000'; poseContext.fillRect(0, 0, POSE_WIDTH, POSE_HEIGHT);
        // Drawing the complete image with an affine transform preserves black
        // padding when an expanded person crop extends beyond the source.
        const sx = POSE_WIDTH / crop.width, sy = POSE_HEIGHT / crop.height;
        // Canvas samples pixel centers at n+.5, while OpenCV warpAffine maps
        // integer centers. This offset makes both affine coordinate systems
        // agree instead of introducing a half-pixel resize displacement.
        poseContext.drawImage(image, -crop.x * sx + (1 - sx) / 2, -crop.y * sy + (1 - sy) / 2,
          width * sx, height * sy);
        input = imageTensor(ort, poseContext, POSE_WIDTH, POSE_HEIGHT, true); outputs = undefined;
        let flippedInput;
        try {
          let fused;
          if (delegate === 'GPU') {
            flippedInput = new ort.Tensor('float32', batchFlipNchw(input.data), [2, 3, POSE_HEIGHT, POSE_WIDTH]);
            outputs = await pose.run({ [pose.inputNames[0]]: flippedInput });
            fused = fuseBatchedFlipSimcc(outputs.simcc_x.data, outputs.simcc_y.data);
          } else {
            outputs = await pose.run({ [pose.inputNames[0]]: input });
            // Copy and release the first result before reusing the same session.
            // Only two small CPU logit arrays survive the second inference.
            const originalX = new Float32Array(outputs.simcc_x.data), originalY = new Float32Array(outputs.simcc_y.data);
            disposeOutputs(outputs); outputs = undefined;
            flippedInput = new ort.Tensor('float32', flipNchw(input.data), [1, 3, POSE_HEIGHT, POSE_WIDTH]);
            outputs = await pose.run({ [pose.inputNames[0]]: flippedInput });
            fused = fuseFlipSimcc(originalX, originalY, outputs.simcc_x.data, outputs.simcc_y.data);
          }
          wholebodyLandmarks.push(decodeSimcc(fused.x, fused.y, crop, width, height));
        } finally { input.dispose(); flippedInput?.dispose(); disposeOutputs(outputs); }
      }
      return { landmarks: wholebodyLandmarks.map(mapWholebodyLandmarks), wholebodyLandmarks,
        detectionBoxes: boxes.map(([left,top,right,bottom])=>[left/width,top/height,right/width,bottom/height]) };
    },
    async close() {
      if (closed) return; closed = true;
      detCanvas.width = detCanvas.height = poseCanvas.width = poseCanvas.height = 1;
      await detector.release(); await pose.release();
    },
  };
}
