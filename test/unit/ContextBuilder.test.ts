import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    const longStr = 'x'.repeat(400)
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

  it('大文件: 文件超阈值时只读尾部窗口, 丢弃可能不完整的首行', async () => {
    // 构造 200 行 jsonl, 每行约 100 字节, 总约 20 KB; 用 1KB 阈值触发尾部读
    const rows: object[] = []
    for (let i = 0; i < 200; i++) {
      rows.push({ type: 'user', message: { role: 'user', content: 'line-' + i + '-' + 'x'.repeat(80) } })
    }
    const p = join(dir, 'big.jsonl')
    writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'))
    // 用很小的 largeFileThreshold/tailWindow 触发尾部读
    const msgs = await buildContext(p, { maxTokens: 1_000_000, largeFileThreshold: 1024, tailWindow: 2048 })
    // 尾部窗口应包含若干行, 但绝对不包含 line-0
    expect(msgs.length).toBeGreaterThan(0)
    expect(msgs.length).toBeLessThan(200)
    expect(msgs.some((m) => m.content.startsWith('line-199'))).toBe(true)  // 末尾保留
    expect(msgs.some((m) => m.content.startsWith('line-0-'))).toBe(false)  // 开头丢弃
  })

  it('小文件: 阈值之内仍走全读, 行为不变', async () => {
    const p = writeJsonl([
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: 'hello' } },
    ])
    const msgs = await buildContext(p, { maxTokens: 10_000, largeFileThreshold: 10_000 })
    expect(msgs).toHaveLength(2)
  })
})
