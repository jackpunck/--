// One pose model is shared by the UI and every video decoder path.
export const MOTION_POSE_MODEL = Object.freeze({
  id: 'rtmw',
  label: 'RTMW-L',
  version: 'RTMW-L 384x288 20231122 / COCO WholeBody 133 / flip-test',
  loadingMessage: '正在加载 RTMW-L 骨架模型，首次下载较大，低带宽连接可能需要数分钟…',
  initTimeoutMs: 900000,
  analysisTimeoutMs: 3600000,
});
