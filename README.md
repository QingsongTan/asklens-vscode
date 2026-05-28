# Ask Anytime

在 Claude Code 回答里选中看不懂的文字, 按 `Ctrl+Shift+A` (Mac: `Cmd+Shift+A`),
我们的侧栏会出一张卡片, AI 结合整段 Claude Code 会话历史给出解释, 可在卡片内追问。

## 安装与使用

1. 在 VSCode 扩展面板搜索 "Ask Anytime" 安装
2. 在设置里选择 `ask-anytime.provider` (claude / openai / ollama) 与 `ask-anytime.model`
3. 通过命令面板 `Ask Anytime: 设置 API key` (即将上线) 或编辑 secrets 配置 key
4. 第一次启动时按提示安装 SessionStart hook (推荐)

## 设置项

- `ask-anytime.provider`: AI 提供方
- `ask-anytime.model`: 具体模型 ID

## 手动验收清单(开发者用)

- [ ] 真实 Claude Code 会话里选中 → 出卡片
- [ ] 跨重启卡片仍在
- [ ] 切到另一个 Claude Code 会话 → 卡片列表跟着切
- [ ] Claude / OpenAI / Ollama 三个 provider 各跑通
- [ ] 手动移除 hook 后纯靠 mtime 兜底, 功能不退化

## 已知局限 (Known Limitations)

- **大型会话日志 (>10MB)**: 当前一次性读入内存, 后续版本会改流式只读最后 N 条。
- **切换 workspace**: 扩展激活时绑定当前 workspace, 切换 VSCode 工作区后需重启窗口才能正确识别新会话目录。
- **流式期间切换 Claude Code 会话**: 正在生成的卡片可能丢失剩余 chunk, 重试可恢复。
- **NO_SESSION 模式**: 未检测到 Claude Code 会话时创建的卡片归属"无会话"桶, 不会出现在真实会话视图中。
- **扩展版本升级后**: settings.json 里的 hook 命令路径包含扩展版本号目录, 升级后可能失效, 需手动 `Ask Anytime: 移除 SessionStart hook` 再重装。
- **多 VSCode 窗口并发**: 同一 sessionId 下并发写入卡片可能出现 last-write-wins, 中间状态丢失 (实际很少触发)。
- **Ollama baseUrl**: 当前写死 `http://127.0.0.1:11434`, 远端 Ollama 暂不支持配置, 后续版本可加。

## 卸载

执行命令 `Ask Anytime: 移除 SessionStart hook`, 然后通过 VSCode 扩展面板卸载。
