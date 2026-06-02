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

  it('chat 直调: 跳过 buildMessages, 用调用方提供的 messages', async () => {
    const fetchFn = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      // 验证 system 提取和 messages 透传
      expect(body.system).toBe('CUSTOM SYS')
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
      expect(body.model).toBe('test-model')
      return sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ])
    }
    const adapter = new ClaudeAdapter({ apiKey: 'k', fetchFn })
    const chunks: string[] = []
    for await (const c of adapter.chat(
      [
        { role: 'system', content: 'CUSTOM SYS' },
        { role: 'user', content: 'hi' },
      ],
      'test-model',
    )) chunks.push(c)
    expect(chunks.join('')).toBe('ok')
  })
})
