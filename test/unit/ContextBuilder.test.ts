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
})
