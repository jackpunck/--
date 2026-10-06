# YOLO26s-Pose

This directory ships the official Ultralytics YOLO26s-Pose checkpoint exported
as a fixed-shape, end-to-end float32 ONNX graph for ONNX Runtime Web.

- Source: https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26s-pose.pt
- Upstream code: https://github.com/ultralytics/ultralytics/tree/v8.4.0
- License: AGPL-3.0, included in `LICENSE`; upstream also offers commercial licensing.
- Export tool: `scripts/export-motion-yolo26.py` (development only).
- Input: RGB float32 `[1,3,640,640]`, centered letterbox, padding 114, pixels / 255.
- Output: `[1,300,57]`: xyxy, person confidence, class, then 17 x (x,y,confidence).
- One-to-one output is already end-to-end; no separate detector, flip-test,
  anchor decoding, extra sigmoid or second NMS is applied by the application.
- SHA-256 checksums, source checkpoint and export parameters: `manifest.json`.

Run `node scripts/setup-motion-yolo26.mjs --verify` to validate the shipped files.
The ONNX file is approximately 40 MiB and is included in the repository.
Production needs no Python or inference server. See `docs/YOLO26接入.md` for
the rebuild environment and integration limitations.
