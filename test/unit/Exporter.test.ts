import { describe, it, expect } from 'vitest'
import {
  renderRaw,
  buildArticleMessages,
  renderArticle,
  estimateArticleTokens,
} from '../../src/exporter/Exporter'
import type { AnnotationCard } from '../../src/store/AnnotationStore'
import type { Message } from '../../src/llm/types'

function card(over: Partial<AnnotationCard> = {}): AnnotationCard {
  return {
    id: over.id ?? 'c1',
    sessionId: over.sessionId ?? 'session-abcdef12-3456',
    selectedText: over.selectedText ?? 'retry policy',
    createdAt: over.createdAt ?? Date.UTC(2026, 4, 25),
    explained: over.explained ?? true,
    resolved: over.resolved ?? false,
    turns: over.turns ?? [{ role: 'ai', text: '解释A', ts: 0 }],
    error: over.error,
  }
}

describe('renderRaw', () => {
  const fixedNow = new Date(Date.UTC(2026, 4, 25))

  it('空 cards: 输出仅标题和概览', () => {
    const out = renderRaw([], { now: fixedNow })
    expect(out).toContain('# AskLens 知识导出 (2026-05-25)')
    expect(out).toContain('共 0 张卡片')
    expect(out).toContain('0 个会话')
  })

  it('单卡片 + 初次解释: 标题/quote/解释段都在', () => {
    const out = renderRaw([card()], { now: fixedNow })
    expect(out).toContain('## [session-]')  // session-abcdef12-3456 取前8字 → session-
    expect(out).toContain('retry policy')
    expect(out).toContain('**初次解释**')
    expect(out).toContain('解释A')
    expect(out).toContain('---')
  })

  it('含追问: Q/A 各一节', () => {
    const c = card({
      turns: [
        { role: 'ai', text: '初次', ts: 0 },
        { role: 'user', text: '继续?', ts: 1 },
        { role: 'ai', text: '续答', ts: 2 },
      ],
    })
    const out = renderRaw([c], { now: fixedNow })
    expect(out).toContain('**初次解释**')
    expect(out).toContain('初次')
    expect(out).toContain('**追问**: 继续?')
    expect(out).toContain('**回答**: 续答')
  })

  it('已解决: 标题带 ✓', () => {
    const out = renderRaw([card({ resolved: true })], { now: fixedNow })
    expect(out).toMatch(/## \[.+?\].* ✓/)
  })

  it('含错误: 末尾错误条', () => {
    const out = renderRaw([card({ error: '网络异常' })], { now: fixedNow })
    expect(out).toContain('**❌ 错误**: 网络异常')
  })

  it('selectedText 含换行: quote 多行处理', () => {
    const out = renderRaw([card({ selectedText: 'line1\nline2' })], { now: fixedNow })
    // 至少两行都以 > 开头
    expect(out).toMatch(/> line1\n> line2/)
  })

  it('__none__ session: 显示"无会话"', () => {
    const out = renderRaw([card({ sessionId: '__none__' })], { now: fixedNow })
    expect(out).toContain('[无会话]')
  })

  it('selectedText 超 40 字符截断到标题', () => {
    const long = 'x'.repeat(80)
    const out = renderRaw([card({ selectedText: long })], { now: fixedNow })
    expect(out).toMatch(/## \[.+?\] x{40}…/)
  })

  it('多 session 概览统计正确', () => {
    const cards = [
      card({ id: '1', sessionId: 's-a' }),
      card({ id: '2', sessionId: 's-a' }),
      card({ id: '3', sessionId: 's-b' }),
    ]
    const out = renderRaw(cards, { now: fixedNow })
    expect(out).toContain('共 3 张卡片')
    expect(out).toContain('2 个会话')
  })

  it('未完成 (explained=false): 跳过空 ai turn 不渲染空段', () => {
    const c = card({
      explained: false,
      turns: [{ role: 'ai', text: '', ts: 0 }],
    })
    const out = renderRaw([c], { now: fixedNow })
    expect(out).not.toContain('**初次解释**:\n\n')
  })
})

describe('buildArticleMessages', () => {
  it('返回 system + user 两条 messages, system 含"知识整理", user 含卡片内容', () => {
    const msgs = buildArticleMessages([card()])
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('知识整理')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('1 张卡片')
    expect(msgs[1].content).toContain('retry policy')
  })

  it('多卡片用 --- 分隔, 编号从 1 起', () => {
    const msgs = buildArticleMessages([card({ id: '1' }), card({ id: '2', selectedText: 'second' })])
    expect(msgs[1].content).toContain('卡片 1')
    expect(msgs[1].content).toContain('卡片 2')
    expect(msgs[1].content).toContain('second')
  })
})

describe('renderArticle', () => {
  it('调 chat 流式 yield', async () => {
    const fakeChat = async function* (_msgs: Message[], _modelId: string): AsyncIterable<string> {
      yield 'art'
      yield 'icle'
    }
    const out: string[] = []
    for await (const c of renderArticle([card()], fakeChat, { modelId: 'm' })) out.push(c)
    expect(out.join('')).toBe('article')
  })

  it('chat 接收 buildArticleMessages 的输出 + 传入的 modelId', async () => {
    let capturedMessages: Message[] | undefined
    let capturedModel: string | undefined
    const fakeChat = async function* (msgs: Message[], modelId: string): AsyncIterable<string> {
      capturedMessages = msgs
      capturedModel = modelId
      yield 'ok'
    }
    for await (const _ of renderArticle([card()], fakeChat, { modelId: 'gpt-4o' })) { /* drain */ }
    expect(capturedModel).toBe('gpt-4o')
    expect(capturedMessages).toHaveLength(2)
    expect(capturedMessages![0].role).toBe('system')
  })
})

describe('estimateArticleTokens', () => {
  it('返回 buildArticleMessages 内容长度 / 4 之和', () => {
    const cards = [card()]
    const msgs = buildArticleMessages(cards)
    const expected = msgs.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0)
    expect(estimateArticleTokens(cards)).toBe(expected)
  })

  it('卡片越多 token 越大', () => {
    const a = estimateArticleTokens([card()])
    const b = estimateArticleTokens([card(), card({ id: '2' }), card({ id: '3' })])
    expect(b).toBeGreaterThan(a)
  })
})
