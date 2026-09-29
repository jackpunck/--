# 动作封面（真人图片）

知识库动作卡片 `.exercise-visual` 的封面图放在本目录，**文件名必须等于 `public/domain.js` 里的动作 id**：

```
public/assets/exercises/squat.webp        →  徒手深蹲
public/assets/exercises/pushup.webp       →  俯卧撑
public/assets/exercises/chest-press.webp  →  器械推胸
```

放好图片后运行：

```powershell
npm run covers            # 重新生成 public/exercise-covers.js
npm run covers -- --check # 只校验清单是否与目录一致（发布前用）
```

也可以直接用脚本批量抓取公共领域的真人封面（free-exercise-db，Unlicense）：

```powershell
node scripts/fetch-exercise-covers.mjs --dry-run   # 先看 25 个动作对应的数据集条目
node scripts/fetch-exercise-covers.mjs             # 下载缺失的封面，已存在的不覆盖
```

`public/exercise-covers.js` 是生成文件，不要手工编辑。**没有对应图片的动作会自动回退到原来的矢量小人图示**，所以可以一张一张慢慢补，中途不会出现 404 或空白卡片。

## 规格

| 项目 | 要求 | 原因 |
| --- | --- | --- |
| 格式 | WebP（首选）、AVIF、JPG、PNG | 同目录多格式时按上表顺序取优先级最高的一份 |
| 尺寸 | 900×600 或 1200×800（3:2） | 卡片按 `object-fit:cover` 裁切 |
| 体积 | 单张 ≤ 80 KB，25 张合计 ≤ 2 MB | 移动端首屏 |
| 构图 | 人物居中，四周各留约 10% 余量 | 卡片实际显示比例约 1.6:1，比 3:2 更扁，贴边的头或脚会被裁掉 |
| 背景 | 纯色或浅灰，避免杂乱器械和文字招牌 | 三列网格并排时观感统一 |

裁切与压缩示例（ffmpeg，需要先自行安装；也可以用 Photoshop、XnConvert 或在线工具完成同样的裁切与压缩）：

```powershell
# 裁成 3:2 并压成 WebP
ffmpeg -i 原图.jpg -vf "crop=ih*3/2:ih,scale=900:-1" -q:v 82 squat.webp
# 从视频里取动作幅度最大的一帧
ffmpeg -ss 00:00:03 -i squat.mp4 -frames:v 1 -q:v 2 frame.png
```

## 与 3D 演示的关系

封面只是入口图。点开卡片后进的仍然是 `/model/index.html?exercise=<id>` 的 3D 演示，角标 `◉ 3D 动作演示 / 姿态示意` 由 `domain.js` 的 `demo` 字段决定，与封面无关。

## 授权

每张图都要在 [docs/封面素材.md](../../../docs/封面素材.md) 登记来源 URL、授权方式和获取日期，格式参照 `精细模型与动作开发/assets/ANATOMY-SOURCE.md`。**不要使用百度图片、小红书、抖音、B 站截图，也不要截 Keep、乐刻等 App 的界面**——这类素材没有可追溯的授权，参赛作品被追问来源时很难解释。
