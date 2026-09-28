# 精细模型与动作开发

这是当前精细人体及后续动作开发的独立工作目录。从原演示复制整理，模型数据、骨架、动作、页面、构建依赖清单和验证工具都在本目录内。可以把整个文件夹复制到其他位置，不依赖旁边的 `3d-demo` 或其 `.qa`。

当前包含深蹲、俯卧撑、哑铃弯举 **3 个连续动画**，以及主应用其余 **22 个动作的静态姿态**。静态姿态明确标注为单帧示意，提供对应关节姿态、肌群高亮和器械轮廓，不模拟完整动作轨迹。

主应用使用 `/model/index.html?exercise=squat&embed=1` 嵌入；动作参数覆盖 `exercise-catalog.js` 的 25 个 ID。未知 ID 显示未收录提示和解剖姿态，不会冒充深蹲演示。完整接口与许可保留要求见 [`../docs/动作接入.md`](../docs/动作接入.md)。

肌肉图谱入口：

- `/model/index.html?mode=atlas&muscle=chest&embed=1`：高亮整个肌群。
- `/model/index.html?mode=atlas&structure=Serratus%20anterior%20muscle.l&embed=1`：准确高亮原图谱的一块结构。
- 增加 `compact=1`：用于聊天卡片的简化布局，保留旋转、视角、缩放、名称和许可。肌肉链接自动拉近对应的上半身或下半身。

13 个肌群 ID 为 `chest,biceps,triceps,deltoids,lats,traps,core,obliques,quads,hamstrings,glutes,calves,forearms`。`core` 的高亮范围是腹直肌与腹横肌，腹内外斜肌使用 `obliques`。点击任何可见结构，按命中三角面的原始网格记录显示实际名称；常见肌肉有中文名称，其他结构保留原图谱英文名称及左右侧标识。单结构选择使用该结构真实几何的透视高亮，使深层肌肉也可见，界面明确显示“透视高亮”；点击仍按真实表面命中。不会把单块肌肉替换成附近的大肌群。

嵌入消息仅接受同源父窗口。支持 `fitness:exercise`、`fitness:muscle`、`fitness:structure`；肌肉选中发出 `fitness:muscle-selected`，含 `muscle`（可能为空）、`name`、`structure` 与 `mode`。原有 `fitness:ready`、`fitness:selected` 保持兼容。`ready` 在首帧绘制后回报，并附 `mode`、`muscle`、`structure`；图谱模式的 `exercise` 为 `null`。初始化失败时回报 `webgl:false`。

`embed=1` 使用专注详情布局：隐藏全局动作导航、动作目录与模式切换，展示当前内容和观察控件；独立打开仍保留完整导航。嵌入样式在主 bundle 加载前生效，初始标题为中性的加载提示。

父窗口可复用同一个 iframe，用上述消息切换内容。关闭时发送 `{type:'fitness:visibility',visible:false}`，会取消绘制调度；重开时发送 `visible:true` 恢复，保留已上传的模型与 WebGL 上下文。选择命令及 `visibility:true` 可携带非负安全整数 `requestId`；模型在更新标签和实际绘制之后回报 `fitness:rendered`，包含相同的 `requestId` 及 `mode/exercise/muscle/structure`。父页面应等待该请求与目标相符的绘制回执后再揭开加载遮罩，不能只等 DOM 选择回执或父窗口的两帧。首次 URL 加载的 `requestId` 为 `null`；连续动画不会逐帧重复发送绘制回执。图谱和静态姿态采用按需绘制，停止交互后不持续刷新；连续动画仍保持播放。结构高亮复用几何与 GPU 缓冲，避免反复上传共享网格。

## 直接查看

双击 `index.html`，即可使用已打包的演示。请保留 `embed-bootstrap.js`、`style.css`、`demo.bundle.js` 和署名许可文件。

## 修改和运行

安装 Node.js 后，在本文件夹打开终端执行：

```sh
npm ci
npm test
npm run build
npm start
```

访问 **http://127.0.0.1:4174**。本目录使用 4174 端口，原演示仍使用 4173。修改源码后必须重新运行 `npm run build` 并刷新页面。服务仅监听本机。

## 文件用途

| 文件／目录 | 用途 |
| --- | --- |
| `assets/anatomy-atlas.json` | 当前使用的精细解剖网格，包含 700 个结构 |
| `assets/anatomy-regions.json` | 骨骼、肌肉的肢体分区，用于分配蒙皮权重 |
| `assets/anatomy-manifest.json` | 结构名称及网格清单 |
| `atlas-model.js` | 15 批网格绘制、原结构面拾取、单结构覆盖高亮、标签锚点 |
| `atlas-rig.js` | 46 根控制骨骼、蒙皮权重、手指姿态、器械和动作轨迹 |
| `muscle-data.js` | 13 组真实肌群映射、结构名称与中文标签 |
| `exercise-catalog.js`、`static-poses.js` | 25 动作目录快照与 22 个静态姿态配置 |
| `src.js` | 动作资料、播放阶段、动作要领和页面交互 |
| `index.html`、`embed-bootstrap.js`、`style.css` | 动作入口、页面结构和桌面／手机布局 |
| `demo.bundle.js` | 已构建的网页运行文件，内嵌模型与 Three.js |
| `scripts/verify-atlas.mjs` | 网格、法线朝向、尺寸和高亮检查 |
| `scripts/verify-rig.mjs` | 蒙皮、动作姿态、支撑点检查及离线预览导出 |
| `scripts/verify-static.mjs`、`scripts/verify-embed.mjs` | 静态姿态、地面边界、URL 契约和父窗口消息校验 |
| `scripts/render-model-preview.py` | 离线渲染导出数据 |
| `scripts/build-*.py`、`scripts/inspect-anatomy-source.py` | 可选的原始模型提取与分区工具 |
| `scripts/restore-obliques.py` | 从原 `.blend` 补回旧过滤器误排除的四块腹内外斜肌 |
| `previews/` | 解剖模型和动作的离线效果图 |
| `新增动作指南.md` | 后续新增动作的修改位置与检查步骤 |
| `THIRD_PARTY_LICENSES.txt`、`assets/*LICENSE*` | 资产来源、许可和署名 |

## 哪些文件需要保留

建议保存整个目录中的源码、`assets`、`scripts`、依赖清单和说明。仅修改打包后的 `demo.bundle.js` 不利于后续维护。

`node_modules` 是可通过 `npm ci` 重新安装的开发依赖。`.qa` 是检查和渲染产生的临时目录，默认没有复制进来，可重新生成。新增现有骨架能支持的动作通常不需要原始 `.blend`、Blender 或原演示的 `.qa`。

如需从源头重新提取／减面模型，才需要从 `assets/ANATOMY-SOURCE.md` 所列官方来源重新下载原始 `.blend` 和安装 bpy；对应 Python 脚本保留了处理流程。

## 检查与许可

本目录模型有 854,514 个三角面，采用人工动作轨迹与近似蒙皮。检查覆盖三个动画共 303 个姿态点、22 个独立静态姿态、13 组高亮以及 700 个原结构的拾取边界。静态器械是用于理解方向的轮廓；完整组织碰撞、专业动作审核和手机真机性能仍需后续验证。多个嵌入图谱应懒加载，离开可见区域后查看器停止绘制和推进动画。

模型来自 Z-Anatomy / BodyParts3D，改编模型和渲染图按 CC BY-SA 4.0 发布，详细署名、原始许可与修改说明见 `assets/ANATOMY-SOURCE.md`。这些许可文件应随模型一起保留。
