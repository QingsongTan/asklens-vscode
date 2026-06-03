# Ask Anytime

> 在 Claude Code 对话里随时提问——选中文字，一键获得结合完整会话上下文的 AI 解释，并将知识沉淀为你的专属文档。

English | 中文

---

## 为什么需要 Ask Anytime？

使用 Claude Code 编程时，你一定遇到过这些场景：

- Claude 的回答里出现了一个你不太熟悉的术语或代码片段
- 你想问清楚，却只能重新开一个对话——**上下文全丢了**
- 你切到浏览器搜索，得到的是泛泛的解释，而不是针对**你当前这段代码**的说明
- 这一次搞懂了，下次又忘了，知识没有沉淀

**Ask Anytime 解决的就是这个问题。**

选中任何你看不懂的文字，按一个快捷键，侧栏立刻弹出一张卡片——AI 会读取你与 Claude Code 的完整对话历史，给出贴合当前上下文的精准解释。可以继续追问，解释完毕后还能一键导出为结构化知识文档。

---

## 核心功能

### ⚡ 一键提问，零摩擦

选中文字 → `Ctrl+Alt+C` → 侧栏出卡片。全程不离开编辑器，不切换 App，不丢失上下文。

### 🧠 基于完整会话上下文的解释

Ask Anytime 会自动读取你当前 Claude Code 会话的完整对话记录（最多 100K tokens），让 AI 的解释紧扣你的代码和问题背景，而不是给出千篇一律的教科书定义。

### 💬 卡片内多轮追问

每张卡片支持无限次追问，AI 记住对话历史，层层深入，直到你真正搞懂。

### 📚 一键导出知识文档

点击侧栏导出按钮，所有卡片自动整合为结构化 Markdown 文档；也可让 AI 进一步将多张卡片合成一篇系统性知识文章，形成可复用的个人知识库。

### 🔌 支持 13 个 AI Provider

无论你偏好哪家 AI 服务，开箱即用：

| Provider | 推荐模型 |
| --- | --- |
| Claude (Anthropic) | claude-opus-4, claude-sonnet-4 |
| OpenAI | gpt-4o, gpt-4.1, o3 |
| DeepSeek | deepseek-v4-pro, deepseek-chat |
| 通义千问 (Qwen) | qwen3-max, qwen-plus |
| Kimi (月之暗面) | kimi-k2, moonshot-v1-128k |
| GLM (智谱) | glm-4.6, glm-4-plus |
| 豆包 (字节) | 自定义推理点 ID |
| 混元 (腾讯) | hunyuan-large, hunyuan-turbo |
| MiniMax | MiniMax-M2 |
| Yi (零一万物) | yi-large |
| 阶跃 (Step) | step-2-16k |
| 文心 (百度千帆) | ernie-4.0-turbo |
| **Ollama（本地）** | llama3.1, qwen2.5, qwen3 等 |

> Ollama 支持完全本地运行，**数据不出本机**，适合对隐私有高要求的场景。

### 🔐 安全的 API Key 管理

Key 存储于 VSCode SecretStorage，不写入 settings.json，不会误提交到 Git。

### 💾 卡片跨会话持久化

卡片按 Claude Code sessionId 分组保存，重启 VSCode 后仍然存在，切换 Claude Code 会话时侧栏自动切换视图。

---

## 快速开始

### 安装

在 VSCode 扩展面板搜索 **Ask Anytime** 安装，或从 [Releases](../../releases) 下载 `.vsix` 手动安装。

### 配置

1. 打开命令面板 `Ctrl+Shift+P`，执行 **Ask Anytime: 切换 Provider / 模型** 选择 AI 服务
2. 执行 **Ask Anytime: 设置 API key** 输入对应 Key（Ollama 用户跳过）
3. 首次启动时按提示安装 SessionStart Hook（**强烈推荐**，用于精准感知 Claude Code 会话）

### 使用

```text
选中文字  →  Ctrl+Alt+C  →  侧栏查看 AI 解释  →  追问  →  导出知识
```

在 Claude Code 的回答窗口中选中文字时，先 `Ctrl+C` 复制，再按快捷键触发（VSCode API 限制，无法直接读取 webview 选区）。

---

## 工作原理

```text
用户选中文字
     ↓
读取 Claude Code 会话日志（~/.claude/projects/*/**.jsonl）
     ↓
将 [会话历史 + 选中文字 + 追问历史] 发送给 AI Provider
     ↓
流式返回解释，渲染到侧栏卡片（支持 Markdown）
     ↓
（可选）导出所有卡片为知识文档 / AI 合成文章
```

SessionStart Hook 安装在 `~/.claude/settings.json`，每次 Claude Code 开启新会话时自动写入当前 sessionId，Ask Anytime 据此定位对应的对话日志文件。

---

## 截图

> _（即将添加）_

---

## 开发

```bash
git clone https://github.com/your-username/ask-anytime
cd ask-anytime
npm install
npm run build        # 编译
npm run test         # 单元测试
npm run watch        # 开发模式（F5 启动调试）
```

打包发布：

```bash
npx @vscode/vsce package --no-dependencies
```

---

## 已知局限

- **多 VSCode 窗口并发**：同一 sessionId 下并发写入可能出现数据覆盖（实际极少触发）
- **Webview 选区**：在 Claude Code 回答窗口中需先 Ctrl+C 再触发，无法直接读取 webview 选区（VSCode API 限制）

---

## 贡献

欢迎提 Issue 和 PR。提交前请运行 `npm run test` 确保单元测试通过。

---

## License

MIT

---

## English

**Ask Anytime** is a VSCode extension that lets you instantly explain any selected text using your full Claude Code conversation as context — with one keyboard shortcut, no context switching.

### The Problem

When working with Claude Code, you often encounter unfamiliar terms or code snippets in Claude's responses. Asking for clarification means starting a new chat and re-explaining everything from scratch. The context is lost, and so is your flow.

### The Solution

Select any text → `Ctrl+Alt+C` → A card appears in the sidebar with a context-aware explanation powered by your full Claude Code conversation history. Follow up with questions inside the card, then export everything as a structured knowledge document.

### Key Features

- **Context-aware explanations** — reads your Claude Code session transcript (up to 100K tokens)
- **Multi-turn Q&A** — unlimited follow-up questions per card
- **13 AI providers** — Claude, OpenAI, DeepSeek, Qwen, Kimi, GLM, and more; full local support via Ollama
- **Knowledge export** — export cards as Markdown or let AI synthesize them into a structured article
- **Persistent cards** — cards survive VSCode restarts, organized by Claude Code session
- **Secure key storage** — API keys stored in VSCode SecretStorage, never in settings files

### Quick Start

1. Install the extension
2. Run `Ask Anytime: Switch Provider / Model` to select your AI service
3. Run `Ask Anytime: Set API Key` to enter your key
4. Install the SessionStart Hook when prompted (recommended)
5. Select text → `Ctrl+Alt+C` → Done
