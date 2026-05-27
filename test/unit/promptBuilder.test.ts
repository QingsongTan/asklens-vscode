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
