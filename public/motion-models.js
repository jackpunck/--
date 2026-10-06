const HIGH_PRECISION_POSE_MODEL = Object.freeze({
  id: 'rtmw',
  tier: '高精度',
  label: 'RTMW-L',
  version: 'RTMW-L 384x288 20231122 / COCO WholeBody 133 / flip-test',
  loadingMessage: '正在加载 RTMW-L 骨架模型，首次下载较大，低带宽连接可能需要数分钟…',
  initTimeoutMs: 900000,
  analysisTimeoutMs: 3600000,
});

export const MOTION_POSE_MODELS = Object.freeze([
  HIGH_PRECISION_POSE_MODEL,
  Object.freeze({
    id: 'mediapipe-full',
    tier: '标准',
    label: 'MediaPipe Full',
    version: 'MediaPipe Pose Landmarker Full float16 v1 / tasks-vision 0.10.32',
    loadingMessage: '正在加载标准骨架模型 MediaPipe Full…',
    initTimeoutMs: 180000,
    analysisTimeoutMs: 3600000,
  }),
  Object.freeze({
    id: 'yolo26',
    tier: 'YOLO26',
    label: 'YOLO26s-Pose',
    version: 'YOLO26s-Pose 640 / COCO17 / end-to-end',
    loadingMessage: '正在加载 YOLO26s-Pose 骨架模型…',
    initTimeoutMs: 300000,
    analysisTimeoutMs: 3600000,
  }),
]);

// UI, chat tools and every decoder share the same standard default.
export const MOTION_POSE_MODEL = MOTION_POSE_MODELS[1];

export function getMotionPoseModel(id = MOTION_POSE_MODEL.id) {
  const model = MOTION_POSE_MODELS.find(item => item.id === id);
  if (!model) throw new Error('不支持的骨架分析模型。');
  return model;
}
