# 精细模型与动作开发

这是当前精细人体及后续动作开发的独立工作目录。从原演示复制整理，模型数据、骨架、动作、页面、构建依赖清单和验证工具都在本目录内。可以把整个文件夹复制到其他位置，不依赖旁边的 `3d-demo` 或其 `.qa`。

当前目录的 **25 个动作均已接入统一教学演示**：24 个往复动作，以及平板支撑的持续等长支撑。全部动作使用同一副含 54 根控制骨骼的人体，按动作配置连续轨迹、握持点、支撑点与器械轮廓。

全部动作使用统一的“发力变化”教学模型：每块肌群按本动作完整行程的最小／最大示意值归一化，颜色由浅到深变化。页面显示本程相对百分比、较强／较轻位置及持续稳定提示。暂停、拖动与播放共享姿态进度；新增动画可通过 `activity-profiles.js` 配置肌群和变化曲线。当前网页不再加载 OpenSim 力表，不显示牛顿值，也不运行肌力求解。完整规则、后续动作接入及历史工具说明见 [动态颜色说明](动态颜色说明.md)。

主应用使用 `/model/index.html?exercise=squat&embed=1` 嵌入；动作参数覆盖 `exercise-catalog.js` 的 25 个 ID。未知 ID 显示未收录提示和解剖姿态，不会冒充深蹲演示。完整接口与许可保留要求见 [`../docs/动作接入.md`](../docs/动作接入.md)。

肌肉图谱入口：

- `/model/index.html?mode=atlas&muscle=chest&embed=1`：高亮整个肌群。
- `/model/index.html?mode=atlas&structure=Serratus%20anterior%20muscle.l&embed=1`：准确高亮原图谱的一块结构。
- 增加 `compact=1`：用于聊天卡片的简化布局，保留旋转、视角、缩放、名称和许可。肌肉链接自动拉近对应的上半身或下半身。

13 个肌群 ID 为 `chest,biceps,triceps,deltoids,lats,traps,core,obliques,quads,hamstrings,glutes,calves,forearms`。`core` 的高亮范围是腹直肌与腹横肌，腹内外斜肌使用 `obliques`。点击任何可见结构，按命中三角面的原始网格记录显示实际名称；常见肌肉有中文名称，其他结构保留原图谱英文名称及左右侧标识。单结构选择使用该结构真实几何的透视高亮，使深层肌肉也可见，界面明确显示“透视高亮”；点击仍按真实表面命中。不会把单块肌肉替换成附近的大肌群。

嵌入消息仅接受同源父窗口。支持 `fitness:exercise`、`fitness:muscle`、`fitness:structure`；肌肉选中发出 `fitness:muscle-selected`，含 `muscle`（可能为空）、`name`、`structure` 与 `mode`。原有 `fitness:ready`、`fitness:selected` 保持兼容。`ready` 在首帧绘制后回报，并附 `mode`、`muscle`、`structure`；图谱模式的 `exercise` 为 `null`。初始化失败时回报 `webgl:false`。

`embed=1` 使用专注详情布局：隐藏全局动作导航、动作目录与模式切换，展示当前内容和观察控件；独立打开仍保留完整导航。嵌入样式在主 bundle 加载前生效，初始标题为中性的加载提示。

父窗口可复用同一个 iframe，用上述消息切换内容。关闭时发送 `{type:'fitness:visibility',visible:false}`，会取消绘制调度；重开时发送 `visible:true` 恢复，保留已上传的模型与 WebGL 上下文。选择命令及 `visibility:true` 可携带非负安全整数 `requestId`；模型在更新标签和实际绘制之后回报 `fitness:rendered`，包含相同的 `requestId` 及 `mode/exercise/muscle/structure`。父页面应等待该请求与目标相符的绘制回执后再揭开加载遮罩，不能只等 DOM 选择回执或父窗口的两帧。首次 URL 加载的 `requestId` 为 `null`；连续动画不会逐帧重复发送绘制回执。图谱和暂停的动作采用按需绘制，停止交互后不持续刷新；连续动画仍保持播放。结构高亮复用几何与 GPU 缓冲，避免反复上传共享网格。

手部规则、已校正动作和验证方式见 [手部动作校正](手部动作校正.md)。

## 观察操作

- 左键拖动旋转，右键拖动平移。
- 滚轮沿光标位置放大或缩小，可直接对准手部等细节。
- 双指捏合缩放和平移；加减按钮缩放当前观察区域。
- 点击“立体／正面／侧面／背面”恢复对应视角，窗口尺寸变化会保留当前观察位置。

使用 Three.js [OrbitControls 的 zoomToCursor](https://threejs.org/docs/pages/OrbitControls.html#zoomToCursor)，不需要每次滚轮操作重新拾取整个人体网格。`scripts/qa-model-navigation.mjs`（根目录）验证动作页、图谱及紧凑视图中的指针定位缩放、平移、旋转、视角恢复和尺寸变化。

## 直接查看

双击 `index.html`，即可使用已打包的演示。请保留 `embed-bootstrap.js`、`model-loader.js`、`style.css`、`demo.offline.js` 和署名许可文件。

通过 HTTP 打开时加载 `demo.bundle.js`、`atlas.worker.js` 和 `assets/anatomy-data.bin`，在 Worker 中解码完整网格，再把缓冲区转交主线程；浏览器限制 Worker 时自动回退。二进制与原始 JSON 中压缩资产逐字节相同，坐标、法线和索引保持不变。`file://` 使用内嵌全部资产的离线包，两种方式均由 `npm run build` 生成。

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
| `grip-poses.js` | 手腕对齐、横杆握持约束、按手指配置的环握姿态 |
| `atlas-rig.js` | 54 根控制骨骼、蒙皮权重、手指姿态、器械和动作轨迹 |
| `forearm-bones.js`、`scripts/verify-wrists.mjs` | 从源网格提取尺桡骨端点，检查刚性骨骼的腕部连接、前臂旋转与腕部支持带 |
| `arm-frames.js`、`scripts/verify-elbows.mjs` | 上臂和前臂共用肘部弯曲轴，检查接近伸直时的稳定性、肌肉表面连续性与拖动进度的一致性 |
| `dual-quaternion-skinning.js` | 双四元数蒙皮，统一画面、法线、阴影、高亮与 CPU 拾取的变形 |
| `muscle-data.js` | 13 组真实肌群映射、结构名称与中文标签 |
| `exercise-catalog.js`、`motion-poses.js` | 25 动作目录与新增 22 个动作的轨迹配置 |
| `src.js` | 动作资料、播放阶段、动作要领和页面交互 |
| `index.html`、`embed-bootstrap.js`、`style.css` | 动作入口、页面结构和桌面／手机布局 |
| `demo.bundle.js`、`atlas.worker.js`、`assets/anatomy-data.bin` | 网页运行文件、后台解码器与独立压缩网格 |
| `model-loader.js`、`demo.offline.js` | 按访问方式选择入口，以及内嵌全部资产的离线包 |
| `atlas-decode.js`、`scripts/verify-decode.mjs` | 共享无损解码及全部结构坐标、法线、索引一致性检查 |
| `scripts/verify-atlas.mjs` | 网格、法线朝向、尺寸和高亮检查 |
| `scripts/verify-rig.mjs` | 蒙皮、动作姿态、支撑点检查及离线预览导出 |
| `scripts/verify-static.mjs`、`scripts/verify-embed.mjs` | 新增连续轨迹、地面边界、URL 契约和父窗口消息校验 |
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

肩胛下肌、冈上肌、冈下肌和大小圆肌按结构名称分配附着权重，两侧使用相同规则，避免抬臂时把肩胛端拉成腋下尖刺。动画使用双四元数混合刚体关节变换，减少普通线性混合造成的弯曲塌缩；原始顶点和单骨骼控制的骨组织形状保留。算法参考 [Kavan 等人的双四元数蒙皮研究](https://users.cs.utah.edu/~ladislav/dq/index.html)，实现仅支持本项目无缩放的刚体骨骼变换。

肘部旋转由肩、肘、腕的共同弯曲平面计算，避免上臂和前臂各自选择旋转路径而把肌肉拧成一束。接近伸直时平滑使用相对胸部的参考方向，以稳定弯曲轴；计算不依赖上一帧，因此拖动进度、倒放和切换动作得到相同姿态。握持姿态和器械接触点沿用原有约束。

前臂增加中段与远端旋转控制，肌肉沿前臂分段平滑转向，避免把握持所需的旋转挤在腕部。腕部屈肌／伸肌支持带整体跟随手掌，保持原始环带形状。尺骨和桡骨分别保持刚性：远端对齐旋转后的腕部端点，近端指向肘部端点；当前 25 个动作的连续采样中，近端残差不超过 0.005 模型单位。前臂旋转与屈腕分别处理；生理解剖背景参考[前臂旋转轴的体内运动学研究](https://pubmed.ncbi.nlm.nih.gov/20483515/)，当前端点配准仍为显示近似。

项目根目录的 `node scripts/qa-grips.mjs --joints` 为所有动作输出手掌、手背及肩肘或髋膝踝的近景；可用 `--ids=lat-pulldown,pullup` 缩小范围。模型目录的 `node scripts/audit-deformation.mjs` 检查全部肌肉网格在动作起点、中点、终点的局部边长变化，输出到项目 `.qa`，供定位拉伸异常；边长变化本身不是碰撞或损伤判定。

`scripts/verify-skinning.mjs` 检查关节截面、全部静止顶点、25 个动作中的骨骼刚性，以及抬臂时肩胛端的连续附着。在项目根目录运行 `node scripts/qa-skinning-gpu.mjs`，可用独立浏览器检查 WebGL 与 CPU 变形是否一致；`node scripts/qa-model-deformation.mjs` 输出所有动作在起点、中点、终点的正面、背面和侧面截图。浏览器脚本需要 Playwright，可用 `QA_PLAYWRIGHT` 指定已有安装路径。这些检查不等同于完整软组织碰撞求解。

本目录模型有 854,514 个三角面，采用人工动作轨迹与近似蒙皮。检查覆盖原三个动画共 303 个姿态点、新增动作共 2,222 个姿态点、13 组高亮以及 700 个原结构的拾取边界。器械是用于理解方向的轮廓；完整组织碰撞、专业动作审核和手机真机性能仍需后续验证。多个嵌入图谱应懒加载，离开可见区域后查看器停止绘制和推进动画。

模型来自 Z-Anatomy / BodyParts3D，改编模型和渲染图按 CC BY-SA 4.0 发布，详细署名、原始许可与修改说明见 `assets/ANATOMY-SOURCE.md`。这些许可文件应随模型一起保留。
