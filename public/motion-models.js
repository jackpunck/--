// Shared by the UI, every decoder path and the inference worker.
export const DEFAULT_MOTION_MODEL = 'heavy';
export const MOTION_MODELS = Object.freeze({
  heavy: Object.freeze({
    id: 'heavy', label: '高精度', asset: 'pose_landmarker_heavy.task',
    version: 'MediaPipe Tasks Vision 0.10.32 / Pose Landmarker Heavy float16 v1',
    loadingMessage: '正在加载高精度姿态模型，首次使用需要下载约 31 MB…',
    initTimeoutMs: 180000, analysisTimeoutMs: 900000,
  }),
  full: Object.freeze({
    id: 'full', label: '标准', asset: 'pose_landmarker_full.task',
    version: 'MediaPipe Tasks Vision 0.10.32 / Pose Landmarker Full float16 v1',
    loadingMessage: '正在加载标准姿态模型…',
    initTimeoutMs: 120000, analysisTimeoutMs: 600000,
  }),
});

export function getMotionModel(id = DEFAULT_MOTION_MODEL) {
  if (typeof id !== 'string' || !Object.hasOwn(MOTION_MODELS, id)) throw new Error('请选择高精度或标准分析模式。');
  return MOTION_MODELS[id];
}
