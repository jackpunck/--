# 精细解剖网格来源

来源：[Z-Anatomy / Models-of-human-anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy)，`master/Z-Anatomy.zip` 内的 `Z-Anatomy/Startup.blend`。获取日期：2026-09-19。

作者要求的署名：

- **BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan**。原作者：Kousaku OKUBO。原始数据：https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- **Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0**。Gauthier KERVYN（Design, 3D, anatomy）；Marcin ZIELINSKI（Blender add-on）。

许可依据：https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/master/License.txt

本项目改编的解剖几何数据 `anatomy-atlas.json`（包括打包文件中内嵌的同一数据）按 **CC BY-SA 4.0** 发布：https://creativecommons.org/licenses/by-sa/4.0/ 。模型预览渲染图同样采用 CC BY-SA 4.0，保留上述署名。许可原文与上游声明保存在 `Z-ANATOMY-LICENSE.txt`、`CC-BY-SA-4.0.txt`，并附于发布版 `THIRD_PARTY_LICENSES.txt`。

所做修改：提取骨骼与肌肉集合中的 700 个结构（2026-09-29 从同一份已下载原始 `.blend` 补回旧过滤器误排除的左右腹外斜肌、腹内斜肌）；去除图谱辅助标记、内脏及部分内部小结构；减少多边形；将 Z 向上改为 Y 向上并缩放；修复镜像变换的三角面朝向；量化坐标和法线；压缩数据；按 13 个主要肌群及其他肌肉、骨骼合并为 15 个绘制批次；保留每块原结构的三角面边界以便准确拾取，选择时叠加对应结构的同一真实几何；替换材质。另保留原集合的肢体分区，新增 46 根教学控制骨骼、蒙皮权重、手指姿态、三个连续动作与 22 个明确标注的静态姿态。完整入选结构清单见 `anatomy-manifest.json`，可复现处理代码见 `../scripts/build-atlas.py`、`../scripts/build-rig-regions.py`、`../scripts/restore-obliques.py` 和 `../atlas-rig.js`。改编几何与绑定后的解剖资产继续按 CC BY-SA 4.0 发布。

未提取图谱中的脑、神经、内耳或肾脏资产；没有执行下载文件的嵌入脚本，也没有使用上游应用程序代码。另下载的 `Z-Biomechanics.7z` 仅作结构检查，未进入发布资源。

源图谱没有动作骨架绑定；当前演示的骨架、蒙皮和动作由本项目新增。它们用于动作教学原型，不是经过验证的生物力学、肌肉收缩或组织碰撞模拟。本独立目录只包含当前精细人体，未包含旧程序化人体或 MakeHuman 头部。发布许可文件中保留了旧版第三方署名记录，便于追溯。


2026-09-29 斜方肌分部标识更正：已确认导入资产左右两侧的`Ascending part`与`Descending part`几何标识互换。四个记录已按实际上、下部位置纠正，原标识保存在`sourceName`；中部与所有几何数据不变。可复现更正规则见`anatomy-name-corrections.json`；依据及前后截图见`../../docs/肌肉图谱核对.md`。
