# ask-anytime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 VSCode 扩展 `ask-anytime`,与官方 Claude Code 扩展共存,让用户在 Claude Code 回答里选中看不懂的文字 → 快捷键 → 自家侧栏出卡片,AI 结合整段 Claude Code 会话历史给出解释,卡片内可追问,按 sessionId 持久化。

**Architecture:** 单 VSCode 扩展 (TypeScript + esbuild)。六个核心模块:`SessionTracker` 双层感知会话 (SessionStart hook 优先 / jsonl mtime 兜底)、`SelectionCapture` 命令、`ContextBuilder` 读会话日志、`LLMRouter` 多模型适配、`AnnotationStore` 按 sessionId 分桶持久化、`Webview` 侧栏卡片 UI。一个独立 Node 小脚本 `hook/write_session.js` 由 Claude Code SessionStart hook 调用。所有变更走单向数据流。

**Tech Stack:** TypeScript 5.x · Node 20 · VSCode Extension API · esbuild · Vitest · `@vscode/test-electron` · pnpm。

**Spec 参照:** `docs/superpowers/specs/2026-05-25-ask-anytime-design.md`。

---

## 文件结构(任务规划锚点)

```text
ask-anytime/
├── package.json                           # Task 1
├── tsconfig.json                          # Task 1
├── vitest.config.ts                       # Task 1
├── esbuild.config.mjs                     # Task 1
├── .gitignore                             # Task 1
├── .vscodeignore                          # Task 1
├── src/
│   ├── extension.ts                       # Task 11 (入口,串联各模块)
│   ├── store/
│   │   └── AnnotationStore.ts             # Task 2
│   ├── context/
│   │   └── ContextBuilder.ts              # Task 3
│   ├── session/
│   │   ├── hookInstaller.ts               # Task 5
│   │   ├── workspaceHash.ts               # Task 6 (子模块,实测对齐)
│   │   └── SessionTracker.ts              # Task 6
│   ├── llm/
│   │   ├── types.ts                       # Task 7a
│   │   ├── promptBuilder.ts               # Task 7a
│   │   ├── LLMRouter.ts                   # Task 7a
│   │   ├── ClaudeAdapter.ts               # Task 7b
│   │   ├── OpenAIAdapter.ts               # Task 7c
│   │   └── OllamaAdapter.ts               # Task 7d
│   ├── capture/
│   │   └── SelectionCapture.ts            # Task 8
│   └── webview/
│       ├── messages.ts                    # Task 9 (主进程<->webview 协议)
│       ├── AnnotationViewProvider.ts      # Task 9
│       └── media/
│           ├── main.js                    # Task 10
│           └── style.css                  # Task 10
├── hook/
│   └── write_session.js                   # Task 4
└── test/
    ├── unit/
    │   ├── AnnotationStore.test.ts        # Task 2
    │   ├── ContextBuilder.test.ts         # Task 3
    │   ├── write_session.test.ts          # Task 4
    │   ├── hookInstaller.test.ts          # Task 5
    │   ├── workspaceHash.test.ts          # Task 6
    │   ├── SessionTracker.test.ts         # Task 6
    │   ├── promptBuilder.test.ts          # Task 7a
    │   ├── LLMRouter.test.ts              # Task 7a
    │   ├── ClaudeAdapter.test.ts          # Task 7b
    │   ├── OpenAIAdapter.test.ts          # Task 7c
    │   └── OllamaAdapter.test.ts          # Task 7d
    └── integration/
        └── e2e.test.ts                    # Task 12
```

每个文件单一职责。`SessionTracker` 拆出 `workspaceHash.ts` 子模块,因为它要"实测对齐 Claude Code 实现",值得独立测试。

---

## Task 1: 项目骨架与构建链路

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `esbuild.config.mjs`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `src/extension.ts` (占位)
- Create: `test/unit/smoke.test.ts`

- [ ] **Step 1: 写 `package.json` (扩展清单 + 依赖 + 脚本)**

```json
{
  "name": "ask-anytime",
  "displayName": "Ask Anytime",
  "description": "在 Claude Code 回答里选中文字, 一键获得结合会话上下文的 AI 解释",
  "version": "0.0.1",
  "publisher": "tanqs",
  "engines": { "vscode": "^1.95.0" },
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "ask-anytime.explainSelection", "title": "Ask Anytime: 解释选中文本" },
      { "command": "ask-anytime.uninstallHook", "title": "Ask Anytime: 移除 SessionStart hook" }
    ],
    "keybindings": [
      { "command": "ask-anytime.explainSelection", "key": "ctrl+shift+a", "mac": "cmd+shift+a", "when": "editorHasSelection" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "ask-anytime", "title": "Ask Anytime", "icon": "$(comment-discussion)" }
      ]
    },
    "views": {
      "ask-anytime": [
        { "id": "ask-anytime.annotations", "name": "批注", "type": "webview" }
      ]
    },
    "configuration": {
      "title": "Ask Anytime",
      "properties": {
        "ask-anytime.provider": { "type": "string", "enum": ["claude", "openai", "ollama"], "default": "claude" },
        "ask-anytime.model": { "type": "string", "default": "claude-opus-4-7" }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.95.0",
    "@vscode/test-electron": "^2.4.1",
    "esbuild": "^0.24.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "rootDir": "."
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
})
```

- [ ] **Step 4: 写 `esbuild.config.mjs`**

```js
import { build, context } from 'esbuild'

const opts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
}

if (process.argv.includes('--watch')) {
  const ctx = await context(opts)
  await ctx.watch()
} else {
  await build(opts)
}
```

- [ ] **Step 5: 写 `.gitignore` / `.vscodeignore`**

`.gitignore`:

```text
node_modules
dist
.vscode-test
*.vsix
.DS_Store
```

`.vscodeignore`:

```text
test/**
*.config.*
tsconfig.json
.git*
docs/**
```

- [ ] **Step 6: 写占位 `src/extension.ts`**

```ts
import * as vscode from 'vscode'

export function activate(_context: vscode.ExtensionContext): void {
  console.log('[ask-anytime] activated')
}

export function deactivate(): void {
  console.log('[ask-anytime] deactivated')
}
```

- [ ] **Step 7: 写 smoke 测试 `test/unit/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('1 + 1 === 2', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 8: 安装依赖并跑测试 + 构建**

Run:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Expected: install 完成、typecheck 无错、smoke 测试 PASS、`dist/extension.js` 生成。

- [ ] **Step 9: 初始化 git 并 commit**

```bash
git init
git add -A
git commit -m "chore: 初始化项目骨架与构建链路"
```

---

## Task 2: AnnotationStore (按 sessionId 分桶的持久化)

**Files:**

- Create: `src/store/AnnotationStore.ts`
- Create: `test/unit/AnnotationStore.test.ts`

**职责:** 卡片 CRUD + 流式 chunk 追加 + 按 sessionId 分桶 + EventEmitter 通知。底层用一个传入的 `Persister` 接口,实测时用内存实现,生产用 `vscode.Memento`。

- [ ] **Step 1: 写失败测试 `test/unit/AnnotationStore.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { AnnotationStore, type Persister } from '../../src/store/AnnotationStore'

class MemPersister implements Persister {
  private data: Record<string, unknown> = {}
  get<T>(key: string, defaultValue: T): T {
    return (this.data[key] as T) ?? defaultValue
  }
  async update(key: string, value: unknown): Promise<void> {
    this.data[key] = value
  }
}

describe('AnnotationStore', () => {
  let p: MemPersister
  let store: AnnotationStore
  beforeEach(() => {
    p = new MemPersister()
    store = new AnnotationStore(p)
  })

  it('create 返回带 id 的卡片并归到对应 sessionId', async () => {
    const card = await store.create({ sessionId: 's1', selectedText: 'foo' })
    expect(card.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(card.sessionId).toBe('s1')
    expect(card.selectedText).toBe('foo')
    expect(card.turns).toEqual([])
    expect(card.explained).toBe(false)
    expect(card.resolved).toBe(false)
    expect(store.get('s1')).toHaveLength(1)
  })

  it('get 不同 sessionId 互相隔离', async () => {
    await store.create({ sessionId: 's1', selectedText: 'a' })
    await store.create({ sessionId: 's2', selectedText: 'b' })
    expect(store.get('s1')).toHaveLength(1)
    expect(store.get('s2')).toHaveLength(1)
    expect(store.get('s3')).toHaveLength(0)
  })

  it('appendStreamChunk 累加到最后一条 AI turn', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.appendStreamChunk(c.id, 'Hel')
    await store.appendStreamChunk(c.id, 'lo')
    const got = store.get('s1')[0]
    expect(got.turns).toEqual([{ role: 'ai', text: 'Hello', ts: expect.any(Number) }])
  })

  it('finalizeCard 设置 explained=true', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.appendStreamChunk(c.id, 'done')
    await store.finalizeCard(c.id)
    expect(store.get('s1')[0].explained).toBe(true)
  })

  it('appendTurn 追加 user turn 并新开一个空 ai turn 占位', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.appendStreamChunk(c.id, 'A1')
    await store.finalizeCard(c.id)
    await store.appendTurn(c.id, { role: 'user', text: 'follow' })
    const turns = store.get('s1')[0].turns
    expect(turns).toHaveLength(3)
    expect(turns[1]).toMatchObject({ role: 'user', text: 'follow' })
    expect(turns[2]).toMatchObject({ role: 'ai', text: '' })
  })

  it('markResolved 切换 resolved', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.markResolved(c.id, true)
    expect(store.get('s1')[0].resolved).toBe(true)
  })

  it('delete 移除卡片', async () => {
    const c = await store.create({ sessionId: 's1', selectedText: 'x' })
    await store.delete(c.id)
    expect(store.get('s1')).toHaveLength(0)
  })

  it('onChange 在 create 时触发', async () => {
    const calls: string[] = []
    store.onChange((sid) => calls.push(sid))
    await store.create({ sessionId: 's1', selectedText: 'x' })
    expect(calls).toEqual(['s1'])
  })

  it('findCard 能跨 session 按 id 查到', async () => {
    await store.create({ sessionId: 's1', selectedText: 'a' })
    const c2 = await store.create({ sessionId: 's2', selectedText: 'b' })
    expect(store.findCard(c2.id)?.selectedText).toBe('b')
    expect(store.findCard('not-exist')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认全部 FAIL**

Run: `pnpm test test/unit/AnnotationStore.test.ts`
Expected: 9 个 case 全部 FAIL,提示 `Cannot find module '../../src/store/AnnotationStore'`。

- [ ] **Step 3: 实现 `src/store/AnnotationStore.ts`**

```ts
import { randomUUID } from 'node:crypto'

export interface Persister {
  get<T>(key: string, defaultValue: T): T
  update(key: string, value: unknown): Promise<void>
}

export type Turn = { role: 'user' | 'ai'; text: string; ts: number }

export type AnnotationCard = {
  id: string
  sessionId: string
  selectedText: string
  createdAt: number
  explained: boolean
  resolved: boolean
  turns: Turn[]
}

type StoreShape = { [sessionId: string]: AnnotationCard[] }

const KEY = 'ask-anytime.annotations.v1'

export class AnnotationStore {
  private listeners: Array<(sid: string) => void> = []
  constructor(private persister: Persister) {}

  private read(): StoreShape {
    return this.persister.get<StoreShape>(KEY, {})
  }

  private async write(s: StoreShape, touched: string): Promise<void> {
    await this.persister.update(KEY, s)
    for (const l of this.listeners) l(touched)
  }

  onChange(l: (sid: string) => void): void {
    this.listeners.push(l)
  }

  get(sessionId: string): AnnotationCard[] {
    return this.read()[sessionId] ?? []
  }

  async create(opts: { sessionId: string; selectedText: string }): Promise<AnnotationCard> {
    const card: AnnotationCard = {
      id: randomUUID(),
      sessionId: opts.sessionId,
      selectedText: opts.selectedText,
      createdAt: Date.now(),
      explained: false,
      resolved: false,
      turns: [{ role: 'ai', text: '', ts: Date.now() }],
    }
    const s = this.read()
    s[opts.sessionId] = [card, ...(s[opts.sessionId] ?? [])]
    await this.write(s, opts.sessionId)
    return card
  }

  private mutate(cardId: string, fn: (c: AnnotationCard) => void): Promise<void> {
    const s = this.read()
    for (const sid of Object.keys(s)) {
      const idx = s[sid].findIndex((c) => c.id === cardId)
      if (idx >= 0) {
        fn(s[sid][idx])
        return this.write(s, sid)
      }
    }
    return Promise.resolve()
  }

  appendStreamChunk(cardId: string, chunk: string): Promise<void> {
    return this.mutate(cardId, (c) => {
      const last = c.turns[c.turns.length - 1]
      if (last && last.role === 'ai') last.text += chunk
      else c.turns.push({ role: 'ai', text: chunk, ts: Date.now() })
    })
  }

  finalizeCard(cardId: string): Promise<void> {
    return this.mutate(cardId, (c) => {
      c.explained = true
    })
  }

  appendTurn(cardId: string, turn: { role: 'user' | 'ai'; text: string }): Promise<void> {
    return this.mutate(cardId, (c) => {
      c.turns.push({ ...turn, ts: Date.now() })
      if (turn.role === 'user') c.turns.push({ role: 'ai', text: '', ts: Date.now() })
    })
  }

  markResolved(cardId: string, resolved: boolean): Promise<void> {
    return this.mutate(cardId, (c) => {
      c.resolved = resolved
    })
  }

  async delete(cardId: string): Promise<void> {
    const s = this.read()
    for (const sid of Object.keys(s)) {
      const before = s[sid].length
      s[sid] = s[sid].filter((c) => c.id !== cardId)
      if (s[sid].length !== before) {
        await this.write(s, sid)
        return
      }
    }
  }

  findCard(cardId: string): AnnotationCard | undefined {
    const s = this.read()
    for (const sid of Object.keys(s)) {
      const f = s[sid].find((c) => c.id === cardId)
      if (f) return f
    }
    return undefined
  }
}
```

- [ ] **Step 4: 跑测试确认全部 PASS**

Run: `pnpm test test/unit/AnnotationStore.test.ts`
Expected: 9 个 case 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/store test/unit/AnnotationStore.test.ts
git commit -m "feat(store): AnnotationStore 按 sessionId 分桶的持久化"
```

---

## Task 3: ContextBuilder (读 jsonl, 提取消息, token 截断)

**Files:**

- Create: `src/llm/types.ts` (本任务只放 `Message`,Task 7a 会再扩充)
- Create: `src/context/ContextBuilder.ts`
- Create: `test/unit/ContextBuilder.test.ts`

**职责:** 输入 transcriptPath, 读整个 jsonl, 提取 user/assistant 内容, 按预算截断。`Message` 类型放进 `src/llm/types.ts`,后续 LLM 模块也引用它,避免类型重复。

- [ ] **Step 1: 写失败测试 `test/unit/ContextBuilder.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildContext } from '../../src/context/ContextBuilder'

describe('ContextBuilder', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctx-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeJsonl(rows: object[]): string {
    const p = join(dir, 'a.jsonl')
    writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'))
    return p
  }

  it('提取 user/assistant 消息, 顺序保持', async () => {
    const p = writeJsonl([
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: 'hello' } },
      { type: 'user', message: { role: 'user', content: 'how' } },
    ])
    const msgs = await buildContext(p, { maxTokens: 10_000 })
    expect(msgs).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'how' },
    ])
  })

  it('忽略未知 type', async () => {
    const p = writeJsonl([
      { type: 'system_init', meta: 1 },
      { type: 'user', message: { role: 'user', content: 'hi' } },
    ])
    const msgs = await buildContext(p, { maxTokens: 10_000 })
    expect(msgs).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('跳过 parse 失败的行', async () => {
    const p = join(dir, 'b.jsonl')
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'a' } }),
      '{ not json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'b' } }),
    ].join('\n'))
    const msgs = await buildContext(p, { maxTokens: 10_000 })
    expect(msgs.map((m) => m.content)).toEqual(['a', 'b'])
  })

  it('超出预算时从头截断并插入占位', async () => {
    const longStr = 'x'.repeat(400) // 约 100 token
    const p = writeJsonl([
      { type: 'user', message: { role: 'user', content: longStr } },
      { type: 'assistant', message: { role: 'assistant', content: longStr } },
      { type: 'user', message: { role: 'user', content: 'keep me' } },
    ])
    const msgs = await buildContext(p, { maxTokens: 50 })
    expect(msgs[0]).toEqual({ role: 'system', content: '[earlier conversation truncated]' })
    expect(msgs[msgs.length - 1].content).toBe('keep me')
  })

  it('content 是 array (Claude 工具调用格式) 时只取 text 块', async () => {
    const p = writeJsonl([
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', name: 'Bash', input: {} },
          ],
        },
      },
    ])
    const msgs = await buildContext(p, { maxTokens: 10_000 })
    expect(msgs).toEqual([{ role: 'assistant', content: 'hello' }])
  })

  it('文件不存在抛错', async () => {
    await expect(buildContext(join(dir, 'nope.jsonl'), { maxTokens: 100 })).rejects.toThrow()
  })
})
```

注: 文件顶部需补 `import { afterEach } from 'vitest'` —— 写测试时一起加上。

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `pnpm test test/unit/ContextBuilder.test.ts`
Expected: 全部 FAIL, 提示模块不存在。

- [ ] **Step 3a: 先建 `src/llm/types.ts` 放 `Message` 类型**

```ts
export type Message = { role: 'system' | 'user' | 'assistant'; content: string }
```

- [ ] **Step 3b: 实现 `src/context/ContextBuilder.ts`**

```ts
import { readFile } from 'node:fs/promises'
import type { Message } from '../llm/types'

type RawLine = {
  type?: string
  message?: {
    role?: string
    content?: string | Array<{ type: string; text?: string }>
  }
}

const estimateTokens = (s: string): number => Math.ceil(s.length / 4)

export async function buildContext(
  transcriptPath: string,
  opts: { maxTokens: number },
): Promise<Message[]> {
  const raw = await readFile(transcriptPath, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const msgs: Message[] = []

  for (const line of lines) {
    let obj: RawLine
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.type !== 'user' && obj.type !== 'assistant') continue
    const m = obj.message
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
    const content = extractText(m.content)
    if (content === '') continue
    msgs.push({ role: m.role, content })
  }

  const budget = Math.floor(opts.maxTokens * 0.6)
  let total = msgs.reduce((s, m) => s + estimateTokens(m.content), 0)
  if (total <= budget) return msgs

  let truncated = false
  while (msgs.length > 1 && total > budget) {
    const dropped = msgs.shift()!
    total -= estimateTokens(dropped.content)
    truncated = true
  }
  if (truncated) {
    msgs.unshift({ role: 'system', content: '[earlier conversation truncated]' })
  }
  return msgs
}

function extractText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('\n')
      .trim()
  }
  return ''
}
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `pnpm test test/unit/ContextBuilder.test.ts`
Expected: 6 个 case 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/context test/unit/ContextBuilder.test.ts
git commit -m "feat(context): ContextBuilder 读 jsonl 并按预算截断"
```

---

## Task 4: hook 脚本 `write_session.js`

**Files:**

- Create: `hook/write_session.js`
- Create: `test/unit/write_session.test.ts`

**职责:** 由 Claude Code SessionStart hook 调用,从 stdin 读 JSON,写到 `~/.claude/.ask_anytime_session.json`。

Claude Code hook 通过 stdin 传 JSON,常含 `session_id`、`cwd`、`transcript_path`。我们只需写 hook 看到的原始字段加时间戳。

- [ ] **Step 1: 写失败测试 `test/unit/write_session.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HOOK = resolve(__dirname, '../../hook/write_session.js')

function run(input: string, homeDir: string): Promise<number> {
  return new Promise((resolveP) => {
    const p = spawn('node', [HOOK], { env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir } })
    p.stdin.end(input)
    p.on('close', (code) => resolveP(code ?? 1))
  })
}

describe('write_session.js', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('合法 JSON 输入 → 写入 .ask_anytime_session.json', async () => {
    const code = await run(JSON.stringify({ session_id: 'abc', cwd: '/x', transcript_path: '/x/abc.jsonl' }), home)
    expect(code).toBe(0)
    const out = join(home, '.claude', '.ask_anytime_session.json')
    expect(existsSync(out)).toBe(true)
    const data = JSON.parse(readFileSync(out, 'utf8'))
    expect(data).toMatchObject({
      sessionId: 'abc',
      cwd: '/x',
      transcriptPath: '/x/abc.jsonl',
    })
    expect(data.updatedAt).toEqual(expect.any(Number))
  })

  it('非法 JSON 输入 → 退出 0 不抛错 (不打断 Claude Code)', async () => {
    const code = await run('not json', home)
    expect(code).toBe(0)
  })

  it('~/.claude 不存在时自动创建', async () => {
    rmSync(join(home, '.claude'), { recursive: true, force: true })
    const code = await run(JSON.stringify({ session_id: 'x' }), home)
    expect(code).toBe(0)
    expect(existsSync(join(home, '.claude'))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `pnpm test test/unit/write_session.test.ts`
Expected: FAIL, hook 文件不存在。

- [ ] **Step 3: 实现 `hook/write_session.js`**

```js
#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let payload = {}
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
  const dir = path.join(home, '.claude')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    process.exit(0)
  }

  const out = {
    sessionId: payload.session_id ?? null,
    cwd: payload.cwd ?? null,
    transcriptPath: payload.transcript_path ?? null,
    updatedAt: Date.now(),
  }
  try {
    fs.writeFileSync(path.join(dir, '.ask_anytime_session.json'), JSON.stringify(out))
  } catch {
    /* ignore — 永不打断 Claude Code */
  }
  process.exit(0)
})
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `pnpm test test/unit/write_session.test.ts`
Expected: 3 个 case 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add hook/ test/unit/write_session.test.ts
git commit -m "feat(hook): write_session.js 将 Claude Code 当前会话写入文件"
```

---

## Task 5: hookInstaller (装/卸 SessionStart hook 到 settings.json)

**Files:**

- Create: `src/session/hookInstaller.ts`
- Create: `test/unit/hookInstaller.test.ts`

**职责:** 读 `~/.claude/settings.json`,在 `hooks.SessionStart` 数组中追加/移除我们的 hook 条目,**保留用户已有 hooks**,失败不抛硬错。

- [ ] **Step 1: 写失败测试 `test/unit/hookInstaller.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isHookInstalled, installHook, uninstallHook, HOOK_TAG } from '../../src/session/hookInstaller'

describe('hookInstaller', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('settings.json 不存在时, install 自动创建并写入', async () => {
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    const p = join(home, '.claude', 'settings.json')
    expect(existsSync(p)).toBe(true)
    const cfg = JSON.parse(readFileSync(p, 'utf8'))
    expect(cfg.hooks.SessionStart).toContainEqual(
      expect.objectContaining({ command: expect.stringContaining('write_session.js'), tag: HOOK_TAG }),
    )
  })

  it('保留用户已有的 SessionStart hooks', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ command: 'echo hi' }] },
    }))
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toHaveLength(2)
    expect(cfg.hooks.SessionStart[0]).toEqual({ command: 'echo hi' })
  })

  it('重复 install 幂等(不会重复追加)', async () => {
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    const cfg = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart.filter((h: { tag?: string }) => h.tag === HOOK_TAG)).toHaveLength(1)
  })

  it('uninstall 仅移除带我们 tag 的条目', async () => {
    const dir = join(home, '.claude')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { command: 'echo hi' },
          { command: 'node /ext/hook/write_session.js', tag: HOOK_TAG },
        ],
      },
    }))
    await uninstallHook({ home })
    const cfg = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(cfg.hooks.SessionStart).toEqual([{ command: 'echo hi' }])
  })

  it('isHookInstalled 反映现状', async () => {
    expect(await isHookInstalled({ home })).toBe(false)
    await installHook({ home, hookScriptPath: '/ext/hook/write_session.js' })
    expect(await isHookInstalled({ home })).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `pnpm test test/unit/hookInstaller.test.ts`

- [ ] **Step 3: 实现 `src/session/hookInstaller.ts`**

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const HOOK_TAG = 'ask-anytime/write_session/v1'

type HookEntry = { command: string; tag?: string }
type Settings = { hooks?: { SessionStart?: HookEntry[] } }

function settingsPath(home: string): { dir: string; file: string } {
  const dir = join(home, '.claude')
  return { dir, file: join(dir, 'settings.json') }
}

async function readSettings(home: string): Promise<Settings> {
  const { file } = settingsPath(home)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return {}
  }
}

async function writeSettings(home: string, s: Settings): Promise<void> {
  const { dir, file } = settingsPath(home)
  await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify(s, null, 2))
}

export async function isHookInstalled(opts: { home: string }): Promise<boolean> {
  const s = await readSettings(opts.home)
  return (s.hooks?.SessionStart ?? []).some((h) => h.tag === HOOK_TAG)
}

export async function installHook(opts: { home: string; hookScriptPath: string }): Promise<void> {
  const s = await readSettings(opts.home)
  s.hooks ??= {}
  s.hooks.SessionStart ??= []
  if (s.hooks.SessionStart.some((h) => h.tag === HOOK_TAG)) return
  s.hooks.SessionStart.push({
    command: `node "${opts.hookScriptPath}"`,
    tag: HOOK_TAG,
  })
  await writeSettings(opts.home, s)
}

export async function uninstallHook(opts: { home: string }): Promise<void> {
  const s = await readSettings(opts.home)
  if (!s.hooks?.SessionStart) return
  s.hooks.SessionStart = s.hooks.SessionStart.filter((h) => h.tag !== HOOK_TAG)
  await writeSettings(opts.home, s)
}
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `pnpm test test/unit/hookInstaller.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/session/hookInstaller.ts test/unit/hookInstaller.test.ts
git commit -m "feat(session): hookInstaller 装/卸 SessionStart hook 且幂等"
```

---

## Task 6: SessionTracker (双层会话感知)

包含两个子模块: `workspaceHash.ts` (兜底用) 和 `SessionTracker.ts` (主类)。

**Files:**

- Create: `src/session/workspaceHash.ts`
- Create: `src/session/SessionTracker.ts`
- Create: `test/unit/workspaceHash.test.ts`
- Create: `test/unit/SessionTracker.test.ts`

### 6.1 workspaceHash

- [ ] **Step 1: 写失败测试 `test/unit/workspaceHash.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { workspaceHash } from '../../src/session/workspaceHash'

describe('workspaceHash', () => {
  it('POSIX 绝对路径: 把 / 替换成 -', () => {
    expect(workspaceHash('/home/u/proj')).toBe('-home-u-proj')
  })

  it('Windows 路径: 把 \\ 和 : 替换成 -', () => {
    expect(workspaceHash('C:\\Users\\me\\proj')).toBe('C--Users-me-proj')
  })

  it('Windows 正斜杠路径', () => {
    expect(workspaceHash('C:/Users/me/proj')).toBe('C--Users-me-proj')
  })

  it('结尾斜杠/反斜杠会带上一个 - (与 Claude Code 实测对齐)', () => {
    expect(workspaceHash('/home/u/proj/')).toBe('-home-u-proj-')
  })

  it('Unicode 路径里的非 ASCII 字符保留 (Claude Code 不动它们)', () => {
    expect(workspaceHash('/home/张三/proj')).toBe('-home-张三-proj')
  })
})
```

注: 这里的期望值是**根据 spec §4.1 描述与 Claude Code 已知规律推断**。**首次本机实测**时请运行真实 Claude Code 在 `/home/u/proj` 与 `C:\Users\me\proj` 各开一次会话,查看 `~/.claude/projects/` 下实际生成的目录名,若与本测试不符,先改这里的期望值再改实现 —— 实测才是真相。

- [ ] **Step 2: 跑测试 FAIL**

Run: `pnpm test test/unit/workspaceHash.test.ts`

- [ ] **Step 3: 实现 `src/session/workspaceHash.ts`**

```ts
export function workspaceHash(absPath: string): string {
  return absPath.replace(/[\\/:]/g, '-')
}
```

- [ ] **Step 4: 测试 PASS**

Run: `pnpm test test/unit/workspaceHash.test.ts`

### 6.2 SessionTracker

- [ ] **Step 5: 写失败测试 `test/unit/SessionTracker.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionTracker } from '../../src/session/SessionTracker'

describe('SessionTracker', () => {
  let home: string
  let projectsDir: string
  let tracker: SessionTracker

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'home-'))
    projectsDir = join(home, '.claude', 'projects')
    mkdirSync(projectsDir, { recursive: true })
  })
  afterEach(() => {
    tracker?.dispose()
    rmSync(home, { recursive: true, force: true })
  })

  it('hook 文件存在时, 立即拿到 sessionId', async () => {
    writeFileSync(join(home, '.claude', '.ask_anytime_session.json'), JSON.stringify({
      sessionId: 'hook-sid',
      transcriptPath: '/p/hook-sid.jsonl',
      cwd: '/p',
      updatedAt: Date.now(),
    }))
    tracker = new SessionTracker({ home, workspace: '/p', staleMs: 30_000 })
    await tracker.init()
    expect(tracker.getCurrentSession()).toMatchObject({ sessionId: 'hook-sid' })
  })

  it('hook 文件过期时, 用 mtime 最新的 jsonl 兜底', async () => {
    const dir = join(projectsDir, '-p')
    mkdirSync(dir)
    writeFileSync(join(dir, 'old.jsonl'), '')
    writeFileSync(join(dir, 'new.jsonl'), '')
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(dir, 'old.jsonl'), old, old)
    tracker = new SessionTracker({ home, workspace: '/p', staleMs: 1 })
    await tracker.init()
    expect(tracker.getCurrentSession()?.sessionId).toBe('new')
  })

  it('hook 文件变更触发 onSessionChanged', async () => {
    tracker = new SessionTracker({ home, workspace: '/p', staleMs: 30_000 })
    await tracker.init()
    const seen: string[] = []
    tracker.onSessionChanged((s) => { if (s) seen.push(s.sessionId) })
    writeFileSync(join(home, '.claude', '.ask_anytime_session.json'), JSON.stringify({
      sessionId: 'changed',
      transcriptPath: '/p/changed.jsonl',
      cwd: '/p',
      updatedAt: Date.now(),
    }))
    await vi.waitFor(() => expect(seen).toContain('changed'), { timeout: 2000 })
  })

  it('hook 与兜底都无数据时, getCurrentSession 返回 null', async () => {
    tracker = new SessionTracker({ home, workspace: '/empty', staleMs: 30_000 })
    await tracker.init()
    expect(tracker.getCurrentSession()).toBeNull()
  })
})
```

- [ ] **Step 6: 跑测试 FAIL**

Run: `pnpm test test/unit/SessionTracker.test.ts`

- [ ] **Step 7: 实现 `src/session/SessionTracker.ts`**

```ts
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { workspaceHash } from './workspaceHash'

export type Session = { sessionId: string; transcriptPath: string; cwd: string }

type Listener = (s: Session | null) => void

export class SessionTracker {
  private current: Session | null = null
  private listeners: Listener[] = []
  private watcher?: FSWatcher
  private hookFile: string

  constructor(private opts: { home: string; workspace: string; staleMs: number }) {
    this.hookFile = join(opts.home, '.claude', '.ask_anytime_session.json')
  }

  async init(): Promise<void> {
    await this.refresh()
    try {
      this.watcher = watch(join(this.opts.home, '.claude'), (_event, file) => {
        if (file === '.ask_anytime_session.json') void this.refresh()
      })
    } catch {
      /* 目录不存在等情况无视 */
    }
  }

  getCurrentSession(): Session | null {
    return this.current
  }

  onSessionChanged(l: Listener): void {
    this.listeners.push(l)
  }

  dispose(): void {
    this.watcher?.close()
    this.listeners = []
  }

  private async refresh(): Promise<void> {
    const next = (await this.fromHook()) ?? (await this.fromMtime())
    if (next?.sessionId !== this.current?.sessionId) {
      this.current = next
      for (const l of this.listeners) l(next)
    }
  }

  private async fromHook(): Promise<Session | null> {
    if (!existsSync(this.hookFile)) return null
    try {
      const data = JSON.parse(await readFile(this.hookFile, 'utf8'))
      if (typeof data.updatedAt === 'number' && Date.now() - data.updatedAt > this.opts.staleMs) {
        return null
      }
      if (!data.sessionId || !data.transcriptPath) return null
      return { sessionId: data.sessionId, transcriptPath: data.transcriptPath, cwd: data.cwd ?? '' }
    } catch {
      return null
    }
  }

  private async fromMtime(): Promise<Session | null> {
    const dir = join(this.opts.home, '.claude', 'projects', workspaceHash(this.opts.workspace))
    if (!existsSync(dir)) return null
    const entries = await readdir(dir)
    const jsonls = entries.filter((e) => e.endsWith('.jsonl'))
    if (jsonls.length === 0) return null
    const stats = await Promise.all(jsonls.map(async (f) => ({
      f,
      mtime: (await stat(join(dir, f))).mtimeMs,
    })))
    stats.sort((a, b) => b.mtime - a.mtime)
    const file = stats[0].f
    return {
      sessionId: file.replace(/\.jsonl$/, ''),
      transcriptPath: join(dir, file),
      cwd: this.opts.workspace,
    }
  }
}
```

- [ ] **Step 8: 测试 PASS**

Run: `pnpm test test/unit/SessionTracker.test.ts`

- [ ] **Step 9: Commit**

```bash
git add src/session/SessionTracker.ts src/session/workspaceHash.ts test/unit/SessionTracker.test.ts test/unit/workspaceHash.test.ts
git commit -m "feat(session): SessionTracker 双层会话感知 (hook + mtime 兜底)"
```

---

## Task 7a: LLMRouter + Prompt + 接口

**Files:**

- Modify: `src/llm/types.ts` (Task 3 已建,此处追加)
- Create: `src/llm/promptBuilder.ts`
- Create: `src/llm/LLMRouter.ts`
- Create: `test/unit/promptBuilder.test.ts`
- Create: `test/unit/LLMRouter.test.ts`

- [ ] **Step 1: 扩充 `src/llm/types.ts`(在 Task 3 已写好的 `Message` 基础上追加)**

文件最终内容:

```ts
export type Message = { role: 'system' | 'user' | 'assistant'; content: string }

export type ExplainOptions = {
  selectedText: string
  conversation: Message[]
  followUps: { role: 'user' | 'ai'; text: string }[]
  modelId: string
}

export interface LLMAdapter {
  explain(opts: ExplainOptions): AsyncIterable<string>
}

export type ProviderId = 'claude' | 'openai' | 'ollama'
```

- [ ] **Step 2: 写 promptBuilder 失败测试 `test/unit/promptBuilder.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildMessages, SYSTEM_PROMPT } from '../../src/llm/promptBuilder'

describe('promptBuilder.buildMessages', () => {
  it('系统消息首位 + 会话史 + 选中文本问题', () => {
    const msgs = buildMessages({
      selectedText: 'retry',
      conversation: [
        { role: 'user', content: 'how to do x' },
        { role: 'assistant', content: 'use retry()' },
      ],
      followUps: [],
      modelId: 'm',
    })
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT })
    expect(msgs.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('retry'),
    })
    expect(msgs.at(-1)!.content).toContain('结合上文')
  })

  it('followUps 转成 user/assistant 交替消息追加', () => {
    const msgs = buildMessages({
      selectedText: 'x',
      conversation: [],
      followUps: [
        { role: 'ai', text: '第一次解释' },
        { role: 'user', text: '继续' },
      ],
      modelId: 'm',
    })
    const tail = msgs.slice(-3)
    expect(tail[0].role).toBe('user')        // selectedText 问题
    expect(tail[1]).toEqual({ role: 'assistant', content: '第一次解释' })
    expect(tail[2]).toEqual({ role: 'user', content: '继续' })
  })

  it('选中文本会被截断到 2200 字符', () => {
    const long = 'a'.repeat(5000)
    const msgs = buildMessages({ selectedText: long, conversation: [], followUps: [], modelId: 'm' })
    expect(msgs.at(-1)!.content.length).toBeLessThan(3000)
    expect(msgs.at(-1)!.content).toContain('[已截断')
  })
})
```

- [ ] **Step 3: 跑 promptBuilder 测试 FAIL → 实现**

Run: `pnpm test test/unit/promptBuilder.test.ts`

实现 `src/llm/promptBuilder.ts`:

```ts
import type { ExplainOptions, Message } from './types'

export const SYSTEM_PROMPT = [
  '你是用户的术语翻译官,任务是用清晰、简短、贴近上下文的中文解释一段被选中的文本。',
  '严格基于"用户与 Claude Code 之前的对话"来作答,不要泛泛而谈。',
  '如果对话里有定义/例子,直接引用; 没有再用通识补充,并标明"基于通识"。',
].join(' ')

const MAX_SELECTED = 2200

function truncateSelected(s: string): string {
  if (s.length <= MAX_SELECTED) return s
  return s.slice(0, 2000) + `\n[已截断 ${s.length - 2200} 字符]\n` + s.slice(-200)
}

export function buildMessages(opts: ExplainOptions): Message[] {
  const out: Message[] = []
  out.push({ role: 'system', content: SYSTEM_PROMPT })
  for (const m of opts.conversation) out.push(m)
  out.push({
    role: 'user',
    content: [
      '请结合上文,解释下面这段被选中的文本:',
      '---',
      truncateSelected(opts.selectedText),
      '---',
    ].join('\n'),
  })
  for (const t of opts.followUps) {
    out.push({ role: t.role === 'ai' ? 'assistant' : 'user', content: t.text })
  }
  return out
}
```

- [ ] **Step 4: 测试 PASS**

Run: `pnpm test test/unit/promptBuilder.test.ts`

- [ ] **Step 5: 写 LLMRouter 失败测试 `test/unit/LLMRouter.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { LLMRouter } from '../../src/llm/LLMRouter'
import type { LLMAdapter, ExplainOptions } from '../../src/llm/types'

function fakeAdapter(chunks: string[]): LLMAdapter {
  return {
    async *explain(_opts: ExplainOptions) {
      for (const c of chunks) yield c
    },
  }
}

describe('LLMRouter', () => {
  it('按 provider 路由', async () => {
    const claude = fakeAdapter(['c1', 'c2'])
    const openai = fakeAdapter(['o1'])
    const router = new LLMRouter({ claude, openai, ollama: fakeAdapter([]) })
    const got: string[] = []
    for await (const c of router.explain('claude', {
      selectedText: 'x', conversation: [], followUps: [], modelId: 'm',
    })) got.push(c)
    expect(got).toEqual(['c1', 'c2'])
  })

  it('未知 provider 抛错', async () => {
    const router = new LLMRouter({
      claude: fakeAdapter([]), openai: fakeAdapter([]), ollama: fakeAdapter([]),
    })
    await expect((async () => {
      // @ts-expect-error unknown provider
      for await (const _c of router.explain('unknown', { selectedText: 'x', conversation: [], followUps: [], modelId: 'm' })) {}
    })()).rejects.toThrow(/unknown provider/)
  })
})
```

- [ ] **Step 6: 实现 `src/llm/LLMRouter.ts`**

```ts
import type { LLMAdapter, ExplainOptions, ProviderId } from './types'

export class LLMRouter {
  constructor(private adapters: Record<ProviderId, LLMAdapter>) {}

  explain(provider: ProviderId, opts: ExplainOptions): AsyncIterable<string> {
    const a = this.adapters[provider]
    if (!a) throw new Error(`unknown provider: ${provider}`)
    return a.explain(opts)
  }
}
```

- [ ] **Step 7: 测试 PASS**

Run: `pnpm test test/unit/LLMRouter.test.ts test/unit/promptBuilder.test.ts`

- [ ] **Step 8: Commit**

```bash
git add src/llm test/unit/promptBuilder.test.ts test/unit/LLMRouter.test.ts
git commit -m "feat(llm): LLMRouter + 统一 prompt 模板"
```

---

## Task 7b: ClaudeAdapter

**Files:**

- Create: `src/llm/ClaudeAdapter.ts`
- Create: `test/unit/ClaudeAdapter.test.ts`

**职责:** 接 Anthropic Messages API 的 SSE 流式接口,把每个 `content_block_delta` 的 text 当 chunk yield 出去。用依赖注入的 `fetch` 方便测试。

- [ ] **Step 1: 写失败测试 `test/unit/ClaudeAdapter.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from '../../src/llm/ClaudeAdapter'

function sseResponse(events: string[]): Response {
  const body = new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(new TextEncoder().encode(e))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('ClaudeAdapter', () => {
  it('把 content_block_delta 解析成 chunk', async () => {
    const fetchFn = async () => sseResponse([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])
    const adapter = new ClaudeAdapter({ apiKey: 'k', fetchFn })
    const chunks: string[] = []
    for await (const c of adapter.explain({
      selectedText: 'x', conversation: [], followUps: [], modelId: 'claude-opus-4-7',
    })) chunks.push(c)
    expect(chunks.join('')).toBe('Hello')
  })

  it('HTTP 错误抛 Error 含 status', async () => {
    const fetchFn = async () => new Response('bad', { status: 401 })
    const adapter = new ClaudeAdapter({ apiKey: 'k', fetchFn })
    await expect((async () => {
      for await (const _ of adapter.explain({
        selectedText: 'x', conversation: [], followUps: [], modelId: 'm',
      })) {}
    })()).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: 跑测试 FAIL**

Run: `pnpm test test/unit/ClaudeAdapter.test.ts`

- [ ] **Step 3: 实现 `src/llm/ClaudeAdapter.ts`**

```ts
import type { LLMAdapter, ExplainOptions, Message } from './types'
import { buildMessages } from './promptBuilder'

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export class ClaudeAdapter implements LLMAdapter {
  constructor(private opts: { apiKey: string; fetchFn?: FetchFn; baseUrl?: string }) {}

  async *explain(opts: ExplainOptions): AsyncIterable<string> {
    const msgs = buildMessages(opts)
    const system = msgs.find((m) => m.role === 'system')?.content
    const rest = msgs.filter((m) => m.role !== 'system') as Array<Message & { role: 'user' | 'assistant' }>
    const f = this.opts.fetchFn ?? fetch
    const res = await f((this.opts.baseUrl ?? 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.modelId,
        max_tokens: 1024,
        stream: true,
        system,
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      }),
    })
    if (!res.ok || !res.body) throw new Error(`Claude API ${res.status}`)
    yield* parseSse(res.body)
  }
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const ev of events) {
      const line = ev.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const json = line.slice(6).trim()
      try {
        const obj = JSON.parse(json) as { type?: string; delta?: { type?: string; text?: string } }
        if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && obj.delta.text) {
          yield obj.delta.text
        }
      } catch {
        /* ignore */
      }
    }
  }
}
```

- [ ] **Step 4: 测试 PASS**

Run: `pnpm test test/unit/ClaudeAdapter.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/llm/ClaudeAdapter.ts test/unit/ClaudeAdapter.test.ts
git commit -m "feat(llm): ClaudeAdapter 调 Anthropic Messages SSE 流"
```

---

## Task 7c: OpenAIAdapter

**Files:**

- Create: `src/llm/OpenAIAdapter.ts`
- Create: `test/unit/OpenAIAdapter.test.ts`

OpenAI Chat Completions SSE 流的 chunk 格式不同。同样依赖注入 fetch。

- [ ] **Step 1: 写失败测试 `test/unit/OpenAIAdapter.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { OpenAIAdapter } from '../../src/llm/OpenAIAdapter'

function sseResponse(events: string[]): Response {
  const body = new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(new TextEncoder().encode(e))
      c.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe('OpenAIAdapter', () => {
  it('把 choices[0].delta.content 串起来', async () => {
    const fetchFn = async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    const adapter = new OpenAIAdapter({ apiKey: 'k', fetchFn })
    const chunks: string[] = []
    for await (const c of adapter.explain({
      selectedText: 'x', conversation: [], followUps: [], modelId: 'gpt-4o',
    })) chunks.push(c)
    expect(chunks.join('')).toBe('Hello')
  })
})
```

- [ ] **Step 2: 实现 `src/llm/OpenAIAdapter.ts`**

```ts
import type { LLMAdapter, ExplainOptions } from './types'
import { buildMessages } from './promptBuilder'
import type { FetchFn } from './ClaudeAdapter'

export class OpenAIAdapter implements LLMAdapter {
  constructor(private opts: { apiKey: string; fetchFn?: FetchFn; baseUrl?: string }) {}

  async *explain(opts: ExplainOptions): AsyncIterable<string> {
    const f = this.opts.fetchFn ?? fetch
    const res = await f((this.opts.baseUrl ?? 'https://api.openai.com') + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.modelId,
        stream: true,
        messages: buildMessages(opts),
      }),
    })
    if (!res.ok || !res.body) throw new Error(`OpenAI API ${res.status}`)
    yield* parse(res.body)
  }
}

async function* parse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const ev of events) {
      const line = ev.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const payload = line.slice(6).trim()
      if (payload === '[DONE]') return
      try {
        const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
        const t = obj.choices?.[0]?.delta?.content
        if (t) yield t
      } catch {
        /* ignore */
      }
    }
  }
}
```

- [ ] **Step 3: 测试 PASS + Commit**

```bash
pnpm test test/unit/OpenAIAdapter.test.ts
git add src/llm/OpenAIAdapter.ts test/unit/OpenAIAdapter.test.ts
git commit -m "feat(llm): OpenAIAdapter Chat Completions SSE 流"
```

---

## Task 7d: OllamaAdapter

**Files:**

- Create: `src/llm/OllamaAdapter.ts`
- Create: `test/unit/OllamaAdapter.test.ts`

Ollama `/api/chat` 返回 NDJSON (每行一个 JSON 对象), 字段 `message.content`。

- [ ] **Step 1: 写失败测试 `test/unit/OllamaAdapter.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { OllamaAdapter } from '../../src/llm/OllamaAdapter'

function ndjsonResponse(lines: string[]): Response {
  const body = new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(l + '\n'))
      c.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe('OllamaAdapter', () => {
  it('把 message.content 串起来', async () => {
    const fetchFn = async () => ndjsonResponse([
      JSON.stringify({ message: { content: 'Hel' } }),
      JSON.stringify({ message: { content: 'lo' } }),
      JSON.stringify({ done: true }),
    ])
    const adapter = new OllamaAdapter({ baseUrl: 'http://x', fetchFn })
    const chunks: string[] = []
    for await (const c of adapter.explain({
      selectedText: 'x', conversation: [], followUps: [], modelId: 'llama3.1:8b',
    })) chunks.push(c)
    expect(chunks.join('')).toBe('Hello')
  })

  it('connect refused 时抛带友好提示的错', async () => {
    const fetchFn = async () => { throw new Error('ECONNREFUSED') }
    const adapter = new OllamaAdapter({ baseUrl: 'http://x', fetchFn })
    await expect((async () => {
      for await (const _ of adapter.explain({
        selectedText: 'x', conversation: [], followUps: [], modelId: 'm',
      })) {}
    })()).rejects.toThrow(/Ollama.*未运行|无法连接/)
  })
})
```

- [ ] **Step 2: 实现 `src/llm/OllamaAdapter.ts`**

```ts
import type { LLMAdapter, ExplainOptions } from './types'
import { buildMessages } from './promptBuilder'
import type { FetchFn } from './ClaudeAdapter'

export class OllamaAdapter implements LLMAdapter {
  constructor(private opts: { baseUrl?: string; fetchFn?: FetchFn }) {}

  async *explain(opts: ExplainOptions): AsyncIterable<string> {
    const f = this.opts.fetchFn ?? fetch
    const url = (this.opts.baseUrl ?? 'http://127.0.0.1:11434') + '/api/chat'
    let res: Response
    try {
      res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: opts.modelId,
          stream: true,
          messages: buildMessages(opts).map((m) => ({ role: m.role, content: m.content })),
        }),
      })
    } catch (e) {
      const msg = (e as Error).message ?? ''
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        throw new Error('无法连接到 Ollama,确认 ollama 服务已运行 (ollama serve)')
      }
      throw e
    }
    if (!res.ok || !res.body) throw new Error(`Ollama API ${res.status}`)
    yield* parseNd(res.body)
  }
}

async function* parseNd(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
        if (obj.message?.content) yield obj.message.content
        if (obj.done) return
      } catch {
        /* ignore */
      }
    }
  }
}
```

- [ ] **Step 3: 测试 PASS + Commit**

```bash
pnpm test test/unit/OllamaAdapter.test.ts
git add src/llm/OllamaAdapter.ts test/unit/OllamaAdapter.test.ts
git commit -m "feat(llm): OllamaAdapter NDJSON 流 + 连接失败友好提示"
```

---

## Task 8: SelectionCapture (命令处理)

**Files:**

- Create: `src/capture/SelectionCapture.ts`
- Create: `test/unit/SelectionCapture.test.ts`

**职责:** 不直接用 `vscode` 模块,而是把"读选区"做成依赖,方便单测。`extension.ts` 注册命令时再桥接到 `vscode.window.activeTextEditor.selection`。

- [ ] **Step 1: 写失败测试 `test/unit/SelectionCapture.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { handleExplainSelection, type SelectionDeps } from '../../src/capture/SelectionCapture'

function deps(over: Partial<SelectionDeps> = {}): SelectionDeps {
  return {
    getSelection: vi.fn(() => 'some text'),
    getCurrentSession: vi.fn(() => ({ sessionId: 's1', transcriptPath: '/x', cwd: '/' })),
    showInfo: vi.fn(),
    confirmEmptyTextMode: vi.fn(async () => true),
    revealSidebar: vi.fn(),
    createCard: vi.fn(async () => ({ id: 'c1' })),
    explainCard: vi.fn(async () => undefined),
    ...over,
  }
}

describe('SelectionCapture.handleExplainSelection', () => {
  it('选区为空 → 提示并返回, 不建卡片', async () => {
    const d = deps({ getSelection: () => '' })
    await handleExplainSelection(d)
    expect(d.showInfo).toHaveBeenCalledWith(expect.stringContaining('选中'))
    expect(d.createCard).not.toHaveBeenCalled()
  })

  it('正常路径: 拿选区 + session → 建卡 + 唤起侧栏 + 触发解释', async () => {
    const d = deps()
    await handleExplainSelection(d)
    expect(d.createCard).toHaveBeenCalledWith({ sessionId: 's1', selectedText: 'some text' })
    expect(d.revealSidebar).toHaveBeenCalled()
    expect(d.explainCard).toHaveBeenCalledWith('c1')
  })

  it('无 session: 用户确认走纯文本模式 → 用 sessionId="__none__" 建卡', async () => {
    const d = deps({ getCurrentSession: () => null, confirmEmptyTextMode: async () => true })
    await handleExplainSelection(d)
    expect(d.createCard).toHaveBeenCalledWith({ sessionId: '__none__', selectedText: 'some text' })
  })

  it('无 session: 用户拒绝 → 取消', async () => {
    const d = deps({ getCurrentSession: () => null, confirmEmptyTextMode: async () => false })
    await handleExplainSelection(d)
    expect(d.createCard).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试 FAIL**

Run: `pnpm test test/unit/SelectionCapture.test.ts`

- [ ] **Step 3: 实现 `src/capture/SelectionCapture.ts`**

```ts
import type { Session } from '../session/SessionTracker'

export type SelectionDeps = {
  getSelection: () => string
  getCurrentSession: () => Session | null
  showInfo: (msg: string) => void
  confirmEmptyTextMode: () => Promise<boolean>
  revealSidebar: () => void
  createCard: (opts: { sessionId: string; selectedText: string }) => Promise<{ id: string }>
  explainCard: (cardId: string) => Promise<void>
}

export const NO_SESSION = '__none__'

export async function handleExplainSelection(d: SelectionDeps): Promise<void> {
  const text = d.getSelection()
  if (!text || text.trim() === '') {
    d.showInfo('请先选中要解释的文字')
    return
  }
  let sessionId: string
  const cur = d.getCurrentSession()
  if (cur) {
    sessionId = cur.sessionId
  } else {
    const ok = await d.confirmEmptyTextMode()
    if (!ok) return
    sessionId = NO_SESSION
  }
  const card = await d.createCard({ sessionId, selectedText: text })
  d.revealSidebar()
  await d.explainCard(card.id)
}
```

- [ ] **Step 4: 测试 PASS + Commit**

```bash
pnpm test test/unit/SelectionCapture.test.ts
git add src/capture test/unit/SelectionCapture.test.ts
git commit -m "feat(capture): SelectionCapture 解释选区命令的纯函数版"
```

---

## Task 9: 消息协议 + Webview Provider 骨架

**Files:**

- Create: `src/webview/messages.ts`
- Create: `src/webview/AnnotationViewProvider.ts`

无单测 (这部分主要靠集成测试覆盖, 单元粒度太靠 VSCode)。仍要确保类型/接口正确。

- [ ] **Step 1: 写 `src/webview/messages.ts`**

```ts
import type { AnnotationCard } from '../store/AnnotationStore'

export type ExtToWeb =
  | { kind: 'render'; cards: AnnotationCard[] }
  | { kind: 'card-stream'; cardId: string; chunk: string }
  | { kind: 'card-done'; cardId: string }
  | { kind: 'card-error'; cardId: string; message: string }

export type WebToExt =
  | { kind: 'follow-up'; cardId: string; text: string }
  | { kind: 'mark-resolved'; cardId: string; resolved: boolean }
  | { kind: 'delete'; cardId: string }
  | { kind: 'retry'; cardId: string }
  | { kind: 'open-settings' }
```

- [ ] **Step 2: 写 `src/webview/AnnotationViewProvider.ts`**

```ts
import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AnnotationStore } from '../store/AnnotationStore'
import type { ExtToWeb, WebToExt } from './messages'

export class AnnotationViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ask-anytime.annotations'
  private view?: vscode.WebviewView

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: AnnotationStore,
    private currentSessionId: () => string,
    private handlers: {
      onFollowUp: (cardId: string, text: string) => void | Promise<void>
      onRetry: (cardId: string) => void | Promise<void>
    },
  ) {
    store.onChange((sid) => {
      if (sid === this.currentSessionId()) this.renderCurrent()
    })
  }

  setCurrentSession(_sid: string): void {
    this.renderCurrent()
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${AnnotationViewProvider.viewType}.focus`)
  }

  postStreamChunk(cardId: string, chunk: string): void {
    this.post({ kind: 'card-stream', cardId, chunk })
  }
  postDone(cardId: string): void {
    this.post({ kind: 'card-done', cardId })
  }
  postError(cardId: string, message: string): void {
    this.post({ kind: 'card-error', cardId, message })
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media')],
    }
    view.webview.html = this.buildHtml(view.webview)
    view.webview.onDidReceiveMessage(async (m: WebToExt) => {
      switch (m.kind) {
        case 'follow-up': await this.handlers.onFollowUp(m.cardId, m.text); break
        case 'mark-resolved': await this.store.markResolved(m.cardId, m.resolved); break
        case 'delete': await this.store.delete(m.cardId); break
        case 'retry': await this.handlers.onRetry(m.cardId); break
        case 'open-settings':
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tanqs.ask-anytime')
          break
      }
    })
    this.renderCurrent()
  }

  private renderCurrent(): void {
    if (!this.view) return
    this.post({ kind: 'render', cards: this.store.get(this.currentSessionId()) })
  }

  private post(msg: ExtToWeb): void {
    this.view?.webview.postMessage(msg)
  }

  private buildHtml(webview: vscode.Webview): string {
    const mediaDir = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'media')
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'main.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'style.css'))
    const nonce = randomNonce()
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ')
    const html = fs.readFileSync(path.join(this.extensionUri.fsPath, 'src', 'webview', 'media', 'index.html'), 'utf8')
    return html
      .replace('{{CSP}}', csp)
      .replace('{{STYLE}}', styleUri.toString())
      .replace('{{SCRIPT}}', scriptUri.toString())
      .replace(/{{NONCE}}/g, nonce)
  }
}

function randomNonce(): string {
  const arr = new Uint8Array(16)
  for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 3: typecheck + commit**

```bash
pnpm typecheck
git add src/webview/messages.ts src/webview/AnnotationViewProvider.ts
git commit -m "feat(webview): 消息协议 + WebviewViewProvider 骨架 (含 CSP)"
```

---

## Task 10: Webview UI 资源 (HTML / CSS / JS)

**Files:**

- Create: `src/webview/media/index.html`
- Create: `src/webview/media/style.css`
- Create: `src/webview/media/main.js`

UI 是单文件原生 JS,无框架。

- [ ] **Step 1: 写 `src/webview/media/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="{{CSP}}" />
  <link rel="stylesheet" href="{{STYLE}}" />
  <title>Ask Anytime</title>
</head>
<body>
  <div id="empty" class="empty">还没有批注。在编辑器里选中文字, 按 Ctrl+Shift+A。</div>
  <ol id="cards" class="cards"></ol>
  <script nonce="{{NONCE}}" src="{{SCRIPT}}"></script>
</body>
</html>
```

- [ ] **Step 2: 写 `src/webview/media/style.css`**

```css
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); margin: 0; padding: 8px; }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 8px; text-align: center; }
.cards { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; background: var(--vscode-editor-background); }
.card.resolved { opacity: 0.6; }
.card header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.card .quote { font-family: var(--vscode-editor-font-family); background: var(--vscode-textBlockQuote-background); padding: 4px 6px; border-radius: 4px; max-height: 120px; overflow: auto; flex: 1; font-size: 0.9em; }
.card .actions button { background: transparent; border: none; cursor: pointer; color: var(--vscode-icon-foreground); padding: 2px 6px; }
.card .actions button:hover { background: var(--vscode-toolbar-hoverBackground); }
.card .body { white-space: pre-wrap; word-break: break-word; }
.card .turn { margin: 6px 0; }
.card .turn.user::before { content: '> '; color: var(--vscode-descriptionForeground); }
.card .followup { display: flex; gap: 4px; margin-top: 8px; }
.card .followup input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px; }
.card .followup button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; }
.card .error { color: var(--vscode-errorForeground); border-top: 1px dashed var(--vscode-errorForeground); padding-top: 6px; margin-top: 6px; }
```

- [ ] **Step 3: 写 `src/webview/media/main.js`**

```js
(function () {
  const vscode = acquireVsCodeApi()
  const root = document.getElementById('cards')
  const empty = document.getElementById('empty')
  let cards = []
  let streaming = new Map()

  function render() {
    if (cards.length === 0) {
      empty.style.display = 'block'
      root.innerHTML = ''
      return
    }
    empty.style.display = 'none'
    root.innerHTML = ''
    for (const c of cards) root.appendChild(renderCard(c))
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function renderCard(c) {
    const li = document.createElement('li')
    li.className = 'card' + (c.resolved ? ' resolved' : '')
    li.dataset.id = c.id

    const header = document.createElement('header')
    const quote = document.createElement('div')
    quote.className = 'quote'
    quote.textContent = c.selectedText
    header.appendChild(quote)

    const actions = document.createElement('div')
    actions.className = 'actions'
    const checkBtn = document.createElement('button')
    checkBtn.title = c.resolved ? '取消已理解' : '标记已理解'
    checkBtn.textContent = c.resolved ? '↺' : '✓'
    checkBtn.addEventListener('click', () => vscode.postMessage({ kind: 'mark-resolved', cardId: c.id, resolved: !c.resolved }))
    const delBtn = document.createElement('button')
    delBtn.title = '删除'
    delBtn.textContent = '✕'
    delBtn.addEventListener('click', () => vscode.postMessage({ kind: 'delete', cardId: c.id }))
    actions.append(checkBtn, delBtn)
    header.appendChild(actions)
    li.appendChild(header)

    const body = document.createElement('div')
    body.className = 'body'
    for (const t of c.turns) {
      const div = document.createElement('div')
      div.className = 'turn ' + t.role
      div.textContent = t.text
      body.appendChild(div)
    }
    li.appendChild(body)

    const fu = document.createElement('div')
    fu.className = 'followup'
    const input = document.createElement('input')
    input.placeholder = '追问…'
    const send = document.createElement('button')
    send.textContent = '发送'
    function submit() {
      if (!input.value.trim()) return
      vscode.postMessage({ kind: 'follow-up', cardId: c.id, text: input.value })
      input.value = ''
    }
    send.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    fu.append(input, send)
    li.appendChild(fu)
    return li
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data
    if (m.kind === 'render') { cards = m.cards; render() }
    else if (m.kind === 'card-stream') {
      const li = root.querySelector(`[data-id="${CSS.escape(m.cardId)}"] .body .turn:last-child`)
      if (li) li.textContent = (li.textContent ?? '') + m.chunk
    }
    else if (m.kind === 'card-done') { /* no-op, 已经流式渲染过 */ }
    else if (m.kind === 'card-error') {
      const li = root.querySelector(`[data-id="${CSS.escape(m.cardId)}"]`)
      if (li) {
        const err = document.createElement('div')
        err.className = 'error'
        err.textContent = m.message
        const retry = document.createElement('button')
        retry.textContent = '重试'
        retry.addEventListener('click', () => vscode.postMessage({ kind: 'retry', cardId: m.cardId }))
        err.appendChild(retry)
        li.appendChild(err)
      }
    }
  })
})()
```

- [ ] **Step 4: 让 esbuild 复制 media 到 dist (修改 `esbuild.config.mjs`)**

实际上 webview HTML/CSS/JS 由 VSCode 直接从 extensionUri 加载,我们用 `src/webview/media/` 路径就行,不需要打包。但要让 `vscode:prepublish` 时被 `.vscodeignore` 放行。前面 `.vscodeignore` 没排除它,OK。

仅需确保 `package.json` 的 `vscode:prepublish` 包含 build,后续如有需要再调整。本步骤暂无构建动作。

- [ ] **Step 5: 手动 sanity check + Commit**

Run: `pnpm typecheck`

```bash
git add src/webview/media
git commit -m "feat(webview): 卡片侧栏 HTML/CSS/JS (含 CSP nonce)"
```

**MVP 范围说明:** spec §4.6 提到"支持基础 Markdown 渲染",本 v0.0.1 用 `textContent` 安全输出纯文本(避免 XSS), Markdown 渲染留到后续版本 (建议引入 `markdown-it` + DOMPurify 双保险)。

---

## Task 11: extension.ts 入口 (装配所有模块)

**Files:**

- Modify: `src/extension.ts`

**职责:** 在 activate 时初始化所有单例、注册命令/视图/事件桥接。这层是"胶水代码",难单元测试,主要靠集成测试覆盖。

- [ ] **Step 1: 重写 `src/extension.ts`**

```ts
import * as vscode from 'vscode'
import * as path from 'node:path'
import * as os from 'node:os'
import { AnnotationStore, type Persister } from './store/AnnotationStore'
import { SessionTracker } from './session/SessionTracker'
import { installHook, uninstallHook, isHookInstalled } from './session/hookInstaller'
import { buildContext } from './context/ContextBuilder'
import { LLMRouter } from './llm/LLMRouter'
import { ClaudeAdapter } from './llm/ClaudeAdapter'
import { OpenAIAdapter } from './llm/OpenAIAdapter'
import { OllamaAdapter } from './llm/OllamaAdapter'
import type { ProviderId } from './llm/types'
import { handleExplainSelection, NO_SESSION } from './capture/SelectionCapture'
import { AnnotationViewProvider } from './webview/AnnotationViewProvider'

const SECRET_KEYS: Record<ProviderId, string> = {
  claude: 'ask-anytime.claude.apiKey',
  openai: 'ask-anytime.openai.apiKey',
  ollama: 'ask-anytime.ollama.apiKey',
}

export async function activate(context: vscode.ExtensionContext): Promise<{ store: AnnotationStore; tracker: SessionTracker }> {
  const home = os.homedir()
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? home

  // -- Store
  const persister: Persister = {
    get: (k, d) => context.globalState.get(k, d),
    update: (k, v) => Promise.resolve(context.globalState.update(k, v)),
  }
  const store = new AnnotationStore(persister)

  // -- Session
  const tracker = new SessionTracker({ home, workspace, staleMs: 30_000 })
  await tracker.init()

  // -- Hook 安装(询问)
  void ensureHookInstalled(context, home)

  // -- LLM
  const router = await buildRouter(context)

  // -- Webview
  const provider = new AnnotationViewProvider(
    context.extensionUri,
    store,
    () => tracker.getCurrentSession()?.sessionId ?? NO_SESSION,
    {
      onFollowUp: async (cardId, text) => {
        await store.appendTurn(cardId, { role: 'user', text })
        await runExplain(cardId)
      },
      onRetry: async (cardId) => { await runExplain(cardId) },
    },
  )
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AnnotationViewProvider.viewType, provider),
  )

  tracker.onSessionChanged((s) => provider.setCurrentSession(s?.sessionId ?? NO_SESSION))

  async function runExplain(cardId: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('ask-anytime')
    const providerId = cfg.get<ProviderId>('provider', 'claude')
    const modelId = cfg.get<string>('model', 'claude-opus-4-7')
    const cur = tracker.getCurrentSession()
    const conversation = cur
      ? await buildContext(cur.transcriptPath, { maxTokens: 100_000 }).catch(() => [])
      : []
    const card = store.findCard(cardId)
    if (!card) return
    try {
      for await (const chunk of router.explain(providerId, {
        selectedText: card.selectedText,
        conversation,
        followUps: card.turns.slice(1).map((t) => ({ role: t.role, text: t.text })),
        modelId,
      })) {
        await store.appendStreamChunk(cardId, chunk)
        provider.postStreamChunk(cardId, chunk)
      }
      await store.finalizeCard(cardId)
      provider.postDone(cardId)
    } catch (e) {
      provider.postError(cardId, (e as Error).message)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('ask-anytime.explainSelection', async () => {
      await handleExplainSelection({
        getSelection: () => {
          const ed = vscode.window.activeTextEditor
          if (!ed) return ''
          return ed.document.getText(ed.selection)
        },
        getCurrentSession: () => tracker.getCurrentSession(),
        showInfo: (msg) => void vscode.window.showInformationMessage(msg),
        confirmEmptyTextMode: async () => {
          const choice = await vscode.window.showWarningMessage(
            '未检测到活跃的 Claude Code 会话, 是否仅用选中文本解释?',
            { modal: false }, '继续', '取消',
          )
          return choice === '继续'
        },
        revealSidebar: () => provider.reveal(),
        createCard: (o) => store.create(o),
        explainCard: (id) => runExplain(id),
      })
    }),
    vscode.commands.registerCommand('ask-anytime.uninstallHook', async () => {
      await uninstallHook({ home })
      void vscode.window.showInformationMessage('已移除 Ask Anytime 的 SessionStart hook')
    }),
  )

  // 暴露给 e2e 测试断言用
  return { store, tracker }
}

async function ensureHookInstalled(context: vscode.ExtensionContext, home: string): Promise<void> {
  if (await isHookInstalled({ home })) return
  const choice = await vscode.window.showInformationMessage(
    'Ask Anytime 需要在 ~/.claude/settings.json 安装一个 SessionStart hook 才能精准感知 Claude Code 会话。是否同意安装?',
    '安装', '使用兜底方案(不安装)',
  )
  if (choice === '安装') {
    const script = path.join(context.extensionPath, 'hook', 'write_session.js')
    await installHook({ home, hookScriptPath: script })
    void vscode.window.showInformationMessage('hook 已安装,可通过 "Ask Anytime: 移除 SessionStart hook" 卸载')
  }
}

async function buildRouter(context: vscode.ExtensionContext): Promise<LLMRouter> {
  const claudeKey = (await context.secrets.get(SECRET_KEYS.claude)) ?? ''
  const openaiKey = (await context.secrets.get(SECRET_KEYS.openai)) ?? ''
  return new LLMRouter({
    claude: new ClaudeAdapter({ apiKey: claudeKey }),
    openai: new OpenAIAdapter({ apiKey: openaiKey }),
    ollama: new OllamaAdapter({}),
  })
}
```

- [ ] **Step 2: typecheck + build**

Run:

```bash
pnpm typecheck
pnpm build
```

Expected: 无错。

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat(extension): 入口装配各模块 + 命令/视图/事件桥接"
```

---

## Task 12: 集成测试 (@vscode/test-electron)

**Files:**

- Create: `test/integration/run.ts`
- Create: `test/integration/e2e.test.ts`
- Modify: `package.json` (脚本 `test:e2e`)
- Modify: `vitest.config.ts` 排除 integration 目录

集成测试在真实 VSCode Electron 里跑,**最重要的覆盖项**是验证"选区能从 Claude Code transcript 视图拿到" —— 但因为 Claude Code 是闭源扩展,我们用 Markdown 文件模拟选区(占位),真实验证留给 §7.3 手动验收。

本任务只覆盖几个核心 case (写 mock jsonl + mock hook 文件,验证侧栏 render)。

- [ ] **Step 1: 改 `vitest.config.ts` 排除 integration**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    exclude: ['test/integration/**'],
    environment: 'node',
    pool: 'forks',
  },
})
```

- [ ] **Step 2: 写 `test/integration/run.ts` (启动器)**

```ts
import { runTests } from '@vscode/test-electron'
import * as path from 'node:path'

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../')
  const extensionTestsPath = path.resolve(__dirname, './e2e.test')
  await runTests({ extensionDevelopmentPath, extensionTestsPath })
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: 写 `test/integration/e2e.test.ts`**

```ts
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as vscode from 'vscode'

export async function run(): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  const dir = path.join(home, '.claude', 'projects', '-tmp-ws')
  fs.mkdirSync(dir, { recursive: true })
  const transcript = path.join(dir, 'sess1.jsonl')
  fs.writeFileSync(transcript, JSON.stringify({
    type: 'assistant', message: { role: 'assistant', content: '一段示例回答 retry policy' },
  }) + '\n')
  fs.writeFileSync(path.join(home, '.claude', '.ask_anytime_session.json'), JSON.stringify({
    sessionId: 'sess1', cwd: '/tmp/ws', transcriptPath: transcript, updatedAt: Date.now(),
  }))

  await vscode.extensions.getExtension('tanqs.ask-anytime')?.activate()
  // 打开一个新文档, 选中文本, 触发命令
  const doc = await vscode.workspace.openTextDocument({ content: 'retry policy', language: 'plaintext' })
  const editor = await vscode.window.showTextDocument(doc)
  editor.selection = new vscode.Selection(0, 0, 0, 12)
  await vscode.commands.executeCommand('ask-anytime.explainSelection')

  // 等待 store 出现至少 1 条卡片
  await new Promise((r) => setTimeout(r, 1000))
  const ext = vscode.extensions.getExtension('tanqs.ask-anytime')!
  // 此处仅校验命令注册成功;真实卡片状态需要把 store 通过 ext.exports 暴露才能直接查。
  assert.ok(ext.isActive)
}
```

注:Task 11 的 `activate` 已经 `return { store, tracker }`,所以这里直接用 `ext.exports` 拿 store 做断言:

```ts
const api = ext.exports as { store: import('../../src/store/AnnotationStore').AnnotationStore }
const cards = api.store.get('sess1')
assert.strictEqual(cards.length, 1)
assert.strictEqual(cards[0].selectedText, 'retry policy')
```

把上面这段追加到 e2e.test.ts 末尾(替换原本的 `assert.ok(ext.isActive)`)。

- [ ] **Step 4: 在 `package.json` 加脚本**

```json
"test:e2e": "tsc -p test/integration/tsconfig.json && node test/integration/run.js"
```

并新建 `test/integration/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "outDir": "../../dist-tests",
    "rootDir": "../../",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["./**/*.ts", "../../src/**/*.ts"]
}
```

- [ ] **Step 5: 跑集成测试**

Run:

```bash
pnpm build
pnpm test:e2e
```

Expected: 一个 VSCode 实例启动,e2e 跑通,断言成功,进程退出 0。

- [ ] **Step 6: Commit**

```bash
git add test/integration package.json vitest.config.ts
git commit -m "test(e2e): @vscode/test-electron 集成测试覆盖侧栏 render"
```

---

## Task 13: 手动验收清单 (写到 README)

**Files:**

- Create: `README.md`

- [ ] **Step 1: 写 `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README 与手动验收清单"
```

---

## 完成

所有任务跑完后,扩展可以打包发布:

```bash
pnpm install -g @vscode/vsce
vsce package
```

生成 `ask-anytime-0.0.1.vsix`。
