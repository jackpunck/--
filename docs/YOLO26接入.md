# YOLO26-Pose 骨架分析

动作纠正页面新增「YOLO26 · YOLO26s-Pose」选项，聊天工具可指定 `poseModel: "yolo26"`。它作为独立模型与 RTMW-L、MediaPipe Full 并列，默认仍是标准 MediaPipe Full。切换模型清除旧骨架与评价；同模型改选动作可复用骨架。

## 推理与节点

使用 Ultralytics 8.4.0 的官方 YOLO26s-Pose 权重，输入 640 × 640。单个 ONNX 图同时输出人体框与 COCO 17 点，完全不调用 YOLOX、RTMW 或 MediaPipe。后台 Worker 优先 WebGPU，失败后用同一 YOLO 模型的 WASM CPU 路径。三种视频解码方式均使用这个独立入口。

输入保持宽高比，居中填充至 640，RGB / 255。导出图输出 `[1,300,57]`，每行为人体框、置信度、类别和 17 个关键点。输出已是端到端结果，不再次运行 NMS。保留置信度至少 0.3 的最多 4 人，关键点低于 0.25 留空，测量仍沿用 0.55 可用性门槛和人物跟踪门槛。

YOLO 的 17 点包含鼻、双眼、双耳及双侧肩、肘、腕、髋、膝、踝，没有手指、脚跟、前脚掌。为复用测量与跟踪，对应点映射到兼容的 33 槽位，其余为 null。回放和 AI 身体证据保留鼻及 12 个四肢点，即 13 点；眼耳与其他模型一样不进入身体证据。

请求采用 `schemaVersion: 5 / yolo26-body13-full`，服务端检查聊天所选模型与数据格式一致。代表帧的 AI 证据保留 17 个兼容槽位，但明确标出 4 个不可用足部点，提示词禁止用脚踝代替脚跟或前脚掌。姿态都是二维估计，不生成深度、脊柱或缺失关节。RTMW 专用的 133 点显示平滑不适用于此模型。

## 资产与运行

权重 `public/vendor/yolo26/yolo26s-pose.onnx` 约 40 MiB，随项目提供，首次按需加载并缓存。资源来源、导出参数和 SHA-256 在同目录 `manifest.json`。上游权重及代码许可证为 AGPL-3.0，许可证原文随资源提供。

```powershell
npm run motion:assets
npm run qa:motion:yolo26
```

生产仍只需原有 Node 服务与浏览器，不增加 Python 服务。需要重新导出时，在开发虚拟环境中安装以下固定版本，再运行导出脚本；脚本从官方发布下载并核对源权重摘要，更新 ONNX 和清单，随后应复核差异及运行 QA。

```powershell
python -m venv .qa/yolo26-export
.qa/yolo26-export/Scripts/python.exe -m pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
.qa/yolo26-export/Scripts/python.exe -m pip install ultralytics==8.4.0 onnx==1.20.1 onnxslim==0.1.82 onnxruntime==1.24.3
.qa/yolo26-export/Scripts/python.exe scripts/export-motion-yolo26.py
node scripts/setup-motion-yolo26.mjs --verify
```

## 验证记录

2026-10-06：真实深蹲片段以 7.5 Hz 抽取 8 帧，WebCodecs、HTMLVideo、FFmpeg 软件解码的 CPU 推理及自动 WebGPU 路径均成功取得 8 帧骨架。检查了资源隔离、13 点协议、缺失足部点、页面模型选择、保存、切换清理与取消后 Worker 终止。视觉 AI 使用本地受控响应，不代表动作纠正准确率。

此次设备上 8 帧推理累计约 346 ms（WebGPU）、5.5 秒（WASM CPU）；初始化约 1.6～2.4 秒。该结果只用于记录本次短片流程，不是跨设备或完整视频速度保证。

官方资料：[YOLO26](https://docs.ultralytics.com/models/yolo26/)、[姿态估计](https://docs.ultralytics.com/tasks/pose/)、[固定版本代码](https://github.com/ultralytics/ultralytics/tree/v8.4.0)。

真实聊天入口也已通过：工具选择 YOLO26、提取与保存、重试复用、刷新后打开报告、原本机视频缺失时返回可恢复错误。

同一真实 1080×1920 视频帧的数值参考检查：浏览器与官方 Ultralytics LetterBox 的输入逐像素一致；浏览器 CPU/GPU 与原生 ONNX Runtime 的有效检测输出最大差分别约 0.000061 / 0.000168，关键点坐标最大差小于 0.001 像素。复核命令：

```powershell
$env:QA_PYTHON="$PWD/.qa/yolo26-export/Scripts/python.exe"
npm run qa:motion:yolo26:reference
$env:QA_POSE_MODEL="yolo26"
npm run qa:chat:motion
```
