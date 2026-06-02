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

  it('chat 直调: messages 原样作为 messages 字段透传', async () => {
    const fetchFn = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.messages).toEqual([
        { role: 'system', content: 'X' },
        { role: 'user', content: 'Y' },
      ])
      expect(body.model).toBe('test-model')
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    }
    const adapter = new OpenAIAdapter({ apiKey: 'k', fetchFn })
    const chunks: string[] = []
    for await (const c of adapter.chat(
      [{ role: 'system', content: 'X' }, { role: 'user', content: 'Y' }],
      'test-model',
    )) chunks.push(c)
    expect(chunks.join('')).toBe('ok')
  })
})
