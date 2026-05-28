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

## 卸载

执行命令 `Ask Anytime: 移除 SessionStart hook`, 然后通过 VSCode 扩展面板卸载。
