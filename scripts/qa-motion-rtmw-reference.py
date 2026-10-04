"""Compare browser RTMW tensors with the official OpenCV affine pipeline.

Development only: numpy, opencv-python and onnxruntime; installs nothing.
Input is the output directory printed by scripts/qa-motion-rtmw.mjs.
"""
import json
from pathlib import Path
import sys

import cv2
import numpy as np
import onnxruntime as ort

root = Path(sys.argv[1])
models = Path(__file__).resolve().parents[1] / 'public/vendor/rtmw'
metadata = json.loads((root / 'browser-reference.json').read_text())
image = cv2.imdecode(np.frombuffer((root / 'reference-frame.png').read_bytes(), np.uint8), cv2.IMREAD_COLOR)
height, width = image.shape[:2]
ratio = min(416 / width, 416 / height)
padded = np.full((416, 416, 3), 114, dtype=np.uint8)
resized = cv2.resize(image, (int(width * ratio), int(height * ratio)), interpolation=cv2.INTER_LINEAR)
padded[:resized.shape[0], :resized.shape[1]] = resized
detector_input = padded.transpose(2, 0, 1)[None].astype(np.float32)  # BGR, no normalization
browser_detector_input = np.fromfile(root / 'browser-input-0.f32', np.float32).reshape(detector_input.shape)
detections = np.fromfile(root / 'browser-output-0-dets.f32', np.float32).reshape(metadata['calls'][0]['outputs']['dets']['dims'])
box = detections[0, 0, :4] / ratio
box[[0, 2]] = np.clip(box[[0, 2]], 0, width)
box[[1, 3]] = np.clip(box[[1, 3]], 0, height)
center = (box[:2] + box[2:]) / 2
scale = (box[2:] - box[:2]) * 1.25
if scale[0] > scale[1] * .75:
    scale[1] = scale[0] / .75
else:
    scale[0] = scale[1] * .75
matrix = np.array([[288 / scale[0], 0, 144 - center[0] * 288 / scale[0]],
                   [0, 384 / scale[1], 192 - center[1] * 384 / scale[1]]], np.float32)
crop = cv2.warpAffine(image, matrix, (288, 384), flags=cv2.INTER_LINEAR)
rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
pose_input = ((rgb.astype(np.float32) - [123.675, 116.28, 103.53]) /
              [58.395, 57.12, 57.375]).transpose(2, 0, 1)[None].astype(np.float32)
browser_input = np.fromfile(root / 'browser-input-1.f32', np.float32).reshape(pose_input.shape)
options = ort.SessionOptions()
options.log_severity_level = 3
session = ort.InferenceSession(str(models / 'rtmw-l-384x288.onnx'), options, providers=['CPUExecutionProvider'])
x, y = session.run(None, {'input': pose_input})
browser_x = np.fromfile(root / 'browser-output-1-simcc_x.f32', np.float32).reshape(1, 133, 576)
browser_y = np.fromfile(root / 'browser-output-1-simcc_y.f32', np.float32).reshape(1, 133, 768)


def points(sx, sy):
    return np.stack([np.argmax(sx, axis=2) / 576 * scale[0] + center[0] - scale[0] / 2,
                     np.argmax(sy, axis=2) / 768 * scale[1] + center[1] - scale[1] / 2], axis=-1)


delta = np.linalg.norm(points(x, y) - points(browser_x, browser_y), axis=-1)[0]
same_x, same_y = session.run(None, {'input': browser_input})
logit_error = float(max(np.max(abs(same_x - browser_x)), np.max(abs(same_y - browser_y))))
report = {
    'image': [width, height],
    'detectorMeanPixelDifference': float(np.mean(np.abs(detector_input - browser_detector_input))),
    'poseMeanNormalizedDifference': float(np.mean(np.abs(pose_input - browser_input))),
    'body17MeanPixelDifference': float(delta[:17].mean()), 'body17MaxPixelDifference': float(delta[:17].max()),
    'whole133MeanPixelDifference': float(delta.mean()), 'whole133MaxPixelDifference': float(delta.max()),
    'identicalInputMaxLogitDifference': logit_error,
}
# Same-input inference isolates correctness from Canvas/OpenCV interpolation.
assert logit_error < .001, report
assert report['poseMeanNormalizedDifference'] < .05, report
assert report['body17MeanPixelDifference'] < max(width, height) * .005, report
(root / 'reference-comparison.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
