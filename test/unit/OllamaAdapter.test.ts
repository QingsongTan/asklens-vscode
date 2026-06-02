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
    })()).rejects.toThrow(/无法连接到 Ollama/)
  })

  it('chat 直调: messages map 后透传, modelId 用调用方传入的', async () => {
    const fetchFn = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
      expect(body.model).toBe('test-model')
      return ndjsonResponse([
        JSON.stringify({ message: { content: 'ok' } }),
        JSON.stringify({ done: true }),
      ])
    }
    const adapter = new OllamaAdapter({ baseUrl: 'http://x', fetchFn })
    const chunks: string[] = []
    for await (const c of adapter.chat(
      [{ role: 'user', content: 'hi' }],
      'test-model',
    )) chunks.push(c)
    expect(chunks.join('')).toBe('ok')
  })
})
