# AI 对话

## 使用

先在「个人设置 → AI 服务」配置供应商，并选择对话模型。

- 回复会逐步显示，支持标题、粗体、列表、引用、表格、行内代码、代码块和链接。
- 生成过程中可点击「停止生成」，已经收到的内容会保留。
- 输入框用 Enter 发送、Shift+Enter 换行；中文输入法选词时按 Enter 不会发送。
- 可以在输入框按 Ctrl+V 粘贴截图、图片或剪贴板中的文件，也可以直接拖入。普通文字仍在光标处粘贴，文字与文件混合粘贴时两者都会保留。
- 附件卡片显示缩略图、大小和上传状态，支持移除、失败重试和图片预览。上传完成后可只发附件；上传中或存在失败附件时，需等待、重试或移除后发送。
- 图片可通过卡片或预览窗口的「复制图片」再次复制；消息提供「复制」和最近一条回答的「重新生成」。复制消息同时提供原始 Markdown 文字和清理过的富文本，具体取决于目标应用。
- 向上阅读时停止跟随新内容，点击「回到最新」继续跟随；生成过程中仍可输入下一条草稿。
- 你可以直接说「帮我创建一个居家三分化训练计划」「把腿部训练的深蹲改成两组」「删除当前训练计划」。支持工具调用的模型会执行操作，并展示来自服务器的结果。AI 保存训练计划时，会按训练循环和日期范围安排训练任务。
- 也可以要求「记录今天午餐」「修改今天这餐的份量」「删除今天重复的饮食记录」。只有明确要求记账或修改时才保存；普通食谱建议和餐食编辑器中的估算仍是草稿。

训练、日程和饮食操作只作用于当前登录账号。AI 更新计划会调整范围内未来未完成的关联训练日期；删除计划会清理未来未完成的关联训练。过去和已完成记录、动作快照、实际重量继续保留。操作结果与训练和饮食页面读取同一份记录。详见 [训练日程](训练日程.md)。

附件每条消息最多 6 个、每个最多 8 MB，支持 JPG、PNG、WebP、GIF、PDF、TXT、Markdown、CSV、JSON。不把本地文件路径或网页 HTML 中的图片地址当成附件读取。网页只能处理浏览器在粘贴事件中提供的实际文件；若浏览器没有提供文件，请用拖入或上传按钮。复制图片需要浏览器开放图片剪贴板能力，通常在 localhost 或 HTTPS 页面可用。

待发送附件按账号和会话分别管理，切换会话不会串到另一个输入框；离开账号会取消上传并清理本页预览。尚未发送的文字、文件对象及上传进度只保留在当前页面内存，刷新前请先发送需要保存的内容。

## 数据与重试

修改和删除使用服务端版本检查。若另一设备已经更新计划，旧版本操作会失败，模型需重新读取后再处理。本机尚未同步的计划、日程、饮食及相关冲突也不能被聊天操作直接覆盖。日程操作检查最新记录版本，避免在模型思考期间覆盖新安排。

每次用户提问使用固定的 `requestId`。同一轮失败后重试或重新生成沿用该 ID，避免计划、日程或饮食操作执行两遍。重新生成的是最近一条回答；需要再次修改计划时发送新的要求。一轮最多成功修改一次固定计划，也可操作日程或多餐；每个目标的已完成变更会保存回执。读取及修正无效参数可以在同轮继续进行。操作回执表示实际保存结果，普通 Markdown 文字不会被当作操作执行。

点击停止或关闭连接会取消仍在生成的上游请求。**已经完成的计划、日程和饮食操作不会因停止回复而撤销**；点击顶部同步状态，再打开训练页面可查看结果。

## 渲染

Markdown 使用本地 Marked 和 DOMPurify，版本与许可见 [`public/vendor/README.md`](../public/vendor/README.md)。解析后按允许的标签、属性和链接协议清理内容，不执行模型输出的脚本或内嵌 HTML 行为。远程 Markdown 图片不自动加载；用户主动上传的附件仍通过原有鉴权接口显示。

流式显示使用真实到达的数据，合并短时间内的渲染更新；历史消息和已存在的文本节点尽量保留，代码块横向滚动和文本选区不会因每段输出而重建。输入框保留节点、草稿和光标状态，使用明确的字号、行高和有上限的自动高度。

交互参考本地 Cherry Studio 的 `docs/references/chat/composer-rich-clipboard.md`、`components/composer/paste/` 与 `components/chat/messages/stream/`。按本项目的原生网页结构实现，没有引入 Electron 文件系统接口或复制 Cherry Studio 源码。

## 接口

`POST /api/ai` 的聊天请求增加：

```json
{
  "task": "chat",
  "stream": true,
  "requestId": "每个用户提问唯一且重试保持一致的 ID",
  "messages": [{"role": "user", "content": "帮我创建训练计划"}],
  "context": {}
}
```

鉴权沿用同源 Cookie 和 `X-Fitness-User`。成功开始后以 `text/event-stream` 返回：

| 事件 | 内容 |
| --- | --- |
| `meta` | `model`、`provider` |
| `delta` | 本次增加的 `text` |
| `tool_result` | 工具名称 `name`、结果 `ok`、可读说明 `message`，以及实际计划、日程或餐食记录等字段 |
| `done` | 完整 `content`、模型信息、操作结果 `toolResults`，可选推理上下文 |
| `error` | 可显示的 `error`；流式开始后的错误通过此事件返回 |

餐食、规划和未指定 `stream:true` 的原有请求继续使用 JSON 响应。供应商须支持对应的流式协议；数据操作还要求模型支持工具调用。兼容接口如果只返回完整 JSON，应用能显示完整回复，但无法让该上游产生真正的逐步输出。

服务端提供 `get_training_plan`、`create_training_plan`、`update_training_plan` 和 `delete_training_plan`。工具参数限定为动作目录内的动作及受校验的训练日、组数、次数、休息时间等，此外提供日程读取与任务增删改、今日饮食读取与增删改工具；它们校验训练日期、餐食份量、营养字段和记录版本。不提供任意文件、数据库或账号管理能力。

## 验证

```powershell
npm test
npm run check
node scripts/qa-chat.mjs
node scripts/qa-composer.mjs
node scripts/qa-calendar.mjs
```

自动验证使用模拟流式上游、临时 SQLite 和独立 Edge 测试环境。它验证传输、渲染和真实记录的增删改流程；供应商实际支持情况和模型是否正确理解指令，需要使用所选模型检验。

## 协议依据

- [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling)：流式工具参数与结果回传。
- [Anthropic Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)：内容块、工具参数增量与思考签名。
- [Gemini GenerateContent](https://ai.google.dev/api/generate-content#FunctionDeclaration)：流式端点和函数 JSON Schema。
- [Gemini Thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)：同轮工具调用中的签名保留。
