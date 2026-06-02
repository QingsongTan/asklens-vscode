# Ask Anytime

在 Claude Code 回答里选中看不懂的文字, 按 `Ctrl+Shift+A` (Mac: `Cmd+Shift+A`),
我们的侧栏会出一张卡片, AI 结合整段 Claude Code 会话历史给出解释, 可在卡片内追问。

## 安装与使用

1. 在 VSCode 扩展面板搜索 "Ask Anytime" 安装
2. 在设置里选择 `ask-anytime.provider` (claude / openai / ollama / deepseek) 与 `ask-anytime.model` (deepseek 推荐 `deepseek-chat` 或 `deepseek-reasoner`)
3. 命令面板执行 `Ask Anytime: 设置 API key`, 选 provider 后输入 key (走 VSCode SecretStorage, 不进 settings.json); 用 Ollama 可跳过
4. 第一次启动时按提示安装 SessionStart hook (推荐)
5. 任意编辑器选中文字 → `Ctrl+Shift+A` 出卡片

## 命令

- `Ask Anytime: 解释选中文本` (`Ctrl+Shift+A` / `Cmd+Shift+A`)
- `Ask Anytime: 导出知识文档` (侧栏右上 📤 按钮也可触发)
- `Ask Anytime: 设置 API key` (Claude / OpenAI 各一份, Ollama 不需要)
- `Ask Anytime: 清除 API key`
- `Ask Anytime: 移除 SessionStart hook`

## 设置项

- `ask-anytime.provider`: AI 提供方 (`claude` / `openai` / `ollama` / `deepseek`)
- `ask-anytime.model`: 具体模型 ID
- `ask-anytime.ollama.baseUrl`: Ollama 服务地址, 默认 `http://127.0.0.1:11434`, 远端部署时改这里
- `ask-anytime.deepseek.baseUrl`: DeepSeek API 基地址, 默认 `https://api.deepseek.com`, 走中转/镜像时改这里

## 视图说明

侧栏顶部状态条显示当前 session 视图归属; 每张卡片头部显示其归属的 sessionId 短码。
若用户在没有 Claude Code 活跃会话时创建卡片, 它会归到"无会话"桶, 状态条会显示 `当前视图: 无会话`。

## 手动验收清单(开发者用)

- [ ] 真实 Claude Code 会话里选中 → 出卡片
- [ ] 跨重启卡片仍在
- [ ] 切到另一个 Claude Code 会话 → 卡片列表跟着切
- [ ] Claude / OpenAI / Ollama 三个 provider 各跑通
- [ ] 手动移除 hook 后纯靠 mtime 兜底, 功能不退化
- [ ] 切换 VSCode workspace 后无需重启 → 卡片列表跟着切

## 已知局限 (Known Limitations)

- **多 VSCode 窗口并发**: 同一 sessionId 下并发写入卡片可能出现 last-write-wins, 中间状态丢失 (实际很少触发, 根因是 VSCode globalState 是 last-write-wins, 修需替换持久化层)。

## 卸载

执行命令 `Ask Anytime: 移除 SessionStart hook`, 然后通过 VSCode 扩展面板卸载。
