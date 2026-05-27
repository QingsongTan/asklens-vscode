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
