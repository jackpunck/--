"""Rebuild the shipped ONNX from the pinned official checkpoint (development only)."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "public/vendor/yolo26"
URL = "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26s-pose.pt"
SOURCE_SHA256 = "a083adb42303728ae14c4bd6bd56d80da46f82fb2564dbd6f31dcc92ea321646"
VERSIONS = {"ultralytics": "8.4.0", "torch": "2.14.1+cpu", "onnx": "1.20.1", "onnxslim": "0.1.82"}

for package, expected in VERSIONS.items():
    actual = importlib.metadata.version(package)
    if actual != expected:
        raise RuntimeError(f"{package}: expected {expected}, found {actual}")

import onnx
from ultralytics import YOLO

DEST.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="yolo26-export-") as temp:
    source = Path(temp) / "yolo26s-pose.pt"
    with urllib.request.urlopen(URL, timeout=120) as response:
        source.write_bytes(response.read())
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError("Official checkpoint checksum mismatch")
    exported = YOLO(str(source)).export(format="onnx", imgsz=640, opset=17,
        simplify=True, dynamic=False, batch=1, half=False, nms=False, device="cpu")
    model = onnx.load(exported)
    onnx.checker.check_model(model)
    if [d.dim_value for d in model.graph.output[0].type.tensor_type.shape.dim] != [1, 300, 57]:
        raise RuntimeError("Expected end-to-end COCO17 output [1,300,57]")
    # Normalize metadata only; this does not change any weights or operators.
    metadata = {entry.key: entry.value for entry in model.metadata_props}
    metadata.pop("date", None)
    metadata["description"] = "Ultralytics YOLO26s-Pose / COCO17 / 640 / end-to-end"
    onnx.helper.set_model_props(model, metadata)
    onnx.save(model, str(DEST / "yolo26s-pose.onnx"))

license_path = DEST / "LICENSE"
if not license_path.exists():
    with urllib.request.urlopen("https://raw.githubusercontent.com/ultralytics/ultralytics/v8.4.0/LICENSE", timeout=60) as response:
        license_path.write_bytes(response.read())
manifest = {
    "model": "YOLO26s-Pose", "version": "Ultralytics 8.4.0", "license": "AGPL-3.0",
    "source": {"url": URL, "sha256": SOURCE_SHA256},
    "exportVersions": VERSIONS,
    "export": {"imgsz": 640, "opset": 17, "simplify": True, "dynamic": False,
               "batch": 1, "half": False, "nms": False, "end2end": True},
    "input": [1, 3, 640, 640], "output": [1, 300, 57],
    "files": [{"path": name, "bytes": (DEST / name).stat().st_size,
               "sha256": hashlib.sha256((DEST / name).read_bytes()).hexdigest()}
              for name in ["yolo26s-pose.onnx", "LICENSE"]],
}
(DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest, indent=2))
