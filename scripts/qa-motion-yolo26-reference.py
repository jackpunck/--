"""Native reference for scripts/qa-motion-yolo26-reference.mjs; installs nothing."""
import json
from pathlib import Path
import sys

import cv2
import numpy as np
import onnxruntime as ort
from ultralytics.data.augment import LetterBox
from ultralytics.utils import ops

root = Path(sys.argv[1])
project = Path(__file__).resolve().parents[1]
metadata = json.loads((root / 'browser-reference.json').read_text())
options = ort.SessionOptions()
options.log_severity_level = 3
session = ort.InferenceSession(str(project / 'public/vendor/yolo26/yolo26s-pose.onnx'), options, providers=['CPUExecutionProvider'])
reports = []


def accepted(rows):
    # The exported one-to-one output is already NMS-free and confidence-sorted.
    return rows[(rows[:, 4] >= .3) & (rows[:, 5] == 0)][:4]


def match(rows, reference):
    """Match independent high-confidence people by box; ignore low-score TopK ties."""
    assert len(rows) == len(reference) and len(rows) > 0
    available = list(range(len(reference)))
    matched = []
    for row in rows:
        best = min(available, key=lambda index: float(np.linalg.norm(row[:4] - reference[index, :4])))
        available.remove(best)
        matched.append(reference[best])
    return np.stack(matched)


for item in metadata['results']:
    if item.get('skipped'):
        reports.append(item)
        continue
    delegate = item['delegate']
    image = cv2.imdecode(np.frombuffer((root / f'{delegate}-frame.png').read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    height, width = image.shape[:2]
    official_image = LetterBox(new_shape=(640, 640), auto=False)(image=image)
    official_input = np.ascontiguousarray(official_image[..., ::-1].transpose(2, 0, 1)[None]).astype(np.float32) / 255
    browser_input = np.fromfile(root / f'{delegate}-input.f32', np.float32).reshape(1, 3, 640, 640)
    browser_output = np.fromfile(root / f'{delegate}-output.f32', np.float32).reshape(1, 300, 57)[0]
    same_input = session.run(None, {session.get_inputs()[0].name: browser_input})[0][0]
    official_output = session.run(None, {session.get_inputs()[0].name: official_input})[0][0]
    browser_rows = accepted(browser_output)
    same_rows = match(browser_rows, accepted(same_input))
    official_rows = match(browser_rows, accepted(official_output))
    original_scale = np.array([width, height], dtype=np.float32)

    # Use the official public coordinate conversion, separately from our JS
    # inverse. For odd padding, official scale_coords uses half-padding whereas
    # the adapter uses actual integer canvas padding; report that bounded delta.
    official_points = ops.scale_coords((640, 640), official_rows[:, 6:].reshape(-1, 17, 3)[..., :2].copy(), (height, width))
    same_points = ops.scale_coords((640, 640), same_rows[:, 6:].reshape(-1, 17, 3)[..., :2].copy(), (height, width))
    browser_points = np.array([[[point['x'], point['y']] for point in person] for person in item['detected']['cocoLandmarks']]) * original_scale
    confidence = browser_rows[:, 6:].reshape(-1, 17, 3)[..., 2]
    # The app retains offscreen points as offscreen rather than fabricating an
    # image-edge point. The official helper clips them; compare visible joints.
    in_frame = ((browser_points >= 0) & (browser_points <= original_scale)).all(axis=-1)
    observed = (confidence >= .25) & in_frame
    assert observed.any()
    same_delta = np.linalg.norm(browser_points - same_points, axis=-1)[observed]
    official_delta = np.linalg.norm(browser_points - official_points, axis=-1)[observed]
    report = {
        'delegate': delegate, 'image': [width, height], 'people': len(browser_rows),
        'meanPreprocessPixelDifference': float(np.abs(official_input - browser_input).mean() * 255),
        'maxPreprocessPixelDifference': float(np.abs(official_input - browser_input).max() * 255),
        'identicalInputAcceptedMaxOutputDifference': float(np.abs(same_rows - browser_rows).max()),
        'identicalInputAcceptedMaxConfidenceDifference': float(np.abs(same_rows[:, 4] - browser_rows[:, 4]).max()),
        'identicalInputOfficialDecodeMeanPixelDifference': float(same_delta.mean()),
        'identicalInputOfficialDecodeMaxPixelDifference': float(same_delta.max()),
        'officialPipelineMeanKeypointPixelDifference': float(official_delta.mean()),
        'officialPipelineMaxKeypointPixelDifference': float(official_delta.max()),
    }
    # Native/browser convolution tolerances are below one tenth of an input
    # pixel; Canvas/OpenCV interpolation may shift the model slightly more.
    assert report['identicalInputAcceptedMaxOutputDifference'] < .1, report
    assert report['meanPreprocessPixelDifference'] < 1, report
    assert report['identicalInputOfficialDecodeMaxPixelDifference'] < max(width, height) / 640 + .1, report
    assert report['officialPipelineMeanKeypointPixelDifference'] < max(width, height) * .005, report
    reports.append(report)

(root / 'reference-comparison.json').write_text(json.dumps(reports, indent=2))
print(json.dumps(reports))
