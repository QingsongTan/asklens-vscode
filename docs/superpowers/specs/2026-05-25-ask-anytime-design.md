# ask-anytime 设计文档

- **日期**: 2026-05-25
- **产品名**: `ask-anytime`
- **形态**: VSCode 扩展(与 Claude Code 共存于 VSCode 内)
- **作者**: <tanqs1216@gmail.com>
- **状态**: 设计已与用户对齐,待实现计划

---

## 1. 背景与目标

### 1.1 问题

Claude Code 的回答里时常出现用户暂时不懂的术语、缩写或概念。为了搞懂这些点,用户目前只能:

- 在 Claude Code 对话里再追问一句 —— 打断主线、污染会话上下文;
- 或者复制出来到别处搜 —— 离开心流、丢失上下文。

### 1.2 目标

让用户在不打断 Claude Code 主对话的前提下,**对回答中任意片段就地获得"结合上下文"的解释**,并能就该片段追问几轮。

### 1.3 非目标(YAGNI)

- 不替代 Claude Code 本体,不做完整对话功能;
- 不做"在 Claude Code webview 上原地悬浮浮窗" —— 受 VSCode 沙箱限制,本期通过侧栏卡片实现;
- 不做团队协作 / 批注分享。

---

## 2. 用户决策记录

| 编号 | 决策点         | 选择                                                                                       |
| ---- | -------------- | ------------------------------------------------------------------------------------------ |
| D1   | 运行环境       | VSCode 扩展里的 Claude Code                                                                |
| D2   | 交互形态       | 选中文字 → 快捷键 → 我们的侧栏卡片(因 webview 沙箱限制无法在 Claude Code 面板上右键)       |
| D3   | AI 上下文范围  | 选中文本 + 整个 Claude Code 会话历史                                                       |
| D4   | AI 调用方式    | 多模型,用户在设置里选(Claude / OpenAI / Ollama)                                            |
| D5   | 批注 UI 形态   | 卡片 + 卡内追问 + 可标记"已理解"/删除/折叠                                                 |
| D6   | 持久化策略     | 跨重启保留,按 Claude Code sessionId 分桶                                                   |
| D7   | 会话感知机制   | 双层: SessionStart hook 优先, jsonl mtime 兜底                                             |

---

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────┐
│  VSCode UI 层                                          │
│   - Activity Bar 图标 + Side View (Webview 渲染卡片流) │
│   - 快捷键命令 (默认 Ctrl+Shift+A)                     │
└────────────────────────────────────────────────────────┘
                       ↕
┌────────────────────────────────────────────────────────┐
│  扩展主进程 (Extension Host, Node.js)                  │
│   - SelectionCapture: 拿当前选区文本                   │
│   - SessionTracker: 双层感知当前 Claude 会话           │
│   - ContextBuilder: 读 jsonl 拼会话史                  │
│   - LLMRouter: 多模型适配 (Claude/OpenAI/Ollama)       │
│   - AnnotationStore: 按 sessionId 持久化卡片           │
└────────────────────────────────────────────────────────┘
                       ↕
┌────────────────────────────────────────────────────────┐
│  外部资源                                              │
│   - ~/.claude/projects/<hash>/*.jsonl (会话日志)       │
│   - ~/.claude/.ask_anytime_session.json (hook 写入)    │
│   - VSCode globalStorage             (批注持久化)      │
│   - Anthropic/OpenAI/Ollama API      (AI 推理)         │
└────────────────────────────────────────────────────────┘
```

**关键设计原则**:

- 单向数据流: UI 永远只读 store,所有变更走 command → service → store → re-render;
- 会话 ID 是唯一定位锚: 批注、上下文、显示状态全部按 sessionId 分桶;
- 模型可插拔: LLMRouter 暴露统一 `explain(messages, opts)` 接口,新增模型只加一个 adapter。

---

## 4. 核心组件

### 4.1 SessionTracker(会话感知)

#### 首层 — Hook 监听

- 安装时弹窗征求同意,向 `~/.claude/settings.json` 的 `hooks.SessionStart` 数组追加一条:

  ```json
  { "command": "node <ext-install-path>/hook/write_session.js" }
  ```

- `write_session.js` 把 stdin 收到的 sessionId / cwd / transcriptPath 写入 `~/.claude/.ask_anytime_session.json`。
- 扩展用 `fs.watch` 监听该文件,有变更立即更新当前 sessionId。
- **如果用户拒绝注入 hook**: 跳过此层,直接走兜底,功能不退化但精度略降(切会话时可能延迟 5–30 秒)。

#### 兜底 — 文件 mtime 扫描

- 当 `.ask_anytime_session.json` 不存在或超过 30 秒未刷新时启用;
- 扫描 `~/.claude/projects/<workspace-hash>/*.jsonl`,取 mtime 最新的那个文件名(去 `.jsonl`)作 sessionId;
- workspace-hash 算法须**实测对齐 Claude Code 当前实现**(已知规律: 绝对路径里非字母数字字符替换成 `-`),实现时通过实际生成的目录名反推规则,不靠猜测。

#### 对外接口

- `getCurrentSession(): { sessionId, transcriptPath, projectCwd } | null`
- EventEmitter `onSessionChanged`

### 4.2 SelectionCapture & Command

- 注册 VSCode 命令 `ask-anytime.explainSelection`,绑快捷键 `ctrl+shift+a`(可改);
- 命令触发:
  1. 读 `vscode.window.activeTextEditor.selection`;
  2. 若选区为空 → 提示"请先选中要解释的文字";
  3. 若当前无 session → 询问是否进入**纯文本解释模式**(即调用 LLM 时 `conversation=[]`,仅传选中文本本身);
  4. 调 `AnnotationStore.create({ selectedText, sessionId })` → 唤起侧栏。

### 4.3 ContextBuilder

- 输入 sessionId, transcriptPath;
- 读整个 jsonl 文件,逐行 parse;
- 每行结构 `{ type: 'user'|'assistant'|..., message: {...}, ... }`,提取 user/assistant 内容拼 `messages: [{role, content}]`;
- token 预算控制: 超过当前模型上下文 60% 时从最早消息开始截断,首条系统消息保留,截断处插入 `[earlier conversation truncated]` 占位。

### 4.4 LLMRouter & Adapters

统一接口:

```ts
interface LLMAdapter {
  explain(opts: {
    selectedText: string
    conversation: Message[]
    followUps: Message[]
    modelId: string
  }): AsyncIterable<string>
}
```

三个 adapter: `ClaudeAdapter` / `OpenAIAdapter` / `OllamaAdapter`。

配置项:

- `ask-anytime.provider` (`claude` | `openai` | `ollama`)
- `ask-anytime.model` (具体型号字符串)
- API key 用 `vscode.SecretStorage` 存,不进 settings.json。

Prompt 模板由 Router 统一拼,各 adapter 只负责把 messages 翻成自家 API 格式。流式响应原样 push 到对应卡片。

### 4.5 AnnotationStore

基于 `extensionContext.globalState`。

```ts
type Store = {
  [sessionId: string]: AnnotationCard[]
}

type AnnotationCard = {
  id: string                    // uuid
  sessionId: string
  selectedText: string
  createdAt: number
  explained: boolean            // 已得到首条解释
  resolved: boolean             // 用户标记"已理解"
  turns: { role: 'user'|'ai', text: string, ts: number }[]
}
```

方法: `create / get(sessionId) / appendTurn / appendStreamChunk / finalizeCard / markResolved / delete / clearSession`,每次写后通过 EventEmitter 通知 webview。

### 4.6 Webview UI(侧栏)

- 注册到 Activity Bar 的 View Container `ask-anytime`,内挂单个 view `ask-anytime.annotations`;
- 纯 HTML + 轻量 JS,无重型框架;
- 卡片结构: 顶部(折叠 + 选中原文 + ✓/🗑 工具) → 中部(AI 解释正文,支持基础 Markdown) → 底部(追问输入框);
- 状态: 加载 / 流式生成中 / 完成 / 出错可重试;
- session 切换 → 全量重渲染。

---

## 5. 数据流

### 5.1 启动 / 会话切换

```text
扩展激活 → SessionTracker.init()
  ├─ 检查 settings.json 是否含 hook → 未含 → 弹窗 → 同意则注入,拒绝则仅启兜底
  ├─ fs.watch .ask_anytime_session.json
  └─ 启动 mtime 兜底定时器
↓
SessionTracker.emit('session-changed', sessionId)
↓
AnnotationStore.load(sessionId)
↓
Webview 'render' → 全量重绘
```

### 5.2 解释一个词

```text
选中文字 + 按 Ctrl+Shift+A
↓
ask-anytime.explainSelection
  ├─ 拿 selectedText / currentSession
  └─ AnnotationStore.create → cardId
↓
Webview 'card-added' (loading 状态)
↓
ContextBuilder.build(sessionId) → messages[]
↓
LLMRouter.explain(...) → 流式 chunk
↓
每 chunk: store.appendStreamChunk → Webview 'card-stream'
流结束: store.finalizeCard → Webview 'card-done'
```

### 5.3 追问

```text
Webview 'follow-up' { cardId, text }
↓
store.appendTurn(user turn)
↓
LLMRouter.explain({ ..., followUps: card.turns })
↓
(同 5.2 末段流式回写)
```

### 5.4 标记已理解 / 删除

```text
✓ → Webview 'mark-resolved' → store.markResolved → 头部加灰底徽章
🗑 → Webview 'delete' → store.delete → 列表移除
```

---

## 6. 错误处理与边界

- **用户未配 API key 或 key 错**: 卡片红色提示 + "去设置"按钮(直达 VSCode 设置页)。
- **Claude Code 无活跃会话**: 弹通知,询问是否进入纯文本解释模式。
- **jsonl 超大 (>10MB)**: 流式读最后 N 条,N 据当前模型上下文窗口算。
- **某行 parse 失败**: 跳过,日志记 OutputChannel,不打断流程。
- **网络中断 / 模型超时**: 卡片显示"网络异常,点击重试",保留用户已输入的追问文本。
- **Hook 写入失败(权限)**: 兜底 mtime 监听照常工作,OutputChannel 记警告。
- **多 VSCode 窗口同时打开**: 每窗口独立扩展实例,globalStorage 全局共享,按 sessionId 隔离不冲突。
- **切换 workspace**: 重算 workspace-hash → 重定位会话 → 触发 session-changed。
- **选中文本超长(>2000 字符)**: 前 2000 + 末 200 字符截断,卡片头部提示已截断。
- **卸载扩展**: 提供命令 `ask-anytime.uninstallHook`,一键移除 settings.json 里注入的 hook。

---

## 7. 测试策略

### 7.1 单元测试 (Vitest)

- `SessionTracker`: mock fs.watch / jsonl 文件,验证 hook 优先级、mtime 兜底、workspace-hash 算法;
- `ContextBuilder`: 喂构造的 jsonl 字符串,验证消息提取、截断策略、占位插入;
- `LLMRouter`: mock adapter,验证 messages 拼装、流式 chunk 转发;
- `AnnotationStore`: CRUD、按 sessionId 分桶、事件触发;
- `write_session.js`: 独立小脚本,stdin → 文件写,单测覆盖。

### 7.2 集成测试 (`@vscode/test-electron`)

在临时 workspace + 临时 `~/.claude` 目录里跑:

1. 启动扩展 → hook 未装 → 模拟同意 → 验证 settings.json 已注入;
2. 写假 jsonl + 假 `.ask_anytime_session.json` → 触发命令 → 验证侧栏出现卡片 + mock LLM 被调;
3. 切 sessionId 文件内容 → 验证侧栏卡片列表切换;
4. 追问、标记已理解、删除各一条 case。

### 7.3 手动验收

- [ ] 真实 Claude Code 会话里选中 → 出卡片;
- [ ] 跨重启卡片仍在;
- [ ] 切到另一个 Claude Code 会话 → 卡片列表跟着切;
- [ ] Claude / OpenAI / Ollama 三个 provider 各跑通;
- [ ] 手动移除 hook 后纯靠 mtime 兜底,功能不退化。

---

## 8. 技术栈与项目结构

### 8.1 技术栈

- 语言: TypeScript 5.x
- 运行时: Node.js 20+ (VSCode 内置 Electron)
- 测试: Vitest + `@vscode/test-electron`
- 打包: esbuild
- 包管理: pnpm

### 8.2 项目结构

```text
ask-anytime/
├── package.json                # 扩展清单 (commands/views/keybindings)
├── src/
│   ├── extension.ts            # 入口
│   ├── session/
│   │   ├── SessionTracker.ts
│   │   └── hookInstaller.ts
│   ├── capture/
│   │   └── SelectionCapture.ts
│   ├── context/
│   │   └── ContextBuilder.ts
│   ├── llm/
│   │   ├── LLMRouter.ts
│   │   ├── ClaudeAdapter.ts
│   │   ├── OpenAIAdapter.ts
│   │   └── OllamaAdapter.ts
│   ├── store/
│   │   └── AnnotationStore.ts
│   └── webview/
│       ├── provider.ts
│       ├── media/
│       │   ├── main.js
│       │   └── style.css
│       └── messages.ts
├── hook/
│   └── write_session.js
└── test/
    ├── unit/
    └── integration/
```

---

## 9. 开放问题(实现阶段再敲定)

- VSCode 扩展首装时是否提供"完整向导"引导用户选 provider + 填 API key,还是按需弹通知?
- Webview Markdown 渲染选哪个轻量库(`marked` vs `markdown-it`)?
- Hook 注入时,如果用户 `~/.claude/settings.json` 不存在,是直接创建还是先提示用户?
- 三家 provider 的默认模型 ID 用哪些?(`claude-opus-4-7` / `gpt-4.1` / `llama3.1:8b`?)
