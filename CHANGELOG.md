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

### 修复：Windows LAN 访问被跨源防护错误拦截

- 修改目的：允许浏览器通过 Windows 主机的局域网 IP 访问 Pi Web 后正常发送指令。
- 修改内容：API 跨源校验除比较 Next 请求 URL 外，也验证浏览器 `Origin` 是否与实际 HTTP `Host` 完全一致，兼容 Next 在生产环境中将内部请求 URL 规范为 `localhost` 的情况。
- 安全边界：仍拒绝 `sec-fetch-site: cross-site` 请求，且仅放行 Origin 与 Host（协议、主机和端口）完全匹配的请求。
- 影响范围：`lib/request-security.ts` 及其单元测试。
- 验证方式：执行 request-security 单元测试、`npm run lint` 和 `npm run build`。
- 兼容性说明：Windows 更新、构建、全局安装并重启 Pi Web 后生效。

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
