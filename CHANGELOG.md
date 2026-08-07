# 更新记录

本文件记录此 fork（`robinwlive/pi-web`）相对上游项目的功能修改、行为调整和修复。每一次准备提交到本仓库的代码变更，都应同步更新本文件。

## 记录规则

每个提交或一组紧密相关的提交使用一个小节，按时间倒序记录。提交前，将变更内容写入最上方的 `Unreleased`；提交后，将该标题改为提交日期和简短说明，并立即新建一个空的 `Unreleased` 小节。提交短哈希可在提交完成后作为附加信息补充，但不要在同一次提交中写入自身哈希。

每条记录应包含：

- 修改目的：解决什么使用问题。
- 修改内容：新增、调整或修复了什么行为。
- 影响范围：修改了哪些文件或用户可见区域。
- 验证方式：执行过哪些检查或手动验证。
- 兼容性说明：是否需要重新构建、重启服务或迁移数据。

不要仅写“优化”“修复问题”等无法判断实际行为的描述。涉及用户操作时，应写清触发条件和最终结果。

## Unreleased

### 新增：Agent Dashboard 看板

- 修改目的：在多个工作区和多个会话同时运行时，集中查看待处理会话并快速进入或继续处理。
- 修改内容：左侧 Session Sidebar 顶部新增 `Agent Board` 入口；看板左上角提供 `Back to Pi Web`，同行显示运行中、待阅读、总会话和看板会话数量。所有会话在同一白板网格中排列，不按工作区分组；卡片标题区域点击即可在原白板内展开或收起，点击卡片外的白板空白处会收起当前展开项。展开后的卡片主体直接嵌入现有 `ChatWindow`，复用完整消息、流式输出、模型/工具/思考等级选择、附件、插入与队列等 Pi Web 原生交互。
- 标题、状态与排序：卡片标题固定为“状态槽位 -> 工作区 -> 会话名称 -> 图钉”四段。运行中的会话显示 Pi Web accent 蓝色旋转圆环；已完成但未读的会话显示蓝色方块；普通已读会话保留空状态槽位但不显示图标。图钉采用 Lucide 标准 Pin 图形，作为标题区右侧图标切换 Pin / Unpin，保证会话不自动离开看板。整个看板按“未读完成 -> 运行中 -> 已置顶但已读 -> 普通已读”全局排序，同一状态按更新时间从新到旧排列。
- 工具栏与边界：`Back to Pi Web` 收紧为 `Back`；统计栏以运行环、未读方块和 `on-board/total sessions` 紧凑显示。折叠卡片使用更深的中性边框、面板背景和轻微阴影，以便在白板背景中明确识别；展开卡片继续使用 accent 蓝色焦点边框。
- 可见性规则：浏览器本地记录每个已读会话的 `readAt`。运行中、未读、置顶或近期活跃的会话显示在看板；已读会话在阅读后 30 分钟内没有新的会话活动、未重新运行且未置顶时自动从看板移除。新一轮运行或后台完成会清除旧阅读时间并重新进入运行/未读状态。
- 响应式：桌面使用白板网格，展开卡片会挤压其他卡片但不会遮挡；手机使用单列上下布局，实时对话区域和输入框纵向排列。
- 影响范围：`components/AgentBoard.tsx`、`components/AppShell.tsx`、`components/SessionSidebar.tsx`。
- 验证方式：执行 `npm run lint` 和 `npm run build`；手动验证应覆盖 Dashboard 往返、运行/未读状态、卡片展开、SSE 输出、发送 prompt、排序和手机布局。
- 兼容性说明：复用现有 session、Agent API、运行状态 SSE 与本地未读标记；更新后需要重新构建并重启 Pi Web。

### 修复：Windows LAN 访问被跨源防护错误拦截

- 修改目的：允许浏览器通过 Windows 主机的局域网 IP 访问 Pi Web 后正常发送指令。
- 修改内容：API 跨源校验除比较 Next 请求 URL 外，也验证浏览器 `Origin` 是否与实际 HTTP `Host` 完全一致，兼容 Next 在生产环境中将内部请求 URL 规范为 `localhost` 的情况。
- 安全边界：仍拒绝 `sec-fetch-site: cross-site` 请求，且仅放行 Origin 与 Host（协议、主机和端口）完全匹配的请求。
- 影响范围：`lib/request-security.ts` 及其单元测试。
- 验证方式：执行 request-security 单元测试、`npm run lint` 和 `npm run build`。
- 兼容性说明：Windows 更新、构建、全局安装并重启 Pi Web 后生效。

### 调整：Provider 模型拉取的 API 类型继承自 Provider 配置

- 修改目的：通过 `Fetch models` 批量导入的新模型，其 API 类型应与所属 Provider 配置的 API 类型保持一致，而不是固定写死为 `openai-responses`。
- 修改内容：将 `additions.push` 中的 `api: "openai-responses"` 改为 `api: provider.api ?? "openai-completions"`，即读取当前 Provider 的 `api` 字段；未配置时回退到 `openai-completions`（与新建 Provider 的默认值一致）。
- 影响范围：仅影响 `Fetch models` 新追加的模型；已有模型和手动新增模型不变。
- 验证方式：已执行 `npm run lint` 和 `npm run build`。
- 兼容性说明：已存在的同名模型不会被覆盖。

### 调整：Provider 模型拉取的默认模型配置

- 修改目的：让通过 `Fetch models` 批量导入的新模型默认匹配 OpenAI Responses 和多模态推理模型的常用配置。
- 修改内容：自动追加的新模型默认使用 `openai-responses`，启用 Reasoning / thinking 与 Image input，并设置 `contextWindow` 为 `1050000`、`maxTokens` 为 `128000`。
- 影响范围：仅影响 `Fetch models` 新追加的模型；已有模型和手动新增模型不变。
- 验证方式：需要执行 `npm run lint` 和 `npm run build`。
- 兼容性说明：已存在的同名模型不会被覆盖，因此需要重新拉取或手动编辑已有模型才能应用这些默认值。

### 新增：从 OpenAI-compatible Provider 拉取模型列表

- 修改目的：新增自定义 Provider 后，可以直接从 Provider 的 `/models` 接口批量导入模型，避免手动逐个添加模型 ID。
- 修改内容：Provider 详情页右上角新增 `Fetch models` 按钮；后端根据当前 Provider 的 `baseUrl` 与 `apiKey` 请求 OpenAI-compatible `GET /models`，解析 `data[].id` 和 `display_name`，并将缺失模型追加到当前 Provider 配置中。
- 影响范围：`components/ModelsConfig.tsx`、`app/api/models-config/fetch-models/route.ts`。
- 验证方式：需要执行 `npm run lint` 和 `npm run build`；手动验证应覆盖成功拉取、重复模型不重复添加、接口错误展示和保存配置。
- 兼容性说明：该功能只追加模型，不会自动覆盖已有模型配置，也不会自动保存；用户检查结果后仍需点击 `Save` 写入 `models.json`。

## 2026-07-30 - 模型调用计时与整轮性能汇总

提交：`feat: add model response timing metrics`

- 修改目的：准确观察每次模型调用从请求、首字到完成的延迟与生成效率，并在一条用户指令触发多轮模型和工具调用时查看整轮性能。
- 修改内容：每次已完成的模型消息显示首字到完成的毫秒级时间区间、TTFT、generation、call 和基于官方 output token 计算的 `t/s`；折叠过程后的最终答案显示本轮第一次模型首字到最终完成的累计区间，同时保留最后一次调用自己的性能指标。
- 汇总口径：最终答案后新增 `Model summary`，汇总 measured interactions、工具调用、token/cache、首次响应区间、workflow span、模型总生成时间、加权 `t/s`，以及 TTFT、Generation、Call 的平均值、P50、最短和最长；样本不少于 20 次时额外显示 P95。
- 持久化与生命周期：服务端按会话将计时写入独立的 `.pi-web-timings.json` sidecar，每个会话最多保留 500 条；刷新、浏览器切换和 SSE 重连后可恢复。Fork 仅复制目标分支包含的消息计时，删除会话时同步删除 sidecar，关闭服务前刷新待写数据。
- 影响范围：模型事件计时状态、RPC 会话生命周期、session 读取与分支处理、assistant usage 行和最终答案汇总；不修改 pi JSONL 主格式，也不改变 HTML/JSON 导出内容。
- 验证方式：全量单元测试 `141/141`、TypeScript、ESLint、production build 和 staged diff 检查均通过；生产服务重启后返回 HTTP 200，并确认最新 bundle 已加载。
- 兼容性说明：无需迁移旧浏览器数据；更新后需要重新构建并重启 Pi Web。已有会话会从后续新产生的模型调用开始积累服务端计时。

## 2026-07-25 - Windows 生产构建修复

提交：`fix: constrain output tracing root on Windows`

- 修改目的：避免 Next.js 在 Windows 上遍历受保护的 `C:\\Users\\<user>\\Application Data` 兼容性链接，导致 `EPERM: operation not permitted, scandir` 并使生产构建缺少 `.next` 产物。
- 修改内容：`npm run build` 改为跨平台包装器；仅在 Windows 构建期间将 `HOME`、`USERPROFILE`、`APPDATA` 和 `LOCALAPPDATA` 指向项目内临时 `.buildhome/`。同时显式限制 Next.js 的 `outputFileTracingRoot` 为项目目录。
- 影响范围：仅影响构建期环境；不改变运行时的 pi 数据目录、Web UI 或 API 行为。
- 验证方式：已在 macOS 执行 `npm run lint` 和 `npm run build`；Windows 端需拉取更新后重新构建验证。
- 兼容性说明：Windows 用户应通过 `npm run build` 使用包装器；`npm run build:raw` 仅用于排查，不应作为常规 Windows 构建命令。

## 2026-07-25 - 输入历史回填

提交：`feat: add input history recall`

### 新增：输入历史回填

- 修改目的：让用户可以复用当前会话中已经发送过的输入，而不需要重新输入或从聊天记录中复制。
- 修改内容：当输入框为空且没有正在生成回复时，按 `ArrowUp` 打开输入历史菜单；继续使用 `ArrowUp` 和 `ArrowDown` 选择记录，按 `Enter` 将选中的内容填回输入框。填入后允许继续编辑，下一次按 `Enter` 才会发送。
- 排序与焦点规则：历史按时间从旧到新显示，最新输入位于列表底部；首次按 `ArrowUp` 打开菜单时，焦点默认落在最新输入。
- 数据范围：只读取当前会话的非空文本用户消息；相同文本只保留一条；最多显示最近 50 条不同输入。
- 影响范围：
  - `components/ChatInput.tsx`：新增历史菜单、键盘导航、选中回填和关闭逻辑。
  - `components/ChatWindow.tsx`：从当前会话消息中整理输入历史，并传入输入组件。
- 验证方式：已执行 `npm run lint` 和 `npm run build`。手动验证应覆盖打开历史、上下选择、回填后编辑、再次回车发送，以及最新记录位于列表底部。
- 兼容性说明：修改后需执行 `npm run build`、`npm install -g .`，并重启 `pi-web` 服务，生产页面才会加载新版本。
